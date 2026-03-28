-- Add includePointImages and includeOverallResult columns to mqtt_ng_alert_settings
ALTER TABLE "mqtt_ng_alert_settings" ADD COLUMN IF NOT EXISTS "includePointImages" boolean DEFAULT true NOT NULL;
ALTER TABLE "mqtt_ng_alert_settings" ADD COLUMN IF NOT EXISTS "includeOverallResult" boolean DEFAULT true NOT NULL;
