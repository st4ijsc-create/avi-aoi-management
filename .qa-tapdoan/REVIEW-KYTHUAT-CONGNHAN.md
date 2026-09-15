# REVIEW NGHIỆP VỤ — MÀN 3D TWIN DƯỚI HAI VAI: KỸ THUẬT và CÔNG NHÂN

QA lần 11 · kịch bản tập đoàn (1 tập đoàn → 3 công ty → 12 toà × 7 tầng → 98 line → 1.108 máy · 24 loại máy).
HEAD `a147fc35` · bản dựng `.qa-tapdoan/dist-a147fc35` · server đo 3064.

**Đây là ĐÁNH GIÁ NGHIỆP VỤ, không đo lại.** Mọi con số dẫn từ `.qa-tapdoan/PHAT-HIEN.md` (PH-01..PH-29),
`BANG-AB.md`, `BANG-C.md`, `BANG-DE.md`, `BANG-F.md`, thô `.qa-tapdoan/tho/**`, và **10 ảnh PNG tôi tự Read**
(liệt kê ở §7). Ba thứ tôi thêm vào — và ghi rõ là thêm — gồm:

1. **Suy luận từ mã** (tôi tự đọc tệp, ghi số dòng) — đánh dấu `[suy luận từ mã]`.
2. **Quan sát từ ảnh** (mắt tôi, không phải phép đo) — đánh dấu `[đọc từ ảnh]`.
3. **CHƯA ĐO** — nêu rõ cần phép đo nào.

Không con số nào trong tài liệu này do tôi bịa. Chỗ nào không có số, tôi viết **CHƯA ĐO** kèm phép đo cần làm.

---

## §0. HAI BẢNG XẾP HẠNG (đọc trước)

| vai | tài khoản · phạm vi | xếp hạng | câu một dòng |
|---|---|---|---|
| **KỸ THUẬT** (kỹ sư thiết bị/bảo trì) | `qatd_kythuat` · engineer · QATD-A (371) + QATD-B (409) = **780 máy / 67 line** | **HẠN CHẾ NẶNG** (nghiêng về CHƯA DÙNG ĐƯỢC nếu kỹ sư phụ trách ≥2 nhà máy) | Vòng nghiệp vụ *"tìm máy lỗi → mở máy → ra phiếu"* chạy **trọn vẹn nhưng chỉ trên 85/780 máy (10,9 %)**; với **409/780 máy (52,4 %) của nhà máy thứ hai, màn nói SAI về quyền của chính người dùng** (PH-12, PH-19); đường thiết kế lại bố trí chạm được **12 %** một nhà máy (PH-14). |
| **CÔNG NHÂN** (vận hành máy tại xưởng) | `qatd_congnhan` · operator · QATD-C = **328 máy / 31 line** | **HẠN CHẾ NẶNG** (nghiêng về DÙNG ĐƯỢC VỚI LƯU Ý **nếu chỉ mở cho người làm ở toà 1**) | **Mặt xử lý cảnh báo DÙNG ĐƯỢC thật** — ack chạy đầu-cuối có ablation 3 mốc, ghi đúng danh tính người ack (D3). **Bản đồ 3D — thứ duy nhất biện minh cho màn 3D — chỉ đúng ở toà 1: 71/328 máy (21,6 %)**; 3 toà còn lại cho sàn trống (PH-12). Cộng thêm mã máy bị cắt ở 1280 (PH-27) — độ phân giải màn ở xưởng. |

Hai vai **cùng một gốc lỗi** (`factories[0]` / `toaNha[0]` — PH-12) nhưng **hai hình dạng hậu quả khác nhau**:
kỹ thuật bị **TỪ CHỐI HẲN**, công nhân bị **MẤT BẢN ĐỒ**. Xem §1.2 và §2.2.

---

# §1. VAI KỸ THUẬT — kỹ sư thiết bị / bảo trì

Tài khoản đo: `qatd_kythuat`, role `engineer`, gán **QATD-A + QATD-B**.
Quyền đo được từ DB (`BANG-DE.md`, không lấy từ bảng kỳ vọng): `andon` V,E · `machine_status` V,C,E ·
`machine_control` V,C,E · `settings_factory` V,C,E,D · `history_view` V.
⇒ **Đây là vai DUY NHẤT vừa tạo được phiếu bảo trì vừa vào được Studio** (giám đốc và công nhân bị chặn ở
cửa Studio — CHẶN-ĐÚNG, ô #17/#18 BANG-DE).

## 1.1 Nhiệm vụ nghiệp vụ thật trong một ca (7 việc)

Nguồn: spec `docs/superpowers/specs/2026-09-06-nha-may-3d-digital-twin-design.md` §9.2 (ba nhóm hành động:
**xử lý cảnh báo · tạo việc · mở chức năng**), §12b.3 (bảng "hành động — quyền — đường ghi — hoàn tác"),
§12b.4 (**vì sao KHÔNG có lệnh OT start/stop**, thay bằng "chọn-rồi-nhảy"), và
`client/src/components/twin3d/van-hanh/nganXuLyLogic.ts` (bảng hành động + quyền).
Việc nào tôi suy ra từ nghề (không có trong tài liệu) thì ghi `[suy luận nghiệp vụ]`.

| # | việc | căn cứ |
|---|---|---|
| KT-1 | **Vào ca: quét cả phạm vi phụ trách, tìm máy đang dừng/lỗi** trên cả HAI nhà máy được gán | §9.1 (panel trái: Máy/Chạy/Dừng/Lỗi/Không rõ + dải cảnh báo) · §14.3.1 chip KPI nổi trả lời *"nhà máy chạy tốt hay tệ"* **trước khi** nhìn 3D |
| KT-2 | **Định vị máy lỗi trên sàn** — biết *máy nào, ở đâu*, để cầm đồ nghề đi tới đúng chỗ | §"3D được biện minh cho **ĐỊNH VỊ**, không được biện minh cho ĐIỀU KHIỂN" (dòng 8874 spec); *"bố trí không gian LÀ functionally essential"* |
| KT-3 | **Xem sức khoẻ / nguy cơ hỏng của một máy** (health, PdM risk, hạng nguy kịch/cảnh/theo dõi/khoẻ) | §11.5 (lớp phủ màu 3D **phải** có bảng xếp hạng 2D song song) · `sucKhoeMay.ts:406 xepHangSucKhoe()` |
| KT-4 | **Xác nhận (ack) cảnh báo của máy mình phụ trách**, ẩn tạm (shelve) có hạn khi đang chờ vật tư | §9.2 nhóm "Xử lý cảnh báo" · `nganXuLyLogic.ts` `ack`/`anTam`/`ghiChu` · ISA-18.2 (shelve có hạn tự bung, `MOC_AN_TAM_GIO = [1,4,8,24]`) |
| KT-5 | **Tạo phiếu bảo trì từ chính máy đó** (tự điền machineId, ưu tiên, cảnh báo liên quan) | §9.2 nhóm "Tạo việc" · `maintenance.createWorkOrder` |
| KT-6 | **Gán kỹ thuật viên + đặt mức ưu tiên** cho phiếu vừa tạo | §9.2 (`canEdit` cùng module) · `NganXuLy.tsx:469-485` |
| KT-7 | **Thiết kế lại bố trí** khi lắp thêm/di dời máy: xếp chỗ máy mới vào mặt bằng, vẽ vùng an toàn | §12b.3 dòng *"SỬA ĐỔI — vị trí/hình học máy: CÓ, **ở màn khác** `/twin-studio`"* · `settings_factory` VCED |

**Không thuộc vai này (cố ý, và tôi đồng ý):** ra lệnh OT start/stop/reset trên cảnh 3D.
Spec §12b.4 từ chối có lý do đo được: *"cảnh 3D là mặt khám phá — một nút STOP sống trong mặt khám phá là
một nút SẼ bị bấm thử"*; và *"đủ tươi để NHÌN khác đủ tươi để RA LỆNH"*. Thay bằng **chọn-rồi-nhảy**: nút
"Mở chức năng" đưa sang cockpit/console thật. **Đây là THIẾT KẾ CỐ Ý, không phải thiếu sót** — và trên máy
4197, kỹ thuật thấy đúng 4 đích: *Full cockpit · Machine health · History · **Control plane*** (thô
`tho/DE/D1-qatd_kythuat.json`, ảnh `DE-D2-sau-luu.png`). Đường sang mặt điều khiển **có**, và đi qua một
hành động rời màn có ý thức. ĐÚNG như thiết kế.

## 1.2 Bảng: việc × làm được?

| # | việc | làm được? | bằng chứng | hậu quả nghiệp vụ |
|---|---|---|---|---|
| **KT-1** | Quét phạm vi, tìm máy dừng/lỗi | **LÀM ĐƯỢC** | A2/A3 ĐẠT (ô chọn liệt kê đúng 2 nhà máy: *Công ty A · Công ty B*) · PH-02 overview = **780** máy khớp DB · B8 mở `/twin?nm=39` (QATD-B, **không** phải nhà máy đầu) dựng đúng 409 máy/63 khối · B1 bộ chọn 4 toà × 7 tầng đúng cả 3 công ty · PH-05 hợp đồng trạng thái khớp **5/5 rổ trên 409 máy** · dải cảnh báo "Alarms (35)" = andon của A+B | **Bước đầu của ca chạy tốt.** Kỹ sư biết ngay có bao nhiêu máy dừng/lỗi, và con số trên màn **bằng đúng** con số trong CSDL — chữ "máy dừng / lỗi / bảo trì / mất kết nối" nói **một chữ duy nhất** cho mỗi rổ, không có rổ nào lệch. Đây là nền để tin mọi thứ phía sau. |
| **KT-2** | Định vị máy lỗi trên sàn | **MỘT PHẦN — 10,9 %** | PH-12 (bán kính đo rời từ DB, mô hình đúng **10/10** điểm đã đo): trong 780 máy được gán · **VẼ ĐỦ 7 line / 85 máy (10,9 %)** · **ĐẦU ĐÚNG · CẢNH RỖNG 25 line / 286 máy (36,7 %)** · **TỪ CHỐI HẲN 35 line / 409 máy (52,4 %)** ⇒ **89,6 % line không vẽ đủ**. Ảnh `C-C1-qatd_kythuat-line249.png`: "Chuyền 249 · **Máy 0 · Trạm 0 · WIP 0**" trong khi DB có 15 máy | **Đây là chỗ màn 3D mất lý do tồn tại.** Spec tự viết: *"3D được biện minh cho ĐỊNH VỊ"*. Với kỹ sư, 9/10 chuyền không cho định vị. Tệ hơn "không có bản đồ": bản đồ **có mặt và nói sai** — nói "Máy 0" về một chuyền 15 máy đang chạy. Người đi tìm máy lỗi sẽ **kết luận chuyền không có máy** và bỏ qua nó. |
| **KT-2b** | Mở máy của **nhà máy thứ hai** (QATD-B) | **KHÔNG LÀM ĐƯỢC** | C2.1 / BANG-DE ô #7: `/twin/may/4568` ⇒ *"Không mở được máy #4568 — Đối tượng này **không thuộc phạm vi đang xem** (hoặc không còn tồn tại)"* (ảnh `C-C2-qatd_kythuat-may4568.png`, `data-ly-do="ngoaiPhamVi"`). C5.1: trên chính màn `/twin?nm=39` mà kỹ sư mở ĐÚNG, **63/63 khối máy bấm được**, bấm một cái ⇒ màn đích **chối**. Mô hình PH-12 dự đoán cả 409 máy QATD-B cùng số phận (đo trực tiếp: 1 máy) | **Câu từ chối là một lời nói dối về quyền của chính người dùng.** QATD-B **thuộc** phạm vi anh ta — PH-19 chứng minh: cùng cookie ấy gọi `maintenance.createWorkOrder` cho **chính máy 4568** ⇒ **HTTP 200**, phiếu `WO-4568-…` được ghi thật. Kỹ sư đọc câu ấy sẽ đi mở phiếu quyền với IT — một quy trình **hoàn toàn vô ích** vì quyền không thiếu gì cả. Đây là loại lỗi tốn nhiều giờ người nhất trong bảng này. |
| **KT-3** | Xem sức khoẻ / nguy cơ hỏng | **MỘT PHẦN** | **CÓ:** viên tin cậy ở màn Máy *"ICT · Health 50 % · critical · Updated 1 min ago"* + **vòng đế ĐỎ** quanh khối máy (ảnh `DE-D1-kythuat.png`) · API `sucKhoeMay` tầng 88 trả **371 lời khai**, phân bố `nguy_kich 124 · canh 133 · theo_doi 62 · khoe 52` · hạng có **kênh CHỮ** độc lập với màu (F5 ĐẠT). **KHÔNG:** PH-28 — `xepHangSucKhoe()` tồn tại, có ca kiểm đơn vị, **0 chỗ gọi trong mã sản phẩm**; §11.5 bắt buộc bảng 2D song song với mọi lớp phủ màu; DOM: **0 bảng xếp hạng** trên `/twin`, `/twin/line`, `/twin/may` | **Kỹ sư xem được sức khoẻ TỪNG máy, không xem được BẢNG XẾP HẠNG.** Câu hỏi thật của ca là *"hôm nay tôi nên đụng vào máy nào TRƯỚC"* — với 124 máy hạng `nguy_kich` trên một tầng, trả lời bằng cách rê chuột từng vòng đỏ là không khả thi. Và ở **409 máy của QATD-B** thì không có vòng nào để rê: cảnh không vẽ (KT-2). |
| **KT-4** | Ack / ẩn tạm cảnh báo | **LÀM ĐƯỢC** (trong lát vẽ được) | D1 ô #1 ĐẠT: trên `/twin/may/4197` có đủ `nut-ack` "Acknowledge" + `nut-an-tam` "Shelve" + `nut-tao-phieu`; hai nút đầu **tắt vì máy KHÔNG có cảnh báo** ("ALARMS (0) No open alarms."), **không phải vì quyền** — đúng luật ẨN-KHÔNG-DISABLE. Đối chứng dương cùng thiết bị: `qatd_admin` thấy đủ 4 nút (ô #5); `qatd_giamdoc` (andon chỉ canView) thấy **0** nút ghi (ô #4) | **Cổng quyền làm đúng việc của nó** — đây là điểm mạnh thật, đo hai chiều. Lưu ý nghiệp vụ: **ack chỉ có ở màn Máy, KHÔNG có ở màn nhà máy** — xem "ghi chú A" dưới bảng. |
| **KT-5** | Tạo phiếu bảo trì | **MỘT PHẦN — chỉ nhà máy A** | **ĐẠT** (D2 ô #9): qua UI trên máy 4197, form *"Work order title / Priority Level 3 / Assign technician Unassigned / Save"* ⇒ `maintenance_work_orders` **29 → 30**, hàng id 35 `WO-4197-1789438419698-RG4T` — **đường ghi UI sống thật**. **SAI** (ô #8): cùng vai, máy 4568 (QATD-B) ⇒ **không có nút nào** vì màn dừng ở `ngoaiPhamVi`. **Server thì đồng ý** (ô #10, HTTP 200) | **Quy trình bảo trì vỡ đúng ở giữa.** Với QATD-A: kỹ sư đứng cạnh máy, mở twin, ra phiếu — đúng ý đồ §9.2 ("phiếu tự điền machineId"). Với QATD-B: **phải bỏ twin, quay về màn bảo trì cũ, tự gõ mã máy** — tức là mất đúng giá trị mà twin hứa. Nguy hiểm hơn: **hàng rào đang nằm ở CLIENT chứ không ở SERVER** (PH-19). Một client khác (script, app di động, người dùng nâng cao) **vẫn ghi được**. Đó không phải hàng rào, đó là một **rào chắn bằng giấy** — nó cản người làm đúng việc và không cản ai khác. |
| **KT-6** | Gán KTV + đặt ưu tiên | **MỘT PHẦN — CHƯA ĐO phần cốt lõi** | Form mở ra CÓ `chon-ky-thuat-vien` hiển thị **"Unassigned"** và `chon-uu-tien` **"Level 3"** (D1 ô #1, ảnh `DE-D1-kythuat.png`). **CHƯA ĐO: danh sách kỹ thuật viên có tên thật nào trong đó không**, và tên ấy có bị lọc theo nhà máy không | Nếu danh sách rỗng thì "gán KTV" là một ô trống có nhãn đẹp. **Phép đo cần:** mở form bằng `qatd_kythuat`, đọc `option` của `chon-ky-thuat-vien`, đếm; rồi lưu một phiếu có `assignedTo` ≠ null và đọc lại hàng DB. |
| **KT-7** | Thiết kế lại bố trí (Studio) | **MỘT PHẦN — 12 %** | PH-14 / BANG-DE ô #22: vào được Studio (ĐẠT, `settings_factory`), ô chọn nhà máy đúng 2 nhà máy (ĐẠT). Nhưng màn in **"Building: 4"** mà **chỉ có MỘT bộ chọn** (`chon-nha-may`) — **không ô chọn Toà, không ô chọn Tầng**; `grep setToaNha|setTang|chon-toa-nha|chon-tang` trong `TwinStudio.tsx` = **0**. Dải sức khoẻ: *"45 machines placed · **326 awaiting placement**"* = **88 % máy của QATD-A ngoài tầm với**. Ảnh `DE-E3-kythuat-studio.png`: cây trái liệt kê **đủ 8 xưởng** (T1-X1 … T4-X2) nhưng chỉ tầng 1 toà 1 xếp được | **Đường BUILD là phần yếu nhất của sản phẩm trên kịch bản này.** Nghiệp vụ thật: nhà máy lắp thêm máy hàng tháng, ở bất kỳ toà nào. Studio hiện chỉ nhận máy mới ở **một** trong **tám** xưởng của một trong **hai** nhà máy. ★ Đối chứng sắc: **màn XEM `/twin` CÓ đủ ba ô chọn** (Công ty ▾ / Toà ▾ / Tầng ▾) và chạy đúng (PH-11) ⇒ **năng lực đã tồn tại trong sản phẩm, chỉ thiếu ở đúng màn cần nó nhất.** |
| **KT-7b** | Vẽ / xoá vùng an toàn | **LÀM ĐƯỢC** | E5 ĐẠT: vẽ 4 đỉnh *"664.1 m²"* → lưu (toast, vào danh sách) → xoá **qua nút UI**; `twin_vat_the` 341 → 342 → 341, không chạm hàng cũ | Vòng đời CRUD đầy đủ trên đường ghi thật. **Điểm mạnh.** Nhưng nó chỉ áp được cho tầng 1 toà 1 (cùng giới hạn KT-7). |
| **KT-8** | "Mở chức năng" ở cấp **nhà máy / chuyền** | **KHÔNG LÀM ĐƯỢC** | PH-16: `NganXuLy.tsx:148` khai `loaiDich?: LoaiDich` mặc định `"machine"`; grep trong mã sản phẩm ⇒ **0 chỗ gọi truyền giá trị khác** (chỉ 2 tệp test). Hai dòng `factory` (`/corporate-dashboard`) và `line` (`/oee-dashboard`) của bảng §9.3 là **mã chưa giao hàng** | Chọn một chuyền trên twin **không** đưa sang được `/oee-dashboard?lineId=`. Kỹ sư muốn xem OEE của chuyền vừa sửa phải tự mở màn khác và tự tìm lại chuyền. Mất đúng lời hứa *"mang theo đúng id"* của §9.3. |
| **KT-9** | Ghi chú lên cảnh báo | **KHÔNG LÀM ĐƯỢC** | PH-17: `nganXuLyLogic.ts:53,142` khai hành động `ghiChu` với `duocPhep: quyen.ackAlarm`; đo **5 vai, kể cả admin** ⇒ `nut-ghi-chu` = **0** | Kỹ sư không để lại được câu *"đã thay cảm biến, theo dõi 2 ca"* ngay tại cảnh báo. Ca sau mất ngữ cảnh. Cùng lớp "có luật + có quyền + có test + 0 chỗ gọi" với KT-8. |
| **KT-10** | Mở màn nhanh (chờ bao lâu) | **MỘT PHẦN** | PH-24 / F1: **48/48 lượt > 2.500 ms**, p50 **2.615** · p90 **2.858** · max **3.089 ms**. Quy trách 5 bước: **không** do cỡ cảnh (41 máy 1.291 ms vs 68 máy 1.259 ms) · **không** do màn 3D (`/oee-dashboard` 1.238 ms) · **do VAI**: admin **1.182** vs kythuat **3.154 ms** trên CÙNG URL, cùng 68 khối · thủ tục: `commandCenter.hierarchy` **1.674 ms** kéo cả lô tRPC · gốc: PH-23 thủ tục ấy **không lọc tenant** | **Mỗi lần mở màn, kỹ sư chờ thêm ~1,97 giây so với admin — và chờ vì một truy vấn quét cả CSDL mà anh ta không được phép đọc.** Trong một ca đi 30 máy, đó là ~1 phút chờ thuần. Không phải lỗi 3D: dựng cảnh chỉ tốn 10–180 ms sau khi màn hiện. |

**Ghi chú A — ack không có trên màn nhà máy.** Thô `tho/DE/D1-qatd_kythuat.json` và `D1-qatd_congnhan.json`:
trên `/twin`, ngăn xử lý có **`nutTrongNgan = []`**, chữ duy nhất là *"Select a machine on the scene or in the
list to **open its 3D machine screen**."*; và một cú bấm vào khối máy **điều hướng** sang `/twin/may/:id`
(C3: 5/5). Spec §9.1 vẽ ngăn xử lý **CÓ** `[Xác nhận][Ẩn tạm][+ Tạo phiếu]` **ngay cạnh cảnh nhà máy**, và
§9.2 nói rõ *"người dùng click máy trên 3D → ngăn xử lý mở ra **ngay cạnh**"*. Sản phẩm hiện **nhảy màn cho
mọi hành động**. "Chọn-rồi-nhảy" (§12b.4) được biện minh cho **lệnh OT**, không cho ack.
**CHƯA ĐO:** ngăn xử lý có nút nào sau khi chọn máy **mà không rời màn** không (phép đo: bấm một hàng trong
`danh-sach-may`, không bấm khối 3D, rồi đếm nút trong `ngan-xu-ly`).

**Ghi chú B — hai con số rủi ro không khớp nhau `[đọc từ ảnh]`.** Trên `DE-D1-kythuat.png`, cùng một máy
ICT-01: chip twin nói **"Health 50 % · critical"** (vòng đế ĐỎ), còn ô thống kê cockpit ngay dưới nói
**"Failure risk 0 %"** và **"OEE —"**. Hai số về cùng một rủi ro, đứng cách nhau 300 px, nói ngược nhau.
**Chưa ai chấm ô này.** **CHƯA ĐO:** hai số lấy từ hai nguồn nào; phép đo: đọc `sucKhoeMay(4197)` và
`digitalTwin`/`pdm` risk cùng lúc, đối chiếu định nghĩa.

## 1.3 Ba câu hỏi vai KỸ THUẬT hỏi màn hình

| câu hỏi | màn trả lời được? | chi tiết |
|---|---|---|
| **"Máy nào sắp hỏng trong xưởng tôi phụ trách?"** | **MỘT PHẦN, và chỉ ở nhà máy A** | Trả lời **được** ở mức từng máy: vòng viền 3 màu trên cảnh + chữ hạng ở màn Máy. Trả lời **không được** ở mức danh sách ưu tiên: PH-28 — bảng 2D xếp hạng chưa giao, nên 124 máy `nguy_kich` không xếp được hàng. Và ở QATD-B thì **không có cảnh để nhìn** (PH-12). ⚠ Một lỗ đo: **không có bộ đếm `__demVien`** nên **màu vòng viền sức khoẻ chưa từng được đo ở bất kỳ đợt QA nào** (PH-28 HỎNG) — mắt thấy đỏ/hổ phách trên ảnh, nhưng mắt không phải phép đo. |
| **"Máy QATD-B-T1-X1-L1-M07 báo lỗi — mở ra và ra phiếu cho tôi."** | **KHÔNG** | C2.1 + D2 ô #7/#8/#10. Màn nói *"không thuộc phạm vi đang xem"*; server nói **200 OK**. Câu trả lời đúng lẽ ra là mở máy và ra phiếu; câu trả lời thật là một lời từ chối sai. |
| **"Tôi vừa lắp 8 máy ở toà 3 tầng 2 — xếp chúng vào mặt bằng."** | **KHÔNG** | PH-14. Studio không có ô chọn toà/tầng; 8 máy ấy nằm trong đống **"326 awaiting placement"** và không có đường nào đưa chúng lên sàn. |

## 1.4 Xếp hạng: **HẠN CHẾ NẶNG**

**Vì sao không phải CHƯA DÙNG ĐƯỢC:** có một lát cắt **chạy trọn vẹn đầu-cuối, đã chứng minh bằng hàng DB
thật** — trên QATD-A toà 1 tầng 1: cảnh vẽ đủ (C1.2: 12 nhãn máy, 12 ô trạm), mở máy được (C2.3), ack/ẩn tạm
đúng quyền (D1 ô #1), tạo phiếu thật (D2 ô #9, `WO-4197-…`), vẽ/xoá vùng an toàn thật (E5). Lát ấy là **85
máy / 780** nhưng nó **thật**.

**Vì sao không phải DÙNG ĐƯỢC VỚI LƯU Ý:** 52,4 % số máy được gán bị từ chối hẳn **kèm một câu sai về quyền
của chính người dùng**; 88 % máy của nhà máy A không xếp chỗ được; và hai trong ba câu hỏi nghiệp vụ cốt lõi
(§1.3) bị trả lời "KHÔNG".

**⚠ Nếu tổ chức triển khai cho kỹ sư phụ trách ≥2 nhà máy** (đúng kịch bản tập đoàn này), nên coi như
**CHƯA DÙNG ĐƯỢC** cho tới khi vá PH-12 — vì với họ, nhà máy thứ hai trở đi **luôn** là vùng chết.

**Điều kiện lên mức kế tiếp (DÙNG ĐƯỢC VỚI LƯU Ý):**
1. Vá PH-12 (cả `factories[0]` **và** `toaNha[0]`) ⇒ bảng bán kính `pham-vi-hong.mjs` cho kythuat **0 %** line hỏng.
2. Đo lại lô C với 3 vai: C1.1 · C1.4 · C2.1 · C2.4 chuyển **SAI → ĐẠT**, đồng thời C4b **giữ CHẶN-ĐÚNG**
   (máy thật sự ngoài phạm vi vẫn phải bị từ chối — không được nới nhầm).
3. Đo bổ sung ca chưa từng đo: **bấm một mục trong dải cảnh báo thuộc QATD-B** và ghi màn đích.

**Điều kiện lên DÙNG ĐƯỢC:** thêm PH-14 (chọn toà/tầng trong Studio) + PH-28 (bảng 2D sức khoẻ) + PH-24/PH-23
(thời gian mở màn về ngưỡng 2.500 ms).

## 1.5 Ba đề xuất ưu tiên cho vai KỸ THUẬT

| # | đề xuất | giá trị / công sức | sửa ở đâu | nghiệm thu |
|---|---|---|---|---|
| **KT-ĐX-1** | **Lấy nhà máy và toà từ ngữ cảnh đang xem, thôi dùng `[0]`** | **RẤT CAO / THẤP** — mở khoá 695/780 máy (89,1 %) cho vai này, 4 dòng mã, **id đúng đã có sẵn trong chính trang**: C5.1 đo được `duongVe` của màn Máy **đã mang `nm=39&toa=57&tang=109`** | `client/src/pages/TwinLine.tsx:355` và `:375` · `client/src/pages/TwinMay.tsx:284` và `:299`. Nguồn thay thế theo thứ tự: query `?nm=/&toa=` → `trangThaiVe(duongVe)` → suy từ chính đối tượng đang mở (API `factoryCommand.machineDetail` / `line.list` đã trả đúng — PH-19 chứng minh server sạch). **Gỡ luôn docblock viện lý do "đo 2026-09-09: 2 nhà máy, 82 hàng đặt chỗ ở MỘT tầng"** — tiền đề ấy đã hết hạn (G148) | (a) `pham-vi-hong.mjs` chạy lại: kythuat **89,6 % → 0 %**; (b) lô C 3 vai: 4 ô SAI → ĐẠT, **C4b vẫn CHẶN-ĐÚNG**; (c) ablation giữ kết luận: cùng máy 4977, `qatd_giamdoc` và `qatd_admin` phải mở được (hiện đang SAI) còn `qatd_kythuat` phải **vẫn** bị NOT_FOUND (đúng phạm vi) |
| **KT-ĐX-2** | **Studio: thêm ô chọn Toà + Tầng (bê nguyên bộ chọn của `/twin`) và gác nút TẠO bằng `canCreate`** | **CAO / TRUNG BÌNH** — mở 88 % máy cho đường BUILD; bộ chọn **đã tồn tại và chạy đúng** ở màn khác nên là việc nối dây, không phải việc thiết kế | `client/src/pages/TwinStudio.tsx:106` (`toaNhaDau = [0]`), `:125` (`tang = [0]`), `:256` (`tangId={tangDau.tangId}`) — thay bằng state + bộ chọn của `TwinVanHanh`. Kèm PH-15: `client/src/components/twin3d/thiet-ke/XuongThietKe.tsx:173` `coQuyenSua = canEdit ∥ canEdit` **bỏ qua `canCreate`** ⇒ tách hai cờ: `canEdit` mở gizmo, `canCreate` mở "Generate" + "Create building" | (a) đổi tầng trong Studio ⇒ dải *"N machines placed · M awaiting"* đổi theo **đúng `mayTheoTang`** của tầng được chọn; (b) xếp 1 máy ở **toà 3 tầng 2** rồi xoá (trap EXIT, G111), `twin_dat_cho` về nguyên số; (c) đối chứng quyền: `qatd_quanly` (0 `canCreate`) **không còn thấy** `nut-mo-sinh` và `nut-tao`, trong khi gizmo vẫn còn — tức ẩn-không-disable, không phải khoá cả màn |
| **KT-ĐX-3** | **Giao bảng 2D xếp hạng sức khoẻ + bộ đếm `__demVien` cho lớp phủ màu** | **CAO / TRUNG BÌNH** — trả lời đúng câu hỏi số 1 của vai; đồng thời **lần đầu tiên làm cho lớp phủ màu đo được** (hiện là lớp duy nhất chưa từng đo ở 11 đợt QA) | Nối `xepHangSucKhoe()` (`sucKhoeMay.ts:406`, đã có ca kiểm đơn vị, **0 chỗ gọi**) vào panel trái của `TwinVanHanh` như §11.5 đòi; thêm `window.__demVien` phơi bày `{machineId, hang, mau}` của từng vòng đã vẽ, cùng khuôn với `__demNhan`/`__demBadge` đã có | (a) bảng liệt kê top N theo hạng, tổng **khớp `sucKhoeMay` API** (tầng 88: `nguy_kich 124 · canh 133 · theo_doi 62 · khoe 52`); (b) **ablation**: sửa 1 hàng `machine_health_history` ⇒ máy đó đổi hạng trên bảng **và** đổi màu vòng; hoàn nguyên ⇒ trở lại; (c) `__demVien` trả **3 màu khớp 3 hạng**, số vòng = **319** (số lời khai đáng vẽ), sai lệch 0 |

---

# §2. VAI CÔNG NHÂN — vận hành máy tại xưởng

Tài khoản đo: `qatd_congnhan`, role `operator`, gán **QATD-C** (328 máy / 31 line).
Quyền đo được từ DB: `andon` **V,E** · `machine_status` **V**. Không `machine_control`, không `settings_factory`.
⇒ Ack được cảnh báo · **không** tạo được phiếu · **không** vào được Studio
(E1 ô #17: *"Access denied — You don't have permission to access this page…"* + nút "Back to home" — **CHẶN-ĐÚNG**,
chặn ở **cửa** và **nói rõ lý do + lối ra**, không phải màn trắng).

## 2.1 Nhiệm vụ nghiệp vụ thật trong một ca (6 việc)

| # | việc | căn cứ |
|---|---|---|
| **CN-1** | **Theo dõi mấy cái máy mình phụ trách** — chạy / dừng / lỗi / mất kết nối, và **dữ liệu có còn tươi không** | §9.5 "Trung thực dữ liệu (NT-3)" — ba trạng thái tươi hiện ở panel trái *và* trên chính vật thể |
| **CN-2** | **Thấy cảnh báo nổi lên ngay**, biết nó ở máy nào | §9.2 nhóm "Xử lý cảnh báo" · lớp `lop-canh-bao` badge nổi trên khối máy |
| **CN-3** | **Xác nhận (ack) cảnh báo** — báo cho hệ thống "tôi đã thấy, tôi đang xử lý" | `andon/canEdit` · `andon.acknowledge` · ghi `mttaSeconds` (thời gian tới khi có người nhận) |
| **CN-4** | **Báo bất thường** khi thấy máy có triệu chứng lạ (chưa tới mức máy tự báo) | `[suy luận nghiệp vụ]` — đây là việc thường xuyên nhất của người vận hành; trong repo có `andon.raise` và `andon.quickReport` (báo sự cố 1-chạm) |
| **CN-5** | **Tìm một máy theo mã** (`QATD-C-T1-X1-L1-M05`) khi trưởng ca gọi tên nó qua bộ đàm | `[suy luận nghiệp vụ]` — ô "Filter by name or code…" trong `danh-sach-may` (`[đọc từ ảnh]` `DE-D3-co-twin.png`) |
| **CN-6** | **Biết máy đó nằm chỗ nào trên sàn** để đi tới | spec dòng 8874: *"người vận hành phải biết **máy nào, ở đâu** để đi tới. Đó là điều bảng danh sách không cho."* |

## 2.2 Bảng: việc × làm được?

| # | việc | làm được? | bằng chứng | hậu quả nghiệp vụ |
|---|---|---|---|---|
| **CN-1** | Theo dõi máy mình phụ trách | **LÀM ĐƯỢC** | A1/A2/A3 ĐẠT: vào `/twin`, ô chọn đúng **1 nhà máy** (*Công ty C*), overview **328** máy khớp DB (PH-02). PH-05: hợp đồng trạng thái khớp **5/5 rổ** — `error→Dừng lỗi`, `stopped+tươi→Chờ`, `stopped+hb cũ→Mất kết nối`, đều một chữ. Ảnh `DE-D3-co-twin.png`: panel trái *"Machines 328 · Fresh data 322 · Stale data 0 · Unknown 6 · Decommissioned 0"* và **danh sách máy toàn nhà máy, xếp máy Down/Stopped lên đầu, kèm tuổi dữ liệu "28s"** `[đọc từ ảnh]`. F5 ĐẠT: 5 trạng thái = **5 màu KHÁC NHAU + hoạ tiết gạch chéo + CHỮ trạng thái** ⇒ mã hoá dư thừa 3 lớp, không phụ thuộc màu | **Đây là điểm mạnh thật và nó đúng chỗ.** Công nhân thường không phân biệt tốt màu dưới ánh đèn xưởng; ba kênh (màu + hoạ tiết + chữ) là thiết kế đúng. Ô "Fresh/Stale/Unknown" nói thẳng *"dữ liệu này còn tươi không"* — đúng NT-3, và nó là thứ giữ người vận hành khỏi tin vào một màn hình đã chết. |
| **CN-2** | Thấy cảnh báo nổi lên | **LÀM ĐƯỢC** | D3 ablation 3 mốc (N-5): **trước** 3 badge / "Alarms (20)" → **chèn 1 andon `raised` tay** → **4 badge** (badge mới mang đúng mã máy `▲ QATD-C-T1-X1-L1-M01`) / "Alarms (**21**)" đứng đầu danh sách → **xoá** → về lại 3 badge / "Alarms (20)". Ảnh `DE-D3-co-twin.png`: dải Alarms(21) bên trái + badge hổ phách trên khối máy trong cảnh | **Đúng chiều, chỉ đổi khi dữ liệu đổi** — đây là kiểu bằng chứng duy nhất đáng tin cho một con số. Công nhân nhìn một lần là thấy có bao nhiêu việc và ở máy nào. |
| **CN-3** | Ack cảnh báo | **LÀM ĐƯỢC** | D3 ĐẠT, hai đường đọc độc lập. UI: ngăn máy 4977 chuyển "Unacknowledged" → bấm → toast *"Alarm acknowledged"* → mục đổi thành **"Acknowledged"**, nút tắt lại (ảnh `DE-D3-co-may.png` → `DE-D3-co-sau-ack.png`). DB: `status raised→acknowledged`, `acknowledgedBy = **26486** (= chính qatd_congnhan)`, `mttaSeconds = 25`; `audit_logs` id 5778 cùng nội dung | **Vòng nghiệp vụ quan trọng nhất của vai này chạy thật, và ghi đúng ai đã nhận việc.** `mttaSeconds` là chỉ số quản lý thật (thời gian tới khi có người nhận) — nó được ghi tự động, không phải khai tay. ⚠ Xem "ghi chú C" về chi phí thao tác. |
| **CN-4** | **Báo bất thường** | **KHÔNG LÀM ĐƯỢC** (hai lý do chồng nhau) | **(a) Sản phẩm:** `nganXuLyLogic.ts` khai đúng 6 mã hành động — `ack · anTam · ghiChu · taoPhieu · ganKyThuat · datUuTien` — **không có hành động "bật andon"**. Twin không có mặt để báo sự cố. **(b) Tài khoản:** `[suy luận từ mã]` `server/routers/andonRouter.ts:199` `raise` và `:239` `quickReport` đều gác `requirePermission("andon","**canCreate**")`, mà vai này chỉ có andon **V+E** ⇒ dù có nút cũng 403. Đường có sẵn ngoài twin: `client/src/pages/OperatorHome.tsx:182` `trpc.andon.raise` ("gọi bảo trì") | **Việc thường xuyên nhất của người vận hành không có mặt trên twin.** Công nhân thấy máy kêu lạ, mùi khét, băng tải lệch — không báo được từ màn đang mở, phải đi tìm màn khác. Đây là khoảng trống **thiết kế**, không phải hỏng. Cần chủ dự án quyết hai việc: (1) twin có nên có nút "Báo sự cố" không (tôi đề nghị **CÓ**, xem CN-ĐX-3); (2) vai operator có nên được `andon/canCreate` không — **nếu không thì không operator nào bật được andon**, và đó gần như chắc chắn là **lỗi cấu hình kịch bản** giống PH-20, không phải lỗi sản phẩm. **CHƯA ĐO:** `OperatorHome`/`/andon` có trong menu của vai này không, và có lọc phạm vi không. |
| **CN-5** | Tìm máy theo mã | **MỘT PHẦN — vỡ ở 1280** | `danh-sach-may` có ô **"Filter by name or code…"** và liệt kê máy **toàn nhà máy** (thấy cả `…-T1-X1-…` lẫn `…-T2-X2-…` trong cùng danh sách) `[đọc từ ảnh]`. **Nhưng** PH-27/F4: ở **1280×720**, 14 chuỗi trong `danh-sach-may` có `scrollWidth 124 > clientWidth 66` — mất **47 %**, phần sống sót là **`QATD-A-T…`** = **tiền tố dùng chung của mọi máy**; phần phân biệt (`-X1-L1-M03`) nằm ở **đuôi** và bị cắt. Ảnh `F-F5-twin-tang-dong-68may-1280.png` cho thấy **mọi hàng đọc y hệt nhau**, chỉ còn cột "Down/Stopped" và "13s" khác | **Ở 1280 — đúng độ phân giải của màn công nghiệp rẻ đặt tại xưởng — danh sách máy mất khả năng phân biệt.** Công nhân nghe bộ đàm "M05 dừng rồi", nhìn danh sách thấy 40 hàng giống hệt `QATD-A-T…`. 14/14 hàng có thuộc tính `title` (tooltip khi rê chuột) — **nhưng màn cảm ứng ở xưởng không có "rê chuột"**. ★ **Lời giải đã có sẵn trong chính sản phẩm**: màn Line in *"Tiền tố: QATD-C-T1-X1-L1-"* một lần rồi rút nhãn còn `M01..M08` (ảnh `C-C1-qatd_congnhan-line284.png`, `F-F5-line-217-1600.png`). Chỉ cần áp cùng cách cho danh sách máy. |
| **CN-6** | Biết máy nằm chỗ nào trên sàn | **MỘT PHẦN — 21,6 %** | PH-12: trong 328 máy · **VẼ ĐỦ 7 line / 71 máy (21,6 %)** · **ĐẦU ĐÚNG · CẢNH RỖNG 24 line / 257 máy (78,4 %)** · TỪ CHỐI HẲN **0** (vì QATD-C tình cờ là `factories[0]` của chính vai này). Hai ảnh cạnh nhau nói hết: `C-C1-qatd_congnhan-line284.png` (toà 1) = **8 khối máy M01…M08 xếp hàng, mỗi cái một nhãn trạng thái**, dải 8 trạm có WIP; `C-C1-qatd_congnhan-line299.png` (**toà 3**) = header vẫn nói **"Máy 10 · Trạm 10 · WIP 56"**, dải trạm vẫn đủ S01…S10, mà **cảnh 3D chỉ còn MỘT CÂY CỘT ĐÈN ANDON đứng giữa hư không** — không một khối máy nào | **Lời hứa cốt lõi của màn 3D gãy ở 3/4 số toà.** Với công nhân làm ở toà 2-4, twin không trả lời được *"máy ở đâu"* — mà spec tự nhận đó là **lý do duy nhất** biện minh cho 3D. Hình ảnh cây cột đèn đứng một mình trên sàn trống còn tệ hơn màn trống: nó khiến người dùng tưởng cảnh đã tải xong. |
| **CN-6b** | Mở một máy ở **toà 2-4** | **MỘT PHẦN — mất 3D, GIỮ được xử lý** | C2.4 chấm SAI: máy 5139 (toà T3) ⇒ *"Máy này chưa có chỗ trên bố cục 3D"* **dù DB có đúng 1 hàng `twin_dat_cho`**. **Nhưng ảnh `C-C2-qatd_congnhan-may5139.png` cho thấy phần còn lại của màn VẪN SỐNG**: tên `SPI-01`, mã đầy đủ, trạng thái "Đang chạy", KẾT QUẢ AOI (OK 4 / NG 2 / Yield 66.67 %), **CẢNH BÁO (0) + nút "Xác nhận"**, MỞ CHỨC NĂNG (Cockpit đầy đủ · Sức khoẻ máy) — và màn tự nói câu đúng: *"Buồng lái và ngăn xử lý bên dưới vẫn dùng được."* | **Phân biệt quan trọng, và nó kéo xếp hạng của vai này lên:** với công nhân, PH-12 làm mất **bản đồ**, KHÔNG làm mất **đường xử lý**. Ack vẫn bấm được ở 100 % số máy. Đó là lý do vai này không bị chấm CHƯA DÙNG ĐƯỢC. Cái mất là `loai-may` và `suc-khoe-may` trên khung 3D — tức **"máy này loại gì, khoẻ không"** biến mất khỏi tầm mắt đầu tiên. |
| **CN-7** | Từ màn Line đi tới một máy khi cảnh trống | **CHƯA ĐO — có đường, chưa ai bấm thử** | `[suy luận từ mã]` `TwinLine.tsx:843-850`: ô trạm trên dải 2D có handler `chonTram` → lấy **máy đầu của trạm** → `dieuHuongToiMay`. Dải này **có render** ở line 299 (thấy S01…S10 trên ảnh). Và `mayLine` dựng từ `mayTatCa` (danh sách máy của nhà máy) chứ **không** từ dữ liệu đặt chỗ ⇒ **theo mã thì click ô trạm VẪN mở được máy** dù cảnh 3D trống | Nếu đúng, công nhân ở toà 2-4 **vẫn có một đường vòng** để tới máy. Nếu sai (mảng rỗng ⇒ click chết im lặng), thì màn Line ở toà 2-4 là **ngõ cụt hoàn toàn**. Chênh lệch giữa hai kết cục này rất lớn. **Phép đo cần (rẻ):** mở `/twin/line/299` bằng `qatd_congnhan`, bấm ô `S05` trên dải, ghi URL đích; đối chứng dương: cùng thao tác trên `/twin/line/284` (toà 1). |
| **CN-8** | Phân biệt "không phải của tôi" với "chưa xếp chỗ" | **KHÔNG LÀM ĐƯỢC** (ảnh hưởng thấp với vai này) | PH-13 / C4a: `LyDoManLine` chỉ có `mo \| chuaGanNhaMay \| thieuQuyen` (`manLine.ts:412`) — **thiếu `ngoaiPhamVi`**, khác hẳn màn Máy. Nên chuyền của nhà máy khác trả **đúng từng chữ** cùng câu với chuyền bị lỗi PH-12: *"Chuyền này chưa có máy nào trên bố cục — … hoặc thuộc một nhà máy khác."* | Với **công nhân** tác động thấp: họ chỉ có 1 nhà máy nên gần như không bao giờ chạm vào chuyền ngoài phạm vi (TỪ CHỐI HẲN = 0). Với **kỹ thuật** thì đây là thứ trộn lẫn hai tình huống hoàn toàn khác nhau. ✔ Mặt an toàn vẫn đúng: API 7/7 lời gọi ngoài phạm vi trả NOT_FOUND/[]/null ⇒ **không rò dữ liệu** (C4c CHẶN-ĐÚNG, có đối chứng dương cùng thiết bị). |
| **CN-9** | Bấm trúng máy trên cảnh (ngón tay, không phải chuột) | **LÀM ĐƯỢC** | C3 ĐẠT: 39 máy trong khung, **39/39 bấm được**, 5 cú bấm **thẳng vào tâm khối** ⇒ **5/5 tới đúng `/twin/may/<id>`** (4977→4977 · 4985→4985 · 4994→4994 · 5002→5002 · 5010→5010), tâm đo lại ngay trước mỗi cú bấm. PH-26: **0 cặp chồng lấn / 0 px²** giữa badge × nhãn và nhãn × nhãn ở **8/8 ca**, ở mật độ cao nhất từng đo (68 máy, 73 nhãn ứng viên) | **Điểm mạnh đắt tiền** — dự án đã trả giá 3 đợt cho lớp lỗi "nhãn cướp click" (G126/G128). Bây giờ nhãn không cướp click nữa, và mục tiêu bấm là **cả khối máy** chứ không phải một chấm nhỏ. Đây đúng là thứ cần cho ngón tay trên màn cảm ứng. |
| **CN-10** | Màn chạy mượt trên máy tính ở xưởng | **MỘT PHẦN — phụ thuộc máy có GPU hay không** | PH-25/F3: cùng cảnh, cùng thao tác — **RTX 5090: p50 62,1 FPS**, khung tệ nhất 36,6 FPS (ĐẠT). **Bộ tô mềm chạy CPU (SwiftShader): p50 26,1 FPS**, khung tệ nhất 6,3 FPS (**dưới ngưỡng 30**). PH-26: cảnh 68 máy chỉ **5 draw call · 15.026 tam giác** (biên 25×/33× so với trần) và **một khung mất đúng bằng cảnh 12 máy** (16,1 vs 16,4 ms) | PH-25 được ghi là **lỗi thiết bị đo** (Playwright mặc định không dùng GPU) — đúng. **Nhưng nó vô tình trả lời một câu nghiệp vụ thật:** cấu hình "không GPU" chính là cấu hình của một máy trạm rẻ đặt ở xưởng. ⇒ **CHƯA ĐO:** máy tính công nhân dùng ở xưởng có GPU/driver bật WebGL không. Nếu không, họ gặp 26 FPS chứ không phải 62. **Phép đo cần:** mở `chrome://gpu` trên đúng một máy trạm xưởng thật, đọc dòng WebGL renderer. |
| **CN-11** | Biết tầng mình đang xem có bao nhiêu máy | **KHÔNG LÀM ĐƯỢC** (nợ cũ có tài liệu) | PH-07: `dem-may` panel trái **cố ý** đếm theo **nhà máy** (`cayVanHanh.ts:58-61` ghi sẵn *"cùng chữ 'máy', hai mẫu số"*). PH-06 (SAI mới): bảng KPI nổi in nhãn phạm vi **tới cấp TẦNG** (`Corporate · Công ty C · Floor`) rồi ngay cạnh in số của **cả nhà máy** — trên tầng 3 **có 0 máy** nó vẫn in "371 machines · Running 261" (ảnh `AB-B4-*-tang3-trong.png`) | Công nhân chọn tầng mình làm việc, đọc được "328 máy" — con số của cả công ty. Không có con số nào nói về tầng đang đứng. Với kịch bản 7 tầng/toà thì đây là khoảng trống thật, dù PH-07 là **nợ có tài liệu** (không chấm SAI mới) còn PH-06 là **SAI mới** vì bản vá thêm nhãn phạm vi **lại gây ra đúng lớp lỗi nó định chặn**. |

**Ghi chú C — mỗi lần ack là một lần rời màn.** Như Ghi chú A (§1.2): ngăn xử lý trên `/twin` có **0 nút**;
mọi hành động nằm ở `/twin/may/:id`. Với dải **"Alarms (21)"** của một ca, công nhân phải: bấm máy trên cảnh →
đợi màn Máy → ack → quay lại `/twin` → tìm lại chỗ mình đang đứng trên sàn. Cộng thêm PH-24 (**mỗi lần mở màn
> 2.500 ms**, và vai non-admin chờ thêm ~1,97 s vì cổng quyền), **21 cảnh báo ≈ 21 lần đi-về**.
✔ Điểm tốt đi kèm: `duongVe` giữ đúng nhà máy/toà/tầng khi quay lại (C5.2/C5.3 ĐẠT) — **không mất chỗ đứng.**

## 2.3 Ba câu hỏi vai CÔNG NHÂN hỏi màn hình

| câu hỏi | màn trả lời được? | chi tiết |
|---|---|---|
| **"Máy `QATD-C-T1-X1-L1-M05` của tôi đang sao?"** | **LÀM ĐƯỢC** (toà 1) · **MỘT PHẦN** (toà 2-4) · **KHÔNG ĐỌC ĐƯỢC DANH SÁCH** ở 1280 | Toà 1: lọc theo mã trong danh sách → bấm → màn Máy đầy đủ (3D + trạng thái + AOI OK/NG/Yield + sức khoẻ + cảnh báo + nút Xác nhận) — C2.2 ĐẠT, ảnh `DE-D3-co-may.png`. Toà 2-4: mọi thứ trên **trừ** khung 3D và huy hiệu sức khoẻ (C2.4, ảnh `C-C2-qatd_congnhan-may5139.png`). Ở 1280 thì **bước tìm** gãy trước (PH-27). |
| **"Có cảnh báo nào ở chuyền tôi không? Tôi xác nhận thế nào?"** | **LÀM ĐƯỢC** | Dải "Alarms (21)" + badge nổi mang mã máy + nút "Xác nhận"/"Acknowledge" ở màn Máy; ghi DB đúng danh tính và đo `mttaSeconds` (D3, ablation 3 mốc). **Chi phí**: một lần rời màn cho mỗi cảnh báo (Ghi chú C). |
| **"Máy tôi ở toà 3 — nó nằm chỗ nào trên sàn?"** | **KHÔNG** | PH-12 nhánh `toaNha[0]`. Cảnh 3D trống (ảnh `C-C1-qatd_congnhan-line299.png` — chỉ một cột đèn andon). Đây đúng là câu mà spec nói *"bảng danh sách không cho"*, tức là **câu duy nhất mà 3D tồn tại để trả lời**. |

## 2.4 Xếp hạng: **HẠN CHẾ NẶNG** — tách làm hai nửa để không nói sai

| nửa của màn | xếp hạng riêng | vì sao |
|---|---|---|
| **Bảng cảnh báo + xử lý** (theo dõi trạng thái · thấy andon · ack) | **DÙNG ĐƯỢC** | Hợp đồng trạng thái khớp 5/5 rổ (PH-05) · ack chạy thật với ablation 3 mốc và ghi đúng người (D3) · mã hoá 3 lớp không phụ thuộc màu (F5) · bấm trúng máy 5/5, 0 px² chồng lấn (C3, PH-26) · quay lại giữ đúng chỗ đứng (C5.2/C5.3) |
| **Bản đồ 3D** (định vị máy trên sàn) — *lý do duy nhất biện minh cho màn 3D theo chính spec* | **CHƯA DÙNG ĐƯỢC ngoài toà 1** | 7/31 line (22,6 %) vẽ đủ; 24/31 line cho sàn trống với đúng một cây cột đèn (PH-12) |

**Xếp hạng chung: HẠN CHẾ NẶNG.** Không thể xếp DÙNG ĐƯỢC VỚI LƯU Ý khi 78,4 % số máy của người dùng
không hiện trên bản đồ — "lưu ý" là từ dành cho phiền toái, không dành cho việc mất 3/4 lời hứa chính.
Không thể xếp CHƯA DÙNG ĐƯỢC vì **công việc của ca vẫn làm xong được**: mọi máy đều ack được, mọi cảnh báo
đều thấy, mọi trạng thái đều đúng.

**⚠ Nếu tổ chức chỉ mở cho công nhân làm ở toà 1** (71 máy / 7 line), xếp hạng là
**DÙNG ĐƯỢC VỚI LƯU Ý**, và hai lưu ý còn lại chỉ là: mã máy bị cắt ở 1280 (PH-27) và không có số máy của
tầng (PH-06/PH-07).

**Điều kiện lên DÙNG ĐƯỢC VỚI LƯU Ý (toàn phạm vi):**
1. Vá nhánh `toaNha[0]` của PH-12 ⇒ `pham-vi-hong.mjs` cho congnhan **77,4 % → 0 %**; ca C1.4 và C2.4 chuyển SAI → ĐẠT.
2. Vá PH-27 (mã máy ở 1280) ⇒ F4 @1280 `scrollWidth > clientWidth` trong `danh-sach-may` = **0**, và 5 hàng bất kỳ phải **khác nhau về chữ nhìn thấy được**.
3. Đo ca CN-7 (bấm ô trạm khi cảnh trống) — để biết công nhân toà 2-4 có đường vòng hay đang ở ngõ cụt.

**Điều kiện lên DÙNG ĐƯỢC:** thêm CN-4 (đường báo bất thường trên twin, kèm quyết định về `andon/canCreate`
cho vai operator) + PH-06 (nhãn phạm vi phải nói đúng mẫu số) + thời gian mở màn về ≤ 2.500 ms.

## 2.5 Ba đề xuất ưu tiên cho vai CÔNG NHÂN

| # | đề xuất | giá trị / công sức | sửa ở đâu | nghiệm thu |
|---|---|---|---|---|
| **CN-ĐX-1** | **Rút tiền tố mã máy trong `danh-sach-may` — dùng đúng lời giải màn Line đã có** | **CAO / RẤT THẤP** — hàm rút tiền tố chung **đã tồn tại và đang chạy** ở `DaiLine` (ghi chú G12 trong `TwinLine.tsx`); đây là việc gọi lại một hàm, không phải viết mới | Danh sách máy của `TwinVanHanh` (`danh-sach-may`): in tiền tố chung **một lần** ở đầu danh sách (như màn Line in *"Tiền tố: QATD-C-T1-X1-L1-"*) rồi rút nhãn hàng còn phần phân biệt. ⚠ Tính tiền tố trên **tập đang hiển thị**, không trên cả nhà máy — đúng cái bẫy `mayTatCa` vs `mayLine` mà `TwinLine.tsx` đã ghi lại | (a) @1280 trong `danh-sach-may`: `scrollWidth > clientWidth+1` = **0**; (b) **ca đọc-được** (thước mới, vì (a) chưa đủ): lấy 5 hàng bất kỳ, **chữ nhìn thấy được của 5 hàng phải đôi một khác nhau** — hiện tại 14/14 hàng cho cùng một chuỗi `QATD-A-T…`; (c) đối chứng âm: ở 1600 số ô cắt vẫn phải là 0 (không được làm hỏng cái đang đúng) |
| **CN-ĐX-2** | **Vá nhánh `toaNha[0]` (nửa công nhân của PH-12)** | **RẤT CAO / THẤP** — cùng một bản vá với KT-ĐX-1; nếu phải chia nhỏ thì **nhánh toà nên đi trước** cho vai này, vì nó mở 257/328 máy (78,4 %) mà không cần đụng tới logic phạm vi tenant | `client/src/pages/TwinLine.tsx:375` và `client/src/pages/TwinMay.tsx:299`: thay `toaNha[0]` bằng toà **chứa tầng của chính đối tượng đang mở**; id đã có trong `duongVe` (`&toa=63&tang=151` — C5.3 đo được) | (a) `/twin/line/299` (toà 3): số khối máy trong cảnh = **10**, khớp header "Máy 10"; (b) `/twin/may/5139`: **không còn** câu "chưa có chỗ trên bố cục 3D", `khoi-canh-may` = 1 canvas, `loai-may` và `suc-khoe-may` xuất hiện lại; (c) `pham-vi-hong.mjs`: congnhan **77,4 % → 0 %**; (d) đối chứng dương giữ nguyên: line 284 và máy 4977 (toà 1) **vẫn ĐẠT** |
| **CN-ĐX-3** | **Cho xử lý cảnh báo NGAY trên màn nhà máy + thêm một đường "Báo sự cố"** | **CAO / TRUNG BÌNH** — cắt 21 lần đi-về mỗi ca (Ghi chú C) và trả lại việc thường xuyên nhất của vai này | (a) Khi chọn một máy trên `/twin`, đổ ngăn xử lý **tại chỗ** với `nut-ack` (+ `ghiChu` — vá luôn PH-17), **giữ nguyên** nút mở màn Máy cho ai cần ngữ cảnh đầy đủ. Đây là đúng §9.1/§9.2 (*"ngăn xử lý mở ra **ngay cạnh**"*), và **không** vi phạm §12b.4 vì §12b.4 chỉ dành "chọn-rồi-nhảy" cho **lệnh OT**, không cho ack. (b) Thêm hành động `baoSuCo` vào `nganXuLyLogic.ts` nối `andon.quickReport` (đã có sẵn ở server, `andonRouter.ts:239`, báo 1-chạm có AI phân loại) | (a) sau khi chọn máy trên `/twin` **mà không rời màn**: `nut-ack` render và bấm được; lặp lại D3 **3 mốc** (chèn → badge nổi + ack bật → ack → DB đổi `status`/`acknowledgedBy`/`mtta` → xoá → về nguyên); (b) đối chứng quyền: `qatd_giamdoc` (andon chỉ canView) vẫn **0 nút ghi** trên cùng màn; (c) `baoSuCo`: đối chứng hai chiều — vai có `andon/canCreate` thấy nút và tạo được hàng `andon_events` thật (trap xoá); vai không có **không thấy nút** (ẩn, không xám) |

---

# §3. ĐIỂM MẠNH — có bằng chứng, không phải lời khen suông

| điểm mạnh | bằng chứng | vì sao nó đáng kể với hai vai này |
|---|---|---|
| **Hợp đồng trạng thái khớp 5/5 rổ trên 409 máy** (PH-05) | `factoryCommand.overview(QATD-B)` vs SQL độc lập cùng luật tuổi 5 phút: running 282=282 · down 40=40 (từ `error`) · idle 59=59 (từ `stopped`+tươi) · offline 8=8 (`stopped`+hb NULL/cũ) · maintenance 20=20 | Máy dừng / máy lỗi / máy bảo trì / máy mất kết nối **nói một chữ duy nhất** và chữ ấy đúng với CSDL. Đây là nền móng: nếu rổ này lệch thì mọi thứ phía trên đều vô nghĩa. Và **luật 5 phút được chứng minh cả hai chiều** (8 máy hb NULL ra offline; 59 máy cùng `stopped` mà hb tươi ra idle) — đối chứng dương cho chính luật. |
| **Bấm thẳng tâm khối máy: 5/5 đúng id, 39/39 máy bấm được** (C3) | Tâm đo lại ngay trước mỗi cú bấm, đối chiếu raycast | Vai công nhân dùng ngón tay trên màn cảm ứng. Mục tiêu bấm là **cả khối máy**, và 3 đợt sửa lỗi "nhãn cướp click" đã có kết quả: **0 cặp chồng lấn / 0 px² ở 8/8 ca** (PH-26) ở mật độ cao nhất từng đo. |
| **Ack cảnh báo chạy thật, có ablation 3 mốc, ghi đúng danh tính** (D3) | trước 3 badge/"Alarms (20)" → chèn → 4 badge/"Alarms (21)" → ack → `acknowledgedBy=26486` + `mttaSeconds=25` + `audit_logs` → xoá → về nguyên | Vòng nghiệp vụ quan trọng nhất của vai công nhân. Và `mttaSeconds` ghi tự động = chỉ số quản lý thật, không phải khai tay. |
| **Tối ưu đứng vững với biên rất rộng trên dữ liệu 26×** (PH-26) | tầng 68 máy: **5 draw calls** (trần 150, biên **25×**) · **15.026 tam giác** (trần 500.000, biên **33×**) · `__soCanvas`=1 ở **10/10** ca · một khung **bằng** cảnh 12 máy (16,1 vs 16,4 ms) dù gấp 15× tam giác · GPU p50 **62,1 FPS** · idle **46,7 s cuối không một khung** dù 106 bản tin realtime vẫn tới | Dữ liệu tăng 26× mà bộ dựng hình **không nhúc nhích**. Nghĩa là khi vá xong PH-12 và cả 1.108 máy hiện ra đúng, **hiệu năng không phải thứ phải lo**. Và `frameloop: demand` hoạt động thật ⇒ máy trạm ở xưởng không bị đốt CPU khi không ai chạm. |
| **Cổng quyền làm đúng việc, đo hai chiều** | `qatd_giamdoc` (andon chỉ canView) ⇒ **0** nút ghi (D1 ô #4) · `qatd_congnhan` **không** thấy `/control-plane` (D4 ô #13) · Studio chặn congnhan/giamdoc ở **cửa** kèm câu giải thích + lối ra (E1 ô #17/#18) · `sinhTuDong` 403 với kythuat trong khi `xemTruocSinh` 200 cùng cookie (E7) · `qatd_admin` thấy đủ nút = ca dương của chính thước đo | Luật **ẨN-KHÔNG-DISABLE** được thi hành: người không bao giờ có quyền **không thấy nút**, thay vì thấy nút xám rồi đi tìm cách bật. |
| **Ngôn ngữ và chữ nghĩa sạch** (F6) | `en` và `zh`: **0 khoá thô**; bản Trung dịch đủ tới nhãn 3D (*故障/停机*). 4 nhóm chuỗi còn dấu tiếng Việt đều là **nội dung CSDL** (tên nhà máy/toà/tầng/tiêu đề andon) — đúng, không được dịch. Đối chứng dương: `vi` 342 dấu vs `en/zh` 155 ⇒ bộ đếm biết phân biệt | Xưởng đa quốc gia dùng được ngay. |
| **Màn Line đã tự giải xong bài toán mã dài** | Ảnh `C-C1-qatd_congnhan-line284.png` / `F-F5-line-217-1600.png`: in *"Tiền tố: QATD-C-T1-X1-L1-"* **một lần** rồi rút nhãn còn `M01..M08`, 12 nhãn so le hai tầng độ cao **không cái nào đè cái nào** | Lời giải cho PH-27 **đã nằm sẵn trong sản phẩm**, ở màn bên cạnh. Công sức để áp sang danh sách máy là thấp nhất trong toàn bộ danh sách đề xuất. |

---

# §4. PHÂN LOẠI — lỗi sản phẩm · thiết kế cố ý · nợ cũ · lỗi thiết bị đo

Không quy oan, và cũng không tha thứ nhầm chỗ.

| loại | mục | ghi chú |
|---|---|---|
| **LỖI SẢN PHẨM (chặn nghiệp vụ)** | **PH-12** `factories[0]` + `toaNha[0]` (CAO) · **PH-14** Studio khoá ở tầng 1 toà 1 (CAO) · **PH-23** `commandCenter.hierarchy` không lọc tenant (CAO, bảo mật, ngoài twin) · **PH-24** 48/48 lượt > 2.500 ms (TRUNG BÌNH, hệ quả của PH-23) · **PH-27** mã máy bị cắt ở 1280 (TRUNG BÌNH) · **PH-06** nhãn phạm vi nói tầng, số nói nhà máy (TRUNG BÌNH) · **PH-15** Studio gác bằng `canEdit`, bỏ `canCreate` (TRUNG BÌNH) | PH-12 và PH-14 **cùng một gốc `[0]`**. PH-24 tan theo PH-23. |
| **MÃ CÓ, CHƯA NỐI CHỖ GỌI** (lớp G5 — không phải hỏng, là **chưa giao hàng**) | **PH-16** "Mở chức năng" cấp nhà máy/line: `loaiDich` 0 chỗ gọi · **PH-17** hành động `ghiChu` 0 UI ở cả 5 vai · **PH-28** `xepHangSucKhoe()` 0 chỗ gọi (§11.5 bắt buộc) | Ba mục này có **luật + quyền + test đơn vị** đầy đủ và **không có đường tới tay người dùng**. Rẻ để giao. |
| **THIẾT KẾ CỐ Ý — và tôi đồng ý giữ** | **§12b.4** không đặt lệnh OT start/stop/reset lên cảnh 3D, thay bằng **chọn-rồi-nhảy** (nút "Mở chức năng") — ba lý do đo được: cảnh 3D là mặt khám phá · hai mutation ghi của `/twin` chưa lọc tenant (L-1) · *"đủ tươi để NHÌN khác đủ tươi để RA LỆNH"*. Đo được: kỹ thuật thấy **Control plane**, công nhân **không** (D4 ô #13) — đúng cả hai chiều | **PH-07** (`dem-may` đếm theo nhà máy) cũng là cố ý và có tài liệu (`cayVanHanh.ts:58-61`) ⇒ không chấm SAI mới; nhưng với 7 tầng/toà thì hệ quả đã đổi, nên tôi vẫn xếp nó vào "cần vòng sau". |
| **NỢ CÓ SẴN — KHÔNG quy cho đợt này** (BRIEF §4) | QĐ-30 index production · G149 `domains.ts` 8 ô · `twin.replay` STATE_METRICS · 899 khoá i18n mồ côi ngoài twin · `twin-dot31-may` A5 đỏ · 41 cặp nhãn ∩ khối · `/factory-command` 42 máy chồng 1 điểm · `check:tests` 27 lỗi TS · `npm test` ~97 tệp đỏ · 24+48 chuỗi ≤12 px · `hienDoTuoi` mã chết · **PH-01** khoá API trong test client (ngoài twin) | — |
| **LỖI THIẾT BỊ ĐO (của QA, không của sản phẩm)** | **PH-08** brief đòi hai phán quyết cho cùng một con số ⇒ 14/15 ô SAI là đo nhầm thước, không phải lỗi sản phẩm · **PH-09** nhịp làm tươi 120 s vượt ngưỡng "tươi" 60 s ⇒ `dem-tuoi`/`dem-cu` đảo · **PH-20** bảng kỳ vọng §2 ghi sai quyền "ẩn tạm" của quanly (cần `canCreate`, cấp `canEdit`) ⇒ sản phẩm ẩn nút là ĐÚNG · **PH-25** Playwright mặc định chạy SwiftShader (CPU), không GPU ⇒ mọi số FPS 10 đợt trước là số CPU · **PH-04** heartbeat hết hạn ⇒ toàn cảnh xám nếu không làm tươi | ★ **PH-25 tuy là lỗi thiết bị đo, lại hé ra một câu nghiệp vụ thật**: cấu hình "không GPU" **chính là** cấu hình máy trạm rẻ ở xưởng. Xem CN-10 — cần đo `chrome://gpu` trên một máy xưởng thật. |
| **LỖ ĐO CỦA SẢN PHẨM** (sản phẩm không tự phơi bày đủ để đo được) | **PH-28 HỎNG**: thiếu `window.__demVien` ⇒ **màu vòng viền sức khoẻ chưa từng đo được ở bất kỳ đợt QA nào** (có `__demNhan`, `__demBadge`, không có bộ đếm cho vòng; cấm đọc pixel — G34) · **PH-29**: Studio thiếu bộ đếm khối nên "khung 3D gần trống" không chấm được | Đây là món **sản phẩm phải trả** để QA đo được, không phải việc QA tự xoay xở. |

---

# §5. CHƯA ĐO — danh sách phép đo còn thiếu cho hai vai này

| # | câu chưa trả lời được | phép đo cần | vì sao đáng làm |
|---|---|---|---|
| 1 | Ô trạm trên dải màn Line có mở được máy khi cảnh 3D trống không? (CN-7) | Bằng `qatd_congnhan`: mở `/twin/line/299` (toà 3), bấm ô `S05`, ghi URL đích. Đối chứng dương: cùng thao tác trên `/twin/line/284` (toà 1) | Quyết định công nhân toà 2-4 có **đường vòng** hay đang ở **ngõ cụt** — hai kết cục rất khác nhau cho xếp hạng |
| 2 | Danh sách "gán kỹ thuật viên" có tên thật nào không? (KT-6) | Mở form tạo phiếu bằng `qatd_kythuat`, đọc `option` của `chon-ky-thuat-vien`, đếm; lưu 1 phiếu có `assignedTo` ≠ null rồi đọc lại hàng DB (trap xoá) | "Gán KTV" là 1 trong 3 hành động của nhóm "Tạo việc" (§9.2); nếu danh sách rỗng thì đó là ô trống có nhãn đẹp |
| 3 | Bấm một mục cảnh báo thuộc **QATD-B** trong dải "Alarms (35)" dẫn tới đâu? | Bằng `qatd_kythuat` trên `/twin?nm=38`, bấm một andon của máy QATD-B trong `dai-canh-bao`, ghi màn đích và `data-ly-do` | Mô hình PH-12 dự đoán ngõ cụt; nếu đúng thì **dải cảnh báo đang mời người dùng đi vào tường** — nặng hơn cả C5.1 |
| 4 | Ngăn xử lý trên `/twin` có nút nào sau khi chọn máy **mà không rời màn**? (Ghi chú A/C) | Bấm một **hàng trong `danh-sach-may`** (không bấm khối 3D), đếm nút trong `ngan-xu-ly`, ghi chữ đọc được | Quyết định CN-ĐX-3 là "giao mới" hay "sửa nhỏ" |
| 5 | Nút bị tắt có **nhìn ra được là đã tắt** không? | Chụp `nut-ack` ở hai trạng thái (0 cảnh báo vs có cảnh báo chưa ack) trên cùng máy, so **màu pixel** và độ tương phản | `[đọc từ ảnh]` Trên `DE-D1-kythuat.png` (ack **tắt**, `tat=1`) và `DE-D3-co-may.png` (ack **bật**), nút trông **gần như cùng một màu xanh ngọc**. Thô nói `opacity:0.5 + pointer-events:none`, nhưng **mắt tôi không phân biệt được**. Nếu đúng, công nhân sẽ bấm vào một nút chết và tưởng hệ thống treo. Ghi chú thô của lô DE cũng nêu: nút tắt **không có `title`/`aria-describedby`** nối tới lý do |
| 6 | Máy trạm ở xưởng có GPU/WebGL không? (CN-10) | Mở `chrome://gpu` trên **một máy trạm xưởng thật**, đọc dòng WebGL renderer | Chênh **26,1 vs 62,1 FPS** (PH-25) nằm đúng ở ranh giới ngưỡng 30 FPS |
| 7 | "Failure risk 0 %" và "Health 50 % · critical" — số nào đúng? (Ghi chú B) | Gọi `sucKhoeMay(4197)` và nguồn `failure risk` của cockpit cùng lúc, đối chiếu định nghĩa hai chỉ số | Hai con số rủi ro ngược nhau trên cùng một màn, cách nhau 300 px; chưa ô nào chấm |
| 8 | Vai operator có nên có `andon/canCreate` không? (CN-4) | Câu hỏi **quyết định của chủ dự án**, không phải phép đo. Kèm: đo `OperatorHome`/`/andon` có trong menu vai operator không và có lọc phạm vi không | Nếu không, **không operator nào bật được andon** — gần như chắc chắn là lỗi cấu hình kịch bản (giống PH-20) |

---

# §6. SÁU ĐỀ XUẤT — xếp theo tỉ lệ GIÁ TRỊ / CÔNG SỨC

| hạng | đề xuất | vai hưởng lợi | giá trị | công sức | nghiệm thu (rút gọn — chi tiết ở §1.5 / §2.5) |
|---|---|---|---|---|---|
| **1** | **Bỏ `factories[0]` và `toaNha[0]`, lấy id từ ngữ cảnh đang xem** (KT-ĐX-1 + CN-ĐX-2 — **cùng một bản vá**) | **cả hai** (+ quản lý + giám đốc) | **RẤT CAO** — mở 695/780 máy cho kỹ thuật, 257/328 cho công nhân; đây là *kết cục gốc* của cả màn | **THẤP** — 4 dòng; id đúng **đã có sẵn** trong `duongVe` của chính trang (C5.1) | `pham-vi-hong.mjs` mọi vai về **0 %**; C1.1/C1.4/C2.1/C2.4 SAI→ĐẠT; **C4b vẫn CHẶN-ĐÚNG**; ablation: giamdoc/admin mở được máy 4977, kythuat **vẫn** NOT_FOUND |
| **2** | **Rút tiền tố mã máy trong `danh-sach-may`** (CN-ĐX-1) | **công nhân** (+ kỹ thuật ở 1280) | **CAO** — trả lại khả năng phân biệt cho danh sách ở độ phân giải xưởng | **RẤT THẤP** — hàm đã tồn tại và đang chạy ở màn Line | @1280 ô cắt = **0**; **5 hàng bất kỳ khác nhau về chữ nhìn thấy**; @1600 không hồi quy |
| **3** | **Lọc tenant cho `commandCenter.hierarchy`** | **cả hai** (+ toàn hệ) | **RẤT CAO** — vừa bịt rò danh mục tài sản xuyên tenant (vai **0 gán** đang đọc trọn cây 1.151 máy của 5 nhà máy), vừa trả lại **~1,9 s mỗi lần mở màn** cho mọi vai không-admin | **THẤP** — khuôn có sẵn ngay bên dưới: `kpiSummary` (`:60-80`) đã thu hẹp theo `ctx.user` đúng cách | `kiem-hierarchy.mjs`: 5 vai ra **5 md5 khác nhau**, `qatd_khonggan` ra **cây rỗng**, `qatd_khongquyen` vẫn 403; F1c lặp lại: kythuat p50 về gần admin (~1,2–1,3 s) và F1 xuống dưới 2.500 ms |
| **4** | **Studio: ô chọn Toà + Tầng, và gác nút TẠO bằng `canCreate`** (KT-ĐX-2) | **kỹ thuật** (+ quản lý) | **CAO** — mở 88 % máy cho đường BUILD; hiện đường BUILD là phần yếu nhất của sản phẩm | **TRUNG BÌNH** — bộ chọn đã tồn tại ở `/twin`, là việc nối dây | dải "N placed · M awaiting" đổi theo tầng chọn; xếp 1 máy ở **toà 3 tầng 2** rồi xoá (trap); `qatd_quanly` **không còn** thấy "Generate"/"Create building" mà **vẫn còn** gizmo |
| **5** | **Xử lý cảnh báo tại chỗ trên màn nhà máy + đường "Báo sự cố"** (CN-ĐX-3, gộp PH-17) | **công nhân** (+ kỹ thuật) | **CAO** — cắt ~21 lần đi-về mỗi ca; trả lại việc thường xuyên nhất của người vận hành; đúng §9.1/§9.2 và **không** vi phạm §12b.4 (chọn-rồi-nhảy chỉ dành cho lệnh OT) | **TRUNG BÌNH** — `andon.quickReport` đã có ở server (`andonRouter.ts:239`) | lặp D3 **3 mốc** ngay trên `/twin` không rời màn; giamdoc vẫn **0 nút ghi**; `baoSuCo` đối chứng hai chiều (có `canCreate` ⇒ tạo hàng thật + trap xoá; không có ⇒ **ẩn**, không xám) |
| **6** | **Bảng 2D xếp hạng sức khoẻ + bộ đếm `__demVien`** (KT-ĐX-3) | **kỹ thuật** (+ quản lý) | **CAO** — trả lời câu hỏi số 1 của vai kỹ thuật (*"đụng máy nào trước"*), và **lần đầu làm cho lớp phủ màu đo được** sau 11 đợt QA | **TRUNG BÌNH** — `xepHangSucKhoe()` đã viết xong và có ca kiểm đơn vị, chỉ thiếu chỗ gọi | bảng khớp `sucKhoeMay` API (tầng 88: `nguy_kich 124 · canh 133 · theo_doi 62 · khoe 52`); **ablation**: sửa 1 hàng health ⇒ hạng + màu vòng đổi, hoàn nguyên ⇒ trở lại; `__demVien` trả **319 vòng, 3 màu** |

**Ghi chú thứ tự:** hạng 1 và 3 nên đi **cùng một đợt**. Hạng 1 làm cho 89,6 %/77,4 % số line hiện ra đúng —
và hạng 3 là thứ giữ cho việc ấy không kéo theo một màn chậm 2,6 giây. Hạng 2 rẻ đến mức có thể đi kèm bất kỳ
đợt nào. **PH-26 đã chứng minh hiệu năng dựng hình còn biên 25–33×**, nên không có lý do kỹ thuật nào để hoãn
việc cho tất cả máy hiện ra.

---

# §7. MƯỜI ẢNH TÔI TỰ READ — thấy gì

| # | ảnh | tôi thấy gì (mô tả thật) | nói lên điều gì |
|---|---|---|---|
| 1 | `C-C2-qatd_kythuat-may4568.png` | Màn gần như trống, giữa màn một biểu tượng khay rỗng và dòng **"Không mở được máy #4568"** + *"Đối tượng này không thuộc phạm vi đang xem (hoặc không còn tồn tại). Hãy đổi nhà máy/tầng rồi mở lại."* + nút "Nhà máy". Góc trái dưới: **"Kỹ sư thiết bị A+B (QA)"**. Chuông đỏ góc phải: **35** cảnh báo | **Bức ảnh gây tổn hại nhất trong đợt.** Người dùng tên là "Kỹ sư thiết bị **A+B**" và màn nói máy của **B** không thuộc phạm vi của anh ta. Cùng lúc PH-19 chứng minh server cho anh ta **tạo phiếu** cho chính máy đó (HTTP 200) |
| 2 | `C-C1-qatd_kythuat-line249.png` | Breadcrumb "Nhà máy › **Chuyền 249**", góc phải **"Máy 0 · Trạm 0 · WIP 0"**, thân màn: *"Chuyền này chưa có máy nào trên bố cục — Chuyền có thể chưa được xếp chỗ trong Twin Studio, hoặc thuộc một nhà máy khác."* Không canvas | DB có **15 máy** trên chuyền này. Màn không nói "tôi chưa tải xong" cũng không nói "cái này không phải của bạn" — nó khẳng định một điều **sai** ("chưa có máy nào"), kèm hai phỏng đoán gộp làm một (PH-13) |
| 3 | `DE-D1-kythuat.png` | Màn Máy đầy đủ của **ICT-01**: khối máy trắng giữa cảnh với **vòng đế ĐỎ rõ**, chip *"ICT · Health 50 % · critical · Updated 1 min ago"*, 1 nhãn 3D. Ngăn phải: AOI **OK 5 / NG 1 / NTF 0 / YIELD 83.33 %**, **ALARMS (0) "No open alarms."**, nút **Acknowledge** (xanh ngọc) + **Shelve**, khối **CREATE WORK** với ô tiêu đề đã điền sẵn *"Troubleshoot QATD-A-T1-X1-L1-M01"*, **Priority Level 3**, **Assign technician: Unassigned**, Save/Cancel. OPEN MODULE: Full cockpit · Machine health. Dưới cảnh: ô **"Failure risk 0 %"** và **"OEE —"** | Lát cắt **hoạt động đúng** của vai kỹ thuật, và nó đẹp: phiếu **tự điền mã máy**, ưu tiên mặc định, chỗ gán KTV. ⚠ Hai quan sát mới: (a) nút Acknowledge **tắt** mà trông y hệt nút bật ở ảnh #6 (§5 mục 5); (b) **"Failure risk 0 %"** đứng cách **"Health 50 % critical"** 300 px (§5 mục 7) |
| 4 | `DE-E3-kythuat-studio.png` | Studio: đầu màn *"3D Factory — Design"*, góc phải ô **Factory: Công ty A**, tab *Add building / Choose drawing file / **Design*** và chữ **"Building: 4"**. Dải sức khoẻ: *"45 machines placed · **326 awaiting placement** · 45 dimensions not measured"*. Cây trái liệt kê **đủ 8 xưởng** (QATD-A-T1-X1 … T4-X2). Dưới đó **"UNPLACED MACHINES (326)"**. Thư viện asset (buồng kiểm quang, bàn test, máy gắp đặt, lò nhiệt…). **Khung 3D: một mặt sàn lưới nghiêng ở rất xa, 45 máy co thành một vệt chấm mờ**; minimap góc phải CÓ chấm | Xác nhận PH-14 và PH-29 cùng lúc. ★ Điều đắt nhất: **chỉ có MỘT ô chọn (Factory)** — không có ô Toà, không có ô Tầng — trong khi chính màn in "Building: 4" và cây trái liệt kê đủ 8 xưởng. Màn **biết** có 4 toà và **vẫn** chỉ cho sửa một tầng. Camera cũng không khung hình lấy nội dung của chính nó |
| 5 | `DE-D3-co-twin.png` | `/twin` của công nhân, QATD-C toà 1 tầng 1. Bộ chọn: **Công ty C ▾ · Toà 1 ▾ · Tầng 1 ▾**. Panel trái: *"Machines 328 · Fresh data 322 · Stale data 0 · Unknown 6"*, **Alarms (21)** với bộ lọc All/Stop 12/Call 0/Warning 9 và danh sách hôm nay (đứng đầu là `QATD-DE-RAISED-M4977` do ablation chèn). Danh sách máy có ô **"Filter by name or code…"**, các hàng **Down/Stopped** xếp trên cùng kèm tuổi **28s**. Metrics nổi: 328 machines · Running 228 · Down 25 · Maintenance 19 · Offline 6 · **Running rate 69.5 %**. Cảnh 3D: hai hàng máy với **vòng đế đỏ và hổ phách**, 8 nhãn trắng + 2 badge ◆, chip *"abnormal names only · 37 other names hidden"*. Thanh tua thời gian dưới đáy (Live · ×1 ×5 ×20) | Đây là **màn tốt nhất của cả đợt** và là lý do vai công nhân không bị chấm CHƯA DÙNG ĐƯỢC. Một màn hình duy nhất trả lời: có bao nhiêu máy, bao nhiêu đang hỏng, cảnh báo nào, dữ liệu còn tươi không, máy nào ở đâu. ⚠ Và ngăn phải chỉ nói *"Select a machine… to **open its 3D machine screen**"* — **0 nút xử lý tại chỗ** (Ghi chú A/C) |
| 6 | `DE-D3-co-may.png` | Màn Máy **FEEDER-01** (QATD-C): khối máy với **vòng đế HỔ PHÁCH**, hai nhãn (một nhãn đỏ có tam giác cảnh báo **▲**, một nhãn trạng thái *"Running"*), chip *"FEEDER · Health 86 % · watch · Updated 46s ago"*. Ngăn phải: AOI OK 6/NG 0/Yield 100 %, **ALARMS (1)** với mục `QATD-DE-RAISED-M…` mang huy hiệu đỏ **"Unacknowledged"**, nút **Acknowledge** sáng. OPEN MODULE chỉ **2 nút** (Full cockpit · Machine health) | Ca dương của ablation D3, và là đối chứng quyền đẹp: công nhân thấy **2** đích mở chức năng, kỹ thuật thấy **4** (có Control plane) — đúng bảng quyền, ẩn hẳn chứ không xám |
| 7 | `DE-D3-co-sau-ack.png` | Cùng màn sau khi bấm: mục cảnh báo đổi từ "Unacknowledged" (đỏ) sang **"Acknowledged"** (xám), toast góc phải dưới **"Alarm acknowledged"**, chuông góc trên hiện **badge 2** | Ba mốc của ablation khép lại bằng chữ người dùng đọc được, không chỉ bằng hàng DB. ⚠ Nút Acknowledge vẫn **trông sáng y như trước** dù thô nói nó đã tắt (§5 mục 5) |
| 8 | `C-C1-qatd_congnhan-line284.png` | Màn Line (toà 1): **8 khối máy xếp hàng ngang**, mỗi khối một nhãn `M01 · Đang chạy` … `M08 · Chờ`, một **cột đèn andon hổ phách** cắm trên M05 kèm nhãn mã đầy đủ. Panel chỉ số: *"8 máy · Đang chạy 6 · Tỉ lệ chạy 75 % · Máy có andon 1"*. Đáy: **DÀI CHUYỀN 8 trạm · Tiền tố: QATD-C-T1-X1-L1- · Nhịp 12.0s · WIP 47**, mỗi ô trạm `S01..S08` ghi "1 máy" + WIP | Màn Line **làm đúng mọi thứ**: nhãn ngắn không đè nhau, cột đèn andon chỉ đúng máy, và ★ **in tiền tố MỘT LẦN rồi rút nhãn** — đây chính là lời giải cho PH-27, đã chạy sẵn ở màn bên cạnh |
| 9 | `C-C1-qatd_congnhan-line299.png` | Cùng màn Line, **toà 3**: header vẫn *"Máy 10 · Trạm 10 · WIP 56"*, panel chỉ số vẫn đủ (*"10 máy · Đang chạy 8 · Bảo trì 1 · Tỉ lệ chạy 80 %"*), dải trạm dưới đáy vẫn đủ **S01…S10** với WIP từng trạm. **Nhưng giữa màn: một cây cột duy nhất — thân vàng, chân xanh — đứng trên hư không. Không một khối máy nào. Không một nhãn nào** | Đặt cạnh ảnh #8, đây là **bằng chứng thị giác mạnh nhất cho PH-12**. Và nó tệ hơn một màn trống: cột đèn andon **có** vẽ, nên cảnh trông như đã tải xong. Người vận hành sẽ kết luận "chuyền này không có máy" trong khi có 10 máy đang chạy |
| 10 | `F-F5-twin-tang-dong-68may-1280.png` | Cùng màn `/twin` ở **1280×720**, tầng đông nhất (68 máy). Cảnh 3D, nhãn và vòng viền vẫn **sạch, không chồng**. **Nhưng danh sách máy bên trái: bốn hàng liên tiếp đều hiện đúng một chuỗi `QATD-A-T…`**, chỉ phân biệt được nhờ cột "Down/Stopped" và "13s". Thanh công cụ rút gọn còn icon | PH-27 nhìn tận mắt. Ở độ phân giải của màn công nghiệp phổ thông, **bảng danh sách máy mất chức năng của nó**. Đồng thời ảnh cho thấy phần 3D **không** hỏng ở 1280 — vấn đề nằm ở bố cục danh sách 2D, nên bản vá khu trú và rẻ |

---

## Phụ lục — số dùng trong tài liệu này và nguồn của chúng

| số | nguồn |
|---|---|
| kythuat 780 máy / 67 line · VẼ ĐỦ 85 · CẢNH RỖNG 286 · TỪ CHỐI 409 · 89,6 % line hỏng | PH-12 bảng bán kính (`pham-vi-hong.mjs`, chỉ SELECT); tỉ lệ máy (10,9 % / 36,7 % / 52,4 %) do tôi chia từ đúng bốn số ấy |
| congnhan 328 máy / 31 line · VẼ ĐỦ 71 · CẢNH RỖNG 257 · 77,4 % line hỏng | như trên; tỉ lệ 21,6 % / 78,4 % do tôi chia |
| Studio 45 placed / 326 awaiting = 88 % ngoài tầm (QATD-A) | PH-14 + BANG-DE ô #22; **Studio với QATD-B: CHƯA ĐO** |
| p50 2.615 ms · 48/48 vượt 2.500 ms · admin 1.182 vs kythuat 3.154 · `hierarchy` 1.674 ms | PH-24 / BANG-F §2. **Thời gian riêng của `qatd_congnhan`: CHƯA ĐO** — suy luận: cùng cổng quyền non-admin nên cùng hình dạng |
| 5 draw calls · 15.026 tam giác · 62,1 FPS GPU · 26,1 FPS CPU · 0 px² chồng lấn | PH-26 / PH-25 / BANG-F §3 |
| ack: `acknowledgedBy=26486` · `mttaSeconds=25` · `audit_logs` 5778 | BANG-DE ô #11 |
| phiếu bảo trì `WO-4197-1789438419698-RG4T` (UI) · `WO-4568-…` (API, 200) | BANG-DE ô #9 và #10 · PH-19 |
| sức khoẻ tầng 88: `nguy_kich 124 · canh 133 · theo_doi 62 · khoe 52` ⇒ 319 vòng | BANG-F ca F5 |
| `andon.raise` / `quickReport` cần `andon/canCreate` | `[suy luận từ mã]` `server/routers/andonRouter.ts:199` và `:239` — tôi tự đọc |
| ô trạm màn Line → máy đầu của trạm | `[suy luận từ mã]` `client/src/pages/TwinLine.tsx:843-850` — tôi tự đọc, **CHƯA ĐO trên màn** |
