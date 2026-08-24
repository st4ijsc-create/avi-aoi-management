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

## Bộ bàn giao 2026-08-24 — gửi đội server SYNAPSE

Cả hai hồ sơ dưới đây đi tới **cùng một đội** nhưng **độc lập với nhau**; xử lý cái nào trước cũng
được.

| file | nội dung | trạng thái phía ta |
|---|---|---|
| `2026-08-24-sync-points-push-fields.json` | Thân request `POST /api/machine/sync-points` **mẫu, hợp lệ, dán vào `curl` được** — mang **đủ 28 khoá đề nghị** cộng **17 trên 25** khoá hiện hành (đúng những khoá điểm mẫu thật sự đặt; tám khoá còn lại bị bỏ vì điểm này không đặt chúng — xem §7 của file `.md`). Mức lá: **39**. | **Chưa đổi một byte nào trên dây.** |
| `2026-08-24-sync-points-push-fields.md` | Bản giải thích tiếng Việt đi kèm file JSON: từng khoá là gì, kiểu, miền hợp lệ, ai soạn, vì sao phải đi lên; chỗ phải sửa trong cây của họ; và mục **"CÁI GÌ ĐANG HỎNG HÔM NAY"** kể bằng lời vận hành viên. | *(nt)* |
| `2026-08-24-intent-classifier-steptype.md` | Khuyết tật nằm **hoàn toàn trong `server/`**: bốn chuỗi ngoài vựng từ `stepType` đi vào một mệnh đề `WHERE`, làm mọi câu hỏi mô-men và mọi câu hỏi lượng keo trả về *"không đủ dữ liệu"* trên một bảng **có** dữ liệu. | **0 dòng `server/` bị sửa.** |

**Không có file JSON nào cho hồ sơ thứ hai** — nó không đề nghị nới một hợp đồng, nó báo một giá trị
sai. Một schema ở đó sẽ là một cái schema không ai cài.

---

## Đối chiếu với hồ sơ nội bộ

Hai hồ sơ trên tương ứng **mục 59** và **mục 69** trong `docs/owner-decisions.md`. **Bàn giao không
phải chấp thuận:** cả hai mục **ở lại Phần I** và chỉ rời khi bên kia đã trả lời hoặc đã sửa. Bản
trong `owner-decisions.md` vẫn là nguồn sự thật cho **ta**; các file ở đây là bản viết cho **họ**, và
khi hai bên khác nhau thì `owner-decisions.md` thắng.
