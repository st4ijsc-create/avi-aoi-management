/**
 * ★★★ ĐỢT 6 — VÁ CHẶN-1: PHÉP QUYẾT ĐỊNH PHÂN QUYỀN TWIN, MỘT NƠI DUY NHẤT.
 *
 * ⚠ VÌ SAO TỆP NÀY TỒN TẠI (G20 — vùng mù "test đo BẢN SAO chép tay"):
 * Bản trước ghim luật lọc phạm vi bằng một tệp test tự KHAI LẠI biểu thức
 * `factoryIds === null || factoryIds.includes(factoryId)` ngay trong tệp test,
 * và KHÔNG import gì từ `socket.ts`. QA tiêm đột biến — xoá SẠCH
 * `resolveTenantFactoryScope` khỏi broadcaster thật — mà **5/5 test vẫn XANH**.
 * Test đo bản sao thì nó ghim bản sao; mã sản phẩm muốn trôi đi đâu cũng được.
 *
 * ⇒ Biểu thức quyết định nằm ở ĐÂY, được `socket.ts` import và gọi, và test
 *   import ĐÚNG hàm này. Xoá mã sản phẩm ⇒ test đỏ. Đó là điều kiện để một
 *   test có quyền nói nó "ghim" cái gì.
 *
 * ★ G12 — KHÔNG tự suy lại bộ phân giải phạm vi. `resolveTenantFactoryScope`
 *   (db/reportAggregators) là bộ phân giải mà tầng dữ liệu đi qua; ở đây chỉ
 *   nhận KẾT QUẢ của nó (`factoryIds`) và áp ĐÚNG một phép so.
 */

/** Hình dạng người dùng gắn trên socket (`socket.data.user`). */
export interface NguoiXemSocket {
  id?: number | null;
  role?: string | null;
}

/**
 * ★★★ PHÉP QUYẾT ĐỊNH DUY NHẤT: người có phạm vi `factoryIds` có được nhận dữ
 * liệu của nhà máy `factoryId` không?
 *
 *  • `factoryIds === null` ⇒ vai TOÀN QUYỀN (admin / vai không áp phạm vi).
 *    KHÔNG lọc. Đây là ca `resolveTenantFactoryScope` trả `{ factoryIds: null }`.
 *  • `factoryIds === []`   ⇒ ĐÃ phân giải, và người này KHÔNG được gán nhà máy
 *    nào ⇒ CHẶN TẤT. `[]` và `null` là HAI CÂU KHÁC HẲN NHAU; gộp chúng làm một
 *    chính là biến người chưa được gán thành admin.
 *  • ngược lại ⇒ chỉ nhận nhà máy CÓ TRONG danh sách.
 */
export function duocNhanNhaMay(factoryIds: number[] | null, factoryId: number): boolean {
  if (factoryIds === null) return true;
  return factoryIds.includes(factoryId);
}

/**
 * Socket này có danh tính NGƯỜI DÙNG không?
 *
 * ⚠ Client loại `machine` (và mọi socket vô danh) KHÔNG có `socket.data.user`.
 * Chúng KHÔNG được nhận dữ liệu phạm vi nhà máy: không có danh tính thì không
 * có phạm vi nào để phân giải, và "không phân giải được" phải rơi về phía CHẶN,
 * không phải phía cho qua.
 */
export function coDanhTinhNguoiDung(nguoi: NguoiXemSocket | null | undefined): boolean {
  return typeof nguoi?.id === "number" && Number.isFinite(nguoi.id);
}

/**
 * ★★★ CỔNG ĐẦY ĐỦ cho một người xem trên một nhà máy — dùng ở CẢ BA kênh
 * (`twin:trangThai`, `twin:update`, `twin:device`) và ở handler `subscribe`.
 *
 * Gộp hai luật trên thành MỘT lối vào để không nơi nào quên nửa còn lại: bản
 * trước có nơi kiểm danh tính, có nơi không, và chỗ quên chính là chỗ rò.
 */
export function nguoiXemDuocNhan(
  nguoi: NguoiXemSocket | null | undefined,
  factoryIds: number[] | null,
  factoryId: number,
): boolean {
  if (!coDanhTinhNguoiDung(nguoi)) return false;
  return duocNhanNhaMay(factoryIds, factoryId);
}
