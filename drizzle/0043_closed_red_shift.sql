CREATE TABLE `production_order_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`factoryId` int,
	`workshopId` int,
	`productModelId` int,
	`defaultTargetQuantity` int NOT NULL DEFAULT 1000,
	`defaultPriority` int NOT NULL DEFAULT 0,
	`defaultNotes` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `production_order_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_order_template_factory` ON `production_order_templates` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_order_template_workshop` ON `production_order_templates` (`workshopId`);--> statement-breakpoint
CREATE INDEX `idx_order_template_product` ON `production_order_templates` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_order_template_active` ON `production_order_templates` (`isActive`);