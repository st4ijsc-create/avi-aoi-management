/**
 * ★★★ ĐỢT 45 (mục 1) — BONG BÓNG CHAT NỔI: MỘT DANH SÁCH TUYẾN ẨN, MỘT VỊ TỪ.
 *
 * `AILocalChatBubble` gắn ở gốc `App.tsx` và nổi `fixed bottom-6 right-6` trên MỌI tuyến.
 * Trước đợt này nó tự ẩn ở hai chỗ bằng hai `startsWith` rời (`/ai-chat`, `/andon`).
 * QA Đợt 44 (D-7 mục 6) đo được nó ĐÈ nội dung ở CẢ BỐN màn twin, cả hai viewport:
 *   /twin            → nút tốc độ "×5" của thanh tua (`lop-phu-dong-thoi-gian`)
 *   /twin/line/:id   → ô trạm cuối của dải chuyền (`khoi-dai-line`) @1280
 *   /twin/may/:id    → hàng "Mặt phẳng điều khiển" của ngăn xử lý (`panel-phai-may`) @1280
 *   /twin-studio     → thư viện asset (`thu-vien-asset`)
 *
 * Vì sao ẨN chứ không dời/thu nhỏ: bốn màn twin là bề mặt TOÀN VIEWPORT (canvas + lớp phủ
 * neo bốn góc + dải đáy), không có góc nào trống ở cả 1600×900 lẫn 1280×720 — dời sang góc
 * khác chỉ đổi thứ bị đè. Cùng lớp lý do `/andon` đã ẩn: một bề mặt vận hành nhìn-toàn-màn
 * không phải chỗ cho widget cá nhân. Đường vào AI vẫn còn qua mục nav / `/ai-chat`.
 *
 * ★ Danh sách ở ĐÂY, không rải trong component: thêm tuyến = thêm một dòng + một ca test.
 */
export const TUYEN_AN_BONG_BONG: readonly string[] = ["/ai-chat", "/andon", "/twin"];

/** Tuyến này có ẩn bong bóng chat không? Khớp theo TIỀN TỐ đoạn đường (`/twin`, `/twin/…`, `/twin-studio`). */
export function anBongBongTrenTuyen(duong: string): boolean {
  return TUYEN_AN_BONG_BONG.some((t) => duong === t || duong.startsWith(`${t}/`) || duong.startsWith(`${t}-`) || duong.startsWith(`${t}?`));
}
