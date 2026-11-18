/**
 * P0-3 bước 2 (CSP): zod 4 thăm dò JIT bằng `new Function("")` khi tạo schema object đầu tiên;
 * dưới CSP không có 'unsafe-eval' mỗi lượt tải trang thành 1 báo cáo vi phạm `script-src 'eval'`.
 * `jitless` tắt cả việc thăm dò lẫn đường JIT (zod đọc cờ này lúc TẠO schema) ⇒ phải chạy
 * TRƯỚC mọi module tạo schema: main.tsx import tệp này ĐẦU TIÊN (ESM đánh giá theo thứ tự import).
 * Chỉ client; server không chạy dưới CSP. Không đổi CSP, không thêm 'unsafe-eval'.
 */
import { z } from "zod";

z.config({ jitless: true });
