/**
 * Orchestration rules engine (Phase 2 WS2.3) — minimal, safe, flag-gated.
 *
 * Subscribes to the unified event bus (Phase 2 WS2.2) and reacts to cross-module
 * domain events with SAFE actions: persist an audit record, optionally notify a
 * configured set of users, and re-publish an `orchestration.triggered` event so
 * other consumers can chain off it.
 *
 * ⚠️ SAFETY BOUNDARY: this engine performs NOTIFY / AUDIT only. It MUST NOT issue
 * device-control commands. Any control action (stop line, block downstream, …)
 * goes exclusively through the HITL/interlock commandDispatcher, which keeps its
 * approval + idempotency + read-back guarantees. Orchestration may, at most,
 * surface a *proposal* for a human to confirm there.
 *
 * Enable with ORCHESTRATION_ENABLED=true (default off → no subscriptions, no cost).
 * Built-in rules:
 *  - NG burst: ≥ ORCH_NG_THRESHOLD (default 5) NG alerts for one machine within
 *    ORCH_NG_WINDOW_MS (default 300000) → audit + notify + republish.
 *  - SPC critical: a 'critical' SPC violation → audit + notify + republish.
 */
import { eventBus, EventTypes, type DomainEvent } from "../../_core/eventBus";

let enabled = false;
const unsubscribers: Array<() => void> = [];

// Per-machine sliding window of NG timestamps (epoch ms).
const ngWindows = new Map<string, number[]>();

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

async function audit(action: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    const { logCrudOperation } = await import("../auditTrailService");
    void logCrudOperation(
      { userId: null, source: "orchestration" },
      {
        action,
        entityType: "orchestration",
        details: { operation: "rule", metadata },
        status: "success",
      },
    );
  } catch {
    /* auditing must never break orchestration */
  }
}

async function notifyConfigured(title: string, message: string): Promise<void> {
  const ids = (process.env.ORCH_NOTIFY_USER_IDS ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
  if (ids.length === 0) return;
  try {
    const { sendSystemNotification } = await import("../notificationService");
    for (const id of ids) {
      await sendSystemNotification(id, { title, message, priority: "HIGH" });
    }
  } catch {
    /* notification best-effort */
  }
}

function onNgAlert(e: DomainEvent): void {
  const p = (e.payload ?? {}) as { machineCode?: string; machineId?: number };
  const key = String(p.machineCode ?? p.machineId ?? "unknown");
  const windowMs = envInt("ORCH_NG_WINDOW_MS", 300_000);
  const threshold = envInt("ORCH_NG_THRESHOLD", 5);

  const arr = (ngWindows.get(key) ?? []).filter((t) => e.ts - t <= windowMs);
  arr.push(e.ts);
  ngWindows.set(key, arr);

  if (arr.length >= threshold) {
    ngWindows.set(key, []); // reset after firing to avoid alert spam
    const message = `NG burst: ${arr.length} NG trong ${Math.round(windowMs / 60000)} phút tại máy ${key}`;
    console.warn(`[Orchestration] ${message}`);
    void audit("orchestration.ng_burst", { machine: key, count: arr.length, windowMs });
    void notifyConfigured("NG burst detected", message);
    eventBus.publish("orchestration.triggered", { rule: "ng_burst", machine: key, count: arr.length }, "orchestration");
  }
}

function onSpcViolation(e: DomainEvent): void {
  const p = (e.payload ?? {}) as { severity?: string; ruleName?: string; machineCode?: string };
  if (p.severity !== "critical") return;
  const message = `SPC critical: ${p.ruleName ?? "rule"} tại ${p.machineCode ?? "?"}`;
  console.warn(`[Orchestration] ${message}`);
  void audit("orchestration.spc_critical", { rule: p.ruleName, machine: p.machineCode });
  void notifyConfigured("SPC critical violation", message);
  eventBus.publish("orchestration.triggered", { rule: "spc_critical", machine: p.machineCode }, "orchestration");
}

// U1-b — ADVISORY triggers for the new/orphaned events. NOTIFY/AUDIT only; each
// re-publishes `orchestration.triggered` so the aiWatcher can generate an advisory.
// NEVER an autonomous device command — the HITL invariant is preserved.
function onAnomalyDetected(e: DomainEvent): void {
  const p = (e.payload ?? {}) as { kind?: string; severity?: string; robotId?: number; machineId?: number };
  // Only escalate the significant bands so we don't spam the single inference slot.
  if (p.severity !== "high" && p.severity !== "critical") return;
  const machine = String(p.machineId ?? (p.robotId != null ? `robot:${p.robotId}` : "unknown"));
  const message = `Anomaly (${p.severity}): ${p.kind ?? "?"} at ${machine}`;
  console.warn(`[Orchestration] ${message}`);
  void audit("orchestration.anomaly", { kind: p.kind, severity: p.severity, machine });
  void notifyConfigured("Anomaly detected", message);
  eventBus.publish("orchestration.triggered", { rule: "anomaly", machine, kind: p.kind }, "orchestration");
}

function onSafetyEvent(e: DomainEvent): void {
  const p = (e.payload ?? {}) as { eventType?: string; isNearMiss?: boolean; robotId?: number; lineId?: number };
  const machine = String(p.robotId != null ? `robot:${p.robotId}` : p.lineId != null ? `line:${p.lineId}` : "unknown");
  const message = `Safety ${p.isNearMiss ? "near-miss" : "event"}: ${p.eventType ?? "?"} at ${machine}`;
  console.warn(`[Orchestration] ${message}`);
  void audit("orchestration.safety", { eventType: p.eventType, isNearMiss: p.isNearMiss, machine });
  void notifyConfigured("Safety event", message);
  eventBus.publish("orchestration.triggered", { rule: "safety", machine, eventType: p.eventType }, "orchestration");
}

export function startOrchestration(): void {
  if (process.env.ORCHESTRATION_ENABLED !== "true") return; // safe default off
  if (enabled) return;
  enabled = true;
  unsubscribers.push(eventBus.subscribe(EventTypes.NG_ALERT, onNgAlert));
  unsubscribers.push(eventBus.subscribe(EventTypes.SPC_VIOLATION, onSpcViolation));
  // U1-b — new/orphaned advisory triggers (anomaly + safety). NOTIFY/AUDIT only.
  unsubscribers.push(eventBus.subscribe(EventTypes.SAFETY_EVENT, onSafetyEvent));
  unsubscribers.push(eventBus.subscribe("anomaly.detected", onAnomalyDetected));
  console.log("[Orchestration] rules engine started (NG burst, SPC critical, anomaly, safety)");
}

export function stopOrchestration(): void {
  for (const u of unsubscribers) {
    try {
      u();
    } catch {
      /* ignore */
    }
  }
  unsubscribers.length = 0;
  ngWindows.clear();
  enabled = false;
}
