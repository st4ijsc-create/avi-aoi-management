# 26 — Module "Kỹ thuật & Điều khiển": Báo cáo trải nghiệm Frontend theo cấp độ người dùng

> **Trạng thái:** CHỜ PHÊ DUYỆT — chưa gọi agent xử lý. Bạn review & quyết phạm vi trước.
> **Ngày:** 2026-07-04
> **Đối tượng chính:** **Kỹ thuật viên** (KTV). Trọng tâm: **frontend / trải nghiệm** (mượt · dễ · nhanh), không phải bug logic.
> **Phạm vi:** 14 trang nhóm nav `engineering` (Hub + Engineering/IR/POU/Recipe · Orchestration/Fleet · Interlock/Safety/Standards/Integration · Floor/RF/CellTwin) — **trạng thái sau nâng cấp 6-wave (doc 25)**.
> **Phương pháp:** 6 AI-agent **đóng vai** đọc trực tiếp `.tsx` hiện tại, "đi" module như người dùng thật làm nghiệp vụ điển hình: 4 cấp độ (L1 KTV mới · L2 KTV thành thạo · L3 giám sát · L4 người xem) + 2 góc xuyên suốt (IA/Design/i18n · Luồng vàng end-to-end). Mọi nhận định kèm `file:line` đã xác minh.

---

## 0. TL;DR & điểm trải nghiệm theo cấp độ

Sau 6-wave, module đã **mạch lạc và "pro" hơn hẳn ở từng trang**: Engineering Hub hub-and-spoke, canvas IR kéo-thả + undo/redo, version diff/rollback 3 tầng, realtime runs, guardrail an toàn rõ, i18n tiếng Việt rất sâu. Ma sát còn lại **không nằm trong từng trang mà ở KHỚP NỐI giữa các trang và ở ONBOARDING**: ngữ cảnh không đi theo khi chuyển trang, luồng vàng cụt ở bước gắn thiết bị, thiếu breadcrumb "về Hub", gating chỗ ẩn chỗ mờ, và người mới thiếu điểm bắt đầu.

| Cấp độ | Điểm trải nghiệm /10 | Cảm nhận một dòng |
|---|:---:|---|
| **L1 — KTV mới** | **6.5** | Cửa vào thân thiện + guardrail an tâm, nhưng không có "chạy thử" và kết quả sim mờ nhạt |
| **L2 — KTV thành thạo** | **6.5** | Từng trang nhanh-mượt, nhưng chuyển-trang mất ngữ cảnh + thiếu Ctrl+S + sơ đồ Studio chỉ đọc |
| **L3 — Giám sát/Trưởng ca** | **6.0** | Deadlock/an toàn realtime tốt, nhưng không có "hộp phê duyệt" gộp + không push việc mới |
| **L4 — Người xem/kiểm toán** | **6.5** | Không dead-end, ViewOnlyBadge nhất quán, nhưng gating chỗ ẩn chỗ mờ + thiếu tooltip "vì sao" |
| **Xuyên suốt — IA/Design/i18n** | **7.0** | IA 4-section + Hub + i18n xuất sắc, nhưng 13/14 trang thiếu breadcrumb + vài chỗ lệch DS |
| **Xuyên suốt — Luồng vàng KTV** | **6.5** | Luồng A gói gọn 1 trang (wow), nhưng cụt ở "gắn thiết bị" + duyệt HITL "mù" |

**Trung bình ~6.5/10** — "chuyên nghiệp ở từng màn, còn ma sát ở mối nối & bước đầu". Bốn đòn bẩy hiệu quả nhất cho KTV (effort thấp–vừa, tác động cao): **(1) mang ngữ cảnh qua deep-link + context store**, **(2) gắn thiết bị vào project để mở khoá online-monitor**, **(3) đấu breadcrumb + link về Hub cho 13 trang**, **(4) chuẩn hoá gating "hiện-nhưng-khoá + tooltip lý do"**.

---

## 1. Điểm mạnh cần GIỮ (đừng phá khi cải tiến)

Đây là những thứ mọi persona đều khen — nền tảng trải nghiệm tốt cần bảo toàn:

- **Engineering Hub hub-and-spoke** — gom 13 chức năng rối thành 4 nhóm tác vụ + dải "Luồng vàng: soạn → mô phỏng → deploy → giám sát", phản chiếu đúng 1 nguồn dữ liệu với sidebar (`EngineeringHub.tsx:106-137` ↔ `navigation.tsx:700-705`). Cứu người mới khỏi bị ném thẳng vào IDE.
- **Guardrail an toàn tâm lý** — banner HITL hổ phách + nút Deploy mờ kèm tooltip "phải duyệt trước" + chặn tự-duyệt (SoD) (`RecipeManagement.tsx:242-246,391-410`); banner trung thực "deploy TẮT → SIMULATED, an toàn nằm trên PLC" (`EngineeringWorkspace.tsx:373-380`); interlock khoá "Bật" tới khi duyệt (`InterlockRuleManagement.tsx:322-340`).
- **Version diff + rollback 3 tầng** (Workspace/IR/Orchestration) + genealogy recipe, đều qua AlertDialog xác nhận + idempotency ổn định (`EngineeringWorkspace.tsx:980-1005`, `OrchestrationStudio.tsx:1635-1730`, `IrEditor.tsx:1487-1517`).
- **Canvas IR react-flow thực thụ** — kéo khối từ palette thả vào đúng nhánh true/false/loop, lưu toạ độ vào AST, undo/redo có phím tắt (bỏ qua khi gõ text), lint live 400ms tô viền node (`IrEditor.tsx:1067-1079,1286-1300`, `IrGraphCanvas.tsx:203-273,325-327`).
- **Orchestration realtime** — poll 2s tự dừng khi run terminal, ▶ highlight bước đang chạy, Approve/Reject/Abort HITL ngay trên dòng run (`OrchestrationStudio.tsx:1066-1074,1772-1810`); Inspector picker theo capability schema (không gõ verb tay) + validate inline (`:338-382,621-638`).
- **Fleet deadlock + live map** — banner chu trình A→B→C→A + nút Resolve 1-chạm; marker robot theo trạng thái + zone theo mức chiếm dụng (`FleetOrchestration.tsx:521-553,1200-1219`). **Safety ticker realtime bằng socket thật** (`SafetyWorkforce.tsx:234-252`).
- **Read-only tử tế** — RouteGuard chặn mềm có lối thoát (không flash "denied"), ViewOnlyBadge nhất quán 12/14 trang, FactoryFloorEditor là chuẩn vàng (ẩn nút + disable input + đổi con trỏ grab→pointer) (`RouteGuard.tsx:89-101`, `PermissionGate.tsx:91-103`, `FactoryFloorEditor.tsx:163,477,482`).
- **i18n tiếng Việt rất sâu & THẬT** — `vi.json` có 182 key fleet, 212 key ir, 99 key eqIntegration, dịch cả chuỗi hint dài; parity vi/en khớp trên mọi namespace. Đối tượng VN gần như không rơi về tiếng Anh.
- **⌘K command palette + ⌘\ mega-menu** — nhảy mọi trang không rời bàn phím (power-user).
- **Trạng thái loading/empty/error** đầy đủ ở các trang data-heavy (Recipe/Orchestration/EquipmentStandards/Fleet): skeleton + nút "Thử lại" + empty rõ.

---

## 2. Báo cáo theo từng cấp độ

### 2.1 · L1 — Kỹ thuật viên MỚI / thao tác cơ bản (6.5/10)
> *"Cửa vào thân thiện, guardrail làm tôi an tâm — nhưng để chỉ chạy thử một mô phỏng, tôi phải tự đi 7 bước và không biết bắt đầu từ đâu."*

**Tốt:** Hub 4 nhóm + banner "Khi nào dùng" ở 3 editor giúp phân biệt công cụ chồng lấn; guardrail an toàn mạnh; xem payload chỉ-đọc tách khỏi sửa; chống mất dữ liệu (dirty-guard); picker máy/người-ký thay vì gõ tay.

**Cần cải tiến (ưu tiên):**
1. **[M/high] Không có dự án DEMO / nút "chạy thử"** — để mô phỏng phải tự đi 7 bước (tạo project → gõ code → lưu → kiểm tra → build → chọn build → mô phỏng); màn trống chỉ ghi "Chưa có dự án", không nút mẫu (`EngineeringWorkspace.tsx:437-459`). → seed 1 project DEMO chỉ-đọc + nút "Mô phỏng thử" một chạm.
2. **[S/high] Kết quả mô phỏng ở IDE quá mờ nhạt** — chỉ dòng chữ "Timeline (N bước, OK/WARN)" (`EngineeringWorkspace.tsx:630-639`), thua xa badge màu ở Orchestration/RF. → thêm badge lớn xanh "ĐẠT" / vàng "CÓ CẢNH BÁO" đầu kết quả.
3. **[M/medium] Hub tile không báo trước Beta / cần-quyền** — bấm vào mới biết chỉ-xem hoặc Beta (`EngineeringHub.tsx:124-134`). → gắn chip Beta + dấu khoá/"Chỉ xem" lên tile.
4. **[M/medium] Cockpit nâng cao mở ra "lạnh"** — chỉ 3 editor có "Khi nào dùng"; Orchestration/Fleet/Safety/Standards/Integration/CellTwin không giải thích trang LÀ GÌ. → thêm 1 dòng "Khi nào dùng" mỗi cockpit.
5. **[M/medium] Thiếu lối vào theo MÁY** — Recipe lấy mã làm trục, KTV muốn "xem recipe máy X đang chạy" phải biết trước mã (`RecipeManagement.tsx:250-300`).

**Còn thiếu:** onboarding/tour "3 việc đầu tiên"; project DEMO tập sim; giải thích PASS/FAIL "nghĩa là gì / làm gì tiếp".

### 2.2 · L2 — Kỹ thuật viên THÀNH THẠO / kỹ sư điều khiển (6.5/10)
> *"Từng trang rất pro, nhưng ngữ cảnh KHÔNG đi theo: từ Workspace nhảy sang IR Editor thì canvas trống, phải chọn lại từ đầu — đúng thứ power user ghét."*

**Tốt:** canvas IR kéo-thả + undo/redo phím tắt + lint live + transpile highlight; dirty-guard; deploy chống double-submit + SoD picker; online-monitor báo nguồn trung thực; Inspector picker theo capability; realtime runs; ⌘K/⌘\; diff/rollback 3 tầng.

**Cần cải tiến (ưu tiên):**
1. **[M/high] Ngữ cảnh không đi theo khi chuyển trang** — cross-link golden-thread chỉ là `<Link href>` trơn, không mang project/thiết bị/flow (`EngineeringWorkspace.tsx:367-370`, `IrEditor.tsx:1141-1143`); không có context store dùng chung. → deep-link `?projectId=/?flowArtifact=/?machineId=` + context store nhẹ + nút "Mở project này trong IR/POU".
2. **[S/medium] Ô "Ngôn ngữ" bắt gõ tay** thay vì Select dù đã có bảng `KIND_LANGUAGE` (`EngineeringWorkspace.tsx:525-527,72-80`).
3. **[S/medium] Thiếu Ctrl+S / Ctrl+Enter** — hook `useFormShortcuts` có sẵn nhưng chưa wire (`useKeyboardShortcuts.ts:86-113`); gõ Ctrl+S → trình duyệt bật hộp lưu trang.
4. **[L/medium] Sơ đồ node Orchestration chỉ ĐỌC** — phải quay lại tab Cây để thêm/sắp bước (`OrchestrationStudio.tsx:1460-1462`), trong khi IR canvas sửa đầy đủ → bất nhất kỳ vọng "soạn trên sơ đồ".
5. **[M/medium] Lưu phiên bản không có ghi chú "vì sao"** — chip "v1·main" không mô tả, sau chục vòng lặp không phân biệt được bản.
6. **[S/medium] Danh sách project/flow/workflow không có tìm/lọc** — hàng chục project phải cuộn tìm bằng mắt.

**Còn thiếu:** deep-link "mở-trong"; phím tắt tác vụ editor; multi-select/batch; soạn trực tiếp trên sơ đồ Orchestration; commit-note + diff-trước-khi-lưu.

### 2.3 · L3 — Giám sát / Trưởng ca kỹ thuật (6.0/10)
> *"Đủ công cụ nhưng phải tự đi gom — muốn biết 'cái gì đang chờ tôi duyệt' phải mở lần lượt 4-5 trang."*

**Tốt:** deadlock UX rõ + nút Resolve; safety ticker socket realtime; phê duyệt SoD chắc tay; HITL run Approve/Reject/Abort inline + ▶ bước; truy vết version/genealogy; realtime poll 5s; DS nhất quán; i18n khớp; fleet live map.

**Cần cải tiến (ưu tiên):**
1. **[L/high] Không có "hộp phê duyệt" gộp toàn module** — phải đi Recipes + Interlock + Orchestration runs + Safety; Hub tile không có badge số việc chờ; `/inbox` chỉ phục vụ đề xuất AI (`EngineeringHub.tsx:124-134`, `AIActionInbox.tsx:248`). → dải/trang "Chờ duyệt" gộp đếm recipe-chưa-duyệt + rule-chưa-duyệt + run-held + sự-cố-chưa-audit + deadlock, deep-link.
2. **[M/high] Dialog duyệt recipe thiếu ngữ cảnh** — không thấy ai tạo / lý do / diff tại chỗ, phải mở diff riêng rồi quay lại (`RecipeManagement.tsx:623-653`). → nhúng requester + notes + diff-vs-golden vào chính dialog.
3. **[M/high] "Resolve deadlock" bấm 1 phát, không xem trước/xác nhận** — không nêu thiết bị/waiter nào sẽ bị huỷ (`FleetOrchestration.tsx:542-550`). → AlertDialog + xem trước "nạn nhân" + ô lý do.
4. **[M/high] Realtime không đồng nhất & không "nhắc" khi sự kiện MỚI nổ ở trang khác** — safety socket nhưng deadlock/interlock chỉ poll 5s, không toast/notification xuyên trang.
5. **[S/medium] Run chờ duyệt bị chôn trong "Recent runs"** — không ghim/đếm/lọc riêng, dễ bỏ sót (`OrchestrationStudio.tsx:1562-1585`).
6. **[S/medium] Approve/reject/resolve không ghi được lý do** (trong khi duyệt recipe lại có) — quyết định oversight thiếu dấu vết.

**Còn thiếu:** màn "Oversight — chờ duyệt & cảnh báo" gộp; push khi sự kiện nghiêm trọng mới; activity-log hợp nhất; xem-trước + lý do cho phá-deadlock.

### 2.4 · L4 — Người XEM / khách / kiểm toán (6.5/10)
> *"Không bị trang trắng, badge 'Chỉ xem' nhất quán — nhưng nửa số trang ẨN nút, nửa kia LÀM MỜ mà không nói vì sao, nên khó biết thao tác gì đang bị khoá."*

**Tốt:** 14 route đăng ký thật, RouteGuard chặn mềm; ViewOnlyBadge 12/14; FactoryFloorEditor chuẩn vàng; twin/RF tự khai "100% read-only"; IR/POU nút lưu có tooltip lý do đã dịch; loading/empty/error tốt.

**Cần cải tiến (ưu tiên):**
1. **[M/high] Chiến lược chặn ghi không nhất quán: nửa ẩn — nửa mờ** — Fleet/Safety/Standards/Recipe/Interlock ẩn nút (`{canControl && ...}`), còn Orchestration/Workspace/IR/POU/Floor làm mờ. Ẩn = mất minh bạch kiểm toán; mờ-câm = không biết vì sao. → thống nhất "hiện-nhưng-khoá + tooltip lý do".
2. **[M/high] Nút mờ phần lớn KHÔNG có tooltip "vì sao"** — vd deploy/run Orchestration `disabled` không title (`OrchestrationStudio.tsx:1279,1282`); Workspace 14 chỗ disabled chỉ 1 title. → bọc bằng `PermissionGate mode='disable'` (đã tự thêm title).
3. **[S/medium] RF Test Cell & Cell Twin thiếu ViewOnlyBadge** — phá nhất quán; RF còn có đường "Going live" cần machine_control mà không chỉ báo read-only ở header (`RfTestCellSim.tsx:42,51`).
4. **[S/low] Badge read-only key theo `machine_control` lệch với quyền vào trang `machine_monitoring`** — user quyền hỗn hợp có thể "badge không hiện nhưng nút vẫn mờ".

**Còn thiếu:** banner chỉ-xem cấp trang giải thích lý do; khả năng "xem thao tác tồn tại nhưng bị khoá" (giá trị kiểm toán); hiển thị quyền-yêu-cầu ngay tại nút.

---

## 3. Hai góc xuyên suốt

### 3.1 · IA / Điều hướng / Design-system / i18n / Responsive (7.0/10)
**Tốt:** IA 4-section theo tác vụ khai báo tập trung + Hub tái dùng đúng key/thứ tự (1 nguồn sự thật); i18n rất sâu; nav model giàu metadata (hint giải nghĩa acronym, beta badge); breadcrumb infra sẵn sàng (`breadcrumbs.ts:39-82`).

**Cần cải tiến:**
1. **[S/high] Breadcrumb có hạ tầng nhưng 13/14 trang không dùng** — chỉ Hub truyền `breadcrumbs=`; vào sâu mất la bàn "đang ở đâu / về Hub" (`EngineeringWorkspace.tsx:343-347`). → nối `buildBreadcrumbs()` vào PageHeader ở 13 trang (mẫu copy từ Hub).
2. **[M/medium] Thẻ `<select>`/`<input type=checkbox>` gõ tay bắt chước DS** thay vì `ui/select`+`ui/checkbox` — tập trung ở EquipmentStandards (`1083,1157,1272,1434-1475,1316,1483`), EquipmentIntegration (`444,456,762,824,831`), Fleet (`604,1149,1751,1817`), Orchestration (`471,664`). Lệch popover/search/bàn-phím/dark-mode.
3. **[S/medium] Section "An toàn & Chuẩn hóa" quá tải/trộn ngữ nghĩa** — nhét equipment-integration (kết nối FOCAS/Euromap) vào nhãn "An toàn" khó đoán (`navigation.tsx:838`). → tách "Chuẩn hóa & Tích hợp" hoặc chuyển integration về nhóm Devices.
4. **[S/low] Hub xếp trong section "authoring"** → đọc như 1 tool soạn thảo thay vì cửa vào tổng (`navigation.tsx:715-718`).
5. **[M/low] Màu trạng thái viết literal per-page** (`FleetOrchestration.tsx:80-142` ~30 chỗ) dễ lệch nghĩa màu giữa các trang → rút về Badge variant/token chung.
6. **[M/low] loading/empty/error không đồng đều** — PouStudio/CellTwin chỉ 1 dấu hiệu → chuẩn hoá `ui/empty`.

**Còn thiếu:** cross-link "bước kế" inline giữa editor chồng lấn; link "về Hub" nhất quán trên 13 trang.

### 3.2 · Luồng vàng kỹ thuật viên end-to-end (6.5/10)
> *"Luồng A gói gọn 1 trang là 'wow' — nhưng tới 'giám sát online' thì cụt vì không có chỗ gắn thiết bị vào project."*

**Tốt:** toàn luồng A (sửa→kiểm tra→build→sim→deploy→rollback) trên MỘT trang, giữ ngữ cảnh project; HITL inline + realtime + version diff; Hub mở đầu bằng banner luồng vàng.

**Cần cải tiến (ưu tiên):**
1. **[M/high] Cụt mạch ở "giám sát online": không có chỗ gắn thiết bị vào project** — nút "Theo dõi trực tiếp" luôn báo "chưa gắn thiết bị"; dialog tạo project không có picker deviceId (`EngineeringWorkspace.tsx:304-308,828-835`). Điểm chốt luồng vàng thành dead-end. → thêm Select "Thiết bị nguồn" + mutation set deviceId.
2. **[M/high] Cổng HITL: người duyệt không thấy prompt đã soạn** — RunRow chỉ hiện badge trạng thái, không render `hitl_gate.prompt` (`OrchestrationStudio.tsx:1774-1793`). Duyệt "mù". → hiện prompt của `currentStepId` cạnh nút Approve.
3. **[S/medium] Chuyển sang cell-twin/rf mất ngữ cảnh workflow** — link không kèm `?ref=`, trang đích tự cho chọn lại (`OrchestrationStudio.tsx:1490-1494`).
4. **[M/medium] Studio thiếu chỉ báo "chưa lưu"** — Run chạy theo `def.ref` (bản đã deploy) trong khi editor có thể đang sửa → KTV tưởng chạy bản mới (`:1191,1282`).
5. **[M/medium] Thiếu "stepper" tiến trình luồng vàng** — 5 card xếp dọc phải cuộn dài, không biết đã build/sim/deploy chưa.
6. **[S/low] Mật độ chữ text-[10px]/[11px] dày** — khó đọc/chạm trên tablet xưởng (a11y).

**Còn thiếu:** link "Xem thiết bị trực tiếp" sau deploy; nhãn "bản đang chạy trên thiết bị"; liên kết ngược Run/HITL → twin của chính run đó; breadcrumb ngữ cảnh xuyên trang.

---

## 4. Tổng hợp chủ đề gốc (sửa 1 lần — lợi nhiều cấp độ)

15 chủ đề lặp lại, xếp theo **tác động × công sức** (đây là xương sống của kế hoạch cải tiến):

| # | Chủ đề (root-cause UX) | Cấp độ hưởng lợi | Impact | Effort |
|---|---|---|:---:|:---:|
| U1 | **Ngữ cảnh đi theo khi chuyển trang** (deep-link `?projectId/flow/machine` + context store; nút "Mở-trong") | L2, golden, IA | ★★★ | M |
| U2 | **Gắn thiết bị vào project** → mở khoá online-monitor (Select deviceId + mutation) | L2, golden | ★★★ | M |
| U3 | **Breadcrumb + link "về Hub" cho 13 trang** (đấu `buildBreadcrumbs` vào PageHeader) | tất cả | ★★★ | S |
| U4 | **Chuẩn hoá gating "hiện-nhưng-khoá + tooltip lý do"** (bọc nút ghi bằng `PermissionGate mode='disable'`) | L4, L1, KTV | ★★★ | M |
| U5 | **"Hộp phê duyệt" gộp** (đếm + deep-link recipe/rule/run/audit/deadlock) trên Hub + badge nav | L3, KTV | ★★★ | L |
| U6 | **HITL duyệt có ngữ cảnh** (hiện prompt/requester/diff tại chỗ ở Studio & recipe dialog) | L3, golden | ★★★ | M |
| U7 | **Onboarding L1**: project DEMO + nút "Mô phỏng thử" + "Khi nào dùng" mọi cockpit + chip Beta/quyền trên tile | L1 | ★★☆ | M |
| U8 | **Badge PASS/FAIL to-rõ** ở kết quả sim IDE (đồng bộ với Orchestration/RF) | L1, golden | ★★☆ | S |
| U9 | **Picker thay gõ tay** (ô "Ngôn ngữ" → Select; JSON payload → template) | L1, L2 | ★★☆ | S |
| U10 | **Phím tắt tác vụ** Ctrl+S lưu / Ctrl+Enter validate-build (hook đã có) | L2 | ★★☆ | S |
| U11 | **Chuẩn hoá DS**: `<select>`/`<checkbox>` native → `ui/*`; `window.confirm` → AlertDialog; màu status → token chung | IA, L1 | ★★☆ | M |
| U12 | **Realtime đồng nhất + push** (socket/notification khi sự kiện nghiêm trọng mới; nhãn "updated Ns ago") | L3 | ★★☆ | M |
| U13 | **Tìm/lọc + batch** trong danh sách project/flow/workflow/version; tách nhóm "Chờ duyệt" lên đầu | L2, L3 | ★★☆ | M |
| U14 | **Soạn trực tiếp trên sơ đồ Orchestration** (parity với IR canvas) + stepper luồng vàng | L2, golden | ★★☆ | L |
| U15 | **Lối vào theo MÁY cho Recipe** (chọn máy → recipe active) + IA tách integration khỏi "An toàn" | L1, IA | ★☆☆ | M |

---

## 5. Kế hoạch cải tiến đề xuất (chờ bạn duyệt phạm vi)

Ưu tiên **KTV smoothness**: cắt click lặp, giữ ngữ cảnh, giảm tải nhận thức. Đề xuất 3 đợt (UX-wave), mỗi task map về chủ đề U#:

**Đợt 1 — Khớp nối & la bàn (đòn bẩy cao, effort thấp–vừa):** U3 breadcrumb 13 trang · U1 deep-link + context store · U2 gắn thiết bị vào project · U8 badge PASS/FAIL · U9 picker · U10 phím tắt. → *KTV đi trọn luồng vàng không mất ngữ cảnh, không cụt ở giám sát.*

**Đợt 2 — Minh bạch & phê duyệt:** U4 chuẩn hoá gating + tooltip · U6 HITL/recipe duyệt có ngữ cảnh · U5 hộp phê duyệt gộp + badge nav · U12 realtime + push · U13 tìm/lọc + nhóm "Chờ duyệt". → *L3 quản trị trong 1 màn; L4 minh bạch; KTV không chờ mù.*

**Đợt 3 — Onboarding & hoàn thiện DS:** U7 onboarding L1 (DEMO + "Khi nào dùng" + chip tile) · U11 dọn DS (select/checkbox/confirm/màu) · U14 sơ đồ Orchestration sửa được + stepper · U15 lối vào theo máy + tách IA. → *người mới tự tin; toàn module nhất quán mượt.*

Đợt 1 phần lớn **effort S/M, tác động cao** — nên làm trước. Đợt 3 có 1-2 task L (sơ đồ Orchestration sửa được) có thể tách riêng.

---

## 6. Cổng phê duyệt

**Chờ bạn quyết trước khi tôi gọi các AI-agent chuyên môn xử lý:**
1. **Duyệt cả 3 đợt** theo thứ tự trên, hoặc
2. **Chỉ Đợt 1** (khớp nối & la bàn — đòn bẩy KTV cao nhất) trước, rồi đánh giá lại, hoặc
3. **Chọn các chủ đề U# cụ thể** bạn muốn làm (vd chỉ U1–U4, U8), hoặc
4. **Tùy chỉnh** (đổi ưu tiên/thêm/bớt).

Sau khi bạn chọn, tôi sẽ chạy workflow multi-agent thực thi theo đúng phạm vi (mỗi agent một cụm trang/chủ đề, có verify + typecheck + test), giữ nguyên các điểm mạnh ở §1, và báo cáo theo từng đợt.

---

### Phụ lục — Nguồn dữ liệu
- 6 báo cáo persona thô: `journal.jsonl` của workflow `wf_82d6e867-0a3`. Digest: `scratchpad/ux-digest.txt`, `scratchpad/ux-reports.json`.
- Mọi `file:line` do agent tương ứng tự đọc & xác minh trên trạng thái sau 6-wave (branch `automation-orchestration-r0`, 2026-07-04).
