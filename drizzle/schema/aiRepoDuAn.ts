/**
 * ★★★ QUẢN LÝ DỰ ÁN — bảng `ai_repo_du_an`, migration `0337`: dự án hộp cát ĐĂNG KÝ QUA UI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * HAI NGUỒN, MỘT CHỦ — và bảng này là nguồn PHỤ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Danh sách trắng dự án có hai nguồn: `.env` (`AI_REPO_SANDBOX_ROOTS`, có từ doc 79) và bảng này
 * (đăng ký qua UI, admin-only). Chủ DUY NHẤT của phép hợp nhất là
 * `server/services/aiLocalTools/repoProjects.ts` — mọi nơi khác (tRPC, chat, CLI, MCP) chỉ hỏi
 * `danhSachDuAn()`/`gocTheoId()`. Luật hợp nhất, ghi thành lời để không ai đoán:
 *   • **env THẮNG** khi trùng `id` (và lượt đăng ký trùng id với env bị TỪ CHỐI ngay từ đầu);
 *   • mục env KHÔNG xoá được qua UI — bảng này chỉ THÊM dự án, không che dự án nào.
 *
 * ⚠⚠ BẤT BIẾN TRỤC 2 KHÔNG ĐỔI: client vẫn CHỈ gửi `id` cho mọi lượt thực thi tool. Cột `goc` ở
 *   đây do một ADMIN (2FA) khai qua mutation đăng ký — cùng mức tin cậy với admin sửa `.env` —
 *   và đã qua xác thực fail-closed (`kiemTraDangKyDuAn`) TRƯỚC khi chạm bảng.
 *
 * ⚠ HAI RÀNG BUỘC CHECK sống trong file SQL viết tay (drizzle-kit không sinh CHECK cho bảng này):
 *   `chk_ai_repo_du_an_id` (id đúng khuôn `[A-Za-z0-9_-]{1,64}` — một đường dẫn KHÔNG lưu được
 *   vào cột id) và `chk_ai_repo_du_an_ten` (tên 1..100, cấm `#;=|` — để mục DB còn xuất ngược ra
 *   env được). Lưới `quanLyDuAnRepo.test.ts` đo lại trên CSDL thật.
 */
import { pgTable, varchar, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Một dự án hộp cát nguồn DB. `nguoiTao` CỐ Ý không FK → users: dự án là CẤU HÌNH hạ tầng —
 * CASCADE sẽ làm cấu hình bốc hơi theo tài khoản, RESTRICT thì chặn xoá tài khoản vì một hàng
 * cấu hình. Cột chỉ để truy vết; audit đầy đủ nằm ở `audit_logs` (`logCrudOperation`).
 */
export const aiRepoDuAn = pgTable("ai_repo_du_an", {
  /** id ổn định — thứ DUY NHẤT client gửi khi thực thi tool (CHECK khuôn ở 0337). */
  id: varchar("id", { length: 64 }).primaryKey(),
  /** Tên hiển thị (tiếng Việt có dấu được; cấm `#;=|` — CHECK ở 0337). */
  ten: varchar("ten", { length: 100 }).notNull(),
  /** Gốc TUYỆT ĐỐI đã qua `realpathSync` lúc đăng ký. Chỉ admin thấy lại (thủ tục admin-only). */
  goc: text("goc").notNull(),
  /** userId của admin đã đăng ký — truy vết, KHÔNG FK (xem docblock). */
  nguoiTao: integer("nguoiTao").notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

export type AiRepoDuAn = typeof aiRepoDuAn.$inferSelect;
export type InsertAiRepoDuAn = typeof aiRepoDuAn.$inferInsert;
