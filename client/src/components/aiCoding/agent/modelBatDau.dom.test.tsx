// @vitest-environment jsdom
//
// Đợt 9 — tác nhân theo VAI TRÒ: (1) reducer đọc `bat-dau.model`; (2) dòng "Đang chạy <model> · vai trò …" (cờ tắt ⇒ DOM y như cũ);
// (3) năm mã từ chối mới của POST /api/ai/agent/runs hiện CÂU ĐÃ DỊCH ở cả vi/en/zh — không bao giờ mã thô.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SuKienAgent } from "@shared/agentCore/kieu";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()), // giữ initReactI18next cho i18n THẬT ở nhóm mã từ chối
  useTranslation: () => ({ t: (k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : k) }),
}));
vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div>{p.children}</div> }));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));

import { DongModelBatDau } from "./DongThoiGianAgent";
import { TRANG_THAI_RONG, batDauGui, giamSuKien } from "./trangThaiAgent";
import { thongDiepLoiRest } from "@/lib/restAuthError";
import "../../../i18n";
import i18n from "i18next";

afterEach(cleanup);

const batDau = (model?: { vaiTro: string; model: string | null; nguon: string; bangChung: string }): SuKienAgent =>
  ({ loai: "bat-dau", runId: "r1", cheDo: "duyet", ...(model ? { model } : {}) }) as unknown as SuKienAgent;

describe("reducer — bat-dau.model", () => {
  it("cờ TẮT (không có `model`) ⇒ modelBatDau null — trạng thái giống hệt cũ", () => {
    const s = giamSuKien(batDauGui("hỏi", "duyet" as never), batDau());
    expect(s.modelBatDau).toBeNull();
    expect(s.runId).toBe("r1");
    expect(TRANG_THAI_RONG.modelBatDau).toBeNull();
  });
  it("cờ BẬT ⇒ giữ nguyên {vaiTro, model, nguon, bangChung}; lượt mới không mang model ⇒ xoá về null", () => {
    const m = { vaiTro: "code.plc", model: "Qwen3.6-27B-UD-Q4_K_XL", nguon: "gan-profile", bangChung: "dự án PLC; gán global" };
    const s1 = giamSuKien(batDauGui("hỏi", "duyet" as never), batDau(m));
    expect(s1.modelBatDau).toEqual(m);
    const s2 = giamSuKien(s1, batDau());
    expect(s2.modelBatDau).toBeNull();
  });
});

describe("DongModelBatDau", () => {
  it("null ⇒ không vẽ gì (DOM như cũ)", () => {
    const { container } = render(<DongModelBatDau m={null} dangChay />);
    expect(container).toBeEmptyDOMElement();
  });
  it("code.plc đang chạy ⇒ 'Đang chạy <model> · vai trò code.plc (dự án PLC)'; bằng chứng ở tooltip; KHÔNG nhãn dự phòng", () => {
    render(<DongModelBatDau dangChay m={{ vaiTro: "code.plc", model: "Qwen3.6-27B-UD-Q4_K_XL", nguon: "gan-profile", bangChung: "chọn tường minh" }} />);
    const e = screen.getByTestId("agent-model-bat-dau");
    expect(e).toHaveTextContent("Đang chạy Qwen3.6-27B-UD-Q4_K_XL · vai trò code.plc (dự án PLC)");
    expect(e).toHaveAttribute("title", "chọn tường minh");
    expect(screen.queryByTestId("agent-model-du-phong")).toBeNull();
  });
  it("dự phòng ⇒ nhãn 'dự phòng'; lượt xong ⇒ 'Đã chạy'; model null ⇒ 'model mặc định'; code.software ⇒ dự án phần mềm", () => {
    render(<DongModelBatDau dangChay={false} m={{ vaiTro: "code.software", model: null, nguon: "du-phong", bangChung: "khe giữ model khác" }} />);
    const e = screen.getByTestId("agent-model-bat-dau");
    expect(e).toHaveTextContent("Đã chạy model mặc định của engine · vai trò code.software (dự án phần mềm)");
    expect(screen.getByTestId("agent-model-du-phong")).toHaveTextContent("dự phòng");
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const locale = (lg: string) => JSON.parse(readFileSync(join(HERE, `../../../i18n/locales/${lg}.json`), "utf8"));
const MA_MOI = ["AI_KHONG_CO_MODEL", "AI_GIOI_HAN_TAN_SUAT", "AI_HET_HAN_MUC", "AI_CHAN_AN_TOAN", "AI_CHUA_CAP_PHEP"] as const;

describe("mã từ chối mới của POST /api/ai/agent/runs ⇒ câu ĐÃ DỊCH", () => {
  beforeAll(() => {
    for (const lg of ["vi", "en", "zh"]) i18n.addResourceBundle(lg, "translation", locale(lg), true, true);
  });
  afterAll(async () => {
    await i18n.changeLanguage("vi");
  });

  it("mỗi mã × mỗi ngôn ngữ: không phải mã thô, không phải câu dự phòng thô, ba ngôn ngữ KHÁC nhau", async () => {
    for (const ma of MA_MOI) {
      const ra: Record<string, string> = {};
      for (const lg of ["vi", "en", "zh"]) {
        await i18n.changeLanguage(lg);
        // thân y như server trả: { success:false, code, message? } — `message` của server KHÔNG được thắng câu đã dịch
        ra[lg] = thongDiepLoiRest({ code: ma, error: "raw server text" }, "Agent stream failed (503)");
        expect(ra[lg], `${ma}/${lg}`).not.toBe(ma);
        expect(ra[lg], `${ma}/${lg}`).not.toContain("raw server text");
        expect(ra[lg], `${ma}/${lg}`).not.toContain("Agent stream failed");
        expect(ra[lg], `${ma}/${lg}`).not.toMatch(/^errors\./);
      }
      expect(new Set(Object.values(ra)).size, ma).toBe(3);
    }
  });

  it("en: câu nói đúng việc (model khe khoá · tần suất · hạn mức · an toàn · giấy phép)", async () => {
    await i18n.changeLanguage("en");
    expect(thongDiepLoiRest({ code: "AI_KHONG_CO_MODEL" }, "x")).toMatch(/No model is available/);
    expect(thongDiepLoiRest({ code: "AI_GIOI_HAN_TAN_SUAT" }, "x")).toMatch(/too fast/);
    expect(thongDiepLoiRest({ code: "AI_HET_HAN_MUC" }, "x")).toMatch(/quota/);
    expect(thongDiepLoiRest({ code: "AI_CHAN_AN_TOAN" }, "x")).toMatch(/safety layer/);
    expect(thongDiepLoiRest({ code: "AI_CHUA_CAP_PHEP" }, "x")).toMatch(/licence/);
  });
});
