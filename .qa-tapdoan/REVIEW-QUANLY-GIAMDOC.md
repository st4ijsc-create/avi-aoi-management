# ĐÁNH GIÁ NGHIỆP VỤ MÀN 3D TWIN — HAI VAI: QUẢN LÝ (quản đốc xưởng) & GIÁM ĐỐC (ban điều hành tập đoàn)

QA lần 11 · HEAD `a147fc35` · dữ liệu kịch bản tập đoàn QATD (3 công ty · 12 toà · 84 tầng · 24 xưởng · 98 line · 1.108 máy).
Đây là **đánh giá nghiệp vụ**, không đo lại. Mọi số đều dẫn về `.qa-tapdoan/PHAT-HIEN.md` (PH-01..PH-29), bốn bảng đo (`BANG-AB/C/DE/F.md`), mã nguồn `tệp:dòng`, hoặc ảnh PNG tôi **tự đọc** (danh sách ở §C).
Điều gì chưa có phép đo thì ghi thẳng **CHƯA ĐO** kèm phép đo cần làm.

---

# PHẦN I — VAI QUẢN LÝ (quản đốc xưởng, `qatd_quanly`, phụ trách QATD-A: 371 máy · 4 toà × 7 tầng · 8 xưởng · 32 line)

## I.1 — Nhiệm vụ nghiệp vụ thật của vai

| # | Việc | Nguồn |
|---|---|---|
| QL-1 | **Nắm tình hình đầu ca**: ngay lúc này xưởng/tầng mình phụ trách có bao nhiêu máy chạy · dừng · lỗi · bảo trì · mất kết nối | Spec §9.1 khối "TỔNG QUAN" + §9.5 ba trạng thái tươi |
| QL-2 | **Thấy andon chưa ai nhận, biết nó ở máy nào trên sàn, và xác nhận (ack)** để đội biết "đã có người cầm" | Spec §9.2 nhóm "Xử lý cảnh báo" (ack/shelve/ghi chú) |
| QL-3 | **Biến sự cố thành việc**: tạo phiếu bảo trì từ chính máy đó, gán KTV, đặt mức ưu tiên | Spec §9.2 nhóm "Tạo việc" (`canCreate` module `machine_monitoring`) |
| QL-4 | **Đi xuống cấp chuyền tìm nút thắt**: chuyền nào đang tắc, trạm nào WIP cao, nhịp có đều không | Spec §10C.3 (đường dòng chảy · ống WIP theo trạm · dải Line 2D) |
| QL-5 | **So sánh giữa các tầng/toà trong công ty mình** để dồn người về nơi tệ nhất | *Suy luận nghiệp vụ của tôi.* Spec chỉ nói 4 cấp phạm vi (§10C.2), không nói thẳng việc so sánh ngang cấp |
| QL-6 | **Bàn giao ca bằng một đường link** tới đúng chỗ đang có vấn đề, người ca sau mở ra thấy y hệt | Spec §9.4 deep-link hai chiều ("anh xem chỗ này giúp em" thành một đường link) |
| QL-7 | **Cập nhật mặt bằng** khi dời máy / thêm máy / đổi bố trí xưởng | Spec QĐ-18 (`/twin-studio` là nơi thiết kế, "chỉ những người có quyền mới làm được"); vai này CÓ quyền vào |
| QL-8 | **Mở màn chuyên sâu mang theo ngữ cảnh** (OEE của chuyền vừa chọn, tổng quan của nhà máy vừa chọn) | Spec §9.3 bảng điều hướng, dòng "Chuyền" và "Nhà máy" |

## I.2 — Bảng: việc × làm được trên sản phẩm hiện tại?

| Việc | Mức | Bằng chứng | Hậu quả nghiệp vụ nếu không làm được |
|---|---|---|---|
| **QL-1a** Tình hình **cấp nhà máy** | **LÀM ĐƯỢC** | PH-02 (371 máy = DB, đúng 7/7 vai) · PH-05 (hợp đồng trạng thái khớp 5/5 rổ trên 409 máy) · ảnh `DE-D1-quanly-twin.png`: "Metrics 371 machines · Running 261 · Down 25 · Maintenance 20 · Offline 7 · Running rate 70.4%" + hàng "Machines 371 · Fresh data 0 · Stale data 364 · Unknown 7" | — |
| **QL-1b** Tình hình **một tầng / một xưởng** | **KHÔNG LÀM ĐƯỢC** | PH-06 (nhãn phạm vi in tới cấp Tầng, mẫu số là cả nhà máy) · PH-07 (`dem-may` cố ý đếm theo nhà máy, `cayVanHanh.ts:58-61`) · `BANG-AB.md` B6: đổi toà 2→3→4, cảnh 3D đổi đúng (68/40/41) mà `dem-may` **đứng yên 371** · ảnh `AB-B4-qatd_giamdoc-tang3-trong.png`: tầng 3 **không một khối nào** trên canvas mà bảng vẫn in "371 machines · Running 261" | Quản đốc **không có một con số nào** cho chính khu vực mình phụ trách. Muốn biết "tầng tôi có mấy máy dừng" phải **đếm khối đỏ bằng mắt** — mà 67/73 nhãn đang bị giấu theo chính sách declutter (PH-26). Đây là câu hỏi số 1 của vai, và nó không có câu trả lời bằng số |
| **QL-2a** Ack cảnh báo | **LÀM ĐƯỢC** | `BANG-DE.md` ô #2: `nut-ack` render cho quanly (có `andon` V+E) · ảnh `DE-D1-quanly.png`: nút "Acknowledge" hiện trong ngăn phải · vòng đời ack đo đủ ba mốc ở ô #11 (UI + SQL + `audit_logs`, `acknowledgedBy` ghi đúng người) | — |
| **QL-2b** **Biết cảnh báo đó ở máy nào** | **MỘT PHẦN** | Tôi tự đọc mã: `DaiCanhBao.tsx:137` chỉ in `{c.tieuDe}`; `daiCanhBaoLogic.ts:126-150` (`CanhBaoDai`) **có** `machineId/lineId/stationId/workshopId` nhưng **không trường nào được render**. Ảnh `DE-D1-quanly-twin.png`: 15 dòng cảnh báo, **mọi dòng đọc y hệt nhau** — "Ùn tắc tại trạm 07 (QATD)" / "…trạm 08 (QATD)" / "…trạm 06 (QATD)" lặp lại, không mã máy, không chuyền | Danh sách cảnh báo **không phân biệt được các dòng với nhau**. Quản đốc đọc 15 dòng và không biết phải đi tới đâu; phải bấm từng dòng để dò. Đây là lỗi *trực quan* chứ không phải lỗi dữ liệu — dữ liệu đã có sẵn trong đối tượng |
| **QL-3** Tạo phiếu / gán KTV | **KHÔNG LÀM ĐƯỢC** (với bộ quyền đang đo) | `BANG-DE.md` ô #2: `nut-tao-phieu` **không render**; bảng quyền đo từ DB cho thấy quanly có `machine_status` chỉ V. Ảnh `DE-D1-quanly.png`: ngăn phải chỉ có "Acknowledge" + 5 link "OPEN MODULE", 0 nút tạo việc | Quản đốc chỉ nói được "tôi đã thấy", **không giao được việc cho ai**. Mọi phiếu phải nhờ kỹ thuật tạo hộ ⇒ mất mốc thời gian và mất người chịu trách nhiệm. ⚠ **Phân loại**: đây là **cấu hình quyền của kịch bản đo**, không phải lỗi sản phẩm (sản phẩm ẩn nút đúng luật ẨN-KHÔNG-DISABLE — cùng lớp với PH-20). **CHƯA ĐO**: vai `supervisor` mặc định của sản phẩm có `machine_status/canCreate` hay không — cần đọc bảng `role_permission_defaults` (hoặc bộ seed) và đối chiếu |
| **QL-4** Mở chuyền tìm nút thắt | **KHÔNG LÀM ĐƯỢC** cho ~78 % chuyền | PH-12 ★★★ (`TwinLine.tsx:355` `factories[0]`, `:375` `toaNha[0]`) · `BANG-C.md` §3 bảng bán kính: quanly **7/32 line vẽ đủ · 25/32 "đầu đúng · cảnh rỗng" ⇒ 78,1 % hỏng** · ảnh `C-C1-qatd_giamdoc-line284.png` (cùng lớp lỗi): header "Chuyền 284 · Máy 0 · Trạm 0 · WIP 0", canvas **không tồn tại**, chỉ còn câu "Chuyền này chưa có máy nào trên bố cục" | 3 trong 4 toà của công ty A **không mở được màn chuyền**. Ống WIP theo trạm và dải Line 2D (spec §10C.3) — thứ duy nhất trả lời "trạm nào đang nghẽn" — chỉ dùng được ở 7/32 chuyền. Tệ hơn: màn **đổ lỗi cho dữ liệu** ("chưa được xếp chỗ trong Twin Studio") trong khi DB có đủ chỗ đặt (PH-12 triệu chứng 2, máy 5139 có đúng 1 hàng `twin_dat_cho`) ⇒ quản đốc sẽ đi sửa nhầm thứ |
| **QL-5** So sánh tầng/toà | **KHÔNG LÀM ĐƯỢC** | Hệ quả trực tiếp của QL-1b: không có số theo tầng thì không có gì để so. `BANG-AB.md` B2/B3/B6 | Không có cơ sở để quyết định dồn người/ca. Phải mở 8 lần (4 toà × 2 tầng xưởng) rồi tự đếm khối bằng mắt |
| **QL-6** Bàn giao ca bằng link | **MỘT PHẦN** | Link cấp tầng **ĐẠT**: PH-11 (`/twin?nm=39` dựng đúng QATD-B, không phải nhà máy đầu); URL tự ghi `?do=1&cam=73.88,25.93,…` (`BANG-AB.md` A1). **Link cấp máy/chuyền KHÔNG đáng tin**: PH-12 bảng ablation — **cùng một URL máy 4977**, `qatd_congnhan` mở được đầy đủ, `qatd_giamdoc` và `qatd_admin` bị từ chối | Một đường link giao ca cho **hai kết quả khác nhau tuỳ người mở**. Quản đốc gửi link, người nhận thấy màn trắng và tưởng máy đã được gỡ khỏi bố cục. Đây là hậu quả nghiệp vụ nặng nhất của PH-12 vì nó phá chính tính năng spec §9.4 dựng ra để phục vụ |
| **QL-7** Cập nhật mặt bằng | **KHÔNG LÀM ĐƯỢC** ngoài tầng 1 toà 1 | PH-14 ★★ (`TwinStudio.tsx:106` `toaNhaDau=[0]`, `:125` `tang=[0]`, `grep setToaNha\|setTang\|chon-toa-nha\|chon-tang` = **0**) · `BANG-DE.md` ô #22: "Building: 4" nhưng chỉ MỘT bộ chọn (Factory); dải khai "45 machines placed · **326 awaiting placement**" ⇒ **326/371 = 88 % máy ngoài tầm với** | Việc bảo trì bố cục — thứ giữ cho twin không "trôi" khỏi nhà máy thật — chỉ làm được cho 12 % nhà máy. Phần còn lại sẽ **vĩnh viễn** ở trạng thái "chưa xếp chỗ", và chính trạng thái đó là nguyên nhân người dùng nhìn thấy ở QL-4 |
| **QL-7b** Bị từ chối **sau khi** đã bấm | **KHÔNG LÀM ĐƯỢC** (và mất lòng tin) | PH-15 (`XuongThietKe.tsx:173-174` gác mọi công cụ ghi bằng MỘT cờ `canEdit`; `grep canCreate` trong `thiet-ke/*.tsx` + `TwinStudio.tsx` = **0 dòng**) · ảnh `DE-E6-quanly.png`: quanly đi hết 3 bước "Add building", nút **"Create building" sáng teal, bật hẳn**, không huy hiệu chỉ-xem; server sẽ trả 403 (`twinCanh.dungNhaXuong` = `quyenThietKe("canCreate")`) | Người dùng làm hết một quy trình 3 bước rồi mới bị từ chối. Trái thẳng luật ẨN-KHÔNG-DISABLE mà chính sản phẩm tuân thủ rất tốt ở chỗ khác (ô #13 `BANG-DE`: `/control-plane` bị ẩn TRƯỚC khi công nhân bấm) |
| **QL-8** Mở màn chuyên sâu mang ngữ cảnh | **MỘT PHẦN** | PH-16 (`NganXuLy.tsx:148/170` `loaiDich` mặc định `"machine"`; tôi tự grep `loaiDich` trong `client/src` + `server` trừ test ⇒ **chỉ 3 dòng, đều trong `NganXuLy.tsx`, không chỗ nào truyền giá trị khác**) · `BANG-DE.md` ô #12: quanly bấm cả 5 nút ⇒ 5/5 đích cấp MÁY, 0/2 đích mong đợi. **Điểm công bằng**: `/corporate-dashboard` và `/oee-dashboard` **vẫn vào được qua thanh menu** (`navigation.tsx:256-264`, `requiredPermission: "dashboard_corporate"` — vai này có) | Không mất hẳn tính năng, nhưng **mất ngữ cảnh**: vào qua menu thì không mang `?factoryId=`/`?lineId=`, người dùng phải chọn lại từ đầu. Mã cho `line`/`workshop`/`factory` đã viết xong ở `nganXuLyLogic.ts:276-289` và **không ai gọi** — đúng lớp "có mã + có test + không nối chỗ gọi" |
| **QL-8b** Đích "điều khiển" duy nhất | **MỘT PHẦN** | Ảnh `DE-D4-quanly.png` — bấm nút thứ 5 ra `/control-plane?machineId=4197`: màn tự khai *"This is a preview feature. It may require setup or an enabled flag before it shows live data"* và *"Read-only projection. Commands (PackML / orchestration) go through the internal HITL dispatcher, not from this page"* | Nút duy nhất nghe như "điều khiển" dẫn tới một màn chỉ-đọc, đang ở dạng preview. Trung thực (khai rõ ngay đầu màn) nhưng nghiệp vụ thì rỗng |

## I.3 — Ba câu hỏi vai này sẽ hỏi màn hình

**Q-QL1 — "Tầng 2 toà 3 của tôi đang có bao nhiêu máy dừng lỗi?"**
→ **KHÔNG trả lời được bằng số.** Chọn được đúng tầng (PH-11, bộ chọn 4 toà × 7 tầng hoạt động — lần đầu đo được ở đợt này) và cảnh 3D vẽ **đúng** số máy của tầng (PH-08: 13/13 tầng khớp `mayTheoTang` 100 %). Nhưng mọi ô đếm trên màn — `dem-may`, "Running 261", "Down 25" — là số **cả nhà máy** (PH-06, PH-07). Người dùng phải đếm khối đỏ trên canvas bằng mắt. Màn **trả lời được "có máy đang lỗi ở đây"** (vòng viền đỏ/hổ phách hiện rõ, tôi thấy trên ảnh `F-F5-twin-tang-dong-68may-1600.png`), **không trả lời được "bao nhiêu"**.

**Q-QL2 — "Chuyền L3 xưởng X2 toà T2 đang tắc ở trạm nào?"**
→ **KHÔNG.** Với quanly, 25/32 chuyền rơi vào mức "đầu đúng · cảnh rỗng" (`BANG-C.md` §3): header in đúng "Máy 10 · Trạm 10" mà canvas 0 khối, nên ống WIP và dải Line 2D không có gì để đọc. Chỉ 7/32 chuyền (đúng toà T1) trả lời được. Gốc: PH-12.

**Q-QL3 — "Dòng cảnh báo thứ 3 trong danh sách là máy nào, ở đâu?"**
→ **KHÔNG trực tiếp.** Dòng chỉ in tiêu đề andon (`DaiCanhBao.tsx:137`), và ở ảnh `DE-D1-quanly-twin.png` 15 dòng đọc gần như y hệt nhau. Bấm dòng thì gọi `chonMay(c.machineId)` (`TwinVanHanh.tsx:3062`) — tức chọn máy **trong cảnh đang xem**.
→ **CHƯA ĐO**: kết cục khi bấm một dòng cảnh báo của máy **không nằm trong tầng đang xem** (với 371 máy nhưng cảnh chỉ 45, đây là đa số trường hợp). Phép đo cần: đăng nhập quanly, mở `/twin` tầng 81, bấm dòng cảnh báo có `machineId` thuộc tầng 88, đọc `?chon=` trên URL + nội dung `ngan-xu-ly` + `?tang=`. Kỳ vọng đúng: màn tự chuyển tầng; kỳ vọng xấu: không gì xảy ra (chế độ hỏng câm).

## I.4 — Xếp hạng cho vai QUẢN LÝ

### **HẠN CHẾ NẶNG**

**Lý do một câu:** Màn đọc đúng và trung thực ở **cấp nhà máy**, nhưng ba việc hằng ngày của quản đốc — đọc số theo tầng/xưởng mình phụ trách (QL-1b), mở chuyền tìm nút thắt (QL-4), bảo trì bố cục (QL-7) — đều vỡ ngay khi ra khỏi tầng 1 toà 1, tức trên **78–88 % phạm vi được giao**.

**Điều kiện lên DÙNG ĐƯỢC VỚI LƯU Ý:** vá PH-12 (bỏ `factories[0]`/`toaNha[0]` ở `TwinLine.tsx`/`TwinMay.tsx`) **và** PH-06/PH-07 (một con số theo đúng phạm vi đang chọn). Hai việc này một mình lật QL-1b · QL-4 · QL-5 · QL-6 từ "không/một phần" sang "làm được".

## I.5 — Ba đề xuất ưu tiên cho vai QUẢN LÝ (xếp theo giá trị nghiệp vụ / công sức)

### **P-QL1 — Gỡ `[0]` ở màn Chuyền và màn Máy** *(giá trị rất cao / công sức nhỏ)*
- **Sửa ở đâu:** `client/src/pages/TwinLine.tsx:355` và `client/src/pages/TwinMay.tsx:284` (`const factoryId = factories[0]?.id`), cộng `TwinLine.tsx:373-378` / `TwinMay.tsx:297-302` (`toaNhaDau = toaNha[0]`). Suy nhà máy **và toà** từ chính line/máy đang mở thay vì từ phần tử đầu danh sách; server đã có đủ dữ liệu (PH-19 chứng minh `machineDetail`/`createWorkOrder` chấp nhận chính máy mà UI từ chối). Sửa kèm `manLine.ts:412` thêm lý do `ngoaiPhamVi` để hai tình huống "ngoài phạm vi" và "chưa xếp chỗ" không còn nói cùng một câu (PH-13).
- **Nghiệm thu:** bằng `qatd_quanly`, mở **1 chuyền + 1 máy ở mỗi toà T1..T4** của QATD-A ⇒ 8/8 vẽ đủ khối, tên thật (không rơi về "Chuyền <id>"). Chạy lại `.qa-tapdoan/pham-vi-hong.mjs` ⇒ cột "% line hỏng" của quanly phải từ **78,1 % → 0 %**. **Ca âm bắt buộc** (chống vá quá tay): máy của `SIM-FAC` với quanly ⇒ vẫn `ngoaiPhamVi`, API vẫn NOT_FOUND.

### **P-QL2 — Một con số cho đúng phạm vi đang chọn** *(giá trị cao / công sức nhỏ-trung bình)*
- **Sửa ở đâu:** `kpiNoiLogic.ts:77-82` (`mauSo`) + nhãn phạm vi `TwinVanHanh.tsx:3318-3321` + ô `dem-may` (`cayVanHanh.ts:58-61` ← `TwinVanHanh.tsx:2924`). Hai lối đều chấp nhận được: (a) đổi mẫu số theo phạm vi đang chọn, hoặc (b) giữ mẫu số nhà máy nhưng **đổi nhãn thành "Toàn nhà máy"** và thêm một hàng "Trên sàn tầng này: N". Lối (b) rẻ hơn và không phá hợp đồng nào.
- **Nghiệm thu:** chọn tầng 83 (0 máy) ⇒ ô cấp tầng in **0** *(và theo luật NT-3 §9.5 mục 5, phải là `0` chứ không phải `—`, vì 0 ở đây là đã đo được)*; chọn tầng 88 ⇒ **68** = `mayTheoTang`; đổi toà T2→T3→T4 ⇒ số đổi **68→40→41** (hiện đang đứng yên 371, `BANG-AB.md` B6). Ablation: che nhãn phạm vi đi thì ca tầng-3-rỗng phải **thất bại** — nếu vẫn xanh thì phép đo đang đo nhầm chỗ.

### **P-QL3 — Dòng cảnh báo phải nói được nó ở đâu, và bấm được tới đó** *(giá trị cao / công sức nhỏ)*
- **Sửa ở đâu:** `DaiCanhBao.tsx:137` in thêm mã máy (dữ liệu **đã có** trong `CanhBaoDai.machineId`, `daiCanhBaoLogic.ts:148`); `TwinVanHanh.tsx:3062` `onChonCanhBao` phải chuyển **tầng/toà** về nơi chứa máy trước khi `chonMay`, không chỉ chọn trong cảnh hiện tại.
- **Nghiệm thu:** với quanly, 15 dòng của dải ⇒ **15 chuỗi phân biệt nhau** (đo bằng `new Set(texts).size === 15`); bấm một dòng có máy ở toà khác ⇒ URL đổi `toa=`/`tang=` và `ngan-xu-ly` mở đúng máy. Ca âm: andon không gắn máy (`machineId=null`) vẫn hiện trong dải, không bị lọc mất — giữ nguyên luật NT-3 đã ghi ở docblock `locTheoPhamVi`.

> *Ngoài ba mục trên, hai món còn lại của vai (PH-14 Studio khoá tầng-1-toà-1; PH-15 nút tạo bật sai) quan trọng nhưng tần suất thấp hơn — bố cục là việc hằng quý, theo dõi là việc hằng ca. PH-15 nên gộp vào cùng lô với PH-14 vì cùng một tệp.*

---

# PHẦN II — VAI GIÁM ĐỐC (ban điều hành tập đoàn, `qatd_giamdoc`, gán cấp TẬP ĐOÀN QATD ⇒ 3 công ty · 1.108 máy · chỉ-xem)

## II.1 — Nhiệm vụ nghiệp vụ thật của vai

| # | Việc | Nguồn |
|---|---|---|
| GĐ-1 | **Một màn thấy cả tập đoàn**: 3 công ty cạnh nhau, mỗi công ty một khối kèm tên · số máy · số cảnh báo đang mở · đèn trạng thái tổng | Spec §10C.6 "Xem toàn tập đoàn" (nguyên văn liệt kê đúng 4 thứ này) |
| GĐ-2 | **Chỉ ra nơi tệ nhất hôm nay** và đủ dữ kiện để nói vì sao | *Suy luận nghiệp vụ.* Spec chỉ hàm ý qua "đèn trạng thái tổng" của §10C.6, không nói thẳng việc xếp hạng |
| GĐ-3 | **Đọc tồn đọng**: cảnh báo nào đã mở quá 24 h mà chưa ai xử lý — dấu hiệu vấn đề tổ chức, không phải vấn đề máy | Spec §12b.2 mục G-5 ("tồn đọng >24h"); cơ chế có thật: `daiCanhBaoLogic.ts:256` `NGUONG_TON_DONG_MS = 86_400_000` |
| GĐ-4 | **Đọc OEE / năng suất cấp tập đoàn** để quyết định đầu tư | Quyền `analytics_oee` + `dashboard_corporate` được cấp cho vai này (BRIEF §2) |
| GĐ-5 | **Đi sâu một lần** khi thấy bất thường: tập đoàn → công ty → tầng → chuyền → máy, không cần nhờ ai mở hộ | Spec §10C.2 (4 cấp phạm vi, tween 500 ms) + §9.4 deep-link |
| GĐ-6 | **Biết con số mình đang đọc có đáng tin không**: dữ liệu tươi hay cũ, đo trên bao nhiêu máy, phần nào chưa đo | Spec §9.5 NT-3 (đặc biệt luật 5: "đếm rỗng khác đếm bằng 0") |
| GĐ-7 | **Xem mà không sửa** — không có mặt ghi nào để lỡ tay | Spec QĐ-18 nguyên văn chủ sở hữu: *"Twin là nơi trình diễn, xem, quản lý realtime nhà máy, **không chỉnh sửa được**"* |
| GĐ-8 | **Dùng màn này để trình bày** trong cuộc họp điều hành | Spec §9.1 có chế độ `[Ops \| Trình bày]` trên thanh tiêu đề |

## II.2 — Bảng: việc × làm được trên sản phẩm hiện tại?

| Việc | Mức | Bằng chứng | Hậu quả nghiệp vụ nếu không làm được |
|---|---|---|---|
| **GĐ-1** Toàn cảnh tập đoàn một màn | **KHÔNG LÀM ĐƯỢC** | PH-10 (`boChonNap.ts:236-245` hạ `?pv=tapdoan` xuống cấp nhà máy; gốc là hợp đồng `twinCanh.canhThietKe` nhận **đúng một** `factoryId`, `twinCanhRouter.ts:1003-1014`) · ảnh `AB-B7-qatd_giamdoc-tapdoan.png`: breadcrumb chỉ "Corporate › **Công ty A**", cảnh y hệt cảnh cấp tầng (45 khối), banner "2 things to know" khai *"Showing data for ONE factory (3 factories in the system)… use the Factory box to switch"* | Việc **định nghĩa ra vai này** không làm được. Giám đốc phải mở màn 3 lần, mỗi lần một công ty, rồi tự cộng trên giấy. ⚠ **Phân loại: hạn chế THIẾT KẾ được khai báo, không phải lỗi** — sản phẩm nói thẳng, không nói dối. §15 mục 26 vẫn CHƯA ĐẠT, nhưng đợt này là **lần đầu đo được** (trước đó `factories.corporateCode` NULL nên gán cấp tập đoàn chiếu ra 0 nhà máy — PH-02) |
| **GĐ-2** Chỉ ra nơi tệ nhất | **KHÔNG LÀM ĐƯỢC** | Hệ quả của GĐ-1. Cộng thêm PH-18: con số **duy nhất** trên màn bao cả 3 công ty là `dai-canh-bao` "Alarms (**55**)" (KPI cạnh nó nói "371 machines" = một công ty) — nhưng tôi đọc mã: `CanhBaoDai` (`daiCanhBaoLogic.ts:126-150`) **không có trường factory**, và `DaiCanhBao.tsx:137` chỉ in tiêu đề. Ảnh `AB-A3-qatd_giamdoc.png`: 55 cảnh báo, mọi tiêu đề kết thúc bằng "(QATD)" = **mã tập đoàn**, giống nhau ở cả 3 công ty | Con số toàn tập đoàn duy nhất trên màn lại là con số **không phân rã được**. Giám đốc thấy "55" và không có cách nào biết 55 đó chia cho A/B/C thế nào — tức là thấy vấn đề mà không định vị được. Hai mẫu số đứng cạnh nhau không nhãn nào phân biệt (PH-18) làm tình hình tệ hơn: người đọc nhanh sẽ hiểu "371 máy đang có 55 cảnh báo" |
| **GĐ-3** Tồn đọng >24 h | **MỘT PHẦN — CHƯA ĐO trên ca dương** | Cơ chế **có thật**: `daiCanhBaoLogic.ts:256` ngưỡng 24 h, `:283` `tachNhom`, chip "tồn đọng N ngày" render ở `DaiCanhBao.tsx:141`. Nhưng ảnh `AB-A3-qatd_giamdoc.png`: toàn bộ 55 nằm dưới nhãn "**TODAY (55)**" — dữ liệu kịch bản mới sinh nên nhóm tồn đọng rỗng | **CHƯA ĐO.** Phép đo cần: chèn 1 hàng `andon_events` `raised` với `raisedAt = now() - 48h` (trap EXIT dọn), mở `/twin` bằng giamdoc ⇒ phải xuất hiện nhóm tồn đọng + chip "2 ngày"; xoá ⇒ mất. Đây là **G146/G139**: nhóm rỗng hiện tại là tập rỗng, không được đọc là "đạt" |
| **GĐ-4** OEE cấp tập đoàn | **KHÔNG LÀM ĐƯỢC** — nhưng màn **trung thực** về điều đó | Ảnh `AB-A3-qatd_giamdoc.png` và `AB-B4-…`: "Average OEE **—**" và dòng chân "**OEE measured on 0/371 machines**"; ảnh `DE-D5-giamdoc-may.png` ô OEE của một máy cũng là "**—**" | Chỉ số ban điều hành cần nhất **không có dữ liệu**. ⚠ **Phân loại: nợ nguồn dữ liệu, không phải lỗi twin** — và là ví dụ tốt của luật §9.5 mục 5 ("chưa đo hiện `—`, không hiện `0`"). Hậu quả vẫn thật: nếu giám đốc dùng màn này để họp, ô quan trọng nhất trống |
| **GĐ-5** Đi sâu vào bất kỳ công ty nào | **KHÔNG LÀM ĐƯỢC** cho 92,9 % | PH-12 ★★★ · `BANG-C.md` §3: giamdoc **7/98 line vẽ đủ · 25 line cảnh rỗng · 66 line từ chối hẳn ⇒ 92,9 % hỏng** · ảnh `C-C2-qatd_giamdoc-may4977.png`: *"Không mở được máy #4977 — Đối tượng này không thuộc phạm vi đang xem (hoặc không còn tồn tại). Hãy đổi nhà máy/tầng rồi mở lại"* · ảnh `C-C1-qatd_giamdoc-line284.png`: "Chuyền 284 · Máy 0 · Trạm 0", canvas không có · PH-12 bảng API: **cùng máy đó `machineDetail` TRẢ DỮ LIỆU** cho giamdoc | **Sản phẩm đảo ngược quan hệ quyền–tầm nhìn**: vai có phạm vi rộng nhất (3 công ty) hỏng nhiều nhất (92,9 %), trong khi công nhân chỉ 1 công ty lại mở được chính cái máy đó (77,4 %). Và lời khuyên trên màn ("hãy đổi nhà máy/tầng rồi mở lại") **không thực hiện được** — màn Máy không có ô chọn nhà máy. Giám đốc sẽ kết luận sai là "công ty C chưa dựng twin" |
| **GĐ-6** Biết số có đáng tin không | **LÀM ĐƯỢC** — điểm mạnh rõ nhất của sản phẩm cho vai này | PH-05 (hợp đồng trạng thái API↔DB khớp **5/5 rổ trên 409 máy**, kể cả ánh xạ `stopped+tươi→idle` vs `stopped+cũ→offline`) · ảnh `DE-D1-quanly-twin.png` hàng "Fresh data / Stale data / Unknown / Decommissioned" · "Updated 13s ago" · "OEE measured on 0/371" · banner "**326 machines are outside this load**" (ảnh `AB-A3`) và "**371 machines are outside this load**" khi chọn tầng rỗng (ảnh `AB-B4`) | — |
| **GĐ-6b** …nhưng lời khai trung thực **bị che** | **MỘT PHẦN** | Tôi tự đọc ảnh: ở `AB-A3-qatd_giamdoc.png`, `AB-B4-…` và `AB-B7-…`, bảng **Metrics đè lên chính giữa dòng banner**, cắt câu thành "326 machines are outside this load (other buildings we⟨bị che⟩t known yet". Ở `AB-B7` cả **hai** dòng banner đều bị cắt giữa. `BANG-F.md` §4 ảnh #6 ghi thêm: ở `?pv=tapdoan` dải "2 things to know" ở trạng thái **THU**, phải bấm mới thấy | Câu khai trung thực nhất trên màn — thứ ngăn giám đốc hiểu sai — là thứ bị lớp phủ KPI che mất. Trung thực mà không đọc được thì không bảo vệ được ai. *(Đây là quan sát thị giác của tôi, chưa có phép đo chồng lấn cho cặp `bang-kpi-noi` × banner; phép đo F4 hiện chỉ đo cặp badge × nhãn trong canvas)* |
| **GĐ-7** Xem mà không sửa | **LÀM ĐƯỢC** | `BANG-DE.md` ô #14: trên `/twin` và `/twin/may/4197`, giamdoc có **0 nút ghi** (`nut-ack`/`nut-an-tam`/`nut-tao-phieu` đều = 0) · ô #4 · ô #18: `/twin-studio` chặn **ở cửa** kèm câu giải thích và lối ra · ảnh `DE-D5-giamdoc-may.png`: ngăn phải chỉ 4 link "OPEN MODULE", không một nút ghi nào · `BANG-F.md` ảnh #6: nút "Twin Studio" **biến mất** khỏi thanh công cụ (ẩn, không disable) | — Đúng QĐ-18 nguyên văn. Đây là mục duy nhất của vai giám đốc được thực thi **trọn vẹn** |
| **GĐ-8** Trình bày trong họp | **CHƯA ĐO** | Chế độ `[Ops \| Trình bày]` của spec §9.1 không nằm trong ma trận ca của đợt này. Số liên quan đã có: thời gian tới màn cho vai giamdoc **p50 3.151 ms** (PH-24/F1c) vs admin 1.182 ms; FPS xoay trên GPU p50 62,1 (PH-26); idle 46,7 s không một khung thừa | **CHƯA ĐO.** Phép đo cần: bật chế độ Trình bày bằng giamdoc, chụp ảnh, kiểm 3 điều — chữ đủ lớn ở 1920, không ô nào rỗng-không-lý-do, và không mặt ghi nào lộ ra. Riêng 3,15 s mở màn: chấp nhận được trước hội đồng nhưng gấp 2,7× cùng URL với tài khoản admin, và **nguyên nhân đã quy trách xong** (PH-23/PH-24) |

## II.3 — Ba câu hỏi vai này sẽ hỏi màn hình

**Q-GĐ1 — "Công ty nào tệ nhất hôm nay?"**
→ **KHÔNG.** Phải mở 3 lần (PH-10) và tự cộng. Con số duy nhất bao cả 3 công ty — "Alarms (55)" — không mang thông tin công ty trong từng dòng (`CanhBaoDai` không có trường factory; `DaiCanhBao.tsx:137` chỉ in tiêu đề; ảnh `AB-A3-qatd_giamdoc.png` cho thấy 55 tiêu đề gần như giống hệt). Màn **biết** tổng, **không biết** phân rã.

**Q-GĐ2 — "1.108 máy của tập đoàn, ngay bây giờ bao nhiêu đang chạy?"**
→ **KHÔNG trên màn twin — nhưng dữ liệu ĐÃ SẴN SÀNG.** PH-02 đo được: `factoryCommand.overview` **không tham số** với giamdoc trả đúng **1.108** máy, và "tổng theo từng nhà máy = tổng không tham số ở cả 5 vai ⇒ hai đường cộng khớp". Tức thứ bị khoá ở một nhà máy là hợp đồng **hình học** (`canhThietKe`), còn hợp đồng **số** đã cộng được cả tập đoàn từ trước. Đây là phát hiện quan trọng nhất cho vai này: khoảng cách tới câu trả lời **nhỏ hơn nhiều** so với vẻ ngoài của PH-10.

**Q-GĐ3 — "Máy 4977 ở công ty C đang lỗi, cho tôi xem nó."**
→ **KHÔNG.** Ảnh `C-C2-qatd_giamdoc-may4977.png`: bị từ chối với câu "không thuộc phạm vi đang xem". Cùng lúc, cùng tài khoản, API trả đủ dữ liệu cho chính máy đó (PH-12 bảng "phép đo quyết định"). Lời khuyên trên màn không thực hiện được. Người dùng có phạm vi **rộng nhất** hệ thống đang bị từ chối đúng cái mà người có phạm vi **hẹp nhất** mở được.

## II.4 — Xếp hạng cho vai GIÁM ĐỐC

### **CHƯA DÙNG ĐƯỢC** (cho đúng việc của vai — điều hành nhiều công ty)

**Lý do một câu:** Hai việc định nghĩa ra vai — nhìn cả tập đoàn trên một màn (GĐ-1) và đi sâu vào bất kỳ công ty nào khi thấy bất thường (GĐ-5) — đều không làm được: một do hạn chế thiết kế **đã khai báo** (PH-10), một do lỗi client làm hỏng **92,9 %** điểm đến (PH-12); phần còn lại của màn (đọc trạng thái một nhà máy, trung thực dữ liệu, chỉ-xem) chạy tốt nhưng đó là việc của quản đốc, không phải của giám đốc.

**Điều kiện lên HẠN CHẾ NẶNG:** vá PH-12 — chỉ cần thế là giám đốc đi sâu được vào cả 3 công ty, dù vẫn phải chuyển công ty bằng tay.
**Điều kiện lên DÙNG ĐƯỢC VỚI LƯU Ý:** thêm dải KPI cấp tập đoàn dựng trên nguồn đã có (P-GĐ1) **và** phân rã cảnh báo theo công ty (P-GĐ3).

## II.5 — Ba đề xuất ưu tiên cho vai GIÁM ĐỐC (xếp theo giá trị nghiệp vụ / công sức)

### **P-GĐ1 — Dải KPI cấp TẬP ĐOÀN dựng trên nguồn ĐÃ CÓ, không động vào 3D** *(giá trị rất cao / công sức nhỏ — tỉ lệ tốt nhất trong cả sáu đề xuất)*
- **Lý lẽ:** PH-02 đã đo được `factoryCommand.overview` trả đúng tổng cho từng nhà máy **và** tổng toàn phạm vi, hai đường cộng khớp. Không cần sửa hợp đồng `canhThietKe` (thứ đắt), không cần dựng cảnh 3 nhà máy (thứ spec §10C.6 mô tả và rất đắt).
- **Sửa ở đâu:** `client/src/pages/TwinVanHanh.tsx` chỗ render `BangKpiNoi` — thêm một bảng "3 công ty × (máy · đang chạy · dừng · bảo trì · cảnh báo)", mỗi hàng bấm được để chuyển `?nm=`. Nguồn: gọi `factoryCommand.overview` theo từng id trong `factory.list` (vai quanly sẽ tự ra 1 hàng, kythuat 2 hàng — không cần mã riêng cho vai).
- **Nghiệm thu:** giamdoc thấy **3 hàng**, tổng 3 hàng = **1.108** = `.qa-tapdoan/ky-vong-db.json`; quanly thấy 1 hàng = 371; `qatd_khonggan` thấy **0 hàng + câu "chưa gán nhà máy"** (không phải 0 lặng lẽ — spec §9.5 mục 6 `isScopeEmpty`). **Ablation đã có sẵn khuôn**: xoá hàng `user_corporate_assignments` của giamdoc ⇒ 3 hàng → 0; chèn lại ⇒ 3 (AB-1 của BRIEF §3.2).

### **P-GĐ2 — Vá PH-12 (chung với P-QL1), ưu tiên vì bán kính 92,9 %** *(giá trị rất cao / công sức nhỏ)*
- **Sửa ở đâu:** như P-QL1 (`TwinLine.tsx:355,375` · `TwinMay.tsx:284,299`).
- **Nghiệm thu riêng cho vai này:** bằng `qatd_giamdoc`, mở **1 chuyền + 1 máy của MỖI công ty A/B/C** ⇒ 6/6 vẽ đủ. Chạy lại `pham-vi-hong.mjs` ⇒ giamdoc **92,9 % → 0 %**. **Ca âm bắt buộc:** máy thuộc `SIM-FAC` (ngoài tập đoàn QATD) với giamdoc ⇒ vẫn bị từ chối và API vẫn NOT_FOUND — nếu ca âm này cũng mở được thì bản vá đã phá hàng rào tenant, phải bác bỏ.

### **P-GĐ3 — Mỗi dòng cảnh báo phải nói được nó thuộc công ty nào; dải phải lọc được theo công ty** *(giá trị cao / công sức trung bình)*
- **Sửa ở đâu:** bổ sung `factoryId` (và mã máy) vào hàng thô từ `andon.active` → `chuanHoaHang` (`daiCanhBaoLogic.ts:440-460`) → `CanhBaoDai` (`:126-150`); render ở `DaiCanhBao.tsx:137`; thêm một hàng chip lọc theo công ty cạnh hàng chip lọc theo mức (`:198` `dai-theo-nhanh`).
- **Nghiệm thu:** 55 dòng của giamdoc nhóm được thành 3 cụm, **tổng 3 cụm = 55**; congnhan 20 dòng **đều** mang "Công ty C"; quanly 15 dòng đều "Công ty A" (ba vai, ba mẫu số, cùng một thước). **Ca âm giữ luật cũ:** andon có `machineId=null` vẫn phải hiện khi không lọc (docblock `locTheoPhamVi` đã ghi lý do — đừng vá mất).

---

# PHẦN III — PHÂN LOẠI VÀ ĐIỂM MẠNH

## III.1 — Phân loại bốn nhóm (không quy oan)

| Nhóm | Mục | Ghi chú |
|---|---|---|
| **LỖI SẢN PHẨM** ảnh hưởng hai vai | PH-12 (`factories[0]`/`toaNha[0]` — nặng nhất) · PH-06 (nhãn tầng, số nhà máy) · PH-13 (không phân biệt "ngoài phạm vi" với "chưa xếp chỗ") · PH-14 (Studio khoá tầng-1-toà-1) · PH-15 (nút tạo bật cho vai không có `canCreate`) · PH-16/PH-17 (mã có, 0 chỗ gọi) · PH-23/PH-24 (`commandCenter.hierarchy` không lọc tenant ⇒ +1,97 s cho mọi vai không-admin) · PH-27 (mã máy bị cắt ở 1280) | PH-23 là **bảo mật**, ngoài phạm vi twin nhưng là nguyên nhân trực tiếp của độ trễ mà cả hai vai gánh |
| **THIẾT KẾ CÓ CHỦ Ý** (khai báo rõ) | PH-07 (`dem-may` đếm theo nhà máy — `cayVanHanh.ts:58-61` ghi sẵn "G9 — cùng chữ 'máy', hai mẫu số") · PH-10 (`?pv=tapdoan` hạ cấp, có banner khai thẳng) · "Average OEE —" thay vì 0 (§9.5 luật 5) | Không chấm SAI mới. Nhưng với 7 tầng/toà và 3 công ty thì **hệ quả nghiệp vụ đã đổi** — đúng lớp G148 "lý do hoãn có HẠN SỬ DỤNG" |
| **NỢ ĐÃ BIẾT TỪ TRƯỚC** (BRIEF §4) | `/factory-command` 42 máy chồng 1 điểm · 41 cặp nhãn∩khối · `twin.replay` STATE_METRICS · `check:tests` 27 lỗi TS · `hienDoTuoi` mã chết · QĐ-30 index production | Không tính vào đánh giá hai vai |
| **LỖI THIẾT BỊ ĐO** (của đợt QA, không phải của sản phẩm) | PH-08 (BRIEF đòi hai phán quyết cho một con số ⇒ 15 ô SAI, tái phân loại còn **1** SAI thật) · PH-09 (nhịp 120 s vượt ngưỡng tươi 60 s ⇒ ô "Fresh data 0 / Stale 364" trên ảnh `DE-D1-quanly-twin.png` là **giả tạo của harness**) · PH-20 (bảng §2 ghi sai quyền "ẩn tạm") · PH-25 (Playwright chạy SwiftShader ⇒ mọi số FPS 10 đợt trước là số CPU) | ⚠ Khi đọc ảnh `DE-D1-quanly-twin.png`, **đừng** kết luận "sản phẩm khai dữ liệu cũ": đó là nhịp đo, và ảnh `F-F5-twin-tang-dong-68may-1600.png` chụp lúc khác cho "Fresh data 364 · Stale 0" |

## III.2 — Điểm mạnh có bằng chứng (công bằng với sản phẩm)

1. **Hàng rào phạm vi đúng 7/7 vai trên 1.151 máy** (PH-02) — và đây là **lần đầu** đường gán cấp tập đoàn `user_corporate_assignments` được chứng minh là sống. Tổng theo từng nhà máy = tổng không tham số ở cả 5 vai ⇒ hai đường cộng khớp.
2. **Hợp đồng trạng thái khớp 5/5 rổ trên 409 máy** (PH-05), kể cả hai ca tinh tế: 8 máy `stopped` + heartbeat NULL → `offline`, còn 59 máy **cùng** `stopped` mà heartbeat tươi → `idle`. Đó là đối chứng dương cho chính luật 5 phút.
3. **Vai chỉ-xem được thực thi trọn vẹn** (`BANG-DE` ô #4/#14/#18): 0 nút ghi trên cả `/twin` lẫn `/twin/may`, chặn `/twin-studio` **ở cửa** kèm lý do và lối ra, nút Twin Studio **ẩn** chứ không xám. Đúng QĐ-18.
4. **Tối ưu đứng vững ở mật độ 26× dữ liệu cũ** (PH-26): tầng 68 máy chỉ **5 draw call** (trần 150 — biên 25×), **15.026 tam giác** (trần 500k — biên 33×), `__soCanvas=1` ở 10/10 ca, **0 px² chồng lấn** badge×nhãn ở 8/8 ca, idle 46,7 s **không một khung thừa**. Với hai vai này nghĩa là: màn không chậm đi khi tập đoàn lớn lên — nút thắt nằm ở cổng quyền (PH-24), một chỗ, sửa được.
5. **Trung thực dữ liệu** — nhiều tầng: "Average OEE **—**" chứ không phải 0; "OEE measured on 0/371 machines"; banner "326/371 machines are outside this load"; banner khai thẳng giới hạn `?pv=tapdoan`; "Updated 13s ago". Đây là thứ hiếm và đáng giữ; vấn đề duy nhất là **nó đang bị lớp phủ KPI che** (GĐ-6b).
6. **Màn Line đã có sẵn lời giải cho lỗi cắt chữ**: in "Prefix: QATD-A-T1-X1-L1-" một lần rồi rút nhãn còn `M01..M12` (PH-27 ★, ảnh `F-F5-line-217-1600.png` theo `BANG-F` §4 #3). Áp cùng cách cho `danh-sach-may` là đủ — không cần thiết kế mới.
7. **Cổng nền sạch** (`K-cong-nen.txt`): `pnpm check` 0 lỗi TS · `i18n:check` 0 vi phạm mới · `phamVi` 437/437 · `twin3d` 2.539 xanh. Không có hồi quy nền nào đứng sau các phát hiện trên.

---

# PHẦN IV (§C) — MƯỜI ẢNH TÔI TỰ ĐỌC

| # | Ảnh | Một câu nhận xét |
|---|---|---|
| 1 | `anh/AB-A3-qatd_giamdoc.png` | Giám đốc trên `/twin`: bảng Metrics "371 machines · Corporate · Công ty A · Floor" đứng **đè lên** dòng banner "326 machines are outside this load…" và cạnh dải "Alarms (55)" của cả 3 công ty — hai mẫu số cạnh nhau (PH-18), còn câu giải thích thì bị che mất một khúc. |
| 2 | `anh/AB-B4-qatd_giamdoc-tang3-trong.png` | PH-06 nguyên hình: chọn Tầng 3, canvas **hoàn toàn trống** (chỉ lưới sàn), vậy mà bảng vẫn in "371 machines · Running 261 · Down 25" và danh sách trái vẫn liệt kê máy của tầng khác; thứ duy nhất nói sự thật ("371 machines are outside this load") lại bị chính bảng Metrics cắt ngang. |
| 3 | `anh/AB-B7-qatd_giamdoc-tapdoan.png` | `?pv=tapdoan` cho ra **đúng cảnh cấp tầng** (45 khối, Toà 1 Tầng 1), breadcrumb "Corporate › Công ty A"; banner "2 things to know" khai trung thực rằng chỉ tải một nhà máy — nhưng **cả hai dòng banner đều bị bảng Metrics che giữa**. |
| 4 | `anh/DE-D5-giamdoc-may.png` | Màn Máy của giám đốc: vòng đế **đỏ** + "Health 50 % · critical" ở trên, mà ô chỉ số ngay dưới lại ghi "**0 % Failure risk**" — hai câu về cùng một máy đọc ngược nhau; ngăn phải đúng vai: 4 link mở màn, **0 nút ghi**. |
| 5 | `anh/DE-D1-quanly-twin.png` | Quản đốc trên `/twin`: nút **Twin Studio** có mặt, "Alarms (**15**)" khớp đúng phạm vi một công ty (so với 55 của giám đốc) — nhưng **cả 15 dòng cảnh báo đọc y hệt nhau** ("Ùn tắc tại trạm 06/07/08 (QATD)"), không dòng nào nói máy nào. |
| 6 | `anh/DE-D1-quanly.png` | Ngăn xử lý của quản đốc trên máy ICT-01: đúng **một** nút ghi ("Acknowledge") và 5 link mở màn; không có "Create work order" ⇒ vai này ghi nhận được nhưng **không giao được việc**. |
| 7 | `anh/DE-D4-quanly.png` | Đích thứ 5 của nhóm "Mở chức năng" dẫn tới `/control-plane`, và màn đó tự dán hai nhãn ngay đầu: "**preview feature**" và "**Read-only projection**" — nút nghe như điều khiển, mở ra là màn chỉ-đọc đang thử nghiệm. |
| 8 | `anh/DE-E6-quanly.png` | PH-15 nhìn thấy được: quanly đi hết 3 bước "Add building" tới bước Preview, nút "**Create building**" sáng teal **bật hẳn**, không huy hiệu chỉ-xem — server sẽ trả 403 sau khi người dùng đã làm xong việc. |
| 9 | `anh/C-C1-qatd_giamdoc-line284.png` + `anh/C-C2-qatd_giamdoc-may4977.png` | Hai màn trắng của giám đốc: chuyền 284 rơi về tên "Chuyền 284" với "Máy 0 · Trạm 0 · WIP 0", còn máy 4977 thì "Không mở được… Hãy đổi nhà máy/tầng rồi mở lại" — lời khuyên **không làm theo được** vì màn Máy không có ô chọn nhà máy (PH-12). |
| 10 | `anh/F-F5-twin-tang-dong-68may-1600.png` + `anh/F-F5-twin-tang-dong-68may-1280.png` | Tầng đông nhất (68 máy): ở 1600 cảnh rất sạch — vòng đỏ/hổ phách rõ, nhãn không đè nhau, chip "67 other names hidden" trung thực; nhưng ở **1280 thì mọi hàng của danh sách máy đều đọc là "QATD-A-T…"** (PH-27), và ở cả hai cỡ, danh sách trái vẫn là máy của **Toà 1** trong khi cảnh đang vẽ **Toà 2** — danh sách và cảnh nói về hai nơi khác nhau. |
