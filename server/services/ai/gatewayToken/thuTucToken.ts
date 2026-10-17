/**
 * ★★★ Đợt 4A (2026-10-17) — THÂN các thủ tục tRPC `aiGatewayToken.*` (token theo người dùng cho cổng `/v1` + bước
 * xác nhận của device flow). Router (`server/routers/aiGatewayTokenRouter.ts`) chỉ khai lược đồ + gọi vào đây, để lưới
 * đo được thân thủ tục mà không dựng tRPC (khuôn `ai/agent/thuTucLuotChay.ts`).
 *
 * ⚠⚠ QUYỀN — `ai_repo_read/canView`, KHÔNG mở bit mới. Lý do: token chỉ mở cổng SINH CHỮ `/v1` cho extension lập
 *   trình — đúng nhóm người đã được dùng trợ lý lập trình/tác nhân AI (cùng bit của `aiAgent.*`, `repoWorkspace.*`,
 *   tool đọc repo và cổng `/ai-coding-workspace`). Một bit riêng là một hàng ma trận quyền nữa mà quản trị phải nhớ
 *   bật, trong khi người có bit này ĐÃ gọi được cùng model qua trang web. Cổng `/v1` kiểm LẠI bit này ở MỖI yêu cầu
 *   (mất quyền sau khi cấp ⇒ token thôi mở cổng).
 * ⚠⚠ PHIÊN WEB — `tao` và `quyetThietBi` đòi cookie phiên (`ctx.sessionToken`). Phiên web của một tài khoản bật 2FA
 *   chỉ được đúc SAU bước TOTP (`oauth.ts` trả `requires2FA` trước khi tạo phiên), nên "có phiên" ⇒ "đã qua 2FA nếu bật".
 *   Kiểm tường minh để một cửa xác thực thứ hai (Bearer…) mọc ra sau này KHÔNG tự động đúc được token từ token.
 * ⚠ AUDIT — một hàng WORM `audit_logs` cho mỗi lần tạo / thu hồi / duyệt / từ chối thiết bị; KHÔNG BAO GIỜ chứa bản rõ.
 * ⚠ Từ chối ⇒ `{ ok:false, note }` (khuôn `repoWorkspaceRouter`), không ném lỗi thô — client dịch `note` qua i18n.
 */
import type { PhamVi } from "./maToken";
import {
  taoTokenNguoiDung,
  danhSachTokenCuaToi,
  thuHoiToken,
  xemThietBi,
  quyetThietBi,
  type MucToken,
} from "../../../db/aiGatewayTokens";

export type NguoiPhienToken = { id: number; role: string; name?: string | null };
type ReqMeta = { ip?: string; headers?: Record<string, unknown>; socket?: { remoteAddress?: string } } | undefined;
type KiemQuyen = (u: NguoiPhienToken) => Promise<boolean>;

export const ENTITY_AI_GATEWAY_TOKEN = "ai_gateway_token";
/** Lượt xem/quyết mã thiết bị tối đa mỗi phút mỗi người — chặn dò mã 8 ký tự. */
export const TRAN_THU_MA_MOI_PHUT = 10;

async function coQuyenMacDinh(u: NguoiPhienToken): Promise<boolean> {
  if (!Number.isInteger(u.id) || u.id <= 0) return false;
  try {
    const { checkPermission } = await import("../../../_core/accessControl");
    return await checkPermission(u.id, String(u.role), "ai_repo_read", "canView");
  } catch {
    return false;
  }
}

async function ghiAudit(
  u: NguoiPhienToken,
  req: ReqMeta,
  hang: { action: string; entityId: number; entityName: string; operation: string; metadata: Record<string, unknown> },
): Promise<void> {
  const { createAuditContext, logCrudOperation } = await import("../../auditTrailService");
  await logCrudOperation(createAuditContext({ user: { id: u.id, name: u.name ?? null }, req: req as never }), {
    action: hang.action,
    entityType: ENTITY_AI_GATEWAY_TOKEN,
    entityId: hang.entityId,
    entityName: hang.entityName,
    details: { operation: hang.operation, metadata: hang.metadata },
    status: "success",
  });
}

async function quaTranThuMa(userId: number): Promise<boolean> {
  const { checkNamedRateLimit } = await import("../../aiGateway");
  return checkNamedRateLimit(userId, "gw-thiet-bi-thu-ma", TRAN_THU_MA_MOI_PHUT) !== null;
}

export async function thuTucDanhSach(u: NguoiPhienToken, coQuyen: KiemQuyen = coQuyenMacDinh) {
  if (!(await coQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const, tokens: [] as MucToken[] };
  return { ok: true as const, note: null, tokens: await danhSachTokenCuaToi(u.id) };
}

export async function thuTucTao(
  u: NguoiPhienToken,
  sessionToken: string | null | undefined,
  vao: { ten: string; phamVi?: PhamVi[]; soNgay?: number },
  req?: ReqMeta,
  coQuyen: KiemQuyen = coQuyenMacDinh,
) {
  if (!sessionToken) return { ok: false as const, note: "CAN_PHIEN_WEB" as const };
  if (!(await coQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const };
  const kq = await taoTokenNguoiDung({ userId: u.id, ten: vao.ten, phamVi: vao.phamVi, soNgay: vao.soNgay, nguon: "web" });
  if (!kq.ok) return { ok: false as const, note: kq.ma === "qua-tran" ? ("QUA_TRAN" as const) : ("DB_UNAVAILABLE" as const) };
  await ghiAudit(u, req, {
    action: "create",
    entityId: kq.id,
    entityName: kq.tienTo,
    operation: "AI_GATEWAY_TOKEN_CREATED",
    metadata: { ten: kq.ten, phamVi: kq.phamVi, hetHanLuc: kq.hetHanLuc, nguon: "web" },
  });
  return {
    ok: true as const,
    note: null,
    id: kq.id,
    /** ⚠ BẢN RÕ — trả đúng lần này; không lưu, không ghi nhật ký. */
    token: kq.token,
    tienTo: kq.tienTo,
    ten: kq.ten,
    phamVi: kq.phamVi,
    hetHanLuc: kq.hetHanLuc,
  };
}

export async function thuTucThuHoi(u: NguoiPhienToken, id: number, req?: ReqMeta, coQuyen: KiemQuyen = coQuyenMacDinh) {
  // Thu hồi KHÔNG đòi cookie: thu hẹp quyền luôn được phép từ bất kỳ phiên hợp lệ nào. Vẫn đòi quyền AI (bề mặt AI).
  if (!(await coQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const };
  if (!(await thuHoiToken(u.id, id))) return { ok: false as const, note: "NOT_FOUND" as const };
  await ghiAudit(u, req, {
    action: "update",
    entityId: id,
    entityName: `token#${id}`,
    operation: "AI_GATEWAY_TOKEN_REVOKED",
    metadata: {},
  });
  return { ok: true as const, note: null };
}

export async function thuTucXemThietBi(u: NguoiPhienToken, maNguoiDung: string, coQuyen: KiemQuyen = coQuyenMacDinh) {
  if (!(await coQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const };
  if (await quaTranThuMa(u.id)) return { ok: false as const, note: "RATE_LIMITED" as const };
  const kq = await xemThietBi(maNguoiDung);
  if (!kq.ok) return { ok: false as const, note: kq.ma };
  return { ok: true as const, note: null, ten: kq.ten, phamVi: kq.phamVi, conLaiGiay: kq.conLaiGiay };
}

export async function thuTucQuyetThietBi(
  u: NguoiPhienToken,
  sessionToken: string | null | undefined,
  vao: { maNguoiDung: string; dongY: boolean },
  req?: ReqMeta,
  coQuyen: KiemQuyen = coQuyenMacDinh,
) {
  if (!sessionToken) return { ok: false as const, note: "CAN_PHIEN_WEB" as const };
  if (!(await coQuyen(u))) return { ok: false as const, note: "PERMISSION_DENIED" as const };
  if (await quaTranThuMa(u.id)) return { ok: false as const, note: "RATE_LIMITED" as const };
  const xem = await xemThietBi(vao.maNguoiDung);
  const kq = await quyetThietBi(u.id, vao.maNguoiDung, vao.dongY);
  if (!kq.ok) return { ok: false as const, note: kq.ma };
  await ghiAudit(u, req, {
    action: "update",
    entityId: kq.id,
    entityName: `thiet-bi:${xem.ok ? xem.ten : "?"}`,
    operation: vao.dongY ? "AI_GATEWAY_DEVICE_APPROVED" : "AI_GATEWAY_DEVICE_DENIED",
    metadata: { phamVi: xem.ok ? xem.phamVi : null },
  });
  return { ok: true as const, note: null, trangThai: kq.trangThai };
}
