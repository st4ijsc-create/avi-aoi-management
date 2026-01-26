CREATE TABLE `training_batch_comments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(100) NOT NULL,
	`userId` int NOT NULL,
	`userName` varchar(255),
	`content` text NOT NULL,
	`parentId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `training_batch_comments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `training_batch_tag_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(100) NOT NULL,
	`tagId` int NOT NULL,
	`assignedBy` int NOT NULL,
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_batch_tag_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `training_batch_tags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`color` varchar(20) NOT NULL DEFAULT '#3b82f6',
	`description` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `training_batch_tags_id` PRIMARY KEY(`id`),
	CONSTRAINT `training_batch_tags_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE INDEX `idx_batch_comment_batch` ON `training_batch_comments` (`batchId`);--> statement-breakpoint
CREATE INDEX `idx_batch_comment_user` ON `training_batch_comments` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_batch_comment_parent` ON `training_batch_comments` (`parentId`);--> statement-breakpoint
CREATE INDEX `idx_batch_tag_assign_batch` ON `training_batch_tag_assignments` (`batchId`);--> statement-breakpoint
CREATE INDEX `idx_batch_tag_assign_tag` ON `training_batch_tag_assignments` (`tagId`);--> statement-breakpoint
CREATE INDEX `idx_batch_tag_name` ON `training_batch_tags` (`name`);