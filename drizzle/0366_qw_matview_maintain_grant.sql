-- ════════════════════════════════════════════════════════════════════════════
-- 0366 — doc 81 Đợt 7 task K4: vai ứng dụng `avi_app` được REFRESH hai materialized view QW3 (quyền MAINTAIN, PG 17+)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: log khởi động :3000 (dev) báo mỗi 5 phút "[MatviewRefresh] refresh failed: Failed query: SELECT
--   refresh_qw_caches()". Gốc (đo 2026-10-11, dev CHỈ ĐỌC + tái hiện trên _test bằng vai avi_app):
--     • server nối bằng `avi_app` (không superuser, không thành viên của `aoi`);
--     • `machine_status_latest` và `hourly_yield_cache` (0111 / 0174) thuộc owner `aoi`; ACL của avi_app chỉ `arwd`
--       (SELECT/INSERT/UPDATE/DELETE) — KHÔNG có `m` (MAINTAIN);
--     • REFRESH MATERIALIZED VIEW đòi OWNER hoặc (PG 17+) quyền MAINTAIN ⇒ cả nhánh CONCURRENTLY lẫn nhánh dự phòng của
--       refresh_qw_caches() đều 42501 "permission denied for materialized view machine_status_latest".
--   Hệ quả: hai view đứng yên; đường đọc (functions/cachedStatistics) coi MV là CŨ (> 2× chu kỳ) nên LUÔN rơi về truy vấn
--   sống — số trên bảng điều khiển vẫn đúng, chỉ chậm hơn và log báo lỗi mỗi chu kỳ.
--
-- CÁCH SỬA: cấp đúng MỘT quyền MAINTAIN trên ĐÚNG hai view cho avi_app. KHÔNG đổi owner, KHÔNG SECURITY DEFINER, KHÔNG
--   cấp vai `pg_maintain` (phủ MỌI bảng). MAINTAIN cho phép REFRESH/VACUUM/ANALYZE/REINDEX/CLUSTER/LOCK trên hai view
--   này — không cho ALTER/DROP (vẫn chỉ owner).
--   • REFRESH chạy câu truy vấn của view bằng quyền OWNER (thao tác hạn chế bảo mật) ⇒ không cần cấp gì trên bảng nguồn.
--   • PG < 17 không có MAINTAIN ⇒ migration DỪNG (RAISE EXCEPTION, không đổi gì) thay vì im lặng "thành công".
--   • Không có vai avi_app ⇒ app nối bằng owner, REFRESH đã chạy được ⇒ NOTICE, không làm gì.
--
-- ⚠ 0174 DROP + CREATE lại `hourly_yield_cache` ⇒ nếu ai chạy lại 0174, quyền MAINTAIN trên view đó mất theo: chạy lại
--   0366 sau đó (script áp sẽ đo và báo).
-- ⚠ DDL/GRANT chạy bằng owner `aoi`: `node scripts/apply-migration-0366.mjs --test-only`
--   (dev: `--dev-only`, do chủ dự án quyết; không cờ ⇒ script TỪ CHỐI chạy — R-3-g).
-- ⚠ Repo CẤM `drizzle-kit push/generate`.
-- ROLLBACK: REVOKE MAINTAIN ON TABLE public.machine_status_latest, public.hourly_yield_cache FROM avi_app;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '0366: role avi_app absent - nothing to grant (the app connects as the view owner)';
    RETURN;
  END IF;
  IF current_setting('server_version_num')::int < 170000 THEN
    RAISE EXCEPTION '0366 needs PostgreSQL 17+ (MAINTAIN privilege); server_version_num=% - nothing changed',
      current_setting('server_version_num');
  END IF;
  EXECUTE 'GRANT MAINTAIN ON TABLE public.machine_status_latest, public.hourly_yield_cache TO avi_app';
END $$;
