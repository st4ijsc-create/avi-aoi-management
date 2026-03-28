-- Create image_annotations table (was missing from PostgreSQL migration)
CREATE TABLE IF NOT EXISTS "image_annotations" (
  "id" serial PRIMARY KEY,
  "inspectionId" integer,
  "measurementResultId" integer,
  "imageUrl" text NOT NULL,
  "annotations" json,
  "createdBy" integer,
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_image_annotations_image_url" ON "image_annotations" ("imageUrl");
CREATE INDEX IF NOT EXISTS "idx_image_annotations_inspection" ON "image_annotations" ("inspectionId");
CREATE INDEX IF NOT EXISTS "idx_image_annotations_created_by" ON "image_annotations" ("createdBy");
CREATE INDEX IF NOT EXISTS "idx_image_annotations_created_at" ON "image_annotations" ("createdAt");
