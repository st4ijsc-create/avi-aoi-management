CREATE TABLE `factory_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`layoutId` int NOT NULL,
	`factoryId` int NOT NULL,
	`positionX` int NOT NULL,
	`positionY` int NOT NULL,
	`positionZ` int DEFAULT 0,
	`width` int NOT NULL DEFAULT 300,
	`height` int NOT NULL DEFAULT 200,
	`depth` int DEFAULT 150,
	`rotation` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `factory_positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_models` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`referenceImageUrl` text,
	`referenceImageKey` varchar(255),
	`imageWidth` int,
	`imageHeight` int,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_models_id` PRIMARY KEY(`id`),
	CONSTRAINT `product_models_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `workshop_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`layoutId` int NOT NULL,
	`workshopId` int NOT NULL,
	`positionX` int NOT NULL,
	`positionY` int NOT NULL,
	`positionZ` int DEFAULT 0,
	`width` int NOT NULL DEFAULT 200,
	`height` int NOT NULL DEFAULT 150,
	`depth` int DEFAULT 100,
	`rotation` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workshop_positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `factory_layouts` MODIFY COLUMN `workshopId` int;--> statement-breakpoint
ALTER TABLE `measurement_point_defs` MODIFY COLUMN `machineId` int;--> statement-breakpoint
ALTER TABLE `measurement_point_defs` MODIFY COLUMN `measurementType` enum('DIMENSION','VISUAL','ELECTRICAL','POSITION','COLOR','SURFACE','OTHER') NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_statistics` ADD `factoryId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_statistics` ADD `workshopId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `daily_statistics` ADD `avgCycleTime` decimal(10,2);--> statement-breakpoint
ALTER TABLE `factories` ADD `region` varchar(100);--> statement-breakpoint
ALTER TABLE `factories` ADD `country` varchar(100);--> statement-breakpoint
ALTER TABLE `factory_layouts` ADD `factoryId` int;--> statement-breakpoint
ALTER TABLE `factory_layouts` ADD `layoutLevel` enum('CORPORATION','FACTORY','WORKSHOP') DEFAULT 'WORKSHOP' NOT NULL;--> statement-breakpoint
ALTER TABLE `factory_layouts` ADD `depth` int DEFAULT 500;--> statement-breakpoint
ALTER TABLE `factory_layouts` ADD `model3dUrl` text;--> statement-breakpoint
ALTER TABLE `machine_positions` ADD `depth` int DEFAULT 60;--> statement-breakpoint
ALTER TABLE `machine_positions` ADD `rotationY` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `machine_positions` ADD `rotationZ` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `machine_positions` ADD `scale` decimal(5,2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `productModelId` int NOT NULL;--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `positionX` int NOT NULL;--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `positionY` int NOT NULL;--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `radius` int DEFAULT 20 NOT NULL;--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `referenceImageKey` varchar(255);--> statement-breakpoint
ALTER TABLE `measurement_point_defs` ADD `orderIndex` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `measurement_results` ADD `measuredValueText` varchar(255);--> statement-breakpoint
ALTER TABLE `measurement_results` ADD `aiComparisonScore` decimal(5,4);--> statement-breakpoint
ALTER TABLE `product_inspections` ADD `productModelId` int;--> statement-breakpoint
ALTER TABLE `workshops` ADD `floorArea` decimal(10,2);--> statement-breakpoint
CREATE INDEX `idx_fac_positions_layout` ON `factory_positions` (`layoutId`);--> statement-breakpoint
CREATE INDEX `idx_fac_positions_factory` ON `factory_positions` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_product_models_code` ON `product_models` (`code`);--> statement-breakpoint
CREATE INDEX `idx_ws_positions_layout` ON `workshop_positions` (`layoutId`);--> statement-breakpoint
CREATE INDEX `idx_ws_positions_workshop` ON `workshop_positions` (`workshopId`);--> statement-breakpoint
CREATE INDEX `idx_stats_machine_date` ON `daily_statistics` (`machineId`,`date`);--> statement-breakpoint
CREATE INDEX `idx_stats_factory_date` ON `daily_statistics` (`factoryId`,`date`);--> statement-breakpoint
CREATE INDEX `idx_stats_workshop_date` ON `daily_statistics` (`workshopId`,`date`);--> statement-breakpoint
CREATE INDEX `idx_stats_date` ON `daily_statistics` (`date`);--> statement-breakpoint
CREATE INDEX `idx_factories_code` ON `factories` (`code`);--> statement-breakpoint
CREATE INDEX `idx_factories_active` ON `factories` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_layouts_factory` ON `factory_layouts` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_layouts_workshop` ON `factory_layouts` (`workshopId`);--> statement-breakpoint
CREATE INDEX `idx_layouts_level` ON `factory_layouts` (`layoutLevel`);--> statement-breakpoint
CREATE INDEX `idx_positions_layout` ON `machine_positions` (`layoutId`);--> statement-breakpoint
CREATE INDEX `idx_positions_machine` ON `machine_positions` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_machines_station` ON `machines` (`stationId`);--> statement-breakpoint
CREATE INDEX `idx_machines_code` ON `machines` (`code`);--> statement-breakpoint
CREATE INDEX `idx_machines_apikey` ON `machines` (`apiKey`);--> statement-breakpoint
CREATE INDEX `idx_point_defs_product` ON `measurement_point_defs` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_point_defs_machine` ON `measurement_point_defs` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_point_defs_code` ON `measurement_point_defs` (`code`);--> statement-breakpoint
CREATE INDEX `idx_results_inspection` ON `measurement_results` (`inspectionId`);--> statement-breakpoint
CREATE INDEX `idx_results_point` ON `measurement_results` (`pointDefId`);--> statement-breakpoint
CREATE INDEX `idx_results_result` ON `measurement_results` (`result`);--> statement-breakpoint
CREATE INDEX `idx_inspections_machine` ON `product_inspections` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_inspections_serial` ON `product_inspections` (`serialNumber`);--> statement-breakpoint
CREATE INDEX `idx_inspections_time` ON `product_inspections` (`inspectionTime`);--> statement-breakpoint
CREATE INDEX `idx_inspections_result` ON `product_inspections` (`overallResult`);--> statement-breakpoint
CREATE INDEX `idx_inspections_product_model` ON `product_inspections` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_inspections_machine_time` ON `product_inspections` (`machineId`,`inspectionTime`);--> statement-breakpoint
CREATE INDEX `idx_lines_workshop` ON `production_lines` (`workshopId`);--> statement-breakpoint
CREATE INDEX `idx_lines_code` ON `production_lines` (`code`);--> statement-breakpoint
CREATE INDEX `idx_stations_line` ON `stations` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_stations_code` ON `stations` (`code`);--> statement-breakpoint
CREATE INDEX `idx_workshops_factory` ON `workshops` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_workshops_code` ON `workshops` (`code`);