/**
 * ★ Pha 7 Task 9 / R2 — khai kiểu cho **phần MODULE** của `scripts/xoay-bi-mat-2fa.mjs`.
 *
 * Script ấy vừa là kịch bản vừa là module: cổng nguồn (`loiCuaNguonBiMat`) phải **cưỡng chế được
 * bằng một ca test** (`server/_core/xoayBiMatNguon.test.ts`), không chỉ bằng một lượt đọc mã.
 * Không có file này thì `npm run check:tests` báo `TS7016` — và lượt sửa "tiện tay" là thêm
 * `// @ts-ignore`, tức tắt kiểm kiểu ở đúng chỗ cần nó nhất.
 *
 * ⚠ CHỈ khai những gì được `export` — phần `main()` cố ý **không** nằm trong mặt tiếp xúc.
 */

/** Bảng giữ bí mật 2FA **đang được mã dùng** (migration `0314`). */
export declare const BANG_NGUON_BI_MAT: string;

/**
 * Cổng nguồn: `null` = mọi thứ khớp; một **chuỗi lỗi** = script đang trỏ nhầm chỗ và **phải dừng**.
 * @param doDuoc `coBangNguon` — bảng nguồn có tồn tại không;
 *               `soHangLechNguon` — số tài khoản còn bí mật ở cột CŨ mà thiếu hàng ở bảng nguồn.
 */
export declare function loiCuaNguonBiMat(doDuoc: {
  coBangNguon: boolean;
  soHangLechNguon: number;
}): string | null;
