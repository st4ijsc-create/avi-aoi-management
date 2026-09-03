# Khối B — cây dạy từ máy: hợp đồng, cửa, đường ghi, mở khoá cấp component

> **Cho người thực thi:** dùng skill `superpowers:subagent-driven-development`. Các bước dùng checkbox `- [ ]`.

**Mục tiêu:** Máy đẩy cây dạy (surfaces → positions → captures → components) lên hệ sinh thái; hệ ghi vào bốn bảng **đã có sẵn**; khoá nối `componentExtId` được đổ đầy ⇒ mở khoá ghi cấp component (**Đ-19**) và nối lại spec-gate (**BG-92**).

**Nền đo được (ĐỌC TRƯỚC):** `docs/superpowers/specs/2026-09-03-aoi-khoi-b-nen-do-duoc.md`
**Quyết định chủ dự án:** hướng **(a) máy đẩy cây dạy lên** — hệ soi gương máy.
**Mẫu thật:** `D:\SOURCES\AOIData\template-sync-sample.json` — 2 surface · 4 position · 8 capture · 16 component.

---

## Vì sao khối này nhỏ hơn vẻ ngoài

**Tầng lưu trữ ĐÃ CÓ SẴN.** Đo được: bốn bảng khớp mẫu gần như từng trường, tất cả **0 hàng**.

| Cấu hình máy | Bảng đích | Cột khoá |
|---|---|---|
| `surfaces[].surfaceId` | `product_surfaces` | `surfaceExtId` |
| `positions[].positionId` (`"P01"`) | `product_positions` | `positionId` + FK `surfaceRowId` |
| `captures[].id` (UUID) | `product_captures` | `captureExtId` + FK `positionRowId` |
| `components[].id` (UUID) | `measurement_point_defs` | `componentExtId` + FK `captureRowId` + `roiX/roiY/roiWidth/roiHeight` |

⇒ **Không cần migration mới** cho Task 1–4. Thiếu **cửa** và **đường ghi**, không thiếu chỗ chứa.

---

## Global Constraints

- **Mã, chú thích, tên test, thông điệp lỗi: TIẾNG VIỆT.**
- **KHÔNG đổi mặc định** `INSPECTION_STORE_FORWARD_ENABLED`, `INGEST_REJECT_LEGACY_MACHINE_ENABLED`, `CONFIG_SYNC_GENERIC_ENABLED`.
- **Nghiệm thu DB bằng vai `avi_app`**, **không bao giờ** bằng `aoi` (superuser + BYPASSRLS làm mọi phép đo quyền xanh giả).
- `product_inspections` và `audit_logs` là **WORM** — `avi_app` **KHÔNG có DELETE**. **Đừng** viết `DELETE ... .catch(() => {})` (32 tệp test đang làm thế, tất cả là no-op câm).
- ⚠ `data/inspection-store-forward*.jsonl` là **tệp THẬT** (dead-letter 101 mục, 7.4 MB) — đừng ghi vào. Cần thì trỏ `INSPECTION_STORE_FORWARD_FILE` sang tệp tạm.
- **Mọi con số đo từ DB phải khai kèm `current_database()`** (luật Đ-28). Hai DB: `aoi_management` (dev, gần rỗng) và `aoi_management_test`.
- **Điểm ghi nằm SAU `authenticateMachine`**; `entityId` là FK máy thật, không phải nhãn máy tự khai — bài học I-4 vừa trả giá.
- **Mọi lưới phải chứng minh ĐỎ ĐƯỢC.** Hoàn tác đột biến rồi kiểm `git status --short` sạch **trước khi** commit.
- ⚠ **NHỚ COMMIT.** Đã ba lần công việc suýt mất vì báo "XONG" mà không commit.
- **Câu hỏi bắt buộc trong mọi báo cáo:** *"bản vá này chuyển thứ gì từ lớp nào sang lớp nào, và ai đang phụ thuộc vào phân lớp cũ?"*
- Cây làm việc **dùng chung** — đừng đụng `client/src/**` (trừ `AoiPackageSection.tsx`), `knowledge/**`, `server/services/aiLocalTools/**`, `vscode-extension/**`, `server/routers/repoWorkspaceRouter.ts`, `server/routers/phamViDocCensus.test.ts`, `server/services/vram/**`.

---

## ⚠ Bẫy khoá nối — đọc kỹ trước Task 2

Bốn cấp **KHÔNG** nối cùng một kiểu. Đây là bản sửa của §2 nền sau khi đo đủ bốn cấp:

| Cấp | Cấu hình có | Kết quả có | Nối bằng |
|---|---|---|---|
| surface | `surfaceId` (UUID) + `surfaceName` | **chỉ `name`** | **TÊN** |
| position | `id` (UUID) **+** `positionId` = `"P01"` | **chỉ `positionId`** | **MÃ `"P01"`** |
| capture | `id` (UUID) | `captureId` (UUID) | **UUID** |
| component | `id` (UUID) | `componentId` (UUID) | **UUID** |

⚠ Ở cấp position, cấu hình mang **hai** khoá còn kết quả chỉ mang **một**. **Nối bằng `id` sẽ LUÔN trượt, im lặng.**
⚠ Hai cấp trên nối bằng tên/mã nên **yếu hơn**: đổi tên mặt hoặc đổi mã vị trí là **đứt nối**. Chọn **một** khoá cho mỗi cấp và ghi rõ trong chú thích.

---

## Task 1 (B-1) — hợp đồng cây dạy

**Files:** tạo `server/contracts/machineTemplateContract.ts` · lưới cùng thư mục.

**Produces:** `machineTemplateContract` (zod object) và kiểu `MachineTemplate`.

- [ ] **Bước 1: Đo TRƯỚC.** In khoá bốn cấp của mẫu thật, chép nguyên văn vào báo cáo. Đây là baseline.

- [ ] **Bước 2:** Khai hợp đồng đúng **các trường mẫu thật có**:

```
componentTemplate = {
  id            : string 1..64      // UUID may sinh -> measurement_point_defs.componentExtId
  componentName : string max 255
  description   : string max 1000   (optional)
  roi           : { x: number, y: number, width: number, height: number }
  templateImagePath : string max 1000 (optional)
}

captureTemplate = {
  id                : string 1..64  // UUID -> product_captures.captureExtId
  name              : string max 255
  templateImagePath : string max 1000 (optional)
  components        : componentTemplate[]
}

positionTemplate = {
  id            : string 1..64      // UUID - KHONG dung de noi ket qua
  positionId    : string 1..64      // "P01" - DAY moi la khoa noi ket qua
  positionIndex : number
  name          : string max 255
  shape         : string max 50     (optional)
  markerWidth   : number (optional)
  markerHeight  : number (optional)
  relX          : number (optional)
  relY          : number (optional)
  templateImagePath : string max 1000 (optional)
  captures      : captureTemplate[]
}

surfaceTemplate = {
  surfaceId   : string 1..64        // UUID -> product_surfaces.surfaceExtId
  surfaceName : string max 100      // khoa noi ket qua (ket qua chi co `name`)
  surfaceTemplateImagePath : string max 1000 (optional)
  positions   : positionTemplate[]
}

machineTemplateContract = { surfaces: surfaceTemplate[] }
```

⚠ **Mọi trường chuỗi PHẢI có `.max()`** khớp cột đích — census `capChuoiVarcharScan` sẽ soi; thiếu là **đỏ**.
Cột đích đã kiểm: `surfaceName` varchar(100) · `componentName`/`name` varchar(255) · `surfaceExtId`/`captureExtId`/`componentExtId` varchar(64).
⚠ **KHÔNG** thêm trường mà mẫu thật không có — thêm là tạo hợp đồng rộng hơn hiện thực.

- [ ] **Bước 3:** Lưới — mẫu thật `safeParse` = **true**, đếm đúng **2 / 4 / 8 / 16** phần tử bốn cấp.
- [ ] **Bước 4:** Lưới — thiếu `components` ⇒ **từ chối**; `roi` thiếu `width` ⇒ **từ chối**.
- [ ] **Bước 5: Đột biến** — bỏ `.max()` của `componentName` ⇒ census phải **ĐỎ**. Chép nguyên văn dòng đỏ, rồi hoàn tác.
- [ ] **Bước 6: Commit.**

**Ba mệnh đề:** mẫu thật parse được, đủ 2/4/8/16 · thiếu trường bắt buộc bị từ chối · mọi trường chuỗi có `.max()` khớp cột thật.

---

## Task 2 (B-2 + B-3) — cửa ingest cấu hình, và ghi bốn bảng

**Files:** `server/routers/machineApiRouters.ts` (thêm `.mutation`) · `server/db/` · lưới.

**Consumes:** `machineTemplateContract` từ Task 1.

- [ ] **Bước 1:** Thêm `.mutation()` nhận `machineTemplateContract` + `productModelCode`.
⚠ **`authenticateMachine` chạy TRƯỚC mọi tác dụng phụ.** Không ghi gì trong `.input()` — đó đúng lỗi I-4 vừa vá.

- [ ] **Bước 2:** Ghi bốn bảng theo đúng ánh xạ đã đo (dùng nguyên văn):

```
surfaces[]   -> product_surfaces
                 surfaceExtId = surfaceId
                 surfaceName
                 templateImageUrl = surfaceTemplateImagePath
                 orderIndex = thu tu trong mang

positions[]  -> product_positions
                 surfaceRowId = FK hang surface vua ghi
                 positionId, positionIndex, name, shape
                 markerWidth, markerHeight, relX, relY

captures[]   -> product_captures
                 positionRowId = FK hang position vua ghi
                 captureExtId = id
                 captureName  = name
                 captureIndex = thu tu trong mang

components[] -> measurement_point_defs
                 captureRowId   = FK hang capture vua ghi
                 componentExtId = id
                 name = componentName
                 description
                 roiX = roi.x, roiY = roi.y, roiWidth = roi.width, roiHeight = roi.height
```

- [ ] **Bước 3: Đẩy LẠI phải hội tụ, không nhân bản.** Cùng máy + cùng `productModelCode` + cùng cây ⇒ **cùng số hàng**, không tăng.
Khoá hội tụ theo cấp: `(productModelId, surfaceExtId)` → `(surfaceRowId, positionId)` → `(positionRowId, captureExtId)` → `(captureRowId, componentExtId)`.

- [ ] **Bước 4: Cây co lại.** Bản dạy mới **bỏ** một component ⇒ quyết định và **ghi rõ**: xoá mềm hay giữ?
⚠ `measurement_point_defs` **có** cột `deletedAt` — dùng nó. **Đừng DELETE cứng**: kết quả cũ đang trỏ vào.

- [ ] **Bước 5: Đột biến** — bỏ bước ghi `componentExtId` ⇒ lưới phải **ĐỎ**. Chép nguyên văn.
- [ ] **Bước 6: Commit.**

**Bốn mệnh đề (đo bằng `SELECT`, mỗi con số kèm `current_database()`):**
1. Đẩy mẫu thật ⇒ `product_surfaces` = 2 · `product_positions` = 4 · `product_captures` = 8 · `measurement_point_defs` **+16 hàng có `componentExtId`**.
2. Đẩy **lại cùng cây** ⇒ số hàng **không đổi**.
3. Chưa xác thực / sai apiKey ⇒ **0 hàng**. Lưới này phải **đỏ được** trên mã chưa vá.
4. `captureRowId` của 16 hàng point-def **trỏ đúng** `product_captures` tương ứng.

---

## Task 3 (B-4) — mở khoá ghi cấp component (Đ-19)

**Files:** `server/routers/aoiPackageRouter.ts`, `server/db/inspection.ts` · lưới.

- [ ] **Bước 1:** Khi ghi kết quả v2, với mỗi phần tử `components[]` của mỗi capture ⇒ ghi **một hàng** `measurement_results`:
`inspectionCaptureRowId` = FK hàng `inspection_captures` vừa ghi · `componentExtId` = `componentId` · `ntf` · `ntfSource` · `errorCode` · `errorDesc` · `startedAt` · `completedAt` · `measuredValue` / `measuredValueText`.
⚠ Nhánh **số** đi `measuredValue` (decimal); nhánh **chuỗi không parse được số** đi `measuredValueText` varchar(255) — **mẫu hành vi của nhánh v1.x**, dùng lại, đừng phát minh.

- [ ] **Bước 2:** Verdict vẫn cuộn từ **cây** như hôm nay. Task này **chỉ thêm hàng**, **không đổi** verdict của bất kỳ gói nào.
- [ ] **Bước 3: Đột biến** — bỏ ghi `inspectionCaptureRowId` ⇒ lưới **ĐỎ**.
- [ ] **Bước 4: Commit.**

**Ba mệnh đề:**
1. Gói cây có 16 component ⇒ **16 hàng** `measurement_results` có **cả hai** cột `inspectionCaptureRowId` và `componentExtId`.
2. **CHỐNG HỒI QUY:** verdict của mọi gói `committed` hiện có **không đổi**.
3. Component `ntf = true` ⇒ hàng mang `ntf = true`, không bị san phẳng.

---

## Task 4 (B-5) — nối lại spec-gate `evaluatePointResult` (BG-92)

**Files:** `shared/rollupVerdict.ts`, đường ghi v2 · lưới.

**⚠ Task này KHÔNG thể làm trước Task 2** — `pointDefId` chỉ tra được sau khi `componentExtId` có dữ liệu. Đây là lý do BG-92 phải đóng cùng Đ-19.

- [ ] **Bước 1:** Tra `pointDefId` từ `componentExtId` (join `measurement_point_defs`), rồi chạy `evaluatePointResult` như đường v1.x đang làm.
- [ ] **Bước 2: Không tra được thì sao?** Component chưa có bản dạy ⇒ **quyết định và ghi rõ**: giữ nguyên lời khai của máy, hay gắn cờ?
⚠ **Đừng âm thầm bỏ qua** — đó đúng lớp lỗi BG-68 (cuộn verdict từ lời khai).
- [ ] **Bước 3:** Sửa chú thích `shared/rollupVerdict.ts:24-26` và `:39-40` cho khớp hành vi mới; **gỡ** nhãn nợ BG-92 nếu đã đóng thật.
- [ ] **Bước 4: Đột biến** — linh kiện **ngoài giới hạn** mà máy khai `OK` ⇒ lưới phải bắt được. Chép nguyên văn.
- [ ] **Bước 5: Commit.**

**Ba mệnh đề:**
1. Linh kiện có `value` **ngoài** `lowerLimit`/`upperLimit` đã dạy mà máy khai `OK` ⇒ **bị bắt**. Đây là đường **bo XẤU đi lọt** hôm nay.
2. Linh kiện **chưa có bản dạy** ⇒ hành vi **đã khai rõ**, không âm thầm.
3. **CHỐNG HỒI QUY:** đường v1.x **không đổi hành vi**.

---

## Task 5 (B-6) — version per-máy per-bản-dạy

**Files:** cửa của Task 2 + lưới · có thể cần migration.

- [ ] **Bước 1: Đo TRƯỚC.** `product_*` và `measurement_point_defs` **đã có** cột version nào chưa? (đã thấy `deletedAtVersion`, `variantId`). Đo rồi mới quyết có cần migration.
- [ ] **Bước 2:** Mỗi lần đẩy cây ⇒ một **phiên bản bản dạy**, gắn máy + model. Kết quả phải tra được *"bo này chấm theo bản dạy nào"*.
- [ ] **Bước 3:** Chỉ thêm **cột nullable** nếu đụng hypertable nén. Migration **phải** tái dùng cầu chì `scripts/apply-migration-0338.mjs:74-84` (đọc `rolsuper`/`rolbypassrls`, từ chối chạy bằng superuser) và **không** chứa DELETE dữ liệu lịch sử.
- [ ] **Bước 4: Commit.**

**Hai mệnh đề:** hai bản dạy khác nhau cùng máy ⇒ phân biệt được · kết quả cũ vẫn trỏ đúng bản dạy cũ.

---

## Cổng ra

- [ ] Mẫu thật đẩy được ⇒ **2 / 4 / 8 / 16** hàng đúng bốn bảng, `componentExtId` **khác 0**.
- [ ] Đẩy lại **không nhân bản**; cây co lại **không xoá cứng**.
- [ ] Chưa xác thực ⇒ **0 hàng**, lưới đỏ được.
- [ ] Gói kết quả v2 ⇒ `measurement_results` có **cả hai** cột Khối B (**Đ-19 đóng**).
- [ ] Linh kiện ngoài giới hạn mà máy khai OK ⇒ **bị bắt** (**BG-92 đóng**).
- [ ] **CHỐNG HỒI QUY:** verdict mọi gói `committed` hiện có **không đổi**; đường v1.x không đổi.
- [ ] `npm run check` sạch · census `.max()` và census cửa ingest xanh.

**Còn mở sau khối này:** BG-39 gđ2 + tín hiệu đếm cửa ZIP (**R-BG89-1**, Đ-27) · BG-93 retention `audit_logs` · BG-94 lưới lời văn · BG-36 dead-letter · **Khối C** (UI sản phẩm) · **Khối D** (gộp màn + Playwright, cần tài khoản test).

---

## Ruling R-KB-1 (2026-09-03) — ĐỔI THỨ TỰ: Task 3 → Task 5 → Task 4

**Phát hiện của Task 2 (`ac8d5ab2`, mối lo #3), đã tự kiểm chứng:**

| Bảng | Chiều máy |
|---|---|
| `product_surfaces` / `product_positions` / `product_captures` | **KHÔNG CÓ** |
| `measurement_point_defs` | **có `machineId`** |

Người làm Task 2 **cố ý** để `machineId` NULL, lý do ghi tại `server/db/cayDay.ts`: *"ba cấp trên không có chiều máy nào, nên gắn máy ở riêng cấp bốn tạo một chiều nửa vời."* **Đó là quyết định đúng** — một chiều nửa vời sinh hai nguồn sự thật về phạm vi, tệ hơn không có chiều nào.

**Nhưng hệ quả là thật:** hai máy đẩy cây cho **cùng một product model** sẽ **ghi đè nhau im lặng**.

**Vì sao điều đó chặn Task 4 chứ không chặn Task 3:**
- **Task 3** chỉ ghi lại *"máy khai gì"*, nối vào hàng capture của chính lượt đó. Cây dạy sai **không** làm hỏng nó.
- **Task 4** chấm linh kiện **theo giới hạn đã dạy**. Nếu máy B ghi đè bản dạy của máy A thì bo của máy A bị chấm bằng giới hạn của máy B ⇒ **cả hai chiều đều hỏng**: bo xấu đi lọt **và** bo tốt bị đánh trượt. Đó là đúng thứ Khối B sinh ra để chặn.

**Ruling:** làm **Task 3** (Đ-19, không phụ thuộc), rồi **Task 5** (chiều máy + version), rồi **Task 4** (BG-92).
*Giá nếu sai:* Task 4 lùi một nhịp. *Giá nếu KHÔNG đổi:* spec-gate chạy trên bản dạy có thể của máy khác — một cổng an toàn **cho câu trả lời sai mà vẫn xanh**, đúng lớp lỗi tệ nhất trong dự án này.

⚠ Ràng buộc kèm theo: **cấm bật cửa cây dạy ở môi trường có nhiều hơn một máy** cho tới khi Task 5 xong.

---

## Ruling R-KB-2 (2026-09-03) — SỬA R-KB-1: thứ tự đúng là **Task 5 → Task 3 → Task 4**

**R-KB-1 tôi vừa ghi ở trên có một lập luận SAI.** Tôi viết: *"Task 3 chỉ ghi lại máy khai gì… cây dạy sai KHÔNG làm hỏng nó."*

**Phép đo bác bỏ** (`current_database()='aoi_management_test'`, vai `avi_app`) — `measurement_results` có **5 cột NOT NULL**, trong đó:

```
pointDefId :: integer   NOT NULL, KHONG CO DEFAULT
```

⇒ **Không có `pointDefId` thì KHÔNG ghi được một hàng nào.** `pointDefId` trỏ vào `measurement_point_defs` — tức **chính bản dạy**. Task 3 **phụ thuộc hoàn toàn** vào dữ liệu dạy, không phải "độc lập" như tôi khai.

**Hai hệ quả tôi đã bỏ sót:**

1. **Linh kiện máy khai mà CHƯA TỪNG được dạy thì không có chỗ ghi.** Đây là câu thiết kế bắt buộc của Task 3, không phải chi tiết phụ: bỏ qua im lặng ⇒ mất dữ liệu (đúng lớp C-1 vừa vá); tự tạo point-def ⇒ bản dạy bị máy tự ghi, phá đúng mô hình "hệ soi gương máy" mà chủ dự án chốt.
2. **Chiều máy phải có TRƯỚC Task 3, không phải chỉ trước Task 4.** Nếu bản dạy còn dùng chung theo model, hàng kết quả của máy A sẽ khoá ngoại vào point-def **có thể của máy B** — và ghi sai **ngay lúc ghi**, không phải lúc chấm. Sửa sau nghĩa là phải di trú những hàng đã ghi sai.

**Ruling:** **Task 5** (chiều máy + version) → **Task 3** (Đ-19) → **Task 4** (BG-92).
*Giá nếu sai:* Đ-19 lùi một nhịp. *Giá nếu giữ R-KB-1:* hàng kết quả cấp component ghi khoá ngoại sai ngay từ hàng đầu tiên, và phải di trú.

⚠ Ràng buộc R-KB-1 vẫn giữ: **cấm bật cửa cây dạy ở môi trường nhiều hơn một máy** cho tới khi Task 5 xong.

---

## Ruling R-KB-3 (2026-09-03) — GỠ ràng buộc "cấm bật cửa khi có nhiều hơn một máy"

R-KB-1 và R-KB-2 kèm ràng buộc: *cấm bật cửa cây dạy ở môi trường nhiều hơn một máy cho tới khi Task 5 xong.* **Task 5 xong (`5eb881bb`) và tôi đã tự kiểm chứng — gỡ ràng buộc.**

**Phép đo, cả hai DB (`aoi_management` và `aoi_management_test`):**

| Kiểm | Kết quả |
|---|---|
| migration `0347` vào sổ, `success` | **1 / 1** |
| index gây ghi đè `uq_product_surfaces_model_name` | **0 — đã biến mất** |
| bảng `machine_template_versions` | **có** |
| `machineId` trên ba bảng `product_*` | **3 / 3** |
| MỆNH ĐỀ 1 (M1 và M2 đẩy cây KHÁC cho CÙNG model ⇒ cả hai cùng sống) | **xanh** |

⇒ Chiều máy có ở **cả bốn cấp**, cưỡng chế bằng **khoá ngoại ghép** + CHECK, nên hàng con không thể mang `machineId` khác cha. **Không còn chiều nửa vời** — đúng ràng buộc đã đặt cho Task 5.

---

## ⛔ BG-95 — migration TÁI CHẠY ĐƯỢC có thể PHỤC SINH ràng buộc mà migration sau đã cố tình bỏ

**Task 5 tìm ra, không có trong kế hoạch của tôi.** Chạy lại `0338` (tái chạy được) **sau** `0347` **phục sinh** `uq_product_surfaces_model_name` ở cả hai DB — khôi phục đúng lỗ hai máy ghi đè nhau, **im lặng, mọi lưới vẫn xanh**.

Task 5 đã guard `0338` và thêm lưới canh. **Nhưng phần còn lại chưa quét** — tôi đã đo bề mặt:

| | |
|---|---|
| migration tái chạy được (`IF NOT EXISTS`) | **240** |
| trong đó tạo UNIQUE index/constraint | **76** |

⇒ Đây là **bất biến**, không phải một ca lẻ: *"không migration tái chạy được nào được tạo ràng buộc mà một migration SAU nó đã bỏ."* Cần census cưỡng chế, không phải sửa từng cặp.

⚠ Lớp lỗi này tệ vì nó **không đỏ ở đâu cả**: schema đúng sau lần áp đầu, sai sau lần áp lại, và không lưới nào chạy migration hai lần.

---

## BG-96 — header và cây lệch ĐÚNG 7 GIỜ trong cùng một request

**Task 3 đo được, tôi đã xác nhận tại nguồn.**

`server/routers/aoiPackageRouter.ts:1320`:
```js
const inspectionTime = new Date(rawInspTime.getTime() - rawInspTime.getTimezoneOffset() * 60000);
```
⇒ `product_inspections.inspectionTime` bị dịch **"fake UTC"** (+7h ở UTC+7), trong khi `startedAt`/`completedAt` **cấp cây** ghi **thô**. Cùng một request, hai mốc thời gian **lệch đúng một offset**.

**Chưa nổ:** 0/435 hàng capture có `startedAt` (máy chưa gửi timing per-cấp). **Sẽ nổ** ngay khi máy bắt đầu gửi — và khi đó mọi truy vấn nối bo với cấp dưới theo thời gian đều sai lệch một offset, **im lặng**.

⚠ Đây là nợ **có sẵn** (doc 51 P1), không do Khối B sinh ra. Nhưng Khối B vừa làm nó **quan trọng hơn**: trước đây cấp cây không ghi thời gian, nay có.

**BG-96 ĐÃ ĐÓNG (2026-09-03)** — xem plan Khối C Task 1-3 (`.superpowers/sdd/2026-09-03-aoi-khoi-c-gioi-han/`, commit `aedd3096`/`86b0e889`/`118d5322`/`db10d08f`). Header và cây nay CÙNG một hệ quy chiếu UTC thật; lưới bất biến DB thật `server/routers/thoiGianMotHeQuyChieu.db.test.ts` canh, và `server/utils/fakeUtcCensus.test.ts` khoá vĩnh viễn việc công thức fake-UTC tái sinh ở `server/**`. Ràng buộc "không được so thời gian giữa header và cây" ở trên KHÔNG còn hiệu lực.

---

## ⛔ Phát hiện quan trọng nhất của Khối B — cổng đã nối nhưng CHƯA CHẤM GÌ, vì bản dạy KHÔNG MANG GIỚI HẠN

Task 4 (`cd93d494`) nối xong spec-gate trên **cả ba** đường ghi v2. **Nhưng nó đang kết luận trên 0 linh kiện**, và lý do nằm ở tầng dữ liệu, không phải tầng mã.

**Phép đo (mẫu máy thật, tôi đã tự xác nhận):**

| Mẫu | Trường giới hạn ở cấp component |
|---|---|
| `template-sync-sample.json` (**cấu hình / cây dạy**) | `id · componentName · description · roi · templateImagePath` ⇒ **KHÔNG CÓ CÁI NÀO** |
| `dashboard-sample.json` (**kết quả**) | **48/48** component mang `lowerLimit` + `upperLimit` |

⇒ Point-def do cây dạy tạo ra có **mọi cột giới hạn NULL** (đo: 16/16 trên mẫu thật). Cộng `machine_template_versions` = 0 ⇒ **cổng không có gì để so**.

⚠ **Hợp đồng cây dạy (Task 1) KHÔNG sai** — nó soi đúng mẫu thật. Trường giới hạn **thật sự không có ở đó**. Đây không phải lỗi bỏ sót, mà là **tính chất của định dạng máy**.

**Điểm sáng:** cổng **nói ra** rằng nó không kết luận được (`chuaDay` / `khongGioiHan`), thay vì trả xanh. Đó đúng thứ brief đòi — **không có giấy vô can giả**. Nhưng tín hiệu vẫn **chết** vì chưa màn nào hiển thị.

### Giới hạn phải đến từ đâu — ba hướng, và hướng thứ ba bị loại

| Hướng | Đánh giá |
|---|---|
| **(a)** Nới bản xuất cấu hình của **máy** để mang giới hạn | Cần bên làm máy đổi phần mềm. Mẫu thật hiện không có. |
| **(b)** **Dạy giới hạn trên hệ sinh thái** — đúng màn quản lý sản phẩm + dialog điểm đo của **Khối C** | Khả thi ngay, không cần bên máy. |
| **(c)** Lấy giới hạn từ chính lời khai kèm kết quả | ⛔ **LOẠI** — chấm lời khai bằng chính lời khai là **cổng rỗng**. Task 4 đã cố ý từ chối. |

⇒ **Khối C không còn là việc giao diện.** Nó là **nguồn sự thật của giới hạn**, tức là thứ làm cho cổng an toàn BG-92 thực sự hoạt động. Thứ tự roadmap đổi theo phát hiện này.

---

## BG-97 — đường v2 chấm theo giới hạn ĐANG SỐNG, không snapshot, không variant override

Task 4 tự khai. Đường **v1.x** có **cả hai** (`SPEC_GATE_SNAPSHOT_ENABLED` doc 51 P1/P2 · variant override doc 55 Item 3); đường **v2 không có cái nào**.

⇒ Bo v2 nằm tồn kho hoặc trong **WAL** (dead-letter 101 mục) sẽ bị chấm theo limit **MỚI** ⇒ **hạ oan**.
Chưa nổ vì cổng đang kết luận 0 linh kiện — nhưng **nổ cùng ngày** giới hạn được đổ đầy. ⚠ Phải đóng **trước** khi Khối C bơm giới hạn vào.

## BG-98 — máy gửi giới hạn kèm MỌI kết quả (48/48) mà hệ vứt đi

Không dùng chúng làm **nguồn giới hạn** là đúng (xem hướng (c) ở trên). Nhưng chúng cho phép một phép kiểm **khác lớp**, dùng được **ngay hôm nay** kể cả khi chưa ai dạy giới hạn:

> *"Máy có tự mâu thuẫn không?"* — `value` nằm ngoài `lowerLimit`/`upperLimit` **do chính máy khai** mà máy vẫn kết `OK`.

Đó là lỗi **pipeline của máy**, bắt được mà **không cần** bản dạy. ⚠ **Đừng gộp** vào cổng bản-dạy — hai cổng, hai nguồn, hai ý nghĩa.
