CREATE TYPE "public"."package_activity_log_event" AS ENUM('presign', 'upload_start', 'upload_success', 'upload_fail', 'commit_start', 'commit_success', 'commit_fail', 'retry', 'image_view', 'zip_download', 'status_change');--> statement-breakpoint
CREATE TYPE "public"."packagestatusenum" AS ENUM('pending', 'uploading', 'uploaded', 'committed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."permissioncategoryenum" AS ENUM('dashboard', 'history', 'analytics', 'reports', 'mqtt', 'settings', 'admin');--> statement-breakpoint
CREATE TABLE "inspection_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"inspectionId" integer,
	"machineId" integer NOT NULL,
	"packageId" varchar(100) NOT NULL,
	"storageKey" varchar(500),
	"storageUrl" text,
	"serialNumber" varchar(100),
	"productModel" varchar(100),
	"factoryCode" varchar(50),
	"lineCode" varchar(50),
	"machineCode" varchar(50),
	"inspectionTime" timestamp,
	"overallResult" "overallresultenum",
	"totalPoints" integer DEFAULT 0,
	"okCount" integer DEFAULT 0,
	"ngCount" integer DEFAULT 0,
	"fileSizeBytes" bigint,
	"imageCount" integer DEFAULT 0,
	"status" "packagestatusenum" DEFAULT 'pending' NOT NULL,
	"errorMessage" text,
	"presignExpiresAt" timestamp,
	"uploadedAt" timestamp,
	"committedAt" timestamp,
	"metaJson" json,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_packages_packageId_unique" UNIQUE("packageId")
);
--> statement-breakpoint
CREATE TABLE "package_activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"packageDbId" integer NOT NULL,
	"packageId" varchar(100) NOT NULL,
	"machineId" integer,
	"event" "package_activity_log_event" NOT NULL,
	"level" varchar(10) DEFAULT 'info' NOT NULL,
	"message" text NOT NULL,
	"detail" text,
	"source" varchar(30),
	"userId" integer,
	"userName" varchar(100),
	"ipAddress" varchar(45),
	"userAgent" varchar(500),
	"durationMs" integer,
	"fileSizeBytes" bigint,
	"metadata" json,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "package_images" (
	"id" serial PRIMARY KEY NOT NULL,
	"packageId" integer NOT NULL,
	"pointCode" varchar(50) NOT NULL,
	"pointName" varchar(255),
	"fileName" varchar(255) NOT NULL,
	"result" "overallresultenum",
	"measurementValue" varchar(100),
	"cachedUrl" text,
	"cachedAt" timestamp,
	"cacheExpiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"category" "permissioncategoryenum" NOT NULL,
	"moduleName" varchar(100) NOT NULL,
	"canView" boolean DEFAULT false NOT NULL,
	"canCreate" boolean DEFAULT false NOT NULL,
	"canEdit" boolean DEFAULT false NOT NULL,
	"canDelete" boolean DEFAULT false NOT NULL,
	"canExport" boolean DEFAULT false NOT NULL,
	"customPermissions" json,
	"grantedBy" integer,
	"grantedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_queue_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer NOT NULL,
	"queuedCount" integer DEFAULT 0 NOT NULL,
	"uploadingCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"completedCount" integer DEFAULT 0 NOT NULL,
	"diskUsedBytes" bigint,
	"diskFreeBytes" bigint,
	"avgUploadLatencyMs" integer,
	"lastUploadAt" timestamp,
	"lastErrorMessage" text,
	"recordedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"isSystem" boolean DEFAULT false NOT NULL,
	"permissions" json NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE INDEX "idx_pkg_inspection" ON "inspection_packages" USING btree ("inspectionId");--> statement-breakpoint
CREATE INDEX "idx_pkg_machine" ON "inspection_packages" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_pkg_package_id" ON "inspection_packages" USING btree ("packageId");--> statement-breakpoint
CREATE INDEX "idx_pkg_serial" ON "inspection_packages" USING btree ("serialNumber");--> statement-breakpoint
CREATE INDEX "idx_pkg_status" ON "inspection_packages" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pkg_inspection_time" ON "inspection_packages" USING btree ("inspectionTime");--> statement-breakpoint
CREATE INDEX "idx_pkg_machine_time" ON "inspection_packages" USING btree ("machineId","inspectionTime");--> statement-breakpoint
CREATE INDEX "idx_pal_package" ON "package_activity_logs" USING btree ("packageDbId");--> statement-breakpoint
CREATE INDEX "idx_pal_package_id" ON "package_activity_logs" USING btree ("packageId");--> statement-breakpoint
CREATE INDEX "idx_pal_event" ON "package_activity_logs" USING btree ("event");--> statement-breakpoint
CREATE INDEX "idx_pal_created" ON "package_activity_logs" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_pal_machine" ON "package_activity_logs" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_pkgimg_package" ON "package_images" USING btree ("packageId");--> statement-breakpoint
CREATE INDEX "idx_pkgimg_point" ON "package_images" USING btree ("pointCode");--> statement-breakpoint
CREATE INDEX "idx_permissions_user" ON "permissions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "idx_permissions_category" ON "permissions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_permissions_module" ON "permissions" USING btree ("moduleName");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_permissions_user_module" ON "permissions" USING btree ("userId","moduleName");--> statement-breakpoint
CREATE INDEX "idx_uqm_machine" ON "upload_queue_metrics" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_uqm_recorded" ON "upload_queue_metrics" USING btree ("recordedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "mqtt_subscriptions_client_topic_unique" ON "mqtt_subscriptions" USING btree ("clientId","topic");