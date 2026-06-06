# So sánh Annotation

## Mục đích
So sánh annotation của nhiều người trên cùng một ảnh (inter-annotator agreement) hoặc so sánh annotation người vs AI, để đo lường chất lượng và kiểm tra mô hình.

## Vị trí truy cập
- Menu: `Analytics` › `Annotation` › `Comparison`
- URL: `/analytics/annotation-comparison`
- Vai trò: admin, quality-engineer, annotator-lead

## Quyền yêu cầu
- Resource: `annotation`
- Actions: `compare`
- Middleware: `requirePermission('annotations_comparison')`

## Tiền điều kiện
- Mỗi ảnh trong sample có ≥ 2 annotation từ 2 nguồn khác nhau (người-người hoặc người-AI).

## Các bước thao tác
1. **Tạo session** — `+ New Comparison Session`. Nhập `name`, chọn dataset, chọn 2 nguồn (annotator A, annotator B / Model v1).
2. **Chạy compare** — Nút `Run`. Backend tính IoU, label agreement, confusion matrix.
3. **Xem kết quả** — Tab `Summary`: agreement %, Cohen's kappa.
4. **Tab `Per-image`** — Bảng từng ảnh + IoU + diff label.
5. **Side-by-side viewer** — Click ảnh → 2 panel hiển thị bbox/mask 2 nguồn chồng lên.
6. **Export** — CSV với chi tiết từng box.

## Kết quả mong đợi
- Session lưu vào `annotation_comparison_sessions`.
- Cohen's kappa: > 0.8 = excellent, 0.6-0.8 = good, < 0.6 = cần training.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Agreement rất thấp | Hai người hiểu khác về defect | Tổ chức calibration session |
| Run timeout | Dataset quá lớn | Chia nhỏ < 5,000 ảnh |

## API liên quan
- `tRPC: annotationComparison.create / run / get`.

## Tính năng liên quan
- [Thống kê Annotation](../analytics/annotation-statistics.md).
- [AI Quality Gate](../ai/ai-quality-gate.md) — eval model vs ground truth.

## Ví dụ thực tế
Tình huống: "Đánh giá model v3 so với annotator senior trên 1,000 ảnh test".
Bước: New session, dataset `test-1k`, source A `Model v3`, source B `Lan (senior)`. Run → kappa 0.84, agreement 91%. Per-image cho thấy model thường miss `Tiny Crack` < 5px → cần re-train với data zoom.
