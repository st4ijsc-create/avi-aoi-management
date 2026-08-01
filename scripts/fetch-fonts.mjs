#!/usr/bin/env node
/**
 * Fetch the PDF fonts (all SIL OFL 1.1) into server/assets/fonts/. Idempotent —
 * skips files that already exist and verify as valid TrueType. Run this on a
 * fresh checkout if the .ttf binaries are missing (the server's PDF engine fails
 * loudly for Vietnamese without Be Vietnam Pro, and for Chinese without Noto
 * Sans SC).
 *
 *   node scripts/fetch-fonts.mjs
 *
 * Fonts:
 *   • Be Vietnam Pro (Regular+Bold, ~140 KB each) — Latin + full Vietnamese.
 *     Source: https://github.com/google/fonts/tree/main/ofl/bevietnampro
 *   • Noto Sans SC   (Regular+Bold, ~10 MB each)  — CJK ideographs (doc 48 R4).
 *     Source: static glyf TTFs from the @expo-google-fonts/noto-sans-sc package
 *     (the Google Fonts build is a variable font whose default master is Thin;
 *     the OTF/CFF Noto builds cannot be embedded by jsPDF — we need static glyf).
 *     These two files are LARGE (~20 MB total); they are fetched here rather than
 *     committed as raw git blobs. Commit via Git LFS if you want them in-repo.
 */
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(HERE, "..", "server", "assets", "fonts");
const BASE = "https://github.com/google/fonts/raw/main/ofl/bevietnampro";
// Static, Regular/Bold, glyf-outline Noto Sans SC (jsPDF-embeddable). Pinned.
const CJK_BASE = "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.4.3";
const NOTO_OFL = "https://github.com/google/fonts/raw/main/ofl/notosanssc/OFL.txt";

const ASSETS = [
  { name: "BeVietnamPro-Regular.ttf", url: `${BASE}/BeVietnamPro-Regular.ttf`, minBytes: 50_000 },
  { name: "BeVietnamPro-Bold.ttf", url: `${BASE}/BeVietnamPro-Bold.ttf`, minBytes: 50_000 },
  { name: "OFL.txt", url: `${BASE}/OFL.txt`, minBytes: 1_000 },
  { name: "NotoSansSC-Regular.ttf", url: `${CJK_BASE}/400Regular/NotoSansSC_400Regular.ttf`, minBytes: 5_000_000 },
  { name: "NotoSansSC-Bold.ttf", url: `${CJK_BASE}/700Bold/NotoSansSC_700Bold.ttf`, minBytes: 5_000_000 },
  { name: "NotoSansSC-OFL.txt", url: NOTO_OFL, minBytes: 1_000 },
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
