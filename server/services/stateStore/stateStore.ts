/**
 * doc 44 W2-B1 / G2.12 — Path-addressable STATE STORE (SYNAPSE Tầng 2 §10.1/§14).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Keeps the LATEST StateSnapshot per ISA-95 path ({site}/{area}/{line}/{cell}/
 * {equipment}) so "bây giờ thế nào?" is a millisecond read — the serving twin
 * of the retained `.../state` topic on the UNS tree (topicV2/unsPublisher).
 *
 * BACKEND (reuses the sanctioned cacheService pattern — L1 LRU + L2 Redis):
 *   • L1 — bounded in-module Map (LRU + TTL). Always present; powers the
 *     synchronous prefix scan getByPrefix().
 *   • L2 — the TieredCacheService facade (`uns:state:{path}` keys). When
 *     REDIS_URL is configured every replica shares per-path snapshots; when it
 *     is not, the facade degrades to its own L1 and this store is honestly
 *     single-node. NOTE (honest limitation): getByPrefix scans L1 ONLY — the
 *     cache facade exposes no key listing, so a prefix view reflects THIS
 *     node's snapshots (per-path getState() is still cross-replica via L2).
 *
 * SOURCES:
 *   • LIVE — ingest hooks (ingest.ts, flag STATE_STORE_ENABLED, default OFF)
 *     fed by the socket machine status/heartbeat listeners. source:'live'.
 *   • DB-FALLBACK — getState() miss → rebuilt from machines.operationStatus +
 *     the latest ot_telemetry samples + latest machine_status_logs presence,
 *     honestly stamped source:'db-fallback' (never presented as live).
 *
 * READ-ONLY toward devices: nothing here writes to any machine.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { eq, and, desc } from "drizzle-orm";
import { toCanonicalState } from "../uns/topicV2";

// ─── Serving schema (spec §10.1) ──────────────────────────────────────────────

/** One reduced value entry: {v, unit?, q?} — mirrors the spec's values map. */
export interface StateSnapshotValue {
  v: unknown;
  unit?: string;
  q?: string;
}

/** StateSnapshot — the §10.1 serving shape + honest provenance fields. */
export interface StateSnapshot {
  /** ISA-95 path: {site}/{area}/{line}/{cell}/{equipment}. */
  path: string;
  /** ISO timestamp of the snapshot. */
  ts: string;
  /** Canonical equipment state (EXECUTE/IDLE/STOPPED/… — toCanonicalState). */
  state: string;
  values?: Record<string, StateSnapshotValue>;
  health?: "online" | "degraded" | "offline";
  /** HONEST provenance: 'live' (ingest hook) vs 'db-fallback' (rebuilt on read). */
  source: "live" | "db-fallback";
  /** Resolved platform machine id when known. */
  machineId?: number;
}

// ─── Flags / tunables (read at call time — testable with stubEnv) ────────────

/** G2.12 gate for the LIVE ingest path (default OFF). Reads still work
 *  (db-fallback) so the REST /v1/state API stays functional either way. */
export function stateStoreEnabled(): boolean {
  return process.env.STATE_STORE_ENABLED === "true" || process.env.STATE_STORE_ENABLED === "1";
}

function ttlMs(): number {
  const n = Number(process.env.STATE_STORE_TTL_MS);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60 * 1000; // 15 min
}

function maxEntries(): number {
  const n = Number(process.env.STATE_STORE_MAX_ENTRIES);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

/** Cap on values entries kept per snapshot (spec: "values rút gọn"). */
export function valuesMax(): number {
  const n = Number(process.env.STATE_STORE_VALUES_MAX);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 64) : 16;
}

const L2_KEY_PREFIX = "uns:state:";

// ─── L1 — bounded LRU-with-TTL map (insertion order = recency) ────────────────

interface L1Entry {
  snap: StateSnapshot;
  expiresAt: number;
}

const l1 = new Map<string, L1Entry>();

function l1Get(path: string): StateSnapshot | null {
  const hit = l1.get(path);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    l1.delete(path);
    return null;
  }
  // refresh recency
  l1.delete(path);
  l1.set(path, hit);
  return hit.snap;
}

function l1Set(path: string, snap: StateSnapshot): void {
  if (!l1.has(path) && l1.size >= maxEntries()) {
    const oldest = l1.keys().next().value;
    if (oldest !== undefined) l1.delete(oldest);
  }
  l1.set(path, { snap, expiresAt: Date.now() + ttlMs() });
}

// ─── update listeners (the WS gateway subscribes here) ────────────────────────

type StateUpdateListener = (snap: StateSnapshot) => void;
const listeners = new Set<StateUpdateListener>();

/** Subscribe to every setState() (LIVE + db-fallback). Returns unsubscribe. */
export function onStateUpdate(cb: StateUpdateListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(snap: StateSnapshot): void {
  for (const cb of listeners) {
    try {
      cb(snap);
    } catch (err) {
      console.error("[StateStore] update listener failed:", (err as Error)?.message ?? err);
    }
  }
}

// ─── Path normalization ───────────────────────────────────────────────────────

/** Trim slashes/whitespace; empty → null. Paths are already-lowercase slugs. */
export function normalizePath(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/^\/+|\/+$/g, "");
  if (!s || s.length > 512) return null;
  return s;
}

// ─── Core API ────────────────────────────────────────────────────────────────

/**
 * Write a snapshot for a path: L1 (sync) + L2 (fire-and-forget, only reached
 * when Redis is configured — the cache facade decides) + notify listeners.
 * Only LIVE snapshots overwrite LIVE snapshots older ones; a db-fallback write
 * never clobbers a fresher live snapshot already cached.
 */
export function setState(path: string, snap: StateSnapshot): void {
  const key = normalizePath(path);
  if (!key) return;
  const existing = l1Get(key);
  if (existing && existing.source === "live" && snap.source === "db-fallback") {
    // Never downgrade a live snapshot with a rebuilt one.
    return;
  }
  l1Set(key, snap);
  // L2 write — async, never blocks the caller; the facade no-ops the Redis
  // tier when REDIS_URL is absent (honest single-node degrade).
  void (async () => {
    try {
      const { cacheService } = await import("../cacheService");
      await cacheService.setAsync(`${L2_KEY_PREFIX}${key}`, snap, ttlMs());
    } catch (err) {
      console.error("[StateStore] L2 set failed:", (err as Error)?.message ?? err);
    }
  })();
  notify(snap);
}

/**
 * Read the snapshot for one path: L1 → L2 → (optional) DB rebuild.
 * Returns null when the path maps to NOTHING (no cached snapshot AND no
 * machine with that isa95_path) — the REST layer turns that into a 404.
 */
export async function getState(
  path: string,
  opts: { backfill?: boolean } = {},
): Promise<StateSnapshot | null> {
  const key = normalizePath(path);
  if (!key) return null;

  const fromL1 = l1Get(key);
  if (fromL1) return fromL1;

  // L2 (shared across replicas when Redis is configured).
  try {
    const { cacheService } = await import("../cacheService");
    const fromL2 = await cacheService.getAsync<StateSnapshot>(`${L2_KEY_PREFIX}${key}`);
    if (fromL2 && typeof fromL2 === "object" && typeof fromL2.path === "string") {
      l1Set(key, fromL2);
      return fromL2;
    }
  } catch (err) {
    console.error("[StateStore] L2 get failed:", (err as Error)?.message ?? err);
  }

  if (opts.backfill === false) return null;
  return backfillFromDb(key);
}

/**
 * Prefix view over the CURRENT L1 snapshots (sorted by path). HONEST: this is
 * a this-node view (see module header) — sufficient for the WS snapshot-then-
 * stream contract, whose deltas are produced on this node too.
 */
export function getByPrefix(prefix: string): StateSnapshot[] {
  const key = normalizePath(prefix);
  if (!key) return [];
  const now = Date.now();
  const out: StateSnapshot[] = [];
  for (const [path, entry] of l1) {
    if (entry.expiresAt <= now) continue;
    if (path === key || path.startsWith(`${key}/`)) out.push(entry.snap);
  }
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

// ─── Lazy DB backfill (honest 'db-fallback') ─────────────────────────────────

/**
 * Rebuild a snapshot from the DB for a path that has no cached state:
 * machines.isa95_path → operationStatus (canonicalized) + a few latest
 * ot_telemetry samples as values + latest machine_status_logs presence as
 * health. Marked source:'db-fallback'. Null when no machine maps to the path.
 */
export async function backfillFromDb(path: string): Promise<StateSnapshot | null> {
  const key = normalizePath(path);
  if (!key) return null;
  try {
    const { getDb } = await import("../../db/connection");
    const { machines, machineStatusLogs } = await import("../../../drizzle/schema");
    const db = await getDb();
    if (!db) return null;

    const [m] = await db
      .select({
        id: machines.id,
        operationStatus: machines.operationStatus,
        lastHeartbeat: machines.lastHeartbeat,
      })
      .from(machines)
      .where(and(eq(machines.isa95Path, key), eq(machines.isActive, true)))
      .limit(1);
    if (!m) return null;

    // Latest few telemetry samples (deduped per metric, newest first).
    let values: Record<string, StateSnapshotValue> | undefined;
    try {
      const { getLatestTelemetry } = await import("../../db/otTelemetry");
      const rows = await getLatestTelemetry({ machineId: m.id, limit: valuesMax() * 2 });
      const byMetric: Record<string, StateSnapshotValue> = {};
      let n = 0;
      for (const r of rows) {
        if (byMetric[r.tagKey] !== undefined) continue;
        byMetric[r.tagKey] = {
          v: r.valueNumeric ?? r.valueText ?? null,
          ...(r.unit ? { unit: r.unit } : {}),
          ...(r.quality ? { q: r.quality.toUpperCase() } : {}),
        };
        if (++n >= valuesMax()) break;
      }
      if (n > 0) values = byMetric;
    } catch {
      /* telemetry read is best-effort — values simply omitted */
    }

    // Presence → health (honest: omitted when no presence record exists).
    let health: StateSnapshot["health"];
    try {
      const [presence] = await db
        .select({ status: machineStatusLogs.status })
        .from(machineStatusLogs)
        .where(eq(machineStatusLogs.machineId, m.id))
        .orderBy(desc(machineStatusLogs.timestamp))
        .limit(1);
      if (presence?.status === "online") health = "online";
      else if (presence?.status === "offline") health = "offline";
    } catch {
      /* presence read best-effort */
    }

    const snap: StateSnapshot = {
      path: key,
      ts: new Date().toISOString(),
      state: toCanonicalState(m.operationStatus),
      ...(values ? { values } : {}),
      ...(health ? { health } : {}),
      source: "db-fallback",
      machineId: m.id,
    };
    setState(key, snap);
    return snap;
  } catch (err) {
    console.error("[StateStore] db backfill failed:", (err as Error)?.message ?? err);
    return null;
  }
}

// ─── Test seam ────────────────────────────────────────────────────────────────

/** Clear the L1 store + listeners (tests). Does NOT touch the shared cache facade. */
export function _resetStateStoreForTests(): void {
  l1.clear();
  listeners.clear();
}
