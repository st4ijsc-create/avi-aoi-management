# Doc 43 — Review & Redesign ProductModels.tsx (/products) — 2026-07-11

> Yêu cầu user: review chi tiết CRUD + cấu hình sản phẩm (điểm đo & thông số); **cấu hình thông tin quá nhiều gây bối rối**; sắp xếp lại layout **đơn giản mà đầy đủ**, gom/ẩn phần ít dùng/nâng cao.
> Phương pháp: 3 agent — code-map toàn bộ 4520 dòng + live UX/CRUD trên màn hình thật (Playwright, server 3001) + đề xuất redesign. **KHÔNG xoá tính năng nào — chỉ sắp xếp lại tầng hiển thị (progressive disclosure).**
>
> **TRẠNG THÁI THỰC THI (USER DUYỆT "toàn bộ 1→5", 2026-07-11/12, UNCOMMITTED): TẤT CẢ 5 ĐỢT DONE & GREEN.**
> - **Đợt 1** ✅ Toolbar 10 nút → 3 control (Nhập điểm đo ▾ / ⋯ Nâng cao / ✎ Sửa). Verify live 22/22.
> - **Đợt 2** ✅ Form accordion (CƠ BẢN + Ngưỡng/Nâng-cao/Chất-lượng/Ảnh) + ẩn hẳn field không hợp lệ (hết ~15 ô solder xám) + hợp nhất 2 selector loại→1+badge. Verify 30/30 (VISUAL hết ô xám).
> - **Đợt 4** ✅ Fix CRUD: dirty-track 403 (chỉ gửi ngưỡng khi đổi) + banner "Gửi yêu cầu duyệt" · nút "Tải ảnh" · Create dialog đủ field + default lifecycle development · Việt hoá nhãn P3. Verify 8/8.
> - **Đợt 3** ✅ Tab-hoá cột detail 4 tab (Điểm đo/Thông tin SP/Phát hành/Nền tảng) + ?tab= deep-link — hết "cuộn dài vô tận", canvas rộng. Verify 25/26 + onboarding jump giữ nguyên.
> - **Đợt 5** ✅ Point-list chip → DataTable (search/sort/paginate 25) + đồng bộ 2 chiều canvas↔bảng + batch — board 200 điểm dùng được. Verify 15 check (60-point board). Giới hạn nhỏ: canvas chọn điểm ở trang bảng khác không auto-page (cần sửa DataTable primitive — followup).
> - **+ pass i18n:** nạp locale en/zh cho key inline các đợt + fix nhãn loại 'Loại surface/electrical'→'Bề mặt/Điện'.
> - Green-gate mỗi cụm: tsc 0 · build ✓. Server verify: tsx no-watch 3001 (Vite HMR client).

## 1. Chẩn đoán gốc — vì sao "quá nhiều thông tin" (xác minh code + live)

Trang là monolith 4520 dòng (~100 useState, ~20 mutation), layout master-detail 2 cột. UX live chấm **4.5/10**. 8 ổ dồn tải:

| # | Ổ dồn tải | Vị trí | Triệu chứng (đo thật) |
|---|-----------|--------|------------------------|
| 1 | Toolbar detail chế độ VIEW | `2649–2707` | **10 nút outline cùng cấp** (Import·Centroid·Export gói·Import gói·Templates·MSA Wizard·Program Release·Panel N-up·Fiducials·Select·Edit). Cả trang ~18 nút hành động. |
| 2 | Form 1 điểm đo | `2915–~3620` | 1 ScrollArea phẳng ~700 dòng, cao **3.8–4.7× màn hình** (VISUAL 2063px, POSITION 2577px). Không nhóm gập. |
| 3 | `show3DSection` siêu-tập | `3188–3272` | POSITION/SURFACE render **~15 ô solder/xray disabled-xám** vô nghĩa (`disabled={!showSolderSection}`). Nhiễu thị giác lớn nhất. |
| 4 | Hai selector loại chồng nhau | `2952` + `2974` | pointType (7 loại legacy) + measurementTypeCode (48 catalog) cùng điều khiển section → không biết chọn cái nào. |
| 5 | Đuôi P3 luôn hiện | `3388–3500+` | Instrument/Sampling/View/Readiness/Vùng-cắt/Chiếu-sáng hiện cho **mọi** loại. Nhãn hard-code tiếng Anh "(P3)". |
| 6 | 3 bề mặt readiness trùng | badge list + Panel `2785` + P3.3 box `3479` | Cùng thông tin lặp 3 nơi. |
| 7 | Foundation P3 (5 mini-CRUD) | đáy detail | Instruments/Sampling/AQL/Views/MSA — master-data toàn cục trộn vào trang sản phẩm, luôn bung. |
| 8 | 2 ngõ cụt CRUD | `1855`, `2865` | (a) sản phẩm `active` (mặc định) → mọi Save điểm đo **403** "threshold require approval". (b) sản phẩm không ảnh → không thêm được điểm. |

**CRUD live (thật, Playwright):** CREATE sản phẩm ✅ · READ ✅ · UPDATE sản phẩm ✅ · CREATE điểm đo ✅ · **UPDATE điểm đo ⚠️ 403 trên sản phẩm active** (chỉ pass khi lifecycle=development) · DELETE ✅ (cascade).

## 2. Nguyên tắc redesign

1. **Progressive disclosure** — mặc định hiện field/nút thường dùng; nâng cao sau accordion/menu/tab.
2. **Ẩn thay vì làm xám** — field không hợp lệ cho loại thì không render.
3. **Một nguồn sự thật cho "loại"** — hợp nhất 2 selector.
4. **Tách 2 mức khái niệm** — master-data (Foundation) khỏi luồng sửa điểm đo.
5. **Giữ 100% tính năng** — chỉ đổi nơi đặt/tầng hiển thị. Dùng primitive có sẵn (Tabs/Accordion/DropdownMenu/DataTable/FormScaffold).

## 3. Layout mới (tóm tắt — chi tiết ASCII trong §5)

- **Toolbar detail:** 10 nút flat → **`Nhập ▾` + `✎ Sửa` (primary) + `⋯ Nâng cao`** (DropdownMenu gom 8 action hiếm theo nhóm).
- **Cột detail:** 1 cuộn vô tận → **4 tab**: ① Điểm đo (mặc định, canvas + form) · ② Thông tin SP (metadata + readiness panel + golden + documents) · ③ Phát hành & Chương trình (Program/Panel/Fiducials/Templates/Package) · ④ Nền tảng (5 mini-CRUD + banner cross-link Settings).
- **Form điểm đo:** ScrollArea phẳng → **CƠ BẢN luôn mở** (mã/tên/loại/vị trí/ngưỡng) + Accordion gập sẵn (Ngưỡng·Nâng-cao-theo-loại·Chất-lượng·Ảnh). **Ẩn hẳn** field không thuộc loại. VISUAL từ 21 nhãn/2063px → ~6 field.
- **Selector loại:** 2 ô → **1 ô catalog** + badge nhóm read-only (pointType tự suy).
- **Readiness:** giữ badge list + 1 panel tab②, bỏ P3.3 box trong form.

## 4. Fix CRUD (thiết kế, không mất tính năng)

- **(A) 403 active:** dirty-tracking trong `handleSavePoint` (chỉ gửi trường ngưỡng khi thực đổi → đổi tên không kích cổng duyệt); khi active hiện banner + nút **"Gửi yêu cầu duyệt"** thay vì toast lỗi im lặng.
- **(B) Không ảnh:** nút **"Tải ảnh tham chiếu"** ngay trên placeholder canvas.
- **(C) Create Dialog thiếu field:** bổ sung category/productLine/lifecycle/targetYield (state + mutation `1382-1389` đã sẵn, chỉ thiếu control) + default lifecycle **development** (không hard-code active → hết 403 ngay sau tạo).
- **(5) Việt hoá:** bỏ "(P3)"; sửa option dịch sai (VISUAL "Loại hiển thị"→"Trực quan").

## 5. Kế hoạch thực thi theo đợt (giữ 100% tính năng)

| Đợt | Nội dung | Effort | Rủi ro |
|---|---|---|---|
| **1** | Gom toolbar → 2 nút + menu ⋯ (chỉ dời JSX, không đụng logic) | S | thấp |
| **2** | Accordion-hoá form điểm đo + ẩn field không hợp lệ + hợp nhất selector loại | M | TB |
| **4** | Fix CRUD (dirty-track 403 · nút Tải ảnh · Create dialog đủ field · Việt hoá) | S–M | thấp |
| **3** | Tab-hoá cột detail (4 tab) + đưa Foundation ra tab riêng | M | TB |
| **5** | (tuỳ chọn) Point list dạng DataTable ảo hoá cho board >50 điểm | L | cao hơn |

**Thứ tự khuyến nghị: 1 → 2 → 4 → 3 → 5.** Đợt 1+2+4 cho ~80% giá trị "bớt bối rối" với rủi ro thấp; Đợt 3 (tab-hoá, thay đổi cấu trúc lớn) làm sau khi form đã gọn. Mỗi đợt green-gate (tsc/build) + re-verify live Playwright kịch bản CRUD.

## 6. Trước → Sau

| | Trước | Sau |
|---|-------|-----|
| Toolbar detail | 10 nút flat | 2 nút + menu ⋯ |
| Form VISUAL | 21 nhãn / 2063px | ~6 field CORE, còn lại gập |
| Field không hợp lệ | ~15 ô xám | không hiển thị |
| Selector loại | 2 ô mâu thuẫn | 1 ô + badge |
| Cột detail | 1 cuộn vô tận | 4 tab |
| Foundation P3 | luôn bung giữa trang | tab riêng + cross-link |
| Save điểm/active | 403 im lặng | dirty-track / "Gửi duyệt" |
| Không ảnh | dòng chữ chết | nút "Tải ảnh" |

_Chi tiết ASCII mockup layout tab + form accordion: xem kết quả agent design-proposal (scratchpad exec-pmreview) — sẽ nhúng khi thực thi._
