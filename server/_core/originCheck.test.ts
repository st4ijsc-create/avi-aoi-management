/**
 * W0-I (doc 44 G5.7b) — originCheck: same-origin pass, cross-origin log/enforce,
 * đường API-key miễn kiểm tra, thiếu Origin/Referer pass (trade-off chuẩn).
 */
import { beforeEach, describe, expect, it } from "vitest";
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

// doc 81 Đợt 5 task G5 (item 21) — SAML POST binding: the IdP's browser form posts cross-site to the ACS, so under
// `enforce` the ACS was 403 ORIGIN_MISMATCH. Exempt is the EXACT path `/api/saml/acs` only (the signed assertion is
// the control there) — no prefix, no sibling, no sub-path. Measured through a real Express app on 127.0.0.1:0.
describe("G5 — /api/saml/acs exempt (exact path) under enforce", () => {
  const ENFORCE = { SEC_ORIGIN_CHECK_MODE: "enforce", NODE_ENV: "production" } as any;
  const IDP = "https://login.idp.example";

  it("evaluateOrigin: exact ACS path ⇒ exempt_path; siblings / sub-paths / look-alikes still checked", () => {
    const cfg = buildOriginCheckConfig(ENFORCE);
    const v = (path: string, origin = IDP) => evaluateOrigin(req({ path, headers: { host: "factory.local:3000", origin } }), cfg);
    expect(v("/api/saml/acs")).toEqual({ allowed: true, reason: "exempt_path" });
    expect(v("/api/saml/acs", "null")).toEqual({ allowed: true, reason: "exempt_path" }); // opaque origin from some IdP flows
    for (const p of ["/api/saml/acs/", "/api/saml/acs/x", "/api/saml/acsx", "/api/saml/login", "/api/saml/metadata", "/api/saml/", "/api/saml"]) {
      expect(v(p), p).toEqual({ allowed: false, reason: "origin_mismatch", origin: IDP });
    }
  });

  it("real Express app, enforce: IdP form POST to /api/saml/acs reaches the handler; cross-site POST elsewhere is 403", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(originCheckMiddleware(ENFORCE));
    app.use(express.urlencoded({ extended: false }));
    let acsHits = 0;
    app.post("/api/saml/acs", (r, s) => { acsHits++; s.status(200).json({ ok: true, got: Boolean((r.body as any)?.SAMLResponse) }); });
    app.post("/api/trpc/auth.logout", (_r, s) => s.status(200).json({ ok: true }));
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
    });
    try {
      const port = (server.address() as import("node:net").AddressInfo).port;
      const post = (path: string, origin: string) =>
        fetch(`http://127.0.0.1:${port}${path}`, {
          method: "POST",
          headers: { origin, "content-type": "application/x-www-form-urlencoded" },
          body: "SAMLResponse=PHNhbWxwOlJlc3BvbnNlLz4%3D&RelayState=%2F",
          signal: AbortSignal.timeout(5000),
        });
      const acs = await post("/api/saml/acs", IDP);
      expect(acs.status).toBe(200);
      expect(await acs.json()).toEqual({ ok: true, got: true });
      expect(acsHits).toBe(1);

      const other = await post("/api/trpc/auth.logout", IDP);
      expect(other.status).toBe(403);
      expect(await other.json()).toMatchObject({ reason_code: "ORIGIN_MISMATCH" });

      // trailing-slash variant (Express routes it to the same handler) is NOT exempt — exact path only.
      const slash = await post("/api/saml/acs/", IDP);
      expect(slash.status).toBe(403);
      expect(acsHits).toBe(1);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});
