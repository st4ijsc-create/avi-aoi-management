/**
 * SCADA R1b-1 Task 2 fix round 1 (important 1) — ★★★ CENSUS: the general `/api` limiter never counts a non-batched HMI STOP
 * (`POST /api/trpc/scadaCommands.dungMay`) CARRYING A SIGNED SESSION (that one is counted by the STOP tier instead), and STILL counts an
 * unsigned one and a batched request carrying it (alone or with any other call).
 *
 * App built in the order of `_core/index.ts` (`app.use('/api/', hmiStopLimiter)` then `app.use('/api/', apiLimiter)` before the routes),
 * general ceiling lowered to 5. Each scenario uses its own credential header (= its own bucket, `apiKeyGenerator`). Oracle: HTTP status
 * codes of a real express app + the real limiters — the classifier is ALSO pinned directly. Plus the client half: the app's real tRPC
 * links send `dungMay` alone, unbatched.
 *
 * R1b-1 rà soát cuối I-2 — the exemption ALSO needs a session cookie whose JWT signature verifies (stateless, the same check as
 * robotStopAuth step 1, `trpcGioiHanThuTuc.phienKyHopLe`). Anonymous / junk cookie / wrong signature / expired ⇒ counted like any /api
 * request. Tokens are minted by the REAL `sdk.signSession` (no mock of the verifier).
 *
 * R1b-2a Task 3 (kiem-dinh limiter + N-2) — the absolute skip is REPLACED by a wide PER-SESSION cap: a signed STOP is counted ONLY by
 * `createHmiStopLimiter` (`TRAN_STOP_HMI_MOI_PHUT` = 600 / min per SESSION of a person — key openId + 16 hex of sha256 of the signed part
 * `header.payload` of the ticket, fix rounds 1–2 — a code constant, no env), never by `apiLimiter`; everything else is counted ONLY by
 * `apiLimiter`. A revoked-but-unexpired (or stolen) ticket is therefore capped at 600 / min in its OWN bucket (no longer unlimited), even
 * when its signature segment is re-encoded (review C-1), and cannot exhaust the person's other session. The limiter path verifies quietly
 * (`sdk.verifySession(token, { imLang: true })`): junk cookies log nothing.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { phanDaKyCuaVe } from "./vePhienCookie";
import { parse as parseCookieHeader } from "cookie";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { SignJWT } from "jose";
import { COOKIE_NAME } from "@shared/const";

/**
 * Fake ioredis (R1b-2a T3 "exactly one limiter counts"): the limiters' Redis store writes `rl:<tier>:<key>` counters here, so a test can
 * see WHICH tier counted a request. Only used while REDIS_URL is set inside that test; every other limiter in this file is memory-backed.
 */
const redisGia = vi.hoisted(() => ({ dem: new Map<string, number>(), ttl: new Map<string, number>() }));
vi.mock("ioredis", async (importOriginal) => {
  const goc = await importOriginal<typeof import("ioredis")>();
  class RedisGia {
    on() {
      return this;
    }
    connect() {
      return Promise.resolve();
    }
    async incr(k: string) {
      const n = (redisGia.dem.get(k) ?? 0) + 1;
      redisGia.dem.set(k, n);
      return n;
    }
    async pttl(k: string) {
      return redisGia.ttl.get(k) ?? -1;
    }
    async pexpire(k: string, ms: number) {
      redisGia.ttl.set(k, ms);
      return 1;
    }
    async decr(k: string) {
      const n = (redisGia.dem.get(k) ?? 0) - 1;
      redisGia.dem.set(k, n);
      return n;
    }
    async del(k: string) {
      redisGia.dem.delete(k);
      redisGia.ttl.delete(k);
      return 1;
    }
  }
  return { ...goc, default: RedisGia };
});

process.env.RATE_LIMIT_PER_MINUTE = "5";
delete process.env.REDIS_URL;
delete process.env.RATE_LIMIT_REDIS;
process.env.JWT_SECRET ||= "r1b1-ra-soat-cuoi-i2-hmistop-secret";
process.env.VITE_APP_ID ||= "avi-aoi-management";

const rl = await import("./rateLimitConfig");
const { createAppTrpcLinks, isStopOnlyOp } = await import("../../client/src/lib/trpcLinks");
const { sdk } = await import("./sdk");

/** An express app with the two limiters mounted exactly as `_core/index.ts` does (STOP tier first, then the general tier). */
async function appHaiLimiter(): Promise<{ server: Server; base: string }> {
  const app = express();
  app.use("/api/", rl.createHmiStopLimiter());
  app.use("/api/", rl.createApiLimiter());
  const ok = (_req: express.Request, res: express.Response) => void res.status(200).json({ ok: true });
  app.post("/api/trpc/*", ok);
  app.get("/api/trpc/*", ok);
  let server!: Server;
  await new Promise<void>((r) => {
    server = app.listen(0, "127.0.0.1", () => r());
  });
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
const dong = (s: Server) => new Promise<void>((r) => s.close(() => r()));

let server: Server;
let base = "";
/** Cookie of a properly logged-in user (real signature, unexpired). */
let cookieHopLe = "";
/** Same payload signed with ANOTHER secret (bad signature). */
let cookieSaiChuKy = "";
/** Real secret, but expired. */
let cookieHetHan = "";
/** Real secret, valid signature, but the payload lacks `name` (verifier's second refusal branch). */
let cookieThieuTruong = "";

const ve = (openId: string) => sdk.signSession({ openId, appId: process.env.VITE_APP_ID!, name: "HMI operator" });
const cookieCua = (token: string) => `${COOKIE_NAME}=${encodeURIComponent(token)}`;

beforeAll(async () => {
  ({ server, base } = await appHaiLimiter());
  const payload = { openId: "r1b1-i2-operator", appId: process.env.VITE_APP_ID!, name: "HMI operator" };
  cookieHopLe = cookieCua(await sdk.signSession(payload));
  const khac = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode("a-completely-different-secret-r1b1-i2"));
  cookieSaiChuKy = cookieCua(khac);
  cookieHetHan = cookieCua(await sdk.signSession(payload, { expiresInMs: -60_000 }));
  const thieu = await new SignJWT({ openId: "r1b2a-t3-thieu", appId: process.env.VITE_APP_ID! })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + 3600)
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  cookieThieuTruong = cookieCua(thieu);
});
afterAll(async () => {
  vi.restoreAllMocks();
  if (server) await dong(server);
});

const key = () => `hmistop-${Math.random().toString(36).slice(2)}`;
const post = (path: string, k: string, cookie?: string) =>
  fetch(`${base}${path}`, { method: "POST", headers: { "x-api-key": k, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: "{}" }).then(
    (r) => r.status,
  );
const get = (path: string, k: string, cookie?: string) => fetch(`${base}${path}`, { headers: { "x-api-key": k, ...(cookie ? { cookie } : {}) } }).then((r) => r.status);
const STOP = "/api/trpc/scadaCommands.dungMay";

/** `n` STOPs carrying only the session cookie (no other credential, same client IP 127.0.0.1), 50 in flight at a time. */
async function guiNLan(goc: string, cookie: string, n: number): Promise<Array<{ status: number; body: string }>> {
  const ra: Array<{ status: number; body: string }> = [];
  for (let i = 0; i < n; i += 50) {
    const lo = Array.from({ length: Math.min(50, n - i) }, () =>
      fetch(`${goc}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" }).then(async (r) => ({
        status: r.status,
        body: await r.text(),
      })),
    );
    ra.push(...(await Promise.all(lo)));
  }
  return ra;
}

/** "[Auth] …" lines among the console.warn calls of a spy. */
const dongAuth = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.filter((c) => String(c[0]).startsWith("[Auth]"));

describe("★★★ apiLimiter × HMI STOP (real express + real limiters, general ceiling 5)", () => {
  it("★ properly signed session: 12 non-batched `POST /api/trpc/scadaCommands.dungMay` ⇒ all 200; the general bucket is untouched (5 more ordinary calls pass, the 6th is 429)", async () => {
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

  it("★ I-2 — junk cookie / WRONG signature / expired token / missing payload field ⇒ counted (429 after 5); the cookie name alone buys nothing", async () => {
    for (const [ten, cookie] of [
      ["junk", `${COOKIE_NAME}=not-a-jwt`],
      ["bad %-encoding", `${COOKIE_NAME}=%E0%A4%A`],
      ["wrong signature", cookieSaiChuKy],
      ["expired", cookieHetHan],
      ["payload without name", cookieThieuTruong],
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

describe("★★★ R1b-2a T3 — STOP tier: 600 / min PER SESSION OF A PERSON (Review Focus 2; fix round 1 c1)", () => {
  it("the cap is a code constant (Q3): 600, not read from RATE_LIMIT_PER_MINUTE (= 5 in this file)", () => {
    expect(rl.TRAN_STOP_HMI_MOI_PHUT).toBe(600);
  });

  it("★★★ session A: 600 STOPs in a minute pass, the 601st ⇒ 429 with the E-STOP text; session B of the SAME person still passes; another person on the SAME IP is unaffected", async () => {
    const OPEN_A = `r1b2a-t3-a-${Date.now()}`;
    const OPEN_B = `r1b2a-t3-b-${Date.now()}`;
    const a = cookieCua(await ve(OPEN_A));
    const a2 = cookieCua(await ve(OPEN_A)); // session B of the same person (another login ⇒ another ticket, different jti)
    expect(a2).not.toBe(a);
    const b = cookieCua(await ve(OPEN_B));
    const lo = await guiNLan(base, a, 600);
    expect(lo.filter((r) => r.status === 429), "a logged-in person's STOP must never be 429 below 600 / min").toHaveLength(0);
    expect(lo.every((r) => r.status === 200)).toBe(true);
    const [thu601] = await guiNLan(base, a, 1);
    expect(thu601.status).toBe(429);
    expect(JSON.parse(thu601.body)).toEqual({ error: "Too many STOP requests — use the hard E-STOP" });
    expect((await guiNLan(base, a2, 1))[0].status, "a stolen / exhausted session must not block the same person's OTHER session").toBe(200);
    expect((await guiNLan(base, b, 1))[0].status, "another person behind the same IP must not be throttled").toBe(200);
    // the STOP tier never touches ordinary traffic: person A's ordinary calls still use the general bucket
    expect(await get("/api/trpc/scadaKenh.cheDo.danhSach", key(), a)).toBe(200);
  }, 60_000);

  it("★★★ review C-1: re-encoded SIGNATURE segments of one ticket (whitespace / newline / tab inside it, trailing space, '=' padding, non-canonical last char) all verify AND share ONE bucket — exhaust with the original ⇒ every variant is 429", async () => {
    const OPEN_V = `r1b2a-t3-v-${Date.now()}`;
    const t = await ve(OPEN_V);
    const [h, p, s] = t.split(".");
    const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const iCuoi = B64U.indexOf(s[s.length - 1]);
    const cuoiKhac = [0, 1, 2, 3].map((k) => B64U[(iCuoi & ~3) | k]).filter((c) => c !== s[s.length - 1]);
    const bienThe = [
      `${h}.${p}.${s.slice(0, 10)} ${s.slice(10)}`,
      `${h}.${p}.${s.slice(0, 5)}\n${s.slice(5, 20)}\r\n${s.slice(20)}`,
      `${h}.${p}.${s.slice(0, 7)}\t${s.slice(7)}`,
      `${t} `,
      `${t}=`,
      ...cuoiKhac.map((c) => `${h}.${p}.${s.slice(0, -1)}${c}`),
    ];
    expect(new Set([t, ...bienThe]).size, "the variants must all differ from the original").toBe(bienThe.length + 1);
    const r = (cookie: string) => ({ method: "POST", originalUrl: STOP, url: STOP, query: {}, headers: { cookie } }) as never;
    // precondition (what makes this an attack): the verifier accepts every variant as the same signed ticket
    for (const v of bienThe) expect(await rl.laStopHmiCoPhienKy(r(cookieCua(v))), JSON.stringify(v.slice(-12))).toBe(true);
    // all of them hash to the same signed part
    expect(new Set(bienThe.map(phanDaKyCuaVe))).toEqual(new Set([`${h}.${p}`]));

    const lo = await guiNLan(base, cookieCua(t), 600);
    expect(lo.every((x) => x.status === 200)).toBe(true);
    for (const v of bienThe) {
      const [kq] = await guiNLan(base, cookieCua(v), 1);
      expect(kq.status, `variant ${JSON.stringify(v.slice(-12))} must share the exhausted bucket`).toBe(429);
    }
  }, 60_000);

  it("phanDaKyCuaVe: header.payload of a 3-segment compact JWS; null for 0 / 1 / 3+ dots or an empty segment (re-review m-6)", () => {
    expect(phanDaKyCuaVe("aaa.bbb.ccc")).toBe("aaa.bbb");
    expect(phanDaKyCuaVe("aaa.bbb.c c=\n")).toBe("aaa.bbb");
    expect(phanDaKyCuaVe("khong-co-cham")).toBeNull();
    expect(phanDaKyCuaVe("aaa.bbb")).toBeNull();
    expect(phanDaKyCuaVe("aaa.bbb.ccc.ddd")).toBeNull();
    expect(phanDaKyCuaVe(".bbb.ccc")).toBeNull();
    expect(phanDaKyCuaVe("aaa..ccc")).toBeNull();
    expect(phanDaKyCuaVe("aaa.bbb.")).toBeNull();
  });

  it("★★★ re-review C-2: the STOP tier reads the cookie EXACTLY as auth does (`cookie.parse`) — whitespace / tab around name or value and a trimmed duplicate name all resolve to the SAME exhausted ticket ⇒ 429", async () => {
    const OPEN_W = `r1b2a-t3-w-${Date.now()}`;
    const t = await ve(OPEN_W);
    const N = COOKIE_NAME;
    const bienThe = [
      `${N}= ${t}`,
      `${N}=   ${t}`,
      `${N}=\t${t}`,
      `${N} =${t}`,
      `${N}\t=${t}`,
      `${N}=${t}\t; foo=bar`,
      `${N} =${t}; ${N}=junk-1`,
      `${N} =${t}; ${N}=junk-2`,
      `foo=bar; ${N}= ${t} ; ${N}=junk-3`,
    ];
    const r = (cookie: string) => ({ method: "POST", originalUrl: STOP, url: STOP, query: {}, headers: { cookie } }) as never;
    for (const c of bienThe) {
      // independent oracle: the auth path's library resolves this header to T (so auth would accept it, one ledger SELECT each)
      expect(parseCookieHeader(c)[N], JSON.stringify(c.slice(0, 24))).toBe(t);
      expect(await rl.laStopHmiCoPhienKy(r(c)), JSON.stringify(c.slice(0, 24))).toBe(true);
    }
    // duplicate-name order follows auth: FIRST wins — junk first ⇒ auth reads junk ⇒ not a signed STOP (general tier), consistently
    expect(parseCookieHeader(`${N}=junk; ${N}=${t}`)[N]).toBe("junk");
    expect(await rl.laStopHmiCoPhienKy(r(`${N}=junk; ${N}=${t}`))).toBe(false);

    const lo = await guiNLan(base, cookieCua(t), 600);
    expect(lo.every((x) => x.status === 200)).toBe(true);
    for (const c of bienThe) {
      const res = await fetch(`${base}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: "{}" });
      expect(res.status, `cookie ${JSON.stringify(c.slice(0, 24))} must hit the exhausted STOP bucket`).toBe(429);
      expect(await res.json()).toEqual({ error: "Too many STOP requests — use the hard E-STOP" });
    }
  }, 60_000);
});

describe("★★★ R1b-2a T3 — each request is counted by EXACTLY ONE limiter (fake Redis store, counters by tier prefix)", () => {
  it("signed STOP ⇒ only rl:hmistop: (key hmistop:u:<openId>:<16 hex sha256(header.payload)>, raw token in no key); anonymous / junk / bad signature / batch / GET / verifier throwing ⇒ only rl:api:", async () => {
    process.env.REDIS_URL = "redis://fake-r1b2a-t3:6379";
    let app: { server: Server; base: string };
    try {
      app = await appHaiLimiter();
    } finally {
      delete process.env.REDIS_URL;
    }
    const OPEN_C = `r1b2a-t3-c-${Date.now()}`;
    const veC = await ve(OPEN_C);
    const c = cookieCua(veC);
    const tong = (tienTo: string) => [...redisGia.dem].filter(([k]) => k.startsWith(tienTo)).reduce((s, [, v]) => s + v, 0);
    const gui = (p: string, method: "POST" | "GET", cookie?: string) =>
      fetch(`${app.base}${p}`, {
        method,
        headers: { ...(method === "POST" ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
        ...(method === "POST" ? { body: "{}" } : {}),
      }).then((r) => r.status);
    const motLan = async (ten: string, tang: "hmistop" | "api", p: string, method: "POST" | "GET", cookie?: string) => {
      const truocApi = tong("rl:api:");
      const truocStop = tong("rl:hmistop:");
      expect(await gui(p, method, cookie), ten).toBe(200);
      expect({ api: tong("rl:api:") - truocApi, hmistop: tong("rl:hmistop:") - truocStop }, ten).toEqual(
        tang === "api" ? { api: 1, hmistop: 0 } : { api: 0, hmistop: 1 },
      );
    };
    try {
      await motLan("signed STOP", "hmistop", STOP, "POST", c);
      await motLan("signed STOP again", "hmistop", STOP, "POST", c);
      const bamC = createHash("sha256").update(veC.slice(0, veC.lastIndexOf("."))).digest("hex").slice(0, 16);
      expect(redisGia.dem.get(`rl:hmistop:hmistop:u:${OPEN_C}:${bamC}`)).toBe(2);
      expect([...redisGia.dem.keys()].filter((k) => k.includes(veC) || k.includes(encodeURIComponent(veC))), "raw token must never be stored").toEqual([]);
      await motLan("anonymous STOP", "api", STOP, "POST");
      await motLan("junk cookie STOP", "api", STOP, "POST", `${COOKIE_NAME}=rac-r1b2a`);
      await motLan("wrong signature STOP", "api", STOP, "POST", cookieSaiChuKy);
      await motLan("batch of one, signed", "api", `${STOP}?batch=1`, "POST", c);
      await motLan("GET, signed", "api", STOP, "GET", c);
      await motLan("other procedure, signed", "api", "/api/trpc/scadaCommands.confirm", "POST", c);
      // fail-closed: the verifier THROWING ⇒ counted by the general tier, never skipped by both
      const loi = vi.spyOn(sdk, "verifySession").mockRejectedValueOnce(new Error("verifier boom"));
      try {
        await motLan("signed STOP, verifier throws", "api", STOP, "POST", c);
      } finally {
        loi.mockRestore();
      }
    } finally {
      await dong(app.server);
    }
  });
});

describe("★★★ R1b-2a T3 — N-2: the limiter path verifies QUIETLY", () => {
  it("200 POST dungMay with junk cookies ⇒ 0 'Session verification failed' lines from the limiter path (skip predicate)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const r = (cookie: string) => ({ method: "POST", originalUrl: STOP, url: STOP, query: {}, headers: { cookie } }) as never;
      for (let i = 0; i < 200; i++) await rl.laStopHmiCoPhienKy(r(`${COOKIE_NAME}=rac${i}`));
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("Session verification failed"))).toHaveLength(0);
      // wrong signature / expired / missing field: the other refusal branches are quiet as well
      for (const cookie of [cookieSaiChuKy, cookieHetHan, cookieThieuTruong]) expect(await rl.laStopHmiCoPhienKy(r(cookie))).toBe(false);
      expect(dongAuth(warn)).toHaveLength(0);
      // positive control — the spy DOES see the verifier when it is called the default (loud) way
      await sdk.verifySession("rac-doi-chung");
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("Session verification failed"))).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("…and end-to-end over HTTP through both limiters: 200 junk-cookie STOPs ⇒ 0 '[Auth]' lines", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 200; i += 50) {
        await Promise.all(
          Array.from({ length: 50 }, (_, j) =>
            fetch(`${base}${STOP}`, { method: "POST", headers: { "content-type": "application/json", cookie: `${COOKIE_NAME}=rac-http-${i + j}` }, body: "{}" }),
          ),
        );
      }
      expect(dongAuth(warn)).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("`laStopHmiCoPhienKy` — the STOP-tier predicate (STOP shape AND signed session)", () => {
  const r = (method: string, url: string, cookie?: string) => ({ method, originalUrl: url, url, query: {}, headers: cookie ? { cookie } : {} }) as never;
  it("valid signed token ⇒ true; anonymous / junk / wrong signature / expired ⇒ false (real verifier)", async () => {
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, cookieHopLe))).toBe(true);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, `${COOKIE_NAME}=garbage`))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, cookieSaiChuKy))).toBe(false);
    expect(await rl.laStopHmiCoPhienKy(r("POST", STOP, cookieHetHan))).toBe(false);
    // a signed session does NOT widen the shape: other procedures / batches are never in the STOP tier
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
  it("the default check verifies ONCE per request object (both limiters + the key share one result — no disagreement at an expiry edge)", async () => {
    const spy = vi.spyOn(sdk, "verifySession");
    try {
      const req = r("POST", STOP, cookieCua(await ve(`r1b2a-t3-memo-${Date.now()}`)));
      expect(await rl.laStopHmiCoPhienKy(req)).toBe(true);
      expect(await rl.laStopHmiCoPhienKy(req)).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toEqual({ imLang: true });
    } finally {
      spy.mockRestore();
    }
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

describe("wiring — `_core/index.ts` mounts the STOP tier BEFORE the general tier on '/api/' (and nowhere dead)", () => {
  it("app.use('/api/', hmiStopLimiter) precedes app.use('/api/', apiLimiter); no '/trpc/' mount (fix round 1 c2: no router there)", () => {
    const src = readFileSync(path.resolve(__dirname, "index.ts"), "utf8");
    expect(src).toContain("const hmiStopLimiter = createHmiStopLimiter();");
    const iStop = src.indexOf("app.use('/api/', hmiStopLimiter)");
    const iApi = src.indexOf("app.use('/api/', apiLimiter)");
    expect(iStop, "STOP tier mount missing").toBeGreaterThan(0);
    expect(iApi, "STOP tier must be mounted before the general tier").toBeGreaterThan(iStop);
    expect(src.match(/app\.use\([^)]*hmiStopLimiter\)/g), "exactly one STOP-tier mount").toHaveLength(1);
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
