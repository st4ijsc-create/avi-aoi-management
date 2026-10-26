-- Dot 10.3 B1/B3 (2026-10-26) — khoa AI ngoai THEO NHA MAY + cau hinh / danh muc model / host noi bo theo nha may.
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0414.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- ai_api_keys."factoryId"  NULL cho phep (hang cu), NHUNG CHECK: khoa 'active' PHAI co nha may (tuong duong NOT NULL cho moi khoa dung
--   duoc, khong xoa du lieu cu). Hang cu khong nha may ⇒ 'inactive' (nhap lai o man quan tri; hang ma hoa 'legacy' cung vay).
-- ai_ngoai_nha_may        bat / tat AI ngoai + "du lieu van hanh" + luu nguyen van (da che) + tran; mac dinh TAT het.
-- ai_ngoai_model          danh muc model ngoai cua nha may (khoa dung, gia, tran luot); model khong gia ⇒ BAT BUOC tranTokenLuot.
-- ai_ngoai_host_noi_bo    host:cong noi bo duoc khai cho endpoint tuong thich OpenAI (chi admin TOAN HE ghi — kiem o thu tuc).
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS "ai_ngoai_host_noi_bo"; DROP TABLE IF EXISTS "ai_ngoai_model"; DROP TABLE IF EXISTS "ai_ngoai_nha_may";
--   ALTER TABLE "ai_api_keys" DROP CONSTRAINT IF EXISTS "ai_api_keys_active_can_nha_may_chk", DROP COLUMN IF EXISTS "factoryId";
--   (hang da chuyen 'inactive' khong tu bat lai — chu dong bat lai neu can)

ALTER TABLE public."ai_api_keys" ADD COLUMN IF NOT EXISTS "factoryId" integer REFERENCES public."factories"("id") ON DELETE RESTRICT;
UPDATE public."ai_api_keys" SET "status" = 'inactive', "updatedAt" = now() WHERE "factoryId" IS NULL AND "status" = 'active';
ALTER TABLE public."ai_api_keys" DROP CONSTRAINT IF EXISTS "ai_api_keys_active_can_nha_may_chk";
ALTER TABLE public."ai_api_keys" ADD CONSTRAINT "ai_api_keys_active_can_nha_may_chk" CHECK ("factoryId" IS NOT NULL OR "status" <> 'active');
CREATE INDEX IF NOT EXISTS "idx_ai_api_keys_factory" ON public."ai_api_keys" ("factoryId");

CREATE TABLE IF NOT EXISTS public."ai_ngoai_nha_may" (
  "factoryId" integer PRIMARY KEY REFERENCES public."factories"("id") ON DELETE CASCADE,
  "batNgoai" boolean NOT NULL DEFAULT false,
  "choDuLieuVanHanh" boolean NOT NULL DEFAULT false,
  "luuNguyenVan" boolean NOT NULL DEFAULT false,
  "hanGiuNgay" integer NOT NULL DEFAULT 30,
  "tranTokenNgay" bigint,
  "tranTienNgayUsd" numeric(12,4),
  "tranTokenNguoiNgay" bigint,
  "tranTokenLuongNgay" bigint,
  "tranTokenLuot" bigint,
  "tranLanPhut" integer NOT NULL DEFAULT 20,
  "capNhatBoi" integer,
  "capNhatLuc" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_ngoai_nha_may_han_giu_chk" CHECK ("hanGiuNgay" BETWEEN 1 AND 365),
  CONSTRAINT "ai_ngoai_nha_may_tran_duong_chk" CHECK (
    ("tranTokenNgay" IS NULL OR "tranTokenNgay" > 0) AND ("tranTienNgayUsd" IS NULL OR "tranTienNgayUsd" > 0)
    AND ("tranTokenNguoiNgay" IS NULL OR "tranTokenNguoiNgay" > 0) AND ("tranTokenLuongNgay" IS NULL OR "tranTokenLuongNgay" > 0)
    AND ("tranTokenLuot" IS NULL OR "tranTokenLuot" > 0) AND "tranLanPhut" BETWEEN 1 AND 600)
);

CREATE TABLE IF NOT EXISTS public."ai_ngoai_model" (
  "id" serial PRIMARY KEY,
  "factoryId" integer NOT NULL REFERENCES public."factories"("id") ON DELETE CASCADE,
  "nhaCungCap" varchar(16) NOT NULL,
  "model" varchar(96) NOT NULL,
  "nhan" varchar(120) NOT NULL,
  "keyId" integer NOT NULL REFERENCES public."ai_api_keys"("id") ON DELETE RESTRICT,
  "giaVaoUsdTrieu" numeric(12,4),
  "giaRaUsdTrieu" numeric(12,4),
  "tranTokenLuot" bigint,
  "batModel" boolean NOT NULL DEFAULT false,
  "capNhatBoi" integer,
  "capNhatLuc" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_ngoai_model_uniq" UNIQUE ("factoryId", "nhaCungCap", "model"),
  CONSTRAINT "ai_ngoai_model_ncc_chk" CHECK ("nhaCungCap" IN ('anthropic','openai','gemini','openai_compat')),
  CONSTRAINT "ai_ngoai_model_ten_chk" CHECK ("model" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$'),
  CONSTRAINT "ai_ngoai_model_gia_hoac_tran_chk" CHECK (("giaVaoUsdTrieu" IS NOT NULL AND "giaRaUsdTrieu" IS NOT NULL) OR "tranTokenLuot" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public."ai_ngoai_host_noi_bo" (
  "factoryId" integer NOT NULL REFERENCES public."factories"("id") ON DELETE CASCADE,
  "hostCong" varchar(255) NOT NULL,
  "taoBoi" integer,
  "taoLuc" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("factoryId", "hostCong"),
  CONSTRAINT "ai_ngoai_host_noi_bo_dang_chk" CHECK ("hostCong" ~ '^[a-z0-9.-]{1,253}:[0-9]{1,5}$')
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0414] role avi_app absent — grants skipped.';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_ngoai_nha_may" TO avi_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_ngoai_model" TO avi_app;
  GRANT USAGE ON SEQUENCE public."ai_ngoai_model_id_seq" TO avi_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."ai_ngoai_host_noi_bo" TO avi_app;
END $$;
