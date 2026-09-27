# Kế hoạch thực thi — Đợt 2 "Bố cục" module Kỹ thuật & Điều khiển

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mỗi task là một brief gồm yêu cầu và tiêu chí nghiệm thu. Implementer đọc mã tại chỗ; mọi số liệu phải đo trên màn hình thật.

**Goal:** Dựng lại bố cục 14 màn Engineering theo năm mẫu layout, sao cho vùng làm việc chính (editor, canvas, danh sách) chiếm phần lớn khung nhìn đầu tiên. Bỏ khung vỏ dư thừa, dời tương tác phụ từ modal giữa màn sang flyout, và mỗi ngữ cảnh chỉ còn một lối vào AI. Giữ nguyên mọi hành vi an toàn và nghiệp vụ đã làm ở Đợt 0/1/1B/1C.

**Architecture:** Dựng trên các primitive đã có trong repo (FE2 §2): `WorkspaceShell`/`ResizablePanelGroup`, `ui/sheet` (qua `ContextDrawer`), `TabbedHub` (tab đồng bộ `?tab=`), `DataTable`, `EntityPicker`/`MachineSelect`, `EmptyState`, `FilterBar`. Không cài thư viện mới. Làm theo ba bước:
1. Sửa shell dùng chung và thêm thành phần dùng chung, gồm thiết bị đo layout.
2. Chuyển từng màn theo thứ tự rủi ro tăng dần (FE2 §5).
3. Đo lại toàn bộ và nghiệm thu bằng số.

**Tech Stack:** React 19 + Vite + Tailwind/shadcn, wouter, tRPC v11 + react-query, `react-resizable-panels`, `vaul`, `@xyflow/react`, i18next, Vitest + testing-library/jsdom, Playwright (đo).

**Spec:**
- `docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU_FE_BE_2026-09-27.md` §1 (1.1 chỉ số và mục tiêu, 1.2 MAIN/SUB/FLYOUT theo màn, 1.3 năm mẫu + shell + thành phần dùng chung, 1.4 vai trò, 1.5 thứ tự).
- Phụ lục `81_ENGINEERING_CONTROL_KHAO_SAT_SAU/FE1_DO_BO_CUC_THEO_VUNG_14_MAN.md` (số đo từng màn) và `FE2_KIEN_TRUC_SHELL_VA_LAYOUT_CODE.md` (file:line, cấu trúc trang, trùng lặp, đề xuất mức mã).
- Quyết định IA ở doc 80 §9, đã được chủ dự án duyệt.

> **Chủ dự án duyệt viết plan** ngày 2026-09-27: "Đồng ý, viết Plan" (sau doc 81 §5 mục 5: "Đợt 2 sau Đợt 1B theo FE2 §5"). **Chưa duyệt thực thi.** Chủ dự án review plan này trước.

## Global Constraints

1. **Nhánh dùng chung với các phiên Claude khác.**
   - Không dùng `git add -A`, `stash`, `checkout --`, `reset`, `rebase`, `push`.
   - Commit bằng pathspec, chỉ các tệp mình sửa, message kiểu repo (không dấu) kèm "(doc 81 dot 2 task N)" và trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
   - Không dùng `git worktree`.
2. **Không đụng môi trường chung.**
   - Không restart :3000. Không `npm run build` vào `dist/`. Không `npm install`/`npm ci`.
   - Không sửa `.env`. Không ghi DB dev.
   - Muốn nhìn giao diện thì tự chạy Vite + server từ mã nguồn ở cổng riêng (vd 3016/5176) với DB `_test` và mọi tích hợp ra ngoài tắt (xem thiết bị đo ở Task 1), rồi tắt khi xong.
3. **Không đổi hành vi nghiệp vụ hay an toàn.** Đây là đợt bố cục: mọi procedure, mutation, cổng, input và thông điệp lỗi phải giữ nguyên. Riêng các thành phần phải giữ đúng hợp đồng:
   - `FeatureStatusGate`: 4 trạng thái loading/off/on/error.
   - `ConfirmWithReason` + OTP: độ dài lý do tối thiểu và độ "tươi" OTP.
   - Maker-checker (người duyệt khác tác giả).
   - Nhãn provenance (DEMO/SEED/SIM, DRY-RUN, "chưa xác nhận").
   - Panel tư thế và nguồn an toàn.
   - `deployPreview` (hiện trước OTP).
   - Nút Huỷ của Copilot stream.
   - Cảnh báo sửa interlock đã duyệt.
   - Shelve bị khoá.
   - Tất cả phải còn chạy và còn test.
4. **TDD cho thay đổi hành vi UI** (flyout mở/đóng, URL `?flyout=`/`?tab=`, phím tắt, focus/Esc). Test DOM viết ĐỎ trước; sau đó đột biến (gỡ dòng then chốt ⇒ ĐỎ). Test DOM sẵn có của trang phải còn xanh. Nếu phải đổi selector thì chỉ đổi selector, không đổi khẳng định, và liệt kê từng chỗ đổi.
5. **i18n:** mọi chuỗi mới dùng `t()`, có khoá ở vi/en/zh. Đọc lại tệp locale ngay trước khi sửa. Giữ các khoá "whenToUse" riêng của từng trang.
6. **Census là dụng cụ đo.** Sửa đúng thứ census đếm, hoặc ghim lại theo đúng quy trình của chính census đó. Không né. `server/_core/index.ts` phải giữ nguyên số dòng. Các census đã đỏ sẵn, không phải của đợt này: xacThucBeMatRest, congGiayPhepAiCensus §2, appErrorParamsCoverage (twinCanh), viStringCoverage (twin3d), kiem-vo-app-https, appErrorCoverage (cuaIngestScan/aoiPackageRouter), clientErrorCoverage (AOIPackages), rawErrorMessageCensus (4 mục).
7. **Kiểm kiểu:** `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit`.
8. **Nghiệm thu bằng số đo.** Mỗi task chuyển trang phải chạy thiết bị đo của Task 1 trên trang đó ở 1600×950 và 1366×768, ghi TRƯỚC/SAU vào báo cáo, và đạt ngưỡng của trang (bảng Mục tiêu dưới đây). Ảnh chụp lưu vào `.playwright-mcp/` (đã gitignore). Không commit ảnh.
9. **Truy cập bàn phím và khả năng tiếp cận:**
   - Flyout: bẫy focus, Esc đóng, trả focus về nút đã mở.
   - Panel co giãn: kéo được bằng bàn phím (react-resizable-panels có sẵn).
   - Không bỏ `aria-*` đang có.
10. **Tương thích màn nhỏ:** dưới 1024 px, layout workbench chuyển thành tab hoặc stack thay vì panel cạnh nhau; mobile giữ `BottomNav`. Không được có thanh cuộn ngang ở 1366.

**Mục tiêu đo (doc 81 §1.1):**

| Chỉ số | Mục tiêu |
|---|---|
| Editor/canvas trong khung đầu — IDE | ≥45 % @1600×950, ≥40 % @1366×768 (kể cả khi mở panel Copilot) |
| Editor/canvas — IR, POU | ≥50 % @1600 |
| Editor/canvas — Orchestration | ≥45 % @1600 |
| Khoảng dọc trước tiêu đề trang | ≤100 px |
| Màn có 2 breadcrumb | 0 |
| Banner trước nội dung chính | 0 (thay bằng chip 1 dòng) |
| Dải KPI | chip 32 px thay thẻ 130–146 px |
| Dialog tạo/sửa/duyệt giữa màn | → flyout. Chỉ giữ AlertDialog cho xác nhận phá huỷ và ConfirmWithReason+OTP |
| Copilot/AI che nội dung | 0 px — panel nằm trong layout và đẩy nội dung, không đè |
| Trang cao nhất (Standards cảnh báo) | ≤1,5× chiều cao màn nhờ DataTable phân trang |

## Review Focus

1. **Mất hành vi khi đổi vỏ.** Dialog → flyout có thể bỏ sót validation, mất trạng thái form khi đóng/mở, hoặc không còn gọi `invalidate` sau mutation. Mỗi flyout phải có test luồng đầy đủ: mở → nhập → lưu → danh sách cập nhật → URL sạch.
2. **State nâng lên Context ở IDE** (khoảng 40 `useState`). Chọn project phải reset artifact/build/sim/diagnostics như cũ (FE2 §3). Phải có test cho chuỗi reset này trước khi tách card.
3. **Unmount giữa chừng.**
   - Tab collaboration ở Safety có state-machine `phase` đang sống.
   - Tab acquisition ở Integration có worker đang sống.
   - Copilot stream đang chạy.
   Chuyển tab hoặc gập panel không được huỷ các tiến trình này ngoài ý muốn. Dùng `forceMount` hoặc giữ nguyên instance.
4. **URL làm nguồn sự thật.** `?tab=`/`?flyout=` phải sống sót khi F5 và khi bấm back. Deep-link cũ phải còn chạy: `?filter=pending` của Đợt 1 Task 2, link từ Hub.
5. **Vai trò.**
   - Operator: chỉ thấy màn giám sát chỉ đọc (doc 81 §1.4), không lộ công cụ soạn.
   - Supervisor: chế độ "Đơn giản" của sidebar không được trống; Hub mở ra đúng hộp việc.

---

## Task 1: Thiết bị đo layout + đường cơ sở (MSA trước khi sửa)

Tệp: `scripts/ui-metrics/engineeringLayout.mjs` (mới) và `scripts/ui-metrics/README.md`.

Yêu cầu:
- Script Playwright chạy trên một instance tự dựng từ mã nguồn, ở cổng riêng, dùng DB `_test` và tắt tích hợp ra ngoài theo đúng quy tắc của Đợt 1 Task 6/8. Không dùng :3000, vì :3000 chạy `dist` cũ nên không phản ánh mã đang sửa.
- Script đăng nhập bằng user thử trong `_test`, đo 14 màn ở hai kích thước 1600×950 và 1366×768 (thêm biến thể "mở panel Copilot" cho IDE/IR/POU), và xuất JSON gồm:
  - vùng MAIN (selector `[data-layout-main]`; trước khi có attribute này thì dùng selector đo của FE1) chiếm bao nhiêu % khung đầu;
  - chiều cao từ đỉnh viewport tới `h1`;
  - số breadcrumb;
  - số banner phía trước MAIN;
  - chiều cao dải KPI;
  - số Dialog/Sheet đang render, đếm theo `role=dialog` sau khi mở từng hành động có trong một danh sách khai báo;
  - vùng bị dock/bubble AI che;
  - chiều cao trang / chiều cao viewport.
- Đo đường cơ sở, lưu `docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/baseline.json`, rồi đối chiếu với FE1 (phải khớp trong ±5 %; lệch thì giải thích).
- **MSA:** chạy 2 lần liên tiếp và chứng minh số ổn định. Thêm attribute `data-layout-main` vào MAIN của từng trang ở các task sau. Script phải báo rõ trang nào chưa có attribute, thay vì im lặng dùng selector cũ.

Nghiệm thu: baseline.json được commit. README hướng dẫn chạy. Kết quả 2 lần chạy lệch <2 %. Instance đo đã tắt, cổng đã trả.

## Task 2: Shell — một breadcrumb, bỏ padding kép, rail có flyout submenu, chính sách AI một lối vào

Nguồn: FE2 §1, doc 81 §1.3 "Shell". Tệp: `client/src/components/DashboardLayout.tsx`, `ui/sidebar.tsx`/`CascadingNav`, `components/patterns/PageHeader.tsx`, `App.tsx` (AILocalChatBubble, ProgrammingCopilotDock), `ProgrammingCopilotDock.tsx`.

Yêu cầu:
- **Breadcrumb:** chỉ còn một, dời vào top bar (shell). Bỏ prop `breadcrumbs` khỏi `PageHeader` và gỡ khỏi 11 trang đang truyền nó. Trang ngoài module Engineering cũng dùng `PageHeader.breadcrumbs`: grep toàn repo và bảo đảm không trang nào mất điều hướng. Nếu một trang cần nhãn cha riêng thì dùng API của shell (`useBreadcrumbOverride` hoặc tương đương, đặt một chỗ).
- **Padding:** bỏ padding kép giữa shell và trang (mục tiêu +32–48 px). Thêm biến thể trang "full-bleed" cho các layout workbench.
- **Sidebar rail thu gọn:** hiện chỉ còn 2 icon nhóm, mất điều hướng. Hover hoặc bàn phím trên một icon phải mở flyout submenu kiểu VS Code, liệt kê các mục của nhóm. Màn workbench mặc định dùng rail thu gọn, nhưng người dùng vẫn mở rộng được và lựa chọn được nhớ theo người dùng.
- **Chế độ "Đơn giản"** của Supervisor không được trống. Lấy danh sách từ nguồn IA hiện có; grep `useNavMode`.
- **AI một lối vào mỗi ngữ cảnh:**
  - Màn workbench: Copilot là panel phải NẰM TRONG layout (Task 12/13). Dock `position:fixed` và kiểu đẩy `body.style.paddingRight` không còn dùng ở đó.
  - Màn khác: nút AI trên top bar mở sheet phải, Esc đóng.
  - `AILocalChatBubble` không được che nội dung chính và không đè top bar. Nếu vẫn giữ trên màn Engineering thì phải có vị trí và kích thước không che vùng MAIN, đo bằng Task 1.
- **Banner shell** (`PermissionExpiryBanner`, `LicenseEnforcementBanner`, `BetaBanner`): chuyển thành chip 1 dòng kèm popover (dùng `NoticeChip` của Task 3). Nội dung và điều kiện hiện giữ nguyên.

Nghiệm thu:
- Test DOM: mỗi trang Engineering có đúng 1 breadcrumb; rail thu gọn mở submenu bằng chuột và bàn phím; chế độ Đơn giản không trống; banner shell hiện thành chip với cùng điều kiện như trước.
- Đo Task 1: khoảng trước `h1` ≤100 px trên 14 màn.
- Test sẵn có của `DashboardLayout` và `PageHeader` còn xanh.
- Đột biến.

## Task 3: Thành phần dùng chung

Nguồn: doc 81 §1.3 "Thành phần dùng chung", FE2 §4 và §5. Tệp mới đặt dưới `client/src/components/patterns/` và `client/src/components/engineering/shell/`.

Yêu cầu, mỗi thành phần có test DOM riêng:
- `PageHeaderCompact`: tiêu đề, slot `chips`, slot hành động. Không có breadcrumb. Cao ≤48 px.
- `NoticeChip` + Popover, và `NoticeStack`: gộp hint / flag-off / honesty / sim-gate / Beta / "Khi nào dùng" thành chip 1 dòng mở popover. `WhenToUseHint` là atom con và giữ nguyên các khoá i18n riêng từng trang.
- `StatusChipStrip`: dải chip 32 px thay dải thẻ KPI. Mỗi chip mang nguồn số và trạng thái (loading/lỗi/degraded) theo luật trung thực của Đợt 1: không hiện số 0 khi thực chất là lỗi.
- `FlyoutHost` + `useFlyout()`:
  - một stack sheet bên phải cho mỗi trang;
  - `open/close/push`;
  - đồng bộ URL `?flyout=key&flyoutId=…`, F5 và back phải chạy đúng;
  - bẫy focus, Esc đóng từng lớp;
  - hỏi xác nhận khi đóng form còn dữ liệu chưa lưu.
- `DetailSheet` (khung chi tiết có tab) và `WizardDialog` (bước, trạng thái bước, quay lại/tiếp).
- `VersionHistoryPanel` + `JsonDiffView` + `RollbackConfirm`. `RollbackConfirm` dựng trên `ConfirmWithReason` và giữ OTP, độ dài lý do. Thay 4 bản viết lại: Workspace, Recipes, Orchestration, EqIntegration. Ở task này chỉ tạo thành phần; mỗi trang chuyển sang dùng nó ở task của trang đó.
- `ApprovalQueue` / `TransitionDialog`: luồng duyệt/từ chối dùng chung cho ECN và CR của Standards. Giữ maker-checker và lý do bắt buộc khi từ chối.
- `SplitListDetail` (trên `WorkspaceShell`), `CockpitLayout` (slot `StatusChipStrip` + MAIN + panel phụ, trên `TabbedHub`), và `WorkbenchShell`/`EngineeringShell`. `EngineeringShell` có activity bar 40, explorer 240–300, tab editor, inspector 320–420, panel dưới 180–320 (gập được) và thanh trạng thái 24. Kích thước panel được nhớ theo người dùng. Dưới 1024 px chuyển sang tab/stack.
- Mọi layout gắn `data-layout-main` vào vùng MAIN.

Nghiệm thu: test DOM cho từng thành phần (URL sync, focus/Esc, hỏi khi đóng lúc còn dữ liệu chưa lưu, OTP của RollbackConfirm, maker-checker của ApprovalQueue, 4 trạng thái của chip, resize bằng bàn phím); đột biến; Storybook nếu repo có (grep). Chưa trang nào chuyển ở task này.

## Task 4: ECN (P3 danh sách–chi tiết) — trang đầu, rủi ro thấp nhất

Nguồn: doc 81 §1.2 dòng ECN, FE2 §3 EngineeringChanges. Tệp: `client/src/pages/EngineeringChanges.tsx` và test.

Yêu cầu:
- MAIN là danh sách ECN (`DataTable`, phân trang, `FilterBar` đồng bộ URL, giữ `?filter=pending`).
- Chi tiết mở trong `DetailSheet` với các tab Tổng quan / Đối tượng / Duyệt / Nhiệm vụ / Lịch sử, dùng `?flyout=ecn&flyoutId=`.
- Tạo ECN qua flyout. Ký duyệt/từ chối qua `ApprovalQueue`/`TransitionDialog` (giữ mật khẩu/OTP nếu đang có).
- Giữ `engineeringChangesEcnUx.unit.test.ts` xanh.

Nghiệm thu: đo Task 1 (0 banner, 1 breadcrumb, danh sách là MAIN); test luồng flyout (tạo → xuất hiện trong danh sách; duyệt → trạng thái đổi; F5 giữ nguyên chi tiết đang mở); test DOM sẵn có xanh.

## Task 5: Interlock (P3)

Tệp: `client/src/pages/InterlockRuleManagement.tsx` và test.

Yêu cầu:
- MAIN là danh sách rule. Thêm tuỳ chọn xem "ma trận Cause×Effect" nếu dữ liệu đủ; nếu không đủ thì để lại cho đợt sau và ghi rõ.
- Panel dưới "Sự kiện" lọc theo rule đang chọn.
- Tab chuyển sang `TabbedHub`.
- Dialog sửa rule chuyển thành sheet sửa. Giữ cảnh báo "Lưu sẽ tắt rule và cần duyệt lại" (Đợt 1 Task 11) và token phiên bản khi duyệt/bật (Đợt 1 Task 9).
- Dialog test/evaluate chuyển thành flyout công cụ.
- Chip trên header: tư thế engine / OT / độ phủ, lấy từ `oversight.posture`.

Nghiệm thu: đo Task 1; test DOM sẵn có (kể cả cảnh báo sửa rule đã duyệt và token phiên bản) còn xanh; test flyout sửa đầy đủ.

## Task 6: Recipes (P3)

Tệp: `client/src/pages/RecipeManagement.tsx` và test.

Yêu cầu:
- Danh sách mã recipe ở bên trái. Chi tiết gồm các tab Tham số / Phiên bản (`VersionHistoryPanel`) / Duyệt / Triển khai / Máy đang chạy.
- Bộ chọn máy dùng `MachineSelect`, thay card 146 px.
- Tạo phiên bản và duyệt qua sheet. Triển khai nhiều máy qua drawer.
- Giữ `useMemo` phái sinh (FE2: `:270-287`), `?filter=pending` và luật cổng recipe chặt của Đợt 1C (thông báo lỗi `recipeRetired`/`recipeArchived` hiện rõ trong UI).

Nghiệm thu: đo Task 1; test luồng tạo phiên bản / duyệt / triển khai qua flyout; test DOM sẵn có xanh.

## Task 7: Integration (P4 Cockpit)

Tệp: `client/src/pages/EquipmentIntegration.tsx` và test.

Yêu cầu:
- Catalog connector theo dạng danh sách–chi tiết.
- KPI hiển thị bằng `StatusChipStrip`, nhãn phải đúng nghĩa: "đăng ký" khác "kết nối".
- Lịch sử phiên bản recipe dùng `VersionHistoryPanel`. Theo doc 81 §1.2, phần "phiên bản recipe/lịch sử nạp" chuyển sang Recipes và phần "worker thu ảnh" chuyển sang Vision. Nếu việc chuyển đòi route hay IA mới vượt phạm vi bố cục, thì giữ ở chỗ cũ, đặt liên kết sang nơi mới, và ghi rõ.
- Tab acquisition có worker đang chạy: không được unmount khi đổi tab.

Nghiệm thu: đo Task 1; test đổi tab không unmount worker; test DOM sẵn có xanh.

## Task 8: Safety (P4)

Tệp: `client/src/pages/SafetyWorkforce.tsx` và test.

Yêu cầu:
- MAIN là luồng sự kiện cùng bảng tin advisory. Panel phụ gồm xu hướng và phối hợp.
- Chip "Tư vấn — không phải SIS ⓘ" thay khối 88 px. Panel nguồn an toàn (Đợt 1 Task 4 / Đợt 1C) giữ đủ nội dung, có thể thu gọn thành chip mở popover.
- Bảng nhân lực chuyển sang Sản xuất›Ca theo doc 80/81. Nếu trang đích chưa có, để liên kết và ghi rõ.
- Tab collaboration có state-machine `phase` đang sống: không được unmount giữa chừng.

Nghiệm thu: đo Task 1; test không unmount; test DOM sẵn có (`.dom.test`) được cập nhật selector và vẫn xanh.

## Task 9: Standards (P3/P4)

Tệp: `client/src/pages/EquipmentStandards.tsx` và test.

Yêu cầu:
- Cây kiểu thiết bị cùng chi tiết.
- Ánh xạ cảnh báo dùng `DataTable` phân trang/ảo hoá, để trang cao ≤1,5× màn (hiện là 8,3×).
- KPI hiển thị bằng chip có ghi nguồn. Chattering vẫn "chưa đo được". Shelve vẫn khoá.
- CR dùng chung `ApprovalQueue` với ECN.
- Sheet chuẩn hoá cảnh báo.

Nghiệm thu: đo Task 1 (chiều cao trang); test DOM sẵn có xanh; test phân trang.

## Task 10: Fleet (P4)

Tệp: `client/src/pages/FleetOrchestration.tsx` và test.

Yêu cầu:
- MAIN là bản đồ cùng các vùng. Tab phải gồm Tác vụ / Vùng / Sạc / Tài nguyên.
- 7 Dialog chuyển thành flyout sổ đăng ký (operation, resource, charger, …).
- 9 KPI gộp thành một dải chip.
- Giữ chặn chéo nhà máy (Đợt 0/1) và nhãn provenance.
- Doc 80 xếp Fleet vào "Labs": ở task này chỉ đổi bố cục. Việc dời route sang Labs là task IA riêng, cần xác nhận.

Nghiệm thu: đo Task 1; test từng flyout sổ đăng ký (mở → lưu → danh sách cập nhật); test DOM sẵn có xanh.

## Task 11: Orchestration (P2 Canvas designer)

Tệp: `client/src/pages/OrchestrationStudio.tsx` và test.

Yêu cầu:
- Palette/Library bên trái, canvas là MAIN, Inspector bên phải, panel dưới gồm Runs / Chờ duyệt / Vấn đề.
- Trợ lý AI điều phối mở trong sheet 420.
- Lịch sử phiên bản dùng `VersionHistoryPanel` cùng `RollbackConfirm`, giữ ConfirmWithReason + OTP.
- Tiêu đề sửa tại chỗ.
- Giữ nhãn DRY-RUN / "chưa xác nhận", token `expectedStepId` khi resume và toast i18n cho run bị từ chối vì là "draft".

Nghiệm thu: đo Task 1 (canvas ≥45 % @1600); test rollback còn đòi OTP; test DOM sẵn có xanh.

## Task 12: IDE — nâng state lên Context/reducer (chưa đổi giao diện)

Nguồn: FE2 §3 EngineeringWorkspace, khoảng 40 `useState` (`:225-585`). Tệp: `client/src/pages/EngineeringWorkspace.tsx` và `client/src/components/engineering/workspace/*` (mới).

Yêu cầu:
- Chuyển state sang `WorkspaceContext` với reducer thuần. Có test unit cho reducer, đặc biệt chuỗi reset khi đổi `projectId` (artifact / build / simResult / diagnostics).
- Giao diện giữ byte-identical về DOM (snapshot nếu phù hợp).
- Các luồng hiện có phải còn chạy y nguyên: duyệt phiên bản (Đợt 1 Task 5), deployPreview, Copilot stream/Huỷ, FeatureStatusGate.

Nghiệm thu: test reducer; test DOM sẵn có của Workspace xanh không đổi khẳng định; đột biến trên chuỗi reset.

## Task 13: IDE — P1 Workbench

Tệp: `EngineeringWorkspace.tsx` và `EngineeringShell`.

Yêu cầu, theo sơ đồ doc 81 §1.3:
- Top bar 40 px gồm: dự án/phiên bản, các hành động Kiểm/Build/Mô phỏng/Deploy, pipeline chips, trạng thái review.
- Explorer gồm Dự án / Phiên bản / Tags-IO / Deploy.
- Tab editor gồm nguồn, Δ diff, Tags.
- Inspector/Copilot bên phải: Copilot là panel trong layout, dùng chung lõi `CopilotPanel`.
- Panel dưới gồm Vấn đề / Build-Mô phỏng / Lịch sử deploy / Ma trận máy×version.
- Thanh trạng thái hiện Ln/Col, adapter và "Triển khai thật: ON/OFF" (nhãn i18n, không tên biến môi trường).
- Deploy wizard 4 bước (gồm canary) dùng `WizardDialog`. `deployPreview` hiện trước OTP.
- Bỏ card "Trợ lý Lập trình AI" (lối vào AI thứ 3).

Nghiệm thu:
- Đo Task 1: editor ≥45 % @1600 và ≥40 % @1366, kể cả khi mở Copilot; Copilot che 0 px.
- Test DOM: wizard deploy (preview trước OTP), Copilot Huỷ, duyệt phiên bản.
- Test DOM sẵn có xanh.

## Task 14: IR Editor + POU Studio (P1/P2)

Tệp: `client/src/pages/IrEditor.tsx`, `client/src/pages/PouStudio.tsx` và test.

Yêu cầu:
- IR: `grid-cols-12` cố định chuyển sang `EngineeringShell`. Canvas cao hết màn, ≥60 % ngang. Palette trái gập được. Inspector/Transpile bên phải. Explorer chứa các luồng đã lưu và khối hàm. Diff/Merge thành tab editor.
- POU: làm tương tự. Thêm Explorer "Mở".
- Chip "Xem trước — không deploy" và KPI chuyển lên thanh trạng thái.
- Giữ lint IR có thông báo lỗi dịch qua `mapTrpcError` và POST cho input lớn (Đợt 1 Task 6).

Nghiệm thu: đo Task 1 (canvas ≥50 % @1600); test DOM sẵn có xanh.

## Task 15: Gộp Hub/Studio; Copilot thành chế độ scratch của IDE; vai trò

Tệp: `client/src/pages/EngineeringHub.tsx`, `EngineeringStudioHub.tsx`, `ProgrammingCopilot.tsx`, IA/route (grep `GROUPS`, route map).

Yêu cầu:
- **Hub (P4):**
  - MAIN là hộp việc (của tôi / toàn module), dùng `PendingReviewStrip` của Đợt 1 Task 2.
  - Panel phụ gồm tư thế an toàn và danh mục công cụ (ô nhỏ 64 px, ghim, gần đây). Studio gộp vào thành chế độ catalog.
  - Route `/engineering/studio` cũ chuyển hướng về Hub.
- **Copilot:** trang riêng chuyển thành chế độ scratch của IDE. Route cũ chuyển hướng giữ nguyên query.
- **Vai trò** (doc 81 §1.4):
  - Operator chỉ thấy các màn giám sát chỉ đọc. Ẩn công cụ soạn khỏi điều hướng; quyền phía server giữ nguyên.
  - Supervisor vào Hub mở ra đúng hộp việc.

Nghiệm thu: test chuyển hướng giữ query; test điều hướng theo vai trò (Operator không thấy mục soạn thảo); đo Task 1.

## Task 16: Đo nghiệm thu toàn module + báo cáo

Tệp: `docs/ECOSYSTEM/81_ENGINEERING_CONTROL_KHAO_SAT_SAU/do-bo-cuc/after.json`, và một mục mới "§8 Kết quả Đợt 2" trong doc 81.

Yêu cầu:
- Chạy thiết bị đo Task 1 trên toàn bộ 14 màn, 2 kích thước, sau đó lập bảng TRƯỚC/SAU cho từng chỉ số và từng màn.
- Màn nào chưa đạt ngưỡng phải ghi thẳng kèm lý do. Không được hạ ngưỡng.
- Chụp ảnh các màn (lưu `.playwright-mcp/`) cho chủ dự án xem.
- Chạy lại toàn bộ test DOM của module.

Nghiệm thu: bảng số có đủ 14 màn × 2 kích thước; mọi ngưỡng đạt hoặc có giải thích; toàn bộ test xanh, chỉ trừ các test đỏ sẵn đã liệt kê.
