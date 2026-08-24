# GIẢI THÍCH — chín mục đang chờ anh chốt

**File TẠM THỜI.** Dựng lại ngày **2026-08-25**, đọc trên commit **`e558b221`**.
*(Bản trước: viết 2026-08-24, đọc trên `ec6b7ce3`, cho **mười sáu** mục. Anh đã dùng bản ấy để phán
**cả sáu nhóm** ngày 2026-08-24 và cả sáu đã thi hành xong — nên file này không được viết lại từ đầu,
nó được **sửa cho đúng vòng sau**.)*

🔴 **File này KHÔNG phải nguồn sự thật.** Nguồn là **`docs/owner-decisions.md`**. File này chỉ **diễn
giải** nó cho người phải **QUYẾT**, chứ không cho người phải **KIỂM**. Chỗ nào hai file khác nhau,
**file kia đúng**. Xoá file này đi thì không mất một dữ kiện nào — đó là chủ đích, vì hai file nói
cùng một chuyện là hai file sẽ trôi xa nhau, đúng khuyết tật mục 37 và mục 71 mô tả.

**Mỗi mục dưới đây trỏ về mục gốc bằng SỐ và bằng TIÊU ĐỀ.** Thân mục không được chép lại: thân mục
dài hơn, chặt hơn, và có số dòng để kiểm.

🔴 **Mọi con số ở đây là LỜI KHAI của mục gốc, kèm ngày đo.** **Mười hai nhiệm vụ liên tiếp** vừa bác
được tiền đề trung tâm của chính mục chúng thi hành. Nên một con số trong file này nghĩa là *"phép đo
ngày ấy nói thế"* — **không** nghĩa là *"đúng"*.

---

# 🔴 BA VIỆC QUAY LẠI BÀN — đọc phần này TRƯỚC, nó dài hai phút

**Ba mục anh đã phán ngày 2026-08-24 đều đã thi hành xong và đã sang Phần III. Ở cả ba, CƠ SỞ mà
phán quyết đứng trên đã bị một phép đo bác — và ở cả ba, phép bác xảy ra SAU khi anh phán.** Không
mục nào bị dời khỏi Phần III và **không ai phán lại thay anh**. Cái ở đây là: **cơ sở nào sai, con số
đúng là bao nhiêu, và điều đó có đổi kết luận không.**

| mục | cơ sở anh đọc khi phán | đo lại, SAU khi phán | có đổi kết luận không |
|---|---|---|---|
| **62** — `LeakTestSim` công bố một cặp giới hạn phán quyết không dùng | quần thể là **MỘT** bộ mô phỏng; bất đồng trên **4,78 %** chu kỳ | quần thể là **HAI trên TÁM**; sản phẩm đo **5,025 %**; thành viên thứ hai bất đồng trên **40,790 %** — **gấp 8,12 lần** | 🔴 **MỘT CÂU HỎI MỚI CHO ANH** |
| **63** — `ConnectorRegistry.Register` last-write-wins cho id tường minh | hướng B làm **ĐỎ ĐÚNG MỘT** bài test | nó làm đỏ **BA** — **giá khai thiếu gấp ba** | **KHÔNG** — đo được, xem dưới |
| **68** — màn hình cài đặt nói sai theo chiều khẳng định | *"không dụng cụ nào bắt được"* nếu dừng ở B | dụng cụ **ĐÃ TỒN TẠI**, chạy trong cổng, từ **một ngày TRƯỚC** khi mục 68 được mở | **KHÔNG — và nó làm kết luận MẠNH HƠN** |

## Mục 62 — câu hỏi duy nhất quay lại bàn của anh

Anh phán **hướng B** (*giữ cặp giới hạn công bố, có chủ ý, có chữ ký*) cho **`LeakTestSim`**. Ba
điều được đo **sau đó**:

1. **Quần thể không phải một, mà là HAI.** `FunctionalTestSim` cũng công bố một cặp mà phán quyết
   của chính nó không dùng — nó thừa một **TRẦN** ở chỗ `LeakTestSim` thừa một **SÀN**. Hai ca
   **ngược chiều nhau**.
2. **Thành viên thứ hai nặng gấp tám.** `FCT-01`, seed 11, 100 000 chu kỳ ⇒ **40 790 chu kỳ =
   40,790 %** bất đồng, so với **5,025 %** của ca anh đã phán. **8,12 lần.**
3. 🔴 **Thành viên thứ hai do chính bản sửa mục 61 tạo ra, CÙNG NGÀY, theo cùng phán quyết của anh.**
   Con số 40 790 **bằng đúng** số ô mà bản sửa mục 61 đã dịch. Bản sửa **không xoá** bất đồng — nó
   **dời** bất đồng từ phán quyết của máy sang khe giữa phán quyết ấy và cặp giới hạn cùng reading
   công bố.

🔴 **VÀ MỘT LỖI ĐƠN VỊ TRONG CHÍNH CON SỐ ANH ĐỌC:** *"4,78 %"* là tích phân giải tích
`P(rò ≤ 3,0 | N(8 ; 3))` — một **tính chất của MÔ HÌNH**, được dẫn như một **tính chất của SẢN
PHẨM**. Sản phẩm đo được là **5,025 %**. Lệch nhỏ (0,245 điểm); **điểm không phải độ lớn, điểm là nó
không đo cái nó nói nó đo**.

**Người thi hành đã viết *"phán quyết B áp cho cả hai"*. Anh chưa bao giờ được hỏi về thành viên thứ
hai.** ⇒ **Câu hỏi:** *hướng B có áp cho `FunctionalTestSim` không, hay ca 40,790 % ấy cần một phán
quyết riêng?* — Ghi ở **§62.6** của mục gốc và ở hàng bảng phán quyết của mục 62.
📎 **Cái KHÔNG đổi:** phán quyết cho `LeakTestSim` đứng nguyên, hai bài test ghim nó không bị chạm, và
tần suất bất đồng **không** nói gì về số người bị ảnh hưởng — quần thể ấy vẫn **không đếm được**.

## Mục 63 — cơ sở sai, kết luận không đổi, và anh vẫn được quyền đọc lại

Bốn phép định giá anh đọc đều nói hướng B làm đỏ **một** bài; nó làm đỏ **ba**. Hai bài không ai nêu
tên nằm **cùng một file**, cách khối định giá *"một bài"* **chưa tới mười dòng**.

**Vì sao kết luận vẫn đứng — đo, không phải sở thích:** **3 bài / 1 hành vi / 0 đường sản xuất khác.**
Cả ba bài đọc **cùng một** hành vi B-6 (một hàng do biến môi trường gieo không được bảo vệ khỏi ghi
đè); không bài nào ghim một đường sản xuất khác. Và **vế A không dịch một chữ** — hướng A vẫn biến
**mọi lần sửa một kết nối** thành lỗi máy chủ trên một đường mà tài liệu của chính nó gọi là bình
thường. Phép so sánh anh dựa vào đếm **HÀNH VI**; con số bị dời là **BÀI TEST**. Thứ tự A-với-B
**không đảo**.

🔴 **Chiều ngược lại, vì một sự thật viết chỉ theo chiều thuận là một nửa sự thật:** cái giá **đã trả**
lớn hơn cái được báo **ba lần theo đơn vị artefact**, và một hành vi cố ý dựng nay bị chặn
(`POST /v1/connectors` cho một máy KHÁC đè lên hàng `Seeded` nay trả **409** thay vì **200 OK**).
**Nếu anh cho rằng ba-thay-vì-một là chênh lệch đủ để đọc lại, mục mở lại được — đó là quyền của anh,
không phải phép đo của tôi.** Ghi ở **§63.9**.

## Mục 68 — cơ sở sai theo chiều làm kết luận MẠNH HƠN

Cái giá anh chấp nhận khi chốt *"dừng ở B"* là, nguyên văn: *"lần thêm một bộ mô phỏng mới, câu cảnh
báo sẽ sai theo chiều ngược lại và **không dụng cụ nào bắt được**"*.

**Tách cái giá ấy làm hai nửa và đo từng nửa:**

| nửa | dụng cụ | trạng thái |
|---|---|---|
| **sự kiện kích hoạt** — một sim mới bắt đầu đọc tham số | `UnconsumedConfigKindsTests.The_declared_consumption_of_a_kind_matches_what_the_factory_actually_wires` | 🔴 **CÓ**, đỏ được **cả hai chiều**, **chạy trong cổng**, do BL-1 dựng cho **mục 42** ngày **2026-08-23** — **một ngày TRƯỚC** khi mục 68 được mở |
| **chặng cuối** — chuỗi trên màn hình vận hành viên (`web/src/i18n/en.ts` + `vi.ts`) | **không có** | **KHÔNG** — và nó thiếu vì **mục 60** (cổng không biên dịch TypeScript), **không** vì mục 68 |

⇒ **B rẻ hơn cái anh được báo; A không dịch một chữ ⇒ phép so sánh dịch VỀ PHÍA B.** Kết luận
*"dừng ở B"* **mạnh hơn**, không yếu đi. **Không có câu hỏi nào quay lại bàn của anh** — chặng cuối
đã có mục riêng (**mục 60**) và vẫn đang chờ anh ở nhóm C dưới đây.
🔴 **Một dè dặt về chính chữ *"mạnh hơn"*:** tôi đo được rằng **một** nửa có dụng cụ và nửa kia không.
Tôi **KHÔNG đo được** hai nửa ấy nặng bằng nhau bao nhiêu — không phép đo nào trong cây cân được
*"sự kiện kích hoạt"* với *"chuỗi trên màn hình"*. Chữ ấy nói về **CHIỀU**, không về **ĐỘ LỚN**.
Ghi ở **§68.7**.

---

## ⚠️ BA ĐIỀU PHẢI BIẾT TRƯỚC KHI MỞ BẢNG

**(1) BA trong chín mục mở đầu bằng dòng *"⚖️ ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC"* — trong khi cả ba đang nằm
trên kệ của ANH.** Đếm lại 2026-08-25 trên **cả chín** mục, đọc dòng đầu tiên dưới mỗi tiêu đề:
**49, 69, 71**. *(Bản trước đếm **năm** — 49, 63, 68, 69, 71; **63 và 68 nay đã đóng và sang Phần
III**, nên chúng rời quần thể. Sáu mục còn lại — 59, 60, 65, 70, 72, 74 — mở đầu bằng `🔴 CHỜ ANH`,
**đúng kệ**.)* Với **49** và **69**, một đoạn sau trong **chính mục ấy** đã ĐO rằng cái nhãn ấy
**SAI**; với **71**, phần ⚖️ (bờ tài liệu) đã trả xong và bờ còn lại chạm miễn trừ (b).
✅ **Ba dòng ấy nay đều mang một phép rút tại chỗ, kèm ngày 2026-08-25, và văn cũ giữ nguyên từng
chữ.** Nếu anh mở file và đọc dòng đầu của từng mục, **không mục nào còn nói với anh rằng nó không
phải của anh**.

**(2) HAI NHÓM NAY RỖNG, và cái rỗng ấy là một khẳng định chứ không phải một khoảng trắng.**
* **Nhóm E** (*"Giá đã đo xong; chấp nhận không?"* — mục 63 và 68): **cả hai đã được anh phán và đã
  thi hành ngày 2026-08-24**. Xem *"BA VIỆC QUAY LẠI BÀN"* ở trên.
* **Nhóm F** (*"Không có gì để quyết"* — mục 57): **mục 57 đã sang Phần III** ngày 2026-08-24 theo
  đúng hướng B anh chốt (sửa cái NHÃN, không nới phép kiểm).
* **Nhóm A rút từ bốn xuống một:** mục **41**, **43** và **61** đều đã được anh phán và đã thi hành
  cùng ngày. **Chỉ mục 71 ở lại.**
* **Nhóm D rút từ bốn xuống ba:** mục **62** đã đóng; **49, 65, 70** ở lại.

**(3) Con số ở TIÊU ĐỀ vài mục đã bị chính thân mục ấy RÚT — đo lại 2026-08-25.**
* **Mục 71** — tiêu đề nói *"BỐN trên NĂM hàng"*; §71.5.3 đo lại còn **HAI trên năm**. ✅ Phép rút
  nay sống **ngay dưới tiêu đề**, không chỉ ở §71.5.3 — vì tiêu đề là thứ đi vào bảng phán quyết.
* **Mục 60** — tiêu đề và §60.1 nói *"28 spec"* / *"ít nhất 142"*; **cổng dẫn xuất lúc chạy** đọc
  **29** / **ít nhất 144**. Chi tiết và **TÊN DỤNG CỤ** ở phần mục 60 dưới đây.
* **Mục 41** (đã đóng) — §41.4 liệt kê *"bảy bề mặt đọc"* và **vẫn nêu tên một file KHÔNG TỒN TẠI**.
  ✅ Cả hai nay có phép rút đặt **ở đầu §41.4**, nơi người đọc gặp trước.

---

## BẢNG TÓM TẮT — bốn nhóm sống, chín mục *(cộng hai nhóm ghi lại là RỖNG)*

| Nhóm | Mục | Câu hỏi MỘT DÒNG | Loại | Trả lời đóng được mấy mục |
|---|---|---|---|---|
| **C. Dụng cụ đo của ta có lỗ** | **60 · 74 · 72** | Trả tiền bịt lỗ hay không — và theo thứ tự nào? | **Giá hạ tầng / công cụ.** Khách hàng **không** thấy khuyết tật nào ở đây. | **1 quyết định chi tiêu + một thứ tự → đóng cả 3.** Hai trong ba nay đã có **hướng B đo xong hoặc chạy xong**. |
| **B. Cần một bên thứ hai** | **59 · 69** | Ai được sửa, bên kia có đồng ý không, và bản sửa lấy nhân chứng ở đâu? | 🔴 **KHÔNG quyết một mình được.** | **0 bằng một chữ.** Cả hai **đã BÀN GIAO** ngày 2026-08-24; cái chờ nay là **bên kia**, không phải anh — trừ **một mốc** anh phải đặt (xem mục 69). |
| **D. Một sự thật, hai bề mặt trả lời khác nhau** | **65 · 70 · 49** | Một lời khai đã công bố đo được là sai — **sửa và chịu chỗ gãy, hay giữ và ghi rõ?** | Anh quyết một mình được. | **1 CHÍNH SÁCH trả lời cả 3** ở tầng anh quyết; mỗi mục vẫn cần một chữ *"có/không"* riêng. Mục **49** vẫn bị khoá ở hai phần ba. |
| **A. "Con số nào đúng?"** | **71** | Không nguồn nào trong cây trả lời được — **sự thật là của anh**. | Anh quyết một mình được cho một nửa; nửa kia chạm **miễn trừ (b)**. | **0 bằng một câu.** Hai câu còn lại **khác loài nhau** — xem mục 71. |
| ~~**E. Giá đã đo xong; chấp nhận không?**~~ | ~~63 · 68~~ | **RỖNG từ 2026-08-24** — cả hai đã phán, đã thi hành, đã sang Phần III. | — | — |
| ~~**F. Không có gì để quyết**~~ | ~~57~~ | **RỖNG từ 2026-08-24** — mục 57 đã sang Phần III bằng một phép **sửa NHÃN**, không phải một phép **nới KIỂM**. | — | — |

**Thứ tự tôi đề nghị anh đọc:** **C** (một quyết định chi tiêu, ba mục — và hai trong ba nay đã có
con số thật thay cho một ước lượng) → **B** (đặt **mốc đọc lại** cho mục 69, hai phút, và nó là thứ
duy nhất ở nhóm này còn của anh) → **D** (một chính sách, ba mục) → **A** (một mục, cần anh nghĩ lâu
nhất).
📌 *Thứ tự này khác bản trước* — bản trước mở bằng **F** để gỡ một mục rỗng khỏi bàn; **F rỗng rồi**.

---

# NHÓM C — Dụng cụ đo của ta có lỗ

Ba mục này **không phải khuyết tật sản phẩm**. Khách hàng không nhìn thấy gì. Chúng là chỗ **dụng cụ
đo của chính ta bị mù**, và cái giá để bịt lỗ là **tiền và thời gian của ta**, không phải một đánh
đổi kỹ thuật. Nhãn 🔴 trên chúng nói về **GIÁ**, không về **QUYỀN**.

🔴 **Cái đổi từ bản trước:** cả ba nay đã trả xong nửa *"khai ra chỗ mù"*, và **hai trong ba có hướng
B đã được ĐO hoặc đã CHẠY** — nên câu hỏi của anh hẹp hơn hôm 2026-08-24.

---

## Mục 60 — *"Cổng KHÔNG BAO GIỜ đo `web/` — 124 file nguồn và 28 spec ngoài mọi phép kiểm, và một bản sửa SẢN PHẨM vừa hạ cánh ở đó không có nhân chứng"*

**1. Chuyện gì đang xảy ra.** Cổng kiểm tra tự động của sản phẩm chạy **năm bộ test**, và **không bộ
nào** nằm dưới thư mục giao diện web — **0 trên 5** (đếm 2026-08-24 từ chính danh sách trong script).
Cổng **không gọi** một lệnh nào của `web/`.

🔴 **HAI CON SỐ CỦA MỤC GỐC ĐÃ RÚT — đo lại 2026-08-25, và NÊU TÊN DỤNG CỤ chứ không chỉ con số.**
Dụng cụ là hàm **`web_domain_declaration()`** trong `scripts/verify-suites.sh`: nó **dẫn xuất lúc
chạy**, không dán hằng số, và in ngay dưới dòng kết quả trên **cả hai** nhánh đạt/trượt.

| đại lượng | §60.1 khai | đo hôm nay |
|---|---|---|
| file nguồn dưới `web/src` | **124** | **124** ✅ **không dịch** |
| file spec dưới `web/tests` | **28** | 🔴 **29** |
| sàn chỗ gọi `test(` | **ít nhất 142** | 🔴 **ít nhất 144** |

**Cái làm nó lệch là spec nhân chứng của chính mục 68** (`29-machine-settings-unwired-types.spec.ts`),
thêm vào **cùng ngày 2026-08-24**, sau khi mục 60 được viết. **Một lời khai chưa đầy một ngày tuổi đã
lệch — và nó lệch vì một mục khác trong chính danh sách này.**
📌 🔴 **Một cái bẫy đã bắt một người, ghi ra để nó không bắt người thứ hai:** đếm ngây thơ chuỗi
`test(` **ở bất kỳ đâu trên dòng** cho **145**. Cái thứ 145 là `web/tests/24-connectors.spec.ts:161`
— `/same key|duplicate key/i.test(m)`, một **`RegExp.test()`**, không phải một ca kiểm. **Cổng đếm
`test(` Ở ĐẦU DÒNG; 144 mới đúng.** Vị ngữ *"một SÀN, không phải một tổng"* của mục gốc thì **sống
sót**: chỗ gọi không phải ca kiểm.

**2. Khách hàng / vận hành viên thấy gì.** Khách hàng không thấy gì — cho tới khi một bản sửa giao
diện hỏng. Điều **đã xảy ra**: ngày 2026-08-24 một bản sửa **SẢN PHẨM** hạ cánh vào giao diện web
(bảng vẽ bo mạch, thêm hai từ điển ngôn ngữ). **Cổng chạy sau đó và nói `PASS`.** Nhân chứng duy nhất
của bản sửa ấy là một lệnh build chạy **bằng tay**.
📌 **Nửa "khai ra" đã trả ngày 2026-08-24:** cổng nay in, ngay dưới dòng kết quả và **trên cả hai
nhánh** đạt/trượt, rằng nó **không đo `web/`**, kèm hậu quả và cái giá. Dòng `PASS` cũng mang một
mệnh đề `NOT MEASURED: web/`. Nên hôm nay **không ai còn đọc nhầm khoảng lặng thành phủ sóng.**

**3. Các lựa chọn.**
* **A — Nối đủ `web/` vào cổng** (build + lint + test trình duyệt). Mất, đo chứ không ước: **một hệ
  sinh thái build THỨ HAI** vào một cổng hôm nay **chỉ cần .NET** — Node/npm phải có trên **mọi** máy
  chạy cổng; bộ test trình duyệt đòi **tải một trình duyệt về**; pha test hôm nay đã có **trần 900
  giây MỖI bộ**; và cổng khẳng định những đại lượng **TOÀN MÁY** rồi giữ một **khoá độc quyền** — một
  trình duyệt và một dev server là **hai quần thể tiến trình mới** nằm trong cửa sổ đo ấy.
* **B — Nước đi giữa: chỉ nối build + lint, KHÔNG nối test trình duyệt.** 🔴 **NAY ĐÃ ĐƯỢC ĐỊNH GIÁ**
  (BW-1, 2026-08-24, theo đúng phán quyết của anh *"hoãn A; ĐO B rồi quyết"*) — **đó là một PHÉP ĐO,
  không phải một bản sửa; `web/` KHÔNG được nối vào cổng.** Sáu con số:
  * `npm run build` **7,03 s** + `npm run lint` **0,52 s** ⇒ **≈ 7,6 s = 0,84 %** của **một** trần
    900 giây. **Trần không phải cái đắt.**
  * `npm ci` **16–20 giây**, **67 MB** tải về, **306 MB / 24 653 file** trên đĩa — **một lần trên mỗi
    máy**. Hai đơn vị khác nhau, và mục gốc chỉ nêu đơn vị thứ nhất.
  * **Chúng KHÔNG để lại tiến trình nào** (bộ so khớp của cổng đọc 3 → 3 → 3). 🔴 **Nhưng bộ so khớp
    ấy chỉ nêu `dotnet.exe` và `VBCSCompiler.exe` — `node.exe` KHÔNG nằm trong nó.** Nên con số 0 là
    một phép đo về **hành vi hôm nay của hai lệnh này**, **không** phải một tính chất cổng sẽ cưỡng
    chế.
  * 🔴 **`npm run lint` hôm nay XANH — và nó xanh vì nó chưa hỏi.** Nó in **15 cảnh báo, 0 lỗi**, và
    `oxlint` trần thoát `0` kèm cảnh báo. Siết lại (`--deny-warnings`) ⇒ **`exit 1` NGAY HÔM NAY**.
    ⇒ Nửa lint của hướng B là **một lựa chọn giữa hai thứ**: một dòng xanh **không có định nghĩa đỏ**,
    hoặc **một trần ĐỎ vĩnh viễn** cho tới khi 15 cảnh báo ấy được trả.
  * 🔴 **VÀ ĐÂY LÀ CON SỐ ĐI NGƯỢC HƯỚNG B:** đột biến bằng ca thật — hoàn nguyên **đúng bản sửa** mà
    mục 60 tồn tại vì nó không có nhân chứng — **hướng B vẫn XANH**. Nó bắt được lỗi **KIỂU** (TS2322)
    và **không** bắt được một bản sửa hợp kiểu làm sai hành vi. **Hướng B mua *"mã có biên dịch
    không"*, KHÔNG mua *"màn hình có chạy đúng không"*.**
* **C — ĐỂ NGUYÊN, có tên và có giá.** Việc: không làm gì; lời khai đã có. Mất: **mọi bản sửa trong
  `web/` mãi mãi KHÔNG có nhân chứng trong cổng** — không phải *"ít nhân chứng"*, mà **không có**. Và
  bản sửa web tiếp theo lại phụ thuộc vào việc người thi hành **nhớ** gõ lệnh build và **nhớ** ghi lại
  rằng mình đã gõ.

**4. Nếu không quyết.** Cổng tiếp tục nói `PASS`, nay kèm lời khai. **124** file nguồn và **29** spec
vẫn ở ngoài mọi phép kiểm tự động, và sự thật ấy tiếp tục chỉ sống nếu **có người nhớ viết nó ra**.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Bản trước tôi đề nghị *"hoãn A; đo B rồi
quyết"*; B đã được đo, nên tôi phải nói tiếp — và phép đo làm đề xuất của tôi YẾU ĐI, không mạnh
lên.** B rẻ về thời gian (7,6 s/lần) nhưng nó **không bắt được ca thật đã xảy ra**. ⇒ **Nếu anh chọn
B, hãy chọn nó biết rằng nó mua CHỦ YẾU là một sàn kiểu, không phải một nhân chứng sản phẩm** — và
hãy chốt luôn nửa lint (giữ trần, hay siết và trả 15 cảnh báo). 🔴 **Tôi KHÔNG có phép đo nào nói
hướng A đáng giá hơn** — hai quần thể tiến trình mới trong cửa sổ đo toàn máy vẫn là rủi ro **cho
chính phép đo hiện có**, và không ai định giá rủi ro ấy bằng một con số.

---

## Mục 74 — *"Nón checkout thưa giấu 62 443 file được git theo dõi khỏi ĐĨA trong khi `git status` báo SẠCH"*

**1. Chuyện gì đang xảy ra.** Bản sao mã trên máy này **cố ý** không tải về cả cây. Cây đầy đủ có
**27 thư mục cấp một**; ở thời điểm mục được viết, **26 trong 27** không có mặt đầy đủ trên đĩa. Đếm
lúc ấy: **62 443** file được git theo dõi **vắng mặt trên đĩa**, trên tổng **63 454**; chỉ **1 011**
có mặt. Và **`git status` báo SẠCH — 0 dòng**.
🔴 **Phân biệt quan trọng nhất, mà hai nhiệm vụ trước đã trộn:** *"không có trên đĩa"* **≠** *"không
đo được"*. Nón thưa gỡ file khỏi **ĐĨA**, không khỏi **kho dữ liệu của git**. Các lệnh của git đọc cả
62 443 đường dẫn **hoàn hảo**. Cái mù là **tìm kiếm thông thường trong thư mục và trong trình soạn
thảo**.

**2. Khách hàng / vận hành viên thấy gì.** Khách hàng: **không gì cả.** Nhưng nó đã tốn tiền hai lần
theo cách đo được: câu *"`web/` không có trên đĩa"* làm **một thư mục không được ai mở suốt nhiều
nhiệm vụ** và **giấu một khuyết tật sản phẩm thật**; rồi cổng in `PASS` mà không khai nó không đo
`web/` (mục 60).
📌 **Nửa "khai ra" đã trả ngày 2026-08-24:** dụng cụ quét nay **ĐO** vùng vắng mặt **mỗi lần chạy**
(0,22 giây) và **in nó ngay chỗ mọi kết quả hiện ra**, thay cho một hằng số gõ tay cũ.

**3. Các lựa chọn.**
* **A — Nới hết nón** (tải toàn bộ cây). Được: mọi dụng cụ đọc đĩa thấy cây thật, và một *"không
  thấy"* trở lại nghĩa là *"không có"*. Mất, có con số: **62 443 file / 20,35 GiB** đổ lên đĩa.
* **B — Nước đi giữa.** Thêm `server/`, `client/`, `shared/`, `contracts/`, `drizzle/` mà **không**
  thêm `uploads/`: **2 729 file** thay vì 62 443. 🔴 **ĐÃ ĐƯỢC CHẠY THẬT trên cây này** (BW-1,
  2026-08-24, theo phán quyết của anh) — nhưng **chỉ trên CÂY NÀY**: nón là trạng thái **của một
  worktree** và **không nằm trong commit**, nên bốn worktree khác và mọi bản clone mới vẫn thừa hưởng
  nón cũ. Lệnh đã được ghi vào **README §2** để nó không mất. **Đó là lý do mục vẫn Ở LẠI PHẦN I:
  phán quyết chưa được ship, nó mới được chạy.**
* **C — ĐỂ NGUYÊN, có tên và có giá.** Được: cây nhỏ, checkout nhanh, và dụng cụ **tự khai** vùng nó
  không đọc được. Mất: lời khai ấy **chỉ ràng buộc MỘT dụng cụ**. Không gì ngăn người sau gõ một lệnh
  tìm kiếm thông thường và đọc `0` là *"không có"*.

🔴 **MỘT LỖI ĐƠN VỊ TRONG CHÍNH CÂU BIỆN MINH CHO HƯỚNG B — và nó nằm ở bản TRƯỚC của file này.**
Bản trước viết *"hướng B tốn **4,4 %** giá của hướng A"* và *"`uploads/` một mình đã **94 %** cái
giá"*. Cả hai con số **đúng theo FILE và sai theo BYTE**, và cái nón tiêu là **ĐĨA** — đĩa đo bằng
**byte**:

| | file | % file | byte | % byte |
|---|---|---|---|---|
| **toàn bộ vùng vắng** (hướng A) | 62 443 | 100 % | **20,35 GiB** | 100 % |
| **`uploads/` một mình** | 58 940 | **94,39 %** | **20,22 GiB** | 🔴 **99,36 %** |
| **hướng B, năm thư mục** | **2 729** | **4,37 %** | **65,42 MiB** | 🔴 **0,31 %** |

⇒ **Hướng B tốn 0,31 % giá ĐĨA của hướng A, không phải 4,4 % — sai MƯỜI BỐN LẦN, theo chiều *"đắt
hơn thực tế"*.** Và *"`uploads/` = 94 % cái giá"* là **94 % theo FILE, 99,4 % theo BYTE**. Hai câu ấy
không mâu thuẫn — chúng đo hai thứ, và **chỉ một trong hai là *"giá"***.
📎 **Nói ngược lại cho công bằng:** theo **số mục nhập index** — thứ quyết định thời gian `git status`
và kích thước index — **4,4 % mới là con số đúng**. Cái phải sửa là **chữ *"giá"***, không phải phép
tính. *(Phép sửa này sống trong mục gốc ở §74.6(b); bản trước của file này chép con số mà không chép
đơn vị.)*

**4. Nếu không quyết.** Mỗi nhiệm vụ mới thừa hưởng một cây khuyết, và mỗi nhiệm vụ **tự khám phá
lại** điều đó — hoặc **không**, và viết một câu *"không tồn tại"* dựa trên một tập chưa bao giờ mở
hết.
🔴 **MỘT CON SỐ CỦA BẢN TRƯỚC ĐÃ RÚT Ở ĐÂY:** bản trước viết *"**97 %** thư mục cấp một khuyết"*.
Con số ấy **không có trong mục gốc** — mục gốc viết **26 trên 27**, tức **96,3 %**. Và **sau khi
hướng B chạy trên cây này (BW-1, 2026-08-24), đo lại 2026-08-25: 21 trên 27 = 77,8 %** — sáu thư mục
(`client`, `contracts`, `drizzle`, `examples`, `server`, `shared`) nay có mặt đầy đủ. **Đo bằng
`git ls-tree -d HEAD` giao với phép kiểm tồn tại trên đĩa từng đường dẫn**, không bằng số học trên
câu cũ.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Hướng B — và nay là để SHIP nó, không phải để
chạy nó.** Cơ sở: nó **đã chạy**, và cái nó tránh được (`uploads/`) chiếm **99,4 % giá đĩa**. Cái còn
lại của mục là một câu hỏi hẹp hơn hôm 2026-08-24: *nón này có được ghi thành mặc định cho mọi người
dùng cây không, hay nó ở lại là một thao tác từng-máy trong README?* 🔴 **Tôi KHÔNG có con số nào cho
"hướng B mua được bao nhiêu phần giá trị"** — không ai đo nó, và tôi không bịa một tỉ lệ ra ở đây.

---

## Mục 72 — *"Chỉ SÁU trên mười sáu lá `%ProgramData%\ST4I\sim\` được chuyển hướng CẤU TRÚC; chín lá còn lại dựa vào một quy ước lặp bằng tay"*

**1. Chuyện gì đang xảy ra.** Khi chạy bộ test, mọi kho dữ liệu phải được **trỏ sang thư mục tạm**,
để test không ghi đè lên dữ liệu của một bản cài thật. Có **16 kho** như thế. **Sáu** được trỏ đi
bằng một cơ chế **tự động, áp cho mọi bài test kể cả bài chưa ai viết**. **Mười** thì không.
🔴 **Một lời khai của chính mục không sống sót phép đo thứ hai:** bản viết đầu nói mười lá kia *"không
có seam"*. Đếm lại: **chín trên mười CÓ**, và có ở **20–24 file test mỗi cái**. Khuyết tật không phải
*"không có"* — nó là **HÌNH DẠNG**: chín lá ấy được trỏ đi **theo từng lớp test, bằng tay**. Đó là
**phòng ngừa chọn tham gia**: nó bảo vệ đúng những lớp đã nhớ, và **một lớp mới quên thì rơi thẳng
xuống bản cài THẬT**. **20 lớp nhớ không chứng minh gì về lớp thứ 21.**

🔴 **MỘT LỜI KHAI CỦA BẢN TRƯỚC ĐÃ RÚT, VÀ NÓ SAI THEO CHIỀU *"NHẸ HƠN THỰC TẾ"*.** Bản trước viết
rằng kho chứng chỉ OPC-UA là ca mà *"đúng **MỘT file** đặt nó"*, và hướng B là *"một biến, **một lớp
đang dùng**"*. **Đếm lại 2026-08-24, hai dụng cụ, nêu tên cả hai:**

| dụng cụ | `ST4I_OPCUA_PKI_DIR` |
|---|---|
| số file **NHẮC** chuỗi (đúng dụng cụ bảng gốc dùng) | **1** file, **2** lần nhắc — **và cả hai lần nằm trong MỘT chú thích `///`**, không phải mã chạy |
| số file **ĐẶT** nó (`SetEnvironmentVariable`) | 🔴 **0** |
| số lớp **LÁI** nhánh `env` | 🔴 **0** — ba lớp dựng `OpcUaDriver` đều truyền `pkiDir:` **tường minh ở MỌI chỗ dựng** |

⇒ **KHÔNG file nào ĐẶT nó và KHÔNG lớp nào DÙNG nó.** Con số **1** đúng cho *"nhắc"*; nó **sai cho
tiêu đề cột**. **Và vị ngữ *"không có quần thể nào phải kiểm lại"* thì sống sót và MẠNH HƠN: quần thể
ấy là RỖNG, không phải một.**

**2. Khách hàng / vận hành viên thấy gì.** Khách hàng: **không gì.** Cái bị đe doạ là **máy của người
phát triển hoặc một kiosk demo đang sống**: một bài test giải kho historian **không có thư mục tường
minh** sẽ ghi vào **historian THẬT**, tức vào **bảng sự kiện mà mọi con số OEE đã báo cáo được tính
ra từ đó**.
🔴 **Nói cho đúng mức:** *"seam theo từng lớp"* **KHÔNG** bằng *"đang rò"*. Đo lại 2026-08-24 trên lá
`opcua-pki` thật: **3 file, mtime mới nhất 2026-07-29 15:42:07, mtime thư mục cũng thế** ⇒ **không
quan sát được một lần ghi nào**. Cái đo được là **KHẢ NĂNG**.
Và cái ngoặc canh chúng có hai lỗ của chính nó: nó **mù với một cú rò chỉ chạm dấu thời gian của THƯ
MỤC**, và nó **chỉ chạy bên trong cổng** — một lệnh chạy test thông thường **không có nhân chứng
nào**, mà đó là cách phần lớn người ta chạy test.

**3. Các lựa chọn.**
* 🔴 **B — ĐÃ THI HÀNH ngày 2026-08-24 (BW-1), theo đúng phán quyết của anh (*"hướng B ngay, rồi cân
  nhắc A"*).** Một dòng: `ST4I_OPCUA_PKI_DIR` nay được `tests/Shared/TestRunTempRoot.cs` đặt, cạnh
  sáu biến đang có, trong `[ModuleInitializer]` nối vào **cả năm** assembly. Lá `opcua-pki` lên từ
  **QUY ƯỚC** thành **CẤU TRÚC**. `src/` **không đổi một dòng**. **Giá thật RẺ HƠN mục gốc nêu**:
  `remove-data.ps1` **đã** biết biến ấy, `OpcUaPkiPaths.DefaultRoot()` không đọc nó, ⇒ **không một
  artefact nào phải dịch cùng**. 📎 **Một cái giá mà sáu biến kia không có, nêu ra và cố ý KHÔNG
  assert:** kho chứng chỉ OPC Foundation hỏng khi đường dẫn đầy đủ chạm trần `MAX_PATH` cũ; gốc chạy
  ở đây ước **≈ 175 trên 260 ký tự** trên máy này — **trong trần, có dư, và cái dư ấy là tính chất
  của `%TEMP%` MÁY NÀY, không phải của mã**. Máy có `%TEMP%` sâu là chỗ chờ nó cắn.
* **A — Nâng CHÍN lá còn lại từ QUY ƯỚC lên CẤU TRÚC. 🔴 ĐÂY LÀ CÁI CÒN CHỜ ANH.** Việc: đặt chúng
  vào cùng chỗ với bảy lá đang có, để một lớp mới **không thể quên**. Mất, nói thẳng: mỗi biến cần một
  gốc mặc định mới dưới thư mục tạm, và gốc ấy phải được script gỡ cài đặt và bộ test tài liệu **công
  nhận** — **đúng khuôn mục 30 đã trả với giá mười lăm artefact dịch cùng nhau**; **cộng** việc phải
  kiểm rằng **17–19 file đang tự đặt mỗi biến** vẫn thắng. 🔴 **Đây là chỗ hướng A khác hẳn hướng B:
  B có quần thể phải kiểm lại RỖNG; A có 17–19 file mỗi biến.**
* **C — ĐỂ NGUYÊN chín lá, có tên và có giá.** Mất: chín lá phụ thuộc vào việc **mỗi tác giả test
  tương lai nhớ** lặp lại một quy ước mà **không gì nhắc họ**; cái duy nhất bắt được một lần quên là
  **phát hiện muộn** trong cổng; và vì cái ngoặc mù với dấu thời gian thư mục, **ngay cả "phát hiện
  muộn" cũng không phải một lời hứa đầy đủ**. 🔴 **Hình dạng nguy hiểm không phải hôm nay — nó là bài
  test TIẾP THEO.**

**4. Nếu không quyết.** Không có gì hỏng hôm nay. Rủi ro nằm ở bài test tiếp theo mà chưa ai viết.
📎 Hai khuyết tật của chính dụng cụ (§72.2) **chỉ được sửa ở phần TRÍCH DẪN**: cái ngoặc vẫn mù với
mtime thư mục và vẫn **chỉ chạy trong cổng**.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Chưa trả cả gói A trong một lần.** Cơ sở, lấy
từ chính mục: hướng B đã chứng minh một lá lên được **cấu trúc** với **không một artefact nào phải
dịch cùng** — nhưng nó chứng minh điều đó **trên ca có quần thể RỖNG**. Chín lá kia có **17–19 file
đang tự đặt biến mỗi cái**, nên hướng A mang theo **một phép kiểm lại thật sự**, không phải một thao
tác dọn dẹp. 🔴 **Tôi KHÔNG đề xuất bỏ hẳn A** — chỉ đề xuất chia nó, và tôi **không có phép đo nào**
nói nên chia theo thứ tự nào, vì không ai định giá từng lá.

---

# NHÓM B — Cần một bên thứ hai

Hai mục này **anh không quyết một mình được**, và không phải vì chúng khó. Uỷ quyền phủ được
*"làm hay không làm"*; nó **không phủ được sự đồng ý của bên thứ ba**.

🔴 **Cái đổi từ bản trước, và nó lớn:** anh đã phán nhóm B ngày 2026-08-24 và **cả hai mục ĐÃ BÀN
GIAO** cùng ngày. Nên nhóm này nay **gần như không còn của anh** — trừ **một dòng**, ở mục 69.

---

## Mục 59 — *"HAI MƯƠI TÁM trường một vận hành viên sửa được không có KHE trên đường PUSH, nên khác biệt chỉ xoá được bằng một lần pull cũng vứt luôn bản sửa"*

**1. Chuyện gì đang xảy ra.** Sản phẩm này đồng bộ cấu hình điểm đo với hệ thống trung tâm theo hai
chiều: **kéo về** (pull) và **đẩy lên** (push). Có **28 trường** mà vận hành viên sửa được ở giao
diện nhưng **đường đẩy lên không mang** (đếm lại 2026-08-24, liệt kê đủ 28 tên trong mục gốc).
🔴 **Con số 28 đứng vững; câu chứa nó thì không.** Câu gốc nói *"không có CHỖ trong hợp đồng đồng
bộ"*. Đo: **cả 28 ĐỀU có chỗ — chúng được PULL.** Cái thiếu là **khe trên đường PUSH**. Đọc chặt
theo chữ *"không có chỗ nào cả"* thì con số là **15**, và là một **tập rời hẳn**. 🔴 **Và đơn vị có
ba cách đọc:** đếm ở mức lá thì cùng lỗ hổng ấy là **39**, không phải 28 — vì một trong 28 trường tự
nó có 12 thuộc tính con, mỗi cái sửa riêng được.

**2. Khách hàng / vận hành viên thấy gì.** Vận hành viên sửa một trong 28 trường ở màn hình tại máy.
Một huy hiệu *"lệch so với server"* chuyển màu hổ phách. **Thứ duy nhất từng xoá được huy hiệu ấy là
một lần kéo về — tức chính thao tác vứt bản sửa của họ đi.** Không có đường nào khác. Và **không một
dòng nào trong giao diện nói cho họ biết điều đó.** Trong 28 trường, **27 có ô nhập**; một trường
(`Cells`) thì không, nó chỉ được chuyển tiếp.

**3. Các lựa chọn.**
* **A — Xin server nới hợp đồng, rồi đẩy đủ 28 trường lên.** 🔴 **NỬA ĐẦU ĐÃ LÀM ngày 2026-08-24
  (BV-1), theo phán quyết của anh:** một trang mô tả đã được **BÀN GIAO** cho đội sở hữu `server/`.
  **Bàn giao KHÔNG phải chấp thuận** — mục ở lại Phần I vì nó chờ **sự đồng ý của bên thứ ba**, và ta
  không kiểm soát lịch của họ.
* **B — Đẩy đơn phương** (gửi lên những khoá server chưa khai). 🔴 **MỘT TRONG HAI CÁI GIÁ CỦA HƯỚNG
  NÀY ĐÃ BIẾN MẤT — đo 2026-08-25, và nó là một phép đo về MÃ CỦA BÊN KIA:**
  * **Cái giá BIẾN MẤT.** Bản trước viết *"với một lược đồ kiểm tra kiểu chặt, đó **có thể là hỏng
    validation cho TOÀN BỘ lần push**"*. **Sai.** Lược đồ bên server — `syncMeasurementPoints` và
    `measurementPointSyncSchema` trong `server/routers/machineApiRouters.ts` — là `z.object({…})`
    **KHÔNG có `.strict()`**, và mặc định của zod là **strip**: khoá thừa bị **vứt IM LẶNG**, không
    sinh lỗi. ⇒ **Đẩy đơn phương KHÔNG làm hỏng lần push.** *(Đo qua kho object của git; `server/`
    nay cũng có trên đĩa sau khi hướng B của mục 74 chạy.)* 📎 **Nói cho hết:** vì nó vứt im lặng,
    hướng B **cũng không MUA được gì** ở server hôm nay — 28 trường sẽ được gửi và không được lưu.
    Đó là một sự thật khác với *"nó làm hỏng push"*.
  * **Cái giá CÒN NGUYÊN, và nó là lý do tôi vẫn không tán thành B:** cây này **không thấy được** còn
    **bên đọc nào khác** đang dựa vào hình dạng cũ. 🔴 **Một tập không đếm được KHÔNG phải một tập
    rỗng**, và zod của server này không nói gì về một bên tiêu thụ có kiểu chặt ở chỗ khác.
* **C — ĐỂ NGUYÊN nhưng NÓI THẲNG ở giao diện.** Việc: một dòng cảnh báo cho vận hành viên biết rằng
  28 trường này không đẩy lên được và một lần kéo về sẽ xoá bản sửa. Mất: khuyết tật ở lại; nhưng
  người dùng thôi bị bất ngờ. 🔴 **Mục gốc KHÔNG định giá hướng này** — nếu anh muốn nó, phải đo
  trước.
* **D — ĐỂ NGUYÊN hoàn toàn, có tên và có giá.** Mất: 28 trường tiếp tục sửa được, tiếp tục làm lệch,
  và tiếp tục **chỉ** xoá được bằng thao tác vứt chúng đi — trong im lặng.

**4. Nếu không quyết.** Trạng thái hôm nay đứng yên, và mỗi vận hành viên tự khám phá lại cái bẫy ấy
một lần, bằng công của chính mình.

**5. Đề xuất của tôi.** **KHÔNG ĐỔI so với bản trước, và đây là chỗ tôi nói rõ vì sao một phép bác
KHÔNG lật một đề xuất.** Tôi vẫn **không** đề xuất B. Lý do bản trước đưa ra có **hai vế**; **một vế
đã chết** (nó không làm hỏng push), **vế kia sống nguyên** (tập người đọc khác **không đếm được**), và
vế còn sống **một mình là đủ**. ⇒ **Chỉ MỘT trong HAI cái giá biến mất; đề xuất vẫn đứng.** Việc còn
của anh ở mục này là **theo dõi kênh đã mở**, không phải chọn giữa A và B.

---

## Mục 69 — *"`intentClassifier` gửi BỐN chuỗi không thuộc vựng từ `stepType` vào một mệnh đề `WHERE` — nên mọi câu hỏi mô-men và mọi câu hỏi lượng keo trả về 'không đủ dữ liệu' TRÊN MỘT BẢNG CÓ DỮ LIỆU"*

⚠️ **Mục này mở đầu bằng *"⚖️ ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC"*. Nhãn ấy đã bị chính phép đo trong mục bác
bỏ (§69.5) — mục này là của ANH.** ✅ Dòng đầu nay mang một phép rút tại chỗ, kèm ngày 2026-08-25.

**1. Chuyện gì đang xảy ra.** Trợ lý hỏi-đáp của hệ thống trung tâm dịch câu hỏi của người dùng thành
một truy vấn cơ sở dữ liệu. Nó điền **bốn chuỗi sai** vào bộ lọc *"công đoạn nào"*: nó gửi `"torque"`
và `"dispense"`, trong khi mã công đoạn thật là `screw_tightening` và `glue_dispense`. Bảng công đoạn
được gieo với **tám** mã, và **không mã nào** là hai chuỗi kia. Hệ quả: bộ lọc **không bao giờ khớp
được**, và nó **VÀ** với điều kiện mã máy, nên nó **giết truy vấn kể cả khi người dùng nêu đích danh
máy**.
🔴 **Từ *"mã chết"* là sai theo chiều làm nó nghe vô hại.** Nhánh ấy **LUÔN LUÔN được chọn**.
📎 **Bốn chuỗi nằm ở HAI hàm, không một:** `mapProcessMetric` (`:172`, `:173`) và `mapCorrelationArgs`
(`:180`, `:181`). Hồ sơ cũ nói *"bốn literal"* mà chỉ trỏ vào một hàm.

**2. Khách hàng / vận hành viên thấy gì.** Bề mặt *"hỏi bằng tiếng Việt về dây chuyền của bạn"* trả
lời **"chưa đủ dữ liệu"** cho đúng **hai loại câu hỏi mà sản phẩm này sinh ra nhiều dữ liệu nhất** —
mô-men xoắn và lượng keo. Người dùng kết luận **historian rỗng**, rồi đi kiểm tra đường nạp dữ liệu.
Đó là nhiều giờ ở sai chỗ.

**3. Các lựa chọn.** 🔴 **Cả ba đều nằm ở SẢN PHẨM KHÁC, và đó là nội dung của mục.**
* **A — Chuyển mục sang workstream của `synapse-platform`.** 🔴 **ĐÃ LÀM ngày 2026-08-24 (BV-1)** —
  một trang viết cho **đúng đội sẽ sửa nó** đã đi cùng bộ bàn giao của mục 59, tới **cùng một đội**,
  và **hai hồ sơ độc lập nhau** (nói rõ ngay trong bộ bàn giao, để bên kia không đọc thành *"phải xử
  cái này trước"*). **0 dòng trong `server/` bị sửa.** Mất: ta mất quyền kiểm soát lịch và cách sửa.
* **B — Ta tự sửa `server/`.** 🔴 **CON SỐ CỦA BẢN TRƯỚC ĐÃ RÚT, và nó sai theo chiều *"nhẹ hơn thực
  tế"*.** Bản trước viết *"đổi bốn chuỗi cộng **HAI test**"*. Đo lại: **BA assertion, trong BA khối
  `it()`**, trong `server/services/aiLocalTools/intentClassifier.f6.test.ts`:
  * **`:18`** — `expect(a.stepType).toBe("torque")`
  * **`:28`** — `expect(a.stepType).toBe("dispense")`
  * **`:62`** — `expect(a.upstreamStepType).toBe("torque")`
  Cộng **tên** một bài ở **`:23`** cũng mô tả hành vi sai. 📎 **Và số dòng của bản trước sai:** hồ sơ
  cũ trỏ **`:17`** — dòng ấy là `expect(a.metricKey).toBe("torque")`, một **assertion HỢP LỆ**
  (`metricKey` *"torque"* đúng); dòng phải trỏ là **`:18`**. 🔴 **Chuỗi thứ tư
  (`upstreamStepType: "dispense"`, `:181`) KHÔNG có assertion nào ghim nó** — nên bên kia sửa bốn
  chuỗi sẽ thấy **ba** bài đỏ, không phải hai và không phải bốn.
  Mất, hai lý do **độc lập, mỗi lý do đủ để dừng**: *(i)* uỷ quyền trên sản phẩm NÀY **không cấp
  quyền sửa mã của sản phẩm KHÁC**; *(ii)* cổng của ta **không dựng, không chạy, không nhìn thấy**
  `server/`, nên bản sửa ấy — **kể cả bản sửa đúng** — hạ cánh **không có nhân chứng nào**.
* **C — ĐỂ NGUYÊN, có tên và có giá.** Mất: ba assertion tiếp tục **khẳng định giá trị sai là đúng**,
  nên **bất kỳ ai sửa đúng sẽ thấy CI của bên kia đỏ** và nhiều khả năng lùi lại. Đó là hình dạng tệ
  nhất của một khuyết tật được ghim: **dụng cụ đứng về phía khuyết tật.**

**4. Nếu không quyết.** Trợ lý tiếp tục nói *"chưa đủ dữ liệu"* trên một bảng có dữ liệu, và món nợ
này nằm trên kệ của anh ở một hồ sơ **không đóng được nó**.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Hướng A — đã thi hành. Nên đề xuất còn lại
của tôi là MỘT DÒNG, và tôi nói rõ nó là của ANH chứ không phải của tôi:**

🔴 **ĐẶT MỘT MỐC ĐỌC LẠI.** Mục 69 nay phụ thuộc vào **lịch của một đội khác**, và lịch ấy **không đo
được từ cây này** — không dụng cụ nào ở đây nhìn thấy `server/` thay đổi, và cổng của ta không chạy
CI của họ. Nên hãy chọn **một ngày** (tôi đề nghị **2026-09-08**, hai tuần, nhưng con số ấy là một
gợi ý chứ không phải một phép đo — **chưa đo** bao lâu là hợp lý với đội ấy) và ghi nó vào mục. **Nếu
tới ngày ấy bên kia chưa sửa, mục 69 quay về thành một quyết định CỦA TA** — giữa hướng C (để nguyên,
có tên) và một lần hỏi lại. **Không có mốc thì mục này không phải *"đang chờ"*, nó là *"đang trôi"*,
và một mục đang trôi không có ai chịu trách nhiệm.**

📌 **Một lời đồn cần dập:** *"`server/` không đo được vì nó ngoài nón checkout"* là **SAI**. Nón thưa
gỡ file khỏi **ĐĨA**, không khỏi kho dữ liệu của git — và từ 2026-08-24 (hướng B của mục 74) `server/`
**có cả trên đĩa** trên cây này. Xem mục 74.

---

# NHÓM D — Một sự thật, hai bề mặt trả lời khác nhau

Ba mục này chia **một cái giá duy nhất**: sửa cho đúng là **dời một giá trị đã đi ra ngoài sản
phẩm** — đã lên MQTT, đã vào lịch sử kiểm toán, hoặc đã nằm trong một payload mà bên ngoài soi gương
từng trường.

🔴 **Anh đã chốt MỘT CHÍNH SÁCH cho nhóm này ngày 2026-08-24 — *"giữ và xuất bản"* — và nó nay sống ở
MỘT CHỖ trong mục gốc, được trỏ về từ từng mục.** Mỗi mục dưới đây vẫn cần một chữ *"có/không"*
riêng, nhưng chính sách đã có, nên ba chữ ấy viết nhanh.

---

## Mục 65 — *"`RegistrationKeyOf` trả `entry.Kind` cho TCP/OPC-UA — MỘT FILE cho HAI CÂU TRẢ LỜI trên hai host"*

**1. Chuyện gì đang xảy ra.** Vận hành viên khai hai kết nối Modbus-TCP trong **cùng một file cấu
hình**, đặt cho chúng **hai mã riêng** do chính họ nghĩ ra. Dưới một host, hệ thống quy cả hai về
**cùng một khoá** (theo *loại*, không theo *mã*) nên **mục thứ hai bị bỏ**. Dưới host kia, cùng file
ấy cho **hai** kết nối.
🔴 **Lời khai gốc bị bác ở CHỦ THỂ, và khuyết tật thì CÓ THẬT.** Lời khai nêu tên **sai file, sai
assembly, sai host**; đặc tả thì đúng. Mục đã mở ở đúng chỗ và ghi phép bác ngay tại đó.

**2. Khách hàng / vận hành viên thấy gì.** Họ đặt **hai mã** và nhận **một** kết nối trên host này,
**hai** trên host kia — kèm một cảnh báo **nói về "loại"** trong khi họ **đang nghĩ về "mã"**. Mục
gốc gọi đó là loài sai lệch **tốn nhiều giờ nhất**: nó **không hỏng, nó hỏng khác nhau ở hai chỗ**.

**3. Các lựa chọn.**
* 🔴 **C — ĐÃ THI HÀNH ngày 2026-08-24 (BX-1), định giá rồi mới viết.** Chỉ sửa **CÂU CẢNH BÁO**,
  không đổi hành vi: nói đúng mã người dùng vừa đặt, và nói rằng host này gộp theo loại còn host kia
  thì không. 📎 **Và câu cảnh báo cũ đo được là SAI trên CẢ HAI HOST, theo HAI CHIỀU NGƯỢC NHAU** —
  chi tiết ở §65.6. **Mất: phân kỳ vẫn còn**; ta chỉ mua được việc người dùng hiểu chuyện gì vừa xảy
  ra.
* **A — Cho host còn lại nhận mã do người dùng đặt** (hai host trả lời giống nhau, và giống theo
  hướng vận hành viên mong đợi). 🔴 **ĐÂY LÀ CÁI CÒN CHỜ ANH.** Mất: nó **dời nhãn khe của một bản
  cài ĐÃ TỒN TẠI**, và qua đó dời **mã đích của cảnh báo** — trường ấy **đi ra ngoài** qua webhook và
  **đã được lưu** trong các hàng kiểm toán. Nên **lịch sử đã lưu sẽ không khớp với hiện tại**. Không
  đổi hình dạng dây; đổi **giá trị** của một khoá mà bên thứ ba có thể đang dùng để tra.
* **B — Cho host kia gộp lại như host này** (cũng giống nhau, theo hướng ngược lại). Mất: **âm thầm
  vứt một kết nối vận hành viên đã khai** — tệ hơn A về mặt người dùng.
* **D — ĐỂ NGUYÊN, có tên và có giá.** Mất: hai host tiếp tục cho hai câu trả lời trên cùng một file,
  **mỗi bên có một test ghim câu trả lời của mình** — nên **không dụng cụ nào sẽ bao giờ đỏ**, và
  phân kỳ này chỉ lộ ra khi một người **chạy cả hai host rồi so**.

**4. Nếu không quyết.** Trạng thái D, cộng câu cảnh báo đã sửa. Hai bài test ở hai bên tiếp tục **bảo
vệ hai câu trả lời trái ngược nhau** như thể cả hai đều đúng.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Bản trước tôi đề nghị *"C trước, rồi cân nhắc
A"*. C đã trả. Về A, tôi vẫn KHÔNG có đề xuất** — hướng A đúng về ngữ nghĩa nhưng nó **dời một khoá
đã nằm trong lịch sử kiểm toán**, và đó chính là loại giá anh nên trả **có chủ đích**, không trả kèm.
Chính sách *"giữ và xuất bản"* anh vừa chốt **nghiêng về D**, và tôi không có phép đo nào phản đối.
🔴 **Một cảnh báo về chính mục này, nguyên văn của nó:** *"nhãn này là cái tôi ít chắc nhất"* — tác
giả mục **tự khai** rằng việc xếp mục 65 vào loại *"chạm hình dạng dây"* là **giải theo chiều thận
trọng**, và **cho phép anh lật lại**. 📎 Cũng trong câu ấy có chữ *"mười bốn mục"*; hôm nay kệ của anh
có **CHÍN**. Con số ấy **đã cũ hai lần** — nó cũ khi bản trước của file này gọi nó là *"mười sáu"*, và
nó vẫn cũ hôm nay.

---

## Mục 70 — *"`GET /v1/machines/{code}` ship BỐN con số mô-men cho MỘT chu kỳ mà payload ingest, chuỗi SPC và historian đều báo MỘT"*

**1. Chuyện gì đang xảy ra.** Một lần gọi lấy chi tiết máy trả về **bốn** con số mô-men cho **một**
chu kỳ. Ba trong bốn là **những lần rút NGẪU NHIÊN ĐỘC LẬP MỚI** — chúng **không** vào biểu đồ,
**không** vào payload nạp dữ liệu, **không** vào historian, **không** lên MQTT. Chúng chỉ tồn tại
trên đúng một bề mặt.
🔴 **Hai lời khai của mục cần đọc lại.** *(i)* Câu *"hai con số cho một mô-men"* **đúng theo chữ**,
nhưng độ lệch giữa hai con số ấy **chỉ là phép làm tròn ba chữ số**, tức **≤ 0,0005 N·m** — đặt cạnh
mục 41 (12,0 → 1,35) nó **mời người đọc hiểu thành một phân kỳ thực chất**, và nó không phải thế.
*(ii)* Cái **đáng kể hơn nhiều** là ba con số kia, và lời khai gốc **nêu quá dè dặt**.

**2. Khách hàng / vận hành viên thấy gì.** Hai bề mặt của **cùng một sản phẩm** báo **số lượng phép
đo khác nhau** cho cùng một chu kỳ. Ai đối chiếu bảng máy với historian sẽ thấy lệch, và **không có
gì trong sản phẩm giải thích**. Chẩn đoán tự nhiên là *"historian mất dữ liệu"*, và nó **sai**.
🔴 **Và ba con số ấy ĐANG QUYẾT PHÁN QUYẾT**: nếu bất kỳ bước nào trong chúng ra "không đạt" thì cả
chu kỳ bị đánh trượt. Nên một cuộc điều tra chất lượng dựa trên historian **về nguyên tắc không tái
lập được** phán quyết mà máy đã đưa ra.

**3. Các lựa chọn.** 🔴 **Ba bờ này có giá KHÁC NHAU MỘT BẬC, và lời khai gốc gộp chúng làm một.**
* 🔴 **A — ĐÃ THI HÀNH ngày 2026-08-24 (BX-1), theo phán quyết của anh: bỏ phép làm tròn** (hai con
  số thành một). **Và người thi hành nói thẳng cái A KHÔNG mua được:** nó **không xoá được phân kỳ mà
  mục này mở ra để nói về** — nó chỉ xoá một chênh lệch 0,0005 N·m. Không chạm phán quyết, không chạm
  OEE.
* **B — Xoá ba lần rút thêm. 🔴 VẪN CHỜ ANH.** Việc: bỏ chúng khỏi kế hoạch chu kỳ. Mất: chúng đang
  quyết phán quyết, nên xoá là **hạ tỉ lệ trượt** và qua đó **dịch chỉ số Chất lượng của OEE** —
  **miễn trừ thứ ba, và chỉ anh quyết được**.
* **C — Giữ ba lần rút NHƯNG lưu chúng lại** (cho vào historian / payload nạp), để phán quyết tái lập
  được. **VẪN CHỜ ANH.** Mất: 🔴 **mục gốc KHÔNG nêu và KHÔNG định giá hướng này** — nó nới một payload
  đã công bố, nên gần như chắc chắn chạm miễn trừ hình dạng dây. Nếu anh muốn nó, phải đo trước.
* **D — ĐỂ NGUYÊN phần còn lại, có tên và có giá.** Mất: endpoint tiếp tục là bề mặt **duy nhất**
  phơi ba con số quyết định phán quyết mà **không bề mặt nào khác lưu lại**. Cái đã trả (A) **không
  đụng vào chỗ đó**.

**4. Nếu không quyết.** Trạng thái D. Sự lệch giữa bảng máy và historian tiếp tục **trông giống một
lỗi mất dữ liệu**, và tiếp tục dẫn người điều tra đi sai hướng.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Bản trước tôi đề nghị *"tách A ra khỏi B/C và
quyết riêng"*; anh đã làm đúng thế và A đã trả.** 🔴 **Về B và C tôi VẪN KHÔNG có đề xuất** — B dịch
một con số OEE đã báo cáo, C nới một hợp đồng đã công bố, và cây này **không đếm được** ai đang dựa
vào bên nào. **Một tập không đếm được không phải một tập rỗng.** Chính sách *"giữ và xuất bản"* anh
vừa chốt nghiêng về **D**, và nếu anh chọn D thì hãy chọn nó **có chữ ký** — hôm nay D đang là mặc
định **do quán tính**.

---

## Mục 49 — *"Hai vựng từ machine-type không phải một danh sách, và một loại máy không nhận ra âm thầm thành máy bắt vít rồi GHI một bản ghi cấu hình"*

⚠️ **Mục này mở đầu bằng *"⚖️ ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC"*. Nhãn ấy đã bị chính phép đo trong mục bác
bỏ (§49.5) — mục này là của ANH.** ✅ Dòng đầu nay mang một phép rút tại chỗ, kèm ngày 2026-08-25.

**1. Chuyện gì đang xảy ra.** Có **hai danh sách loại máy** trong sản phẩm, được bảo trì **riêng rẽ**,
và chúng đã trôi xa nhau. Hệ quả nặng nhất: khi gặp một loại máy **không nhận ra**, hệ thống **âm
thầm dựng một máy bắt vít** — và nếu có kho cấu hình thì nó **GHI một bản ghi chương trình vặn vít
xuống đĩa dưới mã của chính máy lạ ấy**, trong khi API cấu hình **từ chối phục vụ** đúng máy đó.

**2. Khách hàng / vận hành viên thấy gì.** Một **lỗi chính tả** trong file đội hình sinh ra **một máy
bắt vít giả cộng một file cấu hình rác** trên đĩa khách.

**3. Các lựa chọn.** Mục có **ba nửa**, giá rất khác nhau:
* 🔴 **C — ĐÃ THI HÀNH ngày 2026-08-24 (BX-1), theo phán quyết của anh.** Đúng một dòng dữ liệu:
  `["AOI_AVI"] = AoiInspection`. Ba miễn trừ kiểm **trước** bản sửa và **đo chứ không suy**: không
  bộ mô phỏng nào đổi, không trường nào thêm/bớt, không con số OEE nào dịch. Cái đổi là **đúng một**:
  `GET /v1/machines/{code}/settings` trả **200 thay vì 400** cho máy `AOI_AVI`. Nhân chứng **đỏ được**
  và đã chạy cặp đối chứng.
* **A — Sửa nhánh dự phòng** (đừng dựng máy bắt vít cho loại lạ). 🔴 **VẪN CHỜ ANH, VÀ NÓ VẪN BỊ KHOÁ
  SAU MỤC 41 — GIẢ THUYẾT NGƯỢC LẠI ĐÃ ĐƯỢC ĐO VÀ BỊ BÁC.** Có người cho rằng mục 41 đóng (roster nay
  khai `screwTorque`) đã mở khoá hướng A. **Đo ở `2efca2fd`: KHÔNG.** `fleet.json` khai `screwTorque`
  ở **SCRW-01** và **SCRW-02**, và **chỉ hai máy ấy**. Trong **BẢY** máy `automation` rơi vào nhánh dự
  phòng nếu loại của chúng không nhận ra, **HAI** được cứu và **NĂM** thì không — và với năm máy ấy,
  bỏ kho cấu hình khỏi nhánh vẫn dịch mô-men **12,0 / 1,35 = 8,89 lần**, đúng con số mục 41 mở ra để
  nói về. 🔴 **Chiều nghịch phải nói luôn:** một descriptor **soạn tay hoặc từ file** — đúng tập
  **không liệt kê được trên đĩa khách hàng** — gần như chắc chắn **không** khai `screwTorque`, nên nó
  nằm trong **năm** chứ không nằm trong hai. **Việc roster khai `screwTorque` THU HẸP quần thể bị ảnh
  hưởng chứ KHÔNG XOÁ nó.**
* **B — Đưa `IOT_GATEWAY` vào danh sách nhà máy. VẪN CHỜ ANH, không đo lại, không đụng.** Mất: một
  descriptor như thế hôm nay là máy bắt vít và sau bản sửa là cảm biến IoT — **khác metric, khác đơn
  vị, khác phán quyết**, tức **payload MQTT của máy ấy đổi hoàn toàn**. Tập bị ảnh hưởng vẫn **không
  đếm được trên đĩa khách hàng**. 🔴 **Một tập không đếm được không phải một tập rỗng.**
* **D — ĐỂ NGUYÊN A và B, có tên và có giá.** Được: nhánh dự phòng ấy chính là lý do một file đội
  hình hỏng **không làm sập kiosk triển lãm** — một tính chất **có chủ ý**. Mất: hai danh sách tiếp
  tục trôi xa nhau và **không dụng cụ nào so chúng** *(nửa C thu hẹp chỗ này một chút: bảng theory của
  `UnconsumedConfigKindsTests` nay hỏi được về `AOI_AVI`, nhưng nó vẫn không so hai danh sách)*.

**4. Nếu không quyết.** Hai danh sách trôi tiếp; và mục này **bị khoá sau mục 41** ở hai phần ba —
**kể cả sau khi mục 41 đã đóng**, vì cái khoá không phải trạng thái của mục 41 mà là **con số mô-men
nó mở ra để nói về**, và con số ấy vẫn dịch trên năm trong bảy máy.

**5. Đề xuất của tôi (ĐỀ XUẤT, không phải phép đo).** **Bản trước tôi đề nghị tách nửa C ra làm ngay;
anh đã chốt đúng thế và C đã trả — chỗ tôi bất đồng với mục gốc, anh đã phân xử.** 🔴 **Về A và B tôi
KHÔNG có đề xuất.** A quyết mục 41 bằng cửa sau trên năm trong bảy máy; B đổi payload MQTT trên một
tập không đếm được. Cả hai là **miễn trừ**, và **ba miễn trừ đứng nguyên** — chỗ anh mở ngày
2026-08-24 chỉ cho **nhóm A**, và không được nới sang đây.

---

# NHÓM A — "Con số nào đúng?"

Nhóm này từng có bốn mục; **41, 43 và 61 đã được anh phán và đã thi hành** ngày 2026-08-24. **Còn
một.**

🔴 **Và mục còn lại KHÔNG còn nguyên hình dạng nhóm A.** Câu hỏi *"con số nào đúng"* của mục 71 —
*một welder công nghiệp phơi gì* — **anh đã trả lời rồi**. Hai câu còn lại **khác loài**: một là câu
hỏi **GIÁ** chạm miễn trừ (b), một là câu hỏi **THIẾT KẾ không có trọng tài**. Tôi nói ra chứ không
ép nó vào một cái nhãn đã hết vừa.

---

## Mục 71 — *"Doc thiết kế và mã bất đồng ở BỐN trên NĂM hàng tham số — và cái được ghi lại là hàng ÍT nguy hiểm nhất trong bốn"*

⚠️ **Mục này mở đầu bằng *"⚖️ ĐIỀU PHỐI VIÊN QUYẾT ĐƯỢC"* cho bờ tài liệu — bờ ấy ĐÃ TRẢ XONG. Bờ còn
lại chạm miễn trừ (b) và mục đã sang kệ của ANH ngày 2026-08-24.** ✅ Dòng đầu nay mang một phép rút
tại chỗ, kèm ngày 2026-08-25.

**1. Chuyện gì đang xảy ra.** Tài liệu thiết kế cấu hình máy có một bảng liệt kê **tham số của từng
loại máy**. Bảng ấy và mã **nói khác nhau**. 🔴 **Con số ở tiêu đề không sống sót:** đo lại, chỉ **HAI
trên năm hàng** là doc sai (DISPENSING và WELDER); ba hàng còn lại lệch vì **cùng một lý do kỹ thuật
duy nhất** — lược đồ tham số chỉ nhận **một con số có dải cứng**, mà mảng / bảng tra / chính sách
không phải hình dạng ấy. Con số *"bốn"* thật ra đếm **hàng chưa ai ghi lý do**, không đếm hàng lệch.
✅ **Phép rút ấy nay sống ngay dưới tiêu đề**, không chỉ ở §71.5.3 — vì tiêu đề là thứ đi vào bảng
phán quyết và vào kệ của anh.

**2. Khách hàng / vận hành viên thấy gì.** Một người tích hợp bên ngoài đọc tài liệu thiết kế
**trước** khi đọc mã. Với máy hàn, tài liệu từng dạy họ gửi *"lực ép"* và *"tiền/hậu nhiệt"*; mã đòi
`tempMax` và `voltage`. **Hai hàng ấy đã được sửa** ngày 2026-08-24, và **phán quyết của anh cùng
ngày đã cho chúng một trọng tài** — hàng WELDER nay **là câu trả lời**, không còn là một bên của một
câu hỏi mở.
📌 Và một sự thật làm mọi thứ khó hơn: **không bộ mô phỏng nào ĐỌC khoá `weld_profile` cả.** Nên
không có phép đo vật lý nào phân xử được ai đúng — đó là lý do câu ấy cần **anh**.

**3. Các lựa chọn — HAI CÂU CÒN LẠI, và chúng KHÁC LOÀI NHAU.**
* 🔴 **Câu (i) — có nới `MachineParameterSchema` sang tham số KHÔNG VÔ HƯỚNG không?** (mảng
  `sequence[]`, bảng tra `thresholds{}`). Đây là một câu hỏi **GIÁ**: §71.6 đo bằng **byte-identity**
  rằng nó **chạm miễn trừ (b) — hình dạng dữ liệu trên dây**, và hỏng ở **ba chỗ, mỗi chỗ đủ một
  mình**: mảng tham số trên dây **dài thêm một phần tử trên MỌI máy**; một mã kiểm tra đã công bố
  **dịch KHÔNG ĐỀU** (đổi cho máy gặp lần đầu sau bản sửa, **không** đổi cho máy đã có trên đĩa); và
  **kiểu phần tử của phản hồi phải đổi**, tức đổi **cấu trúc** một phản hồi đã công bố. 🔴 **Miễn trừ
  (b) KHÔNG nằm trong chỗ anh mở ngày 2026-08-24** — anh mở (a) qua mục 61 và (c) qua mục 43.
* 🔴 **Câu (ii) — `retestPolicy` của máy AOI có nên tồn tại không?** Đây là câu hỏi **THIẾT KẾ, và nó
  KHÔNG CÓ TRỌNG TÀI**: hợp đồng recipe của server **không có** loại `aoi_inspection`, nên **không có
  bản khai server nào để đúng hay sai với** — tài liệu **tự phát minh** vựng từ ấy. Xoá nó khỏi doc
  sẽ là **quyết một câu hỏi thiết kế bằng một phép xoá**.
* **ĐỂ NGUYÊN cả hai, có tên và có giá.** Việc: không làm gì thêm; bảng đã đúng cho hai hàng, và ba
  hàng còn lại **có ghi lý do tại chỗ**. Mất: người tích hợp tiếp theo vẫn phải **tự đoán** về
  `retestPolicy`; và `MachineParameterSchema` tiếp tục **không diễn tả được** ba hình dạng mà server
  thật sự nhận, nên C# hẹp hơn hợp đồng bên kia **trong im lặng**.
📎 **Một chỗ đã DỪNG có chủ ý, ghi ra để nó không đọc thành bỏ sót:** làm đúng chữ *"sửa tài liệu cho
khớp mã"* ở **ba hàng còn lại** nghĩa là xoá `sequence[]` / `thresholds{}` / `retestPolicy` khỏi bảng
— và đo lại từ kho object của git cho thấy **doc ĐÚNG, server ĐÚNG, C# mới là chỗ hẹp** ở hai hàng
đầu. Nên **thi hành hướng A ở đó sẽ viết một tài liệu MÂU THUẪN VỚI HỢP ĐỒNG CỦA SERVER**. Ba hàng
**DỪNG**, và lý do là một phép đo, không phải một sự dè dặt.

**4. Nếu không quyết.** Tài liệu và mã đứng yên ở trạng thái hôm nay. Khuyết tật thật mà mục gốc nêu
tên **đã được trả một phần**: bảng ấy **CHƯA TỪNG CÓ một phép kiểm nào**, nay **có** —
`MachineConfigDesignDocTableTests`, đối chiếu **hai chiều**. Nhưng nó **tự khai** rằng nó **không đọc
`recipeSchemas.ts`**, **không đọc hàng viết bằng văn xuôi**, và **không nói gì về việc một tham số có
ĐÚNG hay không**. ⇒ Phép đo ở câu (i)/(ii) **vẫn phải chạy bằng tay**, vì cây này **không có dụng cụ
nào suy lại được nó**.

**5. Đề xuất của tôi.** 🔴 **KHÔNG CÓ — cho cả hai câu, và vì hai lý do khác nhau.**
Với câu **(i)**, tôi có một phép đo (nó chạm miễn trừ b, ba chỗ) nhưng **không có phép đo nào nói cái
nó mua đáng bao nhiêu** — không ai đếm được người tích hợp nào đang gặp chỗ hẹp ấy. Với câu **(ii)**,
đó là một sự thật về **thiết bị công nghiệp và về sản phẩm anh muốn bán**, không phải về mã này; **không
sim nào đọc khoá ấy** nên **không phép đo vật lý nào phân xử**. **Thà không có đề xuất còn hơn một đề
xuất không có cơ sở.**
📎 **Một mâu thuẫn nội tại CHƯA ĐƯỢC SỬA, nêu tên chứ không lấp:** §71.1 nói *"HAI hàng chưa ai ghi"*
trong khi **bảng ngay dưới nó đánh dấu BA hàng `chưa`**. §71.5.3 nêu tên nó và cố ý không tự sửa;
nhiệm vụ này cũng không. **Đọc theo tên, đừng đọc theo số.**

---

## 🔎 CHỖ TÔI KHÔNG GIẢI THÍCH ĐƯỢC, VÀ VÌ SAO

Đây là danh sách những chỗ **mục gốc không đủ rõ hoặc tự mâu thuẫn**, nên tôi diễn giải theo tên chứ
không theo con số, hoặc phải nói rằng chỗ ấy **đang tranh chấp**:

1. **Mục 71 — §71.1 nói *"HAI hàng chưa ai ghi"* trong khi bảng ngay dưới nó đánh dấu BA hàng
   *"chưa"*.** Một mục một ngày tuổi tự mâu thuẫn với bảng của chính nó, và **chưa ai sửa**.
2. **Mục 65 — tác giả mục tự khai đây là nhãn *"ít chắc nhất"* của mình** và mời anh lật lại. Nên
   việc mục 65 nằm ở nhóm nào là **một lời khai, không phải một phép đo**.
3. **Mục 41 (đã đóng) — §41.4 vẫn liệt kê *"bảy bề mặt đọc"* và vẫn nêu tên
   `server/routers/processResultAnalytics.ts`, một file KHÔNG TỒN TẠI.** ✅ **Nay có phép rút đặt ở
   ĐẦU §41.4**, chứ không chỉ ở khối đính chính nằm dưới §41.8 mà người đọc §41.4 không bao giờ tới.
   Đo lại 2026-08-25 bằng `git ls-files server/routers/`: đường dẫn duy nhất khớp là
   **`processResultAnalytics.test.ts`**, một file test; bản thi hành là **`processResultRouter.ts`**.
4. **Các con số đo ở ngày cũ vẫn nằm trong thân mục.** Ví dụ mục 41 §41.8 nói *"tổng 2852 không được
   dịch"*; tổng bộ test hôm nay là **2976**. Chúng **đúng vào ngày được viết** và file này **không
   sửa chúng** — nhưng chúng đọc như hiện tại.
5. **Mục 60 và mục 68 làm lệch số của nhau, TRONG CÙNG MỘT NGÀY.** ✅ **Nay đã được ghi ở CẢ HAI
   ĐẦU** (§60.1 và §68.4), mỗi đầu nêu **TÊN DỤNG CỤ** — `web_domain_declaration()` trong
   `verify-suites.sh`, dẫn xuất lúc chạy — chứ không chỉ con số.
6. 🔴 **Mục 62 — người thi hành đã viết *"phán quyết B áp cho cả hai"* về một quần thể anh chưa từng
   được hỏi.** Xem *"BA VIỆC QUAY LẠI BÀN"* ở đầu file. **Đây là chỗ tôi phải nói ra thay vì để nó
   đọc như đã kiểm xong.**
7. 🔴 **Mục 69 — không dụng cụ nào ở cây này đo được lịch của đội bên kia.** Đó là lý do mục ấy cần
   **một mốc đọc lại do anh đặt**, và là chỗ duy nhất trong file này tôi đề nghị anh **thêm** một thứ
   thay vì **quyết** một thứ.

---

## 📌 NHỮNG CÂU CỦA BẢN TRƯỚC KHÔNG SỐNG SÓT — rút ở đây, giữ nguyên văn, vì chúng là văn ĐÃ ĐƯA CHO ANH ĐỂ QUYẾT

Bản trước của file này **đã được dùng để phán cả sáu nhóm**. Nên một câu sai trong nó không phải một
lỗi soạn thảo — nó là **một cơ sở phán quyết**. Sáu câu dưới đây được **rút**, không xoá:

| câu của bản trước, nguyên văn | đo lại | mục |
|---|---|---|
| 🔴 *"**A** — Dùng dải một phía (**chỉ có mép trên, không có mép dưới**), như máy kiểm rò vừa được sửa."* | **SAI.** Làm đúng chữ ấy: `Evaluate(score, lsl: null, usl: 100)` ⇒ margin **15 điểm** ⇒ mọi điểm ≥ 85 là `Warn` ⇒ **~100 % Warn**, tệ hơn 41 % đang có — **và điểm HOÀN HẢO VẪN trả `Warn`**, tức nó **không sửa được khuyết tật nó tồn tại để sửa**. Phép loại suy đúng là theo **VAI TRÒ**, không theo **PHÍA**: 100 là **TRẦN THANG ĐO**, 90 là **giới hạn spec** ⇒ bỏ **USL**, giữ **LSL**. | **61** *(đã đóng — câu vẫn phải rút)* |
| *"hướng B tốn **4,4 %** giá của hướng A"* | Đúng theo **FILE**; theo **BYTE** là **0,31 %** — **sai 14 lần**, chiều *"đắt hơn thực tế"*. | **74** |
| *"`uploads/` một mình đã **94 %** cái giá"* | **94 % theo FILE, 99,4 % theo BYTE.** | **74** |
| *"**97 %** thư mục cấp một khuyết"* | Mục gốc viết **26/27 = 96,3 %**; con số 97 % **không có trong mục gốc**. Và **sau BW-1: 21/27 = 77,8 %**. | **74** |
| *"đúng **MỘT file** đặt nó"* / *"một biến, **một lớp đang dùng**"* | **KHÔNG file nào ĐẶT nó (0) và KHÔNG lớp nào DÙNG nó (0).** Con số 1 đếm *"nhắc"*, và cả hai lần nhắc nằm trong **một chú thích**. | **72** |
| *"đổi bốn chuỗi cộng **HAI test**"* · *"`:17`"* | **BA assertion** trong **ba** khối `it()`; dòng đúng là **`:18`** (`:17` là `metricKey`, hợp lệ); chuỗi thứ tư **không có assertion nào ghim**. | **69** |
| *"với một lược đồ kiểm tra kiểu chặt, đó **có thể là hỏng validation cho TOÀN BỘ lần push**"* | **SAI.** Lược đồ bên server là `z.object` **không `.strict()`**; zod **vứt im lặng** khoá thừa. 🔴 **Nhưng đề xuất vẫn đứng** — vế thứ hai (**tập người đọc khác không đếm được**) **không đổi**, và một mình nó là đủ. **Chỉ MỘT trong HAI cái giá biến mất.** | **59** |
| *"hôm nay kệ của anh có **mười sáu**"* | **CHÍN**, đo bằng `check-owner-decisions.sh`. | **65** |

🔴 **Và một câu của bản trước ĐÃ ĐƯỢC TRẢ, ghi ra vì nó là chiều ngược lại:** *"năm mục nói với anh
rằng chúng không phải của anh"*. Nay là **ba** (49, 69, 71), và **cả ba đã được rút tại chỗ trong
mục gốc**, kèm ngày. Đọc dòng đầu của chín mục hôm nay: **không mục nào còn nói sai kệ.**

---

📌 **Còn một mục nữa trong Phần I, và nó KHÔNG chờ anh: mục 73** (*"`C2` không phân biệt một dấu
trạng thái LỊCH SỬ với một dấu ĐANG SỐNG"*) — nó là khuyết tật của **dụng cụ**, đứng ở kệ
**chờ-điều-phối-viên**, và anh **không cần đọc nó** để chốt chín mục trên. Ghi ở đây để danh sách
không có lỗ.

📌 **Hai trường máy đọc trong `owner-decisions.md` là nguồn của phép chia ấy**, và cổng kiểm chúng mỗi
lần chạy: `gate:phần-i-chờ-chủ-sở-hữu = 49 59 60 65 69 70 71 72 74` · `gate:phần-i-chờ-điều-phối-viên
= 73`. **Hợp của hai trường = quần thể Phần I; giao = rỗng.** Nếu file này và hai trường ấy nói khác
nhau, **hai trường ấy đúng**.
