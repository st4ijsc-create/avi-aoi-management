/**
 * doc 48 R4 — cluster-wide WORKER LEADER ELECTION (fixes the documented
 * "SINGLE-WORKER ASSUMPTION / no leader election" gap in server/worker.ts).
 *
 * The scheduler-only worker runs ~30 singleton cron-like jobs (reports, backups,
 * retention, integrity scan, AI crons, ERP-outbox drain, …). Running TWO worker
 * instances (for HA / rolling deploys) currently double-fires every job:
 * duplicate reports, double retention passes, races. This adds opt-in leader
 * election so you can run N worker replicas and only ONE (the leader) runs the
 * schedulers; a standby takes over automatically when the leader dies.
 *
 * MECHANISM: a SESSION-level Postgres advisory lock (pg_try_advisory_lock) held
 * on a dedicated reserved connection. Exactly one session across the whole
 * cluster can hold a given key. When the leader's process/connection dies,
 * Postgres releases the lock and a standby acquires it on its next retry.
 *
 * SPLIT-BRAIN GUARD: a heartbeat re-verifies (via pg_locks) that THIS session
 * still holds the lock. If the reserved connection silently reconnected to a
 * fresh session (which does NOT carry the lock), ownership check fails →
 * `onLost` fires → the worker fail-stops (exit) and rejoins as a standby on
 * restart. Fail-stop is chosen over "keep running" precisely to avoid two
 * leaders firing schedulers at once.
 *
 * DEFAULT OFF (WORKER_LEADER_ELECTION_ENABLED !== "true") → byte-for-byte the
 * prior single-worker behaviour: schedulers start immediately, no lock, no
 * dedicated connection. Turn it on only when running >1 worker replica.
 */

// Distinct from AUDIT_CHAIN_LOCK (918_273_645) / RUN_EVENT_LOCK_NS (771_004_221)
// / GENEALOGY_CHAIN_LOCK (615_243_870). Single-arg bigint advisory-lock key.
const LEADER_LOCK_KEY = 480_100_927;

type AnySql = {
  reserve: () => Promise<AnyReserved>;
  end: (opts?: { timeout?: number }) => Promise<void>;
};
type AnyReserved = ((strings: TemplateStringsArray, ...args: unknown[]) => Promise<any[]>) & {
  release: () => void;
};

let _sql: AnySql | null = null;
let _reserved: AnyReserved | null = null;
let _isLeader = false;
let _heartbeat: ReturnType<typeof setInterval> | null = null;

/** Opt-in flag. OFF preserves the historical single-worker behaviour exactly. */
export function leaderElectionEnabled(): boolean {
  return process.env.WORKER_LEADER_ELECTION_ENABLED === "true";
}

/** True only on the instance currently holding cluster leadership. */
export function isWorkerLeader(): boolean {
  return _isLeader;
}

/**
 * doc 54 P2.3 — CLUSTER-SINGLETON gate. One place to answer "should THIS instance run a
 * once-per-cluster job?":
 *   • leader-election OFF (default — single-node pilot / Full-Sim) → ALWAYS true → run as
 *     today, byte-for-byte (NO behaviour change);
 *   • leader-election ON → true ONLY on the instance currently holding leadership, so N
 *     replicas don't double-fire the singleton.
 * Callers gate their scheduler/broadcaster start on this. Kept trivial + synchronous so it
 * is safe to call from any hot path.
 */
export function shouldRunClusterSingleton(): boolean {
  return !leaderElectionEnabled() || isWorkerLeader();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new Error("[WorkerLeader] aborted"));
      },
      { once: true },
    );
  });
}

/**
 * Block until THIS instance becomes the cluster leader. Retries forever (a
 * standby just keeps polling), so callers should race it against a shutdown
 * signal if they need to abort. Once resolved, a heartbeat guards the lock and
 * calls `onLost` if leadership is ever lost.
 */
export async function acquireWorkerLeadership(
  opts: { retryMs?: number; heartbeatMs?: number; onLost?: () => void; signal?: AbortSignal } = {},
): Promise<void> {
  const retryMs = opts.retryMs ?? 5_000;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("[WorkerLeader] DATABASE_URL required for leader election");

  const { default: postgres } = await import("postgres");
  _sql = postgres(url, {
    max: 1,
    idle_timeout: 0, // keep the lock-holding session alive indefinitely
    connect_timeout: 30,
    connection: { application_name: "synapse-worker-leader" },
    onnotice: () => {},
  }) as unknown as AnySql;

  for (;;) {
    if (opts.signal?.aborted) throw new Error("[WorkerLeader] aborted before acquiring leadership");
    let reserved: AnyReserved | null = null;
    try {
      reserved = await _sql.reserve();
      const rows = await reserved`SELECT pg_try_advisory_lock(${LEADER_LOCK_KEY}) AS locked`;
      if (rows[0]?.locked === true) {
        _reserved = reserved;
        _isLeader = true;
        console.log(
          "[WorkerLeader] ✓ ACQUIRED leadership (session advisory lock) — this instance runs the schedulers",
        );
        startHeartbeat(opts.heartbeatMs, opts.onLost);
        return;
      }
      // Another instance holds it → drop our reservation and stand by.
      reserved.release();
    } catch (e) {
      console.error("[WorkerLeader] acquire attempt failed:", (e as Error)?.message || e);
      try {
        reserved?.release();
      } catch {
        /* ignore */
      }
    }
    console.log(`[WorkerLeader] another instance is leader — standing by (retry in ${retryMs}ms)`);
    await sleep(retryMs, opts.signal);
  }
}

function startHeartbeat(heartbeatMs: number | undefined, onLost?: () => void): void {
  stopHeartbeat();
  const everyMs = heartbeatMs ?? Number(process.env.WORKER_LEADER_HEARTBEAT_MS ?? 15_000);
  _heartbeat = setInterval(async () => {
    if (!_reserved) return;
    try {
      // Re-verify OUR session still holds the advisory lock. For a single-arg
      // bigint key, pg_locks stores classid=high32 / objid=low32 / objsubid=1;
      // recombine and match against our own backend pid. Zero rows ⇒ the reserved
      // connection reconnected to a fresh (lock-less) session or another instance
      // took over ⇒ leadership lost.
      const rows = await _reserved`
        SELECT 1
          FROM pg_locks
         WHERE locktype = 'advisory'
           AND pid = pg_backend_pid()
           AND ((classid::bigint << 32) | objid::bigint) = ${LEADER_LOCK_KEY}`;
      if (rows.length === 0) throw new Error("advisory lock no longer held by this session");
    } catch (e) {
      console.error("[WorkerLeader] ✗ LEADERSHIP LOST:", (e as Error)?.message || e);
      _isLeader = false;
      stopHeartbeat();
      onLost?.();
    }
  }, everyMs);
  // Don't let the heartbeat alone keep the process alive.
  (_heartbeat as { unref?: () => void }).unref?.();
}

function stopHeartbeat(): void {
  if (_heartbeat) {
    clearInterval(_heartbeat);
    _heartbeat = null;
  }
}

/** Release the lock + close the dedicated connection (graceful shutdown). */
export async function releaseWorkerLeadership(): Promise<void> {
  stopHeartbeat();
  try {
    if (_reserved && _isLeader) {
      await _reserved`SELECT pg_advisory_unlock(${LEADER_LOCK_KEY})`;
    }
  } catch {
    /* best-effort */
  }
  try {
    _reserved?.release();
  } catch {
    /* ignore */
  }
  try {
    await _sql?.end({ timeout: 2 });
  } catch {
    /* ignore */
  }
  _reserved = null;
  _sql = null;
  _isLeader = false;
}
