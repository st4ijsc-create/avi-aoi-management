/**
 * Doc 27 Đợt 2 / W2-C — INSPECTION INGEST STORE-AND-FORWARD (disk-backed WAL).
 * Gaps C3 (P0) + R11 + C5-partial.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM: `machineApi.submitInspection` (machineApiRouters.ts) inserts the
 * inspection + measurement rows DIRECTLY. If the DB is down/degraded the mutation
 * throws, the machine client gets an error and — depending on the vendor client —
 * the result AND its base64 defect images are lost forever. The existing WAL
 * (server/services/ot/storeForward.ts) only covers `ot_telemetry` rows.
 *
 * FIX (additive, flag-gated): when the submit pipeline fails with a TRANSIENT
 * error (DB unreachable / insert threw — NOT an auth/validation error), the FULL
 * submission payload (incl. inline base64 images) is appended to a durable local
 * WAL (append-only JSONL + in-memory mirror), the machine is ACKed with
 * `{ success:true, queued:true, submissionId }`, and a background worker replays
 * the payload through the SAME pipeline once the DB recovers.
 *
 * IDEMPOTENCY (exactly-once):
 *   • submission key = sha256(machine-identity | serialNumber | inspectionTime |
 *     overallResult | measurementCount). The router stamps `inspectionTime` at
 *     receive-time when the machine omitted it, so the key is stable across a
 *     WAL replay of the same received payload.
 *   • a machine-side retry of the SAME submission while it is queued dedupes
 *     in-memory (queuedKeys) — one WAL entry, one ACK.
 *   • before replaying, the backfill consults (a) the applied-key ledger and
 *     (b) an injected DB existence check (machineId + serialNumber +
 *     inspectionTime on product_inspections) — so a submission that ALSO landed
 *     live (machine retried directly after DB recovery) is never double-inserted.
 *   • a live-path success marks its key applied, guarding the crash-replay case.
 *
 * BOUNDS (never grow unbounded, never drop silently): max entries + max age +
 * max bytes; on overflow the OLDEST entries are dropped — counted + warned.
 * PERMANENTLY invalid payloads (auth/validation TRPCErrors on replay) go to a
 * dead-letter JSONL file instead of poisoning the queue.
 *
 * HONESTY: with the flag OFF every entry point is a no-op → behaviour is exactly
 * as before (throw on DB failure). The process/dedup functions are INJECTED so
 * tests exercise buffer/backfill/idempotency without a live DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";

/**
 * The buffered payload is the raw `submitInspection` input (plus the resolved
 * credential when the machine authenticated via Authorization header). Kept
 * structurally typed here to avoid a value-level import cycle with the router.
 */
export interface BufferedSubmission {
  machineCode?: string;
  apiKey?: string;
  serialNumber: string;
  inspectionTime?: string;
  overallResult: string;
  measurements?: unknown[];
  [key: string]: unknown;
}

// ── flag ────────────────────────────────────────────────────────────────────

/**
 * Read at call time so config toggles / tests take effect. Dedicated flag with
 * fallback to the OT store-forward master switch (one "production profile"
 * switch covers both durability layers — doc 27 §11 hạng mục 2.3).
 */
export function inspectionStoreForwardEnabled(): boolean {
  const own = process.env.INSPECTION_STORE_FORWARD_ENABLED;
  if (own === "true" || own === "1") return true;
  if (own === "false" || own === "0") return false;
  return (
    process.env.OT_STORE_FORWARD_ENABLED === "true" ||
    process.env.OT_STORE_FORWARD_ENABLED === "1"
  );
}

// ── config (env-driven; honest defaults) ────────────────────────────────────

function walFile(): string {
  const p = process.env.INSPECTION_STORE_FORWARD_FILE?.trim();
  return path.resolve(p && p.length > 0 ? p : "./data/inspection-store-forward.jsonl");
}

function deadLetterFile(): string {
  return walFile().replace(/\.jsonl$/, "") + ".dead.jsonl";
}

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max buffered entries before the OLDEST are dropped (counted, never silent). */
function maxEntries(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX", 20000);
}

/** Max age (ms) an entry may live before it is dropped on the next sweep. 72h default. */
function maxAgeMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_AGE_MS", 72 * 60 * 60 * 1000);
}

/** Max approximate WAL bytes (payloads carry base64 images). 512 MiB default. */
function maxBytes(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_BYTES", 512 * 1024 * 1024);
}

/** How many entries to replay per backfill call (bounded work per attempt). */
function drainBatch(): number {
  return envInt("INSPECTION_STORE_FORWARD_DRAIN_BATCH", 50);
}

/** Warn loudly when the queue depth reaches this (repeated at most every 5 min). */
function alertDepth(): number {
  return envInt("INSPECTION_STORE_FORWARD_ALERT_DEPTH", 500);
}

// ── WAL state (in-memory queue is source of truth; file mirror for restart) ──

interface WalEntry {
  /** Idempotency key (see computeSubmissionKey). */
  key: string;
  enqueuedAt: number;
  /** Replay attempts so far (transient failures leave the entry queued). */
  attempts: number;
  /** Approximate serialized size (for the byte bound). */
  bytes: number;
  payload: BufferedSubmission;
}

const queue: WalEntry[] = [];
const queuedKeys = new Set<string>();
let queueBytes = 0;

/** Keys CONFIRMED persisted (live path or backfill). Bounded FIFO ledger. */
const appliedKeys = new Set<string>();
const appliedOrder: string[] = [];
const APPLIED_LEDGER_MAX = 100000;

// ── honest metrics ───────────────────────────────────────────────────────────

export interface InspectionStoreForwardMetrics {
  buffered: number;
  backfilled: number;
  deduped: number;
  deadLettered: number;
  droppedOverflow: number;
  droppedAge: number;
  droppedBytes: number;
  lastBackfillAt: string | null;
  lastBufferedAt: string | null;
}

const metrics: InspectionStoreForwardMetrics = {
  buffered: 0,
  backfilled: 0,
  deduped: 0,
  deadLettered: 0,
  droppedOverflow: 0,
  droppedAge: 0,
  droppedBytes: 0,
  lastBackfillAt: null,
  lastBufferedAt: null,
};

// ── injected pipeline (router wires the real submit path; tests mock it) ─────

/** Re-run the FULL submit pipeline for a buffered payload. Throws on failure. */
export type ProcessFn = (payload: BufferedSubmission) => Promise<{ inspectionId: number }>;
/** Return true when this submission ALREADY has a persisted inspection row. */
export type DedupFn = (payload: BufferedSubmission) => Promise<boolean>;

let processFn: ProcessFn = async () => {
  throw new Error("[InspectionSF] process fn not wired (call setProcessFn)");
};
let dedupFn: DedupFn = async () => false;

export function setProcessFn(fn: ProcessFn): void {
  processFn = fn;
}
export function setDedupFn(fn: DedupFn): void {
  dedupFn = fn;
}

// ── idempotency key ──────────────────────────────────────────────────────────

/**
 * submission id = machine identity + serial + timestamp hash (doc 27 W2-C).
 * The raw apiKey never appears in the key — only a sha256 fingerprint prefix.
 * overallResult + measurement count are folded in as a collision guard for
 * clients that omit inspectionTime on two different boards of the same serial.
 */
export function computeSubmissionKey(payload: BufferedSubmission): string {
  const machineIdentity = payload.machineCode?.trim()
    ? `mc:${payload.machineCode.trim()}`
    : payload.apiKey
      ? `ak:${createHash("sha256").update(payload.apiKey).digest("hex").slice(0, 16)}`
      : "anon";
  const material = [
    machineIdentity,
    payload.serialNumber ?? "",
    payload.inspectionTime ?? "",
    payload.overallResult ?? "",
    String(Array.isArray(payload.measurements) ? payload.measurements.length : 0),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

// ── error classification (transient → buffer; permanent → throw/dead-letter) ─

const PERMANENT_TRPC_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
]);

/**
 * A PERMANENT error means retrying the same payload can never succeed
 * (bad credentials / validation) — it must be surfaced to the caller (live
 * path) or dead-lettered (replay), never left in the queue. Everything else
 * (generic DB/network errors, TRPC INTERNAL_SERVER_ERROR) is TRANSIENT.
 */
export function isPermanentSubmitError(err: unknown): boolean {
  return err instanceof TRPCError && PERMANENT_TRPC_CODES.has(err.code);
}

// ── file mirror (append-only JSONL rewrite; memory is the truth) ─────────────

let fileDirty = false;

function entryToLine(e: WalEntry): string {
  return JSON.stringify({ key: e.key, enqueuedAt: e.enqueuedAt, attempts: e.attempts, payload: e.payload });
}

async function flushFile(): Promise<void> {
  if (!fileDirty) return;
  fileDirty = false;
  const file = walFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lines = queue.map(entryToLine).join("\n");
    await fs.writeFile(file, lines.length ? lines + "\n" : "", "utf8");
  } catch (err) {
    fileDirty = true; // retry on next flush; memory remains the source of truth
    console.warn("[InspectionSF] WAL file flush failed:", (err as Error)?.message || err);
  }
}

/** Restore the buffer from the WAL file mirror (call once on process start). */
export async function restoreInspectionWal(): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(walFile(), "utf8");
  } catch {
    return queue.length; // no file yet
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as { key?: string; enqueuedAt?: number; attempts?: number; payload?: BufferedSubmission };
      if (!parsed.payload) continue;
      const key = typeof parsed.key === "string" ? parsed.key : computeSubmissionKey(parsed.payload);
      if (queuedKeys.has(key) || appliedKeys.has(key)) continue;
      const bytes = t.length;
      queue.push({ key, enqueuedAt: parsed.enqueuedAt ?? Date.now(), attempts: parsed.attempts ?? 0, bytes, payload: parsed.payload });
      queuedKeys.add(key);
      queueBytes += bytes;
    } catch {
      /* skip corrupt line */
    }
  }
  if (queue.length > 0) {
    console.warn(`[InspectionSF] restored ${queue.length} buffered inspection submission(s) from WAL`);
  }
  return queue.length;
}

// ── applied ledger ────────────────────────────────────────────────────────────

export function markSubmissionApplied(key: string): void {
  if (appliedKeys.has(key)) return;
  appliedKeys.add(key);
  appliedOrder.push(key);
  if (appliedOrder.length > APPLIED_LEDGER_MAX) {
    const evict = appliedOrder.splice(0, appliedOrder.length - APPLIED_LEDGER_MAX);
    for (const k of evict) appliedKeys.delete(k);
  }
}

export function isSubmissionQueuedOrApplied(key: string): boolean {
  return queuedKeys.has(key) || appliedKeys.has(key);
}

// ── eviction (bounded, counted, warned — never silent) ───────────────────────

function dropFront(reason: "age" | "overflow" | "bytes"): void {
  const e = queue.shift();
  if (!e) return;
  queuedKeys.delete(e.key);
  queueBytes -= e.bytes;
  fileDirty = true;
  if (reason === "age") metrics.droppedAge += 1;
  else if (reason === "overflow") metrics.droppedOverflow += 1;
  else metrics.droppedBytes += 1;
}

function evictAged(): void {
  const cutoff = Date.now() - maxAgeMs();
  let dropped = 0;
  while (queue.length > 0 && queue[0].enqueuedAt < cutoff) {
    dropFront("age");
    dropped += 1;
  }
  if (dropped > 0) {
    console.warn(`[InspectionSF] dropped ${dropped} submission(s) past max age (total aged-drop=${metrics.droppedAge})`);
  }
}

function evictBounds(): void {
  let dropped = 0;
  while (queue.length > maxEntries()) {
    dropFront("overflow");
    dropped += 1;
  }
  let droppedBytes = 0;
  while (queue.length > 1 && queueBytes > maxBytes()) {
    dropFront("bytes");
    droppedBytes += 1;
  }
  if (dropped > 0 || droppedBytes > 0) {
    console.warn(
      `[InspectionSF] BUFFER OVERFLOW — dropped ${dropped + droppedBytes} oldest submission(s) ` +
        `(cap=${maxEntries()} entries / ${maxBytes()} bytes; total overflow-drop=${metrics.droppedOverflow + metrics.droppedBytes})`,
    );
  }
}

let lastDepthAlertAt = 0;

function maybeAlertDepth(): void {
  if (queue.length < alertDepth()) return;
  const now = Date.now();
  if (now - lastDepthAlertAt < 5 * 60 * 1000) return;
  lastDepthAlertAt = now;
  console.error(
    `[InspectionSF] ALERT — inspection WAL depth ${queue.length} ≥ ${alertDepth()} ` +
      `(bytes≈${queueBytes}). DB has been unreachable for a while; investigate before the buffer bounds evict data.`,
  );
}

// ── enqueue ───────────────────────────────────────────────────────────────────

/**
 * Buffer a submission that could not be persisted. Idempotent: a payload whose
 * key is already queued (machine-side retry while DB is down) or already applied
 * returns `duplicate: true` without a second entry. No-op when the flag is off.
 */
export async function bufferSubmission(
  payload: BufferedSubmission,
): Promise<{ buffered: boolean; duplicate: boolean; key: string }> {
  const key = computeSubmissionKey(payload);
  if (!inspectionStoreForwardEnabled()) return { buffered: false, duplicate: false, key };
  evictAged();
  if (queuedKeys.has(key) || appliedKeys.has(key)) {
    return { buffered: false, duplicate: true, key };
  }
  const line = JSON.stringify({ key, enqueuedAt: Date.now(), attempts: 0, payload });
  const entry: WalEntry = { key, enqueuedAt: Date.now(), attempts: 0, bytes: line.length, payload };
  queue.push(entry);
  queuedKeys.add(key);
  queueBytes += entry.bytes;
  metrics.buffered += 1;
  metrics.lastBufferedAt = new Date().toISOString();
  fileDirty = true;
  evictBounds();
  await flushFile();
  const stillQueued = queuedKeys.has(key);
  console.warn(
    `[InspectionSF] buffered inspection submission (serial=${payload.serialNumber}, key=${key.slice(0, 12)}…); ` +
      `queue=${queue.length} bytes≈${queueBytes}${stillQueued ? "" : " (immediately evicted by bounds!)"}`,
  );
  maybeAlertDepth();
  return { buffered: stillQueued, duplicate: false, key };
}

// ── dead-letter ───────────────────────────────────────────────────────────────

async function deadLetter(entry: WalEntry, err: unknown): Promise<void> {
  metrics.deadLettered += 1;
  const line = JSON.stringify({
    key: entry.key,
    deadAt: new Date().toISOString(),
    attempts: entry.attempts,
    error: err instanceof Error ? `${(err as TRPCError).code ?? err.name}: ${err.message}` : String(err),
    payload: entry.payload,
  });
  try {
    await fs.mkdir(path.dirname(deadLetterFile()), { recursive: true });
    await fs.appendFile(deadLetterFile(), line + "\n", "utf8");
  } catch (e) {
    console.error("[InspectionSF] dead-letter append failed:", (e as Error)?.message || e);
  }
  console.error(
    `[InspectionSF] DEAD-LETTERED submission ${entry.key.slice(0, 12)}… (serial=${entry.payload.serialNumber}): ` +
      `${err instanceof Error ? err.message : err} → ${deadLetterFile()}`,
  );
}

// ── backfill (replay oldest-first through the real pipeline, idempotent) ─────

let draining = false;

export async function backfillInspections(): Promise<{
  enabled: boolean;
  drained: number;
  deduped: number;
  deadLettered: number;
  remaining: number;
}> {
  if (!inspectionStoreForwardEnabled()) {
    return { enabled: false, drained: 0, deduped: 0, deadLettered: 0, remaining: queue.length };
  }
  if (draining) {
    return { enabled: true, drained: 0, deduped: 0, deadLettered: 0, remaining: queue.length };
  }
  draining = true;
  evictAged();
  let drained = 0;
  let deduped = 0;
  let deadLettered = 0;
  try {
    let budget = drainBatch();
    while (queue.length > 0 && budget > 0) {
      const entry = queue[0];

      // (a) ledger dedupe — live path already persisted it (or a prior replay did).
      if (appliedKeys.has(entry.key)) {
        removeHead(entry);
        deduped += 1;
        continue;
      }

      // (b) DB existence dedupe — the machine retried directly after recovery,
      // or a crash happened between insert-confirm and ledger update.
      let exists = false;
      try {
        exists = await dedupFn(entry.payload);
      } catch {
        // dedup check needs the DB — if it fails, the DB is still down. Stop.
        break;
      }
      if (exists) {
        markSubmissionApplied(entry.key);
        removeHead(entry);
        deduped += 1;
        continue;
      }

      try {
        await processFn(entry.payload);
      } catch (err) {
        if (isPermanentSubmitError(err)) {
          await deadLetter(entry, err);
          removeHead(entry);
          deadLettered += 1;
          budget -= 1;
          continue;
        }
        // transient → DB still down. Leave queued (bump attempts) and stop.
        entry.attempts += 1;
        fileDirty = true;
        console.warn(
          `[InspectionSF] backfill still failing (attempt ${entry.attempts}, key=${entry.key.slice(0, 12)}…): ` +
            `${(err as Error)?.message || err} — leaving buffered`,
        );
        break;
      }

      markSubmissionApplied(entry.key);
      removeHead(entry);
      drained += 1;
      budget -= 1;
    }
  } finally {
    draining = false;
  }

  if (drained > 0) {
    metrics.backfilled += drained;
    metrics.lastBackfillAt = new Date().toISOString();
  }
  if (deduped > 0) metrics.deduped += deduped;
  if (drained > 0 || deduped > 0 || deadLettered > 0) {
    await flushFile();
    console.log(
      `[InspectionSF] backfilled ${drained} submission(s) (${deduped} deduped, ${deadLettered} dead-lettered); queue=${queue.length}`,
    );
  } else {
    await flushFile(); // persist attempt counters
  }
  return { enabled: true, drained, deduped, deadLettered, remaining: queue.length };
}

function removeHead(expected: WalEntry): void {
  if (queue[0] !== expected) return;
  queue.shift();
  queuedKeys.delete(expected.key);
  queueBytes -= expected.bytes;
  fileDirty = true;
}

// ── background worker (interval + exponential backoff while the DB is down) ──

let workerTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;

function baseIntervalMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_INTERVAL_MS", 15000);
}
function maxIntervalMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_INTERVAL_MS", 5 * 60 * 1000);
}

async function workerTick(): Promise<void> {
  workerTimer = null;
  try {
    const r = await backfillInspections();
    // Backoff only while there IS work that cannot drain (DB still down).
    consecutiveFailures = r.remaining > 0 && r.drained === 0 && r.deduped === 0 && r.deadLettered === 0
      ? consecutiveFailures + 1
      : 0;
  } catch (err) {
    consecutiveFailures += 1;
    console.warn("[InspectionSF] backfill worker tick failed:", (err as Error)?.message || err);
  }
  scheduleNext();
}

function scheduleNext(): void {
  if (workerTimer) return;
  const delay = Math.min(baseIntervalMs() * Math.pow(2, Math.min(consecutiveFailures, 6)), maxIntervalMs());
  workerTimer = setTimeout(() => void workerTick(), delay);
  workerTimer.unref?.();
}

/** Start the periodic backfill worker (idempotent; no-op when the flag is off). */
export function startInspectionBackfillWorker(): void {
  if (!inspectionStoreForwardEnabled() || workerTimer) return;
  scheduleNext();
  console.log(
    `[InspectionSF] backfill worker started (interval=${baseIntervalMs()}ms, WAL=${walFile()}, ` +
      `bounds=${maxEntries()} entries/${maxBytes()} bytes/${maxAgeMs()}ms)`,
  );
}

export function stopInspectionBackfillWorker(): void {
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
}

/**
 * One-call startup init (wired from server bootstrap): dynamically binds the
 * REAL submit pipeline + dedup check from the router (dynamic import → no
 * module-load cycle), restores the WAL from disk, starts the worker.
 * Safe no-op when the flag is off.
 */
export async function initInspectionStoreForward(): Promise<void> {
  if (!inspectionStoreForwardEnabled()) return;
  const router = await import("../../routers/machineApiRouters");
  setProcessFn((payload) => router.processInspectionSubmission(payload as never));
  setDedupFn((payload) => router.inspectionAlreadyPersisted(payload as never));
  await restoreInspectionWal();
  startInspectionBackfillWorker();
}

// ── status ────────────────────────────────────────────────────────────────────

export interface InspectionStoreForwardStatus extends InspectionStoreForwardMetrics {
  enabled: boolean;
  bufferedCount: number;
  bufferedBytes: number;
  maxEntries: number;
  maxAgeMs: number;
  maxBytes: number;
  walFile: string;
  deadLetterFile: string;
}

export function getInspectionStoreForwardStatus(): InspectionStoreForwardStatus {
  return {
    enabled: inspectionStoreForwardEnabled(),
    bufferedCount: queue.length,
    bufferedBytes: queueBytes,
    maxEntries: maxEntries(),
    maxAgeMs: maxAgeMs(),
    maxBytes: maxBytes(),
    walFile: walFile(),
    deadLetterFile: deadLetterFile(),
    ...metrics,
  };
}

export function bufferedInspectionCount(): number {
  return queue.length;
}

// ── test / maintenance helpers ────────────────────────────────────────────────

export function _resetInspectionStoreForward(): void {
  stopInspectionBackfillWorker();
  queue.length = 0;
  queuedKeys.clear();
  queueBytes = 0;
  appliedKeys.clear();
  appliedOrder.length = 0;
  metrics.buffered = 0;
  metrics.backfilled = 0;
  metrics.deduped = 0;
  metrics.deadLettered = 0;
  metrics.droppedOverflow = 0;
  metrics.droppedAge = 0;
  metrics.droppedBytes = 0;
  metrics.lastBackfillAt = null;
  metrics.lastBufferedAt = null;
  fileDirty = false;
  draining = false;
  consecutiveFailures = 0;
  lastDepthAlertAt = 0;
  processFn = async () => {
    throw new Error("[InspectionSF] process fn not wired (call setProcessFn)");
  };
  dedupFn = async () => false;
}
