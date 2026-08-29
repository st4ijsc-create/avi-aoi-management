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
import type { MucDuAn } from "./duAn";
import type { CheDoDuAn } from "./yeuCau";

export function coDuocHienTheDuyet(cheDoLoai: "local" | "server"): boolean {
  return cheDoLoai === "server";
}

/**
 * ★★★ SUY CHẾ ĐỘ TỪ Ô CHỌN DỰ ÁN — **KHÔNG BIẾT thì trả `undefined`, KHÔNG đoán.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHÔNG CÒN NHÁNH RƠI-VỀ LOCAL (lỗ đã có thật, sửa 2026-08-29)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản cũ (`bangChat.cheDoHienTai`) viết `ds.find(...) ?? ds[0]` rồi `muc?.loai === "server" ? … :
 * { loai:"local", nhan: muc?.nhan ?? "workspace" }`. Hệ quả: danh sách dự án **RỖNG hoặc CHƯA NẠP
 * XONG** ⇒ hàm khai chắc nịch "chế độ LOCAL". Đó là hướng SAI để đoán:
 *   · LOCAL là chế độ **extension tự cưỡng chế** (máy chủ không với tới đĩa máy dev, spec §4.1);
 *   · và từ Đợt C, chính chế độ ấy MỞ CỬA cho một lượt ghi vào đĩa của người dùng.
 * Tức là ở trạng thái "không biết", bản cũ chọn đúng nhánh có hậu quả nặng nhất — rồi hiện một thẻ
 * duyệt mang nhãn `LOCAL · workspace`, một cái tên KHÔNG ứng với thư mục nào có thật.
 *
 * Nay: không xác định được ⇒ `undefined` ⇒ nơi gọi **từ chối cả lượt hỏi**, nên KHÔNG có thẻ duyệt
 * nào được vẽ ra. Fail-closed: thà không hỏi được còn hơn hỏi trong một chế độ mình không biết.
 *
 * ⚠ Một ngoại lệ CÓ CHỦ Ý: `duAnChon === undefined` **trong khi danh sách đã có mục** không phải
 *   "không biết" — ô `<select>` của webview khi chưa ai chạm vào đang hiển thị mục ĐẦU TIÊN, và đó
 *   chính là thứ người dùng NHÌN THẤY. Suy theo mục đầu tiên ở đây là đọc đúng cái đang hiện, không
 *   phải đoán. Ngược lại, một `duAnChon` KHÁC RỖNG mà không khớp mục nào là DESYNC thật ⇒ `undefined`.
 */
export function suyCheDo(dsDuAn: MucDuAn[], duAnChon: string | undefined): CheDoDuAn | undefined {
  if (dsDuAn.length === 0) return undefined;
  const muc = duAnChon === undefined ? dsDuAn[0] : dsDuAn.find((d) => d.id === duAnChon);
  if (!muc) return undefined;
  return muc.loai === "server"
    ? { loai: "server", projectId: muc.id.slice("server:".length), nhan: muc.nhan }
    : { loai: "local", nhan: muc.nhan };
}
