/**
 * doc 81 Đợt 9 task U1 — OPC-UA safety-PLC configs are read through a SUBSCRIPTION with QUEUED monitored items instead of
 * a poll, so a press and a release inside one interval are BOTH seen (owner decision 2026-10-12, "short e-stop presses").
 *
 * READ-ONLY (L-7): it monitors the Value attribute of the config's status tags (and the U2 latch / U fix 1 heartbeat tags, if
 * mapped) through OpcuaDriver.subscribeQueued and reads them back with OpcuaDriver.readTags; it never writes. It is still an
 * OtReadSafetyPlcBackend (same trust class, same tag map), so the poller's trusted-door / maker-checker rules apply
 * unchanged, and its fallback IS the inherited poll read.
 *
 * Per poll the poller asks readBatch():
 *   • subscription alive ⇒ every value change queued since the last call, IN ORDER, each as a full checked read (a press
 *     + release ⇒ two reads ⇒ two transitions); no change ⇒ the current state (a fully decided read keeps health fresh);
 *   • lost value changes — the server's OVERFLOW bit (its queue was full), a gap in the notification sequence numbers, or
 *     this buffer's own bound — are COUNTED (`lost`) ⇒ the poller records one "plc_events_lost" marker first;
 *   • subscription dead (terminated / bad status / link lost) or SILENT (no data and no keep-alive for deadAfterMs, capped
 *     at SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS — a third of the Đợt 8 stale bound) ⇒ an error read (⇒ "plc_offline"; never "ok",
 *     never "released"), the session is torn down and the next call re-subscribes;
 *   • U fix 1 (review I4) — a STALLED item under a live subscription (the server keeps sending keep-alives but stopped
 *     sampling / delivering an item): every SAFETY_PLC_OPCUA_VERIFY_MS a bounded VERIFICATION READ of the same nodes on the
 *     open session; a decided value that differs from the subscription's, and still differs one publishing interval later ⇒
 *     counted lost + an error read + re-subscribe. A failed verification read ⇒ the same (fail closed). A value frozen AT THE
 *     SOURCE (PLC program, gateway cache) is invisible to both reads and subscriptions: map a PLC HEARTBEAT tag
 *     (statusMap.heartbeat — the poller treats a heartbeat that stops changing as undecidable);
 *     U fix 2 — a verification read that is NOT decided while the subscription shows a value ⇒ the item goes unknown at once
 *     (never the cached value) + re-subscribe. The verification read is the ALWAYS-ON item-liveness check (a driver that
 *     cannot read on the session is refused). LIMIT (re-review N2, documented): without a heartbeat tag, a stalled item is
 *     caught only at the next verification (≤ SAFETY_PLC_OPCUA_VERIFY_MS + one publishing interval) and only if its fresh
 *     value differs or is not decided — a press AND release that both fall between two verification reads of a stalled
 *     item are missed. Map a PLC heartbeat tag (its silence ⇒ offline) to close that gap;
 *   • subscription impossible (create fails, the server revised a queue below 2, a sampling interval above
 *     SAFETY_PLC_OPCUA_MAX_SAMPLING_MS, a publishing interval above SAFETY_PLC_OPCUA_MAX_REVISED_PUBLISHING_MS or a keep-alive
 *     window above SAFETY_PLC_OPCUA_MAX_KEEPALIVE_WINDOW_MS, an item could not be created, no initial values) ⇒ mode
 *     "poll_fallback": the inherited connect / read / disconnect poll (short presses may be missed — shown on the Safety
 *     page), re-trying the subscription every SAFETY_PLC_OPCUA_RESUBSCRIBE_MS.
 *   • U fix 1 (review M1) — ONE budget per call (90 % of the read bound): a re-subscribe attempt gets half of it; a failed
 *     attempt's session is RELEASED (awaited, bounded) before the fallback poll opens its own (never two poller sessions),
 *     and the fallback poll gets what is left — so a server that refuses slowly does not turn every retry into an
 *     undecidable poll (offline / online flapping). If the release does not finish in time, no fallback read is made.
 * Order (review M3, documented): within ONE publish the server groups notifications PER ITEM (OPC UA Part 4 §7.20.2: the
 * monitoredItems list), so the order of changes is exact per flag but NOT across flags inside one publishing interval
 * (≤ 1 s): each flag's edges are right; the relative order of, say, an e-stop and a guard change in the same publish is the
 * server's item order. Events carry the poll time, not the source timestamp.
 * Undecidable is never "ok": every failure path yields an error read or the fallback poll, which is itself fail-closed.
 * Memory: ≤ SAFETY_PLC_OPCUA_BUFFER_MAX buffered reads per config (beyond: oldest dropped and counted as lost).
 * Connections: ONE session per PLC while subscribed (the actuation preflight opens its own — each PLC needs ≥ 2 clients).
 */
import type { SafetyPlcStatusMap, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import type { OtSample, OtTagAddress } from "../../ot/otDriver";
import type { OpcuaQueuedSink, OpcuaQueuedSubscription } from "../../ot/drivers/opcuaDriver";
import { createDriver } from "../../ot/driverRegistry";
import { OtReadSafetyPlcBackend, strictBool, decideHeartbeat, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";
import { performance } from "node:perf_hooks";
import { configStaleAfterMs } from "./safetyPlcPollerHealth";

/**
 * doc 81 Đợt 9 U fix 2 (re-review N1, security scan "fail-open-liveness") — every LOCAL liveness / silence / verification /
 * retry / budget timer runs on a MONOTONIC clock: a wall-clock step (NTP step, VM resume, manual change) can neither suspend
 * nor stretch them. (Durable cross-instance staleness stays on the DB clock — Đợt 8 N-R5.)
 */
export const monotonicNow = (): number => performance.now();

export const SAFETY_PLC_OPCUA_BUFFER_MAX = 256;
export const SAFETY_PLC_OPCUA_RESUBSCRIBE_MS = 60_000;
/** Requested keep-alive count: the server sends a keep-alive after this many empty publishing intervals. */
export const SAFETY_PLC_OPCUA_KEEPALIVE_COUNT = 3;
/** Requested sampling interval (ms) of each item: fast enough for a human press (≥ ~100 ms), bounded server load. */
export const SAFETY_PLC_OPCUA_SAMPLING_MS = 50;
/**
 * A server that revises an item's sampling interval above this samples too slowly to see a short press (the queue only
 * keeps what was SAMPLED) ⇒ treated like a refused subscription ⇒ visible poll fallback. (0 = exception-based: fine.)
 */
export const SAFETY_PLC_OPCUA_MAX_SAMPLING_MS = 250;
/** U fix 1 (I2) — requested publishing interval = min(poll interval, this): the silence window never scales with the poll. */
export const SAFETY_PLC_OPCUA_PUBLISHING_MAX_MS = 1000;
/**
 * U fix 1 (I2) — derived from the Đợt 8 stale bound (configStaleAfterMs: 4 × max(interval, 15 s) ≥ 60 s): a silent
 * subscription must be declared dead in at most a THIRD of the smallest stale bound (20 s), so monitoring loss is visible
 * ("plc_offline") long before — and independently of — the health watchdog.
 */
export const SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS = Math.floor(configStaleAfterMs(0) / 3);
/** The keep-alive window (revised publishing interval × revised keep-alive count) whose 2 misses + 1 s fit in the cap above. */
export const SAFETY_PLC_OPCUA_MAX_KEEPALIVE_WINDOW_MS = Math.floor((SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS - 1000) / 2);
/** A server revising the publishing interval above this (2 × requested max) ⇒ refused (the queue was sized for ≤ 1 s). */
export const SAFETY_PLC_OPCUA_MAX_REVISED_PUBLISHING_MS = 2 * SAFETY_PLC_OPCUA_PUBLISHING_MAX_MS;
/** U fix 1 (I4) — period of the verification read of the subscribed nodes on the open session. */
export const SAFETY_PLC_OPCUA_VERIFY_MS = 10_000;
/** U fix 1 (I4 / M1) — bound of ONE verification read. */
export const SAFETY_PLC_OPCUA_VERIFY_TIMEOUT_MS = 2000;

/** The read mode a poller config reports (persisted in safety_plc_poll_state.readMode — migration 0371). */
export type SafetyPlcReadMode = "subscription" | "poll_fallback" | "poll" | "poll_latch" | "sim";

/** One readBatch() answer. */
export interface SafetyPlcBatch {
  mode: "subscription" | "poll_fallback";
  /** Why the subscription is not in use (fallback) / was lost — redacted by the poller before any note. */
  modeReason?: string;
  reads: Array<SafetyPlcCheckedRead | { error: string }>;
  /** Value changes known to be LOST since the last call (overflow bit, sequence gap, buffer bound, stalled item). */
  lost: number;
}

/** The driver surface this backend needs (the registry's OpcuaDriver; a fake in unit tests). */
export interface QueuedSubscriptionDriver {
  connect(cfg: { endpoint: string; timeoutMs?: number }): Promise<void>;
  disconnect(): Promise<void>;
  subscribeQueued(
    tags: OtTagAddress[],
    opts: { publishingIntervalMs: number; samplingIntervalMs: number; queueSize: number; maxKeepAliveCount: number },
    sink: OpcuaQueuedSink,
  ): Promise<OpcuaQueuedSubscription>;
  /** U fix 1 (I4) — a read of the same nodes on the OPEN session (the verification read). */
  readTags(tags: OtTagAddress[]): Promise<OtSample[]>;
}

type FlagKey = keyof SafetyPlcStatusSnapshot | "estopLatch";
type Key = FlagKey | "heartbeat";
type Val = boolean | "bad" | { hb: number | string | boolean };

/**
 * Why a subscription cannot be used (internal: always caught in readBatch ⇒ the visible poll fallback / an error read; never
 * reaches a user as an error — its text becomes the redacted modeReason).
 */
export class SafetyPlcSubscriptionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SafetyPlcSubscriptionRefused";
  }
}

/** Queue size requested per item: every change of one publishing interval at the sampling rate, + margin; [10, 100]. */
export function opcuaQueueSizeFor(intervalMs: number): number {
  return Math.min(100, Math.max(10, Math.ceil(intervalMs / SAFETY_PLC_OPCUA_SAMPLING_MS) + 4));
}

/** The publishing interval requested for a poll interval (U fix 1, I2): never above SAFETY_PLC_OPCUA_PUBLISHING_MAX_MS. */
export function opcuaPublishingIntervalFor(pollIntervalMs: number): number {
  return Math.max(50, Math.min(SAFETY_PLC_OPCUA_PUBLISHING_MAX_MS, Math.round(pollIntervalMs)));
}

/** No data and no keep-alive for longer than this ⇒ dead (2 missed keep-alives + slack), capped (U fix 1, I2). */
export function opcuaDeadAfterMs(publishingIntervalMs: number, keepAliveCount: number): number {
  const p = Number.isFinite(publishingIntervalMs) && publishingIntervalMs > 0 ? publishingIntervalMs : 1000;
  const k = Number.isFinite(keepAliveCount) && keepAliveCount > 0 ? keepAliveCount : SAFETY_PLC_OPCUA_KEEPALIVE_COUNT;
  return Math.min(SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS, Math.max(2000, 2 * p * k + 1000));
}

interface Live {
  driver: QueuedSubscriptionDriver;
  handle: OpcuaQueuedSubscription;
  deadAfterMs: number;
  publishingMs: number;
  lastAliveAt: number;
  dead: string | null;
  verifyDueAt: number;
  /** a verification mismatch waiting for its confirmation (one publishing interval later) */
  mismatchSince: number | null;
}

const sleepUnref = (ms: number) =>
  new Promise<void>((r) => {
    const t = setTimeout(r, Math.max(0, ms));
    t.unref?.();
  });

/** p, or the fallback value once `ms` elapsed (never rejects when p rejects: the rejection is the caller's to map). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((r) => {
      t = setTimeout(() => r(fallback), Math.max(1, ms));
      t.unref?.();
    }),
  ]).finally(() => clearTimeout(t));
}

export class OpcuaSubscriptionSafetyPlcBackend extends OtReadSafetyPlcBackend {
  private live: Live | null = null;
  private subscribing: Promise<void> | null = null;
  private releasing: Promise<void> | null = null;
  private retryAt = 0;
  private mode: "subscription" | "poll_fallback" = "subscription";
  private modeReason: string | undefined;
  private readonly current = new Map<Key, Val>();
  private readonly pendingInitial = new Set<Key>();
  private buffer: SafetyPlcCheckedRead[] = [];
  private hbChanges = 0;
  private lost = 0;
  private closed = false;
  private readonly publishingMs: number;
  private readonly makeDriver: () => QueuedSubscriptionDriver;
  private readonly now: () => number;
  private readonly queueSize: number;

  constructor(
    endpoint: string,
    statusMap: SafetyPlcStatusMap,
    timeoutMs: number,
    /**
     * queueSize: a test seam only (the poller never passes it; it requests opcuaQueueSizeFor(publishing interval)).
     * now: a test seam only — MUST be monotonic (default: performance.now, U fix 2 N1); never the wall clock.
     */
    opts: { intervalMs: number; createDriver?: () => QueuedSubscriptionDriver; now?: () => number; queueSize?: number },
  ) {
    super("opcua", endpoint, statusMap, timeoutMs);
    this.publishingMs = opcuaPublishingIntervalFor(opts.intervalMs);
    this.makeDriver = opts.createDriver ?? (() => createDriver("opcua") as unknown as QueuedSubscriptionDriver);
    this.now = opts.now ?? monotonicNow; // U fix 2 (N1) — monotonic; a test clock is monotonic by contract
    this.queueSize = opts.queueSize ?? opcuaQueueSizeFor(this.publishingMs);
  }

  /** The mode of the LAST readBatch (what the Safety page shows). */
  readMode(): "subscription" | "poll_fallback" {
    return this.mode;
  }

  /** U fix 1 (M1) — the whole readBatch fits in 90 % of the poller's read bound (its race never drops a finished batch). */
  private budgetMs(): number {
    return Math.max(100, Math.floor(this.timeoutMs * 0.9));
  }

  private monitored(): Array<{ key: Key; tag: OtTagAddress }> {
    const out: Array<{ key: Key; tag: OtTagAddress }> = this.tagList().map((t) => ({ key: t.flag, tag: t.tag }));
    const latch = this.latchTag();
    if (latch) out.push({ key: "estopLatch", tag: latch });
    const hb = this.heartbeatTag();
    if (hb) out.push({ key: "heartbeat", tag: hb });
    return out;
  }

  /** The current state as one checked read (missing / bad ⇒ unreadable). */
  private snapshot(): SafetyPlcCheckedRead {
    const status: SafetyPlcStatusSnapshot = {};
    const unreadable: SafetyPlcCheckedRead["unreadable"] = [];
    for (const { flag } of this.tagList()) {
      const v = this.current.get(flag);
      if (typeof v === "boolean") status[flag] = v;
      else unreadable.push(flag);
    }
    const r: SafetyPlcCheckedRead = { status, unreadable };
    if (this.latchTag()) {
      const v = this.current.get("estopLatch");
      r.latch = typeof v === "boolean" ? { estopLatch: v, unreadable: false } : { unreadable: true };
    }
    if (this.heartbeatTag()) {
      const v = this.current.get("heartbeat");
      r.heartbeat = v && typeof v === "object" ? { value: v.hb, unreadable: false } : { unreadable: true };
    }
    return r;
  }

  private decide(key: Key, s: OtSample): Val {
    if (key === "heartbeat") {
      const h = decideHeartbeat(s);
      return h.unreadable || h.value === undefined ? "bad" : { hb: h.value };
    }
    if (s.quality !== "good") return "bad";
    const v = strictBool(s.value);
    if (v === undefined) return "bad";
    const ref = key === "estopLatch" ? this.statusMap.estopLatch : this.statusMap[key];
    return ref?.activeWhen === "falsy" ? !v : v;
  }

  private sinkFor(token: { live: Live | null }, keys: Map<string, Key>): OpcuaQueuedSink {
    const mine = () => token.live != null && token.live === this.live;
    return {
      onValue: (tagKey, sample, info) => {
        if (!mine()) return;
        token.live!.lastAliveAt = this.now();
        const key = keys.get(tagKey);
        if (!key) return;
        if (info.overflow && key !== "heartbeat") this.lost += 1; // the server's queue overflowed: ≥ 1 change of this item lost
        const v = this.decide(key, sample);
        const before = this.current.get(key);
        this.current.set(key, v);
        if (this.pendingInitial.size > 0) {
          this.pendingInitial.delete(key);
          if (this.pendingInitial.size > 0) return; // not every item has its initial value yet
          this.buffer.push(this.snapshot());
          return;
        }
        if (key === "heartbeat") {
          // a heartbeat change is liveness, not a transition: counted (U fix 1, I4), never a buffered read
          if (JSON.stringify(before) !== JSON.stringify(v) || info.overflow) this.hbChanges += 1;
          return;
        }
        this.buffer.push(this.snapshot());
        if (this.buffer.length > SAFETY_PLC_OPCUA_BUFFER_MAX) {
          this.buffer.shift();
          this.lost += 1;
        }
      },
      onAlive: () => {
        if (mine()) token.live!.lastAliveAt = this.now();
      },
      onLost: (n) => {
        if (mine()) this.lost += Math.max(1, Math.min(1_000_000, Math.floor(n)));
      },
      onDead: (why) => {
        if (mine() && token.live!.dead == null) token.live!.dead = String(why).slice(0, 200);
      },
    };
  }

  /** Create the subscription within `budgetMs`; throws with the reason when it cannot be used (⇒ fallback). */
  private async subscribe(budgetMs: number): Promise<void> {
    const entries = this.monitored();
    if (entries.length === 0) throw new SafetyPlcSubscriptionRefused("no status tag mapped");
    const driver = this.makeDriver();
    if (typeof driver.subscribeQueued !== "function") throw new SafetyPlcSubscriptionRefused("driver cannot create queued subscriptions");
    // U fix 2 (re-review N2) — the verification read is the ALWAYS-ON item-liveness check: a driver without it is refused
    if (typeof driver.readTags !== "function") throw new SafetyPlcSubscriptionRefused("driver cannot verify the subscribed items (no read on the session)");
    const token: { live: Live | null } = { live: null };
    let handle: OpcuaQueuedSubscription | null = null;
    let connectP: Promise<void> | null = null;
    let subP: Promise<OpcuaQueuedSubscription> | null = null;
    // the bounds of THIS attempt run on real time (the injected clock drives liveness / retry decisions only)
    const deadline = monotonicNow() + budgetMs;
    const left = () => Math.max(1, deadline - monotonicNow());
    const bounded = <T>(p: Promise<T>, what: string): Promise<T> => {
      let t: NodeJS.Timeout | undefined;
      return Promise.race([
        p,
        new Promise<T>((_, rej) => {
          t = setTimeout(() => rej(new SafetyPlcSubscriptionRefused(`${what} exceeded ${budgetMs} ms`)), left());
          t.unref?.();
        }),
      ]).finally(() => clearTimeout(t));
    };
    const keys = new Map(entries.map((e) => [e.tag.tagKey, e.key]));
    this.current.clear();
    this.pendingInitial.clear();
    for (const e of entries) this.pendingInitial.add(e.key);
    this.buffer = [];
    this.hbChanges = 0;
    try {
      connectP = driver.connect({ endpoint: this.endpoint, timeoutMs: budgetMs });
      await bounded(connectP, "opcua connect");
      // the token is armed BEFORE the items exist: initial values may arrive while subscribeQueued is still resolving
      token.live = {
        driver,
        handle: { publishingIntervalMs: this.publishingMs, maxKeepAliveCount: SAFETY_PLC_OPCUA_KEEPALIVE_COUNT, items: [], close: async () => undefined },
        deadAfterMs: opcuaDeadAfterMs(this.publishingMs, SAFETY_PLC_OPCUA_KEEPALIVE_COUNT),
        publishingMs: this.publishingMs,
        lastAliveAt: this.now(),
        dead: null,
        verifyDueAt: this.now() + SAFETY_PLC_OPCUA_VERIFY_MS,
        mismatchSince: null,
      };
      this.live = token.live;
      subP = driver.subscribeQueued(
        entries.map((e) => e.tag),
        { publishingIntervalMs: this.publishingMs, samplingIntervalMs: SAFETY_PLC_OPCUA_SAMPLING_MS, queueSize: this.queueSize, maxKeepAliveCount: SAFETY_PLC_OPCUA_KEEPALIVE_COUNT },
        this.sinkFor(token, keys),
      );
      handle = await bounded(subP, "opcua subscribe");
      token.live.handle = handle;
      token.live.publishingMs = handle.publishingIntervalMs;
      token.live.deadAfterMs = opcuaDeadAfterMs(handle.publishingIntervalMs, handle.maxKeepAliveCount);
      const bad = handle.items.filter((i) => !i.ok);
      if (bad.length) throw new SafetyPlcSubscriptionRefused(`monitored item(s) refused: ${bad.map((i) => `${i.tagKey} ${i.statusCode ?? ""}`.trim()).join(", ")}`);
      // U fix 1 (I2) — the server's REVISED publishing interval / keep-alive window must keep a silent subscription detectable
      // within SAFETY_PLC_OPCUA_DEAD_AFTER_MAX_MS; beyond ⇒ refused (visible fallback), never a stretched blind window
      if (!(handle.publishingIntervalMs > 0 && handle.publishingIntervalMs <= SAFETY_PLC_OPCUA_MAX_REVISED_PUBLISHING_MS)) {
        throw new SafetyPlcSubscriptionRefused(`server revised the publishing interval to ${handle.publishingIntervalMs} ms (max ${SAFETY_PLC_OPCUA_MAX_REVISED_PUBLISHING_MS} ms)`);
      }
      const window = handle.publishingIntervalMs * handle.maxKeepAliveCount;
      if (!(handle.maxKeepAliveCount >= 1 && window <= SAFETY_PLC_OPCUA_MAX_KEEPALIVE_WINDOW_MS)) {
        throw new SafetyPlcSubscriptionRefused(`server revised the keep-alive window to ${window} ms (max ${SAFETY_PLC_OPCUA_MAX_KEEPALIVE_WINDOW_MS} ms) — a silent subscription would go unnoticed too long`);
      }
      const slow = handle.items.filter((i) => !(i.samplingIntervalMs >= 0 && i.samplingIntervalMs <= SAFETY_PLC_OPCUA_MAX_SAMPLING_MS));
      if (slow.length) throw new SafetyPlcSubscriptionRefused(`server revised the sampling interval above ${SAFETY_PLC_OPCUA_MAX_SAMPLING_MS} ms (${slow.map((i) => `${i.tagKey}=${i.samplingIntervalMs}`).join(", ")}) — short presses could be missed`);
      const small = handle.items.filter((i) => !(i.queueSize >= 2));
      if (small.length) throw new SafetyPlcSubscriptionRefused(`server revised the queue size below 2 (${small.map((i) => `${i.tagKey}=${i.queueSize}`).join(", ")}) — short presses could be lost`);
      // the initial value of every item (a compliant server sends it in the first publish)
      while (this.pendingInitial.size > 0) {
        if (token.live.dead) throw new SafetyPlcSubscriptionRefused(token.live.dead);
        if (monotonicNow() >= deadline) throw new SafetyPlcSubscriptionRefused(`no initial value for ${[...this.pendingInitial].join(", ")} within ${budgetMs} ms`);
        await sleepUnref(Math.min(20, left()));
      }
    } catch (e) {
      this.live = null;
      token.live = null;
      this.current.clear();
      this.pendingInitial.clear();
      this.buffer = [];
      // a connect / subscribe that outlived its bound is released when it settles (no session left behind); the caller
      // awaits this (bounded) before any fallback read opens another session
      if (handle) this.releasing = this.release(driver, handle);
      else if (subP) this.releasing = subP.then((h) => this.release(driver, h), () => this.release(driver, null));
      else if (connectP) this.releasing = connectP.then(() => this.release(driver, null), () => undefined);
      else this.releasing = this.release(driver, null);
      throw e;
    }
  }

  private async release(driver: QueuedSubscriptionDriver | null, handle: OpcuaQueuedSubscription | null): Promise<void> {
    const step = (p: () => Promise<unknown>) => within(Promise.resolve().then(p).catch(() => undefined), 2000, undefined);
    if (handle) await step(() => handle.close());
    if (driver) await step(() => driver.disconnect());
  }

  private teardown(): void {
    const l = this.live;
    this.live = null;
    this.current.clear();
    this.pendingInitial.clear();
    this.buffer = [];
    this.hbChanges = 0;
    if (l) this.releasing = this.release(l.driver, l.handle);
  }

  private takeLost(): number {
    const n = this.lost;
    this.lost = 0;
    return n;
  }

  /** The buffered reads (or the current state), the heartbeat change count attached to the LAST one. */
  private takeReads(): SafetyPlcCheckedRead[] {
    const reads = this.buffer.splice(0);
    if (!reads.length) reads.push(this.snapshot());
    const last = reads[reads.length - 1];
    if (last.heartbeat) last.heartbeat = { ...last.heartbeat, changes: this.hbChanges };
    this.hbChanges = 0;
    return reads;
  }

  /**
   * U fix 1 (I4) — the verification read on the open session: undefined = consistent (or not due); a string = why the
   * subscription can no longer be trusted (stalled item confirmed, or the read failed).
   */
  private async verify(l: Live): Promise<string | undefined> {
    const now = this.now();
    if (now < l.verifyDueAt) return undefined;
    const entries = this.monitored().filter((e) => e.key !== "heartbeat");
    if (typeof l.driver.readTags !== "function") return "driver cannot verify the subscribed items"; // U fix 2 (N2): fail closed, never skipped
    if (entries.length === 0) {
      l.verifyDueAt = now + SAFETY_PLC_OPCUA_VERIFY_MS;
      return undefined;
    }
    let samples: OtSample[] | null;
    try {
      samples = await within(l.driver.readTags(entries.map((e) => e.tag)), Math.min(SAFETY_PLC_OPCUA_VERIFY_TIMEOUT_MS, Math.floor(this.budgetMs() / 2)), null);
    } catch (e) {
      return `verification read failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
    }
    if (samples == null) return `verification read exceeded ${SAFETY_PLC_OPCUA_VERIFY_TIMEOUT_MS} ms`;
    if (this.live !== l) return undefined; // torn down meanwhile
    const byKey = new Map(samples.map((s) => [s.tagKey, s]));
    // U fix 2 (re-review N3, security scan "fail-open-state-drift") — a fresh read that is NOT decided (bad / uncertain / missing /
    // unparseable) for an item the subscription still shows as DECIDED is a mismatch at once: the cached value is never kept as
    // current (the item goes unknown ⇒ error read ⇒ "plc_offline"), and the session is re-baselined (torn down + re-subscribed).
    const notDecided: FlagKey[] = [];
    const differs = entries.filter((e) => {
      const sub = this.current.get(e.key);
      if (typeof sub !== "boolean") return false; // the subscription already shows it unknown (fail closed already)
      const s = byKey.get(e.tag.tagKey);
      const read = s ? this.decide(e.key, s) : "bad";
      if (typeof read !== "boolean") {
        notDecided.push(e.key as FlagKey);
        return false;
      }
      return read !== sub; // a decided value the subscription does not show
    });
    if (notDecided.length > 0) {
      for (const k of notDecided) this.current.set(k, "bad");
      return `verification read of ${notDecided.join(", ")} not decided (bad / uncertain / missing) while the subscription still showed a value — item(s) set unknown, re-baselined`;
    }
    if (differs.length === 0) {
      l.mismatchSince = null;
      l.verifyDueAt = now + SAFETY_PLC_OPCUA_VERIFY_MS;
      return undefined;
    }
    if (l.mismatchSince == null) {
      // maybe a change in flight (sampled, not yet published): look again one publishing interval (+ slack) later
      l.mismatchSince = now;
      l.verifyDueAt = now + l.publishingMs + 500;
      return undefined;
    }
    return `monitored item(s) stalled: ${differs.map((e) => e.key).join(", ")} read differently from the subscription for ${now - l.mismatchSince} ms`;
  }

  /** One batch for the poller (never throws: failures are error reads). */
  async readBatch(): Promise<SafetyPlcBatch> {
    if (this.closed) return { mode: this.mode, reads: [{ error: "backend closed" }], lost: 0 };
    const started = monotonicNow();
    const budget = this.budgetMs();
    const leftMs = () => budget - (monotonicNow() - started);
    const l = this.live;
    if (l) {
      const silentFor = this.now() - l.lastAliveAt;
      let why: string | undefined = l.dead ?? (silentFor > l.deadAfterMs ? `subscription silent for ${silentFor} ms (no data, no keep-alive; bound ${l.deadAfterMs} ms)` : undefined);
      let stalled = false;
      if (!why) {
        why = await this.verify(l);
        stalled = why != null;
      }
      if (why) {
        const kept = stalled ? this.buffer.splice(0) : []; // changes observed before the stall are real: kept, in order
        if (stalled) this.lost += 1; // what the stalled item did meanwhile is unknown
        this.teardown();
        this.retryAt = 0; // re-subscribe at the next read
        this.mode = "subscription";
        this.modeReason = why;
        return { mode: "subscription", modeReason: why, reads: [...kept, { error: `OPC-UA subscription lost: ${why}` }], lost: this.takeLost() };
      }
      return { mode: "subscription", reads: this.takeReads(), lost: this.takeLost() };
    }
    // U fix 1 (M1) — a previous attempt's / a torn-down session is released BEFORE anything opens another one
    if (this.releasing) {
      const done = await within(this.releasing.then(() => true), Math.max(1, Math.floor(budget / 4)), false);
      if (!done) return { mode: this.mode, modeReason: this.modeReason, reads: [{ error: "previous OPC-UA session still closing" }], lost: 0 };
      this.releasing = null;
    }
    if (this.now() >= this.retryAt) {
      try {
        this.subscribing ??= this.subscribe(Math.max(50, Math.floor(budget / 2))).finally(() => {
          this.subscribing = null;
        });
        await this.subscribing;
        this.mode = "subscription";
        this.modeReason = undefined;
        return { mode: "subscription", reads: this.takeReads(), lost: this.takeLost() };
      } catch (e) {
        this.retryAt = this.now() + SAFETY_PLC_OPCUA_RESUBSCRIBE_MS;
        this.mode = "poll_fallback";
        this.modeReason = `subscription unavailable: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      }
      const rel = this.releasing as Promise<void> | null; // set by the failed attempt (TS cannot see it through the await)
      if (rel) {
        const done = await within(rel.then(() => true), Math.max(1, Math.floor(leftMs() / 2)), false);
        if (!done) return { mode: "poll_fallback", modeReason: this.modeReason, reads: [{ error: "subscription attempt still closing — no second session opened" }], lost: 0 };
        this.releasing = null;
      }
    }
    // fallback: the inherited, fail-closed poll read (connect / read / disconnect), within what is left of the budget
    this.mode = "poll_fallback";
    try {
      const r = await this.readChecked({ withLatch: true, withHeartbeat: true, timeoutMs: Math.max(50, Math.floor(leftMs())) });
      return { mode: "poll_fallback", modeReason: this.modeReason, reads: [r], lost: 0 };
    } catch (e) {
      return { mode: "poll_fallback", modeReason: this.modeReason, reads: [{ error: `read failed: ${String((e as Error)?.message ?? e).slice(0, 200)}` }], lost: 0 };
    }
  }

  /** Release the session (poller: config dropped / leadership lost / stopped). Idempotent; bounded. */
  async close(): Promise<void> {
    this.closed = true;
    const l = this.live;
    this.live = null;
    if (l) await this.release(l.driver, l.handle);
    if (this.releasing) await within(this.releasing, 2500, undefined);
  }
}
