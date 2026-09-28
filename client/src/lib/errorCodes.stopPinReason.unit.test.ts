/**
 * doc 81 Đợt 1D Task 3 (Ruling R-1D-i) — phép kiểm dịch cho `appParams.stopPinReason`
 * (server/services/ot/commandDispatcher.ts, `StopPinRefusalReason` — 7 giá trị: một OT
 * stop bị từ chối vì KHÔNG khớp ghim mang thêm tham số này, CẠNH `reason:
 * "softwareStopRefusedUseHardwareEstop"` vốn đã dịch từ trước). Người vận hành phải thấy
 * một CÂU NGƯỜI ĐỌC ĐƯỢC ở cả ba ngôn ngữ — không phải khoá trần (`no_pins` hiện thẳng ra
 * màn hình), không rơi về `fallback` (nghĩa là câu chính vẫn tiếng Anh máy chủ), và không
 * lộ tên cờ `.env` (khuôn UPPER_SNAKE_CASE, như một số `errors.reason.*` cũ đã lỡ làm).
 *
 * Cùng kỷ luật `trpcErrors.locale.unit.test.ts`: bundle i18n THẬT (đọc thẳng 3 file locale
 * bằng readFileSync — không phải fixture chép tay, không phải fetch `?url` bất đồng bộ của
 * app thật), và mỗi ca tự `changeLanguage` tường minh, không dựa vào ngôn ngữ mặc định của
 * môi trường test (jsdom/node báo "en" từ `navigator`/`Intl`, KHÔNG phải "vi").
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { translateAppError } from "./errorCodes";

import "../i18n";
import i18n from "i18next";

const HERE = dirname(fileURLToPath(import.meta.url));
const localeJson = (rel: string) => JSON.parse(readFileSync(join(HERE, rel), "utf8"));

beforeAll(() => {
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
  i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
  i18n.addResourceBundle("zh", "translation", localeJson("../i18n/locales/zh.json"), true, true);
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});

/** Verbatim từ `StopPinRefusalReason` (commandDispatcher.ts) — 7 giá trị, không phải 6 mà
 *  bản tóm tắt của brief liệt kê (brief bỏ sót `pin_load_failed`, xem stopPinReasonOf()). */
const STOP_PIN_REASONS = [
  "no_pins",
  "empty_writes",
  "unpinned_tag",
  "value_mismatch",
  "duplicate_tag",
  "pin_load_failed",
  "pin_tag_changed",
] as const;

/** Đúng shape `appParams` của `SOFTWARE_STOP_REFUSED_APP_ERROR` (commandDispatcher.ts)
 *  cộng `stopPinReason` — appCode `OPERATION_FAILED`, luôn mang `reason` TĨNH đó. */
function paramsCho(stopPinReason: string) {
  return { operation: "softwareStop", reason: "softwareStopRefusedUseHardwareEstop", stopPinReason };
}

/** Tên cờ .env kiểu UPPER_SNAKE_CASE (≥ 2 đoạn) — không được lộ ra câu người dùng đọc
 *  (brief: "no env-var names"). Khớp cả dạng có dấu `=` theo sau (mqttPasswordNotEnforced
 *  cũ lỡ phạm — không phải khuôn tôi đang thêm, nhưng thước phải bắt được NẾU tôi phạm). */
const ENV_VAR_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/;

describe("R-1D-i — errors.stopPinReason.* dịch được ở vi/en/zh (không khoá trần, không lộ .env)", () => {
  it("cầu chì: ba bundle phải NẠP THẬT, và khoá errors.stopPinReason.* phải tồn tại", () => {
    for (const lg of ["vi", "en", "zh"]) {
      expect(i18n.hasResourceBundle(lg, "translation"), `bundle ${lg}`).toBe(true);
      for (const reason of STOP_PIN_REASONS) {
        expect(i18n.getResource(lg, "translation", `errors.stopPinReason.${reason}`), `${lg}/${reason}`).toBeTruthy();
      }
    }
  });

  for (const reason of STOP_PIN_REASONS) {
    it(`★ ${reason} — vi/en/zh đều là câu thật, khác nhau, không lộ khoá trần hay cờ .env`, async () => {
      await i18n.changeLanguage("vi");
      const vi = translateAppError("OPERATION_FAILED", paramsCho(reason), "__FALLBACK_SERVER__");
      await i18n.changeLanguage("en");
      const en = translateAppError("OPERATION_FAILED", paramsCho(reason), "__FALLBACK_SERVER__");
      await i18n.changeLanguage("zh");
      const zh = translateAppError("OPERATION_FAILED", paramsCho(reason), "__FALLBACK_SERVER__");

      for (const [lg, cau] of [["vi", vi], ["en", en], ["zh", zh]] as const) {
        expect(cau, `${lg}/${reason} không được rơi về fallback`).not.toBe("__FALLBACK_SERVER__");
        expect(cau, `${lg}/${reason} không được lộ khoá trần`).not.toContain(reason);
        expect(cau, `${lg}/${reason} không được lộ tên cờ .env`).not.toMatch(ENV_VAR_RE);
      }
      // Ba ngôn ngữ phải THẬT SỰ khác nhau (không phải cùng rơi về một fallback chung).
      expect(new Set([vi, en, zh]).size, reason).toBe(3);
      // Câu TĨNH gốc (đã dịch từ trước, R-1C-g) vẫn còn mặt — nối THÊM, không thay thế.
      expect(vi).toContain("Lệnh dừng phần mềm đã bị TỪ CHỐI");
      expect(en).toContain("The software stop was REFUSED");
      expect(zh).toContain("软件停止命令被拒绝");
    });
  }

  it("KHÔNG có stopPinReason ⇒ câu byte-identical với trước (chỉ NỐI THÊM khi tham số có mặt)", async () => {
    await i18n.changeLanguage("vi");
    const khongCo = translateAppError(
      "OPERATION_FAILED",
      { operation: "softwareStop", reason: "softwareStopRefusedUseHardwareEstop" },
      "fallback",
    );
    const coStopPinReason = translateAppError("OPERATION_FAILED", paramsCho("no_pins"), "fallback");
    // Câu KHÔNG có tham số phải là chuỗi CON đứng ở ĐẦU câu CÓ tham số (nối thêm ở cuối,
    // không sửa/không cắt phần trước — Global Constraint #8: giữ nguyên hành vi ngoài phạm vi).
    expect(coStopPinReason.startsWith(khongCo)).toBe(true);
    expect(coStopPinReason.length).toBeGreaterThan(khongCo.length);
    expect(khongCo).not.toMatch(ENV_VAR_RE);
  });

  it("stopPinReason rỗng/không phải chuỗi ⇒ bỏ qua, hành vi như KHÔNG có tham số (phòng thủ)", async () => {
    await i18n.changeLanguage("vi");
    const base = translateAppError(
      "OPERATION_FAILED",
      { operation: "softwareStop", reason: "softwareStopRefusedUseHardwareEstop" },
      "fallback",
    );
    const rong = translateAppError(
      "OPERATION_FAILED",
      { operation: "softwareStop", reason: "softwareStopRefusedUseHardwareEstop", stopPinReason: "" },
      "fallback",
    );
    expect(rong).toBe(base);
  });
});
