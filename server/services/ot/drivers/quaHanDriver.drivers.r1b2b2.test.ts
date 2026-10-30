/**
 * SCADA R1b-2b-2a T2 (mục 66, phần 1) — HẾT HẠN CỦA CHÍNH DRIVER (hẹn giờ giao dịch của thư viện / bộ hẹn dự phòng của driver) trước khi thiết bị trả
 * lời: yêu cầu ĐÃ giao cho thư viện ⇒ kết cục KHÔNG RÕ ⇒ write mang `ketCucKhongRo: "qua_han_driver"` ⇒ executeOtDeviceWrite báo `timeout` "outcome
 * unknown" theo TỪNG write, không bao giờ `failed`. Thiết bị ĐÃ trả lời (exception, end code, CIP status) hoặc lỗi cục bộ trước khi gửi ⇒ `failed` như cũ.
 *
 * Driver THẬT; peer giả trong tiến trình (khuôn modbusDriver.ghiMoCoi.repro.test.ts / dangBay.drivers.r1b2b1.test.ts):
 *   • Modbus: server Modbus TCP viết tay (net, 127.0.0.1) + modbus-serial 8.0.25 THẬT ⇒ `TransactionTimedOutError` THẬT của thư viện;
 *   • SLMP: server TCP im lặng THẬT (socket riêng của driver);
 *   • S7 (nodes7 0.3.18, T3): thư viện giả mang ĐÚNG hình thăm dò + nodes7 THẬT trên __s7commSim (hangWrite / writeError);
 *   • EIP (st-ethernet-ip 2.7.5) / OPC UA (node-opcua 2.174): thư viện GIẢ ném ĐÚNG chuỗi lỗi của mã thư viện (dist/controller/index.js:812 /
 *     client_secure_channel_layer.js:1147).
 * Trước bản vá: mọi ca "quá hạn driver" ⇒ `failed` (nói sai: lệnh có thể đã tới PLC).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import net from "node:net";
import type { OtDriver } from "../otDriver";
import { ModbusDriver, laQuaHanModbusSerial } from "./modbusDriver";
import { HAN_DU_PHONG_GHI_DRIVER_MS, LoiQuaHanYeuCauDriver, LoiMatLienKetKhiDangGui, ketCucKhongRoCua, laLoiQuaHanYeuCauDriver } from "./dangBay";
import { EIP_TIEN_TO_QUA_HAN_GHI } from "./ethernetIpDriver";
import { OPCUA_TIEN_TO_QUA_HAN } from "./opcuaDriver";
import { executeOtDeviceWrite, OT_TIMED_OUT_WRITE_GRACE_MS, type ExecutedWrite } from "../otDeviceWrite";
import { batDauDoLag } from "../../../testing/doLagBucleSuKien";

type HanhViFc5 = "im_lang" | "ngoai_le_2" | "tra_loi";

/** Server Modbus TCP tối giản: FC5 theo `hanhVi` (im_lang = không trả lời, không đóng; ngoai_le_2 = exception 2 Illegal data address). */
async function startModbusSim(hanhVi: HanhViFc5): Promise<{ port: number; nhanFc5: () => number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>();
  let nhan = 0;
  const server = net.createServer((sock) => {
    sockets.add(sock);
    sock.on("close", () => sockets.delete(sock));
    sock.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 7) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) return;
        const frame = buf.subarray(0, 6 + len);
        buf = buf.subarray(6 + len);
        const tid = frame.readUInt16BE(0);
        const unit = frame[6];
        const fc = frame[7];
        const reply = (pdu: Buffer) => {
          const h = Buffer.alloc(7);
          h.writeUInt16BE(tid, 0);
          h.writeUInt16BE(0, 2);
          h.writeUInt16BE(pdu.length + 1, 4);
          h[6] = unit;
          if (!sock.destroyed) sock.write(Buffer.concat([h, pdu]));
        };
        if (fc !== 5) {
          reply(Buffer.from([fc | 0x80, 1]));
          continue;
        }
        nhan += 1;
        if (hanhVi === "im_lang") continue; // không trả lời, KHÔNG đóng
        if (hanhVi === "ngoai_le_2") reply(Buffer.from([0x85, 2])); // thiết bị ĐÃ trả lời: exception 2
        else reply(frame.subarray(7, 12));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    nhanFc5: () => nhan,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

let dong: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const f of dong.reverse()) await f();
  dong = [];
});

/** Modbus THẬT trên peer giả; `cfg.timeoutMs` = hạn giao dịch của modbus-serial (`client.setTimeout`). */
async function modbusTren(hanhVi: HanhViFc5, cfgTimeoutMs: number): Promise<ModbusDriver> {
  const sim = await startModbusSim(hanhVi);
  const d = new ModbusDriver();
  dong.push(() => sim.close(), () => d.disconnect());
  await d.connect({ endpoint: `tcp://127.0.0.1:${sim.port}`, timeoutMs: cfgTimeoutMs, options: { unitId: 1 } } as any);
  return d;
}
const modbusImLang = (cfgTimeoutMs: number) => modbusTren("im_lang", cfgTimeoutMs);

/** Đường ghi THẬT (executeOtDeviceWrite) của một STOP đã xác minh; tuần tự hoá TẮT (không có hàng / B3). */
async function ghiQuaExecute(a: { driver: OtDriver | Promise<OtDriver>; timeoutMs: number; writes: Array<{ tagKey: string; address: string; value: unknown; dataType?: string }> }): Promise<ExecutedWrite> {
  const driver = await a.driver;
  const ds = a.writes.map((w) => ({ ...w, dataType: (w.dataType ?? "bool") as any }));
  return executeOtDeviceWrite({
    input: { adapterId: 992_000 + Math.floor(Math.random() * 1000), machineId: null, commandType: "stop", idempotencyKey: `quahan-${Math.random()}`, writes: ds.map((w) => ({ tagKey: w.tagKey, value: w.value })) } as any,
    driver,
    resolved: ds.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
    driverWrites: ds.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
    timeoutMs: a.timeoutMs,
    stopTyped: true,
    bumpStopEpoch: true,
    ledger: { intentIds: [1], confirmedBy: 1 },
  });
}

const cuSerialize = process.env.OT_CMD_SERIALIZE_ENABLED;
beforeEach(() => {
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
});
afterEach(() => {
  if (cuSerialize === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
  else process.env.OT_CMD_SERIALIZE_ENABLED = cuSerialize;
});

describe("R1b-2b-2a T2 — Modbus (modbus-serial THẬT): hết hạn giao dịch của thư viện ⇒ 'timeout' không rõ", () => {
  it("★ Modbus: peer IM LẶNG, cfg.timeoutMs 300 < hạn lệnh 2000 ⇒ 'timeout' (không 'failed') (Review Focus 2)", async () => {
    const lag = batDauDoLag();
    const t0 = Date.now();
    const o = await ghiQuaExecute({ driver: modbusImLang(300), timeoutMs: 2000, writes: [{ tagKey: "stop_cmd", address: "00001", value: true }] });
    const troi = Date.now() - t0;
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "timeout" });
    expect(o.outcomes[0].errorText).toMatch(/outcome unknown/);
    expect(o.outcomes[0].errorText).toMatch(/^Timed out — outcome unknown: the write may have been applied on the device$/);
    expect(String(o.outcomes[0].errorText).match(/outcome unknown/g)).toHaveLength(1); // fix round 1 (M-1)
    expect(o.outcomes[0].readBackValue).toBeNull();
    expect(o.timedOut).toBe(false); // hạn của LỆNH chưa hết — "không rõ" là của TỪNG write
    expect(troi).toBeGreaterThanOrEqual(290);
    expect(troi).toBeLessThan(800 + (await lag.dung(200)));
  }, 15_000);

  it("Modbus: peer trả exception 2 ⇒ 'failed' (thiết bị đã trả lời — không đổi)", async () => {
    const o = await ghiQuaExecute({ driver: modbusTren("ngoai_le_2", 300), timeoutMs: 2000, writes: [{ tagKey: "stop_cmd", address: "00001", value: true }] });
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed" });
    expect(o.outcomes[0].errorText).toMatch(/^Modbus exception 2: Illegal data address/);
    expect(o.outcomes[0].errorText).not.toMatch(/outcome unknown/);
  }, 15_000);

  it("laQuaHanModbusSerial: TransactionTimedOutError thật của thư viện ⇒ true; Error('Port Not Open') ⇒ false", async () => {
    // lỗi THẬT: modbus-serial 8.0.25 trên peer im lặng, hạn giao dịch 100 ms
    const sim = await startModbusSim("im_lang");
    dong.push(() => sim.close());
    const mod: any = await import("modbus-serial");
    const ModbusRTU = mod.default ?? mod;
    const c = new ModbusRTU();
    dong.push(() => new Promise<void>((r) => (c.isOpen ? c.close(() => r()) : r())));
    await c.connectTCP("127.0.0.1", { port: sim.port });
    c.setID(1);
    c.setTimeout(100);
    const loi = await c.writeCoil(0, true).then(
      () => null,
      (e: unknown) => e,
    );
    expect(sim.nhanFc5()).toBe(1); // yêu cầu ĐÃ lên dây
    expect(loi).toMatchObject({ name: "TransactionTimedOutError", message: "Timed out", errno: "ETIMEDOUT" });
    expect(loi instanceof Error).toBe(false); // thư viện không kế thừa Error ⇒ không được dựa vào instanceof
    expect(laQuaHanModbusSerial(loi)).toBe(true);
    expect(laQuaHanModbusSerial(new Error("Port Not Open"))).toBe(false);
    // lỗi hệ điều hành của Node: errno là SỐ (Windows −4039 / POSIX −110), code là chuỗi — KHÔNG phải quá hạn giao dịch của thư viện
    expect(laQuaHanModbusSerial(Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:502"), { code: "ETIMEDOUT", errno: -4039, syscall: "connect" }))).toBe(false);
    expect(laQuaHanModbusSerial(new Error("Modbus exception 2: Illegal data address (register not supported by device)"))).toBe(false);
    expect(laQuaHanModbusSerial(null)).toBe(false);
  }, 15_000);
});

describe("R1b-2b-2a T2 — SLMP (socket riêng THẬT): giao dịch quá cfg.timeoutMs ⇒ không rõ", () => {
  it("SLMP: giao dịch quá cfg.timeoutMs ⇒ write mang ketCucKhongRo 'qua_han_driver'", async () => {
    const sockets = new Set<net.Socket>();
    let soKhung = 0;
    const server = net.createServer((s) => {
      sockets.add(s);
      s.on("error", () => undefined);
      s.on("close", () => sockets.delete(s));
      s.on("data", () => {
        soKhung += 1; // IM LẶNG
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    const { SlmpDriver } = await import("./slmpDriver");
    const d = new SlmpDriver();
    dong.push(
      () => d.disconnect(),
      () =>
        new Promise<void>((r) => {
          for (const s of sockets) s.destroy();
          server.close(() => r());
        }),
    );
    await d.connect({ endpoint: `127.0.0.1:${port}`, timeoutMs: 300 });
    const out = await d.writeTags([{ tagKey: "stop", address: "M100", value: true, dataType: "bool" }]);
    expect(soKhung).toBe(1); // khung ĐÃ tới peer
    expect(out).toEqual([
      { tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver", error: "slmp request timed out in the driver (transaction timeout after 300ms) — outcome unknown" },
    ]);

    // qua đường ghi THẬT: 'timeout' không rõ, không 'failed'
    await d.connect({ endpoint: `127.0.0.1:${port}`, timeoutMs: 300 });
    const o = await ghiQuaExecute({ driver: d, timeoutMs: 2000, writes: [{ tagKey: "stop", address: "M100", value: true }] });
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "timeout" });
    expect(o.outcomes[0].errorText).toMatch(/outcome unknown: the write may have been applied on the device$/);
    // fix round 1 (M-1) — thông điệp của driver đã mang "outcome unknown" ⇒ không lặp
    expect(o.outcomes[0].errorText).toBe("slmp request timed out in the driver (transaction timeout after 300ms) — outcome unknown: the write may have been applied on the device");
    expect(String(o.outcomes[0].errorText).match(/outcome unknown/g)).toHaveLength(1);
  }, 15_000);
});

describe("R1b-2b-2a T2 — EtherNet/IP (st-ethernet-ip giả, chuỗi lỗi thật)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("st-ethernet-ip");
  });

  async function eipVoi(writeTag: (tag: { name: string }) => Promise<unknown>): Promise<OtDriver> {
    vi.doMock("st-ethernet-ip", () => ({
      Controller: function () {
        const plc: any = new EventEmitter();
        Object.assign(plc, {
          connect: vi.fn(async () => {}),
          newTag: vi.fn((name: string) => ({ name, value: undefined })),
          // T3A commit 2 (D1) — driver lấy kiểu CIP từ danh sách tag mà thư viện nạp lúc connect (state.tagList)
          state: { tagList: { getTag: (n: string) => ({ name: n, type: { code: 0xc4, structure: false, arrayDims: 0 } }) } },
          writeTag: vi.fn((tag: { name: string }) => writeTag(tag)),
          disconnect: vi.fn(async () => {}),
        });
        return plc;
      },
    }));
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    await d.connect({ endpoint: "192.168.1.10" });
    return d;
  }

  it("EIP: thư viện reject 'TIMEOUT occurred while writing Writing Tag: x.' ⇒ 'qua_han_driver'; bộ hẹn dự phòng = 6500", async () => {
    expect(EIP_TIEN_TO_QUA_HAN_GHI).toBe("TIMEOUT occurred while writing Writing Tag:");
    // (a) hết hạn timeout_sp CỦA THƯ VIỆN — đúng chuỗi của dist/controller/index.js:812
    const d = await eipVoi(async (tag) => {
      throw new Error(`TIMEOUT occurred while writing Writing Tag: ${tag.name}.`);
    });
    expect(await d.writeTags([{ tagKey: "stop", address: "StopCmd", value: true, dataType: "bool" }])).toEqual([
      { tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver", error: "TIMEOUT occurred while writing Writing Tag: StopCmd." },
    ]);
    await d.disconnect();

    // (b) thư viện KHÔNG BAO GIỜ trả lời ⇒ bộ hẹn DỰ PHÒNG của driver ở đúng 6500 ms (không còn 5000) ⇒ lỗi có kiểu, không rõ
    vi.resetModules();
    const d2 = await eipVoi(() => new Promise(() => undefined));
    vi.useFakeTimers();
    let kq: unknown = null;
    const p = d2.writeTags([{ tagKey: "stop", address: "StopCmd", value: true, dataType: "bool" }]).then((v) => (kq = v));
    await vi.advanceTimersByTimeAsync(HAN_DU_PHONG_GHI_DRIVER_MS - 1);
    expect(kq).toBeNull(); // chưa xong ở 5000 hay 6499
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(kq).toEqual([
      { tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver", error: "ethernet-ip request timed out in the driver (eip writeTag timeout after 6500ms) — outcome unknown" },
    ]);
    vi.useRealTimers();
    await d2.disconnect();

    // fix round 1 (M-1) — cùng bộ hẹn dự phòng qua đường ghi THẬT (hạn lệnh 10 s > 6500): 'timeout', "outcome unknown" ĐÚNG một lần
    vi.resetModules();
    const d3 = await eipVoi(() => new Promise(() => undefined));
    const { executeOtDeviceWrite: exec3 } = await import("../otDeviceWrite");
    vi.useFakeTimers();
    let ex3: ExecutedWrite | null = null;
    const p3 = exec3({
      input: { adapterId: 993_001, machineId: null, commandType: "stop", idempotencyKey: `quahan-eip-${Math.random()}`, writes: [{ tagKey: "stop", value: true }] } as any,
      driver: d3,
      resolved: [{ write: { tagKey: "stop", value: true }, address: "StopCmd", dataType: "bool" }] as any,
      driverWrites: [{ tagKey: "stop", address: "StopCmd", value: true, dataType: "bool" as any }],
      timeoutMs: 10_000,
      stopTyped: true,
      bumpStopEpoch: true,
      ledger: { intentIds: [1], confirmedBy: 1 },
    }).then((v) => (ex3 = v));
    await vi.advanceTimersByTimeAsync(HAN_DU_PHONG_GHI_DRIVER_MS);
    await p3;
    vi.useRealTimers();
    expect(ex3!.timedOut).toBe(false);
    expect(ex3!.outcomes[0]).toMatchObject({ ok: false, status: "timeout" });
    expect(ex3!.outcomes[0].errorText).toBe("ethernet-ip request timed out in the driver (eip writeTag timeout after 6500ms) — outcome unknown: the write may have been applied on the device");
    expect(String(ex3!.outcomes[0].errorText).match(/outcome unknown/g)).toHaveLength(1);
    await d3.disconnect();
  });

  it("EIP: thiết bị trả lỗi CIP (đã trả lời) ⇒ không mang ketCucKhongRo ('failed' như cũ)", async () => {
    const d = await eipVoi(async () => {
      throw new Error("Write Tag: Path destination unknown");
    });
    const out = await d.writeTags([{ tagKey: "stop", address: "StopCmd", value: true, dataType: "bool" }]);
    expect(out).toEqual([{ tagKey: "stop", ok: false, error: "Write Tag: Path destination unknown" }]);
    await d.disconnect();
  });
});

describe("R1b-2b-2a T2 — OPC UA (node-opcua giả, chuỗi lỗi thật)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("node-opcua"));

  async function opcuaVoi(write: (nodes: unknown[]) => Promise<unknown>): Promise<{ d: OtDriver; write: ReturnType<typeof vi.fn> }> {
    const w = vi.fn(write);
    vi.doMock("node-opcua", () => ({
      OPCUAClient: {
        create: vi.fn(() => {
          const client: any = new EventEmitter();
          const session = { read: vi.fn(async () => []), write: w, close: vi.fn(async () => {}) };
          Object.assign(client, { session, connect: vi.fn(async () => {}), createSession: vi.fn(async () => session), disconnect: vi.fn(async () => {}) });
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
    return { d, write: w };
  }

  it("OPC UA: session.write reject 'Transaction has timed out ( timeout = 15000 ms …)' ⇒ node đã gửi 'qua_han_driver', node ép kiểu hỏng 'failed'", async () => {
    expect(OPCUA_TIEN_TO_QUA_HAN).toBe("Transaction has timed out");
    // đúng chuỗi của client_secure_channel_layer.js:1147
    const msg = "Transaction has timed out ( timeout = 15000 ms , request = WriteRequest)";
    const { d, write } = await opcuaVoi(async () => {
      throw new Error(msg);
    });
    const out = await d.writeTags([
      { tagKey: "stop", address: "ns=2;s=Stop", value: true, dataType: "bool" },
      { tagKey: "hong", address: "ns=2;s=Hong", value: "off", dataType: "bool" }, // ép kiểu cục bộ hỏng ⇒ KHÔNG gửi
    ]);
    expect(write).toHaveBeenCalledTimes(1);
    expect((write.mock.calls[0][0] as unknown[]).length).toBe(1); // chỉ node 'stop' lên dây
    expect(out[0]).toEqual({ tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver", error: msg });
    expect(out[1].ok).toBe(false);
    expect(out[1].ketCucKhongRo).toBeUndefined();
    expect(out[1].error).toBeTruthy();
    expect(out[1].error).not.toBe(msg);
    await d.disconnect();
  });

  it("OPC UA: lỗi khác của lô (máy chủ trả lời lỗi) ⇒ không mang ketCucKhongRo", async () => {
    const { d } = await opcuaVoi(async () => {
      throw new Error("BadTooManyOperations (0x80100000)");
    });
    const out = await d.writeTags([{ tagKey: "stop", address: "ns=2;s=Stop", value: true, dataType: "bool" }]);
    expect(out).toEqual([{ tagKey: "stop", ok: false, error: "BadTooManyOperations (0x80100000)" }]);
    await d.disconnect();
  });
});

describe("R1b-2b-2a T2 — lõi: lỗi có kiểu + hằng", () => {
  it("HAN_DU_PHONG_GHI_DRIVER_MS > hạn mặc định + ân hạn B3", async () => {
    const { ackTimeoutMacDinhMs } = await import("../commandDispatcher");
    expect(HAN_DU_PHONG_GHI_DRIVER_MS).toBe(6500);
    expect(HAN_DU_PHONG_GHI_DRIVER_MS).toBeGreaterThan(ackTimeoutMacDinhMs() + OT_TIMED_OUT_WRITE_GRACE_MS);
  });

  it("ketCucKhongRoCua: mất liên kết ⇒ 'mat_lien_ket'; quá hạn driver ⇒ 'qua_han_driver' (instanceof hoặc code); lỗi khác ⇒ null", () => {
    const e = new LoiQuaHanYeuCauDriver("slmp", "transaction timeout after 300ms");
    expect(e.message).toBe("slmp request timed out in the driver (transaction timeout after 300ms) — outcome unknown");
    expect(e.code).toBe("OT_DRIVER_REQUEST_TIMEOUT");
    expect(laLoiQuaHanYeuCauDriver(e)).toBe(true);
    expect(laLoiQuaHanYeuCauDriver({ code: "OT_DRIVER_REQUEST_TIMEOUT" })).toBe(true); // qua ranh giới module / edge
    expect(ketCucKhongRoCua(e)).toBe("qua_han_driver");
    expect(ketCucKhongRoCua({ code: "OT_DRIVER_REQUEST_TIMEOUT" })).toBe("qua_han_driver");
    expect(ketCucKhongRoCua(new LoiMatLienKetKhiDangGui("modbus", "x"))).toBe("mat_lien_ket");
    expect(ketCucKhongRoCua(new Error("Timed out"))).toBeNull();
    expect(ketCucKhongRoCua(undefined)).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// R1b-2b-2a T3 (mục 66, phần 2) — S7 (nodes7 0.3.18). Thư viện báo hết hạn ghi KHÔNG bằng lỗi mà bằng writeDoneCallback(true) — y hệt PLC trả lỗi.
// Phân biệt bằng errCode item (thăm dò thật: quaHanGhi.thuVienThat.r1b2b2.test.ts). Conn giả mang ĐÚNG hình đã thăm dò:
//   writePacketArray: [{ timeoutError, itemList: [{ valid:false, errCode? , writeResponse? }, …] }]
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
type GoiS7 = { timeoutError?: boolean; itemList: Array<Record<string, unknown>> };
const ITEM_QUA_HAN_S7 = { valid: false, errCode: "We must have timed Out - we have no response to process" };

/** nodes7 giả: `phanHoi(conn, cb)` quyết định gói + callback của mỗi writeItems (không gọi cb = treo). */
function nodes7Gia(phanHoi: (conn: any, cb: (bad: boolean) => void) => void) {
  const ds: any[] = [];
  const Lib = function (this: any) {
    const c: any = {
      isoConnectionState: 4,
      writePacketArray: [] as GoiS7[],
      soGhi: 0,
      initiateConnection: vi.fn((_o: unknown, cb: (e?: unknown) => void) => cb()),
      setTranslationCB: vi.fn(),
      writeItems: vi.fn((_k: string[], _v: unknown[], cb: (bad: boolean) => void) => {
        c.soGhi += 1;
        phanHoi(c, cb);
        return 0;
      }),
      dropConnection: vi.fn((cb?: () => void) => cb?.()),
      connectionCleanup: vi.fn(),
      on: vi.fn(),
    };
    ds.push(c);
    return c;
  } as unknown as new () => any;
  vi.doMock("nodes7", () => ({ default: Lib }));
  return ds;
}

async function s7VoiGia(phanHoi: (conn: any, cb: (bad: boolean) => void) => void) {
  const ds = nodes7Gia(phanHoi);
  const M = await import("./s7Driver");
  const d = new M.S7Driver();
  await d.connect({ endpoint: "127.0.0.1:102", timeoutMs: 300 });
  return { d, M, conn: ds[0] };
}

const STOP_S7 = [{ tagKey: "stop", address: "DB1,X0.0", value: true, dataType: "bool" as const }];

describe("R1b-2b-2a T3 — S7 (nodes7 giả, hình THĂM DÒ): hết hạn của thư viện ⇒ 'qua_han_driver'; PLC trả lỗi / chưa gửi ⇒ 'failed'", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock("nodes7");
  });

  it("hằng thăm dò + ân hạn B3 của driver = OT_TIMED_OUT_WRITE_GRACE_MS; công thức bộ hẹn dự phòng theo OT_CONTROL_TIMEOUT_MS", async () => {
    const M = await import("./s7Driver");
    expect(M.S7_ERRCODE_QUA_HAN_GHI).toBe("We must have timed Out - we have no response to process");
    expect(M.AN_HAN_B3_CHO_DRIVER_MS).toBe(OT_TIMED_OUT_WRITE_GRACE_MS);
    const cu = process.env.OT_CONTROL_TIMEOUT_MS;
    try {
      delete process.env.OT_CONTROL_TIMEOUT_MS;
      expect(M.hanDuPhongGhiS7Ms()).toBe(HAN_DU_PHONG_GHI_DRIVER_MS); // 6500 = max(6500, 5000 + 1500)
      process.env.OT_CONTROL_TIMEOUT_MS = "8000";
      expect(M.hanDuPhongGhiS7Ms()).toBe(9500);
      process.env.OT_CONTROL_TIMEOUT_MS = "3000";
      expect(M.hanDuPhongGhiS7Ms()).toBe(6500);
      process.env.OT_CONTROL_TIMEOUT_MS = "rác";
      expect(M.hanDuPhongGhiS7Ms()).toBe(6500);
    } finally {
      if (cu === undefined) delete process.env.OT_CONTROL_TIMEOUT_MS;
      else process.env.OT_CONTROL_TIMEOUT_MS = cu;
    }
  });

  it("★ S7: gói ĐÃ gửi hết hạn của thư viện (errCode thăm dò) ⇒ mọi write 'qua_han_driver'; qua executeOtDeviceWrite ⇒ 'timeout' không rõ; phiên KHÔNG bị hạ (thư viện đã tự đặt lại)", async () => {
    const { d, conn } = await s7VoiGia((c, cb) => {
      c.writePacketArray = [{ timeoutError: false, itemList: [{ ...ITEM_QUA_HAN_S7 }, { valid: false }] }];
      setTimeout(() => cb(true), 5);
    });
    const out = await d.writeTags([...STOP_S7, { tagKey: "sp", address: "DB1,INT2", value: 7, dataType: "int" }]);
    const msg = "s7 request timed out in the driver (nodes7 write packet timeout: We must have timed Out - we have no response to process) — outcome unknown";
    expect(out).toEqual([
      { tagKey: "stop", ok: false, error: msg, ketCucKhongRo: "qua_han_driver" },
      { tagKey: "sp", ok: false, error: msg, ketCucKhongRo: "qua_han_driver" },
    ]);
    expect(conn.dropConnection).not.toHaveBeenCalled();
    expect(d.isConnected()).toBe(true);
    const o = await ghiQuaExecute({ driver: d, timeoutMs: 2000, writes: [{ tagKey: "stop", address: "DB1,X0.0", value: true }] });
    expect(o.timedOut).toBe(false);
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "timeout" });
    expect(o.outcomes[0].errorText).toBe(`${msg}: the write may have been applied on the device`);
    expect(o.outcomes[0].readBackValue).toBeNull();
  });

  it("S7: PLC trả lỗi ('Received write error' — writeResponse 0x0A, KHÔNG errCode) ⇒ 'failed' (thiết bị đã trả lời)", async () => {
    const { d } = await s7VoiGia((c, cb) => {
      c.writePacketArray = [{ timeoutError: false, itemList: [{ valid: false, writeResponse: 10 }] }];
      cb(true);
    });
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: false, error: "bad write quality" }]);
    const o = await ghiQuaExecute({ driver: d, timeoutMs: 2000, writes: [{ tagKey: "stop", address: "DB1,X0.0", value: true }] });
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed", errorText: "bad write quality" });
  });

  it("S7: item valid === true mang errCode CŨ ⇒ bỏ qua ⇒ 'failed'", async () => {
    const { d } = await s7VoiGia((c, cb) => {
      c.writePacketArray = [{ timeoutError: false, itemList: [{ valid: true, errCode: ITEM_QUA_HAN_S7.errCode }, { valid: false, writeResponse: 5 }] }];
      cb(true);
    });
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: false, error: "bad write quality" }]);
  });

  it("S7: gói KHÔNG được gửi (timeoutError=true, iso ≠ 4 — thăm dò S7-d) mang CÙNG errCode ⇒ 'failed' (không gửi gì), không 'timeout'", async () => {
    const { d, M } = await s7VoiGia((c, cb) => {
      c.writePacketArray = [{ timeoutError: true, itemList: [{ ...ITEM_QUA_HAN_S7 }] }];
      cb(true);
    });
    expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: false, error: "bad write quality" }]);
    expect(M.laQuaHanGhiS7({ writePacketArray: [{ timeoutError: true, itemList: [{ ...ITEM_QUA_HAN_S7 }] }] })).toBe(false);
    // phòng thủ: hình lạ ⇒ false, không ném
    for (const x of [null, undefined, 5, {}, { writePacketArray: "x" }, { writePacketArray: [null, { itemList: "y" }, { itemList: [null, 3] }] }]) {
      expect(M.laQuaHanGhiS7(x)).toBe(false);
    }
  });

  it("★ S7: thư viện KHÔNG BAO GIỜ gọi lại ⇒ bộ hẹn dự phòng ĐÚNG hanDuPhongGhiS7Ms (6500, đồng hồ giả) ⇒ 'qua_han_driver' + phiên bị HẠ trước khi trả (dropConnection + connectionCleanup); lệnh kế không tới thư viện cũ", async () => {
    const { d, conn } = await s7VoiGia(() => undefined);
    vi.useFakeTimers();
    let kq: unknown = null;
    const p = d.writeTags(STOP_S7).then((v) => (kq = v));
    await vi.advanceTimersByTimeAsync(HAN_DU_PHONG_GHI_DRIVER_MS - 1);
    expect(kq).toBeNull();
    expect(conn.dropConnection).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    vi.useRealTimers();
    expect(kq).toEqual([
      { tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver", error: "s7 request timed out in the driver (s7 writeItems backup timeout after 6500ms) — outcome unknown" },
    ]);
    expect(conn.dropConnection).toHaveBeenCalledTimes(1);
    expect(conn.connectionCleanup).toHaveBeenCalledTimes(1);
    expect(d.isConnected()).toBe(false);
    expect((await d.health()).lastError).toMatch(/^s7 session torn down \(/);
    await expect(d.writeTags(STOP_S7)).rejects.toThrow(); // DeviceUnreachableError — không gửi gì
    expect(conn.writeItems).toHaveBeenCalledTimes(1); // STOP kế KHÔNG tới thư viện còn giữ yêu cầu cũ
  });

  it("★ hạn lệnh 8000 (OT_CONTROL_TIMEOUT_MS) + lời ghi treo ⇒ hạn DISPATCHER thắng (timedOut ⇒ nhánh B3) — bộ hẹn dự phòng 9500 chưa bắn ở 8000 + ân hạn B3", async () => {
    const cu = process.env.OT_CONTROL_TIMEOUT_MS;
    process.env.OT_CONTROL_TIMEOUT_MS = "8000";
    try {
      const { d, conn } = await s7VoiGia(() => undefined);
      vi.useFakeTimers();
      let ex: ExecutedWrite | null = null;
      const p = ghiQuaExecute({ driver: d, timeoutMs: 8000, writes: [{ tagKey: "stop", address: "DB1,X0.0", value: true }] }).then((v) => (ex = v));
      await vi.advanceTimersByTimeAsync(8000);
      await p;
      expect(ex!.timedOut).toBe(true); // hạn của dispatcher tới TRƯỚC — B3 (giữ chỗ + đặt lại phiên) chạy khi tuần tự hoá bật
      expect(ex!.outcomes[0]).toMatchObject({ ok: false, status: "timeout", errorText: "write timeout after 8000ms — outcome unknown: the write may have been applied on the device" });
      // hết ân hạn B3 (8000 + 1000): driver CHƯA tự hạ phiên — B3 là người hạ (không đua)
      await vi.advanceTimersByTimeAsync(OT_TIMED_OUT_WRITE_GRACE_MS);
      expect(conn.dropConnection).not.toHaveBeenCalled();
      // bộ hẹn dự phòng ở 9500 ⇒ hạ phiên (lưới cuối nếu B3 không chạy: tuần tự hoá tắt / hạn riêng lớn hơn)
      await vi.advanceTimersByTimeAsync(500);
      expect(conn.dropConnection).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    } finally {
      vi.useRealTimers();
      if (cu === undefined) delete process.env.OT_CONTROL_TIMEOUT_MS;
      else process.env.OT_CONTROL_TIMEOUT_MS = cu;
    }
  });
});

describe("R1b-2b-2a T3 — S7 (nodes7 THẬT + __s7commSim): đầu-cuối", () => {
  beforeEach(() => vi.resetModules());

  async function s7Sim(fault: "hangWrite" | "writeError" | null, cfgTimeoutMs: number) {
    const { startS7commSim } = await import("./__s7commSim");
    const sim = await startS7commSim();
    sim.setFault(fault);
    const { S7Driver } = await import("./s7Driver");
    const d = new S7Driver();
    dong.push(() => sim.close(), () => d.disconnect());
    await d.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: cfgTimeoutMs });
    const soPduGhi = (conn?: number) => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05 && (conn === undefined || p.conn === conn)).length;
    return { sim, d, soPduGhi };
  }

  it("★ S7 thật: PLC IM (hangWrite), hạn gói thư viện 300 < hạn lệnh 2000 ⇒ 'timeout' không rõ (không 'failed'); PDU ghi ĐÃ lên dây", async () => {
    const { d, soPduGhi } = await s7Sim("hangWrite", 300);
    const lag = batDauDoLag();
    const t0 = Date.now();
    const o = await ghiQuaExecute({ driver: d, timeoutMs: 2000, writes: [{ tagKey: "stop", address: "DB1,X0.0", value: true }] });
    const troi = Date.now() - t0;
    expect(soPduGhi()).toBe(1);
    expect(o.timedOut).toBe(false);
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "timeout" });
    expect(String(o.outcomes[0].errorText).match(/outcome unknown/g)).toHaveLength(1);
    expect(troi).toBeGreaterThanOrEqual(290);
    expect(troi).toBeLessThan(800 + (await lag.dung(200)));
  }, 15_000);

  it("S7 thật: PLC trả mã lỗi 0x0A (writeError) ⇒ 'failed'", async () => {
    const { d } = await s7Sim("writeError", 300);
    const o = await ghiQuaExecute({ driver: d, timeoutMs: 2000, writes: [{ tagKey: "stop", address: "DB1,X0.0", value: true }] });
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed", errorText: "bad write quality" });
  }, 15_000);

  it("★★ hạn lệnh 8000 + thư viện giữ lời ghi (hạn gói 20 s, PLC im) ⇒ bộ hẹn dự phòng ĐÚNG 9500 (SAU hạn dispatcher + ân hạn B3), phiên cũ HẠ trước khi trả; STOP kế KHÔNG chồng: không gửi trên phiên cũ, sau nối lại đi trên phiên MỚI", async () => {
    const cu = process.env.OT_CONTROL_TIMEOUT_MS;
    process.env.OT_CONTROL_TIMEOUT_MS = "8000";
    try {
      const { sim, d, soPduGhi } = await s7Sim("hangWrite", 20_000);
      const lag = batDauDoLag();
      const t0 = Date.now();
      const out = await d.writeTags(STOP_S7);
      const troi = Date.now() - t0;
      const lagMs = await lag.dung(200);
      expect(out).toEqual([
        { tagKey: "stop", ok: false, ketCucKhongRo: "qua_han_driver", error: "s7 request timed out in the driver (s7 writeItems backup timeout after 9500ms) — outcome unknown" },
      ]);
      expect(troi).toBeGreaterThanOrEqual(9500 - 20); // không bao giờ TRƯỚC hạn dispatcher 8000 + ân hạn B3 1000
      expect(troi).toBeLessThan(9500 + 300 + lagMs);
      expect(soPduGhi(0)).toBe(1);
      // phiên cũ đã hạ NGAY (connectionCleanup huỷ socket): sim thấy kết nối đóng
      await vi.waitFor(() => expect(sim.stats().open).toBe(0), { timeout: 1000, interval: 10 });
      expect(d.isConnected()).toBe(false);
      // STOP kế trước khi nối lại ⇒ không gửi gì (DeviceUnreachableError ⇒ 'failed'), không bao giờ chồng lên lời ghi cũ
      await expect(d.writeTags(STOP_S7)).rejects.toThrow();
      expect(soPduGhi()).toBe(1);
      // supervisor nối lại (ở đây gọi tay) ⇒ STOP đi trên phiên MỚI, phiên cũ không nhận thêm gì
      sim.setFault(null);
      await d.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 20_000 });
      expect(await d.writeTags(STOP_S7)).toEqual([{ tagKey: "stop", ok: true }]);
      expect(soPduGhi(0)).toBe(1);
      expect(soPduGhi(1)).toBe(1);
    } finally {
      if (cu === undefined) delete process.env.OT_CONTROL_TIMEOUT_MS;
      else process.env.OT_CONTROL_TIMEOUT_MS = cu;
    }
  }, 30_000);
});
