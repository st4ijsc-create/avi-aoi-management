-- 0186 — W6-C (doc 27 §7 MB5/MB6): alert escalation rules + ack comment / real identity
--
-- 1. alert_escalation_rules: minimal honest escalation config for MQTT alerts
--    (mqtt_connection_alerts + mqtt_alert_history). A rule matches by optional
--    severity ('info'|'warning'|'critical', conn alerts only — mqtt_alert_history
--    has no severity column) and optional alertType (conn: alertTypeEnum_2 values;
--    history: ruleType snapshot string). NULL = match any.
-- 2. escalatedAt on both alert tables — set ONCE by the scheduler sweep
--    (WHERE "escalatedAt" IS NULL guard = no re-storm guarantee).
-- 3. ackComment / acknowledgedByName / resolvedByName / resolutionNote columns so the
--    mobile app's acknowledge-v2 / resolve-v2 endpoints can record a real human
--    identity + reason even when authenticated via master key (no user row).

CREATE TABLE IF NOT EXISTS "alert_escalation_rules" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "severity" VARCHAR(20),              -- NULL = any; 'info'|'warning'|'critical' (conn alerts only)
  "alertType" VARCHAR(50),             -- NULL = any; conn alertType or mqtt_alert_history ruleType
  "escalateAfterMin" INTEGER NOT NULL DEFAULT 15,
  "notifyRoles" JSONB NOT NULL DEFAULT '[]'::jsonb,   -- e.g. ["admin","supervisor"] → in-app notifications
  "notifyUserIds" JSONB NOT NULL DEFAULT '[]'::jsonb, -- explicit user ids → in-app notifications
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdBy" INTEGER,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_alert_escalation_rules_enabled" ON "alert_escalation_rules" ("enabled");

-- Escalation state (once-only marker)
ALTER TABLE "mqtt_connection_alerts" ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP;
ALTER TABLE "mqtt_alert_history"     ADD COLUMN IF NOT EXISTS "escalatedAt" TIMESTAMP;

-- Partial indexes: the sweep only scans open, not-yet-escalated alerts
CREATE INDEX IF NOT EXISTS "idx_mqtt_conn_alerts_escalation_open"
  ON "mqtt_connection_alerts" ("triggeredAt")
  WHERE "isResolved" = false AND "isAcknowledged" = false AND "escalatedAt" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_mqtt_alert_history_escalation_open"
  ON "mqtt_alert_history" ("triggeredAt")
  WHERE "isResolved" = false AND "escalatedAt" IS NULL;

-- Ack comment + human-readable identity (MB5/MB6)
ALTER TABLE "mqtt_connection_alerts" ADD COLUMN IF NOT EXISTS "ackComment" TEXT;
ALTER TABLE "mqtt_connection_alerts" ADD COLUMN IF NOT EXISTS "acknowledgedByName" VARCHAR(255);
ALTER TABLE "mqtt_connection_alerts" ADD COLUMN IF NOT EXISTS "resolvedByName" VARCHAR(255);
ALTER TABLE "mqtt_connection_alerts" ADD COLUMN IF NOT EXISTS "resolutionNote" TEXT;
ALTER TABLE "mqtt_alert_history"     ADD COLUMN IF NOT EXISTS "resolvedByName" VARCHAR(255);
ALTER TABLE "alert_history"          ADD COLUMN IF NOT EXISTS "ackComment" TEXT;
ALTER TABLE "alert_history"          ADD COLUMN IF NOT EXISTS "acknowledgedByName" VARCHAR(255);
