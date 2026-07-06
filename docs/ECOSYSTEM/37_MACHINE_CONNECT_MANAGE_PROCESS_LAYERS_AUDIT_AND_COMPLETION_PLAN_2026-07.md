# 37 — Audit Toàn Tầng KẾT NỐI · QUẢN LÝ · XỬ LÝ Máy móc: Hiện trạng · Đánh giá % · Kế hoạch hoàn thiện

> **Yêu cầu:** audit lại toàn bộ các tầng cho **kết nối, quản lý và xử lý các loại máy móc** trong nhà máy tự động hóa, đối chiếu **tiêu chí hệ sinh thái ban đầu đã định + kế hoạch**, đánh giá **mức độ hoàn thiện hiện tại (%)**, và **cần cải tiến gì để hoàn thiện**. Báo cáo gồm hiện trạng · đánh giá · kế hoạch — chủ sở hữu review + duyệt, sau đó mới gọi AI Agent chuyên môn thực thi.
> **Phương pháp:** 4 agent audit read-only song song (tầng kết nối · tầng quản lý · tầng xử lý/điều khiển · khung tiêu chí+maturity) kiểm chứng code thật sau **merge synapse-foundation + W0-W5 (doc 35)**, trích `file:line`; nguồn cờ = `.env.example` (ship default).
> **Ngày:** 2026-07-06 · **Branch:** `automation-orchestration-r0` @ `25c4a43` · **Trạng thái:** 🟡 *Draft — chờ DUYỆT §5 trước khi gọi agent thực thi.*
> **Tiêu chí gốc đối chiếu:** doc 08 (Factory Control Plane E0-E5) · doc 09 (Device Programming D0-D7) · doc 16 (Automation Orchestration Khối 0-7) · doc 24 (4 trụ Advanced) · doc 33 (SYNAPSE 12 thành phần + 6 trụ platform) · doc 35 (4 trục platform chuyên nghiệp + W0-W5 đã thực thi).

---

## 0. TÓM TẮT ĐIỀU HÀNH

**Bức tranh một câu:** stack máy móc là một **hạm đội năng lực THẬT, kỷ luật, fail-safe-by-default, được kỹ thuật trung thực** — bề rộng kết nối phủ gần hết loại máy công nghiệp, các cổng an toàn (write-gate/commissioning/sim-gate) đạt mức mẫu mực — **nhưng gần như toàn bộ đang NGỦ sau cờ mặc-định-OFF, chưa validate với phần cứng thật, và lớp "platform-hóa để bán" mới ở mức móng.**

### Điểm hoàn thiện 3 tầng (framework vs production-vận-hành)

| Tầng | Framework (code có, test xanh, cờ bật được) | Production-vận-hành (chạy thật hôm nay) | Đỉnh / Đáy |
|---|:--:|:--:|---|
| **KẾT NỐI** (drivers/adapters/plugin) | **~88%** (real-transport ~68%) | **~12%** (HW-validated) | Đỉnh: bề rộng transport thật (5 PLC + 5 robot + VDA5050/ROS2 + Sparkplug + HSMS + MTConnect + Euromap77) · Đáy: **validation phần cứng ≈ 0** (protocol "ASSUMED"), GenICam camera live = stub, plugin chưa đấu driver registry |
| **QUẢN LÝ** (registry/commissioning/govern/recipe/edge/edition) | **~72%** (lõi vận hành ~84%, platform-hóa ~48%) | ~40% | Đỉnh: lifecycle FSM có quản trị (88%), commissioning-OT gate cứng, recipe/sim-gate DB-checked (82%), resilience + restore-at-boot (85%) · Đáy: **per-module license không enforce server-side**, plugin quota/signature chưa wired, routing/feeder gate còn trơ |
| **XỬ LÝ / ĐIỀU KHIỂN** (bus/command/safety/FOE/fleet/twin/AI/alarm) | **~68%** (code-complete) | **~22%** (live-in-prod) | Đỉnh: command-dispatch choke-point kép + ledger + interlock fail-closed đối xứng OT/robot (90%), reservation race-safe · Đáy: **safety actuation = 38%** (e-stop Null scaffold + human-sensing trả `[]`), GEM alarm không có loop |

> **% HOÀN THIỆN TỔNG THỂ:** **~70% framework · ~30-38% production-vận-hành.** Đây là hệ **L3 (MES+AI) xuất sắc + L2 điều khiển có nền vững + lớp platformization vừa đặt móng** — nhưng phần lớn giá trị đang bị khóa sau cờ OFF, chưa nghiệm thu phần cứng, và một số hiệu-lực chỉ tồn tại trên giấy.

### Ba loại khoảng cách (phân biệt để chọn cách cải tiến đúng)

1. 🟡 **TÀI SẢN NGỦ (cờ OFF)** — chiếm phần lớn khoảng cách. Code đã trả tiền làm rồi, chỉ cần **flag-flip có kiểm soát** (rẻ nhất, ROI cao nhất). Ví dụ: FOE, fleet, OT/robot control, UNS, twin, ERP, EQ-govern, interlock, plugin-sidecar.
2. 📄 **HIỆU-LỰC-TRÊN-GIẤY (operator/wiring chưa hoàn tất)** — code đúng nhưng chưa có hiệu lực thật: (a) app nối DB bằng **superuser** → RLS/WORM bị bypass tới khi switch `DATABASE_URL→avi_app`; (b) **TimescaleDB chưa cài main-DB** → hypertable/retention no-op; (c) plugin sidecar chạy nhưng **chưa đấu vào driver registry**; (d) DAG/event-replay + space-time traffic + routing-master chỉ preview/trơ, chưa nối runtime authority.
3. 🔴 **THIẾU THẬT (build/hardware còn thiếu)** — không thể flag-flip: **Safety-PLC SIL/E-stop actuation** (Null scaffold), **human-sensing model** (ONNX trả `[]`), **GenICam camera acquisition** (binding native), **FOCAS/Euromap83-63/Full-GEM runtime**, **8 hãng inspection + ICT/FCT**, marketplace/certification pipeline, node-graph drag-drop programming.

---

## 1. HIỆN TRẠNG — chi tiết từng tầng

### 1.1 TẦNG KẾT NỐI — ma trận loại máy × giao thức

Quy ước: 🟢 real+validated · 🟡 real-transport-chưa-HW · 🟠 parser mỏng (schema ASSUMED) · 🔴 stub/skeleton · ⬜ thiếu.

| Loại máy | Giao thức | TT | Bằng chứng (file:line) | Cờ (default OFF) |
|---|---|---|---|---|
| **PLC** Siemens | S7 (`nodes7`) | 🟡 | `ot/drivers/s7Driver.ts:90-118,289` | `OT_S7_ENABLED` |
| **PLC** Mitsubishi | MC/SLMP (`mcprotocol`) | 🟡 | `mitsubishiMcDriver.ts:85-108,272` | `OT_MITSUBISHI_MC_ENABLED` |
| **PLC** Allen-Bradley | EtherNet/IP (`st-ethernet-ip`) | 🟡 | `ethernetIpDriver.ts:88-104,232` | `OT_ETHERNET_IP_ENABLED` |
| **PLC** generic | Modbus (`modbus-serial`) | 🟡 | `modbusDriver.ts:74-99,246` | `OT_MODBUS_ENABLED` |
| **PLC** bất kỳ | OPC-UA (`node-opcua`) | 🟡 | `opcuaDriver.ts:88-124,395` | `OT_OPCUA_ENABLED` |
| **Robot** Fanuc | RMI TCP | 🟡 | `robot/drivers/fanucDriver.ts:201,236` | `ROBOT_CONTROL_ENABLED` |
| **Robot** Mitsubishi | MELFA R3 ASCII | 🟡 | `mitsubishiRobotDriver.ts:235` | idem |
| **Cobot** Techman | Modbus + Listen Node | 🟡 | `techmanDriver.ts:199-217,349` | idem |
| **Robot** Delta | ASCII-TCP | 🟡 | `deltaDriver` (TcpLineClient) | idem |
| **Cobot** Universal Robots | URScript 30001/29999 | 🟡 **validate SIM** | `ursimClient.ts:63-166` + harness | `URSIM_ENABLED` |
| **AGV/AMR** | VDA5050 (MQTT) | 🟡 | `vda5050Adapter.ts:99-184` | `VDA5050_ENABLED` |
| **AGV/AMR** | ROS2 (rosbridge WS) | 🟡 | `rosbridgeClient.ts:80-219` | `ROS2_BRIDGE_ENABLED` |
| **AOI/AVI/SPI** ST4I | chuẩn chính chủ | 🟢 **validated** | `vision/adapters/st4iStandard.ts:296` | `VISION_ADAPTERS_ENABLED` |
| **AOI** Saki/Mirtec/ICT | CSV/XML parser | 🟡 fixture | `sakiAoi.ts:147`, `mirtec.ts:165`, `ictAoi.ts:184` | idem |
| **AOI** KohYoung/Cognex/Keyence/TRI | JSON field-map | 🟠 ASSUMED | `kohYoung.ts:105`… | idem |
| **CNC** | MTConnect (HTTP/XML) | 🟡 | `mtconnectClient.ts:264-299` (parser regex) | `MTCONNECT_ENABLED` |
| **CNC** Fanuc | FOCAS Fwlib32 | 🔴 **không transport** | `focasAdapter.ts:2-24,195` (mapper, no lib) | `EQ_INTEG_ENABLED` |
| **Máy ép nhựa** | Euromap 77 (OPC-UA) | 🟡 | `euromapOpcuaReader.ts:154` | `EQ_INTEG_ENABLED` |
| **Máy ép nhựa** | Euromap 83 (MQTT) / 63 (file) | ⬜ thiếu transport | `euromapAdapter.ts:40-42` (chỉ enum) | — |
| **SEMI** | HSMS/SECS-II/GEM | 🟡 connect / 🔴 full-runtime | `hsmsClient.ts:286-369`; codec `secs2Codec.ts:266` 🟢 | `SECS_GEM_ENABLED` |
| **Camera** GigE/GenICam | image acquisition | 🔴 **STUB** | `genICamImageSource.ts` throw; thiếu binding native | `LIVE_ACQUISITION_ENABLED` |
| **UNS** | Sparkplug B (protobuf+MQTT) | 🟡 | `sparkplugNode.ts:49-183`, `unsPublisher.ts:276` | `UNS_SPARKPLUG_ENABLED` |
| **Broker** Aedes nhúng | MQTT 1883/WS/TLS | 🟢 **validated (app Android)** | `mqttService.ts:393-422` | `MQTT_ENABLED` |
| **Plugin** SYNAPSE ADR-008 | manifest + sidecar | 🟢 contract / 🔴 chưa đấu registry | `shared/plugin/manifest.ts:94-194`; sidecar real nhưng `driverRegistry` không import | `PLUGIN_SIDECAR` |

**Độ phủ:** ✅ đã kết nối được (transport thật): PLC đa hãng, robot 5 hãng, AGV VDA5050/ROS2, AOI/SPI 8 hãng, CNC MTConnect, máy ép Euromap77, SEMI HSMS, broker/UNS. ❌ **thiếu:** camera GenICam live, FOCAS, Euromap83/63, Full-GEM runtime, ≥8 hãng inspection (Omron/CyberOptics/ViTrox/Parmi/Pemtron/Viscom/Nordson-AXI/Marantz), ICT/FCT electrical-test, PROFINET/EtherCAT/CC-Link/PROFIBUS.

**Chấm:** **~68% real-transport · ~12% HW-validated · ~88% framework · ~35% plugin-platformization.**

### 1.2 TẦNG QUẢN LÝ — 8 hạng mục

| # | Hạng mục | TT | % | Bằng chứng + cờ |
|---|---|---|:--:|---|
| 1 | Device registry & **machine lifecycle FSM** | 🟢 | 88% | `hierarchy.ts:208-228` FSM commissioning→active→…→retired + audit; `deviceAdapter.ts:52-102` config-only |
| 2 | Commissioning gate | 🟡 | 68% | OT cứng `commandDispatcher.ts:358-364` (`OT_COMMISSIONING_REQUIRED` **ON**); AOI soft/fail-open; **robot FAT = 0** |
| 3 | Equipment governance (ISA-18.2/EEMUA-191) | 🟡 | 72% | `alarmMasterService.ts:216`, `governanceService.ts:136`; **ngủ + chia 3 cờ** (`EQ_GOVERN`/`EQ_INTEG`/`CAPABILITIES_VALIDATION_ENFORCED` OFF); không CI conformance |
| 4 | Recipe / capability(PackML) / programming / **sim-gate** | 🟢 | 82% | `machineRecipe.ts` second-approver + FOR-UPDATE; `packml.ts:46-217` 17 states; sim-gate cứng `programmingService.ts:239-272`; `DPC_*` OFF |
| 5 | Connection resilience (supervisor/HA/store-forward) | 🟢 | 85% | `connectionSupervisor.ts:154-506` backoff; HA hot-standby test-proven; WAL + **restore-at-boot (W2)** `ot/index.ts:37-65`; caveat: no fsync, no backfill scheduler |
| 6 | Edge runtime | 🟡 | 70% | central thật `edgeCoordinator.ts:120-443` (wired); edge-side `edgeRuntime.ts` **library test-only, chưa host** |
| 7 | **Plugin / edition / license-module (platformization)** | 🔴 | **48%** | manifest gate fail-closed thật NHƯNG **per-module license không enforce server-side** (chỉ client RouteGuard sau `LICENSE_ROUTE_GUARD` OFF); plugin quota/signature/validate **test-only, không wired**; `clampQuota` dead |
| 8 | Routing / genealogy (W4) | 🟡 | 62% | `routing_master`/`routingService.ts:159` schema thật NHƯNG `erpIntake.ts:23-25` chưa gọi `getActiveRouting()`; feeder-verify `assertSetupOkForRun` **không caller** |

**Chấm:** **~72%** (lõi vận hành ~84%, platform-hóa bán-được ~48%).

### 1.3 TẦNG XỬ LÝ / ĐIỀU KHIỂN — 8 hạng mục

| # | Hạng mục | TT | % code | % live | Bằng chứng + cờ |
|---|---|---|:--:|:--:|---|
| 1 | Telemetry bus & ingest | 🟢/🟡 | 78% | 55% | `telemetryBus.ts:66,255` 1 phễu + tap; `eventBus` bus-2 (vai trò tách sạch); **bug** `0172:108` compress_segmentby `adapterId` (cột không tồn tại → vỡ khi cutover Timescale) |
| 2 | **Command dispatch (xuống máy)** | 🟢 | 90% | 40% | `commandDispatcher.ts` 4-gate (mode/commissioning/interlock fail-closed/tag-writable) + HITL re-verify + idempotency + readback + ledger `command_log`; robot đối xứng + **interlock gate (W2)** `robotCommandDispatcher.ts:188-213` |
| 3 | **Safety & interlock** | 🔴 | **38%** | 20% | interlockGate fail-closed 🟢; NHƯNG **e-stop = `NullSafetyPlcAdapter` actuate KHÔNG GÌ** (`safetyEstopAdapter.ts:126-143`), **human-detect ONNX trả `[]`** (`humanDetectionProducer.ts:187`), zone advisory-only. Không SIL/Cat-3/4 |
| 4 | Orchestration FOE | 🟡 | 70% | 0% | RunEvent log durable (mig 0222/0223) + auto-resume boot-wired `foeEngine.ts:1151`; hitl_gate; **DAG-compile + event-replay chỉ gov-preview, chưa nối executor**; `FOE_ENABLED` OFF |
| 5 | Fleet / traffic | 🟡 | 62% | 0% | reservation **race-safe FOR-UPDATE** 🟢 (TOCTOU đóng); space-time interval-tree + RL advisor **chỉ preview/placeholder 1-factor**; `FLEET_ORCH_ENABLED` OFF |
| 6 | Digital twin | 🟡 | 80% | 10% | Rapier physics + occt-WASM STEP + A*/D* Lite **textbook thật**; drift detector; client three.js **chưa physics**; mọi cờ OFF |
| 7 | AI cho máy | 🟡 | 82% | 10% | PatchCore + robot-anomaly EWMA/CUSUM + PdM IsolationForest **thật, advisory**; **decision-trace wired live** `taskAllocator.ts:40`; cờ OFF |
| 8 | Alarm máy → hành động | 🟡/🔴 | 70% | 10% | normalizer→Andon thật (MTConnect/Euromap wired); **SECS/GEM alarm KHÔNG có live loop** 🔴; OT ingest không có bề mặt alarm; `EQ_INTEG_ENABLED` OFF |

**Chấm:** **~68% code-complete · ~22% live-in-prod.**

---

## 2. ĐÁNH GIÁ — khung 15 năng lực & đối chiếu tiêu chí gốc

### 2.1 Khung tiêu chí thống nhất (tổng hợp doc 08/09/16/24/33/35) + maturity hiện tại

| # | Năng lực (mức L4 = chuyên nghiệp/đầy đủ) | % FW | Ngủ / Thiếu thật |
|---|---|:--:|---|
| 1 | Đa-giao-thức connectivity & device abstraction | 70% | *Thiếu:* FOCAS/Euromap63/GenICam cần sidecar/binding native (HW); push-streaming còn poll. *Ngủ:* `OT_*` OFF |
| 2 | Capability model & standardization (UEM/PackML/ISA-18.2) | 60% | *Ngủ:* `EQ_GOVERN` OFF; *Thiếu:* hierarchy đa cấp + Standards-Board CI-gate + compliance dashboard |
| 3 | Telemetry SSOT / UNS & data fabric | 55% | *Thiếu (P0):* **TimescaleDB vắng main-DB**; UNS chưa là SSOT (bus không feed UNS); bus thiếu replay/DLQ |
| 4 | Command safety-loop / write-gate | 75% FW / **~25% vật lý** | *Thiếu thật (HW):* Safety-PLC SIL, e-stop=scaffold, zone advisory. *Ngủ:* control cờ OFF |
| 5 | Orchestration bền (FOE durable/DAG) | 70% | *Ngủ:* `FOE_DURABLE` OFF; *Thiếu:* replay-from-events thuần + DAG-compiler nối executor |
| 6 | Fleet & traffic (space-time/2-phase) | 60% | *Ngủ:* fleet cờ OFF; *Thiếu:* fleet AMR HW + RL train thật (còn 1-factor placeholder) |
| 7 | Device programming — IR & transpiler (DPC) | 57% | *Thiếu thật:* **node-graph drag-drop** (còn nested-tree); transpiler→HW (ZMC/GX Works/TMSCT cần HW). *Ngủ:* `DPC_*` OFF |
| 8 | Digital twin & simulation | 55% | *Thiếu:* client physics, FMU/FMI, virtual-commissioning. *Ngủ:* `TWIN_*` OFF |
| 9 | AI closed-loop / analytics / predictive | 85% | *Thiếu:* RL/PPO train thật (Isaac), KS-test, Triton. Tài sản mạnh nhất |
| 10 | AOI/AVI inspection & quality | 70% | *Thiếu thật:* first-party DL ship, sub-pixel align coarse, **live GigE (HW)**, componentCode backfill BOM |
| 11 | Enterprise integration (ERP/MES 2 chiều) | 60% | *Ngủ:* `ERP_*` OFF; *Thiếu:* provider MES/ERP khách thật, Pact 2 phía, routing-master nối erpIntake |
| 12 | Plugin-extensible / marketplace | 45% | *Thiếu thật:* **marketplace + certification**; sidecar chưa đấu driver-registry; auto-form renderer |
| 13 | Editions / collapsible-deploy / licensing | 55% | *Thiếu:* Join-wizard/mDNS, HA proof, TPM native, license issuance prod. *Scaffold:* Tauri + Local Agent |
| 14 | Security platform-grade | 55% FW / thấp hơn khi chạy | *Thiếu:* mTLS/SPIFFE + device X.509 PKI + Vault. *Operator:* **switch DATABASE_URL khỏi superuser** để RLS/WORM có hiệu lực |
| 15 | Observability / decision-trace | 55% | *Thiếu:* OTLP collector sống (Tempo/Jaeger), burn-rate→Prometheus, Loki. *Ngủ:* `METRICS` OFF |

### 2.2 Đối chiếu tiêu chí gốc

- **Doc 16 (Khối 0-7):** K2 fleet ✅ reservation race-safe (space-time/RL preview) · **K3 safety 🔴 actuation Null — gap lớn nhất vs kỳ vọng** · K5 govern ✅ FOE durable-log (DAG/replay chưa nối) · K6 IR ✅ robot dispatch+interlock · K7 twin ✅ lib thật (cờ-OFF). **~65%.**
- **Doc 08 (E0-E5 Control Plane):** E0 capability/PackML 🟢 · E1 unified telemetry 🟢 · E2 FOE ✅ (durable thêm) · E3-E5 twin/edge/AI-orch đủ khung advisory. **~80%.**
- **Doc 09 (D0-D7 Device Programming):** framework 🟢 8 kind + sim-gate cứng · device I/O 🟡 (adapter trả `failed` trung thực, chưa download HW). **~78%.**
- **Doc 33 (SYNAPSE):** 5.1/5.4/5.7/5.8/5.10 primitives đã land dạng **additive/preview** sau merge; enforcement runtime ở default ≈ 0; ADR-007/008 (editions/plugin) **~48%** — nơi cần đầu tư nhất để "quản máy như platform bán-được".
- **Doc 35 (4 trục):** luồng dữ liệu 6.3/10 · quy trình L3-lõi/L1-rìa · backend 3.8 + DB 4.0 · frontend ~70% → cùng cho ra vùng **~35-40% production-operational.**

### 2.3 Kết luận đánh giá

Hệ đã **vượt xa điểm khởi đầu của mọi báo cáo tham khảo về framework (~70%)** — lõi chức năng chín, AI vượt chuẩn ngành (85%), command-dispatch + reservation là production-grade, platformization vừa được đặt móng đầy đủ (F1-F8/W0-W5 merged). Nhưng **production-vận-hành chỉ ~30-38%** vì (1) tài sản ngủ cờ-OFF, (2) hiệu-lực-trên-giấy chưa hoàn tất, (3) phần cứng + build safety chưa nghiệm thu. **Con đường "hoàn thiện" rẻ nhất KHÔNG phải xây thêm mà là KÍCH HOẠT + KHAI THÁC + NGHIỆM THU + đóng 2 lỗ hổng build thật (safety actuation, GEM loop, plugin-registry wiring).**

---

## 3. TOP GAP HỢP NHẤT (ưu tiên theo rủi ro)

| # | Gap | Loại | Tầng | Bằng chứng |
|---|---|---|---|---|
| **P0-1** | **Safety actuation = Null scaffold** (e-stop không dừng gì + human-sensing trả `[]`) | 🔴 build+HW | Xử lý | `safetyEstopAdapter.ts:126-143`, `humanDetectionProducer.ts:187` |
| **P0-2** | **Zero HW-validation toàn tầng kết nối** (protocol "ASSUMED", chưa commissioning thiết bị thật) | 🔴 HW | Kết nối | mọi driver tự khai; test toàn mock |
| **P0-3** | **Per-module license KHÔNG enforce server-side** (deep-link API tới module chưa mua vẫn chạy) | 📄 wiring | Quản lý | `trpc.ts` no moduleGate; `licenseRouter.ts:196-332` chỉ return; `LICENSE_ROUTE_GUARD` OFF |
| **P0-4** | **Plugin sidecar chưa đấu driver-registry + quota/signature test-only** (headline ADR-008 chưa đạt; "thêm hãng = 1 plugin" bất khả thi) | 📄 wiring | Kết nối+Quản lý | `driverRegistry` không import plugins; `pluginQuota/Signature` test-only |
| **P0-5** | **3 hiệu-lực-trên-giấy data-platform:** DB superuser (RLS/WORM bypass) · TimescaleDB vắng main-DB · bug `0172:108` compress_segmentby | 📄 operator | Xử lý+DB | doc 35 §11; `0172_inspection_hypertables.sql:108` |
| **P0-6** | **GenICam camera acquisition = stub** (không thu ảnh live) + **GEM alarm không có loop** | 🔴 build+HW | Kết nối+Xử lý | `genICamImageSource.ts`; `adapterAlarmBridge.ts:19-20` |
| P1-7 | Toàn stack ship flag-OFF (tài sản ngủ) — cần runbook flip có kiểm soát + smoke từng cờ | 🟡 activation | Cả 3 | `.env.example` gần toàn `*_ENABLED=false` |
| P1-8 | DAG-compile + event-replay + space-time traffic + RL: chỉ preview/placeholder, chưa nối runtime authority | 📄 wiring | Xử lý | `dag.ts`/`eventSourcing.ts` gov-preview; RL 1-factor |
| P1-9 | Routing-master + feeder-verify gate trơ (chưa nối erpIntake / run-start) | 📄 wiring | Quản lý | `erpIntake.ts:23`, `feederVerifyService.ts:245` |
| P1-10 | Governance ISA-18.2/EEMUA-191 ngủ đông + chia 3 cờ + không CI conformance; robot FAT chuyên biệt = 0 | 🟡 activation | Quản lý | `EQ_GOVERN`/`EQ_INTEG`/`CAPABILITIES_VALIDATION` OFF |
| P1-11 | 8 hãng inspection thiếu + ICT/FCT + FOCAS/Euromap83-63/Full-GEM (thiếu transport); 4 JSON-mapper schema ASSUMED | 🔴 build | Kết nối | `vision/adapters/` comment "add next" |
| P1-12 | Node-graph drag-drop programming (còn nested-tree) + transpiler→HW; configSchema→auto-form chưa có renderer | 🔴 build | Quản lý+FE | doc 24; `SynapsePlatformPage.tsx:106` chỉ Badge |
| P2-13 | Store-forward no fsync + no backfill scheduler; twin external-mesh chỉ ASCII-STL; MTConnect parser regex; health-getter chưa expose HTTP | 🟢 polish | Cả 3 | `storeForward.ts`, `mtconnectClient.ts` |

---

## 4. KẾ HOẠCH HOÀN THIỆN (chờ DUYỆT §5)

> Nguyên tắc (convention doc 24/27/31/35): mỗi đợt = N agent chuyên môn · flag OFF mặc định · migration đánh số tiếp (**mới nhất 0230 → bắt đầu 0231**) · green-gate `npm run check` + `vite build` + smoke · wave-lead commit (**cấm subagent git**) · cập nhật module-registry/navigation/i18n · CONSOLIDATE không phá golden-thread.

### Đợt A — KÍCH HOẠT & KHAI THÁC (rẻ nhất, ROI cao nhất — làm trước)
Đóng loại-gap 🟡 ngủ + 📄 hiệu-lực-trên-giấy. Không build mới.
| # | Việc | Đóng gap |
|---|---|---|
| A1 | **Data-platform activation**: áp mig 0224-0230 (đã áp dev, xác nhận DB đích) → **switch `DATABASE_URL→avi_app`** (RLS/WORM có hiệu lực) → **Timescale cutover** (fix bug `0172:108` segmentby trước, cài extension, re-apply 0172/0173) | P0-5 |
| A2 | **Staged flag-flip runbook** (doc 19/23): bật theo thứ tự an toàn trên staging → smoke từng cờ (OT_GATEWAY→OT_CONTROL sau commissioning · FOE_ENABLED/DURABLE · FLEET · UNS · TWIN · EQ_GOVERN · METRICS/OTEL) → giám sát SLO; `controlGatewayConsistency` cảnh báo drift | P1-7, P1-10 |
| A3 | **Frontend-exploit** (doc 35 G4): twin replay/physics **client**, query-wrapper/EmptyState chuẩn, "tính năng chưa bật" UX; nối reportingMart vào dashboard | doc 35 F4 |

### Đợt B — ĐÓNG LỖ HỔNG WIRING (📄 — code có, chưa nối)
| # | Việc | Đóng gap |
|---|---|---|
| B1 | **Plugin → driver-registry**: đấu sidecar transport vào `ot/driverRegistry`; wire validate-gate + quota + **signature verify** vào spawn path; auto-form renderer (configSchema) | P0-4 |
| B2 | **Per-module license server-side gate**: tRPC middleware `requireModule` map procedure→module entitlement (không chỉ client RouteGuard) | P0-3 |
| B3 | **FOE durable thật**: nối `dag.ts` + `eventSourcing.replayPersistedRun` vào executor (thay tree-walk/re-walk); persist space-time slot (không chỉ preview) | P1-8 |
| B4 | **Routing/feeder gate nối run-start**: `erpIntake` gọi `getActiveRouting()`; `assertSetupOkForRun` cắm vào dispatch/run-start | P1-9 |

### Đợt C — NỀN TẢNG BÁN-ĐƯỢC & QUAN-SÁT (platformization)
| # | Việc | Đóng gap |
|---|---|---|
| C1 | **Observability sống**: OTLP collector (Tempo/Jaeger) + burn-rate→Prometheus alert + expose health-getter HTTP; bật METRICS default | năng lực 15 |
| C2 | **Security platform-grade**: mTLS/SPIFFE-lite service-id + device X.509 onboarding + Vault (Site) | năng lực 14 |
| C3 | **Marketplace/dev-portal/edition**: publish OpenAPI/AsyncAPI thật + sandbox + sample-plugin + certification pipeline; Join-wizard/mDNS; Tauri desktop-shell + Local Agent | năng lực 12/13 |

### Đợt D — BUILD THẬT CÒN THIẾU (🔴 — cần code/HW mới)
| # | Việc | Đóng gap |
|---|---|---|
| D1 | **GenICam acquisition**: binding native (harvesters/pylon/Spinnaker) → live camera | P0-6 |
| D2 | **GEM live message-dispatch loop** (S5F1 alarm, S6F11 event, T1-T8) | P0-6 |
| D3 | **Vendor breadth**: 4 JSON-mapper (KohYoung/Cognex/Keyence/TRI) validate file thật + thêm Omron/CyberOptics/ViTrox/Parmi/Pemtron/AXI + ICT/FCT adapter; FOCAS sidecar; Euromap83/63 | P1-11 |
| D4 | **Node-graph drag-drop programming** (React Flow trên IR) + transpiler→HW cuốn chiếu theo thiết bị | P1-12 |

### Đợt E — NGHIỆM THU PHẦN CỨNG (🔴 — chặn bởi thiết bị, cần đầu tư + hiện diện nhà máy)
| # | Việc | Đóng gap |
|---|---|---|
| E1 | **Safety-rated stop**: nghiệm thu Safety-PLC SIL 2/3 (Pilz/Sick dual-channel) + human-sensing model thật (UWB/LiDAR/ONNX person) → thay Null e-stop | P0-1 |
| E2 | **Commissioning/FAT thực địa**: FAT bench ≥1 thiết bị mỗi hãng (PLC/robot/AGV/Euromap/HSMS) validate protocol shape trước khi bật `*_CONTROL_ENABLED`; **robot FAT checklist ký số** | P0-2, P1-10 |

### Đồ thị phụ thuộc & thứ tự khuyến nghị
```
A (Kích hoạt) ──┬─▶ B (Wiring) ──┬─▶ C (Platformization) ──▶ marketplace/thương mại
                │                 │
A3 Frontend ────┘                 └─▶ D (Build thiếu) ──┐
                                                         ▼
                                  E (Nghiệm thu HW — song song, chặn bởi thiết bị/đầu tư)
```
**Đường tới hạn:** **A1+A2 (kích hoạt) trước tiên** — rẻ nhất, mở khóa phần lớn giá trị đang ngủ. Song song **A3 frontend** + **B (wiring)**. **E (safety+FAT) là chặn production thật** nhưng phụ thuộc đầu tư phần cứng — khởi động sớm về mặt mua sắm/kế hoạch. C/D theo nhu cầu thương mại & khách hàng thật.

---

## 5. QUYẾT ĐỊNH CẦN DUYỆT (trước khi gọi agent thực thi)

1. **Thứ tự đợt:** đồng ý **A (kích hoạt) → B (wiring) → C/D/E** như đề xuất, hay ưu tiên khác? Đặc biệt: **A1 (switch DATABASE_URL + Timescale cutover)** có làm ngay đợt này không (thay đổi runtime security + cần downtime off-peak + cài extension)?
2. **Phạm vi kích hoạt cờ (A2):** bật staged tới đâu — chỉ tầng an toàn (telemetry/twin/observability/EQ-govern) hay cả command-path (OT/robot control) trên staging (cần commissioning trước)?
3. **P0-3/P0-4 (platformization enforce):** làm server-side module-gate + plugin-registry wiring ngay đợt B (nền bán-được), hay hoãn tới khi có khách thương mại?
4. **Đợt D build thật:** ưu tiên hãng inspection nào trước (theo máy nhà máy đang có)? Node-graph programming có làm đợt này không?
5. **Đợt E phần cứng:** xác nhận Safety-PLC SIL + FAT là **hạng mục đầu tư/mua sắm** (ngoài phạm vi agent phần mềm) — cần lên kế hoạch riêng?
6. **Bug `0172:108`** (compress_segmentby `adapterId`): fix ngay (rẻ, chặn Timescale cutover) — đồng ý gộp vào A1?

> Sau khi anh chọn (1)-(6), tôi chốt danh sách đợt + thứ tự, rồi **gọi các agent chuyên môn thực thi từng đợt** (flag OFF → smoke → bật), commit theo đợt, cập nhật doc này với "KẾT QUẢ THỰC THI" như convention doc 24/27/31/35.

---

## 6. AUDIT BỔ SUNG — DÙNG KHO TÀI LIỆU HÃNG để hoàn thiện hạ tầng & UX

> **Đầu vào:** kho manual thật của khách tại `D:/SOURCES/AI Local/Manual/` — **6 hãng · 37 PDF · ~438MB** (đã RAG-ingest 91,678 chunk ở doc 34). 4 agent đọc-có-mục-tiêu PDF + đối chiếu code driver. Đây là chìa khóa đóng **P0-2 (protocol "ASSUMED") + P1-11 (adapter schema ASSUMED) + P1-12 (config-form/UX)**.

### 6.1 Bản đồ kho manual — phủ & THIẾU

| Hãng | Manual có | Phủ được | THIẾU (cần bổ sung để spec-verify đầy đủ) |
|---|---|---|---|
| **Mitsubishi** (26.4k chunk) | GX Works3, MELSEC iQ-R programming (ST/LD), MELFA-Works, **MELSERVO J4 error codes**, Advanced Course | config-form fields, device-symbol, **>60 mã lỗi MR-J4**, programming | ⚠️ **Frame SLMP/MC (SH-080008/SH-080956) KHÔNG có** · MELFA R3 Ethernet command channel (BFP-A8662) KHÔNG có |
| **Fanuc** (11.7k) | KAREL Ref, R-30iB Mate maintenance, TP operator, CRX, LR programming | KAREL/TP structure, **facility×1000+code alarm**, SRVO/MOTN codes, KAREL Socket Messaging | ⚠️ **RMI (B-84184EN) KHÔNG có** (0 hit "RMI/FRC_" trên cả 5 PDF) — driver RMI không cite được từ kho |
| **Delta** (29.4k) | DVP-PLC, AS300, ASDA-A2/E3C servo, DIAStudio(DRAStudio) robot | PLC Modbus (tái dùng driver), **ASDA AL.xxx codes**, DRAStudio tool-link | ⚠️ **DRL (Delta Robot Language) reference + controller comms KHÔNG có** → driver robot Delta là hư cấu · AS300 register-map ở HW-manual (thiếu) |
| **Omron** (17.5k) | W502 NJ/NX instructions ref, G5 servo | **NJ/NX = EtherNet/IP CIP tag-symbolic**, ErrorID 16#xxxx (CIP/Socket/Modbus), instruction | W506 (EtherNet/IP ports), W503 (event-log codes), W596 (FINS) |
| **Universal Robots** (2.5k) | UR5e/UR10e user, **URScript**, **ErrorCodes** | ✅ protocol verify được đầy đủ, 40 mã C### | (đủ) |
| **Zmotion** (4.2k) | **PC Programming (ZAux)**, ZBASIC, RTBasic, ZVision, RTSys/ZDevelop | **ZAux deploy protocol thật**, return codes, RTBasic keyword | (đủ cho deploy) |
| **AOI inspection** (Koh Young/Cognex/Keyence/TRI/Saki/Mirtec/Omron-insp…) | **0 manual** | — | 🔴 **NGHỊCH LÝ: sản phẩm là "avi-aoi-management" nhưng KHÔNG có manual hãng AOI nào** → 8 adapter vision vẫn "schema ASSUMED" (đoán field) |

**Kết luận 6.1:** kho phủ tốt **error-code + config-param + programming** (đủ để nạp taxonomy + sinh config-form + nuôi copilot), nhưng **thiếu các "comms-protocol reference manual" tầng thấp** (SLMP/RMI/DRL) — nên một số driver vẫn phải giữ caveat "verify HW". **Điểm mù chiến lược: hoàn toàn thiếu manual hãng AOI** — chính dòng máy cốt lõi của sản phẩm.

### 6.2 Spec-verify driver — ASSUMED vs THẬT (tóm tắt; chi tiết + trang trong báo cáo agent)

| Driver | Verdict | Điểm khớp | Điểm LỆCH cần sửa |
|---|---|---|---|
| **UR** `ursimClient.ts` | 🟢 **về cơ bản ĐÚNG spec** | URScript clear-text `\n`, def/end, movej/movel units, dashboard 29999 (URScript tr.14,46) | **BUG:** `sendScript()` đóng socket ngay, **không đọc ≥79 byte** → URScript §2 bắt buộc, script có thể **bị loại trước khi chạy**; default port nên **30002** (không 30001); transpiler dùng `set_digital_out` **deprecated**→`set_standard_digital_out` |
| **Mitsubishi MC** `mitsubishiMcDriver.ts` | 🟠 **lệch nền tảng** | ascii/binary, read-only X/DX đúng | **lib `mcprotocol` CHỈ 1E-frame (FX/Q), KHÔNG phải 3E/4E SLMP của iQ-R** → driver định vị iQ-R nhưng lib không hỗ trợ; port 1281 không phải chuẩn (bắt buộc nhập); thiếu networkNo/stationNo + octal flag |
| **Mitsubishi MELFA** `mitsubishiRobotDriver.ts` | 🟡 caveat "ASSUMED" **đúng** | gating an toàn xuất sắc | Kho không xác thực kênh R3 (chỉ MXT/UDP + CAD-link); cần MELFA Ethernet manual; port 10001 không chuẩn |
| **Fanuc** `fanucDriver.ts` | 🟡 RMI khớp spec công khai, **không cite được từ kho** | JSON/FRC_/config đúng ý niệm RMI | 0 hit "RMI" trên 5 PDF → cần B-84184EN; kho document **KAREL Socket Messaging (S1:-S8:)** là đường thay thế; **FOCAS≠RMI** (FOCAS cho CNC) |
| **Delta robot** `deltaRobotDriver.ts` | 🔴 **HƯ CẤU** | — | Frame `@seq,CMD*XX`/verb/port 5000/XOR **không có trong tài liệu**; kho chỉ có DRAStudio tool-link + DRL language riêng → **đánh dấu mock, giữ dry-run**, lấy DRL manual |
| **Delta PLC** (DVP/AS300) | 🟢 **tái dùng `modbusDriver.ts`** | function-code khớp | thêm register-map preset (X octal→10xxxx, D→4xxxxx); AS300 map ở HW-manual |
| **Omron NJ/NX** | 🟠 **GAP — chưa có driver** | — | NJ/NX = EtherNet/IP CIP tag-symbolic (như Allen-Bradley) → **TÁI DÙNG `ethernetIpDriver.ts`** (không cần FINS driver mới); thêm preset port 44818 + Network-Publish |
| **Zmotion** `ZmcLink.deploy()` | 🟡 **sửa được** | port 502 đúng số | nhãn "Modbus" **sai** (thực là ZAux command channel); deploy thật = `ZAux_OpenEth→ZpjDown/BasDown/ZarDown(run_mode)→Close` qua zauxdll.dll FFI |

### 6.3 Bug/lệch cụ thể phát hiện được (fix nhanh, có căn cứ trang)

| # | Bug | File | Fix |
|---|---|---|---|
| M1 | UR `sendScript` không đọc ≥79 byte trước khi đóng → script bị loại | `robot/ursim/ursimClient.ts:155-166` | đọc reply ≥79B rồi mới `end()` (URScript tr.14) |
| M2 | UR default scriptPort 30001 (manual: 30002) | `ursimClient.ts:32-55` | default 30002 |
| M3 | Transpiler dùng `set_digital_out` deprecated | `programming/ir/transpilers/irToUrscript.ts:112` | `set_standard_digital_out`/`set_tool_digital_out` |
| M4 | `defaultPort` khai nhưng **không wire vào configSchema** → auto-form hiện port trống | `plugins/otConnectorManifests.ts:16,34-43` | `port: z.number().default(c.defaultPort)` per-connector |
| M5 | alarm_taxonomy seed chỉ **12 entry minh hoạ**, KUKA/Siemens không có manual (recommendedAction bịa) | `standards/alarmTaxonomy.ts:55-73` | seed mã hãng thật (§6.4); đánh dấu no-manual |
| M6 | Delta robot driver hư cấu, chưa đánh dấu mock ở registry | `robot/index.ts` | mark UNVERIFIED, ẩn khỏi prod UI |
| M7 | mcprotocol 1E-only nhưng driver định vị iQ-R | `ot/drivers/mitsubishiMcDriver.ts` | cảnh báo/đổi lib SLMP 3E cho iQ-R |

### 6.4 Nạp ERROR-CODE thật vào alarm_taxonomy (ISA-18.2) — dữ liệu đã trích sẵn

Agent đã trích **bảng mã lỗi thật** (sẵn schema `{vendor, device_class, series, code, name, probable_cause, severity, category, auto_clearable}`):
- **Mitsubishi MR-J4:** >60 mã (10-F3, hex; major/minor, 90-F7 auto-clearable). `MELSERVO J4 error codes.pdf` §1.2-1.3.
- **Universal Robots:** 40 mã C0-C210 + subcode. `ErrorCodes.pdf` (PolyScope 5).
- **Fanuc:** cấu trúc facility×1000+code (SRVO=11/MOTN=15/INTP=12…); SRVO-001/002/007/050/062, MOTN-018… `KAREL tr.137-138` + maintenance.
- **Delta ASDA:** 25+ mã AL001-AL503. `ASDA-A2 tr.614-623`.
- **Omron NJ/NX:** 30+ ErrorID 16#xxxx (CIP 1C00-1C06, Socket 2000-200C, Modbus 0C10-0C11, FINS 0800). `W502 App.A`.
- **Zmotion:** 25+ return code (0=success, 212-2082). `PC Manual §14.2`.

→ **Tổng ~200 mã hãng thật** thay cho 12 entry giả lập. Nạp qua cổng người-duyệt (giữ kỷ luật fail-safe).

### 6.5 Config-form / Setup Wizard manual-grounded (đóng P1-12)

**Phát hiện then chốt:** backend đã có `zodToConfigForm` (`plugins/configForm.ts:12`) + `otConnectorManifests` configSchema — **chỉ THIẾU renderer frontend** (`SynapsePlatformPage.tsx:106` mới vẽ `<Badge>`). Và `DeviceAdapterManagement.tsx:45` hardcode 6 protocol + endpoint text tự do.
- **Rẻ/ROI cao:** (a) fix M4 (wire defaultPort) + (b) `<JsonSchemaForm>` renderer → auto-form thật; (c) bảng `VENDOR_DEFAULTS` (port + protocol + register-map preset) trích thẳng manual: Mitsubishi-MC **5007**, Omron-EIP **44818**, Delta-Modbus **502**, UR **29999/30001/30004**, Zmotion **502(ZAux)**.
- **Setup Wizard "chọn hãng+model → tự điền"** + gợi ý qua `aiProgrammingKb.search` (kỹ sư duyệt).

### 6.6 UX manual-grounded — "đấu dây" cái đã có (đóng P0 UX)

**Backend đã sẵn, 0 frontend dùng** (grep `aiProgrammingKb` trong `client/` = 0):
- `aiProgrammingKbRouter.search` (page-cited, filter vendor) + `equipmentStandards.mapAlarm` — 2 endpoint sẵn.
- **Đề xuất `<ManualHelp vendor query>`** (drawer/popover trích "Manual, tr.N") nhúng 3 điểm dùng: (1) Device detail/Setup, (2) Program editor (bôi đen instruction → tra cú pháp), (3) **Andon/alarm detail: click mã → nguyên nhân + cách xử lý cited** (`AndonBoard.tsx` hiện 0 tra mã).
- **Copilot vendor-aware:** `ProgrammingCopilotPanel` đã có selector vendor + citations render — chỉ cần truyền vendor mặc định theo project/device đang mở; bổ sung golden-code KAREL/Delta/Omron (hiện placeholder → code UNVALIDATED âm thầm cho 73k chunk delta/mitsubishi/omron).

### 6.7 Kế hoạch bổ sung (ánh xạ vào §4) + ưu tiên

| Ưu tiên | Việc | Loại | Ánh xạ §4 |
|---|---|---|---|
| **P0** (rẻ, đấu-dây/seed) | `<ManualHelp>` point-of-use · seed alarm_taxonomy ~200 mã thật + Andon click-mã · JsonSchemaForm renderer + fix M4 defaultPort · fix M1-M3 (UR bug) · mark Delta-robot mock (M6) | 📄 wiring | Đợt A3 + B |
| **P1** (vừa) | Setup Wizard vendor-defaults + register-map preset · **Omron driver = preset ethernet-ip** (P.án A, ~0 code) · Zmotion `ZmcLink.deploy` qua ZAux FFI · copilot vendor-default + golden-code KAREL/Delta/Omron · **ingest manual hãng AOI** (đóng nghịch lý) | 🔴 build nhỏ | Đợt B + D |
| **P2** (lớn) | Đổi lib Mitsubishi sang SLMP-3E cho iQ-R · transpiler IR→KAREL/ZMC/MELFA · register-map auto-import parse bảng manual · Delta-robot driver thật (cần DRL manual) | 🔴 build+HW | Đợt D |
| **Tài liệu cần bổ sung** | SLMP SH-080008/080956 · Fanuc RMI B-84184EN · MELFA Ethernet BFP-A8662 · Delta DRL + AS300 HW-manual · Omron W506/W503 · **manual hãng AOI khách dùng** | — | (mua/xin hãng) |

### 6.8 Quyết định bổ sung cần DUYỆT (thêm vào §5)

7. **Đấu-dây UX manual (P0):** đồng ý làm `<ManualHelp>` + seed alarm-taxonomy + auto-form renderer ngay đợt A/B (rẻ, dùng backend sẵn có)?
8. **Omron:** xác nhận đi **Phương án A (preset EtherNet/IP, ~0 code)** thay vì xây FINS driver?
9. **Bổ sung manual:** anh cung cấp thêm được **(a) comms-protocol reference** (SLMP/RMI/DRL) và **(b) manual hãng AOI** (Koh Young/Cognex/Keyence… khách dùng) không? — đây là chặn để spec-verify driver tầng thấp + đóng adapter AOI "ASSUMED".
10. **Fix bug UR (M1-M3) + Mitsubishi lib (M7):** làm ngay (rẻ, có căn cứ trang manual)?

---

## 8. ✅ KẾT QUẢ THỰC THI (2026-07-06)

**Đợt A — code-fix manual-grounded (commit `ad4e2bb`, tsc+build green):**
- Q10/M1 UR `sendScript` đọc ≥79 byte trước khi đóng socket (URScript §2 — nếu không script bị controller loại) · M2 default port 30002 · M3 transpiler `set_standard_digital_out` (bỏ deprecated).
- Q8 Omron NJ/NX preset (EtherNet/IP, port 44818 — tái dùng ethernet-ip driver, không cần FINS).
- M4 `otConnectorManifests` wire `defaultPort` per-connector vào JSON-Schema (auto-form nay có port điền sẵn).
- Q6 fix migration `0172:108` compress_segmentby `adapterId`(không tồn tại)→`machineId,metric` (chặn vỡ khi Timescale cutover).
- M6/M7 honesty: đánh dấu Delta robot driver **MOCK** (protocol hư cấu); document giới hạn `mcprotocol` 1E-frame-only (không phải 3E/4E SLMP iQ-R).

**Đợt B — wiring + platformization (commit `1a65eb7`, tsc+build green, mig 0231 applied):**
- Q7 manual-UX: `<ManualHelp>` (RAG page-cited popover) + `<JsonSchemaForm>` (auto-form) → nhúng DeviceAdapterManagement + AndonBoard "Tra mã". **122 mã lỗi hãng THẬT** nạp `alarm_taxonomy` (mig 0231): mitsubishi 55, delta 23, UR 18, fanuc 10, zmotion 9, omron 7 (thay 12 entry giả); `mapAlarm()` resolve offline.
- P0-3: `moduleGate`/`moduleProcedure` server-side (cờ `LICENSE_MODULE_GATE_ENABLED` OFF, fail-safe allow-with-log), áp 5 router module — đóng lỗ hổng deep-link module chưa mua.
- P0-4: `pluginDriverBridge` (sidecar↔OtDriver qua stdio RPC) + wire validate/signature-fail-closed/quota vào spawn path; đăng ký khi `PLUGIN_DRIVERS_ENABLED` ON (default OFF, 6 built-in nguyên vẹn); **write-gate KHÔNG bypass** (commandDispatcher vẫn là caller duy nhất) → đạt ADR-008 "thêm hãng = 1 plugin".

**Còn lại — Đợt A1/A2 env (BƯỚC OPERATOR CÓ CHỦ ĐÍCH — cần app-smoke, tôi không flip âm thầm trên hệ đang chạy):**
| # | Việc | Lệnh / cách | Rủi ro |
|---|---|---|---|
| A1a | Switch `DATABASE_URL`→avi_app (WORM/RLS có hiệu lực) | `ALTER ROLE avi_app WITH LOGIN PASSWORD '<secret>';` → sửa `.env` `DATABASE_URL=postgresql://avi_app:<secret>@localhost:5433/avi_aoi_db` → **restart app + smoke** (boot OK, ingest+CRUD chạy, thử UPDATE audit_logs bị chặn). **Đã PROVEN** avi_app đủ quyền business DML + append audit + chặn tamper. | Thấp (đã proof); revert 1 dòng .env |
| A1b | Timescale cutover | Cài extension `timescaledb` (cần `shared_preload_libraries` + restart PG server) → `node scripts/migrate-standalone.mjs` re-apply 0172/0173 (bug 0172 đã fix) → set `RETENTION_OT_TELEMETRY_DAYS=0`. | Cần DB-admin server (khó trên Windows PG) — có thể hoãn; retention app-90d đang bảo vệ |
| A2 | Bật cờ tầng-an-toàn (B2 scope) | Trên staging: `METRICS_ENABLED`, `OTEL_ENABLED`, `TWIN_LIVE_ENABLED`/`TWIN_STREAM_ENABLED`, `EQ_GOVERN_ENABLED` → smoke từng cờ theo runbook doc 19/23. **KHÔNG bật command-path** (OT/robot control) đợt này. | Vừa — cần smoke; advisory layers |

> Tôi có thể thực hiện A1a (switch .env) + A2 (bật cờ) ngay nếu anh xác nhận app đang TẮT (hoặc chấp nhận restart+smoke) — nói "flip A1a/A2" là tôi làm. A1b Timescale cần anh cài extension ở tầng DB server.

---

**Đợt D-drivers — spec-verify vs tài liệu comms thật (owner đã tải đủ) — commit `fa03384`, tsc+build green, 60 test driver pass, drivers vẫn dry-run:**
- **Fanuc RMI (B-84184EN)** — nhiều **bug thật**: two-port flow bắt buộc (16001 connect-only→reconnect PortNumber), joint dùng `FRC_JointMotionJRep` (không phải JointMotion=Cartesian), getState `FRC_ReadCartesianPosition` live, TPMode boolean auto/manual, busy=RMIMotionStatus===1, SequenceID từ NextSequenceID, handshake pre-check; cần R-30iB Plus + **option R912** (không phải R632) + AUTO. Test cập nhật 13/13.
- **Mitsubishi (SH-081227/SH-080956/BFP-A3379)**: `mcAddress` sửa TS/TC/CS/CC WORD→BIT + chấp nhận hex device-number; TODO SLMP-3E encoder (tự viết node:net, không đổi lib); MELFA port 10000-10009 + MXT/UDP + CR800 SLMP-server 45237.
- **Delta robot**: manual thực ra là **HIWIN RCD controller** (delta=kiểu cơ cấu) — không có host protocol → giữ MOCK document trung thực (đường thật: HIWIN HRSS / AS300 Modbus).
- **Zmotion**: chữ ký ZAux thật từ `Zmcaux.cs` (OpenEth chỉ IP, không Modbus:502) → `deployFile` đúng contract + FFI TODO (koffi, không dep).
- **Omron**: +44 mã 8-hex W503 (mig 0232 applied → 51 mã omron); preset port 44818 verify vs W506 (lưu ý route-path Omron direct-CPU khác AB — verify HW).

**Tài liệu vẫn cần cho ĐỦ spec (owner cân nhắc):** HIWIN HRSS network/remote-API manual (Delta/HIWIN robot host); MELFA support-software comm telegram (semicolon format) nếu dùng kênh TCP-command thay SLMP-server.

**A1a/A2 env — ĐÃ FLIP (2026-07-06):**
- **A1a**: `.env` DATABASE_URL → **avi_app** (least-privilege, dòng postgres cũ comment để revert). Verify: avi_app đọc mọi bảng mới + audit INSERT=true/UPDATE=false (WORM có hiệu lực), super=false. **App cần restart + smoke** (đang chạy vẫn dùng postgres tới restart). Password trong `.env` (nên rotate).
- **A2**: bật `OTEL_ENABLED`+`TWIN_LIVE_ENABLED`+`TWIN_STREAM_ENABLED` (METRICS+EQ_GOVERN đã ON) — cần smoke.
- **A1b Timescale**: vẫn cần cài extension DB-server (`shared_preload_libraries`+restart PG).

**Đợt D-drivers re-verify (owner bổ sung Delta-DRL + MELFA-CR800/a3379/a8525) — commit `40a8527`, doc-only, dry-run giữ:**
- Delta DRAStudio-RL = ngôn ngữ Lua on-controller, KHÔNG host-telegram → giữ MOCK, document 2 đường thật (Modbus register-mailbox / DRL SocketServer).
- MELFA telegram R3 semicolon **vắng cả 3 manual** → SLMP-server thành đường CHÍNH (CR800 §3.5 port 45237, 3E/4E, D0-D5119).

**Đợt C (platformization) — commit `40a8527`, tsc+build green:**
- **C1 Observability**: sloAlerting (live evaluator + burn-rate→alert + Prometheus gauges) · OTLP-ready (TODO cài @opentelemetry SDK) · **3 route `/api/observability/{health,slo,metrics}`** lộ store-forward/supervisor/SLO/decision-ring qua HTTP.
- **C3 Dev-portal**: OpenAPI sinh từ Zod + 5 route thiếu · plugin scaffold CLI `scripts/plugin-scaffold.mjs` + template sidecar (khớp B4 RPC) + certification (verified CERTIFIED) → time-to-first-plugin ≤1 ngày.
- **HOÃN (nay đã LÀM, xem dưới)**: C2 (device X.509/mTLS/SPIFFE security-identity) · Tauri desktop-shell vẫn HOÃN (cần toolchain riêng).

**Phần code còn lại — ĐÃ HOÀN THÀNH (2026-07-06, mig 0233, tsc+build+231 test green, cờ OFF):**
- **C2 — Device X.509 PKI + Service (SPIFFE-lite) identity** (đóng năng-lực-14 security, ~55%→bổ sung 2 trụ định danh còn thiếu): 9 file mới `server/services/security/{x509Mint,internalCa,deviceIdentityService,serviceIdentityService,requireServiceIdentity,securityIdentityRouter}.ts` + `drizzle/schema/security.ts` + **mig 0233** (`device_certificates`/`service_identities`/`security_ca_metadata`, applied + GRANT avi_app). Đúc X.509 v3 Ed25519 **bằng `node:crypto` thuần** (hand-roll ASN.1 DER, đã de-risk: `X509Certificate.verify(caPub)`/`checkIssued` pass — KHÔNG cần openssl/node-forge/dep mới). issue/verify/rotate(90d)/revoke device-cert; CA private-key resolve ENV→keystore→generate-once, DB chỉ lưu CA **public**; SPIFFE-lite JWT-SVID (EdDSA, `spiffe://<trust-domain>/service/<name>`) + middleware seam `requireServiceIdentity`. Router `securityIdentity` (adminProcedure) **đã wire vào `routers.ts`**. Cờ `DEVICE_PKI_ENABLED`/`SERVICE_MTLS_ENABLED` default OFF (OFF: verify soft-allow, middleware pass-through; ON+crypto-fail: hard-deny; ON+transient: allow-with-log).
- **GEM live message-dispatch loop** (đóng **P0-6** "GEM alarm không loop"): `server/services/secsgem/{s5s6Messages,liveDispatch}.ts` mới + sửa `hsmsClient.ts`/`secsGemRegistry.ts`/`index.ts`. Loop inbound độc lập (`dispatchRx` buffer riêng, không đua với request/reply) route **S5F1 alarm→`raiseFromGemAlarm`** (dead-seam nay CÓ caller runtime → E5 taxonomy→Andon) + ack S5F2, **S6F11 event→sink** + ack S6F12. Chuỗi cờ 3 tầng: `SECS_GEM_ENABLED`+`SECS_GEM_LIVE_ENABLED`(loop)+`EQ_INTEG_ENABLED`(raise) — tất cả OFF thì decode/ack-only, không giả success. Health honest (`mode: framework-only|live-dispatch`, `liveIngest` = cả 3 cờ ON).
- **Node-graph programming** (năng-lực-7): **PHÁT HIỆN ĐÃ HOÀN THIỆN SẴN từ doc 24** — `@xyflow/react@12` là dep thật; `IrGraphCanvas`/`WorkflowGraphCanvas`/`PouCanvas` là canvas node-graph THẬT (draggable node + SVG edge + MiniMap), **đã wire vào IrEditor (graph = view mặc định) + OrchestrationStudio**. Claim §1.3/§3 "vẫn nested-tree, KHÔNG node-graph" là **STALE/SAI** — sửa lại: capability-7 = ĐÃ ĐẠT. Không cần code (0 file đổi). Polish tùy chọn còn lại: OrchestrationStudio chưa lưu toạ-độ node (StudioStep thiếu field `ui`).

---

*Tài liệu 37 · audit 12 agent + thực thi Đợt A(`ad4e2bb`)/B(`1a65eb7`,mig0231)/D-drivers(`fa03384`+`40a8527`,mig0232)/C(`40a8527`) + C2/GEM(mig0233) + A1a/A2 flipped · khung 15 năng lực doc 08/09/16/24/33/35.*

---

## 5B. ✅ CHỐT DUYỆT (2026-07-06) + tài liệu cần bổ sung

**Điểm mù (A.2) — chủ sở hữu trả lời:**
- **A.2.1** Máy AOI/AVI **nội bộ tự sản xuất → dùng API là đủ** (adapter `st4i-standard` đã validated 🟢). Hãng AOI ngoài **cập nhật sau** → **HẠ ưu tiên** doc-37 D3 (vendor-breadth AOI); "nghịch lý thiếu manual AOI" **KHÔNG còn là vấn đề**.
- **A.2.2** Chủ sở hữu sẽ tải tài liệu còn thiếu (danh sách §7 dưới).

**Quyết định thực thi (B) — đã chốt:**
1. **Thứ tự đợt: A (kích hoạt) → B (wiring) → C → D → E.** ✅
2. **Phạm vi kích hoạt cờ (A2): CHỈ tầng an toàn** — telemetry/twin/observability/EQ-govern. **KHÔNG bật command-path** (OT/robot control) trong đợt này. ✅
3. **P0-3/P0-4: làm server-side module-gate + plugin→driver-registry wiring NGAY đợt B** (nền bán-được). ✅
4. **Đợt D: ưu tiên hãng inspection theo máy nhà máy đang có + Node-graph programming LÀM trong đợt này.** (kết hợp A.2.1: adapter AOI ngoài hạ ưu tiên; node-graph là trọng tâm D). ✅
5. **Đợt E (phần cứng Safety-PLC SIL + FAT): lên kế hoạch riêng** (mua sắm/đầu tư, ngoài phạm vi agent phần mềm). ✅
6. *(chờ xác nhận)* Fix bug `0172:108` compress_segmentby — khuyến nghị gộp vào A1 (rẻ, chặn Timescale cutover).
7-10. *(chờ xác nhận §6.8)* Đấu-dây UX manual · Omron Phương án A · fix bug UR M1-M3 · bổ sung manual.

## 7. DANH SÁCH TÀI LIỆU CẦN BỔ SUNG (chủ sở hữu tải — tôi không tải được file sau login hãng)

> Kho hiện có **programming + error-code + config-param** (đủ nạp taxonomy/config-form/copilot). THIẾU **comms-protocol reference tầng thấp** để spec-verify driver điều khiển. Bỏ qua manual AOI (A.2.1 = dùng API nội bộ).

| # | Hãng | Tài liệu (số hiệu) | Mở khóa việc gì | Ưu tiên |
|---|---|---|---|---|
| 1 | **Mitsubishi** | **MELSEC Communication Protocol Reference (SH-080008)** + **SLMP Reference (SH-080956)** | Frame 3E/4E + device-code hex → spec-verify `mitsubishiMcDriver.ts` cho iQ-R; quyết định đổi lib SLMP-3E | 🔴 cao |
| 2 | **Mitsubishi** | **MELFA Ethernet Function Instruction Manual** (BFP-A8662 / BFP-A3379, cho CR750/CR800) | Kênh lệnh R3 TCP (OPEN/CNTLON/SRVON/EXEC) → verify `mitsubishiRobotDriver.ts` | 🟡 vừa |
| 3 | **Fanuc** | **RMI (Remote Motion Interface) Operator's Manual (B-84184EN)** | JSON/FRC_/port 16001 → spec-verify `fanucDriver.ts` (cần option R632 trên controller) | 🔴 cao |
| 4 | **Delta** | **Delta Robot Language (DRL) Reference** + **Robot Controller Communication / Alarm Descriptions Manual** | Thay driver robot Delta hư cấu bằng protocol thật; alarm codes | 🔴 cao (nếu dùng robot Delta) |
| 5 | **Delta** | **AS300 Hardware/Operation Manual** (register-map ISPSoft HWCONFIG) | Map X/Y/M/S/D→Modbus cho preset AS300 | 🟡 vừa |
| 6 | **Omron** | **W506** (NJ/NX Built-in EtherNet/IP Port User's Manual) | Ports/route-path chính xác → Omron driver qua `ethernetIpDriver.ts` | 🟡 vừa |
| 7 | **Omron** | **W503** (NJ/NX Troubleshooting Manual) | Full 8-hex event-log codes → alarm taxonomy Omron đầy đủ | 🟢 thấp |
| 8 | **Zmotion** | **ZAux/zmcaux SDK** (`zauxdll.dll` + Function Reference) — *SDK binary, không phải PDF; tải từ Zmotion* | Hoàn thiện `ZmcLink.deploy()` qua FFI | 🟡 vừa |

**Không cần tải:** UR (kho đã đủ spec-verify ✅), manual hãng AOI (A.2.1 = API nội bộ), FINS Omron W596 (dùng EtherNet/IP thay thế).

*Ghi chú: các số hiệu SH-####/B-####EN/W### là mã tài liệu chính hãng — tìm theo mã trên trang hỗ trợ Mitsubishi/FANUC/Omron (thường cần tài khoản đối tác). Thả file vào `D:/SOURCES/AI Local/Manual/<Hãng>/` → tôi ingest + spec-verify lại.*
