/**
 * doc 81 Đợt 8 task N fix 1 (review M4) — ONE instance polls the safety PLCs (cluster-wide).
 *
 * Several API instances would each record every transition (N rows) and each spend its own in-memory P-F4 / recipient
 * bypass budget (N× opt-out bypasses). The background poller therefore polls only while THIS process holds a SESSION-level
 * Postgres advisory lock on a dedicated connection (pattern of _core/workerLeader.ts; no migration). Re-verified at every
 * poller refresh through pg_locks (our backend pid + key): a reconnect to a fresh session, a lost connection or any error
 * ⇒ "not leader" ⇒ the poller drops all its states and polls nothing (fail closed: undecided leadership never polls twice).
 * The lock is released on stop; a crashed leader's lock is freed by Postgres and a standby takes over at its next refresh.
 * L-7: reads only lock state; never touches a PLC.
 */

/** Single-arg bigint advisory-lock key. Distinct from LEADER_LOCK_KEY 480_100_927 (workerLeader), AUDIT_CHAIN_LOCK
 *  918_273_645, RUN_EVENT_LOCK_NS 771_004_221, GENEALOGY_CHAIN_LOCK 615_243_870, COMMISSIONING_PIN_LOCK_NS 563_118_407. */
export const SAFETY_PLC_POLLER_LOCK_KEY = 480_100_941;

export interface PollerLeaderGate {
  /** Try to become (or stay) the leader. Never throws; false ⇔ not the leader now. */
  acquire(): Promise<boolean>;
  /** Do we still hold the lock on our own session? Never throws; any doubt ⇒ false. */
  held(): Promise<boolean>;
  /** Release the lock and close the dedicated connection (best effort). */
  release(): Promise<void>;
}

/** Every gate round-trip is bounded: a query on a terminated session can hang forever (measured on _test). */
export const SAFETY_PLC_LEADER_QUERY_TIMEOUT_MS = 3000;

function bounded<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error(`leader gate query exceeded ${ms} ms`)), ms);
      t.unref?.();
    }),
  ]).finally(() => clearTimeout(t));
}

type Reserved = ((strings: TemplateStringsArray, ...args: unknown[]) => Promise<Array<Record<string, unknown>>>) & { release: () => void };
type Client = { reserve: () => Promise<Reserved>; end: (o?: { timeout?: number }) => Promise<void> };

/** The production gate: a dedicated postgres.js client (max 1, never idles out) holding pg_try_advisory_lock(key). */
export function pgPollerLeaderGate(key: number = SAFETY_PLC_POLLER_LOCK_KEY, url: string | undefined = process.env.DATABASE_URL): PollerLeaderGate {
  let client: Client | null = null;
  let reserved: Reserved | null = null;

  /** Forget the session; on doubt (timeout / error) also discard the whole client (a hung socket is never reused). */
  const drop = async (discardClient = false) => {
    try {
      reserved?.release();
    } catch {
      /* ignore */
    }
    reserved = null;
    if (discardClient && client) {
      const c = client;
      client = null;
      void c.end({ timeout: 0 }).catch(() => undefined);
    }
  };

  const held = async (): Promise<boolean> => {
    if (!reserved) return false;
    try {
      const r = reserved;
      const rows = await bounded(
        r`
        SELECT 1 FROM pg_locks
         WHERE locktype = 'advisory' AND pid = pg_backend_pid() AND granted
           AND ((classid::bigint << 32) | objid::bigint) = ${key}`,
        SAFETY_PLC_LEADER_QUERY_TIMEOUT_MS,
      );
      if (rows.length > 0) return true;
    } catch {
      /* fall through */
    }
    await drop(true);
    return false;
  };

  return {
    async acquire() {
      if (reserved) return held();
      if (!url) return false;
      try {
        if (!client) {
          const { default: postgres } = await import("postgres");
          client = postgres(url, {
            max: 1,
            idle_timeout: 0,
            connect_timeout: 10,
            connection: { application_name: "synapse-safety-plc-poller-leader" },
            onnotice: () => {},
          }) as unknown as Client;
        }
        const r = await bounded(client.reserve(), SAFETY_PLC_LEADER_QUERY_TIMEOUT_MS);
        reserved = r;
        const rows = await bounded(r`SELECT pg_try_advisory_lock(${key}) AS locked`, SAFETY_PLC_LEADER_QUERY_TIMEOUT_MS);
        if (rows[0]?.locked === true) return true;
        await drop();
        return false;
      } catch {
        await drop(true);
        return false;
      }
    },
    held,
    async release() {
      try {
        if (reserved) await bounded(reserved`SELECT pg_advisory_unlock(${key})`, SAFETY_PLC_LEADER_QUERY_TIMEOUT_MS);
      } catch {
        /* best effort — closing the session frees it anyway */
      }
      await drop();
      try {
        if (client) await bounded(client.end({ timeout: 2 }), SAFETY_PLC_LEADER_QUERY_TIMEOUT_MS);
      } catch {
        /* ignore */
      }
      client = null;
    },
  };
}
