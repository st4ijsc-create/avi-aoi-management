ALTER TABLE "mqtt_subscriptions"
ADD CONSTRAINT "mqtt_subscriptions_clientId_topic_unique"
UNIQUE ("clientId", "topic");
