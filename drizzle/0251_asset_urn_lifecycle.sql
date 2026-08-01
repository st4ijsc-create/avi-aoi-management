-- doc 44 Batch W2-A2 (gap G1.10) — SYNAPSE asset identity: URN + ISA-95 path.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Spec (SYNAPSE Tầng-1 §6.2):
--   urn        = urn:syn:asset:{site}:{line}:{cell}:{equipment}
--   isa95_path = {site}/{area}/{line}/{cell}/{equipment}
-- Segments là SLUG của code các cấp (factory→site, workshop→area, line, station
-- →cell, machine→equipment): lowercase, bỏ dấu tiếng Việt, chỉ [a-z0-9-]; cấp
-- thiếu → 'unassigned' (cùng quy ước slug với UNS topic builder).
--
-- LIFECYCLE (spec §6.3): thêm 2 trạng thái 'registered' (trước commissioning) và
-- 'faulted' (từ active) — machines."lifecycleStatus" là VARCHAR app-validated
-- (KHÔNG pg enum, xem drizzle/schema/hierarchy.ts) nên KHÔNG cần ALTER TYPE;
-- migration này không đổi default ('active' giữ nguyên).
--
-- ADDITIVE + IDEMPOTENT + RE-RUN-SAFE:
--   • ADD COLUMN IF NOT EXISTS (nullable, không default).
--   • Backfill CHỈ các hàng "urn" IS NULL (re-run không ghi đè giá trị đã có).
--   • Khử trùng lặp URN giữa các máy ACTIVE (slug collision, vd 'AOI 01' vs
--     'AOI-01') bằng hậu tố '-m{id}' TRƯỚC khi tạo partial unique index.
--   • Unique CHỈ trên hàng isActive=true (mirror uq_machines_code_active —
--     tombstone giữ URN để truy vết mà không chặn tái sử dụng code).
--   • Hàm slug tạm __syn_slug_0251 được DROP ở cuối (không để lại vết).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0251 (0249 = alert_runbook_ref, 0250 = production_order_external_id;
-- 0252 = config_drift của cùng batch).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "urn" text;
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "isa95_path" text;

-- Slug helper (temporary — dropped at the end of this migration).
-- translate() maps BOTH lower & upper Vietnamese accented letters so the result
-- is locale-independent (lower() in a C locale does not fold non-ASCII).
CREATE OR REPLACE FUNCTION __syn_slug_0251(input text) RETURNS text AS $$
  SELECT COALESCE(
    NULLIF(
      trim(BOTH '-' FROM
        regexp_replace(
          regexp_replace(
            lower(translate(coalesce(input, ''),
              'áàảãạăắằẳẵặâấầẩẫậđéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬĐÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴ',
              'aaaaaaaaaaaaaaaaadeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyAAAAAAAAAAAAAAAAADEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYY')),
            '[^a-z0-9-]+', '-', 'g'),
          '-{2,}', '-', 'g')
      ), ''),
    'unassigned')
$$ LANGUAGE sql IMMUTABLE;

-- Backfill: join the full hierarchy; only rows still missing a URN.
WITH hier AS (
  SELECT
    m.id,
    __syn_slug_0251(f."code")  AS site,
    __syn_slug_0251(w."code")  AS area,
    __syn_slug_0251(pl."code") AS line,
    __syn_slug_0251(s."code")  AS cell,
    __syn_slug_0251(m."code")  AS equip
  FROM "machines" m
  LEFT JOIN "stations"         s  ON s.id  = m."stationId"
  LEFT JOIN "production_lines" pl ON pl.id = s."lineId"
  LEFT JOIN "workshops"        w  ON w.id  = pl."workshopId"
  LEFT JOIN "factories"        f  ON f.id  = w."factoryId"
  WHERE m."urn" IS NULL
)
UPDATE "machines" m SET
  "urn"        = 'urn:syn:asset:' || h.site || ':' || h.line || ':' || h.cell || ':' || h.equip,
  "isa95_path" = h.site || '/' || h.area || '/' || h.line || '/' || h.cell || '/' || h.equip
FROM hier h
WHERE m.id = h.id;

-- De-duplicate among ACTIVE rows (slug collisions): keep the lowest id, suffix
-- the rest with '-m{id}' on the equipment segment (= tail of both urn & path).
WITH dup AS (
  SELECT id, row_number() OVER (PARTITION BY "urn" ORDER BY id) AS rn
  FROM "machines"
  WHERE "isActive" = true AND "urn" IS NOT NULL
)
UPDATE "machines" m SET
  "urn"        = m."urn" || '-m' || m.id::text,
  "isa95_path" = m."isa95_path" || '-m' || m.id::text
FROM dup
WHERE dup.id = m.id AND dup.rn > 1;

-- URN unique among LIVE rows only (mirrors uq_machines_code_active reasoning).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_machines_urn_active"
  ON "machines" ("urn") WHERE "isActive" = true;
CREATE INDEX IF NOT EXISTS "idx_machines_isa95_path"
  ON "machines" ("isa95_path");

DROP FUNCTION IF EXISTS __syn_slug_0251(text);
