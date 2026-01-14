CREATE TABLE `manual_machine_connections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`machineId` int NOT NULL,
	`ipAddress` varchar(45) NOT NULL,
	`port` int NOT NULL DEFAULT 8080,
	`protocol` enum('websocket','tcp','http') NOT NULL DEFAULT 'websocket',
	`isEnabled` boolean NOT NULL DEFAULT true,
	`lastConnectionAttempt` timestamp,
	`lastSuccessfulConnection` timestamp,
	`connectionStatus` enum('connected','disconnected','error','pending') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`retryCount` int NOT NULL DEFAULT 0,
	`maxRetries` int NOT NULL DEFAULT 5,
	`retryIntervalSeconds` int NOT NULL DEFAULT 30,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `manual_machine_connections_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_manual_conn_machine` ON `manual_machine_connections` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_manual_conn_ip` ON `manual_machine_connections` (`ipAddress`);--> statement-breakpoint
CREATE INDEX `idx_manual_conn_status` ON `manual_machine_connections` (`connectionStatus`);