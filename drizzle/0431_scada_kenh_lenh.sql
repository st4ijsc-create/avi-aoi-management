-- SCADA R1a Task 1 (2026-10-24) — kenh (channel) tren device_tags, kenh che do moi may (K2), khoa chon (K6), nhat ky thu lenh (§C.5).
-- Moi cot moi NULL = hanh vi cu. Khong backfill. Khong doi dong nao dang co.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0431.mjs --test-only|--dev-only|--both`.
--    DEV chi sau khi phien dieu phoi duyet SQL + nhan so dem. Khong drizzle-kit generate/push.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- device_tags:
--   channel_kind     NULL = tag cu (khong khai kenh). input | input_output | calculated | calculated_output | output.
--   display_name / display_format  nhan va khuon hien thi cho HMI (NULL = dung tagKey / dinh dang mac dinh).
--   write_min / write_max / write_step  dai va buoc cho phep khi ghi (NULL = khong gioi han khai bao).
--   actuation_level  muc tac dong len thiet bi, IN (1,3,4,5) (2 khong dung - de danh).
-- scada_kenh_che_do   K2: mot kenh che do cho moi may; gia_tri_remote la gia tri (da chuan hoa) nghia la REMOTE.
-- scada_khoa_chon     K6: khoa chon (adapter, tag) cho mot nguoi, het han theo expires_at.
-- scada_command_attempts  §C.5: nhat ky MOI lan thu lenh truoc dispatch() (tu choi/de xuat/xac nhan/huy). APPEND-ONLY:
--   avi_app chi SELECT + INSERT (REVOKE UPDATE, DELETE theo khuon 0279) + trigger BEFORE UPDATE OR DELETE/TRUNCATE ne loi
--   (khuon 0374) de ca owner cung khong sua duoc qua duong ung dung.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS "scada_command_attempts"; DROP FUNCTION IF EXISTS public.scada_command_attempts_worm();
--   DROP TABLE IF EXISTS "scada_khoa_chon"; DROP TABLE IF EXISTS "scada_kenh_che_do";
--   ALTER TABLE "device_tags" DROP COLUMN IF EXISTS "channel_kind", DROP COLUMN IF EXISTS "display_name", DROP COLUMN IF EXISTS "display_format",
--     DROP COLUMN IF EXISTS "write_min", DROP COLUMN IF EXISTS "write_max", DROP COLUMN IF EXISTS "write_step", DROP COLUMN IF EXISTS "actuation_level";
--   DROP TYPE IF EXISTS scada_channel_kind;

DO $$
BEGIN
  CREATE TYPE public.scada_channel_kind AS ENUM ('input','input_output','calculated','calculated_output','output');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public."device_tags"
  ADD COLUMN IF NOT EXISTS "channel_kind" public.scada_channel_kind,
  ADD COLUMN IF NOT EXISTS "display_name" varchar(128),
  ADD COLUMN IF NOT EXISTS "display_format" varchar(64),
  ADD COLUMN IF NOT EXISTS "write_min" double precision,
  ADD COLUMN IF NOT EXISTS "write_max" double precision,
  ADD COLUMN IF NOT EXISTS "write_step" double precision,
  ADD COLUMN IF NOT EXISTS "actuation_level" smallint;

ALTER TABLE public."device_tags" DROP CONSTRAINT IF EXISTS "device_tags_actuation_level_chk";
ALTER TABLE public."device_tags" ADD CONSTRAINT "device_tags_actuation_level_chk" CHECK ("actuation_level" IS NULL OR "actuation_level" IN (1,3,4,5));
ALTER TABLE public."device_tags" DROP CONSTRAINT IF EXISTS "device_tags_write_range_chk";
ALTER TABLE public."device_tags" ADD CONSTRAINT "device_tags_write_range_chk" CHECK ("write_min" IS NULL OR "write_max" IS NULL OR "write_min" <= "write_max");
ALTER TABLE public."device_tags" DROP CONSTRAINT IF EXISTS "device_tags_write_step_chk";
ALTER TABLE public."device_tags" ADD CONSTRAINT "device_tags_write_step_chk" CHECK ("write_step" IS NULL OR "write_step" > 0);

-- K2: mot kenh che do cho moi may
CREATE TABLE IF NOT EXISTS public."scada_kenh_che_do" (
  "machine_id" integer PRIMARY KEY,
  "adapter_id" integer NOT NULL,
  "tag_key" varchar(128) NOT NULL,
  "gia_tri_remote" jsonb NOT NULL,
  "updated_by" integer NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- K6: khoa chon (adapter, tag) cho mot nguoi
CREATE TABLE IF NOT EXISTS public."scada_khoa_chon" (
  "adapter_id" integer NOT NULL,
  "tag_key" varchar(128) NOT NULL,
  "user_id" integer NOT NULL,
  "request_id" varchar(64) NOT NULL,
  "expires_at" timestamptz NOT NULL,
  PRIMARY KEY ("adapter_id", "tag_key")
);
CREATE INDEX IF NOT EXISTS "idx_scada_khoa_chon_expires" ON public."scada_khoa_chon" ("expires_at");

-- §C.5: nhat ky thu lenh, append-only
CREATE TABLE IF NOT EXISTS public."scada_command_attempts" (
  "id" bigserial PRIMARY KEY,
  "request_id" varchar(64),
  "user_id" integer NOT NULL,
  "adapter_id" integer,
  "tag_key" varchar(128),
  "requested_value" jsonb,
  "after_formula" jsonb,
  "stage" varchar(24) NOT NULL,
  "outcome" varchar(24) NOT NULL,
  "reason_code" varchar(64),
  "command_log_ids" bigint[],
  "at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "scada_command_attempts_stage_chk" CHECK ("stage" IN ('request','confirm','dispatch','huy')),
  CONSTRAINT "scada_command_attempts_outcome_chk" CHECK ("outcome" IN ('rejected','proposed','confirmed','dispatched','expired','cancelled'))
);
CREATE INDEX IF NOT EXISTS "idx_scada_command_attempts_request" ON public."scada_command_attempts" ("request_id");
CREATE INDEX IF NOT EXISTS "idx_scada_command_attempts_user_at" ON public."scada_command_attempts" ("user_id", "at");

-- WORM: trigger ne loi voi MOI vai (ke ca owner) tren duong UPDATE/DELETE/TRUNCATE (khuon 0374)
CREATE OR REPLACE FUNCTION public.scada_command_attempts_worm() RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'scada_command_attempts is append-only (WORM)' USING ERRCODE = 'check_violation';
END $$;
REVOKE ALL ON FUNCTION public.scada_command_attempts_worm() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_scada_command_attempts_worm ON public."scada_command_attempts";
CREATE TRIGGER trg_scada_command_attempts_worm BEFORE UPDATE OR DELETE ON public."scada_command_attempts"
  FOR EACH ROW EXECUTE FUNCTION public.scada_command_attempts_worm();
DROP TRIGGER IF EXISTS trg_scada_command_attempts_worm_truncate ON public."scada_command_attempts";
CREATE TRIGGER trg_scada_command_attempts_worm_truncate BEFORE TRUNCATE ON public."scada_command_attempts"
  FOR EACH STATEMENT EXECUTE FUNCTION public.scada_command_attempts_worm();

-- Quyen cho vai ung dung. pg_default_acl cua `aoi` da cap arwd cho bang moi, nhung day la tinh chat cua VAI TAO BANG
-- (xem 0313) nen khai ro; WORM thi PHAI thu hep tuong minh (khuon 0279: REVOKE UPDATE, DELETE; giu SELECT, INSERT).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0431] role avi_app absent — grants skipped (dev DB without least-privilege role; apply 0224 first).';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."scada_kenh_che_do" TO avi_app;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."scada_khoa_chon" TO avi_app;
  REVOKE ALL ON public."scada_command_attempts" FROM avi_app;
  GRANT SELECT, INSERT ON public."scada_command_attempts" TO avi_app;
  REVOKE ALL ON SEQUENCE public."scada_command_attempts_id_seq" FROM avi_app;
  GRANT USAGE ON SEQUENCE public."scada_command_attempts_id_seq" TO avi_app;
END $$;
