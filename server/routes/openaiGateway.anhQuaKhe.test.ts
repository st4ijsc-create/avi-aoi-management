/**
 * ★ Đợt 9 (2026-10-24, dieu-phoi duyệt (a)) — `/v1/chat/completions` CHUYỂN ẢNH khi khe llama-server có thị giác (`--mmproj`,
 * `kheDangCoThiGiac` mock ở đây). Hợp đồng: spec 2026-10-24-ai-local-doc-anh-tro-ly-lap-trinh.md §6. Đột biến phải bắt: bỏ câu hệ
 * thống ảnh ⇒ §1 đỏ; bỏ kiểm MIME/trần ⇒ §3 đỏ; bỏ hỏi khe ⇒ §2 đỏ; bỏ map lỗi LoiAnhKhongHoTro ⇒ §4 đỏ.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  thiGiac: true,
  loiEngine: null as Error | null,
  streamOpts: [] as any[],
  done: { type: "done", tokensPrompt: 11, tokensGenerated: 7, tokensReasoning: 4 } as Record<string, unknown>,
}));

const chatCompletionMock = vi.fn(async (_opts: any) => {
  if (h.loiEngine) throw h.loiEngine;
  return {
  text: "ok",
  tokensPrompt: 3,
  tokensGenerated: 2,
  modelId: "x",
  totalTimeMs: 1,
  tokensPerSecond: 1,
  };
});
const generateFimMock = vi.fn(async () => ({ text: "return 1;", tokensPrompt: 5, tokensGenerated: 2, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 }));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: (...a: unknown[]) => chatCompletionMock(...(a as [any])),
  generateText: vi.fn(),
  generateFim: () => generateFimMock(),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  chatCompletionStream: (opts: any) => {
    h.streamOpts.push(opts);
    return (async function* () {
      yield { type: "token", token: "xin " };
      yield { type: "token", token: "chao" };
      yield h.done;
    })();
  },
  generateTextStream: async function* () {},
}));
vi.mock("../services/aiLlamaServerClient", async (goc) => ({
  ...(await goc<typeof import("../services/aiLlamaServerClient")>()),
  kheDangCoThiGiac: vi.fn(async () => h.thiGiac),
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { createOpenAiGatewayRouter } from "./openaiGateway";

const KEY = "ANH-QUA-KHE-KEY";
let may: { url: string; server: Server };
beforeAll(async () => {
  const app = express();
  app.use("/v1", createOpenAiGatewayRouter({ apiKey: KEY }));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(() => new Promise<void>((r) => may.server.close(() => r())));
beforeEach(() => {
  vi.clearAllMocks();
  h.streamOpts = [];
  h.thiGiac = true;
  h.loiEngine = null;
  h.done = { type: "done", tokensPrompt: 11, tokensGenerated: 7, tokensReasoning: 4 };
});

const post = (duong: string, than: Record<string, unknown>) =>
  fetch(`${may.url}/v1${duong}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(than),
  });
const MSG = [{ role: "user", content: "hi" }];


const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 7)]);
const URL_PNG = `data:image/png;base64,${PNG.toString("base64")}`;
const anh = (url: string = URL_PNG) => ({ type: "image_url", image_url: { url } });
const hoiAnh = (them: Record<string, unknown> = {}, ...phan: unknown[]) => ({
  messages: [{ role: "user", content: [{ type: "text", text: "lỗi gì?" }, ...(phan.length ? phan : [anh()])] }],
  ...them,
});

describe("§1 — khe có thị giác ⇒ ảnh đi tiếp + câu hệ thống 'ảnh là dữ liệu'", () => {
  it("non-stream: user message mang anh (data URL chuẩn hoá), chữ nối như cũ, system chèn ĐẦU", async () => {
    const r = await post("/chat/completions", hoiAnh());
    expect(r.status).toBe(200);
    const msgs = chatCompletionMock.mock.calls[0][0].messages;
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("DỮ LIỆU");
    const u = msgs.find((m: any) => m.role === "user");
    expect(u.content).toBe("lỗi gì?");
    expect(u.anh).toEqual([URL_PNG]);
  });
  it("đã có system ⇒ câu ảnh NỐI vào system đó (không thêm system thứ hai)", async () => {
    await post("/chat/completions", { messages: [{ role: "system", content: "Bạn là trợ lý." }, { role: "user", content: [anh()] }] });
    const msgs = chatCompletionMock.mock.calls[0][0].messages;
    expect(msgs.filter((m: any) => m.role === "system")).toHaveLength(1);
    expect(msgs[0].content.startsWith("Bạn là trợ lý.")).toBe(true);
    expect(msgs[0].content).toContain("DỮ LIỆU");
  });
  it("stream: chatCompletionStream nhận anh", async () => {
    const r = await post("/chat/completions", hoiAnh({ stream: true }));
    await r.text();
    expect(h.streamOpts[0].messages.find((m: any) => m.role === "user").anh).toEqual([URL_PNG]);
  });
  it("không ảnh ⇒ KHÔNG chèn câu hệ thống ảnh (đường chữ không đổi)", async () => {
    await post("/chat/completions", { messages: MSG });
    expect(JSON.stringify(chatCompletionMock.mock.calls[0][0].messages)).not.toContain("DỮ LIỆU");
  });
});

describe("§2 — khe KHÔNG có thị giác ⇒ 400 IMAGE_KHONG_HO_TRO, engine không được gọi", () => {
  it("non-stream", async () => {
    h.thiGiac = false;
    const r = await post("/chat/completions", hoiAnh());
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("IMAGE_KHONG_HO_TRO");
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });
});

describe("§3 — kiểm ảnh TRƯỚC khi gọi engine", () => {
  const ma = async (than: unknown) => {
    const r = await post("/chat/completions", than as Record<string, unknown>);
    return { status: r.status, code: (await r.json()).error?.code };
  };
  it("http URL / byte không phải ảnh ⇒ 400 ANH_SAI_DINH_DANG", async () => {
    expect(await ma(hoiAnh({}, anh("https://169.254.169.254/a.png")))).toEqual({ status: 400, code: "ANH_SAI_DINH_DANG" });
    expect(await ma(hoiAnh({}, anh(`data:image/png;base64,${Buffer.from("not an image").toString("base64")}`)))).toEqual({ status: 400, code: "ANH_SAI_DINH_DANG" });
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });
  it("ảnh trên vai assistant ⇒ 400 ANH_SAI_DINH_DANG", async () => {
    expect(await ma({ messages: [{ role: "assistant", content: [anh()] }, { role: "user", content: "x" }] })).toEqual({ status: 400, code: "ANH_SAI_DINH_DANG" });
  });
  it("5 ảnh (đếm cả lịch sử) ⇒ 400 QUA_NHIEU_ANH", async () => {
    const than = { messages: [{ role: "user", content: [anh(), anh(), anh()] }, { role: "assistant", content: "ok" }, { role: "user", content: [anh(), anh()] }] };
    expect(await ma(than)).toEqual({ status: 400, code: "QUA_NHIEU_ANH" });
  });
  it("ảnh vượt 6 MB ⇒ 413 ANH_QUA_LON", async () => {
    const lon = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024 + 10)]);
    expect(await ma(hoiAnh({}, anh(`data:image/png;base64,${lon.toString("base64")}`)))).toEqual({ status: 413, code: "ANH_QUA_LON" });
  });
  it("ảnh + phần lạ (input_audio) ⇒ 400 NOI_DUNG_KHONG_HO_TRO", async () => {
    expect(await ma(hoiAnh({}, anh(), { type: "input_audio", input_audio: {} }))).toEqual({ status: 400, code: "NOI_DUNG_KHONG_HO_TRO" });
  });
});

describe("§4 — engine rơi khỏi llama-server khi có ảnh ⇒ 400 có mã (không 500 trơn)", () => {
  it("LoiAnhKhongHoTro (so theo tên) ⇒ 400 IMAGE_KHONG_HO_TRO", async () => {
    const e = new Error("[gguf] ảnh đính kèm chỉ đọc được trên llama-server nạp --mmproj: x");
    e.name = "LoiAnhKhongHoTro";
    (e as any).code = "IMAGE_KHONG_HO_TRO";
    h.loiEngine = e;
    const r = await post("/chat/completions", hoiAnh());
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("IMAGE_KHONG_HO_TRO");
  });
});
