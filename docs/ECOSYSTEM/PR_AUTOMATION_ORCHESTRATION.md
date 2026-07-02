<!--
Mô tả PR sẵn-dùng cho nhánh `automation-orchestration-r0`.
Push + mở PR:
  git push fresh automation-orchestration-r0
  # rồi mở: https://github.com/st4ijsc-create/avi-aoi-management/compare/main...automation-orchestration-r0?expand=1
Dán TITLE + BODY dưới đây vào PR (bỏ phần comment này).
-->

# TITLE
feat: Automation & Robotics Orchestration ecosystem — full software, pre-hardware, upper-layer integration + feasibility remediation (Khối 0–7)

# BODY

Thực thi thiết kế hợp nhất (doc 16) từ báo cáo tham khảo "Hệ sinh thái Điều phối Robot & Tự động hóa", cộng tích hợp lớp-trên (doc 21), đánh giá khả thi 2-persona + remediation (doc 22/23), và một loạt fix UI/nav. **~57 commit** từ `main`, migrations 0141–0156 (đã áp dev DB → 0156), full test suite **2620 passed / 0 failed** (+8 skip; 1 test scheduling flaky-timeout khi chạy full-load, pass 10/10 khi chạy riêng), `npm run check` + `vite build` sạch.

## Nguyên tắc an toàn (giữ xuyên suốt)
- **Mọi tính năng sau flag OFF mặc định** — zero behavior change tới khi bật.
- **Không mở đường điều khiển thiết bị mới** — mọi lệnh vẫn qua gate HITL + dry-run + idempotency + audit append-only. Phần mềm **không** tự thực hiện safety-rated stop.
- Migration additive/idempotent; **mọi "seam" cần phần cứng/kết nối thật được ghi nhận trung thực, không bịa dữ liệu**.

## Phần mềm (Khối 0–7 + Frontend)
- **R0** ERP gateway (inbound order/BOM + outbox bền + circuit-breaker) + PdM đóng vòng (K0/K4)
- **G1·G2** Fleet: task allocator + zones/traffic + skill/resource/charging (K2)
- **T1** Digital Twin: scene-graph + WS stream + replay + occupancy A* + 3D UI (K7)
- **S1** Safety advisory (safety_events SIL-tagged) + workforce + Andon→robot (K3 sw)
- **E1** Equipment Standards governance + conformance + compliance (K5)
- **I1·X1** FOCAS/Euromap framework + recipe versioning + UDM/heartbeat/streaming/discovery/command-authz (K1B/K1)
- **D1** IR + safety-linter + transpiler URScript/ROS2 + Visual IR Editor (K6)
- **I2** robot-behavior anomaly + model auto-rollback + alarm wiring (K4)
- **Frontend** menu redesign + design-system (tokens/pattern components/a11y AA/Storybook)

## Nhóm C pre-hardware (doc 20) — 6/6
T2b Kinematic Simulation Gate (cổng chặn THẬT) · I3a URSim/ROS2 harness · T2a URDF→glTF · S2a zone evaluator 3-cấp · S2b vision/safety-PLC · I3b MTConnect/Euromap field-map.

## Tích hợp lớp-trên (doc 21, U1–U7)
Unified event backbone (module publish, orphan consumed, live client stream) · Ecosystem Command Center (single pane) · Machine & Robot cockpits + drill/QR + robot live telemetry · `/api/v1` mở cho module mới + data-driven registries · federation panorama roll-up · tenant/RLS backfill + Redis fan-out + integrity check · dashboard consolidation.

## Đánh giá khả thi 2-persona + remediation (doc 22/23)
- **Đánh giá (doc 22):** chuyên gia (7 agent audit code-vs-doc) + người-dùng-lần-đầu; bảng điểm maturity kiểm chứng (hạ 1B 45→30 vì SECS/FOCAS/Euromap là framework; K3 bị đánh giá thấp; AI thật). Codebase trung thực bất thường (stub tự-ghi-rõ).
- **P0 (lỗi đúng-đắn):** reservation atomicity (txn + `SELECT … FOR UPDATE` → hết race TOCTOU) · deploy **ép Simulation Gate pass** trước khi tới thiết bị · verifier migration phát hiện dev DB kẹt 0130 → áp 24 migration → **0156**.
- **P1:** đồng bộ doc-truth (doc 16/17).
- **P2:** nối producer đang ngủ — `model_performance_snapshots` (mở khóa auto-rollback), RCA vision evidence, safety sim-track upstream (advisory, cờ OFF).
- **P3:** license-gate 8 route automation · allocator N+1→batched query · fleet rebalance drain sweep · OPC-UA monitored-items push.
- **P4 + breadth:** Simple/Advanced nav mode + 16 jargon hints + 12 Beta badges + language consistency; **design-system rollout 32 trang** (PageHeader + token semantic); deepen Viewer/AdminHome (KPI/queries sẵn có).
- **P5 + deeper:** IK solver (move_linear full-arm collision) · glTF twin assets thật + **upload/đăng ký model 3D từ cockpit** · SECS-II codec; **GEM E30 state model** · **D* Lite** dynamic replanning · **physics-sim dynamics seam** (Isaac/RoboDK seam).
- **doc 23:** runbook flip-cờ + smoke-test cho ops (4 tầng rủi ro: advisory → orchestration → device-facing → hardware).
- **UI fixes:** `/dashboard` theo dark/light theme (widget-style theme-aware) · sidebar collapse = **icon rail + hover flyout** (hết đè content) · **giữ trạng thái collapse qua điều hướng**.

## Maturity (TB ~53% → ~85%)
K0 90 · K1 90 · K1B 70 · K2 85 · K3 60(sw) · K4 95 · K5 85 · K6 85 · K7 75 · Frontend 92

## Còn lại (ngoài phạm vi code)
- **Ops:** flip cờ Tier A trên staging + smoke-test (doc 23).
- **P6 phần cứng:** rated-stop SIL 2/3 + UWB/LiDAR, export `yolo26n.pt→.onnx` + hiệu chuẩn, FOCAS Fwlib32, EtherCAT real-time, commissioning cuối. Mọi phần khác chạy được với sim miễn phí (URSim/ROS2/OPC-UA/MTConnect).

## Kích hoạt / test
Activation runbook: **doc 19** + **doc 23** (flip-cờ + smoke-test). Sim setup (Docker URSim/ROS2/OPC-UA/MTConnect): **doc 20 §7**. Seed demo: `node scripts/seed-automation-demo.mjs`. Verify migration: `node scripts/check-applied-migrations.mjs`.

## Docs
16 (thiết kế hợp nhất) · 17 (design system) · 18 (tiến độ) · 19 (activation runbook) · 20 (Nhóm C + sim runbook) · 21 (upper-layer audit) · 22 (đánh giá khả thi + kế hoạch + tiến độ) · 23 (flip-cờ + smoke-test runbook).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
