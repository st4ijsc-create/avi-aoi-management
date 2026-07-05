-- Chạy MỘT LẦN khi khởi tạo volume Postgres (docker-entrypoint-initdb.d).
-- Phải tạo extension `vector` TRƯỚC mọi migration: 0009 dùng kiểu vector(1024)
-- nhưng 0121 mới CREATE EXTENSION → trên DB mới, 0009 (tạo production_sessions)
-- sẽ fail nếu extension chưa sẵn. Tạo sẵn ở đây để toàn bộ migration chạy trọn vẹn.
CREATE EXTENSION IF NOT EXISTS vector;

-- Doc 27 §11 quyết định #1: TimescaleDB BẮT BUỘC trên DB chính (migration 0172
-- hypertable hóa product_inspections/measurement_results/telemetry). Image
-- timescale/timescaledb-ha:pg17 có sẵn extension; guard để file init này vẫn
-- chạy được trên image chỉ-pgvector cũ (khi đó 0172 sẽ RAISE WARNING và startup
-- check in banner lỗi cho đến khi đổi image).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    CREATE EXTENSION IF NOT EXISTS timescaledb;
  ELSE
    RAISE WARNING 'timescaledb extension not available on this image — doc 27 decision #1 requires timescale/timescaledb-ha for the main DB';
  END IF;
END $$;
