-- doc 40 Lan-P0 — QUYỀN PHIÊN SẢN XUẤT (production_session).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: OperatorSessionControl + ShiftHandoverDialog (vào ca / tạm dừng / kết
-- thúc / bàn giao ca) trước đây gate trên `production_orders` (canCreate/canEdit).
-- Nhưng operator được seed `production_orders` với canCreate=false/canEdit=false
-- (đúng — operator KHÔNG được tạo đơn sản xuất) → 4/8 journey operator hỏng.
--
-- Giải pháp (không đổi lõi RBAC, không thêm cột): tách một moduleName MỚI
-- `production_session` thuộc CATEGORY 'production' (đã tồn tại trong
-- permissioncategoryenum) — moduleName là varchar tự do nên KHÔNG cần đổi enum.
--
-- Migration này BACKFILL quyền cho các user HIỆN CÓ thuộc role operator/supervisor
-- (template trong permissionsRouter.DEFAULT_ROLE_PERMISSIONS đã thêm entry tương
-- ứng cho user tạo mới / khi re-apply role). Admin bypass ở tầng code nên không cần.
--
-- Idempotent: ON CONFLICT trên unique index (userId, moduleName) → chạy lại vô hại.
-- Numbered 0237 (0236 = program_version_review).
-- ════════════════════════════════════════════════════════════════════════════

-- Operator: mở/tạm dừng/kết thúc/bàn giao ca của CHÍNH MÌNH (view+create+edit).
INSERT INTO "permissions" ("userId", "category", "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
SELECT u."id", 'production', 'production_session', true, true, true, false, false
FROM "users" u
WHERE u."role" = 'operator'
ON CONFLICT ("userId", "moduleName") DO NOTHING;

-- Supervisor: quản lý phiên sản xuất của line (view+create+edit).
INSERT INTO "permissions" ("userId", "category", "moduleName", "canView", "canCreate", "canEdit", "canDelete", "canExport")
SELECT u."id", 'production', 'production_session', true, true, true, false, false
FROM "users" u
WHERE u."role" = 'supervisor'
ON CONFLICT ("userId", "moduleName") DO NOTHING;
