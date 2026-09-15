# QA lần 11 — LÔ D (ngăn xử lý theo vai) + LÔ E (Studio / đường BUILD)

Đo 2026-09-15 08:55→09:22 (+07) trên **cổng 3064** (bản dựng `dist-a147fc35`, bundle `index-DxxtO34H.js`),
DB `aoi_management@127.0.0.1:5434`. Thước: `.qa-tapdoan/do-DE.mjs` · công cụ DB `.qa-tapdoan/db-DE.mjs`
· bao ngoài có `trap EXIT INT TERM` `.qa-tapdoan/do-DE.sh`. Thô: `.qa-tapdoan/tho/DE/*.json`. Ảnh: `.qa-tapdoan/anh/DE-*.png`.
Giao diện hiển thị **tiếng Anh (us English)** ở mọi lượt đo — chữ trích dưới đây là chữ người dùng thật sự đọc được.

**Quyền ĐO ĐƯỢC từ DB** (`db-DE.mjs quyen`, không lấy từ bảng §2 mà đối chiếu với nó):

| vai | role | gán | andon | machine_status | machine_control | settings_factory | analytics_oee | history_view | dashboard_corporate |
|---|---|---|---|---|---|---|---|---|---|
| qatd_kythuat | engineer | QATD-A+B | V,E | V,C,E | V,C,E | V,C,E,D | — | V | — |
| qatd_quanly | supervisor | QATD-A | V,E | V | V,**E** (C=false) | — | V | V | V |
| qatd_congnhan | operator | QATD-C | V,E | V | — | — | — | — | — |
| qatd_giamdoc | supervisor | TĐ QATD | **V** (E=false) | V | — | — | V | V | V |
| qatd_admin | admin | 0 gán | (bypass) | (bypass) | (bypass) | (bypass) | (bypass) | (bypass) | (bypass) |

Ba cổng của §9.2 mà ngăn xử lý đọc: ack = `andon/canEdit` · ẩn tạm = `machine_control/**canCreate**` ·
tạo phiếu = `machine_monitoring→machine_status/canCreate` · gán KTV = cùng module `/canEdit`.

---

## Bảng phán quyết

| # | ca | vai | đề bài | dữ kiện đọc được | kết cục | phán quyết | vì sao (một câu) |
|---|---|---|---|---|---|---|---|
| 1 | D1 | kythuat | nút nào RENDER trong `ngan-xu-ly` trên `/twin/may/4197` | `nut-ack` "Acknowledge" render+**tắt** (opacity .5, pointer-events none) · `nut-an-tam` "Shelve" render+tắt · `nut-tao-phieu` "Create work order" render+**bấm được** · form mở có `chon-ky-thuat-vien` "Unassigned" + `chon-uu-tien` "Level 3" · 4 nút Mở chức năng · lý do tắt đọc được ngay trên: "ALARMS (0) No open alarms." | 4/4 quyền khớp: ack ✓ ẩn tạm ✓ tạo phiếu ✓ gán KTV ✓ | **ĐẠT** | có đủ 4 cổng quyền trong DB và cả 4 nút có mặt; hai nút tắt là vì máy KHÔNG có cảnh báo (trạng thái tạm), không phải vì quyền |
| 2 | D1 | quanly | như trên, máy 4197 | `nut-ack` render+tắt · `nut-an-tam` **KHÔNG render** · `nut-tao-phieu` KHÔNG render · 5 nút Mở chức năng | ack ✓; ẩn tạm/tạo phiếu/gán KTV **ẩn hẳn** | **ĐẠT** | ẩn tạm đòi `machine_control/canCreate` mà vai này chỉ có V+E ⇒ ẩn là ĐÚNG luật ẩn-không-disable ⚠ xem "Lệch bảng kỳ vọng" bên dưới |
| 3 | D1 | congnhan | như trên, máy 4977 (QATD-C) | `nut-ack` render+tắt; 0 nút ghi khác; chỉ 2 nút Mở chức năng ("Full cockpit", "Machine health") | đúng bảng | **ĐẠT** | operator chỉ có `andon/canEdit` ⇒ đúng một nút ghi, và nó bị ẩn hẳn chứ không xám ở ba nút còn lại |
| 4 | D1 | giamdoc | như trên, máy 4197 | **0** nút ghi (`nut-ack` co=0), chỉ 4 nút điều hướng đọc | đúng bảng | **ĐẠT** | `andon` chỉ canView ⇒ ack biến mất hẳn, đúng vai "chỉ xem" |
| 5 | D1 | admin | như trên (đối chứng bypass) | ack+ẩn tạm (tắt vì 0 cảnh báo) + tạo phiếu + gán KTV | đủ mọi nút | **ĐẠT** | admin bypass `requirePermission` ⇒ chứng minh phép đo nhìn thấy nút khi được phép (ca dương của chính thước) |
| 6 | D1 | **cả 5 vai** | có nút "ghi chú" không | `nut-ghi-chu` = **0** ở cả 5 vai, kể cả admin; `nganXuLyLogic.ts:53,142` vẫn khai hành động `ghiChu` với `duocPhep: quyen.ackAlarm` | hành động khai trong luật, **0 mặt UI** | **SAI** | một hành động có luật + có quyền + có test nhưng KHÔNG có chỗ gọi — đúng lớp lỗi "giao logic với 0 chỗ gọi" mà repo tự đặt tên (G16/L-3) |
| 7 | D1 | kythuat | máy 4568 (QATD-B — nhà máy THỨ HAI được gán) mở được không | `may-khong-mo-duoc` `data-ly-do="ngoaiPhamVi"`, chữ: *"Cannot open machine #4568 — This item is not in the scope you are viewing (or no longer exists). Switch factory/floor and open it again."*; 0 nút nào trong ngăn | ngăn xử lý KHÔNG tồn tại cho máy của nhà máy thứ hai | **SAI** | `TwinMay.tsx:285` lấy CỨNG `factories[0]` và màn không đọc `?nm=` ⇒ với vai được gán 2 nhà máy, **toàn bộ mặt xử lý của nhà máy thứ hai không với tới được** (ảnh `DE-D1-kythuat-may4568.png`) |
| 8 | D2 | kythuat | tạo 1 phiếu bảo trì THẬT cho **máy 4568** qua UI | không có `nut-tao-phieu` vì màn dừng ở `ngoaiPhamVi` (ô #7) | không tạo được qua UI | **SAI** | đúng ca brief đòi: đường UI cho máy QATD-B bị chặn ở client, không phải ở quyền |
| 9 | D2 | kythuat | *(ca dương cùng thiết bị)* tạo phiếu qua UI cho máy 4197 | form "Work order title / Priority Level 3 / Assign technician Unassigned / Save / Cancel"; sau Lưu form đóng lại | `maintenance_work_orders` **29 → 30**, hàng id 35 `WO-4197-1789438419698-RG4T` title `QATD-DE-PHIEU-UI-397453` | **ĐẠT** | đường ghi UI SỐNG ⇒ ô #8 không phải "form hỏng", mà đúng là máy 4568 không mở được |
| 10 | D2 | kythuat | đường API cho máy 4568 bằng CHÍNH cookie kythuat | `maintenance.createWorkOrder` HTTP **200**, trả `{id:36, workOrderNumber:"WO-4568-…", machineId:4568, status:"OPEN", trigger:"MANUAL"}` | server CHẤP NHẬN phiếu cho QATD-B | **ĐẠT** | cùng người, cùng quyền, cùng máy: server nói ĐƯỢC còn Twin nói "ngoài phạm vi" ⇒ chốt rằng rào cản ở tầng CLIENT |
| 11 | D3 | congnhan | ablation N-5: andon `raised` dựng tay ⇒ badge nổi ⇒ ack ⇒ xoá ⇒ badge mất | **trước**: `lop-canh-bao` 3 badge, dải "Alarms (20)", ngăn máy 4977 "No open alarms.", ack tắt · **có**: `lop-canh-bao` **4** badge (thêm `▲ QATD-C-T1-X1-L1-M01` = mã máy 4977), dải "Alarms (**21**)" đứng đầu là `QATD-DE-RAISED-M4977`, ngăn: `ngan-canh-bao-261` "Unacknowledged", **ack bấm được** · sau bấm: toast "Alarm acknowledged", mục đổi thành "Acknowledged", ack tắt lại · **sau xoá**: về lại 3 badge / "Alarms (20)" / "No open alarms." | DB trước ack: `status=raised, acknowledgedBy=null, mttaSeconds=null` → sau ack: `status=acknowledged, acknowledgedBy=**26486** (=qatd_congnhan), mttaSeconds=25`; `audit_logs` id 5778 cùng nội dung | **ĐẠT** | ba mốc đổi đúng chiều và chỉ đổi khi hàng dữ liệu đổi; danh tính người ack ghi đúng vai đang đăng nhập (hai đường đọc độc lập: UI và SQL) |
| 12 | D4 | quanly | nhóm "Mở chức năng" phải có `/corporate-dashboard` và `/oee-dashboard` | 5 nút, bấm từng nút và đọc URL: `/device-monitor?machine=4197` · `/device-monitor?tab=health` · `/history?machineId=4197` · `/traceability?machineId=4197` · `/control-plane?machineId=4197` | **0/2 đích mong đợi**; mọi đích đều ở cấp MÁY | **SAI** | `NganXuLy` nhận `loaiDich` mặc định `"machine"` và **không nơi nào trong mã sản phẩm truyền giá trị khác** (grep: chỉ 2 tệp test) ⇒ hai dòng `factory` (`/corporate-dashboard`) và `line` (`/oee-dashboard`) của bảng §9.3 có mã mà **0 chỗ gọi** |
| 13 | D4 | congnhan | KHÔNG được có `/control-plane` | chỉ 2 nút: "Full cockpit" → `/device-monitor?machine=4977`, "Machine health" → `/device-monitor?tab=health` | `/control-plane` vắng mặt | **ĐẠT** | `machine_control` không có trong quyền ⇒ nút bị ẩn TRƯỚC khi người dùng bấm phải (không phải "thấy rồi bị chặn") |
| 14 | D5 | giamdoc | KPI nổi + dải cảnh báo đọc được, **0 nút ghi** | `bang-kpi-noi`: *"Metrics · 371 machines · Corporate · Công ty A · Floor · Running 261 · Down 25 · Maintenance 20 · Offline 7 · Running rate 70.4% · Average OEE — · Machines w/ andon 15 · PdM risk 0 · OEE measured on 0/371 machines"* · `dai-canh-bao`: "Alarms (55) All55 Stop26 Call0 Warning29" + danh sách tiêu đề · `/twin` ngăn phải thu về 0 (`data-ly-do-thu="trong"`), `/twin/may/4197`: 4 nút điều hướng, `nut-ack/an-tam/tao-phieu` đều 0 | KPI + dải đọc được; **0 nút ghi** ở cả hai màn | **ĐẠT** | vai chỉ-xem thấy đủ số để điều hành mà không có một mặt ghi nào; "Average OEE —" là khai THIẾU trung thực, không phải 0 giả |
| 15 | E1 | kythuat | vào `/twin-studio` | `man-twin-studio` = 1, ô Factory "Công ty A", "Building: 4", 3 tab | vào được | **ĐẠT** | có `settings_factory` ⇒ qua `RouteGuard navHref="/twin-studio"` |
| 16 | E1 | quanly | vào `/twin-studio` | `man-twin-studio` = 1, cùng bố cục | vào được | **ĐẠT** | route khai quyền-HOẶC, `machine_control` đủ để vào |
| 17 | E1 | congnhan | kỳ vọng CHẶN | URL vẫn `/twin-studio` nhưng `man-twin-studio`=0 và trang in: *"Access denied — You don't have permission to access this page. Please contact an administrator if you think this is a mistake."* + nút "Back to home" | bị chặn, có câu giải thích | **CHẶN-ĐÚNG** | chặn ở CỬA (RouteGuard) và nói rõ lý do + lối ra, không phải màn trắng |
| 18 | E1 | giamdoc | kỳ vọng CHẶN | y hệt ô #17 | bị chặn | **CHẶN-ĐÚNG** | không có `settings_factory` lẫn `machine_control` ⇒ đúng kỳ vọng bảng §2 |
| 19 | E1 | admin | vào được (bypass) | `man-twin-studio` = 1 | vào được | **ĐẠT** | đối chứng dương cho chính phép đo chặn ở #17/#18 |
| 20 | E2 | kythuat | ô `chon-nha-may` = đúng tập được gán (2) | mở ô, đọc lựa chọn: **["Công ty A", "Công ty B"]** | 2/2 | **ĐẠT** | khớp `user_factory_assignments` (QATD-A + QATD-B) |
| 21 | E2 | quanly | đúng tập được gán (1) | **["Công ty A"]** | 1/1 | **ĐẠT** | khớp gán, không rò công ty B/C |
| 22 | **E3** | kythuat + quanly | thiết kế được **toà 2..4** và **tầng 2..7** không | `dem-toa-nha` = "Building: **4**" (dữ liệu có 4 toà × 7 tầng) · **bộ chọn đang hiện trên màn chỉ có MỘT**: `chon-nha-may` (Factory) — **không có ô chọn Toà, không có ô chọn Tầng** · dải sức khoẻ: *"45 machines placed · **326 awaiting placement**"* · `khu-cho-xep-cho`: "UNPLACED MACHINES (**326**)" liệt kê cả máy của `…-T1-X2-…`, `…-T2-X1-…`, `…-T4-…` · cây phân cấp liệt kê đủ 8 xưởng (T1..T4 × tầng 1-2) nhưng chỉ 45 máy có chỗ · mã nguồn `TwinStudio.tsx:106` `const toaNhaDau = (toaNhaQ.data ?? )[0]` và `:125` `const tang = (chiTietQ.data?.tangs ?? )[0]`, `:256` `tangId={tangDau.tangId}`; 0 lần xuất hiện `setToaNha/setTang/chon-toa/chon-tang` trong tệp | **CHỈ thiết kế được tầng 1 của toà 1**; 45/371 máy (12 %) có mặt, 326/371 (88 %) nằm ngoài tầm với | **SAI** | 45 = đúng số máy của `twin_tang` id 81 (QATD-A toà 1 tầng 1) trong DB ⇒ con số tự nó chỉ ra màn đang khoá cứng ở phần tử `[0]`; đối chứng: màn XEM `/twin` có đủ ba ô "Công ty C ▾ / Toà 1 ▾ / Tầng 1 ▾" (ảnh `DE-D3-co-twin.png`), màn THIẾT KẾ thì không |
| 23 | E4 | kythuat | tab `tab-thiet-ke`: 1 canvas + 4 khối; dựng nhà xưởng xem trước | `window.__soCanvas` = **1**, `canvas` DOM = 1, `__thongKeVe {calls:2,triangles:2,matContext:0}` · `khu-cho-xep-cho` ✓ · `thu-vien-asset` ✓ ("Asset library / Machines / Infrastructure / Warehouse / Upload model…") · `mini-map` ✓ · `bang-thuoc-tinh` ✓ ("Select an object in the tree or in the 3D scene") · xem trước: `so-tang-xem-truoc` = **1**, `so-tuong-xem-truoc` = **4**, tóm tắt "Bounding box 60 × 40 × 12 m / Floor 1 / Generate perimeter walls (200 mm thick) 4" | đủ 4 khối, 1 canvas, xem trước đúng luật `soTuong = soTang × 4` | **ĐẠT** | không bấm `nut-tao` ⇒ `twin_toa_nha` giữ nguyên 13 / `twin_tang` 85 (đếm lại sau khi đo) |
| 24 | E5 | kythuat | vẽ 1 vùng an toàn → lưu → thấy trong danh sách → xoá qua UI | trước: "No safety zones on this floor yet." (0 mục) · vẽ 4 đỉnh: "4 vertices · 664.1 m²" · sau lưu: toast "Safety zone saved", danh sách 1 mục `vung:422` "QATD-DE-VUNG-36088 664.1 m²" · sau bấm `ve-vung-xoa`: 0 mục, câu rỗng quay lại | `twin_vat_the` **341 → 342 (id 422) → 341**; hàng `loai='vung'` còn lại duy nhất là hàng cũ id 49 (tầng 28, tên "ouit") — KHÔNG bị chạm | **ĐẠT** | vòng đời đầy đủ CRUD trên đường ghi thật, và phép xoá đi qua đúng nút UI chứ không qua SQL |
| 25 | E6 | quanly | có gizmo (canEdit) nhưng KHÔNG có nút dựng/sinh (cần canCreate) | gizmo ✓ (`nut-che-do-translate` "Move", `nut-che-do-rotate` "Rotate", `cong-tac-bat-dinh`) · **`nut-mo-sinh` "Generate" CÓ render và KHÔNG tắt** (`tat=0`) · tab "Add building" mở được, đi hết 3 bước tới `buoc-xem-truoc` và **`nut-tao` "Create building" render, KHÔNG tắt** · `huy-hieu-chi-xem` = 0 | 2 đường TẠO hiện nguyên vẹn cho vai 0 quyền tạo | **SAI** | `XuongThietKe` gác mọi công cụ bằng MỘT cờ `coQuyenSua = canEdit(settings_factory ∥ machine_control)` nên `canCreate` không được xét ở đâu cả; server thì gác `sinhTuDong` bằng `adminProcedure` và `dungNhaXuong` bằng `quyenThietKe("canCreate")` ⇒ quanly bấm xong sẽ ăn 403 — đúng lớp "một lối vào rồi TỪ CHỐI" (ảnh `DE-E6-quanly.png`) |
| 26 | E7 | kythuat | gọi `twinCanh.sinhTuDong` ⇒ kỳ vọng FORBIDDEN | `POST twinCanh.sinhTuDong {factoryId:38, tangIds:[83]}` → HTTP **403** `FORBIDDEN` / `appCode "PERMISSION_DENIED"` / `appParams {action:"adminAccess"}` / *"You do not have required permission (10002)"* · **ca dương cùng cookie, cùng input**: `twinCanh.xemTruocSinh` → HTTP **200**, trả kế hoạch 782 chỗ đặt · `auth.me` → 200 `engineer` | chặn đúng ở đường GHI, mở đúng ở đường ĐỌC | **CHẶN-ĐÚNG** | nếu cookie chết thì cả hai cùng 403; ở đây chỉ mutation bị chặn ⇒ cổng `adminProcedure` là thứ đang chặn, không phải phiên hỏng. Đối chứng sau đo: `twin_dat_cho` của tầng 83 = **0** hàng ⇒ không byte nào bị ghi |

**Tổng: 26 ô — ĐẠT 17 · SAI 6 · CHẶN-ĐÚNG 3 · HỎNG 0 · N/A 0.
Ô không có phán quyết: 0.**

---

## Lệch giữa BẢNG KỲ VỌNG §2 và QUYỀN THỰC CÓ (cần chủ đợt quyết)

Bảng §2 ghi `qatd_quanly` **ẩn tạm: có**. Nhưng "ẩn tạm" là `equipmentStandards.shelveMasterAlarm`,
cổng `machine_control/**canCreate**`, trong khi bộ sinh tài khoản cấp cho quanly `machine_control` **V+E**
(canCreate = false, đo bằng SQL). Sản phẩm ẩn nút là ĐÚNG với dữ liệu quyền đang có.
⇒ Hoặc sửa bảng §2 (ẩn tạm cần C, không phải E), hoặc sửa bộ sinh (cấp thêm canCreate) rồi đo lại ô #2.
Không có cách đọc nào khiến đây thành lỗi sản phẩm.

## HÀNG TẠM — đã tạo gì, đã xoá chưa

Tiền tố RIÊNG của lô này: **`QATD-DE-`**. Một lệnh dọn: `sh .qa-tapdoan/do-DE.sh don`.

| bảng | hàng lô này tạo | đếm TRƯỚC (08:50) | đỉnh trong lúc đo | đếm SAU (09:22) | đã xoá? |
|---|---|---|---|---|---|
| `andon_events` | 2 hàng `raised` tạm, title `QATD-DE-RAISED-M4977` (id 260, 261) — cho ablation D3 | 62 (raised 55) | 63 | **62 (raised 55)** | ✅ xoá hết (`andon_tam = 0`) |
| `maintenance_work_orders` | 2 phiếu: id 35 `WO-4197-…` (UI, máy 4197) và id 36 `WO-4568-…` (API, máy 4568) | 29 | 31 | **29** | ✅ xoá cả hai theo tiêu đề `QATD-DE-%` |
| `twin_vat_the` | 1 vùng an toàn id 422 tên `QATD-DE-VUNG-36088`, tầng 81 | 341 | 342 | **341** | ✅ xoá **qua nút UI** `ve-vung-xoa`, lưới SQL cuối tìm 0 hàng sót |
| `audit_logs` | 2 vết kiểm toán của 2 lượt ack (id **5765**, **5778**, `entityName='QATD-DE-RAISED-M4977'`) | 5731 | 5755 | **5755** | ❌ **CÒN**, xem ghi chú |
| `twin_toa_nha` / `twin_tang` / `twin_dat_cho` | **0** (E4/E6 dừng ở màn xem trước, KHÔNG bấm "Create building"; E7 bị 403) | 13 / 85 / 2420 | — | **13 / 85 / 2420** | — không tạo gì |

**Ghi chú `audit_logs`:** lệnh dọn chạy `DELETE … WHERE "entityName" LIKE 'QATD-DE-%'` và nhận
`permission denied for table audit_logs` — vai DB của ứng dụng **không có quyền DELETE** trên bảng kiểm toán
(append-only). Hai hàng còn lại là vết của hai lượt ack thật do `qatd_congnhan` thực hiện; chúng trỏ tới
`andon_events` id 260/261 nay đã bị xoá nên là vết **mồ côi**. Muốn dọn phải dùng vai DB có quyền —
KHÔNG làm trong đợt đo này. Nhận diện: `SELECT * FROM audit_logs WHERE "entityName" LIKE 'QATD-DE-%'`.

**Không chạm:** SIM-FAC (42 máy), T12-SHOT, hàng `twin_vat_the` id 49 (`loai='vung'`, tầng 28, tên "ouit"),
và mọi hàng không mang tiền tố `QATD-DE-`.

## Quan sát kèm theo (không tính vào 26 ô)

1. **Dải cảnh báo rộng hơn cảnh đang xem.** `/twin?nm=38` với giamdoc: cảnh + KPI nói "371 machines ·
   Công ty A", nhưng `dai-canh-bao` in "Alarms (**55**)" = toàn bộ andon `raised` của **cả ba công ty**
   (congnhan thấy 20 = đúng QATD-C, kythuat sẽ là 35 = A+B). Dải bám PHẠM VI TENANT, KPI bám NHÀ MÁY
   ĐANG XEM — hai con số về hai tập khác nhau đứng cạnh nhau trên một màn, không câu nào nói ra điều đó.
2. **`maintenance.createWorkOrder` không để lại vết kiểm toán.** Sau khi tạo 2 phiếu, `audit_logs` có
   0 hàng nào `entityType='maintenance_work_order'` hay `entityName LIKE 'WO-%'`; trong khi
   `andon.acknowledge` ghi vết đầy đủ. Hai hành động ghi cùng một ngăn, hai mức truy vết khác nhau.
3. **`twinCanh.xemTruocSinh` (canView) trả nguyên kế hoạch ghi 782 chỗ.** Với `tangIds:[83]` — một tầng
   KHÔNG có xưởng — nó vẫn dựng kế hoạch dồn **toàn bộ** 782 thực thể của nhà máy xuống tầng đó. Thứ giữ
   dữ liệu an toàn trong ca E7 là cổng `adminProcedure`, **không phải** việc tôi chọn một tầng rỗng
   (giả định an toàn ban đầu của tôi SAI, ghi ra để không ai lặp lại).
4. **Nút tắt nhìn ra được.** `nut-ack`/`nut-an-tam` khi bị chặn có `opacity:0.5` + `pointer-events:none`,
   lý do nằm ngay trên trong cùng nhóm ("ALARMS (0) No open alarms."); nhưng không có `title`/
   `aria-describedby` nối nút với lý do.
