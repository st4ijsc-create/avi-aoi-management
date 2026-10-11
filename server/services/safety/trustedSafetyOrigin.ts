/**
 * doc 81 Đợt 5 task F fix scan (ruling R-5-h) — SERVER-DERIVED provenance of a safety event.
 *
 * A safety event may make its notice SAFETY-CRITICAL (bypass the recipients' in-app opt-outs, rulesEngine
 * `consumeSafetyCriticalTrust`) ONLY when the server itself created it on a DEVICE-INGEST code path. Caller-supplied
 * fields (eventType / detectedBy / handledBy / source — settable through safety.recordEvent, evaluateZones,
 * readSafetyPlc's injected status, API or MQTT payloads) are never trusted for that decision.
 *
 * doc 81 Đợt 9 task U3 (owner decision 2026-10-12, "bind trust to durable rows, never to instance memory") — the trust is a
 * DURABLE row (table safety_event_trust, migration 0371), no longer an in-process mark:
 *   • written ONLY by safetyAuditService.recordFromDeviceIngest, in the SAME transaction as the safety_events row (an event
 *     row without its trust row, or the reverse, cannot exist), and only for the types its origin may make safety-critical;
 *   • bound to the event's content: `digest` = sha256 of (id, type, robot, station, line, near-miss) — what the notice uses
 *     (trustedEventDigest, the one place it is computed);
 *   • CONSUMED EXACTLY ONCE in the DB by the rules engine: one UPDATE … WHERE consumedAt IS NULL AND digest = $d AND fresh
 *     RETURNING. A second consumer — another instance receiving the same event over the Redis fan-out, a replayed / forged
 *     bus message with the same id, an altered machine / type (digest mismatch) — gets nothing ⇒ a NORMAL notice. The DB
 *     trigger makes consumption one-way (a consumed row can never be re-armed; its content is immutable).
 * Undecidable (table missing, DB error, timeout) ⇒ NOT trusted ⇒ a normal notice (still delivered; preferences apply).
 * L-7: nothing here is on a STOP path; it only decides whether a NOTICE may bypass opt-outs.
 */
import { createHash } from "node:crypto";
import os from "node:os";
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { DbUnavailableError } from "../../_core/dbErrors";

/**
 * The device-ingest origins (today TWO):
 *   • "robot_telemetry" — robotIngest's e-stop TRANSITION from a robot whose driver the server itself polls on a configured
 *     endpoint (vendors TRUSTED_ROBOT_TELEMETRY_VENDORS: fanuc, mitsubishi, techman). Not "sim", not the "delta" mock, not
 *     the UR(sim) bridge, not "vda5050" (state arrives over MQTT topics, whose publisher identity is the broker's).
 *   • "safety_plc" — doc 81 Đợt 8 N2: the BACKGROUND safety-PLC poller (safetyPlcPoller.ts, flag SAFETY_PLC_POLLER_ENABLED)
 *     reading a REAL backend (the adapter's OtReadSafetyPlcBackend: modbus / opcua on the config's endpoint) on its own
 *     timer — no request, no payload, no injected status. Trusted types: an e-stop PRESSED transition and a guard / light
 *     curtain TRIP (zone occupied). Its other events (released, reset required, muting, PLC offline/online) are recorded
 *     through the same door but get no trust row (not a trusted type) ⇒ normal notices. The sim backend is never trusted.
 *     Trust anchor (N fix 1, owner decision I1 — MAKER-CHECKER): the config row's CURRENT content (endpoint, tag map incl.
 *     the Đợt 9 U2 latch tag, target, scope, enabled — safetyPlcTrust.plcTrustDigest) must equal a digest APPROVED by a
 *     second admin who did not edit it since the last approval (safety_plc_config_trust, migration 0368). Not approved /
 *     changed / undecidable ⇒ the event is recorded through the PLAIN door (normal notice).
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

/**
 * Đợt 9 U3 — a trust row may be consumed only within this time after it was written (DB clock). The legitimate consumer
 * (the rules engine of the instance that emitted, or of a fan-out receiver) runs within milliseconds; the bound only shortens
 * the window in which a never-consumed row could be used by a replay. (Was 10 min for the in-memory mark.)
 */
export const TRUSTED_SAFETY_TRUST_TTL_MS = 60_000;
/** Bound of ONE consume (a hung DB ⇒ not trusted ⇒ a normal notice; the notice itself is never delayed beyond this). */
export const TRUSTED_SAFETY_CONSUME_TIMEOUT_MS = 2000;
export const TRUSTED_EVENT_DIGEST_VERSION = "safety-event-trust-v1";

/** The event content a trust row is bound to (the realtime payload carries the same fields). */
export interface TrustedEventContent {
  id?: unknown;
  eventType?: unknown;
  robotId?: unknown;
  stationId?: unknown;
  lineId?: unknown;
  isNearMiss?: unknown;
}

/** The normalised identity of a safety event — what BOTH the digest and the notice (machine, keys) are built from. */
export interface TrustedEventIdentity {
  id: number;
  eventType: string;
  robotId: number | null;
  stationId: number | null;
  lineId: number | null;
  isNearMiss: boolean;
}

const optId = (v: unknown): number | null | undefined => (v == null ? null : typeof v === "number" && Number.isSafeInteger(v) ? v : undefined);

/**
 * doc 81 Đợt 9 U fix 1 (review I1) — the ONE normaliser. null (⇒ never trusted, nothing consumed) unless: id is a positive
 * safe integer, eventType a string, every PRESENT robot / station / line id a safe integer, isNearMiss absent or boolean.
 * (Before, a non-integer id was silently mapped to null for the digest while the notice used the raw value: a replay with
 * robotId:"999" kept the digest of a station event and redirected the bypass notice to "robot:999".)
 */
export function trustedEventIdentity(e: TrustedEventContent): TrustedEventIdentity | null {
  const id = optId(e.id);
  if (id == null || id <= 0) return null;
  if (typeof e.eventType !== "string") return null;
  const robotId = optId(e.robotId);
  const stationId = optId(e.stationId);
  const lineId = optId(e.lineId);
  if (robotId === undefined || stationId === undefined || lineId === undefined) return null;
  if (e.isNearMiss != null && typeof e.isNearMiss !== "boolean") return null;
  return { id, eventType: e.eventType, robotId, stationId, lineId, isNearMiss: e.isNearMiss === true };
}

/** The notice's machine string (most specific first: robot > station > line), from the NORMALISED identity. */
export function safetyNoticeMachine(i: Pick<TrustedEventIdentity, "robotId" | "stationId" | "lineId">): string {
  return i.robotId != null ? `robot:${i.robotId}` : i.stationId != null ? `station:${i.stationId}` : i.lineId != null ? `line:${i.lineId}` : "unknown";
}

/**
 * sha256 (hex) of what a safety notice is built from: id, type, robot / station / line, near-miss — of the NORMALISED identity
 * (trustedEventIdentity). The ONE digest function (the writer — safetyAuditService — and the consumer — rulesEngine — both
 * call it). null ⇔ the content does not normalise (never trusted).
 */
export function trustedEventDigest(e: TrustedEventContent): string | null {
  const i = trustedEventIdentity(e);
  if (!i) return null;
  const material = [TRUSTED_EVENT_DIGEST_VERSION, i.id, i.eventType, i.robotId, i.stationId, i.lineId, i.isNearMiss];
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

/** A DB handle (drizzle db or transaction) that can run raw SQL. */
export interface SqlRunner {
  execute(q: ReturnType<typeof sql>): Promise<unknown>;
}

/** Durable trust storage. mark / consume THROW on failure (callers decide: mark ⇒ fall back / fail, consume ⇒ not trusted). */
export interface TrustedEventStore {
  /** Insert the trust row of a JUST-INSERTED event, inside the caller's transaction `tx`. */
  mark(tx: SqlRunner, row: { eventId: number; origin: TrustedSafetyOrigin; eventType: string; digest: string }): Promise<void>;
  /** Consume (eventId, digest) once: the stored origin + type, or null (none / consumed / stale / other digest). */
  consume(eventId: number, digest: string, opts: { ttlMs: number; consumer: string }): Promise<{ origin: string; eventType: string } | null>;
}

/** This instance's name in consumedBy (informational: which instance's rules engine got the bypass). */
export const TRUST_CONSUMER_ID = `${os.hostname()}:${process.pid}`.slice(0, 64);

/** The production store: table safety_event_trust (migration 0371). */
export const pgTrustedEventStore: TrustedEventStore = {
  async mark(tx, r) {
    await tx.execute(sql`
      INSERT INTO safety_event_trust ("eventId", origin, "eventType", digest)
      VALUES (${r.eventId}, ${r.origin}, ${r.eventType}, ${r.digest})`);
  },
  async consume(eventId, digest, o) {
    const d = await getDb();
    if (!d) throw new DbUnavailableError();
    const rows = (await d.execute(sql`
      UPDATE safety_event_trust SET "consumedAt" = now(), "consumedBy" = ${o.consumer.slice(0, 64)}
       WHERE "eventId" = ${eventId} AND "consumedAt" IS NULL AND digest = ${digest}
         AND "createdAt" > now() - make_interval(secs => ${o.ttlMs / 1000})
      RETURNING origin, "eventType"`)) as unknown as Array<{ origin: string; eventType: string }>;
    return rows[0] ? { origin: String(rows[0].origin), eventType: String(rows[0].eventType) } : null;
  },
};

let store: TrustedEventStore = pgTrustedEventStore;
export function trustedEventStore(): TrustedEventStore {
  return store;
}

/**
 * Test seam — replace the durable store (unit tests without a DB). Refused in production: the trust decision must always be
 * the durable one there.
 */
export function _setTrustedEventStoreForTests(s: TrustedEventStore | null): void {
  if (process.env.NODE_ENV === "production") {
    // fail closed: the durable store stays in force (a replacement is ignored, loudly)
    console.error("[Safety] refused: the trusted-event store is not replaceable in production (the durable store stays in force)");
    return;
  }
  store = s ?? pgTrustedEventStore;
}

/**
 * Consume the trust of a safety event exactly once. Returns the server-recorded origin + type, or null: no usable id, no
 * trust row, already consumed (another instance / a replay), content changed (digest), expired, or undecidable (error /
 * timeout — bounded by TRUSTED_SAFETY_CONSUME_TIMEOUT_MS).
 */
export async function consumeTrustedSafetyOrigin(e: TrustedEventContent): Promise<{ origin: TrustedSafetyOrigin; eventType: string } | null> {
  const digest = trustedEventDigest(e); // null ⇔ the content does not normalise ⇒ nothing is consumed
  if (digest == null) return null;
  let t: NodeJS.Timeout | undefined;
  try {
    const got = await Promise.race([
      store.consume(e.id as number, digest, { ttlMs: TRUSTED_SAFETY_TRUST_TTL_MS, consumer: TRUST_CONSUMER_ID }),
      new Promise<null>((res) => {
        t = setTimeout(() => res(null), TRUSTED_SAFETY_CONSUME_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
    if (!got) return null;
    if (got.origin !== "robot_telemetry" && got.origin !== "safety_plc") return null;
    return { origin: got.origin, eventType: got.eventType };
  } catch (err) {
    console.warn("[Safety] trusted-origin consume failed (normal notice):", (err as Error)?.message ?? err);
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** PostgreSQL "undefined table / column" (migration 0371 not applied), on the error or its cause. */
export function isTrustTableMissing(e: unknown): boolean {
  const code = (x: unknown) => (x as { code?: unknown } | null)?.code;
  const c = code(e) ?? code((e as { cause?: unknown } | null)?.cause);
  return c === "42P01" || c === "42703";
}
