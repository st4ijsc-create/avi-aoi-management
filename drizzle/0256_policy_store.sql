-- doc 44 Batch W3-A1 (gaps G3.11 + G3.13) — policy store + immutable decision log
-- (SYNAPSE Tầng-3 §11 Policy Engine, §12.3 PolicyDecision, §13.3 Policy API).
--
-- ════════════════════════════════════════════════════════════════════════════
-- policy_definitions: versioned guardrail rules ("policy-as-code"). Nguồn sự
--   thật là Git (contracts/policies/*.policy.yaml); loader boot (cờ
--   POLICY_STORE_ENABLED, default OFF) sync Git→DB theo (policy_id, version):
--   version file < max DB → skip + warn; bằng → upsert nội dung idempotent;
--   lớn hơn → chèn hàng version mới. effect/status/source là text
--   app-validated (repo convention, không pg enum — mirrors 0226/0248/0252).
--
-- policy_decision_log: audit BẤT BIẾN (append-only) — code ứng dụng KHÔNG có
--   đường UPDATE/DELETE cho bảng này. DENY/require-approval luôn ghi; PERMIT
--   ghi khi action thuộc nhóm POLICY_DEFAULT_DENY_ACTIONS hoặc
--   POLICY_AUDIT_PERMIT_ALL=true. context_summary đã REDACT — không bao giờ
--   chứa secret/credential (policyStore.summarizeContext).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS, không FK cứng
-- (updated_by soft-ref users.id để sync/log không khoá đường lệnh), không ALTER.
-- Trơ cho tới khi POLICY_STORE_ENABLED=true (default OFF).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0256 (0255 = genealogy_correlation của batch W2-B1).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "policy_definitions" (
  "id"               serial PRIMARY KEY NOT NULL,
  "policy_id"        text NOT NULL,
  "version"          integer NOT NULL,
  "effect"           text NOT NULL,
  "action_pattern"   text,
  "resource_pattern" text,
  "conditions"       jsonb DEFAULT '[]'::jsonb NOT NULL,
  "priority"         integer DEFAULT 0 NOT NULL,
  "status"           text DEFAULT 'active' NOT NULL,
  "source"           text DEFAULT 'git' NOT NULL,
  "description"      text,
  "updated_by"       integer,
  "created_at"       timestamp DEFAULT now() NOT NULL,
  "updated_at"       timestamp DEFAULT now() NOT NULL
);

-- Một (policy_id, version) là duy nhất — loader upsert theo cặp này.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_policy_definitions_policy_version"
  ON "policy_definitions" ("policy_id", "version");
CREATE INDEX IF NOT EXISTS "idx_policy_definitions_status"
  ON "policy_definitions" ("status");

CREATE TABLE IF NOT EXISTS "policy_decision_log" (
  "id"              serial PRIMARY KEY NOT NULL,
  "request_id"      text,
  "subject"         text,
  "action"          text NOT NULL,
  "resource"        text,
  "decision"        text NOT NULL,
  "reason_code"     text NOT NULL,
  "policy_ref"      text,
  "obligations"     jsonb DEFAULT '[]'::jsonb NOT NULL,
  "latency_ms"      real,
  "context_summary" jsonb,
  "ts"              timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_policy_decision_log_ts"
  ON "policy_decision_log" ("ts");
CREATE INDEX IF NOT EXISTS "idx_policy_decision_log_action"
  ON "policy_decision_log" ("action");
CREATE INDEX IF NOT EXISTS "idx_policy_decision_log_decision"
  ON "policy_decision_log" ("decision");
