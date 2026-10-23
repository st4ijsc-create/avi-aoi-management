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
| `machine:offline_alert` | `offlineMonitor.ts` (mỗi 60 s) | machineId, machineCode | **KHÔNG client nào nghe** (grep `client/src` = 0) | H1b: phát MỘT lần mỗi ĐỢT offline (`log.id`), độc lập với việc gửi thông báo; theo `phatTheoNhaMay` (phòng nhà máy) thay vì `admin`. Lý do GIỮ thay vì bỏ: rẻ khi chỉ phát một lần, và là tín hiệu máy mất kết nối cho người trong nhà máy; nếu sau này xác nhận không ai dùng thì bỏ hẳn (một dòng). Trước: 3.400 tin / 75 s vì thông báo chưa cấu hình ⇒ không máy nào được đánh dấu đã gửi ⇒ phát lại mỗi chu kỳ |
| `machine:*` tới `admin` (còn lại) | `socket.ts` | — | admin | KHÔNG đổi (phòng `admin` có cổng `duocQuanLyDangKyMay`) |
| `notification:*` | `notificationService` | — | NotificationCenter | KHÔNG đổi (phòng `user:{id}` của chính người dùng) |

Phòng `scada:*` **không đụng** (phiên scada-master đang thiết kế).

## Lưới canh

- `socketPhatCensus.test.ts` (AST toàn `server/**`): cấm `io.emit` / `.to("global")` / `.in("global")` / `socket.broadcast.emit` / mảng phòng có `global` — chỉ miễn kèm lý do (danh sách miễn hiện **rỗng**); bộ phát theo nhà máy không được chứa chuỗi `"global"`; đột biến bốn dạng.
- `socketPhamViPhong.db.test.ts` (socket.io thật + CSDL `_test` thật, người dùng A/B/A+B/admin/không-gán + socket máy): với mỗi sự kiện — A, A+B, admin nhận đúng MỘT bản; B, người không gán nhà máy, socket máy không nhận; sự kiện chỉ có stationId/lineId/robotId/machineCode vẫn tra ra; sự kiện tra không ra ⇒ chỉ admin nhận + bộ đếm tăng; OEE mảng tách theo nhà máy.
- Đột biến hành vi: bộ phát luôn phát vào `global` (14 ca đỏ); bỏ việc tự join phòng nhà máy (13 ca đỏ).

## Việc còn lại / lưu ý
- Phạm vi của socket tính **một lần lúc nối**: đổi gán nhà máy giữa phiên chỉ có hiệu lực khi nối lại (cùng hành vi các phòng `factory:` khác).
- Sự kiện mới thêm phải đi qua `phatTheoNhaMay`; census đỏ nếu quên.

## Backlog (giao kiem-dinh): test tạo người dùng admin/supervisor giả mà KHÔNG dọn — nhân hàng thông báo
Đo ở `aoi_management_test` (2026-10-23): 5.196 người dùng (5.001 hoạt động), trong đó **1.951 admin/supervisor hoạt động**. Mỗi quét "lệch nhà máy" (và mọi cảnh báo gửi cho "mọi admin/supervisor") nhân hàng thông báo theo số người này (hậu quả: 1,86 triệu hàng `notifications`, instance e2e đăng nhập treo 40–60 s — đã chữa gốc ở `criticalStopAlert.khuTrungBenVung`, nhưng người dùng giả vẫn còn).

| Tiền tố `openId` | Số admin/supervisor | Test tạo (không có xoá người dùng / `afterAll` dọn) |
|---|---|---|
| `__r…` | 281 | `edgeHumanResolverAuth.dot10`, `edgeStopOwnerRace.dot10`, `otIntentResolve.dot10` (…`.db.test.ts`), `sessionGrantScan.test.ts` |
| `acs_admin_…` | 228 | `server/_core/accessControlScope.test.ts` (0 xoá, 0 `afterAll`) |
| `res_admin_…` | 194 | chưa truy được test nguồn (tiền tố `res`) |
| `rss_admin_…` | 180 | `server/routers/reportServiceScope.test.ts` (0 xoá, 0 `afterAll`) |
| `ss_admin_…` | 175 | chưa truy được test nguồn |
| `hms_admin_…` | 169 | `server/routers/defectHeatmapSavedScope.test.ts` (0 xoá, 0 `afterAll`) |
| `scp_hm_admin_…` | 132 | `server/services/defectSpatialHeatmap.scope.test.ts` (`mkUser` không dọn) |
| `cds_admin_…` | 115 | `server/db/statisticsDailyScope.test.ts` (0 xoá, 0 `afterAll`) |
| `__lo…` / `__sw…` | 106 / 69 | `stopAckLockOrder.dot11.db.test.ts` / `centralStopSweepLockOrder.dot11.db.test.ts` |

**Đề xuất fixture tự dọn:** một helper dùng chung `taoNguoiDungTest(tag, role)` (ví dụ `server/testing/nguoiDungTest.ts`) đăng ký `afterAll` xoá `user_factory_assignments`, `permissions`, `notifications`, `user_sessions` rồi `users` của chính các id nó tạo (fallback: `isActive=false` nếu FK chặn); census đọc mã nguồn test: gọi `INSERT INTO users` / `insert(users)` mà không qua helper ⇒ ĐỎ. Thêm kiểm CSDL ở cuối suite: số admin/supervisor hoạt động không tăng sau khi chạy `vitest run` (bắt rò). Việc dọn 1.951 người dùng hiện có KHÔNG làm ở đây (nhiều phiên dùng chung `_test`).

### Cập nhật (cùng ngày): helper + census ĐÃ làm
- `server/testing/nguoiDungTest.ts` — `taoNguoiDungTest(tag, role, {tienTo, ten, ts, extra})`; `afterAll` tự đăng ký, dọn `user_factory_assignments → permissions → notifications → user_sessions → user_secrets → users` đúng các id nó tạo; FK chặn ⇒ `isActive=false` + `console.warn` lý do.
- Truy nguồn: `res_admin_` = `reportExportScope.test.ts`, `ss_admin_` = `statisticsScope.test.ts` (cùng dạng `mkUser`). Bảy tệp (acs, rss, hms, scp_hm, cds, res, ss) đã chuyển.
- Census `nguoiDungTest.census.test.ts`: cấm `insert(users)`/`INSERT INTO users` trong test ngoài helper; hai danh sách miễn `TU_DON` (72, có tự xoá) và `CHUA_DON` (11, RÒ — còn việc: edge*.dot10/dot11, `centralStopSweepLockOrder`, `edge-node-credential.retire`), chỉ được giảm.
- Đo: `_test` trước/sau hai lần chạy bảy tệp liên tiếp = 5.196 / 5.001 hoạt động / 1.951 admin-supervisor — KHÔNG đổi. Đột biến (bỏ dọn) ⇒ +22 người dùng, +7 admin/supervisor (đã dọn đúng 22 người đó). 1.951 người dùng cũ KHÔNG bị đụng.

### Cập nhật 2 (cùng ngày): CHUA_DON → rỗng
Đo từng tệp trong 11 tệp (số người dùng `_test` trước/sau một lần chạy): chỉ **4 tệp thật sự rò** — `otIntentResultRace` (+3), `stopAckLockOrder` (+1), `centralStopSweepLockOrder` (+1), `edge-node-credential.retire.dot12` (+2) — đã chuyển sang `taoNguoiDungTest`. **7 tệp còn lại tạo người dùng TRONG giao dịch bị hoàn tác** (số không đổi) nên không rò và KHÔNG chuyển (helper chèn ở kết nối riêng, sẽ đổi điều các ca khoá/đua đang đo); chúng nằm ở danh sách `HOAN_TAC` của census (bắt buộc có dấu `Rollback`/`ROLLBACK`). `CHUA_DON = []`, phải giữ rỗng.
Tồn đọng không tránh được: `otIntentResultRace` tạo hàng ở bảng WORM `ot_write_late_result_reviews` (FK `reviewedBy`) nên 3 người dùng/lần chạy chỉ có thể bị đặt `isActive=false` (không xoá được) — không còn là người nhận cảnh báo, nhưng tổng hàng tăng 3/lần. Cách dứt điểm: cho ca đó chạy trong giao dịch hoàn tác (việc riêng).
Cập nhật 3: `otIntentResultRace` — phần xem xét (review) + đổi chủ SAU hai phiên nay chạy trong giao dịch hoàn tác (savepoint cho lệnh bị từ chối) ⇒ không còn hàng WORM `ot_write_late_result_reviews` ghim người dùng; đo: tổng người dùng `_test` giữ 5203 qua hai lần chạy (trước đây +3/lần). Helper thử lại tối đa 3 lần bước xoá users (phiên khác có thể chèn thông báo "mọi admin" giữa hai bước) rồi mới rơi về `isActive=false`.
