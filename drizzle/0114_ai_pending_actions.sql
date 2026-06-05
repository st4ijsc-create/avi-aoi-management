-- GĐ2 — AI Copilot HITL write-action store.
-- New, additive, idempotent. Stores write-actions PROPOSED by the AI Copilot.
-- A write tool never mutates the DB at propose time: it records a `proposed`
-- row here (with a dry-run preview) and waits for an explicit user confirm that
-- re-checks RBAC and executes using args read from THIS row (never the client).
-- TTL (expiresAt) + token (id = uuid bound to userId) + idempotencyKey unique
-- guard against replay / double-execute. Reuses audit_logs for the audit trail
-- (no migration needed for audit).

DO $$ BEGIN
  CREATE TYPE "aipendingactionstatus" AS ENUM (
    'proposed', 'confirmed', 'executed', 'denied', 'expired', 'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_pending_actions" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "tool" varchar(100) NOT NULL,
  "argsJson" json NOT NULL,
  "userId" integer NOT NULL,
  "userRole" varchar(50) NOT NULL,
  "requiredPermissionJson" json,
  "summary" text NOT NULL,
  "previewJson" json,
  "status" "aipendingactionstatus" DEFAULT 'proposed' NOT NULL,
  "idempotencyKey" varchar(128) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "executedAt" timestamp,
  "resultJson" json,
  CONSTRAINT "ai_pending_actions_idempotencyKey_unique" UNIQUE ("idempotencyKey")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_ai_pending_actions_user" ON "ai_pending_actions" ("userId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_pending_actions_status" ON "ai_pending_actions" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_ai_pending_actions_expires" ON "ai_pending_actions" ("expiresAt");
