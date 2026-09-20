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

---

## HM-3 — KẾT QUẢ BƯỚC 1 (2026-09-19): không cần vá, và cũng không được sửa ca

Bản thiết kế đặt bước đầu là *"đo lại T1g với n ≥ 20"* vì n = 4 không phân biệt được lỗi thật với
nhiễu. Đã đo, và kết quả đi xa hơn dự kiến.

### Bốn phép đo, mỗi phép loại trừ một biến

| phép đo | thiết kế | kết quả |
|---|---|---|
| kéo camera rồi bấm | 22 máy × 2 nhánh, xen kẽ thứ tự | **22/22** không kéo · **21/22** có kéo — chênh 4,5 điểm |
| máy bị nhãn máy khác đè | đúng tập T1g lọc, 12 + 12 máy | **12/12** vs **12/12** |
| `goBack` (đường T1g dùng) | 3 nhánh × 9 máy: tải lại · goBack · goBack cụm-3 | **9/9 · 9/9 · 9/9** |
| chạy chính spec | `-g "T1c\|T1g"` ×2 (nhịp tươi & nhịp 401 s), rồi trọn bộ | **8/8 · 8/8 · 16/16** |

**Tổng 95 cú bấm, 94 ĐẠT** — trong đó 33 cú trên đúng tập "máy bị nhãn khác đè" mà T1g lọc.

⇒ Ba giả thuyết bị bác bỏ bằng số: **không phải cú kéo · không phải nhãn cướp click · không phải
`goBack`**. Và spec nay **16/16 XANH**, trong khi sáng cùng ngày nó **14/16** — đo hai lần, một lần
có bản vá vòng 1 và một lần đã ablation gỡ ra.

### Vì sao KHÔNG sửa ca

Bản thiết kế dự trù nhánh *"hai nhánh ngang nhau ⇒ sửa ca, không sửa sản phẩm"*. Nhánh ấy
**không áp dụng được**: ca đang **xanh**. Sửa một ca đang xanh mà mình không hiểu vì sao nó từng
đỏ chính là **im một cảnh báo**, đúng thứ luật dự án cấm. ⇒ Không đụng vào `twin-dot47-bam-canh.spec.ts`.

### Giả thuyết dẫn đầu, và bằng chứng của nó — MÁY CHỦ ĐO ĐÃ SUY YẾU

Giữa lượt đỏ và lượt xanh có một khác biệt mà tôi không cố ý tạo ra: **máy chủ 3080 đã chết và
được dựng lại**. Nhật ký của tiến trình cũ để lại đúng ba dấu:

- log phình **1,94 GB**;
- `[StoreForward] buffered 6796 telemetry row(s) (DB unavailable); queue=6796` — **CSDL có lúc
  không phục vụ được**, và hàng đợi dồn trong bộ nhớ;
- tiến trình biến mất **không để lại dòng fatal/OOM nào**.

Lượt đỏ chạy trên tiến trình ấy; lượt xanh chạy trên tiến trình mới. T1c đỏ với `soNhan: 0` —
**không một nhãn nào trong DOM** — là đúng hình dạng của một cảnh thiếu dữ liệu trạng thái, chứ
không phải của một lớp nhãn hỏng.

⚠ Không chứng minh được hồi tố. Ghi là **giả thuyết dẫn đầu**, không phải kết luận.

### Hai luật rút ra cho hệ đo (áp cho mọi vòng sau)

1. ★ **Máy chủ chạy lâu, đã từng ghi `DB unavailable`, KHÔNG phải nền đo hợp lệ.** Trước một lượt
   đo nghiêm túc: dựng lại và khởi động lại, rồi mới đo. Bước 0 (MSA) từ nay phải hỏi thêm *"tiến
   trình này sống bao lâu rồi, và nó có ghi `DB unavailable` không?"* — chứ không chỉ hỏi *"bundle
   có khớp nguồn không?"*
2. ★ **Không khởi động máy chủ sống-lâu qua background task của công cụ Bash** — nó bị dọn theo
   vòng đời task, và cái chết ấy hiện ra ở tầng trên dưới dạng *"bộ đo chết giữa chừng"* (tôi đã
   mất một lượt đo vì chẩn đoán nhầm sang lỗi harness). Dùng tiến trình tách rời
   (`Start-Process ... -PassThru`), rồi **xác nhận cổng còn nghe** trước khi đo.

### Trạng thái HM-3

**ĐÓNG với điều kiện.** Không vá sản phẩm, không sửa ca. Nếu hai ca ấy đỏ lại, việc đầu tiên là
kiểm tuổi tiến trình máy chủ và tìm `DB unavailable` trong log — trước khi nghi ngờ mã.
Thô: `.qa-v2/tho-v5/`.

---

## HM-1 §2.1 — CƠ CHẾ CỦA NGƯỠNG (phần bản thiết kế còn thiếu, đã đo 2026-09-19)

Bản thiết kế khai ngưỡng *"đổi đơn vị vẽ khi trung vị diện tích khối < 576 px²"* nhưng **không
nói lấy con số ấy ở đâu**. Đó là một lỗ hổng thật: diện tích trên màn là đại lượng **không gian
màn hình**, phụ thuộc tư thế camera, nên chỗ lấy nó quyết định cả kiến trúc lẫn hiệu năng.

### Hai cách, và vì sao chọn cách thứ hai

| | cách | vì sao |
|---|---|---|
| (a) | đo hình chiếu **mỗi khung** rồi `setState` | ✕ Đúng *pitfall #1* của R3F — vòng 1 đã trả giá đúng chỗ này (`LopCanhBao`/`LopNhan` `setState` mỗi khung, 9,2 fps). |
| **(b)** | **công thức đóng**, tính lại **khi camera đổi** | ✓ Hàm thuần ⇒ lưới kiểm được mà không cần dựng cảnh; O(N) trên một **sự kiện**, không phải mỗi khung; `onCameraDoi` đã được nối sẵn. |

```
caoPx = caoThatM / (2 · d · tan(fov/2)) · caoCanvasPx
```

### ★ `d` là khoảng cách camera → CHÍNH MÁY ĐÓ, không phải bán kính quỹ đạo

Đây là chỗ tôi suýt làm sai, và phép đo bắt được trước khi có một dòng mã nào.

Quét 7 nấc cuộn trên `/twin` FUYU-F @1280×720, kiểm bất biến `caoPx × d` (phải gần HẰNG nếu công
thức đúng), với `d` = **bán kính quỹ đạo** đọc từ `window.__tuTheCamera`:

| mẫu dùng để lấy `caoPx` | tích ở nấc 0 | tích ở nấc 18 | trôi |
|---|---|---|---|
| **trung vị** toàn tập | 1269,7 | 889,2 | **−30 %** |
| **một máy CỐ ĐỊNH** (id 7583) | 1211,8 | 1034,6 | **−15 %** |

Hai bài học tách bạch:

1. **Trung vị chạy trên một TẬP ĐANG CO** (176 → 113 khối khi phóng to) ⇒ "máy trung vị" đổi danh
   tính giữa các nấc, và một nửa độ trôi là của **thành phần mẫu**, không phải của công thức.
   Bám một máy cố định thì nửa ấy biến mất ngay.
2. **15 % còn lại là sai số của PROXY**: `__tuTheCamera` cho bán kính quỹ đạo (camera → điểm
   ngắm), còn công thức đòi camera → chính máy đó. Máy lệch trục thì hai khoảng cách ấy **co
   khác nhau**: đo được `caoPx` tăng 3,10× trong khi bán kính quỹ đạo giảm 3,63×.

⇒ **Công thức không sai; proxy của tôi sai.** Cài đúng phải lấy khoảng cách tới từng máy.

### Hệ quả cho cách cài

- Ngưỡng tính bằng một **hàm thuần**:
  `(máy[viTri, cỡ thật], viTríCamera, fov, caoCanvasPx) → trung vị caoPx`.
  Không đụng R3F, lưới kiểm được như `locNhan`/`locBadge` đang được kiểm.
- Gọi lại **khi camera đổi** (qua `onCameraDoi` đã nối sẵn), không phải trong `useFrame`.
  O(549) phép trừ vector trên một sự kiện là rẻ; O(549) mỗi khung thì không.
- **Phải có TRỄ ĐÓNG/MỞ (hysteresis)**: một ngưỡng trần trụi ở đúng 576 px² sẽ **nhấp nháy** khi
  người dùng cuộn quanh mốc — cảnh đổi đơn vị vẽ qua lại giữa hai khung liền nhau. Đề xuất: bật
  cụm khi trung vị < 576, tắt khi > 864 (1,5×). Con số 1,5× phải được **đo** ở lưới, không chọn
  bừa: quét quanh mốc và đếm số lần lật.
- Lưới cho hàm thuần phải có **ca nghịch**: đưa camera ra xa ⇒ trung vị giảm ⇒ phải bật cụm; đưa
  vào gần ⇒ phải tắt. Chỉ kiểm một chiều là kiểm nửa hợp đồng.

### Trạng thái
Cơ chế đã chốt và đã có bằng chứng. **Chưa viết mã sản phẩm.** Việc kế tiếp theo đúng thứ tự §5:
dựng hàm thuần + lưới (gồm ca nghịch và ca trễ đóng/mở), rồi mới nối vào cảnh.
Thô: `.qa-v2/tho-v6/`.

---

# HOÀN THÀNH — cả ba hạng mục (2026-09-19)

| | hạng mục | kết cục | commit |
|---|---|---|---|
| HM-1 | bậc đơn vị vẽ thứ ba: **cụm trạm** | đích bấm **0/130 → 6/6 đạt 24×24** | `7601c12fe` `ad30f99dd` `0b6428019` `e258c62c4` `83ec12d81` |
| HM-2(a) | `bang-kpi-noi` thu ở khung hẹp | lớp phủ **70,8 % → 58,2 %**, nhãn vẽ **1 → 7** | `81a6bf670` |
| HM-3 | hai ca e2e đỏ | **không vá, không sửa ca** — không tái hiện được | `daf9d11de` |

Bộ e2e `twin-dot47-bam-canh`: **16/16** (`--workers=1`). Cổng: `tsc` 0 · `twin3d`+`pages`
**163 tệp / 3.467 ca / 0 đỏ** · `i18n:check` 0 khoá mới lỗi.

## HM-1 — nghiệm thu năm tiêu chí, đo trên trình duyệt thật

| tiêu chí | trước | sau |
|---|---|---|
| (1) ≥ 90 % đơn vị vẽ đạt 24×24 @1280×720 | **0/130 = 0 %** | **6/6 = 100 %** |
| (2) không mất máy nào | — | `dem-may` **549**, không đổi; cụm đại diện **176/176** máy của tầng |
| (3) ngân sách vẽ | — | **4** lệnh vẽ (<150) · **27.626** tam giác (<500 k) · **1** nhãn (<30) · **41,6** khung/s (≥30) |
| (4) ĐỐI CHỨNG ÂM `/twin/line/:id` | 39 đơn vị | **39 đơn vị — không đổi một ô** |
| (5) tự tắt khi phóng to | — | **nấc 55** (`d = 4,4 m`) ⇒ về 98 đơn vị |

★ Bấm cụm ⇒ `/twin/line/514`. ★ **ABLATION**: gỡ đúng một chặng nối dây (prop `lineTheoMay` ở
chỗ gọi) ⇒ **0 %**, 176 đơn vị, bấm mở `/twin/may/:id`; hoàn nguyên ⇒ **100 %**.

**Bản 2D** (bài học Task 20 — *"hai nút, một bộ luật"*): `data-don-vi-ve="cum"` · **6 cụm = 6 cụm
của 3D** · cạnh nhỏ **6/6 ≥ 24 px** · **176/176** máy đại diện.

## ★★★ Sáu lỗi mà CHỈ phép đo live bắt được — lưới đơn vị mù hoàn toàn

1. **`useThree((s) => s.camera)` trả CÙNG MỘT thực thể** suốt vòng đời cảnh; `.position` đổi tại
   chỗ. Nên `useMemo` khai `[camera]` **không bao giờ tính lại** — công tắc vẫn lật đúng (nó đọc
   `.position` lúc gọi) nhưng **cỡ cụm đóng băng ở tư thế đầu tiên**: cụm tính ở `d = 34,9 m` ra
   1,42 m (đúng 24 px ở đó), rồi `OrbitControls` kéo camera ra khớp khung và 1,42 m ấy còn
   **4,76 px**. Hàm thuần vẫn đúng; cái sai là **nó không được gọi lại**.
2. **`LopNhan` vẫn nhận `khoiMay={may}`** khi cảnh đã vẽ cụm ⇒ lớp nhãn né những khối **không còn
   được vẽ**, và `hopKhoiMay()` — cửa sổ mà e2e/nghiệm thu đọc — khai **176** khối trong khi cảnh
   vẽ **6**. Hai con số cho cùng một câu hỏi.
3. **Trung vị là thống kê SAI cho câu hỏi này.** Công tắc ban đầu dùng trung vị trên máy trong tầm
   nhìn; phóng tới trần zoom mà **không bao giờ lật về** — ở `d = 2 m` vẫn 54 máy trong frustum,
   trung vị 7,27 px, vì frustum là hình nón vô tận nên máy xa dọc trục áp đảo. Đếm theo **đầu máy**
   cũng sai: 3/54 máy đạt ngưỡng nhưng ba cái ấy chiếm gần trọn màn. ⇒ hỏi bằng **DIỆN TÍCH**, và
   hai mốc `[5 %, 35 %]` lấy từ chính phép đo (tổng quan 0 %; đã phóng sát 24,6–37,7 %).
4. **Quy ước ĐÁY, không phải tâm.** Tôi đặt `viTri.y = caoM/2` kèm chú thích *"nếu không nó lún
   nửa thân"* — suy từ trực giác mà không đọc phía tiêu thụ. `MayTrongLo.viTri` khai *"Vị trí ĐÁY
   máy trên sàn"* và `neoTrenNoc()` cộng TRỌN `caoMm`; đặt tâm vào đó là biểu tượng **nổi lên**
   nửa thân. ⚠ **Lưới cũ xanh vì nó ghim chính cái sai của tôi** — một lưới viết cùng lúc với mã,
   từ cùng một giả định, không kiểm được giả định ấy.
5. **`px/mét` phải là MIN của hai chiều** ở bản 2D: `<svg>` mặc định `preserveAspectRatio` nên tỉ
   lệ thật là chiều bị bó hẹp hơn. Lấy theo bề rộng ⇒ cụm ra **18,17 px** thay vì 24 (= 0,757 lần,
   đúng tỉ số hai chiều của khung).
6. **Thu bề ngang KHÔNG đủ** cho HM-2: hạ `min-w` 13rem → 9rem + nén đệm ⇒ phủ 70,8 % → **70,3 %**,
   đúng nửa điểm, vì bảng dùng `w-max` nên bề ngang do **nội dung** quyết định. Lever thật là
   **chiều cao**.

## Hai chỗ phép đo CỦA TÔI tự sinh phát hiện giả

- **Tiêu chí (d) của bản 2D so nhầm mẫu số**: `tongMayDaiDien` với `dem-may`. Ô ấy **cố ý** đếm
  theo NHÀ MÁY (`cayVanHanh.ts:58-61`: *"cùng chữ máy, hai mẫu số"*) còn cảnh vẽ MỘT TẦNG.
- **Phép đo vòng 3 bị chính HM-1 làm hỏng**: `dsMay()` nay mô tả **cụm** (id âm) nên phép đối
  chiếu SQL "máy bất thường trong khung" trả 0. Số còn dùng được là `__demNhan.ve`.

## Lưới cũ chặn bản vá — phân loại rồi mới sửa

`twin-dot47-bam-canh` ghim *"bấm khối ⇒ `/twin/may/:id`"* như một **hằng**, nên 3/16 đỏ. Phân
loại: **không** phải lật QĐ-23 (*"bấm Line ⇒ màn Line"*) — cụm trạm **là** một line, nên bấm nó
mở màn Line đúng tinh thần ấy. Cái lạc hậu là **cơ chế** của ca: nó giả định mọi khối trên `/twin`
đều là một máy. ⇒ `duongMongDoi()` hỏi đơn vị vẽ hiện hành rồi trả **đúng một** đường dẫn mong đợi.
Ca vẫn ghim một đích duy nhất; bậc `may` vẫn phải mở `/twin/may/:id`, nên nếu HM-1 lỡ bật cụm ở
màn Line thì ca ấy đỏ ngay.

★ Và ở đây tôi lại khái quát quá tay một lần nữa: cho **cả ca bấm NHÃN** đi theo đơn vị vẽ ⇒
timeout. Khối ở bậc cụm đại diện một LINE, còn **nhãn nêu tên MỘT MÁY** cụ thể nên nó phải mở đúng
máy ấy. Cho nhãn đi theo đơn vị vẽ là biến một cái **tên** thành một cái **nhóm**.

## CÒN MỞ — nói thẳng

- **Chồng lấn biểu tượng cụm — ĐÃ ĐO (2026-09-19), không còn là ẩn số.**

  | khung | đơn vị vẽ | cặp chồng | diện tích chồng |
  |---|---|---|---|
  | 1280×720 | 6 | **3** | **6,1 %** (453/7.451 px²) |
  | 1920×1080 | 6 | **0** | 0 % |

  ⇒ Có chồng ở khung hẹp nhưng chỉ là **những dải mỏng ở mép**: mỗi biểu tượng vẫn còn ~94 %
  diện tích riêng, và cú bấm ở vùng tâm vẫn phân giải đúng (nghiệm thu bấm cụm ⇒ `/twin/line/514`).
  Nên *"100 % đạt 24×24"* đứng vững — nhưng con số 6,1 % phải được nói ra chứ không được im.
  **Chưa hành động**: giãn bố cục là một đánh đổi (giãn ra thì biểu tượng rời khỏi chỗ máy thật
  đứng), và 6,1 % chưa đủ để trả giá ấy. `demCapChongNhau()` vẫn **chưa được gọi ở đường sản
  phẩm** — nó là công cụ cho vòng sau, và phép đo trên làm bằng bộ đo ngoài.
- **Bấm cụm ở bản 2D chưa nghiệm thu được**: @1280×720 mọi cụm 2D đều rơi dưới lớp phủ. Cần đo lại
  sau HM-2(a) (bản đo chạy trước khi HM-2 vào).
- **Màn Line vẫn 5,87 px/đơn vị** — ngoài phạm vi HM-1 theo đúng thiết kế, nhưng nó là cùng một
  lớp vấn đề và chưa có hạng mục nào nhận.
- **Nhãn cụm**: ở bậc cụm, nhãn vẫn là **tên MÁY** (được nâng lên nóc cụm), chưa có nhãn nói
  *"line 514 · 29 máy · 3 bất thường"*. Thiết kế có nêu; tôi chọn giữ tên máy vì đó là thứ vòng 3
  chứng minh người vận hành đang mất. Đánh đổi này **chưa được đo**.

---

# ĐÓNG CÁC MỤC CÒN MỞ (2026-09-19, tiếp)

## 1. Bản 2D khớp khung theo NỘI DUNG — `674779eb8`

Truy tiếp mục *"bấm cụm ở bản 2D chưa nghiệm thu được"* thì lộ ra một khuyết tật **có sẵn**,
không phải của HM-1.

| | trước | sau |
|---|---|---|
| `viewBox` | **3004 × 2004 m** | hộp bao máy + lề |
| nội dung lấp | **1,7 %** bề rộng | ~100 % |
| tỉ lệ vẽ | **0,244 px/m** | **2,369 px/m** |
| bấm cụm 2D | **không cụm nào bấm được** (cả 6 rơi vào ô `hang-tong-quan`) | **ĐẠT** ⇒ `/twin/line/:id` |

Ở `0,244 px/m`, một đích bấm 24 px đòi một vật **98 mét** — rộng gần gấp đôi toàn bộ vùng máy.
Bản 3D vốn tự khớp theo nội dung, nên hai bề mặt đang trả lời khác nhau về cùng một nhà máy.
Sàn vẫn được vẽ nguyên kích thước thật: đây là đổi **khung nhìn**, không phải đổi **sự thật về sàn**.

Bản 2D nay **đạt cả năm tiêu chí**: đơn vị vẽ khai `"cum"` · 6 cụm = 6 cụm của 3D · cạnh nhỏ
**6/6 ≥ 24 px** · **176/176** máy đại diện · bấm cụm mở màn Line.

## 2. Nhãn CỤM thay nhãn MÁY ở bậc cụm — `a5eeb4508`

Thiết kế §2 khai *"nhãn gắn cho CỤM chứ không cho máy"*; tôi đã lệch khỏi nó (giữ nhãn máy, chỉ
nâng điểm neo) và **tự ghi đánh đổi ấy là chưa được đo**. Nay đo rồi, và thiết kế đúng.

| @1280×720 | trước | sau |
|---|---|---|
| ứng viên nhãn | 182 | **6** (đúng số cụm) |
| nhãn vẽ được | 7/19 | **5/6** |
| `biChe` | 11 | **1** |
| @1920×1080 | 15 vẽ / biChe 1 | **6/6 vẽ · biChe 0** · chip biến mất |

Lý do nhãn cụm đúng hơn: tên một cái máy nằm **bên trong** cụm là thứ người vận hành **không hành
động được** ở tầm nhìn này — họ không bấm được cái máy ấy, chỉ bấm được cụm. Thứ hành động được
là *"line nào đang có máy hỏng"*. Nhãn hiện đúng: **"38 machines · 2 abnormal"**, tổng lại
**176 máy / 19 bất thường** — khớp chính xác số máy của tầng và số ứng viên của chế độ
chỉ-nhãn-bất-thường.

### ★ Một khuôn rút ra: khẳng định đi theo THỨ MÀ NHÃN ĐẶT TÊN

Tôi phải sửa **ba lần** đúng một chỗ trong lưới e2e, và cả ba đều có lý do riêng:

1. ban đầu ca ghim hằng `"/twin/may/:id"` ⇒ đỏ khi đơn vị vẽ thành cụm;
2. tôi cho **cả nhãn** đi theo đơn vị vẽ ⇒ **sai lúc ấy**, vì nhãn vẫn là nhãn MÁY (chỉ nâng neo);
3. nay nhãn **là** nhãn cụm nên nó đặt tên một LINE ⇒ phải mở `/twin/line/:id`, y như khối cụm.

Bậc `may` vẫn đòi `/twin/may/:id` y như cũ, nên ca **không bị nới** — nó chỉ thôi giả định rằng
mọi nhãn đều nêu tên một cái máy. e2e `twin-dot47`: **16/16**.

## 3. ⚠ MÀN LINE — đã đo, và nó là một QUYẾT ĐỊNH THIẾT KẾ, không phải một bản vá

Đo `/twin/line/526` (39 máy):

| khung | nội dung lấp ngang | nội dung lấp **dọc** | cạnh nhỏ trung vị | đạt 24×24 |
|---|---|---|---|---|
| 1280×720 | 80,5 % | **1,2 %** | 5,87 px | **0/39** |
| 1920×1080 | 88,9 % | **1,3 %** | 10,76 px | **0/39** |

Line là một dải **~130 : 1**, nên khung khớp theo chiều dài và **98,8 % chiều cao canvas bỏ không**.
Và không nấc zoom nào vừa thấy trọn line vừa có đích ≥ 24 px: ở nấc 18 chỉ còn **11/39** máy trong
khung. Đây **không phải** lỗi khung nhìn như bản 2D — khung đã khớp đúng; hình dạng của dữ liệu
mới là thứ chặn.

**Ba lối, mỗi lối một cái giá — cần chủ dự án chọn:**

| | làm gì | được | giá |
|---|---|---|---|
| **(L1)** | giữ nguyên | 0 | đích bấm 5,87 px vĩnh viễn; người vận hành đi qua nhãn/danh sách |
| **(L2)** | **bố cục SƠ ĐỒ** cho màn Line: xếp 39 máy thành lưới lấp khung, **khai rõ là sơ đồ** (có tiền lệ `laSoDo` của Task 20, và `banner-vi-tri-tam-sinh` đã có khuôn) | đích bấm đạt ngưỡng; thấy trọn line | vị trí trên cảnh thôi là toạ độ thật — phải nói ra, và phải giữ lại con số thật để banner nêu được cả hai |
| **(L3)** | cuộn dọc theo line thay vì khớp trọn | đích bấm to | mất cái nhìn tổng thể của line |

Tôi **không tự chọn** vì (L2) đổi ý nghĩa của vị trí trên màn Line — đó là một ràng buộc trung
thực, không phải một chi tiết kỹ thuật.

## Trạng thái cổng cuối

`tsc` **0** · `twin3d`+`pages` **164 tệp / 3.472 ca / 0 đỏ** · `i18n:check` **0** khoá mới lỗi ·
e2e `twin-dot47-bam-canh` **16/16** (`--workers=1`) · cây sạch.

---

# L2 — MÀN LINE THÀNH **SƠ ĐỒ RẮN BÒ** (`7c8938786`)

Chủ dự án chốt lối **(L2)** trong ba lối đã trình. Đây là hồ sơ thực hiện.

## Kết cục — tiêu chí duy nhất: đích bấm ≥ 24×24 px **và** thấy trọn chuyền

| `/twin/line/526` (39 máy) | lấp NGANG | lấp **DỌC** | cạnh nhỏ trung vị | đạt 24×24 | bấm |
|---|---|---|---|---|---|
| **trước** @1280×720 | 80,5 % | **1,2 %** | 5,87 px | **0/39** | `/twin/may/:id` |
| **trước** @1920×1080 | 88,9 % | **1,3 %** | 10,76 px | **0/39** | `/twin/may/:id` |
| **sau** @1280×720 | 65,1 % | **49,4 %** | **49,57 px** | **39/39** | `/twin/may/:id` |
| **sau** @1920×1080 | 86,4 % | **58,5 %** | **107,59 px** | **39/39** | `/twin/may/:id` |

Không mất máy nào (39/39 vẽ). Banner khai sơ đồ có mặt ở cả hai khung.

### ABLATION — mỗi lớp một lần, hoàn nguyên sau mỗi lần

| gỡ gì | kết cục |
|---|---|
| **A** — gỡ SƠ ĐỒ | trở lại **đúng** số cơ sở: 80,5 %/1,2 %, 5,87 px, **0/39**, banner biến mất |
| **B** — gỡ bản vá MỤC NGẮM | 36 khối, lấp **2.746 %/8.933 %**, cảnh trống, bấm không đi đâu |
| hoàn nguyên | **39/39** cả hai khung |

A tái hiện chính xác con số đã ghi ở lượt đo trước — tức nó xác nhận **cả đường cơ sở lẫn
thiết bị đo**, không chỉ bản vá.

## Vì sao **RẮN BÒ**, không phải một lưới bất kỳ

Một chuyền là một **TRÌNH TỰ**. Xếp 39 máy theo id thì đích bấm đạt ngưỡng nhưng *"sau máy này
là máy nào"* biến mất — đổi một khuyết tật lấy một khuyết tật khác. Rắn bò giữ **hai máy liền kề
trong dòng chảy thì liền kề trên màn, kể cả ở chỗ xuống hàng**, và `duongTam` (mũi tên dòng chảy)
đi theo đúng đường ấy.

Thứ tự lấy từ `stations.thuTu` **chỉ khi mọi máy tra được**; thiếu một cái là rơi **hẳn** về thứ
tự theo vị trí. Trộn hai thang tạo ra một trình tự *trông như* trình tự công nghệ mà không phải.

## Ràng buộc trung thực — cùng luật với sa bàn tập đoàn

`banner-so-do-line` khai bằng **SỐ**: *chuyền dài 229 m × 1 m trải thành lưới 5×9 cho 39 máy; mặt
bằng mọi máy vẽ CÙNG MỘT CỠ 1,2×0,8 m trong khi cạnh thật trải từ 0,8 tới 1,2 m.* Câu **không nói
quá**: chiều cao khối, cao độ sàn và **thứ tự dòng chảy** vẫn là số thật.

## ★★★ Ba khuyết tật chỉ phép đo LIVE bắt được

**① Tôi ngắm camera vào một THỐNG KÊ của bbox — và sai HAI LẦN ở đúng một chỗ.**
Bbox màn Line trộn **ba** cao độ: mặt phẳng máy (**tầng 3, y = 16,6 m**), đáy cột WIP
(`bboxKemCotWip` **ép cứng `minY: 0`**) và đỉnh cột WIP (16,6 m — chiều cao mã hoá 314 WIP).
`tamBBox().y` ⇒ ngắm cao hơn sàn 8,3 m; `bbox.minY` ⇒ ngắm **thấp hơn máy 16,6 m**, máy chiếu
xuống **y ≈ 975 px** trên canvas cao 437 px. Không thống kê nào của một bbox như thế trả lời được
*"mặt phẳng máy ở đâu"* — chỉ **tập máy** trả lời được, nên `yMatPhangM` phải được **truyền vào**.

**② `OrbitControls` bị dựng lại ⇒ `target` reset về gốc toạ độ.**
Camera **giữ nguyên vị trí** `(124; 27,9; 132,8)` mà hướng nhìn lật từ `(0; −0,970; −0,243)` thành
`(−0,675; −0,152; −0,723)` — gần như **nằm ngang**, chỉ về gốc. Giải ngược: mục ngắm rơi đúng về
`(0,1; 0; 0,1)`. Cảnh chỉ còn sàn trống, **không một lỗi nào nổ**.

> ⚠⚠ **Vì sao chỉ lộ ra bây giờ** — và đây mới là bài học: trước đây `khungNhin` đổi **giá trị**
> mỗi khi dữ liệu sống về, nên một tween mới luôn chạy sau đó và **vô tình ngắm lại**. Sơ đồ làm
> `khungNhin` ổn định theo giá trị ⇒ tween thôi chạy lại ⇒ khuyết tật hết chỗ nấp.
> **Một hành vi tình cờ đang che một khuyết tật là một bản vá không ai biết mình có, và nó hết
> hiệu lực đúng vào lúc có người dọn cái tình cờ ấy đi.**

**③ Hộp bao khớp khung dựng từ TÂM máy.** `hinhHocLine` trả một đám **ĐIỂM**. Ở 1280 lề px cố
định đủ che; ở **1920** cùng số px ấy nhỏ đi tương đối và khuyết tật lộ ra: **lấp 118,6 % bề
ngang**, hai cột rìa bị cắt. ⇒ `hopBaoSoDo` bao cả mặt bằng và chiều cao thật.

## Thiết bị đo của TÔI cũng hỏng hai lần

- **`hm1.cam` là ẢNH CHỤP, không phải số sống.** Effect không phụ thuộc vị trí camera (thực thể
  `camera` bất biến — **cùng cái bẫy `useThree`** đã ghi ở `nguongDonViVe`). Đọc nó trong một
  phiên đo dài cho số **cũ** và tôi kết luận *"camera đứng yên"* trong khi nó đang bay. ⇒ thêm
  `camHienTai()`: một **HÀM**, gọi lúc nào đọc lúc ấy. Đó là thứ tìm ra khuyết tật ②.
- **`--reporter=json` ghi UTF-8 còn python đọc bằng cp1252** ⇒ **mọi** đột biến đều báo *"KHÔNG
  ĐỌC ĐƯỢC"*. Một thước luôn báo cùng một thứ thì nó không đo gì cả.

## Lưới cũ chặn bản vá — phân loại rồi mới sửa, KHÔNG nới

Ba lưới tra hằng chữ `"const mayVe = useMemo"` để ghim deps/đối số của phép dựng máy. Màn Line
đổi tên memo ấy thành `mayVeThat` (nhường tên `mayVe` cho bản đã trải) ⇒ **6 ca đỏ**, trong khi
thứ chúng ghim **không đổi một chữ**. ⇒ lưới canh theo **HÌNH DẠNG** (một cái tên) thay vì theo
**TÍNH CHẤT** (memo nào gọi `dungMayVe`). Sửa **cơ chế** bằng `shared/testing/dauMemoDungMayVe.ts`;
khẳng định **không bị nới** — bỏ một dep hay thay `gocToaTheoTang` bằng `new Map()` vẫn đỏ.

Ca thứ 7 ghim nguyên văn `bboxKemCotWip(hinhLine.hh.bbox, cotWipCanh)`: **quyết định** (*"khung
phải bao cả đỉnh cột WIP"*) còn nguyên; cái lạc hậu là giả định chỉ có **một** nguồn hộp bao.

## Lưới mới + đột biến

| tệp | ca | đột biến ĐỎ |
|---|---|---|
| `soDoLine.unit.test.ts` | 35 | **12/12** |
| `khungNhinSoDoLine.unit.test.ts` | 9 | **6/6** — KN1/KN2 dựng lại **chính hai lỗi của tôi** |
| `mucNgamSongSotDungLaiControls.unit.test.ts` | 4 | hạng B (đo VĂN BẢN) — nói thẳng là hạng thấp hơn; bằng chứng nhân quả thật là **ablation B** |

⚠ **DB8 SỐNG SÓT ở bản đầu**: ca chỉ so `viTri`/`gocXoayRad`, nên một đột biến trả
`{ ...m, hien: false }` **lọt** — máy vẫn trong mảng, vẫn đúng toạ độ, và **biến mất khỏi cảnh**.
Đúng lớp lỗi F2 mà ca ấy được viết ra để chặn, và nó **đo nhầm tính chất**. Đã đổi sang khẳng
định **đồng nhất thực thể**.

## Cổng

`tsc` **0** · `twin3d`+`pages` **936 tệp / 3.527 ca / 0 đỏ** · `i18n:check` **0** khoá mới lỗi ·
e2e `twin-dot47-bam-canh` **16/16** (`--workers=1`, cả `/twin` lẫn `/twin/line/2`).

> ⚠ **MSA**: lượt e2e đầu tiên là **16/16 ĐỎ** vì **cổng 3000 chết** (`ECONNREFUSED`), không phải
> vì sản phẩm. Dựng lại server, kiểm bản đang phục vụ **có** chứa mã mới **qua HTTP**, rồi mới
> chạy lại. Thô: `.qa-v2/tho-v12/`.

---

# HAI MÓN LỘ RA TRONG LÚC CHẨN ĐOÁN L2 (`1608be156`, `8801bff26`)

Cả hai đều do tôi nhìn thấy khi truy lỗi khung nhìn sơ đồ và **để lại** — nay xử nốt.

## ① Cột WIP đứng ở CỐT 0 thay vì sàn của trạm

`OngWip` đặt tâm trụ ở `(w.x, cao/2, w.z)` — đáy ở **`y = 0` tuyệt đối** — còn `CotWip` thì
**không có trường nào cho chiều đứng** để mà truyền. Đo bằng phép chiếu lại từ chính camera:

| khung | lệch DỌC | lệch trên màn (trung vị) | đứng đúng chỗ |
|---|---|---|---|
| 1280×720 | **16,6 m** | **111,3 px** (max 163,8) | **0/39** |
| 1920×1080 | **16,6 m** | **239,7 px** (max 358,3) | **0/39** |

Xa hơn một ô lưới, nên người vận hành đọc *"trạm này đang ùn"* từ một cây cột đứng dưới **một
cái máy khác**. Và nó câm hoàn toàn.

**Chuỗi đứt ở BỐN chỗ**, mỗi chỗ đều "hợp lệ" khi nhìn riêng: `dungHinhLine` viết cứng `y: 0` ·
trang bỏ `y` khi dựng `tamTram` (**cả hai** trang) · `TinhWip`/`CotWip` không có trường đứng ·
`OngWip` đặt đáy ở 0 **và** `bboxKemCotWip` ép `minY: 0` cho khớp. ★ Hai cái sai cùng hướng thì
**im lặng** — đó là lý do nó sống sót.

**Kết cục: 0/39 → 39/39**, lệch 111 px → **0 px**, cả hai khung.

### ⚠ Bản vá lộ ra khuyết tật THỨ HAI — và nó là HỆ QUẢ của sơ đồ

Cột nay dựng **lên trên** mặt máy thay vì treo dưới. Trần chiều cao cột (**6 m**) hiệu chỉnh cho
bố cục DẢI (chuyền 229 m); trên lưới sơ đồ **14,2 × 5,1 m** nó **cao hơn cả bề rộng lưới**, và vì
dựng *về phía* camera nhìn gần thẳng xuống, khung nhìn phải lùi **gấp đôi** (11,65 → 22,72 m):

> đích bấm nhỏ nhất **41,00 → 26,69 px** — vẫn *"đạt 24"* nên **không ca nghiệm thu nào đỏ**,
> chỉ biên an toàn bốc hơi từ 71 % xuống 11 %.

⇒ `thangCotWipSoDo`: **giữ ý định thiết kế gốc, suy lại con số**. `CAO_MOI_WIP_M` ghi nguyên văn
*"0,25 m × 20 WIP = 5 m — cao ngang một máy lớn"*; ở sơ đồ "một máy" cao **1,8 m** chứ không 5 m,
nên trần suy từ chính chiều cao máy (×1,2). **Tỉ số trần/mỗi-WIP giữ nguyên 24**, nên ánh xạ
WIP→chiều cao chỉ đổi **đơn vị**: trạm nào cao hơn trạm nào, và cao hơn bao nhiêu lần, không đổi
một chút nào. Kết cục **26,69 → 39,23 px** (96 % của 41,00), 39/39 vẫn đạt.

## ② Màn Line chưa nhận HM-2 — "vá xong phải kiểm NHÁNH KIA"

HM-2 (*bảng KPI mặc định thu ở khung ≤ 1366 px*) chỉ vào `TwinVanHanh.tsx`. Màn Line giữ
`useState(true)` — bảng **luôn mở**. Đo: `biChe` = **5** @1280×720, **0** @1920×1080.
`biChe = 0` ở khung rộng chứng minh đây là khuyết tật **BỐ CỤC**, không phải khuyết tật nhãn.

Sau khi áp cùng luật: **5 → 0**, và nghiệm thu bấm **không đổi một ô** (39/39, 46,88 px).

## ★★★ Thước đo của TÔI dính bẫy G92 của chính repo

Ca đầu ghim `toContain("useKhungHep(1366)")` trên văn bản **thô** — và docblock tôi vừa viết
trong `TwinLine.tsx` nhắc **nguyên văn** chuỗi ấy. Đột biến `const khungHep = false;` **sống
sót**: thước báo ĐẠT cho một trang đã gỡ mất bản vá. Sau khi tước chú thích: **3/3 đột biến ĐỎ**.

> **Một chú thích tốt không được biến thành một phép đo giả.** Repo đã ghi luật này ở
> `manLineNoiVaoTrang`; tôi viết một lưới mới và vẫn đi vào đúng cái bẫy ấy.

## ⚠ Vận hành — đã dính HAI lần trong lượt này

`npm run build` **ghi đè `dist/index.js` đang chạy** ⇒ giết server, và lượt đo kế tiếp báo
`ECONNREFUSED` trông y như một hồi quy sản phẩm. Thứ tự đúng: **build TRƯỚC, restart SAU**, rồi
kiểm bản đang phục vụ qua HTTP.

## CÒN MỞ — nói thẳng

- **Màn Line vẽ 30/39 tên** (9 bị giấu). Đo: `chongLap 0 · vuotMep 0 · biChe 0 · vuotTran 9` —
  tức **lý do duy nhất** là trần **30 nhãn DOM** (`TRAN_NHAN_DOM`), một **ngân sách hiệu năng có
  chủ ý của §4**, không phải tai nạn. Chip *"9 more names hidden"* khai ra đủ. **Không đổi.**
- **`demCapChongNhau()` vẫn chưa được gọi ở đường sản phẩm** (đo ngoài: 3 cặp / 6,1 % @1280×720,
  0 @1920×1080).
- **`TwinVanHanh.tinhWip` là BẢN SAO inline của `manLine.tinhWipLine`** (G12). Lượt này vá **cả
  hai cùng lúc** và ghi chú chéo; **không gộp** để khỏi đổi hành vi màn Vận hành ngoài phạm vi.

## Cổng

`tsc` **0** · `twin3d`+`pages` **943 tệp / 3.550 ca / 0 đỏ** · `i18n:check` **0** ·
e2e `twin-dot47-bam-canh` **16/16**. Thô: `.qa-v2/tho-v13/`, `.qa-v2/tho-v14/`.
