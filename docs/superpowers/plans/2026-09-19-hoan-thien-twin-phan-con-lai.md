# Hoàn thiện Twin 3D — thiết kế phần còn lại (2026-09-19)

Nối tiếp ba vòng PDCA đã ghi ở `2026-09-15-hoan-thien-twin-sau-qa11.md`
(vòng 1 tốc độ · vòng 2 tính đúng của thông tin · vòng 3 tên máy hỏng bị lớp phủ che).
Thô của mọi con số dưới đây: `.qa-v2/tho*`.

---

## §0. ĐÍNH CHÍNH TRƯỚC KHI THIẾT KẾ — ba phát hiện của tôi bị rút lại

Thiết kế dựng trên một phát hiện sai thì sai từ gốc, nên phần này đứng trước mọi thứ khác.

`window.__demTuongTac.hopKhoiMay()` và `dsMay()` đều trả **px gốc CANVAS**
(`KhungCanh.tsx:150-154` khai đúng điều đó, và e2e chính chủ dùng `cv.left + m.x`). Canvas lại
lệch **(288, 125)** trong khung nhìn ở cả hai màn. Vòng 2 tôi dùng **thẳng** toạ độ ấy như toạ độ
khung nhìn, nên mọi cú bấm rơi lệch 288 px sang trái và 125 px lên trên.

Đo lại, cùng máy, cùng khung: tâm `hopKhoiMay` và `dsMay` **lệch ≤ 0,4 px** ⇒ cùng gốc.

| phát hiện cũ (vòng 2) | phán quyết |
|---|---|
| *"7/39 máy của line 526 chiếu RA NGOÀI canvas"* | **RÚT LẠI** — `dsMay().trongKhung` = **39/39**. Artefact của phép đo. |
| *"bấm khối máy ở màn Line nhảy sang `/traceability`"* | **RÚT LẠI** — cú bấm rơi vào thanh điều hướng vì lệch offset, không phải cảnh bị nút đè. |
| *"0/11 cú bấm thẳng khối máy mở được máy"* | **RÚT LẠI** — với toạ độ đúng: `hitTai` **16/16** trúng đúng máy, bấm-không-kéo **4/4** mở đúng `/twin/may/:id`. |

**Sống sót** (không phụ thuộc gốc toạ độ): mọi số về **DIỆN TÍCH** đích bấm, toàn bộ vòng 3
(dùng `getBoundingClientRect` nhất quán một gốc), và hai ca e2e đỏ `T1c`/`T1g` — chúng là lưới của
chính dự án, dùng toạ độ đúng.

⇒ **Pareto #3 của vòng 2 biến mất. Phần còn lại chỉ có ba hạng mục, không phải bốn.**

---

## §1. ĐÁNH ĐỔI TRUNG TÂM — đo rồi, và nó nói rằng CUỘN ZOOM KHÔNG GIẢI ĐƯỢC

Hai việc còn lại (đích bấm nhỏ · tên máy bị che) thường bị gộp thành *"thì phóng to lên"*. Quét
từng nấc cuộn, ghi số máy còn **trong khung** (khái niệm của chính sản phẩm) và diện tích đích:

**`/twin` FUYU-F @1280×720 — 549 máy, 176 khối vẽ**

| nấc cuộn | trong khung | đích trung vị | đạt 24×24 (AA) |
|---|---|---|---|
| 0 (mặc định) | 176/176 | **9 px²** | **0/130** |
| 6 | 176/176 | 25 px² | 0/87 |
| 12 | 149/176 | 82 px² | 0/61 |
| 18 | 115/176 | 211 px² | 5/33 |
| 24 | **96/176** | 557 px² | **8/16** |

**`/twin/line/526` — 39 máy**

| nấc cuộn | trong khung | đích trung vị | đạt 24×24 |
|---|---|---|---|
| 0 | 39/39 | **33 px²** | **0/29** |
| 12 | 19/39 | 237 px² | 0/18 |
| 18 | 11/39 | 580 px² | 7/12 |
| 21 | **0/39** | 864 px² | 7/8 |

**Kết luận đo được: không tồn tại nấc cuộn nào vừa giữ được đa số máy vừa đạt ngưỡng bấm.**
Ngay ở màn Line chỉ 39 máy, để đưa đích lên ngưỡng phải hy sinh **72 %** số máy khỏi khung. Ở cấp
nhà máy, phóng hết cỡ vẫn chỉ **8/16** khối đạt trong khi đã mất **45 %** số máy.

⇒ Lời giải KHÔNG nằm ở khung nhìn. Nó nằm ở **ĐƠN VỊ VẼ** — đúng kết luận mà Task 20 đã rút ra và
đã thi hành ở **cấp tập đoàn** (1.108 máy → 12 biểu tượng toà nhà; tam giác 61.248 → **182**).
Cấp NHÀ MÁY chưa có bậc tương ứng, và đó là lỗ hổng của thiết kế hiện tại.

---

## §2. HẠNG MỤC 1 — bậc đơn vị vẽ thứ ba: **CỤM TRẠM** ở cấp nhà máy

### Vấn đề, phát biểu bằng số
Ở `/twin` một nhà máy, đơn vị vẽ là **một khối = một máy**. Với 176 khối trong khung, trung vị
diện tích **9 px²** — bằng **1/64** ngưỡng WCAG 2.5.8 (24×24 = 576 px²). Không có khối nào đạt.

### Thiết kế
Thêm **một bậc giữa** hai bậc đã có:

| phạm vi | đơn vị vẽ hiện tại | sau thiết kế |
|---|---|---|
| tập đoàn | biểu tượng TOÀ NHÀ (Task 20) | giữ nguyên |
| **nhà máy** | **một khối = một máy** | **một biểu tượng = một CỤM TRẠM** khi mật độ vượt ngưỡng |
| line | một khối = một máy | giữ nguyên |

- **Khoá gộp**: `stationId → lineId` (cùng trục phân cấp mà `cayVanHanh` đã dùng, không dựng trục
  thứ hai — bài học G5/G9 "cùng chữ máy, hai mẫu số").
- **Ngưỡng kích hoạt — ĐO, không phải hằng số chọn bừa**: đổi đơn vị khi **trung vị diện tích
  khối < 576 px²** ở khung hiện tại. Tự tắt khi người dùng phóng đủ to. Ngưỡng này là *đại lượng
  của khung nhìn*, nên nó đúng ở mọi cỡ màn mà không cần bảng tra theo `width`.
- **Nội dung biểu tượng cụm**: số máy · số máy bất thường · màu = trạng thái xấu nhất trong cụm.
  Ba con số ấy là thứ vòng 2/3 đã chứng minh người vận hành đang mất.
- **Bấm vào cụm** ⇒ mở `/twin/line/:id` (đường đã có, đã đo là dùng được).
- **Nhãn**: ở bậc cụm, nhãn gắn cho CỤM chứ không cho máy ⇒ số ứng viên rơi từ 182 xuống ~số
  line, nên `biChe` gần như biến mất mà không cần đụng tới lớp phủ.

### Nghiệm thu (đo được, không cảm tính)
1. `/twin` FUYU-F @1280×720, khung mặc định: **≥ 90 %** đơn vị vẽ đạt **24×24 px**.
2. **Không mất máy nào**: tổng số máy mà các cụm đại diện = **549/549**; `dem-may` không đổi.
3. Ngân sách vẽ giữ trần cũ: lệnh vẽ < 150 · tam giác < 500 k · nhãn < 30 · ≥ 30 khung/s.
4. **Đối chứng âm BẮT BUỘC**: `/twin/line/:id` **không đổi một ô nào** — đó là đường đang dùng
   được, một bậc mới không được đẩy nó ra (đúng khuôn đối chứng âm của Task 20).
5. Tự tắt: phóng tới khi trung vị ≥ 576 px² ⇒ quay về vẽ từng máy, và `dem-may` vẫn 549.

### Ablation
Gỡ ngưỡng kích hoạt (ép luôn vẽ từng máy) ⇒ trung vị phải tụt về **9–15 px²** và tiêu chí (1) đỏ.
Không tụt ⇒ bản vá không phải thứ mua con số.

### Rủi ro đã biết
Task 20 để lại một bài học: **đổi đơn vị vẽ ở 3D mà quên bản 2D** thì hai nút "2D/3D" cho hai thứ
khác hẳn nhau (đo được: 2D vẽ 1.108 vật thể rộng 0,11–3,95 px trong khi 3D vẽ 12 biểu tượng
56,5–83,0 px). ⇒ **`CanhVanHanh2D` phải nhận CÙNG mảng cụm**, không dựng mảng thứ hai.

---

## §3. HẠNG MỤC 2 — giành lại diện tích canvas

### Hiện trạng
Lớp phủ DOM ăn **70,8 %** canvas @1280×720 (47,3 % @1920×1080). Pareto (diện tích **giành lại
được** nếu bỏ từng lớp, tính bằng lưới 8 px để phần chồng nhau không cộng hai lần):

| lớp phủ | 1280×720 | 1920×1080 |
|---|---|---|
| `panel-phai` | 23,9 % | 18,8 % |
| `panel-trai` | 20,9 % | 16,9 % |
| **`bang-kpi-noi`** | **13,8 %** | **5,2 %** |
| `lop-phu-dong-thoi-gian` | 4,9 % | 3,5 % |

### Ba lựa chọn, kèm số — chủ dự án chọn

| | làm gì | giành lại | giá phải trả |
|---|---|---|---|
| **(a)** | `bang-kpi-noi` **co theo khung** ở ≤ 1366 | **~9 điểm** | gần như không — nó là bảng chỉ số, không phải danh sách |
| (b) | mặc định **thu hai panel** ở ≤ 1366 | ~44 điểm | **giấu chính dải cảnh báo đang chở tên** — đo được: 13/24 tên máy hỏng CHỈ có ở panel |
| (c) | giữ nguyên, coi `chip-ten-bi-che` là đủ | 0 | người vận hành phải tự thu panel mỗi lần |

**Khuyến nghị (a).** Lý do đo được, không phải sở thích: `bang-kpi-noi` là lớp **bất tương xứng**
duy nhất — nó phình **5,2 % → 13,8 %** khi khung nhỏ lại, tức nó không co theo khung trong khi hai
panel kia có. Sửa nó là sửa một hành vi **sai**, còn (b) là đánh đổi một thông tin lấy một thông
tin khác — việc ấy thuộc quyền chủ dự án, không thuộc quyền tôi.

⚠ **(a) và HẠNG MỤC 1 chồng lấn**: nếu HM-1 xong trước, số ứng viên nhãn rơi từ 182 xuống ~số
line và `biChe` gần như biến mất — khi ấy (a) mua thêm rất ít. **Đo lại sau HM-1 rồi mới quyết (a)**,
đừng thi hành song song rồi không biết con số đến từ đâu.

### Nghiệm thu (a)
Phủ @1280×720: **70,8 % → ≤ 62 %** · máy hỏng có tên: **1/24 → ≥ 4/24** · `chip-ten-bi-che` giảm
tương ứng · @1920×1080 **không đổi** (đối chứng âm: chỉ khung hẹp mới được đụng).

---

## §4. HẠNG MỤC 3 — đóng hai ca e2e đỏ, đúng khuôn phân loại của dự án

`twin-dot47-bam-canh.spec.ts` đang **14/16** (`--workers=1` theo G147). Ablation đã chứng minh
**bản vá vòng 1 vô can** (gỡ `LopNhan`/`LopCanhBao` về trước vá ⇒ vẫn đúng hai ca ấy đỏ).

### T1c @1280×720 — *"phải có ≥ 1 nhãn trong canvas không bị lớp phủ đè"*, đo được `soNhan = 0`
Gốc: ở bậc *chỉ-nhãn-bất-thường*, ứng viên là 19 và **18 bị lớp phủ che**; cái duy nhất vẽ được
cũng bị che nốt. ⇒ **Sau HM-1 (hoặc HM-2a) chạy lại trước**. Nếu vẫn đỏ thì đây là ca đo một
trạng thái **không còn đạt được ở mật độ dữ liệu hôm nay** (viết khi CSDL có 42 máy, nay 1.700) —
xử theo khuôn đã dùng cho `chipCanhBaoAn`: **thu hẹp về đúng bất biến nó sở hữu**, rồi **kiểm lại
ca đã thu hẹp vẫn biết kêu**. Không nới thành một ca luôn xanh.

### T1g @1600×900 — *"bấm tâm khối của máy bị NHÃN MÁY KHÁC đè ⇒ vẫn mở đúng máy ấy"*
Đo sơ bộ của tôi (n = 4): bấm-không-kéo **4/4** đạt, kéo-60px-rồi-bấm **3/4**. **n = 4 không đủ để
phân biệt lỗi thật với nhiễu** — đó là lý do hạng mục này chưa có bản vá.
⇒ **Việc đầu tiên: đo lại với n ≥ 20 mỗi nhánh**, cùng máy, cùng toạ độ, chỉ khác có kéo trước hay
không. Ba kết cục dẫn tới ba việc khác nhau:
- hai nhánh ngang nhau ⇒ T1g đỏ vì **chọn mẫu** (nó chỉ nhận máy bị nhãn khác đè, tập ấy nhỏ và
  đổi theo khung) ⇒ sửa ca, không sửa sản phẩm;
- nhánh có-kéo tụt rõ ⇒ **lỗi thật** ở bộ phân loại bấm-vs-kéo (`laBam({ lechPx: e.delta })`,
  `LoBatchMay.tsx:48`) ⇒ vá ở đó;
- cả hai nhánh cùng tụt ⇒ vấn đề ở raycast/đích bấm ⇒ thuộc HM-1.

---

## §5. THỨ TỰ THI CÔNG, và vì sao đúng thứ tự đó

1. **HM-3 bước đo T1g (n ≥ 20)** — rẻ nhất, và nó quyết định HM-3 có cần bản vá sản phẩm không.
2. **HM-1 (đơn vị vẽ cụm trạm)** — hạng mục lớn nhất và nó **làm nhẹ cả ba hạng mục kia**: đích
   bấm đạt ngưỡng, ứng viên nhãn rơi một bậc nên `biChe` gần như biến mất, T1c có cơ hội tự xanh.
3. **Đo lại toàn bộ** (đường cơ sở vòng 3 + đường đánh đổi) — để biết HM-2 còn mua được gì.
4. **HM-2 (a)** nếu và chỉ nếu bước 3 cho thấy còn đáng.
5. **HM-3 phần còn lại** — đóng hai ca e2e bằng số mới.

Làm ngược thứ tự này (ví dụ vá lớp phủ trước) là tự tạo ra một phép đo không quy được: hai bản vá
cùng chạm một con số thì không ai biết con số đến từ đâu.

---

## §6. CÁCH NGHIỆM THU CHUNG — áp cho MỌI hạng mục

Đây là phần không được rút gọn, vì ba vòng vừa rồi cho thấy chỗ hỏng hay nằm ở **thiết bị đo**
chứ không ở sản phẩm.

- **Bước 0 (MSA) trước mỗi lượt đo**: `dist` khớp nguồn **cả hai nửa**; cây sạch; và **chứng minh
  bundle = HEAD bằng một trường/hành vi chỉ có ở HEAD**, không tin dấu thời gian.
- **Dữ liệu phải SỐNG**: bơm `--chi-nhip` **trước TỪNG ca**, không phải một lần ở đầu — ngưỡng
  `khong_ro` là 300 s mà một lượt quét dài hơn thế. Đo trên nhịp cũ là **đo một cảnh đã tắt**.
- **Oracle độc lập**: SQL thẳng vào CSDL, và **mọi phép tính tuổi làm TRONG SQL**
  (`lastHeartbeat` là `timestamp` naive ⇒ đi vòng qua JS là lệch **đúng 7 tiếng**, kể cả trên
  đường KHÔI PHỤC).
- **Toạ độ**: `dsMay()`/`hopKhoiMay()` là **px gốc canvas** ⇒ bấm phải cộng `cv.left/cv.top`.
  `hopKhoiMay` dùng để đo **diện tích**, `dsMay` dùng để **bấm**.
- **Ablation là bắt buộc**: gỡ đúng bản vá ⇒ chỉ số phải tụt về đường cơ sở ⇒ hoàn nguyên. Với
  prop mới đi qua `CanhVanHanh`, ablation phải nhắm **từng chặng trong năm chặng** (bẫy G5: gỡ một
  chặng ⇒ tính năng mất mà `tsc` vẫn xanh).
- **Kiểm NHÁNH KIA**: mọi bản vá chạm lớp nhãn/màu phải đo **cả bản 2D lẫn 3D**, và nhớ rằng
  **oracle đổi DẤU giữa hai bề mặt** (3D `doMo` nhân màu ⇒ nhạt = tối; 2D `fill-opacity` trên nền
  sáng ⇒ nhạt = **sáng**). Khi nghi ngờ, bỏ pixel và đọc **thuộc tính đã render**.
- **Lưới cũ chặn bản vá** thì **phân loại trước khi sửa**: ca ghi trạng thái lỗi ⇒ lật · ca canh
  hazard viết theo hình dạng mã ⇒ thu hẹp về bất biến **và kiểm lại nó vẫn biết kêu** · ca ghim
  quyết định chủ dự án ⇒ **chỉ chủ dự án lật**.

---

## §7. CÁI KHÔNG LÀM, VÀ VÌ SAO

- **Không đổi engine.** Vòng 1 đã đo: `/corporate-layout` 62,7 lệnh vẽ/khung ở 60 fps trong khi
  `/twin` 7 lệnh vẽ/khung ở 9,2 fps ⇒ three.js chiếm **1 %** thời gian; thủ phạm là `getImageData`
  (**93 %**), đã vá. Đổi engine là trả giá lớn cho 1 %.
- **Không nới hằng số giới hạn tốc độ** để lượt đo chạy nhanh hơn (gặp HTTP 429 ở máy thứ 301 khi
  duyệt hàng loạt — sản phẩm làm ĐÚNG; đi theo nhịp của nó, 120 ms/lượt).
- **Không vá `BatchedMesh.dispose()` gọi hai lần**: ép đúng đường tháo/lắp lô (đổi nhà máy ×4,
  bật/tắt 2D ×3 vòng, SPA rời/về ×4) ⇒ **0 `pageerror`**. Không tái hiện được thì không vá.
- **Không đụng nợ có sẵn của `server/routers`** (~36 tệp / ~126 ca đỏ, lớp G108) trong phạm vi
  này. Cách phân biệt "của mình" với "có sẵn" đã có: chạy **hai lượt có-vá/không-vá** với
  `--reporter=json` rồi `comm` hai danh sách tệp đỏ. ⚠ Đừng grep ký tự `❯` — lượt đầu của tôi so
  **hai tập rỗng** và in ra "bản vá vô can".
- **Không seed lại QATD-A/B/C**: phiên `-52` đang lấy mốc `2026-09-16 09:05:42.281539` làm nền đo.
  Việc cần làm ở đó đã xong bằng đường không phá gì (cấp khoá, `machines` không đổi một byte).
