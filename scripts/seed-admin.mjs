/**
 * ★★★ Pha 7 / review TOÀN NHÁNH **M-1** — **BẪY ĐỌC-ĐƯỢC ĐÃ ĐƯỢC THÁO.**
 *
 * File này **từng** chứa một đường tạo admin `INSERT INTO users (…, passwordHash, …)`. Nó đã hỏng
 * **theo BA cách độc lập**, và cả ba đều đo được:
 *
 *  1. Nó nạp `mysql2/promise` — hệ này chạy **PostgreSQL** (`aoi@127.0.0.1:5434/aoi_management`).
 *  2. `package.json` **không có mục nào** gọi tới nó ⇒ nó chưa từng chạy trong đường đi thật.
 *  3. Từ migration **`0315`**, `users.passwordHash` **KHÔNG CÒN** — hai bí mật đã sang bảng
 *     `user_secrets` (Task 9 / 9c) ⇒ câu `INSERT` ấy nay là `42703` **lúc chạy**.
 *
 * ⚠⚠ Vì sao **không** vá nó cho chạy được: một tài khoản có hàng `users` mà **KHÔNG** có hàng
 *    `user_secrets` là một tài khoản **không đăng nhập được**, và nó sẽ được tạo ra **im lặng**.
 *    Hai câu `INSERT` ấy phải nằm trong **MỘT giao dịch** — và giao dịch ấy **đã có chủ**:
 *    `createLocalUser()` ở `server/db/auth.ts`. Viết bản thứ hai ở đây là dựng lại đúng lớp lỗi
 *    *"nhiều chủ cho một bất biến"*, thứ đã đẻ **ba** Critical trong chuỗi pha này.
 *
 * ⇒ Đường tạo admin **đúng và duy nhất**: `scripts/seed-all-modules.ts` (đi qua `createLocalUser()`).
 */
throw new Error(
  "scripts/seed-admin.mjs ĐÃ BỊ BỎ (Pha 7 / M-1).\n" +
    "· Nó dùng `mysql2` trên một hệ PostgreSQL, không có mục `package.json` nào gọi nó, và cột\n" +
    "  `users.passwordHash` đã bị migration 0315 BỎ (hai bí mật nay ở bảng `user_secrets`).\n" +
    "· Tạo tài khoản chỉ bằng một `INSERT INTO users` sẽ đẻ ra một tài khoản KHÔNG ĐĂNG NHẬP\n" +
    "  ĐƯỢC, im lặng — hàng `user_secrets` phải được ghi trong CÙNG một giao dịch.\n" +
    "⇒ Dùng `scripts/seed-all-modules.ts` (đi qua `createLocalUser()` — chủ duy nhất của lượt tạo).",
);
