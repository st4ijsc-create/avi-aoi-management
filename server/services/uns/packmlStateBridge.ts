/**
 * doc 24 Wave-4 · C5 — UNS-first PackML STATE bridge (PURE mapping, no I/O).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Promotes the PackML/ISA-TR88 command STATE to a first-class UNS channel: it encodes
 * a PackML state TRANSITION + the machine's IDENTITY into a Sparkplug-B metric set so a
 * UNS subscriber can RECONSTRUCT the machine's full PackML state + identity from the
 * DBIRTH/DDATA stream (a true digital thread, not just point telemetry).
 *
 * This module is PURE — it builds Sparkplug MetricDef/MetricSample (and, given a
 * SparkplugNode, {topic,buffer} messages). The actual publish (MQTT I/O) lives in
 * unsPublisher.ts (`publishPackmlState`), gated behind UNS_PACKML_STATE_ENABLED
 * (default OFF → the publisher is a complete no-op, legacy behaviour unchanged).
 *
 * Metric namespace (stable names carried in DBIRTH; DDATA uses the birthed aliases):
 *   PackML/State          String   — the current PackML state name
 *   PackML/StateCode      Int64    — index into PACKML_STATES (compact reconstruction)
 *   PackML/PreviousState  String   — the state the machine came from (may be empty)
 *   PackML/Command        String   — the PackML command that drove the transition
 *   PackML/UnitMode       String   — PackML unit/production mode (optional)
 *   Identity/MachineId    Int64    — platform machine id
 *   Identity/MachineCode  String   — platform machine code
 *   Identity/MachineType  String   — platform machineType (== EquipmentClass)
 *
 * The channel is READ-DIRECTION only (publish). It NEVER issues a PackML command and
 * opens NO control path — a real command still routes through the gated dispatcher.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { PACKML_STATES, asPackmlState, asPackmlCommand, type PackmlState, type PackmlCommand } from "../equipment/packml";
import type { MetricDef, MetricSample, BuiltMessage, SparkplugNode } from "./sparkplugNode";

/** Well-known metric names for the PackML state channel (stable across DBIRTHs). */
export const PACKML_METRIC = {
  state: "PackML/State",
  stateCode: "PackML/StateCode",
  previousState: "PackML/PreviousState",
  command: "PackML/Command",
  unitMode: "PackML/UnitMode",
  machineId: "Identity/MachineId",
  machineCode: "Identity/MachineCode",
  machineType: "Identity/MachineType",
} as const;

/** Machine identity carried alongside the state so a subscriber can attribute it. */
export interface PackmlIdentity {
  machineId?: number | null;
  machineCode?: string | null;
  /** machineType == EquipmentClass (AOI/ROBOT/AUTOMATION/…). */
  machineType?: string | null;
}

/** ONE PackML state transition to publish. */
export interface PackmlTransition {
  /** The NEW PackML state after the transition. */
  state: PackmlState;
  /** The state the machine came from (optional — first observation has none). */
  previousState?: PackmlState | null;
  /** The PackML command that drove the transition (optional for auto/SC edges). */
  command?: PackmlCommand | null;
  /** PackML unit/production mode label (Production/Maintenance/Manual — optional). */
  unitMode?: string | null;
  /** Event timestamp (ms). Defaults to Date.now() at build time. */
  timestamp?: number;
}

/** Flag: publish PackML state to UNS. Default OFF → publisher no-ops (legacy). */
export function isUnsPackmlStateEnabled(): boolean {
  return (
    process.env.UNS_PACKML_STATE_ENABLED === "true" ||
    process.env.UNS_PACKML_STATE_ENABLED === "1"
  );
}

/** Index of a PackML state in the canonical PACKML_STATES tuple (or -1). */
export function packmlStateCode(state: PackmlState): number {
  return (PACKML_STATES as readonly PackmlState[]).indexOf(state);
}

/** Inverse of packmlStateCode: state index → PackmlState (fail-safe → null). */
export function packmlStateFromCode(code: unknown): PackmlState | null {
  const n = Number(code);
  if (!Number.isInteger(n) || n < 0 || n >= PACKML_STATES.length) return null;
  return PACKML_STATES[n];
}

/**
 * The Sparkplug device id used for a machine's PackML state channel. Prefers the
 * platform machineCode (stable, human-meaningful), else `Machine{machineId}`, else a
 * generic "Machine". Kept distinct from the AOI bridge's `Station{N}` device id so the
 * two channels never collide on aliases within one edge node.
 */
export function packmlSparkplugDeviceId(identity: PackmlIdentity): string {
  const code = identity.machineCode?.trim();
  if (code) return code;
  if (identity.machineId != null && Number.isInteger(identity.machineId)) {
    return `Machine${identity.machineId}`;
  }
  return "Machine";
}

/**
 * Build the PackML state metric set (defs for DBIRTH + samples for DDATA — identical
 * name/type/value here). PURE. Identity metrics are included so a subscriber can
 * reconstruct WHICH machine the state belongs to from the birth certificate alone.
 */
export function buildPackmlStateMetrics(
  transition: PackmlTransition,
  identity: PackmlIdentity = {},
): { metricDefs: MetricDef[]; metrics: MetricSample[] } {
  const ts = transition.timestamp ?? Date.now();
  const entries: Array<{ name: string; type: string; value: unknown }> = [
    { name: PACKML_METRIC.state, type: "String", value: transition.state },
    { name: PACKML_METRIC.stateCode, type: "Int64", value: packmlStateCode(transition.state) },
    { name: PACKML_METRIC.previousState, type: "String", value: transition.previousState ?? "" },
    { name: PACKML_METRIC.command, type: "String", value: transition.command ?? "" },
    { name: PACKML_METRIC.unitMode, type: "String", value: transition.unitMode ?? "" },
    { name: PACKML_METRIC.machineId, type: "Int64", value: identity.machineId ?? 0 },
    { name: PACKML_METRIC.machineCode, type: "String", value: identity.machineCode ?? "" },
    { name: PACKML_METRIC.machineType, type: "String", value: identity.machineType ?? "" },
  ];
  const metricDefs: MetricDef[] = entries.map((e) => ({ ...e, timestamp: ts }));
  const metrics: MetricSample[] = entries.map((e) => ({ ...e, timestamp: ts }));
  return { metricDefs, metrics };
}

/**
 * Build the Sparkplug {topic,buffer} message(s) for a transition using a SparkplugNode:
 * a lazy DBIRTH (declaring the metric names+aliases) the FIRST time this device is seen,
 * then a DDATA every transition. PURE (no I/O) — the caller publishes the buffers.
 *
 * Reusing the node's own birth-state means the metric NAMES ride in the DBIRTH once and
 * subsequent DDATA use compact aliases — a subscriber resolves aliases via the DBIRTH.
 */
export function buildPackmlStateMessages(
  node: SparkplugNode,
  groupId: string,
  edgeNodeId: string,
  deviceId: string,
  transition: PackmlTransition,
  identity: PackmlIdentity = {},
): BuiltMessage[] {
  const { metricDefs, metrics } = buildPackmlStateMetrics(transition, identity);
  const out: BuiltMessage[] = [];
  if (!node.state.isDeviceBirthed(deviceId)) {
    out.push(node.buildDbirth(groupId, edgeNodeId, deviceId, metricDefs));
  }
  out.push(node.buildDdata(groupId, edgeNodeId, deviceId, metrics));
  return out;
}

/** The reconstructed PackML state + identity a subscriber recovers from the stream. */
export interface ReconstructedPackml {
  state: PackmlState | null;
  previousState: PackmlState | null;
  command: PackmlCommand | null;
  unitMode: string | null;
  identity: PackmlIdentity;
}

/**
 * Reconstruct the PackML state + identity from a NAME-keyed metric list — i.e. a
 * subscriber that has resolved DDATA aliases back to names via the DBIRTH (or a decoded
 * DBIRTH, whose metrics already carry names). Prefers the explicit state name, falling
 * back to the numeric StateCode so a compact/partial update still reconstructs. Pure +
 * fail-safe — a metric that is absent leaves its field null.
 */
export function reconstructPackmlFromMetrics(
  metrics: Array<{ name?: string; value: unknown }>,
): ReconstructedPackml {
  const byName = new Map<string, unknown>();
  for (const m of metrics) {
    if (m && typeof m.name === "string" && m.name) byName.set(m.name, m.value);
  }
  const str = (name: string): string | null => {
    const v = byName.get(name);
    if (v == null) return null;
    const s = String(v).trim();
    return s ? s : null;
  };

  const stateByName = asPackmlState(str(PACKML_METRIC.state));
  const stateByCode = byName.has(PACKML_METRIC.stateCode)
    ? packmlStateFromCode(byName.get(PACKML_METRIC.stateCode))
    : null;

  const machineIdRaw = byName.get(PACKML_METRIC.machineId);
  const machineIdNum = Number(machineIdRaw);
  const machineId =
    machineIdRaw != null && Number.isInteger(machineIdNum) && machineIdNum > 0 ? machineIdNum : null;

  return {
    state: stateByName ?? stateByCode,
    previousState: asPackmlState(str(PACKML_METRIC.previousState)),
    command: asPackmlCommand(str(PACKML_METRIC.command)),
    unitMode: str(PACKML_METRIC.unitMode),
    identity: {
      machineId,
      machineCode: str(PACKML_METRIC.machineCode),
      machineType: str(PACKML_METRIC.machineType),
    },
  };
}

/**
 * Build an alias→name map from a decoded DBIRTH's metrics (each carries both). A
 * subscriber uses this to turn subsequent alias-only DDATA metrics back into named
 * metrics before calling `reconstructPackmlFromMetrics`.
 */
export function aliasNameMapFromBirth(
  birthMetrics: Array<{ name?: string; alias?: number }>,
): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of birthMetrics) {
    if (m && typeof m.alias === "number" && typeof m.name === "string" && m.name) {
      map.set(m.alias, m.name);
    }
  }
  return map;
}

/**
 * Resolve alias-only DDATA metrics back to NAME-keyed metrics using an alias→name map
 * (typically from `aliasNameMapFromBirth`). Metrics that already carry a name pass
 * through; alias-only metrics with no mapping are dropped. Pure.
 */
export function resolveAliasedMetrics(
  ddataMetrics: Array<{ name?: string; alias?: number; value: unknown }>,
  aliasToName: Map<number, string>,
): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  for (const m of ddataMetrics) {
    if (!m) continue;
    if (typeof m.name === "string" && m.name) {
      out.push({ name: m.name, value: m.value });
      continue;
    }
    if (typeof m.alias === "number") {
      const name = aliasToName.get(m.alias);
      if (name) out.push({ name, value: m.value });
    }
  }
  return out;
}
