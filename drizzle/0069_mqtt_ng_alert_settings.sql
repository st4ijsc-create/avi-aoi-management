-- Migration: MQTT NG Alert Settings
-- Cấu hình bản tin NG Alert theo từng trạm: bật/tắt, topic, kênh gửi

CREATE TABLE IF NOT EXISTS "mqtt_ng_alert_settings" (
  "id" serial PRIMARY KEY,
  "stationId" integer NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "topicPattern" varchar(500) NOT NULL DEFAULT 'avi/factory/{factoryId}/workshop/{workshopId}/station/{stationId}/errors',
  "externalTopicPattern" varchar(500),
  "sendToLocal" boolean NOT NULL DEFAULT true,
  "sendToExternal" boolean NOT NULL DEFAULT true,
  "sendFcm" boolean NOT NULL DEFAULT true,
  "includeImages" boolean NOT NULL DEFAULT true,
  "includeReferenceImages" boolean NOT NULL DEFAULT true,
  "qos" integer NOT NULL DEFAULT 1,
  "retain" boolean NOT NULL DEFAULT false,
  "cooldownSeconds" integer NOT NULL DEFAULT 0,
  "lastTriggeredAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "idx_ng_alert_settings_station_unique" ON "mqtt_ng_alert_settings" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_ng_alert_settings_enabled" ON "mqtt_ng_alert_settings" ("enabled");
