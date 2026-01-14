CREATE TABLE `yield_alert_thresholds` (
	`id` int AUTO_INCREMENT NOT NULL,
	`metricType` enum('FPY','FY','NTF','UPH') NOT NULL,
	`warningThreshold` decimal(10,4) NOT NULL,
	`criticalThreshold` decimal(10,4) NOT NULL,
	`targetValue` decimal(10,4),
	`comparisonOperator` enum('gt','lt','gte','lte') NOT NULL DEFAULT 'gte',
	`isEnabled` boolean NOT NULL DEFAULT true,
	`notifyOnWarning` boolean NOT NULL DEFAULT true,
	`notifyOnCritical` boolean NOT NULL DEFAULT true,
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `yield_alert_thresholds_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_yield_thresholds_type` ON `yield_alert_thresholds` (`metricType`);--> statement-breakpoint
CREATE INDEX `idx_yield_thresholds_enabled` ON `yield_alert_thresholds` (`isEnabled`);