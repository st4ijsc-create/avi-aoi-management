/**
 * Automation Orchestration R0-4 (doc 16 §4 Khối 0 / §15) — DURABLE OUTBOUND
 * publishing: the ERP integration gateway's transactional outbox + worker.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * WHY an outbox (and not the existing webhook bridge): webhookBridge fires-and-
 * forgets to subscriber-configured webhooks. Khối 0 needs GUARANTEED delivery of
 * integration events (production / quality / OEE / genealogy) to a downstream ERP
 * — survive restarts, retry with backoff, and stop hammering a dead endpoint.
 * So events are persisted to `integration_outbox` (R0-4) and a background worker
 * drains them with:
 *   • exponential backoff per row (attempts → nextAttemptAt),
 *   • a PER-ENDPOINT circuit-breaker (open after N consecutive failures; half-open
 *     after a cooldown; a single probe success closes it),
 *   • dead-letter: a row that exhausts MAX_ATTEMPTS moves to status='dead'.
 *
 * No BullMQ/opossum in the dependency tree, so this is an in-house DB-polled
 * worker + a tiny in-house breaker (ioredis IS present but adds no value for a
 * single-instance DB-backed outbox; not used here).
 *
 * SAFETY: outbound HTTP only; never a device-control path. Gated by
 * ERP_OUTBOX_ENABLED (default OFF) — the worker timer only starts when on.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { eq, and, lte, inArray, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../../db/connection";
import { integrationOutbox } from "../../../drizzle/schema";

// ── Tunables (env-overridable; sensible defaults) ────────────────────────────

/** Outbound event families this gateway publishes. */
export const OUTBOX_EVENT_TYPES = [
  "production-event",
  "quality-result",
  "oee-metric",
  "genealogy-record",
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Max delivery attempts before a row is dead-lettered. */
export const MAX_ATTEMPTS = intEnv("ERP_OUTBOX_MAX_ATTEMPTS", 6);
/** Base backoff (ms) — delay = BASE * 2^(attempts-1), capped. */
const BACKOFF_BASE_MS = intEnv("ERP_OUTBOX_BACKOFF_BASE_MS", 5_000);
const BACKOFF_CAP_MS = intEnv("ERP_OUTBOX_BACKOFF_CAP_MS", 10 * 60_000); // 10 min
/** Per-poll batch size. */
const BATCH_SIZE = intEnv("ERP_OUTBOX_BATCH_SIZE", 25);
/** Worker poll interval. */
const POLL_INTERVAL_MS = intEnv("ERP_OUTBOX_POLL_MS", 5_000);
/** Per-delivery HTTP timeout. */
const HTTP_TIMEOUT_MS = intEnv("ERP_OUTBOX_HTTP_TIMEOUT_MS", 10_000);
/** Circuit-breaker: open after this many consecutive endpoint failures. */
export const BREAKER_FAILURE_THRESHOLD = intEnv("ERP_OUTBOX_BREAKER_THRESHOLD", 5);
/** Circuit-breaker: cooldown before a half-open probe is allowed. */
export const BREAKER_COOLDOWN_MS = intEnv("ERP_OUTBOX_BREAKER_COOLDOWN_MS", 30_000);

/** True when the durable outbox worker is enabled (default OFF for safety). */
export function outboxEnabled(): boolean {
  return process.env.ERP_OUTBOX_ENABLED === "true" || process.env.ERP_OUTBOX_ENABLED === "1";
}

function backoffDelayMs(attempts: number): number {
  const d = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(d, BACKOFF_CAP_MS);
}

// ── Producer helper ──────────────────────────────────────────────────────────

/** Reserved payload key carrying the requested wire format (K0+-b). */
const FORMAT_META_KEY = "__format";

export interface EnqueueOutboxInput {
  eventType: OutboxEventType;
  payload: Record<string, unknown>;
  targetEndpoint: string;
  /** Optional dedup key — enqueue is idempotent on it (no double-publish). */
  idempotencyKey?: string;
  corporateCode?: string;
  /**
   * Requested outbound wire format (K0+-b). "json" (default) delivers the JSON
   * envelope; "b2mml" delivers a B2MML ProductionPerformance XML — ONLY when
   * ERP_B2MML_ENABLED is on (else it falls back to JSON). Stored inline in the
   * payload under a reserved key so no schema change / new column is needed.
   */
  format?: "json" | "b2mml";
}

export interface EnqueueResult {
  ok: boolean;
  /** The outbox row id (existing row id when deduped). */
  id?: number;
  /** True when an existing row was returned for a duplicate idempotencyKey. */
  duplicate?: boolean;
  reason?: string;
}

/**
 * Enqueue an outbound integration event. Persists a `pending` row that the worker
 * later drains. Idempotent on idempotencyKey: a duplicate key returns the prior
 * row id (no second insert). Fail-safe — never throws to the producer.
 *
 * EXAMPLE CALL PATH (documented; producers are NOT refactored in R0):
 *   import { enqueueOutbox } from "server/services/integration/erpOutbox";
 *   await enqueueOutbox({
 *     eventType: "quality-result",
 *     payload: { serialNumber, overallResult, inspectionId },
 *     targetEndpoint: process.env.ERP_QUALITY_ENDPOINT!,
 *     idempotencyKey: `qr-${inspectionId}`,
 *   });
 */
export async function enqueueOutbox(input: EnqueueOutboxInput): Promise<EnqueueResult> {
  try {
    if (!OUTBOX_EVENT_TYPES.includes(input.eventType)) {
      return { ok: false, reason: `unknown eventType "${input.eventType}"` };
    }
    if (!input.targetEndpoint || typeof input.targetEndpoint !== "string") {
      return { ok: false, reason: "targetEndpoint required" };
    }
    const db = await getDb();
    if (!db) return { ok: false, reason: "db unavailable" };

    const idem = input.idempotencyKey?.trim() || null;

    // Idempotent enqueue: return the prior row when the key already exists.
    if (idem) {
      const existing = await db
        .select({ id: integrationOutbox.id })
        .from(integrationOutbox)
        .where(eq(integrationOutbox.idempotencyKey, idem))
        .limit(1);
      if (existing[0]) return { ok: true, id: existing[0].id, duplicate: true };
    }

    // Carry the requested format inline in the payload (reserved key) so the
    // worker can render B2MML at delivery time — no schema change required.
    const payloadWithMeta =
      input.format && input.format !== "json"
        ? { ...input.payload, [FORMAT_META_KEY]: input.format }
        : input.payload;

    const [row] = await db
      .insert(integrationOutbox)
      .values({
        eventType: input.eventType,
        payload: payloadWithMeta as never,
        targetEndpoint: input.targetEndpoint,
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        idempotencyKey: idem,
        corporateCode: input.corporateCode ?? null,
      })
      .returning({ id: integrationOutbox.id });

    return { ok: true, id: row?.id };
  } catch (err) {
    // A racing unique-violation on idempotencyKey → treat as duplicate (re-read).
    const message = (err as Error)?.message ?? String(err);
    if (/duplicate key|unique/i.test(message) && input.idempotencyKey) {
      try {
        const db = await getDb();
        if (db) {
          const existing = await db
            .select({ id: integrationOutbox.id })
            .from(integrationOutbox)
            .where(eq(integrationOutbox.idempotencyKey, input.idempotencyKey.trim()))
            .limit(1);
          if (existing[0]) return { ok: true, id: existing[0].id, duplicate: true };
        }
      } catch {
        /* fall through */
      }
    }
    console.error("[erpOutbox] enqueue failed:", message);
    return { ok: false, reason: message };
  }
}

// ── Per-endpoint circuit-breaker (in-house, in-process) ──────────────────────

type BreakerState = "closed" | "open" | "half-open";
interface Breaker {
  state: BreakerState;
  consecutiveFailures: number;
  openedAt: number; // epoch ms when it last opened
}
const breakers = new Map<string, Breaker>();

function getBreaker(endpoint: string): Breaker {
  let b = breakers.get(endpoint);
  if (!b) {
    b = { state: "closed", consecutiveFailures: 0, openedAt: 0 };
    breakers.set(endpoint, b);
  }
  return b;
}

/** May the worker attempt this endpoint now? Transitions open → half-open on cooldown. */
export function breakerAllows(endpoint: string, now = Date.now()): boolean {
  const b = getBreaker(endpoint);
  if (b.state === "open") {
    if (now - b.openedAt >= BREAKER_COOLDOWN_MS) {
      b.state = "half-open"; // allow a single probe
      return true;
    }
    return false;
  }
  return true; // closed or half-open → allow (half-open = one probe at a time, see worker)
}

export function recordBreakerSuccess(endpoint: string): void {
  const b = getBreaker(endpoint);
  b.consecutiveFailures = 0;
  b.state = "closed";
  b.openedAt = 0;
}

export function recordBreakerFailure(endpoint: string, now = Date.now()): void {
  const b = getBreaker(endpoint);
  b.consecutiveFailures += 1;
  // A failed half-open probe re-opens immediately; closed opens at threshold.
  if (b.state === "half-open" || b.consecutiveFailures >= BREAKER_FAILURE_THRESHOLD) {
    b.state = "open";
    b.openedAt = now;
  }
}

/** Snapshot of breaker states (for diagnostics / tests). */
export function breakerSnapshot(): Record<string, BreakerState> {
  const out: Record<string, BreakerState> = {};
  for (const [k, v] of breakers.entries()) out[k] = v.state;
  return out;
}

/** Test helper: reset all in-process breakers. */
export function _resetBreakers(): void {
  breakers.clear();
}

// ── Delivery ─────────────────────────────────────────────────────────────────

/**
 * Render the delivery body for a row. Default is the JSON envelope. When the row
 * requested B2MML (reserved payload key) AND ERP_B2MML_ENABLED is on, render a
 * B2MML ProductionPerformance XML instead. Fail-safe: any codec error falls back
 * to JSON so delivery never breaks on formatting.
 */
async function renderBody(row: { id: number; eventType: string; payload: unknown }): Promise<{ body: string; contentType: string }> {
  const timestamp = new Date().toISOString();
  const payloadObj = (row.payload && typeof row.payload === "object" ? { ...(row.payload as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const requestedFormat = payloadObj[FORMAT_META_KEY];
  delete payloadObj[FORMAT_META_KEY]; // never leak the meta key downstream

  const jsonBody = () =>
    JSON.stringify({ event: row.eventType, timestamp, outboxId: row.id, data: payloadObj });

  if (requestedFormat === "b2mml") {
    const b2mmlOn = process.env.ERP_B2MML_ENABLED === "true" || process.env.ERP_B2MML_ENABLED === "1";
    if (b2mmlOn) {
      try {
        const { encodePerformanceB2MML } = await import("./b2mmlCodec");
        const xml = encodePerformanceB2MML({ eventType: row.eventType, timestamp, data: payloadObj });
        return { body: xml, contentType: "application/xml" };
      } catch (err) {
        console.error("[erpOutbox] B2MML render failed, falling back to JSON:", (err as Error)?.message ?? err);
      }
    }
  }
  return { body: jsonBody(), contentType: "application/json" };
}

/** POST one outbox row's payload to its endpoint. Resolves with the HTTP outcome. */
async function deliver(row: { id: number; eventType: string; payload: unknown; targetEndpoint: string }): Promise<{
  ok: boolean;
  status?: number;
  error?: string;
}> {
  const { body, contentType } = await renderBody(row);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(row.targetEndpoint, {
      method: "POST",
      headers: { "Content-Type": contentType, "X-Outbox-Id": String(row.id), "X-Event-Type": row.eventType },
      body,
      signal: controller.signal,
    });
    if (resp.ok) return { ok: true, status: resp.status };
    return { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export interface DrainResult {
  picked: number;
  sent: number;
  failed: number;
  dead: number;
  skippedByBreaker: number;
}

/**
 * Drain one batch of due rows. Exported so tests can drive it deterministically
 * (no timer). Honours the per-endpoint breaker; updates attempts / nextAttemptAt;
 * dead-letters rows that exhaust MAX_ATTEMPTS. Fail-safe — never throws.
 */
export async function drainOnce(now = new Date()): Promise<DrainResult> {
  const result: DrainResult = { picked: 0, sent: 0, failed: 0, dead: 0, skippedByBreaker: 0 };
  try {
    const db = await getDb();
    if (!db) return result;

    const due = await db
      .select()
      .from(integrationOutbox)
      .where(and(inArray(integrationOutbox.status, ["pending", "failed"]), lte(integrationOutbox.nextAttemptAt, now)))
      .orderBy(integrationOutbox.nextAttemptAt)
      .limit(BATCH_SIZE);

    result.picked = due.length;
    // Track endpoints we already probed this batch while half-open (one probe only).
    const probedThisBatch = new Set<string>();

    for (const row of due) {
      const endpoint = row.targetEndpoint;
      const b = getBreaker(endpoint);
      const allowed = breakerAllows(endpoint, now.getTime());
      // Half-open: permit exactly one probe per endpoint per batch.
      if (!allowed || (b.state === "half-open" && probedThisBatch.has(endpoint))) {
        result.skippedByBreaker += 1;
        continue;
      }
      if (b.state === "half-open") probedThisBatch.add(endpoint);

      const outcome = await deliver(row);
      if (outcome.ok) {
        recordBreakerSuccess(endpoint);
        await db
          .update(integrationOutbox)
          .set({ status: "sent", sentAt: new Date(), attempts: row.attempts + 1, lastError: null })
          .where(eq(integrationOutbox.id, row.id));
        result.sent += 1;
        continue;
      }

      recordBreakerFailure(endpoint, now.getTime());
      const attempts = row.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await db
          .update(integrationOutbox)
          .set({ status: "dead", attempts, lastError: (outcome.error ?? "delivery failed").slice(0, 1000) })
          .where(eq(integrationOutbox.id, row.id));
        result.dead += 1;
      } else {
        const next = new Date(now.getTime() + backoffDelayMs(attempts));
        await db
          .update(integrationOutbox)
          .set({ status: "failed", attempts, nextAttemptAt: next, lastError: (outcome.error ?? "delivery failed").slice(0, 1000) })
          .where(eq(integrationOutbox.id, row.id));
        result.failed += 1;
      }
    }
  } catch (err) {
    console.error("[erpOutbox] drain failed:", (err as Error)?.message ?? err);
  }
  return result;
}

/**
 * Requeue dead-lettered rows (status='dead') back to 'pending' for another
 * delivery round (attempts reset, nextAttemptAt=now). Used by the admin
 * retry-dead-letter action. Returns the number of rows requeued. Fail-safe.
 * When `ids` is given, only those rows are requeued; otherwise ALL dead rows.
 */
export async function retryDeadLetters(ids?: number[]): Promise<{ requeued: number }> {
  try {
    const db = await getDb();
    if (!db) return { requeued: 0 };
    const setValues = { status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null };
    const rows =
      ids && ids.length > 0
        ? await db
            .update(integrationOutbox)
            .set(setValues)
            .where(and(eq(integrationOutbox.status, "dead"), inArray(integrationOutbox.id, ids)))
            .returning({ id: integrationOutbox.id })
        : await db
            .update(integrationOutbox)
            .set(setValues)
            .where(eq(integrationOutbox.status, "dead"))
            .returning({ id: integrationOutbox.id });
    return { requeued: rows.length };
  } catch (err) {
    console.error("[erpOutbox] retryDeadLetters failed:", (err as Error)?.message ?? err);
    return { requeued: 0 };
  }
}

/** List recent dead-letter rows for the admin surface. Fail-safe. */
export async function listDeadLetters(limit = 50): Promise<Array<Record<string, unknown>>> {
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select({
        id: integrationOutbox.id,
        eventType: integrationOutbox.eventType,
        targetEndpoint: integrationOutbox.targetEndpoint,
        attempts: integrationOutbox.attempts,
        lastError: integrationOutbox.lastError,
        idempotencyKey: integrationOutbox.idempotencyKey,
        createdAt: integrationOutbox.createdAt,
      })
      .from(integrationOutbox)
      .where(eq(integrationOutbox.status, "dead"))
      .orderBy(integrationOutbox.id)
      .limit(Math.min(Math.max(limit, 1), 500));
    return rows as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

/** Lightweight outbox counts for a health/admin surface. */
export async function outboxStats(): Promise<Record<string, number>> {
  try {
    const db = await getDb();
    if (!db) return {};
    const rows = await db
      .select({ status: integrationOutbox.status, count: sql<number>`count(*)` })
      .from(integrationOutbox)
      .groupBy(integrationOutbox.status);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = Number(r.count);
    return out;
  } catch {
    return {};
  }
}

// ── Background worker (timer) ─────────────────────────────────────────────────

let timer: ReturnType<typeof setInterval> | null = null;
let draining = false;

/**
 * Start the outbox worker timer. NO-OP unless ERP_OUTBOX_ENABLED is on. Guarded
 * against double-start; the loop never overlaps itself.
 */
export function startOutboxWorker(): void {
  if (timer) return;
  if (!outboxEnabled()) {
    console.log("[erpOutbox] worker disabled (set ERP_OUTBOX_ENABLED=true to enable)");
    return;
  }
  console.log(`[erpOutbox] worker started — polling every ${POLL_INTERVAL_MS}ms (maxAttempts=${MAX_ATTEMPTS}, breakerThreshold=${BREAKER_FAILURE_THRESHOLD})`);
  timer = setInterval(async () => {
    if (draining) return;
    draining = true;
    try {
      await drainOnce();
    } finally {
      draining = false;
    }
  }, POLL_INTERVAL_MS);
  // Don't keep the event loop alive solely for this timer.
  (timer as { unref?: () => void }).unref?.();
}

export function stopOutboxWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
