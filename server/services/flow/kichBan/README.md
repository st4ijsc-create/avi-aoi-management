# Bộ thử luồng (kịch bản) — lô B7-E

Mỗi tệp `*.json` ở đây là MỘT kịch bản chạy bằng ĐỘNG CƠ THẬT trên CSDL `_test` (AI là hàm giả tất định, không model thật, không mạng) bởi `kichBan.db.test.ts`:

```bash
npx vitest run server/services/flow/kichBan
```

Thêm kịch bản = thả một tệp JSON mới vào thư mục này (không sửa mã). Định dạng — xem docblock của `chayKichBan.ts`:

| khoá | ý nghĩa |
|---|---|
| `luong` hoặc `mau` | định nghĩa luồng tại chỗ, hoặc tên tệp trong `../mau/` |
| `thayNut` | thay node (vd node tạo phiếu / gửi HTTP bằng `du-lieu.dat` đánh dấu); cổng nối giữ nguyên |
| `ghiDeThamSo` | gộp tham số vào node |
| `items` | item vào của trigger |
| `ai` | luật AI giả: `khop` (regex trên phần dữ liệu), `tra` (văn bản), `tinCay` (0…1, mô phỏng logprob) |
| `duyet` | trả lời hàng chờ theo thứ tự: `{nodeId, cong, them?}` |
| `tuaGio` | coi mọi hẹn giờ (`logic.cho`) là đã tới hạn |
| `kyVong` | `trangThai`, `loi.ma`, `khongChay[]`, `soLanGoiAi`, `buoc.<nodeId>.{trangThai,dauVao,dauRa,soLan}` — `dauVao/dauRa` so TẬP CON sâu |

Phạm vi: kiểm LUỒNG (rẽ nhánh, ngưỡng tin cậy, duyệt, tham số), KHÔNG kiểm chất lượng model (đo model ở `server/services/flow/eval/`). `ai.giam-khao` chưa có.
