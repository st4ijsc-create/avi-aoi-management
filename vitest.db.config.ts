/**
 * Nhóm DB của lưới trước gộp (scripts/luoi-truoc-gop.mjs): MỌI `*.db.test.ts` chạy MỘT TỆP MỘT LẦN.
 *
 * Vì sao: các tệp `.db.test.ts` ghi/dọn trên DB `_test` DÙNG CHUNG và mỗi worker giữ ít nhất một kết nối. Khi cả lô chạy song song
 * (vitest mặc định = số lõi) đo được ba loại đỏ-theo-TẢI, đều xanh khi chạy riêng: (1) "remaining connection slots are reserved
 * for roles with the SUPERUSER attribute" (cụm PG 5434 hết kết nối); (2) "Failed query …" khi hai tệp dọn/ghi chồng lên cùng
 * bảng; (3) quá thời gian vì tranh tài nguyên. Chạy tuần tự nhóm này loại cả ba tại gốc mà KHÔNG nới ngưỡng nào của sản phẩm.
 *
 * Dùng:   npx vitest run --config vitest.db.config.ts [bộ lọc…]
 * Lô thường (không DB) của script:   npx vitest run --exclude "**\/*.db.test.ts" [bộ lọc…]
 *
 * ⚠ KHÔNG `singleFork`: `vitest.setup.ts` suy URL `_test` từ env của tiến trình theo từng tệp (cùng lý do với vitest.serial.config.ts).
 * ⚠ 7 tệp của `vitest.serial.config.ts` (E2E/DDL đổi trạng thái dùng chung hàng phút) vẫn bị loại khỏi nhóm này — chúng có cấu hình riêng.
 */
import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";
import { SERIAL_SUITES } from "./vitest.serial.config";

const merged = mergeConfig(base, defineConfig({ test: { fileParallelism: false } }));
export default {
  ...merged,
  test: {
    ...merged.test,
    include: ["server/**/*.db.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", ...SERIAL_SUITES],
  },
};
