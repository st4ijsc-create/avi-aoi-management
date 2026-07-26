/**
 * AI LLM Audit (doc69 G2-5a, Wave 1 W1-4a) — privacy-safe audit trail for HIGH-RISK
 * AI-influenced decisions (rca / report / vision — see `aiGateway.ts`'s `HIGH_RISK_TASKS` and
 * the wiring inside `planInference`).
 *
 * WHY: G2-1..G2-4 gave the gateway compact TELEMETRY (`ai_gateway_metrics`: tokensIn/out,
 * tier, model, outcome, userId) but no durable "who asked what, what did the model answer,
 * for which quality decision" trail. This module is that trail.
 *
 * PRIVACY: this module NEVER stores raw prompt/response text — only sha256 HASHES + char
 * counts + a compact safety-flags summary (see `aiSafety.ts`'s `SafetyFlagsSummary`). The
 * CALLER (`aiGateway.planInference`) is responsible for passing already-REDACTED text (its
 * own `safeText` / `sanitizeOutput()` output) — this module hashes exactly what it is given
 * and never re-derives, logs, or persists the input itself. No secret enters a hash preimage
 * held anywhere beyond the brief lifetime of the `recordLlmAudit()` call stack.
 *
 * PATTERN: mirrors `aiGateway.ts`'s own metrics buffer (`enqueue`/`buffer`/`flush()`) — an
 * in-memory buffer + an unref'd timer, so `recordLlmAudit()` is a cheap SYNCHRONOUS call on
 * the hot path (hash + push, no await, no DB round-trip) and the actual DB write is batched
 * off it via `flushLlmAudit()`. This also means an audit call can NEVER make `planInference`
 * slower or fail because of a DB hiccup — the DB is only touched later, off the request path.
 * Low volume (only rca/report/vision), so a small buffer + explicit `flushLlmAudit()` (also
 * exported for tests/manual flush, exactly like `aiGateway.flush()`) is plenty.
 *
 * FAIL-SAFE (mirrors the G2-4 `aiGatewayQuota.ts` pattern): hashing errors are caught inside
 * `recordLlmAudit` (never throws — the entry is simply dropped); DB errors inside
 * `flushLlmAudit` are caught + the whole batch is dropped (never thrown) — including the
 * "table not migrated yet" case (`ai_llm_audit` from migration 0299 is additive/unapplied
 * until an operator with the `aoi` role runs it — until then this module silently no-ops).
 * An audit failure must NEVER affect the AI answer.
 *
 * SHUTDOWN (review fix, doc69 G2-5a Wave 1 W1-4b): the timer above is unref'd, so up to
 * `AI_LLM_AUDIT_FLUSH_MS` (~5s) of buffered rows are lost if the process exits before the
 * next tick. `ensureLlmAuditShutdownFlush()` registers a `beforeExit` hook (lazily, on the
 * first `recordLlmAudit` call — same trigger point as `ensureFlushTimer`) that drains the
 * buffer one more time. Mirrors the SAME idiom already used by `sensorIngestService.ts`
 * (`ensureSensorShutdownFlush`), `telemetryBus.ts` (`ensureShutdownFlush`) and
 * `robot/robotIngest.ts` (`ensureRobotShutdownFlush`) for their own buffered inserts:
 * `beforeExit` ONLY — deliberately NOT a `process.on("SIGTERM"/"SIGINT")` listener here,
 * since a signal listener overrides Node's default terminate behaviour and could hang the
 * process on Ctrl-C/kill (see telemetryBus.ts's doc comment). Per that same comment's
 * guidance ("operators wanting a guaranteed SIGTERM flush should call
 * flushTelemetryBuffer() from their existing shutdown hook"), `server/_core/index.ts`'s
 * `gracefulShutdown()` ALSO calls `flushLlmAudit()` directly (best-effort, fire-and-forget,
 * alongside its many other `stopXyz()` calls) — that is the path that actually matters in
 * production, since it explicitly `process.exit()`s and would otherwise never emit
 * `beforeExit` at all. Idempotent + fail-safe: registered at most once; `flushLlmAudit()`
 * already never throws, so a shutdown-triggered flush error can never crash the process.
 *
 * The ENABLED/DISABLED flag (`AI_LLM_AUDIT_ENABLED`) and the "which tasks count as
 * high-risk" decision are both the CALLER's responsibility (`aiGateway.ts`) — same division
 * of responsibility as `aiGatewayQuota.checkQuota`. This module always does the work when
 * called; not gating itself keeps it trivially unit-testable in isolation.
 */
import { createHash } from "node:crypto";
import type { SafetyFlagsSummary } from "./aiSafety";

export interface LlmAuditEntry {
  userId?: number | null;
  task: string;
  tier: number;
  model: string;
  outcome: string;
  /** Already-REDACTED prompt text (e.g. `GatewayPlan.safeText`). Hashed, never stored raw. */
  promptText: string;
  /**
   * Already-REDACTED response text (e.g. the return value of `GatewayPlan.sanitizeOutput`).
   * Hashed, never stored raw. Omit/empty for calls that never reached a model (e.g. a safety
   * hard-block) or whose caller did not thread a response back to `record()`.
   */
  responseText?: string | null;
  latencyMs?: number;
  /** Compact G2-2 safety summary (injection risk + redaction counts) — no raw text. */
  safetyFlags?: SafetyFlagsSummary | null;
  correlationId?: string | null;
}

interface AuditRow {
  userId: number | null;
  task: string;
  tier: number;
  model: string;
  outcome: string;
  promptSha256: string;
  responseSha256: string | null;
  promptChars: number;
  responseChars: number;
  latencyMs: number;
  safetyFlagsJson: SafetyFlagsSummary | null;
  correlationId: string | null;
  createdAt: Date;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ─── In-memory buffer (batched, explicit/timer flush — mirrors aiGateway.ts's metrics
// buffer) ─────────────────────────────────────────────────────────────────────────────────
const buffer: AuditRow[] = [];
const BUFFER_MAX = 200; // low volume (rca/report/vision only) — generous cap
let flushTimer: ReturnType<typeof setInterval> | null = null;
const FLUSH_INTERVAL_MS = envInt("AI_LLM_AUDIT_FLUSH_MS", 5_000);

function ensureFlushTimer(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushLlmAudit();
  }, FLUSH_INTERVAL_MS);
  // Don't keep the process alive just for audit flushing.
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

/**
 * Test/ops helper (review fix, doc69 G2-5a Wave 1 W1-4 flake fix): clear the flush interval
 * armed by `ensureFlushTimer`. Production never calls this (the timer is meant to live for the
 * process's lifetime, same as `aiGateway.ts`'s own metrics timer) — it exists so tests that
 * `vi.resetModules()` between cases can stop THIS module instance's real timer before moving
 * on, instead of leaving an unref'd-but-still-firing `setInterval` pointed at a stale closure
 * (stale `buffer`/mocked `getDb`) alive in the shared worker process. Without this, a timer
 * armed by one test (or one test FILE, since `pool: threads` workers run multiple files
 * sequentially and real timers are process-wide, not reset by `vi.resetModules()`) can fire
 * during a LATER, unrelated test and call the shared mock unexpectedly — a cross-test/cross-file
 * flake, not a production concern (`.unref()` already guarantees it can never hang process exit).
 * Idempotent + safe to call even if no timer was ever armed.
 */
export function stopLlmAuditFlushTimer(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}

// ─── Crash-safe shutdown flush (review fix, doc69 G2-5a Wave 1 W1-4b) ──────────────────────
// See the module doc comment's "SHUTDOWN" paragraph for the full rationale/idiom reference.
//
// The "wired" flag lives on `process` itself (via a well-known Symbol.for key), NOT as a
// plain module-local variable: `recordLlmAudit` — unlike the sibling flag-gated services
// (sensor/robot/telemetry batching, all opt-in/OFF by default) — runs on EVERY high-risk
// (rca/report/vision) call, unconditionally. A module-local flag would re-arm on every
// `vi.resetModules()` in tests (a new module instance ⇒ a fresh `false`), piling up one
// stray `beforeExit` listener on the ONE real shared `process` object per test file/module
// reload and tripping Node's MaxListenersExceededWarning across the wider test suite. Keying
// off `process` instead means at most ONE listener is ever registered per OS process — exactly
// once in production (modules load once) and, in tests, reset explicitly between cases (see
// aiLlmAudit.test.ts's `afterEach`) so each test can still exercise the wiring deterministically.
const SHUTDOWN_FLUSH_MARKER = Symbol.for("st4i.aiLlmAudit.beforeExitFlushWired");

function ensureLlmAuditShutdownFlush(): void {
  try {
    const proc = process as unknown as Record<symbol, boolean>;
    if (proc[SHUTDOWN_FLUSH_MARKER]) return;
    proc[SHUTDOWN_FLUSH_MARKER] = true;
    process.on("beforeExit", () => {
      void flushLlmAudit();
    });
  } catch {
    // no process (unlikely) → best-effort only
  }
}

/**
 * Hash + enqueue one audit row. SYNCHRONOUS and cheap (no I/O) — safe to call unconditionally
 * from the hot path (`aiGateway.planInference`'s `record()`/blocked-throw sites). Fail-safe:
 * any error (e.g. a pathological input) is caught + logged, never thrown; the entry is simply
 * dropped rather than risk affecting the caller.
 */
export function recordLlmAudit(entry: LlmAuditEntry): void {
  try {
    const promptText = entry.promptText ?? "";
    const responseText = entry.responseText ?? "";
    const row: AuditRow = {
      userId: entry.userId ?? null,
      task: entry.task,
      tier: entry.tier,
      model: entry.model,
      outcome: entry.outcome,
      promptSha256: sha256(promptText),
      responseSha256: responseText.length > 0 ? sha256(responseText) : null,
      promptChars: promptText.length,
      responseChars: responseText.length,
      latencyMs: Math.max(0, Math.trunc(entry.latencyMs ?? 0)),
      safetyFlagsJson: entry.safetyFlags ?? null,
      correlationId: entry.correlationId ?? null,
      createdAt: new Date(),
    };
    buffer.push(row);
    if (buffer.length > BUFFER_MAX) {
      const dropped = buffer.length - BUFFER_MAX;
      buffer.splice(0, dropped);
      // Minor review fix — operator visibility: this only happens if flushes have been
      // stalling for a while (DB down + high-risk traffic keeps flowing); the rows are
      // oldest-first dropped, same trim strategy as before, just now logged.
      console.warn(
        `[aiLlmAudit] buffer overflow — dropped ${dropped} oldest audit row(s) (BUFFER_MAX=${BUFFER_MAX}). Flushes may be failing/stalled; check DB connectivity.`,
      );
    }
    ensureFlushTimer();
    ensureLlmAuditShutdownFlush();
  } catch (err) {
    console.warn("[aiLlmAudit] recordLlmAudit failed (dropped, fail-safe):", (err as Error)?.message);
  }
}

/**
 * Drain the buffer to `ai_llm_audit`. Fail-safe: on ANY error (DB down, table not migrated
 * yet — migration 0299 is additive/unapplied by default, ...) the batch is DROPPED (audit is
 * best-effort telemetry, never a blocking dependency) and the error is logged, never thrown.
 * No-op (does not touch the DB at all) when the buffer is empty.
 */
export async function flushLlmAudit(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return; // no DB configured (e.g. tests/offline) → drop silently, fail-safe
    const { aiLlmAudit } = await import("../../../drizzle/schema");
    await db.insert(aiLlmAudit).values(batch);
  } catch (err) {
    console.warn("[aiLlmAudit] flushLlmAudit failed (dropped batch, fail-safe):", (err as Error)?.message);
  }
}

/** Test/ops helper: current buffered-but-unflushed row count. */
export function pendingAuditCount(): number {
  return buffer.length;
}
