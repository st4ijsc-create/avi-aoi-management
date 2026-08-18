/**
 * ★★★ G3-C VIỆC 2 — **CỔNG THỨ TÁM: KHÔNG CÓ DỮ LIỆU THÌ KHÔNG GỌI LLM ĐỂ NÓI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖI ĐANG VÁ (hình dạng NGƯỢC hoàn toàn với mong muốn).
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `aiLocalKnowledgeService` bỏ qua LLM khi `textSummary` của tool **≥150 ký tự**. Nhưng MỌI câu
 * rỗng/lỗi đều NGẮN hơn 150 (`"Không có lỗi NG nào theo defectType trong 7 ngày qua."` ~52 ký
 * tự). ⇒ **Đúng những lượt hệ thống không có gì để nói thì LLM được gọi để nói.**
 *
 * ⚠⚠ HAI CHIỀU PHẢI ĐO CÙNG LÚC, nếu không bản vá này chỉ đổi lỗi này lấy lỗi khác:
 *   §A — kết quả mang một `note` (trạng thái "không đủ để phát biểu") ⇒ **CẤM** gọi LLM.
 *   §B — kết quả **CÓ DỮ LIỆU THẬT** (không `note`) nhưng tóm tắt NGẮN ⇒ **VẪN PHẢI** được LLM
 *        diễn giải. Đây là ca chống-vá-quá-tay: nó đỏ nếu ai đó (lại) dùng ĐỘ DÀI làm tiêu chí,
 *        hoặc nếu ai đó chặn luôn cả kết quả bình thường.
 *
 * ★ 2026-08-18 — vị từ ĐÃ ĐẢO CHIỀU (xem docblock `TOOL_NOTE_VAN_DIEN_GIAI`): trước đây tập mã
 * CHẶN được chép tay và thiếu 17 mã (`SCOPE_EMPTY`, `NOT_FOUND_WITH_SUGGESTIONS`, …); nay luật là
 * **có `note` ⇒ chặn**, ngoại lệ phải khai tên. Bảng kê cưỡng chế: `aiLocalTools/toolNoteCensus.test.ts`.
 *
 * Mock theo đúng khuôn `aiLocalKnowledge.toolLoopHonesty.test.ts` (fs + engine + aiLocalTools),
 * nên nó đo pipeline THẬT của service chứ không đo một hàm rời.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import {
  answerQuestion,
  streamAnswer,
  toolKhongCoGiDeNoi,
  TOOL_NOTE_VAN_DIEN_GIAI,
} from "./aiLocalKnowledgeService";

const CAU_LLM = "Theo dữ liệu thời gian thực, tỷ lệ NG của dây chuyền 2 hôm nay ở mức bình thường và không có cảnh báo nào cần xử lý ngay.";

/** Câu THẬT do handler dựng cho một lượt không có dữ liệu — 52 ký tự, DƯỚI ngưỡng 150. */
const CAU_RONG = "Không có lỗi NG nào theo defectType trong 7 ngày qua.";
/** Câu ngắn nhưng CÓ SỐ LIỆU THẬT — cũng dưới 150, đây là ca phải được LLM diễn giải. */
const CAU_CO_DU_LIEU = "NG hôm nay: 12 (line 2), 3 (line 5).";

function ketQua(textSummary: string, note?: string) {
  // ⚠ `note !== undefined`, KHÔNG phải `note ?` — nếu không thì ca `note: ""` bên dưới sẽ âm
  // thầm biến thành ca "không có note" và chẳng đo gì cả (thước tự bỏ mất đối tượng đo).
  return { type: "top_defects", title: "Top lỗi", data: {}, textSummary, ...(note !== undefined ? { note } : {}) };
}

function datTool(textSummary: string, note?: string, soVong = 1) {
  tryExecuteToolLoop.mockResolvedValue({
    result: ketQua(textSummary, note),
    decision: { tool: "get_top_defects", args: {}, reason: "TRIGGER" },
    loop:
      soVong > 1
        ? {
            rounds: Array.from({ length: soVong }, (_, i) => ({
              round: i + 1,
              tool: "get_top_defects",
              args: {},
              summary: "x",
              tokens: 1,
              ms: 1,
              injectionRisk: "none",
              injectionMatched: [],
              error: null,
            })),
            stop: "ket_luan",
            promptBlock: "khối tích luỹ",
            lastResult: ketQua(textSummary, note),
            firstDecision: { tool: "get_top_defects", args: {}, reason: "TRIGGER" },
            pendingAction: null,
            clientAction: null,
            denied: null,
            errors: [],
            tokensUsed: 1,
            elapsedMs: 1,
            injection: null,
          }
        : null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbedding.mockResolvedValue(unit(0));
  isGgufAvailable.mockResolvedValue(true);
  generateText.mockResolvedValue({ text: CAU_LLM, tokensPrompt: 10, tokensGenerated: 20 });
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: CAU_LLM };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 20 };
  });
});

afterEach(() => {
  delete process.env.KB_TOOL_SHORTCIRCUIT_MIN;
});

describe("§A — trạng thái CÓ CẤU TRÚC 'không có dữ liệu' ⇒ CẤM gọi LLM", () => {
  // ★ Bốn mã của bản đầu + hai mã ĐÃ LỌT trước 2026-08-18 (`SCOPE_EMPTY` = phạm vi rỗng của
  //   `analytics_defect_heatmap_summary`; `NOT_FOUND_WITH_SUGGESTIONS` = `data: null` của
  //   `get_lot_status`) + một mã CHƯA TỪNG TỒN TẠI (chiều mặc định).
  for (const note of [
    "NOT_FOUND",
    "QUERY_ERROR",
    "DB_UNAVAILABLE",
    "PERMISSION_DENIED",
    "SCOPE_EMPTY",
    "NOT_FOUND_WITH_SUGGESTIONS",
    "MA_CHUA_AI_DAT_BAO_GIO",
  ]) {
    it(`★ note=${note} + tóm tắt 52 ký tự ⇒ KHÔNG gọi LLM, trả thẳng textSummary`, async () => {
      datTool(CAU_RONG, note);
      const res = await answerQuestion("hôm nay có lỗi NG nào không", 3);
      expect(generateText, `note=${note} vẫn gọi LLM để nói về một kết quả rỗng`).not.toHaveBeenCalled();
      expect(res.provider).toBe("tool");
      expect(res.answer).toContain(CAU_RONG);
      expect(res.answer).not.toContain(CAU_LLM);
    });
  }

  it("★ KHÔNG dùng độ dài làm tiêu chí — tắt hẳn đường tắt độ dài, cổng vẫn đóng", async () => {
    // Ngưỡng độ dài đẩy lên 100_000 ⇒ đường tắt cũ KHÔNG THỂ là thứ chặn LLM ở ca này.
    process.env.KB_TOOL_SHORTCIRCUIT_MIN = "100000";
    datTool(CAU_RONG, "NOT_FOUND");
    const res = await answerQuestion("hôm nay có lỗi NG nào không", 3);
    expect(generateText).not.toHaveBeenCalled();
    expect(res.provider).toBe("tool");
  });
});

describe("§B — CHỐNG VÁ QUÁ TAY: có dữ liệu thật nhưng tóm tắt NGẮN ⇒ vẫn phải được LLM diễn giải", () => {
  it("★ không có note + tóm tắt 36 ký tự ⇒ LLM ĐƯỢC gọi", async () => {
    datTool(CAU_CO_DU_LIEU);
    const res = await answerQuestion("hôm nay có lỗi NG nào không", 3);
    expect(generateText, "một kết quả CÓ dữ liệu bị chặn nhầm — cổng đang dùng sai tiêu chí").toHaveBeenCalledTimes(1);
    expect(res.provider).toBe("ollama");
    expect(res.answer).toContain(CAU_LLM);
  });

  it("★ note là CHUỖI RỖNG ⇒ không phát biểu trạng thái gì ⇒ vẫn gọi LLM", async () => {
    // Neo chống-vá-quá-tay sau khi đảo chiều: chỉ một `note` CÓ NỘI DUNG mới là một lời khai
    // "tôi không có gì đủ để nói". `""` không khai gì cả.
    datTool(CAU_CO_DU_LIEU, "");
    await answerQuestion("hôm nay có lỗi NG nào không", 3);
    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("tóm tắt DÀI (≥150) không có note ⇒ đường tắt độ dài cũ vẫn nguyên vẹn (không hồi quy)", async () => {
    datTool(CAU_CO_DU_LIEU.padEnd(200, " chi tiết thêm."));
    const res = await answerQuestion("hôm nay có lỗi NG nào không", 3);
    expect(generateText).not.toHaveBeenCalled();
    expect(res.provider).toBe("tool");
  });
});

describe("§C — đường STREAM đi qua CÙNG một cổng", () => {
  async function gomToken(gen: AsyncGenerator<{ type: string; token?: string }>): Promise<string> {
    let s = "";
    for await (const ev of gen) if (ev.type === "token" && typeof ev.token === "string") s += ev.token;
    return s;
  }

  it("★ note=NOT_FOUND ⇒ stream KHÔNG gọi LLM, phát thẳng textSummary", async () => {
    datTool(CAU_RONG, "NOT_FOUND");
    const chu = await gomToken(streamAnswer("hôm nay có lỗi NG nào không", 3));
    expect(generateTextStream).not.toHaveBeenCalled();
    expect(chu).toContain(CAU_RONG);
    expect(chu).not.toContain(CAU_LLM);
  });

  it("★ có dữ liệu thật, tóm tắt ngắn ⇒ stream VẪN gọi LLM", async () => {
    datTool(CAU_CO_DU_LIEU);
    const chu = await gomToken(streamAnswer("hôm nay có lỗi NG nào không", 3));
    expect(generateTextStream).toHaveBeenCalledTimes(1);
    expect(chu).toContain(CAU_LLM);
  });
});

describe("§D — NHIỀU VÒNG: cổng KHÔNG khoá (giá trị nằm ở phép tổng hợp giữa các vòng)", () => {
  it("2 vòng, vòng cuối note=NOT_FOUND ⇒ LLM VẪN được gọi để tổng hợp", async () => {
    datTool(CAU_RONG, "NOT_FOUND", 2);
    await answerQuestion("hôm nay có lỗi NG nào không", 3);
    expect(generateText, "khoá ở nhiều vòng là vứt bỏ đúng thứ vòng lặp vừa đi lấy").toHaveBeenCalledTimes(1);
  });
});

describe("§E — vị từ thuần", () => {
  it("tập NGOẠI LỆ được khai đích danh (hôm nay RỖNG — xem `toolNoteCensus.test.ts` §3)", () => {
    // ⚠ Đây KHÔNG phải "tập mã chặn" nữa. Chiều đã đảo: có `note` ⇒ chặn, trừ khi tên ở đây.
    expect([...TOOL_NOTE_VAN_DIEN_GIAI].sort()).toEqual([]);
  });

  it("null / không note / note rỗng ⇒ false; mã LẠ ⇒ true; nhiều vòng ⇒ false", () => {
    expect(toolKhongCoGiDeNoi(null)).toBe(false);
    expect(toolKhongCoGiDeNoi(undefined)).toBe(false);
    expect(toolKhongCoGiDeNoi({})).toBe(false);
    expect(toolKhongCoGiDeNoi({ note: "" })).toBe(false);
    // ★ Đột biến "quay về fail-open" ⇒ ĐỎ ngay tại đây.
    expect(toolKhongCoGiDeNoi({ note: "PARTIAL_RESULT" })).toBe(true);
    expect(toolKhongCoGiDeNoi({ note: "SCOPE_EMPTY" })).toBe(true);
    expect(toolKhongCoGiDeNoi({ note: "NOT_FOUND" })).toBe(true);
    expect(toolKhongCoGiDeNoi({ note: "NOT_FOUND" }, 2)).toBe(false);
  });
});
