// Title-screen save slots: three chips injected into the existing title card, so
// index.html (an in-text file this round may not edit) stays byte-for-byte as it was.
//
// The chips are only a view over save.js's slot bookkeeping: clicking one makes that
// slot the one readSave()/writeSave() use, so Continue loads that record and New Game
// writes into it. Nothing here invents a save; the money and mission on a chip come
// from the record itself. Continue's disabled state follows the selected slot, which
// main.js sets only once at boot (and would otherwise leave enabled for an empty slot,
// because readSave() returns a live view rather than a snapshot).
const LABEL_EMPTY = 'empty';
const STYLE_ID = 'slot-chips-style';

function money(value) {
  const n = Math.max(0, Math.round(value));
  return `$${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

// Everything is scoped under #slot-chips so it outranks `.card button` in index.html's
// stylesheet without touching that file.
function styleOnce() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    '#slot-chips{margin:14px 0 2px;display:flex;gap:8px;justify-content:stretch;}',
    '#slot-chips .slot-chip{pointer-events:auto;flex:1 1 0;min-width:0;margin:0;padding:8px 10px;',
    'border-radius:8px;border:1px solid rgba(255,255,255,.24);background:rgba(255,255,255,.05);',
    'color:#c9d4de;text-align:left;font-family:inherit;font-weight:400;font-size:14px;cursor:pointer;}',
    '#slot-chips .slot-name{display:block;font-size:15px;font-weight:700;letter-spacing:.08em;color:#eef1f5;}',
    '#slot-chips .slot-meta{display:block;font-size:14px;font-variant-numeric:tabular-nums;color:#9fb4c8;margin-top:2px;}',
    '#slot-chips .slot-chip[aria-pressed="true"]{border-color:#ffe9a8;background:#ffc93c;color:#14181f;}',
    '#slot-chips .slot-chip[aria-pressed="true"] .slot-name,',
    '#slot-chips .slot-chip[aria-pressed="true"] .slot-meta{color:#14181f;}',
    '#slot-chips .slot-chip[data-saved="false"] .slot-meta{color:#8b93a3;font-style:italic;}',
    '#slot-chips .slot-chip:focus-visible{outline:2px solid #ffc93c;outline-offset:2px;}',
  ].join('');
  document.head.appendChild(style);
}

export function installSlots(slots) {
  if (typeof document === 'undefined') return;
  const card = document.querySelector('#screen-title .card');
  const btnNew = document.getElementById('btn-new');
  const btnContinue = document.getElementById('btn-continue');
  if (!card || !btnNew || !btnContinue) {
    // Continue's disabled state is only correct once these chips exist, so try again
    // after parsing if this module ever runs ahead of the page.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => installSlots(slots), { once: true });
    }
    return;
  }
  styleOnce();

  const row = document.createElement('div');
  row.id = 'slot-chips';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Save slots');
  const buttons = [];

  function render() {
    const active = slots.getActive();
    for (const button of buttons) {
      const slot = Number(button.dataset.slot);
      const info = slots.info(slot);
      const picked = slot === active;
      button.dataset.saved = info.saved ? 'true' : 'false';
      button.setAttribute('aria-pressed', picked ? 'true' : 'false');
      if (picked) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
      const meta = button.querySelector('.slot-meta');
      if (info.saved) {
        const cash = money(info.money === null ? 0 : info.money);
        meta.textContent = `${cash} \u00b7 ${info.mission || 'in progress'}`;
        button.title = `Slot ${slot}: ${cash}, ${info.mission || 'in progress'}`;
      } else {
        meta.textContent = LABEL_EMPTY;
        button.title = `Slot ${slot}: empty`;
      }
    }
    const want = !slots.info(active).saved;
    if (btnContinue.disabled !== want) btnContinue.disabled = want;
  }

  for (let slot = 1; slot <= slots.count; slot += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot-chip';
    button.dataset.slot = String(slot);
    const name = document.createElement('span');
    name.className = 'slot-name';
    name.textContent = `SLOT ${slot}`;
    const meta = document.createElement('span');
    meta.className = 'slot-meta';
    button.append(name, meta);
    button.addEventListener('click', () => {
      slots.setActive(slot);
      render();
    });
    buttons.push(button);
    row.appendChild(button);
  }

  card.insertBefore(row, btnNew);

  // main.js computes Continue's state once at boot — after the city is built, so about a
  // second after these chips are inserted — and readSave() hands it a live view rather
  // than a snapshot, so that one assignment always reads as "there is a save". The chips
  // therefore own the button and re-assert it whenever main.js writes, instead of racing
  // it once and losing.
  function syncContinue() {
    const want = !slots.info(slots.getActive()).saved;
    // Writing the same value back would re-enter the observer forever.
    if (btnContinue.disabled !== want) btnContinue.disabled = want;
  }
  render();
  new MutationObserver(syncContinue).observe(btnContinue, {
    attributes: true, attributeFilter: ['disabled'],
  });
  window.addEventListener('focus', render);
  document.addEventListener('visibilitychange', render);
}
