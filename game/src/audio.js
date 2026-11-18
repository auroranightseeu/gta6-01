// Sound, synthesised with WebAudio only — no audio files, no network. Engine hum
// (pitch follows speed), a two-tone siren while wanted, gunshot, pickup chime,
// mission jingle, punch thud, UI click. Everything is guarded: if the context is
// suspended (headless) or missing, every call is a silent no-op and the game plays on.
let context = null;
let master = null;
let engine = null;
let siren = null;
let muted = false;

function live() {
  return context !== null && context.state === 'running' && !muted;
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
    master.gain.value = 0.5;
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
  } catch {
    context = null;
    master = null;
    engine = null;
    siren = null;
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
  if (master && context) master.gain.value = muted ? 0 : 0.5;
  return muted;
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
      blip(140, 0.1, 'square', 0.18);
    } else if (name === 'pickup') {
      blip(880, 0.09);
      blip(1318, 0.14, 'sine', 0.2, 0.08);
    } else if (name === 'jingle') {
      [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.16, 'sine', 0.22, i * 0.11));
    } else if (name === 'click') {
      blip(1200, 0.04, 'square', 0.08);
    } else if (name === 'punch') {
      blip(120, 0.12, 'sine', 0.3);
      blip(70, 0.14, 'sine', 0.25, 0.02);
    } else if (name === 'busted') {
      [392, 330, 262].forEach((f, i) => blip(f, 0.22, 'triangle', 0.2, i * 0.16));
    } else if (name === 'reload') {
      blip(500, 0.05, 'square', 0.1);
      blip(700, 0.05, 'square', 0.1, 0.12);
    }
  } catch {
    // Audio must never break the game.
  }
}
