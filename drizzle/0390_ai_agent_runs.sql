-- ★★★ Đợt 1 · T4 (2026-10-17) — bảng `ai_agent_runs`: LƯỢT CHẠY của vòng agent (`shared/agentCore` chạy phía
-- máy chủ cho trình duyệt). Thiết kế: docs/superpowers/specs/2026-10-14-ai-local-dot1-loi-agent-design.md §4.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0390.mjs --dev-only|--test-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Lượt chạy SỐNG trong bộ nhớ tiến trình (`server/services/ai/agent/quanLyLuotChay.ts`); bảng này là SỔ của nó:
--   • danh sách / chi tiết sau khi lượt chạy rời bộ nhớ (restart, hết thời gian giữ);
--   • boot: hàng còn `dang-chay`/`cho-duyet` ⇒ `gian-doan` (checkpoint của lượt vẫn hoàn tác được);
--   • `suKien` — bản ghi sự kiện ĐÃ GỘP (delta chữ/nghĩ liền nhau gộp một), cắt trần ở tầng ứng dụng.
--
-- PHẠM VI: CHỈ CHỦ LƯỢT CHẠY (`userId`), như `ai_coding_sessions` (mig 0333) — hàng rào nằm trong mệnh đề WHERE
-- của mọi truy vấn (`server/db/aiAgentRuns.ts`). KHÔNG mở quyền mới: tuyến đòi bit đã có `ai_repo_read/canView`
-- (chế độ `tu-dong` + lệnh: `ai_repo_exec`).
--
-- CHECK ở tầng CSDL (Zod canh cửa tRPC/REST; CHECK canh cái bảng — kể cả một cửa ghi thứ hai hay INSERT thẳng):
--   • `projectId` là ID, không phải đường dẫn (cùng hình dạng `RE_ID_DU_AN`);
--   • `cheDo` ∈ {hoi, sua, tu-dong}; `trangThai` ∈ {dang-chay, cho-duyet, xong, huy, loi, gian-doan};
--   • `suKien`, `checkpointIds` là MẢNG jsonb; bộ đếm không âm.
-- KHÔNG có FUNCTION/TRIGGER (`updatedAt` do ứng dụng đặt) ⇒ không có search_path nào phải ghim.
-- Idempotent: IF NOT EXISTS cho bảng/chỉ mục; CHECK thêm qua DO $$ … pg_constraint.

CREATE TABLE IF NOT EXISTS public.ai_agent_runs (
  id              uuid PRIMARY KEY,
  "userId"        integer NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  "projectId"     varchar(64) NOT NULL,
  "cheDo"         varchar(16) NOT NULL,
  "cauHoi"        text NOT NULL,
  "trangThai"     varchar(16) NOT NULL DEFAULT 'dang-chay',
  "lyDoDung"      varchar(32),
  "soLuot"        integer NOT NULL DEFAULT 0,
  "tokenVao"      integer NOT NULL DEFAULT 0,
  "tokenRa"       integer NOT NULL DEFAULT 0,
  "tokenNghi"     integer NOT NULL DEFAULT 0,
  "suKien"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "checkpointIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "tomTat"        text,
  "sessionId"     uuid,
  "createdAt"     timestamp NOT NULL DEFAULT now(),
  "updatedAt"     timestamp NOT NULL DEFAULT now()
);

-- Danh sách của MỘT người theo dự án, mới nhất trước.
CREATE INDEX IF NOT EXISTS ai_agent_runs_owner_idx
  ON public.ai_agent_runs ("userId", "projectId", "createdAt");
-- Lượt quét lúc boot (`dang-chay`/`cho-duyet` ⇒ `gian-doan`) chỉ chạm hàng còn sống.
CREATE INDEX IF NOT EXISTS ai_agent_runs_song_idx
  ON public.ai_agent_runs ("trangThai")
  WHERE "trangThai" IN ('dang-chay', 'cho-duyet');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_project_id') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_project_id CHECK ("projectId" ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_che_do') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_che_do CHECK ("cheDo" IN ('hoi', 'sua', 'tu-dong'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_trang_thai') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_trang_thai
      CHECK ("trangThai" IN ('dang-chay', 'cho-duyet', 'xong', 'huy', 'loi', 'gian-doan'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_mang') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_mang
      CHECK (jsonb_typeof("suKien") = 'array' AND jsonb_typeof("checkpointIds") = 'array');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_agent_runs_dem') THEN
    ALTER TABLE public.ai_agent_runs
      ADD CONSTRAINT chk_ai_agent_runs_dem
      CHECK ("soLuot" >= 0 AND "tokenVao" >= 0 AND "tokenRa" >= 0 AND "tokenNghi" >= 0);
  END IF;
END $$;

-- `avi_app` (vai ứng dụng lúc chạy) cần DML trên bảng mới — do `aoi` sở hữu nên cấp tường minh (khuôn 0333).
-- KHÔNG TRUNCATE/REFERENCES/TRIGGER. `IF EXISTS` để CSDL chưa có vai `avi_app` không sập.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_agent_runs TO avi_app;
  END IF;
END $$;
