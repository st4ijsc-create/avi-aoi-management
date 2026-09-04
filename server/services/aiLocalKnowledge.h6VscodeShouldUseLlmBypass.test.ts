/**
 * ★★★ ĐỢT H / TASK H6 (`.superpowers/sdd/2026-09-03-vscode-extension-dot-g/task-h6-report.md`) —
 * `shouldUseLlm` (cổng G3-C, `aiLocalKnowledgeService.ts::streamAnswer`) phải BỎ ngưỡng độ tin KB
 * (`retrieve.confidence >= 0.30`) khi route là "vscode" VÀ giáo cụ đã bóc được (`laVscodeDaBocGiaoThuc`).
 *
 * ─── VÌ SAO CẦN MỘT TỆP LƯỚI RIÊNG (không gộp vào `aiLocalKnowledge.vscodeRouteGate.test.ts`) ────
 * Corpus fixture của tệp đó có MỘT chunk (`domain/knowledge/OEE.md`). Đo được: văn bản giáo cụ đầy
 * đủ (`VSCODE_GIAO_THUC_PREFIX`, ~1500 ký tự tiếng Việt) TỰ NÓ đã đạt keyword-score ≥0,30 trên chunk
 * đó (khớp CHUỖI CON tình cờ qua `.includes()` — vd token "cu" khớp bên trong "cua" của chunk — xem
 * `keywordScore`), nên với corpus đó, câu hỏi ĐẦY ĐỦ (chưa bóc) CŨNG vượt ngưỡng 0,30 — hai trạng
 * thái "có vá"/"ablation" cho CÙNG kết quả `provider:"ollama"` qua HAI cơ chế khác nhau (bypass vs
 * confidence tự nhiên), không phân biệt được bằng ablation. Tệp NÀY dùng corpus RỖNG (0 chunk) —
 * khi đó `retrieveKnowledge` LUÔN trả `confidence = clamp01((0,25+0,20)/1,6) ≈ 0,281` (hằng số dự
 * phòng khi không có citation nào, xem `top1/top2 ?? 0.25/0.2` trong `retrieveKnowledge`) — GIỐNG
 * HỆT nhau bất kể câu hỏi ngắn hay dài, bóc hay chưa bóc. Với corpus này, `provider:"ollama"` CHỈ
 * có thể đến từ `laVscodeDaBocGiaoThuc` — phép đo cô lập ĐÚNG một biến.
 *
 * Mock theo đúng khuôn `aiLocalKnowledge.vscodeRouteGate.test.ts`/`aiLocalKnowledge.emptyToolGate.
 * test.ts` (fs cho KB rỗng + `aiGgufEngine` giả + `tryExecuteToolLoop` giả).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.GGUF_EMBED_DIM = "1024";

// Corpus RỖNG có chủ đích — xem docblock trên vì sao.
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

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";

// Bản sao literal của VSCODE_GIAO_THUC_PREFIX/VSCODE_NHAC_LAI_SUFFIX (xem docblock §D của
// `aiLocalKnowledge.vscodeRouteGate.test.ts` cho lý do bản sao có chủ đích).
const PREFIX =
  "QUAN TRỌNG — ĐỌC KỸ TRƯỚC KHI ÁP DỤNG \"NGUYÊN TẮC TRẢ LỜI\" Ở TRÊN: nếu câu hỏi bên dưới cần biết NỘI DUNG một tệp/thư mục cụ thể trong workspace mà bạn KHÔNG thấy trong \"Ngữ cảnh từ knowledge base\", đây KHÔNG PHẢI ca \"ngữ cảnh không liên quan\" — ĐỪNG trả lời câu mẫu \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\". Bạn có một cách khác: TỰ ĐỌC tệp/thư mục đó rồi mới trả lời.\n\nMuốn đọc, phát ra ĐÚNG MỘT khối rào sau (không thêm chữ nào khác trong khối); tôi sẽ chạy công cụ đó và gửi lại NGUYÊN VĂN kết quả cho bạn ở lượt kế tiếp — bạn KHÔNG tự bịa nội dung tệp:\n\nĐọc một tệp:\n```avi-tool\n{\"tool\":\"doc_tep\",\"args\":{\"path\":\"<đường dẫn tệp>\"}}\n```\n\nLiệt kê một thư mục:\n```avi-tool\n{\"tool\":\"liet_ke\",\"args\":{\"path\":\"<đường dẫn thư mục>\"}}\n```\n\nTìm một chuỗi/mẫu trong workspace (path có thể bỏ trống để tìm toàn workspace):\n```avi-tool\n{\"tool\":\"grep\",\"args\":{\"mau\":\"<mẫu cần tìm>\",\"path\":\"<thư mục, tuỳ chọn>\"}}\n```\n\nMỗi lượt trả lời CHỈ MỘT khối (một yêu cầu đọc). Nếu bạn ĐÃ có đủ nội dung cần thiết (đọc rồi, hoặc câu hỏi không cần đọc tệp nào), trả lời bình thường — KHÔNG phát khối này.\n\nQUAN TRỌNG THỨ HAI — CA KHÁC, CŨNG GHI ĐÈ \"NGUYÊN TẮC TRẢ LỜI\" Ở TRÊN: nếu câu hỏi bên dưới yêu cầu VIẾT MỘT ĐOẠN MÃ/HÀM HOÀN TOÀN MỚI (chưa tồn tại ở đâu cả — không phải sửa, không phải tìm, không cần đọc một tệp cụ thể nào để trả lời), đây CŨNG KHÔNG PHẢI ca \"ngữ cảnh không liên quan\" — ĐỪNG trả lời câu mẫu \"Tôi không có thông tin chính xác...\", và ĐỪNG phát khối đọc tệp ở trên để đi tìm một tệp không tồn tại. Hãy viết THẲNG đoạn mã được yêu cầu ngay trong câu trả lời này." +
  "\n\n";
const SUFFIX =
  "\n\n(Nhắc lại: nếu câu hỏi trên cần nội dung một tệp bạn chưa có, hãy phát khối ```avi-tool``` như đã hướng dẫn; nếu câu hỏi là yêu cầu viết mã MỚI (không cần đọc tệp), hãy viết THẲNG mã đó — cả hai ca ĐỪNG trả lời \"không có thông tin\".)";
// ★ `getCacheKey` (aiLocalKnowledgeService.ts) băm theo `question` (KHÔNG có `route`) — cùng văn
// bản câu hỏi ở HAI route khác nhau collide vào CHUNG một mục cache trong `answerCache` (Map cấp
// MODULE, không reset giữa các `it`). Mỗi ca dưới đây dùng một HẬU TỐ RIÊNG (bên trong phần câu hỏi
// thật, không đụng PREFIX/SUFFIX giáo cụ — `tachThanKhoiGiaoCuVscode` chỉ đòi khớp CHÍNH XÁC hai
// đầu đó) để KHÔNG BAO GIỜ đọc nhầm kết quả cache của ca khác — đúng bài học Bước 0 (MSA) của skill
// PDCA: "Có CACHE nào ở giữa không?".
function cauHoiThat(hauTo: string): string {
  return `Từ giờ trở đi, hãy LUÔN dùng tiếng Việt trang trọng khi trả lời tôi. (${hauTo})`;
}
function wrapped(hauTo: string): string {
  return `${PREFIX}${cauHoiThat(hauTo)}${SUFFIX}`;
}

async function chay(question: string, context?: Record<string, unknown>): Promise<{ events: StreamEvent[]; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  for await (const e of streamAnswer(question, 3, [], "engineer", context as never)) events.push(e);
  return { events, done: events.find((e) => e.type === "done") };
}

beforeEach(() => {
  vi.clearAllMocks();
  isGgufAvailable.mockResolvedValue(true);
  generateTextStream.mockImplementation(async function* () {
    yield { type: "token", token: "Vâng, tôi sẽ luôn trả lời trang trọng." };
    yield { type: "done", tokensPrompt: 10, tokensGenerated: 5 };
  });
  tryExecuteToolLoop.mockResolvedValue({
    result: null,
    decision: { tool: null, args: {}, reason: "EMPTY" },
    loop: null,
  });
});

describe("§H6 — corpus RỖNG ⇒ confidence LUÔN ~0,281 (<0,30) bất kể câu hỏi — cô lập ĐÚNG biến `laVscodeDaBocGiaoThuc`", () => {
  it("★ khẳng định tiền đề: câu hỏi THẬT trần trụi, route KHÁC vscode ⇒ confidence <0,30 ⇒ LLM KHÔNG chạy (provider extractive)", async () => {
    const r = await chay(cauHoiThat("ca1-web-tran-trui"), { route: "/factory-command" });
    expect(r.done && r.done.type === "done" && r.done.provider).not.toBe("ollama");
  });

  it("★★★ route vscode, giáo cụ bóc được (`WRAPPED`) ⇒ LLM VẪN chạy dù confidence <0,30 (bypass hoạt động)", async () => {
    const r = await chay(wrapped("ca2-vscode-boc-duoc"), { route: "vscode" });
    expect(
      r.done && r.done.type === "done" && r.done.provider,
      "corpus rỗng ⇒ confidence ~0,281 <0,30 cho MỌI câu hỏi — provider chỉ có thể là \"ollama\" nhờ laVscodeDaBocGiaoThuc",
    ).toBe("ollama");
  });

  it("★★ ĐỐI CHỨNG B3 bắt buộc — CÙNG văn bản giáo cụ, route KHÁC vscode ⇒ KHÔNG bypass, LLM KHÔNG chạy", async () => {
    const r = await chay(wrapped("ca3-web-wrapped"), { route: "/factory-command" });
    expect(
      r.done && r.done.type === "done" && r.done.provider,
      "đường WEB không có laVscodeDaBocGiaoThuc — cổng G3-C giữ nguyên hành vi cũ",
    ).not.toBe("ollama");
  });

  it("★★ route vscode nhưng KHÔNG bóc được (giáo cụ lệch 1 ký tự) ⇒ KHÔNG bypass, LLM KHÔNG chạy", async () => {
    const gioiHan = wrapped("ca4-vscode-khong-boc-duoc").replace("ĐỌC KỸ TRƯỚC KHI", "ĐỌC Kĩ TRƯỚC KHI");
    const r = await chay(gioiHan, { route: "vscode" });
    expect(
      r.done && r.done.type === "done" && r.done.provider,
      "bóc thất bại ⇒ laVscodeDaBocGiaoThuc=false ⇒ fallback hành vi cũ (chặn TOÀN BỘ vòng tool, KHÔNG bypass)",
    ).not.toBe("ollama");
  });
});
