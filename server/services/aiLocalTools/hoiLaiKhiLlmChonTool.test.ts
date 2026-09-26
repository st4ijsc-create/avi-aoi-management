/**
 * ★ PDCA vòng 13 (2026-09-25) — câu hỏi lại của heuristic ("Bạn đang hỏi về lô sản xuất nào?…") phải SỐNG SÓT khi bộ chọn
 * LLM chọn một tool. Trước đây `decision = llm` đánh rơi nó: câu "lô của tôi sao rồi?" (thiếu mã) ⇒ LLM chọn tool ⇒ tool
 * không ra gì ⇒ người dùng chỉ nhận lời từ chối chuẩn, không được hỏi mã lô/máy (đo: C01 C03 bộ đối chứng sống). Và nhánh
 * INVALID_ARGS của heuristic (khớp tool máy nhưng thiếu machineCode — C03) KHÔNG có câu hỏi lại nào.
 * Seam: mock `classifyToolIntentLLM` (đúng chỗ bộ chọn LLM đứng); heuristic `classifyToolIntent` là mã THẬT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ llm: { tool: null as string | null, args: {}, reason: "LLM_NONE" } as Record<string, unknown> }));

vi.mock("./intentClassifier", async (importOriginal) => {
  const that = await importOriginal<typeof import("./intentClassifier")>();
  return { ...that, classifyToolIntentLLM: async () => h.llm };
});

import { tryExecuteTool } from "./index";

beforeEach(() => {
  h.llm = { tool: null, args: {}, reason: "LLM_NONE" };
});

describe("giữ câu hỏi lại của heuristic", () => {
  it("★★★ LLM CHỌN tool cho câu thiếu mã ⇒ quyết định vẫn mang câu hỏi lại (mã lô)", async () => {
    h.llm = { tool: "get_lot_status", args: {}, reason: "LLM_PICK" };
    const r = await tryExecuteTool("lô của tôi sao rồi?");
    expect(r.decision.tool).toBe("get_lot_status");
    expect(r.decision.clarifyMessage ?? "").toMatch(/mã lệnh|mã lô/);
  });
  it("★★★ heuristic khớp tool nhưng THIẾU tham số (machineCode) ⇒ vẫn có câu hỏi lại (máy nào) — C03", async () => {
    const r = await tryExecuteTool("tình trạng thiết bị hiện tại ra sao?");
    expect(r.decision.tool).toBeNull();
    expect(r.decision.clarifyMessage ?? "").toMatch(/máy nào/);
  });
  it("★ câu hỏi lại RIÊNG của LLM (nếu có) thắng câu của heuristic", async () => {
    h.llm = { tool: "get_lot_status", args: {}, reason: "LLM_PICK", clarifyMessage: "Câu hỏi lại của LLM" };
    const r = await tryExecuteTool("lô của tôi sao rồi?");
    expect(r.decision.clarifyMessage).toBe("Câu hỏi lại của LLM");
  });
});
