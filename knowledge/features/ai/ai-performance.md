# Hiệu năng AI (AI Performance)

## 1. Mục đích
Theo dõi các chỉ số hiệu năng model AI: Accuracy, Precision, Recall, F1; xem confusion matrix, lịch sử training batch, suggestions chờ duyệt.

## 2. Vị trí truy cập
- URL: `/ai-performance`
- Menu: AI → AI Performance

## 3. Quyền yêu cầu
- `analytics_ai_performance`
- Category: `analytics`

## 4. Tiền điều kiện
- Có model active đã train
- Có `aiTrainingBatches`, `aiFeedback`, `aiSuggestions` data

## 5. Các bước thao tác
1. Mở `/ai-performance`, xem 4 metric cards (Accuracy, Precision, Recall, F1)
2. Xem confusion matrix (TP/FP/FN/TN)
3. Xem bảng training batches gần nhất (last 10)
4. Xem panel Pending Suggestions (last 20)
5. Filter theo model nếu cần
6. Click vào batch xem chi tiết training history

## 6. Kết quả mong đợi
- Metric cards có giá trị > 0
- Confusion matrix consistent
- Suggestions list cập nhật

## 7. Lỗi thường gặp & cách xử lý
- Metrics = 0 → chưa có feedback labeled
- Batches rỗng → chưa có training run
- Suggestions stale → reload trang

## 8. API liên quan
- `trpc.aiFeedback.getDashboardStats()`
- `trpc.aiFeedback.listTrainingBatches({ limit: 10 })`
- `trpc.aiFeedback.getPendingSuggestions({ limit: 20 })`

## 9. Tính năng liên quan
- [AI Model Management](ai/ai-model-management.md)
- [AI Active Learning](ai/ai-active-learning.md)
- [AI Quality Gate](ai/ai-quality-gate.md)

## 10. Ví dụ thực tế
ML Engineer mở dashboard: Accuracy 96.2%, F1 0.94. Confusion matrix cho thấy FP của class `Cold Joint` cao (28). Mở training batch gần nhất → thấy dataset thiếu cold joint samples → tạo active learning task để bổ sung nhãn.
