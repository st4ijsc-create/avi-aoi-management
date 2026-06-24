-- Chạy MỘT LẦN khi khởi tạo volume Postgres (docker-entrypoint-initdb.d).
-- Phải tạo extension `vector` TRƯỚC mọi migration: 0009 dùng kiểu vector(1024)
-- nhưng 0121 mới CREATE EXTENSION → trên DB mới, 0009 (tạo production_sessions)
-- sẽ fail nếu extension chưa sẵn. Tạo sẵn ở đây để toàn bộ migration chạy trọn vẹn.
CREATE EXTENSION IF NOT EXISTS vector;
