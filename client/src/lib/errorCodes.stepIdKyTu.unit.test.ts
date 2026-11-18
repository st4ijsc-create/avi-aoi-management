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

describe("ba luật thêm (độ dài / tiền tố abort: / dấu [[A2N) — câu i18n vi/en/zh", () => {
  const CA: Array<{ reason: string; params: Record<string, string | number>; chua: string[] }> = [
    { reason: "stepIdQuaDai", params: { doDai: 150, toiDa: 128 }, chua: ["150", "128"] },
    { reason: "stepIdTienToAbort", params: {}, chua: ["abort:"] },
    { reason: "stepIdDauHieuRieng", params: {}, chua: ["[[A2N"] },
  ];
  for (const c of CA) {
    it(`INVALID_VALUE + reason ${c.reason}: có đủ ba ngôn ngữ, nêu đúng số/chuỗi, không fallback, không khoá trần, không {{`, async () => {
      const cau: Record<string, string> = {};
      for (const lg of ["vi", "en", "zh"]) {
        await i18n.changeLanguage(lg);
        cau[lg] = translateAppError("INVALID_VALUE", { field: "steps[1].id", reason: c.reason, ...c.params }, "__FALLBACK_SERVER__");
        expect(cau[lg], lg).not.toBe("__FALLBACK_SERVER__");
        expect(cau[lg], lg).toContain("steps[1].id");
        for (const s of c.chua) expect(cau[lg], `${lg}/${s}`).toContain(s);
        expect(cau[lg], lg).not.toContain(c.reason);
        expect(cau[lg], lg).not.toContain("{{");
      }
      expect(new Set(Object.values(cau)).size).toBe(3);
    });
  }

  it("câu Studio của từng luật thay đủ {{path}} / {{doDai}} / {{toiDa}} ở ba ngôn ngữ", async () => {
    const KHOA: Array<[string, Record<string, string | number>, string[]]> = [
      ["studio.deployStepIdQuaDai", { path: "steps[0].id", doDai: 150, toiDa: 128 }, ["steps[0].id", "150", "128"]],
      ["studio.deployStepIdTienToAbort", { path: "steps[0].id" }, ["steps[0].id", "abort:"]],
      ["studio.deployStepIdDauHieuRieng", { path: "steps[0].id" }, ["steps[0].id", "[[A2N"]],
    ];
    for (const lg of ["vi", "en", "zh"]) {
      await i18n.changeLanguage(lg);
      for (const [k, p, chua] of KHOA) {
        const s = i18n.t(k, p);
        for (const x of chua) expect(s, `${lg}/${k}/${x}`).toContain(x);
        expect(s, `${lg}/${k}`).not.toContain("{{");
        expect(s, `${lg}/${k}`).not.toBe(k);
      }
    }
  });
});
