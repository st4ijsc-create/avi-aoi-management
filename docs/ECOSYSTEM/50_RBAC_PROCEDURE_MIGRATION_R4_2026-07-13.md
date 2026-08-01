# 50 — RBAC procedure migration (doc 48 R4) · 2026-07-13

Đóng phát hiện doc 48 "~40 procedure role-hardgate (bỏ qua matrix)". Chuyển các
procedure gate theo ROLE (admin-hardgate) sang kiểm MATRIX quyền qua
`requirePermission(module, action)` — để role non-admin có grant đúng làm được.

**Phương pháp CONSERVATIVE:** chỉ migrate tập RÕ-RÀNG-AN-TOÀN (business CRUD, module
đã tồn tại, KHÔNG cần 2FA). Phần mơ hồ/rủi ro → bảng đề xuất CHỜ DUYỆT. Mirror chính
xác precedent `d14a1d84` (factory-config, đã live-verify doc 47).

## Bối cảnh đếm được
- **~365** định nghĩa `adminProcedure` trên 58 router — ĐA SỐ đúng-admin (identity/
  RBAC/license/system-infra/AI-model-lifecycle/deploy/actuation/machine-provisioning).
- **5** `roleProcedure(...)` = multi-role floor cố ý (admin/sup/eng + 2FA) — ngoài phạm vi.
- **~35** inline `role==='admin'` = hầu hết owner-or-admin data-scoping
  (`row.userId !== ctx.user.id && role!=='admin'`) — KHÔNG được migrate.
- **26 router** import `trpc.adminProcedure` = biến thể **CÓ 2FA**. Migrate khỏi nó =
  RỚT 2FA → phải gắn lại guard 2FA. Không đụng trong đợt này.

## ✅ ĐÃ MIGRATE (Part A) — 19 procedure, committed, PROVEN
Tất cả dùng `_shared.adminProcedure` (biến thể **KHÔNG 2FA**) → thay bằng
`protectedProcedure`/`writeProcedure` + `requirePermission` → GIỮ audit + tenant-scope,
**RỚT 0 guard 2FA**. Module xác nhận đã dùng cho chính entity đó (không lockout).

| router | procedure | gate mới |
|---|---|---|
| productRouters | productModel create/update/delete/clone | `settings_products` canCreate/canEdit/canDelete/canCreate |
| productRouters | measurementPoint create/update/delete | `settings_measurement_points` * |
| productionRouters | productionOrder create/update/delete/reschedule/createTemplate/updateTemplate/deleteTemplate | `production_orders` * (writeProcedure — tránh MOD_PRODUCTION shadow) |
| productionRouters | lineProductAssignment create/update/delete | `production_line_assignments` * |
| pdfReportRouter | saveTemplate/deleteTemplate | `reports_templates` canCreate/canDelete |

**PROVEN** (`scripts/verify/rbac-migration-proof.ts`, DB thật): supervisor1 (grant
production_orders canCreate) → PASS; operator1 (không grant) → DENY; admin → PASS
(scoped-admin OFF). tsc 0.

## ⏳ ĐỀ XUẤT (Part B) — ~55 candidate CHỜ USER DUYỆT (chưa sửa)
`(T)` = import `trpc.adminProcedure` → migrate sẽ **RỚT 2FA** (phải gắn lại).

| router:procedure | module đề xuất | rủi ro | ghi chú |
|---|---|---|---|
| productionRouters: apply/generate ScheduleRun/ApsScheduleRun, dismiss | `production_orders` canEdit/canCreate? | med | APS/HITL schedule-run (không phải order CRUD); action mapping chưa rõ |
| dataRouters: import Factories/Workshops/Lines/Stations/Machines/Products/MeasurementPoints/Workstations | `settings_factory`/`settings_products`/… **hoặc** `admin_import_export` /canCreate | med | chọn granularity: module-đích hay module-import riêng |
| dataRouters: exportStatistics | `reports_export`/`history_export`/`admin_import_export` canExport | med | module export mơ hồ |
| productRouters: backfillImageDimensions, importList, backfillComponentCodesFromBom, remapUnmapped, uploadCroppedImage | `settings_products`/`settings_measurement_points` canEdit/canCreate | low-med | bulk maintenance / per-point image |
| productRouters: productCategory create/update/delete/reorder/updateCount | `settings_products/*` | low-med | taxonomy phụ; reorder/updateCount semantics |
| productRouters: fiducialMark *, mpLightingProfile *, measurementTypeCatalog *, cadImport parse/apply/centroid* | `settings_products`/`settings_measurement_points`/`admin_import_export` | med-high | vision config / CAD import; module chưa rõ |
| productRouters: defectCatalog *, msaWizard *, instrumentCalibration/MsaRecord * | *không module sạch* | high | master-data/quality; KHÔNG bịa module (sẽ deny mọi người) |
| dashboardStats/Widget: dashboardTemplate/sharedTemplate create/update/delete, sharePreset, setRoleDefault | `dashboard_templates/*` | med-high | cross-user/shared; `setRoleDefault` = governance role khác |
| alertRouters: listAll · statusTemplateRouters: getAlertConfig/updateAlertConfig, template *, offline-notif | `settings_alerts`/`machine_*` | med | đọc toàn-user / config ngưỡng |
| mqttClientManagementRouter: profile/assign/template/scheduler * **(T)** | `mqtt_*` | **high** | config-to-device; **RỚT 2FA** |
| ngRateThresholdRouter: testCheck/sendTestAlert **(T)** · executiveReportRouter: generateNow **(T)** · productPackageRouter: export/importPackage **(T)** | `settings_yield_thresholds`/`reports_*`/`settings_products` | med | **RỚT 2FA** |
| enhancedAuditRouter: list/history/diff/stats/exportCsv **(T)** | `admin_audit` canView/canExport | med-high | đọc audit-trail nhạy cảm; quyết định có mở cho role auditor non-admin? **RỚT 2FA** |
| notificationRouters: sendToUser/broadcast | *không module sạch* | med | admin messaging |
| mqttOeeRouters: updateMapping/updateSettings/create/delete | `mqtt_configure`? | med-high | cùng router có actuation (xem allowlist) |

## 🔒 ALLOWLIST — PHẢI giữ admin (cho CI lint tương lai)
Identity/RBAC/license/security-secret/provisioning/actuation/deploy/system-infra/
AI-model-lifecycle. `(T)`=2FA.
- **userRouters** (identity) · **permissionsRouter (T)** (RBAC) · **licenseRouter (T)** ·
  **sitesRouter (T)** (federation) · **backupRouter (T)** · **integrityRouter (T)** ·
  **enhancedAuditRouter (T)** (trừ khi mở `admin_audit`)
- **aiSettingsRouter** (API-key secret, system-config) · **hierarchyRouters**
  approve/reject/**regenerateApiKey**/uploadImage/capabilitiesDrift (provisioning) ·
  **edgeDeploymentRouter (T)** (deploy/rollback) · **mqttOeeRouters** sendCommand/
  sendConfigure/approve/reject (**actuation/provisioning**) · **mqttSoftwareVersionRouter**
  uploadApk/setLatest/pushUpdate (**OTA firmware**) · **robotRouter (T)** (OT actuation) ·
  manualConnectionRouter (device conn) · **enterpriseIntegrationRouter (T)** ·
  **contractsRouter (T)** · **mappingAsCodeRouter (T)** (GitOps) · doraRouter(T)/
  predictiveMaintenanceRouter (jobs)
- **Mọi AI model/infra router** (aiModel/aiAdvanced/aiAnomaly(T)/aiQualityGate canary-
  promote-rollback/aiEval(T)/aiGguf loadModel/… ) — ML lifecycle, `settings_ai` KHÔNG
  tồn tại (bịa = deny mọi người) · **systemRouters** (webhook/SMTP/system-config/cache/
  logo) · **seedDataRouter** (dev seed) · **mqttClientManagementRouter (T)** tới khi duyệt

## Kế tiếp (USER quyết)
1. Duyệt từng cụm Part B (chọn module + có mở cho role non-admin không). Cụm `(T)` phải
   quyết cách GẮN LẠI 2FA nếu migrate.
2. Sau khi tập admin-legit ổn định → thêm **CI lint** cấm `adminProcedure` mới ngoài
   allowlist (chặn regression role-hardgate).
3. `RBAC_SCOPED_ADMIN=true` ở staging để admin hết god cross-tenant (đã có, doc 48 R4).
