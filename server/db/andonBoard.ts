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
import { and, desc, gte, inArray, isNull, lt, lte, sql, type SQL } from "drizzle-orm";
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
import {
  getFactoryTimezone,
  startOfDayInZone,
  wallClockInZone,
  wallClockToUtc,
} from "../utils/factoryTime";
import { getMachinesWithHierarchy } from "./hierarchy";
import { getActiveAlertsCount } from "./statistics";
// Nhãn phạm vi từ module KHÔNG phụ thuộc (nhập tĩnh an toàn — `_core/accessControl` vẫn phải
// nạp bằng `import()` động vì nó kéo theo `_core/trpc`).
import { UNSCOPED_LABELS, type ScopeEmptyReason, type ScopeLabels, scopeLabelsOf } from "../_core/accessControlLabels";

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

/**
 * ★★ Nửa đêm KẾ TIẾP theo giờ NHÀ MÁY — biên TRÊN (loại trừ) của cửa sổ "hôm nay".
 *
 * Tính bằng lịch tường (`wallClockInZone` → +1 ngày → `wallClockToUtc`), KHÔNG phải
 * `dayStart + 24h`: cộng thẳng 24 giờ sẽ sai đúng vào ngày chuyển DST của những múi có DST
 * (`Asia/Ho_Chi_Minh` không có DST, nhưng hàm này phải đúng cho mọi `FACTORY_TZ`).
 *
 * ⚠ Ngữ nghĩa "hôm nay" KHÔNG đổi: vẫn là ngày theo lịch của NHÀ MÁY (`FACTORY_TZ`, mặc định
 * `Asia/Ho_Chi_Minh`), chỉ thêm biên trên. Kết quả là một mốc UTC thật; `postgres` chạy
 * `TimeZone=Etc/UTC` và cột `inspectionTime` là `timestamp` không múi được drizzle đọc/ghi theo
 * UTC, nên hai vế của phép so sánh cùng một hệ quy chiếu.
 */
export function startOfNextDayInZone(date: Date, timeZone: string = getFactoryTimezone()): Date {
  const wc = wallClockInZone(date, timeZone);
  const next = new Date(Date.UTC(wc.year, wc.month - 1, wc.day + 1));
  return wallClockToUtc(
    { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
    timeZone,
  );
}

export interface AndonBoardData {
  generatedAt: string;
  dayStart: string;
  /**
   * Biên TRÊN (loại trừ) của cửa sổ "hôm nay" — nửa đêm kế tiếp theo giờ nhà máy.
   * ⚠ 2026-08-17: trước bản vá cửa sổ chỉ có chặn DƯỚI, nên một bản ghi mang `inspectionTime`
   * ở TƯƠNG LAI (lệch đồng hồ máy, nhập sai, dữ liệu test) được đếm vào bảng "hôm nay" MÃI MÃI.
   */
  dayEnd: string;
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
  /**
   * ⚠ 2026-08-17 — TRẠNG THÁI RỖNG TRUNG THỰC. Một bảng toàn số 0 của tài khoản CHƯA ĐƯỢC
   * GÁN NHÀ MÁY không được trình bày giống hệt một bảng toàn số 0 của ca chưa chạy. Giao diện
   * phải đọc ô này trước khi in "chưa có sản lượng" (xem `common.scopeEmpty.*`).
   */
  scopeEmptyReason: ScopeEmptyReason | null;
  scopeMessage: string | null;
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
  /** Biên TRÊN (loại trừ) của "hôm nay" — nửa đêm kế tiếp theo giờ nhà máy. */
  dayEnd: Date;
  timezone: string;
  now?: Date;
  /** Nhãn phạm vi của người gọi; bỏ trống = lối đi không mang danh tính người dùng. */
  scope?: ScopeLabels;
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
    dayEnd: input.dayEnd.toISOString(),
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
    scopeEmptyReason: (input.scope ?? UNSCOPED_LABELS).scopeEmptyReason,
    scopeMessage: (input.scope ?? UNSCOPED_LABELS).scopeMessage,
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
  const dayEnd = startOfNextDayInZone(now, timezone);
  const db = await getDb();
  const empty = assembleAndonBoard({
    machineRows: [], counts: [], activeAndons: [],
    fpy: { firstPass: 0, firstTotal: 0 }, uphLastHour: 0, openAlerts: 0,
    dayStart, dayEnd, timezone, now,
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

  // Per-user access scope, resolved BEFORE the early returns below so a board of zeros always
  // carries the reason it is empty.
  // ⚠ `resolveDataScope` trả CẢ điều kiện SQL lẫn câu giải thích: một tài khoản 0 gán nhà máy
  // nhận vị từ FALSE (không phải `undefined` = không lọc, xem `_core/accessControl.ts`) và
  // bảng toàn số 0 của nó phải nói ra lý do, không được im lặng thành "chưa có sản lượng".
  // ⚠ `scope` chỉ mang BA Ô NHÃN — `filter` được giữ RIÊNG ở `scopeFilter`, không bao giờ trộn
  // vào đối tượng sẽ đi ra đáp ứng. Trộn vào là `Converting circular structure to JSON`
  // (đối tượng SQL của drizzle có vòng `PgTable → PgSerial → table`), và `tsc` KHÔNG bắt được:
  // xem docblock `scopeLabelsOf` trong `_core/accessControlLabels.ts`.
  let scope: ScopeLabels = UNSCOPED_LABELS;
  let scopeFilter: SQL | undefined;
  if (opts.userId && opts.userRole !== "admin") {
    const { resolveDataScope } = await import("../_core/accessControl");
    const resolvedScope = await resolveDataScope(opts.userId, opts.userRole || "user");
    scopeFilter = resolvedScope.filter;
    scope = scopeLabelsOf(resolvedScope);
  }

  // Today window conditions (+ optional per-user access filter, same as getDashboardStats).
  // ⚠⚠ 2026-08-17 — CỬA SỔ PHẢI ĐÓNG CẢ HAI ĐẦU. Bản cũ chỉ có `gte(dayStart)`; một bản ghi
  // mang `inspectionTime` ở TƯƠNG LAI (đồng hồ máy lệch, nhập tay sai, dữ liệu test) thoả điều
  // kiện ấy MÃI MÃI, nên nó được cộng vào bảng Andon "hôm nay" của mọi ngày kể từ đó — sản
  // lượng, FPY và UPH đều sai theo hướng LẠC QUAN mà không có dấu hiệu gì trên bảng.
  // Biên trên là nửa đêm KẾ TIẾP theo giờ nhà máy và LOẠI TRỪ (`lt`, không phải `lte`): bản ghi
  // lúc 23:59:59.999 hôm nay VẪN được đếm, bản ghi đúng 00:00:00 ngày mai thì KHÔNG.
  const conds: SQL[] = [
    gte(productInspections.inspectionTime, dayStart),
    lt(productInspections.inspectionTime, dayEnd),
  ];
  if (opts.factoryId != null || (opts.lineIds && opts.lineIds.length > 0)) {
    // filter resolves to nothing — honest zeros, but still carrying the scope reason
    if (machineIds.length === 0) return { ...empty, scopeEmptyReason: scope.scopeEmptyReason, scopeMessage: scope.scopeMessage };
    conds.push(inArray(productInspections.machineId, machineIds));
  }
  if (scopeFilter) conds.push(scopeFilter);
  const whereToday = and(...conds);
  // ⚠ CỬA SỔ THỨ HAI, CÙNG LỚP LỖI. "UPH 60 phút gần nhất" nghĩa là `[now − 60′, now]`; bản cũ
  // chỉ chặn dưới nên một bản ghi ở tương lai (vẫn trong ngày) cũng được cộng vào nhịp sản xuất
  // của giờ vừa rồi. Biên trên `dayEnd` KHÔNG cứu được chuyện này — 14:00 hôm nay vẫn < nửa đêm
  // — nên cửa sổ cuộn phải tự đóng ở `now`.
  const lastHourStart = new Date(now.getTime() - 60 * 60 * 1000);
  const whereLastHour = and(
    ...conds,
    gte(productInspections.inspectionTime, lastHourStart),
    lte(productInspections.inspectionTime, now),
  );

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
    dayEnd,
    timezone,
    now,
    scope,
  });
}
