/**
 * ★★★ Đợt 11.3-C (2026-10-31) — THÂN các thủ tục tRPC `aiAgent.{keHoachDangCho, duyetKeHoach}` (cổng duyệt kế hoạch, UX-D02).
 *
 * ⚠ Quyền: `ai_repo_read/canView` (cùng bit các thủ tục lượt chạy), fail-closed. CHỈ chủ lượt chạy (`userId` từ PHIÊN, trong mọi câu SQL):
 *   lượt của người khác ≡ không tồn tại. Lỗi trả trong THÂN `{ ok:false, note }` (khuôn các thủ tục anh em), không ném tRPC.
 * ⚠ Duyệt kế hoạch KHÔNG duyệt thẻ ghi/lệnh — thẻ vẫn qua `confirmAction`. Thủ tục này không đụng `ai_pending_actions`.
 * ⚠ Băm client gửi chỉ để SO với băm máy chủ lưu (chống tráo kế hoạch giữa lúc xem và lúc bấm); không bao giờ được ghi.
 */
import { checkPermission } from "../../../_core/accessControl";
import { docKeHoach as docKeHoachThat, quyetKeHoach as quyetKeHoachThat } from "../../../db/aiAgentKeHoach";
import { baoKeHoachDaQuyet } from "./choDuyetKeHoach";

type NguoiPhien = { id: number; role: string; name?: string | null };

async function coQuyenDoc(u: NguoiPhien): Promise<boolean> {
  if (!Number.isInteger(u.id) || u.id <= 0) return false;
  try {
    return await checkPermission(u.id, u.role, "ai_repo_read", "canView");
  } catch {
    return false;
  }
}

export interface PhuThuocThuTucKeHoach {
  doc: typeof docKeHoachThat;
  quyet: typeof quyetKeHoachThat;
  danhThuc: (runId: string) => void;
}
const MAC_DINH: PhuThuocThuTucKeHoach = { doc: docKeHoachThat, quyet: quyetKeHoachThat, danhThuc: baoKeHoachDaQuyet };

const RONG = { viec: [] as never[], bam: null, trangThai: null, nopLuc: null, duyetLuc: null };

export async function thuTucKeHoachDangCho(u: NguoiPhien, runId: string, dep: Partial<PhuThuocThuTucKeHoach> = {}) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, ...RONG };
  const h = await ({ ...MAC_DINH, ...dep }).doc(u.id, runId);
  if (!h) return { ok: false as const, note: "NOT_FOUND" as const, ...RONG };
  return {
    ok: true as const,
    note: null,
    viec: h.viec,
    bam: h.bam,
    trangThai: h.trangThai,
    nopLuc: h.nopLuc ? h.nopLuc.toISOString() : null,
    duyetLuc: h.duyetLuc ? h.duyetLuc.toISOString() : null,
  };
}

export async function thuTucDuyetKeHoach(u: NguoiPhien, y: { runId: string; bam: string; quyetDinh: "duyet" | "bac" }, dep: Partial<PhuThuocThuTucKeHoach> = {}) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, trangThai: null, luc: null };
  const d = { ...MAC_DINH, ...dep };
  const kq = await d.quyet(u.id, y.runId, y.bam, y.quyetDinh);
  if (!kq.ok) return { ok: false as const, note: kq.ma, trangThai: null, luc: null };
  // Đã GHI SỔ xong mới đánh thức lượt (lượt vẫn đọc lại sổ — bus chỉ làm nhanh).
  d.danhThuc(y.runId);
  return { ok: true as const, note: null, trangThai: kq.trangThai, luc: kq.luc.toISOString() };
}
