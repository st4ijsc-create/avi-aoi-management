/**
 * doc 81 Đợt 1E Task 1 fix round 1 (review I-1, plan Global Constraint 3) — một lệnh OT đang CHỜ trong hàng đợi
 * per-adapter bị huỷ vì một lệnh DỪNG ghim xếp sau nó (ruling R-1E-a) mang `appError`
 * `OT_COMMAND_SUPERSEDED_BY_STOP` (`appParams.stopKey`). Người vận hành phải đọc được câu ở cả ba ngôn ngữ — câu
 * nói rõ lệnh của họ ĐÃ BỊ HUỶ và phải GỬI LẠI — không phải mã trần, không rơi về `fallback`, không lộ tên cờ `.env`.
 *
 * Bundle i18n THẬT (đọc thẳng 3 tệp locale), mỗi ca `changeLanguage` tường minh. Oracle câu tiếng Việt là câu chủ dự
 * án/điều phối viên đưa NGUYÊN VĂN (không lấy từ tệp locale).
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

const CODE = "OT_COMMAND_SUPERSEDED_BY_STOP";
const PARAMS = { stopKey: "act-123:cmd_stop:0" };
const TEN_CO = /[A-Z][A-Z0-9]+_[A-Z0-9_]+/; // OT_CMD_QUEUE_MAX, OT_COMMAND_… — không được lộ ra câu

describe("Đợt 1E I-1 — OT_COMMAND_SUPERSEDED_BY_STOP có câu ở vi/en/zh", () => {
  it("vi: đúng câu đã duyệt (lệnh chờ bị huỷ vì DỪNG — gửi lại nếu cần), Đợt 4 C7: kèm KHOÁ lệnh DỪNG", async () => {
    await i18n.changeLanguage("vi");
    expect(translateAppError(CODE, PARAMS, "__FALLBACK__")).toBe("Lệnh đang chờ đã bị huỷ vì có lệnh DỪNG (act-123:cmd_stop:0) — gửi lại nếu cần.");
  });

  for (const lng of ["vi", "en", "zh"] as const) {
    it(`doc 81 Đợt 4 C7 — ${lng}: câu mang ĐÚNG khoá lệnh DỪNG (appParams.stopKey) — người vận hành tra được lệnh nào đã huỷ lệnh của họ`, async () => {
      await i18n.changeLanguage(lng);
      expect(translateAppError(CODE, PARAMS, "__FALLBACK__")).toContain("act-123:cmd_stop:0");
      expect(translateAppError(CODE, { stopKey: "khac-9" }, "__FALLBACK__")).toContain("khac-9");
      const raw = String(i18n.getResource(lng, "translation", `errors.${CODE}`) ?? "");
      expect(raw.match(/\{\{stopKey\}\}/g) ?? []).toHaveLength(1);
    });
  }

  for (const lng of ["vi", "en", "zh"] as const) {
    it(`${lng}: câu dịch, không fallback, không mã trần, không tên cờ`, async () => {
      await i18n.changeLanguage(lng);
      const s = translateAppError(CODE, PARAMS, "__FALLBACK__");
      expect(s).not.toBe("__FALLBACK__");
      expect(s.length).toBeGreaterThan(8);
      expect(s).not.toContain(CODE);
      expect(s).not.toMatch(TEN_CO);
      expect(s).not.toMatch(/\{\{|\}\}/); // không còn placeholder chưa nội suy
    });
  }

  it("en / zh nói đúng hai ý: đã HUỶ + GỬI LẠI", async () => {
    await i18n.changeLanguage("en");
    const en = translateAppError(CODE, PARAMS, "__FALLBACK__");
    expect(en).toMatch(/cancel/i);
    expect(en).toMatch(/resend/i);
    expect(en).toMatch(/STOP/);
    await i18n.changeLanguage("zh");
    const zh = translateAppError(CODE, PARAMS, "__FALLBACK__");
    expect(zh).toMatch(/取消/);
    expect(zh).toMatch(/重新发送/);
  });
});
