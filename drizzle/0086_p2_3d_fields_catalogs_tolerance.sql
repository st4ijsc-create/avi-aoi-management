-- ============================================================================
-- Migration 0086: P2 - 3D fields + measurement type catalog + tolerance v2 +
--                 defect catalog + measurement result extensions
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) measurement_point_defs additive nullable columns
-- ----------------------------------------------------------------------------
ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "positionZ" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "heightMin" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "heightMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "heightNominal" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "heightUnit" varchar(20),
  ADD COLUMN IF NOT EXISTS "areaMin" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "areaMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "areaNominal" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "areaUnit" varchar(20),
  ADD COLUMN IF NOT EXISTS "volumeMin" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "volumeMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "volumeNominal" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "volumeUnit" varchar(20),
  ADD COLUMN IF NOT EXISTS "coplanarityMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "warpageMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "voidPctMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "offsetXMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "offsetYMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "tiltMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "thicknessMin" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "thicknessMax" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "depthMapUrl" text,
  ADD COLUMN IF NOT EXISTS "pointCloudUrl" text,
  ADD COLUMN IF NOT EXISTS "measurementTypeCode" varchar(100),
  ADD COLUMN IF NOT EXISTS "toleranceMode" varchar(20),
  ADD COLUMN IF NOT EXISTS "tolPlus" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "tolMinus" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "criteria" jsonb,
  ADD COLUMN IF NOT EXISTS "datumRefs" text[],
  ADD COLUMN IF NOT EXISTS "materialCondition" varchar(10),
  ADD COLUMN IF NOT EXISTS "fitClass" varchar(20);

CREATE INDEX IF NOT EXISTS "idx_point_defs_meas_type_code"
  ON "measurement_point_defs" ("measurementTypeCode");

-- ----------------------------------------------------------------------------
-- 2) measurement_type_catalog + seeds
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "measurement_type_catalog" (
  "id" serial PRIMARY KEY,
  "category" varchar(50) NOT NULL,
  "subType" varchar(80) NOT NULL,
  "code" varchar(100) NOT NULL,
  "nameEn" varchar(200),
  "nameVi" varchar(200),
  "defaultUnit" varchar(20),
  "valueKind" varchar(20),
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  "deletedAt" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_meas_type_catalog_code"
  ON "measurement_type_catalog" ("code");
CREATE INDEX IF NOT EXISTS "idx_meas_type_catalog_category"
  ON "measurement_type_catalog" ("category");
CREATE INDEX IF NOT EXISTS "idx_meas_type_catalog_active"
  ON "measurement_type_catalog" ("isActive");
CREATE INDEX IF NOT EXISTS "idx_meas_type_catalog_deleted_at"
  ON "measurement_type_catalog" ("deletedAt");

INSERT INTO "measurement_type_catalog"
  ("category","subType","code","nameEn","nameVi","defaultUnit","valueKind","description")
VALUES
  ('DIMENSION','LENGTH','DIMENSION.LENGTH','Length','Chiều dài','mm','numeric','Linear length measurement'),
  ('DIMENSION','WIDTH','DIMENSION.WIDTH','Width','Chiều rộng','mm','numeric','Linear width measurement'),
  ('DIMENSION','HEIGHT','DIMENSION.HEIGHT','Height','Chiều cao','mm','numeric','Linear height measurement'),
  ('DIMENSION','DIAMETER','DIMENSION.DIAMETER','Diameter','Đường kính','mm','numeric','Hole / shaft diameter'),
  ('DIMENSION','RADIUS','DIMENSION.RADIUS','Radius','Bán kính','mm','numeric','Arc / fillet radius'),
  ('DIMENSION','ANGLE','DIMENSION.ANGLE','Angle','Góc','deg','numeric','Angular measurement'),
  ('DIMENSION','DISTANCE','DIMENSION.DISTANCE','Distance','Khoảng cách','mm','numeric','Center-to-center / edge distance'),
  ('GD_T','FLATNESS','GD_T.FLATNESS','Flatness','Độ phẳng','mm','numeric','GD&T flatness'),
  ('GD_T','STRAIGHTNESS','GD_T.STRAIGHTNESS','Straightness','Độ thẳng','mm','numeric','GD&T straightness'),
  ('GD_T','CIRCULARITY','GD_T.CIRCULARITY','Circularity','Độ tròn','mm','numeric','GD&T roundness'),
  ('GD_T','CYLINDRICITY','GD_T.CYLINDRICITY','Cylindricity','Độ trụ','mm','numeric','GD&T cylindricity'),
  ('GD_T','PERPENDICULARITY','GD_T.PERPENDICULARITY','Perpendicularity','Độ vuông góc','mm','numeric','GD&T perpendicularity'),
  ('GD_T','PARALLELISM','GD_T.PARALLELISM','Parallelism','Độ song song','mm','numeric','GD&T parallelism'),
  ('GD_T','POSITION','GD_T.POSITION','True Position','Vị trí thật','mm','numeric','GD&T true position'),
  ('GD_T','CONCENTRICITY','GD_T.CONCENTRICITY','Concentricity','Đồng tâm','mm','numeric','GD&T concentricity'),
  ('GD_T','RUNOUT','GD_T.RUNOUT','Runout','Độ đảo','mm','numeric','GD&T runout'),
  ('VISUAL','PRESENCE','VISUAL.PRESENCE','Presence Check','Kiểm tra hiện diện',NULL,'boolean','Component / feature present?'),
  ('VISUAL','OCR','VISUAL.OCR','OCR Text','OCR văn bản',NULL,'text','Optical character recognition'),
  ('VISUAL','BARCODE','VISUAL.BARCODE','Barcode / QR','Mã vạch / QR',NULL,'text','1D / 2D code read'),
  ('VISUAL','COLOR_MATCH','VISUAL.COLOR_MATCH','Color Match','So màu','%','numeric','Color similarity score'),
  ('VISUAL','PATTERN_MATCH','VISUAL.PATTERN_MATCH','Pattern Match','So mẫu','%','numeric','Template matching score'),
  ('PRESENCE','COMPONENT','PRESENCE.COMPONENT','Component Presence','Hiện diện linh kiện',NULL,'boolean','Component placed?'),
  ('PRESENCE','POLARITY','PRESENCE.POLARITY','Polarity','Phân cực',NULL,'boolean','Correct orientation?'),
  ('SOLDER','BRIDGE','SOLDER.BRIDGE','Solder Bridge','Cầu thiếc',NULL,'boolean','Bridge between pads'),
  ('SOLDER','INSUFFICIENT','SOLDER.INSUFFICIENT','Insufficient Solder','Thiếu thiếc',NULL,'boolean','Insufficient solder volume'),
  ('SOLDER','EXCESS','SOLDER.EXCESS','Excess Solder','Thừa thiếc',NULL,'boolean','Excess solder'),
  ('SOLDER','COLD','SOLDER.COLD','Cold Joint','Mối hàn lạnh',NULL,'boolean','Cold solder joint'),
  ('SOLDER','SOLDER_BALL','SOLDER.SOLDER_BALL','Solder Ball','Bi thiếc',NULL,'boolean','Stray solder ball'),
  ('XRAY','VOID','XRAY.VOID','Solder Void %','Tỷ lệ rỗ thiếc','%','numeric','BGA / QFN void percentage'),
  ('XRAY','HIP','XRAY.HIP','Head-In-Pillow','Đầu trên gối',NULL,'boolean','BGA HIP defect'),
  ('XRAY','OPEN','XRAY.OPEN','Open Joint','Hở mối hàn',NULL,'boolean','Open / non-wet joint'),
  ('SOLDER','HEIGHT','SOLDER.HEIGHT','Solder Height','Chiều cao thiếc','um','numeric','SPI solder height'),
  ('SOLDER','VOLUME','SOLDER.VOLUME','Solder Volume','Thể tích thiếc','%','numeric','SPI solder volume'),
  ('SOLDER','AREA','SOLDER.AREA','Solder Area','Diện tích thiếc','%','numeric','SPI solder coverage area'),
  ('SOLDER','COPLANARITY','SOLDER.COPLANARITY','Coplanarity','Độ đồng phẳng','um','numeric','BGA ball coplanarity'),
  ('XRAY','WARPAGE','XRAY.WARPAGE','Warpage','Độ cong vênh','um','numeric','PCB / package warpage'),
  ('POSITION','OFFSET_X','POSITION.OFFSET_X','Offset X','Lệch X','mm','numeric','Component placement offset X'),
  ('POSITION','OFFSET_Y','POSITION.OFFSET_Y','Offset Y','Lệch Y','mm','numeric','Component placement offset Y'),
  ('POSITION','TILT','POSITION.TILT','Tilt','Nghiêng','deg','numeric','Component tilt angle'),
  ('THERMAL','TEMPERATURE','THERMAL.TEMPERATURE','Temperature','Nhiệt độ','degC','numeric','Spot temperature'),
  ('ELECTRICAL','RESISTANCE','ELECTRICAL.RESISTANCE','Resistance','Điện trở','ohm','numeric','In-circuit resistance'),
  ('ELECTRICAL','VOLTAGE','ELECTRICAL.VOLTAGE','Voltage','Điện áp','V','numeric','Voltage measurement'),
  ('ELECTRICAL','CURRENT','ELECTRICAL.CURRENT','Current','Dòng điện','A','numeric','Current measurement'),
  ('COATING','THICKNESS','COATING.THICKNESS','Coating Thickness','Độ dày phủ','um','numeric','Conformal coating thickness'),
  ('SURFACE','ROUGHNESS','SURFACE.ROUGHNESS','Surface Roughness','Độ nhám','um','numeric','Surface Ra/Rz'),
  ('COLOR','RGB','COLOR.RGB','RGB Match','So RGB',NULL,'composite','RGB color vector'),
  ('OTHER','CUSTOM','OTHER.CUSTOM','Custom','Tùy chỉnh',NULL,'text','User-defined measurement')
ON CONFLICT ("code") DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3) defect_catalog + seeds
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "defect_catalog" (
  "id" serial PRIMARY KEY,
  "code" varchar(50) NOT NULL,
  "name" varchar(255) NOT NULL,
  "category" varchar(80) NOT NULL,
  "severity" varchar(20) NOT NULL,
  "ipcReference" varchar(50),
  "acceptanceClass" varchar(2),
  "description" text,
  "referenceImageKey" varchar(255),
  "referenceImageUrl" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW(),
  "deletedAt" timestamp,
  CONSTRAINT "chk_defect_catalog_severity"
    CHECK ("severity" IN ('critical','major','minor','cosmetic'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_defect_catalog_code"
  ON "defect_catalog" ("code");
CREATE INDEX IF NOT EXISTS "idx_defect_catalog_severity"
  ON "defect_catalog" ("severity");
CREATE INDEX IF NOT EXISTS "idx_defect_catalog_category"
  ON "defect_catalog" ("category");
CREATE INDEX IF NOT EXISTS "idx_defect_catalog_active"
  ON "defect_catalog" ("isActive");
CREATE INDEX IF NOT EXISTS "idx_defect_catalog_deleted_at"
  ON "defect_catalog" ("deletedAt");

INSERT INTO "defect_catalog"
  ("code","name","category","severity","ipcReference","acceptanceClass","description")
VALUES
  ('BRIDGING','Bridging','solder','major','5.2.5','2','Solder unintentionally connects adjacent pads or leads'),
  ('INSUFFICIENT_SOLDER','Insufficient Solder','solder','major','5.2.7','2','Solder volume below acceptable minimum'),
  ('EXCESS_SOLDER','Excess Solder','solder','minor','5.2.6','2','Solder volume above acceptable maximum'),
  ('COLD_JOINT','Cold Joint','solder','major','5.2.8','2','Dull or grainy solder joint caused by poor wetting/reflow'),
  ('TOMBSTONING','Tombstoning','component','critical','8.3.5.4','2','Chip component lifted vertically from one pad'),
  ('BILLBOARDING','Billboarding','component','major','8.3.5.3','2','Chip component rotated on edge after reflow'),
  ('LIFTED_LEAD','Lifted Lead','solder','major','7.5.7','2','Component lead does not contact pad correctly'),
  ('SOLDER_BALL','Solder Ball','solder','minor','10.2','2','Stray solder sphere on PCB surface'),
  ('VOID','Void','solder','minor','5.2.12','2','Internal void in solder joint'),
  ('COMPONENT_MISALIGNMENT','Component Misalignment','component','major','8.3.2','2','Placement offset beyond tolerance window'),
  ('MISSING_COMPONENT','Missing Component','component','critical','8.1','2','Required component is missing'),
  ('WRONG_COMPONENT','Wrong Component','component','critical','8.2','2','Incorrect component placed at location'),
  ('REVERSE_POLARITY','Reverse Polarity','component','critical','8.3.10','2','Polarized component orientation is reversed'),
  ('HEAD_IN_PILLOW','Head-in-Pillow (HIP)','solder','critical','5.2.13','2','BGA ball not fully coalesced with solder paste'),
  ('DAMAGED_COMPONENT','Damaged Component','component','major','9.4','2','Component is cracked/chipped/damaged')
ON CONFLICT ("code") DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4) measurement_results additive nullable columns
-- ----------------------------------------------------------------------------
ALTER TABLE "measurement_results"
  ADD COLUMN IF NOT EXISTS "valueZ" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueHeight" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueArea" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueVolume" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueVoidPct" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueCoplanarity" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueWarpage" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueOffsetX" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueOffsetY" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueTilt" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "valueThickness" numeric(15, 6),
  ADD COLUMN IF NOT EXISTS "defectCatalogId" integer,
  ADD COLUMN IF NOT EXISTS "defectSeverity" varchar(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_measurement_results_defect_catalog'
  ) THEN
    ALTER TABLE "measurement_results"
      ADD CONSTRAINT "fk_measurement_results_defect_catalog"
      FOREIGN KEY ("defectCatalogId") REFERENCES "defect_catalog" ("id");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_results_defect_catalog"
  ON "measurement_results" ("defectCatalogId");
CREATE INDEX IF NOT EXISTS "idx_results_defect_severity"
  ON "measurement_results" ("defectSeverity");
