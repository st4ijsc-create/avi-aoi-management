/**
 * doc 81 Đợt 5 task F fix scan (ruling R-5-h) — SERVER-DERIVED provenance of a safety event.
 *
 * A safety event may make its notice SAFETY-CRITICAL (bypass the recipients' in-app opt-outs, rulesEngine
 * `isSafetyCriticalSafetyEvent`) ONLY when the server itself created it on a DEVICE-INGEST code path. Caller-supplied
 * fields (eventType / detectedBy / handledBy / source — settable through safety.recordEvent, evaluateZones,
 * readSafetyPlc's injected status, API or MQTT payloads) are never trusted for that decision.
 *
 * The marker lives HERE, in process memory, keyed by the DB-assigned `safety_events.id` (no router writes it; no input
 * schema has a field for it). It is set ONLY by safetyAuditService.recordFromDeviceIngest — which is called ONLY by the
 * device-ingest paths listed in TRUSTED_SAFETY_ORIGINS (a census test pins both call-site sets and forbids any import
 * from server/routers, server/routes, server/api). The marker also records the event TYPE the server wrote, so a payload
 * re-using a trusted id with another type gains nothing.
 * Bounded: at most TRUSTED_SAFETY_MARKS_MAX entries, each kept TRUSTED_SAFETY_MARK_TTL_MS (the notice is decided in the
 * same tick as the emit, so a short TTL suffices); a full map evicts its oldest entries. A missing mark ⇒ NOT trusted ⇒
 * the notice is a NORMAL one (still delivered, preferences apply).
 */

/**
 * The device-ingest origins (today TWO):
 *   • "robot_telemetry" — robotIngest's e-stop TRANSITION from a robot whose driver the server itself polls on a configured
 *     endpoint (vendors TRUSTED_ROBOT_TELEMETRY_VENDORS: fanuc, mitsubishi, techman). Not "sim", not the "delta" mock, not
 *     the UR(sim) bridge, not "vda5050" (state arrives over MQTT topics, whose publisher identity is the broker's).
 *   • "safety_plc" — doc 81 Đợt 8 N2: the BACKGROUND safety-PLC poller (safetyPlcPoller.ts, flag SAFETY_PLC_POLLER_ENABLED)
 *     reading a REAL backend (the adapter's OtReadSafetyPlcBackend: modbus / opcua on the config's endpoint) on its own
 *     timer — no request, no payload, no injected status. Trusted types: an e-stop PRESSED transition and a guard / light
 *     curtain TRIP (zone occupied). Its other events (released, reset required, muting, PLC offline/online) are marked but
 *     not of a trusted type ⇒ normal notices. The sim backend is never trusted. Trust anchor (N fix 1, owner decision I1 —
 *     MAKER-CHECKER; final wave F4 corrects the earlier text): the config row's CURRENT content (endpoint, tag map, target,
 *     scope, enabled — safetyPlcTrust.plcTrustDigest) must equal a digest APPROVED by a second admin who did not edit it
 *     since the last approval (safety_plc_config_trust, migration 0368); every router edit clears the approval. Not
 *     approved / changed / undecidable (lookup error, table missing) ⇒ the event is recorded through the PLAIN door
 *     (normal notice).
 * Not here (documented): the user-triggered safety.readSafetyPlc (can inject a scripted status — plain record()),
 * vision/zone evaluation (detections are injected through safety.evaluateZones),
 * the interlock engine's advisory mapping, the Andon dispatch, field-health lost_connection, safety.recordEvent.
 */
export type TrustedSafetyOrigin = "robot_telemetry" | "safety_plc";

/** Which event TYPES each origin may make safety-critical (physical types only). */
export const TRUSTED_ORIGIN_EVENT_TYPES: Readonly<Record<TrustedSafetyOrigin, ReadonlySet<string>>> = {
  robot_telemetry: new Set(["estop"]),
  safety_plc: new Set(["estop", "zone_intrusion"]),
};

/** Robot vendors whose telemetry the server polls itself from a configured controller endpoint (see "robot_telemetry"). */
export const TRUSTED_ROBOT_TELEMETRY_VENDORS: ReadonlySet<string> = new Set(["fanuc", "mitsubishi", "techman"]);

export const TRUSTED_SAFETY_MARKS_MAX = 10_000;
export const TRUSTED_SAFETY_MARK_TTL_MS = 10 * 60_000;

const marks = new Map<number, { origin: TrustedSafetyOrigin; eventType: string; at: number }>();

/** Called ONLY by safetyAuditService.recordFromDeviceIngest (census), right after the insert, before the emit. */
export function markTrustedSafetyEvent(eventId: number, origin: TrustedSafetyOrigin, eventType: string, now = Date.now()): void {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) return;
  marks.delete(eventId);
  marks.set(eventId, { origin, eventType, at: now });
  if (marks.size > TRUSTED_SAFETY_MARKS_MAX) {
    for (const [id, m] of marks) {
      if (marks.size <= TRUSTED_SAFETY_MARKS_MAX && now - m.at < TRUSTED_SAFETY_MARK_TTL_MS) break;
      marks.delete(id); // Map keeps insertion order ⇒ oldest first
    }
  }
}

/** The server-recorded origin + type of `eventId`, or null (unknown / expired / never marked ⇒ not trusted). */
export function trustedSafetyOriginOf(eventId: unknown, now = Date.now()): { origin: TrustedSafetyOrigin; eventType: string } | null {
  if (typeof eventId !== "number" || !Number.isSafeInteger(eventId)) return null;
  const m = marks.get(eventId);
  if (!m) return null;
  if (now - m.at >= TRUSTED_SAFETY_MARK_TTL_MS) {
    marks.delete(eventId);
    return null;
  }
  return { origin: m.origin, eventType: m.eventType };
}

/** Test seams. */
export function _trustedSafetyMarksSizeForTests(): number {
  return marks.size;
}
export function _resetTrustedSafetyMarksForTests(): void {
  marks.clear();
}
