/**
 * W6-B (doc 27 Đợt 6, MB7) — FactoryAlertSystem APK download-token tests.
 *
 * Covers the pure token module used by /api/factory-alert/version.json (mint)
 * and /api/factory-alert/download/:version/:filename (verify):
 *   • mint → verify round-trip for the same version/filename;
 *   • binding: token for one version/filename is rejected for another;
 *   • expiry: valid inside TTL, rejected after TTL (and default TTL = 15 min);
 *   • tamper: modified signature / malformed / missing tokens rejected;
 *   • open-flag fallback: FACTORY_ALERT_DOWNLOAD_OPEN default true, "false"/"0"
 *     disable legacy token-less downloads.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mintDownloadToken,
  verifyDownloadToken,
  isDownloadOpen,
  tokenTtlSeconds,
} from "./factoryAlertDownloadToken";

const ENV_KEYS = [
  "FACTORY_ALERT_DOWNLOAD_SECRET",
  "FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS",
  "FACTORY_ALERT_DOWNLOAD_OPEN",
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.FACTORY_ALERT_DOWNLOAD_SECRET = "test-secret-for-download-token";
  delete process.env.FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS;
  delete process.env.FACTORY_ALERT_DOWNLOAD_OPEN;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("factoryAlertDownloadToken", () => {
  const VERSION = "1.0.16";
  const FILE = "FactoryAlertSystem-v1.0.16-release.apk";

  it("mint → verify round-trip succeeds for the same version/filename", () => {
    const token = mintDownloadToken(VERSION, FILE);
    expect(verifyDownloadToken(token, VERSION, FILE)).toEqual({ ok: true });
  });

  it("token format is v1.<exp>.<hex hmac>", () => {
    const now = 1_800_000_000_000; // fixed ms
    const token = mintDownloadToken(VERSION, FILE, now);
    const parts = token.split(".");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("v1");
    expect(Number(parts[1])).toBe(Math.floor(now / 1000) + tokenTtlSeconds());
    expect(parts[2]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is bound to version AND filename", () => {
    const token = mintDownloadToken(VERSION, FILE);
    expect(verifyDownloadToken(token, "1.0.15", FILE).ok).toBe(false);
    expect(verifyDownloadToken(token, VERSION, "other.apk").ok).toBe(false);
  });

  it("default TTL is 15 minutes; token expires after TTL", () => {
    expect(tokenTtlSeconds()).toBe(900);
    const t0 = Date.now();
    const token = mintDownloadToken(VERSION, FILE, t0);
    // still valid 1s before expiry
    expect(verifyDownloadToken(token, VERSION, FILE, t0 + 899_000).ok).toBe(true);
    // rejected 1s after expiry
    const late = verifyDownloadToken(token, VERSION, FILE, t0 + 901_000);
    expect(late.ok).toBe(false);
    expect(late.reason).toBe("expired");
  });

  it("respects FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS (clamped to ≥60)", () => {
    process.env.FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS = "120";
    expect(tokenTtlSeconds()).toBe(120);
    process.env.FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS = "5"; // below floor
    expect(tokenTtlSeconds()).toBe(60);
    process.env.FACTORY_ALERT_DOWNLOAD_TOKEN_TTL_SECONDS = "not-a-number";
    expect(tokenTtlSeconds()).toBe(900);
  });

  it("rejects tampered signatures", () => {
    const token = mintDownloadToken(VERSION, FILE);
    const parts = token.split(".");
    const flipped = parts[2][0] === "a" ? "b" : "a";
    const tampered = `${parts[0]}.${parts[1]}.${flipped}${parts[2].slice(1)}`;
    const result = verifyDownloadToken(tampered, VERSION, FILE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad-signature");
  });

  it("rejects tampered expiry (exp changed without re-signing)", () => {
    const token = mintDownloadToken(VERSION, FILE);
    const parts = token.split(".");
    const extended = `${parts[0]}.${Number(parts[1]) + 3600}.${parts[2]}`;
    expect(verifyDownloadToken(extended, VERSION, FILE).ok).toBe(false);
  });

  it("rejects missing / malformed tokens", () => {
    expect(verifyDownloadToken(undefined, VERSION, FILE)).toEqual({ ok: false, reason: "missing" });
    expect(verifyDownloadToken("", VERSION, FILE).ok).toBe(false);
    expect(verifyDownloadToken("v1.notanumber.deadbeef", VERSION, FILE).reason).toBe("malformed");
    expect(verifyDownloadToken("v2.123.deadbeef", VERSION, FILE).reason).toBe("malformed");
    expect(verifyDownloadToken("just-garbage", VERSION, FILE).reason).toBe("malformed");
  });

  it("tokens minted with a different secret do not verify", () => {
    const token = mintDownloadToken(VERSION, FILE);
    process.env.FACTORY_ALERT_DOWNLOAD_SECRET = "a-completely-different-secret";
    expect(verifyDownloadToken(token, VERSION, FILE).ok).toBe(false);
  });

  describe("isDownloadOpen (legacy token-less fallback flag)", () => {
    it("defaults to true (open) when env is unset — current fleet-migration mode", () => {
      delete process.env.FACTORY_ALERT_DOWNLOAD_OPEN;
      expect(isDownloadOpen()).toBe(true);
    });

    it('is open for explicit "true"', () => {
      process.env.FACTORY_ALERT_DOWNLOAD_OPEN = "true";
      expect(isDownloadOpen()).toBe(true);
    });

    it('enforces auth for "false" and "0"', () => {
      process.env.FACTORY_ALERT_DOWNLOAD_OPEN = "false";
      expect(isDownloadOpen()).toBe(false);
      process.env.FACTORY_ALERT_DOWNLOAD_OPEN = "0";
      expect(isDownloadOpen()).toBe(false);
    });
  });
});
