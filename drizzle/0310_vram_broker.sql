-- ============================================================================
-- Migration 0310: vram_events — nhật ký chỉ-ghi-thêm cho module điều phối VRAM
-- (Pha 1 Task 2, docs/superpowers/specs/2026-08-02-vram-broker-design.md).
--
-- Sổ cái SỐNG nằm trong bộ nhớ tiến trình (server/services/vram/vramBroker.ts,
-- Task 1) — bảng này là LỊCH SỬ: mỗi lượt reserve/commit/release/refuse/
-- preempt/drift/adopt/defer ghi một dòng, cho Agent đọc (pha 4) và trả lời
-- Ư7 (bí ẩn nạp CUDA — "lúc đó ai đang giữ gì").
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — do NOT run as
-- non-owner role `avi_app`, sẽ lỗi 42501). Áp lên CẢ DB chính LẪN DB test
-- `aoi_management_test`.
-- ROLLBACK: DROP TABLE "vram_events";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "vram_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "resourceKind" varchar(16) DEFAULT 'vram' NOT NULL,
  "event" varchar(24) NOT NULL,
  "owner" varchar(160) NOT NULL,
  "leaseKind" varchar(32) NOT NULL,
  "priority" varchar(16) NOT NULL,
  "estimatedBytes" bigint,
  "actualBytes" bigint,
  "estimateSource" varchar(16),
  "deviceUsedBytes" bigint,
  "ledgerTotalBytes" bigint,
  "driftBytes" bigint,
  "wouldRefuse" varchar(8),
  "detail" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "vram_events_created_idx" ON "vram_events" ("createdAt");
CREATE INDEX IF NOT EXISTS "vram_events_owner_idx" ON "vram_events" ("owner");
