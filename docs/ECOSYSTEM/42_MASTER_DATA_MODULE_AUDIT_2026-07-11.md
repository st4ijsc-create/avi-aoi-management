# 42 — AUDIT MODULE "QUẢN LÝ DỮ LIỆU" (MASTER DATA) — 2026-07-11

> Audit LIVE bằng Playwright (mở màn hình thật + thao tác CRUD thật trên DB dev) — 14 agent song song: 13 agent surface + 1 agent benchmark (đọc code, so chuẩn ngành).
> Phạm vi: `/master-data` (10 tab, chia 4 agent), `/products`, `/product-onboarding`, `/product-mapping`, `/component-library`, `/operator-badges`, `/layout`, `/workstation-management`, `/process-management`, `/datasettings`.
> Mọi bản ghi test có prefix `AUDIT_` và đã được dọn qua UI (ngoại lệ ghi rõ trong Phụ lục §10).

---

> ## 🔴 ĐỌC TRƯỚC — TRẠNG THÁI THẬT (đưa lên đầu 2026-08-13, nhóm C việc 2)
>
> **Kế hoạch của tài liệu này ĐÃ THỰC THI XONG — Đợt 0 → Đợt 5.** Trạng thái ấy vốn nằm ở
> **§9, dòng ~304/505**, tức sau ba trăm dòng mô tả bug ở **thì hiện tại**. Ai đọc §1 và §3
> ("**Phát hiện P0 (chặn sản xuất)**") rồi dừng lại sẽ kết luận module đang hỏng — và đó
> đúng là cách "2 P0 chặn sản xuất" của doc 42 nằm trong backlog suốt tám tuần.
>
> **Đo lại độc lập trên mã ngày 2026-08-13 — cả hai P0 ĐÃ VÁ:**
>
> | P0 | Đo được hôm nay |
> |---|---|
> | **P0-1** nút "Thêm" `/products` no-op (`PermissionGate` nuốt props Radix `asChild`) | `client/src/components/PermissionGate.tsx:71` `function mergeSlotProps(childProps, slotProps)`, dùng ở `:116` và `:124` — hợp nhất handler `on[A-Z]`/`className`/`style` thay vì trả Fragment trần |
> | **P0-2** UPDATE hỏng 10 tab (`EntityDialog` null vs zod) | Client `MasterDataManagement.tsx` `submit()` chỉ gom key khai trong `fields[]`, `null`/`""` → `undefined`, ép `Number` cho `type==="number"`, khoá ô `code` khi edit. Server `masterDataRouter.ts`: **51 lần `.nullish()`** trên các *update schema* (create schema vẫn `.optional()`) |
>
> **Điểm số §2, findings §3–§5, và §6/§7 (tính năng thiếu / cải tiến FE) là ẢNH CHỤP 2026-07-11.**
> Đọc như *lịch sử*, không phải *hiện trạng*. Bản ghi thực thi đầy đủ theo từng đợt: **§9, khối
> "TRẠNG THÁI THỰC THI"** ngay dưới tiêu đề §9.
>
> **Còn thật (chính doc 42 §9 tự ghi, chưa đo lại lượt này):** SHIFT calendar cần migration schema ·
> nạp locale cho key inline Đợt 4A-4C · gỡ user tạm `audit_agent` (id 167) + 2 hàng `AUDIT_LAYOUT_QA` ·
> bật 2FA cho tài khoản privileged.

---

## 1. Tóm tắt điều hành

Đây là audit sản phẩm lần đầu chạy **live end-to-end** trên module Quản lý dữ liệu: 14 agent (13 surface + 1 benchmark) mở browser thật, đăng nhập admin, test đủ 4 thao tác CRUD trên từng màn hình, chụp ~230 screenshot và đối chiếu code khi tìm root-cause. Kết quả tổng: **208 findings** — trong đó **125 bug** (2 P0 · 40 P1 · 49 P2 · 34 P3) và **83 vấn đề UX** (15 P1 · 36 P2 · 32 P3), kèm 96 đề xuất tính năng thiếu và 91 cải tiến frontend. Điểm UX trung bình 13 màn hình chỉ đạt **4.8/10** (cao nhất operator-badges 6.5, thấp nhất 4.0 cho cụm master-data core và products); benchmark chấm module **5.5/10** so với chuẩn Odoo/SAP MDG — độ phủ thực thể tốt (~7/10) nhưng độ sâu quản trị dữ liệu kém (~4/10).

Năm kết luận đắt nhất:

1. **UPDATE gãy trên diện rộng — lỗi 1 component lan 10 tab.** `EntityDialog` của MasterDataManagement gửi nguyên row DB (chứa cột null) vào mutation, trong khi zod server khai `.optional()` (không `.nullable()`) → **mọi bản ghi tạo từ chính UI này không thể sửa lại**: suppliers/customers (P0, fail 100%), materials/classes/UoM/conversions (fail), calendar/warehouse/location/balance (fail), skills/tools (partial). Fix gốc chỉ ~1 chỗ client + vài dòng zod.
2. **Trùng mã → HTTP 500 + toast in nguyên câu SQL INSERT** (lộ schema DB) lặp ở **9 màn hình** (component-library, workstation, trade-partners, product-mapping, workforce, calendar-inventory, materials-uom, product-onboarding, datasettings). Root-cause chung: `insertOne`/router không bắt unique-violation, hoặc bắt sai shape lỗi Drizzle (code nằm ở `err.cause`, không phải `err.message`) khiến message thân thiện đã viết sẵn thành dead code.
3. **2 P0 chặn nghiệp vụ**: nút "Thêm" ở `/products` hoàn toàn no-op (PermissionGate nuốt props của Radix `DialogTrigger asChild` — không thể tạo sản phẩm từ màn hình chính) và Update suppliers/customers hỏng 100%. Kèm 2 lỗ hổng cấu trúc: `/datasettings` **mất hoàn toàn điều hướng — 11/12 tab chỉ vào được bằng gõ URL tay** (hệ quả kép doc 36 + doc 39), và `getReadiness/getReadinessBatch` 500 mọi lần gọi (SQL `= ANY()` sai — readiness score doc 31 chết runtime, spam 12+ lỗi 500 mỗi lần load /products).
4. **Nghịch lý primitive**: bộ DataTable/FilterBar/FormScaffold/EntityPicker (doc 39 Wave 1) đã xây xong nhưng **0/13 màn hình của module dùng** — mọi trang tự chế bảng thô + form tay, dẫn thẳng đến cụm bug validation/loading/search. Đồng thời không màn nào có tìm kiếm/phân trang server-side (trừ operator-badges và products một phần) — không dùng nổi ở quy mô dữ liệu nhà máy thật.
5. **i18n phá hoại chức năng chứ không chỉ thẩm mỹ**: hàng loạt chuỗi dịch máy/placeholder ("Quản lý máy" cho trang trạm, "Tạo Tiêu đề", "Kéo Thả desc", "Confirm delete title") và **key mất interpolation** khiến toast lỗi toàn hệ hiện "Lỗi với Tin nhắn" (mất `{{message}}`) và dialog xóa dùng chung hiện "Xóa Mục Tiêu đề" (mất `{{item}}`) — người dùng không bao giờ thấy lỗi thật.

Ngoài ra đáng chú ý: xoá hard-delete 1-click không confirm và không kiểm tra tham chiếu ở toàn bộ /master-data + /component-library; RBAC split-brain (FE gate permission, BE hardgate `role==='admin'`) tái xuất ở 4 màn; `machine.list` trả `apiKey` của mọi máy cho mọi user đăng nhập (P2 bảo mật); operator-badges dính bug zod v4 xoá âm thầm validFrom/validTo khi gán user (rủi ro truy xuất nguồn gốc). Điểm sáng: khung CRUD + RBAC UI + i18n label cơ bản hoạt động, quy trình badge/re-issue đúng thiết kế, datasettings có soft-delete + Excel import/export thật, wizard onboarding đi đủ 9 bước, process-management có kéo-thả reorder persist.

---

## 2. Bảng điểm theo màn hình

Ký hiệu CRUD: ✅ pass · ⚠️ partial · ❌ fail · 🚫 n/a. Cột P0/P1 chỉ đếm **bugs** (không tính uxIssues).

| Màn hình | uxScore | C | R | U | D | P0 | P1 | Nhận xét 1 câu |
|---|---|---|---|---|---|---|---|---|
| /component-library | 6.0 | ✅ | ✅ | ✅ | ✅ | 0 | 3 | Happy-path tốt nhưng error-path hỏng nặng: trùng mã 500 lộ SQL, xoá không confirm, mã soft-delete bị khoá vĩnh viễn không restore. |
| /workstation-management | 4.5 | ✅ | ✅ | ✅ | ✅ | 0 | 3 | CRUD chạy end-to-end nhưng i18n rác (title sai "Quản lý máy", raw key machines.*), trùng mã 500 lộ SQL, switch Active bị bỏ qua. |
| /master-data · Suppliers+Customers (md-trade-partners) | 4.0 | ✅ | ✅ | ❌ | ✅ | 1 | 2 | UPDATE hỏng 100% cả 2 tab (P0); xoá 1-click không confirm; không sửa được approvalStatus → NCC kẹt "pending" vĩnh viễn. |
| /product-mapping | 4.0 | ✅ | ⚠️ | ⚠️ | ✅ | 0 | 3 | CRUD cơ bản chạy nhưng 6 mapping mồ côi "N/A", duplicate 500 lộ SQL, i18n placeholder tràn màn, không nhập được priority/notes. |
| /process-management | 5.0 | ✅ | ✅ | ✅ | ✅ | 0 | 3 | CRUD + kéo-thả reorder persist tốt; i18n dịch máy rác cả vi lẫn en, RBAC split-brain, API gán line có sẵn nhưng chết (0 UI). |
| /operator-badges | 6.5 | ✅ | ✅ | ⚠️ | 🚫 | 0 | 1 | Màn tốt nhất module; nhưng bug P1 hỏng dữ liệu âm thầm: gán user xoá NULL validFrom/validTo (zod v4), cắt cụt 200 dòng không phân trang. |
| /layout (factory-layout) | 5.5 | ✅ | ✅ | ⚠️ | ⚠️ | 0 | 2 | Canvas 2D kéo-thả/zoom/minimap tốt; nhưng layout KHÔNG xoá/đổi tên được, tab "Xem" vẫn ghi DB, undo giả, i18n hỏng nặng. |
| /master-data · Skills+Certs+Tools (md-workforce) | 4.5 | ✅ | ✅ | ⚠️ | ✅ | 0 | 4 | Update fail với field null (mọi Tool không sửa được), sửa Mã silent-drop, trùng mã 500 lộ SQL, xoá không confirm; cert chưa được wire vào assign operator. |
| /master-data · Calendar+Inventory (md-calendar-inventory) | 4.0 | ✅ | ✅ | ❌ | ✅ | 0 | 3 | UPDATE hỏng hàng loạt (400 null), tồn kho nhận vật liệu không tồn tại, không lưu được qty=0, master-detail khó khám phá. |
| /master-data · Materials+Classes+UoM (md-materials-uom) | 4.0 | ✅ | ✅ | ❌ | ✅ | 0 | 4 | Update fail toàn diện; quan hệ material↔class↔uom là text tự do không validate (tạo được liên kết rác); xoá được class đang tham chiếu. |
| /products | 4.0 | ❌ | ✅ | ⚠️ | ✅ | 1 | 4 | Nút "Thêm" no-op (P0), menu Sửa stale-closure có thể prefill nhầm sản phẩm khác, readiness 500 spam, toast lỗi "Lỗi với Tin nhắn" vô nghĩa. |
| /product-onboarding | 6.0 | ✅ | ✅ | ✅ | ✅ | 0 | 4 | Wizard 9 bước chạy đủ, CRUD fiducial pass; nhưng "resumable" chỉ đúng khi nhớ deep-link, Finish không guard (chốt xong ở 25%), modal fiducial trắng-trên-trắng. |
| /datasettings | 4.5 | ✅ | ✅ | ✅ | ✅ | 0 | 3 | CRUD lõi + soft-delete/restore + Excel thật; nhưng MẤT điều hướng 11/12 tab, trùng mã 500 lộ SQL, filter loại máy chết, machine.list leak apiKey. |
| Benchmark (đọc code, so chuẩn) | 5.5 | 🚫 | 🚫 | 🚫 | 🚫 | 0 | 1 | Độ phủ thực thể ~7/10 vượt MES tầm trung; độ sâu quản trị (search/import/audit-trail/AVL/lifecycle) ~4/10 thua xa Odoo/SAP MDG. |

**Trung bình 13 màn hình: 4.8/10.**

---

## 3. Phát hiện P0 (chặn sản xuất)

### P0-1 · [products] Nút "Thêm" (tạo sản phẩm) hoàn toàn no-op — không thể tạo sản phẩm từ màn hình

**Chi tiết:** `DialogTrigger asChild` bọc `<PermissionGate>` (ProductModels.tsx:2221-2229); PermissionGate khi có quyền trả về Fragment (`<>{children}</>`, PermissionGate.tsx:71) nên toàn bộ props trigger (onClick, aria-haspopup, data-state) do Radix Slot truyền xuống bị nuốt mất — nút render bình thường nhưng bấm bao nhiêu lần dialog cũng không mở. Đã click 2 lần liên tiếp, kiểm tra DOM: button không có aria-haspopup/data-state. Người dùng admin không thể tạo sản phẩm ở màn hình này (phải vòng qua wizard "Guided setup"). Đồng nghĩa toàn bộ validation form tạo (required, pattern mã, trùng mã) không thể kiểm chứng qua UI. Bug pattern này có khả năng lặp ở trang khác (mọi chỗ `Trigger asChild` bọc PermissionGate).

**Evidence:** screenshot `08-addbtn-noop.png`; log "dialog after click1: false after click2: false" + attrs button thiếu aria-haspopup; `client/src/pages/ProductModels.tsx:2221-2229` + `client/src/components/PermissionGate.tsx:71`.

### P0-2 · [md-trade-partners] Sửa (Update) hỏng hoàn toàn ở cả 2 tab Suppliers và Customers — mọi lần bấm Lưu đều 400

**Chi tiết:** Dialog Sửa truyền nguyên row DB vào mutation (`initial={r}` rồi spread `{...v, id}`). Các cột null (contactPhone, address, corporateCode, factoryCode, notes) bị zod server từ chối vì schema chỉ `.optional()` chứ không `.nullable()`; riêng supplier còn lỗi rating: DB decimal trả về string "4.00" nhưng schema đòi `z.number()`. Vì form tạo mới không có các field này (luôn null), **MỌI bản ghi tạo từ chính UI này đều không thể sửa — kể cả bấm Lưu không đổi gì**. Toast hiện nguyên mảng JSON zod tiếng Anh. Fix: chỉ submit các key khai báo trong fields + chuẩn hoá null→undefined và Number(rating), hoặc nới schema server `.nullable()`.

**Evidence:** Live: POST `/api/trpc/masterData.suppliers.update` → 400 và `masterData.customers.update` → 400; screenshot `09-supplier-edit-nochange-save.png`, `10-supplier-edit-error.png`, `15-customer-after-edit.png`. Code: `client/src/pages/MasterDataManagement.tsx:277-278, 476-477`; `server/routers/masterDataRouter.ts:130-147, 271-286`.

> Lưu ý: cùng root-cause này làm **UPDATE fail/partial thêm ở 3 surface khác** (md-materials-uom, md-calendar-inventory, md-workforce — ghi P1 ở đó). Tính về tác động, đây là 1 lỗi kiến trúc EntityDialog + zod ảnh hưởng cả 10 tab /master-data.

---

## 4. Phát hiện P1

### 4a. Bug P1 (40)

| # | Surface | Bug | Tóm tắt + evidence |
|---|---|---|---|
| 1 | benchmark | Xóa cứng master data không có hộp xác nhận và không kiểm tra tham chiếu | Cả 10 tab /master-data và /component-library gọi `del.mutate({id})` ngay onClick, backend `db.delete()` cứng không check bản ghi đang được tham chiếu bằng code (materials.code được mes.ts/inventory_balances trỏ tới) → 1 click nhầm xóa vĩnh viễn, để lại mã mồ côi. — `MasterDataManagement.tsx:282` + `masterDataRouter.ts:79-84` |
| 2 | component-library | Tạo package trùng mã → HTTP 500 + toast lộ nguyên câu SQL INSERT | Router bắt lỗi bằng regex trên `e.message` nhưng drizzle bọc lỗi pg thành "Failed query: ..." (chuỗi duplicate key nằm ở `e.cause`) nên nhánh CONFLICT không bao giờ chạy — lỗi thô ném thẳng ra client, dialog vẫn mở. — `08-duplicate-toast.png`; `componentLibraryRouter.ts:111,192` |
| 3 | component-library | Xoá package/footprint không có xác nhận — 1 click là mất | Package soft-delete còn cứu ở DB nhưng footprint là HARD DELETE — bấm nhầm mất vĩnh viễn geometry, không undo trong toast. — script log "confirm dialog: 0"; `ComponentLibrary.tsx:317,408`; `componentLibraryRouter.ts:230` |
| 4 | component-library | Mã package đã xoá bị khoá vĩnh viễn: không tạo lại được, không có UI khôi phục | Soft-delete giữ tombstone nhưng unique constraint trên code vẫn còn → tạo lại đúng mã bị 500 raw SQL; API `packages.list` có `includeDeleted` nhưng UI không dùng → không xem/không restore được, dead-end hoàn toàn. — `19-recreate-tombstone.png`; `componentLibraryRouter.ts:66,148-151`; `ComponentLibrary.tsx:312` |
| 5 | workstation-management | Tạo mã trùng gây HTTP 500 và lộ nguyên câu SQL cho người dùng | `createWorkstation` không check trùng trước INSERT (dù có sẵn `getWorkstationByCode`), unique constraint nổ thành 500 và err.message thô đưa thẳng vào toast — lộ tên bảng/cột DB. — `07-duplicate-code.png`; `server/db/hierarchy.ts:588-594`; `systemRouters.ts:55-69` |
| 6 | workstation-management | Raw i18n key `machines.assembly/testing/packaging/other` hiển thị nguyên key trên UI | 4/6 loại quy trình hiện nguyên key chưa dịch ở badge cột Loại, dropdown chọn loại và thẻ thống kê "Theo Loại" — key không tồn tại trong cả vi.json lẫn en.json. — `11-after-update.png`, `04-processtype-options.png`; `WorkstationManagement.tsx:53-60` |
| 7 | workstation-management | i18n placeholder/dịch máy tràn lan — tiêu đề trang còn SAI ("Quản lý máy") | Trang trạm nhưng title/subtitle = "Quản lý máy"; hàng loạt chuỗi vô nghĩa: "Active Trạng thái Nhãn", "Tạo desc", "Xóa Xác nhận Tin nhắn"; bản EN còn là placeholder "Subtitle", "Delete confirm message". — `02b-after-vi.png`, `12-delete-confirm.png`; vi.json/en.json machines.* |
| 8 | md-trade-partners | Tạo trùng mã → leak nguyên câu SQL INSERT + params ra toast | Tạo supplier trùng code trả 500, toast in "Failed query: insert into suppliers (...) params: AUDIT_SUP_01,..." — vừa lộ cấu trúc DB vừa vô nghĩa với người dùng. — `12-supplier-duplicate-code.png`; `masterDataRouter.ts:61-66` |
| 9 | md-trade-partners | Xoá vĩnh viễn 1 click, không xác nhận, không undo | Nút thùng rác gọi `del.mutate` ngay; hard delete trên dữ liệu chủ được tham chiếu bằng code từ materials/productionOrders (không FK) → xoá nhầm tạo tham chiếu mồ côi không cảnh báo. — script log "confirm dialog visible: false"; `MasterDataManagement.tsx:282,481` |
| 10 | product-mapping | Tạo mapping trùng → HTTP 500 + toast hiển thị nguyên câu SQL INSERT | `server/db/product.ts:1616` bắt `err.code==='23505'` trên err trực tiếp nhưng Drizzle bọc lỗi trong DrizzleQueryError (code ở `err.cause`) → message tiếng Việt thân thiện dòng 1617 là dead code; user thấy SQL thô, dialog treo. — `04-duplicate-error.png`; `product.ts:1613-1620` |
| 11 | product-mapping | Mapping mồ côi hiển thị "N/A" — sản phẩm đã xoá nhưng mapping vẫn tồn tại và active | DB có 6 mapping trỏ productModelId=1 trong khi productModel.list rỗng; UI hiện card "N/A" không mã, không cảnh báo; xoá sản phẩm không cascade/cảnh báo mapping liên quan → máy vẫn "assigned" sản phẩm không tồn tại. — `01-initial.png` + script `02-api-check.mjs` |
| 12 | product-mapping | i18n placeholder chưa dịch tràn màn hình — cả EN lẫn VI đều là chuỗi rác | "Assign description"/"Phân công Mô tả", "Confirm delete title"/"Xác nhận Xóa Tiêu đề", "1 Sản phẩm assigned", "Thêm Mới mapping" — copy placeholder lọt production. — `04-delete-confirm.png`, `05-after-vi-switch.png`; vi.json+en.json products.* |
| 13 | process-management | Submit form rỗng hiện nguyên mảng JSON lỗi Zod tiếng Anh trong toast | Không validation client; 400 → `toast.error(error.message)` đổ nguyên `[{"origin":"string","code":"too_small",...}]`; không lỗi inline, không dấu (*) field bắt buộc. — `04-empty-submit.png`; `ProcessManagement.tsx:201-203` |
| 14 | process-management | i18n rác toàn trang ở CẢ tiếng Việt lẫn tiếng Anh | vi: "Sản xuất processes", "Kéo Thả desc", "Tạo Tiêu đề", placeholder "Mã Chỗ nhập..."; en còn tệ hơn — key-name thành text: "Title", "Subtitle", "Create title". — `02-vi-initial.png`, `03-create-dialog.png`; vi.json:5691-5727 |
| 15 | process-management | RBAC split-brain: FE gate module settings_factory, BE hardgate role==='admin' | Mọi mutation dùng adminProcedure; user được RoleBuilder cấp settings_factory sẽ THẤY nút nhưng thao tác nhận FORBIDDEN "Admin access required" (tiếng Anh). — `processRouter.ts:7-12` vs `ProcessManagement.tsx:153,162,337` |
| 16 | operator-badges | Gán người dùng xoá âm thầm validFrom + validTo của thẻ | zod 4.3.6 parse `dateInput.optional()` với key VẮNG MẶT ra `null` thay vì `undefined` → guard `!== undefined` luôn true → update ghi NULL cả 2 cột. Repro live 2 lần. Hậu quả: thẻ tái cấp thành open-start, có thể gán nhầm inspection cũ cho người giữ thẻ mới (mất truy xuất). — `operatorBadgeRouter.ts:27-35,149-170`; `17-validfrom-repro.png` |
| 17 | factory-layout | Layout không thể xoá và không thể đổi tên — rác dữ liệu tích tụ vĩnh viễn | layoutRouter không có procedure delete; layout.update có backend nhưng 0 UI gọi; cột isActive có sẵn không dùng. 2 layout AUDIT của phiên audit không thể dọn qua UI/API. — `layoutRouters.ts`; `drizzle/schema/layout.ts:22`; `03-layout-list.png` |
| 18 | factory-layout | RBAC split-brain: UI gate settings_factory, backend yêu cầu cứng role admin | Mọi mutation layout là adminProcedure hardgate `role !== 'admin'` — user non-admin có quyền qua RoleBuilder thấy nút nhưng mọi thao tác lỗi FORBIDDEN. — `layoutRouters.ts:26-89` + `_shared.ts:197-202` vs `Layout.tsx:554` |
| 19 | md-workforce | Không thể SỬA bản ghi có field null — mọi Tool tạo từ UI đều không sửa được | `initial={r}` gửi nguyên null (category của Skill; machineType/corporateCode/factoryCode/notes của Tool) → zod `.optional()` từ chối → 400, toast JSON tiếng Anh, dialog kẹt. Form Tool không có ô 3 cột đó nên mọi tool luôn fail. — `22-tool-edit.png`; `MasterDataManagement.tsx:538,700` + `masterDataRouter.ts:316-321,416-428` |
| 20 | md-workforce | Tạo trùng mã → 500 + leak nguyên câu SQL ra toast | Tạo skill trùng code không bắt unique-violation → 500, toast "Failed query: insert into skills (...)" — leak tên bảng/cột/params. — `07-skill-duplicate.png`; `masterDataRouter.ts:61-66` |
| 21 | md-workforce | Xoá hard-delete 1 click, KHÔNG có hộp thoại xác nhận | Cả 3 tab skill/cert/tool xoá ngay onClick; skill đang được userCertifications FK + fleet requiredSkillIds tham chiếu — lỡ tay mất dữ liệu gốc. — live verify alertdialog=false; `MasterDataManagement.tsx:543,639,705` |
| 22 | md-workforce | Sửa trường "Mã" bị server âm thầm bỏ qua nhưng vẫn báo "Đã lưu" | Dialog edit tái dùng fields của create nên ô "Mã *" cho nhập, nhưng zod update không có key `code` (strip) → đổi mã, toast thành công, mã không đổi — data-lie. — `11-skill-code-discard.png`; `masterDataRouter.ts:314-325` |
| 23 | md-calendar-inventory | UPDATE hỏng hàng loạt: sửa lịch/kho/vị trí/tồn kho trả 400 vì gửi null | Cùng root-cause EntityDialog + zod optional: mọi bản ghi tạo qua UI có notes=null → KHÔNG THỂ SỬA lịch, kho, vị trí kho, tồn kho; ngày chỉ sửa được nếu đã có ghi chú. — `24-wh-edit-result.png`, `29-balance-edit.png`; `masterDataRouter.ts:546-556,626-636,667-677,742-755` |
| 24 | md-calendar-inventory | Trùng mã → HTTP 500 và toast lộ nguyên câu SQL + params | Tạo lịch trùng mã / ngày trùng (calendarId,date) → 500 + "Failed query: insert into plant_calendars ...". — `08-cal-duplicate.png`, `14-day-duplicate.png` |
| 25 | md-calendar-inventory | Xóa không có xác nhận — 1 click xóa vĩnh viễn lịch/kho/tồn kho | Mọi nút Trash2 gọi del.mutate trực tiếp; verify live alertdialog=0, bản ghi biến mất ngay. — `MasterDataManagement.tsx:911,951,1054,1095,1140` |
| 26 | md-materials-uom | Sửa (Update) hỏng toàn diện trên cả 3 tab — 400 zod "expected string, received null" | Repro live 4 đường: materials.update / updateClass / uom.update / updateConversion đều 400 vì null (notes, datasheetUrl, manufacturer, parentCode…). Mọi bản ghi tạo từ UI vĩnh viễn không sửa được. — `17-material-edit-result.png`, `13-uom-edit-result.png` |
| 27 | md-materials-uom | Trùng mã → HTTP 500, toast leak nguyên câu SQL (tên bảng + cột) | "Failed query: insert into material_classes (...) params: AUDIT_CLS,..." — áp dụng cho mọi bảng có unique code. — `10-class-duplicate-error.png` |
| 28 | md-materials-uom | Xóa 1 click không xác nhận, hard-delete; xóa được cả nhóm vật tư đang được tham chiếu | Đã xóa AUDIT_CLS trong khi AUDIT_MAT2 vẫn có materialClass='AUDIT_CLS' → thành công không cảnh báo, vật liệu giữ mã nhóm mồ côi. — script 08-cleanup log; `18-materials-after-class-deleted.png` |
| 29 | md-materials-uom | Quan hệ material↔class↔uom không tồn tại trong form: ô text tự do, không picker, không validate | Tạo live được vật liệu với class='CLS_KHONG_CO', unit='U_KHONG_CO' và quy đổi AUDIT_FAKE_X→AUDIT_FAKE_Y (không tồn tại) → "Đã lưu" thành công — phá mục đích master data. — `15-material-create-dialog.png`, `14-conversions.png`; `masterDataRouter.ts:200,206,486-487` |
| 30 | products | productModel.getReadinessBatch/getReadiness trả 500 mọi lần load — SQL sai cú pháp ANY | `sql\`= ANY(${productIds})\`` bị drizzle expand thành row constructor → lỗi query trên golden_sample_references; badge độ hoàn thiện chết toàn trang, react-query retry spam 12+ lỗi 500 mỗi lần load. Fix: dùng `inArray()` như 6 query cùng file. — `productReadinessService.ts:334` |
| 31 | products | Menu "Sửa" dùng selectedProduct cũ (stale closure) — lần đầu no-op, có thể mở form với dữ liệu sản phẩm KHÁC | Repro cả 2 kịch bản: chưa chọn → bấm Sửa → không gì xảy ra; đang chọn SP03 bấm Sửa row SP04 → dialog prefill SP03 nhưng Lưu ghi vào id SP04 — nguy cơ ghi đè dữ liệu chéo. — `26-edit-wrong-prefill.png`; `ProductModels.tsx:1744-1745, 2445-2449` |
| 32 | products | Toast lỗi hiển thị nguyên văn "Lỗi với Tin nhắn" — mất interpolation {{message}} | vi.json:1645 và en.json:1765 đều bị dịch máy xóa mất `{{message}}` → server trả "Mã sản phẩm đã tồn tại" nhưng user chỉ thấy "Lỗi với Tin nhắn". Ảnh hưởng ~30 mutation của trang và mọi trang dùng key này. — `17-edit-dup-code.png`, `19-clone-dup.png` |
| 33 | products | Dialog xác nhận xóa hiện "Xóa Mục Tiêu đề" / "Xóa Mục Xác nhận" — {{item}} bị phá | Cùng lỗi hệ thống mất placeholder; ảnh hưởng MỌI entity dùng DeleteConfirmDialog. — `20-delete-confirm.png`; vi.json:1649; `ConfirmDialog.tsx:138-139` |
| 34 | product-onboarding | getReadiness/getReadinessBatch 500 mọi lần gọi — readiness score server-side (WD-2 doc 31) chết runtime | Cùng root-cause #30 (`= ANY()`); wizard không sập vì tự tính client-side nhưng điểm readiness "chính thống" của hệ sinh thái onboarding hoàn toàn không hoạt động. — `productReadinessService.ts:334`; script 09-cleanup2 output |
| 35 | product-onboarding | Lỗi trùng mã sản phẩm leak nguyên câu SQL INSERT ra toast | Toast in thẳng e.message: "Failed query: insert into product_models (...)" — lộ tên bảng + 25 cột schema. — `28-duplicate-code.png`; `Step1Product.tsx:45` |
| 36 | product-onboarding | Modal thêm/sửa fiducial trắng-trên-trắng ở dark theme — gần như không đọc được | Modal tự chế hardcode `bg-white`, chữ dùng màu theme (sáng) → trắng trên trắng; bước Fiducial là bước bắt buộc của wizard. — `10-fiducial-dialog.png`; `ProductFiducialsTab.tsx:199-200` |
| 37 | product-onboarding | Lưu fiducial thiếu mã/tên: request 400 nhưng UI im lặng tuyệt đối | createMut/updateMut không có onError — không toast, không inline error, modal cứ mở trơ; lỗi chỉ nằm trong console dạng JSON zod. — script 05 output; `22-fiducial-empty-save.png`; `ProductFiducialsTab.tsx:60-76` |
| 38 | datasettings | Mất hoàn toàn điều hướng tab — 11/12 tab không thể truy cập từ UI | Menu dọc trong trang bị ẩn cứng (doc 36), row ?tab= sidebar bị gỡ (doc 39) nhưng TabsList thay thế không tồn tại — chỉ còn gõ URL tay để vào workshops/lines/stations/machines/shifts/stages/…/seed-data. — `01-initial.png`; `DataSettings.tsx:745`; `navigation.tsx:1698-1699` |
| 39 | datasettings | Trùng mã nhà máy → HTTP 500 và toast lộ nguyên câu SQL INSERT | "Failed query: insert into factories (...) params: AUDIT_FAC_01,..." — lộ schema, không cho biết nguyên nhân thật. — `04-duplicate.png` |
| 40 | datasettings | Submit form rỗng hiện raw Zod JSON tiếng Anh trong toast | Dialog factory/workshop/line/station/machine không validate client — 400 → toast nguyên mảng JSON Zod; chỉ dialog shift/stage có useFormValidation tử tế. — `04-validation-empty.png`; `DataSettings.tsx:1007` |

### 4b. Vấn đề UX mức P1 (15)

| Surface | Vấn đề |
|---|---|
| benchmark | Không tìm kiếm/lọc/sắp xếp/phân trang trên cả 10 tab master data (listAll đổ hết bảng; 5k-50k part number sẽ không dùng nổi) |
| benchmark | Primitive DataTable/FilterBar/FormScaffold đã xây (doc 39 W1) nhưng 0 trang master data nào dùng — chỉ ComponentShowcase demo |
| component-library | Không sửa được mã package + không restore → gõ nhầm mã là dead-end vĩnh viễn |
| md-trade-partners | Thông báo lỗi kỹ thuật thô (JSON zod / SQL) hiển thị trực tiếp, toàn tiếng Anh |
| md-trade-partners | Xoá 1 click không xác nhận — rủi ro thao tác nhầm rất cao (thùng rác cạnh nút sửa) |
| product-mapping | Không có search/filter — 36 card máy xếp dọc, tìm 1 máy phải cuộn cả trang |
| product-mapping | Picker máy/sản phẩm là Select thường, không gõ tìm được |
| process-management | Toàn trang đọc như bản dịch máy — mất uy tín ngay từ cái nhìn đầu |
| md-workforce | Không có search/filter/sort/pagination ở cả 3 tab (cert user×skill sẽ hàng nghìn dòng) |
| md-calendar-inventory | Master-detail không thể khám phá: phải click đúng Ô MÃ/TÊN mới chọn được lịch/kho, highlight mờ, panel con không hiện tên đối tượng |
| md-materials-uom | Không có tìm kiếm/lọc/sắp xếp/phân trang trên cả 3 bảng |
| md-materials-uom | Lỗi hiển thị dạng kỹ thuật thô (SQL/JSON zod), không hướng dẫn khắc phục |
| products | Không có phân trang danh sách sản phẩm (API hỗ trợ limit/offset nhưng UI load tất) |
| product-onboarding | "Hoàn tất cấu hình" không có guard — chốt setup ở 25% với 4/6 bước bắt buộc chưa làm, không confirm |
| datasettings | Dead-end điều hướng: vào trang chỉ thấy 1 danh sách, không biết trang có 12 chức năng |

---

## 5. Chủ đề hệ thống (P2/P3 gộp theo theme)

Gộp 85 P2 + 66 P3 (bugs + uxIssues) thành 14 theme lặp xuyên màn hình:

### T1 — Sửa "Mã" trong dialog edit bị backend âm thầm bỏ qua (silent no-op)
Dialog edit tái dùng fields của create nên ô "Mã" hiển thị editable + required, nhưng zod update không nhận key `code` (strip) → user đổi mã, toast "Đã lưu", mã không đổi. **Màn dính:** benchmark (P2), md-trade-partners (P2), md-materials-uom (P2), md-calendar-inventory (P2); ở md-workforce mức P1 (đã liệt kê §4).

### T2 — Lỗi server hiển thị thô: tiếng Anh / JSON zod / SQL, không map i18n
Mọi onError đổ `error.message` thẳng vào toast: "Process code already exists", mảng JSON zod, câu SQL. Không có lớp mapError chung. **Màn dính:** component-library (P2), process-management (P2×2), md-calendar-inventory (P2), md-workforce (P2), datasettings (P2 ux), md-trade-partners, md-materials-uom (P1 ux đã nêu).

### T3 — Không có loading state / skeleton — bảng trống hiện "Chưa có dữ liệu" khi đang tải
Query đang chạy → bảng trống trơ hoặc empty-row loé lên, không phân biệt isLoading/isError; AsyncBoundary có sẵn không dùng. **Màn dính:** component-library (P2), md-trade-partners (P3), product-mapping (P2), md-calendar-inventory (P2), workstation-management (P3).

### T4 — Enum/giá trị hiển thị thô không dịch, số liệu không format
Cột hiện raw enum tiếng Anh ("component", "pending", "other available", "count"); số decimal in nguyên "0.5000", "12.000000000000", "45.00s"; ngày cert hiện "Fri Dec 31" mất năm (P2 md-workforce). **Màn dính:** md-trade-partners (P2), md-workforce (P2×2), md-materials-uom (P2, P3), component-library (P3), process-management (P3×2).

### T5 — Key i18n mất interpolation {{count}}/{{item}}/{{machine}} → mất thông tin
Bản dịch máy xóa placeholder: đếm trạm không hiện số (workstation P2), "Máy displayed" mất count+type (layout P2), "(Số công đoạn)" (datasettings P2), dialog xoá mapping không hiện tên máy/sản phẩm (product-mapping P2); mức P1 ở products (errorWithMessage/deleteItemTitle). **Màn dính:** workstation-management, factory-layout, datasettings, product-mapping, products.

### T6 — Chỉ báo ngôn ngữ header sai: hiện "🇻🇳 Tiếng Việt" khi app đang render tiếng Anh (i18nextLng=en-US)
Bug app-shell (DashboardLayout) quan sát trực tiếp trên 7 màn. **Màn dính (P2/P3):** md-trade-partners, product-mapping, operator-badges, md-workforce, md-calendar-inventory, product-onboarding, datasettings (md-materials-uom cũng ghi nhận trong bug i18n).

### T7 — Trường ngày/timezone nhập text tự do, không date-picker, không validate
expiresAt, calendar date (phải đúng YYYY-MM-DD), timezone đều là Input text; nhập "31/12/2026" hoặc chuỗi rác → 400 raw JSON hoặc "Invalid time value". **Màn dính:** benchmark (P2), md-workforce (P2), md-calendar-inventory (P2, P3 timezone).

### T8 — Validation client sơ sài: chỉ toast field thiếu đầu tiên, coi 0/false là "thiếu", không giới hạn số
EntityDialog check `!vals[key]` → qty=0 bị chặn "là bắt buộc" (md-calendar-inventory P2), factor=0 tương tự (md-materials-uom P3); rating không giới hạn 0-5 ở input (md-trade-partners P3); cycle time nhận -5 (process-management P2); tuổi thọ tool -5 → 400 JSON (md-workforce P2); không highlight field lỗi, không disable nút khi pending (md-workforce P2, component-library P2). **Màn dính:** md-calendar-inventory, md-materials-uom, md-trade-partners, process-management, md-workforce, component-library.

### T9 — Hard-delete/cascade âm thầm + backend restore/soft-delete có sẵn nhưng UI không nối
Xoá không check bản ghi con (kho→locations/balances, lịch→days: md-calendar-inventory P2; process cascade xoá line assignments: P2), workstation có listDeleted/restore không nối UI (P2), products soft-delete không có thùng rác khôi phục (P2), tồn kho nhận materialCode không tồn tại (P2), machine_positions không FK → vị trí mồ côi "Machine {id}" (factory-layout P3), panel giữ state stale sau khi xoá đối tượng đang chọn (md-calendar-inventory P3). **Màn dính:** md-calendar-inventory, process-management, workstation-management, products, factory-layout, md-materials-uom.

### T10 — Không phân trang / không search / cắt cụt dữ liệu / over-fetch
Backend limit 200 nhưng FE bỏ qua total (operator-badges P2), machine tab 36+ card không dùng listPaged có sẵn (datasettings P2), bảng không sort/không đếm tổng (md-trade-partners P2, workstation P2), search không debounce bắn request từng phím (operator-badges P3), fetch toàn bộ mapping rồi filter client (product-onboarding, improvement). **Màn dính:** operator-badges, datasettings, md-trade-partners, workstation-management, product-mapping, md-calendar-inventory (+P1 ux ở 4 màn khác — §4b).

### T11 — RBAC split-brain & gate lệch
FE gate module permission, BE hardgate `role==='admin'`: workstation-management (P2), datasettings (P3, `isAdmin = role==='admin'` chặn cả trang); mức P1 ở process-management + factory-layout. Kèm: tab Certifications hỏng một nửa với non-admin — dropdown user rỗng, bảng hiện userId số thô (md-workforce P2, benchmark P3); user.list fail lặng lẽ trong dialog badge (operator-badges P3). **Bảo mật liên quan:** `machine.list` trả nguyên row kèm apiKey cho mọi user đã đăng nhập (datasettings P2); nút Sao chép API Key copy chuỗi rỗng vẫn toast thành công (datasettings P2).

### T12 — Form thiếu field so với backend / trường chết
Supplier không nhập được type/approvalStatus/SĐT/địa chỉ (md-trade-partners P2); tool thiếu type/status (md-workforce P2); process thiếu toggle isActive (P2); workstation switch Active bị bỏ qua khi tạo + workshopId chết (P2/P3); mapping thiếu priority/notes (product-mapping P2 ux); factory dialog thiếu ô mô tả (datasettings P3); form tạo product thiếu trường so với form sửa (products P2 ux); dialog badge thiếu validFrom/validTo/notes (operator-badges P2 ux); footprint geometry/courtyard backend nhận nhưng UI không có chỗ nhập (component-library, missing feature).

### T13 — Empty state / trạng thái thiếu ngữ cảnh, không CTA
Empty state 1 dòng chữ không nút hành động (workstation P3, md-trade-partners P3, md-materials-uom P2, datasettings P3, factory-layout P3); search không khớp hiện nhầm message "chưa có dữ liệu" (operator-badges P3, products P2); layout không tồn tại render canvas rỗng như thật (factory-layout P2); lỗi readiness bị nuốt thành "Chưa có dữ liệu độ hoàn thiện" (products P2); tab liên kết vật liệu 0/0 không hướng dẫn (component-library P2).

### T14 — Điều hướng/tổ chức màn hình: tab tràn, không sync URL, master-detail chồng dọc, toolbar quá tải, tên không nhất quán
10 TabsTrigger 1 hàng không nhóm ngữ nghĩa (benchmark P3, md-workforce P3, md-materials-uom P3); tab+filter không giữ qua reload/URL (component-library P3, workstation P3); master-detail card xếp chồng thay vì split view (benchmark P2); header panel /products 11 nút ngang hàng (P2); View/Edit 2 canvas trùng ~70% code, view vẫn ghi DB (factory-layout P2 + P2 ux); sidebar gọi "Bố cục nhà máy" nhưng trang là "Bố trí xưởng" (P3); menu gọi wizard là "Tạo sản phẩm mới" sai bản chất (product-onboarding P2); mô tả trang /master-data sai nội dung (md-calendar-inventory P3); toast cũ tồn đọng cạnh toast lỗi (component-library P3, md-materials-uom P2); icon-only button không aria-label/tooltip (process-management P3, product-mapping P3); native window.confirm thay AlertDialog (factory-layout P3, product-onboarding P3); "Chưa Làm/Đã Bỏ Qua" title-case sai tiếng Việt (product-onboarding P3); badge mã công đoạn tròn 24px tràn chữ (datasettings P3); mini-map hardcode 1200×600 lệch layout thật + nút 3D không phải 3D thật + undo chỉ local (factory-layout P2/P3); reorder N UPDATE không transaction + orderIndex mới luôn =0 (process-management P3/P2); updatedAt không bump khi update (workstation P3); cert hết hạn vẫn badge "Hoạt động" xanh (md-workforce P3, benchmark P3); nút Gán user vẫn hiện trên dòng đã thu hồi (operator-badges P3); thu hồi thẻ 1 click không confirm (operator-badges P2 ux); toggle mapping 1 click không confirm trong khi xoá lại có (product-mapping P3); layout trùng tên tự do (factory-layout P2); balance không lọc theo kho đang chọn (benchmark P3); Select user/skill/package không search (md-workforce P2, component-library P2, product-onboarding P3); wizard sau Finish + reload mất toàn bộ trạng thái, không resume route trần (product-onboarding P2×2); bước Sản phẩm báo Xong dù chưa có ảnh (product-onboarding P3); lịch sử thẻ cùng mã không nhóm (operator-badges P3); dialog thêm máy layout không search (factory-layout P2); tạo máy phải chọn lại 4 cấp hierarchy (datasettings P2); toggle show-deleted là state chung không đồng bộ hiển thị (datasettings P3); filter loại máy chết do lệch field m.type/machineType (datasettings P2); mật độ thông tin mapping thấp — không priority/notes/ngày/ai tạo (product-mapping P2); chỉ có view theo máy không có view theo sản phẩm (product-mapping P2); không highlight bản ghi vừa tạo (product-mapping P3); DeepLinkStep bắt tự bấm refresh (product-onboarding P2).

---

## 6. Tính năng còn thiếu (tổng hợp + benchmark)

Merge 96 mục missingFeatures của 14 agent, dedup theo chủ đề. Priority = mức cao nhất trong các surface nêu.

### 6.1 Import / Export (P1 — nêu ở 12/14 agent, khoảng trống lớn nhất)
- **Import/Export Excel-CSV + template** cho mọi thực thể: suppliers/materials/tools/UoM (benchmark P1, md-trade-partners P1, md-materials-uom P1, md-workforce P1), component packages (component-library P1), workstations (workstation P1 — backend đã có helper bulk-import), operator badges theo lô HR (operator-badges P1), kho/vị trí/tồn kho (md-calendar-inventory P1), mapping máy-SP (product-mapping P2), công đoạn (process-management P2), export danh sách sản phẩm (products P2), layout config JSON/Excel giữa site (factory-layout P3). Nghịch lý: hạ tầng import CSV preview+mapping+preset ĐÃ tồn tại cho centroid (productRouters.ts) nhưng không lan ra master data.
- **Bulk add ngày nghỉ / generate lịch** (range + rule "mọi Chủ nhật" + import ngày lễ quốc gia) — md-calendar-inventory P1.
- **Import fiducial/điểm đo từ CSV/centroid ngay trong wizard** — product-onboarding P2.

### 6.2 Governance: audit trail + archive thay hard-delete (P1-P2 — nêu ở 12/14 agent)
- **Audit trail (ai đổi gì, khi nào, cũ→mới)** cho master data: masterDataRouter/componentLibrary/operatorBadge có 0 dòng audit (benchmark P1); các nơi backend ĐÃ ghi audit nhưng không có UI xem: product-mapping (P3), products (P2), datasettings (P2), product-onboarding (P3 mốc complete); còn lại chưa ghi: workstation (P2), process (P2), md-materials-uom (P2), md-calendar-inventory (P2), factory-layout (P3), operator-badges (P3 hiển thị issuedBy/notes).
- **Archive/deactivate thay hard-delete + kiểm tra where-used trước khi xoá**: md-trade-partners P1, md-materials-uom P1, md-workforce P2, md-calendar-inventory P2, process-management P2, workstation-management P2 (nối UI listDeleted/restore có sẵn), benchmark P3 (where-used), datasettings P3 (purge tombstone có kiểm soát), component-library P1 (xem/khôi phục package đã xoá — API includeDeleted có sẵn), products P3 (thùng rác khôi phục soft-delete), factory-layout P1 (xoá/đổi tên/nhân bản/archive layout).
- **Lifecycle status + effective dating** cho materials/suppliers/tools (draft/active/obsolete — products đã có, bất đối xứng) — benchmark P2.

### 6.3 Tìm kiếm / phân trang / bulk (P1)
- **Search + pagination server-side cho mọi list master data** (benchmark P1, md-trade-partners P1, md-materials-uom P1, products P1 — pattern đã có ở operatorBadge.list).
- **Bulk actions / mass update / dedup-merge**: chọn nhiều dòng activate/deactivate/xoá (benchmark P2, workstation P3, datasettings P2, products P2 bulk lifecycle, operator-badges P2 gán hàng loạt hàng đợi), **bulk assign / ma trận sản phẩm × máy** (product-mapping P1), multi-select + align/distribute trên canvas layout (factory-layout P3).
- **Clone/duplicate bản ghi**: package (component-library P3), workstation (P3), supplier (md-trade-partners P3), process (P3), tool/nozzle (md-workforce P3), lịch nhà máy 2026→2027 (md-calendar-inventory P2), vật liệu (md-materials-uom P3), clone cấu hình sản phẩm trong wizard (product-onboarding P2), clone dây chuyền kèm trạm+công đoạn (datasettings P3).

### 6.4 Toàn vẹn liên kết dữ liệu (P1)
- **EntityPicker/combobox thay text tự do cho mọi tham chiếu code** (materialClass, defaultSupplierCode, fromUomCode/toUomCode, materialCode/warehouseCode) + validate server-side tồn tại — benchmark P2, md-calendar-inventory P1, md-materials-uom P2.
- **Xử lý mapping mồ côi** (sản phẩm đã xoá) + cảnh báo/cascade khi xoá sản phẩm còn mapping — product-mapping P2.
- **Gán máy vào trạm / xem máy thuộc trạm** — quan hệ cốt lõi của workstation hiện không tồn tại — workstation-management P1.
- **UI gán quy trình vào dây chuyền — API đủ 5 endpoint nhưng chết (0 UI)** + routing quy trình theo sản phẩm — process-management P1×2.
- **Wire chứng chỉ vào luồng phân công operator trên UI** (backend workforceService + requiredSkillId có sẵn, UI chưa truyền → vòng kiểm tra cert chưa bao giờ chạy) — md-workforce P1.
- **AVL đa nguồn material↔supplier + workflow duyệt NCC** (approvalStatus 5 trạng thái có schema, không workflow, UI không sửa được) — benchmark P1, md-trade-partners P1.
- **Trang chi tiết/drill-down quan hệ** (supplier→materials/NCR, customer→orders; link package→Pareto/BOM) — md-trade-partners P2, component-library P2.
- **Liên kết customer↔product (part number khách hàng)** — benchmark P3.

### 6.5 Vòng đời & nghiệp vụ chuyên sâu
- **Ca làm việc (shift) trong Plant Calendar** — chỉ có dayType, chưa có định nghĩa ca; OEE/scheduling cần shift dim thật (doc 32 đã nêu) — md-calendar-inventory P1.
- **Skill Matrix view (user × skill, cảnh báo hết hạn 30/60/90 ngày)** — chuẩn IATF/ISO — md-workforce P1.
- **Tool calibration tracking** (ngày hiệu chuẩn, chu kỳ, chứng thư) — benchmark P2; **vòng đời dụng cụ tự động** (lifeUsed theo cycle, tự chuyển worn/maintenance) — md-workforce P2.
- **Barcode/QR sinh + in cho badge & tool** — benchmark P2.
- **Lịch sử thẻ + probe phân giải** (endpoint operatorBadge.resolve có sẵn, 0 UI) + filter trạng thái/nguồn — operator-badges P2/P3.
- **Stock movement log** (hoặc tối thiểu ghi người sửa số dư) — md-calendar-inventory P3.
- **Data quality dashboard** (% hoàn thiện MSL/MPN/packageId — tái dùng ý tưởng readiness score) — benchmark P2.
- **Multi-plant scoping lộ ra UI** (corporateCode/factoryCode schema có, form không expose) — benchmark P3.
- **Cây phân cấp vật tư dạng tree + validate parentCode** — benchmark P3, md-materials-uom P2.

### 6.6 Riêng từng màn hình
- **datasettings:** Tab switcher/secondary navigation cho 12 tab (P1 — điều kiện tiên quyết); tree view hierarchy nhà máy→máy (P2); regenerate/rotate API key + reveal có xác nhận (P2).
- **product-onboarding:** Resume picker "Setup đang dở" ở bước 0 (listDrafts backend có sẵn, 0 UI — P1); chặn/cảnh báo Finish khi còn bước bắt buộc (P1); nút Hủy draft (deleteDraft mồ côi — P2); hiện readiness server-side sau khi fix 500 (P2).
- **factory-layout:** layout cấp nhà máy/multi-level (schema có sẵn — P2); upload floor plan background (input có sẵn, form không expose — P2); tìm máy trên canvas (P2).
- **component-library:** UI cho geometry/courtyard/defaultDefects của footprint (backend nhận, UI không có — P2).
- **products:** cột/badge lifecycle trên row (P3).
- **process-management:** trường icon có state nhưng không có UI nhập (P3).
- **product-mapping:** xác nhận trước khi tắt mapping đang được ca sản xuất dùng (P3).

---

## 7. Cải tiến frontend đề xuất (tổng hợp)

Merge 91 mục frontendImprovements, dedup; effort S/M/L; liệt kê surface gốc.

### Nhóm A — Fix gốc rẻ nhất, tác động rộng nhất
| # | Cải tiến | Effort | Surfaces |
|---|---|---|---|
| A1 | **Sửa EntityDialog dùng chung**: chỉ gửi field khai báo trong fields[] + lọc null trước khi mutate; disable/read-only ô "Mã" khi edit; disable nút Lưu khi isPending. Backend đổi `z.string().optional()` → `.nullish()` cho notes/factoryCode/... — hồi sinh toàn bộ chức năng SỬA của 10 tab | S | md-workforce, md-calendar-inventory, md-materials-uom, md-trade-partners, benchmark |
| A2 | **Bắt unique-violation ở insertOne / err.cause.code==='23505'** → TRPCError CONFLICT + toast i18n "Mã đã tồn tại" — hết 500, hết lộ SQL (áp 9 màn) | S | md-calendar-inventory, md-materials-uom, md-workforce, md-trade-partners, workstation-management, product-mapping, component-library, datasettings, product-onboarding |
| A3 | **Lớp mapTrpcError chung** → thông điệp tiếng Việt theo code (CONFLICT/BAD_REQUEST-zod/FORBIDDEN); tuyệt đối không toast e.message thô | S | process-management, md-materials-uom, md-workforce, workstation-management, datasettings (M), md-trade-partners |
| A4 | **AlertDialog xác nhận xoá dùng chung** + nêu tên bản ghi + cảnh báo số bản ghi con/tham chiếu + (soft-delete) toast có Undo; thay window.confirm native | S | benchmark, component-library, md-trade-partners, md-workforce, md-calendar-inventory, md-materials-uom, factory-layout, process-management, operator-badges (revoke) |
| A5 | **Fix PermissionGate + Radix asChild** (đảo thứ tự lồng hoặc forward props) + grep toàn repo pattern tương tự | S | products (P0-1) |
| A6 | **openEditProductDialog(product) nhận tham số** thay vì đọc state stale | S | products |
| A7 | **Đổi `= ANY(${ids})` → `inArray()`** trong productReadinessService + error state cho panel readiness | S | products, product-onboarding |
| A8 | **Quét + sửa locale key mất placeholder {{var}}** (script so khớp en/vi/zh); tối thiểu common.errorWithMessage, common.deleteItemTitle/Confirm, products.deleteConfirmMessage, machinesDisplayed, workstationCount, stageCountLabel, confirmDeleteDescription | M | products, datasettings, workstation-management, factory-layout, product-mapping |
| A9 | **Viết lại i18n namespace các trang rác** (workstation machines.*, process.*, layout.*, products mapping.*, datasettings productCategory*/machineMapping*) vi+en+zh; i18n hoá enum (PROCESS_TYPES, toolType/toolStatus, supplierType/approvalStatus, dimension) + test CI phát hiện value dịch máy | S-M | workstation-management, process-management, factory-layout, product-mapping, datasettings, md-trade-partners, md-workforce |

### Nhóm B — Áp dụng primitive có sẵn (doc 39 W1)
| # | Cải tiến | Effort | Surfaces |
|---|---|---|---|
| B1 | **Chuyển bảng tự chế → DataTable primitive** (sort/filter/paginate/bulk-select/skeleton/empty-state); đấu total+offset backend nơi có sẵn | M (L với datasettings/products) | benchmark, component-library, workstation-management, md-trade-partners, product-mapping, operator-badges, md-workforce, md-calendar-inventory, md-materials-uom, datasettings, products |
| B2 | **FilterBar URL-sync** cho search/filter/tab — giữ trạng thái qua reload, share được link | S-M | benchmark, component-library, workstation-management, process-management, operator-badges, md-workforce, products |
| B3 | **EntityDialog/form tay → FormScaffold (RHF+zod)**: lỗi inline theo field, dấu bắt buộc, chặn số âm/0-hợp-lệ, disable khi submit | M | benchmark, component-library, workstation-management, md-trade-partners, process-management, operator-badges, factory-layout, md-workforce, md-calendar-inventory, product-onboarding (Step1) |
| B4 | **EntityPicker/Combobox có search** cho mọi tham chiếu: Material/Supplier/UoM/Warehouse preset, máy/sản phẩm ở mapping, user/skill ở cert, package ở footprint, sản phẩm ở wizard; kèm quick-create inline kiểu Odoo | S-M | benchmark ×2, product-mapping, md-materials-uom, md-workforce, component-library, product-onboarding |
| B5 | **AsyncBoundary / loading skeleton + empty state có CTA + nhánh "không khớp bộ lọc" riêng** | S | md-trade-partners, product-mapping, md-calendar-inventory, factory-layout, operator-badges, products, workstation-management |

### Nhóm C — Cải tiến theo màn hình
| # | Cải tiến | Effort | Surface |
|---|---|---|---|
| C1 | Khôi phục điều hướng tab /datasettings (TabsList theo 4 nhóm hoặc bỏ ẩn legacy menu) | S | datasettings |
| C2 | Sửa `m.type` → `machineType` trong filteredMachines/machineTypes memo | S | datasettings |
| C3 | Tab Máy dùng machine.listPaged + redact apiKey khỏi machine.list (hoặc nâng gate admin) | M | datasettings |
| C4 | Date-picker (input type=date/calendar popover) cho mọi field ngày + Select IANA timezone + format ngày vi-VN + badge hết hạn cert/tool life | S | benchmark, md-workforce, md-calendar-inventory |
| C5 | Hợp nhất View/Edit canvas layout thành 1 canvas với read-only mode thật; persist undo hoặc gỡ nút; toast sau lưu dialog vị trí; mini-map dùng width/height thật | M | factory-layout |
| C6 | Thay modal fiducial tự chế bằng Dialog primitive (fix theme/a11y/i18n/silent-error cùng lúc) | S | product-onboarding |
| C7 | Master-detail split view cho Calendar/Warehouse + month-view calendar grid | M / L | md-calendar-inventory, benchmark |
| C8 | Cascade Nhà máy→Xưởng→Chuyền trong dialog workstation + thêm select Xưởng; nhớ ngữ cảnh filter khi tạo máy | M | workstation-management, datasettings |
| C9 | Tách monolith ProductModels 4.414 dòng (ProductListPanel/ProductFormDialog/PointEditor) + nhóm 11 nút toolbar thành menu "Công cụ" | L / M | products |
| C10 | Nhóm 10 tab master-data thành 4-5 nhóm domain + badge đếm bản ghi; tách cụm "Nhân lực" | S-M | benchmark, md-workforce, md-materials-uom |
| C11 | Hiển thị cột Nhóm vật tư + Đơn vị trong bảng Materials; cột rating supplier; đếm footprint trên hàng package; format số (trim zero) | S | md-materials-uom, md-trade-partners, component-library |
| C12 | Optimistic update cho kéo-thả reorder + aria-label cho icon-button/grip | M / S | process-management |
| C13 | Nhóm dòng badge theo mã thẻ + debounce search + phân trang; empty riêng khi filter không khớp | M / S | operator-badges |
| C14 | FE precheck duplicate mapping (disable option đã gán) + highlight/scroll bản ghi vừa tạo + Switch thay icon toggle | S | product-mapping |
| C15 | Wizard: refetchOnWindowFocus thay nút "Tôi đã quay lại"; % readiness đếm cả bước skipped; truyền productModelId vào mapping.list | S | product-onboarding |
| C16 | Badge mã công đoạn pill co giãn thay vòng tròn 24px | S | datasettings |
| C17 | Panel chi tiết trạm dạng drawer (thông tin + máy thuộc trạm + lịch sử) | L | workstation-management |
| C18 | Sync tab+filter component-library lên URL + shortcut hàng package → tab footprint | S | component-library |

---

## 8. Đánh giá benchmark

*(Nội dung agent benchmark — đọc code, so chuẩn Odoo/SAP MDG/Opcenter/Tulip; điểm 5.5/10)*

Module Quản lý dữ liệu có độ **PHỦ** thực thể ấn tượng so với MES tầm trung: 10 tab master data (supplier / material + class / customer / skill + cert / tool / UoM + conversion / calendar / warehouse + location + balance), cộng component-package library chuẩn IPC (footprint, MSL, polarity), operator badge có hàng đợi auto-seen, hierarchy 7 tab trong DataSettings, và mảng Product rất mạnh (lifecycle 4 trạng thái, CSV centroid import có mapping preset, onboarding wizard, versioning điểm đo).

Tuy nhiên về độ **SÂU** quản trị dữ liệu thì thua xa chuẩn Odoo/SAP MDG: toàn bộ /master-data không có tìm kiếm/lọc/sắp xếp/phân trang (listAll đổ hết bảng), không import/export Excel/CSV, không audit trail (0 dòng audit trong masterDataRouter), xóa cứng không hộp xác nhận và không kiểm tra tham chiếu. Form dialog tự chế (EntityDialog) hở nhiều lỗi: sửa "code" được hiển thị nhưng backend âm thầm bỏ qua, supplier không sửa được approvalStatus dù cột hiển thị nó, tool không sửa được status/type.

Nghịch lý lớn nhất: các primitive chuẩn ngành (DataTable sort/filter/paginate/bulk-select 547 dòng, FilterBar URL-sync, FormScaffold RHF+zod, EntityPicker) **ĐÃ được xây trong Wave 1-2 doc 39 nhưng chưa trang master data nào dùng** — chỉ ComponentShowcase demo.

Điểm mạnh benchmark ghi nhận: RBAC module masterdata enforced cả server lẫn UI; schema chuẩn SMT (MPN/MSL J-STD-020/RoHS/packageId, supplier rating + approvalStatus 5 trạng thái, tool lifeLimit/lifeUsed); UoM conversion affine unique from→to; calendar timezone + calendar_days; Component Library là package/footprint master thật; Operator Badges có search server-side + luồng issue/re-issue/revoke đúng thiết kế AOI; mảng Product vượt chuẩn phần còn lại (lifecycle filter, centroid import + preset, measurement_point_versions, wizard resumable); Workstation/Process/DataSettings có AlertDialog xác nhận xóa + search/filter theo cây; deep-link ?tab= phản ứng; i18n 3 ngôn ngữ đầy đủ cho label master data.

Kết luận benchmark: **5.5/10 — nền backend/schema ~7/10, trải nghiệm quản trị dữ liệu ~4/10 so với chuẩn ngành.** Các khoảng trống P1 theo benchmark: import/export + template (cửa vào của mọi MDM), audit trail (ISO/IATF/SAP MDG yêu cầu change history trên vendor/item master — repo đã có measurement_point_versions + controlAudit làm mẫu), AVL đa nguồn + workflow duyệt NCC, search + phân trang server-side (pattern đã có ở operatorBadge.list, chỉ chưa nhân rộng).

---

## 9. KẾ HOẠCH CẢI TIẾN

> **TRẠNG THÁI THỰC THI (2026-07-11 — USER DUYỆT & ĐÃ THỰC THI, UNCOMMITTED):**
> **Đợt 0–4C HOÀN THÀNH & GREEN** (tsc 0 · build ✓ · 94 unit test · verify live). Tóm tắt:
> - **Đợt 0** ✅ 2 P0 (UPDATE 10 tab · nút Thêm) + root-cause (leak SQL→`dbErrors`, readiness `inArray`, i18n interpolation, apiKey, badge). Verify: spot-check live 2 P0.
> - **Đợt 1** ✅ ConfirmDeleteDialog + archive/restore + 12-tab datasettings + **RBAC split-brain→`requirePermission('settings_factory')`** + orphan/EntityPicker. Verify: RBAC runtime 403-vs-200.
> - **Đợt 2** ✅ 13 màn → DataTable/AsyncBoundary (search/sort/paginate/loading/empty). Verify: spot-check 9 trang 0 lỗi.
> - **Đợt 3** ✅ i18n: 73 key nạp + 66 rác viết lại 3 locale + `npm run i18n:check` (CI) + fix nhãn ngôn ngữ. Verify: VI/EN live.
> - **Đợt 4A** ✅ Import/Export Excel (`shared/masterDataIO`) + validate tồn tại server-side + duyệt NCC. Verify: live.
> - **Đợt 4B** ✅ Skill-matrix + process→line + máy↔trạm (mig 0244) + onboarding-guard + trang `/master-data-audit`. Verify: createCaller DB thật + browser (audit 419 record thật).
> - **Đợt 4C** ✅ Bulk mass-delete/setActive + clone + ma trận SP×máy. Verify: createCaller + browser HMR.
> - **Đợt 5** (parity) ✅ Data-Quality Dashboard (/data-quality — đếm bản ghi thiếu trường/liên kết rác) + column chooser (DataTable) + saved filter views (FilterBar) + quick-create (EntityPicker). Verify: createCaller 20/20 + browser VI/EN. → **TOÀN BỘ Đợt 0-5 + nợ nhỏ HOÀN THÀNH.**
> - **Nợ/owner:** SHIFT calendar (cần migration schema) · nạp locale cho key inline Đợt 4A-4C · commit khối uncommitted · gỡ user tạm `audit_agent`(id167) + 2 row `AUDIT_LAYOUT_QA` · bật 2FA privileged · dev-server dùng `tsx` không-watch (xem memory doc42).

Nguyên tắc: **sửa gốc trước, sửa ngọn sau** — phần lớn 208 findings quy về ~10 root cause dùng chung (EntityDialog, unique-violation, mapTrpcError, i18n placeholder, primitive adoption 0%). Mỗi đợt có green-gate riêng (tsc + build + test + **re-run live CRUD smoke bằng chính bộ script Playwright của đợt audit này**), hành vi mới đặt sau cờ khi có rủi ro. Ước lượng theo agent-wave như các doc trước.

### Đợt 0 — HỒI SINH CRUD + an toàn dữ liệu khẩn (2 P0 + root-cause chung, ~8-10 fix điểm, effort S)
| # | Việc | Root cause đóng được |
|---|---|---|
| 0.1 | **Fix EntityDialog dùng chung** (MasterDataManagement): chỉ submit field khai báo trong `fields`, lọc `null→undefined`, `Number(rating)`, khoá ô "Mã" khi edit; BE masterDataRouter: `.optional()` → `.nullish()` cho update schema | **P0 UPDATE hỏng 10 tab** /master-data (bug #1) + "sửa Mã silent-drop" |
| 0.2 | **Fix PermissionGate `asChild` nuốt props** (PermissionGate.tsx:71) + grep pattern này TOÀN repo | **P0 nút "Thêm" /products no-op** + các nút gate khác nghi hỏng |
| 0.3 | Fix `= ANY()` → `inArray()` (productReadinessService.ts:334) | readiness 500 ở /products + /product-onboarding (di sản doc 31 chết runtime) |
| 0.4 | **Handler unique-violation chung** (bắt `err.cause.code === '23505'` → TRPC CONFLICT) + toast "Mã đã tồn tại" | leak SQL INSERT ra toast ở **9 màn hình** (lỗ hổng information-disclosure) |
| 0.5 | **`mapTrpcError` client chung**: CONFLICT/zod/FORBIDDEN → thông báo tiếng Việt theo field | raw Zod JSON tiếng Anh ở ~8 màn |
| 0.6 | Fix i18n mất interpolation: `common.errorWithMessage` ({{message}}), `deleteItemTitle` ({{item}}) + A8 quét script en/vi/zh | "Lỗi với Tin nhắn"/"Xóa Mục Tiêu đề" — mọi lỗi server đang VÔ HÌNH |
| 0.7 | operator-badges: zod `.nullish()` validFrom/validTo (đang bị xoá NULL âm thầm khi gán user — mất truy xuất nguồn gốc); /products menu "Sửa" stale-closure (nguy cơ prefill/ghi đè sản phẩm KHÁC) | 2 bug ăn mòn dữ liệu âm thầm nguy hiểm nhất |
| 0.8 | **Redact `apiKey` khỏi `machine.list`** (datasettings — mọi user đăng nhập đang thấy key mọi máy) | security P2 nhưng sửa 1 dòng, làm ngay |

### Đợt 1 — Chặn phá hoại dữ liệu chủ (effort S-M)
1. **AlertDialog xác nhận xoá dùng chung** (tên bản ghi + đếm tham chiếu where-used trước khi xoá) — áp cho 10 tab master-data + component-library + workforce + calendar/inventory.
2. **Archive/soft-delete thay hard-delete** nơi schema đã hỗ trợ + **UI restore** (component-library đang có tombstone khoá mã vĩnh viễn không gỡ được).
3. **/datasettings: khôi phục điều hướng 12 tab** (TabsList nội trang — 11/12 tab đang chỉ vào được bằng URL gõ tay sau doc 36/39).
4. Thống nhất **RBAC split-brain** process-management + factory-layout (FE `settings_factory` vs BE `role==='admin'` — đúng theme doc 40).
5. product-mapping: dọn 6 mapping mồ côi "N/A" + guard khi sản phẩm/máy bị xoá; factory-layout: thêm `layout.delete`/rename + View-mode ngừng ghi DB.
6. **EntityPicker + validate tồn tại** cho quan hệ text-tự-do: material↔class↔uom, inventory balance codes (đang tạo được liên kết rác).

### Đợt 2 — Chuẩn hoá UI trên primitive doc 39 (effort M-L, nhiều agent song song)
Migrate 13 màn sang **DataTable + FilterBar (URL-sync) + FormScaffold (RHF+zod inline) + AsyncBoundary** (hiện adoption 0/13): được luôn search/sort/pagination server-side (nhân rộng pattern `operatorBadge.list`), loading skeleton, empty-state có CTA, validation inline, date-picker thay text tự do, i18n hoá enum + format ngày/số. Bổ sung field form còn thiếu so backend (supplier type/approval/phone/address…).

### Đợt 3 — Tổng vệ sinh i18n (effort M)
Viết lại namespace rác (workstation "Quản lý máy" sai title, process "Tạo Tiêu đề", product-mapping, layout) cả vi/en/zh; script CI so khớp key + placeholder 3 locale; fix app-shell "VN Tiếng Việt" khi đang en-US.

### Đợt 4 — Tính năng thiếu theo benchmark (effort M-L)
1. **Import/Export Excel/CSV + template** cho mọi bảng master data (tái dùng hạ tầng centroid-import doc 31 + universalExportService doc 32) — 12/14 agent đòi, P1.
2. **UI Audit trail** master data (backend nhiều bảng đã ghi; làm mẫu theo controlAudit/measurement_point_versions).
3. **Workflow duyệt nhà cung cấp** (schema 5 trạng thái có sẵn, UI chưa sửa được approvalStatus) + AVL.
4. **Wire các liên kết chết**: certification→gán operator, process→line (API mồ côi), gán máy→trạm, wizard onboarding guard Finish + resume-picker.
5. Bulk actions/mass update + ma trận sản phẩm×máy (product-mapping 36 card không search); clone/duplicate bản ghi; shift trong Plant Calendar (nối doc 32 shift dim); Skill Matrix + cảnh báo hết hạn cert/hiệu chuẩn tool.

### Đợt 5 — Benchmark parity (optional, effort L)
List-detail split view, inline edit, saved filters, column chooser, quick-create từ picker, data-quality dashboard (bản ghi thiếu trường). Chỉ làm sau khi Đợt 0-4 nghiệm thu.

### Nghiệm thu & vận hành
- Mỗi đợt: tsc 0 + build + test baseline + **live re-audit** các màn đã sửa bằng Playwright (script sẵn trong scratchpad audit).
- Dọn dẹp sau audit: xoá user tạm `audit_agent` (id 167), 2 layout `AUDIT_LAYOUT_QA` trong `factory_layouts` (không xoá được qua UI — chính là bug 1.5), tombstone AUDIT_* vô hại còn lại.
- Đề xuất thứ tự duyệt: **Đợt 0 + 1 duyệt gộp** (toàn fix bug, không đổi hành vi ngoài sửa lỗi) → Đợt 2, 3 → Đợt 4 duyệt từng mục → Đợt 5 tuỳ chọn.

---

## 10. Phụ lục theo màn hình

Ghi chú: screenshot nằm dưới `C:/Users/Admin/AppData/Local/Temp/claude/d--SOURCES-avi-aoi-management/5b56bf96-eb94-4d64-bb82-a9275af7375b/scratchpad/audit/<surface>/` — dưới đây liệt kê tên file.

### 10.1 component-library (uxScore 6.0)

**Summary:** Màn /component-library (doc 27 W8-A) hoạt động khá tốt ở happy-path: đủ 3 tab Package/Footprint/Liên kết vật liệu, CRUD package + footprint đều pass live với toast tiếng Việt, 44 seed package IPC-7351 hiển thị sạch, search/filter họ package chạy đúng, i18n vi đầy đủ 100% key của trang. Tuy nhiên error-path hỏng nặng: tạo trùng mã trả 500 và toast lộ nguyên câu SQL INSERT (nhánh CONFLICT trong router chết vì regex không khớp lỗi drizzle-wrapped); xoá không có xác nhận (footprint là hard-delete); và mã package đã soft-delete bị khoá vĩnh viễn — không tạo lại, không xem, không khôi phục được. Tab Liên kết vật liệu đang 0/0 vì DB chưa có materials nên chưa verify được luồng gán; phần giá trị nhất của footprint (geometry pad, courtyard) backend nhận nhưng UI không có chỗ nhập. Trang chưa dùng DataTable/FormScaffold primitive có sẵn, thiếu import/export.

**Worked:** 44 seed IPC-7351 tải nhanh + badge "Tham chiếu", 0 console error; tạo package (dialog 14 field) → toast "Đã lưu" hiện ngay; validation bắt buộc tiếng Việt; sửa package/footprint lưu đúng + invalidate; xoá soft/hard đều chạy; search + filter họ package client-side tức thời; flow footprint theo package hợp lý; switch "Chỉ hiện chưa gán" + coverage render đúng; i18n vi 100% phạm vi trang; RBAC module masterdata + không leak raw DB id.

**CRUD notes:** Package: tạo AUDIT_PKG_QA1 OK; sửa pinCount 64→100 OK; xoá (soft) OK. Footprint: tạo AUDIT_FP1 OK; sửa padCount OK; xoá (hard) OK. NHƯNG: trùng mã → 500 + toast SQL; xoá không confirm; tạo lại mã soft-deleted → 500 (tombstone khoá mã). Tab Liên kết vật liệu KHÔNG test được mutation (DB 0 materials). Cleanup: AUDIT_FP1 xoá sạch; AUDIT_PKG_QA1 chỉ soft-delete được (tombstone còn trong DB, isActive=false, UI không có cách purge).

**Screenshots (19):** 01-initial, 02-vi-locale, 03-create-dialog, 04-empty-submit-toast, 05-create-filled, 06-after-create, 07-search-audit, 08-duplicate-toast, 09-edit-dialog, 10-after-edit, 11-footprints-empty, 12-footprints-selected, 13-footprint-created, 14-footprint-edited, 15-footprint-deleted, 16-material-links, 17-only-unlinked, 18-after-delete, 19-recreate-tombstone (.png)

### 10.2 workstation-management (uxScore 4.5)

**Summary:** Trang /workstation-management có CRUD cơ bản hoạt động end-to-end: tạo, tìm kiếm, lọc theo nhà máy/dây chuyền/loại quy trình, sửa, xoá đều chạy và có toast. Tuy nhiên i18n rất kém: tiêu đề trang sai ("Quản lý máy"), nhiều chuỗi dịch máy vô nghĩa và 4 loại quy trình hiển thị nguyên raw key machines.*. Bug nặng: mã trùng → 500 + toast SQL; switch "Active" khi tạo bị bỏ qua âm thầm; xoá hard-delete trong khi backend có restore/listDeleted không nối UI. Chưa dùng primitive, thiếu import/export, thiếu hoàn toàn chức năng gán máy vào trạm.

**Worked:** List đúng cột + resolve tên nhà máy/dây chuyền; tạo có disable submit khi thiếu; sửa prefill đúng; xoá CÓ AlertDialog; search client-side; filter nhà máy refetch server-side; 4 thẻ thống kê realtime; PermissionGate + ViewOnlyBadge; load sạch 0 lỗi.

**CRUD notes:** Tạo AUDIT_WS_01/02, sửa + tắt active, xoá cả 2 qua UI thành công — không dữ liệu sót. Caveat: create switch Active OFF bị bỏ qua (P2); mã trùng → 500 lộ SQL (P1); hard-delete không khôi phục; validation chỉ disable nút, không message.

**Screenshots (14):** 01-initial, 02a-lang-menu, 02b-after-vi, 03-create-dialog, 04-processtype-options, 05-create-filled, 06-after-create, 07-duplicate-code, 08-search, 09-filter-factory, 10-edit-dialog, 11-after-update, 12-delete-confirm, 13-after-cleanup (.png)

### 10.3 md-trade-partners — /master-data tab Suppliers + Customers (uxScore 4.0)

**Summary:** CRUD scaffold mỏng: Tạo/Xem/Xoá hoạt động nhưng SỬA hỏng hoàn toàn cả hai tab — mọi lần Lưu đều 400 vì dialog gửi nguyên row DB (cột null + rating string bị zod từ chối), nghĩa là không bản ghi nào tạo từ UI này sửa được. Trùng mã leak SQL INSERT ra toast; xoá hard-delete 1 click không confirm trên dữ liệu tham chiếu bằng code (không FK). Thiếu search/filter/pagination, import/export, workflow phê duyệt NCC dù schema hỗ trợ; cột Loại/Phê duyệt hiện raw enum tiếng Anh. Layout sạch, i18n label tốt, RBAC gate đúng, nhưng chưa dùng primitive.

**Worked:** Tạo supplier/customer OK + invalidate; empty state; xoá cleanup sạch; validation required tiếng Việt; deep-link ?tab=customers; i18n label; RBAC 2 lớp; 0 console error; không leak raw DB id.

**CRUD notes:** CREATE AUDIT_SUP_01/AUDIT_CUS_01 OK. READ OK. UPDATE: FAIL 100% cả 2 tab — cả "lưu không đổi gì" lẫn "đổi tên" đều 400. DELETE hoạt động nhưng không confirm. CLEANUP: xoá sạch qua UI, 2 bảng về "Chưa có dữ liệu".

**Screenshots (16):** 01-initial-suppliers, 03-vi-suppliers-empty, 04-supplier-create-dialog, 05-supplier-empty-submit, 06-supplier-filled, 07-supplier-created, 08-supplier-edit-dialog, 09-supplier-edit-nochange-save, 10-supplier-edit-error, 11-supplier-after-edit, 12-supplier-duplicate-code, 13-customers-empty, 14-customer-created, 15-customer-after-edit, 16-customer-deleted, 17-suppliers-after-cleanup (.png)

### 10.4 product-mapping (uxScore 4.0)

**Summary:** Trang /product-mapping làm đúng CRUD cơ bản: tạo mapping máy↔sản phẩm, bật/tắt isActive, xoá có confirm — đều test live thành công, permission gate đầy đủ. Nhưng copy rất tệ: hàng loạt i18n placeholder ("Assign description", "Confirm delete title", "1 Sản phẩm assigned"); dialog xoá không hiện tên máy/sản phẩm dù code truyền tham số. Bug nặng nhất: mapping trùng → 500 + toast NGUYÊN CÂU SQL (message tiếng Việt thân thiện trong server/db/product.ts là dead code do bắt sai shape lỗi Drizzle). 6 mapping mồ côi hiển thị "N/A". 36 card máy dọc trang, không search/filter/matrix, không priority/notes dù backend hỗ trợ.

**Worked:** Tạo mapping qua dialog (picker "Tên (MÃ)", không leak id); disable submit khi thiếu; toggle isActive có toast + đổi style; xoá có AlertDialog; duplicate bị unique constraint chặn; permission 3 lớp; empty state per máy có CTA prefill; backend ghi audit log đủ; deep-link ?product= từ wizard; 0 lỗi luồng bình thường.

**CRUD notes:** CREATE pass (phải seed sản phẩm AUDIT_PM_PROD qua tRPC vì productModel.list rỗng — bản thân là finding). READ partial (6 mapping "N/A" orphan; không hiện priority/notes). UPDATE partial (chỉ toggle isActive; priority/notes không sửa được). DELETE pass. CLEANUP: xoá mapping AUDIT qua UI + sản phẩm qua API, không đụng dữ liệu agent khác.

**Screenshots (14):** 01-initial, 01-initial-full, 03-dialog-empty, 03-machine-select-open, 03-product-select-open, 03-dialog-filled, 03-after-create, 04-duplicate-error, 04-mapping-item-active, 04-mapping-item-inactive, 04-delete-confirm, 04-after-delete, 05-lang-menu, 05-after-vi-switch (.png)

### 10.5 process-management (uxScore 5.0)

**Summary:** CRUD + kéo-thả sắp xếp hoạt động đầy đủ và ổn định: tạo/sửa/xoá/lọc/reorder pass live, thứ tự persist sau reload, permission gate ẩn nút. Nhưng hoàn thiện thấp: toàn bộ i18n là dịch máy rác ở CẢ vi lẫn en; submit rỗng hiện raw Zod JSON tiếng Anh; RBAC split-brain (BE role==='admin' vs FE settings_factory). Không bật/tắt isActive được từ UI dù backend hỗ trợ; API gán quy trình vào line đã tồn tại nhưng chết (0 UI); xoá hard-delete âm thầm cascade line assignments.

**Worked:** Tạo AUDIT_PROC_01/02 (loại SMT) + toast vi; list + skeleton 5 hàng + empty state icon; sửa tên/cycle time prefill đúng; xoá có AlertDialog; trùng mã bị CONFLICT chặn đúng (message EN); kéo-thả dnd-kit persist sau reload; filter loại; PermissionGate + ViewOnlyBadge; 0 lỗi luồng hợp lệ.

**CRUD notes:** Cả 4 pass. Giá trị cycle time ÂM -5 được chấp nhận (P2). Đã xoá sạch 2 bản ghi AUDIT_ cuối phiên, list về empty. Submit rỗng bị chặn ở server (400) nhưng UX lỗi rất tệ (raw Zod JSON).

**Screenshots (15):** 01-initial, 02-vi-initial, 03-create-dialog, 04-empty-submit, 05-after-create, 06-duplicate-code, 07-after-create2, 08-filter-smt, 09-edit-dialog, 10-after-edit, 11-after-reorder, 12-reorder-persisted, 13-negative-cycletime, 14-delete-confirm, 15-after-cleanup (.png)

### 10.6 operator-badges (uxScore 6.5)

**Summary:** Trang Thẻ nhân viên hoạt động tốt ở luồng cơ bản: cấp thẻ, hàng đợi chưa gán (badge đếm), gán user, thu hồi, tái cấp, tìm kiếm — đều chạy live không lỗi console/HTTP, i18n đủ 3 ngôn ngữ. Nhưng có 1 bug P1 hỏng dữ liệu âm thầm: mọi thao tác "Gán người dùng" xoá NULL cả validFrom lẫn validTo (zod 4.3.6 parse key vắng mặt của dateInput.optional() thành null) — repro live 2 lần, xác nhận root cause bằng chính zod của repo; rủi ro gán nhầm lịch sử kiểm tra cho người mới. Không phân trang (backend cắt 200, FE bỏ qua total), thu hồi 1 click không xác nhận, thiếu import/export/bulk/lịch sử theo mã. Không có delete cứng — chỉ soft-revoke (đúng thiết kế).

**Worked:** Cấp thẻ + toast; tab Tất cả/Hàng đợi + badge đếm; search ILIKE server-side; gán user; thu hồi đóng dấu validTo; tái cấp giữ lịch sử dòng cũ; cấp trùng mã active tự đóng dòng cũ tại cutover (re-issue semantics đúng); i18n vi/en/zh đủ; RBAC masterdata 2 lớp; không leak raw id; 0 lỗi toàn phiên.

**CRUD notes:** CREATE pass (3 thẻ); READ pass; UPDATE partial — gán user thành công NHƯNG nuốt NULL validFrom+validTo (P1); không sửa được displayName/notes. DELETE n/a theo thiết kế (soft-revoke). CLEANUP: 5 dòng AUDIT_ đã thu hồi hết qua UI, còn nằm trong bảng trạng thái "Đã thu hồi" (vô hại, UI không có purge).

**Screenshots (17):** 01-initial, 02-lang-menu, 03-vi-initial, 04-issue-dialog-empty, 05-issue-dialog-filled, 06-after-create-1, 07-after-create-2, 08-unassigned-tab, 09-assign-dialog, 10-after-assign, 11-search-match, 12-search-nomatch, 13-after-revoke, 14-after-reissue, 15-duplicate-issue, 16-after-cleanup, 17-validfrom-repro (.png)

### 10.7 factory-layout — /layout (uxScore 5.5)

**Summary:** Trang /layout là canvas 2D kéo-thả vị trí máy theo workshop. Phần canvas khá tốt: render 36 máy SIM, zoom/pan/mini-map/fullscreen/snap-grid/export PNG đều chạy, kéo-thả lưu vị trí persist qua reload, 0 console error happy path. Nhưng với tư cách màn quản lý dữ liệu thì CRUD hỏng nửa: layout KHÔNG THỂ xoá/đổi tên (backend không có layout.delete, layout.update không có UI), cho trùng tên thoải mái, tab "Xem bố trí" thực chất vẫn sửa và LƯU vị trí xuống DB. i18n tiếng Việt tệ nhất: máy-dịch vô nghĩa + panel thông tin máy hardcode tiếng Anh. RBAC split-brain code-level.

**Worked:** Tải nhanh, auto-chọn workshop/layout; tạo layout + validate tên rỗng; thêm máy từ dialog lọc đúng máy chưa có; kéo-thả lưu DB persist; dialog sửa vị trí X/Y/rộng/cao/góc lưu đúng; xoá máy khỏi layout có confirm; zoom/pan/fit/fullscreen/snap/mini-map/export PNG thật; click máy tab View mở panel chi tiết; PermissionGate + deep-link ?workshopId=.

**CRUD notes:** CREATE pass (layout + thêm máy). READ pass. UPDATE partial: vị trí máy sửa được persist, NHƯNG layout không đổi tên được và undo không persist. DELETE partial: xoá machine position OK; XOÁ LAYOUT KHÔNG TỒN TẠI cả UI lẫn API. CLEANUP: xoá hết machine positions; 2 layout rỗng "AUDIT_LAYOUT_QA" KHÔNG THỂ XOÁ — cần dọn tay DB (bảng factory_layouts, workshop "Xưởng lắp ráp ảo (SIM)"). Trùng tên KHÔNG chặn. Không test được non-admin.

**Screenshots (20):** 01-initial, 02-vi-initial, 03-create-dialog, 03-empty-validation, 03-created-selected, 03-duplicate-created, 03-layout-list, 04-edit-tab-empty, 04-add-machine-dialog, 04-machine-added, 04-after-drag, 04-edit-position-dialog, 05-view-info-panel, 05-view-after-drag, 05-persisted-values, 05-after-remove, 06-nonexistent-layout, 06-after-undo, 06-after-reload, 06-3d-toggle (.png)

### 10.8 md-workforce — /master-data tab Skills + Certifications + Tools (uxScore 4.5)

**Summary:** Ba tab là CRUD generic dùng chung EntityDialog, chạy được luồng cơ bản. Nhưng UPDATE hỏng nghiêm trọng: bản ghi có field null (mọi Tool tạo từ UI, Skill không nhập category) không sửa được — 400 raw JSON. Trùng mã 500 leak SQL; xoá hard-delete 1 click; sửa "Mã" silent-drop. Về liên kết: skill/cert KHÔNG phải dữ liệu chết — backend workforceService (cảnh báo cert khi assign, sau cờ WORKFORCE_ENABLED) và fleet skillRegistry có tiêu thụ, nhưng UI SafetyWorkforce chưa truyền requiredSkillId nên vòng kiểm tra cert thực tế chưa bao giờ chạy từ giao diện. Thiếu search/filter/pagination/import-export, chưa dùng primitive.

**Worked:** Deep-link tab; tạo Skill validation tiếng Việt; cert chọn user+skill từ dropdown tên thật, đổi level, revoke OK; tạo/xoá Tool OK; i18n vi phủ tốt; RBAC đúng 2 lớp; empty state; skill/cert có đường tiêu thụ backend thật.

**CRUD notes:** CREATE pass cả 3 tab (trùng mã → 500 leak SQL). READ pass. UPDATE partial — pass khi mọi field có giá trị; FAIL 400 với field null (MỌI tool từ UI); "Mã" bị âm thầm bỏ qua. DELETE pass nhưng không confirmation. CLEANUP: xoá sạch qua UI toàn bộ AUDIT_, 0 sót.

**Screenshots (24):** 01-skills-initial, 02-certs-initial, 03-tools-initial, 04-skills-vi, 05-skill-empty-validation, 06-skill-created, 07-skill-duplicate, 08-skill-edit-dialog, 09-skill-after-edit, 10-skill-after-delete, 11-skill-code-discard, 12-certs-vi, 13-cert-dialog, 14-cert-bad-date, 15-cert-created, 16-cert-edit-dialog, 17-cert-after-edit, 18-tools-vi, 19-tool-dialog, 20-tool-negative, 21-tool-created, 22-tool-edit, 23-skills-before-cleanup, 24-skills-after-cleanup (.png)

### 10.9 md-calendar-inventory — /master-data tab Calendar + Inventory (uxScore 4.0)

**Summary:** Hai tab có khung CRUD đầy đủ (list + dialog + xóa, RBAC 2 lớp, i18n tốt) và Create/Read/Delete hoạt động live. Nhưng UPDATE gần như hỏng toàn bộ: dialog gửi nguyên row (notes/factoryCode/locationCode = null) → sửa lịch, kho, vị trí kho, tồn kho đều 400 với toast raw JSON zod. Trùng mã 500 lộ SQL + params. Xóa không xác nhận, không kiểm tra bản ghi con (không FK) gây mồ côi. Master-detail (click ô mã) khó phát hiện, không search/filter/pagination, ngày nhập text tự do.

**Worked:** Deep-link ?tab=; tạo lịch (prefill timezone), ngày lễ, kho, vị trí, tồn kho upsert đúng unique key; validation required tiếng Việt; sửa ngày CÓ ghi chú thành công (chứng minh đường update hoạt động khi không dính null); xóa các loại OK; trùng mã bị unique index chặn; i18n vi đủ; empty state; RBAC; 0 console error luồng thường.

**CRUD notes:** CREATE pass toàn bộ. READ pass (không search/pagination). UPDATE: FAIL diện rộng — calendar.update/updateWarehouse/updateLocation/updateBalance đều 400 vì null; chỉ sửa được "ngày" khi đã có ghi chú; đổi "Mã" bị bỏ qua âm thầm. DELETE pass nhưng KHÔNG confirm + không check con. CLEANUP: xóa toàn bộ AUDIT_ qua UI, DB sạch.

**Screenshots (25):** 01-calendar-initial, 02-inventory-initial, 04-after-vi, 05-cal-dialog, 06-cal-empty-validation, 07-cal-created, 08-cal-duplicate, 10-day-dialog, 11-day-bad-date, 12-daytype-options, 13-day-created, 14-day-duplicate, 15-cal-edit-dialog, 17-day-after-edit, 19-cal-deleted, 20-day-nullnotes-edit, 21-wh-dialog, 22-wh-type-options, 23-wh-created, 24-wh-edit-result, 25-loc-created, 27-balance-qty0, 28-balance-created, 29-balance-edit, 30-cleanup-done (.png)

### 10.10 md-materials-uom — /master-data tab Materials + Classes + UoM (uxScore 4.0)

**Summary:** Ba tab (MasterDataManagement.tsx ~1151 dòng tự chế) chỉ đạt mức khung sườn: Tạo/Đọc/Xóa chạy nhưng SỬA hỏng hoàn toàn — mọi lần lưu 400 zod "expected string, received null". Quan hệ material↔class↔uom (trọng tâm màn hình) không tồn tại thực tế: class/unit/quy-đổi là text tự do, tạo được vật liệu trỏ class + đơn vị không tồn tại, xóa được class đang bị tham chiếu, bảng vật liệu không hiển thị cột class/đơn vị. Lỗi thô: trùng mã 500 + SQL, raw JSON zod, xóa 1 click. Không search/filter/pagination/import-export — cả 3 bảng DB đang trống (dấu hiệu chưa ai nhập nổi dữ liệu thật).

**Worked:** Deep-link tab; tạo mới cả 3 tab + conversion, toast "Đã lưu"; validation required tiếng Việt; xóa + cleanup sạch; i18n phủ gần đủ; RBAC đúng; không leak raw id; 0 lỗi khi duyệt; layout sạch.

**CRUD notes:** CREATE pass (nhưng chấp nhận mã class/uom không tồn tại). READ pass. UPDATE: THẤT BẠI cả 3 tab (4 đường 400). DELETE pass nhưng 1 click, hard-delete, xóa được class đang tham chiếu. Cleanup: xóa toàn bộ AUDIT_ (2 material, 1 class, 2 uom, 2 conversion) qua UI.

**Screenshots (17):** 01-materials-initial, 04-lang-menu, 05-materials-vi, 06-classes-vi, 07-uom-vi, 08-class-empty-validation, 09-class-created, 10-class-duplicate-error, 11-class-after-edit, 12-uom-created, 13-uom-edit-result, 14-conversions, 15-material-create-dialog, 16-materials-list, 17-material-edit-result, 18-materials-after-class-deleted, 19-after-cleanup (.png)

### 10.11 products (uxScore 4.0)

**Summary:** Màn /products (ProductModels.tsx — monolith 4.414 dòng) có nền chức năng rất rộng (search/filter/sort server-side, clone sâu, import centroid, panel N-up, fiducials, MSA, golden samples) nhưng CRUD lõi gãy nặng: nút "Thêm" hoàn toàn no-op (P0) nên KHÔNG THỂ tạo sản phẩm; menu "Sửa" dùng state cũ — lần đầu không mở gì và có thể mở form với dữ liệu sản phẩm KHÁC; API readiness 500 liên tục (SQL ANY) khiến badge độ hoàn thiện chết toàn trang. Toast lỗi hiện "Lỗi với Tin nhắn" (mất {{message}}) nên lỗi server không bao giờ tới người dùng; dialog xóa hiện "Xóa Mục Tiêu đề". Xóa (soft-delete + audit log) và tìm kiếm/lọc hoạt động tốt, không leak raw DB id.

**Worked:** Search server-side đúng; filter vòng đời; sort 6 lựa chọn server-side; xóa soft-delete + audit log (4 lần pass); clone dialog dịch tốt + chặn trùng 409; update endpoint chặn trùng + NOT_FOUND đúng; không leak raw id; empty state ban đầu có hướng dẫn; permission defense-in-depth; không lỗi console ngoài 500 readiness + 409 chủ đích.

**CRUD notes:** CREATE: fail — nút Thêm no-op; phải seed 4 bản AUDIT_SP qua tRPC. READ: pass. UPDATE: partial — dialog chỉ mở khi đã chọn trước (stale-state), không hoàn tất được rename qua UI trong phiên. DELETE: pass. CLEANUP: xóa toàn bộ AUDIT_SP01..04 qua UI. Lưu ý: sản phẩm "AUDIT_WZ01" (id 2) tồn tại từ trước của agent khác — giữ nguyên.

**Screenshots (21):** 01-initial, 02-vi-initial, 03-create-dialog, 08-addbtn-noop, 09-list-with-product, 10-selected-product, 11-search-hit, 12-search-empty, 13-filter-archived, 14-row-dropdown, 15-edit-dialog, 17-edit-dup-code, 18-clone-dialog, 19-clone-dup, 20-delete-confirm, 21-after-delete, 22-edit-dialog-open, 25-cleanup-done, 26-edit-wrong-prefill, 27-after-wrong-save, 28-final-cleanup (.png)

### 10.12 product-onboarding (uxScore 6.0)

**Summary:** Wizard 9 bước (doc 31 WD-1) hoạt động end-to-end: tạo sản phẩm AUDIT_WZ01, đi đủ 9 bước không có bước chết, deep-link sang trình chỉnh sửa điểm/mapping mở đúng + preselect đúng, fiducial CRUD đầy đủ, i18n vi 100% phần wizard, 0 console error luồng chính. Nhưng "resumable" chỉ đúng một nửa: mở lại route trần là mất chỗ (listDrafts/deleteDraft backend xây sẵn cho resume-picker nhưng 0 UI); sau Finish + reload toàn bộ trạng thái biến mất. Bốn lỗi nặng: readiness 500 mọi lần gọi; trùng mã leak SQL; modal fiducial trắng-trên-trắng dark theme; lưu fiducial rỗng 400 nhưng UI im lặng. "Hoàn tất cấu hình" cho chốt setup ở 25% với 4/6 bước bắt buộc chưa làm, không cảnh báo.

**Worked:** Bước 1 validate + toast + tự sang bước 2, draft tự lưu; 9 bước đủ, stepper phi tuyến, khóa đúng khi chưa chọn SP; resume qua deep-link ?product= đúng bước/%; deep-link mở /products preselect đúng; fiducial CRUD phản ánh ngay vào %; skip/un-skip persist qua deep-link; bước Release nhúng ProgramReleasePanel thật với SoD; Review 8 metric + checklist trung thực; i18n vi đủ; 0 lỗi luồng chính.

**CRUD notes:** Cả 4 pass (sản phẩm + fiducial). Delete fiducial dùng window.confirm native; wizard KHÔNG có UI xoá draft (deleteDraft mồ côi). Cleanup: xoá AUDIT_WZ01 qua kebab /products; 1 row product_onboarding_drafts status='completed' của sản phẩm đã xoá còn lại trong DB — không UI nào xoá được, vô hại nhưng orphan.

**Screenshots (29):** 01-initial, 02-empty-validation, 03-filled-form, 04-after-create, 05-plain-reload, 06-select-dropdown, 07-after-select, 08-deeplink-resume, 09-vietnamese, 10-fiducial-dialog, 13-step-points, 14-points-editor-popup, 15-step-thresholds, 16-step-golden, 17-golden-skipped, 18-step-panel, 19-step-release, 20-step-mapping, 21-review, 22-fiducial-empty-save, 23-fiducial-added, 24-fiducial-edited, 25-fiducial-deleted, 26-after-finish, 27-reload-after-finish, 28-duplicate-code, 29-products-page, 30-kebab-menu, 31-delete-confirm, 32-after-delete (.png)

### 10.13 datasettings (uxScore 4.5)

**Summary:** Hub 12 tab (nhà máy/xưởng/chuyền/trạm/máy/ca/công đoạn/danh mục SP/mapping/quy trình/trạm làm việc/seed-data) với CRUD lõi tốt: tạo–đọc–sửa–xóa nhà máy, ca, công đoạn đều pass với toast tiếng Việt, soft-delete + khôi phục, Excel import/export thật. Nhưng trang mất hoàn toàn điều hướng tab: menu dọc bị ẩn (doc 36) + row ?tab= sidebar bị gỡ (doc 39) mà không có TabsList thay thế — 11/12 tab chỉ vào bằng URL tay. Submit rỗng raw Zod JSON; trùng mã 500 lộ SQL; i18n máy-dịch hàng loạt; filter loại máy chết (m.type vs machineType); copy API Key rỗng vẫn báo thành công; machine.list leak apiKey cho mọi user đăng nhập.

**Worked:** 12 tab render đủ khi vào bằng URL, 0 lỗi happy path; CRUD nhà máy trọn vòng với soft-delete; CRUD ca có validation client tử tế (nút disabled, "Định dạng không hợp lệ"); CRUD công đoạn + reorder; toggle "Hiển thị mục đã xóa" + Khôi phục; Excel export tải file thật; search + filter cascade; dialog xóa hiện đúng tên + cascade-info; backend mọi mutation adminProcedure + audit trail; seed-data gated admin + cảnh báo dev.

**CRUD notes:** Test 3 entity: Nhà máy (AUDIT_FAC_01 trọn vòng, xóa mềm), Ca (AUDIT_CA), Công đoạn (AUDIT_STAGE) — đều pass. CLEANUP: ca + công đoạn xóa hẳn; nhà máy AUDIT là SOFT-DELETE — tombstone còn trong "Hiển thị mục đã xóa" (UI không có purge). Không đụng SIM-* và bản ghi AUDIT của agent khác; không bấm seed-data. Validation create chỉ tốt ở shift/stage; factory/workshop/line/station/machine → raw Zod JSON + 500 SQL.

**Screenshots (42):** 01-initial, 02-lang-menu, 02-after-vi, 03-sidebar-factoryconfig, 03-tab-workshops, 03-tab-lines, 03-tab-stations, 03-tab-machines, 03-tab-shifts, 03-tab-stages, 03-tab-product-categories, 03-tab-product-machine-mapping, 03-tab-process-management, 03-tab-workstation-mgmt, 03-tab-seed-data, 04-validation-empty, 04-create-filled, 04-after-create, 04-duplicate, 04-search, 04-edit-dialog, 04-after-update, 05-cascade-dialog, 05-after-delete, 05-show-deleted, 05-machine-type-filter, 06-shift-dialog, 06-shift-invalid-code, 06-shift-created, 06-shift-row-menu, 06-shift-updated, 06-shift-delete-confirm, 06-shift-deleted, 07-stage-dialog, 07-stage-filled, 07-stage-created, 07-excel-menu, 07-excel-after, 08-stage-delete-confirm, 08-stage-deleted, 09-apikey-copy (.png)

### 10.14 benchmark (uxScore 5.5 — đọc code, không chạy browser)

**Summary:** Xem §8. **Worked** (điểm mạnh kiến trúc): 10 tab CRUD đủ với RBAC masterdata 2 lớp; schema chuẩn SMT (MPN/MSL/RoHS/packageId; supplier rating + approvalStatus; tool lifeLimit/lifeUsed); UoM dimension + conversion affine; Component Library là package/footprint master thật với auto-link theo packageType; Operator Badges search server-side + luồng issue/re-issue/revoke + hàng đợi auto_seen; mảng Product vượt trội (lifecycle 4 trạng thái, centroid import + preset, measurement_point_versions, wizard resumable); Workstation/Process/DataSettings có AlertDialog + search/filter cây; deep-link ?tab= + i18n 3 ngôn ngữ đủ label.

**CRUD notes:** Benchmark đọc code, không chạy browser — không test CRUD live. Về mặt code: cả 10 tab đủ create/read/update/delete qua tRPC masterData.* với RBAC, nhưng update dính lỗi field code silent-drop và delete là hard-delete không xác nhận.

**Screenshots:** không có (agent đọc code).

---

*Nguồn: journal `wf_e9ffdb98-b13/journal.jsonl` (14 result). Báo cáo tổng hợp bởi technical writer agent, 2026-07-11. Trung thực 100% với dữ liệu nguồn — mọi con số/evidence lấy nguyên văn từ result các agent.*
