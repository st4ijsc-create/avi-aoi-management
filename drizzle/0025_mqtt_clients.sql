CREATE TABLE `mqtt_clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` varchar(128) NOT NULL,
	`deviceId` varchar(128) NOT NULL,
	`deviceName` varchar(255),
	`deviceModel` varchar(100),
	`osVersion` varchar(50),
	`appVersion` varchar(50),
	`stationId` int,
	`processId` int,
	`approvalStatus` enum('PENDING','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING',
	`approvedBy` int,
	`approvedAt` timestamp,
	`rejectionReason` text,
	`mappingType` enum('AUTO','MANUAL') NOT NULL DEFAULT 'MANUAL',
	`autoReconnect` boolean NOT NULL DEFAULT true,
	`connectionStatus` enum('ONLINE','OFFLINE','DISCONNECTED') NOT NULL DEFAULT 'OFFLINE',
	`lastConnectedAt` timestamp,
	`lastDisconnectedAt` timestamp,
	`lastHeartbeat` timestamp,
	`receiveNGAlerts` boolean NOT NULL DEFAULT true,
	`receiveDailySummary` boolean NOT NULL DEFAULT true,
	`receiveWeeklySummary` boolean NOT NULL DEFAULT true,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `mqtt_clients_clientId_unique` UNIQUE(`clientId`),
	CONSTRAINT `mqtt_clients_deviceId_unique` UNIQUE(`deviceId`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_error_summary` (
	`id` int AUTO_INCREMENT NOT NULL,
	`summaryType` enum('DAILY','WEEKLY') NOT NULL,
	`summaryDate` timestamp NOT NULL,
	`stationId` int NOT NULL,
	`processId` int,
	`measurementPointId` int,
	`totalInspections` int NOT NULL DEFAULT 0,
	`totalNG` int NOT NULL DEFAULT 0,
	`totalNTF` int NOT NULL DEFAULT 0,
	`ngRate` decimal(5,2) NOT NULL DEFAULT '0',
	`topNGPoints` json,
	`sentToClients` boolean NOT NULL DEFAULT false,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_error_summary_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_message_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`messageType` enum('NG_ALERT','DAILY_SUMMARY','WEEKLY_SUMMARY','CUSTOM') NOT NULL,
	`topic` varchar(255) NOT NULL,
	`payload` json NOT NULL,
	`targetClientId` int,
	`stationId` int,
	`inspectionId` int,
	`deliveryStatus` enum('PENDING','DELIVERED','FAILED') NOT NULL DEFAULT 'PENDING',
	`deliveredAt` timestamp,
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_message_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_subscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`clientId` int NOT NULL,
	`topic` varchar(255) NOT NULL,
	`qos` int NOT NULL DEFAULT 1,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mqtt_clients_clientId` ON `mqtt_clients` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_clients_deviceId` ON `mqtt_clients` (`deviceId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_clients_station` ON `mqtt_clients` (`stationId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_clients_approval` ON `mqtt_clients` (`approvalStatus`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_clients_connection` ON `mqtt_clients` (`connectionStatus`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_clients_active` ON `mqtt_clients` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_error_summary_type` ON `mqtt_error_summary` (`summaryType`);--> statement-breakpoint
CREATE INDEX `idx_error_summary_date` ON `mqtt_error_summary` (`summaryDate`);--> statement-breakpoint
CREATE INDEX `idx_error_summary_station` ON `mqtt_error_summary` (`stationId`);--> statement-breakpoint
CREATE INDEX `idx_error_summary_sent` ON `mqtt_error_summary` (`sentToClients`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_type` ON `mqtt_message_logs` (`messageType`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_topic` ON `mqtt_message_logs` (`topic`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_client` ON `mqtt_message_logs` (`targetClientId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_station` ON `mqtt_message_logs` (`stationId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_status` ON `mqtt_message_logs` (`deliveryStatus`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_created` ON `mqtt_message_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_subs_client` ON `mqtt_subscriptions` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_subs_topic` ON `mqtt_subscriptions` (`topic`);