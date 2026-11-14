/**
 * Luật ĐẦU VÀO step id MỚI — câu người dùng thấy khi sao chép workflow có step id chứa ký tự cấm (INVALID_VALUE + reason "stepIdKyTuCam",
 * server/routers/orchestrationRouter.ts) và khi triển khai bị từ chối (khoá studio.deployStepIdKyTu). Phải có đủ vi / en / zh,
 * nêu đúng vị trí step + ký tự vi phạm, không rơi về fallback, không lộ khoá trần.
 * Bundle i18n THẬT (đọc thẳng 3 file locale), mỗi ca tự changeLanguage tường minh.
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
  for (const lg of ["vi", "en", "zh"]) i18n.addResourceBundle(lg, "translation", localeJson(`../i18n/locales/${lg}.json`), true, true);
});
afterAll(async () => {
  await i18n.changeLanguage("vi");
});

const PARAMS = { field: "steps[2].id", reason: "stepIdKyTuCam", kyTu: '","' };

describe("step id chứa ký tự cấm — câu i18n ở vi/en/zh", () => {
  it("khoá tồn tại ở cả ba ngôn ngữ", () => {
    for (const lg of ["vi", "en", "zh"]) {
      expect(i18n.getResource(lg, "translation", "errors.reason.stepIdKyTuCam"), `${lg} reason`).toBeTruthy();
      expect(i18n.getResource(lg, "translation", "studio.deployStepIdKyTu"), `${lg} studio`).toBeTruthy();
    }
  });

  it("INVALID_VALUE + reason: nêu vị trí step và ký tự vi phạm, khác nhau giữa ba ngôn ngữ, không fallback, không khoá trần, không {{", async () => {
    const cau: Record<string, string> = {};
    for (const lg of ["vi", "en", "zh"]) {
      await i18n.changeLanguage(lg);
      cau[lg] = translateAppError("INVALID_VALUE", PARAMS, "__FALLBACK_SERVER__");
      expect(cau[lg], lg).not.toBe("__FALLBACK_SERVER__");
      expect(cau[lg], lg).toContain("steps[2].id");
      expect(cau[lg], lg).toContain('","');
      expect(cau[lg], lg).not.toContain("stepIdKyTuCam");
      expect(cau[lg], lg).not.toContain("{{");
    }
    expect(new Set(Object.values(cau)).size).toBe(3);
    expect(cau.vi).toContain("Mã bước");
    expect(cau.en).toContain("step id");
    expect(cau.zh).toContain("步骤 ID");
  });

  it("câu của màn Studio nêu {{path}} và {{kyTu}} đã thay thế ở cả ba ngôn ngữ", async () => {
    for (const lg of ["vi", "en", "zh"]) {
      await i18n.changeLanguage(lg);
      const s = i18n.t("studio.deployStepIdKyTu", { path: "steps[0].id", kyTu: '"("' });
      expect(s, lg).toContain("steps[0].id");
      expect(s, lg).toContain('"("');
      expect(s, lg).not.toContain("{{");
    }
  });
});
