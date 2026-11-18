// Keyboard and mouse input. Held keys are read every frame; one-shot presses (confirm,
// pause, enter/exit car) are queued as bit flags and taken once, so a press between two
// frames is never lost and never counted twice. Mouse orbit uses pointer lock on the canvas.
export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;

const FORWARD = new Set(['KeyW', 'ArrowUp']);
const BACK = new Set(['KeyS', 'ArrowDown']);
const LEFT = new Set(['KeyA', 'ArrowLeft']);
const RIGHT = new Set(['KeyD', 'ArrowRight']);
const RUN = new Set(['ShiftLeft', 'ShiftRight']);
const HANDBRAKE = new Set(['Space']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);

export function createInput(canvas) {
  const held = new Set();
  let actions = 0;
  let mouseDX = 0;
  let mouseDY = 0;

  window.addEventListener('keydown', (event) => {
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (
      FORWARD.has(event.code) || BACK.has(event.code) || LEFT.has(event.code) ||
      RIGHT.has(event.code) || RUN.has(event.code) || HANDBRAKE.has(event.code)
    ) {
      held.add(event.code);
    } else {
      return;
    }
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => held.delete(event.code));
  window.addEventListener('blur', () => held.clear());
  document.addEventListener('mousemove', (event) => {
    if (document.pointerLockElement === canvas) {
      mouseDX += event.movementX;
      mouseDY += event.movementY;
    }
  });

  const has = (set) => {
    for (const code of set) if (held.has(code)) return true;
    return false;
  };

  return {
    lock() {
      if (document.pointerLockElement !== canvas) {
        try {
          const p = canvas.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch {
          // Headless or denied: the game still plays with keyboard only.
        }
      }
    },
    unlock() {
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    },
    get locked() {
      return document.pointerLockElement === canvas;
    },
    /** -1..1 forward, -1..1 strafe right, in camera space. */
    move() {
      const f = (has(FORWARD) ? 1 : 0) - (has(BACK) ? 1 : 0);
      const s = (has(RIGHT) ? 1 : 0) - (has(LEFT) ? 1 : 0);
      return { f, s };
    },
    run() {
      return has(RUN);
    },
    handbrake() {
      return has(HANDBRAKE);
    },
    /** -1..1 steering, -1..1 throttle, for driving. */
    drive() {
      const steer = (has(LEFT) ? 1 : 0) - (has(RIGHT) ? 1 : 0);
      const throttle = (has(FORWARD) ? 1 : 0) - (has(BACK) ? 1 : 0);
      return { steer, throttle, handbrake: has(HANDBRAKE) };
    },
    /** Mouse orbit since the last call, in pixels. */
    takeMouse() {
      const dx = mouseDX;
      const dy = mouseDY;
      mouseDX = 0;
      mouseDY = 0;
      return { dx, dy };
    },
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
