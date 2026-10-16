/**
 * ★★ Đợt 1 · T4 (2026-10-17) — THÂN các thủ tục tRPC `aiAgent.{danhSach, chiTiet, duyet, bac, hoanTac}` (vòng agent
 * máy chủ). Router (`server/routers/aiAgentRouter.ts`) chỉ khai lược đồ + gọi vào đây, để lưới đo được thân thủ tục
 * mà không dựng tRPC.
 *
 * ⚠ Quyền: MỌI thủ tục đòi `ai_repo_read/canView` (cùng bit của tool đọc repo) — fail-closed khi `checkPermission`
 *   ném. Từ chối ⇒ `{ ok:false, note:"PERMISSION_DENIED" }` (khuôn `repoWorkspaceRouter`), không ném lỗi thô.
 * ⚠ `duyet` = `confirmAction` THẬT (RBAC lần 2, hàng rào ghi, audit CONFIRMED/EXECUTED — người bấm là người phiên)
 *   rồi ĐÁNH THỨC lượt chạy đang chờ qua bus; `bac` = `cancelAction` + lý do cho model. Phạm vi chủ sở hữu do
 *   `confirmAction`/`cancelAction` cưỡng chế (token gắn userId).
 */
import { daBiTuChoiGhi, maTuChoiGhi } from "@shared/aiCodingLoop";
import type { NgonNgu } from "@shared/agentCore";
import { checkPermission } from "../../../_core/accessControl";
import { cancelAction, confirmAction, type CopilotUser } from "../../aiCopilotActions";
import type { ToolExecContext } from "../../aiLocalTools";
import { baoQuyetDinhDuyet, boLyDoBac, ghiLyDoBacTruoc } from "./busDuyetAgent";
import { quanLyLuotChay, type QuanLyLuotChay } from "./quanLyLuotChay";

type NguoiPhien = { id: number; role: string; name?: string | null };

async function coQuyenDoc(u: NguoiPhien): Promise<boolean> {
  if (!Number.isInteger(u.id) || u.id <= 0) return false;
  try {
    return await checkPermission(u.id, u.role, "ai_repo_read", "canView");
  } catch {
    return false;
  }
}

const copilot = (u: NguoiPhien): CopilotUser => ({ id: u.id, role: String(u.role), name: u.name ?? null });

export async function thuTucDanhSach(u: NguoiPhien, projectId?: string | null, ql: QuanLyLuotChay = quanLyLuotChay()) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, runs: [] };
  return { ok: true as const, note: null, runs: await ql.danhSach(u.id, projectId ?? null) };
}

export async function thuTucChiTiet(u: NguoiPhien, runId: string, ql: QuanLyLuotChay = quanLyLuotChay()) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, run: null };
  const run = await ql.chiTiet(runId, u.id);
  // Không tồn tại và của-người-khác trả CÙNG mã (không có kênh đếm lượt chạy của người khác).
  return run ? { ok: true as const, note: null, run } : { ok: false as const, note: "NOT_FOUND" as const, run: null };
}

export async function thuTucDuyet(
  u: NguoiPhien,
  y: { actionId: string; selectedHunkIds?: number[]; lang: NgonNgu; req?: ToolExecContext["req"] },
) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, status: null, daGhi: false, maTuChoi: null };
  const kq = await confirmAction(y.actionId, y.actionId, copilot(u), y.lang, y.req, {}, undefined, y.selectedHunkIds);
  // Đánh thức lượt chạy (nếu có) với KẾT QUẢ THẬT — kể cả khi bị từ chối, để vòng không chờ tới hết hạn.
  if (kq.ok || kq.status === "denied" || kq.status === "expired") baoQuyetDinhDuyet(y.actionId, { loai: "duyet", ketQua: kq });
  return {
    ok: kq.ok,
    note: null,
    status: kq.status,
    message: kq.message ?? null,
    daGhi: kq.ok && kq.status !== "bi_tu_choi_ghi" && !daBiTuChoiGhi(kq.result),
    maTuChoi: maTuChoiGhi(kq.result),
  };
}

export async function thuTucBac(u: NguoiPhien, y: { actionId: string; lyDo: string; req?: ToolExecContext["req"] }) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, status: null };
  // Ghi lý do TRƯỚC khi huỷ — xem `ghiLyDoBacTruoc` (cuộc đua với bộ kiểm định kỳ của lượt chạy).
  ghiLyDoBacTruoc(y.actionId, y.lyDo.trim());
  const kq = await cancelAction(y.actionId, copilot(u), y.req);
  if (kq.ok) baoQuyetDinhDuyet(y.actionId, { loai: "bac", lyDo: y.lyDo.trim() });
  else boLyDoBac(y.actionId);
  return { ok: kq.ok, note: null, status: kq.status };
}

export async function thuTucHoanTac(
  u: NguoiPhien,
  y: { runId: string; checkpointId?: string; lang: NgonNgu; req?: ToolExecContext["req"] },
  ql: QuanLyLuotChay = quanLyLuotChay(),
) {
  if (!(await coQuyenDoc(u))) return { ok: false as const, note: "PERMISSION_DENIED", khoiPhuc: [], xungDot: [], boQua: [] };
  const kq = await ql.hoanTac({ runId: y.runId, checkpointId: y.checkpointId, user: copilot(u), lang: y.lang, req: y.req });
  if (!kq.ok) return { ok: false as const, note: kq.ma, khoiPhuc: [], xungDot: [], boQua: [] };
  return { ok: true as const, note: null, ...kq.ketQua };
}
