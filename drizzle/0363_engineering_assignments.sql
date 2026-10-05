-- ════════════════════════════════════════════════════════════════════════════
-- 0363 — doc 81 Đợt 3 Task 4: HỘP VIỆC "CỦA TÔI" theo người được giao (`engineering_assignments`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: Hub Kỹ thuật chỉ có "Chờ duyệt (tôi có quyền)" và "Toàn module" — không thực thể Kỹ thuật nào
--   mang người được giao, nên "của tôi" không lọc được. Quyết định chủ dự án QĐ-3a (2026-10-05): MỘT bảng
--   chung, KHÔNG thêm cột vào bảng nghiệp vụ (ECN, recipe, interlock rule, changeover, orchestration run) —
--   một migration, mở rộng dễ, mọi `select().from(<bảng nghiệp vụ>)` không đổi.
--
-- NGỮ NGHĨA: một hàng = mục (`entity_type`, `entity_id`) được giao cho `assignee_user_id` bởi `assigned_by`.
--   • Danh sách loại hợp lệ nằm ở ĐÚNG MỘT chỗ: `shared/engineeringAssignment.ts` (`ASSIGNABLE_ENTITY_TYPES`) —
--     server kiểm bằng zod enum trên chính danh sách ấy. KHÔNG lặp lại thành CHECK ở đây (hai nguồn sẽ lệch).
--   • Tối đa MỘT phân công `active` cho mỗi mục — chỉ mục duy nhất CÓ ĐIỀU KIỆN (partial unique index).
--     Bỏ giao / giao lại = `active = false` trên hàng cũ (lịch sử giữ nguyên, không xoá).
--   • Được giao ≠ được duyệt: bảng này KHÔNG được bất kỳ cổng duyệt / maker-checker nào đọc.
--   • KHÔNG khoá ngoại tới `users`/bảng nghiệp vụ (cùng khuôn `notifications.userId`, `engineering_changes.
--     requestedBy`): người dùng/thực thể được kiểm ở tầng ứng dụng lúc giao; xoá một user hay một recipe
--     không bị một dòng lịch sử phân công chặn lại.
--
-- QUYỀN `avi_app`: SELECT + INSERT + UPDATE CHỈ cột `active` (quyền mức CỘT). KHÔNG DELETE/TRUNCATE và
--   không sửa được người được giao / người giao / thời điểm của một hàng đã ghi — đổi người = hàng MỚI.
--
-- ⚠ DDL chạy bằng owner `aoi` (`avi_app` → 42501): `node scripts/apply-migration-0363.mjs --test-only`
--   (dev: `--dev-only`, do chủ dự án quyết).
-- ⚠ Repo CẤM `drizzle-kit push/generate` — bảng khai TAY vào `drizzle/schema/engineeringAssignment.ts` cùng lượt.
-- ROLLBACK: DROP TABLE IF EXISTS "engineering_assignments";
--
CREATE TABLE IF NOT EXISTS "engineering_assignments" (
  "id" serial PRIMARY KEY,
  "entity_type" varchar(32) NOT NULL,
  "entity_id" integer NOT NULL,
  "assignee_user_id" integer NOT NULL,
  "assigned_by" integer NOT NULL,
  "assigned_at" timestamp NOT NULL DEFAULT now(),
  "note" text,
  "active" boolean NOT NULL DEFAULT true
);
-- Hộp "của tôi": tìm mọi phân công đang hiệu lực của MỘT người.
CREATE INDEX IF NOT EXISTS "idx_engineering_assignments_assignee_active"
  ON "engineering_assignments" ("assignee_user_id", "active");
-- Mỗi mục tối đa MỘT phân công active (đua hai lượt giao ⇒ lượt sau 23505 ⇒ CONFLICT ở ứng dụng).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_engineering_assignments_one_active"
  ON "engineering_assignments" ("entity_type", "entity_id") WHERE "active";
COMMENT ON TABLE "engineering_assignments" IS
  'doc 81 Dot 3 Task 4 (QD-3a): nguoi duoc giao cho muc cho duyet Ky thuat. Duoc giao KHONG cap quyen duyet.';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    -- REVOKE tường minh: default ACL của dev cấp ĐỦ quyền cho avi_app (0357 đo 2026-09-15) — chỉ GRANT
    -- thì "không xoá / chỉ đổi active" là lời khai, không phải sự thật.
    REVOKE UPDATE, DELETE, TRUNCATE ON "engineering_assignments" FROM avi_app;
    GRANT SELECT, INSERT ON "engineering_assignments" TO avi_app;
    GRANT UPDATE ("active") ON "engineering_assignments" TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE "engineering_assignments_id_seq" TO avi_app;
  END IF;
END $$;
