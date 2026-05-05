-- Add device hardware info columns to mqtt_clients
-- These fields are populated when the mobile app publishes DEVICE_INFO on connect

ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "ipAddress" varchar(45);
ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "brand" varchar(100);
ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "manufacturer" varchar(100);
ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "screenResolution" varchar(50);
ALTER TABLE "mqtt_clients" ADD COLUMN IF NOT EXISTS "networkType" varchar(50);
