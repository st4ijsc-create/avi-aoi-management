/**
 * doc 44 W2-A1 / G2.1 — ISA-95 path resolver for the UNS v2 topic tree.
 *
 * Resolves platform ids → the REAL hierarchy segments used by topicV2:
 *
 *   machines → stations (cell) → production_lines (line) → workshops (area)
 *            → factories (site)
 *
 * Segments are the hierarchy CODES (stable, human-assigned), slugged by
 * topicV2.slugSegment. A missing level (machine without station/line/…)
 * resolves to the honest literal `unassigned` + ONE console.warn per cache
 * fill — never a fabricated name.
 *
 * Caching: small in-module LRU (bounded) with a 5-minute TTL (env-tunable via
 * UNS_TOPIC_V2_CACHE_TTL_MS) — hierarchy edits become visible within the TTL
 * without restarting. `invalidateIsa95ResolverCache()` clears everything
 * (tests/ops).
 *
 * NO flag check here — callers (unsPublisher/unsAggregates) gate on
 * UNS_TOPIC_V2_ENABLED / UNS_AGGREGATES_ENABLED before resolving.
 */

import { sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { executeRows } from "../../utils/kpi";
import { slugSegment, UNS_V2_UNASSIGNED, type Isa95PathV2 } from "./topicV2";

// ─── Tunables ─────────────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 2000;

function ttlMs(): number {
  const n = Number(process.env.UNS_TOPIC_V2_CACHE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_MS;
}

// ─── Bounded LRU-with-TTL cache ───────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/** Map iteration order == insertion order → delete+set on hit gives LRU recency. */
const pathCache = new Map<string, CacheEntry<Isa95PathV2 | null>>();
const machineIdCache = new Map<string, CacheEntry<number | null>>();

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): CacheEntry<T> | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  // refresh recency
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function cacheSet<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // evict least-recently-used (first inserted)
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs() });
}

/** Clear every cached resolution (tests / after hierarchy bulk edits). */
export function invalidateIsa95ResolverCache(): void {
  pathCache.clear();
  machineIdCache.clear();
}

// ─── Row → path assembly (honest fallback + warn) ────────────────────────────

interface HierarchyRow {
  machine_code: string | null;
  station_code: string | null;
  line_code: string | null;
  workshop_code: string | null;
  factory_code: string | null;
}

function assemblePath(row: HierarchyRow, warnKey: string): Isa95PathV2 {
  const missing: string[] = [];
  const seg = (raw: string | null, level: string): string => {
    if (raw == null || String(raw).trim().length === 0) {
      missing.push(level);
      return UNS_V2_UNASSIGNED;
    }
    return slugSegment(raw);
  };
  const path: Isa95PathV2 = {
    site: seg(row.factory_code, "site(factory)"),
    area: seg(row.workshop_code, "area(workshop)"),
    line: seg(row.line_code, "line(production_line)"),
    cell: seg(row.station_code, "cell(station)"),
    equipment: seg(row.machine_code, "equipment(machine)"),
  };
  if (missing.length > 0) {
    // Honest: the level is genuinely unmapped in the hierarchy — say so, once per
    // cache fill (repeats at most once per TTL, no hot-path log spam).
    console.warn(
      `[UNS v2] ISA-95 resolve ${warnKey}: missing hierarchy level(s) ${missing.join(", ")} → segment '${UNS_V2_UNASSIGNED}'`,
    );
  }
  return path;
}

// ─── Resolvers ────────────────────────────────────────────────────────────────

/**
 * Resolve a machine id → full ISA-95 path (site/area/line/cell/equipment).
 * Returns null when the machine row itself does not exist (caller skips the v2
 * publish — nothing is invented). Missing intermediate levels → `unassigned`.
 */
export async function resolveIsa95Path(machineId: number): Promise<Isa95PathV2 | null> {
  if (!Number.isInteger(machineId) || machineId <= 0) return null;
  const key = `m:${machineId}`;
  const hit = cacheGet(pathCache, key);
  if (hit) return hit.value;

  try {
    const db = await getDb();
    if (!db) return null; // no DB → no resolution (do NOT cache: transient)

    const rows = executeRows(
      await db.execute(sql`
        SELECT m.code AS machine_code,
               s.code AS station_code,
               l.code AS line_code,
               w.code AS workshop_code,
               f.code AS factory_code
        FROM machines m
        LEFT JOIN stations s        ON s.id = m."stationId"
        LEFT JOIN production_lines l ON l.id = s."lineId"
        LEFT JOIN workshops w       ON w.id = l."workshopId"
        LEFT JOIN factories f       ON f.id = w."factoryId"
        WHERE m.id = ${machineId}
        LIMIT 1
      `),
    ) as HierarchyRow[];

    if (!rows[0]) {
      console.warn(`[UNS v2] ISA-95 resolve machine ${machineId}: machine not found — skipping v2 publish`);
      cacheSet(pathCache, key, null);
      return null;
    }
    const path = assemblePath(rows[0], `machine ${machineId}`);
    cacheSet(pathCache, key, path);
    return path;
  } catch (err) {
    console.error(`[UNS v2] ISA-95 resolve machine ${machineId} failed:`, (err as Error)?.message || err);
    return null;
  }
}

/**
 * Resolve a station id → ISA-95 path. The equipment segment is the FIRST active
 * machine at that station (deterministic: lowest id — mirrors the existing
 * publish-side `Station{N}` ↔ machine convention in resolveSparkplugTarget);
 * a station with no active machine gets equipment = `unassigned` (+warn).
 * Returns null when the station row does not exist.
 */
export async function resolveIsa95PathByStation(stationId: number): Promise<Isa95PathV2 | null> {
  if (!Number.isInteger(stationId) || stationId <= 0) return null;
  const key = `s:${stationId}`;
  const hit = cacheGet(pathCache, key);
  if (hit) return hit.value;

  try {
    const db = await getDb();
    if (!db) return null;

    const rows = executeRows(
      await db.execute(sql`
        SELECT (SELECT m.code FROM machines m
                WHERE m."stationId" = s.id AND m."isActive" = true
                ORDER BY m.id ASC LIMIT 1) AS machine_code,
               s.code AS station_code,
               l.code AS line_code,
               w.code AS workshop_code,
               f.code AS factory_code
        FROM stations s
        LEFT JOIN production_lines l ON l.id = s."lineId"
        LEFT JOIN workshops w       ON w.id = l."workshopId"
        LEFT JOIN factories f       ON f.id = w."factoryId"
        WHERE s.id = ${stationId}
        LIMIT 1
      `),
    ) as HierarchyRow[];

    if (!rows[0]) {
      console.warn(`[UNS v2] ISA-95 resolve station ${stationId}: station not found — skipping v2 publish`);
      cacheSet(pathCache, key, null);
      return null;
    }
    const path = assemblePath(rows[0], `station ${stationId}`);
    cacheSet(pathCache, key, path);
    return path;
  } catch (err) {
    console.error(`[UNS v2] ISA-95 resolve station ${stationId} failed:`, (err as Error)?.message || err);
    return null;
  }
}

/** Resolve a device-adapter id → its machineId (null when unmapped/unknown). */
export async function resolveMachineIdByAdapterId(adapterId: number): Promise<number | null> {
  if (!Number.isInteger(adapterId) || adapterId <= 0) return null;
  const key = `aid:${adapterId}`;
  const hit = cacheGet(machineIdCache, key);
  if (hit) return hit.value;
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = executeRows(
      await db.execute(sql`
        SELECT "machineId" AS machine_id FROM device_adapters WHERE id = ${adapterId} LIMIT 1
      `),
    ) as Array<{ machine_id: number | null }>;
    const machineId = rows[0]?.machine_id != null ? Number(rows[0].machine_id) : null;
    cacheSet(machineIdCache, key, machineId);
    return machineId;
  } catch (err) {
    console.error(`[UNS v2] adapter ${adapterId} → machineId resolve failed:`, (err as Error)?.message || err);
    return null;
  }
}

/** Resolve a device-adapter CODE (Sparkplug deviceId) → its machineId. */
export async function resolveMachineIdByAdapterCode(code: string): Promise<number | null> {
  const trimmed = (code || "").trim();
  if (!trimmed) return null;
  const key = `ac:${trimmed}`;
  const hit = cacheGet(machineIdCache, key);
  if (hit) return hit.value;
  try {
    const db = await getDb();
    if (!db) return null;
    const rows = executeRows(
      await db.execute(sql`
        SELECT "machineId" AS machine_id FROM device_adapters WHERE code = ${trimmed} LIMIT 1
      `),
    ) as Array<{ machine_id: number | null }>;
    const machineId = rows[0]?.machine_id != null ? Number(rows[0].machine_id) : null;
    cacheSet(machineIdCache, key, machineId);
    return machineId;
  } catch (err) {
    console.error(`[UNS v2] adapter code '${trimmed}' → machineId resolve failed:`, (err as Error)?.message || err);
    return null;
  }
}
