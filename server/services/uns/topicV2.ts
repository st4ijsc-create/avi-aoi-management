/**
 * doc 44 W2-A1 / G2.1 — UNS Topic Builder v2 (SYNAPSE LDS-L1 §9.1 / LDS-L2 §4.1).
 *
 * PURE module (no I/O): builds the spec-correct semantic topic tree
 *
 *   syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}
 *     aspect ∈ telemetry | state | events | health | cmd | cmd_ack
 *
 * plus the AGGREGATE nodes produced by stream processing (LDS-L2 §4.1):
 *
 *   syn/{site}/{area}/{line}/_line/{aspect}     — line rollup (state/OEE)
 *   syn/{site}/{area}/_area/{aspect}            — area rollup
 *   syn/{site}/_site/{aspect}                   — site rollup
 *
 * Naming convention (LDS-L2 §4.2 — BẮT BUỘC): segments are lowercase, no
 * diacritics, slug-only ([a-z0-9-]). Segments come from the REAL hierarchy
 * (factory→workshop→line→station→machine codes) — resolution lives in
 * `isa95Resolver.ts` (this module stays pure). A missing level resolves to the
 * honest literal `unassigned` (never fabricated).
 *
 * Also hosts the CANONICAL payload builders whose shapes match the seeded
 * schema registry contracts (contracts/canonical/*.json — W0/G2.5):
 * telemetry {asset_id,ts,seq,metrics[]} · state {path,ts,state} · event
 * {event_id,asset_id,type,severity,ts} · health {asset_id,status,last_seen}.
 * Runtime validation/enforcement is a SEPARATE batch — here we only guarantee
 * the produced shape is contract-true (tests diff against the schema files).
 *
 * Flag: UNS_TOPIC_V2_ENABLED (default OFF → no v2 publish anywhere).
 */

import { randomUUID } from "node:crypto";
import { parseAviTopic, type ParsedTopic } from "../unsBridge";

// ─── Flags / root ─────────────────────────────────────────────────────────────

/** G1.5 — dual-publish gate for the v2 tree (read at call time; default OFF). */
export function isUnsTopicV2Enabled(): boolean {
  return process.env.UNS_TOPIC_V2_ENABLED === "true";
}

/** Root namespace segment (spec: `syn`). Env-tunable like UNS_CMD_ACK_TOPIC_ROOT. */
export function unsV2Root(): string {
  return process.env.UNS_TOPIC_V2_ROOT || "syn";
}

// ─── Aspects ──────────────────────────────────────────────────────────────────

export const UNS_V2_ASPECTS = [
  "telemetry",
  "state",
  "events",
  "health",
  "cmd",
  "cmd_ack",
] as const;
export type UnsAspect = (typeof UNS_V2_ASPECTS)[number];

/** QoS/retain per aspect (LDS-L1 §9.3): state/health retained QoS1; events/cmd_ack QoS1; telemetry QoS0. */
export function aspectPublishOptions(aspect: UnsAspect): { qos: 0 | 1; retain: boolean } {
  switch (aspect) {
    case "state":
    case "health":
      return { qos: 1, retain: true };
    case "events":
    case "cmd":
    case "cmd_ack":
      return { qos: 1, retain: false };
    case "telemetry":
    default:
      return { qos: 0, retain: false };
  }
}

// ─── Slug (LDS-L2 §4.2 — lowercase, no diacritics, [a-z0-9-] only) ────────────

/** Honest fallback segment when a hierarchy level is missing (never fabricated). */
export const UNS_V2_UNASSIGNED = "unassigned";

/**
 * Slug hóa một segment: bỏ dấu tiếng Việt (NFD + strip combining marks, đ→d),
 * chữ thường, mọi ký tự ngoài [a-z0-9] → '-', gộp/trim '-'. Chuỗi rỗng sau slug
 * → `fallback` (mặc định "unassigned") — KHÔNG bịa tên.
 */
export function slugSegment(raw: unknown, fallback: string = UNS_V2_UNASSIGNED): string {
  if (raw == null) return fallback;
  const s = String(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritics
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s : fallback;
}

// ─── Path types & builders ────────────────────────────────────────────────────

/** ISA-95 path segments (already slugged) for one piece of equipment. */
export interface Isa95PathV2 {
  site: string;      // factory
  area: string;      // workshop
  line: string;      // production line
  cell: string;      // station
  equipment: string; // machine
}

/** `syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}` */
export function buildEquipmentTopicV2(path: Isa95PathV2, aspect: UnsAspect): string {
  return [unsV2Root(), path.site, path.area, path.line, path.cell, path.equipment, aspect].join("/");
}

/** `syn/{site}/{area}/{line}/_line/{aspect}` — aggregate node (not a physical device). */
export function buildLineAggregateTopicV2(
  segs: { site: string; area: string; line: string },
  aspect: UnsAspect,
): string {
  return [unsV2Root(), segs.site, segs.area, segs.line, "_line", aspect].join("/");
}

/** `syn/{site}/{area}/_area/{aspect}` */
export function buildAreaAggregateTopicV2(
  segs: { site: string; area: string },
  aspect: UnsAspect,
): string {
  return [unsV2Root(), segs.site, segs.area, "_area", aspect].join("/");
}

/** `syn/{site}/_site/{aspect}` */
export function buildSiteAggregateTopicV2(site: string, aspect: UnsAspect): string {
  return [unsV2Root(), site, "_site", aspect].join("/");
}

/** ISA-95 path string `site/area/line/cell/equipment` (StateSnapshot.path, LDS-L2 §10.1). */
export function isa95PathString(path: Isa95PathV2): string {
  return [path.site, path.area, path.line, path.cell, path.equipment].join("/");
}

/** Canonical asset URN (LDS-L1 §6.2): `urn:syn:asset:{site}:{line}:{cell}:{equipment}`. */
export function assetUrn(path: Isa95PathV2): string {
  return `urn:syn:asset:${path.site}:${path.line}:${path.cell}:${path.equipment}`;
}

// ─── Legacy avi topic → aspect classification ────────────────────────────────

/**
 * Parse a legacy topic of either form `avi/{fid}/workshop/{wid}/station/{sid}/{type}`
 * or the REAL AOI form `avi/factory/{fid}/workshop/{wid}/station/{sid}/{type}`
 * (the optional `factory/` segment is stripped — same normalization as aoiBridge).
 */
export function parseAviLikeTopic(topic: string): ParsedTopic | null {
  if (typeof topic !== "string" || topic.length === 0) return null;
  const normalized = topic.replace(/^(avi(?:-aoi)?\/)factory\//i, "$1");
  return parseAviTopic(normalized);
}

/**
 * Legacy messageType → v2 aspect:
 *  - `errors`            → events  (NG alerts)
 *  - `heartbeat`         → health  (liveness)
 *  - `status`            → state   (machine state change)
 *  - everything else     → telemetry (inspection / summary / OT tag samples)
 */
export function classifyAviAspect(messageType: string): UnsAspect {
  const mt = (messageType || "").toLowerCase();
  if (mt.includes("errors")) return "events";
  if (mt.includes("heartbeat")) return "health";
  if (mt.includes("status")) return "state";
  return "telemetry";
}

// ─── Canonical state / severity normalization ────────────────────────────────

/**
 * Normalize a raw vendor/app state label to the canonical equipment-state enum
 * (LDS-L1 §8.7). Unknown labels pass through UPPERCASED (honest — not invented,
 * not silently coerced to a canonical value it does not mean).
 */
export function toCanonicalState(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  switch (s) {
    case "running":
    case "run":
    case "execute":
    case "producing":
    case "processing":
      return "EXECUTE";
    case "idle":
    case "standby":
    case "ready":
      return "IDLE";
    case "starting":
      return "STARTING";
    case "holding":
      return "HOLDING";
    case "held":
      return "HELD";
    case "completing":
      return "COMPLETING";
    case "complete":
    case "completed":
      return "COMPLETE";
    case "stopped":
    case "stop":
      return "STOPPED";
    case "aborted":
    case "abort":
      return "ABORTED";
    case "error":
    case "fault":
    case "faulted":
    case "alarm":
    case "failure":
      return "FAULTED";
    case "maintenance":
      return "MAINTENANCE";
    case "offline":
    case "disconnected":
      return "OFFLINE";
    default:
      return s.length > 0 ? s.toUpperCase() : "UNKNOWN";
  }
}

export type CanonicalEventSeverity = "info" | "warning" | "error" | "critical";

/**
 * Normalize a raw severity label to the canonical enum (contracts/canonical/
 * event.schema.json). Known synonyms map; unknown → `fallback`.
 */
export function normalizeEventSeverity(
  raw: unknown,
  fallback: CanonicalEventSeverity = "warning",
): CanonicalEventSeverity {
  const s = String(raw ?? "").trim().toLowerCase();
  switch (s) {
    case "info":
    case "low":
      return "info";
    case "warning":
    case "warn":
    case "medium":
      return "warning";
    case "error":
    case "high":
      return "error";
    case "critical":
    case "fatal":
      return "critical";
    default:
      return fallback;
  }
}

// ─── Canonical payload builders (shape == contracts/canonical/*.json) ────────

/** One telemetry metric entry (contracts/canonical/telemetry.schema.json items). */
export interface TelemetryMetricV2 {
  name: string;
  value: unknown;
  unit?: string;
  quality?: "good" | "uncertain" | "bad";
  ts?: string;
}

/** Telemetry {asset_id, ts, seq, metrics[]} — required: asset_id, ts, metrics. */
export function buildTelemetryPayloadV2(params: {
  path: Isa95PathV2;
  ts?: string;
  seq?: number;
  metrics: TelemetryMetricV2[];
}): { asset_id: string; ts: string; seq?: number; metrics: TelemetryMetricV2[] } {
  return {
    asset_id: assetUrn(params.path),
    ts: params.ts ?? new Date().toISOString(),
    ...(params.seq != null ? { seq: params.seq } : {}),
    metrics: params.metrics,
  };
}

/** StateSnapshot {path, ts, state, values?, health?} — required: path, ts, state. */
export function buildStateSnapshotV2(params: {
  path: Isa95PathV2;
  ts?: string;
  state: string;
  values?: Record<string, unknown>;
  health?: string;
}): { path: string; ts: string; state: string; values?: Record<string, unknown>; health?: string } {
  return {
    path: isa95PathString(params.path),
    ts: params.ts ?? new Date().toISOString(),
    state: params.state,
    ...(params.values && Object.keys(params.values).length > 0 ? { values: params.values } : {}),
    ...(params.health ? { health: params.health } : {}),
  };
}

export type CanonicalEventType = "state_change" | "fault" | "alarm" | "handover" | "lifecycle";

/** Event {event_id, asset_id, type, severity, ts, state?, cause?, payload?}. */
export function buildEventPayloadV2(params: {
  path: Isa95PathV2;
  type: CanonicalEventType;
  severity: CanonicalEventSeverity;
  ts?: string;
  state?: string;
  cause?: string;
  payload?: Record<string, unknown>;
  eventId?: string;
}): {
  event_id: string;
  asset_id: string;
  type: CanonicalEventType;
  severity: CanonicalEventSeverity;
  ts: string;
  state?: string;
  cause?: string;
  payload?: Record<string, unknown>;
} {
  return {
    event_id: params.eventId ?? randomUUID(),
    asset_id: assetUrn(params.path),
    type: params.type,
    severity: params.severity,
    ts: params.ts ?? new Date().toISOString(),
    ...(params.state ? { state: params.state } : {}),
    ...(params.cause ? { cause: params.cause } : {}),
    ...(params.payload ? { payload: params.payload } : {}),
  };
}

export type CanonicalHealthStatus = "online" | "degraded" | "offline";

/** Health {asset_id, status, last_seen, latency_ms?, error_rate?}. */
export function buildHealthPayloadV2(params: {
  path: Isa95PathV2;
  status: CanonicalHealthStatus;
  lastSeen?: string;
  latencyMs?: number;
  errorRate?: number;
}): {
  asset_id: string;
  status: CanonicalHealthStatus;
  last_seen: string;
  latency_ms?: number;
  error_rate?: number;
} {
  return {
    asset_id: assetUrn(params.path),
    status: params.status,
    last_seen: params.lastSeen ?? new Date().toISOString(),
    ...(params.latencyMs != null ? { latency_ms: params.latencyMs } : {}),
    ...(params.errorRate != null ? { error_rate: params.errorRate } : {}),
  };
}

// ─── Metric extraction from legacy JSON payloads ─────────────────────────────

const MAX_EXTRACTED_METRICS = 32;

/**
 * Extract top-level SCALAR fields (number/boolean/short string) of a legacy JSON
 * payload as telemetry metrics. Nested objects/arrays are skipped (they are not
 * point metrics). Bounded to 32 entries. Returns [] for non-object payloads.
 */
export function extractScalarMetrics(payload: unknown, ts?: string): TelemetryMetricV2[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const out: TelemetryMetricV2[] = [];
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (out.length >= MAX_EXTRACTED_METRICS) break;
    const t = typeof value;
    if (t === "number" || t === "boolean") {
      out.push({ name: key, value, ...(ts ? { ts } : {}) });
    } else if (t === "string" && (value as string).length <= 256) {
      out.push({ name: key, value, ...(ts ? { ts } : {}) });
    }
  }
  return out;
}
