-- ════════════════════════════════════════════════════════════════════════════
-- 0373 — doc 81 Đợt 10 task A (design §2.6 / §2.7 / §2.13 / §3): edge REPORT STREAM cursors, node-reported PROGRAM CHECKS,
--        the public half of the edge SIGNING KEYS, and the node PROTOCOL VERSION
-- ════════════════════════════════════════════════════════════════════════════
--
-- • edge_node_report_cursors — central's cursor per (node, stream, epoch) of the edge journal replay: a record with
--   seq = lastSeq + 1 is applied, seq ≤ lastSeq is a duplicate, a higher seq is a gap (409). A cursor starts at 0 (INSERT
--   guard); lastSeq NEVER decreases and the key never changes (trigger). stream ∈ events | robot_state | run:<id>:<claim>
--   (same pattern as edgeProtocol.EDGE_STREAM_RE); epoch = 128-bit random hex.
--   avi_app: SELECT, INSERT, UPDATE ("lastSeq", "updatedAt") only.
-- • edge_node_program_reports — the latest program-checksum reading per (node, adapter) the EDGE reported (D7: central never
--   reads an edge-owned controller). Upsert per (node, adapter). status ∈ verified | unsupported | unreadable; checksum iff
--   verified, reason iff unreadable. (0374 adds: the adapter must be OWNED by the node.)
--   avi_app: SELECT, INSERT, UPDATE ("status", "checksum", "reason", "readAt", "receivedAt") only.
-- • edge_auth_signing_keys — PUBLIC keys only (the private key is a 0600 file / env PEM, never here). kid = fingerprint
--   (edk_ + 22 b64url). status next → active → retired (retired terminal; active never goes back to next); retiredAt iff
--   retired, written once. A non-genesis key carries an ENDORSEMENT (endorsedByKid + endorsementSig) made by the key active
--   when it was generated — central's keyset builder (edgeSigning.buildEdgeKeyset) includes only rows whose endorsement chain
--   verifies, so a DB writer alone can never add a trusted key. WRITE-ONCE (IS DISTINCT FROM): kid, publicKeyPem, notBefore,
--   createdBy, createdAt, endorsedByKid, endorsementSig. avi_app: SELECT, INSERT, UPDATE ("status", "retiredAt") only.
-- • edge_nodes."protocolVersion" smallint DEFAULT 1 — 1 = Đợt 9 (DB-backed edge), 2 = this protocol; central refuses a v1
--   call for a v2 node. Read through the narrow projection (edgeControlSchema.ts), never added to the full edge_nodes object.
--
-- ⚠ DDL runs as owner `aoi`: `node scripts/apply-migration-0373.mjs --test-only` (dev: `--dev-only`, the owner decides; no
--   flag ⇒ refused — R-3-g). ⚠ The repo forbids `drizzle-kit push/generate`.
-- ROLLBACK:
--   DROP TABLE IF EXISTS "edge_node_report_cursors"; DROP TABLE IF EXISTS "edge_node_program_reports";
--   DROP TABLE IF EXISTS "edge_auth_signing_keys"; ALTER TABLE "edge_nodes" DROP COLUMN IF EXISTS "protocolVersion";
--   DROP FUNCTION IF EXISTS edge_report_cursor_guard(); DROP FUNCTION IF EXISTS edge_auth_signing_keys_guard();
--
CREATE TABLE IF NOT EXISTS "edge_node_report_cursors" (
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE CASCADE,
  "stream" varchar(40) NOT NULL,
  "epoch" varchar(32) NOT NULL,
  "lastSeq" bigint NOT NULL DEFAULT 0,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("edgeNodeId", "stream", "epoch"),
  CONSTRAINT "ck_edge_cursor_stream" CHECK ("stream" ~ '^(events|robot_state|run:[1-9][0-9]{0,9}:[1-9][0-9]{0,9})$'),
  CONSTRAINT "ck_edge_cursor_epoch" CHECK ("epoch" ~ '^[0-9a-f]{32}$'),
  CONSTRAINT "ck_edge_cursor_seq" CHECK ("lastSeq" >= 0)
);
COMMENT ON TABLE "edge_node_report_cursors" IS
  'doc 81 Dot 10 A (0373): edge journal replay cursor per (node, stream, epoch). Starts at 0, never decreases.';

CREATE OR REPLACE FUNCTION edge_report_cursor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."lastSeq" <> 0 THEN
      RAISE EXCEPTION 'edge_node_report_cursors: a cursor starts at 0 (node %, stream %)', NEW."edgeNodeId", NEW."stream" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."edgeNodeId" IS DISTINCT FROM OLD."edgeNodeId" OR NEW."stream" IS DISTINCT FROM OLD."stream"
     OR NEW."epoch" IS DISTINCT FROM OLD."epoch" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'edge_node_report_cursors: the cursor key is write-once (node %, stream %)', OLD."edgeNodeId", OLD."stream" USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."lastSeq" < OLD."lastSeq" THEN
    RAISE EXCEPTION 'edge_node_report_cursors: lastSeq never decreases (node %, stream %: % -> %)', OLD."edgeNodeId", OLD."stream", OLD."lastSeq", NEW."lastSeq"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_report_cursor_guard ON "edge_node_report_cursors";
CREATE TRIGGER trg_edge_report_cursor_guard BEFORE INSERT OR UPDATE ON "edge_node_report_cursors"
  FOR EACH ROW EXECUTE FUNCTION edge_report_cursor_guard();

CREATE TABLE IF NOT EXISTS "edge_node_program_reports" (
  "edgeNodeId" integer NOT NULL REFERENCES "edge_nodes"("id") ON DELETE CASCADE,
  "adapterId" integer NOT NULL REFERENCES "device_adapters"("id") ON DELETE CASCADE,
  "status" varchar(16) NOT NULL,
  "checksum" varchar(256),
  "reason" varchar(32),
  "readAt" timestamptz NOT NULL,
  "receivedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("edgeNodeId", "adapterId"),
  CONSTRAINT "ck_edge_program_status" CHECK ("status" IN ('verified', 'unsupported', 'unreadable')),
  CONSTRAINT "ck_edge_program_checksum" CHECK (("status" = 'verified') = ("checksum" IS NOT NULL)),
  CONSTRAINT "ck_edge_program_reason" CHECK (("status" = 'unreadable') = ("reason" IS NOT NULL))
);
COMMENT ON TABLE "edge_node_program_reports" IS
  'doc 81 Dot 10 A (0373): latest node-reported program checksum per (node, adapter) — D7, central never reads an edge-owned controller.';

CREATE TABLE IF NOT EXISTS "edge_auth_signing_keys" (
  "kid" varchar(64) PRIMARY KEY,
  "publicKeyPem" text NOT NULL,
  "status" varchar(16) NOT NULL,
  "notBefore" timestamptz NOT NULL DEFAULT now(),
  "retiredAt" timestamptz,
  "createdBy" varchar(128) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "endorsedByKid" varchar(64) REFERENCES "edge_auth_signing_keys"("kid"),
  "endorsementSig" varchar(86),
  CONSTRAINT "ck_edge_key_kid" CHECK ("kid" ~ '^edk_[A-Za-z0-9_-]{22}$'),
  CONSTRAINT "ck_edge_key_pem" CHECK ("publicKeyPem" LIKE '-----BEGIN PUBLIC KEY-----%' AND length("publicKeyPem") <= 1000),
  CONSTRAINT "ck_edge_key_status" CHECK ("status" IN ('next', 'active', 'retired')),
  CONSTRAINT "ck_edge_key_retired" CHECK (("status" = 'retired') = ("retiredAt" IS NOT NULL)),
  CONSTRAINT "ck_edge_key_endorsement" CHECK (("endorsedByKid" IS NULL) = ("endorsementSig" IS NULL)
    AND ("endorsementSig" IS NULL OR "endorsementSig" ~ '^[A-Za-z0-9_-]{86}$')
    AND ("endorsedByKid" IS NULL OR "endorsedByKid" <> "kid"))
);
COMMENT ON TABLE "edge_auth_signing_keys" IS
  'doc 81 Dot 10 A (0373): PUBLIC edge signing keys (private key never in the DB). next -> active -> retired; identity + endorsement write-once.';

CREATE OR REPLACE FUNCTION edge_auth_signing_keys_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" = 'retired' OR NEW."retiredAt" IS NOT NULL THEN
      RAISE EXCEPTION 'edge_auth_signing_keys: a new key is next or active (kid %)', NEW."kid" USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."kid" IS DISTINCT FROM OLD."kid" OR NEW."publicKeyPem" IS DISTINCT FROM OLD."publicKeyPem"
     OR NEW."notBefore" IS DISTINCT FROM OLD."notBefore" OR NEW."createdBy" IS DISTINCT FROM OLD."createdBy"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."endorsedByKid" IS DISTINCT FROM OLD."endorsedByKid"
     OR NEW."endorsementSig" IS DISTINCT FROM OLD."endorsementSig" THEN
    RAISE EXCEPTION 'edge_auth_signing_keys: identity / endorsement is write-once (kid %)', OLD."kid" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'retired' AND (NEW."status" <> 'retired' OR NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt") THEN
    RAISE EXCEPTION 'edge_auth_signing_keys: a retired key stays retired (kid %)', OLD."kid" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" = 'active' AND NEW."status" = 'next' THEN
    RAISE EXCEPTION 'edge_auth_signing_keys: an active key never goes back to next (kid %)', OLD."kid" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_edge_auth_signing_keys_guard ON "edge_auth_signing_keys";
CREATE TRIGGER trg_edge_auth_signing_keys_guard BEFORE INSERT OR UPDATE ON "edge_auth_signing_keys"
  FOR EACH ROW EXECUTE FUNCTION edge_auth_signing_keys_guard();

ALTER TABLE "edge_nodes" ADD COLUMN IF NOT EXISTS "protocolVersion" smallint NOT NULL DEFAULT 1;
ALTER TABLE "edge_nodes" DROP CONSTRAINT IF EXISTS "ck_edge_nodes_protocol_version";
ALTER TABLE "edge_nodes" ADD CONSTRAINT "ck_edge_nodes_protocol_version" CHECK ("protocolVersion" IN (1, 2));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    REVOKE ALL ON "edge_node_report_cursors" FROM avi_app;
    REVOKE ALL ON "edge_node_program_reports" FROM avi_app;
    REVOKE ALL ON "edge_auth_signing_keys" FROM avi_app;
    GRANT SELECT, INSERT ON "edge_node_report_cursors" TO avi_app;
    GRANT UPDATE ("lastSeq", "updatedAt") ON "edge_node_report_cursors" TO avi_app;
    GRANT SELECT, INSERT ON "edge_node_program_reports" TO avi_app;
    GRANT UPDATE ("status", "checksum", "reason", "readAt", "receivedAt") ON "edge_node_program_reports" TO avi_app;
    GRANT SELECT, INSERT ON "edge_auth_signing_keys" TO avi_app;
    GRANT UPDATE ("status", "retiredAt") ON "edge_auth_signing_keys" TO avi_app;
  END IF;
END $$;
