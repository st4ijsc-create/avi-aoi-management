-- Migration: Expand User Roles
-- Add more role types: supervisor, operator, quality_inspector, maintenance, viewer

-- Step 1: Drop existing enum type (need to update dependent columns first)
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role TYPE TEXT;

-- Step 2: Drop old enum
DROP TYPE IF EXISTS "roleenum";

-- Step 3: Create new enum with expanded roles
CREATE TYPE "roleenum" AS ENUM (
  'admin',
  'supervisor',
  'quality_inspector',
  'operator',
  'maintenance',
  'viewer',
  'user'
);

-- Step 4: Convert column back to enum with new default
ALTER TABLE users ALTER COLUMN role TYPE roleenum USING role::roleenum;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';

-- Step 5: Create index for role-based queries
CREATE INDEX IF NOT EXISTS "idx_users_role" ON users(role);

-- Step 6: Insert default role templates (if table exists)
INSERT INTO user_roles (name, description, "isSystem", permissions, "createdAt", "updatedAt") VALUES
('Admin', 'Full system access - can manage everything', true, '[]'::json, NOW(), NOW()),
('Supervisor', 'Workshop supervisor - can view all data and manage operators', true, '[]'::json, NOW(), NOW()),
('Quality Inspector', 'Quality control specialist - can view and export data, manage quality alerts', true, '[]'::json, NOW(), NOW()),
('Operator', 'Machine operator - can view assigned machines and submit data', true, '[]'::json, NOW(), NOW()),
('Maintenance', 'Maintenance technician - can view machine status and logs', true, '[]'::json, NOW(), NOW()),
('Viewer', 'Read-only access - can only view dashboards and reports', true, '[]'::json, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- Comments
COMMENT ON TYPE "roleenum" IS 'User role types: admin (full access), supervisor (workshop manager), quality_inspector (QC specialist), operator (machine operator), maintenance (technician), viewer (read-only), user (basic access)';
COMMENT ON INDEX "idx_users_role" IS 'Index for role-based user queries and filtering';
