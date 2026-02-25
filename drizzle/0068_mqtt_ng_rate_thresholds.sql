-- Migration: MQTT NG Rate Thresholds
-- Tự động gửi MQTT alert khi tỉ lệ NG theo điểm đo trong ngày vượt ngưỡng cài đặt

-- ============================================================
-- Bảng cấu hình ngưỡng NG rate
-- ============================================================
CREATE TABLE IF NOT EXISTS "mqtt_ng_rate_thresholds" (
  "id" serial PRIMARY KEY,
  "stationId" integer NOT NULL,
  "machineId" integer,
  "measurementPointId" integer,
  "productModelId" integer,
  "name" varchar(255) NOT NULL,
  "description" text,
  "warningThreshold" decimal(5, 2) NOT NULL,
  "criticalThreshold" decimal(5, 2) NOT NULL,
  "minSampleSize" integer NOT NULL DEFAULT 10,
  "cooldownMinutes" integer NOT NULL DEFAULT 30,
  "lastTriggeredAt" timestamp,
  "sendMqttLocal" boolean NOT NULL DEFAULT true,
  "sendMqttExternal" boolean NOT NULL DEFAULT true,
  "sendFcm" boolean NOT NULL DEFAULT true,
  "isEnabled" boolean NOT NULL DEFAULT true,
  "createdBy" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Indexes for mqtt_ng_rate_thresholds
CREATE INDEX IF NOT EXISTS "idx_ng_rate_threshold_station" ON "mqtt_ng_rate_thresholds" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_threshold_machine" ON "mqtt_ng_rate_thresholds" ("machineId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_threshold_point" ON "mqtt_ng_rate_thresholds" ("measurementPointId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_threshold_product" ON "mqtt_ng_rate_thresholds" ("productModelId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_threshold_enabled" ON "mqtt_ng_rate_thresholds" ("isEnabled");

-- ============================================================
-- Bảng lịch sử alert NG rate đã gửi
-- ============================================================
CREATE TABLE IF NOT EXISTS "mqtt_ng_rate_alert_history" (
  "id" serial PRIMARY KEY,
  "thresholdId" integer NOT NULL,
  "stationId" integer NOT NULL,
  "machineId" integer,
  "measurementPointId" integer,
  "pointName" varchar(255),
  "pointCode" varchar(50),
  "productModelName" varchar(255),
  "currentNgRate" decimal(5, 2) NOT NULL,
  "thresholdValue" decimal(5, 2) NOT NULL,
  "totalInspections" integer NOT NULL,
  "ngCount" integer NOT NULL,
  "severity" varchar(20) NOT NULL,
  "message" text NOT NULL,
  "mqttTopic" varchar(255),
  "sentMqttLocal" boolean NOT NULL DEFAULT false,
  "sentMqttExternal" boolean NOT NULL DEFAULT false,
  "sentFcm" boolean NOT NULL DEFAULT false,
  "payload" json,
  "isResolved" boolean NOT NULL DEFAULT false,
  "resolvedAt" timestamp,
  "resolvedBy" integer,
  "resolutionNote" text,
  "triggeredAt" timestamp NOT NULL DEFAULT now()
);

-- Indexes for mqtt_ng_rate_alert_history
CREATE INDEX IF NOT EXISTS "idx_ng_rate_alert_threshold" ON "mqtt_ng_rate_alert_history" ("thresholdId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_alert_station" ON "mqtt_ng_rate_alert_history" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_alert_point" ON "mqtt_ng_rate_alert_history" ("measurementPointId");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_alert_severity" ON "mqtt_ng_rate_alert_history" ("severity");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_alert_resolved" ON "mqtt_ng_rate_alert_history" ("isResolved");
CREATE INDEX IF NOT EXISTS "idx_ng_rate_alert_triggered" ON "mqtt_ng_rate_alert_history" ("triggeredAt");
