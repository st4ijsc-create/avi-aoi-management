-- ============================================================================
-- Migration 0181: machine asset lifecycle + soft-delete-aware code uniqueness
-- (doc 27 §2 gaps M2 + M3, Đợt 3 agent W3-B).
--
-- M2 — machines.lifecycleStatus varchar(20) NOT NULL DEFAULT 'active'.
--   Repo convention for varchar enums (registrationStatus,
--   aoi_commissioning_records.status): plain varchar, values validated at the
--   app layer — no pg enum / CHECK, so future states never need ALTER TYPE.
--   Values: 'commissioning' | 'active' | 'maintenance' | 'decommissioned'
--         | 'retired'.
--   Legal transitions live in server/db/hierarchy.ts (transitionMachineLifecycle).
--
--   Backfill (runs ONCE, only when the column is first added — guarded by the
--   DO block so a re-run never clobbers real lifecycle states):
--     1. default 'active' for all existing rows (column default)
--     2. registrationStatus='pending'                       → 'commissioning'
--     3. has a signed aoi_commissioning_records row
--        (status='commissioned')                            → 'active'
--     4. soft-deleted rows (isActive=false)                 → 'retired'
--   Order matters: 3 overrides 2 (signed sign-off wins), 4 runs last
--   (tombstones are retired regardless of registration state).
--
-- M3 — soft-delete vs global unique code:
--   DROP the global unique constraint machines_code_unique (from 0000) and
--   replace it with a PARTIAL unique index on (code) WHERE "isActive" = true.
--   Soft-deleted machines keep their code as a tombstone (code column is NOT
--   rewritten) while the code becomes reusable by a new active machine.
--   Restoring a tombstone whose code has been reused raises a clean CONFLICT
--   at the app layer (server/db/hierarchy.ts restoreMachine).
--   Safe to create: the old global unique guarantees no duplicate active codes
--   exist at migration time.
--
-- ADDITIVE + IDEMPOTENT: guarded ALTER/UPDATE, DROP CONSTRAINT IF EXISTS,
-- CREATE INDEX IF NOT EXISTS. No pg enum, no table rewrite (varchar add with
-- default is metadata-only on PG11+). Apply with run-0181-migration.mjs
-- (targeted — does NOT assume 0179/0180/0182 have been applied).
-- ============================================================================

-- ── M2: lifecycleStatus + one-shot backfill ─────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'machines' AND column_name = 'lifecycleStatus'
  ) THEN
    ALTER TABLE "machines" ADD COLUMN "lifecycleStatus" varchar(20) NOT NULL DEFAULT 'active';

    -- 2. pending registrations are still being brought up
    UPDATE "machines" SET "lifecycleStatus" = 'commissioning'
      WHERE "registrationStatus" = 'pending';

    -- 3. a signed commissioning sign-off wins → active
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'aoi_commissioning_records'
    ) THEN
      UPDATE "machines" m SET "lifecycleStatus" = 'active'
        WHERE EXISTS (
          SELECT 1 FROM "aoi_commissioning_records" r
          WHERE r."machineId" = m."id" AND r."status" = 'commissioned' AND r."signedAt" IS NOT NULL
        );
    END IF;

    -- 4. tombstones (soft-deleted) are retired, regardless of the above
    UPDATE "machines" SET "lifecycleStatus" = 'retired'
      WHERE "isActive" = false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_machines_lifecycle" ON "machines" ("lifecycleStatus");

-- ── M3: global unique → partial unique (active rows only) ───────────────────
ALTER TABLE "machines" DROP CONSTRAINT IF EXISTS "machines_code_unique";
-- (some provisioning paths may have created it as a bare unique index instead)
DROP INDEX IF EXISTS "machines_code_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "uq_machines_code_active"
  ON "machines" ("code") WHERE "isActive" = true;
