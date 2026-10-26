/**
 * ★ Đợt 10.1 A2 — `/v1` nhận MÃ DANH MỤC (`vai-tro:` / `ho-so:` / `ngoai:`) qua hợp đồng chung `giaiChonModel`; tên tệp
 * GGUF trần ⇒ 400 nêu dạng hợp lệ; tên logic cũ giữ nguyên đường.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ modelEngine: [] as unknown[] }));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(),
  chatCompletionStream: async function* () {},
  generateText: vi.fn(),
  generateFim: vi.fn(async (_o: unknown, modelId?: string) => {
    h.modelEngine.push(modelId);
    return { text: "x", tokensPrompt: 1, tokensGenerated: 1 };
  }),
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  generateTextStream: async function* () {},
}));

vi.mock("../services/ai/chonModel/danhMuc", async (importOriginal) => {
  const goc = await importOriginal<typeof import("../services/ai/chonModel/danhMuc")>();
  const { NGOAI_RONG } = await import("../services/ai/chonModel/kieu");
  return {
    ...goc,
    layPhuThuocDanhMucMacDinh: async () => ({
      anh: {
        taiLuc: 1,
        vaiTro: new Map(),
        profile: new Map([["p4b", { artifactFile: "Model-Nho-Thu.gguf", slotClass: "nho", artifactStatus: "available", license: "mit", enabled: true }]]),
        gan: [],
      },
      hoSoCoDo: new Set(["p4b"]),
      kheDangGiu: null,
      uocTinhDoiKheGiay: async () => null,
      ngoai: NGOAI_RONG,
    }),
  };
});

import { registerOpenAiGateway } from "./openaiGateway";

const API_KEY = "SECRET-TEST-KEY-CHON";
const ENV = ["OPENAI_GATEWAY_ENABLED", "OPENAI_GATEWAY_API_KEY", "GGUF_CODE_MODEL", "GGUF_DEFAULT_MODEL"] as const;
const cu: Record<string, string | undefined> = {};
let sv: { url: string; server: Server };

beforeAll(async () => {
  for (const k of ENV) cu[k] = process.env[k];
  process.env.OPENAI_GATEWAY_ENABLED = "true";
  process.env.OPENAI_GATEWAY_API_KEY = API_KEY;
  process.env.GGUF_CODE_MODEL = "Model-Code-Thu.gguf";
  process.env.GGUF_DEFAULT_MODEL = "Model-Mac-Dinh.gguf";
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

const goi = (model: string) =>
  fetch(`${sv.url}/v1/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: "function cong(a, b) {", max_tokens: 8 }),
  });

describe("/v1 — chonModel qua model", () => {
  it("vai-tro:code.plc ⇒ engine nhận model của định tuyến vai trò (GGUF_CODE_MODEL)", async () => {
    h.modelEngine = [];
    const r = await goi("vai-tro:code.plc");
    expect(r.status).toBe(200);
    expect((await r.json()).model).toBe("code.plc");
    expect(h.modelEngine).toEqual(["Model-Code-Thu"]);
  });

  it("ho-so:p4b ⇒ đúng tệp của hồ sơ", async () => {
    h.modelEngine = [];
    const r = await goi("ho-so:p4b");
    expect(r.status).toBe(200);
    expect(h.modelEngine).toEqual(["Model-Nho-Thu"]);
  });

  it("tên tệp GGUF trần ⇒ 400 model_not_found, lời lỗi nêu dạng hợp lệ", async () => {
    h.modelEngine = [];
    const r = await goi("Model-Code-Thu.gguf");
    expect(r.status).toBe(400);
    const j = await r.json();
    expect(j.error.code).toBe("model_not_found");
    expect(j.error.message).toMatch(/vai-tro:.*ho-so:/);
    expect(h.modelEngine).toEqual([]);
  });

  it("vai-tro:embed (không sinh chữ) ⇒ 400; ho-so lạ ⇒ 400; ngoai: ⇒ 404 — engine không được gọi", async () => {
    h.modelEngine = [];
    expect((await goi("vai-tro:embed")).status).toBe(400);
    expect((await goi("ho-so:khong-co")).status).toBe(400);
    const r = await goi("ngoai:anthropic:claude-x");
    expect(r.status).toBe(404);
    expect((await r.json()).error.code).toBe("model_not_found");
    expect(h.modelEngine).toEqual([]);
  });

  it("tên logic cũ `code` giữ đường cũ", async () => {
    h.modelEngine = [];
    expect((await goi("code")).status).toBe(200);
    expect(h.modelEngine).toEqual(["Model-Code-Thu"]);
  });
});
