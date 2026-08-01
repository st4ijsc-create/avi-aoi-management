/**
 * Unit tests for rate limit env-driven configuration
 */
import { describe, it, expect } from "vitest";
import {
  API_RATE_LIMIT,
  AUTH_RATE_LIMIT,
  OT_INGEST_RATE_LIMIT,
  OT_INGEST_PATHS,
  isOtIngestRequest,
  createApiLimiter,
  createOtIngestLimiter,
} from "./rateLimitConfig";

describe("rateLimitConfig", () => {
  it("has positive request limit", () => {
    expect(API_RATE_LIMIT.max).toBeGreaterThan(0);
  });

  it("has positive auth limit", () => {
    expect(AUTH_RATE_LIMIT.max).toBeGreaterThan(0);
  });

  it("uses 1-minute API window", () => {
    expect(API_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("uses 15-minute auth window", () => {
    expect(AUTH_RATE_LIMIT.windowMs).toBe(15 * 60_000);
  });
});

// doc 48 R3 — the machine telemetry ingest path rides a DEDICATED high tier and is
// exempt from the 300/60 browser limiter, keyed per machine (not per browser IP).
describe("OT machine-ingest tier (doc 48 R3)", () => {
  const reqOf = (originalUrl: string) => ({ originalUrl, url: originalUrl }) as any;

  it("uses a much higher max than the browser /api tier", () => {
    expect(OT_INGEST_RATE_LIMIT.max).toBeGreaterThan(API_RATE_LIMIT.max);
    // default is high (300k/min) so a legitimate high-rate gateway is un-throttled
    expect(OT_INGEST_RATE_LIMIT.max).toBeGreaterThanOrEqual(100_000);
  });

  it("stays FINITE — default-safe (a runaway client is still capped, never unlimited)", () => {
    expect(Number.isFinite(OT_INGEST_RATE_LIMIT.max)).toBe(true);
    expect(OT_INGEST_RATE_LIMIT.max).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it("uses a 1-minute window", () => {
    expect(OT_INGEST_RATE_LIMIT.windowMs).toBe(60_000);
  });

  it("matches ONLY the ingest path (query-string + subpath safe)", () => {
    for (const base of OT_INGEST_PATHS) {
      expect(isOtIngestRequest(reqOf(base))).toBe(true);
      expect(isOtIngestRequest(reqOf(base + "?marker=x"))).toBe(true);
      expect(isOtIngestRequest(reqOf(base + "/batch"))).toBe(true);
    }
  });

  it("does NOT match the general browser API / tRPC surface", () => {
    expect(isOtIngestRequest(reqOf("/api/ping"))).toBe(false);
    expect(isOtIngestRequest(reqOf("/api/machine/heartbeat"))).toBe(false);
    expect(isOtIngestRequest(reqOf("/api/ot/telemetry/recent"))).toBe(false);
    expect(isOtIngestRequest(reqOf("/api/ot/ingestXYZ"))).toBe(false); // no prefix false-positive
    expect(isOtIngestRequest(reqOf("/trpc/machine.list"))).toBe(false);
  });

  it("the general /api browser tier is UNCHANGED (still a 1-minute window) and skips ingest", () => {
    // The general browser limiter's window/policy is not altered by the ingest tier.
    expect(API_RATE_LIMIT.windowMs).toBe(60_000);
    const limiter = createApiLimiter();
    expect(typeof limiter).toBe("function");
    // The exemption applies ONLY to the ingest path — every other /api path is limited.
    expect(isOtIngestRequest(reqOf("/api/ot/ingest"))).toBe(true);
    expect(isOtIngestRequest(reqOf("/api/anything-else"))).toBe(false);
  });

  it("constructs the dedicated ingest limiter", () => {
    expect(typeof createOtIngestLimiter()).toBe("function");
  });
});
