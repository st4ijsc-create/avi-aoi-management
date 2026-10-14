/**
 * doc 81 Đợt 12 task P fix 1 (R-12-b, M-1) — the shared pg channel listener, with an in-memory LISTEN/NOTIFY bus (no DB):
 * bounded LISTEN at boot (fail / hang), heartbeat loss ⇒ alert + re-LISTEN + old subscription inert + recovered only on the own ping,
 * a ping that cannot be SENT ⇒ alert but no re-LISTEN, the ping deadline starts after the send (a slow send is not a loss),
 * other listeners' / forged pings never count and never reach the payload handler, a postgres re-LISTEN reported as a gap, stop().
 */
import { describe, it, expect, afterEach } from "vitest";
import { startChannelListener, parseHeartbeat, type ChannelListener, type ChannelListenerAlert } from "./pgChannelListener";

const CH = "test_channel_p";
type Sub = { fn: (p: string) => void; onlisten?: () => void; active: boolean };
function bus() {
  const subs: Sub[] = [];
  const c = {
    subs,
    listenCalls: 0,
    notified: [] as string[],
    listenGate: null as null | (() => Promise<void>),
    notifyImpl: null as null | ((p: string) => Promise<unknown>),
    loopback: true,
    unlistenNoop: false,
    async listen(_ch: string, fn: (p: string) => void, onlisten?: () => void) {
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
    async notify(_ch: string, payload: string) {
      c.notified.push(payload);
      if (c.notifyImpl) return c.notifyImpl(payload);
      if (c.loopback) setTimeout(() => c.deliver(payload), 1);
      return [];
    },
    deliver(p: string) {
      for (const s of subs) if (s.active) s.fn(p);
    },
    reconnect() {
      for (const s of subs) if (s.active) s.onlisten?.();
    },
  };
  return c;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 2_000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) return false;
    await sleep(2);
  }
  return true;
}

let l: ChannelListener | null = null;
afterEach(async () => {
  if (l) await l.stop();
  l = null;
});
async function start(c: ReturnType<typeof bus>, alerts: ChannelListenerAlert[], payloads: string[], o: Record<string, unknown> = {}) {
  l = await startChannelListener({ channel: CH, tag: "Test", onPayload: (p) => void payloads.push(p), listenClient: () => c, notifyClient: () => c, pingMs: 60_000, alert: (a) => void alerts.push(a), lostMeaning: "test.", ...o });
  return l;
}

describe("parseHeartbeat", () => {
  it("exactly {hb:1, listener, nonce}", () => {
    expect(parseHeartbeat(JSON.stringify({ hb: 1, listener: "abcdefgh-1", nonce: "nonce-0001" }))).toEqual({ listener: "abcdefgh-1", nonce: "nonce-0001" });
    expect(parseHeartbeat(JSON.stringify({ hb: 1, listener: "abcdefgh-1", nonce: "nonce-0001", x: 1 }))).toBeNull();
    expect(parseHeartbeat(JSON.stringify({ hb: 2, listener: "abcdefgh-1", nonce: "nonce-0001" }))).toBeNull();
    expect(parseHeartbeat("x")).toBeNull();
  });
});

describe("pgChannelListener", () => {
  it("delivers payloads; heartbeats (own, foreign, malformed) never reach the handler", async () => {
    const c = bus();
    const payloads: string[] = [];
    await start(c, [], payloads);
    c.deliver('{"kind":"robot","id":1,"to":null}');
    c.deliver(JSON.stringify({ hb: 1, listener: "other-listener-1", nonce: "nonce-0001" }));
    c.deliver('{"hb":"x"}');
    expect(payloads).toEqual(['{"kind":"robot","id":1,"to":null}']);
  });

  it("LISTEN fails at boot: start returns, ONE lost alert, background retry → ok + recovered", async () => {
    const c = bus();
    let n = 0;
    c.listenGate = async () => {
      if (++n <= 2) throw new Error("connection refused");
    };
    const alerts: ChannelListenerAlert[] = [];
    const x = await start(c, alerts, [], { retryMs: 20 });
    expect(x.status().state).toBe("degraded");
    expect(alerts.map((a) => a.kind)).toEqual(["lost"]);
    expect(await until(() => x.status().state === "ok")).toBe(true);
    expect(alerts.map((a) => a.kind)).toEqual(["lost", "recovered"]);
  });

  it("LISTEN hangs at boot: start returns within the deadline (boot never blocked)", async () => {
    const c = bus();
    let n = 0;
    c.listenGate = () => (++n === 1 ? new Promise<void>(() => undefined) : Promise.resolve());
    const alerts: ChannelListenerAlert[] = [];
    const t0 = Date.now();
    const x = await start(c, alerts, [], { listenDeadlineMs: 40, retryMs: 20 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(alerts[0]?.kind).toBe("lost");
    expect(await until(() => x.status().state === "ok")).toBe(true);
  });

  it("★ heartbeat not received: lost, fresh LISTEN, old subscription INERT, not recovered until the own ping returns", async () => {
    const c = bus();
    c.unlistenNoop = true;
    const alerts: ChannelListenerAlert[] = [];
    const payloads: string[] = [];
    const x = await start(c, alerts, payloads, { pingMs: 15, pingDeadlineMs: 25, retryMs: 20 });
    expect(await until(() => x.status().lastPingRttMs !== null)).toBe(true);
    c.loopback = false;
    expect(await until(() => alerts.some((a) => a.kind === "lost"))).toBe(true);
    expect(await until(() => c.listenCalls >= 2)).toBe(true);
    await sleep(60);
    expect(alerts.some((a) => a.kind === "recovered")).toBe(false);
    expect(x.status().state).toBe("degraded");
    c.loopback = true;
    expect(await until(() => alerts.some((a) => a.kind === "recovered"))).toBe(true);
    c.deliver('{"kind":"adapter","id":2,"to":null}'); // reaches both registrations: only the live one hands it over
    expect(payloads.filter((p) => p.includes('"id":2'))).toHaveLength(1);
  });

  it("another listener's ping, or a wrong nonce, is not this LISTEN's heartbeat", async () => {
    const c = bus();
    c.loopback = false;
    const alerts: ChannelListenerAlert[] = [];
    await start(c, alerts, [], { pingMs: 15, pingDeadlineMs: 40, retryMs: 1_000 });
    const t = setInterval(() => {
      c.deliver(JSON.stringify({ hb: 1, listener: "other-listener-1", nonce: "nonce-of-other" }));
      c.deliver(JSON.stringify({ hb: 1, listener: l!.id, nonce: "not-the-pending-1" }));
    }, 3);
    try {
      expect(await until(() => alerts.some((a) => a.kind === "lost"))).toBe(true);
    } finally {
      clearInterval(t);
    }
  });

  it("★ M-1: a ping that cannot be SENT ⇒ lost alert but NO re-LISTEN (the LISTEN is not the suspect)", async () => {
    const c = bus();
    c.notifyImpl = async () => {
      throw new Error("pool exhausted");
    };
    const alerts: ChannelListenerAlert[] = [];
    const x = await start(c, alerts, [], { pingMs: 15, pingDeadlineMs: 25 });
    expect(await until(() => alerts.some((a) => a.kind === "lost"))).toBe(true);
    expect(alerts[0].reason).toMatch(/could not be sent/);
    await sleep(80);
    expect(c.listenCalls).toBe(1);
    expect(x.status().pingSendFailures).toBeGreaterThan(0);
    c.notifyImpl = null;
    expect(await until(() => alerts.some((a) => a.kind === "recovered"))).toBe(true);
  });

  it("★ M-1: the ping deadline starts when the NOTIFY has been SENT — a slow send (longer than the deadline) is not a lost LISTEN", async () => {
    const c = bus();
    c.notifyImpl = async (p) => {
      await sleep(80); // longer than pingDeadlineMs
      setTimeout(() => c.deliver(p), 1);
      return [];
    };
    const alerts: ChannelListenerAlert[] = [];
    const x = await start(c, alerts, [], { pingMs: 200, pingDeadlineMs: 40, notifyDeadlineMs: 1_000 });
    expect(await until(() => x.status().lastPingRttMs !== null, 3_000)).toBe(true);
    expect(alerts).toEqual([]);
  });

  it("postgres re-LISTENs after a dropped connection (onlisten again): lost + recovered (the gap), reconnects counted", async () => {
    const c = bus();
    const alerts: ChannelListenerAlert[] = [];
    const x = await start(c, alerts, []);
    c.reconnect();
    expect(x.status().reconnects).toBe(1);
    expect(alerts.map((a) => a.kind)).toEqual(["lost", "recovered"]);
    expect(alerts[0].reason).toMatch(/dropped/);
  });

  it("stop(): LISTEN removed, no more pings, state off", async () => {
    const c = bus();
    const x = await start(c, [], [], { pingMs: 10 });
    await sleep(30);
    await x.stop();
    l = null;
    const sent = c.notified.length;
    await sleep(40);
    expect(c.notified.length).toBe(sent);
    expect(c.subs.every((s) => !s.active)).toBe(true);
    expect(x.status().state).toBe("off");
  });
});
