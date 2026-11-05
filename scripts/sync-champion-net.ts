/**
 * Copies the current champion net into the site's public assets.
 *
 *   npx tsx scripts/sync-champion-net.ts [sourceNet]
 *
 * Run after every gate a new net wins (the 80-game v3base match). The file
 * is committed, so GitHub Pages builds ship the net without any CI secrets.
 */

import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const src = process.argv[2] ?? 'data/nnue-v1.bin';
const dst = join('public', 'nnue-v1.bin');

if (!existsSync(src)) {
  console.error(`no net at ${src} — nothing to sync`);
  process.exit(1);
}
copyFileSync(src, dst);
const bytes = readFileSync(dst);
const sha = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
console.log(`synced ${dst}: ${(statSync(dst).size / 1024).toFixed(0)}KB  sha256:${sha}`);
