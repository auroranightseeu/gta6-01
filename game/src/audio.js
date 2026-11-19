// Sound, synthesised with WebAudio only — no audio files, no network. Engine hum
// (pitch follows speed), a two-tone siren while wanted, gunshot, pickup chime,
// mission jingles, punch thud, UI click, plus the v5 beds: helicopter rotor,
// city/coast ambience and a procedural driving-music loop.
//
// Two disciplines hold the whole file together:
//  * every public entry point is guarded, so a suspended/blocked/missing
//    AudioContext can never throw into the game loop;
//  * the loops (rotor, ambient, music) are built AT MOST ONCE and afterwards
//    only their gain is ramped, so main.js may call them every single frame.
let context = null;
let master = null;
let engine = null;
let siren = null;
let muted = false;
let volume = 0.5;

// Looping beds, all created lazily on first use.
let heli = null;
let ambient = null;
let ambientKind = 'off';
let noiseBuf = null;
let music = null;
let musicWanted = false; // setMusic(): the game wants music (driving + playing)
let musicAllowed = true; // audioSettings({ music }): the settings gate
let musicPlaying = false;

// Which note scheduler drives the music loop. 'lookahead' is the shipped one;
// 'raf' is the measured alternative, kept switchable for the A/B harness only.
let musicMode = 'lookahead';

// Instrumentation for the measurement harness (cheap integer/float counters).
const stats = {
  heliBuilds: 0,
  ambientBuilds: 0,
  musicBuilds: 0,
  musicStarts: 0,
  musicNotes: 0,
  musicTicks: 0,
  musicMs: 0,
  schedN: 0,
  schedSum: 0,
  schedSumSq: 0,
  schedMax: 0,
};

const MUSIC = {
  bpm: 92,
  bars: 4,
  stepsPerBar: 16,
  lookahead: 0.1, // seconds of audio clock scheduled in advance
  timerMs: 25, // how often the lookahead scheduler wakes up
  bassVol: 0.17,
  arpVol: 0.05,
  busVol: 0.9,
};
const STEP_DUR = 60 / MUSIC.bpm / 4; // 16th notes
const TOTAL_STEPS = MUSIC.stepsPerBar * MUSIC.bars;
// Am - F - C - G, roots one octave down from the arp register.
const ROOTS = [110.0, 87.31, 130.81, 98.0];
// Driving eight-note bass (semitone offsets from the bar root, null = rest).
const BASS = [0, null, 0, null, 0, null, 12, null, 0, null, 0, null, 7, null, 12, null];
// Sixteenth-note arpeggio across the chord.
const ARP = [0, 7, 12, 7, 3, 10, 15, 10, 5, 12, 17, 12, 7, 14, 19, 14];

function live() {
  return context !== null && context.state === 'running' && !muted;
}

/** One cached second of white noise, read at random offsets by every noise voice. */
function noiseBuffer() {
  if (noiseBuf) return noiseBuf;
  const len = Math.max(1, Math.floor(context.sampleRate * 1.0));
  noiseBuf = context.createBuffer(1, len, context.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

export function ensureAudio() {
  if (context) {
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = muted ? 0 : volume;
    master.connect(context.destination);
    // Engine: two detuned saws through a lowpass, quiet until the car moves.
    const osc1 = context.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 55;
    const osc2 = context.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 82;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const gain = context.createGain();
    gain.gain.value = 0;
    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc1.start();
    osc2.start();
    engine = { osc1, osc2, gain };
    // Siren: a square wave whose pitch wails between two tones on an LFO.
    const sOsc = context.createOscillator();
    sOsc.type = 'square';
    sOsc.frequency.value = 720;
    const lfo = context.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.9;
    const lfoGain = context.createGain();
    lfoGain.gain.value = 230;
    lfo.connect(lfoGain);
    lfoGain.connect(sOsc.frequency);
    const sGain = context.createGain();
    sGain.gain.value = 0;
    sOsc.connect(sGain);
    sGain.connect(master);
    sOsc.start();
    lfo.start();
    siren = { gain: sGain };
    // A context can appear after the game already asked for music (autoplay unlock
    // on first click); honour that pending request now instead of waiting for the
    // next edge on setMusic.
    if (musicWanted && musicAllowed) startMusic();
  } catch {
    context = null;
    master = null;
    engine = null;
    siren = null;
    heli = null;
    ambient = null;
    music = null;
    musicPlaying = false;
    ambientKind = 'off';
  }
  return context;
}

export function audioReady() {
  return live();
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  if (master && context) {
    try {
      master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.03);
    } catch {
      master.gain.value = muted ? 0 : volume;
    }
  }
  return muted;
}

/** Live settings: { volume: 0..1, music: bool }. Tolerates partial objects. */
export function audioSettings(s) {
  if (!s || typeof s !== 'object') return;
  try {
    if (typeof s.volume === 'number' && Number.isFinite(s.volume)) {
      volume = Math.max(0, Math.min(1, s.volume));
      if (master && context) master.gain.setTargetAtTime(muted ? 0 : volume, context.currentTime, 0.05);
    }
    if (typeof s.music === 'boolean' && s.music !== musicAllowed) {
      musicAllowed = s.music;
      applyMusic();
    }
  } catch {
    // Audio must never break the game.
  }
}

/** Called every frame while playing: engine pitch follows speed, siren on/off. */
export function setEngine(speed, driving, playing) {
  if (!engine || !context) return;
  try {
    const t = context.currentTime;
    const target = playing ? (driving ? 0.05 + Math.min(0.06, Math.abs(speed) * 0.002) : 0.012) : 0;
    engine.gain.gain.setTargetAtTime(target, t, 0.1);
    const f = 50 + Math.abs(speed) * 3.2;
    engine.osc1.frequency.setTargetAtTime(f, t, 0.1);
    engine.osc2.frequency.setTargetAtTime(f * 1.5, t, 0.1);
  } catch {
    // Audio must never break the game.
  }
}

export function setSiren(on) {
  if (!siren || !context) return;
  try {
    siren.gain.gain.setTargetAtTime(on ? 0.035 : 0, context.currentTime, 0.2);
  } catch {
    // Audio must never break the game.
  }
}

// --- Helicopter rotor ------------------------------------------------------
// Looping filtered noise with the amplitude chopped by a 9.5 Hz LFO (blade
// passes) plus a sub triangle for the body. Built once; only gain is ramped,
// so the per-frame call is a single setTargetAtTime.
function buildHeli() {
  const src = context.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;
  const lp = context.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.8;
  const chop = context.createGain();
  chop.gain.value = 0.55; // DC offset: the LFO swings 0.1..1.0
  const lfo = context.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 9.5;
  const lfoAmt = context.createGain();
  lfoAmt.gain.value = 0.45;
  lfo.connect(lfoAmt);
  lfoAmt.connect(chop.gain);
  const sub = context.createOscillator();
  sub.type = 'triangle';
  sub.frequency.value = 38;
  const subGain = context.createGain();
  subGain.gain.value = 0.22;
  const out = context.createGain();
  out.gain.value = 0;
  src.connect(lp);
  lp.connect(chop);
  chop.connect(out);
  sub.connect(subGain);
  subGain.connect(out);
  out.connect(master);
  src.start();
  lfo.start();
  sub.start();
  heli = { out };
  stats.heliBuilds += 1;
}

export function setHeli(on) {
  if (!context) return;
  const want = !!on;
  try {
    if (!heli) {
      if (!want) return; // never build the graph for a sound that is off
      buildHeli();
    }
    heli.out.gain.setTargetAtTime(want ? 0.07 : 0, context.currentTime, want ? 0.09 : 0.3);
  } catch {
    // Audio must never break the game.
  }
}

// --- Ambient bed ----------------------------------------------------------
// One shared noise source feeding two chains: 'city' is a low traffic hum with
// a slow wobble, 'coast' is waves (a lowpass that swells at 0.075 Hz). Both are
// built together once; switching is a crossfade of two gains only.
function buildAmbient() {
  const src = context.createBufferSource();
  src.buffer = noiseBuffer();
  src.loop = true;

  const cityLp = context.createBiquadFilter();
  cityLp.type = 'lowpass';
  cityLp.frequency.value = 300;
  cityLp.Q.value = 0.6;
  const cityWob = context.createGain();
  cityWob.gain.value = 0.8;
  const cityLfo = context.createOscillator();
  cityLfo.type = 'sine';
  cityLfo.frequency.value = 0.11;
  const cityLfoAmt = context.createGain();
  cityLfoAmt.gain.value = 0.22;
  cityLfo.connect(cityLfoAmt);
  cityLfoAmt.connect(cityWob.gain);
  const cityGain = context.createGain();
  cityGain.gain.value = 0;

  const coastLp = context.createBiquadFilter();
  coastLp.type = 'lowpass';
  coastLp.frequency.value = 620;
  coastLp.Q.value = 0.9;
  const coastSw = context.createGain();
  coastSw.gain.value = 0.65;
  const coastLfo = context.createOscillator();
  coastLfo.type = 'sine';
  coastLfo.frequency.value = 0.075;
  const coastSweep = context.createGain();
  coastSweep.gain.value = 380;
  const coastAmp = context.createGain();
  coastAmp.gain.value = 0.33;
  coastLfo.connect(coastSweep);
  coastSweep.connect(coastLp.frequency);
  coastLfo.connect(coastAmp);
  coastAmp.connect(coastSw.gain);
  const coastGain = context.createGain();
  coastGain.gain.value = 0;

  src.connect(cityLp);
  cityLp.connect(cityWob);
  cityWob.connect(cityGain);
  cityGain.connect(master);
  src.connect(coastLp);
  coastLp.connect(coastSw);
  coastSw.connect(coastGain);
  coastGain.connect(master);
  src.start();
  cityLfo.start();
  coastLfo.start();
  ambient = { cityGain, coastGain };
  stats.ambientBuilds += 1;
}

export function setAmbient(kind) {
  if (!context) return;
  try {
    const k = kind === 'coast' ? 'coast' : kind === 'city' ? 'city' : 'off';
    if (!ambient) {
      if (k === 'off') return; // nothing built yet, nothing to fade
      buildAmbient();
    }
    if (k === ambientKind) return; // idempotent: same bed, no ramp, no rebuild
    ambientKind = k;
    const t = context.currentTime;
    ambient.cityGain.gain.setTargetAtTime(k === 'city' ? 0.05 : 0, t, 0.6);
    ambient.coastGain.gain.setTargetAtTime(k === 'coast' ? 0.065 : 0, t, 0.7);
  } catch {
    // Audio must never break the game.
  }
}

// --- Procedural driving music --------------------------------------------
// 92 bpm, four bars of Am-F-C-G, an eight-note bass and a sixteenth-note arp.
// Notes are scheduled on the WebAudio clock by whichever scheduler is active;
// each voice disconnects itself on 'ended', so a 30 s run leaks nothing.
function noteStats(whenMs) {
  stats.schedN += 1;
  stats.schedSum += whenMs;
  stats.schedSumSq += whenMs * whenMs;
  const abs = Math.abs(whenMs);
  if (abs > stats.schedMax) stats.schedMax = abs;
}

function voiceBass(freq, when) {
  const osc = context.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const lp = context.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  const g = context.createGain();
  const dur = STEP_DUR * 1.6;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(MUSIC.bassVol, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(lp);
  lp.connect(g);
  g.connect(music.bus);
  osc.start(when);
  osc.stop(when + dur + 0.02);
  osc.onended = () => {
    try {
      osc.disconnect();
      lp.disconnect();
      g.disconnect();
    } catch {
      // already gone
    }
  };
}

function voiceArp(freq, when) {
  const osc = context.createOscillator();
  osc.type = 'square';
  osc.frequency.value = freq;
  const g = context.createGain();
  const dur = STEP_DUR * 0.62;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(MUSIC.arpVol, when + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(g);
  g.connect(music.bus);
  osc.start(when);
  osc.stop(when + dur + 0.02);
  osc.onended = () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {
      // already gone
    }
  };
}

function scheduleStep(step, when) {
  const bar = Math.floor(step / MUSIC.stepsPerBar) % MUSIC.bars;
  const s = step % MUSIC.stepsPerBar;
  const root = ROOTS[bar];
  const b = BASS[s];
  if (b !== null && b !== undefined) {
    voiceBass(root * Math.pow(2, b / 12), when);
    stats.musicNotes += 1;
  }
  const a = ARP[s];
  if (a !== null && a !== undefined) {
    voiceArp(root * 2 * Math.pow(2, a / 12), when);
    stats.musicNotes += 1;
  }
}

// (A) Lookahead: a 25 ms timer schedules every 16th that falls inside the next
// 100 ms of audio-clock time, so note times are exact regardless of timer jitter.
function musicTickLookahead() {
  music.timer = null;
  if (!musicPlaying || musicMode !== 'lookahead' || !context || !music) return;
  const t0 = performance.now();
  try {
    if (context.state !== 'running') {
      // Suspended: skip ahead instead of firing a burst of late notes on resume.
      music.nextNoteTime = context.currentTime + MUSIC.lookahead;
    } else {
      let guard = 0;
      while (music.nextNoteTime < context.currentTime + MUSIC.lookahead && guard < 32) {
        noteStats((context.currentTime - music.nextNoteTime) * 1000);
        scheduleStep(music.step, music.nextNoteTime);
        music.nextNoteTime += STEP_DUR;
        music.step = (music.step + 1) % TOTAL_STEPS;
        guard += 1;
      }
    }
  } catch {
    // Audio must never break the game.
  }
  stats.musicTicks += 1;
  stats.musicMs += performance.now() - t0;
  try {
    music.timer = setTimeout(musicTickLookahead, MUSIC.timerMs);
  } catch {
    music.timer = null;
  }
}

// (B) Render-frame crossing: each frame fires every step whose time has passed,
// starting it immediately. Notes can only be as accurate as the frame rate.
function musicTickRaf() {
  music.raf = 0;
  if (!musicPlaying || musicMode !== 'raf' || !context || !music) return;
  const t0 = performance.now();
  try {
    if (context.state === 'running') {
      let guard = 0;
      while (context.currentTime >= music.nextNoteTime && guard < 8) {
        noteStats((context.currentTime - music.nextNoteTime) * 1000);
        scheduleStep(music.step, context.currentTime);
        music.nextNoteTime += STEP_DUR;
        music.step = (music.step + 1) % TOTAL_STEPS;
        guard += 1;
      }
      if (guard >= 8) music.nextNoteTime = context.currentTime + STEP_DUR;
    } else {
      music.nextNoteTime = context.currentTime + STEP_DUR;
    }
  } catch {
    // Audio must never break the game.
  }
  stats.musicTicks += 1;
  stats.musicMs += performance.now() - t0;
  music.raf = requestAnimationFrame(musicTickRaf);
}

function buildMusicBus() {
  const bus = context.createGain();
  bus.gain.value = 0;
  bus.connect(master);
  music = { bus, step: 0, nextNoteTime: 0, timer: null, raf: 0 };
  stats.musicBuilds += 1;
}

function startMusic() {
  if (musicPlaying || !context) return;
  if (!music) buildMusicBus();
  musicPlaying = true;
  stats.musicStarts += 1;
  music.step = 0;
  music.nextNoteTime = context.currentTime + 0.06;
  try {
    music.bus.gain.setTargetAtTime(MUSIC.busVol, context.currentTime, 0.12);
  } catch {
    music.bus.gain.value = MUSIC.busVol;
  }
  if (musicMode === 'raf') music.raf = requestAnimationFrame(musicTickRaf);
  else music.timer = setTimeout(musicTickLookahead, MUSIC.timerMs);
}

function stopMusic() {
  if (!musicPlaying) return;
  musicPlaying = false;
  if (music && music.timer) {
    try {
      clearTimeout(music.timer);
    } catch {
      // ignore
    }
    music.timer = null;
  }
  if (music && music.raf) {
    try {
      cancelAnimationFrame(music.raf);
    } catch {
      // ignore
    }
    music.raf = 0;
  }
  try {
    if (music) music.bus.gain.setTargetAtTime(0, context.currentTime, 0.05);
  } catch {
    // Audio must never break the game.
  }
}

function applyMusic() {
  const want = musicWanted && musicAllowed;
  if (want) startMusic();
  else stopMusic();
}

/** Music on/off. Safe every frame: only the edge between on and off does work. */
export function setMusic(on) {
  const want = !!on;
  if (want === musicWanted) return;
  musicWanted = want;
  try {
    applyMusic();
  } catch {
    // Audio must never break the game.
  }
}

// --- One-shots -------------------------------------------------------------
function blip(freq, dur, type = 'sine', vol = 0.2, when = 0) {
  if (!live()) return;
  try {
    const t = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = context.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    // Release the two nodes once the note is over: a stopped oscillator that stays
    // connected keeps its gain node alive, so hundreds of shots would accumulate.
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // already gone
      }
    };
  } catch {
    // Audio must never break the game.
  }
}

/** A burst of the cached noise buffer through one biquad, with a gain envelope. */
function noiseBurst(dur, type, freq, vol, when = 0, sweepTo = 0) {
  if (!live()) return;
  try {
    const t = context.currentTime + when;
    const buf = noiseBuffer();
    const src = context.createBufferSource();
    src.buffer = buf;
    const maxOff = Math.max(0, buf.duration - dur - 0.02);
    const off = Math.random() * maxOff;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    if (sweepTo > 0) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const gain = context.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    src.start(t, off, dur + 0.02);
    src.stop(t + dur + 0.02);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // already gone
      }
    };
  } catch {
    // Audio must never break the game.
  }
}

/** Short vocal-ish formant blip: a saw glide through two resonant bandpasses. */
function scream() {
  if (!live()) return;
  try {
    const t = context.currentTime;
    const osc = context.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(760, t + 0.07);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.25);
    const f1 = context.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 900;
    f1.Q.value = 3.5;
    const f2 = context.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2400;
    f2.Q.value = 5;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.27);
    osc.connect(f1);
    osc.connect(f2);
    f1.connect(gain);
    f2.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + 0.29);
    osc.onended = () => {
      try {
        osc.disconnect();
        f1.disconnect();
        f2.disconnect();
        gain.disconnect();
      } catch {
        // already gone
      }
    };
  } catch {
    // Audio must never break the game.
  }
}

export function sfx(name) {
  if (!live()) return;
  try {
    if (name === 'gunshot') {
      // A burst of filtered noise, over in a tenth of a second.
      const len = Math.floor(context.sampleRate * 0.14);
      const buf = context.createBuffer(1, len, context.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = context.createBufferSource();
      src.buffer = buf;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2400;
      const gain = context.createGain();
      gain.gain.value = 0.5;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      src.start();
      src.onended = () => {
        try {
          src.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {
          // already gone
        }
      };
      blip(140, 0.1, 'square', 0.18);
    } else if (name === 'pickup') {
      blip(880, 0.09);
      blip(1318, 0.14, 'sine', 0.2, 0.08);
    } else if (name === 'jingle') {
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.16, 'sine', 0.22, i * 0.11));
    } else if (name === 'jingle2') {
      // Second mission sting: a minor falling line that climbs back — triangle,
      // a different contour and register from 'jingle' so the two never read alike.
      [659, 587, 523, 440, 587, 880].forEach((f, i) => blip(f, 0.15, 'triangle', 0.2, i * 0.13));
    } else if (name === 'click') {
      blip(1200, 0.04, 'square', 0.08);
    } else if (name === 'punch') {
      blip(120, 0.12, 'sine', 0.3);
      blip(70, 0.14, 'sine', 0.25, 0.02);
    } else if (name === 'busted') {
      [392, 330, 262].forEach((f, i) => blip(f, 0.22, 'triangle', 0.2, i * 0.16));
    } else if (name === 'wasted') {
      // main.js calls this on death; v4 had no case for it, so it was silent.
      [294, 262, 220, 165].forEach((f, i) => blip(f, 0.3, 'sine', 0.22, i * 0.18));
    } else if (name === 'reload') {
      blip(500, 0.05, 'square', 0.1);
      blip(700, 0.05, 'square', 0.1, 0.12);
    } else if (name === 'heli') {
      // Rotor thump: two low noise chops with a sub under them.
      noiseBurst(0.15, 'lowpass', 300, 0.34);
      blip(58, 0.15, 'sine', 0.28);
      noiseBurst(0.15, 'lowpass', 300, 0.3, 0.13);
      blip(58, 0.15, 'sine', 0.24, 0.13);
    } else if (name === 'smg') {
      // Short and bright — faster and higher than the pistol.
      noiseBurst(0.05, 'highpass', 1100, 0.3);
      blip(300, 0.045, 'square', 0.13);
      blip(980, 0.03, 'square', 0.05);
    } else if (name === 'shotgun') {
      // Low boom with a long noise tail sweeping down.
      noiseBurst(0.42, 'lowpass', 1700, 0.5, 0, 170);
      blip(52, 0.34, 'sine', 0.4);
      blip(78, 0.2, 'triangle', 0.24, 0.01);
    } else if (name === 'taxi') {
      // Two-tone fare chime.
      blip(988, 0.12, 'triangle', 0.2);
      blip(1319, 0.2, 'triangle', 0.2, 0.11);
    } else if (name === 'scream') {
      scream();
    }
  } catch {
    // Audio must never break the game.
  }
}

// --- Harness-only introspection. Nothing in the game calls these. ----------
export function __audioStats(reset) {
  const s = {
    contexts: context ? 1 : 0,
    state: context ? context.state : 'none',
    heliBuilds: stats.heliBuilds,
    ambientBuilds: stats.ambientBuilds,
    musicBuilds: stats.musicBuilds,
    musicStarts: stats.musicStarts,
    musicNotes: stats.musicNotes,
    musicTicks: stats.musicTicks,
    musicMs: stats.musicMs,
    musicPlaying,
    musicMode,
    ambientKind,
    volume,
    muted,
    schedN: stats.schedN,
    schedMean: stats.schedN ? stats.schedSum / stats.schedN : 0,
    schedSd: stats.schedN
      ? Math.sqrt(Math.max(0, stats.schedSumSq / stats.schedN - (stats.schedSum / stats.schedN) ** 2))
      : 0,
    schedMax: stats.schedMax,
  };
  if (reset) {
    stats.musicNotes = 0;
    stats.musicTicks = 0;
    stats.musicMs = 0;
    stats.schedN = 0;
    stats.schedSum = 0;
    stats.schedSumSq = 0;
    stats.schedMax = 0;
  }
  return s;
}

export function __musicScheduler(mode) {
  if (mode !== 'lookahead' && mode !== 'raf') return musicMode;
  try {
    const was = musicPlaying;
    stopMusic();
    musicMode = mode;
    if (was) startMusic();
  } catch {
    // ignore
  }
  return musicMode;
}
