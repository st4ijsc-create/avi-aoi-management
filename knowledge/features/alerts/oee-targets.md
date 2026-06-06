# Mục tiêu OEE (OEE Targets)

## Mục đích
Cấu hình ngưỡng mục tiêu (target) cho các chỉ số OEE — Availability, Performance, Quality và OEE tổng — theo từng máy, line, hoặc cả nhà máy. Khi giá trị thực tế dưới target, hệ thống sinh alert và highlight đỏ trên [OEE Dashboard](../analytics/oee-dashboard.md).

## Vị trí truy cập
- Menu: `Menu chính` › `Cảnh báo` › `Mục tiêu OEE`
- URL: `/oee-target-settings`
- Vai trò thấy menu: admin, supervisor

## Quyền yêu cầu
- Resource: `analytics`
- Actions: `analytics_oee_targets`
- Middleware: `protectedProcedure` + `requirePermission('analytics_oee_targets')`

## Tiền điều kiện
- Đã có Machines / Lines / Factories được khai báo.
- Có dữ liệu OEE đang được tính (cần production orders + inspection records).

## Các bước thao tác
1. **Mở danh sách Targets** — vào `/oee-target-settings`. Bảng: `scope` (`global` | `factory` | `line` | `machine`), `scopeId`, `availability%`, `performance%`, `quality%`, `oee%`, `effectiveFrom`, `effectiveTo`, `isActive`.
2. **Tạo Target mới** — nhấn `+ New Target`.
   - `scope` (chọn): `global` (áp dụng toàn hệ thống) | `factory` | `line` | `machine`.
   - `scopeId` (nếu khác `global`): chọn factory/line/machine.
   - `availabilityTarget` (0–100, vd 90).
   - `performanceTarget` (0–100, vd 85).
   - `qualityTarget` (0–100, vd 99).
   - `oeeTarget` (auto = A×P×Q hoặc nhập tay, vd 75).
   - `effectiveFrom` (date, default hôm nay), `effectiveTo` (optional).
   - `alertOnBelow` (boolean): có sinh alert khi thực tế dưới target không.
   - `alertWindowMin` (số phút phải dưới target liên tục mới alert, default 60).
3. **Save** — nhấn `Create`. Target active ngay theo `effectiveFrom`.
4. **Bulk apply** — nút `Apply to all machines`: copy 1 target làm mặc định cho mọi machine chưa có target riêng.
5. **Xoá / Vô hiệu** — toggle `isActive` hoặc nhấn xoá. Target có history sẽ chỉ bị soft-delete.

## Kết quả mong đợi
- Bản ghi mới trong bảng `oee_targets` (kết hợp jsonb).
- [OEE Dashboard](../analytics/oee-dashboard.md) hiển thị đường target trên biểu đồ và highlight cell đỏ khi dưới target.
- Service `oeeMonitor` sinh alert (source = `oee`) vào `alerts` khi `actualOEE < target` liên tục ≥ `alertWindowMin`.

## Lỗi thường gặp & cách xử lý
| Triệu chứng | Nguyên nhân | Cách xử lý |
|---|---|---|
| Toast `Đã có target active cho scope này` | Trùng scope+effective period | Sửa target cũ thay vì tạo mới |
| Không thấy đường target trên dashboard | `isActive = false` hoặc effective period chưa tới | Kiểm tra `effectiveFrom/To` |
| Quá nhiều OEE alert | `alertWindowMin` quá ngắn, hoặc target quá cao | Tăng window lên 120+, hoặc giảm target xuống mức thực tế đạt được |
| OEE target thay đổi không phản ánh | Cache dashboard 5 phút | Bấm `Refresh` ở dashboard hoặc đợi cache hết |

## API liên quan
- `oeeTarget.list` (tRPC) — params: `scope`, `scopeId`, `activeOnly`.
- `oeeTarget.create` / `.update` / `.delete`.
- `oeeTarget.bulkApply` — body: `{ sourceTargetId, applyToScope: 'machine' }`.
- `oeeTarget.getEffective` — params: `machineId`, `at`. Trả về target đang áp dụng tại thời điểm.

## Tính năng liên quan
- [OEE Dashboard](../analytics/oee-dashboard.md) — visualize target vs actual.
- [Danh sách Cảnh báo](alerts-list.md) — OEE alerts hiển thị ở đây với `source = oee`.
- [Production Dashboard](../production/production-dashboard.md) — KPI tham chiếu target.
- [Machine Health](../monitoring/machine-health.md) — Availability feed cho OEE.

## Ví dụ thực tế
Tình huống: "Manager set target OEE 75% cho toàn line A từ tháng 6, alert nếu dưới target liên tục 2 giờ."
1. Vào `/oee-target-settings` → `+ New Target`.
2. `scope = line`, `scopeId = LINE-A`, `availability = 90`, `performance = 85`, `quality = 99`, `oee = 75`.
3. `effectiveFrom = 2026-06-01`, `alertOnBelow = true`, `alertWindowMin = 120`.
4. Save → target active từ 1/6.
5. Ngày 5/6: line A bị OEE = 68% liên tục từ 9h–11h → service sinh alert critical "OEE LINE-A below target 75% for 2h".
6. Supervisor mở `/alerts` → ack → điều tra (downtime placer-2).
