-- Dot 10.3 B2 (2026-10-26) — SO AI ngoai (WORM: y dinh TRUOC + ket qua SAU), noi dung da che co han giu, bo dem tran dat-truoc.
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0415.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- ai_external_calls         WORM (khuon 0431): avi_app chi SELECT + INSERT; trigger chan UPDATE/DELETE/TRUNCATE voi MOI vai.
--   loai 'y-dinh' ghi TRUOC loi goi (ghi loi ⇒ khong goi); 'ket-qua' ghi SAU (yDinhId tro ve y dinh, toi da MOT). Y dinh mo coi ⇒ job
--   doi soat ghi hang 'ket-qua' ketCuc='khong-ro' (khong sua hang cu). Chi BAM noi dung da che (sha256), khong noi dung.
--   factoryId = nha may TINH TRAN (chu du lieu); nhaMayDuLieu = moi nha may co du lieu trong yeu cau (de truy vet).
-- ai_external_call_noi_dung NOI DUNG DA CHE (chi khi nha may bat luuNguyenVan), co hetHanLuc; job moi gio xoa hang het han (KHONG WORM).
-- ai_ngoai_dem               bo dem tran theo (nha may, ngay UTC+7, khoa) — khoa: 'nha-may' | 'nguoi:<id>' | 'luong:<id>' | 'luot:<runId>'.
-- ai_ngoai_dem_phut          so lan / phut theo nha may.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS "ai_ngoai_dem_phut"; DROP TABLE IF EXISTS "ai_ngoai_dem"; DROP TABLE IF EXISTS "ai_external_call_noi_dung";
--   DROP TABLE IF EXISTS "ai_external_calls"; DROP FUNCTION IF EXISTS public.ai_external_calls_worm();

CREATE TABLE IF NOT EXISTS public."ai_external_calls" (
  "id" bigserial PRIMARY KEY,
  "factoryId" integer NOT NULL,
  "nhaMayDuLieu" integer[] NOT NULL DEFAULT '{}',
  "loai" varchar(8) NOT NULL,
  "yDinhId" bigint,
  "userId" integer,
  "flowId" varchar(64),
  "runId" varchar(64),
  "tuDong" boolean NOT NULL,
  "nhaCungCap" varchar(16) NOT NULL,
  "model" varchar(96) NOT NULL,
  "mucDich" varchar(32),
  "mucDuLieu" varchar(12),
  "soTruongDaChe" integer,
  "bamNoiDung" char(64),
  "tokenVao" integer,
  "tokenRa" integer,
  "chiPhiUocUsd" numeric(12,6),
  "ketCuc" varchar(12),
  "maLoi" varchar(48),
  "taoLuc" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_external_calls_loai_chk" CHECK ("loai" IN ('y-dinh','ket-qua')),
  CONSTRAINT "ai_external_calls_muc_chk" CHECK ("mucDuLieu" IS NULL OR "mucDuLieu" IN ('ky-thuat','van-hanh')),
  CONSTRAINT "ai_external_calls_ket_cuc_chk" CHECK ("ketCuc" IS NULL OR "ketCuc" IN ('ok','loi','tu-choi','khong-ro')),
  CONSTRAINT "ai_external_calls_hinh_chk" CHECK (
    ("loai" = 'y-dinh' AND "yDinhId" IS NULL AND "ketCuc" IS NULL AND "bamNoiDung" IS NOT NULL)
    OR ("loai" = 'ket-qua' AND "yDinhId" IS NOT NULL AND "ketCuc" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "idx_ai_external_calls_factory_tao" ON public."ai_external_calls" ("factoryId", "taoLuc");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ai_external_calls_ket_qua" ON public."ai_external_calls" ("yDinhId") WHERE "loai" = 'ket-qua';
CREATE INDEX IF NOT EXISTS "idx_ai_external_calls_run" ON public."ai_external_calls" ("runId") WHERE "runId" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ai_external_calls_worm() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'ai_external_calls is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.ai_external_calls_worm() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_ai_external_calls_worm ON public."ai_external_calls";
CREATE TRIGGER trg_ai_external_calls_worm BEFORE UPDATE OR DELETE ON public."ai_external_calls"
  FOR EACH ROW EXECUTE FUNCTION public.ai_external_calls_worm();
DROP TRIGGER IF EXISTS trg_ai_external_calls_worm_truncate ON public."ai_external_calls";
CREATE TRIGGER trg_ai_external_calls_worm_truncate BEFORE TRUNCATE ON public."ai_external_calls"
  FOR EACH STATEMENT EXECUTE FUNCTION public.ai_external_calls_worm();

CREATE TABLE IF NOT EXISTS public."ai_external_call_noi_dung" (
  "callId" bigint PRIMARY KEY REFERENCES public."ai_external_calls"("id"),
  "factoryId" integer NOT NULL,
  "noiDungDaChe" text NOT NULL,
  "hetHanLuc" timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_ai_external_call_noi_dung_het_han" ON public."ai_external_call_noi_dung" ("hetHanLuc");

CREATE TABLE IF NOT EXISTS public."ai_ngoai_dem" (
  "factoryId" integer NOT NULL,
  "ngay" date NOT NULL,
  "khoa" varchar(80) NOT NULL,
  "tokenGiu" bigint NOT NULL DEFAULT 0,
  "tienGiuUsd" numeric(14,6) NOT NULL DEFAULT 0,
  PRIMARY KEY ("factoryId", "ngay", "khoa")
);
CREATE INDEX IF NOT EXISTS "idx_ai_ngoai_dem_ngay" ON public."ai_ngoai_dem" ("ngay");

CREATE TABLE IF NOT EXISTS public."ai_ngoai_dem_phut" (
  "factoryId" integer NOT NULL,
  "phut" timestamptz NOT NULL,
  "so" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("factoryId", "phut")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0415] role avi_app absent — grants skipped.';
    RETURN;
  END IF;
  REVOKE ALL ON public."ai_external_calls" FROM avi_app;
  GRANT SELECT, INSERT ON public."ai_external_calls" TO avi_app;
  REVOKE ALL ON SEQUENCE public."ai_external_calls_id_seq" FROM avi_app;
  GRANT USAGE ON SEQUENCE public."ai_external_calls_id_seq" TO avi_app;
  -- noi dung: chi them + xoa khi het han (job); KHONG sua (pg_default_acl cua `aoi` da cap arwd ⇒ thu hep tuong minh).
  REVOKE ALL ON public."ai_external_call_noi_dung" FROM avi_app;
  GRANT SELECT, INSERT, DELETE ON public."ai_external_call_noi_dung" TO avi_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_ngoai_dem" TO avi_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_ngoai_dem_phut" TO avi_app;
END $$;
