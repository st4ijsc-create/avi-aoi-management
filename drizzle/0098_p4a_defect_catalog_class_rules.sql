-- P4.A G11 (extension) — Per-IPC-class effective rule on defect_catalog.
-- Class 2 = general electronics, Class 3 = high-reliability
-- (automotive / aerospace / medical). When NULL, callers fall back to the
-- legacy `acceptanceClass` flag column.

ALTER TABLE defect_catalog
  ADD COLUMN IF NOT EXISTS "classRules" jsonb;
