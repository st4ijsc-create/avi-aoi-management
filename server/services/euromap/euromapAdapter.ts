/**
 * Euromap (Injection Molding) Connectivity FRAMEWORK — I1 (doc 16 §6 / §15).
 * Flag: EQ_INTEG_ENABLED.
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This is a READ-ONLY MONITORING FRAMEWORK, **not** a live Euromap driver. There is
 * NO real injection-molding machine (IMM) attached and NO telemetry is fabricated.
 * It models the data the platform cares about across the Euromap transports:
 *   - Euromap 63  — file-based session protocol (the classic .req/.rsp/.job exchange),
 *   - Euromap 77  — OPC-UA Companion Spec for IMMs (PLASTICS_RUBBER nodeset),
 *   - Euromap 83  — the same data model carried over MQTT/JSON.
 * regardless of transport the SAME logical fields are normalised:
 *   actualCycleTime, shotCounter (production count), goodPartsCounter, machineMode,
 *   activeRecipe/mold id, and active alarms.
 *
 * A normaliser maps those native fields → the Unified Equipment Model (recipe_id,
 * cycle_count, alarm_code, utilization_rate, production_counter) and a fail-safe
 * local last-value CACHE keeps a last-known snapshot when the connection drops.
 *
 * The REAL seam: a production bring-up either (a) runs a Euromap 63 session-protocol
 * file connector, or (b) subscribes to the Euromap 77/83 OPC-UA/MQTT nodes, then POSTs
 * readings here. The exact node ids / DCV keys are validated PER MACHINE. Until then
 * `readSnapshot()` returns `{ connected:false, source:"cache"|"none" }` and never
 * invents values. testConnection() is honest about the missing transport.
 *
 * SAFETY: read-only. Opens NO control path; IMM start/stop still routes through the
 * EXISTING gated dispatcher via the unified EquipmentAdapter facade.
 */
import { mapAlarm, type AlarmMapping, type NormalizedAlarm } from "../standards/alarmTaxonomy";
import {
  isEqIntegEnabled,
  type UnifiedEquipmentSnapshot,
} from "../focas/focasAdapter";

export { isEqIntegEnabled };

/** Default vendor key for the alarm taxonomy (override per-machine if needed). */
export const EUROMAP_VENDOR_DEFAULT = "euromap" as const;

/** Euromap transport variants this framework recognises. */
export const EUROMAP_TRANSPORTS = ["euromap63", "euromap77", "euromap83"] as const;
export type EuromapTransport = (typeof EUROMAP_TRANSPORTS)[number];

export const EUROMAP_CAVEAT =
  "FRAMEWORK (read-only monitoring): no Euromap transport (63 file-session / 77 OPC-UA / " +
  "83 MQTT) is connected and no real injection-molding machine is attached. A production " +
  "bring-up validates the node ids / DCV keys per machine. No telemetry is fabricated.";

/** A native Euromap alarm entry (transport-neutral). */
export interface EuromapAlarm {
  /** Native alarm code (e.g. a Euromap/vendor fault code). */
  code: string;
  message?: string;
  active?: boolean;
}

/**
 * RAW native Euromap readout (what a 63 file-session / 77 OPC-UA / 83 MQTT connector
 * hands us). All optional; NOTHING is synthesised here — this is the input contract.
 */
export interface EuromapNativeReadout {
  transport?: EuromapTransport;
  /** Vendor key for alarm normalization (defaults to "euromap"). */
  vendor?: string;
  /** Active mold/recipe id (Euromap 77 ActiveMold / 63 job name). Maps to recipe_id. */
  activeMoldId?: string | number;
  recipeName?: string;
  /** Last completed cycle time in seconds (Euromap ActualCycleTime). */
  actualCycleTimeSec?: number;
  /** Cumulative shot/cycle counter. Maps to cycle_count + production_counter base. */
  shotCounter?: number;
  /** Good parts counter (Euromap GoodPartsCounter). Maps to production_counter. */
  goodPartsCounter?: number;
  /** Target cycle time (s) — used with actual for a utilization proxy. */
  targetCycleTimeSec?: number;
  /** Machine mode/state (e.g. "AUTOMATIC","SEMI_AUTOMATIC","MANUAL","STOPPED"). */
  machineMode?: string;
  alarms?: EuromapAlarm[];
  at?: Date;
}

/** Read-only snapshot returned by the adapter (UEM + framework honesty fields). */
export interface EuromapSnapshot extends UnifiedEquipmentSnapshot {
  connected: boolean;
  source: "live" | "cache" | "none";
  vendor: string;
  transport: EuromapTransport | null;
  caveat: string;
  at: Date | null;
}

/**
 * Utilization proxy: prefer the machine mode; if a target cycle time is known use
 * the ratio target/actual (capped to 1). Read-only heuristic, fail-safe → null.
 */
export function utilizationFromMode(raw: EuromapNativeReadout): number | null {
  const mode = raw.machineMode?.trim().toUpperCase();
  if (mode === "AUTOMATIC" || mode === "FULLY_AUTOMATIC") {
    if (raw.targetCycleTimeSec && raw.actualCycleTimeSec && raw.actualCycleTimeSec > 0) {
      return Math.max(0, Math.min(1, raw.targetCycleTimeSec / raw.actualCycleTimeSec));
    }
    return 1;
  }
  if (mode === "SEMI_AUTOMATIC") return 0.5;
  if (mode === "MANUAL" || mode === "STOPPED" || mode === "SETUP") return 0;
  return null;
}

/**
 * PURE mapper: native Euromap readout → Unified Equipment Model + normalized alarm.
 * The first ACTIVE alarm (or the first alarm) is normalized via the supplied taxonomy
 * entries (defaults to the seed). No I/O, no fabrication.
 */
export function mapEuromapToUem(
  raw: EuromapNativeReadout,
  entries?: AlarmMapping[],
): UnifiedEquipmentSnapshot {
  const recipeId =
    raw.recipeName != null && String(raw.recipeName).trim() !== ""
      ? String(raw.recipeName)
      : raw.activeMoldId != null
        ? String(raw.activeMoldId)
        : null;

  const vendor = raw.vendor?.trim() || EUROMAP_VENDOR_DEFAULT;
  const alarms = Array.isArray(raw.alarms) ? raw.alarms : [];
  const top = alarms.find((a) => a.active) ?? alarms[0];
  const alarmCode = top?.code?.trim() ? top.code.trim() : null;
  const normalizedAlarm = alarmCode
    ? { nativeCode: alarmCode, ...mapAlarm(vendor, alarmCode, entries) }
    : null;

  return {
    recipeId,
    cycleCount: typeof raw.shotCounter === "number" ? raw.shotCounter : null,
    productionCounter:
      typeof raw.goodPartsCounter === "number"
        ? raw.goodPartsCounter
        : typeof raw.shotCounter === "number"
          ? raw.shotCounter
          : null,
    utilizationRate: utilizationFromMode(raw),
    alarmCode,
    normalizedAlarm,
  };
}

/**
 * Euromap read-only monitoring adapter. Lazy: constructing it opens NOTHING. A future
 * connector pushes native readouts via `ingest()`; orchestration reads `readSnapshot()`
 * which serves the last-known value from the local CACHE when no live readout exists.
 */
export class EuromapAdapter {
  private last: {
    raw: EuromapNativeReadout;
    uem: UnifiedEquipmentSnapshot;
    transport: EuromapTransport | null;
    at: Date;
  } | null = null;

  constructor(
    public readonly machineCode: string,
    private readonly entries?: AlarmMapping[],
  ) {}

  /** Feed a native readout from a connector. Updates the local cache. Returns the UEM. */
  ingest(raw: EuromapNativeReadout): UnifiedEquipmentSnapshot {
    const uem = mapEuromapToUem(raw, this.entries);
    this.last = { raw, uem, transport: raw.transport ?? null, at: raw.at ?? new Date() };
    return uem;
  }

  /** Last-known cached UEM (or null). Survives connection drops. */
  getCached(): { uem: UnifiedEquipmentSnapshot; transport: EuromapTransport | null; at: Date } | null {
    return this.last ? { uem: this.last.uem, transport: this.last.transport, at: this.last.at } : null;
  }

  /**
   * Read-only snapshot. With no transport connected this returns the cached value
   * (source:'cache') or an empty honest snapshot (source:'none'). It NEVER fabricates
   * telemetry and NEVER opens a connection.
   */
  readSnapshot(): EuromapSnapshot {
    const cached = this.getCached();
    const base: UnifiedEquipmentSnapshot = cached?.uem ?? {
      recipeId: null,
      cycleCount: null,
      productionCounter: null,
      utilizationRate: null,
      alarmCode: null,
      normalizedAlarm: null,
    };
    return {
      ...base,
      connected: false, // no transport connected — honest
      source: cached ? "cache" : "none",
      vendor: EUROMAP_VENDOR_DEFAULT,
      transport: cached?.transport ?? null,
      caveat: EUROMAP_CAVEAT,
      at: cached?.at ?? null,
    };
  }

  /** Honest connectivity probe — no transport is connected, so never ok. */
  testConnection(): { ok: false; vendor: string; readOnly: true; caveat: string } {
    return { ok: false, vendor: EUROMAP_VENDOR_DEFAULT, readOnly: true, caveat: EUROMAP_CAVEAT };
  }
}
