/**
 * ★★★ Pha 7 Task 9 / **R2** — **CỔNG NGUỒN của mọi kịch bản chạm bí mật 2FA.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỚP LỖI MÀ MODULE NÀY ĐÓNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `scripts/xoay-bi-mat-2fa.mjs` chạy SQL **thô**. Bản trước Task 9 viết
 * `UPDATE users SET two_factor_secret = NULL`. Sau khi (9c) chuyển hạt giống TOTP sang
 * **`user_secrets`** mà cột cũ **còn trên `users`** (cửa sổ giữa `0314` và `0315`), câu ấy:
 *   · chạy **THÀNH CÔNG**,  · in *"✔ Đã xoay N tài khoản"*,
 *   · và **KHÔNG xoay bí mật đang được dùng** — 2FA của mọi người vẫn chạy bằng hạt giống **ĐÃ
 *     LỘ**, còn ảnh chụp hoàn tác thì chụp một **bản chết**.
 * Không mã lỗi, không dòng log sai. Người vận hành đọc *"đã xoay"* rồi **đóng hồ sơ**.
 * Đúng lớp Critical của Pha 3 (*"giết nhầm tiến trình rồi báo cáo thành công"*).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO LUẬT NÀY Ở MỘT FILE RIÊNG, KHÔNG NẰM TRONG CHÍNH KỊCH BẢN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu đặt `loiCuaNguonBiMat()` **trong** `xoay-bi-mat-2fa.mjs` và cho ca test `import` thẳng
 * từ đó. **Đo được ở Bước 7:** vitest **KHÔNG NẠP NỔI** một file `.mjs` có **shebang**
 * (`#!/usr/bin/env node`) — nó ném `SyntaxError: Invalid or unexpected token` **tại điểm import**.
 * ⚠⚠ Và nguy hơn: lượt chạy đầu **XANH** (do bản dịch còn trong cache của vite), rồi mới đỏ ở lượt
 *    sau — tức lưới **xanh vì một lý do không liên quan tới thứ nó canh**. Bằng chứng có đối chứng:
 *    bỏ đúng dòng shebang ⇒ vitest nạp được ngay; trả lại ⇒ đỏ lại.
 * ⇒ Luật sống ở **file không shebang** này; kịch bản `import` nó. Một chủ, hai người dùng
 *   (kịch bản + lưới), **không bản sao nào để trôi**.
 */

/** Bảng giữ bí mật 2FA **đang được mã dùng** (Pha 7 Task 9, migration `0314`). */
export const BANG_NGUON_BI_MAT = "user_secrets";

/**
 * ★★★ Trả về `null` khi nguồn khớp; trả về một **CÂU LỖI** khi không — và khi ấy người gọi **phải
 * dừng với mã thoát ≠ 0**.
 *
 * Hai điều kiện, cả hai đều là *"nếu sai thì kịch bản đang trỏ nhầm chỗ"*:
 *  1. bảng nguồn **tồn tại** — không có nó thì mọi câu `UPDATE` chạm một cột đã chết;
 *  2. **KHÔNG** tài khoản nào còn bí mật ở cột CŨ trên `users` mà lại **thiếu** hàng ở bảng nguồn
 *     — tình huống ấy nghĩa là dữ liệu chưa được chép sang, nên xoay bây giờ sẽ để lại một bí mật
 *     **vẫn dùng được** ở chỗ kịch bản không nhìn tới.
 *
 * ⚠⚠ **KHAI RÕ, ĐỪNG ĐỂ THÀNH MỘT LƯỚI RỖNG IM LẶNG:** từ khi migration `0315` áp (2026-08-09),
 *   cột cũ **không còn tồn tại**, nên `doNguonBiMat()` trả `soHangLechNguon = 0` **theo cấu tạo**
 *   và điều kiện (2) **không bao giờ bắt được gì nữa** trên một DB đã áp `0315`.
 *   Nó **không** vì thế mà thành vô dụng — và cũng **không** phải một lỗ:
 *     · nó vẫn canh **DB CHƯA áp `0315`** (bản sao, môi trường cũ, DB khôi phục từ sao lưu);
 *     · trên DB **đã áp**, chính bất biến ấy được cưỡng chế **mạnh hơn** — bởi Postgres: mọi câu
 *       SQL chạm `users.two_factor_secret` ném **`42703`**, tức *"hỏng ỒN ÀO"* thay vì
 *       *"thành công im lặng"*. Điều kiện (1) vẫn là điều kiện **thật sự** đang canh.
 *
 * @param {{coBangNguon: boolean, soHangLechNguon: number}} doDuoc
 * @returns {string | null}
 */
export function loiCuaNguonBiMat({ coBangNguon, soHangLechNguon }) {
  if (!coBangNguon) {
    return (
      `DỪNG: không thấy bảng \`${BANG_NGUON_BI_MAT}\` trong DB này.\n` +
      `  Bí mật 2FA đang được mã đọc từ bảng ấy (Pha 7 Task 9 / migration 0314).\n` +
      `  Chạy tiếp sẽ UPDATE một cột ĐÃ CHẾT trên \`users\`, in "đã xoay N tài khoản",\n` +
      `  và KHÔNG xoay gì cả — đúng lớp lỗi "làm hỏng rồi BÁO CÁO THÀNH CÔNG".`
    );
  }
  if (soHangLechNguon > 0) {
    return (
      `DỪNG: ${soHangLechNguon} tài khoản còn bí mật ở cột CŨ trên \`users\` mà THIẾU hàng ở ` +
      `\`${BANG_NGUON_BI_MAT}\`.\n  Dữ liệu chưa được chép sang ⇒ xoay bây giờ để lại một bí mật ` +
      `VẪN DÙNG ĐƯỢC ở chỗ kịch bản không nhìn tới.\n  Chạy lại migration 0314 (câu INSERT … SELECT) trước.`
    );
  }
  return null;
}
