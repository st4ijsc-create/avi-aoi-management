# 22 — Đánh giá Tính khả thi Hệ sinh thái & Kế hoạch Cải tiến (2 góc nhìn: Chuyên gia + Người dùng lần đầu)

> **Loại tài liệu:** Báo cáo đánh giá độc lập — *chờ DUYỆT trước khi gọi agent chuyên môn thực thi*.
> **Ngày:** 2026-07-01 · **Nhánh:** `automation-orchestration-r0`
> **Phương pháp:** (1) Chuyên gia tự động hóa/robotics/IoT kiểm chứng **code thật vs. tài liệu 16** trên 9 Khối + Frontend (7 agent khảo sát song song, đọc file thật, không tin tài liệu); (2) 1 agent đóng vai **quản lý xưởng lần đầu dùng** hệ sinh thái; (3) tổng hợp + xếp ưu tiên.
> **Tín hiệu khả thi kỹ thuật:** `npm run check` (tsc --noEmit) toàn repo **PASS (exit 0)** — server + client (~161 trang) biên dịch sạch, 0 lỗi type.

---

## 0. Tóm tắt điều hành (đọc trong 60 giây)

**Kết luận lớn nhất:** Hệ thống này **được xây thật, không phải vaporware**, và **trung thực một cách bất thường** — hầu hết stub/framework được *ghi rõ trong chính code* ("NOT a production driver", "HONEST scaffold", banner an toàn không tắt được). Đây là điểm mạnh hiếm có và cần bảo vệ. Tài liệu 16 phần lớn **chính xác**, với vài chỗ **nói quá** cần chỉnh cho đúng.

Nhưng "khả thi" phải tách làm 3 lớp:

| Lớp khả thi | Trạng thái |
|---|---|
| **Biên dịch / kiến trúc** | 🟢 Sạch. Golden thread (`telemetryBus → ot_telemetry`) nối đúng. Command path (HITL + dry-run + idempotency + interlock + audit append-only) là kỹ thuật an toàn tốt. |
| **Chạy thật (runtime)** | 🟡 **Gần như toàn bộ tính năng automation đang TẮT CỜ.** "Production" hiện là *khát vọng*, chưa được chứng minh trên phần cứng/tải thật. |
| **Sẵn sàng bật cờ** | 🔴 Có **2 lỗi đúng-đắn phải sửa trước khi bật** (race reservation Khối 2; deploy không ép Simulation Gate Khối 6) + migration chưa xác nhận apply. |

**3 việc phải làm trước tiên (P0):** sửa race TOCTOU zone-reservation · ép deploy phải qua Simulation Gate pass · xác minh trạng thái migration trên DB thật.

**Nợ trung thực tài liệu (P1):** hạ 1B từ 45%→30% · bỏ claim "React Flow editor" (sai) · bỏ claim "conformance CI" (chưa nối CI) · sửa đường dẫn & "D*"/"telemetryBus subscription" của Khối 2 · thang màu 50–900 chưa có.

**Góc nhìn người dùng lần đầu:** *trải nghiệm được thiết kế cho họ* (trang chủ theo vai trò + "Today briefing" + Ops Console War Room) **xuất sắc**; nhưng *trải nghiệm menu* thì như một nền tảng kỹ thuật automation quên mất người dùng là quản lý xưởng — **quá tải ~115–119 link, đầy thuật ngữ, lẫn lộn Việt–Anh, nhiều dashboard trùng**.

---

## 1. Bảng điểm trưởng thành: Tài liệu tuyên bố vs. Kiểm chứng thực tế

Quy ước: 🟢 production-grade (logic thật, có test) · 🟡 framework/flag-off · 🔴 stub/thiếu. **Lưu ý: "production-grade" ở đây = chất lượng code, KHÔNG đồng nghĩa đã chạy thật** (đa số flag OFF, chưa kiểm phần cứng).

| Khối | Vai trò | Doc 16 | **Kiểm chứng** | Chênh & lý do |
|---|---|---:|---:|---|
| **0** | Cổng ERP | 50% | **~55%** 🟢 | Trung thực, hơi *khiêm tốn*. Inbound orders/BOM + outbox + circuit-breaker THẬT — nhưng outbox **chưa có producer** (đường ống rỗng). |
| **1** | Field/Device Abstraction | 75% | **~70%** 🟡 | Driver OPC-UA/Modbus/S7/MC/EIP **thật** (lib có trong node_modules), golden thread nối đúng. Nhưng **poll-only** (chưa monitored-items), 100% flag-off, chưa kiểm PLC thật. |
| **1B** | Equipment Integration | 45% | **~30%** 🔴 | **NÓI QUÁ.** Chỉ **MTConnect** là tích hợp chạy được. SECS/GEM, FOCAS, Euromap là **codec/normalizer skeleton** tự-ghi-là-framework, không nói được với thiết bị. |
| **2** | Fleet & Task Orchestration | 35% | **~65%** 🟡 | *Cao hơn doc*. A*, deadlock-DFS 3-màu, allocator scorer, FOE runtime ISA-88 **thật + có test**. Nhưng **cờ tối**, **race TOCTOU**, đọc telemetry N+1, migration chưa xác nhận. |
| **3** | Human-Robot Collab / Safety | 20% | **~55–60% (phần mềm)** 🟢 | *Doc đánh giá thấp*. Zone evaluator 3-cấp thật (31 test), Andon→robot nối, audit SIL-tagged. **Không cờ đỏ an toàn** — phần mềm tuyệt đối không tự dừng-an-toàn. |
| **4** | AI/Analytics & Predictive | 85% | **~85%** 🟢 | **Chính xác.** Local LLM Qwen3 gọi thật (node-llama-cpp), PatchCore kNN thật, RAG embed+rerank thật. "Gap" hầu hết **đã code xong, chỉ tắt cờ**. |
| **5** | Standardization / Governance | 55% | **~55%** 🟡 | Chính xác. Governance workflow (SemVer, backward-compat) **thật + test** — nhưng **0% vận hành** (cờ off, "conformance CI" chưa nối CI). |
| **6** | IR & Transpiler | 55% | **~70%** 🟡 | *Cao hơn doc*. Simulation Gate = FK/collision/joint-limit **thật**; transpiler URScript + linter ISO/TS 15066 thật. Nhưng **"React Flow" SAI** & **deploy không ép sim-gate**. |
| **7** | Simulation & Digital Twin | 40% | **~50%** 🟡 | Kiến trúc thật (WS twinStream, URDF→glTF, replay Timescale) nhưng **mặc định = khối màu poll-5s**, asset chỉ `placeholder.invalid`, cell-sim là dữ liệu *mô phỏng* (`DEFECT_EVERY=8`) chứ không replay thật. |
| **FE** | Frontend / Design System | 75% | **~65–70%** 🟡 | Token layer + compound component **thật** nhưng chỉ **24% trang áp dụng** (39/161). **8 route automation lọt lưới license-gating**. Thang màu 50–900 **chưa có**. |

---

## 2. PHẦN A — Đánh giá của Chuyên gia (khả thi + cải tiến theo từng Khối)

### Khối 0 — Cổng ERP · 🟢 ~55%
- **Thật:** `server/api/v1/erpIntake.ts` (POST /orders, /bom — Zod versioned, idempotency qua `integration_inbound_idempotency`), `services/integration/erpOutbox.ts` (outbox bền + circuit-breaker in-house closed/open/half-open + dead-letter), API-key SHA-256 + scope, OAuth2/mTLS guard.
- **Khả thi:** logic vững; nhưng **outbox chưa có producer nào phát event** → đường ống rỗng. Circuit-breaker in-process (multi-instance cần state chung — ioredis đã có, chưa dùng).
- **Cải tiến:** (1) Nối ≥1 producer thật (quality-result khi inspection hoàn tất → `enqueueOutbox`). (2) Bật `ERP_INBOUND_ENABLED` ở profile staging để test hợp đồng thật. (3) Chưa có endpoint routing/material-availability (đã *từ chối tường minh* — trung thực).

### Khối 1 — Field & Device Abstraction · 🟡 ~70%
- **Thật:** 5 driver (OPC-UA/Modbus/S7/Mitsubishi-MC/EtherNet-IP) dùng lib thật, lazy-load, thiếu-lib-thì-throw (không giả). `otManager` → `subscribe(ingestSample)` → `telemetryBus` → `ot_telemetry`. `commandDispatcher` chặt chẽ (HITL, interlock, idempotency, dry-run mặc định, read-back verify).
- **Khả thi:** cao về code, **0 bằng chứng chạy trên PLC thật**, tất cả cờ off.
- **Cải tiến:** (1) OPC-UA thay poll bằng `ClientMonitoredItem` (push thật) — `opcuaDriver.ts:167`. (2) Test hardware-in-loop 1 driver với soft-PLC trước khi tuyên bố 75%. (3) Hot-plug discovery mới có cho OPC-UA browse; Modbus/S7/EIP chưa.

### Khối 1B — Equipment Integration · 🔴 ~30% (NÓI QUÁ trong doc)
- **Thật (chạy được):** chỉ **MTConnect** (`mtconnectClient.ts` + `mtconnectPoller.ts`) — HTTP /probe//current, map SAMPLE→bus, CONDITION→alarm→Andon.
- **Skeleton (tự-ghi-là-framework):** SECS/GEM (HSMS framing nhưng "NOT a production HSMS driver", thiếu SECS-II codec + GEM E30), FOCAS & Euromap (`readSnapshot()` trả `{connected:false}`, không có native lib), VDA5050 ("HONEST scaffold", `abort()` no-op).
- **Cải tiến:** (1) **Sửa doc: 45%→30%**, gọi đúng tên "framework". (2) SECS/GEM là gap giá-trị-cao nhất — tích hợp lib đã kiểm định hoặc xây SECS-II codec + báo cáo S1F1/S2F33. (3) Thêm `vda5050`/`mtconnect` vào enum DB (`robotVendorEnum`, `otProtocolEnum`) — hiện MTConnect mượn tạm enum `stub`.

### Khối 2 — Fleet & Task Orchestration · 🟡 ~65% (GAP #1 của doc, thực tế đã build nhiều)
- **Thật:** `fleet/taskAllocator.ts` (`scoreCandidates`: capability HARD-filter + battery-floor + distance/queue/priority weighting — không skeleton); `fleet/trafficManager.ts` (`detectDeadlockCycles` = DFS 3-màu thật); `twin/occupancyGrid.ts` (A* octile, no corner-cut); FOE runtime ISA-88 (`foeEngine.ts` ~900 LOC + simulator + IR + test); schema đầy đủ (`tasks/zones/zone_reservations/operation_codes/program_variants/shared_resources/charger_stations/...`); UI (`OrchestrationStudio`, `FleetOrchestration`) nối tRPC thật.
- **Rủi ro đúng-đắn:** **(P0) Race TOCTOU** — `reserveZone` đọc occupancy rồi INSERT **không transaction/lock/constraint** → 2 robot cùng đặt có thể vượt `maxConcurrentRobots` (cùng lỗi ở `resourceManager`). Đọc telemetry **N+1** per-robot (không phải bus subscription như doc nói). Path planner **grid tĩnh, chưa có robot-làm-vật-cản**. Migration `0142/0143` chạy bằng runner tùy biến, **journal drizzle chỉ tới idx 17** → chưa chứng minh đã apply.
- **Cải tiến:** (1) **Làm reservation atomic** (`db.transaction` + `SELECT … FOR UPDATE` hoặc partial-unique-index). (2) Xác minh + ghim migration state. (3) Quyết định cờ tường minh (`FLEET_ORCH_ENABLED`/`FLEET_RESOURCE_ENABLED` vắng khỏi `.env` → stack đang tối). (4) Thay N+1 bằng `DISTINCT ON`. (5) Mở rộng trigger rebalance (offline/heartbeat-timeout, không chỉ e-stop). (6) Sửa doc: path `fleet/` (không phải `task/traffic/resource/`), bỏ "D*".

### Khối 3 — Human-Robot Collaboration / Safety · 🟢 ~55–60% phần mềm (doc đánh giá THẤP)
- **Thật:** `safety/zoneIntrusionEvaluator.ts` (3 cấp `speed_reduce|stop|rated_stop`, hình học thuần, 31 test); `andonRobotDispatch.ts` (Andon → tạo `tasks` assist idempotent → allocator, lệnh robot vẫn qua gate dry-run); `safety_events` SIL-tagged; `operator_assignments`/`collaboration_sessions` (phát hiện xung đột lịch, FSM handover); `SafetyWorkforce.tsx` (banner trung thực **không tắt được**).
- **KHÔNG cờ đỏ an toàn:** `rated_stop` chỉ **log**, kèm ghi chú PLC phải actuate; PLC adapter **read-only**; vision backend mặc định `NoDetection` (không bịa người). Đúng nguyên tắc phần mềm không thay dừng-an-toàn.
- **Cải tiến:** (1) Thêm `plc`/`sim` vào `safetyEvents.detectedBy` (hiện gộp nhầm vào `telemetry`/`operator`). (2) **Nối nguồn upstream sống** cho `ingestProximity`/`ingestDetectionFrame` (nay chỉ chạy on-demand, không poller). (3) Điền `responseTimeMs` (đang null — cần cho PDCA ISO/TS 15066). (4) Hoàn tất seam YOLO ONNX (export `.onnx`). (5) Cần **phần cứng** cho rated-stop SIL 2/3, UWB/LiDAR — code đã hoãn đúng.

### Khối 4 — AI/Analytics & Predictive · 🟢 ~85% (chính xác, tài sản lớn nhất)
- **Thật (không phải heuristic đội lốt AI):** `aiGgufEngine.ts` gọi node-llama-cpp + spawn `llama-server` (Qwen3-30B/4B/VL-8B/Embedding-0.6B trong `.env`). PdM = hybrid MTBF/EWMA/Isolation-Forest/CUSUM (header tự nhận "không phải deep-ML" — trung thực). PatchCore = coreset + kNN + p99 threshold thật, degrade 3-tier có gắn cờ `source`. RCA Copilot gọi LLM GBNF-constrained + kỷ luật HITL (hạ cấp mọi WRITE fix thiếu tool/args). Model Router tier 0–4. RAG embed→cosine→rerank→GraphRAG 1-hop.
- **"Gap" đều đã build, chỉ tắt cờ:** sensor MQTT→`machineSensorReadings` (`sensorIngestService.ts`, cờ off), robot-behavior anomaly, model auto-rollback, PdM→work-order.
- **Cải tiến:** (1) **Bật + smoke-test** các cờ đã xong (ROI cao nhất). (2) **Auto-rollback trơ** vì không ai ghi `model_performance_snapshots` → thêm producer. (3) RCA vision `gatherEvidence(d)` luôn trả `null` — nối buffer ảnh nghi ngờ. (4) PatchCore: assert `modelCode`/dim khi build bank (tránh trộn không-gian vector).

### Khối 5 — Standardization / Governance · 🟡 ~55% (chính xác, framework)
- **Thật:** `capabilityModel.ts` (17 class), `packml.ts` (17-state ISA-TR88 thuần), `deviceTypeRegistry.ts` (kế thừa versioned + merge), `governanceService.ts` (**state machine thật** pending→published, `assessBackwardCompat` ép SemVer, chặn publish under-bump — có test).
- **Chưa vận hành:** cờ `EQ_GOVERN_ENABLED` vắng → tối. **"Conformance CI" NÓI QUÁ** — `runConformance` chỉ chạy trong vitest, **không có job `.github/workflows`** nào gọi.
- **Cải tiến:** (1) Bật cờ + seed ≥1 version published. (2) **Nối conformance vào CI thật** (fail khi vi phạm). (3) Sửa doc claim "conformance CI".

### Khối 6 — IR & Transpiler · 🟡 ~70% (cao hơn doc, nhưng 2 lỗ hổng)
- **Thật:** `sim/kinematicSimGate.ts` = **Simulation Gate động học thật** (FK DH/URDF, collision segment/capsule/AABB + self-collision, joint-limit, workspace, cycle-time trapezoid; no-model **KHÔNG bịa pass**). Transpiler URScript deterministic + golden test; ROS2 = skeleton trung thực. `irSafetyLinter.ts` (speed/force/workspace, ISO/TS 15066 250mm/s, lỗi **chặn cứng** transpile). IEC61131 one-scan sim thật (parser đệ quy, không `eval`). Deploy pipeline 2-eyes + rollback + append-only.
- **Lỗ hổng:** **(P0) `deployBuild` KHÔNG đọc `program_sim_runs`/`simGate`** → một flow gate `pass:false` vẫn deploy được khi bật cờ + HITL (dù `.env.example:1105` quảng cáo gate là một mắt xích deploy). **Claim "React Flow visual editor" SAI** — `IrEditor.tsx` là tree-card tùy biến, không có `reactflow`/`@xyflow`. `move_linear` **chưa có IK solver** (chỉ kiểm TCP proximity).
- **Cải tiến:** (1) **Ép Simulation Gate ở deploy** (đòi `program_sim_runs` gần nhất `pass===true`) — giá trị an toàn cao nhất. (2) Thêm IK solver → full-arm collision cho move_linear. (3) Sửa/loại claim "React Flow".

### Khối 7 — Simulation & Digital Twin · 🟡 ~50%
- **Thật nhưng tắt:** `twinStream.ts` (bus→coalesce→≤10Hz room `twin:{factoryId}`) nhưng `TWIN_LIVE_ENABLED=false` → fallback poll 5s. `urdfToGltf.ts` xuất glTF 2.0 hợp lệ; `equipment_3d_models` (mig 0144) lưu metadata. Replay Timescale `time_bucket` trên `ot_telemetry` thật. Scene-graph DB-driven factory→line→station→device thật.
- **Mặc định = khối màu:** `Factory3DScene`/`FactoryFloor3D` là `boxGeometry` tô màu; chỉ `DigitalTwinCenter` có `<Gltf>` nhưng model seed là `https://placeholder.invalid/*.glb` — **0 asset 3D thật**. `RfTestCellSim`/`CellTwinPlayer` phát **dữ liệu mô phỏng** (`DEFECT_EVERY=8`), không replay telemetry.
- **Cải tiến:** (1) Ship ≥1 glTF thật + convert 1 URDF thật → thay khối màu bằng `modelUri`. (2) Bật `TWIN_LIVE_ENABLED` + smoke-test <500ms. (3) Trỏ cell-sim sang `twinReplay` cho playback lịch sử thật. (4) Điền metric device bounds để sim gate "thấy" vật cản.

### Frontend / Design System · 🟡 ~65–70%
- **Thật:** token layer (`index.css` @theme + `patterns/tokens.ts`), compound components (`PageHeader/MetricCard/StatusBadge/EmptyState/Heading/SectionCard`), Storybook (7 story), nav data-driven (8 nhóm/21 mục/119 href, i18n `nav.*`).
- **Khoảng cách:** chỉ **39/161 trang** import patterns (107 trang còn `text-2xl font-bold` thủ công). **8 route automation lọt lưới `module-registry`** → `isRouteAllowed` trả `true` mặc định → **không license-gate được** (nợ tích hợp thật). Thang màu **50–900 chưa có** (chỉ OKLCH semantic). `ComponentShowcase.tsx` **chưa route**. `ViewerHome`/`AdminHome` mỏng.
- **Cải tiến:** (1) **Đăng ký 8 route automation vào module-registry** (đóng lỗ license — ROI cao, công thấp). (2) Roll DS ra top-20 trang ad-hoc (codemod `<PageHeader>`). (3) Route/xóa `ComponentShowcase`. (4) Làm sâu `ViewerHome`/`AdminHome`. (5) Thêm thang 50–900 hoặc sửa doc 17.

---

## 3. PHẦN B — Đánh giá của Người dùng lần đầu (quản lý xưởng, phi kỹ thuật)

> Nguyên văn cảm nhận persona, rút gọn. *"Trải nghiệm họ thiết kế cho tôi thì tuyệt; trải nghiệm cái menu cho tôi thì như một nền tảng automation quên rằng tôi là quản lý xưởng chứ không phải lập trình viên."*

**Điều đã tốt (giữ lại):**
- **Trang chủ theo vai trò** (`SupervisorHome`/`OperatorHome`/`ViewerHome`) — Operator nút to, găng-tay-bấm-được ("Quét máy / Báo sự cố").
- **"Today briefing"** — OEE/yield/NG/throughput ca hiện tại + danh sách "Cần chú ý" click thẳng vào NG. *Tính năng giá trị nhất cho quản lý bận.*
- **Ops Console / War Room** — 1 màn hình gộp Andon + predictive + interlock + MQTT + threshold, đèn đỏ + beep, chế độ TV, empty-state "All clear" xanh. *Đáng treo lên tường phòng điều hành.*
- **Trung thực dữ liệu** — "no telemetry yet" / "—" thay vì bịa số → tạo niềm tin.
- Có `UserGuide` FAQ + trang "xin nâng quyền" + tour chào mừng theo vai trò.

**Điều gây bối rối (cần sửa):**
1. **Menu quá tải** — 8 nhóm ổn, nhưng >100 link bên dưới; "Devices & OT" như vòi rồng.
2. **Thuật ngữ lập trình khắp nơi** — FOE, UNS, PackML, SECS/GEM, VDA5050, Sparkplug, IR Editor/Transpiler, Interlock, Cell Twin, Federation, MQTT bulletin/replay. *Không phân biệt được cái nào cho tôi vs. cho IT/kỹ sư.*
3. **Lẫn lộn ngôn ngữ** — trang chủ + guide tiếng Việt, nhưng Ops Console/Command Center tiếng Anh ("War Room", "Alert Center"). *Như 2 sản phẩm ghép lại.*
4. **Nhiều "home" chồng chéo** — Command Center, Dashboard, Dashboard Center, Production/OEE/Corporate Dashboard, Drill-down... *Đâu là màn hình nguồn-sự-thật của tôi?*
5. **Mùi nửa-vời/chuyên-gia** — vài mục rõ ràng là framework chưa sống ("read-only, no live device", RF Test Cell, IR Editor) nằm chung menu với công cụ hằng ngày, không nhãn "nâng cao/cần thiết lập".

**Yêu cầu cải tiến (xếp ưu tiên):**
1. **"Simple mode"** — mặc định hiện ~5 nhóm (Overview/Production/Quality/Alerts/Reports), giấu Devices-OT/AI-ops/Federation/Engineering sau toggle "Nâng cao / Kỹ thuật".
2. **Một "Start here" duy nhất** — chọn 1 home làm mặc định, nhãn rõ phần còn lại.
3. **Nhãn ngôn ngữ đời thường + tooltip** cho mọi thuật ngữ; nếu dành cho kỹ sư thì ghi rõ.
4. **Một ngôn ngữ nhất quán** — dịch Ops Console/Command Center.
5. **Gắn badge "Beta / Cần thiết lập"** cho trang framework.
6. "Xin nâng quyền" nên **báo admin in-app**, không chỉ mở email.
7. Tour chào mừng **mở lại được** (nút "?").

---

## 4. PHẦN C — Phát hiện xuyên suốt (tổng hợp)

**(a) Lỗi đúng-đắn phải sửa trước khi bật cờ:**
- **Race TOCTOU** ở `fleet/trafficManager.reserveZone` + `fleet/resourceManager.reserve` (không transaction/lock) → vượt sức chứa zone / double-claim resource.
- **`programmingService.deployBuild` không ép Simulation Gate** — có thể deploy flow gate-fail.
- **Migration apply-state chưa xác minh** (runner tùy biến vs journal drizzle idx 17).

**(b) Nợ trung thực tài liệu (uy tín):**
- 1B 45%→30%; "React Flow editor" sai; "conformance CI" chưa nối CI; Khối 2 sai đường dẫn + "D*" + "telemetryBus subscription"; thang màu 50–900 chưa có; `.env` có `FOE_ENABLED=true` (doc nói OFF) nhưng `FLEET_ORCH_ENABLED` vắng → stack allocator vẫn tối.

**(c) "Đã xong nhưng đang tối" — bật là dùng được (ROI cao):**
`PDM_SENSOR_INGEST`, `PDM_AUTO_WORKORDER`, `AI_ROBOT_ANOMALY`, `EQ_GOVERN`, `WORKFORCE`, `SAFETY_AUDIT`, `ANDON_ROBOT_DISPATCH`, `MTCONNECT`, `TWIN_LIVE` — code có + test, chỉ thiếu bật cờ + smoke-test + (vài cái) nối producer tín hiệu.

**(d) Đường ống rỗng / seam cần nối:**
outbox ERP (chưa producer) · `model_performance_snapshots` (auto-rollback trơ) · safety proximity/detection (chưa upstream sống) · RCA vision evidence (`null`) · asset 3D thật (chỉ placeholder).

**(e) Cần phần cứng — ngoài phạm vi phần mềm:**
Safety PLC SIL 2/3 + UWB/LiDAR (Khối 3) · export YOLO `.onnx` + hiệu chuẩn camera · FOCAS Fwlib32 · EtherCAT real-time · IK solver + glTF/URDF thật (twin) · HIL test driver OT.

---

## 5. PHẦN D — Kế hoạch cải tiến đề xuất *(CHỜ DUYỆT — chưa gọi agent thực thi)*

> Mỗi giai đoạn = 1–N agent chuyên môn, flag OFF mặc định, có exit-criteria + smoke-test, không phá golden-thread. Thứ tự theo **rủi ro trước, giá-trị/công-sức sau**.

| GĐ | Tên | Ưu tiên | Nội dung | Agent đề xuất | Exit-criteria |
|---|---|---|---|---|---|
| **P0** | Sửa lỗi đúng-đắn | 🔴 Bắt buộc trước mọi bật-cờ | Reservation atomic (transaction + FOR UPDATE/unique-index); deployBuild ép sim-gate pass; xác minh migration 0142–0154 trên DB | backend-safety + db | Test đồng thời không vượt zone-cap; deploy flow gate-fail bị chặn; script check-migration xanh |
| **P1** | Đồng bộ trung thực tài liệu | 🔴 Uy tín | Sửa doc 16/17: 1B→30%, bỏ "React Flow"/"conformance CI"/"D*", sửa path Khối 2, thang màu; ghi rõ cờ posture | doc-writer | Doc khớp code (spot-check) |
| **P2** | Bật tính năng đã-xong-đang-tối | 🟡 ROI cao | Bật + smoke-test PDM_SENSOR/PDM_AUTO_WORKORDER/AI_ROBOT_ANOMALY/EQ_GOVERN/WORKFORCE/SAFETY_AUDIT/MTCONNECT; nối producer outbox + model_perf_snapshots + safety upstream | backend x2 | Mỗi cờ có 1 luồng end-to-end quan sát được |
| **P3** | Nợ tích hợp | 🟡 | Đăng ký 8 route automation vào module-registry; thay N+1 telemetry bằng DISTINCT ON; mở rộng trigger rebalance; OPC-UA monitored-items push | backend + frontend | Route bị license-gate; allocator 1 query; push OPC-UA thật |
| **P4** | UX / Frontend (song song) | 🟡 | "Simple mode" nav + Advanced toggle; chọn 1 home; nhãn đời thường + tooltip; nhất quán ngôn ngữ; badge Beta; roll DS top-20; làm sâu Viewer/AdminHome | frontend x2 + i18n | Người-mới tìm 3 tác vụ lõi <30s; 1 ngôn ngữ; DS phủ top-20 |
| **P5** | Chiều sâu robotics/twin (phần mềm) | 🟢 Sau P0–P3 | IK solver + full-arm collision; glTF/URDF thật; TWIN_LIVE + replay thật cho cell-sim; SECS-II codec | robotics + twin | move_linear qua sim-gate thật; twin render geometry thật |
| **P6** | Phần cứng (mua sắm, ngoài code) | ⚪ Song song, phụ thuộc CAPEX | Safety PLC SIL 2/3, UWB/LiDAR, camera + YOLO onnx, FOCAS Fwlib32, EtherCAT | (không phải agent) | Nghiệm thu theo ISO 10218/TS 15066 |

**Phụ thuộc:** P0 → (P2, P3) · P1 độc lập (làm ngay) · P4 song song xuyên suốt · P5 sau P3 · P6 theo CAPEX.

---

## 6. Khuyến nghị của Chuyên gia (kết luận)

Đây là một hệ thống **ấn tượng và trung thực** — hiếm khi thấy một codebase automation quy mô này mà stub được ghi rõ và nguyên tắc an toàn được tôn trọng tuyệt đối (phần mềm không tự dừng-an-toàn). Về **tính khả thi**: kiến trúc và code **khả thi**; nhưng hệ đang ở trạng thái *"đã xây, chưa bật, chưa kiểm phần cứng"* — nên đừng nhầm "compile sạch + test xanh" với "chạy được ở nhà máy thật".

**Đề xuất thứ tự duyệt:** ưu tiên **P0 (sửa 3 lỗi đúng-đắn)** và **P1 (đồng bộ tài liệu)** ngay — chúng bảo vệ cả an toàn lẫn uy tín, chi phí thấp. Sau đó **P2/P4** cho giá trị nhìn-thấy-được nhanh (bật tính năng đã xong + dọn UX cho người dùng thật). P5/P6 là chiều sâu dài hạn.

> **CỔNG DUYỆT:** Tôi sẽ **không** gọi agent chuyên môn thực thi cho tới khi bạn duyệt/điều chỉnh phạm vi & thứ tự ở **§5**. Bạn có thể duyệt toàn bộ, chọn một số GĐ, hoặc đổi ưu tiên.

---

## 7. CẬP NHẬT TIẾN ĐỘ & ĐÁNH GIÁ SO VỚI MỤC TIÊU — 2026-07-02

> Người dùng **duyệt toàn bộ P0–P5 (phần mềm)** ngày 2026-07-01 → đã thực thi. **8 commit** trên nhánh `automation-orchestration-r0`. **Sức khỏe hiện tại:** `npm run check` sạch · full suite **2620 pass / 0 fail / 8 skip** (247 file).

### 7.1 Trạng thái thực thi theo §5

| GĐ | Mục tiêu §5 | Trạng thái | Commit | Còn lại |
|---|---|---|---|---|
| **P0** | Sửa 3 lỗi đúng-đắn (race reservation · deploy ép sim-gate · verify migration) | ✅ **XONG** (verify trên DB thật) | `3f7b46b` | — |
| **P0.3** | Verify/reconcile migration | ✅ **XONG** — phát hiện dev DB kẹt ở **0130**, đã áp **24 migration → 0156** | `3f7b46b` + `db:push` | — |
| **P1** | Đồng bộ trung thực tài liệu 16/17 | ✅ **XONG** | `e76d15a` | — |
| **P2** | Bật cờ + nối producer | 🟡 **Producer XONG** (model-perf snapshot · RCA vision · safety upstream; outbox vốn đã có). **Cờ vẫn OFF** — chưa smoke-test dữ liệu/phần cứng thật | `0c6a2f0` | Flip cờ + smoke-test (ops) |
| **P3** | Nợ tích hợp (license-gate · N+1 · rebalance · OPC-UA push) | ✅ **XONG** | `de1b448` | — |
| **P4** | UX/Frontend | 🟡 **Một phần** — Simple/Advanced nav · 16 jargon hints · 12 Beta badges · nhất quán ngôn ngữ **XONG**; **Dashboard đã align DS**. Chưa: gộp "một home" · roll DS ra ~106 trang còn lại · làm sâu Viewer/AdminHome | `05fb0bd`, `2b3f6fc` | DS rollout breadth · one-home · thin homes |
| **P5** | Chiều sâu robotics/twin (phần mềm) | 🟡 **Cốt lõi XONG** — IK solver (DLS) → full-arm collision cho move_linear · 2 glTF thật · SECS-II codec + S1F1/F2/F13/F14. Chưa: full GEM E30 · D*/live-obstacle path · physics sim (Isaac/RoboDK) · IK redundancy | `d38d5cf` | Chiều sâu dài hạn |
| **P6** | Phần cứng | ⚪ **Ngoài phạm vi phần mềm** | — | CAPEX: SIL PLC · UWB/LiDAR · YOLO .onnx · FOCAS Fwlib32 · EtherCAT |

**Ngoài §5 (theo yêu cầu phát sinh trong phiên):**
- **Upload & đăng ký model 3D từ Machine Cockpit** (`d86d2d9`) — hiện thực hóa "một model thật/máy" mà P5/T1 để ngỏ: tab 3D `/machine/:id` có nút tải `.glb/.gltf` → `/uploads/models/` → `twin.models.uploadAndRegister` (gate RBAC, không cần TWIN_LIVE, không mở đường điều khiển). 8 test validate.
- **Align `/dashboard` theo design-system** (`2b3f6fc`) — mẫu đầu tiên của "DS rollout" (P4/F1): `<PageHeader>` + 16 màu palette → token semantic, giữ nguyên màu Recharts/`oeeColor`.

### 7.2 Đánh giá 3 lớp khả thi — CẬP NHẬT

| Lớp | Doc 22 (2026-07-01) | Nay (2026-07-02) |
|---|---|---|
| **Biên dịch / kiến trúc** | 🟢 Sạch | 🟢 Vẫn sạch (typecheck xanh mọi phase; full suite 2620/0) |
| **Đúng-đắn / sẵn-sàng-bật** | 🔴 Còn 2 lỗi chặn + migration chưa xác minh | 🟢 **Cải thiện rõ** — hết lỗi chặn, migration đã áp, producer đã sống, license-gate đã kín |
| **Chạy thật (cờ ON + phần cứng)** | 🟡 Gần như toàn bộ TẮT CỜ | 🟡 **Chưa đổi** — cờ vẫn OFF theo kỷ luật, chưa kiểm phần cứng → **đây là ranh giới còn lại** |

### 7.3 Kết luận đánh giá

Doc 22 kết luận hệ *"đã xây, chưa bật, chưa kiểm phần cứng"*. Sau phiên thực thi:

- **Phần "đã xây" nay đầy đủ + đúng hơn:** các lỗi đúng-đắn đã sửa & verify trên DB thật; các "producer đang ngủ" đã sống (auto-rollback có nguồn tín hiệu, vòng an toàn demo được end-to-end, RCA có bằng chứng ảnh); nợ tích hợp đã trả (license-gate, N+1, rebalance, OPC-UA push); UX dễ hơn hẳn cho người mới; twin có thể gắn **model 3D thật** cho từng máy qua UI; Simulation Gate có **IK** nên move_linear được kiểm va chạm toàn tay.
- **Phần "chưa bật / chưa phần cứng" vẫn là ranh giới** — nhưng nay **chỉ còn 2 rào, đều KHÔNG phải lỗi code:** (a) **ops flip cờ + smoke-test** trên staging, (b) **CAPEX phần cứng** (P6). Không còn rào "code sai / thiếu / nợ tích hợp".

**Trưởng thành cập nhật (code-maturity, vẫn flag-off):** khoảng cách gap-lớn của báo cáo đã thu hẹp ở Khối 2 (race + rebalance + N+1), Khối 3 (vòng an toàn demo-được), Khối 4 (loop đóng: auto-rollback + RCA vision), Khối 5 (license-gate), Khối 6 (IK), Khối 7 (model thật upload-được), Frontend (Simple-mode + Dashboard DS). **Trưởng thành vận hành (flag-on, real-data) chưa đổi** — chủ ý, chờ ops/phần cứng.

### 7.4 Bước kế tiếp đề xuất (không tự chạy — chờ chỉ đạo)

1. **Ops — flip nhóm cờ advisory an toàn** trên staging + smoke-test end-to-end: `PDM_SENSOR_INGEST` · `WORKFORCE` · `SAFETY_AUDIT` · `AI_MODEL_PERF_SNAPSHOTS` · `EQ_GOVERN` · `MTCONNECT` (đều read/advisory, không ghi thiết bị).
2. **Twin** — bật `TWIN_LIVE_ENABLED` + upload model thật cho vài máy trọng điểm (UI mới).
3. **P4 breadth** — roll DS ra top-20 trang còn ad-hoc · gộp "một home" nguồn-sự-thật · làm sâu ViewerHome/AdminHome.
4. **P6** — lập kế hoạch mua sắm phần cứng (SIL PLC, UWB/LiDAR, camera+YOLO, FOCAS, EtherCAT) để đạt nghiệm thu ISO 10218/TS 15066 & runtime thật.
