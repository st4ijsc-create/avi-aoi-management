/**
 * ★★★ RÒ CHUỖI SUY LUẬN RA GIAO DIỆN VẬN HÀNH — `aiLocalKnowledgeService.ts` (G5-C).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖ CÓ THẬT, ĐO ĐƯỢC TRÊN MÃ TRƯỚC BẢN VÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * G5-B đã vá `stripThinking()` và dựng `StreamingThinkingStripper`, nhưng **đường chat vận hành
 * chính không gọi cái nào cả** — chỉ copilot lập trình gọi. Hợp đồng viết ở chú thích
 * `RouteDecision.thinking` ("caller MUST strip") là **chữ suông**: không có bên nào đọc cờ ấy.
 *
 * Roster sắp đổi sang họ Qwen3.x — model CÓ phát khối `<think>`. Không nối ⇒ người vận hành đọc
 * được nội tâm model giữa câu trả lời. Đây là hỏng-trong-im-lặng thuần tuý: không crash, không
 * log đỏ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI ĐƯỜNG ĐỀU PHẢI CANH (một đường được vá, đường kia rò tiếp = vô nghĩa)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • KHÔNG-STREAMING: `answerQuestion` → `generateWithOllama` → `generateText`.
 *   • STREAMING:       `streamAnswer`  → `generateWithOllamaStream` → `generateTextStream`.
 *     Đường streaming khó hơn: một thẻ `<think>` bị **chẻ đôi qua hai chunk** thì phép cắt
 *     một-lượt không nhìn thấy nó ⇒ phải là bộ cắt GIỮ TRẠNG THÁI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ §5 — THỨ TỰ HAI BỘ LỌC LÀ MỘT QUYẾT ĐỊNH, KHÔNG PHẢI CHI TIẾT CÀI ĐẶT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đã quyết: **CẮT THẺ TRƯỚC — CHE BÍ MẬT SAU.** Lý do đo được, không phải thẩm mỹ: cắt thẻ là
 * phép **XOÁ**, nên nó **nối liền** hai đoạn chữ vốn bị khối `<think>` tách rời. Một khoá bị chẻ
 * đôi bởi khối suy luận (`sk-` + 8 ký tự · `<think>…</think>` · 16 ký tự nữa) thì:
 *   – che TRƯỚC: mỗi nửa đều DƯỚI ngưỡng `sk-[A-Za-z0-9]{16,}` ⇒ không khớp ⇒ nhả nguyên văn;
 *     sau đó bộ cắt nối hai nửa lại ⇒ **khoá đủ 24 ký tự ra tới trình duyệt.**
 *   – cắt TRƯỚC: hai nửa nối lại NGAY, bộ che nhìn thấy khoá hoàn chỉnh ⇒ `[REDACTED_SECRET]`.
 * Nguyên tắc rút ra: **bộ lọc canh NỘI DUNG phải đứng CUỐI**, sau mọi phép biến đổi cấu trúc —
 * nếu không nó canh một chuỗi khác với chuỗi người dùng thật sự nhận.
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
const QUERY_VEC = unit(0);

const chunks = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/HUONG_DAN.md",
    title: "Hướng dẫn kiểm tra AOI",
    text: "Nội dung hướng dẫn kiểm tra AOI: bước 1 kiểm tra camera, bước 2 kiểm tra ánh sáng.",
    keywords: ["aoi"],
  },
];
const embeddings = [
  {
    id: "c1",
    sourceType: "feature",
    sourcePath: "domain/knowledge/HUONG_DAN.md",
    title: "Hướng dẫn kiểm tra AOI",
    keywords: ["aoi"],
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

// ⚠ G2-C — `tryExecuteToolLoop` PHẢI có mặt ở đây. Factory liệt kê tay làm MỌI symbol không được
// nêu biến mất (đúng lớp lỗi đã ghi ở `ai/thinkingStrip.ts` §1 và `aiLlamaServerClient.ts`): thiếu dòng
// này thì service gọi `undefined(...)` và toàn bộ file này đỏ — đã xảy ra thật khi thêm vòng lặp.
vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
  tryExecuteToolLoop: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" }, loop: null })),
}));

const generateEmbedding = vi.fn();
const isGgufAvailable = vi.fn();
const generateText = vi.fn();
const generateTextStream = vi.fn();
// ⚠ CỐ Ý mock TOÀN BỘ engine y hệt `aiLocalKnowledgeSafety.test.ts`: nếu bộ cắt được lấy từ
// module này thì mock ở đây sẽ **vô hiệu hoá lưới an toàn** mà lưới vẫn xanh. Bộ cắt phải đến từ
// một module LÁ khác (`./ai/thinkingStrip`) — đó là một phần của thiết kế, không phải tình cờ.
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: (...a: unknown[]) => generateEmbedding(...a),
  isGgufAvailable: (...a: unknown[]) => isGgufAvailable(...a),
  generateText: (...a: unknown[]) => generateText(...a),
  generateTextStream: (...a: unknown[]) => generateTextStream(...a),
}));

const getDbMock = vi.fn();
const insertValuesMock = vi.fn(async () => undefined);
const insertMock = vi.fn(() => ({ values: insertValuesMock }));
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...a) }));

import { answerQuestion, streamAnswer, reloadKbArtifacts, type StreamEvent } from "./aiLocalKnowledgeService";

// ─── Hằng dùng chung ───────────────────────────────────────────────────────────────────────
/** Nội tâm model — chuỗi này KHÔNG BAO GIỜ được xuất hiện ở đầu ra người dùng. */
const NOI_TAM = "Người dùng hỏi về AOI. Ta nên bịa một con số cho có vẻ chắc chắn.";
const CAU_TRA_LOI = "Bước 1 kiểm tra camera, bước 2 kiểm tra ánh sáng theo tài liệu [1].";
const BI_MAT = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

let topKCounter = 300;
function nextTopK(): number {
  return ++topKCounter;
}

/** Mọi dấu vết của khối suy luận đều phải biến mất — cả nội dung LẪN thẻ. */
function khongConSuyLuan(chu: string): void {
  expect(chu).not.toContain(NOI_TAM);
  expect(chu).not.toContain("<think>");
  expect(chu).not.toContain("</think>");
  expect(chu).not.toContain("bịa một con số");
}

async function gomLuong(question: string, topK: number): Promise<{ events: StreamEvent[]; chu: string; done?: StreamEvent }> {
  const events: StreamEvent[] = [];
  const tokens: string[] = [];
  for await (const evt of streamAnswer(question, topK)) {
    events.push(evt);
    if (evt.type === "token") tokens.push(evt.token);
  }
  return { events, chu: tokens.join(""), done: events.find((e) => e.type === "done") };
}

function luongTuManh(manh: string[]) {
  return async function* () {
    for (const m of manh) yield { type: "token", token: m };
    yield { type: "done", fullText: manh.join(""), tokensPrompt: 10, tokensGenerated: manh.length };
  };
}

const ENV_KEYS = ["AI_SAFETY_ENABLED", "AI_THINKING_TAGS", "AI_THINKING_STARTS_OPEN"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
  isGgufAvailable.mockResolvedValue(true);
  generateEmbedding.mockResolvedValue({ embedding: QUERY_VEC, dimensions: DIM, modelId: "embed-stub" });
  getDbMock.mockResolvedValue({ insert: insertMock });
  reloadKbArtifacts();
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — KHÔNG-STREAMING (answerQuestion → generateWithOllama)", () => {
  it("khối <think> ở ĐẦU câu trả lời không lọt ra giao diện", async () => {
    generateText.mockResolvedValue({
      text: `<think>${NOI_TAM}</think>\n${CAU_TRA_LOI}`,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 40, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(kq.answer);
    expect(kq.answer).toContain("Bước 1 kiểm tra camera");
  });

  it("thẻ LỒNG NHAU + thẻ tên khác (<reasoning>) cũng bị cắt sạch", async () => {
    generateText.mockResolvedValue({
      text: `<reasoning>${NOI_TAM}<think>lồng trong</think>còn sót</reasoning>${CAU_TRA_LOI}`,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 40, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(kq.answer);
    expect(kq.answer).not.toContain("còn sót");
    expect(kq.answer).not.toContain("lồng trong");
    expect(kq.answer).toContain("Bước 1 kiểm tra camera");
  });

  it("đầu ra TOÀN LÀ suy luận (thẻ không đóng, hết token) ⇒ rơi về câu trả lời trích xuất, KHÔNG rò", async () => {
    // Ca kích hoạt thật: router cấp token cho tác vụ khó, model reasoning tiêu hết vào <think>.
    generateText.mockResolvedValue({
      text: `<think>${NOI_TAM} ${NOI_TAM}`,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 60, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(kq.answer);
    expect(kq.provider).not.toBe("ollama"); // rơi về extractive/tool — trung thực
    expect(kq.answer.length).toBeGreaterThan(0); // vẫn có gì đó để đọc
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — STREAMING (streamAnswer → generateWithOllamaStream)", () => {
  it("khối <think> gọn trong MỘT chunk không lọt ra", async () => {
    generateTextStream.mockImplementation(luongTuManh([`<think>${NOI_TAM}</think>`, CAU_TRA_LOI]));

    const { chu, done } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).toContain("Bước 1 kiểm tra camera");
    khongConSuyLuan(String((done as { answer?: string })?.answer ?? ""));
  });

  it("★ thẻ bị CHẺ ĐÔI qua ranh giới chunk — phép cắt một-lượt MÙ ca này", async () => {
    // "<thi" ở cuối chunk 1, "nk>" ở đầu chunk 2. Chỉ bộ cắt GIỮ TRẠNG THÁI mới thấy.
    generateTextStream.mockImplementation(
      luongTuManh(["Trả lời: <thi", "nk>", NOI_TAM, "</th", "ink>", CAU_TRA_LOI]),
    );

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).toContain("Trả lời: ");
    expect(chu).toContain("Bước 1 kiểm tra camera");
  });

  it("★ chẻ TỪNG KÝ TỰ MỘT — trường hợp khắc nghiệt nhất", async () => {
    const tho = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    generateTextStream.mockImplementation(luongTuManh(tho.split("")));

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).toContain("Bước 1 kiểm tra camera");
  });

  it("chuỗi suy luận CHƯA ĐÓNG khi luồng kết thúc ⇒ không xả nó ra lúc flush", async () => {
    generateTextStream.mockImplementation(luongTuManh([CAU_TRA_LOI, "<think>", NOI_TAM]));

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).toContain("Bước 1 kiểm tra camera");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — chat template MỞ SẴN khối suy luận (startInsideThinking)", () => {
  it("★ đầu ra bắt đầu NGAY TRONG khối (thẻ đầu tiên là thẻ ĐÓNG) — cờ bật ⇒ không rò", async () => {
    process.env.AI_THINKING_STARTS_OPEN = "1";
    generateTextStream.mockImplementation(luongTuManh([NOI_TAM, "</think>", CAU_TRA_LOI]));

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).toContain("Bước 1 kiểm tra camera");
  });

  it("cờ bật + đường KHÔNG-STREAMING: thẻ đóng lạc vẫn cắt đúng", async () => {
    process.env.AI_THINKING_STARTS_OPEN = "1";
    generateText.mockResolvedValue({
      text: `${NOI_TAM}</think>${CAU_TRA_LOI}`,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 40, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(kq.answer);
    expect(kq.answer).toContain("Bước 1 kiểm tra camera");
  });

  /**
   * ★★ CA NÀY SINH RA TỪ MỘT ĐỘT BIẾN SỐNG SÓT (M6, vòng đo đầu của G5-C).
   *
   * Đột biến "đường MỘT LƯỢT bỏ qua `thinkingStartsOpen()`" vẫn XANH với ca ngay bên trên — vì ca
   * ấy có một thẻ ĐÓNG lạc, mà nhánh "đóng ở độ sâu 0" của `scanThinking` tự xử lý được KHÔNG CẦN
   * cờ. Nói cách khác: ca ấy xanh **qua một cơ chế KHÁC** với cơ chế nó tưởng đang canh.
   *
   * Hình dạng DUY NHẤT mà cờ thật sự quyết định: template mở sẵn khối, model **chưa kịp đóng thẻ**
   * (hết token) ⇒ đầu ra **KHÔNG có một thẻ nào cả**, toàn bộ là nội tâm. Không đọc cờ ⇒ rò 100%.
   */
  it("★★ cờ bật + đầu ra KHÔNG có thẻ nào ⇒ toàn bộ là suy luận, KHÔNG được hiển thị", async () => {
    process.env.AI_THINKING_STARTS_OPEN = "1";
    generateText.mockResolvedValue({
      text: `${NOI_TAM} Ta cứ nói đại một con số cho xong.`,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 40, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(kq.answer);
    expect(kq.answer).not.toContain("nói đại một con số");
    expect(kq.provider).not.toBe("ollama"); // rơi về extractive — trung thực
  });

  it("cờ TẮT (mặc định) + đầu ra không thẻ ⇒ KHÔNG cắt oan câu trả lời bình thường", async () => {
    // Nửa còn lại của cờ: bật mặc định sẽ nuốt trọn mọi câu trả lời của model KHÔNG mở sẵn khối.
    generateText.mockResolvedValue({
      text: CAU_TRA_LOI,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 40, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    expect(kq.answer).toContain("Bước 1 kiểm tra camera");
    expect(kq.provider).toBe("ollama");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — thẻ khai báo thêm qua AI_THINKING_TAGS vẫn hiệu lực trên đường sống", () => {
  it("<phan_tich_noi_bo> khai trong env bị cắt ở đường streaming", async () => {
    process.env.AI_THINKING_TAGS = "phan_tich_noi_bo";
    generateTextStream.mockImplementation(
      luongTuManh(["<phan_tich_noi_bo>", NOI_TAM, "</phan_tich_noi_bo>", CAU_TRA_LOI]),
    );

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    expect(chu).not.toContain(NOI_TAM);
    expect(chu).not.toContain("phan_tich_noi_bo");
    expect(chu).toContain("Bước 1 kiểm tra camera");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — TỔ HỢP hai bộ lọc: bí mật VÀ thẻ suy luận chồng lên nhau", () => {
  /**
   * Khoá bị khối `<think>` chẻ làm đôi. Mỗi nửa DƯỚI ngưỡng `sk-[A-Za-z0-9]{16,}`:
   *   nửa đầu `sk-ABCDEFGH` (8 ký tự sau `sk-`) · nửa sau 16 ký tự KHÔNG có tiền tố `sk-`.
   * Nối lại ⇒ 24 ký tự ⇒ khớp. Đây chính là ca **phân biệt được thứ tự hai bộ lọc**.
   */
  const NUA_DAU = "sk-ABCDEFGH";
  const NUA_SAU = "IJKLMNOPQRSTUVWX";
  const KHOA_NOI = NUA_DAU + NUA_SAU;

  it("★ bí mật bị khối <think> chẻ đôi — cắt thẻ TRƯỚC nên bộ che thấy khoá HOÀN CHỈNH", async () => {
    generateTextStream.mockImplementation(
      luongTuManh(["Khoá: ", NUA_DAU, `<think>${NOI_TAM}</think>`, NUA_SAU, " — hết."]),
    );

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).not.toContain(KHOA_NOI); // ⚠ ĐỎ nếu đảo thứ tự hai bộ lọc
    expect(chu).toContain("[REDACTED_SECRET]");
    expect(chu).toContain("Khoá: ");
    expect(chu).toContain("hết.");
  });

  it("★ ca trên + CẢ HAI đều bị chẻ từng ký tự qua nhiều chunk", async () => {
    const tho = `Khoá: ${NUA_DAU}<think>${NOI_TAM}</think>${NUA_SAU} — hết.`;
    generateTextStream.mockImplementation(luongTuManh(tho.split("")));

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(chu);
    expect(chu).not.toContain(KHOA_NOI);
    expect(chu).toContain("[REDACTED_SECRET]");
  });

  it("bí mật nằm TRỌN trong khối suy luận ⇒ biến mất cùng khối (không để lại placeholder giữa câu)", async () => {
    generateTextStream.mockImplementation(
      luongTuManh([`<think>Khoá thật là ${BI_MAT}, ta không nên nói ra.</think>`, CAU_TRA_LOI]),
    );

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    expect(chu).not.toContain(BI_MAT);
    expect(chu).not.toContain("Khoá thật là");
    expect(chu.trim()).toBe(CAU_TRA_LOI);
  });

  it("đường KHÔNG-STREAMING: cùng ca chẻ khoá bằng khối suy luận", async () => {
    generateText.mockResolvedValue({
      text: `Khoá: ${NUA_DAU}<think>${NOI_TAM}</think>${NUA_SAU} — hết.`,
      modelId: "stub", totalTimeMs: 5, tokensGenerated: 40, tokensPrompt: 20, tokensPerSecond: 8,
    });

    const kq = await answerQuestion("hướng dẫn kiểm tra AOI là gì", nextTopK());
    khongConSuyLuan(kq.answer);
    expect(kq.answer).not.toContain(KHOA_NOI);
    expect(kq.answer).toContain("[REDACTED_SECRET]");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — KHÔNG NUỐT KÝ TỰ và KHÔNG biến streaming thành phát-theo-khối", () => {
  it("chữ sạch (không có thẻ nào) ra ĐỦ TỪNG KÝ TỰ dù chẻ 1 byte/chunk", async () => {
    const cau = "Kết quả kiểm tra tấm số 7: ĐẠT, 0 lỗi. Máy sẵn sàng chạy lô kế tiếp.";
    generateTextStream.mockImplementation(luongTuManh(cau.split("")));

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    expect(chu).toBe(cau);
  });

  it("dấu `<` bình thường (a < b, so sánh HTML) KHÔNG bị giữ lại vô cớ", async () => {
    const cau = "Ngưỡng NG: a < b và tỉ lệ < 0.5% thì máy vẫn ĐẠT.";
    generateTextStream.mockImplementation(luongTuManh(cau.match(/[\s\S]{1,3}/g) ?? []));

    const { chu } = await gomLuong("hướng dẫn kiểm tra AOI là gì", nextTopK());
    expect(chu).toBe(cau);
  });

  it("100 mảnh vào ⇒ chữ chảy ra nhiều sự kiện, không gom một cục", async () => {
    const manh = Array.from({ length: 100 }, (_, i) => `mảnh${String(i).padStart(3, "0")} `);
    generateTextStream.mockImplementation(luongTuManh(manh));

    const events: StreamEvent[] = [];
    for await (const evt of streamAnswer("hướng dẫn kiểm tra AOI là gì", nextTopK())) events.push(evt);
    const soToken = events.filter((e) => e.type === "token" && e.token.length > 0).length;

    expect(soToken).toBeGreaterThan(50);
    expect(events.filter((e) => e.type === "token").map((e) => (e as { token: string }).token).join("")).toBe(manh.join(""));
  });
});
