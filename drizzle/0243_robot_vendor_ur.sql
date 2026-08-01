-- doc 40 W5 (MTX-12) — thêm vendor 'ur' (Universal Robots) vào robotvendorenum.
-- ursimBridge bọc UrsimClient (URScript + Dashboard) thành RobotDriver 'ur'; để lưu
-- được robots.vendor = 'ur' xuống DB cần giá trị enum này.
-- Additive, idempotent (ADD VALUE tự-commit). Owner tự áp — chưa chạy.
ALTER TYPE "robotvendorenum" ADD VALUE IF NOT EXISTS 'ur';
