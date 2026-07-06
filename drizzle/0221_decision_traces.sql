-- doc 33 W4 (F6 §5.12.1) — persist decision-traces ("vì sao robot X được chọn").
-- Additive + idempotent. Populated via a sink when OBSERVABILITY is on.
CREATE TABLE IF NOT EXISTS "decision_traces" (
  "id" serial PRIMARY KEY,
  "decisionType" varchar(64) NOT NULL,
  "subject" varchar(128) NOT NULL,
  "chosen" varchar(128),
  "candidatesJson" jsonb,
  "version" varchar(64) NOT NULL,
  "correlationId" varchar(64),
  "ts" bigint NOT NULL,
  "note" text
);
CREATE INDEX IF NOT EXISTS "idx_decision_traces_type" ON "decision_traces" ("decisionType");
CREATE INDEX IF NOT EXISTS "idx_decision_traces_subject" ON "decision_traces" ("subject");
CREATE INDEX IF NOT EXISTS "idx_decision_traces_ts" ON "decision_traces" ("ts");
