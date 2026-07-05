-- doc 33 W4 (F8 §5.1.2) — durable RunEvent log for replay-from-events.
-- Additive + idempotent. Appended (best-effort) at run transitions when FOE_DURABLE is on.
CREATE TABLE IF NOT EXISTS "orchestration_run_events" (
  "id" serial PRIMARY KEY,
  "runId" integer NOT NULL,
  "seq" integer NOT NULL,
  "type" varchar(48) NOT NULL,
  "taskId" varchar(128),
  "ts" bigint NOT NULL,
  "dataJson" jsonb
);
CREATE INDEX IF NOT EXISTS "idx_run_events_run" ON "orchestration_run_events" ("runId", "seq");
