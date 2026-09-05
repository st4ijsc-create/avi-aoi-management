-- ============================================================================
-- Migration 0349 — BG-93 (Lô 10 Mục 1): audit_logs → hypertable + retention
-- policy 365 ngày (docs/superpowers/specs/2026-09-05-aoi-bg93-audit-logs-retention-plan.md).
--
-- ════════════════════════════════════════════════════════════════════════════
-- VÌ SAO — audit_logs là bảng WORM không tác vụ dọn (BG-93 gốc)
-- ════════════════════════════════════════════════════════════════════════════
-- `audit_logs` chỉ cấp `avi_app` INSERT+SELECT (mig 0224, WORM — ĐÚNG CHỦ ĐÍCH,
-- migration này KHÔNG đụng grants đó). Không role ứng dụng nào xóa được, và
-- không job retention nào tồn tại ⇒ bảng phình vô hạn (~2 GB/năm ước lượng khi
-- chạy thật). Dùng đúng cơ chế repo đã vận hành cho 5 bảng khác
-- (product_inspections, measurement_results, ot_telemetry, oee_metrics,
-- machine_heartbeats, process_results — xem drizzle/0172_inspection_hypertables.sql):
-- TimescaleDB retention policy DROP CẢ CHUNK (không phải DELETE hàng), chạy
-- dưới owner của policy — KHÔNG đụng grants avi_app ⇒ WORM giữ nguyên đúng
-- nghĩa: ứng dụng không xóa được gì, vòng đời do hạ tầng DB quản.
--
-- ════════════════════════════════════════════════════════════════════════════
-- RULING (controller, Lô 10, đo Đ-28 trên aoi_management 2026-09-05) — PK ghép
-- theo TIỀN LỆ REPO, không phải quyết định mới:
-- ════════════════════════════════════════════════════════════════════════════
-- `create_hypertable` đòi cột partition nằm trong MỌI unique index/PK (lỗi thật
-- đã đo trong transaction rollback, Lô 10 báo cáo lần 1):
--   TS103: cannot create a unique index without the column "createdAt"
--          (used in partitioning)
-- `audit_logs_pkey` hiện là PRIMARY KEY (id) đơn cột. CẢ 5 hypertable hiện có
-- của repo này đều đã trải qua ĐÚNG bước rewrite PK này ở 0172:
--   product_inspections(id,"inspectionTime") · measurement_results(id,"createdAt")
--   · ot_telemetry(id,"ts") · machine_heartbeats(id,"timestamp") · oee_metrics(id,"timestamp")
-- Đo Đ-28 trước khi rewrite PK (Lô 10, avi_app, information_schema +
-- pg_constraint/pg_depend trên CẢ HAI DB dev/test): **0 FK trỏ vào audit_logs**
-- (referencing hoặc referenced), 0 pg_depend khác trên audit_logs_pkey ngoài
-- chính ràng buộc đó. Giá nếu ruling sai: tính duy-nhất LÝ THUYẾT của `id` đơn
-- cột yếu đi (giờ duy nhất theo cặp (id,"createdAt")) — nhưng `id` là SERIAL
-- không lặp giá trị trong đời bảng, nên PK ghép vẫn duy nhất trên thực tế y hệt
-- PK đơn — đúng trade-off cả 5 bảng kia đã nhận, không phải rủi ro mới.
--
-- ════════════════════════════════════════════════════════════════════════════
-- KHÔNG có một câu DELETE/UPDATE dữ liệu nào trong migration này.
-- ════════════════════════════════════════════════════════════════════════════
-- IDEMPOTENT (BG-95): mọi bước bọc trong kiểm tra "đã là hypertable thì bỏ qua"
-- + `if_not_exists => TRUE` — tái chạy nhiều lần an toàn, không tạo lại gì đã
-- có, không rewrite PK lần hai (PK rewrite chỉ chạy trong nhánh chưa-là-hypertable).
--
-- ⚠ migrate_data => TRUE khóa bảng trong lúc chuyển — với dev/test (nghìn-chục
-- nghìn hàng) là tức thời; môi trường thật PHẢI chạy trong cửa sổ bảo trì
-- (plan §5 điều kiện 1, còn hiệu lực).
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM timescaledb_information.hypertables
                 WHERE hypertable_name = 'audit_logs') THEN
    ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_pkey;
    ALTER TABLE audit_logs ADD PRIMARY KEY (id, "createdAt");
    PERFORM create_hypertable('audit_logs', 'createdAt',
      chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE, migrate_data => TRUE);
  END IF;

  -- Retention 365 ngày (chủ dự án chốt 2026-09-05) — background worker Timescale
  -- drop cả chunk quá hạn, không phải DELETE hàng. if_not_exists tránh policy trùng.
  PERFORM add_retention_policy('audit_logs', drop_after => INTERVAL '365 days', if_not_exists => TRUE);

  RAISE NOTICE '[0349] audit_logs: hypertable (PK ghép id+createdAt theo tiền lệ 0172, 0 FK đo được) + retention 365 ngày (BG-93).';
END $$;
