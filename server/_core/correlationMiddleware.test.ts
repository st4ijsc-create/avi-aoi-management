/**
 * doc 44 W6-4 (G5.17) — correlation header ingest (x-correlation-id → traceparent).
 */
import { describe, it, expect } from "vitest";
import { readIncomingCorrelationId } from "./correlationMiddleware";

describe("G5.17 — readIncomingCorrelationId", () => {
  it("prefers a valid x-correlation-id header", () => {
    expect(readIncomingCorrelationId({ "x-correlation-id": "abc-123_ID" })).toBe("abc-123_ID");
  });

  it("extracts the trace-id from a W3C traceparent when no x-correlation-id", () => {
    const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";
    const tp = `00-${traceId}-00f067aa0ba902b7-01`;
    expect(readIncomingCorrelationId({ traceparent: tp })).toBe(traceId);
  });

  it("returns undefined for a malformed traceparent", () => {
    expect(readIncomingCorrelationId({ traceparent: "not-a-traceparent" })).toBeUndefined();
  });

  it("returns undefined when no correlation headers are present", () => {
    expect(readIncomingCorrelationId({})).toBeUndefined();
  });

  it("rejects an over-long / unsafe x-correlation-id (falls through)", () => {
    expect(readIncomingCorrelationId({ "x-correlation-id": "x".repeat(200) })).toBeUndefined();
    expect(readIncomingCorrelationId({ "x-correlation-id": "bad value <script>" })).toBeUndefined();
  });
});
