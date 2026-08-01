/**
 * Sprint F1.2 — opcuaDriver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/thiết bị thật.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "temp", address: "ns=2;s=Temp", dataType: "float", scale: 10, offset: 1 },
  { tagKey: "run", address: "ns=2;s=Run", dataType: "bool" },
];

describe("OpcuaDriver (mocked node-opcua)", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.OT_OPCUA_MONITORED_ITEMS;
  });

  function mockOpcua(readImpl: (nodes: any[]) => any, writeImpl?: (nodes: any[]) => any) {
    const session = {
      read: vi.fn(async (nodes: any[]) => readImpl(nodes)),
      write: vi.fn(async (nodes: any[]) =>
        writeImpl ? writeImpl(nodes) : nodes.map(() => ({ value: 0 })),
      ),
      close: vi.fn(async () => {}),
    };
    const client = {
      connect: vi.fn(async () => {}),
      createSession: vi.fn(async () => session),
      disconnect: vi.fn(async () => {}),
    };
    // Variant ghi lại args để test coerce; DataType là enum giả.
    class Variant {
      dataType: any;
      value: any;
      constructor(o: any) {
        this.dataType = o.dataType;
        this.value = o.value;
      }
    }
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create: vi.fn(() => client) },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant,
    }));
    return { client, session };
  }

  it("connect → readTags maps values with scale/offset; disconnect", async () => {
    const { client, session } = mockOpcua((nodes) =>
      nodes.map((n: any) => ({
        statusCode: { value: 0 },
        sourceTimestamp: new Date(),
        value: { value: n.nodeId.includes("Run") ? true : 2 },
      })),
    );

    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();

    await d.connect({ endpoint: "opc.tcp://localhost:4840" });
    expect(d.isConnected()).toBe(true);
    expect(client.connect).toHaveBeenCalled();

    const samples = await d.readTags(tags);
    expect(samples).toHaveLength(2);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.value).toBe(21); // 2*10+1
    expect(temp.quality).toBe("good");
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.value).toBe(true);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
    expect(session.close).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
  });

  it("F4b writeTags: good status → ok:true; inverse scale/offset applied to value", async () => {
    const { session } = mockOpcua(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });

    // temp tag: float scale 10 offset 1. write user value 21 → raw (21-1)/10 = 2.
    const res = await d.writeTags([
      { tagKey: "temp", address: "ns=2;s=Temp", value: 21, dataType: "float", scale: 10, offset: 1 },
    ]);
    expect(res[0].ok).toBe(true);
    expect(session.write).toHaveBeenCalledTimes(1);
    const sent = (session.write as any).mock.calls[0][0];
    expect(sent[0].nodeId).toBe("ns=2;s=Temp");
    expect(sent[0].attributeId).toBe(13); // AttributeIds.Value
    expect(sent[0].value.value.value).toBeCloseTo(2, 6); // inverse-scaled raw
    expect(sent[0].value.value.dataType).toBe(11); // DataType.Double
  });

  it("F4b writeTags: bool NOT inverse-scaled, coerced Boolean", async () => {
    const { session } = mockOpcua(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "run", address: "ns=2;s=Run", value: 1, dataType: "bool", scale: 99, offset: 99 },
    ]);
    expect(res[0].ok).toBe(true);
    const sent = (session.write as any).mock.calls[0][0];
    expect(sent[0].value.value.value).toBe(true);
    expect(sent[0].value.value.dataType).toBe(1); // DataType.Boolean
  });

  it("F4b writeTags: bad status code → ok:false", async () => {
    mockOpcua(
      () => [],
      (nodes) => nodes.map(() => ({ value: 0x80000000, name: "BadNodeIdUnknown" })),
    );
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "run", address: "ns=2;s=Run", value: true, dataType: "bool" },
    ]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/bad status/);
  });

  it("F4b writeTags: session.write throws → ok:false", async () => {
    const { session } = mockOpcua(() => []);
    (session.write as any).mockImplementation(async () => {
      throw new Error("write io error");
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "run", address: "ns=2;s=Run", value: true, dataType: "bool" },
    ]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/write io error/);
  });

  it("F4b writeTags: throws when not connected", async () => {
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(
      d.writeTags([{ tagKey: "run", address: "ns=2;s=Run", value: true }]),
    ).rejects.toThrow(/not connected/);
  });

  it("F4b writeTags: invalid nodeId → that write ok:false (parse error, no crash)", async () => {
    const { session } = mockOpcua(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const res = await d.writeTags([
      { tagKey: "bad", address: "not-a-nodeid", value: 1, dataType: "int" },
    ]);
    expect(res[0].ok).toBe(false);
    // không node hợp lệ nào để gửi → session.write không được gọi
    expect(session.write).not.toHaveBeenCalled();
  });

  it("bad statusCode → quality bad, value null", async () => {
    mockOpcua((nodes) =>
      nodes.map(() => ({
        statusCode: { value: 0x80000000 },
        value: { value: 5 },
      })),
    );
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const [s] = await d.readTags([tags[0]]);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
  });

  it("readTags throws when not connected", async () => {
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  // doc 22 P3 — OPC-UA monitored-item PUSH path (flag OT_OPCUA_MONITORED_ITEMS).
  function mockOpcuaWithSubscriptions(readImpl: (nodes: any[]) => any) {
    const { client, session } = mockOpcua(readImpl);
    // Add subscription support to the session + package.
    const subscription = { terminate: vi.fn(async () => {}) };
    (session as any).createSubscription2 = vi.fn(async () => subscription);
    // Each created monitored item exposes an EventEmitter-like .on("changed", cb).
    const createdItems: Array<{ on: any; fire: (dv: any) => void }> = [];
    const ClientMonitoredItem = {
      create: vi.fn(async () => {
        let handler: ((dv: any) => void) | null = null;
        const item = {
          on: (evt: string, cb: (dv: any) => void) => { if (evt === "changed") handler = cb; },
          fire: (dv: any) => handler && handler(dv),
        };
        createdItems.push(item);
        return item;
      }),
    };
    // Re-mock node-opcua to ALSO expose the subscription symbols.
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create: vi.fn(() => client) },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant: class Variant { constructor(o: any) { Object.assign(this, o); } },
      ClientSubscription: { create: vi.fn(async () => subscription) },
      ClientMonitoredItem,
      TimestampsToReturn: { Both: 2 },
      MonitoringMode: { Reporting: 1 },
    }));
    return { client, session, subscription, ClientMonitoredItem, createdItems };
  }

  it("flag ON → subscribe uses monitored items and pushes normalized samples on change", async () => {
    process.env.OT_OPCUA_MONITORED_ITEMS = "true";
    const { subscription, ClientMonitoredItem, createdItems } = mockOpcuaWithSubscriptions(() => []);
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });

    const received: any[] = [];
    const handle = await d.subscribe(tags, (s) => { received.push(s); }, 1000);
    // One monitored item per tag.
    expect(ClientMonitoredItem.create).toHaveBeenCalledTimes(2);

    // Fire a change on the "temp" tag (float scale 10 offset 1): raw 2 → 21.
    createdItems[0].fire({ statusCode: { value: 0 }, sourceTimestamp: new Date(), value: { value: 2 } });
    expect(received).toHaveLength(1);
    expect(received[0].tagKey).toBe("temp");
    expect(received[0].value).toBe(21);
    expect(received[0].quality).toBe("good");

    await handle.close();
    expect(subscription.terminate).toHaveBeenCalled();
  });

  it("flag OFF (default) → subscribe stays on the poll path (no subscription created)", async () => {
    const { session } = mockOpcuaWithSubscriptions((nodes) =>
      nodes.map(() => ({ statusCode: { value: 0 }, value: { value: 3 } })),
    );
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const handle = await d.subscribe(tags, () => {}, 5000);
    // Poll path → createSubscription2 was never used.
    expect((session as any).createSubscription2).not.toHaveBeenCalled();
    await handle.close();
  });

  it("flag ON but package lacks subscription support → falls back to poll", async () => {
    process.env.OT_OPCUA_MONITORED_ITEMS = "true";
    // Plain mock WITHOUT subscription symbols.
    mockOpcua((nodes) => nodes.map(() => ({ statusCode: { value: 0 }, value: { value: 1 } })));
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    // Must not throw — returns a working (poll) handle.
    const handle = await d.subscribe(tags, () => {}, 5000);
    expect(typeof handle.close).toBe("function");
    await handle.close();
  });

  it("connect throws 'node-opcua not installed' when package missing", async () => {
    vi.doMock("node-opcua", () => {
      throw new Error("Cannot find module");
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(d.connect({ endpoint: "opc.tcp://x" })).rejects.toThrow(/node-opcua not installed/);
  });
});
