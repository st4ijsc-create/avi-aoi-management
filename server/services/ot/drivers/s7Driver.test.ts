/**
 * Sprint F1.3 — s7Driver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/PLC thật.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { OtTagAddress } from "../otDriver";

const tags: OtTagAddress[] = [
  { tagKey: "temp", address: "DB1,REAL0", dataType: "float", scale: 10, offset: 1 },
  { tagKey: "run", address: "M0.0", dataType: "bool" },
];

describe("S7Driver (mocked nodes7)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  function mockNodeS7(values: Record<string, unknown>, overrides: Record<string, any> = {}) {
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
    function NodeS7(this: any) {
      Object.assign(this, conn);
    }
    vi.doMock("nodes7", () => ({ default: NodeS7 }));
    return conn;
  }

  it("connect → readTags decode + scale/offset; writeTags ok:false; disconnect", async () => {
    mockNodeS7({ temp: 2, run: true });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();

    await d.connect({ endpoint: "tcp://127.0.0.1:102", options: { slot: 1 } });
    expect(d.isConnected()).toBe(true);

    const samples = await d.readTags(tags);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.value).toBe(21); // 2*10+1
    expect(temp.quality).toBe("good");
    const run = samples.find((s) => s.tagKey === "run")!;
    expect(run.value).toBe(true);

    const w = await d.writeTags([{ tagKey: "run", address: "M0.0", value: true }]);
    expect(w[0].ok).toBe(false);
    expect(w[0].error).toMatch(/HITL only \(F4\)/);

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("BAD value (null) → quality bad", async () => {
    mockNodeS7({ temp: null, run: true });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });
    const samples = await d.readTags(tags);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.quality).toBe("bad");
    expect(temp.value).toBeNull();
  });

  it("readTags throws when not connected", async () => {
    mockNodeS7({});
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await expect(d.readTags(tags)).rejects.toThrow(/not connected/);
  });

  it("connect throws 'nodes7 not installed' when package missing", async () => {
    vi.doMock("nodes7", () => {
      throw new Error("Cannot find module");
    });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await expect(d.connect({ endpoint: "127.0.0.1" })).rejects.toThrow(/nodes7 not installed/);
  });
});
