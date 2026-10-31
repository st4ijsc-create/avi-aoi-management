/**
 * ★★★ Đợt 12 · H5.4 (2026-10-31) — THÂN thủ tục tRPC `aiAgent.tiepTucLuot` ("tiếp tục" lượt gián đoạn thành lượt MỚI từ lịch sử máy chủ đã lưu).
 *
 * ⚠ Quyền: `ai_repo_read/canView` (cùng bit các thủ tục lượt chạy), fail-closed; tạo lượt mới còn đi qua MỌI kiểm của `taoLuotChay` (dự án, quyền thực thi,
 *   tu-dong, đang có lượt khác…). CHỈ chủ lượt (`userId` từ PHIÊN trong mọi câu SQL): lượt của người khác ≡ NOT_FOUND. Lịch sử KHÔNG BAO GIỜ nhận từ client.
 * ⚠ Lỗi trả trong THÂN `{ ok:false, note }` (khuôn các thủ tục anh em), không ném tRPC. Cờ AI_AGENT_TIEP_TUC=1 (MẶC ĐỊNH TẮT) ⇒ `TIEP_TUC_TAT`.
 */
import { checkPermission } from "../../../_core/accessControl";
import { quanLyLuotChay, type MaTuChoiTiepTuc, type QuanLyLuotChay } from "./quanLyLuotChay";

type NguoiPhien = { id: number; role: string; name?: string | null };

async function coQuyenDoc(u: NguoiPhien): Promise<boolean> {
  if (!Number.isInteger(u.id) || u.id <= 0) return false;
  try {
    return await checkPermission(u.id, u.role, "ai_repo_read", "canView");
  } catch {
    return false;
  }
}

export async function thuTucTiepTucLuot(u: NguoiPhien, y: { runId: string; req?: Parameters<QuanLyLuotChay["tiepTucLuot"]>[0]["req"] }, ql: QuanLyLuotChay = quanLyLuotChay()) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, runId: null };
  const kq = await ql.tiepTucLuot({ user: { id: u.id, role: String(u.role), name: u.name ?? null }, runId: y.runId, ...(y.req ? { req: y.req } : {}) });
  if (!kq.ok) return { ok: false as const, note: kq.ma as MaTuChoiTiepTuc, runId: null };
  return { ok: true as const, note: null, runId: kq.luot.id };
}
