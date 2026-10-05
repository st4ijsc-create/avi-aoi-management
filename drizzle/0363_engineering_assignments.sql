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
--   (dev: `--dev-only`, do chủ dự án quyết; không cờ ⇒ script TỪ CHỐI chạy — R-3-g).
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
  "active" boolean NOT NULL DEFAULT true,
  "pending_episode" varchar(160) NOT NULL DEFAULT ''
);
-- Fix round 1 (R-3-f, 2026-10-05) — khoá ĐỢT CHỜ DUYỆT lúc giao: phân công chỉ "sống" khi mục còn chờ duyệt VÀ khoá đợt
-- hiện tại của mục BẰNG khoá này (lọc lười ở tầng ứng dụng, xem assignmentService.ts#EPISODE_SQL). Mục rời chờ duyệt rồi
-- quay lại ⇒ đợt mới ⇒ người được giao cũ KHÔNG thấy lại. ADD COLUMN IF NOT EXISTS: _test đã áp bản đầu của 0363.
ALTER TABLE "engineering_assignments" ADD COLUMN IF NOT EXISTS "pending_episode" varchar(160) NOT NULL DEFAULT '';
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

-- ════════════════════════════════════════════════════════════════════════════
-- Fix round 2 (2026-10-05) — ĐỢT CHỜ DUYỆT của orchestration run phải TĂNG ở MỌI lần run VÀO held/awaiting_confirm,
-- không chỉ khi đổi bước. Resume giữ nguyên `currentStepId` (foeEngine.ts claimPausedRun), và cả `rehydrateInterrupted
-- Runs` lúc khởi động lẫn edge coordinator đều giữ run lại ĐÚNG bước cũ ⇒ khoá theo bước làm phân công cũ SỐNG LẠI.
-- Không có sổ sự kiện chỉ-ghi-thêm nào của run (`orchestration_run_steps` là upsert "latest wins") ⇒ một BỘ ĐẾM
-- `pending_epoch` do TRIGGER tăng: MỘT cơ chế ở CSDL bắt mọi đường ghi (engine, rehydrate, edge, SQL tay) — không móc
-- vào từng đường của engine.
--   • tăng khi status đổi TỪ một trạng thái KHÔNG chờ (queued/running/…) SANG held | awaiting_confirm;
--   • held ⇄ awaiting_confirm và cập nhật giữ nguyên status: KHÔNG tăng.
-- Cột KHÔNG khai vào drizzle schema (`select().from(orchestrationRuns)` trên DB chưa áp 0363 sẽ hỏng toàn bộ
-- orchestration — lý do 0361); chỉ `assignmentService.ts#EPISODE_SQL` đọc nó bằng SQL thô.
-- ROLLBACK: DROP TRIGGER IF EXISTS "trg_orchestration_runs_pending_epoch" ON "orchestration_runs";
--           DROP FUNCTION IF EXISTS "orchestration_runs_bump_pending_epoch"();
--           ALTER TABLE "orchestration_runs" DROP COLUMN IF EXISTS "pending_epoch";
ALTER TABLE "orchestration_runs" ADD COLUMN IF NOT EXISTS "pending_epoch" integer NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION "orchestration_runs_bump_pending_epoch"() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF NEW.status::text IN ('held', 'awaiting_confirm') AND OLD.status::text NOT IN ('held', 'awaiting_confirm') THEN
    NEW.pending_epoch := OLD.pending_epoch + 1;
  END IF;
  RETURN NEW;
END
$fn$;
DROP TRIGGER IF EXISTS "trg_orchestration_runs_pending_epoch" ON "orchestration_runs";
CREATE TRIGGER "trg_orchestration_runs_pending_epoch"
  BEFORE UPDATE OF "status" ON "orchestration_runs"
  FOR EACH ROW EXECUTE FUNCTION "orchestration_runs_bump_pending_epoch"();
