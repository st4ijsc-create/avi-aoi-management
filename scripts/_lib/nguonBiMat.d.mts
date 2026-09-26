/**
 * ★ Pha 7 Task 9 / R2 — khai kiểu cho `scripts/_lib/nguonBiMat.mjs`.
 *
 * Không có file này thì `npm run check:tests` báo `TS7016` ở
 * `server/_core/xoayBiMatNguon.test.ts`, và lượt sửa "tiện tay" là thêm `// @ts-ignore` — tức tắt
 * kiểm kiểu ở đúng chỗ cần nó nhất.
 */

/** Bảng giữ bí mật 2FA **đang được mã dùng** (migration `0314`). */
export declare const BANG_NGUON_BI_MAT: string;

/**
 * Cổng nguồn: `null` = mọi thứ khớp; một **chuỗi lỗi** = kịch bản đang trỏ nhầm chỗ và **phải dừng**.
 * @param doDuoc `coBangNguon` — bảng nguồn có tồn tại không;
 *               `soHangLechNguon` — số tài khoản còn bí mật ở cột CŨ mà thiếu hàng ở bảng nguồn.
 */
export declare function loiCuaNguonBiMat(doDuoc: {
  coBangNguon: boolean;
  soHangLechNguon: number;
}): string | null;
