-- ============================================================================
-- Migration 0289: PROCESS STEP VOCABULARY + SPEC LIMITS
--   (doc 56 Đ1 việc 6 / Trục 4 — TAX-12, API-4, AILOCAL-5).
--
-- Hai bảng REFERENCE data-driven cho luồng RESULT tổng quát (KHÔNG pg enum — theo
-- repo convention: danh mục mở rộng bằng ROW chứ không ALTER TYPE):
--
--   1) process_step_types — TỪ VỰNG stepType (code unique). Thay việc hard-code danh
--      sách công đoạn; zod ingest sẽ check code tồn tại (mode log→enforce). machineType
--      NULL = áp cho mọi họ máy.
--
--   2) process_spec_limits — GIỚI HẠN spec per (stepType, metricKey), scope tuỳ chọn
--      theo machineType và/hoặc productModelId. Thứ tự resolve (consumer nối ở Đ4/Đ5):
--      product-specific (productModelId khớp) > machineType default > global. Consumer:
--      (a) spec-gate server tại submitProcessResult (PROCESS_SPEC_GATE_ENABLED — server
--      tự đánh giá pass/fail per metric như spec-gate inspection); (b) SPC/CPK nguồn 2;
--      (c) Threshold Advisor. Đợt này CHỈ tạo bảng + seed ví dụ.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE IF NOT EXISTS; seed step-types ON CONFLICT
--   (code) DO NOTHING; seed spec-limits guarded WHERE NOT EXISTS (bảng KHÔNG có khoá
--   tự nhiên non-null — machineType/productModelId nullable nên ON CONFLICT không dedupe
--   đáng tin, dùng NOT EXISTS thay thế).
-- ROLLBACK: DROP TABLE IF EXISTS "process_spec_limits"; DROP TABLE IF EXISTS "process_step_types";
-- ============================================================================

-- ── (1) process_step_types ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "process_step_types" (
  "id"          serial PRIMARY KEY,
  "code"        varchar(64) NOT NULL UNIQUE,
  "nameVi"      varchar(256),
  "nameEn"      varchar(256),
  "machineType" varchar(40),
  "active"      boolean NOT NULL DEFAULT true,
  "createdAt"   timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pst_machine_type" ON "process_step_types" ("machineType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pst_active" ON "process_step_types" ("active");--> statement-breakpoint

-- Seed công đoạn theo 3 họ máy nội bộ (SCREWDRIVE/DISPENSING/WELDER) + công đoạn
-- generic (machineType NULL = dùng cho mọi loại máy).
INSERT INTO "process_step_types" ("code", "nameVi", "nameEn", "machineType") VALUES
  ('screw_tightening', 'Siết vít',           'Screw tightening',   'SCREWDRIVE'),
  ('glue_dispense',    'Bơm keo',            'Glue dispensing',    'DISPENSING'),
  ('weld_spot',        'Hàn điểm',           'Spot welding',       'WELDER'),
  ('leak_test',        'Kiểm tra rò rỉ',     'Leak test',          NULL),
  ('functional_test',  'Kiểm tra chức năng', 'Functional test',    NULL),
  ('press_fit',        'Ép chi tiết',        'Press fit',          'ASSEMBLY'),
  ('label_apply',      'Dán nhãn',           'Label apply',        'PACKAGING'),
  ('vision_check',     'Kiểm tra thị giác',  'Vision check',       NULL)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ── (2) process_spec_limits ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "process_spec_limits" (
  "id"             serial PRIMARY KEY,
  "machineType"    varchar(40),
  "productModelId" integer,
  "stepType"       varchar(64) NOT NULL,
  "metricKey"      varchar(64) NOT NULL,
  "unit"           varchar(32),
  "lsl"            double precision,
  "usl"            double precision,
  "nominal"        double precision,
  "active"         boolean NOT NULL DEFAULT true,
  "createdBy"      integer,
  "approvedBy"     integer,
  "createdAt"      timestamp NOT NULL DEFAULT now(),
  "updatedAt"      timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_psl_step_metric" ON "process_spec_limits" ("stepType","metricKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_psl_machine_type" ON "process_spec_limits" ("machineType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_psl_product_model" ON "process_spec_limits" ("productModelId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_psl_active" ON "process_spec_limits" ("active");--> statement-breakpoint

-- Seed VÍ DỤ cho screw_tightening (machineType-default, chưa gắn productModelId).
-- Guarded WHERE NOT EXISTS ⇒ idempotent. Consumer thật (Đ4/Đ5) sẽ bơm dữ liệu qua UI.
INSERT INTO "process_spec_limits" ("machineType","stepType","metricKey","unit","lsl","usl","nominal")
  SELECT 'SCREWDRIVE','screw_tightening','torque','Nm',1.2,1.8,1.5
  WHERE NOT EXISTS (
    SELECT 1 FROM "process_spec_limits"
    WHERE "stepType"='screw_tightening' AND "metricKey"='torque'
      AND "machineType"='SCREWDRIVE' AND "productModelId" IS NULL
  );--> statement-breakpoint
INSERT INTO "process_spec_limits" ("machineType","stepType","metricKey","unit","lsl","usl","nominal")
  SELECT 'SCREWDRIVE','screw_tightening','angle','deg',180,400,270
  WHERE NOT EXISTS (
    SELECT 1 FROM "process_spec_limits"
    WHERE "stepType"='screw_tightening' AND "metricKey"='angle'
      AND "machineType"='SCREWDRIVE' AND "productModelId" IS NULL
  );
