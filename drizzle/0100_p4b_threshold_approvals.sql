-- ============================================================================
-- Migration 0100: P4.B G18 — Threshold suggestion approval workflow
-- Stores operator-submitted suggestions and the decision audit trail.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "threshold_approvals" (
  "id" SERIAL PRIMARY KEY,
  "pointDefId" INTEGER NOT NULL REFERENCES "measurement_point_defs"("id") ON DELETE CASCADE,
  "requestedBy" INTEGER NOT NULL REFERENCES "users"("id"),
  "suggestion" JSONB NOT NULL,
  "currentLsl" NUMERIC(18,6),
  "currentUsl" NUMERIC(18,6),
  "currentNominal" NUMERIC(18,6),
  "proposedLsl" NUMERIC(18,6) NOT NULL,
  "proposedUsl" NUMERIC(18,6) NOT NULL,
  "proposedNominal" NUMERIC(18,6),
  "status" VARCHAR(20) NOT NULL DEFAULT 'requested',
  "comment" TEXT,
  "decidedBy" INTEGER REFERENCES "users"("id"),
  "decidedAt" TIMESTAMP,
  "decidedComment" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "threshold_approvals_status_chk"
    CHECK ("status" IN ('requested','approved','rejected','applied','withdrawn'))
);

CREATE INDEX IF NOT EXISTS "idx_threshold_approvals_pointdef"
  ON "threshold_approvals" ("pointDefId");
CREATE INDEX IF NOT EXISTS "idx_threshold_approvals_status"
  ON "threshold_approvals" ("status");
CREATE INDEX IF NOT EXISTS "idx_threshold_approvals_requestedby"
  ON "threshold_approvals" ("requestedBy");
