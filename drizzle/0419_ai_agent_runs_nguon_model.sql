-- Dot 10.4b L3 (2026-10-30) — dau nguon cho LUOT AGENT may chu chay model NGOAI (hop dong docs/superpowers/plans/2026-10-30-dot10-4b-L3-
-- agent-ngoai-hop-dong.md §3 + §0 dieu-phoi Q2).
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0419.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- ai_agent_runs."nguonModel"   `ngoai:<ncc>:<model>` khi luot chay bang model ngoai — NULL = cuc bo. MAY CHU ghi LUC TAO hang so (INSERT);
--                              CHECK dung CHUNG mau voi 0417 (MAU_NGUON_MODEL, shared/ai/sinhChuNgoai.ts — luoi ghim chuoi).
--                              Model ngoai CHI o che do `hoi` ⇒ CHECK "nguonModel" IS NULL OR "cheDo" = 'hoi'.
--                              BAT BIEN: KHONG doi duoc sau INSERT (trigger BEFORE UPDATE: OLD/NEW khac ⇒ loi 23514) — so luot chay duoc
--                              cap nhat lien tuc (suKien / token / trangThai) nen khong the WORM ca hang; rieng dau nguon thi bat bien.
--
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_ai_agent_runs_nguon_model_bat_bien ON public."ai_agent_runs";
--   DROP FUNCTION IF EXISTS public.ai_agent_runs_nguon_model_bat_bien();
--   ALTER TABLE public."ai_agent_runs" DROP CONSTRAINT IF EXISTS "ai_agent_runs_nguon_model_chk", DROP COLUMN IF EXISTS "nguonModel";

ALTER TABLE public."ai_agent_runs" ADD COLUMN IF NOT EXISTS "nguonModel" varchar(140);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_runs_nguon_model_chk') THEN
    ALTER TABLE public."ai_agent_runs" ADD CONSTRAINT "ai_agent_runs_nguon_model_chk"
      CHECK ("nguonModel" IS NULL OR ("nguonModel" ~ '^ngoai:[a-z0-9_-]{1,32}:[A-Za-z0-9._:/@-]{1,96}$' AND "cheDo" = 'hoi'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.ai_agent_runs_nguon_model_bat_bien() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  IF NEW."nguonModel" IS DISTINCT FROM OLD."nguonModel" THEN
    RAISE EXCEPTION 'ai_agent_runs.nguonModel is immutable after insert' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ai_agent_runs_nguon_model_bat_bien() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_ai_agent_runs_nguon_model_bat_bien ON public."ai_agent_runs";
CREATE TRIGGER trg_ai_agent_runs_nguon_model_bat_bien BEFORE UPDATE ON public."ai_agent_runs"
  FOR EACH ROW EXECUTE FUNCTION public.ai_agent_runs_nguon_model_bat_bien();
