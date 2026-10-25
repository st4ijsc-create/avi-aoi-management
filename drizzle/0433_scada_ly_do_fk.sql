-- SCADA R1b-1 Task 6 (2026-10-24) — (1) cot `ly_do` cho nhat ky thu lenh WORM; (2) FK ON DELETE CASCADE cho kenh che do + khoa chon.
-- Cot moi NULL = hanh vi cu. Khong backfill. Chi DELETE cac dong MO COI (tro toi may / adapter da khong con) truoc khi them FK.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0433.mjs --test-only|--dev-only|--both`.
--    DEV chi sau khi phien dieu phoi duyet SQL + nhan so dem mo coi. Khong drizzle-kit generate/push.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- scada_command_attempts.ly_do   varchar(300) NULL: ly do (chu tu do, <=300 ky tu) di kem lan thu lenh (nguoi dung khai / he thong ghi).
--   Bang nay la WORM (REVOKE UPDATE,DELETE khoi avi_app + trigger BEFORE UPDATE OR DELETE/TRUNCATE, khuon 0374). ADD COLUMN bang owner
--   khong phai UPDATE/DELETE nen khong bi trigger chan, va khong doi quyen: avi_app van CHI SELECT + INSERT.
-- FK ON DELETE CASCADE (ten co dinh de verify do duoc):
--   scada_kenh_che_do_machine_fk   scada_kenh_che_do(machine_id)  -> machines(id)
--   scada_kenh_che_do_adapter_fk   scada_kenh_che_do(adapter_id)  -> device_adapters(id)
--   scada_khoa_chon_adapter_fk     scada_khoa_chon(adapter_id)    -> device_adapters(id)
--   Xoa may / adapter ⇒ kenh che do / khoa chon tro toi no tu bien mat (trang thai ngan han, khong phai chung cu — khac nhat ky).
-- Mo coi: DELETE truoc khi them FK (neu khong ADD CONSTRAINT se loi 23503). RAISE NOTICE so dong da xoa. Chay lai ⇒ 0 dong.
--
-- ROLLBACK:
--   ALTER TABLE public."scada_kenh_che_do" DROP CONSTRAINT IF EXISTS "scada_kenh_che_do_machine_fk", DROP CONSTRAINT IF EXISTS "scada_kenh_che_do_adapter_fk";
--   ALTER TABLE public."scada_khoa_chon" DROP CONSTRAINT IF EXISTS "scada_khoa_chon_adapter_fk";
--   ALTER TABLE public."scada_command_attempts" DROP COLUMN IF EXISTS "ly_do";   -- (chay bang owner; trigger WORM chi chan UPDATE/DELETE/TRUNCATE dong)
--   (cac dong mo coi da bi DELETE khong khoi phuc duoc)

ALTER TABLE public."scada_command_attempts" ADD COLUMN IF NOT EXISTS "ly_do" varchar(300);

-- Don mo coi (idempotent: lan sau 0 dong) roi them FK.
DO $$
DECLARE
  n_che integer;
  n_khoa integer;
BEGIN
  DELETE FROM public."scada_kenh_che_do" k
   WHERE NOT EXISTS (SELECT 1 FROM public."machines" m WHERE m."id" = k."machine_id")
      OR NOT EXISTS (SELECT 1 FROM public."device_adapters" a WHERE a."id" = k."adapter_id");
  GET DIAGNOSTICS n_che = ROW_COUNT;
  DELETE FROM public."scada_khoa_chon" c
   WHERE NOT EXISTS (SELECT 1 FROM public."device_adapters" a WHERE a."id" = c."adapter_id");
  GET DIAGNOSTICS n_khoa = ROW_COUNT;
  RAISE NOTICE '[0433] orphan rows deleted: scada_kenh_che_do=%, scada_khoa_chon=%', n_che, n_khoa;
END $$;

DO $$
BEGIN
  ALTER TABLE public."scada_kenh_che_do" ADD CONSTRAINT "scada_kenh_che_do_machine_fk"
    FOREIGN KEY ("machine_id") REFERENCES public."machines" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public."scada_kenh_che_do" ADD CONSTRAINT "scada_kenh_che_do_adapter_fk"
    FOREIGN KEY ("adapter_id") REFERENCES public."device_adapters" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public."scada_khoa_chon" ADD CONSTRAINT "scada_khoa_chon_adapter_fk"
    FOREIGN KEY ("adapter_id") REFERENCES public."device_adapters" ("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
