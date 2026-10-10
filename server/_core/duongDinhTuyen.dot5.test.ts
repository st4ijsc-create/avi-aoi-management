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
      }
    }
    // the variants of the finding really reach the handlers (otherwise this test would prove nothing)
    for (const t of ["http://x/api/ot/ingest", "/api/ot/ingest#x", "/api/machine/claim#x", "http://idp/api/saml/acs"]) {
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
      for (const t of ["http://x/api/trpc/x", "/api/trpc/x#y", "http://x/API/trpc/x?a#b"]) {
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
    for (const [t, b] of [["http://x/api/ot/ingest", "r2"], ["/api/ot/ingest#x", "r3"], ["HTTP://X/API/OT/INGEST?q#f", "r4"]] as const) {
      expect(isOtIngestRequest(reqOf(t)), t).toBe(true);
      expect(apiKeyGenerator(reqOf(t, { "x-api-key": key, authorization: `Bearer ${b}` })), t).toBe(canonical);
    }
  });

  it("credentialConflictGuard runs on absolute-form and `#` machine-plane targets (400)", () => {
    for (const t of ["http://x/api/ot/ingest", "/api/ot/ingest#x", "http://x/api/v1/ingest/telemetry", "/api/machine/heartbeat#h"]) {
      let status = 0;
      let nexted = false;
      const res = { status(c: number) { status = c; return this; }, json() { return this; } } as never;
      credentialConflictGuard(reqOf(t, { "x-api-key": "k1" }, { apiKey: "k2" }), res, () => { nexted = true; });
      expect({ t, status, nexted }).toEqual({ t, status: 400, nexted: false });
    }
  });

  it("machine bootstrap (claim) stays out of the 60k tier on `#` and absolute-form; tRPC tier sees absolute-form", () => {
    for (const t of ["/api/machine/claim#x", "http://evil.example/api/machine/claim", "/api/machine/CLAIM/#x"]) {
      expect(isMachineRestIngestRequest(reqOf(t)), t).toBe(false);
      expect(isMachineIngestRequest(reqOf(t)), t).toBe(false);
    }
    expect(isMachineIngestRequest(reqOf("http://x/api/trpc/machineApi.heartbeat#z"))).toBe(true);
    expect(isMachineIngestRequest(reqOf("http://x/api/trpc/machineApi.heartbeat,machineApi.issueKey"))).toBe(false);
  });
});
