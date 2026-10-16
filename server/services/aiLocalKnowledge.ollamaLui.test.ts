/**
 * ★ 2026-10-14 · Đợt 0.5 — ĐIỂM NỐI của cổng `ai/ollamaLui` trong `aiLocalKnowledgeService`:
 * GGUF vắng ⇒ `embedQuestion` lùi sang Ollama. Model nhúng KHÔNG có trong `/api/tags` ⇒ KHÔNG được
 * POST `/api/embed` (trước đây: POST chắc chắn 404, im lặng). Có model ⇒ vẫn lùi như cũ.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

delete process.env.USE_LEGACY_OLLAMA;
process.env.OLLAMA_EMBED_MODEL = "mxbai-embed-large";

vi.mock("./aiLocalTools", () => ({
  tryExecuteTool: vi.fn(async () => ({ result: null, decision: { tool: null, args: {}, reason: "EMPTY" } })),
}));
vi.mock("./aiGgufEngine", () => ({
  generateEmbedding: vi.fn(),
  isGgufAvailable: vi.fn(async () => false), // GGUF vắng ⇒ đi đường lùi
}));

import { embedQuestion } from "./aiLocalKnowledgeService";
import { __datLaiOllamaLuiChoTest } from "./ai/ollamaLui";

let goi: Array<{ url: string; method: string }> = [];
let tags: string[] = [];

beforeEach(() => {
  __datLaiOllamaLuiChoTest();
  goi = [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    goi.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).endsWith("/api/tags")) {
      return { ok: true, json: async () => ({ models: tags.map((name) => ({ name })) }) } as Response;
    }
    return { ok: true, json: async () => ({ embeddings: [[3, 4]] }) } as Response;
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("embedQuestion — lùi Ollama có cổng /api/tags", () => {
  it("★★★ model nhúng KHÔNG có ⇒ null, KHÔNG POST /api/embed", async () => {
    tags = ["qwen3:4b"];
    const v = await embedQuestion("câu hỏi lùi không model " + Math.random());
    expect(v).toBeNull();
    expect(goi.some((g) => g.url.endsWith("/api/embed")), JSON.stringify(goi)).toBe(false);
    expect(goi.some((g) => g.url.endsWith("/api/tags"))).toBe(true);
  });

  it("★★ model nhúng CÓ ⇒ vẫn lùi như cũ (POST /api/embed, vector chuẩn hoá L2)", async () => {
    tags = ["mxbai-embed-large:latest"];
    const v = await embedQuestion("câu hỏi lùi có model " + Math.random());
    expect(goi.some((g) => g.url.endsWith("/api/embed"))).toBe(true);
    expect(v).toEqual([0.6, 0.8]);
  });
});
