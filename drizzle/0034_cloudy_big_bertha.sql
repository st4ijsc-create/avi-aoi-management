CREATE TABLE `line_process_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lineId` int NOT NULL,
	`processId` int NOT NULL,
	`orderIndex` int NOT NULL DEFAULT 0,
	`cycleTimeTarget` decimal(10,2),
	`stationId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `line_process_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`processType` enum('SMT','DIP','ASSEMBLY','TESTING','PACKAGING','INSPECTION','OTHER') NOT NULL DEFAULT 'OTHER',
	`cycleTimeTarget` decimal(10,2),
	`orderIndex` int NOT NULL DEFAULT 0,
	`color` varchar(20) DEFAULT '#3b82f6',
	`icon` varchar(50),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processes_id` PRIMARY KEY(`id`),
	CONSTRAINT `processes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `idx_lpa_line` ON `line_process_assignments` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_lpa_process` ON `line_process_assignments` (`processId`);--> statement-breakpoint
CREATE INDEX `idx_lpa_station` ON `line_process_assignments` (`stationId`);--> statement-breakpoint
CREATE INDEX `idx_lpa_order` ON `line_process_assignments` (`orderIndex`);--> statement-breakpoint
CREATE INDEX `idx_processes_code` ON `processes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_processes_type` ON `processes` (`processType`);--> statement-breakpoint
CREATE INDEX `idx_processes_order` ON `processes` (`orderIndex`);--> statement-breakpoint
CREATE INDEX `idx_processes_active` ON `processes` (`isActive`);