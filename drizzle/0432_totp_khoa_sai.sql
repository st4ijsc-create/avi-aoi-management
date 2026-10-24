-- SCADA R1a Task 16 (2026-10-24, fix round 1) — bo dem XAC THUC 2 LOP SAI theo nguoi dung, HAI bo dem rieng trong mot bang:
--   loai 'totp'   : 5 lan thu trong 5 phut  ⇒ khoa TOTP 5 phut (tinh tu lan thu bat dau khoa).
--   loai 'backup' : 10 lan thu trong 60 phut ⇒ tu choi ma du phong den HET cua so 60 phut do.
-- Hai bo dem DOC LAP: khoa TOTP khong bao gio chan ma du phong (loi thoat), sai ma du phong khong khoa TOTP.
-- CHI THEM mot bang. Khong doi dong nao dang co. Khong backfill.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0432.mjs --test-only|--dev-only|--both`.
--    DEV chi sau khi phien dieu phoi duyet SQL. Khong drizzle-kit generate/push.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- totp_khoa_sai   mot hang cho moi (nguoi dung, loai) DANG co lan thu trong cua so (hoac dang bi khoa).
--   user_id            chu cua bo dem (users.id la integer). KHONG FK — cung khuon totp_consumed (0313): trang thai ngan han,
--                      hang tu xoa khi nhap DUNG (hoac admin mo khoa); hang mo coi cua nguoi dung da xoa vo hai.
--   loai               'totp' | 'backup' (CHECK).
--   so_lan_sai         so lan THU da TINH trong cua so (tinh TRUOC khi kiem ma — "charge before verify"). Lan thu thu N duoc kiem;
--                      lan thu > N bi tu choi khong kiem.
--   cua_so_bat_dau     moc lan thu DAU TIEN cua cua so. Chi RESET khi khong khoa va cua so qua han, hoac khi khoa da het.
--   khoa_den           NULL = khong khoa. > now() ⇒ moi lan thu cua (nguoi, loai) nay bi tu choi, ma khong duoc kiem.
--   khoa_boi           ma LUOT THU (uuid) da dat khoa — lan thu thu N: neu chinh no la ma DUNG thi no duoc go khoa cua chinh minh.
--   tu_choi_dem        so lan bi tu choi vi dang khoa trong lan khoa hien tai (cho dong audit, toi da 1 dong / phut).
--   tu_choi_audit_luc  moc dong audit "tu choi dang khoa" cuoi.
--   updated_at         moc ghi cuoi.
-- Moi phep so thoi gian doc now() cua Postgres (mot dong ho, nhu so totp_consumed) — xem server/_core/totpKhoaSai.ts.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public."totp_khoa_sai";

CREATE TABLE IF NOT EXISTS public."totp_khoa_sai" (
  "user_id" integer NOT NULL,
  "loai" varchar(8) NOT NULL,
  "so_lan_sai" integer NOT NULL,
  "cua_so_bat_dau" timestamptz NOT NULL,
  "khoa_den" timestamptz NULL,
  "khoa_boi" varchar(64) NULL,
  "tu_choi_dem" integer NOT NULL DEFAULT 0,
  "tu_choi_audit_luc" timestamptz NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "totp_khoa_sai_pkey" PRIMARY KEY ("user_id", "loai"),
  CONSTRAINT "totp_khoa_sai_loai_chk" CHECK ("loai" IN ('totp', 'backup'))
);

-- Quyen cho vai ung dung. pg_default_acl cua `aoi` da cap arwd cho bang moi, nhung do la tinh chat cua VAI TAO BANG
-- (xem 0313 / 0431) nen khai ro: ung dung can SELECT, INSERT + UPDATE (upsert lan thu), DELETE (ma dung / admin mo khoa).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0432] role avi_app absent — grants skipped (dev DB without least-privilege role; apply 0224 first).';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."totp_khoa_sai" TO avi_app;
END $$;
