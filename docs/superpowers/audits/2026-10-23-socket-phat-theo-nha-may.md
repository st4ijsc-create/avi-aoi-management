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

### Cập nhật 4: rác `product_models` ở `_test` (cùng lớp lỗi rò của test)
Đo 2026-10-23: 6.480 model (6.110 sống), **1.357→6.081 sống thiếu biến thể BASE** (do tệp test tạo model bằng `createProductModel`/INSERT thô rồi bỏ đó; ca `doc55 PV0` đếm TOÀN BẢNG nên đỏ). Đo từng tệp (tổng/sống/mồ côi trước→sau một lần chạy): 28 tệp rò (8 INSERT thô + 20 `createProductModel`, +1…+4 mỗi lần). Đã sửa bằng `server/testing/modelSanPhamTest.ts` (`dangKyModelSanPhamTest(id)` → afterAll xoá hẳn model + BASE, FK chặn ⇒ xoá mềm): 28 tệp, mỗi tệp sau sửa Δ = 0, số ca xanh không đổi. `inspectionModelBackfill` còn lỗi CÓ SẴN: afterAll của chính nó chết ở `DELETE FROM product_inspections` (permission denied) nên không tới bước xoá model — helper dọn thay.
Ca PV0 không còn đếm toàn bảng: chạy chính câu backfill của `drizzle/0286` trong giao dịch hoàn tác và khẳng định trên các model do ca tự tạo (đột biến "backfill chỉ model đã xoá" ⇒ đỏ). Bất biến toàn bảng thuộc DEV/production.
Rác CŨ (hàng nghìn model test) CHƯA xoá — chờ duyệt số lượng + tiền tố.

### Cập nhật 5: vá lỗi sản phẩm — model mới luôn có BASE (doc55 PV0)
Gốc: sau backfill 0286, KHÔNG đường mã sản phẩm nào tạo BASE (`ensureBaseVariant` chỉ test gọi) ⇒ `productModel.create` & mọi đường tạo model đều đẻ model mồ côi. Vá: `insertBaseVariantInTx(exec, id, version)` (server/db/product.ts, cùng định nghĩa với backfill 0286, bỏ qua nếu bảng `product_variants` chưa có) gọi TRONG CÙNG giao dịch ở: `createProductModel` (⇒ router `create`/`import`, dataRouters), `ensureSystemProductModel`, `cloneProductModel`, `importProductPackage`, PLM `upsertProduct`, dữ liệu mẫu `statistics.ts`. Census `productModelCreationCensus.test.ts` (AST) bắt đường mới thiếu BASE. Chưa vá: `scripts/sim-factory/seed-production.mjs` (INSERT thô, script seed) và migration 0131 (có trước 0286, đã được backfill). Script kiểm CHỈ ĐỌC: `scripts/kiem-bat-bien-product-models.mjs`.

### Cập nhật 6: xoá mềm rác `product_models` ở `_test` + backlog
- XOÁ MỀM (đã duyệt) 5.466 model, đúng số dự kiến (lệch 0,00 %), chỉ `aoi_management_test`, theo 11 lô ≤500: sống 6.145 → 679, sống-thiếu-BASE 6.082 → 616 (616 mẫu lẻ không truy được nguồn: KHÔNG đụng), tổng hàng 6.520 không đổi (xoá mềm). Danh sách id + code: `docs/superpowers/audits/2026-10-23-xoa-mem-product-models-test.ids.txt`. Đảo ngược: `UPDATE product_models SET "deletedAt"=NULL WHERE id IN (<cột 1 của tệp>)`.
- `scripts/sim-factory/seed-production.mjs` nay tạo BASE cho model SIM (idempotent). Census AST chỉ phủ `.ts/.tsx`; script `.mjs` dùng SQL thô nên KHÔNG phủ (đánh giá: không đáng mở rộng — ít script seed, mỗi cái đã tự tạo BASE).
- BACKLOG: (1) DEV `aoi_management` còn 1 model sống thiếu BASE (`T12-SHOT-mtlt8goc8429`) — chưa sửa theo chỉ đạo; chạy `node scripts/kiem-bat-bien-product-models.mjs`. (2) `server/inspectionModelBackfill.test.ts`: afterAll chết ở `DELETE FROM product_inspections` ("permission denied", vai DB của test) nên không tới bước xoá model — helper dọn thay. (3) `server/db/productClone.db.test.ts`: beforeAll "must be owner of table product_models" — lỗi quyền vai DB của test, cả 5 ca bị bỏ qua. (4) Còn ~616 model mồ côi mẫu lẻ (tiền tố `P*-R*Bms*`, `T*-T*m…`, `OP*`/`WB*` không truy được) ở `_test`.

### Cập nhật 7: hai lỗi quyền của test — đã sửa (chỉ tệp test, không đổi GRANT)
- `productClone.db`: nguyên nhân = beforeAll chạy lại `drizzle/0197` (ALTER TABLE … ADD COLUMN IF NOT EXISTS) bằng vai ứng dụng, vốn không phải owner ⇒ "must be owner of table product_models" ⇒ cả 5 ca bị BỎ QUA (tệp không kiểm gì). Sửa: `ensure0197` chỉ áp khi cột/chỉ mục còn thiếu và áp bằng kết nối owner (MIGRATION_DB_USER/PASSWORD, như script migration); đủ rồi thì không đụng DDL. Trước: 0 chạy / 5 bỏ qua; sau: 5 chạy / 0 bỏ qua.
- `inspectionModelBackfill` + `productClone` afterAll: nguyên nhân = `product_inspections` là sổ WORM (mig 0279 REVOKE DELETE khỏi `avi_app`) nên `DELETE FROM product_inspections` bị "permission denied" và làm chết cả afterAll. Sửa: bỏ lệnh xoá WORM, từng lệnh dọn còn lại chạy riêng (`be()` nuốt đúng permission-denied / FK), model đăng ký helper để xoá mềm khi FK chặn. KHÔNG nới quyền WORM. Hệ quả cố hữu: mỗi lượt chạy để lại các hàng `product_inspections` (+ máy/trạm/chuyền/xưởng/nhà máy trỏ tới chúng) — không xoá được theo thiết kế; muốn hết tích luỹ phải dùng một fixture topology CỐ ĐỊNH dùng lại giữa các lượt (việc riêng).

### Cập nhật 8: cạn kết nối Postgres khi chạy song song (chỉ đổi cấu hình test)
Đo (cụm PG :5434 CHUNG _test + DEV, `max_connections`=100, 3 dành cho superuser ⇒ dùng được 97; :3000/dev server giữ ~22 khi nghỉ): `vitest run server/services/edge server/db` với 23 worker mặc định ⇒ ĐỈNH 96/97, trong đó `aoi_management_test|avi_app|postgres.js` = **73** (pool của chính test), dev 23, `stopAckLockOrder` 4, notify 3. Mỗi worker mở pool app 25 + jobs 8 + đọc 15 dù mỗi tệp chỉ cần vài truy vấn.
Sửa (không đổi PG, không đổi mã sản phẩm): `vitest.setup.ts` đặt `DB_POOL_MAX=4`, `DB_POOL_MAX_JOBS=2`, `DB_POOL_MAX_READ=2` (??=, tệp nào cần trần khác tự đặt); `vitest.config.ts` `poolOptions.forks {minForks:1, maxForks: VITEST_MAX_FORKS || 10}` (vitest.db/serial.config kế thừa qua mergeConfig; nhóm DB vốn đã tuần tự). Helper dọn đã dùng `getDb()` sẵn có (không mở kết nối mới). Kết quả: đỉnh 96 → pool-env-only 85 → +10 worker **51** (test 31+4+2). Thời gian cả nhóm: trước 87 s (một lần đo; 77 s khi chỉ hạ pool), sau 85–97 s (10 lần, TB ≈ 89 s) — chậm ≤ ~10 %. 10/10 lần: 0 lỗi "connection slots".
Còn đỏ KHÔNG liên quan kết nối (đã lộ ra khi hết nhiễu "slots"): `twinAnToanRobot.db` (1 ca, 10/10: "KHÔNG được còn hàng estop sót lại từ ca dương: expected 3 to be undefined" — rác estop tồn từ các lượt trước ở bảng dùng chung) và `naiveTimestampQuaExecute.db` (2/10: "đếm machine_status_logs trước = sau: 4179 vs 4177" — đếm TOÀN BẢNG trên CSDL dùng chung, cùng lớp lỗi với ca PV0 cũ).

### Cập nhật 9: hai ca đếm toàn bảng trên CSDL dùng chung
- `naiveTimestampQuaExecute.db`: bỏ đếm TOÀN BẢNG `machine_status_logs`/`machine_heartbeats`/`robot_telemetry` trước=sau (lệch 4179 vs 4177 khi phiên khác ghi); nay chỉ khẳng định hàng CỦA CHÍNH file (theo id đã chèn) đã bị xoá. Đột biến bỏ lệnh xoá ⇒ đỏ.
- `twinAnToanRobot.db`: ca "ĐỐI CHIẾU TỔNG" đếm phân bố `robots.status` toàn bảng và đòi không còn estop ⇒ đỏ 10/10 vì rác của test khác. Nay chỉ khẳng định robot đã mượn về đúng trạng thái gốc; các ca âm/dương/khôi phục cũng chỉ nói về robot mượn/robot không-estop, không về "cả nhà máy". Đột biến bỏ khôi phục ⇒ 3 ca đỏ.
- Rác estop tồn ở `_test` (CHƯA xoá): 3 robot `status='estop'` — `RB-F1X-1791873286479` (id 9035, 2026-10-12; nguồn `edgeAttack.dot10.e2e.db.test.ts`, bộ e2e loại khỏi lưới thường), `RA-B10ING-1792572279240` (id 28542) và `RA-B10ING-1792572286786` (id 28544) (2026-10-21; nguồn `edgeIngest.dot10.db.test.ts` — ca đặt estop rồi để lại ở các lượt cũ; bản hiện tại chạy 3 lần không thêm hàng nào). Cả ba đang bật (`isEnabled`), nằm ở chuyền/trạm riêng của test.

Cập nhật 9b (sau review): `twinAnToanRobot.db` KHÔNG còn "mượn" robot dùng chung (race giữa hai worker/phiên, kẹt estop nếu tiến trình chết). Ca tự tạo nhà máy/xưởng/chuyền/trạm + 3 robot RIÊNG (tiền tố `ZZTAR-<RUN>`: A idle không telemetry, B idle không telemetry, C online có telemetry) và đo trong nhà máy riêng đó; afterAll xoá cứng, FK/WORM chặn ⇒ `status=offline` + `isEnabled=false`. Giữ mọi khẳng định cũ (âm, dương+khôi phục, đối chiếu SQL thô, khong_ro, isEnabled=false, phạm vi). Đột biến: bỏ khôi phục ⇒ 4 ca đỏ; `estop ?? false` ở twinCanh ⇒ ca khong_ro đỏ; bỏ lọc `isEnabled` ⇒ ca vô hiệu hoá đỏ (đều đã khôi phục). BACKLOG — rác estop GIỮ NGUYÊN theo chỉ đạo (không ca nào còn phụ thuộc, có thể là chứng cứ của bộ e2e): robots id 9035 (`RB-F1X-1791873286479`, nguồn edgeAttack.dot10.e2e), 28542 và 28544 (`RA-B10ING-1792572279240` / `…286786`, nguồn edgeIngest.dot10).

### Backlog (ưu tiên thấp, CHƯA làm): test ghi `machines.lastHeartbeat` của máy sim dùng chung 1/2
Điều tra 2026-10-23: không có tiến trình nền nào ghi (0 backend trên `aoi_management_test` khi rảnh; tuổi nhịp tim tăng đúng 20 s/20 s). Nhịp tim máy 1 (`SIM-L1-SPI`) và 2 (`SIM-L1-AOI`) chỉ đổi khi ai đó chạy test: bisect từng tệp `server/db` ra đúng `capComponentGhiThat.db.test.ts`, `cayDayChieuMay.db.test.ts`, `cayDayGhiThat.db.test.ts`; nhóm `server/routers` cũng làm đổi (chưa bisect từng tệp). Hướng sửa sau này: cho các tệp này dùng MÁY RIÊNG mang tiền tố của tệp (như ca (4b) của naiveTimestampQuaExecute nay làm) để không chạm máy sim dùng chung.
