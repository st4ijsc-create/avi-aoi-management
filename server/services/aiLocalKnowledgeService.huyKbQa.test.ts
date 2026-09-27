/**
 * Doc 80 Đợt 1 final wave (item 2) — nhánh VẬN HÀNH của `/api/ai/local-kb/stream` phải chuyền signal huỷ
 * xuống `ggufStream` (đối số THỨ BA).
 *
 * Trước final wave, `generateWithOllamaStream` gọi `ggufStream(options, modelId)` — HAI đối số — nên dù
 * tuyến có huỷ đúng, lượt KB-QA trên llama-server vẫn chạy tới hết (chỉ nhánh lập trình
 * `streamCodingModel` truyền signal). Bình luận ở tuyến khai *"signal đi xuống tận ggufStream"* là SAI
 * cho nhánh này. Lưới:
 *   §A — `generateWithOllamaStream(…, signal)` ⇒ `generateTextStream` THẬT SỰ nhận đúng `signal` ấy;
 *   §B — cả HAI chỗ gọi trong `streamAnswer` truyền `execCtx?.signal` (đọc nguồn — pipeline đầy đủ cần
 *        DB/RAG nên không dựng ở đây; đây là lời khai về DÂY, không phải về hành vi đầu-cuối, và phần
 *        đầu-cuối của TUYẾN đo ở `routes/aiStreamCancel.dot1FinalWave.test.ts`).
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const h = vi.hoisted(() => ({ goi: [] as Array<{ modelId: unknown; signal: unknown }> }));

vi.mock("./aiGgufEngine", async (goc) => {
  const that = await goc<typeof import("./aiGgufEngine")>();
  return {
    ...that,
    isGgufAvailable: vi.fn(async () => true),
    generateTextStream: async function* (_o: unknown, modelId?: string, signal?: AbortSignal) {
      h.goi.push({ modelId, signal });
      yield { type: "token", token: "ok" };
      yield { type: "done", fullText: "ok", tokensPrompt: 1, tokensGenerated: 1 };
    },
  };
});
vi.mock("./aiGateway", async (goc) => {
  const that = await goc<typeof import("./aiGateway")>();
  return {
    ...that,
    planInference: vi.fn(async (o: { text?: string }) => ({
      decision: { modelId: "m" },
      abVariant: null,
      record: vi.fn(),
      safeText: o?.text ?? "",
      safetyFlags: { injectionRisk: "none", redactions: 0 },
      sanitizeOutput: (t: string) => t,
    })),
  };
});
vi.mock("../db/connection", () => ({ getDb: async () => undefined }));

import { generateWithOllamaStream, type KbRetrieveResult } from "./aiLocalKnowledgeService";

const RETRIEVE = {
  question: "how do I acknowledge an alert?",
  intent: "howto",
  language: "en",
  entities: [],
  confidence: 0.4,
  citations: [],
  contexts: [],
  rerankMs: null,
} as unknown as KbRetrieveResult;

describe("§A — generateWithOllamaStream chuyền signal xuống ggufStream", () => {
  it("signal của người gọi là ĐÚNG đối tượng tới đối số thứ ba của generateTextStream", async () => {
    h.goi = [];
    const boHuy = new AbortController();
    let chu = "";
    for await (const p of generateWithOllamaStream(RETRIEVE.question, RETRIEVE, [], "technical", null, 1, undefined, boHuy.signal)) chu += p;
    expect(chu).toContain("ok");
    expect(h.goi).toHaveLength(1);
    expect(h.goi[0].signal, "generateTextStream không nhận signal — huỷ của tuyến dừng ở tầng Node").toBe(boHuy.signal);
  });

  it("vắng signal ⇒ đối số thứ ba là undefined (hành vi cũ y nguyên cho người gọi không truyền)", async () => {
    h.goi = [];
    for await (const _ of generateWithOllamaStream(RETRIEVE.question, RETRIEVE, [], "technical")) { /* drain */ }
    expect(h.goi).toHaveLength(1);
    expect(h.goi[0].signal).toBeUndefined();
  });
});

describe("§B — cả hai chỗ gọi trong streamAnswer truyền execCtx?.signal (đọc nguồn)", () => {
  it("mọi lời gọi `generateWithOllamaStream(` (không phải định nghĩa) đều mang `execCtx?.signal`", () => {
    const src = readFileSync(resolve(__dirname, "aiLocalKnowledgeService.ts"), "utf8");
    const loiGoi: string[] = [];
    const re = /generateWithOllamaStream\(/g;
    for (const m of src.matchAll(re)) {
      const truoc = src.slice(Math.max(0, m.index! - 40), m.index);
      if (/function\*?\s*$/.test(truoc)) continue; // định nghĩa
      // Lấy tới dấu đóng ngoặc cân bằng đầu tiên.
      let sau = 1;
      let i = m.index! + m[0].length;
      for (; i < src.length && sau > 0; i++) {
        if (src[i] === "(") sau++;
        else if (src[i] === ")") sau--;
      }
      loiGoi.push(src.slice(m.index!, i));
    }
    expect(loiGoi.length, "phải thấy đúng hai chỗ gọi trong streamAnswer").toBe(2);
    for (const g of loiGoi) expect(g, `lời gọi thiếu signal:\n${g}`).toMatch(/execCtx\?\.signal/);
  });
});
