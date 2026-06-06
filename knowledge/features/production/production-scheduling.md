# Lập lịch sản xuất (Production Scheduling)

## 1. Mục đích
Tối ưu hóa lịch sản xuất tự động bằng các thuật toán **FIFO**, **Priority**, **EDF (Earliest Deadline First)** — sinh ra danh sách gợi ý dời lịch và phát hiện xung đột (overlap, dependency, capacity, deadline). Cho phép áp dụng từng gợi ý, theo dõi WIP (work-in-progress) realtime theo từng dây chuyền.

## 2. Vị trí truy cập
- URL: `/production-scheduling`
- Menu: **Sản xuất → Lập lịch sản xuất**
- Tệp giao diện: `client/src/pages/ProductionScheduling.tsx`

## 3. Quyền yêu cầu
- Quyền: `production_orders` — chung với *Đơn hàng sản xuất*.
- Xem trang + chạy optimize: cần quyền `production_orders`.
- Áp dụng gợi ý (`applyScheduleSuggestion`): yêu cầu role **admin**.

## 4. Tiền điều kiện
- Có ít nhất một **production_order** ở trạng thái `pending` hoặc `planned`.
- Các **production_lines** đã được cấu hình `maxConcurrentOrders` và/hoặc `capacityPerHour`.
- Service `productionSchedulingService` (cài đặt FIFO/Priority/EDF) chạy bình thường — nếu lỗi sẽ fallback DB-level optimize.
- Đơn hàng có `priority`, `plannedStartDate`, `plannedEndDate` để thuật toán EDF/Priority hoạt động đúng.

## 5. Các bước thao tác
1. **Mở trang** từ menu *Sản xuất → Lập lịch sản xuất*. Tab **Algorithm** hiển thị 3 thẻ thuật toán.
2. **Xem stats** ở 5 card đầu: Total / In Progress / Planned / Completed / Overdue.
3. **Chọn thuật toán**: bấm 1 trong 3 card:
   - **FIFO** — first-in-first-out, theo thứ tự tạo đơn.
   - **Priority** — ưu tiên theo trường `priority` (P0 > P1 > P2 ...).
   - **EDF** — đơn hạn sớm nhất chạy trước (theo `plannedEndDate`).
4. **Bấm "Tối ưu lịch"** (nút lớn) — gọi `optimizeSchedule` mutation. Trong khi chạy, button hiển thị "Đang tối ưu...".
5. **Xem kết quả**: hiển thị 2 section:
   - **Conflicts** (viền đỏ nếu có): bảng các xung đột với cột Type / Order / Message / Severity.
   - **Suggestions**: bảng các gợi ý dời lịch với Order Code, Line, Suggested Start, Suggested End, Reason, Score.
6. **Áp dụng gợi ý**: bấm **Áp dụng** trên row gợi ý → AlertDialog xác nhận → gọi `applyScheduleSuggestion`. Toast "Áp dụng thành công".
7. **Chuyển tab WIP Tracking**: thấy lưới các card line, mỗi card hiển thị utilization %, số đơn active, progress bar, ETA.
8. **Chuyển tab Order List**: xem bảng tất cả đơn hàng có cột priority badge, scheduled dates. Lọc theo Status (All/Planned/In Progress/Completed/Cancelled).
9. **Refresh**: bấm nút *Refresh* góc trên phải để re-fetch list và cập nhật stats.

## 6. Kết quả mong đợi
- Sau **Optimize**:
  - Nếu có cải tiến: section **Suggestions** liệt kê các thay đổi đề xuất với lý do (vd: "Move to higher-capacity line").
  - Nếu có xung đột: section **Conflicts** đỏ, mỗi xung đột có message rõ ràng.
  - Toast "Tối ưu thành công: N gợi ý".
- Sau **Apply**: order tương ứng đổi `scheduledStartDate/EndDate/lineId`, biến mất khỏi suggestions, stats cập nhật, toast success.
- **WIP Tracking**:
  - Utilization badge: đỏ >80%, xanh dương 50-80%, mặc định <50%.
  - Mỗi card có progress completion %, số lượng (actual/target), ETA dự kiến.
- **Overdue** count tăng nếu `scheduledEndDate < now` AND status ≠ `completed`.

## 7. Lỗi thường gặp & cách xử lý
- **Triệu chứng**: Optimize chạy thành công nhưng 0 suggestions. **Nguyên nhân**: Lịch hiện tại đã tối ưu, hoặc thuật toán không tìm được cải tiến với constraint hiện có. **Cách xử lý**: Đổi sang thuật toán khác (vd FIFO → EDF), hoặc kiểm tra `priority` / `plannedEndDate` của đơn đã được set.
- **Triệu chứng**: Conflict type *overlap*. **Nguyên nhân**: 2 đơn cùng line cùng khung giờ. **Cách xử lý**: Áp dụng gợi ý dời 1 đơn, hoặc dùng `forceOverride` ở reschedule (chỉ admin).
- **Triệu chứng**: Conflict *capacity exceeded*. **Nguyên nhân**: Line vượt `maxConcurrentOrders` / `capacityPerHour`. **Cách xử lý**: Tăng giới hạn line trong cấu hình, hoặc dời sang line khác.
- **Triệu chứng**: WIP tracking hiển thị utilization 0% dù có đơn đang chạy. **Nguyên nhân**: `getWIPStatus` cần `actualStartDate` được set; có thể đơn vẫn ở status `pending`. **Cách xử lý**: Đảm bảo đơn đã chuyển sang `in_progress` (set `actualStartDate`).
- **Triệu chứng**: Apply gợi ý báo "Permission denied". **Nguyên nhân**: User không phải admin. **Cách xử lý**: Đăng nhập tài khoản admin hoặc nhờ admin áp dụng.

## 8. API liên quan
- tRPC `productionOrder.list` (query) — lấy đơn hàng (có filter status).
- tRPC `line.list` (query) — lấy danh sách dây chuyền.
- tRPC `productionOrder.optimizeSchedule` (mutation) — input: `{factoryId, algorithm: "fifo"|"priority"|"edf"}`; output: `{suggestions[], conflicts[]}`.
- tRPC `productionOrder.applyScheduleSuggestion` (mutation, **admin**) — input: `{orderId, suggestedLineId, suggestedStartDate, suggestedEndDate, reason, score}`.
- tRPC `productionOrder.getWIPStatus` (query) — input optional `factoryId`; output: array WIP per line.
- tRPC `productionOrder.getWIPByLine` (query) — input `lineId`.
- Bảng: `production_orders` (update scheduled dates), `production_lines` (đọc capacity), `daily_statistics` (tính progress).

## 9. Tính năng liên quan
- [Đơn hàng sản xuất](./production-orders.md) — nguồn dữ liệu đầu vào, có thể reschedule thủ công bằng Gantt.
- [Bảng điều khiển sản xuất](./production-dashboard.md) — đo tác động của lịch tới FPY/output.
- [Lịch sử kiểm tra](../inspection/history.md) — đối chiếu schedule vs actual completion.

## 10. Ví dụ thực tế
**Tình huống**: 10 đơn hàng đang chờ, 2 có deadline gấp ngày mai, dây chuyền SMT-Line-B đang nhàn rỗi 60%.
1. Mở `/production-scheduling`.
2. Stats: Total 10, In Progress 3, Planned 7, Overdue 0.
3. Chọn thuật toán **EDF** (Earliest Deadline First) — phù hợp khi có deadline gấp.
4. Bấm **Tối ưu lịch** → "Đang tối ưu..." → kết quả: 4 suggestions, 1 conflict.
5. Conflict: "Order ORD-008 trùng lịch với ORD-005 trên SMT-Line-A".
6. Suggestions:
   - Dời ORD-008 sang SMT-Line-B 14/05 08:00 → reason "Free capacity, no deadline conflict".
   - Đẩy ORD-002 (deadline ngày mai) lên slot 13/05 06:00 → reason "Deadline at risk".
7. Bấm **Áp dụng** lần lượt cho 4 gợi ý → toast success mỗi lần.
8. Chuyển tab **WIP Tracking**: SMT-Line-B utilization tăng từ 40% → 75% (xanh dương), ETA cho ORD-008 lúc 14/05 16:00.
9. Quay lại tab **Order List** lọc Status = *Planned* → bảng cập nhật ngày scheduled mới của 4 đơn.
