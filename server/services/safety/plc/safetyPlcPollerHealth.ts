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
 * Residual (documented): if EVERY instance's event loop hangs, nothing in-process can alarm — external monitoring should
 * read safety.sourceHealth (plcPoller.state / lastPollAt).
 * L-7: reads / writes its own rows and records advisory events; never touches a PLC.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../../../db/connection";
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
  flags: Partial<Record<"estop" | "zoneOccupied" | "resetRequired" | "muting", boolean>>;
  intervalMs: number | null;
  lastAttemptAt: number | null;
  lastOkAt: number | null;
  /** fix scan 4 — the config trust digest this edge was written for (another identity ⇒ never applied). */
  identityDigest?: string | null;
  staleAlarmEpisode?: string | null;
}

/** Durable poll state. load/save/list THROW on failure (callers decide); claimStaleAlarm never throws. */
export interface PollStateStore {
  load(configId: number): Promise<PollStateRow | null>;
  save(row: Omit<PollStateRow, "staleAlarmEpisode">): Promise<void>;
  list(): Promise<PollStateRow[]>;
  /** true ⇔ THIS caller is the first to claim (configId, episode) cluster-wide. */
  claimStaleAlarm(configId: number, episode: string): Promise<boolean>;
}

const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
function rowOf(r: Record<string, unknown>): PollStateRow {
  const link = r.link === "online" || r.link === "offline" ? r.link : "unknown";
  const flags = r.flags && typeof r.flags === "object" ? (r.flags as PollStateRow["flags"]) : {};
  return { configId: Number(r.configId), link, flags, intervalMs: num(r.intervalMs), lastAttemptAt: num(r.lastAttemptAt), lastOkAt: num(r.lastOkAt), identityDigest: (r.identityDigest as string | null) ?? null, staleAlarmEpisode: (r.staleAlarmEpisode as string | null) ?? null };
}

/** The production store: table safety_plc_poll_state (migration 0368). */
export function pgPollStateStore(instance = `${process.pid}`): PollStateStore {
  const db = async () => {
    const d = await getDb();
    if (!d) throw new Error("db unavailable");
    return d;
  };
  return {
    async load(configId) {
      const rows = (await (await db()).execute(sql`
        SELECT "configId", link, flags, "intervalMs", "lastAttemptAt", "lastOkAt", "identityDigest", "staleAlarmEpisode"
          FROM safety_plc_poll_state WHERE "configId" = ${configId}`)) as unknown as Array<Record<string, unknown>>;
      return rows[0] ? rowOf(rows[0]) : null;
    },
    async save(r) {
      await (await db()).execute(sql`
        INSERT INTO safety_plc_poll_state ("configId", link, flags, "intervalMs", "lastAttemptAt", "lastOkAt", "identityDigest", "writerInstance", "updatedAt")
        VALUES (${r.configId}, ${r.link}, ${JSON.stringify(r.flags ?? {})}::jsonb, ${r.intervalMs}, ${r.lastAttemptAt}, ${r.lastOkAt}, ${r.identityDigest ?? null}, ${instance.slice(0, 64)}, now())
        ON CONFLICT ("configId") DO UPDATE SET link = EXCLUDED.link, flags = EXCLUDED.flags, "intervalMs" = EXCLUDED."intervalMs",
          "lastAttemptAt" = EXCLUDED."lastAttemptAt", "lastOkAt" = EXCLUDED."lastOkAt", "identityDigest" = EXCLUDED."identityDigest", "writerInstance" = EXCLUDED."writerInstance", "updatedAt" = now()`);
    },
    async list() {
      const rows = (await (await db()).execute(sql`
        SELECT "configId", link, flags, "intervalMs", "lastAttemptAt", "lastOkAt", "staleAlarmEpisode" FROM safety_plc_poll_state`)) as unknown as Array<Record<string, unknown>>;
      return rows.map(rowOf);
    },
    async claimStaleAlarm(configId, episode) {
      try {
        const rows = (await (await db()).execute(sql`
          INSERT INTO safety_plc_poll_state ("configId", "staleAlarmEpisode") VALUES (${configId}, ${episode.slice(0, 200)})
          ON CONFLICT ("configId") DO UPDATE SET "staleAlarmEpisode" = EXCLUDED."staleAlarmEpisode"
            WHERE safety_plc_poll_state."staleAlarmEpisode" IS DISTINCT FROM EXCLUDED."staleAlarmEpisode"
          RETURNING "configId"`)) as unknown as unknown[];
        return rows.length > 0;
      } catch {
        return false; // cannot claim ⇒ the next check (or another instance) will
      }
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
  configs: Array<EnabledConfigLite & { link: PollLink; lastAttemptAt: number | null; lastOkAt: number | null; stale: boolean }>;
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
    const stale = last == null || now - last > configStaleAfterMs(r?.intervalMs);
    if (stale) {
      staleScopes.push({
        configId: c.id,
        episode: `cfg:${c.id}:${last ?? "never"}`,
        reason: last == null ? `config "${String(c.code).slice(0, 64)}" has never been polled` : `config "${String(c.code).slice(0, 64)}" not polled for ${Math.round((now - last) / 1000)} s`,
      });
    }
    return { ...c, link: r?.link ?? "unknown", lastAttemptAt: last, lastOkAt: r?.lastOkAt ?? null, stale };
  });
  return { state: staleScopes.length ? "stale" : "ok", lastPollAt, configs, staleScopes };
}

export interface WatchdogDeps {
  store: PollStateStore;
  listConfigs: () => Promise<EnabledConfigLite[]>;
  record: (i: RecordSafetyEventInput) => Promise<RecordResult>;
  now: () => number;
  enabled: () => boolean;
  startedAt: number;
}

/** One watchdog check: evaluate from durable rows, then claim + record ONE alarm per stale episode. Never throws. */
export async function runPollerWatchdogOnce(d: WatchdogDeps): Promise<PollerHealth> {
  const now = d.now();
  let rows: PollStateRow[] | "error";
  let cfgs: EnabledConfigLite[] = [];
  try {
    [cfgs, rows] = await Promise.all([d.listConfigs(), d.store.list()]);
  } catch {
    rows = "error";
  }
  const h = evaluatePollerHealth(cfgs, rows, now, { enabled: d.enabled() });
  if (h.state === "unknown") {
    console.error("[SafetyPLC] MONITORING STATE UNKNOWN — the poll state cannot be read; treat safety-PLC monitoring as BLIND");
  }
  for (const s of h.staleScopes) {
    if (s.episode.endsWith(":never") && now - d.startedAt < SAFETY_PLC_WATCHDOG_BOOT_GRACE_MS) continue;
    try {
      if (!(await d.store.claimStaleAlarm(s.configId, s.episode))) continue;
      const cfg = cfgs.find((c) => c.id === s.configId);
      console.error(`[SafetyPLC] MONITORING STALE (config ${s.configId}): ${s.reason} — safety-PLC monitoring is BLIND for it`);
      await d.record({
        eventType: "plc_monitor_stale",
        detectedBy: "plc",
        handledBy: "advisory",
        outcome: "logged_only",
        isNearMiss: false,
        factoryId: cfg?.factoryId ?? null,
        humanPosition: { plcConfigId: s.configId, poller: true, watchdog: true },
        notes: `safety-PLC monitoring STALE — ${s.reason}. Background monitoring is BLIND for this PLC (the certified PLC still performs its rated stops in hardware; its e-stop / guard trips are not being observed or notified). [watchdog, READ-ONLY]`,
      });
    } catch {
      /* the next check retries (the claim is per episode) */
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
