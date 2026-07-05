/**
 * server/db/shiftResolution.ts — READ-SIDE shift attribution (doc 32 Wave R1,
 * decision #3 = (b) join production_sessions, NO ingest change).
 *
 * product_inspections has NO shift/session FK. This module maps an inspection
 * to a shift on the READ side, via a 3-tier resolution chain:
 *
 *   1. production_sessions (PREFERRED) — a session that COVERS the inspection's
 *      time AND its line/factory wins. Sessions are the real ISA-95 L3 shift
 *      entity (operator sign-in .. sign-off); when one exists it is the ground
 *      truth even if the wall-clock drifted (late start / overtime). Row-level
 *      only (resolveShiftForInspections) — sessions are SPARSE, so the large
 *      aggregates do NOT correlate per-row (code↔id impedance + hypertable cost).
 *   2. shift_configs WINDOW classification — the factory's configured shift
 *      windows (may be 2, 3 or N shifts, custom hours, may wrap midnight).
 *      This is what the aggregates (getShiftStats/getShiftReport) use.
 *   3. Hour-bucket FALLBACK — the legacy 6-14 / 14-22 / 22-6 approximation,
 *      used ONLY when no shift_configs apply (keeps behaviour + Dashboard icons
 *      working when a factory has not configured shifts yet).
 *
 * All time-of-day math is done in the FACTORY timezone (server/utils/kpi.ts —
 * factoryLocalTsSql on the SQL side, Intl in factory TZ on the TS side), so a
 * 23:30 UTC inspection classifies against 06:30 VN, NOT 23:30.
 *
 * Storage note: both product_inspections.inspectionTime and
 * production_sessions.actualStart/actualEnd/plannedEnd are naive timestamps
 * written by drizzle typed inserts (toISOString → UTC wall time — see kpi.ts
 * docblock). They live in the SAME naive space, so the covering-session test
 * (inspectionTime ∈ [actualStart, actualEnd)) is a direct comparison with no
 * timezone conversion needed.
 */
import { getDb } from "./connection";
import { and, eq, gte, lte, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import {
  shiftConfigs,
  productionSessions,
  productionLines,
} from "../../drizzle/schema";
import { factoryHourOfDaySql, factoryLocalTsSql, getFactoryTimezone } from "../utils/kpi";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type SqlExpr = SQL | { getSQL(): SQL };

export type ShiftSource = "session" | "config" | "fallback";

/** A shift window (from shift_configs, the fallback set, or a covering session). */
export interface ShiftWindowMeta {
  code: string;
  name: string;
  shiftConfigId: number | null;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  orderIndex: number;
  /** Human window "HH:MM-HH:MM" (factory-local). */
  window: string;
}

/** The resolved shift for a single inspection, with the tier that produced it. */
export interface ResolvedShift extends ShiftWindowMeta {
  source: ShiftSource;
}

// ── Legacy hour-bucket shifts (tier 3). Codes kept as morning/afternoon/night
//    so the Dashboard shift icon logic (shift.shift === 'morning' ? …) keeps
//    working for factories that have not configured shift_configs yet. ──
export const FALLBACK_SHIFTS: ShiftWindowMeta[] = [
  { code: "morning", name: "Ca sáng (6h-14h)", shiftConfigId: null, startHour: 6, startMinute: 0, endHour: 14, endMinute: 0, orderIndex: 0, window: "06:00-14:00" },
  { code: "afternoon", name: "Ca chiều (14h-22h)", shiftConfigId: null, startHour: 14, startMinute: 0, endHour: 22, endMinute: 0, orderIndex: 1, window: "14:00-22:00" },
  { code: "night", name: "Ca đêm (22h-6h)", shiftConfigId: null, startHour: 22, startMinute: 0, endHour: 6, endMinute: 0, orderIndex: 2, window: "22:00-06:00" },
];

/** Bucket for times not covered by any configured shift (a gap between shifts). */
export const UNASSIGNED_SHIFT: ShiftWindowMeta = {
  code: "unassigned",
  name: "Ngoài ca / chưa xác định",
  shiftConfigId: null,
  startHour: 0, startMinute: 0, endHour: 0, endMinute: 0,
  orderIndex: 999,
  window: "—",
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatWindow(startHour: number, startMinute: number, endHour: number, endMinute: number): string {
  return `${pad2(startHour)}:${pad2(startMinute)}-${pad2(endHour)}:${pad2(endMinute)}`;
}

/** A validated SQL string literal (single quotes escaped) — safe to inline. */
function sqlStr(s: string): SQL {
  return sql.raw(`'${String(s).replace(/'/g, "''")}'`);
}

// ═══════════════════════════════════════════════════════════════════════
// shift_configs loading
// ═══════════════════════════════════════════════════════════════════════

/**
 * Active shift windows that apply to a query.
 *  - factoryId given → that factory's own shifts; if it has none, the GLOBAL
 *    (factoryId IS NULL) shifts.
 *  - factoryId omitted → GLOBAL shifts; if there are none, the union of every
 *    factory's shifts deduped by code (first-wins) so an all-factory dashboard
 *    still classifies when factories share the same CA1/CA2/CA3 windows.
 * Empty result ⇒ caller falls back to the legacy hour buckets.
 * Rows are ordered by orderIndex then start-of-day and deduped by code.
 */
export async function getApplicableShiftConfigs(
  db: Db,
  factoryId?: number,
): Promise<ShiftWindowMeta[]> {
  const rows = await db.select().from(shiftConfigs).where(eq(shiftConfigs.isActive, true));
  if (!rows.length) return [];

  let chosen: typeof rows;
  if (factoryId != null) {
    const forFactory = rows.filter((r) => r.factoryId === factoryId);
    chosen = forFactory.length ? forFactory : rows.filter((r) => r.factoryId == null);
  } else {
    const globals = rows.filter((r) => r.factoryId == null);
    chosen = globals.length ? globals : rows;
  }
  if (!chosen.length) return [];

  const sorted = [...chosen].sort(
    (a, b) =>
      a.orderIndex - b.orderIndex ||
      a.startHour * 60 + a.startMinute - (b.startHour * 60 + b.startMinute) ||
      a.id - b.id,
  );

  const seen = new Set<string>();
  const metas: ShiftWindowMeta[] = [];
  for (const r of sorted) {
    if (seen.has(r.code)) continue; // dedupe by code (first-wins across factories)
    seen.add(r.code);
    metas.push({
      code: r.code,
      name: r.name,
      shiftConfigId: r.id,
      startHour: r.startHour,
      startMinute: r.startMinute,
      endHour: r.endHour,
      endMinute: r.endMinute,
      orderIndex: r.orderIndex,
      window: formatWindow(r.startHour, r.startMinute, r.endHour, r.endMinute),
    });
  }
  return metas;
}

// ═══════════════════════════════════════════════════════════════════════
// SQL classifier (tier 2 / tier 3) — used by the aggregates
// ═══════════════════════════════════════════════════════════════════════

/** Factory-local minutes-of-day (0..1439) for a timestamp column. */
function localMinutesSql(tsCol: SqlExpr): SQL {
  const local = factoryLocalTsSql(tsCol);
  return sql`(EXTRACT(HOUR FROM ${local}) * 60 + EXTRACT(MINUTE FROM ${local}))`;
}

/**
 * Build a `CASE … END` expression classifying `tsCol` into a shift code.
 *  - metas empty  → legacy hour-bucket fallback (morning/afternoon/night).
 *  - otherwise    → factory-local window match per config (wrap-aware); times
 *                   in a gap between shifts map to UNASSIGNED_SHIFT.code.
 * Returns the SQL plus the metas backing the codes and whether it fell back.
 */
export function buildShiftClassifierSql(
  metas: ShiftWindowMeta[],
  tsCol: SqlExpr,
): { expr: SQL<string>; metas: ShiftWindowMeta[]; isFallback: boolean } {
  if (!metas.length) {
    const h = factoryHourOfDaySql(tsCol);
    const expr = sql<string>`CASE
      WHEN ${h} >= 6 AND ${h} < 14 THEN 'morning'
      WHEN ${h} >= 14 AND ${h} < 22 THEN 'afternoon'
      ELSE 'night'
    END`;
    return { expr, metas: FALLBACK_SHIFTS, isFallback: true };
  }

  const lm = localMinutesSql(tsCol);
  const whens: SQL[] = [];
  for (const m of metas) {
    const s = m.startHour * 60 + m.startMinute;
    const e = m.endHour * 60 + m.endMinute;
    // Normal shift: [s, e). Wrap-past-midnight (s >= e): [s, 1440) ∪ [0, e).
    const cond =
      s < e
        ? sql`(${lm} >= ${sql.raw(String(s))} AND ${lm} < ${sql.raw(String(e))})`
        : sql`(${lm} >= ${sql.raw(String(s))} OR ${lm} < ${sql.raw(String(e))})`;
    whens.push(sql`WHEN ${cond} THEN ${sqlStr(m.code)}`);
  }
  const expr = sql<string>`CASE ${sql.join(whens, sql` `)} ELSE ${sqlStr(UNASSIGNED_SHIFT.code)} END`;
  return { expr, metas, isFallback: false };
}

// ═══════════════════════════════════════════════════════════════════════
// TS classifier (pure) — used by resolveShiftForInspections and unit tests
// ═══════════════════════════════════════════════════════════════════════

/** Factory-local minutes-of-day (0..1439) of an instant in `tz`. */
export function factoryLocalMinutesOfDay(date: Date, tz: string = getFactoryTimezone()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/** First window (in order) whose factory-local range contains `localMinutes`. */
export function classifyShiftByWindow(
  localMinutes: number,
  metas: ShiftWindowMeta[],
): ShiftWindowMeta | null {
  for (const m of metas) {
    const s = m.startHour * 60 + m.startMinute;
    const e = m.endHour * 60 + m.endMinute;
    const match = s < e ? localMinutes >= s && localMinutes < e : localMinutes >= s || localMinutes < e;
    if (match) return m;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// Row-level resolver — the full 3-tier chain (decision #3 join path)
// ═══════════════════════════════════════════════════════════════════════

export interface InspectionForShift {
  /** Optional key echoed back in the result map (defaults to array index). */
  id?: number | string;
  machineId?: number | null;
  lineCode?: string | null;
  factoryCode?: string | null;
  inspectionTime: Date;
}

/**
 * Resolve each inspection to a shift via the 3-tier chain (session → window →
 * fallback). Intended for BOUNDED sets (a report page, a station's rows) — it
 * loads the covering production_sessions once and classifies in memory.
 *
 * @param opts.factoryId  scopes both the applicable shift_configs and the
 *                        production_sessions considered.
 * @param opts.useSessions default true; set false to skip tier 1 (pure window).
 */
export async function resolveShiftForInspections(
  inspections: InspectionForShift[],
  opts: { factoryId?: number; useSessions?: boolean; db?: Db } = {},
): Promise<Map<number | string, ResolvedShift>> {
  const out = new Map<number | string, ResolvedShift>();
  if (!inspections.length) return out;

  const db = opts.db ?? (await getDb());
  if (!db) return out;

  const tz = getFactoryTimezone();
  const configs = await getApplicableShiftConfigs(db, opts.factoryId);
  const windowMetas = configs.length ? configs : FALLBACK_SHIFTS;
  const windowSource: ShiftSource = configs.length ? "config" : "fallback";

  // ── Tier 1 preload: sessions overlapping the inspection time span ──
  type SessionRow = {
    shiftConfigId: number;
    lineId: number | null;
    actualStart: Date;
    actualEnd: Date | null;
    plannedEnd: Date | null;
    code: string;
    name: string;
    startHour: number;
    startMinute: number;
    endHour: number;
    endMinute: number;
    orderIndex: number;
  };
  let sessions: SessionRow[] = [];
  const lineCodeToId = new Map<string, number>();

  if (opts.useSessions !== false) {
    const times = inspections.map((i) => i.inspectionTime.getTime());
    const minT = new Date(Math.min(...times));
    const maxT = new Date(Math.max(...times));

    const sessConds: SQL[] = [
      lte(productionSessions.actualStart, maxT),
      // open sessions (actualEnd NULL) or those ending after the window start
      or(isNull(productionSessions.actualEnd), gte(productionSessions.actualEnd, minT))!,
    ];
    if (opts.factoryId != null) sessConds.push(eq(productionSessions.factoryId, opts.factoryId));

    sessions = await db
      .select({
        shiftConfigId: productionSessions.shiftConfigId,
        lineId: productionSessions.lineId,
        actualStart: productionSessions.actualStart,
        actualEnd: productionSessions.actualEnd,
        plannedEnd: productionSessions.plannedEnd,
        code: shiftConfigs.code,
        name: shiftConfigs.name,
        startHour: shiftConfigs.startHour,
        startMinute: shiftConfigs.startMinute,
        endHour: shiftConfigs.endHour,
        endMinute: shiftConfigs.endMinute,
        orderIndex: shiftConfigs.orderIndex,
      })
      .from(productionSessions)
      .innerJoin(shiftConfigs, eq(shiftConfigs.id, productionSessions.shiftConfigId))
      .where(and(...sessConds));

    // Resolve inspection lineCodes → line ids for the line-scoped session match.
    const lineCodes = [...new Set(inspections.map((i) => i.lineCode).filter((c): c is string => !!c))];
    if (lineCodes.length) {
      const lineRows = await db
        .select({ id: productionLines.id, code: productionLines.code })
        .from(productionLines)
        .where(inArray(productionLines.code, lineCodes));
      for (const l of lineRows) if (!lineCodeToId.has(l.code)) lineCodeToId.set(l.code, l.id);
    }
  }

  const now = Date.now();
  inspections.forEach((insp, idx) => {
    const key = insp.id ?? idx;
    let resolved: ResolvedShift | null = null;

    // Tier 1: covering production_session (line-scoped or factory-wide).
    if (sessions.length) {
      const lineId = insp.lineCode ? lineCodeToId.get(insp.lineCode) : undefined;
      const t = insp.inspectionTime.getTime();
      const cover = sessions.find((s) => {
        const st = s.actualStart.getTime();
        const en = (s.actualEnd ?? s.plannedEnd)?.getTime() ?? now;
        if (!(t >= st && t < en)) return false;
        if (s.lineId == null) return true; // factory-wide session covers any line
        return lineId != null && s.lineId === lineId;
      });
      if (cover) {
        resolved = {
          code: cover.code,
          name: cover.name,
          shiftConfigId: cover.shiftConfigId,
          startHour: cover.startHour,
          startMinute: cover.startMinute,
          endHour: cover.endHour,
          endMinute: cover.endMinute,
          orderIndex: cover.orderIndex,
          window: formatWindow(cover.startHour, cover.startMinute, cover.endHour, cover.endMinute),
          source: "session",
        };
      }
    }

    // Tier 2: factory shift_configs window classification.
    if (!resolved) {
      const lm = factoryLocalMinutesOfDay(insp.inspectionTime, tz);
      const m = classifyShiftByWindow(lm, windowMetas);
      if (m) resolved = { ...m, source: windowSource };
      else {
        // Tier 3: legacy hour buckets (gap not covered by any configured shift).
        const fb = classifyShiftByWindow(lm, FALLBACK_SHIFTS)!;
        resolved = { ...fb, source: "fallback" };
      }
    }

    out.set(key, resolved);
  });

  return out;
}
