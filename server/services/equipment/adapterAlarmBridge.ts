/**
 * N-6 (doc 18 §5) — ADAPTER → alarmNormalizer wiring bridge.  Flag: EQ_INTEG_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * I1 built alarmNormalizer.normalizeAndRaise (vendor+nativeCode → E1 ISA-18.2
 * standardCode/severity → Andon) but only the equipmentIntegrationRouter called it.
 * N-6 wires the RAW alarm/fault codes the equipment ADAPTERS already observe through
 * that SAME path, ADDITIVELY + flag-gated. When EQ_INTEG_ENABLED is OFF every helper
 * here is a complete NO-OP (returns { raised:false }) so current behaviour — and the
 * mtconnect / secsgem / andon tests — are unchanged.
 *
 * Two adapter surfaces exist today:
 *   • MTConnect — CONDITION DataItems in FAULT/WARNING (the poller already derives a
 *     pass/fail/warn result). raiseFromMtconnectCondition() routes those through the
 *     normalizer with vendor='mtconnect' + nativeCode = the condition's native code.
 *   • SECS/GEM — the framework's pure gemModel.mapAlarmToAndon already yields an
 *     Andon-shaped GemAlarmRecord. raiseFromGemAlarm() re-routes its ALID through the
 *     SAME E1 taxonomy so a SECS alarm is normalized identically to every other vendor
 *     (rather than the framework's ad-hoc mapping). Note: the SECS framework has no
 *     live message-dispatch loop today, so this is the seam a real GEM bring-up calls.
 *
 * ⚠ HONEST SEAM: the OT adapter (opcua/modbus/s7/eip/mc) ingest path is PURE TELEMETRY
 *   (server/services/ot/ingest.ts) — it has NO alarm/fault surface today, so there is
 *   nothing to wire there. Documented rather than invented. (An OT fault surface would
 *   be added when a driver exposes diagnostic/alarm registers.)
 * ════════════════════════════════════════════════════════════════════════════
 */
import {
  normalizeAndRaise,
  isEqIntegEnabled,
  type NormalizedAlarmResult,
  type RawVendorAlarm,
} from "./alarmNormalizer";

/** No-op result when the flag is off (matches normalizeAndRaise's off-path shape). */
function noop(vendor: string, nativeCode: string): NormalizedAlarmResult {
  return {
    normalized: {
      standardCode: "UNKNOWN_ALARM",
      severity: "medium",
      mapped: false,
      recommendedAction: "EQ_INTEG_ENABLED is off — alarm not normalized.",
    },
    vendor,
    nativeCode,
    andon: null,
    raised: false,
  };
}

/**
 * Route an MTConnect CONDITION fault/warning through the normalizer.
 * `nativeCode` is the condition's vendor code (nativeCode / dataItemId); the standard
 * MTConnect vendor key is 'mtconnect' so a shop can add per-code taxonomy mappings.
 * NO-OP passthrough when the flag is off.
 */
export async function raiseFromMtconnectCondition(input: {
  nativeCode: string;
  message?: string | null;
  machineId?: number | null;
  vendor?: string;
}): Promise<NormalizedAlarmResult> {
  const vendor = input.vendor ?? "mtconnect";
  if (!isEqIntegEnabled()) return noop(vendor, input.nativeCode);
  const raw: RawVendorAlarm = {
    vendor,
    nativeCode: input.nativeCode,
    message: input.message ?? null,
    machineId: input.machineId ?? null,
    adapterKind: "mtconnect",
  };
  return normalizeAndRaise(raw);
}

/** The subset of a gemModel.GemAlarmRecord this bridge consumes (avoids a hard dep). */
export interface GemAlarmLike {
  machineCode?: string;
  machineId?: number | null;
  alid: number;
  set: boolean;
  message?: string;
  /** Vendor key for taxonomy lookup — SECS equipment vendor, defaults to 'secsgem'. */
  vendor?: string;
}

/**
 * Route a SECS/GEM S5F1 alarm (already parsed into a GemAlarmRecord) through the SAME
 * E1 taxonomy + Andon path. Only alarm SET events raise; a CLEAR (set=false) is a
 * no-op raise (returns the mapping without an Andon). NO-OP when the flag is off.
 */
export async function raiseFromGemAlarm(alarm: GemAlarmLike): Promise<NormalizedAlarmResult> {
  const vendor = alarm.vendor ?? "secsgem";
  const nativeCode = String(alarm.alid);
  if (!isEqIntegEnabled() || !alarm.set) return noop(vendor, nativeCode);
  const raw: RawVendorAlarm = {
    vendor,
    nativeCode,
    message: alarm.message ?? null,
    machineId: alarm.machineId ?? null,
    adapterKind: "secsgem",
  };
  return normalizeAndRaise(raw);
}
