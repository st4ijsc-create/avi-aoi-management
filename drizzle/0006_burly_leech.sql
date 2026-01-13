CREATE TABLE `product_machine_mappings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productModelId` int NOT NULL,
	`machineId` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`priority` int NOT NULL DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_machine_mappings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shift_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`factoryId` int,
	`name` varchar(100) NOT NULL,
	`code` varchar(20) NOT NULL,
	`startHour` int NOT NULL,
	`startMinute` int NOT NULL DEFAULT 0,
	`endHour` int NOT NULL,
	`endMinute` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`orderIndex` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shift_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_pm_mapping_product` ON `product_machine_mappings` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_pm_mapping_machine` ON `product_machine_mappings` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_shift_factory` ON `shift_configs` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_shift_code` ON `shift_configs` (`code`);