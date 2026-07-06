# Doc 38 — Re-audit sau cải tiến · Tối ưu Backend/Database chịu tải · Bổ sung backend thật cho tầng Quản-lý-Điều-khiển & Lập-trình-Điều-khiển · Phân quyền theo cấp người dùng

*2026-07-07 · nhánh `automation-orchestration-r0` · audit 5 agent read-only (DB-perf · backend-scale · ingest/worker · mgmt-control · programming-control · RBAC-per-role). Kế thừa doc 33/35/37. **Trạng thái: CHỜ DUYỆT §7 trước khi gọi agent thực thi.***

---

## 0. TÓM TẮT ĐIỀU HÀNH

Sau 10 commit doc 37 (Đợt A–D + C2 device-PKI + GEM live-loop + A1a/A2 flip), hệ đã có **substrate chất lượng cao ở cả 3 tầng**. Re-audit lần này chuyển trọng tâm từ "có/không" sang **"chịu tải được không" + "backend đã THẬT chưa" + "phân quyền có kín không"**. Kết luận: kiến trúc lệnh + substrate lập trình + nền DB là **tốt trên trung bình**, nhưng **chưa được tôi luyện cho tải production**, phần lớn giá trị quản lý **nằm sau cờ OFF hoặc thiếu 1 dây wiring**, và **lớp phân quyền có lỗ hổng hệ thống** (không có "sàn role" cho điều khiển).

### Điểm hoàn thiện sau cải tiến (framework vs production-vận-hành)

| Trục | Framework/Code | Production-vận-hành | Ghi chú |
|---|---|---|---|
| **Kiến trúc lệnh-điều-khiển** (dispatch/interlock/reservation/ledger/commissioning) | **~92%** | **~55%** (chặn bởi HW + cờ) | Choke-point kép + interlock fail-closed = chuẩn platform; mọi driver mới buộc qua cùng cổng |
| **Backend chịu tải & hiệu năng** | **~70%** | **~40%** | Nền tốt (pool đôi, auth-cache, bulk telemetry) nhưng Timescale chưa cutover, matview full-refresh, observability mù, cache in-mem đa-replica |
| **Tầng quản lý** (fleet/OEE/PM/alarm/license) | **~80% code** | **~35% sống** | Phần lớn code THẬT sau cờ OFF; 3 lỗ: e-stop=Null, module-gate 5/25, downtime dead-code |
| **Tầng lập trình-điều-khiển** (IR/transpile/deploy/sim/AI) | **~85%** | **~25% xuống-thiết-bị** | Substrate THẬT có test; **mọi đường xuống HW = TODO/mock**, chỉ URSim ảo chạy |
| **Phân quyền theo cấp người dùng (RBAC backend)** | **~75%** | **~50% kín** | 2 lớp quyền song song; role chỉ là template; **không có role-floor** cho actuation/deploy |

**Đánh giá tổng: ~78% framework / ~40% production-hardened.** Tăng so với doc 37 (~70%/~30-38%) chủ yếu ở code, khoảng cách production giờ tập trung 3 chỗ: **(1) DB/BE chưa chịu tải**, **(2) đường-xuống-thiết-bị + cờ chưa bật**, **(3) enforcement phân quyền hở**.

### 5 phát hiện nghiêm trọng nhất (mới, cross-cut)

1. 🔴 **Observability MÙ** — không đo được p95/p99 (`METRICS_ENABLED` OFF) + SLO evaluator chạy nhưng **0 provider đăng ký** → mọi tối ưu là mù, alert không bao giờ bắn (`sloAlerting.ts:59,195`, `metrics.ts:22`).
2. 🔴 **Không có "sàn role" cho điều khiển/deploy** — enforcement là per-user bit `machine_control`, **không kiểm role, không 2FA** → viewer/operator được cấp nhầm bit sẽ deploy recipe/lệnh y hệt supervisor (`accessControl.ts:109`, `orchestrationRouter.ts:91`, `programmingRouter.ts:287`).
3. 🔴 **Telemetry write-amplification** — OT driver→bus ghi **1 INSERT/tag/poll** (`ingest.ts:69`) thay vì gộp cả poll; matview yield **full-refresh mỗi 5'** không giới hạn thời gian (`materializedViewRefreshService.ts:88`) → vỡ khi bảng phình.
4. 🔴 **Mọi đường lập-trình-xuống-thiết-bị là TODO/mock** — Zmotion cần koffi FFI + file compile, Robot-TM/Mitsubishi deploy stub `failed`, không verify-after-download (`zmotionBasicAdapter.ts:148/353`, `robotTmAdapter.ts:158`).
5. 🔴 **Module-license gate phủ 5/~25 router + `license.activate` = publicProcedure** — deep-link tRPC vào SKU chưa mua vẫn chạy; đổi entitlement không cần đăng nhập (`moduleGate.ts:107`, `licenseRouter.ts:55`).

---

## 1. HIỆN TRẠNG & ĐÁNH GIÁ — BACKEND & DATABASE CHỊU TẢI

### 1.1 Điểm mạnh nền tảng (giữ & nhân rộng)
- **Pool tách đôi** request(25)/jobs(8) + `statement_timeout=30s` + query instrumentation (`db/connection.ts:13-85`).
- **Auth session cache** TTL 45s cắt ~3 DB round-trip/request trên ~110 endpoint polling (`authSessionCache.ts`).
- **Telemetry ingest bulk** multi-row insert + cache `deviceId→machineId` + store-forward + Redis fan-out (`telemetryBus.ts:213`).
- **reportingMartService incremental + windowed** (`fact_inspection_hourly`) — MẪU ĐÚNG nên nhân rộng.
- **Split-role topology** `ROLE=api|worker|all-in-one`; rate-limit Redis-backed; Socket.io room fan-out + Redis adapter; circuit-breaker (ERP/AI-gate/federation).

### 1.2 Bảng HOT-PATH + index

| Bảng | Volume ước lượng | Vấn đề index |
|---|---|---|
| `measurement_results` | **5–15M/ngày (nóng nhất)** | **Thiếu index thời gian** trên `createdAt` (cột partition) → mọi query time-range chunk-scan (`inspection.ts:186`) |
| `product_inspections` | ~500k/ngày → ~180M/năm | **OVER-INDEX 13 cái**; single-col `machine`/`corporate` bị composite bao trùm → write-amp (`inspection.ts:106-119`) |
| `ot_telemetry` | rất cao | Index tốt; **chưa hypertable trên main DB** |
| `robot_telemetry` | cao | 1 INSERT+1 UPDATE/poll/robot, chưa batch, chưa hypertable (`robotIngest.ts:23`) |
| `package_activity_logs`, `audit_logs` | cao | **Không retention** → phình vô hạn |

### 1.3 Top bottleneck (hợp nhất DB + backend + ingest)

**P0 — chặn chịu tải / mù quan sát**
| # | Bottleneck | Bằng chứng | Khắc phục | Chi phí |
|---|---|---|---|---|
| P0-A | **Observability mù** (không p95/p99, SLO 0 provider) | `metrics.ts:22`, `sloAlerting.ts:59,195` | Bật `METRICS_ENABLED` + viết provider bridge prom-histogram→SLO evaluator + Prometheus/Grafana | ~2-3 ngày |
| P0-B | **matview yield full-refresh 5'** không giới hạn thời gian, quét toàn bảng | `0111/0174`, `materializedViewRefreshService.ts:88` | Chuyển sang **Timescale continuous aggregate** (incremental) HOẶC dùng `fact_inspection_hourly` làm nguồn | Trung bình |
| P0-C | **Timescale chưa cutover main DB** → bảng nóng chưa partition | `0172:55-73` (WARNING no-op) | Đổi image `timescaledb-ha` + re-apply 0172/0173 off-peak (checklist §1.4) | Cao (ops) |
| P0-D | **Telemetry 1 INSERT/tag/poll** (write-amplification) | `ingest.ts:69`, `otManager.ts:150` | Gộp cả poll → 1 multi-row insert; thêm ring-buffer flush-interval toàn bus | ~1-2 ngày |
| P0-E | **Dashboard factory/workshop/line đi live-path** (matview chỉ khóa machine_id) | `cachedStatistics.ts:410` | Dùng `fact_inspection_hourly` (đã có factoryId) cho mọi cấp; bật `REPORTING_MART_ENABLED` | Thấp-TB |

**P1 — tải thật**
| # | Bottleneck | Bằng chứng | Khắc phục |
|---|---|---|---|
| P1-A | **AOI-ZIP commit KHÔNG transaction** + per-row UPDATE loop | `aoiPackageRouter.ts:478,700` | Bọc `db.transaction`; batch UPDATE (`unnest`/`VALUES`) |
| P1-B | **Cache stats in-memory, unbounded, không chia sẻ đa-replica** (2 facade song song) | `_core/cache.ts:13,47` | Chuyển hot-stat sang Redis (đã có); hợp nhất về `cacheService` LRU-bounded |
| P1-C | **Không có HTTP server timeout** (slow-loris) + body-limit 200MB toàn cục | `_core/index.ts:5130,233` | Set `requestTimeout`/`headersTimeout`; hạ body-limit, scope 200MB chỉ upload |
| P1-D | **CPU-heavy pure-JS chặn event-loop** (image-align, defect-cluster O(n²), cosine 5000×4096 in-request) | `imageAlignment.ts:100`, `aiImageEmbedding.ts:1099,760` | worker_threads/Piscina pool (transfer typed-array); hoặc đẩy search→pgvector |
| P1-E | **Thiếu index thời gian `measurement_results`** | `inspection.ts:186` | Thêm `(pointDefId, createdAt)` — đo `idx_scan` trước |
| P1-F | **Over-index `product_inspections`** | `inspection.ts:106` | DROP single-col trùng tiền tố composite (đo `pg_stat_user_indexes` trước) |
| P1-G | **execFileSync `nvidia-smi` chặn tới 3s** trên path telemetry VRAM | `aiGgufEngine.ts:295` | `execFile` async |
| P1-H | **reportingMart cron dùng MAIN pool** (không jobs pool) | `reportingMartService.ts:37` | Đổi `getJobsDb` (mechanical) |
| P1-I | **Per-message write không coalesce** (MQTT ping-UPDATE, UNS upsert, sensor 1-INSERT/msg, socket global firehose) | `mqttService.ts:681`, `unsSubscriber.ts:252`, `socket.ts:855`, `sensorIngestService.ts:151` | Buffer + interval-flush bulk-insert |

**P2 — cải thiện**: license entitlement không cache (`moduleGate.ts:58`); sync RSA keygen/pbkdf2Sync (`license-service.ts:391`); export PDF/PPTX in-process → worker; `aiJobQueue` in-mem concurrency=1 mất job khi restart → BullMQ (ioredis đã có dep); `robot_telemetry` batch; detail read-path lazy-import trong hot path (`inspectionRouters.ts:411`); retention cho `package_activity_logs`; RLS JOIN-based walk phân cấp mỗi hàng nếu bật multi-tenant → denormalize `factoryCode`.

### 1.4 TimescaleDB cutover checklist (còn thiếu)
1. Cài extension main DB (image `timescale/timescaledb-ha`, kèm pgvector).
2. Re-apply 0172+0173 off-peak có backup (`migrate_data=>TRUE` rewrite inspections/measurement_results + 4 bảng telemetry, retention 365d).
3. Cutover role `avi_app` (0224) đã làm A1a — **cần restart+smoke app**.
4. Thống nhất **1 cơ chế partition/bảng** (`measurement_samples` đang native-partition 0092/0099 vs Timescale).
5. Làm rõ topology TSDB riêng (cổng 5433) vs main — tránh split-brain telemetry.
6. Chuyển `hourly_yield_cache` → continuous aggregate (đóng P0-B).
7. Verify: UPDATE/DELETE audit as avi_app → denied; ingest+CRUD OK; `db_feature_status='ok'`; bug `0172:108` segmentby đã fix.

### 1.5 Kiến trúc chịu tải đề xuất
- **Ghi**: giữ mẫu `telemetryBus` + nhân rộng cho robot; cân nhắc `COPY`/unnest cho lô measurement_results lớn.
- **Đọc**: dashboard = Timescale CAgg incremental (bỏ full-refresh matview); nguồn duy nhất mọi cấp phân cấp = `fact_inspection_hourly`; **Redis shared cache** khi scale-out; **read-replica** (`getReadDb()`) cho BI/report nặng tách khỏi primary lo ingest.
- **Lưu trữ**: hypertable + compression + retention 365d cho toàn bộ time-series; bổ sung retention cho activity/audit.
- **Quan sát**: bật `METRICS_ENABLED` + `QUERY_MONITOR_ENABLED`; provider bridge SLO; đo `pg_stat_user_indexes` trước khi thêm/bớt index.

---

## 2. BỔ SUNG BACKEND THẬT — TẦNG QUẢN LÝ & ĐIỀU KHIỂN

**Kết luận:** lõi điều khiển-lệnh THẬT ~90% (choke-point `commandDispatcher.ts:231` + interlock fail-closed + reservation FOR-UPDATE + commissioning mặc-định-ON). Rủi ro "bổ sung backend thật" tập trung ở **transport/HW + cờ + vài dây wiring**, KHÔNG ở kiến trúc lệnh.

Nhãn: `[FLIP]` bật-cờ · `[WIRE]` đấu-dây nhỏ · `[BUILD]` viết-mới · `[HW]` chặn bởi phần cứng.

### P0 — an toàn / toàn vẹn / bypass
1. 🔴 **E-stop safety-rated** `[HW]`+`[BUILD]` — hiện `NullSafetyPlcAdapter` không actuate (`safetyEstopAdapter.ts:113`). Mua Safety-PLC (Pilz/Sick), viết adapter thật cài vào seam `registerSafetyPlcAdapter` (`:146`), FAT dừng <100ms dual-channel. Tạm: chấp nhận rủi ro có văn bản, software-interlock là đường duy nhất.
2. 🔴 **Phủ module-gate toàn diện** `[BUILD]`+`[FLIP]` — middleware bảng `path→moduleCode` tập trung phủ ~20 router điều khiển còn hở (thay vì shadow từng router), rồi bật `LICENSE_MODULE_GATE_ENABLED` staged.
3. 🔴 **Downtime auto-detection (code chết)** `[WIRE]` — gọi `recordMachineActivity` từ ingest MQTT/inspection + `startDowntimeDetection()` trong `backgroundJobs.ts` (`downtimeDetectionService.ts` hiện no-op). Không có → OEE/PdM thiếu dữ liệu.
4. 🔴 **Feeder-verify run-gate chưa đấu** `[WIRE]`+`[FLIP]` — gọi `assertSetupOkForRun` (`feederVerifyService.ts:245`) trong service run-start + `FEEDER_VERIFY_ENFORCED=true`. Rủi ro chạy sai linh kiện.
5. 🔴 **0% HW-validation OT/robot** `[HW]` — FAT Modbus/S7/OPC-UA/EIP/Fanuc tại nhà máy. Đầu tư + hiện diện, không phải lỗi code.

### P1 — kích hoạt giá trị đã build (chủ yếu FLIP/WIRE)
- `[FLIP]` **7 quick-win cờ** (caller/scheduler đã có): `SPC_CENTRAL_ALERT_ENABLED`, `ANDON_SLA_ESCALATION_ENABLED`, `OEE_SNAPSHOT_ENABLED` (+ cấu hình ideal-cycle), `PM_SCHEDULE_GEN_ENABLED`, `FAI_GATE_ENABLED`, `PREDICTIVE_MAINTENANCE_ENABLED`, `EQ_INTEG_ENABLED`+`EQ_GOVERN_ENABLED`.
- **Edge-node transport client** `[BUILD]` — tiến trình edge bơm sender tRPC/HTTP thật vào `setCentralSync` (`edgeRuntime.ts:110` hiện no-op); rồi `[FLIP]` `EDGE_RUNTIME_ENABLED`.
- **Unified fleet-status view** `[BUILD]` — gộp `edge_nodes`+`edge_deployments`+`device_adapters` (không cần bảng mới).
- **SECS/GEM bring-up caller** `[BUILD nhỏ]` — job mở HSMS session + `attachGemAlarmDispatch()` per equipment (live-loop đã có, thiếu caller production); thêm `SECS_GEM_*` vào `.env.example`.
- **Mitsubishi MC hiện đại** `[BUILD]` — encoder SLMP 3E/4E trên `node:net` (`mcprotocol` chỉ 1E-frame) HOẶC config GX Works3.
- **Techman/MELFA** `[WIRE]`+`[HW]` — nạp register-map/telegram thật (hiện ASSUMED).

### P2 — dài hạn
MSD proactive sweep; auto-reorder khi `belowReorder`; `alertEvaluation` broker/client-offline thật (đang trả 0); Ed25519 license wiring; per-module **SKU catalog** (`[BUILD]` — hiện chỉ mảng mã opaque); UR first-class RobotDriver (client đã có); PackML persisted runtime-state; full SEMI E30/GEM300; config/firmware push xuống OT device; leader-election scheduler (tránh double-run >1 worker).

**Ma trận trạng thái chi tiết:** xem báo cáo agent (Command-dispatch THẬT; Fleet AI-model THẬT-ON nhưng edge-transport THIẾU; OEE-live THẬT/snapshot OFF; Andon THẬT-ON/SLA-escalation OFF; alarm-taxonomy seeded THẬT; 10 driver THẬT-transport/0% HW-validated).

---

## 3. BỔ SUNG BACKEND THẬT — TẦNG LẬP TRÌNH & ĐIỀU KHIỂN

**Kết luận:** substrate lập trình (IR/linter/diff/merge/transpile/PLCopen/sim-gate/deploy-gate/AI) là **code THẬT chất lượng cao có test** — nhưng **mọi đường xuống thiết bị vật lý còn framework/TODO** (chỉ URSim ảo chạy transport thật). "Điều khiển thật" bị chặn ở 3 chỗ: FFI+file-compile (Zmotion), wiring dispatcher (Robot/Mitsubishi), verify/rollback trên HW.

### P0 — chặn "điều khiển thật" / toàn vẹn
1. 🔴 **Zmotion deploy path thật** `[BUILD]`+`[toolchain]` — (a) `compile()` ghi file `.bas/.zar` + set `build.meta.filePath` (`zmotionBasicAdapter.ts:353` TODO); (b) `zauxFfi.ts` với **koffi** bind `ZAux_OpenEth/BasDown/ZarDown/Close`; (c) `ZAUXDLL_PATH`. ~3–5 ngày + FAT trên ZMC thật.
2. 🔴 **Verify-after-download + real rollback** `[BUILD]` — read-back/checksum sau nạp; trạng thái `verified` phải do đọc lại HW, không chỉ audit-row (rollback hiện chỉ audit không revert HW). ~2-3 ngày/adapter.
3. 🔴 **Four-eyes ở cấp VERSION** `[BUILD]` — thêm status `pending_review→approved`, reviewer≠author, chặn build/deploy version chưa duyệt (`programmingRouter.ts:205`); hiện four-eyes CHỈ ở deploy, artifact-version tự do. ~2-3 ngày.

### P1 — đấu nối framework đã có
4. **Robot-TM + Mitsubishi deploy** `[WIRE]`+`[HW]` — route qua `robotCommandDispatcher` (TMSCT Listen-Node) / `commandDispatcher` param-push (HITL + `OT_CONTROL_ENABLED`) (`robotTmAdapter.ts:158`, `mitsubishiEngineeringAdapter.ts:138`).
5. **Feed LimitProfile từ capability máy thật** `[WIRE]` — đấu `safety_rated_speed_mms`/reach-AABB từ driver-registry vào `resolveLimits` (`irSafetyLinter.ts:79` hiện dùng số env default ISO/TS 15066).
6. **Model kinematic thật (URDF)** `[BUILD]` — thay model mẫu cho sim-gate; bật staged `SIM_KINEMATIC_ENABLED`/`SIM_PHYSICS_ENABLED`.
7. **Eval + cải thiện AI POU/IR codegen** `[toolchain]` — chạy `scripts/ai-bench` với GBNF trên GPU đo validPass mới (GBNF đã build `codegenSchemas.ts:166` fix structural 0%); cân nhắc Qwen3-Coder + FIM autocomplete.

### P2 — độ phủ
SFC S/R/P/L/D qualifier (`pouToSt.ts:282`); PID controller thật thay skeleton (`irToUrscript.ts:174`); codegen IR→Zmotion/Mitsubishi/Robot (hiện chỉ URScript/ROS2/ST).

### Quick-win (≤1 ngày)
✅ **Persist toạ-độ node OrchestrationStudio** — thêm `ui?:{x,y}` vào `StudioStep` (`workflowTypes.ts:52`), emit trong `serializeStep`, `onMoveNode` write-back + `onNodesChange`→persist (`WorkflowGraphCanvas.tsx`). Gap doc 37; **IR đã có mẫu copy nguyên** (`IrGraphCanvas.tsx:326`).

---

## 4. PHÂN QUYỀN THEO CẤP NGƯỜI DÙNG (RBAC backend) — CHI TIẾT

**Gốc vấn đề:** hệ có **2 lớp quyền song song** — (a) `role` enum + role-procedures, (b) bảng `permissions` per-user (`requirePermission`). Lớp (b) là lớp enforce thực; **role gần như chỉ là template** seed permissions + landing UX. Hệ quả: `requirePermission` kiểm **bit per-user, KHÔNG kiểm role** → **không có "sàn role"**.

### 4.1 Guard backend (`server/_core/trpc.ts`)
| Procedure | Kiểm | Dùng |
|---|---|---|
| `protectedProcedure` | chỉ cần đăng nhập, **không phân biệt role/query-mutation** | 1653× |
| `adminProcedure` | admin + **2FA** | 452× |
| `qualityProcedure` | admin/supervisor/quality +2FA | 44× |
| `moduleProcedure(MOD_X)` | protected + license-gate (**cờ OFF→pass-through**, không kiểm role) | 10× (5 router) |
| `requirePermission(mod,act)` | bit per-user, admin luôn pass, **fail-closed** | 75 router |

### 4.2 Ma trận role × năng lực (template mặc định `permissionsRouter.ts:17-291`)
V=view C=create/execute E=edit D=delete —=không

| Năng lực | admin | supervisor | quality | engineer | maintenance | operator | viewer | user |
|---|---|---|---|---|---|---|---|---|
| Sửa kết quả inspection | ✓ | C/E | C/E | — | — | — | — | — |
| Settings điểm đo | ✓ | — | — | **C/E** | — | — | — | — |
| Settings cảnh báo | ✓ | C/E | C/E | C/E | C/E | — | — | — |
| **Điều khiển máy** (`machine_control`) | ✓ | V/C/E | **—** | **V/C/E** | V/E (param/ack, **không start/stop**) | **—** | — | — |
| Interlock rule | ✓ | VCED | — | V | — | — | — | — |
| Andon | ✓ | C/E | C/E | C/E | — | C/E | — | — |
| Production orders | ✓ | C/E | — | — | — | V | — | — |
| Admin (users/permissions/audit) | ✓ | — | — | — | — | — | — | — |

**Ai actuate máy (mặc định):** admin + supervisor + engineer (execute); maintenance param/ack. **Nhưng vì enforce per-user bit** → tập actuator thực = admin + **bất kỳ ai được cấp bit `machine_control`** bất kể role.

### 4.3 HITL / Four-eyes / SoD
**CÓ (server-side):** threshold điểm đo (SoD `assertApprovalSoD` + version + audit), machine-recipe approve/deploy, interlock approve (admin-only), inspection-program release (qualityProcedure+SoD), NCR disposition (SoD).
**THIẾU:** defect disposition scrap/rework (1 quality user tự quyết, không SoD); recipe four-eyes **không nâng đặc quyền** (2 user cùng `canEdit` là đủ, không admin/2FA); deploy workflow không ép sim-gate; `program.deployBuild` `confirmedBy` **optional trong zod** (`programmingRouter.ts:295`).

### 4.4 Lỗ hổng enforcement (xếp hạng)
**P0**
1. **NG-rate threshold CRUD mở cho MỌI user đăng nhập** — không role/SoD/audit; viewer/operator tạo/tắt ngưỡng + tắt alert (`ngRateThresholdRouter.ts:131/189/259/272/335`). → `qualityProcedure` + audit/version.
2. **`license.activate`/`applyOfflineLicense`/`generateOfflineRequest` = publicProcedure (không auth)** — đổi entitlement không cần đăng nhập (`licenseRouter.ts:55,384,365`). → adminProcedure + rate-limit + audit.
3. **Không có role-floor cho điều khiển/deploy** — deploy chỉ cần bit per-user, guard **không nhất quán** (chỉ `edgeDeployment` dùng admin+2FA) (`orchestrationRouter.ts:91`, `programmingRouter.ts:287`, `machineRecipeRouter.ts:205`, `fleetRouter.ts:190`). → role-floor (engineer/supervisor/admin) + `require2FA`.
4. **Per-module license chưa enforce** (doc 37 P0-3) — 5/nhiều router + cờ OFF. → wire `moduleProcedure` toàn bộ router theo SKU + bật staged.

**P1**
5. Defect disposition thiếu four-eyes (`defectDispositionRouter.ts:73`).
6. `permissionsRouter.ts:294-316` **nhái** admin/quality procedure cục bộ **KHÔNG ép 2FA** — router quản lý phân quyền lại chạy admin không-2FA. → import guard canonical.
7. Deploy không ép sim/commissioning-gate; `confirmedBy` optional → nâng bắt buộc ở schema.
8. **7 nhóm mutation `protectedProcedure`-trần ghi được bởi viewer/user**: shifts (`shiftConfigRouter.ts:18`), NG-threshold, productMapping (`productRouters.ts:1357`), documents.upload (`:1537`), production template (`productionRouters.ts:304`), webhook (`webhookRouter.ts:199`). → `requirePermission`/role.
9. Robot registry `get/list` lộ `endpoint`+`connectionOptions` cho mọi user (`robotRouter.ts:16`). → redact/permission.

**P2**: `userRouters.create/update` chỉ gán user|admin + đổi role không re-apply template → **role↔permission drift** (`userRouters.ts:47,78`); `updateRole/delete` protected+inline không-2FA (`:133,150`); security-governance/orchestrationGov/license.syncModules protected-only → nên admin-gate.

### 4.5 Mô hình phân quyền hoàn chỉnh (khuyến nghị)
1. **Role-floor** cho mọi đường nhạy cảm: `roleProcedure('admin','supervisor','engineer').use(require2FA).use(requirePermission('machine_control','canCreate'))` — viewer/user/operator không bao giờ actuate dù cấp nhầm bit.
2. **`writeProcedure`** mặc-định-ghi (protected + không phải viewer/user) refactor các mutation protected-trần — đóng lỗ read-only hệ thống.
3. **Bật 2 lớp module-gate**: server `moduleProcedure` toàn bộ router theo SKU + client RouteGuard chặn deep-link UI.
4. **Hợp nhất guard 2FA**: xóa procedure cục bộ, dùng duy nhất `_core/trpc.ts`.
5. **Four-eyes cho disposition tác động cao** + **bắt buộc sim-gate trước deploy** + **`confirmedBy` bắt buộc** ở tầng schema.
6. **Đóng auth cho license entitlement + siết đọc secret** (robot endpoint, security governance) về admin.
7. **Đồng bộ role↔permission**: mọi đổi role re-apply `applyRolePermissions` (hoặc chuyển hẳn RBAC role-based).

---

## 5. KẾ HOẠCH THỰC THI (chờ DUYỆT §7)

Nguyên tắc: **ĐO TRƯỚC → siết an toàn/quyền → tối ưu cấu trúc → bổ sung backend thật → HW/FAT**. Migration tiếp theo **0234**.

### Đợt P — QUAN SÁT & ĐO (làm đầu tiên, rẻ nhất, mở khóa mọi tối ưu)
- Bật `METRICS_ENABLED` + `QUERY_MONITOR_ENABLED`; viết **provider bridge** prom-histogram→`registerSloObservationProvider` (đóng P0-A). Scrape Prometheus + Grafana. Đặt baseline p95/p99. *~2-3 ngày.*

### Đợt Q — SIẾT PHÂN QUYỀN & BYPASS (bảo mật, chủ yếu code)
- Role-floor + `require2FA` cho actuation/deploy (P0-3); `writeProcedure` refactor 7 nhóm mutation hở (P1-8); NG-threshold→qualityProcedure (P0-1); license.activate→adminProcedure (P0-2); hợp nhất guard 2FA (P1-6); redact robot secret (P1-9). Middleware `path→moduleCode` phủ ~20 router + bật `LICENSE_MODULE_GATE_ENABLED` staged + client RouteGuard (P0-4). *~4-6 ngày. Cờ mới OFF→staged.*

### Đợt R — TỐI ƯU DB/BE CHỊU TẢI (cấu trúc)
- **R1 quick**: HTTP timeout + hạ body-limit (P1-C); execFileSync→async (P1-G); reportingMart→jobsDb (P1-H). *~1 ngày.*
- **R2 ingest**: coalesce telemetry poll→1 insert + ring-buffer (P0-D); AOI-ZIP transaction + batch UPDATE (P1-A); per-message coalesce (P1-I); robot batch. *~3-4 ngày.*
- **R3 read/cache**: `fact_inspection_hourly` làm nguồn mọi cấp dashboard + bật `REPORTING_MART_ENABLED` (P0-E); hợp nhất cache→Redis LRU (P1-B); worker_threads pool CPU-heavy (P1-D); `aiJobQueue`→BullMQ. *~1.5-2 tuần.*
- **R4 index**: thêm `(pointDefId,createdAt)` (P1-E); DROP index thừa sau đo `idx_scan` (P1-F); retention activity/audit. *~1-2 ngày.*

### Đợt S — TIMESCALE CUTOVER (ops, cần DB-server) — checklist §1.4
- Extension + re-apply 0172/0173 + CAgg thay matview full-refresh (P0-B/P0-C) + thống nhất partition. **Cần cửa sổ off-peak + backup.** *Ops-heavy.*

### Đợt T — BỔ SUNG BACKEND THẬT (2 tầng)
- **T-mgmt**: downtime auto-detect wire (P0-3-mgmt); feeder run-gate wire (P0-4-mgmt); 7 quick-win FLIP; edge-transport client BUILD; unified fleet-status; SECS/GEM bring-up caller; SLMP 3E encoder.
- **T-prog**: node-graph persist quick-win; four-eyes cấp version; verify-after-download; Zmotion FFI+file-compile; Robot-TM/Mitsubishi deploy wire; LimitProfile từ capability; AI codegen eval.

### Đợt U — NGHIỆM THU PHẦN CỨNG (chặn bởi thiết bị + đầu tư)
- E-stop safety-rated Safety-PLC + FAT <100ms; HW-validation OT/robot (Modbus/S7/OPC-UA/EIP/Fanuc); URDF thật; deploy-to-HW FAT. **Đầu tư + hiện diện nhà máy.**

**Thứ tự khuyến nghị:** P → Q → R → (S ops song song) → T → U. Đợt P/Q/R chủ yếu code (agent làm được ngay sau duyệt); S cần DB-server; U cần HW.

---

## 6. ĐIỂM MẠNH GIỮ NGUYÊN (không đụng)
Dispatch choke-point kép + ledger + interlock fail-closed + commissioning mặc-định-ON + reservation FOR-UPDATE; IR linter/diff/merge/PLCopen round-trip + sim-gate + deploy-gate SoD; auth-cache + pool đôi + telemetry bulk-insert + reportingMart incremental; threshold-approval SoD + NCR SoD + interlock admin-approve. Mọi bổ sung phải đi qua các cổng này.

---

## 7. QUYẾT ĐỊNH CẦN DUYỆT (trước khi gọi agent thực thi)

1. **Thứ tự đợt** — đồng ý P→Q→R→S→T→U? Hay ưu tiên khác (vd làm T-mgmt quick-win FLIP sớm để thấy giá trị)?
2. **Đợt P (observability)** — làm ngay đầu tiên? (khuyến nghị mạnh: không đo thì tối ưu mù).
3. **Đợt Q (siết quyền)** — duyệt role-floor + `require2FA` cho actuation/deploy + bật module-gate staged? Có chấp nhận rủi ro thay đổi hành vi (một số user đang dựa vào bit sẽ bị chặn nếu không đúng role)?
4. **7 quick-win FLIP tầng quản lý** — bật ngay (SPC-alert/Andon-SLA/OEE-snapshot/PM-schedule/FAI-gate/PdM/EQ-integ+govern)? Hay staged từng cái + verify?
5. **Đợt S Timescale cutover** — làm trong đợt này (cần anh cài extension + cửa sổ off-peak) hay hoãn?
6. **Đường-xuống-thiết-bị (Zmotion FFI / Robot-TM / Mitsubishi)** — build ngay đợt T hay chờ có thiết bị thật để FAT cùng lúc?
7. **E-stop safety-rated (P0)** — quyết định mua Safety-PLC (Pilz/Sick) khi nào? (chặn bởi đầu tư; tạm chấp nhận rủi ro có văn bản?)
8. **read-replica + Redis shared cache** — có kế hoạch scale-out >1 replica API không? (quyết định R3 làm tới đâu).

---

---

## 8. ✅ KẾT QUẢ THỰC THI (2026-07-07)

Owner duyệt §7: thứ tự **P→Q→R→S→T→U** · Q **bật luôn** · 7 quick-win **staged** · Timescale **làm đợt này**.

**Đợt P — Observability (commit `ee91675`, tsc+build green):** đóng P0-A "mù". `sloMetricsProvider.ts` mới — rolling-window HTTP tracker (prom-client-free, short=5m/long=1h) + `installSloMetricsProviders()` cấp feed THẬT cho SLO evaluator (latency good=duration≤threshold, availability good=non-5xx); honest `long.total===0→null`. metrics middleware feed cả prom histogram lẫn SLO tracker; startup gọi provider sau `startSloEvaluator`. Bật `OBSERVABILITY=true`+`METRICS_ENABLED=true` để hết-mù (query-monitor đã ON). Subsystem có thể override id cho per-dispatch/UNS/twin sau.

**Đợt Q — Siết phân quyền (commit `20d2dcf`, tsc+build+vitest 83 green, ĐỔI HÀNH VI):** procedure mới `writeProcedure` (chặn viewer/user), `actuationProcedure`/`deployProcedure` (role-floor admin/supervisor/engineer + require2FA). Vá P0: NG-threshold CRUD any-user→qualityProcedure; `license.activate/*Offline` public→adminProcedure; deploy/actuation (orchestration/programming/machineRecipe/fleet)→actuationProcedure+module-gate+perm; `confirmedBy` bắt buộc schema cho production; permissionsRouter dùng canonical 2FA-guard; robot.list/get redact secret; 7 mutation protected-trần→writeProcedure. Module-gate toàn diện: `moduleAccessMap.ts` + gate Quality/Production/OT/Engineering router, `LICENSE_MODULE_GATE_ENABLED` default **ON** nhưng **no-brick fail-open** (chỉ enforce khi allowed_modules populate tường minh). **Owner phải biết:** user giữ bit `machine_control` lạc mất quyền deploy; account privileged chưa bật 2FA bị khóa các path này tới khi bật 2FA; license bootstrap headless (nếu có) cần route riêng.

**Đợt R — Tối ưu DB/BE (commit `2a7febc`, tsc+build+vitest 268 green, mig 0234 applied):** R-1 HTTP timeout + body-limit 25mb (scope 200MB upload prefix) + nvidia-smi execFile-async + reportingMart→jobsDb + **mig 0234** `idx_results_pointdef_created` (bảng nóng nhất thiếu index thời gian, áp CONCURRENTLY). R-2a ingest/telemetry coalesce **opt-in cờ OFF** (byte-for-byte hiện tại): telemetryBus ring-buffer + OT per-tick + robot buffer+throttle registry + MQTT/UNS/sensor/socket coalesce. R-2b AOI-ZIP **transaction** + per-row-UPDATE→1 batch VALUES + point-def resolve 1 lần/board + image upload **semaphore 6-way** + `_core/cache.ts`→facade bounded cacheService (LRU cap+TTL+Redis-L2 optional). **HOÃN (cần dep/infra):** worker_threads/Piscina cho CPU-heavy pure-JS, aiJobQueue→BullMQ, read-replica `getReadDb()`.

**Đợt S — Timescale cutover (chuẩn bị artifact; CHẶN thực thi — extension chưa cài):** probe xác nhận server **PG 17.6 thuần, KHÔNG có timescaledb** (`pg_available_extensions` chỉ pg_stat_statements). Cutover thật = việc owner (image `timescaledb-ha:pg17` + off-peak + backup — runbook `scripts/migrate-to-timescaledb.md` mục A-E). Đã thêm: **mig 0235** `hourly_yield_cagg` continuous-aggregate (guarded như 0172 — no-op khi thiếu extension, additive KHÔNG drop matview, policy refresh 1h/90d, cảnh báo tz UTC-vs-factory-local) + runbook **mục F** (áp CAgg + backfill + đổi read-path + giải pháp tạm thu-hẹp-window không-cần-Timescale). Phát hiện phụ: health `refresh_qw_caches` lỗi là **stale** (verify chạy OK); `fact_inspection_hourly`=0 dòng (cần `REPORTING_MART_ENABLED` bật cron trước khi làm nguồn dashboard P0-E).

**Đợt T — Backend thật 2 tầng (commit `2c449a9`, mig 0236, tsc+build+test 311 green; §7 chốt: device-path code-now-FFI-stub · read-replica làm · quick-win owner-flip):**
- **T-1 quản lý (WIRE code chết):** downtime auto-detect nối 2 choke-point ingest (heartbeat+inspection) + sweep `DOWNTIME_DETECTION_ENABLED`; feeder run-gate `assertLineSetupOkForRun` vào production-order→in_progress (`FEEDER_VERIFY_ENFORCED` fail-closed, chỉ máy có feeder); unified fleet-status (edge_nodes+edge_deployments+device_adapters); SECS/GEM bring-up caller (`secsGemBringup` mở HSMS per-equipment + `attachGemAlarmDispatch`, config `SECS_GEM_EQUIPMENT`). **7 quick-win đều có caller/scheduler THẬT** (bảng cờ + cấu hình phụ — owner flip .env).
- **T-2 lập trình + device-path (honest dry-run khi vắng HW):** node-graph persist OrchestrationStudio (StudioStep.ui, parity IR); **four-eyes cấp-version mig 0236** (program_artifacts reviewStatus/reviewedBy/reviewedAt + `reviewArtifact` SoD + chặn build/deploy chưa-approved, `DPC_VERSION_REVIEW_ENABLED` OFF); verify-after-download read-back/checksum (verified chỉ khi khớp, honest `verified:false` khi vắng HW); Zmotion `compile()` ghi `.bas` + `zauxFfi.ts` bind ZAux_* qua **koffi lazy-import** (build KHÔNG phụ thuộc koffi; owner cài koffi+DLL trên host HW); Robot-TM/Mitsubishi deploy route qua command-dispatcher (HITL, simulated trung thực khi control-off/vắng-device).
- **T-3 scale-out + safety seam:** `getReadDb()` read-replica pool (`DATABASE_READ_URL`, degrade về primary; report/BI/MV read-path đổi sang, write nguyên); Redis L2 hot-stat cache + `CACHE_REDIS_L2_ENABLED` kill-switch; **Safety-PLC vendor adapter seam** (skeleton Pilz PNOZmulti/Sick Flexi Soft — HONEST `isRated:false`, không actuate, không giả rated) + `docs/SAFETY_PLC_ADAPTER.md` (FAT gate 6 điểm + rủi-ro-tạm-thời-có-văn-bản).

**Đợt U — Nghiệm thu phần cứng (BACKLOG đầu tư — chặn bởi thiết bị + hiện diện nhà máy):** không có code mới — mọi seam đã sẵn (T-3 Safety-PLC adapter + T-2 device-path FFI-stub). Danh mục nghiệm thu cho owner:
1. **Safety-PLC (P0 an toàn)** — mua Pilz PNOZmulti / Sick Flexi Soft; cắm vào seam `registerVendorAdapter`; FAT theo `docs/SAFETY_PLC_ADAPTER.md`: dừng <100ms dual-channel Cat3/4·SIL2/3, manual-reset, selfTest pass → mới cho `isRated:true`. Tới đó: software-interlock là đường DUY NHẤT (rủi-ro-có-văn-bản).
2. **HW-validation OT/robot** — FAT tại nhà máy: Modbus/S7/OPC-UA/EtherNet-IP + Fanuc RMI (option R912) + Mitsubishi (SLMP 3E vs GX-Works) + Techman (TMflow register-map) + Delta (DRL mailbox). Bật `OT_CONTROL_ENABLED`/`ROBOT_CONTROL_ENABLED` sau commissioning record.
3. **Zmotion deploy** — cài koffi + zauxdll.dll trên host đấu ZMC + FAT nạp `.bas`/verify-after-download thật.
4. **Timescale cutover** (Đợt S) — cài extension + off-peak (runbook A-F).

**Câu hỏi §7 đã chốt hết** (device-path code-now, Safety-PLC lên-kế-hoạch-mua, read-replica làm). Docs 34/36 + file client (App-Launcher session) để nguyên.

**Owner action tổng hợp (.env + môi trường):** áp mig 0234/0235-guarded/0236 (0234/0236 đã áp session này; 0235 chờ Timescale) · restart+smoke app avi_app · rotate PW avi_app · bật 2FA cho account privileged (nếu không sẽ bị khóa deploy sau Đợt Q) · audit ai giữ bit machine_control · flip 7 quick-win + downtime/feeder cờ staged · Timescale cutover · koffi+Safety-PLC khi có HW.

---

*Doc 38 · audit 5 agent read-only (DB-perf/backend-scale/ingest-worker/mgmt-control/programming-control/RBAC) · kế thừa doc 33/35/37 · thực thi P(`ee91675`)/Q(`20d2dcf`)/R(`2a7febc`,mig0234)/S(artifact,mig0235-guarded) · migration tiếp 0236.*
