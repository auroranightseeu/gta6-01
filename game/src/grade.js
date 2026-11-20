// Cheap warm grade: one static 2D overlay over the canvas — a warm wash in the middle and a
// brown vignette in the corners. No render target, no extra full-screen shader pass, so it
// costs nothing per frame and lands in every screenshot.
const ID = 'solmar-grade';
const LAYER = 'radial-gradient(115% 95% at 50% 46%,'
  + ' rgba(255,198,132,.05) 0%, rgba(255,158,88,.10) 58%, rgba(74,28,10,.36) 100%)';

export function applyGrade(renderer) {
  if (typeof document === 'undefined') return null;
  const canvas = (renderer && (renderer.gl || renderer).domElement) || null;
  if (!canvas || !canvas.parentNode) return null;

  let el = document.getElementById(ID);
  if (el && el.parentNode === canvas.parentNode) return el;
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
  }
  Object.assign(el.style, {
    position: 'fixed', inset: '0', pointerEvents: 'none', background: LAYER,
  });
  // Sits right after the canvas: same stacking level as the HUD, so DOM order keeps the grade
  // over the 3D frame and under the HUD text. A positive z-index would tint the HUD too.
  canvas.parentNode.insertBefore(el, canvas.nextSibling);
  return el;
}
