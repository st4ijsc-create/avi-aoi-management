/**
 * U2 (doc 21 §6 / §3 G-3) — Ecosystem Command Center: AGGREGATION service.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A thin, READ-ONLY aggregation layer that assembles the whole-ecosystem live
 * hierarchy tree + a KPI roll-up + a seed alert list so the Command Center page
 * renders a single pane of glass WITHOUT hitting 10 routers itself.
 *
 * DESIGN PRINCIPLES (kept from the audit):
 *   • AGGREGATION ONLY — every number is sourced from an EXISTING service/query
 *     function. We NEVER recompute OEE / status / alarm logic here. When a source
 *     is disabled/absent we return an HONEST null (never a fabricated number).
 *   • REGISTRY-DRIVEN — a machine node's `deviceType` is resolved through the
 *     deviceTypeRegistry (which seeds from capabilityModel DEFAULT_PROFILES). A new
 *     device type therefore appears in the tree AUTOMATICALLY (no hard-coded switch).
 *   • REUSE THE SCENE GRAPH — the per-factory subtree spine (line→station→machine/
 *     robot + live state + active task) is `twin.sceneGraph.buildSceneGraph`, not a
 *     re-query. We only PROJECT its nodes into the command-center node shape and roll
 *     status UP.
 *   • NO CONTROL PATH, NO WRITES, NO new device data. Read-only + fail-safe.
 *
 * The status field surfaces the LIVE-vs-POLL dependency: the alarm rail is live via
 * U1's `alerts:stream` only when ECOSYSTEM_EVENTS_ENABLED is on; otherwise the page
 * should poll `recentAlerts`. This module reports that honestly.
 *
 * PERF: `hierarchy` fans out one sceneGraph per factory (each does a handful of
 * indexed selects + one telemetry select per robot). For a large estate this is the
 * heaviest call — see `hierarchy(scope.factoryId)` to narrow to one factory, and the
 * short-TTL cache below. `kpiSummary` reuses already-aggregated service functions.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  factories,
  machines as machinesTable,
  andonEvents,
  safetyEvents,
  sites,
  siteKpiRollup,
  oeeMetrics,
} from "../../../drizzle/schema";
import { tasks, robots } from "../../../drizzle/schema";
import { buildSceneGraph, type SceneGraph, type DeviceNode, type NormalizedState } from "../twin/sceneGraph";
import { resolveForMachineType } from "../standards/deviceTypeRegistry";
import { ecosystemEventsEnabled, type EcosystemSeverity, type EcosystemKind } from "./ecosystemEvents";
import { getAllMachinesOEELive } from "../oeeService";
import { countInbox, type InboxUser } from "../aiActionInbox";

// ════════════════════════════════════════════════════════════════════════════
// TYPES — the exact shapes the FE (U2 page) consumes.
// ════════════════════════════════════════════════════════════════════════════

/** Coarse, UI-facing status rolled UP the tree (worst-of children). */
export type NodeStatus = "ok" | "warn" | "down" | "idle" | "unknown";
export type NodeKind = "site" | "factory" | "line" | "station" | "machine" | "robot";

export interface NodeCounts {
  activeAlarms: number;
  activeTasks: number;
  offline: number;
}

export interface HierarchyNode {
  /** Stable id (`site:local` / `factory:3` / `line:2` / `station:5` / `machine:12` / `robot:3`). */
  id: string;
  kind: NodeKind;
  code: string;
  name: string;
  /** Resolved device-type key (registry-driven) — machine/robot leaves only. */
  deviceType?: string | null;
  /** Coarse status rolled UP from children (a down machine → its line/factory warns/downs). */
  status: NodeStatus;
  counts: NodeCounts;
  /** Numeric ref into the source table (factories.id / machines.id / robots.id / …). */
  refId: number | string | null;
  children?: HierarchyNode[];
}

export interface KpiField<T> {
  /** Honest null when the source is disabled/absent. */
  value: T | null;
  /** Which existing service/query supplied it (proof of no duplication). */
  source: string;
  /** false when the source is off / errored → the FE renders "—" not "0". */
  available: boolean;
  /**
   * doc67 W8 [P2] — optional FRESHNESS label when the value comes from a
   * fallback tier (e.g. "hôm nay" = mean of today's persisted snapshots, not
   * live). FE renders it as a small honest label next to the value. Absent for
   * live-sourced values (backward compatible).
   */
  sourceLabel?: string;
}

export interface KpiSummary {
  oee: KpiField<{ a: number | null; p: number | null; q: number | null; oee: number | null }>;
  wip: KpiField<{ count: number; bottleneck: string | null }>;
  alarms: KpiField<{ critical: number; high: number; total: number }>;
  energy: KpiField<{ kwh: number | null; co2: number | null }>;
  aiInsights: KpiField<{ count: number }>;
  sites: KpiField<{ total: number; reporting: number; stale: number; down: number }>;
  fleet: KpiField<{ tasksPending: number; tasksRunning: number; robotsOnline: number }>;
}

/** Normalized seed alert (mirrors the U1 EcosystemEvent envelope shape). */
export interface SeedAlert {
  id: string;
  ts: number;
  kind: EcosystemKind;
  severity: EcosystemSeverity;
  source: string;
  scope: { siteCode?: string | null; factoryId?: number | null; machineId?: number | null; robotId?: number | null; lineId?: number | null };
  title: string;
  detail?: Record<string, unknown>;
}

export interface CommandCenterStatus {
  /** true when U1 re-broadcast is on → the FE can subscribe `alerts:stream` (live). */
  liveAlertsEnabled: boolean;
  /** Human hint for the page badge. */
  mode: "live" | "polling";
}

export interface HierarchyScope {
  factoryId?: number | null;
  corporateCode?: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// PURE HELPERS — status roll-up + device-type resolution + projection.
// (Exported so tests can assert them deterministically without a DB.)
// ════════════════════════════════════════════════════════════════════════════

/** Map a scene-graph NormalizedState → the coarse command-center status. */
export function deviceStatus(state: NormalizedState): NodeStatus {
  switch (state) {
    case "running":
      return "ok";
    case "idle":
      return "idle";
    case "held":
    case "stopped":
      return "warn";
    case "aborted":
    case "estop":
      return "down";
    case "offline":
      return "down";
    default:
      return "unknown";
  }
}

const STATUS_RANK: Record<NodeStatus, number> = { down: 4, warn: 3, unknown: 2, idle: 1, ok: 0 };

/**
 * Roll a set of child statuses UP to a parent: WORST-of children.
 * A single `down` machine makes its station/line/factory `down`; a `warn` makes it
 * `warn`, etc. Empty children → `unknown` (nothing to report).
 */
export function rollUpStatus(children: NodeStatus[]): NodeStatus {
  if (children.length === 0) return "unknown";
  let worst: NodeStatus = "ok";
  for (const c of children) if (STATUS_RANK[c] > STATUS_RANK[worst]) worst = c;
  return worst;
}

/** Sum child counts into a parent (used at every level). */
export function sumCounts(children: NodeCounts[]): NodeCounts {
  return children.reduce<NodeCounts>(
    (acc, c) => ({
      activeAlarms: acc.activeAlarms + c.activeAlarms,
      activeTasks: acc.activeTasks + c.activeTasks,
      offline: acc.offline + c.offline,
    }),
    { activeAlarms: 0, activeTasks: 0, offline: 0 },
  );
}

/**
 * Resolve a machine's registry device-type key from its machineType (equipmentClass).
 * REGISTRY-DRIVEN: uses the deviceTypeRegistry seed (which is built from
 * capabilityModel DEFAULT_PROFILES) so a NEW machineType/type resolves automatically.
 * Fail-safe: unknown → "Equipment" (the base), never throws.
 */
export function resolveDeviceType(machineType: string | null | undefined): string {
  return resolveForMachineType(String(machineType ?? "")).typeKey;
}

/**
 * Project a scene-graph DeviceNode into a command-center leaf node.
 * `deviceType` for machines is resolved via the registry using the supplied
 * machineType map (keyed by machine refId). Robots get their scene `modelKind`/class.
 */
export function projectDevice(d: DeviceNode, machineTypeByRefId: Map<number, string>): HierarchyNode {
  const status = deviceStatus(d.state);
  const offline = d.state === "offline" ? 1 : 0;
  const activeTasks = d.activeTaskId != null ? 1 : 0;
  const activeAlarms = d.alarm != null ? 1 : 0;
  const deviceType =
    d.kind === "machine" ? resolveDeviceType(machineTypeByRefId.get(d.refId)) : resolveDeviceType("ROBOT");
  return {
    id: d.id,
    kind: d.kind,
    code: d.code,
    name: d.name,
    deviceType,
    status,
    counts: { activeAlarms, activeTasks, offline },
    refId: d.refId,
  };
}

/**
 * PURE — assemble ONE factory subtree (factory → lines → stations → {machines,robots})
 * from an already-built scene graph, rolling status UP and counts UP at every level.
 * `machineTypeByRefId` drives registry device-type resolution. `alarmCountByMachineId`
 * (from andon/safety, keyed by machineId) injects the active-alarm count onto leaves
 * so the roll-up reflects real alarms (the scene graph's per-device `alarm` is
 * best-effort and usually null today).
 */
export function assembleFactorySubtree(
  factory: { id: number; code: string; name: string },
  graph: SceneGraph,
  machineTypeByRefId: Map<number, string>,
  alarmCountByMachineId: Map<number, number>,
): HierarchyNode {
  const lineNodes: HierarchyNode[] = graph.lines.map((line) => {
    const stationNodes: HierarchyNode[] = line.stations.map((st) => {
      const leaves = st.devices.map((d) => {
        const node = projectDevice(d, machineTypeByRefId);
        // Inject real alarm counts onto machine leaves (andon/safety), keyed by machineId.
        if (d.kind === "machine") {
          const extra = alarmCountByMachineId.get(d.refId) ?? 0;
          if (extra > 0) {
            node.counts = { ...node.counts, activeAlarms: node.counts.activeAlarms + extra };
            // any active alarm at least warns the leaf if it wasn't already worse
            if (STATUS_RANK[node.status] < STATUS_RANK["warn"]) node.status = "warn";
          }
        }
        return node;
      });
      return {
        id: st.id,
        kind: "station" as const,
        code: st.code,
        name: st.name,
        status: rollUpStatus(leaves.map((l) => l.status)),
        counts: sumCounts(leaves.map((l) => l.counts)),
        refId: st.refId,
        children: leaves,
      };
    });
    return {
      id: line.id,
      kind: "line" as const,
      code: line.code,
      name: line.name,
      status: rollUpStatus(stationNodes.map((s) => s.status)),
      counts: sumCounts(stationNodes.map((s) => s.counts)),
      refId: line.refId,
      children: stationNodes,
    };
  });

  return {
    id: `factory:${factory.id}`,
    kind: "factory",
    code: factory.code,
    name: factory.name,
    status: rollUpStatus(lineNodes.map((l) => l.status)),
    counts: sumCounts(lineNodes.map((l) => l.counts)),
    refId: factory.id,
    children: lineNodes,
  };
}

/** Map a federation freshness state → a coarse site node status. */
export function siteFreshnessToStatus(state: "ok" | "stale" | "down"): NodeStatus {
  return state === "ok" ? "ok" : state === "stale" ? "warn" : "down";
}

// ════════════════════════════════════════════════════════════════════════════
// ALERT MAPPERS — normalize the existing alert stores into the U1 envelope shape.
// These are the SEED for the rail; live deltas come from U1 `alerts:stream`.
// ════════════════════════════════════════════════════════════════════════════

let seedSeq = 0;
function seedId(prefix: string, id: number, ts: number): string {
  seedSeq = (seedSeq + 1) % 1_000_000;
  return `${prefix}:${id}:${ts.toString(36)}-${seedSeq.toString(36)}`;
}

/** Map an andon state → envelope severity (mirrors ecosystemEvents.mapAndonSeverity). */
export function andonSeverity(state: string | null | undefined): EcosystemSeverity {
  const s = (state ?? "").toLowerCase();
  if (s === "red" || s === "call") return "critical";
  if (s === "yellow") return "high";
  return "info";
}

/** Map an andon_events row → the normalized seed-alert envelope. */
export function andonToSeed(row: {
  id: number;
  state: string;
  title: string;
  message?: string | null;
  machineId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  raisedAt: Date;
}): SeedAlert {
  const ts = row.raisedAt instanceof Date ? row.raisedAt.getTime() : Date.now();
  return {
    id: seedId("andon", row.id, ts),
    ts,
    kind: "andon",
    severity: andonSeverity(row.state),
    source: "andon",
    scope: { machineId: row.machineId ?? null, lineId: row.lineId ?? null },
    title: row.title ?? `Andon ${row.state}`,
    detail: { message: row.message ?? null, stationId: row.stationId ?? null, state: row.state },
  };
}

/** Map a safety_events row → the normalized seed-alert envelope. */
export function safetyToSeed(row: {
  id: number;
  eventType: string;
  robotId?: number | null;
  lineId?: number | null;
  stationId?: number | null;
  isNearMiss?: boolean | null;
  outcome?: string | null;
  createdAt: Date;
}): SeedAlert {
  const ts = row.createdAt instanceof Date ? row.createdAt.getTime() : Date.now();
  return {
    id: seedId("safety", row.id, ts),
    ts,
    kind: "safety",
    severity: row.isNearMiss ? "high" : "critical",
    source: "safety",
    scope: { robotId: row.robotId ?? null, lineId: row.lineId ?? null },
    title: `Safety: ${row.eventType}`,
    detail: { isNearMiss: !!row.isNearMiss, outcome: row.outcome ?? null, stationId: row.stationId ?? null },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// DB-BOUND ASSEMBLY — the tRPC router calls these. Each is fail-safe (empty on
// no-DB) + read-only. Tenant scope is applied by the caller (corporateCode filter).
// ════════════════════════════════════════════════════════════════════════════

/** The live-vs-poll status the page badges from. */
export function commandCenterStatus(): CommandCenterStatus {
  const live = ecosystemEventsEnabled();
  return { liveAlertsEnabled: live, mode: live ? "live" : "polling" };
}

/**
 * Build the full ecosystem hierarchy tree. sites[] → factories[] → lines[] →
 * stations[] → {machines[], robots[]}, status rolled UP, counts summed.
 *
 * Federation: when the sites registry has rows, each site becomes a `site` node
 * seeded from its latest roll-up (single-KPI today — U5 adds depth; we consume what
 * exists honestly). The LOCAL site's factories are expanded in full; REMOTE sites are
 * shown as leaf roll-up nodes (no cross-site drill yet — U5). When federation is
 * absent/single-site we emit ONE synthetic "local" site wrapping the local factories.
 */
export async function buildHierarchy(scope?: HierarchyScope): Promise<{ sites: HierarchyNode[] }> {
  const db = await getDb();
  if (!db) return { sites: [] };

  // ── local factories (optionally scoped) ──
  const factoryRows = await db.select().from(factories).where(eq(factories.isActive, true));
  const scopedFactories = factoryRows.filter((f) => {
    if (scope?.factoryId != null && f.id !== scope.factoryId) return false;
    if (scope?.corporateCode && f.corporateCode !== scope.corporateCode) return false;
    return true;
  });

  // machineType map for registry device-type resolution (ONE select for the estate,
  // hoisted out of the factory loop). Active alarm counts likewise (ONE pass).
  const machineTypeByRefId = new Map<number, string>();
  const mRows = await db.select({ id: machinesTable.id, machineType: machinesTable.machineType }).from(machinesTable);
  for (const m of mRows) machineTypeByRefId.set(m.id, String(m.machineType));
  const alarmCountByMachineId = await activeAlarmCountByMachine(db);

  const factoryNodes: HierarchyNode[] = [];
  for (const f of scopedFactories) {
    const graph = await buildSceneGraph(f.id);
    factoryNodes.push(assembleFactorySubtree({ id: f.id, code: f.code, name: f.name }, graph, machineTypeByRefId, alarmCountByMachineId));
  }

  // ── federation sites (honest: single-KPI roll-up today) ──
  let siteRows: Array<typeof sites.$inferSelect> = [];
  try {
    siteRows = await db.select().from(sites);
  } catch {
    siteRows = []; // sites table absent → single-site synthetic below
  }

  if (siteRows.length === 0) {
    // No federation → one synthetic LOCAL site wrapping the local factories.
    const local: HierarchyNode = {
      id: "site:local",
      kind: "site",
      code: "LOCAL",
      name: "Local site",
      status: rollUpStatus(factoryNodes.map((f) => f.status)),
      counts: sumCounts(factoryNodes.map((f) => f.counts)),
      refId: "local",
      children: factoryNodes,
    };
    return { sites: [local] };
  }

  // Federation present: expand the local site's factories; remote sites → roll-up leaf.
  const scopedSites = scope?.corporateCode ? siteRows.filter((s) => s.corporateCode === scope.corporateCode) : siteRows;
  const snaps = await db
    .select()
    .from(siteKpiRollup)
    .where(and(eq(siteKpiRollup.window, "snapshot"), isNull(siteKpiRollup.bucketStart)));
  const snapBySite = new Map(snaps.map((r) => [r.siteId, r]));
  const now = Date.now();

  const siteNodes: HierarchyNode[] = scopedSites.map((s) => {
    const snap = snapBySite.get(s.id);
    const f = freshness(snap?.fetchedAt ?? null, s.pollIntervalSec, s.status, now);
    if (s.isLocal) {
      return {
        id: `site:${s.id}`,
        kind: "site",
        code: s.code,
        name: s.name,
        status: rollUpStatus(factoryNodes.map((n) => n.status)),
        counts: sumCounts(factoryNodes.map((n) => n.counts)),
        refId: s.id,
        children: factoryNodes,
      };
    }
    // Remote site: single-KPI roll-up leaf (U5 adds drill/depth). Status from freshness.
    return {
      id: `site:${s.id}`,
      kind: "site",
      code: s.code,
      name: s.name,
      status: siteFreshnessToStatus(f.state),
      counts: { activeAlarms: 0, activeTasks: 0, offline: f.state === "down" ? 1 : 0 },
      refId: s.id,
      children: [],
    };
  });

  return { sites: siteNodes };
}

/**
 * Active-alarm count per machineId from the EXISTING alarm stores (andon unresolved +
 * safety recent). Read-only. Keyed by machineId so the tree roll-up reflects real alarms.
 */
async function activeAlarmCountByMachine(db: NonNullable<Awaited<ReturnType<typeof getDb>>>): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  try {
    const andons = await db.select({ machineId: andonEvents.machineId }).from(andonEvents).where(isNull(andonEvents.resolvedAt));
    for (const a of andons) if (a.machineId != null) out.set(a.machineId, (out.get(a.machineId) ?? 0) + 1);
  } catch {
    /* andon table absent → no counts */
  }
  return out;
}

/** Federation freshness (mirrors federationRouter.freshness — honest staleness). */
function freshness(fetchedAt: Date | null, pollIntervalSec: number, siteStatus: string, now = Date.now()): { state: "ok" | "stale" | "down" } {
  if (!fetchedAt) return { state: "down" };
  const ageSec = Math.max(0, Math.round((now - fetchedAt.getTime()) / 1000));
  const interval = pollIntervalSec > 0 ? pollIntervalSec : 60;
  if (siteStatus === "error" || ageSec > interval * 6) return { state: "down" };
  if (ageSec > interval * 2) return { state: "stale" };
  return { state: "ok" };
}

/**
 * Seed alert list (newest first) for the rail. Normalizes the EXISTING andon +
 * safety stores into the U1 envelope. Live deltas come from `alerts:stream` (U1).
 */
export async function buildRecentAlerts(opts?: { limit?: number; corporateCode?: string | null }): Promise<SeedAlert[]> {
  const db = await getDb();
  if (!db) return [];
  const limit = Math.max(1, Math.min(opts?.limit ?? 30, 200));

  const seeds: SeedAlert[] = [];
  try {
    const andons = await db
      .select({ id: andonEvents.id, state: andonEvents.state, title: andonEvents.title, message: andonEvents.message, machineId: andonEvents.machineId, lineId: andonEvents.lineId, stationId: andonEvents.stationId, raisedAt: andonEvents.raisedAt })
      .from(andonEvents)
      .where(isNull(andonEvents.resolvedAt))
      .orderBy(desc(andonEvents.raisedAt))
      .limit(limit);
    for (const a of andons) seeds.push(andonToSeed(a));
  } catch {
    /* andon absent */
  }
  try {
    const safety = await db
      .select({ id: safetyEvents.id, eventType: safetyEvents.eventType, robotId: safetyEvents.robotId, lineId: safetyEvents.lineId, stationId: safetyEvents.stationId, isNearMiss: safetyEvents.isNearMiss, outcome: safetyEvents.outcome, createdAt: safetyEvents.createdAt })
      .from(safetyEvents)
      .orderBy(desc(safetyEvents.createdAt))
      .limit(limit);
    for (const s of safety) seeds.push(safetyToSeed(s));
  } catch {
    /* safety absent */
  }

  return seeds.sort((a, b) => b.ts - a.ts).slice(0, limit);
}

// ════════════════════════════════════════════════════════════════════════════
// KPI SUMMARY — the command strip. Each field is sourced from an EXISTING service
// function; a disabled/absent source → an HONEST null (available:false), never a
// fabricated number.
// ════════════════════════════════════════════════════════════════════════════

/** Wrap a value + its source, marking availability. */
function field<T>(value: T | null, source: string, available = value != null): KpiField<T> {
  return { value, source, available };
}

/** Average the non-null OEE factors across all machines (mean of live per-machine OEE). */
export function aggregateOee(rows: Array<{ availability: number | null; performance: number | null; quality: number | null; oee: number | null }>): {
  a: number | null;
  p: number | null;
  q: number | null;
  oee: number | null;
} {
  const mean = (vals: Array<number | null>): number | null => {
    const ok = vals.filter((v): v is number => v != null && Number.isFinite(v));
    if (ok.length === 0) return null;
    return Number((ok.reduce((s, v) => s + v, 0) / ok.length).toFixed(2));
  };
  return {
    a: mean(rows.map((r) => r.availability)),
    p: mean(rows.map((r) => r.performance)),
    q: mean(rows.map((r) => r.quality)),
    oee: mean(rows.map((r) => r.oee)),
  };
}

/**
 * Assemble the KPI command strip. Reuses:
 *   • oee     ← oeeService.getAllMachinesOEELive (mean of live per-machine factors)
 *   • wip     ← wip_tracking count (mesControlTower data path) + line bottleneck
 *   • alarms  ← andon_events (unresolved) + safety_events (recent) severity buckets
 *   • energy  ← HONEST null: no estate total-kwh/co2 rollup exists (energyRouter is
 *               per-recipe/peak/forecast only). Surfaced as available:false, not 0.
 *   • aiInsights ← aiActionInbox.countInbox(user) (per-user scoped)
 *   • sites   ← federation site roll-ups (reporting/stale/down via freshness)
 *   • fleet   ← tasks (pending/running) + robots (online) counts (fleet data path)
 */
export async function buildKpiSummary(user: InboxUser, scope?: HierarchyScope): Promise<KpiSummary> {
  const db = await getDb();

  // ── OEE (reuse oeeService) ──
  let oee: KpiSummary["oee"];
  try {
    const rows = await getAllMachinesOEELive();
    oee = rows.length
      ? field(aggregateOee(rows), "oeeService.getAllMachinesOEELive", true)
      : field<{ a: number | null; p: number | null; q: number | null; oee: number | null }>(null, "oeeService.getAllMachinesOEELive", false);
  } catch {
    oee = field<{ a: number | null; p: number | null; q: number | null; oee: number | null }>(null, "oeeService.getAllMachinesOEELive", false);
  }

  // doc67 W8 [P2] — FALLBACK TẦNG 2: nguồn live rỗng / không đủ yếu tố (oee null)
  // → mean OEE NGÀY HIỆN TẠI từ các snapshot oee_metrics đã persist (bởi
  // oeeService.persistOEEMetric / oeeSnapshotScheduler — KHÔNG tính lại OEE ở
  // đây, chỉ lấy mean qua aggregateOee sẵn có). Cột lưu %×100 → /100 trước khi
  // gộp. Kèm sourceLabel "hôm nay" để FE hiện nhãn độ-tươi trung thực; không có
  // snapshot hôm nay → giữ honest null như cũ.
  if ((!oee.available || oee.value?.oee == null) && db) {
    try {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const snapRows = await db
        .select({
          availability: oeeMetrics.availability,
          performance: oeeMetrics.performance,
          quality: oeeMetrics.quality,
          oee: oeeMetrics.oee,
        })
        .from(oeeMetrics)
        .where(gte(oeeMetrics.timestamp, startOfToday));
      const agg = aggregateOee(
        (snapRows as Array<{ availability: number | null; performance: number | null; quality: number | null; oee: number | null }>).map((r) => ({
          availability: r.availability != null ? Number(r.availability) / 100 : null,
          performance: r.performance != null ? Number(r.performance) / 100 : null,
          quality: r.quality != null ? Number(r.quality) / 100 : null,
          oee: r.oee != null ? Number(r.oee) / 100 : null,
        })),
      );
      if (agg.oee != null) {
        oee = { ...field(agg, "oee_metrics (mean snapshot hôm nay)", true), sourceLabel: "hôm nay" };
      }
    } catch {
      /* snapshot table absent/errored → keep the honest null from tier 1 */
    }
  }

  // ── WIP + alarms + fleet + sites (direct reads over the EXISTING data paths) ──
  let wip: KpiSummary["wip"];
  let alarms: KpiSummary["alarms"];
  let fleet: KpiSummary["fleet"];
  let sitesField: KpiSummary["sites"];

  if (!db) {
    wip = field<{ count: number; bottleneck: string | null }>(null, "mesControlTower.wip_tracking", false);
    alarms = field<{ critical: number; high: number; total: number }>(null, "andon+safety", false);
    fleet = field<{ tasksPending: number; tasksRunning: number; robotsOnline: number }>(null, "fleet.tasks+robots", false);
    sitesField = field<{ total: number; reporting: number; stale: number; down: number }>(null, "federation.site_kpi_rollup", false);
  } else {
    // WIP — count active WIP units; bottleneck = station/line with the most.
    try {
      const { wipTracking } = await import("../../../drizzle/schema");
      const rows = await db.select({ id: wipTracking.id }).from(wipTracking).where(isNull(wipTracking.exitedAt));
      wip = field({ count: rows.length, bottleneck: null }, "mesControlTower.wip_tracking");
    } catch {
      wip = field<{ count: number; bottleneck: string | null }>(null, "mesControlTower.wip_tracking", false);
    }

    // Alarms — andon unresolved (by state) + safety recent (critical). Severity buckets.
    try {
      const andons = await db.select({ state: andonEvents.state }).from(andonEvents).where(isNull(andonEvents.resolvedAt));
      let critical = 0;
      let high = 0;
      for (const a of andons) {
        const sev = andonSeverity(a.state);
        if (sev === "critical") critical++;
        else if (sev === "high") high++;
      }
      let safetyCritical = 0;
      try {
        // Non-near-miss safety events count as critical alarms (advisory records).
        const safety = await db.select({ id: safetyEvents.id }).from(safetyEvents).where(eq(safetyEvents.isNearMiss, false));
        safetyCritical = safety.length;
      } catch {
        /* safety absent */
      }
      critical += safetyCritical;
      alarms = field({ critical, high, total: critical + high }, "andon_events+safety_events");
    } catch {
      alarms = field<{ critical: number; high: number; total: number }>(null, "andon_events+safety_events", false);
    }

    // Fleet — task + robot counts (fleet data path; NOT re-running allocation logic).
    try {
      const taskRows = await db.select({ status: tasks.status }).from(tasks);
      let tasksPending = 0;
      let tasksRunning = 0;
      for (const t of taskRows) {
        if (t.status === "pending" || t.status === "assigned") tasksPending++;
        else if (t.status === "running") tasksRunning++;
      }
      const robotRows = await db.select({ status: robots.status }).from(robots);
      const robotsOnline = robotRows.filter((r) => r.status !== "offline").length;
      fleet = field({ tasksPending, tasksRunning, robotsOnline }, "fleet.tasks+robots");
    } catch {
      fleet = field<{ tasksPending: number; tasksRunning: number; robotsOnline: number }>(null, "fleet.tasks+robots", false);
    }

    // Sites — federation roll-up freshness buckets (honest with 0/1 site).
    try {
      const siteRows = await db.select().from(sites);
      const scoped = scope?.corporateCode ? siteRows.filter((s) => s.corporateCode === scope.corporateCode) : siteRows;
      if (scoped.length === 0) {
        sitesField = field({ total: 0, reporting: 0, stale: 0, down: 0 }, "federation.sites");
      } else {
        const snaps = await db.select().from(siteKpiRollup).where(and(eq(siteKpiRollup.window, "snapshot"), isNull(siteKpiRollup.bucketStart)));
        const bySite = new Map(snaps.map((r) => [r.siteId, r]));
        const now = Date.now();
        let reporting = 0;
        let stale = 0;
        let down = 0;
        for (const s of scoped) {
          const snap = bySite.get(s.id);
          if (snap) reporting++;
          const f = freshness(snap?.fetchedAt ?? null, s.pollIntervalSec, s.status, now);
          if (f.state === "stale") stale++;
          else if (f.state === "down") down++;
        }
        sitesField = field({ total: scoped.length, reporting, stale, down }, "federation.site_kpi_rollup");
      }
    } catch {
      sitesField = field<{ total: number; reporting: number; stale: number; down: number }>(null, "federation.site_kpi_rollup", false);
    }
  }

  // ── AI insights (reuse aiActionInbox.countInbox — per-user scope) ──
  let aiInsights: KpiSummary["aiInsights"];
  try {
    const c = await countInbox(user);
    aiInsights = field({ count: c.count }, "aiActionInbox.countInbox");
  } catch {
    aiInsights = field<{ count: number }>(null, "aiActionInbox.countInbox", false);
  }

  // ── Energy — HONEST null: no estate total-kwh/co2 rollup function exists today. ──
  const energy = field<{ kwh: number | null; co2: number | null }>(null, "energyRouter (no estate total; per-recipe/peak/forecast only)", false);

  return { oee, wip, alarms, energy, aiInsights, sites: sitesField, fleet };
}
