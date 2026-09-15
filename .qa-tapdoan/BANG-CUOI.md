# NGHIỆM-THU CUỐI — Task 15 + Task 16 (đợt E)

**Ngày đo:** 2026-09-15 23:31 → 2026-09-16 00:35 (giờ máy) ·
**Bản đo:** `http://localhost:3064`, PID 20964, bundle client `index-r3rg0upv.js`, dựng từ HEAD `0f3abd7e`
(kiểm lại giữa đợt: cổng 3064 vẫn PID 20964, bundle vẫn `index-r3rg0upv.js` — không ai dựng lại giữa chừng).
**GPU thật:** `ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)` —
launch kèm `--use-angle=default --enable-gpu --ignore-gpu-blocklist`, **1 worker, tuần tự**.
**Dữ liệu:** QATD-A=41 (371 máy) · QATD-B=42 (409) · QATD-C=43 (328) = **1.108 máy**, 12 toà × 7 tầng.
Tầng đông nhất: QATD-A-T2 cấp 1 (`tang_id` 172, `toa_id` 66) = **68 máy**.
**Không sửa một dòng mã sản phẩm nào.** Mọi tệp mới nằm trong `.qa-tapdoan/`.

Thô: `.qa-tapdoan/tho/CUOI/*.json` (30 tệp) · Ảnh: `.qa-tapdoan/anh/CUOI-*.png` (44 ảnh).

---

## Bảng phán quyết

| ca | kỳ vọng | số đo | phán quyết | vì sao |
|---|---|---|---|---|
| **P1** | `/twin` vai `qatd_congnhan` @**1280×720**: tiền tố in **một lần**, 5 hàng đọc **khác nhau** ở đuôi | 1 khối `danh-sach-may-tien-to` = "Prefix: **QATD-C-**"; 5 hàng đầu: `T1-X1-L2-M07`, `T1-X1-L4-M08`, `T1-X2-L2-M11`, `T2-X1-L2-M01`, `T2-X1-L2-M04` → 5/5 riêng; `data-ma` vẫn giữ mã đầy đủ 19 ký tự | **ĐẠT** | tiền tố rút khỏi hàng, in một lần; mã đầy đủ không mất (ở `data-ma` + `title`) |
| **P2** | mỗi dòng cảnh báo mang **mã máy** + **tên nhà máy** | 15/15 dòng có `data-ma-may` **và** `data-nha-may`, và cả hai chuỗi **hiện trong chữ người dùng đọc**: "▲ Ùn tắc tại trạm 07 (QATD) · **QATD-A-T1-X2-L2-M07 · Công ty A**" | **ĐẠT** | danh tính máy + công ty có trên từng dòng, đọc được bằng mắt |
| **P2b** | vai giám đốc 3 công ty ⇒ dải **phân rã được theo công ty**? | `andon.active` trả **55 dòng của CẢ BA công ty** (A 15 · B 20 · C 20); đầu dải in "Alarms (**55**) · Counted across your whole account scope"; nhưng **chỉ 15 dòng được vẽ, cả 15 của Công ty A** (đã cuộn hết ô cuộn) | **SAI** | ⚠ **khuyết tật MỚI đo được**: con số ở đầu dải đếm cả ba công ty, danh sách bên dưới chỉ có một — 40 dòng biến mất **không một dòng nào kêu**. Lặp lại ở vai kỹ thuật: đầu dải "Today (**35**)" mà chỉ 15 hàng. Xem §Phát hiện mới. |
| **P3** | tầng **không có máy** ⇒ mẫu số KPI = **0**, nhãn phạm vi khớp | Tầng rỗng (QATD-A-T1 cấp 3, `tang_id` 167, DB 0 máy): `data-mau-so=**0**`, chữ "**— machines**", nhãn "**Công ty A · Toà 1 · Tầng 3**", "OEE measured on **0/0** machines". Đối chứng dương: tầng 165 (DB 45 máy) ⇒ `data-mau-so=**45**`, "45 machines" | **ĐẠT** | PH-06 đóng: mẫu số theo LƯỢT NẠP, không phải theo cả nhà máy (371) |
| **P4** | `?pv=tapdoan` vai giám đốc: bảng KPI **không che** banner; giao nhau = 0 | Hai dòng banner đọc **nguyên văn**: ① "326 machines are outside this load (other buildings were not queried) — whether they are placed is not known yet" ② "Showing data for ONE factory (3 factories in the system). The Corporate scope cannot load several factories at once yet — use the Factory box to switch." · `bang-kpi-noi` rect y=266 · `dai-hop-nhat-chi-tiet` đáy y=258 · **giao nhau = 0 px²** với từng banner, với dải mở (0) và với dải thu (0) · `data-chua-cho-dai` = **51** (= đúng chiều cao 51 px của phần chi tiết) | **ĐẠT** | PH-31 đóng: sản phẩm nói thật về hạn chế của mình và **không còn tự che câu đó** |
| **P5** | công nhân chọn máy ⇒ **thấy** nút báo sự cố; giám đốc ⇒ **không** | công nhân: `nut-bao-su-co` = **0** · giám đốc: **0** · **Nguyên nhân đo được trong CSDL**: `qatd_congnhan` có `andon` V=1 **C=0** E=1; `qatd_giamdoc` V=1 C=0 E=0. Nút gác bằng `hasPermission("andon","canCreate")` (`nganXuLyLogic.ts:102`) | **SAI** | ⚠ **tiền đề của đề bài sai, không phải mã sai**: KHÔNG tài khoản `qatd_*` nào có `andon.canCreate`. Chiều âm vẫn đúng (giám đốc chỉ-xem không thấy cả "Add note" lẫn "Report issue"). Chiều dương đo ở P5b. |
| **P5b** | ablation: bật tạm `andon.canCreate` cho công nhân ⇒ nút hiện, bấm gửi ⇒ hàng thật | mở cổng ⇒ `nut-bao-su-co` = **1, bấm được**; form khai đúng đích "The alarm will be attached to machine **QATD-C-T1-X1-L1-M01**"; gửi ⇒ `andon_events` **62 → 63**, đúng **1** hàng (id 318) `machineId=6085` nhà máy **QATD-C**, `raisedBySystem=false`, `raisedBy=26919` | **ĐẠT** | đường ghi của Task 9 chạy thật, đúng máy, đúng người, đúng phạm vi |
| **P6** | kỹ thuật ghi một ghi chú ⇒ hàng mới `andon_notes`, `andon_events` **không đổi** | `nut-ghi-chu` hiện + bấm được; form khai đích "Note on alarm: **Ùn tắc tại trạm 07 (QATD)**"; lưu ⇒ `andon_notes` **0 → 1** (id 2, `andonId`=**262**, tác giả **qatd_kythuat**); **hàng `andon_events` duy nhất của máy ấy (id 262) giống hệt từng cột** (status/message/resolvedAt/acknowledgedAt/state/reason/title); tổng `andon_events` 62 → **62**; màn in "A note does NOT close the alarm - it only records the work in progress"; ghi chú hiện lại ngay trên màn | **ĐẠT** | ghi chú ghi vào đúng chỗ và **không** đụng trạng thái cảnh báo |
| **P7** | `bang-suc-khoe` hiện ra, số theo hạng khớp `__demVien.theoHang` | bảng HIỆN, đọc được: "critical **124** warning **133** watch **62** stale **0** healthy **52** not measured **0**" (tổng **371**); `__demVien` = `{tong: 38, theoHang:{nguy_kich:11, canh:16, theo_doi:11, het_han:0}}` ⇒ **không khớp** | **SAI** | phép so của đề bài **không thể đúng theo THIẾT KẾ** — xem P7b |
| **P7b** | phân xử: hai số có đúng với **mẫu số của chính nó** không? | tính lại từ `twinCanh.sucKhoeMay` (371 lời khai) bằng đúng ngưỡng của sản phẩm ⇒ `{124,133,62,0,52,0}` **khớp từng hạng** với bảng · khối trên cảnh 45 = số `twin_dat_cho` của tầng (**45**) · `__demVien.tong` **38** = đúng 45 trừ 7 máy hạng `khoe` (4 hạng có viền: 11+16+11+0) | **ĐẠT** | Bảng đếm **theo NHÀ MÁY** (màn in sẵn "(counted across the whole factory)"), `__demVien` đếm **vòng TRÊN CẢNH** — hai mẫu số khác nhau, cả hai đều ĐÚNG. `TwinVanHanh.tsx:1338-1343` khai tường minh điều này. Phép so "bảng = `__demVien`" là **N/A theo thiết kế**. |
| **P8** | nhà máy 84 tầng ⇒ `banner-tang-vuot-tran` hiện, nêu đủ 3 số | trên dữ liệu đang có: **không dựng được ca**. Toà nhiều tầng nhất = **7 tầng** (12/12 toà đều 7); `/twin` chỉ hỏi tầng của **MỘT toà** (`twinCanh.chiTietToaNha`), trần một lượt nạp = **50** ⇒ `biCat` luôn 0 ⇒ phần tử banner **không có trong DOM**, không đọc được ba con số | **HỎNG** | thiếu dữ kiện có **TÊN**: *một TOÀ có hơn 50 tầng*. (Không phải lỗi sản phẩm — banner ẩn là đúng khi không cắt gì.) |
| **P8b** | dựng ca rồi đo: một toà **84 tầng** | tạo hàng tạm `QATD-TMP-P8` (1 toà + 84 tầng) trong QATD-A ⇒ banner **HIỆN**, nguyên văn: "**This building has 84 floors but one load can only request 50 — 34 floors were NOT loaded, and machines on them are missing from the scene.**" · `data-tong-tang`=**84** `data-tran-tang`=**50** `data-tang-bi-cat`=**34**, cả ba số có trong chữ | **ĐẠT** | Task 17c lỗi một đóng: `.slice(0,50)` thôi cắt im lặng. Hàng tạm đã xoá (84 tầng + 1 toà); đếm 13 toà/85 tầng trước = sau. |
| **N1** | công nhân mở máy của QATD-B ⇒ vẫn bị từ chối | `may-khong-mo-duoc` HIỆN, chữ: "**Cannot open machine #5676** — This item is not in the scope you are viewing (or no longer exists)…", toast "Could not find machine."; **không lộ tên máy của tenant khác**. Đối chứng dương: cùng vai mở máy QATD-C ⇒ mở được, `ten-may` = "FEEDER-01" | **CHẶN-ĐÚNG** | hàng rào giữ; và nó **chỉ** chặn thứ ngoài phạm vi |
| **N2** | `andon.raise` / `quickReport` nhắm máy QATD-B ⇒ **NOT_FOUND**, đếm không tăng | cả bốn lời gọi bị chặn nhưng mã là **FORBIDDEN (403)** "Bạn không có quyền create cho module andon", **không phải** NOT_FOUND; `andon_events` **62 → 62**; 0 dấu vết `QATD-TMP` | **SAI** | ⚠ **chỉ SAI ở MÃ LỖI, không SAI ở hàng rào**: cổng QUYỀN (`canCreate`) đứng TRƯỚC cổng PHẠM VI, mà `qatd_congnhan` không có `canCreate` ⇒ lời gọi chết ở cổng thứ nhất, chưa chạm cổng phạm vi. Phải đo bằng tài khoản CÓ `canCreate` — xem N2b. |
| **N2b** | bật tạm `canCreate` rồi đo **đúng cổng phạm vi** | `raise(machineId B)` → **NOT_FOUND** · `quickReport(machineId B)` → **NOT_FOUND** · `quickReport(machineCode B)` → **NOT_FOUND** · `raise(stationId B)` → **NOT_FOUND** · `raise(lineId B)` → **NOT_FOUND** · **5 lời gọi, `andon_events` 62 → 62** · đối chứng **dương**: cùng lời gọi nhắm máy QATD-C ⇒ **HTTP 200**, đếm 62 → 63 | **CHẶN-ĐÚNG** | ★★★ **lỗ bảo mật vừa vá ĐÃ ĐÓNG trên cả ba trục (machine/station/line) và cả đường `machineCode`**, và cổng **không vá quá tay** (trong phạm vi vẫn ghi được) |
| **N3** | `ghiChu` / `danhSachGhiChu` ngoài phạm vi ⇒ chặn | kỹ thuật (A+B) trên cảnh báo **297 của QATD-C**: `ghiChu` → **NOT_FOUND** · `danhSachGhiChu` → **NOT_FOUND** và `data` = `null` (không trả nội dung) · `ghiChu(id=2 000 000 000)` → NOT_FOUND · đối chứng dương: `danhSachGhiChu` trên cảnh báo QATD-A ⇒ **200**, mảng 0 dòng · `andon_notes` **0 → 0** | **CHẶN-ĐÚNG** | cả đường ghi lẫn đường ĐỌC đều có cổng; id ngoài phạm vi ⇒ "không tồn tại", không rò nội dung xử lý sự cố của tenant khác |
| **N4** | `qatd_khongquyen` gọi `factory.list` ⇒ nay bị chặn | **FORBIDDEN (403)**, `data` không phải mảng, **0 nhà máy**. Đối chứng dương: `qatd_kythuat` vẫn đọc **đúng 2** nhà máy `["QATD-A","QATD-B"]` | **CHẶN-ĐÚNG** | Task 13 đóng; trước đây vai này nhận 1 nhà máy |
| **N5** | `qatd_quanly` vào `/twin-studio` ⇒ không thấy nút sinh và nút tạo toà | quản lý: `nut-mo-sinh` **0**, 0 nút mang chữ generate/create/add building/tạo/sinh. **Nhưng đối chứng dương của tôi SAI**: tôi kỳ vọng `qatd_kythuat` thấy nút sinh — kỹ thuật cũng = 0 | **SAI** | ⚠ **lỗi ở THIẾT BỊ ĐO, không ở sản phẩm**: `quyen.sinh = laAdmin` (`quyenXuong.ts:117`), kỹ thuật không phải admin nên 0 là ĐÚNG. Đo lại đúng cổng ở N5b. |
| **N5b** | hai cổng khác nhau, ba vai | quản lý: sinh **0**, tab tạo toà **0**, form `dung-nha-xuong` **0**, `nut-tao` **0** · kỹ thuật (có `settings_factory.canCreate`, **không** admin): sinh **0**, tab tạo toà **1** · admin: sinh **1**, tab tạo toà **1** | **CHẶN-ĐÚNG** | PH-15 đóng: **bốn cổng bốn cờ**, không còn một cờ gác tất cả. Chiều âm và chiều dương đều đo được, mỗi cổng một đối chứng đúng vai. |
| **N6** | `qatd_kythuat` gọi `twinCanh.sinhTuDong` ⇒ vẫn **403** | kỹ thuật → **FORBIDDEN 403** (cả lời gọi có tham số lẫn lời gọi rỗng); quản lý → FORBIDDEN 403; `twin_dat_cho` **2.420 → 2.420** | **CHẶN-ĐÚNG** | `adminProcedure` giữ; không hàng nào bị ghi đè |
| **H1** | 4 màn × 3 lượt × **context mới**, `qatd_kythuat` @1600×900 | **12/12 lượt tới màn**, **p50 = 2.045 ms**, p90 2.079 ms · `twin` p50 2.060 · `line` p50 2.026 · `may` p50 2.054 · `studio` p50 2.045 · **1/12 lượt vượt 2.500 ms** (may lượt 3 = 2.548) | **ĐẠT** | vòng 1 **2.615** (48/48 vượt 2.500) → vòng 2 **2.137** → **nay 2.045**; tỉ lệ vượt 2.500 từ **100 %** xuống **8,3 %**. Vẫn cao hơn mốc admin 1.087 ms. |
| **H2** | `__soCanvas`=1 mọi màn · draw calls ≤150 · tam giác ≤500.000 · nhãn DOM ≤30 | `__soCanvas` = **1** ở **12/12** lượt (và DOM đúng 1 `<canvas>`) · draw calls **max 6** · tam giác **max 15.026** (cảnh 68 khối) · nhãn DOM **max 11** | **ĐẠT** | cách trần rất xa: calls 6/150, tam giác 15 k/500 k, nhãn 11/30 |
| **H3** | chiều cao THẬT của `khoi-tong-quan` ở 2 bề rộng + số hàng thật | **@1280×720 = 85,00 px** · **@1600×900 = 68,00 px** (hằng trong lưới **41**, ước chưa đo **69**) | **ĐẠT** | ★ **hằng không chỉ lạc — nó KHÔNG PHẢI MỘT HẰNG**: khối cao **85** ở 1280 và **68** ở 1600 vì `hang-tong-quan` xuống 2 dòng khi hẹp (49 px vs 32 px). `bang-suc-khoe` = **25 px** ở cả hai. Xem §Số cho bước 4b. |
| **H3b** | đếm ĐÚNG số hàng (H3 đếm nhầm trong lòng thẻ tiêu đề) | @1280: dải 218,45 px (ô cuộn 107,45) · **tồn đọng 0 hàng** · hôm nay 15 (2 thấy được) · `danh-sach-may` **3/12** hàng thấy được · tiền tố **17 px** — @1600: dải **328** px (chạm trần) · **tồn đọng 0 hàng** · hôm nay 15 (4 thấy được) · `danh-sach-may` **7/16** · tiền tố 17 px | **ĐẠT** | **Nhóm tồn đọng KHÔNG TỒN TẠI trên dữ liệu này**: cả 55 andon QATD đều `raisedAt = 2026-09-15T00:35:39`, **0 cái quá 24 h** (7 cái quá 24 h là của `SIM-FAC`, ngoài phạm vi QATD). ⇒ dự đoán "tồn đọng 3 → 2" **không kiểm được**; dự đoán "danh sách máy 9 → 8 @1600" đo ra **7**. |
| **T1** | chặn `luuHangLoat` trả 500 ⇒ hộp thoại **vẫn mở**, tầng **chưa đổi**, số thay đổi **giữ**, có lỗi đọc được | 1 lượt gọi bị chặn · hộp thoại `co=1` **vẫn mở** · `chon-tang` vẫn **172** (định đổi sang 173) · `dem-chua-luu` **1 → 1** · màn in "**Save failed: ép lỗi để đo**" · **0/68 hàng `twin_dat_cho` đổi** | **ĐẠT** | nhánh ghi hỏng **không** mất dữ liệu và **không** lặng lẽ đổi tầng |
| **T2** | buffer **nhiều hàng, hai loại** (lật khoá + dời vị trí) × ba lối | buffer **6 hàng** = 1 lật khoá (`QATD-A-T2-X1-L4-M05`) + 5 dời vị trí (căn trái 6 máy chọn qua cây). **Lối ở lại**: hộp thoại hiện, tầng vẫn 172, đếm giữ **6**, CSDL 0 hàng đổi. **Lối bỏ**: tầng đổi 172→173, đếm về **0**, CSDL 0 hàng đổi. **Lối lưu rồi chuyển**: tầng đổi, đếm về 0, **6/6 hàng được ghi** (`viTriXMm` ×5, `daKhoa` ×1, `nguon` ×6) và **cả 6 mang `tangId` = 172 (tầng CŨ)** | **ĐẠT** | đủ cả hai loại thay đổi, đủ ba lối, và lối lưu ghi **đúng tầng cũ** — không có hàng nào rơi sang tầng mới. 68 hàng đã khôi phục nguyên trạng. |
| **T3** | hai chỉ số rủi ro ngược nhau: khớp trong DB? lệch trong DB? một nguồn rỗng? | xem §T3 bên dưới | **ĐẠT** (đo xong, **hai** kết cục) | **KẾT CỤC 2 + KẾT CỤC 3 cùng xảy ra** |

**Tổng: 27 ô · ĐẠT 15 · CHẶN-ĐÚNG 6 · SAI 5 · HỎNG 1 · N/A 0.**

**Ô không có phán quyết: 0**

(Bảng sinh máy từ tệp thô: `.qa-tapdoan/tho/CUOI/_bang-tho.md`. Ở đó sáu ô đối chứng âm ghi `ĐẠT` — cùng nghĩa
với `CHẶN-ĐÚNG` trong bảng này: hàng rào giữ nguyên. Không ô nào đổi phán quyết giữa hai bảng.)

---

## §T3 — hai chỉ số rủi ro ngược nhau (PH-36), đã đo

**Câu truy vấn của kế hoạch, chạy nguyên văn** (20 máy `suc_khoe` thấp nhất): máy `QATD-B-T4-X2-L4-M10`
sức khoẻ **40** → `canh_bao_pdm` **1**; `QATD-A-T2-X1-L1-M08` sức khoẻ **40** → **0**; `QATD-B-T1-X1-L4-M07`
sức khoẻ **40** → **0**; `QATD-C-T4-X2-L3-M03` sức khoẻ **40** → **0**… — cùng một điểm sức khoẻ cho ra
cả 0 lẫn 1 cảnh báo PdM.

**Bảng chéo (1.108 máy QATD), tỉ lệ máy CÓ cảnh báo PdM đang mở theo hạng sức khoẻ:**

| hạng sức khoẻ | số máy | có PdM mở | tỉ lệ |
|---|---|---|---|
| nguy kịch (<60) | 370 | 198 | **53,5 %** |
| cảnh (<80) | 381 | 189 | **49,6 %** |
| theo dõi (<90) | 185 | 92 | **49,7 %** |
| khoẻ (≥90) | 172 | 96 | **55,8 %** |

⇒ **KẾT CỤC 2 — hai nguồn LỆCH NGAY TRONG CSDL.** Tỉ lệ gần như **không đổi** theo hạng (biên độ 6,2 điểm,
và máy *khoẻ nhất* lại có tỉ lệ *cao nhất*) ⇒ bộ sinh đặt `healthScore` và `predictive_alerts` bằng **hai
nguồn ngẫu nhiên độc lập**. **Đúng giả thuyết của chủ dự án.** Việc vá: sửa `.qa-tapdoan/sinh-tap-doan.mjs`
cho hai đại lượng cùng một nguồn, rồi sinh lại và đo lại. **Không phải lỗi mã sản phẩm.**

**Nhưng con số thật sự in ra màn KHÔNG phải `predictive_alerts`** — nó là `computeFailureRisk`
(`predictiveMaintenance.getMachineRisk`). Đo trên ba máy nguy kịch:

| máy | DB `healthScore` | DB PdM mở | chip trên màn | ô "Failure risk" | `getMachineRisk` |
|---|---|---|---|---|---|
| `QATD-A-T1-X1-L4-M06` | 40 | 0 | "Health **40 %** · **critical**" | **0** | `failureRisk 0 · urgency LOW · dataPoints 1 · rulMethod weibull` |
| `QATD-A-T1-X2-L2-M04` | 40 | 1 | "Health **40 %** · **critical**" | **0** | `failureRisk 0 · urgency LOW · dataPoints 1 · rulMethod insufficient_data` — "Only 0 real failure observation(s) (need 5); cold start" |
| `QATD-A-T2-X1-L1-M08` | 40 | 0 | "Health **40 %** · **critical**" | **0** | `failureRisk 0 · urgency LOW · dataPoints 1 · rulMethod insufficient_data` |

**Đầu vào thật của `computeFailureRisk`** (`machine_health_history` của 1.108 máy QATD):
13.296 hàng, trong đó **12.188 hàng do chính dịch vụ PdM ghi** (`calculationMethod = 'PREDICTIVE_WS4'`, bị hàm
tự loại) và **1.108 hàng đo thật** — tức **đúng 1 điểm cho mỗi máy** (`diemMoiMay`: `n=1 → 1.108 máy`).

⇒ **KẾT CỤC 3 — nguồn "rủi ro hỏng" RỖNG VỀ THỰC CHẤT, và màn hiện GIÁ TRỊ MẶC ĐỊNH thay vì nói không biết.**
Với 1 điểm dữ liệu, hàm trả `failureRisk: 0` + `maintenanceUrgency: "LOW"` cho **mọi** máy, và cockpit in
"**0 %**" — một con số trông như một phép đo, cạnh một chip nói "critical" cách đó ~300 px. **Đây là lỗi
RIÊNG, nằm ở mã, không phải ở bộ sinh** (`rulNote` đã tự khai "cold start" nhưng chữ ấy không tới màn).
**Đề nghị mở task vá riêng** với hai việc: (a) khi `dataPoints` dưới ngưỡng thì ô ấy phải nói *"chưa đủ dữ
liệu"* chứ không in `0 %`; (b) bộ sinh phải ghi chuỗi điểm sức khoẻ (≥2 điểm/máy trong 14 ngày) để đường PdM
có gì mà tính.

---

## §Số cho bước 4b (chiều cao khối tổng quan) — CHỈ BÁO SỐ, KHÔNG SỬA HẰNG

| đại lượng | @1280×720 | @1600×900 | hằng trong `boCucPanelTrai.unit.test.ts` |
|---|---|---|---|
| `khoi-tong-quan` **đo thật** | **85,00 px** | **68,00 px** | `KHOI_TONG_QUAN = 41` (ước chưa đo: 69) |
| ├ `hang-tong-quan` | 49 px (xuống 2 dòng) | 32 px (1 dòng) | — |
| └ `bang-suc-khoe` (Task 12) | 25 px | 25 px | — |
| `panel-trai` | 489 px | 669 px | `CAO_NGOAI_PANEL = 231` ⇒ **khớp** (720−489 = 231; 900−669 = 231) |
| `dai-canh-bao` | 218,45 px | **328,00 px** | `TRAN_DAI_PX = 328` ⇒ **chạm trần đúng như mô hình** |
| `danh-sach-may` | 156,05 px | 243,50 px | — |
| hàng cảnh báo **tồn đọng** | **0** | **0** | mô hình dự đoán 3 → 2 |
| hàng cảnh báo **hôm nay** (vẽ / thấy được) | 15 / **2** | 15 / **4** | — |
| hàng `danh-sach-may` (vẽ / **thấy được**) | 12 / **3** | 16 / **7** | mô hình dự đoán 9 → **8** |
| `danh-sach-may-tien-to` (bản vá P1) | **17 px** | **17 px** | **không có hằng nào cho dòng này** |
| chiều cao một hàng máy | 24 px | 24 px | `HANG_MAY = 24` ⇒ khớp |

**Ba điều chủ đợt cần biết trước khi quyết:**

1. **`KHOI_TONG_QUAN` không phải một hằng.** Nó là **85 @1280** và **68 @1600** — chênh 17 px vì dòng số
   tổng quan xuống hai dòng ở panel hẹp. Mô hình hiện dùng **một** số cho mọi bề rộng, nên dù có thay 41
   bằng 68 thì @1280 vẫn sai 17 px. Ước "≈69" của agent Task 12 **đúng ở 1600 và sai ở 1280**.
2. **Mô hình thiếu một số hạng: dòng tiền tố 17 px** mà bản vá P1 thêm vào đầu `danh-sach-may`.
   `KHUNG_DANH_SACH = 44` không bao gồm nó. Đó là lý do @1600 đo ra **7** hàng thấy được chứ không phải 8:
   (243,5 − 44 − 17) ÷ 24 = 7,6 ⇒ 7 hàng đủ.
3. **Dự đoán "tồn đọng 3 → 2" KHÔNG KIỂM ĐƯỢC trên dữ liệu này** và đó không phải lỗi bố cục: cả 55 andon
   QATD sinh cùng một mốc `2026-09-15T00:35:39`, **0 cái quá 24 h**, nên nhóm "TỒN ĐỌNG >24H" không bao giờ
   render (7 andon quá 24 h duy nhất thuộc `SIM-FAC`, ngoài phạm vi). Muốn kiểm tiêu chí "≥3 hàng tồn đọng"
   của Đợt 57 thì bộ sinh phải rải `raisedAt` lùi quá 24 h cho một phần andon.

`CAO_NGOAI_PANEL`, `TRAN_DAI_PX`, `HANG_MAY` **đo lại vẫn đúng** — chỉ `KHOI_TONG_QUAN` và phần
`KHUNG_DANH_SACH` là lệch.

---

## §Phát hiện mới trong đợt nghiệm thu (chưa có trong `PHAT-HIEN.md`)

**PH-38 · Dải cảnh báo: con số ở đầu dải đếm CẢ phạm vi, danh sách bên dưới chỉ có MỘT nhà máy — 40 dòng
biến mất không một dòng nào kêu.**
Đo được (`tho/CUOI/P2b.json`): vai `qatd_giamdoc` (3 công ty) — `andon.active` trả **55** dòng của cả ba
(A 15 · B 20 · C 20); đầu dải in "**Alarms (55)** · Counted across your whole account scope"; cuộn hết ô cuộn
chỉ thấy **15** dòng, **cả 15 của Công ty A**. Lặp ở vai `qatd_kythuat` (A+B): đầu dải "Today (**35**)",
render **15**. Đây **không** phải lỗi của bản vá P2 (mỗi dòng render ra đều mang mã máy + tên công ty đúng);
nó là mặt thứ hai của hạn chế "một lượt nạp = một nhà máy" mà `banner-ha-cap` đã khai — **nhưng banner nói về
CẢNH 3D, không nói gì về dải cảnh báo**, nên ở dải, con số và danh sách mâu thuẫn nhau mà không có câu giải
thích nào. Cùng lớp lỗi với PH-06 (mẫu số không khớp phạm vi). Đề nghị: hoặc dải lọc luôn con số theo đúng
tập đang hiện, hoặc thêm một dòng "40 cảnh báo ở nhà máy khác chưa nạp".

**PH-39 · Ô "Failure risk" in `0 %` khi chưa đủ dữ liệu để tính.** Xem §T3 kết cục 3.

**PH-40 · Bộ sinh đặt `healthScore` và `predictive_alerts` độc lập.** Xem §T3 kết cục 2 (giả thuyết chủ dự
án được xác nhận bằng số).

**PH-41 (thiết bị đo, của tôi) · Bấm lên CẢNH khi đang ĐA CHỌN không rút tập chọn về 1.** Đo được
(`tho/CUOI/_probe-t2.log`): sau khi shift+click 3 node cây, một cú bấm vào tâm khối máy khác trên cảnh
**không** làm `bang-thuoc-tinh` đổi sang máy vừa bấm (`cong-tac-khoa` vắng). `XuongThietKe.tsx:1088` khai
`setChon([khoaNode(...)])` nên ý định là thay thế; nghi gizmo của tập chọn nuốt cú bấm. **Chưa phân xử được
là lỗi sản phẩm hay giới hạn của phép bấm tổng hợp** — ghi lại để đợt sau đo bằng người thật.

---

## §Dọn dẹp — đếm trước/sau

| bảng | trước đợt | sau đợt | hàng tạm đã tạo | hàng tạm còn lại |
|---|---|---|---|---|
| `andon_events` | 62 | **62** | 2 (P5b id 318 · N2b 1 hàng đối chứng dương) | **0** |
| `andon_notes` | 0 | **0** | 1 (P6 id 2) | **0** |
| `twin_toa_nha` | 13 | **13** | 1 (`QATD-TMP-P8`) | **0** |
| `twin_tang` | 85 | **85** | 84 | **0** |
| `twin_dat_cho` | 2.420 | **2.420** | 0 (T1/T2 **sửa** 68 hàng rồi khôi phục: `conKhac = 0` cả hai ca) | **0** |
| `users` `qatd_*` | 7 | **7** | 0 | — |
| `permissions` `qatd_congnhan.andon.canCreate` | `false` | **`false`** | bật tạm 2 lần (P5b, N2b) | đã trả về `false`, kiểm lại bằng SELECT |

Đếm cuối cùng (chạy sau ca cuối): `{"andon_events":62,"andon_notes":0,"twin_dat_cho":2420,"twin_toa_nha":13,
"twin_tang":85,"users_qatd":7,"andon_tmp":0,"note_tmp":0,"toa_tmp":0,"canCreate_congnhan":false}`.
**Không hàng tạm nào sót lại.** Nhịp làm tươi heartbeat và máy chủ 3064 **không bị đụng tới**.
