/**
 * Unit tests for rate limit env-driven configuration
 */
import { describe, it, expect } from "vitest";
import { API_RATE_LIMIT, AUTH_RATE_LIMIT } from "./rateLimitConfig";

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
