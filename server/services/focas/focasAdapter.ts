/**
 * FOCAS (Fanuc CNC) Connectivity FRAMEWORK — I1 (doc 16 §6 / §15).  Flag: EQ_INTEG_ENABLED.
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This is a READ-ONLY MONITORING FRAMEWORK, **not** a live FOCAS driver. There is
 * NO real Fanuc device attached and NO telemetry is fabricated. The module models:
 *   - the FOCAS *read* function shapes the platform cares about (cnc_rdexecprog /
 *     NC program id, cnc_rdcncid, cnc_rdalmmsg / active alarms, the cycle/part
 *     counters cnc_rdparam P6711/P6712 and run state cnc_statinfo),
 *   - a normaliser that maps those native fields → the Unified Equipment Model
 *     (recipe_id, cycle_count, alarm_code, utilization_rate, production_counter),
 *   - a fail-safe local last-value CACHE so orchestration keeps a last-known
 *     snapshot when the (future) connection drops.
 *
 * The REAL seam: FOCAS is a proprietary Fanuc C library (`Fwlib32`) reached over
 * HSSB or Ethernet (focas2). A production bring-up wraps that native library
 * (typically a small sidecar/connector that POSTs readings here) and validates the
 * exact P-parameter numbers + alarm tables PER MACHINE/control series (0i/30i/…).
 * Until then `readSnapshot()` returns `{ connected:false, source:"cache"|"none" }`
 * and never invents values. testConnection() is honest: it reports the framework
 * caveat and that no native FOCAS library is linked.
 *
 * SAFETY: read-only. This module opens NO control path. CNC start/stop still routes
 * through the EXISTING gated dispatcher via the unified EquipmentAdapter facade.
 */
import { mapAlarm, type AlarmMapping, type NormalizedAlarm } from "../standards/alarmTaxonomy";

/** Master flag — default OFF (mirrors isSecsGemEnabled / eqGovernEnabled). */
export function isEqIntegEnabled(): boolean {
  return process.env.EQ_INTEG_ENABLED === "true";
}

export const FOCAS_VENDOR = "fanuc" as const;

export const FOCAS_CAVEAT =
  "FRAMEWORK (read-only monitoring): no native FOCAS (Fwlib32) library is linked and " +
  "no real Fanuc CNC is attached. A production bring-up wraps Fwlib32 over HSSB/Ethernet " +
  "and validates the P-parameter numbers + alarm tables per control series. No telemetry " +
  "is fabricated.";

/** FOCAS read-function shapes the platform consumes (subset, read-only). */
export const FOCAS_READ_FUNCTIONS = [
  "cnc_rdexecprog", // running NC program number/name → recipe_id
  "cnc_rdcncid", // controller id
  "cnc_statinfo", // run/auto/edit/alarm status → utilization
  "cnc_rdparam", // P-parameters: P6711 part count total, P6712 part count required
  "cnc_rdalmmsg", // active alarm messages → alarm_code
] as const;
export type FocasReadFunction = (typeof FOCAS_READ_FUNCTIONS)[number];

/** A native FOCAS alarm message (cnc_rdalmmsg ALMMSG entry). */
export interface FocasAlarm {
  /** Alarm number (native). */
  almNo: number;
  /** Alarm type/group code (e.g. PS, OT, SV, SP, MC) — used to build the native code. */
  type?: string;
  message?: string;
}

/**
 * RAW native FOCAS read result (what a real connector/sidecar would hand us). All
 * fields optional — a real device may not expose every one. NOTHING here is
 * synthesised by this module; it is the input contract for a future connector.
 */
export interface FocasNativeReadout {
  /** Running NC program number/name (cnc_rdexecprog). Maps to recipe_id. */
  programNumber?: string | number;
  programName?: string;
  /** Controller id (cnc_rdcncid). */
  cncId?: string;
  /** Total parts produced (cnc_rdparam P6711). Maps to production_counter. */
  partCountTotal?: number;
  /** Cycle/run count for the active program. Maps to cycle_count. */
  cycleCount?: number;
  /** Run status from cnc_statinfo (e.g. "START","STOP","HOLD","MSTR","RESET"). */
  runStatus?: string;
  /** Auto/manual mode (e.g. "MEM","MDI","EDIT","JOG"). */
  mode?: string;
  /** Active alarms (cnc_rdalmmsg). */
  alarms?: FocasAlarm[];
  /** Source timestamp if the connector provided one. */
  at?: Date;
}

/** The Unified Equipment Model projection (doc 16 §6 #1). */
export interface UnifiedEquipmentSnapshot {
  recipeId: string | null;
  cycleCount: number | null;
  productionCounter: number | null;
  utilizationRate: number | null;
  /** Native alarm code present right now (highest-priority), or null. */
  alarmCode: string | null;
  /** Normalized alarm (via alarmTaxonomy) when an alarm is present. */
  normalizedAlarm: (NormalizedAlarm & { nativeCode: string }) | null;
}

/** A read-only snapshot returned by the adapter. */
export interface FocasSnapshot extends UnifiedEquipmentSnapshot {
  connected: boolean;
  /** 'live' (a connector supplied a readout), 'cache' (last-known), or 'none'. */
  source: "live" | "cache" | "none";
  vendor: typeof FOCAS_VENDOR;
  caveat: string;
  at: Date | null;
}

/**
 * Build the native FOCAS alarm code string the alarm taxonomy is keyed on.
 * Fanuc alarms are addressed by a type prefix + number (e.g. "PS0010","OT0500").
 */
export function focasAlarmCode(a: FocasAlarm): string {
  const prefix = (a.type ?? "").trim().toUpperCase();
  const num = Number.isFinite(a.almNo) ? String(a.almNo) : "";
  return prefix ? `${prefix}${num}` : num || "UNKNOWN";
}

/** Derive a 0..1 utilization proxy from the FOCAS run status (read-only heuristic). */
export function utilizationFromRunStatus(runStatus?: string): number | null {
  if (!runStatus) return null;
  const s = runStatus.trim().toUpperCase();
  if (s === "START" || s === "MSTR") return 1;
  if (s === "HOLD" || s === "MSTP") return 0.5;
  if (s === "STOP" || s === "RESET") return 0;
  return null;
}

/**
 * PURE mapper: native FOCAS readout → Unified Equipment Model + normalized alarm.
 * The highest-numbered alarm (typically the most recent/severe) is normalized via
 * the supplied taxonomy entries (defaults to the seed). No I/O, no fabrication.
 */
export function mapFocasToUem(
  raw: FocasNativeReadout,
  entries?: AlarmMapping[],
): UnifiedEquipmentSnapshot {
  const recipeId =
    raw.programName != null && String(raw.programName).trim() !== ""
      ? String(raw.programName)
      : raw.programNumber != null
        ? String(raw.programNumber)
        : null;

  const alarms = Array.isArray(raw.alarms) ? raw.alarms : [];
  const top = alarms.length
    ? alarms.slice().sort((a, b) => (b.almNo ?? 0) - (a.almNo ?? 0))[0]
    : undefined;
  const alarmCode = top ? focasAlarmCode(top) : null;
  const normalizedAlarm = alarmCode
    ? { nativeCode: alarmCode, ...mapAlarm(FOCAS_VENDOR, alarmCode, entries) }
    : null;

  return {
    recipeId,
    cycleCount: typeof raw.cycleCount === "number" ? raw.cycleCount : null,
    productionCounter: typeof raw.partCountTotal === "number" ? raw.partCountTotal : null,
    utilizationRate: utilizationFromRunStatus(raw.runStatus),
    alarmCode,
    normalizedAlarm,
  };
}

/**
 * FOCAS read-only monitoring adapter. Lazy: constructing it opens NOTHING. A future
 * connector pushes native readouts via `ingest()`; orchestration reads `readSnapshot()`
 * which serves the last-known value from the local CACHE when no live readout exists.
 *
 * One instance per machine (keyed by machineCode). The static cache mirrors the
 * mtconnect/edge last-value pattern so a dropped connection still has a snapshot.
 */
export class FocasAdapter {
  private last: { raw: FocasNativeReadout; uem: UnifiedEquipmentSnapshot; at: Date } | null = null;

  constructor(
    public readonly machineCode: string,
    private readonly entries?: AlarmMapping[],
  ) {}

  /** Feed a native readout from a connector. Updates the local cache. Returns the UEM. */
  ingest(raw: FocasNativeReadout): UnifiedEquipmentSnapshot {
    const uem = mapFocasToUem(raw, this.entries);
    this.last = { raw, uem, at: raw.at ?? new Date() };
    return uem;
  }

  /** Last-known cached UEM (or null). Survives connection drops. */
  getCached(): { uem: UnifiedEquipmentSnapshot; at: Date } | null {
    return this.last ? { uem: this.last.uem, at: this.last.at } : null;
  }

  /**
   * Read-only snapshot. With no native connector linked this returns the cached
   * value (source:'cache') or an empty honest snapshot (source:'none'). It NEVER
   * fabricates telemetry and NEVER opens a socket.
   */
  readSnapshot(): FocasSnapshot {
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
      connected: false, // no native library linked — honest
      source: cached ? "cache" : "none",
      vendor: FOCAS_VENDOR,
      caveat: FOCAS_CAVEAT,
      at: cached?.at ?? null,
    };
  }

  /** Honest connectivity probe — there is no native FOCAS library, so never ok. */
  testConnection(): { ok: false; vendor: typeof FOCAS_VENDOR; readOnly: true; caveat: string } {
    return { ok: false, vendor: FOCAS_VENDOR, readOnly: true, caveat: FOCAS_CAVEAT };
  }
}
