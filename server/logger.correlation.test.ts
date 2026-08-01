/**
 * doc 44 W6-4 (G5.17) — pino correlation mixin.
 *
 * The mixin must stamp `correlation_id` on log records ONLY when a withCorrelation(...)
 * context is active, and add nothing outside one (so ambient logs are unchanged).
 */
import { describe, it, expect, beforeAll } from "vitest";

let correlationMixin: () => Record<string, string>;
let withCorrelation: <T>(ctx: { correlationId?: string }, fn: () => T) => T;
let newCorrelationId: () => string;

beforeAll(async () => {
  // Force JSON logging so importing logger.ts does not spawn a pino-pretty transport worker.
  process.env.LOG_JSON = "1";
  ({ correlationMixin } = await import("./logger"));
  ({ withCorrelation, newCorrelationId } = await import("./services/observability/correlation"));
});

describe("G5.17 — pino correlation mixin", () => {
  it("returns {} outside any correlation context", () => {
    expect(correlationMixin()).toEqual({});
  });

  it("attaches correlation_id inside a withCorrelation context", () => {
    const id = newCorrelationId();
    withCorrelation({ correlationId: id }, () => {
      expect(correlationMixin()).toEqual({ correlation_id: id });
    });
    // and returns to empty once the context unwinds
    expect(correlationMixin()).toEqual({});
  });
});
