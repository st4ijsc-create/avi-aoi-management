ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::text;--> statement-breakpoint
DROP TYPE "public"."roleenum";--> statement-breakpoint
CREATE TYPE "public"."roleenum" AS ENUM('admin', 'supervisor', 'quality_inspector', 'operator', 'maintenance', 'viewer', 'user');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'user'::"public"."roleenum";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."roleenum" USING "role"::"public"."roleenum";