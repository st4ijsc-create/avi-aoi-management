/**
 * SCADA R1b-1 Task 2 fix round 1 (important 1) — ★★★ CENSUS: the general `/api` limiter NEVER counts a non-batched HMI STOP
 * (`POST /api/trpc/scadaCommands.dungMay`), and STILL counts a batched request carrying it (alone or with any other call).
 *
 * App built in the order of `_core/index.ts` (`app.use('/api/', apiLimiter)` before the routes), ceiling lowered to 5. Each scenario
 * uses its own credential header (= its own bucket, `apiKeyGenerator`). Oracle: HTTP status codes of a real express app + the real
 * limiter — the classifier is ALSO pinned directly. Plus the client half: the app's real tRPC links send `dungMay` alone, unbatched.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";

process.env.RATE_LIMIT_PER_MINUTE = "5";
delete process.env.REDIS_URL;

const rl = await import("./rateLimitConfig");
const { createAppTrpcLinks, isStopOnlyOp } = await import("../../client/src/lib/trpcLinks");

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api/", rl.createApiLimiter());
  const ok = (_req: express.Request, res: express.Response) => void res.status(200).json({ ok: true });
  app.post("/api/trpc/*", ok);
  app.get("/api/trpc/*", ok);
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const key = () => `hmistop-${Math.random().toString(36).slice(2)}`;
const post = (path: string, k: string) => fetch(`${base}${path}`, { method: "POST", headers: { "x-api-key": k, "content-type": "application/json" }, body: "{}" }).then((r) => r.status);
const get = (path: string, k: string) => fetch(`${base}${path}`, { headers: { "x-api-key": k } }).then((r) => r.status);

describe("★★★ apiLimiter × HMI STOP (real express + real limiter, ceiling 5)", () => {
  it("★ 12 non-batched `POST /api/trpc/scadaCommands.dungMay` ⇒ all 200; the bucket is untouched (5 more ordinary calls pass, the 6th is 429)", async () => {
    const k = key();
    for (let i = 0; i < 12; i++) expect(await post("/api/trpc/scadaCommands.dungMay", k), `dungMay #${i + 1}`).toBe(200);
    for (let i = 0; i < 5; i++) expect(await get("/api/trpc/scadaKenh.cheDo.danhSach", k)).toBe(200);
    expect(await get("/api/trpc/scadaKenh.cheDo.danhSach", k)).toBe(429);
    // …and the STOP still goes through once the ordinary bucket is empty
    expect(await post("/api/trpc/scadaCommands.dungMay", k)).toBe(200);
  });

  it("★ a BATCHED request carrying dungMay + another call is counted (429 after 5)", async () => {
    const k = key();
    const p = `/api/trpc/${encodeURIComponent("scadaCommands.dungMay,scadaKenh.cheDo.danhSach")}?batch=1`;
    for (let i = 0; i < 5; i++) expect(await post(p, k)).toBe(200);
    expect(await post(p, k)).toBe(429);
  });

  it("a batch of ONE (`?batch=1`) and a GET are counted too — only the exact non-batched POST is exempt", async () => {
    const k = key();
    for (let i = 0; i < 5; i++) expect(await post("/api/trpc/scadaCommands.dungMay?batch=1", k)).toBe(200);
    expect(await post("/api/trpc/scadaCommands.dungMay?batch=1", k)).toBe(429);
    const k2 = key();
    for (let i = 0; i < 5; i++) expect(await get("/api/trpc/scadaCommands.dungMay", k2)).toBe(200);
    expect(await get("/api/trpc/scadaCommands.dungMay", k2)).toBe(429);
  });
});

describe("classifier `isHmiStopRequest` (exact, narrow)", () => {
  const r = (method: string, url: string, query: Record<string, unknown> = {}) => ({ method, originalUrl: url, url, query, headers: {} }) as never;
  it("only a non-batched POST of exactly scadaCommands.dungMay", () => {
    expect(rl.isHmiStopRequest(r("POST", "/api/trpc/scadaCommands.dungMay"))).toBe(true);
    expect(rl.isHmiStopRequest(r("POST", "/API/TRPC/scadaCommands.dungMay"))).toBe(true); // Express routes the prefix case-insensitively
    expect(rl.isHmiStopRequest(r("GET", "/api/trpc/scadaCommands.dungMay"))).toBe(false);
    expect(rl.isHmiStopRequest(r("POST", "/api/trpc/scadaCommands.dungMay?batch=1", { batch: "1" }))).toBe(false);
    expect(rl.isHmiStopRequest(r("POST", "/api/trpc/scadaCommands.dungMay?batch=1"))).toBe(false); // raw query alone also counts
    expect(rl.isHmiStopRequest(r("POST", "/api/trpc/scadaCommands.dungMay,scadaCommands.confirm"))).toBe(false);
    expect(rl.isHmiStopRequest(r("POST", "/api/trpc/scadacommands.dungmay"))).toBe(false); // tRPC resolves names case-sensitively
    expect(rl.isHmiStopRequest(r("POST", "/api/trpc/scadaCommands.confirm"))).toBe(false);
    expect(rl.isHmiStopRequest(r("POST", "/trpc/scadaCommands.dungMay"))).toBe(false);
    expect([...rl.API_LIMITER_EXEMPT_TRPC]).toEqual(["scadaCommands.dungMay"]);
  });
});

describe("client half — the app's real tRPC links send dungMay ALONE, unbatched", () => {
  it("★ dungMay + other calls in the same tick ⇒ dungMay's request is `/api/trpc/scadaCommands.dungMay` with no batch param", async () => {
    expect(isStopOnlyOp({ path: "scadaCommands.dungMay" })).toBe(true);
    const urls: string[] = [];
    const fakeFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      const u = new URL(url, "http://x");
      const one = { result: { data: superjson.serialize({ ok: true }) } };
      const n = decodeURIComponent(u.pathname.replace(/^\/api\/trpc\//, "")).split(",").length;
      const body = u.searchParams.get("batch") === "1" ? Array.from({ length: n }, () => one) : one;
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c = createTRPCClient<any>({ links: createAppTrpcLinks({ url: "http://x/api/trpc", fetch: fakeFetch as typeof fetch }) as any }) as any;
    await Promise.all([
      c.scadaCommands.dungMay.mutate({ machineId: 1, clientRequestId: "11111111-2222-4333-8444-555555555555" }),
      c.scadaCommands.huy.mutate({ requestId: "11111111-2222-4333-8444-555555555555" }),
      c.user.updateProfile.mutate({ name: "x" }),
    ]);
    const stop = urls.filter((u) => u.includes("scadaCommands.dungMay"));
    expect(stop).toHaveLength(1);
    const u = new URL(stop[0], "http://x");
    expect(decodeURIComponent(u.pathname)).toBe("/api/trpc/scadaCommands.dungMay");
    expect(u.searchParams.get("batch")).toBeNull();
    expect(urls).toHaveLength(2); // the two other mutations still batch together
  });
});
