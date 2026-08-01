-- ============================================================================
-- Migration 0191: Component library + capabilities validation (doc 27 §2 M12a/M13,
-- design contract doc 29 §1 + §4 — Đợt 8 / agent W8-A).
--
-- WHAT:
--   1. component_packages + component_footprints — package/footprint master
--      (IPC-7351-leaning naming; family/mountType/density are varchar, NOT pg
--      enums, per the doc 29 §0 additive rules).
--   2. materials."packageId" (nullable int, soft ref -> component_packages.id)
--      + best-effort backfill matching materials."packageType" ≈ package code
--      (mirrors the 0134 materialId-by-code backfill).
--   3. measurement_point_defs."componentCode"/"refDesignator" (nullable) — the
--      Pareto linkage: measurement_results → pointDef.componentCode →
--      materials.packageId → component_packages. Regular table (NOT a
--      hypertable) → plain ADD COLUMN is safe.
--   4. machines."capabilitiesValidation" (nullable jsonb) — doc 29 §4.2 tier-1
--      stamp {checkedAt, deviceTypeKey, ok, errors, unknownKeys}.
--   5. SEED — REFERENCE DATA: ~40 common SMT/THT packages (chip 01005→2512,
--      SOT/SOD, SOIC/TSSOP, QFP/QFN, BGA/CSP, DPAK, tantalum/electrolytic,
--      crystal, LED, generic connectors). Marked origin='seed'; idempotent via
--      ON CONFLICT (code) DO NOTHING so user edits are never overwritten.
--
-- SOFT REFERENCES (deliberate — doc 29 §0.2): NO FK from materials.packageId or
-- component_footprints.packageId in this pass; orphan visibility comes from the
-- weekly integrity/drift scans. FK enforcement is a later cleanup step.
--
-- Idempotent / re-runnable: IF NOT EXISTS + ON CONFLICT everywhere. Applied by
-- the targeted runner scripts/apply-migration-0191.mjs (tracked in
-- __applied_migrations).
-- ============================================================================

-- ── 1. component_packages ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "component_packages" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL,
  "ipcName" varchar(128),
  "family" varchar(40) NOT NULL,
  "mountType" varchar(10) NOT NULL DEFAULT 'SMT',
  "bodyLengthMm" numeric(10,4),
  "bodyWidthMm" numeric(10,4),
  "bodyHeightMm" numeric(10,4),
  "pinCount" integer,
  "pitchMm" numeric(10,4),
  "hasPolarity" boolean NOT NULL DEFAULT false,
  "polarityMark" varchar(40),
  "leadType" varchar(30),
  "inspectionNotes" text,
  "defaultDefects" jsonb,
  "origin" varchar(16) NOT NULL DEFAULT 'manual',
  "isActive" boolean NOT NULL DEFAULT true,
  "deletedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comp_pkg_code" ON "component_packages" ("code");
CREATE INDEX IF NOT EXISTS "idx_comp_pkg_family" ON "component_packages" ("family");
CREATE INDEX IF NOT EXISTS "idx_comp_pkg_active" ON "component_packages" ("isActive");
COMMENT ON TABLE "component_packages" IS
  'Doc 29 §1 (W8-A, 0191): package/footprint master for component-level AOI. Rows with origin=''seed'' are shipped REFERENCE DATA (common SMT packages).';

-- ── component_footprints ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "component_footprints" (
  "id" serial PRIMARY KEY,
  "packageId" integer NOT NULL,
  "code" varchar(64) NOT NULL,
  "density" varchar(10),
  "padCount" integer,
  "geometry" jsonb,
  "courtyardMm" jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comp_fp_pkg_code" ON "component_footprints" ("packageId", "code");
CREATE INDEX IF NOT EXISTS "idx_comp_fp_package" ON "component_footprints" ("packageId");
COMMENT ON TABLE "component_footprints" IS
  'Doc 29 §1 (W8-A, 0191): IPC-7351 land-pattern variants per component_packages row (density M/N/L). Soft ref packageId (no FK yet).';

-- ── 2. materials.packageId (additive, nullable) ─────────────────────────────
ALTER TABLE "materials" ADD COLUMN IF NOT EXISTS "packageId" integer;
CREATE INDEX IF NOT EXISTS "idx_materials_package" ON "materials" ("packageId");
COMMENT ON COLUMN "materials"."packageId" IS
  'Doc 29 §1.2 (W8-A, 0191): soft ref -> component_packages.id. NULL = not yet linked; packageType stays the free-text legacy field. Backfilled best-effort by code match.';

-- ── 3. measurement_point_defs component linkage (additive, nullable) ────────
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "componentCode" varchar(100);
ALTER TABLE "measurement_point_defs" ADD COLUMN IF NOT EXISTS "refDesignator" varchar(64);
CREATE INDEX IF NOT EXISTS "idx_point_defs_component_code"
  ON "measurement_point_defs" ("componentCode")
  WHERE "componentCode" IS NOT NULL;
COMMENT ON COLUMN "measurement_point_defs"."componentCode" IS
  'Doc 29 §1.2 (W8-A, 0191): which component this point measures — relates BY CODE to materials.code (same convention as bomLineItems.componentCode). Pareto chain: results → pointDef → materials.packageId → component_packages.';
COMMENT ON COLUMN "measurement_point_defs"."refDesignator" IS
  'Doc 29 §1.2 (W8-A, 0191): board position of the measured component (e.g. R12, U3).';

-- ── 4. machines.capabilitiesValidation (additive, nullable) ─────────────────
ALTER TABLE "machines" ADD COLUMN IF NOT EXISTS "capabilitiesValidation" jsonb;
COMMENT ON COLUMN "machines"."capabilitiesValidation" IS
  'Doc 29 §4.2 (W8-A, 0191): last validation of machines.capabilities against the deviceTypes attributesSchema — {checkedAt, deviceTypeKey, ok, skipped, errors[], unknownKeys[]}. NULL = never validated. Tier-2 enforcement flag: CAPABILITIES_VALIDATION_ENFORCED.';

-- ── 5. SEED — common package REFERENCE DATA (origin='seed') ──────────────────
-- Body dims are nominal metric (mm); ipcName follows IPC-7351 where canonical.
-- ON CONFLICT (code) DO NOTHING → never overwrites operator-edited rows.
INSERT INTO "component_packages"
  ("code", "ipcName", "family", "mountType", "bodyLengthMm", "bodyWidthMm", "bodyHeightMm", "pinCount", "pitchMm", "hasPolarity", "polarityMark", "leadType", "inspectionNotes", "origin")
VALUES
  -- Chip R/C (imperial names, metric bodies)
  ('01005', 'RESC0402X13N', 'CHIP', 'SMT', 0.4, 0.2, 0.13, 2, NULL, false, NULL, 'no-lead', 'Smallest chip — high tombstone/billboard risk; use highest magnification.', 'seed'),
  ('0201',  'RESC0603X26N', 'CHIP', 'SMT', 0.6, 0.3, 0.26, 2, NULL, false, NULL, 'no-lead', 'Tombstone-prone; verify both terminations wetted.', 'seed'),
  ('0402',  'RESC1005X40N', 'CHIP', 'SMT', 1.0, 0.5, 0.4, 2, NULL, false, NULL, 'no-lead', NULL, 'seed'),
  ('0603',  'RESC1608X55N', 'CHIP', 'SMT', 1.6, 0.8, 0.55, 2, NULL, false, NULL, 'no-lead', NULL, 'seed'),
  ('0805',  'RESC2012X65N', 'CHIP', 'SMT', 2.0, 1.25, 0.65, 2, NULL, false, NULL, 'no-lead', NULL, 'seed'),
  ('1206',  'RESC3216X70N', 'CHIP', 'SMT', 3.2, 1.6, 0.7, 2, NULL, false, NULL, 'no-lead', NULL, 'seed'),
  ('1210',  'RESC3225X70N', 'CHIP', 'SMT', 3.2, 2.5, 0.7, 2, NULL, false, NULL, 'no-lead', NULL, 'seed'),
  ('2010',  'RESC5025X70N', 'CHIP', 'SMT', 5.0, 2.5, 0.7, 2, NULL, false, NULL, 'no-lead', NULL, 'seed'),
  ('2512',  'RESC6332X70N', 'CHIP', 'SMT', 6.3, 3.2, 0.7, 2, NULL, false, NULL, 'no-lead', 'Power resistor — check solder-fillet volume both ends.', 'seed'),
  -- SOT / SOD small-signal
  ('SOT-23-3', 'SOT95P237X112-3N', 'SOT', 'SMT', 2.9, 1.3, 1.12, 3, 0.95, true, 'pin1_orientation', 'gullwing', 'Rotation/mirror errors common — verify orientation vs silkscreen.', 'seed'),
  ('SOT-23-5', 'SOT95P280X145-5N', 'SOT', 'SMT', 2.9, 1.6, 1.45, 5, 0.95, true, 'pin1_orientation', 'gullwing', NULL, 'seed'),
  ('SOT-23-6', 'SOT95P280X145-6N', 'SOT', 'SMT', 2.9, 1.6, 1.45, 6, 0.95, true, 'pin1_orientation', 'gullwing', NULL, 'seed'),
  ('SOT-89',  'SOT89', 'SOT', 'SMT', 4.5, 2.5, 1.5, 3, 1.5, true, 'pin1_orientation', 'gullwing', NULL, 'seed'),
  ('SOT-223', 'SOT230P700X180-4N', 'SOT', 'SMT', 6.5, 3.5, 1.8, 4, 2.3, true, 'tab', 'gullwing', 'Large tab — check tab fillet for opens.', 'seed'),
  ('SOD-123', 'SOD3716X135N', 'SOD', 'SMT', 3.7, 1.6, 1.35, 2, NULL, true, 'band', 'gullwing', 'Diode — cathode band orientation is a hard polarity check.', 'seed'),
  ('SOD-323', 'SOD2513X100N', 'SOD', 'SMT', 2.5, 1.25, 1.0, 2, NULL, true, 'band', 'gullwing', 'Diode — cathode band orientation is a hard polarity check.', 'seed'),
  -- SOIC / TSSOP
  ('SOIC-8',  'SOIC127P600X175-8N', 'SOIC', 'SMT', 4.9, 3.9, 1.75, 8, 1.27, true, 'dot', 'gullwing', 'Pin-1 dot/notch; check bridging at 1.27 mm pitch.', 'seed'),
  ('SOIC-14', 'SOIC127P600X175-14N', 'SOIC', 'SMT', 8.65, 3.9, 1.75, 14, 1.27, true, 'dot', 'gullwing', NULL, 'seed'),
  ('SOIC-16', 'SOIC127P600X175-16N', 'SOIC', 'SMT', 9.9, 3.9, 1.75, 16, 1.27, true, 'dot', 'gullwing', NULL, 'seed'),
  ('TSSOP-16', 'SOP65P640X120-16N', 'TSSOP', 'SMT', 5.0, 4.4, 1.2, 16, 0.65, true, 'dot', 'gullwing', 'Fine pitch 0.65 mm — bridging inspection priority.', 'seed'),
  ('TSSOP-20', 'SOP65P640X120-20N', 'TSSOP', 'SMT', 6.5, 4.4, 1.2, 20, 0.65, true, 'dot', 'gullwing', 'Fine pitch 0.65 mm — bridging inspection priority.', 'seed'),
  -- QFP / QFN
  ('LQFP-32',  'QFP80P900X900X160-32N', 'QFP', 'SMT', 9.0, 9.0, 1.6, 32, 0.8, true, 'dot', 'gullwing', 'Check lead coplanarity + corner bridging.', 'seed'),
  ('LQFP-64',  'QFP50P1200X1200X160-64N', 'QFP', 'SMT', 12.0, 12.0, 1.6, 64, 0.5, true, 'dot', 'gullwing', 'Fine pitch 0.5 mm — bridging + lifted-lead inspection.', 'seed'),
  ('LQFP-100', 'QFP50P1600X1600X160-100N', 'QFP', 'SMT', 16.0, 16.0, 1.6, 100, 0.5, true, 'dot', 'gullwing', 'Fine pitch 0.5 mm — bridging + lifted-lead inspection.', 'seed'),
  ('QFN-16', 'QFN50P300X300X100-16N', 'QFN', 'SMT', 3.0, 3.0, 1.0, 16, 0.5, true, 'dot', 'no-lead', 'Bottom-terminated — solder joints only partially visible; SPI/AXI recommended.', 'seed'),
  ('QFN-32', 'QFN50P500X500X100-32N', 'QFN', 'SMT', 5.0, 5.0, 1.0, 32, 0.5, true, 'dot', 'no-lead', 'Bottom-terminated — thermal-pad voiding needs X-ray.', 'seed'),
  ('QFN-48-7x7', 'QFN50P700X700X100-48N', 'QFN', 'SMT', 7.0, 7.0, 1.0, 48, 0.5, true, 'dot', 'no-lead', 'Bottom-terminated — thermal-pad voiding needs X-ray.', 'seed'),
  -- BGA / CSP
  ('BGA-64',   'BGA64C100P8X8', 'BGA', 'SMT', 10.0, 10.0, 1.4, 64, 1.0, true, 'chamfer', 'ball', 'Joints hidden — AXI/X-ray only; optical checks placement/rotation.', 'seed'),
  ('BGA-256',  'BGA256C100P16X16', 'BGA', 'SMT', 17.0, 17.0, 1.5, 256, 1.0, true, 'chamfer', 'ball', 'Joints hidden — AXI/X-ray only; optical checks placement/rotation.', 'seed'),
  ('WLCSP-generic', NULL, 'CSP', 'SMT', NULL, NULL, NULL, NULL, 0.4, true, 'dot', 'ball', 'Wafer-level CSP — die-sized; X-ray for joints.', 'seed'),
  -- Power packages
  ('DPAK',  'TO228P970X238-3N', 'DPAK', 'SMT', 6.6, 6.1, 2.38, 3, 2.28, true, 'tab', 'gullwing', 'TO-252 — tab fillet + die tilt.', 'seed'),
  ('D2PAK', 'TO254P1516X465-3N', 'DPAK', 'SMT', 10.2, 9.1, 4.65, 3, 2.54, true, 'tab', 'gullwing', 'TO-263 — heavy body, check for skew/lift.', 'seed'),
  -- Polarized capacitors
  ('CAP-TANT-A', 'CAPMP3216X180N', 'TANTALUM', 'SMT', 3.2, 1.6, 1.8, 2, NULL, true, 'band', 'no-lead', 'EIA 3216-18 (Kemet A). Polarity band = POSITIVE on tantalum — reversed part is a critical defect.', 'seed'),
  ('CAP-TANT-B', 'CAPMP3528X210N', 'TANTALUM', 'SMT', 3.5, 2.8, 2.1, 2, NULL, true, 'band', 'no-lead', 'EIA 3528-21 (Kemet B).', 'seed'),
  ('CAP-TANT-C', 'CAPMP6032X280N', 'TANTALUM', 'SMT', 6.0, 3.2, 2.8, 2, NULL, true, 'band', 'no-lead', 'EIA 6032-28 (Kemet C).', 'seed'),
  ('CAP-ELEC-6.3', 'CAPAE660X620N', 'ELECTROLYTIC', 'SMT', 6.6, 6.6, 6.2, 2, NULL, true, 'band', 'no-lead', 'SMT aluminium electrolytic ⌀6.3 — polarity band = NEGATIVE; check bulge/tilt.', 'seed'),
  ('CAP-ELEC-8',   'CAPAE830X1020N', 'ELECTROLYTIC', 'SMT', 8.3, 8.3, 10.2, 2, NULL, true, 'band', 'no-lead', 'SMT aluminium electrolytic ⌀8.', 'seed'),
  ('CAP-ELEC-10',  'CAPAE1030X1020N', 'ELECTROLYTIC', 'SMT', 10.3, 10.3, 10.2, 2, NULL, true, 'band', 'no-lead', 'SMT aluminium electrolytic ⌀10.', 'seed'),
  -- Misc frequent
  ('XTAL-3225', 'XTAL3225', 'CRYSTAL', 'SMT', 3.2, 2.5, 0.8, 4, NULL, true, 'dot', 'no-lead', 'Crystal — orientation dot; joints under body corners.', 'seed'),
  ('XTAL-5032', 'XTAL5032', 'CRYSTAL', 'SMT', 5.0, 3.2, 1.0, 4, NULL, true, 'dot', 'no-lead', NULL, 'seed'),
  ('LED-0603', 'LEDC1608X55N', 'LED', 'SMT', 1.6, 0.8, 0.55, 2, NULL, true, 'notch', 'no-lead', 'LED — cathode notch/green-mark; polarity critical.', 'seed'),
  ('LED-0805', 'LEDC2012X65N', 'LED', 'SMT', 2.0, 1.25, 0.65, 2, NULL, true, 'notch', 'no-lead', 'LED — cathode notch/green-mark; polarity critical.', 'seed'),
  ('CONN-SMT-GENERIC', NULL, 'CONN', 'SMT', NULL, NULL, NULL, NULL, NULL, true, 'custom', 'gullwing', 'Generic SMT connector — verify housing seating + pin coplanarity; refine per part.', 'seed'),
  ('CONN-THT-GENERIC', NULL, 'CONN', 'THT', NULL, NULL, NULL, NULL, NULL, true, 'custom', 'radial', 'Generic THT connector — verify barrel fill ≥75% (IPC-A-610 class 2/3).', 'seed')
ON CONFLICT ("code") DO NOTHING;

-- ── Backfill materials.packageId best-effort (packageType ≈ package code) ────
-- Case-insensitive, trimmed exact match only (no fuzzy) — mirrors 0134's
-- conservative code-match backfill. Never overwrites an existing link.
UPDATE "materials" m
SET "packageId" = cp."id"
FROM "component_packages" cp
WHERE m."packageId" IS NULL
  AND m."packageType" IS NOT NULL
  AND upper(trim(m."packageType")) = upper(cp."code");
