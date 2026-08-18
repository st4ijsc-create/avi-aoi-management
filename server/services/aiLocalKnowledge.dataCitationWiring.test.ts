/**
 * ★★★ NỐI DÂY trích dẫn NGUỒN DỮ LIỆU — đo trên PIPELINE THẬT, **CẢ HAI ĐƯỜNG THOÁT**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CÓ FILE NÀY, KHI `ai/dataCitation.test.ts` ĐÃ XANH
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Bộ ca kia kiểm HÀM THUẦN. Nó **không thể** phát hiện hàm ấy chưa được ai gọi, hoặc chỉ
 * được gọi ở `answerQuestion` mà quên `streamAnswer` — đúng lớp lỗi *"lưới theo FILE,
 * không theo ĐƯỜNG THOÁT"* mà repo này đã dính **11 lần**, và `/stream` mới là đường
 * người dùng đi nhiều hơn. File này đi từ ĐẦU ĐƯỜNG cho cả hai.
 *
 * Bốn điều được ghim:
 *   §1 — `answerQuestion` phát hoá đơn + nối dòng nguồn vào chuỗi người đọc thấy,
 *   §2 — `streamAnswer` cũng vậy, VÀ dòng ấy đi ra dưới dạng token (không chỉ nằm ở `done`),
 *   §3 — 🔴 `note` (từ chối RBAC / DB lỗi) ⇒ KHÔNG hoá đơn, trên CẢ HAI đường,
 *   §4 — không chạy tool ⇒ không hoá đơn, không có dòng thừa nào mọc ra.
 *
 * Mock theo đúng khuôn `aiLocalKnowledge.emptyToolGate.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

const DIM = 1024;
function unit(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}

const chunks = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/NG.md",
    title: "Lỗi NG theo defectType",
    text: "Thống kê lỗi NG theo defectType nằm ở Menu › Chất lượng › Phân tích lỗi.",
    keywords: ["ng", "defect"],
  },
];
const embeddings = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/NG.md",
    title: "Lỗi NG theo defectType",
    keywords: ["ng", "defect"],
    textLength: 72,
    embeddingDim: DIM,
    embedding: unit(0),
  },
];
const chunksJsonl = chunks.map((c) => JSON.stringify(c)).join("\n");
const embeddingsJsonl = embeddings.map((e) => JSON.stringify(e)).join("\n");

vi.mock("node:fs", () => ({
  default: {
    existsSync: () => true,
    readFileSync: (p: string) => (String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl),
  },
  existsSync: () => true,
  readFileSync: (p: string) => (String(p).includes("chunks") ? chunksJsonl : embeddingsJsonl),
}));

const tryExecuteToolLoop = vi.fn();
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
  tryExecuteToolLoop: (...a: unknown[]) => tryExecuteToolLoop(...a),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
const generateText = vi.fn();
const generateTextStream = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: (...a: unknown[]) => generateText(...a),
  generateTextStream: (...a: unknown[]) => generateTextStream(...a),
}));

import { answerQuestion, streamAnswer } from "./aiLocalKnowledgeService";

/** Tóm tắt dài >150 ký tự ⇒ đi đường tắt "tool", KHÔNG gọi LLM (kết quả tất định). */
const TOM_TAT =
  "Top lỗi 7 ngày qua trên máy M-01: solder_bridge 128 lượt, missing_component 64 lượt, tombstone 32 lượt. " +
  "Tổng cộng 224 lượt NG trên 3 loại lỗi, chiếm phần lớn sản lượng NG của trạm này trong kỳ.";

const ARGS = { machineCode: "M-01", days: 7, __authCtx: { userId: 42, role: "admin" } };

function datTool(opts: { note?: string; tool?: string | null } = {}) {
  tryExecuteToolLoop.mockResolvedValue({
    result:
      opts.tool === null
        ? null
        : {
            type: "top_defects",
            title: "Top lỗi",
            data: { rows: [{ code: "solder_bridge", count: 128 }, { code: "missing_component", count: 64 }, { code: "tombstone", count: 32 }] },
            textSummary: TOM_TAT,
            ...(opts.note ? { note: opts.note } : {}),
          },
    decision: { tool: opts.tool === null ? null : (opts.tool ?? "get_top_defects"), args: ARGS, reason: "TRIGGER" },
    loop: null,
  });
}

async function gomStream(q: string) {
  const tokens: string[] = [];
  let done: any = null;
  for await (const ev of streamAnswer(q, 3)) {
    if (ev.type === "token") tokens.push(ev.token);
    if (ev.type === "done") done = ev;
  }
  return { tokens, done, text: tokens.join("") };
}

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbedding.mockResolvedValue(unit(0));
  isGgufAvailable.mockResolvedValue(true);
  generateText.mockResolvedValue({ text: "…", tokensPrompt: 10, tokensGenerated: 20 });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 20 };
  });
});

describe("§1 — answerQuestion phát hoá đơn nguồn dữ liệu", () => {
  it("★ có hoá đơn: bảng THẬT + bộ lọc THẬT + số hàng + khoảng thời gian", async () => {
    datTool();
    const res = await answerQuestion("top lỗi 7 ngày qua", 3);
    expect(res.dataCitations).toHaveLength(1);
    const c = res.dataCitations![0];
    expect(c.kind).toBe("data");
    expect(c.tool).toBe("get_top_defects");
    expect(c.table).toBe("measurement_results");
    expect(c.filters).toEqual({ machineCode: "M-01" });
    expect(c.timeRange).toEqual({ days: 7 });
    expect(c.rowCount).toBe(3);
  });

  it("★ NGƯỜI ĐỌC THẤY ĐƯỢC: dòng nguồn nằm trong `answer`, không chỉ trong DTO", async () => {
    datTool();
    const res = await answerQuestion("top lỗi 7 ngày qua", 3);
    expect(res.answer).toContain("measurement_results");
    expect(res.answer).toContain("machineCode=M-01");
    expect(res.answer).toContain("3 hàng");
  });

  it("🔴 danh tính phiên `__authCtx` KHÔNG rò vào hoá đơn hay vào câu trả lời", async () => {
    datTool();
    const res = await answerQuestion("top lỗi 7 ngày qua", 3);
    expect(JSON.stringify(res.dataCitations)).not.toContain("userId");
    expect(JSON.stringify(res.dataCitations)).not.toContain("42");
    expect(res.answer).not.toContain("__authCtx");
  });

  it("phép đo đối chiếu số có mặt và có MẪU SỐ thật", async () => {
    datTool();
    const res = await answerQuestion("top lỗi 7 ngày qua", 3);
    expect(res.numberCheck).not.toBeNull();
    expect(res.numberCheck!.checked).toBeGreaterThan(0);
    // Câu trả lời ở ca này = textSummary của tool ⇒ mọi số đều truy ngược được.
    expect(res.numberCheck!.unsupported).toEqual([]);
  });
});

describe("§2 — ĐƯỜNG STREAM phải làm ĐÚNG như vậy", () => {
  it("★ hoá đơn có trong `done` VÀ dòng nguồn đi ra dưới dạng TOKEN", async () => {
    datTool();
    const { done, text } = await gomStream("top lỗi 7 ngày qua");
    expect(done.dataCitations).toHaveLength(1);
    expect(done.dataCitations[0].table).toBe("measurement_results");
    // Người dùng đọc luồng token, không đọc DTO — dòng nguồn phải nằm TRONG luồng.
    expect(text).toContain("measurement_results");
    expect(done.answer).toContain("measurement_results");
  });

  it("★ hai đường cho CÙNG một hoá đơn (không có đường nào bị bỏ quên)", async () => {
    datTool();
    const nonStream = await answerQuestion("top lỗi 7 ngày qua", 3);
    datTool();
    const { done } = await gomStream("top lỗi 7 ngày qua");
    expect(done.dataCitations).toEqual(nonStream.dataCitations);
  });
});

describe("🔴 §3 — `note` ⇒ KHÔNG hoá đơn (chống rò sự-tồn-tại), CẢ HAI ĐƯỜNG", () => {
  for (const note of ["PERMISSION_DENIED", "DB_UNAVAILABLE", "NOT_FOUND", "QUERY_ERROR"]) {
    it(`note=${note}: answerQuestion không phát hoá đơn và không nối dòng nguồn`, async () => {
      datTool({ note });
      const res = await answerQuestion("top lỗi 7 ngày qua", 3);
      expect(res.dataCitations).toEqual([]);
      expect(res.answer).not.toContain("measurement_results");
      expect(res.answer).not.toContain("Nguồn số liệu");
    });

    it(`note=${note}: streamAnswer cũng vậy`, async () => {
      datTool({ note });
      const { done, text } = await gomStream("top lỗi 7 ngày qua");
      expect(done.dataCitations).toEqual([]);
      expect(text).not.toContain("measurement_results");
      expect(text).not.toContain("Nguồn số liệu");
    });
  }
});

describe("§4 — không chạy tool ⇒ không hoá đơn, không dòng thừa", () => {
  it("answerQuestion: dataCitations rỗng, numberCheck null", async () => {
    datTool({ tool: null });
    const res = await answerQuestion("quy trình kiểm tra NG là gì", 3);
    expect(res.dataCitations).toEqual([]);
    expect(res.numberCheck).toBeNull();
    expect(res.answer).not.toContain("Nguồn số liệu");
  });

  it("streamAnswer: y hệt", async () => {
    datTool({ tool: null });
    const { done, text } = await gomStream("quy trình kiểm tra NG là gì");
    expect(done.dataCitations).toEqual([]);
    expect(done.numberCheck).toBeNull();
    expect(text).not.toContain("Nguồn số liệu");
  });
});
