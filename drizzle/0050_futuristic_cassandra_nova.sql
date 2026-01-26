CREATE TABLE `ai_feedback` (
	`id` int AUTO_INCREMENT NOT NULL,
	`suggestionId` int NOT NULL,
	`feedbackType` enum('CORRECT','INCORRECT','PARTIAL','UNSURE') NOT NULL,
	`accuracy` int,
	`correctedValue` text,
	`correctionNotes` text,
	`errorCategory` enum('FALSE_POSITIVE','FALSE_NEGATIVE','MISCLASSIFICATION','WRONG_LOCATION','WRONG_SEVERITY','OTHER'),
	`includedInTraining` boolean NOT NULL DEFAULT false,
	`trainingBatchId` varchar(100),
	`feedbackBy` int NOT NULL,
	`feedbackByName` varchar(255),
	`feedbackAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_feedback_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_model_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`modelName` varchar(100) NOT NULL,
	`modelVersion` varchar(50) NOT NULL,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`totalSuggestions` int NOT NULL DEFAULT 0,
	`reviewedSuggestions` int NOT NULL DEFAULT 0,
	`correctCount` int NOT NULL DEFAULT 0,
	`incorrectCount` int NOT NULL DEFAULT 0,
	`partialCount` int NOT NULL DEFAULT 0,
	`accuracy` decimal(5,4),
	`metricsByType` json,
	`errorBreakdown` json,
	`accuracyTrend` enum('IMPROVING','DECLINING','STABLE') DEFAULT 'STABLE',
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_model_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_suggestions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inspectionId` int NOT NULL,
	`measurementResultId` int,
	`suggestionType` enum('DEFECT_CLASSIFICATION','ROOT_CAUSE','CORRECTIVE_ACTION','QUALITY_PREDICTION','PROCESS_OPTIMIZATION') NOT NULL,
	`suggestion` text NOT NULL,
	`confidence` decimal(5,4) NOT NULL,
	`reasoning` text,
	`alternatives` json,
	`modelVersion` varchar(50) NOT NULL,
	`modelName` varchar(100) NOT NULL,
	`status` enum('PENDING','ACCEPTED','REJECTED','REVIEWED') NOT NULL DEFAULT 'PENDING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_suggestions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_training_batches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`batchId` varchar(100) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`feedbackCount` int NOT NULL DEFAULT 0,
	`correctSamples` int NOT NULL DEFAULT 0,
	`incorrectSamples` int NOT NULL DEFAULT 0,
	`exportFormat` enum('JSON','CSV','JSONL','PARQUET') NOT NULL DEFAULT 'JSONL',
	`exportUrl` text,
	`status` enum('PENDING','PROCESSING','COMPLETED','FAILED','UPLOADED') NOT NULL DEFAULT 'PENDING',
	`targetModelName` varchar(100),
	`targetModelVersion` varchar(50),
	`createdBy` int NOT NULL,
	`createdByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `ai_training_batches_id` PRIMARY KEY(`id`),
	CONSTRAINT `ai_training_batches_batchId_unique` UNIQUE(`batchId`)
);
--> statement-breakpoint
CREATE TABLE `annotation_comparison_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`productModelId` int,
	`serialNumber` varchar(100),
	`machineId` int,
	`inspectionIds` json NOT NULL,
	`comparisonResult` json,
	`detectedPatterns` json,
	`status` enum('PENDING','PROCESSING','COMPLETED','FAILED') NOT NULL DEFAULT 'PENDING',
	`errorMessage` text,
	`createdBy` int NOT NULL,
	`createdByName` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `annotation_comparison_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `defect_heatmap_data` (
	`id` int AUTO_INCREMENT NOT NULL,
	`factoryId` int,
	`workshopId` int,
	`lineId` int,
	`stationId` int,
	`machineId` int,
	`productModelId` int,
	`periodType` enum('HOURLY','DAILY','WEEKLY','MONTHLY') NOT NULL,
	`periodStart` timestamp NOT NULL,
	`periodEnd` timestamp NOT NULL,
	`gridWidth` int NOT NULL,
	`gridHeight` int NOT NULL,
	`heatmapGrid` json NOT NULL,
	`totalDefects` int NOT NULL DEFAULT 0,
	`maxDefectsInCell` int NOT NULL DEFAULT 0,
	`hotspots` json,
	`topLocations` json,
	`generatedAt` timestamp NOT NULL DEFAULT (now()),
	`processingTimeMs` int,
	CONSTRAINT `defect_heatmap_data_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ai_feedback_suggestion` ON `ai_feedback` (`suggestionId`);--> statement-breakpoint
CREATE INDEX `idx_ai_feedback_type` ON `ai_feedback` (`feedbackType`);--> statement-breakpoint
CREATE INDEX `idx_ai_feedback_training` ON `ai_feedback` (`includedInTraining`);--> statement-breakpoint
CREATE INDEX `idx_ai_feedback_batch` ON `ai_feedback` (`trainingBatchId`);--> statement-breakpoint
CREATE INDEX `idx_ai_metrics_model` ON `ai_model_metrics` (`modelName`,`modelVersion`);--> statement-breakpoint
CREATE INDEX `idx_ai_metrics_period` ON `ai_model_metrics` (`periodStart`,`periodEnd`);--> statement-breakpoint
CREATE INDEX `idx_ai_suggestion_inspection` ON `ai_suggestions` (`inspectionId`);--> statement-breakpoint
CREATE INDEX `idx_ai_suggestion_type` ON `ai_suggestions` (`suggestionType`);--> statement-breakpoint
CREATE INDEX `idx_ai_suggestion_status` ON `ai_suggestions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_ai_suggestion_model` ON `ai_suggestions` (`modelName`,`modelVersion`);--> statement-breakpoint
CREATE INDEX `idx_training_batch_id` ON `ai_training_batches` (`batchId`);--> statement-breakpoint
CREATE INDEX `idx_training_batch_status` ON `ai_training_batches` (`status`);--> statement-breakpoint
CREATE INDEX `idx_training_batch_created` ON `ai_training_batches` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_comparison_product` ON `annotation_comparison_sessions` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_comparison_serial` ON `annotation_comparison_sessions` (`serialNumber`);--> statement-breakpoint
CREATE INDEX `idx_comparison_machine` ON `annotation_comparison_sessions` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_comparison_status` ON `annotation_comparison_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `idx_comparison_created` ON `annotation_comparison_sessions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_heatmap_factory` ON `defect_heatmap_data` (`factoryId`);--> statement-breakpoint
CREATE INDEX `idx_heatmap_machine` ON `defect_heatmap_data` (`machineId`);--> statement-breakpoint
CREATE INDEX `idx_heatmap_product` ON `defect_heatmap_data` (`productModelId`);--> statement-breakpoint
CREATE INDEX `idx_heatmap_period` ON `defect_heatmap_data` (`periodType`);--> statement-breakpoint
CREATE INDEX `idx_heatmap_generated` ON `defect_heatmap_data` (`generatedAt`);