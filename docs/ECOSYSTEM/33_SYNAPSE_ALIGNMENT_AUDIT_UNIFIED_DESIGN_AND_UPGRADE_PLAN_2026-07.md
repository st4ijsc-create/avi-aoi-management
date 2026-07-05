# 33 — SYNAPSE: Đánh giá · Đối chiếu · Thiết kế Hợp nhất & Kế hoạch Nâng cấp Hệ sinh thái

> **Đầu vào:** báo cáo tham khảo **SYNAPSE** (`D:\SOURCES\SYNAPSE\`) gồm (1) Bản thiết kế chi tiết hệ thống *SYN-RAOE-SDD-001 v1.0* (16 chương, 12 thành phần cốt lõi) và (2) Kế hoạch phát triển phần mềm *SYN-RAOE-DEVPLAN-001* (3 edition, 3 ADR, release train R0–R4).
> **Đối chiếu với:** hệ **AVI/AOI Management** thực tế (React 19 + tRPC v11 + Drizzle/PostgreSQL 17 + TimescaleDB · MQTT Aedes/EMQX · local-LLM Qwen3 trên RTX 5090 · Docker) — branch `automation-orchestration-r0`.
> **Phương pháp:** 6 agent audit đọc-chỉ song song (kiểm chứng code thật, trích dẫn file) + kế thừa doc 16/18/21/22/24/27.
> **Ngày:** 2026-07-05 · **Tác giả:** Principal Systems Architect · **Trạng thái:** 🟢 *ĐÃ DUYỆT (§5B) — đang thực thi Đợt Nền tảng trong git worktree riêng `../avi-aoi-synapse` (branch `synapse-foundation`), tách khỏi phiên doc-32. Nhật ký: §7.*

---

## 0. Tóm tắt điều hành (đọc trước)

**SYNAPSE là gì:** một tầm nhìn *platform sản phẩm* để điều phối mọi robot + thiết bị đa hãng qua chuẩn mở (VDA 5050, OPC UA, MQTT/Sparkplug, SECS/GEM, ISA-95), đóng gói thành **3 edition** (Machine/Line/Site) bán kèm máy (OEM) hoặc theo dây chuyền/nhà máy, với **kiến trúc gập được**, **plugin marketplace** và **licensing** làm đường nâng cấp thương mại. Về mặt *chức năng*, nó là bản mở rộng & chuẩn-hoá-hoá của đúng báo cáo mà **doc 16 đã đối chiếu và thực thi** (Khối 0–7). Về mặt *sản phẩm*, nó thêm một tầng chiến lược hoàn toàn mới.

**Ba kết luận cốt lõi của đối chiếu:**

1. **Về CHỨC NĂNG (12 thành phần §5): hệ hiện tại đã hiện thực ~57% ở mức framework** — phần lớn là *"code thật, đã test, cờ TẮT"* (production thực-vận-hành ~15% vì gần như mọi flag OFF). Không có khoảng cách nào đòi hỏi viết lại. **Tuyệt đối KHÔNG rewrite sang Go/Rust/Python** như SDD giả định greenfield — hệ TS/Node đã có 276 bảng, 171 router/1717 procedure, 4242 test xanh và AI brain là tài sản mạnh nhất (§5.8 ~90%).

2. **Về SẢN PHẨM/PLATFORM (6 trụ chiến lược MỚI): đây mới là giá trị thật SYNAPSE mang lại** — và là chỗ hệ còn yếu nhất: **editions/collapsible-deploy (~25%), plugin out-of-process/marketplace (~30%), desktop shell + local agent (~5%), developer portal/SDK (~10%)**. Licensing đã *mạnh* (~70%) nhưng chính sách grace **halt sản xuất — trái nguyên tắc sắt của SYNAPSE**.

3. **Về NỀN TẢNG PHI CHỨC NĂNG cần cho một platform bán được: security & observability là gap nghiêm trọng** — §5.11 Security ~42%, §5.12 Observability ~40%: **không có OpenTelemetry, OPA, Vault, SPIFFE, device-X.509, hash-chain WORM audit, SLO/error-budget, decision-trace**. Một platform bán cho nhà máy khác *bắt buộc* phải có các mục này.

**Khuyến nghị chiến lược:** giữ nguyên stack, coi SYNAPSE là **bản thiết kế "platformization"** — biến một MES/orchestration triển-khai-đơn thành một **platform đa-edition, plugin-extensible, bán được**. Kế hoạch §4 chia 3 nhóm: **A) Platformization (mới), B) Functional hardening (5 khoảng trống đặc tả), C) Activation & proof (bật cờ + phần cứng).** Thứ tự & phạm vi chờ bạn duyệt ở **§5**.

---

## 1. Phân tích báo cáo SYNAPSE — con đường, các tầng, tính năng

### 1.1 Bản chất & định vị
SYNAPSE tự định nghĩa là **RAOE — Robotics & Automation Orchestration Ecosystem**: lớp điều phối *giám sát* ISA-95 **L2–L3** (hiện diện biên L1, tiệm cận L4), **KHÔNG** thay thế safety PLC/E-stop (ISO 10218 / TS 15066) — ranh giới an toàn bất di bất dịch. Ba cam kết sản phẩm: **dễ cài · dễ dùng (Simple/Expert mode, VI/EN) · mạnh & đầy đủ**.

### 1.2 Các tầng (ánh xạ ISA-95) và 12 thành phần cốt lõi (SDD §5)
| Tầng | Thành phần SYNAPSE | Vai trò |
|---|---|---|
| L4 Cloud | AI training · Data lake · Federation | phân tích, huấn luyện, liên nhà máy |
| L3 Site | **5.1 Orchestration Engine** · **5.3 Scheduler** · **5.9 Enterprise Integration** · **5.7 Digital Twin** · **5.10 Control Tower** | bộ não điều phối + trí tuệ |
| L2 Site | **5.2 Fleet Management** · **5.4 Traffic & Motion** · **5.6 UNS & Data Fabric** | đội robot, giao thông, nguồn sự thật |
| L1 Edge | **5.5 Integration Hub** (connector) | trừu tượng thiết bị, store-and-forward |
| L0 | Thiết bị vật lý | ngoài phạm vi (kết nối) |
| Cross-cut | **5.11 Identity/Security/Policy** · **5.12 Observability** · **5.8 AI/ML** | xuyên suốt mọi tầng |

### 1.3 Con đường sản phẩm — 3 edition + licensing + kiến trúc gập được (DEVPLAN §3–4, ADR-006/007)
- **1 codebase → 3 edition:** *Machine Edition* (1 IPC single-node bán kèm máy, OEM royalty) → *Line Edition* (1 server/K3s cụm máy) → *Site Edition* (K8s HA đa line). **Đường nâng cấp liền mạch:** máy tự thấy nhau qua UNS → *Join wizard* bridge broker → gia nhập Site *không cài lại, không mất dữ liệu, license cũ trừ vào giá mới* ("ngựa thành Troy").
- **Kiến trúc gập được (ADR-007):** cùng mã chạy từ 1 IPC (embedded broker, PG/SQLite đơn) tới cụm K8s; **hạ tầng lớn (Kafka/K8s) là *tùy chọn theo profile*, không phải điều kiện tiên quyết**. CI bắt buộc test cả 2 profile (chống "edition drift").
- **Web-first + Tauri (ADR-006):** 1 codebase React → trình duyệt (Control Tower) + PWA kiosk (HMI) + **Tauri 2 shell** (.exe ~10MB, auto-start, fullscreen, offline). Mọi thứ cần native dồn về **Local Agent (Go)** — serial/USB/dongle/SDK-DLL hãng qua sidecar gRPC; **UI không bao giờ gọi phần cứng trực tiếp.**
- **Licensing (§4.3):** file ký **Ed25519** (edition, module flags, hạn mức thiết bị, fingerprint TPM/CPU/MAC), kích hoạt offline (air-gap), license server on-prem floating theo thiết bị kết nối, **grace 30 ngày chỉ cảnh báo — KHÔNG khóa** (*"không bao giờ dừng sản xuất vì license"*).

### 1.4 Kiến trúc plugin (ADR-008, §6.4) — điều kiện "là platform"
Out-of-process (gRPC, kiểu HashiCorp go-plugin), **6 extension point**: Device Connector · Robot Adapter · Skill Plugin · Enterprise Connector · AI Model Plugin · UI Widget. Mỗi plugin có **`plugin.yaml`** (id, SemVer, `apiVersion` range, protocols, `configSchema` JSON-Schema → *tự sinh form UI*, permissions ACL topic, chữ ký Ed25519). **Certification pipeline:** conformance suite → sandbox chaos → ký + SBOM + quét CVE → registry → (R4) marketplace. Kết quả: **chi phí thêm 1 hãng = hằng số & cô lập (1 plugin), không sửa lõi.**

### 1.5 Release train & 6 thuộc tính platform
- **R0** walking skeleton → **R1** Connect & See → **R2** Orchestrate → **R3** Intelligence (twin/AI/dev-portal) → **R4** Scale & Autonomy (federation/RL/marketplace/IEC 62443 SL2-3).
- **Phụ lục A** truy vết 6 thuộc tính: *Modularity · Scalability · Reusability · Open APIs · DX&UX · Security&Reliability* — mỗi thuộc tính có cơ chế + thước đo, là checklist mỗi cổng release.

### 1.6 Đánh giá phê phán báo cáo SYNAPSE (điểm mạnh & điểm cần chỉnh cho bối cảnh)
**Điểm mạnh (kế thừa):** (a) tách Safety Loop khỏi Orchestration Loop; (b) UNS/Sparkplug + ISA-95 làm nguồn sự thật; (c) simulation-first; (d) **tầng platformization** (editions/licensing/plugin/dev-portal) — *rất giá trị, doc 16 chưa có*; (e) 6-attribute traceability là công cụ governance tốt; (f) contract-driven + collapsible deploy.

**Điểm cần chỉnh (giữ đúng bài học doc 16 §1.2):**
| # | Vấn đề của SYNAPSE | Điều chỉnh cho hệ này |
|---|---|---|
| S-1 | **Giả định greenfield polyglot (Go/Rust/Python/Temporal/Kafka/K8s)** | Hệ đã là TS/Node monolith-of-services chín. **Giữ stack**; ánh xạ khái niệm, KHÔNG viết lại. Kafka/K8s = *tùy chọn theo quy mô*, không mặc định. |
| S-2 | **Trọng tâm AMR/AGV fleet + humanoid quy mô lớn** | Nhà máy lõi là **AOI/AVI/SPI/SMT + test-cell**, robot chủ yếu **cobot/SCARA cố định + AGV nội bộ**. Ưu tiên test-cell/AOI-in-the-loop; fleet lớn là mở rộng. (giữ bài học C-1) |
| S-3 | **Coi ERP/MES là "bên ngoài"** | Hệ này *chính là* MES. Enterprise Integration = cổng ERP-inbound + publish outbound, không tái thiết kế MES. (giữ C-2) |
| S-4 | **AI/Twin coi như xây mới (Triton/Isaac)** | Tái dùng local-LLM Qwen3 brain + Rapier physics + PatchCore đã có. Triton/Isaac là *tùy chọn khi đo đạc cần*. (giữ C-3) |
| S-5 | **Grace-period licensing** đúng ("không dừng máy") nhưng hệ hiện đang làm **ngược** (halt) | Sửa chính sách grace: degrade tính năng, **không khóa mutation sản xuất**. |
| S-6 | Multi-tenant/RLS chỉ nhắc thoáng | Bắt buộc tenant-scope + RLS cho entity mới (federation-ready, doc 13). (giữ C-7) |
| S-7 | Bối cảnh air-gap OT chỉ nêu nguyên tắc | Cụ thể hoá: offline activation (đã có), no cloud→device command path (đã tôn trọng kiến trúc). |

**Kết luận đánh giá:** SYNAPSE là *khung platform xuất sắc* để nâng hệ từ "sản phẩm triển-khai-đơn" lên "platform bán được", nhưng **lạc stack & lạc trọng tâm ngành** nếu áp nguyên văn. Thiết kế §3 giữ phần đúng (editions/plugin/security/observability/contracts), bỏ phần lặp (rewrite polyglot), và bám bối cảnh AOI + kỷ luật flag-OFF/HITL đã chứng minh.

---

## 2. Đối chiếu SYNAPSE ↔ Hệ hiện tại (bằng chứng code, 2026-07-05)

Quy ước: 🟢 production-capable (flag ON được ngay) · 🟡 framework/flag-OFF/partial · 🔴 stub/absent. `%` = **maturity framework** (không phải production-vận-hành, vốn thấp hơn nhiều vì đa số cờ TẮT).

### 2.1 Bảng A — 12 thành phần cốt lõi SYNAPSE (§5)

| SYNAPSE | Maturity | Bằng chứng file (thật) | Khoảng cách chính vs SYNAPSE |
|---|---|---|---|
| **5.1 Orchestration Engine** | 🟡 ~55% | `orchestration/foe/foeEngine.ts` (ISA-88 runtime, retry/timeout/saga/HITL, `rehydrateInterruptedRuns`), `api/v1/erpIntake.ts` (Idempotency-Key, schemaVersion, Zod) | **In-process, KHÔNG durable/event-sourced** (crash→`held` resume tay); tree **chưa phải DAG + topological**; thiếu Policy/SLA P0-P3, four-eyes, outbox chung |
| **5.2 Fleet Management** | 🟡 ~60% | `robot/robotManager.ts`, `robot/robotIngest.ts`, `vda5050/*`, `ros2/ros2Bridge.ts` (rosbridge WS), `fleet/chargingPlanner.ts`, `fleet/resourceManager.ts` | State-Aggregator→UNS/Sparkplug cho robot còn mỏng; ROS2 bridge custom, cờ OFF |
| **5.3 Scheduling & Dispatching** | 🟡 ~50% | `dispatchingService.ts` (rank: priority/aging/bottleneck/EDF; score: capability/distance/battery/queue), `apsSolver.ts` + `scripts/aps_solver.py` (**OR-Tools CP-SAT thật**) | CP-SAT chỉ cho *production orders*, chưa cho fleet-task window; **thiếu 2-phase commitment, RL advisor** |
| **5.4 Traffic & Motion** | 🟡 ~45% | `twin/occupancyGrid.ts` (A* octile), `twin/dstarLite.ts` (D* Lite incremental), `fleet/trafficManager.ts` (`detectDeadlockCycles` wait-graph + resolve), `drizzle/schema/fleet.ts` | **Reservation = semaphore đếm zone (FOR UPDATE, mig 0164), KHÔNG phải space-time interval-tree**; A* **không có trục thời gian**; map = grid, chưa versioned node-edge; **thiếu Infra Coordinator** (thang máy/cửa/Open-RMF) |
| **5.5 Integration Hub** | 🟡 ~65% | `ot/otManager.ts`, `ot/driverRegistry.ts`, `ot/drivers/{opcua,modbus,s7,mitsubishiMc,ethernetIp}Driver.ts`, **`ot/storeForward.ts`** (WAL JSONL ≥24h, idempotent backfill), `ot/connectionSupervisor.ts`, `ot/commissioningService.ts`, `mtconnect/*`, `secsgem/hsmsClient.ts`+`secs2Codec.ts`, `focas/*`, `euromap/euromapOpcuaReader.ts` | **SECS/GEM real-nhưng-chưa-đủ-E30** (thiếu S2F33/35/37 event-link, spooling, S5/S7); FOCAS/Euromap-63/83 cần sidecar native; per-connector health chỉ getter, chưa REST chuẩn |
| **5.6 UNS & Data Fabric** | 🟡 ~55% | `uns/sparkplug{Encoder,State,Node,Command}.ts` (**Sparkplug B thật**: NBIRTH/DDATA/NCMD, **alias + seq 0-255 wrap + bdSeq**), `uns/topicBuilder.ts` (ISA-95), `telemetryBus.ts`, `db/timescale.ts` (**TimescaleDB thật**, hypertable), `deploy/emqx/` | **Thiếu Kafka/NATS replay, data-lake Iceberg, ClickHouse mart, schema-registry BACKWARD enforcement** (chỉ `contracts/machineDataContract.ts` v1 additive) |
| **5.7 Digital Twin & Sim** | 🟡 ~55% | `twin/pipeline/urdfToGltf.ts` + `stepToGltf.ts` (**occt WASM CAD thật**) + `usdExport.ts`, `programming/sim/rapierPhysics.ts` (**Rapier thật**, inverse-dynamics, tip-over, collision → **Sim Gate chặn deploy**), `programming/sim/kinematicSimGate.ts`, `twin/twinReplay.ts` (replay TimescaleDB), `twin/twinStream.ts` (WS ≤10Hz) | **Thiếu:** FMU/FMI co-sim, **twin↔reality drift detector**, Monte-Carlo N≥30 + CI (DES `simulation/desEngine.ts` chạy đơn), virtual-commissioning 6-bước hình thức, domain-randomization; client three.js **chưa có physics** |
| **5.8 AI/ML Services** | 🟢 ~85% | `aiModelRouter.ts` (tiered, node-llama-cpp **CUDA GGUF Qwen3** + vision sidecar + `onnxruntime` DINOv2), `aiRcaCopilot.ts` (RAG/GraphRAG + citation test), `aiAnomalyDetection.ts` (**PatchCore thật**), `predictiveMaintenanceService.ts` (hazard/EWMA/CUSUM/IsoForest), MLOps: `aiModelCard.ts` (EU-AI-Act cards), `aiDriftMonitor.ts` (**PSI**), `ai/modelAutoRollback.ts` | **Thiếu RL/PPO scheduling** (Isaac Lab), Triton (chỉ ONNX seam), **KS-test** (PSI-only), canary stage rõ, survival/LSTM (PdM đang heuristic/thống kê) |
| **5.9 Enterprise Integration** | 🟡 ~60% | `services/integration/erpOutbox.ts` (**outbox transactional thật**: idempotent, backoff, **circuit-breaker in-house, DLQ** `status='dead'`), `api/v1/erpIntake.ts`, `erpOauth.ts` (OAuth2 client-cred), `erpMtls.ts` (seam), `b2mmlCodec` (ISA-95 B2MML), `webhookBridge.ts` | Cờ OFF; **thiếu reconciliation cron ngày, Pact/semver contract-test, canonical ISA-95 đầy đủ, correlation chain xuyên suốt** order→wo→task→unit |
| **5.10 Control Tower & HMI** | 🟡 ~68% | `pages/CommandCenter.tsx`, `MESControlTower.tsx`, `AndonBoard.tsx`, `OEEDashboard.tsx`, `RobotControl.tsx`, `ThresholdApprovalsPage.tsx`, `standards/alarmMasterService.ts` (**ISA-18.2/EEMUA-191 thật**: priority-matrix, shelving, suppression, flood KPI), `_core/socket.ts` | **Thiếu e-SOP kiosk (bước điều kiện + e-signature)**, live plant geo-map; four-eyes hiện là segregation-of-duty riêng lẻ, chưa hàng đợi phê duyệt chung; alarm governance cờ OFF |
| **5.11 Identity/Security/Policy** | 🔴 ~42% | `routers/twoFactorRouter.ts` (**TOTP thật**, speakeasy), `_core/oauth.ts`, `_core/accessControl.ts` (RBAC + attr filter), `drizzle/schema/controlAudit.ts` (append-only *by convention*), `factoryZones.ts`/`safetyZones.ts` (schema) | **Thiếu OPA/Rego, Vault, SPIFFE/mTLS service-identity, device X.509 PKI, hash-chain WORM audit, SBOM+CVE scan**; IEC-62443 zone mới ở mức schema |
| **5.12 Observability** | 🔴 ~40% | `_core/metrics.ts` (**prom-client thật**, `/metrics`, RED), `services/aiMetrics.ts`, `monitoring/` (Grafana+Prometheus+compose), `pino` logs | **Thiếu OpenTelemetry tracing (0 dep), correlation_id xuyên suốt, decision-trace ("vì sao robot X"), SLO/error-budget/burn-rate, Loki/ELK shipping, ClickHouse mart** |

**Trung bình 12 thành phần ≈ 57% (framework).** Điểm mạnh: **5.8 AI (85%), 5.10 Control Tower (68%), 5.5 Hub (65%)**. Điểm yếu nhất: **5.12 Observability (40%), 5.11 Security (42%), 5.4 Traffic (45%)**.

> ⚠️ **Cảnh báo diễn giải:** đây là maturity *framework*. Production-vận-hành thấp hơn nhiều — **hầu như mọi flag OFF mặc định** (`FOE_ENABLED`, `FLEET_ORCH_ENABLED`, `OT_GATEWAY_ENABLED`, `UNS_*`, `TWIN_LIVE_ENABLED`, `SIM_PHYSICS_ENABLED`, `ERP_OUTBOX_ENABLED`, `EQ_GOVERN_ENABLED`, `TENANT_RLS_ENABLED`, `METRICS_ENABLED`…). Đây là **tài sản lớn nhưng đang ngủ** — đúng phát hiện doc 22/27.

### 2.2 Bảng B — 6 trụ chiến lược MỚI của SYNAPSE (đây là phần giá trị & gap thật)

| Trụ chiến lược (SYNAPSE) | Trạng thái | Bằng chứng | Cần xây (net-new) |
|---|---|---|---|
| **Editions + collapsible deploy** (ADR-007) | 🟡 ~25% | `scripts/build-offline-package.mjs` + `create-offline-deploy.ps1` + `install-service.bat` (NSSM) = **single-node all-in-one THẬT**; `docker-compose.yml` **1 stack, không profile** | Khái niệm *edition descriptor* (Machine/Line/Site); build/compose **profile**; toggle infra tùy chọn (embedded vs external PG/broker); **K3s/K8s + HA chart** (scale-up hiện KHÔNG có); CI 2-profile |
| **Licensing** (§4.3) | 🟢 ~70% | `server/license/{license-service,license-guard,license-middleware}.ts` + `sdk/index.cjs` (`@lms/license-sdk`) + `license.lic` (RSA-SHA256 + AES-256 + fingerprint + moduleCodes + offline activation + **floating** checkout/heartbeat + CRL) | **Sửa grace "không dừng sản xuất"** (hiện readonly→locked = HALT ❌); tùy chọn **Ed25519** re-sign + **TPM binding**; per-connected-device metering qua Robot Registry |
| **Module / entitlement framework** (§4.2) | 🟡 ~60% | `shared/module-registry.ts` (**15 module, register-and-go, quota `MAX_DEVICE_ADAPTERS`…, `toExportFormat`**), `client/hooks/useLicenseModules.ts` | Hợp nhất **~110 env flag / 541 `process.env`** dưới registry; **middleware guard per-module ở tầng API** (hiện chủ yếu route-level) |
| **Plugin / connector architecture** (ADR-008) | 🟡 ~30% | Registry **in-process** `ot/driverRegistry.ts`, `secsgem/secsGemRegistry.ts`, `robot/robotAdapter.ts`, `programming/programmingAdapter.ts` (Map factory, `registerDriver`) | **`plugin.yaml` manifest + `apiVersion` SemVer gate + ký + permissions**; runtime **out-of-process (gRPC/sidecar)**; **JSON-Schema→auto-form**; registry + certification; 6 extension point |
| **Desktop shell + Local Agent** (ADR-006) | 🔴 ~5% | *Không có* Tauri/Electron; `FactoryAlertSystem/` = **RN Android** (không phải desktop shell) | **Tauri 2/WebView2 kiosk shell** (.exe auto-start/fullscreen/offline) + **Local Agent** (serial/USB/dongle/DLL hãng) |
| **Developer Portal / SDK / marketplace** (R3/R4) | 🔴 ~10% | `apidocs/*.md` viết tay; `*Marketplace.tsx` = xem license read-only; **0 file OpenAPI/AsyncAPI/proto** | Publish **OpenAPI/AsyncAPI**; plugin-authoring **SDK + docs**; **sandbox simulator online**; adapter marketplace; KPI time-to-first-plugin |

### 2.3 Bảng C — 6 thuộc tính platform (Phụ lục A SYNAPSE) chấm cho hệ hiện tại

| # | Thuộc tính | Điểm | Ghi chú |
|---|---|---|---|
| 1 | Modularity | 🟡 ~65% | module-registry + registries mạnh; nhưng plugin **in-process** (chưa out-of-process, chưa cô lập lỗi) |
| 2 | Scalability | 🟡 ~40% | scale-**down** thật (offline bundle); scale-**up** absent (no cluster/HA/K8s) |
| 3 | Reusability | 🟢 ~70% | 1 codebase, module-registry, shared services; thiếu codegen SDK client |
| 4 | Open APIs | 🟡 ~45% | tRPC + `/api/v1` REST + MQTT Sparkplug thật; **KHÔNG publish OpenAPI/proto**, no dev-portal |
| 5 | DX & UX | 🟡 UX~75% / DX~25% | UX design-system tốt (doc 17/23/26); **DX cho bên thứ ba gần như 0** (no plugin SDK/sandbox) |
| 6 | Security & Reliability | 🟡 ~50% | Reliability khá (outbox/circuit-breaker/store-forward/saga); **Security thiếu OPA/Vault/SPIFFE/X.509/WORM** |

### 2.4 Kết luận đối chiếu — gap thật nằm ở đâu
1. **KHÔNG phải ở chức năng lõi** — 12 thành phần đã ~57% framework, đang được doc 16/24/27 lấp dần. 5 khoảng trống đặc-tả còn lại là *cụ thể & hữu hạn*: **(i) durable-execution engine, (ii) space-time/interval-tree reservation, (iii) 2-phase fleet commitment, (iv) RL dispatch advisor, (v) Infra Coordinator (thang máy/cửa)**.
2. **Ở tầng platformization** — editions, plugin out-of-process/marketplace, desktop shell + local agent, developer portal. Đây là *đòn bẩy thương mại* SYNAPSE và là **chỗ trống lớn nhất**.
3. **Ở nền tảng bán-được** — security (OPA/Vault/SPIFFE/X.509/WORM) & observability (OTel/decision-trace/SLO) platform-grade, + sửa licensing grace. **Không có các mục này thì không bán được platform ra nhà máy khác.**

---

## 3. Thiết kế hợp nhất hoàn thiện (kiến trúc đích cho hệ hiện tại)

> Nguyên tắc: **CONSOLIDATE & INTEGRATE, giữ stack, KHÔNG rewrite.** Mọi năng lực treo lên *golden thread*: sensor → Unified Telemetry Bus → inspection/production/quality → AI → alert/Andon → twin → action → feedback. Kế thừa 7 nguyên lý doc 16 §3.1 (safety-loop tách biệt · 1 telemetry bus · 1 canonical model · 1 write-gate · real-time/async tách · multi-tenant+RLS · golden-thread) + **bổ sung 4 kỷ luật platform mới của SYNAPSE**.

### 3.0 Bốn kỷ luật platform mới (thêm vào doc 16)
1. **Contracts-first, phiên bản hoá:** đưa `server/contracts/` thành *nguồn sự thật* — sinh **OpenAPI (REST `/api/v1`) + AsyncAPI (topic UNS/Sparkplug)** tự động; SemVer + BACKWARD-only cho schema (buf/openapi-diff gate trong CI).
2. **Collapsible deployment:** mọi dịch vụ phải chạy được **single-node (Machine)** *và* cluster (Site); hạ tầng lớn là **profile tùy chọn**, không tiên quyết.
3. **Extension via plugin, không sửa lõi:** thêm hãng/thiết bị/skill = 1 plugin có manifest + apiVersion gate; lõi không biết tên hãng.
4. **Platform-grade cross-cutting:** security (identity 3 loại + policy-as-code + WORM audit) & observability (traces + decision-trace + SLO) là *bắt buộc*, không tùy chọn — vì platform phải chạy trong nhà máy của khách hàng khác.

### 3.1 Kiến trúc "gập được" cho stack TypeScript (Editions trên Node)
```
┌─ MACHINE EDITION (1 IPC) ─────────────────┐   ┌─ SITE EDITION (K8s HA) ──────────────┐
│  Tauri shell (.exe, kiosk, offline)       │   │  Control Tower (browser, multi-user) │
│  + Local Agent (serial/USB/dongle/DLL)    │   │  + PWA kiosk HMI cạnh line            │
│  1 node all-in-one:                       │   │  Cụm dịch vụ: orchestration/scheduler│
│   app (Node/tRPC) + embedded PG +         │   │   /fleet/traffic/ai/twin/integration │
│   Aedes broker + module subset            │   │  PostgreSQL HA + TimescaleDB +        │
│   (Hub + Fleet-mini + AI-lite + license)  │   │   EMQX cluster + (Redis/BullMQ) +     │
│  build/compose profile: `edition=machine` │──▶│   (optional Kafka/ClickHouse)         │
│  license: edition=machine, quota N devices│   │  profile: `edition=site`, K3s edge/zone│
└───────────────────────────────────────────┘   └──────────────────────────────────────┘
        ▲ Join wizard (mDNS discover → bridge Aedes→EMQX → gia nhập Site, không cài lại) ┘
```
**Kỹ thuật cho phép (trên stack hiện có, KHÔNG thêm bừa):**
- **Edition descriptor** (`shared/editions.ts` — MỚI): `{ edition, enabledModules[], quotas, infraProfile }`; đọc bởi `module-registry` + bootstrap. 1 artifact, nhiều khóa (đã có nền `module-registry.ts` + `license`).
- **Infra profile toggle:** embedded (Aedes + PG local) ↔ external (EMQX cluster + PG HA + TimescaleDB) qua env/descriptor; code *không giả định* cluster tồn tại. Đã có sẵn dual-broker (Aedes 1883 + EMQX 1884) và dual-DB (`db/timescale.ts` degrade→main).
- **Scale-up mới:** `deploy/helm/` (Site K8s) + `deploy/k3s/` (edge/line) + `docker-compose.machine.yml` (profile single-node). Tận dụng `build-offline-package.mjs` cho Machine.
- **CI 2-profile:** smoke E2E chạy trên `edition=machine` (compose single-node) *và* `edition=site` (compose cluster) — chống edition drift.

### 3.2 Tầng Contracts + Plugin/Connector SDK (in-process → out-of-process)
- **Giai đoạn 1 (rẻ, giá trị cao):** chuẩn hoá registry hiện có thành **Plugin Manifest**: mỗi adapter (`ot`/`secsgem`/`robot`/`programming`) kèm `manifest.ts` (id, version, `apiVersion` range, `configSchema` Zod→JSON-Schema, permissions topic). **Setup Wizard tự sinh form** từ `configSchema` — thêm hãng OPC-UA/Modbus = khai báo, không code. **Conformance suite** (đã có nền `standards/conformanceTest.ts`) thành cổng CI bắt buộc.
- **Giai đoạn 2 (khi cần cô lập/bên-thứ-ba):** **out-of-process sidecar** cho SDK native (FOCAS Fwlib32, SDK robot DLL) — sidecar Node/C# expose gRPC theo Connector contract; lõi chỉ thấy gRPC, watchdog restart, quota. Đây cũng là đường cho **plugin bên thứ ba ký số**.
- **6 extension point** ánh xạ registry sẵn có: Device Connector=`driverRegistry`, Robot Adapter=`robotAdapter`, Skill Plugin=`skillRegistry`, Enterprise Connector=`erp*`, AI Model Plugin=`aiModelRouter`/`aiModelCard`, UI Widget=module-federation (R3+).

### 3.3 Licensing & module entitlement hợp nhất
- **Sửa grace policy (P0 đạo đức-sản-phẩm):** hết hạn/mất license server → **degrade** (khoá tính năng cao cấp: twin/AI/multi-site) nhưng **KHÔNG bao giờ khoá mutation sản xuất/inspection**. Bỏ trạng thái `locked` chặn máy. (`license-guard.ts`)
- **Hợp nhất flag:** di chuyển dần ~110 env flag operational vào `module-registry` (feature/quota) + giữ env cho *deploy-time infra* — 2 lớp rõ ràng: *entitlement (license)* vs *ops toggle (env)*.
- **Tùy chọn Ed25519 + TPM** (nếu theo đúng SYNAPSE): thêm đường ký Ed25519 song song RSA; TPM/secure-enclave binding là *nice-to-have* cho khách bảo thủ.
- **Metering per-connected-device** qua Robot/Equipment Registry (đã có số liệu) → floating license Line/Site.

### 3.4 Security & Observability nâng "platform-grade"
**Security (đưa 42%→ mục tiêu 75%):**
- **Identity 3 loại:** user OIDC+MFA (đã có TOTP) + RBAC/ABAC (đã có `accessControl`) → thêm **service identity (mTLS/SPIFFE-lite qua cert nội bộ)** + **device X.509** (nạp lúc onboarding, xoay 90 ngày) cho adapter/robot.
- **Policy-as-code:** bắt đầu bằng **OPA-lite nội bộ** (rule khai báo có version + test) cho lệnh rủi ro cao (skip AOI class-3, override zone đông người) — không cần OPA server ngay; nâng OPA thật ở Site Edition.
- **WORM audit hash-chain:** nâng `controlAudit` từ *append-only-by-convention* → **hash-chain (mỗi bản ghi băm prev)** + export SIEM; đây là yêu cầu tuân thủ bán hàng.
- **Secrets:** Vault *tùy chọn* cho Site; Machine dùng OS keystore. **SBOM + quét CVE tuần** trong CI (`ci.yml`).
- Giữ **IEC 62443 zone/conduit** (schema `factoryZones`/`safetyZones` đã có) + invariant "no cloud→device command" (đã tôn trọng).

**Observability (đưa 40%→ mục tiêu 75%):**
- **OpenTelemetry** xuyên suốt: `correlation_id` từ order→wo→task→robot-command→ack (nền đã có ở `erpIntake`/`foeEngine`); export OTLP → Grafana Tempo/Jaeger. Bật `METRICS_ENABLED` mặc định ON.
- **Decision-trace** (đặc thù điều phối): mỗi quyết định dispatch/allocate lưu "vì sao" (candidate set, điểm, ràng buộc loại ai, version thuật toán) — nâng từ `rationale` string hiện tại thành bảng `decision_traces`.
- **SLO catalog + error-budget + burn-rate alert** (SDD §5.12.2): độ trễ dispatch P95 ≤500ms, UNS P99 ≤250ms, twin sync ≤1s, API ≥99.9%.

### 3.5 Data Fabric mở rộng — CHỈ khi quy mô cần (tránh over-engineering)
- **Schema registry BACKWARD** (rẻ, làm sớm): mở rộng `contracts/machineDataContract.ts` thành registry đa-schema + cổng compat trong CI (openapi-diff/buf) cho cả REST + Sparkplug payload.
- **Streaming replay / lake / mart (Kafka/Iceberg/ClickHouse): HOÃN** cho tới khi throughput thật vượt ngưỡng (SDD nói ≥100k msg/s). Quy mô AOI hiện tại: **TimescaleDB + BullMQ đủ**; ClickHouse mart chỉ khi BI self-service cần (đã có BI export router `30_BI_EXPORT_API`). *Ghi rõ ngưỡng kích hoạt, không xây trước.*

### 3.6 Năm khoảng trống chức năng đặc-tả (functional hardening)
1. **Durable orchestration:** nâng `foeEngine` từ in-process → **durable/event-sourced** (checkpoint mỗi transition vào `orchestration_run_steps`, auto-continue sau crash thay vì `held`). *Không cần Temporal* — làm event-sourcing trên Postgres đã có; Temporal là tùy chọn Site.
2. **Space-time reservation:** nâng `trafficManager` từ semaphore-đếm → **interval-tree khe (edge_id, [t_in,t_out])** + A* có trục thời gian (`occupancyGrid` space-time). Giữ deadlock wait-graph đã có.
3. **2-phase fleet commitment:** thêm `Fleet.Reserve→Confirm/Release` (lease + hạn giữ 5s) chống 2 scheduler gán trùng robot.
4. **RL dispatch advisor:** shadow→suggest→auto-trong-biên trên twin (nền `aiOrchestrationAdvisor` + `desEngine` + Rapier); circuit-breaker về heuristic khi KPI xấu 2 chu kỳ. *Bật cuối cùng, sau khi twin đủ chín.*
5. **Infra Coordinator:** giao thức 3 bước request→grant→occupy/release cho thang máy/cửa/trạm sạc (adapter PLC/REST) — chỉ khi nhà máy có hạ tầng này.

### 3.7 Desktop shell (Tauri) + Local Agent — cho Machine Edition
- **Tauri 2 shell** bọc chính SPA React hiện có → `.exe` auto-start/fullscreen/offline/khoá license máy. **Không viết UI hai lần.**
- **Local Agent** (Node service hoặc Go nhẹ): serial/RS-485/USB/dongle/SDK-DLL hãng → chuẩn hoá → phát lên UNS cục bộ; UI không gọi phần cứng trực tiếp. Tận dụng adapter OT đã có; Agent chỉ là *host process cạnh máy*.

### 3.8 Developer Portal + Marketplace (R3/R4, sau cùng)
Publish OpenAPI/AsyncAPI/proto (§3.2) → portal tài liệu + **sandbox simulator** (đã có `foeSimulator`/`desEngine`/URSim harness) + sample plugin + `synapse plugin new` template + conformance chạy local. Marketplace adapter ký số ở R4.

### 3.9 Frontend / Control Tower alignment
Kế thừa doc 17/23/26 (design-system ~65-92%). Bổ sung theo SYNAPSE: **Simple/Expert mode toggle**, **Setup/Join wizard** (edition), **plugin config auto-form** (từ JSON-Schema), **decision-trace viewer**, **SLO/alarm ISA-18.2 dashboard** (bật `EQ_GOVERN`). Giữ i18n vi/en/zh, module-registry + `navigation.tsx`.

---

## 4. KẾ HOẠCH NÂNG CẤP CHI TIẾT *(chờ bạn DUYỆT — §5)*

> Nguyên tắc thực thi (theo convention repo doc 16/24/27): mỗi giai đoạn = 1–N agent chuyên môn (backend service + drizzle migration đánh số tiếp + router + client page + i18n vi/en/zh + tests) · **flag OFF mặc định** · exit-criteria + smoke-test · 1 commit/phase (wave-lead commit, **cấm subagent git**) · cập nhật `module-registry` + `navigation.tsx` · **CONSOLIDATE, không phá golden-thread**. Green gate mỗi phase: `npm run check` (tsc 0) + `vite build` + acceptance test.

### 4.1 Ba nhóm công việc

**NHÓM A — Platformization (giá trị chiến lược MỚI, khác biệt cạnh tranh)**

| GĐ | Tên | Trụ | Nội dung chính | Đầu ra | Cờ | Exit-criteria |
|---|---|---|---|---|---|---|
| **P1** | Edition & Collapsible Deploy | Editions | `shared/editions.ts` descriptor; `docker-compose.machine.yml` (single-node profile) + `deploy/helm/` (Site) + `deploy/k3s/` (edge); infra-profile toggle (embedded↔external); CI 2-profile smoke | Chạy được Machine (1 node) & Site (cluster) từ 1 codebase | `EDITION_PROFILE` | E2E xanh trên **cả 2 profile**; Machine cài < 30′ |
| **P2** | Licensing hardening | Licensing | **Sửa grace "không dừng sản xuất"** (bỏ `locked` chặn máy); tách entitlement vs ops-flag; metering per-device; (tùy chọn) Ed25519 re-sign | Licensing đúng nguyên tắc SYNAPSE | — (refactor) | Hết hạn license → degrade, **KHÔNG chặn** inspection/production; test |
| **P3** | Plugin Manifest & SDK v1 | Plugin | Manifest + `apiVersion` SemVer gate cho 4 registry; `configSchema`→auto-form wizard; conformance CI bắt buộc | Thêm hãng = khai báo, không sửa lõi | `PLUGIN_MANIFEST` | Thêm 1 adapter OPC-UA mới **chỉ bằng manifest+form**; conformance xanh |
| **P4** | Out-of-process sidecar | Plugin | gRPC sidecar cho SDK native (FOCAS/robot DLL); watchdog + quota + ký số | Plugin cô lập lỗi, bên-thứ-ba-ready | `PLUGIN_SIDECAR` | Kill sidecar không sập lõi; drain ≤30s |
| **P5** | Desktop shell + Local Agent | ADR-006 | Tauri 2 bọc SPA (.exe kiosk/offline/auto-start); Local Agent serial/USB/dongle→UNS | Machine Edition desktop thật | `DESKTOP_SHELL` | .exe chạy offline, đọc 1 thiết bị serial thật (hoặc sim) |
| **P6** | Developer Portal v1 | Open APIs/DX | Publish OpenAPI+AsyncAPI từ `contracts/`; portal + sandbox + template + sample | time-to-first-plugin ≤1 ngày | `DEV_PORTAL` | Bên thứ ba viết 1 plugin chỉ bằng docs công bố |

**NHÓM B — Functional hardening (lấp 5 khoảng trống đặc-tả + nền bán-được)**

| GĐ | Tên | Thành phần | Nội dung chính | Đầu ra | Cờ | Exit-criteria |
|---|---|---|---|---|---|---|
| **H1** | Security platform-grade | 5.11 | mTLS/SPIFFE-lite service identity; device X.509 onboarding; **OPA-lite policy engine**; **hash-chain WORM audit**; SBOM+CVE CI | Security 42%→75% | `SEC_PLATFORM` | Lệnh rủi ro cao qua policy; audit hash-chain verify; SBOM CI xanh |
| **H2** | Observability platform-grade | 5.12 | **OpenTelemetry** correlation xuyên suốt; **decision-trace** table+viewer; **SLO+error-budget+burn-rate**; bật metrics ON | Observability 40%→75% | `OTEL_ENABLED` | Trace 1 order→robot-command end-to-end; SLO dashboard sống |
| **H3** | Durable orchestration | 5.1 | Event-sourced FOE (auto-continue sau crash); recipe→**DAG + topological**; Policy/SLA P0-P3 + four-eyes queue; outbox chung | Orchestration bền | `FOE_DURABLE` | Kill giữa run → auto-resume đúng; DAG cycle bị chặn |
| **H4** | Traffic space-time + commitment | 5.4, 5.3 | **Interval-tree space-time reservation** + A* trục thời gian; **2-phase fleet commitment**; (tùy chọn) Infra Coordinator | Traffic đạt đặc-tả | `TRAFFIC_SPACETIME` | 60 robot/zone/24h sim **không deadlock, không gán trùng** |
| **H5** | Schema registry + contract-test | 5.6, 5.9 | Registry đa-schema BACKWARD gate (REST+Sparkplug); reconciliation cron; Pact/semver contract-test ERP | Contracts kỷ luật | `SCHEMA_REGISTRY` | Breaking-change bị CI chặn; reconciliation phát lệch |
| **H6** | Twin fidelity + RL advisor | 5.7, 5.8 | twin↔reality drift detector; Monte-Carlo N≥30+CI; virtual-commissioning 6-bước; **RL dispatch shadow→suggest→auto** | Twin/AI đạt đặc-tả | `TWIN_DRIFT`, `RL_ADVISOR` | Drift cảnh báo khi lệch >10%; RL shadow log so heuristic |

**NHÓM C — Activation & Proof (bật cờ + phần cứng — sau khi A/B chín)**

| GĐ | Tên | Nội dung | Phụ thuộc |
|---|---|---|---|
| **C1** | Flag-flip staged | Bật theo thứ tự an toàn (doc 19/23 runbook) trên staging → smoke → production; giám sát SLO | H1-H2 xong |
| **C2** | Hardware proof | Data thật vendor AOI (I.C.T/Saki/Mirtec), FOCAS Fwlib32, GigE camera, real robot FAT, Safety PLC SIL (doc 27 §13) | Phần cứng + hiện diện nhà máy |

### 4.2 Đồ thị phụ thuộc & sequencing đề xuất
```
P1 Editions ─┬─▶ P2 Licensing ─▶ P5 Desktop ─┐
             ├─▶ P3 Plugin ─▶ P4 Sidecar ────┼─▶ P6 Dev Portal
H1 Security ─┴─▶ H2 Observability ────────────┘         (marketplace R4)
H3 Durable ─▶ H4 Traffic+Commit ─▶ H6 Twin/RL
H5 Schema/Contract  (độc lập, chạy song song)
                 ▼
        C1 Flag-flip ─▶ C2 Hardware proof
```
**Đường tới hạn (khuyến nghị):** **H1→H2** (security+observability) làm *trước tiên* — vì (a) rẻ tương đối, (b) là điều kiện cần để bán platform, (c) chặn nợ kỹ thuật. Song song **P1→P3** (editions+plugin) mở đường thương mại. Nhóm functional H3/H4/H6 và P4/P5/P6 theo sau. C1/C2 sau cùng.

### 4.3 Ước lượng thô (để bạn cân nhắc phạm vi)
- **Quick wins (≤1 tuần mỗi cái):** P2 (grace fix), H5-schema-registry-lite, bật `METRICS_ENABLED`, P3-manifest-cho-1-registry.
- **Trung bình (1–3 tuần):** P1, P3-đủ, H1, H2, H3.
- **Lớn (3–6 tuần / cần R&D):** P4 sidecar, P5 desktop+agent, P6 portal, H4 space-time, H6 RL.
- **Chặn bởi phần cứng:** C2 (không thể thay bằng phần mềm).

---

## 5. QUYẾT ĐỊNH CẦN BẠN DUYỆT (trước khi gọi agent thực thi)

1. **Tham vọng chiến lược — chọn 1:**
   - **(A) Platform bán được đa-edition** (làm cả Nhóm A + B) — đúng tinh thần SYNAPSE, mở doanh thu OEM/Line/Site. *Khuyến nghị nếu ST4I muốn thương mại hoá.*
   - **(B) Chỉ hardening nội bộ** (chỉ Nhóm B + P2 licensing-fix) — nếu mục tiêu là vững hệ đang dùng, chưa bán ra ngoài.
   - **(C) Hybrid** — B trước (H1/H2/H3), A sau khi có khách hàng thật.
2. **Thứ tự ưu tiên:** đồng ý "**H1 Security + H2 Observability trước**" (nền bán-được + trả nợ), hay ưu tiên **P1/P3 Editions+Plugin trước** (đòn bẩy thương mại)?
3. **Phạm vi Data Fabric:** đồng ý **HOÃN Kafka/Iceberg/ClickHouse** cho tới khi vượt ngưỡng throughput (giữ TimescaleDB+BullMQ)? *(khuyến nghị: có)*
4. **Licensing:** giữ RSA-2048 hiện tại (chỉ sửa grace) hay **thêm đường Ed25519 + TPM** theo đúng SYNAPSE?
5. **Desktop shell:** làm **Tauri** (P5) trong đợt này hay hoãn (chỉ giữ web + offline bundle đã có)?
6. **Plugin out-of-process (P4):** làm ngay hay giữ in-process + manifest (P3) là đủ cho giai đoạn này?
7. **Robot/fleet trọng tâm:** xác nhận giữ **cobot/test-cell/AOI-in-the-loop** làm trọng tâm (bài học S-2/C-1), fleet AMR lớn là mở rộng?

> Sau khi bạn chọn (1)–(7), tôi sẽ chốt danh sách giai đoạn + thứ tự, rồi **gọi các agent chuyên môn thực thi từng phase** (flag OFF → smoke → bật), commit theo phase, cập nhật doc này với "KẾT QUẢ THỰC THI" như convention doc 24/27.

---

## 5B. ✅ CHỐT DUYỆT & TRÌNH TỰ THỰC THI (2026-07-05)

**Quyết định của chủ sở hữu (7/7):**
1. **(A) Platform bán được đa-edition** — tham vọng đầy đủ.
2. Ưu tiên **P1/P3 Editions + Plugin trước** (đòn bẩy cấu trúc-thương mại).
3. **HOÃN** Kafka/Iceberg/ClickHouse — giữ TimescaleDB + BullMQ.
4. **Thêm đường Ed25519 + TPM** cho licensing (song song RSA hiện có).
5. **HOÃN Tauri desktop (P5)** — ưu tiên hoàn thiện nền tảng trước.
6. **Plugin out-of-process (P4): LÀM NGAY.**
7. Trọng tâm robot = **cobot/test-cell/AOI-in-the-loop + robot 6 trục**; AMR/fleet lớn & phần còn lại để sau.

> **Mục tiêu meta (chủ sở hữu):** *"Xây nền tảng platform hoàn thiện cao nhất trước; các phần còn lại nâng cấp sau để thương mại."*

**Điều hoà #2 ↔ meta:** P1/P3/P4 (editions + plugin) **chính là cấu trúc nền tảng**, nên "làm trước" = "foundation first". Các phần *đóng gói/đưa-ra-thị-trường* (desktop, dev-portal/marketplace) và *fleet AMR nâng cao* mới là "thương mại sau".

### Đợt NỀN TẢNG (thực thi ngay — theo thứ tự)
| # | Phase | Nội dung | Cờ | Ghi chú |
|---|---|---|---|---|
| F1 | **P1** Edition & Collapsible Deploy | `shared/editions.ts` descriptor; infra-profile toggle (embedded↔external); compose `machine`/`site` profile + `deploy/helm` + `deploy/k3s`; hợp nhất env-flag vào module-registry; CI 2-profile | `EDITION_PROFILE` | cấu trúc spine |
| F2 | **P3** Plugin Manifest & SDK v1 | manifest + `apiVersion` SemVer gate cho 4 registry; `configSchema`→auto-form; conformance CI | `PLUGIN_MANIFEST` | |
| F3 | **P4** Plugin Out-of-process | gRPC sidecar cho SDK native (FOCAS/robot DLL); watchdog+quota+ký | `PLUGIN_SIDECAR` | quyết định #6 |
| F4 | **P2** Licensing hardening | sửa grace "không dừng sản xuất"; **+ Ed25519 + TPM**; metering per-device | — | quyết định #4 |
| F5 | **H1** Security platform-grade | mTLS/SPIFFE-lite service id; device X.509; OPA-lite; hash-chain WORM audit; SBOM+CVE CI | `SEC_PLATFORM` | nền bán-được |
| F6 | **H2** Observability platform-grade | OpenTelemetry correlation; decision-trace; SLO/error-budget/burn-rate; bật metrics | `OTEL_ENABLED` | nền bán-được |
| F7 | **H5** Schema registry + contracts | OpenAPI/AsyncAPI từ `contracts/`; BACKWARD gate; reconciliation cron; Pact ERP | `SCHEMA_REGISTRY` | nền Open-API |
| F8 | **H3** Durable orchestration | event-sourced FOE (auto-resume); recipe→DAG+topological; Policy/SLA P0-P3 + four-eyes; outbox chung | `FOE_DURABLE` | lõi bền |

### Đợt SAU (thương mại/nâng cao — hoãn)
P5 Desktop/Tauri · P6 Dev-Portal/marketplace · H4 Traffic space-time + infra-coordinator (fleet AMR) · H6 Twin drift + RL advisor · C1 flag-flip · C2 hardware proof.

### Ràng buộc thực thi (pre-flight 2026-07-05)
- Branch `automation-orchestration-r0`; **migration mới bắt đầu `0202`** (mới nhất 0201).
- **Working tree 572 file chưa commit** (tồn đọng doc 27/31) → cần quyết định git-hygiene trước khi chồng code (xem phần kết cuộc hội thoại).
- Convention: flag OFF mặc định · migration additive/idempotent đánh số tiếp · `npm run check` (tsc 0) + `vite build` + smoke mỗi phase · cập nhật `module-registry` + `navigation.tsx` + i18n vi/en/zh · **wave-lead commit, cấm subagent git** · CONSOLIDATE không phá golden-thread.

---

## 6. Kết luận

Hệ AVI/AOI hiện tại **đã hiện thực phần lớn *chức năng* của SYNAPSE** (12 thành phần ~57% framework, AI brain vượt trội) và **đã đi qua đúng bài tập này một lần** (doc 16, Khối 0–7, thực thi tới ~85%). Giá trị thật SYNAPSE bổ sung **không nằm ở viết lại lõi** mà ở **tầng platformization** (editions · plugin marketplace · desktop · dev-portal · licensing đúng) và **nền tảng bán-được** (security & observability platform-grade). Thiết kế §3 và kế hoạch §4 giữ nguyên stack, tôn trọng kỷ luật flag-OFF/HITL/audit/golden-thread đã chứng minh, và biến hệ từ *"sản phẩm triển-khai-đơn mạnh nhưng đang ngủ"* thành *"platform đa-edition bán được, extensible, quan-sát-được, an-toàn"*.

**Bước kế tiếp:** bạn duyệt **§5** → tôi chốt phạm vi/thứ tự → gọi agent thực thi.

---

## 7. NHẬT KÝ THỰC THI (append-only)

**Git-hygiene + isolation (2026-07-05):** commit checkpoint `e17d205` toàn bộ working tree tồn đọng (doc 25/26/27/31, đã lọc secrets/APK/test-results; gate `tsc --noEmit` exit 0) trên `automation-orchestration-r0`. Phát hiện **một phiên song song đang thực thi doc-32 (reporting/export) trong CÙNG working tree**; theo quyết định của chủ sở hữu, **tách git worktree riêng** cho SYNAPSE: main tree trả về `automation-orchestration-r0` (doc-32 nguyên vẹn), công việc SYNAPSE chuyển sang worktree **`../avi-aoi-synapse`** (branch `synapse-foundation`, node_modules junction + .env sao chép). Migration mới bắt đầu `0202` (lưu ý: doc-32 đã dùng 0202 ở tree kia — SYNAPSE sẽ đánh số tránh trùng khi cần migration).

### ✅ F1 (P1) — Edition & Collapsible Deploy — 2026-07-05
**Phạm vi giao:** hạ tầng "gập được" cấp descriptor + hồ sơ triển khai, **non-breaking / advisory** (EDITION mặc định = `site` = hành vi cũ y nguyên). KHÔNG migration.
**Đã làm:**
- `shared/editions.ts` — descriptor 3 edition (machine/line/site) + semantics: edition **BOUND** license (module ceiling + quota clamp + infra default), không bao giờ cấp vượt license; core luôn cho phép. Helpers `getEdition/resolveEditionModules/clampQuota/isModuleAllowedInEdition`. Treo lên `module-registry` (một artifact, nhiều khóa).
- `server/_core/deploymentProfile.ts` — resolver edition + infra profile từ env, suy ra broker (embedded-aedes/external-emqx) + time-series (main-db/dedicated-timescale) thật; `describeDeployment()` cho startup log.
- `server/routers/editionRouter.ts` (READ-ONLY `current`/`list`) + đăng ký vào `appRouter` (`edition:`).
- Startup log `[edition] …` trong `server/_core/index.ts` (dynamic import, non-breaking).
- `deploy/compose/docker-compose.machine.yml` — Machine single-node "collapsed" (postgres ts-ha + redis + app; **không EMQX, không TSDB riêng**; broker nhúng; TS degrade→main).
- `deploy/EDITIONS.md` (ma trận + cách chạy + upgrade path) · `deploy/helm/README.md` + `deploy/k3s/README.md` (scaffold Site/edge).
- `.env.example` — block `EDITION` / `INFRA_PROFILE` / `EDITION_PROFILE` (mặc định site/advisory).
- Tests: `server/_core/editions.test.ts` (12) + `server/_core/deploymentProfile.test.ts` (8) — **20/20 xanh** (đặt dưới `server/` vì vitest include chỉ `server/**` + `client/src/**`).
**Gate:** `tsc --noEmit` exit 0 · 20/20 test xanh. Flag `EDITION_PROFILE=false` (advisory).
**Còn lại của P1 (đợt sau):** enforce module-ceiling/quota trong license-middleware (advisory → cưỡng chế) · hợp nhất ~110 env-flag operational vào registry · Helm/K3s HA manifests thật · Join wizard + UNS bridge (mDNS) · CI 2-profile smoke · client edition badge (dùng `trpc.edition.current`).

### ✅ F2 (P3) — Plugin Manifest & SDK v1 — 2026-07-05
**Phạm vi giao:** tầng manifest plugin (ADR-008) cấp registry + apiVersion gate + auto-form, **non-breaking / advisory** (metadata, không mở control path, không đổi hành vi adapter). KHÔNG migration.
**Đã làm:**
- `shared/plugin/manifest.ts` — hợp đồng `PluginManifest` (id/version SemVer/`apiVersion` range/kind 6-extension-point/protocols/configSchema/permissions/signature) + **`satisfiesApiVersion`** (^, x, ">=a <b", exact; **fail-closed**) + `validateManifest` (pure).
- `server/services/plugins/pluginRegistry.ts` — register-and-go; **apiVersion GATE**: manifest ngoài dải → `PluginRejectedError` (Hub từ chối, không "chạy liều"). `registerPlugin`/`tryRegisterPlugin`/`list`/`get`/`byKind`.
- `server/services/plugins/configForm.ts` — **Zod → JSON-Schema** (zod v4 `z.toJSONSchema`) cho Setup Wizard tự sinh form; fail-safe.
- `server/services/plugins/otConnectorManifests.ts` + `index.ts` — seed manifest **5 OT connector** (opcua/modbus/s7/mitsubishi-mc/ethernet-ip) với config-form + permissions ACL topic; register-and-go tại import. Chứng minh "thêm hãng = khai báo manifest + auto-form, không sửa lõi".
- `server/routers/pluginRouter.ts` (READ-ONLY `apiVersion`/`list`/`listByKind`/`get`) + đăng ký `plugin:` vào appRouter.
- `.env.example` — flag `PLUGIN_MANIFEST` (advisory).
- Test: `server/services/plugins/manifest.test.ts` — apiVersion gate reject, validate good/bad, 5 seed conformance (valid+compatible+signed+auto-form).
**Gate:** `tsc --noEmit` exit 0 · test xanh (xem commit).
**Còn lại của P3 (đợt sau):** gắn manifest vào registry secsgem/robot/programming; wizard UI tiêu thụ `plugin.get.configSchema`; conformance suite chạy như CI bắt buộc cho adapter mới; `synapse plugin new` template.

### ✅ F5 (H1) — Security platform-grade (đợt 1) — 2026-07-05
**Ưu tiên lại theo chủ sở hữu:** làm F5 Security + F6 Observability TRƯỚC F3/F4 (đường tới hạn "nền bán-được"). **Non-breaking / advisory**, KHÔNG migration.
**Đã làm (2 trụ tự-chứa, giá trị cao nhất):**
- `server/services/security/policyEngine.ts` — **OPA-lite policy-as-code**: rule model khai báo được (serializable, versioned) + evaluator thuần (deny > require_approval > allow, fail-safe). `DEFAULT_POLICIES` hiện thực đúng ví dụ SDD §5.11.2 (cấm skip AOI class-3; duyệt override khi zone đông; duyệt recipe-write khi line running). Callers (write-gate) opt-in.
- `server/services/security/auditChain.ts` — **hash-chain WORM audit**: `appendRecord`/`verifyChain` (sha256, canonical JSON, genesis, seq tăng dần) → mọi sửa/chèn/xoá bản ghi bị phát hiện. Nâng audit từ "append-only theo quy ước" → tamper-evident.
- `server/routers/securityRouter.ts` (READ-ONLY `policies`/`evaluate` dry-run) + đăng ký `security:`.
- `.github/workflows/sbom-cve.yml` — SBOM (CycloneDX) + CVE audit hằng tuần (advisory).
- `.env.example` — flag `SEC_PLATFORM`.
- Test: `server/services/security/security.test.ts` — policy precedence + tamper-detection.
**Gate:** tsc 0 · test xanh.
**Còn lại của H1 (đợt sau):** mTLS/SPIFFE-lite service identity + device X.509 onboarding (cần PKI/infra); wire hash-chain vào `controlAudit` writer thật; OPA server thật cho Site edition; Vault (tuỳ chọn Site).

### ✅ F6 (H2) — Observability (đợt 1) — 2026-07-05
**Phạm vi giao:** nền observability tự-chứa, **ít phụ thuộc** (không thêm OTel SDK nặng lúc này — full OTLP export hoãn). **Non-breaking / advisory**, KHÔNG migration.
**Đã làm:**
- `server/services/observability/slo.ts` — **SLO catalogue + error-budget + multi-window burn-rate** (SRE workbook: critical 14.4×, warning 6×). `DEFAULT_SLOS` = target SDD §5.12.2 (dispatch P95 ≤500ms, UNS P99 ≤250ms, twin ≤1s, API ≥99.9%).
- `server/services/observability/decisionTrace.ts` — **truy vết quyết định** (ring buffer bounded): candidate set + điểm + ràng buộc loại ai + version thuật toán → trả lời "vì sao robot X được chọn lúc 14:32". `recordDecision/queryDecisions/explainDecision`.
- `server/services/observability/correlation.ts` — **correlation backbone** qua `AsyncLocalStorage` (không cần OTel SDK): 1 correlation_id chạy order→wo→task→robot-command→ack; decision-trace tự gắn id.
- `server/routers/observabilityRouter.ts` (READ-ONLY `slos`/`evaluateSlo` preview/`recentDecisions`) + đăng ký `observability:`.
- `.env.example` — flag `OBSERVABILITY`.
- Test: `server/services/observability/observability.test.ts` — SLO budget/burn, decision record/query/explain, correlation propagation.
**Gate:** tsc 0 · test xanh.
**Còn lại của H2 (đợt sau):** **OpenTelemetry SDK thật** (OTLP→Tempo/Jaeger) wire vào HTTP pipeline; persist decision-trace vào hypertable (migration đánh số tránh trùng 0202); bật `METRICS_ENABLED` mặc định + burn-rate alert nối Prometheus; Loki/ClickHouse shipping.

### ✅ F4 (P2) — Licensing hardening — 2026-07-05
**Thứ tự chủ sở hữu:** F4 → F7 → F8 → F3. **Lưu ý:** F4 sửa hành vi enforcement THẬT (không chỉ module mới) — giữ *status* license trung thực, chỉ đổi *cưỡng chế*.
**Đã làm:**
- `server/license/licensePolicy.ts` — **"không bao giờ dừng sản xuất vì license"** (SYNAPSE §4.3): allowlist procedure **production-critical** (inspection/session/andon/safety/interlock/telemetry/alert/equipment/robot/field) LUÔN qua ở MỌI state; `locked` **degrade → readonly** cho cấu hình khi `LICENSE_NEVER_STOP_PRODUCTION` (mặc định TRUE). Pure `isProcedureAllowed`/`decideLicenseBatch`.
- `server/license/license-middleware.ts` — refactor `licenseEnforcementMiddleware` dùng `decideLicenseBatch` (giữ nguyên 403 shape; thông điệp mới nêu rõ sản xuất-cốt-lõi vẫn chạy). **Thay hành vi "hết hạn = chặn mọi mutation / khoá cứng" (halt máy) → chỉ khoá cấu hình.**
- `server/license/ed25519License.ts` — đường **Ed25519** sign/verify (song song RSA, dùng Node crypto) + **TPM-bound fingerprint** scaffold (kết hợp TPM-EK/CPU/MAC/disk; TPM-read cần agent, hoãn).
- `server/license/deviceMetering.ts` — **metering per-connected-device** (floating license Line/Site); over-limit = **cảnh báo, KHÔNG chặn**.
- `.env.example` — `LICENSE_NEVER_STOP_PRODUCTION` (default true).
- Test: `server/license/licenseHardening.test.ts` — policy (critical luôn qua/ mọi state; locked→readonly; batch), Ed25519 roundtrip/tamper, fingerprint TPM/stable, metering.
**Gate:** tsc 0 · test xanh.
**Còn lại của P2 (đợt sau):** phát hành license Ed25519 thật + rotate RSA→Ed25519; agent đọc TPM-EK; collector metering nối Robot/Equipment registry đẩy License Server; nút "grace banner" trên UI.

**Kế tiếp:** F7 (H5) Schema registry + OpenAPI/AsyncAPI.

---
*Tài liệu 33 · SYNAPSE alignment · phương pháp: 6 agent audit code-thật + kế thừa doc 16/18/21/22/24/27 · maturity §2 là framework-level, trích dẫn file · ĐÃ DUYỆT §5B, thực thi §7 trong worktree `../avi-aoi-synapse`.*
