// A working gta6-01 entry (Node 22, standard library only): the game is this directory's
// game/ folder, plain static files a desktop browser loads offline (game/index.html and its ES
// modules, three.js vendored under game/vendor/, no network request), and the program hands it
// in. It copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
// The game itself is Solmar, an original open-world crime game: Rio Vega explores a seeded
// procedural grid city on foot and by car (three.js, arcade driving, traffic, pedestrians,
// a HUD with minimap and wanted stars, a mission marker, start/pause/game-over screens and
// saves), built to replace the kit's 2D Block Dodger starter in the v1 slice.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';
import { readdirSync, statSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fail fast, and clearly, when the inputs this entry hands the judge are not there. Without this
// the copy below would silently ship an empty game/ and the judge would read a broken dossier.
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']);

function fail(message) {
  process.stderr.write(`main.ts: ${message}\n`);
  process.exit(1);
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

const gameDir = join(here, 'game');
const gameIndex = join(gameDir, 'index.html');
const shotsDir = join(here, 'screenshots');

if (!isDir(gameDir)) {
  fail(`game/ directory is missing at ${gameDir}`);
}
if (!existsSync(gameIndex) || !statSync(gameIndex).isFile()) {
  fail(`game/index.html is missing at ${gameIndex}`);
}
if (!isDir(shotsDir)) {
  fail(`screenshots/ directory is missing at ${shotsDir}`);
}

const images = readdirSync(shotsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && IMAGE_EXT.has(entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase()))
  .map((entry) => entry.name)
  .sort();

if (images.length === 0) {
  fail(`screenshots/ has no image files (looked for ${[...IMAGE_EXT].join(', ')}) in ${shotsDir}`);
}

process.stdout.write(`main.ts: input check ok - game/index.html present, ${images.length} screenshot(s): ${images.join(', ')}\n`);

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Say plainly what landed in the output dir, so a silent partial copy is visible in the log.
function countFiles(dir) {
  let files = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files += 1;
  }
  return files;
}

process.stdout.write(`main.ts: copied game/ (${countFiles(join(out, 'game'))} file(s)) and screenshots/ (${countFiles(join(out, 'screenshots'))} image(s)) to ${out}\n`);

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
