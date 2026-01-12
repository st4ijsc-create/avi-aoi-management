CREATE TABLE `daily_statistics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`date` timestamp NOT NULL,
	`totalCount` int NOT NULL DEFAULT 0,
	`okCount` int NOT NULL DEFAULT 0,
	`ngCount` int NOT NULL DEFAULT 0,
	`ntfCount` int NOT NULL DEFAULT 0,
	`yieldRate` decimal(5,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `daily_statistics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `factories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`address` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `factories_id` PRIMARY KEY(`id`),
	CONSTRAINT `factories_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `factory_layouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workshopId` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`layoutType` enum('2D','3D') NOT NULL DEFAULT '2D',
	`layoutData` text,
	`width` int NOT NULL DEFAULT 1000,
	`height` int NOT NULL DEFAULT 800,
	`backgroundImageUrl` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `factory_layouts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machine_positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`layoutId` int NOT NULL,
	`machineId` int NOT NULL,
	`positionX` int NOT NULL,
	`positionY` int NOT NULL,
	`positionZ` int DEFAULT 0,
	`width` int NOT NULL DEFAULT 100,
	`height` int NOT NULL DEFAULT 80,
	`rotation` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machine_positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`stationId` int NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`machineType` enum('AVI','AOI','AUTOMATION') NOT NULL,
	`model` varchar(100),
	`manufacturer` varchar(100),
	`apiKey` varchar(128) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`lastHeartbeat` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `machines_id` PRIMARY KEY(`id`),
	CONSTRAINT `machines_code_unique` UNIQUE(`code`),
	CONSTRAINT `machines_apiKey_unique` UNIQUE(`apiKey`)
);
--> statement-breakpoint
CREATE TABLE `measurement_point_defs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`measurementType` enum('DIMENSION','VISUAL','ELECTRICAL','OTHER') NOT NULL,
	`unit` varchar(20),
	`lowerLimit` decimal(15,6),
	`upperLimit` decimal(15,6),
	`nominalValue` decimal(15,6),
	`referenceImageUrl` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `measurement_point_defs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `measurement_results` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inspectionId` int NOT NULL,
	`pointDefId` int NOT NULL,
	`measuredValue` decimal(15,6),
	`result` enum('OK','NG') NOT NULL,
	`imageUrl` text,
	`imageKey` varchar(255),
	`remark` text,
	`aiAnalysisResult` text,
	`aiConfidence` decimal(5,4),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `measurement_results_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `product_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`serialNumber` varchar(100) NOT NULL,
	`productModel` varchar(100),
	`batchNumber` varchar(100),
	`overallResult` enum('OK','NG','NTF') NOT NULL,
	`originalResult` enum('OK','NG') NOT NULL,
	`ntfConfirmedBy` int,
	`ntfConfirmedAt` timestamp,
	`ntfReason` text,
	`inspectionTime` timestamp NOT NULL,
	`cycleTime` decimal(10,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `product_inspections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `production_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`workshopId` int NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `production_lines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`lineId` int NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`orderIndex` int NOT NULL DEFAULT 0,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `workshops` (
	`id` int AUTO_INCREMENT NOT NULL,
	`factoryId` int NOT NULL,
	`code` varchar(50) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `workshops_id` PRIMARY KEY(`id`)
);
