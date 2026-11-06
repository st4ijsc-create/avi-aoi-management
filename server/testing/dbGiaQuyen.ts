/**
 * ★ DB giả chỉ biết bảng `permissions`, cho lưới chạy `checkPermission` THẬT mà không có CSDL (lưới dòng AI lập trình).
 *
 * Từ P0-2 (Pha 0), admin không còn bypass trước khi đọc CSDL: `checkPermission` đọc hàng quyền rồi mới quyết. Mặc định giả này trả
 * "không có hàng", đúng tình trạng thật của đa số admin (DEV 06/11: 7/10 admin không có hàng nào) ⇒ admin qua theo luật thật, KHÔNG phải god-mode.
 * Lưới cần nhánh từ chối thì `datHangQuyenGia({ canView: false })`: hàng tường minh ràng buộc admin. Không nhớ `datHangQuyenGia()` trong `beforeEach`
 * thì hàng lọt sang ca sau.
 *
 * Bảng khác vẫn ném TypeError như DB giả cũ (chỉ có `insert`) để đường chạy ngoài RBAC của các lưới này không đổi.
 */

type Bit = "canView" | "canCreate" | "canEdit" | "canDelete" | "canExport";
export type HangQuyenGia = Partial<Record<Bit, boolean>> & { expiresAt?: Date | null };

const hienTai: { hang: HangQuyenGia[] } = { hang: [] };

/** Không đối số ⇒ về "không có hàng". `checkPermission` chỉ đọc một hàng theo (userId, module); giả này trả cùng hàng cho mọi module. */
export function datHangQuyenGia(hang?: HangQuyenGia): void {
  hienTai.hang = hang ? [hang] : [];
}

export function dbGiaChiCoBangQuyen() {
  return {
    insert: () => ({ values: async () => undefined }),
    select: () => ({
      from: (bang: Record<symbol, unknown>) => {
        const ten = bang?.[Symbol.for("drizzle:Name")];
        if (ten !== "permissions") throw new TypeError(`dbGiaChiCoBangQuyen: không có bảng ${String(ten)}`);
        return { where: () => ({ limit: async () => hienTai.hang }) };
      },
    }),
  };
}
