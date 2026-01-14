CREATE TABLE `workstations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`lineId` int,
	`workshopId` int,
	`factoryId` int,
	`processType` enum('SMT','DIP','ASSEMBLY','TESTING','PACKAGING','OTHER') DEFAULT 'OTHER',
	`orderIndex` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workstations_id` PRIMARY KEY(`id`),
	CONSTRAINT `workstations_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `workstationId` int;--> statement-breakpoint
CREATE INDEX `idx_workstations_code` ON `workstations` (`code`);--> statement-breakpoint
CREATE INDEX `idx_workstations_line` ON `workstations` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_workstations_workshop` ON `workstations` (`workshopId`);--> statement-breakpoint
CREATE INDEX `idx_workstations_factory` ON `workstations` (`factoryId`);