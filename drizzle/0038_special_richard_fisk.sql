ALTER TABLE `product_models` ADD `categoryId` int;--> statement-breakpoint
CREATE INDEX `idx_product_models_category_id` ON `product_models` (`categoryId`);