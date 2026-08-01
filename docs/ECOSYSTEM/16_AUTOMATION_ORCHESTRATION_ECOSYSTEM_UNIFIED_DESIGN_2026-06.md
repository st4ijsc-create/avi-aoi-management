# 16 — Hệ sinh thái Điều phối Robot & Tự động hóa: Thiết kế Hợp nhất & Nâng cấp

> Tài liệu thiết kế chi tiết — sẵn-sàng-ra-quyết-định, mở rộng từ báo cáo tham khảo *"Hệ sinh thái Điều phối Robot & Tự động hóa v1.0 (6/2026)"* và **ánh xạ vào codebase thực tế** của AVI/AOI Management.
> Hệ: React + tRPC + Drizzle/Postgres · Local-LLM brain (RTX 5090 32GB) · MQTT/Aedes · TimescaleDB.
> Ngày: 2026-06-30 · Đầu vào: báo cáo tham khảo (36 trang, Khối 0–7) + 6 báo cáo audit codebase (Khối 0/1/1B, 2, 3, 4, 5/6, 7+Frontend) + docs ECOSYSTEM 01–15.
> Tác giả: Principal Systems Architect (orchestration ecosystem).

> **Đính chính 2026-07-01 (theo doc 22 §C, P1):** một số con số/đường dẫn/tuyên bố đã được hiệu chỉnh cho khớp code thật — xem doc 22.

---

> ## ⓘ CẬP NHẬT TRẠNG THÁI THỰC THI — 2026-07-01
> Kế hoạch trong tài liệu này **đã được thực thi** trên nhánh `automation-orchestration-r0` (**32 commit**, migrations 0141–0154 áp dụng dev DB, mọi flag OFF, full test suite **2408/0 xanh**).
> - **Toàn bộ phần mềm hoàn thành:** R0·G1·G2 (Khối 2), T1 (Khối 7), S1 (Khối 3 sw), E1 (Khối 5), I1·X1 (Khối 1/1B), D1 (Khối 6), I2 (Khối 4), K0+ (Khối 0), F1+design-system 6-wave (Frontend, Storybook chạy), V1 seed+runbook, V3 CI-xanh.
> - **Nhóm C pre-hardware (doc 20) hoàn thành 6/6:** T2b Kinematic Simulation Gate (cổng chặn THẬT thay stub) · I3a URSim/ROS2 harness · T2a URDF→glTF · S2a zone evaluator 3-cấp · S2b vision/safety-PLC · I3b MTConnect/Euromap field-map.
> - **Maturity mới (TB ~53%→~85%):** K0 90 · K1 90 · K1B 70 · K2 85 · K3 60(sw) · K4 95 · K5 85 · K6 85 · K7 75 · Frontend 92.
> - **Chỉ còn phần cứng bất khả-thay-bằng-phần-mềm:** rated-stop SIL + UWB/LiDAR (S2), FOCAS Fwlib32, EtherCAT real-time, commissioning + export YOLO .onnx + hiệu chuẩn camera.
> - Chi tiết tiến độ: **doc 18** · Phân tích Nhóm C + runbook sim: **doc 20** · Design system: **doc 17** · Kích hoạt flag: **doc 19**.

---

## 0. Cách đọc tài liệu này

Tài liệu tham khảo (HeSinhThai_Robot_TuDongHoa.pdf) là **khung sườn kiến trúc tốt nhưng ở mức "greenfield"** — nó giả định xây mới từ đầu. Hệ thống AVI/AOI hiện tại **đã hiện thực ~60% khung đó**, phần lớn ở mức backend production hoặc framework-có-cờ-tắt. Vì vậy tài liệu này:

1. **Đánh giá** báo cáo tham khảo (§1) — điểm mạnh, điểm thiếu, điểm cần chỉnh cho phù hợp thực tế nhà máy điện tử/AOI.
2. **Đối chiếu** từng Khối với code thật (§2, ma trận trưởng thành + bằng chứng file).
3. **Thiết kế hợp nhất nâng cao** (§3–§11) — mỗi Khối: định nghĩa → trạng thái hiện tại → kiến trúc đích → **luồng vận hành** → mô hình dữ liệu → API → **giao diện (UI)** → khoảng cách cần lấp.
4. **Chương Frontend chuyên nghiệp** (§12) — design system, design tokens, thư viện 3D/twin, mẫu trang chuẩn.
5. **NFR + tech stack ánh xạ** (§13–14) và **lộ trình nâng cấp** (§15) — phần này là **kế hoạch chờ duyệt** trước khi gọi agent thực thi.

Nguyên tắc xuyên suốt (kế thừa doc 12): **CONSOLIDATE & INTEGRATE, không "xây thêm cho có".** Mọi năng lực robot/automation phải treo lên *golden thread* sẵn có: cảm biến → Unified Telemetry Bus → inspection/production/quality → AI → alert/Andon → dashboard/twin → hành động/feedback.

---

## 1. Đánh giá báo cáo tham khảo

### 1.1 Điểm mạnh của báo cáo

- **Phân tách Safety Loop khỏi Orchestration Loop** (Khối 3 dùng Safety PLC SIL 2/3 độc lập) — đúng chuẩn ISO 10218/TS 15066, đây là nguyên tắc *không thể thương lượng*. Hệ hiện tại đã có tinh thần này (flag OFF + HITL + dry-run) nhưng **chưa có lớp safety-rated phần cứng**.
- **Tầng ngữ nghĩa chung (Khối 5)** dùng OPC-UA Companion Spec + PackML + ISA-18.2 — chiến lược đã được kiểm chứng. Hệ hiện tại **đã có PackML + Capability Model** nhưng thiếu governance.
- **Hướng B cho lập trình thiết bị (Khối 6)**: IR + Transpiler + Simulation Gate cứng — an toàn hơn viết tay. Hệ hiện tại **đã có Simulation Gate + deployment pipeline** (doc 09).
- **Dùng chung 1 nguồn model 3D cho sim và viz (Khối 7)** — tránh "digital twin lỗi thời", là rủi ro thực tế số 1.
- **Ma trận rủi ro & độ trễ theo khối** rõ ràng, có giá trị tham chiếu.

### 1.2 Điểm thiếu / cần chỉnh cho phù hợp thực tế

| # | Vấn đề của báo cáo | Hệ quả | Điều chỉnh trong thiết kế này |
|---|---|---|---|
| C-1 | **Bỏ qua bài toán bối cảnh AOI/điện tử** — báo cáo viết generic cho "robot di động + humanoid". Nhà máy này lõi là **AOI/AVI/SPI/SMT + test cell**, robot chủ yếu là **cobot/SCARA cố định + AGV nội bộ**, hiếm humanoid. | Đầu tư sai trọng tâm (humanoid/AMR fleet quy mô lớn) | Trọng tâm: **cobot/test-cell orchestration + AOI-in-the-loop**; AGV/humanoid là *mở rộng tương lai*, không phải GĐ đầu. |
| C-2 | **Khối 0 coi ERP/MES là "bên ngoài"** — nhưng hệ này *chính là* MES (có MES Control Tower, WIP, genealogy, scheduling). | Vẽ lại lớp đã có | Khối 0 ở đây = **cổng ERP-inbound + cổng publish ra ERP cấp trên**, KHÔNG phải tích hợp MES (MES là nội tại). |
| C-3 | **Không nói gì về AI brain đã có** — báo cáo coi AI/Analytics (Khối 4) như xây mới với Triton/PyTorch. | Bỏ phí khối tài sản lớn nhất | Khối 4 **tái dùng local-LLM brain (Qwen3) + RCA copilot + anomaly + MLOps** đã chín (~85%). |
| C-4 | **Không có chương Frontend/UX** — chỉ liệt kê three.js/Unity ở stack. | Thiếu yêu cầu "frontend chuyên nghiệp & đẹp" mà bạn đặt ra | Bổ sung **§12 Frontend Design System** đầy đủ (tokens, mẫu trang, 3D pipeline). |
| C-5 | **Telemetry pipeline tách rời** mỗi khối tự đẩy → dễ thành silo (đúng lỗi P-2 hệ hiện tại). | Lặp lại sai lầm phân mảnh | Bắt buộc **1 Unified Telemetry Bus** (đã khởi tạo: `telemetryBus.ts`, `ot_telemetry`). |
| C-6 | **Lịch sử thời gian/ngân sách = mơ hồ** ("vài tuần → vài ngày"). | Khó lập kế hoạch | §15 dùng **phase E/D/F/R thực tế của repo** + cờ tính năng từng bước. |
| C-7 | **Bỏ qua multi-tenant/RLS** — nhà máy này multi-site, multi-tenant (federation doc 13). | Rò rỉ dữ liệu chéo tenant | Mọi schema mới **bắt buộc tenant-scope + RLS** (xem P-tenant). |

**Kết luận đánh giá:** báo cáo là *điểm khởi đầu tốt cho phần robotics/safety/transpiler/twin* mà hệ còn yếu (Khối 2, 3, 6-semantic, 7-physics), nhưng **lạc đề ở Khối 0/1/1B/4** vốn hệ đã mạnh. Thiết kế này giữ phần đúng, bỏ phần lặp, và **đẩy lên mức cao hơn báo cáo** ở chỗ: có luồng chi tiết, có UI cụ thể, có ánh xạ file, có golden-thread tích hợp.

---

## 2. Ma trận trưởng thành: Hệ hiện tại vs. Báo cáo

Quy ước maturity: 🟢 production · 🟡 framework/flag-off/partial · 🔴 stub/thiếu.

| Khối | Vai trò | Maturity | Bằng chứng (file lõi) | Khoảng cách chính |
|---|---|---|---|---|
| **0** | Cổng ERP/MES | 🟡 ~50% | `server/api/v1/router.ts`, `webhookRouter.ts`, `apiKeyRouter.ts`, `commandDispatcher.ts` (idempotency) | Inbound work-order/BOM/material; retry queue bền; circuit breaker; OAuth2/mTLS; genealogy export; ISA-95/B2MML |
| **1** | Device Abstraction | 🟢 ~75% | `equipment/equipmentAdapter.ts`, `capabilityModel.ts`, `packml.ts`, `ot/drivers/*` (OPC-UA/Modbus/S7/MC/EIP), `uns/sparkplugNode.ts`, `telemetryBus.ts` | ROS2/DDS; EtherCAT; push-streaming (đang poll 5s); battery/joint_states/safety_zone trong UDM; hot-plug discovery; alarm dictionary; command-level authz |
| **1B** | Equipment Integration | 🟡 ~30% | `mtconnect/*` (poller — tích hợp CHẠY THẬT duy nhất); `secsgem/hsmsClient.ts`, `focas/focasAdapter.ts`, `euromap/euromapAdapter.ts` (**framework skeleton — chưa nối thiết bị**: `readSnapshot()` trả `{connected:false}`, tự dán nhãn "not GEM compliance / no native library"); `vda5050/*` (framework), `uns/*` | FOCAS, Euromap, OPC-UA Companion validate; alarm-code mapping; recipe versioning; production-counter audit |
| **2** | Fleet & Task Orchestration | 🟡 ~35% | `orchestration/foe/*` (FOE engine, flag `FOE_ENABLED` OFF), `robot/robotManager.ts`, `vda5050/*`, `dispatchingService.ts` (WIP ranking) | **Task entity + capability matching; Zone + traffic/path (occupancy grid, deadlock, reservation); Operation→Skill→Program; A/B; predictive charging; shared-resource registry** |
| **3** | Human-Robot Collab | 🔴 ~20% | `andon/andonService.ts` (signal-only), `interlock/interlockEngine.ts` (line-level), `robot/robotCommandDispatcher.ts` (dry-run gate), `QuickIssueReport.tsx` | **Dynamic safety zoning; mixed-workforce scheduling; skill-handover; SIL safety-event audit; near-miss CV; physical button/light; E-stop PLC độc lập** |
| **4** | AI/Analytics & Predictive | 🟢 ~85% | `predictiveMaintenanceService.ts`, `llamaVisionSidecar.ts`, `aiAnomalyDetection.ts`, `aiRcaCopilot.ts`, `aiModelRouter.ts`, MLOps (`aiDatasetBuilder/aiEvalHarness/aiSelfLearningScheduler`) | Wiring MQTT sensor→`machineSensorReadings`; robot-behavior anomaly; model auto-rollback; (Triton optional) |
| **5** | Multi-vendor Standardization | 🟡 ~55% | `equipment/capabilityModel.ts` (17 class), `packml.ts` (ISA-TR88), `equipmentRegistry` | Equipment Standards Board governance; conformance CI; compliance dashboard; device-type hierarchy tree; ISA-18.2 alarm taxonomy lộ ra; SemVer enforce |
| **6** | IR & Transpiler | 🟡 ~55% | `programming/programmingService.ts` (Simulation Gate + deploy), `programming/iec61131/*`, `zmotion/*`, `orchestration/foe/workflowModel.ts` (IR), `EngineeringWorkspace.tsx`, `OrchestrationStudio.tsx` | Semantic safety linter (speed/workspace/torque); motion-block IR first-class; IR↔source comment; regression suite; graph editor (React Flow); transpiler real-HW |
| **7** | Simulation & Digital Twin | 🟡 ~40% | `FactoryFloor3D.tsx`, `Factory3DScene.tsx`, `FactoryLiveMap3D.tsx`, `DigitalTwinDashboard.tsx`, `RfTestCellSim.tsx`, `CellTwinPlayer.tsx` (three.js + fiber + drei) | Physics sim (Isaac/Gazebo/RoboDK); CAD/URDF→glTF pipeline; scene-graph zone→station→device; replay từ TimescaleDB; WS streaming <500ms; multi-viewer |
| **FE** | Frontend / Design System | 🟢 ~75% | shadcn/Radix/Tailwind v4, `navigation.tsx` (R4 cascading), `CommandPalette/MegaMenuOverlay/BottomNav`, i18n vi/en/zh | Design tokens; type scale; semantic color shades; Storybook; responsive/a11y audit; multi-tenant theming |

**Trọng tâm nâng cấp (theo gap lớn nhất):** Khối 2 → Khối 3 → Khối 7 → Khối 6(semantic) → Khối 5(governance) → Khối 1B → Khối 0 → hoàn thiện 1/4 → §12 Frontend.

---

## 3. Kiến trúc tổng thể hợp nhất

### 3.1 Nguyên lý thiết kế (kế thừa + mở rộng báo cáo)

1. **Safety Loop tách biệt tuyệt đối** khỏi Orchestration Loop. An toàn không bao giờ phụ thuộc phần mềm có thể lỗi → Safety PLC SIL 2/3 phần cứng (Khối 3). Phần mềm chỉ *giám sát + báo cáo + propose*, không thay thế safety-rated stop.
2. **1 Unified Telemetry Bus** (đã có `telemetryBus.ts` + `ot_telemetry`): mọi protocol (OPC-UA/Modbus/S7/MC/EIP/MQTT-Sparkplug/MTConnect/SECS/VDA5050/ROS2) đổ về 1 đường chuẩn hóa → fan-out song song tới Orchestration (Khối 2), Safety (Khối 3), AI (Khối 4), Twin (Khối 7).
3. **1 Canonical Equipment Model (UEM)**: UDM (robot/AMR) + UEM (máy tĩnh) hợp nhất qua `capabilityModel.ts`, kế thừa đa cấp, PackML behavior, alarm chuẩn hóa (Khối 5).
4. **Mọi lệnh ghi thiết bị đi qua 1 gate duy nhất**: flag OFF mặc định + HITL sign-off + dry-run + idempotency + audit append-only (`commandDispatcher`/`robotCommandDispatcher`/`programmingService`). Khối 6 transpile cũng qua gate này.
5. **Real-time vs. async tách rõ**: control/safety (<100ms) vs. AI/analytics/report (async qua message queue). AI **không bao giờ** nằm trên critical path điều khiển.
6. **Multi-tenant + RLS bắt buộc** cho mọi entity mới (federation-ready, doc 13).
7. **Golden thread**: mọi module treo lên trục sensor→bus→inspection/prod/quality→AI→alert/Andon→twin→action→feedback. Không module mồ côi.

### 3.2 Sơ đồ luồng dữ liệu tổng thể

```
                          ┌────────────────────────── ERP cấp trên (SAP/Oracle/IFS) ─────────────────────────┐
                          │  Khối 0: inbound (work-order/BOM/material) · outbound (events/quality/OEE/genealogy) │
                          └───────────────────────────────────────▲───────────────────────────────────────────┘
                                                                   │ OAuth2/mTLS · retry-queue · circuit-breaker · ISA-95
   ┌──────────── FIELD ────────────┐     ┌─────────── UNIFIED TELEMETRY BUS (telemetryBus.ts / ot_telemetry / MQTT) ──────────┐
   │ Khối 1: Robot/AMR/Cobot       │────▶│  chuẩn hóa → UEM/UDM (Khối 5) → fan-out song song:                                │
   │  OPC-UA·ROS2·Modbus·Sparkplug │     │     ├─▶ Khối 2 Orchestration (task alloc · traffic · skill · charging)  <500ms   │
   │ Khối 1B: CNC/SMT/PLC/AOI      │────▶│     ├─▶ Khối 3 Safety Layer (zoning · interlock · Andon)  <100ms  [độc lập PLC]  │
   │  SECS/GEM·MTConnect·FOCAS·VDA │     │     ├─▶ Khối 4 AI/Analytics (PdM · vision · anomaly · RCA)  async              │
   └───────────────────────────────┘     │     └─▶ Khối 7 Digital Twin (live shadow · replay · sim gate)  ~500ms         │
                                          └────────────────────────────────────────────────────────────────────────────────┘
            ▲ Khối 6: IR Editor → Safety Linter → Transpiler → Simulation Gate (Khối 7) → Deploy Pipeline (HITL 2-eyes) ┘
            │ (mọi chương trình xuống máy thật đều qua gate cứng; flag OFF mặc định)
```

---

## 4. Khối 0 — Cổng tích hợp ERP (Integration Gateway)

**Định nghĩa (điều chỉnh C-2):** Hệ này *là* MES → Khối 0 chỉ là (a) cổng **inbound** nhận lệnh từ ERP cấp trên, (b) cổng **outbound** publish kết quả lên ERP/data-lake. Không tái thiết kế MES nội tại.

**Hiện trạng:** `/api/v1` (scope-auth, OpenAPI), idempotency per-command (`commandDispatcher`), audit append-only, webhook HMAC (flag OFF), API-key hash-only. **Thiếu:** inbound order/BOM/material, retry-queue bền, circuit-breaker, OAuth2/mTLS, genealogy export chuẩn, ISA-95/B2MML.

**Kiến trúc đích:**
- **Inbound**: `POST /api/v1/orders` · `POST /api/v1/bom` · `POST /api/v1/routing` · `POST /api/v1/material-availability` — idempotency-key bắt buộc, Zod schema versioned (`schemaVersion` trong envelope), map vào `production_orders`/`bom`/`materials`.
- **Outbound**: `production-events` · `quality-results` (AOI/vision) · `oee-metrics` · `genealogy-records` — push event-driven qua **outbox pattern** (bảng `integration_outbox`) + worker đẩy với retry/backoff + circuit-breaker per-endpoint.
- **Reliability**: thay in-process retry bằng **durable queue** (BullMQ trên Redis đã có, không cần Kafka cho quy mô này) + dead-letter + circuit-breaker (`opossum`).
- **Security**: OAuth2 client-credentials cho ERP đối tác + mTLS tùy chọn cho webhook nhạy cảm.

**Luồng (inbound work-order → production):**
```
ERP POST /orders (idem-key) → validate(Zod+schemaVersion) → upsert production_orders
  → emit eventBus("order.created") → Khối 2 Task Allocation phân rã thành tasks
  → ACK 202 + outbox "order.accepted" (worker đẩy về ERP, retry nếu fail)
```

**UI:** trang `Admin → Integrations` (mới, gộp vào module ADMIN): danh sách connector ERP, trạng thái circuit-breaker (đóng/mở/half-open), outbox backlog, lần đẩy gần nhất, retry thủ công, log schema-mismatch. Tái dùng mẫu RBAC per-procedure của `energyRouter`.

---

## 5. Khối 1 — Field & Device Abstraction Layer

**Hiện trạng (🟢 mạnh):** `equipmentAdapter.ts` facade trên 11 adapter-kind; drivers thật OPC-UA/Modbus/S7/Mitsubishi-MC/EtherNet-IP + MQTT Sparkplug; `capabilityModel.ts` (canonical command/telemetry/PackML); `telemetryBus.ts`; Socket.IO room `machine:/line:/factory:`.

**Khoảng cách → kiến trúc đích:**
1. **Mở rộng UDM** cho robot di động/cobot: thêm `position{x,y,z,orientation}`, `battery_level`, `joint_states[]`, `safety_zone_id`, `firmware_version`, `last_heartbeat` (TTL stale-detect). Bổ sung cột vào `robotTelemetry` + chuẩn hóa trong UEM.
2. **Push streaming** thay poll 5s: kênh WS `devices/{id}/state/stream` + topic-tier sampling (AMR pos 10Hz, máy 1Hz, nhiệt 0.1Hz) — dùng Sparkplug DDATA + Socket.IO; giữ poll làm fallback.
3. **ROS2/DDS bridge** (driver mới `ros2Driver.ts`): cầu nối ROS2 topic ↔ UNS cho cobot/humanoid tương lai. *Ưu tiên thấp* (C-1: nhà máy ít humanoid).
4. **Hot-plug discovery**: `POST /api/v1/devices/discover` (OPC-UA browse / mDNS) tự đăng ký vào registry, không cần restart.
5. **Command-level authorization**: RBAC per-command (đã có `requiredPermission` trong descriptor) → enforce ở dispatcher.
6. **E-stop command** chuẩn hóa: `POST /devices/{id}/commands/e-stop` (REST + hardware interlock — phối hợp Khối 3).

**Luồng (telemetry ingest):** `driver poll/subscribe → normalize(UEM) → telemetryBus.publish → [ot_telemetry insert + Socket emit + fan-out Khối 2/3/4/7]`. Heartbeat timeout 2s → trạng thái `lost_connection` → kích hoạt quy trình an toàn.

**UI:** nâng `device-monitor` + `factory-live-map`: thêm panel battery/joint/heartbeat, stream realtime, badge "live vs stale".

---

## 6. Khối 1B — Equipment Integration (đa nhà cung cấp)

**Hiện trạng (🟡 ~30%):** chỉ **MTConnect** (`mtconnect/*`) là tích hợp **chạy thật** (poller, field-map). **SECS/GEM** (`secsgem/hsmsClient.ts`), **FOCAS** (`focas/focasAdapter.ts`), **Euromap** (`euromap/euromapAdapter.ts`) là **framework skeleton — chưa nối thiết bị**: `readSnapshot()` trả `{connected:false}`, code tự dán nhãn honesty ("NOT a production HSMS driver / no native library linked — honest"). VDA5050 (Order/InstantActions, framework), Sparkplug B (production).

**Kiến trúc đích:**
1. **Unified Equipment Model (UEM)** mở rộng UDM với trường máy tĩnh: `recipe_id`, `cycle_count`, `alarm_code`, `utilization_rate`, `production_counter`.
2. **Adapter mới theo nhu cầu thực tế** (ưu tiên theo thiết bị nhà máy có): **FOCAS** (Fanuc CNC) · **Euromap 63/77/83** (máy ép nhựa nếu có) · **OPC-UA Companion Spec validate** (kiểm tra semantic type). Mỗi adapter là microservice/connector đăng ký vào Equipment Registry, dịch sang UEM.
3. **Alarm code dictionary** (`alarm_taxonomy` table, Khối 5 quản trị): map mã lỗi gốc từng hãng → mã chuẩn nội bộ + severity + recommended-action (ISA-18.2).
4. **Recipe versioning**: `recipes.version`/`status` (draft/released/archived) + rollback + log ai-nạp-recipe-nào (genealogy).
5. **Read-only monitoring mode bắt buộc**: mọi adapter giám sát được ngay cả khi chưa cấp quyền ghi; **local state cache** tại adapter để Orchestration vẫn có dữ liệu gần nhất khi mất kết nối.

**Luồng (robot phối hợp máy CNC — kịch bản chuẩn):**
```
1. Khối 2 nhận task → cần Robot-X + CNC-07
2. Equipment Registry xác nhận CNC-07 = idle + đúng recipe
3. Khối 1 gửi move-to + pick cho Robot-X (qua gate)
4. Robot đặt phôi → Khối 2 gọi POST /equipment/CNC-07/commands/start-stop (Khối 1B)
5. CNC xong → event WS /equipment/CNC-07/events/stream → Khối 2 điều robot lấy SP
6. Toàn bộ (cycle-time, recipe, kết quả) → outbox Khối 0 → ERP
```

**UI:** trang `Devices → Equipment Registry` (nâng từ `device-adapters`): bảng máy × hãng × giao thức × capability × trạng thái discovery; nút thêm adapter; xem alarm chuẩn hóa; lịch sử recipe.

---

## 7. Khối 2 — Fleet & Task Orchestration *(GAP LỚN — ưu tiên #1)*

**Hiện trạng (🟡 ~35%):** FOE engine (`foeEngine.ts`, ISA-88 workflow runtime, flag `FOE_ENABLED` OFF) + `foeSimulator.ts` + robot/AGV registry (production) + VDA5050 + `dispatchingService.ts` (WIP ranking priority/aging/bottleneck — nhưng KHÔNG có capability matching/distance/battery).

**Kiến trúc đích — 4 thành phần:**

**(a) Dynamic Task Allocation Engine** (`server/services/fleet/taskAllocator.ts` — ĐÃ CÓ; cùng thư mục: `fleetOrchestrator.ts`, `skillRegistry.ts`, `variantPicker.ts`)
- Entity `tasks` (MỚI): `task_id, source_work_order_id, required_capability, priority, status, assigned_device_id, location_start/end, estimated/actual_duration, retry_count, tenant_id`.
- Thuật toán gán: capability-match (từ `capabilityModel`) → khoảng cách/vị trí → battery (robot di động) → độ dài hàng đợi → priority đơn hàng. Latency mục tiêu **<500ms**. *Lưu ý code thật:* allocator **đọc dòng `robot_telemetry` mới nhất mỗi ứng viên** (snapshot polled, `orderBy(desc(timestamp)).limit(1)`, best-effort) — **KHÔNG** subscribe live vào telemetryBus.
- **Rebalancing động**: robot lỗi giữa chừng → task tự phân phối lại cho robot cùng capability.

**(b) Traffic & Path Management** (`server/services/fleet/trafficManager.ts` — ĐÃ CÓ; A* planner nằm ở `server/services/twin/occupancyGrid.ts`)
- Entity `zones` (MỚI): `zone_id, max_concurrent_robots, current_occupancy[], zone_type(production|transit|charging|human_shared), tenant_id`.
- Occupancy grid map + **A\* path planning** (`occupancyGrid.ts` — 8-connected, octile/Manhattan heuristic; **chỉ A\***, chưa có D\*) + **deadlock detection/avoidance** + "đèn giao thông ảo" tại giao cắt/cửa/thang máy + **reservation-based navigation** (đặt chỗ đoạn đường trước khi đi).
- Path planning **phân tán per-zone** (tránh nghẽn tập trung).

**(c) Skill & Work Instruction Registry** (nâng `programming.*` + `masterdata.skills`)
- `operation_codes` (MỚI): Operation Code (từ MES routing) → required Skill → Robot program/URDF. Versioned artifact (đã có git-like `program_artifacts`).
- **A/B test** chương trình robot: `program_variants` (variant/traffic-split) trước khi roll toàn dây chuyền.

**(d) Charging & Resource Management** (`server/services/fleet/resourceManager.ts` + `server/services/fleet/chargingPlanner.ts` — ĐÃ CÓ)
- Predictive charging (dự báo nhu cầu năng lượng/ca → lịch sạc). `charger_stations`, `battery_charging_plans`.
- Shared resource: `shared_resources` (jig/gripper/fixture/tool-changer) + `resource_reservations` (claim/release).

> **Trạng thái runtime (code thật):** trong `.env`, `FOE_ENABLED=true` nhưng **`FLEET_ORCH_ENABLED` / `FLEET_RESOURCE_ENABLED` không có** → stack allocator/traffic/resource đang **TẮT lúc chạy** (dù mã đã hiện thực). Bật các cờ này để chạy end-to-end.

**Luồng (task end-to-end):**
```
Work Order (Khối 0) → TaskAllocator phân rã → match capability+distance+battery+queue
  → reserve zone path (TrafficManager) → dispatch qua gate (Khối 1/1B)
  → robot thực thi · giám sát telemetry · nếu lỗi → rebalance
  → hoàn tất → cập nhật WIP/genealogy → outbox ERP
```

**UI:**
- `Devices → Fleet Orchestration` (MỚI): bản đồ 2D/3D occupancy grid (tái dùng `FactoryFloor3D`), zone occupancy, hàng đợi task, gán/hủy/ưu tiên, trạng thái rebalancing.
- `Orchestration Studio` (đã có) nâng cấp: gắn task vào workflow FOE; xem A/B variant.
- Bật flag `FOE_ENABLED` sau khi có tasks thật để chạy end-to-end.

---

## 8. Khối 3 — Human-Robot Collaboration *(GAP LỚN NHẤT — ưu tiên #2)*

**Hiện trạng (🔴 ~20%):** Andon production nhưng **signal-only** (không có vòng robot tự đến hỗ trợ); interlock engine **line-level** (chưa zone-aware); robot dry-run gate; HITL; QuickIssueReport (voice input). **Thiếu gần như toàn bộ phần safety vật lý.**

**Nguyên tắc tối thượng:** phần mềm KHÔNG đảm nhiệm safety-rated stop. Lớp này = **Safety PLC SIL 2/3 phần cứng** (Pilz/Sick) chạy độc lập; phần mềm chỉ giám sát/log/propose.

**Kiến trúc đích:**

**(a) Dynamic Safety Zoning** (`server/services/safety/*` — MỚI, phối hợp phần cứng)
- Vùng an toàn động theo vị trí người (vision/LiDAR/UWB tracking).
- 3 cấp phản ứng: **Speed reduction** (giảm tốc khi người đến gần) → **Stop zone** (dừng tạm) → **Safety-rated stop** (dừng cứng, reset thủ công — do PLC).
- Latency phát hiện→dừng **<100ms** (PLC đảm bảo; phần mềm chỉ log).
- Tận dụng Khối 4 vision: model phát hiện người/skeleton (YOLO) chạy edge → cảnh báo near-miss (advisory), nhưng **không** thay safety stop.

**(b) Mixed Workforce Scheduling** (`operator_assignments` — MỚI)
- Coi người + robot là 'resource' gán được task (ràng buộc riêng: người nghỉ giải lao, robot bảo trì). Bảng `operator_assignments(operatorId, lineId, stationId, shiftConfigId, skillLevel, start/end, confirmedBy)` + skill-matrix (đã có `masterdata.skills`+`userCertifications`).
- Hiển thị realtime "ai/robot nào đang làm gì tại mỗi trạm".

**(c) Human Command Interface** (nâng Andon)
- **Đóng vòng Andon→robot**: worker bấm Andon "cần hỗ trợ" → robot rảnh tự điều hướng đến trạm (qua Khối 2). Thêm `andon_dispatch` link.
- Physical button + đèn Andon (MQTT topic `factory/{f}/andon/light/{station}`) + tablet (đã có QuickIssueReport) + voice command parsing (hiện mới transcribe, chưa parse intent).

**(d) Skill Handover Protocol** (`collaboration_sessions` — MỚI)
- Handshake người↔robot (người gá phôi → robot hàn → người kiểm tra) với tín hiệu rõ ràng tránh xung đột không-gian/thời-gian.

**(e) Safety Event Audit** (`safety_events` — MỚI, SIL-tagged)
- Log mọi e-stop/collision/intrusion/force-limit/near-miss với `responseTime_ms`, `detectedBy`, `outcome`, `isNearMiss`. Tuân thủ ISO/TS 15066 + ISO 10218-1/2.

**Luồng (intrusion):** `vision/LiDAR phát hiện người vào zone → PLC safety-rated stop <100ms → safety_events log → Andon red → notify supervisor → reset thủ công`.

**UI:**
- `Safety Cockpit` (MỚI): bản đồ zone realtime + vị trí người/robot, cấp phản ứng hiện tại, lịch sử safety-event, near-miss trend (PDCA).
- `Workforce Board` (MỚI): ai ở trạm nào, handover sắp tới, skill-match.
- Andon UI nâng: nút "gọi robot hỗ trợ".

---

## 9. Khối 4 — AI/Analytics & Predictive Layer

**Hiện trạng (🟢 ~85% — tài sản lớn nhất):** local-LLM brain Qwen3 (GGUF in-process + VL sidecar), Predictive Maintenance (risk+RUL+confidence), Anomaly (PatchCore 3-tier), RCA Copilot (ranked hypotheses + 1-tap HITL fix), KB/RAG + reranker + GraphRAG, MLOps (dataset→train→eval→activate gate), Model Router tier 0–4, time-series engine.

**Khoảng cách (đóng vòng + mở rộng cho robot):**
1. **Wiring MQTT sensor → `machineSensorReadings`** (schema sẵn, ingest chưa nối): bật PdM theo rung động/dòng điện motor thật thay vì chỉ heartbeat. *Effort thấp (~1-2 ngày), unlock cao.*
2. **Robot-behavior anomaly** (MỚI): phát hiện sai lệch quỹ đạo / lực kẹp bất thường / cycle-time tăng dần — dùng time-series engine + joint_states (Khối 1).
3. **Model auto-rollback**: drift detector + auto-rollback về version ổn định (hiện manual gate).
4. **PdM → work-order tự động** (đã có `maintenanceWorkOrders`): đóng vòng risk→WO.
5. **(Optional) Triton/shared inference** nếu throughput >20k ảnh/ca; hiện node-llama in-process đủ (gate VL theo anomaly score).

**Tách compute:** AI chạy cluster riêng/queue async — KHÔNG trên critical path control (đã đúng).

**UI:** đã có `AI Hub`, `AI Brain Dashboard`, `Anomaly Banks`, `Model Management`, `AI Performance`. Thêm card "Robot Behavior Anomaly" + "Sensor PdM live".

---

## 10. Khối 5 — Multi-vendor Equipment Standardization

**Hiện trạng (🟡 ~55%):** `capabilityModel.ts` (17 equipment class, override jsonb), `packml.ts` (ISA-TR88, 17 state, 9 command, transition thuần), Equipment Registry. **Thiếu governance + conformance + hierarchy tree.**

**Kiến trúc đích:**
1. **Schema Registry trung tâm versioned** (`device_type_registry` — MỚI): Device Type Hierarchy có version, query qua API. **Inheritance đa cấp tường minh**: `Equipment` → `Robot` → `CollaborativeRobot`, mỗi cấp thêm thuộc tính, trường `extension` ở mọi cấp (hãng-specific).
2. **Alarm Taxonomy (ISA-18.2)** lộ ra: `alarm_taxonomy` table + mapping 3-5 hãng phổ biến → mã chuẩn.
3. **Equipment Standards Board governance workflow** (`device_type_change_requests` — MỚI): change-request → review → publish version (SemVer, backward-compat, chỉ thêm-không-sửa-field-đã-ban-hành) → conformance test → staging → production.
4. **Conformance Testing tự động trong CI**: fixture-based ("AOI adapter PHẢI báo cycle_time"), chạy như bước bắt buộc mỗi adapter.
5. **Compliance Dashboard**: tỷ lệ thiết bị mapping đúng chuẩn, cảnh báo adapter chưa qua conformance.

**Schema mẫu (kế thừa báo cáo §9.6):**
```
Equipment(base): { equipment_id, vendor, model, protocol, pack_ml_state,
  alarms:[{code_standard, code_native, severity, ts}], utilization_rate, extension:{} }
Robot extends Equipment: { joint_states:[{joint_id,pos,vel}], tcp_pose, payload_kg, reach_mm, controller_type, extension:{} }
CollaborativeRobot extends Robot: { force_limit_n, safety_rated_speed_mms, extension:{} }
```

**UI:** `Admin → Equipment Standards` (MỚI): cây Device Type, version/changelog, hàng đợi change-request + duyệt, compliance %, kết quả conformance.

---

## 11. Khối 6 — IR & Transpiler (Lập trình thiết bị) & Khối 7 — Simulation & Digital Twin

### 11.1 Khối 6 — IR & Transpiler

**Hiện trạng (🟡 ~55%):** Simulation Gate + deployment pipeline production (`programmingService.ts`: validate→compile→simulate→HITL→deploy, flag `DPC_DEPLOY_ENABLED` OFF; staged staging→production; 2-eyes; rollback; append-only). Workflow IR (FOE) production. Transpiler: IEC61131 (LD→ST + one-scan sim thật), Zmotion BASIC (framework), Mitsubishi/Robot-TM/G-code (scaffold). Visual editor bespoke (Orchestration Studio tree + Engineering Workspace Monaco+Ladder).

**Kiến trúc đích:**
1. **IR Core Model v1 chuẩn hóa** (AST JSON/YAML): motion-block + I/O-block first-class (`move_linear`, `grip`, `if_condition`...) — hiện program lưu text, FOE IR chỉ ở orchestration level.
2. **Visual IR Editor** (code thật: `client/src/pages/IrEditor.tsx` là **trình sửa IR dạng cây tùy biến (nested step-tree + inspector, kiểu OrchestrationStudio)** — **chưa phải node-graph React Flow**; repo không có dependency `reactflow`/`@xyflow`): kéo-thả/chỉnh block, chỉnh tham số, lint + transpile-preview ngay trong editor. *Nâng cấp tương lai:* chuyển sang node-graph React Flow thực thụ.
3. **Safety Linter semantic** (MỚI, hiện chỉ syntax): kiểm tra speed limit / workspace bounds / torque limit trên IR — chặn trước transpile.
4. **Transpiler đa target** (mở rộng theo độ phức tạp): URScript/ROS2 Action (dễ) → KUKA/ABB/Fanuc/IEC61131-PLCopen. Code sinh ra có **comment trỏ ngược block IR**.
5. **Simulation Gate cứng** (đã ĐƯỢC THỰC THI — không chỉ nguyên tắc): tính đến **2026-07-01 (doc 22 P0)**, `programmingService.deployBuild` **bắt buộc** dòng `program_sim_runs` mới nhất của build có `ok===true` trước khi deploy thật (nếu chưa sim / sim fail → deployment `rejected`). Không chương trình nào lên production nếu chưa pass sim (Khối 7) — hard constraint, không override kể cả admin.
6. **Pattern Library** flow đã duyệt + **escape hatch** code thủ công (vẫn phải qua Simulation Gate).

**Luồng deploy (chi tiết, đã có khung):**
```
IR Editor (chọn Device Type) → save IR JSON + git commit → Safety Linter (semantic)
  → pass → Transpiler → code gốc + IR hiển thị song song (Code Review 2-eyes)
  → review pass → Simulation Gate (Khối 7, 50 chu kỳ) → pass/fail + log đính Git
  → staged (1 máy thật, giám sát) → người có thẩm quyền duyệt → production (nhân rộng)
  → giám sát cycle-time/lỗi → bất thường → đề xuất rollback
```

### 11.2 Khối 7 — Simulation & Digital Twin

**Hiện trạng (🟡 ~40%):** three.js + @react-three/fiber + drei. `FactoryFloor3D` (plant L4, máy = block màu theo trạng thái live — *digital shadow*), `Factory3DScene` (hub L3 corporate), `FactoryLiveMap3D` (wrapper, poll 5s), `DigitalTwinDashboard` (tabular what-if), `RfTestCellSim`/`CellTwinPlayer` (2D playback FOE). **Thiếu physics, CAD pipeline, scene-graph, replay, streaming <500ms.**

**Kiến trúc đích (dùng CHUNG 1 nguồn model 3D — nguyên tắc số 1 báo cáo):**
1. **CAD/URDF → glTF pipeline** (MỚI): thu URDF (robot) / CAD STEP (máy tĩnh) → glTF tối ưu web; drei có sẵn `Gltf` loader (chưa dùng). `equipment_3d_models` registry: equipment_id → glTF path + version.
2. **Scene Graph phân cấp** zone→station→device (lấy từ Khối 2 Zone) — dùng chung sim + viz.
3. **Physics simulation environment** cho Simulation Gate: chọn 1 chuẩn (Isaac Sim cho robot/humanoid / RoboDK cho robot công nghiệp / Gazebo). API nhận code transpile → trả `{pass, collision_events, joint_limit_violations, cycle_time_actual, safety_zone_violations}`.
4. **Live Visualization Dashboard**: đa thiết bị trên 1 bản đồ, click xem PackML/alarm/task, layer toggle (chỉ robot / chỉ vùng an toàn / chỉ luồng vật tư).
5. **WebSocket Streaming Gateway** từ telemetry bus (thay poll 5s) → <500ms end-to-end; **Replay** từ TimescaleDB (scrubber thời gian) cho điều tra sự cố.

**Luồng Replay điều tra:** `chọn khung thời gian → query TimescaleDB → renderer phát lại đúng trình tự (tua nhanh/chậm) → quan sát trước/trong/sau sự cố`.

**UI:** nâng `factory-live-map` thành **Digital Twin Center**: 3D scene-graph thật (glTF), live stream, replay scrubber, layer toggle, click-to-inspect; tách rõ "shadow (live)" vs "twin (sim what-if)".

---

## 12. Frontend Design System chuyên nghiệp *(yêu cầu trọng tâm của bạn)*

**Hiện trạng (🟢 ~75%):** shadcn/ui (new-york, 53 component) + Radix + Tailwind v4 (oklch CSS vars) + Framer Motion + Recharts + three.js; nav R4 cascading 3 tầng + Command Palette (⌘K) + Mega-menu (⌘\) + BottomNav (Material 3); dark/light; i18n vi/en/zh (151 trang). **Điểm yếu:** thiếu design tokens tập trung, type-scale, semantic color shades, Storybook/Figma, đồng nhất trang-trang (màu/spacing/typography lệch), responsive tablet + a11y chưa audit.

**Mục tiêu: đạt "top-tier industrial UI" — đồng nhất, đẹp, chuyên nghiệp.**

### 12.1 Design Tokens (nền tảng)
- **Color**: mở rộng CSS vars thành semantic role × shade (50–900): `--success/warning/error/info` + `--surface-1..3`, `--text-1..3`. Map sang Tailwind config token. Hỗ trợ **multi-tenant theming** (brand color per tenant — federation-ready).
- **Typography scale**: định nghĩa h1–h6 + body/caption theo base 16px, modular 1.25–1.5; font industrial (Inter/Geist). Thay các `text-2xl font-bold` ad-hoc bằng component `<Heading level>`.
- **Spacing**: enforce grid 4px (4/8/12/16/24/32/48/64) — audit toàn bộ p/m/gap.
- **Motion**: chuẩn hóa spring Framer (entry/state-change/error-success), bỏ duration hard-code.
- **Elevation/radius/shadow**: token hóa.

### 12.2 Component & mẫu trang chuẩn
- **Compound patterns**: `<Card><CardHeader><CardContent>`, `<PageHeader>`, `<DataTable>`, `<MetricCard>`, `<StatusBadge>`, `<EmptyState>`, `<ErrorBoundary>` — dùng nhất quán mọi trang.
- **Mẫu trang chuẩn** (template): Dashboard, List+Filter, Detail, Editor (split-pane), Wizard, Realtime-monitor, 3D-scene. Mọi trang mới phải chọn 1 template.
- **Storybook** cho 53 component + token playground; (tùy chọn) Figma design-kit sync.

### 12.3 3D/Twin frontend
- Kích hoạt `drei.Gltf` + asset pipeline glTF; scene-graph component tái dùng; LOD + instancing cho >100 máy; `@react-three/postprocessing` cho chất lượng phòng điều hành.
- Performance: code-split per module, virtualize Recharts >10k điểm, throttle MQTT re-render.

### 12.4 Audit & polish
- **Responsive**: test 480/768/1024/1440; sửa tablet (768–1024) — vùng nav cascading chưa test kỹ.
- **A11y**: chạy axe/WAVE 15 trang lõi → WCAG AA; keyboard nav, contrast, focus, ARIA.
- **Brand guideline doc**: palette/typography/spacing/motion/voice.

---

## 13. Yêu cầu phi chức năng (NFR)

| Nhóm | Yêu cầu |
|---|---|
| **An toàn** | ISO 10218-1/2, ISO/TS 15066, IEC 61508/62061; Safety PLC SIL 2/3 độc lập phần mềm |
| **Độ trễ** | Safety <100ms (PLC) · Fleet orchestration <500ms · MES/ERP giây · Twin live <500ms · Control real-time <50ms (e-stop) |
| **Mở rộng** | Microservices/adapter plug-in; thêm robot/máy không downtime; multi-tenant + RLS |
| **Tích hợp** | Open API REST/tRPC; OPC-UA Companion Spec; ISA-95 outbound |
| **Bảo mật OT/IT** | Network segmentation IEC 62443; zone OT riêng; OAuth2/mTLS; command-level authz; flag OFF + HITL mọi lệnh ghi |
| **Phục hồi** | Fallback thủ công khi robot lỗi; local state cache adapter; circuit-breaker; durable outbox |
| **Audit** | Append-only mọi lệnh + safety-event SIL-tagged + genealogy hash-chain |

## 14. Tech stack ánh xạ (giữ stack hiện tại, KHÔNG thêm bừa)

| Khối | Báo cáo đề xuất | Quyết định cho hệ này |
|---|---|---|
| Message bus | Kafka + MQTT | **MQTT/Aedes (có) + Redis/BullMQ (có)** — Kafka *không cần* ở quy mô này |
| Field/Robot | ROS2 + open62541 | **node-opcua/drivers hiện có** + ROS2 bridge *khi cần humanoid* |
| Equipment 1B | secsgem/MTConnect SDK | **đã có framework** — hoàn thiện + thêm FOCAS/Euromap theo nhu cầu |
| Fleet | Node/FastAPI + A*/D* | **Node/tRPC hiện có** + **A\*** trong `twin/occupancyGrid.ts` (fleet: `server/services/fleet/*`; chỉ A\*, chưa có D\*) |
| Safety | Pilz/Sick PLC + UWB | **Mua phần cứng** (không code thay thế được) |
| AI | PyTorch/Triton/MLflow | **local-LLM Qwen3 brain (có)** — Triton optional |
| Digital Twin | Omniverse/Unity + three.js | **three.js/fiber/drei (có)** + glTF pipeline; Isaac/RoboDK cho physics sim gate |
| IR/Transpiler | Node-RED/ANTLR/PLCopen | **React Flow + adapter pattern (có)** + ANTLR cho transpiler phức tạp |

---

## 15. KẾ HOẠCH NÂNG CẤP *(phần chờ bạn DUYỆT trước khi gọi agent thực thi)*

> Lộ trình theo độ-ưu-tiên-gap + giá-trị/công-sức. Mỗi giai đoạn = 1 nhóm agent chuyên môn, **flag OFF mặc định**, có exit-criteria + smoke-test, không phá vỡ golden-thread hiện có.

| GĐ | Tên | Khối | Nội dung chính | Đầu ra | Cờ |
|---|---|---|---|---|---|
| **R0** | Quick wins (đóng vòng) | 4, 0 | Wiring MQTT sensor→`machineSensorReadings`; PdM→work-order auto; outbox ERP + circuit-breaker; inbound order/BOM API | PdM thật + ERP 2 chiều | `PDM_SENSOR`, `ERP_INBOUND` |
| **G1** | Fleet & Task Orchestration | 2 | `tasks` + TaskAllocator (capability/distance/battery/rebalance); `zones` + TrafficManager (occupancy/deadlock/reservation); bật `FOE_ENABLED` | Engine điều phối robot chạy thật | `FLEET_ORCH` |
| **G2** | Skill/Resource/Charging | 2 | Operation→Skill→Program; A/B variant; shared-resource + predictive charging | Skill registry + charging | `SKILL_REG` |
| **S1** | Safety Foundation (phần mềm) | 3 | `operator_assignments` + Workforce Board; `safety_events` SIL audit; đóng vòng Andon→robot; near-miss CV advisory | Workforce + safety audit | `WORKFORCE`, `SAFETY_AUDIT` |
| **S2** | Dynamic Safety Zoning | 3 | Tích hợp Safety PLC SIL 2/3 + UWB/LiDAR/vision tracking; 3 cấp phản ứng; Safety Cockpit UI | Safety zoning đạt ISO | `SAFETY_ZONE` (cần phần cứng) |
| **T1** | Digital Twin nâng cấp | 7 | CAD/URDF→glTF pipeline; scene-graph zone→station→device; WS streaming <500ms; Replay TimescaleDB | Twin Center 3D thật | `TWIN_LIVE` |
| **T2** | Physics Simulation Gate | 6,7 | Isaac/RoboDK physics env + Simulation Gate API; semantic Safety Linter | Sim gate cứng cho transpile | `SIM_PHYSICS` |
| **D1** | IR & Transpiler nâng cấp | 6 | IR Core Model (motion/IO block); React Flow editor; transpiler URScript/ROS2; IR↔source comment | Visual programming hoàn chỉnh | `DPC_IR_V2` |
| **E1** | Standardization governance | 5 | Device Type hierarchy tree + Schema Registry versioned; alarm taxonomy ISA-18.2; Standards Board workflow; conformance CI; compliance dashboard | Governance + conformance | `EQ_GOVERN` |
| **I1** | Equipment Integration mở rộng | 1B | FOCAS/Euromap/OPC-UA Companion validate (theo thiết bị thực có); recipe versioning; alarm dictionary | Adapter đa hãng production | `EQ_INTEG` |
| **X1** | Field abstraction hoàn thiện | 1 | UDM mở rộng (battery/joint/safety_zone); push-streaming; hot-plug discovery; command-level authz | Device layer đầy đủ | `FIELD_V2` |
| **F1** | Frontend Design System | FE | Design tokens + type scale + semantic colors; compound components + page templates; Storybook; a11y/responsive audit; multi-tenant theming | UI top-tier đồng nhất | — (refactor) |

**Phụ thuộc:** R0 → G1 → (G2, S1) → S2(cần HW) ; T1 → T2 → D1 ; E1 độc lập ; I1/X1 độc lập ; F1 chạy song song xuyên suốt.

**Cách thực thi (sau khi duyệt):** mỗi GĐ gọi 1–N agent chuyên môn (backend service + drizzle schema + router + client page + tests), commit theo phase, migration đánh số tiếp `drizzle/`, cập nhật `module-registry` + `navigation.tsx` + i18n 3 ngôn ngữ, flag OFF → smoke-test → bật.

---

## 16. Kết luận

Hệ AVI/AOI hiện tại **đã vượt xa điểm khởi đầu của báo cáo tham khảo** ở Khối 0/1/4 (MES, device abstraction, AI brain) và **ngang bằng/có nền** ở Khối 5/6 (PackML, Simulation Gate). Khoảng cách thật nằm ở **Khối 2 (fleet/task/traffic), Khối 3 (safety vật lý), Khối 7 (physics+twin nâng cao)** và **hoàn thiện frontend design-system**.

Thiết kế này **chi tiết và đầy đủ hơn báo cáo** ở: (1) ánh xạ từng khối vào file code thật, (2) luồng vận hành end-to-end mỗi khối, (3) mô hình dữ liệu + API cụ thể, (4) chương Frontend design-system riêng, (5) lộ trình theo gap thực tế + cờ tính năng + exit-criteria. Tất cả treo trên **golden thread** và tuân thủ kỷ luật **flag-OFF + HITL + audit** đã chứng minh an toàn của hệ.

**Bước kế tiếp:** bạn review §15 (kế hoạch nâng cấp) → duyệt/điều chỉnh thứ tự ưu tiên & phạm vi → tôi gọi các agent chuyên môn thực thi từng giai đoạn.
