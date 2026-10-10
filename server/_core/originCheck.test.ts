/**
 * W0-I (doc 44 G5.7b) — originCheck: same-origin pass, cross-origin log/enforce,
 * đường API-key miễn kiểm tra, thiếu Origin/Referer pass (trade-off chuẩn).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ORIGIN_CHECK_EXEMPT_PREFIXES,
  _resetOriginCheckCounters,
  buildOriginCheckConfig,
  evaluateOrigin,
  getOriginCheckMode,
  getOriginViolationCount,
  originCheckMiddleware,
} from "./originCheck";

function req(over: Partial<{ method: string; path: string; headers: Record<string, unknown> }> = {}) {
  return {
    method: "POST",
    path: "/api/trpc/products.update",
    headers: { host: "factory.local:3000" },
    ...over,
  } as any;
}

// G fix 2 (re-review): the middleware logs every violation ("[Security] Origin mismatch") and warns on a bad mode —
// expected here; keep the run output pristine (nothing below asserts on console output).
let quietSpies: Array<{ mockRestore(): void }> = [];
beforeAll(() => {
  quietSpies = (["log", "info", "warn"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterAll(() => quietSpies.forEach((s) => s.mockRestore()));

const logCfg = buildOriginCheckConfig({ SEC_ORIGIN_CHECK_MODE: "log", NODE_ENV: "production" } as any);

describe("getOriginCheckMode", () => {
  it("default off; giá trị rác → off; log/enforce hợp lệ", () => {
    expect(getOriginCheckMode({} as any)).toBe("off");
    expect(getOriginCheckMode({ SEC_ORIGIN_CHECK_MODE: "yolo" } as any)).toBe("off");
    expect(getOriginCheckMode({ SEC_ORIGIN_CHECK_MODE: "log" } as any)).toBe("log");
    expect(getOriginCheckMode({ SEC_ORIGIN_CHECK_MODE: "Enforce" } as any)).toBe("enforce");
  });
});

describe("evaluateOrigin", () => {
  it("mode off → luôn pass", () => {
    const cfg = buildOriginCheckConfig({} as any);
    const v = evaluateOrigin(req({ headers: { host: "a", origin: "https://evil.example" } }), cfg);
    expect(v.allowed).toBe(true);
  });

  it("GET/HEAD/OPTIONS không bị kiểm tra", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const v = evaluateOrigin(req({ method, headers: { host: "a", origin: "https://evil.example" } }), logCfg);
      expect(v.allowed).toBe(true);
      expect(v.reason).toBe("safe_method");
    }
  });

  it("same-origin pass (so host:port, scheme-agnostic — sau TLS proxy vẫn đúng)", () => {
    const v = evaluateOrigin(
      req({ headers: { host: "factory.local:3000", origin: "https://factory.local:3000" } }),
      logCfg,
    );
    expect(v).toEqual({ allowed: true, reason: "same_origin" });
  });

  it("cross-origin bị đánh dấu origin_mismatch", () => {
    const v = evaluateOrigin(
      req({ headers: { host: "factory.local:3000", origin: "https://evil.example" } }),
      logCfg,
    );
    expect(v.allowed).toBe(false);
    expect(v).toMatchObject({ reason: "origin_mismatch", origin: "https://evil.example" });
  });

  it("fallback Referer khi thiếu Origin", () => {
    const bad = evaluateOrigin(
      req({ headers: { host: "factory.local:3000", referer: "https://evil.example/page?x=1" } }),
      logCfg,
    );
    expect(bad.allowed).toBe(false);
    const good = evaluateOrigin(
      req({ headers: { host: "factory.local:3000", referer: "http://factory.local:3000/products" } }),
      logCfg,
    );
    expect(good.allowed).toBe(true);
  });

  it("thiếu cả Origin lẫn Referer → pass (curl / C# machine client / service nội bộ)", () => {
    const v = evaluateOrigin(req({ headers: { host: "factory.local:3000" } }), logCfg);
    expect(v).toEqual({ allowed: true, reason: "no_origin" });
  });

  it("đường máy-to-máy (API key) được miễn — /api/v1, /api/machine, /api/external, /api/aoi…", () => {
    for (const prefix of ORIGIN_CHECK_EXEMPT_PREFIXES) {
      const v = evaluateOrigin(
        req({ path: prefix + "anything", headers: { host: "a:1", origin: "https://evil.example" } }),
        logCfg,
      );
      expect(v.allowed, prefix).toBe(true);
      expect(v.reason, prefix).toBe("exempt_path");
    }
  });

  it("path ngoài /api|/trpc không bị chạm (vd /v1 OpenAI gateway, /uploads)", () => {
    const v = evaluateOrigin(
      req({ path: "/v1/chat/completions", headers: { host: "a:1", origin: "https://evil.example" } }),
      logCfg,
    );
    expect(v).toEqual({ allowed: true, reason: "not_api_path" });
  });

  it("SEC_ALLOWED_ORIGINS + ALLOWED_ORIGINS (CSV, normalize slash/hoa-thường) được tin", () => {
    const cfg = buildOriginCheckConfig({
      SEC_ORIGIN_CHECK_MODE: "enforce",
      NODE_ENV: "production",
      ALLOWED_ORIGINS: "https://hq.example.com",
      SEC_ALLOWED_ORIGINS: "https://Kiosk.Example.com/, http://10.0.0.5:8080",
    } as any);
    for (const origin of ["https://hq.example.com", "https://kiosk.example.com", "http://10.0.0.5:8080"]) {
      const v = evaluateOrigin(req({ headers: { host: "factory.local:3000", origin } }), cfg);
      expect(v.allowed, origin).toBe(true);
      expect(v.reason, origin).toBe("allowlisted");
    }
  });

  it("dev loopback pass ngoài production (Vite dev port khác), production thì KHÔNG", () => {
    const dev = buildOriginCheckConfig({ SEC_ORIGIN_CHECK_MODE: "log" } as any);
    expect(
      evaluateOrigin(req({ headers: { host: "factory.local:3000", origin: "http://localhost:3001" } }), dev).allowed,
    ).toBe(true);
    expect(
      evaluateOrigin(req({ headers: { host: "factory.local:3000", origin: "http://localhost:3001" } }), logCfg).allowed,
    ).toBe(false);
  });
});

describe("originCheckMiddleware", () => {
  beforeEach(() => _resetOriginCheckCounters());

  function run(env: Record<string, string>, headers: Record<string, unknown>, path = "/api/trpc/x") {
    const mw = originCheckMiddleware(env as any);
    let nexted = false;
    let statusCode: number | undefined;
    let body: any;
    const res = {
      status(c: number) { statusCode = c; return this; },
      json(b: any) { body = b; return this; },
    } as any;
    mw(req({ path, headers }) as any, res, () => { nexted = true; });
    return { nexted, statusCode, body };
  }

  it("mode off (default): pass-through kể cả cross-origin, không đếm vi phạm", () => {
    const r = run({}, { host: "a:1", origin: "https://evil.example" });
    expect(r.nexted).toBe(true);
    expect(r.statusCode).toBeUndefined();
    expect(getOriginViolationCount()).toBe(0);
  });

  it("mode log: cross-origin vẫn next() nhưng ĐẾM vi phạm", () => {
    const r = run(
      { SEC_ORIGIN_CHECK_MODE: "log", NODE_ENV: "production" },
      { host: "a:1", origin: "https://evil.example" },
    );
    expect(r.nexted).toBe(true);
    expect(r.statusCode).toBeUndefined();
    expect(getOriginViolationCount()).toBe(1);
  });

  it("mode enforce: cross-origin → 403 JSON reason_code ORIGIN_MISMATCH, không next()", () => {
    const r = run(
      { SEC_ORIGIN_CHECK_MODE: "enforce", NODE_ENV: "production" },
      { host: "a:1", origin: "https://evil.example" },
    );
    expect(r.nexted).toBe(false);
    expect(r.statusCode).toBe(403);
    expect(r.body).toMatchObject({ success: false, reason_code: "ORIGIN_MISMATCH" });
  });

  it("mode enforce: same-origin + thiếu-Origin + exempt path đều pass", () => {
    const env = { SEC_ORIGIN_CHECK_MODE: "enforce", NODE_ENV: "production" };
    expect(run(env, { host: "a:1", origin: "http://a:1" }).nexted).toBe(true);
    expect(run(env, { host: "a:1" }).nexted).toBe(true); // curl / machine client
    expect(run(env, { host: "a:1", origin: "https://evil.example" }, "/api/v1/commands").nexted).toBe(true);
  });
});

// doc 81 Đợt 5 task G5 (item 21) + G fix 1 (R-5-b) — SAML POST binding: the IdP's browser form posts cross-site to the
// ACS, so under `enforce` the ACS was 403 ORIGIN_MISMATCH. Exempt: the ACS path only. Every comparison runs on the
// LOWER-CASED path, because Express routes case-insensitively (`/API/trpc/x` reaches the `/api/trpc` handler).
// Decision (R-5-b): the exemption covers exactly the requests Express routes to the ACS handler — any letter case and
// ONE optional trailing slash (strict:false). `/api/saml/acs//`, `/api/saml/acs/x`, `/api/saml/acsx` reach no ACS
// handler and stay checked. Measured through a real Express app on 127.0.0.1:0.
describe("G5 + R-5-b — exact ACS exemption, case-insensitive like Express routing (enforce)", () => {
  const ENFORCE = { SEC_ORIGIN_CHECK_MODE: "enforce", NODE_ENV: "production" } as any;
  const IDP = "https://login.idp.example";

  it("evaluateOrigin: ACS (any case, one trailing slash) ⇒ exempt_path; look-alikes and siblings still checked", () => {
    const cfg = buildOriginCheckConfig(ENFORCE);
    const v = (path: string, origin = IDP) => evaluateOrigin(req({ path, headers: { host: "factory.local:3000", origin } }), cfg);
    for (const p of ["/api/saml/acs", "/api/saml/ACS", "/API/SAML/ACS", "/api/saml/acs/", "/Api/Saml/Acs/"]) {
      expect(v(p), p).toEqual({ allowed: true, reason: "exempt_path" });
    }
    expect(v("/api/saml/acs", "null")).toEqual({ allowed: true, reason: "exempt_path" });
    for (const p of ["/api/saml/acs//", "/api/saml/acs/x", "/api/saml/acsx", "/api/saml/login", "/API/SAML/LOGIN", "/api/saml/metadata", "/api/saml/", "/api/saml"]) {
      expect(v(p), p).toEqual({ allowed: false, reason: "origin_mismatch", origin: IDP });
    }
  });

  it("evaluateOrigin: mixed-case API paths are PROTECTED (no not_api_path escape); mixed-case exempt prefixes stay exempt", () => {
    const cfg = buildOriginCheckConfig(ENFORCE);
    const v = (path: string) => evaluateOrigin(req({ path, headers: { host: "factory.local:3000", origin: "https://evil.example" } }), cfg);
    for (const p of ["/API/trpc/products.update", "/Api/Trpc/x", "/api/TRPC/x", "/TRPC/x", "/API/settings/save"]) {
      expect(v(p), p).toEqual({ allowed: false, reason: "origin_mismatch", origin: "https://evil.example" });
    }
    for (const p of ["/API/v1/commands", "/Api/Machine/heartbeat", "/API/CSP-REPORT"]) {
      expect(v(p), p).toEqual({ allowed: true, reason: "exempt_path" });
    }
  });

  it("real Express app, enforce: IdP POST to the ACS reaches it; mixed-case /API/trpc (JSON and multipart) is 403", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(originCheckMiddleware(ENFORCE));
    app.use(express.urlencoded({ extended: false }));
    let acsHits = 0;
    let trpcHits = 0;
    app.post("/api/saml/acs", (r, s) => { acsHits++; s.status(200).json({ ok: true, got: Boolean((r.body as any)?.SAMLResponse) }); });
    // mounted the way server/_core/index.ts mounts tRPC (app.use("/api/trpc", …)) — Express strips the mount case-insensitively
    const trpc = express.Router();
    trpc.post("/:proc", (_r, s) => { trpcHits++; s.status(200).json({ ok: true }); });
    app.use("/api/trpc", trpc);
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const url = (path: string) => `http://127.0.0.1:${port}${path}`;
      const form = (path: string, origin: string) =>
        fetch(url(path), {
          method: "POST",
          headers: { origin, "content-type": "application/x-www-form-urlencoded" },
          body: "SAMLResponse=PHNhbWxwOlJlc3BvbnNlLz4%3D&RelayState=%2F",
          signal: AbortSignal.timeout(5000),
        });
      const multipart = (path: string) => {
        const fd = new FormData();
        fd.append("x", "1");
        return fetch(url(path), { method: "POST", headers: { origin: "http://evil.example" }, body: fd, signal: AbortSignal.timeout(5000) });
      };
      const json = (path: string) =>
        fetch(url(path), {
          method: "POST",
          headers: { origin: "http://evil.example", "content-type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(5000),
        });

      // ACS — every variant Express routes to the ACS handler gets through; others never reach it.
      for (const p of ["/api/saml/acs", "/api/saml/ACS", "/api/saml/acs/"]) {
        const r = await form(p, IDP);
        expect(r.status, p).toBe(200);
        expect(await r.json()).toEqual({ ok: true, got: true });
      }
      expect(acsHits).toBe(3);
      for (const p of ["/api/saml/acs//", "/api/saml/acs/x"]) {
        expect((await form(p, IDP)).status, p).toBe(403);
      }
      expect(acsHits).toBe(3);

      // Sanity: the mixed-case path really reaches the tRPC handler when the origin is legitimate (no Origin header).
      const sane = await fetch(url("/API/trpc/doIt"), { method: "POST", body: "{}", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000) });
      expect(sane.status).toBe(200);
      expect(trpcHits).toBe(1);

      // R-5-b: a foreign Origin on any letter case is refused before the handler — JSON and multipart (CORS-simple).
      for (const p of ["/api/trpc/doIt", "/API/trpc/doIt", "/Api/Trpc/doIt", "/api/TRPC/doIt"]) {
        const j = await json(p);
        expect(j.status, `json ${p}`).toBe(403);
        expect(await j.json()).toMatchObject({ reason_code: "ORIGIN_MISMATCH" });
        expect((await multipart(p)).status, `multipart ${p}`).toBe(403);
      }
      expect(trpcHits).toBe(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
