-- doc 51 P2 — INGEST HARDENING: serial-collision soft tag (CASE #8).
--
-- ════════════════════════════════════════════════════════════════════════════
-- VẤN ĐỀ (CASE #8 — QĐ#3 nhận-và-gắn-cờ):
--   Hai máy khác nhau gửi cùng serialNumber, hoặc quét trùng. KHÔNG từ chối:
--   phát hiện mềm (serial đã có row từ machineId KHÁC trong cửa sổ gần) →
--   product_inspections."suspectedDuplicateSerial" = now() + cảnh báo, board VẪN
--   lưu. Phân biệt với idempotency retry (cùng máy + cùng key ⇒ đã short-circuit
--   P0 từ trước). Phát hiện là OPT-IN (INGEST_SERIAL_COLLISION_DETECT, mặc định
--   TẮT — tốn một read/board trên bảng nóng nhất, QĐ#7).
--
-- TẠI SAO CHỈ CÓ MỘT CỘT (không kèm cột "unit" trên measurement_results như bản
-- thảo P2 ban đầu):
--   Cột được app ghi qua câu UPDATE RIÊNG best-effort — CỐ Ý KHÔNG khai trong
--   drizzle schema (giống hệt gateConfigVersion/0276). Nếu khai trong schema,
--   drizzle sinh mọi INSERT có cột đó ⇒ ingest GÃY trên DB chưa áp migration. Vì
--   measurement_results.unit chỉ ghi được qua batch-insert của drizzle (cần cột
--   trong schema) nên KHÔNG thể vừa fail-open vừa ghi được → ĐÃ DESCOPE việc lưu
--   unit vào DB. Giá trị CASE #11 (convert-để-gate + telemetry unit-mismatch) VẪN
--   đủ; đơn vị gốc hiện hiện diện ở log telemetry, không ở cột DB.
--
-- ĐẶC TÍNH (pattern 0272/0275/0276):
--   • Cột NULLABLE, KHÔNG default, KHÔNG backfill, KHÔNG index. Row lịch sử giữ
--     NULL = "không nghi" — đó là SỰ THẬT. Bảng product_inspections là bảng NÓNG
--     nhất (100 máy × 1/s, QĐ#7): mỗi index là thuế trên MỌI insert; phát-hiện
--     dùng idx_inspections_serial sẵn có.
--   • ADD COLUMN nullable/no-default = metadata-only, KHÔNG rewrite bảng → an
--     toàn trên hypertable (0172). Chunk NÉN (0271) trên TimescaleDB cũ có thể từ
--     chối → khối EXCEPTION ghi 'partial', KHÔNG đánh fail cả lượt migrate; app
--     fail-open (UPDATE best-effort nuốt lỗi cột thiếu, ingest KHÔNG hồi quy).
--   • GUARDED: BEGIN/EXCEPTION + ghi db_feature_status.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0281 (0280 = robot_telemetry_retention).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  serial_ok  boolean := false;
  err_detail text := '';
BEGIN
  -- product_inspections."suspectedDuplicateSerial" — cờ mềm CASE #8.
  BEGIN
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "suspectedDuplicateSerial" timestamp;
    serial_ok := true;
    RAISE NOTICE '[0281] product_inspections."suspectedDuplicateSerial" in force — serial-collision gắn cờ được.';
  EXCEPTION WHEN OTHERS THEN
    serial_ok := false;
    err_detail := 'product_inspections.suspectedDuplicateSerial ADD COLUMN failed: ' || SQLERRM;
    RAISE WARNING '[0281] ADD COLUMN "suspectedDuplicateSerial" trên product_inspections FAILED (%) — serial-collision KHÔNG gắn cờ được; app fail-open (câu UPDATE best-effort nuốt lỗi cột thiếu, ingest KHÔNG hồi quy). Nguyên nhân thường gặp: hypertable có chunk NÉN (0271). Khắc phục: decompress rồi re-apply (idempotent).', SQLERRM;
  END;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'ingest_hardening_p2',
    CASE WHEN serial_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN serial_ok THEN
        'product_inspections."suspectedDuplicateSerial" (serial-collision soft tag, CASE #8) in force. '
        'Legacy rows keep NULL (never backfilled). Written best-effort via a raw UPDATE (NOT in the drizzle schema — fail-open like gateConfigVersion/0276). '
        'Detection is opt-in (INGEST_SERIAL_COLLISION_DETECT, default OFF — one extra indexed read per board). '
        'CASE #11 unit conversion is applied at gate-time by the app (INGEST_UNIT_CONVERT_ENABLED, default ON, inert unless a machine sends a unit); the raw unit is NOT persisted to a DB column (surfaced via telemetry) to keep ingest fail-open pre-migration.'
      ELSE
        err_detail || ' — 0281 not applied. App is fail-open. Remediate and re-apply drizzle/0281 (idempotent).'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
