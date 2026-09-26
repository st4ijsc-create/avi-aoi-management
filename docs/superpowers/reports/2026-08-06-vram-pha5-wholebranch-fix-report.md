# Vá phát hiện review TOÀN NHÁNH — Pha 5 (module điều phối VRAM)

**Nhánh:** `feat/hmi-dep` · **HEAD lúc bắt đầu:** `13116471075b4ff99cd79be13f8548cebb0ed4b3`
**Nguồn yêu cầu:** `docs/superpowers/reports/2026-08-06-vram-pha5-review-toan-nhanh.md`
(1 Critical · 5 Important · 5 Minor)

> **Ghi DẦN.** Mỗi mục được viết ngay sau khi làm xong, không viết trước.

---

## 0. Baseline — đo trước khi đụng vào bất cứ thứ gì

| kiểm | lệnh | kết quả |
|---|---|---|
| HEAD | `git rev-parse HEAD` | `13116471…` ✅ |
| cây bẩn của việc khác | `git status --porcelain \| wc -l` | **243** — không đụng ✅ |
| `.env` step-up | `grep ACTUATION_STEPUP_2FA .env` | `:568` `=true` — **đang bật** ✅ |
| `owner` sản xuất | `server/services/ai/ocrService.ts:384` | `onnx-ocr:${modelPath}` — đường dẫn tuyệt đối ✅ |
| cổng ĐẦY ĐỦ trước khi sửa | 11 đường, `ls` kiểm từng cái | **100 file / 1692 ca PASS** |

---

## 1. 🔴 C-1 — hai cổng "nguồn ĐỘC LẬP" nay canh **ÁNH XẠ**, không canh **TẬP**

### Chẩn đoán được xác nhận

Cả hai cổng rút ra một **TẬP** chuỗi `module/action` rồi so tập. Hoán vị `canDelete` ↔ `canCreate`
giữa hai thủ tục **giữ nguyên tập** ⇒ cả hai xanh. Điều **chưa từng được phát biểu** là ánh xạ
***thủ tục → cổng***.

### Bản vá — neo vào **KHOÁ CỦA ROUTER**, không vào tên biến

⚠ Tôi **không** dùng nguyên đề xuất của reviewer (`{vramDestructiveProcedure: …}` — keyed theo **tên
biến**). Lý do: đổi tên biến là một lượt dọn dẹp **hợp lệ**, còn đổi *cái mà `preempt` đứng trên* là
một quyết định an ninh. Neo vào tên biến sẽ **bắt nhầm** lượt đầu và **bỏ lọt** lượt sau (một alias
`const congPhaHuy = vramActuationProcedure` giữ nguyên mọi tên). ⇒ Bất biến neo vào
`preempt`/`releaseStale`/`retryDeferred`/`state`, và mang **CẢ HAI trục**: **sàn danh tính** + **cổng
thẩm quyền**.

**`server/routers/vramPermissionSplit.test.ts` — khối D mới** (`anhXaThuTuc()` + 10 ca):

```ts
const HINH_DANG_MONG_DOI = {
  state:         { san: "protectedProcedure",  cong: "machine_control/canView" },
  preempt:       { san: "deployProcedure",     cong: "vram_control/canDelete" },
  releaseStale:  { san: "deployProcedure",     cong: "vram_control/canDelete" },
  retryDeferred: { san: "actuationProcedure",  cong: "vram_control/canCreate" },
};
```

**`client/src/lib/vramCommandReach.role.unit.test.ts`** — `cuaMayChu(): string[]` (tập) thay bằng
`congTheoThuTuc(): {anhXa, mu}` (ánh xạ), rồi ghép **hai bảng của client**:
`VI_TU_THEO_THU_TUC` (thủ tục → vị từ nút) ⊕ `CONG_CUA_VI_TU` (vị từ → `VRAM_LENH_GATE.*`) và đòi
kết quả bằng **đúng** bit máy chủ đứng trên, **theo từng thủ tục**. Ngoài ra khoá **hai chiều tập
thủ tục** (thêm một lệnh ở máy chủ mà client chưa khai nút ⇒ ĐỎ).

⚠ **Hai bộ quét CỐ Ý vẫn độc lập về mã** (không gộp thành một helper dùng chung): gộp lại thì client
và máy chủ **đồng ý theo cấu tạo**, tức xoá sạch cái duy nhất khiến câu *"gương khớp máy chủ"* có
nghĩa. Lý do này được viết thẳng vào docstring của cả hai file.

⚠ **"Lưới DẪN người ta tới đâu"** — reviewer cảnh báo lưới ánh xạ có thể **ép người sau đặt tên** cho
sàn. Đã đóng bằng một ca riêng: chain **inline** `preempt: deployProcedure.use(requirePermission(…))`
vẫn phân giải **ĐÚNG**; chỉ **thiếu cổng** hoặc **hai cổng chồng nhau** mới rơi vào nhánh mù (ĐỎ).

**Ca đổi tên bị đổi lời:** `"KHAI ĐỦ và KHAI ĐÚNG ba cổng"` → `"KHAI ĐỦ … (TẬP; ánh xạ xem khối D)"`
— nó tự xưng "KHAI ĐÚNG" trong khi chỉ kiểm "KHAI ĐỦ" (lớp lỗi 7).

---

## 2. 🟠 I-1 — cổng thiếu **HAI** file, và bản vá không phải "thêm hai đường"

Rà lại toàn bộ theo câu hỏi *"file test nào cưỡng chế bất biến Pha 5 mà không có trong cổng?"*:

| file | vai trò | có trong cổng cũ? |
|---|---|---|
| `server/routers/vramPermissionSplit.test.ts` | **toàn bộ** cưỡng chế Task 3b (662 dòng) | ❌ **KHÔNG** |
| `server/services/aiCopilotActions.hardlinkSink.test.ts` | lưới **Task 1 / C-1** — ba sink của `preview()` ghi vào DB + sổ audit | ❌ **KHÔNG** — *phần tử thứ N+1 mà reviewer dự đoán* |
| 12 file còn lại tự khai `Pha 5` | | ✅ đã phủ |

**Bản vá thật: `server/services/vram/vramPha5Gate.test.ts` (mới, 6 ca).** Nó **đọc chính khối lệnh
§Cổng kiểm chung ra khỏi file kế hoạch** (không giữ bản sao thứ hai) rồi cưỡng chế:

1. **mọi đường của cổng TỒN TẠI trên đĩa** (một đường gõ sai = một đường vitest bỏ qua im lặng);
2. ***MỌI `*.test.ts` tự khai `"Pha 5"` phải được một đường của cổng phủ*** — đối tượng **tự khai**,
   nên một lưới Pha 5 mới ở bất kỳ thư mục nào cũng tự vào lượng từ;
3. **ghim SỐ**: `CONG.length === 11` và `FILE_PHA5.length === 16` — co/nở im lặng là **ĐỎ**;
4. hai ca "KHÔNG BẮT NHẦM" cho vị từ phủ (`server/services/vramOther/` **không** nằm trong
   `server/services/vram/`).

⚠ Vẫn **KHÔNG dùng glob để CHẠY** cổng (Global Constraints: glob rỗng ⇒ vitest im lặng khai XANH,
đã che 18 ca đỏ thật). Lưới chỉ kiểm rằng danh sách tường minh ấy **ĐỦ**.

Kế hoạch đã cập nhật: `docs/superpowers/plans/2026-08-06-vram-pha5-tra-no.md` §Cổng kiểm chung
(11 đường) + khối giải thích I-1.

---

## 3. 🟠 I-2 — bề rộng `owner`: một hằng, hai người đọc, một ca vòng-tròn

**Mới: `server/services/vram/vramColumnLimits.ts`** — `VRAM_OWNER_MAX = 160` ·
`VRAM_LEASE_KEY_MAX = 200` · `VRAM_PROCESS_KEY_MAX = 96`. Module **không phụ thuộc gì** (cố ý: cả
tầng sổ lẫn tầng router nhập nó ⇒ một phụ thuộc là một vòng nhập tiềm tàng).

| trước | sau |
|---|---|
| `vramSharedLedger.ts:590` `cat(lease.request.owner, 160)` | `cat(lease.request.owner, VRAM_OWNER_MAX)` |
| `vramSharedLedger.ts:585,586,453` `200` / `96` chép tay | `VRAM_LEASE_KEY_MAX` / `VRAM_PROCESS_KEY_MAX` |
| `vramRouter.ts:146,156,167` `.max(160)` / `.max(200)` | `.max(VRAM_OWNER_MAX)` / `.max(VRAM_LEASE_KEY_MAX)` |

**Ca vòng-tròn** (`server/routers/vramRouter.commands.test.ts`, 4 ca mới) đi qua **schema thật** bằng
`createCaller()`, không dựng zod thứ hai:

- `owner` dài **đúng** `VRAM_OWNER_MAX`, dựng theo **hình dạng sản xuất** (`onnx-ocr:` + đường dẫn),
  **và** được `rowFromLease()` ghi **nguyên vẹn** ⇒ `preempt`/`retryDeferred` **KHÔNG ném**;
- `owner` dài `VRAM_OWNER_MAX + 1` ⇒ **bị chặn ở cửa** (nới router mà không nới cột chỉ dời chỗ nói dối);
- chuỗi **đã bị sổ chung cắt** phải đi ngược qua được lệnh (đây là ô làm `.max(64)` ĐỎ);
- `leaseKey` nay có đối chứng ở tầng sổ (**M-5** đóng luôn: `.max(200)` trước đây không có vế nào).

**⚠ CÒN MỞ, cố ý không vá (ghi rõ lý do):** đầu thứ ba của I-2 — sổ chung **cắt âm thầm** `owner`
của hộ anh em (không cờ `truncated`). Đóng nó đúng cách là **nới cột DB** (DDL — bị cấm ở lượt này)
hoặc **thêm một ô cờ vào mặt đọc** (đổi kiểu bề mặt `VramAgentState`, vượt phạm vi một lượt vá
review). ⇒ Mang sang Pha 6, xem §8.

---

## 4. 🟠 I-3 — "an toàn là HỆ QUẢ", lần thứ TƯ: hai nửa nay được ghép

`client/src/lib/vramPanelStepUp.unit.test.ts` trước đây **chép tay** hai danh sách
(`PHA_HUY = ["preempt","releaseStale"]`, `KHONG_STEP_UP = "retryDeferred"`) kèm một chú thích trỏ
tới số dòng của `vramRouter.ts` — tức **nửa MÁY CHỦ chưa từng được đọc bằng máy**.

Nay hai danh sách **SUY RA TỪ MÁY CHỦ** qua `mutationCuaMayChu()` (đọc `vramRouter.ts` bằng AST:
khoá-router → `{san, khaiTotp}`, mở cả `...totp` spread), và bất biến được phát biểu **đủ hai vế**:

> ∀ thủ tục đứng sau `requireFreshTotp`: `input` **PHẢI** khai `totpCode`, **VÀ** mọi `p.mutate(` ở
> panel **PHẢI** nằm trong `stepUp.guard(...)` và gửi `totpCode`.
> ∀ thủ tục **không** đứng sau nó: **cả hai điều trên PHẢI SAI**.

8 ca mới, gồm lưới-cho-lưới chạy **chính đột biến W3** và chiều ngược (hạ `preempt` xuống
`actuationProcedure`), cộng ca *"gỡ `totpCode` khỏi `input`"* và hai ca KHÔNG-BẮT-NHẦM.

⚠ Điểm quan trọng: câu lỗi nay chỉ **ĐÍCH DANH `retryDeferred`**
(`expect(phaHuy.filter(k => !khaiTotp)).toEqual(["retryDeferred"])`) — bản trước đỏ ở một ca chỉ
đường tới `preempt`, đúng cảnh báo *"một cổng có thể bắt đúng lỗi rồi chỉ đường tới bản vá sai"*.

---

## 5. 🟠 I-4 — bảng **31 thủ tục `machine_control/canView`** (KHÔNG TỰ QUYẾT — trình chủ dự án)

Tự đếm bằng AST (`requirePermission("machine_control","canView")`, bỏ chú thích và file test), giải
qua biến thủ tục để lấy **sàn thật**:

| # | router | thủ tục | sàn | 2FA? | hậu quả nếu vai sai chạm tới |
|---:|---|---|---|---|---|
| 1 | `machineRecipeRouter.ts` | `list` (×3 điểm gọi) | `protectedProcedure` | ❌ | đọc **công thức máy** (tham số vận hành sản phẩm) |
| 2 | `machineRecipeRouter.ts` | `get` | `protectedProcedure` | ❌ | đọc một công thức đích danh |
| 3 | `machineRecipeRouter.ts` | `getActive` | `protectedProcedure` | ❌ | công thức đang chạy trên máy |
| 4 | `machineRecipeRouter.ts` | `listCodes` | `protectedProcedure` | ❌ | danh mục mã công thức |
| 5 | `machineRecipeRouter.ts` | `listVersions` | `protectedProcedure` | ❌ | lịch sử phiên bản công thức |
| 6 | `machineRecipeRouter.ts` | `genealogy` | `protectedProcedure` | ❌ | phả hệ công thức ↔ lô sản xuất |
| 7 | `robotRouter.ts` | `list` | `protectedProcedure` | ❌ | danh sách robot của nhà máy |
| 8 | `robotRouter.ts` | `get` | `protectedProcedure` | ❌ | cấu hình một robot |
| 9 | `robotRouter.ts` | `interlockPreview` | `protectedProcedure` | ❌ | **ma trận interlock an toàn** |
| 10 | `robotRouter.ts` | `vendorValidation` | `protectedProcedure` | ❌ | kết quả kiểm định vendor |
| 11 | `deviceAdapterRouter.ts` | `list` | `protectedProcedure` | ❌ | **topo thiết bị + adapter** |
| 12 | `deviceAdapterRouter.ts` | `get` | `protectedProcedure` | ❌ | cấu hình một adapter |
| 13 | `deviceAdapterRouter.ts` | `listByAdapter` | `protectedProcedure` | ❌ | điểm đo theo adapter |
| 14 | `deviceAdapterRouter.ts` | `testConnection` | `protectedProcedure` | ❌ | **chạm mạng OT** (dò kết nối) |
| 15 | `commandLogRouter.ts` | `list` | `protectedProcedure` | ❌ | ⚠ **NHẬT KÝ LỆNH MÁY** — ai ra lệnh gì, lúc nào |
| 16 | `commandLogRouter.ts` | `get` | `protectedProcedure` | ❌ | một bản ghi lệnh đích danh |
| 17 | `commandLogRouter.ts` | `stats` | `protectedProcedure` | ❌ | thống kê lệnh |
| 18 | `commandLogRouter.ts` | `avgDurations` | `protectedProcedure` | ❌ | thời lượng lệnh trung bình |
| 19 | `unsMappingRouter.ts` | `list` | `protectedProcedure` | ❌ | **ánh xạ UNS** (không gian tên hạ tầng) |
| 20 | `unsMappingRouter.ts` | `get` | `protectedProcedure` | ❌ | một ánh xạ đích danh |
| 21 | `unsMappingRouter.ts` | `preview` | `protectedProcedure` | ❌ | xem trước dữ liệu theo ánh xạ |
| 22 | `aiOrchestrationRouter.ts` | `status` | `protectedProcedure` | ❌ | trạng thái điều phối AI |
| 23 | `aiOrchestrationRouter.ts` | `suggestWorkflow` | `protectedProcedure` | ❌ | gợi ý luồng (tiêu tài nguyên AI) |
| 24 | `aiOrchestrationRouter.ts` | `optimizeWorkflow` | `protectedProcedure` | ❌ | tối ưu luồng (tiêu tài nguyên AI) |
| 25 | `mtconnectRouter.ts` | `status` | `protectedProcedure` | ❌ | trạng thái cầu MTConnect |
| 26 | `mtconnectRouter.ts` | `testConnection` | `protectedProcedure` | ❌ | **chạm mạng OT** |
| 27 | `mappingAsCodeRouter.ts` | `list` | `protectedProcedure` | ❌ | ánh xạ-dạng-mã |
| 28 | `mappingAsCodeRouter.ts` | `exportOne` | `protectedProcedure` | ❌ | **xuất** một ánh xạ ra file |
| 29 | `vramRouter.ts` | `state` | `protectedProcedure` | ❌ | ← **thứ duy nhất Pha 5 cần** |

*(29 dòng thủ tục **phân biệt**; **31 điểm gọi** — `machineRecipeRouter.list` xuất hiện ở **3** điểm
gọi. Reviewer đếm 31 theo **điểm gọi**; hai con số khớp nhau.)*

**Tổng: 31 điểm gọi / 29 thủ tục / 9 router. `31/31` đứng trên `protectedProcedure` TRẦN** — không
role-floor, không 2FA. VRAM chiếm **1**; **28 thủ tục khác** đi kèm miễn phí với hàng quyền
`machine_control/canView`.

**⇒ Chưa cấp. Chưa quyết. Trình chủ dự án.** Ba lựa chọn, đều là quyết định RBAC, không phải kỹ thuật:
1. **Cấp như kế hoạch** — chấp nhận `supervisor`/`engineer` đọc được cả 28 thủ tục kia;
2. **Tách nốt bit đọc** (`vram_control/canView`) — ⚠ phải đổi **CÙNG LÚC** `requiredPermission` của
   tool `get_vram_state` (`server/services/aiLocalTools/vramTools.ts:455`), nếu không **khe N8 mở
   lại**. Lưới `vramReadModel.guard.test.ts:223` sẽ ĐỎ đúng lúc nếu chỉ đổi một bên — lưới ấy **có
   răng** và **nằm trong** cổng;
3. **Cấp cho `engineer`, chưa cấp cho `supervisor`** — thu hẹp bề mặt, đổi lấy việc `supervisor`
   thấy panel nhưng không đọc được số.

Khối chặn đã ghi vào **file kế hoạch** (§THỨ TỰ PHÁT HÀNH), trỏ về bảng này.

---

## 6. 🟠 I-5 — thứ tự phát hành viết lại thành **BA NHỊP** + đường xoá sạch **THỨ BA**

`docs/superpowers/plans/2026-08-06-vram-pha5-tra-no.md` §THỨ TỰ PHÁT HÀNH:

| nhịp | việc | kiểm ĐO ĐƯỢC |
|---|---|---|
| **1** | **Deploy MÁY CHỦ** (chưa client) | `permissions.getAvailableModules` trả hàng `moduleName='vram_control'` |
| **2** | **Cấp quyền per-USER** | `SELECT * FROM permissions WHERE "moduleName"='vram_control'` ⇒ đúng số hàng duyệt |
| **3** | **Deploy CLIENT** | `supervisor` vào `/ai-brain` thấy SỐ THẬT, nút chạy |

Lý do nhịp 1 là bắt buộc: `vram_control` chỉ vào danh mục qua **mã máy chủ**
(`permissionsRouter.ts:825` → `permissions.getAvailableModules`), và
`PermissionsManagement.tsx:123` lấy danh sách module **chỉ** từ thủ tục ấy ⇒ chưa deploy máy chủ thì
**admin không cấp được**.

**Ba đường xoá sạch grant** (đã ghi vào kế hoạch): `applyRolePermissions` ·
`applyBuiltInRoleToUser` · ⚠ **MỚI — nút *Lưu* của chính màn Phân quyền**
(`batchUpdateUserPermissions` `DELETE` **toàn bộ** hàng quyền của user rồi chèn lại đúng những gì màn
hình đang giữ, `permissionsRouter.ts:663-686`). Một tab mở từ **trước** nhịp 1 lưu lại là **âm thầm
gỡ** grant, không cảnh báo.

---

## 7. 🟡 Năm Minor

| # | trạng thái | bản vá |
|---|---|---|
| **M-1** | ✅ đính chính + **phát hiện mới** | `shared/permissions.ts` — docstring nay nói **sự thật**: test CI ấy **chưa bao giờ tồn tại**, `isValidPermissionModule` là **mã chết**. ⚠ Và tôi **cố ý không dựng** cái lưới ấy: đo trước cho thấy **33** tên module được dùng qua `requirePermission` trên `server/**`, trong đó **6 tên KHÔNG có trong `PERMISSION_MODULES`** — `masterdata` · `dashboard_export` · `settings_workshop` · `settings_production_line` · `settings_station` · `settings_workstation` ⇒ lưới sẽ **ĐỎ ngay lần chạy đầu**, và đóng nó là một quyết định RBAC **ngoài phạm vi VRAM**. Ghi vào nợ. |
| **M-2** | ✅ đính chính | Docstring của `PERMISSION_MODULES` nay phát biểu luật **đúng** (phần lớn seed theo vai; một số **cố ý** chỉ per-USER, và mỗi ngoại lệ phải nói lý do tại dòng của nó) thay vì một luật mà `vram_control` cố ý vi phạm. |
| **M-3** | ✅ sửa LỜI | `vramCommandReach.ts` — nêu rõ câu *"hai phía trả lời cùng một câu"* **chỉ đúng khi `RBAC_SCOPED_ADMIN` TẮT**; cờ không có trong `.env` ⇒ chưa sống; ai bật phải sửa `usePermissions.hasPermission` **trước**, đó là bất biến TOÀN hệ, **không vá lén ở đây**. |
| **M-4** | ✅ sửa LỜI (2 chỗ) | `vramRouter.ts` + `shared/permissions.ts` — bỏ chữ *"OTP tươi"*; nêu `stepUpVerifiedUntil` là **cache 10 phút theo `sessionToken`, dùng chung cho MỌI `deployProcedure`**. |
| **M-5** | ✅ đóng bằng mã | Hằng dùng chung `VRAM_OWNER_MAX`/`VRAM_LEASE_KEY_MAX`/`VRAM_PROCESS_KEY_MAX` (§3). |

---

## 8. Còn MỞ — mang sang Pha 6 (kèm lý do không vá ở lượt này)

1. **I-2 đầu thứ ba** — sổ chung **cắt âm thầm** `owner` của hộ anh em (không cờ `truncated`). Đóng
   đúng cách = **nới cột DB** (DDL — cấm ở lượt này) **hoặc** thêm một ô cờ vào `VramAgentState`
   (đổi kiểu bề mặt đọc, vượt phạm vi một lượt vá review). Trần nay là **một** con số nên lượt nới
   là một thay đổi ba-chỗ-cùng-lúc, có địa chỉ.
2. **M-1 phát sinh** — **6 `moduleName` được dùng qua `requirePermission` mà không có trong
   `PERMISSION_MODULES`**. Mỗi tên hoặc là một "permission ma" (chỉ admin qua được) phải seed, hoặc
   là một alias phải khai. Quyết định RBAC toàn hệ.
3. **I-4** — bảng 31 điểm gọi chờ chủ dự án; **chặn nhịp 2** của thứ tự phát hành.
4. Nợ có trước, **loại trừ tường minh, không đụng**: `canUseAgentic({role:"engineer"})` · flake
   `wiring.inprocess` + `visionControl.tools` · 16 file đỏ `server/routers/**` · 10 ca đỏ
   `server/services/ai/**` (`42501`). **Không mục nào xuất hiện trong cổng** — 102/102 file xanh.

---

## 9. Cổng — chạy ĐỦ, `ls` kiểm từng đường TRƯỚC khi tin

Cổng nay **11 đường** (9 cũ + `vramPermissionSplit.test.ts` + `aiCopilotActions.hardlinkSink.test.ts`).
`ls` kiểm: **11/11 OK**.

| cổng | trước lượt vá | sau lượt vá |
|---|---|---|
| cổng ĐẦY ĐỦ (11 đường, tường minh) | 100 file / 1692 ca | **102 file / 1729 ca PASS** |
| cùng bộ + `--sequence.shuffle.tests` | — | **102 file / 1729 ca PASS** |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run check` | exit 0 | **exit 0** |
| `npm run check:tests` | exit 0 | **exit 0** |
| `npm run i18n:check` | 0 lệch | **0 key lệch en/vi/zh** |

Ca mới: `vramPermissionSplit` 17→**27** · `vramCommandReach.role` 56→**62** ·
`vramPanelStepUp` 9→**17** · `vramRouter.commands` 28→**32** · `vramPha5Gate` **6** (file mới).

---

## 10. Đột biến — **COMMIT TRƯỚC, ĐỘT BIẾN SAU**

Commit `fd48307f` ⇒ **rồi mới** đột biến. Sau **mỗi** lượt: `git checkout HEAD -- server/routers/vramRouter.ts`,
`git status --porcelain -- server/ client/ shared/` ⇒ **0 mục**, và chạy lại **TOÀN BỘ**.

| # | đột biến (chạm **duy nhất** `server/routers/vramRouter.ts`) | kết quả cổng ĐẦY ĐỦ | ca ĐỎ đích danh |
|---|---|---|---|
| **W1** | hoán vị `canDelete` ↔ `canCreate` giữa hai thủ tục | **7 ca đỏ / 2 file** | **CỔNG AST MÁY CHỦ:** `★★★ C-1 — ÁNH XẠ thủ tục → (sàn, cổng) … > ★★★ mã SẢN XUẤT ở HEAD: từng khoá đứng ĐÚNG cặp của nó — và 0 ô mù`<br>**CỔNG AST CLIENT:** `Task 3b + C-1 … > ★★★ C-1 — ÁNH XẠ thủ tục → bit khớp TỪNG CẶP giữa vramRouter và vị từ nút mà client chọn`<br>+ 3 ca meta client (`W1`, `HÌNH DẠNG CỦA TÔI`, `KHÔNG BẮT NHẦM`) dựng mutant **trên nguồn đã bị hoán vị**<br>+ 2 ca runtime cũ ở `vramPermissionSplit` |
| **W2b** | `owner .max(VRAM_OWNER_MAX)` → `.max(64)` | **2 ca đỏ / 1 file** | `★★★ I-2 — bề rộng ô DANH TÍNH … > ★★★ owner DÀI ĐÚNG BẰNG trần sổ chung ⇒ lệnh KHÔNG ném; nó trả DỮ LIỆU có reason`<br>`★★★ I-2 … > ★★★ HAI VẾ ĐỌC CÙNG MỘT HẰNG — sổ chung cắt ở ĐÚNG chỗ lệnh từ chối` |
| **W3** | `retryDeferred` sàn `actuationProcedure` → `deployProcedure` | **10 ca đỏ / 3 file** | **CỔNG AST MÁY CHỦ:** `★★★ C-1 — ÁNH XẠ … > ★★★ mã SẢN XUẤT ở HEAD …` (trục **SÀN**)<br>`★★★ I-3 — NỬA MÁY CHỦ … > ★★★ ∀ thủ tục đứng sau requireFreshTotp: input của nó PHẢI khai totpCode` ← **chỉ ĐÍCH DANH `retryDeferred`**<br>`★★★ I-3 — NỬA MÁY CHỦ … > ★★★ cầu chì — đọc được cả ba mutation và 0 ô mù`<br>`★★★ F1 … > ★★★ CẢ HAI lệnh phá huỷ: .mutate( nằm TRONG stepUp.guard(...) VÀ gửi totpCode`<br>+ 4 ca meta I-3 + `★★★ step-up 2FA CÒN NGUYÊN …` |
| **MINE** | ★ **ALIAS** — thêm `const congPhaHuy = <thủ tục actuation>;` rồi `preempt: congPhaHuy`. **Không đụng một chuỗi `canDelete`/`canCreate` nào**, **không** đổi thứ tự đối số, **tên biến cũ vẫn còn nguyên trong file**, và **TẬP cổng không đổi** ⇒ lưới đời trước xanh 100%. | **14 ca đỏ / 3 file** | **CỔNG AST MÁY CHỦ:** `★★★ C-1 — ÁNH XẠ … > ★★★ mã SẢN XUẤT ở HEAD …`<br>**CỔNG AST CLIENT:** `Task 3b + C-1 … > ★★★ C-1 — ÁNH XẠ thủ tục → bit khớp TỪNG CẶP …`<br>+ `Task 3b (I-3) … > ★★★ trên toàn server/**: 0 vi phạm` (mất step-up ⇒ hàm lệnh tụt sàn)<br>+ 4 ca I-3 step-up + 3 ca runtime |

### ⚠ Kiểm **KHÔNG BẮT NHẦM** — và nó **BẮT ĐƯỢC MỘT LỖI THẬT CỦA CHÍNH LƯỚI NÀY**

Phép thử: **đổi tên biến thủ tục** ở mã sản xuất (`vramDestructiveProcedure` → `congPhaHuyVram`) —
một lượt **dọn dẹp hợp lệ**, không đổi một tính chất nào của bất biến. Lượt đo **ĐẦU TIÊN**:
**3 ca đỏ** ở hai file — **không** phải ca bất biến, mà **ba ca lưới-cho-lưới** dựng mutant bằng cách
**thay chuỗi neo vào TÊN BIẾN**: khi tên đổi, phép thay thành **no-op** ⇒ mutant **bằng** bản gốc ⇒
ca *"phải ĐỎ"* đỏ **vì lý do sai**, và câu lỗi **không** nói *"bạn vừa đổi tên biến"*. Đúng lớp lỗi
*"lưới nặn theo CHỮ KÝ"* + *"lưới chỉ đường tới bản vá SAI"*.

**Đã vá:** mẫu đột biến nay neo vào **cái mà CÂY nói** — `bienThuTuc(khoa, nguon)` đọc gốc chuỗi của
khoá router (client), và `doiSan(tu, sang)` neo vào **tên SÀN** do `_core/trpc.ts` sở hữu (stepUp);
tên mới của ca "đổi tên" **dẫn xuất từ tên cũ** nên phép đổi **luôn** là một thay đổi thật. Thêm một
ca *"KHÔNG BẮT NHẦM — ĐỔI TÊN BIẾN … ⇒ VẪN XANH"* ở `vramPanelStepUp` để khoá tính chất ấy.

**Sau khi vá:** đổi tên biến ⇒ **118/118 XANH** trên 4 file; cả bốn đột biến vẫn **ĐỎ** đúng ca.

---

## 11. Trạng thái cây cuối

| kiểm | kết quả |
|---|---|
| commit | `fd48307f` (bản vá chính) + `da66c04d` (vá "bắt nhầm" của lưới-cho-lưới) |
| `git status --porcelain -- server/ client/ shared/` sau khôi phục | **0 mục** ✅ |
| mã sản xuất bị đột biến | **`server/routers/vramRouter.ts`** — khôi phục bằng `git checkout HEAD -- <file>` sau **mỗi** lượt ✅ |
| 243 mục bẩn của việc khác | **không đụng, không stage** ✅ |
| DDL / migration / seed / trainer / `kb:sync` / sub-agent | **KHÔNG chạy cái nào** ✅ |
| file tạm | scratchpad `msg.txt` — **đã xoá**; **0** file tạm trong repo ✅ |

**Cổng chạy lại lần cuối (cây sạch):** **102 file / 1730 ca PASS** · shuffle **102/1730 PASS** ·
`npm run check` **exit 0** · `npm run check:tests` **exit 0** · `npm run i18n:check` **0 lệch**.
