/**
 * ★ Đợt 9 (2026-10-23) — `/v1/completions` (stream + không stream) ghi vào `ai_gateway_metrics.model` model ENGINE thực nhận (định tuyến
 * vai trò / tên logic), không phải model của bộ định tuyến cổng. Trước 2c84fc593 hai nhánh này không truyền `model` ⇒ metrics ghi model
 * của cổng (env mặc định) — số "model" của /v1 ở Trung tâm Model sai mỗi khi định tuyến chọn khác.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ record: [] as Record<string, unknown>[], modelEngine: [] as unknown[] }));

vi.mock("../services/aiGateway", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/aiGateway")>();
  return {
    ...goc,
    planInference: async (...a: Parameters<typeof goc.planInference>) => {
      const p = await goc.planInference(...a);
      return { ...p, record: (o: Record<string, unknown>) => { h.record.push(o); p.record(o as never); } };
    },
  };
});
vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(),
  chatCompletionStream: async function* () {},
  generateText: vi.fn(),
  generateFim: vi.fn(async (_o: unknown, modelId?: string) => {
    h.modelEngine.push(modelId);
    return { text: "return a + b;", tokensPrompt: 7, tokensGenerated: 3 };
  }),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(async (t: string[]) => ({ embeddings: t.map(() => [0, 1]), dimensions: 2, modelId: "embed" })),
  generateTextStream: async function* () {},
}));

import { registerOpenAiGateway } from "./openaiGateway";

const API_KEY = "SECRET-TEST-KEY-CMPL";
const ENV = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "GGUF_CODE_MODEL", "GGUF_DEFAULT_MODEL"] as const;
const cu: Record<string, string | undefined> = {};
let sv: { url: string; server: Server };

beforeAll(async () => {
  for (const k of ENV) cu[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  // Model "code" CÓ TÊN và KHÁC model mặc định của cổng — hàng đo phải mang model engine nhận, không phải mặc định.
  process.env.GGUF_CODE_MODEL = "Model-Code-Thu.gguf";
  process.env.GGUF_DEFAULT_MODEL = "Model-Mac-Dinh-Cong.gguf";
  const app = express();
  registerOpenAiGateway(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  sv = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  await new Promise<void>((r) => sv.server.close(() => r()));
  for (const k of ENV) (cu[k] === undefined ? delete process.env[k] : (process.env[k] = cu[k]));
});

const goi = (stream: boolean) =>
  fetch(`${sv.url}/v1/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "code", prompt: "function cong(a, b) {", max_tokens: 16, stream }),
  });

describe("/v1/completions ghi model THỰC chạy vào metrics", () => {
  it.each([false, true])("stream=%s ⇒ hàng chính model = model engine nhận (Model-Code-Thu), không phải mặc định của cổng", async (stream) => {
    h.record = [];
    h.modelEngine = [];
    const res = await goi(stream);
    expect(res.status).toBe(200);
    await res.text();
    expect(h.modelEngine).toEqual(["Model-Code-Thu"]);
    const ok = h.record.filter((r) => r.outcome === "ok");
    expect(ok).toHaveLength(1);
    expect(ok[0]!.model).toBe("Model-Code-Thu");
  });
});
