/**
 * Chỉ cho phép đo (c) của lô Luồng-1: tiến trình worker CON chạy hàng đợi luồng `process.argv[2]`-tiền-tố rồi TỰ SIGKILL ngay sau khi gửi thông báo THẬT
 * (đã ghi CSDL) và TRƯỚC khi động cơ kịp ghi kết quả bước. Cha kiểm: đúng 1 thông báo, bước `khong-ro`, lượt `loi` — không gửi lại.
 * Chạy bằng `tsx`, DATABASE_URL do cha truyền (CSDL `_test`).
 */
import { __datHamGuiThongBaoChoTest } from "./nut/thongBao";
import { chayMotMuc } from "./dongCo";

const tienTo = process.argv[2] ?? "";
__datHamGuiThongBaoChoTest(async (userId, p) => {
  const { sendNotification } = await import("../notificationService");
  const kq = await sendNotification(userId, p);
  console.log("DA_GUI", userId);
  process.kill(process.pid, "SIGKILL");
  return kq;
});
for (let i = 0; i < 50 && (await chayMotMuc("w-kill-con", undefined, tienTo)); i++);
console.log("CON_THOAT_BINH_THUONG"); // không bao giờ tới đây nếu node thông báo chạy
process.exit(0);
