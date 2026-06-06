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
      disconnect: vi.fn(async () => {}),
      ...overrides,
    };
    vi.doMock("st-ethernet-ip", () => ({ Controller: function () { return plc; } }));
    return plc;
  }

  it("connect → readTags decode + scale/offset; writeTags ok:false; disconnect", async () => {
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

    const w = await d.writeTags([{ tagKey: "run", address: "Program:Main.RunFlag", value: true }]);
    expect(w[0].ok).toBe(false);
    expect(w[0].error).toMatch(/HITL only \(F4\)/);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
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
