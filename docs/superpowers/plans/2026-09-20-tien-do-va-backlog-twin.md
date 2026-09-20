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
