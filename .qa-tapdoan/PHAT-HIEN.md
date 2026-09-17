# QA lần 11 — sổ phát hiện (thô, ghi ngay khi thấy, kèm bằng chứng)

## PH-01 · BẢO MẬT · test client công khai mang khoá API mặc định — 2026-09-15 06:58
- Nguồn: `client/public/aoi-upload-test-client.html` (tracked, thêm ở commit `9ac41064` 2026-02-10), dòng `<input id="apiKey" value="avi_2642fa…">` (52 ký tự).
- Phơi bày: vite chép nguyên vào `dist/public/` ⇒ `GET http://localhost:3000/aoi-upload-test-client.html` = **200** trên server đang phục vụ; bản dist đo `.qa-tapdoan/dist-a147fc35/public/` cũng có (bị security review tự động bắt).
- Khoá có sống không (DB dev `aoi_management`): bảng `api_keys` 55 hàng, so **nguyên văn / sha256 / tiền tố** ⇒ **0 khớp**; `ai_api_keys` 0 hàng ⇒ trên dev là **khoá chết**. **Production: CHƯA ĐO** (không có DATABASE_URL production).
- Mức: TRUNG BÌNH (dev) / **CHƯA BIẾT** (prod). Ngoài phạm vi twin, KHÔNG sửa trong đợt đo. Đề xuất: bỏ `value=` mặc định, gỡ tệp khỏi bản dựng production, xoay khoá nếu từng sống.

## PH-02 · ĐẠT · Phạm vi tenant đúng 7/7 vai trên dữ liệu 1.151 máy — 2026-09-15 08:47
Đo qua API sản phẩm trên cổng 3064 (bundle `index-DxxtO34H.js`), kỳ vọng tính ĐỘC LẬP từ DB bằng mô hình rời (đếm qua 4 chặng `station→line→workshop→factory`, `.qa-tapdoan/ky-vong-db.json`), thô `.qa-tapdoan/tho/api-vai.json`:
| vai | factory.list | overview (máy) | kỳ vọng DB | phán |
|---|---|---|---|---|
| qatd_giamdoc (gán TẬP ĐOÀN QATD) | 3 (A,B,C) | **1108** | 1108 | ĐẠT |
| qatd_quanly (QATD-A) | 1 | 371 | 371 | ĐẠT |
| qatd_kythuat (A+B) | 2 | 780 | 780 | ĐẠT |
| qatd_congnhan (QATD-C) | 1 | 328 | 328 | ĐẠT |
| qatd_admin (0 gán, bypass) | 5 (+SIM-FAC, T12) | 1150 | 1150 (active) | ĐẠT |
| qatd_khonggan (quyền, 0 gán) | 0 | 0 | 0 | ĐẠT (đối chứng âm) |
| qatd_khongquyen (0 quyền) | 1 | **FORBIDDEN** | CHẶN | CHẶN-ĐÚNG |
★ Đây là lần đầu **§15 mục 26** ("tạo nhà máy thứ hai → view Tập đoàn hiện đủ các khối") đo được: 3 công ty trong MỘT tập đoàn, và **đường gán cấp tập đoàn `user_corporate_assignments` sống** (trước đợt: `factories.corporateCode` NULL 0/3 ⇒ gán tập đoàn chiếu ra 0 nhà máy).
Tổng theo từng nhà máy = tổng không tham số ở cả 5 vai ⇒ hai đường cộng khớp.

## PH-03 · QUAN SÁT · `factory.list` không có cổng quyền — 2026-09-15 08:47
`qatd_khongquyen` (0 hàng `permissions`) vẫn nhận **1 nhà máy** từ `factory.list` (QATD-A, đúng phạm vi gán) trong khi `factoryCommand.overview` và `twinCanh.danhSachToaNha` trả **FORBIDDEN**. Khớp mã: `server/routers/hierarchyRouters.ts:157-159` không gọi `requirePermission` (chỉ `protectedProcedure` + lọc tenant). Hệ quả: rò **tên/mã nhà máy được gán**, không rò máy. Mức: THẤP, cần chủ dự án quyết (fail-closed hay cố ý).

## PH-04 · THIẾT BỊ ĐO · heartbeat hết hạn 5 phút ⇒ toàn cảnh xám — 2026-09-15 08:45
Sau khi sinh dữ liệu ~1 h, `lastHeartbeat` của 1.087 máy QATD đã quá `HAN_MAU_MAY_MS=300000` ⇒ mọi máy sẽ về `khong_ro` (xám) và mọi phép đo màu/trạng thái sẽ SAI OAN. Chữa: `.qa-tapdoan/nhip.sh` chạy `--chi-nhip` mỗi 120 s trong suốt đợt (log `.qa-tapdoan/nhip.log`); 21 máy `offline` cố ý để `lastHeartbeat NULL` (đối chứng).

## PH-05 · ĐẠT · Hợp đồng trạng thái API↔DB khớp 5/5 rổ trên 409 máy — 2026-09-15 08:55
`factoryCommand.overview(factoryId=39 QATD-B)` bằng `qatd_kythuat` vs SQL độc lập (cùng luật tuổi heartbeat 5 phút). Thô: `.qa-tapdoan/tho/G1-hopdong.json`.
| API | số | DB (`operationStatus` × heartbeat tươi) | số |
|---|---|---|---|
| running | 282 | running · tươi | 282 |
| down | 40 | **error** · tươi | 40 |
| idle | 59 | **stopped** · tươi | 59 |
| offline | 8 | **stopped · heartbeat NULL/cũ** | 8 |
| maintenance | 20 | maintenance · tươi | 20 |
| **tổng 409** | | **tổng 409** | |
Ánh xạ tên (`error→down`, `stopped+tươi→idle`, `stopped+cũ→offline`) nhất quán, không rổ nào lệch. Luật `HAN_MAU_MAY_MS=300000` hoạt động đúng cả hai chiều (8 máy hb NULL ra offline; 59 máy cùng `stopped` mà hb tươi ra idle) — đây là đối chứng dương cho chính luật đó.

## PH-06 · SAI (TRUNG BÌNH) · Bảng KPI nổi khai nhãn phạm vi tới cấp TẦNG nhưng đo trên CẢ NHÀ MÁY — 2026-09-15 09:20
Đo (lô B4, `qatd_giamdoc`, `/twin` QATD-A toà T1 **tầng 3**; DB: tầng 3 có **0 máy**; cảnh 3D vẽ **0** khối — ảnh `.qa-tapdoan/anh/AB-B4-qatd_giamdoc-tang3-trong.png`): bảng KPI nổi in nhãn phạm vi `"Corporate · Công ty A · Floor"` (breadcrumb đầy đủ tới cấp tầng) rồi ngay cạnh in `"371 machines"`, `Running 261`, `Machines w/ andon 15` — tức mẫu số của **cả nhà máy QATD-A**.
Vì sao là SAI chứ không phải thiết kế: `kpiNoiLogic.ts:77-82` định nghĩa `mauSo` = "TỔNG SỐ MÁY ĐƯỢC ĐO — mẫu số của mọi tỉ lệ… vì một tỉ lệ không kèm mẫu số là một nửa sự thật"; và `TwinVanHanh.tsx:3318-3321` nói rõ nhãn phạm vi được thêm để *"Nói RÕ đang đo phạm vi nào — một bảng KPI không khai phạm vi thì người xem mặc định hiểu là toàn nhà máy, trong khi cảnh chỉ nạp một tầng"*. Bản vá ấy hiện **gây ra** đúng lớp lỗi nó định chặn: nhãn nói tầng, số nói nhà máy. Nguồn nhãn: `nhanPhamVi={breadcrumb.map(m=>m.nhan).join(" · ")}` (`TwinVanHanh.tsx:3321`).
Hệ quả nghiệp vụ: người xem chọn tầng trống vẫn đọc "371 máy, 261 đang chạy" ⇒ kết luận sai về tầng đó. Lộ ra nhờ dữ liệu 7 tầng/toà (trước đợt này DB dev chỉ 1 tầng).

## PH-07 · NỢ TRẢI NGHIỆM (không phải lỗi mới) · Chọn tầng nhưng không con số nào nói số máy của tầng — 2026-09-15 09:20
`dem-may` panel trái cố ý đếm theo **nhà máy**: `cayVanHanh.ts:58-61` ghi *"ô đếm panel trái (`dem-may`) khai câu thứ hai… G9 — cùng chữ 'máy', hai mẫu số"*. Chuỗi: `TwinVanHanh.tsx:2924` ← `:910` ← `:821` ← `twinCanhRouter.ts:1003-1014` ← `db/twinCanh.ts:951-991` (`traCayPhanCapNhaMay` trả mọi máy của nhà máy; `tangIds` chỉ lọc `datCho`/`vung`). Đã có tài liệu ⇒ KHÔNG chấm SAI mới, nhưng với 7 tầng/toà thì **không có đường nào đọc được số máy của tầng đang xem** — đề nghị vòng sau: thêm ô "máy trên sàn tầng này" hoặc đổi nhãn.

## PH-08 · LỖI CỦA BRIEF (tôi) · A3 và B2/B3/B6 đòi hai phán quyết cho cùng một con số — 2026-09-15 09:20
Brief §3.1 cho A3 chấp nhận `dem-may` khớp nhà máy là ĐẠT, còn B2/B3/B6 đòi `dem-may` khớp **tầng** ⇒ 15 ô SAI của agent bắt nguồn từ mâu thuẫn này, không phải 15 lỗi sản phẩm. **Chuẩn hoá (chủ đợt quyết)**: thước cho "máy của tầng" là **số khối máy trong cảnh 3D**, không phải `dem-may`. Agent đã đo cảnh: QATD-A 45/40/0/0/68/40/41 · QATD-C 39/32/0/0/31/36/51 · QATD-B 63 — **khớp `mayTheoTang` 100 %** ⇒ 13/13 tầng đo được ĐẠT. 15 ô SAI đó tái phân loại: 1 ô SAI thật (PH-06) + 14 ô đo nhầm thước (không tính vào SAI sản phẩm).

## PH-09 · THIẾT BỊ ĐO (tôi) · nhịp 120 s vượt ngưỡng "tươi" 60 s ⇒ nửa chu kỳ mọi máy thành "cũ" — 2026-09-15 09:05
`mauTrangThai.ts:279` `NGUONG_TUOI_MS = 60_000` (và `NGUONG_CU_MS = 300_000` ở `:281`). Nhịp làm tươi của tôi đặt 120 s ⇒ trong ~60 s cuối mỗi chu kỳ, ô `dem-tuoi`/`dem-cu` đảo (agent đọc tuoi=0/cu=364, một phút sau 364/0). Đã hạ **45 s** (`.qa-tapdoan/nhip.sh`). Phép đo PH-05 không bị ảnh hưởng vì nó dùng ngưỡng 5 phút (màu/offline), không dùng ngưỡng 60 s.

## PH-10 · SAI về năng lực, ĐẠT về trung thực · `?pv=tapdoan` không gộp được nhiều nhà máy — 2026-09-15 09:00
`/twin?pv=tapdoan` với `qatd_giamdoc` (thấy 3 công ty) bị `boChonNap.ts:236-245` (`phamViThuc()`) hạ xuống cấp nhà máy, `dem-may=371` (đúng tổng QATD-A, không phải 1.108). Nhưng màn **khai thẳng**: banner *"Showing data for ONE factory (3 factories in the system). The Corporate scope cannot load several factories at once yet…"*, breadcrumb ghi `Corporate › Công ty A`. Gốc: hợp đồng `twinCanh.canhThietKe` nhận **đúng một `factoryId`** (`twinCanhRouter.ts:1003-1014`). ⇒ **§15 mục 26 vẫn CHƯA ĐẠT** (lần đầu đo được nhờ có 3 công ty), nhưng không phải hồi quy và không nói dối người dùng.

## PH-11 · ĐẠT · Nghi vấn "lấy cứng nhà máy đầu" BỊ BÁC BỎ ở `/twin` — 2026-09-15 09:00
`qatd_kythuat` (danh sách gán: QATD-A rồi QATD-B) mở `/twin?nm=39` (QATD-B, **không** phải phần tử đầu) ⇒ cảnh dựng đúng QATD-B, số khối trong cảnh = 63 khớp `mayTheoTang` của tầng QATD-B. Bộ chọn toà/tầng cũng đúng 4 toà × 7 tầng ở cả 3 công ty (B1 ĐẠT 3/3) — **lần đầu đo được bộ chọn tầng** (nợ số 10 của §14q.33: DB dev trước chỉ 1 toà/1 tầng). Nghi vấn `TwinLine.tsx:355`/`TwinMay.tsx:273` vẫn đang được lô C đo riêng.

## PH-12 ★★★ · SAI (CAO) · KẾT CỤC GỐC VỠ: màn Line và màn Máy lấy CỨNG nhà máy đầu + toà nhà đầu — 2026-09-15 09:45
**Mã (tôi tự đọc, không nhận lời khai):**
- `client/src/pages/TwinLine.tsx:355` và `client/src/pages/TwinMay.tsx:284`: `const factoryId = factories[0]?.id ?? null;`
- `client/src/pages/TwinLine.tsx:373-378` và `client/src/pages/TwinMay.tsx:297-302`: `toaNhaDau = (toaNhaQ.data ?? [])[0] ?? null` rồi `chiTietToaNha({id: toaNhaDau.id})` — chỉ hỏi đặt chỗ của **toà đầu**.
- Thứ tự quyết định bởi `server/db/hierarchy.ts:340` `orderBy(factories.name)` và `server/db/twinCanh.ts:260` (toà sắp theo `ma`).

**Phép đo QUYẾT ĐỊNH của tôi (API, độc lập với phép đo UI của agent)** — `.qa-tapdoan/kiem-factories0.mjs`, thô `.qa-tapdoan/tho/kiem-factories0.json`:
| vai | nhà máy đầu theo tên | `factoryCommand.machineDetail(4977)` (máy QATD-C) | `danhSachToaNha(QATD-C)` |
|---|---|---|---|
| qatd_admin (5 nhà máy) | 38 QATD-A "Công ty A" | **CÓ DỮ LIỆU** | 4 toà |
| qatd_giamdoc (3) | 38 QATD-A | **CÓ DỮ LIỆU** | 4 toà |
| qatd_kythuat (A+B) | 38 QATD-A | NOT_FOUND (đúng phạm vi) | [] |
⇒ **API CHO PHÉP admin/giám đốc xem máy 4977, nhưng UI TỪ CHỐI** ("Không mở được máy #4977 — không thuộc phạm vi đang xem"), trong khi **công nhân** (quyền hẹp nhất, 1 nhà máy) mở được CÙNG máy đó. Quyền, phạm vi tenant và dữ liệu đều bị loại trừ: nguyên nhân duy nhất còn lại là trang hỏi `factories[0]`.

**Hai triệu chứng khác nhau, cùng gốc:**
1. Sai nhà máy (`factories[0]`): line/máy thuộc nhà máy **không đứng đầu theo tên** ⇒ màn Máy nói "không thuộc phạm vi đang xem"; màn Line nói "Chuyền này chưa có máy nào" + `Máy 0 · Trạm 0` (line 249 QATD-B với kythuat).
2. Sai toà nhà (`toaNha[0]`): line/máy **đúng nhà máy nhưng ở toà 2–4** ⇒ header đúng số mà cảnh 3D trống (line 299 QATD-C toà T3: "Máy 10 · Trạm 10" nhưng **0 khối**); màn Máy khai "Máy này chưa có chỗ trên bố cục 3D" cho máy 5139 **dù DB có đúng 1 hàng `twin_dat_cho`**.

**Bán kính (mô hình từ mã, khớp 10/10 điểm đã đo; `.qa-tapdoan/pham-vi-hong.mjs`):** kythuat **89,6 %** line không vẽ đủ · giamdoc 92,9 % · admin 93,1 % · congnhan 77,4 % · quanly 78,1 %.
**Vì sao 10 đợt QA trước không thấy:** docblock ngay trên dòng đó viện lý do "đo 2026-09-09: 2 nhà máy, toàn bộ 82 hàng `twin_dat_cho` ở MỘT tầng". Dữ liệu đợt này (3 công ty · 12 toà · 2.338 hàng đặt chỗ · 24 tầng) làm **hết hạn** tiền đề đó — đúng lớp G148 "lý do hoãn có HẠN SỬ DỤNG".
**Đối chứng dương giữ kết luận khỏi lời khai đẹp:** cùng vai kythuat, máy 4197 và line 217 (QATD-A = nhà máy đầu) ĐẠT đầy đủ; C3 bấm tâm khối 5/5 đúng id; C2.2/C1.3 (congnhan, QATD-C = nhà máy đầu của chính vai đó) ĐẠT.

## PH-13 · SAI (THẤP) · Màn Line không phân biệt "ngoài phạm vi" với "chưa xếp chỗ" — 2026-09-15 09:45
`LyDoManLine` chỉ có `mo | chuaGanNhaMay | thieuQuyen` (`client/src/components/twin3d/van-hanh/manLine.ts:412`) — thiếu `ngoaiPhamVi`, khác `LyDoManMay`. Nên line của nhà máy khác trả cùng MỘT câu với line bị lỗi PH-12: "Chuyền này chưa có máy nào trên bố cục — … hoặc thuộc một nhà máy khác". API sạch (7/7 lời gọi ngoài phạm vi đều NOT_FOUND/[]/null ⇒ **không rò dữ liệu**), nhưng người dùng không phân biệt được hai tình huống.

## PH-14 ★★ · SAI (CAO) · Studio chỉ thiết kế được TẦNG 1 CỦA TOÀ 1 — 88 % máy ngoài tầm với — 2026-09-15 10:10
Đo (`qatd_kythuat`, `/twin-studio`, QATD-A): `dem-toa-nha` in **"Building: 4"** nhưng màn chỉ có MỘT bộ chọn (`chon-nha-may`) — **không ô chọn toà, không ô chọn tầng**. Dải sức khoẻ in *"45 machines placed · **326 awaiting placement**"*; 45 = đúng số máy của `twin_tang` id 81 (QATD-A toà T1 tầng 1) trong DB.
Mã (tôi tự kiểm): `client/src/pages/TwinStudio.tsx:106` `const toaNhaDau = (toaNhaQ.data ?? [])[0]`, `:125` `const tang = (chiTietQ.data?.tangs ?? [])[0]`; `grep -cE "setToaNha|setTang|chon-toa-nha|chon-tang" TwinStudio.tsx` = **0** ⇒ không có đường nào đổi toà/tầng.
Hệ quả: với kịch bản 4 toà × 7 tầng, **326/371 máy (88 %) của QATD-A không thể xếp chỗ bằng màn thiết kế**; toà 2-4 và tầng 2 (xưởng thứ hai) không tiếp cận được. Đối chứng sắc nét: màn XEM `/twin` CÓ đủ ba ô chọn ("Công ty ▾ / Toà ▾ / Tầng ▾") và hoạt động đúng (PH-11) ⇒ năng lực chọn toà/tầng đã tồn tại ở màn khác, chỉ thiếu ở Studio. Cùng gốc `[0]` với PH-12.

## PH-15 · SAI (TRUNG BÌNH) · Studio gác mọi công cụ GHI bằng MỘT cờ canEdit, bỏ qua canCreate — 2026-09-15 10:10
`client/src/components/twin3d/thiet-ke/XuongThietKe.tsx:173` `const coQuyenSua = quyenSettings.canEdit || quyenMayMoc.canEdit;` và `:174` `chiDoc = !coQuyenSua`; `grep canCreate` trong cả `thiet-ke/*.tsx` + `TwinStudio.tsx` = **0 dòng**. Nhưng server gác `twinCanh.dungNhaXuong` = `quyenThietKe("canCreate")` và `twinCanh.sinhTuDong` = `adminProcedure`.
Đo (`qatd_quanly`, có canEdit, **0 canCreate**): nút `nut-mo-sinh` "Generate" **render + enabled**, và tab "Add building" đi hết 3 bước tới nút **"Create building" render + enabled** ⇒ người dùng bấm xong mới nhận 403. Đúng lớp lỗi "một lối vào rồi TỪ CHỐI" (cùng họ G149). Agent KHÔNG bấm để tránh ghi đè bố cục; kết luận 403 suy từ cổng server đọc được.

## PH-16 · SAI (THẤP) · Nút "Mở chức năng" cấp nhà máy/line có mã nhưng 0 chỗ gọi — 2026-09-15 10:10
`NganXuLy.tsx:148` khai `loaiDich?: LoaiDich` với mặc định `"machine"` (`:170`). Grep `loaiDich:` trong mã sản phẩm (`client/src`, `server`, loại trừ test) ⇒ **0 chỗ gọi truyền giá trị khác**; chỉ 2 tệp test truyền `"robot"`/`"station"`. Hệ quả đo được: `qatd_quanly` chọn nhà máy/line vẫn chỉ thấy 5 đích **cấp máy**, không có `/corporate-dashboard` lẫn `/oee-dashboard` dù có quyền `dashboard_corporate` + `analytics_oee`. Hai dòng `factory`/`line` của bảng §9.3 là mã chưa giao hàng (lớp G5 "có mã + có test + không nối chỗ gọi").

## PH-17 · SAI (THẤP) · Hành động "ghi chú" khai trong logic nhưng 0 UI ở mọi vai — 2026-09-15 10:10
`nganXuLyLogic.ts:53,142` khai hành động `ghiChu` với `duocPhep: quyen.ackAlarm`, nhưng đo 5 vai (kể cả `qatd_admin`) ⇒ **0 nút ghi chú render**. Cùng lớp G5 với PH-16.

## PH-18 · QUAN SÁT · Hai tập số cạnh nhau trên /twin, không câu nào nói ra — 2026-09-15 10:10
`qatd_giamdoc` trên `/twin`: bảng KPI nói "371 machines · Công ty A" (bám **nhà máy đang xem**) trong khi `dai-canh-bao` in "Alarms (**55**)" = andon của **cả 3 công ty** (bám **phạm vi tenant**). Hai mẫu số khác nhau hiển thị cạnh nhau, không nhãn nào phân biệt. Bổ sung cho PH-06.

## PH-19 · ĐẠT (đối chứng chốt PH-12 lần thứ ba) · Rào cản nằm ở CLIENT, không ở server — 2026-09-15 10:10
Cùng cookie `qatd_kythuat` bị UI từ chối máy 4568, gọi thẳng `maintenance.createWorkOrder` cho **chính máy 4568** ⇒ **HTTP 200**, hàng `WO-4568-…` được tạo thật trong `maintenance_work_orders` (đã xoá sau đo). Ba đường độc lập cùng kết luận: `machineDetail` trả dữ liệu (PH-12), `createWorkOrder` ghi được (PH-19), UI từ chối. ⇒ PH-12 là lỗi client, không phải quyền/tenant.

## PH-20 · LỖI CỦA BRIEF (tôi) · bảng §2 ghi quanly "ẩn tạm: có" là sai — 2026-09-15 10:10
Ẩn tạm đòi `machine_control/**canCreate**`, nhưng bộ sinh tài khoản của tôi chỉ cấp `machine_control` V+E cho `qatd_quanly` ⇒ UI ẩn nút là ĐÚNG. Ô đó không tính là SAI sản phẩm; sửa bảng §2 thay vì sửa sản phẩm.

## PH-21 · QUAN SÁT AN TOÀN · `xemTruocSinh` (canView) trả kế hoạch dồn 782 thực thể vào tầng rỗng — 2026-09-15 10:10
Giả định an toàn ban đầu ("chọn tầng rỗng thì vô hại") SAI: với `tangIds:[83]` (tầng 0 đặt chỗ), `twinCanh.xemTruocSinh` vẫn trả kế hoạch **782** thực thể. Thứ giữ an toàn ở E7 là cổng `adminProcedure` của `sinhTuDong` (kythuat gọi ⇒ **403 FORBIDDEN**, ca dương `xemTruocSinh` ⇒ 200), không phải việc chọn tầng rỗng.

## PH-22 · HÀNG TẠM · đã dọn, còn 2 hàng audit_logs không xoá được (append-only) — 2026-09-15 10:10
`andon_events` 62→63→**62** · `maintenance_work_orders` 29→31→**29** · `twin_vat_the` 341→342→**341** (xoá qua nút UI) · `twin_toa_nha`/`twin_tang`/`twin_dat_cho` **không đổi**. Còn 2 hàng `audit_logs` (id 5765, 5778, `entityName='QATD-DE-RAISED-M4977'`): `DELETE` trả `permission denied for table audit_logs` — bảng kiểm toán append-only, đúng thiết kế. Nhận diện bằng `entityName LIKE 'QATD-DE-%'`. Không chạm SIM-FAC/T12-SHOT.

## PH-23 ★★★ · SAI (CAO — BẢO MẬT) · `commandCenter.hierarchy` KHÔNG lọc phạm vi tenant: mọi vai nhận CÙNG 450.811 byte — 2026-09-15 11:05
**Mã:** `server/routers/commandCenterRouter.ts:51-58` — `hierarchy: protectedProcedure.use(requirePermission("machine_monitoring","canView")).input(z.object({scope: scopeInput}).optional()).query(async ({input}) => buildHierarchy(input?.scope ?? undefined))`. Phạm vi lấy từ **`input`** (lời tự khai của client), **không** từ `ctx.user`; `grep phamViCua` trong tệp = **0 lần**. Ngay bên dưới, `kpiSummary` (`:60-80`) CÓ thu hẹp theo người xem, docblock `:65-68` viết rõ *"thu hẹp theo nhà máy của NGƯỜI XEM (không phải theo `input` — `input` là lời tự khai)"* ⇒ tác giả biết luật, **bỏ sót đúng thủ tục nặng nhất**.

**Đo (tôi tự chạy, `.qa-tapdoan/kiem-hierarchy.mjs`, thô `.qa-tapdoan/tho/kiem-hierarchy.json`) — đối chứng hai chiều CÙNG PHIÊN:**
| vai | `commandCenter.hierarchy` | tên lộ ra | `factory.list` | `factoryCommand.overview` |
|---|---|---|---|---|
| qatd_admin | 200 · 450.811 B · md5 `f6c484e0d0a1` | A,B,C,SIM-FAC,T12 | 5 | 1150 |
| qatd_giamdoc | 200 · **450.811 B** · md5 **y hệt** | A,B,C,SIM-FAC,T12 | 3 | 1108 |
| qatd_kythuat | 200 · **450.811 B** · md5 **y hệt** | A,B,C,SIM-FAC,T12 | 2 | 780 |
| qatd_congnhan | 200 · **450.811 B** · md5 **y hệt** | A,B,C,SIM-FAC,T12 | 1 | 328 |
| **qatd_khonggan (0 gán)** | 200 · **450.811 B** · md5 **y hệt** | A,B,C,SIM-FAC,T12 | **0** | **0** |
| qatd_khongquyen (0 quyền) | **403** | — | 1 | FORBIDDEN |
**5 vai, 1 md5 duy nhất.** Cây lộ: `site 1 · factory 5 · line 102 · station 1.145 · machine 1.151` kèm tên nhà máy và số cảnh báo. Người dùng **0 gán nhà máy** (mọi cổng khác trả 0) vẫn đọc trọn cây của cả 5 nhà máy, gồm SIM-FAC của hệ cũ. Cùng lớp lỗi G113 đã vá cho `factoryCommand.overview` hôm 2026-09-10 (`e7b6afd1`) — **sót một thủ tục**.
**Hệ quả kép:** (1) rò danh mục tài sản xuyên tenant; (2) chi phí truy vấn = chi phí CẢ CSDL nên lớn lên cùng dữ liệu ⇒ là nguyên nhân chính của PH-24.
Cổng quyền vẫn chặn vai 0 quyền (403) ⇒ không phải lỗ hoàn toàn mở, nhưng mọi vai hợp lệ đều thấy hết.

## PH-24 ★★ · SAI (CAO) · 48/48 lượt tải vượt ngưỡng 2.500 ms — nguyên nhân ở cổng vào, không ở 3D — 2026-09-15 11:05
Đo `qatd_kythuat` @1600 và @1280, 4 màn deep-link, 3 lượt/màn, **mỗi lượt một browser context mới**, 1 worker: **p50 2.615 · p90 2.858 · max 3.089 ms — 48/48 vượt 2.500 ms**. Chuỗi 5 phép đo loại từng giả thuyết:
1. Không do cỡ cảnh: cùng admin, cảnh 41 máy **1.291 ms** vs cảnh **68 máy 1.259 ms**.
2. Không do màn twin: `/oee-dashboard` (không 3D) = 1.238 ms ⇒ sàn khởi động vỏ ≈1,2 s.
3. **Do VAI**: cùng URL, xen kẽ 4 lượt — admin **1.182** vs kythuat **3.154** vs giamdoc **3.151** ms, `khối = 68` ở cả ba.
4. Thủ tục: `commandCenter.hierarchy` **1.674 ms**, 4 thủ tục còn lại trong lô 4-20 ms, cả lô 1.890 ms. tRPC `httpBatchLink` chỉ trả lô khi thủ tục **cuối** xong ⇒ cổng quyền của twin bị kéo theo; admin bỏ qua cổng nên không chờ.
5. Vì sao nặng: PH-23 (không lọc tenant ⇒ quét cả CSDL).
**Ablation bác bỏ giả thuyết đầu của agent:** 0 máy cũng 1.646 ms (6 vai, 0→1.150 máy: 1.646/1.737/1.690/1.739/1.768/1.664) ⇒ không tỉ lệ theo số máy; đối chứng cùng thiết bị `factoryCommand.overview` **có** tăng (8→55 ms, 0→389 KB) ⇒ thiết bị đo biết phân biệt.
**Khép vòng với QA lần 10:** admin hôm nay **1.182 ms** ≈ QA10 **1.169 ms** ⇒ sàn khởi động **không hồi quy**; toàn bộ +1,45 s là cổng quyền chờ một truy vấn không lọc tenant.

## PH-25 ★★ · THIẾT BỊ ĐO (ảnh hưởng MỌI lưới e2e của dự án) · Playwright mặc định chạy SwiftShader (CPU), không phải GPU — 2026-09-15 11:05
`chromium.launch()` không cờ ⇒ WebGL chạy SwiftShader. Thêm `--use-angle=default --enable-gpu --ignore-gpu-blocklist` mới ra RTX 5090. Cùng cảnh, cùng thao tác: **26,1 FPS (CPU) → 62,1 FPS (GPU)**. ⇒ ngưỡng "FPS xoay ≥30" của §4 **trượt trên CPU và đạt trên GPU**; mọi số FPS trong 10 đợt QA trước là số CPU. Cũng phát hiện thước cũ sai: "40 bước kéo/giây" đo tốc độ harness (113 khung / 40 sự kiện CDP ~90 ms/bước), phải đo Δt giữa hai khung.

## PH-26 · ĐẠT · TỐI ƯU đứng vững với biên rất rộng trên dữ liệu 26× — 2026-09-15 11:05
Tầng 68 máy: **5 draw calls** (trần 150, biên 25×) · **15.026 tam giác** (trần 500.000, biên 33×) · **6 nhãn DOM** @1600 (trần 30; 73 ứng viên, giấu 67, chip "67 other names hidden" trung thực) · `__soCanvas` = **1 ở 10/10 ca** (N-1/RB-4) · thời gian một khung **bằng** cảnh 12 máy (16,1 vs 16,4 ms) dù gấp 15× tam giác · FPS xoay GPU p50 **62,1** (khung tệ nhất 36,6) · idle **46,7 s cuối không một khung** dù 106 bản tin realtime vẫn tới (frameloop `demand` hoạt động). ĐẸP: **0 cặp chồng lấn / 0 px²** badge×nhãn và nhãn×nhãn ở 8/8 ca, lệch lớp phủ **(0,0,0,0)** 10/10, 0 tràn ngang 0/8 — ở mật độ cao nhất từng đo.

## PH-27 · SAI (TRUNG BÌNH) · Mã máy bị cắt ở 1280 làm danh sách mất khả năng phân biệt — 2026-09-15 11:05
14 chuỗi trong `danh-sach-may` có `scrollWidth 124 > clientWidth 66`; phần sống sót là `QATD-A-T…` — **tiền tố dùng chung của mọi máy**, phần phân biệt ở đuôi (`-L1-M01`) bị cắt ⇒ mọi hàng đọc giống hệt nhau (thấy rõ trên ảnh `.qa-tapdoan/anh/F-*1280*.png`). Chỉ lộ với mã 19 ký tự của kịch bản tập đoàn (mã SIM-FAC ngắn hơn). ★ **Màn Line đã có lời giải sẵn**: in "Prefix: QATD-A-T1-X1-L1-" một lần rồi rút nhãn còn `M01..M12` — áp cùng cách cho danh sách máy là đủ.

## PH-28 · SAI (THẤP) + 1 HỎNG · Bảng 2D sức khoẻ chưa giao; không có bộ đếm để đo vòng viền — 2026-09-15 11:05
`xepHangSucKhoe()` tồn tại (`sucKhoeMay.ts:406`) và có ca kiểm đơn vị nhưng **0 chỗ gọi** trong mã sản phẩm, trong khi §11.5 đòi bảng 2D song song với lớp phủ màu (lớp phủ `vienSucKhoe` ĐÃ giao, vòng đỏ/hổ phách nhìn thấy trên ảnh) — cùng lớp G5 với PH-16/PH-17.
**HỎNG (lỗ thiết bị đo của sản phẩm):** không đo được màu vòng viền sức khoẻ vì thiếu `window.__demVien` (sản phẩm có `__demNhan`/`__demBadge` nhưng không có bộ đếm cho vòng) và cấm đọc pixel (G34). Đo được đầu vào (`sucKhoeMay` tầng 88: 371 lời khai, `nguy_kich 124 · canh 133 · theo_doi 62 · khoe 52` ⇒ 319 vòng, 3 màu) và thấy vòng trên ảnh, nhưng mắt không phải phép đo ⇒ **một lớp phủ màu chưa từng đo được ở bất kỳ đợt QA nào**.

## PH-29 · QUAN SÁT · Studio: khung 3D gần TRỐNG ở cả hai viewport — 2026-09-15 11:05
Ảnh studio (kythuat, QATD-A): sàn lưới ở rất xa, 45 máy co thành vệt mờ, minimap CÓ chấm ⇒ camera không khung hình lấy nội dung của chính nó. Không chấm ô này vì studio thiếu bộ đếm khối để đo (cùng lỗ với PH-28). Cộng với PH-14 (chỉ tầng 1 toà 1) và PH-15 (nút tạo bật sai), đường BUILD là phần yếu nhất của sản phẩm trên kịch bản này.

## PH-30 · SAI (TRUNG BÌNH) · Dòng dải cảnh báo không mang danh tính máy/công ty — 2026-09-15 11:40
`CanhBaoDai` có `machineId/lineId/workshopId` nhưng **không có factory**, và `DaiCanhBao.tsx:137` chỉ in tiêu đề cảnh báo. Đo qua ảnh: `qatd_quanly` thấy "Alarms (15)" mà **cả 15 dòng đọc y hệt nhau**, không dòng nào nói máy nào (`.qa-tapdoan/anh/DE-D1-quanly-twin.png`); `qatd_giamdoc` thấy "Alarms (55)" của cả 3 công ty mà không phân rã được theo công ty. Hệ quả: câu hỏi nghiệp vụ trung tâm của giám đốc — *"công ty nào tệ nhất hôm nay"* — **không trả lời được ngay cả khi PH-10 được vá**, và quản đốc phải bấm từng dòng để biết máy nào.

## PH-31 · SAI (TRUNG BÌNH) · Bảng KPI nổi CHE lời khai trung thực của chính sản phẩm — 2026-09-15 11:40
Ba ảnh vai giám đốc (`AB-A3-qatd_giamdoc.png`, `AB-B4-…-tang3-trong.png`, `AB-B7-…-tapdoan.png`): lớp phủ `bang-kpi-noi` đè lên banner *"326 machines are outside this load"* và lên cả hai dòng banner trung thực của `?pv=tapdoan` (PH-10), cắt câu giải thích ở giữa. Nghịch lý: sản phẩm **nói thật** về hạn chế của mình rồi **tự che** câu đó. Lỗ thiết bị đo: F4 chỉ đo cặp badge × nhãn **trong canvas**, chưa có phép đo chồng lấn cho cặp `bang-kpi-noi` × banner/thông báo ⇒ lớp lỗi này chưa từng bị lưới nào bắt.

## PH-32 · SAI (TRUNG BÌNH) · Danh sách máy bên trái không theo toà đang xem — 2026-09-15 11:40
Ảnh `F-F5-twin-tang-dong-68may-1600.png` và bản 1280: cảnh 3D vẽ **toà 2** (68 máy, đúng tầng đã chọn) nhưng `danh-sach-may` panel trái vẫn liệt kê máy của **toà 1**. Hai bảng cạnh nhau nói hai toà khác nhau, không nhãn nào phân biệt. Cùng họ PH-06/PH-07 (mẫu số của panel trái là nhà máy, không phải phạm vi đang xem) nhưng đây là biểu hiện nặng hơn: danh sách **sai tập**, không chỉ sai tổng.

## PH-33 · ĐIỂM CÔNG BẰNG cho PH-16 · `/corporate-dashboard` vẫn vào được qua menu — 2026-09-15 11:40
`navigation.tsx:256-264` cho phép vào `/corporate-dashboard` bằng thanh menu với quyền `dashboard_corporate` (cả `qatd_quanly` và `qatd_giamdoc` đều có). ⇒ hậu quả của PH-16 là **mất ngữ cảnh** (`?factoryId=` không được truyền, người dùng phải tự chọn lại nhà máy), **không phải mất tính năng**. Hạ mức PH-16 xuống THẤP.

## PH-34 · SAI (TRUNG BÌNH) · "Báo bất thường" — việc thường xuyên nhất của công nhân — KHÔNG có trên twin — 2026-09-15 12:05
`nganXuLyLogic.ts` khai đúng **6** hành động: `ack · anTam · ghiChu · taoPhieu · ganKyThuat · datUuTien` — **không có hành động bật andon / báo sự cố**. Server thì CÓ: `andonRouter.ts:199` `raise` và `:239` `quickReport`, cả hai gác `requirePermission("andon","canCreate")`. Và **khuôn quyền mặc định của vai `operator` CÓ `andon` với `canCreate: true`** (`permissionsRouter.ts` khối operator, dòng `andon`: `canView/canCreate/canEdit` = true/true/true) ⇒ sản phẩm **đã trao quyền báo sự cố cho công nhân ở tầng quyền và có API, nhưng màn twin không có nút**. Đây là lỗi thiếu chỗ gọi (lớp G5), không phải lỗi quyền.
Ghi chú: bộ sinh tài khoản của tôi cấp `andon` V+E cho `qatd_congnhan` (thiếu C so với khuôn mặc định) ⇒ **một phần** quan sát ban đầu là lỗi cấu hình của tôi; nhưng việc `nganXuLyLogic` không có hành động nào cho andon là lỗi sản phẩm, độc lập với cấu hình.

## PH-35 · SAI (TRUNG BÌNH) · Ngăn xử lý trên `/twin` không có nút nào ở vai kỹ thuật lẫn công nhân — 2026-09-15 12:05
Thô `.qa-tapdoan/tho/DE/D1-*.json`: `nutTrongNgan = []` trên `/twin` cho cả `qatd_kythuat` và `qatd_congnhan` (nút chỉ xuất hiện ở màn `/twin/may/:id`). Hệ quả nghiệp vụ: 21 cảnh báo của một tầng = **21 lần điều hướng đi-về**, mỗi lần cộng thêm chi phí PH-24 (>2.500 ms). Tài liệu §1093 đặt mục tiêu ngược lại: *"hành động ở ngăn 2D bên phải, ngữ cảnh ở 3D bên trái — người dùng click máy trên 3D → ngăn xử lý mở ra ngay cạnh"*.

## PH-36 · CHƯA ĐO · Hai con số rủi ro ngược nhau cách 300 px trên cùng màn — 2026-09-15 12:05
Ảnh `.qa-tapdoan/anh/DE-D1-kythuat.png`: chip twin in "Health 50 % · **critical**" trong khi ô cockpit 2D ngay dưới in "Failure risk **0 %**". Hai chỉ số cùng nói về nguy cơ của một máy, hai nguồn khác nhau, không câu nào giải thích. **Chưa đo** (cần đối chiếu nguồn `sucKhoeMay` vs nguồn `predictive_alerts`/PdM và xác định cái nào đúng) — ghi vào vòng sau.

## PH-37 · SCHEMA DRIFT (xác nhận lần 2) · `workshops.tangId` CÓ trong DB nhưng VẮNG trong schema Drizzle — 2026-09-15 14:30
Agent vá PH-12 báo "`workshops` **không có cột `tangId`**, nên đường xưởng→tầng không tồn tại". Tôi kiểm: **cột CÓ THẬT trong DB** (`information_schema`: `tangId integer nullable`; migration `drizzle/0350_twin_toa_nha_va_tang.sql:127` `ALTER TABLE workshops ADD COLUMN IF NOT EXISTS "tangId"`, `:135` FK → `twin_tang(id) ON DELETE SET NULL`), và bộ sinh dữ liệu của đợt này đã ghi vào nó (24/24 xưởng QATD có `tangId`, cầu chì xác nhận). Nhưng `grep tangId drizzle/schema/hierarchy.ts` = **0** ⇒ **schema drift**: mọi đường Drizzle mù với cột này, nên agent đọc schema và kết luận "không tồn tại" là hợp lý từ góc nhìn của họ.
Hệ quả: (a) lời khai "đường JOIN không tồn tại" **sai về DB, đúng về Drizzle**; (b) `drizzle-kit generate` có thể sinh migration **DROP** cột này; (c) đường agent chọn thay thế (`twin_dat_cho.tangId → twin_tang.toaNhaId`) **vẫn đúng và chặt hơn**, vì hàng đặt chỗ mới là nguồn sự thật về "thực thể đứng ở tầng nào" — bản vá không bị ảnh hưởng.
**ĐÍNH CHÍNH (2026-09-15 17:10, phiên `-86` bác, tôi kiểm lại và xác nhận họ đúng):** câu "`drizzle-kit generate` có thể sinh migration DROP cột này" của tôi **SAI**. `generate` so `schema.ts` với **snapshot trong `drizzle/meta/`**, không so với DB sống; `grep '"tangId"' drizzle/meta/*.json` = **0 tệp** ⇒ cả hai phía đều không biết cột này, **không có gì để DROP**. Đường mất cột thật là **`drizzle-kit push`** (so với DB sống, gỡ mọi thứ không có trong `schema.ts`).

**★★★ PHÁT HIỆN LỚN HƠN mà PH-37 che mất — tôi tự đo lại:** chuỗi meta drizzle **đóng băng ở `0017_snapshot.json`** (`_journal.json` chỉ 18 mục, mục cuối `0017_volatile_bug`) trong khi thư mục có **355 tệp `.sql`**, cao nhất `0356_index_suc_khoe_may_theo_createdat.sql`. ⇒ `drizzle-kit generate` ở repo này sẽ diff với ảnh chụp cũ hơn **~338 migration** và sinh ra một migration khổng lồ dựng lại gần như toàn schema. **Đây là vấn đề của cả pipeline drizzle-kit, không riêng `tangId`.**

⇒ PH-37 tách làm hai việc:
- **(a)** `workshops.tangId` vô hình với ORM — vá bằng cách **khai cột vào `drizzle/schema/hierarchy.ts`** (không cần migration, cột đã có trong DB).
- **(b)** meta drizzle lệch ~338 migration ⇒ **ghi luật CẤM `drizzle-kit push`** trên repo này, và coi `generate` là **không dùng được** cho tới khi rebase snapshot. Migration mới viết tay (như 0350, chạy bằng `scripts/apply-migration-0350.mjs` với owner `aoi`).

# ══════ VÒNG 2 — ĐO LẠI SAU VÁ (2026-09-15 14:50) ══════
Bản dựng đo: `.qa-tapdoan/dist-sauva` bundle `index-65hzR42G.js`, md5 903 dòng; ký hiệu bản vá có trong bundle (`noiCuaThucThe` client 2/server 1 · `chon-toa-nha` 1 · `chon-tang` 1 · `ngoaiPhamVi` 6 · `resolveHierarchyScope` server 3) và ký hiệu cũ còn nguyên. Dữ liệu sinh lại: cầu chì **32/32**, id mới (QATD-A=41 line 315 máy 5305 · B=42/347/5676 · C=43/382/6085).

## V-01 ★★★ ĐẠT · PH-23 ĐÓNG — cây phân cấp nay lọc đúng phạm vi từng vai
Thô `.qa-tapdoan/tho/kiem-hierarchy-v2.json`. **5 vai → 5 md5 KHÁC NHAU** (vòng 1: 1 md5 duy nhất).
| vai | vòng 1 | vòng 2 | tên lộ ra | thời gian |
|---|---|---|---|---|
| admin (5 nhà máy) | 450.811 B | 450.876 B | A,B,C,SIM-FAC,T12 | 2.668 ms |
| giám đốc (3) | **cùng 450.811 B** | **434.894 B** | **chỉ A,B,C** | 2.163 ms |
| kỹ thuật (2) | **cùng 450.811 B** | **305.943 B** | **chỉ A,B** | 1.508 ms |
| công nhân (1) | **cùng 450.811 B** | **129.280 B** | **chỉ C** | 564 ms |
| **0 gán** | **cùng 450.811 B** | **470 B** | **rỗng** | **24 ms** (vòng 1: 1.768 ms) |
| 0 quyền | 403 | 403 | rỗng | 23 ms |
Đối chứng dương: mỗi vai có gán vẫn thấy **đúng tập của mình**, tên lộ ra khớp bảng gán. Đối chứng âm: người 0 gán nhận cây rỗng. Chi phí nay **tỉ lệ với phạm vi người xem**, không với cả CSDL — đúng hướng PH-24.
Bản vá còn tìm ra **bề mặt song sinh cùng lỗ**: `GET /ecosystem/hierarchy` (trục khoá API, `server/api/v1/moduleReads.ts:381-410`) — đã vá cùng khuôn.
Ablation của agent (gỡ vá trên CSDL test 5.308 nhà máy): 8/11 ca đỏ lại, **người 0 gán thấy 26.822 nút**; thời gian 102.542 ms → 43 ms (vai hẹp) và 72.023 ms → 6 ms (0 gán); trước vá hai vai nhận **byte y hệt nhau** ⇒ tái hiện PH-23 trên một CSDL khác.

## V-02 · Cổng nền sau vá
`npm run check` **0 lỗi** · `i18n:check` **0/0/0/0** · `vitest twin3d` **112 tệp / 2.617 xanh** (nền 109/2.539 — tăng do lưới mới của hai bản vá) · `vitest phamVi` **17 tệp / 441 xanh** · `vitest commandCenter` **5 tệp / 91 xanh** · `vitest moduleReads` 34 xanh.
Một ô census phải cập nhật GHIM `S 325→326 · tong 2267→2268`: bản vá PH-12 thêm đúng **một** thủ tục `twinCanh.noiCuaThucThe` vào nhóm **S** (đã lọc phạm vi). **Nhóm A giữ nguyên 341** (A = "đọc tenant KHÔNG lọc") và ô đột biến §7 vẫn xanh ⇒ thủ tục mới không phải nhóm rò. Lô PH-23 cố ý chừa phần ký này cho lô kia; hai lô nay cùng một đợt nên chủ đợt ký, có ghi lý do trong tệp.

## V-03 · THIẾT BỊ ĐO (tôi) · `vite build --outDir` tương đối ghi vào `client/` vì `root: client/`
Lượt dựng đầu của vòng 2 báo "✓ built in 36.17s" nhưng `dist-sauva/public/index.html` **không tồn tại** và md5 chỉ 2 dòng — output rơi vào `client/.qa-tapdoan/dist-sauva/public/`. Vòng 1 tôi dùng đường **tuyệt đối** nên không dính. Đã dọn `client/.qa-tapdoan/` và dựng lại bằng đường tuyệt đối (903 dòng md5). **Luật: `--outDir` của vite trong repo này PHẢI là đường tuyệt đối.**

## V-04 ★★★ ĐẠT · PH-12 + PH-13 ĐÓNG — kết cục gốc chạy lại được trên dữ liệu nhiều toà
Đo trên `dist-sauva`, id mới, ảnh `.qa-tapdoan/anh/V2-*.png`, thô `.qa-tapdoan/tho/V2/`:
| ca | vòng 1 | vòng 2 |
|---|---|---|
| R1 kythuat → chuyền QATD-B (line 347) qua **cây phân cấp** | "Máy 0 · Trạm 0", cảnh trống | "Machines 15 · Stations 15 · WIP 65", **15 khối**, 15 nhãn, `__soCanvas`=1 |
| R2 congnhan → chuyền QATD-C **toà 3** (line 397) | header đúng số, **0 khối** | "Machines 10 · Stations 10", **10 khối** + nhãn M01–M10 + dải trạm S01–S10 |
| R3 kythuat → máy QATD-B (5676) | "không thuộc phạm vi đang xem" | mở được, `WAVE_SOLDER-01` khớp DB, 1 canvas |
| R4 congnhan → máy QATD-C toà 3 (6247) | "chưa có chỗ trên bố cục 3D" | `SPI-01`, `may-chua-dat-cho` = **0** |
| R5 về từ màn Máy | mất nút về chuyền | `ve-man-line` → `/twin/line/347`, đúng nhà máy 42 |
| R6 chuyền ngoài phạm vi (PH-13) | cùng MỘT câu với "chưa xếp chỗ" | `data-ly-do="ngoaiPhamVi"`, **câu khác hẳn** |
Bằng chứng thị giác mạnh nhất: chỗ vòng 1 chỉ có sàn trống với một cây cột đèn, vòng 2 có 10 khối máy đọc được tên.

## V-05 ★★ ĐẠT · PH-14 + PH-15 ĐÓNG — Studio thiết kế được mọi toà/tầng, nút ghi gác đúng cổng
R7 (`qatd_kythuat`): `chon-toa-nha` **4 mục**, `chon-tang` **7 mục**; toà 2/tầng 1 ⇒ **68 khối, "68 machines placed · 303 awaiting"**; toà 2/tầng 2 ⇒ **45, "45 placed · 326 awaiting"** — khớp DB từng tầng (vòng 1: chỉ tầng 1 toà 1, 326 máy ngoài tầm).
R8 (`qatd_quanly`, có canEdit, **0 canCreate**): `nut-mo-sinh` **0 phần tử DOM**, tab "Add building" **0 phần tử**, chữ "Generate" không tồn tại, `khoi-anh-nen`/`nut-tai-model`/`nut-luu-ban-ghi`/`nut-go-khoi-mat-bang` đều 0 — **ẩn hẳn, không disable**. `nut-luu` **vẫn còn** ⇒ ẩn đúng cổng, không vá quá tay.

## V-06 ★★★ ĐẠT · Hàng rào GIỮ NGUYÊN 5/5 — bản vá không nới phạm vi
| đối chứng âm | kết quả |
|---|---|
| congnhan mở máy QATD-B qua UI | vẫn `ngoaiPhamVi`, 0 canvas, 0 lộ tên |
| 3 lời gọi API ngoài phạm vi (machineDetail, danhSachToaNha, **noiCuaThucThe** — thủ tục MỚI) | 404 NOT_FOUND / `[]` / 404, **0 chuỗi QATD-B rò**; kèm **đối chứng dương cùng phiên**: `noiCuaThucThe` máy trong phạm vi ⇒ 200 `{43,75,235}` |
| kythuat gọi `sinhTuDong` | vẫn **403** (ca dương `xemTruocSinh` 200) |
| `qatd_khongquyen` vào `/twin` | vẫn Access denied |
| phạm vi 7 vai qua `overview` | **7/7 khớp**: 1108 · 371 · 780 · 328 · 1150 · 0 · FORBIDDEN |
Thủ tục mới `noiCuaThucThe` được đo cả hai chiều ngay từ ca đầu ⇒ không thêm bề mặt rò.

## V-07 ★★ ĐẠT · PH-24 ĐÓNG theo hướng — thời gian tải về dưới ngưỡng
`qatd_kythuat` p50 **2.137 ms**, max **2.193 ms**, **6/6 lượt dưới 2.500** (vòng 1: p50 2.615, **48/48 vượt**). Admin **1.087 ms** ≈ mốc QA10 1.182 ms ⇒ sàn khởi động không hồi quy, dù màn nay gọi thêm một lượt `noiCuaThucThe`. H2 `__soCanvas`=1 sau remount đổi tầng (RB-4 giữ). H3 header Studio **28,00 px** @1280, một hàng, 0 tràn ngang; đối chứng header `/twin` = **48,00 px** đúng bất biến cũ ⇒ chủ đợt chấp nhận 28 px cho Studio (48 px là bất biến của `/twin`, không phải của Studio).

## V-08 ★★ SAI (CAO — MẤT DỮ LIỆU) · H1: đổi tầng ở Studio vứt thay đổi chưa lưu, KHÔNG báo
**Hồi quy do CHÍNH bản vá PH-14 sinh ra.** Đo sống: bật Lock một khối ⇒ "1 unsaved changes"; đổi tầng ⇒ đếm về **0**, **0 hộp thoại, 0 toast**, quay lại tầng cũ **không khôi phục**. Nguyên nhân `<XuongThietKe key={tangId}>` (`TwinStudio.tsx`) remount làm rơi buffer. `key` là **cần thiết** (thiếu nó, hàng của tầng cũ còn trong buffer và một lần Lưu sẽ ghi nhầm sang tầng đang chọn — nguy hiểm hơn). Tác giả bản vá tự khai nợ ở `TwinStudio.tsx:371-377`; vòng 2 biến nó từ suy luận thành **phép đo**. **Đang vá.**

## V-09 · SAI (THẤP) · H5: PH-29 auto-fit không chạy ở lượt mount đầu
Mở Studio không chạm gì ⇒ bbox tâm khối **4,74 %** khung nhìn (182×81 / 726×431). Ablation: chỉ **bấm một khối** (không bấm Fit) ⇒ **19,72 %**; bấm Fit sau ⇒ **y hệt 19,72 %** ⇒ auto-fit chỉ chạy ở lần `bboxMay` đổi tiếp theo, không chạy ở mount đầu vì `refCanh.current` còn null (đúng ngoại lệ ghi ở `ThanhCongCuCanh.tsx:169-172`). **Đang vá.**

# ══════ VÒNG 3 — ĐO SỐNG H1 + H5 (2026-09-15 16:17) ══════
Bản dựng `.qa-tapdoan/dist-sauva2` bundle `index-CF-6v5eP.js` (md5 903 dòng), ký hiệu H1 có trong bundle (`nut-luu-roi-doi`/`nut-bo-thay-doi`/`nut-huy-doi` mỗi cái 1 tệp). **12/12 ô ĐẠT · 0 SAI · 0 HỎNG · 0 ô không phán quyết.** Thô `.qa-tapdoan/tho/V3/`, ảnh `V3-*.png` (17), bảng `BANG-V3.md`.

## V-10 ★★★ ĐẠT · H1 ĐÓNG — và ca nguy hiểm nhất SẠCH
| ca | kết quả |
|---|---|
| L1 đổi tầng khi còn thay đổi chưa lưu | hộp thoại hiện đủ 3 nút, đếm **chưa** về 0, tầng **chưa** đổi (vòng 2: mất im lặng) |
| L2 "Ở lại tầng này" | tầng giữ, thay đổi **còn nguyên** |
| L3 "Bỏ thay đổi" | đổi tầng, DB xác nhận hàng **không** bị ghi (`daKhoa` vẫn false, `updatedAt` không đổi) |
| **L4 "Lưu rồi chuyển"** ★ | **ghi vào ĐÚNG TẦNG CŨ**: máy 5387 `tangId=166` giữ nguyên trong khi giao diện đã sang tầng 165; `luuHangLoat` → 200 `{daGhi:1,daCapNhat:1}`; đếm 2420/2338 **không đổi** (cập nhật, không chèn); vị trí không đổi |
| L5 đổi **toà** và đổi **nhà máy** | cả hai cũng qua cổng, ô chưa đổi ⇒ gác cả ba lối, không chỉ ô tầng |
| L6 không có thay đổi | đổi mượt, **0 hộp thoại** |
Đây là ca quyết định: nếu bản vá ghi nhầm sang tầng mới thì nó nguy hiểm hơn lỗi nó vá. Bằng chứng DB cho thấy nó ghi đúng tầng cũ.

## V-11 ★★ ĐẠT · H5 ĐÓNG — auto-fit chạy ngay ở mount đầu
bbox tâm khối / khung nhìn: **4,74 % → 19,72 %** (337×183 trên 726×431), đúng bằng mức sau-Fit của vòng 2, cùng viewport/canvas/tầng/số máy. Đối chứng L8: bấm Fit sau đó lệch **0 px** ⇒ nút Fit thành no-op vì đã fit sẵn. Đối chứng L9: người dùng tự xoay camera trước khi cảnh dựng xong ⇒ auto-fit **không cướp** (khung người dùng 1,37 %, khác hẳn khung fit), bấm Fit mới về 19,71 %.

## V-12 · ĐẠT · Hồi quy quanh vùng vá
L10 `qatd_quanly` (0 canCreate) vẫn **không** thấy nút sinh/tạo toà (đối chứng dương `nut-luu`=1) · L11 `__soCanvas`=1 sau đổi tầng (RB-4 giữ) · L12 năm khoá i18n mới render đúng ở **en/vi/zh**, 0 khoá thô, 0 dấu tiếng Việt lọt vào en/zh.
★ Agent tự chứng minh thiết bị đo không mù: **mỗi bộ dò đều có ca KÊU và ca IM trong chính lượt đo** (hộp thoại L1 vs L6 · ghi DB L4 vs L3 · bbox 19,72 % vs 1,37 % · DOM quyền 0 vs 1 · dấu Việt vi true vs en/zh false).
Hàng tạm: `daKhoa` 0 → 1 → **0**, dọn bằng **đường sản phẩm** (`luuHangLoat` với giá trị gốc đã chụp trước), 2.420/2.338 không đổi. Vết duy nhất còn lại: `updatedAt` của đúng một hàng mang giờ lượt đo.

## V-13 · CỔNG NỀN CUỐI (sau cả 6 khuyết tật)
`npm run check` **0 lỗi** · `i18n:check` **0/0/0/0** · `vitest twin3d` **113 tệp / 2.639 xanh** (nền đầu đợt 109/2.539 — tăng 4 tệp, 100 ca lưới mới) · `vitest phamVi` **17 / 441 xanh** · `vitest commandCenter` **5 / 91 xanh**.

## V-14 · CÒN MỞ sau đợt vá (agent tự khai, chưa đo)
1. **Đổi TAB trong Studio vẫn vứt buffer im lặng** — Radix Tabs unmount nội dung tab không hoạt động; cùng lớp H1, khác lối vào. Brief giới hạn ở đổi tầng nên không mở rộng.
2. Một lượt refetch nền làm tầng đang chọn biến mất khỏi danh sách ⇒ rơi về tầng đầu **không qua cổng** ⇒ vẫn mất im lặng. Hiếm nhưng có thật.
3. Nhánh **ghi HỎNG** của "Lưu rồi chuyển" (server từ chối ⇒ giữ hộp thoại, giữ tầng) chưa đo sống.
4. Buffer nhiều hàng và thay đổi kiểu kéo-dời chưa đo (mọi ca L1-L6 dùng đúng một thay đổi loại lật khoá).
5. Dung sai 1 mm của H5 là **lập luận**, chưa đo drift thật của `OrbitControls` ở vài khung đầu.
6. `chonNoiTheoDatCho` chọn toà giữ **đa số** ⇒ chuyền trải hai toà sẽ có toà không vẽ; chưa biết ca đó có tồn tại không.
7. PH-37 schema drift `workshops.tangId` (có trong DB, vắng trong schema Drizzle) chưa xử lý.

# ══════ VÒNG 4 — NGHIỆM THU SAU KẾ HOẠCH HOÀN THIỆN (2026-09-16 00:20) ══════
Bản dựng `.qa-tapdoan/dist-hoanthien` bundle `index-r3rg0upv.js` từ HEAD `0f3abd7e`, GPU thật (RTX 5090 qua ANGLE/D3D11), 1 worker. **27 ô · ĐẠT 15 · CHẶN-ĐÚNG 6 · SAI 5 · HỎNG 1 · 0 ô không phán quyết.** Thô `.qa-tapdoan/tho/CUOI/` (40 tệp), ảnh `CUOI-*.png` (44), bảng `BANG-CUOI.md`.

## V-15 ★★★ ĐẠT · 7/8 bản vá đóng trực tiếp trên màn sống, 1 phải dựng ca mới
| bản vá | phán quyết | số quyết định |
|---|---|---|
| Rút tiền tố mã máy | ĐẠT | 1 khối "Prefix: QATD-C-", **5/5 đuôi khác nhau**, `data-ma` giữ mã đầy đủ |
| Danh tính dòng cảnh báo | ĐẠT | **15/15 dòng** mang mã máy + tên nhà máy, đọc được bằng chữ |
| Mẫu số KPI theo tầng | ĐẠT | tầng rỗng ⇒ mẫu số **0**, "— machines"; tầng đối chứng ⇒ **45** |
| KPI không che banner | ĐẠT | giao nhau **0 px²** cả khi mở lẫn khi thu; `chua-cho-dai`=51 = đúng chiều cao dải |
| Ghi chú cảnh báo | ĐẠT | `andon_notes` 0→1, hàng `andon_events` **không đổi từng cột** |
| Bảng sức khoẻ | ĐẠT (sau phân xử) | xem V-16 |
| Báo sự cố | ĐẠT (qua ablation) | xem V-17 |
| Banner cắt tầng | ĐẠT (ca dựng tay) | mọi toà chỉ 7 tầng nên **không ca tự nhiên nào** chạm trần 50; dựng toà 84 tầng tạm ⇒ banner nêu **84 / 50 / 34**, xoá hàng tạm sau đo |

## V-16 · PHÂN XỬ · Bảng sức khoẻ 371 vs bộ đếm vòng 38 — KHÁC NHAU THEO THIẾT KẾ
Ca đầu chấm SAI vì kỳ vọng hai số bằng nhau. Đo lại: bảng đếm theo **nhà máy** (371), `__demVien` đếm **vòng vẽ trên cảnh** (38). Tính lại từ `sucKhoeMay` cho cả hai ⇒ **cả hai đều đúng số**. Bằng nhau là **không thể theo thiết kế** (`TwinVanHanh.tsx:1338-1343`). ⇒ ĐẠT. Bài học: kỳ vọng của thước sai, không phải sản phẩm sai.

## V-17 · LỖI CẤU HÌNH CỦA CHỦ ĐỢT · không tài khoản QA nào có quyền tạo cảnh báo
Nút báo sự cố = 0 ở mọi vai vì **bộ sinh tài khoản của tôi** cấp `andon` chỉ V+E, thiếu C — trong khi khuôn quyền mặc định của vai vận hành **có** C. Ablation mở đúng cờ đó ⇒ nút hiện, bấm gửi thật ⇒ `andon_events` 62→63 đúng máy, đúng người, đúng phạm vi; đóng lại ⇒ 62. **Mã đúng cả hai chiều; lưới sai ở tài khoản.** Đã sửa bộ sinh (xem commit).

## V-18 ★★★ ĐẠT · Hàng rào giữ 6/6, lỗ andon ĐÓNG trên cả bốn đường
`andon.raise` và `quickReport` nhắm máy ngoài phạm vi qua **cả bốn trục** (`machineId` · `machineCode` · `stationId` · `lineId`) ⇒ **NOT_FOUND**, `andon_events` 62→**62**; đối chứng dương trong phạm vi **vẫn ghi được**. Ghi chú chặn cả hai chiều. `factory.list` nay **403** với vai 0 quyền (trước trả 1 nhà máy). Quản đốc không thấy nút sinh lẫn nút tạo toà, mỗi nút có đối chứng dương riêng. Sinh tự động vẫn 403.

## V-19 ★★ ĐẠT · Hiệu năng cải thiện qua ba mốc
p50 **2.045 ms**, p90 2.079, **1/12 lượt vượt 2.500 ms**. Chuỗi: vòng 1 **2.615** (48/48 vượt) → vòng 2 **2.137** → nay **2.045**; tỉ lệ vượt ngưỡng **100 % → 8,3 %**. Vẫn trên mốc quản trị 1.087 ms — phần dư là cây phân cấp, thuộc Task 18. Ngân sách vẽ còn rất rộng: 1 canvas mọi màn, lệnh vẽ tối đa **6/150**, tam giác **15.026/500.000**, nhãn **11/30**.

## V-20 ★★ SỐ THẬT cho hằng bố cục — và nó KHÔNG phải một hằng
Đo `getBoundingClientRect().height` của `khoi-tong-quan`: **85,00 px @1280×720** và **68,00 px @1600×900**. Hằng trong lưới ghi **41**; ước chưa đo của agent là 69 — **đúng ở 1600, sai ở 1280** vì hàng số xuống hai dòng khi hẹp. `bang-suc-khoe` = 25 px ở cả hai. Ba hằng khác (`CAO_NGOAI_PANEL` 231, `TRAN_DAI_PX` 328, `HANG_MAY` 24) đo lại **vẫn đúng**.
Hai lỗ của mô hình: (a) **không có hằng cho dòng tiền tố 17 px** mà bản vá rút tiền tố vừa thêm — đó là lý do @1600 hiện **7** hàng chứ không phải 8 như mô hình đoán; (b) dự đoán "tồn đọng 3→2" **không kiểm được** vì cả 55 cảnh báo QATD cùng mốc thời gian, **0 cái quá 24 h**.

## V-21 ★★★ T3 — HAI kết cục cùng lúc, và giả thuyết chủ dự án ĐÚNG
(1) **Lệch đã có sẵn trong cơ sở dữ liệu:** tỉ lệ máy có cảnh báo dự đoán mở, theo hạng sức khoẻ = **53,5 / 49,6 / 49,7 / 55,8 %** — phẳng, và hạng **khoẻ nhất lại cao nhất** ⇒ bộ sinh đặt hai đại lượng **độc lập nhau**. Đúng giả thuyết chủ dự án. Sửa ở bộ sinh, không ở mã sản phẩm.
(2) **Một lỗi mã THẬT, riêng biệt:** `computeFailureRisk` chỉ nhận hàng sức khoẻ **không phải** loại `PREDICTIVE_WS4`, mà dữ liệu có **đúng một điểm mỗi máy** ⇒ nó trả `failureRisk 0 / urgency LOW` cho **mọi** máy. Màn in "**0 %**" cạnh chip "**Health 40 % · critical**". Đây là PH-36 tái hiện trong một khung hình.

## PH-38 (MỚI, TRUNG BÌNH) · Dải cảnh báo: tiêu đề đếm toàn phạm vi, danh sách render một nhà máy
Giám đốc thấy "Alarms (**55**)" phía trên **15** dòng, tất cả đều Công ty A; kỹ thuật thấy "Today (**35**)" trên 15 dòng. **40 dòng biến mất không câu nào nói ra.** Banner hạ cấp chỉ nói về cảnh 3D, không nói về dải. Cùng họ PH-06 nhưng ở chỗ khác.

## PH-39 (MỚI, TRUNG BÌNH) · "Failure risk 0 %" là giá trị mặc định, không phải phép đo
Xem V-21 mục (2). Màn nói "0 %" trong khi thứ nó biết là "chưa đủ dữ liệu" (`rulNote` ghi "cold start"). Nói **0** khi nghĩa là **chưa biết** — cùng lớp lỗi với "Cảnh báo (0)" đã vá ở đợt trước.

## PH-41 (MỚI, THẤP, chưa phân xử) · Bấm cảnh khi đang chọn nhiều không thu về một
`XuongThietKe.tsx:1088` có ý định thay thế lựa chọn nhưng đo được là không. Agent đi vòng qua cây phân cấp. Chưa phân xử được là lỗi sản phẩm hay giới hạn của cú bấm tổng hợp.

## V-22 ★★★ PH-39 ĐÓNG — và lỗi chạm DỮ LIỆU THẬT, không riêng dữ liệu thử
`computeFailureRiskFromInputs` cộng trọng số ở đúng 4 cổng (`mtbf+uptime` · `healthSeries>=5` · `heartbeatSeries>=8` · `tempSeries>=10`). Không cổng nào mở ⇒ `weightSum===0` ⇒ dòng `weightSum > 0 ? … : 0` trả **0**, `urgencyFromRisk(0)` trả LOW, `factors` rỗng. Lối thứ hai: `!db` trả object 0/LOW viết cứng. Hai lối đó KHÔNG phân biệt được với một phép đo ra 0.

★★★ **Cổng "honest null" cũ KHÔNG bắt được** vì nó đòi `uptimeMinutes===0` mà thực tế `uptimeMinutes = 43200`. Đo chỉ-đọc trên CSDL phát triển hiện hành: **42/42 máy** `isActive` có **0** điểm `machine_health_history` trong 14 ngày, 0 cảm biến, 0 nhịp tim, 0 sự cố ⇒ 5/5 máy thử cho `riskMethod: insufficient_data` và `rulNote` ghi đúng chữ **"cold start"**. Tức hệ thống BIẾT là chưa đủ dữ liệu nhưng vẫn in "0 %" — **trước bản vá, lỗi này hiện trên CSDL nền, không riêng bộ dữ liệu QATD.**

Vá: trường `riskMethod` (`measured` | `insufficient_data` | `unavailable`) thêm vào CUỐI `FailureRiskResult`; tầng cockpit null hoá `failureRisk`/`maintenanceUrgency` khi chưa đo được; tầng dịch vụ GIỮ `number` vì 9 chỗ gọi chỉ so ngưỡng nên 0 không sinh cảnh báo giả. Nhánh `catch` của `listRulForecast` trước đây **nuốt lỗi thành `failureRisk: 0`**, nay thành `unavailable`.
Lưới: 6/6 ĐỎ → xanh · 13/13 (suite mới) · 2 ĐỎ → 21/21. Hai đối chứng dương biết kêu, trong đó có ca **"0 ĐO ĐƯỢC vẫn phải in 0 %"**. Ablation 4 lượt, md5 6/6 OK.
★ Thay đổi hợp đồng `/v1`: cockpit nay có thể trả `failureRisk: null` thay vì `0`. Chủ đợt duyệt — số 0 đó là giá trị mặc định, không phải phép đo.
⚠ V-21 mục (1) **VẪN MỞ**: tỉ lệ cảnh báo dự đoán theo hạng sức khoẻ 53,5/49,6/49,7/**55,8 %** vẫn phẳng và ngược chiều. Đó là lỗi bộ sinh, chưa sửa.

## V-23 ★★★ Task 18 ĐẠT — hợp đồng nhận danh sách nhà máy, ablation PHÂN BIỆT
`canhThietKe` nay nhận `{factoryId}` **hoặc** `{factoryIds}` (`.refine` đúng-một-trong-hai). `factoryId: A` và `factoryIds: [A]` cho phản hồi **giống hệt từng byte**; 4 chỗ gọi client không chỗ nào phải đổi.
Ba bất biến hàng rào, mỗi cái một ca: lọc TỪNG mã · IM LẶNG bỏ mã ngoài phạm vi · toàn ngoài ⇒ rỗng và **không rò** mã/tên nhà máy khác.
★★★ Ablation **phân biệt**, không phải ablation "đỏ tất": gỡ dòng lọc `twinCanh.ts:1034` ⇒ **6 đỏ/25 xanh**; gỡ cổng tầng `:1945` ⇒ **1 đỏ/30 xanh**. Hai tập đỏ RỜI NHAU ⇒ từng bất biến được đo riêng. Ba nhà máy fixture cố ý có 2/3/4 máy rời nhau nên phép ĐẾM thành phép NHẬN DẠNG.
Số câu (bộ đếm sản phẩm): 1 nhà máy **18** · 3 nhà máy một lượt **18** · 3 nhà máy qua 3 lượt gọi đường cũ **54**. Bất biến ghim: 3 nhà máy ≤ 1 nhà máy + 1 câu — mọi bản cài đặt "gộp" bằng cách lặp ba lượt vẫn qua hàng rào nhưng vỡ ô này.
Trần: `factoryIds` ≤ 8 (vượt ⇒ BAD_REQUEST, KHÔNG `slice`); `tangIds` 50 → **300** vì 3 nhà máy QATD = 84 tầng > 50 nên không nâng thì tính năng chết ngay lượt dùng đầu. Đường GHI không nâng.
CHƯA ĐO: trần 8 ở chi phí thật · 300 tầng CÓ dữ liệu · chưa có gì trên trình duyệt đi qua `factoryIds` (Task 19 mới nối client).

## V-24 · Bộ sinh dữ liệu tập đoàn còn chạy được sau mọi thay đổi lược đồ
Chạy khô `node .qa-tapdoan/sinh-tap-doan.mjs --kho` ngày 2026-09-16 sau Task 17b/18 và migration 0357: **"Kiểm kế hoạch: ĐẠT"**, 3 công ty · 12 toà · 7 tầng · 1.108 máy, 24/24 loại máy có mặt. Dựng lại được cho Task 19.
⚠ Mã định danh sẽ KHÁC lần trước — mọi harness phải đọc lại từ tệp tóm tắt, không dùng số cũ.

## PH-42 (MỚI, THẤP — do bản vá Đợt 64 phơi ra) · `/factory-command`: bấm nền xoá nhấn sáng nhưng giữ viền và nhãn
`loi/CanhNhaMay.tsx:407-409` nối `onChon` như sau: `setChon((tt) => apClick(tt, id)); if (id != null) onSelect(id);`. Với `id === null`, `chonVatThe.apClick:77` trả `dangChon: null` (xoá nhấn sáng trong cảnh) nhưng trang **không** được báo, nên `selectedId` giữ nguyên. `:275` `mayDangChon` và `:415` `LopNhan dangChon` đều đọc `selectedId` ⇒ **viền chọn và nhãn vẫn chỉ vào máy cũ trong khi nhấn sáng đã tắt**.
★ Lệch này CÓ SẴN TỪ TRƯỚC, không do bản vá sinh ra: `apClick:78` cũng trả `dangChon: null` khi bấm LẠI đúng máy đang chọn, cho ra y hệt triệu chứng. Bản vá Đợt 64 chỉ thêm một nguồn kích hoạt mới (bấm nền).
★ Không vá trong đợt này — có chủ ý. Trang khai `selectMachine = (id: number)` (`FactoryCommandView.tsx:365`) nên truyền `null` lên đòi đổi hợp đồng của trang; và `CanhNhaMay` còn ba người dùng khác (`CanhThietKe`, `CanhVanHanh`, `CanhVanHanh2D`) nên sửa chỗ vẽ dùng chung là thay đổi rộng, nằm ngoài phạm vi twin của đợt. Mức THẤP: tự lành ở cú bấm kế tiếp.
Hai đường vá khi mở lại: (a) cho `onSelect` nhận `number | null` và sửa trang; (b) cho `:275`/`:415` đọc `chon.dangChon` thay vì `selectedId` (hiệu ứng `:239` đã đồng bộ chiều xuống), rẻ hơn nhưng phải đo cả bốn người dùng.

## PH-43 (MỚI, CAO cho PHÉP ĐO) · `dist/BUILD-INFO.txt` khai SAI, không phải khai thiếu — và không khôi phục được
Đo 2026-09-16 07:2x, khi phát hiện cổng 3000 đang phục vụ:
| tệp | mtime | nội dung |
|---|---|---|
| `dist/index.js` | **2026-09-16 06:12:46** | — |
| `dist/BUILD-INFO.txt` | 2026-09-14 09:38:22 | `commit=e780bcab` · `built=2026-09-14 09:38:22` |

Bản dựng được làm lại sáng 16/09 mà tệp lai lịch KHÔNG cập nhật. Đây **nặng hơn** "bản dựng không lai lịch" (G141): lai lịch thiếu thì người đo còn nghi ngờ, **lai lịch sai thì người đo yên tâm mà sai**. Ai đọc tệp này sẽ tin mình đang đo `e780bcab` trong khi thứ đang phục vụ được dựng từ một commit **không ai biết**.

★★★ KHÔNG KHÔI PHỤC ĐƯỢC: không có đường nào suy ra bản 06:12:46 dựng từ commit nào. ⛔ **Cấm "sửa" BUILD-INFO bằng cách đoán** — làm thế biến một lời khai sai thành một lời khai sai TRÔNG NHƯ ĐÃ KIỂM. Hai lối sạch duy nhất: (a) dựng lại từ một commit biết rõ rồi ghi lai lịch thật; (b) xoá tệp để nó IM LẶNG thay vì nói dối. Lối (b) là xoá tệp ⇒ **phải hỏi chủ dự án**, chưa làm.

★ HỆ QUẢ NGƯỢC VỀ SỔ CŨ (phiên `-fe` chỉ ra): phép đo chéo rò tenant ngày 14/09 (`operator1` ⇒ 0 máy · đối chứng ⇒ 41 máy) chạy trên PID 37052 bản `e780bcab`, tiến trình đó đã chết. **Con số ấy không nói gì về bản 06:12 đang phục vụ** và không được mang sang.

Chủ sở hữu cổng 3000: KHÔNG phiên Claude nào. Chuỗi cha `24872 → 10944 cross-env → 13488 cmd → 18012 pnpm → 29564 cmd → 32100 pnpm start → 37528 powershell -noexit → 10216 Code.exe`; con DUY NHẤT của 37528 là 32100, và **0** `claude.exe` trong chuỗi (mọi `claude.exe` sống đều có cha `30108 Code.exe` hoặc `12780 python.exe`). Phiên `-fe` xác nhận độc lập bằng cùng phép đo. ⇒ Đã tắt theo quyết định chủ dự án "3000 để tắt tới khi xong kế hoạch". Xác nhận hai đường: `Get-NetTCPConnection` rỗng **và** HTTP không nối được. 3001/3008/3064/5173 cũng tắt.

## V-25 ★★★ Task 19 ĐẠT kết cục gốc — cảnh tập đoàn vẽ ba nhà máy, ngân sách vẽ dưới trần cả bốn ô
Đo sống cổng 3064, `/twin?pv=tapdoan`, 1280×720, **ANGLE+GPU** (không SwiftShader), hai bản dựng riêng cho trước/sau.
| | TRƯỚC | SAU |
|---|---|---|
| `qatd_giamdoc` (3 nhà máy) | **1 khối**, 45 máy vẽ | **3 khối** (QATD-A/B/C), **1.108 máy** |
| `qatd_quanly` (gán 1 nhà máy) | 1 khối, 45 máy | **1 khối**, 371 máy |
| cặp bao hình chồng | 0 | **0** |
| `banner-ha-cap` | CÓ | **gỡ** (bundle 1→0, khoá i18n 3→0) |
Ngân sách khi đang xoay, 1.108 máy: lệnh vẽ **2**/150 · tam giác **61.248**/500k · nhãn **0**/30 · **40 khung/s**/30. ĐẠT cả bốn, **không nới ngưỡng nào**.
Đối chứng âm N7: `/twin` mặc định một nhà máy **giống hệt** trước/sau ở mọi ô (45 máy, 5 lệnh vẽ, 9.998 tam giác, 12 hàng, 0 lỗi).
★ Phân nhóm theo **dải mã máy của bộ sinh**, không theo khe hở trên màn — gom-theo-khe-hở cho "2 cụm" vì phối cảnh nén, đã bỏ làm thước chính.
★ Panel trái KHÔNG tệ thêm: cao hàng cảnh báo 39,00 px trước = 39,00 px sau. Tương tác chủ đợt cảnh báo **không xảy ra** — 55 dòng danh tính đã tra được từ trước.
★ Chủ đợt siết ca W4 (`hopNhatCanhNoiVaoTrang:152`) thay vì nới: lệnh cấm `gocToaTheoTang(…, null)` viết theo HÌNH DẠNG MÃ nên bắt cả ca hợp lệ. Thu hẹp về đúng nhánh một-toà, cộng hai khẳng định DƯƠNG cho nhánh khuôn viên (toà đã dời về `(0,0)`; sàn lấy kích thước từ khuôn viên). Đối chứng: đổi sàn về `tangDau` ⇒ ca ĐỎ ⇒ hoàn nguyên sạch.

## PH-44 (MỚI, CAO) · Cảnh tập đoàn ĐÚNG nhưng KHÔNG ĐỌC ĐƯỢC ở khung mặc định
Ngân sách vẽ đạt **không** chứng minh người dùng thấy gì. Khuôn viên QATD rộng **2,25 km** (bước cụm 1 km do bộ sinh nướng vào `twin_toa_nha`), chiếu xuống 968 px ⇒ mỗi khối máy rộng **~0,2 px**. Ảnh `anh/t19-sau/qatd_giamdoc-2-canvas.png` gần như **đen hoàn toàn** — chủ đợt đã tự xem và xác nhận: panel khai `Machines 1108` / `Alarms (55)` trong khi vùng cảnh trống trơn.
**Không phải giới hạn chụp WebGL**: ảnh cùng khuôn của bản TRƯỚC hiện rõ 45 máy. Cuộn vào 16 nấc thì khối rộng 2,5 px (trung vị) / 19,4 px (lớn nhất) và cảnh **hiện ra** (`anh/t19-nhin-sau/2-cuon-16.png`) ⇒ dữ liệu đúng, **khung hình mặc định sai tỉ lệ**.
★ Tự-khớp-khung KHÔNG cứu được: khuôn viên 2,25 km trên 968 px là **2,3 m/px**, mà một máy rộng ~2 m ⇒ ~1 px dù khung ôm vừa khít. Đây là vấn đề **tỉ lệ**, không phải vấn đề khung.
Thiết kế §5.3/§7.2 đã cảnh báo trước (D-3: *"1:1 là 99,99 % khoảng trống"*). Kế hoạch ghi rõ **vượt là lý do quay lại thiết kế, không phải lý do nới ngưỡng** ⇒ KHÔNG tự nới, KHÔNG tự thiết kế lại. **CHỜ CHỦ DỰ ÁN CHỐT HƯỚNG**: (a) LOD cấp tập đoàn — vẽ khối nhà máy thay vì 1.108 máy rời, hiện máy khi cuộn gần; (b) bố cục nén — xếp lại khoảng cách giữa các nhà máy thay vì dùng toạ độ thật.
⚠ Một phần là tật của DỮ LIỆU THỬ (bộ sinh đặt các công ty cách nhau 1 km), nhưng §5.3 cảnh báo cho dữ liệu THẬT nên không được coi là chỉ do bộ sinh.

## PH-45 (MỚI, TRUNG BÌNH) · Ba truy vấn trạng thái vẫn chỉ nhận một nhà máy
`useTrangThaiSong` có 3/4 truy vấn nhận đúng một `factoryId`, nên ở phạm vi tập đoàn **737 máy được vẽ đúng chỗ mà không có lời khai trạng thái** ⇒ màu "chưa rõ". Không nói ra thì 737 khối xám bị đọc là 737 máy hỏng. Đã có `banner-trang-thai-mot-nha-may` nói ra, nhưng đó là khai hạn chế chứ chưa vá. Nợ có tên: gộp bốn truy vấn trạng thái theo `factoryIds`.
★ Bản vá Task 19 tự sinh ra một lời khai sai và đã tự vá trong cùng lượt: `traDanhTinhCanhBao` gán `nhaMayHienTai.name` cho MỌI máy (đúng khi cảnh nạp một nhà máy, **sai** từ lượt này). Nay tra qua `nhaMayCuaMay` (máy→trạm→chuyền→xưởng→nhà máy); máy không tra được thì **không ghi**, không bịa tên.

## V-26 ★★★ Task 20 ĐẠT — sa bàn quy hoạch, và CHỦ ĐỢT ĐÃ TỰ XEM BẰNG MẮT
Chủ dự án chốt: *"không nhất thiết phải vẽ đúng tỉ lệ kích thước của từng toà nhà, chỉ cần hiển thị dạng biểu tượng 3D, và hiển thị giống kiểu sa bàn quy hoạch với mật độ và kích thước nhẹ phù hợp"*. ⇒ Đổi **ĐƠN VỊ VẼ**: 1.108 khối máy → **12 biểu tượng toà nhà** trên một bệ sa bàn.
| | TRƯỚC (`dist-t19`) | SAU (`dist-t20`) | trần |
|---|---|---|---|
| biểu tượng toà | **0** (canvas ĐEN) | **12** (3 cụm × 4) | — |
| rộng trên màn | – | **46,8-64,0 px** | ≥ 24 ✅ |
| toà chồng toà khác công ty | – | **0** | 0 ✅ |
| lệnh vẽ / tam giác | 2 / 61.248 | **4 / 182** | <150 / <500k ✅ |
| nhãn / khung-s | 0 / 50 | 15 (**9 đọc được**) / 44-49 | <30 / ≥30 ✅ |
Đối chứng âm: `/twin` một nhà máy **giống BYTE** bản chuẩn Task 19 (45 máy · 5 lệnh vẽ · 9.998 tam giác · 1 nhãn · 12 hàng · 0 lỗi). Ablation gỡ 1 dòng ⇒ 2 đỏ + 6 lỗi tsc; hoàn nguyên `md5sum -c` 11/11.
★ Lời khai đi theo bản vá: `banner-vi-tri-tam-sinh` trước chỉ bật khi **đo được** là bao hình chồng nhau; nay vị trí cấp tập đoàn **LUÔN** là sơ đồ nên banner bật theo `laSoDo` và nêu hai con số thật ("khuôn viên thật 2.240 m → sa bàn 673 m"). Khoá `viTriTamSinh` GỠ khỏi cả ba locale.

★★★ **CHỦ ĐỢT TỰ XEM `anh/t20-sau/qatd_giamdoc-2-canvas.png` (khung MẶC ĐỊNH, không thu panel)** và xác nhận: bệ sa bàn hình thoi hiện rõ, cụm "Công ty B" đọc được cả bốn nhãn "Toà 1-4", "Công ty C" đọc được. **Đây là kết luận từ PIXEL, không phải từ toạ độ chiếu** — Task 19 từng khai "3 khối" từ toạ độ chiếu trong khi ảnh vẫn đen, nên lần này bằng chứng phải là con mắt.

## PH-46 (MỚI, TRUNG BÌNH) · Thẻ Metrics che khuất một cụm ở khung mặc định
Chủ đợt đo bằng mắt trên đúng ảnh khung mặc định: thẻ `Metrics` (z-30, góc trên-trái) **phủ trọn cụm QATD-A**, kể cả nhãn "Công ty A". Chỉ **2/3** tên công ty đọc được; agent đếm ra 6/15 nhãn bị ẩn (`__demSaBan.soNhan() = {ve:9, an:6, tong:15}` — đếm ra thay vì khai "15 nhãn đã vẽ", đúng khuôn).
⇒ Yêu cầu nghiệp vụ *"nhìn ra cụm nào thuộc công ty nào"* **chưa đạt ở khung mặc định**; ảnh rõ nhất là ảnh **đã thu panel**, mà người dùng không mặc định thu panel.
★ Tính chất bố cục trang này CÓ TRƯỚC Task 20 và cũng đúng với cảnh một nhà máy — nhưng ở cấp tập đoàn nó phá đúng thứ tính năng tồn tại để làm.

## PH-47 (MỚI, TRUNG BÌNH) · Sa bàn chỉ chiếm ~35 % bề rộng canvas
Hai nguyên nhân đo được: (1) `HE_SO_LUI.tapDoan = 2,4` (`phamViCanh.ts:167`) đẩy camera lùi xa; (2) ba cụm xếp trên lưới **2×2** nên **ô thứ tư bỏ trống**, ăn mất một phần ngân sách pixel. Agent KHÔNG sửa hằng vì `phamViCanh.unit.test.ts:166` ghim nó — và dừng lại hỏi là đúng.
★ **Chủ đợt phân xử: hằng ấy ĐƯỢC PHÉP ĐỔI.** Ô T-2 là ô **chống LỆCH** (nó đo `lui` độc lập từ hình học rồi so với hằng), không phải ô ghim một QUYẾT ĐỊNH về con số 2,4. Đổi hằng thì cập nhật bảng viết tay; phép đo độc lập vẫn còn nguyên sức.

## PH-48 (MỚI, THẤP) · Thẻ KPI đếm một nhà máy trong khi cảnh nói về ba
Ở cấp tập đoàn thẻ `Metrics` vẫn in "371 machines / Công ty A · Toà 1 · Tầng 1" trong khi cảnh vẽ cả ba công ty và `dem-may` = 1.108. Cùng lớp với G1 của PH-38 (hai con số trên một màn tả hai tập khác nhau mà không câu nào nói ra), và chủ dự án đã ra luật cho lớp này: **nói ra, đừng âm thầm thu hẹp**.
★ Agent không sửa vì `nguonKpiTheoTang.unit.test.ts` ghim `may={mayVeTatCa}` ở đúng hai chỗ — dừng lại là đúng. Hệ quả phụ họ tự khai: docblock `TwinVanHanh.tsx:2459` nói `idMayTrongCanh` là "tập mà cảnh thật sự vẽ" nay đã thành **nửa đúng** ở cấp tập đoàn, vì cảnh nhận 1.108 máy nhưng vẽ 12 biểu tượng.

## V-27 ★★★ PH-46 + PH-47 ĐÓNG — và agent BÁC BỎ CHỦ ĐỢT hai lần, bằng số
@1280×720, khung **MẶC ĐỊNH**, **KHÔNG thu panel**, vai `qatd_giamdoc`:
| | TRƯỚC | SAU | trần |
|---|---|---|---|
| tên công ty đọc được | **2/3** ✗ | **3/3** ✓ | 3/3 |
| cột sa bàn nhìn thấy / dải dùng được | 193/488 = **39,5 %** | 432/488 = **88,5 %** | ≥ 60 % |
| bề rộng mỗi biểu tượng | 46,8-64,0 px | **56,5-83,0 px** | ≥ 24 |
| lệnh vẽ · tam giác · khung/s | 4 · 182 · 47 | 4 · 182 · **50** | <150 · <500k · ≥30 |
Thu panel: 35,2 % → **94,2 %**, dải dùng được nở 488→968 px ⇒ **bằng chứng đây KHÔNG phải khoảng bù cố định**. Đối chứng âm: `/twin` một nhà máy **giống BYTE** bản chuẩn (md5 `48af3d35…`).
★★★ **Chủ đợt tự xem `anh/t21-sau/qatd_giamdoc-2-canvas.png`**: đọc được cả "Công ty A", "Công ty B", "Công ty C"; sa bàn nằm gọn dưới thẻ Metrics và lấp gần hết dải dùng được.

### ★★★ AGENT BÁC BỎ CHỦ ĐỢT HAI LẦN — cả hai lần bằng phép đo, và cả hai lần agent ĐÚNG
1. **Tôi CHO PHÉP đổi `HE_SO_LUI.tapDoan`; agent TỪ CHỐI và đưa số.** Sau bản vá, khoảng cách do phép đặt-vào-vùng quyết định chứ không do hằng, nên hằng chỉ còn quyết định góc ngẩng. Quét `lui` = 1,6 / 2,0 / 2,4 / 3,0 / 3,6 ⇒ 84,8 / 88,5 / 88,5 / 88,5 / 88,5 % — **bão hoà từ 2,0**, vì 432 px đã là hết dải (488 − 2×28). Đổi hằng mua **0 %**. Giữ nguyên 2,4, bảng viết tay không đụng.
2. **Chẩn đoán của tôi "ô thứ tư của lưới 2×2 bỏ trống ăn ngân sách pixel" là SAI.** Đo: bao hình trục 45° tỉ lệ thuần với (rộng + sâu) theo **cả hai** chiều màn ⇒ 2×2 cho 1.138 m, hàng 1×3 cho **1.198 m**. Hàng ngang **không rộng hơn** mà lại **cao hơn**. Ô trống của 2×2 chính là thứ làm cảnh **bẹt** hơn — và bẹt hơn là đúng thứ cần khi dải dùng được chỉ cao 172 px.

### Hai phương án bị phép đo bác bỏ TRƯỚC khi vào mã (`_t21-sim.mts`)
- **Khớp theo 8 đỉnh bbox**: bbox cho tỉ lệ 1,86 trong khi 12 biểu tượng thật là 2,91 (bbox lấp ô trống + dựng "tháp 42 m" ở góc không có toà) ⇒ camera làm sa bàn **nhỏ đi còn 168 px**.
- **Ôm vào ô trống lớn nhất (tránh hẳn thẻ Metrics)**: 3 cụm được 428 px nhưng `qatd_quanly` chỉ **233 px** trong khi bản chưa vá đã 430 px ⇒ **vá thành lùi**.

### Sự cố xử đúng luật
Bản đầu tính khung nhìn **ở trang** ⇒ **đỏ 2 ca** của `cuaVaoTwin.unit.test.ts` (Đợt 36 + G110: mọi trang dựng `<CanhVanHanh` phải truyền `khungNhin={khungNhin}`). Agent **KHÔNG đụng hai ca ấy** — bất biến đúng, chỗ đặt phép tính mới sai — và dời toàn bộ vào trong cây Canvas. Kết quả: `TwinVanHanh.tsx` khác **0 byte** so với `9238c8f4` (chủ đợt đã kiểm bằng `git diff --stat`), hai ca xanh lại.

### Hazard bản vá tự sinh — hỏi rồi đo
- **H1** `setState` trong `useFrame` ⇒ vòng lặp khung? Đứng yên 20 s: **0 khung R3F** ở cả hai đường. Đối chứng cho chính bộ đếm: đang xoay = **107 khung** ⇒ nó biết kêu.
- **H2** bản đầu khoá theo bbox **mọi** lớp phủ ⇒ viên "Updated 2 h ago" đổi chữ là dựng lại khung nhìn và **vứt cú xoay tay**. Vá: khoá theo `vungDungCanvas`. Đo lại: phình một lớp phủ giả 60→180 px ⇒ camera đứng yên ±1 px.
- **Còn lại, cố ý**: thu/mở panel *thì* dựng lại khung nhìn (là tính năng), nhưng vứt cú xoay tay trước đó.

⚠ **Một lùi tự khai**: `qatd_quanly` khung mặc định, nhãn toà hiện 3/4 → **2/4** (sa bàn neo thấp hơn nên nhãn toà trên cùng rơi dưới thẻ Metrics). Không thuộc ô nghiệm thu nào, nhưng là lùi.
⚠ Chỉ đo **1280×720** và **2 vai**. Quy tắc neo đáy **không tự tránh được** thẻ nổi ở góc **dưới-trái** nếu mai này có — đã ghi trong docblock.

## V-28 ★★★ V-21 mục (1) ĐÓNG — lời tự thú của bộ sinh ĐÚNG CƠ CHẾ nhưng SAI CHẨN ĐOÁN
Bộ sinh tự ghi trong docblock rằng `predictive_alerts` do máy chủ bơm "theo logic riêng, không nhìn `healthScore`". **Nửa đầu đúng, nửa sau sai** — và nửa sai mới là chỗ đáng giá.

**Máy chủ KHÔNG có logic riêng.** `aiSmartAlertRouter.ts:525` đọc `product_inspections` — **đúng dữ liệu bộ sinh viết**. Chính dòng cảnh báo tự khai: `"Defect spike on machine #6413: 1 NG in last 30min"`. Điều kiện kích hoạt đo được là **"máy có ≥1 NG"**:
| bằng chứng | số |
|---|---|
| máy QATD có ≥1 NG | **575 / 1.108 = 51,9 %** |
| máy có cảnh báo mở tại mốc T3 | **575** — trùng khít |
| 51 máy đang có cảnh báo, bao nhiêu có ≥1 NG | **51/51** |
| `corr(healthScore, tỉ lệ NG)` trên 1.108 máy | **−0,032** ≈ 0 |

★★★ **GỐC RỄ THẬT NẰM TRONG CHÍNH BỘ SINH, sâu hơn lời tự thú một tầng**: `tiLeNg = rnd() * 0.25` dùng mầm `kt:<mã máy>` trong khi `health` dùng mầm `sk:<mã máy>` — **hai mầm rời nhau**. Với `rnd()*0.25`, P(≥1 NG trong 6 lần kiểm) ≈ **50,5 %** ở **mọi** hạng sức khoẻ. Bảng 53,5 / 49,6 / 49,7 / 55,8 % **chính là hằng số đó phản chiếu lại** — không phải lỗi bí ẩn của máy chủ.

### ⚠ HAI ĐÍNH CHÍNH CHO BÁO CÁO QA LẦN 11
1. **Con số 53,5/49,6/49,7/55,8 % là ảo giác của THỜI ĐIỂM ĐO.** Chạy lại đúng truy vấn T3 hôm nay cho **5,4 / 4,5 / 4,3 / 3,5 %**. Lý do: bộ bơm chỉ **nổ một lần** (51 máy, trong 63 giây) rồi tắt. Con số phụ thuộc **máy chủ chạy bao lâu**, không phải thuộc tính của bộ dữ liệu. ⇒ Cùng lớp với PH-38 và PH-41: **thiết bị đo sinh ra phát hiện**, lần thứ ba trong đợt.
2. **`generatePredictions` KHÔNG phải thủ phạm**: nó gom theo `createdAt::date` và cần ≥ 7 ngày, mà QATD chỉ có **1 ngày** ⇒ tạo 0 dòng.

### Vá THƯỢNG NGUỒN, không vá triệu chứng
Lời tự thú nói lối (a) đòi "tắt đường bơm của máy chủ" — **sai**, không cần tắt gì. Bộ bơm là **hàm trung thực** của dữ liệu bộ sinh viết, nên vá `tiLeNg` là đủ và nó nằm gọn trong `.qa-tapdoan/`.
★ Agent **từ chối** ghi thẳng `predictive_alerts` dù được phép: làm thế sẽ dựng cảnh báo "defect spike" trên máy có **0 NG** — chế ra một mâu thuẫn MỚI để che mâu thuẫn cũ.
Hàm mới `tiLeNgTheoSucKhoe(health, jitter)` giữ **nguyên** tỉ lệ NG trung bình cũ và vẫn đúng **một** lần rút `rnd()` ⇒ 6 lần rút sau **không lệch** ⇒ so trước/sau là so **có đối chứng**.

### Phép đo tự kiểm trước khi được phép nói
`_v21-sim.mjs` **nhập `tiLeNgTheoSucKhoe` từ chính bộ sinh** (đo mã thật, không đo bản sao), và bước 1 của nó là **kiểm thiết bị đo**: chạy lại công thức **CŨ** phải khớp CSDL ⇒ **lệch 0/1.108 máy**; lệch > 0 thì `exit 1` và không in bảng nào.
| hạng | TRƯỚC coNG / tỉ lệ | SAU coNG / tỉ lệ |
|---|---|---|
| xấu (<55), n=279 | 153 / **54,8 %** | 228 / **81,7 %** |
| 55-69, n=277 | 142 / 51,3 % | 167 / 60,3 % |
| 70-84, n=284 | 136 / 47,9 % | 118 / 41,5 % |
| tốt (≥85), n=268 | 144 / **53,7 %** | 43 / **16,0 %** |
| | đơn điệu **KHÔNG** · 1,02× | đơn điệu **CÓ** · **5,09×** |
Tiêu chí (đơn điệu giảm + xấu/tốt ≥ 2×) **ĐẠT**. Hình dạng giữ nguyên: tổng NG 831→832 (0,1 %), số dòng kiểm không đổi. `--kho` vẫn `Kiem ke hoach: DAT`, khối kế hoạch `diff` **rỗng**.

⚠ **CHƯA CÓ HIỆU LỰC TRÊN DỮ LIỆU ĐANG CHẠY** — bản vá chỉ tác dụng ở lượt `--go` + `--ghi` kế tiếp. Bảng "SAU" là **mô phỏng tất định đã tự kiểm**, không phải đo trên CSDL sống. Agent cố ý không sinh lại vì một agent khác đang đo sống.
⚠ Chưa truy ra **vì sao bộ bơm chỉ phủ 51/575 máy đủ điều kiện** — không đổi kết luận, nhưng là một lý do nữa để đừng dùng `predictive_alerts` làm thước.

## V-29 ★★★ PH-45 + PH-48 ĐÓNG — và dự đoán của chủ đợt "PH-48 tự đóng theo" bị BÁC BỎ
Gốc chung: `useTrangThaiSong` có 4 truy vấn, **3** nhận đúng **một** `factoryId`. Mở cả ba theo khuôn Task 18.
| vai `qatd_giamdoc` @ `?pv=tapdoan` | TRƯỚC | SAU |
|---|---|---|
| `Metrics` mẫu số | **371/1108** | **1108/1108** |
| nhãn thẻ `Metrics` | `Công ty A · Toà 1 · Tầng 1` | `Công ty A · Công ty B · Công ty C` |
| vòng sức khoẻ panel trái | 124+133+62+52 = **371** | 370+381+185+172 = **1108** |
| `banner-trang-thai-mot-nha-may` | CÓ | **GỠ** (khoá i18n 3→0) |
| API `overview` `[1 nm]` \| `[3 nm]` | `1108\|1108` (**bỏ qua danh sách**) | `371\|1108` |
Chủ đợt **tự xem** `anh/ph45-sau/qatd_giamdoc-canvas.png`: mẫu số 1108, nhãn ba công ty, bốn hạng sức khoẻ cộng đúng 1108, sa bàn vẫn đọc được cả ba tên.

★★★ **PH-48 KHÔNG tự đóng theo — dự đoán của tôi SAI.** Nửa **mẫu số** đóng theo PH-45; nửa **nhãn** thì không, vì `nhanPhamViKpi` dựng từ ba ô chọn (nhà máy·toà·tầng). Vá mẫu số mà giữ nhãn chỉ **đổi chiều nói dối**. Bằng chứng sắc nhất ở vai `qatd_quanly`: mẫu số vốn đã 371/371 ĐẠT từ trước, **nhưng nhãn vẫn sai** ⇒ hai nửa độc lập thật.
Đối chứng âm: `/twin` một nhà máy **giống BYTE** bản chuẩn, cả hai vai.
Ablation **SÁU** lượt, **sáu tập đỏ RỜI NHAU** (1 · 8 · 2 · 1 · 1 · 1), `md5sum -c` OK. Chi phí: `overview` 18→18 câu · `sucKhoeMay` 15→15 · `anToanRobot` phần-theo-nhà-máy 9→9; đối chứng khuôn "gộp bằng vòng lặp" = **27** ⇒ vỡ đúng ô ấy.

### ★★★ BA LẦN PHẢI SỬA CHÍNH THIẾT BỊ ĐO — in cả số cũ lẫn mới, không đổi thước sau khi thấy đỏ
1. **`k.includes("bo")`** chép từ lưới Task 18 ⇒ đỏ vì `ro**bo**t` chứa "bo". Đổi sang tách TỪ theo camelCase, kèm đối chứng dương 7 tên phải kêu / 6 tên không được kêu.
2. **Thước số câu sai ĐƠN VỊ (G9)**: `anToanRobot` 3 nhà máy = 16 câu vs 1 nhà máy = 10 ⇒ thước `≤ 1+1` ĐỎ. Đọc mã: Đợt 50 phát **một `LIMIT 1` mỗi ROBOT**; 10 = 9+1, 16 = 9+7 ⇒ phần **theo nhà máy** là **hằng 9**. Thước mới trừ phần theo-robot rồi hỏi lại, kèm ô chứng minh nó vẫn bắt được khuôn lặp.
3. ★★ **Mẫu số sống `dsMay` trả `-1`** ở cấp tập đoàn — vì Task 20 thay lô khối máy bằng sa bàn nên `LoBatchMay` **không mount**. Chuyển mẫu số sang `sinh-summary.json` (ngoài sản phẩm), đối chiếu chéo `dem-may`. Và **một lượt gọi API là KHÔNG ĐỦ**: bản chưa vá **bỏ qua** `factoryIds` rồi vẫn trả 1108 — **đúng số vì lý do sai**. Phải so **HAI** lượt (`[1 nm]` và `[3 nm]`) mới phân biệt được.

### Một ca đã xanh bị đỏ — do chính agent, xử đúng luật
`nguonKpiTheoTang.unit.test.ts:64` đếm chuỗi `may={mayVeTatCa}` trên mã nguồn **THÔ (không tước chú thích)**; docblock agent vừa viết nhắc nguyên văn cặp ấy ⇒ **2 → 3**, ĐỎ. Agent **không đụng ca cũ**, chỉ viết lại câu chú thích của mình. Bài học: **một phép đếm văn bản coi chú thích là dữ liệu của nó**.

### Một chỗ LỆCH KHUÔN Task 18 — cố ý, ghim riêng
`overview` dùng **"không được khai CẢ HAI"** thay vì `.refine` ĐÚNG-MỘT, vì `input` của nó vốn `.optional()` và `FactoryCommandView.tsx:232` gọi **không mã** với nghĩa *"mọi nhà máy trong phạm vi"*. Ép đúng-một là đổi hành vi một màn khác. Nửa nguy hiểm (*"mọi nhà máy"* trượt thành *"mọi nhà máy CÓ THẬT"*) có ô riêng: vắng cả hai vẫn phải lọc phạm vi, và người 0 gán vẫn rỗng. `anToanRobot`/`sucKhoeMay` thì ĐÚNG khuôn.

⚠ `Offline = 1108` trong ảnh: mọi máy QATD đọc "offline" vì dữ liệu cũ 8 h (`SHADOW`). Trước vá cũng vậy với 371. **Ngoài phạm vi PH-45/48**; muốn ảnh có máy đang chạy thì phải chạy mô phỏng trước.
⚠ `Machines w/ andon` 15 → 55 nay **trùng** `Alarms (55)`. Đó là **trùng hợp của bộ dữ liệu này** (55 sự kiện trên 55 máy khác nhau), **không phải bất biến** — đừng ghim.

## V-30 ★★★ V-21(1) có hiệu lực THẬT — mô phỏng DỰ ĐOÁN đúng, không phải khớp số
Chủ đợt sinh lại bộ QATD (`--go` rồi `--ghi`) sau khi cả hai agent xong, rồi đo **trực tiếp trên CSDL sống**:
| hạng | soMay | coNG | tỉ lệ % | NG/lượt kiểm % |
|---|---|---|---|---|
| 1 xấu (<55) | 279 | 228 | **81,7** | 23,5 |
| 2 (55-69) | 277 | 167 | 60,3 | 14,7 |
| 3 (70-84) | 284 | 118 | 41,5 | 8,6 |
| 4 tốt (≥85) | 268 | 43 | **16,0** | 3,0 |
| | | | đơn điệu **CÓ** · **5,09×** | |
★★★ **Trùng KHÍT bảng mô phỏng `_v21-sim.mjs` ở cả bốn hạng, cả bốn cỡ mẫu, và cả tỉ số 5,09×.** Mô phỏng ấy được viết **trước khi** dữ liệu tồn tại ⇒ nó **DỰ ĐOÁN**, không phải khớp số. Đây là kiểu bằng chứng mạnh hơn hẳn "chạy xong thấy số đẹp".
Tiêu chí (đơn điệu giảm + xấu/tốt ≥ 2×) **ĐẠT trên dữ liệu sống**. ⚠ Mã định danh QATD nay **đã khác** lần trước — mọi harness phải đọc lại từ `.qa-tapdoan/sinh-summary.json`.

## V-31 ★★★ Ô 2D ĐÓNG — và 2D bị ĐÚNG bệnh PH-44, có TRƯỚC Task 20
**Bước 1, đo trước khi vá:** 2D ở `?pv=tapdoan` vẽ **1.108 vật thể SVG thật**, rộng **0,11-3,95 px** (trung vị **1,32**), 234 cái **dưới 1 px**, **1.108/1.108 dưới 4 px**, **0 nhãn**, mực ảnh 9,7 % ⇒ gần như đen.
★ Đối chứng quyết định hướng: chạy **cùng phép đo** trên `dist-t19` (trước Task 20) ⇒ trung vị **0,65 px**, **924/1.108 dưới 1 px**, cũng đen. ⇒ **Task 20 không gây ra và không chữa**; nó vô tình làm to gấp đôi (sa bàn nén 2.240 m → 673 m). Phép chia dứt điểm: muốn 24 px trên 968 px thì trường nhìn ≤ **81 m**, mà khuôn viên là **673 m** — thiếu **8,3 lần**, không khung nhìn nào bù được.

**Vì sao chọn (a) bê sa bàn sang 2D, không chọn (b) hay (c):** `TwinVanHanh.tsx:2699` `che2D = epChe2D || webglHong`, và nút chuyển `disabled={webglHong}` ⇒ **2D là đường dự phòng khi WebGL hỏng, lúc đó người dùng KHÔNG rời khỏi nó được**. (c) chặn 2D ở cấp tập đoàn là chặn chính cái phao. (b) giữ máy + thêm lời khai chỉ đổi một ô đen thành **một ô đen có chú thích** (0/1.108 vật thể ≥ 4 px).

★★★ **LỜI KHAI SAI THỨ NĂM ĐÃ SỐNG SẴN — agent tìm ra, không tạo ra**: ở chế độ 2D, `banner-vi-tri-tam-sinh` nói *"each building is an icon, and 12 buildings… grouped into clusters"* trong khi màn vẽ **1.108 máy và 0 biểu tượng**, còn `aria-label` cạnh đó nói *"1108 machines"*. Hướng (a) làm câu banner thành **THẬT ở cả hai chế độ**, thay vì phải viết câu thứ năm chống chế cho câu thứ tư.

| | trước | sau |
|---|---|---|
| 2D đơn vị vẽ | 1.108 máy | **12 biểu tượng toà, 0 máy** |
| rộng px | 0,11-3,95 (p50 1,32) | **89,9** |
| nhãn | **0** | 15 (3 tên công ty + 12 tên toà) |
| quan hệ | — | 3 cụm × 4 toà, **0 sai** so `sinh-summary.toas[].factoryId` |
| nút SVG | 1.113 | 36 |
8/8 ô ĐẠT; 3D tập đoàn **không đổi** (trước = sau). Đối chứng âm `/twin` một nhà máy ở **cả hai** chế độ: 3D **giống BYTE**; 2D khác đúng một thuộc tính khai báo mới. Ablation **hai chiều**: gỡ 2 dòng nối ở trang ⇒ đúng 2 ca khớp-nối đỏ, 13 ca hành vi vẫn xanh; ép `veSaBan=false` trong component ⇒ 12/13 ca hành vi đỏ, 2 ca khớp-nối vẫn xanh.
Chủ đợt **tự xem** `anh/b2-sau/qatd_giamdoc-2d-toan-man.png`: đọc được "Công ty A/B/C" với các ô "Toà 1-4".

★ Agent sửa thiết bị đo **hai lần, in cả hai số**: (i) kịch bản bấm mở dải hợp nhất lần hai ⇒ **đóng** nó ⇒ khai "0 banner"; số đúng là 2. (ii) đo nhãn **khi dải ĐANG MỞ** ⇒ khai **1/3** tên công ty đọc được — nhưng dải mở là **một lớp phủ do chính thiết bị đo bật lên**, không phải khung mặc định; số đúng là **3/3**. Cùng lớp với PH-38 và PH-41: **phép đo tự sinh ra phát hiện**, lần thứ tư trong đợt.

## PH-49 (MỚI, CAO cho PHÉP ĐO) · `--go` xoá gán tài khoản, `--ghi` không tạo lại, và KHÔNG MỘT DÒNG NÀO NÓI RA
★★★ **Chủ đợt đã sập bẫy này 2026-09-16.** Sau khi chạy `--go` rồi `--ghi` để bản vá V-21 có hiệu lực, cả **7** tài khoản `qatd_*` còn **0 gán** ⇒ mọi vai thấy `factory.list = 0` và màn hiện *"not assigned to any factory"*. **Nhìn như lỗi phân quyền, thực ra là dữ liệu thiếu.** Một agent phải truy ngược mới tìm ra.
Gốc: `sinh-tap-doan.mjs:868/870` xoá `user_factory_assignments` (theo `factoryCode LIKE`) và `user_corporate_assignments` (theo `corporateCode`) trong `--go`; `--ghi` không dựng lại.
⛔ **KHÔNG chữa bằng `--gan`**: lệnh ấy gán **cả ba công ty cho mọi vai**, tức phá chính phép đo phạm vi mà bộ dữ liệu này tồn tại để phục vụ. Script đúng là `.qa-tapdoan/b1-khoi-phuc-gan.mjs` (idempotent, đọc `tai-khoan.mjs` làm nguồn sự thật).
**Đã vá:** `canhBaoMatGan()` chạy ở cuối `--ghi`, miễn trừ đúng hai tài khoản ĐƯỢC PHÉP 0 gán (`qatd_admin` bypass phạm vi, `qatd_khonggan` là đối chứng 0-gán), và **chỉ ĐO rồi NÓI, không tự sửa** — một bước sửa âm thầm ở cuối lượt ghi là đúng loại im lặng vừa gây ra sự cố. Đối chứng: xoá tạm hàng gán của `qatd_quanly` ⇒ hàm **KÊU** đích danh; hoàn nguyên ⇒ im lặng và số hàng về đúng nguyên trạng.

## V-32 ★★ Tên khả truy cập của cảnh — lời khai của agent ĐÚNG MỘT NỬA, và nửa kia đổi hẳn kết luận
Agent HAI-CHIỀU báo: *"`aria-label` của cảnh 3D là `null` — cảnh 3D không có tên khả truy cập nào"*. Chủ đợt đo lại **trên trình duyệt sống** (`.qa-tapdoan/_probe-aria.mjs`, cổng 3064):
```
tập đoàn 3D    => { ariaTrenCanvas: null, roleTrenCanvas: null,
                    toTienGanNhatCoAria: null, soPhanTuCoAriaTrongMan: 18 }
một nhà máy 3D => { ariaTrenCanvas: null, ... soPhanTuCoAriaTrongMan: 19 }
```
**Nửa đầu ĐÚNG**: `<canvas>` không có tên, và **không tổ tiên nào** của nó có. 18-19 phần tử khác trong màn thì có ⇒ không phải "màn chưa làm a11y" mà là đúng bề mặt chính bị bỏ trống.

★★★ **Nửa sau SAI, và nó đổi hẳn mức độ**: người dùng trình đọc màn hình **vẫn nghe được cảnh**, qua **hai cơ chế khác nhau** tuỳ chế độ:
- **2D** — `CanhVanHanh2D.tsx:178` đặt `aria-label={ariaLabel}` **thẳng** lên `<svg>`.
- **3D** — không đặt được: chuỗi đi vào `NoiDung {...props}` **bên trong cây `<Canvas>`**, mà phần tử R3F không sinh DOM nên nó rơi ở đó. Bù lại, **TRANG** in cùng chuỗi ấy ra một đoạn `sr-only` (`data-testid="tom-tat-canh"`), kèm chú thích nguyên văn *"canvas WebGL vô hình với nó (§9.9)"*.

⇒ Không phải khuyết tật a11y. **Khuyết tật thật là: lối thứ hai KHÔNG CÓ MỘT CA LƯỚI NÀO GIỮ.** Xoá đoạn `sr-only` ấy thì `tsc` xanh, `i18n:check` xanh, 3.022 ca twin3d xanh, và người dùng trình đọc màn hình mất sạch mô tả cảnh mà **không cổng nào kêu**. Đợt này đã đếm được **năm** lời khai sai sống sót nhiều đợt và nhiều nhánh mã chết chỉ vì không ai ghim — đây là chỗ thứ sáu, ghim **trước khi** mất.

**Đã vá:** `tenKhaTruyCapCuaCanh.unit.test.ts` (6 ca) ghim **cả hai** lối, bốn khoá i18n × ba ngôn ngữ, và luật "bốn khoá xuất hiện ĐÚNG MỘT LẦN" (dùng lại một khoá cho hai nhánh là cách im lặng nhất để một chế độ mô tả chế độ kia — đúng lớp lỗi `CanhVanHanh2D:94`). Một ca cố ý đọc mã **THÔ** để giữ luôn câu giải thích: không có nó, người sau đọc đoạn `sr-only` sẽ tưởng là rác và dọn đi, đúng thứ vừa xảy ra với nhánh `machineId === null` ở `XuongThietKe:1088`.
**Đối chứng biết kêu — bốn đột biến, bốn lần đỏ:** gỡ `sr-only` ⇒ 1 đỏ · xoá hẳn đoạn tóm tắt ⇒ **2** đỏ (mất cả ca docblock) · gỡ `aria-label` khỏi `<svg>` 2D ⇒ 1 đỏ · cho nhánh sa-bàn-2D dùng lại khoá của nhánh 3D ⇒ 1 đỏ. `md5sum -c` 2/2 OK sau hoàn nguyên, 6/6 xanh lại.
⚠ Còn mở: prop `ariaLabel` vẫn được chuyền vào cây `<Canvas>` nơi nó **không thể** có tác dụng. Vô hại nhưng là một hợp đồng trông như đang làm việc. Không gỡ trong lượt này vì cơ chế ghim "mọi prop phải được chuyền" của `CanhVanHanhOnDinh` sẽ đỏ theo.

## V-33 ★★★ Nhãn cụm — brief của chủ đợt SAI 5 chỗ, agent sửa cả 5 bằng số
Đo 7 vai, 1280×720, khung mặc định, cả hai chế độ. Chống bẫy đã dính hai lần trước: **không bấm gì trước khi đo 3D**, và cú bấm duy nhất (`nut-che-2d`, vì `epChe2D` là `useState` nội bộ, không ép được qua URL) được kèm **bản đồ lớp phủ trước vs sau** — giống hệt nhau ở cả 7 vai.

| vai | cụm | 3D tên cty | `soNhan()` 3D | 2D tên cty | bị **cái gì** che |
|---|---|---|---|---|---|
| giamdoc | 3 | **3/3** | `{ve:15,an:0}` | **1/3** | `DIV#bang-kpi-noi` liếm mép |
| quanly | 1 | **1/1** | `{ve:3,an:2}` | **0/1** | `SPAN#co-che-giao-so`, che **123 %** |
| kythuat | 2 | **2/2** | `{ve:6,an:4}` | **0/2** | `panel-trai` 90,6 % · `panel-phai` 89,4 % |
| congnhan | 1 | **1/1** | `{ve:3,an:2}` | **0/1** | `SPAN#co-che-giao-so` |
| admin | 5 | **0/5** | `{ve:0,an:0,tong:19}` | 1/5 | canvas 3D **ĐEN HOÀN TOÀN** |

**NĂM ĐÍNH CHÍNH CHO BRIEF CỦA TÔI:**
1. ★★★ **Tiền đề của tôi SAI**: `qatd_quanly` ở **3D KHÔNG hỏng** tên công ty (1/1, agent tự xem ảnh). `{ve:3, an:2}` là **2 nhãn TOÀ** nằm dưới thẻ `Metrics`, không phải tên công ty. Câu *"vai một nhà máy không đọc được tên công ty nào"* **chỉ đúng ở 2D**.
2. **Hai vai tôi không biết cũng hỏng ở 2D**: `kythuat` 0/2 (nặng nhất — hai tên nằm trọn dưới hai panel), `congnhan` 0/1.
3. **`giamdoc` 2D thật ra 1/3**, không phải 3/3 như tôi tưởng.
4. ★★★ **Lời khai sai đang SỐNG ở 3D**: `giamdoc` "Toà 1"/"Toà 3" được `soNhan()` đếm là **"vẽ"** trong khi bị thẻ `Metrics` phủ **65,4 %** và **67,6 %**. Gốc: luật cũ kiểm che trên **ĐIỂM NEO** (đáy nhãn) rồi trượt đáy xuống `che.duoi+6`, nên 18,5 px chữ vẫn nằm **trên** thẻ.
5. ★★★ **`qatd_admin` — hai khuyết tật CÓ TRƯỚC, agent dừng và hỏi**: (a) 3D canvas đen, 19/19 nhãn ẩn mà bộ đếm khai `{ve:0, an:0}`; (b) 2D biểu tượng nhỏ nhất **1,2 px**. Gốc (b): `saBanTapDoan` lấy **ô đơn vị = cạnh lớn nhất TOÀN TẬP**, nên một toà FUYU **3.000 m** ép mọi toà QATD **110 m** còn 1,2 px; khuôn viên thành **30,8 km**.

**Mô phỏng BA hướng trên hình học đã đo, TRƯỚC khi sửa một dòng** (`n3-sim.mjs`): (A) bê lớp né 3D nguyên si ⇒ **kythuat vẫn 0/2** vì `panel-trai`/`panel-phai` **cao suốt khung**, trượt dọc bao nhiêu cũng không thoát; (C) ép vào `vungDungCanvas` ⇒ admin 5/5 nhưng **không cứu nổi chính admin theo tiêu chí cỡ** (1,2 → **0,6 px**) và lấy pixel của bốn vai kia; (D) "một cụm thì tên lên thanh tiêu đề" chỉ phủ 2/4 vai. ⇒ **Chọn B**: gốc chung của cả hai chế độ là **đặt theo một ĐIỂM NEO trong khi thứ người ta đọc là CẢ HỘP CHỮ**.

**Kết cục:** 4 vai QATD, **cả hai chế độ, cả hai thước**: 3/3 · 1/1 · 2/2 · 1/1. Toàn cục 108 nhãn: **hiện-mà-bị-che-một-phần 39 → 4**. Mọi nhãn ẩn đều **đếm ra** (`ve + an === tong` ở mọi vai). Biểu tượng 56,5-236,1 px; quan hệ cụm×toà **0 lệch**. Đối chứng âm `/twin` một nhà máy **giống BYTE** ở **cả hai** chế độ. Ablation "gỡ dây nối hook 2D" **dựng lại và đo sống**: 2D quay về **đúng số TRƯỚC** trong khi **3D giữ số đã vá** ⇒ phân biệt được hai chế độ.
Chủ đợt **tự xem** `anh/n1-v2/qatd_kythuat-2d-toan-man.png`: đọc rõ "Công ty A" và "Công ty B", trước là 0/2.

### ★★★ BA LẦN SỬA THIẾT BỊ ĐO / BẢN VÁ — in cả số cũ lẫn mới
1. **Harness đứng yên trên TẬP RỖNG**: điều kiện "hai lượt đọc cùng khoá" khớp `""` với `""` ⇒ khai `giamdoc` **0 biểu tượng / 15 nhãn ẩn**; số đúng **12 / 15 hiện**. Thêm chốt "khác rỗng + qua 8 s". (G146 lần nữa.)
2. ★★★ **Thước "sạch tâm" chấm ĐẠT trong khi ảnh đọc ra "ng ty A"** — thẻ `Metrics` ăn **24,3 %** bên trái = đúng hai chữ đầu. Agent **KHÔNG đổi thước**, mà **thêm thước "SẠCH TRỌN" và in cả hai** — và theo thước mới thì **bản TRƯỚC cũng tụt** (giamdoc 2D 3/3 → 1/3). Luật sản phẩm nay tách hai câu: *đặt ở đâu* theo hộp chữ sạch hẳn; *khi nào ẩn* vẫn theo tâm.
3. **Hai lỗi do chính bản vá sinh ra, tự bắt**: (a) đo cỡ chữ trong `useEffect` lúc `ref` còn rỗng (drei `<Html>` portal con ở commit sau) ⇒ `co={0,0}` ⇒ trượt thiếu nửa dòng **mà mọi ô lưới vẫn xanh**; (b) ★★★ **hazard tự sinh**: cứu được nhiều nhãn hơn ⇒ va chạm **nhãn-đè-nhãn dính TÊN CÔNG TY tăng 1 → 5 cặp** (nặng nhất 437 px²) — agent thấy **trên ảnh trước khi phép đo thấy**. Vá: đặt **cụm trước, toà sau**, nhãn đã đặt thành vùng cấm ⇒ còn **1 cặp, chỉ ở admin**.

## PH-50 (MỚI, CAO) · Ô đơn vị sa bàn lấy cạnh lớn nhất TOÀN TẬP ⇒ một toà lớn bóp nát cả cảnh
`saBanTapDoan` chọn ô đơn vị bằng **cạnh lớn nhất trong toàn bộ tập toà nhà**. Với `qatd_admin` (thấy cả QATD lẫn `FUYU-F`), một toà FUYU **3.000 m** ép mọi toà QATD **110 m** xuống **1,2 px** và kéo khuôn viên thành **30,8 km** ⇒ 2D còn 1,2 px (trần 24) và **3D đen hoàn toàn**, 19/19 nhãn ẩn mà bộ đếm khai `{ve:0, an:0}`.
★ Chủ dự án đã chốt *"không nhất thiết phải vẽ đúng tỉ lệ kích thước của từng toà nhà"* ⇒ **chuẩn hoá cỡ biểu tượng nằm TRONG quyết định ấy**. Nhưng nó đổi cảnh QATD mà chủ dự án đã nghiệm thu bằng mắt, nên agent **dừng và hỏi** — đúng luật.

## V-34 ★★★ PH-50 ĐÓNG — ô đơn vị thôi `Math.max`, thành TRUNG VỊ; và agent bắt được HAI THƯỚC SAI CỦA CHỦ ĐỢT
**Phạm vi hỏng HẸP hơn brief tưởng — chỉ mình `qatd_admin`.** Tỉ số cạnh lớn/nhỏ: `giamdoc`/`quanly`/`kythuat`/`congnhan` = **1,00** (12/12 toà QATD đo được là 110.000 × 80.000 mm y hệt nhau); `admin` = **78,13** (một toà FUYU **3.000 m**). ⚠ Nhưng đó là tính chất của **bộ dữ liệu QA**, không phải của sản phẩm: bất kỳ vai nào được gán ≥2 nhà máy có toà khác cỡ đều dính.

**Mô phỏng TRƯỚC khi sửa mã, và TỰ KIỂM trước khi phán** (`p50-sim.mjs` phải tái hiện `viewBox` + mọi bề rộng đã đo sống cho **5/5 vai**; đối chứng dương bơm cỡ +11 % làm nó KÊU). Bề rộng biểu tượng nhỏ nhất = **72,3 / R** (R = trần tỉ số) — **không phụ thuộc cỡ tuyệt đối**:
| R | 2D min | 3D (×0,63) | ĐẠT ≥24 cả hai? |
|---|---|---|---|
| 1 (đồng cỡ) | **86,2** | 54,3 | **ĐẠT** |
| 2 | 43,1 | 27,2 | ĐẠT (sát) |
| **3 — lối (b) CHỦ ĐỢT gợi ý** | 28,7 | **18,1** | **KHÔNG** |
| 78 (hôm nay) | 1,2 | 0,8 | KHÔNG |
★ **Lối (b) của tôi bị bác bỏ bằng số**: đạt ở 2D nhưng **hỏng ở 3D**. Trần tối đa còn đạt là **R ≈ 2,25** — giữ 2,25 lần trên 78 lần thật, tức *trông như* đang chở thông tin cỡ trong khi đã bỏ **97 %**. Đó là một lời khai sai kiểu mới.
★ Lối (c) chuẩn hoá theo cụm: trên bộ dữ liệu này **không phân biệt được với (a)** ⇒ không phép đo nào chọn được nó.

★★★ **CHỌN (a) ĐỒNG CỠ, cỡ = TRUNG VỊ của chính tập đang xem — và chữ "trung vị" LÀ CẢ BẢN VÁ**: dãy mà mọi phần tử bằng nhau có trung vị bằng chính phần tử ấy ⇒ **4 vai QATD không đổi một số nào, chứng minh được bằng ĐẠI SỐ chứ không chỉ bằng đo**. Trung bình không có tính chất ấy (trung bình tập admin = 322 m, gấp **2,9 lần** trung vị). Chiều cao **giữ nguyên số thật** — chỉ mặt bằng là ước lệ.

| ô | TRƯỚC | SAU |
|---|---|---|
| admin 2D rộng biểu tượng | **1,2**..90,1 px | **86,2** đều |
| admin 3D | **0 biểu tượng, canvas ĐEN** | **41,1..67,3 px** |
| admin 3D tên cụm sạch trọn | **0/5** | **5/5** |
| admin sa bàn | 28.920 m | **1.060,4 m** |
| 4 vai QATD (mọi ô) | | **GIỐNG HỆT từng số** |
| `/twin` một nhà máy | | md5 `637f81e1…` **GIỐNG BYTE** |
Ablation gỡ đúng hai dòng `trungVi`→`Math.max`, dựng lại, đo sống: admin quay về **chính xác** `calls=2 tri=228 biểuTượng=0`; 4 vai QATD không đổi. `md5sum -c` 3/3.
Chủ đợt **tự xem** `anh/n1-p50final/qatd_admin-3d-canvas.png`: đọc rõ **năm** tên cụm ("Nhà máy ảo (SIM)", "FUYU-F", "Công ty A/B/C").

★ **Bản nháp banner của chính agent nói quá, và bị PHÉP ĐO bắt**: câu nháp kết bằng *"— chỉ chiều cao còn là số thật"*. Đọc sống ở `qatd_giamdoc`: với 4 vai QATD trung vị = **chính cỡ thật** ⇒ mặt bằng của chúng **CŨNG** là số thật ⇒ chữ "chỉ" là lời khai sai. **Suýt là cái thứ sáu.**

### ★★★ HAI THƯỚC CỦA CHỦ ĐỢT BỊ BÁC BỎ — tôi nhận, và sửa thước
1. **`hiện-mà-bị-che-một-phần ≤ 4` là thước SAI DẠNG.** Nó là **số tuyệt đối trên một mẫu số đang đổi**. Sau vá: 4 → **5**, nhưng nhãn HIỆN toàn cục **69 → 89 (+20)** và **tỉ lệ** che-một-phần **5,8 % → 5,6 %** (**tốt lên**). Toàn bộ +1 nằm ở `admin/2D`; 4 vai QATD giữ **1 → 1**. ⇒ **Thước đổi thành TỈ LỆ** (không tăng), cộng ô tuyệt đối **chỉ áp cho 4 vai QATD**.
2. **`fps 47–57` là thước HẸP HƠN NHIỄU CỦA CHÍNH NÓ — lỗi của tôi: biến một quan sát thành một quy cách.** Agent đo **3 lượt mỗi bản**: bản **CHƯA VÁ** cũng rơi ra ngoài (giamdoc **42**, admin **38**); `kythuat` chạy 50→53→**45** trên hình học **byte-identical**. Hai phân bố chồng nhau, và hình học 4 vai không đổi nên fps **không thể** đổi vì bản vá. ⇒ **Trả thước về tiêu chí thiết kế gốc: ≥ 30 fps.**

## PH-50b (MỚI, CAO) · `far` của camera bị ĐÓNG BĂNG ≈ 2.300–2.500 m, không theo `banKinh`
`CanhVanHanh.tsx:962` tưởng `far = Math.max(2000, banKinh*24)`. Đo bằng **hành vi người dùng thật** (cuộn ra xa, `p50-probe-far.mjs`): khoảng cách khởi phát cắt là **MỘT HẰNG SỐ TUYỆT ĐỐI** cho mọi vai — `giamdoc` (sa bàn 673 m) cắt ở nấc 4, `admin sau vá` (1.060 m) cắt ở **nấc 1**, lệch đúng 3 nấc ≈ ×1,52 ≈ tỉ số sa bàn 1,575. Đó là chữ ký của `far` hằng. `quanly` (286 m, `far` thích ứng lẽ ra 6.864 m) **vẫn mất sạch cảnh** — với `far` thích ứng thì điều đó **bất khả**.
Nghi phạm: `far` áp lúc tạo `Canvas` khi `khuonVien` còn `null` (`TwinVanHanh:2899` rơi về `tangDau.rongMm`), rồi prop đổi mà `updateProjectionMatrix` không theo.
★★★ **Đây chính là vì sao admin đen**: sa bàn 28.920 m ⇒ camera 62.890 m ⇒ toàn cảnh ngoài `far`; `frustumCulled={false}` vẫn nộp 2 lệnh vẽ / 228 tam giác nhưng **0 pixel**.
⚠ **Hazard bản vá tự sinh, agent khai trước khi ảnh tố cáo**: sa bàn admin mới 1.060 m đặt camera cách gốc **2.306 m** — *lọt* vào `far` nhưng chỉ dư ~10 %. Khung mặc định ĐẠT (14/14 biểu tượng), nhưng **cuộn ra MỘT nấc là mất 1 toà**; `giamdoc` chịu được 3 nấc. Chưa vá vì `far` nằm ở `CanhVanHanh`/`KhungCanh` dùng chung nhiều màn.

⚠ **md5 ảnh KHÔNG phải thước hồi quy ở màn này**: `giamdoc-3d-canvas` lệch 435/473.352 px giữa trước↔sau, nhưng **hai lượt chụp CỦA CÙNG MỘT BẢN DỰNG lệch 269 px ở cùng vùng**. Lệch nằm trong nhiễu của thiết bị chụp.
