/**
 * ★★★ Đợt 11.8 · T1b — THÂN các thủ tục tRPC `aiAgent.{dinhNghiaDanhSach, xacNhanDinhNghia, goTinCayDinhNghia}`: xem / xác nhận / gỡ
 * tin cậy định nghĩa agent từ repo (`.thoca/agents/*.md`).
 *
 * ⚠⚠ CHỈ do NGƯỜI gọi qua phiên đăng nhập: `userId` lấy từ `ctx.user.id` của router, KHÔNG là công cụ của agent, KHÔNG nhận từ input,
 *   không gọi được từ kết quả công cụ/tóm tắt con. Xác nhận nhận (tên, băm đã xem) và ĐỌC LẠI tệp để so băm (TOCTOU).
 * ⚠ Quyền: `ai_repo_read/canView` (cùng bit mở lượt agent). Dự án giải qua danh sách TRẮNG (id, không đường dẫn) và dự án cá nhân
 *   theo danh tính người gọi — như `taoLuotChay`.
 */
import { checkPermission } from "../../../_core/accessControl";
import { duAnMacDinh, phanGiaiGoc } from "../../aiLocalTools/repoProjects";
import * as khoTinCay from "../../../db/aiAgentDefTrust";
import { napDinhNghiaTuRepo, xacNhanDinhNghia, xemDinhNghia, type DinhNghiaDaNap } from "./dinhNghiaAgentMayChu";

type NguoiPhien = { id: number; role: string; name?: string | null };

export interface PhuThuocThuTucDinhNghia {
  kiemQuyen: (u: NguoiPhien) => Promise<boolean>;
  nap: (goc: string) => DinhNghiaDaNap;
  kho: Pick<typeof khoTinCay, "danhSachTinCay" | "xacNhanTinCay" | "goTinCay">;
}

const PHU_THUOC_THAT: PhuThuocThuTucDinhNghia = {
  async kiemQuyen(u) {
    if (!Number.isInteger(u.id) || u.id <= 0) return false;
    try {
      return await checkPermission(u.id, u.role, "ai_repo_read", "canView");
    } catch {
      return false; // fail-closed
    }
  },
  nap: napDinhNghiaTuRepo,
  kho: khoTinCay,
};

function giaiDuAn(u: NguoiPhien, projectId?: string | null): { id: string; goc: string } | null {
  if (projectId === undefined || projectId === null || projectId === "") {
    const md = duAnMacDinh();
    return { id: md.id, goc: md.goc };
  }
  const pg = phanGiaiGoc(projectId, { id: u.id, role: u.role });
  return pg.ok && pg.goc && pg.id ? { id: pg.id, goc: pg.goc } : null;
}

export async function thuTucXemDinhNghia(u: NguoiPhien, projectId?: string | null, dep: PhuThuocThuTucDinhNghia = PHU_THUOC_THAT) {
  if (!(await dep.kiemQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, muc: [], canhBao: [] };
  const da = giaiDuAn(u, projectId);
  if (!da) return { ok: false as const, note: "PROJECT_NOT_FOUND" as const, muc: [], canhBao: [] };
  const r = await xemDinhNghia({ userId: u.id, projectId: da.id, gocDuAn: da.goc }, { danhSachTinCay: dep.kho.danhSachTinCay, nap: dep.nap });
  return { ok: true as const, note: null, projectId: da.id, muc: r.muc, canhBao: r.canhBao };
}

export async function thuTucXacNhanDinhNghia(
  u: NguoiPhien,
  y: { projectId?: string | null; ten: string; bam: string },
  dep: PhuThuocThuTucDinhNghia = PHU_THUOC_THAT,
) {
  if (!(await dep.kiemQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const };
  const da = giaiDuAn(u, y.projectId);
  if (!da) return { ok: false as const, note: "PROJECT_NOT_FOUND" as const };
  const kq = await xacNhanDinhNghia(
    { userId: u.id, projectId: da.id, gocDuAn: da.goc, ten: y.ten, bamDaXem: y.bam },
    { nap: dep.nap, xacNhan: dep.kho.xacNhanTinCay },
  );
  return kq.ok ? { ok: true as const, note: null, bam: kq.bam } : { ok: false as const, note: kq.ma };
}

export async function thuTucGoTinCayDinhNghia(u: NguoiPhien, y: { projectId?: string | null; ten: string }, dep: PhuThuocThuTucDinhNghia = PHU_THUOC_THAT) {
  if (!(await dep.kiemQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, daGo: 0 };
  const da = giaiDuAn(u, y.projectId);
  if (!da) return { ok: false as const, note: "PROJECT_NOT_FOUND" as const, daGo: 0 };
  const n = await dep.kho.goTinCay(u.id, da.id, y.ten);
  return { ok: true as const, note: null, daGo: n };
}
