/**
 * ★★★ RÒ CHUỖI SUY LUẬN QUA `/v1` — API TƯƠNG THÍCH OPENAI (G5-E).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO BỀ MẶT NÀY ĐƯỢC QUYẾT KHÁC BẢY BỀ MẶT KIA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bảy bề mặt nội bộ (thông báo, diễn giải SPC, lịch sản xuất…) chỉ có MỘT người tiêu thụ: mắt
 * người vận hành ⇒ cắt là xong. `/v1` thì khác: client bên thứ ba (Continue, Cline, IDE plugin)
 * đọc theo **hợp đồng OpenAI**, và các máy chủ suy luận (DeepSeek, vLLM, llama.cpp
 * `--reasoning-format`) đã hội tụ về một ô RIÊNG cho nội tâm model: `reasoning_content`
 * (`message.reasoning_content` ở bản không-stream, `delta.reasoning_content` ở bản stream).
 *
 * QUYẾT ĐỊNH (G5-E): **TÁCH Ô, KHÔNG DÁN INLINE — và KHÔNG BAO GIỜ inline theo bất kỳ cờ nào.**
 *   • `content` / `text`: LUÔN sạch thẻ. Không cờ nào bật lại được đường inline.
 *   • nội tâm đi vào `message.reasoning_content` (mặc định BẬT, tắt bằng
 *     `OPENAI_GATEWAY_REASONING_FIELD=off` cho client nghiêm ngặt về schema).
 *   • `/completions` (FIM): nội tâm bị **BỎ HẲN** — `text_completion` không có ô hợp lệ nào để
 *     mang nó, và chữ ở tuyến này được chèn THẲNG vào tệp mã nguồn của kỹ sư.
 *
 * ĐÁNH ĐỔI đã cân: dán inline là hành vi DUY NHẤT hỏng trên MỌI client (client biết
 * `reasoning_content` cũng hỏng, client không biết cũng hỏng); tách ô chỉ "mất chữ" với client
 * cố ý muốn đọc nội tâm — mà những client ấy đọc đúng ô này. Cờ tắt ô là dành cho client validate
 * schema chặt, KHÔNG phải để bật lại inline.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ THỨ TỰ: CẮT THẺ TRƯỚC — CHE BÍ MẬT SAU (§5). Lý do đầy đủ ở `ai/thinkingStrip.ts` đầu tệp:
 * cắt thẻ là phép XOÁ nên nó NỐI hai nửa một bí mật vốn bị khối `<think>` chẻ rời ⇒ bộ canh NỘI
 * DUNG phải đứng CUỐI. Đảo thứ tự ⇒ §5 ĐỎ.
 *
 * ⚠ §6 KHÔNG HỒI QUY: roster đang chạy (Qwen3-30B-A3B-Instruct) KHÔNG phát `<think>`. Bản vá phải
 * là **no-op từng ký tự** với đầu ra ấy — đặc biệt ở FIM, nơi thụt đầu dòng LÀ dữ liệu.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  chatText: "hello",
  fimText: "completed",
  chatStream: null as null | (() => AsyncGenerator<unknown>),
}));

const chatCompletionMock = vi.fn(async (_opts: any, modelId?: string) => ({
  text: h.chatText,
  tokensPrompt: 7,
  tokensGenerated: 3,
  modelId: modelId || "default",
  totalTimeMs: 1,
  tokensPerSecond: 1,
}));
const generateFimMock = vi.fn(async (_opts: any, modelId?: string) => ({
  text: h.fimText,
  tokensPrompt: 5,
  tokensGenerated: 2,
  modelId: modelId || "default",
  totalTimeMs: 1,
  tokensPerSecond: 1,
}));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...(a as [any, string?])),
  generateText: vi.fn(),
  generateFim: (...a: unknown[]) => generateFimMock(...(a as [any, string?])),
  generateEmbedding: vi.fn(async () => ({ embedding: [0.1], dimensions: 1, modelId: "embed" })),
  generateEmbeddings: vi.fn(async () => ({ embeddings: [[0.1]], dimensions: 1, modelId: "embed" })),
  chatCompletionStream: () => h.chatStream!(),
  generateTextStream: async function* () {},
}));

const getDbMock = vi.fn(async () => null);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => getDbMock(...(a as [])) }));

import { registerOpenAiGateway } from "./openaiGateway";

const API_KEY = "THINKING-TEST-KEY";
const AUTH = { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" };

const NOI_TAM = "Người dùng hỏi về lô 7. Ta chưa có số liệu, cứ đoán 98% cho chắc.";
const CAU_TRA_LOI = "Tỉ lệ ĐẠT của lô 7 là 96,4% theo báo cáo ca sáng.";

let may: Server;
let goc: string;

const ENV_KEYS = [
  "OPENAI_GATEWAY_ENABLED",
  "OPENAI_GATEWAY_API_KEY",
  "OPENAI_GATEWAY_PATH",
  "OPENAI_GATEWAY_REASONING_FIELD",
  "AI_THINKING_TAGS",
  "AI_THINKING_STARTS_OPEN",
] as const;
const luuEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENV_KEYS) luuEnv[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  delete process.env.OPENAI_GATEWAY_PATH;
  const app = express();
  expect(registerOpenAiGateway(app)).toBe(true);
  may = createServer(app);
  await new Promise<void>((r) => may.listen(0, "127.0.0.1", r));
  goc = `http://127.0.0.1:${(may.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => may.close(() => r()));
  for (const k of ENV_KEYS) {
    if (luuEnv[k] === undefined) delete process.env[k];
    else process.env[k] = luuEnv[k];
  }
});

beforeEach(() => {
  h.chatText = "hello";
  h.fimText = "completed";
  h.chatStream = null;
  delete process.env.OPENAI_GATEWAY_REASONING_FIELD;
  delete process.env.AI_THINKING_TAGS;
  delete process.env.AI_THINKING_STARTS_OPEN;
});

afterEach(() => {
  delete process.env.OPENAI_GATEWAY_REASONING_FIELD;
  delete process.env.AI_THINKING_TAGS;
  delete process.env.AI_THINKING_STARTS_OPEN;
});

// ─── tiện ích gọi ────────────────────────────────────────────────────────────────────────────

async function chat(than: unknown): Promise<{ json: any; tho: string }> {
  const res = await fetch(`${goc}/v1/chat/completions`, { method: "POST", headers: AUTH, body: JSON.stringify(than) });
  const tho = await res.text();
  return { json: JSON.parse(tho), tho };
}

async function completions(than: unknown): Promise<{ json: any; tho: string }> {
  const res = await fetch(`${goc}/v1/completions`, { method: "POST", headers: AUTH, body: JSON.stringify(than) });
  const tho = await res.text();
  return { json: JSON.parse(tho), tho };
}

interface KetQuaSSE {
  tho: string;
  suKien: any[];
  /** Chữ client hiển thị = nối mọi `delta.content`. */
  chuNoiLai: string;
  /** Nội tâm client đọc riêng = nối mọi `delta.reasoning_content`. */
  noiTamNoiLai: string;
}

async function chatStream(than: unknown): Promise<KetQuaSSE> {
  const res = await fetch(`${goc}/v1/chat/completions`, {
    method: "POST",
    headers: AUTH,
    body: JSON.stringify({ ...(than as object), stream: true }),
  });
  const tho = await res.text();
  const suKien: any[] = [];
  for (const dong of tho.split("\n")) {
    if (!dong.startsWith("data: ")) continue;
    const d = dong.slice(6).trim();
    if (!d || d === "[DONE]") continue;
    try {
      suKien.push(JSON.parse(d));
    } catch {
      /* giữ nguyên trong `tho` */
    }
  }
  const oDelta = (k: string) =>
    suKien.map((s) => String(s?.choices?.[0]?.delta?.[k] ?? "")).join("");
  return { tho, suKien, chuNoiLai: oDelta("content"), noiTamNoiLai: oDelta("reasoning_content") };
}

function luongTuManh(manh: string[]) {
  return async function* () {
    for (const m of manh) yield { type: "token", token: m };
    yield { type: "done", fullText: manh.join(""), tokensPrompt: 1, tokensGenerated: manh.length };
  };
}

const THAN_CHAT = { model: "chat", messages: [{ role: "user", content: "chào" }] };

/** Không một dấu vết nào của khối suy luận ra khỏi ô HIỂN THỊ. */
function oHienThiSach(chu: string): void {
  expect(chu).not.toContain(NOI_TAM);
  expect(chu).not.toContain("cứ đoán 98%");
  expect(chu).not.toContain("<think>");
  expect(chu).not.toContain("</think>");
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — POST /v1/chat/completions KHÔNG stream: `content` sạch, nội tâm sang ô riêng", () => {
  it("★ khối <think> KHÔNG còn trong `message.content`", async () => {
    h.chatText = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const { json, tho } = await chat(THAN_CHAT);
    const msg = json.choices[0].message;
    oHienThiSach(String(msg.content));
    expect(msg.content).toContain("96,4%");
    // Thân byte thô: nội tâm CHỈ được phép xuất hiện trong ô reasoning_content, không chỗ nào khác.
    expect(tho.split('"reasoning_content"').length).toBeLessThanOrEqual(2);
  });

  it("nội tâm đi vào `message.reasoning_content` (mặc định BẬT)", async () => {
    h.chatText = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const { json } = await chat(THAN_CHAT);
    expect(String(json.choices[0].message.reasoning_content)).toContain("cứ đoán 98%");
  });

  it("`OPENAI_GATEWAY_REASONING_FIELD=off` ⇒ ô biến mất HẲN, `content` VẪN sạch", async () => {
    process.env.OPENAI_GATEWAY_REASONING_FIELD = "off";
    h.chatText = `<think>${NOI_TAM}</think>${CAU_TRA_LOI}`;
    const { json, tho } = await chat(THAN_CHAT);
    expect(json.choices[0].message.reasoning_content).toBeUndefined();
    expect(tho).not.toContain("reasoning_content");
    oHienThiSach(tho); // ★ cờ TẮT không được mở lại đường inline
    expect(json.choices[0].message.content).toContain("96,4%");
  });

  it("thẻ mở KHÔNG BAO GIỜ đóng (hết token giữa khối) ⇒ `content` rỗng, không phun nội tâm", async () => {
    h.chatText = `<think>${NOI_TAM}`;
    const { json, tho } = await chat(THAN_CHAT);
    expect(json.choices[0].message.content).toBe("");
    oHienThiSach(String(json.choices[0].message.content));
    expect(tho.includes(NOI_TAM)).toBe(true); // chỉ trong ô reasoning_content
    expect(String(json.choices[0].message.reasoning_content)).toContain(NOI_TAM);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — POST /v1/chat/completions STREAM: thẻ chẻ đôi qua nhiều chunk SSE", () => {
  it("★ khối gọn trong MỘT chunk không ra ô `delta.content`", async () => {
    h.chatStream = luongTuManh([`<think>${NOI_TAM}</think>`, CAU_TRA_LOI]);
    const kq = await chatStream(THAN_CHAT);
    oHienThiSach(kq.chuNoiLai);
    expect(kq.chuNoiLai).toContain("96,4%");
  });

  it("★ thẻ CHẺ ĐÔI qua hai sự kiện SSE — phép cắt một-lượt MÙ ca này", async () => {
    h.chatStream = luongTuManh(["Trả lời: <thi", "nk>", NOI_TAM, "</th", "ink>", CAU_TRA_LOI]);
    const kq = await chatStream(THAN_CHAT);
    oHienThiSach(kq.chuNoiLai);
    expect(kq.chuNoiLai).toContain("Trả lời: ");
    expect(kq.chuNoiLai).toContain("96,4%");
  });

  it("★ chẻ TỪNG KÝ TỰ MỘT", async () => {
    h.chatStream = luongTuManh(`<think>${NOI_TAM}</think>${CAU_TRA_LOI}`.split(""));
    const kq = await chatStream(THAN_CHAT);
    oHienThiSach(kq.chuNoiLai);
    expect(kq.chuNoiLai).toContain("96,4%");
  });

  it("nội tâm ra ô `delta.reasoning_content` chứ không ô `delta.content`", async () => {
    h.chatStream = luongTuManh([`<think>${NOI_TAM}</think>`, CAU_TRA_LOI]);
    const kq = await chatStream(THAN_CHAT);
    expect(kq.noiTamNoiLai).toContain("cứ đoán 98%");
    expect(kq.chuNoiLai).not.toContain("cứ đoán 98%");
  });

  it("cờ TẮT ⇒ không ô nội tâm nào, `delta.content` vẫn sạch", async () => {
    process.env.OPENAI_GATEWAY_REASONING_FIELD = "0";
    h.chatStream = luongTuManh([`<think>${NOI_TAM}</think>`, CAU_TRA_LOI]);
    const kq = await chatStream(THAN_CHAT);
    expect(kq.tho).not.toContain("reasoning_content");
    expect(kq.tho).not.toContain(NOI_TAM);
    expect(kq.chuNoiLai).toContain("96,4%");
  });

  it("chat template MỞ SẴN khối (AI_THINKING_STARTS_OPEN) — thẻ đầu tiên là thẻ ĐÓNG", async () => {
    process.env.AI_THINKING_STARTS_OPEN = "1";
    h.chatStream = luongTuManh([NOI_TAM, "</think>", CAU_TRA_LOI]);
    const kq = await chatStream(THAN_CHAT);
    expect(kq.chuNoiLai).not.toContain(NOI_TAM);
    expect(kq.chuNoiLai).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — POST /v1/completions (FIM): nội tâm BỎ HẲN, không ô nào mang nó", () => {
  const THAN_FIM = { model: "fim", prompt: "function tong(a, b) {\n  return ", suffix: "\n}\n" };

  it("★ `choices[0].text` sạch thẻ — chữ này được CHÈN THẲNG vào tệp mã nguồn", async () => {
    h.fimText = `<think>${NOI_TAM}</think>a + b;`;
    const { json, tho } = await completions(THAN_FIM);
    oHienThiSach(String(json.choices[0].text));
    expect(json.choices[0].text).toContain("a + b;");
    expect(tho).not.toContain("reasoning_content"); // BỎ HẲN, không tách ô ở tuyến này
    expect(tho).not.toContain(NOI_TAM);
  });

  it("nhánh STREAM của cùng tuyến cũng sạch", async () => {
    h.fimText = `<think>${NOI_TAM}</think>a + b;`;
    const res = await fetch(`${goc}/v1/completions`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ ...THAN_FIM, stream: true }),
    });
    const tho = await res.text();
    oHienThiSach(tho);
    expect(tho).toContain("a + b;");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — tập thẻ khai báo được (AI_THINKING_TAGS) có hiệu lực trên tuyến sống", () => {
  it("<phan_tich_noi_bo> khai trong env bị cắt khỏi `content`", async () => {
    process.env.AI_THINKING_TAGS = "phan_tich_noi_bo";
    h.chatText = `<phan_tich_noi_bo>${NOI_TAM}</phan_tich_noi_bo>${CAU_TRA_LOI}`;
    const { json } = await chat(THAN_CHAT);
    expect(json.choices[0].message.content).not.toContain(NOI_TAM);
    expect(json.choices[0].message.content).not.toContain("phan_tich_noi_bo");
    expect(json.choices[0].message.content).toContain("96,4%");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§5 — TỔ HỢP: bí mật bị khối <think> chẻ đôi (ca PHÂN BIỆT thứ tự hai bộ lọc)", () => {
  const NUA_DAU = "sk-ABCDEFGH";
  const NUA_SAU = "IJKLMNOPQRSTUVWX";
  const KHOA_NOI = NUA_DAU + NUA_SAU;

  it("★ không-stream: cắt thẻ TRƯỚC ⇒ bộ che thấy khoá HOÀN CHỈNH (đảo thứ tự ⇒ ĐỎ)", async () => {
    h.chatText = `Khoá: ${NUA_DAU}<think>${NOI_TAM}</think>${NUA_SAU} — hết.`;
    const { json, tho } = await chat(THAN_CHAT);
    expect(tho).not.toContain(KHOA_NOI);
    expect(String(json.choices[0].message.content)).toContain("[REDACTED_SECRET]");
    expect(json.choices[0].message.content).toContain("Khoá: ");
    expect(json.choices[0].message.content).toContain("hết.");
  });

  it("★ stream: cùng ca, thêm chẻ TỪNG KÝ TỰ (thẻ và bí mật chồng lên nhau)", async () => {
    h.chatStream = luongTuManh(`Khoá: ${NUA_DAU}<think>${NOI_TAM}</think>${NUA_SAU} — hết.`.split(""));
    const kq = await chatStream(THAN_CHAT);
    expect(kq.tho).not.toContain(KHOA_NOI);
    expect(kq.chuNoiLai).toContain("[REDACTED_SECRET]");
    oHienThiSach(kq.chuNoiLai);
  });

  it("bí mật nằm TRỌN trong khối ⇒ ô nội tâm cũng phải được che (nó vẫn rời máy chủ)", async () => {
    const BI_MAT = "sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    h.chatText = `<think>Khoá thật là ${BI_MAT}.</think>${CAU_TRA_LOI}`;
    const { tho } = await chat(THAN_CHAT);
    expect(tho).not.toContain(BI_MAT);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§6 — KHÔNG HỒI QUY: đầu ra roster HIỆN TẠI đi qua NGUYÊN VẸN TỪNG KÝ TỰ", () => {
  const SACH = "  Kết quả: ĐẠT.\n  Ghi chú: a < b và 3<4 vẫn ổn.\t\n";

  it("chat không-stream: `content` === đầu ra engine, từng ký tự (kể cả khoảng trắng biên)", async () => {
    h.chatText = SACH;
    const { json, tho } = await chat(THAN_CHAT);
    expect(json.choices[0].message.content).toBe(SACH);
    expect(tho).not.toContain("reasoning_content"); // không có nội tâm ⇒ không mọc ô thừa
  });

  it("★ FIM: thụt đầu dòng LÀ dữ liệu — không được trim, không được đổi một byte", async () => {
    const MA = "\n    return a + b;\n";
    h.fimText = MA;
    const { json } = await completions({ model: "fim", prompt: "f() {", suffix: "}" });
    expect(json.choices[0].text).toBe(MA);
  });

  it("chat stream: nối lại các `delta.content` === chuỗi gốc, từng ký tự", async () => {
    const cau = "Kết quả kiểm tra tấm số 7: ĐẠT, 0 lỗi. Ngưỡng a < b, tỉ lệ < 0.5%.";
    h.chatStream = luongTuManh(cau.split(""));
    const kq = await chatStream(THAN_CHAT);
    expect(kq.chuNoiLai).toBe(cau);
    expect(kq.noiTamNoiLai).toBe("");
  });

  it("chat stream: dấu `<` bình thường KHÔNG bị giữ lại vô cớ (chảy liên tục)", async () => {
    const manh = Array.from({ length: 60 }, (_, i) => `m${String(i).padStart(3, "0")} `);
    h.chatStream = luongTuManh(manh);
    const kq = await chatStream(THAN_CHAT);
    expect(kq.chuNoiLai).toBe(manh.join(""));
    const soChunkCoChu = kq.suKien.filter((s) => String(s?.choices?.[0]?.delta?.content ?? "") !== "").length;
    expect(soChunkCoChu).toBeGreaterThanOrEqual(50);
  });
});
