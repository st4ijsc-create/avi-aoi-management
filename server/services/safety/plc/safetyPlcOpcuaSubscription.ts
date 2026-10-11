/**
 * doc 81 Đợt 9 task U1 — OPC-UA safety-PLC configs are read through a SUBSCRIPTION with QUEUED monitored items instead of
 * a poll, so a press and a release inside one interval are BOTH seen (owner decision 2026-10-12, "short e-stop presses").
 *
 * READ-ONLY (L-7): it monitors the Value attribute of the config's status tags (and the U2 latch tag, if mapped) through
 * OpcuaDriver.subscribeQueued; it never writes. It is still an OtReadSafetyPlcBackend (same trust class, same tag map), so
 * the poller's trusted-door / maker-checker rules apply unchanged, and its fallback IS the inherited poll read.
 *
 * Per poll the poller asks readBatch():
 *   • subscription alive ⇒ every value change queued since the last call, IN ORDER, each as a full checked read (a press
 *     + release ⇒ two reads ⇒ two transitions); no change ⇒ the current state (a fully decided read keeps health fresh);
 *   • lost value changes — the server's OVERFLOW bit (its queue was full), a gap in the notification sequence numbers, or
 *     this buffer's own bound — are COUNTED (`lost`) ⇒ the poller records one "plc_events_lost" marker first;
 *   • subscription dead (terminated / bad status / link lost) or SILENT (no data and no keep-alive for deadAfterMs) ⇒ an
 *     error read (⇒ "plc_offline"; never "ok", never "released"), the session is torn down and the next call re-subscribes;
 *   • subscription impossible (create fails, the server revised a queue below 2 or a sampling interval above
 *     SAFETY_PLC_OPCUA_MAX_SAMPLING_MS, an item could not be created, no initial values) ⇒ mode "poll_fallback": the inherited connect / read / disconnect poll (short presses may be missed — shown
 *     on the Safety page), re-trying the subscription every SAFETY_PLC_OPCUA_RESUBSCRIBE_MS.
 * Undecidable is never "ok": every failure path yields an error read or the fallback poll, which is itself fail-closed.
 * Memory: ≤ SAFETY_PLC_OPCUA_BUFFER_MAX buffered reads per config (beyond: oldest dropped and counted as lost).
 * Connections: ONE session per PLC while subscribed (the actuation preflight opens its own — each PLC needs ≥ 2 clients).
 */
import type { SafetyPlcStatusMap, SafetyPlcStatusSnapshot } from "../../../../drizzle/schema";
import type { OtSample, OtTagAddress } from "../../ot/otDriver";
import type { OpcuaQueuedSink, OpcuaQueuedSubscription } from "../../ot/drivers/opcuaDriver";
import { createDriver } from "../../ot/driverRegistry";
import { OtReadSafetyPlcBackend, strictBool, type SafetyPlcCheckedRead } from "./safetyPlcAdapter";

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

/** The read mode a poller config reports (persisted in safety_plc_poll_state.readMode — migration 0371). */
export type SafetyPlcReadMode = "subscription" | "poll_fallback" | "poll" | "poll_latch" | "sim";

/** One readBatch() answer. */
export interface SafetyPlcBatch {
  mode: "subscription" | "poll_fallback";
  /** Why the subscription is not in use (fallback) / was lost — redacted by the poller before any note. */
  modeReason?: string;
  reads: Array<SafetyPlcCheckedRead | { error: string }>;
  /** Value changes known to be LOST since the last call (overflow bit, sequence gap, buffer bound). */
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
}

type Key = keyof SafetyPlcStatusSnapshot | "estopLatch";

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

/** No data and no keep-alive for longer than this ⇒ the subscription is dead (2 missed keep-alives + slack). */
export function opcuaDeadAfterMs(publishingIntervalMs: number, keepAliveCount: number): number {
  const p = Number.isFinite(publishingIntervalMs) && publishingIntervalMs > 0 ? publishingIntervalMs : 1000;
  const k = Number.isFinite(keepAliveCount) && keepAliveCount > 0 ? keepAliveCount : SAFETY_PLC_OPCUA_KEEPALIVE_COUNT;
  return Math.max(2000, 2 * p * k + 1000);
}

interface Live {
  driver: QueuedSubscriptionDriver;
  handle: OpcuaQueuedSubscription;
  deadAfterMs: number;
  lastAliveAt: number;
  dead: string | null;
}

export class OpcuaSubscriptionSafetyPlcBackend extends OtReadSafetyPlcBackend {
  private live: Live | null = null;
  private subscribing: Promise<void> | null = null;
  private retryAt = 0;
  private mode: "subscription" | "poll_fallback" = "subscription";
  private modeReason: string | undefined;
  private readonly current = new Map<Key, boolean | "bad">();
  private readonly pendingInitial = new Set<Key>();
  private buffer: SafetyPlcCheckedRead[] = [];
  private lost = 0;
  private closed = false;
  private readonly intervalMs: number;
  private readonly makeDriver: () => QueuedSubscriptionDriver;
  private readonly now: () => number;
  private readonly queueSize: number;

  constructor(
    endpoint: string,
    statusMap: SafetyPlcStatusMap,
    timeoutMs: number,
    /** queueSize: a test seam only (the poller never passes it; it requests opcuaQueueSizeFor(intervalMs)). */
    opts: { intervalMs: number; createDriver?: () => QueuedSubscriptionDriver; now?: () => number; queueSize?: number },
  ) {
    super("opcua", endpoint, statusMap, timeoutMs);
    this.intervalMs = opts.intervalMs;
    this.makeDriver = opts.createDriver ?? (() => createDriver("opcua") as unknown as QueuedSubscriptionDriver);
    this.now = opts.now ?? Date.now;
    this.queueSize = opts.queueSize ?? opcuaQueueSizeFor(opts.intervalMs);
  }

  /** The mode of the LAST readBatch (what the Safety page shows). */
  readMode(): "subscription" | "poll_fallback" {
    return this.mode;
  }

  private monitored(): Array<{ key: Key; tag: OtTagAddress }> {
    const out: Array<{ key: Key; tag: OtTagAddress }> = this.tagList().map((t) => ({ key: t.flag, tag: t.tag }));
    const latch = this.latchTag();
    if (latch) out.push({ key: "estopLatch", tag: latch });
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
    return r;
  }

  private decide(key: Key, s: OtSample): boolean | "bad" {
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
        if (info.overflow) this.lost += 1; // the server's queue overflowed: ≥ 1 change of this item lost
        this.current.set(key, this.decide(key, sample));
        if (this.pendingInitial.size > 0) {
          this.pendingInitial.delete(key);
          if (this.pendingInitial.size > 0) return; // not every item has its initial value yet
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

  /** Create the subscription (bounded); throws with the reason when it cannot be used (⇒ fallback). */
  private async subscribe(): Promise<void> {
    const entries = this.monitored();
    if (entries.length === 0) throw new SafetyPlcSubscriptionRefused("no status tag mapped");
    const driver = this.makeDriver();
    if (typeof driver.subscribeQueued !== "function") throw new SafetyPlcSubscriptionRefused("driver cannot create queued subscriptions");
    const token: { live: Live | null } = { live: null };
    let handle: OpcuaQueuedSubscription | null = null;
    let connectP: Promise<void> | null = null;
    let subP: Promise<OpcuaQueuedSubscription> | null = null;
    // the bounds of THIS attempt run on real time (the injected clock drives liveness / retry decisions only)
    const deadline = Date.now() + this.timeoutMs;
    const left = () => Math.max(1, deadline - Date.now());
    const bounded = <T>(p: Promise<T>, what: string): Promise<T> => {
      let t: NodeJS.Timeout | undefined;
      return Promise.race([
        p,
        new Promise<T>((_, rej) => {
          t = setTimeout(() => rej(new Error(`${what} exceeded ${this.timeoutMs} ms`)), left());
          t.unref?.();
        }),
      ]).finally(() => clearTimeout(t));
    };
    const keys = new Map(entries.map((e) => [e.tag.tagKey, e.key]));
    this.current.clear();
    this.pendingInitial.clear();
    for (const e of entries) this.pendingInitial.add(e.key);
    this.buffer = [];
    try {
      connectP = driver.connect({ endpoint: this.endpoint, timeoutMs: this.timeoutMs });
      await bounded(connectP, "opcua connect");
      const queueSize = this.queueSize;
      // the token is armed BEFORE the items exist: initial values may arrive while subscribeQueued is still resolving
      token.live = { driver, handle: { publishingIntervalMs: this.intervalMs, maxKeepAliveCount: SAFETY_PLC_OPCUA_KEEPALIVE_COUNT, items: [], close: async () => undefined }, deadAfterMs: opcuaDeadAfterMs(this.intervalMs, SAFETY_PLC_OPCUA_KEEPALIVE_COUNT), lastAliveAt: this.now(), dead: null };
      this.live = token.live;
      subP = driver.subscribeQueued(
          entries.map((e) => e.tag),
          { publishingIntervalMs: this.intervalMs, samplingIntervalMs: SAFETY_PLC_OPCUA_SAMPLING_MS, queueSize, maxKeepAliveCount: SAFETY_PLC_OPCUA_KEEPALIVE_COUNT },
          this.sinkFor(token, keys),
      );
      handle = await bounded(subP, "opcua subscribe");
      token.live.handle = handle;
      token.live.deadAfterMs = opcuaDeadAfterMs(handle.publishingIntervalMs, handle.maxKeepAliveCount);
      const bad = handle.items.filter((i) => !i.ok);
      if (bad.length) throw new SafetyPlcSubscriptionRefused(`monitored item(s) refused: ${bad.map((i) => `${i.tagKey} ${i.statusCode ?? ""}`.trim()).join(", ")}`);
      const slow = handle.items.filter((i) => !(i.samplingIntervalMs >= 0 && i.samplingIntervalMs <= SAFETY_PLC_OPCUA_MAX_SAMPLING_MS));
      if (slow.length) throw new SafetyPlcSubscriptionRefused(`server revised the sampling interval above ${SAFETY_PLC_OPCUA_MAX_SAMPLING_MS} ms (${slow.map((i) => `${i.tagKey}=${i.samplingIntervalMs}`).join(", ")}) — short presses could be missed`);
      const small = handle.items.filter((i) => !(i.queueSize >= 2));
      if (small.length) throw new SafetyPlcSubscriptionRefused(`server revised the queue size below 2 (${small.map((i) => `${i.tagKey}=${i.queueSize}`).join(", ")}) — short presses could be lost`);
      // the initial value of every item (a compliant server sends it in the first publish)
      while (this.pendingInitial.size > 0) {
        if (token.live.dead) throw new SafetyPlcSubscriptionRefused(token.live.dead);
        if (Date.now() >= deadline) throw new SafetyPlcSubscriptionRefused(`no initial value for ${[...this.pendingInitial].join(", ")} within ${this.timeoutMs} ms`);
        await new Promise((r) => setTimeout(r, Math.min(20, left())));
      }
    } catch (e) {
      this.live = null;
      token.live = null;
      this.current.clear();
      this.pendingInitial.clear();
      this.buffer = [];
      // a connect / subscribe that outlived its bound is released when it settles (no session left behind)
      if (handle) void this.release(driver, handle);
      else if (subP) void subP.then((h) => this.release(driver, h), () => this.release(driver, null));
      else if (connectP) void connectP.then(() => this.release(driver, null), () => undefined);
      else void this.release(driver, null);
      throw e;
    }
  }

  private async release(driver: QueuedSubscriptionDriver | null, handle: OpcuaQueuedSubscription | null): Promise<void> {
    const step = (p: () => Promise<unknown>) =>
      Promise.race([Promise.resolve().then(p).catch(() => undefined), new Promise((r) => setTimeout(r, 2000).unref?.())]);
    if (handle) await step(() => handle.close());
    if (driver) await step(() => driver.disconnect());
  }

  private teardown(): void {
    const l = this.live;
    this.live = null;
    this.current.clear();
    this.pendingInitial.clear();
    this.buffer = [];
    if (l) void this.release(l.driver, l.handle);
  }

  private takeLost(): number {
    const n = this.lost;
    this.lost = 0;
    return n;
  }

  /** One batch for the poller (never throws: failures are error reads). */
  async readBatch(): Promise<SafetyPlcBatch> {
    if (this.closed) return { mode: this.mode, reads: [{ error: "backend closed" }], lost: 0 };
    const l = this.live;
    if (l) {
      const silentFor = this.now() - l.lastAliveAt;
      if (l.dead || silentFor > l.deadAfterMs) {
        const why = l.dead ?? `subscription silent for ${silentFor} ms (no data, no keep-alive; bound ${l.deadAfterMs} ms)`;
        this.teardown();
        this.retryAt = 0; // re-subscribe at the next read
        this.mode = "subscription";
        this.modeReason = why;
        return { mode: "subscription", modeReason: why, reads: [{ error: `OPC-UA subscription lost: ${why}` }], lost: this.takeLost() };
      }
      const reads = this.buffer.splice(0);
      return { mode: "subscription", reads: reads.length ? reads : [this.snapshot()], lost: this.takeLost() };
    }
    if (this.now() >= this.retryAt) {
      try {
        this.subscribing ??= this.subscribe().finally(() => {
          this.subscribing = null;
        });
        await this.subscribing;
        this.mode = "subscription";
        this.modeReason = undefined;
        const reads = this.buffer.splice(0);
        return { mode: "subscription", reads: reads.length ? reads : [this.snapshot()], lost: this.takeLost() };
      } catch (e) {
        this.retryAt = this.now() + SAFETY_PLC_OPCUA_RESUBSCRIBE_MS;
        this.mode = "poll_fallback";
        this.modeReason = `subscription unavailable: ${String((e as Error)?.message ?? e).slice(0, 200)}`;
      }
    }
    // fallback: the inherited, fail-closed poll read (connect / read / disconnect)
    this.mode = "poll_fallback";
    try {
      const r = await this.readChecked({ withLatch: true });
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
  }
}
