/**
 * Trần đầu vào của /v1 (kiem-dinh 2026-10-26): tổng ký tự chữ của `messages` vượt `OPENAI_GATEWAY_MAX_CHARS` ⇒ 413 `context_length_exceeded`,
 * engine KHÔNG được gọi (không che, không lập kế hoạch, không tốn model). Đột biến: bỏ `kiemTranV1` ⇒ ca 413 đỏ.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ chat: 0 }));
vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(async () => (h.chat++, { text: "ok", tokensPrompt: 1, tokensGenerated: 1, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 })),
  generateText: vi.fn(),
  generateFim: vi.fn(),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  chatCompletionStream: vi.fn(),
  generateTextStream: async function* () {},
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { createOpenAiGatewayRouter } from "./openaiGateway";

const KEY = "TRAN-DAU-VAO-KEY";
let may: { url: string; server: Server };
beforeAll(async () => {
  process.env.OPENAI_GATEWAY_MAX_CHARS = "5000";
  const app = express();
  app.use("/v1", createOpenAiGatewayRouter({ apiKey: KEY }));
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  delete process.env.OPENAI_GATEWAY_MAX_CHARS;
  await new Promise<void>((r) => may.server.close(() => r()));
});

const goi = async (messages: unknown[]) => {
  const r = await fetch(`${may.url}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: "chat", messages }) });
  return { status: r.status, json: await r.json().catch(() => null) as any };
};

describe("/v1/chat/completions — trần tổng ký tự", () => {
  it("tổng vượt trần (nhiều message) ⇒ 413 context_length_exceeded, engine không được gọi", async () => {
    const truoc = h.chat;
    const r = await goi([{ role: "user", content: "x".repeat(3000) }, { role: "assistant", content: "y".repeat(2001) }]);
    expect(r.status).toBe(413);
    expect(r.json?.error?.code).toBe("context_length_exceeded");
    expect(h.chat).toBe(truoc);
  });
  it("phần text trong mảng content cũng được tính", async () => {
    const r = await goi([{ role: "user", content: [{ type: "text", text: "z".repeat(5001) }] }]);
    expect(r.status).toBe(413);
  });
  it("đối chứng: đúng trần không bị 413", async () => {
    const r = await goi([{ role: "user", content: "x".repeat(5000) }]);
    expect(r.status).not.toBe(413);
  });
});
