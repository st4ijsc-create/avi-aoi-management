-- ============================================================================
-- Migration 0300: ai_anomaly_profiles — ROC-calibrated threshold (doc69 F3/D2,
-- G9).
--
-- The B3 anomaly-detection memory bank threshold is a fixed p99 self-distance
-- (`ai_anomaly_profiles.threshold`, computed unsupervised from the OK bank's
-- own internal kNN distance distribution). This migration adds two nullable,
-- OPT-IN columns so an admin can additionally calibrate the threshold against
-- LABELLED NG/OK scores to hit a target recall or target FPR (ROC operating
-- point) — see server/services/aiAnomalyCalibration.ts (calibrateThreshold /
-- calibrateAndStore) and server/db/aiAnomaly.ts (setCalibratedThreshold).
--
-- Scorer behaviour (server/services/aiAnomalyDetection.ts scoreFromVector via
-- resolveEffectiveThreshold): calibratedThreshold set → use it; NULL
-- (uncalibrated, the default for every existing row) → fall back to the
-- existing `threshold` (p99), UNCHANGED. Behaviour-preserving.
--
-- ADDITIVE + IDEMPOTENT. Run by owner `aoi` (DDL convention — do not run as a
-- non-owner role). NOT RUN as part of this task (code is fail-safe when these
-- columns are absent — see aiAnomaly.ts getProfile()/getBankStats() 42703
-- undefined_column guard). ROLLBACK: ALTER TABLE "ai_anomaly_profiles" DROP
-- COLUMN IF EXISTS "calibratedThreshold", DROP COLUMN IF EXISTS "calibrationTarget";
-- ============================================================================

ALTER TABLE "ai_anomaly_profiles"
  ADD COLUMN IF NOT EXISTS "calibratedThreshold" numeric(12, 8);

ALTER TABLE "ai_anomaly_profiles"
  ADD COLUMN IF NOT EXISTS "calibrationTarget" json;
