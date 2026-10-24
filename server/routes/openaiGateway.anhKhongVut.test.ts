/**
 * ★ Đợt 9 (2026-10-24, dieu-phoi) — `/v1/chat/completions` KHÔNG vứt ảnh IM LẶNG. Trước đây `contentToString` biến phần
 * `image_url` thành "" ⇒ model trả lời như không có ảnh. Nay: phần không phải chữ ⇒ 400 có mã, engine KHÔNG được gọi.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  streamOpts: [] as any[],
  done: { type: "done", tokensPrompt: 11, tokensGenerated: 7, tokensReasoning: 4 } as Record<string, unknown>,
}));

const chatCompletionMock = vi.fn(async (_opts: any) => ({
  text: "ok",
  tokensPrompt: 3,
  tokensGenerated: 2,
  modelId: "x",
  totalTimeMs: 1,
  tokensPerSecond: 1,
}));
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
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { createOpenAiGatewayRouter } from "./openaiGateway";

const KEY = "ANH-KHONG-VUT-KEY";
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
  h.done = { type: "done", tokensPrompt: 11, tokensGenerated: 7, tokensReasoning: 4 };
});

const post = (duong: string, than: Record<string, unknown>) =>
  fetch(`${may.url}/v1${duong}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(than),
  });
const MSG = [{ role: "user", content: "hi" }];


const ANH = { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } };

describe("/v1 — phần nội dung không phải chữ ⇒ 400 có mã, không bỏ qua", () => {
  it("image_url (non-stream) ⇒ 400 IMAGE_KHONG_HO_TRO, engine không được gọi", async () => {
    const r = await post("/chat/completions", { messages: [{ role: "user", content: [{ type: "text", text: "xem ảnh" }, ANH] }] });
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error.code).toBe("IMAGE_KHONG_HO_TRO");
    expect(j.error.message).toContain("messages[0]");
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });
  it("image_url ở message CŨ + stream ⇒ vẫn 400 (không mở SSE), chatCompletionStream không được gọi", async () => {
    const r = await post("/chat/completions", {
      stream: true,
      messages: [{ role: "user", content: [ANH] }, { role: "assistant", content: "ok" }, { role: "user", content: "tiếp" }],
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("IMAGE_KHONG_HO_TRO");
    expect(h.streamOpts).toHaveLength(0);
  });
  it("input_image / image cũng là ảnh; kiểu lạ khác (input_audio) ⇒ NOI_DUNG_KHONG_HO_TRO", async () => {
    for (const p of [{ type: "input_image", image_url: "data:x" }, { type: "image" }]) {
      const r = await post("/chat/completions", { messages: [{ role: "user", content: [p] }] });
      expect((await r.json()).error.code).toBe("IMAGE_KHONG_HO_TRO");
    }
    const r = await post("/chat/completions", { messages: [{ role: "user", content: [{ type: "input_audio", input_audio: {} }] }] });
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("NOI_DUNG_KHONG_HO_TRO");
    expect(chatCompletionMock).not.toHaveBeenCalled();
  });
  it("mảng CHỈ có phần text và content chuỗi ⇒ 200 như cũ, chữ được nối", async () => {
    const r = await post("/chat/completions", { messages: [{ role: "user", content: [{ type: "text", text: "xin " }, { type: "text", text: "chào" }] }] });
    expect(r.status).toBe(200);
    expect(JSON.stringify(chatCompletionMock.mock.calls[0][0].messages)).toContain("xin chào");
    const r2 = await post("/chat/completions", { messages: MSG });
    expect(r2.status).toBe(200);
  });
});
