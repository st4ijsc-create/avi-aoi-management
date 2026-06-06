/**
 * Sprint F1.3 — mitsubishiMcDriver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/PLC thật.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "level", address: "D100", dataType: "int", scale: 2, offset: 0 },
  { tagKey: "run", address: "M100", dataType: "bool" },
];

describe("MitsubishiMcDriver (mocked mcprotocol)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockMc(values: Record<string, unknown>, overrides: Record<string, any> = {}) {
    const conn: any = {
      initiateConnection: vi.fn((_opts: any, cb: (err?: unknown) => void) => cb()),
      setTranslationCB: vi.fn(),
      addItems: vi.fn(),
      removeItems: vi.fn(),
      readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) =>
        cb(false, values),
      ),
      dropConnection: vi.fn((cb: () => void) => cb()),
      ...overrides,
    };
    function MC(this: any) {
      Object.assign(this, conn);
    }
    vi.doMock("mcprotocol", () => ({ default: MC }));
    return conn;
  }

  it("connect → readTags decode + scale/offset; writeTags ok:false; disconnect", async () => {
    mockMc({ level: 50, run: true });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();

    await d.connect({ endpoint: "tcp://127.0.0.1:1281", options: { ascii: false } });
    expect(d.isConnected()).toBe(true);

    const samples = await d.readTags(tags);
    const level = samples.find((s) => s.tagKey === "level")!;
    expect(level.value).toBe(100); // 50*2
    expect(level.quality).toBe("good");
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.value).toBe(true);

    const w = await d.writeTags([{ tagKey: "run", address: "M100", value: true }]);
    expect(w[0].ok).toBe(false);
    expect(w[0].error).toMatch(/HITL only \(F4\)/);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("BAD value (null) → quality bad", async () => {
    mockMc({ level: null, run: true });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const samples = await d.readTags(tags);
    const level = samples.find((s) => s.tagKey === "level")!;
    expect(level.quality).toBe("bad");
    expect(level.value).toBeNull();
  });

  it("readTags throws when not connected", async () => {
    mockMc({});
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  it("connect throws 'mcprotocol not installed' when package missing", async () => {
    vi.doMock("mcprotocol", () => {
      throw new Error("Cannot find module");
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await expect(d.connect({ endpoint: "127.0.0.1" })).rejects.toThrow(/mcprotocol not installed/);
  });
});
