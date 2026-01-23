CREATE TABLE `user_corporate_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`corporateCode` varchar(50) NOT NULL,
	`assignedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_corporate_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_factory_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`factoryCode` varchar(50) NOT NULL,
	`assignedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_factory_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_corporate_user` ON `user_corporate_assignments` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_corporate_code` ON `user_corporate_assignments` (`corporateCode`);--> statement-breakpoint
CREATE INDEX `idx_user_corporate_unique` ON `user_corporate_assignments` (`userId`,`corporateCode`);--> statement-breakpoint
CREATE INDEX `idx_user_factory_user` ON `user_factory_assignments` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_factory_code` ON `user_factory_assignments` (`factoryCode`);--> statement-breakpoint
CREATE INDEX `idx_user_factory_unique` ON `user_factory_assignments` (`userId`,`factoryCode`);