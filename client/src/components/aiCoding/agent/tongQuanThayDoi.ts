/**
 * Đợt 11.3-B (UX-D04) — TỔNG QUAN DUYỆT THAY ĐỔI: bộ chọn THUẦN từ `TrangThaiAgent` (không React, không mạng).
 *   • `tongQuanThayDoi(s)` — mỗi thẻ duyệt GHI của lượt chạy (sửa/tạo/xoá/đổi tên) thành một dòng: tệp, loại, trạng thái.
 *     Thẻ LỆNH (`run_command`) KHÔNG vào danh sách này (có hộp riêng — 11.3-A).
 *   • `ketQuaKiemChung(s)` — kết quả build/test GẦN NHẤT mà lượt đã chạy (đọc từ `ket-qua-tool.hienThi` CÓ CẤU TRÚC của `run_command`; thiếu cấu trúc ⇒ null — KHÔNG bịa),
 *     kèm cờ `truocThayDoiCuoi` (kết quả cũ hơn thay đổi đã duyệt gần nhất ⇒ giao diện nói rõ "chạy trước khi sửa").
 *   • `tienDoQuyet(ds)` — đã quyết bao nhiêu / còn chờ bao nhiêu.
 * Mọi chuỗi trả ra là dữ liệu của máy chủ/model ⇒ giao diện vẽ CHỮ THUẦN. Trạng thái "đã xem" là của CLIENT (không bao giờ gửi, không bao giờ coi là quyết định).
 */
import type { MucDongThoiGian, TrangThaiAgent, TrangThaiTheDuyet } from "./trangThaiAgent";
import { layDiffTuDeXuat } from "./trangThaiAgent";

export type LoaiThayDoi = "sua" | "tao" | "xoa" | "doi-ten";

export interface MucTongQuan {
  /** id sự kiện `can-duyet` — khoá React + neo cuộn. */
  id: string;
  loai: LoaiThayDoi;
  /** Đường tệp hiển thị (đổi tên: "từ → đến"). Có thể rỗng nếu thẻ không mang đường. */
  tep: string;
  trangThai: TrangThaiTheDuyet;
  /** (11.3-B+11.8) thẻ này thuộc AGENT CON: tên agent con + id lượt chạy của con. Thẻ của cha ⇒ undefined. */
  con?: { runIdCon: string; agent: string };
}

/** Khoá DUY NHẤT của thẻ trong danh sách tổng quan: thẻ của cha = id sự kiện; thẻ của con = «runIdCon/id» (id của con có thể trùng id của cha). */
export const khoaTheCon = (runIdCon: string, id: string): string => `${runIdCon}/${id}`;

const chuoi = (v: unknown): string => (typeof v === "string" ? v : "");

function loaiVaTep(m: Extract<MucDongThoiGian, { kieu: "duyet" }>): { loai: LoaiThayDoi; tep: string } | null {
  const ten = m.deXuat?.ten;
  const ts = m.deXuat?.thamSo ?? {};
  if (ten === "delete_file") return { loai: "xoa", tep: chuoi(ts.path) };
  if (ten === "rename_file") {
    const tu = chuoi(ts.from);
    const den = chuoi(ts.to);
    return { loai: "doi-ten", tep: tu && den ? `${tu} → ${den}` : tu || den };
  }
  if (ten === "write_file") return { loai: "tao", tep: chuoi(ts.path) };
  if (ten === "edit_file" || ten === "apply_diff") {
    const d = layDiffTuDeXuat(m.deXuat);
    return { loai: "sua", tep: d?.args.path ?? chuoi(ts.path) };
  }
  return null; // run_command và mọi tool khác: không thuộc "thay đổi tệp"
}

export function tongQuanThayDoi(s: TrangThaiAgent): MucTongQuan[] {
  const kq: MucTongQuan[] = [];
  for (const m of s.dongThoiGian) {
    if (m.kieu !== "duyet") continue;
    const lt = loaiVaTep(m);
    if (lt) kq.push({ id: m.id, loai: lt.loai, tep: lt.tep, trangThai: m.trangThai });
  }
  // (11.8) thẻ GHI của agent con — cùng cửa duyệt của người (agent.duyet với actionId của thẻ); chỉ con trực tiếp (KhoiAgentCon không vẽ con của con)
  for (const c of s.dongThoiGian) {
    if (c.kieu !== "con") continue;
    for (const m of c.tt.dongThoiGian) {
      if (m.kieu !== "duyet") continue;
      const lt = loaiVaTep(m);
      if (lt) kq.push({ id: khoaTheCon(c.runIdCon, m.id), loai: lt.loai, tep: lt.tep, trangThai: m.trangThai, con: { runIdCon: c.runIdCon, agent: c.agent } });
    }
  }
  return kq;
}

export interface KetQuaKiemChung {
  lenh: string;
  xanh: boolean;
  soDo: number | null;
  soXanh: number | null;
  hetGio: boolean;
  /** true ⇒ kết quả này CŨ HƠN thay đổi đã duyệt gần nhất (chạy trước khi sửa). */
  truocThayDoiCuoi: boolean;
}

export function ketQuaKiemChung(s: TrangThaiAgent): KetQuaKiemChung | null {
  let viTriChay = -1;
  let kq: Omit<KetQuaKiemChung, "truocThayDoiCuoi"> | null = null;
  let viTriDuyetCuoi = -1;
  for (let i = 0; i < s.dongThoiGian.length; i++) {
    const m = s.dongThoiGian[i]!;
    if (m.kieu === "duyet" && m.trangThai === "da-duyet" && loaiVaTep(m)) viTriDuyetCuoi = i;
    if (m.kieu === "tool" && m.ten === "run_command") {
      const h = m.ketQua?.hienThi as Record<string, unknown> | undefined;
      // chỉ nhận khi máy chủ gửi CẤU TRÚC (xanh là boolean) — thiếu ⇒ bỏ qua, không đoán từ chữ
      if (h && typeof h === "object" && typeof h.xanh === "boolean") {
        const so = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
        viTriChay = i;
        kq = { lenh: chuoi(h.lenh).slice(0, 200), xanh: h.xanh, soDo: so(h.soDo), soXanh: so(h.soXanh), hetGio: h.hetGio === true };
      }
    }
  }
  if (!kq) return null;
  return { ...kq, truocThayDoiCuoi: viTriDuyetCuoi > viTriChay };
}

export function tienDoQuyet(ds: readonly MucTongQuan[]): { tong: number; daQuyet: number; conCho: number } {
  const conCho = ds.filter((x) => x.trangThai === "cho").length;
  return { tong: ds.length, daQuyet: ds.filter((x) => x.trangThai === "da-duyet" || x.trangThai === "bi-bac").length, conCho };
}

/** Chỉ số kế/trước trong vòng (J/K); danh sách rỗng ⇒ -1; chưa chọn (-1) + J ⇒ 0, + K ⇒ cuối. */
export function chiSoKe(hienTai: number, tong: number, huong: 1 | -1): number {
  if (tong <= 0) return -1;
  if (hienTai < 0 || hienTai >= tong) return huong === 1 ? 0 : tong - 1;
  return (hienTai + huong + tong) % tong;
}

/** Thẻ duyệt theo id sự kiện — để phím tắt gọi ĐÚNG thẻ qua `agent.duyet`. */
export function timTheDuyet(s: TrangThaiAgent, id: string): Extract<MucDongThoiGian, { kieu: "duyet" }> | null {
  for (const m of s.dongThoiGian) {
    if (m.kieu === "duyet" && m.id === id) return m;
    if (m.kieu === "con") for (const x of m.tt.dongThoiGian) if (x.kieu === "duyet" && khoaTheCon(m.runIdCon, x.id) === id) return x;
  }
  return null;
}
