-- ★★★ Đợt 11.8 · T5 (2026-10-27) — PHIÊN HỢP NHẤT chat / lập trình / agent, chung web + VS Code.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi` (`node scripts/apply-migration-0440.mjs --test-only | --dev-only | --both`).
--    DEV chỉ sau khi dieu-phoi duyệt SQL. Idempotent (IF NOT EXISTS / DO $$ … pg_constraint).
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- MỞ RỘNG `ai_coding_sessions` (mig 0333) thay vì thêm bảng: cùng phạm vi CHỦ SỞ HỮU (`userId`), cùng phép chiếu `locLuot()`.
-- Không có UNIQUE nào trên (userId, projectId) ⇒ phiên chat/agent không thể đè/trộn phiên lập trình ở tầng ràng buộc;
-- phân biệt bằng cột `kind` (mọi truy vấn của tầng dữ liệu lọc `userId` + `kind`).
--
--   kind            : 'chat' | 'coding' | 'agent'   (mặc định 'coding' ⇒ hàng cũ giữ nghĩa cũ)
--   source          : 'web' | 'vscode'              (phiên tạo từ đâu)
--   runIds          : jsonb mảng uuid — các lượt chạy agent gắn vào phiên (đọc/ghi qua tầng dữ liệu, đã lọc chủ)
--   parentSessionId : phiên cha khi NHÂN BẢN / NỐI TIẾP sau tóm tắt ngữ cảnh 80 %
--   contextPct      : % ngữ cảnh lúc ghi gần nhất (đồng hồ UX-C05)
--   version         : khoá lạc quan cho appendTurns (hai tab ghi song song không mất cập nhật)
--
-- ⚠ HÀNG RÀO CHỦ SỞ HỮU Ở TẦNG CSDL (M8b): `parentSessionId` là khoá ngoại KÉP ("parentSessionId","userId") →
--   ai_coding_sessions(id,"userId") ⇒ CSDL từ chối liên kết sang phiên của NGƯỜI KHÁC dù ai đó INSERT thẳng.
--   Xoá phiên cha chỉ đặt NULL cột parentSessionId (PG ≥ 15 `ON DELETE SET NULL (col)`), không xoá con.
--   `runIds` là mảng jsonb ⇒ CSDL không canh được từng phần tử; tầng dữ liệu kiểm thuộc chính userId lúc GHI và lúc ĐỌC,
--   và `DELETE` phiên KHÔNG đụng `ai_agent_runs` (sổ kiểm toán — M8d).

ALTER TABLE public.ai_coding_sessions
  ADD COLUMN IF NOT EXISTS "kind"            varchar(16) NOT NULL DEFAULT 'coding',
  ADD COLUMN IF NOT EXISTS "source"          varchar(16) NOT NULL DEFAULT 'web',
  ADD COLUMN IF NOT EXISTS "runIds"          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "parentSessionId" uuid        NULL,
  ADD COLUMN IF NOT EXISTS "contextPct"      smallint    NULL,
  ADD COLUMN IF NOT EXISTS "version"         integer     NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_coding_sessions_id_user') THEN
    ALTER TABLE public.ai_coding_sessions ADD CONSTRAINT uq_ai_coding_sessions_id_user UNIQUE (id, "userId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_coding_sessions_parent_same_user') THEN
    ALTER TABLE public.ai_coding_sessions
      ADD CONSTRAINT fk_ai_coding_sessions_parent_same_user
      FOREIGN KEY ("parentSessionId", "userId") REFERENCES public.ai_coding_sessions (id, "userId")
      ON DELETE SET NULL ("parentSessionId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_kind') THEN
    ALTER TABLE public.ai_coding_sessions ADD CONSTRAINT chk_ai_coding_sessions_kind CHECK ("kind" IN ('chat', 'coding', 'agent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_source') THEN
    ALTER TABLE public.ai_coding_sessions ADD CONSTRAINT chk_ai_coding_sessions_source CHECK ("source" IN ('web', 'vscode'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_run_ids_array') THEN
    ALTER TABLE public.ai_coding_sessions
      ADD CONSTRAINT chk_ai_coding_sessions_run_ids_array CHECK (jsonb_typeof("runIds") = 'array' AND jsonb_array_length("runIds") <= 50);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_version') THEN
    ALTER TABLE public.ai_coding_sessions ADD CONSTRAINT chk_ai_coding_sessions_version CHECK ("version" >= 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_context_pct') THEN
    ALTER TABLE public.ai_coding_sessions
      ADD CONSTRAINT chk_ai_coding_sessions_context_pct CHECK ("contextPct" IS NULL OR ("contextPct" >= 0 AND "contextPct" <= 200));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_coding_sessions_parent_not_self') THEN
    ALTER TABLE public.ai_coding_sessions ADD CONSTRAINT chk_ai_coding_sessions_parent_not_self CHECK ("parentSessionId" IS NULL OR "parentSessionId" <> id);
  END IF;
END $$;

-- Hình dạng câu truy vấn danh sách mới: (chủ × loại × dự án) theo lần sửa gần nhất.
CREATE INDEX IF NOT EXISTS ai_coding_sessions_owner_kind_idx
  ON public.ai_coding_sessions ("userId", "kind", "projectId", "updatedAt");
