/**
 * SCADA R0 Task 3 — driver dùng vòng poll chung + chất lượng 3 mức (C1 ở driver, C2), sau cờ OT_CHAT_LUONG_V2_ENABLED.
 *
 * Modbus chạy với ServerTCP THẬT trong tiến trình (127.0.0.1, cổng do hệ điều hành cấp); OPC UA/S7/MC/EIP dùng package GIẢ
 * (vi.doMock) như các test driver cũ. Cờ TẮT ⇒ đúng hành vi cũ (ca bảo vệ đường lui nằm cạnh ca cờ BẬT).
 */
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerTCP } from "modbus-serial";
import type { OtSample, OtTagAddress, SuKienDoc } from "../otDriver";

const FLAG = "OT_CHAT_LUONG_V2_ENABLED";

async function waitFor(cond: () => boolean, maxMs: number, stepMs = 10): Promise<number> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > maxMs) throw new Error(`waitFor quá hạn ${maxMs}ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return Date.now() - t0;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  vi.resetModules();
});
/** Mọi handle subscribe được đóng ở afterEach, kể cả khi assertion ném giữa chừng. */
const dongSau: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.useRealTimers();
  while (dongSau.length) await dongSau.pop()!().catch(() => undefined);
  vi.unstubAllEnvs();
  vi.doUnmock("node-opcua");
  vi.doUnmock("nodes7");
  vi.doUnmock("mcprotocol");
  vi.doUnmock("st-ethernet-ip");
});

// ─────────────────────────────── Modbus (server THẬT) ───────────────────────────────
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

interface ModbusSim {
  port: number;
  close(): Promise<void>;
}

/** Thanh ghi `loiAddr` trả Modbus exception 2 (Illegal Data Address); `treoAddrs` không bao giờ trả lời; còn lại trả 100 + địa chỉ. */
async function startModbusSim(loiAddr: number | null, treoAddrs: number[] = []): Promise<ModbusSim> {
  const port = await freePort();
  const vector = {
    // 3 tham số ⇒ modbus-serial gọi kiểu callback (cho phép trả exception).
    getHoldingRegister: (addr: number, _unit: number, cb: (err: unknown, v?: number) => void) => {
      if (treoAddrs.includes(addr)) return; // KHÔNG BAO GIỜ trả lời ⇒ client chờ hạn giao dịch (mô phỏng PLC ngừng đáp giữa tick)
      if (loiAddr !== null && addr === loiAddr) cb({ modbusErrorCode: 2 });
      else cb(null, 100 + addr);
    },
    getInputRegister: () => 0,
    getCoil: () => false,
    getDiscreteInput: () => false,
    setRegister: () => undefined,
    setCoil: () => undefined,
  };
  const srv = new ServerTCP(vector as never, { host: "127.0.0.1", port, unitID: 1 });
  await new Promise<void>((resolve, reject) => {
    srv.once("initialized", () => resolve());
    srv.once("serverError", reject);
  });
  let da = false;
  return {
    port,
    close: () =>
      da
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            da = true;
            srv.close(() => resolve());
          }),
  };
}

const mbTags: OtTagAddress[] = [
  { tagKey: "a", address: "40001", dataType: "int" },
  { tagKey: "b", address: "40006", dataType: "int" },
];

describe("Modbus × server THẬT trong tiến trình", () => {
  const cleanups: Array<() => Promise<unknown>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!().catch(() => undefined);
  });

  async function ketNoi(sim: ModbusSim, timeoutMs = 1000) {
    const { createModbusDriver } = await import("./modbusDriver");
    const d = createModbusDriver();
    await d.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs });
    cleanups.push(() => d.disconnect());
    return d;
  }

  it("cờ BẬT: exception 2 ở một thanh ghi ⇒ tag đó bad / modbus_exc_02 / config_error; tag khác good", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(5);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim);
    const out = await d.readTags(mbTags);
    const a = out.find((s) => s.tagKey === "a")!;
    const b = out.find((s) => s.tagKey === "b")!;
    expect(a.quality).toBe("good");
    expect(a.value).toBe(100);
    expect(b.quality).toBe("bad");
    expect(b.value).toBeNull();
    expect(b.statusCode).toBe("modbus_exc_02");
    expect(b.reason).toBe("config_error");
  });

  it("cờ TẮT: cùng exception ⇒ bad TRẦN (không statusCode/reason) — hình dạng cũ", async () => {
    const sim = await startModbusSim(5);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim);
    const b = (await d.readTags(mbTags)).find((s) => s.tagKey === "b")!;
    expect(b.quality).toBe("bad");
    expect(b.statusCode).toBeUndefined();
    expect(b.reason).toBeUndefined();
  });

  it("cờ BẬT: đóng server giữa chừng, subscribe(…,200,{deadlineMs:150}) ⇒ ≤ 2 chu kỳ mọi tag nhận mẫu bad/comm_lost", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(null);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim);
    const got: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe(mbTags, (s) => void got.push(s), 200, { deadlineMs: 150, onTick: (e) => void ticks.push(e) });
    cleanups.push(() => h.close());
    await waitFor(() => mbTags.every((t) => got.some((s) => s.tagKey === t.tagKey && s.quality === "good")), 3000);
    const nCoGood = got.length;
    expect(ticks.some((e) => e.ok)).toBe(true);

    await sim.close();
    const tClose = Date.now();
    await waitFor(
      () => mbTags.every((t) => got.slice(nCoGood).some((s) => s.tagKey === t.tagKey && s.quality === "bad" && s.reason === "comm_lost")),
      2000,
    );
    // Mục tiêu thiết kế ≤ 2 chu kỳ (2×200 ms) + hạn đọc 150 ms = 550 ms; chặn trên nới 3× (1650 ms) để không đỏ oan khi máy chậm.
    expect(Date.now() - tClose).toBeLessThanOrEqual(3 * (400 + 150));
    expect(ticks.some((e) => !e.ok)).toBe(true);
    // Đúng MỘT loạt: các tick lỗi sau đó im lặng (kiểm bằng số đếm, không bằng đồng hồ).
    await sleep(700);
    expect(got.slice(nCoGood).filter((s) => s.quality === "bad")).toHaveLength(mbTags.length);
  });

  it("cờ TẮT: đóng server giữa chừng ⇒ KHÔNG có mẫu nào được phát (mất kết nối không sinh mẫu — hành vi cũ)", async () => {
    const sim = await startModbusSim(null);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim);
    const got: OtSample[] = [];
    const h = await d.subscribe(mbTags, (s) => void got.push(s), 100, { deadlineMs: 80 });
    cleanups.push(() => h.close());
    await waitFor(() => mbTags.every((t) => got.some((s) => s.tagKey === t.tagKey && s.quality === "good")), 3000);
    await sleep(15); // để lô đang phát (nếu còn) trôi hết trước khi đóng
    await sim.close();
    const nSauDong = got.length;
    await sleep(700); // ≥ 6 chu kỳ
    expect(got.length).toBe(nSauDong);
    expect(got.slice(nSauDong)).toEqual([]);
  });

  // PLC ngừng đáp giữa tick: a đọc được, b/c/d treo (không bao giờ trả lời); hạn giao dịch 400 ms.
  const mbTags4: OtTagAddress[] = [
    { tagKey: "a", address: "40001", dataType: "int" },
    { tagKey: "b", address: "40006", dataType: "int" },
    { tagKey: "c", address: "40007", dataType: "int" },
    { tagKey: "d", address: "40008", dataType: "int" },
  ];

  it("cờ BẬT (F3): MỘT thanh ghi không bao giờ đáp ⇒ chỉ tag đó bad/comm_lost MỖI tick; các tag khác good MỖI tick (không câm, không loạt)", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(null, [5]); // chỉ b treo
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim, 300);
    const got: OtSample[] = [];
    const h = await d.subscribe(mbTags4, (s) => void got.push(s), 100);
    cleanups.push(() => h.close());
    const dem = (k: string, q: string) => got.filter((s) => s.tagKey === k && s.quality === q).length;
    await waitFor(() => dem("b", "bad") >= 2 && ["a", "c", "d"].every((k) => dem(k, "good") >= 2), 10_000);
    for (const k of ["a", "c", "d"]) expect(dem(k, "bad")).toBe(0); // tag khoẻ KHÔNG bao giờ bị phủ bad
    expect(dem("b", "good")).toBe(0);
    const bBad = got.filter((s) => s.tagKey === "b");
    expect(bBad.every((s) => s.reason === "comm_lost" && s.statusCode === "timeout" && s.value === null)).toBe(true);
  });

  it("cờ BẬT (F3): server đóng socket GIỮA tick (một thanh ghi đang chờ) ⇒ lỗi mức liên kết ⇒ đúng MỘT loạt bad/comm_lost cho cả 4 tag", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(null, [5]);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim, 2500); // hạn giao dịch DÀI: loạt phải đến từ việc socket đóng, không từ timeout
    const got: OtSample[] = [];
    const h = await d.subscribe(mbTags4, (s) => void got.push(s), 100);
    cleanups.push(() => h.close());
    await sleep(500); // tick đầu đang kẹt ở thanh ghi b
    expect(got).toHaveLength(0); // chưa có mẫu nào (tick chưa xong)
    await sim.close();
    await waitFor(() => got.length >= mbTags4.length, 8000);
    await sleep(600);
    expect(got).toHaveLength(mbTags4.length);
    expect(got.map((s) => s.tagKey).sort()).toEqual(["a", "b", "c", "d"]);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.value === null)).toBe(true);
  });

  it("cờ BẬT: readTags CÔNG KHAI (readback/probe/bộ đọc an toàn) KHÔNG huỷ: thanh ghi không đáp ⇒ trả mẫu bad theo từng tag, không ném", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(null, [5, 6, 7]);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim, 400);
    const t0 = Date.now();
    const out = await d.readTags(mbTags4); // không ném
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1100); // vẫn đọc tuần tự, mỗi tag treo chờ hạn riêng
    expect(out.map((s) => s.tagKey)).toEqual(["a", "b", "c", "d"]);
    expect(out.map((s) => s.quality)).toEqual(["good", "bad", "bad", "bad"]);
    expect(out[1].reason).toBe("comm_lost"); // vẫn nói vì sao (C2) nhưng không huỷ
  });

  it("cờ TẮT: cùng tình huống ⇒ đúng hành vi cũ: đọc tuần tự, mỗi tag treo chờ hạn riêng, mẫu bad TRẦN theo từng tag", async () => {
    const sim = await startModbusSim(null, [5, 6, 7]);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim, 400);
    const t0 = Date.now();
    const out = await d.readTags(mbTags4);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1100); // 3 × ~400 ms
    expect(out.map((s) => s.quality)).toEqual(["good", "bad", "bad", "bad"]);
    expect(out.slice(1).every((s) => s.statusCode === undefined && s.reason === undefined)).toBe(true);
  });
});

// ─────────────────────────────── OPC UA (package giả) ───────────────────────────────
const opcTags: OtTagAddress[] = [{ tagKey: "temp", address: "ns=2;s=Temp", dataType: "float", scale: 10, offset: 1 }];

function mockOpcua(sc: { value: number; name?: string }, value: unknown = 2) {
  const session = {
    read: vi.fn(async (nodes: unknown[]) =>
      (nodes as unknown[]).map(() => ({ statusCode: sc, sourceTimestamp: new Date(), value: { value } })),
    ),
    write: vi.fn(async () => []),
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
    DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
    Variant: class {},
  }));
  return { session, client };
}

async function opcuaConnected() {
  const { OpcuaDriver } = await import("./opcuaDriver");
  const d = new OpcuaDriver();
  await d.connect({ endpoint: "opc.tcp://localhost:4840" });
  return d;
}

describe("OPC UA readTags × chất lượng", () => {
  it("cờ BẬT: statusCode 0x40920000 ⇒ uncertain, GIỮ giá trị (không null), kèm statusCode + reason", async () => {
    vi.stubEnv(FLAG, "true");
    mockOpcua({ value: 0x40920000, name: "UncertainLastUsableValue" });
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.quality).toBe("uncertain");
    expect(s.value).toBe(21); // 2*10+1
    expect(s.value).not.toBeNull();
    expect(s.statusCode).toContain("0x40920000");
    expect(s.reason).toBe("device_error");
  });

  it("cờ BẬT: bad comm_lost (0x80310000) ⇒ bad, value null, reason comm_lost", async () => {
    vi.stubEnv(FLAG, "true");
    mockOpcua({ value: 0x80310000, name: "BadNoCommunication" });
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
    expect(s.reason).toBe("comm_lost");
  });

  it.each([0x00300000, 0x00960000, 0x00000400])(
    "cờ BẬT (F1): mã GOOD có mã con/bit thông tin (decimal %i) ⇒ good, giữ giá trị, không statusCode/reason",
    async (sc) => {
      vi.stubEnv(FLAG, "true");
      mockOpcua({ value: sc, name: "GoodSubCode" });
      const d = await opcuaConnected();
      const [s] = await d.readTags(opcTags);
      expect(s.quality).toBe("good");
      expect(s.value).toBe(21);
      expect(s.statusCode).toBeUndefined();
      expect(s.reason).toBeUndefined();
    },
  );

  it("cờ TẮT: mã good có mã con (0x00300000) ⇒ bad như cũ (đường lui)", async () => {
    mockOpcua({ value: 0x00300000, name: "GoodClamped" });
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
  });

  it("F4: session.read không bao giờ trả lời ⇒ readTags reject trong timeoutMs + 1000 (không cờ)", async () => {
    const { session } = mockOpcua({ value: 0 });
    session.read = vi.fn(() => new Promise(() => undefined)) as never;
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://localhost:4840", timeoutMs: 1000 });
    vi.useFakeTimers();
    let ketCuc: "treo" | "reject" = "treo";
    const p = d.readTags(opcTags).catch((e) => {
      ketCuc = "reject";
      return e as Error;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(ketCuc).toBe("treo");
    await vi.advanceTimersByTimeAsync(2);
    const err = await p;
    expect(ketCuc).toBe("reject");
    expect(String((err as Error).message)).toMatch(/opcua read timeout after 2000ms/);
  });

  it("cờ BẬT: bit thông tin thấp (0x80310400) vẫn là comm_lost", async () => {
    vi.stubEnv(FLAG, "true");
    mockOpcua({ value: 0x80310400, name: "BadNoCommunication" });
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.reason).toBe("comm_lost");
  });

  it("cờ TẮT (đường lui): 0x40920000 ⇒ bad, value null, không reason — đúng hành vi cũ", async () => {
    mockOpcua({ value: 0x40920000, name: "UncertainLastUsableValue" });
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
    expect(s.reason).toBeUndefined();
    expect(s.statusCode).toContain("0x40920000");
  });

  it("cờ BẬT: địa chỉ không phân giải ⇒ chỉ tag đó bad / config_error", async () => {
    vi.stubEnv(FLAG, "true");
    mockOpcua({ value: 0 });
    const d = await opcuaConnected();
    const out = await d.readTags([...opcTags, { tagKey: "x", address: "garbage-not-a-node", dataType: "float" }]);
    const x = out.find((s) => s.tagKey === "x")!;
    expect(x.quality).toBe("bad");
    expect(x.reason).toBe("config_error");
    expect(out.find((s) => s.tagKey === "temp")!.quality).toBe("good");
  });

  it("đường poll của subscribe đi qua vòng poll chung: onTick được gọi", async () => {
    mockOpcua({ value: 0 });
    const d = await opcuaConnected();
    const ticks: SuKienDoc[] = [];
    const got: OtSample[] = [];
    const h = await d.subscribe(opcTags, (s) => void got.push(s), 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length > 0, 2000);
    await h.close();
    expect(ticks[0].ok).toBe(true);
    expect(got.length).toBeGreaterThan(0);
  });
});

describe("OPC UA đường monitored-items (push)", () => {
  async function dung() {
    const { session } = mockOpcua({ value: 0 });
    const subscription = { terminate: vi.fn(async () => {}) };
    (session as unknown as Record<string, unknown>).createSubscription2 = vi.fn(async () => subscription);
    const items: Array<{ fire: (dv: unknown) => void }> = [];
    vi.doMock("node-opcua", () => ({
      OPCUAClient: {
        create: vi.fn(() => ({ connect: vi.fn(async () => {}), createSession: vi.fn(async () => session), disconnect: vi.fn(async () => {}) })),
      },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant: class {},
      ClientSubscription: { create: vi.fn(async () => subscription) },
      ClientMonitoredItem: {
        create: vi.fn(async () => {
          let h: ((dv: unknown) => void) | null = null;
          const item = {
            on: (evt: string, cb: (dv: unknown) => void) => {
              if (evt === "changed") h = cb;
            },
            fire: (dv: unknown) => h?.(dv),
          };
          items.push(item);
          return item;
        }),
      },
      TimestampsToReturn: { Both: 2 },
      MonitoringMode: { Reporting: 1 },
    }));
    vi.stubEnv("OT_OPCUA_MONITORED_ITEMS", "true");
    const d = await opcuaConnected();
    const got: OtSample[] = [];
    const h = await d.subscribe(opcTags, (s) => void got.push(s), 1000);
    dongSau.push(() => h.close());
    return { got, items, h };
  }

  it("cờ BẬT: thay đổi uncertain (0x40920000) ⇒ uncertain, giữ giá trị", async () => {
    vi.stubEnv(FLAG, "true");
    const { got, items, h } = await dung();
    items[0].fire({ statusCode: { value: 0x40920000 }, sourceTimestamp: new Date(), value: { value: 2 } });
    expect(got[0].quality).toBe("uncertain");
    expect(got[0].value).toBe(21);
    expect(got[0].reason).toBe("device_error");
    await h.close();
  });

  it("cờ TẮT: cùng thay đổi ⇒ bad, value null (hành vi cũ)", async () => {
    const { got, items, h } = await dung();
    items[0].fire({ statusCode: { value: 0x40920000 }, sourceTimestamp: new Date(), value: { value: 2 } });
    expect(got[0].quality).toBe("bad");
    expect(got[0].value).toBeNull();
    expect(got[0].reason).toBeUndefined();
    await h.close();
  });
});

// ─────────────────────────────── S7 / MC (package giả) ───────────────────────────────
function mockNodes(lib: "nodes7" | "mcprotocol", values: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const conn: Record<string, unknown> = {
    initiateConnection: vi.fn((_o: unknown, cb: (err?: unknown) => void) => cb()),
    setTranslationCB: vi.fn(),
    addItems: vi.fn(),
    removeItems: vi.fn(),
    readAllItems: vi.fn((cb: (bad: boolean, vals: Record<string, unknown>) => void) => cb(false, values)),
    writeItems: vi.fn(),
    dropConnection: vi.fn((cb: () => void) => cb()),
    ...overrides,
  };
  function Lib(this: Record<string, unknown>) {
    Object.assign(this, conn);
  }
  vi.doMock(lib, () => ({ default: Lib }));
  return conn;
}

const s7Tags: OtTagAddress[] = [
  { tagKey: "t1", address: "DB1,REAL0", dataType: "float" },
  { tagKey: "t2", address: "XYZ", dataType: "float" },
];

describe("S7", () => {
  it("readAllItems KHÔNG BAO GIỜ resolve ⇒ readTags reject trong timeoutMs + 1000 (không cờ — C5)", async () => {
    mockNodes("nodes7", {}, { readAllItems: vi.fn() });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102", timeoutMs: 1000 });
    vi.useFakeTimers();
    let ketCuc: "treo" | "reject" = "treo";
    const p = d.readTags([s7Tags[0]]).catch((e) => {
      ketCuc = "reject";
      return e as Error;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(ketCuc).toBe("treo");
    await vi.advanceTimersByTimeAsync(2);
    const err = await p;
    expect(ketCuc).toBe("reject");
    expect(String((err as Error).message)).toMatch(/s7 readAllItems timeout after 2000ms/);
  });

  it("cờ BẬT: địa chỉ 'XYZ' ở tag 2 ⇒ tag 1 good, tag 2 bad / config_error; chỉ tag hợp lệ được nạp vào lib", async () => {
    vi.stubEnv(FLAG, "true");
    const conn = mockNodes("nodes7", { t1: 1.5 });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const out = await d.readTags(s7Tags);
    const t1 = out.find((s) => s.tagKey === "t1")!;
    const t2 = out.find((s) => s.tagKey === "t2")!;
    expect(t1.quality).toBe("good");
    expect(t1.value).toBe(1.5);
    expect(t2.quality).toBe("bad");
    expect(t2.value).toBeNull();
    expect(t2.reason).toBe("config_error");
    expect(conn.addItems).toHaveBeenCalledWith(["t1"]);
  });

  it("cờ TẮT: địa chỉ sai ⇒ readTags ném như cũ (cả lô)", async () => {
    mockNodes("nodes7", { t1: 1.5 });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    await expect(d.readTags(s7Tags)).rejects.toThrow(/invalid S7 address/);
  });

  it("subscribe đi qua vòng poll chung: onTick được gọi", async () => {
    mockNodes("nodes7", { t1: 1.5 });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const ticks: SuKienDoc[] = [];
    const got: OtSample[] = [];
    const h = await d.subscribe([s7Tags[0]], (s) => void got.push(s), 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length > 0, 2000);
    await h.close();
    expect(ticks[0].ok).toBe(true);
    expect(got[0].quality).toBe("good");
  });
});

describe("Mitsubishi MC", () => {
  const mcTags: OtTagAddress[] = [
    { tagKey: "t1", address: "D100", dataType: "int" },
    { tagKey: "t2", address: "ZZZ", dataType: "int" },
  ];

  it("cờ BẬT: địa chỉ sai ở tag 2 ⇒ tag 1 good, tag 2 bad / config_error", async () => {
    vi.stubEnv(FLAG, "true");
    const conn = mockNodes("mcprotocol", { t1: 7 });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const out = await d.readTags(mcTags);
    expect(out.find((s) => s.tagKey === "t1")!.quality).toBe("good");
    const t2 = out.find((s) => s.tagKey === "t2")!;
    expect(t2.quality).toBe("bad");
    expect(t2.reason).toBe("config_error");
    expect(conn.addItems).toHaveBeenCalledWith(["t1"]);
  });

  it("cờ TẮT: địa chỉ sai ⇒ readTags ném như cũ", async () => {
    mockNodes("mcprotocol", { t1: 7 });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    await expect(d.readTags(mcTags)).rejects.toThrow();
  });

  it("subscribe đi qua vòng poll chung: onTick được gọi", async () => {
    mockNodes("mcprotocol", { t1: 7 });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe([mcTags[0]], () => undefined, 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length > 0, 2000);
    await h.close();
    expect(ticks[0].ok).toBe(true);
  });
});

// ─────────────────────────────── SLMP (transact giả lỗi mạng) ───────────────────────────────
describe("SLMP huỷ tick khi mất liên lạc", () => {
  const slmpTags: OtTagAddress[] = [
    { tagKey: "a", address: "D0", dataType: "int" },
    { tagKey: "b", address: "D1", dataType: "int" },
    { tagKey: "c", address: "D2", dataType: "int" },
  ];

  async function dung() {
    const { SlmpDriver } = await import("./slmpDriver");
    const d = new SlmpDriver();
    const anyD = d as unknown as { connected: boolean; socket: unknown; transact: ReturnType<typeof vi.fn> };
    anyD.connected = true;
    anyD.socket = {};
    anyD.transact = vi.fn(async () => {
      throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    });
    return { d, anyD };
  }

  it("cờ BẬT: readTags CÔNG KHAI không huỷ ⇒ 3 giao dịch, 3 mẫu bad/comm_lost, không ném", async () => {
    vi.stubEnv(FLAG, "true");
    const { d, anyD } = await dung();
    const out = await d.readTags(slmpTags);
    expect(anyD.transact).toHaveBeenCalledTimes(3);
    expect(out.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "ECONNRESET")).toBe(true);
  });

  it("cờ BẬT: đường poll HUỶ ở giao dịch đầu ⇒ subscribe phát đúng MỘT loạt 3 mẫu bad/comm_lost (mỗi tick chỉ 1 giao dịch)", async () => {
    vi.stubEnv(FLAG, "true");
    const { d, anyD } = await dung();
    const got: OtSample[] = [];
    const h = await d.subscribe(slmpTags, (s) => void got.push(s), 30);
    dongSau.push(() => h.close());
    await waitFor(() => got.length >= 3, 2000);
    await sleep(200); // thêm vài tick lỗi cùng đợt ⇒ im lặng
    await h.close();
    expect(got).toHaveLength(3);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost")).toBe(true);
    // mỗi tick lỗi chỉ tốn 1 giao dịch (huỷ), không phải 3
    expect(anyD.transact.mock.calls.length).toBeLessThan(3 * 3);
  });

  it("cờ TẮT: như cũ ⇒ 3 giao dịch, 3 mẫu bad trần", async () => {
    const { d, anyD } = await dung();
    const out = await d.readTags(slmpTags);
    expect(anyD.transact).toHaveBeenCalledTimes(3);
    expect(out.every((s) => s.quality === "bad" && s.reason === undefined && s.statusCode === undefined)).toBe(true);
  });
});

// ─────────────────────────────── EtherNet/IP (package giả) ───────────────────────────────
describe("EtherNet/IP", () => {
  const eipTags: OtTagAddress[] = [{ tagKey: "temp", address: "Temperature", dataType: "float" }];

  function mockEip(readTag: (tag: { name: string; value?: unknown }) => Promise<void>) {
    const plc = {
      connect: vi.fn(async () => {}),
      newTag: vi.fn((name: string) => ({ name, value: undefined as unknown })),
      readTag: vi.fn(readTag),
      writeTag: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
    };
    vi.doMock("st-ethernet-ip", () => ({ Controller: function () { return plc; } }));
  }

  it("cờ BẬT: lỗi thiết bị (không phải mạng) ⇒ bad theo từng tag / statusCode = message / device_error", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async () => {
      throw Object.assign(new Error("tag does not exist"), { code: "EIP_ERR_17" });
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const [s] = await d.readTags(eipTags);
    expect(s.quality).toBe("bad");
    expect(s.statusCode).toBe("tag does not exist");
    expect(s.reason).toBe("device_error");
  });

  it("cờ BẬT: thông điệp dài ⇒ statusCode cắt 80 ký tự", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async () => {
      throw new Error("x".repeat(200));
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const [s] = await d.readTags(eipTags);
    expect(s.statusCode).toBe("x".repeat(80));
    expect(s.reason).toBe("device_error");
  });

  it("cờ BẬT: lỗi mạng (ECONNRESET) ⇒ readTags công khai KHÔNG ném (bad/comm_lost theo từng tag); đường poll phát đúng MỘT loạt", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const hai: OtTagAddress[] = [...eipTags, { tagKey: "t2", address: "Other", dataType: "float" }];
    const truc = await d.readTags(hai); // công khai: không huỷ
    expect(truc).toHaveLength(2);
    expect(truc.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "ECONNRESET")).toBe(true);
    const got: OtSample[] = [];
    const h = await d.subscribe(hai, (s) => void got.push(s), 30);
    dongSau.push(() => h.close());
    await sleep(300);
    await h.close();
    expect(got).toHaveLength(2);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "ECONNRESET")).toBe(true);
  });

  it("cờ BẬT (F3): giao dịch QUÁ HẠN ở một tag ⇒ chỉ tag đó bad/comm_lost, tag khác vẫn good (đường poll không huỷ tick)", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async (tag) => {
      if (tag.name === "Other") throw Object.assign(new Error("request timed out"), { name: "TimeoutError" });
      tag.value = 5;
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const hai: OtTagAddress[] = [...eipTags, { tagKey: "t2", address: "Other", dataType: "float" }];
    const got: OtSample[] = [];
    const h = await d.subscribe(hai, (s) => void got.push(s), 30);
    dongSau.push(() => h.close());
    await waitFor(() => got.filter((s) => s.tagKey === "t2").length >= 2 && got.filter((s) => s.tagKey === "temp").length >= 2, 3000);
    expect(got.filter((s) => s.tagKey === "temp").every((s) => s.quality === "good")).toBe(true);
    expect(got.filter((s) => s.tagKey === "t2").every((s) => s.quality === "bad" && s.reason === "comm_lost")).toBe(true);
  });

  it("cờ TẮT: lỗi mạng ⇒ bad TRẦN theo từng tag như cũ (readTags không ném)", async () => {
    mockEip(async () => {
      throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const hai: OtTagAddress[] = [...eipTags, { tagKey: "t2", address: "Other", dataType: "float" }];
    const out = await d.readTags(hai);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.quality === "bad" && s.reason === undefined && s.statusCode === undefined)).toBe(true);
  });

  it("cờ TẮT: bad trần, không statusCode/reason", async () => {
    mockEip(async () => {
      throw Object.assign(new Error("m"), { code: "EIP_ERR_17" });
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const [s] = await d.readTags(eipTags);
    expect(s.quality).toBe("bad");
    expect(s.statusCode).toBeUndefined();
    expect(s.reason).toBeUndefined();
  });

  it("subscribe đi qua vòng poll chung: onTick được gọi", async () => {
    mockEip(async (tag) => {
      tag.value = 3;
    });
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe(eipTags, () => undefined, 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length > 0, 2000);
    await h.close();
    expect(ticks[0].ok).toBe(true);
  });
});
