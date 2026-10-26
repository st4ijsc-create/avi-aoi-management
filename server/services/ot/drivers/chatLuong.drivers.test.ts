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
import { laDocTot, laTickHong, SO_TICK_HONG_DE_MAT, taoBatDocTot, taoDemTickHong } from "../reconnectNhanh";

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
  /** Số lần server nhận yêu cầu đọc holding theo địa chỉ (0-based). */
  goi: Map<number, number>;
  close(): Promise<void>;
}

/** Thanh ghi `loiAddr` trả Modbus exception 2 (Illegal Data Address); `treoAddrs` không bao giờ trả lời; còn lại trả 100 + địa chỉ. */
async function startModbusSim(loiAddr: number | null, treoAddrs: number[] = []): Promise<ModbusSim> {
  const port = await freePort();
  const goi = new Map<number, number>();
  const vector = {
    // 3 tham số ⇒ modbus-serial gọi kiểu callback (cho phép trả exception).
    getHoldingRegister: (addr: number, _unit: number, cb: (err: unknown, v?: number) => void) => {
      goi.set(addr, (goi.get(addr) ?? 0) + 1);
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
    goi,
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

  it("T12 D3 cờ BẬT: MỘT thanh ghi không bao giờ đáp ⇒ đường poll HUỶ tick ở giao dịch QUÁ HẠN: đúng MỘT loạt bad/comm_lost/timeout cho cả 4 tag; tick lỗi ≈ timeoutMs; c/d không được đọc", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(null, [5]); // chỉ b treo (không trả lời, socket vẫn mở)
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim, 300);
    const got: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe(mbTags4, (s) => void got.push(s), 500, { onTick: (e) => void ticks.push(e) });
    cleanups.push(() => h.close());
    await waitFor(() => ticks.length >= 3, 10_000);
    await h.close();
    // Mọi tick đều hỏng vì timeout, mỗi tick dừng ở giao dịch quá hạn (≈ 300 ms, xa hạn vòng poll 6 s).
    expect(ticks.every((e) => !e.ok && e.timeout && e.reason === "comm_lost" && e.statusCode === "timeout")).toBe(true);
    expect(ticks.every((e) => e.ms < 1000)).toBe(true);
    // Đúng MỘT loạt (đợt lỗi): 4 mẫu, mọi tag bad/comm_lost/timeout — kể cả a (đã đọc được trong tick bị huỷ).
    expect(got).toHaveLength(4);
    expect(got.map((s) => s.tagKey).sort()).toEqual(["a", "b", "c", "d"]);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "timeout" && s.value === null)).toBe(true);
    // Giao dịch sau b KHÔNG được gửi (tick bị huỷ): c (thanh ghi 6) và d (7) chưa bao giờ được hỏi.
    expect(sim.goi.get(6) ?? 0).toBe(0);
    expect(sim.goi.get(7) ?? 0).toBe(0);
  });

  it("T12 D3 cờ BẬT: lỗi THIẾT BỊ (exception 2) ở một thanh ghi trên đường poll ⇒ KHÔNG huỷ: chỉ tag đó bad/config_error, tag khác good mỗi tick, tick ok:true", async () => {
    vi.stubEnv(FLAG, "true");
    const sim = await startModbusSim(5);
    cleanups.push(() => sim.close());
    const d = await ketNoi(sim, 300);
    const got: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe(mbTags4, (s) => void got.push(s), 100, { onTick: (e) => void ticks.push(e) });
    cleanups.push(() => h.close());
    await waitFor(() => ticks.length >= 2, 5000);
    await h.close();
    expect(ticks.every((e) => e.ok)).toBe(true);
    for (const k of ["a", "c", "d"]) expect(got.filter((s) => s.tagKey === k).every((s) => s.quality === "good")).toBe(true);
    const b = got.filter((s) => s.tagKey === "b");
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b.every((s) => s.quality === "bad" && s.reason === "config_error" && s.statusCode === "modbus_exc_02")).toBe(true);
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

  // R1b-2a T13 fix round 1 — `bad` KHÔNG lý do = CHƯA trả lời (mauMayChuDaTraLoi, fail-closed). Máy chủ ĐÃ trả lời (mã good / good có
  // mã con) nhưng giá trị không chuẩn hoá được ⇒ bad PHẢI mang reason (device_error / bad_value), nếu không D1 coi tick là hỏng.
  it.each([0, 0x00300000])("T13 cờ BẬT: mã good (decimal %i) mà giá trị null ⇒ bad / bad_value / device_error (đã trả lời)", async (sc) => {
    vi.stubEnv(FLAG, "true");
    mockOpcua({ value: sc, name: "Good" }, null);
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
    expect(s.statusCode).toBe("bad_value");
    expect(s.reason).toBe("device_error");
    const { mauMayChuDaTraLoi } = await import("../reconnectNhanh");
    expect(mauMayChuDaTraLoi(s)).toBe(true);
  });

  it("T13 cờ TẮT: mã good mà giá trị null ⇒ bad TRẦN như cũ (không statusCode/reason)", async () => {
    mockOpcua({ value: 0, name: "Good" }, null);
    const d = await opcuaConnected();
    const [s] = await d.readTags(opcTags);
    expect(s.quality).toBe("bad");
    expect(s.statusCode).toBeUndefined();
    expect(s.reason).toBeUndefined();
  });

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

  it("T13 cờ BẬT: thay đổi mã good mà giá trị null (máy chủ ĐÃ gửi) ⇒ bad / bad_value / device_error — vẫn là 'đã trả lời'", async () => {
    vi.stubEnv(FLAG, "true");
    const { got, items, h } = await dung();
    items[0].fire({ statusCode: { value: 0 }, sourceTimestamp: new Date(), value: { value: null } });
    expect(got[0].quality).toBe("bad");
    expect(got[0].statusCode).toBe("bad_value");
    expect(got[0].reason).toBe("device_error");
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

/**
 * R1b-2a T13 fix round 2 (I1) — hình dạng THẬT khi gói đọc QUÁ HẠN (PLC im, TCP còn).
 *   nodes7 0.3.18 (nodeS7.js): packetTimeout("read") ⇒ connectionReset() (isoConnectionState = 0) ⇒ readResponse(undefined) ⇒ mọi item
 *   quality "BAD 255" ⇒ readDoneCallback(true, { useraddr: "BAD 255", … }). Callback được gọi trên ĐỐI TƯỢNG lib (`this`).
 */
function docQuaHanNodes7(keys: string[]) {
  return vi.fn(function (this: { isoConnectionState?: number }, cb: (bad: boolean, v: Record<string, unknown>) => void) {
    this.isoConnectionState = 0;
    cb(true, Object.fromEntries(keys.map((k) => [k, "BAD 255"])));
  });
}
/**
 * mcprotocol 0.1.2 (mcprotocol.js): packetTimeout("read") ⇒ readResponse(undefined) ⇒ mọi item "BAD 255"; isoConnectionState GIỮ 4.
 * final-fix I-1: bộ hẹn gói của lib là `self.globalTimeout` (4500 ms) ⇒ callback quá hạn đến SAU globalTimeout. Mock đọc đúng trường
 * `globalTimeout` của instance (test đặt nhỏ, ví dụ 40 ms) để giữ hình dạng thời gian thật mà không chờ 4,5 s.
 */
function docQuaHanMc(keys: string[]) {
  return vi.fn(function (this: { globalTimeout?: number }, cb: (bad: boolean, v: Record<string, unknown>) => void) {
    setTimeout(() => cb(true, Object.fromEntries(keys.map((k) => [k, "BAD 255"]))), this.globalTimeout ?? 4500);
  });
}
/**
 * mcprotocol 0.1.2: PLC TRẢ LỜI gói đọc bằng end code lỗi (processMBPacket "MC Error Response …" / "Invalid Response Length …") ⇒
 * qualityBuffer GIỮ 0xFF ⇒ mọi item của khối "BAD 255" — cùng chuỗi với quá hạn, nhưng đến NGAY (một vòng TCP), liên kết GIỮ 4.
 */
function docLoiNhanhMc(keys: string[]) {
  return vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => setImmediate(() => cb(true, Object.fromEntries(keys.map((k) => [k, "BAD 255"])))));
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

  it("T13 cờ BẬT: PLC báo lỗi ITEM (hình dạng thật: 'BAD 10', anythingBad=true, liên kết VẪN 4) ⇒ bad / bad_value / device_error; tick poll toàn tag như thế VẪN là đọc tốt, không phải tick hỏng", async () => {
    vi.stubEnv(FLAG, "true");
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => cb(true, { t1: "BAD 10" })) });
    const { S7Driver } = await import("./s7Driver");
    const { laDocTot, laTickHong } = await import("../reconnectNhanh");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const [s] = await d.readTags([s7Tags[0]]);
    expect(s.quality).toBe("bad");
    expect(s.value).toBeNull();
    expect(s.statusCode).toBe("bad_value");
    expect(s.reason).toBe("device_error");
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe([s7Tags[0]], () => undefined, 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length > 0, 2000);
    await h.close();
    expect(ticks[0].ok).toBe(true);
    expect(ticks[0].tags).toEqual([{ tagKey: "t1", quality: "bad", reason: "device_error" }]);
    expect(laTickHong(ticks[0])).toBe(false);
    expect(laDocTot(ticks[0])).toBe(true);
  });

  it("T13 cờ TẮT: gói đọc quá hạn (hình dạng thật: 'BAD 255', liên kết rời 4) ⇒ KHÔNG ném, bad TRẦN như cũ (không statusCode/reason)", async () => {
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: docQuaHanNodes7(["t1"]) });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const [s] = await d.readTags([s7Tags[0]]);
    expect(s.quality).toBe("bad");
    expect(s.statusCode).toBeUndefined();
    expect(s.reason).toBeUndefined();
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

  it("T13 cờ BẬT: MỘT PHẦN item BAD (hình dạng thật 'BAD 255', lần đọc có trả lời) ⇒ item đó bad / bad_value / device_error; cờ TẮT ⇒ bad TRẦN như cũ", async () => {
    vi.stubEnv(FLAG, "true");
    const hai: OtTagAddress[] = [mcTags[0], { tagKey: "t3", address: "D200", dataType: "int" }];
    mockNodes("mcprotocol", {}, { isoConnectionState: 4, readAllItems: vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => cb(true, { t1: 7, t3: "BAD 255" })) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const out = await d.readTags(hai);
    expect(out.find((s) => s.tagKey === "t1")!.quality).toBe("good");
    const s = out.find((x) => x.tagKey === "t3")!;
    expect(s.quality).toBe("bad");
    expect(s.statusCode).toBe("bad_value");
    expect(s.reason).toBe("device_error");
    vi.stubEnv(FLAG, "false");
    const s2 = (await d.readTags(hai)).find((x) => x.tagKey === "t3")!;
    expect(s2.quality).toBe("bad");
    expect(s2.statusCode).toBeUndefined();
    expect(s2.reason).toBeUndefined();
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

  it("T12 D3 cờ BẬT: giao dịch QUÁ HẠN ⇒ đường poll HUỶ ở giao dịch đầu: MỘT loạt 3 mẫu bad/comm_lost/timeout, mỗi tick 1 giao dịch", async () => {
    vi.stubEnv(FLAG, "true");
    const { d, anyD } = await dung();
    anyD.transact = vi.fn(async () => {
      throw new Error("slmp transaction timeout after 800ms");
    });
    const got: OtSample[] = [];
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe(slmpTags, (s) => void got.push(s), 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length >= 3, 2000);
    await h.close();
    expect(ticks.every((e) => !e.ok && e.timeout && e.reason === "comm_lost")).toBe(true);
    expect(got).toHaveLength(3);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "timeout")).toBe(true);
    expect(anyD.transact.mock.calls.length).toBe(ticks.length); // 1 giao dịch mỗi tick (huỷ), không phải 3
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

  it("T12 D3 cờ BẬT: giao dịch QUÁ HẠN ở một tag ⇒ đường poll HUỶ tick: đúng MỘT loạt bad/comm_lost/timeout cho mọi tag", async () => {
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
    const ticks: SuKienDoc[] = [];
    const h = await d.subscribe(hai, (s) => void got.push(s), 30, { onTick: (e) => void ticks.push(e) });
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length >= 3, 3000);
    await h.close();
    expect(ticks.every((e) => !e.ok && e.timeout && e.reason === "comm_lost")).toBe(true);
    expect(got).toHaveLength(2);
    expect(got.every((s) => s.quality === "bad" && s.reason === "comm_lost" && s.statusCode === "timeout")).toBe(true);
  });

  it("T12 D3 cờ BẬT: lỗi THIẾT BỊ ở một tag trên đường poll ⇒ KHÔNG huỷ: tag đó bad/device_error, tag khác good mỗi tick", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async (tag) => {
      if (tag.name === "Other") throw Object.assign(new Error("tag does not exist"), { code: "EIP_ERR_17" });
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
    expect(got.filter((s) => s.tagKey === "t2").every((s) => s.quality === "bad" && s.reason === "device_error")).toBe(true);
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

  it("T13 cờ BẬT: readTag THÀNH CÔNG mà giá trị không ép được (undefined) ⇒ bad / bad_value / device_error; cờ TẮT ⇒ bad TRẦN như cũ", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async () => undefined);
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const [s] = await d.readTags(eipTags);
    expect(s.quality).toBe("bad");
    expect(s.statusCode).toBe("bad_value");
    expect(s.reason).toBe("device_error");
    vi.stubEnv(FLAG, "false");
    const [s2] = await d.readTags(eipTags);
    expect(s2.quality).toBe("bad");
    expect(s2.statusCode).toBeUndefined();
    expect(s2.reason).toBeUndefined();
  });

  it("T13 fix round 2 (m2): đường poll dùng ẢNH CHỤP cờ lúc subscribe — lật cờ giữa phiên không đổi hình dạng mẫu của phiên đó", async () => {
    vi.stubEnv(FLAG, "true");
    mockEip(async () => undefined); // readTag thành công, giá trị không ép được ⇒ bad
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const got: OtSample[] = [];
    const h = await d.subscribe(eipTags, (s) => void got.push(s), 30);
    dongSau.push(() => h.close());
    await waitFor(() => got.length >= 1, 2000);
    vi.stubEnv(FLAG, "false"); // lật giữa phiên
    const n = got.length;
    await waitFor(() => got.length >= n + 3, 2000);
    await h.close();
    expect(got.every((s) => s.quality === "bad" && s.reason === "device_error" && s.statusCode === "bad_value")).toBe(true);
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

// ─────────── R1b-2a T13 fix round 2 (I1) — S7 / MC: gói đọc QUÁ HẠN (PLC im, TCP còn) với hình dạng THẬT của lib ───────────
/**
 * Lần đọc mà lib "trả về" sau khi tự quá hạn (mọi item "BAD 255") KHÔNG phải lần đọc được trả lời: cờ V2 ⇒ tick ok:false / comm_lost,
 * D1 (taoDemTickHong, K = SO_TICK_HONG_DE_MAT) đếm và bắn, bộ bắt đọc tốt của phiên (taoBatDocTot — đúng hàm otManager/supervisor dùng)
 * KHÔNG BAO GIỜ báo ⇒ không bao giờ `connected`. Trước fix: device_error ⇒ "đã trả lời" ⇒ connected giả, D1 về 0 mỗi tick.
 */
describe("R1b-2a T13 fix round 2 (I1) — S7/MC packet timeout ⇒ comm failure, never connected, D1 counts", () => {
  /** Chạy subscribe qua vòng poll thật; nối mọi tick vào bộ bắt đọc tốt + bộ đếm D1 của MỘT phiên. */
  async function chayPhien(d: { subscribe: (...a: never[]) => Promise<{ close: () => Promise<void> }> }, tags: OtTagAddress[], soTick: number) {
    const ticks: SuKienDoc[] = [];
    const mau: OtSample[] = [];
    let docTot = 0;
    let d1Ban = 0;
    const bat = taoBatDocTot(() => void (docTot += 1));
    const dem = taoDemTickHong(SO_TICK_HONG_DE_MAT, () => void (d1Ban += 1));
    const h = await (d.subscribe as unknown as (t: OtTagAddress[], s: (x: OtSample) => void, ms: number, o: { onTick: (e: SuKienDoc) => void }) => Promise<{ close: () => Promise<void> }>)(
      tags,
      (s) => {
        mau.push(s);
        bat.quaMau(s);
      },
      30,
      {
        onTick: (e) => {
          ticks.push(e);
          bat.quaTick(e);
          dem(e);
        },
      },
    );
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length >= soTick, 3000);
    await h.close();
    return { ticks, mau, docTot: () => docTot, d1Ban: () => d1Ban };
  }

  it("S7 cờ BẬT: nodes7 quá hạn (reset liên kết, mọi item 'BAD 255') ⇒ readTags NÉM lỗi liên kết; tick ok:false/comm_lost, D1 bắn từ tick thứ K, không đọc tốt nào", async () => {
    vi.stubEnv(FLAG, "true");
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: docQuaHanNodes7(["t1"]) });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const r = await chayPhien(d as never, [s7Tags[0]], SO_TICK_HONG_DE_MAT + 1);
    // quyết định của phiên trước (không đọc tốt, D1 bắn) — đột biến bỏ luật làm đỏ ở đây, không chỉ ở lời ném
    expect(r.docTot()).toBe(0);
    expect(r.d1Ban()).toBeGreaterThanOrEqual(1);
    for (const e of r.ticks) {
      expect(e.ok).toBe(false);
      expect(e.reason).toBe("comm_lost");
      expect(laTickHong(e)).toBe(true);
      expect(laDocTot(e)).toBe(false);
    }
    await expect(d.readTags([s7Tags[0]])).rejects.toMatchObject({ name: "DeviceUnreachableError" });
    // loạt mẫu xấu của vòng poll mang comm_lost (không bao giờ device_error, không bao giờ good)
    expect(r.mau.length).toBeGreaterThan(0);
    expect(r.mau.every((s) => s.quality === "bad" && s.reason === "comm_lost")).toBe(true);
  });

  it("S7 cờ BẬT: PLC báo lỗi item trong khi liên kết VẪN 4 ('BAD 10' + một item tốt) ⇒ KHÔNG ném; tick ok:true, đọc tốt, D1 không bắn", async () => {
    vi.stubEnv(FLAG, "true");
    const hai: OtTagAddress[] = [s7Tags[0], { tagKey: "t3", address: "DB1,REAL4", dataType: "float" }];
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: vi.fn((cb: (bad: boolean, v: Record<string, unknown>) => void) => cb(true, { t1: 1.5, t3: "BAD 10" })) });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const r = await chayPhien(d as never, hai, SO_TICK_HONG_DE_MAT + 1);
    expect(r.ticks.every((e) => e.ok === true && laDocTot(e))).toBe(true);
    expect(r.d1Ban()).toBe(0);
    expect(r.docTot()).toBeGreaterThan(0);
    expect(r.mau.find((s) => s.tagKey === "t3")).toMatchObject({ quality: "bad", reason: "device_error" });
  });

  it("MC cờ BẬT: mcprotocol quá hạn (mọi item 'BAD 255', liên kết GIỮ 4) ⇒ readTags NÉM lỗi quá hạn; tick ok:false/timeout/comm_lost, D1 bắn, không đọc tốt nào", async () => {
    vi.stubEnv(FLAG, "true");
    const hai: OtTagAddress[] = [
      { tagKey: "t1", address: "D100", dataType: "int" },
      { tagKey: "t3", address: "M100", dataType: "bool" },
    ];
    mockNodes("mcprotocol", {}, { isoConnectionState: 4, globalTimeout: 40, readAllItems: docQuaHanMc(["t1", "t3"]) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const r = await chayPhien(d as never, hai, SO_TICK_HONG_DE_MAT + 1);
    // quyết định của phiên trước (không đọc tốt, D1 bắn) — đột biến bỏ luật làm đỏ ở đây, không chỉ ở lời ném
    expect(r.docTot()).toBe(0);
    expect(r.d1Ban()).toBeGreaterThanOrEqual(1);
    for (const e of r.ticks) {
      expect(e.ok).toBe(false);
      expect(e.timeout).toBe(true);
      expect(e.reason).toBe("comm_lost");
      expect(laTickHong(e)).toBe(true);
    }
    await expect(d.readTags(hai)).rejects.toMatchObject({ name: "McReadTimeoutError" });
    expect(r.mau.every((s) => s.quality === "bad" && s.reason === "comm_lost")).toBe(true);
    // I2 cùng lúc: tag bool KHÔNG BAO GIỜ đọc TRUE trong đợt mất
    expect(r.mau.some((s) => s.tagKey === "t3" && s.value === true)).toBe(false);
  });

  it("MC cờ TẮT: cùng quá hạn ⇒ KHÔNG ném (hình dạng cũ), mẫu bad TRẦN, bool không đọc TRUE (I2)", async () => {
    const hai: OtTagAddress[] = [
      { tagKey: "t1", address: "D100", dataType: "int" },
      { tagKey: "t3", address: "M100", dataType: "bool" },
    ];
    mockNodes("mcprotocol", {}, { isoConnectionState: 4, globalTimeout: 40, readAllItems: docQuaHanMc(["t1", "t3"]) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const out = await d.readTags(hai);
    expect(out.every((s) => s.quality === "bad" && s.value === null && s.reason === undefined && s.statusCode === undefined)).toBe(true);
  });

  // ── final-fix I-1 — PLC CÒN SỐNG trả lời LỖI cho cả khối (mọi item "BAD 255", NHANH) ⇒ device_error, phiên giữ, STOP ghi được ──
  const haiMc: OtTagAddress[] = [
    { tagKey: "t1", address: "D100", dataType: "int" },
    { tagKey: "t3", address: "M100", dataType: "bool" },
  ];

  it("MC cờ BẬT (I-1): mọi item 'BAD 255' trả về NHANH (PLC trả lời lỗi, liên kết 4) ⇒ KHÔNG ném; mọi item bad/device_error; tick ok:true, D1 không bắn, vẫn connected", async () => {
    vi.stubEnv(FLAG, "true");
    // globalTimeout đặt LỚN (hạn thật 4500) — trả lời nhanh ⇒ xa dưới ngưỡng
    mockNodes("mcprotocol", {}, { isoConnectionState: 4, globalTimeout: 4500, readAllItems: docLoiNhanhMc(["t1", "t3"]) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const out = await d.readTags(haiMc);
    expect(out).toHaveLength(2);
    for (const s of out) expect(s).toMatchObject({ quality: "bad", value: null, reason: "device_error" });
    // bool KHÔNG BAO GIỜ đọc TRUE (I2)
    expect(out.some((s) => s.tagKey === "t3" && s.value === true)).toBe(false);
    const r = await chayPhien(d as never, haiMc, SO_TICK_HONG_DE_MAT + 2);
    expect(r.d1Ban()).toBe(0);
    for (const e of r.ticks) {
      expect(e.ok).toBe(true);
      expect(laTickHong(e)).toBe(false);
    }
    expect(r.mau.every((s) => s.quality === "bad" && s.reason === "device_error")).toBe(true);
    expect(d.isConnected()).toBe(true);
    expect((await d.health()).connected).toBe(true);
  });

  it("MC cờ BẬT (I-1): sau loạt đọc lỗi NHANH, đường ghi STOP ghim VẪN đi được (writeItems tới lib, ok:true) — không ADAPTER_OFFLINE", async () => {
    vi.stubEnv(FLAG, "true");
    const writeItems = vi.fn((_k: string[], _v: unknown[], cb: (anyBad: boolean) => void) => {
      setImmediate(() => cb(false));
      return 0;
    });
    mockNodes("mcprotocol", {}, { isoConnectionState: 4, globalTimeout: 4500, readAllItems: docLoiNhanhMc(["t1", "t3"]), writeItems });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    await chayPhien(d as never, haiMc, SO_TICK_HONG_DE_MAT + 2);
    await expect(d.readTags(haiMc)).resolves.toHaveLength(2);
    expect(d.isConnected()).toBe(true);
    // ghim STOP: ghi bool M200 = true (đúng hình dạng commandDispatcher gửi xuống driver)
    const kq = await d.writeTags([{ tagKey: "stop_pin", address: "M200", value: true, dataType: "bool" }]);
    expect(kq).toEqual([{ tagKey: "stop_pin", ok: true }]);
    expect(writeItems).toHaveBeenCalledTimes(1);
    expect(writeItems.mock.calls[0]![0]).toEqual(["stop_pin"]);
    expect(writeItems.mock.calls[0]![1]).toEqual([true]);
  });

  it("MC cờ BẬT (I-1): mọi item BAD trả về NHANH nhưng lib báo RỜI (isoConnectionState≠4 — đường 'instant timeout' khi chưa nối) ⇒ VẪN là mất liên lạc (ném)", async () => {
    vi.stubEnv(FLAG, "true");
    const conn = mockNodes("mcprotocol", {}, { isoConnectionState: 4, globalTimeout: 4500 });
    conn.readAllItems = vi.fn(function (this: { isoConnectionState?: number }, cb: (bad: boolean, v: Record<string, unknown>) => void) {
      this.isoConnectionState = 0;
      setImmediate(() => cb(true, { t1: "BAD 255", t3: "BAD 255" }));
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    await expect(d.readTags(haiMc)).rejects.toMatchObject({ name: "McReadTimeoutError" });
  });

  it("MC (I-1) ngưỡng: laDocMcQuaHanGoi theo 90 % hạn gói; hanGoiThuVienMc đọc globalTimeout của instance, lui về 4500", async () => {
    const { laDocMcQuaHanGoi, hanGoiThuVienMc, HAN_GOI_MCPROTOCOL_MAC_DINH_MS } = await import("./mitsubishiMcDriver");
    expect(HAN_GOI_MCPROTOCOL_MAC_DINH_MS).toBe(4500);
    expect(hanGoiThuVienMc({ globalTimeout: 4500 })).toBe(4500);
    expect(hanGoiThuVienMc({})).toBe(4500);
    expect(hanGoiThuVienMc(null)).toBe(4500);
    expect(hanGoiThuVienMc({ globalTimeout: "x" })).toBe(4500);
    expect(laDocMcQuaHanGoi(4500, 4500)).toBe(true);
    expect(laDocMcQuaHanGoi(4050, 4500)).toBe(true);
    expect(laDocMcQuaHanGoi(4049, 4500)).toBe(false);
    expect(laDocMcQuaHanGoi(12, 4500)).toBe(false);
  });
});

// ─────────── R1b-2b-1 T3 (kiem-dinh G2) — "BAD n" của thư viện theo kiểu tag + cờ anythingBad ───────────
describe("R1b-2b-1 T3 — chuỗi 'BAD n' tag string là giá trị THẬT khi thư viện không báo lỗi", () => {
  const strTag: OtTagAddress[] = [{ tagKey: "t", address: "DB1,CHAR0", dataType: "string" }];
  const mcStr: OtTagAddress[] = [
    { tagKey: "a", address: "D100", dataType: "string" },
    { tagKey: "b", address: "D200", dataType: "string" },
  ];
  const dongTick = async (d: { subscribe: unknown }, tags: OtTagAddress[]) => {
    const ticks: SuKienDoc[] = [];
    const mau: OtSample[] = [];
    const h = await (d.subscribe as (t: OtTagAddress[], s: (x: OtSample) => void, ms: number, o: { onTick: (e: SuKienDoc) => void }) => Promise<{ close: () => Promise<void> }>).call(
      d,
      tags,
      (s) => void mau.push(s),
      30,
      { onTick: (e) => void ticks.push(e) },
    );
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length > 0, 2000);
    await h.close();
    return { ticks, mau };
  };
  const cb2 = (bad: boolean, v: Record<string, unknown>) => vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => cb(bad, v));

  it("S7 cờ BẬT: (false, { t: 'BAD 12' }) ⇒ mẫu good 'BAD 12', tick là đọc tốt, phiên connected", async () => {
    vi.stubEnv(FLAG, "true");
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: cb2(false, { t: "BAD 12" }) });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const [s] = await d.readTags(strTag);
    expect(s).toMatchObject({ quality: "good", value: "BAD 12" });
    const { ticks } = await dongTick(d, strTag);
    expect(ticks[0].ok).toBe(true);
    expect(laDocTot(ticks[0])).toBe(true);
    expect(laTickHong(ticks[0])).toBe(false);
    expect(d.isConnected()).toBe(true);
    expect((await d.health()).connected).toBe(true);
  });

  it("S7 cờ BẬT: cùng giá trị với anythingBad=true ⇒ mẫu bad", async () => {
    vi.stubEnv(FLAG, "true");
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: cb2(true, { t: "BAD 12" }) });
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "tcp://127.0.0.1:102" });
    const [s] = await d.readTags(strTag);
    expect(s).toMatchObject({ quality: "bad", value: null });
  });

  it("MC cờ BẬT: (false, { a: 'BAD 1', b: 'BAD 1' }) sau ≥ 90 % hạn gói (44/40 ms, tỉ lệ của 4,4/4,5 s) ⇒ KHÔNG ném McReadTimeoutError; hai mẫu good", async () => {
    vi.stubEnv(FLAG, "true");
    mockNodes("mcprotocol", {}, {
      isoConnectionState: 4,
      globalTimeout: 40,
      readAllItems: vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => void setTimeout(() => cb(false, { a: "BAD 1", b: "BAD 1" }), 44)),
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    const out = await d.readTags(mcStr);
    expect(out).toHaveLength(2);
    for (const s of out) expect(s).toMatchObject({ quality: "good", value: "BAD 1" });
  });

  it("MC cờ BẬT: cùng giá trị với anythingBad=true sau ≥ 90 % hạn gói ⇒ mất liên lạc (ném McReadTimeoutError)", async () => {
    vi.stubEnv(FLAG, "true");
    mockNodes("mcprotocol", {}, {
      isoConnectionState: 4,
      globalTimeout: 40,
      readAllItems: vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => void setTimeout(() => cb(true, { a: "BAD 1", b: "BAD 1" }), 44)),
    });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    expect(await d.readTags(mcStr).catch((e) => e as Error)).toMatchObject({ name: "McReadTimeoutError" });
  });

  it("S7 và MC: tag INT 'BAD 255' với anythingBad=false (thư viện giả bất thường) ⇒ VẪN bad (kiểu int không bao giờ nhận chuỗi BAD)", async () => {
    vi.stubEnv(FLAG, "true");
    const intTag: OtTagAddress[] = [{ tagKey: "t", address: "DB1,INT0", dataType: "int" }];
    mockNodes("nodes7", {}, { isoConnectionState: 4, readAllItems: cb2(false, { t: "BAD 255" }) });
    const { S7Driver } = await import("./s7Driver");
    const s7 = new S7Driver();
    await s7.connect({ endpoint: "tcp://127.0.0.1:102" });
    expect((await s7.readTags(intTag))[0]).toMatchObject({ quality: "bad", value: null });
    mockNodes("mcprotocol", {}, { isoConnectionState: 4, readAllItems: cb2(false, { t: "BAD 255" }) });
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const mc = new MitsubishiMcDriver();
    await mc.connect({ endpoint: "tcp://127.0.0.1:1281" });
    expect((await mc.readTags([{ tagKey: "t", address: "D100", dataType: "int" }]))[0]).toMatchObject({ quality: "bad", value: null });
  });
});

// ─────────── R1b-2b-1 T4 (muc 58) — MC: "PLC tra loi loi (cham)" vs "qua han goi" bang errCode cua mcprotocol ───────────
// Thoi gian thu nho cung ti le voi hang that: globalTimeout 40 ms (that 4500). Dong ho cua driver la performance.now() (fake timers
// KHONG tien) nen dung timer that: 38 ms ≈ 4300/4500 (95 %, tren nguong 90 % cua luat thoi gian cu), 41 ms ≈ 4600 ms (102 %), 2 ms ≈ 200 ms.
describe("R1b-2b-1 T4 — MC phân loại lỗi đọc bằng errCode từng item (mục 58)", () => {
  // chuoi nguyen van mcprotocol.js :1263 (probe mcErrCode.thuVienThat.test.ts chung minh bang thu vien that)
  const MC_ERRCODE_QUA_HAN_GOI = "Timeout error - zero length packet";
  const hai: OtTagAddress[] = [
    { tagKey: "t1", address: "D100", dataType: "int" },
    { tagKey: "t3", address: "M100", dataType: "bool" },
  ];
  const LOI_PLC = "MC Error Response - Second Byte is 91 and error code is 0";
  type It = { valid: boolean; errCode?: string };
  /** callback thu vien that: anythingBad=true, mọi item "BAD 255", sau `troMs`; readPacketArray theo hinh da tham do (probe thuVienThat). */
  function mcDoc(troMs: number, goi: It[][] | undefined, writeItems?: unknown) {
    const ov: Record<string, unknown> = {
      isoConnectionState: 4,
      globalTimeout: 40,
      readAllItems: vi.fn((cb: (b: boolean, v: Record<string, unknown>) => void) => void setTimeout(() => cb(true, { t1: "BAD 255", t3: "BAD 255" }), troMs)),
    };
    if (goi) ov.readPacketArray = goi.map((itemList) => ({ itemList }));
    if (writeItems) ov.writeItems = writeItems;
    mockNodes("mcprotocol", {}, ov);
  }
  async function chayPhien(d: { subscribe: (...a: never[]) => Promise<{ close: () => Promise<void> }> }, tags: OtTagAddress[], soTick: number) {
    const ticks: SuKienDoc[] = [];
    const mau: OtSample[] = [];
    let docTot = 0;
    let d1Ban = 0;
    const bat = taoBatDocTot(() => void (docTot += 1));
    const dem = taoDemTickHong(SO_TICK_HONG_DE_MAT, () => void (d1Ban += 1));
    const h = await (d.subscribe as unknown as (t: OtTagAddress[], s: (x: OtSample) => void, ms: number, o: { onTick: (e: SuKienDoc) => void }) => Promise<{ close: () => Promise<void> }>)(
      tags,
      (s) => {
        mau.push(s);
        bat.quaMau(s);
      },
      30,
      {
        onTick: (e) => {
          ticks.push(e);
          bat.quaTick(e);
          dem(e);
        },
      },
    );
    dongSau.push(() => h.close());
    await waitFor(() => ticks.length >= soTick, 3000);
    await h.close();
    return { ticks, mau, docTot: () => docTot, d1Ban: () => d1Ban };
  }
  async function moDriver() {
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:1281" });
    return d;
  }

  it("PLC trả lời lỗi CHẬM (38/40 ms ≈ 4300/4500, trên ngưỡng 90 %) ⇒ KHÔNG ném; device_error; tick đọc tốt; STOP ghim vẫn ghi được", async () => {
    vi.stubEnv(FLAG, "true");
    const writeItems = vi.fn((_k: string[], _v: unknown[], cb: (anyBad: boolean) => void) => {
      setImmediate(() => cb(false));
      return 0;
    });
    mcDoc(38, [[{ valid: false, errCode: LOI_PLC }, { valid: false, errCode: LOI_PLC }]], writeItems);
    const d = await moDriver();
    const out = await d.readTags(hai);
    for (const s of out) expect(s).toMatchObject({ quality: "bad", value: null, reason: "device_error" });
    const r = await chayPhien(d as never, hai, SO_TICK_HONG_DE_MAT + 1);
    expect(r.ticks.every((e) => e.ok === true && laDocTot(e))).toBe(true);
    expect(r.d1Ban()).toBe(0);
    expect(r.mau.every((s) => s.quality === "bad" && s.reason === "device_error")).toBe(true);
    expect(d.isConnected()).toBe(true);
    const kq = await d.writeTags([{ tagKey: "stop_pin", address: "M200", value: true, dataType: "bool" }]);
    expect(kq).toEqual([{ tagKey: "stop_pin", ok: true }]);
    expect(writeItems).toHaveBeenCalledTimes(1);
  });

  it("errCode quá hạn gói trên mọi item lỗi, 41/40 ms ≈ 4600/4500 ⇒ ném McReadTimeoutError", async () => {
    vi.stubEnv(FLAG, "true");
    mcDoc(41, [[{ valid: false, errCode: MC_ERRCODE_QUA_HAN_GOI }, { valid: false, errCode: MC_ERRCODE_QUA_HAN_GOI }]]);
    const d = await moDriver();
    expect(await d.readTags(hai).catch((e) => e as Error)).toMatchObject({ name: "McReadTimeoutError" });
  });

  it("errCode quá hạn gói NHƯNG đọc nhanh (2 ms) ⇒ vẫn ném (cấu trúc thư viện nói rõ quá hạn, không dựa thời gian)", async () => {
    vi.stubEnv(FLAG, "true");
    mcDoc(2, [[{ valid: false, errCode: MC_ERRCODE_QUA_HAN_GOI }, { valid: false, errCode: MC_ERRCODE_QUA_HAN_GOI }]]);
    const d = await moDriver();
    expect(await d.readTags(hai).catch((e) => e as Error)).toMatchObject({ name: "McReadTimeoutError" });
  });

  it("hai gói: một quá hạn, một 'MC Error Response' ⇒ device_error (PLC sống), kể cả khi đọc lâu (41 ms)", async () => {
    vi.stubEnv(FLAG, "true");
    mcDoc(41, [[{ valid: false, errCode: MC_ERRCODE_QUA_HAN_GOI }], [{ valid: false, errCode: LOI_PLC }]]);
    const d = await moDriver();
    const out = await d.readTags(hai);
    for (const s of out) expect(s).toMatchObject({ quality: "bad", value: null, reason: "device_error" });
  });

  it("readPacketArray vắng ⇒ luật thời gian cũ: 41 ms ném, 2 ms ⇒ device_error", async () => {
    vi.stubEnv(FLAG, "true");
    mcDoc(41, undefined);
    const d1 = await moDriver();
    expect(await d1.readTags(hai).catch((e) => e as Error)).toMatchObject({ name: "McReadTimeoutError" });
    vi.resetModules();
    mcDoc(2, undefined);
    const d2 = await moDriver();
    const out = await d2.readTags(hai);
    for (const s of out) expect(s).toMatchObject({ quality: "bad", value: null, reason: "device_error" });
  });

  it("item valid===true mang errCode quá hạn CŨ bị bỏ qua: không item lỗi nào ⇒ khong_ro ⇒ luật thời gian (2 ms ⇒ device_error, không ném)", async () => {
    vi.stubEnv(FLAG, "true");
    mcDoc(2, [[{ valid: true, errCode: MC_ERRCODE_QUA_HAN_GOI }, { valid: true, errCode: MC_ERRCODE_QUA_HAN_GOI }]]);
    const d = await moDriver();
    const out = await d.readTags(hai);
    for (const s of out) expect(s).toMatchObject({ quality: "bad", reason: "device_error" });
  });

  it("item valid===true mang errCode PLC cũ không che item quá hạn thật: valid:true(MC Error Response cũ) + valid:false(quá hạn) ⇒ ném", async () => {
    vi.stubEnv(FLAG, "true");
    mcDoc(41, [[{ valid: true, errCode: LOI_PLC }, { valid: false, errCode: MC_ERRCODE_QUA_HAN_GOI }]]);
    const d = await moDriver();
    expect(await d.readTags(hai).catch((e) => e as Error)).toMatchObject({ name: "McReadTimeoutError" });
  });
});
