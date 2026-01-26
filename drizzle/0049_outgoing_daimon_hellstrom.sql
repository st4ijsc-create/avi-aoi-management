CREATE TABLE `history_export_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`scheduleId` int NOT NULL,
	`status` enum('SUCCESS','FAILED','PENDING','RUNNING') NOT NULL DEFAULT 'PENDING',
	`recordCount` int NOT NULL DEFAULT 0,
	`fileSize` int NOT NULL DEFAULT 0,
	`fileUrl` text,
	`recipientCount` int NOT NULL DEFAULT 0,
	`deliveredCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	`processingTimeMs` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `history_export_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `history_export_schedules` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`scheduleType` enum('DAILY','WEEKLY','MONTHLY') NOT NULL DEFAULT 'DAILY',
	`scheduleTime` varchar(10) NOT NULL DEFAULT '08:00',
	`scheduleDayOfWeek` int,
	`scheduleDayOfMonth` int,
	`exportFormat` enum('CSV','JSON','EXCEL','PDF') NOT NULL DEFAULT 'CSV',
	`factoryId` int,
	`workshopId` int,
	`lineId` int,
	`machineId` int,
	`productModelId` int,
	`resultFilter` enum('ALL','OK','NG','NTF') NOT NULL DEFAULT 'ALL',
	`timeRangeType` enum('LAST_24H','LAST_7D','LAST_30D','LAST_MONTH','CUSTOM') NOT NULL DEFAULT 'LAST_24H',
	`customDays` int,
	`recipients` json NOT NULL,
	`includeImages` boolean NOT NULL DEFAULT false,
	`includeAnnotations` boolean NOT NULL DEFAULT true,
	`includeMeasurements` boolean NOT NULL DEFAULT true,
	`includeSummaryStats` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastRunAt` timestamp,
	`lastRunStatus` enum('SUCCESS','FAILED','PENDING') DEFAULT 'PENDING',
	`lastRunError` text,
	`nextRunAt` timestamp,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `history_export_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_export_log_schedule` ON `history_export_logs` (`scheduleId`);--> statement-breakpoint
CREATE INDEX `idx_export_log_status` ON `history_export_logs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_export_log_started` ON `history_export_logs` (`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_export_schedule_type` ON `history_export_schedules` (`scheduleType`);--> statement-breakpoint
CREATE INDEX `idx_export_schedule_active` ON `history_export_schedules` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_export_schedule_next` ON `history_export_schedules` (`nextRunAt`);--> statement-breakpoint
CREATE INDEX `idx_export_schedule_creator` ON `history_export_schedules` (`createdBy`);