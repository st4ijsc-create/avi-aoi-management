# Phạm vi GHI của TOOL do AI đề xuất (`aiLocalTools/writeHandlers`) — ĐO, chưa vá (kiểm định, 2026-10-25)

## 1. Đường đi và chỗ thiếu cổng
`executeDecision` (aiLocalTools/index.ts) → tool GHI **không chạy ngay** → `proposeAction` (aiCopilotActions.ts:280, **RBAC gate #1**: `checkPermission(user, module, action)`) → hàng `ai_pending_actions` →
người bấm duyệt → `confirmAction` (aiCopilotActions.ts:840, kiểm `row.userId === user.id`, token, **RBAC gate #2** lúc thực thi) → `tool.execute(params, ctx)`.
Cổng có: **quyền module** (2 lần), **chủ phiên**, HITL, audit. Cổng KHÔNG có: **phạm vi nhà máy** của thực thể mà tool nhận qua `machineId` / `productModelId` / `thresholdId` / `id` / `predictiveAlertId` …
(`grep -i "phamvi|scope|factory" writeHandlers/*.ts` → 0 cổng phạm vi; `scope` chỉ là tên trường dữ liệu).
⇒ người dùng nhà máy B có quyền module (ví dụ `machine_monitoring/canCreate`) nhờ AI ghi lên máy / sản phẩm / cảnh báo của nhà máy A **được thực thi**.

## 2. ĐO ĐỎ THẬT (`writeHandlers/phamViGhiToolDo.db.test.ts`, CSDL `_test`, đường THẬT propose → confirm → execute)
Người dùng kỹ sư B (đủ quyền module, được gán CHỈ nhà máy B); đối chứng = người dùng A ghi lên thực thể A (xanh, chứng minh cầu nối đúng).
| Tool | Ca xuyên nhà máy (B → A) | Kết quả đo |
|---|---|---|
| `create_maintenance_workorder` (machineId) | B nhờ AI tạo lệnh bảo trì cho máy A | **ĐỎ**: `maintenance_work_orders` có 1 hàng cho máy A (kỳ vọng 0) |
| `update_product_quality_target` (productModelId) | B đổi mục tiêu yield của sản phẩm chỉ gắn nhà máy A (97,5 → 50) | **ĐỎ**: `targetYieldRate = 50` |
| `acknowledge_predictive_alert` (predictiveAlertId) | B xác nhận cảnh báo dự đoán của máy A | **ĐỎ**: `status = ACKNOWLEDGED` (kỳ vọng ACTIVE) |
Giữ bằng `it.fails` (lưới xanh khi lỗ còn; vá xong `it.fails` ĐỎ ⇒ gỡ). `PHAMVI_GHI_DO=1` chạy như test thường để thấy ĐỎ nguyên văn.
Ghi chú: `update_measurement_point` bị chặn bởi cổng GOVERNANCE ngưỡng (`bi_tu_choi_ghi`) chứ không phải phạm vi — không chọn làm ca đỏ.

## 3. Bảng 31 tool GHI đã đăng ký
Cột "Phạm vi?" = có kiểm phạm vi nhà máy ở propose/execute: **KHÔNG** cho tất cả.
| Nhóm | Tool | Quyền module | Khoá định danh nhận được | Vùng ghi |
|---|---|---|---|---|
| Cảnh báo | `acknowledge_alert` | mqtt_alerts:canEdit | id, alertSettingId | cài đặt / lịch sử cảnh báo MQTT |
| Cảnh báo | `acknowledge_predictive_alert`, `resolve_predictive_alert` | analytics_predictive_alerts:canEdit | predictiveAlertId | `predictive_alerts` (máy / nhà máy) — **ĐỎ đã đo** |
| Điểm đo | `create_measurement_point` | settings_measurement_points:canCreate | productModelId | `measurement_point_defs` |
| Điểm đo | `update_measurement_point` | …:canEdit | id | giới hạn / đơn vị điểm đo (qua governance ngưỡng) |
| Điểm đo | `set_spec_limits` | …:canEdit | measurementPointDefId | USL / LSL / target |
| Ngưỡng | `set_yield_threshold` | settings_yield_thresholds:canEdit | thresholdId, scope | ngưỡng yield |
| Ngưỡng | `adjust_ng_threshold`, `configure_inspection_param` | settings_alerts:canEdit | thresholdId | ngưỡng NG / tham số kiểm tra |
| Ngưỡng | `create_ng_threshold` | settings_alerts:canCreate | stationId, machineId, measurementPointId, productModelId | ngưỡng NG mới |
| Ngưỡng | `request_threshold_review` | settings_alerts:canCreate | machineId, pointDefId | yêu cầu duyệt ngưỡng |
| Sản phẩm | `update_product_quality_target` | settings_products:canEdit | productModelId | mục tiêu yield — **ĐỎ đã đo** |
| Bảo trì | `create_maintenance_workorder` | machine_monitoring:canCreate | machineId (+assignedTo) | `maintenance_work_orders` — **ĐỎ đã đo** |
| Phân tích | `run_rca_analysis` | analytics_root_cause:canCreate | machineId | `root_cause_analysis` (gộp dữ liệu quét) |
| An toàn | `propose_interlock_rule` | interlock:canCreate | lineId, stationId, machineId | luật interlock (luôn tắt / chưa duyệt) |
| Điều khiển OT ×10 | `machine_start/stop/pause/reset`, `select_recipe`, `download_job`, `set_machine_param`, `acknowledge_machine_alarm`, `reject_divert`, `spi_printer_offset` | machine_control:canCreate/canEdit | machineId, tagKey, … | lệnh OT qua `runDispatch` — **đi qua `aiControlGate` (L-7) + `AI_OT_CONTROL_ENABLED` (đang TẮT) + `otWriteBinding` (băm lệnh)**; KHÔNG đo, KHÔNG đụng |
| Repo ×6 | `write_project_file`, `run_command`, `apply_diff`, `apply_diff_batch`, `delete_file`, `rename_file` | ai_repo_*:… / machine_monitoring:canEdit | path / command | gốc dự án — `projectId` phân giải qua DANH SÁCH TRẮNG THEO NGƯỜI GỌI (doc 79 trục 2); không phải dữ liệu nhà máy |

## 4. Đề xuất CỔNG CHUNG (chưa làm — chờ duyệt bảng)
Một hàm `kiemPhamViGhiTool(toolName, params, user)` ở `aiLocalTools/phamViGhi.ts`, gọi ở **đúng hai chỗ đã có RBAC**: `proposeAction` (trước khi lưu `proposed` ⇒ người dùng nhận từ chối ngay, cùng dạng `denied` / `reason: OUT_OF_SCOPE`) và `confirmAction` (kiểm LẠI lúc thực thi — phạm vi / gán nhà máy có thể đổi giữa hai lần bấm; chống TOCTOU).
Bảng quy tắc theo tool (khoá → loại thực thể), dùng lại hàm đã có: machineId → `mayTrongPhamVi`; line/station/factory → `ghiViTri` (`_viTriPhamVi`); productModelId → `sanPhamGhiTrongPhamVi`; measurementPointDefId / id điểm đo → `diemDoGhiTrongPhamVi`; predictiveAlertId → `canhBaoDuDoanGhi`; thresholdId → ngưỡng → máy / trạm / sản phẩm của nó; alert MQTT → luật toàn cục (miễn trừ).
- Tool OT: giữ NGUYÊN `aiControlGate` + `AI_OT_CONTROL_ENABLED`; cổng mới chỉ THÊM kiểm máy (không thay).
- Tool repo: không áp (đã có danh sách trắng theo người gọi).
- Thiết kế cổng như `argsWithAuthCtx`: một điểm, danh sách tool khai báo trong bảng; **tool GHI mới chưa có dòng trong bảng ⇒ census đỏ** (canh bằng `registerTool` + bảng `KHOA_PHAM_VI_TOOL`).
- Người toàn quyền (admin) ⇒ bỏ qua; ngoài phạm vi ≡ `denied` (không lộ sự tồn tại).
