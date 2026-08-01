-- ============================================================================
-- Migration 0185 (doc 27 §6 gap A11 — W5-D):
-- Pluggable scheduled-report delivery with retry.
--
--   1. `report_deliveries` — per-channel delivery ledger for scheduled
--      reports (queued → sent | failed → dead), one row per (report run ×
--      channel). Drained by the report-delivery worker with exponential
--      backoff; rows that exhaust their attempt budget are dead-lettered.
--   2. `scheduled_reports.deliveryChannels` — optional jsonb channel config:
--        { "email":  { "enabled": true },
--          "webhook":{ "enabled": true, "url": "...", "secret": "..." },
--          "inApp":  { "enabled": true, "userIds": [1,2] } }
--      NULL (the default for every existing row) = LEGACY semantics: direct
--      e-mail to `recipients` exactly as before this migration — behaviour
--      unchanged until an admin opts a report into channels.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "report_deliveries" (
  "id" serial PRIMARY KEY,
  "scheduledReportId" integer NOT NULL,
  -- 'email' | 'webhook' | 'in_app'
  "channel" varchar(20) NOT NULL,
  -- email: comma-joined recipient list · webhook: target URL · in_app: user id list
  "target" text NOT NULL,
  -- 'queued' | 'sent' | 'failed' | 'dead'
  "status" varchar(10) NOT NULL DEFAULT 'queued',
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  -- Subject / reportType / attachment name+size snapshot for the history UI.
  "payloadMeta" jsonb,
  "nextAttemptAt" timestamp NOT NULL DEFAULT now(),
  "sentAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- History drawer: newest deliveries of one report.
CREATE INDEX IF NOT EXISTS "idx_report_deliveries_report"
  ON "report_deliveries" ("scheduledReportId", "createdAt" DESC);

-- Drain worker: due rows only.
CREATE INDEX IF NOT EXISTS "idx_report_deliveries_due"
  ON "report_deliveries" ("status", "nextAttemptAt");

ALTER TABLE "scheduled_reports"
  ADD COLUMN IF NOT EXISTS "deliveryChannels" jsonb;
