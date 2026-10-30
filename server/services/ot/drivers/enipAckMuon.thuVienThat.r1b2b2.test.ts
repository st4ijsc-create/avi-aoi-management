/**
 * SCADA R1b-2b-2a T3A (backlog 79, AN TOÀN) — st-ethernet-ip 2.7.5 THẬT × thiết bị ENIP GIẢ trong tiến trình (cổng tạm: ghi đè
 * `dist/config.EIP_PORT`, không đổi đường mã của thư viện). Thiết bị giả trả lời RegisterSession / ForwardOpen / ForwardClose / identity / danh sách tag /
 * Read Tag / Write Tag theo móc của từng ca ⇒ điều khiển được THỜI ĐIỂM ack, và đếm gói theo từng KẾT NỐI TCP.
 *
 * Step 0 (thăm dò, đo 2026-10-30): thư viện không tương quan trả lời ↔ yêu cầu (listener "Write Tag" / "Read Tag" của yêu cầu hết hạn còn gắn,
 * dist/controller/index.js:814-831 / :733-757; seq SendUnitData bị bỏ :1072) ⇒ ack MUỘN của ghi A giải STOP kế = ok (~30 ms, STOP chưa được trả lời);
 * trả lời MUỘN của đọc TagA ⇒ đọc TagB "good" = 111 (giá trị TagA). Vá (dieu-phoi D2/D3): BẤT KỲ hết hạn của thư viện ⇒ phiên NHIỄM ⇒ hạ + phiên MỚI;
 * thao tác kế chờ phiên mới có trần HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS; quá trần ⇒ không gửi, `failed`.
 *
 * Commit 1 (phiên nhiễm): kiểu CIP của tag được GÁN TRONG TEST (`ganKieuTrongTest`) — driver hôm nay chưa đặt kiểu (P1, sửa ở commit 2).
 */
import net from "node:net";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { batDauDoLag } from "../../../testing/doLagBucleSuKien";
import { ketCucKhongRoCua } from "./dangBay";
import { HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS } from "./ethernetIpDriver";
import { executeOtDeviceWrite } from "../otDeviceWrite";

const require_ = createRequire(import.meta.url);
const enip = require_("st-ethernet-ip/dist/enip");
const cauHinhThuVien = require_("st-ethernet-ip/dist/config");

const BOOL = 0xc1;
const DINT = 0xc4;

type YeuCau = { service: number; ten: string; seq: number; ketNoi: number; duLieu: Buffer };
type TraLoi = (status?: number, data?: Buffer) => void;

interface TuyChonThietBi {
  /** Read Tag (0x4C) / Write Tag (0x4D): móc quyết định có trả lời / khi nào. */
  onYeuCau: (req: YeuCau, traLoi: TraLoi) => void;
  /** Kết nối thứ `n` (1-based) KHÔNG được trả lời RegisterSession (phiên mới treo). */
  giuRegister?: (n: number) => boolean;
  /** false ⇒ không trả ForwardClose (socket cũ còn mở tới khi thư viện tự hết hạn) — ack muộn TỚI ĐƯỢC Controller cũ. */
  traLoiForwardClose?: boolean;
  /** Danh sách tag (tên, mã kiểu CIP) trả cho Get Instance Attribute List. */
  tags?: Array<[string, number]>;
}

const TAG_MAC_DINH: Array<[string, number]> = [
  ["Speed", DINT],
  ["Stop", BOOL],
  ["TagA", DINT],
  ["TagB", DINT],
  ["TagC", DINT],
];

/** Thiết bị ENIP giả trong tiến trình (Logix tối giản, nhắn tin CÓ KẾT NỐI như `new Controller()` mặc định). */
async function dungThietBi(tc: TuyChonThietBi) {
  const socks = new Set<net.Socket>();
  const yeuCau: YeuCau[] = [];
  let soKetNoi = 0;
  const session = 0x1234;
  const connId = 0x55667788;
  const mrTraLoi = (service: number, status = 0, data: Buffer = Buffer.alloc(0)) => Buffer.concat([Buffer.from([service | 0x80, 0, status, 0]), data]);
  const tenTuPath = (path: Buffer) => (path[0] === 0x91 ? path.subarray(2, 2 + path[1]).toString() : "");
  const danhSachTag = () => {
    const phan: Buffer[] = [];
    (tc.tags ?? TAG_MAC_DINH).forEach(([ten, kieu], i) => {
      const b = Buffer.alloc(8 + ten.length);
      b.writeUInt32LE(i + 1, 0);
      b.writeUInt16LE(ten.length, 4);
      b.write(ten, 6);
      b.writeUInt16LE(kieu, 6 + ten.length);
      phan.push(b);
    });
    return Buffer.concat(phan);
  };
  const srv = net.createServer((s) => {
    socks.add(s);
    const ketNoi = ++soKetNoi;
    s.on("close", () => socks.delete(s));
    s.on("error", () => undefined);
    let buf = Buffer.alloc(0);
    s.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 24) {
        const len = buf.readUInt16LE(2);
        if (buf.length < 24 + len) break;
        const goi = buf.subarray(0, 24 + len);
        buf = buf.subarray(24 + len);
        xuLy(s, ketNoi, goi);
      }
    });
  });
  function xuLy(s: net.Socket, ketNoi: number, goi: Buffer) {
    const cmd = goi.readUInt16LE(0);
    const data = goi.subarray(24);
    if (cmd === 0x65) {
      if (tc.giuRegister?.(ketNoi)) return;
      s.write(enip.encapsulation.header.build(0x65, session, Buffer.from([1, 0, 0, 0])));
      return;
    }
    if (cmd === 0x66) return;
    const cpf = enip.encapsulation.CPF.parse(data.subarray(6));
    const connected = cmd === 0x70;
    const raw: Buffer = cpf[1].data;
    const seq = connected ? raw.readUInt16LE(0) : 0;
    const mr = connected ? raw.subarray(2) : raw;
    const service = mr[0];
    const path = mr.subarray(2, 2 + mr[1] * 2);
    const gui = (resp: Buffer) => {
      if (s.destroyed) return;
      s.write(connected ? enip.encapsulation.sendUnitData(session, resp, connId, seq) : enip.encapsulation.sendRRData(session, resp));
    };
    switch (service) {
      case 0x54: {
        const d = Buffer.alloc(26);
        d.writeUInt32LE(connId, 0);
        gui(mrTraLoi(service, 0, d));
        return;
      }
      case 0x4e:
        if (tc.traLoiForwardClose !== false) gui(mrTraLoi(service, 0, Buffer.alloc(10)));
        return;
      case 0x01: {
        const ten = Buffer.from("1769-L33ER/A LOGIX5333ER");
        const d = Buffer.alloc(15 + ten.length);
        d.writeUInt8(33, 6);
        d.writeUInt8(11, 7);
        d.writeUInt16LE(0x0060, 8);
        d.writeUInt32LE(0xabcdef, 10);
        d.writeUInt8(ten.length, 14);
        ten.copy(d, 15);
        gui(mrTraLoi(service, 0, d));
        return;
      }
      case 0x55:
        gui(mrTraLoi(service, 0, danhSachTag()));
        return;
      case 0x4c:
      case 0x4d: {
        const req: YeuCau = { service, ten: tenTuPath(path), seq, ketNoi, duLieu: Buffer.from(mr.subarray(2 + mr[1] * 2)) };
        yeuCau.push(req);
        tc.onYeuCau(req, (status = 0, d?: Buffer) => gui(mrTraLoi(service, status, d)));
        return;
      }
      default:
        gui(mrTraLoi(service, 0x08));
    }
  }
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as net.AddressInfo).port;
  return {
    port,
    yeuCau,
    soKetNoi: () => soKetNoi,
    ghi: () => yeuCau.filter((x) => x.service === 0x4d),
    dong: async () => {
      for (const s of socks) s.destroy();
      await new Promise<void>((r) => srv.close(() => r()));
    },
  };
}

const dint = (v: number) => {
  const b = Buffer.alloc(6);
  b.writeUInt16LE(DINT, 0);
  b.writeInt32LE(v, 2);
  return b;
};

const don: Array<() => Promise<void> | void> = [];
const portGoc = cauHinhThuVien.EIP_PORT;
const cuSerialize = process.env.OT_CMD_SERIALIZE_ENABLED;
beforeEach(() => {
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
});
afterEach(async () => {
  while (don.length) await don.pop()!();
  cauHinhThuVien.EIP_PORT = portGoc;
  if (cuSerialize === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
  else process.env.OT_CMD_SERIALIZE_ENABLED = cuSerialize;
});

/** Commit 1 — driver chưa đặt kiểu CIP (P1): gán kiểu theo danh sách tag của thiết bị giả, TRONG TEST. */
function ganKieuTrongTest() {
  const { Controller } = require_("st-ethernet-ip");
  const goc = Controller.prototype.newTag;
  const bang = new Map(TAG_MAC_DINH);
  Controller.prototype.newTag = function (this: unknown, ...a: any[]) {
    const t = goc.apply(this, a);
    if (bang.has(a[0])) t.type = bang.get(a[0]);
    return t;
  };
  don.push(() => {
    Controller.prototype.newTag = goc;
  });
}

async function moDriver(tc: TuyChonThietBi, timeoutMs = 300) {
  const tb = await dungThietBi(tc);
  don.push(tb.dong);
  cauHinhThuVien.EIP_PORT = tb.port;
  ganKieuTrongTest();
  const { EthernetIpDriver } = await import("./ethernetIpDriver");
  const d = new EthernetIpDriver();
  don.push(async () => {
    // phiên MỚI đang mở ở nền (sau một hết hạn cuối ca) đọc cổng TOÀN CỤC của thư viện lúc nối ⇒ chờ nó xong trên thiết bị CỦA CA NÀY
    // (thế hệ chốt ⇒ nó bị hạ ngay) trước khi ca sau đổi cổng.
    const dangMo: Promise<unknown> | null = (d as any).noiLaiSauNhiem;
    await d.disconnect();
    await dangMo;
  });
  await d.connect({ endpoint: "127.0.0.1", timeoutMs } as any);
  return { tb, d };
}

/** STOP qua executeOtDeviceWrite (đường dispatcher) với hạn lệnh `timeoutMs`. */
function stopQuaExecute(d: any, timeoutMs = 5000): Promise<any> {
  return executeOtDeviceWrite({
    input: { adapterId: 994_000 + Math.floor(Math.random() * 1000), machineId: null, commandType: "stop", idempotencyKey: `t3a-${Math.random()}`, writes: [{ tagKey: "stop", value: true }] } as any,
    driver: d,
    resolved: [{ write: { tagKey: "stop", value: true }, address: "Stop", dataType: "bool" }] as any,
    driverWrites: [{ tagKey: "stop", address: "Stop", value: true, dataType: "bool" }] as any,
    timeoutMs,
    stopTyped: true,
    bumpStopEpoch: true,
    ledger: { intentIds: [1], confirmedBy: 1 },
  });
}

const ghiSpeed = { tagKey: "speed", address: "Speed", value: 5, dataType: "int" } as any;
const ghiStop = { tagKey: "stop", address: "Stop", value: true, dataType: "bool" } as any;

describe("R1b-2b-2a T3A — ack MUỘN của lời ghi đã hết hạn không bao giờ tính cho lời ghi kế (st-ethernet-ip thật)", () => {
  it("P2 (thăm dò, thư viện trực tiếp — vẫn đúng: lỗi của THƯ VIỆN): A hết hạn ⇒ listener của A còn gắn ⇒ ack muộn của A giải B = ok", async () => {
    const cho: Array<{ tl: TraLoi }> = [];
    const tb = await dungThietBi({
      onYeuCau: (_r, tl) => {
        cho.push({ tl });
        if (cho.length === 2) setTimeout(() => cho[0].tl(0), 20);
      },
    });
    don.push(tb.dong);
    cauHinhThuVien.EIP_PORT = tb.port;
    const { Controller } = require_("st-ethernet-ip");
    const plc = new Controller();
    plc.timeout_sp = 300;
    don.push(() => {
      try {
        plc.destroy();
      } catch {
        /* ignore */
      }
    });
    await plc.connect("127.0.0.1", 0);
    const tA = plc.newTag("Speed");
    tA.type = DINT;
    tA.value = 5;
    expect(await plc.writeTag(tA).then(() => "ok", (e: Error) => e.message)).toBe("TIMEOUT occurred while writing Writing Tag: Speed.");
    expect(plc.listenerCount("Write Tag")).toBe(1);
    const tB = plc.newTag("Stop");
    tB.type = BOOL;
    tB.value = true;
    const t0 = Date.now();
    expect(await plc.writeTag(tB).then(() => "ok", (e: Error) => e.message)).toBe("ok"); // ack GIẢ của thư viện
    expect(Date.now() - t0).toBeLessThan(300);
    expect(tb.ghi().map((x) => x.seq)).toEqual([tb.ghi()[0].seq, tb.ghi()[0].seq + 1]); // seq khác nhau, thư viện không so
  }, 10_000);

  it("★ (a) ack muộn của A tới TRƯỚC khi STOP B được trả lời ⇒ B KHÔNG ok (B đi trên phiên MỚI, không được trả lời ⇒ qua_han_driver)", async () => {
    const cho: Array<{ req: YeuCau; tl: TraLoi }> = [];
    let daGuiAckMuon = false;
    const { tb, d } = await moDriver({
      traLoiForwardClose: false, // socket cũ còn mở ⇒ ack muộn THẬT SỰ tới Controller cũ
      onYeuCau: (req, tl) => {
        cho.push({ req, tl });
        if (cho.length === 2)
          setTimeout(() => {
            cho[0].tl(0); // ack MUỘN của A, trên kết nối của A
            daGuiAckMuon = true;
          }, 20);
      },
    });
    const rA = await d.writeTags([ghiSpeed]);
    expect(rA).toEqual([{ tagKey: "speed", ok: false, error: "TIMEOUT occurred while writing Writing Tag: Speed.", ketCucKhongRo: "qua_han_driver" }]);
    const rB = await d.writeTags([ghiStop]);
    expect(daGuiAckMuon).toBe(true);
    expect(rB[0].ok).toBe(false); // ★ không bao giờ ok từ ack của lời ghi cũ
    expect(rB).toEqual([{ tagKey: "stop", ok: false, error: "TIMEOUT occurred while writing Writing Tag: Stop.", ketCucKhongRo: "qua_han_driver" }]);
    expect(tb.ghi().map((x) => [x.ten, x.ketNoi])).toEqual([
      ["Speed", 1],
      ["Stop", 2], // STOP VẪN được gửi — trên phiên MỚI
    ]);
  }, 10_000);

  it("★ (b) STOP sau phiên nhiễm, phiên mới KHÔNG lên trong trần ⇒ KHÔNG gửi gì, `failed` (không bao giờ ok), trong trần (batDauDoLag)", async () => {
    // hạn kết nối 2600 (phiên mới treo tới 2600) > trần 2000 ⇒ phân biệt được "có trần" với "chờ tới khi nối lại tự hỏng".
    const { tb, d } = await moDriver({ giuRegister: (n) => n >= 2, onYeuCau: () => undefined }, 2600);
    (d as any).plc.timeout_sp = 300; // lời ghi A hết hạn sau 300 ms (hạn của thư viện), hạn kết nối giữ 2600
    const rA = await d.writeTags([ghiSpeed]);
    expect(rA[0]).toMatchObject({ ok: false, ketCucKhongRo: "qua_han_driver" });
    expect(d.isConnected()).toBe(true); // đang mở phiên mới — dispatcher vẫn tới được driver

    const lag = batDauDoLag();
    const t0 = Date.now();
    const o = await stopQuaExecute(d); // hạn lệnh mặc định của dispatcher (OT_CONTROL_TIMEOUT_MS 5000)
    const troi = Date.now() - t0;
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "failed" }); // ★ thấy được, không ok, không "timeout"
    expect(o.outcomes[0].errorText).toBe(
      `ethernet-ip: not connected — no fresh session within ${HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS}ms after a contaminated session — nothing sent`,
    );
    expect(tb.ghi().map((x) => x.ten)).toEqual(["Speed"]); // ★ STOP KHÔNG ra dây
    expect(troi).toBeGreaterThanOrEqual(HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS - 50); // chờ phiên mới thật (đã có trần, không bỏ cuộc sớm)
    expect(troi).toBeLessThan(HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS + 300 + (await lag.dung(200))); // < 2600 của "không trần"
    expect(HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS).toBeLessThan(5000); // trần nằm trong hạn lệnh của dispatcher
  }, 15_000);

  it("(c) đối chứng: sau khi nối lại SẠCH, lời ghi C được ack đúng ⇒ ok (trên phiên mới)", async () => {
    let n = 0;
    const { tb, d } = await moDriver({
      onYeuCau: (_req, tl) => {
        n += 1;
        if (n >= 2) tl(0); // A im; mọi lời ghi sau được trả lời
      },
    });
    expect((await d.writeTags([ghiSpeed]))[0]).toMatchObject({ ok: false, ketCucKhongRo: "qua_han_driver" });
    const rC = await d.writeTags([{ tagKey: "c", address: "TagC", value: 7, dataType: "int" } as any]);
    expect(rC).toEqual([{ tagKey: "c", ok: true }]);
    expect(tb.ghi().map((x) => [x.ten, x.ketNoi])).toEqual([
      ["Speed", 1],
      ["TagC", 2],
    ]);
    expect(tb.soKetNoi()).toBe(2);
  }, 10_000);

  it("(d) không hết hạn ⇒ hành vi không đổi: hai lời ghi ok trên CÙNG một kết nối, không nối lại", async () => {
    const { tb, d } = await moDriver({ onYeuCau: (_r, tl) => tl(0) });
    expect(await d.writeTags([ghiSpeed])).toEqual([{ tagKey: "speed", ok: true }]);
    expect(await d.writeTags([ghiStop])).toEqual([{ tagKey: "stop", ok: true }]);
    expect(tb.ghi().map((x) => [x.ten, x.ketNoi])).toEqual([
      ["Speed", 1],
      ["Stop", 1],
    ]);
    expect(tb.soKetNoi()).toBe(1);
  }, 10_000);

  it("(e) hạ phiên nhiễm khi một lời ghi ĐANG BAY trên nó ⇒ lời ghi đó `mat_lien_ket` (không rõ, T2/T17) ngay, không chờ hạn của nó", async () => {
    const { tb, d } = await moDriver({ onYeuCau: () => undefined });
    const pDoc = d.readTags([{ tagKey: "a", address: "TagA", dataType: "int" } as any]); // hết hạn ở ~300 ms ⇒ nhiễm
    await new Promise((r) => setTimeout(r, 120));
    const t0 = Date.now();
    // driver NÉM LoiMatLienKetKhiDangGui (R1b-2b-1 T17) ⇒ ketCucKhongRoCua = "mat_lien_ket" ⇒ executeOtDeviceWrite: `timeout` không rõ
    const loi = await d.writeTags([ghiStop]).then(() => null, (e: unknown) => e);
    const troi = Date.now() - t0;
    await pDoc;
    expect(ketCucKhongRoCua(loi)).toBe("mat_lien_ket");
    expect((loi as Error).message).toMatch(/^ethernet-ip link lost while a request was in flight \(session contaminated: TIMEOUT occurred while writing Reading Tag: TagA\.\)/);
    expect(troi).toBeLessThan(280); // trả lời lúc phiên bị hạ (~180 ms), trước hạn 300 của chính nó
    expect(tb.ghi().map((x) => [x.ten, x.ketNoi])).toEqual([["Stop", 1]]);
  }, 10_000);

  it("(e') cùng tình huống qua executeOtDeviceWrite ⇒ STOP `timeout` \"link lost … outcome unknown\" (băng E-STOP cứng `khong_ro`), không ok", async () => {
    const { d } = await moDriver({ onYeuCau: () => undefined });
    const pDoc = d.readTags([{ tagKey: "a", address: "TagA", dataType: "int" } as any]);
    await new Promise((r) => setTimeout(r, 120));
    const o = await stopQuaExecute(d);
    await pDoc;
    expect(o.outcomes[0]).toMatchObject({ ok: false, status: "timeout", readBackValue: null });
    expect(o.outcomes[0].errorText).toMatch(/^link lost while the write was in flight \(after \d+ms\) — outcome unknown/);
  }, 10_000);
});

describe("R1b-2b-2a T3A (D3) — ĐỌC sau phiên nhiễm không bao giờ trả giá trị của tag khác", () => {
  it("★ (r1) TagA hết hạn, trả lời muộn của A (111) tới khi đọc TagB ⇒ TagB KHÔNG good, không 111 (trước vá: good 111)", async () => {
    const cho: Array<{ tl: TraLoi }> = [];
    const { tb, d } = await moDriver({
      traLoiForwardClose: false,
      onYeuCau: (_r, tl) => {
        cho.push({ tl });
        if (cho.length === 2) setTimeout(() => cho[0].tl(0, dint(111)), 20); // trả lời MUỘN của A, B không được trả lời
      },
    });
    const rA = await d.readTags([{ tagKey: "a", address: "TagA", dataType: "int" } as any]);
    const rB = await d.readTags([{ tagKey: "b", address: "TagB", dataType: "int" } as any]);
    expect(rA.map((x) => [x.quality, x.value])).toEqual([["bad", null]]);
    expect(rB.map((x) => [x.tagKey, x.quality, x.value])).toEqual([["b", "bad", null]]); // ★ không bao giờ "good" 111
    expect(tb.yeuCau.map((x) => [x.ten, x.ketNoi])).toEqual([
      ["TagA", 1],
      ["TagB", 2],
    ]);
  }, 10_000);

  it("(r2) phiên MỚI đọc được thật (TagB = 222) ⇒ good 222 — không bao giờ 111 của TagA", async () => {
    const cho: Array<{ tl: TraLoi }> = [];
    const { d } = await moDriver({
      traLoiForwardClose: false,
      onYeuCau: (_r, tl) => {
        cho.push({ tl });
        if (cho.length === 2) {
          setTimeout(() => cho[0].tl(0, dint(111)), 10);
          setTimeout(() => tl(0, dint(222)), 40);
        }
      },
    });
    await d.readTags([{ tagKey: "a", address: "TagA", dataType: "int" } as any]);
    const rB = await d.readTags([{ tagKey: "b", address: "TagB", dataType: "int" } as any]);
    expect(rB.map((x) => [x.tagKey, x.quality, x.value])).toEqual([["b", "good", 222]]);
  }, 10_000);

  it("(r3) đọc TagB XẾP HÀNG trong thư viện sau TagA trên CÙNG phiên (hai người đọc đồng thời) ⇒ TagB bad, không bao giờ good 111", async () => {
    const cho: Array<{ tl: TraLoi }> = [];
    const { d } = await moDriver({
      traLoiForwardClose: false,
      onYeuCau: (_r, tl) => {
        cho.push({ tl });
        if (cho.length === 2) setTimeout(() => cho[0].tl(0, dint(111)), 20);
      },
    });
    const [rA, rB] = await Promise.all([
      d.readTags([{ tagKey: "a", address: "TagA", dataType: "int" } as any]),
      d.readTags([{ tagKey: "b", address: "TagB", dataType: "int" } as any]),
    ]);
    expect(rA[0].quality).toBe("bad");
    expect(rB.map((x) => [x.tagKey, x.quality, x.value])).toEqual([["b", "bad", null]]);
  }, 10_000);

  it("(r4) phiên mới KHÔNG lên trong trần ⇒ đọc bad (unreachable) trong trần, không gửi Read Tag", async () => {
    const { tb, d } = await moDriver({ giuRegister: (n) => n >= 2, onYeuCau: () => undefined }, 2600);
    (d as any).plc.timeout_sp = 300;
    await d.readTags([{ tagKey: "a", address: "TagA", dataType: "int" } as any]);
    const lag = batDauDoLag();
    const t0 = Date.now();
    const rB = await d.readTags([{ tagKey: "b", address: "TagB", dataType: "int" } as any]);
    const troi = Date.now() - t0;
    expect(rB.map((x) => [x.quality, x.value])).toEqual([["bad", null]]);
    expect(tb.yeuCau.map((x) => x.ten)).toEqual(["TagA"]);
    expect(troi).toBeLessThan(HAN_CHO_PHIEN_MOI_SAU_NHIEM_MS + 300 + (await lag.dung(200)));
  }, 15_000);
});

describe("P1 (thăm dò) — driver hôm nay không đặt kiểu CIP ⇒ lời ghi không ra dây", () => {
  it("không gán kiểu trong test ⇒ write failed 'has not been initialized', 0 gói Write Tag", async () => {
    const tb = await dungThietBi({ onYeuCau: (_r, tl) => tl(0) });
    don.push(tb.dong);
    cauHinhThuVien.EIP_PORT = tb.port;
    const { EthernetIpDriver } = await import("./ethernetIpDriver");
    const d = new EthernetIpDriver();
    don.push(() => d.disconnect());
    await d.connect({ endpoint: "127.0.0.1", timeoutMs: 300 } as any);
    const r = await d.writeTags([ghiStop]);
    expect(r).toEqual([{ tagKey: "stop", ok: false, error: expect.stringMatching(/^Tag Stop has not been initialized/) }]);
    expect(tb.ghi()).toHaveLength(0);
  }, 10_000);
});
