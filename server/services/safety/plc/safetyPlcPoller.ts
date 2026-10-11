/**
 * doc 81 Đợt 8 Group N — BACKGROUND safety-PLC poller (READ-ONLY).
 *   Flag: SAFETY_PLC_POLLER_ENABLED (default OFF). Also needs SAFETY_PLC_ADAPTER_ENABLED (the adapter's master switch) and
 *   SAFETY_AUDIT_ENABLED (events are recorded through the audit service); with either off it does not start (logged).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Reads every ENABLED `safety_plc_configs` row periodically through the EXISTING read-only adapter backends
 * (SimSafetyPlcBackend / OtReadSafetyPlcBackend — the OT driver's readTags only).
 *
 * ⚠ L-7: this module NEVER writes to and NEVER actuates a PLC, a robot or any device. The certified Safety PLC performs the
 *   rated stop itself in hardware; this only OBSERVES its non-safety-rated status. Nothing here sits on a STOP path, so
 *   nothing here can slow or gate a STOP.
 *
 * Scheduling (N1):
 *   • interval per config = statusMap.pollIntervalMs, else SAFETY_PLC_POLL_INTERVAL_MS, else 1000 ms; clamped [250, 60000];
 *   • one timer chain per config (setTimeout after the previous read settled ⇒ never overlapping);
 *   • per-config exponential backoff on undecidable reads: interval × 2^failures, capped at max(interval, 15 s);
 *   • every read is bounded (SAFETY_PLC_POLL_READ_TIMEOUT_MS, default 3000, clamped [100, 30000]); a read still pending
 *     after its bound is NOT duplicated — the next polls count as undecidable until it settles (≤ 1 connection per PLC);
 *   • configs are re-listed every 30 s; at most SAFETY_PLC_POLL_MAX_CONFIGS are polled (the rest are named in a warning).
 *
 * Undecidable (cannot decide) ⇒ the config is "unknown/offline"; never "ok" / never "released".
 * Run it on ONE instance only (the trusted-origin mark lives in this process; multi-instance replay is out of scope).
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { SafetyPlcConfig, SafetyPlcStatusMap, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import {
  OtReadSafetyPlcBackend,
  SimSafetyPlcBackend,
  safetyPlcAdapterEnabled,
  listPlcConfigs,
  type SafetyPlcBackendReader,
} from "./safetyPlcAdapter";
import { safetyAuditEnabled, record, type RecordSafetyEventInput, type RecordResult } from "../safetyAuditService";

/** Flag — default OFF. */
export function safetyPlcPollerEnabled(): boolean {
  return process.env.SAFETY_PLC_POLLER_ENABLED === "true" || process.env.SAFETY_PLC_POLLER_ENABLED === "1";
}

export const SAFETY_PLC_POLL_MIN_INTERVAL_MS = 250;
export const SAFETY_PLC_POLL_MAX_INTERVAL_MS = 60_000;
export const SAFETY_PLC_POLL_DEFAULT_INTERVAL_MS = 1000;
export const SAFETY_PLC_POLL_BACKOFF_CAP_MS = 15_000;
export const SAFETY_PLC_POLL_MAX_CONFIGS = 200;
export const SAFETY_PLC_CONFIG_REFRESH_MS = 30_000;
export const SAFETY_PLC_READ_TIMEOUT_DEFAULT_MS = 3000;

export type PlcFlag = keyof SafetyPlcStatusSnapshot;
export const PLC_FLAGS: readonly PlcFlag[] = ["estop", "zoneOccupied", "resetRequired", "muting"];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The poll period of a config (ms), clamped to [250, 60000]. */
export function pollIntervalMsFor(cfg: Pick<SafetyPlcConfig, "statusMap">): number {
  const own = (cfg.statusMap as SafetyPlcStatusMap | null | undefined)?.pollIntervalMs;
  const env = Number(process.env.SAFETY_PLC_POLL_INTERVAL_MS);
  const base =
    typeof own === "number" && Number.isFinite(own)
      ? own
      : process.env.SAFETY_PLC_POLL_INTERVAL_MS && Number.isFinite(env)
        ? env
        : SAFETY_PLC_POLL_DEFAULT_INTERVAL_MS;
  return clamp(Math.round(base), SAFETY_PLC_POLL_MIN_INTERVAL_MS, SAFETY_PLC_POLL_MAX_INTERVAL_MS);
}

/** Bound of ONE read (ms). */
export function readTimeoutMs(): number {
  const v = Number(process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS);
  return process.env.SAFETY_PLC_POLL_READ_TIMEOUT_MS && Number.isFinite(v) ? clamp(Math.round(v), 100, 30_000) : SAFETY_PLC_READ_TIMEOUT_DEFAULT_MS;
}

/** Delay before the next read: the interval, or interval × 2^failures capped at max(interval, 15 s). */
export function backoffDelayMs(intervalMs: number, failStreak: number): number {
  if (failStreak <= 0) return intervalMs;
  return Math.min(intervalMs * 2 ** Math.min(failStreak, 16), Math.max(intervalMs, SAFETY_PLC_POLL_BACKOFF_CAP_MS));
}

/** The OT read drivers (modbus / opcua) are registered by importing the OT entry module (its side effect). */
async function ensureOtDriversRegistered(): Promise<void> {
  const { listProtocols } = await import("../../ot/driverRegistry");
  const have = listProtocols();
  if (have.includes("modbus") && have.includes("opcua")) return;
  await import("../../ot");
}

/** The flags a config actually monitors (sim: all four; real: those with a mapped tag address). */
function monitoredFlags(cfg: SafetyPlcConfig): PlcFlag[] {
  if (cfg.backend === "sim") return [...PLC_FLAGS];
  const map = (cfg.statusMap ?? {}) as SafetyPlcStatusMap;
  return PLC_FLAGS.filter((f) => typeof map[f]?.address === "string" && map[f]!.address!.length > 0);
}

/**
 * The read-only backend the poller uses for a config. Unlike the adapter's backendForConfig, a modbus/opcua config without
 * an endpoint (or without any mapped status tag) gets NO backend — it is "unknown", never the all-clear empty sim.
 */
export function defaultBackendFor(cfg: SafetyPlcConfig, timeoutMs: number): { backend: SafetyPlcBackendReader | null; reason?: string } {
  const map = (cfg.statusMap ?? {}) as SafetyPlcStatusMap;
  if (cfg.backend === "sim") return { backend: new SimSafetyPlcBackend(Array.isArray(map.simScript) ? map.simScript : []) };
  if (cfg.backend === "modbus" || cfg.backend === "opcua") {
    if (!cfg.endpoint) return { backend: null, reason: "endpoint missing" };
    if (monitoredFlags(cfg).length === 0) return { backend: null, reason: "no status tag mapped" };
    return { backend: new OtReadSafetyPlcBackend(cfg.backend, cfg.endpoint, map, timeoutMs) };
  }
  return { backend: null, reason: `unsupported backend "${String(cfg.backend).slice(0, 32)}"` };
}

/** One read's outcome. `decided` maps each monitored flag to an observed value, or lists it as unreadable. */
export type PollRead =
  | { kind: "decided"; flags: Partial<Record<PlcFlag, boolean>>; unreadable: PlcFlag[] }
  | { kind: "undecidable"; reason: string };

export interface PollerDeps {
  loadConfigs: () => Promise<SafetyPlcConfig[]>;
  backendFor: (cfg: SafetyPlcConfig, timeoutMs: number) => { backend: SafetyPlcBackendReader | null; reason?: string };
  /** Plain advisory door (sim / not-trusted events). */
  recordPlain: (input: RecordSafetyEventInput) => Promise<RecordResult>;
  /** Device-ingest door (real PLC reads). */
  recordTrusted: (input: RecordSafetyEventInput) => Promise<RecordResult>;
}

interface ConfigState {
  cfg: SafetyPlcConfig;
  fingerprint: string;
  backend: SafetyPlcBackendReader | null;
  reason?: string;
  intervalMs: number;
  monitored: PlcFlag[];
  failStreak: number;
  reads: number;
  /** Polls that ended undecidable (observability). */
  undecidable: number;
  lastRead: PollRead | null;
  /** The backend promise of a read that outlived its bound (≤ 1 per config). */
  pending: Promise<unknown> | null;
  busy: Promise<void> | null;
  timer: NodeJS.Timeout | null;
}

export interface PollerConfigSnapshot {
  id: number;
  code: string;
  intervalMs: number;
  failStreak: number;
  reads: number;
  undecidable: number;
  lastRead: PollRead | null;
}

function fingerprintOf(cfg: SafetyPlcConfig): string {
  return JSON.stringify([cfg.code, cfg.backend, cfg.endpoint, cfg.statusMap ?? null, cfg.robotId, cfg.stationId, cfg.lineId, cfg.scope, cfg.corporateCode, cfg.factoryId]);
}

/** Error text safe for a log line / a notes column: no control characters, bounded. */
export function safeReason(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return String(m).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
}

export class SafetyPlcPoller {
  private readonly deps: PollerDeps;
  private readonly states = new Map<number, ConfigState>();
  private gen = 0;
  private running = false;
  private refreshTimer: NodeJS.Timeout | null = null;
  private readonly warnedAt = new Map<string, number>();

  constructor(deps: Partial<PollerDeps> = {}) {
    this.deps = {
      loadConfigs: deps.loadConfigs ?? (() => listPlcConfigs({ onlyEnabled: true })),
      backendFor: deps.backendFor ?? defaultBackendFor,
      recordPlain: deps.recordPlain ?? record,
      recordTrusted: deps.recordTrusted ?? record,
    };
  }

  /** Start polling. Returns false (and does nothing) unless every flag it needs is on. Idempotent. */
  start(): boolean {
    if (!safetyPlcPollerEnabled()) return false;
    if (!safetyPlcAdapterEnabled() || !safetyAuditEnabled()) {
      console.warn("[SafetyPLC] SAFETY_PLC_POLLER_ENABLED=true but SAFETY_PLC_ADAPTER_ENABLED / SAFETY_AUDIT_ENABLED is off — background poller NOT started");
      return false;
    }
    if (this.running) return true;
    this.running = true;
    const gen = ++this.gen;
    console.log("[SafetyPLC] background poller started (READ-ONLY; never actuates)");
    void this.refreshLoop(gen);
    return true;
  }

  isRunning(): boolean {
    return this.running;
  }

  private async refreshLoop(gen: number): Promise<void> {
    if (gen !== this.gen) return;
    try {
      await this.refreshConfigs();
    } catch (e) {
      this.warnLimited("refresh", `[SafetyPLC] poller could not list configs (keeps the current set): ${safeReason(e)}`);
    }
    if (gen !== this.gen) return;
    this.refreshTimer = setTimeout(() => void this.refreshLoop(gen), SAFETY_PLC_CONFIG_REFRESH_MS);
    this.refreshTimer.unref?.();
  }

  /** Re-list the enabled configs: add new ones, rebuild changed ones, drop removed ones. */
  async refreshConfigs(): Promise<void> {
    const gen = this.gen;
    const all = (await this.deps.loadConfigs()).filter((c) => c && c.enabled === true && Number.isSafeInteger(c.id));
    if (gen !== this.gen) return;
    all.sort((a, b) => a.id - b.id);
    const kept = all.slice(0, SAFETY_PLC_POLL_MAX_CONFIGS);
    if (all.length > kept.length) {
      this.warnLimited("cap", `[SafetyPLC] ${all.length} enabled configs; only the first ${kept.length} are polled — NOT polled: ${all.slice(kept.length, kept.length + 20).map((c) => c.id).join(",")}${all.length - kept.length > 20 ? ",…" : ""}`);
    }
    if (this.deps.backendFor === defaultBackendFor && kept.some((c) => c.backend === "modbus" || c.backend === "opcua")) {
      await ensureOtDriversRegistered();
      if (gen !== this.gen) return;
    }
    const seen = new Set<number>();
    kept.forEach((cfg, i) => {
      seen.add(cfg.id);
      const fp = fingerprintOf(cfg);
      const old = this.states.get(cfg.id);
      if (old && old.fingerprint === fp) return;
      if (old) this.dropState(cfg.id);
      const timeout = readTimeoutMs();
      const { backend, reason } = this.deps.backendFor(cfg, timeout);
      const st: ConfigState = {
        cfg,
        fingerprint: fp,
        backend,
        reason,
        intervalMs: pollIntervalMsFor(cfg),
        monitored: monitoredFlags(cfg),
        failStreak: 0,
        reads: 0,
        undecidable: 0,
        lastRead: null,
        pending: null,
        busy: null,
        timer: null,
      };
      this.states.set(cfg.id, st);
      if (this.running) this.schedule(cfg.id, st, (i * 37) % st.intervalMs);
    });
    for (const id of [...this.states.keys()]) if (!seen.has(id)) this.dropState(id);
  }

  private dropState(id: number): void {
    const st = this.states.get(id);
    if (st?.timer) clearTimeout(st.timer);
    this.states.delete(id);
  }

  private schedule(id: number, st: ConfigState, delayMs: number): void {
    if (st.timer) clearTimeout(st.timer);
    const gen = this.gen;
    st.timer = setTimeout(() => void this.tick(id, st, gen), delayMs);
    st.timer.unref?.();
  }

  private async tick(id: number, st: ConfigState, gen: number): Promise<void> {
    st.timer = null;
    if (gen !== this.gen || this.states.get(id) !== st) return;
    await this.pollNow(id);
    if (gen !== this.gen || this.states.get(id) !== st || !this.running) return;
    this.schedule(id, st, backoffDelayMs(st.intervalMs, st.failStreak));
  }

  /** One poll of one config (the scheduler's unit; also a test seam). Concurrent calls share one read. */
  pollNow(id: number): Promise<void> {
    const st = this.states.get(id);
    if (!st) return Promise.resolve();
    if (st.busy) return st.busy;
    const p = (async () => {
      try {
        const read = await this.readOnce(st);
        if (this.states.get(id) !== st) return; // config changed / removed / poller stopped meanwhile
        st.lastRead = read;
        st.failStreak = read.kind === "undecidable" ? st.failStreak + 1 : 0;
        if (read.kind === "undecidable") st.undecidable += 1;
      } catch (e) {
        this.warnLimited(`tick:${id}`, `[SafetyPLC] poll of config ${id} failed: ${safeReason(e)}`);
      }
    })().finally(() => {
      st.busy = null;
    });
    st.busy = p;
    return p;
  }

  /** ONE bounded read. Never throws; anything it cannot decide is `undecidable`. */
  private async readOnce(st: ConfigState): Promise<PollRead> {
    if (!st.backend) return { kind: "undecidable", reason: st.reason ?? "no backend" };
    if (st.pending) return { kind: "undecidable", reason: "previous read still pending (PLC not answering)" };
    const backend = st.backend;
    st.reads += 1;
    let inner: Promise<PollRead>;
    try {
      inner = backend.kind === "sim" ? backend.read().then((s) => this.decideSim(s)) : this.readReal(backend, st);
    } catch (e) {
      return { kind: "undecidable", reason: `read failed: ${safeReason(e)}` };
    }
    const settled = inner.then(
      (r) => r,
      (e): PollRead => ({ kind: "undecidable", reason: `read failed: ${safeReason(e)}` }),
    );
    st.pending = settled;
    void settled.finally(() => {
      if (st.pending === settled) st.pending = null;
    });
    const bound = readTimeoutMs();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<PollRead>((r) => {
      timer = setTimeout(() => r({ kind: "undecidable", reason: `read timed out after ${bound} ms` }), bound);
    });
    try {
      return await Promise.race([settled, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async readReal(backend: SafetyPlcBackendReader, st: ConfigState): Promise<PollRead> {
    if (typeof backend.readChecked !== "function") return { kind: "undecidable", reason: "backend cannot report unreadable tags" };
    const r = await backend.readChecked();
    const flags: Partial<Record<PlcFlag, boolean>> = {};
    const unreadable: PlcFlag[] = [];
    for (const f of st.monitored) {
      const v = r?.status?.[f];
      if (r?.unreadable?.includes(f) || typeof v !== "boolean") unreadable.push(f);
      else flags[f] = v;
    }
    return { kind: "decided", flags, unreadable };
  }

  private decideSim(s: SafetyPlcStatusSnapshot): PollRead {
    const flags: Partial<Record<PlcFlag, boolean>> = {};
    for (const f of PLC_FLAGS) flags[f] = s?.[f] === true;
    return { kind: "decided", flags, unreadable: [] };
  }

  /** Stop all timers; resolves once in-flight polls have settled (bounded). Restart with start(). */
  async stop(): Promise<void> {
    this.running = false;
    this.gen += 1;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    const busy: Promise<unknown>[] = [];
    for (const st of this.states.values()) {
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
      if (st.busy) busy.push(st.busy);
    }
    this.states.clear();
    this.warnedAt.clear();
    if (busy.length) {
      let t: NodeJS.Timeout | undefined;
      await Promise.race([Promise.allSettled(busy), new Promise((r) => (t = setTimeout(r, readTimeoutMs() + 500)))]);
      clearTimeout(t);
    }
  }

  snapshot(): PollerConfigSnapshot[] {
    return [...this.states.values()]
      .map((st) => ({ id: st.cfg.id, code: st.cfg.code, intervalMs: st.intervalMs, failStreak: st.failStreak, reads: st.reads, undecidable: st.undecidable, lastRead: st.lastRead }))
      .sort((a, b) => a.id - b.id);
  }

  private warnLimited(key: string, msg: string): void {
    const now = Date.now();
    const last = this.warnedAt.get(key);
    if (last != null && now - last < 60_000) return;
    if (this.warnedAt.size > 1000) this.warnedAt.clear();
    this.warnedAt.set(key, now);
    console.warn(msg);
  }
}

// ── process singleton (started from server/_core/index.ts; production deps only) ──
let singleton: SafetyPlcPoller | null = null;

/** No-op unless SAFETY_PLC_POLLER_ENABLED (+ adapter + audit flags). Never throws. */
export function startSafetyPlcPoller(): boolean {
  try {
    if (!safetyPlcPollerEnabled()) return false;
    singleton ??= new SafetyPlcPoller();
    return singleton.start();
  } catch (e) {
    console.error("[SafetyPLC] poller start failed:", safeReason(e));
    return false;
  }
}

export async function stopSafetyPlcPoller(): Promise<void> {
  if (singleton) await singleton.stop();
}
