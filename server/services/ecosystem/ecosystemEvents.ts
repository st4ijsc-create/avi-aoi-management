/**
 * U1 (doc 21 §6) — Unified Event Backbone.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The ONE place that:
 *   (1) defines the U1 event TAXONOMY — the new domain-event names produced by the
 *       previously-silo'd modules (fleet / PdM / anomaly / IR / twin) + a single
 *       NORMALIZED envelope (`EcosystemEvent`) that every event class maps onto;
 *   (2) offers small, TYPED, fire-and-forget PUBLISH helpers so producers never have
 *       to touch the raw eventBus (and can never throw into their own hot path);
 *   (3) installs the SUBSCRIBERS that make the orphaned + new events actually DO
 *       something — webhook fan-out + KB ingest — behind ONE flag (default OFF).
 *
 * DESIGN PRINCIPLES (kept from the audit):
 *   • ADDITIVE + backward-compatible: existing event names + subscribers are
 *     untouched. We only ADD new publishes + new subscribers.
 *   • FIRE-AND-FORGET: `eventBus.publish` already swallows subscriber errors; each
 *     publish helper additionally wraps its own body in try/catch so a malformed
 *     payload can never propagate into the producer.
 *   • NO CONTROL PATH: this backbone carries notifications/telemetry only. It NEVER
 *     issues a device command (that stays with the HITL/interlock dispatchers).
 *   • OUTBOUND side-effects (webhook POST / KB file writes) are gated:
 *       - webhook POST → WEBHOOKS_ENABLED (existing, default OFF)
 *       - KB ingest    → RAG_AUTO_INGEST_ENABLED (existing, default OFF)
 *       - the whole outbound bridge → ECOSYSTEM_EVENTS_ENABLED (new, default OFF)
 *     The IN-PROCESS wiring (bus publish + the socket re-broadcast) is always-on and
 *     harmless — no HTTP leaves the box and nothing is written unless a flag is set.
 *
 * Redis cross-instance fan-out is still NOT wired here (that is U6, not U1).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eventBus, EventTypes, type DomainEvent } from "../../_core/eventBus";
import { emit as webhookEmit } from "../../api/v1/webhookBridge";
import { ingestKnowledgeRecordAsync } from "../aiLocalKnowledgeService";

// ── U1 event taxonomy — the NEW domain-event names (string constants) ─────────
export const EcosystemEventTypes = {
  // fleet task lifecycle
  TASK_ASSIGNED: "task.assigned",
  TASK_COMPLETED: "task.completed",
  TASK_FAILED: "task.failed",
  // predictive maintenance
  WORKORDER_CREATED: "workorder.created",
  // anomaly (robot behaviour + image)
  ANOMALY_DETECTED: "anomaly.detected",
  // IR / programming
  PROGRAM_DEPLOYED: "program.deployed",
  // digital twin derived state (optional producer)
  TWIN_DERIVED: "twin.derived",
} as const;
export type EcosystemEventType = (typeof EcosystemEventTypes)[keyof typeof EcosystemEventTypes];

// ── Compact, typed payloads (kept small — no DB rows leak onto the bus) ────────
export interface TaskEventPayload {
  taskId: number;
  taskKey?: string | null;
  requiredCapability?: string | null;
  assignedDeviceId?: number | null;
  robotId?: number | null;
  status: "assigned" | "completed" | "failed";
  priority?: number | null;
  corporateCode?: string | null;
  factoryId?: number | null;
  error?: string | null;
}

export interface WorkOrderEventPayload {
  workOrderNumber: string;
  machineId: number;
  machineCode?: string | null;
  type: string; // e.g. "PREDICTIVE"
  priority?: number | null;
  failureRisk?: number | null;
  predictedTimeframe?: string | null;
}

export interface AnomalyEventPayload {
  kind: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  source: "robot" | "image";
  robotId?: number | null;
  machineId?: number | null;
  productModelId?: number | null;
  score?: number | null;
  confidence?: number | null;
  message?: string | null;
}

export interface ProgramDeployedPayload {
  deploymentId: number;
  projectId?: number | null;
  buildId: number;
  deviceId?: number | null;
  stage: string;
  status: string; // "deployed" | "simulated" | "rejected" | ...
  simulated: boolean;
  signedOffBy?: number | null;
}

export interface TwinDerivedPayload {
  factoryId?: number | null;
  lineId?: number | null;
  kind: "collision" | "occupancy" | string;
  detail?: Record<string, unknown> | null;
}

// ── Fire-and-forget publish helpers ───────────────────────────────────────────
// Each wraps eventBus.publish (already fault-isolated) in its own guard so a bad
// payload can never throw into the producer's transaction.

export function publishTaskEvent(kind: "assigned" | "completed" | "failed", payload: TaskEventPayload, source = "fleet"): void {
  try {
    const type =
      kind === "assigned"
        ? EcosystemEventTypes.TASK_ASSIGNED
        : kind === "completed"
          ? EcosystemEventTypes.TASK_COMPLETED
          : EcosystemEventTypes.TASK_FAILED;
    eventBus.publish(type, payload, source);
  } catch (err) {
    console.error(`[U1] publishTaskEvent(${kind}) failed:`, (err as Error)?.message ?? err);
  }
}

export function publishWorkOrderCreated(payload: WorkOrderEventPayload, source = "pdm"): void {
  try {
    eventBus.publish(EcosystemEventTypes.WORKORDER_CREATED, payload, source);
  } catch (err) {
    console.error("[U1] publishWorkOrderCreated failed:", (err as Error)?.message ?? err);
  }
}

export function publishAnomalyDetected(payload: AnomalyEventPayload, source = "ai"): void {
  try {
    eventBus.publish(EcosystemEventTypes.ANOMALY_DETECTED, payload, source);
  } catch (err) {
    console.error("[U1] publishAnomalyDetected failed:", (err as Error)?.message ?? err);
  }
}

export function publishProgramDeployed(payload: ProgramDeployedPayload, source = "programming"): void {
  try {
    eventBus.publish(EcosystemEventTypes.PROGRAM_DEPLOYED, payload, source);
  } catch (err) {
    console.error("[U1] publishProgramDeployed failed:", (err as Error)?.message ?? err);
  }
}

export function publishTwinDerived(payload: TwinDerivedPayload, source = "twin"): void {
  try {
    eventBus.publish(EcosystemEventTypes.TWIN_DERIVED, payload, source);
  } catch (err) {
    console.error("[U1] publishTwinDerived failed:", (err as Error)?.message ?? err);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZED ENVELOPE — the ONE shape the client stream (U1-c) + Command Center
// (U2) + cockpits (U3) consume. A compact, transport-friendly projection of any
// domain event, with a coarse `scope` for room routing + tenant isolation.
// ════════════════════════════════════════════════════════════════════════════
export type EcosystemSeverity = "info" | "low" | "medium" | "high" | "critical";
export type EcosystemKind =
  | "inspection"
  | "andon"
  | "safety"
  | "spc"
  | "quality_gate"
  | "escalation"
  | "maintenance"
  | "downtime"
  | "oee"
  | "task"
  | "workorder"
  | "anomaly"
  | "program"
  | "twin"
  | "ng"
  | "yield"
  | "event";

export interface EcosystemScope {
  siteCode?: string | null;
  factoryId?: number | null;
  machineId?: number | null;
  robotId?: number | null;
  lineId?: number | null;
}

export interface EcosystemEvent {
  id: string;
  ts: number;
  kind: EcosystemKind;
  severity: EcosystemSeverity;
  /** producer tag (eventBus `source`). */
  source: string;
  scope: EcosystemScope;
  title: string;
  detail?: Record<string, unknown>;
}

/** Kinds that count as an ALERT (routed to the filtered `alerts:stream`). */
const ALERT_KINDS: ReadonlySet<EcosystemKind> = new Set<EcosystemKind>([
  "inspection",
  "andon",
  "safety",
  "spc",
  "quality_gate",
  "escalation",
  "maintenance",
  "anomaly",
  "ng",
  "yield",
]);

export function isAlertKind(kind: EcosystemKind): boolean {
  return ALERT_KINDS.has(kind);
}

let seq = 0;
function nextId(ts: number): string {
  seq = (seq + 1) % 1_000_000;
  return `${ts.toString(36)}-${seq.toString(36)}`;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

/**
 * Map a raw DomainEvent (any of the ~8 legacy socket events OR a new U1 event)
 * into the normalized envelope. Returns null for event types we deliberately do
 * NOT surface on the unified stream (e.g. bus-internal `orchestration.triggered`).
 * PURE + defensive: unknown/partial payloads degrade to sensible defaults.
 */
export function toEcosystemEvent(e: DomainEvent): EcosystemEvent | null {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const base = { id: nextId(e.ts), ts: e.ts, source: e.source ?? "eventBus" };
  const scope: EcosystemScope = {
    siteCode: str(p.siteCode) ?? str(p.corporateCode),
    factoryId: num(p.factoryId),
    machineId: num(p.machineId),
    robotId: num(p.robotId),
    lineId: num(p.lineId),
  };

  switch (e.type) {
    // ── legacy socket events ────────────────────────────────────────────────
    case EventTypes.INSPECTION_ALERT: {
      const t = str(p.type);
      const kind: EcosystemKind = t === "NG_ALERT" ? "ng" : t === "YIELD_WARNING" ? "yield" : "inspection";
      return { ...base, kind, severity: kind === "ng" ? "high" : kind === "yield" ? "medium" : "info", scope, title: str(p.message) ?? "Inspection alert", detail: p };
    }
    case EventTypes.NG_ALERT:
      return { ...base, kind: "ng", severity: "high", scope, title: str(p.message) ?? "NG alert", detail: p };
    case EventTypes.YIELD_WARNING:
      return { ...base, kind: "yield", severity: "medium", scope, title: str(p.message) ?? "Yield warning", detail: p };
    case EventTypes.SPC_VIOLATION:
      return { ...base, kind: "spc", severity: mapSpcSeverity(str(p.severity)), scope, title: str(p.ruleName) ?? str(p.message) ?? "SPC violation", detail: p };
    case EventTypes.ANDON:
      return { ...base, kind: "andon", severity: mapAndonSeverity(str(p.state)), scope, title: str(p.title) ?? `Andon ${str(p.state) ?? ""}`.trim(), detail: p };
    case EventTypes.SAFETY_EVENT:
      return { ...base, kind: "safety", severity: p.isNearMiss ? "high" : "critical", scope, title: `Safety: ${str(p.eventType) ?? "event"}`, detail: p };
    case "quality_gate.breach":
      return { ...base, kind: "quality_gate", severity: str(p.action) === "stop" ? "critical" : "high", scope, title: `Quality gate breach: ${str(p.gateName) ?? str(p.gateType) ?? ""}`.trim(), detail: p };
    case "alert.escalation":
      return { ...base, kind: "escalation", severity: mapSpcSeverity(str(p.severity)), scope, title: `Escalation → L${num(p.toLevel) ?? "?"}: ${str(p.alertTitle) ?? ""}`.trim(), detail: p };
    case "maintenance.alert":
      return { ...base, kind: "maintenance", severity: str(p.alertType) === "critical" ? "critical" : "high", scope, title: str(p.prediction) ?? "Maintenance alert", detail: p };
    case "downtime.start":
    case "downtime.end":
      return { ...base, kind: "downtime", severity: "medium", scope, title: `Downtime ${e.type === "downtime.start" ? "started" : "ended"} (${str(p.category) ?? "?"})`, detail: p };
    case "oee.update":
      return { ...base, kind: "oee", severity: "info", scope, title: "OEE update", detail: p };

    // ── new U1 domain events ────────────────────────────────────────────────
    case EcosystemEventTypes.TASK_ASSIGNED:
    case EcosystemEventTypes.TASK_COMPLETED:
    case EcosystemEventTypes.TASK_FAILED: {
      const st = str(p.status) ?? e.type.split(".")[1];
      const sev: EcosystemSeverity = e.type === EcosystemEventTypes.TASK_FAILED ? "high" : "info";
      return { ...base, kind: "task", severity: sev, scope: { ...scope, robotId: num(p.robotId) ?? num(p.assignedDeviceId) }, title: `Task ${num(p.taskId) ?? "?"} ${st}`, detail: p };
    }
    case EcosystemEventTypes.WORKORDER_CREATED:
      return { ...base, kind: "workorder", severity: "medium", scope, title: `Work order ${str(p.workOrderNumber) ?? ""} (${str(p.type) ?? "?"})`.trim(), detail: p };
    case EcosystemEventTypes.ANOMALY_DETECTED:
      return { ...base, kind: "anomaly", severity: mapAnomalySeverity(str(p.severity)), scope, title: str(p.message) ?? `Anomaly: ${str(p.kind) ?? "detected"}`, detail: p };
    case EcosystemEventTypes.PROGRAM_DEPLOYED:
      return { ...base, kind: "program", severity: "info", scope, title: `Program deploy ${str(p.status) ?? ""} (${str(p.stage) ?? "?"})`.trim(), detail: p };
    case EcosystemEventTypes.TWIN_DERIVED:
      return { ...base, kind: "twin", severity: str(p.kind) === "collision" ? "high" : "info", scope, title: `Twin ${str(p.kind) ?? "derived"}`, detail: p };

    default:
      return null; // not surfaced (e.g. orchestration.triggered, ai.insight)
  }
}

function mapSpcSeverity(s: string | null): EcosystemSeverity {
  if (s === "critical") return "critical";
  if (s === "warning") return "high";
  if (s === "info") return "info";
  return "medium";
}
function mapAndonSeverity(state: string | null): EcosystemSeverity {
  if (state === "red" || state === "call") return "critical";
  if (state === "yellow") return "high";
  return "info";
}
function mapAnomalySeverity(s: string | null): EcosystemSeverity {
  switch (s) {
    case "critical": return "critical";
    case "high": return "high";
    case "low":
    case "diagnostic": return "low";
    case "info": return "info";
    default: return "medium";
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SUBSCRIBERS — make the ORPHANED (safety.event, quality_gate.breach) + NEW
// (anomaly.detected, workorder.created, task.*, program.deployed) events DO
// something: webhook fan-out + KB ingest. Gated by ECOSYSTEM_EVENTS_ENABLED so
// the OUTBOUND side-effects are off-by-default. In-process registration is cheap
// and harmless (the handlers no-op when the flag is off).
// ════════════════════════════════════════════════════════════════════════════

/** Master gate for U1 OUTBOUND side-effects (webhook + KB ingest). Default OFF. */
export function ecosystemEventsEnabled(): boolean {
  return process.env.ECOSYSTEM_EVENTS_ENABLED === "true" || process.env.ECOSYSTEM_EVENTS_ENABLED === "1";
}

let installed = false;
const unsubscribers: Array<() => void> = [];

/** Forward a normalized event to external webhook subscribers (gated inside emit()). */
function forwardToWebhook(evt: EcosystemEvent): void {
  // Public event name: `ecosystem.<kind>` — keeps the /api/v1 contract stable while
  // exposing the new classes to third parties. emit() is itself gated by
  // WEBHOOKS_ENABLED + fully fail-safe (never throws to us).
  void Promise.resolve(webhookEmit(`ecosystem.${evt.kind}`, evt as unknown as Record<string, unknown>)).catch((err) =>
    console.error("[U1] webhook forward failed:", (err as Error)?.message ?? err),
  );
}

/** Kinds significant enough to persist into the KB (not high-rate telemetry). */
const KB_SIGNIFICANT: ReadonlySet<EcosystemKind> = new Set<EcosystemKind>(["safety", "workorder", "program", "quality_gate", "anomaly"]);

/** Feed a SIGNIFICANT event into the local KB so the AI knows (gated inside ingest). */
function feedKb(evt: EcosystemEvent): void {
  try {
    if (!KB_SIGNIFICANT.has(evt.kind)) return;
    ingestKnowledgeRecordAsync({
      sourceId: `ecosystem:${evt.kind}:${evt.id}`,
      title: evt.title,
      text: `${evt.title}. severity=${evt.severity}, source=${evt.source}, scope=${JSON.stringify(evt.scope)}. detail=${JSON.stringify(evt.detail ?? {})}`,
      sourceType: "ecosystem_event",
      keywords: [evt.kind, evt.severity, evt.source],
    });
  } catch {
    /* KB ingest is best-effort */
  }
}

/**
 * Subscribe the U1 outbound bridge to the orphaned + new events. Idempotent; safe
 * at startup. The IN-PROCESS registration is free; every OUTBOUND action is gated
 * (ECOSYSTEM_EVENTS_ENABLED master gate + each sink's own flag). Existing bus
 * subscribers are untouched.
 */
export function installEcosystemEventBridge(): void {
  if (installed) return;
  installed = true;

  const handle = (e: DomainEvent) => {
    if (!ecosystemEventsEnabled()) return; // master gate — outbound side-effects off by default
    const evt = toEcosystemEvent(e);
    if (!evt) return;
    forwardToWebhook(evt);
    feedKb(evt);
  };

  // Orphaned events (0 prior subscribers) + the new U1 domain events.
  const types: string[] = [
    EventTypes.SAFETY_EVENT,
    "quality_gate.breach",
    EcosystemEventTypes.ANOMALY_DETECTED,
    EcosystemEventTypes.WORKORDER_CREATED,
    EcosystemEventTypes.TASK_ASSIGNED,
    EcosystemEventTypes.TASK_COMPLETED,
    EcosystemEventTypes.TASK_FAILED,
    EcosystemEventTypes.PROGRAM_DEPLOYED,
  ];
  for (const t of types) unsubscribers.push(eventBus.subscribe(t, handle));

  console.log(`[U1] ecosystem event bridge installed (ECOSYSTEM_EVENTS_ENABLED=${ecosystemEventsEnabled()})`);
}

/** Tear down (tests / shutdown). */
export function uninstallEcosystemEventBridge(): void {
  while (unsubscribers.length) unsubscribers.pop()!();
  installed = false;
}
