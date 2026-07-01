/**
 * U1 (doc 21 §6) — Unified Event Backbone tests.
 *
 * Covers, without a DB:
 *   • each new domain event is published on the right trigger (publish helpers →
 *     eventBus), fire-and-forget + error-isolated (a throwing subscriber / bad
 *     payload never breaks the caller);
 *   • the eventBus→normalized envelope mapping (toEcosystemEvent) for legacy + new
 *     event names, incl. alert-class classification + scope extraction;
 *   • the orphaned/new-event subscribers fire and gate their OUTBOUND side-effects
 *     behind ECOSYSTEM_EVENTS_ENABLED (webhook + KB mocked) — off by default.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus, EventTypes } from "../../_core/eventBus";
import {
  publishTaskEvent,
  publishWorkOrderCreated,
  publishAnomalyDetected,
  publishProgramDeployed,
  toEcosystemEvent,
  isAlertKind,
  ecosystemEventsEnabled,
  installEcosystemEventBridge,
  uninstallEcosystemEventBridge,
  EcosystemEventTypes,
} from "./ecosystemEvents";

// Mock the two OUTBOUND sinks so we can assert they are (not) called under the flag.
const webhookEmit = vi.fn(async () => {});
const kbIngest = vi.fn(() => {});
vi.mock("../../api/v1/webhookBridge", () => ({ emit: (...a: unknown[]) => webhookEmit(...a) }));
vi.mock("../aiLocalKnowledgeService", () => ({ ingestKnowledgeRecordAsync: (...a: unknown[]) => kbIngest(...a) }));

function capture(type: string): { calls: any[] } {
  const calls: any[] = [];
  const unsub = eventBus.subscribe(type, (e) => calls.push(e));
  // return a live handle; tests unsub via afterEach reset of the bus subscription
  (calls as any).__unsub = unsub;
  return { calls };
}

describe("U1 publish helpers → eventBus (right trigger, error-isolated)", () => {
  it("publishTaskEvent maps assigned/completed/failed to the right event names", () => {
    const a = capture("task.assigned");
    const c = capture("task.completed");
    const f = capture("task.failed");
    publishTaskEvent("assigned", { taskId: 1, status: "assigned", assignedDeviceId: 9 });
    publishTaskEvent("completed", { taskId: 1, status: "completed" });
    publishTaskEvent("failed", { taskId: 1, status: "failed", error: "boom" });
    expect(a.calls).toHaveLength(1);
    expect(c.calls).toHaveLength(1);
    expect(f.calls).toHaveLength(1);
    expect(a.calls[0].payload.assignedDeviceId).toBe(9);
    (a.calls as any).__unsub(); (c.calls as any).__unsub(); (f.calls as any).__unsub();
  });

  it("publishWorkOrderCreated / publishAnomalyDetected / publishProgramDeployed fire", () => {
    const wo = capture(EcosystemEventTypes.WORKORDER_CREATED);
    const an = capture(EcosystemEventTypes.ANOMALY_DETECTED);
    const pd = capture(EcosystemEventTypes.PROGRAM_DEPLOYED);
    publishWorkOrderCreated({ workOrderNumber: "WO-1", machineId: 3, type: "PREDICTIVE" });
    publishAnomalyDetected({ kind: "drift", severity: "high", source: "robot", robotId: 2 });
    publishProgramDeployed({ deploymentId: 5, buildId: 4, stage: "staging", status: "simulated", simulated: true });
    expect(wo.calls).toHaveLength(1);
    expect(an.calls).toHaveLength(1);
    expect(pd.calls).toHaveLength(1);
    (wo.calls as any).__unsub(); (an.calls as any).__unsub(); (pd.calls as any).__unsub();
  });

  it("a THROWING subscriber does not break the publisher (fault isolation)", () => {
    const unsub = eventBus.subscribe("task.assigned", () => { throw new Error("subscriber blew up"); });
    expect(() => publishTaskEvent("assigned", { taskId: 7, status: "assigned" })).not.toThrow();
    unsub();
  });
});

describe("U1 toEcosystemEvent — normalized envelope mapping", () => {
  const mk = (type: string, payload: Record<string, unknown>) => ({ type, payload, ts: 1_700_000_000_000, source: "test" });

  it("maps legacy safety.event → kind=safety (alert) with severity by near-miss", () => {
    const near = toEcosystemEvent(mk(EventTypes.SAFETY_EVENT, { eventType: "intrusion", isNearMiss: true, lineId: 4 }))!;
    expect(near.kind).toBe("safety");
    expect(near.severity).toBe("high");
    expect(near.scope.lineId).toBe(4);
    expect(isAlertKind(near.kind)).toBe(true);
    const hard = toEcosystemEvent(mk(EventTypes.SAFETY_EVENT, { eventType: "estop", isNearMiss: false }))!;
    expect(hard.severity).toBe("critical");
  });

  it("maps quality_gate.breach → kind=quality_gate, stop→critical", () => {
    const evt = toEcosystemEvent(mk("quality_gate.breach", { gateName: "G", action: "stop", machineId: 8 }))!;
    expect(evt.kind).toBe("quality_gate");
    expect(evt.severity).toBe("critical");
    expect(evt.scope.machineId).toBe(8);
  });

  it("maps the new task/workorder/anomaly/program events", () => {
    expect(toEcosystemEvent(mk("task.failed", { taskId: 1, status: "failed" }))!.kind).toBe("task");
    expect(toEcosystemEvent(mk("workorder.created", { workOrderNumber: "W", type: "PREDICTIVE" }))!.kind).toBe("workorder");
    expect(toEcosystemEvent(mk("anomaly.detected", { kind: "drift", severity: "critical" }))!.severity).toBe("critical");
    expect(toEcosystemEvent(mk("program.deployed", { deploymentId: 1, status: "deployed" }))!.kind).toBe("program");
  });

  it("returns null for bus-internal events (not surfaced to the client)", () => {
    expect(toEcosystemEvent(mk("orchestration.triggered", { rule: "x" }))).toBeNull();
    expect(toEcosystemEvent(mk("ai.insight", { id: 1 }))).toBeNull();
  });

  it("classifies alert-kinds vs non-alert", () => {
    expect(isAlertKind("safety")).toBe(true);
    expect(isAlertKind("anomaly")).toBe(true);
    expect(isAlertKind("oee")).toBe(false);
    expect(isAlertKind("program")).toBe(false);
  });
});

describe("U1 outbound bridge — subscribers fire, gated by ECOSYSTEM_EVENTS_ENABLED", () => {
  const prev = process.env.ECOSYSTEM_EVENTS_ENABLED;
  beforeEach(() => { webhookEmit.mockClear(); kbIngest.mockClear(); uninstallEcosystemEventBridge(); });
  afterEach(() => { uninstallEcosystemEventBridge(); process.env.ECOSYSTEM_EVENTS_ENABLED = prev; });

  it("flag OFF → NO outbound side-effect (webhook/KB not called)", async () => {
    process.env.ECOSYSTEM_EVENTS_ENABLED = "false";
    expect(ecosystemEventsEnabled()).toBe(false);
    installEcosystemEventBridge();
    publishAnomalyDetected({ kind: "drift", severity: "high", source: "robot", robotId: 1 });
    eventBus.publish(EventTypes.SAFETY_EVENT, { eventType: "estop", isNearMiss: false }, "test");
    await new Promise((r) => setTimeout(r, 20));
    expect(webhookEmit).not.toHaveBeenCalled();
    expect(kbIngest).not.toHaveBeenCalled();
  });

  it("flag ON → orphaned + new events fan out to webhook + KB (significant kinds)", async () => {
    process.env.ECOSYSTEM_EVENTS_ENABLED = "true";
    expect(ecosystemEventsEnabled()).toBe(true);
    installEcosystemEventBridge();
    // safety (significant → webhook + KB)
    eventBus.publish(EventTypes.SAFETY_EVENT, { eventType: "near_miss", isNearMiss: true, lineId: 2 }, "test");
    // workorder (significant → webhook + KB)
    publishWorkOrderCreated({ workOrderNumber: "WO-9", machineId: 5, type: "PREDICTIVE" });
    await new Promise((r) => setTimeout(r, 20));
    expect(webhookEmit).toHaveBeenCalled();
    // webhook public name is `ecosystem.<kind>`
    const names = webhookEmit.mock.calls.map((c: any[]) => c[0]);
    expect(names).toContain("ecosystem.safety");
    expect(names).toContain("ecosystem.workorder");
    expect(kbIngest).toHaveBeenCalled();
  });

  it("install is idempotent (double install → single delivery)", async () => {
    process.env.ECOSYSTEM_EVENTS_ENABLED = "true";
    installEcosystemEventBridge();
    installEcosystemEventBridge();
    eventBus.publish("quality_gate.breach", { gateName: "G", action: "alert", machineId: 1 }, "test");
    await new Promise((r) => setTimeout(r, 20));
    // quality_gate is a significant KB kind AND a webhook kind → one delivery each
    expect(webhookEmit).toHaveBeenCalledTimes(1);
  });
});
