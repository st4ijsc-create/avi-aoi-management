CREATE TABLE `mqtt_alert_config` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int,
	`connectionLostThreshold` int NOT NULL DEFAULT 5,
	`reconnectFailedThreshold` int NOT NULL DEFAULT 10,
	`highReconnectRateThreshold` int NOT NULL DEFAULT 20,
	`longDisconnectionThreshold` int NOT NULL DEFAULT 30,
	`enableEmailNotification` boolean NOT NULL DEFAULT false,
	`enablePushNotification` boolean NOT NULL DEFAULT true,
	`notificationEmails` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_alert_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_connection_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`assignmentId` int,
	`targetType` enum('machine','station','factory'),
	`targetId` int,
	`alertType` enum('connection_lost','reconnect_failed','high_reconnect_rate','long_disconnection') NOT NULL,
	`severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
	`title` varchar(255) NOT NULL,
	`message` text,
	`triggeredAt` timestamp NOT NULL DEFAULT (now()),
	`acknowledgedAt` timestamp,
	`acknowledgedBy` int,
	`resolvedAt` timestamp,
	`thresholdMinutes` int DEFAULT 5,
	`isAcknowledged` boolean NOT NULL DEFAULT false,
	`isResolved` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_connection_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_alert_config_profile` ON `mqtt_alert_config` (`profileId`);--> statement-breakpoint
CREATE INDEX `idx_alert_config_active` ON `mqtt_alert_config` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_alert_profile` ON `mqtt_connection_alerts` (`profileId`);--> statement-breakpoint
CREATE INDEX `idx_alert_assignment` ON `mqtt_connection_alerts` (`assignmentId`);--> statement-breakpoint
CREATE INDEX `idx_alert_type` ON `mqtt_connection_alerts` (`alertType`);--> statement-breakpoint
CREATE INDEX `idx_alert_severity` ON `mqtt_connection_alerts` (`severity`);--> statement-breakpoint
CREATE INDEX `idx_alert_acknowledged` ON `mqtt_connection_alerts` (`isAcknowledged`);--> statement-breakpoint
CREATE INDEX `idx_alert_triggered` ON `mqtt_connection_alerts` (`triggeredAt`);