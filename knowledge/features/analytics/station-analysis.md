# Phân tích Trạm (Station Analysis)

## Mục đích
Phân tích hiệu suất, NG rate, throughput và bottleneck của từng station trong line sản xuất, giúp xác định nút thắt và tối ưu balancing.

## Vị trí truy cập
- Menu: `Analytics` › `Station Analysis`
- URL: `/analytics/station-analysis`
- Vai trò: admin, manager, engineer

## Quyền yêu cầu
- Resource: `analytics_station`
- Actions: `view`
- Middleware: `requirePermission('analytics_advanced')`

## Tiền điều kiện
- Đã định nghĩa stations trong Production Process.
- Có dữ liệu inspection gắn `stationId`.

## Các bước thao tác
1. **Chọn line + date range** — Header filter.
2. **Bảng tổng hợp** — Cột: station, throughput/hr, cycle time avg, NG rate, utilization %, idle time.
3. **Sắp xếp & filter** — Click header sort theo bottleneck.
4. **Biểu đồ Cycle Time** — Box plot per station.
5. **Heatmap NG by station x defect type** — Tab `Defect Heatmap`.
6. **Drill station** — Click → xem từng máy trong station.
7. **Export CSV** cho báo cáo.

## Kết quả mong đợi
- Bottleneck station highlight đỏ (cycle time cao nhất).
- Khuyến nghị tự động nếu utilization > 90% → đề xuất tăng máy.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Station thiếu | Inspection không có `stationId` | Cập nhật mapping product-station |
| Cycle time âm/0 | Timestamp lỗi | Kiểm tra clock sync trên máy |

## API liên quan
- `tRPC: stationAnalysis.summary / cycleTime / defectMatrix`.

## Tính năng liên quan
- [Production Dashboard](../production/production-dashboard.md).
- [Defect Heatmap](../analytics/defect-heatmap.md).
- [OEE Dashboard](../monitoring/oee-dashboard.md).

## Ví dụ thực tế
Tình huống: "Line A throughput thấp hơn target 20%, tìm bottleneck".
Bước: Station Analysis line A, 7 ngày → St-4 cycle time 22s vs other 12s, utilization 98%. Drill St-4 → 1 máy. Quyết định bổ sung 1 máy song song hoặc tối ưu thao tác St-4.
