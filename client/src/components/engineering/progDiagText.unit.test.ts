/**
 * doc 80 Đợt 1 Task 7 — chẩn đoán ST hiển thị theo ngôn ngữ UI (i18next THẬT + locale THẬT).
 */
import { describe, it, expect } from "vitest";
import i18next from "i18next";
import vi from "@/i18n/locales/vi.json";
import en from "@/i18n/locales/en.json";
import zh from "@/i18n/locales/zh.json";
import { progDiagText } from "./progDiagText";

async function tFor(lng: string) {
  const inst = i18next.createInstance();
  await inst.init({
    lng,
    resources: { vi: { translation: vi }, en: { translation: en }, zh: { translation: zh } },
    interpolation: { escapeValue: false },
  });
  return inst.t;
}

const D = {
  severity: "error",
  message: "'TON' has no member 'OUT' (valid: IN, PT, Q, ET).",
  line: 3,
  col: 8,
  code: "stNoMember",
  params: { type: "TON", member: "OUT", valid: "IN, PT, Q, ET" },
};

describe("progDiagText", () => {
  it("dịch theo code + params, kèm dòng:cột", async () => {
    expect(progDiagText(await tFor("vi"), D)).toBe("L3:8: 'TON' không có thành viên 'OUT' (hợp lệ: IN, PT, Q, ET).");
    expect(progDiagText(await tFor("en"), D)).toBe("L3:8: 'TON' has no member 'OUT' (valid: IN, PT, Q, ET).");
    expect(progDiagText(await tFor("zh"), D)).toBe("L3:8: 'TON' 没有成员 'OUT'（有效：IN, PT, Q, ET）。");
  });
  it("chẩn đoán không có code (adapter khác / safety linter) ⇒ giữ message như trước", async () => {
    const t = await tFor("vi");
    expect(progDiagText(t, { severity: "warning", message: "Unbounded loop.", line: 4 })).toBe("L4: Unbounded loop.");
    expect(progDiagText(t, { severity: "warning", message: "No rungs parsed." })).toBe("No rungs parsed.");
  });
  it("code lạ (chưa có khoá) ⇒ rơi về message server, không lộ khoá thô", async () => {
    const t = await tFor("vi");
    expect(progDiagText(t, { severity: "error", message: "Something new.", line: 1, col: 2, code: "stSomethingNew" })).toBe("L1:2: Something new.");
  });
});
