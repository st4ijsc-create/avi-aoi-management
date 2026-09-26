# Khối C — nguồn sự thật của giới hạn (thiết kế)

**Ngày:** 2026-09-03 · **Trạng thái:** chủ dự án đã duyệt cổng thiết kế UI ("Duyệt thiết kế UI, tiếp tục") và giao chạy tự hành; tài liệu này ghi lại các quyết định thay cho vòng hỏi-đáp — mỗi quyết định kèm lý do và phương án bị loại, chủ dự án có thể phủ quyết từng điểm.

**Nguồn khảo sát:** ba báo cáo đo trực tiếp trên mã (BG-96 ngữ nghĩa thời gian · BG-97 spec-gate snapshot · ProductModels + point-def), cộng `docs/superpowers/plans/2026-09-03-aoi-khoi-b-cay-day.md` (phát hiện "bản dạy KHÔNG mang giới hạn").

---

## 1. Vấn đề

Khối B đã nối spec-gate `evaluatePointResult` lên cả ba đường ghi v2 (BG-92) — nhưng cổng **đang kết luận trên 0 linh kiện**, vì point-def sinh từ cây dạy của máy có mọi cột giới hạn NULL (tính chất của định dạng máy, không phải lỗi). Hướng đã chốt trong kế hoạch Khối B: **giới hạn do kỹ sư soạn trên hệ sinh thái** — tức Khối C không còn là việc giao diện, nó là nguồn sự thật làm cho cổng an toàn hoạt động.

Hai lỗi phải đóng **trước** khi bơm giới hạn vào (ghi tại kế hoạch Khối B):
- **BG-96** — header ghi "fake-UTC" (+7h) trong khi cấp cây ghi thô: cùng một hàng `inspection_captures`, hai cột lệch nhau đúng một offset.
- **BG-97** — đường v2 chấm theo giới hạn ĐANG SỐNG: bo nằm WAL/tồn kho sẽ bị chấm theo limit MỚI ngay ngày giới hạn được đổ đầy ⇒ hạ oan.

---

## 2. Quyết định thiết kế

### QĐ-1 · BG-96: chọn quy ước **UTC thật**, sửa tại gốc, dữ liệu test dọn lại

Khảo sát kết luận: phép ghi fake-UTC là **ngoại lệ** (3/3 đường ingest máy + 1 dedup), còn UTC thật là quy ước chính thức và đông áp đảo — tầng drizzle (`+0000`), `kpi.ts` (`FACTORY_DB_STORAGE_TZ` mặc định UTC), MV 0174, toàn bộ thống kê/phân ca, và chính `startedAt`/`completedAt` cấp cây mới. Doc 51 P1 đã phán đúng hướng này nhưng không dám sửa vì "đổi ý nghĩa dữ liệu lịch sử" — ràng buộc đó **không còn**: chủ dự án xác nhận toàn bộ dữ liệu là test, được xóa làm lại (2026-08).

Sửa:
1. Bỏ dịch tại 4 điểm ghi + 1 điểm dedup: `machineApiRouters.ts:1558` (v1), `:1589` (`serverReceivedAt`), `:3722` (v2 trực tiếp), `aoiPackageRouter.ts:1339` (ZIP, kéo theo `createdAt`/`updatedAt` `:1363-1364`); dedup `machineApiRouters.ts:1121` **cùng nhịp** (không thì WAL v1 mù khử trùng).
2. Chuyển 3 ổ đọc fake-UTC về UTC thật **tại helper** (call site giữ nguyên): `_core/index.ts:87-99` `parseLocalDate`, `externalInspectionApi.ts:58-71` `parseDateParam`, `stationAnalysisRouter.ts:31-37` `toFakeUtc` — thay ruột bằng chuyển đổi giờ-tường-nhà-máy → UTC theo `FACTORY_TIMEZONE` (mẫu có sẵn: `resolveFactoryDateWindow`, `kpi.ts:112-142`).
3. Dữ liệu cũ: **không viết migration dịch lại** — không phân biệt được từng hàng fake hay thô (seed ghi thô, ingest ghi fake). Dev DB là dữ liệu test ⇒ script dọn họ bảng kết quả inspection (KHÔNG đụng cây dạy `product_*`/`measurement_point_defs` — chúng ghi thô, đúng sẵn).
4. Cập nhật lưới đang ghim hành vi fake-UTC (`machineApiProvenance.test.ts:282-285`); thêm **lưới bất biến mới**: ingest một cây v2 với mốc ISO đã biết ⇒ `inspectionTime` của header và `startedAt` cấp capture đọc lại phải là **cùng hệ quy chiếu** (cùng instant, lệch 0).
5. Gỡ ràng buộc "không so thời gian header ↔ cây" trong kế hoạch Khối B sau khi đóng.

*Bị loại:* (i) chọn quy ước giờ-tường + lật `FACTORY_DB_STORAGE_TZ` — phải lật MV 0174 + GUC nguyên tử và sửa chính cấp cây đang đúng, nghịch chiều số đông; (ii) đổi cột sang `timestamptz` — đúng về lâu dài nhưng đụng hypertable nén + mọi truy vấn, không cần cho việc đóng lỗi.

### QĐ-2 · BG-97: neo thời gian **server-side**, không đổi hợp đồng máy

Hợp đồng v2 không mang `pointsConfigVersion`, `serverReceivedAt`, `variantCode` — và **không thể bắt máy đổi phần mềm**. Vậy:

1. **Neo = thời điểm payload LẦN ĐẦU chạm server**, server tự đóng dấu, không cần máy gửi gì: đường trực tiếp = `now()` lúc vào endpoint · đường WAL = `WalEntry.enqueuedAt` (đã có, `inspectionStoreForward.ts:336`) · đường ZIP = mốc nhận gói đã lưu trong `inspection_packages`. Truyền neo xuống chỗ dựng cổng.
2. **Cơ sở chấm: `instant`** — tái dùng nguyên vẹn `resolveLimitsAtInstant`/`resolveGateLimitsForBoard` (`pointResultEvaluator.ts:467-603`, thuần). Nhánh VERSION-EXACT là v1-only (v2 không có declaredVersion) — khai rõ, không giả lập.
3. Cờ: dùng chung `SPEC_GATE_SNAPSHOT_ENABLED`. Khi ON, v2 luôn giải giới hạn tại neo (neo = bây giờ ⇒ tự nhiên trùng live, không cần nhánh riêng).
4. **Batch**: xuất `loadPointLimitSnapshots` khỏi chỗ private (`machineApiRouters.ts:1184`) về `server/db/`, đổi thành `WHERE pointDefId IN (...)` — v2 có hàng trăm lá/bo, per-point sẽ N+1. Giải snapshot **trước** khi dựng cổng — `taoCongSpecCayV2.cham` giữ thuần/đồng bộ (lưới đang dựa vào tính không-I/O).
5. **Đếm được**: thêm bộ đếm basis (`version/live/instant/missing`) vào `ThongKeSpecGate`, **tách riêng** khỏi `khongGioiHan` (trùng biểu hiện, khác nguyên nhân — một bên "chưa từng sửa point-def", một bên "chưa ai dạy").
6. **Variant**: v2 chấm theo BASE, khai rõ + đếm (`v2BoQuaVariant`). Không nới hợp đồng khi máy không gửi được. Nhân dịp: sửa bản merge inline v1 (`machineApiRouters.ts:2046-2057`) dùng lọc `VARIANT_PATCH_PROTECTED_KEYS` như `mergeEffectivePoints` — hai bản merge đã trôi khỏi nhau.

*Bị loại:* (a) thêm `serverReceivedAt` vào hợp đồng v2 — máy không gửi được, trường chết; (c) lấy neo từ `completedAt` máy khai — đồng hồ máy, đúng thứ `assessClockSkew` tồn tại để không tin.

### QĐ-3 · `shared/pointLimitSpec.ts` — MỘT nguồn cho 18 cột giới hạn

Danh sách cột giới hạn hiện chép tay 4 nơi: SELECT `cayDay.ts:842-859` · kiểu `PointLimitSource` · zod input `productRouters.ts:1244-1275` · `touchesLimits` `productRouters.ts:1315-1322`. Chính `cayDay.ts:840` cảnh báo: *"thiếu một cột ở đây là một chiều giới hạn KHÔNG BAO GIỜ được chấm, và không lưới nào đỏ."* Đúng lớp lỗi `shared/productColumnSpec.ts` đã vá cho cột sản phẩm — dùng lại khuôn đó: spec khai một lần (tên cột + nhóm + nhãn i18n key), 4 nơi kia suy từ spec, kèm lưới census đối chiếu spec ↔ cột thật trong drizzle schema.

**Hệ quả tức thời:** mở rộng `touchesLimits` đủ 18 cột — đóng lỗ "sửa giới hạn 3D trên sản phẩm live lách hàng đợi duyệt ngưỡng" (spec-gate CÓ chấm bằng chúng, `cayDay.ts:842-859`).

### QĐ-4 · UI: **mở rộng có kiểm soát, không big-bang**

`ProductModels.tsx` 3.546 dòng nhưng đã có: toolbar gom 10→3 (doc 43), 14 dialog, `productColumnSpec`, 0 chuỗi Việt trần. Viết lại toàn bộ là rủi ro cao, giá trị thấp (MSA wizard ~500 dòng đang chạy). Chọn:

1. **Tab mới "Cây dạy"** (tab thứ 6) — phần Khối C thật sự:
   - `client/src/components/products/teach/TeachTreeTab.tsx` — chọn máy → duyệt surface/position/capture (breadcrumb + DataTable), badge phiên bản bản dạy hiện hành (`machine_template_versions`: version, checksum, pushedAt).
   - `ComponentLimitsTable.tsx` — DataTable cấp component: mã, tên, ROI, **trạng thái giới hạn** (`đã dạy / chưa có giới hạn`) đồng bộ phân loại với `specGateCayV2` (`dat/chuaDay/khongGioiHan`).
   - `ComponentLimitsDialog.tsx` — dạy giới hạn 1 linh kiện (mẫu: `ProductVariantsTab.tsx:223-263`, đã có dialog sửa limit chạy thật).
   - `BatchTeachLimitsDialog.tsx` — dạy hàng loạt theo capture hoặc theo lọc "chưa có giới hạn".
2. **Tách shell** mức vừa phải: rút cột trái (`ProductListPanel`) + host dialog (`ProductDialogsHost`) ra file riêng để `ProductModels.tsx` xuống ~2.000 dòng; **không** tách MSA/canvas trong khối này (đang chạy, không phục vụ giới hạn — ghi nợ tách sau).
3. Mẫu chuẩn khi cần bảng+dialog mới: `ComponentLibrary.tsx` (`EntityDialog` khai báo field-spec) — mẫu sạch nhất repo.
4. i18n: mọi nhãn qua `t()` với khoá đủ `vi/en/zh` (cổng viStringCoverage cấm chuỗi trần mới; `i18n:check` cần đủ 3 locale).

*Bị loại:* (a) viết lại cả trang thành bảng+dialog một lượt — 3.546 dòng, ~30 mutation, đứt gãy lớn người dùng nhìn thấy, không phục vụ mục tiêu giới hạn; (c) trang teach riêng ngoài `/products` — giới hạn là thuộc tính của sản phẩm, tách trang là tách nguồn sự thật khỏi ngữ cảnh.

### QĐ-5 · Đường ghi giới hạn: tái dùng `measurementPoint.update` + thêm `setLimitsBatch`

- **Bảng đích: `measurement_point_defs`** (hàng cây: `captureRowId IS NOT NULL`). KHÔNG bảng mới — `productConfigTree.ts:4-8` khẳng định cấp component chính là bảng này.
- `measurementPoint.update` đã có optimistic-lock, ghi `measurement_point_versions` + bump `pointsConfigVersion`, qua `assertThresholdEditAllowed` — tái dùng nguyên.
- Thêm `measurementPoint.setLimitsBatch` — nhiều pointDef một transaction, **một** lần bump version, vẫn qua cửa duyệt ngưỡng; từng hàng vẫn ghi `measurement_point_versions` (snapshot BG-97 dựa vào đó).
- **KHÔNG** đụng `ghiComponent`/`machineTemplateContract` — cố ý: máy khai kết quả không được đồng thời khai giới hạn (hướng (c) đã bị loại ở Khối B); `onConflictDoUpdate` của `ghiComponent` không đụng cột giới hạn nên đẩy cây lại không xóa giới hạn đã dạy (đã kiểm).

### QĐ-6 · Đường đọc: router mới `cayDayRouter` (chưa tồn tại procedure đọc cây nào)

`protectedProcedure` + phạm vi tenant (mẫu `productRouters.ts:402` — cây dạy phơi bí quyết công nghệ):
- `listMachinesForProduct({productModelId})` — máy có cây + bản dạy hiện hành.
- `getTree({productModelId, machineId})` — surface→position→capture (không kèm component, tránh payload to).
- `listComponents({captureRowId})` — point-def cấp component + trạng thái giới hạn, cột suy từ `pointLimitSpec`.
- `thongKeGioiHan({productModelId, machineId})` — đếm `daDay/chuaCoGioiHan` **cùng phân loại** với `specGateCayV2.ts:30-38` để số trên UI và số cổng chấm không thể lệch.

### QĐ-7 · Readiness phải thấy hàng cây

`computeProductReadiness` (hạng mục `limits`, trọng số 25) hiện chỉ đếm điểm PHẲNG — nếu không mở rộng đếm cả hàng cây, màn hình khai "100% có giới hạn" trong khi cổng trả `khongGioiHan` 100%. Mở rộng trong khối này.

### QĐ-8 · BG-98: cổng "máy tự mâu thuẫn" — riêng, nhỏ, làm được ngay

Máy gửi `lowerLimit/upperLimit` kèm 48/48 kết quả. Không dùng làm nguồn giới hạn (cổng rỗng), nhưng dùng cho phép kiểm khác lớp: `value` ngoài giới hạn **do chính máy khai** mà máy vẫn kết `OK` ⇒ lỗi pipeline của máy. Hai cổng, hai nguồn, hai bộ đếm — **cấm gộp** vào cổng bản-dạy.

---

## 3. Thứ tự bắt buộc

```
Pha 1: BG-96 (thời gian)  →  Pha 2: BG-97 (snapshot v2)  →  Pha 3: Khối C (spec + server + UI)  →  Pha 4: BG-98 (tùy lực)
```
BG-96 trước vì mọi so sánh thời gian (kể cả neo instant của BG-97) vô nghĩa khi hai cột lệch 7h. BG-97 trước Khối C vì "nổ cùng ngày giới hạn được đổ đầy".

## 4. Không làm (YAGNI, ghi nợ)

- Không đổi `DataTable` sang phân trang server / không thêm `total` cho `productModel.list` — nợ riêng, không chặn giới hạn.
- Không tách MSA wizard/canvas khỏi `ProductModels.tsx` trong khối này.
- Không đổi cột thời gian sang `timestamptz`.
- Không nới `machineTemplateContract`/hợp đồng v2.
- Khối D (Playwright + gộp màn) vẫn chờ tài khoản test từ chủ dự án.

## 5. Nghiệm thu (mức spec — kế hoạch sẽ chi tiết hóa)

1. **BG-96:** lưới bất biến header↔cây cùng hệ quy chiếu xanh, và **đỏ được** trên mã chưa vá; 3 module đọc fake-UTC trả cùng kết quả với `resolveFactoryDateWindow` cho cùng ngày.
2. **BG-97:** kịch bản "bo vào WAL → siết limit → replay" chấm theo limit **cũ** (basis `version`/`instant`), đếm được bằng counter; đường v1 không đổi hành vi.
3. **Khối C:** dạy giới hạn qua UI → `measurement_point_defs` có limit → đẩy lại gói kết quả v2 thật ⇒ spec-gate chuyển `khongGioiHan` → `dat/truot` đúng; linh kiện ngoài giới hạn bị bắt (mệnh đề 1 Task 4 Khối B chạy trên dữ liệu THẬT lần đầu).
4. Census `pointLimitSpec` ↔ drizzle schema xanh + đột biến (bỏ 1 cột khỏi spec ⇒ đỏ).
5. `npm run check` + `check:tests` = 0; các census hiện hành xanh; ảnh màn hình tab Cây dạy tự mở xem.
