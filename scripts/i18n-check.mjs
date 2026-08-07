// Doc 42 A8 — so khớp placeholder {{var}} giữa en/vi/zh cho cùng key.
// Dùng: node scripts/i18n-check.mjs [repoRoot]  → exit 1 nếu có lệch (dùng cho CI).
// Không truyền argv → mặc định repoRoot = process.cwd() (chạy từ gốc repo).
//
// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-1 (review TOÀN NHÁNH Pha 6) — **CÔNG CỤ NÀY TỪNG MÙ THEO CẤU TẠO, BA LỖ, CẢ BA LÀ
// "LƯỢNG TỪ SAI".**
// ══════════════════════════════════════════════════════════════════════════════════════════════
// Đo được: **30/33** nhãn `vramBroker.*` của bảng VRAM vắng ở **CẢ BA** locale, và `i18n:check`
// khai **XANH** suốt **năm** lượt chạy trong Pha 6. Người vận hành đặt phiên `en`/`zh` mở
// `/ai-brain` thấy **30 nhãn TIẾNG VIỆT** (`t(key, "cục bộ")` trả `defaultValue`), gồm **hai nút
// phá huỷ** — không lỗi, không cảnh báo, cổng xanh.
//
// Ba lỗ, và **cả ba** là cùng một lớp lỗi (*"tồn tại" ở chỗ cần "với mọi"*):
//   1. lượng từ chạy trên **khoá CÓ TRONG FILE DỊCH**, không trên **khoá được MÃ tham chiếu**
//      ⇒ một khoá vắng ở cả ba là **vô hình tuyệt đối** — đúng luật *"vắng ở cả ba ⇒ không lệch"*;
//   2. `if (present.length < 2) continue` ⇒ khoá có ở **đúng một** locale bị bỏ qua;
//   3. công cụ chỉ so **PLACEHOLDER**, **không bao giờ** so **SỰ CÓ MẶT**.
// ⇒ Cái tên `i18n:check` hứa nhiều hơn cái nó làm — **cùng lớp lỗi** mà `vramReadModel.ts` tồn tại
//   để diệt.
//
// ⚠⚠ **VÌ SAO CÓ MỘT FILE NỀN (`i18n-missing-baseline.json`) VÀ NÓ KHÔNG PHẢI MỘT CỬA MIỄN TRỪ:**
// đo lần đầu trên toàn repo: **13.859** khoá được mã tham chiếu, **841** vắng ở cả ba, **20** vắng
// ở một phần. Đó là **nợ CÓ TRƯỚC** của ~25 màn, không phải của lượt vá này — bật cứng lên là làm
// cổng đỏ vĩnh viễn và **không ai** chạy nó nữa (đúng cách một cổng chết). Nên: nợ được **ĐẾM,
// GHI TÊN, và ĐÓNG BĂNG**; mọi khoá **mới** thiếu là **ĐỎ**, và mọi khoá đã được dịch mà còn nằm
// trong nền cũng **ĐỎ** (nền chỉ được **thu hẹp**, không được phình). Đó là một **bánh cóc**, và
// nó ghi tên từng khoá — không phải một con số, vì *"hoán vị hai phần tử giữ nguyên TẬP"* đã là
// một bài học phải trả giá của nhánh này.
// ⚠ `--update-baseline` **cố ý** phải gõ tay: một lượt cập nhật nền là một **quyết định phải nói
//   ra**, và nó hiện thành diff trong review.
// ══════════════════════════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const UPDATE = argv.includes('--update-baseline');
const root = argv.find((a) => !a.startsWith('--')) || process.cwd();
const localeDir = path.join(root, 'client/src/i18n/locales');
const locales = ['en', 'vi', 'zh'];
const BASELINE = path.join(root, 'scripts/i18n-missing-baseline.json');
/**
 * ★★★ Pha 7 §4.2 — **TRẦN của nền.** File này `--update-baseline` **KHÔNG BAO GIỜ ghi**; đó là
 * toàn bộ lý do nó tồn tại như một file RIÊNG. Xem khối lý lẽ ở cuối, mục "hai cửa thoát".
 */
const TRAN = path.join(root, 'scripts/i18n-baseline-tran.json');

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
/** Tên KHÔNG GIAN cấp một có thật (dùng để lọc chuỗi `key: "a.b"` không phải khoá dịch). */
const NAMESPACES = new Set(locales.flatMap((l) => Object.keys(data[l])));

function placeholders(str) {
  return [...str.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LỖ (1) — LƯỢNG TỪ PHẢI CHẠY TRÊN **KHOÁ ĐƯỢC MÃ THAM CHIẾU**
// ══════════════════════════════════════════════════════════════════════════════════════════════
function walkSources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) walkSources(p, out);
    else if (/\.(ts|tsx)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

/**
 * Mọi khoá dịch mà **MÃ SẢN XUẤT** tham chiếu, kèm nơi nhắc tới nó.
 * Hai hình dạng, và **chỉ** hai — mỗi cái đều nêu rõ giới hạn:
 *  • `t("a.b", …)` — hình dạng chính.
 *  • `key: "a.b"` **và** `a` là một không-gian cấp một CÓ THẬT — bảng hằng như
 *    `VRAM_READ_SURFACE_NOTICE` giữ khoá ở đây chứ không ở lời gọi `t(`. Điều kiện không-gian
 *    là thứ giữ `key: "some.id"` của mã không-dịch ra ngoài.
 * ⚠ GIỚI HẠN ĐƯỢC NÓI THẲNG: khoá dựng **động** (`t(\`a.${x}\`)`) nằm NGOÀI lượng từ này. Đó là
 *   một ô còn mở, không phải một ô được coi là đã đóng.
 */
function keysReferencedByCode() {
  const used = new Map();
  const add = (k, f) => {
    if (!used.has(k)) used.set(k, new Set());
    used.get(k).add(f);
  };
  for (const file of walkSources(path.join(root, 'client', 'src'))) {
    const src = readFileSync(file, 'utf8');
    const rel = path.relative(root, file).split(path.sep).join('/');
    for (const m of src.matchAll(/\bt\(\s*["'`]([A-Za-z0-9_$][\w.$-]*)["'`]/g)) add(m[1], rel);
    for (const m of src.matchAll(/\bkey:\s*["']([A-Za-z][\w$-]*(?:\.[\w$-]+)+)["']/g)) {
      if (NAMESPACES.has(m[1].split('.')[0])) add(m[1], rel);
    }
  }
  return used;
}

const used = keysReferencedByCode();

// ── PASS A: placeholder (luật cũ, đã bỏ lỗ (2)) ──────────────────────────────────────────────
// ⚠ `present.length < 2 ⇒ continue` ĐÃ BỎ: một khoá chỉ có ở MỘT locale nay được PASS B nói tới
//   bằng câu đúng ("thiếu ở 2 locale"), thay vì bị bỏ qua im lặng.
const allKeys = new Set([...locales.flatMap((l) => Object.keys(flat[l])), ...used.keys()]);
const mismatches = [];
for (const key of allKeys) {
  const present = locales.filter((l) => flat[l][key] !== undefined);
  if (present.length === 0) continue;
  const perLocale = Object.fromEntries(present.map((l) => [l, placeholders(flat[l][key])]));
  const union = [...new Set(present.flatMap((l) => perLocale[l]))].sort();
  if (union.length === 0) continue;
  const bad = present.filter((l) => JSON.stringify(perLocale[l]) !== JSON.stringify(union));
  if (bad.length > 0) {
    mismatches.push({ key, expected: union, perLocale, values: Object.fromEntries(present.map((l) => [l, flat[l][key]])) });
  }
}

// ── PASS B: SỰ CÓ MẶT (lỗ (3)) — ∀ khoá được mã tham chiếu phải có ở CẢ BA locale ─────────────
const missingAll = [];
const missingSome = [];
for (const [key, files] of used) {
  const present = locales.filter((l) => flat[l][key] !== undefined);
  if (present.length === 0) missingAll.push({ key, files: [...files].sort() });
  else if (present.length < locales.length) {
    missingSome.push({ key, present, thieu: locales.filter((l) => !present.includes(l)), files: [...files].sort() });
  }
}

const nen = existsSync(BASELINE)
  ? JSON.parse(readFileSync(BASELINE, 'utf8'))
  : { missingInAllLocales: [], missingInSomeLocales: [] };

if (UPDATE) {
  const dsAll = missingAll.map((m) => m.key).sort();
  const dsSome = missingSome.map((m) => m.key).sort();
  const out = {
    _note:
      'NỢ i18n CÓ TRƯỚC, ĐÃ ĐÓNG BĂNG. Mỗi mục là một khoá được MÃ tham chiếu mà bản dịch còn thiếu. ' +
      'Danh sách này chỉ được THU HẸP: thêm một khoá vào đây là thêm một màn nói sai ngôn ngữ. ' +
      'Sinh lại bằng `node scripts/i18n-check.mjs --update-baseline` — và đó là một quyết định phải nói ra trong review.',
    /**
     * ★★★ Pha 7 §4.2 — con số ghim, do **CHÍNH CÔNG CỤ** viết. Mọi lượt chạy đối chiếu nó với
     * độ dài mảng thật ⇒ một lượt **sửa TAY** file JSON (thêm/bớt tên mà không sinh lại) là **ĐỎ**.
     */
    _ghim: { missingInAllLocales: dsAll.length, missingInSomeLocales: dsSome.length },
    missingInAllLocales: dsAll,
    missingInSomeLocales: dsSome,
  };
  writeFileSync(BASELINE, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(
    `BASELINE WRITTEN: ${out.missingInAllLocales.length} missing-in-all · ${out.missingInSomeLocales.length} missing-in-some`,
  );
  // ⚠ `--update-baseline` KHÔNG ghi file trần. Nếu lượt sinh lại này làm nền VƯỢT trần thì lượt
  //   chạy kiểm tiếp theo sẽ ĐỎ, và người ta phải nâng trần BẰNG TAY — đúng chỗ ta muốn có ma sát.
  const tranNow = existsSync(TRAN) ? JSON.parse(readFileSync(TRAN, 'utf8')) : null;
  if (
    tranNow &&
    (out.missingInAllLocales.length > tranNow.missingInAllLocales ||
      out.missingInSomeLocales.length > tranNow.missingInSomeLocales)
  ) {
    console.log(
      `⚠ NỀN VỪA PHÌNH QUÁ TRẦN (${tranNow.missingInAllLocales}/${tranNow.missingInSomeLocales}). ` +
        `Lượt kiểm tới sẽ ĐỎ. Nâng trần ở ${path.basename(TRAN)} là một QUYẾT ĐỊNH PHẢI NÓI RA.`,
    );
  }
  process.exit(0);
}

const nenAll = new Set(nen.missingInAllLocales ?? []);
const nenSome = new Set(nen.missingInSomeLocales ?? []);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 7 §4.2 — *"NỀN CHỈ ĐƯỢC THU HẸP"* THÔI LÀ MỘT LỜI HỨA, THÀNH MỘT LƯỢNG TỪ MÁY
// ══════════════════════════════════════════════════════════════════════════════════════════════
// **Đo được (probe M6):** thêm **bằng tay** một tên khoá vào `missingInAllLocales`, **không dịch
// gì** ⇒ công cụ `exit 0`, **XANH**. Luật docstring nói *"∀ lượt thay đổi, |nền| không tăng"*;
// máy chỉ kiểm *"∃ mục trong nền ⇒ tha"* — **lượng từ sai**, đúng lớp lỗi mà chính file này tồn
// tại để diệt. Một luật không ai cưỡng chế thì nó **không phải luật**, nó là một dòng chú thích.
//
// **HAI CỬA THOÁT, nên HAI phép canh** — chúng độc lập vì hỏng theo hai kiểu khác nhau:
//
//  (G1) **sửa TAY file nền.** `_ghim` do **chính công cụ** viết ở lượt `--update-baseline`; mọi
//       lượt chạy đối chiếu nó với **độ dài mảng thật**. Thêm/bớt một tên bằng tay ⇒ lệch ⇒ **ĐỎ**.
//       ⚠ Cửa này là cửa **âm thầm nhất**: một dòng thêm vào giữa 817 tên thì không ai thấy trong
//         review, còn con số thì thấy ngay.
//
//  (G2) **chạy `--update-baseline` để "làm cổng xanh".** Đây là cửa **hay bị đi nhất trong thực
//       tế**: ai đó thêm một màn chưa dịch, cổng đỏ, và lượt sửa RẺ NHẤT là sinh lại nền. `_ghim`
//       **không** chặn được — nó do chính lượt sinh lại ấy viết ra. Nên trần nằm ở một file
//       **RIÊNG** (`i18n-baseline-tran.json`) mà công cụ **không bao giờ ghi**: nền vượt trần ⇒
//       **ĐỎ** cho tới khi có người sửa **hai con số** trong một file chỉ có hai con số.
//       ⚠ Đây là bảo đảm về **KHẢ NĂNG REVIEW**, không phải bảo đảm mật mã: nó không ngăn được
//         người cố ý, nó ngăn được **lượt trôi im lặng** — đúng thứ đã xảy ra.
//
// ⚠ **KHÔNG BẮT NHẦM (điều kiện thiết kế, không phải hệ quả may mắn):** một lượt **HẠ nền hợp lệ**
//   (dịch xong rồi `--update-baseline`) ⇒ `_ghim` được viết lại **khớp**, và `size < trần` ⇒
//   **XANH**. Trần là **≤**, cố ý **không** phải `===`: bắt trần đúng bằng nền sẽ biến mọi lượt trả
//   nợ thành ĐỎ, tức là phạt đúng cái hành vi ta muốn khuyến khích.
// ⚠ **Vì sao KHÔNG so với nền ở `git show HEAD:…`** (đường đã cân nhắc và LOẠI): nó chỉ bắt được
//   lượt phình **CHƯA COMMIT** — commit xong thì `HEAD` **chứa** nền đã phình, và mọi lượt chạy sau
//   đó **xanh vĩnh viễn**. Một cổng chỉ đỏ trước lúc commit là cổng bỏ sót đúng thứ nó phải canh.
//   Cộng thêm: nó buộc cổng phụ thuộc **git** (hỏng trong tarball/checkout nông/CI cạn lịch sử).
const viPhamNen = [];
const soAll = (nen.missingInAllLocales ?? []).length;
const soSome = (nen.missingInSomeLocales ?? []).length;
const ghim = nen._ghim;
if (!ghim || typeof ghim.missingInAllLocales !== 'number' || typeof ghim.missingInSomeLocales !== 'number') {
  viPhamNen.push(
    `NỀN THIẾU CON SỐ GHIM — ${path.basename(BASELINE)} không có ô \`_ghim\` hợp lệ; ` +
      'sinh lại bằng `node scripts/i18n-check.mjs --update-baseline`',
  );
} else {
  if (ghim.missingInAllLocales !== soAll) {
    viPhamNen.push(
      `NỀN BỊ SỬA TAY  missingInAllLocales: đếm được ${soAll} tên, con số ghim nói ${ghim.missingInAllLocales} — ` +
        'nền chỉ được đổi qua `--update-baseline`, không được sửa tay',
    );
  }
  if (ghim.missingInSomeLocales !== soSome) {
    viPhamNen.push(
      `NỀN BỊ SỬA TAY  missingInSomeLocales: đếm được ${soSome} tên, con số ghim nói ${ghim.missingInSomeLocales} — ` +
        'nền chỉ được đổi qua `--update-baseline`, không được sửa tay',
    );
  }
}
const tran = existsSync(TRAN) ? JSON.parse(readFileSync(TRAN, 'utf8')) : null;
if (!tran || typeof tran.missingInAllLocales !== 'number' || typeof tran.missingInSomeLocales !== 'number') {
  // ⚠ CẦU CHÌ: thiếu file trần ⇒ ĐỎ, **không** im lặng bỏ qua. Một phép canh vắng mặt mà cổng vẫn
  //   xanh chính là lớp lỗi đang được đóng ở đây.
  viPhamNen.push(`THIẾU TRẦN NỀN — không đọc được ${path.basename(TRAN)}; phép canh "nền không phình" đang KHÔNG chạy`);
} else {
  if (soAll > tran.missingInAllLocales) {
    viPhamNen.push(
      `NỀN PHÌNH  missingInAllLocales: ${soAll} > trần ${tran.missingInAllLocales} — ` +
        `nâng trần ở ${path.basename(TRAN)} là một QUYẾT ĐỊNH PHẢI NÓI RA trong review`,
    );
  }
  if (soSome > tran.missingInSomeLocales) {
    viPhamNen.push(
      `NỀN PHÌNH  missingInSomeLocales: ${soSome} > trần ${tran.missingInSomeLocales} — ` +
        `nâng trần ở ${path.basename(TRAN)} là một QUYẾT ĐỊNH PHẢI NÓI RA trong review`,
    );
  }
}

/** MỚI thiếu — không có trong nền ⇒ đây là nợ do lượt thay đổi này đẻ ra. */
const moiThieuAll = missingAll.filter((m) => !nenAll.has(m.key));
const moiThieuSome = missingSome.filter((m) => !nenSome.has(m.key));
/** Nền CŨ — khoá đã được dịch xong (hoặc đã bị gỡ khỏi mã) mà còn nằm trong nền ⇒ thu hẹp nền. */
const nenCu = [
  ...[...nenAll].filter((k) => !missingAll.some((m) => m.key === k)),
  ...[...nenSome].filter((k) => !missingSome.some((m) => m.key === k)),
].sort();

// ── BÁO CÁO ──────────────────────────────────────────────────────────────────────────────────
mismatches.sort((a, b) => a.key.localeCompare(b.key));
for (const m of mismatches) {
  console.log(`KEY ${m.key}  expected vars: [${m.expected.join(', ')}]`);
  for (const [l, vars] of Object.entries(m.perLocale)) {
    const mark = JSON.stringify(vars) === JSON.stringify(m.expected) ? 'ok ' : 'BAD';
    console.log(`  ${mark} ${l}: [${vars.join(', ')}]  "${m.values[l]}"`);
  }
}
for (const m of moiThieuAll.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`MISSING IN ALL 3  ${m.key}   ← ${m.files.slice(0, 3).join(', ')}`);
}
for (const m of moiThieuSome.sort((a, b) => a.key.localeCompare(b.key))) {
  console.log(`MISSING IN ${m.thieu.join('/')}  ${m.key}   ← ${m.files.slice(0, 3).join(', ')}`);
}
for (const k of nenCu) {
  console.log(`BASELINE STALE   ${k} — đã dịch xong (hoặc đã gỡ khỏi mã); xoá nó khỏi ${path.basename(BASELINE)}`);
}
for (const v of viPhamNen) {
  console.log(v);
}

const tong = mismatches.length + moiThieuAll.length + moiThieuSome.length + nenCu.length + viPhamNen.length;
console.log(
  `\n${mismatches.length} key(s) with placeholder mismatch across ${locales.join('/')}` +
    ` · ${moiThieuAll.length} NEW key(s) missing in all 3` +
    ` · ${moiThieuSome.length} NEW key(s) missing in some` +
    ` · ${nenCu.length} stale baseline entr(y|ies)` +
    ` · ${viPhamNen.length} baseline-integrity violation(s)` +
    ` · [đã đóng băng: ${nenAll.size} missing-in-all + ${nenSome.size} missing-in-some, nợ CÓ TRƯỚC]`,
);
process.exit(tong > 0 ? 1 : 0);
