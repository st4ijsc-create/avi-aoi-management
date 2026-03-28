CREATE TABLE IF NOT EXISTS "product_documents" (
  "id" serial PRIMARY KEY NOT NULL,
  "productModelId" integer NOT NULL,
  "fileName" varchar(255) NOT NULL,
  "fileKey" varchar(500) NOT NULL,
  "fileUrl" text NOT NULL,
  "fileSize" integer,
  "mimeType" varchar(100) NOT NULL,
  "uploadedBy" integer,
  "uploadedByName" varchar(255),
  "createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_product_documents_product" ON "product_documents" ("productModelId");
