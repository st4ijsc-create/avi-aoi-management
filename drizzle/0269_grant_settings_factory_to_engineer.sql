-- doc 47 RBAC — align existing engineer-role users with the permission matrix.
-- The role matrix (permissionsRouter.ts) grants engineer `settings_factory`
-- (Quản lý nhà máy/xưởng/dây chuyền/trạm), and the factory-config server procedures
-- (hierarchyRouters + lineStage) now gate on requirePermission("settings_factory", …).
-- Engineers seeded BEFORE settings_factory was added to the matrix lack the DB grant,
-- so they'd hit FORBIDDEN. This idempotently grants it (view/create/edit/delete, no
-- export — matching the matrix) to every engineer user that doesn't already have it.
-- New engineers get it automatically from the matrix at seed time; this is the backfill.
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'settings', 'settings_factory', true, true, true, true, false, now(), now(), now()
FROM users u
WHERE u.role = 'engineer'
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'settings_factory'
  );
