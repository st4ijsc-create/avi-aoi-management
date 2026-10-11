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
import { safetyAuditEnabled, record, recordFromDeviceIngest, type RecordSafetyEventInput, type RecordResult, type SafetyEventType } from "../safetyAuditService";
import { isPlcConfigTrustApproved, plcTrustMaterial } from "./safetyPlcTrust";
import { pgPollerLeaderGate, type PollerLeaderGate } from "./safetyPlcPollerLeader";
import { redactEndpoint, safeBackendLabel } from "./plcRedact";
import { pgPollerHealthStore, startSafetyPlcWatchdog, stopSafetyPlcWatchdog, safetyPlcPollerEnabled, type PollerHealthStore, type PollerHeartbeat } from "./safetyPlcPollerHealth";

/** Flag — default OFF. (Defined once in the health leaf module so the source-health panel reads the SAME predicate.) */
export { safetyPlcPollerEnabled } from "./safetyPlcPollerHealth";

export const SAFETY_PLC_POLL_MIN_INTERVAL_MS = 250;
export const SAFETY_PLC_POLL_MAX_INTERVAL_MS = 60_000;
export const SAFETY_PLC_POLL_DEFAULT_INTERVAL_MS = 1000;
export const SAFETY_PLC_POLL_BACKOFF_CAP_MS = 15_000;
export const SAFETY_PLC_POLL_MAX_CONFIGS = 200;
/** Config re-list + leader re-check period (N fix 1, M4: was 30 s — a lost lock must stop the polling quickly). */
export const SAFETY_PLC_CONFIG_REFRESH_MS = 10_000;
export const SAFETY_PLC_READ_TIMEOUT_DEFAULT_MS = 3000;
/** fix scan 2 (R-8-b) — bound of ONE event insert / approval lookup (a hung DB must not stall the poll chain). */
export const SAFETY_PLC_RECORD_TIMEOUT_MS = 5000;
/** fix scan 2 (R-8-b, (b)) — per-config queue of not-yet-recorded transitions (oldest dropped + counted beyond it). */
export const SAFETY_PLC_EVENT_QUEUE_MAX = 32;
/** N3 flap damping — offline transitions remembered per config (window + cap) and the clean-read run needed to go online. */
export const SAFETY_PLC_FLAP_WINDOW_MS = 10 * 60_000;
export const SAFETY_PLC_FLAP_HISTORY_MAX = 8;
export const SAFETY_PLC_ONLINE_CONFIRM_MAX = 32;

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

/** N3 — clean reads needed to declare an offline PLC online again: 2 ^ (offline transitions in the last 10 min), 2..32. */
export function onlineConfirmReads(offlineAt: readonly number[], now = Date.now()): number {
  const recent = offlineAt.filter((t) => now - t < SAFETY_PLC_FLAP_WINDOW_MS).length;
  return Math.min(Math.max(2, 2 ** recent), SAFETY_PLC_ONLINE_CONFIRM_MAX);
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

/** N2 — the event of each flag's RISING edge (the adapter's advisory mapping). */
const FLAG_RISE_EVENT: Record<PlcFlag, SafetyEventType> = {
  estop: "estop",
  zoneOccupied: "zone_intrusion",
  // N fix 1 (review M6) — distinct types: the feed badges "Intrusion" / "Speed violation" misread a reset-required /
  // muting status of a safety PLC. Neither is a trusted bypass type.
  resetRequired: "reset_required",
  muting: "muting_active",
};

const EVENT_NOTE: Partial<Record<SafetyEventType, string>> = {
  estop: "safety-PLC reports e-stop PRESSED (the certified PLC performs the rated stop itself; software only observed it)",
  estop_released: "safety-PLC reports e-stop RELEASED (decided read of the e-stop status tag)",
  zone_intrusion: "safety-PLC reports a guard / light curtain TRIPPED (protected zone occupied)",
  reset_required: "safety-PLC reports RESET REQUIRED — a safety function tripped and awaits manual reset",
  muting_active: "safety-PLC reports MUTING active — a protective function is temporarily bypassed",
  plc_offline: "safety-PLC status UNKNOWN (offline) — e-stop / guard state cannot be decided",
  plc_online: "safety-PLC status readable again (back online)",
};

/** One read's outcome. `decided` maps each monitored flag to an observed value, or lists it as unreadable. */
export type PollRead =
  | { kind: "decided"; flags: Partial<Record<PlcFlag, boolean>>; unreadable: PlcFlag[] }
  | { kind: "undecidable"; reason: string };

export interface PollerDeps {
  loadConfigs: () => Promise<SafetyPlcConfig[]>;
  backendFor: (cfg: SafetyPlcConfig, timeoutMs: number) => { backend: SafetyPlcBackendReader | null; reason?: string };
  /** Plain advisory door (sim / not-trusted events). */
  recordPlain: (input: RecordSafetyEventInput) => Promise<RecordResult>;
  /** Device-ingest door (real PLC reads of an APPROVED config). */
  recordTrusted: (input: RecordSafetyEventInput) => Promise<RecordResult>;
  /**
   * doc 81 Đợt 8 N fix 1 (I1, maker-checker) — is this config's CURRENT content approved by a second person? Asked at
   * record time for every event of a real backend; false / error ⇒ the PLAIN door (recorded, normal notice, no bypass).
   */
  isTrustApproved: (cfg: SafetyPlcConfig) => Promise<boolean>;
  /** N fix 1 (M4) — cluster leadership: only the holder polls. Default: pg_try_advisory_lock on a dedicated session. */
  leader: PollerLeaderGate;
  /** fix scan 2 (R-8-b) — where the leader persists its heartbeat (default: system_settings). */
  health: PollerHealthStore;
  /** fix scan 2 — bound of one event insert / approval lookup (ms). */
  recordTimeoutMs: number;
}

/** fix scan 2 — a transition waiting to be recorded (re-baseline captured at detection). */
interface QueuedEvent {
  input: RecordSafetyEventInput;
  rebaseline: boolean;
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
  /** N2 — server-trusted device-ingest origin: ONLY the adapter's real OT read class (never sim, never a look-alike). */
  trusted: boolean;
  /** N2 — the link state last RECORDED ("unknown" = never decided yet). */
  link: "unknown" | "online" | "offline";
  /** N2 — the flag values last RECORDED (edge detection; undefined = never decided). */
  flags: Partial<Record<PlcFlag, boolean>>;
  /** N3 — consecutive fully decided reads while offline, and when this config last went offline (bounded). */
  goodStreak: number;
  offlineAt: number[];
  /** N fix 1 (M1) — what is being READ (backend, endpoint, tag map): unchanged ⇒ an edit carries the state. */
  readIdentity: string;
  /** N fix 1 (M1) — rebuilt after a read-identity change: events of its first decided read are a re-baseline (plain door). */
  rebaseline: boolean;
  /** N fix 1 (M5) — consecutive failed event records (feeds the backoff like failed reads). */
  recordFailStreak: number;
  /** fix scan 2 — not-yet-recorded transitions (bounded) + how many were dropped (one marker when the DB is back). */
  queue: QueuedEvent[];
  lostEvents: number;
  /** fix scan 2 — health: when tracking began, last poll attempt, last fully decided read (epoch ms). */
  since: number;
  lastAttemptAt: number | null;
  lastOkAt: number | null;
}

export interface PollerConfigSnapshot {
  id: number;
  code: string;
  intervalMs: number;
  failStreak: number;
  /** N fix 1 (M5) */
  recordFailStreak: number;
  /** fix scan 2 */
  lastAttemptAt: number | null;
  lastOkAt: number | null;
  queued: number;
  reads: number;
  undecidable: number;
  lastRead: PollRead | null;
}

/** N fix 1 (M1) — the read identity: backend kind, endpoint and the normalised tag map (the trust digest's own material). */
function readIdentityOf(cfg: SafetyPlcConfig): string {
  const m = plcTrustMaterial(cfg);
  return JSON.stringify([m[1], m[2], m[3]]);
}

function fingerprintOf(cfg: SafetyPlcConfig): string {
  return JSON.stringify([cfg.code, cfg.backend, cfg.endpoint, cfg.statusMap ?? null, cfg.robotId, cfg.stationId, cfg.lineId, cfg.scope, cfg.corporateCode, cfg.factoryId]);
}

/** Error text safe for a log line / a notes column: no control characters, bounded. */
export function safeReason(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return String(m).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 200);
}

// redactEndpoint moved to the leaf module plcRedact.ts (N fix 1, M3: shared with the manual readSafetyPlc path).
export { redactEndpoint } from "./plcRedact";

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
      recordTrusted: deps.recordTrusted ?? ((i) => recordFromDeviceIngest("safety_plc", i)),
      isTrustApproved: deps.isTrustApproved ?? isPlcConfigTrustApproved,
      leader: deps.leader ?? pgPollerLeaderGate(),
      health: deps.health ?? pgPollerHealthStore(),
      recordTimeoutMs: deps.recordTimeoutMs ?? SAFETY_PLC_RECORD_TIMEOUT_MS,
    };
  }

  private leading = false;

  /**
   * N fix 1 (M4) — (re)check cluster leadership, then re-list the configs. Not the leader (or undecided) ⇒ every state is
   * dropped and nothing is polled. Returns whether this instance leads now. (refreshLoop's unit; also a test seam.)
   */
  async leaderCheckAndRefresh(): Promise<boolean> {
    const gen = this.gen;
    let lead = false;
    try {
      lead = (this.leading ? await this.deps.leader.held() : await this.deps.leader.acquire()) === true;
    } catch {
      lead = false;
    }
    if (gen !== this.gen) return false;
    if (!lead) {
      if (this.leading) console.warn("[SafetyPLC] poller leadership LOST — polling stopped on this instance (another instance may take over)");
      this.leading = false;
      for (const id of [...this.states.keys()]) this.dropState(id);
      return false;
    }
    if (!this.leading) console.log("[SafetyPLC] poller leadership acquired — this instance polls the safety PLCs");
    this.leading = true;
    await this.refreshConfigs();
    await this.writeHeartbeat();
    return true;
  }

  /** fix scan 2 (R-8-b) — the leader's heartbeat (no endpoints): per config last attempt / last decided read / link. */
  private async writeHeartbeat(): Promise<void> {
    const hb: PollerHeartbeat = {
      v: 1,
      at: Date.now(),
      instance: `${process.pid}`,
      configs: [...this.states.values()].map((st) => ({
        id: st.cfg.id,
        code: st.cfg.code,
        factoryId: st.cfg.factoryId ?? null,
        intervalMs: st.intervalMs,
        since: st.since,
        lastAttemptAt: st.lastAttemptAt,
        lastOkAt: st.lastOkAt,
        link: st.link,
      })),
    };
    try {
      await this.bounded(this.deps.health.writeHeartbeat(hb), this.deps.recordTimeoutMs, "heartbeat write");
    } catch (e) {
      // a missing heartbeat is itself the alarm signal (watchdog ⇒ "stale") — fail-safe direction
      this.warnLimited("heartbeat", `[SafetyPLC] poller heartbeat could not be written (monitoring will read as STALE): ${safeReason(e)}`);
    }
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
      await this.leaderCheckAndRefresh();
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
      const readIdentity = readIdentityOf(cfg);
      // M1 — same read identity ⇒ CARRY the state (and the backend + any in-flight read: no second connection, no re-sent
      // held trip); otherwise a fresh state whose first decided read is a RE-BASELINE (plain door, not trusted).
      const carry = old != null && old.readIdentity === readIdentity;
      if (old) this.dropState(cfg.id);
      const timeout = readTimeoutMs();
      const { backend, reason } = carry ? { backend: old!.backend, reason: old!.reason } : this.deps.backendFor(cfg, timeout);
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
        trusted: backend instanceof OtReadSafetyPlcBackend,
        link: "unknown",
        flags: {},
        goodStreak: 0,
        offlineAt: [],
        readIdentity,
        rebaseline: old != null && !carry,
        recordFailStreak: 0,
        queue: [],
        lostEvents: 0,
        since: Date.now(),
        lastAttemptAt: null,
        lastOkAt: null,
      };
      if (carry && old) {
        st.link = old.link;
        st.flags = { ...old.flags };
        st.goodStreak = old.goodStreak;
        st.offlineAt = [...old.offlineAt];
        st.failStreak = old.failStreak;
        st.recordFailStreak = old.recordFailStreak;
        st.rebaseline = old.rebaseline;
        st.pending = old.pending;
        st.queue = old.queue; // fix scan 2 — queued transitions survive the edit (never dropped)
        st.lostEvents = old.lostEvents;
        st.since = old.since;
        st.lastAttemptAt = old.lastAttemptAt;
        st.lastOkAt = old.lastOkAt;
        if (old.busy) {
          const b: Promise<void> = old.busy.then(() => undefined, () => undefined).finally(() => {
            if (st.busy === b) st.busy = null;
          });
          st.busy = b;
        }
      }
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
    this.schedule(id, st, backoffDelayMs(st.intervalMs, Math.max(st.failStreak, st.recordFailStreak)));
  }

  /** One poll of one config (the scheduler's unit; also a test seam). Concurrent calls share one read. */
  pollNow(id: number): Promise<void> {
    const st = this.states.get(id);
    if (!st) return Promise.resolve();
    if (st.busy) return st.busy;
    const p = (async () => {
      try {
        st.lastAttemptAt = Date.now(); // fix scan 2 — health: the chain is alive
        const read = await this.readOnce(st);
        if (this.states.get(id) !== st) return; // config changed / removed / poller stopped meanwhile
        st.lastRead = read;
        st.failStreak = read.kind === "undecidable" ? st.failStreak + 1 : 0;
        if (read.kind === "undecidable") st.undecidable += 1;
        await this.applyTransitions(id, st, read);
      } catch (e) {
        this.warnLimited(`tick:${id}`, `[SafetyPLC] poll of config ${id} failed: ${safeReason(e)}`);
      }
    })().finally(() => {
      st.busy = null;
    });
    st.busy = p;
    return p;
  }

  /**
   * N2 — turn a read into events on TRANSITIONS only. fix scan 2 (R-8-b, (b)): the new state is COMMITTED at detection
   * (the read confirmed it) and the event goes into a bounded per-config QUEUE drained in order; a failed record stays
   * queued (retried with backoff) — a transition is never dropped, and press + release while the DB is down are BOTH
   * recorded later. Overflow drops the OLDEST and counts it; ONE "plc_events_lost" marker is recorded first when the DB is
   * back. (c) edge detection compares with the last CONFIRMED (committed) state.
   *   link: undecidable (or a mapped flag unreadable) ⇒ "plc_offline" once; offline + a fully decided read ⇒ "plc_online";
   *         unknown + decided ⇒ online silently (no event at boot).
   *   flags (each decided flag on its own): estop false/unknown→true "estop", true→false "estop_released" (only while
   *         online — M2); zoneOccupied →true "zone_intrusion" (guard / light curtain); resetRequired →true "reset_required";
   *         muting →true "muting_active" (N fix 1, M6). Other changes are committed silently. An unreadable flag keeps its old value.
   */
  private async applyTransitions(id: number, st: ConfigState, read: PollRead): Promise<void> {
    const fullyDecided = read.kind === "decided" && read.unreadable.length === 0;
    if (fullyDecided) st.lastOkAt = Date.now();
    if (!fullyDecided) {
      st.goodStreak = 0;
      if (st.link !== "offline") {
        const why = read.kind === "undecidable" ? read.reason : `status flag(s) unreadable: ${read.unreadable.join(", ")}`;
        this.enqueue(st, "plc_offline", { transition: "offline", reason: why });
        st.link = "offline";
        st.offlineAt.push(Date.now());
        if (st.offlineAt.length > SAFETY_PLC_FLAP_HISTORY_MAX) st.offlineAt.splice(0, st.offlineAt.length - SAFETY_PLC_FLAP_HISTORY_MAX);
      }
    } else if (st.link === "offline") {
      // N3 flap damping: back online only after a clean run that doubles with every recent offline (2, 4, 8 … ≤ 32 reads).
      st.goodStreak += 1;
      if (st.goodStreak >= onlineConfirmReads(st.offlineAt)) {
        this.enqueue(st, "plc_online", { transition: "online" });
        st.link = "online";
        st.goodStreak = 0;
      }
    } else {
      st.link = "online";
    }
    if (read.kind === "decided") {
      for (const flag of PLC_FLAGS) {
        const now = read.flags[flag];
        if (typeof now !== "boolean") continue;
        const was = st.flags[flag];
        let ev: SafetyEventType | null = null;
        if (now && was !== true) ev = FLAG_RISE_EVENT[flag];
        else if (!now && was === true && flag === "estop") {
          // M2 — a release is reported only while the link is ONLINE (confirmed); until then it is held (not dropped).
          if (st.link !== "online") continue;
          ev = "estop_released";
        }
        if (ev) this.enqueue(st, ev, { transition: now ? "active" : "released", flag });
        st.flags[flag] = now;
      }
      // M1 — the re-baseline ends with the first FULLY decided read (its events were queued as re-baseline = plain door).
      if (fullyDecided) st.rebaseline = false;
    }
    await this.drain(id, st);
  }

  /** Queue one transition event (bounded: the OLDEST is dropped and counted beyond SAFETY_PLC_EVENT_QUEUE_MAX). */
  private enqueue(st: ConfigState, eventType: SafetyEventType, info: { transition: string; flag?: PlcFlag; reason?: string }): void {
    st.queue.push({ input: this.eventInput(st, eventType, info), rebaseline: st.rebaseline });
    while (st.queue.length > SAFETY_PLC_EVENT_QUEUE_MAX) {
      st.queue.shift();
      st.lostEvents += 1;
    }
  }

  private eventInput(st: ConfigState, eventType: SafetyEventType, info: { transition: string; flag?: PlcFlag; reason?: string }): RecordSafetyEventInput {
    const cfg = st.cfg;
    const isSim = cfg.backend === "sim" || st.backend?.kind === "sim";
    const source = isSim ? "sim" : "plc";
    // Never the endpoint (host / port) in a feed row: the label names only the backend kind; reasons are redacted.
    const label = st.backend ? safeBackendLabel(st.backend) : `${String(cfg.backend).slice(0, 16)} (no backend: ${st.reason ?? "?"})`;
    return {
      eventType,
      robotId: cfg.robotId ?? null,
      stationId: cfg.stationId ?? null,
      lineId: cfg.lineId ?? null,
      detectedBy: source,
      handledBy: "advisory",
      outcome: "logged_only",
      isNearMiss: false,
      humanPosition: { plcConfigId: cfg.id, plcFlag: info.flag ?? null, transition: info.transition, backend: st.backend?.kind ?? null, source, poller: true, detectedAt: new Date().toISOString() },
      notes: `${EVENT_NOTE[eventType] ?? eventType}${info.reason ? ` — ${redactEndpoint(info.reason, cfg.endpoint)}` : ""} [source ${source}, PLC "${cfg.code}", backend ${label}, background poller, READ-ONLY]`,
      scope: cfg.scope ?? null,
      corporateCode: cfg.corporateCode ?? null,
      factoryId: cfg.factoryId ?? null,
    };
  }

  /** A promise bounded by `ms` (fix scan 2: no await of the poll chain may hang it). Rejects on timeout. */
  private bounded<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    let t: NodeJS.Timeout | undefined;
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${what} exceeded ${ms} ms`)), ms);
        t.unref?.();
      }),
    ]).finally(() => clearTimeout(t));
  }

  /** Drain the queue in order: the "events lost" marker first, then each event; stop at the first failure (retried later). */
  private async drain(id: number, st: ConfigState): Promise<void> {
    if (st.lostEvents > 0) {
      const n = st.lostEvents;
      const marker = this.eventInput(st, "plc_events_lost", { transition: "lost" });
      marker.notes = `${n} safety-PLC transition event(s) of PLC "${st.cfg.code}" were LOST while events could not be recorded (queue bound ${SAFETY_PLC_EVENT_QUEUE_MAX}; oldest dropped). The events below are the most recent ones. [background poller, READ-ONLY]`;
      if (!(await this.recordOne(id, st, { input: marker, rebaseline: true }))) return;
      st.lostEvents -= n;
    }
    while (st.queue.length > 0) {
      if (this.states.get(id) !== st) return;
      if (!(await this.recordOne(id, st, st.queue[0]))) return;
      st.queue.shift();
    }
  }

  /** Record one queued event. true ⇔ recorded (or audit off: nothing will ever be recorded — do not retry forever). */
  private async recordOne(id: number, st: ConfigState, item: QueuedEvent): Promise<boolean> {
    const input = { ...item.input };
    const eventType = input.eventType;
    try {
      // I1 — trusted door ONLY for the real OT read class AND a config whose current content a second person approved.
      let approved = false;
      if (st.trusted && item.rebaseline) {
        // M1 — first read after the endpoint / tag map changed: whatever it shows is a new BASELINE, not a trip.
        if (eventType !== "plc_events_lost") input.notes = `${input.notes} [re-baseline after a config change — normal notice]`;
      } else if (st.trusted) {
        try {
          approved = (await this.bounded(this.deps.isTrustApproved(st.cfg), this.deps.recordTimeoutMs, "approval lookup")) === true;
        } catch {
          approved = false; // undecided / hung ⇒ not trusted (the event is still recorded, as a normal notice)
        }
        if (!approved) input.notes = `${input.notes} [config not approved by a second person — normal notice]`;
      }
      const res = await this.bounded(approved ? this.deps.recordTrusted(input) : this.deps.recordPlain(input), this.deps.recordTimeoutMs, "event insert");
      if (res.ok) {
        st.recordFailStreak = 0;
        return true;
      }
      if (res.enabled === false) {
        this.warnLimited("audit-off", "[SafetyPLC] SAFETY_AUDIT_ENABLED is off — poller transitions are not recorded");
        return true;
      }
      st.recordFailStreak += 1; // M5 — backs the next poll off (kept queued, never dropped)
      this.warnLimited(`rec:${id}`, `[SafetyPLC] could not record ${eventType} for config ${id} (kept queued): ${safeReason(res.message)}`);
      return false;
    } catch (e) {
      st.recordFailStreak += 1; // M5 (incl. a hung insert: bounded ⇒ retried; a duplicate is possible, a loss is not)
      this.warnLimited(`rec:${id}`, `[SafetyPLC] could not record ${eventType} for config ${id} (kept queued): ${safeReason(e)}`);
      return false;
    }
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

  /** Sim: an absent flag is clear (sim semantics); a present non-boolean is a PARSE ERROR ⇒ undecidable (N3). */
  private decideSim(s: SafetyPlcStatusSnapshot): PollRead {
    if (s == null || typeof s !== "object") return { kind: "undecidable", reason: "parse error: sim status is not an object" };
    const flags: Partial<Record<PlcFlag, boolean>> = {};
    for (const f of PLC_FLAGS) {
      const v: unknown = s[f];
      if (v === undefined) flags[f] = false;
      else if (typeof v === "boolean") flags[f] = v;
      else return { kind: "undecidable", reason: `parse error: sim flag ${f} is not a boolean` };
    }
    return { kind: "decided", flags, unreadable: [] };
  }

  /** Stop all timers; resolves once in-flight polls have settled (bounded). Restart with start(). */
  async stop(): Promise<void> {
    this.running = false;
    this.gen += 1;
    // M4 — give the leadership back (another instance may take over at its next check).
    if (this.leading) {
      this.leading = false;
      await this.deps.leader.release().catch(() => undefined);
    }
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
      .map((st) => ({ id: st.cfg.id, code: st.cfg.code, intervalMs: st.intervalMs, failStreak: st.failStreak, recordFailStreak: st.recordFailStreak, lastAttemptAt: st.lastAttemptAt, lastOkAt: st.lastOkAt, queued: st.queue.length, reads: st.reads, undecidable: st.undecidable, lastRead: st.lastRead }))
      .sort((a, b) => a.id - b.id);
  }

  /** Test seam — sizes of the internal maps (bounded-memory checks). */
  _sizesForTests(): { states: number; warned: number; maxHistory: number; maxFlagKeys: number; maxQueue: number } {
    let maxHistory = 0;
    let maxFlagKeys = 0;
    let maxQueue = 0;
    for (const st of this.states.values()) {
      maxHistory = Math.max(maxHistory, st.offlineAt.length);
      maxFlagKeys = Math.max(maxFlagKeys, Object.keys(st.flags).length);
      maxQueue = Math.max(maxQueue, st.queue.length);
    }
    return { states: this.states.size, warned: this.warnedAt.size, maxHistory, maxFlagKeys, maxQueue };
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
    const started = singleton.start();
    // fix scan 2 (R-8-b) — the watchdog runs on EVERY instance with the flags on (leader or standby), independently of the
    // poll chain: no heartbeat / a stalled chain ⇒ "monitoring stale" + one alarm per episode.
    if (started) startSafetyPlcWatchdog(() => safetyPlcPollerEnabled() && safetyPlcAdapterEnabled() && safetyAuditEnabled());
    return started;
  } catch (e) {
    console.error("[SafetyPLC] poller start failed:", safeReason(e));
    return false;
  }
}

export async function stopSafetyPlcPoller(): Promise<void> {
  stopSafetyPlcWatchdog();
  if (singleton) await singleton.stop();
}
