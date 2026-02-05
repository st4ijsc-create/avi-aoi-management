DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'mqtt_subscriptions'::regclass
      AND conname = 'mqtt_subscriptions_client_topic_unique'
  ) THEN
    ALTER TABLE "mqtt_subscriptions"
    ADD CONSTRAINT "mqtt_subscriptions_client_topic_unique"
    UNIQUE ("clientId", "topic");
  END IF;
END $$;
