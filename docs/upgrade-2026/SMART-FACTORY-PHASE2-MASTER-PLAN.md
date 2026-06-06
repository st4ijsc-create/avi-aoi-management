# Kế hoạch tổng thể — GIAI ĐOẠN 2 Nhà máy Thông minh 4.0

> Tạo 2026-06-06. Tài liệu kiến trúc & roadmap để **chủ dự án review và duyệt TRƯỚC KHI gọi AI Agent chuyên môn code**. Nối tiếp Giai đoạn 1 (F1-F6 đã hoàn tất, 11 commit, QA 10/10 — xem `SMART-FACTORY-4.0-MASTER-PLAN.md` + memory `smart_factory_4_0_roadmap.md`).
> Nguyên tắc kế thừa GĐ1: local-first/offline · HITL propose→confirm→execute (RBAC 2 lần + audit) · **AI chỉ ĐỀ XUẤT, con người duyệt** · i18n vi/en/zh · idempotency · **tái dùng schema/endpoint sẵn — không viết lại nghiệp vụ** · feature-flag mặc định OFF · mỗi sprint qua chu trình Plan→chuyên môn→QA độc lập.
> Phạm vi GĐ2 (chủ dự án đã chọn cả 4 nhóm): **A) Playbook/SOP engine · B) Hoàn thiện OT control · C) MES nâng cao (BOM/APS/Energy) · D) FE đầy đủ + Digital twin.**

---

## PHẦN A — ĐÁNH GIÁ HIỆN TRẠNG (đã khảo sát mã thật, branch feat/smart-factory-f1.1-ot-framework)

**Tin tốt:** GĐ1 đã đặt nền schema cho hầu hết GĐ2 → phần lớn công việc là **UI + service mở rộng**, chỉ 1 hạng mục cần engine mới lớn (APS). Không phần nào cần refactor cái đang chạy.

| Nhóm | Hạng mục | Đã có (tái dùng) | Chưa có (làm mới) | Khối lượng |
|---|---|---|---|---|
| **A** | Playbook/SOP engine | GĐ3a write-tool catalog (commit `02727b3`: alerts/measurementPoint/spec/yield + navigate/prefill); HITL framework (aiCopilotActions); LLM planner (aiGgufEngine.generateJSON:594); intentClassifier LLM fallback; tryExecuteTool | `aiAgentOrchestrator.ts` (multi-step plan-execute); `ai_agent_sessions` schema+migration; `aiAgentRouter`; playbook YAML loader/engine; 4-5 playbook SOP; FE plan/step render | Lớn |
| **B** | OT control hoàn thiện | commandDispatcher F4 (gate+ack); opcua/modbus writeTags thật; otScale.inverseScale + encodeModbus (mẫu) | Read-back ack (verify giá trị sau write) + cột commandLog.readBackValue; writeTags thật cho S7/Mitsubishi-MC/EtherNet-IP (3 driver còn ok:false) | Vừa |
| **C** | MES: BOM | supplierLots/materialReceipts/lotDisposition (cấp LOT); machineTypeEnum FEEDER (F2); processResults | BOM cấp component (bom_definitions/bom_line_items); feeder material assignment + consumption; truy vết component→serial genealogy | Vừa |
| **C** | MES: APS | scheduleRuns (FIFO/Priority/EDF audit); dispatchingService (realtime ranking heuristic) | Constraint solver hữu hạn năng lực (capacity/changeover/resource-leveling/precedence); persistent applied schedule; apply-confirm flow | **Lớn** |
| **C** | MES: Energy | energyReadings/enpiMetrics (kWh/unit+carbon); TimescaleDB hypertable; aiTimeSeriesEngine (forecast) | Per-recipe energy (link energyReadings↔machineRecipes/processResults); peak demand/power factor; energyRouter + forecast wiring | Vừa |
| **D** | FE OT admin | UI lib (Radix+Recharts+Tailwind); khuôn CRUD (PermissionsManagement/AdminPage); AndonBoard (F5a); AIToolResultCard (F6 fallback); interlockRouter/andonRouter đã có | UI: deviceAdapter/deviceTag (F1), recipe editor+deploy (F4), interlock rule admin (F5), command audit log (F5b), card render riêng tool F6 | Vừa-Lớn |
| **D** | Digital twin | digitalTwinService/digitalTwinRouter (twinState/heatmap/whatIf); layout.ts+machinePositions; WorkshopLayoutEditor/Factory3DScene; otTelemetry nguồn realtime | WIP flow animation trên layout; station load heatmap (starved/blocked); WebSocket streaming twin; prediction overlay (forecast WIP) | Vừa |

**Lưu ý chỉnh:** GĐ3a write-tool catalog ĐÃ code (commit `02727b3`) — GĐ2 chỉ cần **GĐ3b orchestrator + GĐ3c playbook** (đứng trên catalog sẵn có), KHÔNG làm lại catalog.

---

## PHẦN B — KIẾN TRÚC & PHỤ THUỘC GĐ2

```
┌─ A. Playbook/SOP Engine ─────────────────────────────────────────┐
│  aiAgentOrchestrator (plan-execute) ─ ĐỨNG TRÊN HITL, không sửa lõi│
│   Planner(GGUF generateJSON) → plan{steps} → user duyệt →          │
│   read-step chạy luôn · write-step → proposeAction → confirm RIÊNG  │
│   ai_agent_sessions (trạng thái) · playbook YAML (plan tĩnh người soạn)│
│   AN TOÀN: mỗi write confirm riêng, không auto-chain, AGENT_MAX_*   │
└────────────────────────────────────────────────────────────────────┘
        │ tái dùng              │ điều khiển máy qua
        ▼                       ▼
┌─ tool catalog GĐ1/2/3a + machine_control F4 ─┐   ┌─ B. OT control ──┐
│  read/write/client tools (HITL)              │──▶│ 5 driver writeTags│
└──────────────────────────────────────────────┘   │ + read-back ack  │
                                                    └──────────────────┘
┌─ C. MES nâng cao ────────────────────────────────────────────────┐
│  BOM(component+feeder) → APS(constraint solver) ← capacity         │
│       │                       │ apply schedule                     │
│       └─ per-recipe energy ◀──┴──▶ aiTimeSeriesEngine (forecast)    │
└────────────────────────────────────────────────────────────────────┘
┌─ D. FE + Digital twin ───────────────────────────────────────────┐
│  UI admin: deviceAdapter/tag(F1) · recipe(F4) · interlock(F5) ·    │
│  command audit(F5b) · tool cards(F6)   │  twin: WIP flow + heatmap  │
│                                        │  + WebSocket + forecast     │
└────────────────────────────────────────────────────────────────────┘
```

**Phụ thuộc chính:** BOM(C1) → APS(C2) [material→schedulability] · APS → twin(D) [visualize schedule] · per-recipe energy(C3) cần link recipe↔energy · FE OT admin(D5) cấu hình adapter/tag → bổ trợ F1/F4/F5.

---

## PHẦN C — ROADMAP GĐ2 (theo giai đoạn G2.x, mỗi giai đoạn 1 chu trình Plan→chuyên môn→QA)

> Thứ tự tối ưu phụ thuộc + giá trị: nền OT/UI trước → playbook → MES → twin. Mỗi giai đoạn nghiệm thu độc lập, feature-flag OFF mặc định.

### G2.1 — Hoàn thiện OT control (Nhóm B) ★ưu tiên 1, rủi ro/khối lượng thấp, củng cố F4★
- **B1 — Read-back ack:** sau write ok, `commandDispatcher` gọi `driver.readTags` verify giá trị == expected; thêm cột `commandLog.readBackValue` + status `acked_verified`/`acked_unverified`; cờ `OT_READBACK_ENABLED`. Tái dùng driver.readTags sẵn.
- **B2 — writeTags 3 driver:** S7 (nodes7 writeItems), Mitsubishi-MC (mcprotocol write), EtherNet/IP (st-ethernet-ip writeTag). Bám khuôn opcua/modbus + otScale.inverseScale; encode riêng từng protocol (như encodeModbus). writeTags vẫn CHỈ commandDispatcher gọi (bất biến F4 giữ nguyên).
- **Nghiệm thu:** read-back verify hoạt động (mismatch→cảnh báo, không retry mù); 3 driver write thật qua mock lib test; write-path vẫn duy nhất qua HITL+dispatcher.

### G2.2 — FE admin cho OT (Nhóm D5) ★ưu tiên 1, mở khóa vận hành F1/F4/F5★
- deviceAdapter/deviceTag management UI (CRUD + test kết nối) — cần thêm adapter/tag CRUD router (read schema F1 sẵn).
- recipe editor + deployment history UI (F4 — machineRecipes/recipeDeployments; recipe CRUD router).
- interlock rule admin UI (F5 — condition builder + scope + action + approval workflow; interlockRouter đã có phần lớn).
- command audit log UI (F5b — commandLog read; lọc theo triggerKind hitl/interlock).
- card render riêng cho tool F6 (line_balance bảng, process_metric_trend sparkline).
- **Nghiệm thu:** cấu hình 1 adapter+tag qua UI; soạn+duyệt+enable 1 interlock rule qua UI; xem lịch sử lệnh; tất cả qua RBAC sẵn (machine_control/interlock/andon).

### G2.3 — Playbook/SOP engine (Nhóm A) ★ưu tiên 2, giá trị AI cao★
- **A1 — GĐ3b orchestrator:** `aiAgentOrchestrator` đứng trên HITL; planner generateJSON sinh `{goal,steps[]}`; `ai_agent_sessions` (migration mới); vòng lặp planning→duyệt→running; write-step→proposeAction→confirm RIÊNG; giới hạn `AGENT_MAX_STEPS=6`, `MAX_WRITES_PER_SESSION=3`; không auto-chain; agentic mode default OFF, bật theo role.
- **A2 — GĐ3c playbook:** YAML loader/engine chạy trên orchestrator; 4-5 SOP: "Tạo điểm đo+spec", "Xử lý NG tăng/điều tra", "Đổi recipe đầu line", "Cài máy mới vào line", "Train model defect"; step type guidance/navigate/prefill/tool/confirm/branch.
- **A3 — FE:** render plan (step list + progress) + confirm từng write + Bắt đầu/Tiếp/Dừng.
- **AN TOÀN:** mỗi write vẫn qua HITL F4/GĐ2; AI đề xuất plan, người duyệt; không tự execute write/điều khiển máy.
- **Nghiệm thu:** chạy trọn 1 playbook 2-3 bước (plan trước, confirm từng write, giới hạn hiệu lực, lỗi→paused sạch); ≥1 multi-step từ câu hỏi tự do.

### G2.4 — MES: BOM + Feeder (Nhóm C1) ★ưu tiên 2★
- bom_definitions + bom_line_items (product→component list, qty/unit) + feeder_materials (máy FEEDER→material, consumption rate, reorder trigger).
- Truy vết component→serial (genealogy hạ nguồn, tái dùng genealogyChain hash-chain).
- CRUD router + UI. Tái dùng material traceability LOT sẵn.
- **Nghiệm thu:** định nghĩa BOM 1 product; gán feeder material; tiêu hao trừ tồn; truy vết component vào serial.

### G2.5 — MES: APS constraint solver (Nhóm C2) ★ưu tiên 2, khối lượng LỚN★
- Constraint engine: capacity hữu hạn (slot/time mỗi máy), changeover time (setup giữa product/recipe), resource leveling, job precedence. Cân nhắc OR-Tools (CP-SAT) hoặc bespoke solver — đánh giá ở Plan G2.5.
- Persistent applied schedule + apply-confirm flow (HITL: đề xuất lịch→người duyệt→áp dụng); tái dùng scheduleRuns audit.
- Tích hợp dispatchingService realtime; cần machine/line capacity metadata (schema bổ sung).
- **Nghiệm thu:** sinh lịch khả thi tôn trọng capacity+changeover cho ≥1 line nhiều order; so KPI (makespan/lateness) vs FIFO; apply qua HITL.

### G2.6 — MES: Energy nâng cao (Nhóm C3+C4) ★ưu tiên 3★
- Per-recipe energy: link energyReadings↔machineRecipes/processResults (kWh/recipe/cycle); mở rộng cột energyReadings (peak kW, power factor) + enpiMetrics.
- energyRouter + wire aiTimeSeriesEngine forecast (peak demand prediction, demand-response gợi ý).
- **Nghiệm thu:** báo cáo kWh theo recipe/sản phẩm; peak demand+PF; dự báo năng lượng; ISO 50001 EnPI mở rộng.

### G2.7 — Digital twin nâng cao (Nhóm D7) ★ưu tiên 3★
- WIP flow animation trên layout (wipTracking→vị trí station realtime); station load heatmap (starved/blocked từ stationDwellTime); WebSocket streaming twinState (thay refetch); prediction overlay (forecast WIP từ aiTimeSeriesEngine).
- Tái dùng digitalTwinService/Router + Factory3DScene + layout sẵn.
- **Nghiệm thu:** twin hiển thị WIP di chuyển realtime + heatmap tải trạm; dự báo nghẽn overlay.

### Thứ tự khuyến nghị
```
G2.1 (OT control) ─┬─ G2.2 (FE OT admin) ─┬─ G2.3 (Playbook) ── G2.7 (Twin)
                   └─ G2.4 (BOM) ── G2.5 (APS) ── G2.6 (Energy) ─┘
```
G2.1+G2.2 trước (củng cố + mở khóa vận hành OT). G2.3 playbook song song. G2.4→G2.5→G2.6 chuỗi MES. G2.7 twin cuối (hưởng lợi từ APS+telemetry).

---

## PHẦN D — RỦI RO & AN TOÀN GĐ2
| Rủi ro | Biện pháp |
|---|---|
| G2.1 mở write 3 driver → tăng bề mặt điều khiển máy | writeTags vẫn CHỈ commandDispatcher gọi (bất biến F4); read-back ack tăng độ tin cậy; test mock lib; cờ OT_CONTROL_ENABLED giữ |
| Playbook auto-chain nhiều write | Mỗi write confirm RIÊNG qua HITL; AGENT_MAX_STEPS/MAX_WRITES; không auto-chain; AI chỉ đề xuất plan |
| APS solver phức tạp/sai lịch gây dừng máy | APS chỉ ĐỀ XUẤT lịch (apply qua HITL người duyệt); không tự điều khiển; so KPI trước khi áp |
| Phá F1-F6/AOI đang chạy | Tái dùng schema sẵn, UI/service cộng thêm, migration additive, feature-flag OFF |
| Energy/twin nặng query realtime | Giới hạn window/limit; TimescaleDB; WebSocket thay poll; cache insight nếu cần |

---

## PHẦN E — 7 QUYẾT ĐỊNH ĐÃ CHỐT (2026-06-06) ✅
1. ✅ **Thứ tự:** G2.1→G2.2 trước (củng cố OT control + UI admin vận hành).
2. ✅ **APS solver:** dùng **OR-Tools** (CP-SAT) — solver mạnh cho capacity/changeover/precedence.
3. ✅ **Playbook agentic mode:** bật cho role **manager/it_admin** trước; `AGENT_MAX_STEPS=6`, `MAX_WRITES_PER_SESSION=3`.
4. ✅ **Read-back ack:** mismatch giá trị sau write → **chỉ CẢNH BÁO** (status `acked_unverified`, KHÔNG coi failed — PLC có thể đang xử lý).
5. ✅ **BOM:** truy vết **component→serial ĐẦY ĐỦ** (genealogy hash-chain).
6. ✅ **Phạm vi:** làm **cả 7 giai đoạn G2.1-G2.7**.
7. ✅ **FE:** **đầy đủ admin cho mọi tính năng OT** (deviceAdapter/tag, recipe, interlock, command audit, card F6).

---

## PHẦN F — QUY TRÌNH SAU KHI DUYỆT
1. Chủ dự án review tài liệu, trả lời Phần E.
2. Mỗi giai đoạn G2.x đã duyệt → Agent Plan lập tài liệu kỹ thuật chi tiết (như các plan GĐ1) trước khi code.
3. Gọi AI Agent chuyên môn thực thi từng giai đoạn, mỗi PR nhỏ + test + QA verify độc lập, không hồi quy F1-F6/AOI.
4. Feature-flag OFF mặc định; bật dần trên line pilot.
