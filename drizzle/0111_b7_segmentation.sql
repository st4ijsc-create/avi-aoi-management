-- ============================================================================
-- B7 — Segmentation mask + sub-pixel metrology.
--
-- Tạo bảng `defect_segmentations`: lưu mask vùng defect (QC vẽ tay hoặc model
-- segmentation sinh ra) kèm số đo metrology (area/perimeter/Feret/equivDia).
--
-- IDEMPOTENT: an toàn chạy lại (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- BACKWARD-COMPATIBLE: chỉ THÊM bảng mới; mọi cột scope nullable; không đụng
-- schema cũ. Đơn vị vật lý NULL khi thiếu calibration (degrade trung thực).
-- ============================================================================

CREATE TABLE IF NOT EXISTS "defect_segmentations" (
  "id" serial PRIMARY KEY NOT NULL,
  "measurementResultId" integer,
  "inspectionId" integer,
  "imageUrl" text,
  "modelId" integer,
  "modelVersion" varchar(50),
  "source" varchar(16) NOT NULL,
  "maskFormat" varchar(16) DEFAULT 'polygon' NOT NULL,
  "maskData" json NOT NULL,
  "classLabel" varchar(120) NOT NULL,
  "defectCatalogId" integer,
  "confidence" numeric(6, 4),
  "areaPx" numeric(16, 4),
  "perimeterPx" numeric(16, 4),
  "feretMaxPx" numeric(16, 4),
  "feretMinPx" numeric(16, 4),
  "equivDiaPx" numeric(16, 4),
  "umPerPx" numeric(16, 8),
  "areaUnit" varchar(8),
  "lengthUnit" varchar(8),
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_defect_seg_measurement" ON "defect_segmentations" ("measurementResultId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_defect_seg_inspection" ON "defect_segmentations" ("inspectionId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_defect_seg_model" ON "defect_segmentations" ("modelId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_defect_seg_source" ON "defect_segmentations" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_defect_seg_created" ON "defect_segmentations" ("createdAt");
