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
