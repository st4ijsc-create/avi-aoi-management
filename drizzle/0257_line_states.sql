-- doc 44 Batch W3-A2 (G3.1 — Line Controller, SYNAPSE LDS-L3 PHẦN II Chương 4-7).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Máy trạng thái tuyến bền vững (spec §4.1 + §7 "trạng thái bền" / §19.1
-- fail-safe "khởi động lại, tiếp tục từ trạng thái bền"):
--
--   line_states            — trạng thái FSM HIỆN TẠI mỗi tuyến (1 row / line).
--                            state ∈ idle|ready|producing|held|completing|
--                            changeover|fault — text + app-validation (repo
--                            convention: KHÔNG pg enum, thêm state sau này
--                            không cần ALTER TYPE — see hierarchy.ts note).
--   line_state_transitions — sổ audit append-only mọi lần chuyển trạng thái
--                            (kể cả attempt bị policy DENY, reason có tiền tố
--                            'POLICY_DENIED:'). KHÔNG FK — audit sống lâu hơn
--                            tuyến bị xóa.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE/INDEX IF NOT EXISTS; FK guarded qua
-- DO $$ ... duplicate_object (mirrors drizzle output của các migration trước).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0257 (0256 = batch song song W3-A1).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "line_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "line_id" integer NOT NULL,
  "state" text DEFAULT 'idle' NOT NULL,
  "held_reason" text,
  "recipe_set_ref" text,
  "active_order_id" integer,
  "takt_target_s" real,
  "entered_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "line_states_line_id_unique" UNIQUE("line_id")
);

DO $$ BEGIN
  ALTER TABLE "line_states"
    ADD CONSTRAINT "line_states_line_id_production_lines_id_fk"
    FOREIGN KEY ("line_id") REFERENCES "public"."production_lines"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "idx_line_states_state" ON "line_states" ("state");

CREATE TABLE IF NOT EXISTS "line_state_transitions" (
  "id" serial PRIMARY KEY NOT NULL,
  "line_id" integer NOT NULL,
  "from_state" text NOT NULL,
  "to_state" text NOT NULL,
  "reason" text,
  "triggered_by" text DEFAULT 'system' NOT NULL,
  "correlation_id" text,
  "policy_ref" text,
  "ts" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_line_state_transitions_line_ts"
  ON "line_state_transitions" ("line_id", "ts");
