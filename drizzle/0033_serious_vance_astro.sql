CREATE TABLE `dashboard_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`templateType` enum('system','shared') NOT NULL DEFAULT 'shared',
	`widgets` json NOT NULL,
	`layout` json NOT NULL,
	`previewImageUrl` text,
	`isPublic` boolean NOT NULL DEFAULT true,
	`createdBy` int NOT NULL,
	`usageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dashboard_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_dashboard_templates_type` ON `dashboard_templates` (`templateType`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_templates_public` ON `dashboard_templates` (`isPublic`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_templates_creator` ON `dashboard_templates` (`createdBy`);--> statement-breakpoint
CREATE INDEX `idx_dashboard_templates_usage` ON `dashboard_templates` (`usageCount`);