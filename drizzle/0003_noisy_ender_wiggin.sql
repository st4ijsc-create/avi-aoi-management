ALTER TABLE "machines" ALTER COLUMN "apiKey" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "serialNumber" varchar(100);--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "firmwareVersion" varchar(50);--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "syncMode" "statusenum_1" DEFAULT 'online' NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "registrationStatus" varchar(20) DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "lastSyncAt" timestamp;--> statement-breakpoint
ALTER TABLE "machines" ADD COLUMN "pendingConfig" text;--> statement-breakpoint
CREATE INDEX "idx_machines_registration_status" ON "machines" USING btree ("registrationStatus");--> statement-breakpoint
CREATE INDEX "idx_machines_syncmode" ON "machines" USING btree ("syncMode");--> statement-breakpoint
CREATE INDEX "idx_machines_serial_number" ON "machines" USING btree ("serialNumber");