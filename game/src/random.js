// A small seeded random number generator (mulberry32): the same seed gives the same game,
// which is what makes the screenshot scenes repeatable.
//
// `createRandom` is frozen: the exact sequence it emits is baked into the screenshots, so
// the arithmetic below must not change. Everything else here is additive sugar that takes
// the generator as an argument — no shared state, so helpers never disturb a caller's stream.

export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Float in [lo, hi). Degenerate or inverted bounds yield `lo` (never NaN). */
export function randRange(random, lo, hi) {
  if (!(hi > lo)) return lo;
  return lo + random() * (hi - lo);
}

/** Integer in [lo, hi] inclusive. */
export function randInt(random, lo, hi) {
  const a = Math.ceil(Math.min(lo, hi));
  const b = Math.floor(Math.max(lo, hi));
  if (b < a) return a;
  return a + Math.floor(random() * (b - a + 1));
}

/** Uniform element of a non-empty array, else undefined. */
export function pick(random, array) {
  if (!array || !array.length) return undefined;
  return array[Math.floor(random() * array.length)];
}

/** Fisher-Yates on a copy: the input array is never mutated. */
export function shuffle(random, array) {
  const out = Array.isArray(array) ? array.slice() : [];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
