-- Custom user dashboards table
CREATE TABLE IF NOT EXISTS "user_custom_dashboards" (
  "id" serial PRIMARY KEY NOT NULL,
  "userId" integer NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "widgets" json NOT NULL DEFAULT '[]'::json,
  "gridCols" integer NOT NULL DEFAULT 4,
  "isPublic" boolean NOT NULL DEFAULT false,
  "isFavorite" boolean NOT NULL DEFAULT false,
  "autoRefreshInterval" integer NOT NULL DEFAULT 0,
  "globalFilters" json DEFAULT '{}'::json,
  "themePreset" varchar(50) DEFAULT 'default',
  "createdAt" timestamp DEFAULT now() NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_user_custom_dashboards_user" ON "user_custom_dashboards" ("userId");
CREATE INDEX IF NOT EXISTS "idx_user_custom_dashboards_public" ON "user_custom_dashboards" ("isPublic");
CREATE INDEX IF NOT EXISTS "idx_user_custom_dashboards_favorite" ON "user_custom_dashboards" ("userId", "isFavorite");
