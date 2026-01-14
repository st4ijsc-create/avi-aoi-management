CREATE TABLE `measurement_point_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`category` varchar(100),
	`points` json NOT NULL,
	`pointCount` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `measurement_point_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `measurement_point_templates_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `idx_templates_code` ON `measurement_point_templates` (`code`);--> statement-breakpoint
CREATE INDEX `idx_templates_category` ON `measurement_point_templates` (`category`);--> statement-breakpoint
CREATE INDEX `idx_templates_active` ON `measurement_point_templates` (`isActive`);