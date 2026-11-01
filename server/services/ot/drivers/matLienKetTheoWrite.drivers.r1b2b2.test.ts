/**
 * SCADA R1b-2b-2a T6 (mục 69) — liên kết mất GIỮA một lô ghi ⇒ nhãn theo TỪNG write, mọi driver.
 *
 * Trước T6: driver NÉM `LoiMatLienKetKhiDangGui` cho CẢ lô ⇒ `executeOtDeviceWrite` gắn `timeout` cho MỌI write — kể cả write chưa bao giờ giao cho thư
 * viện (hỏng chuẩn bị cục bộ — OPC UA / S7 / MC; write SAU điểm rớt — Modbus / EIP / SLMP tuần tự) và write ĐÃ acked trước điểm rớt.
 * Sau T6 (chiều an toàn giữ — write đã giao ⇒ `timeout`, KHÔNG BAO GIỜ `failed`):
 *   • lô một lần gửi (OPC UA, S7, MC sau khoá): write hỏng chuẩn bị ⇒ `failed` (lỗi riêng); write đã vào lời gọi thư viện ⇒ `timeout` câu T17;
 *   • tuần tự (Modbus, EIP, SLMP): write trước điểm rớt giữ kết quả thật (`acked`); write gặp rớt ⇒ `timeout`; write SAU ⇒ KHÔNG gọi thư viện,
 *     `failed` với LOI_CHUA_GUI_MAT_LIEN_KET;
 *   • MC: khoá T3B-0 VẪN THẮNG (mọi write `failed` OT_MC_TAM_KHOA, 0 gói) — logic sau khoá kiểm bằng cờ mở khoá CHỈ-test (backlog 84).
 * Đường thật: `executeOtDeviceWrite` + driver THẬT + thư viện giả (khuôn dangBay.drivers.r1b2b1.test.ts); SLMP: server TCP thật trong tiến trình.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import net from "node:net";
import type { OtDriver } from "../otDriver";
import { batDauDoLag, hieuChuanChuKy, type PhuThuocDoLag } from "../../../testing/doLagBucleSuKien";
import { LOI_CHUA_GUI_MAT_LIEN_KET, LoiMatLienKetKhiDangGui } from "./dangBay";
import { __moKhoaGhiMcChoTest, MA_MC_TAM_KHOA } from "./mitsubishiMcDriver";
import { ketCucLo, motPhanTuKetQua } from "../motPhan";
import { expectedFrameLength } from "./slmpEncoder";

/** Cùng cận với T17 (dangBay.drivers.r1b2b1.test.ts) — trả lời NGAY khi liên kết rớt, không ở hạn 5000 ms. */
const HAN_NHANH_MS = 500;
const TRAN_LAG_MS = 3000;
let chuKyRanhDo = 5;
beforeAll(async () => {
  chuKyRanhDo = await hieuChuanChuKy({ now: () => Date.now(), setInterval: (f, ms) => setInterval(f, ms), clearInterval: (h) => clearInterval(h as NodeJS.Timeout) }, 5);
});
const depDoLag: PhuThuocDoLag = {
  now: () => Date.now(),
  cpuMs: () => {
    const c = process.cpuUsage();
    return (c.user + c.system) / 1000;
  },
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: (h) => clearInterval(h as NodeJS.Timeout),
  setTimeout: (f, ms) => setTimeout(f, ms),
  chuKyRanh: async () => chuKyRanhDo,
};

type Ex = { timedOut: boolean; outcomes: Array<{ ok: boolean; status: string; errorText: string | null }> };
type W = { tagKey: string; address: string; dataType: string; value: unknown };

async function ghiLo(driver: OtDriver, writes: W[], o: { adapterId?: number; intentIds?: number[] } = {}): Promise<Ex> {
  const { executeOtDeviceWrite } = await import("../otDeviceWrite");
  return executeOtDeviceWrite({
    input: {
      adapterId: o.adapterId ?? 993_000 + Math.floor(Math.random() * 1000),
      machineId: null,
      commandType: "set_value",
      idempotencyKey: `t6-${Math.random()}`,
      writes: writes.map((w) => ({ tagKey: w.tagKey, value: w.value })),
    } as any,
    driver,
    resolved: writes.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
    driverWrites: writes.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType as any })),
    timeoutMs: 5000,
    stopTyped: false,
    bumpStopEpoch: false,
    ledger: { intentIds: o.intentIds ?? writes.map((_, i) => 600 + i), confirmedBy: 1 },
  }) as Promise<Ex>;
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Bắn điểm rớt khi điều kiện "đang bay" đúng; đo từ lúc bắn tới lúc trả lời (`lagMs` = phần máy không chạy ta, kẹp TRAN_LAG_MS). */
async function rotKhi(p: Promise<Ex>, dangBay: () => boolean, ban: () => unknown): Promise<{ ex: Ex; ms: number; lagMs: number }> {
  const het = performance.now() + 2000;
  while (!dangBay() && performance.now() < het) await new Promise<void>((r) => setTimeout(r, 2));
  expect(dangBay()).toBe(true);
  const lag = batDauDoLag(5, depDoLag);
  const t0 = performance.now();
  void Promise.resolve(ban()).catch(() => undefined);
  const ex = await Promise.race([p, new Promise<Ex>((_, rej) => setTimeout(() => rej(new Error("không trả lời trong 6 s")), 6000))]);
  const ms = Math.round(performance.now() - t0);
  return { ex, ms, lagMs: await lag.dung(TRAN_LAG_MS) };
}

const LINK_LOST_T17 = /^link lost while the write was in flight \(after \d+ms\) — outcome unknown: the write may have been applied on the device$/;

function laBaNhanTuanTu(ex: Ex): void {
  expect(ex.timedOut).toBe(false); // T6 — nhãn theo TỪNG write, không phải cả lô
  expect(ex.outcomes.map((x) => x.status)).toEqual(["acked", "timeout", "failed"]);
  expect(ex.outcomes.map((x) => x.ok)).toEqual([true, false, false]);
  expect(ex.outcomes[0].errorText).toBeNull();
  expect(ex.outcomes[1].errorText).toMatch(LINK_LOST_T17);
  expect(ex.outcomes[2].errorText).toBe(LOI_CHUA_GUI_MAT_LIEN_KET);
}

function laMotLanGui(ex: Ex): void {
  expect(ex.timedOut).toBe(false);
  expect(ex.outcomes.map((x) => x.status)).toEqual(["failed", "timeout", "timeout"]);
  expect(ex.outcomes[0].errorText).not.toMatch(/outcome unknown/);
  expect(ex.outcomes[0].errorText).not.toMatch(/link lost/);
  expect(ex.outcomes[1].errorText).toMatch(LINK_LOST_T17);
  expect(ex.outcomes[2].errorText).toMatch(LINK_LOST_T17);
}

// ───────────────────────── OPC UA (một lần gửi: session.write) ─────────────────────────
describe("T6 OPC UA — lô một lần gửi", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("node-opcua"));

  it("★ OPC UA: write 1 ép kiểu hỏng cục bộ + liên kết rớt khi session.write đang bay ⇒ write 1 'failed', write 2-3 'timeout' (Review Focus 3)", async () => {
    const huyCho: Array<(e: Error) => void> = [];
    const dsClient: any[] = [];
    vi.doMock("node-opcua", () => ({
      OPCUAClient: {
        create: vi.fn(() => {
          const client: any = new EventEmitter();
          const session = {
            read: vi.fn(async () => []),
            write: vi.fn((_nodes: unknown[]) => new Promise((_, rej) => huyCho.push(rej))),
            close: vi.fn(async () => {}),
          };
          Object.assign(client, { session, connect: vi.fn(async () => {}), createSession: vi.fn(async () => session), disconnect: vi.fn(async () => {}) });
          dsClient.push(client);
          return client;
        }),
      },
      AttributeIds: { Value: 13 },
      DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
      Variant: class {
        constructor(public o: any) {}
      },
    }));
    const { OpcuaDriver } = await import("./opcuaDriver");
    const d = new OpcuaDriver();
    await d.connect({ endpoint: "opc.tcp://x" });
    const c0 = dsClient[0];
    const p = ghiLo(d, [
      { tagKey: "a", address: "ns=2;s=A", dataType: "bool", value: "off" }, // ép kiểu hỏng CỤC BỘ (boolGhi chặt) — không bao giờ gửi
      { tagKey: "b", address: "ns=2;s=B", dataType: "int", value: 1 },
      { tagKey: "c", address: "ns=2;s=C", dataType: "int", value: 2 },
    ]);
    const { ex, ms, lagMs } = await rotKhi(
      p,
      () => c0.session.write.mock.calls.length === 1,
      () => {
        c0.emit("connection_lost"); // node-opcua: phát ĐỒNG BỘ trước khi huỷ giao dịch
        for (const r of huyCho.splice(0)) r(new Error("Connection Break"));
      },
    );
    laMotLanGui(ex);
    expect(c0.session.write.mock.calls[0][0]).toHaveLength(2); // chỉ b, c đã vào lời gọi thư viện
    expect(ms, `trả lời sau ${ms} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_NHANH_MS + lagMs);
    await d.disconnect();
  }, 15_000);
});

// ───────────────────────── S7 / MC (một lần gửi: writeItems) ─────────────────────────
function giaLibCallback() {
  const dsConn: any[] = [];
  function Lib(this: any) {
    const em = new EventEmitter();
    Object.assign(this, {
      on: em.on.bind(em),
      emit: em.emit.bind(em),
      initiateConnection: vi.fn((_o: unknown, cb: (e?: unknown) => void) => cb()),
      setTranslationCB: vi.fn(),
      addItems: vi.fn(),
      removeItems: vi.fn(),
      readAllItems: vi.fn(),
      // lệnh ghi được nhận, KHÔNG BAO GIỜ gọi lại (thư viện thật sau connectionCleanup)
      writeItems: vi.fn(() => 0),
      dropConnection: vi.fn((cb?: () => void) => cb?.()),
    });
    dsConn.push(this);
  }
  return { Lib, dsConn };
}

describe("T6 S7 — lô một lần gửi", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("nodes7"));

  it("★ S7: địa chỉ sai cục bộ + rớt (disconnect) giữa writeItems ⇒ địa chỉ sai 'failed', còn lại 'timeout'", async () => {
    const { Lib, dsConn } = giaLibCallback();
    vi.doMock("nodes7", () => ({ default: Lib }));
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    await d.connect({ endpoint: "127.0.0.1" });
    const conn = dsConn[0];
    const p = ghiLo(d, [
      { tagKey: "a", address: "DB1,ZZ0", dataType: "int", value: 1 }, // địa chỉ sai CỤC BỘ — không bao giờ tới nodes7
      { tagKey: "b", address: "DB1,X0.0", dataType: "bool", value: true },
      { tagKey: "c", address: "DB1,INT2", dataType: "int", value: 5 },
    ]);
    const { ex, ms, lagMs } = await rotKhi(p, () => conn.writeItems.mock.calls.length === 1, () => d.disconnect());
    laMotLanGui(ex);
    expect(ex.outcomes[0].errorText).toMatch(/invalid S7 DB data type/);
    expect(conn.writeItems.mock.calls[0][0]).toEqual(["b", "c"]);
    expect(ms, `trả lời sau ${ms} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_NHANH_MS + lagMs);
  }, 15_000);
});

describe("T6 MC — khoá T3B-0 VẪN THẮNG; logic sau khoá (mở khoá CHỈ-test) như S7", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    __moKhoaGhiMcChoTest(false);
    vi.doUnmock("mcprotocol");
  });

  it("★ MC khoá (mặc định): lô [địa chỉ sai, M100, D100] + rớt liên kết ⇒ MỌI write 'failed' OT_MC_TAM_KHOA, 0 lời gọi writeItems, không 'timeout'", async () => {
    const { Lib, dsConn } = giaLibCallback();
    vi.doMock("mcprotocol", () => ({ default: Lib }));
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const conn = dsConn[0];
    const p = ghiLo(d, [
      { tagKey: "a", address: "ZZ9", dataType: "int", value: 1 },
      { tagKey: "b", address: "M100", dataType: "bool", value: true },
      { tagKey: "c", address: "D100", dataType: "int", value: 5 },
    ]);
    // "rớt giữa lô" — cho lô thời gian tới thư viện (nếu khoá hỏng: writeItems được gọi rồi treo), rồi hạ liên kết. Khoá từ chối TRƯỚC khi gửi ⇒
    // không có gì đang bay để rớt.
    let xong = false;
    void p.then(() => (xong = true));
    const het = performance.now() + 2000;
    while (!xong && conn.writeItems.mock.calls.length === 0 && performance.now() < het) await new Promise<void>((r) => setTimeout(r, 2));
    void d.disconnect();
    const ex = await p;
    expect(ex.timedOut).toBe(false);
    expect(ex.outcomes.map((x) => x.status)).toEqual(["failed", "failed", "failed"]);
    for (const o of ex.outcomes) expect(o.errorText).toMatch(new RegExp(`^${MA_MC_TAM_KHOA}: `));
    expect(conn.writeItems).not.toHaveBeenCalled();
  }, 15_000);

  it("MC sau khoá (cờ mở khoá chỉ-test, backlog 84): địa chỉ sai cục bộ + rớt giữa writeItems ⇒ địa chỉ sai 'failed', còn lại 'timeout'", async () => {
    expect(__moKhoaGhiMcChoTest(true)).toBe(true);
    const { Lib, dsConn } = giaLibCallback();
    vi.doMock("mcprotocol", () => ({ default: Lib }));
    const { MitsubishiMcDriver } = await import("./mitsubishiMcDriver");
    const d = new MitsubishiMcDriver();
    await d.connect({ endpoint: "127.0.0.1" });
    const conn = dsConn[0];
    const p = ghiLo(d, [
      { tagKey: "a", address: "ZZ9", dataType: "int", value: 1 },
      { tagKey: "b", address: "M100", dataType: "bool", value: true },
      { tagKey: "c", address: "D100", dataType: "int", value: 5 },
    ]);
    const { ex, ms, lagMs } = await rotKhi(p, () => conn.writeItems.mock.calls.length === 1, () => d.disconnect());
    laMotLanGui(ex);
    expect(conn.writeItems.mock.calls[0][0]).toEqual(["b", "c"]);
    expect(ms, `trả lời sau ${ms} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_NHANH_MS + lagMs);
  }, 15_000);
});

// ───────────────────────── Modbus (tuần tự) ─────────────────────────
describe("T6 Modbus — tuần tự", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("modbus-serial"));

  function giaModbus() {
    const ds: any[] = [];
    function ModbusRTU(this: any) {
      const em = new EventEmitter();
      let n = 0;
      Object.assign(this, {
        on: em.on.bind(em),
        emit: em.emit.bind(em),
        connectTCP: vi.fn(async () => {}),
        setID: vi.fn(),
        setTimeout: vi.fn(),
        readCoils: vi.fn(async () => ({ data: [true] })),
        // lời ghi 1 acked; lời ghi 2 lên dây, thiết bị không trả lời (modbus-serial destroy() không gọi lại); lời ghi 3 (nếu có) acked
        writeCoil: vi.fn(() => (++n === 2 ? new Promise(() => undefined) : Promise.resolve({}))),
        close: vi.fn((cb: () => void) => cb()),
        destroy: vi.fn(),
      });
      ds.push(this);
    }
    vi.doMock("modbus-serial", () => ({ default: ModbusRTU }));
    return ds;
  }

  it("★ Modbus 3 write: write 1 acked, socket đóng khi write 2 đang bay ⇒ ['acked', 'timeout', 'failed'], thư viện nhận đúng 2 lời ghi", async () => {
    const ds = giaModbus();
    const { ModbusDriver } = await import("./modbusDriver");
    const d = new ModbusDriver();
    await d.connect({ endpoint: "tcp://127.0.0.1:502" });
    const c = ds[0];
    const p = ghiLo(d, [
      { tagKey: "a", address: "coil:1", dataType: "bool", value: true },
      { tagKey: "b", address: "coil:2", dataType: "bool", value: true },
      { tagKey: "c", address: "coil:3", dataType: "bool", value: true },
    ]);
    const { ex, ms, lagMs } = await rotKhi(p, () => c.writeCoil.mock.calls.length === 2, () => c.emit("close"));
    expect(c.writeCoil).toHaveBeenCalledTimes(2); // ★ write SAU điểm rớt không tới thư viện
    laBaNhanTuanTu(ex);
    expect(ms, `trả lời sau ${ms} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_NHANH_MS + lagMs);
    await d.disconnect();
  }, 15_000);
});

// ───────────────────────── EtherNet/IP (tuần tự) ─────────────────────────
describe("T6 EtherNet/IP — tuần tự", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("st-ethernet-ip"));

  it("★ EIP: như Modbus (write sau điểm rớt LOI_CHUA_GUI_MAT_LIEN_KET), thư viện nhận đúng 2 lời ghi", async () => {
    const ds: any[] = [];
    vi.doMock("st-ethernet-ip", () => ({
      Controller: function () {
        const plc: any = new EventEmitter();
        let n = 0;
        Object.assign(plc, {
          connect: vi.fn(async () => {}),
          newTag: vi.fn((name: string) => ({ name, value: undefined })),
          state: { tagList: { getTag: (t: string) => ({ name: t, type: { code: 0xc4, structure: false, arrayDims: 0 } }) } },
          writeTag: vi.fn(() => (++n === 2 ? new Promise(() => undefined) : Promise.resolve())),
          disconnect: vi.fn(async () => {}),
        });
        ds.push(plc);
        return plc;
      },
    }));
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    const plc = ds[0];
    const p = ghiLo(d, [
      { tagKey: "a", address: "TagA", dataType: "int", value: 1 },
      { tagKey: "b", address: "TagB", dataType: "int", value: 2 },
      { tagKey: "c", address: "TagC", dataType: "int", value: 3 },
    ]);
    const { ex, ms, lagMs } = await rotKhi(p, () => plc.writeTag.mock.calls.length === 2, () => plc.emit("close"));
    expect(plc.writeTag).toHaveBeenCalledTimes(2);
    laBaNhanTuanTu(ex);
    expect(ms, `trả lời sau ${ms} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_NHANH_MS + lagMs);
    await d.disconnect();
  }, 15_000);
});

// ───────────────────────── SLMP (tuần tự, server TCP thật) ─────────────────────────
describe("T6 SLMP — tuần tự", () => {
  it("★ SLMP: write 1 acked (end-code 0), socket rớt khi khung 2 đang chờ ⇒ ['acked', 'timeout', 'failed'], server nhận đúng 2 khung", async () => {
    const sockets = new Set<net.Socket>();
    let soKhung = 0;
    const server = net.createServer((s) => {
      sockets.add(s);
      s.on("error", () => undefined);
      s.on("close", () => sockets.delete(s));
      let buf = Buffer.alloc(0);
      s.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const need = expectedFrameLength(buf, "3E");
          if (need < 0 || buf.length < need) break;
          buf = buf.subarray(need);
          soKhung += 1;
          if (soKhung === 1) {
            // 3E: D0 00 | net 00 | pc FF | io FF03 | st 00 | len 0200 | end-code 0000
            s.write(Buffer.from([0xd0, 0x00, 0x00, 0xff, 0xff, 0x03, 0x00, 0x02, 0x00, 0x00, 0x00]));
          } // khung 2: IM LẶNG
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const { SlmpDriver } = await import("./slmpDriver");
    const d = new SlmpDriver();
    try {
      await d.connect({ endpoint: `127.0.0.1:${port}`, timeoutMs: 5000 });
      const p = ghiLo(d, [
        { tagKey: "a", address: "M100", dataType: "bool", value: true },
        { tagKey: "b", address: "M101", dataType: "bool", value: true },
        { tagKey: "c", address: "M102", dataType: "bool", value: true },
      ]);
      const { ex, ms, lagMs } = await rotKhi(
        p,
        () => soKhung === 2,
        () => {
          for (const s of sockets) s.destroy();
        },
      );
      laBaNhanTuanTu(ex);
      await new Promise((r) => setTimeout(r, 50));
      expect(soKhung).toBe(2);
      // (i) gồm cả thời gian hệ điều hành báo 'close'
      expect(ms, `trả lời sau ${ms} ms (máy không chạy ta ${lagMs} ms)`).toBeLessThan(HAN_NHANH_MS + lagMs);
    } finally {
      await d.disconnect();
      for (const s of sockets) s.destroy();
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 15_000);
});

// ───────────────────────── Kết cục chung của lô + rủi ro + nhánh catch giữ ─────────────────────────
describe("T6 — kết cục chung / rủi ro lệnh ghi cũ / nhánh ném cả lô GIỮ", () => {
  beforeEach(() => vi.resetModules());
  const cu = process.env.OT_CMD_SERIALIZE_ENABLED;
  afterEach(() => {
    if (cu === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
    else process.env.OT_CMD_SERIALIZE_ENABLED = cu;
  });

  it("dispatcher: lô ['acked','timeout','failed'] ⇒ status 'timeout', ok false (T2 thắng MỘT PHẦN — không motPhan)", () => {
    const ds = [
      { tagKey: "a", ok: true, status: "acked" },
      { tagKey: "b", ok: false, status: "timeout" },
      { tagKey: "c", ok: false, status: "failed" },
    ];
    expect(ketCucLo(ds, false)).toEqual({ ok: false, status: "timeout", motPhan: null });
    expect(motPhanTuKetQua(ds)).toBeNull();
  });

  const driverTheoWrite = (): OtDriver =>
    ({
      protocol: "modbus",
      writeTags: async () => [
        { tagKey: "a", ok: true },
        { tagKey: "b", ok: false, error: "modbus link lost while a request was in flight (socket close) — outcome unknown", ketCucKhongRo: "mat_lien_ket" },
        { tagKey: "c", ok: false, error: LOI_CHUA_GUI_MAT_LIEN_KET },
      ],
      readTags: async () => [],
    }) as unknown as OtDriver;
  const W3: W[] = [
    { tagKey: "a", address: "coil:1", dataType: "bool", value: true },
    { tagKey: "b", address: "coil:2", dataType: "bool", value: true },
    { tagKey: "c", address: "coil:3", dataType: "bool", value: true },
  ];

  it("serialize BẬT: write `mat_lien_ket` theo từng write ⇒ ghi rủi ro 'lệnh ghi cũ' (như T2) mang intent của lệnh; serialize TẮT ⇒ không", async () => {
    process.env.OT_CMD_SERIALIZE_ENABLED = "true";
    const m = await import("../otDeviceWrite");
    try {
      const ex = await ghiLo(driverTheoWrite(), W3, { adapterId: 993_901, intentIds: [41, 42, 43] });
      laBaNhanTuanTu(ex);
      expect(m._staleWriteRiskIntentIdsForTests(993_901)).toEqual([41, 42, 43]);
      process.env.OT_CMD_SERIALIZE_ENABLED = "false";
      await ghiLo(driverTheoWrite(), W3, { adapterId: 993_902, intentIds: [51, 52, 53] });
      expect(m._staleWriteRiskIntentIdsForTests(993_902)).toBeNull();
    } finally {
      m._sweepStaleWriteRiskForTests(Number.POSITIVE_INFINITY);
    }
  });

  it("nhánh `catch` GIỮ y T17: driver (plugin / phòng thủ) NÉM LoiMatLienKetKhiDangGui cho cả lô ⇒ mọi write 'timeout' câu T17, timedOut true", async () => {
    const d = {
      protocol: "modbus",
      writeTags: async () => {
        throw new LoiMatLienKetKhiDangGui("modbus", "socket close");
      },
      readTags: async () => [],
    } as unknown as OtDriver;
    const ex = await ghiLo(d, W3);
    expect(ex.timedOut).toBe(true);
    expect(ex.outcomes.map((x) => x.status)).toEqual(["timeout", "timeout", "timeout"]);
    for (const o of ex.outcomes) expect(o.errorText).toMatch(LINK_LOST_T17);
  });
});
