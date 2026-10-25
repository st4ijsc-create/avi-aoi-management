/**
 * Sprint F1.3 — s7Driver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/PLC thật.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(false);
        return 0;
      }),
      dropConnection: vi.fn((cb: () => void) => cb()),
      ...overrides,
    };
    function NodeS7(this: any) {
      Object.assign(this, conn);
    }
    vi.doMock("nodes7", () => ({ default: NodeS7 }));
    return conn;
  }

  it("T12b fix round 1: connect lại trên cùng driver ⇒ phiên cũ bị dropConnection (không rò transport)", async () => {
    const conn = mockNodeS7({ temp: 2, run: true });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });
    expect(conn.dropConnection).toHaveBeenCalledTimes(0);
    await d.connect({ endpoint: "127.0.0.1" });
    expect(conn.dropConnection).toHaveBeenCalledTimes(1);
    expect(d.isConnected()).toBe(true);
    await d.disconnect();
  });

  it("connect → readTags decode + scale/offset; disconnect", async () => {
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

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("writeTags GHI THẬT: ok + inverse scale (scale2 offset10 value110→raw50) + bool", async () => {
    const conn = mockNodeS7({});
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.writeTags([
      { tagKey: "sp", address: "DB1,INT12", value: 110, dataType: "int", scale: 2, offset: 10 },
      { tagKey: "run", address: "M0.0", value: true, dataType: "bool" },
    ]);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(conn.writeItems).toHaveBeenCalledTimes(1);
    const [keys, values] = conn.writeItems.mock.calls[0];
    expect(keys).toEqual(["sp", "run"]);
    expect(values[0]).toBe(50); // (110-10)/2
    expect(values[1]).toBe(true);
  });

  it("writeTags read-only area (I0.0) → ok:false 'register type not writable', writeItems NOT called", async () => {
    const conn = mockNodeS7({});
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.writeTags([{ tagKey: "in", address: "I0.0", value: true, dataType: "bool" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/not writable/);
    expect(conn.writeItems).not.toHaveBeenCalled();
  });

  it("writeTags parse fail isolate (1 sai 1 đúng)", async () => {
    const conn = mockNodeS7({}, {
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(false);
        return 0;
      }),
    });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.writeTags([
      { tagKey: "bad", address: "??invalid??", value: 1, dataType: "int" },
      { tagKey: "ok", address: "DB1,INT0", value: 5, dataType: "int" },
    ]);
    expect(res.find((r) => r.tagKey === "bad")!.ok).toBe(false);
    expect(res.find((r) => r.tagKey === "ok")!.ok).toBe(true);
    const keys = conn.writeItems.mock.calls[0][0];
    expect(keys).toEqual(["ok"]); // chỉ write tag hợp lệ
  });

  it("writeTags busy (writeItems trả 1) → ok:false 'S7 write busy'", async () => {
    mockNodeS7({}, {
      writeItems: vi.fn((_k: string[], _v: unknown[], _cb: (bad: boolean) => void) => 1),
    });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([{ tagKey: "sp", address: "DB1,INT0", value: 1, dataType: "int" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/busy/i);
  });

  it("writeTags bad quality (cb(true)) → ok:false 'bad write quality'", async () => {
    mockNodeS7({}, {
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(true);
        return 0;
      }),
    });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([{ tagKey: "sp", address: "DB1,INT0", value: 1, dataType: "int" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/bad write quality/);
  });

  it("writeTags throws when not connected", async () => {
    mockNodeS7({});
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await expect(d.writeTags([{ tagKey: "sp", address: "DB1,INT0", value: 1 }])).rejects.toThrow(/not connected/);
  });

  it("BAD value (real nodes7 shape: quality string 'BAD 255' in place of the value, anythingBad=true) → quality bad", async () => {
    mockNodeS7({ temp: "BAD 255", run: true }, { readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) => cb(true, { temp: "BAD 255", run: true })) });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });
    const samples = await d.readTags(tags);
    const temp = samples.find((s) => s.tagKey === "temp")!;
    expect(temp.quality).toBe("bad");
    expect(temp.value).toBeNull();
  });

  describe("R1b-2a T13 fix round 2 (I2) — nodes7 BAD sentinel on bool / string tags never reads as a good value", () => {
    const tagsI2: OtTagAddress[] = [
      { tagKey: "temp", address: "DB1,REAL0", dataType: "float" },
      { tagKey: "run", address: "M0.0", dataType: "bool" },
      { tagKey: "name", address: "DB1,CHAR10.20", dataType: "string" },
    ];
    /** Real nodes7 shape, item-level error while the read as a whole succeeded: one item answered, the others carry 'BAD <code>'. */
    const docMotPhanBad = (vals: Record<string, unknown>) =>
      vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => cb(true, vals));
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      ["V2 off", "false"],
      ["V2 on", "true"],
    ] as const)("%s: bool 'BAD 255' ⇒ bad (NOT true), string 'BAD 10' ⇒ bad (NOT the text); the answered item stays good", async (_n, v2) => {
      vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2);
      mockNodeS7({}, { readAllItems: docMotPhanBad({ temp: 1.5, run: "BAD 255", name: "BAD 10" }) });
      const { S7Driver } = await import("./s7Driver");
      const d = new S7Driver();
      await d.connect({ endpoint: "127.0.0.1" });
      const out = await d.readTags(tagsI2);
      const run = out.find((s) => s.tagKey === "run")!;
      const name = out.find((s) => s.tagKey === "name")!;
      expect(out.find((s) => s.tagKey === "temp")!).toMatchObject({ quality: "good", value: 1.5 });
      for (const s of [run, name]) {
        expect(s.quality).toBe("bad");
        expect(s.value).toBeNull();
        if (v2 === "true") {
          // item-level error, read answered ⇒ device_error (answered)
          expect(s.reason).toBe("device_error");
          expect(s.statusCode).toBe("bad_value");
        } else {
          // flag-off shape stays bare (no statusCode / reason), as for every driver
          expect(s.reason).toBeUndefined();
          expect(s.statusCode).toBeUndefined();
        }
      }
    });
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
