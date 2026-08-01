/**
 * W4 persistence wiring tests — SYNAPSE §5.12.1/§5.1.2 (doc 33 W4).
 * The DB writes are covered by the app DB-integration suite; here we test the sink mechanism
 * and the FOE_DURABLE gate (both pure, no DB).
 */
import { describe, it, expect, afterEach } from "vitest";

import { recordDecision, setDecisionSink, _clearDecisionTraces, type DecisionTrace } from "./decisionTrace";
import { appendRunEvent } from "../orchestration/runEventStore";

afterEach(() => {
  setDecisionSink(null);
  _clearDecisionTraces();
});

describe("decision-trace sink", () => {
  it("a registered sink receives every recorded trace", () => {
    const got: DecisionTrace[] = [];
    setDecisionSink((t) => got.push(t));
    recordDecision({ decisionType: "task-allocation", subject: "task-1", chosen: "robotA", candidates: [], version: "v1", ts: 1 });
    expect(got).toHaveLength(1);
    expect(got[0].subject).toBe("task-1");
  });

  it("a throwing sink NEVER affects recordDecision (best-effort)", () => {
    setDecisionSink(() => {
      throw new Error("db down");
    });
    expect(() => recordDecision({ decisionType: "d", subject: "s", chosen: null, candidates: [], version: "v", ts: 1 })).not.toThrow();
  });
});

describe("runEventStore gate", () => {
  const prev = process.env.FOE_DURABLE;
  afterEach(() => {
    if (prev === undefined) delete process.env.FOE_DURABLE;
    else process.env.FOE_DURABLE = prev;
  });

  it("appendRunEvent is a no-op (no DB touch) when FOE_DURABLE off", async () => {
    delete process.env.FOE_DURABLE;
    await expect(appendRunEvent(1, "RUN_CREATED", { ts: 1 })).resolves.toBeUndefined();
  });
});
