/**
 * W5-B (doc 27 §5 gap F2, Đợt 5 item 5.3) — Defect disposition / repair-loop service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Closes the loop that used to end at the QC verdict: NG/NTF → DISPOSITION
 * decision (rework | repair | scrap | use_as_is | return_to_vendor) → repair
 * lifecycle → re-inspect verification.
 *
 * LIFECYCLE (legal transitions enforced here, illegal → DispositionError
 * code "CONFLICT"; the router maps codes onto TRPCError):
 *
 *   open ──────────→ in_repair ──→ repaired ──→ re_inspect_pending ──→ closed
 *     └→ closed          └→ closed     └→ closed        └→ in_repair (re-inspect NG)
 *
 * (scrap / use_as_is / return_to_vendor typically go open → closed directly.)
 *
 * RE-INSPECT LINKAGE is derived, never stored: the LATEST later
 * product_inspections row with the same serialNumber (strictly later by
 * inspectionTime, id as tiebreaker). rework → machine re-inspects the board →
 * new inspection appears → the UI shows "Đã kiểm lại: OK/NG/NTF".
 *
 * WORK-ORDER INTEGRATION DECISION (investigated, doc 27 F2): the only WO
 * mechanism is machine-centric `maintenance_work_orders` whose COMPLETED rows
 * feed MTTR/MTBF (pdmWorkOrderService.computeMttrMtbf counts ALL closed WOs
 * per machine). Auto-creating board-repair WOs there would corrupt machine
 * reliability metrics, so `workOrderId` is a validated LINK-ONLY soft ref
 * (for NG root-caused to the machine itself). The disposition row ITSELF
 * carries the board-repair lifecycle (status + assignee).
 *
 * Every mutation is audit-logged via db.createAuditLog (same pattern as
 * inspection.bulkAcknowledge / measurementResult.classifyDefect).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, asc, desc, eq, gt, gte, inArray, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { createAuditLog } from "../db/system";
import {
  defectDispositions,
  DEFECT_DISPOSITION_TYPES,
  DEFECT_DISPOSITION_STATUSES,
  type DefectDisposition,
  type DefectDispositionType,
  type DefectDispositionStatus,
  productInspections,
  measurementResults,
  maintenanceWorkOrders,
  users,
  machines,
  stations,
  productionLines,
  auditLogs,
} from "../../drizzle/schema";

export { DEFECT_DISPOSITION_TYPES, DEFECT_DISPOSITION_STATUSES };
export type { DefectDispositionType, DefectDispositionStatus };

/** Domain error with a transport-agnostic code; the router maps it to TRPCError. */
export class DispositionError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "CONFLICT" | "BAD_REQUEST" | "INTERNAL",
    message: string,
  ) {
    super(message);
    this.name = "DispositionError";
  }
}

/** Legal status transitions (see file header for the diagram). */
export const LEGAL_TRANSITIONS: Record<DefectDispositionStatus, readonly DefectDispositionStatus[]> = {
  open: ["in_repair", "closed"],
  in_repair: ["repaired", "closed"],
  repaired: ["re_inspect_pending", "closed"],
  re_inspect_pending: ["closed", "in_repair"],
  closed: [],
};

interface Actor {
  id: number;
  name?: string | null;
}

export interface CreateDispositionInput {
  inspectionId: number;
  measurementResultId?: number | null;
  disposition: DefectDispositionType;
  /** LINK-ONLY soft ref to an existing maintenance_work_orders row (validated). */
  workOrderId?: number | null;
  assignee?: number | null;
  note?: string | null;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new DispositionError("INTERNAL", "Database not available");
  return db;
}

/**
 * Create a disposition for an inspection (optionally scoped to one measurement
 * result). Validates every soft reference honestly — inspection must exist,
 * the measurement result must belong to that inspection, a linked WO must
 * exist. serialNumber is denormalised from the inspection at create time.
 */
export async function createDisposition(
  input: CreateDispositionInput,
  actor: Actor,
): Promise<DefectDisposition> {
  const db = await requireDb();

  const [inspection] = await db
    .select({
      id: productInspections.id,
      serialNumber: productInspections.serialNumber,
      overallResult: productInspections.overallResult,
    })
    .from(productInspections)
    .where(eq(productInspections.id, input.inspectionId))
    .limit(1);
  if (!inspection) {
    throw new DispositionError("NOT_FOUND", `Inspection ${input.inspectionId} not found`);
  }

  if (input.measurementResultId != null) {
    const [mr] = await db
      .select({ id: measurementResults.id, inspectionId: measurementResults.inspectionId })
      .from(measurementResults)
      .where(eq(measurementResults.id, input.measurementResultId))
      .limit(1);
    if (!mr) {
      throw new DispositionError("NOT_FOUND", `Measurement result ${input.measurementResultId} not found`);
    }
    if (mr.inspectionId !== input.inspectionId) {
      throw new DispositionError(
        "BAD_REQUEST",
        `Measurement result ${input.measurementResultId} does not belong to inspection ${input.inspectionId}`,
      );
    }
  }

  if (input.workOrderId != null) {
    const [wo] = await db
      .select({ id: maintenanceWorkOrders.id })
      .from(maintenanceWorkOrders)
      .where(eq(maintenanceWorkOrders.id, input.workOrderId))
      .limit(1);
    if (!wo) {
      throw new DispositionError("NOT_FOUND", `Work order ${input.workOrderId} not found`);
    }
  }

  const [row] = await db
    .insert(defectDispositions)
    .values({
      inspectionId: input.inspectionId,
      measurementResultId: input.measurementResultId ?? null,
      serialNumber: inspection.serialNumber ?? null,
      disposition: input.disposition,
      workOrderId: input.workOrderId ?? null,
      status: "open",
      createdBy: actor.id,
      assignee: input.assignee ?? null,
      note: input.note ?? null,
    })
    .returning();

  await createAuditLog({
    userId: actor.id,
    userName: actor.name ?? undefined,
    action: "defectDisposition.create",
    entityType: "inspection",
    entityId: row.id,
    entityName: inspection.serialNumber ?? undefined,
    details: {
      inspectionId: input.inspectionId,
      measurementResultId: input.measurementResultId ?? null,
      disposition: input.disposition,
      workOrderId: input.workOrderId ?? null,
      assignee: input.assignee ?? null,
    },
    status: "success",
  });

  return row;
}

/**
 * Advance (or close) a disposition. Only the legal transitions in
 * LEGAL_TRANSITIONS are accepted — anything else throws CONFLICT (including
 * any transition out of `closed`). Optionally re-assign / append a note.
 */
export async function updateDispositionStatus(
  input: { id: number; status: DefectDispositionStatus; assignee?: number | null; note?: string | null },
  actor: Actor,
): Promise<DefectDisposition> {
  const db = await requireDb();

  const [existing] = await db
    .select()
    .from(defectDispositions)
    .where(eq(defectDispositions.id, input.id))
    .limit(1);
  if (!existing) {
    throw new DispositionError("NOT_FOUND", `Disposition ${input.id} not found`);
  }

  const from = existing.status as DefectDispositionStatus;
  const allowed = LEGAL_TRANSITIONS[from] ?? [];
  if (!allowed.includes(input.status)) {
    throw new DispositionError(
      "CONFLICT",
      `Illegal transition ${from} → ${input.status} (allowed: ${allowed.length ? allowed.join(", ") : "none — terminal state"})`,
    );
  }

  const [row] = await db
    .update(defectDispositions)
    .set({
      status: input.status,
      ...(input.assignee !== undefined ? { assignee: input.assignee } : {}),
      ...(input.note !== undefined && input.note !== null ? { note: input.note } : {}),
      updatedAt: new Date(),
    })
    .where(eq(defectDispositions.id, input.id))
    .returning();

  await createAuditLog({
    userId: actor.id,
    userName: actor.name ?? undefined,
    action: "defectDisposition.updateStatus",
    entityType: "inspection",
    entityId: input.id,
    entityName: existing.serialNumber ?? undefined,
    details: {
      inspectionId: existing.inspectionId,
      from,
      to: input.status,
      assignee: input.assignee ?? existing.assignee ?? null,
    },
    status: "success",
  });

  return row;
}

export interface DispositionWithNames extends DefectDisposition {
  createdByName: string | null;
  assigneeName: string | null;
}

/** Resolve user display names for createdBy/assignee (one IN query, no N+1). */
async function withUserNames(rows: DefectDisposition[]): Promise<DispositionWithNames[]> {
  const ids = Array.from(
    new Set(rows.flatMap((r) => [r.createdBy, r.assignee]).filter((v): v is number => v != null)),
  );
  let nameById = new Map<number, string | null>();
  if (ids.length > 0) {
    const db = await requireDb();
    const found = await db
      .select({ id: users.id, name: users.name, username: users.username })
      .from(users)
      .where(inArray(users.id, ids));
    nameById = new Map(found.map((u) => [u.id, u.name ?? u.username ?? null]));
  }
  return rows.map((r) => ({
    ...r,
    createdByName: r.createdBy != null ? nameById.get(r.createdBy) ?? null : null,
    assigneeName: r.assignee != null ? nameById.get(r.assignee) ?? null : null,
  }));
}

/** All dispositions of one inspection, newest first (read-only; [] on no DB). */
export async function listDispositionsByInspection(inspectionId: number): Promise<DispositionWithNames[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(defectDispositions)
    .where(eq(defectDispositions.inspectionId, inspectionId))
    .orderBy(desc(defectDispositions.createdAt), desc(defectDispositions.id));
  return withUserNames(rows);
}

/** Open (non-closed) dispositions — the repair queue. Newest first. */
export async function listOpenDispositions(limit = 100): Promise<DispositionWithNames[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(defectDispositions)
    .where(ne(defectDispositions.status, "closed"))
    .orderBy(desc(defectDispositions.createdAt), desc(defectDispositions.id))
    .limit(Math.min(Math.max(limit, 1), 500));
  return withUserNames(rows);
}

/** Count of open (non-closed) dispositions — for the QualityHome badge. */
export async function countOpenDispositions(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(defectDispositions)
    .where(ne(defectDispositions.status, "closed"));
  return row?.n ?? 0;
}

export interface ReInspectStatus {
  found: boolean;
  /** How many strictly-later inspections of the same serial exist. */
  laterCount: number;
  /** The LATEST later inspection (current verdict of the board), when found. */
  latest?: {
    id: number;
    overallResult: string;
    inspectionTime: Date;
  };
}

/**
 * Re-inspect linkage for an inspection: the LATEST product_inspections row
 * with the SAME serialNumber that is strictly later (inspectionTime, id as
 * tiebreaker for identical timestamps). "Later" = the board went through the
 * line again after rework — its verdict verifies (or refutes) the repair.
 */
export async function getReInspectStatus(inspectionId: number): Promise<ReInspectStatus> {
  const db = await getDb();
  if (!db) return { found: false, laterCount: 0 };

  const [base] = await db
    .select({
      id: productInspections.id,
      serialNumber: productInspections.serialNumber,
      inspectionTime: productInspections.inspectionTime,
    })
    .from(productInspections)
    .where(eq(productInspections.id, inspectionId))
    .limit(1);
  if (!base?.serialNumber) return { found: false, laterCount: 0 };

  const laterCond = and(
    eq(productInspections.serialNumber, base.serialNumber),
    or(
      gt(productInspections.inspectionTime, base.inspectionTime),
      and(eq(productInspections.inspectionTime, base.inspectionTime), gt(productInspections.id, base.id)),
    ),
  );

  const [countRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(productInspections)
    .where(laterCond);
  const laterCount = countRow?.n ?? 0;
  if (laterCount === 0) return { found: false, laterCount: 0 };

  const [latest] = await db
    .select({
      id: productInspections.id,
      overallResult: productInspections.overallResult,
      inspectionTime: productInspections.inspectionTime,
    })
    .from(productInspections)
    .where(laterCond)
    .orderBy(desc(productInspections.inspectionTime), desc(productInspections.id))
    .limit(1);

  return { found: true, laterCount, latest };
}

// ════════════════════════════════════════════════════════════════════════════
// W8-C (doc 27 §9 V10 / §13 item 8) — Repair-station additions.
//
// Everything below is ADDITIVE: the original W5-B surface (create / updateStatus /
// listByInspection / listOpen / countOpen / reInspectStatus) is untouched.
// The repair station needs three reads the queue panel lacked:
//   * an ENRICHED queue (machine / line / product context + filters, OLDEST first
//     — the repair bench works the backlog, not the news feed);
//   * a SERIAL lookup (scan a board → its dispositions, open + history);
//   * a STATS strip (repaired today, avg time in repair, backlog by lane).
//
// AVG-TIME-IN-REPAIR is derived from the AUDIT LEDGER, not from new columns:
// every legal transition is already audit-logged with {from,to} details (see
// updateDispositionStatus), so pairing "→in_repair" with the next "→repaired"
// per disposition gives honest durations without any migration (0193 NOT needed).
// ════════════════════════════════════════════════════════════════════════════

export interface RepairQueueFilters {
  machineId?: number | null;
  lineId?: number | null;
  disposition?: DefectDispositionType | null;
  limit?: number;
}

export interface RepairQueueRow extends DispositionWithNames {
  machineId: number | null;
  machineName: string | null;
  machineCode: string | null;
  lineId: number | null;
  lineName: string | null;
  productModel: string | null;
  overallResult: string | null;
  inspectionTime: Date | null;
}

/**
 * Open (non-closed) dispositions enriched with machine / line / product context
 * for the repair-station lanes. OLDEST FIRST (createdAt asc — FIFO backlog).
 * All joins are LEFT joins: a disposition whose inspection/machine row vanished
 * still shows up (with null context) instead of silently dropping off the queue.
 */
export async function listRepairQueue(filters: RepairQueueFilters = {}): Promise<RepairQueueRow[]> {
  const db = await getDb();
  if (!db) return [];

  const conds = [ne(defectDispositions.status, "closed")];
  if (filters.machineId != null) conds.push(eq(productInspections.machineId, filters.machineId));
  if (filters.lineId != null) conds.push(eq(stations.lineId, filters.lineId));
  if (filters.disposition != null) conds.push(eq(defectDispositions.disposition, filters.disposition));

  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 500);

  const rows = await db
    .select({
      d: defectDispositions,
      machineId: productInspections.machineId,
      machineName: machines.name,
      machineCode: machines.code,
      lineId: stations.lineId,
      lineName: productionLines.name,
      productModel: productInspections.productModel,
      overallResult: productInspections.overallResult,
      inspectionTime: productInspections.inspectionTime,
    })
    .from(defectDispositions)
    .leftJoin(productInspections, eq(defectDispositions.inspectionId, productInspections.id))
    .leftJoin(machines, eq(productInspections.machineId, machines.id))
    .leftJoin(stations, eq(machines.stationId, stations.id))
    .leftJoin(productionLines, eq(stations.lineId, productionLines.id))
    .where(and(...conds))
    .orderBy(asc(defectDispositions.createdAt), asc(defectDispositions.id))
    .limit(limit);

  const withNames = await withUserNames(rows.map((r) => r.d));
  return rows.map((r, i) => ({
    ...withNames[i],
    machineId: r.machineId ?? null,
    machineName: r.machineName ?? null,
    machineCode: r.machineCode ?? null,
    lineId: r.lineId ?? null,
    lineName: r.lineName ?? null,
    productModel: r.productModel ?? null,
    overallResult: r.overallResult ?? null,
    inspectionTime: r.inspectionTime ?? null,
  }));
}

/**
 * All dispositions of one SERIAL (scan workflow), newest first — open ones and
 * closed history together; the client separates them. Serial is matched exactly
 * (denormalised at create time from the inspection).
 */
export async function listDispositionsBySerial(serial: string): Promise<DispositionWithNames[]> {
  const db = await getDb();
  if (!db) return [];
  const trimmed = serial.trim();
  if (!trimmed) return [];
  const rows = await db
    .select()
    .from(defectDispositions)
    .where(eq(defectDispositions.serialNumber, trimmed))
    .orderBy(desc(defectDispositions.createdAt), desc(defectDispositions.id));
  return withUserNames(rows);
}

// ── Repair stats (audit-ledger derived — no migration) ───────────────────────

export interface DispositionTransitionEvent {
  /** Disposition id (audit_logs.entityId for defectDisposition.updateStatus). */
  entityId: number;
  from: string;
  to: string;
  at: Date;
}

/**
 * Pure math: pair each "→ in_repair" with the NEXT "→ repaired" of the same
 * disposition (events sorted chronologically per entity) and return the
 * durations in milliseconds. Re-loops (re_inspect_pending → in_repair →
 * repaired) produce one additional pair each — that is real repair time.
 * Unpaired events (still in repair, or repaired-event without a recorded start)
 * contribute nothing: no fabricated durations.
 */
export function computeRepairDurationsMs(events: DispositionTransitionEvent[]): number[] {
  const byEntity = new Map<number, DispositionTransitionEvent[]>();
  for (const ev of events) {
    const list = byEntity.get(ev.entityId);
    if (list) list.push(ev);
    else byEntity.set(ev.entityId, [ev]);
  }
  const durations: number[] = [];
  for (const list of byEntity.values()) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    let inRepairAt: Date | null = null;
    for (const ev of list) {
      if (ev.to === "in_repair") {
        inRepairAt = ev.at;
      } else if (ev.to === "repaired" && inRepairAt) {
        const ms = ev.at.getTime() - inRepairAt.getTime();
        if (ms >= 0) durations.push(ms);
        inRepairAt = null;
      }
    }
  }
  return durations;
}

export interface RepairStats {
  /** Non-closed backlog per lane. */
  openByLane: Record<Exclude<DefectDispositionStatus, "closed">, number>;
  /** Dispositions that reached "repaired" since local midnight (distinct). */
  repairedToday: number;
  /** Dispositions closed since local midnight (distinct). */
  closedToday: number;
  /** Average in_repair → repaired duration (minutes) over the stats window; null when no completed pair. */
  avgRepairMinutes: number | null;
  /** How many completed repair pairs the average is computed from (honesty). */
  repairPairCount: number;
  /** Age (minutes) of the oldest non-closed disposition; null when the backlog is empty. */
  oldestOpenMinutes: number | null;
  /** Stats window for the average, in days. */
  windowDays: number;
}

const STATS_WINDOW_DAYS = 7;
const STATS_EVENT_LIMIT = 5000; // bound per-call work; window is small in practice

/**
 * Repair-station stats strip. Lane counts come from the dispositions table;
 * repaired-today / closed-today / avg-time-in-repair are derived from the audit
 * ledger the service already writes on every transition (details JSON carries
 * {from,to}). `now` is injectable for tests.
 */
export async function getRepairStats(now: Date = new Date()): Promise<RepairStats> {
  const empty: RepairStats = {
    openByLane: { open: 0, in_repair: 0, repaired: 0, re_inspect_pending: 0 },
    repairedToday: 0,
    closedToday: 0,
    avgRepairMinutes: null,
    repairPairCount: 0,
    oldestOpenMinutes: null,
    windowDays: STATS_WINDOW_DAYS,
  };
  const db = await getDb();
  if (!db) return empty;

  // 1. Backlog by lane + oldest age (one grouped query + one min query).
  const laneRows = await db
    .select({ status: defectDispositions.status, n: sql<number>`count(*)::int` })
    .from(defectDispositions)
    .where(ne(defectDispositions.status, "closed"))
    .groupBy(defectDispositions.status);
  const openByLane = { ...empty.openByLane };
  for (const r of laneRows) {
    const key = r.status as Exclude<DefectDispositionStatus, "closed">;
    if (key in openByLane) openByLane[key] = r.n;
  }

  const [oldest] = await db
    .select({ createdAt: defectDispositions.createdAt })
    .from(defectDispositions)
    .where(ne(defectDispositions.status, "closed"))
    .orderBy(asc(defectDispositions.createdAt))
    .limit(1);
  const oldestOpenMinutes = oldest
    ? Math.max(0, Math.round((now.getTime() - new Date(oldest.createdAt).getTime()) / 60000))
    : null;

  // 2. Transition events from the audit ledger (window = max(7d, today)).
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const windowStart = new Date(now.getTime() - STATS_WINDOW_DAYS * 24 * 3600_000);
  const since = windowStart < startOfToday ? windowStart : startOfToday;

  const auditRows = await db
    .select({
      entityId: auditLogs.entityId,
      details: auditLogs.details,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .where(and(eq(auditLogs.action, "defectDisposition.updateStatus"), gte(auditLogs.createdAt, since)))
    .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
    .limit(STATS_EVENT_LIMIT);

  const events: DispositionTransitionEvent[] = [];
  for (const row of auditRows) {
    if (row.entityId == null) continue;
    try {
      const d = JSON.parse(row.details ?? "{}") as { from?: string; to?: string };
      if (typeof d.to !== "string") continue;
      events.push({
        entityId: row.entityId,
        from: typeof d.from === "string" ? d.from : "",
        to: d.to,
        at: new Date(row.createdAt),
      });
    } catch {
      // Malformed details (foreign writer) — skip honestly, never crash stats.
    }
  }

  const repairedToday = new Set(
    events.filter((e) => e.to === "repaired" && e.at >= startOfToday).map((e) => e.entityId),
  ).size;
  const closedToday = new Set(
    events.filter((e) => e.to === "closed" && e.at >= startOfToday).map((e) => e.entityId),
  ).size;

  const durations = computeRepairDurationsMs(events.filter((e) => e.at >= windowStart));
  const avgRepairMinutes = durations.length > 0
    ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length / 60000) * 10) / 10
    : null;

  return {
    openByLane,
    repairedToday,
    closedToday,
    avgRepairMinutes,
    repairPairCount: durations.length,
    oldestOpenMinutes,
    windowDays: STATS_WINDOW_DAYS,
  };
}
