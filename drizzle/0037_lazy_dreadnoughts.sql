CREATE TABLE `product_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`parentId` int,
	`color` varchar(20) DEFAULT '#3b82f6',
	`icon` varchar(50),
	`orderIndex` int NOT NULL DEFAULT 0,
	`productCount` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_categories_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `idx_product_categories_code` ON `product_categories` (`code`);--> statement-breakpoint
CREATE INDEX `idx_product_categories_parent` ON `product_categories` (`parentId`);--> statement-breakpoint
CREATE INDEX `idx_product_categories_order` ON `product_categories` (`orderIndex`);--> statement-breakpoint
CREATE INDEX `idx_product_categories_active` ON `product_categories` (`isActive`);