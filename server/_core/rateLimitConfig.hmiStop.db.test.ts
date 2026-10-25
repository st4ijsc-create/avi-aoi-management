/**
 * ★★★ R1b-2a Task 3 (kiem-dinh limiter) — a REVOKED-but-unexpired ticket is no longer an unlimited STOP pass.
 *
 * Before: `apiLimiter` skipped a signed non-batched `scadaCommands.dungMay` absolutely (stateless check) ⇒ a ticket whose `user_sessions`
 * row is `isActive = false` still had UNLIMITED STOPs, each one going through createContext (pool pressure). Now the STOP tier
 * (`createHmiStopLimiter`, 600 / min per session of a person — fix round 1 c1) caps it in its OWN bucket, the person's current session
 * keeps its own 600 / min, and createContext still refuses the revoked ticket.
 * No DB lookup on the limiter path: the row only proves the ticket really is revoked (createContext ⇒ user null) — the limiter never reads it.
 *
 * Also the N-2 regression guard: the REAL authentication path (createContext → sdk.authenticateRequest → verifySession, default options)
 * still logs exactly one "[Auth] Session verification failed" line for a junk cookie — only the limiter path is quiet.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
vi.hoisted(() => {
  process.env.JWT_SECRET ||= "rate-limit-hmistop-db-test-secret-r1b2a-t3";
  process.env.VITE_APP_ID ||= "avi-aoi-management";
  process.env.AUTH_CACHE_TTL_S = "0"; // no auth cache: the ledger answers every time
  process.env.RATE_LIMIT_PER_MINUTE = "5";
  delete process.env.REDIS_URL;
});

import { COOKIE_NAME } from "@shared/const";
import { sdk } from "./sdk";
import { createContext } from "./context";
import { taoNguoiDungTest } from "../testing/nguoiDungTest";
import { createApiLimiter, createHmiStopLimiter, TRAN_STOP_HMI_MOI_PHUT } from "./rateLimitConfig";

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
const TAG = `HMISTOP-${Date.now()}`;
const STOP = "/api/trpc/scadaCommands.dungMay";

describe.skipIf(!onTest)("STOP tier × revoked ticket (_test)", () => {
  let sql: ReturnType<typeof postgres>;
  let server: http.Server;
  let base = "";
  const nguoi = { id: 0, openId: "" };

  beforeAll(async () => {
    sql = postgres(DB_URL, { max: 2, onnotice: () => {} });
    const u = await taoNguoiDungTest("hs", "operator", { tienTo: "r1b2at3", ten: "r1b2a t3 hmistop", ts: TAG });
    nguoi.id = u.id;
    nguoi.openId = u.openId;
    const app = express();
    app.use("/api/", createHmiStopLimiter());
    app.use("/api/", createApiLimiter());
    app.post("/api/trpc/*", (_req, res) => void res.status(200).json({ ok: true }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await sql`DELETE FROM user_sessions WHERE "userId" = ${nguoi.id}`;
    await sql.end({ timeout: 2 });
  });

  async function veMoi(): Promise<string> {
    const t = await sdk.signSession({ openId: nguoi.openId, appId: "r1b2a-t3", name: "r1b2a t3" }, { expiresInMs: 3_600_000 });
    await sql`INSERT INTO user_sessions ("userId", "sessionToken", "expiresAt", "isActive") VALUES (${nguoi.id}, ${t}, now() + interval '1 hour', true)`;
    return t;
  }
  const ctxCua = (cookie: string) => createContext({ req: { headers: { cookie } } as never, res: {} as never });

  it("★★★ revoked ticket (row isActive=false, signature + expiry still valid): createContext refuses it, and the limiter caps it at 600 / min — the 601st is 429", async () => {
    const t = await veMoi();
    const cookie = `${COOKIE_NAME}=${encodeURIComponent(t)}`;
    // positive control: the same ticket authenticates while its row is active
    expect((await ctxCua(cookie)).user?.openId).toBe(nguoi.openId);
    await sql`UPDATE user_sessions SET "isActive" = false WHERE "sessionToken" = ${t}`;
    expect((await ctxCua(cookie)).user, "the ticket must really be revoked for this test to mean anything").toBeNull();

    const status: number[] = [];
    for (let i = 0; i < TRAN_STOP_HMI_MOI_PHUT; i += 50) {
      const lo = await Promise.all(
        Array.from({ length: Math.min(50, TRAN_STOP_HMI_MOI_PHUT - i) }, () =>
          fetch(`${base}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }).then((r) => r.status),
        ),
      );
      status.push(...lo);
    }
    expect(status.filter((s) => s === 429)).toHaveLength(0);
    const r601 = await fetch(`${base}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
    expect(r601.status, "a revoked ticket must not have unlimited STOPs any more").toBe(429);
    expect(await r601.json()).toEqual({ error: "Too many STOP requests — use the hard E-STOP" });

    // fix round 1 c1 — the revoked ticket exhausted ONLY its own bucket: the same person's current (active) session still stops
    const moi = `${COOKIE_NAME}=${encodeURIComponent(await veMoi())}`;
    expect((await ctxCua(moi)).user?.openId).toBe(nguoi.openId);
    const rMoi = await fetch(`${base}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie: moi }, body: "{}" });
    expect(rMoi.status, "a revoked / stolen ticket must not block the real user's current session").toBe(200);
  });

  it("N-2 regression: createContext with a junk cookie still logs exactly ONE '[Auth] Session verification failed' line (the real auth path is not silenced)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx = await ctxCua(`${COOKIE_NAME}=rac-r1b2a-t3`);
      expect(ctx.user).toBeNull();
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("Session verification failed"))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});
