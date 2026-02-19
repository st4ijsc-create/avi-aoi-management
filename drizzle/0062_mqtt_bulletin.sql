-- MQTT Bulletin Settings - Cấu hình gửi bản tin tổng hợp theo chu kỳ cho từng station
CREATE TABLE IF NOT EXISTS "mqtt_bulletin_settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "stationId" integer NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "intervalMinutes" integer DEFAULT 60 NOT NULL,
  "scheduleType" varchar(20) DEFAULT 'interval' NOT NULL,
  "cronExpression" varchar(100),
  "startHour" integer DEFAULT 6 NOT NULL,
  "endHour" integer DEFAULT 22 NOT NULL,
  "includeImages" boolean DEFAULT true NOT NULL,
  "maxFailPoints" integer DEFAULT 20 NOT NULL,
  "sendToExternal" boolean DEFAULT true NOT NULL,
  "sendFcm" boolean DEFAULT true NOT NULL,
  "lastSentAt" timestamp,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- MQTT Bulletin History - Lưu lịch sử bản tin đã gửi
CREATE TABLE IF NOT EXISTS "mqtt_bulletin_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "stationId" integer NOT NULL,
  "bulletinType" varchar(20) DEFAULT 'PERIODIC' NOT NULL,
  "periodStart" timestamp NOT NULL,
  "periodEnd" timestamp NOT NULL,
  "totalCount" integer DEFAULT 0 NOT NULL,
  "okCount" integer DEFAULT 0 NOT NULL,
  "ngCount" integer DEFAULT 0 NOT NULL,
  "ntfCount" integer DEFAULT 0 NOT NULL,
  "yieldRate" decimal(5, 2),
  "failPoints" json,
  "payload" json NOT NULL,
  "deliveryStatus" "deliverystatusenum" DEFAULT 'PENDING' NOT NULL,
  "deliveredAt" timestamp,
  "sentViaLocal" boolean DEFAULT false NOT NULL,
  "sentViaExternal" boolean DEFAULT false NOT NULL,
  "sentViaFcm" boolean DEFAULT false NOT NULL,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- Add PERIODIC_BULLETIN to message type enum  
DO $$ BEGIN
  ALTER TYPE "messagetypeenum" ADD VALUE IF NOT EXISTS 'PERIODIC_BULLETIN';
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_bulletin_settings_station" ON "mqtt_bulletin_settings" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_bulletin_settings_enabled" ON "mqtt_bulletin_settings" ("enabled");
CREATE INDEX IF NOT EXISTS "idx_bulletin_history_station" ON "mqtt_bulletin_history" ("stationId");
CREATE INDEX IF NOT EXISTS "idx_bulletin_history_period" ON "mqtt_bulletin_history" ("periodStart", "periodEnd");
CREATE INDEX IF NOT EXISTS "idx_bulletin_history_created" ON "mqtt_bulletin_history" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_bulletin_history_status" ON "mqtt_bulletin_history" ("deliveryStatus");
