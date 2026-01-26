CREATE TABLE `mqtt_connection_status` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`assignmentId` int,
	`targetType` enum('machine','station','factory'),
	`targetId` int,
	`status` enum('connected','disconnected','connecting','error','unknown') NOT NULL DEFAULT 'unknown',
	`clientId` varchar(255),
	`brokerUrl` varchar(500),
	`connectedAt` timestamp,
	`disconnectedAt` timestamp,
	`lastHeartbeat` timestamp,
	`uptime` int DEFAULT 0,
	`reconnectCount` int NOT NULL DEFAULT 0,
	`totalConnectionTime` int DEFAULT 0,
	`lastErrorMessage` text,
	`lastErrorCode` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_connection_status_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_reconnect_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`assignmentId` int,
	`targetType` enum('machine','station','factory'),
	`targetId` int,
	`eventType` enum('attempt','success','failure','max_attempts_reached') NOT NULL,
	`attemptNumber` int NOT NULL DEFAULT 1,
	`reconnectDelay` int,
	`connectionDuration` int,
	`errorCode` varchar(100),
	`errorMessage` text,
	`clientId` varchar(255),
	`brokerUrl` varchar(500),
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_reconnect_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_conn_status_profile` ON `mqtt_connection_status` (`profileId`);--> statement-breakpoint
CREATE INDEX `idx_conn_status_assignment` ON `mqtt_connection_status` (`assignmentId`);--> statement-breakpoint
CREATE INDEX `idx_conn_status_status` ON `mqtt_connection_status` (`status`);--> statement-breakpoint
CREATE INDEX `idx_conn_status_target` ON `mqtt_connection_status` (`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `idx_reconnect_profile` ON `mqtt_reconnect_logs` (`profileId`);--> statement-breakpoint
CREATE INDEX `idx_reconnect_assignment` ON `mqtt_reconnect_logs` (`assignmentId`);--> statement-breakpoint
CREATE INDEX `idx_reconnect_event` ON `mqtt_reconnect_logs` (`eventType`);--> statement-breakpoint
CREATE INDEX `idx_reconnect_timestamp` ON `mqtt_reconnect_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_reconnect_target` ON `mqtt_reconnect_logs` (`targetType`,`targetId`);