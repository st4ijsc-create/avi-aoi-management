<!--
Mô tả PR sẵn-dùng cho nhánh `automation-orchestration-r0`.
Push + mở PR:
  git push -u origin automation-orchestration-r0
  # rồi mở: https://github.com/BGJackFrost/avi-aoi-management/compare/main...automation-orchestration-r0?expand=1
Dán TITLE + BODY dưới đây vào PR (bỏ phần comment này).
-->

# TITLE
feat: Automation & Robotics Orchestration ecosystem — full software + pre-hardware (Khối 0–7)

# BODY

Thực thi thiết kế hợp nhất (doc 16) từ báo cáo tham khảo "Hệ sinh thái Điều phối Robot & Tự động hóa", cộng đánh giá lại + hoàn thiện toàn bộ phần mềm và Nhóm C pre-hardware. **32 commit**, migrations 0141–0154, full test suite **2408 passed / 0 failed**, typecheck + `vite build` sạch.

## Nguyên tắc an toàn (giữ xuyên suốt)
- **Mọi tính năng sau flag OFF mặc định** — zero behavior change tới khi bật.
- **Không mở đường điều khiển thiết bị mới** — mọi lệnh vẫn qua gate HITL + dry-run + idempotency + audit append-only.
- Migration additive/idempotent; **mọi "seam" cần phần cứng/kết nối thật được ghi nhận trung thực, không bịa dữ liệu**.

## Phần mềm (Khối 0–7 + Frontend)
- **R0** ERP gateway (inbound order/BOM + outbox bền + circuit-breaker) + PdM đóng vòng (K0/K4)
- **G1·G2** Fleet: task allocator + zones/traffic + skill/resource/charging (K2 — hoàn chỉnh)
- **T1** Digital Twin: scene-graph + WS stream + replay + occupancy A* + 3D UI (K7)
- **S1** Safety advisory (safety_events SIL-tagged) + workforce + Andon→robot (K3 sw)
- **E1** Equipment Standards governance + conformance CI + compliance (K5)
- **I1·X1** FOCAS/Euromap framework + recipe versioning + UDM/heartbeat/streaming/discovery/command-authz (K1B/K1)
- **D1** IR + safety-linter + transpiler URScript/ROS2 + Visual IR Editor (K6)
- **I2** robot-behavior anomaly + model auto-rollback + alarm wiring (K4)
- **K0+** OAuth2 + ISA-95/B2MML + producer→outbox (K0)
- **Frontend** menu redesign + design-system 6-wave (tokens/pattern components/~36 trang/a11y AA/Storybook 10) + V1 seed+runbook + V3 CI-xanh

## Nhóm C pre-hardware (doc 20) — 6/6
- **T2b** Kinematic Simulation Gate (FK + collision + joint-limit + cycle-time) **thay stub `simulate()` của D1 bằng cổng chặn THẬT**
- **I3a** URSim client (validate transpiler D1 trên controller UR thật-ảo) + ROS2 bridge (rosbridge WS)
- **T2a** URDF→glTF converter (twin render model thật; đóng seam kinematic của T2b)
- **S2a** safety-zone + evaluator 3 cấp (advisory; rated-stop log-không-actuate)
- **S2b** homography human-detect producer + safety-PLC read-only adapter (sim)
- **I3b** MTConnect field-map thật + Euromap-77 OPC-UA reader → alarm→Andon vs sim

## Maturity (TB ~53% → ~85%)
K0 90 · K1 90 · K1B 70 · K2 85 · K3 60(sw) · K4 95 · K5 85 · K6 85 · K7 75 · Frontend 92

## Còn lại: chỉ phần cứng bất-khả-thay-bằng-phần-mềm
rated-stop SIL 2/3 + UWB/LiDAR (S2), FOCAS Fwlib32 + Fanuc thật, EtherCAT real-time, commissioning cuối, export `yolo26n.pt→.onnx` + hiệu chuẩn homography. Mọi thứ còn lại chạy được với sim miễn phí (URSim/ROS2/OPC-UA/MTConnect).

## Kích hoạt / test
Theo **doc 19** (activation runbook): `node scripts/seed-automation-demo.mjs`, bật flag theo thứ tự, `npm run dev`. Sim setup (Docker URSim/ROS2/OPC-UA/MTConnect) trong **doc 20 §7**.

## Docs
16 (thiết kế hợp nhất) · 17 (design system) · 18 (tiến độ) · 19 (activation runbook) · 20 (Nhóm C + sim runbook).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
