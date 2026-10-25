-- kiem-dinh R1b-1 I1 (a) (dieu phoi 2026-10-25) — `interlock_rules."approvedDefHash"`: BAM DINH NGHIA cua tag nguon / dich (address, dataType,
-- scale / offset, adapterId + edgeNodeId cua adapter) CHUP luc DUYET. Luat chi con "da duyet" khi bam hien tai == bam da chup; dinh nghia doi sau
-- khi duyet (tags.update co TOTP, scripts/mappings-import.mjs --cho-phep-tag-bao-ve, changeDeviceOwner doi edgeNodeId, ghi thang bang …) ⇒ luat
-- tro ve CHUA DUYET (fail-closed) o enable, engine tu chan, dispatcher xac minh interlock. Ham bam: server/services/interlock/dinhNghiaDuyet.ts.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHAY BANG OWNER `aoi` qua `node scripts/apply-migration-0434.mjs --test-only|--dev-only|--both`.
--    DEV chi sau khi phien dieu phoi duyet SQL. Khong drizzle-kit generate/push. Khong sua drizzle/meta/_journal.json.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Cot moi varchar(80) NULL, KHONG backfill, KHONG FUNCTION / TRIGGER, khong doi quyen (avi_app da co SELECT/INSERT/UPDATE tren interlock_rules).
-- NULL tren mot luat DA DUYET (approvedBy khac NULL) = duyet TRUOC ban build nay ⇒ KHONG BIET nguoi duyet da xem dinh nghia nao ⇒ coi la CHUA
-- DUYET LAI (fail-closed): enable tu choi, engine khong tu chan, dispatcher tu choi lenh interlock. Truoc trien khai dem cac luat nay
-- (bao cao nghiem thu R1b-1 §4) va duyet lai sau trien khai. Cong inline (interlockGate) KHONG doi: luat bat van CHAN theo dieu kien.
--
-- ROLLBACK (bang owner):
--   ALTER TABLE public.interlock_rules DROP COLUMN IF EXISTS "approvedDefHash";

ALTER TABLE public.interlock_rules ADD COLUMN IF NOT EXISTS "approvedDefHash" varchar(80);
