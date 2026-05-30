-- WS-2 — Edge Deployment end-to-end (additive, nullable, idempotent)
-- All columns NULLABLE; safe to run on existing data. No I/O change to existing
-- machine endpoints. The partial unique index dedupes any existing rows BEFORE
-- creation so idempotent sync (localResultId) never blocks legacy rows.

-- ── model_versions: integrity hash for edge package verification (two-sided sha256) ──
ALTER TABLE "model_versions" ADD COLUMN IF NOT EXISTS "fileHash" varchar(128);
--> statement-breakpoint

-- ── ai_models: optional integrity hash (parity with model_versions) ──
ALTER TABLE "ai_models" ADD COLUMN IF NOT EXISTS "fileHash" varchar(128);
--> statement-breakpoint

-- ── edge_deployments: packaging version + deploy/activate audit timestamps ──
ALTER TABLE "edge_deployments" ADD COLUMN IF NOT EXISTS "packageVersion" varchar(50);
--> statement-breakpoint
ALTER TABLE "edge_deployments" ADD COLUMN IF NOT EXISTS "deployedAt" timestamp;
--> statement-breakpoint
ALTER TABLE "edge_deployments" ADD COLUMN IF NOT EXISTS "activatedAt" timestamp;
--> statement-breakpoint

-- ── edge_inference_sync: localResultId for idempotent offline-result sync ──
ALTER TABLE "edge_inference_sync" ADD COLUMN IF NOT EXISTS "localResultId" varchar(100);
--> statement-breakpoint

-- Dedupe any pre-existing rows that would collide on (deploymentId, localResultId)
-- before creating the unique index. Keep the lowest id. NULL localResultId rows are
-- excluded from the index (legacy rows without a client-supplied id are never blocked).
DELETE FROM "edge_inference_sync" a
USING "edge_inference_sync" b
WHERE a."id" > b."id"
  AND a."deploymentId" = b."deploymentId"
  AND a."localResultId" = b."localResultId"
  AND a."localResultId" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_edge_sync_deployment_localresult"
  ON "edge_inference_sync" ("deploymentId", "localResultId")
  WHERE "localResultId" IS NOT NULL;
