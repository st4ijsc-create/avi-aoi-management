/**
 * doc 81 Đợt 9 task U1 — the OPC-UA subscription backend of the safety-PLC poller, against a FAKE queued-subscription driver
 * (the sink is driven by the test; the clock is the test's). The real node-opcua path is covered by
 * safetyPlcPoller.u1.opcua.e2e.dot9.test.ts. Shown:
 *   • every queued value change is its own read, in order; no change ⇒ the current state;
 *   • an item needs its initial value before the subscription is used; none within the bound ⇒ visible fallback;
 *   • refused subscription / item / queue below 2 ⇒ "poll_fallback" (the inherited poll read), re-tried later;
 *   • dead (onDead) or SILENT (no data, no keep-alive beyond the bound) ⇒ an error read (never ok), torn down, re-subscribed;
 *   • overflow bit / sequence gap / buffer bound ⇒ counted as lost; bad quality / unparseable ⇒ unreadable;
 *   • a connect that outlives its bound is released when it settles; close() releases; the module never writes.
 * And at the poller level: the read mode is persisted per config, lost changes become ONE events-lost marker FIRST.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { SafetyPlcConfig } from "../../../../drizzle/schema";
import type { OpcuaQueuedSink, OpcuaQueuedSubscription } from "../../ot/drivers/opcuaDriver";
import type { OtSample, OtTagAddress } from "../../ot/otDriver";
import {
  OpcuaSubscriptionSafetyPlcBackend,
  opcuaDeadAfterMs,
  opcuaQueueSizeFor,
  SAFETY_PLC_OPCUA_BUFFER_MAX,
  SAFETY_PLC_OPCUA_RESUBSCRIBE_MS,
  type QueuedSubscriptionDriver,
} from "./safetyPlcOpcuaSubscription";
import { SafetyPlcPoller } from "./safetyPlcPoller";
import type { RecordSafetyEventInput } from "../safetyAuditService";
import type { PollStateRow } from "./safetyPlcPollerHealth";

const MAP = { estop: { address: "ns=1;s=ESTOP" }, zoneOccupied: { address: "ns=1;s=GUARD_OK", activeWhen: "falsy" as const } };
const good = (tagKey: string, value: unknown): OtSample => ({ tagKey, raw: value, value: value as never, quality: "good", timestamp: new Date() });

interface Fake extends QueuedSubscriptionDriver {
  sink: OpcuaQueuedSink | null;
  connects: number;
  disconnects: number;
  closes: number;
  subscribes: number;
  opts: Array<{ queueSize: number; publishingIntervalMs: number }>;
  tags: OtTagAddress[][];
}
function fakeDriver(o: { failSubscribe?: string; queueSize?: number; sampling?: number; refuse?: string; initial?: boolean; connectHang?: Promise<void> } = {}): Fake {
  const d: Fake = {
    sink: null,
    connects: 0,
    disconnects: 0,
    closes: 0,
    subscribes: 0,
    opts: [],
    tags: [],
    async connect() {
      d.connects += 1;
      if (o.connectHang) await o.connectHang;
    },
    async disconnect() {
      d.disconnects += 1;
    },
    async subscribeQueued(tags, opts, sink) {
      d.subscribes += 1;
      d.opts.push(opts);
      d.tags.push(tags);
      if (o.failSubscribe) throw new Error(o.failSubscribe);
      d.sink = sink;
      if (o.initial !== false) {
        // initial values arrive with the first publish
        queueMicrotask(() => {
          sink.onValue("estop", good("estop", false), { overflow: false });
          sink.onValue("zoneOccupied", good("zoneOccupied", true), { overflow: false }); // GUARD_OK true = clear
        });
      }
      const h: OpcuaQueuedSubscription = {
        publishingIntervalMs: opts.publishingIntervalMs,
        maxKeepAliveCount: opts.maxKeepAliveCount,
        items: tags.map((t) => ({ tagKey: t.tagKey, ok: o.refuse !== t.tagKey, statusCode: o.refuse === t.tagKey ? "BadNodeIdUnknown (0x80340000)" : undefined, queueSize: o.queueSize ?? opts.queueSize, samplingIntervalMs: o.sampling ?? opts.samplingIntervalMs })),
        close: async () => {
          d.closes += 1;
        },
      };
      return h;
    },
  };
  return d;
}

let clock = 1_000_000;
const now = () => clock;
function backend(drivers: Fake[], o: { timeoutMs?: number; intervalMs?: number } = {}) {
  let i = 0;
  const b = new OpcuaSubscriptionSafetyPlcBackend("opc.tcp://127.0.0.1:1", MAP as never, o.timeoutMs ?? 300, {
    intervalMs: o.intervalMs ?? 1000,
    createDriver: () => drivers[Math.min(i++, drivers.length - 1)],
    now,
  });
  const polls = { n: 0 };
  (b as unknown as { readChecked: () => Promise<unknown> }).readChecked = async () => {
    polls.n += 1;
    return { status: { estop: false, zoneOccupied: false }, unreadable: [] };
  };
  return { b, polls };
}
const statuses = (reads: Array<{ status?: Record<string, unknown> } | { error: string }>) => reads.map((r) => ("error" in r ? `error` : JSON.stringify((r as { status: unknown }).status)));

let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  clock = 1_000_000;
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "log").mockImplementation(() => undefined)];
});
afterEach(() => quiet.forEach((q) => q.mockRestore()));

describe("Đợt 9 U1 — queued subscription: every value change is a read", () => {
  it("★ press + release inside one interval ⇒ two reads, in order; nothing new ⇒ the current state", async () => {
    const d = fakeDriver();
    const { b, polls } = backend([d]);
    const first = await b.readBatch();
    expect(first.mode).toBe("subscription");
    expect(statuses(first.reads)).toEqual([JSON.stringify({ estop: false, zoneOccupied: false })]); // initial values (guard clear)
    d.sink!.onValue("estop", good("estop", true), { overflow: false });
    d.sink!.onValue("estop", good("estop", false), { overflow: false });
    const b2 = await b.readBatch();
    expect(statuses(b2.reads)).toEqual([JSON.stringify({ estop: true, zoneOccupied: false }), JSON.stringify({ estop: false, zoneOccupied: false })]);
    expect(b2.lost).toBe(0);
    const b3 = await b.readBatch();
    expect(statuses(b3.reads)).toEqual([JSON.stringify({ estop: false, zoneOccupied: false })]);
    expect(polls.n).toBe(0); // never polled while subscribed
    expect(d.opts[0]).toMatchObject({ queueSize: opcuaQueueSizeFor(1000), publishingIntervalMs: 1000 });
    expect(d.opts[0].queueSize).toBeGreaterThanOrEqual(2);
  });

  it("bad quality / unparseable value ⇒ that flag UNREADABLE (never clear)", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    await b.readBatch();
    // a BAD-quality sample is never trusted for its value, even when the value looks decided
    d.sink!.onValue("estop", { tagKey: "estop", raw: false, value: false, quality: "bad", timestamp: new Date() }, { overflow: false });
    d.sink!.onValue("zoneOccupied", { tagKey: "zoneOccupied", raw: true, value: true, quality: "uncertain", timestamp: new Date() }, { overflow: false });
    expect(((await b.readBatch()).reads.at(-1) as { unreadable: string[] }).unreadable.sort()).toEqual(["estop", "zoneOccupied"]);
    d.sink!.onValue("estop", { tagKey: "estop", raw: undefined, value: null, quality: "bad", timestamp: new Date() }, { overflow: false });
    d.sink!.onValue("zoneOccupied", good("zoneOccupied", "abc"), { overflow: false });
    const r = (await b.readBatch()).reads.at(-1) as { unreadable: string[] };
    expect(r.unreadable.sort()).toEqual(["estop", "zoneOccupied"]);
  });

  it("★ overflow bit / sequence gap / buffer bound ⇒ counted as LOST (then reset)", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    await b.readBatch();
    d.sink!.onValue("estop", good("estop", true), { overflow: true });
    d.sink!.onLost(3, "gap");
    expect((await b.readBatch()).lost).toBe(4);
    expect((await b.readBatch()).lost).toBe(0);
    for (let i = 0; i < SAFETY_PLC_OPCUA_BUFFER_MAX + 5; i++) d.sink!.onValue("estop", good("estop", i % 2 === 0), { overflow: false });
    const big = await b.readBatch();
    expect(big.reads).toHaveLength(SAFETY_PLC_OPCUA_BUFFER_MAX);
    expect(big.lost).toBe(5);
  });

  it("values before every item has its initial value are not reported half-known", async () => {
    const d = fakeDriver({ initial: false });
    const { b } = backend([d], { timeoutMs: 200 });
    const p = b.readBatch();
    await new Promise((r) => setTimeout(r, 5));
    d.sink!.onValue("estop", good("estop", true), { overflow: false });
    d.sink!.onValue("zoneOccupied", good("zoneOccupied", true), { overflow: false });
    const r = await p;
    expect(r.mode).toBe("subscription");
    expect(statuses(r.reads)).toEqual([JSON.stringify({ estop: true, zoneOccupied: false })]);
  });
});

describe("Đợt 9 U1 — fallback to polling is VISIBLE, re-tried", () => {
  it("★ subscription refused ⇒ poll_fallback via the poll read; re-tried after the resubscribe period", async () => {
    const d1 = fakeDriver({ failSubscribe: "BadTooManySubscriptions" });
    const d2 = fakeDriver();
    const { b, polls } = backend([d1, d2]);
    const r1 = await b.readBatch();
    expect(r1.mode).toBe("poll_fallback");
    expect(r1.modeReason).toMatch(/BadTooManySubscriptions/);
    expect(polls.n).toBe(1);
    expect(b.readMode()).toBe("poll_fallback");
    expect(d1.disconnects).toBe(1); // the half-made session is released
    clock += SAFETY_PLC_OPCUA_RESUBSCRIBE_MS - 1;
    expect((await b.readBatch()).mode).toBe("poll_fallback");
    expect(d2.subscribes).toBe(0);
    clock += 2;
    expect((await b.readBatch()).mode).toBe("subscription");
    expect(d2.subscribes).toBe(1);
  });

  it("★ the server revised a queue below 2 ⇒ fallback (short presses could be lost)", async () => {
    const d = fakeDriver({ queueSize: 1 });
    const { b } = backend([d]);
    const r = await b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/queue size below 2/);
    expect(d.closes).toBe(1);
  });

  it("★ the server revised the sampling interval above 250 ms ⇒ fallback (it would miss a short press); 0 (exception-based) and 250 are fine", async () => {
    const r = await backend([fakeDriver({ sampling: 1000 })]).b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/sampling interval above 250 ms/);
    expect((await backend([fakeDriver({ sampling: 0 })]).b.readBatch()).mode).toBe("subscription");
    expect((await backend([fakeDriver({ sampling: 250 })]).b.readBatch()).mode).toBe("subscription");
    expect((await backend([fakeDriver({ sampling: 251 })]).b.readBatch()).mode).toBe("poll_fallback");
  });

  it("an item refused by the server ⇒ fallback (the poll read reports that tag unreadable)", async () => {
    const r = await backend([fakeDriver({ refuse: "estop" })]).b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/refused: estop BadNodeIdUnknown/);
  });

  it("no initial values within the bound ⇒ fallback", async () => {
    const r = await backend([fakeDriver({ initial: false })], { timeoutMs: 60 }).b.readBatch();
    expect(r.mode).toBe("poll_fallback");
    expect(r.modeReason).toMatch(/no initial value/);
  });

  it("a connect that outlives its bound ⇒ fallback; the late session is disconnected when it settles", async () => {
    let settle!: () => void;
    const d = fakeDriver({ connectHang: new Promise<void>((r) => (settle = r)) });
    const { b } = backend([d], { timeoutMs: 50 });
    expect((await b.readBatch()).mode).toBe("poll_fallback");
    expect(d.disconnects).toBe(0);
    settle();
    await new Promise((r) => setTimeout(r, 10));
    expect(d.disconnects).toBe(1);
  });

  it("fallback poll read failing ⇒ an error read (undecidable), never a clean one", async () => {
    const { b } = backend([fakeDriver({ failSubscribe: "x" })]);
    (b as unknown as { readChecked: () => Promise<unknown> }).readChecked = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect((await b.readBatch()).reads).toEqual([{ error: expect.stringMatching(/read failed: ECONNREFUSED/) }]);
  });
});

describe("Đợt 9 U1 — a dead or SILENT subscription is never healthy", () => {
  it("★ silent beyond the bound (no data, no keep-alive) ⇒ error read, torn down, re-subscribed next time", async () => {
    const d1 = fakeDriver();
    const d2 = fakeDriver();
    const { b } = backend([d1, d2]);
    await b.readBatch();
    const bound = opcuaDeadAfterMs(1000, 3);
    clock += bound - 1;
    d1.sink!.onAlive(); // a keep-alive just in time
    clock += bound - 1;
    expect((await b.readBatch()).reads[0]).not.toHaveProperty("error");
    clock += 2;
    const dead = await b.readBatch();
    expect(dead.reads).toEqual([{ error: expect.stringMatching(/subscription lost: subscription silent/) }]);
    expect(d1.closes).toBe(1);
    await new Promise((r) => setTimeout(r, 5));
    expect(d1.disconnects).toBe(1);
    // values from the dead subscription are ignored afterwards
    d1.sink!.onValue("estop", good("estop", true), { overflow: false });
    const again = await b.readBatch();
    expect(again.mode).toBe("subscription");
    expect(d2.subscribes).toBe(1);
    expect(statuses(again.reads)).toEqual([JSON.stringify({ estop: false, zoneOccupied: false })]);
    d1.sink!.onValue("estop", good("estop", true), { overflow: true }); // a late notification of the OLD subscription
    d1.sink!.onLost(5, "late gap");
    const after = await b.readBatch();
    expect(statuses(after.reads)).toEqual([JSON.stringify({ estop: false, zoneOccupied: false })]); // ignored
    expect(after.lost).toBe(0);
  });

  it("onDead (terminated / BadTimeout / link lost) ⇒ error read at the next batch", async () => {
    const d = fakeDriver();
    const { b } = backend([d, fakeDriver()]);
    await b.readBatch();
    d.sink!.onDead("subscription status BadTimeout (0x800a0000)");
    expect((await b.readBatch()).reads).toEqual([{ error: expect.stringMatching(/BadTimeout/) }]);
  });

  it("close() releases the session; a batch after close is an error read", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    await b.readBatch();
    await b.close();
    expect([d.closes, d.disconnects]).toEqual([1, 1]);
    expect((await b.readBatch()).reads).toEqual([{ error: "backend closed" }]);
  });

  it("dead bound: 2 missed keep-alives + slack, ≥ 2 s", () => {
    expect(opcuaDeadAfterMs(1000, 3)).toBe(7000);
    expect(opcuaDeadAfterMs(250, 3)).toBe(2500);
    expect(opcuaDeadAfterMs(100, 1)).toBe(2000);
  });
});

describe("Đợt 9 U1 — L-7: the subscription path never writes", () => {
  const strip = (src: string) => src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  it("the backend module has no write / actuation path", () => {
    const code = strip(fs.readFileSync(path.join(__dirname, "safetyPlcOpcuaSubscription.ts"), "utf8"));
    expect(code).not.toMatch(/writeTags|writeCoil|writeRegister|\.write\(|commandDispatcher|dispatchCommand|robotCommand/);
  });
  it("OpcuaDriver.subscribeQueued only reads (no session.write inside it)", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../ot/drivers/opcuaDriver.ts"), "utf8");
    const start = src.indexOf("async subscribeQueued(");
    const end = src.indexOf("override async writeTags(");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(strip(src.slice(start, end))).not.toMatch(/\.write\(|writeTags/);
  });
});

describe("Đợt 9 U1 — at the poller: read mode persisted, lost changes ⇒ ONE marker first", () => {
  function cfg(over: Partial<SafetyPlcConfig> = {}): SafetyPlcConfig {
    return { id: 93, code: "U1-UA", name: "u1", vendor: "sick", backend: "opcua", endpoint: "opc.tcp://127.0.0.1:1", statusMap: MAP, robotId: 4, stationId: null, lineId: null, enabled: true, notes: null, scope: null, corporateCode: null, factoryId: 2, createdAt: new Date(), updatedAt: new Date(), ...over } as SafetyPlcConfig;
  }
  function mk(b: unknown, c = cfg()) {
    const recs: Array<{ door: string; input: RecordSafetyEventInput }> = [];
    const saves: PollStateRow[] = [];
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      backendFor: () => ({ backend: b as never }),
      recordPlain: async (i) => (recs.push({ door: "plain", input: i }), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push({ door: "trusted", input: i }), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: { load: async () => null, save: async (r) => void saves.push(JSON.parse(JSON.stringify(r))), list: async () => [], claimStaleAlarm: async () => false },
    });
    return { p, recs, saves };
  }

  it("★ a press + release delivered in ONE batch ⇒ both events (trusted door), then the durable edge; mode 'subscription'", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    const { p, recs, saves } = mk(b);
    await p.refreshConfigs();
    await p.pollNow(93);
    d.sink!.onValue("estop", good("estop", true), { overflow: false });
    d.sink!.onValue("estop", good("estop", false), { overflow: false });
    await p.pollNow(93);
    expect(recs.map((r) => [r.door, r.input.eventType])).toEqual([["trusted", "estop"], ["trusted", "estop_released"]]);
    expect(saves.at(-1)).toMatchObject({ readMode: "subscription", flags: { estop: false } });
    await p.stop();
    expect(d.disconnects).toBe(1); // stop() releases the session
  });

  it("★ lost changes ⇒ ONE 'plc_events_lost' marker (naming the subscription) BEFORE the observed events", async () => {
    const d = fakeDriver();
    const { b } = backend([d]);
    const { p, recs } = mk(b);
    await p.refreshConfigs();
    await p.pollNow(93);
    d.sink!.onValue("estop", good("estop", true), { overflow: true });
    await p.pollNow(93);
    expect(recs.map((r) => r.input.eventType)).toEqual(["plc_events_lost", "estop"]);
    expect(recs[0].door).toBe("plain");
    expect(String(recs[0].input.notes)).toMatch(/1 safety-PLC value change\(s\).*LOST: the PLC's OPC-UA subscription reported lost value changes/);
    await p.pollNow(93);
    expect(recs).toHaveLength(2); // the marker is recorded once
    await p.stop();
  });

  it("★ fallback ⇒ readMode 'poll_fallback' persisted (the Safety page says 'polling'); a dead subscription ⇒ 'plc_offline', never released", async () => {
    const d1 = fakeDriver();
    const { b } = backend([d1, fakeDriver({ failSubscribe: "refused" })]);
    const { p, recs, saves } = mk(b);
    await p.refreshConfigs();
    await p.pollNow(93);
    d1.sink!.onValue("estop", good("estop", true), { overflow: false });
    await p.pollNow(93);
    d1.sink!.onDead("opcua link lost (close)");
    await p.pollNow(93);
    expect(recs.map((r) => r.input.eventType)).toEqual(["estop", "plc_offline"]);
    expect(String(recs[1].input.notes)).toMatch(/subscription lost/);
    expect(String(recs[1].input.notes)).not.toContain("127.0.0.1");
    await p.pollNow(93); // re-subscribe refused ⇒ fallback poll (estop false there) — offline + not online yet ⇒ no release
    expect(saves.at(-1)?.readMode).toBe("poll_fallback");
    expect(recs.map((r) => r.input.eventType)).not.toContain("estop_released");
    await p.stop();
  });

  it("an open subscription is kept across a non-identity edit (code), and REBUILT (old session released) when the poll interval changes", async () => {
    const drivers: Fake[] = [];
    let c = cfg();
    const built: OpcuaSubscriptionSafetyPlcBackend[] = [];
    const recs: string[] = [];
    const p = new SafetyPlcPoller({
      loadConfigs: async () => [c],
      backendFor: (cc) => {
        const d = fakeDriver();
        drivers.push(d);
        const b = new OpcuaSubscriptionSafetyPlcBackend(cc.endpoint!, cc.statusMap as never, 300, { intervalMs: 1000, createDriver: () => d, now });
        built.push(b);
        return { backend: b };
      },
      recordPlain: async (i) => (recs.push(i.eventType), { ok: true, enabled: true }),
      recordTrusted: async (i) => (recs.push(i.eventType), { ok: true, enabled: true }),
      isTrustApproved: async () => true,
      leader: { acquire: async () => true, held: async () => true, release: async () => undefined },
      state: { load: async () => null, save: async () => undefined, list: async () => [], claimStaleAlarm: async () => false },
    });
    await p.refreshConfigs();
    await p.pollNow(93);
    c = { ...c, code: "U1-UA-renamed" }; // changes the state fingerprint, not the trust identity ⇒ the state is CARRIED
    await p.refreshConfigs();
    await new Promise((r) => setTimeout(r, 5));
    await p.pollNow(93);
    expect(p.snapshot()[0].code).toBe("U1-UA-renamed");
    expect(built).toHaveLength(1); // reused
    expect(drivers[0].disconnects).toBe(0);
    expect(drivers[0].closes).toBe(0);
    c = { ...c, statusMap: { ...(c.statusMap as object), pollIntervalMs: 500 } as never };
    await p.refreshConfigs();
    await new Promise((r) => setTimeout(r, 5));
    expect(built).toHaveLength(2); // rebuilt for the new publishing interval
    expect(drivers[0].disconnects).toBe(1); // the old session is released
    await p.pollNow(93);
    expect(drivers[1].subscribes).toBe(1);
    expect(recs).toEqual([]);
    await p.stop();
  });

  it("read modes of the other backends: poll (Modbus), poll_latch (Modbus + latch), sim", async () => {
    const { defaultBackendFor } = await import("./safetyPlcPoller");
    const mb = cfg({ backend: "modbus", endpoint: "tcp://127.0.0.1:1", statusMap: { estop: { address: "coil:1" } } as never });
    const mbl = cfg({ backend: "modbus", endpoint: "tcp://127.0.0.1:1", statusMap: { estop: { address: "coil:1" }, estopLatch: { address: "coil:3" } } as never });
    const sim = cfg({ backend: "sim", endpoint: null, statusMap: { simScript: [] } as never });
    for (const [c, mode] of [[mb, "poll"], [mbl, "poll_latch"], [sim, "sim"]] as const) {
      const { p } = mk(defaultBackendFor(c, 500).backend, c);
      await p.refreshConfigs();
      expect(p.snapshot()[0].readMode).toBe(mode);
      await p.stop();
    }
    expect(defaultBackendFor(cfg(), 500).backend).toBeInstanceOf(OpcuaSubscriptionSafetyPlcBackend);
  });
});
