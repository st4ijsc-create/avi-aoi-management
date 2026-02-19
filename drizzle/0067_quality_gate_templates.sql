-- Migration 0067: Quality Gate Templates
-- Thêm bảng lưu trữ mẫu cổng chất lượng tùy chỉnh

CREATE TABLE IF NOT EXISTS "quality_gate_templates" (
  "id" SERIAL PRIMARY KEY,
  "name" VARCHAR(255) NOT NULL,
  "description" TEXT,
  "standard" VARCHAR(100) NOT NULL DEFAULT 'custom',
  "category" VARCHAR(100) NOT NULL DEFAULT 'general',
  "rules" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "notifyRoles" JSONB DEFAULT '["admin", "quality_manager"]'::jsonb,
  "createdBy" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS "idx_qgt_standard" ON "quality_gate_templates" ("standard");
CREATE INDEX IF NOT EXISTS "idx_qgt_category" ON "quality_gate_templates" ("category");
CREATE INDEX IF NOT EXISTS "idx_qgt_createdBy" ON "quality_gate_templates" ("createdBy");

-- Table to track which templates are applied to which production lines
CREATE TABLE IF NOT EXISTS "quality_gate_template_assignments" (
  "id" SERIAL PRIMARY KEY,
  "templateId" INTEGER NOT NULL REFERENCES "quality_gate_templates"("id") ON DELETE CASCADE,
  "lineId" INTEGER NOT NULL REFERENCES "production_lines"("id") ON DELETE CASCADE,
  "assignedBy" INTEGER REFERENCES "users"("id") ON DELETE SET NULL,
  "assignedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "isActive" BOOLEAN DEFAULT TRUE,
  UNIQUE("templateId", "lineId")
);

CREATE INDEX IF NOT EXISTS "idx_qgta_templateId" ON "quality_gate_template_assignments" ("templateId");
CREATE INDEX IF NOT EXISTS "idx_qgta_lineId" ON "quality_gate_template_assignments" ("lineId");
