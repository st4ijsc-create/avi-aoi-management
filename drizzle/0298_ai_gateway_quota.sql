-- ============================================================================
-- Migration 0298: ai_gateway_quota — per-user/role daily (rolling 24h) AI token
-- budget (doc69 G2-4).
--
-- Enforcement lives in server/services/aiGateway.ts (planInference) + reads via
-- server/services/aiGatewayQuota.ts, gated by AI_QUOTA_ENFORCE (default OFF — ships
-- dark/opt-in; see the flag's doc comment in aiGateway.ts). This table only stores
-- the BUDGET; actual usage is read from the existing ai_gateway_metrics table
-- (rolling 24h sum of tokensIn+tokensOut) — no separate counter to keep in sync.
--
-- Row scoping (resolution order used by aiGatewayQuota.resolveQuotaBudget):
--   userId set          -> per-user budget (highest priority)
--   userId null, role set -> per-role default budget
--   userId null, role null -> deployment-wide default budget
-- At most ONE enabled row per userId, and at most ONE enabled role-only row per
-- role (partial unique indexes below) — an admin can still keep disabled/historical
-- rows around (enabled=false) without violating either constraint.
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — do not run as a
-- non-owner role). ROLLBACK: DROP TABLE "ai_gateway_quota";
-- ============================================================================

CREATE TABLE IF NOT EXISTS "ai_gateway_quota" (
  "id" serial PRIMARY KEY,
  "userId" integer,
  "role" varchar(32),
  "dailyTokenBudget" integer NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "notes" text,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- At most one ENABLED budget row per user.
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_gateway_quota_user_enabled"
  ON "ai_gateway_quota" ("userId")
  WHERE "userId" IS NOT NULL AND "enabled" = true;

-- At most one ENABLED role-level default per role (userId must be null on these rows).
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ai_gateway_quota_role_enabled"
  ON "ai_gateway_quota" ("role")
  WHERE "userId" IS NULL AND "role" IS NOT NULL AND "enabled" = true;

CREATE INDEX IF NOT EXISTS "idx_ai_gateway_quota_created" ON "ai_gateway_quota" ("createdAt");
