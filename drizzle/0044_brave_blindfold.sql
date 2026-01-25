CREATE TABLE `downtime_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`machineCode` varchar(50) NOT NULL,
	`category` enum('planned','unplanned','breakdown','changeover','maintenance','other') NOT NULL,
	`reason` varchar(255) NOT NULL,
	`detailedReason` text,
	`startTime` timestamp NOT NULL,
	`endTime` timestamp,
	`duration` int,
	`detectionMethod` enum('MANUAL','AUTO','MQTT') NOT NULL DEFAULT 'MANUAL',
	`reportedBy` int,
	`acknowledgedBy` int,
	`acknowledgedAt` timestamp,
	`resolution` text,
	`resolvedBy` int,
	`resolvedAt` timestamp,
	`affectedUnits` int DEFAULT 0,
	`estimatedCost` decimal(10,2),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `downtime_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `machine_health_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`machineCode` varchar(50) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`healthScore` int NOT NULL,
	`oeeScore` int NOT NULL,
	`uptimeScore` int NOT NULL,
	`errorRateScore` int NOT NULL,
	`cycleTimeScore` int NOT NULL,
	`currentOEE` int,
	`uptimePercentage` int,
	`errorCount` int,
	`cycleTimeVariance` decimal(10,2),
	`predictedFailureRisk` int,
	`recommendedMaintenanceDate` timestamp,
	`maintenanceUrgency` enum('LOW','MEDIUM','HIGH','CRITICAL'),
	`calculationMethod` varchar(50) NOT NULL DEFAULT 'WEIGHTED',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `machine_health_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_message_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`topic` varchar(255) NOT NULL,
	`machineCode` varchar(50),
	`payload` json NOT NULL,
	`qos` int NOT NULL DEFAULT 0,
	`timestamp` timestamp NOT NULL,
	`messageSize` int,
	`processingTime` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_message_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oee_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`machineCode` varchar(50) NOT NULL,
	`timestamp` timestamp NOT NULL,
	`periodType` enum('HOUR','SHIFT','DAY','WEEK','MONTH') NOT NULL DEFAULT 'HOUR',
	`availability` int NOT NULL,
	`performance` int NOT NULL,
	`quality` int NOT NULL,
	`oee` int NOT NULL,
	`plannedTime` int NOT NULL,
	`runTime` int NOT NULL,
	`idealCycleTime` int NOT NULL,
	`totalCount` int NOT NULL,
	`goodCount` int NOT NULL,
	`rejectCount` int NOT NULL,
	`calculatedBy` varchar(50) NOT NULL DEFAULT 'AUTO',
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `oee_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `oee_targets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int,
	`lineId` int,
	`targetOEE` int NOT NULL DEFAULT 8000,
	`targetAvailability` int NOT NULL DEFAULT 9000,
	`targetPerformance` int NOT NULL DEFAULT 9500,
	`targetQuality` int NOT NULL DEFAULT 9900,
	`alertThreshold` int NOT NULL DEFAULT 7000,
	`criticalThreshold` int NOT NULL DEFAULT 6000,
	`effectiveFrom` timestamp NOT NULL DEFAULT (now()),
	`effectiveTo` timestamp,
	`isActive` boolean NOT NULL DEFAULT true,
	`setBy` int NOT NULL,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `oee_targets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_downtime_machine` ON `downtime_events` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_downtime_machine_code` ON `downtime_events` (`machineCode`);--> statement-breakpoint
CREATE INDEX `idx_downtime_category` ON `downtime_events` (`category`);--> statement-breakpoint
CREATE INDEX `idx_downtime_start` ON `downtime_events` (`startTime`);--> statement-breakpoint
CREATE INDEX `idx_downtime_end` ON `downtime_events` (`endTime`);--> statement-breakpoint
CREATE INDEX `idx_downtime_machine_time` ON `downtime_events` (`machineId`,`startTime`);--> statement-breakpoint
CREATE INDEX `idx_health_machine` ON `machine_health_history` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_health_machine_code` ON `machine_health_history` (`machineCode`);--> statement-breakpoint
CREATE INDEX `idx_health_timestamp` ON `machine_health_history` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_health_score` ON `machine_health_history` (`healthScore`);--> statement-breakpoint
CREATE INDEX `idx_health_machine_time` ON `machine_health_history` (`machineId`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_history_topic` ON `mqtt_message_history` (`topic`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_history_machine` ON `mqtt_message_history` (`machineCode`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_history_timestamp` ON `mqtt_message_history` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_history_topic_time` ON `mqtt_message_history` (`topic`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_oee_machine` ON `oee_metrics` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_oee_machine_code` ON `oee_metrics` (`machineCode`);--> statement-breakpoint
CREATE INDEX `idx_oee_timestamp` ON `oee_metrics` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_oee_period` ON `oee_metrics` (`periodType`);--> statement-breakpoint
CREATE INDEX `idx_oee_machine_time` ON `oee_metrics` (`machineId`,`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_oee_target_machine` ON `oee_targets` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_oee_target_line` ON `oee_targets` (`lineId`);--> statement-breakpoint
CREATE INDEX `idx_oee_target_active` ON `oee_targets` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_oee_target_effective` ON `oee_targets` (`effectiveFrom`,`effectiveTo`);