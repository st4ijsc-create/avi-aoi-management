-- Phase 4 WS4.2 — AI orchestration insights (advisory output of the AI watcher).
CREATE TABLE IF NOT EXISTS ai_insights (
  "id" serial PRIMARY KEY,
  "source" varchar(64) NOT NULL,
  "machineCode" varchar(64),
  "severity" varchar(16) DEFAULT 'warning' NOT NULL,
  "title" varchar(255) NOT NULL,
  "body" text NOT NULL,
  "recommendation" text,
  "contextJson" jsonb,
  "status" varchar(16) DEFAULT 'new' NOT NULL,
  "acknowledgedBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_ai_insights_status_created" ON ai_insights ("status","createdAt");
CREATE INDEX IF NOT EXISTS "idx_ai_insights_machine" ON ai_insights ("machineCode");
