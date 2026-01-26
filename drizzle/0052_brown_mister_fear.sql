CREATE TABLE `mqtt_client_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`brokerUrl` varchar(500) NOT NULL,
	`port` int NOT NULL DEFAULT 1883,
	`protocol` enum('mqtt','mqtts','ws','wss') NOT NULL DEFAULT 'mqtt',
	`username` varchar(255),
	`password` varchar(255),
	`clientIdPrefix` varchar(100),
	`useTls` boolean NOT NULL DEFAULT false,
	`tlsCertPath` text,
	`tlsKeyPath` text,
	`tlsCaPath` text,
	`rejectUnauthorized` boolean NOT NULL DEFAULT true,
	`keepAlive` int NOT NULL DEFAULT 60,
	`connectTimeout` int NOT NULL DEFAULT 30000,
	`reconnectPeriod` int NOT NULL DEFAULT 5000,
	`cleanSession` boolean NOT NULL DEFAULT true,
	`defaultQos` enum('0','1','2') NOT NULL DEFAULT '1',
	`subscribeTopics` json DEFAULT ('[]'),
	`publishTopics` json DEFAULT ('[]'),
	`messageRetain` boolean NOT NULL DEFAULT false,
	`isDefault` boolean NOT NULL DEFAULT false,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdBy` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_client_profiles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_connection_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int,
	`assignmentId` int,
	`clientId` varchar(255) NOT NULL,
	`brokerUrl` varchar(500) NOT NULL,
	`eventType` enum('connect','disconnect','error','reconnect') NOT NULL,
	`eventMessage` text,
	`errorCode` varchar(50),
	`ipAddress` varchar(45),
	`userAgent` text,
	`timestamp` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mqtt_connection_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_profile_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`profileId` int NOT NULL,
	`targetType` enum('machine','station','factory') NOT NULL,
	`targetId` int NOT NULL,
	`overrideSettings` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`assignedBy` int,
	`assignedAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_profile_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mqtt_topic_templates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`deviceType` enum('avi','aoi','spi','other') NOT NULL,
	`inspectionResultTopic` varchar(500),
	`ngAlertTopic` varchar(500),
	`statusTopic` varchar(500),
	`commandTopic` varchar(500),
	`heartbeatTopic` varchar(500),
	`messageFormat` enum('json','xml','csv','binary') NOT NULL DEFAULT 'json',
	`sampleMessages` json,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mqtt_topic_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_mqtt_profiles_name` ON `mqtt_client_profiles` (`name`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_profiles_active` ON `mqtt_client_profiles` (`isActive`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_profiles_default` ON `mqtt_client_profiles` (`isDefault`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_profile` ON `mqtt_connection_logs` (`profileId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_client` ON `mqtt_connection_logs` (`clientId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_event` ON `mqtt_connection_logs` (`eventType`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_logs_timestamp` ON `mqtt_connection_logs` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_assignments_profile` ON `mqtt_profile_assignments` (`profileId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_assignments_target` ON `mqtt_profile_assignments` (`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_templates_device` ON `mqtt_topic_templates` (`deviceType`);--> statement-breakpoint
CREATE INDEX `idx_mqtt_templates_active` ON `mqtt_topic_templates` (`isActive`);