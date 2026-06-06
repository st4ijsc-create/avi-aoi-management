-- Migration: HMAC-bound supervisor sign-off for production_sessions
-- 21 CFR Part 11 §11.70 — cryptographic binding of electronic signature to record.
-- signoffSignature = HMAC-SHA256(SIGNOFF_SECRET, signoffPayload)
-- where signoffPayload = "{sessionId}:{operatorId}:{closedAt-ISO}:{JSON(kpiSnapshot)}"

ALTER TABLE production_sessions
  ADD COLUMN IF NOT EXISTS "signoffPayload"     TEXT,
  ADD COLUMN IF NOT EXISTS "signoffPayloadHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "signoffSignature"   VARCHAR(128),
  ADD COLUMN IF NOT EXISTS "signoffAlgorithm"   VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_ps_signoff_hash
  ON production_sessions ("signoffPayloadHash");
