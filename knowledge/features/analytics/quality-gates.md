# Quality Gates

## Mục đích
Định nghĩa các "cổng kiểm soát chất lượng" — bộ tiêu chí phải pass tại các điểm kiểm tra trong quy trình sản xuất, dùng để chặn lô hàng không đạt chuyển sang công đoạn tiếp theo.

## Vị trí truy cập
- Menu: `Analytics` › `Quality Gates`
- URL: `/analytics/quality-gates` và `/analytics/quality-gate-templates`
- Vai trò: admin, manager, quality-engineer

## Quyền yêu cầu
- Resource: `quality_gate`
- Actions: `view`, `create`, `update`, `approve`
- Middleware: `requirePermission('analytics_spc')`

## Tiền điều kiện
- Đã có Product Model và Process Steps.
- Có dữ liệu inspection để gate đánh giá.

## Các bước thao tác
1. **Tạo Template** — `Templates` tab → `+ New Template`. Nhập `name`, các tiêu chí: NG Rate ≤ X%, Cpk ≥ 1.33, Defect critical = 0.
2. **Áp dụng cho Product/Line** — Tab `Active Gates` → `+ Activate`. Chọn template + product + line + ngưỡng cụ thể.
3. **Theo dõi** — Bảng hiện `gate name`, `status` (open/closed), `last evaluation`, `next review`.
4. **Manual Evaluate** — Nút `Evaluate Now` chạy ngay, ghi vào `quality_gate_events`.
5. **Auto Evaluate** — Cron mỗi giờ hoặc trigger từ inspection batch hoàn tất.
6. **Override** — Manager có thể `Force Open` với lý do bắt buộc, lưu audit.

## Kết quả mong đợi
- Khi gate `closed`: hệ thống chặn lô hàng, hiện banner đỏ trên Production Dashboard.
- Khi `open`: cho phép lô tiếp tục.
- `quality_gate_events` log mỗi lần evaluate.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Gate luôn closed | Ngưỡng Cpk quá khắt khe | Review template, điều chỉnh |
| Không trigger auto | Chưa link với product | Activate cho product cụ thể |
| Override bị từ chối | Thiếu quyền `approve` | Cần manager role |

## API liên quan
- `tRPC: qualityGate.list / create / activate / evaluate / forceOpen`.
- `tRPC: qualityGate.events` — lịch sử evaluation.

## Tính năng liên quan
- [SPC Analysis](../analytics/spc-analysis.md) — Cpk dùng trong gate.
- [AI Quality Gate](../ai/ai-quality-gate.md) — variant dùng AI scoring.
- [Production Dashboard](../production/production-dashboard.md) — hiện trạng gate.

## Ví dụ thực tế
Tình huống: "Sản phẩm PCB-A trước khi đóng gói phải có NG ≤ 1% và 0 critical defect".
Bước: Template `Pre-Pack PCB`: NG ≤ 1.0%, critical_count = 0. Activate cho product `PCB-A`, line `Packaging`. Sau 1 giờ evaluate → gate `closed` vì critical=2 → block lô. QA xử lý critical → re-evaluate → open.
