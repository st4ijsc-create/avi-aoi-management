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

/** Hạ số này mỗi khi di trú xong một đợt. KHÔNG BAO GIỜ nâng lên. */
const ALLOWED_RAW_VI_STRINGS = 610;

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
      if (tr.startsWith("/*")) { inBlock = !tr.includes("*/"); continue; }
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
