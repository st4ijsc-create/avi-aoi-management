-- W6-5 G5.24 (doc 44) — ENTERPRISE INTEGRATION: WMS/PLM/CMMS connector persistence.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (SYNAPSE_Tang5 §8–9, ISA-95 MES/ERP/WMS/PLM/CMMS): MES/ERP intake +
-- outbox (circuit-breaker/dead-letter) đã đúng sách, nhưng WMS/PLM/CMMS = 0. Batch
-- này thêm 3 connector bất-đồng-bộ + idempotent + tự-chủ-khi-hệ-ngoài-chết, TÁI
-- DÙNG integration_outbox sẵn có cho outbound. Hai bảng dưới đây là hạ tầng
-- ANTI-CORRUPTION + AUDIT cho connector:
--
--   • enterprise_id_map   — ánh xạ ID hệ-ngoài ↔ canonical (chống rò ngữ nghĩa hệ
--     ngoài vào canonical). W0-F (mig 0250) đã thêm external_id/source_system riêng
--     cho production_orders; bảng này TỔNG QUÁT cho MỌI entity (material/lot/pallet/
--     product/recipe/bom/ecn/work_order/maintenance_schedule) × MỌI hệ (wms/plm/cmms).
--   • enterprise_sync_log — nhật ký mỗi thao tác đồng bộ (inbound/outbound) cho router
--     xem trạng thái + IDEMPOTENCY inbound (partial-unique theo idempotency_key).
--
-- KHÔNG enum mới (varchar) → migration thuần additive (CREATE TABLE/INDEX IF NOT
-- EXISTS). KHÔNG backfill, KHÔNG NOT NULL bắt buộc trên cột suy diễn. Đánh số 0268
-- (0265 = rul_failure_mode; 0266/0267 dành cho các batch W6 song song). Áp bởi
-- scripts/migrate-standalone.mjs, ghi vào __applied_migrations. Cờ connector mặc
-- định OFF → hai bảng này rỗng cho tới khi một hệ được bật + cấu hình.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Anti-corruption ID map: (system, entity_type, external_id) ↔ internal_id ──
CREATE TABLE IF NOT EXISTS "enterprise_id_map" (
  "id"            serial PRIMARY KEY,
  -- Hệ nguồn/đích: 'wms' | 'plm' | 'cmms' (varchar, không enum để additive).
  "system"        varchar(16)  NOT NULL,
  -- Loại thực thể canonical: material | lot | pallet | product | recipe | bom |
  -- ecn | work_order | maintenance_schedule …
  "entity_type"   varchar(48)  NOT NULL,
  -- Định danh phía hệ ngoài (part number / item id / asset id …).
  "external_id"   text         NOT NULL,
  -- Định danh canonical (mã/ID nội bộ, lưu text để tổng quát). NULL = đã thấy
  -- external nhưng chưa map được internal (bookkeeping cho đối soát).
  "internal_id"   text,
  -- Ảnh chụp thuộc tính hệ ngoài (audit anti-corruption; KHÔNG dùng làm canonical).
  "external_ref"  jsonb,
  "corporate_code" varchar(50),
  "created_at"    timestamptz  DEFAULT now() NOT NULL,
  "updated_at"    timestamptz  DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ent_idmap_sys_type_ext"
  ON "enterprise_id_map" ("system", "entity_type", "external_id");
CREATE INDEX IF NOT EXISTS "idx_ent_idmap_internal"
  ON "enterprise_id_map" ("system", "entity_type", "internal_id");

-- ── Sync log: audit + inbound idempotency ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enterprise_sync_log" (
  "id"              serial PRIMARY KEY,
  "system"          varchar(16)  NOT NULL,           -- wms | plm | cmms
  "direction"       varchar(12)  NOT NULL,           -- inbound | outbound
  "operation"       varchar(80)  NOT NULL,           -- vd 'wms.material.request', 'plm.bom.upsert'
  "external_id"     text,
  "internal_id"     text,
  "idempotency_key" varchar(200),
  "status"          varchar(16)  DEFAULT 'ok' NOT NULL, -- ok | error | skipped | duplicate
  "detail"          jsonb,
  "created_at"      timestamptz  DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_ent_synclog_sys_created"
  ON "enterprise_sync_log" ("system", "created_at");
CREATE INDEX IF NOT EXISTS "idx_ent_synclog_status"
  ON "enterprise_sync_log" ("status");
-- Inbound idempotency: một (system, operation, idempotency_key) chỉ áp đúng 1 lần.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_ent_synclog_idem"
  ON "enterprise_sync_log" ("system", "operation", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
