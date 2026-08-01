/**
 * W0-I (doc 44 G5.7a) — securityHeaders: CSP mode off/report-only/enforce,
 * safe headers (Permissions-Policy không khoá camera/mic), CSP report endpoint.
 */
import express from "express";
import type { AddressInfo } from "net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CSP_REPORT_PATH,
  _resetCspReportCounters,
  buildCspDirectives,
  buildCspHeaderValue,
  getCspMode,
  getCspReportCount,
  registerCspReportEndpoint,
  securityHeadersMiddleware,
} from "./securityHeaders";

function fakeRes() {
  const headers = new Map<string, string>();
  return {
    headers,
    setHeader: (k: string, v: string) => { headers.set(k.toLowerCase(), v); },
    getHeader: (k: string) => headers.get(k.toLowerCase()),
  } as any;
}

const fakeReq = {} as any;

describe("getCspMode", () => {
  it("defaults to off (không có env / env rác)", () => {
    expect(getCspMode({} as any)).toBe("off");
    expect(getCspMode({ SEC_CSP_MODE: "banana" } as any)).toBe("off");
    expect(getCspMode({ SEC_CSP_MODE: "" } as any)).toBe("off");
  });
  it("nhận report-only + enforce (case-insensitive)", () => {
    expect(getCspMode({ SEC_CSP_MODE: "report-only" } as any)).toBe("report-only");
    expect(getCspMode({ SEC_CSP_MODE: "ENFORCE" } as any)).toBe("enforce");
  });
});

describe("buildCspDirectives", () => {
  const d = buildCspDirectives();

  it("khớp app thật: inline script index.html + WASM + Google Fonts + ws + worker blob", () => {
    expect(d["default-src"]).toEqual(["'self'"]);
    expect(d["script-src"]).toContain("'unsafe-inline'"); // index.html inline suppressor
    expect(d["script-src"]).toContain("'wasm-unsafe-eval'"); // Rapier physics
    expect(d["style-src"]).toContain("https://fonts.googleapis.com");
    expect(d["font-src"]).toContain("https://fonts.gstatic.com");
    expect(d["connect-src"]).toEqual(expect.arrayContaining(["'self'", "ws:", "wss:"]));
    expect(d["worker-src"]).toEqual(["'self'", "blob:"]);
    expect(d["img-src"]).toEqual(expect.arrayContaining(["data:", "blob:"]));
    expect(d["frame-ancestors"]).toEqual(["'self'"]);
    expect(d["report-uri"]).toEqual([CSP_REPORT_PATH]);
  });

  it("reportUri: false bỏ report-uri", () => {
    expect(buildCspDirectives({ reportUri: false })["report-uri"]).toBeUndefined();
  });

  it("header value là chuỗi directive ; -separated", () => {
    const v = buildCspHeaderValue();
    expect(v).toContain("default-src 'self'");
    expect(v).toContain(`report-uri ${CSP_REPORT_PATH}`);
  });
});

describe("securityHeadersMiddleware", () => {
  it("mode off (default): KHÔNG phát header CSP nào — hành vi cũ giữ nguyên", () => {
    const mw = securityHeadersMiddleware({} as any);
    const res = fakeRes();
    let nexted = false;
    mw(fakeReq, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(res.getHeader("Content-Security-Policy")).toBeUndefined();
    expect(res.getHeader("Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("mode report-only: phát Report-Only + report-uri, KHÔNG phát header enforce", () => {
    const mw = securityHeadersMiddleware({ SEC_CSP_MODE: "report-only" } as any);
    const res = fakeRes();
    mw(fakeReq, res, () => {});
    const v = res.getHeader("Content-Security-Policy-Report-Only");
    expect(v).toContain("default-src 'self'");
    expect(v).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(res.getHeader("Content-Security-Policy")).toBeUndefined();
  });

  it("mode enforce: phát Content-Security-Policy thật", () => {
    const mw = securityHeadersMiddleware({ SEC_CSP_MODE: "enforce" } as any);
    const res = fakeRes();
    mw(fakeReq, res, () => {});
    expect(res.getHeader("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.getHeader("Content-Security-Policy-Report-Only")).toBeUndefined();
  });

  it("safe headers: Permissions-Policy chỉ khoá geolocation — KHÔNG khoá camera/mic (QuickScan + voice)", () => {
    const mw = securityHeadersMiddleware({} as any);
    const res = fakeRes();
    mw(fakeReq, res, () => {});
    const pp = String(res.getHeader("Permissions-Policy"));
    expect(pp).toContain("geolocation=()");
    expect(pp).not.toContain("camera");
    expect(pp).not.toContain("microphone");
    expect(res.getHeader("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.getHeader("X-Content-Type-Options")).toBe("nosniff");
  });

  it("KHÔNG ghi đè header helmet đã set (Referrer-Policy: no-referrer giữ nguyên)", () => {
    const mw = securityHeadersMiddleware({} as any);
    const res = fakeRes();
    res.setHeader("Referrer-Policy", "no-referrer"); // helmet default đứng trước
    res.setHeader("X-Content-Type-Options", "nosniff");
    mw(fakeReq, res, () => {});
    expect(res.getHeader("Referrer-Policy")).toBe("no-referrer");
  });
});

describe(`POST ${CSP_REPORT_PATH}`, () => {
  let server: ReturnType<express.Express["listen"]>;
  let base: string;

  beforeEach(async () => {
    _resetCspReportCounters();
    const app = express();
    registerCspReportEndpoint(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("nhận application/csp-report → 204 + đếm report", async () => {
    const res = await fetch(base + CSP_REPORT_PATH, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "violated-directive": "script-src",
          "blocked-uri": "https://evil.example/x.js",
          "document-uri": "http://factory/products",
        },
      }),
    });
    expect(res.status).toBe(204);
    expect(getCspReportCount()).toBe(1);
  });

  it("body rác vẫn 204 (không bao giờ 500 vì report hỏng)", async () => {
    const res = await fetch(base + CSP_REPORT_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(204);
  });
});
