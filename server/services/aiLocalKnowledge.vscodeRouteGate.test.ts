/**
 * ★★★ PDCA vòng 5 (server, gốc rễ ĐO ĐƯỢC) — GATE `route === "vscode"` KHÔNG được gọi
 * `tryExecuteToolLoop`. Xem docblock đầy đủ cạnh `KHONG_TOOL_VSCODE`/`streamAnswer` trong
 * `aiLocalKnowledgeService.ts` và `.superpowers/sdd/2026-08-30-vscode-extension-dot-d/
 * pdca5-report.md` / `pdca6-report.md` cho lý lẽ đầy đủ.
 *
 * ─── LỖI ĐANG VÁ ─────────────────────────────────────────────────────────────────────────────────
 * `streamAnswer` gọi `tryExecuteToolLoop(question, …)` VÔ ĐIỀU KIỆN trên MỌI câu hỏi, kể cả câu hỏi
 * đến từ panel chat của extension VSCode — nơi đoạn giáo cụ `avi-tool` (client tự dạy `doc_tep`/
 * `liet_ke`/`grep`) bị bộ chọn tool VẬN HÀNH của máy chủ hiểu NHẦM thành một câu hỏi vận hành thật,
 * chạy một tool NATIVE sai ngữ cảnh (đo LIVE ở vòng trước — POST thẳng `/api/ai/local-kb/stream`).
 *
 * ─── MOCK BỘ PHẬN, không phải toàn bộ ──────────────────────────────────────────────────────────
 * Theo đúng khuôn `aiLocalKnowledge.toolLoopHonesty.test.ts`/`aiLocalKnowledge.emptyToolGate.test.ts`
 * (fs cho KB chunks/embeddings giả + `aiGgufEngine` giả + `tryExecuteToolLoop` giả). Lưới này đo
 * ĐÚNG MỘT thứ: **`tryExecuteToolLoop` có được gọi hay không**, theo `context.route` — không đo lại
 * chính `intentClassifier` (đã đo LIVE ở vòng trước, ngoài phạm vi một unit test xác định).
 *
 * ★ ĐỘT BIẾN PHẢI BẮT ĐƯỢC: gỡ điều kiện `context?.route === "vscode"` (hoặc đảo ngược nó) ⇒ §A ĐỎ
 *   (tryExecuteToolLoop bị gọi cho route "vscode") HOẶC §B ĐỎ (tryExecuteToolLoop KHÔNG còn được gọi
 *   cho đường web — hồi quy nghiêm trọng hơn, đây là ca §B tồn tại để canh).
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
    sourcePath: "domain/knowledge/OEE.md",
    title: "Chỉ số OEE",
    text: "OEE là tích của availability, performance và quality.",
    keywords: ["oee"],
  },
];
const embeddings = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/OEE.md",
    title: "Chỉ số OEE",
    keywords: ["oee"],
    textLength: 60,
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

import { streamAnswer, type StreamEvent } from "./aiLocalKnowledgeService";

/** Tóm tắt DÀI (≥150 ký tự, xem `KB_TOOL_SHORTCIRCUIT_MIN`) ⇒ đường tắt độ dài trả THẲNG, không
 *  cần model — làm phép đo "tool có chạy hay không" tất định, không phụ thuộc mock LLM. */
const TOM_TAT_TOOL_THAT =
  "OEE hôm nay của line 2 là 71,3% (availability 92%, performance 88%, quality 88%). Dữ liệu lấy từ CSDL sản xuất thời gian thực, cập nhật 5 phút một lần theo ca hiện tại.";

function datToolThat() {
  tryExecuteToolLoop.mockResolvedValue({
    result: { type: "oee", title: "OEE", data: {}, textSummary: TOM_TAT_TOOL_THAT },
    decision: { tool: "get_oee", args: {}, reason: "H" },
    loop: null,
  });
}

async function chay(question: string, context?: Record<string, unknown>): Promise<{ events: StreamEvent[]; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  for await (const e of streamAnswer(question, 3, [], "engineer", context as never)) events.push(e);
  return { events, done: events.find((e) => e.type === "done") };
}

beforeEach(() => {
  vi.clearAllMocks();
  generateEmbedding.mockResolvedValue(unit(0));
  isGgufAvailable.mockResolvedValue(false); // đường extractive — không phụ thuộc model cục bộ
  tryExecuteToolLoop.mockResolvedValue({
    result: null,
    decision: { tool: null, args: {}, reason: "EMPTY" },
    loop: null,
  });
});

describe("§A — route:\"vscode\" ⇒ tryExecuteToolLoop KHÔNG BAO GIỜ được gọi", () => {
  it("★★★ CÂU HỎI ĐÚNG HÌNH DẠNG SẼ TRÚNG TOOL Ở ĐƯỜNG WEB — dưới route vscode, tool KHÔNG chạy", async () => {
    datToolThat();
    const r = await chay("OEE line 2 hôm nay thế nào", { route: "vscode" });
    expect(tryExecuteToolLoop, "gate phải chặn TRƯỚC khi lượt suy luận chọn-tool chạy").not.toHaveBeenCalled();
    expect(r.done && r.done.type === "done" && r.done.provider).not.toBe("tool");
    expect(r.done && r.done.type === "done" && r.done.answer).not.toContain(TOM_TAT_TOOL_THAT);
  });

  it("★★ không phát bất kỳ sự kiện `tool_loop` hay `tool` nào (không có gì để báo tiến độ)", async () => {
    datToolThat();
    const r = await chay("OEE line 2 hôm nay thế nào", { route: "vscode" });
    expect(r.events.some((e) => e.type === "tool_loop")).toBe(false);
    expect(r.events.some((e) => e.type === "tool")).toBe(false);
  });

  it("★★ `done.toolLoop` (dấu vết đa bước) là null — không có gì để đếm lượt", async () => {
    datToolThat();
    const r = await chay("OEE line 2 hôm nay thế nào", { route: "vscode" });
    expect(r.done && r.done.type === "done" && (r.done as { toolLoop?: unknown }).toolLoop == null).toBe(true);
  });

  it("★ vẫn ra được câu trả lời (RAG/extractive) — gate chỉ tắt TOOL, không tắt cả pipeline", async () => {
    const r = await chay("OEE là gì", { route: "vscode" });
    expect(r.done && r.done.type === "done" && r.done.answer.length).toBeGreaterThan(0);
  });
});

describe("§B — ĐỐI CHỨNG bắt buộc: đường WEB (route khác \"vscode\", hoặc vắng) KHÔNG đổi hành vi", () => {
  it("★★★ route VẮNG ⇒ tryExecuteToolLoop VẪN được gọi, kết quả tool VẪN đi vào answer (y hệt trước bản vá)", async () => {
    datToolThat();
    const r = await chay("OEE line 2 hôm nay thế nào");
    expect(tryExecuteToolLoop).toHaveBeenCalledTimes(1);
    expect(r.done && r.done.type === "done" && r.done.provider).toBe("tool");
    expect(r.done && r.done.type === "done" && r.done.answer).toContain(TOM_TAT_TOOL_THAT);
  });

  it("★★★ route là một ĐƯỜNG DẪN WEB THẬT (\"/factory-command\") ⇒ tryExecuteToolLoop VẪN được gọi", async () => {
    datToolThat();
    const r = await chay("OEE line 2 hôm nay thế nào", { route: "/factory-command" });
    expect(tryExecuteToolLoop).toHaveBeenCalledTimes(1);
    expect(r.done && r.done.type === "done" && r.done.provider).toBe("tool");
  });

  it("★★ tryExecuteToolLoop được gọi ĐÚNG với `question`/`context`/`execCtx` — chữ ký lời gọi không đổi", async () => {
    datToolThat();
    await chay("OEE line 2 hôm nay thế nào", { route: "/factory-command", uiLanguage: "vi" });
    const goi = tryExecuteToolLoop.mock.calls[0]!;
    expect(goi[0]).toBe("OEE line 2 hôm nay thế nào");
    expect(goi[1]).toMatchObject({ route: "/factory-command", uiLanguage: "vi" });
    expect(typeof goi[3]).toBe("function"); // callback onProgress vẫn được truyền
  });

  it("★ đối sánh CHUỖI CHÍNH XÁC — \"VSCODE\" (hoa) hay \"/vscode\" (path) KHÔNG bị gate nhầm", async () => {
    datToolThat();
    const hoa = await chay("OEE line 2 hôm nay thế nào", { route: "VSCODE" });
    expect(tryExecuteToolLoop).toHaveBeenCalledTimes(1);
    tryExecuteToolLoop.mockClear();
    datToolThat();
    const duongDan = await chay("OEE line 2 hôm nay thế nào", { route: "/vscode" });
    expect(tryExecuteToolLoop).toHaveBeenCalledTimes(1);
    expect(hoa.done && hoa.done.type === "done" && hoa.done.provider).toBe("tool");
    expect(duongDan.done && duongDan.done.type === "done" && duongDan.done.provider).toBe("tool");
  });
});

/**
 * §C (KHÔNG có ca chạy được ở ĐÂY — nói thẳng, không giả vờ đã đo) — extension chế độ SERVER gửi
 * CẢ HAI cờ `route:"vscode"` VÀ `codingMode:true` cùng lúc. Đọc mã (`streamAnswer`, điều kiện
 * `context?.codingMode === true` ở NGAY ĐẦU hàm) xác nhận nhánh đó `return` SỚM, đứng TRƯỚC dòng
 * gate của bản vá này — gate của tôi vật lý KHÔNG THỂ chạy khi `codingMode === true`, không phụ
 * thuộc giá trị `route`. Không dựng một mock riêng cho toàn bộ pipeline lập trình ở ĐÂY (trùng lặp
 * `aiCodingMode.stream.test.ts`, 900+ dòng, mock đủ `executeDecision`/`tryExecuteCodingToolLoop`/
 * engine — vá lại là tăng bề mặt lưới không cần thiết); suite đó đã chạy KHÔNG ĐỔI để xác nhận
 * nhánh `codingMode` không hồi quy (xem báo cáo).
 */

/**
 * ═══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ PDCA vòng 8 (`.superpowers/sdd/2026-08-30-vscode-extension-dot-d/pdca8-report.md`) — §A ở
 * trên đo ĐÚNG một câu hỏi KHÔNG mang hình dạng giáo cụ (`"OEE line 2 hôm nay thế nào"` trần trụi)
 * — với câu đó, gate vòng 8 hành xử Y HỆT gate vòng 5 (không bóc được ⇒ chặn, `KHONG_TOOL_VSCODE`).
 * §D dưới đây đo NHÁNH KIA của vòng 8: câu hỏi MANG ĐÚNG hình dạng giáo cụ LOCAL (như extension thật
 * gửi) — gate phải BÓC giáo cụ rồi VẪN gọi `tryExecuteToolLoop`, nhưng CHỈ trên phần câu hỏi thật.
 *
 * ⚠ `PREFIX`/`SUFFIX` dưới đây là bản SAO literal của `VSCODE_GIAO_THUC_PREFIX`/`VSCODE_NHAC_LAI_
 * SUFFIX` (`aiLocalKnowledgeService.ts`, chính nó đã là bản sao của `vscode-extension/src/loi/
 * dayGiaoThucDoc.ts`) — bản sao THỨ BA có chủ đích, chỉ để DỰNG đầu vào test giống hệt sản xuất.
 * Nếu văn bản giáo cụ đổi, ca ★★★ đầu tiên dưới đây sẽ ĐỎ (không còn bóc được) — đó là tín hiệu ĐÚNG
 * để đồng bộ lại cả ba bản sao, không phải một lưới hỏng.
 */
describe("§D — PDCA vòng 8: route \"vscode\" MANG giáo cụ LOCAL thật ⇒ bóc rồi VẪN gọi tool trên PHẦN CÂU HỎI THẬT", () => {
  const PREFIX =
    "QUAN TRỌNG — ĐỌC KỸ TRƯỚC KHI ÁP DỤNG \"NGUYÊN TẮC TRẢ LỜI\" Ở TRÊN: nếu câu hỏi bên dưới cần biết NỘI DUNG một tệp/thư mục cụ thể trong workspace mà bạn KHÔNG thấy trong \"Ngữ cảnh từ knowledge base\", đây KHÔNG PHẢI ca \"ngữ cảnh không liên quan\" — ĐỪNG trả lời câu mẫu \"Tôi không có thông tin chính xác về câu hỏi này trong tài liệu hiện tại.\". Bạn có một cách khác: TỰ ĐỌC tệp/thư mục đó rồi mới trả lời.\n\nMuốn đọc, phát ra ĐÚNG MỘT khối rào sau (không thêm chữ nào khác trong khối); tôi sẽ chạy công cụ đó và gửi lại NGUYÊN VĂN kết quả cho bạn ở lượt kế tiếp — bạn KHÔNG tự bịa nội dung tệp:\n\nĐọc một tệp:\n```avi-tool\n{\"tool\":\"doc_tep\",\"args\":{\"path\":\"<đường dẫn tệp>\"}}\n```\n\nLiệt kê một thư mục:\n```avi-tool\n{\"tool\":\"liet_ke\",\"args\":{\"path\":\"<đường dẫn thư mục>\"}}\n```\n\nTìm một chuỗi/mẫu trong workspace (path có thể bỏ trống để tìm toàn workspace):\n```avi-tool\n{\"tool\":\"grep\",\"args\":{\"mau\":\"<mẫu cần tìm>\",\"path\":\"<thư mục, tuỳ chọn>\"}}\n```\n\nMỗi lượt trả lời CHỈ MỘT khối (một yêu cầu đọc). Nếu bạn ĐÃ có đủ nội dung cần thiết (đọc rồi, hoặc câu hỏi không cần đọc tệp nào), trả lời bình thường — KHÔNG phát khối này.\n\nQUAN TRỌNG THỨ HAI — CA KHÁC, CŨNG GHI ĐÈ \"NGUYÊN TẮC TRẢ LỜI\" Ở TRÊN: nếu câu hỏi bên dưới yêu cầu VIẾT MỘT ĐOẠN MÃ/HÀM HOÀN TOÀN MỚI (chưa tồn tại ở đâu cả — không phải sửa, không phải tìm, không cần đọc một tệp cụ thể nào để trả lời), đây CŨNG KHÔNG PHẢI ca \"ngữ cảnh không liên quan\" — ĐỪNG trả lời câu mẫu \"Tôi không có thông tin chính xác...\", và ĐỪNG phát khối đọc tệp ở trên để đi tìm một tệp không tồn tại. Hãy viết THẲNG đoạn mã được yêu cầu ngay trong câu trả lời này." +
    "\n\n";
  const SUFFIX =
    "\n\n(Nhắc lại: nếu câu hỏi trên cần nội dung một tệp bạn chưa có, hãy phát khối ```avi-tool``` như đã hướng dẫn; nếu câu hỏi là yêu cầu viết mã MỚI (không cần đọc tệp), hãy viết THẲNG mã đó — cả hai ca ĐỪNG trả lời \"không có thông tin\".)";
  const THAN_THAT = "Hằng số NGUONG_CANH_BAO_TON_KHO nằm ở tệp nào trong workspace, và giá trị của nó là bao nhiêu?";
  const WRAPPED = `${PREFIX}${THAN_THAT}${SUFFIX}`;

  it("★★★ giáo cụ ĐÚNG hình dạng ⇒ tryExecuteToolLoop ĐƯỢC gọi, với ĐÚNG phần câu hỏi thật (không giáo cụ)", async () => {
    await chay(WRAPPED, { route: "vscode" });
    expect(tryExecuteToolLoop, "gốc rễ vòng 8: giáo cụ không còn là lý do chặn toàn bộ vòng tool").toHaveBeenCalledTimes(1);
    expect(tryExecuteToolLoop.mock.calls[0]![0], "bộ chọn tool phải nhận PHẦN CÂU HỎI THẬT, không phải cả giáo cụ").toBe(THAN_THAT);
  });

  it("★★ giáo cụ ĐÚNG hình dạng, có kết quả tool THẬT ⇒ kết quả đó VẪN đi vào answer (đường vscode không còn mù)", async () => {
    datToolThat();
    const r = await chay(WRAPPED, { route: "vscode" });
    expect(r.done && r.done.type === "done" && r.done.answer).toContain(TOM_TAT_TOOL_THAT);
  });

  it("★★★ ĐỘT BIẾN — đổi 1 ký tự trong giáo cụ (không còn khớp CHÍNH XÁC) ⇒ RƠI VỀ AN TOÀN, không gọi tool (chưa từng đo, không suy diễn)", async () => {
    const gioiHan = WRAPPED.replace("ĐỌC KỸ TRƯỚC KHI", "ĐỌC Kĩ TRƯỚC KHI"); // đổi 1 chữ, không còn khớp startsWith
    const r = await chay(gioiHan, { route: "vscode" });
    expect(tryExecuteToolLoop, "khớp KHÔNG chính xác ⇒ fallback chặn toàn bộ, giống hệt vòng 5 — AN TOÀN, không phải lỗi").not.toHaveBeenCalled();
    expect(r.done && r.done.type === "done" && r.done.answer.length).toBeGreaterThan(0);
  });

  it("★★ Cmd+K (không mang giáo cụ này — dạy giao thức RIÊNG ngay trong câu hỏi) ⇒ vẫn chặn NGUYÊN VẸN như §A", async () => {
    const cauHoiCmdK = "```avi-tool\n{\"tool\":\"de_xuat_sua_doan\",\"args\":{}}\n```\n\nSửa đoạn này: thêm kiểm tra chia 0.";
    const r = await chay(cauHoiCmdK, { route: "vscode" });
    expect(tryExecuteToolLoop).not.toHaveBeenCalled();
    expect(r.done && r.done.type === "done" && r.done.answer.length).toBeGreaterThan(0);
  });
});
