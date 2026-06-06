# Report Builder

## Mục đích
Công cụ tự xây báo cáo kéo-thả: chọn data source, filter, aggregation, biểu đồ và bố cục để tạo template báo cáo tùy chỉnh không cần code.

## Vị trí truy cập
- Menu: `Analytics` › `Reports` › `Builder`
- URL: `/analytics/report-builder`
- Vai trò: admin, manager, quality-engineer

## Quyền yêu cầu
- Resource: `report`
- Actions: `create`, `update`, `view`
- Middleware: `requirePermission('reports_view')`

## Tiền điều kiện
- Có data source (inspections, daily_statistics, alerts...).

## Các bước thao tác
1. **New Template** — Nhập `name`, `description`.
2. **Add Section** — Block: Header, Text, Table, Chart, KPI.
3. **Cấu hình block** — Chọn data source, fields, group by, filter, chart type.
4. **Preview** — Nút `Preview` render với data hiện tại.
5. **Save Template** — Lưu vào `report_templates`.
6. **Export** — Render template ra PDF/Excel/PowerPoint từ `Reports` page.
7. **Schedule** — Liên kết với Scheduled Reports để gửi định kỳ.

## Kết quả mong đợi
- Template lưu thành công, hiện trong danh sách.
- Preview render đúng dữ liệu thật.
- Có thể clone template để biến thể.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Preview trống | Filter quá hẹp | Mở rộng date range |
| Chart không render | Field aggregation sai type | Đổi sang field numeric |
| Save fail | Trùng tên template | Đổi tên |

## API liên quan
- `tRPC: reportBuilder.list / create / update / preview / clone`.

## Tính năng liên quan
- [Báo cáo định kỳ](../analytics/scheduled-reports.md) — auto gửi.
- [Báo cáo PDF](../analytics/reports.md) — render output.

## Ví dụ thực tế
Tình huống: "Manager muốn báo cáo daily NG có chart per-line + bảng top 10 defect".
Bước: New template `Daily NG Report`. Block 1 = KPI (NG rate, Throughput). Block 2 = Bar chart NG by line. Block 3 = Top 10 defect table. Preview → đẹp → Save → schedule gửi 7h sáng mỗi ngày.
