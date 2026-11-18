// Sound stub for v1: opens the WebAudio context on the first user gesture so later
// slices can play synthesised effects (engine, siren, pickup) with no audio files.
// Nothing here makes a sound yet, and the game never waits on audio.
let context = null;

export function ensureAudio() {
  if (context) {
    if (context.state === 'suspended') context.resume().catch(() => {});
    return context;
  }
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
  } catch {
    context = null;
  }
  return context;
}

export function audioReady() {
  return context !== null && context.state === 'running';
}
