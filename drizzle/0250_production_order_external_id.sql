-- W0-F G5.6 (doc 44) — external_id/source_system trên production_orders.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: intake ERP/MES (POST /api/v1/orders, R0 doc 16) upsert theo
-- orderCode nhưng KHÔNG lưu định danh của hệ nguồn → không đối soát 2 chiều
-- được (ERP hỏi "đơn X của tôi ứng lệnh nào?" là chịu).
--
-- Thêm 2 cột nullable + unique partial index:
--   • external_id   text — id/mã đơn hàng phía hệ thống nguồn.
--   • source_system text — tên hệ nguồn (vd. "SAP", "oracle-mes", "b2mml").
--   • UNIQUE (external_id, source_system) WHERE external_id IS NOT NULL —
--     một đơn nguồn chỉ map đúng 1 lệnh sản xuất; đơn tạo tay (NULL) không bị ràng.
-- Wire: erpIntake handleOrderIntake ghi 2 trường này KHI payload có (optional,
-- không đổi hợp đồng cũ — thiếu trường → NULL như trước).
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN / CREATE INDEX IF NOT EXISTS, không default,
-- không backfill, không NOT NULL. Numbered 0250 (0249 = alert runbook_ref).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "external_id" text;
ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "source_system" text;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_po_external_source"
  ON "production_orders" ("external_id", "source_system")
  WHERE "external_id" IS NOT NULL;
