# `docs/handoff/` — hồ sơ gửi RA NGOÀI, cho đội khác đọc

Thư mục này khác mọi thư mục khác trong kho: **người đọc ở đây KHÔNG có cây mã này.** Họ không mở được
`docs/owner-decisions.md`, không biết vựng từ nội bộ của chúng ta, và mỗi câu mập mờ tốn của họ một
vòng trao đổi **nhiều ngày**, không phải một lần chạy cổng.

**Luật của thư mục này, cả bốn đều bắt buộc:**

1. **Tự đủ.** Mọi thứ người đọc cần phải nằm trong chính bộ file. Không trỏ sang tài liệu nội bộ.
2. **Trỏ bằng TÊN, và ghi ngày của số dòng.** Cây của họ dịch số dòng; tên hàm thì không.
3. **Khai thứ mình KHÔNG đo, ở ngay chỗ kết luận hiện ra** — không giấu xuống cuối trang.
4. **Đề nghị, không phải bản sửa.** Không file nào ở đây được kèm một thay đổi đã ship lên dây.

---

## 🔴 THỨ TỰ ƯU TIÊN — đọc trước bảng file

Ba hồ sơ trong thư mục này đi tới **cùng một đội server SYNAPSE**. Chúng **độc lập về nội dung** — không
hồ sơ nào cần hồ sơ kia để hiểu được — nhưng chúng **KHÔNG ngang nhau về mức quan trọng**, và thứ tự
dưới đây là thứ tự chúng tôi đề nghị đội kia xếp lịch:

| ưu tiên | hồ sơ | mục nội bộ | vì sao ở bậc này |
|---|---|---|---|
| **1** | `2026-08-24-sync-points-push-fields.md` + `.json` — **28 trường** | 59 | **Đắt nhất, và là thứ duy nhất đang LÀM MẤT dữ liệu.** Một vận hành viên sửa 28 trường rồi mất bản sửa ở lần pull kế. Câu hỏi chính — *"các anh có GHI 28 trường xuống DB không?"* — chặn một đường dữ liệu đang chạy. |
| **2** | `2026-08-24-intent-classifier-steptype.md` | 69 | Một giá trị **sai** làm mọi câu hỏi mô-men và lượng keo trả *"không đủ dữ liệu"* trên một bảng CÓ dữ liệu. Hỏng thật, nhưng **không mất dữ liệu của ai**. |
| **3** | `2026-08-25-aoi-inspection-recipe-kind.md` — **`aoi_inspection`** | 71 | Một **đề nghị nới hợp đồng**, không phải một báo lỗi. Một lược đồ kiểm **không chạy** cho một họ máy; không ai mất gì hôm nay. |

🔴 **Nếu đội kia chỉ làm được MỘT việc, đó phải là hồ sơ số 1.** Ba hồ sơ được giữ thành **ba file
riêng** chính vì thế: gộp một đề nghị rẻ vào một câu hỏi đắt làm **loãng** câu hỏi đắt, và người đọc sẽ
trả lời cái dễ trước.

📎 🔴 **CÂU DƯỚI ĐÂY ĐÃ RÚT — 2026-08-25, giữ NGUYÊN TỪNG CHỮ, không xoá.** Tới 2026-08-24 mục này viết
*"Cả hai hồ sơ dưới đây đi tới **cùng một đội** nhưng **độc lập với nhau**; xử lý cái nào trước cũng
được."* Vế *"độc lập với nhau"* **vẫn đúng**. Vế *"xử lý cái nào trước cũng được"* **nay SAI**: bảng ưu
tiên ở trên là một thứ tự, và nó tồn tại vì hồ sơ thứ ba được thêm vào ngày 2026-08-25 và nó **rẻ hơn
hẳn** hai hồ sơ kia — nên để nguyên câu cũ sẽ mời người đọc làm cái rẻ trước. Chữ *"Cả hai"* cũng đã cũ:
nay là **ba**.

---

## Bộ bàn giao 2026-08-24 — gửi đội server SYNAPSE

| file | nội dung | trạng thái phía ta |
|---|---|---|
| `2026-08-24-sync-points-push-fields.json` | Thân request `POST /api/machine/sync-points` **mẫu, hợp lệ, dán vào `curl` được** — mang **đủ 28 khoá đề nghị** cộng **17 trên 25** khoá hiện hành (đúng những khoá điểm mẫu thật sự đặt; tám khoá còn lại bị bỏ vì điểm này không đặt chúng — xem §7 của file `.md`). Mức lá: **39**. | **Chưa đổi một byte nào trên dây.** |
| `2026-08-24-sync-points-push-fields.md` | Bản giải thích tiếng Việt đi kèm file JSON: từng khoá là gì, kiểu, miền hợp lệ, ai soạn, vì sao phải đi lên; chỗ phải sửa trong cây của họ; và mục **"CÁI GÌ ĐANG HỎNG HÔM NAY"** kể bằng lời vận hành viên. | *(nt)* |
| `2026-08-24-intent-classifier-steptype.md` | Khuyết tật nằm **hoàn toàn trong `server/`**: bốn chuỗi ngoài vựng từ `stepType` đi vào một mệnh đề `WHERE`, làm mọi câu hỏi mô-men và mọi câu hỏi lượng keo trả về *"không đủ dữ liệu"* trên một bảng **có** dữ liệu. | **0 dòng `server/` bị sửa.** |

**Không có file JSON nào cho hồ sơ thứ hai** — nó không đề nghị nới một hợp đồng, nó báo một giá trị
sai. Một schema ở đó sẽ là một cái schema không ai cài.

---

## Bộ bàn giao 2026-08-25 — gửi CÙNG đội server SYNAPSE

| file | nội dung | trạng thái phía ta |
|---|---|---|
| `2026-08-25-aoi-inspection-recipe-kind.md` | **Đề nghị** thêm `"aoi_inspection"` vào `RECIPE_KINDS`, một `RECIPE_PAYLOAD_SCHEMAS` tương ứng, và ánh xạ `AOI`/`AVI`/`AOI_AVI`. Đo lại `RECIPE_KINDS` ngày 2026-08-25 qua `git show HEAD:server/…` (thư mục `server/` **không có trên đĩa** vì nón checkout thưa — nên đây là *"đã đo"*, không phải *"không thấy"*): **bốn** phần tử, **không** có `aoi_inspection`. Sáu khoá kèm min/max/mặc định. | **0 dòng `server/` bị sửa.** Không đổi một byte nào trên dây. |

**Không có file JSON nào cho hồ sơ này** — nó đề nghị một *hình dạng lược đồ*, và hình dạng ấy được viết
thẳng bằng `zod` trong chính file `.md`, đúng khuôn ba `*Shape` đã có bên họ. Một file JSON mẫu ở đây sẽ
là một **công thức**, không phải một **lược đồ**, tức là trả lời sai câu hỏi.

🔴 **Khoá thứ BẢY (`retestPolicy`) cố ý KHÔNG được xin** — nó là một câu hỏi thiết kế không có trọng
tài, và hồ sơ nói thẳng như thế ở §4 của nó.

---

## Đối chiếu với hồ sơ nội bộ

Ba hồ sơ trên tương ứng **mục 59**, **mục 69** và **mục 71** trong `docs/owner-decisions.md`.
**Bàn giao không phải chấp thuận:** cả ba mục **ở lại Phần I** và chỉ rời khi bên kia đã trả lời hoặc đã
sửa. Bản trong `owner-decisions.md` vẫn là nguồn sự thật cho **ta**; các file ở đây là bản viết cho
**họ**, và khi hai bên khác nhau thì `owner-decisions.md` thắng.

📎 **Câu trên tới 2026-08-24 viết *"Hai hồ sơ trên tương ứng mục 59 và mục 69"* và *"cả hai mục"*** —
đúng ngày ấy, cũ từ 2026-08-25. Sửa số, giữ nguyên vế còn lại, vì vế ấy là luật của thư mục chứ không
phải một phép đếm.
