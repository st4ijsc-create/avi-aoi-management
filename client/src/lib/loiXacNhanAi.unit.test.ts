/**
 * R1b-1 T10 fix round 1 (I-2) — nhận dạng lỗi "AI không bao giờ ra lệnh mức ≥ 4" từ lỗi tRPC của `aiCopilot.confirmAction`, và khoá i18n thật
 * (vi/en/zh) của nó: câu dịch phải ra ĐÚNG ngôn ngữ, mang mức, không lộ khoá.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MA_AI_MUC_QUA_CAO, laTuChoiAiMucCao } from "./loiXacNhanAi";

const LOCALES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "i18n", "locales");

describe("laTuChoiAiMucCao", () => {
  it("nhận đúng appCode; không nhầm mã khác / lỗi lạ", () => {
    expect(laTuChoiAiMucCao({ data: { appCode: "SCADA_AI_LEVEL_TOO_HIGH" } })).toBe(true);
    expect(MA_AI_MUC_QUA_CAO).toBe("SCADA_AI_LEVEL_TOO_HIGH");
    for (const e of [{ data: { appCode: "SCADA_ROLE_FLOOR" } }, { data: {} }, {}, null, undefined, "x", new Error("x")]) {
      expect(laTuChoiAiMucCao(e)).toBe(false);
    }
  });
});

describe("khoá i18n SCADA_AI_LEVEL_TOO_HIGH", () => {
  for (const [lang, mau] of [
    ["vi", /Trợ lý AI/],
    ["en", /AI assistant/],
    ["zh", /AI 助手/],
  ] as const) {
    it(`${lang}: có khoá, mang {{level}}`, () => {
      const j = JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8"));
      const v = JSON.stringify(j).match(/"SCADA_AI_LEVEL_TOO_HIGH":\s*"([^"]+)"/)?.[1] ?? "";
      expect(v).toMatch(mau);
      expect(v).toContain("{{level}}");
    });
  }
});
