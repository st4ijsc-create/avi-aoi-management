/**
 * War-Room Briefing service (doc 40 Wave 4c · §11 — persona "phòng chỉ huy ca").
 *
 * Tổng hợp READ-ONLY một bản tin điều hành theo LINE + so sánh theo CA + kế
 * hoạch-vs-thực-tế cho một nhà máy tại một thời điểm/ca. Toàn bộ nguồn là DỮ
 * LIỆU THẬT, honest-null (không bịa số):
 *
 *   • lines        — OEE/A/P/Q theo line (oeeService.getLineOEE) + sản lượng &
 *                    tỉ lệ NG (daily_statistics, đã gộp trong getLineOEE) +
 *                    kế-hoạch (production_orders.targetQuantity) + top downtime
 *                    theo máy (downtime_events, clip vào cửa sổ).
 *   • shiftCompare — so OEE/sản-lượng/NG theo CA THẬT (shift_configs, KHÔNG
 *                    hardcode). Sản lượng/NG lấy từ fact_inspection_hourly (grain
 *                    theo giờ+ca — nguồn DUY NHẤT chia được theo ca; daily_statistics
 *                    chỉ theo NGÀY nên không tách ca được). Availability lấy từ
 *                    machine_status_logs cắt theo cửa-sổ-ca; performance suy từ
 *                    ideal cycle (oee_metrics). Thiếu dữ liệu → null.
 *   • planVsActual — expected = % thời-gian-ca-đã-trôi × target, so với actual
 *                    (sản lượng thực của line trong cửa sổ).
 *
 * SET-BASED: một nhúm cố định truy vấn nhóm (không N+1 theo máy). KHÔNG có đường
 * điều khiển; mọi truy vấn đều getDb()-guarded (DB vắng → cấu trúc rỗng honest).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { executeRows } from "../utils/kpi";
import { getLineOEE } from "./oeeService";

export interface WarRoomTopDowntime {
  machineCode: string;
  minutes: number;
  reason: string;
}
export interface WarRoomLine {
  lineId: number;
  lineName: string;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  output: number;
  planTarget: number | null;
  ngRate: number | null; // %  (ng / total) × 100
  topDowntime: WarRoomTopDowntime[];
}
export interface WarRoomShiftCompare {
  shiftLabel: string;
  oee: number | null;
  output: number;
  ngRate: number | null; // %
}
export interface WarRoomPlanVsActual {
  lineName: string;
  expected: number;
  actual: number;
  pct: number | null; // actual / expected × 100
}
export interface WarRoomBriefing {
  asOf: string;
  lines: WarRoomLine[];
  shiftCompare: WarRoomShiftCompare[];
  planVsActual: WarRoomPlanVsActual[];
}

function pctRound(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Local start-of-day for a given instant. */
function startOfDay(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  return s;
}

/** Shift window on `day` from a shift config (handles the cross-midnight case). */
function shiftWindow(
  day: Date,
  shift: { startHour: number; startMinute: number; endHour: number; endMinute: number },
): { start: Date; end: Date } {
  const base = startOfDay(day);
  const start = new Date(base);
  start.setHours(shift.startHour, shift.startMinute, 0, 0);
  const end = new Date(base);
  end.setHours(shift.endHour, shift.endMinute, 0, 0);
  // A shift whose end is at/before its start rolls into the next day.
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1);
  return { start, end };
}

const EMPTY: WarRoomBriefing = { asOf: new Date().toISOString(), lines: [], shiftCompare: [], planVsActual: [] };

export async function getWarRoomBriefing(params?: {
  factoryId?: number;
  date?: string; // ISO — defaults to today (server-local)
  shiftConfigId?: number;
}): Promise<WarRoomBriefing> {
  const db = await getDb();
  const now = new Date();
  if (!db) return { ...EMPTY, asOf: now.toISOString() };

  const factoryId = params?.factoryId;
  const targetDay = params?.date ? new Date(params.date) : now;
  if (Number.isNaN(targetDay.getTime())) return { ...EMPTY, asOf: now.toISOString() };

  const dayStart = startOfDay(targetDay);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // ── Active shift configs (factory-scoped OR global). Real shifts, never hardcoded.
  const shiftRows = executeRows(await db.execute(sql`
    SELECT "id", "name", "code", "startHour", "startMinute", "endHour", "endMinute"
    FROM shift_configs
    WHERE "isActive" = true
      ${factoryId ? sql`AND ("factoryId" = ${factoryId} OR "factoryId" IS NULL)` : sql``}
    ORDER BY "orderIndex", "startHour"
  `)) as Array<{ id: number; name: string; code: string; startHour: number; startMinute: number; endHour: number; endMinute: number }>;

  // ── QA4c-1 (high): bảng "OEE theo Line" lấy output/quality từ daily_statistics —
  // grain theo NGÀY (mốc nửa đêm), KHÔNG cắt được theo ca. Nếu lọc bằng cửa-sổ-ca
  // (vd 06:00–14:00) thì hàng nửa-đêm rơi ngoài → mọi line ra 0/null. Vì vậy bảng
  // lines LUÔN dùng cửa-sổ NGÀY; phân tách theo CA nằm ở shiftCompare (nguồn
  // fact_inspection_hourly, grain giờ+ca — mới cắt ca trung thực được). shiftConfigId
  // chỉ dùng để làm nổi bật ca ở UI, không thu hẹp cửa-sổ dữ liệu ngày.
  const periodStart = dayStart;
  const periodEnd = dayEnd;
  // Never look into the future — clip the upper bound to NOW.
  const from = periodStart;
  const to = new Date(Math.min(now.getTime(), periodEnd.getTime()));
  if (to.getTime() <= from.getTime()) {
    // Future / not-yet-started period: still return the line skeleton (zeros) so
    // the UI can render the shift grid honestly rather than erroring.
    return { asOf: now.toISOString(), lines: [], shiftCompare: [], planVsActual: [] };
  }

  const elapsedFraction = Math.max(0, Math.min(1,
    (to.getTime() - periodStart.getTime()) / (periodEnd.getTime() - periodStart.getTime())));

  // ── (A) Line OEE / A / P / Q + output + ng (reuses the set-based rollup). ────
  const lineOee = await getLineOEE({ factoryId, from, to });

  // ── (B) Plan target per line (production_orders overlapping the window). ─────
  const planRows = executeRows(await db.execute(sql`
    SELECT "lineId" AS line_id, COALESCE(SUM("targetQuantity"), 0)::int AS target
    FROM production_orders
    WHERE "plannedStartDate" <= ${to.toISOString()}
      AND ("plannedEndDate" IS NULL OR "plannedEndDate" >= ${from.toISOString()})
      ${factoryId ? sql`AND "factoryId" = ${factoryId}` : sql``}
    GROUP BY "lineId"
  `)) as Array<{ line_id: number; target: number }>;
  const planByLine = new Map<number, number>();
  for (const r of planRows) planByLine.set(Number(r.line_id), Number(r.target) || 0);

  // ── (C) Top downtime per line, grouped by (machineCode, reason), clipped. ────
  const dtRows = executeRows(await db.execute(sql`
    SELECT l."id" AS line_id, d."machineCode" AS machine_code, d."reason" AS reason,
      SUM(
        GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(d."endTime", ${to.toISOString()}), ${to.toISOString()}) - GREATEST(d."startTime", ${from.toISOString()})
        )) / 60.0)
      )::float AS minutes
    FROM downtime_events d
    JOIN machines m ON m."id" = d."machineId"
    JOIN stations s ON s."id" = m."stationId"
    JOIN production_lines l ON l."id" = s."lineId"
    JOIN workshops w ON w."id" = l."workshopId"
    WHERE d."startTime" <= ${to.toISOString()}
      AND (d."endTime" IS NULL OR d."endTime" >= ${from.toISOString()})
      ${factoryId ? sql`AND w."factoryId" = ${factoryId}` : sql``}
    GROUP BY l."id", d."machineCode", d."reason"
  `)) as Array<{ line_id: number; machine_code: string; reason: string; minutes: number }>;
  const dtByLine = new Map<number, WarRoomTopDowntime[]>();
  for (const r of dtRows) {
    const mins = Math.round(Number(r.minutes) || 0);
    if (mins <= 0) continue;
    const lid = Number(r.line_id);
    const arr = dtByLine.get(lid) ?? [];
    arr.push({ machineCode: r.machine_code ?? "?", minutes: mins, reason: r.reason ?? "?" });
    dtByLine.set(lid, arr);
  }
  for (const arr of dtByLine.values()) arr.sort((a, b) => b.minutes - a.minutes);

  const lines: WarRoomLine[] = lineOee.map((lo) => {
    const output = lo.details.totalCount;
    const ng = lo.details.rejectCount;
    const ngRate = output > 0 ? pctRound((ng / output) * 100) : null;
    return {
      lineId: lo.lineId,
      lineName: lo.lineName,
      oee: lo.oee,
      availability: lo.availability,
      performance: lo.performance,
      quality: lo.quality,
      output,
      planTarget: planByLine.has(lo.lineId) ? planByLine.get(lo.lineId)! : null,
      ngRate,
      topDowntime: (dtByLine.get(lo.lineId) ?? []).slice(0, 3),
    };
  });

  // ── (D) Plan vs actual — expected = elapsed-shift-fraction × target. ─────────
  const planVsActual: WarRoomPlanVsActual[] = lines
    .filter((l) => l.planTarget != null)
    .map((l) => {
      const expected = Math.round((l.planTarget ?? 0) * elapsedFraction);
      const actual = l.output;
      const pct = expected > 0 ? pctRound((actual / expected) * 100) : null;
      return { lineName: l.lineName, expected, actual, pct };
    });

  // ── (E) Shift comparison — real shifts, today. ───────────────────────────────
  const shiftCompare = await computeShiftCompare(db, targetDay, factoryId, shiftRows, now);

  return { asOf: now.toISOString(), lines, shiftCompare, planVsActual };
}

/**
 * Per-shift OEE / output / NG for `targetDay`. Output + quality + NG come from
 * fact_inspection_hourly (the only shift-grained production source). Availability
 * comes from machine_status_logs clipped to each shift window; performance is
 * derived from the last-known ideal cycle time. Shifts that have not started yet
 * (start ≥ now) are skipped. Honest-null where inputs are absent.
 *
 * Query budget: 1 (fact by shift) + 1 (fact by machine×shift) + 1 (ideal) + one
 * small status window per shift (shifts are a handful — bounded, not N+1/fleet).
 */
async function computeShiftCompare(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  targetDay: Date,
  factoryId: number | undefined,
  shiftRows: Array<{ id: number; name: string; code: string; startHour: number; startMinute: number; endHour: number; endMinute: number }>,
  now: Date,
): Promise<WarRoomShiftCompare[]> {
  if (shiftRows.length === 0) return [];
  const dayStart = startOfDay(targetDay);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Counts per shiftCode from the hourly fact for the day's buckets.
  const factRows = executeRows(await db.execute(sql`
    SELECT "shiftCode" AS shift_code,
      COALESCE(SUM("totalCount"), 0)::int AS total,
      COALESCE(SUM("okCount"), 0)::int    AS ok,
      COALESCE(SUM("ngCount"), 0)::int    AS ng,
      COALESCE(SUM("ntfCount"), 0)::int   AS ntf
    FROM fact_inspection_hourly
    WHERE "bucketHour" >= ${dayStart.toISOString()} AND "bucketHour" < ${dayEnd.toISOString()}
      ${factoryId ? sql`AND "factoryId" = ${factoryId}` : sql``}
    GROUP BY "shiftCode"
  `)) as Array<{ shift_code: string; total: number; ok: number; ng: number; ntf: number }>;
  const factByShift = new Map<string, { total: number; ok: number; ng: number; ntf: number }>();
  for (const r of factRows) {
    factByShift.set(String(r.shift_code), {
      total: Number(r.total) || 0, ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0, ntf: Number(r.ntf) || 0,
    });
  }

  // Per machine × shift totals (for the performance numerator Σ ideal·total).
  const machShiftRows = executeRows(await db.execute(sql`
    SELECT "machineId" AS machine_id, "shiftCode" AS shift_code,
      COALESCE(SUM("totalCount"), 0)::int AS total
    FROM fact_inspection_hourly
    WHERE "bucketHour" >= ${dayStart.toISOString()} AND "bucketHour" < ${dayEnd.toISOString()}
      ${factoryId ? sql`AND "factoryId" = ${factoryId}` : sql``}
    GROUP BY "machineId", "shiftCode"
  `)) as Array<{ machine_id: number; shift_code: string; total: number }>;

  // Ideal cycle time per machine (last-known) — for performance.
  const idealRows = executeRows(await db.execute(sql`
    SELECT DISTINCT ON ("machineId") "machineId" AS machine_id, "idealCycleTime" AS ideal
    FROM oee_metrics
    WHERE "idealCycleTime" IS NOT NULL
    ORDER BY "machineId", "timestamp" DESC
  `)) as Array<{ machine_id: number; ideal: number | null }>;
  const idealByMachine = new Map<number, number>();
  for (const r of idealRows) {
    const v = r.ideal != null ? Number(r.ideal) : 0;
    if (v > 0) idealByMachine.set(Number(r.machine_id), v);
  }
  // Σ (ideal · total) per shiftCode.
  const perfNumByShift = new Map<string, number>();
  for (const r of machShiftRows) {
    const ideal = idealByMachine.get(Number(r.machine_id));
    if (!ideal || ideal <= 0) continue;
    const total = Number(r.total) || 0;
    if (total <= 0) continue;
    const code = String(r.shift_code);
    perfNumByShift.set(code, (perfNumByShift.get(code) ?? 0) + ideal * total);
  }

  const out: WarRoomShiftCompare[] = [];
  for (const sc of shiftRows) {
    const w = shiftWindow(targetDay, sc);
    // Skip shifts that have not begun yet on the target day.
    if (w.start.getTime() >= now.getTime()) continue;
    const sTo = new Date(Math.min(now.getTime(), w.end.getTime()));

    const counts = factByShift.get(sc.code) ?? { total: 0, ok: 0, ng: 0, ntf: 0 };
    const output = counts.total;
    const good = counts.ok + counts.ntf;
    const quality = output > 0 ? good / output : null;
    const ngRate = output > 0 ? pctRound((counts.ng / output) * 100) : null;

    // Availability over the shift window (fleet, factory-scoped).
    const durRows = executeRows(await db.execute(sql`
      WITH ordered AS (
        SELECT sl."machineId" AS machine_id, sl.status AS status, sl."timestamp" AS ts,
               LEAD(sl."timestamp") OVER (PARTITION BY sl."machineId" ORDER BY sl."timestamp") AS next_ts
        FROM machine_status_logs sl
        JOIN machines m ON m."id" = sl."machineId"
        JOIN stations s ON s."id" = m."stationId"
        JOIN production_lines l ON l."id" = s."lineId"
        JOIN workshops w2 ON w2."id" = l."workshopId"
        WHERE sl."timestamp" >= ${w.start.toISOString()} AND sl."timestamp" <= ${sTo.toISOString()}
          ${factoryId ? sql`AND w2."factoryId" = ${factoryId}` : sql``}
      )
      SELECT
        COALESCE(SUM(CASE WHEN status = 'online'
          THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${sTo.toISOString()}), ${sTo.toISOString()}) - ts)) ELSE 0 END), 0)::float AS online_sec,
        COALESCE(SUM(CASE WHEN status <> 'online'
          THEN EXTRACT(EPOCH FROM (LEAST(COALESCE(next_ts, ${sTo.toISOString()}), ${sTo.toISOString()}) - ts)) ELSE 0 END), 0)::float AS offline_sec
      FROM ordered
    `)) as Array<{ online_sec: number; offline_sec: number }>;
    const online = Math.max(0, Number(durRows[0]?.online_sec) || 0);
    const offline = Math.max(0, Number(durRows[0]?.offline_sec) || 0);
    const availability = (online + offline) > 0 ? online / (online + offline) : null;

    // Performance = min(1, Σ(ideal·total) / Σonline_fleet). Fleet-online denominator
    // is a documented approximation (per-machine online is not attributed by shift);
    // machines without a configured ideal contribute no numerator. Null if none.
    const perfNum = perfNumByShift.get(sc.code) ?? 0;
    const performance = perfNum > 0 && online > 0 ? Math.min(1, perfNum / online) : null;

    const allFactors = availability !== null && performance !== null && quality !== null;
    const oee = allFactors ? pctRound(availability! * performance! * quality! * 100) : null;

    out.push({ shiftLabel: sc.name || sc.code, oee, output, ngRate });
  }
  return out;
}
