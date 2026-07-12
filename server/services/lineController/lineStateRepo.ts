/**
 * doc 44 W3-A2 / G3.1 — Line Controller persistence layer (DB-only, no business logic).
 *
 * Mọi truy cập DB của Line Controller sống ở đây để lineControllerService /
 * lineReadiness giữ được logic thuần (tests mock module này). Nguyên tắc:
 *   • Đọc fail-safe: không DB → null/[] (caller quyết định DB_UNAVAILABLE).
 *   • applyTransition là RACE-SAFE: UPDATE ... WHERE state = from trong một
 *     transaction cùng INSERT audit row — hai transition tranh nhau thì một
 *     cái thua (trả null) thay vì ghi đè lẫn nhau.
 *   • Audit append-only: cả transition thật lẫn attempt bị policy DENY
 *     (reason tiền tố 'POLICY_DENIED:', line_states KHÔNG đổi).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { executeRows } from "../../utils/kpi";
import {
  lineStates,
  lineStateTransitions,
  productionLines,
  stations,
  machines,
  lineStages,
  type LineControllerState,
  type LineStateRow,
  type LineStateTransitionRow,
} from "../../../drizzle/schema";
import { slugSegment } from "../uns/topicV2";

// ─── Availability / line row ─────────────────────────────────────────────────

/** Có kết nối DB không (service map false → DB_UNAVAILABLE, honest). */
export async function isDbAvailable(): Promise<boolean> {
  try {
    return !!(await getDb());
  } catch {
    return false;
  }
}

export interface LineRow {
  id: number;
  code: string;
  name: string;
  workshopId: number;
  isActive: boolean;
}

/** Production line theo id (kể cả inactive — caller tự quyết), null khi không tồn tại. */
export async function getLineRow(lineId: number): Promise<LineRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({
      id: productionLines.id,
      code: productionLines.code,
      name: productionLines.name,
      workshopId: productionLines.workshopId,
      isActive: productionLines.isActive,
    })
    .from(productionLines)
    .where(eq(productionLines.id, lineId))
    .limit(1);
  return rows[0] ?? null;
}

// ─── line_states ──────────────────────────────────────────────────────────────

/** Row trạng thái hiện tại của tuyến (KHÔNG tự tạo), null khi chưa có/không DB. */
export async function getLineState(lineId: number): Promise<LineStateRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(lineStates).where(eq(lineStates.lineId, lineId)).limit(1);
  return rows[0] ?? null;
}

/**
 * Row trạng thái của tuyến, TẠO mặc định 'idle' nếu chưa có (idempotent —
 * onConflictDoNothing trên unique line_id rồi đọc lại). Null khi không DB.
 */
export async function ensureLineState(lineId: number): Promise<LineStateRow | null> {
  const db = await getDb();
  if (!db) return null;
  const existing = await db.select().from(lineStates).where(eq(lineStates.lineId, lineId)).limit(1);
  if (existing[0]) return existing[0];
  await db.insert(lineStates).values({ lineId }).onConflictDoNothing();
  const rows = await db.select().from(lineStates).where(eq(lineStates.lineId, lineId)).limit(1);
  return rows[0] ?? null;
}

export interface ApplyTransitionParams {
  lineId: number;
  from: LineControllerState;
  to: LineControllerState;
  reason: string | null;
  triggeredBy: string;
  correlationId: string | null;
  policyRef: string | null;
  /** Chỉ có nghĩa khi to='held' (spec §12.2); các đích khác luôn xóa held_reason. */
  heldReason?: string | null;
  /** Set khi truyền (changeover nạp recipe set ref); undefined = giữ nguyên. */
  recipeSetRef?: string | null;
  /** Orchestration W3-B nạp; undefined = giữ nguyên. */
  activeOrderId?: number | null;
  taktTargetS?: number | null;
}

/**
 * Persist MỘT transition trong MỘT transaction: UPDATE line_states (race-guard
 * `WHERE state = from`) + INSERT line_state_transitions. Trả row mới, hoặc null
 * khi thua race / không DB (caller phân biệt qua isDbAvailable trước đó).
 */
export async function applyTransition(p: ApplyTransitionParams): Promise<LineStateRow | null> {
  const db = await getDb();
  if (!db) return null;
  const now = new Date();
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(lineStates)
      .set({
        state: p.to,
        enteredAt: now,
        updatedAt: now,
        heldReason: p.to === "held" ? (p.heldReason ?? p.reason ?? null) : null,
        ...(p.recipeSetRef !== undefined ? { recipeSetRef: p.recipeSetRef } : {}),
        ...(p.activeOrderId !== undefined ? { activeOrderId: p.activeOrderId } : {}),
        ...(p.taktTargetS !== undefined ? { taktTargetS: p.taktTargetS } : {}),
      })
      .where(and(eq(lineStates.lineId, p.lineId), eq(lineStates.state, p.from)))
      .returning();
    if (updated.length === 0) return null; // raced: một transition khác thắng trước
    await tx.insert(lineStateTransitions).values({
      lineId: p.lineId,
      fromState: p.from,
      toState: p.to,
      reason: p.reason,
      triggeredBy: p.triggeredBy,
      correlationId: p.correlationId,
      policyRef: p.policyRef,
      ts: now,
    });
    return updated[0];
  });
}

/**
 * Audit một attempt bị policy DENY (line_states KHÔNG đổi) — best-effort,
 * không bao giờ throw vào đường lệnh.
 */
export async function appendDeniedAudit(p: {
  lineId: number;
  from: LineControllerState;
  to: LineControllerState;
  reason: string;
  triggeredBy: string;
  correlationId: string | null;
  policyRef: string | null;
}): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(lineStateTransitions).values({
      lineId: p.lineId,
      fromState: p.from,
      toState: p.to,
      reason: `POLICY_DENIED: ${p.reason}`,
      triggeredBy: p.triggeredBy,
      correlationId: p.correlationId,
      policyRef: p.policyRef,
      ts: new Date(),
    });
  } catch (err) {
    console.error("[LineController] denied-audit append failed:", (err as Error)?.message ?? err);
  }
}

export interface LineWithState {
  lineId: number;
  code: string;
  name: string;
  workshopId: number;
  /** 'idle' mặc định khi tuyến chưa từng có row trạng thái (honest default). */
  state: LineControllerState;
  heldReason: string | null;
  recipeSetRef: string | null;
  activeOrderId: number | null;
  taktTargetS: number | null;
  enteredAt: string | null;
  updatedAt: string | null;
}

/** Mọi tuyến ACTIVE + trạng thái FSM (LEFT JOIN — tuyến chưa có row → idle). */
export async function listLinesWithState(): Promise<LineWithState[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      lineId: productionLines.id,
      code: productionLines.code,
      name: productionLines.name,
      workshopId: productionLines.workshopId,
      state: lineStates.state,
      heldReason: lineStates.heldReason,
      recipeSetRef: lineStates.recipeSetRef,
      activeOrderId: lineStates.activeOrderId,
      taktTargetS: lineStates.taktTargetS,
      enteredAt: lineStates.enteredAt,
      updatedAt: lineStates.updatedAt,
    })
    .from(productionLines)
    .leftJoin(lineStates, eq(lineStates.lineId, productionLines.id))
    .where(eq(productionLines.isActive, true))
    .orderBy(asc(productionLines.id));
  return rows.map((r) => ({
    lineId: r.lineId,
    code: r.code,
    name: r.name,
    workshopId: r.workshopId,
    state: (r.state ?? "idle") as LineControllerState,
    heldReason: r.heldReason ?? null,
    recipeSetRef: r.recipeSetRef ?? null,
    activeOrderId: r.activeOrderId ?? null,
    taktTargetS: r.taktTargetS == null ? null : Number(r.taktTargetS),
    enteredAt: r.enteredAt ? new Date(r.enteredAt).toISOString() : null,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
  }));
}

/** Lịch sử transition (mới nhất trước) — gồm cả row audit POLICY_DENIED. */
export async function listTransitions(lineId: number, limit = 20): Promise<LineStateTransitionRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(lineStateTransitions)
    .where(eq(lineStateTransitions.lineId, lineId))
    .orderBy(desc(lineStateTransitions.ts))
    .limit(Math.min(Math.max(limit, 1), 200));
}

// ─── Máy / trạm của tuyến (readiness + stages) ────────────────────────────────

export interface LineMachineRow {
  id: number;
  code: string;
  name: string;
  machineType: string;
  operationStatus: string;
  lifecycleStatus: string;
  lastHeartbeat: Date | null;
  stationId: number;
  stationCode: string;
  stationName: string;
  stationOrder: number;
}

/** Máy ACTIVE trên tuyến (machine → station → line), theo thứ tự trạm. */
export async function getLineMachines(lineId: number): Promise<LineMachineRow[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: machines.id,
      code: machines.code,
      name: machines.name,
      machineType: machines.machineType,
      operationStatus: machines.operationStatus,
      lifecycleStatus: machines.lifecycleStatus,
      lastHeartbeat: machines.lastHeartbeat,
      stationId: machines.stationId,
      stationCode: stations.code,
      stationName: stations.name,
      stationOrder: stations.orderIndex,
    })
    .from(machines)
    .innerJoin(stations, eq(machines.stationId, stations.id))
    .where(and(eq(stations.lineId, lineId), eq(machines.isActive, true), eq(stations.isActive, true)))
    .orderBy(asc(stations.orderIndex), asc(machines.id));
  return rows as LineMachineRow[];
}

/**
 * Presence mới nhất per máy từ machine_status_logs (DISTINCT ON). Máy chưa có
 * log nào thì KHÔNG có entry (caller fallback operationStatus — honest).
 */
export async function getLatestPresence(machineIds: number[]): Promise<Map<number, "online" | "offline">> {
  const out = new Map<number, "online" | "offline">();
  if (machineIds.length === 0) return out;
  const db = await getDb();
  if (!db) return out;
  try {
    const idList = sql.join(machineIds.map((id) => sql`${id}`), sql`, `);
    const rows = executeRows(
      await db.execute(sql`
        SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, status
        FROM machine_status_logs
        WHERE "machineId" IN (${idList})
        ORDER BY "machineId", "timestamp" DESC
      `),
    ) as Array<{ machine_id: number; status: string }>;
    for (const r of rows) {
      const s = String(r.status);
      if (s === "online" || s === "offline") out.set(Number(r.machine_id), s);
    }
  } catch (err) {
    console.error("[LineController] presence read failed:", (err as Error)?.message ?? err);
  }
  return out;
}

export interface StationRowLite {
  id: number;
  code: string;
  name: string;
  orderIndex: number;
}

/** Trạm ACTIVE của tuyến theo orderIndex. */
export async function getLineStations(lineId: number): Promise<StationRowLite[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({ id: stations.id, code: stations.code, name: stations.name, orderIndex: stations.orderIndex })
    .from(stations)
    .where(and(eq(stations.lineId, lineId), eq(stations.isActive, true)))
    .orderBy(asc(stations.orderIndex));
}

/** stationId → cycleTimeTarget (giây) từ line_stages (khi stage link trạm). */
export async function getStageCycleTargets(lineId: number): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const db = await getDb();
  if (!db) return out;
  const rows = await db
    .select({ stationId: lineStages.stationId, cycleTimeTarget: lineStages.cycleTimeTarget })
    .from(lineStages)
    .where(and(eq(lineStages.lineId, lineId), eq(lineStages.isActive, true)));
  for (const r of rows) {
    if (r.stationId != null && r.cycleTimeTarget != null) {
      const n = Number(r.cycleTimeTarget);
      if (Number.isFinite(n)) out.set(r.stationId, n);
    }
  }
  return out;
}

// ─── ISA-95 segments cho UNS `_line/state` (cached, honest 'unassigned') ─────

interface SegsCacheEntry {
  value: { site: string; area: string; line: string } | null;
  expiresAt: number;
}
const segsCache = new Map<number, SegsCacheEntry>();
const SEGS_TTL_MS = 5 * 60 * 1000;
const SEGS_MAX = 500;

/** Xóa cache segs (tests / sau khi sửa hierarchy). */
export function invalidateLineSegsCache(): void {
  segsCache.clear();
}

/**
 * {site, area, line} đã slug cho topic `syn/{site}/{area}/{line}/_line/state`.
 * Cấp thiếu → 'unassigned' (slugSegment fallback — không bịa). Null khi tuyến
 * không tồn tại / không DB (caller bỏ qua publish, honest skip).
 */
export async function getLineSegs(lineId: number): Promise<{ site: string; area: string; line: string } | null> {
  const hit = segsCache.get(lineId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const db = await getDb();
  if (!db) return null; // transient — không cache
  try {
    const rows = executeRows(
      await db.execute(sql`
        SELECT l.code AS line_code, w.code AS workshop_code, f.code AS factory_code
        FROM production_lines l
        LEFT JOIN workshops w ON w.id = l."workshopId"
        LEFT JOIN factories f ON f.id = w."factoryId"
        WHERE l.id = ${lineId}
        LIMIT 1
      `),
    ) as Array<{ line_code: string | null; workshop_code: string | null; factory_code: string | null }>;
    const value = rows[0]
      ? {
          site: slugSegment(rows[0].factory_code),
          area: slugSegment(rows[0].workshop_code),
          line: slugSegment(rows[0].line_code),
        }
      : null;
    if (segsCache.size >= SEGS_MAX) {
      const oldest = segsCache.keys().next().value;
      if (oldest !== undefined) segsCache.delete(oldest);
    }
    segsCache.set(lineId, { value, expiresAt: Date.now() + SEGS_TTL_MS });
    return value;
  } catch (err) {
    console.error(`[LineController] line ${lineId} segs resolve failed:`, (err as Error)?.message ?? err);
    return null;
  }
}
