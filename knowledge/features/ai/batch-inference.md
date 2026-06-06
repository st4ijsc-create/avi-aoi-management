# Batch Inference (Batch Inference)

## 1. Mục đích
Tạo và quản lý job inference theo lô (batch): chạy model AI trên nhiều ảnh/inspections cùng lúc, phù hợp re-classify dữ liệu cũ hoặc xử lý số lượng lớn.

## 2. Vị trí truy cập
- URL: `/ai-batch-jobs`
- Menu: AI → Batch Inference

## 3. Quyền yêu cầu
- Tính năng AI (Admin/Engineer)

## 4. Tiền điều kiện
- Có model active
- Worker AI Jobs hoạt động

## 5. Các bước thao tác
1. Tab `Create Job`: chọn Model, Input source (folder/dataset/date range), Batch size, Output format (CSV/JSON)
2. Click `Submit` → job tạo, status `PENDING`
3. Tab `Job List` xem các job với status (PENDING/RUNNING/COMPLETED/FAILED) + progress
4. Click row → Tab `Job Detail` xem stats + sample results
5. Khi COMPLETED → download output file
6. Hỏng → click `Retry` hoặc `Cancel`

## 6. Kết quả mong đợi
- Job progress cập nhật realtime
- Output file đúng format đã chọn
- Cancel an toàn dừng worker

## 7. Lỗi thường gặp & cách xử lý
- Worker down → job stuck PENDING, kiểm tra worker service
- Out-of-memory → giảm batch size
- Output file rỗng → kiểm tra input source có dữ liệu

## 8. API liên quan
- `trpc.aiModel.list({ status: "ACTIVE" })`
- `trpc.aiBatchJobs.create(...)`, `list(...)`, `getById(...)`, `cancel({ jobId })`, `retry({ jobId })`
- Download output URL trong job detail

## 9. Tính năng liên quan
- [AI Model Management](ai/ai-model-management.md)
- [AI Quality Gate](ai/ai-quality-gate.md)
- [AI Settings](ai/ai-settings.md)

## 10. Ví dụ thực tế
Sau khi train model v3 với accuracy cải thiện, Engineer tạo batch job: model=v3, input=inspections từ 2026-04-01 đến 2026-04-30, batch=64, output=CSV. Job chạy 45 phút, xong → tải CSV (45,000 records) → so sánh với v2 thấy 380 case bị reclassify chính xác hơn.
