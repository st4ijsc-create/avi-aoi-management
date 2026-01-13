ALTER TABLE `product_models` ADD `category` varchar(100);--> statement-breakpoint
ALTER TABLE `product_models` ADD `productLine` varchar(100);--> statement-breakpoint
ALTER TABLE `product_models` ADD `variant` varchar(100);--> statement-breakpoint
ALTER TABLE `product_models` ADD `lifecycleStatus` enum('development','active','eol','archived') DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `product_models` ADD `targetYieldRate` decimal(5,2);--> statement-breakpoint
ALTER TABLE `product_models` ADD `minYieldRate` decimal(5,2);--> statement-breakpoint
CREATE INDEX `idx_product_models_category` ON `product_models` (`category`);--> statement-breakpoint
CREATE INDEX `idx_product_models_lifecycle` ON `product_models` (`lifecycleStatus`);