/**
 * Sprint 5 doc 71 Task 5 (F4) — `errors.reason.*`: khôi phục chỉ dẫn hành động đã
 * mất khi router di trú sang appError() (câu chuẩn OPERATION_FAILED/INVALID_VALUE/
 * PERMISSION_DENIED chỉ nội suy {{operation}}/{{field}}/{{action}}, không có chỗ
 * cho lý do cụ thể/bước tiếp theo).
 *
 * i18next KHÔNG có "chỉ nội suy nếu tham số tồn tại" — nếu thêm thẳng {{reason}}
 * vào câu chuẩn hiện có thì MỌI lời gọi appError() cũ (không truyền `reason`) sẽ
 * hiện chuỗi rỗng hoặc "{{reason}}" thô. Cách chọn của `translateAppError`
 * (client/src/lib/errorCodes.ts): thử khoá `${appCode}_WITH_REASON` TRƯỚC khi
 * `params.reason` là chuỗi không rỗng; không có khoá đó (appCode chưa có bản
 * `_WITH_REASON`) ⇒ lặng lẽ rơi về khoá gốc. Test này khẳng định CẢ HAI nhánh đọc
 * được ở CẢ BA locale — đúng yêu cầu bắt buộc của Task 5 Step 2.
 *
 * Cùng cách nạp i18n THẬT như trpcErrors.unit.test.ts (KHÔNG stub i18n.t): test
 * phải đi qua bản dịch production thật, nếu không sẽ xanh giả trong khi người
 * dùng thật thấy khoá trần trên màn hình.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

import { translateAppError } from "./errorCodes";

import "../i18n";
import i18n from "i18next";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(async () => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});

const LOCALES = ["vi", "en", "zh"] as const;

/** Không còn placeholder `{{...}}` CHƯA được thay — dấu hiệu khoá thiếu tham số. */
function hasUnresolvedPlaceholder(s: string): boolean {
  return /\{\{\s*[\w.]+\s*\}\}/.test(s);
}

/** Khoảng trắng thừa (2 dấu cách liên tiếp, hoặc dấu cách ngay trước dấu câu) hoặc
 *  dấu câu lạc (".." / " ." / " ,") — dấu hiệu nối câu hỏng khi ghép {{reason}}. */
function hasStrayWhitespaceOrPunctuation(s: string): boolean {
  return /  /.test(s) || /\s[.,]/.test(s) || /\.\./.test(s) || s !== s.trim();
}

describe("translateAppError — OPERATION_FAILED có/không có reason (cả 3 locale)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: KHÔNG có reason ⇒ câu chuẩn cũ, không đổi hành vi`, async () => {
      await i18n.changeLanguage(locale);
      const out = translateAppError(
        "OPERATION_FAILED",
        { operation: "rescheduleProductionOrder" },
        "fallback message",
      );
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(out)).toBe(false);
      expect(out).not.toBe("fallback message"); // đã dịch được, không rơi về fallback
    });

    it(`${locale}: CÓ reason (scheduleConflict + conflictCount lồng) ⇒ câu dài hơn, mang chỉ dẫn`, async () => {
      await i18n.changeLanguage(locale);
      const withoutReason = translateAppError(
        "OPERATION_FAILED",
        { operation: "rescheduleProductionOrder" },
        "fallback message",
      );
      const withReason = translateAppError(
        "OPERATION_FAILED",
        { operation: "rescheduleProductionOrder", reason: "scheduleConflict", conflictCount: 3 },
        "fallback message",
      );
      expect(hasUnresolvedPlaceholder(withReason)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(withReason)).toBe(false);
      expect(withReason).not.toBe(withoutReason); // reason thực sự đổi câu hiện ra
      // Nội suy LỒNG: conflictCount (tham số không đi qua từ điển) phải xuất hiện
      // NGUYÊN VĂN bên trong câu reason đã dịch — không phải "{{conflictCount}}" thô.
      expect(withReason).toContain("3");
    });
  }
});

describe("translateAppError — INVALID_VALUE có/không có reason (cả 3 locale)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: KHÔNG có reason ⇒ câu chuẩn cũ`, async () => {
      await i18n.changeLanguage(locale);
      const out = translateAppError("INVALID_VALUE", { field: "image" }, "fallback message");
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(out)).toBe(false);
    });

    it(`${locale}: CÓ reason (emptyImagePayload, tĩnh không tham số) ⇒ câu mang chỉ dẫn`, async () => {
      await i18n.changeLanguage(locale);
      const withoutReason = translateAppError("INVALID_VALUE", { field: "image" }, "fallback message");
      const withReason = translateAppError(
        "INVALID_VALUE",
        { field: "image", reason: "emptyImagePayload" },
        "fallback message",
      );
      expect(hasUnresolvedPlaceholder(withReason)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(withReason)).toBe(false);
      expect(withReason).not.toBe(withoutReason);
      expect(withReason.length).toBeGreaterThan(withoutReason.length);
    });
  }
});

describe("translateAppError — luồng ảnh: 3 nguyên nhân KHÔNG còn render 1 câu (Task 5)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: base64 hỏng / ảnh rỗng / vượt dung lượng ⇒ 3 câu KHÁC NHAU`, async () => {
      await i18n.changeLanguage(locale);
      const invalidBase64 = translateAppError(
        "INVALID_VALUE",
        { field: "image", reason: "invalidBase64Image" },
        "Invalid base64 image",
      );
      const emptyPayload = translateAppError(
        "INVALID_VALUE",
        { field: "image", reason: "emptyImagePayload" },
        "Empty image payload",
      );
      // Task 5 — ca "vượt dung lượng" TÁI DÙNG KB_FILE_TOO_LARGE{limitMb} đã có
      // (Task 3), KHÔNG gộp vào INVALID_VALUE — đúng yêu cầu brief, khác 2 ca trên.
      const tooLarge = translateAppError(
        "KB_FILE_TOO_LARGE",
        { limitMb: 10 },
        "Image exceeds 10485760 bytes",
      );
      for (const s of [invalidBase64, emptyPayload, tooLarge]) {
        expect(hasUnresolvedPlaceholder(s)).toBe(false);
        expect(hasStrayWhitespaceOrPunctuation(s)).toBe(false);
      }
      expect(new Set([invalidBase64, emptyPayload, tooLarge]).size).toBe(3);
      expect(tooLarge).toContain("10"); // limitMb nội suy được
    });
  }
});

describe("translateAppError — PERMISSION_DENIED có/không có reason (cả 3 locale)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: action bắt buộc vẫn còn; reason là bổ sung tuỳ chọn`, async () => {
      await i18n.changeLanguage(locale);
      const withoutReason = translateAppError(
        "PERMISSION_DENIED",
        { action: "viewTrustEnforcementCenter" },
        "fallback",
      );
      const withReason = translateAppError(
        "PERMISSION_DENIED",
        { action: "viewTrustEnforcementCenter", reason: "needsAdminSystemOrMachineControl" },
        "fallback",
      );
      expect(hasUnresolvedPlaceholder(withoutReason)).toBe(false);
      expect(hasUnresolvedPlaceholder(withReason)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(withReason)).toBe(false);
      expect(withReason).not.toBe(withoutReason);
    });
  }
});

describe("translateAppError — reason KHÔNG phá mã CHƯA có bản _WITH_REASON (bất biến cũ)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: ENTITY_NOT_FOUND + reason lạ ⇒ rơi về câu gốc, không sập, không lộ placeholder`, async () => {
      await i18n.changeLanguage(locale);
      // ENTITY_NOT_FOUND chưa từng có khoá `_WITH_REASON` — đây chính là nhánh
      // "thiếu khoá ⇒ fallback lặng lẽ" mà translateAppError() phải xử lý an toàn.
      const out = translateAppError(
        "ENTITY_NOT_FOUND",
        { entity: "product", reason: "somethingNotYetMapped" },
        "Product not found",
      );
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).not.toBe("Product not found"); // vẫn dịch được theo entity
    });
  }
});

describe("translateAppError — nội suy lồng dùng tham số động THẬT (score/validRoles/minSamples)", () => {
  it("productReadinessBlocked mang readiness score + force=true", async () => {
    await i18n.changeLanguage("vi");
    const out = translateAppError(
      "OPERATION_FAILED",
      { operation: "assignProductToMachine", reason: "productReadinessBlocked", productCode: "SP-01", score: 42 },
      "fallback",
    );
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
    expect(out).toContain("42");
    expect(out).toContain("force=true");
  });

  it("unknownBuiltInRole mang danh sách role hợp lệ", async () => {
    await i18n.changeLanguage("vi");
    const out = translateAppError(
      "INVALID_VALUE",
      { field: "builtInRole", reason: "unknownBuiltInRole", validRoles: "admin, operator, engineer" },
      "fallback",
    );
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
    expect(out).toContain("admin, operator, engineer");
  });

  it("insufficientCpkSamples mang cả số mẫu thực tế lẫn ngưỡng tối thiểu", async () => {
    await i18n.changeLanguage("vi");
    const out = translateAppError(
      "OPERATION_FAILED",
      { operation: "calculateCpkCapability", reason: "insufficientCpkSamples", sampleCount: 12, minSamples: 30 },
      "fallback",
    );
    expect(hasUnresolvedPlaceholder(out)).toBe(false);
    expect(out).toContain("12");
    expect(out).toContain("30");
  });
});

// Review round 1 (M-2) — reviewer dựng harness i18next THẬT tái hiện: một giá trị
// TỰ DO (không phải 1 trong 7 khoá từ điển — vd `lineName` do admin đặt tên) tình
// cờ CHỨA cú pháp `{{...}}`/`$t(...)` của i18next có thể làm LÒI placeholder THẬT
// ra màn hình thô (giá trị "cướp chỗ" một placeholder khác trong CÙNG template
// nhiều-placeholder). Test dưới đây dùng ĐÚNG kịch bản reviewer tái hiện:
// `lineName = "{{maxConcurrent}}"` trong template `lineCapacityExceeded` (có CẢ
// {{lineName}} lẫn {{maxConcurrent}}).
describe("translateAppError — M-2: giá trị tự do chứa {{...}}/$t(...) không được làm lòi placeholder khác", () => {
  for (const locale of LOCALES) {
    it(`${locale}: lineName="{{maxConcurrent}}" ⇒ maxConcurrent thật vẫn hiện đúng, không lòi {{...}} thô`, async () => {
      await i18n.changeLanguage(locale);
      const out = translateAppError(
        "OPERATION_FAILED",
        {
          operation: "rescheduleProductionOrder",
          reason: "lineCapacityExceeded",
          lineName: "{{maxConcurrent}}", // giá trị ĐỘC — y hệt ca reviewer tái hiện
          maxConcurrent: 2,
          currentCount: 3,
        },
        "fallback",
      );
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      // Giá trị THẬT của maxConcurrent (2) phải xuất hiện, KHÔNG bị giá trị lineName
      // độc hại "cướp chỗ" — nếu lỗi tái phát, "2" sẽ bị thay bởi chuỗi lineName.
      expect(out).toContain("2");
    });

    it(`${locale}: productCode chứa "$t(...)" ⇒ không kích hoạt nesting, không lòi placeholder`, async () => {
      await i18n.changeLanguage(locale);
      const out = translateAppError(
        "OPERATION_FAILED",
        {
          operation: "assignProductToMachine",
          reason: "productReadinessBlocked",
          productCode: "$t(errors.reason.scheduleConflict)",
          score: 42,
        },
        "fallback",
      );
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(out).not.toContain("$t(");
      expect(out).toContain("42");
    });
  }
});

// Review round 1 (M-5) — reviewer chỉ ra lý lẽ "enrich câu TĨNH TWO_FACTOR_NOT_SET_UP
// có lợi cho cả 6 caller" SAI với 2/6 (disable/disable2FA — người dùng đang TẮT
// 2FA, bảo "đi thiết lập" là ngược ý định). Câu TĨNH đã trả về nguyên bản (không
// chỉ dẫn); reason CHỈ áp cho 4/6 call site cần "đi thiết lập".
describe("translateAppError — TWO_FACTOR_NOT_SET_UP: câu TĨNH trung lập, reason chỉ khi CẦN thiết lập (M-5)", () => {
  for (const locale of LOCALES) {
    it(`${locale}: KHÔNG reason (vd luồng disable) ⇒ câu trung lập, KHÔNG chứa chỉ dẫn "đi thiết lập"`, async () => {
      await i18n.changeLanguage(locale);
      const out = translateAppError("TWO_FACTOR_NOT_SET_UP", undefined, "2FA is not enabled");
      expect(hasUnresolvedPlaceholder(out)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(out)).toBe(false);
    });

    it(`${locale}: CÓ reason='setUpInSecuritySettings' (vd luồng verify/sign) ⇒ câu dài hơn, mang chỉ dẫn`, async () => {
      await i18n.changeLanguage(locale);
      const withoutReason = translateAppError("TWO_FACTOR_NOT_SET_UP", undefined, "2FA is not enabled");
      const withReason = translateAppError(
        "TWO_FACTOR_NOT_SET_UP",
        { reason: "setUpInSecuritySettings" },
        "2FA is not enabled",
      );
      expect(hasUnresolvedPlaceholder(withReason)).toBe(false);
      expect(hasStrayWhitespaceOrPunctuation(withReason)).toBe(false);
      expect(withReason).not.toBe(withoutReason);
      expect(withReason.length).toBeGreaterThan(withoutReason.length);
    });
  }
});
