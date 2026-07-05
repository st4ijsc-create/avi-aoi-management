#!/usr/bin/env node
/**
 * Fetch the Vietnamese-capable PDF fonts (Be Vietnam Pro, SIL OFL 1.1) into
 * server/assets/fonts/. Idempotent — skips files that already exist and verify
 * as valid TrueType. Run this on a fresh checkout if the .ttf binaries are
 * missing (the server's PDF engine fails loudly without them).
 *
 *   node scripts/fetch-fonts.mjs
 *
 * Source: https://github.com/google/fonts/tree/main/ofl/bevietnampro (OFL 1.1)
 * Alternative VN-capable font: Noto Sans (notofonts/latin-greek-cyrillic).
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, "..", "server", "assets", "fonts");
const BASE = "https://github.com/google/fonts/raw/main/ofl/bevietnampro";

const ASSETS = [
  { name: "BeVietnamPro-Regular.ttf", url: `${BASE}/BeVietnamPro-Regular.ttf`, minBytes: 50_000 },
  { name: "BeVietnamPro-Bold.ttf", url: `${BASE}/BeVietnamPro-Bold.ttf`, minBytes: 50_000 },
  { name: "OFL.txt", url: `${BASE}/OFL.txt`, minBytes: 1_000 },
];

// TrueType magic numbers: 0x00010000 (TTF) or 'true'/'OTTO' (some variants).
function looksLikeFont(path) {
  try {
    const buf = readFileSync(path);
    if (buf.length < 4) return false;
    const sig = buf.readUInt32BE(0);
    return sig === 0x00010000 || sig === 0x74727565 /* true */ || sig === 0x4f54544f /* OTTO */;
  } catch {
    return false;
  }
}

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  mkdirSync(FONT_DIR, { recursive: true });
  let fetched = 0;
  for (const asset of ASSETS) {
    const dest = join(FONT_DIR, asset.name);
    const isFont = asset.name.endsWith(".ttf");
    const ok = existsSync(dest) && statSync(dest).size >= asset.minBytes && (!isFont || looksLikeFont(dest));
    if (ok) {
      console.log(`✓ ${asset.name} present`);
      continue;
    }
    process.stdout.write(`↓ ${asset.name} … `);
    const buf = await download(asset.url);
    if (buf.length < asset.minBytes) throw new Error(`${asset.name}: got ${buf.length} bytes (< ${asset.minBytes})`);
    writeFileSync(dest, buf);
    if (isFont && !looksLikeFont(dest)) throw new Error(`${asset.name}: downloaded file is not a valid TrueType font`);
    console.log(`ok (${buf.length} bytes)`);
    fetched++;
  }
  console.log(fetched ? `\nDone — fetched ${fetched} file(s) into ${FONT_DIR}` : "\nAll font assets already present.");
}

main().catch((err) => {
  console.error(`\n[fetch-fonts] FAILED: ${err.message}`);
  process.exit(1);
});
