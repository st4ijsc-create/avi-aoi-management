# P-S1b — Census điểm phát socket & chuyển sang phát theo PHÒNG NHÀ MÁY (2026-10-23)

**Vấn đề.** Phần lớn sự kiện máy được phát `io.to("global").emit(...)` hoặc `io.emit(...)`. Mọi client trình duyệt đều ở `global` (kể cả `subscribe {}`) ⇒ người dùng nhà máy B nhận sự kiện của máy nhà máy A. Vá cổng *vào phòng* (`subscribe`, commit `d5ac42c19`) chưa đủ: lỗ ở tầng *phát*. Đã đo bằng `socketPhamViPhong.db.test.ts` (ca `it.fails` cũ: B nhận `andon:event` của A).

**Giải pháp.** `server/_core/socketPhatTheoNhaMay.ts` — `phatTheoNhaMay(io, tên, payload, phạmViSựKiện, phòngPhụ)`:
- socket NGƯỜI DÙNG tự vào phòng theo phạm vi **ngay khi kết nối** (`tuDongVaoPhongPhamVi`): `scope:all` (toàn quyền) hoặc `factory:{id}` cho mọi nhà máy trong phạm vi (cùng `idsTrongPhamVi` mọi router dùng). **Không cần sửa client** — trang nào đang nghe vẫn nhận như trước;
- điểm phát: đồng bộ vào `scope:all` + phòng phụ (`machine:`/`line:`), rồi bất đồng bộ vào `factory:{fid}` (loại trừ phòng đã nhận ⇒ mỗi socket đúng MỘT bản);
- nhà máy của sự kiện tra theo thứ tự `factoryId → machineId → machineCode → robotId → stationId → lineId → workshopId` (cache 5 phút; không tìm thấy cache 10 s);
- **tra không ra ⇒ KHÔNG phát vào `global`**: chỉ toàn quyền + phòng phụ, cảnh báo gộp (1 dòng/60 s/sự kiện) và đếm (`thongKePhat()`).

## Bảng census (TRƯỚC khi sửa) → xử lý

| Sự kiện | Nơi phát | Payload mang | Trang đang nghe | Sau P-S1b |
|---|---|---|---|---|
| `machine:status_update` | `socket.ts` heartbeat | machineId | MachineMapping, FactoryCommandView, UnifiedDeviceMonitor | `phatTheoNhaMay({machineId})` |
| `machine:status_change` | `socket.ts` ×3 (offline/online/syncing) + `machinePresenceService` (`io.emit` tới MỌI socket, cả socket máy/vô danh) | machineCode (+machineId ở presence) | TodayBriefing, AndonBoard, Dashboard | `phatTheoNhaMay({machineId, machineCode})` |
| `ecosystem:event`, `alerts:stream` | `broadcastEcosystemEvent` | `evt.scope` {factoryId, lineId, machineId, stationId?} | useEcosystemEvents, OEEDashboard, WarRoom / useRealtimeDashboard, CommandCenter | `phatTheoNhaMay(evt.scope)` + phòng line/machine |
| `inspection:alert` | `emitInspectionAlert` | machineId, machineCode | AIActionInbox, TodayBriefing, useRealtimeDashboard, useSocket, Dashboard | `phatTheoNhaMay({machineId, machineCode})` |
| `oee:update` (mảng MỌI máy) | `startOeeBroadcaster` | metrics[].machineId | Dashboard | `phatMangTheoNhaMay`: toàn quyền nhận đủ; mỗi nhà máy chỉ phần của mình |
| `oee:update` (một máy) | `calculateOEE` | machineId | Dashboard | `phatTheoNhaMay({machineId})` |
| `dashboard:update` | `emitDashboardUpdate` | machineId?, lineId?, stationId? | useRealtimeDashboard, useSocket, AndonBoard, Dashboard | `phatTheoNhaMay` |
| `machine:model_available` | `emitMachineModelAvailable` | machineId? | (không trang) | `phatTheoNhaMay` |
| `spc:violation` | `emitSpcViolationAlert` | machineId?, machineCode? | useSpcAlertToast, QualityCockpit | `phatTheoNhaMay` |
| `andon:event` | `emitAndonEvent` | machineId?, lineId?, stationId? | AIActionInbox, TodayBriefing, DaiCanhBao, NganXuLy, AndonBoard, Dashboard, OpsConsole, TwinVanHanh | `phatTheoNhaMay` + phòng line/machine |
| `safety:event` | `emitSafetyEvent` | robotId?, lineId?, stationId? | SafetyWorkforce | `phatTheoNhaMay({robotId, lineId, stationId})` (robot tra qua chuyền/trạm) |
| `alert:escalation` | `emitAlertEscalation` | machineId? | (không trang) | `phatTheoNhaMay` |
| `mqtt:message` | `emitMqttMessage` | machineCode? | MqttDashboard, MQTTReplay | `phatTheoNhaMay({machineId?, machineCode})` |
| `downtime:start/end` | `startDowntime`/`endDowntime` (`socket.ts`) + `downtimeDetectionService` | machineId | (không trang) | `phatTheoNhaMay({machineId})` |
| `maintenance:alert` | `calculateMachineHealth` | machineId | (không trang) | `phatTheoNhaMay({machineId})` |
| `telemetry:sample` | `doEmitTelemetrySamples` | machineId | MachineCockpit, UnifiedDeviceMonitor, DeviceOnboardingWizard | KHÔNG đổi (phòng `machine:`/`telemetry:all` đã có cổng ở `subscribe`) |
| `twin:update` | `phatTwinUpdateTheoPhamVi` | stationId | useTwinStream, khoTrangThai | KHÔNG đổi (đã lọc từng socket; vẫn dùng membership `global`) |
| `site:update` | `emitSiteUpdate` | siteCode | FederationDashboard | KHÔNG đổi (phòng `site:`/`sites:global`, cấp site — miễn có lý do ở census join) |
| `machine:*` tới `admin` | `socket.ts`, `offlineMonitor.ts` | — | admin | KHÔNG đổi (phòng `admin` có cổng `duocQuanLyDangKyMay`) |
| `notification:*` | `notificationService` | — | NotificationCenter | KHÔNG đổi (phòng `user:{id}` của chính người dùng) |

Phòng `scada:*` **không đụng** (phiên scada-master đang thiết kế).

## Lưới canh

- `socketPhatCensus.test.ts` (AST toàn `server/**`): cấm `io.emit` / `.to("global")` / `.in("global")` / `socket.broadcast.emit` / mảng phòng có `global` — chỉ miễn kèm lý do (danh sách miễn hiện **rỗng**); bộ phát theo nhà máy không được chứa chuỗi `"global"`; đột biến bốn dạng.
- `socketPhamViPhong.db.test.ts` (socket.io thật + CSDL `_test` thật, người dùng A/B/A+B/admin/không-gán + socket máy): với mỗi sự kiện — A, A+B, admin nhận đúng MỘT bản; B, người không gán nhà máy, socket máy không nhận; sự kiện chỉ có stationId/lineId/robotId/machineCode vẫn tra ra; sự kiện tra không ra ⇒ chỉ admin nhận + bộ đếm tăng; OEE mảng tách theo nhà máy.
- Đột biến hành vi: bộ phát luôn phát vào `global` (14 ca đỏ); bỏ việc tự join phòng nhà máy (13 ca đỏ).

## Việc còn lại / lưu ý
- Phạm vi của socket tính **một lần lúc nối**: đổi gán nhà máy giữa phiên chỉ có hiệu lực khi nối lại (cùng hành vi các phòng `factory:` khác).
- Sự kiện mới thêm phải đi qua `phatTheoNhaMay`; census đỏ nếu quên.
