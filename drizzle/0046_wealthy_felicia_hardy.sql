CREATE TABLE `report_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`code` varchar(50) NOT NULL,
	`description` text,
	`templateType` enum('DAILY','WEEKLY','MONTHLY','CUSTOM') NOT NULL,
	`sections` json NOT NULL,
	`emailSubjectTemplate` varchar(255),
	`emailBodyTemplate` text,
	`defaultSchedule` varchar(50),
	`isSystem` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `report_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `report_templates_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
ALTER TABLE `report_templates` ADD CONSTRAINT `report_templates_createdBy_users_id_fk` FOREIGN KEY (`createdBy`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `idx_report_templates_code` ON `report_templates` (`code`);--> statement-breakpoint
CREATE INDEX `idx_report_templates_type` ON `report_templates` (`templateType`);--> statement-breakpoint
CREATE INDEX `idx_report_templates_active` ON `report_templates` (`isActive`);