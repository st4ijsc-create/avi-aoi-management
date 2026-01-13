CREATE TABLE `line_product_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lineId` int NOT NULL,
	`productModelId` int NOT NULL,
	`productionOrderId` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`startDate` timestamp,
	`endDate` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `line_product_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `line_stages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lineId` int NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`orderIndex` int NOT NULL DEFAULT 0,
	`stationId` int,
	`cycleTimeTarget` decimal(10,2),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `line_stages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `production_orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orderCode` varchar(100) NOT NULL,
	`companyCode` varchar(50) NOT NULL,
	`factoryId` int NOT NULL,
	`workshopId` int NOT NULL,
	`lineId` int NOT NULL,
	`productModelId` int NOT NULL,
	`targetQuantity` int NOT NULL,
	`completedQuantity` int NOT NULL DEFAULT 0,
	`okQuantity` int NOT NULL DEFAULT 0,
	`ngQuantity` int NOT NULL DEFAULT 0,
	`ntfQuantity` int NOT NULL DEFAULT 0,
	`status` enum('pending','in_progress','completed','cancelled','paused') NOT NULL DEFAULT 'pending',
	`priority` int NOT NULL DEFAULT 0,
	`plannedStartDate` timestamp,
	`plannedEndDate` timestamp,
	`actualStartDate` timestamp,
	`actualEndDate` timestamp,
	`notes` text,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `production_orders_id` PRIMARY KEY(`id`),
	CONSTRAINT `production_orders_orderCode_unique` UNIQUE(`orderCode`)
);
--> statement-breakpoint
CREATE INDEX `idx_lpa_line` ON `line_product_assignments` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_lpa_product` ON `line_product_assignments` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_lpa_order` ON `line_product_assignments` (`productionOrderId`);--> statement-breakpoint
CREATE INDEX `idx_stage_line` ON `line_stages` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_stage_code` ON `line_stages` (`code`);--> statement-breakpoint
CREATE INDEX `idx_stage_station` ON `line_stages` (`stationId`);--> statement-breakpoint
CREATE INDEX `idx_po_order_code` ON `production_orders` (`orderCode`);--> statement-breakpoint
CREATE INDEX `idx_po_company` ON `production_orders` (`companyCode`);--> statement-breakpoint
CREATE INDEX `idx_po_factory` ON `production_orders` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_po_workshop` ON `production_orders` (`workshopId`);--> statement-breakpoint
CREATE INDEX `idx_po_line` ON `production_orders` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_po_product` ON `production_orders` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_po_status` ON `production_orders` (`status`);