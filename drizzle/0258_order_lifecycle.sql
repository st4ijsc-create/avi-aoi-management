-- W3-A3 (doc 44 G3.6/G3.7) — Order lifecycle layer (SYNAPSE LDS-L3 §8.2/§9.1/§13.1).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (audit T3): production_orders.status là enum cũ pending/in_progress/
-- completed/cancelled/paused — KHÔNG có ALLOCATED/COMPENSATING/REJECTED, không
-- transition audit, không hold/resume/cancel. Enum cũ KHÔNG được đổi (client +
-- máy trạm đang dùng) → vòng đời mới là LỚP TRÊN:
--
--   • production_orders.lifecycle_state varchar(24) NULL — trạng thái §8.2
--     (created|allocated|running|held|compensating|done|failed|rejected).
--     NULL = hàng legacy chưa migrate; khi đọc PROJECT từ status cũ
--     (pending→created, in_progress→running, paused→held, completed→done,
--     cancelled→failed). Khi ghi, orderLifecycleService project NGƯỢC lifecycle
--     xuống status cũ (created/allocated→pending, running→in_progress,
--     held→paused, done→completed, compensating/failed/rejected→cancelled)
--     nên client cũ vẫn sống. KHÔNG backfill — projection thay backfill.
--
--   • order_state_transitions — audit APPEND-ONLY mỗi lần chuyển trạng thái
--     (from → to, reason, actor, correlation_id §5.12.1, metadata). FK CASCADE
--     theo production_orders. Index (orderId, ts) cho đường đọc duy nhất
--     "transitions của đơn X theo thời gian".
--
-- KHÓA PHÂN BỔ (G3.7, quyết định ghi tại orderLifecycleService): giữ chỗ tuyến
-- KHÔNG dùng resource_reservations — partial-unique uq_res_res_active_resource
-- chỉ cho 1 reservation active/resource, mâu thuẫn maxConcurrentOrders>1.
-- Thay bằng SELECT ... FOR UPDATE trên hàng production_lines làm mutex + đếm
-- occupancy trong cùng transaction (occupancy DERIVED từ lifecycle_state →
-- hủy/bù tự nhả chỗ, không có reservation row mồ côi). Không cần cột/bảng mới
-- cho việc giữ chỗ.
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN / CREATE TABLE / CREATE INDEX IF NOT
-- EXISTS; varchar chứ không pg enum; không default, không NOT NULL trên bảng
-- cũ. Numbered 0258 (0257 = line_states, W3-A2). Applied by
-- scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Flag: ORDER_LIFECYCLE_ENABLED (default OFF) gates mọi đường ghi mới.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "production_orders" ADD COLUMN IF NOT EXISTS "lifecycle_state" varchar(24);

CREATE TABLE IF NOT EXISTS "order_state_transitions" (
  "id" serial PRIMARY KEY,
  "orderId" integer NOT NULL REFERENCES "production_orders"("id") ON DELETE CASCADE,
  "fromState" varchar(24),
  "toState" varchar(24) NOT NULL,
  "reason" text,
  "triggeredBy" varchar(120),
  "correlationId" varchar(64),
  "metadata" jsonb,
  "ts" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_ost_order_ts" ON "order_state_transitions" ("orderId", "ts");
