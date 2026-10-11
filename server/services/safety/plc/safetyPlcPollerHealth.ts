/**
 * doc 81 Đợt 8 Group N — background safety-PLC poller: DURABLE poll state + monitoring health + watchdog.
 *
 * fix scan 3 (ruling R-8-c, replaces the fix-scan-2 heartbeat in system_settings — an admin-editable registry could forge
 * "healthy" or pre-claim an alarm; and health only listed what the leader chose to report):
 *   • ONE durable row per config in safety_plc_poll_state (migration 0368): the CONFIRMED edge state (link + flags,
 *     advanced only after the transition events were recorded), the last poll ATTEMPT and the last DECIDED read (epoch ms),
 *     the poll interval and the writing instance. Written only by the poller (and the watchdog's alarm CAS).
 *   • HEALTH (evaluatePollerHealth, pure) = ENABLED configs × durable rows, so every instance computes the SAME answer:
 *       flags off ⇒ "off"; no enabled config ⇒ "no_config"; rows unreadable ⇒ "unknown" (never ok);
 *       an enabled config with NO row, or no attempt within configStaleAfterMs(interval) ⇒ that config STALE ⇒ "stale".
 *     Nothing is healthy by default: "ok" needs a fresh row for EVERY enabled config.
 *   • WATCHDOG on every instance (independent of the poll chain): ONE "plc_monitor_stale" safety event per config per
 *     stale EPISODE (compare-and-set on the row's staleAlarmEpisode — cluster-wide); "unknown" is logged as an error at
 *     every check (no DB ⇒ no event can be written either). Boot grace for configs that never had an attempt.
 *   • final wave N-R1 — a config whose observed transitions cannot be RECORDED (event inserts failing / timing out while the
 *     small state upsert still succeeds) is STALE too: the row carries "unrecordedSince" (when the oldest not-yet-recorded
 *     transition — or an events-lost marker — started waiting) and "unrecordedCount"; waiting longer than
 *     configStaleAfterMs(interval) ⇒ stale + one alarm per episode. Undecidable (row unreadable) ⇒ "unknown", as before.
 *   • final wave N-R5 — every timestamp in the row is on the DATABASE clock: the pg store converts the poller's local times
 *     to AGES at write time and stores db-now − age; health compares with db-now read in the SAME query (listAt). So every
 *     instance computes the same staleness whatever its own clock skew. Residual: the "off" state still follows each
 *     instance's own environment flags (a per-process setting by design — the flag gates what THIS process runs).
 * Residual (documented): if EVERY instance's event loop hangs, nothing in-process can alarm — external monitoring should
 * read safety.sourceHealth (plcPoller.state / lastPollAt).
 * L-7: reads / writes its own rows and records advisory events; never touches a PLC.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { DbUnavailableError } from "../../../_core/dbErrors";
import { record, type RecordSafetyEventInput, type RecordResult } from "../safetyAuditService";

/** The background poller's flag — default OFF (the one definition; safetyPlcPoller re-exports it). */
export function safetyPlcPollerEnabled(): boolean {
  return process.env.SAFETY_PLC_POLLER_ENABLED === "true" || process.env.SAFETY_PLC_POLLER_ENABLED === "1";
}

export const SAFETY_PLC_WATCHDOG_PERIOD_MS = 10_000;
export const SAFETY_PLC_WATCHDOG_BOOT_GRACE_MS = 60_000;
const BACKOFF_CAP_MS = 15_000; // = SAFETY_PLC_POLL_BACKOFF_CAP_MS (leaf module: no import cycle)
const DEFAULT_INTERVAL_MS = 1000;

/** A config's monitoring is stale when no attempt happened within 4 × max(interval, backoff cap) (≥ 60 s). */
export function configStaleAfterMs(intervalMs: number | null | undefined): number {
  const i = typeof intervalMs === "number" && Number.isFinite(intervalMs) ? intervalMs : DEFAULT_INTERVAL_MS;
  return 4 * Math.max(i, BACKOFF_CAP_MS);
}

export type PollLink = "unknown" | "online" | "offline";
export interface PollStateRow {
  configId: number;
  link: PollLink;
  /** the confirmed flags; Đợt 9 U2 adds the e-stop latch bit when the config maps one */
  flags: Partial<Record<"estop" | "zoneOccupied" | "resetRequired" | "muting" | "estopLatch", boolean>>;
  intervalMs: number | null;
  lastAttemptAt: number | null;
  lastOkAt: number | null;
  /** fix scan 4 — the config trust digest this edge was written for (another identity ⇒ never applied). */
  identityDigest?: string | null;
  staleAlarmEpisode?: string | null;
  /** final wave N-R1 — since when transitions wait to be recorded (null = nothing waiting) and how many (queue + lost). */
  unrecordedSince?: number | null;
  unrecordedCount?: number | null;
  /**
   * doc 81 Đợt 9 U1/U2 (migration 0371) — how the config is read: "subscription" (OPC-UA, queued), "poll_fallback" (OPC-UA
   * subscription refused ⇒ polling), "poll" (Modbus, no latch), "poll_latch" (Modbus + e-stop latch), "sim". null = unknown.
   */
  readMode?: string | null;
}

/**
 * Durable poll state. load/save/list THROW on failure (callers decide); claimStaleAlarm never throws.
 * `save` takes the poller's LOCAL epoch-ms times; a store may re-base them (the pg store stores them on the DB clock).
 */
export interface PollStateStore {
  load(configId: number): Promise<PollStateRow | null>;
  save(row: Omit<PollStateRow, "staleAlarmEpisode">): Promise<void>;
  list(): Promise<PollStateRow[]>;
  /** final wave N-R5 — the rows AND the clock they are on (the DB's now, same query). Absent ⇒ list() + the local clock. */
  listAt?(): Promise<{ rows: PollStateRow[]; nowMs: number }>;
  /**
   * true ⇔ THIS caller now holds the LEASE of (configId, episode) cluster-wide (final wave N-R2: a claim is a lease, not
   * "done": an episode is done only after confirmStaleAlarm; a lease older than SAFETY_PLC_STALE_ALARM_LEASE_MS may be
   * re-claimed). Never throws (cannot claim ⇒ false; the next check retries).
   */
  claimStaleAlarm(configId: number, episode: string): Promise<boolean>;
}

/**
 * final wave N-R2 — the watchdog's alarm lease: claim → record → CONFIRM (episode done) or RELEASE (record failed ⇒ the
 * next check, here or on another instance, retries). A confirm / release that fails leaves the lease to expire
 * (SAFETY_PLC_STALE_ALARM_LEASE_MS) ⇒ retried: a duplicate alarm is possible, a lost one is not.
 */
export interface StaleAlarmLease {
  confirmStaleAlarm(configId: number, episode: string): Promise<void>;
  releaseStaleAlarm(configId: number, episode: string): Promise<void>;
}
export const SAFETY_PLC_STALE_ALARM_LEASE_MS = 30_000;
/** Bound of the watchdog's alarm insert (a hung insert ⇒ treated as failed ⇒ released ⇒ retried). */
export const SAFETY_PLC_WATCHDOG_RECORD_TIMEOUT_MS = 5000;

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
function rowOf(r: Record<string, unknown>): PollStateRow {
  const link = r.link === "online" || r.link === "offline" ? r.link : "unknown";
  const flags = r.flags && typeof r.flags === "object" ? (r.flags as PollStateRow["flags"]) : {};
  return {
    configId: Number(r.configId),
    link,
    flags,
    intervalMs: num(r.intervalMs),
    lastAttemptAt: num(r.lastAttemptAt),
    lastOkAt: num(r.lastOkAt),
    identityDigest: (r.identityDigest as string | null) ?? null,
    staleAlarmEpisode: (r.staleAlarmEpisode as string | null) ?? null,
    unrecordedSince: num(r.unrecordedSince),
    unrecordedCount: num(r.unrecordedCount),
    readMode: typeof r.readMode === "string" ? r.readMode : null,
  };
}

/** doc 81 Đợt 9 U1/U2 — the read modes the poller reports (= the 0371 CHECK). */
export const READ_MODES: ReadonlySet<string> = new Set(["subscription", "poll_fallback", "poll", "poll_latch", "sim"]);

/** final wave N-R5 — the DB clock in epoch ms (SQL fragment). */
const DB_NOW_MS = sql`(extract(epoch from clock_timestamp()) * 1000)::bigint`;

/** The production store: table safety_plc_poll_state (migration 0368). */
export function pgPollStateStore(instance = `${process.pid}`): PollStateStore & StaleAlarmLease {
  const db = async () => {
    const d = await getDb();
    if (!d) throw new DbUnavailableError(); // final wave: typed (rawErrorCensus "DB không sẵn sàng" family)
    return d;
  };
  const listAt = async (): Promise<{ rows: PollStateRow[]; nowMs: number }> => {
    // ONE query: the DB clock + every row (LEFT JOIN keeps the clock when there is no row at all).
    const rows = (await (await db()).execute(sql`
      SELECT n.t AS "dbNow", s."configId", s.link, s.flags, s."intervalMs", s."lastAttemptAt", s."lastOkAt", s."staleAlarmEpisode", s."unrecordedSince", s."unrecordedCount", s."readMode"
        FROM (SELECT ${DB_NOW_MS} AS t) n LEFT JOIN safety_plc_poll_state s ON true`)) as unknown as Array<Record<string, unknown>>;
    const nowMs = num(rows[0]?.dbNow);
    if (nowMs == null) throw new DbUnavailableError("db clock unreadable"); // caller ⇒ "unknown" (never ok)
    return { rows: rows.filter((r) => r.configId != null).map(rowOf), nowMs };
  };
  return {
    async load(configId) {
      const rows = (await (await db()).execute(sql`
        SELECT "configId", link, flags, "intervalMs", "lastAttemptAt", "lastOkAt", "identityDigest", "staleAlarmEpisode"
          FROM safety_plc_poll_state WHERE "configId" = ${configId}`)) as unknown as Array<Record<string, unknown>>;
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async save(r) {
      // final wave N-R5 — local times → AGES now → stored as db-now − age (the DB clock; no instance clock skew in the row).
      const local = Date.now();
      const age = (t: number | null | undefined): number | null => (typeof t === "number" && Number.isFinite(t) ? Math.max(0, Math.round(local - t)) : null);
      const onDb = (a: number | null) => (a == null ? sql`NULL::bigint` : sql`(${DB_NOW_MS} - ${a}::bigint)`);
      const count = typeof r.unrecordedCount === "number" && Number.isFinite(r.unrecordedCount) ? Math.max(0, Math.min(2_000_000_000, Math.round(r.unrecordedCount))) : null;
      // doc 81 Đợt 9 U1/U2 — only the known modes (the column CHECK refuses anything else; unknown ⇒ NULL, never invented)
      const mode = typeof r.readMode === "string" && READ_MODES.has(r.readMode) ? r.readMode : null;
      await (await db()).execute(sql`
        INSERT INTO safety_plc_poll_state ("configId", link, flags, "intervalMs", "lastAttemptAt", "lastOkAt", "identityDigest", "unrecordedSince", "unrecordedCount", "readMode", "writerInstance", "updatedAt")
        VALUES (${r.configId}, ${r.link}, ${JSON.stringify(r.flags ?? {})}::jsonb, ${r.intervalMs}, ${onDb(age(r.lastAttemptAt))}, ${onDb(age(r.lastOkAt))}, ${r.identityDigest ?? null}, ${onDb(age(r.unrecordedSince))}, ${count}, ${mode}, ${instance.slice(0, 64)}, now())
        ON CONFLICT ("configId") DO UPDATE SET link = EXCLUDED.link, flags = EXCLUDED.flags, "intervalMs" = EXCLUDED."intervalMs",
          "lastAttemptAt" = EXCLUDED."lastAttemptAt", "lastOkAt" = EXCLUDED."lastOkAt", "identityDigest" = EXCLUDED."identityDigest",
          -- final wave NF-1/NF-2: a continuing wait keeps its FIRST stored value (no ±latency drift of the episode key,
          -- no effect of a local clock step); a cleared wait (NULL) clears it; a new wait after a clear starts fresh.
          "unrecordedSince" = CASE WHEN EXCLUDED."unrecordedSince" IS NULL THEN NULL
                                   ELSE COALESCE(safety_plc_poll_state."unrecordedSince", EXCLUDED."unrecordedSince") END,
          "unrecordedCount" = EXCLUDED."unrecordedCount", "readMode" = EXCLUDED."readMode", "writerInstance" = EXCLUDED."writerInstance", "updatedAt" = now()`);
    },
    async list() {
      return (await listAt()).rows;
    },
    listAt,
    async claimStaleAlarm(configId, episode) {
      // final wave N-R2 — a LEASE: refused when the episode is already DONE, or leased by someone within the lease time.
      try {
        const ep = episode.slice(0, 200);
        const rows = (await (await db()).execute(sql`
          INSERT INTO safety_plc_poll_state ("configId", "staleAlarmClaim", "staleAlarmClaimAt") VALUES (${configId}, ${ep}, now())
          ON CONFLICT ("configId") DO UPDATE SET "staleAlarmClaim" = EXCLUDED."staleAlarmClaim", "staleAlarmClaimAt" = now()
            WHERE safety_plc_poll_state."staleAlarmEpisode" IS DISTINCT FROM EXCLUDED."staleAlarmClaim"
              AND (safety_plc_poll_state."staleAlarmClaim" IS DISTINCT FROM EXCLUDED."staleAlarmClaim"
                   OR safety_plc_poll_state."staleAlarmClaimAt" IS NULL
                   OR safety_plc_poll_state."staleAlarmClaimAt" < now() - make_interval(secs => ${SAFETY_PLC_STALE_ALARM_LEASE_MS / 1000}))
          RETURNING "configId"`)) as unknown as unknown[];
        return rows.length > 0;
      } catch {
        return false; // cannot claim ⇒ the next check (or another instance) will
      }
    },
    async confirmStaleAlarm(configId, episode) {
      await (await db()).execute(sql`
        UPDATE safety_plc_poll_state SET "staleAlarmEpisode" = "staleAlarmClaim"
         WHERE "configId" = ${configId} AND "staleAlarmClaim" = ${episode.slice(0, 200)}`);
    },
    async releaseStaleAlarm(configId, episode) {
      await (await db()).execute(sql`
        UPDATE safety_plc_poll_state SET "staleAlarmClaim" = NULL, "staleAlarmClaimAt" = NULL
         WHERE "configId" = ${configId} AND "staleAlarmClaim" = ${episode.slice(0, 200)} AND "staleAlarmEpisode" IS DISTINCT FROM "staleAlarmClaim"`);
    },
  };
}

export type PollerHealthState = "off" | "no_config" | "ok" | "stale" | "unknown";
export interface EnabledConfigLite {
  id: number;
  code: string;
  factoryId: number | null;
}
export interface PollerHealth {
  state: PollerHealthState;
  /** The newest attempt of ANY config (what every instance reports as "the leader's last poll"). */
  lastPollAt: number | null;
  configs: Array<EnabledConfigLite & { link: PollLink; lastAttemptAt: number | null; lastOkAt: number | null; stale: boolean; unrecordedSince: number | null; readMode: string | null }>;
  staleScopes: Array<{ configId: number; episode: string; reason: string }>;
}

/** PURE — the monitoring state from ENABLED configs × durable rows. Undecidable is never "ok"; missing is stale. */
export function evaluatePollerHealth(enabled: EnabledConfigLite[], rows: PollStateRow[] | "error", now: number, o: { enabled: boolean }): PollerHealth {
  if (!o.enabled) return { state: "off", lastPollAt: null, configs: [], staleScopes: [] };
  if (rows === "error") return { state: "unknown", lastPollAt: null, configs: [], staleScopes: [] };
  if (enabled.length === 0) return { state: "no_config", lastPollAt: null, configs: [], staleScopes: [] };
  const byId = new Map(rows.map((r) => [r.configId, r]));
  const staleScopes: PollerHealth["staleScopes"] = [];
  let lastPollAt: number | null = null;
  const configs = enabled.map((c) => {
    const r = byId.get(c.id);
    const last = r?.lastAttemptAt ?? null;
    if (last != null) lastPollAt = lastPollAt == null ? last : Math.max(lastPollAt, last);
    const bound = configStaleAfterMs(r?.intervalMs);
    const notPolled = last == null || now - last > bound;
    // final wave N-R1 — polled, but transitions wait to be recorded beyond the bound ⇒ trips are seen and NOT recorded / notified.
    const unrec = r?.unrecordedSince ?? null;
    const stuck = unrec != null && now - unrec > bound;
    const stale = notPolled || stuck;
    const code = String(c.code).slice(0, 64);
    if (notPolled) {
      staleScopes.push({
        configId: c.id,
        episode: `cfg:${c.id}:${last ?? "never"}`,
        reason: last == null ? `config "${code}" has never been polled` : `config "${code}" not polled for ${Math.round((now - last) / 1000)} s`,
      });
    } else if (stuck) {
      staleScopes.push({
        configId: c.id,
        episode: `cfg:${c.id}:unrec:${unrec}`,
        reason: `config "${code}": ${r?.unrecordedCount ?? "?"} observed transition(s) NOT recorded for ${Math.round((now - unrec!) / 1000)} s (event inserts failing) — trips are seen but neither recorded nor notified`,
      });
    }
    return { ...c, link: r?.link ?? "unknown", lastAttemptAt: last, lastOkAt: r?.lastOkAt ?? null, stale, unrecordedSince: unrec, readMode: r?.readMode ?? null };
  });
  return { state: staleScopes.length ? "stale" : "ok", lastPollAt, configs, staleScopes };
}

export interface WatchdogDeps {
  store: PollStateStore & StaleAlarmLease;
  listConfigs: () => Promise<EnabledConfigLite[]>;
  record: (i: RecordSafetyEventInput) => Promise<RecordResult>;
  now: () => number;
  enabled: () => boolean;
  startedAt: number;
}

/**
 * One watchdog check: evaluate from durable rows, then per stale episode: LEASE → record ONE alarm → confirm (done), or
 * release when the record failed / timed out (final wave N-R2 — the alarm is never lost to a failed record). Never throws.
 */
export async function runPollerWatchdogOnce(d: WatchdogDeps): Promise<PollerHealth> {
  const localNow = d.now();
  let now = localNow;
  let rows: PollStateRow[] | "error";
  let cfgs: EnabledConfigLite[] = [];
  try {
    // final wave N-R5 — staleness on the DB clock when the store provides it (every instance: the same answer).
    const listed = d.store.listAt ? d.store.listAt() : d.store.list().then((r) => ({ rows: r, nowMs: localNow }));
    let snap: { rows: PollStateRow[]; nowMs: number };
    [cfgs, snap] = await Promise.all([d.listConfigs(), listed]);
    rows = snap.rows;
    now = snap.nowMs;
  } catch {
    rows = "error";
  }
  const h = evaluatePollerHealth(cfgs, rows, now, { enabled: d.enabled() });
  if (h.state === "unknown") {
    console.error("[SafetyPLC] MONITORING STATE UNKNOWN — the poll state cannot be read; treat safety-PLC monitoring as BLIND");
  }
  for (const s of h.staleScopes) {
    if (s.episode.endsWith(":never") && localNow - d.startedAt < SAFETY_PLC_WATCHDOG_BOOT_GRACE_MS) continue; // a local duration
    try {
      if (!(await d.store.claimStaleAlarm(s.configId, s.episode))) continue;
      const cfg = cfgs.find((c) => c.id === s.configId);
      console.error(`[SafetyPLC] MONITORING STALE (config ${s.configId}): ${s.reason} — safety-PLC monitoring is BLIND for it`);
      let t: NodeJS.Timeout | undefined;
      const recorded = await Promise.race([
        d.record({
        eventType: "plc_monitor_stale",
        detectedBy: "plc",
        handledBy: "advisory",
        outcome: "logged_only",
        isNearMiss: false,
        factoryId: cfg?.factoryId ?? null,
        humanPosition: { plcConfigId: s.configId, poller: true, watchdog: true },
        notes: `safety-PLC monitoring STALE — ${s.reason}. Background monitoring is BLIND for this PLC (the certified PLC still performs its rated stops in hardware; its e-stop / guard trips are not being observed or notified). [watchdog, READ-ONLY]`,
        }).then(
          // DONE only when the alarm row was durably written (ok). Audit off / any failure ⇒ released (security scan
          // "alarm-integrity": an episode is never marked handled without a durable alarm). With audit off the health is
          // "off" (no stale scopes) ⇒ no retry loop.
          (r) => r?.ok === true,
          () => false,
        ),
        new Promise<boolean>((res) => {
          t = setTimeout(() => res(false), SAFETY_PLC_WATCHDOG_RECORD_TIMEOUT_MS);
          t.unref?.();
        }),
      ]).finally(() => clearTimeout(t));
      if (recorded) {
        await d.store.confirmStaleAlarm(s.configId, s.episode).catch(() => undefined); // failure ⇒ lease expires ⇒ a duplicate at worst
      } else {
        console.error(`[SafetyPLC] the MONITORING STALE alarm of config ${s.configId} could not be recorded — released, retried at the next check`);
        await d.store.releaseStaleAlarm(s.configId, s.episode).catch(() => undefined); // failure ⇒ the lease expires ⇒ retried
      }
    } catch {
      /* claim never throws; anything else ⇒ the lease expires and the next check retries */
    }
  }
  return h;
}

let watchdogTimer: NodeJS.Timeout | null = null;
/** Start the watchdog on THIS instance (idempotent). */
export function startSafetyPlcWatchdog(enabled: () => boolean, deps: Partial<Pick<WatchdogDeps, "store" | "listConfigs">> = {}): void {
  if (watchdogTimer) return;
  const startedAt = Date.now();
  const store = deps.store ?? pgPollStateStore();
  const listConfigs =
    deps.listConfigs ??
    (async () => {
      const { listPlcConfigs } = await import("./safetyPlcAdapter");
      return (await listPlcConfigs({ onlyEnabled: true })).map((c) => ({ id: c.id, code: c.code, factoryId: c.factoryId ?? null }));
    });
  watchdogTimer = setInterval(() => {
    void runPollerWatchdogOnce({ store, listConfigs, record, now: Date.now, enabled, startedAt });
  }, SAFETY_PLC_WATCHDOG_PERIOD_MS);
  watchdogTimer.unref?.();
}
export function stopSafetyPlcWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}
