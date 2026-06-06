# API Documentation

## Mục đích
Trang xem tài liệu API của hệ thống: tRPC routers, REST endpoints, payloads, examples — cho developer tích hợp bên thứ 3 hoặc debug.

## Vị trí truy cập
- Menu: `Admin` › `API Docs`
- URL: `/admin/api-docs`
- Vai trò: admin, developer

## Quyền yêu cầu
- Resource: `system`
- Actions: `view_docs`
- Middleware: `requirePermission('admin_system')`

## Tiền điều kiện
- Server đã build với mode dev hoặc production có ENABLE_API_DOCS=true.

## Các bước thao tác
1. **Mở trang** — Sidebar list các module (auth, user, machine, mqtt, ai...).
2. **Chọn endpoint** — Click → panel hiện:
   - Method, path, description.
   - Request schema (Zod) và example.
   - Response schema và example.
   - Required permissions.
3. **Try it out** — Built-in console gửi request thử (dùng session hiện tại).
4. **Copy curl** — Nút sinh sẵn lệnh curl.
5. **OpenAPI spec download** — Nút `Download OpenAPI JSON`.

## Kết quả mong đợi
- Tài liệu auto-generate từ tRPC routers.
- Example request/response đúng format.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Endpoint thiếu | Router không export | Re-export trong `server/routers/index.ts` |
| Try it out 401 | Không cookie | Login trước |

## API liên quan
- `GET /api/openapi.json` — full spec.

## Tính năng liên quan
- [Hướng dẫn người dùng](../admin/user-guide.md) — UI guide.

## Ví dụ thực tế
Tình huống: "Đối tác cần tích hợp pull dữ liệu inspection".
Bước: Mở API Docs → tìm `inspection.list` → xem schema → copy curl mẫu → gửi cho đối tác. Đối tác test thành công với API key.
