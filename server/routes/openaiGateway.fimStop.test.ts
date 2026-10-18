/**
 * ★★ Đợt 4C-server — `/v1/completions` chuyển `stop` của thân yêu cầu xuống `generateFim` (`GgufFimOptions.stopSequences`,
 * engine NỐI THÊM vào các sentinel FIM của nó — `aiGgufEngine.ts` `[...stopSequences, ...FIM_STOP]`).
 *
 * Hợp đồng (chuẩn OpenAI, có trần): `stop` là CHUỖI hoặc MẢNG ≤ 4 phần tử, mỗi phần là chuỗi KHÔNG RỖNG ≤ 64 ký tự.
 * Bất cứ hình dạng nào khác (quá 4 · quá dài · rỗng · không phải chuỗi · object/số) ⇒ BỎ CẢ Ô (không cắt xén, không đoán)
 * và opts gửi engine giữ ĐÚNG hình dạng cũ (không có khoá `stopSequences`). Ghost-text của extension (4C) gửi `stop` để
 * cắt ở ranh giới dòng/khối — trước bản này ô đó bị bỏ qua im lặng.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ fimOpts: [] as any[] }));

vi.mock("../services/aiGgufEngine", () => ({
  isGgufAvailable: vi.fn(async () => true),
  chatCompletion: vi.fn(),
  generateText: vi.fn(),
  generateFim: async (opts: any) => {
    h.fimOpts.push(opts);
    return { text: "return 1;", tokensPrompt: 5, tokensGenerated: 2, modelId: "x", totalTimeMs: 1, tokensPerSecond: 1 };
  },
  generateEmbedding: vi.fn(),
  generateEmbeddings: vi.fn(),
  chatCompletionStream: vi.fn(),
  generateTextStream: async function* () {},
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));

import { createOpenAiGatewayRouter } from "./openaiGateway";

const KEY = "FIM-STOP-KEY";
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
  h.fimOpts = [];
});

async function goi(than: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${may.url}/v1/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "function f() {\n  ", suffix: "\n}\n", max_tokens: 32, ...than }),
  });
  expect(r.status).toBe(200);
  await r.text();
  expect(h.fimOpts).toHaveLength(1);
  return h.fimOpts[0];
}

describe("/v1/completions — `stop` ⇒ generateFim.stopSequences", () => {
  it("★★★ chuỗi ⇒ mảng một phần tử (non-stream)", async () => {
    expect((await goi({ stop: "\n\n" })).stopSequences).toEqual(["\n\n"]);
  });

  it("★★★ mảng ≤ 4 chuỗi ⇒ giữ nguyên thứ tự (stream cũng vậy)", async () => {
    const opts = await goi({ stop: ["\n\n", "\nfunction ", "```", "}\n"], stream: true });
    expect(opts.stopSequences).toEqual(["\n\n", "\nfunction ", "```", "}\n"]);
  });

  it("★★ đúng 64 ký tự ⇒ nhận", async () => {
    const s = "x".repeat(64);
    expect((await goi({ stop: [s] })).stopSequences).toEqual([s]);
  });

  it("★★★ vắng `stop` ⇒ KHÔNG có khoá stopSequences (hình dạng opts cũ, bit-đối-bit)", async () => {
    expect(await goi({})).not.toHaveProperty("stopSequences");
  });

  it("★★★ hình dạng lạ ⇒ BỎ CẢ Ô (không cắt xén): >4 phần tử · >64 ký tự · rỗng · không phải chuỗi · object · số · null", async () => {
    const la: unknown[] = [
      ["a", "b", "c", "d", "e"],
      ["x".repeat(65)],
      "y".repeat(65),
      "",
      [""],
      ["a", 1],
      { a: "b" },
      42,
      null,
      [],
    ];
    for (const stop of la) {
      h.fimOpts = [];
      const opts = await goi({ stop });
      expect(opts, JSON.stringify(stop)).not.toHaveProperty("stopSequences");
    }
  });
});
