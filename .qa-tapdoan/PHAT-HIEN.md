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
