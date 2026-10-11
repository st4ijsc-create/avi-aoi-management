/**
 * doc 81 Đợt 8 task N fix scan 2 (ruling R-8-b) — LOSS OF MONITORING is a safety-relevant state: visible and fail-safe.
 *
 *   • The LEADER poller persists a heartbeat (system_settings key SAFETY_PLC_HEARTBEAT_KEY, JSON; no endpoints) at every
 *     refresh: per config the last poll ATTEMPT and the last DECIDED read, its link state and binding factory.
 *   • ANY instance (leader or standby) evaluates it (evaluatePollerHealth, pure):
 *       – poller flag off ⇒ "off";            – heartbeat unreadable ⇒ "unknown" (never "ok");
 *       – no heartbeat / older than SAFETY_PLC_HEARTBEAT_STALE_MS ⇒ "stale" (no instance is polling — the leader stopped,
 *         hangs, lost its DB session, or none could take the lock);
 *       – a config not attempted within configStaleAfterMs(interval) ⇒ that config "stale" (its chain stalled).
 *     The state is exposed in safety.sourceHealth (plcPoller).
 *   • A WATCHDOG on every instance (independent of the poll chain) raises ONE "plc_monitor_stale" safety event per stale
 *     EPISODE cluster-wide (claimAlarm = compare-and-set on system_settings key prefix SAFETY_PLC_STALE_ALARM_KEY_PREFIX);
 *     a recovered-then-stale-again scope is a new episode. Boot grace: "no heartbeat yet" alarms only after
 *     SAFETY_PLC_WATCHDOG_BOOT_GRACE_MS.
 * Residual (documented): if EVERY instance's event loop hangs, nothing in-process can alarm — external monitoring should
 * read safety.sourceHealth (plcPoller.state) / the heartbeat age.
 * L-7: reads / writes settings and records an advisory event; never touches a PLC.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
import { record, type RecordSafetyEventInput, type RecordResult } from "../safetyAuditService";

/** The background poller's flag — default OFF (the one definition; safetyPlcPoller re-exports it). */
export function safetyPlcPollerEnabled(): boolean {
  return process.env.SAFETY_PLC_POLLER_ENABLED === "true" || process.env.SAFETY_PLC_POLLER_ENABLED === "1";
}

export const SAFETY_PLC_HEARTBEAT_KEY = "safety.plcPoller.heartbeat";
export const SAFETY_PLC_STALE_ALARM_KEY_PREFIX = "safety.plcPoller.staleAlarm.";
/** 3 × the poller refresh (10 s). */
export const SAFETY_PLC_HEARTBEAT_STALE_MS = 30_000;
export const SAFETY_PLC_WATCHDOG_PERIOD_MS = 10_000;
export const SAFETY_PLC_WATCHDOG_BOOT_GRACE_MS = 60_000;
const BACKOFF_CAP_MS = 15_000; // = SAFETY_PLC_POLL_BACKOFF_CAP_MS (not imported: leaf module, no cycle)

/** A config's chain is stale when no attempt happened within 4 × max(interval, backoff cap). */
export function configStaleAfterMs(intervalMs: number): number {
  return 4 * Math.max(Number.isFinite(intervalMs) ? intervalMs : 0, BACKOFF_CAP_MS);
}

export interface PollerHeartbeatConfig {
  id: number;
  code: string;
  factoryId: number | null;
  intervalMs: number;
  /** when the leader started tracking this config */
  since: number;
  lastAttemptAt: number | null;
  lastOkAt: number | null;
  link: "unknown" | "online" | "offline";
}
export interface PollerHeartbeat {
  v: 1;
  at: number;
  instance: string;
  configs: PollerHeartbeatConfig[];
}

export interface PollerHealthStore {
  /** null = no heartbeat row; "error" = could not read (undecidable). */
  readHeartbeat(): Promise<PollerHeartbeat | null | "error">;
  writeHeartbeat(hb: PollerHeartbeat): Promise<void>;
  /** true ⇔ THIS caller is the first to claim (scope, episode) cluster-wide. */
  claimAlarm(scope: string, episode: string): Promise<boolean>;
}

export type PollerHealthState = "off" | "ok" | "stale" | "unknown";
export interface PollerHealth {
  state: PollerHealthState;
  heartbeatAt: number | null;
  leaderAlive: boolean;
  configs: Array<PollerHeartbeatConfig & { stale: boolean }>;
  staleScopes: Array<{ scope: string; episode: string; reason: string }>;
}

/** PURE — the monitoring state from a heartbeat. Undecidable is never "ok". */
export function evaluatePollerHealth(hb: PollerHeartbeat | null | "error", now: number, o: { enabled: boolean }): PollerHealth {
  if (!o.enabled) return { state: "off", heartbeatAt: null, leaderAlive: false, configs: [], staleScopes: [] };
  if (hb === "error") return { state: "unknown", heartbeatAt: null, leaderAlive: false, configs: [], staleScopes: [] };
  if (hb == null || typeof hb !== "object" || !Number.isFinite(hb.at)) {
    return { state: "stale", heartbeatAt: null, leaderAlive: false, configs: [], staleScopes: [{ scope: "global", episode: "never", reason: "no heartbeat — no instance has polled the safety PLCs" }] };
  }
  const leaderAlive = now - hb.at <= SAFETY_PLC_HEARTBEAT_STALE_MS;
  const staleScopes: PollerHealth["staleScopes"] = [];
  if (!leaderAlive) staleScopes.push({ scope: "global", episode: `hb:${hb.at}`, reason: `no poller heartbeat for ${Math.round((now - hb.at) / 1000)} s` });
  const configs = (Array.isArray(hb.configs) ? hb.configs : []).slice(0, 500).map((c) => {
    const last = c.lastAttemptAt ?? c.since;
    const stale = !leaderAlive || !Number.isFinite(last) || now - last > configStaleAfterMs(c.intervalMs);
    if (stale && leaderAlive) staleScopes.push({ scope: `config:${c.id}`, episode: `cfg:${c.id}:${last}`, reason: `config "${String(c.code).slice(0, 64)}" not polled for ${Math.round((now - last) / 1000)} s` });
    return { ...c, stale };
  });
  return { state: staleScopes.length ? "stale" : "ok", heartbeatAt: hb.at, leaderAlive, configs, staleScopes };
}

/** The production store (system_settings; text JSON). Every call is bounded by the DB driver; errors ⇒ "error" / false. */
export function pgPollerHealthStore(): PollerHealthStore {
  return {
    async readHeartbeat() {
      try {
        const d = await getDb();
        if (!d) return "error";
        const rows = (await d.execute(sql`SELECT "settingValue" AS v FROM system_settings WHERE "settingKey" = ${SAFETY_PLC_HEARTBEAT_KEY} LIMIT 1`)) as unknown as Array<{ v: string | null }>;
        const v = rows[0]?.v;
        if (v == null) return null;
        const parsed = JSON.parse(v) as PollerHeartbeat;
        return parsed && parsed.v === 1 ? parsed : "error";
      } catch {
        return "error";
      }
    },
    async writeHeartbeat(hb) {
      const d = await getDb();
      if (!d) throw new Error("db unavailable");
      await d.execute(sql`
        INSERT INTO system_settings ("settingKey", "settingValue", "category", "description")
        VALUES (${SAFETY_PLC_HEARTBEAT_KEY}, ${JSON.stringify(hb)}, 'safety_plc_poller', 'doc 81 Dot 8 N fix scan 2: background safety-PLC poller heartbeat (written by the leader)')
        ON CONFLICT ("settingKey") DO UPDATE SET "settingValue" = EXCLUDED."settingValue", "updatedAt" = now()`);
    },
    async claimAlarm(scope, episode) {
      try {
        const d = await getDb();
        if (!d) return false;
        const rows = (await d.execute(sql`
          INSERT INTO system_settings ("settingKey", "settingValue", "category")
          VALUES (${SAFETY_PLC_STALE_ALARM_KEY_PREFIX + scope.slice(0, 40)}, ${episode.slice(0, 200)}, 'safety_plc_poller')
          ON CONFLICT ("settingKey") DO UPDATE SET "settingValue" = EXCLUDED."settingValue", "updatedAt" = now()
            WHERE system_settings."settingValue" IS DISTINCT FROM EXCLUDED."settingValue"
          RETURNING id`)) as unknown as unknown[];
        return rows.length > 0;
      } catch {
        return false; // cannot claim ⇒ another instance (or the next check) will
      }
    },
  };
}

export interface WatchdogDeps {
  store: PollerHealthStore;
  record: (i: RecordSafetyEventInput) => Promise<RecordResult>;
  now: () => number;
  enabled: () => boolean;
  startedAt: number;
}

/** One watchdog check: evaluate, then claim + record ONE alarm per stale episode. Never throws. */
export async function runPollerWatchdogOnce(d: WatchdogDeps): Promise<PollerHealth> {
  const now = d.now();
  let hb: PollerHeartbeat | null | "error";
  try {
    hb = await d.store.readHeartbeat();
  } catch {
    hb = "error";
  }
  const h = evaluatePollerHealth(hb, now, { enabled: d.enabled() });
  for (const s of h.staleScopes) {
    if (s.episode === "never" && now - d.startedAt < SAFETY_PLC_WATCHDOG_BOOT_GRACE_MS) continue;
    try {
      if (!(await d.store.claimAlarm(s.scope, s.episode))) continue;
      console.error(`[SafetyPLC] MONITORING STALE (${s.scope}): ${s.reason} — safety-PLC monitoring is BLIND until it recovers`);
      await d.record({
        eventType: "plc_monitor_stale",
        detectedBy: "plc",
        handledBy: "advisory",
        outcome: "logged_only",
        isNearMiss: false,
        humanPosition: { scope: s.scope, poller: true, watchdog: true },
        notes: `safety-PLC monitoring STALE — ${s.reason}. Background monitoring is BLIND for this scope (the certified PLC still performs its rated stops in hardware; e-stop / guard trips are not being observed or notified). [watchdog, READ-ONLY]`,
      });
    } catch {
      /* the next check retries (the claim is per episode) */
    }
  }
  return h;
}

let watchdogTimer: NodeJS.Timeout | null = null;
/** Start the watchdog on THIS instance (idempotent). */
export function startSafetyPlcWatchdog(enabled: () => boolean, store: PollerHealthStore = pgPollerHealthStore()): void {
  if (watchdogTimer) return;
  const startedAt = Date.now();
  watchdogTimer = setInterval(() => {
    void runPollerWatchdogOnce({ store, record, now: Date.now, enabled, startedAt });
  }, SAFETY_PLC_WATCHDOG_PERIOD_MS);
  watchdogTimer.unref?.();
}
export function stopSafetyPlcWatchdog(): void {
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = null;
}
