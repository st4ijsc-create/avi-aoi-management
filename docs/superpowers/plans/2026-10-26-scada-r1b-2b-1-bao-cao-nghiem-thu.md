# SCADA R1b-2b-1 · An toàn và nợ — Báo cáo nghiệm thu

> Khung do Task 2 tạo (§4 mục 2b + Phụ lục A), Task 5 / Task 8 bổ sung, Task 16 điền phần còn lại (2026-10-27, nhánh `feat/scada-r1b2b`,
> nền `20cf977b0`). §3 (bench OpenPLC, 3 lượt) và §5 (chạy toàn bộ) do bộ điều khiển chạy và điền (`236bb7da9`), mỗi lượt sau khi điều phối trả lời
> "OK chạy ngay". Sửa sau rà soát cuối toàn nhánh (2026-10-27): `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/final-fix-report.md`.
> `server/services/scada/lenhInterlockLechLuoi.baoCao.test.ts` so khối SQL §4 mục 2b với hằng `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` TỪNG KÝ TỰ — không ai
> được sửa khối đó (sửa hằng ⇒ sửa khối, và ngược lại).

## Kết luận ngắn

- **Lưới nghiệm thu** `server/services/scada/r1b2b1NghiemThu.db.test.ts` (opt-in `SCADA_R1B2B1_NGHIEM_THU=1`, `-c vitest.db.config.ts`): 14 ô của kế hoạch
  (P1, B1, B2, Q1, M1, C1, R1, E1, T1, L1, I1, A1, G3, G4) + C1 nhánh HA (phán quyết) + G3 ca (b) (T14 fix round) + L2 (T9 fix round) + R1-đc (ô đối
  chứng do T16 thêm) = 18 ca; bảng §1 có 16 hàng vì C1 và G3 mỗi hàng gồm hai ca. Đo T16 đầu: 17/18 mỗi lượt, R1-đc ĐỎ tất định ⇒ về
  Task 6. **Sau T6 fix round 1: 3 lượt tuần tự 18/18 xanh** (53,3 / 52,2 / 55,3 s), mong đợi của R1-đc KHÔNG đổi; ô R1 đổi số thô thiết bị 6 → 7 (§1, §6 LOGIC
  mục 1). Không đặt biến ⇒ 18/18 bị bỏ qua (đã chạy).
- **R1-đc (T16 → T6) đã sửa — T6 fix round 1:** so đọc lại ở không gian thô của T6 coi lượt ghi ĐÚNG là lệch trên driver THẬT, vì mọi driver
  (Modbus / SLMP / S7 / MC / EIP / OPC UA) trả giá trị kỹ thuật của tag int đã `Math.round(raw * scale + offset)` (thô 5 ở scale 0,5 ⇒ đọc 3 ⇒
  round(3/0,5) = 6 ≠ 5). Nay `readbackMatches` so với giá trị ĐỌC MÔ PHỎNG `scaleXuoi(inverseScale(e))` — `scaleXuoi` (`drivers/otScale.ts`) là MỘT
  nguồn mà đường đọc của cả 6 driver cũng gọi. Giới hạn còn lại: làm tròn có thể CHE số thô sai (scale 0,5: thô 6 cũng đọc 3) ⇒ R1b-2b-2 mục 64 (đọc
  lại THÔ thật). Chiều hỏng vẫn chỉ là NHÃN (không gửi lại, không chặn STOP).
- **Đột biến cấp hệ thống** (coil Modbus quay về `Boolean(w.value)`) ⇒ B1 ĐỎ; hoàn tác, `git diff` của tệp rỗng (§2).
- **Bench OpenPLC (§3) — ĐÃ chạy 3 lượt**, mỗi lượt điều phối duyệt: lượt 1 41/42 (B1b lượt 1 hết hạn 5124 ms, không ack giả ⇒ dẫn tới T17); lượt 2
  huỷ do chính kịch bản bench (không dữ liệu, kịch bản đã sửa `b473cf1e9`); lượt 3 61/66 với ô ĐỐI CHỨNG (proxy thông suốt) ĐỎ ⇒ theo luật đã thoả
  thuận, các hàng cắt liên kết KHÔNG đủ điều kiện làm bằng chứng — bằng chứng T17 là test tất định trong tiến trình + lưới T16 + đột biến (§8). Chỉ
  bench Modbus B1; không bench S7 / MC / EIP / SLMP / OPC UA.
- **Chạy toàn bộ (§5) — ĐÃ chạy** (HEAD `b473cf1e9`, 35751 ca): **0 đỏ thật, 1 đỏ do tải** (`rateLimitConfig.duPhongBoNho.test.ts` ca Redis khoẻ, chạy
  riêng 3/3 xanh ⇒ R1b-2b-2 mục 68; ngưỡng không nới). **Phần THIẾT BỊ ĐO đã sửa** (T14 load-robustness fix, 2026-10-27 — `task-14-report.md`): ca
  Redis khoẻ không còn phụ thuộc hạn 250 ms dưới tải; 6/6 xanh khi chạy riêng dưới tải ~100 % CPU. Mục 68 nay CHỈ còn hành vi sản phẩm.
- **Task 17 (bench B1b lượt 1: STOP `timeout ok=false` 5124 ms, coil 0 → 0):** lệnh ghi ĐANG BAY khi liên kết mất / phiên bị hạ bị mồ côi
  (`ModbusRTU.destroy()` huỷ hẹn giờ giao dịch mà không gọi callback) ⇒ dispatcher chỉ trả lời ở hạn 5000 ms. **Lỗi CÓ SẴN từ 1e0ae656c (2026-09-26), có
  trên main/:3000 hiện tại; R1b-2b-1 sửa** (điều phối 2026-10-27: Phương án A + nhãn (a) "không rõ kết cục"): mọi driver reject NGAY lệnh đang bay ở ba
  điểm (socket close/error · `disconnect()` · `connect()` trước khi đóng phiên cũ) bằng lỗi có kiểu `LoiMatLienKetKhiDangGui`; dispatcher ánh xạ sang
  CÙNG `timeout` (không rõ — lệnh có thể đã tới PLC; không bao giờ `failed`, không ack giả). Không thử lại, không trì hoãn gửi, không cổng nào trước STOP.
  Chi tiết + bảng driver: `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/task-17-report.md`.
- **R1b-2b-1 là điều kiện cần; bật `AI_OT_CONTROL_ENABLED` là quyết định của chủ dự án sau rà soát độc lập riêng**. Báo cáo này không ngụ ý gì khác:
  cờ giữ TẮT ở mọi nơi; lưới và bench đặt `"false"` chỉ trong tiến trình.

## 1. Ma trận ô — `server/services/scada/r1b2b1NghiemThu.db.test.ts`

Chạy: `SCADA_R1B2B1_NGHIEM_THU=1 npx vitest run -c vitest.db.config.ts server/services/scada/r1b2b1NghiemThu.db.test.ts` — 3 lượt tuần tự
(2026-10-27, `_test`, máy dev Windows, không tải song song). Thời gian theo lượt 1 / 2 / 3 (vitest). Mã fixture riêng `nt2b1<pid><ts>` (không
`r1b2` / `pvk` / `tth`), dọn ở `afterAll`: mỗi lượt in "còn lại adapter 0, máy 0, nhà máy 0".

| Ô | Task | Kích thích (đường THẬT) | Mong đợi đã kiểm | Lượt 1 / 2 / 3 |
|---|---|---|---|---|
| P1 | T1 | `appRouter` THẬT; operator có `machine_control.canEdit`, cờ buộc đổi BẬT (hai mốc trên `users`): `mayDungKhanCap` rồi `dungMay`; `viewer` cùng cờ; `scadaKenh.cheDo.danhSach` | máy P trong danh sách (`coDung` true, `soAdapter` 1, `tongHop` "du"), mọi máy ⊆ nhà máy A, máy B vắng, JSON không lộ endpoint / lastError / stopValue / tagKey; `dungMay` ⇒ `acked_verified`, driver nhận đúng `[{stop_cmd:true}]`, ĐÚNG 1 audit `scada_hmi_stop_buoc_doi_mat_khau` (khớp `clientRequestId`); viewer ⇒ `{may:[], biCat:false}`; `cheDo.danhSach` ⇒ `FORBIDDEN / MUST_CHANGE_PASSWORD` | ✓ 535 / 509 / 472 ms |
| B1 | T2 + T6 | "dispatch AI" = `dispatch()` THẬT với dòng chờ AI ĐÃ XÁC NHẬN (tool `set_machine_param`, kind `hitl`) — đúng nguồn của test DB T2; `AI_OT_CONTROL_ENABLED="false"` (cổng AI ở tầng tool, `dispatch()` không đọc cờ). `ModbusDriver` THẬT trên thiết bị RAM, đọc lại BẬT | `"false"` / `"0"` lên bool CHƯA khai `coil:7` ⇒ `writeCoil(6, false)`, `acked_verified`; `"off"` / `2` ⇒ `rejected TYPE_MISMATCH` + appError `SCADA_VALUE_TYPE_MISMATCH {dataType:"bool"}`, thiết bị 0 lượt chạm (ghi lẫn đọc); **1c**: ghim STOP `1` và ghim cũ `255` trên `coil:8` kiểu INT ⇒ `writeCoil(7, true)`, `pinnedStop`, `acked_verified` (T6: lớp bit so theo bool); `2` không-STOP lên coil INT ⇒ `rejected TYPE_MISMATCH` SỚM (T2 fix round), 0 lượt | ✓ 520 / 470 / 441 ms |
| B2 | T2 | luật interlock BẬT `reduce_speed` commandValue `"on"` (và `"false"` đối chứng) trên tag bool coil, ghi thẳng DB | `luatLenhLechLuoi` (JS) = [luật "on"] ⊆ `TRUY_VAN_TRUOC_TRIEN_KHAI` ∪ `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL`; SQL bool = [luật "on"], `KHONG_PARSE_DUOC`; "false" không ai báo | ✓ (< 300 ms) |
| Q1 | T3 | phiên OT THẬT (`startOt`, vòng poll chung, `S7Driver` THẬT, nodes7 giả qua `loadPackage`), tag string DUY NHẤT, thư viện trả `(false, {t:"BAD 12"})` | phiên `connected`, mọi mẫu `good` giá trị `"BAD 12"`, không `lost`; cùng chuỗi với `anythingBad=true` ⇒ mẫu `bad`, `value null` | ✓ (< 300 ms + phiên) |
| M1 | T4 | `MitsubishiMcDriver` THẬT, mcprotocol giả; thời gian TỈ LỆ `globalTimeout` 400 ms (≙ 4500): mọi item BAD sau 382 ms (≙ 4300) errCode `MC Error Response …`; rồi 409 ms (≙ 4600) errCode `MC_ERRCODE_QUA_HAN_GOI` | (a) đọc ≥ 90 % hạn gói, KHÔNG ném, mọi mẫu `device_error`, tick `ok` + `laDocTot` + không `laTickHong`, `isConnected`, STOP ghim (`dungGhim`) ghi được (`writeItems` 1 lần, ok); (b) ném `McReadTimeoutError` (mất liên lạc) | ✓ 1206 / 1225 / 1212 ms |
| C1 | T5 | phiên S7 THẬT mà MỌI địa chỉ sai (`XYZ`, `DB1,QQQ9`), nhánh **legacy** và **HA** (ConnectionSupervisor thật), chu kỳ 300 ms, hạn nối lại 1 s / 0,5 s | sau ≥ 3 lượt đọc: `connecting` + lý do `moi_tag_sai_cau_hinh`; thêm 2,5 s vẫn thế; không `lost`, không `connected`, `initiateConnection` đúng 1 lần, driver tạo 1 (legacy) / 2 (HA: fixture + supervisor), `readAllItems` 0 lần | ✓ legacy 3178 / 3193 / 3190; HA 3175 / 3203 / 3198 ms |
| R1 | T6 | `dispatch()` AI, `ModbusDriver` THẬT; tag int `holding:10` scale 0,5; ghi 2,5; thiết bị trả thô 7 (driver đọc round(3,5) = 4 ≠ 3). T6 fix round 1: thô 6 → 7 — thô 6 đọc round(3,0) = 3 = đọc của thô 5, KHÔNG phân biệt được khi chưa có đọc lại thô (mục 64) | `writeRegister(9, 5)`; `acked_unverified` | ✓ < 300 ms, 3 lượt (fix round 1) |
| **R1-đc** | T6 | như R1 nhưng thiết bị giữ ĐÚNG thô vừa ghi (scale 0,5: 2,5 ⇒ 5; scale 0,1 `holding:11`: 2,3 ⇒ 23) | `acked_verified` cả hai | T16 đầu: ✗ 219 / 271 / 284 ms (`acked_unverified` cả hai, thô đã đúng `writeRegister(9,5)`, `writeRegister(10,23)`) ⇒ về T6. **Sau T6 fix round 1: ✓ < 300 ms, 3 lượt** (mong đợi không đổi) |
| E1 | T7 | `EthernetIpDriver` THẬT, Controller giả phát `'error'` 5 ms sau khi bắt đầu connect (connect không bao giờ xong); `SlmpDriver` THẬT socket giả: giao dịch A hết hạn, callback ghi MUỘN (lỗi) của A tới khi B đang chờ | 0 `uncaughtException` / `unhandledRejection`; connect hết hạn, `lastError` là chuỗi, `timeout_sp` = 60; B nhận đúng khung trả lời | ✓ (< 300 ms) |
| T1 | T8 | adapter stub THẬT trong DB, `startOt` THẬT, ghi trạng thái DB THẬT (điều tiết 5 s); `stopOt({ tatTienTrinh: true })` | DB `connected` → giữ `connected` sau 7 s (RAM `disabled`); đối chứng: `startOt` lại rồi `stopOt()` trần ⇒ DB `disabled` | ✓ 17629 / 17692 / 17504 ms |
| L1 | T9 | sổ chậm 5 s = bão hoà POOL CỦA CHÍNH tiến trình bằng khoá tư vấn (điều kiện 2 / C14, không `LOCK TABLE`), rào ngay sau `loadStopPinsHmi` thật; máy CHƯA ghim | `CHUA_GHIM_STOP` sau ≥ 495 ms (lượt sổ chạm hạn thật) và < 1200 + `batDauDoLag().dung(1200)`; log `attempts_hmi_stop_chua_ghim_qua_han`; dispatch 0; lúc trả lời dòng attempts CHƯA có | ✓ trôi 557 / 576 / 587 ms (nới 331 / 375 / 300) |
| L2 | T9 fix round | CHỈ INSERT `scada_command_attempts` chờ khoá tư vấn (pool 12 của tiến trình); bấm STOP máy G 12 lần (TRẦN + 4) | mỗi lần `acked_verified`; lượt sổ treo tối đa ĐÚNG 8 (= `TRAN_GHI_SO_TREO_STOP_HMI`), Postgres xác nhận 8 backend chờ (sau 200 ms vẫn 8); 4 log `attempts_hmi_stop_bo_qua_day` mang nội dung dòng; máy G2 vẫn `acked_verified` < 1700 + lag | ✓ G2 trôi 107 / 104 / 115 ms; ca 5968 / 5879 / 5961 ms |
| I1 | T10 | 5 thủ tục interlock THẬT (create / update / delete / enable / disable), kỹ sư CHỈ gán nhà máy A; giao dịch "người đổi máy" THẬT khoá adapter FOR UPDATE, thủ tục bị chặn (đo `pg_blocking_pids`), đổi máy sang nhà máy B rồi commit | mỗi thủ tục `NOT_FOUND / ENTITY_NOT_FOUND {entity:"interlockRule"}`; 0 luật tạo, mô tả / đích / `enabled` không đổi, luật còn; 0 audit của kỹ sư; đối chứng dương (đổi máy CÙNG nhà máy) ⇒ tạo được | ✓ 308 / 354 / 367 ms |
| A1 | T11 | `scadaKenh.khaiHangLoat` 200 tag, TOTP THẬT, `SEC_PLATFORM` bật; 20 `recordAuditEvent` đơn lẻ bắn ĐÚNG lúc lô vào bước audit | `soDoi` 200; `recordAuditEvents` ĐÚNG 1 lần × 201; `recordAuditEvent` 0 lần từ router; đoạn chuỗi [min, max] của CHÍNH ô liền (0 lỗi, ≥ 221 hàng); lô là một khối id liền | ✓ thời gian ghi 113 / 118 / 109 ms |
| G3 | T14 | express + `createHmiStopLimiter` / `createAuthLimiter` THẬT, client ioredis THẬT (hạn 250 ms của ioredis) nói RESP2 với Redis GIẢ trong tiến trình | (a) Redis NÉM mọi lệnh: 600 STOP một phiên đều 200, lượt 601 ⇒ 429, phiên khác 200, `MemoryStore.increment` ≥ 602, đăng nhập 429 đúng lượt `max+1`; (b) fix round: Redis chậm 400 ms rồi khoẻ KHÔNG xoá dữ liệu ⇒ mọi khoá `rl:auth:` / `rl:hmistop:` Redis đã thực thi đều CÓ TTL > 0; đăng nhập vẫn đếm (đúng 1 lượt 429 trong `max+1` đồng thời) | ✓ (a) 620 / 597 / 628; (b) 494 / 494 / 468 ms |
| G4 | T15 | `fetchRequestHandler` + `createContext` + `appRouter` THẬT; batch `[auth.logout, scadaCommands.dungMay]`; `sdk.authenticateRequest` treo 5 s | CẢ HAI lượt `SERVICE_UNAVAILABLE / SCADA_STOP_PRECHECK_TIMEOUT`; ≥ 1450 ms thô và < 1700 sau trừ `batDauDoLag().dung()`; `demStopQuaHanKhongGhiSo().tong` tăng ĐÚNG +1, `theoBuoc.xac_thuc` +1 | ✓ thô 1521 / 1512 / 1522 (trừ lag 1421 / 1412 / 1422) ms |

Ghi chú ô:
- G4 dùng `auth.logout` thay `auth.me` của bảng kế hoạch: `auth.me` là QUERY, không chung được một POST batch với mutation `dungMay` (httpBatchLink tách
  theo loại). Mọi mutation anh em có cùng hình: `createContext` ném trước khi thủ tục nào chạy.
- D1 (dọn `_test` của T13) không ở lưới — đo bằng chạy khô thật, ghi ở §6 DỮ LIỆU.
- Lưới không chạm :3000 / :8091 / GPU / container OpenPLC. `OT_CONTROL_ENABLED=true` và `AI_OT_CONTROL_ENABLED="false"` chỉ trong tiến trình.

## 2. Đột biến cấp hệ thống (Step 2) — chạy rồi hoàn tác

| Đột biến | Tệp | Kết quả |
|---|---|---|
| Coil Modbus quay về `Boolean(w.value)` (`writeOne`: `writeCoil(register, boolChoGhi(w.value, w.dungGhim))` ⇒ `writeCoil(register, Boolean(w.value))`) | `server/services/ot/drivers/modbusDriver.ts` | **B1 ĐỎ**: `"false": expected 'acked_unverified' to be 'acked_verified'` — coil nhận TRUE, đọc lại lệch (ca ghi `writeCoil(6, false)` cũng sẽ đỏ). Các ô khác giữ nguyên (R1-đc đỏ như trước). Hoàn tác bằng `git checkout -- server/services/ot/drivers/modbusDriver.ts`; `git diff` của tệp: 0 byte |

## 3. Bench OpenPLC

Bench thật trên container OpenPLC (`avi-openplc-bench`), ba lượt chạy. Tiền điều kiện của MỖI lượt đều được điều phối duyệt tại thời điểm chạy:

| | Lượt 1 | Lượt 2 | Lượt 3 |
|---|---|---|---|
| Commit trống trước chạy | 21,0 GB | 20,8 GB | 20,7 GB |
| Giới hạn container | `1g` / `1g` (memory / swap) | `1g` / `1g` | `1g` / `1g` |
| Khởi động | `--start-neu-tat` | `--start-neu-tat` | `--start-neu-tat` |

Chung cho cả ba lượt: KHÔNG tải chương trình PLC; không chạm :3000 / :8091 / GPU; mọi coil và thanh ghi đã trả về giá trị gốc; container trả về trạng thái
`exited`, xác nhận bằng `docker inspect`.

**Lượt 1 — 41/42** (`bench-r1b2b1.txt`):
- Mọi ô S1 / S2 / X2 / L1 / B1a: 3/3 lượt đạt.
- B1b đạt ở lượt 2 và 3: ghim STOP pin 1 trên một coil INT ⇒ `acked_verified`, coil 0 → 1, thoả điều kiện 1c.
- B1b lượt 1 hết hạn sau 5124 ms. Chính lượt này dẫn tới phát hiện ở T17: một lỗi ĐÃ CÓ SẴN từ `1e0ae656c`, được sửa trong R1b-2b-1.

**Lượt 2 — huỷ giữa chừng, không có dữ liệu** (`bench-catlienket.txt`): kịch bản bench tự văng `TransactionTimedOutError` không bắt (từ bộ đối chứng
trực tiếp `voiClient`). Kịch bản đã được sửa (`b473cf1e9`: mỗi lỗi của một bước ⇒ dòng ĐỎ có lý do + stack, chạy tiếp, in ngay từng dòng).

**Lượt 3 — 61/66, ô ĐỐI CHỨNG chạy trước** (`bench-doichung.txt`):
- Ô đối chứng **B1b-thông** (proxy thông suốt, chưa cắt) ĐỎ: b1 qua proxy rớt một lần (19/25 tốt; thống kê proxy) trong khi main vẫn sống. Theo luật đã
  thoả thuận ⇒ lỗi nằm ở ĐƯỜNG / CÔNG CỤ bench, các ô cắt KHÔNG đủ điều kiện làm bằng chứng.
- Chỉ để tham khảo: 5/5 lượt cắt trả `timeout` trong 106–137 ms, 0 ack giả, 0 `failed`. Lượt 2 (cắt SAU khi gửi) kết thúc coil 0 → 0; lượt 4 kết thúc 0 → 1.
- 3 lỗi bước đến từ bộ đối chứng trực tiếp (OpenPLC nghẽn khi nhiều kết nối đồng thời).
- Bằng chứng T17 dùng để nghiệm thu: các test tất định trong tiến trình + lưới T16 18/18 + 20 đột biến (§8). Bench lượt 3 KHÔNG được dùng làm bằng chứng.
  Việc dựng bench cắt liên kết ổn định ⇒ R1b-2b-2 mục 67.

**M1 (MC):** không có PLC Mitsubishi thật — chỉ thư viện mcprotocol thật trên máy chủ TCP giả (probe `mcErrCode.thuVienThat.test.ts` của T4) và thư viện giả
ở lưới ⇒ ghi nhận là giới hạn (§6 VẬN HÀNH).

Bản DB tương đương: ô B1 của lưới + `commandDispatcher.kenh.r1a.db.test.ts` ca "KD-T2 + điều kiện 1c".

## 4. Thứ tự triển khai

1. **R1b-2b-1 KHÔNG có migration.** Bản build đòi mọi điều kiện của báo cáo R1b-2a §4 mục 1 vẫn đúng trên DB đích: migration 0431, 0432, 0433, 0434 đã
   có (và backfill TOFU của 0434 đã chạy). Không dùng số nào trong dải 0435–0439. Không cờ mới, không biến môi trường mới.
2. **BẮT BUỘC, TRƯỚC bản build, trên MỌI DB: truy vấn R1b-2a `TRUY_VAN_TRUOC_TRIEN_KHAI` = 0 hàng** — khối NGUYÊN VĂN ở báo cáo R1b-2a §4 mục 2
   (`docs/superpowers/plans/2026-10-25-scada-r1b-2a-bao-cao-nghiem-thu.md`; cùng test ghim từng byte). Hằng KHÔNG đổi ở R1b-2b-1 (T2 chỉ thêm hằng
   bool riêng ở mục 2b). Chạy trong phiên `SET default_transaction_read_only = on`.

2b. **BẮT BUỘC, TRƯỚC bản build, trên MỌI DB: truy vấn bool trước triển khai = 0 hàng** (R1b-2b-1 Task 2, kiem-dinh G1). Bản build làm `dispatch()`
   từ chối (`TYPE_MISMATCH`) mọi giá trị ngoài `true`/`false`, `1`/`0`, `"1"`/`"0"`, `"true"`/`"false"` gửi lên tag bool CHƯA khai, và mọi driver ghi
   bool bằng cùng luật (trước: `Boolean("false")` = TRUE trên thiết bị). Một luật interlock ĐÃ BẬT từ trước với `commandValue` như `"on"` / `2` / `{"v":1}`
   trên tag bool sẽ bị từ chối đúng lúc hành động bảo vệ cần chạy. Chạy trong phiên `SET default_transaction_read_only = on`. Chuỗi dưới là bản
   NGUYÊN VĂN của hằng `TRUY_VAN_TRUOC_TRIEN_KHAI_BOOL` (`server/services/scada/lenhInterlockLechLuoi.ts`):

```sql
-- R1b-2b-1 §4 mục 2b — luật interlock ĐANG BẬT nhắm tag bool với commandValue ngoài tập bool hợp lệ (CHỈ ĐỌC). ≥ 1 hàng ⇒ DỪNG triển khai.
SELECT r.id, r.name, r."targetAdapterId", t."tagKey", r."commandValue", 'KHONG_PARSE_DUOC' AS ket_luan
FROM interlock_rules r
JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'bool'
  AND NOT (
        r."commandValue" IS NULL
     OR jsonb_typeof(r."commandValue") IN ('null', 'boolean')
     OR (CASE WHEN jsonb_typeof(r."commandValue") = 'number' THEN (r."commandValue" #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(r."commandValue") = 'string' AND lower(btrim(r."commandValue" #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY r.id
```

   **Census Task 2 (cổng dừng C12 / Q2 / điều kiện 1a):** census TEST 0 hàng; census DEV 0 hàng, nhưng DEV không có ghim / luật bật / tag slmp-mc; mọi
   DB đích khác phải chạy lại `task-2-census.sql` (phụ lục) trước triển khai. Census phủ (Q1–Q6): luật bật nhắm tag bool / tag địa chỉ coil–bit với
   `commandValue` ngoài tập; write FOE (`step.args.writes`, mọi độ sâu, cả lịch sử phiên bản) lên tag bool / coil–bit ngoài tập; tag bool có `stop_value`
   không phải boolean; ghim STOP trên MỌI tag địa chỉ coil–bit (coil Modbus, holding bool, bit-device SLMP / MC, bit S7) ngoài tập 8 giá trị. ≥ 1 hàng
   ở bất kỳ câu nào ⇒ DỪNG, sửa dữ liệu trước. Kết quả TEST chi tiết: `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/task-2-census-test.md`.

3. **Thứ tự:** (a) mục 2 và mục 2b = 0 hàng VÀ `task-2-census.sql` Q1–Q6 = 0 hàng (Phụ lục A) trên DB đích, đọc trong phiên chỉ đọc — ≥ 1 hàng ở bất kỳ
   câu nào ⇒ DỪNG, sửa từng hàng về `true` / `false` (Q2 của điều phối) rồi chạy lại; (b) rồi mới triển khai bản build; (c) sau khởi động: log cảnh báo
   khởi động của `lenhInterlockLechLuoi` không có dòng nào, posture không báo luật lệch lưới / bit. Thứ tự này áp cho MỌI DB đích (DEV đã đo = 0 nhưng
   DEV không có ghim STOP / luật bật không-alert / tag slmp-mc — §6 DỮ LIỆU).
4. **Redis của bộ giới hạn** (T14): bản build cần Redis ≥ 2.6 (`EVAL`). Script Lua `LUA_TANG_DEM` / `LUA_GIAM_DEM` đã được bộ điều khiển chạy thử một
   lần trên Redis 7 THẬT dùng một lần (sổ dòng 153). Khoá `rl:*` không TTL rò từ TRƯỚC bản sửa (nếu có trên Redis production) tự có TTL ở lượt kế; khoá
   không bao giờ bị chạm lại thì cần một lượt `SCAN rl:*` + `TTL = -1` thủ công (việc vận hành, không phải mã).
5. `AI_OT_CONTROL_ENABLED` KHÔNG đổi ở bất kỳ DB / môi trường nào trong lần triển khai này.

## 5. Chạy toàn bộ

HEAD `b473cf1e9`, 2026-10-27 03:12–04:07.

- Lưới trước gộp (`node scripts/luoi-truoc-gop.mjs --nang ...`): **35751 ca**.
  - Thường: 31748 ca, 1 đỏ.
  - DB tuần tự: 3921 ca, 0 đỏ.
  - Nặng: 82 ca, 0 đỏ.
- **0 đỏ THẬT.**
- 1 đỏ chỉ khi chạy song song: `server/_core/rateLimitConfig.duPhongBoNho.test.ts`, ca Redis khoẻ — 4 lần rơi về bộ nhớ dưới tải CPU. Chạy riêng 3/3
  xanh ⇒ phân loại **tải**. Ngưỡng KHÔNG được nới. Đây cũng là hành vi SẢN PHẨM: dưới tải vòng lặp sự kiện, Redis khoẻ vẫn quá 250 ms và bộ giới
  hạn rơi về bộ nhớ (§6 VẬN HÀNH 3). Thành mục 68 của R1b-2b-2.
- **Sau đó (2026-10-27, T14 load-robustness fix): phần TEST của ca đỏ này đã sửa**, ngưỡng sản phẩm không đổi (`HAN_LENH_REDIS_GIOI_HAN_MS` = 250):
  - ca Redis khoẻ (và pha khoẻ của ca I1) nới TẠM hạn lệnh của chính client dùng chung lên 10 s rồi trả lại 250, vì ca này chứng minh ĐI DÂY
    ("Redis khoẻ ⇒ đếm ở Redis, bộ nhớ không tăng"), còn hạn 250 ms vẫn do các ca Redis chậm phủ;
  - điều kiện "tải đồng thời" của ca STOP < 1 s nay đếm lệnh đang bay TẠI máy chủ giả (máy chủ giữ câu trả lời ngoài tầng STOP), không dựa nhịp hẹn giờ.
  - Bằng chứng: tệp cũ dưới tải hỗn hợp (16 tiến trình bận + một lượt vitest khác) đỏ 1/3 với đúng lỗi `expected 4 to be +0`. Tệp mới chạy riêng
    6/6 xanh dưới cùng tải (~100 % CPU) và 6/6 dưới tải 4 lõi. Đột biến bỏ dự phòng bộ nhớ / bỏ `commandTimeout` / vòng lặp bận vẫn ĐỎ dưới tải.
  - Mục 68 chỉ còn phần hành vi sản phẩm.
- Lô serial 7/7 (66 ca). Opt-in R0 + R1a + R1b-1 + R1b-2a + R1b-2b-1 5/5 (74 ca). `npm run check` 0. `i18n:check` 0.
- Phân loại tệp đỏ: lô 0 / tải 1 / có sẵn 0.

Đã chạy ở T16 (phạm vi T16, không phải Step 5):
- lưới opt-in: 3 lượt, 17/18 mỗi lượt (R1-đc đỏ); không đặt biến ⇒ 18 bị bỏ qua; sau T6 fix round 1: 3 lượt 18/18;
- census / gate chạm SCADA + test file + pin báo cáo (23 tệp: `rawErrorCensus`, `dataErrorStringCensus`, `xoaHangKhongGioiHanTrongTest`,
  `phamViDocCensus`, `phamViGhiCensus`, `phamViTuyenCensus`, `congGiayPhepAiCensus`, `otWriteBinding.census`, `lamTronScaleCensus`,
  `staleKhongVaoPhien.census`, `stopPinDatMotCho.census`, `thuTuKhoaTag.census`, `vramPha5Gate`, `nguoiDungTest.census`, `fakeUtcCensus`,
  `scripts/mutantFileCensus.dot10`, `otLuongCensus`, `edgeDbTrap.census.dot10`, `jsonStringifyPostgresTho.census`, `vitestSerialProject.residual.dot10`,
  `execRowsCensus`, `robotStopProcedureCensus.dot10`, `lenhInterlockLechLuoi.baoCao`): 23 / 23 tệp, 264 / 264 ca;
- `NODE_OPTIONS=--max-old-space-size=12288 npx tsc --noEmit`: exit 0 (tsconfig loại `*.test.ts`; T16 không đổi mã sản phẩm); `npm run i18n:check`: 0 lệch placeholder, 0 khoá MỚI thiếu, 0 baseline cũ, 0 vi phạm toàn vẹn.

## Thay đổi hành vi nhìn thấy được

- (T2, kiem-dinh G1) **Bool lạ bị từ chối.** `dispatch()` từ chối `TYPE_MISMATCH` (appError `SCADA_VALUE_TYPE_MISMATCH {ma, tagKey, dataType}` — nay
  cho MỌI dataType bị từ chối kiểu sớm) mọi giá trị ngoài 8 giá trị bool hợp lệ lên tag bool CHƯA khai; MỌI driver ghi bool theo cùng luật (`"false"` /
  `"0"` nay là FALSE trên thiết bị; trước: `Boolean("false")` = TRUE). Đọc bool qua `giaiMaBoolDoc`: chuỗi lạ từ thư viện ⇒ mẫu `bad`.
- (T2 fix round) **Giá trị lên địa chỉ BIT bị từ chối ở ba chỗ**, bất kể dataType (coil Modbus, holding bool, bit-device SLMP / MC, bit S7): lúc LƯU luật
  interlock (`INTERLOCK_NGOAI_DAI` lý do `TYPE_MISMATCH`), ở posture (`luatLenhLechLuoi` đếm), và lúc GỬI (`TYPE_MISMATCH` sớm, thiết bị 0 lần). Ghim
  STOP MỚI ngoài tập trên địa chỉ bit bị từ chối lúc đặt (`INVALID_VALUE {field:"stopValue", reason:"stopPinBitAddress"}`). STOP khớp ghim KHÔNG BAO GIỜ
  bị chặn: ghim cũ `255` trên coil kiểu int ghi TRUE.
- (T6) **STOP `255` trên coil int đọc lại `acked_verified`** (lớp địa chỉ bit so theo bool). (T6 fix round 1) So đọc lại tag int / float có thang
  đo so với giá trị driver SẼ đọc về cho số thô vừa ghi (`scaleXuoi(inverseScale(e))`): lượt ghi đúng ⇒ `acked_verified` như trước T6; thiết bị giữ
  số thô làm ĐỔI giá trị đọc ⇒ `acked_unverified` (vd scale 10: ghi 30, thiết bị giữ thô 4 ⇒ đọc 40 — trước T6 cũng lệch). Đường đọc của 6 driver nay
  gọi chung `otScale.scaleXuoi` (cùng phép tính, giá trị đọc không đổi).
- (T1, mục 59) **Trang đổi mật khẩu có khối "DỪNG MÁY khẩn cấp"** cho người có quyền dừng (sàn vai mức 1 + `machine_control.canEdit`); nút không bao giờ
  ẩn / vô hiệu; dòng "Có thể không tới mọi thiết bị — dùng thêm E-STOP cứng" khi `tongHop` ≠ `du`; dòng "danh sách có thể chưa đủ" khi bị cắt ở 200.
  Mọi thủ tục khác vẫn `MUST_CHANGE_PASSWORD`.
- (T5, mục 51) **Phiên mà mọi tag sai cấu hình cục bộ ở `connecting`** (không `connected`, không `lost`, không vòng nối lại) và mang lý do
  `moi_tag_sai_cau_hinh` (i18n vi / en / zh) ở M10 / `NganTagAdapter`; "Chỉ lỗi" tính hàng có lý do là lỗi.
- (T8, mục 13) Tắt tiến trình không ghi `disabled`: trong cửa sổ từ lúc tắt tới lúc khởi động lại, DB vẫn để trạng thái cuối (có thể `connected`); `disabled` chỉ còn nghĩa adapter bị tắt thật / gateway tắt / khởi động lại khung OT.
- (T4, mục 58) MC: PLC trả lời LỖI cho cả khối (kể cả chậm ≥ 90 % hạn gói) ⇒ `device_error`, phiên GIỮ, STOP ghim ghi được (trước: mất liên lạc + nối lại).
- (T3, G2) Tag string / json có giá trị thật `"BAD n"` khi thư viện không báo lỗi ⇒ mẫu tốt (trước: luôn xấu).
- (T14, điều kiện 4 (b)) **Mọi bộ giới hạn (STOP, api, api-uip, đăng nhập, OTP / 2FA theo thủ tục, ingest) rơi xuống bộ nhớ THEO TIẾN TRÌNH khi Redis
  sập / lỗi / chậm quá 250 ms** — cùng trần, không fail-open (trước: cho qua). Phía trước tRPC tối đa ~250 ms Redis. N bản API ⇒ N × trần.
- (T15, G4 + KD-T15) **Batch chứa `scadaCommands.dungMay` chịu hạn tổng 2,5 s** (xác thực 1,5 s) như request STOP đơn; lượt ANH EM cùng batch có thể nhận 503
  `SCADA_STOP_PRECHECK_TIMEOUT` (lời riêng "nằm CÙNG batch với STOP HMI … gửi lại riêng", không đếm `stopQuaHan24h`, không log "STOP CHƯA được gửi").
- (T9, mục 44 / 46) STOP HMI: mỗi lượt ghi sổ trên đường trả lời có hạn 500 ms (câu trả lời trễ tối đa 500 ms mỗi lượt khi DB chậm, lượt ghi chạy nền);
  quá 8 lượt treo ⇒ bỏ qua lượt ghi, log `<nhan>_bo_qua_day` mang nội dung dòng (dòng attempts chỉ còn trong log). Import động của đường STOP được làm ấm
  sau `listen`.
- (T10, mục 47) Ghi luật interlock (update / delete / enable / disable / approve) có thể trả `CONFLICT` `scadaKenhThuLai` khi đích của luật vừa đổi đồng
  thời; luật nay ngoài phạm vi ⇒ `NOT_FOUND`. `approve` nay khoá adapter đích trước luật.
- (T11, mục 48) Khai mức hàng loạt: MỘT `UPDATE … FROM VALUES` + MỘT INSERT audit nhiều hàng; mọi hàng audit của một lô cùng `hashTs`; nhanh hơn ~9×.
- (T7) EIP: `timeout_sp` của thư viện = `timeoutMs` của adapter (trước: mặc định thư viện).
- (T17 fix round 1, điều phối 2026-10-27) **STOP HMI có ≥ 1 adapter kết thúc `timeout` (không rõ kết cục) ⇒ băng đỏ CỐ ĐỊNH "DÙNG E-STOP CỨNG TẠI MÁY"**
  (`BangEstopCung`, `data-loai="khong_ro"`, câu `scada.dungMay.bangEstop.khongRo` nêu adapter — vi / en / zh) như STOP chưa gửi: trong hộp và Ở LẠI trên
  trang tới khi bấm "Đã hiểu"; dòng đỏ trong hàng giữ nguyên. Cùng lần có adapter bị bỏ vì hạn ⇒ băng `qua_han_mot_phan` thêm dòng không rõ.
- (T17, bench B1b) **Lệnh ghi đang bay khi liên kết mất / phiên bị hạ ⇒ `timeout` ("không rõ") NGAY** (đo: ≤ 20 ms sau sự kiện mất liên kết / hạ phiên; trước: 5000 ms hạn dispatcher với
  Modbus khi vòng canh hạ phiên, 5000 ms `failed` với S7 / MC / EIP, ~800 ms `failed` với Modbus khi không ai hạ phiên, `failed` với SLMP / OPC UA). Status
  và nhãn HMI GIỐNG HỆT `timeout` hôm nay (dòng "chưa xác minh" + "Dùng E-STOP cứng tại máy"); chỉ `errorText` đổi thành `link lost while the write was
  in flight (after N ms) — outcome unknown: …`. Poll: tick bị huỷ vì mất liên kết mang `link_lost` / `comm_lost`. Với `OT_CMD_SERIALIZE_ENABLED` bật,
  lệnh kế (STOP) không còn đợi 5 s + ân hạn 1 s + đặt lại phiên sau lệnh treo. (T17 fix round 1, I1) Lệnh bị huỷ như vậy VẪN được ghi NGAY vào rủi ro
  "lệnh ghi cũ" của B3 (không giữ chỗ, không đặt lại phiên — phiên đã hạ) ⇒ STOP acked kế tiếp có canh chỉ-báo-động như sau một lệnh quá hạn. Lý do: kết
  cục không rõ — khi CHÍNH ta hạ một socket còn sống (reset HA lúc mạng phân mảnh, `connect()` lại sau khi trạng thái iso rớt), byte kernel đã nhận vẫn
  được gửi nốt và PLC vẫn xử lý phần đã nhận, nên lệnh cũ CÓ THỂ tới sau STOP; "socket đã huỷ nên không thể tới" chỉ đúng khi PLC đóng kết nối.
  (rà soát bảo mật) Mục rủi ro của adapter không bao giờ bị làm yếu: lần bỏ mới GỘP vào mục đang có (hạn = max, intent + writes hợp lại; trước: lần quá
  hạn sau ĐÈ lần trước); lượt giữ B3 nhả trên mục đang ở map, chỉ nới hạn; canh STOP coi "giá trị bị bỏ đã tới" khi BẤT KỲ giá trị bỏ nào của tag khớp.
  (T17 fix round 2) Cả khi hạn của LỆNH hết trước và phiên bị hạ TRONG ân hạn 1 s của B3 (lệnh treo bị huỷ bằng lỗi có kiểu): ghi rủi ro ngay, không đặt
  lại phiên, nhả chỗ ngay (trước: coi là "đã xong", không ghi gì).

## 6. Giới hạn đã biết

### LOGIC

1. **(T16 → T6, ĐÃ SỬA ở T6 fix round 1; còn giới hạn) So đọc lại int có thang đo.** Driver Modbus / SLMP / S7 / MC / EIP / OPC UA trả giá trị
   kỹ thuật tag int = `Math.round(raw * scale + offset)`; bản T6 đầu suy thô từ giá trị ĐÃ làm tròn ⇒ lượt ghi ĐÚNG của giá trị không nguyên trên tag
   int scale lẻ luôn `acked_unverified` (lưới R1-đc: scale 0,5 ghi 2,5 thô 5 ⇒ đọc 3; scale 0,1 ghi 2,3 thô 23 ⇒ đọc 2). Sửa: so với giá trị ĐỌC MÔ
   PHỎNG `scaleXuoi(inverseScale(e))`, `scaleXuoi` là MỘT nguồn cho đường đọc của cả 6 driver (test `ModbusDriver` THẬT trên client Modbus giả;
   đột biến quay về so không gian thô ⇒ đỏ). **Giới hạn còn lại:** khi làm tròn CHE số thô sai (scale 0,5: thô 6 và thô 5 cùng đọc 3) thì không phát
   hiện được nếu không đọc lại THÔ thật ⇒ R1b-2b-2 mục 64 (ca giới hạn được GHIM trong `otDeviceWrite.readback.r1b2b.test.ts` để mục 64 lật có chủ ý).
   Vì thế ô R1 của lưới dùng thô 7 (đọc 4 ≠ 3) thay thô 6. Chỉ là nhãn (không gửi lại, không chặn STOP).
   Ghi giá trị lệch lưới (vd 33 ở scale 10 ⇒ thiết bị giữ 30) được gắn `acked_verified` theo thiết kế so đường đọc; cổng kênh (OFF_STEP, R1b-2a) đã từ
   chối giá trị lệch lưới cho tag int có scale ≠ 1 / tag đã khai `writeStep`, nên chỉ đường vòng qua cổng mới gặp.
2. (T2, KD-T2) Ghim STOP CŨ là chuỗi ngoài tập trên coil (vd `"off"`) vẫn ghi TRUE (luật truthy cũ — STOP không bao giờ bị chặn); ghim MỚI như vậy bị từ
   chối lúc đặt; census TEST / DEV = 0 ghim như vậy. Cùng nhánh: số hữu hạn ≠ 0 ⇒ TRUE.
3. (Task 2 fix round 1) luật/FOE tạo sau triển khai: luật interlock bị kiểm lúc lưu + tư thế; workflow FOE chỉ bị chặn sớm lúc gửi (TYPE_MISMATCH), không lúc lưu.
4. (T2 fix round) Đổi `address` của tag đích (holding ⇒ coil) không kiểm lại luật theo luật bit lúc sửa; posture / log khởi động / dispatch (TYPE_MISMATCH
   sớm) bắt ngay sau đó. Edge (`otEdgeDispatch`) không qua `congKenhSom`: lệnh không-STOP ngoài tập lên bit trên edge `failed` ở driver (central đã từ
   chối trước khi ký). Lệnh không-STOP mà nội dung BẰNG đúng các giá trị ghim: `isStopByContent` bỏ qua nhãn ⇒ được miễn luật 6 (`khopGhim`) và là
   `trueStop` ⇒ `dungGhim` ⇒ ghi khoan dung như STOP; nó CHỈ hỏng muộn ở driver khi kết nối đang chạy KHÔNG khớp hàng adapter
   (`runningConnectionMatchesAdapterRow` false ⇒ không `trueStop` ⇒ driver ghi nghiêm, vd ghim cũ `255` trên coil ⇒ `failed`; hình có sẵn). Cờ octal SLMP bị bỏ qua khi nhận diện bit (không đổi
   `isBit`). Posture join trong với adapter có thể bỏ sót luật trỏ tag mồ côi.
5. (T3, Q4 — điều phối CHẤP NHẬN) Tag string có giá trị thật `"BAD n"` đọc CÙNG lượt với một item lỗi khác (thư viện `anythingBad=true`) vẫn bị coi là
   xấu (fail-closed). `anythingBad` vắng / không phải `false` ⇒ coi là có lỗi. Chưa có ca S7 mất liên kết + string + `anythingBad=false`.
   (Rà soát cuối M-4, ĐÃ SỬA ở final fix) S7 / MC: chỉ callback `readAllItems` ĐẦU TIÊN ghi cờ `anythingBad` (và trạng thái liên kết của S7); callback
   lặp muộn bị bỏ ⇒ không còn làm "BAD n" của lần đọc trước thành giá trị tốt (test "final fix M-4"; đột biến bỏ chốt ở từng driver ⇒ đỏ).
6. (T4) Phân loại MC dựa trên CHUỖI `errCode` của mcprotocol 0.1.2 (`MC_ERRCODE_QUA_HAN_GOI`, probe `mcErrCode.thuVienThat.test.ts`): thư viện đổi bản /
   đổi chuỗi ⇒ `khong_ro` ⇒ quay về luật thời gian cũ (90 % hạn gói). (Rà soát cuối M-3, ĐÃ SỬA ở final fix) `valid=false` với `errCode` không phải
   chuỗi (undefined = item chưa được xử lý ở lần đọc này) không còn tính là "PLC đã trả lời": không item lỗi nào mang `errCode` chuỗi ⇒ `khong_ro` ⇒
   luật thời gian (test `chatLuong.drivers.test.ts` "final fix M-3"; đột biến bỏ kiểm kiểu ⇒ đỏ). Probe có cận `< 250 ms` có thể chập chờn dưới tải.
7. (T5, phán quyết — CHẤP NHẬN) **Trùng tên mã OPC UA:** `BadNodeIdInvalid` do MÁY CHỦ trả về mang đúng chuỗi của mã cục bộ ⇒ phiên mà máy chủ trả mã này
   cho MỌI tag bị coi là trung tính (`connecting` + lý do) dù máy chủ đã trả lời (chiều vô hại: không `connected` giả, không vòng nối lại). Lý do chỉ ở RAM
   (không cột DB, không migration) ⇒ sau khởi động lại hiện lại sau ≤ 1 chu kỳ; người đọc DB khác không thấy. `lost` giữ `lost` + lý do; tick toàn trung
   tính đặt lại bộ đếm D1; push một phần trên máy chủ im lặng giữ lý do tới lần đổi tốt đầu tiên; `BadNodeIdUnknown` (`nsu=`) trên push nay `config_error`.
8. (T6) Hai chỗ gọi so đọc lại của canh STOP (drift watch, `otDeviceWrite.ts` ~910) chưa có test / đột biến riêng; `dungGhim: true` cố định cho
   `old.value` bị bỏ (chỉ gợi ý); `inverseScale` không kiểm hữu hạn như `chuanHoaThangDo`.
9. (T7) SLMP `console.warn` cho khung 4E sai serial không giới hạn tần suất (chặn bởi cửa sổ hạn); ca EIP 'error' chỉ kiểm `rejects.toThrow()` trần.
10. (T8) Một lượt ghi trạng thái đã hẹn TRƯỚC lúc tắt có thể vẫn tới DB (trạng thái cuối, không `disabled`); `__datLaiTrangThaiAdapter` (test) chưa đặt lại
    cờ tắt tiến trình. Cờ là của TIẾN TRÌNH (tắt luôn `process.exit`).
11. (T9) **Trần lượt sổ treo là THEO TIẾN TRÌNH** (`TRAN_GHI_SO_TREO_STOP_HMI` = 8; N bản API ⇒ N × 8). Lượt ghi bắn-rồi-quên CÓ TỪ TRƯỚC trên đường
    `dungMay` (attempts + audit của `tuChoiQuaHan`, vòng `STOP_QUA_HAN` theo adapter, mọi `recordAuditEvent`) CHƯA chịu trần ⇒ R1b-2b-2 mục 61 (ưu tiên đầu).
    Lượt CAS dòng chờ bị bỏ qua vì đầy để `ai_pending_actions` ở `confirmed` (như CAS quá hạn; có log).
12. (T10) `resolveEvent` đọc luật không khoá và kiểm phạm vi qua pool trong giao dịch (R1b-2b-2 mục 62); chưa có census thứ tự ADAPTER → LUẬT + cấm gọi pool
    trong giao dịch giữ khoá hàng (mục 63). Đột biến 1 (đọc phạm vi qua pool SAU khi đã khoá) sống sót — tương đương về an toàn. Câu `scadaKenhThuLai` nói
    "kênh" cho luật interlock (lệch chữ).
13. (T11) Một `hashTs` cho cả lô; khoá chuỗi audit vẫn là khoá giao dịch (giữ tới commit, chỉ lấy MUỘN hơn). Ca rollback chỉ kiểm `toBeInstanceOf(Error)`.
14. (T14, điều kiện 4 (b)) Trần dự phòng trong bộ nhớ THEO TIẾN TRÌNH cho MỌI tầng; số đếm bộ nhớ bị bỏ khi Redis khoẻ lại (một khách có thể thêm tối đa
    một trần qua lúc chuyển — không fail-open); lệnh Redis đã quá hạn vẫn có thể được thực thi ⇒ số Redis ≤ số thật. Nhánh "store lỗi — FAIL-OPEN" của
    `trpcGioiHanThuTuc` chỉ còn khi chính bộ nhớ ném. Script gửi bằng `EVAL` (không `EVALSHA`). Không test nào chạy Lua bằng engine thật (bộ điều khiển chạy
    thử một lần trên Redis 7 thật).
15. (T15) Bộ phân loại dựa trên `path` ĐẦY ĐỦ: người gọi qua router con (path ngắn `dungMay`) bị coi là anh em (chỉ test). Lượt anh em trong batch có
    `dungMay` có thể nhận 503 (chấp nhận, KD-T15).
16. (T1) Hạn 3 s chỉ bọc THÂN `mayDungKhanCap` — xác thực + đọc cờ ở cổng không có hạn (C16 đã chấp nhận); khảo sát bị bỏ rơi sau hạn con 1,5 s vẫn chạy
    nền (khe dùng chung toàn tiến trình 8 — final fix I-1, trước 16; ngân sách pool ở VẬN HÀNH 3); bức tường giấy phép làm khối im lặng (cả `dungMay` cũng chịu giấy phép); `khong_ro` có thể hiện hai cảnh báo.
    Chi phí khảo sát ở site lớn chưa đo trên DEV.
17. (T13) Nhánh từ chối edge-node của script dọn chỉ có test đơn vị; chạy khô với tiền tố DÙNG CHUNG liệt kê cả fixture sống của test đang chạy song song.
18. (T17, bench B1b) **STOP treo 5 s khi liên kết mất lúc lệnh ghi đang bay — lỗi CÓ SẴN từ 1e0ae656c (2026-09-26), có trên main/:3000 hiện tại;
    R1b-2b-1 sửa.** Còn lại: (a) quá hạn giao dịch CỦA DRIVER (Modbus 800 ms "Timed out", SLMP, hạn cứng 5000 ms của S7 / MC / EIP, `timeout_sp` EIP)
    vẫn ra `failed` dù kết cục cũng không rõ — hình có sẵn, ngoài phạm vi được duyệt ⇒ R1b-2b-2 mục 66 (ưu tiên, thứ tự 61 → 66 → 62); (b) S7: nodes7 không phát sự kiện
    liên kết ⇒ điểm (i) đi qua vòng canh (`isoConnectionState` ≠ 4 ⇒ `disconnect()` ≤ 500 ms) — vẫn < 1 s; (c) lô nhiều write mất liên kết giữa chừng ⇒
    cả lô `timeout` (write đã ack trước đó cũng mang nhãn không rõ — giống `timeout` hôm nay); write sau trong lô không được gửi.

### DỮ LIỆU

1. **Census T2 (cổng dừng):** TEST Q1–Q6 = 0 hàng (đối chứng vị từ 22/22, trích FOE lồng 6/6, phân lớp địa chỉ 27/27; I1: 6 ghim coil Modbus bool, đều
   boolean). DEV (điều phối chạy psql chỉ đọc) Q1–Q6 = 0 và I1 = 0 — **nhưng DEV không có ghim STOP nào, không luật bật không-alert, không tag slmp / mc**
   (42 tag / 6 bool; 5 workflow + 5 phiên bản) ⇒ DEV = 0 KHÔNG chứng minh dữ liệu sản xuất sạch; MỌI DB đích khác phải chạy lại `task-2-census.sql`
   (Phụ lục A) trước triển khai.
2. **Dọn `_test` (T13, chạy bởi bộ điều khiển sau khi điều phối duyệt — sổ dòng 147):** chạy khô ⇒ `adapters [35245]`, `machineMoCoi {35245:56440}`
   (adapter mồ côi trỏ máy không còn tồn tại) ⇒ `--ghi --ids=adapters:35245,moCoi:35245>56440` xoá `device_tags` 1 + `device_adapters` 1 (WORM không chạm)
   ⇒ chạy khô lại: 0. Đầu ra ở scratchpad `donrac.txt` của bộ điều khiển.
3. **Chuỗi audit của `_test` dùng chung đã gãy:** đo chỉ đọc (sổ dòng 130): 11 169 hàng có băm, 1 733 chỗ gãy (id 128 700 … 139 444) do nhiều phiên test;
   lượt đột biến M1 / M2 / M4 của T11 thêm vài hàng gãy / rẽ nhánh. `control_audit_log` là WORM ⇒ không xoá được. Điều phối chấp nhận (sổ dòng 147); quy
   ước: test DB chỉ kiểm ĐOẠN id của chính nó (T11 `auditLo`, lưới A1). Một `verifyControlAuditChain` toàn bảng trên `_test` sẽ báo gãy — không phải lỗi
   của mã.
4. **Lưới T16:** fixture `nt2b1…` được dọn sau mỗi lượt (0 adapter / máy / nhà máy còn lại, đo ở `afterAll`); hàng WORM (`command_log`,
   `scada_command_attempts`, `control_audit_log`) của người dùng lưới ở lại theo thiết kế; người dùng test bị helper xoá hoặc vô hiệu hoá (FK từ WORM).
   Các lượt đột biến / lượt đỏ của T16 không ghi gì ngoài các bảng ấy.

### VẬN HÀNH

1. **MC không có PLC thật.** M1 chỉ chứng minh trên thư viện giả ở lưới và thư viện mcprotocol THẬT trên máy chủ TCP giả (probe T4). Hành vi với PLC
   Mitsubishi thật quá tải (trả lỗi chậm) chưa được đo.
2. **Bench OpenPLC chỉ có cho Modbus B1** (§3: 3 lượt; lượt 3 ô đối chứng proxy thông suốt ĐỎ ⇒ hàng cắt liên kết không phải bằng chứng). Không có
   bench cho S7 / MC / EIP / SLMP / OPC UA. Bench cắt liên kết ổn định ⇒ R1b-2b-2 mục 67.
3. **Trần THEO TIẾN TRÌNH** (T9: 8 lượt sổ treo; T1: 8 khe khảo sát; T14: mọi bộ giới hạn khi Redis sập) — chạy N bản API thì trần thực là N ×.
   **Ngân sách pool DB (rà soát cuối I-1, final fix):** pool chính mặc định 25 (`resolvePoolMax()`, env `DB_POOL_MAX`). Khi DB chậm, truy vấn bị bỏ
   rơi giữ kết nối tới khi DB trả lời (≤ `statement_timeout` 30 s): khe khảo sát của khối DỪNG khẩn cấp tối đa **8** (`DONG_THOI_KHAO_SAT_DUNG_KHAN_CAP`;
   bản trước rà soát cuối: 16) + lượt sổ STOP treo tối đa **8** (`TRAN_GHI_SO_TREO_STOP_HMI`) = **16** ⇒ còn ≥ **9** (`DU_TRU_POOL_CHO_DUNG_MAY`) cho lượt
   đọc trước-gửi của `dungMay`. Hai trần từng được định cỡ RIÊNG (16 + 8 = 24 / 25 ⇒ `dungMay` còn 1 kết nối ⇒ có thể `STOP_QUA_HAN`). Bất đẳng thức
   ghim ở `server/services/scada/nganSachPoolStop.test.ts` (nâng một trần / hạ pool mặc định ⇒ đỏ). **Không** đặt `DB_POOL_MAX` < 25 trên bản API
   phục vụ STOP HMI. Ngân sách chưa phủ: lượt bắn-rồi-quên có từ trước trên đường STOP (R1b-2b-2 mục 61 — gộp thành MỘT ngân sách dùng chung) và
   khảo sát không trần của `cheDo.danhSach` (mục 33).
   **Bộ giới hạn dưới tải vòng lặp sự kiện (T14, hành vi SẢN PHẨM — không chỉ chuyện cô lập test):** khi vòng lặp sự kiện của tiến trình API trễ
   ≥ 250 ms, lệnh tới một Redis KHOẺ cũng chạm `commandTimeout` 250 ms ⇒ bộ giới hạn rơi về đếm trong bộ nhớ THEO TIẾN TRÌNH (đếm tách đôi Redis /
   bộ nhớ ⇒ một khách có thể thêm tới một trần mỗi tiến trình mỗi cửa sổ; không fail-open). Ca đỏ do tải ở §5 chính là hành vi này ⇒ mục 68. Phần test của ca ấy đã cô lập (T14 load-robustness fix), nên mục 68 chỉ còn hành vi này.
4. Lý do `moi_tag_sai_cau_hinh` chỉ ở RAM — công cụ đọc `device_adapters.status` trực tiếp không thấy; sau khởi động lại hiện lại sau ≤ 1 chu kỳ poll.
5. Trong cửa sổ tắt → khởi động lại, `device_adapters.status` có thể còn `connected` (T8, Q6).
6. STOP HMI vẫn có thể gặp hạn: khi DB chậm, câu trả lời trễ ≤ 500 ms mỗi lượt sổ; luôn có E-STOP cứng. Batch có `dungMay` có thể làm lượt khác cùng batch
   nhận 503 — gửi lại riêng.
7. `doLagBucleSuKien` (cận trên đồng hồ tường của test): trên máy Windows này phần nới cho lúc NGỦ vẫn đáng kể ở trần lớn (L1: 300–375 ms cho ~570 ms) —
   mọi cận dùng trần ≤ chính cận (khuôn T9). Chỉ ảnh hưởng thiết bị đo, không phải sản phẩm.
8. Không có migration; không cờ mới; `AI_OT_CONTROL_ENABLED` giữ TẮT.
9. (T17) **Nguyên nhân OpenPLC ngắt kết nối b1 ở bench B1b lượt 1 CHƯA xác nhận** (giả thuyết xếp hạng + phép đo phân biệt ở
   `.superpowers/sdd/2026-10-26-scada-r1b-2b-1-an-toan-va-no/bench-b1b-investigation.md` §4: `docker logs` của OpenPLC, `health().lastError` FIN/RST,
   `DEBUG=modbus-serial`). Bản sửa không phụ thuộc nguyên nhân; bench tái hiện có chủ đích (`--cat-lien-ket N`) chưa chạy với OpenPLC thật.

## 7. Bảng số đo

| Đo | Giá trị | Nguồn |
|---|---|---|
| Khai mức hàng loạt 200 tag (`SEC_PLATFORM` bật, toàn `khaiHangLoat` gồm TOTP thật) | **128 / 117 ms** (mã mới) so với **1105 ms** (mã cũ, cùng máy, cùng phiên); số ghi trước đó 1710 ms | T11 §6 |
| Như trên + 20 audit đơn lẻ song song (lưới A1) | 113 / 118 / 109 ms | T16 lưới |
| STOP HMI máy CHƯA ghim, sổ chậm 5 s (cận 1200) | T9: 778 / 915 ms; lưới L1: 557 / 576 / 587 ms (phần nới 331 / 375 / 300) | T9 §3, T16 |
| STOP HMI máy CÓ ghim, sổ chậm 5 s (cận 1700) | T9: 1371 / 2054 ms (lượt 2 nhờ nới 1209 ms — trước khi kiem-dinh sửa helper `031f5b0b6`) | T9 §3 |
| STOP máy KHÁC khi 8 lượt sổ treo (cận 1700) | T9: 117 / 246 ms; lưới L2: 107 / 104 / 115 ms | T9 fix round, T16 |
| Lượt sổ treo tối đa khi bấm 12 lần, chỉ bảng attempts chậm | ĐÚNG 8 (Postgres: 8 backend chờ, sau 200 ms vẫn 8); 4 lượt bỏ qua có log nội dung | T9 fix round, T16 L2 |
| Đột biến "bỏ trần" (T9) | lượt treo 11; ca mất 31 s thay vì 6 s (bấm xếp hàng sau kết nối kẹt) | T9 fix round |
| `mayDungKhanCap` với một adapter treo 3,5 s | trả trong [1450, 3000) ms, máy treo `khong_ro`, máy khác giữ kết quả; khảo sát đồng thời tối đa ∈ [2, 16] trên 40 adapter (final fix I-1: trần 8 ⇒ ∈ [2, 8], ca DB 17/17 xanh) | T1 fix round 1–2, final fix |
| G4 batch `[…, dungMay]`, xác thực treo 5 s (cận 1700 sau trừ lag) | thô 1521 / 1512 / 1522 ms, trừ lag 1421 / 1412 / 1422 ms | T16 lưới (T15 cùng cận) |
| G3 Redis NÉM: 600 STOP + 1 + phiên khác + đăng nhập | 620 / 597 / 628 ms cho cả ô | T16 lưới |
| STOP dưới Redis chậm 400 ms / 2000 ms + 50 vòng đăng nhập đồng thời (cận `1000 + lag`) | < 1 s mỗi lượt; ca dài nhất 5,4 s; đột biến bỏ `commandTimeout`: 2010 ms (đỏ) | T14 fix round |
| Interlock: stress 10 vòng (sửa mô tả ∥ đổi đích ∥ đổi máy) | thành công [9, 10, 10, 10], 1 CONFLICT `scadaKenhThuLai`, 0 lỗi 40P01 / INTERNAL | T10 §3 |
| Lưới I1 (5 thủ tục + đối chứng, mỗi thủ tục bị chặn thật rồi commit) | 308 / 354 / 367 ms | T16 lưới |
| MC trả lỗi chậm (≙ 4300 / 4500 ms) | đọc ≥ 360 / 400 ms (≥ 90 %), không ném; ô M1 1206 / 1225 / 1212 ms | T4, T16 |
| Phiên S7 mọi địa chỉ sai (C1) | `connecting` + lý do sau 3 lượt đọc (chu kỳ 300 ms); ô 3,2 s / nhánh | T16 lưới |
| T1 tắt tiến trình (chờ điều tiết 5 s × 2 + đối chứng) | 17,5–17,7 s | T16 lưới |
| Cả lưới (18 ca) | 53–57 s mỗi lượt (tests 49,6–53,2 s) | T16 |
| STOP đang bay khi liên kết mất (Modbus THẬT + `executeOtDeviceWrite`) | trả lời `timeout` 0–2 ms sau sự kiện (REPRO, (i), (ii), (iii)); trước: 5009 ms / ~800 ms `failed` | T17 |
| STOP kế tiếp phát lúc STOP đang bay (liên kết cắt 150 ms sau FC5), serialize tắt / bật | STOP2 trả lời sau 0 ms (acked, chạy song song) / 142 ms (chạy ngay khi STOP1 trả lời `timeout` lúc mất liên kết; không gửi gì, `failed` "not connected"); trước: 0 / 5997 ms | T17 |
| Bench chạy khô `--cat-lien-ket --lap 5` (máy chủ mô phỏng, không OpenPLC) | B1b-cắt 101–107 ms `timeout` ok=false 5/5 (coil 0→0 lượt lẻ, 0→1 lượt chẵn); cả bảng 55/55; mã cũ 5150 / 5126 ms | T17 |

## 8. Đột biến theo task (mỗi đột biến chạy, đỏ, hoàn tác; `git diff` rỗng sau mỗi lượt — chi tiết ở `task-N-report.md`)

| Task | Đột biến → kết quả |
|---|---|
| T1 (mục 59) | phần tử thứ ba trong tập miễn ⇒ §2b đỏ; bỏ `mayDungKhanCap` khỏi tập ⇒ 6 ca DB đỏ; bỏ `kiemCongVaiTro` ⇒ 2; lộ mã adapter ⇒ 1; `LIMIT 200` ⇒ 1; bỏ dòng `biCat` ⇒ DOM 1; gỡ `KhoiDungKhanCap` ⇒ 7; khối ở nhánh không khoá ⇒ 4; fix round: `khong_toi ⇒ disabled` đỏ; khe 16 dùng chung / bỏ qua truy vấn sau hạn / N2 ⇒ 3 đỏ; final fix I-1 (khe 16 → 8): nâng khe lên 9 / nâng sổ treo lên 9 / hạ dự trữ xuống 7 / hạ pool mặc định xuống 20 ⇒ `nganSachPoolStop.test.ts` đỏ (4/4) |
| T2 (G1) | M1–M10 (`"on"` hợp lệ, coil `Boolean()`, bỏ `"bool"` ở cổng kênh, SQL bỏ nhánh chuỗi, STOP qua `boolGhi`, `boolGhi` khoan dung, bỏ kiểm bit lúc đặt ghim, bỏ `dungGhim`, giải mã S7 `Boolean`, so đọc lại `Boolean`) đều đỏ; fix round F1a–F3 (8) đều đỏ |
| T3 (G2) | bỏ vế `thuVienBaoLoi` ⇒ 3 đỏ; MC "mọi BAD" bỏ `anythingBad` ⇒ 1; bỏ vế dataType ⇒ chỉ ca thuần đỏ (ca driver int không phân biệt được — đã ghi) |
| T4 (mục 58) | M1 luôn `khong_ro` ⇒ 4; M2 bỏ lọc `valid===false` ⇒ ban đầu SỐNG, thêm 2 ca ⇒ 2 đỏ; M3 đảo "mọi item lỗi PLC" ⇒ đỏ; M4 `khong_ro` bỏ luật thời gian ⇒ 3 |
| T5 (mục 51) | M1–M8 đỏ (M3b — router bỏ lý do — ban đầu SỐNG, thêm ca ⇒ đỏ); fix round M9–M11 đỏ (ca push "mọi địa chỉ sai" xanh theo thiết kế: đi đường poll) |
| T6 (mục 42) | Đo lại ở fix round 2 (head sau fix round 1 + ca lệch lưới; ca "scale 0,5 đọc 3,0 ⇒ lệch" của T6 đầu đã bỏ vì sai mô hình). **A** `readbackMatches` bỏ thang đo (`chuanHoaThangDo(undefined, undefined)` = so `round(e) === round(a)` trước T6) ⇒ 2 đỏ: ca thuần lệch lưới (2,4 @0,5 đọc 3; 33 @10 đọc 30) + ca `ModbusDriver` THẬT lệch lưới (2,4 @0,5 ⇒ `writeRegister(9,5)`, đọc 3; 33 @10 ⇒ `writeRegister(12,3)`, đọc 30). **A2** chỗ gọi xác minh ghi (`otDeviceWrite.ts`) truyền `undefined` thay `{scale, offset}` ⇒ 1 đỏ (ca `ModbusDriver` lệch lưới). **R** quay về so không gian thô `round((e − o)/s) === round((a − o)/s)` ⇒ 9 đỏ (5 qua `ModbusDriver` THẬT: 2,5 @0,5, 2,3 @0,1, lệch lưới, offset, giới hạn; 4 thuần). **B** `lopBit:false` ⇒ ca "STOP 255 coil int" đỏ (T6 đầu). Ô R1 / R1-đc của lưới nằm TRÊN lưới nên không giết A (suy ra ở re-review, lưới không chạy dưới đột biến) — chỉ ca lệch lưới giết. Chỗ gọi canh STOP chưa đột biến |
| T7 (mục 11, 12) | M1 gắn listener sau connect ⇒ đỏ; M2 bỏ chốt danh tính callback ⇒ đỏ; M3 bỏ so serial 4E ⇒ đỏ |
| T8 (mục 13) | bỏ điều kiện chỉ-RAM ⇒ 2 đỏ (legacy + HA) |
| T9 (mục 44, 46) | M1 / M2 / M7 bỏ hạn ⇒ đỏ theo thời gian; M3 bỏ spec khỏi danh sách làm ấm ⇒ đỏ; M4 bỏ handler reject (C3) ⇒ đỏ; M5 / M6 vòng bận ⇒ đỏ; fix round: bỏ trần (MC) ⇒ đơn vị + DB đỏ (11 ≠ 8); M8 vòng bận ⇒ đỏ |
| T10 (mục 47) | 1 (đúng chữ brief) SỐNG — tương đương an toàn (đã ghi); 1b đường cũ ⇒ 5 đỏ; 2 khoá luật trước adapter ⇒ 40P01 ở cả 5 thủ tục; 3 bỏ kiểm đích đổi ⇒ đỏ; 4 luôn CONFLICT ⇒ đỏ |
| T11 (mục 48) | M1 `xauChuoiAudit` không nối ⇒ 4/8 DB + thuần đỏ; M2 bỏ khoá chuỗi ⇒ đỏ 5/5 lượt; M3 bỏ cột UPDATE ⇒ 3/8 + 4/19; M4 id giảm dần ⇒ 4/8; M5 bỏ id tường minh SỐNG (đúng dự kiến — lý do của id tường minh) |
| T12 (mục 49) | `submitTag` gọi `updateTag.mutate` ⇒ DOM đỏ |
| T13 (G5) | `kiemMoCoi` không ném ⇒ 6 đỏ; bỏ so `--ids` ⇒ 2; fix round: máy không tồn tại coi như tồn tại ⇒ 3; tắt `kiemConTro` ⇒ 2 |
| T14 (G3, mục 45) | M1 nuốt lỗi ⇒ 10 đỏ; M2 bỏ `commandTimeout` ⇒ 3 đỏ (ca 400 ms nay xanh — hạn được kiểm bởi ca 2000 ms); M3 đăng nhập không dự phòng ⇒ 4; M4 không init dự phòng ⇒ đỏ; M5 vòng bận ⇒ 2; M6 ba lệnh tuần tự ⇒ 4 |
| T15 (G4) | quay về `laGoiChiDungMay` ⇒ 3 đỏ; vòng bận 400 ms ⇒ ca HTTP đỏ; fix round: bỏ nhánh anh em ⇒ 1 đỏ |
| T16 | hệ thống: coil Modbus `Boolean(w.value)` ⇒ ô B1 đỏ (§2) |
| T17 (bench B1b) | M1–M3 bỏ từng điểm huỷ Modbus (socket close · `disconnect()` · `connect()`) ⇒ đúng ca (i) / (ii) / (iii) đỏ (mỗi lượt 1); M4 `writeOne` gộp lỗi vào ok:false ⇒ 6 đỏ; M5 dispatcher ánh xạ mất liên kết ⇒ `failed` ⇒ 6 đỏ; M6–M20 bỏ từng điểm huỷ ở S7 / MC / EIP / OPC UA, SLMP quay về lỗi thường ⇒ đúng ca của nó đỏ (15/15). Mã cũ: tệp tái hiện 6/8 đỏ (REPRO 5009 ms `timeout`, (i)/(ii)/(iii) ~790–800 ms `failed`, STOP kế tiếp 5008 / 5997 ms); bench chạy khô `--cat-lien-ket` trên mã cũ: 5150 / 5126 ms |

## 9. Danh sách R1b-2b-2

Danh sách 1-1 ở kế hoạch `docs/superpowers/plans/2026-10-26-scada-r1b-2b-1-an-toan-va-no.md`, mục **"Danh sách R1b-2b-2 (chỉ liệt kê — kế hoạch
riêng)"** (số giữ theo báo cáo R1b-2a §11). Mười mục mới từ R1b-2b-1 (61–63 theo thứ tự điều phối 2026-10-26; 64 từ T6 fix round 1; 65, 66 từ T17; 67, 68 từ T16 Step 3 / 5; 69, 70 từ rà soát cuối toàn nhánh; thứ tự ưu tiên 61 → 66 → 62, điều phối 2026-10-27):

- **61 (ƯU TIÊN ĐẦU R1b-2b-2; thứ tự 61 → 66 → 62)** — lượt ghi bắn-rồi-quên CÓ TỪ TRƯỚC trên đường `dungMay` (attempts + audit của `tuChoiQuaHan`, vòng `STOP_QUA_HAN`
  theo adapter, mọi `recordAuditEvent`) vào CÙNG bộ đếm trần T9; bỏ qua audit khi đầy phải log nội dung hàng; trần theo tiến trình. Gộp thành MỘT
  ngân sách "truy vấn có thể bị bỏ rơi" dùng chung với khe khảo sát T1 (8) và sổ treo T9 (8) ≤ pool − dự trữ 9 (§6 VẬN HÀNH 3; rà soát cuối I-1).
- **62** — interlock `resolveEvent`: đọc luật + kiểm phạm vi adapter dưới `khoaDichLuatTx` (adapter FOR SHARE → luật), không gọi pool trong giao dịch.
- **63** — census thứ tự khoá ADAPTER → LUẬT interlock + cấm gọi pool (`getDb()`) bên trong giao dịch đang giữ khoá hàng.
- **64** — đọc lại THÔ thật từ driver (giá trị trước scale) cho so đọc lại tag int có scale lẻ — R1b-2b-1 T16 phát hiện làm tròn che lỗi (§6 LOGIC mục 1).
- **65** — thử lại STOP MỘT lần trên kết nối mới trong hạn tổng 2,5 s — chủ dự án quyết (điều phối 2026-10-27: không làm ở R1b-2b-1).
- **66 (ƯU TIÊN — thứ tự 61 → 66 → 62)** — hết hạn yêu cầu của CHÍNH driver (Modbus 800 ms, S7/MC/EIP 5000 ms cố định, OPC UA, SLMP) ⇒ `timeout` (chưa rõ)
  thay vì `failed` — lệnh có thể đã tới thiết bị (§6 LOGIC mục 18 (a)).
- **67** — bench cắt liên kết ổn định, ví dụ một OpenPLC riêng cho mỗi adapter hoặc proxy phần cứng. Lý do: ở R1b-2b-1, ô đối chứng proxy thông suốt ĐỎ trên OpenPLC dùng chung (§3 lượt 3).
- **68** — hành vi SẢN PHẨM của bộ giới hạn dưới tải vòng lặp sự kiện. Khi vòng lặp của tiến trình API trễ ≥ 250 ms, lệnh tới một Redis KHOẺ cũng chạm
  `commandTimeout` 250 ms ⇒ bộ giới hạn rơi về đếm trong bộ nhớ theo tiến trình (đếm tách đôi Redis / bộ nhớ, không fail-open; §6 VẬN HÀNH 3). Cần xét:
  ngưỡng / bộ ngắt mạch / đo trễ vòng lặp trước khi coi Redis là chậm.
  Phần THIẾT BỊ ĐO của mục này (ca Redis khoẻ của `rateLimitConfig.duPhongBoNho.test.ts` đỏ do tải) đã sửa ở R1b-2b-1 (T14 load-robustness fix, 2026-10-27, §5).
- **69** — OPC UA: mất liên kết giữa một lô ghi (`opcuaDriver.ts` ~941 ném lỗi có kiểu cho cả `writeTags`) ⇒ các write CHƯA BAO GIỜ được gửi (vd hỏng
  ép kiểu cục bộ) cũng mang nhãn `timeout` thay vì `failed`. Chiều an toàn (không ack giả); trả lỗi theo từng item cho phần chưa chuẩn bị (rà soát cuối M-9).
- **70** — mục rủi ro "lệnh ghi cũ" gộp (`otDeviceWrite.ts` ~214) lớn dần khi liên kết chập chờn: mỗi lần huỷ vì mất liên kết trong cửa sổ nối thêm
  intents / writes và nới `untilHuuHan` ⇒ dưới lệnh liên tục mục không bao giờ hết hạn. Cần trần mảng GIỮ ý định ĐẦU TIÊN (N3; rà soát cuối M-10).

Lỗi R1-đc (§6 LOGIC mục 1) là ô ĐỎ của R1b-2b-1 — đã sửa ở T6 fix round 1 trước bàn giao; chỉ giới hạn còn lại (mục 64) sang R1b-2b-2.

## Phụ lục A — `task-2-census.sql` (NGUYÊN VĂN, chỉ đọc)

Chạy trên DB đích bằng psql: `BEGIN TRANSACTION READ ONLY;` → dán / `\i` khối dưới → `ROLLBACK;`. Q1–Q6 là CỔNG (mọi câu phải 0 hàng); I1 là kiểm kê.

```sql
-- SCADA R1b-2b-1 Task 2 — CENSUS TRƯỚC (cổng dừng C12 / Q2 / điều kiện 1a). CHỈ ĐỌC: mọi câu là SELECT thuần, chạy được
-- trong một transaction read_only (BEGIN TRANSACTION READ ONLY; ... ; ROLLBACK;). Không hàm tạm, không bảng tạm, không tham số.
--
-- TẬP HỢP LỆ (8 giá trị): jsonb boolean; jsonb number đúng bằng 0 hoặc 1; jsonb string mà lower(btrim(.)) ∈ ('0','1','true','false').
--   btrim của Postgres chỉ cắt dấu cách; JS trim() cắt cả TAB / xuống dòng / NBSP ⇒ SQL BÁO DƯ (không bỏ sót) với "\ttrue".
-- Luật interlock: commandValue NULL / jsonb null ⇒ gửi `true` (giaTriLenhInterlock) ⇒ HỢP LỆ.
-- Write FOE: thiếu `value` / jsonb null ⇒ KHÔNG hợp lệ (dispatch nhận undefined/null).
--
-- LỚP ĐỊA CHỈ BIT (lop_bit), theo đúng bộ phân tích của driver:
--   modbus_coil          — protocol modbus; "coil:N" | "0x:N" | số Modicon thuần 1..9999 (modbusDecode.parseModbusAddress)
--   modbus_holding_bool  — protocol modbus; dataType bool trên holding ("holding:N" | "4x:N" | 40001..49999) — encodeModbus("bool")
--   slmp_bit             — protocol slmp; device ∈ SLMP_BIT_DEVICES (slmpEncoder.ts) — slmpDriver ghi bit khi `dev.isBit` bất kể dataType
--   mc_bit               — protocol mitsubishi-mc; device ∈ BIT_DEVICES (mcAddress.ts) hoặc "<word>.<bit>"
--   s7_bit               — protocol s7; "DB<n>,X<o>.<b>" hoặc vùng M/I/E/Q/A/PI/PQ có modifier X hoặc ".bit" (s7Address.ts) — THÊM để báo dư
--   (ethernet-ip / opcua: địa chỉ là TÊN — không suy ra bit từ địa chỉ; tag bool của chúng đã phủ ở Q1–Q3 theo dataType.)
--
-- Q1–Q6 là CỔNG (≥ 1 hàng ở bất kỳ DB nào ⇒ DỪNG). I1 chỉ là KIỂM KÊ (không phải cổng).

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q1 (brief a) — luật interlock BẬT, action <> 'alert', đích là tag dataType bool, commandValue NGOÀI tập hợp lệ.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT r.id, r.name, r."targetAdapterId", t."tagKey", t.address, t."dataType"::text AS kieu, r."commandValue", r.action::text AS action
FROM interlock_rules r
JOIN device_tags t ON t."adapterId" = r."targetAdapterId" AND t."tagKey" = r."commandTag"
WHERE r.enabled AND r.action::text <> 'alert' AND t."dataType"::text = 'bool'
  AND NOT (
        r."commandValue" IS NULL
     OR jsonb_typeof(r."commandValue") IN ('null', 'boolean')
     OR (CASE WHEN jsonb_typeof(r."commandValue") = 'number' THEN (r."commandValue" #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(r."commandValue") = 'string' AND lower(btrim(r."commandValue" #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY r.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q2 (brief b) — write FOE (bước `command` ở MỌI độ sâu: steps / then / else / compensation; args.writes[] hoặc args.tagKey+value)
-- lên tag dataType bool với giá trị NGOÀI tập hợp lệ. Bảng đầu (orchestration_workflows, mọi status) + lịch sử phiên bản
-- (orchestration_workflow_versions — rollback triển khai lại bản cũ). Adapter: args.adapterId (số) nếu có, ngược lại MỌI adapter
-- gắn máy của bước (báo dư so với "đúng một adapter bật" của engine).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH dinh_nghia AS (
  SELECT 'orchestration_workflows'::text AS bang, w.id AS wf_id, w.ref, w.version, w.status::text AS trang_thai, w."definitionJson" AS def
  FROM orchestration_workflows w
  UNION ALL
  SELECT 'orchestration_workflow_versions'::text, v."workflowId", v.ref, v.version, NULL::text, v."definitionJson"
  FROM orchestration_workflow_versions v
), buoc AS (
  SELECT d.bang, d.wf_id, d.ref, d.version, d.trang_thai, s AS step
  FROM dinh_nghia d
  CROSS JOIN LATERAL jsonb_path_query(d.def, 'strict $.** ? (@.type == "command")') AS s
  WHERE jsonb_typeof(s) = 'object'
), ghi AS (
  SELECT b.bang, b.wf_id, b.ref, b.version, b.trang_thai, b.step ->> 'id' AS step_id,
         b.step -> 'machineId' AS machine_j, b.step -> 'args' -> 'adapterId' AS adapter_j, x.tag_key, x.gia_tri
  FROM buoc b
  CROSS JOIN LATERAL (
    SELECT e ->> 'tagKey' AS tag_key, e -> 'value' AS gia_tri
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.step -> 'args' -> 'writes') = 'array' THEN b.step -> 'args' -> 'writes' ELSE '[]'::jsonb END) AS e
    WHERE jsonb_typeof(e) = 'object'
    UNION ALL
    SELECT b.step -> 'args' ->> 'tagKey', b.step -> 'args' -> 'value'
    WHERE jsonb_typeof(b.step -> 'args' -> 'writes') IS DISTINCT FROM 'array' AND jsonb_typeof(b.step -> 'args' -> 'tagKey') = 'string'
  ) AS x
)
SELECT g.bang, g.wf_id, g.ref, g.version, g.trang_thai, g.step_id, a.id AS adapter_id, t."tagKey", t.address, t."dataType"::text AS kieu, g.gia_tri
FROM ghi g
JOIN device_adapters a ON (
      (jsonb_typeof(g.adapter_j) = 'number' AND a.id::numeric = CASE WHEN jsonb_typeof(g.adapter_j) = 'number' THEN (g.adapter_j #>> '{}')::numeric END)
   OR (jsonb_typeof(g.adapter_j) IS DISTINCT FROM 'number'
       AND a."machineId"::numeric = CASE WHEN jsonb_typeof(g.machine_j) = 'number' THEN (g.machine_j #>> '{}')::numeric END))
JOIN device_tags t ON t."adapterId" = a.id AND t."tagKey" = g.tag_key
WHERE t."dataType"::text = 'bool'
  AND NOT COALESCE(
        jsonb_typeof(g.gia_tri) = 'boolean'
     OR (CASE WHEN jsonb_typeof(g.gia_tri) = 'number' THEN (g.gia_tri #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(g.gia_tri) = 'string' AND lower(btrim(g.gia_tri #>> '{}')) IN ('0', '1', 'true', 'false')),
     false)
ORDER BY g.bang, g.wf_id, g.version, g.step_id, t."tagKey";

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q3 (brief c) — tag dataType bool có stop_value KHÔNG phải jsonb boolean (validateStopValue chuẩn hoá bool ⇒ boolean).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t.stop_value, jsonb_typeof(t.stop_value) AS kieu_json,
       t.writable, t."isEnabled"
FROM device_tags t
JOIN device_adapters a ON a.id = t."adapterId"
WHERE t."dataType"::text = 'bool' AND t.stop_value IS NOT NULL AND jsonb_typeof(t.stop_value) <> 'boolean'
ORDER BY t.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q4 (điều kiện 1a) — ghim STOP trên MỌI tag có địa chỉ coil / bit (mọi dataType) mà stop_value NGOÀI tập 8 giá trị.
-- (Mọi tag, kể cả writable=false / tắt: ghim cũ sẽ sống lại khi tag được bật.)
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t."dataType"::text AS kieu, t.stop_value,
         t.writable, t."isEnabled",
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
)
SELECT id, "adapterId", giao_thuc, lop_bit, "tagKey", address, kieu, stop_value, jsonb_typeof(stop_value) AS kieu_json, writable, "isEnabled"
FROM tag_bit
WHERE lop_bit IS NOT NULL AND stop_value IS NOT NULL
  AND NOT (
        jsonb_typeof(stop_value) = 'boolean'
     OR (CASE WHEN jsonb_typeof(stop_value) = 'number' THEN (stop_value #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(stop_value) = 'string' AND lower(btrim(stop_value #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q5 (điều kiện 1a/iii) — write FOE lên tag có địa chỉ coil / bit (MỌI dataType) với giá trị NGOÀI tập hợp lệ
-- (gồm chuỗi truthy lạ "on" / "yes" / "true " — "true " sau btrim là hợp lệ, "on" / "yes" thì không).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t."dataType"::text AS kieu,
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
), dinh_nghia AS (
  SELECT 'orchestration_workflows'::text AS bang, w.id AS wf_id, w.ref, w.version, w.status::text AS trang_thai, w."definitionJson" AS def
  FROM orchestration_workflows w
  UNION ALL
  SELECT 'orchestration_workflow_versions'::text, v."workflowId", v.ref, v.version, NULL::text, v."definitionJson"
  FROM orchestration_workflow_versions v
), buoc AS (
  SELECT d.bang, d.wf_id, d.ref, d.version, d.trang_thai, s AS step
  FROM dinh_nghia d
  CROSS JOIN LATERAL jsonb_path_query(d.def, 'strict $.** ? (@.type == "command")') AS s
  WHERE jsonb_typeof(s) = 'object'
), ghi AS (
  SELECT b.bang, b.wf_id, b.ref, b.version, b.trang_thai, b.step ->> 'id' AS step_id,
         b.step -> 'machineId' AS machine_j, b.step -> 'args' -> 'adapterId' AS adapter_j, x.tag_key, x.gia_tri
  FROM buoc b
  CROSS JOIN LATERAL (
    SELECT e ->> 'tagKey' AS tag_key, e -> 'value' AS gia_tri
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(b.step -> 'args' -> 'writes') = 'array' THEN b.step -> 'args' -> 'writes' ELSE '[]'::jsonb END) AS e
    WHERE jsonb_typeof(e) = 'object'
    UNION ALL
    SELECT b.step -> 'args' ->> 'tagKey', b.step -> 'args' -> 'value'
    WHERE jsonb_typeof(b.step -> 'args' -> 'writes') IS DISTINCT FROM 'array' AND jsonb_typeof(b.step -> 'args' -> 'tagKey') = 'string'
  ) AS x
)
SELECT g.bang, g.wf_id, g.ref, g.version, g.trang_thai, g.step_id, a.id AS adapter_id, tb.giao_thuc, tb.lop_bit, tb."tagKey", tb.address, tb.kieu, g.gia_tri
FROM ghi g
JOIN device_adapters a ON (
      (jsonb_typeof(g.adapter_j) = 'number' AND a.id::numeric = CASE WHEN jsonb_typeof(g.adapter_j) = 'number' THEN (g.adapter_j #>> '{}')::numeric END)
   OR (jsonb_typeof(g.adapter_j) IS DISTINCT FROM 'number'
       AND a."machineId"::numeric = CASE WHEN jsonb_typeof(g.machine_j) = 'number' THEN (g.machine_j #>> '{}')::numeric END))
JOIN tag_bit tb ON tb."adapterId" = a.id AND tb."tagKey" = g.tag_key
WHERE tb.lop_bit IS NOT NULL
  AND NOT COALESCE(
        jsonb_typeof(g.gia_tri) = 'boolean'
     OR (CASE WHEN jsonb_typeof(g.gia_tri) = 'number' THEN (g.gia_tri #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(g.gia_tri) = 'string' AND lower(btrim(g.gia_tri #>> '{}')) IN ('0', '1', 'true', 'false')),
     false)
ORDER BY g.bang, g.wf_id, g.version, g.step_id, tb."tagKey";

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Q6 (điều kiện 1a/iii) — luật interlock BẬT, action <> 'alert', đích là tag có địa chỉ coil / bit (MỌI dataType), commandValue
-- NGOÀI tập hợp lệ (NULL / jsonb null ⇒ true ⇒ hợp lệ).
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT t.id, t."adapterId", a.protocol::text AS giao_thuc, t."tagKey", t.address, t."dataType"::text AS kieu,
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
)
SELECT r.id, r.name, r."targetAdapterId", tb.giao_thuc, tb.lop_bit, tb."tagKey", tb.address, tb.kieu, r."commandValue", r.action::text AS action
FROM interlock_rules r
JOIN tag_bit tb ON tb."adapterId" = r."targetAdapterId" AND tb."tagKey" = r."commandTag"
WHERE r.enabled AND r.action::text <> 'alert' AND tb.lop_bit IS NOT NULL
  AND NOT (
        r."commandValue" IS NULL
     OR jsonb_typeof(r."commandValue") IN ('null', 'boolean')
     OR (CASE WHEN jsonb_typeof(r."commandValue") = 'number' THEN (r."commandValue" #>> '{}')::numeric IN (0, 1) ELSE false END)
     OR (jsonb_typeof(r."commandValue") = 'string' AND lower(btrim(r."commandValue" #>> '{}')) IN ('0', '1', 'true', 'false'))
  )
ORDER BY r.id;

-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- I1 (KIỂM KÊ, KHÔNG phải cổng) — số ghim STOP trên tag địa chỉ coil / bit theo giao thức × lớp × dataType × kiểu json,
-- và số trong đó NGOÀI tập 8 giá trị (= Q4 gộp nhóm). Cho biết phạm vi mà luật lúc ĐẶT ghim (điều kiện 1b) sẽ chạm.
-- ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
WITH tag_bit AS (
  SELECT a.protocol::text AS giao_thuc, t."dataType"::text AS kieu, t.stop_value,
         CASE
           WHEN a.protocol::text = 'modbus' AND (
                  lower(btrim(t.address)) ~ '^coil:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^0x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 1 AND 9999 ELSE false END)) THEN 'modbus_coil'
           WHEN a.protocol::text = 'modbus' AND t."dataType"::text = 'bool' AND (
                  lower(btrim(t.address)) ~ '^holding:[0-9]+$'
               OR lower(btrim(t.address)) ~ '^4x:[0-9]+$'
               OR (CASE WHEN btrim(t.address) ~ '^[0-9]{1,15}$' THEN btrim(t.address)::numeric BETWEEN 40001 AND 49999 ELSE false END)) THEN 'modbus_holding_bool'
           WHEN a.protocol::text = 'slmp'
                AND substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+$')
                    IN ('X', 'Y', 'M', 'L', 'F', 'V', 'B', 'SM', 'SB', 'DX', 'DY', 'S', 'TS', 'TC', 'CS', 'CC') THEN 'slmp_bit'
           WHEN a.protocol::text = 'mitsubishi-mc' AND (
                  substring(upper(btrim(t.address)) FROM '^([A-Z]+)[0-9A-F]+(\.[0-9A-F]+)?$')
                    IN ('M', 'X', 'Y', 'B', 'S', 'L', 'F', 'SM', 'SB', 'DX', 'DY', 'V', 'TS', 'TC', 'CS', 'CC')
               OR upper(btrim(t.address)) ~ '^[A-Z]+[0-9A-F]+\.[0-9A-F]+$') THEN 'mc_bit'
           WHEN a.protocol::text = 's7' AND (
                  upper(btrim(t.address)) ~ '^DB[0-9]+,X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)X[0-9]+(\.[0-9]+)?$'
               OR upper(btrim(t.address)) ~ '^([MIEQAT C]|PI|PQ)[0-9]+\.[0-9]+$') THEN 's7_bit'
         END AS lop_bit
  FROM device_tags t
  JOIN device_adapters a ON a.id = t."adapterId"
  WHERE t.stop_value IS NOT NULL
)
SELECT giao_thuc, lop_bit, kieu, jsonb_typeof(stop_value) AS kieu_json, count(*) AS so_ghim,
       count(*) FILTER (WHERE NOT (
             jsonb_typeof(stop_value) = 'boolean'
          OR (CASE WHEN jsonb_typeof(stop_value) = 'number' THEN (stop_value #>> '{}')::numeric IN (0, 1) ELSE false END)
          OR (jsonb_typeof(stop_value) = 'string' AND lower(btrim(stop_value #>> '{}')) IN ('0', '1', 'true', 'false')))) AS ngoai_tap
FROM tag_bit
WHERE lop_bit IS NOT NULL
GROUP BY giao_thuc, lop_bit, kieu, jsonb_typeof(stop_value)
ORDER BY giao_thuc, lop_bit, kieu, kieu_json;
```
