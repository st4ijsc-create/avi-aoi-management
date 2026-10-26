/**
 * SCADA R1b-2b-1 (bench B1b, điều phối 2026-10-27 — Phương án A + nhãn (a) "không rõ kết cục", điều kiện 3: quét MỌI driver) —
 * lệnh ghi ĐANG BAY khi liên kết mất / phiên bị hạ ⇒ dispatcher trả lời NGAY `timeout` (không rõ kết cục), không bao giờ `failed`.
 *
 * Mỗi driver × điểm huỷ (đường ghi THẬT `executeOtDeviceWrite`; thư viện giao thức GIẢ mô hình hoá đúng hành vi đã đọc trong mã thư viện —
 * lệnh ghi đang chờ KHÔNG được trả lời khi phiên bị hạ; SLMP: server TCP thật trong tiến trình):
 *   • S7 (nodes7 0.3.x): dropConnection ⇒ connectionCleanup ⇒ clearWritePacketTimeouts, writeDoneCallback không gọi.  (ii) (iii) (i)*
 *   • MC (mcprotocol 0.1.2): dropConnection ⇒ connectionCleanup ⇒ clearWritePacketTimeouts, không gọi lại.          (ii) (iii) (i)*
 *   • EIP (st-ethernet-ip 2.7.5): disconnect() không trả lời lệnh đang chờ; chỉ promiseTimeout(timeout_sp) sau ~hạn. (i) (ii) (iii)
 *   • OPC UA (node-opcua 2.174): transport đóng ⇒ huỷ CÓ gọi lại nhưng bằng lỗi thường ('failed'); 'connection_lost' phát ĐỒNG BỘ
 *     trước bước huỷ ⇒ ta reject trước với lỗi có kiểu.                                                              (i) (ii) (iii)
 *   • SLMP (socket riêng): đã reject ngay ở cả ba điểm từ trước — chỉ đổi lỗi sang có kiểu (trước: 'failed').           (i) (ii) (iii)
 *   (i)* S7/MC: nodes7 / mcprotocol KHÔNG phải EventEmitter; liên kết mất được thấy qua isoConnectionState (vòng canh ⇒ disconnect ⇒ (ii))
 *        hoặc lỗi socket qua lớp gia cố MC. Ca (i) ở đây đi qua listener `conn.on` mà driver gắn khi thư viện có — cùng markLinkLost.
 * Trước bản vá: S7/MC/EIP ⇒ 'failed' sau 5000 ms (hạn cứng của driver); OPC UA/SLMP ⇒ 'failed' (nói sai: lệnh có thể đã tới PLC).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import net from "node:net";
import type { OtDriver } from "../otDriver";

const HAN_NHANH_MS = 300;

type Ex = { timedOut: boolean; outcomes: Array<{ ok: boolean; status: string; errorText: string | null }> };

async function guiStop(driver: OtDriver, write: { tagKey: string; address: string; dataType: string; value: unknown }): Promise<Ex> {
  const { executeOtDeviceWrite } = await import("../otDeviceWrite");
  return executeOtDeviceWrite({
    input: { adapterId: 991_000 + Math.floor(Math.random() * 1000), commandType: "stop", idempotencyKey: `dangbay-${Math.random()}` } as any,
    driver,
    resolved: [{ write: { tagKey: write.tagKey, value: write.value }, address: write.address, dataType: write.dataType }],
    driverWrites: [{ tagKey: write.tagKey, address: write.address, value: write.value, dataType: write.dataType as any }],
    timeoutMs: 5000,
    stopTyped: true,
    bumpStopEpoch: true,
    ledger: { intentIds: [1], confirmedBy: 1 },
  }) as Promise<Ex>;
}

function laKhongRoKetCuc(ex: Ex): void {
  expect(ex.timedOut).toBe(true);
  expect(ex.outcomes).toHaveLength(1);
  expect(ex.outcomes[0].ok).toBe(false);
  expect(ex.outcomes[0].status).toBe("timeout");
  expect(String(ex.outcomes[0].errorText)).toMatch(/link lost while the write was in flight.*outcome unknown: the write may have been applied/);
}

const tick = () => new Promise<void>((r) => setImmediate(r));

/** Bắn điểm huỷ khi lệnh ghi đã tới thư viện; đo từ lúc bắn tới lúc dispatcher trả lời. */
async function doDiemHuy(p: Promise<Ex>, daToiThuVien: () => boolean, ban: () => unknown): Promise<{ ex: Ex; ms: number }> {
  const het = performance.now() + 2000;
  while (!daToiThuVien() && performance.now() < het) await (daToiThuVien() ? tick() : new Promise<void>((r) => setTimeout(r, 2)));
  expect(daToiThuVien()).toBe(true);
  const t0 = performance.now();
  void Promise.resolve(ban()).catch(() => undefined);
  const ex = await Promise.race([p, new Promise<Ex>((_, rej) => setTimeout(() => rej(new Error("không trả lời trong 6 s")), 6000))]);
  return { ex, ms: Math.round(performance.now() - t0) };
}

type Diem = "i" | "ii" | "iii";

// ───────────────────────── S7 / MC (thư viện callback, lệnh ghi treo khi phiên bị hạ) ─────────────────────────
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
      soGhi: 0,
      // lệnh ghi được nhận, KHÔNG BAO GIỜ gọi lại (đúng như thư viện thật sau connectionCleanup)
      writeItems: vi.fn(function (this: any) {
        this.soGhi += 1;
        return 0;
      }),
      dropConnection: vi.fn((cb?: () => void) => cb?.()),
    });
    dsConn.push(this);
  }
  return { Lib, dsConn };
}

describe.each([
  { ten: "S7 (nodes7)", pkg: "nodes7", mod: "./s7Driver", lop: "S7Driver", address: "DB1,X0.0" },
  { ten: "MC (mcprotocol)", pkg: "mcprotocol", mod: "./mitsubishiMcDriver", lop: "MitsubishiMcDriver", address: "M100" },
])("R1b-2b-1 $ten — lệnh ghi đang bay ⇒ 'timeout' (không rõ) NGAY", ({ pkg, mod, lop, address }) => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock(pkg));

  for (const diem of ["i", "ii", "iii"] as Diem[]) {
    it(`(${diem}) ${diem === "i" ? "lỗi/đóng liên kết của phiên" : diem === "ii" ? "disconnect()" : "connect() thay phiên cũ"} ⇒ timeout < ${HAN_NHANH_MS} ms`, async () => {
      const { Lib, dsConn } = giaLibCallback();
      vi.doMock(pkg, () => ({ default: Lib }));
      const M = await import(mod);
      const d: OtDriver = new M[lop]();
      await d.connect({ endpoint: "127.0.0.1" });
      const p = guiStop(d, { tagKey: "stop", address, dataType: "bool", value: true });
      const conn = dsConn[0];
      const { ex, ms } = await doDiemHuy(
        p,
        () => conn.soGhi === 1,
        () => (diem === "i" ? conn.emit("error", new Error("ECONNRESET")) : diem === "ii" ? d.disconnect() : d.connect({ endpoint: "127.0.0.1" })),
      );
      laKhongRoKetCuc(ex);
      expect(ms).toBeLessThan(HAN_NHANH_MS);
      if (diem === "iii") expect(d.isConnected()).toBe(true);
      await d.disconnect();
    }, 15_000);
  }
});

// ───────────────────────── EtherNet/IP (Controller là EventEmitter) ─────────────────────────
describe("R1b-2b-1 EtherNet/IP (st-ethernet-ip) — lệnh ghi đang bay ⇒ 'timeout' (không rõ) NGAY", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("st-ethernet-ip"));

  for (const diem of ["i", "ii", "iii"] as Diem[]) {
    it(`(${diem}) ⇒ timeout < ${HAN_NHANH_MS} ms`, async () => {
      const ds: any[] = [];
      vi.doMock("st-ethernet-ip", () => ({
        Controller: function () {
          const plc: any = new EventEmitter();
          Object.assign(plc, {
            connect: vi.fn(async () => {}),
            newTag: vi.fn((name: string) => ({ name, value: undefined })),
            soGhi: 0,
            // st-ethernet-ip 2.7.5: disconnect() hạ socket nhưng lệnh ghi đang chờ chỉ xong ở promiseTimeout(timeout_sp) — ở đây: không bao giờ
            writeTag: vi.fn(() => {
              plc.soGhi += 1;
              return new Promise(() => undefined);
            }),
            disconnect: vi.fn(async () => {}),
          });
          ds.push(plc);
          return plc;
        },
      }));
      const { EthernetIpDriver } = await import("./ethernetIpDriver");
      const d = new EthernetIpDriver();
      await d.connect({ endpoint: "192.168.1.10" });
      const p = guiStop(d, { tagKey: "stop", address: "StopCmd", dataType: "bool", value: true });
      const plc = ds[0];
      const { ex, ms } = await doDiemHuy(
        p,
        () => plc.soGhi === 1,
        () => (diem === "i" ? plc.emit("close") : diem === "ii" ? d.disconnect() : d.connect({ endpoint: "192.168.1.10" })),
      );
      laKhongRoKetCuc(ex);
      expect(ms).toBeLessThan(HAN_NHANH_MS);
      await d.disconnect();
    }, 15_000);
  }
});

// ───────────────────────── OPC UA (OPCUAClient là EventEmitter) ─────────────────────────
describe("R1b-2b-1 OPC UA (node-opcua) — lệnh ghi đang bay ⇒ 'timeout' (không rõ) NGAY, không 'failed'", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.doUnmock("node-opcua"));

  for (const diem of ["i", "ii", "iii"] as Diem[]) {
    it(`(${diem}) ⇒ timeout < ${HAN_NHANH_MS} ms`, async () => {
      const dsClient: any[] = [];
      const huyCho: Array<(e: Error) => void> = [];
      const taoClient = () => {
        const client: any = new EventEmitter();
        const session = {
          read: vi.fn(async () => []),
          soGhi: 0,
          // node-opcua: transport đóng ⇒ _cancel_pending_transactions gọi lại BẰNG LỖI THƯỜNG — mô phỏng: reject khi client 'close'
          write: vi.fn(
            () =>
              new Promise((_, rej) => {
                session.soGhi += 1;
                huyCho.push(rej);
              }),
          ),
          close: vi.fn(async () => {}),
        };
        Object.assign(client, {
          session,
          connect: vi.fn(async () => {}),
          createSession: vi.fn(async () => session),
          disconnect: vi.fn(async () => {
            // đóng transport ⇒ thư viện huỷ giao dịch đang chờ bằng lỗi thường (SAU khi phát 'close')
            client.emit("close");
            for (const r of huyCho.splice(0)) r(new Error("Transaction has been canceled because client channel is being closed"));
          }),
        });
        dsClient.push(client);
        return client;
      };
      class Variant {
        constructor(public o: any) {}
      }
      vi.doMock("node-opcua", () => ({
        OPCUAClient: { create: vi.fn(() => taoClient()) },
        AttributeIds: { Value: 13 },
        DataType: { Boolean: 1, Int32: 6, Double: 11, String: 12 },
        Variant,
      }));
      const { OpcuaDriver } = await import("./opcuaDriver");
      const d = new OpcuaDriver();
      await d.connect({ endpoint: "opc.tcp://x" });
      const p = guiStop(d, { tagKey: "stop", address: "ns=2;s=Stop", dataType: "bool", value: true });
      const c0 = dsClient[0];
      const { ex, ms } = await doDiemHuy(
        p,
        () => c0.session.soGhi === 1,
        () => {
          if (diem === "i") {
            // node-opcua ClientBaseImpl: secureChannel 'close'(err) ⇒ emit('connection_lost') ĐỒNG BỘ, rồi mới _cancel_pending_transactions
            c0.emit("connection_lost");
            for (const r of huyCho.splice(0)) r(new Error("Connection Break"));
            return undefined;
          }
          return diem === "ii" ? d.disconnect() : d.connect({ endpoint: "opc.tcp://x" });
        },
      );
      laKhongRoKetCuc(ex);
      expect(ms).toBeLessThan(HAN_NHANH_MS);
      await d.disconnect();
    }, 15_000);
  }
});

// ───────────────────────── SLMP (socket riêng, server TCP thật trong tiến trình) ─────────────────────────
describe("R1b-2b-1 SLMP — lệnh ghi đang bay ⇒ 'timeout' (không rõ) NGAY, không 'failed'", () => {
  for (const diem of ["i", "ii", "iii"] as Diem[]) {
    it(`(${diem}) ⇒ timeout < ${HAN_NHANH_MS} ms`, async () => {
      const sockets = new Set<net.Socket>();
      let soKhungNhan = 0;
      const server = net.createServer((s) => {
        sockets.add(s);
        s.on("error", () => undefined);
        s.on("close", () => sockets.delete(s));
        s.on("data", () => {
          soKhungNhan += 1; // IM LẶNG: không trả lời, không đóng
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
      const port = (server.address() as net.AddressInfo).port;
      const { SlmpDriver } = await import("./slmpDriver");
      const d = new SlmpDriver();
      try {
        await d.connect({ endpoint: `127.0.0.1:${port}`, timeoutMs: 5000 });
        const p = guiStop(d, { tagKey: "stop", address: "M100", dataType: "bool", value: true });
        let daToi = false;
        const { ex, ms } = await doDiemHuy(
          p,
          () => {
            daToi = daToi || soKhungNhan >= 1;
            return daToi;
          },
          () => {
            if (diem === "i") {
              for (const s of sockets) s.destroy();
              return undefined;
            }
            return diem === "ii" ? d.disconnect() : d.connect({ endpoint: `127.0.0.1:${port}`, timeoutMs: 5000 });
          },
        );
        laKhongRoKetCuc(ex);
        // (i): đo từ lúc server huỷ socket tới lúc trả lời — gồm cả thời gian hệ điều hành báo 'close'
        expect(ms).toBeLessThan(HAN_NHANH_MS);
      } finally {
        await d.disconnect();
        for (const s of sockets) s.destroy();
        await new Promise<void>((r) => server.close(() => r()));
      }
    }, 15_000);
  }
});
