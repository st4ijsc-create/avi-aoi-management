CREATE TABLE `yield_threshold_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`thresholdId` int NOT NULL,
	`metricType` enum('FPY','FY','NTF','UPH') NOT NULL,
	`previousWarning` decimal(10,4),
	`newWarning` decimal(10,4) NOT NULL,
	`previousCritical` decimal(10,4),
	`newCritical` decimal(10,4) NOT NULL,
	`previousTarget` decimal(10,4),
	`newTarget` decimal(10,4),
	`changeReason` text,
	`changedBy` int,
	`changedByName` varchar(255),
	`actualValueAtChange` decimal(10,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `yield_threshold_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_threshold_history_threshold` ON `yield_threshold_history` (`thresholdId`);--> statement-breakpoint
CREATE INDEX `idx_threshold_history_type` ON `yield_threshold_history` (`metricType`);--> statement-breakpoint
CREATE INDEX `idx_threshold_history_date` ON `yield_threshold_history` (`createdAt`);