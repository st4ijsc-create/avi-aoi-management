ALTER TYPE "public"."deliverystatusenum" ADD VALUE 'SENT';--> statement-breakpoint
ALTER TYPE "public"."messagetypeenum" ADD VALUE 'COMMAND';--> statement-breakpoint
ALTER TYPE "public"."modelformatenum" ADD VALUE 'GGUF';--> statement-breakpoint
CREATE TABLE "factory_alert_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(50) NOT NULL,
	"versionCode" integer NOT NULL,
	"releaseDate" timestamp DEFAULT now() NOT NULL,
	"changelog" text,
	"apkFileName" varchar(255),
	"apkFilePath" varchar(500),
	"fileSize" integer,
	"mandatory" boolean DEFAULT false NOT NULL,
	"minVersionCode" integer,
	"isActive" boolean DEFAULT false NOT NULL,
	"uploadedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mqtt_software_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" varchar(50) NOT NULL,
	"versionCode" integer NOT NULL,
	"releaseDate" timestamp DEFAULT now() NOT NULL,
	"changelog" text,
	"apkFileKey" varchar(500),
	"apkFileUrl" text,
	"apkFileName" varchar(255),
	"fileSize" integer,
	"mandatory" boolean DEFAULT false NOT NULL,
	"minVersionCode" integer,
	"isLatest" boolean DEFAULT false NOT NULL,
	"uploadedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mqtt_software_versions_versionCode_unique" UNIQUE("versionCode")
);
--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "workshopCode" varchar(50);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "lineCode" varchar(50);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "stageCode" varchar(50);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "productionOrderCode" varchar(100);--> statement-breakpoint
ALTER TABLE "product_inspections" ADD COLUMN "operatorId" varchar(50);--> statement-breakpoint
ALTER TABLE "mqtt_clients" ADD COLUMN "ipAddress" varchar(45);--> statement-breakpoint
ALTER TABLE "mqtt_clients" ADD COLUMN "brand" varchar(100);--> statement-breakpoint
ALTER TABLE "mqtt_clients" ADD COLUMN "manufacturer" varchar(100);--> statement-breakpoint
ALTER TABLE "mqtt_clients" ADD COLUMN "screenResolution" varchar(50);--> statement-breakpoint
ALTER TABLE "mqtt_clients" ADD COLUMN "networkType" varchar(50);--> statement-breakpoint
CREATE INDEX "idx_fa_version_code" ON "factory_alert_versions" USING btree ("versionCode");--> statement-breakpoint
CREATE INDEX "idx_fa_version_active" ON "factory_alert_versions" USING btree ("isActive");--> statement-breakpoint
CREATE INDEX "idx_sw_version_code" ON "mqtt_software_versions" USING btree ("versionCode");--> statement-breakpoint
CREATE INDEX "idx_sw_version_latest" ON "mqtt_software_versions" USING btree ("isLatest");--> statement-breakpoint
CREATE INDEX "idx_inspections_workshop" ON "product_inspections" USING btree ("workshopCode");--> statement-breakpoint
CREATE INDEX "idx_inspections_line" ON "product_inspections" USING btree ("lineCode");--> statement-breakpoint
CREATE INDEX "idx_inspections_production_order" ON "product_inspections" USING btree ("productionOrderCode");