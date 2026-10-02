-- ════════════════════════════════════════════════════════════════════════════
-- 0362 — doc 81 Đợt 1D Task 1: GHIM tag/giá trị DỪNG theo tag OT (`device_tags.stop_value`)
-- ════════════════════════════════════════════════════════════════════════════
--
-- VÌ SAO: quyết định chủ dự án 2026-09-28 (doc 81 §8 QĐ1 "Làm ngay") — lệnh DỪNG phần mềm qua đường
--   OT phải tới được máy kể cả khi PLC an toàn chỉ SIM / không đọc được / báo NOT OK, NHƯNG chỉ khi nó
--   ghi ĐÚNG các cặp (tagKey, giá trị) đã GHIM. Thứ giữ an toàn là DỮ LIỆU CHƯA ĐIỀN (L-7): cột NULL
--   = không phải tag dừng = không miễn gì (fail-closed, hành vi hôm nay).
--
-- NGỮ NGHĨA:
--   stop_value      jsonb        giá trị dừng đã chuẩn hoá theo dataType (bool → true/false, int/float →
--                                number, string → string). NULL = không phải tag dừng.
--   stop_pinned_by  varchar(64)  users.id (dạng chuỗi) của người ghim; NULL khi không ghim.
--   stop_pinned_at  timestamptz  thời điểm ghim; NULL khi không ghim.
--   Chỉ đặt/gỡ qua `deviceAdapter.tags.setStopPin` (machine_control canEdit + lý do + audit
--   control_audit_log/audit_logs trong cùng transaction). Tag bị tắt / thôi writable / đổi định nghĩa
--   dây / bị xoá ⇒ ghim bị gỡ trong cùng transaction.
--
-- ⚠ Cột MỚI trong `deviceTags` (drizzle) ⇒ mọi `select().from(deviceTags)` đòi cột này: phải áp
--   migration lên DB dev TRƯỚC khi build/restart :3000 với mã mới.
-- ⚠ DDL chạy bằng owner `aoi` (`avi_app` → 42501): `node scripts/apply-migration-0362.mjs --dev-only`.
-- ⚠ Repo CẤM `drizzle-kit push/generate` — cột khai TAY vào `drizzle/schema/ot.ts` cùng lượt.
-- Idempotent (ADD COLUMN IF NOT EXISTS). Quyền: cột mới thừa hưởng quyền cấp BẢNG của avi_app.
-- ROLLBACK:
--   ALTER TABLE device_tags DROP COLUMN IF EXISTS stop_pinned_at;
--   ALTER TABLE device_tags DROP COLUMN IF EXISTS stop_pinned_by;
--   ALTER TABLE device_tags DROP COLUMN IF EXISTS stop_value;
--
ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS stop_value jsonb;
ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS stop_pinned_by varchar(64);
ALTER TABLE device_tags ADD COLUMN IF NOT EXISTS stop_pinned_at timestamptz;
COMMENT ON COLUMN device_tags.stop_value IS 'Gia tri DUNG ghim (doc 81 §8 QD1). NULL = khong phai tag dung. Chi tag writable+enabled.';
