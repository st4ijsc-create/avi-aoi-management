# 20 — Phân tích lại Nhóm C & Kế hoạch làm-trước-khi-có-phần-cứng

> Tiếp nối doc 18 §6 (Nhóm C: S2/T2/I3) — soi lại từng hạng mục "cần phần cứng" và tách ra **phần có thể làm + validate NGAY bằng phần mềm/simulator** vs **phần thực sự bị chặn bởi thiết bị vật lý**.
> Ngày: 2026-07-01 · Nhánh: `automation-orchestration-r0`.

---

## 0. Luận điểm

**"Cần phần cứng" đang bị phóng đại.** Ba nhóm C thực chất là:
- **T2 (physics-sim)** — chạy trên **máy tính**, KHÔNG phải trên robot. Không có blocker phần cứng thật cho bản thân sim; chỉ cần model + engine sim.
- **S2 (safety zoning)** — logic vùng/phản ứng/tracking là phần mềm; chỉ **rated-stop SIL + cảm biến UWB/LiDAR** là phần cứng.
- **I3 (connector)** — hầu hết hãng có **emulator/simulator MIỄN PHÍ** (URSim, ROS2/Gazebo, OPC-UA sim, MTConnect sim) chạy chính firmware/giao thức thật mà không cần thiết bị.

→ Ước tính **có thể hoàn thành 55–80% Nhóm C ngay bây giờ** bằng software + sim, để khi thiết bị về chỉ còn *đấu nối + hiệu chuẩn + chứng nhận*.

**Ràng buộc môi trường (trung thực):**
- **Python không có trên PATH** hiện tại → ưu tiên Node/TS thuần hoặc ONNX-Node. PyBullet/YOLO-Python cần *dựng Python sidecar một lần* (setup, không phải thiết bị).
- URSim/Gazebo/OPC-UA-sim chạy trong **Docker/VM** — là *hạ tầng mô phỏng* (cần công sức dựng), KHÁC hoàn toàn *thiết bị sản xuất* (cần vốn + commissioning).

---

## 1. T2 — Physics Simulation Gate  ·  ~80% làm được ngay

| | |
|---|---|
| **Blocker phần cứng THẬT** | KHÔNG có (sim chạy trên máy). Chỉ *hiệu chuẩn cycle-time cuối* cần robot thật. |
| **Đã có sẵn** | D1 IR + transpiler + `simulate()` (structural preview) · T1 model registry với seam `conversionStatus` (pending→ready/external) + `isModelRenderable` · Deploy gate HITL. |

**Làm được NGAY (thuần phần mềm):**

- **T2a — Pipeline CAD/URDF → glTF** (điền `conversionStatus='ready'` cho model registry):
  - **URDF → glTF**: thuần Node (`gltf-transform` + parse URDF mesh refs) — làm ngay.
  - **STEP/IGES → glTF**: cần CAD kernel — hoặc `assimp` (native, có Node binding) hoặc FreeCAD headless / dịch vụ converter. Nặng hơn, có thể pha 2.
  - Kết quả: DigitalTwinCenter render model thật thay vì primitive block.

- **T2b — Simulation Gate ĐỘNG HỌC (Node/TS)** *(giá trị cao nhất)*:
  - Từ URDF (forward-kinematics) + IR/transpiled program → tính quỹ đạo joint → kiểm tra **collision hình học** (bounding volume vs scene-graph geometry), **joint-limit violation**, **workspace bound**, **cycle-time ước lượng**, **safety-zone violation**.
  - Trả đúng contract Simulation-Gate của thiết kế: `{pass, collision_events, joint_limit_violations, cycle_time_actual, safety_zone_violations}`.
  - **Thay `simulate()` structural-stub của D1 bằng sim động học thật** → biến "preview" thành **cổng chặn thật**: chương trình va chạm / vượt giới hạn bị chặn TRƯỚC khi deploy. Đây chính là mục tiêu an toàn cốt lõi của cả pipeline IR.
  - Backend swappable: khi có Isaac/RoboDK/PyBullet (full contact dynamics) thì thay engine, contract giữ nguyên.

**Cần phần cứng thật:** chỉ *hiệu chuẩn cycle-time/độ chính xác cuối* trên robot thật (sim động học đủ để bắt collision/joint-limit — 90% giá trị an toàn).

---

## 2. S2 — Dynamic Safety Zoning  ·  ~60% làm được ngay

| | |
|---|---|
| **Blocker phần cứng THẬT** | **Rated-stop SIL 2/3** (Safety PLC Pilz/Sick + safety I/O + <100ms) và **cảm biến người thật** (UWB/LiDAR). Không thể thay bằng phần mềm. |
| **Đã có sẵn** | S1: `safety_events` SIL-tagged (advisory), near-miss advisor nhận input proximity, workforce/handover, Safety Cockpit UI. |

**Làm được NGAY (thuần phần mềm):**

- **S2a — Mô hình vùng an toàn + logic 3 cấp phản ứng**:
  - Schema vùng (polygon/AABB) + gán robot/trạm + ngưỡng 3 cấp (speed-reduce → stop-zone → rated-stop).
  - **Zone-intrusion evaluator**: cho vị trí người (từ tracker) → tính khoảng cách người↔robot → quyết định cấp phản ứng. **Pure function, test được ngay** với track người mô phỏng.
  - Trực quan hoá vùng + người mô phỏng + cấp phản ứng trong DigitalTwinCenter (twin đã có scene-graph).

- **S2b — Producer + adapter (sim backend)**:
  - **Vision human-detection producer** (YOLO-pose, `yolo26n.pt` đã có): phát hiện người/skeleton từ camera → feed vị trí vào near-miss advisor S1 (**advisory**). Chạy được ngay trên ảnh test/recorded (ONNX-Node để tránh cần Python; hoặc Python sidecar một lần).
  - **Safety-PLC adapter framework** (sim backend): Pilz PNOZ/PSS & Sick Flexi nói Modbus-TCP/OPC-UA/CIP-Safety → tái dùng OT driver cho **đường đọc không-rated** (trạng thái e-stop/zone/reset); sim backend đến khi có PLC thật. Trung thực: đây là *giám sát*, không phải rated-stop.

**Cần phần cứng thật:** rated-stop SIL (Safety PLC + contactor + <100ms dual-channel), cảm biến UWB/LiDAR thật, chứng nhận ISO/TS 15066 & 10218. → Phần mềm chuẩn bị toàn bộ *ngoại trừ* actuation rated + sensor thật.

---

## 3. I3 — Connector thiết bị thật  ·  ~50–70% làm được ngay (qua emulator)

| Hãng/Giao thức | Emulator MIỄN PHÍ? | Làm + validate ngay? |
|---|---|---|
| **Universal Robots (URScript)** | ✅ **URSim** (chạy firmware controller thật trong VM) | ✅ **CAO** — validate D1 transpiler end-to-end trên controller thật, không cần cánh tay |
| **ROS2/DDS (humanoid/AMR)** | ✅ ROS2 + **Gazebo/fake_joint** | ✅ **CAO** — build bridge ROS2↔UNS + test với node sim |
| **Máy CNC (MTConnect)** | ✅ MTConnect agent simulator (public) | ✅ — hoàn thiện MTConnect adapter (field-map) với sim |
| **Euromap 77/83 (OPC-UA/MQTT)** | ✅ OPC-UA sim server (open62541/Prosys) | ✅ — adapter Euromap OPC-UA vs sim |
| **Fanuc FOCAS** | ❌ (Fwlib32 độc quyền, không emulator free) | ⚠️ Giữ framework; cần Fanuc thật + license |
| **Mitsubishi/ABB/KUKA/Fanuc robot** | ⚠️ Vendor sim (RT ToolBox/RobotStudio/OfficeLite/ROBOGUIDE — license) | ⚠️ Nếu có license sim; nếu không → giữ scaffold |
| **EtherCAT** | ⚠️ SOEM master + slave sim (một phần; real-time cần HW) | ⚠️ Một phần |

**Làm được NGAY (giá trị cao nhất):**
- **I3a — ROS2/DDS bridge** (test vs ROS2 Gazebo) + **URSim validation harness**: deploy code URScript (từ D1 transpiler) xuống **URSim** — validate toàn chuỗi IR→lint→transpile→Simulation-Gate→deploy trên **controller UR thật (ảo)**, không cần cánh tay. Đây là bằng chứng end-to-end mạnh nhất cho cả Khối 6.
- **I3b — Euromap OPC-UA + MTConnect adapter** vs sim server: điền field-map thật, chạy `mapAlarm`→Andon với alarm sim.

**Cần phần cứng thật:** FOCAS (Fanuc + license), EtherCAT real-time, và *commissioning cuối* trên máy thật. Các hãng còn lại chỉ cần *đổi endpoint sim → endpoint thật* khi thiết bị về.

---

## 4. Bảng tổng: phần mềm-ngay vs phần cứng-thật

| Hạng mục | Làm được ngay (sw/sim) | Còn lại chờ phần cứng |
|---|---|---|
| **T2** | ~80% — CAD/URDF→glTF, **Simulation-Gate động học thật** | Hiệu chuẩn cycle-time cuối |
| **S2** | ~60% — vùng+3-cấp+evaluator, vision human-detect (advisory), safety-PLC adapter (sim) | **Rated-stop SIL**, UWB/LiDAR thật, chứng nhận |
| **I3** | ~55% — URSim harness, ROS2 bridge, Euromap/MTConnect vs sim | FOCAS, EtherCAT real-time, commissioning |

---

## 5. Kế hoạch đề xuất (pre-hardware phases)

Ưu tiên theo **giá trị đóng-vòng-an-toàn** (biến các seam thành thật):

| GĐ | Tên | Nội dung | Phụ thuộc | Cờ |
|---|---|---|---|---|
| **T2b** | Kinematic Simulation Gate | URDF FK + geometric collision + joint-limit + cycle-time → thay `simulate()` stub của D1 bằng cổng chặn THẬT (Node/TS, engine swappable) | D1, T1 | `SIM_KINEMATIC_ENABLED` |
| **T2a** | Model pipeline | URDF→glTF (Node) điền model registry `ready`; STEP→glTF pha sau | T1 | — |
| **I3a** | URSim + ROS2 harness | Deploy URScript(D1)→**URSim** validate end-to-end; ROS2/DDS bridge↔UNS vs Gazebo | D1, X1 | `ROS2_BRIDGE_ENABLED` |
| **S2a** | Zone geometry + 3-level evaluator | Schema vùng + evaluator intrusion (pure) + trực quan hoá trong twin | S1, T1 | `SAFETY_ZONE_SW_ENABLED` |
| **S2b** | Vision human-detect + safety-PLC adapter(sim) | YOLO-pose producer→near-miss advisor (advisory); safety-PLC read-path adapter sim | S1, S2a | reuse `SAFETY_AUDIT` |
| **I3b** | Euromap/MTConnect vs sim | Field-map thật + alarm→Andon với OPC-UA/MTConnect sim | I1 | reuse `EQ_INTEG` |

**Thứ tự khuyến nghị:** `T2b` (cổng sim thật — giá trị an toàn cao nhất, đóng vòng D1) → `I3a` (URSim validate cả chuỗi IR trên controller thật-ảo) → `T2a` (model 3D thật) → `S2a`/`S2b` (zoning + vision advisory) → `I3b`.

**Ghi chú setup (một lần, không phải thiết bị):** URSim/ROS2-Gazebo/OPC-UA-sim chạy Docker; YOLO-pose ưu tiên ONNX-Node (tránh Python) hoặc dựng Python sidecar; STEP→glTF cần assimp/FreeCAD.

---

## 6. Kết luận

Nhóm C **không phải "khối chờ phần cứng"** — chỉ ~1/3 thực sự bị chặn (rated-stop SIL, cảm biến UWB/LiDAR, FOCAS, commissioning). Phần còn lại (**Simulation-Gate động học thật, URSim/ROS2 validation, model pipeline, zone evaluator, vision advisory, Euromap/MTConnect field-map**) đều làm + test được ngay bằng simulator/emulator miễn phí, biến hàng loạt "seam trung thực" hiện tại thành **năng lực chạy thật** — để khi thiết bị về chỉ còn đổi endpoint sim→thật và hiệu chuẩn/chứng nhận.

---

## 7. RUNBOOK — dựng simulator cho I3a (URSim + ROS2)

> Cả hai harness **mock-backed** (test chạy xanh **không cần** sim). Để validate end-to-end thật, operator dựng sim **MIỄN PHÍ** trong Docker (một lần — là *hạ tầng*, không phải thiết bị) rồi trỏ endpoint qua ENV. Tất cả flag **mặc định OFF**; OFF = không mở socket. **TRUNG THỰC:** endpoint không reachable → harness trả lỗi rõ ràng, **không bao giờ** giả success.

### 7.1 URSim (Universal Robots controller simulator — `URSIM_ENABLED`)

Chạy firmware controller UR **thật** trong VM/Docker — validate toàn chuỗi `IR → lint → transpile → Simulation-Gate → deploy` trên controller UR **thật (ảo)**, **không cần cánh tay**.

```bash
# 1) Chạy URSim e-Series (UR5). Publish các cổng UR: dashboard 29999, primary/secondary
#    30001/30002, RTDE 30003/30004; VNC 5900 + noVNC 6080 để xem teach-pendant.
docker run --rm -it \
  -e ROBOT_MODEL=UR5 \
  -p 5900:5900 -p 6080:6080 \
  -p 29999:29999 -p 30001-30004:30001-30004 \
  universalrobots/ursim_e-series
# 2) Mở http://localhost:6080/vnc.html → power on robot trên teach-pendant (hoặc để harness
#    tự `power on` + `brake release` qua dashboard).
```

Trỏ harness qua ENV rồi bật flag:

```bash
URSIM_ENABLED=true
URSIM_HOST=127.0.0.1          # host Docker
# URSIM_PRIMARY_PORT=30001    # gửi URScript (primary; 30002 = secondary)
# URSIM_DASHBOARD_PORT=29999  # load/play/stop/power/robotmode/programState
```

Chạy validation: tRPC `simTargets.validateUrscript({ urscript })` (hoặc gọi trực tiếp
`validateUrscriptOnUrsim(urscript, endpoint)`). Kết quả `{ sent, accepted, running,
robotMode, programState }` là **bằng chứng end-to-end**: `sent` = transport OK; `accepted`+`running`
= controller UR **thật đã compile + chạy** code transpile ra (transpile hỏng cú pháp → UR runtime từ chối → `running=false`). Deploy-qua-URSim đi qua **đúng gate cũ** (`DPC_DEPLOY_ENABLED` + HITL), ghi vào `program_deployments` (`stage='staging'`, `detailJson.target='ursim'`) — URSim là **thiết bị ảo an toàn**, không mở control-path mới.

### 7.2 ROS2 bridge (via `rosbridge_server` — `ROS2_BRIDGE_ENABLED`)

Bridge ROS2↔platform bằng **JS thuần** qua rosbridge WebSocket (không cần rclnodejs/DDS native).

```bash
# 1) Cài + chạy rosbridge (trong môi trường có ROS2, ví dụ Humble). Mặc định ws://HOST:9090.
sudo apt install ros-humble-rosbridge-suite   # một lần
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
# 2) Có node phát telemetry (Gazebo / robot_state_publisher / fake node) publish
#    /joint_states, /odom, /tf để bridge subscribe.
```

Trỏ bridge qua ENV rồi bật flag:

```bash
ROS2_BRIDGE_ENABLED=true
ROSBRIDGE_URL=ws://127.0.0.1:9090
```

Khi bật, bridge tự connect lúc startup (`_core/index.ts`) hoặc qua tRPC `simTargets.ros2Connect`.
Telemetry vào: `/joint_states`,`/odom`,`/tf` → normalize → `telemetryBus.ingestTelemetry` (→ `ot_telemetry` + broadcast `telemetry:sample`, tái dùng field X1 nơi map được). Lệnh ra: **chỉ** qua `robotCommandDispatcher` (idempotency + HITL + dry-run) — dry-run (`ROBOT_CONTROL_ENABLED` off) → **không publish gì** lên ROS2. Bridge chỉ là **đường truyền**, gate ở nguyên chỗ cũ.

### 7.3 Ghi chú trung thực

- Không có sim đang chạy → **cả hai** harness trả lỗi reachable/connect rõ ràng; startup log cảnh báo & **không connect gì**; process **không** crash.
- **Không migration**: URSim deploy dùng `program_deployments` sẵn có (`stage='staging'` + `detailJson.target='ursim'`); ROS2 telemetry dùng `ot_telemetry` với `protocol='other'` + `meta.source='ros2'`.
- Không thêm dep native/nặng: URSim dùng `net` (built-in), ROS2 dùng `ws` (đã có).
