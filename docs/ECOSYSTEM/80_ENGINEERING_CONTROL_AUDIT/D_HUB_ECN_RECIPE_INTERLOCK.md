# Phụ lục D — Hub · Studio · ECN · Recipes · Interlock

> Thuộc doc 80. 2026-09-25 · HEAD `84f12c7d5` · pha PLAN. DB đọc bằng `avi_app` trong `BEGIN READ ONLY … ROLLBACK`; API engineer1 (id 51), chỉ query GET.
> Số thô (ngoài repo): scratchpad phiên `D-hub-ecn-recipe-interlock/` — `db-probe.json`, `api-probe.json`, `perm-probe.mjs`, `i18n-check.mjs`.

| Trang | Chức năng | Bố cục | So đối thủ | Backend | DB | Hiệu năng | **TB** |
|---|---|---|---|---|---|---|---|
| Hub `/engineering-home` | 6 | 7 | 6 | 6 | 7 | 8 | **6,7** |
| Studio `/engineering-studio` | 4 | 5 | 4 | – | – | 9 | **5,5** |
| ECN `/engineering-changes` | 4 | 5,5 | 3 | 4,5 | 5 | 6 | **4,7** |
| Recipes `/recipes` | 5,5 | 5,5 | 4 | 6 | 5,5 | 6 | **5,4** |
| Interlock `/interlock-rules` | 4,5 | 5 | 3 | 5 | 5 | 7 | **4,9** |

## 0. Bối cảnh đo

Quyền engineer1: `machine_control` V/C/E; `interlock` **chỉ xem**; `machine_status` V/C/E. Cờ: `AUTH_2FA_BAT_BUOC=0`, `ACTUATION_STEPUP_2FA=true`, **`OT_CONTROL_ENABLED=true`**, `TENANT_RLS_ENABLED=true`; **vắng** `INTERLOCK_ENGINE_ENABLED`, `INTERLOCK_AUTO_BLOCK_ENABLED`, `RECIPE_TYPED_SCHEMA_MODE`, `CONFIG_SYNC_GENERIC_ENABLED`, `LICENSE_MODULE_GATE_ENABLED`. 4 tài khoản thử đều `two_factor_enabled=false`.

| Bảng | Dòng | Ghi chú |
|---|---|---|
| engineering_changes | 3 | nháp / đang xem xét / đã duyệt; ECN-0001 người xem xét = người duyệt |
| engineering_change_items | 4 | **không màn nào hiển thị** |
| machine_recipes | 5 (4 mã) | |
| recipe_deployments | 3 | |
| recipe_sets | 0 | có schema, không UI |
| parameter_guardrails | 0 | |
| interlock_rules | 1 | người tạo = người duyệt |
| interlock_events | 3 | cuối 2026-07-16 |
| control_audit_log | 1 | 0 dòng cho interlock |
| machines | **1 700** | mã QATD-* (dữ liệu thử tải) |

API p50 15–46 ms cho mọi query. `productModel.list` **340 KB cho 5 sản phẩm** (chỉ để đổ dropdown ECN); `machines.list` **1 700 máy / 140 KB** vào 2 Select không tìm kiếm. Cổng interlock chạy 0,06 ms. Múi giờ: DB `Etc/UTC`, API trả đúng UTC ⇒ 5 trang này không dính lệch −7 h.

## 1. Đối chiếu phân quyền

- `/engineering-home`: nav `machine_control` (`navigation.tsx:1019`) nhưng docblock `:1008-1009` ghi "tối thiểu machine_monitoring" (comment trôi). Server `pendingSummary` chỉ cần `machine_monitoring` (`oversightRouter.ts:66`) ⇒ operator gọi thẳng API đọc được tên mục chờ duyệt (P3).
- Ô Hub trỏ tới `/ir-editor`, `/pou-studio`, `/fleet-orchestration`: nav `machine_status` nhưng route `machine_control`. Hub lấy quyền từ nav (`EngineeringHub.tsx:128-143`), Studio lấy từ route ⇒ ô báo "mở được" nhưng bị chặn.
- Studio **ẩn** ô thiếu quyền, Hub **hiện-nhưng-khoá** — ngược triết lý.
- ECN: client gate `machine_control` (`EngineeringChanges.tsx:135-137`); server `create/list/getById/getItems` = `moduleProcedure("MOD_ENGINEERING")`, cờ license tắt ⇒ **ai đăng nhập cũng gọi được**; `transition` = `roleProcedure(...)`, không `require2FA`, không kiểm bit quyền. QA được server cho duyệt nhưng UI khoá.
- Recipes: approve/deploy/rollback = `actuationProcedure` (2FA tài khoản, **không OTP bước**); `archive/setGolden` không giới hạn vai (`machineRecipeRouter.ts:325-438`). Program deploy đã lên `deployProcedure` từ doc 54, recipe thì chưa.
- Interlock: nhất quán; duyệt = `adminProcedure`.

## 2. Engineering Hub

Hiện trạng: PageHeader → banner "luồng vàng" (chữ tĩnh) → `PendingReviewStrip` 5 thẻ → 6 nhóm, 17 ô. Quan sát live: hai breadcrumb chồng nhau (thanh trên + trong trang).

- **HUB-01 P1 — báo xanh giả:** nhánh lỗi trả 0 (`oversightRouter.ts:67-79`); client hiện "Không có gì chờ duyệt" khi tổng 0 mà không xét `degraded` (`PendingReviewStrip.tsx:89-94`).
- **HUB-02 P1 — thiếu nguồn:** không đếm ECN chờ duyệt, changeover, sự kiện interlock mở, máy lệch recipe, recipe đang chạy mà chưa duyệt. Đo: `total=1` trong khi ECN-0003 đang xem xét; SCRW-RECIPE-01 v2 active, chưa duyệt, `in_sync` trên máy 243 mà không đếm vào đâu.
- **HUB-03 P2:** link `?filter=pending` bị bỏ qua (`/recipes` chỉ đọc `machineId`; `/interlock-rules` không đọc query).
- **HUB-04 P2:** Hub không có ô ECN; ô khoá theo nav, lệch route.
- **HUB-05 P3:** "luồng vàng" là chữ, không số sống. **HUB-06 P3:** `pendingSummary` 10 truy vấn tuần tự (46 ms).

## 3. Engineering Studio

**STU-01 P2:** 15 ô, trùng 12 ô với Hub; hai tiêu đề cho cùng nhóm ("Trung tâm Kỹ thuật" / "Xưởng kỹ thuật"), cả hai trong sidebar; Studio không PageHeader/breadcrumb/dải chờ duyệt. **STU-02 P3:** 11 nhãn tiếng Anh cứng ("Programming Copilot", "Engineering change notice"…). **STU-03 P3:** icon trùng Recipes.
**Khuyến nghị:** gộp vào Hub (tab "Danh mục"); `/engineering-studio` → redirect `/engineering-home?view=catalog`; gỡ mục sidebar.

## 4. ECN

Hiện trạng: nút tạo (Dialog) → lọc trạng thái/loại (đồng bộ URL) → bảng 6 cột → Dialog chi tiết. Máy trạng thái server (`ecnService.ts:183-202`): draft → submitted/closed; submitted → in_review/rejected/closed; in_review → approved/rejected/closed; approved → implemented/rejected/closed. SoD chỉ kiểm người yêu cầu ≠ người duyệt. Quan sát live: bảng trần 3 dòng seed, không tìm kiếm, nút Phê duyệt/Từ chối ngay trên hàng.

- **ECN-01 P1 — không liên kết đối tượng:** UI chỉ gửi `title/type/productModelId/target/reason/notes/effectivity` (`EngineeringChanges.tsx:193-201`) dù server nhận `bomId/recipeId/programId/items` (`ecnRouter.ts:72-82`); không nơi nào gọi `getItems`; không service nào ngoài PLM đọc ECN ⇒ **deploy không cần ECN**.
- **ECN-02 P1:** phân quyền như §1; comment "2FA" ở `ecnRouter.ts:36` sai.
- **ECN-03 P1 — race:** đọc rồi `UPDATE … WHERE id` không kiểm trạng thái cũ/version (`ecnService.ts:218-273`).
- **ECN-04 P1 — mất dấu:** từ chối ghi đè `reviewedBy/At` (`:254-258`), `decisionComment` bị ghi đè (`:232`); không bảng lịch sử, không `control_audit_log`.
- **ECN-05 P1:** người xem xét có thể trùng người duyệt (có trong DB); người yêu cầu tự đánh dấu triển khai và đóng; duyệt một click, không xác nhận, không ý kiến bắt buộc, không chữ ký (`:371-381`).
- **ECN-06 P2:** thiếu sửa/huỷ nháp, nhân bản, đính kèm, thảo luận, tìm kiếm, phân trang (lấy 200 lọc client), export; query lỗi ⇒ hiện "Chưa có thay đổi…".
- **ECN-07 P2:** panel backfill componentCode không liên quan nằm trên trang ECN, nút Áp dụng không xác nhận, thiếu key i18n.
- **ECN-08 P2:** 340 KB cho dropdown 5 sản phẩm; kỹ sư thấy "Người dùng #51".
- **ECN-09 P3:** `ecnKey` hex ngẫu nhiên; va chạm unique ⇒ 500.
- **ECN-10 P2:** PLM connector ghi đè `status` theo `ecnKey` (`plmConnector.ts:326-339`), lách vòng duyệt (cờ PLM đang tắt).

So với Teamcenter / Windchill / Arena: thiếu CR → CN → task; đối tượng bị ảnh hưởng có revision trước/sau, redline BOM; tuyến duyệt nhiều người (CCB); chữ ký điện tử (21 CFR Part 11); hiệu lực theo serial/lô; lịch sử bất biến, thảo luận, theo dõi quá hạn.

## 5. Recipes

Hiện trạng: PageHeader → banner HITL → "Xem theo máy" → danh sách mã | bảng phiên bản + LineDiff + genealogy → sổ triển khai → 5 dialog. Trạng thái loading/lỗi/rỗng đầy đủ — **trang làm tốt nhất cụm**. Deploy chạy trong TX + `FOR UPDATE` (`machineRecipe.ts:215-282`). Quan sát live: banner "Để ĐẨY recipe xuống máy thật, dùng luồng HITL trong AI Copilot" (quy trình vận hành phụ thuộc AI Copilot); cột "Người triển khai" hiện số `1`; tiêu đề cột bị cắt "Đang dùn".

- **RCP-01 P1 — kiểm kiểu/giới hạn tham số (doc 56 Đ4) không bao giờ chạy từ UI:** UI không gửi `machineType`; `RECIPE_TYPED_SCHEMA_MODE` tắt; guardrail 0 hàng; AOI/SPI/AVI không có schema; router thiếu `WELDER` dù có 77 máy; mẫu JSON UI (`:76-92`) không khớp khoá payload thật.
- **RCP-02 P1 — một phiên bản active cho cả nhà máy:** `uq_machine_recipes_active_code` + `set machineId` khi deploy (`machineRecipe.ts:222-240`) ⇒ deploy sang máy B "gỡ" recipe khỏi máy A trong catalog.
- **RCP-03 P1 — rollback sai hàng:** nút Rollback trên mỗi hàng sổ (`:720-725`) nhưng server rollback deployment **mới nhất** của máy (`machineRecipe.ts:296-304`); chỉ lùi 1 bước; không lý do.
- **RCP-04 P1:** vẫn `actuationProcedure` (docblock `deployProcedure` ghi rõ "recipe", doc 54 §10 G2 đã yêu cầu đổi). Khi bật config-sync, recipe đẩy qua MQTT **không qua `commandDispatcher`** ⇒ không qua cổng interlock.
- **RCP-05 P2:** lưu trữ được bản đang active; deploy được bản đã lưu trữ; không kiểm loại máy (AOI lên SPI được).
- **RCP-06 P2 (dữ liệu):** SCRW-RECIPE-01 v2 active, chưa duyệt, `createdBy` NULL, `in_sync` trên máy 243 ⇒ bất biến "chỉ chạy recipe đã duyệt" đã vỡ trên dữ liệu.
- **RCP-07 P2:** "Phiên bản mới" mở JSON trống, không tạo từ bản cũ; textarea; không cảnh báo khi đóng lúc đang sửa; còn `window.confirm` (`:232`).
- **RCP-08 P2:** 2 Select 1 700 máy; `deployedBy`, `previousRecipeId`, người thực hiện genealogy hiển thị ID trần; nhãn trạng thái tiếng Anh thô.
- **RCP-09 P2:** genealogy 0 dòng; bảng có RLS tenant + lỗi ghi bị nuốt (`machineRecipeRouter.ts:63-72`) ⇒ nguy cơ mất vết im lặng (chưa kiểm bằng lượt ghi thật). `setGolden` không ghi genealogy.
- **RCP-10 P2:** không hiển thị drift từ `machine_config_state`. **RCP-11 P3:** không tìm mã; sổ 100 dòng không phân trang; không import/export; `recipe_sets` (khái niệm ISA-88) 0 dòng, không UI.

So với ISA-88 / FactoryTalk Batch / SIMATIC Batch: thiếu master/control recipe; tham số không có kiểu/đơn vị/min/max; không vòng đời approved-for-test → production → obsolete kèm chữ ký; không triển khai nhiều máy; không verify/readback; không gắn change control.

## 6. Interlock

Hiện trạng: tab Rule | Sự kiện (poll 5 s) → dialog tạo/sửa → dry-run. Rule mới luôn tắt + chưa duyệt; thay đổi ghi `control_audit_log` before/after. Cổng inline `commandDispatcher.ts:668-690` trước mọi lệnh ghi thật `hitl`; lỗi đánh giá ⇒ chặn (`interlockGate.ts:217-220`). Quan sát live: engineer "Chỉ xem" nhưng nút Tắt/Sửa/Xoá vẫn hiện (mờ); ngưỡng hiển thị `gt 20.000000`.

- **ILK-01 P0 — sửa rule đã duyệt & đang bật không mất trạng thái duyệt** (`interlockRouter.ts:121-135`, **đã tự kiểm**: `update` chỉ set patch + `updatedBy`, không reset `approvedBy/enabled`). Người có `canEdit` (không phải admin) đổi được ngưỡng/hành động/máy đích của rule đang sống. Vi phạm MOC (IEC 61511). Giảm nhẹ: có audit before/after.
- **ILK-02 P1:** duyệt không kiểm người tạo/người sửa (`:150-167`); DB có rule tự duyệt.
- **ILK-03 P1:** lý do tắt/xoá chỉ `console.info` (`:422-428, 448-454`); tắt rule an toàn chỉ rủi ro `"low"` (`:420`); `resolveEvent` không audit.
- **ILK-04 P1 — cổng đọc giá trị CŨ:** telemetry lấy N mẫu **cũ nhất** trong cửa sổ (`interlockGate.ts:105-113`). **Tái hiện bằng SELECT chép đúng truy vấn:** cửa sổ 3600 s, cổng thấy 26,79 lúc 14:23, giá trị thật 34,71 lúc 14:58 — trễ 35 phút. Rule theo line/trạm quan sát cả nhà máy; `cpk` không cửa sổ; `compare(null)=false` ⇒ không dữ liệu thì không chặn.
- **ILK-05 P1:** cổng chỉ xét rule có đích (`:161-174`) nhưng form không bắt buộc đích ⇒ rule `stop_line` thiếu đích "đang bật" mà không bao giờ chặn; `commandValue` nhập được nhưng bị bỏ (`:214-235`).
- **ILK-06 P1 (vận hành):** `OT_CONTROL_ENABLED=true` (ghi lệnh thật) mà engine interlock tắt; rule duy nhất chỉ cảnh báo, không đích, cấu hình `telemetry_tag sourceKey="ng_rate"` ⇒ 0 mẫu. **Interlock không chặn lệnh nào, và trang không nói điều này.**
- **ILK-07 P2:** xoá cứng rule; `events.ruleId` không FK ⇒ sự kiện mồ côi; không xem được phiên bản định nghĩa.
- **ILK-08 P2:** enum thô (`lt`, `gt`, `stop_line`); ô nhập ID số cho line/trạm/máy/adapter; bảng không loading/lỗi; nút chỉ-icon không `aria-label`.
- **ILK-09 P3:** giới hạn 1000 rule, rule 1001 bị bỏ im lặng. **ILK-10 P2:** thay đổi và dòng audit không chung TX.

So với Siemens Safety Matrix / Rockwell SIS C&E / Ignition–WinCC: thiếu ma trận Cause × Effect, voting, latch/reset, bypass có hạn + lý do + người duyệt, first-out, trạng thái trực tiếp, MOC có phiên bản, proof-test.

## 7. Thiết kế cải tiến

### 7.1 Hub hợp nhất (thay cả Hub và Studio) — M
Kết cục: 100 % loại việc chờ duyệt có mặt; 0 lần báo xanh khi có nguồn lỗi; 0 ô khoá lệch route; một cửa vào.
```
┌ Trung tâm Kỹ thuật ──────────────────────── [⌘K Tìm công cụ / ECN / recipe] ┐
│ Tư thế: OT ghi ●BẬT · Gate ●BẬT · Engine interlock ○TẮT ⚠ · Config-sync ○TẮT │
│         Rule chặn có đích: 0 · Máy lệch cấu hình: 0                          │
├ Hộp việc [Của tôi|Toàn module] ─────────────────────── cập nhật 12 s ───────┤
│ [ECN chờ duyệt 1 ⏱3d] [Recipe chờ duyệt 0] [Recipe chạy CHƯA duyệt 1 ⛔]      │
│ [Rule chờ duyệt 0] [Changeover 0] [Sự kiện interlock mở 0] [Run chờ 1]        │
│ ⚠ Không đọc được: safety_events — số liệu có thể thiếu                        │
├ Luồng vàng (số sống) ────────────────────────────────────────────────────────┤
│ ECN 3 ▶ Recipe/Program 4 mã ▶ Chờ duyệt 0 ▶ Đã triển khai 3 máy ▶ Lệch 0      │
├ Công cụ [Theo tác vụ | Danh mục A–Z] ☆ ghim · gần đây ────────────────────────┤
└─────────────────────────────────────────────────────────────────────────────┘
```
- Mỗi thẻ: `loading → ok | degraded(nguồn[]) | error`; chỉ hiện "tất cả đã xử lý" khi mọi nguồn `ok` và tổng 0.
- API: `oversight.inbox` (`Promise.all`, mỗi nhánh `{count, mine, oldestAgeHours, degraded, samples}`; thêm ECN, changeover, sự kiện interlock mở, drift, recipe active chưa duyệt; operator chỉ nhận số đếm) + `oversight.posture` (trạng thái cờ + độ phủ interlock).
- Một registry ô duy nhất: thêm `routePermission` vào nav; mọi route nhóm dùng `RouteGuard navHref`; test tĩnh so quyền registry với route. Trang đích phải đọc `?filter=`. Cờ `ENG_HUB_V2`.

### 7.2 ECN v2 (mẫu PLM thu nhỏ cho xưởng) — L
Kết cục: mọi recipe/program khi release truy ngược được về một ECN đã duyệt; 0 bước mất dấu; duyệt cần N người khác vai.
```
┌ Thay đổi kỹ thuật ────────────── [+ Yêu cầu] [CSV] ┐
│ 🔍 [Trạng thái▾][Loại▾][Người yêu cầu▾] ☐Chờ tôi ☐Quá hạn │
├──────────────────────┬───────────────────────────────┤
│ ECN-2026-00042 ●Xét  │ Tăng ngưỡng NG AOI L1           │
│ ECN-2026-00041 ○Nháp │ [Tổng quan][Đối tượng(2)][Duyệt]│
│ …                    │ [Nhiệm vụ][Thảo luận][Tệp][Lịch sử]│
│                      │ SEED-RCP-AOI-L1 v1→v2 [Diff]   │
│                      │ QA ✔ · Kỹ thuật ⏳ · SX ⏳ (2/3) │
│                      │ [Duyệt…][Trả lại…][Từ chối…]    │
└──────────────────────┴───────────────────────────────┘
```
- Máy trạng thái: draft → in_review → approved (đủ phê duyệt) → implementing → implemented → closed; in_review → trả lại (lý do) về draft hoặc rejected → closed; draft → cancelled.
- SoD: người yêu cầu không xem xét/duyệt; mỗi người một vai; người triển khai ≠ người duyệt. Chữ ký điện tử: duyệt/từ chối cần nhập lại mật khẩu hoặc OTP + ý nghĩa chữ ký.
- API: `ecn.listPaged` (tìm/lọc server, "chờ tôi"), `ecn.update` (chỉ nháp), `ecn.cancel`, `ecn.items.add/remove` (`fromRevisionId`/`toRevisionId`), `ecn.transition({expectedStatus, expectedVersion})` lệch ⇒ `CONFLICT`, `ecn.history/comments/attachments`; `requirePermission` mọi thủ tục; OTP bước khi duyệt.
- DB: `version`, `cancelled`, mã theo sequence; bảng `ecn_events` (chỉ-chèn, hash chain), `ecn_approvals` (UNIQUE ecn+người duyệt), `ecn_route_templates`, `ecn_tasks`; `engineering_change_items` + revision trước/sau.
- Cờ `ECN_V2`; `ECN_REQUIRED_FOR_RELEASE = off | warn | enforce` (duyệt recipe/deploy build yêu cầu ECN đã duyệt). PLM không ghi đè ECN đã vào tuyến duyệt; chuyển panel backfill sang Master Data.
- Nghiệm thu: hai lượt duyệt song song ⇒ đúng 1 thành công + 1 `CONFLICT`; operator `create` ⇒ 403; tự duyệt ⇒ 403; mỗi bước đúng 1 dòng sự kiện không UPDATE/DELETE được; enforce: duyệt recipe không ECN ⇒ từ chối; query lỗi ⇒ hiện lỗi, không "rỗng".

### 7.3 Recipes theo ISA-88 — L (XL nếu cả `recipe_sets`)
Kết cục: cùng mã chạy nhiều phiên bản trên nhiều máy; 100 % recipe AOI/SPI/AVI qua kiểm kiểu/giới hạn; 0 deploy sai loại máy; desired/reported/drift cho mọi máy.
```
┌ Recipes ─ 🔍 [Loại máy▾][Trạng thái▾] ───────────────────────────────┐
│ ▸AOI  SEED-RCP-AOI-L1 3v │ v3 Nháp · v2 Phát hành ★ · v1 Lỗi thời   │
│ ▸SPI                     │ [Tham số][So sánh][Máy chạy(74)][Duyệt][Lịch sử] │
│ ▸SCREWDRIVE ⛔1           │ exposureMs 12 ms [5–40]  v2:10 ▲         │
│                          │ ngThreshold 0.62 [0.3–0.9]                │
│                          │ [Gửi duyệt][Tạo từ bản này][Nâng cao: JSON]│
│ Máy chạy: v2×73 · v1×1 · lệch 1 ⚠  AOI-L1-02 drift [Triển khai…]      │
└──────────────────────────────────────────────────────────────────────┘
```
- Drawer triển khai: chọn nhiều máy (tìm kiếm) → preflight từng máy (loại máy, đã phát hành, ECN, cổng interlock, máy idle) → diff với bản đang chạy → lý do + OTP → kết quả từng máy.
- Vòng đời phiên bản: draft → in_review → approved_for_test → released → obsolete. Vòng đời triển khai: requested → notified → acked (in_sync) | drift | failed | superseded | rolled_back.
- DB: `machine_recipe_bindings` (máy là khoá) = nguồn sự thật "máy đang chạy gì"; `recipe_parameter_defs` (loại máy, khoá, đơn vị, kiểu, min, max, mặc định, guardrail; seed AOI/SPI/AVI từ khoá payload thật); `recipe_deployments` + `reason`, `ecnId`, `stepUp`, `batchId`; trigger `BEFORE INSERT` chặn deploy recipe chưa duyệt; đồng bộ enum loại máy (WELDER, IOT_*).
- API: `recipes.createFrom`, `submit`, `approve` (→ `deployProcedure`, lý do + `ecnId`), `release/obsolete`, `deployments.plan/execute` (nhiều máy), `deployments.rollback({machineId, toDeploymentId})`, `machines.search`, `drift.byRecipe`, `schema.forMachineType`; `archive` chặn nếu còn binding; `setGolden` giới hạn vai + genealogy.
- Cờ `RECIPE_BINDING_V2`; `RECIPE_TYPED_SCHEMA_MODE` chạy `log` 2 tuần rồi `enforce` từng loại.
- Nghiệm thu: v1 trên máy 2 + v2 trên máy X cùng lúc; AOI lên SPI ⇒ từ chối; `ngThreshold: 8` ⇒ chặn ở enforce; rollback chọn #N ⇒ về đúng #N; INSERT SQL deploy recipe chưa duyệt ⇒ trigger chặn; tìm trong 1 700 máy <100 ms, <10 KB.

### 7.4 Interlock: ma trận Cause & Effect + MOC — L (vá ngay: S)
Kết cục: 0 cách đổi hành vi rule đang sống mà không duyệt lại; 100 % lần tắt/xoá/bypass có lý do trong sổ WORM; cổng luôn dùng mẫu mới nhất; độ phủ interlock hiển thị và đo được.
```
┌ Interlock & C–E ─ Gate ●BẬT · Engine ○TẮT ⚠ · OT ●BẬT · Phủ 0/1.700 ⚠ ┐
│ [Ma trận][Rule][Sự kiện][Bypass][Thay đổi chờ duyệt]  Line L1▾ 🔍      │
│                     AOI-L1-01  SPI-L1-01  Băng tải L1  Andon          │
│                     stop       reduce     block        alert          │
│ C1 NG>20%/5ph ●OK      S          ·          B           A            │
│ C2 Cpk<1,33 ⚠no-data   ·          R          ·           A            │
│ C3 T>85°C×3 ⛔BYPASS→16:00  S     ·          ·           A            │
└──────────────────────────────────────────────────────────────────────┘
```
- Máy trạng thái: draft → pending_approval → approved_disabled → enabled ↔ disabled (tắt cần lý do). Người duyệt ≠ tác giả và người sửa cuối. Sửa rule đã duyệt ⇒ tạo revision nháp; bản sống giữ nguyên tới khi revision được duyệt + kích hoạt. Bypass cần lý do, thời hạn, người duyệt; retire thay xoá cứng.
- **Vá ngay (không đặt sau cờ, S):** (1) sửa rule đã duyệt ⇒ reset duyệt + tắt rule + audit; (2) duyệt chặn người tạo/sửa; (3) `disable/delete/resolve` nhận `reason` vào sổ audit, tắt rule an toàn = rủi ro `high`; (4) telemetry `ORDER BY ts DESC LIMIT n` rồi đảo mảng; (5) hành động khác `alert` bắt buộc có đích, bỏ hoặc lưu thật `commandValue`; (6) thay đổi + audit chung TX.
- DB (cờ `INTERLOCK_MOC_V2`): `interlock_rule_revisions`, `interlock_bypasses`, `interlock_effects`; cột `onNoData` (`ignore|alert|block`), `retiredAt`; FK `events.ruleId` RESTRICT.
- Cổng: join line/trạm; chính sách `onNoData`; vượt giới hạn rule ⇒ fail-closed + log; tính bypass.
- API: `matrix`, `coverage`, `revise`, `submitRevision`, `approveRevision`, `activateRevision`, `bypass.*`, `events.resolve` (ghi chú + audit), `list` phân trang, `history`.
- Nghiệm thu: sửa rule đang bật không đổi hành vi cổng tới khi revision được duyệt; admin tự duyệt ⇒ 403; tắt không lý do ⇒ 400; 120 mẫu + `windowSize` 50 ⇒ so bằng mẫu mới nhất; rule L1 không đếm dữ liệu L2; cảm biến im 10 phút + `onNoData=block` ⇒ lệnh HITL bị chặn; `stop_line` không đích ⇒ không lưu được.
- Rủi ro: `block` có thể chặn oan khi telemetry gián đoạn ⇒ chạy `alert` trước, đo tỉ lệ thiếu dữ liệu 2 tuần rồi mới `block`.

### 7.5 Thứ tự
Đợt 0 vá an toàn (ILK-01/02/03/04a/05/10, ECN-02/03, HUB-01) S–M → Đợt 1 Hub hợp nhất + RCP-03/04/05/07/08 (M) → Đợt 2 ECN v2 (L) → Đợt 3 Recipe binding/schema/drift/trigger (L) → Đợt 4 Interlock MOC/bypass/C&E/`onNoData` (L).

## 8. Chưa kiểm được
Mutation không chạy (race ECN, reset duyệt interlock, rollback sai hàng, genealogy dưới RLS suy từ mã; riêng ILK-04 tái hiện bằng SELECT; ILK-01 phiên chính tự đọc mã xác nhận); chỉ persona engineer1; chưa bật các cờ interlock/config-sync/typed-schema/license/PLM; 0 tài khoản bật 2FA nên chưa đo OTP bước.
