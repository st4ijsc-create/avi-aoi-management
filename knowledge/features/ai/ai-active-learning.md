# Active Learning (AI Active Learning)

## 1. Mục đích
Hệ thống chọn ra các mẫu AI ít chắc chắn nhất (uncertainty sampling) để con người gắn nhãn, sau đó dùng cho retraining → cải thiện accuracy nhanh với chi phí gắn nhãn thấp.

## 2. Vị trí truy cập
- URL: `/ai-active-learning`
- Menu: AI → Active Learning

## 3. Quyền yêu cầu
- Tính năng AI (Quality Inspector trở lên)

## 4. Tiền điều kiện
- Có model active đã sinh predictions
- Bảng `aiActiveLearningQueue`, `aiLabels`

## 5. Các bước thao tác
1. Mở trang, xem stats: Queue size / Labeled / Skipped / Accuracy %
2. Tab `Review Queue`: hệ thống hiển thị mẫu đầu tiên (image + predicted label + confidence)
3. Đồng ý → Submit (label saved)
4. Không đồng ý → chọn label đúng từ dropdown rồi Submit
5. Mẫu khó → click `Skip`
6. Sau N labels (vd 100), hệ thống đề xuất `Retrain model?`
7. Click → trigger async retrain job
8. Tab `Sampling` để xem batch sampling theo uncertainty

## 6. Kết quả mong đợi
- Mẫu hiển thị đúng image + label + confidence
- Submit cập nhật accuracy ngay
- Retrain job tạo training batch mới

## 7. Lỗi thường gặp & cách xử lý
- Image fail load → placeholder, cho phép Skip
- Queue rỗng → "All samples labeled! Good job!"
- Submit sai label type → validation error

## 8. API liên quan
- `trpc.aiActiveLearning.getQueue({ limit: 20 })`
- `trpc.aiActiveLearning.stats()`
- `trpc.aiActiveLearning.labelAccuracy({ modelId })`
- `trpc.aiActiveLearning.submitLabel({ itemId, label, confidence })`
- `trpc.aiActiveLearning.skipItem({ itemId })`
- `trpc.aiActiveLearning.autoLabel({ modelId, images })`
- `trpc.aiActiveLearning.uncertaintySampling()`
- `trpc.aiActiveLearning.checkRetrain({ modelId })`

## 9. Tính năng liên quan
- [AI Quality Gate](ai/ai-quality-gate.md)
- [AI Model Management](ai/ai-model-management.md)
- [AI Performance](ai/ai-performance.md)

## 10. Ví dụ thực tế
Inspector vào queue 156 mẫu. Mẫu #1 predicted `Solder Bridge` confidence 0.67 → đồng ý Submit. Mẫu #5 predicted `Missing Pad` 0.52 nhưng thực tế là `Cold Joint` → đổi label. Sau 100 nhãn, hệ thống đề xuất retrain → click → 1h sau model ONNX v5 ra mắt với accuracy +3%.
