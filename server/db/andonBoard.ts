/**
 * server/db/andonBoard.ts — data for the dedicated Andon/TV board `/andon`
 * (doc 27 §5 gap F7 / Đợt 5.4, W5-C).
 *
 * ONE round of parallel queries assembles everything the wall board shows:
 *   • per-machine TODAY counts (factory-timezone day, canonical helpers from
 *     utils/kpi.ts — final yield counts NTF as pass per decision #4),
 *   • factory-level canonical KPIs incl. true FPY + last-hour UPH,
 *   • active (unresolved) Andon events for the ticker + tile state colours,
 *   • open (unacknowledged) alert count.
 *
 * Honesty notes:
 *   - the machine list mirrors dashboard.getAllMachinesStats (active machines,
 *     NOT per-user assignment-filtered — the board is a shared shopfloor TV);
 *     the inspection AGGREGATES do accept the per-user access filter so a
 *     restricted account still only sees its own numbers.
 *   - grouping/assembly is pure TS (assembleAndonBoard) so it is unit-testable
 *     without a DB.
 */
import { and, desc, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb } from "./connection";
import {
  productInspections,
  andonEvents,
} from "../../drizzle/schema";
import {
  finalYield,
  fpyFromFirstInspections,
  fpyAggregateSql,
  roundPct,
  executeRows,
} from "../utils/kpi";
import { getFactoryTimezone, startOfDayInZone } from "../utils/factoryTime";
import { getMachinesWithHierarchy } from "./hierarchy";
import { getActiveAlertsCount } from "./statistics";

// ── Wire shapes ─────────────────────────────────────────────────────────────

export interface AndonBoardMachineTile {
  machineId: number;
  code: string;
  name: string;
  machineType: string;
  stationName: string | null;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  /** Canonical final yield % (OK+NTF)/total, null when no data today. */
  finalYield: number | null;
  /** Highest-severity ACTIVE andon on this machine: call > red > yellow. */
  andonState: "call" | "red" | "yellow" | null;
}

export interface AndonBoardLine {
  lineId: number | null;
  lineName: string | null;
  workshopName: string | null;
  factoryName: string | null;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
  finalYield: number | null;
  /** Highest-severity ACTIVE andon on the line (incl. its machines). */
  andonState: "call" | "red" | "yellow" | null;
  machines: AndonBoardMachineTile[];
}

export interface AndonBoardTickerItem {
  id: number;
  state: string;
  reason: string;
  status: string;
  title: string;
  machineId: number | null;
  lineId: number | null;
  machineCode: string | null;
  lineName: string | null;
  raisedAt: Date;
}

export interface AndonBoardData {
  generatedAt: string;
  dayStart: string;
  timezone: string;
  kpis: {
    total: number;
    ok: number;
    ng: number;
    ntf: number;
    /** Canonical final yield % today (NTF = pass), null when no data. */
    finalYield: number | null;
    /** Canonical true FPY % today (first inspection per serial), null when no serials. */
    fpy: number | null;
    firstTotal: number;
    /** Boards inspected in the last rolling 60 minutes. */
    uphLastHour: number;
    /** Unacknowledged alert_history rows. */
    openAlerts: number;
    /** Unresolved andon_events rows. */
    activeAndons: number;
  };
  lines: AndonBoardLine[];
  andons: AndonBoardTickerItem[];
}

// ── Pure assembly (unit-tested without a DB) ────────────────────────────────

const ANDON_SEVERITY: Record<string, number> = { yellow: 1, red: 2, call: 3 };

/** Highest of two andon states (call > red > yellow > null); green is ignored. */
export function maxAndonState(
  a: "call" | "red" | "yellow" | null,
  b: string | null | undefined,
): "call" | "red" | "yellow" | null {
  const bSev = b ? (ANDON_SEVERITY[b] ?? 0) : 0;
  const aSev = a ? ANDON_SEVERITY[a] : 0;
  if (bSev > aSev) return b as "call" | "red" | "yellow";
  return a;
}

export interface MachineHierarchyRow {
  machine: { id: number; code: string; name: string; machineType: string };
  station: { name: string } | null;
  line: { id: number; name: string } | null;
  workshop: { name: string } | null;
  factory: { id: number; name: string } | null;
}

export interface MachineDayCounts {
  machineId: number;
  total: number;
  ok: number;
  ng: number;
  ntf: number;
}

export interface ActiveAndonRow {
  id: number;
  state: string;
  reason: string;
  status: string;
  title: string;
  machineId: number | null;
  lineId: number | null;
  raisedAt: Date;
}

/**
 * Group machines by line, join today's counts, roll canonical final yield up
 * per machine/line/factory and stamp the highest active andon state on each
 * tile. Pure — all inputs are plain rows.
 */
export function assembleAndonBoard(input: {
  machineRows: MachineHierarchyRow[];
  counts: MachineDayCounts[];
  activeAndons: ActiveAndonRow[];
  fpy: { firstPass: number; firstTotal: number };
  uphLastHour: number;
  openAlerts: number;
  dayStart: Date;
  timezone: string;
  now?: Date;
}): AndonBoardData {
  const countsByMachine = new Map<number, MachineDayCounts>(
    input.counts.map((c) => [c.machineId, c]),
  );

  // Active-andon severity per machine and per line (events may carry either id).
  const andonByMachine = new Map<number, "call" | "red" | "yellow" | null>();
  const andonByLine = new Map<number, "call" | "red" | "yellow" | null>();
  for (const a of input.activeAndons) {
    if (a.machineId != null) {
      andonByMachine.set(a.machineId, maxAndonState(andonByMachine.get(a.machineId) ?? null, a.state));
    }
    if (a.lineId != null) {
      andonByLine.set(a.lineId, maxAndonState(andonByLine.get(a.lineId) ?? null, a.state));
    }
  }

  // Group machines by line (machines without a line share a single null group).
  const lineGroups = new Map<number | null, AndonBoardLine>();
  const machineCodeById = new Map<number, string>();
  const lineNameById = new Map<number, string>();
  for (const row of input.machineRows) {
    const lineId = row.line?.id ?? null;
    machineCodeById.set(row.machine.id, row.machine.code);
    if (row.line) lineNameById.set(row.line.id, row.line.name);
    let group = lineGroups.get(lineId);
    if (!group) {
      group = {
        lineId,
        lineName: row.line?.name ?? null,
        workshopName: row.workshop?.name ?? null,
        factoryName: row.factory?.name ?? null,
        total: 0, ok: 0, ng: 0, ntf: 0,
        finalYield: null,
        andonState: lineId != null ? (andonByLine.get(lineId) ?? null) : null,
        machines: [],
      };
      lineGroups.set(lineId, group);
    }
    const c = countsByMachine.get(row.machine.id) ?? { machineId: row.machine.id, total: 0, ok: 0, ng: 0, ntf: 0 };
    const machineAndon = andonByMachine.get(row.machine.id) ?? null;
    group.machines.push({
      machineId: row.machine.id,
      code: row.machine.code,
      name: row.machine.name,
      machineType: row.machine.machineType,
      stationName: row.station?.name ?? null,
      total: c.total, ok: c.ok, ng: c.ng, ntf: c.ntf,
      finalYield: c.total > 0 ? roundPct(finalYield({ ok: c.ok, ntf: c.ntf, total: c.total }), 1) : null,
      andonState: machineAndon,
    });
    group.total += c.total;
    group.ok += c.ok;
    group.ng += c.ng;
    group.ntf += c.ntf;
    group.andonState = maxAndonState(group.andonState, machineAndon);
  }

  const lines = Array.from(lineGroups.values());
  for (const line of lines) {
    line.finalYield = line.total > 0 ? roundPct(finalYield({ ok: line.ok, ntf: line.ntf, total: line.total }), 1) : null;
  }
  // Stable, human order: named lines alphabetically, the "no line" group last.
  lines.sort((a, b) => {
    if (a.lineId == null) return 1;
    if (b.lineId == null) return -1;
    return (a.lineName ?? "").localeCompare(b.lineName ?? "");
  });

  // Factory-level totals from the SAME per-machine counts the tiles show
  // (one source of truth — the strip always equals the sum of the tiles).
  const totals = { total: 0, ok: 0, ng: 0, ntf: 0 };
  for (const line of lines) {
    totals.total += line.total;
    totals.ok += line.ok;
    totals.ng += line.ng;
    totals.ntf += line.ntf;
  }

  // Ticker shows the 30 most recent; the KPI count stays the FULL active count.
  const andons: AndonBoardTickerItem[] = input.activeAndons.slice(0, 30).map((a) => ({
    id: a.id,
    state: a.state,
    reason: a.reason,
    status: a.status,
    title: a.title,
    machineId: a.machineId,
    lineId: a.lineId,
    machineCode: a.machineId != null ? (machineCodeById.get(a.machineId) ?? null) : null,
    lineName: a.lineId != null ? (lineNameById.get(a.lineId) ?? null) : null,
    raisedAt: a.raisedAt,
  }));

  return {
    generatedAt: (input.now ?? new Date()).toISOString(),
    dayStart: input.dayStart.toISOString(),
    timezone: input.timezone,
    kpis: {
      ...totals,
      finalYield: totals.total > 0 ? roundPct(finalYield({ ok: totals.ok, ntf: totals.ntf, total: totals.total }), 2) : null,
      fpy: input.fpy.firstTotal > 0 ? roundPct(fpyFromFirstInspections(input.fpy), 2) : null,
      firstTotal: input.fpy.firstTotal,
      uphLastHour: input.uphLastHour,
      openAlerts: input.openAlerts,
      activeAndons: input.activeAndons.length,
    },
    lines,
    andons,
  };
}

// ── DB entry point ──────────────────────────────────────────────────────────

export async function getAndonBoardData(opts: {
  factoryId?: number;
  lineIds?: number[];
  userId?: number;
  userRole?: string;
} = {}): Promise<AndonBoardData> {
  const timezone = getFactoryTimezone();
  const now = new Date();
  const dayStart = startOfDayInZone(now, timezone);
  const db = await getDb();
  const empty = assembleAndonBoard({
    machineRows: [], counts: [], activeAndons: [],
    fpy: { firstPass: 0, firstTotal: 0 }, uphLastHour: 0, openAlerts: 0,
    dayStart, timezone, now,
  });
  if (!db) return empty;

  // Machine registry (active machines with full hierarchy), filtered in TS.
  const allMachineRows = (await getMachinesWithHierarchy()) as unknown as MachineHierarchyRow[];
  const machineRows = allMachineRows.filter((r) => {
    if (opts.factoryId != null && r.factory?.id !== opts.factoryId) return false;
    if (opts.lineIds && opts.lineIds.length > 0 && !(r.line && opts.lineIds.includes(r.line.id))) return false;
    return true;
  });
  const machineIds = machineRows.map((r) => r.machine.id);

  // Today window conditions (+ optional per-user access filter, same as getDashboardStats).
  const conds: SQL[] = [gte(productInspections.inspectionTime, dayStart)];
  if (opts.factoryId != null || (opts.lineIds && opts.lineIds.length > 0)) {
    if (machineIds.length === 0) return empty; // filter resolves to nothing — honest zeros
    conds.push(inArray(productInspections.machineId, machineIds));
  }
  if (opts.userId && opts.userRole !== "admin") {
    const { getAccessFilterConditions } = await import("../_core/accessControl");
    const accessFilter = await getAccessFilterConditions(opts.userId, opts.userRole || "user");
    if (accessFilter) conds.push(accessFilter);
  }
  const whereToday = and(...conds);
  const lastHourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const whereLastHour = and(...conds, gte(productInspections.inspectionTime, lastHourStart));

  const [perMachine, fpyResult, lastHourRows, activeAndonRows, openAlerts] = await Promise.all([
    db.select({
      machineId: productInspections.machineId,
      total: sql<number>`count(*)::int`,
      ok: sql<number>`sum(case when ${productInspections.overallResult} = 'OK' then 1 else 0 end)::int`,
      ng: sql<number>`sum(case when ${productInspections.overallResult} = 'NG' then 1 else 0 end)::int`,
      ntf: sql<number>`sum(case when ${productInspections.overallResult} = 'NTF' then 1 else 0 end)::int`,
    }).from(productInspections).where(whereToday).groupBy(productInspections.machineId),
    db.execute(fpyAggregateSql({ where: whereToday })),
    db.select({ total: sql<number>`count(*)::int` }).from(productInspections).where(whereLastHour),
    db.select({
      id: andonEvents.id,
      state: andonEvents.state,
      reason: andonEvents.reason,
      status: andonEvents.status,
      title: andonEvents.title,
      machineId: andonEvents.machineId,
      lineId: andonEvents.lineId,
      raisedAt: andonEvents.raisedAt,
    }).from(andonEvents).where(isNull(andonEvents.resolvedAt)).orderBy(desc(andonEvents.raisedAt)).limit(100),
    getActiveAlertsCount(),
  ]);

  const fpyRow = executeRows(fpyResult)[0] || {};

  // Scope andon events to the same filter as the tiles (an event matches when
  // its machine or line falls inside the filtered set).
  const machineIdSet = new Set(machineIds);
  const lineIdSet = new Set(machineRows.map((r) => r.line?.id).filter((v): v is number => v != null));
  const filtered = (opts.factoryId != null || (opts.lineIds && opts.lineIds.length > 0))
    ? activeAndonRows.filter((a) =>
        (a.machineId != null && machineIdSet.has(a.machineId)) ||
        (a.lineId != null && lineIdSet.has(a.lineId)))
    : activeAndonRows;

  return assembleAndonBoard({
    machineRows,
    counts: perMachine.map((r) => ({
      machineId: Number(r.machineId),
      total: Number(r.total) || 0,
      ok: Number(r.ok) || 0,
      ng: Number(r.ng) || 0,
      ntf: Number(r.ntf) || 0,
    })),
    activeAndons: filtered as ActiveAndonRow[],
    fpy: {
      firstPass: Number(fpyRow.first_pass) || 0,
      firstTotal: Number(fpyRow.first_total) || 0,
    },
    uphLastHour: Number(lastHourRows[0]?.total) || 0,
    openAlerts,
    dayStart,
    timezone,
    now,
  });
}
