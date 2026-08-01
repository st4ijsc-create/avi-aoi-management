-- doc 54 Wave B (Đ3) — grant operator + engineer READ-ONLY visibility of the MQTT/
-- Connectivity hub. The role matrix (permissionsRouter.ts) now seeds operator & engineer
-- with `mqtt_monitoring` canView ONLY (no create/edit/delete/export); every mqtt MUTATION
-- stays gated (writeProcedure + an mqtt permission bit — steps 1-5), so this is view-only.
-- Users seeded BEFORE this grant lack the DB row → hit FORBIDDEN on the read gate. This
-- idempotently backfills the canView-only permission for every existing operator/engineer
-- that doesn't already have an mqtt_monitoring row. New users get it from the matrix at
-- seed time; this mirrors the 0269 settings_factory backfill idiom.
--
-- NOTE: originally specced as 0275 (doc 54 file list); renumbered to 0277 because a
-- concurrent wave already claimed 0275_inspection_provenance.sql and 0276_gate_config_version.sql.
INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport", "grantedAt", "createdAt", "updatedAt")
SELECT u.id, 'mqtt', 'mqtt_monitoring', true, false, false, false, false, now(), now(), now()
FROM users u
WHERE u.role IN ('operator', 'engineer')
  AND NOT EXISTS (
    SELECT 1 FROM permissions p
    WHERE p."userId" = u.id AND p."moduleName" = 'mqtt_monitoring'
  );
