# 70 · Lập trình và mô phỏng (engineering)

| | |
|---|---|
| Mục tiêu phục vụ | M3 lập trình & mô phỏng (trực tiếp); M5 (chương trình/recipe nạp xuống qua cửa lệnh); M1 (dữ liệu chủ recipe, mô hình 3D) |
| Phụ thuộc | 10 hierarchy, 20 asset (asset_class, tag.role, model 3D mặc định), 30 telemetry (giá trị sống cho giám sát lưu đồ/HIL), 40 alarm, **50 control (mọi nạp/ghi qua `control.command.request(kind=program|recipe)`)**, 60 (sản phẩm ↔ recipe), 90 (2FA/SoD, lưu trữ, twin xem) |
| Module phụ thuộc vào đây | 80 ai (Thợ Cả sinh/sửa chương trình, chấm ST, đề xuất luồng — đều qua API 70), 90 (twin xem đọc cảnh do twin‑studio tạo; MES đọc recipe) |
| Mốc đo | `_ai8_wt c1f82ea1b` (2026-11-03), DB `aoi_management@5434` read-only; doc 09 DPC D0–D7 (duyệt 2026-06-29, cờ tắt); K12–K14 (scada-master 2026-10-23, **chưa duyệt riêng**); OIP B1/B2 (do-model 2026-11-03) |
| Trạng thái | **v1.1 — ĐÃ DUYỆT 2026-11-03** (8 câu hỏi §7 duyệt theo khuyến nghị; nhận K12/K13; mig 0570–0589) |

## 0. Phạm vi của module

Module này sở hữu **vòng đời chương trình thiết bị** (dự án → artefact IEC 61131‑3 ST/LD/FBD/SFC‑lưu đồ/IR → kiểm → build → mô phỏng hành vi → duyệt → nạp qua cửa lệnh 50 → xác minh → rollback), **recipe/changeover** (recipe theo lớp máy, phiên bản, duyệt hai người, nạp, lịch sử), **mô phỏng** (nhà máy ảo, kịch bản, phát lại; nguồn điều khiển: lưu đồ/ST/PLC thật; simulator máy .NET đóng vai thiết bị ngoài), **điều phối luồng thiết bị** (FOE: luồng nhiều máy có cổng duyệt, chạy trung tâm hoặc edge) và **Twin Studio** (dựng xưởng, đặt vật thể, gắn model 3D, khuôn động học — phần *tạo*; phần *xem* ở 90).

Module này **không** sở hữu: ghi xuống thiết bị (50 — 70 chỉ tạo `command_request(kind=program|recipe)`), AI sinh mã/chat/agent (80 — 80 gọi API 70 để validate/build/simulate), luồng AI nghiệp vụ `ai_flow_*` (80), trạng thái line/đơn hàng (90 MES), xem twin thời gian thực (90), chấm điểm model AI (80 eval).

Bất biến: (1) **không có đường nào tới thiết bị ngoài `dispatch()`** (Zmotion FFI tắt — 50 Q4); (2) **sim‑gate là mô phỏng hành vi**, không phải "build ok"; (3) **mô phỏng không là hệ an toàn và không ghi KPI** (ràng buộc #5, #10); (4) nạp chương trình/recipe cần hai người (SoD) + 2FA theo mức 5; (5) mọi dữ liệu mô phỏng mang `origin=sim` ở tầng dữ liệu (site/asset của simulator thuộc site `origin=sim`), không nhận diện bằng chuỗi `SIM-LIVE`.

---

## 1. Hiện trạng đo được

### 1.1 Dữ liệu `[đo]`

| Bảng | Hàng | Ghi chú |
|---|---|---|
| `program_projects/artifacts/builds/sim_runs/deployments/symbols` | 4 / 8 / 3 / 3 / 3 / 0 | kind: ir‑flow 3, zmotion‑basic 2, iec61131‑st 2, stub 1; deployments **simulated 3/3**; **0 FK**, naive, `corporateCode` text, `deviceId` int trần (dùng như *adapter id* ở Mitsubishi) |
| `orchestration_workflows/_versions/_runs/_run_steps` | 5 / 5 / 8 / 19 | runs: completed 5, awaiting_confirm 2, failed 1; 0 FK, naive; `_run_edge_assignments` khai **ngoài drizzle** (`edgeExecutionSchema.ts`); `orchestration_runs` khai **hai lần** (`runApiKeyIdentity.ts`) |
| `ai_flow_*` (10 bảng) | **0** tất cả | tz + 15 FK (bảng khai tốt nhất miền này); thuộc 80 |
| `machine_recipes` / `recipe_deployments` / `changeover_requests` / `recipe_load_log` / `recipe_sets(+items)` | 5 / 3 / 0 / 0 / 0 | FK machines có; enum trạng thái recipe (draft/active/archived) **khác** vocabulary của `recipe_load_log` (draft/released/archived); `changeover_requests.status` varchar tự do |
| `simulation_runs` | **80 941 (73,7 MB)**, 100 % `mode=fidelity_check`, status done | do `twinFidelityService` tự sinh mỗi giờ/line; mẫu mới nhất: dự đoán 7 755 s vs thực 12 s ⇒ fidelity 0 % — một job vô nghĩa đang tăng vô hạn |
| `station_dwell_time` | 8 699 | mô phỏng/MES |
| `edge_deployments` | 0 | là **nạp model AI** lên edge (80), không phải chương trình |
| `twin_toa_nha/tang/dat_cho/vat_the/kich_thuoc_loai/ban_ghi` | 14 / 88 / 3 539 / 341 / 24 / 1 | tz, **0 FK**; `twin_kich_thuoc_loai` PK = pg enum machinetype (20 A2 bỏ); `equipment_3d_models` 5 (naive, `machineId` không FK) |
| `operation_program_map` / `program_variants` | 1 / 3 | nằm ở `fleetResource.ts`, chỉ fleet dùng (đóng băng) |
| Tổng miền | 46 bảng, **22 rỗng** | |

### 1.2 Backend `[đo]`

| Thành phần | Tệp / LOC | Ghi chú |
|---|---|---|
| Lập trình (DPC) | `services/programming/**` 42 tệp **16 626** LOC; `programmingRouter.ts` 1 205 (18Q/22M; 5 chết) | adapter: `iec61131Adapter` (ST/LD/POU — **`openplcDeployGuard` luôn failed**), `zmotionBasicAdapter` (FFI `koffi` **không có trong package.json**; nếu cài sẽ **né `dispatch()`**), `mitsubishiEngineeringAdapter` (**đường duy nhất qua `dispatch()`**: `recipe_param_push`; bug `machineId: adapterId`), `robotTmAdapter` (từ chối), `irAdapter` (luôn simulated; HIL URSim), `stub`; `gcode` không có adapter |
| Sim‑gate | `programmingService.ts:601` | yêu cầu `program_sim_runs.ok` mới nhất; **ST `simulate()` trả `ok = build.ok`** ("xem trước cấu trúc") ⇒ sim‑gate ST = "build ok"; mô phỏng thật chỉ ở IR (`kinematicSimGate` 593 + `rapierPhysics` 617) |
| Trình biên dịch ST | server: **RuSTy** (`flow/lib/bienDichST.ts`, chỉ compile); parser nội bộ `stParser.ts` 1 311; **MATIEC chỉ ở bộ chấm AI** (`scripts/ai-eval/ngau-nhien/lib/st-matiec`, Docker từ `avi-openplc-bench:v3`); OIP walker đã vendor (`vendor/oip-plc`, B1) chạy headless tất định, đồng thuận 95,7 % ngoài tập con | 3 cách "hiểu ST" không nối nhau |
| FOE | `orchestration/foe/**` ≈ 8,3k (`foeEngine` 4 488, không phải 12,5k); `orchestrationRouter` 697 (2 chết); `orchestrationGov` 78 **0 client** (+ `slaPolicy`, `dag` chết); QT runner 1 481 trên FOE | actuation qua `equipmentRegistry.sendCommand` → dispatcher (đúng); cổng duyệt lưu trong `ai_pending_actions`; `FOE_SIM_GATE_REQUIRED` = HMAC token từ `orchestration.simulate` (foeSimulator 710) |
| AI flow | `services/flow/**` 8 016; `flow` router 810 (0 chết) | engine kiểu n8n; nút OT **chỉ đề xuất** (`moPhong:true`), không bao giờ gọi dispatcher — thuộc 80 |
| Line FSM | `lineController/**` 2 548 | 7 trạng thái; `recipeSet.distribute` chỉ qua REST `/v1/lines/:id/recipe`; UI không gọi `status/transition/recipeSet.*` |
| Recipe | `machineRecipeRouter` 785 (2 chết), `recipeVersioningService` 351, `equipmentIntegration` 551 (phần recipe) | **không có đường thiết bị** (deploy = đổi phiên bản active + sổ); `select_recipe` thật chỉ từ tool AI và `gem300` |
| Mô phỏng | `simulation` 202 (DES 1 156; chỉ `ProductionScheduling` gọi), `monteCarloFlow` 102 **0 client**, `simTargets` 153 **0 client**, `services/simulation/monteCarlo.ts` chỉ test | rf‑test‑cell **không có router/service** (UI gọi `orchestration.simulate` ×2) |
| Simulator nhà máy (script) | `scripts/sim-factory/*`: topology 36 máy (3 line × 12), OPC UA 4840–4842, Modbus 5020, MTConnect 5001, HTTP 4899; `sim-live-daemon.mjs` 723 **INSERT thẳng DB** (`daily_statistics`, `fact_inspection_hourly`, `downtime_events`, `andon_events`), nhãn chỉ bằng text `SIM-LIVE-%` | vi phạm bất biến 5 |
| `simOtTelemetryService` | `SIM_OT_TELEMETRY_ENABLED` | bơm `ot_telemetry` qua ingest thật, nhãn chỉ `protocol='other'` |
| Simulator máy .NET | `tools/machine-simulator`: **664 .cs ≈ 215k LOC (121k là test)**, web Tauri+Vite 224 tệp ≈ 62k LOC; 4 theme riêng (glass/console/warmth/isa101); editor HMI riêng; `RecipeConfig` riêng | hợp đồng với app chính: REST `/api/v1/ingest/*`, `/api/machine/*`, MQTT 1883 — tức **là một thiết bị ngoài**; là *client* Modbus/OPC UA, không có server |
| OpenPLC bench | container `avi-openplc-bench` (Modbus 15502, web 18080); dùng bởi bench SCADA R0–R1b | không mã server nào nhắm tới |
| Twin Studio | `twinCanhRouter` 1 850 (14Q/16M, 12 client); `twin` 473 (7 chết), `twinGov` 55 **0 client**, `digitalTwin` 388 (3 chết); `pipeline/urdfToKinematicChain.ts` 168 | `KhuonDongHoc` **không tồn tại** trong mã (chỉ trong spec) |

**Bộ máy luồng: 5** (FOE, QT runner trên FOE, `rulesEngine` 189, AI flow, Line FSM) + 2 bộ mô phỏng (DES, foeSimulator) + 3 kho duyệt (`ai_pending_actions` cho gate FOE, `program_deployments.awaiting_approval`, `changeover_requests`).

Cờ (tên): `DPC_DEPLOY_ENABLED`, `DPC_STREAMING_ENABLED`, `DPC_ONLINE_FORCE_ENABLED`, `DPC_VERSION_REVIEW_ENABLED`, `DPC_DEPLOY_APPROVAL_ENABLED`, `DPC_HIL_ENABLED`, `DPC_IR_V2_ENABLED`, `ZMC_*`, `ZAUXDLL_PATH`, `URSIM_*`, `SIM_KINEMATIC_ENABLED`, `SIM_PHYSICS_ENABLED`, `SIM_OT_TELEMETRY_*`, `SIM_*` (script), `FOE_ENABLED`, `FOE_DURABLE`, `FOE_SIM_GATE_REQUIRED`, `FOE_SIM_TOKEN_SECRET`, `AI_ORCHESTRATION_ADVISOR_ENABLED`, `LINE_CONTROLLER_*`, `EQ_INTEG_ENABLED`, `RECIPE_TYPED_SCHEMA_MODE`, `EDGE_RUNTIME_ENABLED`.

### 1.3 Frontend `[đo]`

| Tệp | LOC | Route | Ghi chú |
|---|---|---|---|
| `EngineeringWorkspace.tsx` | 2 233 | `/engineering` | 24 procedure; CodeMirror + `LadderEditor` + `TeachJogPanel`; **deploy wizard #1** (`WizardDialog` + `DeployPreviewPanel` + OTP) |
| `IrEditor.tsx` | 1 818 | `/ir-editor` | **xyflow canvas #1** (`IrGraphCanvas` 447) + diff/merge |
| `PouStudio.tsx` | 890 | `/pou-studio` | **xyflow canvas #2** (`PouCanvas` 1 208 LAD/FBD/SFC); import PLCopen = Textarea |
| `OrchestrationStudio.tsx` | 3 141 | `/orchestration-studio` | **xyflow canvas #3**; **deploy #2** (sim‑gate + OTP); **106 lớp màu thô** |
| `AIFlows*` (3 trang) | 1 063 | `/ai-flows*` | **xyflow canvas #4**; thuộc 80 |
| `RecipeManagement.tsx` | 1 740 | `/recipes` | **deploy #3** (`DeployDrawer`); 15 màu thô |
| `EquipmentIntegration.tsx` | 1 164 | `/equipment-integration` | **nhân đôi tab recipe** của RecipeManagement (cố ý, vì "licence") |
| `ProductChangeoverWizard` + `ChangeoverQueue` | 994 | `/product-changeover` | không kiểm quyền client |
| `RfTestCellSim.tsx` | 788 | `/rf-test-cell` (không nav) | **82 màu thô**; gọi `orchestration.simulate` ×2 (bình luận App.tsx nói "0 lời gọi" — sai) |
| `EngineeringHub.tsx` | 618 | `/engineering-home` | ô liên kết tới URL cũ (`/factory-floor-editor`, `/cell-twin`) qua redirect |
| `TwinStudio.tsx` + `XuongThietKe` + `DungNhaXuong` + `NhapBanVe` | ≈ 3 000 | `/twin-studio` | R3F; đúng QĐ‑18 (tách `/twin`) |
| `CorporateLayout.tsx` | 1 292 | `/corporate-layout` (không nav) | báo cáo: gỡ |
| `Layout.tsx` + `WorkshopLayoutEditor` | 1 742 | `/layout/:id` | trùng Twin Studio; 35 màu thô |
| `EdgeNodesPage.tsx` | 289 | `/edge-nodes` | → 20 `edge_node` |
| `CodeEditor.tsx` | 364 | dùng chung ×5 | **một** CodeMirror 6 + ghost‑text copilot — tốt |
| Simulator web | `tools/machine-simulator/web` 62k | | editor HMI riêng (`EditorCanvas` 956 — canvas #5), `PublishPanel` (deploy #4), 4 theme |

Đếm: trình soạn mã 1 (tốt); **canvas đồ thị 4 (+1 simulator) không dùng chung**; **luồng deploy 3 (+1)**; không có panel kết quả MATIEC/mô phỏng hành vi; không có trang mô phỏng (chỉ rf‑test‑cell).

### 1.4 Kết luận hiện trạng

1. **Khung DPC D0–D7 đã đủ xương** (adapter, build, sim‑run, deploy, SoD, review) nhưng **không có đích nạp thật nào hoạt động**: OpenPLC guard luôn failed, Zmotion cần dll + né cổng, robot từ chối, IR luôn simulated; đường duy nhất qua dispatcher là push tham số MELSEC và có bug id.
2. **Sim‑gate không mô phỏng**: với ST là "build ok". Trong khi hệ đã có ba cách chạy/chấm ST (RuSTy, MATIEC Docker, OIP walker tất định) không nối vào sản phẩm.
3. **Năm bộ máy luồng, ba kho duyệt, ba luồng deploy UI** cho cùng khái niệm "chạy một quy trình có duyệt".
4. **Mô phỏng vi phạm bất biến dữ liệu**: `sim-live-daemon` ghi thẳng bảng KPI; `simulation_runs` 80 941 hàng vô nghĩa; không có `origin=sim` ở tầng dữ liệu.
5. **K12–K14 của scada-master là thiết kế đúng hướng nhưng chưa duyệt**; module này **nhận K12 (lưu đồ = SFC mở rộng) và K13 (nhà máy ảo tách twin, engine chung Node/trình duyệt)**, hoãn K14 (thư viện gói thiết bị) sau 20‑A2.

---

## 2. Mục tiêu: mô hình dữ liệu

### 2.1 Quyết định thiết kế `[QĐ 2026-11-03]`

1. **Một mô hình chương trình** `program_*` giữ (đã đúng), thêm FK `site_id`, `asset_id` (thay `deviceId` int), timestamptz; `kind` giữ `iec61131-st|ld|pou`, `ir-flow`, `mitsubishi-engineering`, `zmotion-basic` (đóng băng tới khi có đường qua 50), `robot-tm` (đóng băng cùng robot); **gỡ `gcode`, `stub`** (stub chỉ test).
2. **Lưu đồ = SFC mở rộng của `pouModel`** (K12 QĐ1): `SfcAction`/`Condition`/`SignalRef` có kiểu, `FlowChart` là một `program_artifact(kind=iec61131-pou, lang=sfc)`; IR robot giữ cho robot (đóng băng). **Không mô hình thứ ba.**
3. **Gán tín hiệu một chỗ**: `program_symbol` → FK `tag_id` (20) thay địa chỉ text; build điền `ProgramSource.symbols`; lưu đồ chỉ biết tên hình thức.
4. **Sim‑gate = mô phỏng hành vi**: `program_sim_run` ghi `{engine: 'oip-walker'|'matiec'|'kinematic'|'hil', scenario_id, trace_ref, ok, kpi}`; ST/SFC chạy **OIP walker** (vendor, tất định, worker_threads) trên kịch bản I/O; MATIEC là oracle tuỳ chọn (Docker, bench); IR giữ kinematic/Rapier. "Build ok" không còn được tính là sim.
5. **Nhà máy ảo (K13)** tách twin: `sim_scene`, `sim_scene_item`, `sim_run` (như K13 §3.2, `package_version_id` tạm = `asset_class_id` + model mặc định tới khi K14); engine TS thuần trong `shared/sim/` chạy worker; ba nguồn điều khiển: lưu đồ / ST (OIP walker) / PLC thật qua **Modbus TCP server** của cảnh (`SIM_DEVICE_SERVER_ENABLED`, bind 127.0.0.1).
6. **Bộ máy luồng: 5 → 2**: **FOE** (luồng thiết bị/line, cổng duyệt, chạy trung tâm/edge; actuation qua 50) và **AI flow** (80, không chạm OT). `rulesEngine` → 40 `notification_rule`; QT runner = mẫu FOE; **Line FSM → 90 MES** (trạng thái line/đơn hàng; `recipe_set.distribute` gọi 70 `recipe.deploy`). Một kho duyệt: `command_request` (50) cho mọi bước chạm thiết bị; `program_deployment`/`changeover_request` giữ trạng thái riêng nhưng tham chiếu `request_id`.
7. **Recipe một mô hình**: `recipe` (= `machine_recipes` + phiên bản của `recipeVersioningService`: `asset_class_id`, `asset_id` null = mặc định lớp, `product_id` null = mọi sản phẩm, `version`, `payload jsonb` theo Zod `recipeSchemas` của lớp, trạng thái `draft|approved|active|archived` — **một** vocabulary), `recipe_deployment` (FK `command_id` 50 khi có đường thiết bị; nếu lớp không có đường thì `ledger_only=true` hiển thị rõ), `changeover_request` (enum, SoD DEP‑08), `recipe_set/_item` giữ (tz, FK). `recipe_load_log` gộp vào `recipe_deployment`. Cấu hình **tại máy là chuẩn** (3 lớp baseline ⊕ máy ⊕ máy×sản phẩm, 2026‑07‑24) ⇒ `recipe.payload` là baseline; máy báo lại `effective` qua `asset_config_state` (20).
8. **Mô phỏng là thiết bị ngoài có `origin=sim`**: simulator .NET và `sim-factory` đăng ký như asset trong site `origin=sim` (10 §2), gửi qua **cùng ingest** 30/60 bằng api key; **`sim-live-daemon` INSERT thẳng DB gỡ**; `simOtTelemetryService` gỡ (sim‑factory thay); `simulation_runs` fidelity **job dừng, 80 941 hàng xoá**; fidelity thành KPI tính theo yêu cầu ở twin (90). `[QĐ 2026-11-03]`
9. **DES/Monte Carlo**: `simulation` (DES) → 90 production (lập lịch); `monteCarloFlow`, `simTargets`, `services/simulation/monteCarlo.ts` gỡ.
10. **Twin Studio**: bảng `twin_*` giữ (tz), thêm FK `site_id`/`asset_id` (`twin_vat_the.asset_id` null = vật tĩnh), `twin_kich_thuoc_loai` → `asset_class.dims_mm` (20 A2), `equipment_3d_models` → `asset_class.model_3d_default` + `asset.model_3d_override` (20); khuôn động học = `asset_model_kinematics` (từ URDF pipeline; `KhuonDongHoc` của spec v3 §4 là tên UI). QĐ‑18/19/21 giữ.
11. **Gỡ**: `orchestrationGov` + `slaPolicy` + `dag`, `twinGov` + `driftDetector`, `twin.*` chết (7), `digitalTwin` chết (3), `programming` chết (5), `machineRecipe.get/getActive`, `operation_program_map`/`program_variants` (đóng băng cùng fleet), `edge_deployments` → 80.

### 2.2 Đặc tả bảng (cột lõi)

| Bảng | Cột chính | Ghi chú |
|---|---|---|
| `program_project` | id, site_id FK, asset_id FK, asset_class_id FK (null = dự án theo máy), code, name, kind, status, created_by, timestamps tz, deleted_at | unique (site_id, code) |
| `program_artifact` | id, project_id FK, version int, lang `st|ld|fbd|sfc|ir|plcopen`, source text/jsonb, checksum, status `draft|validated|released|archived`, review_status, reviewed_by/at, created_by | SoD review |
| `program_build` | id, artifact_id FK, status, output_ref, checksum, log jsonb, built_at | |
| `program_sim_run` | id, build_id FK, engine, scenario_id FK sim_scenario, ok, kpi jsonb, trace_ref, duration_ms, ran_by, ran_at | **ok chỉ khi chạy hành vi** |
| `program_deployment` | id, build_id FK, asset_id FK, stage, status `pending|awaiting_approval|simulated|deployed|verified|failed|rolled_back|rejected`, request_id FK command_request (50), command_id FK, confirmed_by, approved_by, verify jsonb, idempotency_key unique, timestamps | mọi `deployed` phải có `command_id` trừ `simulated` |
| `program_symbol` | id, project_id FK, name, tag_id FK tag (20), direction `in|out|mem`, iec_type | thay địa chỉ text |
| `sim_scenario` | id, site_id, name, kind `io_trace|fault|throughput`, spec jsonb, seed | dùng cho sim‑gate và nhà máy ảo |
| `sim_scene` / `sim_scene_item` / `sim_run` | theo K13 §3.2 (+ `site_id`, `origin='sim'`) | |
| `recipe` / `recipe_deployment` / `changeover_request` / `recipe_set` / `recipe_set_item` | §2.1‑7 | |
| `twin_*` + `asset_model_kinematics` | §2.1‑10 | |

Kiểu dùng chung `shared/engineering/types.ts`: `ProgramKind`, `ArtifactLang`, `SimEngine`, `SfcAction`, `Condition`, `SignalRef`, `FlowChart` (K12 §2.3), `RecipeStatus`.

### 2.3 Bảng gỡ / chuyển

`simulation_runs` (xoá dữ liệu, gỡ), `station_dwell_time` (→ 90 MES), `edge_deployments` (→ 80), `operation_program_map`/`program_variants` (đóng băng fleet), `recipe_load_log` (→ `recipe_deployment`), `equipment_3d_models`/`twin_kich_thuoc_loai` (→ 20), `orchestration_run_events` (→ `alarm_journal`/observability 90), `orchestration_run_edge_assignments` (vào drizzle), `line_states/_transitions` (→ 90), `ai_flow_*` (→ 80).

---

## 3. Mục tiêu: backend

### 3.1 Cấu trúc `server/modules/engineering/`

| Tệp | Vai trò |
|---|---|
| `program/` | = `services/programming/**` di chuyển; `adapters/{iec61131,ir,mitsubishi,zmotion(frozen),robotTm(frozen)}`; `flowchart/` (SFC mở rộng: Zod, `pouToSt` lowering S/R/P/L/D, PLCopen TC6 nhập/xuất sửa lỗi `readTypeName`); `deploy.ts`: `deployBuild` → **`control.command.request(kind=program)`** (50) → dispatcher gọi `adapter.deploy()` trong cổng; OpenPLC adapter nạp thật qua REST runtime mở (bench/K13), không bao giờ PLC thương mại (doc 09 D5) |
| `sim/` | `shared/sim/engine` (TS thuần: bước 10 ms, kinematic‑first, Rapier cho sản phẩm, seed); `runners/{oipWalker,matiec,kinematic,hil}`; `simGate.ts`: `ok` chỉ từ runner hành vi; `deviceServer.ts` Modbus TCP server của cảnh (cờ, 127.0.0.1) |
| `foe/` | = `orchestration/foe/**` di chuyển; gate duyệt → `command_request`; `orchestration_run_edge_assignments` vào drizzle; `runApiKeyIdentity` bỏ khai trùng |
| `recipe/` | một service: CRUD phiên bản theo lớp/máy/sản phẩm, duyệt SoD, `deploy` → `control.command.request(kind=recipe)` khi lớp có `recipe_download` (CommandDescriptor 20 §2.2), ngược lại `ledger_only`; changeover queue |
| `twinStudio/` | = `twinCanhRouter` + `twin` phần tạo + `pipeline/urdf*` |
| `router.ts` | `program.*`, `sim.*`, `foe.*`, `recipe.*`, `twinStudio.*` |

### 3.2 Procedure (tóm tắt)

| Namespace | Procedure chính | Loại |
|---|---|---|
| `program.project.*` | list/get/create/update/archive | permission(`engineering_edit`) |
| `program.artifact.*` | create/update/validate/lint/transpilePreview/review/requestReview/plcopenImport/plcopenExport | `engineering_edit`; review ≠ author |
| `program.build.*` | build/get/log | |
| `program.sim.*` | run (engine, scenario), list, trace | sim‑gate |
| `program.deploy.*` | `preview` (dự đoán real/simulated, cổng sẽ qua), `request` (→ 50 `command_request`), `approve/reject` (SoD; bọc 50 confirm với TOTP mức 5), `rollback`, `verify`, `fleet` (canary) | `deployProcedure` giữ |
| `program.watch.*` | start/stop (DPC streaming, đọc‑chỉ) | |
| `program.symbol.*` | upsert (tag_id), delete, checkWiring | |
| `sim.scenario.*`, `sim.scene.*`, `sim.run.*` | CRUD; `run.start/step/pause/replay`; `scene.copyFromLine` | `engineering_edit` + admin; nhãn MÔ PHỎNG do server gắn |
| `foe.workflow.*`, `foe.run.*` | = `orchestration.*` (gỡ 2 chết); `simulate` trả token HMAC như cũ | actuation |
| `recipe.*` | list/get/create/update/approve/activate/archive, `deploy` (→ 50), `history`, `changeover.request/approve/reject`, `set.*` | `recipe_manage`; approve SoD |
| `twinStudio.*` | = `twinCanh.*` (+ `kinematics.fromUrdf`, `model.assign`) | `settings_factory` |

Quyền: `engineering_view`, `engineering_edit`, `engineering_deploy` (= actuation + mức 5), `recipe_manage`, `settings_factory` (twin studio). AI (80) gọi `program.artifact.validate/lint`, `program.sim.run` bằng actor `ai`; không gọi `deploy.*`.

### 3.3 Cờ

Giữ: `DPC_DEPLOY_ENABLED` (→ gộp vào `OT_CONTROL_ENABLED` + commissioning của 50, cờ riêng gỡ sau C5), `DPC_STREAMING_ENABLED`, `DPC_HIL_ENABLED`, `FOE_ENABLED`, `FOE_DURABLE`, `SIM_DEVICE_SERVER_ENABLED` (mới, tắt), `SIM_PHYSICS_ENABLED`. Luôn bật (gỡ cờ): version review, deploy approval, sim‑gate. Gỡ: `DPC_ONLINE_FORCE_ENABLED` (không có use case; ghi tag qua 50), `DPC_IR_V2_ENABLED`, `ZMC_*`/`ZAUXDLL_PATH` (đóng băng), `URSIM_*` (đóng băng robot), `SIM_OT_TELEMETRY_*`, `SIM_KINEMATIC_ENABLED` (luôn), `FOE_SIM_GATE_REQUIRED` (luôn), `AI_ORCHESTRATION_ADVISOR_ENABLED` (80), `LINE_CONTROLLER_*` (90), `EQ_INTEG_ENABLED` (recipe luôn có), `RECIPE_TYPED_SCHEMA_MODE` (luôn typed).

---

## 4. Mục tiêu: frontend (vùng 5 Kỹ thuật)

| Màn | Route | Nội dung | Thay |
|---|---|---|---|
| **Studio** | `/ky-thuat/studio` (`?project=&file=`) | **Một IDE**: cây dự án (dự án → artefact), tab tệp theo `lang`: ST/LD (CodeMirror), FBD/SFC‑lưu đồ/IR (**một `GraphCanvas` xyflow dùng chung** với bộ nút theo lang), luồng FOE (cùng canvas, bộ nút "bước thiết bị"); panel dưới: Lint · Build · **Mô phỏng** (chạy kịch bản, vết bước, biểu đồ tín hiệu, nút chạy OIP/MATIEC) · Nạp (preview → `CommandConfirmDialog` 50) · Watch (DPC streaming); ngăn phải: Thợ Cả (80, ghost‑text + chat theo ngữ cảnh tệp) | `EngineeringWorkspace`, `IrEditor`, `PouStudio`, `OrchestrationStudio`, `EngineeringHub` (→ Home theo vai), `AIFlow*` (→ 80 `/tho-ca/luong`) |
| **Mô phỏng** | `/ky-thuat/mo-phong` (`/:sceneId`) | nhà máy ảo K13: cảnh (sao chép từ line thật / mẫu), đặt vật, bus I/O ảo (bảng tín hiệu ↔ cổng), chọn nguồn điều khiển (lưu đồ / ST / PLC thật qua Modbus server), chạy/tạm dừng/tua/phát lại, giả lập lỗi, KPI; **nhãn MÔ PHỎNG nhiều lớp** (spec v3 §7); kịch bản rf‑test‑cell là một `sim_scenario` | `RfTestCellSim`, `simTargets`, `monteCarlo` |
| **Recipe & Changeover** | `/ky-thuat/recipe` (tab: Recipe theo lớp/máy · Hàng đợi đổi model · Lịch sử nạp · Bộ recipe theo line) | một `DeployDrawer` dùng `CommandConfirmDialog`; cấu hình hiệu lực tại máy hiện cạnh baseline (provenance) | `RecipeManagement`, `EquipmentIntegration` tab recipe, `ProductChangeoverWizard` + `ChangeoverQueue`, simulator `RecipeConfig*` (đọc từ server) |
| **Interlock & An toàn** | `/ky-thuat/an-toan` | 50 | |
| **Twin Studio** | `/twin-studio` (tab: Dựng xưởng · Nhập bản vẽ · Thiết kế · Khuôn động học · Bản ghi) | giữ (QĐ‑18/19/21); `Layout/:id`, `CorporateLayout` gỡ (chức năng vào tab Dựng xưởng) | `Layout`, `WorkshopLayoutEditor`, `CorporateLayout` |
| `EdgeNodesPage` | → `/ket-noi?tab=edge` (30/20) | | |

Component dùng chung: `components/engineering/{CodeEditor (giữ), GraphCanvas (một kit: node/edge/inspector/minimap; bộ nút IR/POU/SFC/FOE), SimPanel, SignalChart, DeployPreview, ProjectTree, SimLabel}`; deploy chỉ qua `CommandConfirmDialog` (50). Màu thô trong `components/engineering/` và `pages/ky-thuat/` = 0 (OrchestrationStudio 106 + RfTestCell 82 + Layout 35 → 0). Theme Kỹ thuật tối (báo cáo §Theme) sau pha 1 SCADA. i18n namespace `kyThuat.*`.

Simulator .NET web (Q9 báo cáo): đọc cùng CSS variables/token ISA‑101 (bỏ glass/console/warmth), giữ bố cục HMI máy; editor HMI của nó giữ (là HMI *tại máy*), `RecipeConfig` đọc từ `recipe.*` server khi có mạng.

---

## 5. Di trú từ hiện trạng

Dải migration: **0570–0589** `[QĐ 2026-11-03: duyệt]`. Phụ thuộc: 20‑A2/A3 (asset_class, tag, model 3D), 40‑AL3, **50‑C2** (`command_request`), 60 (product). Thứ tự ưu tiên theo giá trị: E0 → E1 (Studio + lưu đồ + sim‑gate thật) → E3 (recipe) → E2 (nhà máy ảo) → E4 (twin studio) → E5.

| Bước | Việc | Nghiệm thu |
|---|---|---|
| **E0** | Vệ sinh: dừng job fidelity + xoá `simulation_runs` (Q5); gỡ `sim-live-daemon` INSERT thẳng + `simOtTelemetryService`; gỡ 4 router chết + procedure chết; `koffi`/Zmotion đóng băng (50 Q4); sửa bug `machineId: adapterId` MELSEC; `orchestration_run_edge_assignments` vào drizzle; `RfTestCell` → kịch bản | N1, N9; bảng 46 → 40 |
| **E1** | FK/tz `program_*`, `program_symbol.tag_id`; lưu đồ SFC mở rộng (Zod preprocess tương thích, `pouToSt` S/R/P/L/D, PLCopen sửa `readTypeName`); runner OIP walker + sim‑gate hành vi; `deploy.request` → 50 `command_request(kind=program)`; OpenPLC adapter nạp thật (runtime mở); Studio một IDE + `GraphCanvas` | N2–N5, N10 |
| **E2** | `sim_scenario/scene/item/run`; engine `shared/sim`; Modbus server cảnh (cờ); màn `/ky-thuat/mo-phong`; "sao chép line thật"; phát lại | N6, N7 |
| **E3** | `recipe` một mô hình (gộp versioning + load_log; enum thống nhất); `deploy` → 50; màn `/ky-thuat/recipe`; gỡ EquipmentIntegration tab recipe + simulator RecipeConfig ghi | N8 |
| **E4** | Twin Studio: FK, `asset_model_kinematics`, model 3D → 20; gỡ `Layout/CorporateLayout`; `twin/twinGov/digitalTwin` chết | N11 |
| **E5** | Di chuyển mã → `modules/engineering/*`; Line FSM → 90; `ai_flow_*`/AIFlow pages → 80; gỡ 12 cờ; simulator .NET + sim‑factory đăng ký asset `origin=sim` qua api key | census; N12 |

---

## 6. Tiêu chí nghiệm thu module

| # | Tiêu chí | Đo bằng |
|---|---|---|
| N1 | **Không tiến trình mô phỏng SỐNG nào INSERT thẳng DB** (daemon/service/scheduler): `sim-live-daemon`, `simOtTelemetryService` không còn; dữ liệu sống của simulator đi qua ingest 30/60. **Miễn trừ có tên**: seeder dev chạy tay `scripts/sim-factory/seed.mjs`, `seed-production.mjs` (`npm run sim:factory`/`sim:production`) — nguyên tắc "seed sai thì xoá & seed lại"; seeder chỉ ghi vào site `origin=sim` (10) và không được chạy theo lịch/khi boot. Đo: grep `INSERT INTO\|db.insert(` trong `scripts/sim*` ∖ {2 seeder} = 0; census chặn `setInterval`/cron gọi seeder | grep + census |
| N2 | Mọi `program_deployment.status=deployed|verified` có `command_id` (50); đột biến "bỏ qua request" ⇒ đỏ | SQL + vitest |
| N3 | Sim‑gate: artefact ST build ok nhưng chưa có `program_sim_run(engine∈hành vi, ok)` ⇒ `deploy.request` từ chối `SIM_GATE` | vitest |
| N4 | Cùng kịch bản I/O: bộ thông dịch lưu đồ và ST sinh ra (OIP walker) cho **cùng vết bước** (K12 §2.6a) trên 30 mẫu + 30 đột biến | test so sánh |
| N5 | PLCopen TC6: nhập tệp CODESYS có biến FB (TON/CTU) ⇒ hợp lệ; xuất → nhập lại đồng nhất | vitest fixture |
| N6 | Nhà máy ảo: 10 ms/bước, seed cố định ⇒ 2 lần chạy cùng vết; trễ vòng ≤ 50 ms (K13 §3.7) | đo |
| N7 | Nhãn MÔ PHỎNG không bỏ sót (đột biến "bỏ nhãn" ⇒ đỏ); `sim.run` từ site `origin≠sim` ⇒ từ chối | Playwright + vitest |
| N8 | Recipe: một enum trạng thái; `approve` ≠ author; `deploy` lớp có đường thiết bị ⇒ `command_id`; lớp không có ⇒ UI ghi "chỉ sổ" | vitest + Playwright |
| N9 | Router/procedure chết = 0; `simulation_runs` không còn | census + SQL |
| N10 | Canvas đồ thị 4 → 1 kit; luồng deploy 3 → 1 (`CommandConfirmDialog`); màu thô `components/engineering/`, `pages/ky-thuat/` = 0 | grep |
| N11 | `twin_vat_the` có `asset_id` FK; `KhuonDongHoc` UI đọc `asset_model_kinematics`; `/twin` (90) không có mutation | grep + SQL |
| N12 | Simulator .NET gửi vào site `origin=sim`; 0 hàng `origin=real` có `serial like 'SIM-%'` sau 7 ngày | SQL |

---

## 7. Câu hỏi mở — đã trả lời `[QĐ 2026-11-03]`

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| 1 | K12/K13/K14 | **Nhận K12 (lưu đồ = SFC mở rộng) và K13 (nhà máy ảo tách twin, engine chung) làm thiết kế 70; K14 hoãn** sau 20‑A2 + SCADA pha 1 | §2.1‑2/5; báo scada-master: K12/K13 duyệt qua TechDocs 70, K12–K14 §7 (7 quyết định) có hiệu lực trừ dải mig 0450–0469 → dùng 0570–0589; Q7/Q8 của K12–K14 vẫn chờ chủ dự án khi tới E2 |
| 2 | Sim‑gate hành vi | **OIP walker trong sản phẩm; MATIEC là oracle bench** | §2.1‑4; lệch ngữ nghĩa OIP ghi vào lint |
| 3 | Bộ máy luồng | **5 → 2** (FOE + AI flow ở 80); rulesEngine → 40; Line FSM → 90; QT = mẫu FOE | §2.1‑6; E5 |
| 4 | Đích nạp | **OpenPLC runtime mở qua 50**; Zmotion/robot‑tm đóng băng; MELSEC push tham số (sửa bug id) | E0, E1 |
| 5 | `simulation_runs` | **Dừng job fidelity, xoá 80 941 hàng**; fidelity = KPI theo yêu cầu ở twin (90) | E0; báo trước khi xoá |
| 6 | Simulator = thiết bị ngoài `origin=sim` | **Đồng ý**; gỡ `sim-live-daemon` + `simOtTelemetryService` | E0, E5 |
| 7 | Recipe một mô hình | **Đồng ý**; gỡ tab recipe `EquipmentIntegration` | E3 |
| 8 | Dải migration 0570–0589 | **Đồng ý** | §5 |

---

## 8. Nhật ký

| Ngày | Phiên | Việc | Số đo |
|---|---|---|---|
| 2026-11-03 | chủ dự án + chu-du-an-HST | **Duyệt v1.1**: 8 câu hỏi §7 theo khuyến nghị (K12/K13 nhận, K14 hoãn; OIP walker; 5→2 luồng; OpenPLC đích nạp; xoá simulation_runs; simulator origin=sim; recipe một mô hình; mig 0570–0589) | — |
| 2026-11-03 | chu-du-an-HST | Viết v1 từ kiểm kê read-only `_ai8_wt c1f82ea1b` + DB live; nhận K12/K13 của scada-master, doc 09 D0–D7, OIP B1/B2 | DPC 16,6k LOC nhưng 0 đích nạp thật; sim‑gate ST = build ok; 5 bộ máy luồng/3 kho duyệt/3 deploy UI; 4 canvas xyflow; `simulation_runs` 80 941 hàng fidelity 0 %; sim‑live‑daemon INSERT thẳng DB; 46 bảng (22 rỗng) |
| 2026-11-04 | dieu-phoi + chu-du-an-HST | E0‑2 xong (tho-ca-agent): gỡ `sim-live-daemon.mjs`, `simOtTelemetryService`, cờ `SIM_OT_TELEMETRY_*`; **N1 sửa**: miễn trừ 2 seeder dev chạy tay (`seed.mjs`, `seed-production.mjs`), cấm tiến trình sim sống INSERT thẳng | — |
