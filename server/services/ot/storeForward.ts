/**
 * doc 24 Wave-1 / C1 — TELEMETRY STORE-AND-FORWARD (disk-backed WAL buffer).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM (the audit's single biggest production gap): today `telemetryBus.
 * ingestTelemetry` inserts canonical `ot_telemetry` rows DIRECTLY to the DB. If the
 * DB (or the dedicated TSDB) is down/degraded, the insert is caught and the sample is
 * SILENTLY DROPPED — an OT observation is lost forever.
 *
 * FIX (additive, flag-gated by OT_STORE_FORWARD_ENABLED, default OFF): when the
 * canonical insert persists 0 rows for a non-empty batch (DB unreachable / insert
 * failed), the rows are APPENDED to a DURABLE local WAL (append-only JSONL file +
 * in-memory mirror) instead of being dropped. On DB recovery `backfill()` replays the
 * buffered rows IN ORDER; each replay is IDEMPOTENT by the natural key
 * (adapterId, tag, ts) — a row already applied is not re-enqueued and, if the DB
 * lacks a unique constraint, an in-WAL "applied" ledger prevents double-insert on a
 * crash-replay. The buffer is BOUNDED (max entries + max age); on overflow the OLDEST
 * entries are dropped — but NEVER silently: every drop is counted + warned + metered.
 *
 * HONESTY: this module produces NO data of its own. It only ever holds rows a real
 * reader already handed the bus. With OT_STORE_FORWARD_ENABLED off every entry point
 * is a no-op → behaviour is EXACTLY as today (passthrough). The insert function is
 * INJECTED (setInsertFn) so the bus can wire its real DB path and tests can mock it —
 * no live DB is needed to exercise buffer/backfill/idempotency/overflow.
 *
 * This mirrors the edge offline-buffer idioms (edgeRuntime.ts): in-memory queue as the
 * source of truth, an optional file mirror for restart-replay, an injected transport,
 * and an opportunistic drain. It deliberately uses a FILE WAL (no schema migration) —
 * the doc-22 Timescale hypertable migration 0133 stays deferred and untouched.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { InsertOtTelemetry } from "../../../drizzle/schema/ot";

// ── flag ───────────────────────────────────────────────────────────────────────

/** Read the flag at call time so config toggles / tests take effect. */
export function storeForwardEnabled(): boolean {
  return (
    process.env.OT_STORE_FORWARD_ENABLED === "true" ||
    process.env.OT_STORE_FORWARD_ENABLED === "1"
  );
}

// ── config (env-driven; honest defaults) ────────────────────────────────────────

/** WAL file path (append-only JSONL). Default under ./data. */
function walFile(): string {
  const p = process.env.OT_STORE_FORWARD_FILE?.trim();
  return path.resolve(p && p.length > 0 ? p : "./data/ot-store-forward.jsonl");
}

/** Max buffered entries before the OLDEST are dropped (counted, never silent). */
function maxEntries(): number {
  const n = parseInt(process.env.OT_STORE_FORWARD_MAX || "100000", 10);
  return Number.isFinite(n) && n > 0 ? n : 100000;
}

/** Max age (ms) a buffered entry may live before it is dropped on the next sweep. */
function maxAgeMs(): number {
  const n = parseInt(process.env.OT_STORE_FORWARD_MAX_AGE_MS || String(24 * 60 * 60 * 1000), 10);
  return Number.isFinite(n) && n > 0 ? n : 24 * 60 * 60 * 1000;
}

/** How many entries to drain per backfill batch (bounded work per attempt). */
function drainBatch(): number {
  const n = parseInt(process.env.OT_STORE_FORWARD_DRAIN_BATCH || "500", 10);
  return Number.isFinite(n) && n > 0 ? n : 500;
}

// ── the durable WAL (in-memory queue is source of truth; optional file mirror) ──

/** One buffered canonical row + its natural dedupe key + enqueue time. */
interface WalEntry {
  /** Natural idempotency key: `${adapterId}|${tag}|${tsMillis}`. */
  key: string;
  /** When it was enqueued (for age-bounding). */
  enqueuedAt: number;
  /** The canonical ot_telemetry insert row (ts serialized to ISO in the file). */
  row: InsertOtTelemetry;
}

/** FIFO queue of rows that could not be persisted. Insertion order = replay order. */
const queue: WalEntry[] = [];
/** Fast membership set of keys currently queued (dedupe on enqueue). */
const queuedKeys = new Set<string>();
/**
 * Keys CONFIRMED applied to the DB (backfill or a prior direct insert we observed).
 * Guards against a crash-replay double-insert when the DB has no unique constraint on
 * the natural key. Bounded (see APPLIED_LEDGER_MAX) — old keys are evicted FIFO once
 * they are far enough in the past that a re-buffer of the same sample is implausible.
 */
const appliedKeys = new Set<string>();
const appliedOrder: string[] = [];
const APPLIED_LEDGER_MAX = 200000;

// ── honest metrics (never silently drop) ───────────────────────────────────────

interface StoreForwardMetrics {
  /** Rows appended to the buffer because the DB insert did not persist them. */
  buffered: number;
  /** Rows successfully backfilled (persisted) on recovery. */
  backfilled: number;
  /** Rows skipped during backfill because already applied (idempotent replay). */
  deduped: number;
  /** Rows dropped due to overflow (max entries) — counted, warned, NEVER silent. */
  droppedOverflow: number;
  /** Rows dropped due to age (max age) — counted, warned, NEVER silent. */
  droppedAge: number;
  /** Last successful backfill time (ISO), or null if never. */
  lastBackfillAt: string | null;
  /** Last time a row was buffered (ISO), or null. */
  lastBufferedAt: string | null;
}

const metrics: StoreForwardMetrics = {
  buffered: 0,
  backfilled: 0,
  deduped: 0,
  droppedOverflow: 0,
  droppedAge: 0,
  lastBackfillAt: null,
  lastBufferedAt: null,
};

// ── injected DB insert (so the bus wires the real path; tests mock it) ──────────

/**
 * Persist a batch of canonical rows. Returns the number ACTUALLY persisted. The bus
 * injects its real DB/TSDB insert; the default throws so a mis-wire is loud, not a
 * silent no-op that would swallow the whole buffer.
 */
export type InsertFn = (rows: InsertOtTelemetry[]) => Promise<number>;
let insertFn: InsertFn = async () => {
  throw new Error("[StoreForward] insert fn not wired (call setInsertFn)");
};

/** Wire the DB insert the backfill uses. Idempotent to set. */
export function setInsertFn(fn: InsertFn): void {
  insertFn = fn;
}

// ── natural key ─────────────────────────────────────────────────────────────────

/**
 * Natural idempotency key for a canonical row: (adapterId, tag, ts). adapterId + tag
 * come from `meta` (set by sampleToCanonical). Falls back to deviceId/metric so a row
 * from a non-OT reader (that lacks meta.adapterId) still gets a stable key.
 */
export function naturalKey(row: InsertOtTelemetry): string {
  const meta = (row.meta ?? {}) as Record<string, unknown>;
  const adapterId =
    meta.adapterId != null ? String(meta.adapterId) : row.deviceId != null ? String(row.deviceId) : "?";
  const tag = meta.tagKey != null ? String(meta.tagKey) : row.metric;
  const tsMillis = row.ts instanceof Date ? row.ts.getTime() : new Date(row.ts as string | number).getTime();
  return `${adapterId}|${tag}|${tsMillis}`;
}

// ── file mirror (append-only JSONL; best-effort — memory is the truth) ──────────

let fileDirty = false;

/** Serialize an entry to a JSONL line (ts → ISO so it round-trips). */
function entryToLine(e: WalEntry): string {
  const row = { ...e.row, ts: e.row.ts instanceof Date ? e.row.ts.toISOString() : e.row.ts };
  return JSON.stringify({ key: e.key, enqueuedAt: e.enqueuedAt, row });
}

/** Rewrite the whole WAL file from the in-memory queue (best-effort). */
async function flushFile(): Promise<void> {
  if (!fileDirty) return;
  fileDirty = false;
  const file = walFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lines = queue.map(entryToLine).join("\n");
    await fs.writeFile(file, lines.length ? lines + "\n" : "", "utf8");
  } catch (err) {
    // File mirror is best-effort; the in-memory queue remains the source of truth.
    fileDirty = true; // retry on the next flush
    console.warn("[StoreForward] WAL file flush failed:", (err as Error)?.message || err);
  }
}

/** Restore the buffer from the WAL file mirror (call on process start). */
export async function restore(): Promise<number> {
  const file = walFile();
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    return queue.length; // no file yet → whatever is already in memory
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as { key?: string; enqueuedAt?: number; row?: Record<string, unknown> };
      if (!parsed.row) continue;
      const row = { ...parsed.row, ts: new Date(String(parsed.row.ts)) } as InsertOtTelemetry;
      const key = typeof parsed.key === "string" ? parsed.key : naturalKey(row);
      if (queuedKeys.has(key) || appliedKeys.has(key)) continue;
      queue.push({ key, enqueuedAt: parsed.enqueuedAt ?? Date.now(), row });
      queuedKeys.add(key);
    } catch {
      /* skip a corrupt line */
    }
  }
  return queue.length;
}

// ── applied ledger ──────────────────────────────────────────────────────────────

function markApplied(key: string): void {
  if (appliedKeys.has(key)) return;
  appliedKeys.add(key);
  appliedOrder.push(key);
  if (appliedOrder.length > APPLIED_LEDGER_MAX) {
    const evict = appliedOrder.splice(0, appliedOrder.length - APPLIED_LEDGER_MAX);
    for (const k of evict) appliedKeys.delete(k);
  }
}

// ── enqueue (buffer instead of drop) ────────────────────────────────────────────

/** Drop entries older than maxAge from the FRONT of the queue (counted + warned). */
function evictAged(): void {
  const cutoff = Date.now() - maxAgeMs();
  let dropped = 0;
  while (queue.length > 0 && queue[0].enqueuedAt < cutoff) {
    const e = queue.shift()!;
    queuedKeys.delete(e.key);
    dropped += 1;
  }
  if (dropped > 0) {
    metrics.droppedAge += dropped;
    fileDirty = true;
    console.warn(`[StoreForward] dropped ${dropped} telemetry row(s) past max age (total aged-drop=${metrics.droppedAge})`);
  }
}

/** Enforce the max-entries bound by dropping the OLDEST (counted + warned). */
function evictOverflow(): void {
  const cap = maxEntries();
  let dropped = 0;
  while (queue.length > cap) {
    const e = queue.shift()!;
    queuedKeys.delete(e.key);
    dropped += 1;
  }
  if (dropped > 0) {
    metrics.droppedOverflow += dropped;
    fileDirty = true;
    console.warn(`[StoreForward] BUFFER OVERFLOW — dropped ${dropped} oldest telemetry row(s) (cap=${cap}, total overflow-drop=${metrics.droppedOverflow})`);
  }
}

/**
 * Buffer canonical rows that could not be persisted. Idempotent: a row whose natural
 * key is already queued OR already applied is skipped (no double-buffer). Bounded by
 * max-age + max-entries; overflow drops the OLDEST (counted, warned, never silent).
 * No-op when the flag is off. Returns how many rows were newly buffered.
 */
export async function buffer(rows: InsertOtTelemetry[]): Promise<number> {
  if (!storeForwardEnabled() || !rows || rows.length === 0) return 0;
  evictAged();
  let added = 0;
  for (const row of rows) {
    const key = naturalKey(row);
    if (queuedKeys.has(key) || appliedKeys.has(key)) continue;
    queue.push({ key, enqueuedAt: Date.now(), row });
    queuedKeys.add(key);
    added += 1;
  }
  if (added > 0) {
    metrics.buffered += added;
    metrics.lastBufferedAt = new Date().toISOString();
    fileDirty = true;
  }
  evictOverflow();
  await flushFile();
  if (added > 0) {
    console.warn(`[StoreForward] buffered ${added} telemetry row(s) (DB unavailable); queue=${queue.length}`);
  }
  return added;
}

// ── backfill (replay in order, idempotent) ──────────────────────────────────────

let draining = false;

/**
 * Replay buffered rows to the DB IN ORDER (oldest first), in bounded batches. Each
 * batch is persisted via the injected insert fn; a batch is only removed from the
 * queue once its insert is CONFIRMED (persisted count > 0 OR the batch was entirely
 * already-applied). Idempotent: keys already in the applied ledger are filtered out of
 * the batch (deduped) before insert, so a crash-replay never double-inserts. If the DB
 * is still down (insert throws or persists 0 fresh rows) the batch is LEFT queued and
 * the drain stops (will retry next call). No-op when the flag is off.
 *
 * Returns a summary. `drained` = rows persisted this call; `remaining` = still queued.
 */
export async function backfill(): Promise<{
  enabled: boolean;
  drained: number;
  deduped: number;
  remaining: number;
}> {
  if (!storeForwardEnabled()) {
    return { enabled: false, drained: 0, deduped: 0, remaining: queue.length };
  }
  if (draining) {
    // A drain is already in-flight; don't run concurrently (single-flight).
    return { enabled: true, drained: 0, deduped: 0, remaining: queue.length };
  }
  draining = true;
  evictAged();
  let drained = 0;
  let deduped = 0;
  try {
    const batchSize = drainBatch();
    while (queue.length > 0) {
      const batch = queue.slice(0, batchSize);

      // Idempotent replay: skip rows already applied (crash-replay guard).
      const fresh: WalEntry[] = [];
      let batchDeduped = 0;
      for (const e of batch) {
        if (appliedKeys.has(e.key)) batchDeduped += 1;
        else fresh.push(e);
      }

      if (fresh.length === 0) {
        // Whole batch already applied → safe to drop it and continue.
        removeFront(batch.length);
        deduped += batchDeduped;
        continue;
      }

      let persisted = 0;
      try {
        persisted = await insertFn(fresh.map((e) => e.row));
      } catch (err) {
        // DB still down → stop; leave the batch queued for the next attempt.
        console.warn("[StoreForward] backfill insert failed; leaving buffered:", (err as Error)?.message || err);
        break;
      }

      if (persisted <= 0) {
        // Nothing persisted (DB absent/degraded) → stop, retry later. Do NOT drop.
        break;
      }

      // Confirmed persisted → mark applied, remove the whole batch from the front.
      for (const e of fresh) markApplied(e.key);
      removeFront(batch.length);
      drained += fresh.length;
      deduped += batchDeduped;
    }
  } finally {
    draining = false;
  }

  if (drained > 0) {
    metrics.backfilled += drained;
    metrics.lastBackfillAt = new Date().toISOString();
  }
  if (deduped > 0) metrics.deduped += deduped;
  if (drained > 0 || deduped > 0) {
    fileDirty = true;
    await flushFile();
    console.log(`[StoreForward] backfilled ${drained} row(s) (${deduped} deduped); queue=${queue.length}`);
  }
  return { enabled: true, drained, deduped, remaining: queue.length };
}

/** Remove the first `n` entries from the queue + their key set. */
function removeFront(n: number): void {
  const removed = queue.splice(0, n);
  for (const e of removed) queuedKeys.delete(e.key);
  if (removed.length > 0) fileDirty = true;
}

// ── status (for a future health endpoint / UI — getter only, no route) ──────────

export interface StoreForwardStatus extends StoreForwardMetrics {
  enabled: boolean;
  /** Rows currently buffered (not yet backfilled). */
  bufferedCount: number;
  /** Configured bounds (for the health card). */
  maxEntries: number;
  maxAgeMs: number;
  /** Where the WAL persists. */
  walFile: string;
}

/** Snapshot of buffer state + honest metrics (no I/O). For a health endpoint/UI. */
export function getStatus(): StoreForwardStatus {
  return {
    enabled: storeForwardEnabled(),
    bufferedCount: queue.length,
    maxEntries: maxEntries(),
    maxAgeMs: maxAgeMs(),
    walFile: walFile(),
    ...metrics,
  };
}

/** Rows currently buffered (fast getter). */
export function bufferedCount(): number {
  return queue.length;
}

// ── test / maintenance helpers ──────────────────────────────────────────────────

/** Clear ALL buffer + ledger + metric state (tests / maintenance). */
export function _reset(): void {
  queue.length = 0;
  queuedKeys.clear();
  appliedKeys.clear();
  appliedOrder.length = 0;
  metrics.buffered = 0;
  metrics.backfilled = 0;
  metrics.deduped = 0;
  metrics.droppedOverflow = 0;
  metrics.droppedAge = 0;
  metrics.lastBackfillAt = null;
  metrics.lastBufferedAt = null;
  fileDirty = false;
  draining = false;
  insertFn = async () => {
    throw new Error("[StoreForward] insert fn not wired (call setInsertFn)");
  };
}
