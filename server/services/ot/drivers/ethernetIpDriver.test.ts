/**
 * Sprint F1.3 — ethernetIpDriver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/PLC thật.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "temp", address: "Temperature", dataType: "float", scale: 10, offset: 1 },
  { tagKey: "run", address: "Program:Main.RunFlag", dataType: "bool" },
];

describe("EthernetIpDriver (mocked st-ethernet-ip)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockEip(valueByTagName: Record<string, unknown>, overrides: Record<string, any> = {}) {
    const plc: any = {
      connect: vi.fn(async () => {}),
      newTag: vi.fn((name: string) => ({ name, value: undefined })),
      readTag: vi.fn(async (tag: any) => {
        tag.value = valueByTagName[tag.name];
      }),
      writeTag: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      ...overrides,
    };
    vi.doMock("st-ethernet-ip", () => ({ Controller: function () { return plc; } }));
    return plc;
  }

  it("connect → readTags decode + scale/offset; disconnect", async () => {
    mockEip({ Temperature: 2, RunFlag: true });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();

    await d.connect({ endpoint: "192.168.1.10", options: { slot: 0 } });
    expect(d.isConnected()).toBe(true);

    const samples = await d.readTags(tags);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.value).toBe(21); // 2*10+1
    expect(temp.quality).toBe("good");
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.value).toBe(true);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("writeTags GHI THẬT: per-tag tuần tự, ok + inverse scale (scale2 offset10 value110→raw50) + bool", async () => {
    const plc = mockEip({});
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });

    const res = await d.writeTags([
      { tagKey: "sp", address: "SetPoint", value: 110, dataType: "int", scale: 2, offset: 10 },
      { tagKey: "run", address: "Program:Main.RunFlag", value: true, dataType: "bool" },
    ]);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(plc.writeTag).toHaveBeenCalledTimes(2); // per-tag tuần tự
    // tag.value đã set raw 50 trước khi writeTag.
    const firstTag = plc.writeTag.mock.calls[0][0];
    expect(firstTag.value).toBe(50); // (110-10)/2
  });

  it("writeTags isolate: 1 tag throw → ok:false, tag kia ok:true", async () => {
    mockEip({}, {
      writeTag: vi.fn(async (tag: any) => {
        if (tag.name === "BadTag") throw new Error("CIP write failed");
      }),
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });

    const res = await d.writeTags([
      { tagKey: "bad", address: "BadTag", value: 1, dataType: "int" },
      { tagKey: "ok", address: "GoodTag", value: 2, dataType: "int" },
    ]);
    expect(res.find((r) => r.tagKey === "bad")!.ok).toBe(false);
    expect(res.find((r) => r.tagKey === "bad")!.error).toMatch(/CIP write failed/);
    expect(res.find((r) => r.tagKey === "ok")!.ok).toBe(true);
  });

  it("writeTags throws when not connected", async () => {
    mockEip({});
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await expect(d.writeTags([{ tagKey: "sp", address: "SetPoint", value: 1 }])).rejects.toThrow(/not connected/);
  });

  it("per-tag read error → quality bad, no crash", async () => {
    mockEip(
      { RunFlag: true },
      {
        readTag: vi.fn(async (tag: any) => {
          if (tag.name === "Temperature") throw new Error("CIP timeout");
          tag.value = true;
        }),
      },
    );
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const samples = await d.readTags(tags);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.quality).toBe("bad");
    expect(temp.value).toBeNull();
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.quality).toBe("good");
  });

  it("readTags throws when not connected", async () => {
    mockEip({});
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  it("connect throws 'st-ethernet-ip not installed' when package missing", async () => {
    vi.doMock("st-ethernet-ip", () => {
      throw new Error("Cannot find module");
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await expect(d.connect({ endpoint: "192.168.1.10" })).rejects.toThrow(
      /st-ethernet-ip not installed/,
    );
  });
});
