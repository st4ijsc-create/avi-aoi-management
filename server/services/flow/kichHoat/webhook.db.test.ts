/**
 * Đợt 8.1 Task 4b — webhook Luồng AI qua HTTP THẬT (express nhỏ trên cổng tạm, `fetch` toàn cục) trên CSDL `_test`:
 * token sai/thiếu ⇒ 401 · luồng tắt ⇒ 409 · đúng ⇒ 202 + runId, item = thân · idempotency-key lặp ⇒ cùng runId ·
 * > 256 KB ⇒ 413 · thân không phải đối tượng ⇒ 400 · node không phải webhook ⇒ 404 · xoay token ⇒ token cũ 401.
 */
import { vi, beforeAll } from "vitest";
import { donLuongTheoTienTo } from "../__donDuLieuTest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { aiFlowRuns, aiFlowWebhooks, aiFlows } from "../../../../drizzle/schema";
import { chayMotMuc, luuPhienBan } from "../dongCo";
import { registerFlowWebhookRoutes } from "../../../routes/flowWebhookApi";
import { bamToken, capTokenWebhook } from "./webhook";

const TT = "t8wh";
beforeAll(() => donLuongTheoTienTo(TT)); // Dọn dữ liệu SÓT của lượt trước bị ngắt (afterAll không chạy) — xem flow/__donDuLieuTest.ts
const FLOW = `${TT}-a`;
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

let server: Server;
let goc = "";
let token = "";

beforeAll(async () => {
  const app = express();
  registerFlowWebhookRoutes(app);
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, "127.0.0.1", () => ok(s));
  });
  goc = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const { version } = await luuPhienBan(
    {
      id: FLOW, name: "webhook", version: 1, settings: { maxConcurrentRuns: 100 }, // M5: nhiều lượt webhook chưa chạy xong
      nodes: [nut("wh", "kich-hoat.webhook"), nut("tay", "kich-hoat.thu-cong"), nut("d", "du-lieu.dat", { truong: { daNhan: "{{ $json.may }}" } })],
      connections: [noi("wh", "d"), noi("tay", "d")],
    },
    null,
  );
  const db = (await getDb())!;
  await db.update(aiFlows).set({ activeVersion: version }).where(eq(aiFlows.id, FLOW));
  token = (await capTokenWebhook(FLOW))!;
});

afterAll(async () => {
  await new Promise((ok) => server?.close(ok));
  const db = await getDb();
  if (!db) return;
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
});

const goi = (nodeId: string, than: unknown, h: Record<string, string> = {}) =>
  fetch(`${goc}/api/flow/webhook/${FLOW}/${nodeId}`, { method: "POST", headers: { "content-type": "application/json", ...h }, body: typeof than === "string" ? than : JSON.stringify(than) });

describe("webhook Luồng AI (Đợt 8.1, HTTP + DB)", () => {
  it("CSDL chỉ giữ BĂM; cấp lần hai không xoay ⇒ null", async () => {
    const [h] = await (await getDb())!.select().from(aiFlowWebhooks).where(eq(aiFlowWebhooks.flowId, FLOW));
    expect(h.tokenHash).toBe(bamToken(token));
    expect(h.tokenHash).not.toContain(token);
    expect(await capTokenWebhook(FLOW)).toBeNull();
  });

  it("thiếu / sai token ⇒ 401 (luồng không tồn tại cũng 401 — không lộ luồng nào có)", async () => {
    expect((await goi("wh", { may: "AOI-1" })).status).toBe(401);
    expect((await goi("wh", { may: "AOI-1" }, { "x-flow-token": token + "x" })).status).toBe(401);
    const r = await fetch(`${goc}/api/flow/webhook/${TT}-khong-co/wh`, { method: "POST", headers: { "content-type": "application/json", "x-flow-token": token }, body: "{}" });
    expect(r.status).toBe(401);
  });

  it("luồng TẮT ⇒ 409; bật ⇒ 202 + runId, item = thân, lượt chạy hết", async () => {
    expect((await goi("wh", { may: "AOI-1" }, { "x-flow-token": token })).status).toBe(409);
    await (await getDb())!.update(aiFlows).set({ enabled: true }).where(eq(aiFlows.id, FLOW));
    const r = await goi("wh", { may: "AOI-1" }, { "x-flow-token": token });
    expect(r.status).toBe(202);
    const { runId } = (await r.json()) as { runId: string };
    for (let i = 0; i < 50 && (await chayMotMuc("w", undefined, TT)); i++);
    const [run] = await (await getDb())!.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, runId));
    expect(run.status).toBe("xong");
    expect(run.triggerKind).toBe("webhook");
  });

  it("idempotency-key lặp ⇒ cùng runId, một lượt", async () => {
    const h = { "x-flow-token": token, "idempotency-key": "su-kien-42" };
    const a = (await (await goi("wh", { may: "AOI-2" }, h)).json()) as { runId: string; trung: boolean };
    const b = (await (await goi("wh", { may: "AOI-2" }, h)).json()) as { runId: string; trung: boolean };
    expect(b.runId).toBe(a.runId);
    expect([a.trung, b.trung]).toEqual([false, true]);
  });

  it("> 256 KB ⇒ 413 · mảng ⇒ 400 · JSON hỏng ⇒ 400 · node không phải webhook ⇒ 404", async () => {
    expect((await goi("wh", { x: "a".repeat(300 * 1024) }, { "x-flow-token": token })).status).toBe(413);
    expect((await goi("wh", [1, 2], { "x-flow-token": token })).status).toBe(400);
    expect((await goi("wh", "{hỏng", { "x-flow-token": token })).status).toBe(400);
    expect((await goi("tay", {}, { "x-flow-token": token })).status).toBe(404);
  });

  it("★ Đợt 9 (L3) token kiểm TRƯỚC khi đọc thân: token sai/thiếu + thân quá lớn hoặc JSON hỏng ⇒ 401 (không phải 413/400 — bộ đọc JSON chưa chạy); token đúng ⇒ 413/400 như cũ", async () => {
    for (const h of [{}, { "x-flow-token": "sai-token" }] as Record<string, string>[]) {
      expect((await goi("wh", { x: "a".repeat(300 * 1024) }, h)).status).toBe(401);
      expect((await goi("wh", "{hỏng", h)).status).toBe(401);
    }
    expect((await goi("wh", { x: "a".repeat(300 * 1024) }, { "x-flow-token": token })).status).toBe(413);
    expect((await goi("wh", "{hỏng", { "x-flow-token": token })).status).toBe(400);
  });

  it("xoay token ⇒ token cũ 401, token mới 202", async () => {
    const moi = (await capTokenWebhook(FLOW, true))!;
    expect(moi).not.toBe(token);
    expect((await goi("wh", {}, { "x-flow-token": token })).status).toBe(401);
    expect((await goi("wh", {}, { "x-flow-token": moi })).status).toBe(202);
    token = moi;
  });
});
