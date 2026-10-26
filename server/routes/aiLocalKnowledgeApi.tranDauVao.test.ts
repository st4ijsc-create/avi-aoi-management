/**
 * Trần đầu vào ở cửa vào KB (kiem-dinh 2026-10-26, `services/ai/tranDauVao.ts`): `/api/ai/local-kb/{retrieve,ask,stream}` từ chối 413 `DAU_VAO_QUA_DAI`
 * khi `question` hoặc một `history[].content` vượt trần — TRƯỚC khi che / embed / gọi model. Đột biến: bỏ `tuChoiQuaDaiKb` ở một tuyến ⇒ ca của tuyến đó đỏ.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({ dem: { retrieve: 0, ask: 0, stream: 0 } }));

vi.mock("../services/aiLocalKnowledgeService", async (goc) => {
  const that = await goc<typeof import("../services/aiLocalKnowledgeService")>();
  return {
    ...that,
    retrieveKnowledge: async () => (h.dem.retrieve++, { chunks: [] }),
    answerQuestion: async () => (h.dem.ask++, { answer: "ok" }),
    streamAnswer: async function* () {
      h.dem.stream++;
    },
  };
});
vi.mock("./_xacThucRest", async (goc) => {
  const that = await goc<typeof import("./_xacThucRest")>();
  return { ...that, thuXacThucRest: async () => ({ ok: true, user: { id: 7, role: "admin", name: "T" } }) };
});

import { registerAiLocalKnowledgeRoutes } from "./aiLocalKnowledgeApi";

let may: { url: string; server: Server };
beforeAll(async () => {
  process.env.AI_KB_TRAN_KY_TU = "5000";
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  registerAiLocalKnowledgeRoutes(app);
  const server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  may = { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
});
afterAll(async () => {
  delete process.env.AI_KB_TRAN_KY_TU;
  await new Promise<void>((r) => may.server.close(() => r()));
});

const goi = async (duong: string, than: unknown) => {
  const r = await fetch(`${may.url}/api/ai/local-kb/${duong}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(than) });
  return { status: r.status, json: await r.json().catch(() => null) as any };
};

describe("trần đầu vào KB", () => {
  for (const duong of ["retrieve", "ask", "stream"] as const) {
    it(`${duong}: question vượt trần ⇒ 413 DAU_VAO_QUA_DAI, dịch vụ KHÔNG được gọi`, async () => {
      const truoc = { ...h.dem };
      const r = await goi(duong, { question: "x".repeat(5001) });
      expect(r.status).toBe(413);
      expect(r.json).toMatchObject({ success: false, ma: "DAU_VAO_QUA_DAI", noi: "question", tran: 5000 });
      expect(h.dem).toEqual(truoc);
    });
  }
  for (const duong of ["ask", "stream"] as const) {
    it(`${duong}: một message lịch sử vượt trần ⇒ 413 (noi=history[i])`, async () => {
      const truoc = { ...h.dem };
      const r = await goi(duong, { question: "hi", history: [{ role: "user", content: "a" }, { role: "assistant", content: "y".repeat(5001) }] });
      expect(r.status).toBe(413);
      expect(r.json).toMatchObject({ ma: "DAU_VAO_QUA_DAI", noi: "history[1]" });
      expect(h.dem).toEqual(truoc);
    });
  }
  it("đối chứng: question đúng trần không bị 413", async () => {
    const r = await goi("retrieve", { question: "x".repeat(5000) });
    expect(r.status).not.toBe(413);
  });
});
