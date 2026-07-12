// Doc 42 A8 — so khớp placeholder {{var}} giữa en/vi/zh cho cùng key.
// Dùng: node scripts/i18n-check.mjs [repoRoot]  → exit 1 nếu có lệch (dùng cho CI).
// Không truyền argv → mặc định repoRoot = process.cwd() (chạy từ gốc repo).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || process.cwd();
const localeDir = path.join(root, 'client/src/i18n/locales');
const locales = ['en', 'vi', 'zh'];

const data = Object.fromEntries(
  locales.map((l) => [l, JSON.parse(readFileSync(path.join(localeDir, `${l}.json`), 'utf8'))]),
);

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else if (typeof v === 'string') out[key] = v;
  }
  return out;
}

const flat = Object.fromEntries(locales.map((l) => [l, flatten(data[l])]));

function placeholders(str) {
  return [...str.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

const allKeys = new Set(locales.flatMap((l) => Object.keys(flat[l])));
const mismatches = [];

for (const key of allKeys) {
  const present = locales.filter((l) => flat[l][key] !== undefined);
  if (present.length < 2) continue;
  // Bản "chuẩn" = union placeholder của mọi locale có key (bản gốc có var thắng)
  const perLocale = Object.fromEntries(present.map((l) => [l, placeholders(flat[l][key])]));
  const union = [...new Set(present.flatMap((l) => perLocale[l]))].sort();
  if (union.length === 0) continue;
  const bad = present.filter((l) => JSON.stringify(perLocale[l]) !== JSON.stringify(union));
  if (bad.length > 0) {
    mismatches.push({ key, expected: union, perLocale, values: Object.fromEntries(present.map((l) => [l, flat[l][key]])) });
  }
}

mismatches.sort((a, b) => a.key.localeCompare(b.key));
for (const m of mismatches) {
  console.log(`KEY ${m.key}  expected vars: [${m.expected.join(', ')}]`);
  for (const [l, vars] of Object.entries(m.perLocale)) {
    const mark = JSON.stringify(vars) === JSON.stringify(m.expected) ? 'ok ' : 'BAD';
    console.log(`  ${mark} ${l}: [${vars.join(', ')}]  "${m.values[l]}"`);
  }
}
console.log(`\n${mismatches.length} key(s) with placeholder mismatch across ${locales.join('/')}`);
process.exit(mismatches.length > 0 ? 1 : 0);
