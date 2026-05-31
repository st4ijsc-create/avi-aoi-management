-- B6 — A/B canary live (additive, nullable, idempotent)
-- Links a quality-gate config to an active A/B experiment so the live inference
-- path can run a canary variant alongside the production decision. The column is
-- NULLABLE and defaults to NULL, so every existing config keeps its exact legacy
-- behaviour (canary branch only activates when activeExperimentId IS NOT NULL and
-- the referenced experiment is RUNNING).

ALTER TABLE "ai_quality_gate_configs"
  ADD COLUMN IF NOT EXISTS "activeExperimentId" integer;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_qg_config_active_experiment"
  ON "ai_quality_gate_configs" ("activeExperimentId")
  WHERE "activeExperimentId" IS NOT NULL;
