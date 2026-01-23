ALTER TABLE `production_lines` ADD `capacityPerHour` int;--> statement-breakpoint
ALTER TABLE `production_lines` ADD `maxConcurrentOrders` int DEFAULT 1;