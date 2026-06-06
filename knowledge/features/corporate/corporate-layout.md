# Cấu trúc Tổ chức (Corporate Layout)

## Mục đích
Định nghĩa cây phân cấp tổ chức: Corporate → Factory → Workshop → Line → Station, làm khung tham chiếu cho tất cả module (data scope, permissions, reports).

## Vị trí truy cập
- Menu: `Corporate` › `Layout`
- URL: `/corporate/layout`
- Vai trò: admin, corporate-manager

## Quyền yêu cầu
- Resource: `corporate`
- Actions: `view`, `edit`
- Middleware: `requirePermission('dashboard_corporate')`

## Tiền điều kiện
- Có ít nhất 1 corporate entity (auto-tạo khi setup).

## Các bước thao tác
1. **Mở Layout Editor** — Tree view drag-drop.
2. **Thêm Factory** — Right-click corporate → `+ Factory`. Nhập `code`, `name`, `address`, `lat/lng`, `timezone`.
3. **Thêm Workshop** trong factory.
4. **Thêm Line** trong workshop.
5. **Thêm Station** trong line.
6. **Drag & Drop** — Reorder hoặc move node.
7. **Bulk import** — CSV với cột path: `F1/W1/LineA/St-1`.
8. **Visualize** — Tab `Diagram` hiện sơ đồ box.

## Kết quả mong đợi
- Tree lưu vào `factories`, `workshops`, `production_lines`, `stations`.
- Mọi entity nhận unique ID stable (UUID).

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Không xóa node được | Có data tham chiếu | Reassign hoặc soft-delete |
| Drag không hoạt động | Browser cũ | Dùng Chrome/Edge mới |

## API liên quan
- `tRPC: hierarchy.tree / addNode / updateNode / moveNode / deleteNode`.

## Tính năng liên quan
- [Corporate Dashboard](../corporate/corporate-dashboard.md).
- [Quản lý Workstation](../monitoring/workstation-mgmt.md).
- [Đăng ký Máy](../monitoring/machine-registration.md).

## Ví dụ thực tế
Tình huống: "Tập đoàn mở nhà máy F4 ở Hải Phòng, 2 workshop, mỗi workshop 3 line".
Bước: Layout Editor → +Factory `F4` (Hải Phòng, lat/lng, TZ Asia/HCM) → +Workshop W4-1, W4-2 → mỗi workshop +3 line. 5 phút setup xong, các module khác (machines, users) bắt đầu tham chiếu được F4.
