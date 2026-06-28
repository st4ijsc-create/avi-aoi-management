-- ============================================================================
-- Migration 0100: MES/MOM MASTER DATA (Audit doc 07 §③)
-- Supplier / Material(+class) / Customer / Skill(+Certification) / Tool-Fixture
-- masters. ADDITIVE ONLY — creates new enum types + new tables/indexes; NO
-- ALTER on any existing table or enum. Idempotent (IF NOT EXISTS + guarded
-- DO blocks for enum types). Relates to existing denormalized columns by code.
-- ============================================================================

-- ── Enum types (guarded create) ────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "suppliertypeenum" AS ENUM ('component','raw_material','service','equipment','subcontractor','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "supplierapprovalstatusenum" AS ENUM ('pending','approved','conditional','rejected','suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "tooltypeenum" AS ENUM ('nozzle','stencil','squeegee','lens','jig','fixture','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "toolstatusenum" AS ENUM ('available','in_use','maintenance','worn','retired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "certificationlevelenum" AS ENUM ('trainee','qualified','expert','trainer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Suppliers ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "suppliers" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "type" "suppliertypeenum" NOT NULL DEFAULT 'component',
  "contactName" varchar(256),
  "contactEmail" varchar(320),
  "contactPhone" varchar(40),
  "address" text,
  "country" varchar(80),
  "rating" numeric(4,2),
  "approvalStatus" "supplierapprovalstatusenum" NOT NULL DEFAULT 'pending',
  "isActive" boolean NOT NULL DEFAULT true,
  "corporateCode" varchar(50),
  "factoryCode" varchar(50),
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_suppliers_code"     ON "suppliers" ("code");
CREATE INDEX IF NOT EXISTS "idx_suppliers_type"     ON "suppliers" ("type");
CREATE INDEX IF NOT EXISTS "idx_suppliers_approval" ON "suppliers" ("approvalStatus");
CREATE INDEX IF NOT EXISTS "idx_suppliers_active"   ON "suppliers" ("isActive");
CREATE INDEX IF NOT EXISTS "idx_suppliers_corp"     ON "suppliers" ("corporateCode");

-- ── Material classes (optional hierarchy) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS "material_classes" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "parentCode" varchar(64),
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_matclass_code"   ON "material_classes" ("code");
CREATE INDEX IF NOT EXISTS "idx_matclass_parent" ON "material_classes" ("parentCode");

-- ── Materials / Components ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "materials" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "materialClass" varchar(64),
  "mpn" varchar(128),
  "manufacturer" varchar(256),
  "packageType" varchar(64),
  "msl" varchar(8),
  "rohs" boolean NOT NULL DEFAULT true,
  "unit" varchar(16) NOT NULL DEFAULT 'pcs',
  "datasheetUrl" text,
  "defaultSupplierCode" varchar(64),
  "isActive" boolean NOT NULL DEFAULT true,
  "corporateCode" varchar(50),
  "factoryCode" varchar(50),
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_materials_code"     ON "materials" ("code");
CREATE INDEX IF NOT EXISTS "idx_materials_class"    ON "materials" ("materialClass");
CREATE INDEX IF NOT EXISTS "idx_materials_mpn"      ON "materials" ("mpn");
CREATE INDEX IF NOT EXISTS "idx_materials_supplier" ON "materials" ("defaultSupplierCode");
CREATE INDEX IF NOT EXISTS "idx_materials_active"   ON "materials" ("isActive");

-- ── Customers ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "customers" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "contactName" varchar(256),
  "contactEmail" varchar(320),
  "contactPhone" varchar(40),
  "address" text,
  "country" varchar(80),
  "isActive" boolean NOT NULL DEFAULT true,
  "corporateCode" varchar(50),
  "factoryCode" varchar(50),
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_customers_code"   ON "customers" ("code");
CREATE INDEX IF NOT EXISTS "idx_customers_active" ON "customers" ("isActive");
CREATE INDEX IF NOT EXISTS "idx_customers_corp"   ON "customers" ("corporateCode");

-- ── Skills ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "skills" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "category" varchar(64),
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_skills_code"     ON "skills" ("code");
CREATE INDEX IF NOT EXISTS "idx_skills_category" ON "skills" ("category");

-- ── User certifications (user × skill) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "user_certifications" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "skillId" integer NOT NULL,
  "level" "certificationlevelenum" NOT NULL DEFAULT 'trainee',
  "grantedAt" timestamp NOT NULL DEFAULT NOW(),
  "expiresAt" timestamp,
  "certifiedBy" integer,
  "notes" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_usercert_user"    ON "user_certifications" ("userId");
CREATE INDEX IF NOT EXISTS "idx_usercert_skill"   ON "user_certifications" ("skillId");
CREATE INDEX IF NOT EXISTS "idx_usercert_level"   ON "user_certifications" ("level");
CREATE INDEX IF NOT EXISTS "idx_usercert_expires" ON "user_certifications" ("expiresAt");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_usercert_user_skill" ON "user_certifications" ("userId","skillId");

-- ── Tools / Fixtures / Consumables ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "tools" (
  "id" serial PRIMARY KEY,
  "code" varchar(64) NOT NULL UNIQUE,
  "name" varchar(256) NOT NULL,
  "type" "tooltypeenum" NOT NULL DEFAULT 'other',
  "machineType" varchar(40),
  "lifeLimit" integer,
  "lifeUsed" integer NOT NULL DEFAULT 0,
  "status" "toolstatusenum" NOT NULL DEFAULT 'available',
  "location" varchar(128),
  "isActive" boolean NOT NULL DEFAULT true,
  "corporateCode" varchar(50),
  "factoryCode" varchar(50),
  "notes" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  "updatedAt" timestamp NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "idx_tools_code"   ON "tools" ("code");
CREATE INDEX IF NOT EXISTS "idx_tools_type"   ON "tools" ("type");
CREATE INDEX IF NOT EXISTS "idx_tools_status" ON "tools" ("status");
CREATE INDEX IF NOT EXISTS "idx_tools_active" ON "tools" ("isActive");
