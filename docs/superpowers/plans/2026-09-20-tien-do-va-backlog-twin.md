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
| **Q2** | **Dọn 32 thư mục `.qa-*`** (391 mục untracked; riêng `.qa-v2` **378 MB**) | — | Đây là **xoá tệp** ⇒ theo ràng buộc của chủ dự án phải hỏi. Trong đó có **bằng chứng đo** của vòng này và của **phiên khác**; cần tách "giữ làm mốc" khỏi "rác". |

### C2 — Nợ CÓ TÊN, đã đo, chưa vá

| | việc | trạng thái |
|---|---|---|
| **N1** | **Task 17c** — tâm trạm lấy **mặt bằng** từ `twin_dat_cho` mà bản ghi ấy **chưa cộng gốc toà nhà** | ⏳ **Bom hẹn giờ.** Hôm nay không lệch vì cả ba màn chỉ nạp **một** toà và neo cảnh vào chính toà ấy. Ngay khi một cảnh mang **hai** toà, máy dời mà trạm không ⇒ đường tâm chuyền **đứt khỏi chính máy của nó**, và **không lỗi nào nổ**. Vòng này đã chữa **cao độ** (lấy từ máy); **mặt bằng** thì chưa. |
| **N2** | **PH-45** — `useTrangThaiSong` còn **3/4** truy vấn nhận một `factoryId` | ⏳ ~737 máy (số ghi ở kế hoạch 09-15) vẽ đúng chỗ mà **không có lời khai trạng thái**. Đã có banner nói ra, nên là *khoảng trống*, không phải *nói dối*. |
| **N3** | **PH-42** — `/factory-command`: bấm nền xoá nhấn sáng nhưng **giữ viền và nhãn** | ⏳ Lệch **có sẵn**; bản vá trước chỉ thêm một nguồn kích hoạt. |
| **N4** | **V-21(1)** — tỉ lệ cảnh báo dự đoán theo hạng sức khoẻ **53,5 / 49,6 / 49,7 / 55,8 %** | ⏳ Phẳng **và ngược chiều** ⇒ lỗi **bộ sinh dữ liệu**, không phải lỗi màn. |

### C3 — CHƯA ĐO (không biết có hỏng không — và đó là cái đáng sợ hơn)

| | việc | vì sao đáng đo |
|---|---|---|
| **M1** | **Màn Máy `/twin/may/:id`** | Là bề mặt **duy nhất** trong ba màn Twin **chưa đo** vòng này. Hai màn kia đều lòi khuyết tật khi bị đo. |
| **M2** | **G134 phần còn lại** — *"30 cái được chọn có đúng là 30 cái đáng đọc nhất không"* | **Cơ chế đã có** (điểm ưu tiên `diemUuTienNhan` + chính sách *chỉ-bất-thường* + chốt tất định theo khoá). Thứ **chưa ai đo** là **chất lượng lựa chọn** ở quy mô **1.108 máy / 3 nhà máy**. |
| **M3** | Dải cảnh báo tự khai *"Counted across your whole account scope"* trong khi cảnh là **FUYU-F** | Tự khai **đúng**, nhưng chưa đo người vận hành có đọc nó thành **phạm vi của cảnh** hay không. |

### C4 — Vận hành / hạ tầng đo

| | việc | ghi chú |
|---|---|---|
| **V1** | `dist/BUILD-INFO.txt` — quy ước ghi lai lịch **không có cơ chế ép** | Đã **mất hai lần**; quy ước không được cưỡng chế thì rụng ngay lần dựng sau. Chữa: ép ghi trong chính bước build. |
| **V2** | Ca chập chờn **CÓ SẴN** `phamViDocPatch.db.test.ts` (timeout 5.000 ms, biên 1,46×) | ⛔ **Không nâng trần** — nâng là giấu. |
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
