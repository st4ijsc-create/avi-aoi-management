/**
 * doc 81 Đợt 12 task P — otStopEpochSync without a database: an in-memory LISTEN/NOTIFY bus stands in for the postgres client
 * (the real NOTIFY path is stopEpochCrossReplica.dot12.db.test.ts). Covers: strict payloads, own-origin ignore, the broadcast never
 * on the STOP's path (synchronous bump, hanging NOTIFY bounded), LISTEN failure / hang at boot (bounded, alert, retry), heartbeat
 * loss (alert, re-LISTEN, old subscription inert), a postgres re-LISTEN after a dropped connection (gap alert), the edge role, stop().
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { bumpAdapterStopEpoch, adapterStopEpoch, setStopEpochBroadcaster } from "./otDeviceWrite";
import { startOtStopEpochSync, otStopEpochSyncStatus, parseStopEpochPayload, OT_STOP_EPOCH_ORIGIN, OT_STOP_EPOCH_CHANNEL, type StopEpochSyncAlert } from "./otStopEpochSync";

type Sub = { fn: (p: string) => void; onlisten?: () => void; active: boolean };
function bus() {
  const subs: Sub[] = [];
  const c = {
    subs,
    listenCalls: 0,
    notified: [] as string[],
    /** null ⇒ succeed; else awaited before the LISTEN registers (reject = fail, never-settling = hang) */
    listenGate: null as null | (() => Promise<void>),
    notifyImpl: null as null | ((p: string) => Promise<unknown>),
    loopback: true,
    /** postgres.js-like: unlisten of a subscription that was re-registered after a reconnect does nothing */
    unlistenNoop: false,
    async listen(ch: string, fn: (p: string) => void, onlisten?: () => void) {
      expect(ch).toBe(OT_STOP_EPOCH_CHANNEL);
      c.listenCalls += 1;
      const g = c.listenGate;
      if (g) await g();
      const s: Sub = { fn, onlisten, active: true };
      subs.push(s);
      onlisten?.();
      return {
        unlisten: async () => {
          if (!c.unlistenNoop) s.active = false;
        },
      };
    },
    async notify(ch: string, payload: string) {
      expect(ch).toBe(OT_STOP_EPOCH_CHANNEL);
      c.notified.push(payload);
      if (c.notifyImpl) return c.notifyImpl(payload);
      if (c.loopback) setTimeout(() => c.deliver(payload), 1);
      return [];
    },
    deliver(p: string) {
      for (const s of subs) if (s.active) s.fn(p);
    },
    /** postgres.js re-LISTENs every channel after its LISTEN connection dropped, calling onlisten again */
    reconnect() {
      for (const s of subs) if (s.active) s.onlisten?.();
    },
  };
  return c;
}
const tick = () => new Promise<void>((r) => setImmediate(r));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(2);
  }
  return true;
}
const peer = (adapterId: number, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, kind: "stop", origin: "peer-replica-0001", adapterId, epoch: 7, at: Date.now(), ...extra });

let stopFn: (() => Promise<void>) | null = null;
afterEach(async () => {
  if (stopFn) await stopFn();
  stopFn = null;
  delete process.env.AVI_PROCESS_ROLE;
  setStopEpochBroadcaster(null);
});
async function start(c: ReturnType<typeof bus>, alerts: StopEpochSyncAlert[], o: Record<string, unknown> = {}) {
  stopFn = await startOtStopEpochSync({ client: c, pingMs: 60_000, alert: (a) => void alerts.push(a), ...o });
  return stopFn;
}

describe("parseStopEpochPayload — strict", () => {
  const ok = { v: 1, kind: "stop", origin: "peer-replica-0001", adapterId: 5, epoch: 3, at: 1_700_000_000_000 };
  it("accepts exactly a v1 stop and a v1 ping", () => {
    expect(parseStopEpochPayload(JSON.stringify(ok))).toEqual(ok);
    const p = { v: 1, kind: "ping", origin: "peer-replica-0001", nonce: "abcdefgh-1234", at: 1 };
    expect(parseStopEpochPayload(JSON.stringify(p))).toEqual(p);
  });
  const bad: Array<[string, unknown]> = [
    ["not a string", 5],
    ["empty", ""],
    ["not JSON", "{"],
    ["array", JSON.stringify([ok])],
    ["null", "null"],
    ["extra key", JSON.stringify({ ...ok, x: 1 })],
    ["missing key", JSON.stringify({ v: 1, kind: "stop", origin: ok.origin, adapterId: 5, at: 1 })],
    ["v 2", JSON.stringify({ ...ok, v: 2 })],
    ["v '1'", JSON.stringify({ ...ok, v: "1" })],
    ["unknown kind", JSON.stringify({ ...ok, kind: "clear" })],
    ["adapterId string", JSON.stringify({ ...ok, adapterId: "5" })],
    ["adapterId 0", JSON.stringify({ ...ok, adapterId: 0 })],
    ["adapterId negative", JSON.stringify({ ...ok, adapterId: -5 })],
    ["adapterId float", JSON.stringify({ ...ok, adapterId: 5.5 })],
    ["adapterId > int4", JSON.stringify({ ...ok, adapterId: 2_147_483_648 })],
    ["epoch 0", JSON.stringify({ ...ok, epoch: 0 })],
    ["at missing value", JSON.stringify({ ...ok, at: null })],
    ["origin short", JSON.stringify({ ...ok, origin: "abc" })],
    ["origin bad chars", JSON.stringify({ ...ok, origin: "peer replica 01" })],
    ["origin too long", JSON.stringify({ ...ok, origin: "a".repeat(65) })],
    ["too long payload", JSON.stringify({ ...ok, origin: ok.origin }) + " ".repeat(600)],
    ["ping with adapterId", JSON.stringify({ v: 1, kind: "ping", origin: ok.origin, nonce: "abcdefgh", at: 1, adapterId: 5 })],
    ["ping bad nonce", JSON.stringify({ v: 1, kind: "ping", origin: ok.origin, nonce: "a b", at: 1 })],
    ["__proto__ key", '{"v":1,"kind":"stop","origin":"peer-replica-0001","adapterId":5,"epoch":3,"at":1,"__proto__":{}}'],
  ];
  for (const [name, raw] of bad) it(`rejects: ${name}`, () => expect(parseStopEpochPayload(raw)).toBeNull());
});

describe("otStopEpochSync — send side never on the STOP's path (L-7)", () => {
  it("the bump is synchronous; the NOTIFY starts only on the next macrotask (after the STOP's driver call) and carries {adapterId, epoch, at}", async () => {
    const c = bus();
    await start(c, []);
    const e = bumpAdapterStopEpoch(990_001, { idempotencyKey: "k" });
    expect(c.notified.length).toBe(0); // nothing sent inside the bump
    await tick();
    expect(c.notified.length).toBe(1);
    expect(JSON.parse(c.notified[0])).toMatchObject({ v: 1, kind: "stop", origin: OT_STOP_EPOCH_ORIGIN, adapterId: 990_001, epoch: e });
  });

  it("a NOTIFY that never answers: the bump still returns at once; the send gives up after its deadline (counted)", async () => {
    const c = bus();
    c.notifyImpl = () => new Promise(() => undefined);
    await start(c, [], { notifyDeadlineMs: 30 });
    const failed0 = otStopEpochSyncStatus().notifyFailed;
    const t0 = performance.now();
    bumpAdapterStopEpoch(990_002, null);
    expect(performance.now() - t0).toBeLessThan(5);
    expect(await until(() => otStopEpochSyncStatus().notifyFailed > failed0, 1_000)).toBe(true);
  });

  it("the broadcaster itself is never called inside the bump (only on the next macrotask)", async () => {
    const calls: unknown[] = [];
    setStopEpochBroadcaster((m) => void calls.push(m));
    const e = bumpAdapterStopEpoch(990_004, null);
    await Promise.resolve(); // microtasks drained: still not called
    expect(calls).toEqual([]);
    await tick();
    expect(calls).toEqual([{ adapterId: 990_004, epoch: e, at: expect.any(Number) }]);
  });

  it("a throwing broadcaster never reaches the caller", async () => {
    setStopEpochBroadcaster(() => {
      throw new Error("boom");
    });
    expect(() => bumpAdapterStopEpoch(990_003, null)).not.toThrow();
    await tick();
  });
});

describe("otStopEpochSync — receive side", () => {
  it("a peer STOP bumps this process's epoch once; its own STOP is ignored; malformed payloads are counted and move nothing", async () => {
    const c = bus();
    await start(c, []);
    const s0 = otStopEpochSyncStatus();
    const before = adapterStopEpoch(990_010);
    c.deliver(peer(990_010));
    expect(adapterStopEpoch(990_010)).toBeGreaterThan(before);
    expect(otStopEpochSyncStatus().peerStops).toBe(s0.peerStops + 1);

    const e = bumpAdapterStopEpoch(990_011, null); // own STOP: loops back through the bus
    expect(await until(() => otStopEpochSyncStatus().ignoredOwn > s0.ignoredOwn)).toBe(true);
    expect(adapterStopEpoch(990_011)).toBe(e);

    c.deliver(peer(990_012, { adapterId: "990012" }));
    c.deliver("garbage");
    expect(adapterStopEpoch(990_012)).toBe(0);
    expect(otStopEpochSyncStatus().rejected).toBe(s0.rejected + 2);
  });

  it("a peer STOP carries its identity into the epoch record (ledger: peer, origin) — never a key the peer chose", async () => {
    const c = bus();
    await start(c, []);
    c.deliver(peer(990_013));
    const { stopIssuedSince } = await import("./otDeviceWrite");
    expect(stopIssuedSince(990_013, 0)?.stop).toEqual({ peer: true, origin: "peer-replica-0001", peerEpoch: 7, at: expect.any(Number) });
  });
});

describe("otStopEpochSync — liveness (bounded, alert, reconnect; boot never blocked)", () => {
  it("LISTEN fails at boot: start returns, degraded + ONE lost alert, background retry succeeds → ok + recovered; peer STOPs apply again", async () => {
    const c = bus();
    let n = 0;
    c.listenGate = async () => {
      if (++n <= 2) throw new Error("connection refused");
    };
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts, { retryMs: 20 });
    expect(otStopEpochSyncStatus().state).toBe("degraded");
    expect(alerts.map((a) => a.kind)).toEqual(["lost"]);
    c.deliver(peer(990_020));
    expect(adapterStopEpoch(990_020)).toBe(0); // nothing listens yet: per process
    expect(await until(() => otStopEpochSyncStatus().state === "ok")).toBe(true);
    expect(alerts.map((a) => a.kind)).toEqual(["lost", "recovered"]); // one alert per episode, not per retry
    c.deliver(peer(990_020));
    expect(adapterStopEpoch(990_020)).toBeGreaterThan(0);
  });

  it("LISTEN hangs at boot: start returns within the LISTEN deadline (boot never blocked)", async () => {
    const c = bus();
    let n = 0;
    c.listenGate = () => (++n === 1 ? new Promise<void>(() => undefined) : Promise.resolve());
    const alerts: StopEpochSyncAlert[] = [];
    const t0 = Date.now();
    await start(c, alerts, { listenDeadlineMs: 40, retryMs: 20 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(alerts[0]?.kind).toBe("lost");
    expect(await until(() => otStopEpochSyncStatus().state === "ok")).toBe(true);
  });

  it("heartbeat not received: lost alert, a fresh LISTEN, the old subscription is INERT (no double bump); heartbeat back → recovered", async () => {
    const c = bus();
    c.unlistenNoop = true; // like postgres.js after a reconnect: the old registration cannot be removed
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts, { pingMs: 15, pingDeadlineMs: 25, retryMs: 20 });
    expect(await until(() => otStopEpochSyncStatus().lastPingRttMs !== null)).toBe(true);
    c.loopback = false; // the LISTEN stops receiving
    expect(await until(() => alerts.some((a) => a.kind === "lost"))).toBe(true);
    expect(await until(() => c.listenCalls >= 2)).toBe(true);
    await sleep(60);
    expect(alerts.some((a) => a.kind === "recovered")).toBe(false); // a fresh LISTEN is not proof: the own ping must come back
    expect(otStopEpochSyncStatus().state).toBe("degraded");
    c.loopback = true;
    expect(await until(() => alerts.some((a) => a.kind === "recovered"))).toBe(true);
    const p0 = otStopEpochSyncStatus().peerStops;
    c.deliver(peer(990_030)); // reaches BOTH registrations (old one could not be removed)
    expect(otStopEpochSyncStatus().peerStops).toBe(p0 + 1);
  });

  it("another replica's ping, or a ping with another nonce, is NOT this LISTEN's heartbeat", async () => {
    const c = bus();
    c.loopback = false; // this replica's own pings never come back
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts, { pingMs: 15, pingDeadlineMs: 40, retryMs: 1_000 });
    const t = setInterval(() => {
      c.deliver(JSON.stringify({ v: 1, kind: "ping", origin: "peer-replica-0001", nonce: "nonce-of-peer", at: Date.now() }));
      c.deliver(JSON.stringify({ v: 1, kind: "ping", origin: OT_STOP_EPOCH_ORIGIN, nonce: "not-the-pending-one", at: Date.now() }));
    }, 3);
    try {
      expect(await until(() => alerts.some((a) => a.kind === "lost"))).toBe(true);
    } finally {
      clearInterval(t);
    }
  });

  it("postgres re-LISTENs after a dropped connection (onlisten again): lost + recovered alerts (the gap), reconnects counted", async () => {
    const c = bus();
    const alerts: StopEpochSyncAlert[] = [];
    await start(c, alerts);
    const r0 = otStopEpochSyncStatus().reconnects;
    c.reconnect();
    expect(otStopEpochSyncStatus().reconnects).toBe(r0 + 1);
    expect(alerts.map((a) => a.kind)).toEqual(["lost", "recovered"]);
    expect(alerts[0].reason).toMatch(/dropped/);
  });

  it("stop(): broadcaster removed, LISTEN removed, no more pings", async () => {
    const c = bus();
    const stop = await start(c, [], { pingMs: 10 });
    await sleep(30);
    await stop();
    stopFn = null;
    const sent = c.notified.length;
    bumpAdapterStopEpoch(990_040, null);
    await sleep(40);
    expect(c.notified.length).toBe(sent);
    expect(c.subs.every((s) => !s.active)).toBe(true);
    expect(otStopEpochSyncStatus().state).toBe("off");
  });

  it("the EDGE role: nothing starts (no LISTEN, no broadcast) — the edge has no DB, its epoch stays per process", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    const c = bus();
    await start(c, []);
    bumpAdapterStopEpoch(990_050, null);
    await tick();
    expect(c.listenCalls).toBe(0);
    expect(c.notified.length).toBe(0);
  });
});

describe("otDeviceWrite — the peer adapter cap", () => {
  it("adapters first seen through peers are capped (a NOTIFY flood cannot grow the map without bound); known adapters always bump", async () => {
    vi.resetModules();
    const dw = await import("./otDeviceWrite");
    for (let i = 1; i <= dw.OT_STOP_EPOCH_PEER_ADAPTERS_MAX; i++) expect(dw.bumpAdapterStopEpochFromPeer(i, { peer: true })).not.toBeNull();
    expect(dw.bumpAdapterStopEpochFromPeer(dw.OT_STOP_EPOCH_PEER_ADAPTERS_MAX + 1, { peer: true })).toBeNull();
    const e = dw.adapterStopEpoch(5);
    expect(dw.bumpAdapterStopEpochFromPeer(5, { peer: true })).toBeGreaterThan(e);
  });
});
