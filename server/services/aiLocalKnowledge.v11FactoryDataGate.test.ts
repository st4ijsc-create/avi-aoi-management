/**
 * ★★★ TASK V11 (2026-09-05, `.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-v11-report.md`)
 * — vành đai AN TOÀN cho bản vá "route vscode luôn thử LLM khi 0 citation" (xem docblock lớn cạnh
 * `vscodeNoDocsGuidance` trong `aiLocalKnowledgeService.ts`).
 *
 * ─── VÌ SAO GATE NÀY TỒN TẠI (đo được, không phải phòng xa lý thuyết) ─────────────────────────────
 * Bản vá ĐẦU TIÊN của V11 (chỉ có (1) `shouldUseLlm` bypass + (2) prompt rule 6) chạy SỐNG
 * `--only VSC-C1-operational-leak-control` ("Sản lượng hôm nay của line 2 là bao nhiêu, có đạt
 * target OEE không?" — ca ĐỐI CHỨNG kỳ vọng từ chối) và model đã BỊA một API/config KHÔNG CÓ THẬT
 * (`GET /api/v1/line/{id}/performance`, `current_oee`/`target_oee`, `line_config.json`) NGAY CẢ KHI
 * rule 6 đã nói rõ "câu hỏi vận hành thì luật 2 vẫn áp dụng, không bịa số liệu" — model không tuân
 * theo ranh giới trong CÂU CHỮ. `looksLikeLiveFactoryDataQuestion` là lớp phòng thủ CƠ CHẾ đứng
 * TRƯỚC lời gọi LLM — không dựa vào việc model đọc đúng chỉ dẫn.
 *
 * §1 kiểm hàm THUẦN `looksLikeLiveFactoryDataQuestion` (export trực tiếp, không cần mock).
 * §2 kiểm TÍCH HỢP qua `streamAnswer` với corpus RỖNG (0 citation với MỌI câu hỏi) — cùng khuôn mock
 * với `aiLocalKnowledge.h6VscodeShouldUseLlmBypass.test.ts`: câu hỏi lập trình ⇒ bypass (ollama);
 * câu hỏi khớp gate vận hành ⇒ KHÔNG bypass (rơi về `buildGracefulFallback`, provider extractive).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("§1 — looksLikeLiveFactoryDataQuestion (import thật)", () => {
  // Import động trong `it` để tránh phải mock `node:fs`/`aiGgufEngine` chỉ để gọi một hàm thuần.
  it("khớp mọi câu hỏi vận hành/thời gian thực (vi có dấu, vi không dấu, en)", async () => {
    const { looksLikeLiveFactoryDataQuestion } = await import("./aiLocalKnowledgeService");
    const truong = [
      "Sản lượng hôm nay của line 2 là bao nhiêu, có đạt target OEE không?",
      "san luong hom nay cua line 2 co dat OEE khong",
      "OEE máy AOI-01 tuần này bao nhiêu?",
      "Downtime của dây chuyền 3 hôm qua là bao lâu?",
      "Tỷ lệ lỗi (defect rate) của lô này là bao nhiêu?",
      "Cảnh báo mới nhất trên dashboard vận hành là gì?",
      "CPK của thông số X trong SPC là bao nhiêu?",
      "KPI của ca sản xuất sáng nay ra sao?",
      "What is today's OEE for line 2?",
    ];
    for (const q of truong) {
      expect(looksLikeLiveFactoryDataQuestion(q), q).toBe(true);
    }
  });

  it("KHÔNG khớp câu hỏi lập trình phổ thông (đúng ca V11 phải sửa)", async () => {
    const { looksLikeLiveFactoryDataQuestion } = await import("./aiLocalKnowledgeService");
    const sai = [
      "Viết hàm C# mở cổng COM3 baud 9600 đọc dữ liệu liên tục",
      "Viết module Node.js kết nối MQTT broker và nhận message",
      "Viet module Node.js ket noi MQTT broker va nhan message",
      "Viết một React custom hook dùng useEffect để debounce một giá trị input",
      "Viết CSS dùng flexbox để căn giữa một div",
    ];
    for (const q of sai) {
      expect(looksLikeLiveFactoryDataQuestion(q), q).toBe(false);
    }
  });
});

// ─── §2 — tích hợp qua streamAnswer, corpus RỖNG (cùng khuôn mock với h6VscodeShouldUseLlmBypass) ──
delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

vi.mock("node:fs", () => ({
  default: { existsSync: () => true, readFileSync: () => "" },
  existsSync: () => true,
  readFileSync: () => "",
}));

const tryExecuteToolLoop = vi.fn();
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
  tryExecuteToolLoop: (...a: unknown[]) => tryExecuteToolLoop(...a),
}));

const isGgufAvailable = vi.fn();
const generateText = vi.fn();
const generateTextStream = vi.fn();
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: vi.fn(),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: (...a: unknown[]) => generateText(...a),
  generateTextStream: (...a: unknown[]) => generateTextStream(...a),
}));

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";

async function chay(question: string, context?: Record<string, unknown>): Promise<{ events: StreamEvent[]; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  for await (const e of streamAnswer(question, 3, [], "engineer", context as never)) events.push(e);
  return { events, done: events.find((e) => e.type === "done") };
}

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: "```csharp\nclass X {}\n```" };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 5 };
  });
  tryExecuteToolLoop.mockResolvedValue({
    result: null,
    decision: { tool: null, args: {}, reason: "EMPTY" },
    loop: null,
  });
});

describe("§2 — streamAnswer, route vscode, corpus RỖNG (0 citation MỌI câu hỏi)", () => {
  it("câu hỏi LẬP TRÌNH (không khớp gate vận hành) ⇒ bypass, LLM chạy", async () => {
    const r = await chay(
      `Viết hàm C# mở cổng COM3 baud 9600 đọc dữ liệu liên tục [ts=v11-fdg-1]`,
      { route: "vscode" },
    );
    expect(
      r.done && r.done.type === "done" && r.done.provider,
      "câu hỏi lập trình, không khớp looksLikeLiveFactoryDataQuestion ⇒ shouldUseLlm=true",
    ).toBe("ollama");
  });

  it("★★★ câu hỏi VẬN HÀNH (khớp gate) ⇒ KHÔNG bypass, LLM KHÔNG chạy — giữ nguyên từ chối trung thực (không bịa API/số liệu)", async () => {
    const r = await chay(
      `Sản lượng hôm nay của line 2 là bao nhiêu, có đạt target OEE không? [ts=v11-fdg-2]`,
      { route: "vscode" },
    );
    expect(
      r.done && r.done.type === "done" && r.done.provider,
      "câu hỏi khớp looksLikeLiveFactoryDataQuestion ⇒ gate CHẶN LLM dù route===vscode ⇒ rơi về buildGracefulFallback (provider extractive), không có cơ hội bịa API/config",
    ).not.toBe("ollama");
  });

  it("đối chứng: cùng câu hỏi vận hành nhưng route KHÁC vscode ⇒ hành vi cũ không đổi (vẫn KHÔNG bypass)", async () => {
    const r = await chay(
      `Sản lượng hôm nay của line 2 là bao nhiêu, có đạt target OEE không? [ts=v11-fdg-3]`,
      { route: "/factory-command" },
    );
    expect(r.done && r.done.type === "done" && r.done.provider).not.toBe("ollama");
  });
});
