/**
 * doc 81 Đợt 2 Task 12b (Ruling R-2-r, mục c) — lỗi lệch dự án ở biên deploy
 * (`CONFLICT · INVALID_VALUE{field:"expectedProjectId", reason:"buildNotInProject"}`, ném bởi
 * `assertBuildInExpectedProject`) phải thành CÂU NGƯỜI ĐỌC ĐƯỢC qua đúng helper client
 * (`translateAppError`, dùng bởi `toastTrpcError`) ở cả vi/en/zh — không khoá trần, không rơi về
 * thông điệp tiếng Việt của máy chủ. Bundle i18n THẬT (đọc thẳng 3 file locale), mỗi ca tự
 * `changeLanguage` tường minh (khuôn `errorCodes.stopPinReason.unit.test.ts`).
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

const PARAMS = { field: "expectedProjectId", reason: "buildNotInProject" };

describe("Task 12b — errors.reason.buildNotInProject + errors.field.expectedProjectId dịch được ở vi/en/zh", () => {
  it("khoá tồn tại ở cả ba bundle", () => {
    for (const lg of ["vi", "en", "zh"]) {
      expect(i18n.getResource(lg, "translation", "errors.reason.buildNotInProject"), lg).toBeTruthy();
      expect(i18n.getResource(lg, "translation", "errors.field.expectedProjectId"), lg).toBeTruthy();
    }
  });

  it("vi/en/zh là câu thật, khác nhau, mang cả trường lẫn lý do; không khoá trần, không fallback máy chủ", async () => {
    const cau: Record<string, string> = {};
    for (const lg of ["vi", "en", "zh"]) {
      await i18n.changeLanguage(lg);
      cau[lg] = translateAppError("INVALID_VALUE", PARAMS, "__FALLBACK_SERVER__");
      expect(cau[lg], lg).not.toBe("__FALLBACK_SERVER__");
      expect(cau[lg], lg).not.toContain("buildNotInProject");
      expect(cau[lg], lg).not.toMatch(/\{\{|\}\}/);
    }
    expect(new Set(Object.values(cau)).size).toBe(3);
    expect(cau.vi).toContain("không thuộc dự án đang mở");
    expect(cau.en).toContain("does not belong to the open project");
    expect(cau.zh).toContain("不属于当前打开的项目");
  });
});
