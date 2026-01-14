CREATE TABLE `backup_codes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`code` varchar(20) NOT NULL,
	`isUsed` boolean NOT NULL DEFAULT false,
	`usedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `backup_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `system_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`settingKey` varchar(100) NOT NULL,
	`settingValue` text,
	`description` text,
	`category` varchar(50),
	`updatedBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `system_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `system_settings_settingKey_unique` UNIQUE(`settingKey`)
);
--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`sessionToken` varchar(255) NOT NULL,
	`deviceName` varchar(255),
	`deviceType` varchar(50),
	`browser` varchar(100),
	`os` varchar(100),
	`ipAddress` varchar(45),
	`location` varchar(255),
	`isActive` boolean NOT NULL DEFAULT true,
	`lastActivityAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_sessions_sessionToken_unique` UNIQUE(`sessionToken`)
);
--> statement-breakpoint
CREATE INDEX `idx_backup_codes_user` ON `backup_codes` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_backup_codes_code` ON `backup_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_system_settings_key` ON `system_settings` (`settingKey`);--> statement-breakpoint
CREATE INDEX `idx_system_settings_category` ON `system_settings` (`category`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_user` ON `user_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_token` ON `user_sessions` (`sessionToken`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_active` ON `user_sessions` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_user_sessions_expires` ON `user_sessions` (`expiresAt`);