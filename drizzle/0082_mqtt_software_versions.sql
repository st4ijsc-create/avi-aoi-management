-- Migration: 0082 - MQTT Software Version Management
-- Quản lý phiên bản phần mềm và cập nhật từ xa cho MQTT Client

CREATE TABLE IF NOT EXISTS "mqtt_software_versions" (
  "id" serial PRIMARY KEY,
  "version" varchar(50) NOT NULL,
  "versionCode" integer NOT NULL UNIQUE,
  "releaseDate" timestamp DEFAULT now() NOT NULL,
  "changelog" text,
  "apkFileKey" varchar(500),
  "apkFileUrl" text,
  "apkFileName" varchar(255),
  "fileSize" integer,
  "mandatory" boolean DEFAULT false NOT NULL,
  "minVersionCode" integer,
  "isLatest" boolean DEFAULT false NOT NULL,
  "uploadedBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_sw_version_code" ON "mqtt_software_versions" ("versionCode");
CREATE INDEX IF NOT EXISTS "idx_sw_version_latest" ON "mqtt_software_versions" ("isLatest");
