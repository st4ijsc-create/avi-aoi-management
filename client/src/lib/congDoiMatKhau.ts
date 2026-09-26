/**
 * ★★★ Pha 7 / review TOÀN NHÁNH **I-4** — **QUYẾT ĐỊNH của cổng buộc-đổi-mật-khẩu phía CLIENT.**
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo lưới của module này vào lượng
 *  từ *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO PHẦN "QUYẾT ĐỊNH" TÁCH KHỎI COMPONENT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `vitest.config.ts` chạy client ở **`environment: "node"`** và chỉ gom `*.unit.test.ts` (không
 * `.tsx`); repo **không** có `jsdom`/`@testing-library`. ⇒ Một `.tsx` **không render được trong
 * lưới**. Nên vị từ — thứ duy nhất có thể sai theo kiểu im lặng — sống ở đây, dưới một lưới thật,
 * còn `components/CongDoiMatKhau.tsx` chỉ còn là một lượt `if` trên kết quả của nó.
 * ⚠ Đó là một **giới hạn đã biết**, không phải một lựa chọn thẩm mỹ: phần JSX của cổng được canh
 *   bằng lưới **CẤU TRÚC** (quét mã nguồn) ở `congDoiMatKhau.unit.test.ts` §3, và lưới cấu trúc
 *   yếu hơn một lượt render thật. Ghi vào nợ, đừng để nó trôi thành "đã canh rồi".
 *
 * ⚠⚠ **KHÔNG có bản sao thứ hai của tập miễn trừ ở đây.** Vị từ và tập miễn trừ có **một chủ**:
 *    `shared/buocDoiMatKhau.ts`. Hai bản ở hai phía là chỗ luật trôi đi — và ở đúng cổng này, lệch
 *    một chiều nào cũng hỏng: máy chủ tha `admin` mà client nhốt ⇒ admin kẹt trong màn đổi mật
 *    khẩu; client thả mà máy chủ chặn ⇒ mọi trang trắng, không câu lỗi nào giải thích.
 */
import { biChanBoiCongDoiMatKhau } from "@shared/buocDoiMatKhau";

/**
 * Đường của màn đổi mật khẩu **ĐÃ CÓ SẴN** trong repo (`client/src/pages/ChangePassword.tsx`,
 * `<Route path="/change-password">` ở `App.tsx`).
 * ⚠ Cổng này **DÙNG LẠI** màn ấy; nó **không** dựng một màn thứ hai. Hai màn đổi mật khẩu là hai
 *   đường ghi cho cùng một bất biến, và lớp lỗi ấy đã đẻ ba Critical trong chuỗi pha này.
 */
export const DUONG_DOI_MAT_KHAU = "/change-password";

/** Hình dạng tối thiểu mà cổng cần từ `auth.me` (`MeUser` của `server/_core/publicUser.ts`). */
export type NguoiDungCuaCong = {
  role?: string | null;
  mustChangePassword?: boolean | null;
} | null | undefined;

/**
 * ★★★ *"Phiên này có bị KHOÁ vào màn đổi mật khẩu không?"*
 *
 * ⚠⚠ **Chưa biết ⇒ KHÔNG khoá.** `auth.me` chưa về (hoặc trả `null`) thì `mustChangePassword` là
 *    `undefined`, và ta **không** khoá: khoá lúc chưa biết sẽ nhốt cả người **chưa đăng nhập** vào
 *    một màn cần phiên, tức một vòng lặp không lối ra. Chiều an toàn ở đây do **máy chủ** giữ —
 *    `chanKhiPhaiDoiMatKhau` từ chối mọi thủ tục, nên một khoảnh khắc client "chưa biết" **không**
 *    mở được dữ liệu nào. Client khoá **điều hướng**; máy chủ khoá **dữ liệu**. Hai lớp, hai việc.
 * ⚠ `!== true` (không phải `Boolean(...)`) để một giá trị lạ từ dây (chuỗi `"true"`, số `1`) không
 *   lặng lẽ được coi là "phải đổi".
 */
export function phaiKhoaVaoManDoiMatKhau(nguoiDung: NguoiDungCuaCong): boolean {
  if (!nguoiDung) return false;
  if (nguoiDung.mustChangePassword !== true) return false;
  return biChanBoiCongDoiMatKhau(nguoiDung.role, true);
}
