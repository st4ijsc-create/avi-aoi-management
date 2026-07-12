# 44 — CHUYỂN HÓA HỆ SINH THÁI THÀNH SYNAPSE
## So sánh & đánh giá 5 tầng vs đặc tả LDS · Kế hoạch nâng cấp toàn diện ≥95/100 · Rebrand AOI/AVI → SYNAPSE

| | |
|---|---|
| Mã tài liệu | ECO-44 |
| Ngày lập | 2026-07-12 |
| Tài liệu nguồn | `D:\SOURCES\SYNAPSE\` — LDS-L1..L5 (5 file .docx 07-12/07/2026) + KE-HOACH-PHAT-TRIEN.md (SYN-RAOE-DEVPLAN-001) + SYNAPSE_RAOE_Thiet_ke_chi_tiet.docx (12 thành phần lõi) |
| Phương pháp | 5 agent audit read-only codebase theo từng tầng (chấm rubric production-grade) + 1 agent kiểm kê rebrand + 2 agent nghiên cứu benchmark thị trường 2024-2026 (nguồn sơ cấp, có URL) |
| Trạng thái | **CHỜ DUYỆT** — chưa thực thi thay đổi nào |
| Kế thừa | doc 33 (SYNAPSE alignment ~57%), doc 35/37/38 (platformization), doc 39 (frontend 321 findings), doc 40/41 (machine monitoring W0-3B), doc 42 (master-data audit) |

---

## 0. TÓM TẮT ĐIỀU HÀNH

**Câu hỏi:** Hệ sinh thái hiện tại (avi-aoi-management) phải thay đổi gì để trở thành một **SYNAPSE thực thụ** — đủ mạnh, đủ linh hoạt, đủ chuyên nghiệp cho khách hàng cỡ Foxconn/Samsung, triển khai được từ **1 máy đến hàng trăm máy**, mỗi tầng đạt **≥95/100**?

**Kết quả chấm điểm hiện trạng (thang 100, rubric khắt khe production-grade):**

| Tầng | Tên | Điểm hiện tại | Trần nếu chỉ sửa phần mềm | Mục tiêu | Gap quyết định |
|---|---|---:|---:|---:|---|
| **T1** | Kết nối & Trừu tượng thiết bị | **59** | ~85-88 | ≥95 | Edge gateway process thật; Hermes=0, CFX không boot; SAFETY_BLOCKED chưa nối; HW-validation ≈ 0 |
| **T2** | Unified Namespace & Dữ liệu | **39** | ~70 | ≥95 | Không streaming bus/replay; schema registry không cưỡng chế; không semantic layer versioned; không lake/tiering; Timescale chưa active |
| **T3** | Điều phối (LC · OE · Policy) | **40** | ~90 | ≥95 | **Line Controller ~10% (gần như không tồn tại)**; Policy đang default-ALLOW; order lifecycle là master-data tĩnh; QT-3 ≈ 0 |
| **T4** | Trí tuệ (Twin · AI/ML · MLOps) | **56** | ~85-88 | ≥95 | Twin fidelity = stub; feature store = 0; RUL heuristic; hợp đồng Advice (guardrail+requires) chưa tồn tại |
| **T5** | Ứng dụng & Cắt ngang | **60** | ~90 | ≥95 | Nhiều năng lực an ninh/quan sát = code-sau-cờ-OFF chưa wire; correlation_id chưa chảy L5→L1; thiếu Line View/e-SOP; virtualization = 0 |
| | **Trung bình** | **50.8** | | **≥95** | |

**Ba kết luận chiến lược:**

1. **KHÔNG viết lại — kích hoạt & hoàn thiện.** Nền móng đã đúng hướng SYNAPSE ở mức hiếm thấy cho codebase tự xây: Sparkplug B lifecycle chuẩn chỉnh, commandDispatcher 1-cửa 9-gate fail-closed, FOE Saga durable + sim-gate HMAC, genealogy hash-chain, ranh giới AI advisory-only cưỡng chế bằng code, kỷ luật "honest degradation" xuyên suốt. Vấn đề số 1 là **rất nhiều năng lực đã xây nhưng nằm sau cờ OFF/chưa wire/chưa boot** — "bật và nối" trước khi "xây mới".
2. **Bốn lỗ hổng kiến trúc phải xây mới thật sự:** (a) **Line Controller** đúng nghĩa (T3 — lỗ lớn nhất toàn hệ), (b) **streaming bus + stream processing + semantic layer versioned** (T2), (c) **vòng fidelity twin + feature store + hợp đồng Advice** (T4), (d) **edge gateway process tách khỏi server trung tâm** (T1 — điều kiện của kiến trúc "gập được" Machine/Line/Site Edition).
3. **≥95 điểm mọi tầng cần 3 lớp việc:** phần mềm thuần (đưa mọi tầng lên ~85-90) + hạ tầng mới (EMQX cluster, NATS/Kafka, object store, Timescale cutover, PG replica, OpenBao) + hiện diện phần cứng/nhà máy (HW-validation driver, safety-PLC thật, cảm biến rung cho failure-mode, dữ liệu hỏng hóc tích lũy cho RUL). Không có lớp 2 và 3 thì T1/T2 kịch trần ~70-88.

**Rebrand:** brand hiện tại đang lẫn lộn ("Continuum" là token chính thức nhưng vỏ ngoài title/PWA/PDF vẫn "AVI/AOI"). Kế hoạch 4 đợt ở §11; điểm mấu chốt: ~70-80% chữ "AOI" phía server là **thuật ngữ loại máy** (Automated Optical Inspection — ngang hàng SPI/AXI/ICT) và **phải giữ nguyên**; chỉ đổi phần branding. Rủi ro cao nhất là MQTT topic namespace `avi/...` (cần dual-publish + grace period).

---

## 1. NGUỒN & PHƯƠNG PHÁP

**Đặc tả SYNAPSE đã đọc toàn văn (trích xuất từ .docx):**
- **LDS-L1** (SYN-ECO-LDS-L1-001): Adapter SDK, Edge Gateway, Canonical Device Model, Protocol Normalization, 6 thực thể canonical, UNS topic + Sparkplug B, command handshake, SLO tag→UNS P95≤250ms.
- **LDS-L2** (SYN-ECO-LDS-L2-001): UNS broker HA, Schema Registry BACKWARD, streaming bus + stream processing (watermark/backfill), stores đa tầng + tiering, Semantic Layer as-code, Access APIs, genealogy; SLO ingest→query ≤1s, state read ≤100ms, ≥100k điểm/s.
- **LDS-L3** (SYN-ECO-LDS-L3-001): Line Controller (FSM tuyến 7 trạng thái, takt, blocking/starving, RecipeSet khóa phiên bản, readiness), Orchestration Engine (Saga + order lifecycle + QT-1..4), Policy Engine (default-deny, ≤20ms, obligations, audit bất biến).
- **LDS-L4** (SYN-ECO-LDS-L4-001): Twin 3 cấp 4 chế độ + fidelity tự vô hiệu, PdM (anomaly/RUL/failure-mode), vision quality, optimization guardrail cứng + twin-first, MLOps (feature store, registry, shadow→canary→prod, drift), Advice API (Recommendation kèm guardrail+requires), nguyên tắc AI-chỉ-khuyến-nghị.
- **LDS-L5** (SYN-ECO-LDS-L5-001): Control Tower + HMI 6 persona/8 màn hình, BFF, can-thiệp-qua-Policy, e-SOP, Andon 4 mức + MTTA/MTTR, tích hợp ISA-95 (MES/ERP/WMS/PLM/CMMS), an ninh zone/conduit IEC 62443 + zero-trust, observability (correlation_id L5→L1, SLO catalog); 5 bất biến xuyên tầng.
- **KE-HOACH-PHAT-TRIEN.md**: 3 edition (Machine/Line/Site), kiến trúc "gập được" (ADR-007), web-first UI + Tauri (ADR-006), plugin out-of-process + manifest + conformance (ADR-008), release train R0-R4, licensing Ed25519 + grace 30 ngày, 6 thuộc tính platform.

**Audit codebase:** 5 agent song song, read-only, xác minh trực tiếp trên disk (file:line), đối chiếu nhưng không tin doc audit cũ. Rubric mỗi tầng 100 điểm, chấm kiểu production-Foxconn/Samsung: code-có-nhưng-cờ-OFF/không-boot/không-HW-validated bị trừ thẳng.

**Benchmark thị trường:** 2 agent nghiên cứu web (nguồn sơ cấp 2024-2026, URL trong §Phụ lục C): Litmus/HighByte/Kepware/Ignition/Siemens IE/AWS Greengrass (T1); HiveMQ/EMQX/Kafka/Timescale/ClickHouse/Rhize/IPC-CFX (T2); Temporal/Camunda/OPA/PackML/VDA5050/Open-RMF/Opcenter/Plex/Tulip (T3); Isaac Sim/ISO 23247/Augury/Senseye/Cognex/LandingLens/MLflow/ISO 42001/EU AI Act (T4); Ignition/AVEVA/Optix/ISA-101/ISA-18.2/IEC 62443/NIST 800-82r3/EU CRA/OpenBao/OTel/ArgoCD (T5) + bảng đối thủ hệ sinh thái.

---

## 2. TẦM NHÌN HỆ SINH THÁI SYNAPSE (mục tiêu chốt)

> **SYNAPSE = một nền tảng duy nhất điều phối mọi máy móc đa hãng — từ 1 máy bán kèm OEM đến toàn nhà máy — qua chuẩn mở, với 5 tầng kiến trúc rõ ràng, an toàn tách bạch tuyệt đối, và trải nghiệm chuyên nghiệp cấp hệ sinh thái tự động hóa công nghệ cao.**

Yêu cầu chốt từ người dùng + đặc tả:

1. **Khách hàng đích:** công ty sản xuất công nghệ cao cỡ Foxconn/Samsung — nghĩa là: nói được ngôn ngữ đấu thầu của họ (IEC 62443 SL2+, ISA-95/B2MML, IPC-CFX/IPC-1782 traceability, ISA-18.2 alarm KPI, ISO 23247 twin), chịu tải hàng trăm máy + hàng trăm nghìn điểm dữ liệu/giây, và có hồ sơ benchmark công bố được.
2. **1 máy → nhiều máy:** kiến trúc "gập được" — cùng một codebase chạy từ 1 IPC (Machine Edition, embedded broker, Tauri shell) đến cụm K8s HA (Site Edition); UNS là đường nâng cấp (máy join site không cài lại); license Ed25519 + feature flags theo edition; **không bao giờ dừng sản xuất vì license**.
3. **Chuyên nghiệp toàn diện:** không chỉ UI (ISA-101 high-performance HMI, alarm ISA-18.2, P95 màn hình ≤2s, virtualization) mà cả cấu trúc tầng (hợp đồng canonical versioned, plugin out-of-process, contracts-first), hiệu năng (SLO catalog đo thật + error budget), khả năng mở rộng (scale-out theo site/line, plugin SDK "thêm hãng = 1 plugin, chi phí hằng số"), chịu tải (broker cluster HA, streaming bus replay, load-test cửa release: 100k msg/s, 20k tag/gateway, soak 24h, chaos).
4. **5 bất biến xuyên tầng (từ LDS-L5, không thương lượng):** (1) An toàn độc lập phần mềm — safety-PLC là chốt cuối, không tầng nào ghi vào chức năng an toàn; (2) Mọi lệnh qua Policy (L3) rồi interlock adapter (L1); (3) Ngữ nghĩa thống nhất — một canonical model + semantic layer từ thiết bị tới báo cáo; (4) Truy vết đầu-cuối bằng correlation_id; (5) Suy giảm an toàn — mất tầng trên, tầng dưới vẫn giữ sản xuất & an toàn.

---

## 3. BẢNG SO SÁNH TỔNG HỢP 5 TẦNG

### 3.1 Ma trận trưởng thành theo thành phần spec

| Thành phần spec | Hiện trạng | Ghi chú bằng chứng chính |
|---|---|---|
| **T1** Adapter SDK (interface chuẩn) | 🟡 60% | `OtDriver` 7 method (`server/services/ot/otDriver.ts:85-94`) thiếu executeCommand/getSafetyStatus/describe; 6 driver thật (OPC UA/Modbus/S7/MC/EIP/SLMP) |
| **T1** Edge Gateway & runtime | 🟠 45% | otManager chạy **in-process server trung tâm**; store-forward WAL 24h chỉ che DB-down; không NTP/PTP; không deadband tại nguồn |
| **T1** Canonical model & Registry | 🟡 55% | Lifecycle máy có FSM; không URN, không config-drift, Event/Health chưa thành thực thể UNS |
| **T1** Protocol normalization | 🟡 55% | 6 driver thật + MTConnect + SECS/GEM framework; **CFX không boot, Hermes = 0 code, IO-Link "assumed"**; mapping là DB row không phải as-code Git |
| **T1** UNS/Sparkplug contract | 🟡 60% | **Sparkplug B trọn vẹn NBIRTH/DBIRTH/DDEATH/LWT/alias/Rebirth — ĐANG BẬT**; thiếu 6 kênh aspect, cmd_ack, retain/QoS1 |
| **T1** Command handshake & safety | 🟢 70% | Idempotency + reason codes + read-back verify + FAT-gate default-ON; thiếu SAFETY_BLOCKED nối safety-PLC, correlation_id, deadline per-cmd |
| **T2** UNS broker & topic tree | 🟠 40% | EMQX 1 node; cây `{enterprise}/{site}/...` ≠ ngữ pháp spec `syn/...` 6 aspect; không node `_line/_area/_site`; retained state chỉ trên cây legacy |
| **T2** Schema registry | 🟠 33% | Gate BACKWARD đúng nhưng **in-memory, 0 schema runtime, không validate ingest** |
| **T2** Streaming & stream processing | 🔴 27% | **Không Kafka/NATS/replay**; telemetryBus in-process; không watermark/late-data; ot_telemetry không unique key (replay nhân đôi) |
| **T2** Stores đa tầng + tiering | 🟠 40% | Timescale migrations sẵn nhưng **extension chưa cài trên server thật**; không lake Parquet; mart plain-PG; không tiering nóng/ấm/lạnh |
| **T2** Semantic layer | 🟠 42% | `oeeService`+`utils/kpi` canonical thật (honest-null, SEMI E10) nhưng **không version/lineage/API**; gộp line/site còn phân tán |
| **T2** Genealogy | 🟡 55% | **Hash-chain SHA-256 append-only + verify — vượt spec**; thiếu record lắp ghép 1-phát + search ngược carton/pallet |
| **T3** Line Controller | 🔴 ~10% | **Không FSM tuyến, không điều tiết nhịp, không Hermes**; chỉ analytics takt/starve/block + recipe-lock mức máy |
| **T3** Orchestration/Saga | 🟡 50% | FOE engine compensation/resume idempotent/sim-gate HMAC **chất lượng cao nhưng cờ OFF**; order lifecycle không có state machine, không hold/resume/cancel |
| **T3** Policy Engine | 🟠 35% | Engine pure OPA-lite tốt nhưng **default-ALLOW** (`policyEngine.ts:127`), 1 điểm cưỡng chế sau cờ OFF; **37 hardgate `role==='admin'`/19 file server** |
| **T3** QT-1..4 quy trình | 🟠 40% | QT-2 khá (quality gate + HITL); QT-3 cấp liệu ≈ 0; QT-4 chỉ có mảnh |
| **T4** Digital Twin | 🟡 55% | DES tuyến production-grade (Monte-Carlo CI95) + mirror <500ms ĐANG BẬT + replay Timescale; **fidelity = stub, không tự vô hiệu** |
| **T4** PdM | 🟠 47% | Anomaly unsupervised thật ĐANG BẬT (PatchCore/IsolationForest/CUSUM); **RUL heuristic tự khai**; không failure-mode; lead-time gate 24h |
| **T4** Vision | 🟡 60% | 9 adapter hãng + ONNX + vòng nhãn→train→gate thật; NTF heuristic; OCR không engine; DL head cờ OFF |
| **T4** MLOps | 🟡 55% | Vòng khép kín cho embedding-head (eval-gate→canary→auto-rollback); **feature store = 0 code**; không stage chuẩn; chỉ phủ 1 loại model |
| **T4** Advice API + an toàn AI | 🟡 63% | **Ranh giới advisory-only cưỡng chế code — xuất sắc, gần tuyệt đối**; hợp đồng guardrail+requires không tồn tại như dữ liệu; REST advice không có |
| **T5** Control Tower & HMI | 🟡 65% | Factory Command View + 7 persona landing + App Launcher; thiếu Line View, e-SOP viewer; 152 chỗ hardcode màu; alert không impact-sort/dedup |
| **T5** BFF & manual-qua-Policy | 🟢 79% | Đường lệnh 1-cửa 9-gate không cửa hậu (có test chặn); thiếu BFF overview + httpBatchLink |
| **T5** Enterprise integration | 🟡 58% | B2MML intake + outbox circuit-breaker/dead-letter **đúng sách nhưng toàn cờ OFF, chưa nối hệ thật**; WMS/PLM/CMMS = 0 |
| **T5** Security cắt ngang | 🟠 50% | 2FA + WORM + device PKI + SPIFFE-lite **có code nhưng OFF/chưa wire**; không secret manager/SIEM/SAML/IR-runbook; ~77 hardgate admin (server+client) |
| **T5** Observability cắt ngang | 🟠 50% | SLO catalog + burn-rate thật nhưng **master flag OFF**; correlation_id không chảy (command_log/genealogy không có cột); không DORA |

### 3.2 Chủ đề hệ thống (cross-cutting themes)

1. **"Xây rồi nhưng chưa bật/chưa nối"** — mẫu số chung lớn nhất: OT gateway, UNS mapping, FOE, policy gate, device PKI, SPIFFE, observability master flag, step-up 2FA, WORM cutover, ERP flags... → một "chiến dịch kích hoạt" có kiểm soát đáng giá hơn nhiều tháng code mới.
2. **Hợp đồng dữ liệu chưa thành "luật"** — schema registry không cưỡng chế, metric không có definition_version, Advice không mang guardrail/requires, correlation_id không persist → mọi thứ đúng-do-kỷ-luật thay vì đúng-do-hợp-đồng. SYNAPSE đòi ngược lại.
3. **Điều phối lệch trọng tâm** — hệ mạnh về *ra lệnh an toàn xuống 1 thiết bị* (dispatcher xuất sắc) nhưng yếu về *điều phối 1 tuyến/1 đơn hàng* (không Line Controller, order tĩnh). Đây là chỗ SYNAPSE khác biệt với "phần mềm quản lý máy".
4. **Monolith Node + Postgres đơn node** — chưa có đường scale-out thật (broker đơn, không streaming bus, app đơn, DB đơn); kiến trúc "gập được" mới chỉ có chiều "gập xuống", chưa có chiều "mở lên".
5. **Kỷ luật engineering là tài sản** — honest-null/honest degradation, append-only ledger, fail-closed, flag-OFF-mặc-định, test chặn cửa hậu: giữ nguyên văn hóa này khi nâng cấp.

---

## 4. TẦNG 1 — KẾT NỐI & TRỪU TƯỢNG THIẾT BỊ (59 → ≥95)

### 4.1 Điểm theo rubric

| Hạng mục | Max | Điểm | Lý do trừ chính |
|---|---:|---:|---|
| Adapter & SDK | 20 | 12 | Thiếu executeCommand/getSafetyStatus/describe; HW-validated ≈ 0; `OT_GATEWAY_ENABLED` OFF prod |
| Gateway & edge-autonomy | 15 | 7 | In-process; store-forward chỉ che DB-down; không NTP/PTP; không container/GitOps |
| Canonical model & Registry | 15 | 9 | Không URN/config-drift; Event/Health chưa lên UNS; registry-API external thiếu |
| Protocol normalization | 15 | 10 | CFX không boot, Hermes=0, IO-Link assumed; mapping không as-code |
| UNS/Sparkplug contract | 10 | 6 | Thiếu 6 aspect, cmd_ack, retain/QoS1 |
| Command handshake & safety | 10 | 7 | Thiếu SAFETY_BLOCKED, correlation_id, deadline, per-asset queue |
| Security biên (mTLS/PKI) | 7 | 4 | PKI thật nhưng OFF, chưa cắm transport |
| Observability/SLO | 8 | 4 | SLI proxy HTTP; chưa benchmark 20k tag |

### 4.2 Chuẩn thị trường & bài học (nguồn Phụ lục C)

- **Driver là sản phẩm, không phải code tích hợp**: Kepware 150+ driver SKU độc lập; Litmus 250+ auto-discovery → cần driver SDK + registry + versioning tách vòng đời driver khỏi platform (đã có mầm `pluginDriverBridge`).
- **Store-and-forward là mặc định**: Ignition Edge kèm 35 ngày buffer cục bộ. Chuẩn: buffer đĩa cấu hình được + replay đúng thứ tự + sống qua restart, **tại biên** (không chỉ che DB-down server).
- **Fleet rollout kiểu Greengrass**: deploy theo vòng canary→ring→fleet, abort criteria theo % fail, rollback tự động; Siemens IE: app ký số + kiểm định.
- **X.509 per-device từ lúc onboard** (AWS IoT/Siemens IE) — ta đã có CA nội bộ + SPIFFE-lite, chỉ thiếu cắm vào transport.
- **Giá theo gateway/node, unlimited tags** (Ignition Edge $945 perpetual/gateway) — không phạt khách vì thêm tag.

**Checklist "95/100" theo chuẩn thị trường:** driver SDK + registry (thêm driver không rebuild); protocol phủ ≥90% máy khách (OPC UA/Modbus/S7/EIP/FINS/MELSEC/MTConnect/SECS-GEM/**CFX/Hermes** cho điện tử); store-and-forward tại biên ≥7-35 ngày; fleet deploy có vòng + abort + rollback; X.509/gateway + rotation + artifact ký số; config-as-code GitOps; **benchmark công bố ≥10k-50k tag/gateway**; onboarding giờ-không-phải-tuần.

### 4.3 Gap list → ≥95 (22 mục, đánh số G1.x)

**Phần mềm thuần (→ ~85-88):**
- G1.1 (M) Mở rộng `OtDriver` → `DeviceAdapter` đủ hợp đồng: `executeCommand(Command):CommandAck` verb-level, `getSafetyStatus()` RO ủy quyền safetyPlcAdapter, `describe():AssetDescriptor` từ capabilityModel.
- G1.2 (S) Boot-wire CFX client + cờ `CFX_ENABLED`.
- G1.3 (M) Viết **Hermes IPC-9852 adapter** (TCP/XML, observe-only BoardAvailable/MachineReady → handover event).
- G1.4 (M) Deadband/sampling per-tag tại nguồn (`device_tags` + lọc trong otManager).
- G1.5 (M) 6 kênh aspect UNS: `state` (retain QoS1), `events`, `health`, `cmd_ack` trên cây `syn/`; QoS theo bảng spec §9.3.
- G1.6 (S) Publish `cmd_ack` sau dispatch mang command_id/correlation.
- G1.7 (S) `correlationId` + `deadlineMs` per-command vào command_log; quá deadline → TIMEOUT.
- G1.8 (M) Wire **SAFETY_BLOCKED**: dispatcher đọc safety-PLC snapshot trước real-write.
- G1.9 (S) Per-asset command serialization (queue khóa theo adapterId).
- G1.10 (M) Asset URN `urn:syn:asset:{site}:{line}:{cell}:{equipment}` + path ISA-95 materialized; lifecycle thêm REGISTERED/FAULTED.
- G1.11 (M) Config-drift detection (hash cấu hình đang chạy vs bản duyệt + cảnh báo).
- G1.12 (M) Control-plane REST `/v1/assets` (CRUD + lifecycle + tags + health + adapters/restart + gateways/status).
- G1.13 (M) **Mapping-as-code**: export/import uns_tag_mappings + device_tags ↔ YAML versioned Git, có review/version/rollback.
- G1.14 (L) **Tách edge gateway process thật** (container chạy otManager + storeForward tại biên, đăng ký edge_node, đệm ≥24h khi mất trung tâm, GitOps config) — gap kiến trúc lớn nhất T1, đồng thời là điều kiện Machine Edition.
- G1.15 (S) Giám sát clock-drift edge-vs-server (tiền đề NTP/PTP).
- G1.16 (M) SLI thật: đo tag→UNS latency + cmd→ack latency từ command_log; hạ dispatch SLO 500→300ms.
- G1.17 (M) Cắm device-PKI vào transport: MQTT mTLS client-cert với EMQX + OPC UA Sign&Encrypt; bật enforcement.
- G1.18 (S) Bật `OT_GATEWAY_ENABLED` + `UNS_MAPPING_ENABLED` staging + smoke sim:factory.
- G1.19 (M) Benchmark ≥20k tag/gateway bằng Full-Sim (doc 40) + ghi vào SLO, công bố số.

**Cần phần cứng/nhà máy (→ ≥95):**
- G1.20 (L·HW) HW-validation từng driver với PLC thật + FAT ký commissioning_records.
- G1.21 (L·HW) IO-Link IODD thật; SECS/GEM + CFX với máy SMT thật.
- G1.22 (M·HW) Safety-PLC thật (Pilz/Sick) cho safetyPlcAdapter.

**Điểm mạnh giữ nguyên:** commandDispatcher 1-cửa strengthen-only; Sparkplug B stack thuần-hàm đang bật; văn hóa HONESTY; telemetry bus canonical duy nhất; store-forward WAL idempotent + ConnectionSupervisor hot-standby; PKI tự chủ node:crypto; breadth giao thức vượt spec (MTConnect/SECS-GEM/VDA5050/FOCAS/Euromap/ROS2).

---

## 5. TẦNG 2 — UNIFIED NAMESPACE & DỮ LIỆU (39 → ≥95)

### 5.1 Điểm theo rubric

| Hạng mục | Max | Điểm | Lý do trừ chính |
|---|---:|---:|---|
| UNS broker & topic tree | 15 | 6 | Sai ngữ pháp cây; không `_line/_area/_site`; không retained state UNS; broker đơn; cờ OFF |
| Schema registry & governance | 12 | 4 | In-memory, 0 schema runtime, không validate/cách ly ingest |
| Streaming & stream processing | 15 | 4 | Không Kafka/replay; không watermark; ingest không idempotent |
| Stores đa tầng + tiering | 15 | 6 | Timescale chưa active prod; không lake; không tiering |
| Semantic layer | 12 | 5 | Không version/lineage/API; gộp line/site phân tán |
| Access APIs & subscription | 12 | 5 | Thiếu 6/7 endpoint spec; WS không snapshot+stream |
| Genealogy & lineage | 9 | 5 | Hash-chain tốt; thiếu record lắp ghép + search ngược |
| HA/DR & SLO | 10 | 4 | SPOF broker/app; không DR/backup-test; xa 100k pts/s |

### 5.2 Chuẩn thị trường & bài học

- **Sparkplug Aware broker**: lưu BIRTH và phát lại trên `$sparkplug/certificates/#` retained để late-joiner dựng lại namespace — HiveMQ/EMQX chuẩn hóa.
- **HA masterless / core-replicant**: EMQX 5 = 3 core + N replicant (100M kết nối/cluster 23 node [vendor]); HiveMQ masterless 40 node, 1M msg/s. Rolling upgrade zero-downtime.
- **Schema/data contract ngay tại broker** (HiveMQ Data Hub, HighByte Namespaces) — mọi topic có schema + compatibility mode, không đợi tới DB.
- **Kiến trúc 2 tốc độ**: MQTT cho OT, Kafka cho log doanh nghiệp + replay (BMW/Tesla trên Confluent). Đừng bắt MQTT làm event log; đừng bắt Kafka nói chuyện PLC.
- **ISA-95 Part 2 + IPC-CFX/IPC-1782 traceability** là ngôn ngữ bán vào Foxconn/Samsung (Opcenter genealogy tới component-level).
- **Telemetry store**: Timescale ~1-2M điểm/s batch (thắng ở streaming insert); ClickHouse 2-4M rows/s batch lớn + aggregation nhanh 6-7x (nguồn thiên vị, đã đối chiếu 3 nguồn) — Timescale trước, ClickHouse khi volume vượt.
- **Đáng tích hợp thay vì tự xây**: Eclipse Tahu (Sparkplug, EPL-2.0), Kafka (Apache-2.0) + Karapace schema registry (Apache-2.0), NATS JetStream (Apache-2.0, nhẹ hơn giai đoạn đầu — đúng khuyến nghị DEVPLAN), AsyncAPI (đã có mầm), MinIO/Parquet cho lake. ⚠️ EMQX ≥5.9 chuyển BSL 1.1 (single-node free, cluster trả phí) — cân nhắc khi đóng gói bán lại.

**Checklist "95/100":** broker HA ≥3 node + session persistence + rolling upgrade; Sparkplug Aware; mọi topic có schema đăng ký + compat check; bridge edge→core store-and-forward; genealogy 2 chiều (forward/backward trace) trong giây, mức truy vết IPC-1782 khai báo; ingest bền vững ≥100k-1M điểm/s/node **có đo công bố**; nén ≥10x + downsampling/CAgg + tiered storage; benchmark tải nội bộ công bố kiểu HiveMQ/EMQX report.

### 5.3 Gap list → ≥95 (nhóm A-H, 21 mục)

**A — UNS đúng chuẩn (+9đ):** G2.1 (M) cây `syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}`, line từ master-data `production_lines` thay vì suy từ workshop; G2.2 (M) retained `.../state` + health; G2.3 (M) job phái sinh phát `_line/_area/_site` (OEE tạm/throughput/tỉ lệ lỗi); G2.4 (M·hạ tầng) EMQX cluster ≥2-3 node + bridge site→core, thu hẹp aedes thành edge-listener.

**B — Schema registry cưỡng chế (+7đ):** G2.5 (S) persist registry vào Postgres + seed schema canonical từ Git (`canonical/*.schema.json`) + CI compat gate; G2.6 (M) validate tại ingest (mqttService + telemetryBus) + quarantine message sai + cảnh báo.

**C — Streaming bus (+10đ, nặng nhất):** G2.7 (L·hạ tầng) NATS JetStream (trước) / Kafka (khi scale) làm durable log, MQTT bridge vào, consumer group → replay/reprocessing; G2.8 (M) stream processor: enrich asset (line/product/ca) tại stream, windowing event-time + watermark, phát `_line`, cờ `corrected` khi backfill; G2.9 (S) unique `(deviceId, metric, ts[, seq])` trên ot_telemetry.

**D — Stores + tiering (+8đ):** G2.10 (S·owner) cài timescaledb trên server thật + re-apply 0172/0173/0234/0235 (hypertable+compression+CAgg active); G2.11 (L·hạ tầng) lake Parquet (MinIO) từ streaming bus + tiering nóng→ấm→lạnh; G2.12 (M) state store path-addressable (Redis hash theo path UNS) phục vụ đọc ≤100ms; G2.13 (M·tùy chọn) ClickHouse khi volume vượt plain-PG.

**E — Semantic layer (+6đ):** G2.14 (M) **metric registry as-code** (Git, versioned): OEE/FPY/throughput/DPMO trỏ về oeeService/utils-kpi; MetricResult trả `definition_version` + parts; buộc warRoom/factoryCommand/federation/commandCenter gọi qua registry; G2.15 (S) lineage khai báo metric→bảng/tag nguồn, expose API.

**F — Access APIs (+6đ):** G2.16 (M) bề mặt v1 đủ: `/v1/state/{path}`, `/v1/query/timeseries` (range/agg/bucket), `/v1/events`, `/v1/metrics/{metric}`, `/v1/genealogy/{unit}` + `/search`; sửa `/equipment/:id/telemetry` đang bỏ qua from/to (`server/api/v1/router.ts:178-190`); G2.17 (M) WS snapshot-then-stream + filter path/aspect/severity server-side + heartbeat + backpressure.

**G — Genealogy (+3đ):** G2.18 (M) API lắp ghép GenealogyRecord đầy đủ (steps+materials+carton/pallet) + search ngược.

**H — HA/DR/SLO (+6đ):** G2.19 (M·hạ tầng) PG streaming replica (seam `getReadDb` sẵn) + backup định kỳ + test khôi phục + RPO/RTO văn bản; G2.20 (M) SLI thật ingest→queryable / state-read / push (thay proxy HTTP) + load-test/soak tới mục tiêu; G2.21 (S) bật cờ đã xây khi hạ tầng sẵn (UNS_BRIDGE/SPARKPLUG/TELEMETRY_BATCH/OT_STORE_FORWARD/REPORTING_MART/OBSERVABILITY).

> **Lưu ý trần điểm:** không có hạ tầng mới (bus, object store, cluster, Timescale cutover, replica) thì T2 kịch trần ~70.

**Điểm mạnh giữ nguyên:** Sparkplug lifecycle hiếm thấy; genealogy hash-chain vượt spec; telemetry bus + store-forward 2 tầng; KPI canonical kỷ luật; Timescale/mart chuẩn bị bài bản chờ cutover; hạt giống governance (schema-compat gate, AsyncAPI, SLO burn-rate).

---

## 6. TẦNG 3 — ĐIỀU PHỐI: LINE CONTROLLER · ORCHESTRATION · POLICY (40 → ≥95)

### 6.1 Điểm theo rubric

| Hạng mục | Max | Điểm | Lý do trừ chính |
|---|---:|---:|---|
| Line Controller | 20 | 5 | Không FSM tuyến/điều tiết nhịp/Hermes; chỉ analytics |
| Orchestration/Saga & order lifecycle | 20 | 10 | FOE Saga chất lượng cao (cờ OFF); order lifecycle không state machine |
| Policy Engine tập trung | 20 | 7.5 | **Default-ALLOW**; 1 điểm cưỡng chế sau cờ OFF; không store/API; PERMIT không audit; 37 hardgate admin |
| QT-1..4 | 15 | 6 | QT-3 ≈ 0.5; QT-4 ≈ 1 |
| AMR/fleet | 8 | 4 | Khung VDA5050+allocator+traffic đủ code; 0 HW; decomposition 1-task |
| Edge autonomy | 9 | 3 | Khung offline-buffer có; không LC-autonomy; chưa chaos-test |
| Observability | 8 | 4.5 | Correlation opt-in chưa phủ; SLO proxy HTTP 500ms ≠ spec 200ms |

### 6.2 Chuẩn thị trường & bài học

- **Durable saga = event-sourced + deterministic replay + compensation stack** (Temporal MIT — 51.200 event/50MB cap + Continue-As-New; Camunda 8.6+ đã thành source-available trả phí production → Temporal an toàn license hơn; FOE của ta đã cùng nguyên lý). Đơn vị đo throughput là *state transitions/s* (~3.4k st/s cluster nhỏ tự host).
- **Policy-as-code kiểu OPA** (Apache-2.0, CNCF graduated): policy versioned bundle, decision log audit, eval sub-ms (đo độc lập p95 0.745ms) — "verify-before-operate" phải là policy khai báo được, thay không cần deploy code.
- **PackML là interoperability rẻ nhất**: 17 states + ~14 tag tối thiểu; phân biệt **Held (lỗi nội tại) vs Suspended (đói/nghẽn ngoại tại)** là nền OEE trung thực — ta đã có model PackML thuần, cần dùng làm facade canonical mọi máy.
- **MES enforcement sống ở transaction point** (Opcenter/Plex): sai route/thiếu điều kiện = chặn cứng, không phải cảnh báo. Orchestration không có interlock chỉ là monitoring.
- **VDA 5050 base/horizon** là pattern edge-autonomy tổng quát: chỉ release phần "base" đã kiểm an toàn cho edge agent; mất kết nối → edge hoàn tất base rồi dừng ở decision point; master phát hiện qua LWT và reconcile khi nối lại. Open-RMF (Apache-2.0): deconfliction 2 lớp = schedule database (prevention) + negotiation (resolution) — map thẳng vào reservation máy/dock/lane.
- **Khoảng trống thị trường đáng khai thác:** chưa có flagship công khai nào ghép durable-saga + policy-as-code + PackML cho nhà máy — SYNAPSE làm đúng sẽ đứng trên đất trống.

**Checklist "95/100":** workflow durable crash-resume không lệnh đúp (idempotency mọi command); saga compensation khai báo + chaos "chết giữa saga" pass; policy-as-code versioned + decision log + eval <10ms + **default-deny cho actuation**; máy expose PackML facade, OEE tính từ state chuẩn; route/interlock enforcement chặn cứng; VDA 5050 ≥2.0 + mất kết nối an toàn; edge autonomy suy giảm có kiểm soát + tự đồng bộ; throughput đo được (≥vài trăm workflow instance/s) + SLO công bố.

### 6.3 Gap list → ≥95 (20 mục)

**Line Controller (+15đ — ưu tiên số 1 toàn hệ):**
- G3.1 (L) `lineControllerService` + bảng `line_states` bền: FSM 7 trạng thái IDLE/READY/PRODUCING/HELD/COMPLETING/CHANGEOVER/FAULT, transition audit, API `/v1/lines/{id}/state|stages|recipe|command` (qua Policy). Nguồn state trạm: packmlStateBridge + machine_status_logs (đã có).
- G3.2 (M) Vòng điều tiết nhịp realtime: lineBalanceMetrics/stationDwellTime → tín hiệu LC (blocking/starving → giữ/thả cấp cao qua dispatcher) + phát `_line/state` lên UNS.
- G3.3 (M) **RecipeSet cấp tuyến**: bảng recipe_sets (product@version → per-station payload), phân phối + xác nhận nạp mọi trạm trước READY + khóa suốt lô + gỡ khóa trong compensation (tái dùng machineRecipes/recipeDeployments).
- G3.4 (M) Line-readiness checklist trước READY (trạm ONLINE+IDLE, đúng recipe, feederVerify ENFORCED, safety-read OK) → không đạt = HELD kèm lý do.
- G3.5 (L·HW) Hermes observe adapter (chung G1.3) nối sự kiện bàn giao vào LC.

**Orchestration (+10đ):**
- G3.6 (M) Order lifecycle đúng spec: CREATED→ALLOCATED→RUNNING⇄HELD→DONE / COMPENSATING→FAILED / REJECTED (bảng transition riêng, không phá enum cũ) + API hold/resume/cancel/trace qua Policy + hoàn công outbound MES.
- G3.7 (M) Allocation runtime: APS draft → apply có kiểm soát; reservation mở rộng scope `line`/`material` cho order trước RUNNING, nhả trong compensation.
- G3.8 (M) Đóng gói **QT-1..QT-4 thành 4 workflow template chuẩn trên FOE** (compensation nghiệp vụ: nhả reservation, hủy AMR task, gỡ khóa recipe) — engine đủ năng lực, thiếu content.
- G3.9 (M) QT-3 end-to-end: event low-material → transport task → allocateTask → đồng bộ dock với LC.
- G3.10 (S) Task decomposition đa bước (operation→skill→program).

**Policy Engine (+12đ):**
- G3.11 (S/M) **Default-deny cho actuation/deploy**: không match allow-policy tường minh → DENY (mode switch, giữ default-allow cho action thường trong chuyển tiếp).
- G3.12 (S) Chuẩn hóa `evaluate(subject, action, resource, context)` → `PERMIT|DENY + obligations[] + reason_code + policy_ref`; **audit cả PERMIT** (WORM sẵn).
- G3.13 (M) Policy store + API `/v1/policy/evaluate|policies|audit` + sync policy-as-code từ Git (version/review/test harness).
- G3.14 (M) **Một cửa duy nhất**: cắm policy-evaluate vào robotCommandDispatcher, FOE command step, order lifecycle, vda5050 sendOrder (hiện chỉ OT dispatcher).
- G3.15 (M) Gỡ 37 hardgate `role==='admin'` server (+ client, xem G5.16) → permission/RoleBuilder (kế hoạch doc 39 đã duyệt).
- G3.16 (S) Đo policy-eval latency + SLO ≤20ms; test fail-safe DENY khi evaluator lỗi; bật SEC_PLATFORM sau canary.

**Edge (+5đ):** G3.17 (L) LC-at-edge degraded mode (tiếp tục lô theo recipe khóa / từ chối đơn mới / HELD khi bất định / đệm genealogy + resync — áp pattern base/horizon); G3.18 (M) buffer bền (SQLite/WAL) + chaos-test mất kết nối.

**Observability (+3.5đ):** G3.19 (M) correlationId persist vào commandLog/robot_jobs/tasks + trace order→task→command trong Control Tower; G3.20 (S/M) instrument event→lệnh thật, SLO 500→200ms, thêm metric DENY-rate/lead-time/exception-rate.

**Điểm mạnh giữ nguyên:** FOE Saga (compensation/resume/sim-gate HMAC) hiếm có; chuỗi phòng thủ lệnh nhiều lớp fail-closed; role-floor + 2FA + step-up tập trung; reservation race-safe + space-time A* + charging planner; decision-trace + RL shadow.

---

## 7. TẦNG 4 — TRÍ TUỆ: TWIN · AI/ML · MLOPS (56 → ≥95)

### 7.1 Điểm theo rubric

| Hạng mục | Max | Điểm | Lý do trừ chính |
|---|---:|---:|---|
| Digital Twin | 20 | 11 | **Fidelity stub + không tự vô hiệu + sync không đo**; thiết bị thiếu hao mòn; nhà máy chưa ghép |
| PdM | 15 | 7 | RUL heuristic; failure-mode = 0; lead-time gate 24h |
| Vision | 15 | 9 | NTF heuristic; OCR không engine; DL head OFF |
| Optimization | 15 | 8.5 | Setpoint vật lý không dải số học; twin-first chỉ cho điều phối |
| MLOps | 20 | 11 | **Feature store = 0 code**; không stage chuẩn; chỉ phủ 1 loại model |
| Advice API + an toàn AI | 15 | 9.5 | Ranh giới xuất sắc; hợp đồng guardrail+requires không tồn tại như dữ liệu |

### 7.2 Chuẩn thị trường & bài học

- **ISO 23247** định nghĩa twin "fit for purpose + đồng bộ 2 chiều": bán twin đúng độ trung thực theo use-case, không bán "3D đẹp"; fidelity phải đo được và có ngưỡng chấp nhận — đúng yêu cầu spec "twin không hiệu chỉnh nguy hiểm hơn không có twin".
- **Isaac Sim 5.0 đã Apache-2.0**: runtime mô phỏng không còn là moat; moat = asset/schema/connector/pipeline. OpenUSD làm định dạng trao đổi (ta đã có USD/DTDL từ doc 24).
- **Virtual commissioning bán bằng số tuần tiết kiệm** (Siemens: −30% commissioning, ~95% lỗi bắt trước hot-phase [vendor]).
- **PdM: bài học Monitron chết (hardware-bundle đóng) vs Augury/Senseye sống** (analyst xác nhận CAT III/IV + đầu ra là work-order + chạy trên cảm biến sẵn có + tùy chọn bồi thường) — đúng mô hình advisory + WO ta đã có; thiếu phần "học thật" (RUL/failure-mode).
- **Vision: Cognex edge learning 5-10 ảnh/lớp vài phút không code** — chuẩn time-to-value; Instrumental "phát hiện lỗi chưa biết với ~5 unit" — anomaly-first (PatchCore của ta cùng hướng).
- **MLOps chuẩn**: registry trung tâm + stage; **shadow → champion/challenger → canary là quy trình, không phải tính năng**; drift nối alerting; ISO/IEC 42001 chứng nhận *quy trình tổ chức*; **EU AI Act Omnibus 2026 đã hoãn high-risk sang 12/2027 và loại "AI cho user assistance/tối ưu/quality control" khỏi safety component** — hợp thức hóa đúng kiến trúc advisory-only ta đang có.
- **OSS đáng tích hợp:** MLflow/Feast/Evidently/KServe/ONNX (đều Apache-2.0/MIT), Anomalib (Intel, Apache-2.0), PaddleOCR/RapidOCR cho OCR engine.

**Checklist "95/100":** twin theo ISO 23247 + fidelity validate sim-vs-real có ngưỡng; VC loop kín (SIL/HIL trước máy thật) gắn NPI/MOC; 60fps@hàng trăm máy; registry + lineage + model card mọi model; shadow bắt buộc trước promote + canary rollback 1-nút; drift (data+concept) nối alert; mọi khuyến nghị ảnh hưởng vật lý qua approval gate RBAC+audit (advisory-only mặc định); explain kèm mỗi khuyến nghị; hồ sơ phân loại use-case theo EU AI Act; AIMS ISO 42001-ready.

### 7.3 Gap list → ≥95 (30 mục, nhóm)

**Twin (+8đ):**
- G4.1 (M) **Khép vòng fidelity** — gap nặng nhất tầng: job nền so sim-vs-thực (cycle/throughput từ ot_telemetry) → persist `simulation_runs{mode,scenario,result,fidelity}` → tự vô hiệu twin cho quyết định khi lệch >ngưỡng + alert; nối driftDetector vào dữ liệu thật; bật `TWIN_DRIFT`.
- G4.2 (S/M) REST Twin API `/v1/twins/{id}` (+ simulate/validate/replay, persist SimulationRun).
- G4.3 (M) VC thành gate NPI/MOC bắt buộc: bật mặc định FOE_SIM_GATE + SIM_KINEMATIC, mở rộng sang recipe deploy.
- G4.4 (S) Đo + enforce twin sync ≤1s (metric + staleness badge).
- G4.5 (L) Twin nhà máy: DES đa tuyến + conveyor transport + AMR ghép occupancy grid.
- G4.6 (M) Mô hình hao mòn thiết bị (cycle-count wear từ PdM vào twin).

**PdM (+7đ):**
- G4.7 (L·dữ-liệu) RUL học thật: survival/Weibull hoặc regressor trên lịch sử WO/failure — nghẽn ở dữ liệu hỏng thật tích lũy, không cần GPU mới.
- G4.8 (L·HW) Failure-mode classification: FFT/phổ rung + taxonomy — cần cảm biến rung.
- G4.9 (S) Nâng lead-time gate 24h → tuần (PM_TIMEFRAME_HOURS + widen horizon).
- G4.10 (S) Map torque/servo-current vào feature.
- G4.11 (S) REST `/v1/health/assets/{id}` + `/v1/predictions`.

**Vision (+5đ):** G4.12 (M) train NTF classifier từ ledger measurement_corrections (kế hoạch V2 sẵn trong code, GPU sẵn); G4.13 (M) OCR engine thật (PaddleOCR/RapidOCR ONNX) + kiểm tem/barcode; G4.14 (S) class imbalance (class-weight/oversampling); G4.15 (S/M) ngưỡng cost-sensitive theo severity; G4.16 (S) enforce SLO P95≤200ms path ONNX (loại VLM khỏi inline); G4.17 (M) RCA định lượng (hồi quy tham số công đoạn trước ↔ defect).

**Optimization (+5đ):** G4.18 (M) **bảng guardrail per-parameter (min/max) do kỹ sư nhập + clamp số học trên `set_machine_param` + policy check** — đóng đúng "chặn ở cả AI và Policy"; G4.19 (M) twin-first cho khuyến nghị ngưỡng/setpoint; G4.20 (M) closed-loop step (xác minh FPY/Cpk sau thay đổi trước bước tiếp + max-step tuyệt đối); G4.21 (S/M) forecast time-to-empty vật tư; G4.22 (S) đo SLO recommend ≤1s.

**MLOps (+8đ):** G4.23 (M/L) **feature store thật** (kích hoạt ml_feature_cache, định nghĩa feature chung train/serve, bắt đầu embedding + PdM); G4.24 (S/M) stage chuẩn staging/canary/production/retired + owner/trained_on trong ModelCard; G4.25 (M) pipeline tuần tự có cổng: shadow N-ngày → canary theo trạm/tuyến → production cần kỹ sư ký (mượn pattern 2-người robot program); G4.26 (M) đưa anomaly-bank + VLM/LLM vào vòng version/rollback; G4.27 (S) REST `/v1/models|promote|rollback|monitoring/drift`; G4.28 (S/M) concept-drift đúng nghĩa (KS-test/labeled-window).

**Advice API (+4đ):** G4.29 (M) **hợp đồng Recommendation chuẩn**: `guardrail{min,max}` + `requires:["twin_validation","policy_permit"]` vào PendingActionDTO/proposal, orchestration BẮT BUỘC kiểm trước execute (nối policyEngine vào đường khuyến nghị); G4.30 (S/M) REST `POST /v1/predict/{task}` + `/v1/recommend` (bọc advisor sẵn có).

**Điểm mạnh giữ nguyên:** ranh giới an toàn AI cưỡng chế code ở mọi đường (hiếm hệ nào triệt để bằng); honest degradation toàn tầng; DES engine production-grade; stack anomaly unsupervised đang bật live; vòng MLOps khép kín cho embedding-head; advisor thống kê thật (không LLM đoán); AI local-first trên RTX 5090 + ModelCard kiểu EU-AI-Act.

---

## 8. TẦNG 5 — ỨNG DỤNG & CẮT NGANG (60 → ≥95)

### 8.1 Điểm theo rubric

| Hạng mục | Max | Điểm | Lý do trừ chính |
|---|---:|---:|---|
| Control Tower & role-based HMI | 20 | 13 | Không Line View; alert không impact-sort/dedup; 152 hardcode màu; thiếu e-SOP viewer |
| BFF & manual-qua-Policy | 12 | 9.5 | Không BFF overview + httpLink không batch; 403 reason bị làm phẳng |
| e-SOP/Andon/escalation | 12 | 8 | e-SOP không DB/version/viewer; severity phân mảnh 3/4/5 thang |
| Enterprise integration ISA-95 | 12 | 7 | WMS/PLM/CMMS = 0; toàn cờ OFF chưa nối hệ thật |
| Security cắt ngang | 20 | 10 | mTLS/workload-identity OFF chưa wire; WORM advisory; không secret manager/SIEM/IR/zone-conduit; ~77 hardgate |
| Observability cắt ngang | 16 | 8 | Master flag OFF; correlation không chảy L5→L1; không DORA/shadow-canary app |
| UI professional & hiệu năng | 8 | 4.5 | Virtualization = 0; không đo P95 màn hình; sprawl 194 trang |

### 8.2 Chuẩn thị trường & bài học

- **Licensing "per-server unlimited" của Ignition là vũ khí phá thị trường** (giá công khai, không phạt tag/client) + **AVEVA Flex credits** cho module cao cấp — mô hình đáng học cho 3 edition SYNAPSE.
- **ISA-101 high-performance HMI**: nền xám, màu chỉ dành cho bất thường, 4 cấp màn hình, analog-first — không phải "dashboard đẹp". ASM: +38% khả năng phát hiện tình huống bất thường.
- **ISA-18.2 alarm KPI** phải thành dashboard sản phẩm: ~6 alarm/giờ/operator (max ~12), flood = >10 alarm/10 phút, <5 standing alarms, phân bố ưu tiên ~80/15/5.
- **Security:** IEC 62443 là ngôn ngữ đấu thầu — target **SL2 tối thiểu** + lộ trình 62443-4-1 SDL; NIST SP 800-82r3 zero-trust OT; **EU CRA**: hiệu lực 12/2024, báo cáo lỗ hổng 24h từ 9/2026, tuân thủ đầy đủ 12/2027, phạt tới €15M/2.5% doanh thu → **SBOM + ký cosign mỗi release là nghĩa vụ pháp lý**; secrets: **OpenBao (MPL-2.0)** thay Vault (BUSL).
- **Observability/GitOps:** OTel chuẩn instrument; k3s + ArgoCD ApplicationSets cho fleet edge; rollback 1-nút là tính năng bán hàng; tách telemetry quy trình khỏi observability nền tảng.
- ⚠️ Grafana/Loki là AGPL-v3 — cẩn trọng khi nhúng bán lại (ECharts Apache-2.0 thay thế phía UI sản phẩm).

**Checklist "95/100":** ISA-101 style guide + 4 cấp màn hình; alarm rationalization + KPI ISA-18.2 live trong sản phẩm; andon SLA escalation; zero-install web + mobile, màn hình <2s, offline resilience; RBAC + SSO (AD/OIDC/SAML) + i18n + multi-site 1 shell; khách tự dựng màn hình (no-code); licensing công khai không phạt tag; SL-T công bố theo zone (≥SL2) + SDL 62443-4-1 + PSIRT; identity per device/service, secrets tập trung + rotation; SBOM+cosign mọi release + verify tại edge; SLO công bố + error budget; GitOps declarative + canary + rollback; log/trace correlation tới từng lệnh.

### 8.3 Gap list → ≥95 (26 mục)

**Quick-win (S):** G5.1 bật master OBSERVABILITY + cài OTel deps + Prometheus rules/Alertmanager; G5.2 (owner) cutover DATABASE_URL → role `avi_app` (WORM enforced) + bật ACTUATION_STEPUP_2FA + TENANT_RLS; G5.3 httpBatchLink hoặc endpoint `ui.overview` hợp nhất; G5.4 component `ConfirmWithReason` generic + surface reason_code 403; G5.5 cột runbook_ref/recommendation_ref trên alert; G5.6 cột external_id/source_system cho production_orders + bảng mapping ID; G5.7 bật CSP + CSRF; SBOM-CVE từ advisory→blocking + SAST (CodeQL/semgrep) + gitleaks; G5.8 backup keystore/ENV secrets; G5.9 web-vitals RUM → metrics + SLO "screen-load p95 ≤2s" / "policy ≤20ms" / "state-read ≤100ms".

**Trung bình (M):** G5.10 **Line View** màn riêng (sơ đồ tuyến, nhịp, nút cổ chai, WIP) nối drill Factory→Line→Machine (đồng bộ với Line Controller G3.1); G5.11 impact-based alert priority + dedup/fingerprint/gộp; G5.12 mapper màu canonical PackML 1 nguồn + codemod 152 chỗ/36 trang; G5.13 WS "snapshot-on-subscribe + delta" cho mọi màn monitoring (bỏ polling 5s); G5.14 **e-SOP thật**: bảng sop/sop_steps/checklist versioned + viewer operator + gate hợp nhất readiness (feeder+MSD+handover+clock-in+e-SOP); G5.15 chuẩn hóa 1 thang severity info/warning/error/critical toàn hệ (andon/mqtt/central/mobile); G5.16 xóa ~77 hardgate `role==='admin'` client+server → permission-bit/RoleBuilder; G5.17 correlation middleware HTTP→ALS + cột correlation_id vào command_log + genealogy_chain + pino mixin (điều kiện "nút bấm→máy"); G5.18 SIEM forward (syslog/webhook) + anomalous-login detection + IR runbook + sơ đồ zone/conduit 62443; G5.19 SAML/enterprise IdP; G5.20 DORA metrics từ CI/CD; G5.21 virtualization (@tanstack/react-virtual) cho DataTable/list lớn.

**Lớn (L):** G5.22 wire device PKI/mTLS vào MQTT broker (requestCert+CA) + adapter OT + SERVICE_MTLS service-to-service (chung G1.17); G5.23 secret manager thật (OpenBao/KMS) + rotation; G5.24 connector WMS/PLM/CMMS + provider reconciliation thật + bật ERP flags với endpoint thật; G5.25 shadow→canary→production cho app (hiện chỉ có cho AI model/fleet); G5.26 hợp nhất surface 194 trang → hub (lộ trình doc 39) + thực thi kế hoạch doc 42 (UPDATE master-data + SQL leak toast).

**Điểm mạnh giữ nguyên:** đường lệnh 1-cửa 9-gate có test chặn cửa hậu (hơn phần lớn hệ thương mại); audit hash-chain + WORM + 3 trang tra cứu; Andon/escalation/MTTA-MTTR production-grade + mobile RN 24/7; outbox tự chủ khi MES chết; role-based HMI 7 persona + i18n vi/en/zh sâu; UX suy giảm trung thực; kỷ luật feature-flag + trang Readiness.

---

## 9. KIẾN TRÚC THƯƠNG MẠI & NỀN TẢNG (điều kiện "1 máy → nhiều máy")

Từ KE-HOACH-PHAT-TRIEN (đã có thiết kế, phần lớn chưa hiện thực trong codebase này):

| Trụ | Nội dung | Hiện trạng codebase | Việc phải làm |
|---|---|---|---|
| **3 edition** | Machine (1 IPC, OEM perpetual) / Line (≤10-20 thiết bị, subscription) / Site (K8s HA) | License service Ed25519 + module flags ĐÃ CÓ (doc 33/38: module-gate, license.activate đã đóng public) | Ma trận edition→flags chính thức; đo hạn mức theo Asset Registry; **grace 30 ngày — không bao giờ dừng sản xuất vì license**; tín dụng nâng cấp |
| **Kiến trúc gập được (ADR-007)** | 1 codebase chạy từ 1 IPC đến cụm K8s; không service nào giả định Kafka/K8s luôn tồn tại | Monolith Node hiện *chỉ có* dạng single-node; các seam (Redis fanout, getReadDb, TSDB degrade) đã có | Compose profile single-node chính thức + CI E2E chạy **cả 2 profile** (chống edition drift); embedded broker cho Machine Edition; NATS/Kafka là tùy chọn theo profile |
| **UNS là đường nâng cấp** | Machine Edition phát đúng cây `syn/` cục bộ; join site = bridge broker, không cài lại | unsBridge/unsSubscriber (federation doc 13) đã có mầm | Join wizard (mDNS discovery) + bridge cục bộ→site + kiểm thử "2 máy join 1 site không cài lại" |
| **Plugin out-of-process (ADR-008)** | plugin.yaml manifest + apiVersion range + ký Ed25519 + conformance suite + quota | pluginDriverBridge sidecar + plugin signature đã có mầm | Manifest chuẩn + conformance suite tự động (kết nối/mất mạng/store-forward/quota/ACL) + `synapse plugin new` template; KPI time-to-first-plugin ≤1 ngày |
| **Web-first + Tauri (ADR-006)** | 1 codebase React → browser + PWA kiosk + Tauri shell | React app đủ mạnh; PWA manifest có; Tauri chưa có | Tauri 2 shell cho Machine Edition (fullscreen kiosk, auto-start, offline, license máy) — doc 37 đã ghi nhận chờ toolchain |
| **Load-test cửa release** | UNS 100k msg/s P99≤250ms; dispatch P95≤500ms; 60 robot/zone 24h không deadlock; chaos suite | Full-Sim Mode (6 simulator + sim:factory) đã có (doc 40/41) | Nâng thành bộ kiểm định release-gate + công bố số benchmark |

---

## 10. KẾ HOẠCH NÂNG CẤP TOÀN DIỆN — 8 ĐỢT (SYN-W0 → SYN-W7)

Nguyên tắc: (1) giữ green-gate tsc+build+test mỗi đợt, cờ mới OFF→bật theo canary; (2) "bật & nối" trước "xây mới"; (3) hợp đồng (schema/API/policy) đi trước hiện thực; (4) mỗi đợt có tiêu chí nghiệm thu đo được; (5) không phá tương thích client máy trạm đang chạy (dual-publish khi đổi wire protocol).

### SYN-W0 — Quyết định + Kích hoạt + Hạ tầng nền (1-2 tuần, phần lớn là owner/ops)
- Chốt 4 quyết định §12.
- **Owner/hạ tầng:** cài timescaledb + re-apply 0172/0173/0234/0235 (G2.10); EMQX cluster ≥2-3 node (G2.4); NATS JetStream (G2.7 bước 1); PG replica + backup/DR test (G2.19); cutover DATABASE_URL→avi_app (G5.2); OpenBao dựng (G5.23 bước 1).
- **Bật cờ đã xây (staging→canary→prod):** OBSERVABILITY (G5.1), OT_GATEWAY+UNS_MAPPING staging (G1.18), UNS_BRIDGE/SPARKPLUG/TELEMETRY_BATCH/OT_STORE_FORWARD/REPORTING_MART (G2.21), ACTUATION_STEPUP_2FA + TENANT_RLS (G5.2).
- Quick-wins S: G1.2 (CFX boot), G1.6/G1.7, G2.5, G2.9, G4.4, G4.9-G4.11, G5.3-G5.9.
- **Nghiệm thu:** Timescale active (db_feature_status='ok'); broker cluster failover test; SLO evaluator chạy; WORM enforced; mọi quick-win merge green.

### SYN-W1 — Rebrand SYNAPSE đợt 1+2 (song song W0, ~1 tuần)
- Theo §11: cosmetic (brand.ts, index.html, manifest, i18n, PDF/email/AI-prompt) + code identifiers (package.json, VITE_APP_ID, LICENSE_PRODUCT_CODE dual-accept, script đóng gói, Grafana dashboard).
- **Nghiệm thu:** không còn "AVI/AOI" ở bất kỳ surface user-facing nào (trừ thuật ngữ loại máy); build + smoke UI + xuất 1 PDF + đóng gói offline thử.

### SYN-W2 — Hợp đồng & xương sống dữ liệu (L1+L2 core, ~3-4 tuần)
- Cây `syn/` 6 aspect + retained state + `_line/_area/_site` + QoS đúng (G1.5, G2.1-G2.3); cmd_ack (G1.6 hoàn tất).
- DeviceAdapter contract mở rộng (G1.1); deadband per-tag (G1.4); URN + lifecycle đủ (G1.10); mapping-as-code YAML/Git (G1.13); config-drift (G1.11); control-plane /v1/assets (G1.12).
- Schema registry persist + validate ingest + quarantine (G2.5-G2.6); semantic layer registry + definition_version + lineage (G2.14-G2.15); state store path-addressable (G2.12); Access APIs v1 đủ + WS snapshot-then-stream (G2.16-G2.17); genealogy record + search ngược (G2.18).
- Correlation xuyên tầng: middleware + cột persist (G3.19, G5.17).
- **Nghiệm thu:** 1 message sai schema bị quarantine + alert; `GET /v1/state/{path}` ≤100ms; OEE mọi màn trả cùng số + definition_version; trace 1 nút bấm → policy → command → ack bằng đúng 1 correlation_id.

### SYN-W3 — Điều phối đúng nghĩa (L3, ~4-6 tuần — ưu tiên cao nhất về giá trị)
- **Line Controller** (G3.1-G3.4) + Line View UI (G5.10) + phát `_line/state`.
- Policy: default-deny actuation + evaluate chuẩn + store/API + một-cửa mọi dispatcher + audit PERMIT + SLO 20ms (G3.11-G3.16).
- Order lifecycle + allocation/reservation + QT1-4 templates trên FOE + QT-3 end-to-end (G3.6-G3.10).
- SAFETY_BLOCKED wire + per-asset queue (G1.8, G1.9).
- **Nghiệm thu:** demo xuyên tầng "đơn hàng MES → allocate → LC readiness → PRODUCING → quality-gate HELD → resume → DONE + genealogy + hoàn công" trên Full-Sim; chaos "kill orchestrator giữa saga" → compensation đúng; lệnh không match policy → DENY + audit; PE eval p95 <20ms.

### SYN-W4 — Streaming & lưu trữ đa tầng (L2 heavy, ~4-6 tuần, cần hạ tầng W0)
- Bridge MQTT→NATS/Kafka + consumer groups + replay (G2.7); stream processor enrich/window/watermark/`corrected` (G2.8); lake Parquet MinIO + tiering (G2.11); ClickHouse nếu volume đòi (G2.13).
- SLI thật ingest→queryable + load-test 100k điểm/s + soak (G2.20, G1.19).
- **Nghiệm thu:** replay 1 giờ dữ liệu không nhân đôi (idempotent key); backfill store-forward tạo metric `corrected`; benchmark công bố nội bộ (điểm/s, P95).

### SYN-W5 — Trí tuệ production-grade (L4, ~4-6 tuần)
- Fidelity loop + simulation_runs + tự vô hiệu (G4.1); VC gate NPI mặc định (G4.3); Twin API (G4.2).
- Guardrail table per-parameter + clamp + policy (G4.18); twin-first cho setpoint (G4.19); closed-loop step (G4.20).
- **Hợp đồng Recommendation guardrail+requires + policy gate trên đường khuyến nghị** (G4.29); REST advice/models/twins (G4.30, G4.27, G4.11).
- Feature store activation (G4.23); stage chuẩn + shadow-cổng-N-ngày + production-2-người (G4.24-G4.25); mở rộng vòng rollback (G4.26); concept-drift (G4.28).
- Vision: NTF classifier + OCR engine + imbalance + cost-sensitive + SLO 200ms (G4.12-G4.16); RCA định lượng (G4.17); bật `AOI_DL_HEAD` canary.
- **Nghiệm thu:** twin lệch >ngưỡng tự gắn "không đáng tin" + chặn dùng cho quyết định; 1 khuyến nghị thiếu `policy_permit` bị chặn execute; model mới bắt buộc qua shadow→canary trước production; số false-call giảm đo được trên tập verify.

### SYN-W6 — Trải nghiệm & an ninh chuyên nghiệp (L5, ~4-6 tuần)
- HMI: mapper màu canonical + ISA-101 pass (G5.12); impact-alert + dedup + **dashboard KPI ISA-18.2** (G5.11); WS chuẩn mọi màn (G5.13); e-SOP đầy đủ + readiness hợp nhất (G5.14); severity 1 thang (G5.15); virtualization (G5.21); surface consolidation + doc 42 fixes (G5.26).
- Security: device-PKI/mTLS wire (G5.22/G1.17); OpenBao rotation (G5.23); SIEM + IR + zone/conduit (G5.18); SAML (G5.19); gỡ hardgate admin (G5.16/G3.15); SAST/cosign blocking (G5.7 hoàn tất).
- Enterprise: connector WMS/PLM/CMMS + reconciliation provider thật + bật ERP flags (G5.24).
- Observability: DORA (G5.20); shadow→canary app (G5.25).
- **Nghiệm thu:** KPI alarm/giờ/operator hiển thị live và <12; P95 màn hình chính ≤2s đo bằng RUM; pentest nội bộ theo checklist SL2; 1 đơn hàng MES thật (hoặc mock server hợp đồng) chạy khép vòng intake→hoàn công.

### SYN-W7 — Edge, scale-out & chuẩn bị chứng nhận (~6-8 tuần, một phần phụ thuộc HW)
- **Edge gateway process thật** + GitOps + buffer biên ≥24h + clock-drift (G1.14, G1.15); LC-at-edge degraded mode + chaos (G3.17-G3.18); Hermes adapter (G1.3/G3.5).
- Editions: compose profile single-node + CI 2-profile + embedded broker + Tauri shell + join wizard (§9).
- Benchmark release-gate công bố: 20k tag/gateway, 100k msg/s P99≤250ms, soak 24h, chaos suite xanh.
- **HW/FAT track (lịch phụ thuộc nhà máy):** G1.20-G1.22 (driver/PLC/safety-PLC/SECS-GEM/CFX máy thật), G4.7-G4.8 (RUL học thật theo dữ liệu tích lũy + cảm biến rung), rebrand đợt 3 (MQTT topic dual-publish + APK rollout).
- Chuẩn bị hồ sơ: IEC 62443 SL2 gap-assessment; CRA SBOM/cosign quy trình; ISO 42001 AIMS khung.
- **Nghiệm thu ≥95:** chấm lại 5 tầng theo đúng rubric của báo cáo này + checklist 95 từng tầng (§4-8); mọi SLO trong catalog xanh 30 ngày; 2 Machine Edition join 1 Site không cài lại.

### Ước lượng tổng
- **Phần mềm thuần (W0-W6):** ~5-6 tháng lịch với đội hiện tại + agent; đưa T1→~87, T2→~85 (có hạ tầng), T3→~90, T4→~87, T5→~90.
- **W7 + HW/FAT + dữ liệu tích lũy:** +2-3 tháng lịch (song song, phụ thuộc hiện diện nhà máy) → mọi tầng ≥95.
- Phụ thuộc cứng: W2 trước W3/W4; W0 hạ tầng trước W4; fidelity (W5) cần dữ liệu chạy thật từ W3.

---

## 11. KẾ HOẠCH REBRAND AOI/AVI → SYNAPSE

### 11.1 Hiện trạng brand (kiểm kê đầy đủ bằng agent, file:line trong transcript)

- Brand token chính thức = **"Continuum"** (`client/src/config/brand.ts:29`) nhưng vỏ ngoài vẫn "AVI/AOI": `client/index.html:9` title "AVI/AOI Factory Management System", PWA manifest "AVI-AOI", `DashboardLayout.tsx:90`, i18n vài key, PDF/email templates, AI system prompts, `.env` VITE_ABOUT_*.
- `server/services/contracts/apiSpec.ts:110` đã ghi `title: "SYNAPSE REST API"` — hướng SYNAPSE đã bắt đầu.
- **Phân loại quan trọng:** ~70-80% occurrence "aoi" phía server là **thuật ngữ loại máy** (device class AOI/AVI/SPI/AXI trong `machineTypes.ts`, `enums.ts`; pipeline aoiPackage/aoiOnboarding/vision adapters; AI trên ảnh AOI; KB domain) → **GIỮ NGUYÊN**. Sau rename, chữ "AOI" còn lại trong app luôn nghĩa là LOẠI MÁY; chỉ cụm "AVI/AOI Management/System" là brand.

### 11.2 Bốn đợt rename

| Đợt | Phạm vi | Rủi ro | Effort |
|---|---|---|---|
| **R-1 Cosmetic** | brand.ts → "SYNAPSE"; index.html title + apple-title; manifest.webmanifest; DashboardLayout default; ~10-15 i18n key branding (en/vi/zh, gồm cả key "Continuum" nếu chốt thay); pdfExport/emailService/aiExecutiveReport (footer + subject `[AVI/AOI]`→`[SYNAPSE]`) + pdfTemplate/powerpoint/reportGenerator/scheduledReport; ~15 chuỗi AI system prompt; `.env.example` VITE_ABOUT_*; FactoryAlertSystem label (cần build APK mới) | Thấp | 0.5-1 ngày |
| **R-2 Code identifiers** | package.json name → `synapse`; VITE_APP_ID; LICENSE_PRODUCT_CODE (**dual-accept 2 giá trị trong grace period** — license đã cấp validate theo code cũ); Dockerfile/nssm/offline-package scripts (tên zip/service); Grafana dashboard; modules-export.json; tên repo/thư mục (tùy chọn). KHÔNG rename identifiers `aoi*` (thuật ngữ máy), KHÔNG đổi route `/aoi-*`/tRPC (client máy trạm C# đang gọi) | Vừa | 2-4 ngày |
| **R-3 Infra/wire** | MQTT topic `avi/...` → `synapse/...` bằng **dual-publish + dual-subscribe** (server phát cả 2; app mobile subscribe cả 2; máy AOI/C# giữ topic cũ đến khi nâng cấp; tắt topic cũ sau grace 2-4 tuần); EXTERNAL_MQTT_TOPIC_PREFIX, clientId, EMQX cookie, UNS enterprise/group/edge-node; rotate MASTER_API_KEY (chứa chuỗi brand — phải cấu hình lại máy). **DB name (`aoi_management`/`avi_app`/`avi_aoi_ts`): khuyến nghị GIỮ** — nội bộ, không user-facing; đổi = dump/restore + sửa GRANT/RLS + mọi connstring, rủi ro không tương xứng | **Cao** | 3-5 ngày kỹ thuật + 2-4 tuần grace |
| **R-4 Docs** (tùy chọn) | Đổi doc "sống" (API_REFERENCE/DEPLOYMENT/USER_GUIDE/MQTT_*); doc audit lịch sử ECOSYSTEM giữ nguyên (bản ghi thời điểm); rebuild KB RAG sau khi sửa knowledge/ | Thấp | 1 ngày |

**Danh sách GIỮ NGUYÊN vĩnh viễn (thuật ngữ máy):** MACHINE_TYPES/machineTypeEnum/devicetypeenum (AVI/AOI/SPI/AXI), aoiPackageRouter/aoiOnboarding/aoiCommissioning/aoiImageEmbedding/uns/aoiBridge, route `/aoi-packages` `/aoi-onboarding`, env `AOI_CACHE_*`/`AOI_EMBEDDING_*`/`AOI_DL_HEAD_ENABLED`/`UNS_SPARKPLUG_AOI_BRIDGE`, bảng aoi_image_packages/aoi_commissioning_records/aoi_embedding_head_dataset, seed IPC-A-610/defect taxonomy, KB `knowledge/domain/aoi-*.md`, i18n "máy AOI", uploads/aoi-cache.

---

## 12. QUYẾT ĐỊNH CẦN CHỐT TRƯỚC KHI THỰC THI

| # | Câu hỏi | Khuyến nghị |
|---|---|---|
| **D1** | **SYNAPSE thay hẳn "Continuum"** hay đồng tồn tại (SYNAPSE = nền tảng, Continuum = tên sản phẩm)? | Thay hẳn — 1 brand duy nhất "SYNAPSE" (khớp bộ tài liệu LDS + tránh 2 tên gây loãng); tagline giữ "Automation & Manufacturing Operations Platform" |
| **D2** | Streaming bus: **NATS JetStream trước, Kafka sau** (đúng DEVPLAN §6.3) hay Kafka ngay? | NATS trước — nhẹ, dễ vận hành single-node (khớp kiến trúc gập được); interface trừu tượng để swap Kafka khi Site Edition scale |
| **D3** | DB name giữ `aoi_management` (nội bộ) hay đổi `synapse`? | **Giữ** — không user-facing, đổi tốn kém rủi ro cao; chỉ đổi nếu có yêu cầu thương mại (audit khách hàng nhìn thấy tên DB) |
| **D4** | Phạm vi rebrand R-3 (MQTT topics) làm trong W1 hay dời W7 (gộp với edge gateway + APK rollout)? | Dời W7 — dual-publish cần cửa sổ rollout thiết bị; W1 chỉ làm R-1+R-2 |
| **D5** | Thứ tự W3 (Điều phối) vs W4 (Streaming): chạy song song hay tuần tự? | Song song nếu đủ nhân lực (W3 = giá trị nghiệp vụ lớn nhất, W4 = hạ tầng); tối thiểu W3 trước vì demo được cho khách |

---

## 13. RỦI RO & PHỤ THUỘC

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| HW-validation không có lịch nhà máy → T1/T4 kẹt <95 | Cao | Tách track HW (W7) chạy song song; mọi mục software-only làm trước; Full-Sim + conformance suite làm bằng chứng thay thế tạm thời |
| Hạ tầng mới (cluster/bus/lake) tăng chi phí vận hành cho khách nhỏ | Vừa | Kiến trúc gập được: hạ tầng lớn là *profile tùy chọn*; Machine Edition giữ single-node embedded broker + SQLite/PG đơn |
| Đổi MQTT topic phá client máy trạm/APK ngoài field | Cao | Dual-publish + grace period + version handshake; không tắt topic cũ khi còn client subscribe |
| RUL/failure-mode cần dữ liệu hỏng tích lũy + cảm biến rung | Vừa | Bắt đầu thu thập ngay từ W3 (WO/failure ledger đã có); RUL heuristic giữ nhãn "proxy" trung thực đến khi đủ dữ liệu |
| Default-deny policy làm gãy thao tác đang chạy | Vừa | Mode switch theo nhóm action + canary theo tuyến + audit PERMIT trước khi lật; giữ default-allow cho action đọc |
| EMQX BSL 1.1 khi đóng gói bán lại (cluster) | Vừa | Đàm phán license EMQX hoặc phương án HiveMQ Edge/Mosquitto cho Machine Edition; cluster chỉ ở Site Edition (chi phí license tính vào giá) |
| Edition drift (Machine vs Site lệch hành vi) | Vừa | CI chạy E2E cả 2 profile từ khi có profile single-node (DEVPLAN §9.8) |
| Phạm vi lớn → sa lầy | Cao | Mỗi đợt có nghiệm thu demo-được; "bật & nối" trước "xây mới"; green-gate mỗi đợt; không mở đợt mới khi đợt trước chưa nghiệm thu |

---

## PHỤ LỤC A — BẢNG ĐỐI THỦ HỆ SINH THÁI (benchmark 2026)

| Hệ sinh thái | SKU/Edition | Licensing | Điểm mạnh | Điểm yếu / bài học |
|---|---|---|---|---|
| Siemens Xcelerator | Insights Hub Basic/Standard/Premium + Industrial Ops X + marketplace | Subscription/asset-tier, quote-only | 700+ certified partners, độ sâu domain (twin/PLM/Senseye) | Phức tạp, đắt, lock-in — SYNAPSE thắng bằng mở + đơn giản |
| Rockwell FactoryTalk | Design/Operations/Maintenance Hub + Optix | Perpetual + subscription, bundle hardware | Kênh phân phối + hardware-attach | Giá mờ, đóng quanh AB — bài học: hardware-attach cho Machine Edition OEM |
| PTC ThingWorx | Platform + Kepware | Per-thing/tier | Kepware = chuẩn connectivity | **PTC đã bán cho TPG $600M (hoàn tất 3/2026)** — "IIoT platform trống" chết; giá trị phải gắn use-case |
| Tulip | Essentials/Pro/Enterprise/Regulated | $100-250/interface/tháng, min 10 | Citizen developer, 43k app library, GxP | Không control thật; phí tăng nhanh theo trạm |
| Ignition (tham chiếu) | Maker/Edge/Standard/Cloud | **Per-server unlimited tags/clients, perpetual, giá công khai** ($945 Edge; suites $3.2k-13.5k) | Minh bạch giá + cộng đồng integrator | Không domain-app sẵn — SYNAPSE có domain-app là lợi thế |

**Bài học đóng gói cho SYNAPSE:** giá công khai theo node/edition (không per-tag); thang SKU liền mạch không migrate lại project; Machine Edition = "ngựa thành Troy" OEM; marketplace plugin + conformance là hào nước; tuân thủ CRA/62443 là hồ sơ bán hàng B2B lớn.

## PHỤ LỤC B — CHECKLIST NGHIỆM THU ≥95 (rút gọn, chấm lại cuối W7)

- **T1:** driver SDK + registry; CFX/Hermes hoạt động; store-forward tại biên ≥24h qua restart; fleet deploy vòng + rollback; X.509/gateway wired; mapping-as-code Git; benchmark ≥20k tag/gateway công bố; HW-FAT ≥1 dòng PLC + 1 máy SMT thật; SLO tag→UNS P95≤250ms đo thật.
- **T2:** broker HA ≥3 node; Sparkplug Aware; 100% topic có schema + quarantine; streaming bus replay; `_line/_area/_site` phát live; semantic layer versioned + lineage; genealogy 2 chiều <1s; lake + tiering; ingest ≥100k điểm/s đo công bố; state read ≤100ms.
- **T3:** Line Controller FSM 7 trạng thái + readiness + RecipeSet khóa; Policy default-deny + 1 cửa + audit PERMIT + eval <20ms; order lifecycle đủ + QT1-4 chạy trên FOE; chaos saga pass; edge autonomy giữ tuyến; correlation phủ 100% lệnh.
- **T4:** fidelity đo + tự vô hiệu; VC gate NPI mặc định; guardrail per-parameter + Recommendation contract requires[] cưỡng chế; feature store hoạt động; stage shadow→canary→prod + 2-người; drift data+concept nối alert; RUL học thật (hoặc nhãn proxy trung thực + lộ trình dữ liệu); vision SLO 200ms path ONNX.
- **T5:** Line View + e-SOP viewer + impact-alert + ISA-18.2 KPI live; ISA-101 pass + màu canonical 1 nguồn; P95 màn hình ≤2s RUM; mTLS device + OpenBao + SIEM + IR + SL2 gap-assessment; SBOM+cosign blocking; correlation nút-bấm→máy tra được trong UI; WMS/PLM/CMMS connector ≥1 hệ thật; DORA hiển thị.

## PHỤ LỤC C — NGUỒN BENCHMARK CHÍNH (đã xác minh, truy cập 2026-07-12)

T1: ptc.com/kepware · litmus.io/devicehub · inductiveautomation.com/pricing/edge · highbyte.com/pricing · docs.aws.amazon.com/greengrass (IoTJobExecutionsRolloutConfig) · siemens.com/industrial-edge · aws.amazon.com/iot-sitewise/pricing.
T2: hivemq.com (200M connections, Sparkplug Aware) · emqx.com (100M/23-node, BSL blog) · tinybird.co + oneuptime.com + sanj.dev (ClickHouse vs Timescale) · kai-waehner.de (BMW/Tesla Kafka) · docs.rhize.com · ipc.org (CFX 2.0) · siemens.com/opcenter/electronics.
T3: docs.temporal.io (sla, limits, high-availability) · temporal.io/blog (Series D 150k actions/s [vendor]) · piotrmucha.blog (3.4k st/s độc lập) · camunda.com (license v1.0, Zeebe 2k PI/s) · openpolicyagent.org (policy-performance) · arxiv.org/pdf/2605.16265 (OPA p95 0.745ms) · omac.org/packml · isa.org (TR88.00.02-2022) · github.com/VDA5050 (v2.1.0, base/horizon) · osrf.github.io (Open-RMF) · plex.rockwellautomation.com/sla · tulip.co/plans.
T4: github.com/isaac-sim (Apache-2.0) · iso.org/standard/75066 (ISO 23247) + 87425 (Part 5:2026) · resources.sw.siemens.com (IDC case) · aws.amazon.com/blogs (Monitron sunset) · augury.com (Guaranteed Diagnostics) · siemens.com/senseye [vendor] · cognex.com (edge learning 5-10 ảnh) · instrumental.com · prnewswire.com (LandingLens-Snowflake GA 11/2024) · iso.org/standard/42001 · gibsondunn.com + traverssmith.com (EU AI Act Omnibus: high-risk hoãn 12/2027) · wallaroo.ai + datarobot.com (shadow/champion-challenger).
T5: inductiveautomation.com/ignition/unlimited · aveva.com/flex · rockwellautomation.com/optix · tulip.co/press (Series D) · isa.org (PAS ISA-18.2: ~6 alarm/giờ/op, flood >10/10') · Honeywell Orion whitepaper (ASM +38%) · isasecure.org (SL2 minimum) · csrc.nist.gov (SP 800-82r3) · digital-strategy.ec.europa.eu (CRA: 24h report từ 9/2026, full 12/2027, €15M/2.5%) · anchore.com (CRA SBOM) · openbao.org (MPL-2.0) · cncf.io (OPA graduated; ArgoCD/Flux/k3s) · ptc.com + investor.ptc.com (divestiture TPG $600M, closed 3/2026).

---

*Báo cáo lập bởi 8 agent audit/nghiên cứu + tổng hợp, 2026-07-12. Mọi file:line đã xác minh trên disk tại thời điểm audit. Kế hoạch W0-W7 và rebrand R-1..R-4 CHỜ DUYỆT; không thay đổi nào đã được thực thi.*
