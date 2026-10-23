# SCADA R0 · Kết nối thật — Báo cáo nghiệm thu (Task 12)

Ngày đo: 2026-10-23 · nhánh `feat/scada-r0` (worktree `D:\SOURCES\_scada_wt`) · máy Windows 11, Docker Desktop 29.8.2 (engine linux).
Mọi số dưới đây là **đo bằng đồng hồ thật**; không cổng nào được khai "đạt" mà không có phép đo. Ngưỡng **không nới**.

## Kết luận ngắn

| Cổng R0 | Stub DB (legacy) | Stub DB (HA) | Bench `pause` (TREO) | Bench `stop` (RESET) | OPC UA |
|---|---|---|---|---|---|
| 1. rút ⇒ mọi tag bad ≤ 2 chu kỳ | ĐẠT | ĐẠT | **KHÔNG ĐẠT** (1/6 lượt) | ĐẠT 6/6 | — |
| 2. M10 "mất kết nối" ≤ 5 s | ĐẠT | ĐẠT | **KHÔNG ĐẠT** (không bao giờ) | ĐẠT 6/6 | — |
| 3. `device_adapters.status` khớp ≤ 5 s | ĐẠT | ĐẠT | **KHÔNG ĐẠT** (không bao giờ) | ĐẠT 6/6 (⚠ xem 3.3) | — |
| 4. cắm lại ⇒ tốt ≤ 2 chu kỳ | **KHÔNG ỔN ĐỊNH** (đỏ 10/16 lượt) | sát ngưỡng (đỏ 2/15) | ĐẠT 6/6 | sát ngưỡng (đỏ 1/6) | — |
| 5. uncertain OPC UA tới màn | — | — | — | — | ĐẠT |

**R0 CHƯA đạt nghiệm thu.** Hai lỗi thật của mã các task trước (không phải của thiết bị đo):

1. **Đường TREO (`docker pause` = rút cáp phía PLC khi có switch ở giữa — trường hợp thực tế phổ biến nhất): adapter KHÔNG BAO GIỜ chuyển sang "mất".**
   Socket TCP vẫn mở ⇒ `ModbusDriver.isConnected()` vẫn `true` ⇒ cả watchdog legacy (`otManager.legacyTick`) lẫn supervisor HA
   (`healthTick`: `isConnected()` + `health()`) đều không thấy mất. Vòng poll vẫn phát loạt mẫu `bad/comm_lost/timeout` (cổng 1 có tín
   hiệu) nhưng sự kiện `onTick({ok:false, timeout:true})` chỉ đi vào bộ đếm (`ghiNhanDoc`), không vào trạng thái. ⇒ M10 hiện "connected"
   và DB giữ `connected` trong khi mọi tag xấu. Sở hữu: Task 5 (C1/C3 — trạng thái ở otManager/supervisor) + Task 6 (onTick).
2. **Cổng 4 ≈ thời gian nối lại + MỘT chu kỳ poll đầy đủ**: `taoVongPoll` (Task 2) chỉ đọc lần đầu sau `setInterval` (1000 ms), không đọc
   ngay khi subscribe. Cộng với khoảng nối lại nhanh `max(poll, 500)` (Task 5) và nhịp watchdog legacy 500 ms ⇒ legacy đo
   1956–2262 ms (đỏ 10/16), HA 1246–2205 ms (đỏ 2/15), bench stop 1848–2377 ms. Tách được bằng chẩn đoán "RAM `connected` lại":
   legacy nối lại sau ~770–1010 ms, rồi thêm ~1000–1200 ms tới lần đọc đầu.
3. **Đường TREO, cổng 1**: hạn đọc `tinhDeadlineMs(1000, 800) = max(2×1000, 800+1000) = 2000 ms` tính từ ĐẦU lần đọc kế tiếp; timeout
   từng giao dịch (800 ms) KHÔNG huỷ tick (phán quyết Task 3: timeout giữ theo từng tag). ⇒ bad = (chờ tới tick kế: 0–1000 ms) + 2000 ms;
   chỉ đạt khi lúc rút rơi đúng vào lần đọc đang bay. Sở hữu: Task 3/6 (phán quyết hạn đọc). Với cấu hình `timeoutMs ≤ 800`, cổng
   "≤ 2 chu kỳ" trên đường treo **không với tới được bằng công thức hiện tại**.

Đề xuất sửa (để task sở hữu quyết, KHÔNG làm ở Task 12): (a) N tick timeout liên tiếp ⇒ báo `lost` (hoặc driver tự lật `connected=false`
sau tick bị cắt hạn) — sửa (1); (b) `taoVongPoll` đọc ngay một lần khi bắt đầu — gỡ ~1 chu kỳ khỏi cổng 4; (c) hạn đọc cho đường poll
không vượt quá `poll + timeout` — sửa (3).

---

## 1. Lưới stub có kịch bản trên CSDL `_test` — `server/services/scada/r0NghiemThu.db.test.ts`

Đường chạy thật: otManager (legacy **và** HA — `.env` dev có `OT_CONN_HA_ENABLED=true`) + StubDriver + vòng poll chung + ingest.ts →
bộ đệm (`napTuOt`) + telemetryBus → `ot_telemetry` + `device_adapters.status` + `scadaDiag.danhSach` (tRPC caller, admin qua
`taoNguoiDungTest`). Adapter: poll 1000 ms, 18 tag, `connectionOptions.timeoutMs: 800`. Rút cáp = `simDatLoi({matKetNoi:true})`.
Trước khi rút: liên kết ổn định 11 s. Hỏi bộ đệm mỗi 20 ms, danhSach/DB mỗi 100 ms (số đo là cận trên). Mỗi cổng một `it`.

Số đo (ms) của các lượt chạy tuần tự (`npx vitest run -c vitest.db.config.ts …`), 3 lượt cuối cùng với tệp đã commit:

| Lượt | Nhánh | Cổng 1 (≤2000) | Cổng 2 (≤5000) | Cổng 3 mất (≤5000) | Cổng 3 có lại (≤5000) | Cổng 4 (≤2000) | chẩn đoán: nối lại |
|---|---|---|---|---|---|---|---|
| A | legacy | 58 | 123 | 111 | 1966 | **2102** | 1011 |
| A | HA | 24 | 33 | 123 | 1951 | 1354 | 247 |
| B | legacy | 255 | 237 | 249 | 2066 | 1089 | 16 |
| B | HA | 1037 | 1060 | 1085 | 1960 | 1433 | 346 |
| C | legacy | 419 | 453 | 530 | 1990 | 1988 | 909 |
| C | HA | 20 | 24 | 108 | 1968 | 1266 | 203 |

Toàn bộ cổng 4 qua mọi lượt hôm nay (kể cả bản trước khi chốt khung thời gian):
- legacy (16 lượt): 1984, 2035, 1971, 2140, 2055, 2013, 1997, 2262, 1956, 2058, 2085, 2017, 2057, 2102, 1089, 1988 — **đỏ 10/16**.
- HA (15 lượt): 1950, 1317, 1975, 1397, 1840, 1246, 1269, 1334, 2129, 1401, 1323, 2205, 1354, 1433, 1266 — đỏ 2/15.
- Cổng 1–3: xanh mọi lượt (cổng 1 ≤ 1037 ms, cổng 2 ≤ 1163 ms, cổng 3 ≤ 2066 ms).

⚠ **Điều tiết ghi DB 5 s** (Task 5): nếu lần ghi trước mới < 5 s, lần ghi `error` bị dời tới mốc 5 s. Đo được khi rút ~2 s sau lần ghi
`connected` lúc khởi động: cổng 3 "mất" = 2684–2896 ms (vẫn ≤ 5 s ở stub vì phát hiện nhanh). Trường hợp xấu nhất = phát hiện + gần 5 s
⇒ có thể vượt 5 s với liên kết chập chờn. Lưới chốt kịch bản "máy chạy ổn định" (11 s trước khi rút); trường hợp xấu nhất chưa có lưới.

## 2. Đột biến cấp hệ thống (Step 4)

| Đột biến (sửa `vi.stubEnv` trong lưới, chạy, hoàn tác) | Cổng đỏ | Số đo |
|---|---|---|
| `OT_CHAT_LUONG_V2_ENABLED=false` | **cổng 1** đỏ ở CẢ hai nhánh (+ cổng 4 do đợt mất kéo dài 18 s ⇒ rơi vào backoff) | cổng 1 = ∞ (tag giữ giá trị good cũ) |
| `OT_GHI_TRANG_THAI_ADAPTER_ENABLED=false` | **cổng 3** đỏ ở CẢ hai nhánh | DB trước khi rút = `disabled`, không bao giờ `error`/`connected` |

Phụ phẩm đáng ghi của đột biến: đợt mất dài ~11–18 s ⇒ legacy nối lại sau 4410 / 7467 ms (quá 10 lần nối nhanh ⇒ backoff lũy thừa
`OT_LEGACY_RECONNECT_MS` 5000). Cổng 4 vì vậy chỉ giữ được với đợt mất < ~10 s ở nhánh legacy; HA nối lại 152 ms trong cùng tình huống.

## 3. Bench OpenPLC — `scripts/scada-r0-bench.ts`

**Bench:** container `avi-openplc-bench`, ảnh `avi-openplc-bench:v3` (`sha256:180893084146519c837b7c54bfdf8a1b6b1174ba739390eac9256b0678ebf2df`,
tạo 2026-10-14), OpenPLC Runtime v3 (git `b5d41356dab4aeadca0dd7ca64ba542f870b595d`, 2026-04-04), Modbus `127.0.0.1:15502`, web
`127.0.0.1:18080`. Trạng thái ban đầu: **Exited** ⇒ `docker start`, runtime "Stopped" ⇒ đăng nhập `openplc/openplc` + Start; cuối cùng
đã `docker stop` trả về Exited. Chương trình nạp: `benchL2` (515787.st) — chỉ khai 3 coil `%QX0.0–0.2`.

**Bản đồ địa chỉ (đã xác nhận trên bench):** FC03 thanh ghi holding 0..17 (`%QW0..%QW17`) trả về 18 giá trị, không exception (giá trị 0
cố định vì chương trình không khai `%QW` — cổng đo chất lượng truyền thông, không đo giá trị). ⚠ Cú pháp tag của sản phẩm là **1-based**
(`modbusDecode.parseModbusAddress`): `holding:0..17` như kế hoạch viết bị TỪ CHỐI ("invalid Modbus register offset: 0" ⇒ mọi tag bad
`device_error`); đúng là `holding:1..18`. Bench dùng `holding:1..18`.

**Cách đo:** trong tiến trình, không DB, không :3000 — otManager THẬT (`startOt`) qua seam `setAdapterSource`, ModbusDriver THẬT,
`timeoutMs: 800`, poll 1000 ms, 18 tag; hai seam thay DB: `setTelemetryPersistFn` và `__datGhiDb` (ghi lại THỜI ĐIỂM lệnh UPDATE
`device_adapters.status`). Cổng 2 = trạng thái RAM `layTrangThaiAdapter` — đúng thứ `scadaDiag.danhSach` hiển thị (RAM đi trước DB).
Rút cáp đo từ lúc lệnh docker TRẢ VỀ (có in cả từ lúc bắt đầu lệnh). Cổng 4 đo từ lúc **Modbus thật sự trả lời lại**: một client thăm
dò riêng (kết nối mới, hạn 500 ms) đọc holding 0..17 mỗi 100 ms; lần thành công đầu tiên là mốc. Pha rút cáp ngẫu nhiên trong chu kỳ poll
(lượt đầu không ngẫu nhiên cho pha cố định ≈ −920 ms ⇒ đã sửa). 3 lượt mỗi tổ hợp:
`pnpm tsx scripts/scada-r0-bench.ts --endpoint tcp://127.0.0.1:15502 --poll 1000 --tags 18 --container avi-openplc-bench --timeout 800 --lap 3`.

### 3.1 `docker pause/unpause` (đường TREO) — nhánh legacy — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 2835 / 2697 / 2358 ms — đạt 0/3 (mẫu `bad/comm_lost/timeout`) |
| 2. M10 "lost" | ≤ 5000 ms | > 15000 / > 15000 / > 15000 — đạt 0/3 |
| 3a. ghi DB `error` sau khi rút | ≤ 5000 ms | > 15000 / > 15000 / > 15000 — đạt 0/3 |
| 3b. ghi DB `connected` sau khi Modbus trả lời | ≤ 5000 ms | không có chuyển trạng thái (adapter chưa từng `lost`) |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | 795 / 684 / 344 ms — đạt 3/3 |

Pha (mẫu good cuối so với lúc bắt đầu lệnh pause): −93 / −258 / −581 ms ⇒ tick kế tiếp ở +907 / +742 / +419 ms ⇒ bad ≈ tick kế + 2000 ms
(khớp 2835 / 2697 / 2358). Lệnh pause 66–81 ms; Modbus trả lời 85–88 ms sau unpause.

### 3.2 `docker pause/unpause` (đường TREO) — nhánh HA — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 2014 / 2693 / 1774 ms — đạt 1/3 |
| 2. M10 "lost" | ≤ 5000 ms | > 15000 × 3 — đạt 0/3 |
| 3a. ghi DB `error` | ≤ 5000 ms | > 15000 × 3 — đạt 0/3 |
| 3b. ghi DB `connected` | ≤ 5000 ms | không có chuyển trạng thái |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | 1004 / 593 / 598 ms — đạt 3/3 |

### 3.3 `docker stop -t 0/start` (đường RESET) — nhánh legacy — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 18 / 24 / 13 ms — đạt 3/3 (mẫu `bad/comm_lost/comm_lost`) |
| 2. M10 "lost" | ≤ 5000 ms | 18 / 24 / 13 ms — đạt 3/3 |
| 3a. ghi DB `error` | ≤ 5000 ms | 1 / 6 / 3 ms — đạt 3/3 |
| 3b. ghi DB `connected` sau khi Modbus trả lời | ≤ 5000 ms | 0 ⚠ / 1107 / 1095 ms — đạt 3/3 |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | **2377** / 1946 / 1998 ms — đạt 2/3 |

Lệnh `stop -t 0` 481–1088 ms; Modbus trả lời 5197–5268 ms sau `docker start` (runtime OpenPLC phải bấm Start qua web — script tự làm
sau 3 s); RAM `connected` lại 881–1375 ms sau khi Modbus trả lời.
⚠ **Chập chờn trong lúc thiết bị chết:** proxy cổng của Docker Desktop NHẬN kết nối TCP rồi đóng khi container chưa chạy ⇒ legacy "nối
được" rồi rớt, lặp lại (log `link lost — reconnecting` / `reconnected` ×5); trạng thái RAM nhảy lost↔connected và một lượt ghi DB
`connected` lúc +5013 ms (lần ghi trễ của điều tiết mang trạng thái mới nhất) trong khi PLC còn chết (Modbus trả lời ở ~+8,5 s). PLC thật
với cáp rút sẽ không nhận TCP, nhưng thiết bị/gateway nhận-rồi-đóng (hết slot kết nối) sẽ cho đúng hình này: M10/DB báo "connected" giả.

### 3.4 `docker stop -t 0/start` (đường RESET) — nhánh HA — 3 lượt

| Cổng | Ngưỡng | Đo được (từng lượt) |
|---|---|---|
| 1. rút ⇒ mọi tag bad (bộ đệm) | ≤ 2000 ms | 16 / 15 / 12 ms — đạt 3/3 |
| 2. M10 "lost" | ≤ 5000 ms | 16 / 15 / 12 ms — đạt 3/3 |
| 3a. ghi DB `error` | ≤ 5000 ms | 3 / 1 / 3 ms — đạt 3/3 |
| 3b. ghi DB `connected` sau khi Modbus trả lời | ≤ 5000 ms | 953 / 940 / 952 ms — đạt 3/3 |
| 4. Modbus trả lời ⇒ mọi tag good | ≤ 2000 ms | 1898 / 1848 / 1849 ms — đạt 3/3 (biên ~100–150 ms) |

HA không chập chờn (DB: `lost@~0`, `lost@~5010` trễ, `connected@~10020`).

## 4. Cổng 5 — uncertain của OPC UA tới màn — `server/services/scada/r0OpcuaUncertain.test.ts`

OPCUAServer node-opcua trong tiến trình (cổng HĐH cấp, SecurityMode None), biến `U` = 42.5 với StatusCode
`UncertainLastUsableValue`, biến `G` Good. OpcuaDriver.subscribe → `ingestSamples` → telemetryBus thật (chỉ khâu ghi thay bằng
`setTelemetryPersistFn`) → bộ đệm (`napTuOt`) → `scada:subscribe` trên socket giả ⇒ snapshot `["…","u",42.5,"uncertain",…,stale:false,
"device_error"]`; hàng ghi mang `quality:"uncertain"`, `numValue 42.5`, `meta.statusCode` chứa `UncertainLastUsableValue`.
Đối chứng cờ `OT_CHAT_LUONG_V2_ENABLED` tắt ⇒ `bad`, `v:null`. **ĐẠT** (2/2, chạy 3 lần).

## 5. Chạy toàn bộ (Step 7)

- `npx vitest run server/services/ot server/services/scada server/services/interlock server/_core/socket*` (cấu hình mặc định, song
  song): **123 tệp, 1693 test: 1646 qua, 25 đỏ, 22 bỏ qua.** 24/25 đỏ là do TẢI của lô song song trên PG `_test` dùng chung
  (`53300 remaining connection slots…`, `57014 statement timeout`, PKI watcher quá hạn 15 s) — chạy lại riêng: 6 tệp DB
  (`-c vitest.db.config.ts`) 131/131 xanh, `opcuaDriver.secure.sim` + `r0OpcuaUncertain` 18/18 xanh. Đỏ còn lại = cổng 4 legacy của
  `r0NghiemThu.db.test.ts` (2057 ms) — lỗi thật đã nêu.
- `npx vitest run -c vitest.db.config.ts server/services/scada/r0NghiemThu.db.test.ts`: 8 test; 3 lượt cuối: 7/8, 8/8, 8/8.
- `npm run check`: xanh (rc 0). (tsconfig gốc loại `*.test.ts` và `scripts/` — ba tệp mới được kiểm riêng bằng tsc, 0 lỗi.)

## 6. Bàn giao

- Không push. `.env.example` thêm `OT_CHAT_LUONG_V2_ENABLED=false`, `OT_GHI_TRANG_THAI_ADAPTER_ENABLED=false`.
- Trước khi bật cờ ở dev: sửa (1) đường TREO không báo mất và (2) lần đọc đầu sau subscribe — cả hai làm M10 nói sai/ chậm trên thiết bị thật.
