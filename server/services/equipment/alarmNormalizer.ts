/**
 * I1-c (doc 16 §6 #3 / §15) — Adapter → Andon ALARM NORMALIZATION wiring.
 * Flag: EQ_INTEG_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A THIN, ADDITIVE step that sits between an equipment adapter (mtconnect / secsgem /
 * focas / euromap / …) and the EXISTING andonService. When an adapter reports a raw
 * vendor alarm, this:
 *   1. calls alarmTaxonomy.mapAlarm(vendor, nativeCode) → {standardCode, severity,
 *      recommendedAction} (E1 ISA-18.2 dictionary), and
 *   2. raises a normalized Andon (standard code + ISA severity → Andon state/reason)
 *      instead of the raw vendor code.
 *
 * FLAG DISCIPLINE: when EQ_INTEG_ENABLED is OFF this module is a NO-OP — it returns
 * the unmodified raw alarm and raises NOTHING, so the current Andon behaviour is
 * unchanged (andon tests stay green). It opens NO control path; an Andon is a signal.
 *
 * DB-backed taxonomy entries OVERRIDE the in-memory seed when supplied by the caller
 * (the router has db access and passes them); with no entries the pure seed is used.
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  mapAlarm,
  type AlarmMapping,
  type AlarmSeverity,
  type NormalizedAlarm,
} from "../standards/alarmTaxonomy";
import {
  raiseAndon,
  type AndonState,
  type AndonReason,
  type RaiseAndonInput,
} from "../andon/andonService";
import type { AndonEvent } from "../../../drizzle/schema";

/** Same master flag as the FOCAS/Euromap frameworks. */
export function isEqIntegEnabled(): boolean {
  return process.env.EQ_INTEG_ENABLED === "true";
}

/** A raw vendor alarm reported by an adapter, before normalization. */
export interface RawVendorAlarm {
  vendor: string;
  nativeCode: string;
  /** Free-text vendor message (becomes part of the Andon body). */
  message?: string | null;
  machineId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  /** Which adapter kind surfaced it (mtconnect|secsgem|focas|euromap|…) — for context. */
  adapterKind?: string;
}

/** The result of a normalization (always returned, whether or not an Andon was raised). */
export interface NormalizedAlarmResult {
  /** The mapped taxonomy result (standardCode/severity/recommendedAction/mapped). */
  normalized: NormalizedAlarm;
  vendor: string;
  nativeCode: string;
  /** The Andon that was raised, or null when the flag is OFF (no-op). */
  andon: AndonEvent | null;
  /** True when EQ_INTEG_ENABLED was on and an Andon was raised. */
  raised: boolean;
}

/**
 * Map an ISA-18.2 severity band → an Andon visual state.
 *   critical|high → red (stop-the-line attention)
 *   medium|low|diagnostic → yellow (advisory)
 */
export function severityToAndonState(sev: AlarmSeverity): AndonState {
  return sev === "critical" || sev === "high" ? "red" : "yellow";
}

/**
 * Map a standard alarm code → an Andon reason category. Heuristic over the standard
 * code keywords; fail-safe → "maintenance" (the conventional default for equipment
 * faults, matching gemModel.mapAlarmToAndon).
 */
export function standardCodeToReason(standardCode: string): AndonReason {
  const c = standardCode.toUpperCase();
  if (c.includes("ESTOP") || c.includes("COLLISION") || c.includes("SAFETY") || c.includes("WORKSPACE")) {
    return "safety";
  }
  if (c.includes("QUALITY") || c.includes("DEFECT") || c.includes("REJECT")) return "quality";
  if (c.includes("MATERIAL") || c.includes("FEED") || c.includes("EMPTY") || c.includes("STARVE")) {
    return "material";
  }
  if (c.includes("SETUP") || c.includes("RECIPE") || c.includes("CHANGEOVER")) return "setup";
  return "maintenance";
}

/**
 * Build the RaiseAndonInput for a normalized alarm (pure — no I/O). Exposed for
 * unit-testing the mapping without touching the DB.
 */
export function buildAndonInput(
  raw: RawVendorAlarm,
  normalized: NormalizedAlarm,
): RaiseAndonInput {
  const state = severityToAndonState(normalized.severity);
  const reason = standardCodeToReason(normalized.standardCode);
  const codeLabel = normalized.mapped
    ? `${normalized.standardCode} (${raw.vendor}:${raw.nativeCode})`
    : `${raw.vendor}:${raw.nativeCode} [unmapped]`;
  const parts = [
    raw.message ? String(raw.message) : null,
    normalized.description ?? null,
    normalized.recommendedAction ? `Action: ${normalized.recommendedAction}` : null,
  ].filter((p): p is string => !!p);
  return {
    state,
    reason,
    title: `[${normalized.severity.toUpperCase()}] ${codeLabel}`.slice(0, 255),
    message: parts.length ? parts.join(" — ") : null,
    machineId: raw.machineId ?? null,
    stationId: raw.stationId ?? null,
    lineId: raw.lineId ?? null,
    raisedBySystem: true,
  };
}

/**
 * Normalize a raw vendor alarm and (when EQ_INTEG_ENABLED) raise a normalized Andon.
 *
 * ALWAYS returns the normalized mapping. When the flag is OFF it raises NOTHING and
 * returns `{ andon: null, raised: false }` — a complete no-op for existing behaviour.
 * Fail-safe: a failed Andon raise is swallowed (logged) so a reporting adapter's poll
 * loop is never broken by the alarm path.
 *
 * @param entries optional taxonomy entries (DB ∪ seed) — defaults to the pure seed.
 */
export async function normalizeAndRaise(
  raw: RawVendorAlarm,
  entries?: AlarmMapping[],
): Promise<NormalizedAlarmResult> {
  const normalized = mapAlarm(raw.vendor, raw.nativeCode, entries);

  // FLAG OFF → no-op passthrough. Existing Andon behaviour is unchanged.
  if (!isEqIntegEnabled()) {
    return { normalized, vendor: raw.vendor, nativeCode: raw.nativeCode, andon: null, raised: false };
  }

  let andon: AndonEvent | null = null;
  try {
    andon = await raiseAndon(buildAndonInput(raw, normalized));
  } catch (err) {
    console.error(
      `[alarmNormalizer] raiseAndon failed for ${raw.vendor}:${raw.nativeCode}:`,
      (err as Error)?.message ?? err,
    );
  }
  return { normalized, vendor: raw.vendor, nativeCode: raw.nativeCode, andon, raised: andon != null };
}
