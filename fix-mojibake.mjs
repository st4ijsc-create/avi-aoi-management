// Fix UTF-8 mojibake (originally CP1252-decoded then re-encoded UTF-8) in source files.
// Usage:
//   node fix-mojibake.mjs            # dry-run, lists candidates
//   node fix-mojibake.mjs --apply    # rewrites files in place

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const TARGETS = ['client/src', 'server', 'shared'];
const EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.md']);

// CP1252 codepoints for bytes 0x80..0x9F (rest 0xA0..0xFF == latin1)
const CP1252_HIGH = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F,
};

function strToCp1252Bytes(str) {
  const out = Buffer.alloc(Buffer.byteLength(str, 'utf8') * 2);
  let p = 0;
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0xFF) {
      out[p++] = cp;
    } else if (CP1252_HIGH[cp] !== undefined) {
      out[p++] = CP1252_HIGH[cp];
    } else {
      // Non-mappable codepoint (e.g., BOM U+FEFF). Preserve as its raw UTF-8 bytes.
      const enc = Buffer.from(ch, 'utf8');
      enc.copy(out, p);
      p += enc.length;
    }
  }
  return out.subarray(0, p);
}

const MOJIBAKE_MARKERS = /Ã|Æ°|Ä‘|á»|â€|ðŸ|Â|â„|â–|â—|â˜|âš|âœ|âž/;

function tryFix(content) {
  const buf = strToCp1252Bytes(content);
  const decoded = buf.toString('utf8');
  const origRepl = (content.match(/\uFFFD/g) || []).length;
  const newRepl = (decoded.match(/\uFFFD/g) || []).length;
  if (newRepl > origRepl + 2) return null;
  const origM = (content.match(/Ã|Æ|á»|â€|ðŸ|Â/g) || []).length;
  const newM = (decoded.match(/Ã|Æ|á»|â€|ðŸ|Â/g) || []).length;
  if (newM >= origM) return null;
  return decoded;
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (EXTS.has(path.extname(entry.name))) files.push(p);
  }
}
for (const t of TARGETS) {
  const abs = path.join(ROOT, t);
  if (fs.existsSync(abs)) walk(abs);
}

let fixed = 0, skipped = 0, scanned = 0;
const fixedList = [];
for (const file of files) {
  scanned++;
  const content = fs.readFileSync(file, 'utf8');
  if (!MOJIBAKE_MARKERS.test(content)) { skipped++; continue; }
  const decoded = tryFix(content);
  if (!decoded) { skipped++; continue; }
  fixed++;
  fixedList.push(path.relative(ROOT, file));
  if (APPLY) {
    fs.writeFileSync(file, decoded, 'utf8');
  }
}

console.log(`Scanned: ${scanned}`);
console.log(`Would-fix: ${fixed}`);
console.log(`Skipped: ${skipped}`);
console.log(`Mode: ${APPLY ? 'APPLY (files rewritten)' : 'DRY-RUN'}`);
if (fixedList.length) {
  console.log('\nFiles:');
  for (const f of fixedList.slice(0, 200)) console.log('  ' + f);
  if (fixedList.length > 200) console.log(`  ... and ${fixedList.length - 200} more`);
}
