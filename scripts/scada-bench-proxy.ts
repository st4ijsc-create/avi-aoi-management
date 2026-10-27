/**
 * SCADA R1b-2b-1 Task 17 (chẩn đoán bench) — proxy Modbus TCP trong tiến trình cho `scripts/scada-r1b-bench.ts --cat-lien-ket` (CHỈ công cụ bench,
 * không bao giờ nạp từ mã sản phẩm).
 *
 * Vì sao chuyển tiếp THEO KHUNG MBAP: máy chủ Modbus của OpenPLC v3 (`webserver/core/server.cpp`, `handleConnections`) coi MỖI lần `read()` là MỘT
 * thông điệp — hai khung GỘP trong một lần đọc ⇒ khung sau bị bỏ (không trả lời), một khung bị TÁCH ⇒ xử lý khung cụt. Bản đầu của proxy chuyển
 * nguyên đoạn (chunk) nhận được và dò FC5 giả định đoạn bắt đầu đúng biên khung. Nay:
 *   • mỗi chiều có bộ đệm riêng, tách khung MBAP qua biên đoạn (độ dài ở byte 4–5), mỗi khung ghi bằng MỘT `write()` riêng, `setNoDelay(true)` hai
 *     phía (giữ biên ghi như client modbus-serial ghi thẳng, không thêm Nagle);
 *   • cắt ở KHUNG FC5 đầu tiên sau khi lên cò (khung trước nó trong cùng đoạn vẫn được chuyển); "truoc_khi_gui": không chuyển khung đó;
 *     "sau_khi_gui": chuyển khung đó rồi `end()` phía PLC (đợi ghi xong) và huỷ phía client — câu trả lời không bao giờ về;
 *   • thống kê đoạn / khung / đoạn gộp / đoạn tách, yêu cầu không được trả lời (theo transaction id), và (tuỳ chọn) dump từng đoạn + khung.
 */
import net from "node:net";

export type KieuCat = "truoc_khi_gui" | "sau_khi_gui";

/** Độ dài MBAP hợp lệ (unit id + PDU ≤ 253 + 1). Ngoài khoảng ⇒ không phải Modbus TCP: chuyển nguyên phần còn lại. */
const LEN_TOI_DA = 254;

/** Tách các khung MBAP hoàn chỉnh ở đầu `buf`; phần dở dang trả về `conLai`. `hong` = header không hợp lệ (phần còn lại không phân tích được). */
export function tachKhungMbap(buf: Buffer): { khung: Buffer[]; conLai: Buffer; hong: boolean } {
  const khung: Buffer[] = [];
  let i = 0;
  while (buf.length - i >= 6) {
    const len = buf.readUInt16BE(i + 4);
    if (len < 2 || len > LEN_TOI_DA) return { khung, conLai: buf.subarray(i), hong: true };
    if (buf.length - i < 6 + len) break;
    khung.push(buf.subarray(i, i + 6 + len));
    i += 6 + len;
  }
  return { khung, conLai: buf.subarray(i), hong: false };
}

const moTaKhung = (k: Buffer) => `tid=${k.readUInt16BE(0)} u=${k[6]} fc=${k[7]} len=${k.readUInt16BE(4)}`;
const hex = (b: Buffer, toiDa = 48) => b.subarray(0, toiDa).toString("hex") + (b.length > toiDa ? "…" : "");

export interface ThongKeChieu {
  doan: number;
  khung: number;
  /** đoạn chứa ≥ 2 khung (gộp) */
  doanGop: number;
  /** đoạn kết thúc giữa một khung (tách — phần sau tới ở đoạn kế) */
  doanTach: number;
  /** byte không phân tích được (header hỏng) — chuyển nguyên */
  byteHong: number;
}
export interface ThongKeProxy {
  ketNoi: number;
  di: ThongKeChieu;
  ve: ThongKeChieu;
  /** yêu cầu đã chuyển tới PLC mà chưa có câu trả lời sau > 1 s (tính lúc đọc) */
  treoQua1s: number;
  /** yêu cầu còn chờ khi kết nối của nó đóng (không phải lần bị cắt có chủ đích) */
  matKhiDong: number;
  cat: number;
}

export interface ProxyModbus {
  port: number;
  lenCo(kieu: KieuCat): void;
  daCatLuc(): number | null;
  thongKe(): ThongKeProxy;
  datLaiThongKe(): void;
  close(): Promise<void>;
}

const chieuMoi = (): ThongKeChieu => ({ doan: 0, khung: 0, doanGop: 0, doanTach: 0, byteHong: 0 });

export async function taoProxyModbus(dich: string, tuyChon: { dump?: (dong: string) => void } = {}): Promise<ProxyModbus> {
  const s = String(dich).replace(/^tcp:\/\//i, "");
  const idx = s.lastIndexOf(":");
  const host = idx > 0 ? s.slice(0, idx) : s;
  const port = idx > 0 ? Number(s.slice(idx + 1)) : 502;
  const dump = tuyChon.dump;
  let co: KieuCat | null = null;
  let catLuc: number | null = null;
  let tk: ThongKeProxy = { ketNoi: 0, di: chieuMoi(), ve: chieuMoi(), treoQua1s: 0, matKhiDong: 0, cat: 0 };
  const cacCho = new Set<Map<number, number>>(); // yêu cầu đang chờ (tid ⇒ lúc gửi) theo kết nối
  const cacCap = new Set<{ a: net.Socket; b: net.Socket }>();
  let soCap = 0;

  const demDoan = (chieu: ThongKeChieu, ketQua: ReturnType<typeof tachKhungMbap>) => {
    chieu.doan += 1;
    chieu.khung += ketQua.khung.length;
    if (ketQua.khung.length >= 2) chieu.doanGop += 1;
    if (!ketQua.hong && ketQua.conLai.length > 0) chieu.doanTach += 1;
    if (ketQua.hong) chieu.byteHong += ketQua.conLai.length;
  };

  const server = net.createServer((a) => {
    const id = ++soCap;
    tk.ketNoi += 1;
    const b = net.connect({ host, port });
    a.setNoDelay(true);
    b.setNoDelay(true);
    const cap = { a, b };
    cacCap.add(cap);
    const cho = new Map<number, number>();
    cacCho.add(cho);
    let bufDi: Buffer = Buffer.alloc(0);
    let bufVe: Buffer = Buffer.alloc(0);
    let daCat = false;
    let xongRoi = false;
    const xong = (lyDo: string) => {
      if (xongRoi) return;
      xongRoi = true;
      cacCap.delete(cap);
      if (!daCat) tk.matKhiDong += cho.size;
      if (dump && cho.size > 0) dump(`[proxy] c#${id} đóng (${lyDo}) — ${cho.size} yêu cầu chưa được trả lời: tid ${[...cho.keys()].join(",")}`);
      cacCho.delete(cho);
      a.destroy();
      if (!daCat) b.destroy();
    };
    a.on("error", () => xong("lỗi phía client"));
    b.on("error", () => xong("lỗi phía PLC"));
    a.on("close", () => xong("client đóng"));
    b.on("close", () => {
      if (!daCat) xong("PLC đóng");
    });

    a.on("data", (d: Buffer) => {
      if (daCat) return;
      bufDi = bufDi.length === 0 ? d : Buffer.concat([bufDi, d]);
      const kq = tachKhungMbap(bufDi);
      demDoan(tk.di, kq);
      if (dump) dump(`[proxy] c#${id} ↑ đoạn ${d.length}B ${hex(d)} ⇒ ${kq.khung.length} khung [${kq.khung.map(moTaKhung).join("; ")}]${kq.khung.length >= 2 ? " GỘP" : ""}${kq.conLai.length > 0 ? ` còn ${kq.conLai.length}B${kq.hong ? " HỎNG" : " (TÁCH)"}` : ""}`);
      for (const k of kq.khung) {
        if (co && k[7] === 5) {
          const kieu = co;
          co = null;
          catLuc = Date.now();
          daCat = true;
          tk.cat += 1;
          if (dump) dump(`[proxy] c#${id} CẮT (${kieu}) ở ${moTaKhung(k)}`);
          if (kieu === "sau_khi_gui") {
            b.end(k); // khung tới PLC; phía PLC đóng êm sau khi ghi xong — câu trả lời không bao giờ về client
            setTimeout(() => b.destroy(), 2000).unref();
          } else b.destroy();
          cacCho.delete(cho);
          a.destroy();
          return;
        }
        cho.set(k.readUInt16BE(0), Date.now());
        b.write(k);
      }
      if (kq.hong) {
        b.write(kq.conLai); // không phải Modbus TCP hợp lệ: chuyển nguyên
        bufDi = Buffer.alloc(0);
      } else bufDi = kq.conLai.length > 0 ? Buffer.from(kq.conLai) : Buffer.alloc(0);
    });

    b.on("data", (d: Buffer) => {
      if (daCat || a.destroyed) return;
      bufVe = bufVe.length === 0 ? d : Buffer.concat([bufVe, d]);
      const kq = tachKhungMbap(bufVe);
      demDoan(tk.ve, kq);
      if (dump) dump(`[proxy] c#${id} ↓ đoạn ${d.length}B ${hex(d)} ⇒ ${kq.khung.length} khung [${kq.khung.map(moTaKhung).join("; ")}]${kq.khung.length >= 2 ? " GỘP" : ""}${kq.conLai.length > 0 ? ` còn ${kq.conLai.length}B${kq.hong ? " HỎNG" : " (TÁCH)"}` : ""}`);
      for (const k of kq.khung) {
        cho.delete(k.readUInt16BE(0));
        a.write(k);
      }
      if (kq.hong) {
        a.write(kq.conLai);
        bufVe = Buffer.alloc(0);
      } else bufVe = kq.conLai.length > 0 ? Buffer.from(kq.conLai) : Buffer.alloc(0);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return {
    port: (server.address() as net.AddressInfo).port,
    lenCo: (kieu) => {
      co = kieu;
      catLuc = null;
    },
    daCatLuc: () => catLuc,
    thongKe: () => {
      const now = Date.now();
      let treo = 0;
      for (const cho of cacCho) for (const t of cho.values()) if (now - t > 1000) treo += 1;
      return { ...tk, di: { ...tk.di }, ve: { ...tk.ve }, treoQua1s: treo };
    },
    datLaiThongKe: () => {
      tk = { ketNoi: 0, di: chieuMoi(), ve: chieuMoi(), treoQua1s: 0, matKhiDong: 0, cat: 0 };
    },
    close: () =>
      new Promise<void>((r) => {
        for (const c of cacCap) {
          c.a.destroy();
          c.b.destroy();
        }
        server.close(() => r());
      }),
  };
}
