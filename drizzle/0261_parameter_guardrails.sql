-- doc 44 W5-A2 (gaps G4.18/G4.19/G4.20) — Parameter guardrails + append-only change log.
-- parameter_guardrails = dải min–max per-parameter do kỹ sư quá trình đặt (SYNAPSE §9.2/§18.1).
-- parameter_change_log = sổ append-only mọi lần đổi param + closed-loop verify (§16).
-- Idempotent (IF NOT EXISTS). Additive — không đụng bảng hiện có.

CREATE TABLE IF NOT EXISTS "parameter_guardrails" (
  "id"                        serial PRIMARY KEY,
  "scope"                     text NOT NULL,
  "machine_id"                integer,
  "machine_type"              text,
  "param_key"                 text NOT NULL,
  "min_value"                 double precision NOT NULL,
  "max_value"                 double precision NOT NULL,
  "max_step"                  double precision,
  "unit"                      text,
  "requires_twin_validation"  boolean NOT NULL DEFAULT false,
  "set_by"                    integer,
  "notes"                     text,
  "updated_at"                timestamptz NOT NULL DEFAULT now()
);
-- One machine-scoped guardrail per (machine, param); one type-scoped per (type, param).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_param_guardrail_machine"
  ON "parameter_guardrails" ("machine_id", "param_key")
  WHERE scope = 'machine' AND machine_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "uq_param_guardrail_type"
  ON "parameter_guardrails" ("machine_type", "param_key")
  WHERE scope = 'machine_type' AND machine_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS "idx_param_guardrail_param" ON "parameter_guardrails" ("param_key");

CREATE TABLE IF NOT EXISTS "parameter_change_log" (
  "id"             serial PRIMARY KEY,
  "machine_id"     integer,
  "param_key"      text NOT NULL,
  "old_value"      double precision,
  "new_value"      double precision,
  "source"         text NOT NULL,
  "guardrail_id"   integer,
  "verify_status"  text NOT NULL DEFAULT 'pending',
  "verify_after"   timestamptz,
  "verified_at"    timestamptz,
  "metrics_before" jsonb,
  "metrics_after"  jsonb,
  "correlation_id" text,
  "ts"             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_param_change_machine" ON "parameter_change_log" ("machine_id", "param_key");
CREATE INDEX IF NOT EXISTS "idx_param_change_verify" ON "parameter_change_log" ("verify_status", "verify_after");
