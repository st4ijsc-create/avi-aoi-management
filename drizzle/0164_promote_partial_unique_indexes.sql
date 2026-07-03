-- ============================================================================
-- Migration 0164: Partial UNIQUE indexes enforcing the "single active/released"
-- invariant on state-promotion tables (audit doc 25 · T5).
--
-- PROBLEM: the promote steps (recipe deploy/release/rollback, fleet zone/resource
-- release→promote) did read-then-write WITHOUT an atomic guard. Two concurrent
-- promotions could each pass the "is there already an active one?" read and then
-- both write → TWO active/released rows for the same key (a broken invariant that
-- no DB constraint caught). The service layer now wraps each flow in a
-- transaction + SELECT … FOR UPDATE row lock; THIS migration adds the matching
-- DB-level safety net so the invariant holds even against a future un-locked path.
--
-- WHAT THIS DOES (additive + idempotent — CREATE UNIQUE INDEX IF NOT EXISTS only,
-- no ALTER TYPE, no new pg enum):
--   1. machine_recipes        — at most ONE row per `code` with status='active'
--      (the released/deployed contract). NOTE: the equipment-integration service
--      maps its design status "released" 1:1 onto the DB enum value 'active', so
--      this single index covers BOTH the recipe-deploy and the release/rollback
--      flows — there is no separate 'released' status stored on this table.
--   2. zone_reservations      — at most ONE ACTIVE reservation per (zoneId,
--      deviceId): a device cannot hold two active slots in the same zone
--      (backs the idempotent re-entry invariant; per-zone CAPACITY is a COUNT,
--      not a uniqueness, so it stays enforced in code under the row lock).
--   3. resource_reservations  — at most ONE ACTIVE reservation per resourceId
--      (a shared resource has capacity 1 — single owner at a time).
--
-- CAUTION: a partial UNIQUE index build FAILS if the table ALREADY contains rows
-- that violate it. These features are flag-dormant (machine_recipes deploy /
-- FLEET_ORCH_ENABLED / FLEET_RESOURCE_ENABLED) so the tables are expected empty
-- or clean. If a build errors, dedupe the offending active/released rows first.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

-- 1. machine_recipes — exactly one active (=released) version per code.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_machine_recipes_active_code"
  ON "machine_recipes" ("code")
  WHERE "status" = 'active';

-- 2. zone_reservations — one active slot per (zone, device) (idempotent re-entry).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_zone_res_active_zone_device"
  ON "zone_reservations" ("zoneId", "deviceId")
  WHERE "status" = 'active';

-- 3. resource_reservations — one active owner per shared resource (capacity 1).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_res_res_active_resource"
  ON "resource_reservations" ("resourceId")
  WHERE "status" = 'active';
