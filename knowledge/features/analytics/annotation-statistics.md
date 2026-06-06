# Thống kê Annotation

## Mục đích
Xem thống kê công việc gắn nhãn (annotate) hình ảnh: số lượng annotation theo người, theo loại defect, productivity per hour, accuracy.

## Vị trí truy cập
- Menu: `Analytics` › `Annotation` › `Statistics`
- URL: `/analytics/annotation-statistics`
- Vai trò: admin, manager, annotator-lead

## Quyền yêu cầu
- Resource: `annotation`
- Actions: `view_stats`
- Middleware: `requirePermission('annotations_view')`

## Tiền điều kiện
- Có dữ liệu trong `image_annotations` và `annotation_history`.
- Người dùng có role annotator đã hoàn thành ít nhất 1 task.

## Các bước thao tác
1. **Mở trang** — KPI cards: Total annotations, Active annotators, Avg time/image, Accuracy %.
2. **Lọc** — Date range, annotator, defect type, product.
3. **Xem leaderboard** — Bảng annotator sắp xếp theo throughput hoặc accuracy.
4. **Drilldown annotator** — Click hàng → xem chi tiết từng session, ảnh.
5. **Xem heatmap thời gian** — Productivity theo giờ trong ngày.
6. **Export** — CSV/Excel cho báo cáo cuối tuần.

## Kết quả mong đợi
- Dashboard load < 2s với 30 ngày data.
- Hiển thị accuracy = (annotations agreed by reviewer) / total reviewed.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Accuracy = N/A | Chưa có review | Cần ít nhất 1 reviewer pass qua |
| Annotator không xuất hiện | Chưa có annotation nào | Bình thường nếu mới tạo account |

## API liên quan
- `tRPC: annotation.statistics` — input filter, trả KPI + per-annotator.
- `tRPC: annotation.leaderboard`.

## Tính năng liên quan
- [So sánh Annotation](../analytics/annotation-comparison.md) — kiểm tra agreement.
- [Active Learning](../ai/ai-active-learning.md) — chọn ảnh cần label.

## Ví dụ thực tế
Tình huống: "Manager muốn đánh giá 5 annotator tuần qua".
Bước: Date range 7 ngày → leaderboard. Top 1: `Lan` 1,200 annotations, accuracy 94%. Bottom: `Hùng` 380 annotations, accuracy 78%. Drill Hùng → thấy nhiều sai loại `Solder Bridge` → arrange training.
