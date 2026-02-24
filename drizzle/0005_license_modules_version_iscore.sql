ALTER TABLE "license_modules" ADD COLUMN "version" varchar(20) DEFAULT '1.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "license_modules" ADD COLUMN "is_core" boolean DEFAULT false NOT NULL;