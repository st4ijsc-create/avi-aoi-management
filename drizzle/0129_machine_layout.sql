-- Machine floor-plan transform (rotation + footprint) for the 3D plant view.
-- x/y stay in machines.layoutPositionX/Y (normalized 0–1); this jsonb adds the
-- rest of the transform. Idempotent + nullable (fail-safe; no data migration).
ALTER TABLE machines ADD COLUMN IF NOT EXISTS layout jsonb;
