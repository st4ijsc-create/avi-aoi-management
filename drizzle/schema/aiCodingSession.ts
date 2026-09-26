/**
 * ★★★ doc 79 · DANH SÁCH PHIÊN — bảng `ai_coding_sessions`, migration `0333`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CSDL CHỨ KHÔNG PHẢI `localStorage` — VÀ VÌ SAO ĐÓ **KHÔNG** LÀ LỰA CHỌN "AN TOÀN HƠN"
 * MỘT CÁCH HIỂN NHIÊN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `localStorage` nghe như "0 bề mặt server ⇒ 0 rủi ro". Đo lại thì ngược:
 *
 *   • `localStorage` gắn với **ORIGIN**, KHÔNG gắn với **NGƯỜI DÙNG**. Trên một máy trạm xưởng
 *     dùng chung — khuôn mặc định của hệ này — kỹ sư A đăng xuất, kỹ sư B đăng nhập trên cùng hồ
 *     sơ trình duyệt và **đọc được toàn bộ phiên của A**. Không tầng nào chặn được: không có
 *     phiên đăng nhập nào tham gia vào phép đọc ấy.
 *   • Nội dung một phiên là **mã nguồn repo** + **diff đề xuất** — đúng thứ mà bit RBAC
 *     `ai_repo_read` tồn tại để canh. Để nó nằm ngoài mọi phép kiểm quyền là **vô hiệu hoá bit ấy
 *     sau lượt đầu tiên**: một tài khoản KHÔNG có `ai_repo_read` vẫn đọc được mã nguồn mà người
 *     trước đã kéo về máy.
 *   • `sessionStorage` thì mất khi đóng tab ⇒ một "danh sách phiên" không sống qua nổi một lượt
 *     tải lại trang, tức không phải tính năng được yêu cầu.
 *
 * ⇒ CSDL, và **hàng rào là QUYỀN SỞ HỮU** (`userId`), không phải tenant:
 *
 *   ┌──────────────────────────────────────────────────────────────────────────────────────────┐
 *   │  AI ĐỌC ĐƯỢC PHIÊN CỦA AI:  **CHỈ CHỦ PHIÊN.** Không vai nào khác, KỂ CẢ `admin`.        │
 *   └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠⚠ VÌ SAO **KHÔNG** DÙNG RLS/TENANT CHO BẢNG NÀY — và đây là một phép đo, không phải sở thích:
 *   • Đợt 0327-0329 đo được `TENANT_RLS_ENABLED=true` mà `runWithTenantScope` có **0 nơi gọi
 *     trong mã sản xuất** ⇒ RLS ở tầng CSDL **nằm im**. Một bảng dựa vào nó là một bảng **không
 *     có hàng rào nào** kèm một tờ giấy chứng nhận vô can.
 *   • Và kể cả RLS chạy, tenant là **SAI TRỤC** cho dữ liệu này: kỹ sư A và kỹ sư B cùng một nhà
 *     máy ⇒ cùng tenant ⇒ RLS cho qua. Câu hỏi cần trả lời là *"A đọc được phiên của B không"*,
 *     và phạm vi trả lời được câu ấy là **chủ sở hữu**, không phải nhà máy.
 *   ⇒ Hàng rào nằm trong **chính mệnh đề WHERE** của mọi truy vấn (`server/db/aiCodingSessions.ts`),
 *     với `userId` lấy từ `ctx.user.id` của phiên đăng nhập — **KHÔNG BAO GIỜ từ `input`**.
 *     `aiCodingSessionScope.test.ts` đo điều đó trên CSDL THẬT (hai tài khoản, hai chiều).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ BẢNG NÀY **KHÔNG MỞ MỘT QUYỀN NÀO MỚI.** Không có `moduleName` mới, không migration quyền.
 *   Tuyến đọc/ghi phiên đòi đúng bit đã có: `ai_repo_read/canView` (mig 0330) — cùng bit đang canh
 *   `read_file`/`list_files`/`grep_repo`. Ai không đọc được mã nguồn thì cũng không đọc được một
 *   bản ghi chép của việc đọc mã nguồn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HAI RÀNG BUỘC CHECK Ở TẦNG CSDL (xem `drizzle/0333_ai_coding_sessions.sql`) — chúng KHÔNG
 *   được khai ở đây vì drizzle-kit không sinh `CHECK` cho bảng này, nên chúng sống trong file SQL
 *   viết tay và được lưới `aiCodingSessionScope.test.ts` §4 đo LẠI trên CSDL thật:
 *     1. `"projectId" ~ '^[A-Za-z0-9_-]{1,64}$'` — **một đường dẫn KHÔNG lưu được vào cột này.**
 *        `D:\SOURCES\…` có `:` và `\`; `/etc/passwd` có `/`; `..` có `.`. Cả ba đều bị CSDL từ
 *        chối, kể cả khi ai đó vòng qua tRPC và INSERT thẳng. Đây là lớp cuối của bất biến
 *        "client gửi ID, không gửi đường dẫn".
 *     2. `jsonb_typeof(turns) = 'array'` — cầu chì chống một hàng `turns` là object/scalar làm
 *        `locLuot()` phải đoán.
 */
import { pgTable, uuid, integer, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Một **mạch hội thoại tác nhân lập trình** trên MỘT dự án, thuộc về MỘT người.
 *
 * ⚠ `turns` là `jsonb` chứa **đúng** `[{role, content}, …]` — xem bất biến số một ở
 *   `shared/aiCodingSession.ts`. Cả cửa GHI lẫn cửa ĐỌC đều đi qua `locLuot()`, nên một hàng bị
 *   đầu độc bằng SQL thẳng (nhét `actionId`/`token` vào một lượt) vẫn **không phát ra được** một
 *   thẻ duyệt: phép chiếu ở cửa đọc dựng object MỚI từ hai ô.
 *
 * ⚠ Vì sao MỘT bảng + `jsonb` chứ không hai bảng (phiên/lượt): đường đọc **luôn là cả mạch** (mở
 *   một phiên = hiện toàn bộ hội thoại), không có truy vấn nào cần lọc theo lượt. Hai bảng sẽ
 *   thêm một FK, một thứ tự `seq` phải tự giữ đúng, và một cửa xoá thứ hai — ba bề mặt cho 0 câu
 *   truy vấn mới. Kích thước hàng bị chặn cứng bởi `GIOI_HAN_PHIEN.BYTE_CA_PHIEN` (400 KB) và
 *   Postgres TOAST/nén phần vượt.
 */
export const aiCodingSessions = pgTable(
  "ai_coding_sessions",
  {
    /** Server sinh (`crypto.randomUUID`). Client KHÔNG BAO GIỜ tự đặt id. */
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * ★★★ CHỦ PHIÊN — **hàng rào**. Luôn lấy từ `ctx.user.id`; `ON DELETE CASCADE` để xoá một tài
     * khoản là xoá sạch phiên của họ (không để lại mạch hội thoại mồ côi mang mã nguồn).
     */
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ID dự án trong danh sách TRẮNG `.env` — **KHÔNG BAO GIỜ là đường dẫn** (CHECK ở 0333). */
    projectId: varchar("projectId", { length: 64 }).notNull(),
    /** Nhãn tự sinh từ câu hỏi đầu. `''` ⇒ giao diện hiện nhãn mặc định qua `t()` ba locale. */
    title: varchar("title", { length: 200 }).notNull().default(""),
    /** `[{role, content}, …]` — xem bất biến số một. */
    turns: jsonb("turns").notNull().default([]),
    /** Đếm sẵn để danh sách không phải đọc cả `turns` của mọi phiên. */
    turnCount: integer("turnCount").notNull().default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Đúng hình dạng câu truy vấn danh sách: (chủ phiên × dự án) sắp theo lần sửa gần nhất.
    index("ai_coding_sessions_owner_idx").on(table.userId, table.projectId, table.updatedAt),
  ],
);

export type AiCodingSession = typeof aiCodingSessions.$inferSelect;
export type InsertAiCodingSession = typeof aiCodingSessions.$inferInsert;
