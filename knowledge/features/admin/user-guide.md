# Hướng dẫn Người dùng (User Guide)

## Mục đích
Trang tài liệu hướng dẫn sử dụng tích hợp trong app — list các topic, video, FAQ, troubleshooting cho user nội bộ tự tra cứu.

## Vị trí truy cập
- Menu: `Admin` › `User Guide` (hoặc icon `?` góc phải header trên mọi trang)
- URL: `/admin/user-guide`
- Vai trò: tất cả user (chỉ admin chỉnh sửa)

## Quyền yêu cầu
- Resource: `system`
- Actions: `view_guide` (mọi user); `edit_guide` (admin)
- Middleware: `requirePermission('admin_system')` cho edit

## Tiền điều kiện
- Knowledge base markdown đã build (KB local AI cũng dùng chung).

## Các bước thao tác
1. **Mở trang** — Sidebar list module: Dashboard, Inspection, AI, Analytics...
2. **Chọn topic** — Render markdown với mục lục bên phải.
3. **Search** — Box search full-text trong toàn bộ guide.
4. **Embed video** — Một số topic có video YouTube/Stream embed.
5. **In/Export PDF** — Nút `Print` hoặc `Export PDF`.
6. **Admin chỉnh sửa** — Edit markdown trong `knowledge/features/*` rồi reload.

## Kết quả mong đợi
- Trang load nhanh, search trả < 500ms.
- AI Local Chat cũng tham chiếu cùng nguồn KB.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Topic mới không xuất hiện | KB chưa reload | `POST /api/ai/local-kb/reload` |
| Search không tìm thấy | Index cũ | Reload KB |

## API liên quan
- `GET /api/userguide/topics`.
- `GET /api/userguide/topic/:slug`.
- `GET /api/userguide/search?q=...`.

## Tính năng liên quan
- [AI Local Knowledge Base](../ai/ai-local-knowledge-base.md) — backend chung.
- [API Docs](../admin/api-docs.md).

## Ví dụ thực tế
Tình huống: "Operator mới hỏi cách submit inspection".
Bước: Click `?` icon → search `submit inspection` → topic mở rõ ràng các bước. Operator tự làm theo, không cần hỏi support.
