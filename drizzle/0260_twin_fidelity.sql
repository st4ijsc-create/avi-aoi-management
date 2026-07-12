-- doc 44 W5-A1 (gap G4.1) — Digital-Twin fidelity loop.
-- simulation_runs = sổ mọi lần chạy twin; twin_trust = trạng thái tin cậy (tự vô hiệu).
-- Idempotent (IF NOT EXISTS). Additive — không đụng bảng hiện có.

CREATE TABLE IF NOT EXISTS "simulation_runs" (
  "id"          serial PRIMARY KEY,
  "sim_id"      text NOT NULL,
  "twin_ref"    text NOT NULL,
  "mode"        text NOT NULL,
  "scenario"    jsonb,
  "result"      jsonb,
  "fidelity"    jsonb,
  "status"      text NOT NULL DEFAULT 'running',
  "created_by"  integer,
  "created_at"  timestamp NOT NULL DEFAULT now(),
  "finished_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_simulation_runs_sim_id" ON "simulation_runs" ("sim_id");
CREATE INDEX IF NOT EXISTS "idx_simulation_runs_twin_ref" ON "simulation_runs" ("twin_ref", "created_at");

CREATE TABLE IF NOT EXISTS "twin_trust" (
  "twin_ref"             text PRIMARY KEY,
  "trusted"              boolean NOT NULL DEFAULT true,
  "fidelity_pct"         double precision,
  "consecutive_breaches" integer NOT NULL DEFAULT 0,
  "last_check_at"        timestamp,
  "reason"               text,
  "updated_at"           timestamp NOT NULL DEFAULT now()
);
