# Quality Gate AI (AI Quality Gate)

## 1. Mục đích
Cấu hình ngưỡng AI để tự động phân loại inspection thành Auto OK / Auto NG / Needs Review, giảm tải review thủ công và đảm bảo tính nhất quán.

## 2. Vị trí truy cập
- URL: `/ai-quality-gate`
- Menu: AI → Quality Gate

## 3. Quyền yêu cầu
- Tính năng AI (admin/supervisor để tạo config)

## 4. Tiền điều kiện
- Có ít nhất 1 model `ACTIVE` trong AI Models
- DB tables `aiQualityGateConfigs`, `aiQualityGateResults` đã có

## 5. Các bước thao tác
1. Mở `/ai-quality-gate`, xem stats: Auto OK / Auto NG / Needs Review / Total
2. Tab `Configs` → click `Create Config`
3. Nhập: Name, chọn Model, autoOkThreshold (vd 0.98), autoNgThreshold (vd 0.95)
4. Save → config áp dụng inspection mới
5. Tab `Results` → filter `decision = NEEDS_REVIEW`
6. Review thủ công các case mơ hồ, ghi đè bằng `reviewDecision`
7. Tab `Ensembles` để cấu hình kết hợp nhiều model

## 6. Kết quả mong đợi
- Stats cards cập nhật theo realtime
- Config mới áp dụng cho inspections tiếp theo
- Manual override lưu lại + dùng cho retrain

## 7. Lỗi thường gặp & cách xử lý
- Threshold không hợp lệ (autoOk < autoNg) → validation error
- Không có model active → không thể tạo config, vào AI Models activate trước
- Tỉ lệ Needs Review cao → giảm threshold hoặc retrain model

## 8. API liên quan
- `trpc.aiQualityGate.listConfigs({ limit, offset })`
- `trpc.aiQualityGate.listResults({ limit, offset, decision? })`
- `trpc.aiQualityGate.stats()`
- `trpc.aiQualityGate.listEnsembles({ limit: 20 })`
- `trpc.aiModel.list({ status: "ACTIVE", limit: 100 })`
- `trpc.aiQualityGate.createConfig(...)`
- `trpc.aiQualityGate.deleteConfig({ id })`
- `trpc.aiQualityGate.reviewDecision({ resultId, userDecision, reason })`

## 9. Tính năng liên quan
- [AI Model Management](ai/ai-model-management.md)
- [AI Active Learning](ai/ai-active-learning.md)
- [AI Performance](ai/ai-performance.md)

## 10. Ví dụ thực tế
Admin tạo config `Strict` (model ONNX v2, autoOk=0.98, autoNg=0.95). Sau 1 ngày: 1255 OK, 50 NG, 22 Needs Review. Admin review 22 case, override 5 thành OK → đưa vào training batch tiếp theo để giảm uncertainty.
