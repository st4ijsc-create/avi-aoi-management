CREATE TABLE `alert_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertSettingId` int NOT NULL,
	`triggeredValue` decimal(10,2) NOT NULL,
	`message` text NOT NULL,
	`sentEmail` boolean NOT NULL DEFAULT false,
	`sentSms` boolean NOT NULL DEFAULT false,
	`sentInApp` boolean NOT NULL DEFAULT false,
	`acknowledgedAt` timestamp,
	`acknowledgedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alert_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `alert_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`alertType` enum('yield_rate','ng_count','machine_status') NOT NULL,
	`threshold` decimal(10,2) NOT NULL,
	`comparisonOperator` enum('lt','lte','gt','gte','eq') NOT NULL DEFAULT 'lt',
	`machineId` int,
	`factoryId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`notifyEmail` boolean NOT NULL DEFAULT true,
	`notifySms` boolean NOT NULL DEFAULT false,
	`notifyInApp` boolean NOT NULL DEFAULT true,
	`cooldownMinutes` int NOT NULL DEFAULT 60,
	`lastTriggeredAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `alert_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_alert_history_setting` ON `alert_history` (`alertSettingId`);--> statement-breakpoint
CREATE INDEX `idx_alert_history_created` ON `alert_history` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_alert_user` ON `alert_settings` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_alert_active` ON `alert_settings` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_alert_type` ON `alert_settings` (`alertType`);