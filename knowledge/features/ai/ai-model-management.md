# Quản lý Model AI (AI Model Management)

## 1. Mục đích
CRUD model AI: tạo, cập nhật, xoá, upload file model (ONNX/PyTorch), quản lý version, activate version, theo dõi metadata.

## 2. Vị trí truy cập
- URL: `/ai-models`
- Menu: AI → Models

## 3. Quyền yêu cầu
- Tính năng AI (Admin/Engineer)

## 4. Tiền điều kiện
- DB tables `aiModels`, `aiModelVersions`, `aiModelFiles`
- Storage cho file model (S3/disk)

## 5. Các bước thao tác
1. Tab `Models List` xem bảng (Name, Type, Status, Accuracy, Updated)
2. Click `+ Add Model` → form (Name, Description, Type, Status)
3. Save → record DB tạo
4. Click row → tab `Edit` mở: cập nhật metadata
5. Tab `Files` → upload file model (max 5GB), validate format
6. Tab `Versions` → tạo version mới khi retrain
7. Click `Activate` để set version active cho inference
8. Delete → confirm dialog (chặn nếu là model active)

## 6. Kết quả mong đợi
- Bảng cập nhật, version đúng active
- File upload progress + lưu URL
- Inference dùng version active mới

## 7. Lỗi thường gặp & cách xử lý
- File > 5GB → reject + toast
- ONNX không hợp lệ → validation error trước khi save
- Xoá model active → block + thông báo
- Activate version → tự deactivate version cũ

## 8. API liên quan
- `trpc.aiModel.list({ limit: 200, status?, type? })`
- `trpc.aiModel.create(...)`, `update(...)`, `delete({ id })`
- `trpc.aiModel.uploadFile({ modelId, file })`
- `trpc.aiModel.createVersion({ modelId, version, metadata })`
- `trpc.aiModel.getById({ id })`
- `trpc.aiModel.listVersions({ modelId })`
- `trpc.aiModel.activateVersion({ versionId })`

## 9. Tính năng liên quan
- [AI Quality Gate](ai/ai-quality-gate.md)
- [AI Performance](ai/ai-performance.md)
- [Active Learning](ai/ai-active-learning.md)

## 10. Ví dụ thực tế
Engineer tạo model `PCB-Defect-Detector`, type ONNX, status `DRAFT`. Upload file v1.onnx 1.2GB. Sau training, tạo version v2 với accuracy +3% → Activate v2 → Quality Gate dùng v2 cho inference ngay.
