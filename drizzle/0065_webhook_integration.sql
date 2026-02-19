-- Webhook Event Type Enum
DO $$ BEGIN
  CREATE TYPE "webhook_event_type" AS ENUM (
    'inspection.created',
    'inspection.updated',
    'alert.triggered',
    'machine.status_changed',
    'machine.offline',
    'production_order.created',
    'production_order.completed',
    'yield.threshold_exceeded',
    'backup.completed',
    'system.error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Webhook Configs - Cấu hình webhook gửi event đến hệ thống bên ngoài
CREATE TABLE IF NOT EXISTS "webhook_configs" (
  "id" serial PRIMARY KEY NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "url" text NOT NULL,
  "secret" varchar(255),
  "events" json NOT NULL DEFAULT '[]'::json,
  "headers" json,
  "isEnabled" boolean NOT NULL DEFAULT true,
  "retryCount" integer NOT NULL DEFAULT 3,
  "retryDelayMs" integer NOT NULL DEFAULT 5000,
  "timeoutMs" integer NOT NULL DEFAULT 10000,
  "createdBy" integer NOT NULL,
  "lastTriggeredAt" timestamp,
  "successCount" integer NOT NULL DEFAULT 0,
  "failureCount" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Webhook Delivery Logs - Lịch sử gửi webhook
CREATE TABLE IF NOT EXISTS "webhook_delivery_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "webhookId" integer NOT NULL,
  "eventType" varchar(100) NOT NULL,
  "payload" json NOT NULL,
  "responseStatus" integer,
  "responseBody" text,
  "responseTimeMs" integer,
  "success" boolean NOT NULL DEFAULT false,
  "errorMessage" text,
  "attempt" integer NOT NULL DEFAULT 1,
  "createdAt" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_webhook_configs_enabled" ON "webhook_configs" ("isEnabled");
CREATE INDEX IF NOT EXISTS "idx_webhook_configs_created_by" ON "webhook_configs" ("createdBy");
CREATE INDEX IF NOT EXISTS "idx_webhook_delivery_webhook" ON "webhook_delivery_logs" ("webhookId");
CREATE INDEX IF NOT EXISTS "idx_webhook_delivery_event" ON "webhook_delivery_logs" ("eventType");
CREATE INDEX IF NOT EXISTS "idx_webhook_delivery_success" ON "webhook_delivery_logs" ("success");
CREATE INDEX IF NOT EXISTS "idx_webhook_delivery_created" ON "webhook_delivery_logs" ("createdAt");
