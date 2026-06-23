# HỒ SƠ GỐC – AUDIT TOÀN HỆ THỐNG (BASELINE)
### Nền tảng AVI/AOI Management → Hệ sinh thái Nhà máy Thông minh ST4I
**Ngày lập:** 2026-06-23 · **Nhánh:** `feat/smart-factory-f1.1-ot-framework` · **Trạng thái:** Tài liệu gốc (single source of truth)

> Tài liệu này là **cơ sở (baseline)** mô tả chính xác hiện trạng hệ thống ở cả 3 tầng Frontend–Backend–Database cùng toàn bộ luồng dữ liệu (dataFlow) của từng module. Mọi kế hoạch cải tiến (file `02_ST4I_ECOSYSTEM_MASTERPLAN`) đều so chiếu lại tài liệu này. Tất cả số liệu được trích từ audit đọc-mã-nguồn trực tiếp (read-only), có dẫn chiếu file.

---

## 0. Tóm tắt điều hành (Executive Summary)

| Hạng mục | Quy mô hiện tại |
|---|---|
| System Modules (license) | **10** (4 CORE + 6 MOD) – `shared/module-registry.ts` |
| tRPC Routers | **122** file (`server/routers/`) |
| Services (business logic) | **135** file (`server/services/`) + cụm `ot/` |
| Trang Frontend | **125** page (`client/src/pages/`) |
| Bảng dữ liệu (tables) | **~95** bảng, **24** schema domain (`drizzle/schema/`) |
| Migrations | **139** file `.sql` (2 thế hệ chồng lấn) |
| Ngôn ngữ UI | **3** (VI fallback / EN / ZH), ~8.2k key/locale |
| Client phụ | 2 mobile app (Expo + bare RN), android-mqtt-app |
| AI cục bộ | 100% on-prem: GGUF/llama.cpp + ONNX Runtime + pgvector RAG |

**Bản chất hệ thống:** Đây **không phải prototype** mà là một nền tảng **MES + Industrial Analytics + AOI/AVI Quality** trưởng thành, đang trong quá trình tiến hóa lên **control-tower Industry 4.0** với tầng kết nối OT (Operational Technology) đang được xây dở trên nhánh hiện tại.

**Hai khung đánh giá đang tồn tại song song (đã đối chiếu):**
- `SYSTEM_AUDIT_REPORT_2026.md` (2026-05-19): đóng 6 lỗi CRITICAL của audit v1 → tuyên bố 100/100 trên khung tuân thủ per-finding.
- `SYSTEM_AUDIT_GAP_AND_4_0_ROADMAP.md` (2026-06-01, **mới hơn, là roadmap có thẩm quyền**): nâng chuẩn lên mục tiêu control-tower 4.0, chấm ~5.8/10 → mục tiêu 8.8/10. Điểm yếu cốt lõi được xác định: **thiếu tầng điều phối hợp nhất (unified orchestration)**, không phải thiếu tính năng.

---

## 1. Tầng Database (PostgreSQL + pgvector + TimescaleDB tùy chọn)

### 1.1 Engine & Stack
- **Chính: PostgreSQL** (Postgres 16 trong `docker-compose.yml`; `.env.example` ghi "Postgres 18 local"). Driver `postgres-js` + `drizzle-orm`. Pool max 10, `statement_timeout` 30s. Cấu hình: `drizzle.config.ts` (`dialect: postgresql`, schema `./drizzle/schema`).
- **Phụ: TimescaleDB** (`timescaledb:2.17.2-pg16`, port 5433) – DB **riêng, tùy chọn** chỉ cho time-series, bật bằng `TSDB_URL`. Dùng cho hypertable `energy_readings`. Code: `server/db/timescale.ts` (no-op khi không có `TSDB_URL`). DDL áp **thủ công** từ `drizzle/timescale/*.sql` – **không** qua migration runner.
- **Vector store: pgvector** *trong* Postgres chính (không phải DB vector riêng). Cột `vector(1024)` + HNSW cosine trên `ai_image_embeddings.embedding_vec` và `ai_anomaly_memory_bank.embedding_vec`. Có fallback TEXT `embedding` + brute-force khi pgvector vắng mặt.
- **Cache/queue:** Redis 7 (`REDIS_URL`, tùy chọn). **MQTT:** Aedes nội bộ (1883/8883) + EMQX tùy chọn (UNS/Sparkplug B, 1884).
- **Migration:** runner tùy biến `scripts/migrate-standalone.mjs` (KHÔNG dùng `drizzle-kit migrate`) – đọc tất cả `drizzle/*.sql`, **sắp xếp theo alphabet tên file**, áp file pending, track trong `__applied_migrations`. Hầu hết idempotent; lỗi **không fatal** (cố ý nuốt lỗi).

### 1.2 Danh mục bảng theo domain (~95 bảng, 24 schema)
Barrel `drizzle/schema/index.ts` re-export: `enums, auth, hierarchy, product, inspection, layout, production, scheduling, machine, alerts, mqtt, dashboard, system, ai, oee, integration, spc, license, mes, g3, ot, process, andon, interlock`.

- **Auth/Users/Permissions** (`auth.ts`): `users`, `permissions`, `userRoles`, `backupCodes` (2FA), `userSessions`, `userCorporateAssignments`, `userFactoryAssignments`.
- **Corporate Hierarchy/Multi-tenant** (`hierarchy.ts`): `corporates → factories → workshops → productionLines → stations → machines` + `workstations`.
- **Layout/Digital Twin** (`layout.ts`): `factoryLayouts`, `machinePositions`, `workshopPositions`, `factoryPositions` (2D/3D).
- **Product/Metrology/Genealogy** (`product.ts`, ~28 bảng): `productModels`, `productCategories`, `measurementPointDefs/Versions`, `fiducialMarks`, `defectCatalog` (IPC-A-610), `measurementInstruments`, `instrumentCalibrations`, `instrumentMsaRecords`, `samplingPlans`, `msaStudies/Observations`, `measurementSamples` (partition theo tháng), `mpSpcAlerts/Rolling`, `genealogyChain` (hash-chain), `stationTraces`, `cadImportJobs`.
- **Production/Inspection** (`inspection.ts`, `production.ts`): `productInspections`, `measurementResults`, `inspectionPackages`, `packageImages`, `packageActivityLogs`, `uploadQueueMetrics`; `productionOrders`, `productionSessions` (ISA-95 + 21 CFR Part 11 sign-off), `dailyStatistics`, `shiftConfigs`, `lineStages`, `processes`.
- **Process Results (generic)** (`process.ts`): `processResults` (time-series, mọi loại máy).
- **Scheduling/APS** (`scheduling.ts`): `scheduleRuns`, `scheduleRunItems`, `machineCapacity`, `machineSensorReadings`.
- **Machine/Maintenance/OEE** (`machine.ts`, `oee.ts`, `mes.ts`): `machineStatusLogs`, `machineHeartbeats`, `manualMachineConnections`, `machineHealthHistory`; `oeeMetrics`, `downtimeEvents`, `oeeTargets`; `maintenanceSchedules`, `maintenanceWorkOrders`, `sparePartsInventory`, `pmEffectivenessMetrics`.
- **MES/WIP/BOM** (`mes.ts`): `wipTracking`, `stationDwellTime`, `lineBalanceMetrics`, `materialReceipts`, `supplierLots`, `lotDisposition`, `bomDefinitions`, `bomLineItems`, `feederMaterials`, `componentInstallations`.
- **MQTT/IoT** (`mqtt.ts`, ~22 bảng): `mqttClients`, `mqttSubscriptions`, `mqttMessageLogs/History`, `mqttErrorSummary`, `mqttClientProfiles`, `mqttProfileAssignments`, `mqttConnectionLogs/Status/Alerts`, `mqttReconnectLogs`, `mqttBulletinSettings/History`, `mqttNgRateThresholds`, `mqttNgRateAlertHistory`, `mqttNgAlertSettings`, `mqttSoftwareVersions`, `factoryAlertVersions`.
- **OT Framework (Sprint F1.1)** (`ot.ts`): `deviceAdapters`, `deviceTags`, `otTelemetry` (time-series), `machineRecipes`, `recipeDeployments`, `commandLog` (append-only OT write audit).
- **Andon/Interlock/Safety** (`andon.ts`, `interlock.ts`): `andonEvents`, `interlockRules`, `interlockEvents`.
- **SPC/Quality Gates** (`spc.ts`): `spcConfigurations`, `spcRuleViolations`, `cpkHistory`, `correlationAnalyses`, `qualityGates`, `qualityGateEvents`, `qualityGateTemplates/Assignments`.
- **AI/ML** (`ai.ts`, ~45 bảng): registry (`aiModels`, `modelVersions`, `edgeDeployments`, `edgeInferenceSync`), inference (`inferenceResults`, `batchInferenceJobs/Items`, `aiQualityGateConfigs/Results`, `aiEnsembleConfigs`), monitoring (`modelPerformanceSnapshots`, `modelDriftAlerts`, `aiCalibrationReports`), training/active-learning (`trainingJobs/Datasets/Batches`, `aiLabelQueue`, `aiFeedback`), vector/anomaly (`aiImageEmbeddings`, `aiAnomalyMemoryBank/Profiles`, `defectSegmentations`), chat/agentic (`aiChatConversations/Messages`, `aiSpecialistSessions/Steps`, `aiPendingActions`, `aiAgentSessions`, `aiApiKeys`, `aiSystemConfig`), annotation (`imageAnnotations`, `annotationHistory`), predictive (`predictiveAlerts`, `alertEscalations`, `rootCauseAnalysis`, `defectHeatmapData`).
- **Analytics/Reports/Dashboards** (`dashboard.ts`, `system.ts`): `dashboardWidgetLayouts`, `userCustomDashboards`, `dashboardTemplates`, `widgetStylePresets`, `userSettings`; `scheduledReports/Logs`, `reportTemplates`, `notifications`.
- **System/Integration/Licensing** (`system.ts`, `integration.ts`, `license.ts`): `auditLogs`, `systemSettings/Config`, `smtpConfig`, `emailTemplateConfig`; `backupLogs`, `scheduledBackups`, `webhookConfigs`, `webhookDeliveryLogs`, `templateMarketplace/Reviews`, `historyExportSchedules/Logs`; `licenses`, `licenseActivations`, `licenseSyncLogs`, `licenseRevocations`, `licenseModules`.
- **Energy/ML-ops/DR** (`g3.ts`): `energyReadings` (hypertable-ready), `enpiMetrics` (ISO 50001), `mlFeatureCache`, `mlInferenceAudit`, `drRestoreChecks`.

### 1.3 Mẫu mô hình dữ liệu (patterns)
- **Multi-tenancy 2 mô hình song song:** (1) quan hệ FK 6 cấp; (2) **denormalized tenant codes** trên bảng nóng (`productInspections.corporateCode/factoryCode/workshopCode/lineCode`...) để tránh join. Scoping user qua `userCorporateAssignments/userFactoryAssignments`. **KHÔNG có Row-Level Security cho tenant** – chỉ enforce ở app layer (RLS chỉ dùng cho audit append-only).
- **Soft-delete không nhất quán:** bảng mới dùng `deletedAt`; phần lớn dùng `isActive`/`isEnabled`; `productInspections` dùng `isArchived`. Không có pattern thống nhất.
- **Append-only/immutable:** `auditLogs` (RLS `0102`), `commandLog`, `interlockEvents`, `licenseSyncLogs`, `webhookDeliveryLogs`, `mlInferenceAudit`, `genealogyChain` (hash-chain), `measurementPointVersions`.
- **Tuân thủ:** 21 CFR Part 11 HMAC sign-off trên `productionSessions` (`0103`, `SIGNOFF_SECRET`); IPC-A-610 defect taxonomy; HITL gating cho AI/OT writes.
- **JSON/JSONB rất nhiều** (`machines.capabilities`, `measurementPointDefs.geometry/criteria`, `productInspections.aiDetails/variantPayload`, `machineRecipes.payload`, `commandLog.requestedValue`...). Trộn `json` (cũ) và `jsonb` (mới) – cơ chế mở rộng chủ đạo và cũng là rủi ro quản trị schema lớn nhất.

### 1.4 Time-series & AI storage
- **Time-series:** `measurementSamples` (partition tháng + hàm `ensure_measurement_samples_partition()`, pre-provision 24 tháng + DEFAULT); `energyReadings` (hypertable Timescale khi có `TSDB_URL`, ngược lại bảng PG thường). `otTelemetry`, `processResults`, `machineHeartbeats`, `oeeMetrics`... **chưa partition**.
- **Vector/RAG:** pgvector HNSW `m=16, ef_construction=64`; embedding 1024-dim (mxbai-embed-large). KB Q&A artifact dạng **file `knowledge/chunks.jsonl` + `embeddings.jsonl`** (không dùng pgvector cho KB text). Materialized views thêm ở `0111_qw3_materialized_views.sql`.

### 1.5 Rủi ro tầng DB
1. **Hai thế hệ migration trùng số:** 30 file MySQL-syntax đã chết sống chung với bộ PG; số `0000–0017`, `0077`, `0091`, `0111` bị trùng. Thứ tự dựa vào **sort alphabet tên file** – mong manh, chỉ an toàn nhờ DDL idempotent + nuốt lỗi.
2. **Drizzle journal lệch thực tế:** `meta/_journal.json` track 18 migration, runner áp 139 → `drizzle-kit` không tin cậy để diff; schema drift không phát hiện được bằng tool.
3. **Runner che giấu lỗi:** migration hỏng thật sẽ bị ghi nhận & bỏ qua âm thầm.
4. **TimescaleDB out-of-band:** `energy_readings` tồn tại 2 hình thái tùy `TSDB_URL` → dễ deploy lệch.
5. **Không có chính sách retention/archival hệ thống** cho time-series & append-only logs (telemetry, heartbeats, audit, inference).
6. **RLS audit phụ thuộc điều kiện deploy** (app không được là superuser) – chỉ ghi trong comment migration.
7. **Tenant isolation chỉ ở app layer** – bug query có thể vượt tenant; denormalized code có thể lệch hierarchy (không trigger đồng bộ).
8. **Trộn json/jsonb + blob lớn** giới hạn index/validation.

---

## 2. Tầng Backend (Express + tRPC + Socket.IO + MQTT + AI cục bộ)

### 2.1 Stack & khởi động
- **Express + tRPC (HTTP, `/api/trpc`, superjson) + Socket.IO (`/api/socket.io`) + SSE tùy chọn + Aedes MQTT broker nhúng + Redis tùy chọn.** Single Node process, TypeScript, Drizzle/PostgreSQL.
- `server/_core/index.ts` (**~4591 dòng**) tự chọn port trống từ `PORT` (mặc định 3000). HTTPS khi `HTTPS_ENABLED`.
- **Auth** (`sdk.ts`): OAuth ngoài (Manus/Forge) → cấp **JWT cookie HS256** (`jose`, hạn mặc định **1 năm**). Cùng đường verify dùng cho Socket.IO handshake & Bearer middleware.
- **Trình tự khởi động:** observability/metrics (flag) → CORS → body parser (200MB) → helmet (CSP off) → rate limit → SSE/health → static upload → **hàng chục REST endpoint viết tay** (machine proxy, FactoryAlert OTA) gọi `appRouter.createCaller` → license middleware → tRPC → socket → schedulers (reports, backup, AI cron, MQTT, escalation, PdM, **OT `startOt`**, interlock, DR) → Vite/static → graceful shutdown.

### 2.2 Cross-cutting
- **Phân quyền:** `publicProcedure` / `protectedProcedure` / `adminProcedure` (role admin **+ 2FA**) / `roleProcedure(...)`. Roles: admin/supervisor/quality_inspector/operator/maintenance/viewer/user. **2FA bắt buộc** cho admin/supervisor/quality_inspector (IEC 62443-2-1 CL2). Module permission qua `accessControl.ts` (`canView/Create/Edit/Delete/Export`). Data-scoping lọc theo corporate/factory assignment (no assignment → deny-all, cache 30s).
- **License** (`server/license/`): SDK RSA online/offline/local-DB, hardware fingerprint, file `.lic` mã hóa AES. `LicenseGuard` chạy mỗi giờ: `normal/warning/readonly(15-day grace)/locked/no_license`. Middleware chặn mutation khi readonly, chặn tất cả (trừ allow-list ~30 procedure) khi locked. `runtime-security.ts` (prod): SHA-256 file-integrity + `process.exit(78)` khi bị can thiệp. Bypass: `LICENSE_BYPASS=true`.
- **Rate limit** (`rateLimitConfig.ts`): **chỉ in-memory** – API 300/min, auth 30/15min. ⚠️ per-process, không chia sẻ giữa instance.
- **Cache:** Redis tùy chọn + fallback in-memory (mirror mọi write). Coherence qua Redis pub/sub `cache:invalidate`. ⚠️ **3 lớp cache chồng nhau** (`redisService`, `cacheService`, `_core/cache`) khác semantics.
- **Query monitor/validate:** ring buffer slow-query (>1000ms), validate SQL-shape tĩnh. ⚠️ **Opt-in** – không hook global driver.
- **Audit log** (`auditTrailService.ts`): ghi user/action/entity/IP/UA + diff JSON, redact sensitive, nuốt lỗi. ⚠️ **Không phải interceptor toàn cục** – chỉ gọi ở site nhạy cảm (OT write, AI copilot, Andon).

### 2.3 Bản đồ API router (nhóm theo domain)
Lắp ráp ở `server/routers.ts` (~100 file non-test, nhiều file export nhiều sub-router):
- **AI/ML (~30 router):** aiRouters, aiModelRouter, aiAdvancedRouter, aiQualityGateRouter, aiVisionLanguageRouter, aiImageSearchRouter (pgvector), aiActiveLearningRouter, aiTimeSeriesRouter, aiReportRouter, aiSmartAlertRoutingRouter, aiLocalTrainingRouter, aiEvalRouter, aiChatRouter, aiAnalysisHubRouter, aiSettingsRouter, aiGgufRouter, aiSpecialistAgentRouter, aiInspectionAnalyticsRouter, aiAdvancedVisionRouter, aiLocalKbRouter (RAG), aiCopilotRouter (HITL), aiAgentRouter, aiCalibrationRouter, aiAnomalyRouter, aiSegmentationRouter, aiFeedbackRouter, trainingBatchCommentsRouter, thresholdSuggestion/ApprovalRouter.
- **MQTT/IoT:** mqttOeeRouters, mqttClientManagementRouter, mqttBulletinRouter, mqttNgAlertSettingsRouter, mqttSoftwareVersionRouter.
- **Production/Inspection:** inspectionRouters, inspectionVariantRouter, productRouters (~20 sub), mpVariantSubformRouter, productionRouters, productionSessionRouter, processRouter, processResultRouter, wipRouter, shiftConfigRouter, annotationRouters, annotationComparisonRouter, aoiPackageRouter, ipcAcceptanceRouter, qualityGateTemplateRouter.
- **Machines/Devices:** hierarchyRouters, machineApiRouters (machine-facing ingest), statusTemplateRouters, machineContractRouter, machineRecipeRouter, predictiveMaintenanceRouter, digitalTwinRouter.
- **Analytics/SPC:** spcAnalysisRouter, spcAdvancedRouter (6 sub), stationAnalysisRouter, stationTriangulationRouter, paretoAnalysisRouter, dataComparisonRouter, defectHeatmapRouter, monteCarloFlowRouter, ngRateThresholdRouter, genealogyRouter, traceabilityRouter, bomRouter, energyRouter.
- **Corporate/Hierarchy:** hierarchyTreeRouter, mesControlTowerRouter.
- **Admin/Auth/Permissions:** userRouters, permissionsRouter, twoFactorRouter, sessionRouter, auditRouter, enhancedAuditRouter, systemRouters, licenseRouter, backupRouter, webhookRouter, notificationRouters, alertRouters.
- **OT framework:** andonRouter (alert-only), interlockRouter (rule + approve gate, alert-only), deviceAdapterRouter (config + testConnection read-only), commandLogRouter (read-only audit).
- **Edge:** edgeDeploymentRouter. **Reports:** pdfReportRouter, powerpointRouter, reportBuilderRouter, realtimeReportRouter, publicProductApiRouter. **Dashboards:** dashboardStatsRouters, dashboardWidgetRouters, productionDashboardRouter, layoutRouters.
- ⚠️ `reportScheduleRouter.ts` **không được import** trong `routers.ts` (dead/chờ wiring).

### 2.4 OT Framework (`server/services/ot/`) – trọng tâm nhánh hiện tại
Tầng kết nối giao thức công nghiệp **flag-gated, safety-first**, song song với `opcuaGateway.ts` cũ. Bật bằng `OT_GATEWAY_ENABLED=true`.
- **Driver contract** (`otDriver.ts`): `connect/disconnect/isConnected/readTags/subscribe/writeTags/health`. Protocols: `opcua | modbus | s7 | mitsubishi-mc | ethernet-ip | stub`.
- **Registry** (`driverRegistry.ts`): map protocol→factory, đăng ký 6 factory side-effect khi import. Driver `stub` chạy đầy đủ (sine-wave, write tắt). Các driver thật (Modbus dùng `modbus-serial` lazy, S7, Mitsubishi MC, EtherNet/IP, OPC-UA) đã có code F1.2/F4b + unit test; thiếu native lib → `connect()` throw → adapter bị skip (process không crash). **Lưu ý:** doc-comment còn ghi "F1.1 stub only" nhưng driver đã thật → **lệch tài liệu**.
- **Adapter loader** (`deviceAdapter.ts`): đọc `deviceAdapters`/`deviceTags` enabled, dựng `RuntimeAdapter` (pollIntervalMs default 5000). Không tự mở kết nối.
- **Manager** (`otManager.ts`): `startOt()` per-adapter connect→subscribe(ingest); lỗi log "skipped" không crash. `stopOt()` idempotent.
- **Ingest** (`ingest.ts`): `mapSampleToRow` (numeric→valueNumeric, else valueText cap 500) ghi `ot_telemetry`; optional re-publish UNS (Sparkplug-B/JSON). **Chỉ đọc/telemetry – không nhận command.**
- **Command dispatcher** (`commandDispatcher.ts`): **đường ghi duy nhất, không export ra tRPC.** Chỉ reachable từ AI write-tool sau HITL confirm, hoặc interlock engine. Gates theo thứ tự: (1) authorization theo trigger (`hitl` re-verify `ai_pending_actions` confirmed & đúng owner; `interlock` verify multi-layer); (2) idempotency; (3) adapter/tag enabled + `writable=true`; (4) driver connected; (5) **mode gate** – mặc định `OT_CONTROL_ENABLED!="true"` → DRY-RUN ghi `commandLog` status `simulated`, không gọi `writeTags`. Khi bật control: `writeTags()` có timeout + optional read-back verify (`acked_verified/unverified`, warn-only). Mọi nhánh ghi `commandLog` append-only.
- **Tóm tắt an toàn:** AI chỉ *đề xuất*; người xác nhận; write mặc định mô phỏng; cả 5 driver ghi-thiết-bị nằm sau cùng dispatcher; interlock auto-block cần rule đã duyệt + 2 master flag.

### 2.5 Realtime & tích hợp ngoài
- **Socket.IO:** Redis adapter tùy chọn (horizontal scale). Handshake: browser dùng cookie session; machine client bypass, auth per-event bằng apiKey. Room: `factory:/workshop:/machine:/line:`. Emit NG alert, yield warning, dashboard update.
- **SSE:** flag `SSE_ENABLED`, `GET /api/stream?channels=…`, heartbeat 25s + `POST /api/ai/stream/*` streaming token GGUF.
- **MQTT/UNS:** aedes nhúng (TCP `MQTT_PORT` + WS `MQTT_WS_PORT`), gate `MQTT_ENABLED`. Topic `avi/factory/{f}/workshop/{w}/station/{s}/errors|summary`, `avi/client/{id}/commands`. Mọi publish qua **UNS bridge** (`unsBridge.ts`, chuẩn hóa ISA-95/Sparkplug) → `unsPublisher.ts` (client riêng tới EMQX port khác để tránh loop). **Publish-only.** `opcuaGateway.ts` là scaffold no-op.
- **REST/webhook ngoài:** machine endpoint proxy vào tRPC (submit-inspection, sync points, heartbeat, register, config, reference image) auth `x-api-key`/`x-machine-code`; ~18 GET read-only `/api/external/*` auth `x-master-key`/Bearer; `GET /api/edge/download/:deploymentId` (IEC 62443 scoped, HTTP Range); KB Q&A REST; webhook outbound HMAC-SHA256.

### 2.6 Hệ AI cục bộ (Local AI) – 100% on-prem, KHÔNG fallback cloud
- **LLM routing** (`_core/llm.ts` → `aiProviderRouter.ts` → `aiGgufEngine.ts`): `invokeLLM` giữ chữ ký OpenAI-shaped, branch vision/JSON/narrative. Router hardcode `primary:"gguf"`, `fallbackEnabled:false`. Degradation trung thực (`fallbackUsed:true`).
- **GGUF engine:** **node-llama-cpp v3.18.1** in-process (không subprocess), lazy-load, `gpu:"auto"`. Models từ `GGUF_MODELS_DIR` (default `uploads/gguf-models`), LRU+refCount (`GGUF_MAX_LOADED_MODELS=2`). **JSON có cấu trúc qua GBNF grammar-constrained decoding** – đảm bảo parse được. Serialize qua semaphore FIFO (`GGUF_MAX_CONCURRENCY=1`, queue 8, timeout 120s).
- **Vision** (`llamaVisionSidecar.ts`): spawn `llama-server` (mtmd) bind 127.0.0.1, gọi OpenAI-compatible localhost. Cần `LLAMA_SERVER_BIN` + `GGUF_VISION_MODEL` + `GGUF_VISION_MMPROJ`.
- **KB/RAG** (`aiLocalKnowledgeService.ts`): file `knowledge/chunks.jsonl` + `embeddings.jsonl` (1024-dim). Hybrid = embedding mxbai + BM25 keyword (VI/EN/ZH) + tool-calling read-only (today_stats/lot_status/machine_status/defect_trend). Image RAG dùng pgvector. `USE_LEGACY_OLLAMA=true` để rollback Ollama.
- **Local training:** ONNX vision classifier (không phải LLM). Tier-1 JS SGD head trên ONNX embedding (transfer/fewshot/incremental + EWC); Tier-2 spawn trainer cấu hình được (`LOCAL_TRAINER_CMD`, off mặc định).
- **Inference:** onnxruntime-node, LRU session cache, EP TensorRT/CUDA/DirectML→CPU; classify/detect/segment.

### 2.7 Rủi ro tầng Backend
1. Rate limit chỉ in-memory → vô hiệu khi multi-instance.
2. `index.ts` 4591 dòng monolith trộn CORS + REST viết tay + orchestration → rủi ro thay đổi cao, REST endpoint nhân bản logic auth & bypass tRPC middleware/observability.
3. Audit log **không hệ thống** – phần lớn mutation CRUD không được audit (đáng kể với mục tiêu IEC 62443).
4. Query monitor opt-in → metric chỉ một phần.
5. CORS mặc định reflect-all khi thiếu `ALLOWED_ORIGINS` + `Allow-Credentials: true` → rủi ro prod cấu hình sai.
6. JWT session hạn **1 năm**, không rotation/refresh; lộ `cookieSecret` tác động lớn.
7. `MASTER_API_KEY` mặc định `"master_api_key_change_me"` → nếu không đổi, machine registration mở toang.
8. 3 lớp cache chồng nhau dễ invalidate lệch.
9. `reportScheduleRouter.ts` dead.
10. Phụ thuộc nặng feature flag (OT/MQTT/SSE/metrics/...) mặc định off → nhiều path ít được test; flag drift giữa môi trường.
11. OT real-write an toàn nhưng flag-stacked + tài liệu lệch.
12. Aedes broker bind `0.0.0.0`, auth chỉ parse username format → LAN-exposed.

---

## 3. Tầng Frontend (React 19 + Vite + tRPC + Radix/Tailwind v4)

### 3.1 Stack
| Layer | Lựa chọn |
|---|---|
| Framework | React 19.2 + Vite 7 (TS 5.9) |
| Routing | **wouter 3.7.1** (patched), `<Switch>` phẳng ~135 route |
| Data | tRPC 11 + TanStack React Query 5 + superjson, 1 httpLink `/api/trpc`, `credentials: include` |
| UI | Radix UI + shadcn/ui (**53** component `ui/`) + **Tailwind v4** (`@theme` inline OKLCH, không có `tailwind.config.js`) |
| i18n | react-i18next, **VI(fallback)/EN/ZH**, ~8.2k key/locale |
| State | **chỉ React Context** (`ThemeContext`, `AiCopilotContext`) + React Query cache (web không dùng zustand) |
| Realtime | Socket.IO singleton + SSE (AI streaming) |
| Khác | framer-motion, recharts (~36 file), three/@react-three/fiber (Factory3DScene), react-grid-layout + @dnd-kit (dashboard), react-hook-form + zod, jspdf/pptxgenjs/exceljs, html5-qrcode |

- **App composition:** `ErrorBoundary → ThemeProvider(dark default) → TooltipProvider → AiCopilotProvider → {Toaster, Router, AILocalChatBubble}`. Copilot bubble mount toàn cục.

### 3.2 Routing & Navigation
- `<Switch>` phẳng ~135 route, **không nested layout**, mỗi page tự import `DashboardLayout`. Không có auth-guard wrapper; redirect login **reactive** theo lỗi React Query. ⚠️ Code-splitting **không nhất quán**: ~25 page AI/OT dùng `React.lazy`, ~75 page còn lại **import eager** → bundle khởi đầu lớn.
- Nav source: `client/src/lib/navigation.tsx` (`navGroups[]` gate theo role + permission). **10 nav group** vs **10 SYSTEM_MODULES** – gần khớp nhưng **không 1:1**:

| Nav group | Module registry |
|---|---|
| dashboard / corporate / production / monitoring / analytics / data-management / alerts / settings / admin | CORE_DASHBOARD / MOD_CORPORATE / MOD_PRODUCTION / MOD_MONITORING / MOD_ANALYTICS / MOD_DATA_MANAGEMENT / MOD_ALERTS / CORE_SETTINGS / CORE_ADMIN |
| **ai-analytics** | *(gộp vào MOD_ANALYTICS – không có module riêng)* |
| **ot-control** (Andon, device-adapters, recipes, interlock, command-audit, BOM) | **(không có module – feature mới nhất, chưa map)** |

⚠️ **Gap quan trọng:** nhóm `ot-control` và sub-tree AI-analytics **vắng trong `module-registry.ts`** → `isRouteAllowed()` không gate route OT (`/andon`, `/recipes`, `/interlock-rules`, `/command-audit`, `/device-adapters`, `/bom-management`) → mặc định "allowed" bất kể license.

### 3.3 Page inventory (125 file, 3 non-active)
Non-active: `ABTestingPage.tsx.disabled`, `AIInspectionAnalyticsPage.original.tsx`, `CorporateLayout.tsx.bak`.
- **Dashboard/Core:** Home, Dashboard, ProductionDashboard, DrillDownDashboard, CustomDashboard, DashboardCenter, DashboardTemplates, TemplateMarketplace, DashboardMarketplace.
- **Corporate:** CorporateDashboard, CorporateLayout, CorporateManagement.
- **Production:** ProductionOrders, ProductionScheduling, ProductionSessionSignOff, History, HistoryExportScheduling, AOIPackages, InspectionDetail, ProcessManagement, MachineOnboardingWizard, MachineRegistration.
- **Monitoring:** MqttDashboard, MqttBulletin, MachineStatusMonitor, OEEDashboard, MachineHealthMonitoring, MESControlTower, WipLineBalance, TraceabilityLineage, DigitalTwinDashboard, RealtimeReportView, CarbonDashboard, EnergyAnalyticsPage, StationAnalysis, WorkstationManagement + cụm MQTT (AlertRules, ClientManagement, ProfileManagement, TopicsMessages, Replay, NgRateThreshold).
- **Alerts:** Alerts, PredictiveAlertsPage, OEETargetSettings.
- **Analytics (~20):** Reports, CategoryAnalytics, SPCAnalysis, DefectHeatmapPage, DefectPredictionPage, ParetoAnalysis, CorrelationAnalysis, RootCauseAnalysisPage, QualityGates, QualityGateTemplates, ProductComparison, DataComparison, AnnotationStatistics, AnnotationComparisonPage, Scheduled/EnhancedScheduledReports, ReportBuilder, PdfReports, PowerPointExport, AnalyticsSettings.
- **AI (20):** AIHub + Chat/Copilot, AIGgufModelsPage, AILocalKnowledgeBasePage, AIImageSearchPage, AdvancedVisionLabPage, MaskAnnotationPage, AIModelManagementPage, ModelMonitoringPage, ModelVersionsPage, BatchInferencePage, AIPerformanceDashboard, AIInspectionAnalyticsPage, AITimeSeriesPage, AIQualityGatePage, AIReportsPage, AIActiveLearningPage, AIDataProcessingPage, AISettingsPage.
- **OT-control:** AndonBoard, DeviceAdapterManagement, RecipeManagement, InterlockRuleManagement, CommandAuditLog, BomManagement.
- **Data Mgmt:** ProductModels, ProductMachineMapping, Layout, DataSettings, ImportExport.
- **Settings/Admin/Auth:** Settings, SystemConfiguration, AdminSettings, Users, RoleBuilder, AuditLogs, EnhancedAuditLogs, SessionManagement, UserAssignments, LicenseManagement, BackupRestore, ApiDocs, UserGuide, AboutSystem, Login, Setup, Profile, ChangePassword.

### 3.4 Design system
- Token: `index.css` (~561 dòng) Tailwind v4 `@theme inline` **OKLCH**, dual theme (dark default + light), primary industrial teal `oklch(0.72 0.14 185)`, 5 chart color, sidebar palette, status color. Font Geist/Geist Mono.
- shadcn/ui 53 component trên 25+ Radix package.
- **Dashboard/widget system trưởng thành:** CustomDashboard, DashboardWidgetManager, LayoutEditor, ViewerRenderer, WidgetStyleEditor + Marketplace. react-grid-layout + @dnd-kit. 6 viewer preset + 8 widget theme.
- App shell `DashboardLayout.tsx`: sidebar collapse/resize (Ctrl+B), accordion nav, header NotificationCenter + LanguageSwitcher + ThemeToggle + avatar. Mount `useSpcAlertToast()` toàn cục.
- Responsiveness: `useIsMobile` (768px) dùng ~3 chỗ + nhiều CSS `.mobile-*/.tablet-*` thủ công. A11y: ARIA chủ yếu kế thừa Radix, không có audit hệ thống.

### 3.5 Realtime & AI UX
- **Transport:** Socket.IO singleton (path `/api/socket.io`, reconnect 2→10s, **không disconnect** khi unmount) + SSE AI streaming (AbortController + tRPC fallback).
- **Event:** `inspection:alert`, `dashboard:update`, `ng:alert`, `yield:warning`, `qualityGate:triggered`, `andon:event`, `spc:violation`, `machine:status_change`, `machine:online_list`, `twin:update`, `mqtt:message`, `mqtt:stats`.
- **Live page:** Dashboard (6 listener), AndonBoard, DigitalTwinDashboard + Layout (`useTwinStream` hybrid + poll 5s fallback), MqttDashboard, AIChatPage (SSE), MESControlTower.
- **Alert UX:** Sonner toast theo severity + NotificationCenter (bell, history 50, connection indicator) + **sound alert** Web Audio (beep/alarm/chime/critical + custom base64, mute toggle).
- **AI UX (20 page dưới AI Hub):** copilot bubble role-aware (worker/engineer/manager), voice in/out, có thể prefill form trang khác; GGUF model load/unload + playground; KB Q&A bilingual; image search + defect clustering; AdvancedVisionLab 8 tính năng; mask annotation metrology; model ops (drift/version/batch/perf); time-series forecast/anomaly; active learning.

### 3.6 Mobile/Multi-client
- `mobile-app/` Expo RN 0.73 (MQTT + FCM + zustand). `android-mqtt-app/` bare RN 0.73 (`sp-react-native-mqtt`, zustand) – **2 codebase mobile chồng chéo trách nhiệm MQTT/push**. Web có 2 layout: `DashboardLayout` + `CorporateLayout`. **Không PWA/service-worker.**

### 3.7 Rủi ro Frontend & design-debt
1. **Dead code:** `.bak/.original/.disabled` page + locale `.bak`; page orphan (SPCAdvanced redirect, ReportScheduling, AdminPage/AdminMonitoring/ComponentShowcase).
2. **2 codebase mobile** trùng MQTT/push.
3. **Trùng tính năng dashboard** (CustomDashboard/DashboardCenter/DashboardTemplates/2 Marketplace) + scheduled report (3 biến thể) → rối "cái nào canonical".
4. **Bundle lớn:** eager import ~75 page; lazy chỉ AI/OT. Build warning Factory3DScene 1.19MB, index ~10.78MB.
5. Router phẳng không shared authenticated layout; redirect reactive → flash protected route.
6. **`ot-control` & AI-analytics không có module** → không gate license.
7. **Thiếu banner connection/staleness toàn cục** (chỉ icon wifi nhỏ; twin fallback poll âm thầm).
8. Mobile web chỉ responsive utility, **không phải operator UI hạng nhất** (không PWA/offline/kiosk cho Andon/MES tablet).
9. i18n parity EN/ZH chưa verify (~8k key).
10. A11y chỉ mặc định Radix; **NG alert sound-only** loại trừ terminal mute/khiếm thính (có visual ở NotificationCenter nhưng chưa đảm bảo nổi bật).

---

## 4. Bản đồ luồng dữ liệu (DataFlow End-to-End)

> Mỗi luồng: entry → router/service → DB table → realtime push → UI. Dẫn chiếu file:line trích từ audit.

### A1. Inspection Result Ingest (máy AOI → DB → realtime → UI)
Máy → `POST /api/machine/submit-inspection` (`index.ts:351-374`) → tRPC `machineApi.submitInspection` (`machineApiRouters.ts:77-454`, publicProcedure + Zod, auth apiKey/machineCode) → resolve point (`_shared.ts`, fallback pointDefId=0) → ghi `productInspections` (`db/inspection.ts:19-24`, denormalized codes) + `measurementResults` (3D height/volume/coplanarity/warpage/void/tilt, defect bbox; ảnh → S3) → emit `emitNGAlert/emitYieldWarning/emitDashboardUpdate` (`socket.ts`) tới room `global`+`machine:{id}` → MQTT/FCM fan-out → invalidate cache (DASHBOARD/MACHINE/DAILY STATS) → UI: **Dashboard** sub `inspection:alert/yield:warning/ng:alert/qualityGate:triggered`; **History** (tRPC poll, không socket); **MachineStatusMonitor** (`machine:status_change`).

### A2. MQTT/IoT Telemetry (device → aedes → logs/OEE → UNS → alert → UI)
Aedes init `mqttService.ts:230-281` (TCP 1883/WS 8883, auth chỉ validate username format ⚠️CRIT-05) → publish handler `503-582` → `publishNGAlert 750-1004` topic `avi/factory/{f}/.../errors` (QoS1 retain) ghi `mqttMessageLogs` + FCM → summary/bulletin scheduler (daily 6am/weekly Mon 7am) → OEE `oeeService.ts` (SEMI E10 6-state) → `oeeMetrics` → UNS bridge `unsBridge.ts:40-100` chuẩn hóa ISA-95 `{enterprise}/{site}/{area}/{line}/{cell}/{metric}` (publisher only) → UNS publisher → EMQX `mqtt://localhost:1884` → NG-rate alert `ngRateAlertService.ts` → UI: **AndonBoard** (socket `andon:event` + tRPC, poll 30s fallback), **MqttDashboard**.

### A3. OT Framework (đọc telemetry vs ghi command – F1.1)
Flags: `OT_GATEWAY_ENABLED` (startup), `OT_CONTROL_ENABLED` (write thật, default simulated), `OT_READBACK_ENABLED`, `INTERLOCK_AUTO_BLOCK_ENABLED`, `OT_INGEST_TO_UNS`.
- **READ:** `deviceAdapter.ts:26-74` load adapter+tag → `otManager.ts:23-70` connect+subscribe → driver poll → `ingest.ts:56-108` ghi `ot_telemetry` (+ optional UNS) → query `db/otTelemetry.ts:25-99`.
- **WRITE (entry duy nhất `commandDispatcher.ts:209-521`, không export tRPC):** HITL gate (verify `ai_pending_actions` confirmed & đúng owner) **hoặc** interlock gate (rule enabled + approvedBy match + requiresHumanConfirm=false + action allowlist `{block_downstream,stop_line,reduce_speed}`) → idempotency → adapter/tag allowlist (`writable=true`) → driver connected → **mode gate** (nếu `!OT_CONTROL_ENABLED` ghi `commandLog`=simulated, không write) → real write timeout + read-back verify → `commandLog` append-only.
- Driver: `stub` đầy đủ; opcua/modbus/s7/ethernet-ip/mitsubishi-mc đã có code thật nhưng cần native lib + hardware.

### A4. AI Inference + RAG/KB
- **Inference:** `aiModelRouter.ts:174-225` runInference → `aiInferenceEngine.ts:168-250` (ONNX, EP TensorRT→CUDA→DirectML→CPU, LRU 5) / `aiGgufEngine.ts` (GGUF) / `aiImageEmbedding.ts` (1024-dim) → ghi `inferenceResults`, `aiImageEmbeddings` (pgvector HNSW) → UI AIInspectionAnalytics, AdvancedVisionLab.
- **RAG/KB:** `aiLocalKbRouter.ts:85-150` (ask/retrieve/health/reload) + REST/SSE → `aiLocalKnowledgeService.ts` (chunks.jsonl + embeddings.jsonl, intent classify → tool-calling read-only → cosine retrieval → GGUF Qwen2.5-7B generate, cache) → UI `AILocalKnowledgeBase.tsx` (citation + SSE).

### A5. Alerting & Notification
`alertEvaluationService.ts:21-179` (eval mqttAlertRules + logs, cooldown) → `alertEscalationService.ts:22-86` (level 0→3, SLA, update `predictiveAlerts`, log `alertEscalations`) → fan-out: in-app `notificationService.ts` (pref + quiet hours → `notifications` → socket `user:{id}`) / FCM `fcmService.ts` (HTTP v1) / Email `emailService.ts` (SMTP) / Webhook `webhookRouter.ts` (HMAC + retry) → socket `alert:escalation` → UI Alerts/PredictiveAlerts, `useRealtimeDashboard.ts`.

### A6. Reporting & Export
`reportScheduler.ts:236-270` initializeScheduledReports → node-cron `scheduleReport` → `executeScheduledReport:43-187` → `reportGenerator.ts:47-141` (NG trend, top NG point) → format dispatch (PDF/Excel/PPTX via `powerpointService.ts`) → email nodemailer + attachment → log `scheduledReportLogs`. Realtime variant `realtimeReportService.ts` (LTTB downsampling). (CRIT-02 cũ đã đóng.)

### A7. Auth/Session/Permission + License
`context.ts:11-28` (`sdk.authenticateRequest` → ctx.user) → tRPC gate `trpc.ts` (requireUser/adminProcedure role+2FA/require2FA IEC 62443) → permission `accessControl.ts:96-146` (per-module CRUD+Export+expiry) → row scope `accessControl.ts:28-90` (admin no filter; non-admin `corporateCode IN/factoryCode IN`; no assignment → deny) → License `license-middleware.ts:41-100` (LicenseGuard + ALWAYS_ALLOWED allow-list).

### A8. Corporate Hierarchy & Multi-tenant scoping
6 cấp Factory→Workshop→Line→Station→Machine (`db/hierarchy.ts:13-141`, `hierarchyTreeRouter.ts`) → assignment `userCorporateAssignments/userFactoryAssignments` (`db/auth.ts:450-495`) → scope tại DB query `db/inspection.ts:26-90` (OR filter, empty assignment → empty) → MQTT topic scoped per hierarchy.

---

## 5. Tổng hợp tài liệu audit hiện có (đã có sẵn trong repo)

| Doc | Ngày | Trạng thái | Nội dung cốt lõi |
|---|---|---|---|
| `SYSTEM_AUDIT_GAP_AND_4_0_ROADMAP.md` | 2026-06-01 | **Roadmap có thẩm quyền** | Synthesis 3 audit, chấm ~5.8→8.8/10. 15 capability gap (G1–G15) + 7 coordination gap (C1–C7). Roadmap 4 phase G0→G4. Nhiều hạng mục **code xong nhưng flag-off/infra-deferred** (UNS bridge, OPC-UA scaffold, OT framework, Redis adapter, MES schema). |
| `SYSTEM_AUDIT_REPORT_2026.md` | 2026-05-19 | Đóng (71→100/100) | Đóng 6 CRITICAL: mock backup, scheduled report stub, quality-gate AUTO_OK, audit immutable (21 CFR 11), aedes no-TLS, Cpk sai. Compliance matrix IPC-A-610G/IATF 16949/21 CFR 11/ISA-95/IEC 62443/SEMI E10/EU AI Act. |
| `docs/AI_LOCAL_KNOWLEDGE_BASE_*.md` | 2026-05-05 | Concept (đã build khác) | Đề xuất Chroma+Ollama+Llama2; **thực tế build = GGUF/llama.cpp + jsonl + tool-calling + SSE.** `AI_LOCAL_KB_AUDIT_REPORT.md` đánh giá bản delivered 🔴 "upgrade trước Q3/2026". |
| `docs/AI_UPGRADE_PLAN.md` | 2026-03-23 | Phần lớn đã build | Roadmap AI 4 phase; hầu hết gap (TensorRT, ensemble, auto quality-gate, active learning, image search, VLM, AI report, local LLM) **nay đã có**. |
| `docs/DEPLOYMENT_GUIDE.md` | 2026-01-26 | **Lỗi thời** | Vẫn ghi MySQL/TiDB + Mosquitto/HiveMQ; thực tế PostgreSQL/pgvector + aedes nhúng. |
| `AI_ANALYTICS_MODULE_AUDIT.md` | 2026-05-05 | 72/100 | 5 CRITICAL (correlation N+1, 9 query tuần tự/tab, Holt-Winters short-window, silent report fail, không cap date-range). FE đã fix (batching/pagination/export); BE N+1/date-cap **cần verify**. |
| `PRODUCTION_MODULE_FRONTEND_AUDIT.md` | 2026-05 | Đóng | i18n `production.*` từng là stub máy dịch, đã viết lại; sticky header, AlertDialog, KPI clickable, mobile responsive. |

### 5.1 Bảng Gap: Đã xử lý vs Còn mở (chốt baseline)
| Gap | Trạng thái hiện tại |
|---|---|
| Mock backup, scheduled report, quality-gate AUTO_OK, audit immutable, 12 SPC rule, production i18n/UX | **Closed** |
| Cpk USL/LSL | Closed ở SPC engine; **còn flag** ở AI Analytics `getControlChart` – verify |
| MQTT broker TLS + real auth (CRIT-05) | **OPEN** (infra) |
| OT connectivity (OPC-UA/Modbus/Sparkplug) | **Partial** – framework + driver code có; cần lib + hardware |
| UNS/broker HA, Redis cluster state, Observability Grafana, HA/DR WAL | **Partial** – code có, infra-deferred |
| TimescaleDB hypertable/compression | **OPEN** – mới partition tháng |
| MES/WIP/material, PdM closed-loop, Energy/ISO 50001 | **Partial** – schema+router+UI có; vài lineage/dispatch/ingest pending |
| Schema normalization / enum dedup (G15) | **OPEN** |
| AI Analytics BE perf (N+1, date cap) | **Partial** – cần verify |
| AI Local KB quality | **Shipped nhưng 🔴 upgrade-before-Q3/2026** |
| Deployment guide accuracy | **OPEN** (doc debt) |
| `ot-control`/AI-analytics chưa có module license | **OPEN** (registry consistency) |

---

## 6. Kết luận baseline
Hệ thống hiện tại là một **nền tảng AOI/AVI + MES + Analytics + Local-AI rất giàu tính năng** (122 router, 135 service, 125 page, 95 bảng), đã đóng toàn bộ lỗi nghiêm trọng của audit v1 và đạt mức tuân thủ cao trên khung per-finding. Tuy nhiên, so với chuẩn **hệ sinh thái nhà máy thông minh Industry 4.0 / control-tower** (mục tiêu của ST4I), điểm yếu cốt lõi là **thiếu tầng điều phối hợp nhất (orchestration), tầng OT/robotics/computer-vision còn ở dạng framework chưa kết nối thiết bị thật, hạ tầng HA/observability/time-series còn flag-off, và nợ kỹ thuật về migration/schema/registry/doc**.

➡️ Các điểm này là **đầu vào trực tiếp** cho file `02_ST4I_ECOSYSTEM_MASTERPLAN_2026-06.md` (thiết kế hệ sinh thái tiêu chuẩn + so sánh + kế hoạch nâng cấp toàn diện).

*(Hết tài liệu gốc — read-only audit, không chỉnh sửa mã nguồn.)*
