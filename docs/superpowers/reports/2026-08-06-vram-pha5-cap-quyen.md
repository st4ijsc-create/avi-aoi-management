# LƯỢT CẤP QUYỀN — Pha 5 module điều phối VRAM

**Ngày:** 2026-08-06 · **Nhánh:** `feat/hmi-dep` · **HEAD:** `ebfec4a5`
**Loại việc:** GHI DỮ LIỆU THẬT VÀO DB (DML). **KHÔNG viết mã. KHÔNG DDL. KHÔNG đổi khuôn vai.**
**Uỷ quyền:** chủ dự án đã duyệt tường minh (gồm cả hệ quả `machine_control/canView` ở §6).

> Báo cáo này được ghi **DẦN**: §1–§3 viết **trước** khi ghi bất cứ gì; §4–§5 viết sau lượt ghi.

---

## 1. Xác định DB đang chạy (đo, không đoán)

`.env` dòng 10 (dòng `DATABASE_URL` **không** bị comment):

```
DATABASE_URL=postgresql://avi_app:***@127.0.0.1:5434/aoi_management
```

Ba dòng `DATABASE_URL` khác trong `.env` (Supabase pooler, `aoi@…/aoi_management`, `postgres@localhost:5433`)
đều **đã comment** ⇒ không hiệu lực.

**Tự kiểm bằng chính kết nối đó** (không tin tên trong chuỗi):

```
select current_database(), current_user, current_schema(), version()
```
```json
[{ "db": "aoi_management", "usr": "avi_app", "schema": "public",
   "ver": "PostgreSQL 17.10 (Ubuntu 17.10-1.pgdg22.04+1) on x86_64-pc-linux-gnu …" }]
```

✅ Tên DB **khớp** chuỗi kết nối (một báo cáo trước từng khai nhầm — lần này đã tự kiểm).
Driver: gói **`postgres` v3.4.8** (`package.json`); gói `pg` **không tồn tại** trong dependencies — đúng như brief cảnh báo.

### 1b. Điều kiện ghi (đo trước, để biết lượt ghi có khả thi không)

| kiểm | kết quả |
|---|---|
| quyền của `avi_app` trên `public.permissions` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` ✅ |
| trigger trên `permissions` (WORM?) | **rỗng** — bảng này **không** nằm dưới WORM ✅ |
| RLS trên `permissions` | `relrowsecurity=false`, `relforcerowsecurity=false` ✅ |
| ràng buộc duy nhất | `idx_permissions_user_module` UNIQUE `("userId","moduleName")` ✅ ⇒ upsert đúng ngữ nghĩa được |

### 1c. Hình dạng bảng — xác nhận **0 DDL**

`public.permissions` (15 cột): `id · userId · category · moduleName · canView · canCreate · canEdit ·
canDelete · canExport · customPermissions · grantedBy · grantedAt · expiresAt · createdAt · updatedAt`.

- `moduleName` = `character varying(100)` **tự do** ⇒ `'vram_control'` là **một HÀNG**, không migration.
- `category` = enum `permissioncategoryenum` **NOT NULL**; giá trị `machine_control` **đã có sẵn** trong enum
  (`drizzle/schema/auth.ts:51`) và chính mã máy chủ khai dùng lại nó cho `vram_control`
  (`server/routers/permissionsRouter.ts:825`) ⇒ **không đụng enum**.

⇒ **Không có bước nào cần `CREATE`/`ALTER`/`DROP`.** Nếu có, tôi đã dừng và hỏi.

---

## 2. Trạng thái TRƯỚC — nguyên văn

### Q6 — user có vai `supervisor` / `engineer`

```sql
SELECT id, username, name, role, "isActive" FROM users
WHERE role IN ('supervisor','engineer') ORDER BY role, id;
```
```json
[
  { "id": 49, "username": "supervisor1", "name": "Chị Hương (Quản đốc)",  "role": "supervisor", "isActive": true },
  { "id": 51, "username": "engineer1",   "name": "Anh Minh (Kỹ sư TĐH)",  "role": "engineer",   "isActive": true }
]
```

### Q6b — histogram vai (TOÀN BỘ user, để biết phạm vi thật)

| role | tổng | đang hoạt động |
|---|---|---|
| `admin` | 3 | 2 |
| `supervisor` | **1** | **1** |
| `operator` | 2 | 1 |
| `maintenance` | 1 | 1 |
| `engineer` | **1** | **1** |

⇒ **Phạm vi lượt cấp = đúng 2 user** (49, 51). Không có `quality_inspector`/`viewer`/`user` nào tồn tại.

### Q7 — mọi hàng `permissions` của HAI module cần chạm (toàn bộ user)

```sql
SELECT p.id, p."userId", u.username, u.role, p.category, p."moduleName",
       p."canView", p."canCreate", p."canEdit", p."canDelete", p."canExport",
       p."grantedBy", p."grantedAt", p."expiresAt"
FROM permissions p LEFT JOIN users u ON u.id = p."userId"
WHERE p."moduleName" IN ('vram_control','machine_control')
ORDER BY p."moduleName", p."userId";
```
```json
[
  { "id": 43, "userId": 49, "username": "supervisor1", "role": "supervisor",  "category": "machine_control",
    "moduleName": "machine_control", "canView": true, "canCreate": true, "canEdit": true,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-07-10T15:40:57.490Z", "expiresAt": null },
  { "id": 65, "userId": 50, "username": "maint1",      "role": "maintenance", "category": "machine_control",
    "moduleName": "machine_control", "canView": true, "canCreate": false, "canEdit": true,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-07-10T15:40:57.564Z", "expiresAt": null },
  { "id": 79, "userId": 51, "username": "engineer1",   "role": "engineer",    "category": "machine_control",
    "moduleName": "machine_control", "canView": true, "canCreate": true, "canEdit": true,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-07-10T15:40:57.629Z", "expiresAt": null }
]
```

### Q9 — đếm

```json
[{ "vram_rows": 0, "mc_rows": 3, "supervisors": 1, "engineers": 1 }]
```

---

## 3. ★★★ PHÉP ĐO LẬT MỘT DÒNG CỦA BẢNG CẤP QUYỀN

Bảng trong brief có **ba dòng**. Phép đo ở §2 cho thấy **dòng thứ ba đã đúng từ trước**:

| dòng brief | user | trạng thái TRƯỚC | việc phải làm |
|---|---|---|---|
| `supervisor` → `vram_control` `canCreate=true,canDelete=true` | 49 | **không có hàng** | **INSERT** |
| `engineer` → `vram_control` `canCreate=true,canDelete=false` | 51 | **không có hàng** | **INSERT** |
| `supervisor`+`engineer` → `machine_control` `canView=true` | 49, 51 | **`canView` ĐÃ = `true`** (hàng `id=43`, `id=79`, cấp từ **2026-07-10**) | **KHÔNG ĐỔI GÌ** (0 hàng) |

**Hệ quả có ý nghĩa với §6:** **30 thủ tục dùng chung `machine_control/canView` KHÔNG PHẢI do lượt cấp
này mở ra — chúng đã mở với cả `supervisor1` lẫn `engineer1` từ 2026-07-10**, gần một tháng trước Pha 5.
Lượt cấp này **không làm rộng thêm** bề mặt đó **một thủ tục nào**. Nó chỉ thêm **1** thủ tục thật sự mới
với hai user ấy — `vram.state` — vì `vram.state` là thủ tục **duy nhất trong 31** vừa được gắn lên bit này
ở Pha 5. §6 vẫn được ghi đầy đủ vì chủ dự án cần **biết bề mặt đang mở là gì**, nhưng nó là **status quo**,
không phải delta.

⚠ **Hai điều KHÔNG được làm dù bảng brief ghi `false`:** hàng `id=43` và `id=79` hiện có
`canCreate=true, canEdit=true` trên `machine_control`. Bảng brief ghi cột `canCreate=false / canDelete=false`
cho dòng thứ ba — đó là giá trị cho **một hàng MỚI**, không phải lệnh hạ quyền. Ràng buộc *"không ghi đè
hàng đang có, chỉ bật `canView`, giữ nguyên các cột khác"* **thắng** ⇒ **giữ nguyên `canCreate=true`,
`canEdit=true`**. (Cả hai hàng đều đã `canDelete=false` sẵn — khớp brief.)

---

## 4. Lượt GHI

### 4.1 Câu lệnh đã chạy (một transaction, `postgres` v3)

**Bước A — hai hàng `vram_control` (INSERT thuần; §2 đã đo `vram_rows = 0` nên không có gì để ghi đè):**

```sql
INSERT INTO permissions ("userId", category, "moduleName",
                         "canView","canCreate","canEdit","canDelete","canExport")
VALUES (49, 'machine_control', 'vram_control', false, true,  false, true,  false),
       (51, 'machine_control', 'vram_control', false, true,  false, false, false)
RETURNING id, "userId", "moduleName", "canView","canCreate","canEdit","canDelete","canExport";
```

**Bước B — bật `canView` trên `machine_control`, CÓ ĐIỀU KIỆN, không đụng cột khác:**

```sql
UPDATE permissions
   SET "canView" = true, "updatedAt" = now()
 WHERE "userId" IN (49, 51)
   AND "moduleName" = 'machine_control'
   AND "canView" IS DISTINCT FROM true
RETURNING id, "userId";
```

Vì sao viết dạng này thay vì upsert đầy đủ:
- `WHERE … AND "canView" IS DISTINCT FROM true` ⇒ nếu bit đã bật (đúng trường hợp thật) thì
  **0 hàng bị đụng**, `updatedAt` **không** bị bump, không tạo nhiễu trong sổ.
- `SET` chỉ liệt kê **một** cột boolean ⇒ **không thể** vô tình hạ `canCreate`/`canEdit`.
- **Không** `DELETE`-rồi-`INSERT` (đó chính là lớp lỗi của `batchUpdateUserPermissions`, xem §7).

### 4.2 Kết quả lượt ghi

| bước | hàng bị đụng | kỳ vọng | khớp |
|---|---|---|---|
| A — `INSERT` `vram_control` | **2** | 2 | ✅ |
| B — `UPDATE` `machine_control.canView` | **0** | 0 (bit đã bật từ 2026-07-10) | ✅ |
| **TỔNG hàng đổi** | **2** | | |

Hàng vừa tạo (nguyên văn `RETURNING`):

```json
[
  { "id": 760, "userId": 49, "moduleName": "vram_control",
    "canView": false, "canCreate": true, "canEdit": false, "canDelete": true,  "canExport": false,
    "grantedBy": null, "grantedAt": "2026-08-06T13:27:42.914Z", "expiresAt": null },
  { "id": 761, "userId": 51, "moduleName": "vram_control",
    "canView": false, "canCreate": true, "canEdit": false, "canDelete": false, "canExport": false,
    "grantedBy": null, "grantedAt": "2026-08-06T13:27:42.914Z", "expiresAt": null }
]
```

`grantedBy` để **NULL** — lượt cấp này chạy **thẳng vào DB**, không có admin nào bấm nút, nên gán một
`userId` vào ô ấy sẽ là **bịa một tác nhân**. Ba hàng `machine_control` có sẵn cũng `grantedBy = null`
⇒ nhất quán với quy ước đang có. `expiresAt` để **NULL** (grant không hết hạn) — brief không yêu cầu hạn.

---

## 5. Trạng thái SAU — nguyên văn (CÙNG câu `SELECT` của §2)

### Q7 (sau)

```sql
SELECT p.id, p."userId", u.username, u.role, p.category, p."moduleName",
       p."canView", p."canCreate", p."canEdit", p."canDelete", p."canExport",
       p."grantedBy", p."grantedAt", p."expiresAt"
FROM permissions p LEFT JOIN users u ON u.id = p."userId"
WHERE p."moduleName" IN ('vram_control','machine_control')
ORDER BY p."moduleName", p."userId";
```
```json
[
  { "id": 43,  "userId": 49, "username": "supervisor1", "role": "supervisor",  "category": "machine_control",
    "moduleName": "machine_control", "canView": true,  "canCreate": true, "canEdit": true,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-07-10T15:40:57.490Z", "expiresAt": null },
  { "id": 65,  "userId": 50, "username": "maint1",      "role": "maintenance", "category": "machine_control",
    "moduleName": "machine_control", "canView": true,  "canCreate": false, "canEdit": true,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-07-10T15:40:57.564Z", "expiresAt": null },
  { "id": 79,  "userId": 51, "username": "engineer1",   "role": "engineer",    "category": "machine_control",
    "moduleName": "machine_control", "canView": true,  "canCreate": true, "canEdit": true,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-07-10T15:40:57.629Z", "expiresAt": null },
  { "id": 760, "userId": 49, "username": "supervisor1", "role": "supervisor",  "category": "machine_control",
    "moduleName": "vram_control",    "canView": false, "canCreate": true, "canEdit": false,
    "canDelete": true,  "canExport": false, "grantedBy": null, "grantedAt": "2026-08-06T13:27:42.914Z", "expiresAt": null },
  { "id": 761, "userId": 51, "username": "engineer1",   "role": "engineer",    "category": "machine_control",
    "moduleName": "vram_control",    "canView": false, "canCreate": true, "canEdit": false,
    "canDelete": false, "canExport": false, "grantedBy": null, "grantedAt": "2026-08-06T13:27:42.914Z", "expiresAt": null }
]
```

### Q9 (sau) — đếm

```json
[{ "vram_rows": 2, "mc_rows": 3, "supervisors": 1, "engineers": 1 }]
```

| số | TRƯỚC | SAU | đổi |
|---|---|---|---|
| hàng `vram_control` | **0** | **2** | **+2** ✅ |
| hàng `machine_control` | **3** | **3** | **0** ✅ (không tạo, không xoá, không sửa) |
| tổng hàng `permissions` toàn bảng | **85** | **87** | **+2** — không hàng nào khác bị chạm |

### Kiểm bất biến (khẳng định phủ định — chứng minh cái KHÔNG xảy ra)

Chụp **toàn bộ 15 cột** của ba hàng `machine_control` (`id` 43/65/79) trước và sau, so **chuỗi hoá**:

| bất biến | câu kiểm | kết quả |
|---|---|---|
| ba hàng `machine_control` **y hệt** trước/sau, **mọi cột** | `JSON.stringify(before) === JSON.stringify(after)` | ✅ **`YES`** — `updatedAt` vẫn là `2026-07-10T15:40:57…`, **không** bump |
| `machine_control.canDelete` của 49/51 vẫn `false` | `SELECT "userId","canDelete" … 'machine_control' AND "userId" IN (49,51)` | ✅ `49:false`, `51:false` |
| user vai **không phải** `supervisor`/`engineer` có hàng `vram_control`? | join `users` `WHERE role NOT IN (…)` | ✅ **`[]`** (rỗng) |
| `vram_control` có bit `canView`/`canEdit`/`canExport` nào bật? | `WHERE "canView" OR "canEdit" OR "canExport"` | ✅ **`[]`** (rỗng) — mặt đọc **không** ở bit này, đúng N8 |
| `engineer1.vram_control.canDelete` (**phải** `false` — không được thu hồi VRAM) | join `users` `WHERE role='engineer'` | ✅ `{ "userId": 51, "canDelete": false }` |
| tổng bảng chỉ +2 | `count(*)` | ✅ 85 → 87 |

---

## 6. Bề mặt `machine_control/canView` — ghi lại CHÍNH XÁC cái gì đang mở

Nguồn: §I-4 của `docs/superpowers/reports/2026-08-06-vram-pha5-review-toan-nhanh.md`, đối chiếu lại
bằng `grep 'requirePermission("machine_control", "canView")' server/` ở HEAD `ebfec4a5` (bỏ file test).

**31 điểm gọi / 31 thủ tục / 9 router. `31/31` đứng trên `protectedProcedure` TRẦN** — **không** role-floor,
**không** 2FA, **không** step-up OTP. VRAM chiếm **1**; **30** thủ tục còn lại là **bề mặt dùng chung**:

| # | thủ tục | router : dòng | mở ra cái gì |
|---|---|---|---|
| 1 | `vram.state` | `vramRouter.ts:137` | **← thủ tục VRAM DUY NHẤT.** Trạng thái điều phối VRAM (`processKey`/`owner`/`leaseKey`) |
| 2 | `commandLog.list` | `commandLogRouter.ts:35` | ⚠ **nhật ký lệnh máy** — danh sách |
| 3 | `commandLog.get` | `commandLogRouter.ts:61` | ⚠ **nhật ký lệnh máy** — chi tiết một lệnh |
| 4 | `commandLog.stats` | `commandLogRouter.ts:71` | ⚠ thống kê lệnh máy |
| 5 | `commandLog.avgDurations` | `commandLogRouter.ts:96` | ⚠ thời lượng trung bình lệnh máy |
| 6 | `robot.list` | `robotRouter.ts:46` | danh sách robot + bề mặt kết nối |
| 7 | `robot.get` | `robotRouter.ts:56` | chi tiết một robot |
| 8 | `robot.vendorValidation` | `robotRouter.ts:68` | bản đồ vendor → trạng thái kiểm chứng |
| 9 | `robot.interlockPreview` | `robotRouter.ts:173` | ⚠ **ma trận interlock an toàn** (xem trước) |
| 10 | `deviceAdapter.list` | `deviceAdapterRouter.ts:96` | danh sách adapter thiết bị |
| 11 | `deviceAdapter.get` | `deviceAdapterRouter.ts:116` | cấu hình một adapter |
| 12 | `deviceAdapter.testConnection` | `deviceAdapterRouter.ts:211` | ⚠⚠ **CHẠM MẠNG OT** — mở kết nối thật tới thiết bị |
| 13 | `deviceAdapter.tags.listByAdapter` | `deviceAdapterRouter.ts:267` | danh sách tag theo adapter |
| 14 | `mtconnect.testConnection` | `mtconnectRouter.ts:19` | ⚠⚠ **CHẠM MẠNG OT** — probe MTConnect Agent |
| 15 | `mtconnect.status` | `mtconnectRouter.ts:34` | trạng thái poller MTConnect |
| 16 | `machineRecipe.recipes.listCodes` | `machineRecipeRouter.ts:243` | mã công thức + phiên bản đang chạy |
| 17 | `machineRecipe.recipes.listVersions` | `machineRecipeRouter.ts:262` | lịch sử phiên bản công thức |
| 18 | `machineRecipe.recipes.get` | `machineRecipeRouter.ts:269` | nội dung một công thức máy |
| 19 | `machineRecipe.recipes.getActive` | `machineRecipeRouter.ts:278` | công thức đang hoạt động |
| 20 | `machineRecipe.recipes.genealogy` | `machineRecipeRouter.ts:436` | phả hệ nạp công thức (`recipe_load_log`) |
| 21 | `machineRecipe.deployments.list` | `machineRecipeRouter.ts:443` | lịch sử triển khai công thức |
| 22 | `machineRecipe.machines.list` | `machineRecipeRouter.ts:485` | máy ↔ công thức |
| 23 | `machineRecipe.changeover.list` | `machineRecipeRouter.ts:603` | hàng đợi duyệt đổi công thức |
| 24 | `unsMapping.list` | `unsMappingRouter.ts:63` | ánh xạ Tag → UNS |
| 25 | `unsMapping.get` | `unsMappingRouter.ts:68` | chi tiết một ánh xạ |
| 26 | `unsMapping.preview` | `unsMappingRouter.ts:123` | xem trước kết quả ánh xạ |
| 27 | `aiOrchestration.status` | `aiOrchestrationRouter.ts:69` | trạng thái cố vấn điều phối AI |
| 28 | `aiOrchestration.suggestWorkflow` | `aiOrchestrationRouter.ts:78` | đề xuất quy trình |
| 29 | `aiOrchestration.optimizeWorkflow` | `aiOrchestrationRouter.ts:116` | tối ưu quy trình |
| 30 | `mappingAsCode.list` | `mappingAsCodeRouter.ts:59` | danh sách file YAML ánh xạ |
| 31 | `mappingAsCode.exportOne` | `mappingAsCodeRouter.ts:64` | export cấu hình adapter ra YAML |

**Tổng theo router:** `machineRecipe` 8 · `robot` 4 · `deviceAdapter` 4 · `commandLog` 4 · `unsMapping` 3 ·
`aiOrchestration` 3 · `mtconnect` 2 · `mappingAsCode` 2 · `vram` **1** = **31**.

**★ Đọc bảng này cùng §3:** cả 30 thủ tục trên **đã** trong tầm với của `supervisor1` và `engineer1`
**từ 2026-07-10** — lượt cấp hôm nay **không** thêm cái nào. Cái duy nhất lượt này làm với bit đó là:
`vram.state` (dòng #1) vừa được **gắn lên** bit ấy ở Pha 5, nên nay hai user đọc được trạng thái VRAM.
Danh sách 30 dòng kia là **hiện trạng cần biết**, không phải hậu quả của lượt ghi này.

---

## 7. ⚠⚠⚠ BA ĐƯỜNG XOÁ SẠCH GRANT — khi nào phải cấp lại

`vram_control` **cố ý KHÔNG** nằm trong `DEFAULT_ROLE_PERMISSIONS` (`shared/permissions.ts:122`) — đó
chính là thứ làm phép tách an toàn. **Hệ quả không tránh được:** bất kỳ đường nào **tái dựng** bộ quyền
của user từ khuôn vai hoặc từ màn hình sẽ **xoá mất** hai hàng vừa cấp, **âm thầm, không cảnh báo**.

| # | đường | mã | chuyện gì xảy ra |
|---|---|---|---|
| **1** | nút **"Áp dụng quyền mặc định"** | `permissions.applyRolePermissions` — `server/routers/permissionsRouter.ts:453-483`, UI `client/src/components/RoleManagement.tsx` | `DELETE` **toàn bộ** hàng quyền của user rồi `INSERT` lại từ `DEFAULT_ROLE_PERMISSIONS`. `vram_control` **không** trong khuôn ⇒ **mất hẳn**. |
| **2** | nút **Lưu** của màn **Phân quyền** | `permissions.batchUpdateUserPermissions` — `permissionsRouter.ts:663-686`, UI `client/src/components/PermissionsManagement.tsx:126` | `DELETE` **toàn bộ** hàng quyền của user rồi `INSERT` đúng những gì **màn hình đang giữ**. Một tab mở **trước** lượt deploy máy chủ (khi danh mục chưa có `vram_control`) sẽ lưu đè và **gỡ sạch** grant. |
| **3** | **đổi vai** của user | luồng quản trị user | vai mới kéo theo khuôn vai mới ⇒ cùng cơ chế đường 1. |

**⚠ Thứ tự phát hành đúng là BA nhịp** (I-5 của review toàn nhánh): **deploy MÁY CHỦ → cấp quyền → deploy CLIENT.**
`vram_control` chỉ xuất hiện trong danh mục qua **một hàng mã máy chủ** (`permissionsRouter.ts:825`,
trả bởi `permissions.getAvailableModules`), và `PermissionsManagement.tsx:123` lấy danh sách **chỉ** từ đó.
Chưa deploy máy chủ ⇒ màn Phân quyền **không hiện** `vram_control` ⇒ mọi lượt bấm **Lưu** ở màn ấy là
**đường xoá sạch số 2 đang nổ**.

### Câu kiểm nhanh — chạy LẠI sau MỖI lượt bảo trì vai / mỗi lượt lưu màn Phân quyền

```sql
SELECT "userId","canCreate","canDelete" FROM permissions WHERE "moduleName"='vram_control';
```

**Kỳ vọng đúng (đúng 2 hàng):**

| `userId` | `canCreate` | `canDelete` | ai |
|---|---|---|---|
| 49 | `true` | `true`  | `supervisor1` — preempt · releaseStale · retryDeferred |
| 51 | `true` | `false` | `engineer1` — **chỉ** retryDeferred |

**0 hàng ⇒ grant đã bị xoá sạch, mọi lệnh VRAM trở lại `403`, phải cấp lại.**

Kết quả **thật** ngay sau lượt cấp (nguyên văn, chạy đúng câu trên):

```json
[{ "userId": 49, "canCreate": true, "canDelete": true },
 { "userId": 51, "canCreate": true, "canDelete": false }]
```

---

## 8. Bảng quyền — hiệu lực sau lượt cấp

| user | vai | module | canView | canCreate | canEdit | canDelete | canExport | mở ra |
|---|---|---|---|---|---|---|---|---|
| `supervisor1` (49) | `supervisor` | **`vram_control`** *(MỚI, id **760**)* | `false` | **`true`** | `false` | **`true`** | `false` | `vram.preempt` · `vram.releaseStale` · `vram.retryDeferred` |
| `engineer1` (51) | `engineer` | **`vram_control`** *(MỚI, id **761**)* | `false` | **`true`** | `false` | `false` | `false` | **chỉ** `vram.retryDeferred` |
| `supervisor1` (49) | `supervisor` | `machine_control` *(id 43, KHÔNG ĐỔI)* | `true` | `true` | `true` | `false` | `false` | `vram.state` + 30 thủ tục ở §6 |
| `engineer1` (51) | `engineer` | `machine_control` *(id 79, KHÔNG ĐỔI)* | `true` | `true` | `true` | `false` | `false` | `vram.state` + 30 thủ tục ở §6 |

**Đúng thứ KHÔNG cấp:** `machine_control/canDelete` vẫn `false` cho cả hai ⇒ **9 thủ tục phá huỷ**
đứng trên bit đó — gồm `programming.deleteProject` (**xoá cascade cây mã nguồn có phiên bản, không OTP**)
— **vẫn đóng**. Đó là toàn bộ lý do Task 3b tồn tại, và nó **giữ được** sau lượt cấp này.

---

## 9. Xác nhận ràng buộc

| ràng buộc | trạng thái | bằng chứng |
|---|---|---|
| **0 DDL** | ✅ | chỉ `INSERT` + `UPDATE` có điều kiện; `moduleName` là `varchar(100)` tự do, `category` dùng lại giá trị enum **đã có** |
| **Không đổi `DEFAULT_ROLE_PERMISSIONS` / khuôn vai** | ✅ | `git status --porcelain -- shared/ server/ client/` = **0 mục**; không file mã nào bị sửa |
| **Đo trước, ghi sau** | ✅ | §2 chạy và dán **trước** §4 |
| **Không ghi đè hàng đang có** | ✅ | `UPDATE` chỉ `SET "canView"`, có `WHERE … IS DISTINCT FROM true` ⇒ **0 hàng**; `canCreate`/`canEdit` của id 43/79 nguyên vẹn |
| **Không `DELETE` rồi `INSERT`** | ✅ | không có câu `DELETE` nào trong lượt ghi |
| **Chỉ 2 module** | ✅ | `WHERE "moduleName" IN ('vram_control','machine_control')` — tổng bảng +2 hàng, không hàng nào khác đổi |
| **Chỉ user vai `supervisor`/`engineer`** | ✅ | chỉ `userId ∈ {49, 51}`; `admin` (3 user), `operator` (2), `maintenance` (1) **không bị chạm** |
| **Không `kb:sync`, không trainer, không seed** | ✅ | không chạy |
| **Không sinh sub-agent** | ✅ | |
| **Không đụng 243 mục bẩn trong `git status`** | ✅ | không `git add`, không `git checkout`, không dọn |
| **Không nghiệm thu sống** | ✅ | không gọi thủ tục VRAM nào; đây là việc riêng có kịch bản 14 bước |

**Trạng thái cây sau lượt cấp (đo, không khai):**

| kiểm | kết quả |
|---|---|
| `git rev-parse HEAD` | `ebfec4a5a9d71bee2250bd26c64100bcfcd0a21c` — **không đổi**, không commit |
| `git status --porcelain -- server/ client/ shared/ drizzle/` | **0 mục** ✅ |
| `git status --porcelain -- docs/superpowers/reports/` | `?? …2026-08-06-vram-pha5-cap-quyen.md` (**untracked**, không stage) |
| `git status --porcelain \| wc -l` | **244** = **243 mục bẩn của việc khác** (không đụng, không dọn, không stage) **+ 1** = chính báo cáo này |

**File duy nhất tôi tạo trong repo:** chính báo cáo này
(`docs/superpowers/reports/2026-08-06-vram-pha5-cap-quyen.md`) — **không stage, không commit**.
Hai script dùng để đo và ghi nằm **ngoài repo**, trong thư mục tạm của phiên.

---

## 10. MỐI LO

1. **★★ `vram_control` là hàng MỒ CÔI — ba đường ở §7 xoá nó, không đường nào cảnh báo.** Không có
   ràng buộc DB, không có test, không có job canh. Một lượt bảo trì vai bình thường của admin sẽ gỡ
   grant, và triệu chứng duy nhất là `403` lúc cần thu hồi VRAM nhất. **Câu kiểm §7 phải vào quy trình
   vận hành**, không để trong một báo cáo.
2. **★★ Thứ tự phát hành: máy chủ ở HEAD `ebfec4a5` đã DEPLOY chưa?** Tôi **không đo được** điều này
   trong phạm vi lượt cấp (không nghiệm thu sống). Nếu máy chủ **chưa** deploy: (a) grant vẫn nằm đúng
   trong DB và sẽ có hiệu lực ngay khi deploy; nhưng (b) **màn Phân quyền hiện tại không hiện
   `vram_control`**, nên **bất kỳ lượt bấm Lưu nào ở màn ấy, từ giờ đến lúc deploy, sẽ xoá sạch hai
   hàng vừa cấp**. ⇒ **Đề nghị: đừng động vào màn Phân quyền cho user 49/51 cho tới khi client deploy xong.**
3. **★ Phạm vi thật nhỏ hơn nhiều so với hình dung: đúng 1 supervisor + 1 engineer.** Nếu hệ thật sắp có
   thêm người vai đó, **họ sẽ KHÔNG tự có `vram_control`** (không trong khuôn vai) ⇒ phải cấp tay từng
   người. Đây là **giá phải trả có chủ ý** của phép tách bit, cần ghi vào tài liệu vận hành.
4. **★ `machine_control/canView` đã mở 30 thủ tục kia từ 2026-07-10** — trong đó `deviceAdapter.testConnection`
   và `mtconnect.testConnection` **chạm mạng OT thật**, và `commandLog.*` phơi **nhật ký lệnh máy**, tất cả
   trên `protectedProcedure` **trần**. Lượt cấp này không làm nó tệ thêm, nhưng **hiện trạng ấy vẫn là
   một khoản nợ RBAC** đáng mở phiếu riêng — đúng tinh thần I-4.
5. **★ `grantedBy = NULL`** ⇒ trong sổ **không có tác nhân** cho hai hàng này. Ai đọc DB sau này sẽ không
   biết chúng từ đâu ra ngoài báo cáo này. Tôi chọn `NULL` thay vì bịa một `userId` admin. Nếu chủ dự án
   muốn dấu vết, hãy gán tay `grantedBy` = id của admin đã duyệt.
6. **★ `expiresAt = NULL`** ⇒ grant **vĩnh viễn**. Với `supervisor1.canDelete=true` (quyền **phá huỷ**:
   thu hồi VRAM của tiến trình khác) đây là lựa chọn mạnh. Brief không yêu cầu hạn, nên tôi không tự đặt —
   nhưng nếu chính sách muốn grant có hạn, đây là chỗ đặt.
7. **Chưa nghiệm thu sống.** Báo cáo này chứng minh **hàng đã nằm đúng chỗ trong DB**. Nó **không** chứng
   minh `vram.preempt` chạy được, cũng không chứng minh `engineer1` bị chặn đúng. Sổ nợ Pha 5 vẫn ghi
   *"chưa nghiệm thu sống"* — lượt cấp này **không** đóng mục đó.
