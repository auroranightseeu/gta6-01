// main.ts — builds the game dossier: `node main.ts`
//
// Reads the shipped game/ directory (index.html plus every file under src/), embeds the
// screenshots as a contact sheet, and outlines the source with a hard byte cap. Everything
// is inlined into one self-contained HTML file, so the dossier needs no network at all.
// Output goes to $MAKEFUN_OUTPUT_DIR, or ./out/ when that is unset.

import * as fs from 'node:fs';
import * as path from 'node:path';

const SOURCE_CAP_BYTES = 163_840;
const ROOT = process.cwd();
const GAME_DIR = path.join(ROOT, 'game');
const SHOTS_DIR = path.join(ROOT, 'screenshots');
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR || path.join(ROOT, 'out');
const OUT_FILE = path.join(OUT_DIR, 'dossier.html');

const TITLE = 'gta6-01';
const TAGLINE = 'A compact open-city action game: missions, driving, gunplay and a living street.';

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function listFiles(dir, prefix, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) listFiles(abs, rel, acc);
    else if (entry.isFile()) acc.push(abs);
  }
}

function readSources() {
  const abs = [];
  const indexHtml = path.join(GAME_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) abs.push(indexHtml);
  listFiles(path.join(GAME_DIR, 'src'), 'src', abs);

  const files = [];
  for (const file of abs) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(GAME_DIR, file).split(path.sep).join('/');
    files.push({
      rel,
      bytes: Buffer.byteLength(text, 'utf8'),
      lines: text.split('\n').length,
      text,
    });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

function humanize(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/^[0-9]+[-_]/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function readShots() {
  let names = [];
  try {
    names = fs
      .readdirSync(SHOTS_DIR)
      .filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  } catch {
    return [];
  }
  return names.map((name) => {
    const abs = path.join(SHOTS_DIR, name);
    const buf = fs.readFileSync(abs);
    return {
      name,
      caption: humanize(name),
      bytes: buf.length,
      mime: mimeFor(name),
      data: buf.toString('base64'),
    };
  });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
}

function coverHtml(files, shots) {
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const totalLines = files.reduce((sum, f) => sum + f.lines, 0);
  const when = new Date().toISOString().slice(0, 10);
  return `<header class="cover">
  <p class="eyebrow">Game dossier</p>
  <h1>${escapeHtml(TITLE)}</h1>
  <p class="tagline">${escapeHtml(TAGLINE)}</p>
  <ul class="stats">
    <li><strong>${files.length}</strong> source files</li>
    <li><strong>${totalLines.toLocaleString('en-US')}</strong> lines</li>
    <li><strong>${formatBytes(totalBytes)}</strong> of source</li>
    <li><strong>${shots.length}</strong> screenshots</li>
    <li>built ${escapeHtml(when)}</li>
  </ul>
</header>`;
}

function contactSheetHtml(shots) {
  if (shots.length === 0) {
    return `<section id="shots"><h2>Contact sheet</h2><p class="note">No screenshots were found next to the game directory.</p></section>`;
  }
  const figures = shots
    .map(
      (s, i) => `    <figure>
      <img alt="${escapeHtml(s.caption)}" src="data:${s.mime};base64,${s.data}">
      <figcaption><span class="num">${i + 1}</span>${escapeHtml(s.caption)}</figcaption>
    </figure>`,
    )
    .join('\n');
  return `<section id="shots">
  <h2>Contact sheet</h2>
  <div class="sheet">
${figures}
  </div>
</section>`;
}

/** Clip `text` so its HTML-escaped form fits in `maxBytes` of UTF-8, at a line break. */
function clipEscaped(text, maxBytes) {
  if (Buffer.byteLength(escapeHtml(text), 'utf8') <= maxBytes) return { text, clipped: false };
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const sized = Buffer.byteLength(escapeHtml(chars.slice(0, mid).join('')), 'utf8');
    if (sized <= maxBytes) lo = mid;
    else hi = mid - 1;
  }
  let out = chars.slice(0, lo).join('');
  const cut = out.lastIndexOf('\n');
  if (cut > out.length * 0.5) out = out.slice(0, cut + 1);
  return { text: out, clipped: true };
}

function sourceOutlineHtml(files) {
  const rows = files
    .map(
      (f) =>
        `      <tr><td><code>${escapeHtml(f.rel)}</code></td><td class="num">${f.bytes.toLocaleString('en-US')}</td><td class="num">${f.lines.toLocaleString('en-US')}</td></tr>`,
    )
    .join('\n');

  const head = (f) => `<article class="file">
  <h3><code>${escapeHtml(f.rel)}</code> <span class="meta">${f.lines.toLocaleString('en-US')} lines · ${formatBytes(f.bytes)}</span></h3>
  <pre><code>`;
  const tail = '</code></pre>\n</article>';
  const NOTE_ALLOWANCE = 200;

  // Split the cap fairly by escaped size: small files keep all their text, the rest share
  // what is left, so every file appears in the outline instead of whole files being dropped.
  const escapedBytes = files.map((f) => Buffer.byteLength(escapeHtml(f.text), 'utf8'));
  const overhead = files.reduce((sum, f) => sum + Buffer.byteLength(head(f) + tail, 'utf8') + NOTE_ALLOWANCE, 0);
  const budget = Math.max(0, SOURCE_CAP_BYTES - overhead);
  const shares = files.map(() => 0);
  let remaining = budget;
  let pending = files.map((_, i) => i);
  while (pending.length > 0) {
    const share = Math.floor(remaining / pending.length);
    const next = [];
    for (const i of pending) {
      if (escapedBytes[i] <= share) {
        shares[i] = escapedBytes[i];
        remaining -= escapedBytes[i];
      } else {
        next.push(i);
      }
    }
    if (next.length === pending.length) {
      for (const i of next) shares[i] = share;
      break;
    }
    pending = next;
  }

  const blocks = files.map((f, i) => {
    const { text, clipped } = clipEscaped(f.text, shares[i]);
    const note = clipped
      ? `\n<span class="cut">… ${formatBytes(shares[i])} of ${formatBytes(f.bytes)} shown (cap ${formatBytes(SOURCE_CAP_BYTES)} total)</span>`
      : '';
    return head(f) + escapeHtml(text) + note + tail;
  });

  return `<section id="source">
  <h2>Source outline</h2>
  <table class="files">
    <thead><tr><th>File</th><th class="num">Bytes</th><th class="num">Lines</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>
  <p class="note">Outline capped at ${formatBytes(SOURCE_CAP_BYTES)}; longer files are excerpted from the top.</p>
  <div class="files-body">
${blocks.join('\n')}
  </div>
</section>`;
}

function styleCss() {
  return `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 0 4rem;
  background: #0d1117; color: #d7dde5;
  font: 15px/1.6 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.cover, section { max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.cover { padding-top: 56px; padding-bottom: 28px; border-bottom: 1px solid #222b36; }
.eyebrow { margin: 0 0 6px; letter-spacing: .16em; text-transform: uppercase; font-size: 11px; color: #6f7f93; }
h1 { margin: 0; font-size: 44px; letter-spacing: -.02em; }
.tagline { margin: 10px 0 20px; color: #9daebf; max-width: 60ch; }
.stats { display: flex; flex-wrap: wrap; gap: 8px 20px; margin: 0; padding: 0; list-style: none; font-size: 13px; color: #8496a9; }
.stats strong { color: #e6edf3; }
h2 { margin: 44px 0 14px; font-size: 22px; letter-spacing: -.01em; }
.sheet { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
figure { margin: 0; background: #131a23; border: 1px solid #222b36; border-radius: 10px; overflow: hidden; }
figure img { display: block; width: 100%; height: auto; }
figcaption { padding: 10px 12px; font-size: 13px; color: #9daebf; }
.num { color: #5f7183; font-variant-numeric: tabular-nums; }
figcaption .num { margin-right: 8px; }
table.files { width: 100%; border-collapse: collapse; font-size: 13px; }
table.files th, table.files td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #1e2630; }
table.files th { color: #7d8fa1; font-weight: 600; }
table.files td.num, table.files th.num { text-align: right; font-variant-numeric: tabular-nums; }
.file { margin-top: 22px; }
.file h3 { margin: 0 0 8px; font-size: 14px; font-weight: 600; }
.file h3 .meta { margin-left: 8px; font-weight: 400; color: #6f7f93; font-size: 12px; }
pre { margin: 0; padding: 14px 16px; background: #0a0f16; border: 1px solid #1e2630; border-radius: 10px; overflow: auto; max-height: 520px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; color: #c8d4e0; }
.cut { display: block; margin-top: 8px; color: #7d8fa1; font-size: 12px; font-style: italic; }
.note { color: #8b9cad; font-size: 13px; }
footer { max-width: 1080px; margin: 48px auto 0; padding: 20px 24px 0; border-top: 1px solid #222b36; color: #5f7183; font-size: 12px; }
`.trim();
}

function render(files, shots) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(TITLE)} — dossier</title>
<style>
${styleCss()}
</style>
</head>
<body>
${coverHtml(files, shots)}
${contactSheetHtml(shots)}
${sourceOutlineHtml(files)}
<footer>
  <p>Built offline from <code>game/</code> by <code>main.ts</code>. No external resources.</p>
</footer>
</body>
</html>
`;
}

function main() {
  if (!fs.existsSync(GAME_DIR)) {
    console.error(`main.ts: game directory not found at ${GAME_DIR}`);
    process.exit(1);
  }

  const files = readSources();
  if (files.length === 0) {
    console.error('main.ts: game/ has no source files to outline');
    process.exit(1);
  }
  const shots = readShots();
  const html = render(files, shots);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');

  const bytes = Buffer.byteLength(html, 'utf8');
  console.log(
    `dossier: ${path.relative(ROOT, OUT_FILE)} (${formatBytes(bytes)}, ${files.length} files, ${shots.length} screenshots)`,
  );
  process.exit(0);
}

main();
