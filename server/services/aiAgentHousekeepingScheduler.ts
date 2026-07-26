/**
 * AI Agent Housekeeping Scheduler — doc 69 Giai đoạn 4 / Wave 3, Task D4.
 *
 * Runs the two ALREADY-EXISTING "lazy housekeeping" cleanups on an interval instead
 * of leaving them purely reactive (previously only invoked opportunistically wherever
 * some unrelated caller happened to touch a session/action row):
 *   - aiAgentOrchestrator.expireStaleSessions() — marks stale non-terminal agent
 *     sessions ('awaiting_confirm' past expiresAt) as 'aborted'.
 *   - aiCopilotActions.expireStaleActions()   — marks stale 'proposed' pending
 *     actions past expiresAt as 'expired'.
 *
 * Both cleanups only touch rows that are ALREADY stale by their own stored
 * `expiresAt` — this scheduler adds NO new expiry rule and changes NO live session's
 * behavior; it just makes the existing rule run promptly instead of waiting for an
 * unrelated caller to trigger it. That is why, unlike most opt-in schedulers in this
 * codebase, AI_AGENT_HOUSEKEEPING_ENABLED defaults **true** — expiring already-stale
 * rows is safe + desirable with no meaningful downside. Still fully flag-controllable
 * (a safe no-op when explicitly disabled) and best-effort: either cleanup throwing is
 * caught + logged INDEPENDENTLY so a failure in one never blocks/skips the other.
 *
 * Registered in server/_core/backgroundJobs.ts next to the other AI schedulers
 * (initSelfLearningScheduler, etc.) — that file is only invoked from contexts where
 * cron-like schedulers should run (ROLE unset/"worker"; ROLE="api" skips it), so this
 * scheduler is SERVER_ROLE-aware by placement, exactly like its neighbours.
 *
 * Mechanism note: aiSelfLearningScheduler.ts (the sibling this mirrors for naming —
 * initXScheduler()/stopXScheduler()) uses node-cron for a once-daily job. This cleanup
 * instead runs frequently on a short interval (mirrors the setInterval-based
 * schedulers, e.g. edgeStaleScheduler.ts) — a cron expression is the wrong tool for
 * "every few minutes, forever".
 *
 * Env flags:
 *   AI_AGENT_HOUSEKEEPING_ENABLED       (default "true")
 *   AI_AGENT_HOUSEKEEPING_INTERVAL_MS   (default 300000 = 5min; floor 30000 = 30s)
 *
 * Tunables are read AT CALL TIME (not cached at module load) — mirrors the documented
 * rationale in aiAgentOrchestrator.ts's own "read at call time so tests/config toggles
 * take effect" comment — so tests can flip env vars between cases without re-importing.
 */
import { expireStaleSessions } from "./aiAgentOrchestrator";
import { expireStaleActions } from "./aiCopilotActions";

function housekeepingEnabled(): boolean {
  return String(process.env.AI_AGENT_HOUSEKEEPING_ENABLED ?? "true").toLowerCase() !== "false";
}

function intervalMs(): number {
  const raw = Number(process.env.AI_AGENT_HOUSEKEEPING_INTERVAL_MS);
  return Number.isFinite(raw) && raw >= 30_000 ? raw : 5 * 60_000;
}

let timer: NodeJS.Timeout | null = null;
let lastRunAt: Date | null = null;
let lastRunStats: { expiredSessions: number; expiredActions: number } | null = null;

/**
 * Runs both cleanups once. Exported so the scheduler tick + tests share one code
 * path. Best-effort: each cleanup is wrapped in its OWN try/catch so a throw in one
 * never skips or aborts the other; a failure logs and contributes 0 to that half's
 * count instead of propagating.
 */
export async function runAgentHousekeepingOnce(): Promise<{ expiredSessions: number; expiredActions: number }> {
  let expiredSessions = 0;
  let expiredActions = 0;

  try {
    expiredSessions = await expireStaleSessions();
  } catch (err) {
    console.error("[aiAgentHousekeepingScheduler] expireStaleSessions failed:", (err as any)?.message ?? err);
  }

  try {
    expiredActions = await expireStaleActions();
  } catch (err) {
    console.error("[aiAgentHousekeepingScheduler] expireStaleActions failed:", (err as any)?.message ?? err);
  }

  lastRunAt = new Date();
  lastRunStats = { expiredSessions, expiredActions };
  if (expiredSessions > 0 || expiredActions > 0) {
    console.log(
      `[aiAgentHousekeepingScheduler] expired ${expiredSessions} session(s), ${expiredActions} action(s)`,
    );
  }
  return lastRunStats;
}

/** Arms the interval. Safe no-op when disabled or already running (idempotent). */
export function initAgentHousekeepingScheduler(): void {
  if (!housekeepingEnabled()) {
    console.log("[aiAgentHousekeepingScheduler] disabled (AI_AGENT_HOUSEKEEPING_ENABLED=false)");
    return;
  }
  if (timer) return;

  const ms = intervalMs();
  timer = setInterval(() => {
    void runAgentHousekeepingOnce();
  }, ms);
  // Don't keep the event loop alive solely for this timer.
  if (typeof timer.unref === "function") timer.unref();

  console.log(`[aiAgentHousekeepingScheduler] scheduled every ${ms}ms`);
}

/** Idempotent no-op when the scheduler was never started. */
export function stopAgentHousekeepingScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getAgentHousekeepingStatus() {
  return { enabled: housekeepingEnabled(), intervalMs: intervalMs(), running: !!timer, lastRunAt, lastRunStats };
}
