// Doc 42 A8 — so khớp placeholder {{var}} giữa en/vi/zh cho cùng key.
// Dùng: node scripts/i18n-check.mjs [repoRoot]  → exit 1 nếu có lệch (dùng cho CI).
// Không truyền argv → mặc định repoRoot = process.cwd() (chạy từ gốc repo).
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || process.cwd();
const localeDir = path.join(root, 'client/src/i18n/locales');
const locales = ['en', 'vi', 'zh'];

const raw = Object.fromEntries(
  locales.map((l) => [l, readFileSync(path.join(localeDir, `${l}.json`), 'utf8')]),
);
const data = Object.fromEntries(locales.map((l) => [l, JSON.parse(raw[l])]));

// doc 46 FE-W4 — DUPLICATE-KEY GUARD. JSON.parse silently keeps the LAST of two
// same-named keys in one object (that's how the historical signOff/signoff class of
// bug hid), so a parsed-object scan can't see it. Scan the raw text instead: track a
// stack of object frames and flag any key that repeats within the same object.
function findDuplicateKeys(text) {
  const dups = [];
  const stack = [new Set()];
  const n = text.length;
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') { s += text[j + 1] ?? ''; j += 2; continue; }
        s += text[j];
        j++;
      }
      let k = j + 1;
      while (k < n && /\s/.test(text[k])) k++;
      if (text[k] === ':') {
        const top = stack[stack.length - 1];
        if (top.has(s)) dups.push(s);
        else top.add(s);
      }
      i = j;
    } else if (c === '{') {
      stack.push(new Set());
    } else if (c === '}') {
      if (stack.length > 1) stack.pop();
    }
  }
  return dups;
}

const dupFindings = [];
for (const l of locales) {
  const dups = findDuplicateKeys(raw[l]);
  if (dups.length > 0) dupFindings.push({ locale: l, dups: [...new Set(dups)] });
}
if (dupFindings.length > 0) {
  for (const { locale, dups } of dupFindings) {
    console.log(`DUPLICATE KEYS in ${locale}.json (${dups.length}): ${dups.join(', ')}`);
  }
  console.log(`\n${dupFindings.reduce((a, f) => a + f.dups.length, 0)} duplicate key(s) — a later value silently overrides an earlier one. Fix before merge.`);
  process.exit(1);
}

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
