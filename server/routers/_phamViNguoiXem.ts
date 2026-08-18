/**
 * ★★★ 2026-08-18 — **MỘT CÁCH DUY NHẤT ĐỂ ĐƯA DANH TÍNH TỪ `ctx` XUỐNG TẦNG DỮ LIỆU.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO LÀ MỘT HÀM, KHÔNG PHẢI MỘT KHUÔN CHÉP TAY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Sổ nợ `phamViDocBaseline.ts` đếm được **552** thủ tục đọc dữ liệu tenant mà danh tính không rời
 * tay handler. Trả nợ nghĩa là viết `{ userId: ctx.user?.id, userRole: ctx.user?.role }` hàng trăm
 * lần. Một khuôn chép tay hàng trăm lần là một khuôn sẽ bị chép SAI ít nhất một lần — và biến thể
 * sai nguy hiểm nhất đã có tên trong repo này:
 *
 *     ✗ `{ userId: input.userId }`   — lời **TỰ KHAI** của người gọi, không phải một phép xác thực.
 *     ✗ `{ userId: ctx.user?.id }`   — thiếu `userRole` ⇒ `resolveTenantFactoryScope` mặc định
 *                                       `"user"`, và một `admin` lặng lẽ bị **thu hẹp**: bản vá
 *                                       "an toàn hơn" hoá ra làm hỏng vai toàn quyền.
 *
 * Hàm này làm cả hai biến thể ấy **không diễn đạt được ở chỗ dùng**: nó chỉ nhận `ctx`, và nó luôn
 * lấy CẢ HAI ô. Cùng lý lẽ đã ghi ở `scopeLabelsOf` (`_core/accessControlLabels.ts`) — biến một
 * quy ước phải nhớ thành một thứ không quên được.
 *
 * ⚠ Bỏ trống cả hai ô (khi `ctx.user` vắng) = **KHÔNG lọc**. Đó là hình dạng CÓ THẬT của lối đi
 * không mang danh tính, và là chiều DƯƠNG chống "vá quá tay thành chặn tất cả" — xem
 * `PhamViNguoiXem` ở `server/db/hierarchy.ts`.
 */
import type { PhamViNguoiXem } from "../db/hierarchy";

/** Hình dạng TỐI THIỂU của `ctx` mà hàm này cần — không kéo theo kiểu tRPC đầy đủ. */
export interface CoDanhTinh {
  user?: { id?: number | null; role?: string | null } | null;
}

/**
 * Trích phạm vi người xem từ `ctx` của tRPC.
 *
 * ⚠ Danh tính **LUÔN** đến từ `ctx.user` (máy chủ tự xác thực từ phiên), **KHÔNG BAO GIỜ** từ
 * `input`. Đây là điểm chốt duy nhất của luật ấy trên đường router → db.
 */
export function phamViCua(ctx: CoDanhTinh | null | undefined): PhamViNguoiXem {
  return { userId: ctx?.user?.id ?? undefined, userRole: ctx?.user?.role ?? undefined };
}
