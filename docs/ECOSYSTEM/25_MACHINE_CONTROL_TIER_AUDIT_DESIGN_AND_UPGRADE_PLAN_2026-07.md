  # 25 — Tầng Điều khiển & Nâng cao: Audit chi tiết, Bản thiết kế hoàn thiện & Kế hoạch nâng cấp

> **Trạng thái:** ĐÃ PHÊ DUYỆT & THỰC THI TOÀN BỘ 6 WAVE (2026-07-04). Xem §7 Tổng kết thực thi.
> **Ngày:** 2026-07-03 (audit/thiết kế) · 2026-07-04 (thực thi)
> **Phạm vi:** Nhóm menu **"Kỹ thuật & Điều khiển (Nâng cao)"** (`navigation.tsx` group `engineering`) — 13 chức năng + 2 audit xuyên suốt (UX/IA toàn nhóm, kiến trúc backend đường lệnh).
> **Phương pháp:** 15 AI-agent audit song song, mỗi agent đọc trọn trang + truy vết backend (router → service → adapter → DB) + đối chiếu chuẩn world-class. Mọi điểm yếu đều kèm `file:line` đã xác minh. Không tìm thấy P0, nhưng **64 P1 + 89 P2** (tổng 153 phát hiện).

---

## 0. TL;DR cho người phê duyệt

Tầng "Điều khiển & Nâng cao" **KHÔNG phải mockup** — backend đã đấu nối thật xuống Postgres, có engine thuần (simulator/linter/transpiler) được unit-test, có gate an toàn được thiết kế nghiêm túc (sim-gate, HITL, commissioning FAT, dispatcher một-điểm). Đây là nền móng tốt và trung thực (banner "đang mô phỏng" ở khắp nơi).

Nhưng so với **các hệ tốt nhất thế giới** (Siemens TIA Portal, CODESYS, Rockwell Studio 5000, Inductive Ignition, MiR/OTTO Fleet Manager, ISA-88/ISA-18.2, VDA5050) thì cả tầng đang ở mức **~4/10**: "thật nhưng nông, và chưa chứng minh trên phần cứng". Ba nhóm vấn đề lớn:

1. **Chưa chạy được đầu-cuối trên thiết bị.** `OT_GATEWAY_ENABLED` bị comment nên không adapter OT nào khởi động → mọi lệnh ghi thật rơi vào `ADAPTER_OFFLINE`. Interlock **không** nằm inline bắt buộc trên đường lệnh (chỉ là poller async, mặc định tắt). FOE (orchestration) tổng hợp HITL trigger giả nên bị dispatcher OT từ chối — test chỉ pass nhờ mock.
2. **Thiếu các "table-stakes" của công cụ công nghiệp.** Không node-graph canvas thật (orchestration vẫn là cây bước; ir-editor "connect" chỉ reorder). Không undo/redo, không online-monitoring/watch-force, không version diff/rollback UI, không live-trace, không realtime (SSE) trên hầu hết cockpit.
3. **Khiếm khuyết lặp lại toàn tầng.** Thiếu transaction/row-lock ở các bước promote trạng thái (recipe active, zone/resource, equipment-integration release). Thiếu audit-trail bất biến (interlock, equipment-standards, safety). Gating "chỉ xem" trang trí chứ không cưỡng chế (đặc biệt `factory-floor-editor` **không có kiểm quyền ở server** — lỗ hổng thật). i18n thủng (fleet English-only, ir-editor thiếu key). IA: 13 mục một section phẳng, gần như không cross-link → luồng "soạn → mô phỏng → deploy → giám sát" bị đứt.

**Đề xuất:** một chương trình nâng cấp **6 wave** đưa tầng từ ~4/10 lên ~8/10 (world-class thực dụng cho môi trường 1 site, emulator-first rồi HW-ready), ưu tiên **an toàn đường lệnh (Wave 1)** trước, rồi độ sâu công cụ và khép kín luồng.

---

## 1. Scorecard tổng hợp

| # | Chức năng | Route | Maturity /10 | P1 | P2 | Bản chất hiện tại |
|---|-----------|-------|:---:|:--:|:--:|---|
| 1 | Cell Twin Player | `/cell-twin` | **3.0** | 4 | 8 | Replay dự đoán SVG-2D, KHÔNG phải twin 3D/physics như kỳ vọng |
| 2 | RF Test Cell | `/rf-test-cell` | **3.5** | 4 | 7 | Twin playback mô phỏng; thiếu trace đo RF & control thật |
| 3 | Factory Floor Editor | `/factory-floor-editor` | **3.5** | 4 | 5 | Editor 2D lưu toạ độ thật; **server không kiểm quyền ghi** |
| 4 | Recipe Management | `/recipes` | **4.0** | 5 | 5 | Catalog + ledger thật; thiếu approval/diff, race không TX |
| 5 | Engineering Workspace | `/engineering` | **4.0** | 3 | 6 | IDE-shell thật; thiếu online-monitor/diff/rollback UI |
| 6 | POU Studio (IEC 61131) | `/pou-studio` | **4.0** | 3 | 7 | Canvas node-level + transpile; dead-end khỏi pipeline |
| 7 | Safety & Workforce | `/safety-workforce` | **4.0** | 2 | 7 | Cockpit advisory thật; thiếu permit/muster/skill-matrix |
| 8 | Fleet Orchestration | `/fleet-orchestration` | **4.0** | 5 | 3 | Cockpit đọc-chính; toast "thành công" giả, không bản đồ live |
| 9 | Orchestration Studio | `/orchestration-studio` | **4.5** | 6 | 10 | FOE wired + AI advisor; lỗi resume, không live-trace/versioning |
| 10 | Interlock Rules | `/interlock-rules` | **4.5** | 3 | 9 | Engine đọc dữ liệu thật; thiếu priority/conflict/audit |
| 11 | Equipment Standards | `/equipment-standards` | **4.5** | 5 | 4 | Governance thật; publish rỗng phá hierarchy, conformance tự-khai |
| 12 | Equipment Integration | `/equipment-integration` | **5.0** | 4 | 4 | Genealogy thật; "Integration status" dead-end, không surface live |
| 13 | Visual IR Editor | `/ir-editor` | **5.0** | 7 | 5 | Node-graph + diff/merge; không undo/online/edge-typecheck |
| — | **Backend control-plane** | (xuyên suốt) | **~5** | 5 | 3 | Kiến trúc giàu; interlock/FOE/robot-HITL chưa khép, HW=0 |
| — | **UX/IA toàn nhóm** | (xuyên suốt) | **5.5** | 4 | 6 | DS đồng nhất; IA phẳng, không hub, luồng đứt |

**Trung bình ~4.1/10.** Đường phân bố cho thấy: các trang *soạn thảo/governance* nhỉnh hơn (đã có engine thật), các trang *twin/mô phỏng/mặt bằng* thấp nhất (đúng là "màn trình diễn của một dự đoán").

---

## 2. Chủ đề xuyên suốt (root-cause chung — sửa 1 lần, lợi nhiều trang)

Đây là phần quan trọng nhất: 153 phát hiện quy về **8 nhóm nguyên nhân gốc**. Thiết kế & kế hoạch ở dưới bám theo 8 nhóm này.

### T1 — An toàn đường lệnh chưa khép kín (nghiêm trọng nhất)
- Interlock **không** là tiền-điều-kiện inline trong `commandDispatcher.dispatch()`; chỉ là poll-loop 10s, mặc định TẮT (`interlockEngine.ts:56`). Lệnh HITL có thể ghi xuống máy không qua đánh giá interlock đồng bộ.
- FOE synthesize `actionId='foe-<key>'` không tồn tại trong `ai_pending_actions` → dispatcher OT reject `NOT_CONFIRMED`; test pass chỉ vì mock (`foeEngine.ts:284`, `commandDispatcher.ts:230-247`, `foe.test.ts:20-26`).
- Bất đối xứng cổng HITL: `robotCommandDispatcher` chỉ kiểm `!confirmedBy`, không verify pending-action như OT (`robotCommandDispatcher.ts:121-124`) — FOE robot lọt qua trong khi FOE OT bị chặn.
- E-stop/abort **không** safety-rated: đều đi qua dispatcher phần mềm Node async; `abortRun` chỉ đổi status DB (`foeEngine.ts:867-884`).

### T2 — Chưa chứng minh trên phần cứng (readiness = 0)
- `.env`: `OT_CONTROL_ENABLED=true` nhưng `OT_GATEWAY_ENABLED` bị comment → `startOt()` không nạp adapter → `getActiveDriver()=undefined` → mọi write thật `ADAPTER_OFFLINE` (`otManager.ts:101-119`). Bất đối xứng với `ROBOT_GATEWAY_ENABLED=true`.
- Cần **kiểm tra flag nhất quán lúc khởi động (fail-fast)** thay vì âm thầm offline.

### T3 — Vòng đời chương trình/phiên bản không khép kín
- Không version **diff/rollback UI** (engineering, orchestration, recipes) dù service rollback đã tồn tại; orchestration **đè mất** định nghĩa cũ khi redeploy (`foeEngine.ts:648-660`).
- POU Studio & IR Editor **dead-end** khỏi pipeline gated: không nút "lưu vào project → build/deploy", phải copy JSON thủ công.
- Recipe: hai hệ song song (`machineRecipeRouter` vs `recipeVersioningService`), trang `/recipes` không ghi genealogy.

### T4 — Thiếu realtime / live-trace / online-monitoring
- Hầu hết cockpit chỉ refetch tay (không `refetchInterval`/SSE): orchestration runs, interlock events, fleet, cell-twin, rf-test-cell.
- Engineering có backend D6 `engineeringStream` (watch/force room) nhưng trang **không nối**. IR/POU adapter tắt `canOnlineMonitor/canForce`.

### T5 — Toàn vẹn dữ liệu: thiếu transaction & ràng buộc DB
- Read-then-write không atomic ở promote trạng thái: recipe deploy/rollback (`machineRecipe.ts:152-183`), equipment-integration release/rollback (`recipeVersioningService.ts:142-205`), fleet zone/resource release, equipment-standards publish. Race → 2 bản "active"/"released" cùng lúc.
- Thiếu **partial unique index** (`WHERE status='active'`/`'released'`) làm lưới an toàn cứng.

### T6 — Governance/audit yếu
- Không audit-trail bất biến cho: interlock (hard-delete rule an toàn), equipment-standards board, safety (đóng assignment/abort collab không lưu actor).
- HITL "tự ký": người yêu cầu tự duyệt deploy của chính mình (engineering, recipes) — vi phạm segregation-of-duties.
- Conformance gate của equipment-standards là **checkbox tự-khai** phía client, không được tính ở server.

### T7 — Gating "chỉ xem" trang trí, không cưỡng chế
- **`factory-floor-editor`: `updateLayout` chỉ là `protectedProcedure`** — user read-only vẫn ghi được vị trí máy (`hierarchyRouters.ts:574`). Đây là lỗ hổng bảo mật thật, không chỉ UX.
- POU Studio: `canControl` chỉ bật/tắt badge, không disable inspector/palette/JSON.
- Nhiều trang thiếu `ViewOnlyBadge`/`PermissionGate` (engineering, orchestration).

### T8 — IA/luồng & i18n
- 13 mục trong **một section phẳng**, không hub, 9/13 Beta; breadcrumb ném thẳng vào `/engineering` IDE.
- Gần như **không cross-link** → luồng "soạn → sim → deploy → giám sát" đứt đoạn; 3 editor chồng lấn không có "dùng cái nào".
- i18n thủng: fleet **English-only** với user Việt; ir-editor thiếu toàn bộ key Wave-1/2; equipment-integration thiếu nhóm `recipeStatus/action/source`.

---

## 3. Bản thiết kế hoàn thiện — Tầng điều khiển máy tự động hóa (target world-class thực dụng)

Mục tiêu: một **Control Plane** mạch lạc, an toàn-trước, khép kín vòng đời, ngang các hệ tốt nhất ở phạm vi 1-site; kiến trúc sẵn sàng mở rộng HA/multi-site. Thiết kế gồm 6 trụ.

### 3.1. Trụ A — Command Safety Plane (an toàn đường lệnh, fail-closed)
Chuẩn tham chiếu: TwinCAT deterministic scan · Rockwell GuardLogix · ISA-84/IEC 61511 (nhận thức SIL) · ISA-88 HITL.

**Thiết kế đích:**
- **Một cổng lệnh duy nhất** `dispatch()` với chuỗi gate BẮT BUỘC, thứ tự cứng: `authz → interlock(inline, fail-closed) → reservation(TX+FOR UPDATE) → commissioning/FAT gate → sim-gate(cho deploy) → allowlist(tag.writable) → idempotency → timeout+read-back → audit`.
- **Interlock inline**: `dispatch()` gọi `evaluateInterlocks(adapter,tag,machine)` đồng bộ trước mọi real-write; vi phạm → reject fail-closed. Poller async giữ lại chỉ để giám sát/andon, không thay cổng inline.
- **Đường HITL thống nhất OT ⇄ robot**: cùng một cơ chế `ai_pending_actions` (verify tồn tại + confirmed + owner). Thêm trigger-kind server-internal `'orchestration'` để FOE tạo pending-action thật (hoặc token ký nội bộ dispatcher tái-xác-minh theo run/step) — bỏ chuỗi giả `foe-<key>`.
- **E-stop tách lớp**: tích hợp `SAFETY_PLC_ADAPTER` như đường dừng khẩn phần cứng độc lập (relay/SIL), KHÔNG đi qua dispatcher Node. UI ghi rõ "interlock phần mềm — không thay thế safety-rated hardware".
- **Fail-fast cấu hình**: khởi động kiểm cặp `*_CONTROL_ENABLED` ⇔ `*_GATEWAY_ENABLED`; lệch → log đỏ + banner "control bật nhưng không adapter".

### 3.2. Trụ B — Program Lifecycle (soạn → lint → sim → build → deploy → rollback, khép kín)
Chuẩn: TIA Portal · CODESYS · Studio 5000 · PLCopen TC6.

**Thiết kế đích:**
- **Artifact-centric, version bất biến**: mọi editor (engineering/ir/pou) lưu vào cùng model `program_artifacts` với `kind` phân biệt; version append-only, có `diff` (dòng/AST) và **rollback UI** thống nhất.
- **Bỏ dead-end**: POU Studio & IR Editor có nút "Lưu vào project → Build/Deploy" gọi `createArtifact`; hết copy-paste JSON.
- **Change-control thật**: deploy production yêu cầu **second-approver** (`confirmedBy ≠ requestedBy`), ô lý do bắt buộc, ghi e-signature-lite; append-only `program_deployments`.
- **Sim-gate là tiền-điều-kiện cứng** cho mọi deploy (đã có ở programming; nhân rộng sang orchestration deploy).
- **Online monitoring**: nối `engineeringStream` (watch/force table, room `engineering:{machineId}`) vào Engineering Workspace; IR/POU có watch khi adapter hỗ trợ.

### 3.3. Trụ C — Orchestration & Fleet (mission → simulate → dispatch → monitor, một pane)
Chuẩn: Node-RED/n8n (authoring) · Ignition SFC (trace) · Temporal (durable) · MiR/OTTO Fleet Manager (map-centric) · VDA5050.

**Thiết kế đích:**
- **Node-graph canvas thật** (react-flow/@xyflow) trên chính `workflowModel`/IR: node↔step, cạnh↔thứ tự/branch, kéo-thả, type-check cạnh dữ liệu, undo/redo.
- **Durable execution**: tách `driveRun` khỏi request (queue/worker), `startRun` trả `runId` ngay; bootstrap rehydrate run non-terminal khi khởi động; **sửa lỗi resume** (skip mọi step completed, hỗ trợ gate lồng — idempotent).
- **Live-trace**: SSE/subscription highlight step đang chạy; version history/diff/rollback cho workflow.
- **Fleet map-centric**: bản đồ 2D live (occupancy grid + marker robot từ `poseJson`), dispatch mission từ console, realtime, sửa **toast "thành công" giả** (đọc `res.ok`), validate thiết bị đích khi reassign, gán charger vật lý, tự-giải deadlock (advisory).

### 3.4. Trụ D — Standards, Recipe & Genealogy (ISA-88/ISA-18.2)
Chuẩn: SIMATIC/ISA-88 recipe · Ignition/EEMUA-191 alarm · FactoryTalk AssetCentre (e-signature).

**Thiết kế đích:**
- **Recipe ISA-88 nhẹ**: phân tầng master/control, approval maker-checker, **diff phiên bản + xem payload**, golden recipe, handshake checksum khi nạp máy; hợp nhất một nguồn genealogy (`recipe_load_log`).
- **Alarm rationalization thật (ISA-18.2)**: master alarm DB (priority suy từ consequence×time-to-respond, setpoint/deadband, shelving), KPI alarm (alarms/operator/hour, flood, chattering, stale, top bad-actors), nối `alarm_taxonomy` DB vào runtime Andon.
- **Governance khép kín**: CR mang `proposedSchema` thật (fix publish rỗng phá hierarchy), **conformance tính ở server** (bỏ self-attest), audit-trail append-only + enforcement khi commission máy.

### 3.5. Trụ E — Digital Twin & Layout (một twin thống nhất)
Chuẩn: Emulate3D/Tecnomatix · Visual Components · Isaac Sim (nhẹ) · Ignition Perspective live-twin.

**Thiết kế đích:**
- **Hợp nhất "two twins"**: `cell-twin` và `DigitalTwinCenter` (3D/Rapier) chia sẻ runtime & scene-graph; cell-twin nâng lên 3D hoặc nhúng scene 3D, timeline **scrub/step**, layout lấy từ Floor Editor.
- **Live overlay**: chồng "dự đoán vs thực tế" bằng `operationStatus` live (đã fetch nhưng đang bỏ); nhãn "realtime" chỉ dùng khi có telemetry binding thật.
- **RF Test Cell**: chế độ Live song song Twin; **trace đo RF per-DUT** (TX power/EVM/freq-err/spectrum-mask vs limit), lưu kết quả + export.
- **Floor Editor**: kiểm quyền server (bịt T7), ảnh nền/CAD + tỉ lệ mét, zones vẽ được, invalidate hết stale, zoom/pan/undo.

### 3.6. Trụ F — Nền tảng chung (realtime, audit, gating, IA, i18n)
- **Realtime bus** dùng chung: chuẩn hoá `refetchInterval`/SSE cho mọi cockpit; nguồn sự thật trạng thái máy chuyển sang push (`telemetryBus` tap) thay vì poll 5s; historian `ot_telemetry` vào TSDB/hypertable (kích hoạt migration 0133).
- **Audit-trail bất biến** dùng chung (append-only, actor/before/after) cho interlock/standards/safety/program.
- **Gating cưỡng chế**: mọi mutation control-plane qua `rolePermissionProcedure`; `PermissionGate` bọc toàn bộ mặt editing; `ViewOnlyBadge` nhất quán.
- **IA hub-and-spoke**: chia group thành 4 section con (Lập trình · Điều phối · An toàn & Chuẩn hoá · Twin & Mô phỏng); trang **Engineering Hub** làm landing; cross-link "golden-thread" soạn→sim→deploy→giám sát; làm rõ ranh giới 3 editor.
- **i18n**: tách key `fleet.*` + `ir.*` + `eqIntegration.*` sang `vi/en.json`; thống nhất chuỗi default.

---

## 4. Kế hoạch nâng cấp — 6 Wave (agent-executable)

Nguyên tắc: **an toàn trước, nền chung trước, độ sâu sau**. Mỗi task ghi rõ file/hướng để một agent thực thi. Effort: S(≤0.5 ngày-agent) · M(1–2) · L(3–5). Mọi Wave kết thúc bằng `tsc` + build + test xanh; Wave đụng runtime dùng `/verify`.

### Wave 1 — Command Safety Plane (T1, T2) · ưu tiên cao nhất
Mục tiêu: đóng các lỗ hổng an toàn đường lệnh; readiness HW từ 0 → "đúng-hoặc-fail-rõ".
1. **[M] Interlock inline fail-closed** trong `commandDispatcher.dispatch()` — đánh giá đồng bộ rule theo adapter/tag/machine trước real-write; reject fail-closed. Giữ poller cho andon.
2. **[M] Khép đường FOE→dispatcher + siết HITL robot** — thêm trigger-kind `'orchestration'` (dispatcher tái-xác-minh theo run/step) hoặc FOE tạo `ai_pending_actions` confirmed thật; `robotCommandDispatcher` verify pending-action như OT.
3. **[S] Fail-fast cấu hình flag** — khởi động kiểm `OT_CONTROL_ENABLED`⇔`OT_GATEWAY_ENABLED` (và robot); lệch → log đỏ + trạng thái hiển thị.
4. **[M] Sửa execution model resume (idempotent + gate lồng)** — `foeEngine.ts`: persist stepId completed vào `run.contextJson`, skip mọi step đã xong, hỗ trợ hitl_gate trong parallel/branch.
5. **[L] Tách e-stop safety-rated** *(thiết kế + scaffold; bật khi có HW)* — tích hợp `SAFETY_PLC_ADAPTER` đường dừng độc lập; ánh xạ auto-block interlock tới thiết bị an toàn.

### Wave 2 — Nền tảng chung (T5, T6, T7, T4-phần-lõi)
Mục tiêu: sửa một lần, lợi toàn tầng.
6. **[S] Transaction + row-lock + partial-unique-index** cho recipe deploy/rollback (`machineRecipe.ts`), equipment-integration release/rollback (`recipeVersioningService.ts`), fleet zone/resource release. Thêm `CREATE UNIQUE INDEX … WHERE status='active'/'released'`.
7. **[M] Audit-trail bất biến dùng chung** (append-only: entity, action, actorId, before/after, at) — nối vào interlock (soft-delete rule an toàn), equipment-standards board, safety (closedBy/abortedBy).
8. **[S] Bịt lỗ hổng gating `factory-floor-editor`** — `updateLayout`/`updateLayoutPosition` sang procedure kiểm `machine_control.canEdit`; client bọc toàn bộ mặt editing bằng `PermissionGate`; invalidate hết stale `placedCount`.
9. **[M] Second-approver (segregation-of-duties)** cho deploy production (engineering + recipes): chặn `confirmedBy===requestedBy`, approver picker + lý do bắt buộc.
10. **[M] Realtime chung** — chuẩn hoá `refetchInterval`/SSE cho orchestration runs, interlock events, fleet, twin; ưu tiên nguồn push `telemetryBus`.

### Wave 3 — Program Lifecycle & Online Monitoring (T3, T4)
11. **[M] Version diff + rollback UI** thống nhất (engineering, orchestration, recipes) — bộ chọn 2 phiên bản + diff, nút Rollback gọi service đã có; orchestration thêm bảng `_workflow_versions` (bỏ đè).
12. **[M] Bỏ dead-end POU/IR → pipeline** — nút "Lưu vào project → Build/Deploy" gọi `createArtifact`; affordance tạo project ir-flow tại chỗ.
13. **[L] Online Monitoring (watch/force)** — nối `engineeringStream` vào Engineering Workspace (bảng tag live, upsert/delete symbol); IR/POU bật watch khi adapter cho phép.
14. **[S] Sửa dirty-buffer + idempotency deploy** engineering (validate/build theo buffer đang sửa; idempotencyKey = `dep-{buildId}-{stage}`).
15. **[M] Sửa ngữ nghĩa qualifier SFC** POU (`pouToSt.ts` S/R/P/L/D) hoặc chặn ở linter; FB instance có trạng thái; trình soạn bảng biến.

### Wave 4 — Orchestration Canvas & Fleet map (Trụ C)
16. **[L] Node-graph canvas react-flow** cho Orchestration Studio (và hợp nhất với IR canvas) — kéo-thả, cạnh, type-check, undo/redo; mở rộng Inspector (precondition/compensation/retry/failFast/composite condition).
17. **[L] Durable execution + rehydrate** — queue/worker, `startRun` trả ngay, bootstrap khôi phục run dở.
18. **[L] Fleet map-centric** — bản đồ 2D live (occupancy + marker robot), dispatch mission, realtime, sửa toast giả, validate reassign, gán charger, tự-giải deadlock.
19. **[S] IR editor table-stakes** — undo/redo, lưu vị trí node, audit log saveFlow/requestBuild, i18n Wave-1/2.

### Wave 5 — Standards / Recipe / Alarm (Trụ D)
20. **[M] Fix governance equipment-standards** — CR mang `proposedSchema` (fix publish rỗng), conformance tính ở server, enforcement khi commission máy, TX cho publish.
21. **[L] Alarm rationalization ISA-18.2** — master alarm DB + KPI alarm + nối `alarm_taxonomy` vào Andon runtime.
22. **[M] Recipe ISA-88 nhẹ** — approval maker-checker, xem payload + diff, golden recipe, hợp nhất genealogy, machine-picker, loading/error state.

### Wave 6 — Twin thống nhất, Floor, RF, IA/UX (Trụ E, T8)
23. **[L] Hợp nhất twin** — cell-twin dùng chung scene 3D/Rapier của DigitalTwinCenter; scrub/step timeline; layout từ Floor Editor; live overlay `operationStatus`.
24. **[L] RF Test Cell trace đo** — metric RF per-DUT vs limit, chế độ Live, lưu + export.
25. **[M] Floor Editor world-class** — ảnh nền/CAD + tỉ lệ mét, zones vẽ được, zoom/pan/undo, cue máy chưa đặt.
26. **[M] IA hub-and-spoke + cross-link + i18n** — 4 section con, trang Engineering Hub, golden-thread links, làm rõ 3 editor, tách `fleet.*`/`ir.*`/`eqIntegration.*` sang locale, chuẩn hoá header/badge/ViewOnly.

### Bảng phụ thuộc & thứ tự
- **Wave 1 → 2 → 3** tuần tự (an toàn → nền → vòng đời). **Wave 4/5/6** có thể song song sau Wave 3 (mỗi wave một domain, ít đụng nhau).
- Ước lượng thô: W1 ~5 task, W2 ~5, W3 ~5, W4 ~4, W5 ~3, W6 ~4 → **~26 task**. Nếu chạy bằng workflow multi-agent (pipeline theo file-domain + verify), gom được thành ~6 đợt fan-out.

---

## 5. Rủi ro & nguyên tắc thực thi
- **Emulator-first**: mọi thay đổi an toàn (Wave 1) kiểm trên emulator + test; đường HW chỉ scaffold, bật sau khi có phần cứng (doc 24 P6 procurement).
- **Không nới flag bừa**: giữ mặc định an toàn; chỉ bật flag khi task tương ứng có test xanh.
- **Trung thực nhãn**: giữ kỷ luật "banner đang mô phỏng"; không đổi copy thành "realtime/live" cho tới khi có binding thật (đặc biệt cell-twin/rf-test-cell).
- **Bằng chứng-đầu tiên**: mỗi task tham chiếu `file:line` trong doc này; PR mô tả map task→finding.

---

## 6. Cổng phê duyệt

**Chờ bạn quyết định trước khi tôi gọi các agent chuyên môn thực thi:**
1. **Duyệt toàn bộ 6 wave** theo thứ tự trên, hay
2. **Chỉ Wave 1–2** (an toàn + nền) trước, rồi đánh giá lại, hay
3. **Tùy chỉnh** (thêm/bớt/đổi ưu tiên wave hoặc task cụ thể).

Sau khi bạn chọn, tôi sẽ khởi chạy workflow multi-agent thực thi theo đúng phạm vi được duyệt (mỗi agent một domain, có verify + typecheck + test), và báo cáo lại theo từng wave.

---

## 7. Tổng kết thực thi (2026-07-04)

Bạn đã **phê duyệt toàn bộ 6 wave**. Thực thi bằng workflow multi-agent, mỗi wave chạy các task tuần tự (tránh xung đột file), verify (typecheck + test) sau mỗi wave. Kết quả:

| Wave | Nội dung | Trạng thái | Migration |
|---|---|---|---|
| 1 | Command Safety Plane: interlock inline fail-closed · FOE→dispatcher HITL (tạo `ai_pending_actions` thật) · robot-HITL đối xứng · fail-fast flag CONTROL⇔GATEWAY · resume idempotent + gate lồng · e-stop safety-rated scaffold | ✅ Xanh | — |
| 2 | Nền chung: TX + row-lock + partial-unique-index (recipe/equip-integration/fleet) · audit-trail bất biến `control_audit_log` · **bịt lỗ hổng gating floor-editor** (server kiểm quyền) · second-approver (SoD) · realtime refetch | ✅ Xanh | 0164, 0165, 0166 |
| 3 | Program Lifecycle: dirty-buffer + idempotency deploy · Online Monitoring (watch/symbol table) · version diff + rollback UI (Engineering/Orchestration/Recipes) · SFC qualifier fail-closed + FB instance + Variables panel · POU/IR → pipeline (bỏ dead-end) | ✅ Xanh | 0167 |
| 4 | Orchestration node-graph canvas (toggle Cây\|Sơ đồ) + Inspector composite · durable exec (rehydrate-on-boot + async opt-in) · Fleet live map + toast thật + validate reassign + charger + resolveDeadlock · IR undo/redo + vị trí node + audit + i18n | ✅ Xanh | — |
| 5 | Governance equipment-standards (CR mang proposedSchema, conformance tính server, publish atomic) · Alarm rationalization ISA-18.2 (master_alarms + KPI + nối Andon SEED∪DB + shelving) · Recipe golden + genealogy + machine-picker | ✅ Xanh | 0169, 0170 |
| 6 | Floor Editor world-class (ảnh nền/CAD + mét + zones + zoom/pan/undo) · cell-twin live overlay + scrub/step + layout thật · RF trace đo per-DUT + export (chế độ Live để residual) · IA hub-and-spoke (4 section + Engineering Hub + cross-link + i18n fleet) | ✅ Xanh | 0171 |

**Xác minh cuối (2026-07-04):**
- `npx tsc --noEmit` = **0 lỗi** (giữ baseline sạch xuyên suốt 6 wave).
- Full server suite = **3361 test pass / 0 fail** (296 file); client + IR unit test mới = 28/28 pass.
- **7 migration đã áp** lên dev DB `avi_aoi_db` (0164–0167, 0169–0171; 0168 bỏ trống — task governance không cần đổi schema) + test DB re-clone.
- **1 regression đã sửa**: `visionControl.tools.test.ts` (mock `drizzle-orm` thiếu `gte`/`sql` → cổng interlock inline fail-closed) — thêm mock `interlockGate` pass-through như 3 test dispatcher anh em.

**Còn lại (residual, đã ghi nhận — cần phần cứng hoặc là nâng cấp lớn hơn):**
- **HW-gated**: e-stop safety-rated (scaffold, flag off) · Online Monitor cần nguồn OPC-UA/fast-scan thật · durable async-queue mới là in-process setImmediate (chưa worker bền) · RF "chế độ Live" (nút Live disabled — machine id cell còn là giả).
- **Nâng cấp lớn hoãn**: hợp nhất 3D/Rapier hoàn toàn cho cell-twin (đã có live-overlay + layout thật + scrub, chưa nhúng scene 3D) · canvas orchestration hiện là view đọc/chọn (chưa sửa cấu trúc bằng kéo-thả).
- **Flag còn dormant**: nhiều tính năng gate sau `EQ_GOVERN_ENABLED`/`DPC_*`/`FLEET_*` — bật theo runbook khi sẵn sàng.

Kỷ luật giữ suốt: diff phẫu thuật, fail-closed mặc định, nhãn "đang mô phỏng" trung thực (không đổi thành "realtime/live" khi chưa có binding thật), mỗi task map về finding `file:line` trong doc này. Thay đổi đang ở working tree branch `automation-orchestration-r0` (chưa commit — chờ bạn xem/duyệt commit).

---

### Phụ lục A — Nguồn dữ liệu audit
- Kết quả thô 15 agent: `journal.jsonl` của workflow `wf_472f180c-90d` (13 chức năng + UX) và `wf_0216c606-432` (equipment-integration + backend).
- Digest cô đọng (summary + P1/P2 + benchmark + recommendations từng trang): `scratchpad/audit-digest.txt`.
- Mọi `file:line` trong doc này đã được agent tương ứng đọc & xác minh tại thời điểm audit (branch `automation-orchestration-r0`, 2026-07-03).
