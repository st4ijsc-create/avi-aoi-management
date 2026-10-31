-- Dot 10.4b L0a' (2026-10-30) — tran D10 cho sinh chu bang model NGOAI (ke hoach v2.1 §2 D10, ra kiem-dinh M8 / N6 / 6b-3).
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0418.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- ai_ngoai_dang_bay            MOT luot ngoai dang bay MOI NGUOI (chong xa song song), SONG QUA nhieu tien trinh / khoi dong lai.
--                              batDau / hetHan tinh trong CUNG cau SQL tu now() (now() + make_interval(secs => ttl)), KHONG tu dong ho JS;
--                              giu = INSERT … ON CONFLICT ("userId") DO UPDATE … WHERE hang cu da HET HAN (nguyen tu); tha = DELETE dung token.
--                              Tien trinh chet giua chung ⇒ hang tu het han sau "hetHan" (TTL) — nguoi dung khong ket vinh vien.
-- ai_ngoai_dem."soLan"         so lan goi da giu cho moi khoa (khoa 'luot:<runId>' ⇒ tran SO VONG moi run; giu cho nguyen tu cung "tokenGiu").
-- ai_ngoai_nha_may (cau hinh — chi admin nha may sua qua thu tuc da co):
--   "tranTienLuotUsd"   tran TONG CHI PHI moi run (giu cho cong don nguyen tu tren khoa 'luot:<runId>'); NULL ⇒ 1/4 "tranTienNgayUsd" (mac dinh
--                       do-model chot); ca hai NULL ⇒ khong tran tien/run (van con tran token/run).
--   "tranVongLuot"      so lan goi ngoai toi da moi run (mac dinh 20).
--   "tranByteDocLuot"   tong byte KET QUA TOOL gui ra ngoai moi run (mac dinh 256 KiB).
--   "tranTepDocLuot"    so tep doc gui ra ngoai moi run (mac dinh 50).
-- ai_ngoai_cong_cu_ghi        co RIENG "model ngoai duoc dung tool GHI/CHAY" (ra kiem-dinh 14): BANG RIENG ma avi_app CHI SELECT ⇒ khong thu tuc /
--                              client / moi truong nguoi dung nao bat duoc; KHONG co UI; vang hang ⇒ false. Bat = DBA bang owner `aoi`.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public."ai_ngoai_cong_cu_ghi";
--   DROP TABLE IF EXISTS public."ai_ngoai_dang_bay";
--   ALTER TABLE public."ai_ngoai_dem" DROP COLUMN IF EXISTS "soLan";
--   ALTER TABLE public."ai_ngoai_nha_may" DROP CONSTRAINT IF EXISTS "ai_ngoai_nha_may_tran_run_chk",
--     DROP COLUMN IF EXISTS "tranTienLuotUsd", DROP COLUMN IF EXISTS "tranVongLuot", DROP COLUMN IF EXISTS "tranByteDocLuot",
--     DROP COLUMN IF EXISTS "tranTepDocLuot";

CREATE TABLE IF NOT EXISTS public."ai_ngoai_dang_bay" (
  "userId" integer PRIMARY KEY REFERENCES public."users"("id") ON DELETE CASCADE,
  "factoryId" integer NOT NULL,
  "token" varchar(64) NOT NULL,
  "batDau" timestamptz NOT NULL DEFAULT now(),
  "hetHan" timestamptz NOT NULL,
  CONSTRAINT "ai_ngoai_dang_bay_han_chk" CHECK ("hetHan" > "batDau" AND "hetHan" <= "batDau" + interval '15 minutes')
);
CREATE INDEX IF NOT EXISTS "idx_ai_ngoai_dang_bay_het_han" ON public."ai_ngoai_dang_bay" ("hetHan");

ALTER TABLE public."ai_ngoai_dem" ADD COLUMN IF NOT EXISTS "soLan" integer NOT NULL DEFAULT 0;

ALTER TABLE public."ai_ngoai_nha_may"
  ADD COLUMN IF NOT EXISTS "tranTienLuotUsd" numeric(12,4),
  ADD COLUMN IF NOT EXISTS "tranVongLuot" integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "tranByteDocLuot" integer NOT NULL DEFAULT 262144,
  ADD COLUMN IF NOT EXISTS "tranTepDocLuot" integer NOT NULL DEFAULT 50;
ALTER TABLE public."ai_ngoai_nha_may" DROP CONSTRAINT IF EXISTS "ai_ngoai_nha_may_tran_run_chk";
ALTER TABLE public."ai_ngoai_nha_may" ADD CONSTRAINT "ai_ngoai_nha_may_tran_run_chk" CHECK (
  ("tranTienLuotUsd" IS NULL OR "tranTienLuotUsd" > 0)
  AND "tranVongLuot" BETWEEN 1 AND 200
  AND "tranByteDocLuot" BETWEEN 1024 AND 4194304
  AND "tranTepDocLuot" BETWEEN 1 AND 500);

CREATE TABLE IF NOT EXISTS public."ai_ngoai_cong_cu_ghi" (
  "factoryId" integer PRIMARY KEY REFERENCES public."factories"("id") ON DELETE CASCADE,
  "choPhep" boolean NOT NULL DEFAULT false,
  "ghiChu" varchar(200),
  "capNhatLuc" timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0418] role avi_app absent — grants skipped.';
    RETURN;
  END IF;
  REVOKE ALL ON public."ai_ngoai_dang_bay" FROM avi_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_ngoai_dang_bay" TO avi_app;
  -- co cong cu ghi: avi_app CHI DOC (pg_default_acl cua `aoi` cap arwd ⇒ thu hep tuong minh).
  REVOKE ALL ON public."ai_ngoai_cong_cu_ghi" FROM avi_app;
  GRANT SELECT ON public."ai_ngoai_cong_cu_ghi" TO avi_app;
END $$;
