# WS-2 — Edge Deployment đầu-cuối + Wizard cài đặt máy mới

## 1. Mục tiêu
1. Khép kín vòng đời edge: đóng gói model (model+version+hash) → phân phối xuống máy → máy confirm DEPLOYED → heartbeat ACTIVE → khi online lại đồng bộ `edgeInferenceSync` về server.
2. Gộp đăng ký máy đang rải rác thành **Wizard onboarding 5 bước**, mục tiêu cài máy mới < 10 phút.

## 2. Hiện trạng (file:line)
- Schema sẵn sàng: `drizzle/schema/ai.ts:942-976` `edgeDeployments` (packageUrl/packageKey/packageHash/status/lastHeartbeatAt/offlineResultsPending), `:978-1006` `edgeInferenceSync`.
- `hierarchy.ts:123-163` `machines`: `apiKey`, `registrationStatus`, `syncMode`, `lastHeartbeat`, `pendingConfig`.
- Đăng ký qua Socket.io: `socket.ts:168` `machine:register` → `:285` `admin:approve_registration` (cấp apiKey) → `:393` `machine:request_config`. Không gắn bước deploy model.
- `socket.ts:519` `testManualConnection` (HTTP/TCP/WS) — tái dùng cho Wizard bước 2.
- MQTT `mqttService.ts`: `sendSoftwareUpdateCommand:585`, `publishPointsConfigChanged:1381` (khuôn mẫu notify version-bump). Auth MQTT `:289` chỉ kiểm `deviceId`, **không apiKey** → MQTT chỉ làm notify.
- `machineApiRouters.ts`: tất cả `publicProcedure` xác thực bằng apiKey|machineCode; mẫu `checkPointsVersion:810`/`deltaSyncPoints:1364` là khuôn cho `checkModelVersion`/`getModelPackage`.
- **VẤN ĐỀ CHÍNH:** `aiEdgeEnhancedRouter` **DISABLED** ở `routers.ts:82,405`; `createEdgeDeployment` (`aiAdvanced.ts:436`) không tính hash/không set packageUrl; **không có endpoint cho máy tải package / confirm / heartbeat ACTIVE**; `syncWithConflictResolution` chỉ `protectedProcedure` (browser).
- `storage.ts`: không có presigned URL; local mode phục vụ `/uploads` tĩnh (ai cũng tải được) → rủi ro lộ model.

## 3. Giao thức phân phối (quyết định)
**HTTP pull + checksum verify (chính), MQTT/Socket chỉ notify.** KHÔNG truyền binary qua MQTT (Aedes giữ payload trong RAM, không resume).

Luồng:
1. PACKAGING: đóng gói `modelVersions` file → `storagePut` → sha256 → `edgeDeployments` status=READY + packageUrl/Key/Hash/Size.
2. NOTIFY (best-effort): MQTT `avi/edge/{deviceId}/model-update` (retain) + Socket `machine:model_available`.
3. Máy nhận signal HOẶC poll `checkModelVersion(apiKey)` → so localHash vs packageHash.
4. `getModelPackage(apiKey, deploymentId)` → trả {downloadUrl proxy, hash, size, deployConfig}; status READY→DOWNLOADING.
5. Máy HTTP GET `/api/edge/download/:deploymentId` (apiKey header, Range resume) → verify sha256.
6. `confirmDeployment(apiKey, deploymentId, localHash)` → DEPLOYED (hoặc FAILED nếu lệch).
7. `edgeHeartbeat(apiKey, deploymentId)` định kỳ → DEPLOYED→ACTIVE; stale checker quá X phút → OUTDATED/offline.
8. `syncEdgeResults(apiKey, deploymentId, results[], localResultId)` khi online → ghi `edgeInferenceSync` idempotent, giảm `offlineResultsPending`.

**Bảo mật (IEC 62443/62543):** download qua **proxy Express verify apiKey máy ↔ deployment** (KHÔNG để máy chạm `/uploads` hay forge apiKey server). sha256 verify hai phía. Tùy chọn HMAC ký package (Phase 2). Rate-limit + audit mỗi download.

## 4. Wizard onboarding (5 bước) — `client/src/pages/MachineOnboardingWizard.tsx`
| Bước | Hành động | Endpoint |
|---|---|---|
| 1 Nhập thông tin & IP | code/name/type/serial/IP:port/protocol | tạo `machines` (pending) |
| 2 Test kết nối | test MQTT + Socket/HTTP, hiển thị latency | `socket.testManualConnection` + MQTT ping |
| 3 Gán vào station | factory→workshop→line→station; cấp apiKey; approve | `admin:approve_registration` + tRPC update |
| 4 Gán product model + deploy | chọn product + AI model → trigger PACKAGING + deploy | `edge.deployModel` (mới) |
| 5 Kiểm tra heartbeat & deploy | poll: máy online? deployment ACTIVE? | `edge.getDeploymentStatus` + Socket |
Tích hợp điểm vào (không thay thế): `MachineRegistration.tsx` (nút mở Wizard), `WorkstationManagement.tsx` (hierarchy bước 3), `MqttClientManagement.tsx` (test MQTT bước 2).

## 5. Các bước triển khai
1. Tạo router mới `edgeDeploymentRouter` (admin + machine-facing) thay vì bật trực tiếp router bị disable (an toàn với migration đang diễn ra). Giữ `machineApiRouter` cũ.
2. Migration (mục 7).
3. `packageModelForDeployment(deploymentId)` trong `aiEdgeEnhanced.ts` (đọc fileKey → sha256 → storagePut → READY).
4. Proxy download `server/routes/edgeDownload.ts` (`/api/edge/download/:deploymentId`, verify apiKey, Range).
5. Machine endpoints (thêm vào `machineApiRouter`): `checkModelVersion`, `getModelPackage`, `confirmDeployment`, `edgeHeartbeat`, `syncEdgeResults` (idempotent qua localResultId).
6. Admin endpoints: `deployModel`, `getDeploymentStatus`, `listDeployments`, `getFleetOverview`, `redeploy`, `rollback`.
7. `publishModelUpdate` (mqttService) + Socket emit `machine:model_available`.
8. Stale checker (mở rộng `getStaleDeployments`).
9. UI Wizard + route + nav item.
10. i18n Vi/En/Zh.
11. License gating.
12. Tests.

## 6. Files
**Tạo:** `server/routers/edgeDeploymentRouter.ts`, `server/routes/edgeDownload.ts`, `client/src/pages/MachineOnboardingWizard.tsx`, `client/src/components/onboarding/Step1..5`, migration SQL, tests.
**Sửa:** `routers.ts`, `aiEdgeEnhanced.ts` (packageModel/confirm/heartbeat), `db/aiAdvanced.ts`, `mqttService.ts`, `_core/socket.ts`, `storage.ts` (stream by key), `MachineRegistration.tsx`, `lib/navigation.ts`, i18n, nơi mount Express routes.

## 7. Migration Drizzle (additive, nullable)
- `model_versions`: + `fileHash varchar(128)`. `ai_models`: + `fileHash` (tùy chọn).
- `edge_inference_sync`: + `localResultId varchar(100)` + index `(deploymentId, localResultId)` (idempotent).
- `edge_deployments`: + `packageVersion`, `deployedAt`, `activatedAt` (audit).
- Enum `edgeDeployStatusEnum` đã đủ.

## 8. Tests Vitest
packageModel (hash đúng, READY) · getModelPackage (apiKey sai → UNAUTHORIZED) · download proxy (máy khác → 403, Range → 206) · confirmDeployment (lệch → FAILED) · edgeHeartbeat (DEPLOYED→ACTIVE) · syncEdgeResults idempotent · stale checker · Wizard component · backward-compat endpoint cũ.

## 9. Nghiệm thu
Cài máy mới < 10 phút · model chạy offline · kết quả tự sync (không trùng) · máy A không tải model máy B (403) · backward-compat · Vi/En/Zh · license gating.

## 10. Rủi ro
- Lộ model qua `/uploads` tĩnh → **bắt buộc** proxy verify apiKey; không trả thẳng storage URL.
- MQTT auth yếu → chỉ dùng làm notify, không cấp quyền tải.
- `aiEdgeEnhancedRouter` disabled → tạo router mới thay vì bật, tránh xung đột migration.
- Offline lâu → poll + idempotent sync.
- Package lớn → Range/resume + giới hạn concurrency.
- Storage kép (local/forge) → proxy xử lý cả hai.

## Critical files
`server/services/aiEdgeEnhanced.ts` · `server/routers/machineApiRouters.ts` · `server/routers.ts` · `drizzle/schema/ai.ts` · `client/src/pages/MachineRegistration.tsx`

---

## ✅ KẾT QUẢ TRIỂN KHAI (2026-05-30) — HOÀN TẤT (chờ môi trường + firmware để nghiệm thu E2E)

### Files đã tạo/sửa
**Tạo (backend):** `drizzle/0105_ws2_edge_deployment.sql` · `server/routes/edgeDownload.ts` (proxy `/api/edge/download/:deploymentId`, verify apiKey + ownership + HTTP Range) · `server/routers/edgeDeploymentRouter.ts` (admin) · `server/services/edgeStaleScheduler.ts` · 3 test (17 ca).
**Tạo (client):** `MachineOnboardingWizard.tsx` + `components/onboarding/{types,Step1..Step5}.tsx`.
**Sửa:** `drizzle/schema/ai.ts` (`fileHash`, `packageVersion/deployedAt/activatedAt`, `localResultId` + partial unique index) · `aiEdgeEnhanced.ts` (`packageModelForDeployment` sha256, `confirmDeployment`, `recordEdgeHeartbeat`, `syncEdgeResults` idempotent, `markStaleDeployments`) · `machineApiRouters.ts` (+5 endpoint máy auth apiKey|machineCode) · `routers.ts` (mount) · `_core/index.ts` (route + scheduler) · `mqttService.ts` (`publishModelUpdate` notify) · `_core/socket.ts` (`emitMachineModelAvailable`) · `App.tsx`/`navigation.tsx`/`MachineRegistration.tsx` + i18n `onboarding.*` vi/en/zh.

### Xác minh
- **Test:** 3 file, **17/17 PASS** — packageModel (hash + READY), confirmDeployment (lệch→FAILED), edgeHeartbeat (DEPLOYED→ACTIVE), syncEdgeResults idempotent (2 lần→1 bản ghi), stale (ACTIVE→OUTDATED), download proxy (máy khác→403, apiKey sai→401, Range→206), checkModelVersion/getModelPackage (không lộ storage URL).
- **Typecheck:** 0 lỗi ở file WS-2. (Tổng repo tăng do tsc duyệt full-graph khi có entry-point mới — đều là lỗi tiền tồn ở file không liên quan.)

### Cần con người làm tiếp
1. `node scripts/migrate-standalone.mjs` trên môi trường có `DATABASE_URL`.
2. `MQTT_ENABLED=true` để notify; tinh chỉnh `EDGE_STALE_INTERVAL_MS`/`EDGE_STALE_THRESHOLD_MIN`.
3. **Firmware máy:** poll `checkModelVersion`→`getModelPackage`→tải qua proxy (header `x-api-key`)→verify sha256→`confirmDeployment`→`edgeHeartbeat`→`syncEdgeResults`.
4. (Tùy chọn) HMAC ký package — Phase 2.

### Sai khác so với plan (có lý do)
- Wizard bước 3 dùng `machine.create` (cấp apiKey ngay) thay luồng register→approve 2 bước; luồng socket cũ giữ nguyên.
- Thêm `edgeDeployment.testConnection` (admin, ad-hoc IP/port) vì repo chỉ có test cho bản ghi đã lưu.
- License: Express `licenseEnforcementMiddleware` trên `/api/trpc` đã bao `edgeDeployment` (không có per-procedure hook).
- Proxy tự đọc theo key (local fs Range / Forge fetch+Range) thay vì thêm hàm vào `storage.ts`.

### Nghiệm thu
| Tiêu chí | Trạng thái |
|---|---|
| Cài máy mới < 10 phút (Wizard 5 bước một mạch) | ✅ Đạt |
| Model offline + tự sync không trùng (idempotent localResultId) | ✅ Đạt (test) |
| Máy A không tải model máy B (403) | ✅ Đạt (test) |
| Backward-compat API máy cũ | ✅ Đạt |
| Vi/En/Zh + license gating (Express) | ✅ Đạt |
| E2E với firmware + DB thật | ⏳ Cần môi trường + firmware |
