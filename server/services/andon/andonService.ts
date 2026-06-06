/**
 * Sprint F5a — Andon service (ALERT-ONLY).
 *
 * SAFETY: An Andon is a visual signal / notification. Nothing here writes a
 * command to any machine — there is no dispatcher / driver path. The interlock
 * engine and the andonRouter both call into this service.
 *
 * Lifecycle: raise → acknowledge (MTTA) → resolve (MTTR). raiseAndon applies a
 * light idempotency window: an Andon raised for the same scope+reason within
 * ~30s is UPDATED (refresh message/raisedAt) rather than duplicated.
 */
import { and, eq, gte, isNull, desc } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { andonEvents, type AndonEvent } from "../../../drizzle/schema";
import { emitAndonEvent } from "../../_core/socket";
import {
  AUDIT_ACTIONS,
  createAuditContext,
  logCrudOperation,
} from "../auditTrailService";

export type AndonState = "green" | "yellow" | "red" | "call";
export type AndonReason = "quality" | "material" | "maintenance" | "safety" | "setup" | "other";

export interface RaiseAndonInput {
  state: AndonState;
  reason: AndonReason;
  title: string;
  message?: string | null;
  lineId?: number | null;
  stationId?: number | null;
  machineId?: number | null;
  raisedBySystem?: boolean;
  sourceInterlockEventId?: number | null;
}

export interface AndonActor {
  id?: number | null;
  name?: string | null;
}

// Idempotency window for de-duplicating rapid re-raises of the "same" Andon.
const IDEMPOTENCY_WINDOW_MS = 30_000;

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not connected");
  return d;
}

function emit(row: AndonEvent, phase: "raised" | "acknowledged" | "resolved" | "escalated"): void {
  emitAndonEvent({
    id: row.id,
    state: row.state as AndonState,
    reason: row.reason,
    status: row.status,
    title: row.title,
    message: row.message,
    lineId: row.lineId,
    stationId: row.stationId,
    machineId: row.machineId,
    raisedBySystem: row.raisedBySystem,
    sourceInterlockEventId: row.sourceInterlockEventId,
    raisedAt: row.raisedAt,
    event: phase,
  });
}

async function audit(actor: AndonActor | undefined, action: string, row: AndonEvent, extra?: Record<string, unknown>) {
  await logCrudOperation(
    createAuditContext({ user: { id: actor?.id ?? 0, name: actor?.name ?? "system" } }),
    {
      action,
      entityType: "andon_event",
      entityId: row.id,
      entityName: row.title,
      details: { operation: action, metadata: { state: row.state, reason: row.reason, status: row.status, ...extra } },
      status: "success",
    },
  );
}

/**
 * Raise an Andon (or refresh a matching recent one — idempotency). actor is the
 * human who raised it (omit / raisedBySystem=true for engine-raised Andons).
 */
export async function raiseAndon(input: RaiseAndonInput, actor?: AndonActor): Promise<AndonEvent> {
  const d = await db();
  const raisedBySystem = input.raisedBySystem ?? false;

  // Light idempotency: same scope (machine/station/line) + reason still-open
  // within the window → update instead of inserting a new row.
  const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const scopeMatch = input.machineId != null
    ? eq(andonEvents.machineId, input.machineId)
    : input.stationId != null
      ? eq(andonEvents.stationId, input.stationId)
      : input.lineId != null
        ? eq(andonEvents.lineId, input.lineId)
        : undefined;

  if (scopeMatch) {
    const [existing] = await d
      .select()
      .from(andonEvents)
      .where(and(scopeMatch, eq(andonEvents.reason, input.reason), eq(andonEvents.status, "raised"), gte(andonEvents.raisedAt, since)))
      .orderBy(desc(andonEvents.raisedAt))
      .limit(1);
    if (existing) {
      const [updated] = await d
        .update(andonEvents)
        .set({
          state: input.state,
          title: input.title,
          message: input.message ?? existing.message,
          raisedAt: new Date(),
          sourceInterlockEventId: input.sourceInterlockEventId ?? existing.sourceInterlockEventId,
        })
        .where(eq(andonEvents.id, existing.id))
        .returning();
      emit(updated, "raised");
      await audit(actor, AUDIT_ACTIONS.UPDATE, updated, { idempotentRefresh: true });
      return updated;
    }
  }

  const [row] = await d
    .insert(andonEvents)
    .values({
      state: input.state,
      reason: input.reason,
      status: "raised",
      title: input.title,
      message: input.message ?? null,
      lineId: input.lineId ?? null,
      stationId: input.stationId ?? null,
      machineId: input.machineId ?? null,
      raisedBy: raisedBySystem ? null : actor?.id ?? null,
      raisedBySystem,
      sourceInterlockEventId: input.sourceInterlockEventId ?? null,
    })
    .returning();

  emit(row, "raised");
  await audit(actor, AUDIT_ACTIONS.CREATE, row);
  return row;
}

/** Acknowledge an Andon — stamps MTTA (acknowledgedAt - raisedAt, seconds). */
export async function acknowledgeAndon(id: number, userId: number, actor?: AndonActor): Promise<AndonEvent | null> {
  const d = await db();
  const [current] = await d.select().from(andonEvents).where(eq(andonEvents.id, id)).limit(1);
  if (!current) return null;
  if (current.status !== "raised") return current; // already ack'd/resolved — idempotent

  const now = new Date();
  const mtta = Math.max(0, Math.round((now.getTime() - current.raisedAt.getTime()) / 1000));
  const [row] = await d
    .update(andonEvents)
    .set({ status: "acknowledged", acknowledgedAt: now, acknowledgedBy: userId, mttaSeconds: mtta })
    .where(eq(andonEvents.id, id))
    .returning();

  emit(row, "acknowledged");
  await audit(actor ?? { id: userId }, AUDIT_ACTIONS.UPDATE, row, { mttaSeconds: mtta });
  return row;
}

/** Resolve an Andon — stamps MTTR (resolvedAt - raisedAt, seconds). */
export async function resolveAndon(id: number, userId: number, notes?: string, actor?: AndonActor): Promise<AndonEvent | null> {
  const d = await db();
  const [current] = await d.select().from(andonEvents).where(eq(andonEvents.id, id)).limit(1);
  if (!current) return null;
  if (current.status === "resolved") return current; // idempotent

  const now = new Date();
  const mttr = Math.max(0, Math.round((now.getTime() - current.raisedAt.getTime()) / 1000));
  const [row] = await d
    .update(andonEvents)
    .set({
      status: "resolved",
      resolvedAt: now,
      resolvedBy: userId,
      mttrSeconds: mttr,
      // resolving an un-acknowledged Andon also records the ack timestamp.
      acknowledgedAt: current.acknowledgedAt ?? now,
      acknowledgedBy: current.acknowledgedBy ?? userId,
      message: notes != null ? notes : current.message,
    })
    .where(eq(andonEvents.id, id))
    .returning();

  emit(row, "resolved");
  await audit(actor ?? { id: userId }, AUDIT_ACTIONS.UPDATE, row, { mttrSeconds: mttr });
  return row;
}

/** Escalate an Andon — bumps escalationLevel (e.g. for unattended red Andons). */
export async function escalateAndon(id: number, actor?: AndonActor): Promise<AndonEvent | null> {
  const d = await db();
  const [current] = await d.select().from(andonEvents).where(eq(andonEvents.id, id)).limit(1);
  if (!current) return null;
  const [row] = await d
    .update(andonEvents)
    .set({ escalationLevel: (current.escalationLevel ?? 0) + 1 })
    .where(eq(andonEvents.id, id))
    .returning();
  emit(row, "escalated");
  await audit(actor, AUDIT_ACTIONS.UPDATE, row, { escalationLevel: row.escalationLevel });
  return row;
}

/** List active (not-yet-resolved) Andons, newest first. */
export async function listActiveAndons(limit = 100): Promise<AndonEvent[]> {
  const d = await db();
  return d
    .select()
    .from(andonEvents)
    .where(isNull(andonEvents.resolvedAt))
    .orderBy(desc(andonEvents.raisedAt))
    .limit(limit);
}
