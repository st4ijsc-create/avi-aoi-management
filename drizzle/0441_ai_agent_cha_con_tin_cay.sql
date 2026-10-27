-- ★★★ Đợt 11.8 · T5 (2026-10-27) — SỔ KIỂM TOÁN CHA–CON của agent con + BẢNG TIN CẬY định nghĩa agent.
--
-- ⚠⚠ DDL ⇒ PHẢI CHẠY BẰNG OWNER `aoi` (`node scripts/apply-migration-0441.mjs --test-only | --dev-only | --both`).
--    DEV chỉ sau khi dieu-phoi duyệt SQL. Idempotent.
--
-- (1) `ai_agent_runs` — mỗi lượt con là MỘT hàng sổ riêng (id riêng, cùng userId/projectId), nối cha bằng "parentRunId":
--     parentRunId : lượt cha. KHOÁ NGOẠI KÉP ("parentRunId","userId") → ai_agent_runs(id,"userId") ⇒ con LUÔN cùng chủ với cha ở tầng CSDL.
--     depth       : 0 = lượt gốc, 1–2 = con/cháu; CHECK (parentRunId IS NULL) = (depth = 0).
--     agentName   : tên agent con (^[a-z][a-z0-9-]{0,31}$); agentSource: 'dungSan' | 'tuRepo' (nhãn nguồn bất biến, đi theo mọi thẻ duyệt).
--     Xoá lượt cha cascade xuống con (chỉ xảy ra khi xoá tài khoản — sổ không có đường xoá tay).
--
-- (2) `ai_agent_def_trust` — TIN-LẦN-ĐẦU theo BĂM (M2a): định nghĩa agent từ repo chỉ được `delegate` dùng khi NGƯỜI này đã xác nhận
--     đúng băm nội dung hiện tại cho dự án này. Khoá (userId, projectId, agentName, contentHash). Mọi truy vấn lọc userId (tầng dữ liệu).
--     Tin cậy của A KHÔNG áp cho B. Đổi nội dung ⇒ băm khác ⇒ không còn khớp ⇒ hỏi lại. Có thủ tục gỡ tin cậy (DELETE).

ALTER TABLE public.ai_agent_runs
  ADD COLUMN IF NOT EXISTS "parentRunId" uuid        NULL,
  ADD COLUMN IF NOT EXISTS "depth"       smallint    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "agentName"   varchar(32) NULL,
  ADD COLUMN IF NOT EXISTS "agentSource" varchar(8)  NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_agent_runs_id_user') THEN
    ALTER TABLE public.ai_agent_runs ADD CONSTRAINT uq_ai_agent_runs_id_user UNIQUE (id, "userId");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_agent_runs_parent_same_user') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT fk_ai_agent_runs_parent_same_user
      FOREIGN KEY ("parentRunId", "userId") REFERENCES public.ai_agent_runs (id, "userId") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_depth') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_depth CHECK ("depth" BETWEEN 0 AND 2 AND (("parentRunId" IS NULL) = ("depth" = 0)) AND ("parentRunId" IS NULL OR "parentRunId" <> id));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_agent') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_agent CHECK (
        ("agentName" IS NULL AND "agentSource" IS NULL)
        OR ("agentName" ~ '^[a-z][a-z0-9-]{0,31}$' AND "agentSource" IN ('dungSan', 'tuRepo'))
      );
  END IF;
  -- con luôn có tên + nguồn agent; lượt gốc không có
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_con_co_agent') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_con_co_agent CHECK (("parentRunId" IS NULL) = ("agentName" IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_agent_runs_parent_idx ON public.ai_agent_runs ("parentRunId") WHERE "parentRunId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.ai_agent_def_trust (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"      integer     NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "projectId"   varchar(64) NOT NULL,
  "agentName"   varchar(32) NOT NULL,
  "contentHash" char(64)    NOT NULL,
  "confirmedAt" timestamp   NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_agent_def_trust_key') THEN
    ALTER TABLE public.ai_agent_def_trust
      ADD CONSTRAINT uq_ai_agent_def_trust_key UNIQUE ("userId", "projectId", "agentName", "contentHash");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_def_trust_project_id') THEN
    ALTER TABLE public.ai_agent_def_trust ADD CONSTRAINT chk_ai_agent_def_trust_project_id CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_def_trust_name') THEN
    ALTER TABLE public.ai_agent_def_trust ADD CONSTRAINT chk_ai_agent_def_trust_name CHECK ("agentName" ~ '^[a-z][a-z0-9-]{0,31}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_def_trust_hash') THEN
    ALTER TABLE public.ai_agent_def_trust ADD CONSTRAINT chk_ai_agent_def_trust_hash CHECK ("contentHash" ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_agent_def_trust_owner_idx ON public.ai_agent_def_trust ("userId", "projectId", "agentName");

-- `avi_app` cần DML trên bảng mới (do `aoi` sở hữu). KHÔNG TRUNCATE/REFERENCES/TRIGGER (khuôn 0333/0390).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_def_trust TO avi_app;
  END IF;
END $$;
