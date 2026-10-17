/**
 * ★★★ Đợt 3c (2026-10-17) — TẦNG CHÍNH SÁCH của "Chạy & Xem trước" (tRPC `aiChayUngDung` chỉ chuyển tiếp vào đây).
 *
 *   • CHẠY  — `ai_repo_exec/canCreate` (cùng bit "AI chạy lệnh": chạy ứng dụng = thi hành mã dự án trong một tiến
 *             trình sống lâu), hỏi lại MỖI lượt, fail-closed (`checkPermission` ném ⇒ từ chối). Lệnh chạy CHỈ từ
 *             khai báo dự án (`suyLenhChay`) — không có tham số "lệnh" nào trên mặt tiếp xúc.
 *   • DỪNG / NHẬT KÝ — CHỦ (người đã chạy) hoặc admin. Người khác ⇒ `NOT_FOUND` (không tiết lộ dự án đang chạy).
 *   • TRẠNG THÁI — `ai_repo_read/canView`; người không phải chủ chỉ biết "đang bận" (một dự án = một tiến trình).
 *   • ⚠ REPO CHÍNH KHÔNG CHẠY ĐƯỢC: gốc trùng `gocHopCat()` = repo của CHÍNH máy chủ này — `npm run dev` của nó là
 *     một bản máy chủ MES thứ hai (cùng lý do `npm run build` cố ý vắng khỏi danh sách trắng lệnh).
 */
import path from "node:path";
import { suyLenhCaiDat, suyLenhChay, type MaSuyLenhChay } from "./cauHinhChayDuAn";
import { dungLenhUngDung } from "./cuaSinhUngDung";
import type { MucCongKhai, QuanLyUngDung } from "./quanLyUngDung";

export interface NguoiGoi {
  id: number;
  role: string;
}

export interface PhuThuocDichVu {
  coQuyen: (userId: number, role: string, module: string, action: string) => Promise<boolean>;
  /**
   * `repoProjects.phanGiaiGoc` — dự án CÁ NHÂN chỉ phân giải được cho CHỦ (hoặc admin): người khác ⇒ PROJECT_NOT_FOUND,
   * nên "chạy ứng dụng của dự án người khác" bị chặn ngay ở cửa phân giải gốc, trước cả phép kiểm quyền chạy.
   */
  phanGiaiGoc: (projectId: unknown, nguoiGoi: NguoiGoi | null) => { ok: true; id: string | null; goc: string | null } | { ok: false; ma: "PROJECT_NOT_FOUND" };
  gocRepoChinh: () => string;
  ql: () => QuanLyUngDung;
  cauHinhXemTruoc: () => { bat: boolean; lyDoTat: string | null };
}

type MaLoi =
  | "PERMISSION_DENIED"
  | "PROJECT_NOT_FOUND"
  | "REPO_CHINH_KHONG_CHAY"
  | "NOT_FOUND"
  | "KHONG_CHAY"
  | "DANG_CHAY"
  | "HET_CONG"
  | "LOI_SINH"
  | "THIEU_MOI_TRUONG"
  | MaSuyLenhChay;

type Loi = { ok: false; ma: MaLoi; chiTiet?: string };

async function quyen(d: PhuThuocDichVu, u: NguoiGoi, module: string, action: string): Promise<boolean> {
  if (!Number.isInteger(u.id) || u.id <= 0) return false;
  try {
    return await d.coQuyen(u.id, u.role, module, action);
  } catch {
    return false;
  }
}

function giaiGoc(d: PhuThuocDichVu, projectId: unknown, u: NguoiGoi): { ok: true; goc: string; id: string } | Loi {
  if (typeof projectId !== "string" || projectId === "") return { ok: false, ma: "PROJECT_NOT_FOUND" };
  const g = d.phanGiaiGoc(projectId, u);
  if (!g.ok || g.goc === null) return { ok: false, ma: "PROJECT_NOT_FOUND" };
  return { ok: true, goc: g.goc, id: projectId };
}

const cung = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

export async function chayUngDungChoNguoi(
  i: { user: NguoiGoi; projectId: unknown },
  d: PhuThuocDichVu,
): Promise<{ ok: true; muc: MucCongKhai } | Loi> {
  if (!(await quyen(d, i.user, "ai_repo_exec", "canCreate"))) return { ok: false, ma: "PERMISSION_DENIED" };
  const g = giaiGoc(d, i.projectId, i.user);
  if (!g.ok) return g;
  if (cung(g.goc, d.gocRepoChinh())) return { ok: false, ma: "REPO_CHINH_KHONG_CHAY" };
  const s = suyLenhChay(g.goc);
  if (!s.ok) return { ok: false, ma: s.ma, chiTiet: s.chiTiet };
  const lenh = dungLenhUngDung(s.khai, g.goc);
  if ("thieu" in lenh) return { ok: false, ma: "THIEU_MOI_TRUONG", chiTiet: lenh.thieu };
  const r = await d.ql().chay({ projectId: g.id, goc: g.goc, userId: i.user.id, lenh });
  return r.ok ? r : { ok: false, ma: r.ma, chiTiet: r.chiTiet };
}

function laChuHoacAdmin(m: MucCongKhai | null, u: NguoiGoi): boolean {
  return !!m && (m.chuSoHuu === u.id || u.role === "admin");
}

export async function dungUngDungChoNguoi(i: { user: NguoiGoi; projectId: unknown }, d: PhuThuocDichVu): Promise<{ ok: true; chuaXacNhanChet: boolean } | Loi> {
  if (!(await quyen(d, i.user, "ai_repo_read", "canView"))) return { ok: false, ma: "PERMISSION_DENIED" };
  if (typeof i.projectId !== "string") return { ok: false, ma: "NOT_FOUND" };
  const m = d.ql().trangThai(i.projectId);
  if (!laChuHoacAdmin(m, i.user)) return { ok: false, ma: "NOT_FOUND" };
  const r = await d.ql().dung(i.projectId, "nguoi-dung", i.user.id);
  return r.ok ? r : { ok: false, ma: r.ma };
}

export async function nhatKyChoNguoi(
  i: { user: NguoiGoi; projectId: unknown },
  d: PhuThuocDichVu,
): Promise<{ ok: true; dong: string[]; catDau: boolean } | Loi> {
  if (!(await quyen(d, i.user, "ai_repo_read", "canView"))) return { ok: false, ma: "PERMISSION_DENIED" };
  if (typeof i.projectId !== "string") return { ok: false, ma: "NOT_FOUND" };
  const q = d.ql();
  if (!laChuHoacAdmin(q.trangThai(i.projectId), i.user)) return { ok: false, ma: "NOT_FOUND" };
  const nk = q.nhatKy(i.projectId);
  return nk ? { ok: true, ...nk } : { ok: false, ma: "NOT_FOUND" };
}

export type UngDungChoNguoi = (MucCongKhai & { laChu: true }) | { laChu: false; dangBan: boolean } | null;

export async function trangThaiChoNguoi(
  i: { user: NguoiGoi; projectId: unknown },
  d: PhuThuocDichVu,
): Promise<
  | {
      ok: true;
      ungDung: UngDungChoNguoi;
      lenhChay: { ok: true; moTa: string; nguon: string } | { ok: false; ma: MaSuyLenhChay | "REPO_CHINH_KHONG_CHAY"; chiTiet: string };
      goiYCai: string[];
      xemTruoc: { bat: boolean; lyDoTat: string | null };
    }
  | Loi
> {
  if (!(await quyen(d, i.user, "ai_repo_read", "canView"))) return { ok: false, ma: "PERMISSION_DENIED" };
  const g = giaiGoc(d, i.projectId, i.user);
  if (!g.ok) return g;
  const q = d.ql();
  await q.lamMoiSanSang(g.id);
  const m = q.trangThai(g.id);
  const song = !!m && (m.trangThai === "dang-khoi-dong" || m.trangThai === "dang-chay" || m.trangThai === "dang-dung");
  const ungDung: UngDungChoNguoi = !m ? null : laChuHoacAdmin(m, i.user) ? { ...m, laChu: true } : { laChu: false, dangBan: song };
  let lenhChay: { ok: true; moTa: string; nguon: string } | { ok: false; ma: MaSuyLenhChay | "REPO_CHINH_KHONG_CHAY"; chiTiet: string };
  if (cung(g.goc, d.gocRepoChinh())) {
    lenhChay = { ok: false, ma: "REPO_CHINH_KHONG_CHAY", chiTiet: "repo nền tảng" };
  } else {
    const s = suyLenhChay(g.goc);
    if (s.ok) {
      const l = dungLenhUngDung(s.khai, g.goc);
      lenhChay = { ok: true, moTa: "thieu" in l ? s.khai.loai : l.moTa, nguon: s.nguon };
    } else lenhChay = { ok: false, ma: s.ma, chiTiet: s.chiTiet };
  }
  return { ok: true, ungDung, lenhChay, goiYCai: suyLenhCaiDat(g.goc), xemTruoc: d.cauHinhXemTruoc() };
}
