CREATE TABLE `scheduled_report_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reportId` int NOT NULL,
	`status` enum('SUCCESS','FAILED','PENDING') NOT NULL DEFAULT 'PENDING',
	`recipientCount` int NOT NULL DEFAULT 0,
	`successCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`reportData` json,
	`sentAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_report_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`reportType` enum('NG_VISUAL','DAILY_SUMMARY','WEEKLY_SUMMARY','MONTHLY_SUMMARY','CUSTOM') NOT NULL DEFAULT 'NG_VISUAL',
	`schedule` enum('DAILY','WEEKLY','MONTHLY') NOT NULL DEFAULT 'DAILY',
	`scheduleTime` varchar(10) NOT NULL DEFAULT '08:00',
	`scheduleDayOfWeek` int,
	`scheduleDayOfMonth` int,
	`recipients` json NOT NULL,
	`factoryId` int,
	`workshopId` int,
	`lineId` int,
	`includeWorkstationHeatmap` boolean NOT NULL DEFAULT true,
	`includeTopNGPoints` boolean NOT NULL DEFAULT true,
	`includeTrendChart` boolean NOT NULL DEFAULT true,
	`includeComparison` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastSentAt` timestamp,
	`nextScheduledAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `scheduled_reports_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_report_logs_report` ON `scheduled_report_logs` (`reportId`);--> statement-breakpoint
CREATE INDEX `idx_report_logs_status` ON `scheduled_report_logs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_report_logs_sent` ON `scheduled_report_logs` (`sentAt`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_reports_type` ON `scheduled_reports` (`reportType`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_reports_schedule` ON `scheduled_reports` (`schedule`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_reports_active` ON `scheduled_reports` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_reports_next` ON `scheduled_reports` (`nextScheduledAt`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_reports_factory` ON `scheduled_reports` (`factoryId`);