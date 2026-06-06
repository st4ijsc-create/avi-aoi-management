CREATE TYPE "public"."otadapterstatusenum" AS ENUM('disabled', 'connecting', 'connected', 'error');--> statement-breakpoint
CREATE TYPE "public"."otdatatypeenum" AS ENUM('bool', 'int', 'float', 'string', 'json');--> statement-breakpoint
CREATE TYPE "public"."otprotocolenum" AS ENUM('opcua', 'modbus', 's7', 'mitsubishi-mc', 'ethernet-ip', 'stub');--> statement-breakpoint
CREATE TABLE "device_adapters" (
	"id" serial PRIMARY KEY NOT NULL,
	"machineId" integer,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"protocol" "otprotocolenum" NOT NULL,
	"endpoint" varchar(500) NOT NULL,
	"connectionOptions" json,
	"pollIntervalMs" integer DEFAULT 5000 NOT NULL,
	"status" "otadapterstatusenum" DEFAULT 'disabled' NOT NULL,
	"lastConnectedAt" timestamp,
	"lastErrorAt" timestamp,
	"lastError" text,
	"isEnabled" boolean DEFAULT false NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_adapters_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "device_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"adapterId" integer NOT NULL,
	"tagKey" varchar(128) NOT NULL,
	"address" varchar(255) NOT NULL,
	"dataType" "otdatatypeenum" NOT NULL,
	"unit" varchar(50),
	"scale" numeric(18, 6) DEFAULT '1',
	"offset" numeric(18, 6) DEFAULT '0',
	"writable" boolean DEFAULT false NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_device_tags_adapter_key" UNIQUE("adapterId","tagKey")
);
--> statement-breakpoint
CREATE TABLE "ot_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"adapterId" integer NOT NULL,
	"machineId" integer,
	"tagKey" varchar(128) NOT NULL,
	"valueNumeric" numeric(18, 6),
	"valueText" varchar(500),
	"quality" varchar(16) DEFAULT 'good' NOT NULL,
	"timestamp" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_device_adapters_machine" ON "device_adapters" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_device_adapters_protocol" ON "device_adapters" USING btree ("protocol");--> statement-breakpoint
CREATE INDEX "idx_device_adapters_enabled" ON "device_adapters" USING btree ("isEnabled");--> statement-breakpoint
CREATE INDEX "idx_device_tags_adapter" ON "device_tags" USING btree ("adapterId");--> statement-breakpoint
CREATE INDEX "idx_ot_telemetry_adapter" ON "ot_telemetry" USING btree ("adapterId");--> statement-breakpoint
CREATE INDEX "idx_ot_telemetry_machine" ON "ot_telemetry" USING btree ("machineId");--> statement-breakpoint
CREATE INDEX "idx_ot_telemetry_tag_time" ON "ot_telemetry" USING btree ("tagKey","timestamp");--> statement-breakpoint
CREATE INDEX "idx_ot_telemetry_timestamp" ON "ot_telemetry" USING btree ("timestamp");