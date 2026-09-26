# Phiếu điền 7 ô trống — ba thẻ vận hành ưu tiên

> **Cách dùng:** trả lời thẳng dưới mỗi câu hỏi, ngay trong file này. Không cần định dạng, không cần đầy đủ câu.
> Viết xong báo lại, tôi sẽ đưa vào ba thẻ (`andon.md`, `alerts.md`, `production-orders.md`), nhúng lại vector,
> rồi **đo lại** xem trợ lý có trả lời được các câu này không — trước khi bỏ công cho 70 ô còn lại.
>
> **Không biết thì ghi "chưa có quy định".** Đó là một câu trả lời hợp lệ và hữu ích: trợ lý sẽ nói đúng như vậy
> thay vì suy đoán. Trống mà thành thật vẫn tốt hơn đầy mà bịa — đó là nguyên tắc của cả đợt rà soát này.

---

## A. Bảng Andon — `/andon`

Những gì đã có sẵn trong thẻ (rút từ mã, không cần bạn xác nhận): vòng đời ba nhịp
`raise` → `acknowledge` → `resolve`; bảng TV lọc theo `active` nên mục mới `acknowledge` **vẫn còn hiện**;
màn hình dùng quyền `dashboard_view` nên tài khoản chỉ-xem không bấm nhận được.

### A1. Kênh báo động thực tế (đèn / còi / điện thoại) có nối vào Andon của hệ thống không?

*Vì sao hỏi: người vận hành bấm Andon trên phần mềm rồi đứng chờ. Nếu đèn/còi là một hệ riêng không nối,*
*trợ lý phải nói ra điều đó thay vì để họ tưởng đã gọi được người.*

> **Trả lời:**
> CÓ nối hệ thống thông qua thiết bị IoT hoặc mạch điện tử gửi tín hiệu thật về
>

### A2. Thời gian phản hồi cam kết cho mỗi loại Andon tại nhà máy này là bao lâu?

*Vì sao hỏi: đây là con số để trả lời câu "gọi bao lâu rồi mà chưa ai tới thì có bất thường không".*
*Nếu mỗi loại một mức (chất lượng / thiết bị / vật tư), ghi rõ từng loại.*

> **Trả lời:**
> 1 phút là thời gian thông thường, nhanh nhất là 30s, cho phép điều chỉnh và cài đặt
>

### A3. Ai xác nhận cuối cùng rằng sự cố đã được khắc phục thật?

*Vì sao hỏi: nhịp `resolve` trong hệ thống chỉ là một lượt bấm. Câu hỏi là ngoài đời ai được phép bấm nó,*
*và có cần ai đó kiểm chứng trước không.*

> **Trả lời:**
> Người báo cáo xác nhận
>

---

## B. Cảnh báo & ngưỡng — `/alerts`

### B1. Ai có quyền chỉnh ngưỡng cảnh báo, và cần duyệt của ai?

*Vì sao hỏi: hệ thống có tool `adjust_ng_threshold` và `request_threshold_review`. Phần mềm biết ai bấm được,*
*nhưng không biết quy trình duyệt của nhà máy. Nếu có mức khác nhau (đổi tạm vs đổi vĩnh viễn), ghi rõ.*

> **Trả lời:**
> quản lý và kỹ sư
>

### B2. Sau khi chỉnh ngưỡng, theo dõi bao lâu thì coi là đã ổn định?

*Vì sao hỏi: để trợ lý trả lời được "đổi ngưỡng xong rồi, khi nào thì biết là đúng".*
*Ví dụ dạng trả lời: "2 ca sản xuất liên tiếp không có cảnh báo lặp".*

> **Trả lời:**
> ýt nhất 8 tiếng, thường là 24 tiếng
>

---

## C. Lệnh sản xuất — `/production-orders`

### C1. Ai được phép dời lịch / huỷ đơn tại nhà máy này, và cần xác nhận của ai?

*Vì sao hỏi: đây là thao tác có hậu quả tới kế hoạch và vật tư. Trợ lý cần nói đúng người,*
*chứ không nói "bạn vào màn hình rồi bấm huỷ".*

> **Trả lời:**
> quản lý, người lập lịch
>

### C2. Sai lệch WIP bao nhiêu thì coi là bất thường tại nhà máy này?

*Vì sao hỏi: WIP lệch một chút là bình thường. Ngưỡng "lệch bao nhiêu thì phải đi tìm nguyên nhân"*
*là con số riêng của mỗi nhà máy. Có thể trả lời theo số lượng, theo %, hoặc theo thời gian tồn.*

> **Trả lời:**
> 10%
>

---

## Ghi chú về 70 ô còn lại

17 thẻ kia thuộc loại **khác hẳn**: AI không suy ra được gì từ mã nên **cả bốn mục** (triệu chứng, nguyên nhân,
các bước, cách xác nhận) đều là khung chờ soạn. Đó không phải "điền vài ô" mà là **viết mới toàn bộ thẻ**,
và cần người trực tiếp vận hành màn hình đó mô tả.

Đề nghị: làm xong 7 ô này, **đo trước** đã. Nếu trợ lý trả lời được ba nhóm câu hỏi trên bằng đúng quy trình
nhà máy, ta biết công bỏ ra có kết quả và sẽ mở rộng có căn cứ. Nếu không, ta biết vấn đề nằm chỗ khác
và đã tiết kiệm được công viết 17 thẻ.
