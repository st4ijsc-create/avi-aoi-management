-- Dot 10.3 B3 (2026-10-26) — duyet phien ban luong co node AI NGOAI: MOI phien ban duyet rieng + bam dinh nghia day du luc duyet.
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0416.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- coNodeNgoai    phien ban co node dung model ngoai (tinh luc luu).
-- ngoaiDuyetBoi / ngoaiDuyetLuc / ngoaiTuDuyet   ai duyet, luc nao, co phai TU duyet (admin) — audit muc cao o thu tuc.
-- ngoaiBamDuyet  sha256 dinh nghia DA CHUAN HOA (ca do thi, bo toa do ve) luc duyet; luc BAT so lai ⇒ lech ⇒ phai duyet lai.
-- Moi cot moi: mac dinh = hanh vi cu (khong node ngoai ⇒ khong can duyet ngoai).
--
-- ROLLBACK:
--   ALTER TABLE "ai_flow_versions" DROP CONSTRAINT IF EXISTS "ai_flow_versions_ngoai_duyet_chk",
--     DROP COLUMN IF EXISTS "coNodeNgoai", DROP COLUMN IF EXISTS "ngoaiDuyetBoi", DROP COLUMN IF EXISTS "ngoaiDuyetLuc",
--     DROP COLUMN IF EXISTS "ngoaiTuDuyet", DROP COLUMN IF EXISTS "ngoaiBamDuyet";

ALTER TABLE public."ai_flow_versions"
  ADD COLUMN IF NOT EXISTS "coNodeNgoai" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ngoaiDuyetBoi" integer REFERENCES public."users"("id") ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS "ngoaiDuyetLuc" timestamptz,
  ADD COLUMN IF NOT EXISTS "ngoaiTuDuyet" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ngoaiBamDuyet" varchar(64);

ALTER TABLE public."ai_flow_versions" DROP CONSTRAINT IF EXISTS "ai_flow_versions_ngoai_duyet_chk";
ALTER TABLE public."ai_flow_versions" ADD CONSTRAINT "ai_flow_versions_ngoai_duyet_chk"
  CHECK (("ngoaiDuyetLuc" IS NULL) = ("ngoaiBamDuyet" IS NULL) AND ("ngoaiBamDuyet" IS NULL OR "ngoaiBamDuyet" ~ '^[0-9a-f]{64}$'));
