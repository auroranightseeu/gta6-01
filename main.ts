// main.ts — hands the game in: `node main.ts`
//
// Copies game/ and screenshots/ from this repository into the output directory and writes
// dossier.json there with buildDossier from vendor/makefun-game.ts, the kit's own copy. The
// scorer runs that same library over the copied game/ and screenshots/ and compares its bytes
// with ours, so nothing here shapes the dossier itself.
//
// The output directory is $MAKEFUN_OUTPUT_DIR, or ./out when that is unset.

import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** This repository, wherever it is checked out. */
const ROOT = fileURLToPath(new URL('.', import.meta.url));
/** Where the entry lands: the grader's /output, or $MAKEFUN_OUTPUT_DIR, or ./out. */
const OUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ? resolve(process.env.MAKEFUN_OUTPUT_DIR) : join(ROOT, 'out');
const DOSSIER = join(OUT_DIR, 'dossier.json');

/**
 * The scorer's own caps (its gate.json), passed through so this program refuses exactly what the
 * gate refuses. Only text_max_bytes shapes the dossier's bytes; the rest bound what it accepts.
 */
const CAPS = {
  text_max_bytes: 163_840,
  screenshots: { max: 4, max_bytes: 262_144 },
  game_max_files: 993,
  game_max_bytes: 50_331_648,
  game_path_max_bytes: 1_000,
};

/** Copy one of this repository's directories into the output, replacing what was there. */
function handIn(name) {
  const to = join(OUT_DIR, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(join(ROOT, name), to, { recursive: true });
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  handIn('game');
  handIn('screenshots');

  const dossier = buildDossier(OUT_DIR, CAPS);
  writeFileSync(DOSSIER, dossier);

  console.log(`dossier: ${DOSSIER} (${dossier.length} bytes)`);
}

try {
  main();
} catch (err) {
  console.error(`main.ts: ${err.message}`);
  process.exit(1);
}
