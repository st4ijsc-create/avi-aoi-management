/**
 * Sprint F1.3 — mitsubishiMcDriver tests với package GIẢ (vi.doMock + vi.resetModules).
 * Không cần lib/PLC thật.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(false);
        return 0;
      }),
      dropConnection: vi.fn((cb: () => void) => cb()),
      ...overrides,
    };
    function MC(this: any) {
      Object.assign(this, conn);
    }
    vi.doMock("mcprotocol", () => ({ default: MC }));
    return conn;
  }

  it("connect → readTags decode + scale/offset; disconnect", async () => {
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

    await d.disconnect();
    expect(d.isConnected()).toBe(false);
  });

  it("writeTags GHI THẬT: ok + inverse scale (scale2 offset10 value110→raw50) + bool", async () => {
    const conn = mockMc({}, {
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(false);
        return 0;
      }),
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.writeTags([
      { tagKey: "sp", address: "D100", value: 110, dataType: "int", scale: 2, offset: 10 },
      { tagKey: "run", address: "M100", value: true, dataType: "bool" },
    ]);
    expect(res.every((r) => r.ok)).toBe(true);
    const [keys, values] = conn.writeItems.mock.calls[0];
    expect(keys).toEqual(["sp", "run"]);
    expect(values[0]).toBe(50); // (110-10)/2
    expect(values[1]).toBe(true);
  });

  it("writeTags read-only device (X) → ok:false 'register type not writable', writeItems NOT called", async () => {
    const conn = mockMc({}, { writeItems: vi.fn() });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.writeTags([{ tagKey: "in", address: "X10", value: true, dataType: "bool" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/not writable/);
    expect(conn.writeItems).not.toHaveBeenCalled();
  });

  it("writeTags parse fail isolate (1 sai 1 đúng)", async () => {
    const conn = mockMc({}, {
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(false);
        return 0;
      }),
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });

    const res = await d.writeTags([
      { tagKey: "bad", address: "??", value: 1, dataType: "int" },
      { tagKey: "ok", address: "D0", value: 5, dataType: "int" },
    ]);
    expect(res.find((r) => r.tagKey === "bad")!.ok).toBe(false);
    expect(res.find((r) => r.tagKey === "ok")!.ok).toBe(true);
    expect(conn.writeItems.mock.calls[0][0]).toEqual(["ok"]);
  });

  it("writeTags busy (writeItems trả 1) → ok:false 'MC write busy'", async () => {
    mockMc({}, { writeItems: vi.fn(() => 1) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([{ tagKey: "sp", address: "D0", value: 1, dataType: "int" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/busy/i);
  });

  it("writeTags bad quality (cb(true)) → ok:false 'bad write quality'", async () => {
    mockMc({}, {
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        cb(true);
        return 0;
      }),
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const res = await d.writeTags([{ tagKey: "sp", address: "D0", value: 1, dataType: "int" }]);
    expect(res[0].ok).toBe(false);
    expect(res[0].error).toMatch(/bad write quality/);
  });

  it("writeTags throws when not connected", async () => {
    mockMc({});
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await expect(d.writeTags([{ tagKey: "sp", address: "D0", value: 1 }])).rejects.toThrow(/not connected/);
  });

  it("BAD value (real mcprotocol shape: quality string 'BAD 255' in place of the value, anythingBad=true) → quality bad", async () => {
    mockMc({}, { readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) => cb(true, { level: "BAD 255", run: true })) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const samples = await d.readTags(tags);
    const level = samples.find((s) => s.tagKey === "level")!;
    expect(level.quality).toBe("bad");
    expect(level.value).toBeNull();
  });

  describe("R1b-2a T13 fix round 2 (I2) — mcprotocol BAD sentinel on bool / string tags never reads as a good value", () => {
    const tagsI2: OtTagAddress[] = [
      { tagKey: "level", address: "D100", dataType: "int" },
      { tagKey: "run", address: "M100", dataType: "bool" },
      { tagKey: "name", address: "D200", dataType: "string" },
    ];
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it.each([
      ["V2 off", "false"],
      ["V2 on", "true"],
    ] as const)("%s: bool 'BAD 255' ⇒ bad (NOT true), string 'BAD 255' ⇒ bad (NOT the text); the answered item stays good", async (_n, v2) => {
      vi.stubEnv("OT_CHAT_LUONG_V2_ENABLED", v2);
      // Real mcprotocol shape, item-level error while the read as a whole succeeded (one item answered).
      mockMc({}, { readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) => cb(true, { level: 7, run: "BAD 255", name: "BAD 255" })) });
      const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
      const d = new MitsubishiMcDriver();
      await d.connect({ endpoint: "127.0.0.1" });
      const out = await d.readTags(tagsI2);
      expect(out.find((s) => s.tagKey === "level")!).toMatchObject({ quality: "good", value: 7 });
      for (const k of ["run", "name"]) {
        const s = out.find((x) => x.tagKey === k)!;
        expect(s.quality).toBe("bad");
        expect(s.value).toBeNull();
        if (v2 === "true") {
          expect(s.reason).toBe("device_error");
          expect(s.statusCode).toBe("bad_value");
        } else {
          expect(s.reason).toBeUndefined();
          expect(s.statusCode).toBeUndefined();
        }
      }
    });
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
