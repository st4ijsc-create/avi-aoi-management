/**
 * doc 81 Đợt 5 G fix 2 (re-review N1) — `duongDinhTuyen` must name the path EXPRESS routes on.
 *
 * Oracle = Express itself: a real app on 127.0.0.1:0 with one handler per canonical route; raw request targets are sent
 * over a plain TCP socket (fetch cannot send absolute-form or a `#`). For every target that REACHED a handler, the
 * helper (fed the same `originalUrl` Express saw) must return that handler's route, lower-cased. Targets Express does
 * not route anywhere are reported, not asserted (classifying them as API is harmless: no handler runs).
 * Then originCheck (enforce) and the rate-limit classifiers are checked on the same absolute-form / fragment targets.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import net from "node:net";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { duongDinhTuyen, duongDinhTuyenGoc, duongKhopChinhXac } from "./duongDinhTuyen";
import { originCheckMiddleware } from "./originCheck";
import {
  apiKeyGenerator,
  credentialConflictGuard,
  isMachineIngestRequest,
  isMachineRestIngestRequest,
  isOtIngestRequest,
} from "./rateLimitConfig";

const ROUTES = ["/api/ot/ingest", "/api/machine/claim", "/api/machine/heartbeat", "/api/trpc/x", "/api/saml/acs"];

let server: Server;
let port = 0;
const seen: Array<{ route: string; originalUrl: string }> = [];

function rawRequest(target: string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, "127.0.0.1");
    let buf = "";
    const t = setTimeout(() => { s.destroy(); reject(new Error(`timeout ${target}`)); }, 5000);
    s.on("data", (d) => {
      buf += d.toString("latin1");
      const m = buf.match(/^HTTP\/1\.1 (\d{3})/);
      if (m) { clearTimeout(t); s.destroy(); resolve(Number(m[1])); }
    });
    s.on("error", (e) => { clearTimeout(t); reject(e); });
    const h = Object.entries({ host: "factory.local", "content-length": "0", connection: "close", ...headers })
      .map(([k, v]) => `${k}: ${v}\r\n`).join("");
    s.write(`POST ${target} HTTP/1.1\r\n${h}\r\n`);
  });
}

beforeAll(async () => {
  const express = (await import("express")).default;
  const app = express();
  for (const r of ROUTES) {
    app.post(r, (req, res) => { seen.push({ route: r, originalUrl: req.originalUrl }); res.status(200).end(); });
  }
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

const TARGETS = [
  "/api/ot/ingest", "/API/ot/ingest", "/api/ot/ingest?x=1", "/api/ot/ingest#x", "/api/ot/ingest?a=1#b",
  "http://x/api/ot/ingest", "HTTP://X:80/API/OT/INGEST?q#f", "http://x/api/ot/ingest#x",
  "/api/machine/claim#x", "http://evil.example/api/machine/claim", "/api/machine/Claim/", "/api/machine/heartbeat#h",
  "/api/trpc/x#y", "http://x/API/trpc/x", "/api/saml/acs#x", "http://idp/api/saml/acs",
  "/./api/ot/ingest", "//api/ot/ingest", "/api%2Fot/ingest",
  // G fix 3 (R2-1) — targets from Express's own parser (parseurl → url.parse once a `#` is present: a leading
  // `//userinfo@host` becomes an authority). Each one is decided by which handler REALLY ran.
  "//a@b/api/ot/ingest#x", "//a@b/api/trpc/x#x", "//a@b/api/machine/claim#x", "//a@b/api/machine/heartbeat#x",
  "//a@b/api/saml/acs#x", "//u:p@h/API/ot/ingest?x#y", "//a@b@c/api/ot/ingest#x", "//a@b/api/ot/ingest",
  "//api/ot/ingest#x", "///api/ot/ingest#x", "//@/api/ot/ingest#x", "//a@/api/ot/ingest#x", "/api/ot/ingest?#",
  "/%2F/api/ot/ingest#x", "//a@b/API/V1/ingest#x", "http://u@x/api/ot/ingest#x",
];

describe("N1 — duongDinhTuyen agrees with Express routing (raw request targets)", () => {
  it("every target Express routes to a handler is classified as exactly that route (lower-cased)", async () => {
    const reached: string[] = [];
    for (const target of TARGETS) {
      const before = seen.length;
      const status = await rawRequest(target);
      if (seen.length > before) {
        const hit = seen[seen.length - 1];
        reached.push(target);
        // exact-path form (one trailing slash dropped, as Express strict:false routes it) = the handler's route
        expect(duongKhopChinhXac(duongDinhTuyen({ originalUrl: hit.originalUrl })), `${target} → ${hit.route}`).toBe(hit.route);
      } else {
        expect(status, target).toBe(404); // routed nowhere ⇒ no handler to protect
        // …and the helper must not claim it is one of the handled routes either (both directions are compared)
        expect(ROUTES, `${target} classified as a route Express did not run`).not.toContain(
          duongKhopChinhXac(duongDinhTuyen({ originalUrl: target })),
        );
      }
    }
    // the variants of the finding really reach the handlers (otherwise this test would prove nothing)
    for (const t of ["http://x/api/ot/ingest", "/api/ot/ingest#x", "/api/machine/claim#x", "http://idp/api/saml/acs",
      "//a@b/api/ot/ingest#x", "//a@b/api/trpc/x#x", "//a@b/api/machine/claim#x"]) {
      expect(reached, t).toContain(t);
    }
  });

  it("unit: query, fragment, absolute-form, case", () => {
    expect(duongDinhTuyen({ originalUrl: "HTTP://X:80/API/OT/INGEST?q#f" })).toBe("/api/ot/ingest");
    expect(duongDinhTuyenGoc({ originalUrl: "http://x/API/trpc/machineApi.heartbeat#z" })).toBe("/API/trpc/machineApi.heartbeat");
    expect(duongDinhTuyen({ originalUrl: "http://x" })).toBe("/");
    expect(duongDinhTuyen({ path: "/Api/Saml/ACS" })).toBe("/api/saml/acs");
    expect(duongDinhTuyen({ originalUrl: "/api/%74rpc/x" })).toBe("/api/%74rpc/x"); // nothing decoded, like Express
    expect([duongKhopChinhXac("/a/"), duongKhopChinhXac("/a//"), duongKhopChinhXac("/")]).toEqual(["/a", "/a//", "/"]);
  });
});

describe("N1 — originCheck (enforce) and rate-limit classification on absolute-form / fragment targets", () => {
  it("originCheck: foreign Origin on absolute-form or `#` API targets ⇒ 403; ACS stays exempt", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const mw = originCheckMiddleware({ SEC_ORIGIN_CHECK_MODE: "enforce", NODE_ENV: "production" } as never);
      const run = (originalUrl: string) => {
        let status = 0;
        let nexted = false;
        const path = duongDinhTuyenGoc({ originalUrl }); // what Express exposes as req.path at the root mount
        const res = { status(c: number) { status = c; return this; }, json() { return this; } } as never;
        mw({ method: "POST", path, originalUrl, url: originalUrl, headers: { host: "factory.local", origin: "https://evil.example" } } as never, res, () => { nexted = true; });
        return { status, nexted };
      };
      for (const t of ["http://x/api/trpc/x", "/api/trpc/x#y", "http://x/API/trpc/x?a#b", "//a@b/api/trpc/x#x"]) {
        expect(run(t), t).toEqual({ status: 403, nexted: false });
      }
      for (const t of ["/api/saml/acs#x", "http://idp/api/saml/acs"]) {
        expect(run(t), t).toEqual({ status: 0, nexted: true });
      }
    } finally {
      warn.mockRestore();
      log.mockRestore();
    }
  });

  const reqOf = (url: string, headers: Record<string, string> = {}, body: unknown = {}) =>
    ({ originalUrl: url, url, headers, body, ip: "203.0.113.9", socket: { remoteAddress: "203.0.113.9" } }) as never;

  it("legacy OT ingest bucket ignores a random Bearer on absolute-form and `#` targets too", () => {
    const key = "mk_live_same";
    const canonical = apiKeyGenerator(reqOf("/api/ot/ingest", { "x-api-key": key, authorization: "Bearer r1" }));
    for (const [t, b] of [["http://x/api/ot/ingest", "r2"], ["/api/ot/ingest#x", "r3"], ["HTTP://X/API/OT/INGEST?q#f", "r4"], ["//a@b/api/ot/ingest#x", "r5"]] as const) {
      expect(isOtIngestRequest(reqOf(t)), t).toBe(true);
      expect(apiKeyGenerator(reqOf(t, { "x-api-key": key, authorization: `Bearer ${b}` })), t).toBe(canonical);
    }
  });

  it("credentialConflictGuard runs on absolute-form and `#` machine-plane targets (400)", () => {
    for (const t of ["http://x/api/ot/ingest", "/api/ot/ingest#x", "http://x/api/v1/ingest/telemetry", "/api/machine/heartbeat#h",
      "//a@b/api/ot/ingest#x", "//a@b/api/v1/ingest/telemetry#x", "//a@b/api/machine/heartbeat#x"]) {
      let status = 0;
      let nexted = false;
      const res = { status(c: number) { status = c; return this; }, json() { return this; } } as never;
      credentialConflictGuard(reqOf(t, { "x-api-key": "k1" }, { apiKey: "k2" }), res, () => { nexted = true; });
      expect({ t, status, nexted }).toEqual({ t, status: 400, nexted: false });
    }
  });

  it("machine bootstrap (claim) stays out of the 60k tier on `#` and absolute-form; tRPC tier sees absolute-form", () => {
    for (const t of ["/api/machine/claim#x", "http://evil.example/api/machine/claim", "/api/machine/CLAIM/#x", "//a@b/api/machine/claim#x"]) {
      expect(isMachineRestIngestRequest(reqOf(t)), t).toBe(false);
      expect(isMachineIngestRequest(reqOf(t)), t).toBe(false);
    }
    expect(isMachineIngestRequest(reqOf("http://x/api/trpc/machineApi.heartbeat#z"))).toBe(true);
    expect(isMachineIngestRequest(reqOf("http://x/api/trpc/machineApi.heartbeat,machineApi.issueKey"))).toBe(false);
  });
});

/**
 * doc 81 Đợt 5 final wave F6 (G re-review 3) — parseurl that cannot be LOADED ⇒ fail CLOSED: every request target is
 * classified as a protected API path (origin check enforced, general browser tier, never an ingest / bootstrap tier),
 * never the raw string cut (which kept `http://x/api/…` and `//a@b/api/…#x` OUT of every API classification).
 */
describe("final wave F6 — parseurl load failure fails CLOSED", () => {
  afterAll(async () => {
    (await import("./duongDinhTuyen")).__napParseurlChoTest(null); // restore the real loader
  });

  it("★ loader throws ⇒ absolute-form / authority-form / plain targets all classify as a protected API path; the real loader restores the exact path", async () => {
    const mod = await import("./duongDinhTuyen");
    const errors: unknown[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    try {
      mod.__napParseurlChoTest(() => {
        throw new Error("Cannot find module 'parseurl'");
      });
      expect(errors.join("\n")).toMatch(/parseurl/); // said ONCE, loudly, at load — not swallowed per request
      for (const t of ["http://x/api/ot/ingest", "//a@b/api/ot/ingest#x", "/api/ot/ingest", "/totally/not/api", "/API/trpc/x"]) {
        const p = mod.duongDinhTuyen({ originalUrl: t, url: t });
        expect(p.startsWith("/api/"), `${t} ⇒ ${p}`).toBe(true);
        expect(["/api/ot/ingest", "/api/v1/ingest", "/api/machine/claim", "/api/saml/acs"].some((r) => p === r || p.startsWith(r + "/")), `${t} ⇒ ${p}`).toBe(false);
      }
      // originCheck (enforce) refuses a foreign Origin on the absolute-form target that the raw cut let through
      const req = { method: "POST", originalUrl: "http://x/api/ot/ingest", url: "http://x/api/ot/ingest", path: "/api/ot/ingest", headers: { origin: "https://evil.example", host: "factory.local" } } as never;
      const { evaluateOrigin } = await import("./originCheck");
      expect(evaluateOrigin(req, { mode: "enforce", allowedOrigins: new Set(), allowDevLoopback: false } as never)).toMatchObject({ allowed: false });
      // never the high tiers
      expect(isOtIngestRequest({ originalUrl: "/api/ot/ingest", url: "/api/ot/ingest", headers: {} } as never)).toBe(false);
      expect(isMachineRestIngestRequest({ originalUrl: "/api/machine/heartbeat", url: "/api/machine/heartbeat", headers: {} } as never)).toBe(false);
      expect(isMachineIngestRequest({ originalUrl: "/api/trpc/machineApi.heartbeat", url: "/api/trpc/machineApi.heartbeat", headers: {} } as never)).toBe(false);
    } finally {
      mod.__napParseurlChoTest(null);
      errSpy.mockRestore();
    }
    expect(mod.duongDinhTuyen({ originalUrl: "//a@b/api/ot/ingest#x", url: "//a@b/api/ot/ingest#x" })).toBe("/api/ot/ingest");
    expect(mod.duongDinhTuyen({ originalUrl: "/API/trpc/x?y=1", url: "/API/trpc/x?y=1" })).toBe("/api/trpc/x");
  });

  it("a loaded module WITHOUT parseurl.original counts as a load failure (said loudly, fail closed)", async () => {
    const mod = await import("./duongDinhTuyen");
    const errors: string[] = [];
    const errSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void errors.push(a.join(" ")));
    try {
      mod.__napParseurlChoTest(() => ({}) as never);
      expect(errors.join(" | ")).toMatch(/could not be loaded.*parseurl\.original is not a function/);
      expect(mod.duongDinhTuyen({ originalUrl: "http://x/api/ot/ingest", url: "http://x/api/ot/ingest" })).toBe(mod.DUONG_KHONG_XAC_DINH);
    } finally {
      mod.__napParseurlChoTest(null);
      errSpy.mockRestore();
    }
  });

  it("★ parseurl loaded but it THROWS / answers no pathname for a request ⇒ the same fail-closed protected API path (no raw cut)", async () => {
    const mod = await import("./duongDinhTuyen");
    try {
      for (const broken of [{ original: () => { throw new Error("URIError"); } }, { original: () => ({ pathname: null }) }, { original: () => undefined }]) {
        mod.__napParseurlChoTest(() => broken as never);
        for (const t of ["http://x/api/ot/ingest", "/totally/not/api"]) {
          expect(mod.duongDinhTuyen({ originalUrl: t, url: t })).toBe(mod.DUONG_KHONG_XAC_DINH);
        }
      }
    } finally {
      mod.__napParseurlChoTest(null);
    }
    // plain objects without originalUrl / url (unit callers) keep the string cut of `path`
    expect(mod.duongDinhTuyen({ path: "/API/x?y" })).toBe("/api/x");
  });
});
