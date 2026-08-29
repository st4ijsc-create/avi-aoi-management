/**
 * Vị từ THUẦN: có được hiện thẻ duyệt cho một đề xuất ghi khi CHẾ ĐỘ dự án đang chọn là
 * `cheDoLoai`?
 *
 * ⚠ Chỉ chế độ SERVER được hiện. LOCAL gửi `codingMode:false` (`yeuCau.ts`) nên máy chủ về lý
 * thuyết không bao giờ trả `pending_action` cho một lượt LOCAL — nhưng nếu một lỗi phía máy chủ
 * (hoặc người dùng đổi ô chọn dự án giữa chừng một lượt hỏi đang chạy) vẫn khiến khung đó lọt tới
 * đây, hàng rào cuối này ngăn thẻ duyệt hiện lên rồi lỡ tay "Duyệt & ghi trên SERVER" một đề xuất
 * mà người dùng tưởng đang sửa tệp trên máy mình (spec §7: tai nạn không cứu được).
 */
export function coDuocHienTheDuyet(cheDoLoai: "local" | "server"): boolean {
  return cheDoLoai === "server";
}
