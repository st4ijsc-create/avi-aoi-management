/**
 * Sprint 5 §4.3 fix round 2 (M-5, nêu bởi reviewer Task 6) — CỔNG CHẶN cho từ
 * điển tham số `appError()`.
 *
 * `appError(trpcCode, appCode, params, fallbackMessage)` truyền các tham số
 * tự-do (`entity`/`parent`/`operation`/`field`/`feature`/`action`) qua
 * `errors.<space>.*` ở client (`client/src/lib/errorCodes.ts` → `localizeParams`)
 * TRƯỚC khi nội suy câu hiện cho người dùng. Thiếu bản dịch KHÔNG làm sập ứng
 * dụng — `i18n.t(..., { defaultValue: raw })` rơi về hiện nguyên văn khoá — nhưng
 * đó là một LỖI HIỂN THỊ ÂM THẦM: người vận hành tiếng Việt sẽ đọc thẳng
 * "extractAoiPackageImage" hay "flux_capacitor" thay vì câu người đọc được, và
 * không có test thông thường nào bắt được vì mọi thứ vẫn chạy đúng, chỉ chữ sai.
 *
 * Test này quét TĨNH mọi lời gọi `appError(...)` trong `server/routers` (loại
 * `.test.ts`), rút các literal string gán cho 1 trong 6 tham số trên, và khẳng
 * định MỖI giá trị có khoá tương ứng ở CẢ BA `vi/en/zh.json`. Chỉ bắt chuỗi
 * LITERAL (`"x"`/`'x'`/`` `x` `` không có `${...}`) — biến động (`err.message`,
 * `input.code`, …) không thể kiểm tĩnh và là nợ đã biết, ghi trong
 * `.superpowers/sdd/2026-07-29-ai-sprint5-error-codes/task-6-report.md`.
 *
 * `parent` dùng CHUNG không gian từ điển với `entity` (client `localizeParams`
 * tra cả hai qua `errors.entity.*` — xem `SCOPE_MISMATCH` params: { entity,
 * parent }, cả hai đều là TÊN THỰC THỂ).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTERS_DIR = dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = join(ROUTERS_DIR, "..", "..", "client", "src", "i18n", "locales");
const LOCALES = ["vi", "en", "zh"] as const;

/** Tham số tự-do cần tra từ điển → không gian khoá `errors.<space>.*` của nó. */
const PARAM_SPACE: Record<string, string> = {
  entity: "entity",
  parent: "entity", // dùng chung với entity — xem docstring trên.
  operation: "operation",
  field: "field",
  feature: "feature",
  action: "action",
  // Sprint 5 doc 71 Task 5 (F4) — không gian MỚI `errors.reason.*` (chỉ dẫn hành
  // động khôi phục cho OPERATION_FAILED/INVALID_VALUE/PERMISSION_DENIED khi có
  // `_WITH_REASON`, xem client/src/lib/errorCodes.ts). Cổng này phải TỰ bao được
  // không gian mới ngay khi thêm — nếu không, một lời gọi `reason: "..."` thiếu bản
  // dịch sẽ lọt qua trong im lặng, đúng lớp lỗi mà cả file này tồn tại để chặn.
  reason: "reason",
};
const PARAM_KEYS = Object.keys(PARAM_SPACE);

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** Rút mọi `{ paramKey: "literal" }` bên trong TỪNG lời gọi `appError(...)`
 *  (đếm ngoặc tròn để bắt trọn cả lời gọi nhiều dòng, không chỉ 1 dòng). */
function extractAppErrorParams(src: string): Array<{ key: string; value: string }> {
  const found: Array<{ key: string; value: string }> = [];
  const callRe = /appError\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    const callBody = src.slice(start, i - 1);
    for (const key of PARAM_KEYS) {
      // Chỉ bắt literal chuỗi KHÔNG chứa nội suy `${` — biến động bỏ qua có chủ ý.
      const paramRe = new RegExp(`\\b${key}\\s*:\\s*["'\`]([^"'\`$]+)["'\`]`, "g");
      let pm: RegExpExecArray | null;
      while ((pm = paramRe.exec(callBody))) {
        found.push({ key, value: pm[1] });
      }
    }
  }
  return found;
}

function loadErrorsBlock(locale: string): Record<string, Record<string, unknown>> {
  const json = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8"));
  return json.errors ?? {};
}

describe("cổng chặn — mọi tham số tự-do của appError() phải có khoá i18n ở cả ba ngôn ngữ", () => {
  const dicts = Object.fromEntries(LOCALES.map((l) => [l, loadErrorsBlock(l)])) as Record<
    (typeof LOCALES)[number],
    Record<string, Record<string, unknown>>
  >;

  it("mọi entity/parent/operation/field/feature/action literal có khoá ở vi/en/zh", () => {
    const missing: string[] = [];
    for (const file of walkTsFiles(ROUTERS_DIR)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("appError(")) continue;
      for (const { key, value } of extractAppErrorParams(src)) {
        const space = PARAM_SPACE[key];
        for (const locale of LOCALES) {
          const dict = dicts[locale][space];
          if (!dict || !(value in dict)) {
            missing.push(
              `${file.replace(ROUTERS_DIR, "")} :: ${key}="${value}" thiếu ở errors.${space}.${value} (${locale})`,
            );
          }
        }
      }
    }
    if (missing.length > 0) {
      // In danh sách đầy đủ để đợt sau biết sửa chỗ nào — không chỉ 1 dòng "fail".
      console.error(`[cổng từ điển appError] ${missing.length} khoá thiếu:\n` + missing.join("\n"));
    }
    expect(missing).toEqual([]);
  });
});

/** Toàn bộ text bên trong cặp ngoặc tròn của MỘT lời gọi `appError(...)` (đếm ngoặc
 *  để bắt trọn lời gọi nhiều dòng — cùng kỹ thuật với extractAppErrorParams ở trên). */
function extractAppErrorCallBodies(src: string): string[] {
  const bodies: string[] = [];
  const callRe = /appError\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(src))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") depth--;
      i++;
    }
    bodies.push(src.slice(start, i - 1));
  }
  return bodies;
}

// Đợt sửa cuối (Phần 5 mục 3, review toàn cục) — cổng tĩnh ở trên chứng minh khoá
// TỒN TẠI trong từ điển, nhưng không chứng minh tham số ĐƯỢC TRUYỀN ở call-site. Mẫu
// `errors.PERMISSION_DENIED` có `{{action}}`: thiếu `action` ở lời gọi appError() thì
// người dùng thấy placeholder thô "Bạn không có quyền: ." (interpolation rỗng) —
// không phải lỗi ngã (mọi thứ vẫn chạy), chỉ chữ sai, y hệt lớp lỗi mà file này vừa
// chặn cho entity/operation/field/feature/action ở trên.
describe("cổng chặn — mọi appError(..., 'PERMISSION_DENIED', ...) phải truyền action", () => {
  it("không lời gọi PERMISSION_DENIED nào thiếu tham số action", () => {
    const missing: string[] = [];
    for (const file of walkTsFiles(ROUTERS_DIR)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("appError(") || !src.includes("PERMISSION_DENIED")) continue;
      for (const body of extractAppErrorCallBodies(src)) {
        if (!/["'`]PERMISSION_DENIED["'`]/.test(body)) continue;
        if (!/\baction\s*:/.test(body)) {
          missing.push(`${file.replace(ROUTERS_DIR, "")} :: appError(..., 'PERMISSION_DENIED', ...) thiếu tham số action`);
        }
      }
    }
    if (missing.length > 0) {
      console.error(`[cổng PERMISSION_DENIED→action] ${missing.length} chỗ thiếu:\n` + missing.join("\n"));
    }
    expect(missing).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Review round 1 (M-3, nêu bởi reviewer Task 5) — CỔNG THỨ BA, đóng đúng lỗ hổng
// mà chính docstring dòng 148-153 ở trên đã tự thú nhận CHO CA RIÊNG action: hai
// cổng phía trên chỉ chứng minh khoá TỒN TẠI ở từ điển (`errors.reason.*`,
// `errors.action`), KHÔNG chứng minh tham số ĐƯỢC TRUYỀN ở call-site. Hôm nay
// (Task 5) 17/17 call-site dùng `reason` đều truyền đủ tham số placeholder riêng
// của khoá đó (vd `reason: 'insufficientCpkSamples'` cần cả `sampleCount` lẫn
// `minSamples`) — nhưng call-site thứ 18 lỡ quên 1 tham số sẽ đẩy "{{minSamples}}"
// thô ra màn hình mà KHÔNG cổng nào ở trên bắt được (khoá vẫn tồn tại, chỉ thiếu
// tham số truyền vào nó).
//
// Cách làm: đọc `errors.reason.*` ở vi.json làm THAM CHIẾU (i18n-check đã đảm bảo
// placeholder giống hệt nhau ở cả 3 locale cho cùng 1 khoá, nên chỉ cần đọc 1 bản),
// rút placeholder `{{xxx}}` của từng khoá reason. Với MỖI lời gọi appError(...) có
// `reason: 'khoá'`, khẳng định MỌI placeholder của khoá đó đều xuất hiện dạng
// `tênThamSố:` ngay trong CÙNG lời gọi (cùng call body).
describe("cổng chặn — mọi placeholder của errors.reason.* phải được truyền ở call-site", () => {
  function extractPlaceholders(text: string): string[] {
    const names: string[] = [];
    const re = /\{\{\s*([\w.]+)\s*\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) names.push(m[1]);
    return names;
  }

  it("không lời gọi reason:'...' nào thiếu tham số placeholder mà chính khoá đó cần", () => {
    const reasonDict = loadErrorsBlock("vi").reason as Record<string, string> | undefined;
    if (!reasonDict) throw new Error("errors.reason rỗng ở vi.json — kiểm tra lại đường dẫn locale");

    // reasonKey -> danh sách tên placeholder KHÁC "reason" mà bản dịch của nó cần.
    const requiredParamsByReasonKey = new Map<string, string[]>();
    for (const [key, value] of Object.entries(reasonDict)) {
      const placeholders = extractPlaceholders(value).filter((p) => p !== "reason");
      if (placeholders.length > 0) requiredParamsByReasonKey.set(key, placeholders);
    }

    const missing: string[] = [];
    for (const file of walkTsFiles(ROUTERS_DIR)) {
      const src = readFileSync(file, "utf8");
      if (!src.includes("appError(") || !src.includes("reason")) continue;
      for (const body of extractAppErrorCallBodies(src)) {
        const reasonMatch = /\breason\s*:\s*["'`]([^"'`$]+)["'`]/.exec(body);
        if (!reasonMatch) continue;
        const reasonKey = reasonMatch[1];
        const requiredParams = requiredParamsByReasonKey.get(reasonKey);
        if (!requiredParams) continue; // khoá tĩnh (không placeholder) — không cần tham số gì thêm.
        for (const paramName of requiredParams) {
          // Chấp nhận CẢ property tường minh (`key: value`) LẪN shorthand ES6
          // (`key,` / `key }` — object literal `{ maxConcurrent }` tương đương
          // `{ maxConcurrent: maxConcurrent }`, hợp lệ và ĐANG được dùng thật ở
          // productionRouters.ts). Chỉ bắt `\bkey\b` khi theo sau là `:`/`,`/`}` —
          // đúng 3 vị trí kết thúc một property trong object literal.
          if (!new RegExp(`\\b${paramName}\\b\\s*(:|,|\\})`).test(body)) {
            missing.push(
              `${file.replace(ROUTERS_DIR, "")} :: reason='${reasonKey}' thiếu tham số '${paramName}' (errors.reason.${reasonKey} cần {{${paramName}}})`,
            );
          }
        }
      }
    }
    if (missing.length > 0) {
      console.error(`[cổng reason→placeholder] ${missing.length} chỗ thiếu:\n` + missing.join("\n"));
    }
    expect(missing).toEqual([]);
  });
});
