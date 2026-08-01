/**
 * SECS/GEM live-dispatch WIRING (doc 37 P0-6) — bind the HSMS inbound loop's
 * decoded S5F1 alarms / S6F11 events to the platform's alarm-bridge + an event sink.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * This is the module that finally gives `adapterAlarmBridge.raiseFromGemAlarm` a
 * REAL runtime caller. Until now that function was a wired-but-uncalled seam
 * (only its own unit test exercised it): the HSMS client had no inbound
 * message-dispatch loop, so a live S5F1 alarm never reached it. `attachGemAlarmDispatch`
 * closes that gap — it calls `client.enableLiveDispatch()` with handlers that route:
 *   - a decoded S5F1 → `raiseFromGemAlarm({ alid=ALID, set=ALCD bit8, text=ALTX })`
 *     → the SAME E1 ISA-18.2 taxonomy + Andon path every other adapter uses,
 *   - a decoded S6F11 → an optional `onEvent` sink (the platform inserts the
 *     process_results / telemetry row; kept out of this framework module).
 *
 * ── FLAG CHAIN (three gates, all default OFF) ────────────────────────────────
 *   1. SECS_GEM_ENABLED       — permits an HSMS connection at all (hsmsClient).
 *   2. SECS_GEM_LIVE_ENABLED  — permits the inbound dispatch loop to attach
 *                               (enableLiveDispatch throws if either 1 or 2 is off).
 *   3. EQ_INTEG_ENABLED       — permits raiseFromGemAlarm to actually normalize +
 *                               raise an Andon; with it OFF, the alarm is still
 *                               decoded + acked (S5F2) but raiseFromGemAlarm is a
 *                               NO-OP (returns { raised:false }) — honest, no Andon.
 * So a live alarm reaches the Andon board ONLY when ALL THREE flags are true and an
 * HSMS session has been established; anything less is a decode/ack-only no-op.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { HsmsClient } from "./hsmsClient";
import type { ParsedS5F1, ParsedS6F11, LiveDispatchHandlers } from "./s5s6Messages";
import { raiseFromGemAlarm, type GemAlarmLike } from "../equipment/adapterAlarmBridge";
import type { NormalizedAlarmResult } from "../equipment/alarmNormalizer";

/** Options binding a SECS/GEM equipment to the platform alarm/event surfaces. */
export interface GemAlarmDispatchOptions {
  /** Platform machine code this equipment maps to (traceability on the alarm). */
  machineCode?: string;
  /** Platform machine id (if already resolved) — threaded onto the raised alarm. */
  machineId?: number | null;
  /** Vendor key for the E1 taxonomy lookup (defaults to 'secsgem' in the bridge). */
  vendor?: string;
  /**
   * Optional sink for a decoded S6F11 collection event. The framework does NOT
   * insert the process_results / telemetry row itself (that needs DB + machineId
   * resolution, out of scope for this connectivity module) — it hands the decoded
   * event to the caller, who owns the insert. The S6F12 ack is sent regardless.
   */
  onEvent?: (event: ParsedS6F11) => void | Promise<void>;
  /** Optional observer fired after each alarm is routed (result + raw S5F1). */
  onAlarmRouted?: (result: NormalizedAlarmResult, alarm: ParsedS5F1) => void;
}

/**
 * Attach the GEM alarm/event dispatch to an HSMS client. Calls
 * `client.enableLiveDispatch()` (which is flag-gated on SECS_GEM_ENABLED +
 * SECS_GEM_LIVE_ENABLED and throws if either is off), wiring S5F1 → raiseFromGemAlarm.
 * Returns the disposer from enableLiveDispatch. Intended to be called AFTER a
 * successful establishCommunications() on a real bring-up.
 */
export function attachGemAlarmDispatch(client: HsmsClient, opts: GemAlarmDispatchOptions = {}): () => void {
  const handlers: LiveDispatchHandlers = {
    onAlarm: async (alarm: ParsedS5F1) => {
      const gemAlarm: GemAlarmLike = {
        machineCode: opts.machineCode,
        machineId: opts.machineId ?? null,
        alid: alarm.alid,
        // ALCD bit 8 → SET (true) raises; CLEAR (false) is a no-op raise in the bridge.
        set: alarm.set,
        message: alarm.altx || `GEM alarm ${alarm.alid}`,
        vendor: opts.vendor,
      };
      const result = await raiseFromGemAlarm(gemAlarm);
      opts.onAlarmRouted?.(result, alarm);
    },
    onEvent: opts.onEvent,
  };
  return client.enableLiveDispatch(handlers);
}
