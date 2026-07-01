/**
 * I3b-1 (doc 20 §3/§5) — MTConnect DataItem → Unified Equipment Model field-map.
 * Flag: EQ_INTEG_ENABLED (reuses the I1 equipment-integration master flag).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * I1 built the MTConnect FRAMEWORK (client XML parser + poller → telemetry bus +
 * process_results, I2 routes FAULT/WARNING CONDITIONs through the alarm normalizer).
 * The GAP it left ("field-map TBD") is: nothing mapped the parsed MTConnect Streams
 * into the platform's UNIFIED EQUIPMENT MODEL (recipe_id / cycle_count /
 * production_counter / utilization_rate / alarm_code) that FOCAS/Euromap already emit.
 *
 * This PURE module closes that gap. Given the normalized readings from
 * mtconnectClient.parseStreamsXml (a /current or /sample document) it derives the SAME
 * UnifiedEquipmentSnapshot shape via a documented, per-vendor-CONFIGURABLE field-map:
 *
 *   MTConnect DataItem type → UEM field
 *   ───────────────────────────────────────────────────────────────────────────
 *   PROGRAM / PROGRAM_NAME              → recipe_id            (active NC program)
 *   PART_COUNT (all / good)            → production_counter    (parts produced)
 *   PART_COUNT / cycle proxy           → cycle_count          (see notes below)
 *   EXECUTION (ACTIVE/READY/…)         → PackML-ish state + utilization proxy
 *   CONTROLLER_MODE (AUTOMATIC/…)      → gates the utilization proxy
 *   PATH_FEEDRATE / SPINDLE_SPEED      → utilization proxy when moving
 *   CONDITION Fault/Warning            → alarm (nativeCode + severity → normalizer)
 *
 * SAFETY / HONESTY: read-only projection over already-parsed readings. It fabricates
 * NOTHING — a field the stream does not carry stays `null`. It opens no control path.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { MtcReading } from "./mtconnectClient";
import type { UnifiedEquipmentSnapshot } from "../focas/focasAdapter";
import { mapAlarm, type AlarmMapping, type AlarmSeverity } from "../standards/alarmTaxonomy";

/** MTConnect Execution → a PackML-ish coarse state (doc 20 §3). */
export type MtcExecState = "ACTIVE" | "READY" | "STOPPED" | "INTERRUPTED" | "OPTIONAL_STOP" | "PROGRAM_STOPPED" | "FEED_HOLD" | "UNAVAILABLE";

/** The default MTConnect vendor key for alarm-taxonomy lookups (per-device overridable). */
export const MTCONNECT_VENDOR_DEFAULT = "mtconnect" as const;

/** A CONDITION reading lifted into the alarm shape the normalizer consumes. */
export interface MtcConditionAlarm {
  /** The native vendor code — the Condition's `nativeCode` attr, else dataItemName|dataItemId|type. */
  nativeCode: string;
  /** FAULT | WARNING (NORMAL/UNAVAILABLE are not alarms). */
  level: "fault" | "warning";
  /** Vendor's native severity string when present (Condition `nativeSeverity` attr). */
  nativeSeverity?: string;
  message: string;
  /** The dataItemId the condition belongs to (for context/dedup). */
  dataItemId: string;
}

/** The MTConnect projection: UEM + the list of active alarms + the derived exec state. */
export interface MtcUemProjection extends UnifiedEquipmentSnapshot {
  /** Coarse PackML-ish execution state derived from the EXECUTION DataItem (or null). */
  execState: MtcExecState | null;
  /** ControllerMode string (AUTOMATIC / MANUAL / …) when present. */
  controllerMode: string | null;
  /** All FAULT/WARNING conditions found (drives the alarm→Andon path). */
  alarms: MtcConditionAlarm[];
}

/**
 * MTConnect Streams observations carry NO `category` on /current (it lives in /probe),
 * so the field-map matches on the DataItem `type` (UPPER_SNAKE, already normalized by
 * the client). Matching is by canonical type; a shop can extend these sets per vendor.
 */
const TYPE_PROGRAM = new Set(["PROGRAM", "PROGRAM_NAME", "PROGRAM_COMMENT", "MAIN_PROGRAM"]);
const TYPE_EXECUTION = "EXECUTION";
const TYPE_CONTROLLER_MODE = "CONTROLLER_MODE";
// PART_COUNT is the canonical counter; ACTUAL/ALL = total, GOOD/REMAINING are subTypes.
const TYPE_PART_COUNT = "PART_COUNT";
const TYPE_FEEDRATE = new Set(["PATH_FEEDRATE", "AXIS_FEEDRATE"]);
const TYPE_SPINDLE = new Set(["SPINDLE_SPEED", "ROTARY_VELOCITY"]);

/**
 * Canonicalize an MTConnect DataItem `type` to UPPER_SNAKE. On /current the client
 * derives `type` from the CamelCase element name (PartCount, ControllerMode,
 * PathFeedrate) when no explicit UPPER_SNAKE `type` attribute is present, yielding
 * e.g. "PARTCOUNT". /probe & /sample carry the real UPPER_SNAKE type ("PART_COUNT").
 * This inserts the missing underscores so both shapes match the field-map sets.
 */
export function canonicalType(type: string | undefined): string {
  const t = (type || "").trim();
  if (!t) return "";
  const upper = t.toUpperCase();
  // Already UPPER_SNAKE (from /probe or an explicit `type` attr) → keep it.
  if (upper.includes("_")) return upper;
  // The client upper-cases the CamelCase element name on /current, collapsing the
  // word boundaries (PartCount → PARTCOUNT). Map the compressed forms the field-map
  // cares about back to their canonical UPPER_SNAKE type. Unknown tokens pass through.
  const ALIASES: Record<string, string> = {
    PARTCOUNT: "PART_COUNT",
    CONTROLLERMODE: "CONTROLLER_MODE",
    PATHFEEDRATE: "PATH_FEEDRATE",
    AXISFEEDRATE: "AXIS_FEEDRATE",
    SPINDLESPEED: "SPINDLE_SPEED",
    ROTARYVELOCITY: "ROTARY_VELOCITY",
    PROGRAMNAME: "PROGRAM_NAME",
    PROGRAMCOMMENT: "PROGRAM_COMMENT",
    MAINPROGRAM: "MAIN_PROGRAM",
  };
  if (ALIASES[upper]) return ALIASES[upper];
  // If the original still carries CamelCase boundaries, split on them.
  if (/[a-z][A-Z]/.test(t)) {
    return t.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  }
  return upper;
}

/** Normalize an Execution text value to an MtcExecState (fail-safe → null). */
export function toExecState(value: string | undefined): MtcExecState | null {
  const v = (value ?? "").trim().toUpperCase();
  if (!v || v === "UNAVAILABLE") return v === "UNAVAILABLE" ? "UNAVAILABLE" : null;
  const known: MtcExecState[] = ["ACTIVE", "READY", "STOPPED", "INTERRUPTED", "OPTIONAL_STOP", "PROGRAM_STOPPED", "FEED_HOLD"];
  return known.includes(v as MtcExecState) ? (v as MtcExecState) : null;
}

/**
 * Utilization proxy (0..1). Read-only heuristic:
 *   - EXECUTION=ACTIVE + a moving spindle/feed OR AUTOMATIC mode → 1 (cutting).
 *   - EXECUTION=ACTIVE alone → 0.9.
 *   - READY / INTERRUPTED / FEED_HOLD / OPTIONAL_STOP → 0.5 (armed but not producing).
 *   - STOPPED / PROGRAM_STOPPED / UNAVAILABLE → 0.
 *   - nothing known → null (never fabricated).
 */
export function utilizationFromExecution(
  exec: MtcExecState | null,
  opts: { moving?: boolean; automatic?: boolean } = {},
): number | null {
  if (exec === "ACTIVE") {
    return opts.moving || opts.automatic ? 1 : 0.9;
  }
  if (exec === "READY" || exec === "INTERRUPTED" || exec === "FEED_HOLD" || exec === "OPTIONAL_STOP") {
    return 0.5;
  }
  if (exec === "STOPPED" || exec === "PROGRAM_STOPPED" || exec === "UNAVAILABLE") return 0;
  return null;
}

/** A CONDITION reading is an ALARM only when its state is Fault or Warning. */
function conditionAlarm(r: MtcReading): MtcConditionAlarm | null {
  const state = (r.conditionState ?? "").trim().toUpperCase();
  const level = state === "FAULT" ? "fault" : state === "WARNING" ? "warning" : null;
  if (!level) return null;
  // Prefer the vendor's own nativeCode; otherwise the dataItem label/id/type.
  const nativeCode = (r.nativeCode || r.dataItemName || r.dataItemId || r.type).slice(0, 128);
  return {
    nativeCode,
    level,
    nativeSeverity: r.nativeSeverity || undefined,
    message: `${r.type} ${r.conditionState ?? r.value}`.trim(),
    dataItemId: r.dataItemId,
  };
}

/**
 * PURE field-map: normalized MTConnect readings → Unified Equipment Model + alarms.
 *
 * Reads the FIRST matching DataItem per UEM field (a device typically exposes one
 * PROGRAM / EXECUTION / CONTROLLER_MODE and one or more PART_COUNTs). PART_COUNT with a
 * GOOD subType is preferred for production_counter; the total PART_COUNT feeds
 * cycle_count. No I/O; nothing is fabricated (absent field → null).
 *
 * @param entries optional alarm-taxonomy entries (DB ∪ seed) for the normalized alarm.
 * @param vendor  vendor key for taxonomy lookup (default 'mtconnect'; a device's
 *                manufacturer can be threaded here so mapAlarm resolves per-vendor).
 */
export function mapMtconnectToUem(
  readings: MtcReading[],
  opts: { entries?: AlarmMapping[]; vendor?: string } = {},
): MtcUemProjection {
  const vendor = opts.vendor?.trim() || MTCONNECT_VENDOR_DEFAULT;

  let recipeId: string | null = null;
  let execState: MtcExecState | null = null;
  let controllerMode: string | null = null;
  let partCountTotal: number | null = null;
  let partCountGood: number | null = null;
  let moving = false;
  const alarms: MtcConditionAlarm[] = [];

  for (const r of readings) {
    const type = canonicalType(r.type);

    // recipe_id ← active program name (first non-empty, non-UNAVAILABLE).
    if (recipeId === null && TYPE_PROGRAM.has(type)) {
      const v = (r.value ?? "").trim();
      if (v && v.toUpperCase() !== "UNAVAILABLE") recipeId = v;
      continue;
    }

    if (execState === null && type === TYPE_EXECUTION) {
      execState = toExecState(r.value);
      continue;
    }

    if (controllerMode === null && type === TYPE_CONTROLLER_MODE) {
      const v = (r.value ?? "").trim();
      if (v && v.toUpperCase() !== "UNAVAILABLE") controllerMode = v.toUpperCase();
      continue;
    }

    // production_counter ← PART_COUNT. GOOD subType → good parts; else the running total.
    if (type === TYPE_PART_COUNT && r.numericValue !== null) {
      const sub = (r.subType ?? "").toUpperCase();
      if (sub === "GOOD") partCountGood = r.numericValue;
      else if (partCountTotal === null || sub === "ALL" || sub === "ACTUAL" || sub === "") {
        partCountTotal = r.numericValue;
      }
      continue;
    }

    // utilization signal: a non-zero feed or spindle means the machine is moving.
    if ((TYPE_FEEDRATE.has(type) || TYPE_SPINDLE.has(type)) && r.numericValue !== null) {
      if (Math.abs(r.numericValue) > 0) moving = true;
      continue;
    }

    // CONDITION Fault/Warning → an alarm.
    if (r.category === "CONDITION") {
      const alarm = conditionAlarm(r);
      if (alarm) alarms.push(alarm);
    }
  }

  const automatic = controllerMode === "AUTOMATIC" || controllerMode === "AUTOMATIC_MDI";
  const utilizationRate = utilizationFromExecution(execState, { moving, automatic });

  // The top alarm (first FAULT, else first WARNING) drives the UEM alarmCode.
  const top = alarms.find((a) => a.level === "fault") ?? alarms[0] ?? null;
  const alarmCode = top ? top.nativeCode : null;
  const normalizedAlarm = alarmCode
    ? { nativeCode: alarmCode, ...mapAlarm(vendor, alarmCode, opts.entries) }
    : null;

  return {
    recipeId,
    // cycle_count: MTConnect has no first-class cumulative cycle DataItem; the total
    // PART_COUNT is the closest cumulative-cycle proxy for a CNC (1 part ≈ 1 cycle).
    cycleCount: partCountTotal,
    productionCounter: partCountGood ?? partCountTotal,
    utilizationRate,
    alarmCode,
    normalizedAlarm,
    execState,
    controllerMode,
    alarms,
  };
}

/** Map an MTConnect Condition level → a coarse ISA severity hint (for context only). */
export function conditionLevelToSeverity(level: "fault" | "warning"): AlarmSeverity {
  return level === "fault" ? "high" : "low";
}

/**
 * Lift every FAULT/WARNING CONDITION reading into the alarm shape the normalizer
 * consumes (nativeCode + nativeSeverity + message). NORMAL / UNAVAILABLE conditions
 * are skipped. PURE — used by the poller to route alarms → Andon carrying the vendor's
 * own native code/severity. Never fabricates an alarm.
 */
export function extractConditionAlarms(readings: MtcReading[]): MtcConditionAlarm[] {
  const out: MtcConditionAlarm[] = [];
  for (const r of readings) {
    if (r.category !== "CONDITION") continue;
    const alarm = conditionAlarm(r);
    if (alarm) out.push(alarm);
  }
  return out;
}
