-- ============================================================================
-- Migration 0166: Immutable shared audit trail for config/safety actions
-- (audit doc 25 · T6 / task W2-7).
--
-- PROBLEM: config/safety mutations had NO immutable audit chain:
--   • interlock: delete = HARD DELETE of a safety rule; edit/enable/disable did
--     not record who/what changed.
--   • equipment-standards board: register/review/approve/publish/reject unlogged.
--   • workforce/collaboration: closeAssignment/abortCollaboration recorded no actor.
--
-- WHAT THIS DOES (additive + idempotent — CREATE TABLE/INDEX IF NOT EXISTS + ADD
-- COLUMN IF NOT EXISTS only; no ALTER TYPE, no new pg enum):
--   1. CREATE TABLE control_audit_log — one append-only row per config/safety event
--      (WHO=actorId did WHAT=action to WHICH=entityType/entityId, with before/after
--      jsonb snapshots + free-text reason). Immutability is enforced at the service
--      layer (INSERT-only helper recordAuditEvent — no update/delete path).
--   2. Add closedBy / abortedBy provenance columns so the workforce close/abort
--      mutations can stamp the acting user directly on the row (in addition to the
--      audit entry).
--
-- HONESTY: SCHEMA + logging only. This opens NO device-control path and changes no
-- existing query behaviour; it strictly ADDS an audit record on top of what exists.
--
-- Applied by the normal migrate step (scripts/migrate-standalone.mjs), tracked in
-- __applied_migrations. Re-runnable.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "control_audit_log" (
  "id"         serial PRIMARY KEY,
  "entityType" varchar(64) NOT NULL,
  "entityId"   varchar(128) NOT NULL,
  "action"     varchar(48) NOT NULL,
  "actorId"    integer,
  "beforeJson" jsonb,
  "afterJson"  jsonb,
  "reason"     text,
  "createdAt"  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_control_audit_entity"
  ON "control_audit_log" ("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "idx_control_audit_actor"
  ON "control_audit_log" ("actorId");
CREATE INDEX IF NOT EXISTS "idx_control_audit_created"
  ON "control_audit_log" ("createdAt");

-- Provenance for the workforce/collaboration terminal actions.
ALTER TABLE "operator_assignments"   ADD COLUMN IF NOT EXISTS "closedBy"  integer;
ALTER TABLE "collaboration_sessions" ADD COLUMN IF NOT EXISTS "abortedBy" integer;
