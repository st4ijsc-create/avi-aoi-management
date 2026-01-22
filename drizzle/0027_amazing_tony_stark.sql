CREATE TABLE `mqtt_alert_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`ruleId` int NOT NULL,
	`ruleName` varchar(255) NOT NULL,
	`ruleType` varchar(50) NOT NULL,
	`triggeredValue` decimal(10,2) NOT NULL,
	`thresholdValue` decimal(10,2) NOT NULL,
	`message` text NOT NULL,
	`notificationSent` boolean NOT NULL DEFAULT false,
	`notificationError` text,
	`isResolved` boolean NOT NULL DEFAULT false,
	`resolvedAt` timestamp,
	`resolvedBy` int,
	`resolutionNote` text,
	`triggeredAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_alert_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_alert_rules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`ruleType` enum('LATENCY_THRESHOLD','BROKER_DISCONNECT','MESSAGE_FAILURE_RATE','THROUGHPUT_LOW','THROUGHPUT_HIGH','CLIENT_OFFLINE') NOT NULL,
	`thresholdValue` decimal(10,2) NOT NULL,
	`thresholdUnit` varchar(50) NOT NULL DEFAULT 'ms',
	`comparisonOperator` enum('GT','GTE','LT','LTE','EQ') NOT NULL DEFAULT 'GT',
	`timeWindowMinutes` int NOT NULL DEFAULT 5,
	`notifyOwner` boolean NOT NULL DEFAULT true,
	`notifyEmail` boolean NOT NULL DEFAULT false,
	`notifyMqtt` boolean NOT NULL DEFAULT false,
	`cooldownMinutes` int NOT NULL DEFAULT 15,
	`lastTriggeredAt` timestamp,
	`isEnabled` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_alert_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mqtt_alert_history_rule` ON `mqtt_alert_history` (`ruleId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_alert_history_type` ON `mqtt_alert_history` (`ruleType`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_alert_history_resolved` ON `mqtt_alert_history` (`isResolved`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_alert_history_triggered` ON `mqtt_alert_history` (`triggeredAt`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_alert_rules_type` ON `mqtt_alert_rules` (`ruleType`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_alert_rules_enabled` ON `mqtt_alert_rules` (`isEnabled`);