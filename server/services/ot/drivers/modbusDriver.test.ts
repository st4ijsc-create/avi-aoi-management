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
      writeCoil: vi.fn(async () => ({})),
      writeRegister: vi.fn(async () => ({})),
      writeRegisters: vi.fn(async () => ({})),
      close: vi.fn((cb: () => void) => cb()),
      ...overrides,
    };
    function ModbusRTU(this: any) {
      Object.assign(this, client);
    }
    vi.doMock("modbus-serial", () => ({ default: ModbusRTU }));
    return client;
  }

  it("connect → readTags decode + scale/offset; disconnect", async () => {
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

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("F4b writeTags coil → writeCoil(Boolean); ok:true", async () => {
    const client = mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([{ tagKey: "run", address: "coil:1", value: 1, dataType: "bool" }]);
    expect(res[0].ok).toBe(true);
    expect(client.writeCoil).toHaveBeenCalledWith(0, true);
    expect(client.writeRegister).not.toHaveBeenCalled();
  });

  it("F4b writeTags holding int → writeRegister(raw) with inverse scale", async () => {
    const client = mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    // level: holding 40001, int scale 2 → user 100 → raw 50.
    const res = await d.writeTags([
      { tagKey: "level", address: "40001", value: 100, dataType: "int", scale: 2, offset: 0 },
    ]);
    expect(res[0].ok).toBe(true);
    expect(client.writeRegister).toHaveBeenCalledWith(0, 50);
  });

  it("F4b writeTags holding float → writeRegisters(2 words)", async () => {
    const client = mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([
      { tagKey: "sp", address: "40010", value: 1.0, dataType: "float", scale: 1, offset: 0 },
    ]);
    expect(res[0].ok).toBe(true);
    expect(client.writeRegisters).toHaveBeenCalledTimes(1);
    const [reg, words] = (client.writeRegisters as any).mock.calls[0];
    expect(reg).toBe(9); // 40010 → register 9
    expect(words).toEqual([0x3f80, 0x0000]); // 1.0 big word order
  });

  it("F4b writeTags input/discrete register → ok:false 'not writable'", async () => {
    const client = mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([
      { tagKey: "ro", address: "30001", value: 5, dataType: "int" },
    ]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/not writable/);
    expect(client.writeRegister).not.toHaveBeenCalled();
  });

  it("F4b writeTags: write lib error → ok:false (no crash)", async () => {
    const client = mockModbus({
      writeRegister: vi.fn(async () => {
        throw new Error("modbus exception 2");
      }),
    });
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([
      { tagKey: "level", address: "40001", value: 10, dataType: "int", scale: 1, offset: 0 },
    ]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/modbus exception 2/);
    expect(client).toBeDefined();
  });

  it("F4b writeTags: throws when not connected", async () => {
    mockModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await expect(
      d.writeTags([{ tagKey: "run", address: "coil:1", value: true }]),
    ).rejects.toThrow(/not connected/);
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
