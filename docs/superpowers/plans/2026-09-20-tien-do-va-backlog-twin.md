# Twin 3D — TIẾN ĐỘ, PHẦN CÒN LẠI, BACKLOG (chốt 2026-09-20)

> Hồ sơ này gom lại **trạng thái đo được** của màn Twin sau vòng PDCA 2026-09-18 → 09-20, và
> xếp phần còn lại thành backlog để chủ dự án chọn việc cho vòng sau.
> Mọi con số dưới đây là **đo trên trình duyệt thật**, thô nằm ở `.qa-v2/tho-*/`.
> Nhánh: `feat/ai-local-L7-hang-rao` · HEAD `b054be724` (đã push).

---

## A. TIẾN ĐỘ — vòng này làm được gì

**39 commit · 130 tệp · +20.538 dòng.** Chia theo thứ đã chữa, kèm số trước/sau:

| # | Khối | Kết cục đo được |
|---|---|---|
| 1 | **Hiệu năng engine** | `/twin` khi kéo camera **9,2 → 60 khung/s**; `getImageData` **2.425 → 0** lượt/lần kéo. Gốc rễ là `byteMau`, **không** phải three.js (phép thử phân biệt: `/corporate-layout` 62,7 lệnh vẽ = 60 fps vs `/twin` 7 lệnh vẽ = 9,2 fps ⇒ engine chiếm 1 %). |
| 2 | **Đường tín hiệu** | `machines.lastHeartbeat` **0/1.700 → sống**; nhịp tim qua socket.io trước đây **chưa bao giờ** ghi cột ấy ⇒ `/twin` vẽ 41/41 "Unknown" trong khi 3D làm **đúng**. Màu theo tuổi dữ liệu nay tới được màn (trước là **mã chết**). |
| 3 | **Dữ liệu & quy trình duyệt máy** | **1.108 máy QATD** `approved` mà **0 giấy tờ** → **1.699/1.700** có khoá sống, đối soát CẦN CẤP **0**, và nhịp tim lần đầu đi qua **đường sản phẩm**. `machine.approve` thôi trả *"key issued"* khi phép đúc khoá vừa ném — thêm `credentialIssued`. |
| 4 | **Tính đọc được của cảnh** | `/twin` đích bấm **0/130 → 6/6** đạt WCAG 24×24 (bậc vẽ **cụm trạm**) · lớp phủ **70,8 → 58,2 %** · nhãn cụm: ứng viên **182 → 6**, `biChe` **11 → 1** · bản 2D khớp khung theo **nội dung** (0,244 → **2,369 px/m**, bấm cụm từ *bất khả* thành **ĐẠT**) · **màn Line** trải **sơ đồ rắn bò**: **0/39 → 39/39** đạt 24×24, lấp dọc **1,2 % → 46,8 %**. |
| 5 | **Đúng chỗ & một nguồn** | Cột WIP **0/39 → 39/39** đứng đúng chỗ trạm (trước lệch **16,6 m** ⇒ **111 px** trên màn) · gộp **bản sao G12** của phép ghép WIP · `demCapChongNhau` từ **mã chết** thành **thước sống** trên đường sản phẩm. |

---

## B. TRẠNG THÁI NGHIỆM THU — đo được, không suy

| bề mặt | đơn vị vẽ | đích bấm ≥ 24×24 | bấm mở đúng | ghi chú |
|---|---|---|---|---|
| `/twin` cấp nhà máy | **cụm trạm** (6) | **6/6** | **6/6** đúng 6 line riêng (511…516) | chồng lấn **mặt bằng 0**; chồng hộp-bao-trên-màn 3/15 @1280, 0 @1920 — **không hại kết cục** |
| `/twin/line/:id` | **sơ đồ rắn bò** (39) | **39/39** (min **39,23 px**) | `/twin/may/:id` | lấp **61,3 % / 46,8 %**; cột WIP **39/39** đúng chỗ; nhãn **30/39** |
| bản 2D | **cụm** (6) | **6/6** | `/twin/line/:id` | 6 cụm = 6 cụm của 3D; **176/176** máy đại diện |
| `/twin/may/:id` | — | **chưa đo vòng này** | — | ⚠ xem C3 |

**Cổng:** `tsc` **0** · `twin3d`+`pages` **950 tệp / 3.570 ca / 0 đỏ** · `i18n:check` **0** khoá
mới lỗi · e2e `twin-dot47-bam-canh` **16/16** · cây sạch.

---

## C. BACKLOG

### C1 — ⛔ CẦN CHỦ DỰ ÁN QUYẾT (không ai tự quyết)

| | việc | số đã đo | vì sao phải hỏi |
|---|---|---|---|
| **Q1** | **Trần 30 nhãn DOM** (`TRAN_NHAN_DOM`) | A/B 30↔60: **+5 tên** @1280×720, **0** @1920×1080, long task **1 → 5** | Muốn màn Line hiện **39/39** tên thì phải đổi từ **một hằng toàn cục** sang **ngân sách theo MÀN** — đó là sửa bảng ngân sách **§4**, không phải một chi tiết kỹ thuật. Và A/B cho thấy nâng trần suông **không phải một cái thắng sạch**. |
| **Q2** | **Dọn 32 thư mục `.qa-*`** (~~391 mục untracked; riêng `.qa-v2` **378 MB**~~ — **HAI SỐ NÀY ĐỀU SAI, đính chính 2026-09-21**: **4.731** tệp `.qa-*` nằm **TRONG HEAD** chứ không untracked, và tổng thật là **9,12 GB** chứ không 378 MB — `du` đã hết giờ mà tôi vẫn báo con số dở dang. Xem §5 vòng 5) | — | Đây là **xoá tệp** ⇒ theo ràng buộc của chủ dự án phải hỏi. Trong đó có **bằng chứng đo** của vòng này và của **phiên khác**; cần tách "giữ làm mốc" khỏi "rác". |

### C2 — Nợ CÓ TÊN, đã đo, chưa vá

| | việc | trạng thái |
|---|---|---|
| **N1** | **Task 17c** — tâm trạm lấy **mặt bằng** từ `twin_dat_cho` mà bản ghi ấy **chưa cộng gốc toà nhà** | ✅ **ĐÓNG.** Đã trả ở vòng 4: `canhLine.ts` tra `gocToaTheoTang` theo `tangId` và cộng vào **cả ba trục**, kèm hoán trục (`y ← g.zMm`, `z ← g.yMm`); 8 ca ở `tamTramCongGocToa.unit.test.ts`. ⚠ **Nhưng khối cảnh báo trong mã nằm quá hạn tới 2026-09-21** — nó vẫn ghi *"CHƯA CỘNG GỐC TOÀ NHÀ"* trong khi mã ba dòng dưới đã cộng. Chính khối ấy tự nhận là *"lời khai có hạn sử dụng"* rồi để quá hạn. **Một cảnh báo hết hạn nguy hiểm hơn không có cảnh báo**: người đọc tin nó và đi vá thứ đã vá. Đã gỡ. |
| **N2** | **PH-45** — `useTrangThaiSong` còn **3/4** truy vấn nhận một `factoryId` | ✅ **ĐÓNG bằng đo (vòng 4).** `?pv=tapdoan` gọi **đủ ba** truy vấn, KPI phủ **1.699 máy**. Con số *"~737"* là số tôi **chép từ hồ sơ 09-15 mà chưa đo lại** — đúng lớp *ý kiến có tuổi*. |
| **N3** | **PH-42** — `/factory-command`: bấm nền xoá nhấn sáng nhưng **giữ viền và nhãn** | ✅ **ĐÓNG 2026-09-21 (vòng 6), cả hai tầng.** Sổ `__demChonChiHuy()`: bốn bề mặt đều `null` sau khi bấm nền. Pixel (ẩn lớp nền mờ của ngăn chi tiết, camera đứng yên, đối chứng âm 0/672.570 px): **49.985 px = 7,43 %** đổi, vùng 624×301 bao quanh máy ⇒ **có xoá thật**. ⚠ Câu *"không đo được từ DOM"* của vòng 5 là **SAI** — nhạc cụ đã có sẵn. Xem §3 vòng 6. |
| **N4** | **V-21(1)** — tỉ lệ cảnh báo dự đoán theo hạng sức khoẻ **53,5 / 49,6 / 49,7 / 55,8 %** | ✅ **ĐÓNG 2026-09-21 bằng đo.** Hôm nay: **14,5 → 31,3 → 45,5 → 58,2 %** — đơn điệu tăng, dốc **4×**; đối chứng xáo trộn 200 lượt cho biên độ **≤ 11,6** so với **43,7** thật (**0/200** chạm) ⇒ xu hướng ở **dữ liệu**, không ở truy vấn. ⚠ **Không** kết luận được *"bộ sinh đã chữa"*: mục cũ ghi bốn con số mà **không ghi truy vấn** ⇒ không so được. Xem §4 vòng 5. |

### C3 — CHƯA ĐO (không biết có hỏng không — và đó là cái đáng sợ hơn)

| | việc | vì sao đáng đo |
|---|---|---|
| **M1** | **Màn Máy `/twin/may/:id`** | ✅ **ĐÃ ĐO (vòng 4).** Và nó lòi khuyết tật đúng như dự đoán: **33 đích bấm** hiện con trỏ `pointer` rồi **không làm gì** — *affordance không có chức năng*. Đã vá bằng chip `chip-dich-qua-nho` nói thẳng số đích quá nhỏ. |
| **M2** | **G134 phần còn lại** — *"30 cái được chọn có đúng là 30 cái đáng đọc nhất không"* | ✅ **MOOT, đóng bằng đo (vòng 4).** `vuotTran = 0` ở **mọi** phạm vi: bậc cụm cộng chính sách *chỉ-bất-thường* làm tập ứng viên còn **6** hoặc **1/49** ⇒ **không có lựa chọn nào để mà chọn sai**. Câu hỏi chỉ có nghĩa khi tập ứng viên vượt trần, và nó không vượt. |
| **M3** | Dải cảnh báo tự khai *"Counted across your whole account scope"* trong khi cảnh là **FUYU-F** | ✅ **ĐO 2026-09-21: dải cảnh báo TRUNG THỰC** — `Alarms (80)` y hệt ở cả ba phạm vi, đúng như nó khai. Nhưng phép đo tìm ra **chỗ khác nói sai**: `hang-tong-quan` khai *"toàn nhà máy"* (số ít) trong khi ở cấp tập đoàn nó gộp **1.700 máy / 6 nhà máy** ⇒ **đã vá** `bc1b8abf3`, ablation 2/2 đỏ. |

### C4 — Vận hành / hạ tầng đo

| | việc | ghi chú |
|---|---|---|
| **V1** | `dist/BUILD-INFO.txt` — quy ước ghi lai lịch **không có cơ chế ép** | ✅ **ĐÓNG sau HAI lượt.** Vòng 5 ép ghi trong `npm run build` (`c2f0d1ed6`); vòng 6 phát hiện **chính bản vá ấy bị lách** bởi `vite build` chỉ-client ⇒ gắn vào **vite** (`closeBundle`) và thêm hai dòng **mtime artefact** để mọi độ lệch **tự nói ra** (`51fb9600`). Đây là **lần thứ ba** dự án mất lai lịch. |
| **V2** | Ca chập chờn **CÓ SẴN** `phamViDocPatch.db.test.ts` (~~timeout 5.000 ms, biên 1,46×~~) | ✅ **ĐÓNG bằng đo (vòng 5): không có gì để vá.** Trần thật là hằng có tên `HAN_MS_IO_CSDL = 20.000`; 3 lượt **0 đỏ**, lâu nhất **2.217 ms** ⇒ biên **9,0×**, không phải 1,46×. Hai con số trong ô bên trái là **số cũ chưa đo lại**. |
| **V3** | `npm run build` **ghi đè `dist/index.js` đang chạy** ⇒ giết server | Đã dính **2 lần**; lượt đo kế tiếp báo `ECONNREFUSED` **trông y hệt hồi quy sản phẩm**. Luật: **build TRƯỚC, restart SAU**, rồi kiểm bản đang phục vụ **qua HTTP**. |

---

## D. ĐỀ XUẤT THỨ TỰ CHO VÒNG SAU

Xếp theo **rủi ro im lặng × giá phải trả**, không theo thứ tự dễ làm:

1. **M1 — Đo màn Máy `/twin/may/:id`.** Rẻ nhất, và là chỗ **duy nhất** chưa ai soi. Hai màn kia
   đều lòi khuyết tật *ngay khi* bị đo (đích bấm 0/130, cột WIP 0/39) — không có lý do tin màn
   thứ ba sạch. **Đo trước, đừng vá trước.**
2. **N1 — Task 17c (cộng gốc toà nhà cho mặt bằng tâm trạm).** Đây là món **vỡ im lặng**: hôm nay
   đúng chỉ vì một tiền đề (*cảnh chỉ nạp một toà*) mà **không ai cưỡng chế**. Vòng này đã chứng
   minh đúng lớp lỗi ấy tốn bao nhiêu: cột WIP sai **16,6 m** suốt nhiều đợt mà không ai đỏ.
   Rẻ vì `gocToaTheoTang` đã có sẵn.
3. **N2 — PH-45 gộp bốn truy vấn theo `factoryIds`.** ~737 máy đang không có lời khai trạng thái;
   một khoảng trống có banner vẫn là một khoảng trống.
4. **M2 — Đo chất lượng chọn nhãn ở quy mô tập đoàn.** Gắn với **Q1**: nếu 30 cái được chọn vốn
   đã là 30 cái đáng đọc nhất thì **không cần** nâng trần, và Q1 tự đóng.
5. **Q2 — Dọn `.qa-*`** (cần duyệt) và **V1 — ép ghi BUILD-INFO trong bước build.**
6. **N3 / N4** — hai món nhỏ, làm khi tiện.

### ⚠ Hai luật rút ra từ vòng này, nên mang sang vòng sau

- **"Không đổi" mà chưa đo thì mới là một Ý KIẾN.** Trần 30 nhãn đã suýt được để yên bằng lý lẽ;
  chỉ khi A/B mới biết nâng nó **không** phải cái thắng sạch. Mọi mục trong C1 phải vào vòng sau
  kèm **số**, không kèm lập luận.
- **Một câu "lý do duy nhất" phải kèm TƯ THẾ.** Cùng màn Line, ở trạng thái đứng yên thì cái chặn
  nhãn là **trần 30**; sau khi kéo camera thì là **`deKhoiKhac`**. Kết luận không kèm điều kiện đo
  là kết luận sẽ sai ở lần đo sau.

## toà 94 (bản 2D) — ĐÓNG bằng một phép tính, không bằng một bản vá

Toà 94 còn **64 %** diện tích bấm được, ô vuông trống **32×32 px** ⇒ **đạt** 24×24 và bấm vẫn
điều hướng đúng. Kẻ che là `nut-thu-phai` (`data-testid`, **có** khai `data-che-nhan`), 21×42 px
nép sát mép phải vùng dùng được — không cắt suốt chiều cao nên `daiNgangDung` không trừ nó.

**Cái giá nếu trừ:** vùng dùng được hẹp lại **21/488 = 4,3 %** bề ngang. Ở cấp tập đoàn bề
**ngang** mới là chiều chặn (đo ở vòng 6: thêm lề ĐÁY 28 px **không** đổi tỉ lệ, còn bề ngang thì
đổi) ⇒ **mọi 14 biểu tượng** nhỏ đi 4,3 %: 38,4 → 36,7 px.

⇒ **Không vá.** Bỏ 4,3 % cỡ của **cả 14** biểu tượng để chữa **một** biểu tượng vốn **đã đạt**
tiêu chí là đúng lớp *"vá thành lùi"* mà PH-46 đã ghi. Ghi lại ở đây kèm số để lần sau ai định
mở lại thì mở bằng một con số khác, không bằng cảm giác.

## V4 — **1.149 máy ĐÃ DUYỆT mà KHÔNG có khoá** (phát hiện khi trả nợ truy vấn)

Hồ sơ đợt `0539a1823` ghi *"1.699/1.700 máy có khoá sống, đối soát **CẦN CẤP 0**"*. Viết truy vấn
cho con số ấy — đúng việc mà Sổ truy vấn yêu cầu — thì ra:

| | hồ sơ `0539a1823` | đo 2026-09-21 |
|---|---|---|
| tổng máy | 1.700 | **1.700** |
| đã duyệt (`approved`) | — | **1.698** |
| có khoá sống (`apiKey` khác rỗng, tiền tố `mach_`) | 1.699 | **549** |
| ★ **CẦN CẤP** (duyệt mà không có khoá) | **0** | **1.149** |
| ⚠ có khoá mà **chưa** duyệt (hazard `fa1305b3a`) | — | **0** ✅ |

⇒ **KHÔNG kết luận được là "hồi quy" hay "dữ liệu đã seed lại"** — vì hồ sơ cũ **không ghi truy
vấn**, không có cách nào so cùng một định nghĩa. Đây đúng là cái giá của việc trích một con số mà
không trích phép đo, và lần này nó tốn của chúng ta khả năng biết chuyện gì đã xảy ra.

★ Cái **nói được**: hôm nay **1.149 máy đã được duyệt nhưng không có khoá để chạy**. Duyệt tức là
đã hứa cho nó chạy, nên đây là một khoảng trống **VẬN HÀNH** có thật.
★ Và hazard cũ vẫn sạch: **0** máy có khoá mà chưa duyệt.

⛔ **Tôi không cấp khoá.** Mỗi khoá là một danh tính được phép nói chuyện với hệ thống; cấp 1.149
khoá là một hành động vận hành có hậu quả thật, phải là **một quyết định**, không phải hệ quả phụ
của việc chạy một phép đo. Kịch bản `khoa-may-va-doi-soat.mts` **chỉ đọc**, và trả mã thoát **1**
khi `CẦN CẤP > 0` để cắm được vào cổng kiểm sau này.

## SỔ TRUY VẤN — mỗi con số còn được viện dẫn phải chỉ được về một phép đo

> **Bốn con số không có truy vấn thì không phải bằng chứng — nó là một tin đồn có chữ số thập phân.**
>
> Mục **V-21(1)** ghi *"53,5 / 49,6 / 49,7 / 55,8 %"* mà không ghi truy vấn. Khi đo lại ra
> **14,5 → 58,2 %**, không còn cách nào phân biệt *"dữ liệu đã đổi"* với *"phép đo cũ định nghĩa
> khác"* — mất luôn khả năng so trước/sau của cả một phát hiện. Bảng dưới đây để chuyện ấy không
> lặp lại: **một con số không có dòng trong bảng này thì nó đã hết hạn kiểm chứng.**

| con số đang được viện dẫn | tái hiện bằng | ghi chú |
|---|---|---|
| **14/14** biểu tượng 3D đạt 24 px · nhỏ nhất **25,0 px** @1280×720 | `scripts/do-twin/3d-co-bieu-tuong-toa.mjs` | cần bản dựng mới nhất + ép GPU + `?do=1` |
| bảng **sàn chiều cao** 6/16/18/20/30 m | `scripts/do-twin/san-chieu-cao-va-24px.mts` | ⚠ chỉ tái hiện được các hàng **≥ sàn đang cài**; hàng lịch sử (6 m → 21,7 px) cần **ablation** — đã chạy, ghi ở `142e1e76` |
| **14/14** thông tâm 2D · **7/7** lớp phủ khai `data-che-nhan` | `scripts/do-twin/2d-tam-bieu-tuong-bi-che.mjs` | |
| **21 %** / 6×6 px · **34 %** / 8×8 px (diện tích còn bấm được) | `scripts/do-twin/2d-dien-tich-con-bam-duoc.mjs` | số **trước** bản vá neo đáy; sau vá là 100 % / 64 % |
| PH-42: **7,43 %** canvas đổi · đối chứng âm **0/672.570 px** | `scripts/do-twin/bam-nen-co-xoa-dau-chon.mjs` | ẩn lớp nền mờ của ngăn chi tiết trước khi chụp |
| V-21(1): **14,5 → 31,3 → 45,5 → 58,2 %** · xáo trộn **0/200** | `scripts/do-twin/canh-bao-theo-hang-suc-khoe.mts` | định nghĩa tử/mẫu viết ngay trong kịch bản |
| dữ liệu hình học **không có giá trị vô lý** (12 phép kiểm / 4 bảng) | `scripts/do-twin/ra-soat-du-lieu-twin.mts` | mã thoát 0/1 ⇒ cắm CI được |
| ~~**1.699** máy có khoá sống · **0** cần cấp~~ | `scripts/do-twin/khoa-may-va-doi-soat.mts` | ✅ **ĐÃ TRẢ — và nó lòi ra một việc thật.** Đo hôm nay: **549/1.700** có khoá sống, **CẦN CẤP 1.149** (đã duyệt mà không có khoá). Xem mục **V4** dưới đây. |
| ~~lớp phủ ăn **58,2 %** canvas @1280×720~~ | `scripts/do-twin/lop-phu-an-bao-nhieu-canvas.mjs` | ✅ **ĐÃ TRẢ.** Đo hôm nay (hợp diện tích các `[data-che-nhan]` ∩ canvas): panel **MỞ 56,7 %** · panel **THU 11,3 %**, giống nhau ở cả hai phạm vi (lớp phủ là khung TRANG, không phụ thuộc cảnh). Số cũ **không tái hiện được** vì định nghĩa cũ không được ghi — nhưng hôm nay *panel mở* đã tốt hơn cả *panel thu* của hồ sơ cũ. |
| ~~**1.108** máy / 3 nhà máy~~ | `scripts/do-twin/khoa-may-va-doi-soat.mts` | ✅ **ĐÃ TRẢ.** CSDL hôm nay: **1.700** máy (1.699 `isActive`, 1.698 `approved`); cảnh 3D vẽ **1.699**. Mọi chỗ còn ghi 1.108 là số của tập QATD lúc chưa nạp đủ nhà máy. |

★ Ba dòng cuối là **nợ thật**, ghi ra để đừng ai trích chúng như bằng chứng. Chúng không chặn
việc gì hôm nay, nhưng ai cần tới chúng thì phải **đo lại trước**, không được chép.


---

# VÒNG 4 (2026-09-20) — HAI QUYẾT ĐỊNH ĐƯỢC THI HÀNH, BỐN MỤC ĐÓNG

## Q2 · Dọn sạch (`340e30ac7`)

Đo **trước** khi xoá: **32 thư mục · 9,12 GB · 59.000+ tệp** — không phải 378 MB như tôi báo ở
hồ sơ backlog. Lần ấy `du` timeout và tôi đọc hụt **24 lần**.

⇒ Xoá hết, nhưng **giữ lại 2.422 tệp `*.json`/`*.md` (40,1 MB = 0,4 %)** vào `.do-luutru/`, vì
các hồ sơ trong `docs/superpowers/plans/` trích dẫn **thẳng** tới chúng — xoá sạch thì mọi trích
dẫn thành trích dẫn treo và không ai kiểm lại được con số nào. Loại: ảnh, video, `src-nen/` (bản
sao mã nguồn), `dist-*/`, log test. Còn nguyên `.qa-tapdoan/BAN-CHUAN.md` (bản khai của phiên khác).

★ Kho tên `.do-luutru` chứ **không** `.qa-luutru`: đặt trùng khuôn thì chính lệnh dọn ăn mất nó.

## Q1 · Ngân sách nhãn THEO MÀN (`0bf254248`)

Không nâng một hằng — **thay hằng bằng chính số máy của chuyền**, kẹp giữa **sàn 30** (ngân sách
theo màn chỉ được NỚI cho ca nhẹ, không được siết) và **trần 60** (DOM là chi phí thật).

| | trần 30 | trần theo màn | |
|---|---|---|---|
| @1280×720 | 30/39 · vượtTrần 8 | **37/39** · vượtTrần 0 | **+7 tên** |
| @1920×1080 | 30/39 · vượtTrần 9 | **39/39 — đủ hết** | **+9 tên** |
| long task TB @1920 | 70,3 | **64,3** | không tăng |

### ⚠ Đính chính một kết luận của chính tôi

Lượt trước tôi báo *"long task 1 → 5"* khi A/B trần 30↔60 và dùng nó để nói nâng trần **có giá**.
Đo lại bằng harness đúng (N=3, observer cùng chỗ, cùng trạng thái cảnh) thì **nền cũng 70,3** —
tức ~64 kia là **của cảnh**, không phải của nhãn. Con số cũ là **n=1** và tôi đã đọc nhiễu thành
tín hiệu. ★ **Một phép đo n=1 không đủ để biến "có giá" thành một lý do quyết định.**

## M1 · Màn Máy — đo trước, vá sau (`fd40e1108`)

Đề xuất #1 là *đo màn Máy trước khi vá bất cứ gì*, vì hai màn kia đều lòi khuyết tật **ngay khi**
bị đo. Nó cũng hỏng, và hỏng **theo một kiểu khác**.

Mỗi khối hàng xóm là **đích bấm thật** (§15.3.3 đường ra ⑥), và màn ấy **không có một link
`/twin/may/:id` nào** ⇒ bấm khối 3D là đường đổi máy **duy nhất**. Bấm tâm từng hàng xóm (n = 38):

| cạnh nhỏ | bấm đúng |
|---|---|
| **≥ 24×24 px** | **5/5 = 100 %** |
| **< 24×24 px** | **3/33 = 9 %** |

⇒ **30/38** khối trông như đích bấm mà bấm thì **không đi đâu cả, im lặng**.

★★★ Và ngưỡng WCAG 2.5.8 hoá ra **gần đúng bằng chỗ phép bấm bắt đầu hỏng** — một **xác nhận
thực nghiệm** cho con số mà cả đợt này đã dùng, thay vì một quy ước mượn về.

Chữa bằng **khai ra**, không bằng phóng to (phóng to = phá chính ngữ cảnh *"máy nào cạnh máy
nào"* mà §10C.2 cố ý giữ): chip *"33 máy quá nhỏ để bấm — mở ở màn Chuyền"*.

## N1 · Task 17c — gỡ ngòi (`de42157d8`)

Tâm trạm nay cộng **gốc toà nhà**, cùng bản đồ mà `dungMayVe` dùng cho máy. **Không đổi một pixel
nào hôm nay** (đo lại: cột WIP 39/39 đúng chỗ, khối 39, đạt24 39/39, `/twin` ô trạm 24 với WIP
thật) — và đó chính là điểm: nó chỉ gỡ ngòi.

★ Lưới phải đo **ca TƯƠNG LAI** (gốc toà ≠ 0, hai toà), vì một lưới chỉ đo ca hôm nay sẽ xanh
**cả trước lẫn sau** bản vá — tức không đo gì cả.

## N2 + M2 — ĐÓNG BẰNG ĐO, và một mục backlog của tôi là mục CŨ

**N2 (PH-45)**: đo ở `/twin?pv=tapdoan` — cả ba truy vấn trạng thái **đều chạy**, KPI phủ
**1699 máy**. Tức PH-45 **đã được vá từ trước** bởi `doiSoNhaMay`; con số *"~737 máy không có lời
khai trạng thái"* là số tôi **bê từ hồ sơ 09-15 sang mà chưa đo lại**.

⚠ Và phép đo ấy suýt sinh ra một phát hiện GIẢ: lần đầu KPI ra `Running 0 · Offline 1699 · OEE
trên 0 máy`. Bơm nhịp tim rồi đo lại: **Running 442 · Down 39 · Maintenance 27 · rate 26 %**.
⇒ số 0 là **DỮ LIỆU hết hạn**, không phải lỗi sản phẩm — đúng ba loại mà chủ dự án đòi tách:
**LOGIC / DỮ LIỆU / VẬN HÀNH**.

**M2 (chất lượng chọn 30 nhãn)**: đo `__demNhan` ở ba phạm vi — `vuotTran` = **0** ở tất cả.
Sau HM-1 (bậc cụm) cộng chính sách *chỉ-nhãn-bất-thường*, tập ứng viên còn **6** (FUYU-F) hoặc
**1/49** (nhà máy mặc định), nên **trần 30 không còn chạm tới ở bất kỳ phạm vi nào của `/twin`**.
Chỗ duy nhất nó từng chạm là màn Line — và **Q1 vừa gỡ**. ⇒ M2 **moot**: không có lựa chọn nào
để mà chọn sai.

## CÒN MỞ — cập nhật

- **Khoảng trống ĐO ở cấp tập đoàn**: `__demNhan` **không tồn tại** ở `pv=tapdoan` (sa bàn dùng
  `LopSaBan` với lớp nhãn riêng, chưa gắn sổ). Tức câu *"có bao nhiêu nhãn toà bị giấu"* **không
  đo được từ ngoài**. Đúng lớp *"một lưới xanh cho một hàm không ai gọi"*.
- **~60–70 long task mỗi 3 s kéo camera @1920×1080** trên màn Line — phát hiện mới của vòng này,
  **của cảnh** chứ không của nhãn (ablation đã tách). Chưa truy gốc.
- N3 (PH-42) · N4 (V-21 mục 1) · V1 (ép ghi BUILD-INFO) · V2 (ca chập chờn có sẵn).

## Cổng

`tsc` **0** · `twin3d`+`pages` **958 tệp / 3.602 ca / 0 đỏ** · `i18n:check` **0** ·
e2e `twin-dot47-bam-canh` **16/16** · cây sạch.

---

# M5 — ĐÓNG BẰNG MỘT KẾT QUẢ ÂM TÍNH: THIẾT BỊ ĐO TỰ SINH RA PHÁT HIỆN, LẦN NỮA

Phát hiện *"~60–70 long task mỗi 3 s kéo camera @1920×1080 trên màn Line"* là **hiện vật của
trình kết xuất phần mềm trong trình duyệt headless**, **không** phải khuyết tật sản phẩm.

## Bước 0 — phép đo có phân biệt được NỘI DUNG với SỐ PIXEL không?

Cùng một kịch bản kéo, ba màn × hai khung:

| khung | màn | canvas | lệnh vẽ / tam giác | long task |
|---|---|---|---|---|
| 1280×720 | Line (39 khối, 35 nhãn) | 424k px | 6 / 3.686 | **0** |
| 1280×720 | Máy | 190k px | 5 / 254 | 0 |
| 1280×720 | /twin (cụm) | 473k px | 5 / 7.538 | 0 |
| 1920×1080 | **Line (39 khối)** | 1.282k px | 6 / 3.566 | **54 (3.263 ms)** |
| 1920×1080 | Máy | 475k px | 5 / 254 | **0** |
| 1920×1080 | **/twin (45 khối)** | **1.365k px** | 5 / **9.998** | **0** |

⇒ **Không phải số pixel**: `/twin` canvas **lớn hơn** và tam giác **gấp ba** mà vẫn **0**.
Đặc thù của **màn Line ở khung lớn**.

## Ablation A — gỡ đúng một lớp

`dongChay = null` (mũi tên dòng chảy) ⇒ màn Line @1920: **54 → 0** long task.
⇒ lớp gây ra là `DongChayLine`. Cơ chế đọc được trong mã: `useFrame` coi **camera đổi = một
kích**, nên suốt lúc kéo nó gọi `datMuiTen` + `invalidate()` **mỗi khung** — tức cảnh vẽ liên
tục ở tốc độ tối đa thay vì vài khung rời rạc.

## ★★★ Nhưng "vẽ liên tục lúc kéo" là ĐÚNG — và đây mới là chỗ tôi suýt báo sai

Đo lại cùng trang, cùng kịch bản, chỉ đổi **trình kết xuất**:

| trình kết xuất | long task | khung/s | thời gian kịch bản |
|---|---|---|---|
| **SwiftShader** (headless mặc định) | **51 (3.250 ms)** | **19** | 8,5 s |
| **GPU thật** (RTX 5090, ANGLE/D3D11) | **0 (0 ms)** | **60** | 3,7 s |

Trên GPU thật, chính màn ấy chạy **60 khung/s, 0 long task**. Tức `DongChayLine` không "gây"
long task; nó chỉ **yêu cầu vẽ 60 khung/s**, và một trình rasterise **bằng CPU** biến mỗi khung
thành một tác vụ dài. Trình kết xuất phần mềm còn **kéo dài cả kịch bản** 3,7 s → 8,5 s.

⇒ **KHÔNG vá gì.** Sửa `DongChayLine` để nó vẽ ít khung hơn là hạ chất lượng hoạt ảnh trên máy
thật để làm đẹp một con số chỉ tồn tại trong máy đo.

## Hệ quả cho HỆ ĐO — phần đáng giá nhất của lượt này

**Mọi con số hiệu năng đo bằng harness headless của repo này là con số SwiftShader**, trừ khi ép
GPU. Cờ đã kiểm được:

```
chromium.launch({ headless: true, args: [
  "--use-gl=angle", "--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist",
]})
```
Kiểm nhanh trình kết xuất thật đang dùng:
`gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL)`
— ra `SwiftShader Device` hay `NVIDIA … Direct3D`.

★ **Đã kiểm: không cổng nào đang bị SwiftShader quyết.** Trong `e2e/`, khẳng định duy nhất chạm
`longTask` là `toBeGreaterThanOrEqual(0)` — ghi số, **không phán quyết**; và không ca nào ghim
một ngưỡng `khung/s`. Nên không có gì phải sửa lại, chỉ có một luật phải nhớ.

⚠ Các con số fps của những vòng trước (ví dụ *"9,2 → 60 khung/s"* của `byteMau`) là **so sánh
tương đối dưới cùng một trình kết xuất** và đều có ablation, nên **kết luận vẫn đứng**; chỉ là
trị tuyệt đối của chúng là trị phần mềm, không phải trị trên máy người dùng.

## ⚠ Một nhiễu khác bắt được cùng lượt

Ở lượt ablation, `/twin` ra `8 long task` trong khi hai lượt khác ra `0` — cùng bản dựng, cùng
kịch bản. Tức **long task trên máy đo là biến ồn**; một mẫu `n=1` không đủ để kết luận, đúng bài
học vừa ghi ở Q1.

## Cổng

Cây sạch (ablation đã hoàn nguyên), `tsc` **0**, không đổi một dòng mã sản phẩm nào.

---

# M4 — CŨNG ĐÓNG BẰNG ÂM TÍNH, VÀ MỤC BACKLOG CỦA TÔI LẠI SAI

Tôi ghi: *"`__demNhan` **không tồn tại** ở `?pv=tapdoan` ⇒ câu «có bao nhiêu nhãn toà bị giấu»
**không đo được từ ngoài**"*.

**Sai.** Sổ đo **có sẵn** — chỉ là dưới **tên khác**, vì nó là một lớp khác:
`window.__demSaBan.soNhan()` (và `__demSaBan.bieuTuong()`), gác bởi cùng `laCheDoDo()`.
Thước của tôi tra `__demNhan`, không thấy, rồi kết luận *"không đo được"*.

> ★★★ Đây là **lần thứ bảy** trong mạch việc này mà **phép đo của tôi tự sinh ra kết luận**:
> lần này nó biến *"tôi tìm sai chỗ"* thành *"hệ thống thiếu thiết bị đo"* — và suýt biến thành
> một hạng mục công việc.

## Đo thật (ép GPU, xem M5)

| khung | nhãn | biểu tượng | cạnh nhỏ nhất | đạt 24×24 |
|---|---|---|---|---|
| 1280×720 | **19/19 vẽ · 0 ẩn** | 14 (trong khung 14) | **21,7 px** | **13/14** |
| 1920×1080 | **19/19 vẽ · 0 ẩn** | 14 (trong khung 14) | 42,6 px | **14/14** |

`anVungCam` = 0, `anNgoaiKhung` = 0 ở cả hai khung ⇒ **không nhãn toà nào bị giấu**.

## Con số 21,7 px có phải khuyết tật không — hỏi bằng KẾT CỤC

Bấm tâm ba biểu tượng (nhỏ nhất **21,7 px**, giữa 49,1 px, lớn nhất 58,6 px):
**cả ba đều KHÔNG điều hướng** — URL chỉ thêm `cam=`, tức cú bấm được hiểu là một cú xoay.
⇒ Ở cấp tập đoàn, biểu tượng toà **không phải đích bấm**; đường đi phạm vi là ô `<select>`.

Và sa bàn **không hứa** điều nó không giao — đo con trỏ, có đối chứng:

| | con trỏ |
|---|---|
| nền trống (tập đoàn) | `auto` |
| **biểu tượng toà** (tập đoàn) | **`auto`** |
| **cụm** (cấp nhà máy — đối chứng, là đích bấm thật) | **`pointer`** |

⇒ **Ngược hẳn khuyết tật M1.** Ở màn Máy, 30/38 khối hiện `pointer` rồi không làm gì —
*affordance không có chức năng*. Ở sa bàn tập đoàn, không có lời hứa nào để mà lỗi hẹn.
Tiêu chí 24 px vì thế **không ràng buộc** ở đây theo nghĩa bấm; 21,7 px chỉ là **biên đọc**,
và tiêu chí nghiệm thu của Task 20 vốn đòi ≥ 24 px cho **đọc được**, không cho bấm.

## ⚠ MỘT CÂU HỎI THIẾT KẾ — để lại cho chủ dự án

Ở **cấp nhà máy**, một biểu tượng = một phạm vi **bấm được** (cụm ⇒ `/twin/line/:id`).
Ở **cấp tập đoàn**, một biểu tượng trông tương đương nhưng **không bấm được**; đổi phạm vi phải
qua ô `<select>`.

Hai lối, mỗi lối một cái giá:

| | làm gì | được | giá |
|---|---|---|---|
| **(a)** | giữ nguyên | 0 | người dùng học hai luật cho hai cấp, nhưng **không ai bị lừa** (con trỏ `auto` nói thật) |
| **(b)** | cho bấm biểu tượng toà ⇒ vào nhà máy/toà ấy | một luật duy nhất cho mọi cấp | phải kéo cỡ biểu tượng lên **≥ 24 px ở mọi khung** (hiện 13/14 @1280), tức chạm bố cục Task 20 |

Tôi **không tự chọn**: (b) thêm một đường điều hướng mới ở một cấp mà tiêu chí nghiệm thu Task 20
**cố ý không có tiêu chí bấm** — đó là đổi phạm vi, không phải chi tiết kỹ thuật.

## Cổng

Không đổi một dòng mã sản phẩm nào; cây sạch.

---

# VÒNG 5 (PDCA, 2026-09-21) — VÁ PHẦN CÒN LẠI, VÀ CÔNG CỤ VỪA THÊM BẮT LỖI CỦA CHÍNH TÔI

**Đề bài của chủ dự án:** *"Tiếp tục vá các phần còn lại và chạy PDCA để kiểm tra."*
Phạm vi: **M3 · N3 (PH-42) · N4 (V-21 mục 1) · V1 (ép ghi BUILD-INFO) · V2 (ca chập chờn)**.

## 1. Bước 0 (MSA) — trạng thái hệ đo

| kiểm | kết quả |
|---|---|
| thứ đang chạy = thứ vừa sửa? | tệp sản phẩm mới nhất **00:55** < bản dựng **00:58** ⇒ khớp |
| đường độc lập | grep **qua HTTP** chunk đang phục vụ: có `onChonToa` ⇒ đúng bản, không đọc từ đĩa nguồn |
| ai đang sửa dở vùng này? | `client server shared e2e scripts docs` **sạch** — ⚠ phép kiểm này **HẸP**, xem §5 |
| cache giữa đường? | react-query `staleTime 30 s` / `gcTime 5 min`, nhưng **mỗi mẫu một context mới** + `goto` lại ⇒ không bắc cầu |
| trình kết xuất | **ép GPU** (`--use-gl=angle --use-angle=d3d11`) ở mọi phép đo — luật hệ đo rút ra ở M5 |

## 2. Hiện trạng — và loại của từng chỉ số

| chỉ số | loại |
|---|---|
| "3.629 ca lưới xanh" | **THAY THẾ** |
| "14/14 bấm đúng", "6/6 đạt 24×24" | KẾT CỤC (đã đo vòng 4) |
| M3 · N3 · N4 · V1 · V2 | **chưa có chỉ số kết cục nào** ⇒ chính là chỉ tiêu vòng này |

## 3. Đường cơ sở + kết cục

| mã | đo được (đường cơ sở) | phán quyết | sau khi vá |
|---|---|---|---|
| **M3** | `hang-tong-quan` đếm **371 / 549 / 1.700** = đúng `dem-may`, trong khi khai *"the whole **factory**"* (số ít) | **SAI** ở cấp tập đoàn | *"(counted across the **6** factories currently loaded)"*; một nhà máy giữ nguyên câu cũ |
| M3 — đối chứng | `dai-canh-bao` khai *"whole account scope"*; `Alarms (80)` **y hệt** ở cả ba phạm vi | **ĐẠT** (trung thực) | không đụng |
| **V1** | `dist/BUILD-INFO.txt` **không tồn tại**; **0 dòng** trong `npm run build` sinh ra nó | **HỎNG** | `ghi-lai-lich-ban-dung.mjs` chạy **TRONG** `build` |
| **V2** | trần là hằng có tên `HAN_MS_IO_CSDL = 20_000`; 3 lượt, **0 đỏ**, lâu nhất **2.217 ms** | **ĐẠT** — biên **9,0×** | *(số "biên 1,46×" trong backlog là số CŨ)* |
| **N3** | bấm máy ⇒ drawer mở (`aside` 1→2); bấm nền ⇒ drawer **đóng** (2→1) | **ĐẠT** phần đo được từ DOM | không đụng — xem §7 |
| **N4** | tỉ lệ cảnh báo theo hạng sức khoẻ **14,5 → 31,3 → 45,5 → 58,2 %** | **ĐẠT** — đơn điệu tăng, dốc **4×** | *(mục cũ ghi "phẳng và ngược chiều")* |

Thô: `.qa-v2/tho-v5/_m3.json` · `_m3c.json` · `factory-command.png` · `v5-n4b.txt`.
⚠ Thư mục `.qa-*` nay **ngoài sổ** (§5) ⇒ thô nằm trên đĩa máy đo, **không** trong commit. Mọi
con số dưới đây vì thế được chép **nguyên văn** vào tài liệu này để còn đếm lại được.

## 4. N4 — đo có ĐỐI CHỨNG, và một mục backlog không kiểm lại được

**Định nghĩa phép đo** (phải viết ra, vì mục cũ **không** viết): với mỗi máy lấy `healthScore`
**mới nhất** trong `machine_health_history`, chia bốn hạng; tử số là số máy có **≥ 1** hàng
`predictive_alerts` trong **30 ngày**.

```
hạng sức khoẻ | máy | có cảnh báo 30d | tỉ lệ %
  A 85-100  |  420 |   61 | 14.5
  B 70-84   |  431 |  135 | 31.3
  C 50-69   |  576 |  262 | 45.5
  D <50     |  273 |  159 | 58.2
  tỉ lệ NỀN (mọi máy) = 36,3 %
```

★★★ **Đối chứng xáo trộn** — trước khi tin xu hướng, phải loại khả năng **chính hình dạng truy
vấn** sinh ra nó. Giữ nguyên cỡ bốn hạng, gán ngẫu nhiên máy vào hạng, chạy lại đúng phép đếm ấy,
**200 lượt**:

| | biên độ (max − min) |
|---|---|
| **THẬT** | **43,7** điểm % |
| xáo trộn, lượt lớn nhất trong 200 | **11,6** điểm % |
| số lượt xáo ≥ thật | **0 / 200** |

⇒ Xu hướng nằm trong **dữ liệu**, không nằm trong phép đếm. (`.qa-v2/v5-n4b.mts`)

★★★ **Nhưng tôi KHÔNG kết luận được "bộ sinh đã được chữa".** Mục V-21(1) ghi bốn con số
**53,5 / 49,6 / 49,7 / 55,8 %** mà **không ghi truy vấn nào sinh ra chúng** — đã tìm khắp `docs/`
và các thư mục đo: không có. Nên hai khả năng **không phân biệt được**:

1. bộ sinh dữ liệu đã đổi từ 2026-09-15 tới nay;
2. hoặc phép đo cũ định nghĩa tử số/mẫu số **khác** phép đo này (ví dụ đếm *số cảnh báo* chứ
   không phải *số máy có cảnh báo*, hoặc cửa sổ khác 30 ngày).

Cái **nói được**: với định nghĩa đã viết ra ở trên, **hôm nay quan hệ đúng chiều và dốc**, và
**không có phép đo nào hiện có** chống đỡ cho câu *"lỗi bộ sinh"*. Mục N4 vì thế **đóng**, và đóng
kèm định nghĩa để lần sau ai đó cãi lại được.

> ⇒ **LUẬT MỚI: một mục backlog phải mang theo TRUY VẤN của nó, không chỉ con số.**
> Bốn con số không có truy vấn thì không phải bằng chứng — nó là một tin đồn có chữ số thập phân.
> Đây là lỗi của chính sổ tay này, và nó đã làm mất khả năng so sánh trước/sau của một phát hiện.

## 5. ★★★ CÔNG CỤ VỪA THÊM (V1) BẮT NGAY MỘT LỖI CỦA CHÍNH TÔI

Lần chạy đầu tiên, `ghi-lai-lich-ban-dung.mjs` in `sach=false · so-tep-ban=4764` — một con số
**không giải thích được** bằng bất cứ thay đổi nào tôi vừa làm. Truy ra:

- Đợt dọn **Q2** xoá 32 thư mục `.qa-*`. Tôi báo cáo chúng là **"untracked"**. **SAI**: **4.731**
  tệp `.qa-*` nằm **trong HEAD**. Xoá chúng để lại **4.726 lượt xoá treo lơ lửng**, chưa ghi nhận.
- **Vì sao tôi không thấy**: mọi lần tôi báo *"cây sạch"* đều chạy
  `git status --porcelain client server shared e2e scripts docs` — một **pathspec HẸP** không bao
  giờ nhìn tới `.qa-*`.
  ⇒ ★★★ **Một phép đo chỉ nhìn chỗ mình chọn thì không bao giờ thấy chỗ mình không chọn.** Cùng
  lớp với "bộ chọn `[data-ma-may]` định nghĩa ra kết cục" (QA lần 11) — chỉ lần này nạn nhân là
  phép kiểm *"có ai đang sửa dở vùng này không"* của **chính Bước 0**.
- Và câu *"xoá hết thì mọi trích dẫn thành trích dẫn treo"* trong báo cáo Q2 cũng **SAI**:
  `git show <commit>:.qa-dot47/e2e/t1a-man-twin-line-1280.json` đọc lại được **nguyên văn** — đã
  kiểm thật. Lịch sử git giữ trọn; `.do-luutru/` chỉ là bản chép tay cho tiện.

Đã xử (`8a3eb08fa`): `.gitignore` thêm `.qa-*/`, `git rm -r --cached '.qa-*'` ⇒ cây bẩn
**4.765 → 33**, trong đó **28 tệp `knowledge/` có TRƯỚC phiên này** (vùng của tiến trình khác —
**ghi lại, không đụng**).

⚠ **Cái giá đã biết của quyết định ấy:** kịch bản đo nay **ngoài sổ**. Dùng được ngay, nhưng
không đi theo commit. Nếu một phép đo trở thành **bằng chứng thường trực** (như `v5-n4b.mts`),
chỗ đúng của nó là `scripts/` — **việc của vòng sau**, không tự làm trong vòng này vì nó đổi phạm vi.

## 6. Ablation — bản vá có thật sự là nguyên nhân không

| bản vá | gỡ ra | kết quả |
|---|---|---|
| **M3** | bỏ nhánh `soNhaMayNap > 1` | lưới **ĐỎ 1/4** |
| **M3** (G12) | chép lại biểu thức thay vì dùng chung biến `soNhaMayNap` | lưới **ĐỎ 1/4** |
| **M3** (đường sống) | đo **trước** bản vá, trên chính bản dựng cũ | *"the whole factory"* ở cấp tập đoàn ⇒ đường cơ sở tái hiện |
| **N4** | xáo trộn hạng, giữ nguyên cỡ | biên độ **43,7 → ≤ 11,6**, **0/200** lượt chạm ⇒ xu hướng không tự thoả |
| **V1** | — | công cụ **tự chứng minh**: nó bắt 4.764 tệp bẩn ngay lần chạy đầu (§5) |

## 7. CÒN MỞ — nói thẳng, không để người đọc tự suy là đã xong

- **N3 phần còn lại** — *"viền còn sót trong cảnh WebGL"* **không đo được từ DOM**. Cần một phép
  đo **pixel** (chụp trước/sau, so ô). Phần đo được (drawer đóng khi bấm nền) **ĐẠT**; phần còn
  lại **chưa ai đo**.
- **2/14 biểu tượng 2D** có **tâm** nằm dưới hai huy hiệu nhỏ chưa khai `data-che-nhan`. Mọi nhà
  máy vẫn tới được (**5/5**), nên đây là khuyết tật *đích bấm*, không phải *đường đi*.
- **1/14 biểu tượng 3D ở 21,7 px** (< 24) @1280×720. Ép đủ đòi **dựng lại mốc đo sống
  673,2 × 553,2 m + hai đối chứng dương PH-46/PH-47** của Task 20 ⇒ **chờ chủ dự án**, không phải
  chỗ tôi tự nới.
- **Kịch bản đo ngoài sổ** — xem cảnh báo cuối §5.
- **28 tệp `knowledge/`** bẩn từ trước phiên này — vùng của tiến trình khác, **không đụng**.

## 8. Pareto — và nguyên nhân chi phối là của TÔI, không của mã

| nguyên nhân | số mục |
|---|---|
| **mục backlog chưa đo lại** — đã được chữa từ trước, hoặc moot, hoặc không kiểm lại được | **4** — N2 · M2 · V2 · N4 |
| lời khai có **hạn sử dụng** mà không ai cưỡng chế hạn | 2 — M3 · Task 17c (vòng 4) |
| quy ước **không có cơ chế ép** | 1 — V1 |

⇒ **Quá nửa backlog của tôi là ý kiến có tuổi.** Khuôn ghi ở vòng 4 (*"một mục backlog chưa đo
lại là một ý kiến có tuổi"*) nay có **bốn ca**, không phải một — và N4 cho biết dạng nặng nhất
của nó: một mục **không mang theo truy vấn** thì đến *so sánh trước/sau* cũng không làm được.

## 9. Vòng sau — nguyên nhân tiếp theo, kèm điều kiện mã chính xác

1. **Phép đo pixel cho N3** — chụp `/factory-command` trước/sau `onPointerMissed`, so vùng quanh
   khối vừa bỏ chọn. Điều kiện: cùng bộ cờ GPU của §1, cùng khung, cùng dữ liệu.
2. **`data-che-nhan` cho hai huy hiệu nhỏ ở bản 2D** — cơ chế đã có (`layVungCam`), thiếu đúng
   thuộc tính trên hai nút. Kết cục phải đo: **14/14 tâm biểu tượng không bị che**.
3. **Đưa kịch bản đo thường trực vào `scripts/`** — đổi phạm vi, cần chốt.
4. **Hồi tố truy vấn cho các mục backlog còn số mà không có phép đo** (luật §4).

## 10. Cổng

`tsc` **0** · `twin3d` + `pages` **966 tệp / 3.629 ca / 0 đỏ** · `i18n:check` **0** ·
e2e `twin-dot47` **16/16** (vòng 4; vòng này không đổi mã trên đường ấy).
Commit vòng 5: `8a3eb08fa` (Q2 đính chính) · `bc1b8abf3` (M3) · `c2f0d1ed6` (V1).

---

# VÒNG 6 (PDCA, 2026-09-21) — ĐÓNG PHẦN CÒN MỞ, VÀ BA LỜI KHAI SAI CỦA VÒNG 5

**Đề bài của chủ dự án:** *"Tiếp tục xử lý các phần còn mở, khảo sát chi tiết sau đó mới bắt tay
vào làm."* ⇒ khảo sát trước, vá sau. Phạm vi: **N3 (PH-42)** · **2/14 biểu tượng 2D bị che** ·
mọi thứ Bước 0 lôi ra.

## 1. Bước 0 (MSA) — và nó lôi ra một việc mới ngay

| kiểm | kết quả |
|---|---|
| ai đang sửa dở vùng này? | `git status` **KHÔNG pathspec** (bài học vòng 5): 28 tệp theo dõi bẩn, **toàn bộ** là `knowledge/` của tiến trình khác ⇒ ghi lại, không đụng |
| thứ đang chạy = thứ vừa sửa? | chunk `TwinVanHanh-*.js` **qua HTTP** có `demTheoNhieuNhaMay` **và** `onChonToa` ⇒ client đang phục vụ CÓ bản vá M3 |
| trình kết xuất | ép GPU (`--use-gl=angle --use-angle=d3d11`) ở mọi phép đo |
| **lai lịch bản dựng** | ★ **`BUILD-INFO.txt` ĐANG NÓI SAI** — xem §2 |

## 2. ★★★ V4 (MỚI) — CHÍNH BẢN VÁ V1 CỦA VÒNG 5 BỊ LÁCH

| | |
|---|---|
| `dist/BUILD-INFO.txt` khai | `commit=8a3eb08fa` · `luc-dung=08:01` |
| `dist/public/index.html` **đang phục vụ** | mtime **08:42**, dựng từ commit **muộn hơn** (đã có M3) |

⇒ Tệp lai lịch **nói sai về chính thứ đang chạy** — đúng lớp PH-43 mà nó sinh ra để chặn. Đây là
**lần thứ ba** dự án mất lai lịch, và lần này **chính bản vá bị lách**.

**Gốc:** bước ghi lai lịch chỉ là mắt xích **cuối** của `npm run build`. Một lượt dựng **chỉ
client** (`vite build` — việc ai cũng làm khi sửa UI cho nhanh) không chạm tới nó.

> ★★★ **Một hàng rào chỉ chặn được lối chính thì không phải hàng rào.**

**Đã vá** (`51fb9600`): tách `pluginGhiLaiLich()` và gắn vào **vite** (`closeBundle`,
`apply:"build"`) ⇒ đường dựng nào cũng ghi; thêm `duong-dung=` (cli|vite); và thêm **hai dòng
đối chiếu** `client-index-html-mtime=` / `server-index-js-mtime=` để người đọc **tự** so
`luc-dung` với thứ đang nằm trên đĩa. Nếu mai này còn đường dựng nào lách được nữa, hai con số
ấy **tự nói ra** thay vì im lặng.
*Kiểm:* chạy thật ⇒ `duong-dung=vite`, và hai dòng mtime phơi đúng độ lệch **client 02:08 /
server 01:42** — chính độ lệch đã đánh lừa tôi ở Bước 0.

## 3. N3 / PH-42 — ĐÓNG, sau **bốn** lượt đo, mỗi lượt bị đối chứng bác một lần

**Đính chính vòng 5:** tôi viết *"không đo được từ DOM, cần phép đo pixel"*. **Sai.**
`CanhNhaMay.tsx` có sẵn **`window.__demChonChiHuy()`** trả đúng bốn bề mặt — nhạc cụ dựng riêng
cho câu hỏi này. Nó đo **QUYẾT ĐỊNH**; pixel trả lời câu **khác** (màn hình có sạch theo không).

### Sổ quyết định — sạch tuyệt đối

| trạng thái | `trang` | `nhanSang` | `vien` | `nhan` |
|---|---|---|---|---|
| ① nền | null | null | null | null |
| ② chọn | 9176 | 9176 | 9176 | 9176 |
| ③ **bấm nền** | **null** | **null** | **null** | **null** |

⇒ Khuyết tật gốc của PH-42 — *"bốn bề mặt nói một đằng, lô máy nói một nẻo"* (`{trang:202,
nhanSang:null, vien:202, nhan:202}`) — **không còn tái hiện**.

### Bốn lượt pixel, và vì sao ba lượt đầu vứt

| lượt | thước | kết quả | đối chứng bác bằng gì |
|---|---|---|---|
| 1 | ô cắt **cố định** trên màn | 87,28 % khác | **lớn hơn cả đối chứng dương** (68,47 %) ⇒ cờ đỏ. Máy dò `dsMay()`: **40/40 máy đổi toạ độ** ⇒ đang đo **camera** |
| 2 | ô cắt **neo vào máy** | đối chứng dương **0 px** | phép đo **mù** ⇒ không kết luận |
| 3 | **toàn canvas** ở ②↔③ | 98,89 % khác | dò DOM ra thủ phạm: **lớp nền mờ 1600×900** của ngăn chi tiết Radix |
| **4** | toàn canvas, **ẩn đúng 2 lớp DOM ấy** | **49.985/672.570 px = 7,43 %**, vùng khác **624×301** bao quanh máy | ba đối chứng đều đạt |

Đối chứng lượt 4: camera **đứng yên** (toạ độ máy khớp tới 3 chữ số thập phân) · canvas **cùng
cỡ** · đối chứng âm ④↔③ = **0/672.570 px**.

⇒ **Bấm nền CÓ xoá dấu chọn khỏi cảnh.** N3 **ĐÓNG**, cả ở tầng quyết định lẫn tầng pixel.

★ **Quan sát mới, không phải khuyết tật đã khai:** chọn một máy làm **camera bay** (máy 9176 từ
`(224,420)` sang `(471,358)`, tỉ lệ màn 105,13 → 107,17) và **không quay về** khi bỏ chọn. Ghi
lại để ai đo màn này còn biết, đừng như tôi ở lượt 1.

## 4. 2/14 biểu tượng 2D — VÀ LỜI KHAI SAI THỨ HAI

**Vòng 5 tôi viết:** *"hai huy hiệu nhỏ **không khai** `data-che-nhan`"*.
**Đo lại bằng `elementFromPoint`:** kẻ chặn là `cum-trang-thai-du-lieu`, và nó **CÓ**
`data-che-nhan=1`. **7/7** lớp phủ đều khai đủ. Cơ chế `layVungCam` chạy đúng.

> ⇒ Tôi đổ lỗi cho **một thuộc tính bị quên** trong khi gốc là **một luật hình học**.
> Cùng lớp với *"kết luận từ TÊN biến đếm"*: đọc tên cơ chế rồi đoán, thay vì hỏi DOM.

**Gốc thật:** `vungDungCanvas` **chỉ trừ lớp phủ cắt SUỐT một chiều** — giới hạn **CỐ Ý**, đã ghi
trong docblock của chính nó (trừ một thẻ **góc** thành cả dải là vứt mất một mảng canvas; PH-46
đo được: cảnh MỘT cụm chỉ còn 233 px so với 430 px). Bản 3D bù lại bằng **NEO ĐÁY**; bản 2D thì
neo **góc trên-trái** — tức ném nội dung vào đúng dải mà `bang-kpi-noi` + `cum-trang-thai-du-lieu`
đang chiếm. **Hai bề mặt, một màn, hai luật.**

### Mức độ, đo bằng lưới 2 px trong lòng từng biểu tượng

| biểu tượng | % diện tích còn bấm trúng | ô vuông trống lớn nhất | ≥24 px |
|---|---|---|---|
| 11/14 khác | 100 % | 38×38 px | ✅ |
| toà 97 | 69 % | 30×30 px | ✅ |
| **toà 93** | **21 %** | **6×6 px** | ❌ |
| **toà 94** | **34 %** | **8×8 px** | ❌ |

Bấm tại điểm trống vẫn điều hướng đúng **3/3** ⇒ **đường đi không mất**; nhưng 2/14 phá đúng
ràng buộc **≥24×24 px** mà chủ dự án đã nhận khi chọn lối (b).

### Bản vá (`9562bb9c`) — đổi CHỖ NEO, không đụng `vungDungCanvas`

| kết cục | trước | sau |
|---|---|---|
| thông tâm | 12/14 | **14/14** |
| đạt 24×24 | 12/14 | **14/14** |
| **cỡ biểu tượng** | 53×38 px | **53×38 px — KHÔNG đổi** |
| nhãn sạch | 15/19 | **17/19** |
| tỉ lệ nhánh MÁY | 10,0222 px/m | **10,0222 px/m — KHÔNG đổi** |

★★★ **Và một con số bắt tôi thu hẹp luật lại.** Bản đầu chừa lề đáy ở **mọi** phạm vi:

| phạm vi | không lề | có lề | nhãn treo dưới |
|---|---|---|---|
| tập đoàn (sa bàn) | 0,4801 px/m | **0,4801 px/m** (bề RỘNG chặn) | **19** |
| một nhà máy | 10,0222 px/m | 9,4000 px/m (**−6,2 %**) | **0** |

Tức ở nhánh máy, lề mua **0 nhãn** bằng **6,2 % cỡ đích bấm** — đúng lớp *"vá thành lùi"* mà
PH-46 đã ghi. ⇒ `leDayPx` **chỉ cho nhánh sa bàn**.

## 5. Ablation

| bản vá | gỡ ra | kết quả |
|---|---|---|
| neo đáy + căn giữa (hàm thuần) | quay về neo trên-trái | lưới **ĐỎ 3/13**, và **đo sống quay về đúng 12/14** |
| — | hoàn nguyên | xanh 13/13, **14/14** |
| đối số ở **CHỖ GỌI** | bỏ `leDayPx` | lưới **ĐỎ 2/16** (G93 — đột biến chỗ gọi sống sót ca kiểm module) |
| V4 | — | công cụ tự chứng minh: `duong-dung=vite` + hai dòng mtime phơi đúng độ lệch đã đánh lừa tôi |

★ Ca cũ ghim `tt.px===VUNG.trai && tt.py===VUNG.tren` là ghim **CƠ CHẾ** (góc neo). Quyết định nó
bảo vệ — *"nội dung phải nằm trong vùng dùng được"* — **không đổi**, nên ca được **nâng lên ghim
TÍNH CHẤT** (nằm trọn trong vùng + lấp >95 % một chiều), **không nới**.

## 6. Ba lời khai sai của vòng 5 — gom lại một chỗ

| tôi đã viết | sự thật đo được |
|---|---|
| *"N3 không đo được từ DOM"* | có `__demChonChiHuy()`, dựng riêng cho câu hỏi ấy |
| *"hai huy hiệu không khai `data-che-nhan`"* | **7/7** lớp phủ đều khai; gốc là luật hình học |
| *"V1 — đã ép ghi lai lịch"* | chỉ ép được **một** đường dựng; `vite build` lách qua |

⇒ Cả ba đều là **suy từ tên cơ chế** thay vì hỏi hệ thống. Và cả ba đều bị bắt bởi cùng một thứ:
**đối chứng**.

## 7. CÒN MỞ

- **1/14 biểu tượng 3D ở 21,7 px** (<24) @1280×720 — ép đủ đòi dựng lại **mốc đo sống
  673,2 × 553,2 m + hai đối chứng dương PH-46/47** ⇒ **chờ chủ dự án**.
- **toà 94** còn 64 % diện tích (ô trống 32×32 px) — **đạt** 24×24 nhưng chưa thông hẳn.
- **Kịch bản đo ngoài sổ** (`.qa-*/` đã gitignore) — phép đo nào thành bằng chứng lâu dài phải
  chuyển vào `scripts/`. Đổi phạm vi ⇒ chờ chốt.
- **Hồi tố truy vấn** cho các mục backlog còn số mà không có phép đo (luật vòng 5 §4).
- **28 tệp `knowledge/`** bẩn từ trước phiên này — không đụng.
- ⚠ **`MEMORY.md` 30,7 KB / trần 24,4 KB** ⇒ **bị cắt khi nạp**, một số mục ghi nhớ hiện không
  được đọc. Rút gọn là một đợt riêng.

## 8. Cổng

`tsc` **0** · `twin3d`+`pages` **177 tệp / 3.635 ca / 0 đỏ** · `i18n:check` **0**.
Commit vòng 6: `51fb9600` (V4) · `9562bb9c` (neo đáy 2D).

---

# VÒNG 7 (PDCA, 2026-09-21) — ĐÓNG MỤC CUỐI, BẰNG CÁCH BỎ MỘT CHẨN ĐOÁN SAI HAI VÒNG LIỀN

**Đề bài:** *"Tiếp tục hoàn thiện các phần còn mở."* Mục còn mở đáng kể duy nhất: **1/14 biểu
tượng 3D ở 21,7 px** — thứ tôi đã hai vòng liền gọi là "chờ chủ dự án" **dựa trên một chẩn đoán
sai**.

## 1. Bước 0 (MSA)

| kiểm | kết quả |
|---|---|
| cây làm việc | `git status` **không pathspec**: 28 tệp, **toàn bộ** là `knowledge/` của tiến trình khác ⇒ ghi lại, không đụng |
| lai lịch bản dựng | `BUILD-INFO` nay có `duong-dung=` + mtime artefact (V4 vòng 6) ⇒ đối chiếu được |
| trình kết xuất | ép GPU ở mọi phép đo |

## 2. ★★★ CHẨN ĐOÁN CŨ CỦA TÔI SAI — VÀ NÓ ĐÃ CHẶN VIỆC SUỐT HAI VÒNG

Vòng 4 tôi kết luận:

> *"Biểu tượng nhỏ nhất là biểu tượng **XA NHẤT**: phối cảnh nghiêng ~62° nén trục sâu."*

rồi thử **hai đòn bẩy KHUNG NHÌN** (góc camera, khe cụm), thấy cả hai phá mốc đo sống
673,2 × 553,2 m + hai đối chứng dương PH-46/47, và tuyên bố *"ép đủ 24 px đòi dựng lại mốc đo và
hai đối chứng ⇒ chờ chủ dự án"*.

**Đọc `twin_toa_nha` thì ra chuyện khác hẳn:**

| | mặt bằng | **chiều cao** |
|---|---|---|
| toà 24 (Nhà máy ảo SIM) | 38,4 × 29,6 m | **8 m** ← chính là cái 21,7 px |
| toà 90 (FUYU-F) | 3.000 × 2.000 m | 25 m |
| toà 91…102 (QATD) | 110 × 80 m | 42 m |

`saBanTapDoan` **đã chuẩn hoá mặt bằng** về trung vị nên **mọi** biểu tượng cùng 110 × 80 m.
Cạnh ngắn của toà 24 ngắn **vì nó thấp 8 m**, không vì nó ở xa — khoảng cách chỉ là yếu tố phụ.

⇒ **Không đòn bẩy khung nhìn nào chữa được, và cũng chẳng cần phá bằng chứng nào cả.** Hai vòng
"chờ chủ dự án" là hệ quả của việc tôi đi tìm nguyên nhân trong **hình học camera** trong khi nó
nằm ở **một cột trong CSDL**.

★ Tôi cũng đã kịp đi thêm một bước sai nữa: mô phỏng **FOV** (đòn bẩy thứ ba) và thấy nó nhúc
nhích (+27 % ở FOV 15). Nếu không đọc dữ liệu trước, tôi đã vá đúng thứ **không phải nguyên nhân**
và vẫn thấy con số đẹp lên.

## 3. Hằng sàn đã tồn tại — chỉ chưa ai đối chiếu nó với tiêu chí

`BIEU_TUONG_CAO_TOI_THIEU_MM = 6 m`, lý do ghi trong mã: *"đủ để thấy là khối"* — một câu **không
đối chiếu được** với bất cứ tiêu chí nào. Tiêu chí thì có sẵn từ Task 20: **24×24 px** ở khung nhỏ
nhất.

Quét trên **dữ liệu thật**, qua **chính `saBanTapDoan`** (`scripts/do-twin/san-chieu-cao-va-24px.mts`):

| sàn | cạnh nhỏ nhất | đạt ≥24 px | số toà bị nâng |
|---|---|---|---|
| **6 m (cũ)** | **21,7 px** | 13/14 | 0/14 |
| 16 m | 23,9 px | 13/14 | 1/14 |
| 18 m | 24,4 px | **14/14** | 1/14 |
| **20 m (chọn)** | **25,0 px** | **14/14** | **1/14** |
| 30 m | 27,7 px | 14/14 | 2/14 |

★ Mô phỏng **tái hiện đúng** đường cơ sở sống (6 m → 21,7 px) ⇒ hai bên so được với nhau.
★ Chọn 20 m chứ không 18 m: 18 m chỉ hơn ngưỡng **0,4 px** — một bản vá sống bằng làm tròn.

## 4. Quyết định của chủ dự án, và cái giá phải khai

Tôi **không tự chọn**: sa bàn cố ý **giữ số thật cho chiều cao** (*"Chỉ MẶT BẰNG là ước lệ … nói
quá thành 'kích thước là ước lệ' cũng là một lời khai sai"*). Ba lối đã trình kèm số:

| | kết cục | giá |
|---|---|---|
| **(a) nâng sàn 6 → 20 m** ← **ĐÃ CHỌN** | 25,0 px · **14/14** | 1/14 toà vẽ cao hơn thật ⇒ **banner phải khai** |
| (b) giữ nguyên | 21,7 px · 13/14 | thiếu biên đọc cho đúng 1 biểu tượng |
| (c) seed lại toà 24 về chuẩn | 31,0 px · 14/14 | **bịa** một con số cao gấp 5,25 lần số đang có |

★ Tôi **khuyên không chọn (c)** dù nó cho số đẹp nhất và không đổi một dòng mã: 8 m có vẻ là số
**thật** cho một xưởng nhỏ của nhà máy ảo — sửa nó là sửa dữ liệu cho khớp cái nhìn, đúng lớp
*"sửa đề thi cho khớp bài làm"* mà dự án này đã bác hai lần.

**Banner rộng ra trong cùng lượt** (luật đã ghi từ PH-50): câu cũ kết bằng *"chiều cao của mỗi
khối là số thật"* — với sàn 20 m nó **thành sai** cho toà 24. Nay:

> *"…; chiều cao là số thật, TRỪ toà thấp hơn sàn **20 m** — chúng vẽ đúng sàn ấy để còn thấy được."*

Ô thay số thứ **chín** (`sanCao`) **đọc từ hằng**, không chép con số (G12).
⚠ Và cổng `i18n:check` bắt một lỗi thật: chỗ gọi khai **một** ô mà câu chữ dùng **hai** lần ⇒ đã sửa.

## 5. Kết cục đo sống

| | trước | sau |
|---|---|---|
| **1280×720** | 13/14 · nhỏ nhất **21,7 px** · tỉ số 2,70 | **14/14** · nhỏ nhất **25,0 px** · tỉ số 2,34 |
| **1920×1080** | 14/14 · nhỏ nhất 42,6 px · tỉ số 3,20 | **14/14** · nhỏ nhất **49,4 px** · tỉ số 2,76 |
| 13 biểu tượng còn lại | — | **không đổi một số nào** |

## 6. Lỗi DỮ LIỆU tìm được nhân thể — và nó là một toà nhà 3 km

`twin_toa_nha` id=90 (`FUYU-F-TN1`, *"toà chính"*, `nguon=sinh`) khai **3.000.000 × 2.000.000 mm
= 3 km × 2 km**. Không toà nhà nào dài 3 km — gần như chắc chắn bộ sinh lấy **phạm vi khuôn viên**
làm mặt bằng toà. Chính nó tạo ra tỉ số cạnh **78:1** buộc sa bàn phải ước lệ mặt bằng.

⚠ Nó **không** ảnh hưởng tiêu chí 24 px (đo: bỏ ra vẫn đúng 13/14 — mặt bằng vốn đã chuẩn hoá về
**trung vị**, một ngoại lai không kéo được trung vị). Sửa nó là sửa **nguyên nhân gốc của việc
phải ước lệ**.

Chủ dự án duyệt sửa luôn. Kịch bản `scripts/sua-toa-nha-mat-bang-vo-ly.mts`: mặc định **chỉ xem**,
in **nguyên văn giá trị cũ** trước khi ghi (đảo ngược được), và **dừng** nếu mọi toà đều vô lý
(không còn trung vị lành mạnh để lấy — không đoán). **Chỉ sửa mặt bằng, giữ nguyên chiều cao 25 m.**
Banner tự đổi theo: *"cạnh thật trải từ 30 m tới **110** m"* (trước: tới 3.000 m).

## 7. Ablation

| bản vá | gỡ ra | kết quả |
|---|---|---|
| sàn 20 m | hạ về 6 m, dựng lại, đo sống | **13/14 · 21,7 px** — đúng đường cơ sở |
| — | hoàn nguyên | **14/14 · 25,0 px** |
| ca ghim quyết định | — | 1 ca đỏ khi đổi hằng ⇒ **đúng ca đó là ca ghim quyết định**, đã ghi lại quyết định MỚI kèm ba con số đã trình |
| sửa dữ liệu toà 90 | riêng nó | **không đổi** tiêu chí 24 px (13/14) ⇒ hai bản vá **độc lập**, đúng như dự đoán |

## 8. ★ Kịch bản đo vừa đưa vào sổ đã TỰ BẮT LỖI CỦA CHÍNH NÓ

Sáu phép đo chống lưng cho các bảng số trong mã nay nằm ở **`scripts/do-twin/`** kèm README ghi
điều kiện chạy (ép GPU · `?do=1` · bản dựng mới nhất).

Ngay lần chạy đầu ở chỗ mới, `san-chieu-cao-va-24px.mts` in ra một bảng **trông-như-số**: mọi hàng
`sàn < 20 m` đều cho **cùng** 25,0 px, vì nó nâng chiều cao ở đầu vào nhưng `saBanTapDoan` còn kẹp
lần nữa bằng chính hằng vừa đổi. ⇒ Đã vá để nó **đọc hằng từ mã, in cảnh báo, và đánh dấu từng
hàng vô nghĩa**; hàng lịch sử chỉ dựng lại được bằng **ablation**.

> Một bảng số không tái hiện được thì không hơn gì bốn con số không có truy vấn.

## 9. CÒN MỞ

- **toà 94** (2D) còn 64 % diện tích, ô trống 32×32 px — **đạt** 24×24, ghi lại để đừng quên.
- **Hồi tố truy vấn** cho các mục backlog cũ còn số mà không có phép đo.
- **28 tệp `knowledge/`** bẩn từ trước phiên này — không đụng.
- ⚠ `MEMORY.md` vượt trần ⇒ **bị cắt khi nạp**; đang rút gọn.

## 10. Cổng

`tsc` **0** · `twin3d`+`pages` **177 tệp / 3.637 ca / 0 đỏ** · `i18n:check` **0**.
Commit vòng 7: `f9bd6d1c` (dữ liệu toà 3 km) · `142e1e76` (sàn 20 m + banner) ·
`3b4c2694` (`scripts/do-twin/`).

---

# VÒNG 8 (PDCA, 2026-09-21) — CÔNG CỤ VỪA THÊM BẮT TÔI ĐÃ PHÁ MỘT TẬP DỮ LIỆU ĐÚNG

**Đề bài:** *"Tiếp tục phần còn lại cho đến khi hoàn tất."* Ba mục: rà dữ liệu sinh · hồi tố
truy vấn · toà 94.

## 1. ★★★ PHÁT HIỆN LỚN NHẤT — VÀ NẠN NHÂN LÀ BẢN VÁ CỦA CHÍNH TÔI Ở VÒNG 7

Vòng 7 tôi sửa `twin_toa_nha` id=90 từ **3.000 × 2.000 m** về **110 × 80 m**, với lý lẽ *"không
toà nhà nào dài 3 km; bộ sinh lấy nhầm phạm vi khuôn viên"*. Chủ dự án duyệt, tôi ghi.

Lý lẽ ấy chỉ nhìn **đúng một cột**.

`scripts/do-twin/ra-soat-du-lieu-twin.mts` — viết trong chính vòng này — bắt ngay ở phép kiểm
**B4**: ba tầng của toà 90 vẫn 3.000 × 2.000 m. Đo tiếp:

| tầng | cấp | đặt chỗ | x lớn nhất | y lớn nhất |
|---|---|---|---|---|
| 417 | 1 | 359 | 1.500 m | 1.000 m |
| 418 | 2 | 391 | 1.500 m | 1.000 m |
| 419 | 3 | 369 | 1.500 m | 1.000 m |

⇒ **1.119 đặt chỗ đang trải tới 1,5 km × 1 km.** Cả nhà máy FUYU-F được mô hình hoá thành **một
khối gộp** ("tải tổng hợp"), và toà + tầng + đặt chỗ **nhất quán với nhau**. Thứ làm chúng lệch
nhau chính là bản vá của tôi.

**Đã hoàn nguyên** (`rongMm=3000000, sauMm=2000000`; `caoMm` chưa bao giờ bị đụng). Khôi phục
được trong một phút là nhờ dòng `CŨ : …` mà kịch bản in ra **trước khi ghi** — đúng lý do nó in.

> ★★★ **Một con số chỉ vô lý khi nó KHÔNG ĂN KHỚP với thứ nó chứa.**
> Đừng phán một cột bằng cách nhìn riêng cột ấy.

### Bài học đã thành hàng rào, không chỉ thành chữ

| chỗ | trước | sau |
|---|---|---|
| `sua-toa-nha-mat-bang-vo-ly.mts` | thu nhỏ mọi toà vượt ngưỡng | **TỪ CHỐI** thu nhỏ toà mà tầng/đặt chỗ còn trải ra ngoài cỡ mới |
| phép kiểm **A1** | *"cạnh > 1 km?"* — **kêu oan** | *"to bất thường **MÀ bên trong KHÔNG trải tương ứng**?"* + một dòng **ghi chú** cho mô hình gộp |

★ Chạy `--sua` **thật** sau khi vá: **ghi 0/1 toà**, in đủ bốn dòng vượt ngưỡng. Hàng rào sống,
không phải một lời hứa trong docblock.
★ Và A1 bản đầu vi phạm đúng bài học `BUILD-INFO` đã học một lần: **một cảnh báo LUÔN kêu thì
không ai nghe**.

## 2. Rà soát dữ liệu — 12 phép kiểm trên 4 bảng

| nhóm | phép kiểm |
|---|---|
| **A** toà nhà | to-bất-thường-mà-rỗng · cao ngoài [3 m, 300 m] · toạ độ > 50 km · hai toà chồng lấn |
| **B** tầng | trùng cao độ · cao độ không tăng theo cấp · sàn cao hơn nóc · sàn lớn hơn mặt bằng toà |
| **C** đặt chỗ | kích thước ≤ 0 · nằm ngoài sàn · trỏ tới tầng chết |
| **D** vật thể | kích thước ≤ 0 · nằm ngoài sàn |

**Kết quả cuối: XANH HẾT, mã thoát 0** — cắm CI được. Một dòng ghi chú cho toà 90 (mô hình gộp).

## 3. Backlog tự nó cũng là một ý kiến có tuổi

Sau khi đóng N1…N4 / M1…M3 / V1…V3 ở các vòng 4–7, **sáu hàng** trong bảng C2/C3 vẫn ghi "chưa
đo" hoặc giữ con số cũ. Đã đồng bộ cả sáu.

★ Và một **lời khai hết hạn nằm trong chính mã**: `canhLine.ts` có khối
*"⚠⚠⚠ MÓN NỢ CÒN MỞ — CHỖ NÀY CHƯA CỘNG GỐC TOÀ NHÀ"* trong khi mã **ba dòng dưới** đã cộng
(`g.xMm + d.viTriXMm`, kèm hoán trục), có 8 ca kiểm. Khối ấy **tự nhận** là *"lời khai có hạn sử
dụng, không phải một chú thích vĩnh viễn"* — rồi nằm quá hạn.

> **Một cảnh báo hết hạn nguy hiểm hơn không có cảnh báo**: người đọc tin nó, và đi vá một thứ
> đã được vá.

## 4. SỔ TRUY VẤN — luật vòng 5 nay có chỗ thi hành

Thêm mục *"Sổ truy vấn"*: mỗi con số còn được viện dẫn phải chỉ được về một kịch bản trong
`scripts/do-twin/`. **Ba dòng** được đánh dấu ⛔ **hết hạn kiểm chứng** và nói thẳng là nợ
(1.699 khoá sống · lớp phủ 58,2 % · 1.108 máy). Dòng cuối đã đo lại ngay: CSDL hôm nay có
**1.700** máy, cảnh vẽ **1.699** — chênh đúng 1 máy, khớp ghi chép cũ.

## 5. toà 94 — đóng bằng một phép tính, không bằng một bản vá

Còn **64 %** diện tích, ô trống **32×32 px** ⇒ **đạt** 24×24, bấm vẫn đúng. Kẻ che là
`nut-thu-phai` 21×42 px nép mép phải (**có** khai `data-che-nhan`, chỉ không cắt suốt chiều cao).

**Giá nếu trừ:** vùng hẹp lại **21/488 = 4,3 %** bề ngang — và ở cấp tập đoàn bề **ngang** mới là
chiều chặn (đo ở vòng 6) ⇒ **cả 14** biểu tượng nhỏ đi 4,3 %: 38,4 → **36,7 px**.
⇒ **Không vá.** Bỏ 4,3 % của cả 14 để chữa một cái **đã đạt** là đúng lớp *"vá thành lùi"*.

## 6. Cổng

`tsc` **0** · `twin3d`+`pages` **177 tệp / 3.637 ca / 0 đỏ** · `i18n:check` **0** ·
rà soát dữ liệu **12/12 xanh**.
Kết cục sản phẩm **không đổi**: 3D **14/14** đạt 24 px (25,0 px @1280 · 49,4 px @1920);
2D **14/14** thông tâm.
Commit vòng 8: `7e78e095` (hoàn nguyên + hàng rào) · `cbecf60a` (đồng bộ backlog + sổ truy vấn) ·
`b4c48bd7` (toà 94).
