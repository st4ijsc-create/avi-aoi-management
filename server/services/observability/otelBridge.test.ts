/**
 * OTel bridge tests — SYNAPSE §5.12.1 (doc 33 §11 · H2 completion).
 *
 * Without @opentelemetry/api installed (the default in this repo), the bridge is a SAFE no-op:
 * withSpan passes fn through, errors propagate, and emitDecisionSpan never throws — flag on or off.
 * (The end-to-end span/OTLP path is exercised only when an operator installs the OTel SDK + points
 * OTEL_EXPORTER_OTLP_ENDPOINT at a collector, which cannot run in unit tests.)
 */
import { describe, it, expect, afterEach } from "vitest";

import { withSpan, emitDecisionSpan } from "./otelBridge";
import type { DecisionTrace } from "./decisionTrace";

const prev = process.env.OBSERVABILITY;
afterEach(() => {
  if (prev === undefined) delete process.env.OBSERVABILITY;
  else process.env.OBSERVABILITY = prev;
});

const trace: DecisionTrace = {
  id: 1,
  decisionType: "task-allocation",
  subject: "task-7",
  chosen: "robot-3",
  candidates: [{ id: "robot-3", score: 100 }, { id: "robot-4", score: 50 }],
  version: "alloc-v1",
  correlationId: "corr-abc",
  ts: 1000,
};

describe("otelBridge (no-op safe by default)", () => {
  it("withSpan returns the fn result (passthrough) when the OTel API is absent", async () => {
    process.env.OBSERVABILITY = "true";
    expect(await withSpan("test.span", { correlationId: "c1" }, async () => 42)).toBe(42);
  });
  it("withSpan propagates fn errors", async () => {
    process.env.OBSERVABILITY = "true";
    await expect(withSpan("test.span", undefined, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  });
  it("emitDecisionSpan never throws, flag on or off", () => {
    process.env.OBSERVABILITY = "true";
    expect(() => emitDecisionSpan(trace)).not.toThrow();
    delete process.env.OBSERVABILITY;
    expect(() => emitDecisionSpan(trace)).not.toThrow();
  });
});
