/**
 * ★★★ doc 82 · BỘ NHỚ XUYÊN PHIÊN — bảng `ai_coding_lessons`, migration `0336`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MỘT BẢNG RIÊNG CHỨ KHÔNG PHẢI MỘT CỘT CỦA `ai_coding_sessions`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phiên và bài học có **vòng đời ngược nhau**. Một phiên là một MẠCH: nó bắt đầu, kết thúc, và
 * người dùng xoá nó mà không mất gì. Một bài học tồn tại CHÍNH VÌ nó phải sống qua cái chết của
 * phiên sinh ra nó — cất nó trong `turns` là bảo đảm nó biến mất đúng lúc nó cần có mặt. Và một
 * bài học **được đọc ở MỌI phiên** của cùng (người × dự án), tức phạm vi đọc của nó rộng hơn hẳn
 * phạm vi của một hàng phiên.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ AI ĐỌC ĐƯỢC BÀI HỌC CỦA AI: **CHỈ CHỦ SỞ HỮU** — RIÊNG TƯ, y như phiên, kể cả `admin`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Chia sẻ theo đội NGHE HỢP LÝ (cả nhóm cùng học *"dự án này dùng bcryptjs"*) và tôi đã cân nó.
 * Quyết định là **KHÔNG chia sẻ trong lượt này**, vì ba lý do đo được — không phải vì thận trọng
 * chung chung:
 *
 *   1. **Chia sẻ biến bài học thành một kênh TIÊM PROMPT NGANG HÀNG.** Một bài học đi vào **MỌI
 *      prompt sau đó** của người đọc nó. Bảng dùng chung nghĩa là: văn bản do đồng nghiệp B gõ tự
 *      động chạy vào prompt của A, mọi lượt, không ai duyệt. Rủi ro của A với chính A là một
 *      chuyện; mở nó thành rủi ro của B với A là **đổi hạng** mối đe doạ, không phải nới một chút.
 *   2. **Bài học sinh ra TỪ nội dung phiên**, mà phiên đã chốt là riêng tư (doc 79). Một bài học
 *      *"đừng sửa `server/license/license-service.ts` theo cách X"* mang theo mảnh ngữ cảnh của
 *      một phiên riêng tư. Chia sẻ bài học là rò rỉ phiên qua một cửa khác, đúng cái mà trục CHỦ
 *      SỞ HỮU của mig 0333 dựng ra để đóng.
 *   3. **Không tồn tại một trục "đội" trong repo này để mà chia sẻ theo.** Tenant là SAI TRỤC (đo
 *      2026-08-18: A và B cùng nhà máy ⇒ cùng tenant, nên tenant không trả lời được câu *"B ghi
 *      được vào prompt của A không"*), và RLS tầng CSDL **nằm im** (`runWithTenantScope` 0 nơi
 *      gọi). Dựng chia sẻ trên một trục không tồn tại là dựng một hàng rào bằng giấy.
 *
 * ⚠ ĐƯỜNG MỞ VỀ SAU, nói thẳng để người sau không phải đoán: muốn chia sẻ thì thứ phải thêm KHÔNG
 *   phải một cột `scope` — mà là một **cửa DUYỆT** (ai đó có quyền đọc bài học đề xuất, chấp nhận
 *   nó thành bài học của dự án) cộng một trục danh tính đội THẬT. Đó là một bề mặt mới phải canh,
 *   xứng một lượt đánh giá riêng. Cột `scope` mặc định `'user'` mà chưa có cửa duyệt chỉ là một ô
 *   trống mời người sau bật lên mà không đọc khối chú thích này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ BẢNG NÀY **KHÔNG MỞ MỘT QUYỀN NÀO MỚI.** Không `moduleName` mới, không hàng `permissions` nào.
 *   Đường ghi/đọc bài học nằm TRONG phiên lập trình, sau đúng bit đã có `ai_repo_read/canView`
 *   (mig 0330) — ai không mở được không gian làm việc thì không chạm tới được bảng này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BA RÀNG BUỘC Ở TẦNG CSDL (xem `drizzle/0336_ai_coding_lessons.sql`) — chúng canh **cái bảng**,
 *   trong khi zod canh **cửa tRPC**; cái thứ hai vẫn đứng khi có cửa ghi thứ hai hoặc `INSERT` thẳng:
 *     1. `chk_ai_coding_lessons_project_id` — `projectId` phải là **ID**, không phải đường dẫn.
 *        Cùng lớp cuối của bất biến "client gửi ID" như mig 0333.
 *     2. `chk_ai_coding_lessons_risk` — `mucRuiRo` ∈ {`none`,`low`}. **`high` KHÔNG LƯU ĐƯỢC.** Cửa
 *        ghi đã từ chối nó, nhưng một lời từ chối ở tầng ứng dụng là một lời hứa; CHECK là một hàng
 *        rào. Đây là chỗ *"bài học chứa câu ra lệnh nới quyền"* chết lần thứ hai.
 *     3. `ux_ai_coding_lessons_khoa` UNIQUE `(userId, projectId, khoaTrung)` — **bài học trùng
 *        KHÔNG nhân bản được**, kể cả khi hai tab gửi cùng lúc. Yêu cầu ấy nếu chỉ hiện thực bằng
 *        `SELECT` rồi `INSERT` thì là một điều kiện chạy đua; ở đây nó là thuộc tính của cái bảng.
 */
import { pgTable, uuid, integer, varchar, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./auth";

/**
 * Một **bài học** người dùng tự khai, thuộc về MỘT người trên MỘT dự án.
 *
 * ⚠ `noiDung` là **một dòng, đã làm sạch** (`shared/aiCodingLesson.chuanHoaNoiDung` +
 *   `ai/aiSafety.sanitizeUntrustedBlock`). Cột `text` chứ không `varchar(400)`: trần độ dài là một
 *   quyết định của tầng ứng dụng đã có lưới canh, và một `varchar` chật hơn trần ấy chỉ đẻ ra một
 *   lượt ném `22001` ở chỗ đáng lẽ là một lượt cắt đã đo.
 */
export const aiCodingLessons = pgTable(
  "ai_coding_lessons",
  {
    /** Server sinh. Client KHÔNG BAO GIỜ tự đặt id. */
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * ★★★ CHỦ SỞ HỮU — **hàng rào**. Luôn từ `ctx.user.id` / `execCtx.user.id`, không bao giờ từ
     * `input`. `ON DELETE CASCADE`: xoá một tài khoản là xoá sạch bài học của họ.
     */
    userId: integer("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ID dự án trong danh sách TRẮNG `.env` — **KHÔNG BAO GIỜ đường dẫn** (CHECK ở 0336). */
    projectId: varchar("projectId", { length: 64 }).notNull(),
    /** Nội dung MỘT DÒNG đã làm sạch. Xem bất biến số một ở `shared/aiCodingLesson.ts`. */
    noiDung: text("noiDung").notNull(),
    /** Khoá chống trùng (thường hoá + bỏ dấu câu hai đầu). Cột UNIQUE cùng (userId, projectId). */
    khoaTrung: text("khoaTrung").notNull(),
    /**
     * Mức rủi ro tiêm prompt ĐO ĐƯỢC lúc ghi (`ai/aiSafety.scanUntrustedContent`). `'none'|'low'`.
     * Lưu để KIỂM TOÁN được — một hàng `low` là một bài học có nhắc tới `system prompt`/`act as`
     * mà vẫn được cho qua, và người vận hành phải nhìn thấy được điều đó mà không phải đoán.
     */
    mucRuiRo: varchar("mucRuiRo", { length: 8 }).notNull().default("none"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    // Đúng hình dạng câu truy vấn đọc: (chủ sở hữu × dự án) sắp theo lần sửa gần nhất.
    index("ai_coding_lessons_owner_idx").on(table.userId, table.projectId, table.updatedAt),
    // ★★★ "TRÙNG ⇒ KHÔNG NHÂN BẢN" thành thuộc tính của BẢNG, không phải của một lượt kiểm tra.
    uniqueIndex("ux_ai_coding_lessons_khoa").on(table.userId, table.projectId, table.khoaTrung),
  ],
);

export type AiCodingLesson = typeof aiCodingLessons.$inferSelect;
export type InsertAiCodingLesson = typeof aiCodingLessons.$inferInsert;
