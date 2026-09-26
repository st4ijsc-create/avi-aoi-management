/**
 * S1-a (doc 16 §8 b / §15 S1) — Mixed-workforce assignments.  Flag: WORKFORCE_ENABLED.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Assigns a HUMAN operator to a line/station for a shift window, with:
 *   • CONFLICT detection — a human may NOT be double-booked across two OVERLAPPING
 *     planned/active assignments. A conflicting assign is REJECTED.
 *   • SKILL/CERT warning — if the station's required skill is known and the operator
 *     has no active (non-expired) certification for it, the assign is WARNED (not
 *     blocked) — the row is still created with a `skillWarning`.
 *   • CURRENT BOARD — "who/which-robot is at each station now", assembling HUMANS
 *     (from active operator_assignments) AND ROBOTS (from the fleet `robots` registry
 *     + their open `tasks`). Treats humans and robots uniformly as station resources.
 *
 * SAFETY: this service writes orchestration/roster STATE only. It commands NO device.
 * With WORKFORCE_ENABLED off, the mutating entry points are no-ops (enabled:false).
 *
 * The conflict/overlap + board-assembly logic is split into PURE helpers
 * (overlaps / assembleBoard) so they are unit-testable without a DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, eq, inArray, desc } from "drizzle-orm";
import { DbUnavailableError } from "../../_core/dbErrors";
import { getDb } from "../../db/connection";
import {
  operatorAssignments,
  userCertifications,
  tasks,
  robots,
  type OperatorAssignment,
} from "../../../drizzle/schema";
import { recordAuditEvent } from "../audit/controlAuditService";

/** Flag — default OFF (mirrors fleetOrchEnabled). */
export function workforceEnabled(): boolean {
  return process.env.WORKFORCE_ENABLED === "true" || process.env.WORKFORCE_ENABLED === "1";
}

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

// ── PURE — time-window overlap (used by conflict detection) ──────────────────

/** Half-open interval overlap. Null start = -∞, null end = +∞ (open-ended shift). */
export function overlaps(
  aStart: Date | null | undefined,
  aEnd: Date | null | undefined,
  bStart: Date | null | undefined,
  bEnd: Date | null | undefined,
): boolean {
  const as = aStart ? aStart.getTime() : -Infinity;
  const ae = aEnd ? aEnd.getTime() : Infinity;
  const bs = bStart ? bStart.getTime() : -Infinity;
  const be = bEnd ? bEnd.getTime() : Infinity;
  return as < be && bs < ae;
}

// ── PURE — current-board assembly ────────────────────────────────────────────

export interface BoardHuman {
  kind: "human";
  assignmentId: number;
  operatorId: number;
  lineId: number | null;
  stationId: number | null;
  skillLevel: string | null;
  status: string;
}
export interface BoardRobot {
  kind: "robot";
  robotId: number;
  code: string;
  lineId: number | null;
  stationId: number | null;
  status: string;
  openTaskCount: number;
}
export type BoardResource = BoardHuman | BoardRobot;

export interface BoardStation {
  stationId: number | null;
  lineId: number | null;
  humans: BoardHuman[];
  robots: BoardRobot[];
}

/**
 * PURE — fold active human assignments + robots (with open-task counts) into a
 * per-station board. Side-effect free; the DB layer (getCurrentBoard) fetches the
 * inputs. Robots and humans are keyed by stationId (null stations bucket together).
 */
export function assembleBoard(
  humans: BoardHuman[],
  robotRows: Array<{ id: number; code: string; lineId: number | null; stationId: number | null; status: string; openTaskCount: number }>,
): BoardStation[] {
  const byStation = new Map<string, BoardStation>();
  const keyOf = (stationId: number | null, lineId: number | null) => `${stationId ?? "_"}|${lineId ?? "_"}`;
  const ensure = (stationId: number | null, lineId: number | null): BoardStation => {
    const k = keyOf(stationId, lineId);
    let b = byStation.get(k);
    if (!b) { b = { stationId, lineId, humans: [], robots: [] }; byStation.set(k, b); }
    return b;
  };
  for (const h of humans) ensure(h.stationId, h.lineId).humans.push(h);
  for (const r of robotRows) {
    ensure(r.stationId, r.lineId).robots.push({
      kind: "robot", robotId: r.id, code: r.code, lineId: r.lineId, stationId: r.stationId, status: r.status, openTaskCount: r.openTaskCount,
    });
  }
  return [...byStation.values()];
}

// ── DB-bound layer — gated by WORKFORCE_ENABLED ──────────────────────────────

export interface AssignInput {
  operatorId: number;
  lineId?: number | null;
  stationId?: number | null;
  shiftConfigId?: number | null;
  skillLevel?: string | null;
  assignedStart?: Date | null;
  assignedEnd?: Date | null;
  /** Optional skill the station requires — drives the skill/cert WARNING. */
  requiredSkillId?: number | null;
  notes?: string | null;
  scope?: string | null;
  corporateCode?: string | null;
  factoryId?: number | null;
}

export interface AssignResult {
  ok: boolean;
  enabled: boolean;
  assignment?: OperatorAssignment;
  /** Set when the operator has no active cert for requiredSkillId (advisory). */
  skillWarning?: string;
  /** Set (and ok:false) when a double-booking conflict was detected. */
  conflict?: { assignmentId: number; reason: string };
  message?: string;
}

/**
 * Assign an operator. Rejects on a double-booking overlap; warns (not blocks) on a
 * missing certification. No-op (enabled:false) unless WORKFORCE_ENABLED.
 */
export async function assignOperator(input: AssignInput): Promise<AssignResult> {
  if (!workforceEnabled()) return { ok: false, enabled: false, message: "WORKFORCE_ENABLED off" };
  const d = await db();

  // CONFLICT: any planned/active assignment for the same operator overlapping the window.
  const existing = await d
    .select()
    .from(operatorAssignments)
    .where(and(eq(operatorAssignments.operatorId, input.operatorId), inArray(operatorAssignments.status, ["planned", "active"])));
  for (const e of existing) {
    if (overlaps(input.assignedStart ?? null, input.assignedEnd ?? null, e.assignedStart, e.assignedEnd)) {
      return {
        ok: false,
        enabled: true,
        conflict: { assignmentId: e.id, reason: "operator already booked for an overlapping window" },
        message: "double-booking conflict",
      };
    }
  }

  // SKILL/CERT warning — advisory only.
  let skillWarning: string | undefined;
  if (input.requiredSkillId != null) {
    const certs = await d
      .select()
      .from(userCertifications)
      .where(and(eq(userCertifications.userId, input.operatorId), eq(userCertifications.skillId, input.requiredSkillId), eq(userCertifications.isActive, true)));
    const now = Date.now();
    const valid = certs.find((c) => c.expiresAt == null || c.expiresAt.getTime() > now);
    if (!valid) skillWarning = `operator has no active certification for skill #${input.requiredSkillId}`;
  }

  const [assignment] = await d
    .insert(operatorAssignments)
    .values({
      operatorId: input.operatorId,
      lineId: input.lineId ?? null,
      stationId: input.stationId ?? null,
      shiftConfigId: input.shiftConfigId ?? null,
      skillLevel: input.skillLevel ?? null,
      role: "human",
      status: "planned",
      assignedStart: input.assignedStart ?? null,
      assignedEnd: input.assignedEnd ?? null,
      notes: input.notes ?? null,
      scope: input.scope ?? null,
      corporateCode: input.corporateCode ?? null,
      factoryId: input.factoryId ?? null,
    })
    .returning();

  return { ok: true, enabled: true, assignment, skillWarning };
}

/** Reassign — close the current assignment (cancelled) and create a fresh one. */
export async function reassignOperator(assignmentId: number, input: AssignInput): Promise<AssignResult> {
  if (!workforceEnabled()) return { ok: false, enabled: false, message: "WORKFORCE_ENABLED off" };
  const d = await db();
  const [current] = await d.select().from(operatorAssignments).where(eq(operatorAssignments.id, assignmentId)).limit(1);
  if (!current) return { ok: false, enabled: true, message: `assignment ${assignmentId} not found` };
  const created = await assignOperator(input);
  if (!created.ok) return created; // conflict on the new window → leave the old one intact
  await d
    .update(operatorAssignments)
    .set({ status: "cancelled", updatedAt: new Date(), notes: input.notes ?? current.notes })
    .where(eq(operatorAssignments.id, assignmentId));
  return created;
}

/** Confirm a planned assignment (two-step). Marks it active + stamps confirmedBy. */
export async function confirmAssignment(assignmentId: number, confirmedBy: number): Promise<OperatorAssignment | null> {
  if (!workforceEnabled()) return null;
  const d = await db();
  const [current] = await d.select().from(operatorAssignments).where(eq(operatorAssignments.id, assignmentId)).limit(1);
  if (!current) return null;
  if (current.status !== "planned") return current; // idempotent
  const [row] = await d
    .update(operatorAssignments)
    .set({ status: "active", confirmedBy, confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(operatorAssignments.id, assignmentId))
    .returning();
  return row ?? null;
}

/** Close an assignment (terminal: completed). Stamps closedBy + ghi audit bất biến. */
export async function closeAssignment(assignmentId: number, closedBy?: number | null): Promise<OperatorAssignment | null> {
  if (!workforceEnabled()) return null;
  const d = await db();
  const [current] = await d.select().from(operatorAssignments).where(eq(operatorAssignments.id, assignmentId)).limit(1);
  if (!current) return null;
  if (current.status === "completed" || current.status === "cancelled") return current; // idempotent
  const before = { ...current }; // snapshot bất biến TRƯỚC khi update (tránh alias mutation)
  const [row] = await d
    .update(operatorAssignments)
    .set({ status: "completed", closedBy: closedBy ?? null, assignedEnd: current.assignedEnd ?? new Date(), updatedAt: new Date() })
    .where(eq(operatorAssignments.id, assignmentId))
    .returning();
  await recordAuditEvent(d, {
    entityType: "operator_assignment",
    entityId: assignmentId,
    action: "close",
    actorId: closedBy ?? null,
    before,
    after: row ?? null,
  });
  return row ?? null;
}

/**
 * CURRENT BOARD — who/which-robot is at each station now. Humans come from active
 * operator_assignments; robots from the enabled robots registry + their open
 * (assigned/running) tasks. Read-only; NOT flag-gated (a read view is always safe).
 */
export async function getCurrentBoard(): Promise<BoardStation[]> {
  const d = await db();
  const activeAssignments = await d
    .select()
    .from(operatorAssignments)
    .where(eq(operatorAssignments.status, "active"))
    .orderBy(desc(operatorAssignments.assignedStart));
  const humans: BoardHuman[] = activeAssignments.map((a) => ({
    kind: "human",
    assignmentId: a.id,
    operatorId: a.operatorId,
    lineId: a.lineId,
    stationId: a.stationId,
    skillLevel: a.skillLevel,
    status: a.status,
  }));

  const robotRows = await d.select().from(robots).where(eq(robots.isEnabled, true));
  // Open-task counts per device (assigned/running).
  const openTasks = await d.select().from(tasks).where(inArray(tasks.status, ["assigned", "running"]));
  const openByDevice = new Map<number, number>();
  for (const t of openTasks) {
    if (t.assignedDeviceId != null) openByDevice.set(t.assignedDeviceId, (openByDevice.get(t.assignedDeviceId) ?? 0) + 1);
  }
  const robotInputs = robotRows.map((r) => ({
    id: r.id,
    code: r.code,
    lineId: r.lineId,
    stationId: r.stationId,
    status: r.status,
    openTaskCount: openByDevice.get(r.id) ?? 0,
  }));

  return assembleBoard(humans, robotInputs);
}
