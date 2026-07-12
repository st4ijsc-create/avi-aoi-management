/**
 * IPC-CFX (IPC-2591) message parsing + mapping — PURE, no I/O.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * CFX is the modern SMT-line connectivity standard. It rides on AMQP 1.0; each
 * message is a JSON "envelope":
 *
 *   {
 *     "MessageName": "CFX.Production.UnitsProcessed",
 *     "Version":     "1.7",
 *     "TimeStamp":   "2026-07-10T08:00:00Z",
 *     "UniqueID":    "…",
 *     "Source":      "SMTLine1.Placer1",   // fully-qualified endpoint handle
 *     "Target":      null,
 *     "MessageBody": { … }                 // message-specific payload
 *   }
 *
 * This module is the PURE half of the CFX telemetry client: it parses that
 * envelope and maps the telemetry-relevant message types into the platform's
 * protocol-agnostic `CanonicalSample[]` so they flow through the ONE unified
 * telemetry bus (same path as MTConnect / SECS-GEM / OT drivers).
 *
 * Mapped message types (the ones useful for SMT line monitoring):
 *   • UnitsProcessed       → count telemetry (units processed / passed / failed)
 *   • StationStateChanged  → machine status telemetry (state string + duration)
 *   • FaultOccurred        → an alarm-shaped sample (quality 'bad', fault meta)
 *   • ToolChanged          → a change-event sample (new tool identifier)
 *
 * HONESTY: this file produces NO data of its own — it only re-shapes a message a
 * real broker delivered. A message it doesn't recognize (or a malformed body)
 * yields an EMPTY sample array with a debug log — it never throws and never
 * fabricates a reading. The platform's `telemetryProtocolEnum` has no 'cfx'
 * member, so samples use protocol 'other' and carry `meta.cfx = <shortName>` for
 * traceability.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { CanonicalSample } from "../telemetryBus";

/** A normalized CFX envelope after parsing (namespace stripped from the name). */
export interface CfxEnvelope {
  /** Short message name, e.g. "UnitsProcessed" (the "CFX.…." namespace stripped). */
  messageName: string;
  /** Fully-qualified message name as received, e.g. "CFX.Production.UnitsProcessed". */
  fullMessageName: string;
  /** Endpoint handle the message came from (e.g. "SMTLine1.Placer1"), or null. */
  source: string | null;
  /** ISO timestamp string from the envelope, or null. */
  timeStamp: string | null;
  /** The message-specific payload (MessageBody), or null. */
  body: Record<string, unknown> | null;
}

/** Optional AMQP-level hints that some brokers use instead of an in-body name. */
export interface CfxParseHints {
  /** AMQP message `subject` — some CFX endpoints carry the message name here. */
  subject?: string | null;
  /** AMQP `application_properties` — may carry MessageName / Source. */
  applicationProperties?: Record<string, unknown> | null;
}

/** Context for mapping (device/machine resolution). */
export interface CfxMapContext {
  /** Override device code for every sample from this endpoint. Defaults to env.source. */
  machineCode?: string | null;
  /** Explicit machineId if the caller already resolved it (skips bus resolution). */
  machineId?: number | null;
}

function log(msg: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err != null ? String(err) : "";
  console.warn(`[CFX] ${msg}${detail ? `: ${detail}` : ""}`);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Case-tolerant field read (CFX uses PascalCase, but be forgiving of camelCase). */
function field(obj: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) {
    if (n in obj) return obj[n];
    const lower = n.charAt(0).toLowerCase() + n.slice(1);
    if (lower in obj) return obj[lower];
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

/**
 * Strip the CFX namespace from a message name.
 *   "CFX.Production.UnitsProcessed" → "UnitsProcessed"
 *   "UnitsProcessed"                → "UnitsProcessed"
 */
export function shortMessageName(fullName: string): string {
  const parts = fullName.split(".");
  return parts[parts.length - 1] || fullName;
}

/**
 * Parse a raw AMQP message body (string JSON, object, or Buffer) + optional AMQP
 * hints into a normalized CfxEnvelope. Fail-safe: returns null (with a debug log)
 * for anything unparseable — the caller keeps running. NEVER throws.
 */
export function parseCfxEnvelope(raw: unknown, hints?: CfxParseHints): CfxEnvelope | null {
  let obj: Record<string, unknown> | null = null;

  try {
    if (raw == null) return null;
    if (typeof raw === "string") {
      obj = asRecord(JSON.parse(raw));
    } else if (Buffer.isBuffer(raw)) {
      obj = asRecord(JSON.parse(raw.toString("utf8")));
    } else if (raw && typeof raw === "object" && "content" in (raw as Record<string, unknown>)) {
      // rhea data-section shape: { typecode, content: Buffer }
      const content = (raw as Record<string, unknown>).content;
      if (Buffer.isBuffer(content)) obj = asRecord(JSON.parse(content.toString("utf8")));
      else if (typeof content === "string") obj = asRecord(JSON.parse(content));
      else obj = asRecord(raw);
    } else {
      obj = asRecord(raw);
    }
  } catch (err) {
    log("envelope JSON parse failed", err);
    return null;
  }
  if (!obj) {
    log("envelope is not a JSON object — ignored");
    return null;
  }

  const props = hints?.applicationProperties ?? null;

  // MessageName: prefer the in-body field, then AMQP subject, then app-property.
  const fullName =
    str(field(obj, "MessageName")) ??
    str(hints?.subject ?? null) ??
    (props ? str(field(props, "MessageName")) : null);
  if (!fullName || !fullName.trim()) {
    log("envelope has no MessageName — ignored");
    return null;
  }

  const source =
    str(field(obj, "Source")) ?? (props ? str(field(props, "Source")) : null);
  const timeStamp = str(field(obj, "TimeStamp"));
  const body = asRecord(field(obj, "MessageBody"));

  return {
    messageName: shortMessageName(fullName.trim()),
    fullMessageName: fullName.trim(),
    source: source && source.trim() ? source.trim() : null,
    timeStamp,
    body,
  };
}

/** Parse a .NET/ISO timespan ("HH:MM:SS", "D.HH:MM:SS", with optional ".fff") → seconds. */
export function parseTimespanSeconds(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return null;
  // Optional leading "D." day part.
  let days = 0;
  let rest = s;
  const dayMatch = /^(\d+)\.(\d{1,2}:\d{2}:\d{2})/.exec(s);
  if (dayMatch) {
    days = Number(dayMatch[1]);
    rest = dayMatch[2] + s.slice(dayMatch[0].length);
  }
  const m = /^(\d{1,3}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(rest);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (![h, min, sec].every(Number.isFinite)) return null;
  return days * 86400 + h * 3600 + min * 60 + sec;
}

/** Best-effort event time as a Date from the envelope timestamp (else undefined → now()). */
function envTime(env: CfxEnvelope): Date | undefined {
  if (!env.timeStamp) return undefined;
  const d = new Date(env.timeStamp);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Common per-sample fields for one envelope. */
function baseSample(
  env: CfxEnvelope,
  ctx: CfxMapContext | undefined,
): Pick<CanonicalSample, "ts" | "machineId" | "deviceId" | "protocol"> {
  const deviceId = (ctx?.machineCode ?? env.source) || null;
  return {
    ts: envTime(env),
    machineId: ctx?.machineId ?? undefined,
    deviceId,
    protocol: "other", // enum has no 'cfx' member; carried in meta.cfx instead
  };
}

// ── Per-message mappers ──────────────────────────────────────────────────────

function mapUnitsProcessed(env: CfxEnvelope, ctx?: CfxMapContext): CanonicalSample[] {
  const body = env.body;
  if (!body) return [];
  const base = baseSample(env, ctx);
  const meta = { cfx: env.messageName, source: env.source } as Record<string, unknown>;

  // The processed units live in UnitProcessData (fallback: Units). Fallback to a
  // scalar UnitCount when the endpoint sends only a count.
  const unitsRaw = field(body, "UnitProcessData", "Units");
  const units = Array.isArray(unitsRaw) ? (unitsRaw as unknown[]) : null;

  let total: number | null = null;
  let passed = 0;
  let failed = 0;
  if (units) {
    total = units.length;
    for (const u of units) {
      const rec = asRecord(u);
      const result = rec ? str(field(rec, "OverallResult")) : null;
      const r = (result ?? "").toLowerCase();
      if (r === "passed" || r === "pass") passed += 1;
      else if (r === "failed" || r === "fail") failed += 1;
    }
  } else {
    const cnt = Number(field(body, "UnitCount", "Count"));
    if (Number.isFinite(cnt)) total = cnt;
  }
  if (total == null) return [];

  const out: CanonicalSample[] = [
    { ...base, metric: "units_processed", value: total, unit: "units", meta },
  ];
  // Only emit pass/fail breakdown when we actually inspected per-unit results, else
  // fall back to the envelope-level OverallResult when present (single-unit case).
  if (units) {
    // If no per-unit result was present, derive from the envelope OverallResult.
    if (passed === 0 && failed === 0) {
      const overall = (str(field(body, "OverallResult")) ?? "").toLowerCase();
      if (overall === "passed" || overall === "pass") passed = total;
      else if (overall === "failed" || overall === "fail") failed = total;
    }
    out.push({ ...base, metric: "units_passed", value: passed, unit: "units", meta });
    out.push({ ...base, metric: "units_failed", value: failed, unit: "units", meta });
  }
  return out;
}

function mapStationStateChanged(env: CfxEnvelope, ctx?: CfxMapContext): CanonicalSample[] {
  const body = env.body;
  if (!body) return [];
  const base = baseSample(env, ctx);
  const newState = str(field(body, "NewState"));
  if (!newState) return [];
  const oldState = str(field(body, "OldState"));
  const durationS = parseTimespanSeconds(field(body, "OldStateDuration"));
  const meta = {
    cfx: env.messageName,
    source: env.source,
    oldState,
    newState,
  } as Record<string, unknown>;

  const out: CanonicalSample[] = [
    { ...base, metric: "station_state", value: newState, meta },
  ];
  if (durationS != null) {
    out.push({
      ...base,
      metric: "station_state_duration_s",
      value: durationS,
      unit: "s",
      meta: { ...meta, forState: oldState },
    });
  }
  return out;
}

function mapFaultOccurred(env: CfxEnvelope, ctx?: CfxMapContext): CanonicalSample[] {
  const body = env.body;
  if (!body) return [];
  const base = baseSample(env, ctx);
  // The fault payload is nested under "Fault"; tolerate a flat body too.
  const fault = asRecord(field(body, "Fault")) ?? body;
  const faultCode = str(field(fault, "FaultCode"));
  const cause = str(field(fault, "Cause"));
  const severity = str(field(fault, "Severity"));
  const description = str(field(fault, "Description"));
  const code = faultCode ?? cause;
  if (!code) return [];

  const severityLc = (severity ?? "").toLowerCase();
  // 'Information' severity is informational — treat as 'uncertain', else 'bad'.
  const quality = severityLc === "information" || severityLc === "info" ? "uncertain" : "bad";

  return [
    {
      ...base,
      metric: "fault",
      value: code,
      quality,
      meta: {
        cfx: env.messageName,
        source: env.source,
        faultCode,
        cause,
        severity,
        description,
        lane: field(fault, "Lane") ?? null,
        faultOccurrenceId: str(field(fault, "FaultOccurrenceId")),
      },
    },
  ];
}

function mapToolChanged(env: CfxEnvelope, ctx?: CfxMapContext): CanonicalSample[] {
  const body = env.body;
  if (!body) return [];
  const base = baseSample(env, ctx);
  const newTool = asRecord(field(body, "NewTool"));
  const oldTool = asRecord(field(body, "OldTool"));
  const toolId =
    (newTool && str(field(newTool, "UniqueIdentifier", "Name"))) ??
    str(field(body, "Tool", "ToolIdentifier")) ??
    "changed";
  return [
    {
      ...base,
      metric: "tool_changed",
      value: toolId,
      meta: {
        cfx: env.messageName,
        source: env.source,
        oldTool: oldTool ? str(field(oldTool, "UniqueIdentifier", "Name")) : null,
      },
    },
  ];
}

/** Message-name → mapper table (short names). */
const MAPPERS: Record<string, (env: CfxEnvelope, ctx?: CfxMapContext) => CanonicalSample[]> = {
  UnitsProcessed: mapUnitsProcessed,
  StationStateChanged: mapStationStateChanged,
  FaultOccurred: mapFaultOccurred,
  ToolChanged: mapToolChanged,
};

/** True when a message name is one this module maps (short name). */
export function isMappedCfxMessage(shortName: string): boolean {
  return shortName in MAPPERS;
}

/**
 * Map a parsed CFX envelope → CanonicalSample[] for the telemetry bus. An
 * unmapped message name returns [] (with a debug log). NEVER throws — a malformed
 * body for a known message also yields [] rather than crashing the receiver.
 */
export function mapCfxToSamples(env: CfxEnvelope, ctx?: CfxMapContext): CanonicalSample[] {
  const mapper = MAPPERS[env.messageName];
  if (!mapper) {
    // Not a telemetry-relevant message → ignore quietly (many CFX messages are
    // request/response or config chatter we intentionally don't ingest).
    return [];
  }
  try {
    return mapper(env, ctx);
  } catch (err) {
    log(`mapping ${env.messageName} failed`, err);
    return [];
  }
}

/**
 * Convenience: parse a raw AMQP body (+hints) and map it in one call. Returns []
 * when the message can't be parsed or isn't a mapped type.
 */
export function parseAndMapCfx(
  raw: unknown,
  hints?: CfxParseHints,
  ctx?: CfxMapContext,
): CanonicalSample[] {
  const env = parseCfxEnvelope(raw, hints);
  if (!env) return [];
  return mapCfxToSamples(env, ctx);
}
