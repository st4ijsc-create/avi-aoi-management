/**
 * doc 81 Đợt 9 task U1 — OpcuaDriver.subscribeQueued against a FAKE node-opcua package (vi.doMock): what the safety-PLC
 * subscription relies on, decided per OPC UA Part 4 (oracles written from the spec, not from the driver):
 *   • items are requested with discardOldest = false and the given queue size / sampling interval; the REVISED values are
 *     returned per item; a refused item is reported (not thrown);
 *   • a value with the Overflow info bit (0x0480 = InfoType DataValue | Overflow, §7.39) keeps Good quality and is flagged;
 *     Uncertain / Bad severity ⇒ "bad";
 *   • NotificationMessage sequence numbers: a gap ⇒ onLost(n); a keep-alive carries the NEXT number (no gap); every publish
 *     response ⇒ onAlive;
 *   • terminated / a Bad status change / link lost ⇒ onDead; nothing after close();
 *   • it never writes (session.write is never called).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

function mockPkg(o: { refuse?: string; revisedQueue?: number; revisedSampling?: number } = {}) {
  const subscription = Object.assign(new EventEmitter(), {
    publishingInterval: 1000,
    maxKeepAliveCount: 3,
    terminate: vi.fn(async () => undefined),
    monitor: vi.fn(async (item: { nodeId: string }, params: { samplingInterval: number; discardOldest: boolean; queueSize: number }) => {
      if (o.refuse && item.nodeId.includes(o.refuse)) throw new Error("BadNodeIdUnknown (0x80340000)");
      const mi = Object.assign(new EventEmitter(), {
        statusCode: { value: 0 },
        monitoringParameters: { queueSize: o.revisedQueue ?? params.queueSize, samplingInterval: o.revisedSampling ?? params.samplingInterval },
        requested: params,
      });
      items.push(mi);
      return mi;
    }),
  });
  const items: Array<EventEmitter & { requested: { discardOldest: boolean; queueSize: number; samplingInterval: number } }> = [];
  const session = {
    read: vi.fn(),
    write: vi.fn(),
    close: vi.fn(async () => undefined),
    createSubscription2: vi.fn(async () => subscription),
  };
  const client = Object.assign(new EventEmitter(), {
    connect: vi.fn(async () => undefined),
    createSession: vi.fn(async () => session),
    disconnect: vi.fn(async () => undefined),
  });
  vi.doMock("node-opcua", () => ({
    OPCUAClient: { create: vi.fn(() => client) },
    AttributeIds: { Value: 13 },
    DataType: { Boolean: 1 },
    Variant: class {},
    ClientMonitoredItem: { create: vi.fn() },
    TimestampsToReturn: { Both: 2 },
  }));
  return { subscription, items, session, client };
}

function sinkLog() {
  const log: string[] = [];
  return {
    log,
    sink: {
      onValue: (k: string, s: { value: unknown; quality: string }, i: { overflow: boolean }) => log.push(`value ${k}=${String(s.value)} ${s.quality}${i.overflow ? " overflow" : ""}`),
      onAlive: () => log.push("alive"),
      onLost: (n: number) => log.push(`lost ${n}`),
      onDead: (w: string) => log.push(`dead ${w}`),
    },
  };
}
const TAGS = [
  { tagKey: "estop", address: "ns=1;s=ESTOP", dataType: "bool" as const },
  { tagKey: "zoneOccupied", address: "ns=1;s=GUARD", dataType: "bool" as const },
];
const OPTS = { publishingIntervalMs: 1000, samplingIntervalMs: 50, queueSize: 24, maxKeepAliveCount: 3 };

async function connected(o?: Parameters<typeof mockPkg>[0]) {
  const m = mockPkg(o);
  const { OpcuaDriver } = await import("./opcuaDriver");
  const d = new OpcuaDriver();
  await d.connect({ endpoint: "opc.tcp://127.0.0.1:4840" });
  return { d, ...m };
}

let quiet: Array<ReturnType<typeof vi.spyOn>> = [];
beforeEach(() => {
  vi.resetModules();
  quiet.forEach((q) => q.mockRestore());
  quiet = [vi.spyOn(console, "warn").mockImplementation(() => undefined), vi.spyOn(console, "error").mockImplementation(() => undefined)];
});

describe("Đợt 9 U1 — OpcuaDriver.subscribeQueued (fake node-opcua)", () => {
  it("★ requests discardOldest=false + the queue / sampling asked; returns the REVISED values; a refused item is reported", async () => {
    const { d, items, subscription } = await connected({ refuse: "GUARD", revisedQueue: 7, revisedSampling: 100 });
    const { sink } = sinkLog();
    const h = await d.subscribeQueued(TAGS, OPTS, sink);
    expect(items).toHaveLength(1);
    expect(items[0].requested).toEqual({ samplingInterval: 50, discardOldest: false, queueSize: 24 });
    expect(h.items).toEqual([
      { tagKey: "estop", ok: true, statusCode: undefined, queueSize: 7, samplingIntervalMs: 100 },
      { tagKey: "zoneOccupied", ok: false, statusCode: "BadNodeIdUnknown (0x80340000)", queueSize: 0, samplingIntervalMs: 0 },
    ]);
    expect([h.publishingIntervalMs, h.maxKeepAliveCount]).toEqual([1000, 3]);
    expect(subscription.monitor).toHaveBeenCalledTimes(2);
  });

  it("★ overflow info bit ⇒ good + flagged; Uncertain / Bad severity ⇒ bad", async () => {
    const { d, items, session } = await connected();
    const { log, sink } = sinkLog();
    await d.subscribeQueued(TAGS, OPTS, sink);
    items[0].emit("changed", { value: { value: true }, statusCode: { value: 0x00000480 } });
    items[0].emit("changed", { value: { value: false }, statusCode: { value: 0 } });
    items[0].emit("changed", { value: { value: true }, statusCode: { value: 0x40000000 } });
    items[1].emit("changed", { value: { value: true }, statusCode: { value: 0x80340000 } });
    expect(log).toEqual(["value estop=true good overflow", "value estop=false good", "value estop=null bad", "value zoneOccupied=null bad"]);
    expect(session.write).not.toHaveBeenCalled();
  });

  it("★ sequence numbers: a gap ⇒ onLost(n); a keep-alive carries the NEXT number (no gap); every publish ⇒ alive", async () => {
    const { d, subscription } = await connected();
    const { log, sink } = sinkLog();
    await d.subscribeQueued(TAGS, OPTS, sink);
    const data = (n: number) => subscription.emit("raw_notification", { sequenceNumber: n, notificationData: [{}] });
    const ka = (n: number) => subscription.emit("raw_notification", { sequenceNumber: n, notificationData: [] });
    data(1);
    ka(2);
    data(2);
    ka(3);
    ka(3);
    data(3);
    data(6); // 4 and 5 never arrived
    ka(7); // "the next message will be 7"
    data(8); // ⇒ 7 was lost
    expect(log.filter((l) => l.startsWith("lost"))).toEqual(["lost 2", "lost 1"]);
    expect(log.filter((l) => l === "alive")).toHaveLength(9);
  });

  it("★ terminated / Bad status change / link lost ⇒ dead (once); nothing after close()", async () => {
    const a = await connected();
    const la = sinkLog();
    await a.d.subscribeQueued(TAGS, OPTS, la.sink);
    a.subscription.emit("status_changed", { value: 0x800a0000, name: "BadTimeout" });
    a.subscription.emit("terminated");
    expect(la.log).toEqual(["dead subscription status BadTimeout (0x800a0000)"]);

    vi.resetModules();
    const b = await connected();
    const lb = sinkLog();
    await b.d.subscribeQueued(TAGS, OPTS, lb.sink);
    b.subscription.emit("status_changed", { value: 0x002d0000, name: "GoodSubscriptionTransferred" }); // Good ⇒ not dead
    b.client.emit("connection_lost");
    expect(lb.log).toEqual(["dead opcua link lost (connection_lost)"]);

    vi.resetModules();
    const c = await connected();
    const lc = sinkLog();
    const h = await c.d.subscribeQueued(TAGS, OPTS, lc.sink);
    await h.close();
    expect(c.subscription.terminate).toHaveBeenCalled();
    c.subscription.emit("terminated");
    c.items[0].emit("changed", { value: { value: true }, statusCode: { value: 0 } });
    c.subscription.emit("raw_notification", { sequenceNumber: 9, notificationData: [{}] });
    expect(lc.log).toEqual([]);
    expect(c.session.write).not.toHaveBeenCalled();
  });

  it("not connected ⇒ throws (the caller falls back to polling)", async () => {
    mockPkg();
    const { OpcuaDriver } = await import("./opcuaDriver");
    await expect(new OpcuaDriver().subscribeQueued(TAGS, OPTS, sinkLog().sink)).rejects.toThrow();
  });
});
