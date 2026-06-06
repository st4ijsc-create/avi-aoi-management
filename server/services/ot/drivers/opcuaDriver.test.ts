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
  });

  function mockOpcua(readImpl: (nodes: any[]) => any) {
    const session = {
      read: vi.fn(async (nodes: any[]) => readImpl(nodes)),
      close: vi.fn(async () => {}),
    };
    const client = {
      connect: vi.fn(async () => {}),
      createSession: vi.fn(async () => session),
      disconnect: vi.fn(async () => {}),
    };
    vi.doMock("node-opcua", () => ({
      OPCUAClient: { create: vi.fn(() => client) },
      AttributeIds: { Value: 13 },
    }));
    return { client, session };
  }

  it("connect → readTags maps values with scale/offset; writeTags ok:false; disconnect", async () => {
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

    const w = await d.writeTags([{ tagKey: "run", address: "ns=2;s=Run", value: true }]);
    expect(w[0].ok).toBe(false);
    expect(w[0].error).toMatch(/HITL only \(F4\)/);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
    expect(session.close).toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalled();
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

  it("connect throws 'node-opcua not installed' when package missing", async () => {
    vi.doMock("node-opcua", () => {
      throw new Error("Cannot find module");
    });
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await expect(d.connect({ endpoint: "opc.tcp://x" })).rejects.toThrow(/node-opcua not installed/);
  });
});
