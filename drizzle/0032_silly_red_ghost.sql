CREATE TABLE `dashboard_widget_layouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`layoutName` varchar(100) NOT NULL DEFAULT 'default',
	`widgets` json NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dashboard_widget_layouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('ALERT','REPORT','SYSTEM','INFO','WARNING','SUCCESS') NOT NULL DEFAULT 'INFO',
	`title` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`entityType` varchar(50),
	`entityId` int,
	`actionUrl` varchar(500),
	`isRead` boolean NOT NULL DEFAULT false,
	`readAt` timestamp,
	`priority` enum('LOW','NORMAL','HIGH','URGENT') NOT NULL DEFAULT 'NORMAL',
	`expiresAt` timestamp,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `user_notification_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`emailEnabled` boolean NOT NULL DEFAULT true,
	`emailAlerts` boolean NOT NULL DEFAULT true,
	`emailReports` boolean NOT NULL DEFAULT true,
	`emailSystem` boolean NOT NULL DEFAULT true,
	`pushEnabled` boolean NOT NULL DEFAULT true,
	`pushAlerts` boolean NOT NULL DEFAULT true,
	`pushReports` boolean NOT NULL DEFAULT true,
	`pushSystem` boolean NOT NULL DEFAULT true,
	`inAppEnabled` boolean NOT NULL DEFAULT true,
	`inAppAlerts` boolean NOT NULL DEFAULT true,
	`inAppReports` boolean NOT NULL DEFAULT true,
	`inAppSystem` boolean NOT NULL DEFAULT true,
	`soundEnabled` boolean NOT NULL DEFAULT true,
	`quietHoursEnabled` boolean NOT NULL DEFAULT false,
	`quietHoursStart` varchar(10) DEFAULT '22:00',
	`quietHoursEnd` varchar(10) DEFAULT '07:00',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_notification_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_notification_preferences_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`language` varchar(10) NOT NULL DEFAULT 'vi',
	`theme` enum('light','dark','system') NOT NULL DEFAULT 'system',
	`timezone` varchar(50) DEFAULT 'Asia/Ho_Chi_Minh',
	`dateFormat` varchar(20) DEFAULT 'DD/MM/YYYY',
	`timeFormat` varchar(10) DEFAULT '24h',
	`numberFormat` varchar(20) DEFAULT '1.234,56',
	`defaultDashboardTab` varchar(50) DEFAULT 'overview',
	`sidebarCollapsed` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `user_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_settings_userId_unique` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE INDEX `idx_widget_layouts_user` ON `dashboard_widget_layouts` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_widget_layouts_active` ON `dashboard_widget_layouts` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_widget_layouts_user_active` ON `dashboard_widget_layouts` (`userId`,`isActive`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user` ON `notifications` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_notifications_type` ON `notifications` (`type`);--> statement-breakpoint
CREATE INDEX `idx_notifications_read` ON `notifications` (`isRead`);--> statement-breakpoint
CREATE INDEX `idx_notifications_priority` ON `notifications` (`priority`);--> statement-breakpoint
CREATE INDEX `idx_notifications_created` ON `notifications` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_notifications_user_unread` ON `notifications` (`userId`,`isRead`);--> statement-breakpoint
CREATE INDEX `idx_notif_prefs_user` ON `user_notification_preferences` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_settings_user` ON `user_settings` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_user_settings_language` ON `user_settings` (`language`);