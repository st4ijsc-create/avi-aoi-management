-- doc 44 Batch W0-E (gap G2.5) — persist the LDS-L1 contract-schema registry.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: server/services/contracts/schemaRegistry.ts có BACKWARD-compat gate
-- đúng nhưng registry chỉ in-memory (runtime 0 schema — registerSchema chỉ được
-- gọi trong test). Bảng này persist lineage version theo SUBJECT (họ topic UNS,
-- vd "syn/+/+/+/+/+/telemetry"); mỗi version mới PHẢI qua checkBackwardCompat
-- trước khi persist. Nguồn sự thật vẫn là Git (contracts/canonical/*.schema.json,
-- schema_ref trỏ về file gốc) — bảng là registry runtime seed từ đó.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS. Không pg enum
-- (status/compatibility là text — mirrors 0226/ncr reasoning), không ALTER TYPE,
-- không FK. Trơ cho tới khi CONTRACT_REGISTRY_PERSIST_ENABLED=true (default OFF).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0248 (0245 = calendar_day_shifts; 0246/0247 reserved by parallel batches).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "contract_schemas" (
  "id"            serial PRIMARY KEY NOT NULL,
  "subject"       text NOT NULL,
  "version"       integer NOT NULL,
  "compatibility" text DEFAULT 'BACKWARD' NOT NULL,
  "schema_json"   jsonb NOT NULL,
  "schema_ref"    text,
  "status"        text DEFAULT 'active' NOT NULL,
  "owner"         text,
  "created_at"    timestamp DEFAULT now() NOT NULL
);

-- Một (subject, version) chỉ tồn tại 1 lần — seed/persist upsert chống trùng.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_contract_schemas_subject_version"
  ON "contract_schemas" ("subject", "version");
CREATE INDEX IF NOT EXISTS "idx_contract_schemas_subject"
  ON "contract_schemas" ("subject");
CREATE INDEX IF NOT EXISTS "idx_contract_schemas_status"
  ON "contract_schemas" ("status");
