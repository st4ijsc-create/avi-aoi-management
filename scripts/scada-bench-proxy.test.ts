/**
 * R1b-2b-1 Task 17 (chẩn đoán bench `--cat-lien-ket` trên OpenPLC thật bị huỷ giữa chừng) — proxy bench chuyển tiếp TRUNG THỰC theo khung MBAP.
 *
 * Máy chủ giả trong tiến trình (127.0.0.1, cổng OS cấp), hai kiểu:
 *   • "openplc": như OpenPLC v3 `server.cpp` — MỖI lần đọc socket là MỘT thông điệp (khung cụt ⇒ không trả lời; khung thứ hai trong cùng lần đọc ⇒ bỏ);
 *   • "dong": đọc dòng byte đúng chuẩn (gộp đoạn, tách khung qua biên đoạn).
 * Client là socket thô (ghi đúng các đoạn test muốn — tách / gộp có chủ đích, không phụ thuộc may rủi của TCP).
 * Bản proxy đầu (chuyển nguyên đoạn, dò FC5 giả định đoạn bắt đầu đúng biên khung) ĐỎ ở các ca tách / gộp — xem task-17-report.md "Bench diagnosis".
 */
import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { taoProxyModbus, tachKhungMbap, type ProxyModbus } from "./scada-bench-proxy";

const ngu = (ms: number) => new Promise((r) => setTimeout(r, ms));

function khung(tid: number, fc: number, a: number, n: number): Buffer {
  const b = Buffer.alloc(12);
  b.writeUInt16BE(tid, 0);
  b.writeUInt16BE(0, 2);
  b.writeUInt16BE(6, 4);
  b[6] = 1;
  b[7] = fc;
  b.writeUInt16BE(a, 8);
  b.writeUInt16BE(n, 10);
  return b;
}

type MayChu = { port: number; coil: boolean[]; lanDoc: number; nhanTid: number[]; dong(): Promise<void> };
async function mayChu(kieu: "openplc" | "dong"): Promise<MayChu> {
  const socks = new Set<net.Socket>();
  const mc: MayChu = { port: 0, coil: new Array(16).fill(false), lanDoc: 0, nhanTid: [], dong: async () => undefined };
  const traLoi = (s: net.Socket, k: Buffer) => {
    const tid = k.readUInt16BE(0);
    mc.nhanTid.push(tid);
    const fc = k[7];
    const a = k.readUInt16BE(8);
    const n = k.readUInt16BE(10);
    let pdu: Buffer;
    if (fc === 5) {
      mc.coil[a] = n === 0xff00;
      pdu = k.subarray(7, 12);
    } else if (fc === 1) pdu = Buffer.from([1, 1, mc.coil[a] ? 1 : 0]);
    else pdu = Buffer.from([3, 2, 0, 7]);
    const h = Buffer.alloc(7);
    h.writeUInt16BE(tid, 0);
    h.writeUInt16BE(pdu.length + 1, 4);
    h[6] = 1;
    s.write(Buffer.concat([h, pdu]));
  };
  const srv = net.createServer((s) => {
    socks.add(s);
    s.setNoDelay(true);
    s.on("error", () => undefined);
    s.on("close", () => socks.delete(s));
    let buf = Buffer.alloc(0);
    s.on("data", (d: Buffer) => {
      mc.lanDoc += 1;
      if (kieu === "openplc") {
        if (d.length < 8 || d.length < 6 + d.readUInt16BE(4)) return; // khung cụt ⇒ không trả lời
        traLoi(s, d.subarray(0, 6 + d.readUInt16BE(4))); // chỉ khung ĐẦU của lần đọc
        return;
      }
      buf = Buffer.concat([buf, d]);
      const kq = tachKhungMbap(buf);
      for (const k of kq.khung) traLoi(s, k);
      buf = Buffer.from(kq.conLai);
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  mc.port = (srv.address() as net.AddressInfo).port;
  mc.dong = () =>
    new Promise<void>((r) => {
      for (const s of socks) s.destroy();
      srv.close(() => r());
    });
  return mc;
}

/** Client thô: gửi các đoạn (cách nhau `cachMs`), gom câu trả lời theo tid trong `choMs`. */
async function guiDoan(port: number, doan: Buffer[], cachMs: number, choMs: number): Promise<{ tid: Set<number>; dong: boolean }> {
  const s = net.connect({ host: "127.0.0.1", port });
  s.setNoDelay(true);
  await new Promise<void>((r) => s.once("connect", () => r()));
  const tid = new Set<number>();
  let dong = false;
  let buf = Buffer.alloc(0);
  s.on("data", (d: Buffer) => {
    buf = Buffer.concat([buf, d]);
    const kq = tachKhungMbap(buf);
    for (const k of kq.khung) tid.add(k.readUInt16BE(0));
    buf = Buffer.from(kq.conLai);
  });
  s.on("close", () => (dong = true));
  s.on("error", () => undefined);
  for (const [i, d] of doan.entries()) {
    if (i > 0) await ngu(cachMs);
    s.write(d);
  }
  await ngu(choMs);
  s.destroy();
  return { tid, dong };
}

let don: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const f of don.reverse()) await f();
  don = [];
});
async function dung(kieu: "openplc" | "dong"): Promise<{ mc: MayChu; px: ProxyModbus }> {
  const mc = await mayChu(kieu);
  const px = await taoProxyModbus(`tcp://127.0.0.1:${mc.port}`);
  don.push(() => mc.dong(), () => px.close());
  return { mc, px };
}

describe("tachKhungMbap", () => {
  it("tách khung qua biên đoạn, giữ phần dở; header hỏng ⇒ hong", () => {
    const a = khung(1, 3, 0, 1);
    const b = khung(2, 5, 0, 0xff00);
    const r = tachKhungMbap(Buffer.concat([a, b.subarray(0, 5)]));
    expect(r.khung.map((k) => k.readUInt16BE(0))).toEqual([1]);
    expect(r.conLai.length).toBe(5);
    expect(r.hong).toBe(false);
    expect(tachKhungMbap(Buffer.from([0, 1, 0, 0, 0xff, 0xff, 1, 3])).hong).toBe(true);
  });
});

describe("proxy bench — chuyển tiếp theo khung MBAP (máy chủ kiểu OpenPLC: một lần đọc = một thông điệp)", () => {
  it("yêu cầu bị TÁCH ở phía client (5 B rồi 7 B) ⇒ PLC nhận MỘT khung đủ và trả lời", async () => {
    const { mc, px } = await dung("openplc");
    const k = khung(11, 3, 0, 1);
    const r = await guiDoan(px.port, [k.subarray(0, 5), k.subarray(5)], 40, 300);
    expect([...r.tid]).toEqual([11]);
    expect(mc.lanDoc).toBe(1);
    expect(px.thongKe().di.doanTach).toBe(1);
  });

  it("thông suốt: 30 yêu cầu tuần tự ⇒ 30 câu trả lời, không gộp / tách, không yêu cầu treo", async () => {
    const { px } = await dung("openplc");
    const doan = Array.from({ length: 30 }, (_, i) => khung(100 + i, 3, 0, 1));
    const r = await guiDoan(px.port, doan, 15, 300);
    expect(r.tid.size).toBe(30);
    const tk = px.thongKe();
    expect(tk.di.khung).toBe(30);
    expect(tk.ve.khung).toBe(30);
    expect(tk.di.doanGop + tk.di.doanTach).toBe(0);
    expect(tk.treoQua1s + tk.matKhiDong).toBe(0);
  });
});

describe("proxy bench — cắt ở KHUNG FC5 (máy chủ đọc dòng byte đúng chuẩn)", () => {
  it("đoạn GỘP [FC1, FC5] khi đã lên cò ⇒ FC1 vẫn TỚI PLC; cắt ĐÚNG ở FC5 (PLC không nhận FC5, coil không đổi, client bị đóng)", async () => {
    const { mc, px } = await dung("dong");
    px.lenCo("truoc_khi_gui");
    const r = await guiDoan(px.port, [Buffer.concat([khung(21, 1, 0, 1), khung(22, 5, 0, 0xff00)])], 0, 300);
    expect(px.daCatLuc()).not.toBeNull();
    expect(mc.nhanTid).toEqual([21]); // bản cũ: cắt CẢ đoạn ⇒ FC1 cũng không tới (nhanTid rỗng)
    expect(r.dong).toBe(true);
    expect(mc.coil[0]).toBe(false);
  });

  it("FC5 bị TÁCH (5 B rồi 7 B) khi đã lên cò ⇒ vẫn cắt ở FC5 (trước khi gửi: PLC không nhận, coil không đổi)", async () => {
    const { mc, px } = await dung("dong");
    px.lenCo("truoc_khi_gui");
    const k = khung(31, 5, 0, 0xff00);
    const r = await guiDoan(px.port, [k.subarray(0, 5), k.subarray(5)], 40, 300);
    expect(px.daCatLuc()).not.toBeNull();
    expect(r.tid.size).toBe(0);
    expect(mc.coil[0]).toBe(false);
  });

  it("'sau_khi_gui' ⇒ FC5 TỚI PLC (coil = 1) nhưng câu trả lời không về client, client bị đóng", async () => {
    const { mc, px } = await dung("dong");
    px.lenCo("sau_khi_gui");
    const r = await guiDoan(px.port, [khung(41, 5, 0, 0xff00)], 0, 300);
    expect(px.daCatLuc()).not.toBeNull();
    expect(r.tid.size).toBe(0);
    expect(r.dong).toBe(true);
    expect(mc.coil[0]).toBe(true);
  });

  it("chưa lên cò ⇒ FC5 đi qua bình thường (không cắt)", async () => {
    const { mc, px } = await dung("dong");
    const r = await guiDoan(px.port, [khung(51, 5, 0, 0xff00)], 0, 200);
    expect(px.daCatLuc()).toBeNull();
    expect([...r.tid]).toEqual([51]);
    expect(mc.coil[0]).toBe(true);
  });
});
