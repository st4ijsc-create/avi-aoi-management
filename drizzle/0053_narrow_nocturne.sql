ALTER TABLE `mqtt_client_profiles` ADD `maxReconnectAttempts` int DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE `mqtt_client_profiles` ADD `reconnectBackoffMultiplier` decimal(3,1) DEFAULT '1.5' NOT NULL;--> statement-breakpoint
ALTER TABLE `mqtt_client_profiles` ADD `maxReconnectDelay` int DEFAULT 60000 NOT NULL;--> statement-breakpoint
ALTER TABLE `mqtt_client_profiles` ADD `autoReconnect` boolean DEFAULT true NOT NULL;