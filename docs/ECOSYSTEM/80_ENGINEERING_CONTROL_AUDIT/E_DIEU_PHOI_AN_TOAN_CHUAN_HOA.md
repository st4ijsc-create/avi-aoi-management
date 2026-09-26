# Phụ lục E — Orchestration · Fleet · Safety & Workforce · Equipment Standards · Equipment Integration

> Thuộc doc 80. 2026-09-25 · pha PLAN. Đọc mã 5 trang + 6 router + service lõi; 49 lượt GET tRPC ×3 (engineer1); DB `READ ONLY` 32 bảng; bundle `dist/public/assets`. Không gọi mutation; không gọi `euromapOpcuaSnapshot` (mở kết nối ra ngoài).
> Số thô (ngoài repo): scratchpad phiên `E-orch-std/` — `results.json`, `db.json`, `i18n.mjs`.

| Trang | Chức năng | UX | Chuyên nghiệp | Backend | DB | Hiệu năng | **Tổng** | Khuyến nghị |
|---|---|---|---|---|---|---|---|---|
| Orchestration Studio | 6,5 | 5,5 | 4,5 | 5,0 | 4,5 | 6,0 | **5,3** | Giữ, làm lại Draft→Sim→Publish→Run |
| Fleet | 4,5 | 5,0 | 2,5 | 5,5 | 4,0 | 6,0 | **4,6** | Chuyển **Labs** (0 AMR, 100 % demo) |
| Safety & Workforce | 3,5 | 5,0 | 2,5 | 5,0 | 4,0 | 7,0 | **4,5** | **Tách**: Safety gộp Interlock; Workforce → Sản xuất/Ca |
| Equipment Standards | 5,5 | 5,5 | 4,0 | 6,5 | 5,0 | 7,0 | **5,6** | Tái định vị "Alarm Management & Standards" |
| Equipment Integration | 3,5 | 4,5 | 2,5 | 5,0 | 5,0 | 7,0 | **4,6** | **Giải thể** về /recipes, /connectivity, Vision |

## 1. Số đo

**Độ trễ:** không query nào chậm (median 17–264 ms). Vấn đề là **payload thừa và poll vô hạn**:
- `equipment.listEquipment{500}` **854 KB** mỗi lần mở Studio, chỉ để đổ dropdown chọn máy.
- Studio poll `listRuns` mỗi 2 s **vĩnh viễn** vì run #2 `held` từ 2026-07-16 không bao giờ terminal (≥30 req/phút) — phiên chính đo live: `orchestration.listRuns` gọi lại ở 3,9 s · 6,2 s · 9,2 s · 11,3 s · 14,0 s.
- Fleet tab Tasks: 5 query mỗi 5 s + N+1 truy vấn chiếm dụng theo zone.
- Integration tab Acquisition poll 5 s cả khi `liveEnabled=false`.
- Safety dùng socket thật `safety:event` — tốt.

**DB:** cả cụm chỉ 4 FK (nhóm recipe); orchestration/fleet/safety/standards **0 FK**.
- Orchestration: workflows 5 · versions 5 · runs 6 · run_steps 17 · run_events 0.
- Fleet: tasks 2 · zones 4 · robots 3 (kind `arm`, **0 AMR**) · reservations 0 · chargers 2.
- Safety: safety_events 0 · zones 0 · safety_plc_configs 1 (**backend SIM**) · operator_assignments 2 (`scope='demo'`, hết hạn 2026-07-16 nhưng board coi "active").
- Standards: device_types 31 (**100 % seed**) · alarm_taxonomy 175 · master_alarms 13 · andon_events 80 (**0 trong 7 ngày**).
- machines **1 700** (mã QATD-*, dữ liệu thử tải) ⇒ KPI "1700/1700 mapped" (quan sát live) là con số của dữ liệu thử.

**Bundle:** chunk trang 56–96 KB (gzip 10–20 KB); Orchestration nạp tĩnh xyflow 138 KB dù view mặc định là Cây; Standards/Safety kéo recharts 351 KB; **`vendor-three` 1,46 MB (420 KB gz) modulepreload mọi trang**.
**i18n:** đủ khoá vi/en ở cả 5 trang; còn 18 chuỗi mặc định trong Studio; enum thô hiển thị trực tiếp. 0/5 trang có sort/pagination hay đọc tab/bộ lọc từ URL ⇒ deep-link `?filter=` từ PendingReviewStrip đều chết.

**Quan sát UI live (phiên chính):** Orchestration — nút hiển thị **hai icon chồng** (icon + emoji: "🧪 Mô phỏng", "💾 Lưu (deploy)", "▶ Chạy"); nút "Lưu (deploy)" gộp lưu với deploy; 3 banner thông báo xếp trước nội dung. Fleet — 9 thẻ KPI một hàng, nhãn bị cắt ("Đang …", "Đặt tr…", "Tài ng…"). Integration — "13 Adapter đã kết nối" cạnh "0 Thiết bị đã kết nối" (nhãn gây hiểu nhầm: đăng ký ≠ kết nối); 4 banner trước nội dung.

## 2. Gating

| Trang | Menu | RouteGuard | Server đọc | Server ghi |
|---|---|---|---|---|
| Orchestration | machine_control | navHref | machine_status + MOD_ENGINEERING | canCreate; start/resume/abort/rollback = actuation; deploy = deployProcedure (OTP tươi); **delete/duplicate = protected trần** |
| Fleet | **machine_status** | **machine_control** | machine_status + MOD_OT_CONTROL | canCreate + actuation |
| Safety | machine_status | machine_status | machine_status | canCreate, **protected trần** |
| Standards | machine_status | machine_status | machine_status (không module gate) | canCreate; **delete cũng dùng canCreate** |
| Integration | machine_status | machine_status | machine_status | canCreate |
| `orchestrationGov.*` | — | — | **không requirePermission** | — |

Hệ quả: operator thấy Fleet trong menu rồi bị chặn; mở được 3 trang read-only nhưng **không mở được Hub** ⇒ 3 trang mồ côi. maint1 (canEdit, không canCreate): mọi nút khoá vì chỉ nhìn canCreate ⇒ **canEdit vô nghĩa** trong cụm. engineer/supervisor: nút Delete workflow bật nhưng server FORBIDDEN; **không role nào có `machine_control/canDelete`**. Phạm vi nhà máy chỉ có ở đường đọc của Fleet.

## 3. Trung thực dữ liệu

6/6 run có `contextJson.seed=true`; UI không hiện `simulated/routedTo` ⇒ không phân biệt dry-run; run #2 "held" do restart nằm trong nhóm "Đang chờ duyệt" kèm nút **Approve** (bấm ⇒ chạy lại một workflow thật). Fleet `DEMO-TASK-*`, 0 toạ độ robot, cờ BẬT nên không banner. Safety: PLC nguồn là SIM mà trang không nói. Standards: compliance tính trên hằng số seed trong code, KPI báo động tính trên andon với `operatorCount=1` cứng ở client. Integration trung thực nhất (`configured:false`, `source:"none"`).
⇒ Không trang nào có nhãn DEMO/SEED. Theo nguyên tắc chủ dự án: đề xuất danh sách xoá hoặc gắn nhãn, **báo trước khi xoá** (6 run + 17 run_steps, 2 task, 2 assignment).

## 4. Phát hiện

**Orchestration**
- **ORC-01 P0 — Abort không dừng run đang chạy.** `rc.aborting` chỉ khai báo (`foeEngine.ts:243`) và đọc (`:555`), không nơi nào gán; `abortRun` (`:1376-1390`) chỉ ghi DB `aborted`; driver chạy tiếp và **ghi đè `completed`** (`:849-856`, phiên chính đã tự kiểm). Hậu quả: Abort không dừng lệnh; lịch sử ghi "completed".
- **ORC-02 P1:** `resumeRun` không CAS (`:1177-1220`) ⇒ hai lượt duyệt ⇒ hai driver ⇒ có thể dispatch trùng.
- **ORC-03 P1:** `approverRoles` chỉ lưu (`:655`), không kiểm; người chạy tự duyệt; UI khẳng định sai "RBAC is enforced at the API" (`OrchestrationStudio.tsx:468`).
- **ORC-04 P1:** run `held` do restart nằm trong "chờ duyệt" (`:1120-1123`).
- **ORC-05 P1:** rollback là actuation (không OTP tươi) và tự điền override qua sim-gate (`foeEngine.ts:1050`).
- **ORC-06 P1:** duplicate tạo `status:"active"`, không validate/snapshot, protected trần (`orchestrationRouter.ts:389-437`) ⇒ workflow chạy được ngay, bỏ qua deploy gate.
- **ORC-11 P1:** `orchestrationGov` không RBAC, không module gate (IDOR nhật ký run khi bật FOE_DURABLE).
- **ORC-07 P2** delete 3 lệnh rời không TX/audit · **ORC-08 P2** Delete bật theo canCreate, server đòi canDelete · **ORC-09 P2** `startRun` đồng bộ (bấm lại ⇒ run thứ hai) · **ORC-10 P2** precondition "hold" trả failed · **ORC-12 P2** không Draft/dirty/autosave, **Run chạy bản `ref` đã deploy, không phải bản trên màn hình** · **ORC-13 P2** không hiện `simulated/routedTo` · **ORC-14 P2** poll 2 s vĩnh viễn · **ORC-15 P2** 854 KB, Select 500 mục · **ORC-16..19 P3** `ui` trong hash, ô Version bị bỏ qua, `/cell-twin` mất `ref`, xyflow nạp tĩnh.

**Fleet** — FLT-01 P1 ba tầng quyền lệch · FLT-02 P1 12 mutation không ghi actor, 0 audit · FLT-03 P1 ghi không kiểm phạm vi nhà máy · FLT-04 P1 100 % demo, 0 AMR, không banner · FLT-05 P2 Resolve deadlock 1 click (doc 26 đã nêu, **vẫn mở**) · FLT-06 P2 `allocateTask` đọc-rồi-ghi ⇒ phân bổ kép · FLT-07 P2 CRUD què, 7 form nhập ID số trần · FLT-08 P2 huỷ task không nhả zone/resource · FLT-09 P2 `listZones` N+1 · FLT-10/11 P3 `?? true`; bản đồ SVG tĩnh.

**Safety & Workforce** — **SAF-01 P1** nút test proximity bật **Andon vàng thật** + ghi `detectedBy:"operator"` (`nearMissAdvisor.ts:121,131-146`) · **SAF-02 P1** không hiển thị PLC SIM / vision / zone / e-stop · SAF-03 P2 19 thủ tục S2/S3 không có UI · SAF-04 P2 board không lọc thời gian · SAF-05 P2 ID số "#48" · SAF-06 P2 protected trần, không phạm vi · SAF-07 P3 không chỉ báo mất socket.

**Standards** — **STD-01 P1** KPI tautology (24/24, 1700/1700 luôn xanh) · **STD-02 P1** Shelve không đường báo động nào đọc tới (người vận hành tưởng đã shelve nhưng báo động vẫn nổ), 8 h 1 click không lý do · **STD-03 P1** xoá master alarm 1 click, xoá cứng, quyền canCreate · **STD-04 P1** hai bộ tính KPI ISA-18.2 cho hai con số khác nhau, `operatorCount:1` · STD-05 P2 MADB ngoài MOC, `upsertAlarmMapping` không audit · STD-06 P2 9 query mọi tab, không tìm/where-used · STD-07 P3.
Điểm mạnh: backend tốt nhất cụm — CR có SoD, publish trong TX + `FOR UPDATE` + optimistic lock, semver gate, audit bất biến, priority suy ở server (EEMUA-191).

**Integration** — **INT-01 P1 (bảo mật) SSRF:** `euromapOpcuaSnapshot` là query GET, chỉ cần canView, nhận `endpoint` do client gửi rồi mở kết nối OPC-UA tới đó, còn có tác dụng phụ đẩy alarm lên Andon (`equipmentIntegrationRouter.ts:120-151`; `euromapAdapter.ts:233-239`) · **INT-02 P1** release/rollback recipe qua Integration dùng protected + canCreate, bỏ qua duyệt/2FA, không validate schema (cùng bảng mà /recipes bảo vệ bằng SoD + 2FA) · INT-03 P2 phải gõ mã recipe, payload JSON thô · INT-04 P2 Acquisition sai miền · INT-05 P3.

**Xuyên suốt** — X-01 P1 không nhãn DEMO · X-02 P1 gating lệch, canEdit vô nghĩa, không ai có canDelete · X-03 P2 0/5 trang đọc query-string · X-04 P2 không sort/pagination, ID số thay picker · X-05 P2 phạm vi nhà máy chỉ ở đọc Fleet · X-06 P2 three.js preload toàn app · X-07 P3 cờ đang tải mặc định `true`.

## 5. So với đối thủ

- **Orchestration** vs Camunda Operate / Ignition SFC / Node-RED / Tulip: thiếu token trên sơ đồ, incident/retry, **cancel thật**, user task có candidateGroups được ép, Draft/Published, debug sidebar. Chỉ **vượt** ở mô phỏng thuần + sim-token HMAC.
- **Fleet** vs MiR Fleet / OTTO / Locus / VDA 5050 master control: mô hình dữ liệu tương đương một phần; thiếu toàn bộ mặt thiết bị thật (map editor, mission queue, robot card, auto-charge, trạng thái kết nối).
- **Safety** vs EHS (Intelex, Cority): thiếu điều tra → CAPA → đóng; phần safety-rated (Sick, Pilz) không nên cạnh tranh.
- **Standards** vs PAS PlantState / Exaquantum / DynAMo: thiếu rationalization + MOC, **enforcement** so với cấu hình thật, bad actor liên kết rationalization, shelving có lý do/thời hạn/audit.
- **Integration** vs Kepware / Ignition Device Connections / HighByte: khoảng cách gần như toàn bộ; chức năng kết nối thật của hệ thống nằm ở /connectivity và /device-adapters.

## 6. Thiết kế cải tiến

### 6.0 Bố trí lại menu
```
Kỹ thuật & Điều khiển
├ Hub
├ Soạn thảo: IDE (Workspace · IR · POU) · Recipes (+Genealogy, hấp thụ phần recipe của Integration)
├ Điều phối: Orchestration (Library · Designer · Runs · Approvals)
├ An toàn: Interlock & C–E · Safety Monitor (advisory)
├ Chuẩn hoá: Alarm Management & Standards
└ Labs (ẩn mặc định, cờ ENGINEERING_LABS): Fleet · Collaboration
Chuyển ra ngoài: Workforce → Sản xuất›Ca · FOCAS/Euromap → Connectivity›Connector catalog
                 · Acquisition → AOI/Vision · /equipment-integration → Redirect theo tab
```
Tiêu chí Labs (đo được): vào Labs khi 30 ngày có 0 pose hoặc 0 hàng không-seed ở bảng lõi; ra Labs khi ≥1 thiết bị thật gửi dữ liệu ≥7 ngày **và** ≥1 mutation thật/tuần. Kiểm bằng `readinessRouter` để Hub tự hiện "Sẵn sàng / Labs".

### 6.1 Orchestration v2 — M (vá engine) + L (UI)
Kết cục: **K1** abort khi run ở `delay/wait_*` ⇒ 0 lệnh dispatch sau abort, trạng thái cuối `aborted`; **K2** 20 resume đồng thời ⇒ đúng 1 driver; **K3** vai ngoài `approverRoles` ⇒ FORBIDDEN, người start ≠ người duyệt khi `fourEyes`; **K4** tải ban đầu ≤60 KB, 0 poll khi không có run `running/queued`; **K5** autosave nháp ≤2 s, F5 không mất.
```
LIBRARY
┌ Orchestration ▸ Library ─────────────────────── [+ New] [Import] ┐
│ [Tìm] [Trạng thái▾] [Chủ▾] [Máy combobox▾]                        │
│ Ref▲ │ Tên │ Draft? │ Published │ Chạy cuối │ Trạng thái │ ⋮      │
│ line-a │ Chạy chuyền A │ ● sửa │ v3 │ 2h ✓ │ Active │           │
│ qt-1 │ QT-1 │  │ v1 DEMO │ seed │ Active │      « 1 2 » 25/trang  │
└───────────────────────────────────────────────────────────────────┘
DESIGNER
┌ ◀ │ line-a ● Draft (khác v3)  [Undo][Redo] [Simulate▶] [Publish…] [Run v3▾] ┐
├ PALETTE+OUTLINE │ CANVAS (Sơ đồ mặc định, mini-map, auto-layout) │ INSPECTOR  ┤
│ Command/Seq/...  │ start → M#12 START → ╔GATE╗ → …                │ Máy[combobox]│
│ s1 s2 s3 (cây)   │                                                │ Gate roles ✔ │
├ DOCK: [Vấn đề(2)] [Mô phỏng] [Tham số đầu vào] [Phiên bản] [AI trợ lý]     ┤
RUNS
│ [Workflow▾][Trạng thái▾][Khoảng thời gian▾][Chỉ LIVE☐]                     │
│ #42 line-a@v3 ● running DRY-RUN 10:02 00:41 Minh [Abort]                   │
│ #2 line-a@v1 ⟲ interrupted DEMO [Tiếp tục…][Huỷ]                           │
│ Drawer: sơ đồ tô theo step, timeline, routedTo/simulated/actionId, events  │
APPROVALS
│ run #45 gate "confirm-stop" cần supervisor · prompt · bối cảnh             │
│ [Duyệt (OTP)] [Từ chối+lý do]  ⓘ Bạn đã chạy run này → không được duyệt    │
```
- API: `saveDraft`; `publish` (đổi tên `deployWorkflow`, giữ alias), hash **không gồm `ui`**; `rollback` → deployProcedure + lý do; `duplicate` tạo **draft**; `delete` → `archiveWorkflow` (soft, audit, TX); `startRun` luôn async trả `runId`; `runs.list` cursor + lọc; `approvals.pending`.
- `abortRun`: AbortController trong registry run sống **và** `UPDATE … SET status='aborting' WHERE status IN (…)`; `sleep`/poll nhận `AbortSignal`; terminal chỉ ghi khi `status <> 'aborted'`.
- `resumeRun`: CAS `UPDATE … SET status='running' WHERE id=$1 AND status IN ('awaiting_confirm','held') RETURNING *` (0 hàng ⇒ CONFLICT) + kiểm `approverRoles`/`fourEyes`. Trạng thái mới `interrupted` thay `held`+cờ context. `orchestrationGov` + requirePermission + moduleGate.
- DB: workflows + `draft_json`, `published_version`, `archived_at/by`; FK versions/runs → workflows RESTRICT, run_steps/run_events → runs CASCADE (anti-join mồ côi = 0 trước); enum + `interrupted`, `aborting`; index `runs(status, createdAt DESC)`; runs + `mode`, `version`.
- Cờ `FOE_DRAFTS_V2`, `FOE_ASYNC_RUNS`, `FOE_GATE_ENFORCE_ROLES` (mặc định ON). Nghiệm thu K1–K5; đột biến (gỡ CAS, gỡ abort-signal) phải làm test đỏ.
- Rủi ro: đổi ngữ nghĩa `held` ảnh hưởng `rehydrate/autoResume` ⇒ giữ tuỳ chọn `sync` cho test.

### 6.2 Fleet → Labs
Làm ngay (S–M): chuyển Labs + badge; gating một nguồn; actor + audit mọi mutation; phạm vi nhà máy khi ghi; CAS allocate `UPDATE … WHERE status='pending' RETURNING`; `cancelTask` nhả reservation trong cùng TX; `listZones` một câu `GROUP BY`.
Đích khi có phần cứng (L):
```
┌ Fleet ▸ Live   Nhà máy[F1▾]  Nguồn VDA5050 ● 3/3 ─────────────────────────┐
│ BẢN ĐỒ (lớp 2D của Twin, pan-zoom, lớp ☑Zone ☑Đường ☑Robot ☐Heat)        │ ROBOTS│
│  ▭ZONE-A(2/2) ═══transit═══ ▭CHARGE   ● AMR-01 →→→   [Sửa: zone|điểm|cấm] │ AMR-01 Busy 72% │
│ MISSION QUEUE (kéo ưu tiên): ≡T-105 P1 [Allocate][Gán ▾picker][Huỷ…]      │ AMR-03 Offline │
│ Deadlock AMR-01⇄AMR-02 → [Xem & xử lý…] (nạn nhân đề xuất + lý do + OTP)   │
```
API `robots.search`, `resolveDeadlock{dryRun}`, hợp nhất nguồn robot với `vda5050Router`, socket `fleet:*` thay poll; DB FK tasks → robots, reservations → zones/tasks, index `(status, zoneId)`, `created_by/updated_by`. Dùng lại lớp 2D của Twin, không tạo nguồn hình học thứ hai.

### 6.3 Safety Monitor (advisory) + Workforce → Sản xuất
Kết cục: 100 % sự kiện có provenance đúng; test **không** tạo Andon; panel nguồn phản ánh trạng thái thật ≤5 s; near-miss có vòng ack → nguyên nhân → CAPA đo được thời gian đóng.
```
┌ An toàn ▸ Safety Monitor [ADVISORY] ───────────────────────────────────────┐
│ NGUỒN: Safety PLC ⚠ SIM (preflight dựa vào GIẢ LẬP) [Cấu hình]             │
│        Vision ○ tắt (0 camera) · Zone SW ○ tắt · E-stop ○ tắt · Socket ● 3s │
├ SỰ KIỆN (lọc loại/thời gian/robot/nguồn) │ CHI TIẾT #123 · Ack→Nguyên nhân→CAPA · audit ┤
├ Xu hướng 30 ngày · Công cụ thử CHỈ SANDBOX                                  ┤
┌ Sản xuất ▸ Ca & Nhân lực  Ca[Ca 1 06–14▾] Line[L1▾] ──────────────────────┐
│ ST-01 Nguyễn A (qualified) ✓ │ ROB-UR-01 │                                 │
│ ST-02 — trống — [Gán… picker tên] │ ⚠ thiếu chứng chỉ X                    │
```
API `safety.sourceHealth`; test proximity không Andon, `detectedBy:'test'`, `scope:'test'`; `safety.triage`; phạm vi nhà máy; board lọc theo ca; job đóng assignment hết hạn. DB `safety_events` + `provenance` (NOT NULL, check enum), `triage_status`, `root_cause`, `capa_ref`. Công: vá SAF-01/02 S · triage M · zones/calibration M–L · Workforce M.

### 6.4 Alarm Management & Standards
Kết cục: một nguồn KPI (/alarm-kpi, Control Tower, trang này cùng số, có test so khớp); tuân thủ tính trên binding máy thật ↔ kiểu; **shelve có hiệu lực thật** (không lên Andon khi shelve, tự hết hạn); mọi thay đổi MADB qua MOC có SoD.
```
┌ Alarm Management & Standards ──────────────────────────────────────────────┐
│ KPI ISA-18.2 (nguồn alarmKpi · 8h/24h/7d▾ · operator=3 từ ca)              │
│ Rate/op/10' 0.4✓ │ Flood 0✓ │ Stale 2⚠ │ Chattering 1⚠ │ Shelved 3 │ Bad actors▸ │
├ [Master Alarm DB][Bad actors][Shelving][Vendor mapping][Device types][CR] ┤
│ Key▲ │Ưu tiên│Hậu quả│TTR│Setpoint│Trạng thái│Nguồn│Sự kiện 7d                │
│ OVERTEMP High Major 10m 80°C Shelved→14h ur:… 12▲bad                       │
│  [Sửa→tạo CR] [Shelve…(lý do, ≤8h)] [Retire (MOC)]                          │
│ DEVICE TYPES: cây+tìm+"dùng bởi 76 máy"+diff phiên bản                      │
│ TUÂN THỦ: máy gắn kiểu 1320/1700 (78%) · [380 máy chưa gắn] · conformance DB 29/31 │
```
API: bỏ `equipmentStandards.alarmKpis`, dùng `alarmKpi.summary` (operatorCount từ server); `complianceMetrics` dùng `machines.device_type_key`; `proposeMasterAlarmChange`, `shelveAlarm{reason, until≤max}`, `retireMasterAlarm` (canDelete + SoD); `upsertAlarmMapping` + audit; **enforcement** trong `adapterAlarmBridge/alarmNormalizer` trước `raiseAndon`. DB master_alarms + `retired_at`, `shelve_reason`, `shelved_by`; `alarm_shelve_log` append-only; `machines.device_type_key` + index. Cờ `ALARM_SHELVE_ENFORCE` (shadow 1 tuần), `STANDARDS_DB_CONFORMANCE`. Rủi ro: shelve sai che báo động thật ⇒ shadow trước, giới hạn thời lượng, loại trừ critical. **Cần quyết định chủ dự án về 1 700 máy QATD** (dữ liệu thử tải) trước khi tính tuân thủ thật.

### 6.5 Integration → giải thể
Kết cục: chỉ còn 1 router ghi `machine_recipes`; 0 query nhận endpoint tuỳ ý từ client; link cũ redirect đúng đích. Recipe versions + Genealogy → /recipes; FOCAS/Euromap → /connectivity › Connector catalog; `euromapOpcuaSnapshot` → `connectivity.testEuromapConnection` (mutation, admin/deploy, endpoint trong allowlist, rate-limit, không Andon); Acquisition → AOI/Vision, chỉ poll khi `liveEnabled`. Công: vá INT-01/02 **S (làm ngay)** · di chuyển UI M.

### 6.6 Xuyên suốt
Gating một nguồn (mọi route dùng `navHref` + test AST; bảng `ACTION_PERMS` client/server dùng chung; seed canDelete theo quyết định chủ dự án) · `<ProvenanceBadge>` + banner "N/M hàng là demo" + bất biến "không hàng demo nào hiện mà không có badge" · `useUrlState('tab'|'filter')` + e2e cho mọi link PendingReviewStrip · `DataTable` + `EntityPicker` dùng chung (hiện tên thay `#id`) · phạm vi nhà máy cho mọi router · hiệu năng (gỡ `vendor-three` khỏi modulepreload, lazy xyflow, query theo tab, dừng poll khi chỉ còn run interrupted) · bỏ `?? true`.

### 6.7 Lộ trình

| Đợt | Nội dung | Công | Nghiệm thu |
|---|---|---|---|
| Đ0 (tuần 1) | ORC-01/02/03/04/05/06/11 · INT-01/02 · SAF-01 · FLT-02/03 | M | test đồng thời/abort/SSRF; 0 đột biến sống sót |
| Đ1 (tuần 2) | X-01 · SAF-02 · STD-01/04 · ẩn Shelve tới khi enforce · X-02 · X-07 | M | test gating tĩnh xanh; KPI khớp 3 nơi |
| Đ2 (tuần 2–3) | Labs · Workforce → Sản xuất · giải thể Integration · X-03 | S–M | 0 link chết |
| Đ3 (tuần 3–6) | Orchestration v2 | L | K1–K5 |
| Đ4 (tuần 5–8) | Alarm Management (MOC, enforcement, binding) | L | test shelve pipeline |
| Đ5 | Fleet thật | L | tiêu chí ra Labs |

## 7. Chưa kiểm được
Không gọi mutation (ORC-01/02/07, FLT-06 chứng minh bằng đọc mã; ORC-01 phiên chính tự kiểm lại mã) — cần viết test tái hiện **trước** khi vá; không thử khai thác SSRF; chưa đọc `foeSimulator`, thuật toán `resolveDeadlock`, `collaborationService`, `safetyPlcAdapter`, `aiOrchestrationAdvisor`; chưa so công thức KPI giữa `alarmKpiMath` và `computeAlarmKpis`; không load-test.
