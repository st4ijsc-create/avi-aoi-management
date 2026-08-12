/**
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **I-6** — **CHỦ DUY NHẤT của cặp cổng "LOOPBACK hoặc ĐẶC QUYỀN".**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI THAY VÌ MỘT LƯỢT CHÉP
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `observabilityRoutes.ts` đã có **đúng** cặp vị từ này (`isLoopback` + `requirePrivileged`), viết
 * riêng và **không xuất ra**. Bề mặt thứ hai cần đúng cặp ấy là
 * `POST /api/ai/local-kb/feedback` (review Pha 9 · I-6: ghi tệp, **không xác thực**, **không cưỡng
 * chế loopback** — đo sống: **400**, không phải 401). Chép sang là dựng **bản sao thứ hai dưới một
 * bất biến an ninh**, đúng lớp lỗi đã đẻ **bốn** Critical trong chuỗi pha này (và đúng lý do
 * `chanNeuPhienDaThuHoi` được rút ra ở Pha 8 C-1).
 * ⇒ Thân vị từ chuyển về đây, **một chủ**; hai bề mặt gọi cùng một hàm.
 *
 * ⚠ **`laLoopback` KHÔNG phải một phép xác thực** — nó là một phép **thu hẹp nguồn gọi**. Nó chỉ
 *   đứng được ở những bề mặt mà một tiến trình cùng máy **được phép** làm việc ấy (Prometheus cạnh
 *   app · lượt gọi tự-thân của tRPC). Đặt nó trước một bề mặt đọc dữ liệu người dùng là dựng một
 *   cửa mở cho mọi tiến trình trên cùng máy.
 * ⚠ **Fail-safe**: mọi lỗi trong `doiVaiDacQuyen` ⇒ **TỪ CHỐI** (401). Một `catch` trả `ok:true`
 *   là một `catch` mặc áo của phép đo.
 */
import type { Request } from "express";

export const VAI_DAC_QUYEN: ReadonlySet<string> = new Set(["admin", "super_admin", "supervisor"]);

export interface KetQuaXacThuc {
  ok: boolean;
  status: 200 | 401 | 403;
  role?: string;
  userId?: number;
  message?: string;
}

/**
 * Yêu cầu này có đến từ **loopback** không (Prometheus cạnh app · lượt gọi tự-thân của tRPC).
 *
 * ⚠ `::ffff:127.0.0.1` là dạng IPv4-mapped của IPv6 — bỏ tiền tố trước khi so, nếu không một máy
 *   chủ nghe trên IPv6 sẽ **không bao giờ** thoả nhánh này và bề mặt tự-thân đứt im lặng.
 */
export function laLoopback(req: Request): boolean {
  const ip = (req.ip || req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

/** Phân giải phiên trình duyệt và đòi một **vai đặc quyền**. Fail-safe: mọi lỗi ⇒ từ chối. */
export async function doiVaiDacQuyen(req: Request): Promise<KetQuaXacThuc> {
  try {
    const { sdk } = await import("../_core/sdk");
    const user = await sdk.authenticateRequest(req as never);
    if (!user) return { ok: false, status: 401, message: "Authentication required." };
    const role = (user as { role?: string }).role ?? "";
    if (!VAI_DAC_QUYEN.has(role)) {
      return { ok: false, status: 403, role, message: "Privileged role (admin/supervisor) required." };
    }
    return { ok: true, status: 200, role, userId: (user as { id?: number }).id };
  } catch {
    return { ok: false, status: 401, message: "Authentication required (invalid session)." };
  }
}
