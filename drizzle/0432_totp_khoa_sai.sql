-- SCADA R1a Task 16 (2026-10-24) — bo dem TOTP SAI theo nguoi dung: 5 lan sai trong 5 phut ⇒ khoa TOTP cua nguoi do 5 phut.
-- CHI THEM mot bang. Khong doi dong nao dang co. Khong backfill.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0432.mjs --test-only|--dev-only|--both`.
--    DEV chi sau khi phien dieu phoi duyet SQL. Khong drizzle-kit generate/push.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- totp_khoa_sai   mot hang cho moi nguoi dung DANG co lan sai trong cua so (hoac dang bi khoa).
--   user_id          chu cua bo dem (users.id la integer). KHONG FK — cung khuon totp_consumed (0313): bang trang thai ngan han,
--                    hang tu xoa khi nguoi do nhap DUNG (hoac admin mo khoa); hang mo coi cua nguoi dung da xoa vo hai.
--   so_lan_sai       so lan sai trong cua so hien tai (1..). Dat 5 ⇒ dat khoa_den.
--   cua_so_bat_dau   moc lan sai DAU TIEN cua cua so. Cu hon 5 phut ⇒ lan sai ke tiep RESET so_lan_sai = 1.
--   khoa_den         NULL = khong khoa. > now() ⇒ moi lan xac minh TOTP cua nguoi nay bi tu choi (ke ca ma DUNG), ma khong bi tieu.
--   updated_at       moc ghi cuoi.
-- Moi phep so thoi gian doc now() cua Postgres (mot dong ho, nhu so totp_consumed tu Pha 9) — xem server/_core/totpKhoaSai.ts.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public."totp_khoa_sai";

CREATE TABLE IF NOT EXISTS public."totp_khoa_sai" (
  "user_id" integer PRIMARY KEY,
  "so_lan_sai" integer NOT NULL,
  "cua_so_bat_dau" timestamptz NOT NULL,
  "khoa_den" timestamptz NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- Quyen cho vai ung dung. pg_default_acl cua `aoi` da cap arwd cho bang moi, nhung do la tinh chat cua VAI TAO BANG
-- (xem 0313 / 0431) nen khai ro: ung dung can SELECT (doc khoa), INSERT + UPDATE (upsert lan sai), DELETE (ma dung / admin mo khoa).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0432] role avi_app absent — grants skipped (dev DB without least-privilege role; apply 0224 first).';
    RETURN;
  END IF;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public."totp_khoa_sai" TO avi_app;
END $$;
