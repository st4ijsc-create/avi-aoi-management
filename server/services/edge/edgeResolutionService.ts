/**
 * doc 81 Đợt 10 task F2 — rulings R-10-af (resolve a STOP that could not be executed) and R-10-ax (resolve a crash-orphaned OT
 * write intent). Both are PERSON decisions recorded in WORM evidence; neither sends a byte to a device.
 *
 * READ (`listEdgeResolutionItems`) — what a person must look at:
 *   • `device_pending_stops` (mig 0374 view): every STOP nobody acknowledged, one row per chain head, with its flags —
 *     needsResolution (refused / failed: ONLY a person closes it), ownerCannotList (the edge owner cannot reach it ⇒ central
 *     executes), overdue (past expiresAt, still pending — a STOP never expires), undeliverable (its node has no active
 *     credential), centralMustExecute, stale. Rows a person already resolved (resolvedByHuman) are not listed.
 *   • unresolved OT write intents: `command_log` intent rows (status 'sent', ackValue.ledger 'intent', mig 1B Task 6) with NO
 *     result row linked by ackValue.intentId. Such an intent blocks the adapter's owner change for ever (0374
 *     device_owner_change_guard, fail-closed) until a result row exists.
 *   Both lists are limited to the caller's factory scope (factoryIds null = unrestricted; a device with no factory chain is
 *   shown only to an unrestricted caller). The scope is resolved by the router (strict: unreadable ⇒ refused).
 *
 * WRITE 1 (`resolvePendingStop`, R-10-af) — A's guarded `edge_stop_resolve(request, actor, resolution)` (SECURITY DEFINER,
 *   pinned): only a refused / failed STOP (needsResolution) that is not resolved yet; active user; ≥ 3 chars. The audit row and
 *   the resolution are written in ONE transaction (no audit ⇒ no resolution). The STOP stays visible as resolvedByHuman.
 * WRITE 2 (`resolveOrphanedIntent`, R-10-ax / R-10-bj) — the RESULT row of the intent, written ONLY by A's guarded
 *   public.ot_write_intent_resolve(intent, actor, reason) (SECURITY DEFINER, pinned; a trigger refuses any other writer of a
 *   manual-resolution result and any second result of an intent): status 'timeout' (the ledger's
 *   "outcome unknown": the write may or may not have reached the device), ackValue {ledger:'result', intentId, outcome:'unknown',
 *   resolvedByOperator, resolution}, idempotencyKey = the intent's own per-write result key (so a retry of that command key is
 *   answered from this result, never re-sent). Guards, all inside one transaction with a per-intent advisory lock:
 *     – the row is an intent, still without any linked result (re-checked under the lock);
 *     – it is at least INTENT_RESOLVE_MIN_AGE (10 min — the 0374 stale-write window, ≫ the bounded OT write) old in the DB's own
 *       clock: a younger intent may still be in flight in a live dispatcher;
 *     – the adapter is in the caller's factory scope; reason ≥ 3 chars; audit row in the same transaction.
 *   Consequence (truthful, fail-safe): a 'timeout' result keeps the adapter's owner change refused for the 10-minute stale-write
 *   window after the resolution (0374), then it is free. The DB re-checks every guard itself (ot_write_intent_resolve) — the
 *   pre-checks here only give clear answers and the factory-scope NOT_FOUND parity; a 23514 is mapped by mapIntentResolveRefusal.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { DbUnavailableError } from "../../_core/dbErrors";

/** = the 0374 device_owner_change_guard stale-write window. */
export const INTENT_RESOLVE_MIN_AGE_MINUTES = 10;
export const EDGE_RESOLUTION_LIST_LIMIT = 200;

export type FactoryScope = number[] | null;
export interface EdgePendingStopItem {
  requestId: number;
  deviceKind: "robot" | "adapter";
  deviceId: number;
  deviceCode: string | null;
  factoryId: number | null;
  requestEdgeNodeId: number;
  requestNodeCode: string | null;
  currentEdgeNodeId: number | null;
  currentNodeCode: string | null;
  reason: string | null;
  createdAt: string;
  expiresAt: string;
  deliveredAt: string | null;
  outcome: "refused" | "failed" | null;
  needsResolution: boolean;
  ownerCannotList: boolean;
  overdue: boolean;
  undeliverable: boolean;
  centralMustExecute: boolean;
  stale: boolean;
}
export interface OrphanedIntentItem {
  intentId: number;
  adapterId: number;
  adapterCode: string | null;
  factoryId: number | null;
  commandType: string | null;
  tagKey: string | null;
  requestedValue: unknown;
  requestedBy: number;
  createdAt: string;
  ageMinutes: number;
  /** old enough to be resolved (≥ INTENT_RESOLVE_MIN_AGE_MINUTES) */
  resolvable: boolean;
}
export type EdgeResolutionList =
  | { available: true; stops: EdgePendingStopItem[]; intents: OrphanedIntentItem[]; stopTotal: number; intentTotal: number; intentMinAgeMinutes: number }
  | { available: false; stops: []; intents: []; stopTotal: 0; intentTotal: 0; intentMinAgeMinutes: number };
/** Optional narrowing to one device (the panel of a robot / adapter). */
export interface EdgeResolutionFilter {
  robotId?: number;
  adapterId?: number;
}

export type ResolveResult =
  | { ok: true; id: number; deviceKind: "robot" | "adapter"; deviceId: number; resultId?: number }
  | { ok: false; reason: "notFound" | "notResolvable" | "tooRecent" | "alreadyResolved" | "unavailable"; detail: string };

const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? (r as Array<Record<string, unknown>>) : (((r as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>));
const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const inScope = (scope: FactoryScope, factoryId: number | null) => scope === null || (factoryId !== null && scope.includes(factoryId));
/** the SQL predicate of a factory scope over an expression yielding the device's factory id */
const scopeSql = (scope: FactoryScope, expr: ReturnType<typeof sql>) =>
  scope === null ? sql`TRUE` : scope.length === 0 ? sql`FALSE` : sql`${expr} IN (${sql.join(scope.map((f) => sql`${Math.trunc(Number(f))}`), sql`, `)})`;

const ROBOT_FACTORY = sql`(SELECT w."factoryId" FROM public.robots r
    LEFT JOIN public.stations s ON s.id = r."stationId"
    LEFT JOIN public.production_lines l ON l.id = COALESCE(s."lineId", r."lineId")
    LEFT JOIN public.workshops w ON w.id = l."workshopId" WHERE r.id = v."robotId")`;
const ADAPTER_FACTORY = (col: ReturnType<typeof sql>) => sql`(SELECT w."factoryId" FROM public.device_adapters a
    LEFT JOIN public.machines m ON m.id = a."machineId"
    LEFT JOIN public.stations s ON s.id = m."stationId"
    LEFT JOIN public.production_lines l ON l.id = s."lineId"
    LEFT JOIN public.workshops w ON w.id = l."workshopId" WHERE a.id = ${col})`;

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError("database unavailable (edge resolution)");
  return d;
}

/** The pending STOPs + unresolved write intents a person must look at, within the caller's factory scope. */
export async function listEdgeResolutionItems(scope: FactoryScope, filter: EdgeResolutionFilter = {}): Promise<EdgeResolutionList> {
  const d = await db();
  const stopDevice =
    filter.robotId != null ? sql`v."robotId" = ${Math.trunc(filter.robotId)}` : filter.adapterId != null ? sql`v."adapterId" = ${Math.trunc(filter.adapterId)}` : sql`TRUE`;
  const intentDevice = filter.robotId != null ? sql`FALSE` : filter.adapterId != null ? sql`i."adapterId" = ${Math.trunc(filter.adapterId)}` : sql`TRUE`;
  let stopRows: Array<Record<string, unknown>>;
  try {
    stopRows = rowsOf(
      await d.execute(sql`
        SELECT v.*, COALESCE(${ROBOT_FACTORY}, ${ADAPTER_FACTORY(sql`v."adapterId"`)}) AS "factoryId", count(*) OVER () AS "total",
               COALESCE((SELECT r.code FROM public.robots r WHERE r.id = v."robotId"), (SELECT a.code FROM public.device_adapters a WHERE a.id = v."adapterId")) AS "deviceCode",
               (SELECT n.code FROM public.edge_nodes n WHERE n.id = v."requestEdgeNodeId") AS "requestNodeCode",
               (SELECT n.code FROM public.edge_nodes n WHERE n.id = v."currentEdgeNodeId") AS "currentNodeCode"
          FROM public.device_pending_stops v
         WHERE NOT v."resolvedByHuman" AND ${stopDevice}
           AND ${scopeSql(scope, sql`COALESCE(${ROBOT_FACTORY}, ${ADAPTER_FACTORY(sql`v."adapterId"`)})`)}
         ORDER BY v."needsResolution" DESC, v."ownerCannotList" DESC, v."overdue" DESC, v."createdAt" ASC
         LIMIT ${EDGE_RESOLUTION_LIST_LIMIT}`),
    );
  } catch (err) {
    const { isEdgeControlSchemaMissing } = await import("./edgeControlSchema");
    if (isEdgeControlSchemaMissing(err)) return { available: false, stops: [], intents: [], stopTotal: 0, intentTotal: 0, intentMinAgeMinutes: INTENT_RESOLVE_MIN_AGE_MINUTES };
    throw err;
  }
  const intentRows = rowsOf(
    await d.execute(sql`
      SELECT count(*) OVER () AS "total", i.id, i."adapterId", i."commandType", i."tagKey", i."requestedValue", i."requestedBy", i."createdAt",
             (SELECT a.code FROM public.device_adapters a WHERE a.id = i."adapterId") AS "adapterCode",
             ${ADAPTER_FACTORY(sql`i."adapterId"`)} AS "factoryId",
             floor(extract(epoch FROM (LOCALTIMESTAMP - i."createdAt")) / 60)::int AS "ageMinutes",
             (i."createdAt" <= LOCALTIMESTAMP - make_interval(mins => ${INTENT_RESOLVE_MIN_AGE_MINUTES})) AS resolvable
        FROM public.command_log i
       WHERE i.status = 'sent' AND i."ackValue" ->> 'ledger' = 'intent' AND ${intentDevice}
         AND NOT EXISTS (SELECT 1 FROM public.command_log r
                          WHERE r."adapterId" = i."adapterId" AND r."ackValue" ->> 'ledger' = 'result' AND r."ackValue" ->> 'intentId' = i.id::text)
         AND ${scopeSql(scope, ADAPTER_FACTORY(sql`i."adapterId"`))}
       ORDER BY i."createdAt" DESC
       LIMIT ${EDGE_RESOLUTION_LIST_LIMIT}`),
  );
  const num = (v: unknown) => (v == null ? null : Number(v));
  const stops: EdgePendingStopItem[] = stopRows
    .map((r) => ({
      requestId: Number(r.requestId),
      deviceKind: (r.robotId != null ? "robot" : "adapter") as "robot" | "adapter",
      deviceId: Number(r.robotId ?? r.adapterId),
      deviceCode: (r.deviceCode as string | null) ?? null,
      factoryId: num(r.factoryId),
      requestEdgeNodeId: Number(r.requestEdgeNodeId),
      requestNodeCode: (r.requestNodeCode as string | null) ?? null,
      currentEdgeNodeId: num(r.currentEdgeNodeId),
      currentNodeCode: (r.currentNodeCode as string | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      createdAt: iso(r.createdAt)!,
      expiresAt: iso(r.expiresAt)!,
      deliveredAt: iso(r.deliveredAt),
      outcome: (r.outcome as "refused" | "failed" | null) ?? null,
      needsResolution: r.needsResolution === true,
      ownerCannotList: r.ownerCannotList === true,
      overdue: r.overdue === true,
      undeliverable: r.undeliverable === true,
      centralMustExecute: r.centralMustExecute === true,
      stale: r.stale === true,
    }))
    .filter((s) => inScope(scope, s.factoryId)); // defence in depth (the SQL already filtered)
  const intents: OrphanedIntentItem[] = intentRows
    .map((r) => ({
      intentId: Number(r.id),
      adapterId: Number(r.adapterId),
      adapterCode: (r.adapterCode as string | null) ?? null,
      factoryId: num(r.factoryId),
      commandType: (r.commandType as string | null) ?? null,
      tagKey: (r.tagKey as string | null) ?? null,
      requestedValue: r.requestedValue ?? null,
      requestedBy: Number(r.requestedBy),
      createdAt: iso(r.createdAt)!,
      ageMinutes: Number(r.ageMinutes ?? 0),
      resolvable: r.resolvable === true,
    }))
    .filter((i) => inScope(scope, i.factoryId));
  const totalOf = (r: Array<Record<string, unknown>>) => (r.length ? Number(r[0].total) : 0);
  return { available: true, stops, intents, stopTotal: totalOf(stopRows), intentTotal: totalOf(intentRows), intentMinAgeMinutes: INTENT_RESOLVE_MIN_AGE_MINUTES };
}

export interface Actor {
  id: number;
  name: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** R-10-af — a person closes a refused / failed STOP (A's edge_stop_resolve), audited in the same transaction. */
export async function resolvePendingStop(a: { requestId: number; resolution: string; actor: Actor; scope: FactoryScope }): Promise<ResolveResult> {
  const resolution = a.resolution.trim();
  if (resolution.length < 3) return { ok: false, reason: "notResolvable", detail: "a resolution of at least 3 characters is required" };
  const d = await db();
  const { resolveStop, isEdgeControlSchemaMissing, isEdgeControlRefusal } = await import("./edgeControlSchema");
  const { createAuditLog } = await import("../../db/system");
  try {
    return await d.transaction(async (tx) => {
      // the request row FOR UPDATE (edge_stop_resolve locks it too — same order: no deadlock) + its device's factory
      const [q] = rowsOf(
        await tx.execute(sql`
          SELECT v.id, v.kind, v."robotId", v."adapterId", v.outcome, v."resolvedAt",
                 COALESCE(${ROBOT_FACTORY}, ${ADAPTER_FACTORY(sql`v."adapterId"`)}) AS "factoryId"
            FROM public.robot_motion_lock_requests v WHERE v.id = ${a.requestId} FOR UPDATE OF v`),
      );
      // out of scope ⇒ the same answer as a missing row (no oracle about other factories' STOPs)
      if (!q || q.kind !== "stop" || !inScope(a.scope, q.factoryId == null ? null : Number(q.factoryId))) {
        return { ok: false as const, reason: "notFound" as const, detail: `STOP request ${a.requestId} not found` };
      }
      if (q.resolvedAt != null) return { ok: false as const, reason: "alreadyResolved" as const, detail: `STOP request ${a.requestId} was already resolved` };
      if (q.outcome !== "refused" && q.outcome !== "failed") {
        return { ok: false as const, reason: "notResolvable" as const, detail: `STOP request ${a.requestId} is still pending (not refused / failed) — it is executed, never closed by hand` };
      }
      const deviceKind = (q.robotId != null ? "robot" : "adapter") as "robot" | "adapter";
      const deviceId = Number(q.robotId ?? q.adapterId);
      await createAuditLog(
        {
          userId: a.actor.id,
          userName: a.actor.name,
          action: "edge.resolveStop",
          entityType: deviceKind,
          entityId: deviceId,
          entityName: `stop-request:${a.requestId}`,
          ipAddress: a.actor.ip ?? null,
          userAgent: a.actor.userAgent ?? null,
          details: { requestId: a.requestId, outcome: q.outcome, resolution },
        },
        tx,
      );
      await resolveStop(tx, { requestId: a.requestId, actorUserId: a.actor.id, resolution });
      return { ok: true as const, id: a.requestId, deviceKind, deviceId };
    });
  } catch (err) {
    if (isEdgeControlSchemaMissing(err)) return { ok: false, reason: "unavailable", detail: "edge control schema (0374) is not applied" };
    if (isEdgeControlRefusal(err)) return { ok: false, reason: "notResolvable", detail: String((err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message).slice(0, 300) };
    throw err;
  }
}

/**
 * A refusal (23514) of public.ot_write_intent_resolve ⇒ the service's own reasons (the pre-checks above normally answer first;
 * this covers a race — another resolver, the device stage writing its own result, the actor disabled meanwhile).
 */
export function mapIntentResolveRefusal(message: string, intentId: number): { reason: "notResolvable" | "tooRecent" | "alreadyResolved" | "notFound"; detail: string } {
  const m = message.toLowerCase();
  if (/younger|too recent|10 min/.test(m)) return { reason: "tooRecent", detail: `write intent ${intentId} is younger than ${INTENT_RESOLVE_MIN_AGE_MINUTES} minutes — it may still be in flight; wait` };
  if (/already|has a result|second result/.test(m)) return { reason: "alreadyResolved", detail: `write intent ${intentId} already has a result row` };
  if (/not a write intent|no write intent|not an intent/.test(m)) return { reason: "notFound", detail: `write intent ${intentId} not found` };
  return { reason: "notResolvable", detail: message.slice(0, 300) || `write intent ${intentId} could not be resolved` };
}

/** R-10-ax — a person records "outcome unknown" for a crash-orphaned OT write intent (the RESULT row), audited in the same tx. */
export async function resolveOrphanedIntent(a: { intentId: number; reason: string; actor: Actor; scope: FactoryScope }): Promise<ResolveResult> {
  const reason = a.reason.trim();
  if (reason.length < 3) return { ok: false, reason: "notResolvable", detail: "a reason of at least 3 characters is required" };
  const d = await db();
  const { createAuditLog } = await import("../../db/system");
  return d.transaction(async (tx) => {
    // one resolver per intent at a time; the existence of a linked result is re-checked under it
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ot.intent.resolve:${a.intentId}`}))`);
    const [i] = rowsOf(
      await tx.execute(sql`
        SELECT i.*, ${ADAPTER_FACTORY(sql`i."adapterId"`)} AS "factoryId",
               (i."createdAt" <= LOCALTIMESTAMP - make_interval(mins => ${INTENT_RESOLVE_MIN_AGE_MINUTES})) AS "oldEnough",
               EXISTS (SELECT 1 FROM public.command_log r WHERE r."adapterId" = i."adapterId" AND r."ackValue" ->> 'ledger' = 'result'
                        AND r."ackValue" ->> 'intentId' = i.id::text) AS "hasResult"
          FROM public.command_log i WHERE i.id = ${a.intentId}`),
    );
    const ack = (i?.ackValue ?? null) as { ledger?: unknown } | null;
    if (!i || i.status !== "sent" || ack?.ledger !== "intent" || !inScope(a.scope, i.factoryId == null ? null : Number(i.factoryId))) {
      return { ok: false as const, reason: "notFound" as const, detail: `write intent ${a.intentId} not found` };
    }
    if (i.hasResult === true) return { ok: false as const, reason: "alreadyResolved" as const, detail: `write intent ${a.intentId} already has a result row` };
    if (i.oldEnough !== true) {
      return { ok: false as const, reason: "tooRecent" as const, detail: `write intent ${a.intentId} is younger than ${INTENT_RESOLVE_MIN_AGE_MINUTES} minutes — it may still be in flight; wait` };
    }
    let resultId: number;
    try {
      // R-10-bj (A fix round 10): the result row is written ONLY by the guarded SECURITY DEFINER function — it re-checks the
      // actor, the reason, intent-ness, no result yet and the 10-minute age under FOR UPDATE, and a trigger refuses any other
      // writer of a manual-resolution result. In a SAVEPOINT: its refusal (23514) must not poison the transaction.
      resultId = await tx.transaction(async (sp) => {
        const [row] = rowsOf(await sp.execute(sql`SELECT public.ot_write_intent_resolve(${a.intentId}, ${a.actor.id}, ${reason}) AS id`));
        return Number(row?.id);
      });
    } catch (err) {
      const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      const code = e?.cause?.code ?? e?.code;
      const msg = String(e?.cause?.message ?? e?.message ?? "");
      if (code === "23514") return { ok: false as const, ...mapIntentResolveRefusal(msg, a.intentId) };
      const { isEdgeControlSchemaMissing } = await import("./edgeControlSchema");
      if (isEdgeControlSchemaMissing(err)) return { ok: false as const, reason: "unavailable" as const, detail: "ot_write_intent_resolve is missing (0374 fix round 10 not applied)" };
      throw err;
    }
    if (!Number.isSafeInteger(resultId) || resultId <= 0) throw new Error(`ot_write_intent_resolve returned no result row for intent ${a.intentId}`);
    // the audit row in the SAME transaction: it fails ⇒ the result row is rolled back too (no unaudited resolution)
    await createAuditLog(
      {
        userId: a.actor.id,
        userName: a.actor.name,
        action: "ot.resolveOrphanedWriteIntent",
        entityType: "device_adapter",
        entityId: Number(i.adapterId),
        entityName: `write-intent:${a.intentId}`,
        ipAddress: a.actor.ip ?? null,
        userAgent: a.actor.userAgent ?? null,
        details: { intentId: a.intentId, resultId, commandType: i.commandType ?? null, tagKey: i.tagKey ?? null, outcome: "unknown", reason },
      },
      tx,
    );
    return { ok: true as const, id: a.intentId, deviceKind: "adapter" as const, deviceId: Number(i.adapterId), resultId };
  });
}
