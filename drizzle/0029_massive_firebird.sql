ALTER TABLE `product_inspections` ADD `corporateCode` varchar(50);--> statement-breakpoint
ALTER TABLE `product_inspections` ADD `factoryCode` varchar(50);--> statement-breakpoint
CREATE INDEX `idx_inspections_corporate` ON `product_inspections` (`corporateCode`);--> statement-breakpoint
CREATE INDEX `idx_inspections_factory` ON `product_inspections` (`factoryCode`);--> statement-breakpoint
CREATE INDEX `idx_inspections_corporate_factory` ON `product_inspections` (`corporateCode`,`factoryCode`);