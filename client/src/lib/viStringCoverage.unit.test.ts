/**
 * F12 (nhóm C 2026-08-14) — CỔNG BỔ SUNG cho nhãn tiếng Việt lọt sang bản en/zh.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ ĐỌC TRƯỚC — VÌ SAO FILE NÀY KHÔNG PHẢI BẢN SAO CỦA `scripts/i18n-check.mjs`
 * ══════════════════════════════════════════════════════════════════════════════════
 * Dự án ĐÃ CÓ một cổng i18n đầy đủ (`npm run i18n:check`) với hai file nền, trong đó
 * `i18n-baseline-tran.json` là TRẦN mà `--update-baseline` không bao giờ ghi được.
 * Cổng đó đã phủ nhánh *"khoá `t()` vắng ở cả ba locale"* — **đừng viết lại nó ở đây**.
 *
 * File này chỉ canh hai thứ mà cổng kia **về cấu tạo không thể** canh:
 *
 * (1) **Chuỗi tiếng Việt TRẦN** — không đi qua `t()` nên KHÔNG CÓ KHOÁ nào để quét.
 *     Mọi công cụ dựa trên khoá đều mù với nó theo định nghĩa.
 *
 * (2) **Khoá có ở `vi.json` nhưng thiếu ở `en.json`/`zh.json`** — so FILE VỚI FILE,
 *     không so theo tham chiếu trong mã. `i18n-check.mjs` dựng tập khoá từ mã nguồn
 *     nên mù với hai khuôn tham chiếu có thật trong repo này:
 *       · `t(\`settings.machineType_\${type}\`)`  — template literal có biến
 *       · `{ labelKey: "deviceHub.tabs.oee" }`    — khoá lưu như DỮ LIỆU rồi mới `t(labelKey)`
 *     Lượt chạy đầu tiên của chính phép so này bắt được **4 khoá** mà cổng kia chưa
 *     bao giờ thấy (2 khuôn trên, mỗi khuôn 2 khoá) — bằng chứng nó không thừa.
 *
 * ── LỚP LỖI ĐANG CANH ────────────────────────────────────────────────────────────
 * i18next luôn trả `defaultValue` khi không tra được khoá, nên một nhãn thiếu khoá
 * hiện TIẾNG VIỆT ở mọi ngôn ngữ — không lỗi, không cảnh báo, cổng xanh. Pha 6 đã trả
 * giá đúng lớp này: 30 nhãn `vramBroker.*` vắng cả ba locale, người dùng `en`/`zh` mở
 * `/ai-brain` thấy 30 nhãn tiếng Việt gồm HAI NÚT PHÁ HUỶ, mà `i18n:check` khai xanh
 * suốt năm lượt.
 *
 * ⚠ KHÔNG được nâng ngân sách để cổng xanh. Nâng nó nghĩa là bạn vừa thêm một nhãn
 *   mà người dùng en/zh sẽ đọc bằng tiếng Việt.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Hạ số này mỗi khi di trú xong một đợt. KHÔNG BAO GIỜ nâng lên.
 *
 * 610 → 410 (2026-08-16): đã di trú **toàn bộ 200 chuỗi trên 39 file màn VẬN HÀNH**
 * — số nhãn mà người vận hành đọc mỗi ca nay bằng 0.
 *
 * ⚠ 410 CÒN LẠI KHÔNG PHẢI SỐ DƯ TUỲ Ý — nó là chính xác 8 file `ApiDocs`
 * (`pages/ApiDocs.tsx` 192 · `components/apiDocs/*` 218). Nội dung ở đó là **tài liệu
 * tham chiếu API cho bên tích hợp**, dạng `factory.list - Danh sách nhà máy`: tên
 * tuyến bằng tiếng Anh + mô tả bằng tiếng Việt. Đó là tài liệu, không phải nhãn giao
 * diện, nên chủ dự án chốt để lại (2026-08-16). Xem `ALLOWED_RAW_VI_APIDOCS` bên dưới:
 * nợ này bị GIAM trong thư mục ApiDocs, thêm chuỗi trần ở bất kỳ đâu khác vẫn ĐỎ.
 */
const ALLOWED_RAW_VI_STRINGS = 410;

/**
 * Trần riêng cho nhóm ApiDocs. Tồn tại để hai con số không thể bù trừ cho nhau:
 * nếu ai đó dịch bớt ApiDocs mà thêm nhãn trần vào màn vận hành, tổng vẫn 410 và
 * cổng trên sẽ xanh — chính là lớp lỗi "ngân sách tự thoả" đã trả giá ở Pha 7.
 */
const ALLOWED_RAW_VI_APIDOCS = 410;

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = resolve(CLIENT_SRC, "i18n/locales");

const CHU_VIET =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "locales") continue; // file dịch, không phải mã
      out.push(...walkTsx(full));
    } else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const doc = (lg: string) =>
  flatten(JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")));

/**
 * Chuỗi tiếng Việt trần trong JSX text hoặc thuộc tính hướng-người-dùng.
 * Comment KHÔNG tính — comment tiếng Việt là chuyện tốt, không phải nợ.
 */
function demChuoiTran(): { total: number; byFile: Array<[string, number]> } {
  const THUOC_TINH =
    /\b(placeholder|title|label|aria-label|description|alt|tooltip)\s*=\s*["'`][^"'`]*/;
  const byFile: Array<[string, number]> = [];
  let total = 0;

  for (const file of walkTsx(CLIENT_SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let inBlock = false;
    let n = 0;
    for (const ln of lines) {
      const tr = ln.trim();
      if (inBlock) { if (tr.includes("*/")) inBlock = false; continue; }
      // ⚠ `{/*` cũng phải tính là mở khối. Bỏ sót nó, một comment JSX NHIỀU DÒNG có
      // chữ Việt sẽ bị đếm thành nợ — và tệ hơn, bộ di trú tự động sẽ SỬA VÀO COMMENT.
      // Đúng chuyện đó đã xảy ra ở `DashboardLayout.tsx` lượt 2026-08-16.
      if (tr.startsWith("/*") || tr.startsWith("{/*")) { inBlock = !tr.includes("*/"); continue; }
      if (tr.startsWith("//") || tr.startsWith("*")) continue;
      if (!CHU_VIET.test(ln)) continue;

      if (/>[^<>{}]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ][^<>{}]*</i.test(ln)) { n++; continue; }
      const attr = ln.match(THUOC_TINH);
      if (attr && CHU_VIET.test(attr[0])) { n++; continue; }
    }
    if (n) { byFile.push([file.replace(CLIENT_SRC, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/** Nhóm tài liệu tham chiếu API — cố ý ngoài phạm vi di trú, xem chú thích trần. */
const LA_APIDOCS = /ApiDocs|apiDocs|api-docs/i;

describe("F12 — chuỗi tiếng Việt TRẦN (cổng theo-khoá không thấy được)", () => {
  it(`tối đa ${ALLOWED_RAW_VI_STRINGS} chuỗi hướng-người-dùng chưa qua t()`, () => {
    const { total, byFile } = demChuoiTran();
    if (total > ALLOWED_RAW_VI_STRINGS) {
      console.error("[F12] còn nợ ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_VI_STRINGS);
  });

  it("ngân sách phải bám SÁT số thật — số dư che mất nợ mới", () => {
    expect(ALLOWED_RAW_VI_STRINGS).toBe(demChuoiTran().total);
  });

  // ⚠ Hai phép đo dưới đây là thứ khiến trần 410 KHÔNG phải một cái bao tải.
  // Thiếu chúng, một nhãn trần mới ở màn vận hành có thể núp sau việc ai đó
  // tình cờ dịch bớt ApiDocs, và tổng vẫn đúng 410.
  it("màn VẬN HÀNH phải bằng 0 — mọi chuỗi trần ngoài ApiDocs đều là nợ MỚI", () => {
    const { byFile } = demChuoiTran();
    const vanHanh = byFile.filter(([f]) => !LA_APIDOCS.test(f));
    if (vanHanh.length) console.error("[F12] nhãn trần MỚI ngoài ApiDocs:", vanHanh);
    expect(vanHanh).toEqual([]);
  });

  it(`nhóm ApiDocs không được phình quá ${ALLOWED_RAW_VI_APIDOCS}`, () => {
    const { byFile } = demChuoiTran();
    const apiDocs = byFile.filter(([f]) => LA_APIDOCS.test(f)).reduce((s, [, n]) => s + n, 0);
    expect(apiDocs).toBeLessThanOrEqual(ALLOWED_RAW_VI_APIDOCS);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════
 * HÌNH DẠNG THỨ BA — string literal tiếng Việt trong BIỂU THỨC (không phải `>text<`,
 * không phải `attr="text"`).
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ CÁCH TÌM RA NÓ MỚI LÀ ĐIỀU ĐÁNG GHI. `demChuoiTran()` khai **0 nợ ở màn vận hành**
 * và cả ba cổng đều xanh. Rồi lượt nghiệm thu BẰNG MẮT mở `/` với trình duyệt ngôn ngữ
 * `en` và thấy một dải băng tiếng Việt chạy ngang đầu MỌI màn:
 *
 *     {!netUp ? "Mất kết nối mạng — …" : "Mất kết nối thời gian thực — …"}
 *
 * Chuỗi nằm ở hai NHÁNH TERNARY nên nó không mang hình dạng nào trong hai hình dạng
 * cổng biết đọc. Cổng không sai số — nó đo một hình dạng mà lỗi này không có.
 * ⇒ Bài học: một cổng tĩnh xanh chỉ chứng minh "không còn thứ TÔI BIẾT CÁCH NHÌN".
 *   Nghiệm thu bằng mắt không phải bước làm cho đẹp; nó là bước duy nhất có thể
 *   phát hiện một hình dạng chưa ai nghĩ tới.
 *
 * ⚠ 914 KHÔNG PHẢI SỐ NỢ ĐÃ THẨM ĐỊNH — nó là số ĐÓNG BĂNG. Đã lấy mẫu và biết chắc
 *   trong đó có những thứ **không được dịch**:
 *     · `ApiDocs`: `name: "Nhà máy Bắc Ninh"` — dữ liệu JSON MẪU trong tài liệu API
 *     · `BulkImportDialog`: `findCol("code", "mã", "ma", …)` — BÍ DANH CỘT tiếng Việt
 *       để khớp file Excel người dùng nhập; dịch chúng là làm HỎNG chức năng nhập
 *     · `FirstRunTour` / `FactoryConfigAudit`: `{ key: "…", fallback: "…" }` — đã có
 *       khoá i18n đi kèm, chuỗi Việt chỉ là lưới an toàn, đúng khuôn
 *   Việc phân loại 914 mục này là hạng mục RIÊNG (F13), chưa làm. Cổng dưới đây chỉ
 *   giữ cho nó KHÔNG PHÌNH THÊM trong lúc chờ.
 */
/**
 * 914 → 770: lọc bốn KHUÔN ĐÃ ĐÚNG ra khỏi phép đếm (xem `LA_KHUON_DUNG`) và bỏ
 * comment cuối dòng. 144 mục kia chưa bao giờ là nợ — con số 914 đã nói quá.
 * 770 → 652: F13 lô 1 — nhãn điều hướng + 6 hub đi qua `t()`, 167 khoá × 3 locale.
 * 652 → 619: F13 lô 2 — bản đồ trạng thái/enum của CommandCenter + MasterData.
 */
const FROZEN_SHAPE3 = 619;

/**
 * Bỏ comment `//` ở CUỐI dòng. Phép bỏ comment ở trên chỉ xét ĐẦU dòng, nên
 * `const X = ...; // ghi chú tiếng Việt` bị đếm thành nợ — nó không phải nợ.
 * ⚠ Không cắt ở `://` (URL) và không cắt phần `//` nằm TRONG chuỗi.
 */
function boCommentCuoiDong(ln: string): string {
  let trongChuoi: string | null = null;
  for (let i = 0; i < ln.length - 1; i++) {
    const c = ln[i];
    if (trongChuoi) {
      if (c === "\\") i++;
      else if (c === trongChuoi) trongChuoi = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { trongChuoi = c; continue; }
    if (c === "/" && ln[i + 1] === "/") return ln.slice(0, i);
  }
  return ln;
}

/**
 * Bốn khuôn ĐÃ ĐÚNG, không được tính là nợ — mỗi khuôn kèm lý do đo được:
 *  · `pick("vi", "en", "zh")` — bộ chọn ba ngôn ngữ tự viết (`MachineAISummary`),
 *    đã trả đúng chữ theo `i18n.language`; bọc `t()` là làm THỪA.
 *  · `["khoa.i18n", "tiếng Việt"]` — tuple [khoá, mặc định], phần tử đầu LÀ khoá.
 *  · `defaultValue: "…"` — đúng là defaultValue của i18n, nhánh (a) lo.
 *  · `{ labelKey/key: "…", label/fallback: "…" }` — khoá đi kèm trên cùng dòng.
 */
function LA_KHUON_DUNG(ln: string): boolean {
  if (/\bpick\s*\(\s*[`"']/.test(ln)) return true;
  if (/\[\s*["'`][a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+["'`]\s*,\s*["'`]/.test(ln)) return true;
  if (/\bdefaultValue\s*:/.test(ln)) return true;
  if (/\b(labelKey|titleKey|descKey|key)\s*:\s*["'`][a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)+["'`]/.test(ln)) return true;
  if (/\b(fallback|labelFallback|titleFallback|descFallback)\s*:/.test(ln)) return true;
  return false;
}

function demHinhDangBa(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;

  for (const file of walkTsx(CLIENT_SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let inBlock = false;
    let n = 0;
    for (const ln of lines) {
      const tr = ln.trim();
      if (inBlock) { if (tr.includes("*/")) inBlock = false; continue; }
      if (tr.startsWith("/*") || tr.startsWith("{/*")) { inBlock = !tr.includes("*/"); continue; }
      if (tr.startsWith("//") || tr.startsWith("*")) continue;
      if (!CHU_VIET.test(ln)) continue;
      // hai hình dạng cũ đã có cổng riêng ở trên — không đếm hai lần
      if (/>[^<>{}]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ][^<>{}]*</i.test(ln)) continue;
      if (/\b(placeholder|title|label|aria-label|description|alt|tooltip)\s*=\s*["'`][^"'`]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(ln)) continue;
      // đang là defaultValue của `t(...)` cùng dòng → nhánh (a) lo, đúng khuôn
      if (/\bt\s*\(/.test(ln)) continue;
      if (LA_KHUON_DUNG(ln)) continue;
      const sach = boCommentCuoiDong(ln);
      if (!CHU_VIET.test(sach)) continue;
      const chuoi = sach.match(/(["'`])((?:(?!\1)[^\\]|\\.)*)\1/g);
      if (chuoi?.some((s) => CHU_VIET.test(s))) n++;
    }
    if (n) { byFile.push([file.replace(CLIENT_SRC, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe("F12 — hình dạng THỨ BA (bắt được nhờ nghiệm thu bằng mắt, không phải nhờ cổng)", () => {
  it(`không được phình quá ${FROZEN_SHAPE3} — đóng băng, KHÔNG phải mục tiêu`, () => {
    const { total, byFile } = demHinhDangBa();
    if (total > FROZEN_SHAPE3) console.error("[F12/hình-3] phình ở:", byFile.slice(0, 10));
    expect(total).toBeLessThanOrEqual(FROZEN_SHAPE3);
  });
});

describe("F12 — parity FILE-VỚI-FILE (bổ sung cho i18n-check.mjs, không thay thế)", () => {
  it("khoá có ở vi thì PHẢI có ở en và zh — bất biến, KHÔNG phải ngân sách", () => {
    // Đây là phép so file-với-file. `i18n-check.mjs` dựng tập khoá từ THAM CHIẾU
    // TRONG MÃ nên mù với khoá ghép động (`machineType_${type}`) và khoá lưu như dữ
    // liệu (`labelKey: "..."`). Lượt chạy đầu bắt được 4 khoá thuộc đúng hai khuôn đó.
    const vi = doc("vi"), en = doc("en"), zh = doc("zh");
    const thieu = Object.keys(vi).filter((k) => en[k] === undefined || zh[k] === undefined);
    expect(thieu).toEqual([]);
  });
});
