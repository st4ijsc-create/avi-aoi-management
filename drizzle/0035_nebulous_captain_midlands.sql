CREATE TABLE `widget_style_presets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	`backgroundColor` varchar(20) NOT NULL DEFAULT '#ffffff',
	`textColor` varchar(20) NOT NULL DEFAULT '#1f2937',
	`borderColor` varchar(20) NOT NULL DEFAULT '#e5e7eb',
	`accentColor` varchar(20) NOT NULL DEFAULT '#3b82f6',
	`borderRadius` varchar(20) NOT NULL DEFAULT '0.5rem',
	`shadow` enum('none','sm','md','lg','xl') NOT NULL DEFAULT 'sm',
	`opacity` decimal(3,2) NOT NULL DEFAULT '1.00',
	`presetType` enum('system','shared','user') NOT NULL DEFAULT 'user',
	`isPublic` boolean NOT NULL DEFAULT false,
	`createdBy` int NOT NULL,
	`usageCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `widget_style_presets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_widget_presets_type` ON `widget_style_presets` (`presetType`);--> statement-breakpoint
CREATE INDEX `idx_widget_presets_public` ON `widget_style_presets` (`isPublic`);--> statement-breakpoint
CREATE INDEX `idx_widget_presets_creator` ON `widget_style_presets` (`createdBy`);--> statement-breakpoint
CREATE INDEX `idx_widget_presets_name` ON `widget_style_presets` (`name`);