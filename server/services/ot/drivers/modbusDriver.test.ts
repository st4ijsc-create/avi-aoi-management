/**
 * Sprint F1.2 — modbusDriver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/thiết bị thật.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "level", address: "40001", dataType: "int", scale: 2, offset: 0 },
  { tagKey: "run", address: "coil:1", dataType: "bool" },
];

describe("ModbusDriver (mocked modbus-serial)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockModbus(overrides: Record<string, any> = {}) {
    const client = {
      connectTCP: vi.fn(async () => {}),
      setID: vi.fn(),
      setTimeout: vi.fn(),
      readHoldingRegisters: vi.fn(async () => ({ data: [50] })),
      readInputRegisters: vi.fn(async () => ({ data: [10] })),
      readCoils: vi.fn(async () => ({ data: [true] })),
      readDiscreteInputs: vi.fn(async () => ({ data: [false] })),
      close: vi.fn((cb: () => void) => cb()),
      ...overrides,
    };
    function ModbusRTU(this: any) {
      Object.assign(this, client);
    }
    vi.doMock("modbus-serial", () => ({ default: ModbusRTU }));
    return client;
  }

  it("connect → readTags decode + scale/offset; writeTags ok:false; disconnect", async () => {
    mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();

    await d.connect({ endpoint: "tcp://127.0.0.1:502", options: { unitId: 3 } });
    expect(d.isConnected()).toBe(true);

    const samples = await d.readTags(tags);
    const level = samples.find((s) => s.tagKey === "level")!;
    expect(level.value).toBe(100); // 50 * 2
    expect(level.quality).toBe("good");
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.value).toBe(true);

    const w = await d.writeTags([{ tagKey: "run", address: "coil:1", value: true }]);
    expect(w[0].ok).toBe(false);
    expect(w[0].error).toMatch(/HITL only \(F4\)/);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("per-tag read error → quality bad, no crash", async () => {
    mockModbus({
      readHoldingRegisters: vi.fn(async () => {
        throw new Error("timeout");
      }),
    });
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const samples = await d.readTags(tags);
    const level = samples.find((s) => s.tagKey === "level")!;
    expect(level.quality).toBe("bad");
    expect(level.value).toBeNull();
    // other tag still good
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.quality).toBe("good");
  });

  it("readTags throws when not connected", async () => {
    mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  it("connect throws 'modbus-serial not installed' when package missing", async () => {
    vi.doMock("modbus-serial", () => {
      throw new Error("Cannot find module");
    });
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await expect(d.connect({ endpoint: "127.0.0.1" })).rejects.toThrow(/modbus-serial not installed/);
  });
});
