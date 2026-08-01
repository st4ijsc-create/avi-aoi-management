-- doc 37 Đợt-C2 (năng lực 14) — device X.509 PKI + service (SPIFFE-lite) identity.
--
-- Adds the two missing identity pillars for platform-grade security (synapse already has
-- policy-as-code + WORM hash-chain audit + avi_app least-privilege):
--   • device_certificates    — short-lived (90-day) X.509 leaf certs per adapter/robot/edge.
--   • service_identities      — SPIFFE-lite workload IDs (+ optional X.509 SVID) per service.
--   • security_ca_metadata    — PUBLIC record of the internal CA (private key stays in the
--                               OS-keystore/ENV, NEVER in the DB — see internalCa.ts).
--
-- Additive + idempotent. Enforcement is flag-gated in code (DEVICE_PKI_ENABLED /
-- SERVICE_MTLS_ENABLED, both default OFF) so applying this migration changes NO behaviour.
-- Numbered 0233 (0232 = omron_alarm_codes).

-- ─── Enums ───────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_cert_status_enum') THEN
    CREATE TYPE device_cert_status_enum AS ENUM ('active', 'revoked', 'expired', 'superseded');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'device_cert_kind_enum') THEN
    CREATE TYPE device_cert_kind_enum AS ENUM ('adapter', 'robot', 'edge_node', 'plc', 'generic');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_identity_status_enum') THEN
    CREATE TYPE service_identity_status_enum AS ENUM ('active', 'revoked');
  END IF;
END $$;

-- ─── Internal CA metadata (PUBLIC only) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS security_ca_metadata (
  id                  SERIAL PRIMARY KEY,
  trust_domain        VARCHAR(255) NOT NULL,
  subject_cn          VARCHAR(255) NOT NULL,
  cert_pem            TEXT NOT NULL,
  pubkey_pem          TEXT NOT NULL,
  fingerprint_sha256  VARCHAR(128) NOT NULL,
  algorithm           VARCHAR(32) NOT NULL DEFAULT 'ed25519',
  not_before          TIMESTAMP NOT NULL,
  not_after           TIMESTAMP NOT NULL,
  active              INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_meta_domain ON security_ca_metadata (trust_domain);
CREATE INDEX IF NOT EXISTS idx_ca_meta_active ON security_ca_metadata (active);
-- At most one ACTIVE CA per trust domain.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ca_meta_active_domain
  ON security_ca_metadata (trust_domain) WHERE active = 1;

-- ─── Device certificates (X.509 PKI) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS device_certificates (
  id                  SERIAL PRIMARY KEY,
  device_id           VARCHAR(255) NOT NULL,
  kind                device_cert_kind_enum NOT NULL DEFAULT 'generic',
  subject_cn          VARCHAR(255) NOT NULL,
  spiffe_id           VARCHAR(512),
  serial_number       VARCHAR(128) NOT NULL,
  fingerprint_sha256  VARCHAR(128) NOT NULL,
  cert_pem            TEXT NOT NULL,
  pubkey_pem          TEXT NOT NULL,
  issued_by           INTEGER REFERENCES security_ca_metadata(id),
  rotated_from_id     INTEGER,
  status              device_cert_status_enum NOT NULL DEFAULT 'active',
  not_before          TIMESTAMP NOT NULL,
  not_after           TIMESTAMP NOT NULL,
  revoked_at          TIMESTAMP,
  revoked_reason      TEXT,
  metadata            JSONB,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_certs_device ON device_certificates (device_id);
CREATE INDEX IF NOT EXISTS idx_device_certs_status ON device_certificates (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_certs_serial ON device_certificates (serial_number);
CREATE UNIQUE INDEX IF NOT EXISTS idx_device_certs_fpr ON device_certificates (fingerprint_sha256);
CREATE INDEX IF NOT EXISTS idx_device_certs_expiry ON device_certificates (not_after);

-- ─── Service identities (SPIFFE-lite) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_identities (
  id                  SERIAL PRIMARY KEY,
  service_name        VARCHAR(128) NOT NULL,
  spiffe_id           VARCHAR(512) NOT NULL,
  cert_pem            TEXT,
  pubkey_pem          TEXT,
  fingerprint_sha256  VARCHAR(128),
  issued_by           INTEGER REFERENCES security_ca_metadata(id),
  status              service_identity_status_enum NOT NULL DEFAULT 'active',
  not_before          TIMESTAMP,
  not_after           TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_service_ident_spiffe ON service_identities (spiffe_id);
CREATE INDEX IF NOT EXISTS idx_service_ident_name ON service_identities (service_name);
CREATE INDEX IF NOT EXISTS idx_service_ident_status ON service_identities (status);
