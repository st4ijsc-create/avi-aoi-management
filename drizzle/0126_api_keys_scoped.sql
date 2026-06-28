-- Phase E1 — Factory Control Plane: scoped API keys for the Unified Machine API (/api/v1).
-- Additive: a new table only; no existing table is altered. Stores a SHA-256 hash of
-- each key (never plaintext) plus a scope list. The MASTER_API_KEY super-key is handled
-- in the auth middleware and needs no row here.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "keyHash" varchar(128) NOT NULL,
  "keyPrefix" varchar(32),
  "scopes" json NOT NULL,
  "isActive" boolean DEFAULT true NOT NULL,
  "expiresAt" timestamp,
  "lastUsedAt" timestamp,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_api_keys_hash" ON "api_keys" ("keyHash");
CREATE INDEX IF NOT EXISTS "idx_api_keys_active" ON "api_keys" ("isActive");
