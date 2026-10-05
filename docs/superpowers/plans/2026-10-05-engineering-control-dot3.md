# Đợt 3 — Màn đích, hộp việc theo người được giao, Fleet → Labs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Mỗi task là một brief gồm yêu cầu và tiêu chí nghiệm thu; implementer đọc mã tại chỗ. Mọi số liệu bố cục phải đo bằng thước `scripts/ui-metrics/engineeringLayout.mjs`.

**Goal:** Thực hiện các quyết định chủ dự án ngày 2026-10-05 (doc 81 §11 "Đã chốt"):
- dời nội dung về đúng màn: phiên bản recipe và lịch sử nạp sang **Recipes**, worker thu ảnh sang **Vision**, bảng nhân lực sang **Sản xuất › Ca**;
- làm hộp việc **"của tôi"** thật, theo người được giao;
- dời **Fleet sang Labs**.

Mọi hành vi an toàn và nghiệp vụ của Đợt 0–2 phải giữ nguyên.

**Architecture:**
- **Dời màn.** Đây là di chuyển giao diện, không đổi dữ liệu.
  - Hai phía dùng cùng procedure và cùng bảng. Ví dụ `equipmentIntegration.*` và `machineRecipe.*` cùng ghi `machine_recipes`; riêng `recipe_load_log` là bảng của phía tích hợp.
  - Route cũ chuyển hướng và giữ nguyên query, theo khuôn `engineeringLegacyRedirects.tsx` của Đợt 2 Task 15.
- **Hộp việc theo người được giao** cần một migration (0363) và một UI giao việc.
  - Thông báo dùng bảng `notifications` có sẵn (`drizzle/schema/system.ts:236`).
  - Quyền duyệt và maker-checker không đổi: được giao việc ≠ được quyền duyệt.
- **Fleet sang Labs** chỉ đổi điều hướng: route mới, route cũ chuyển hướng, có nhóm Labs. Quyền server và giấy phép `MOD_OT_CONTROL` giữ nguyên.

**Tech Stack:** React 19 + Vite + shadcn, wouter, tRPC v11, Drizzle/Postgres, Vitest + testing-library, Playwright (thước đo).

**Spec:**
- Doc 81 §11 (các mục "Đã chốt" 2026-10-04 và 2026-10-05) và §1.2 (MAIN/SUB theo màn).
- Doc 80 §9: dòng QĐ3, "Fleet → Labs; … Equipment Integration giải thể về /recipes, /connectivity, Vision"; cây đích "Labs (ẩn mặc định): Fleet · Collaboration".
- Khảo sát mã 2026-10-05 (số dòng ghi trong từng task).

> Chủ dự án duyệt **viết** plan này ngày 2026-10-05. **Chưa duyệt thực thi.** Ba lựa chọn thiết kế đánh dấu **[QĐ-3a/b/c]** sẽ được hỏi kèm khi duyệt.

## Global Constraints

1. **Giữ nguyên các ràng buộc của Đợt 2.** Toàn bộ Global Constraints 1–10 của `docs/superpowers/plans/2026-09-27-engineering-control-dot2-bo-cuc.md` và mọi ruling R-2-* trong ledger Đợt 2 vẫn áp dụng, riêng các điểm sau:
   - Nhánh dùng chung: commit theo pathspec, không `git add -A`/stash/`checkout --`/reset/rebase/worktree, không push.
   - Không build, không đụng `dist/`, không sửa `.env`, không restart :3000.
   - **Không bao giờ kết nối `aoi_management` (dev)**, trừ khi chủ dự án uỷ quyền rõ ràng việc áp migration.
2. **Migration chỉ có ở Task 4 (0363).**
   - Viết theo khuôn `scripts/apply-migration-0362.mjs`: `--dev-only`, idempotent, `lock_timeout 5s`, kiểm cột, kiểm quyền `avi_app` và ghi sổ.
   - Chỉ áp lên `_test`. Ai áp lên dev do chủ dự án quyết.
3. **Không thêm khả năng tác động (R-2-n).**
   - Mọi mutation dời sang màn mới phải giữ đúng target mỗi lần xác nhận, đúng cổng, đúng xác nhận, đúng payload như ở màn cũ.
   - Không có thao tác hàng loạt.
4. **Không đổi quyền phía server.** Route mới dùng **đúng** guard và giấy phép như chỗ cũ, trừ khi [QĐ-3c] chọn khác.
5. **Route cũ chuyển hướng và giữ query.** Mọi deep link hiện có phải còn chạy, kể cả link từ Hub, `PendingReviewStrip`, `lib/domains.ts` và Control Tower. Mỗi chuyển hướng có test.
6. **Đo và test như Đợt 2:**
   - hiệu chuẩn trước khi đổi (R-2-k) và so với `baseline-sau-shell.json`/`after.json`;
   - TDD gồm đỏ → xanh → đột biến;
   - chuỗi i18n đủ vi/en/zh, không chứa tên biến môi trường;
   - census là dụng cụ đo, không né.
7. Commit message không dấu, kết thúc bằng "(doc 81 dot 3 task N)" và trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **Dời màn mất hành vi.** Mutation dời sang chỗ mới phải giữ invalidation, validation và thông báo lỗi `recipeRetired`/`recipeArchived`. Worker thu ảnh có `keepMounted`, không được unmount khi đổi tab.
2. **Lối tắt quyền.** Giao việc không được thành cách duyệt hộ hay lách maker-checker. Người được giao mà không có quyền duyệt vẫn bị từ chối. Danh sách "của tôi" không được lộ tên mục mà người xem không có quyền xem; giữ luật "tên chỉ khi có quyền" của `pendingSummary` (`oversightRouter.ts:419-424`).
3. **Mục nghiêm trọng vẫn luôn hiện (R-2-y)** ở mọi phạm vi hộp việc, kể cả "của tôi".
4. **Deep link Fleet** (deadlock từ Hub/strip, `lib/domains.ts:64`) vẫn mở đúng sau khi dời route. Nhóm Labs ẩn mặc định không được làm mất cảnh báo bế tắc trên Hub.
5. **Gate khác nhau ở Vision:** khu Vision dùng `MOD_AI`, worker dùng quyền machine-alerts cộng cờ `LIVE_ACQUISITION_ENABLED` [QĐ-3c]. Không ai được mất quyền truy cập ngoài ý muốn.

---

## Task 1: Recipes nhận "Phiên bản (tích hợp)" và "Lịch sử nạp"; Integration bỏ hai tab đó

Nguồn: khảo sát A.
- `EquipmentIntegration.tsx`: `?tab=` khai ở `:128`, mảng `TABS` ở `:199-204`, `RecipesTab` ở `:1005`, `HistoryTab` ở `:1121`; mutation ở `:304-320`; link `/recipes?code=` ở `:688-690`.
- `RecipeManagement.tsx`: `DETAIL_TABS` ở `:114`, `?filter=pending` ở `:229`, `?machineId=` ở `:372`, genealogy ở `:253`.

Yêu cầu:
- Thêm tab **Lịch sử nạp** vào Recipes. Tab này lấy theo mã (`listCodeHistory`) và theo máy (`listLoadHistory`), dùng chung `VersionHistoryPanel`/`DataTable`.
- Thao tác "ghi nhận nạp" (`recordRecipeLoad`, kể cả nhánh `deploy:true`) dời theo, giữ **nguyên** target, xác nhận và cổng của màn Integration (R-2-n). Tách hai nhánh `deploy:true` và `false` thành hai thao tác rõ ràng nếu màn cũ đã tách.
- Thao tác phiên bản của Integration (create/release/archive/rollback): nếu trùng chức năng với thao tác Recipes đang có thì dùng một bộ, không hiện hai nút cùng làm một việc. Ghi rõ ánh xạ cũ → mới trong báo cáo. Rollback giữ hợp đồng cũ (không lý do, không OTP; R-2-g).
- Integration bỏ tab `recipes` và `history`. `?tab=recipes|history` chuyển hướng sang `/recipes?tab=…`, giữ `?code=`/`?machineId=`.
- `?filter=pending` của Recipes và cổng recipe chặt Đợt 1C giữ nguyên.

Nghiệm thu:
- Test luồng mới: ghi nhận nạp → lịch sử cập nhật; lỗi `recipeArchived` hiện rõ.
- Test chuyển hướng giữ query.
- Test sẵn có của hai trang xanh, chỉ đổi selector và liệt kê chỗ đổi.
- Đo Recipes và Integration TRƯỚC/SAU.

## Task 2: Vision › Thu ảnh — trang riêng cho worker thu ảnh

Nguồn: khảo sát B.
- `AcquisitionTab` ở `EquipmentIntegration.tsx:1203` (`keepMounted` `:204`), `AcquisitionWorkersPanel` ở `:1219`, `StartAcquisitionWorkerForm` ở `:478`.
- Procedure `visionAdapter.*` ở `:325`, `:1226-1242`.
- Gate hiện tại: quyền machine-alerts (`:1260`) cộng cờ `LIVE_ACQUISITION_ENABLED` (`:748`).
- Khu Vision: section `visionLab` trong nhóm `ai` (`navigation.tsx:1642-1697`), `MOD_AI` (`App.tsx:711`).

Yêu cầu:
- Route mới (ví dụ `/vision/acquisition`), nằm trong section `visionLab` của menu. Dùng mẫu P4 Cockpit (StatusChipStrip có ghim nếu có số cảnh báo) và CockpitLayout.
- Gate theo **[QĐ-3c]**. Mặc định đề xuất: giữ đúng gate cũ là quyền machine-alerts cộng cờ, không thêm `MOD_AI`.
- Worker giữ `keepMounted`, không unmount khi đổi tab hay đổi cỡ (Review Focus #3 Đợt 2). Poll chỉ khi đang hiển thị (khuôn Đợt 2 Task 7).
- Integration bỏ tab `acquisition`. `?tab=acquisition` chuyển hướng sang route mới, giữ query.
- Start/stop worker: đúng target, xác nhận và cổng như cũ (R-2-n).

Nghiệm thu:
- Test không unmount (đếm mount).
- Test chuyển hướng.
- Test điều hướng theo vai trò: ai thấy mục này trước thì vẫn thấy.
- Đo trang mới; thêm màn mới vào thước (khuôn R-2-x).

## Task 3: Sản xuất › Ca — trang nhân lực theo ca

Nguồn: khảo sát C.
- `WorkforceTab` ở `SafetyWorkforce.tsx:1156`, `WorkforceToolbar` ở `:1123`.
- Procedure `safety.currentBoard/listAssignments/listCollaborations/status` và mutation `assignOperator/reassignOperator/confirmAssignment/closeAssignment/startCollaboration` (`:315-440`).
- Bảng `operator_assignments` (có `shiftConfigId` trỏ `shift_configs`).
- Nhóm menu `production` ở `navigation.tsx:326`.
- Guard Safety hiện tại: `machine_status` (`App.tsx:583`).

Yêu cầu:
- Route mới (ví dụ `/production/shifts`) trong nhóm Sản xuất. Mẫu P3: danh sách phân công theo ca làm MAIN, chi tiết trong flyout. Lọc theo ca (`shift_configs`).
- Guard giống chỗ cũ (`machine_status`) và cờ workforce giống chỗ cũ.
- Mutation phân công giữ đúng target, xác nhận và cổng (R-2-n).
- Safety bỏ tab `workforce`. `?tab=workforce` chuyển hướng, giữ query.
- **Phối hợp người–robot (collaboration) ở lại Safety.** Không dời trong đợt này, vì doc 80 xếp Collaboration vào Labs và việc đó cần quyết riêng.

Nghiệm thu:
- Test luồng phân công qua flyout.
- Test chuyển hướng.
- Test Safety sẵn có xanh (máy trạng thái `phase` của collaboration không bị ảnh hưởng).
- Đo trang mới và Safety SAU.

## Task 4: Hộp việc "của tôi" theo người được giao (migration 0363)

Nguồn: khảo sát D.
- `oversight.pendingSummary` ở `oversightRouter.ts:408`. Các nhóm: ECN `:297`, changeover `:325`, recipes `:111/:134`, interlock `:167/:190`, orchestration `:218`, safety `:248`, deadlocks `:279`.
- Chưa có cột assignee trên thực thể Kỹ thuật nào. Bảng `notifications` đã có.

Yêu cầu:
- **[QĐ-3a] Cách lưu.** Đề xuất: bảng chung `engineering_assignments` gồm `entity_type`, `entity_id`, `assignee_user_id`, `assigned_by`, `assigned_at`, `note`, `active`, có index `(assignee_user_id, active)` và ràng buộc mỗi mục tối đa một phân công active.
  - Phương án khác: thêm cột `assignee_id` vào từng bảng (ECN, recipe, interlock, changeover, orchestration run).
  - Áp dụng cho các nhóm **chờ duyệt**: ECN, changeover, recipe draft, interlock rule, orchestration held run, và CR của Standards nếu có trong strip.
- **Giao việc:**
  - Procedure `engineering.assign({entityType, entityId, assigneeUserId, note?})` và `unassign`.
  - Người giao phải có quyền sửa/duyệt thực thể đó. Người được giao phải tồn tại, đang hoạt động và có quyền **xem** trang đích.
  - Ghi audit (control_audit_log hoặc audit_logs) và một dòng `notifications` cho người được giao, với `actionUrl` là deep link.
  - Phạm vi tenant/nhà máy giữ như thực thể.
- **Không đổi quyền duyệt.** Approve/reject vẫn kiểm quyền và maker-checker như cũ. Test: người được giao không có quyền duyệt bấm duyệt ⇒ bị từ chối; tác giả tự giao cho mình ⇒ vẫn không duyệt được.
- **UI:**
  - Bộ chọn "Giao cho" (EntityPicker người dùng) trong các sheet chi tiết: ECN DetailSheet, tab Duyệt của Recipes, sheet rule của Interlock, changeover, run đang giữ của Orchestration.
  - Cột "Người được giao" trong danh sách.
  - Hub có 3 phạm vi: **Của tôi** (giao cho tôi), **Chờ duyệt (tôi có quyền)** (phạm vi hiện tại, đổi nhãn) và **Toàn module**. Mục nghiêm trọng luôn ghim (R-2-y).
  - Chuông thông báo hiện việc mới được giao nếu app đã có chuông đọc `notifications`; nếu chưa có thì ghi rõ trong báo cáo, không tự làm chuông mới.
- `pendingSummary` có thêm phạm vi `mine`, giữ luật "tên chỉ khi có quyền xem".

Nghiệm thu:
- Migration 0363 kèm script apply, đã áp `_test`.
- Test server trên `_test`: giao/bỏ giao kèm audit và notification; phạm vi `mine` đúng người; không lộ tên mục không có quyền; giao không cấp quyền duyệt; phân công lặp bị chặn.
- Test DOM: bộ chọn giao việc và 3 phạm vi Hub.
- Đột biến từng lớp.
- Đo Hub.

## Task 5: Fleet → Labs

Nguồn: khảo sát E.
- Fleet ở `navigation.tsx:1137-1146` (nhóm `engineering`, `beta: true`), route ở `App.tsx:581`, server gate `MOD_OT_CONTROL` (`fleetRouter.ts:28`).
- Chưa có nhóm Labs. Doc 80 ghi "Labs (ẩn mặc định): Fleet · Collaboration".
- Deep link: `PendingReviewStrip.tsx:77`, `EngineeringHub.tsx:108`, `lib/domains.ts:64`.

Yêu cầu:
- Tạo section hoặc nhóm **Labs** trong menu Kỹ thuật, có nhãn "Labs — thử nghiệm". Hiển thị theo **[QĐ-3b]**: đề xuất ẩn mặc định, mỗi người tự bật "Hiện Labs" (lưu theo người dùng); mục Labs vẫn tìm được qua ⌘K.
- Route mới `/labs/fleet-orchestration`. Route cũ `/fleet-orchestration` chuyển hướng, giữ query (`?filter=deadlock`, `?tab=`).
- Cập nhật mọi deep link sang route mới; chuyển hướng là lưới an toàn.
- Guard, quyền và giấy phép **giữ nguyên**.
- **Cảnh báo bế tắc trên Hub vẫn luôn hiện** (R-2-y) và link vẫn mở được Fleet, kể cả khi Labs đang ẩn trong menu.
- Thước đo: màn `fleet` đổi URL theo khuôn alias R-2-x.

Nghiệm thu:
- Test chuyển hướng giữ query.
- Test Labs ẩn/hiện theo người dùng.
- Test deep link deadlock từ Hub.
- Test nav/route-guard toàn app (R-2-w) vẫn xanh.

## Task 6: Đo nghiệm thu + báo cáo

- Chạy thước trên toàn bộ màn Kỹ thuật cộng các màn mới (Vision › Thu ảnh, Sản xuất › Ca), 2 kích thước, 2 lần (MSA cộng `--mutation`).
- Lập bảng TRƯỚC/SAU.
- Chạy toàn bộ test DOM của module và các census.
- Viết **doc 81 §12 "Kết quả Đợt 3"**. Phần "Cần chủ dự án quyết" để controller điền.
- Ghi lệnh áp migration 0363 lên dev.

---

## Lựa chọn hỏi chủ dự án khi duyệt plan
- **[QĐ-3a] Lưu người được giao:** bảng chung `engineering_assignments` (đề xuất: một migration, mở rộng dễ, không đụng bảng nghiệp vụ) hay cột `assignee_id` trên từng bảng.
- **[QĐ-3b] Labs hiển thị:** ẩn mặc định, mỗi người tự bật (theo doc 80; đề xuất) hay hiện luôn kèm nhãn "Labs".
- **[QĐ-3c] Gate trang Vision › Thu ảnh:** giữ gate cũ là quyền machine-alerts cộng cờ, không thêm `MOD_AI` (đề xuất, không ai mất quyền), hay theo khu Vision là thêm `MOD_AI`.
