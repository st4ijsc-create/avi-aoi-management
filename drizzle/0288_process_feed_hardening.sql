-- ============================================================================
-- Migration 0288: PROCESS FEED HARDENING — durability + provenance cho luồng
-- RESULT tổng quát ("ST4I Standard Process Feed v1", doc 56 Đ1 việc 3 / Trục 2).
--
-- Nhân NGUYÊN pattern doc 51 P1 (migration 0275, product_inspections) sang
-- process_results — bảng kết quả công đoạn tổng quát, CŨNG là HYPERTABLE Timescale
-- (0118, PK (id, measuredAt)):
--
--   1) 4 CỘT NULLABLE trên process_results (OFF-safe — máy cũ / cờ
--      PROCESS_RESULT_INGEST_ENABLED OFF không đổi byte; một NULL nghĩa là "row có
--      trước 0288 / máy không gửi trường này", đó là sự thật):
--        • server_received_at timestamptz — thời điểm SERVER nhận submission (đồng hồ
--          duy nhất máy không nói dối được); nền cho phát hiện lệch giờ.
--        • time_source varchar(16) — 'device' (máy gửi ts kèm offset) | 'server'
--          (máy không gửi ts → server đóng dấu now()).
--        • idempotency_key varchar(200) — khoá client sinh, ỔN ĐỊNH qua mọi retry của
--          CÙNG một kết quả. AUDIT-ONLY ở cột này; ENFORCEMENT nằm ở ledger dưới.
--        • waveforms jsonb — mảng đường cong (torque-angle, dòng hàn…) cap ~64KB ở
--          tầng app; để riêng khỏi metrics để không phình mọi truy vấn metric vô hướng.
--
--   2) LEDGER RIÊNG "process_idempotency_keys" (mirror inspection_idempotency_keys):
--      process_results là HYPERTABLE → Postgres/Timescale ĐÒI mọi unique index phải
--      chứa cột phân vùng measuredAt (thứ đổi mỗi retry của máy không gửi ts), nên
--      KHÔNG thể đặt unique (machineId, idempotency_key) trực tiếp trên bảng chính.
--      Ràng buộc dời sang bảng THƯỜNG với PK (machineId, idempotencyKey) — hợp lệ &
--      toàn cục. ⚠ KHÔNG BAO GIỜ chuyển bảng này thành hypertable (sẽ mở lại lỗ trùng).
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS / CREATE TABLE|INDEX IF NOT EXISTS.
--   App không đọc cột/bảng mới khi cờ OFF ⇒ áp trước, bật cờ sau đều an toàn.
-- ROLLBACK:
--   ALTER TABLE "process_results" DROP COLUMN IF EXISTS "waveforms";
--   ALTER TABLE "process_results" DROP COLUMN IF EXISTS "idempotency_key";
--   ALTER TABLE "process_results" DROP COLUMN IF EXISTS "time_source";
--   ALTER TABLE "process_results" DROP COLUMN IF EXISTS "server_received_at";
--   DROP TABLE IF EXISTS "process_idempotency_keys";
-- ============================================================================

ALTER TABLE "process_results" ADD COLUMN IF NOT EXISTS "server_received_at" timestamptz;--> statement-breakpoint
ALTER TABLE "process_results" ADD COLUMN IF NOT EXISTS "time_source" varchar(16);--> statement-breakpoint
ALTER TABLE "process_results" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(200);--> statement-breakpoint
ALTER TABLE "process_results" ADD COLUMN IF NOT EXISTS "waveforms" jsonb;--> statement-breakpoint

-- Ledger idempotency-key — BẢNG THƯỜNG, CỐ Ý (mirror inspection_idempotency_keys 0275).
-- KHÔNG BAO GIỜ hypertable-hoá: toàn bộ giá trị nằm ở PK ("machineId","idempotencyKey")
-- KHÔNG chứa cột thời gian — thứ mà hypertable cấm. Hypertable-hoá = vô hiệu chống-trùng.
CREATE TABLE IF NOT EXISTS "process_idempotency_keys" (
  "machineId"      integer      NOT NULL,
  "idempotencyKey" varchar(200) NOT NULL,
  -- process_results (id) mà khoá này đã sinh ra. Soft-ref (hypertable → không FK).
  -- NULL chỉ tồn tại BÊN TRONG transaction đang claim; một row ĐÃ COMMIT mà còn NULL
  -- ⇒ bất biến bị vi phạm (app ném lỗi → WAL đệm, không bịa id).
  "resultId"       integer,
  -- Bản sao measuredAt của kết quả: để retention prune ledger theo cùng chân trời với
  -- process_results mà không phải join ngược vào hypertable.
  "measuredAt"     timestamp,
  "createdAt"      timestamp    NOT NULL DEFAULT now(),
  PRIMARY KEY ("machineId", "idempotencyKey")
);--> statement-breakpoint

-- Prune theo tuổi (retention). KHÔNG có index này thì việc dọn ledger phải seq-scan.
CREATE INDEX IF NOT EXISTS "idx_process_idem_created" ON "process_idempotency_keys" ("createdAt");
