/**
 * SCADA R1b-1 Task 2 fix round 1 (important 1) — ★★★ CENSUS: the general `/api` limiter NEVER counts a non-batched HMI STOP
 * (`POST /api/trpc/scadaCommands.dungMay`), and STILL counts a batched request carrying it (alone or with any other call).
 *
 * App built in the order of `_core/index.ts` (`app.use('/api/', apiLimiter)` before the routes), ceiling lowered to 5. Each scenario
 * uses its own credential header (= its own bucket, `apiKeyGenerator`). Oracle: HTTP status codes of a real express app + the real
 * limiter — the classifier is ALSO pinned directly. Plus the client half: the app's real tRPC links send `dungMay` alone, unbatched.
 *
 * R1b-1 rà soát cuối I-2 — the exemption ALSO needs a session cookie whose JWT signature verifies (stateless, the same check as
 * robotStopAuth step 1, `trpcGioiHanThuTuc.phienKyHopLe`). Anonymous / junk cookie / wrong signature / expired ⇒ counted like any /api
 * request; a properly signed session ⇒ never counted. Tokens are minted by the REAL `sdk.signSession` (no mock of the verifier).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { SignJWT } from "jose";
import { COOKIE_NAME } from "@shared/const";

process.env.RATE_LIMIT_PER_MINUTE = "5";
delete process.env.REDIS_URL;
process.env.JWT_SECRET ||= "r1b1-ra-soat-cuoi-i2-hmistop-secret";
process.env.VITE_APP_ID ||= "avi-aoi-management";

const rl = await import("./rateLimitConfig");
const { createAppTrpcLinks, isStopOnlyOp } = await import("../../client/src/lib/trpcLinks");
const { sdk } = await import("./sdk");

let server: Server;
let base = "";
/** Cookie of a properly logged-in user (real signature, unexpired). */
let cookieHopLe = "";
/** Same payload signed with ANOTHER secret (bad signature). */
let cookieSaiChuKy = "";
/** Real secret, but expired. */
let cookieHetHan = "";

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
  const payload = { openId: "r1b1-i2-operator", appId: process.env.VITE_APP_ID!, name: "HMI operator" };
  cookieHopLe = `${COOKIE_NAME}=${encodeURIComponent(await sdk.signSession(payload))}`;
  const khac = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode("a-completely-different-secret-r1b1-i2"));
  cookieSaiChuKy = `${COOKIE_NAME}=${encodeURIComponent(khac)}`;
  cookieHetHan = `${COOKIE_NAME}=${encodeURIComponent(await sdk.signSession(payload, { expiresInMs: -60_000 }))}`;
  // the real verifier logs every refused token — expected here, keep the run output readable
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(async () => {
  vi.restoreAllMocks();
  await new Promise<void>((r) => server.close(() => r()));
});

const key = () => `hmistop-${Math.random().toString(36).slice(2)}`;
const post = (path: string, k: string, cookie?: string) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "x-api-key": k, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: "{}" }).then(
    (r) => r.status,
  );
const get = (path: string, k: string, cookie?: string) => fetch(`${base}${path}`, { headers: { "x-api-key": k, ...(cookie ? { cookie } : {}) } }).then((r) => r.status);
const STOP = "/api/trpc/scadaCommands.dungMay";

describe("★★★ apiLimiter × HMI STOP (real express + real limiter, ceiling 5)", () => {
  it("★ properly signed session: 12 non-batched `POST /api/trpc/scadaCommands.dungMay` ⇒ all 200; the bucket is untouched (5 more ordinary calls pass, the 6th is 429)", async () => {
    const k = key();
    for (let i = 0; i < 12; i++) expect(await post(STOP, k, cookieHopLe), `dungMay #${i + 1}`).toBe(200);
    for (let i = 0; i < 5; i++) expect(await get("/api/trpc/scadaKenh.cheDo.danhSach", k, cookieHopLe)).toBe(200);
    expect(await get("/api/trpc/scadaKenh.cheDo.danhSach", k, cookieHopLe)).toBe(429);
    // …and the STOP still goes through once the ordinary bucket is empty
    expect(await post(STOP, k, cookieHopLe)).toBe(200);
  });

  it("★ I-2 — ANONYMOUS dungMay (no cookie) is counted: 5 pass, the 6th is 429", async () => {
    const k = key();
    for (let i = 0; i < 5; i++) expect(await post(STOP, k), `anon #${i + 1}`).toBe(200);
    expect(await post(STOP, k)).toBe(429);
  });

  it("★ I-2 — junk cookie / WRONG signature / expired token ⇒ counted (429 after 5); the cookie name alone buys nothing", async () => {
    for (const [ten, cookie] of [
      ["junk", `${COOKIE_NAME}=not-a-jwt`],
      ["bad %-encoding", `${COOKIE_NAME}=%E0%A4%A`],
      ["wrong signature", cookieSaiChuKy],
      ["expired", cookieHetHan],
      ["other cookie only", "foo=bar"],
    ] as const) {
      const k = key();
      for (let i = 0; i < 5; i++) expect(await post(STOP, k, cookie), `${ten} #${i + 1}`).toBe(200);
      expect(await post(STOP, k, cookie), ten).toBe(429);
    }
  });

  it("★ a BATCHED request carrying dungMay + another call is counted even with a valid session (429 after 5)", async () => {
    const k = key();
    const p = `/api/trpc/${encodeURIComponent("scadaCommands.dungMay,scadaKenh.cheDo.danhSach")}?batch=1`;
    for (let i = 0; i < 5; i++) expect(await post(p, k, cookieHopLe)).toBe(200);
    expect(await post(p, k, cookieHopLe)).toBe(429);
  });

  it("a batch of ONE (`?batch=1`) and a GET are counted too (valid session) — only the exact non-batched POST is exempt", async () => {
    const k = key();
    for (let i = 0; i < 5; i++) expect(await post("/api/trpc/scadaCommands.dungMay?batch=1", k, cookieHopLe)).toBe(200);
    expect(await post("/api/trpc/scadaCommands.dungMay?batch=1", k, cookieHopLe)).toBe(429);
    const k2 = key();
    for (let i = 0; i < 5; i++) expect(await get(STOP, k2, cookieHopLe)).toBe(200);
    expect(await get(STOP, k2, cookieHopLe)).toBe(429);
  });
});

describe("`laStopHmiCoPhienKy` — the limiter's skip predicate (STOP shape AND signed session)", () => {
  const r = (method: string, url: string, cookie?: string) => ({ method, originalUrl: url, url, query: {}, headers: cookie ? { cookie } : {} }) as never;
  it("valid signed token ⇒ true; anonymous / junk / wrong signature / expired ⇒ false (real verifier)", async () => {
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, cookieHopLe))).toBe(true);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, `${COOKIE_NAME}=garbage`))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, cookieSaiChuKy))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, cookieHetHan))).toBe(false);
    // a signed session does NOT widen the shape: other procedures / batches are never exempt
    expect(await rl.laStopHmiCoPhienKy(r("POST", "/api/trpc/scadaCommands.confirm", cookieHopLe))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", "/api/trpc/scadaCommands.dungMay?batch=1", cookieHopLe))).toBe(false);
  });
  it("the signature check is not even consulted off-shape; a throwing / non-true check ⇒ counted (false), never thrown", async () => {
    const kiem = vi.fn(async () => true);
    expect(await rl.laStopHmiCoPhienKy(r("GET", STOP), kiem)).toBe(false);
    expect(kiem).not.toHaveBeenCalled();
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP), async () => Promise.reject(new Error("boom")))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP), (async () => "yes") as never)).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP), kiem)).toBe(true);
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
