# Phụ lục BE1 — Lớp kết nối hiện trường (driver): mức sẵn sàng cho thiết bị thật

> Thuộc doc 81. 2026-09-27. "Đo" = chạy qua lớp driver/client của **sản phẩm** (`npx tsx` import tệp trong repo) với server/giả lập giao thức cục bộ ở cổng cao; "đọc mã" = chỉ đọc. DB chỉ SELECT (`default_transaction_read_only=on`). Số thô (ngoài repo): scratchpad phiên `B1-drivers/` (`opcua_raw.txt`, `modbus_results.json`, `boot15_*.txt`, `neg_*.txt`, `slmp_raw.txt`, `proto_*.txt`, `db_*.txt`, `vitest_ot.txt`, giả lập `modbus_server.cjs`, `cfx_broker.cjs`, mã thử `*_test.mts`).
> Thang mức: M0 không có · M1 khung · M2 cài thật + test mock · M3 chạy thật end-to-end với giả lập · M4 chứng minh trên thiết bị thật (FAT) · M5 sẵn sàng sản xuất.

## 0. Kết luận

- **Chưa giao thức nào đạt M4. Chưa từng có dòng dữ liệu nào từ driver thật vào DB dev:** 7 ngày gần nhất 166 triệu dòng `ot_telemetry`, **100 % là bộ phát giả `meta.source='SIM-OT'`** (~800 nghìn dòng/giờ); mọi dòng `protocol='opcua'` (70.500, ngày 2026-07-13) là benchmark `{"bench":true,"synthetic":true}`; modbus, s7, ethernet_ip, mtconnect, mqtt, sparkplug: **0 dòng trong suốt lịch sử**.
- **Test đơn vị không thấy lỗi nghiêm trọng nào** (17 tệp driver/supervisor/Techman xanh 161/161 trong 1,25 s) — **nhưng phép thử thật tìm ra 3 lỗi P0 mà mock che mất:**
  1. **Modbus và Techman treo vĩnh viễn** khi thiết bị không nối được hoặc sau khi mất kết nối: `modbus-serial` chỉ gọi callback `close(cb)` khi socket phát sự kiện `close`; socket đã đóng ⇒ callback không bao giờ chạy; driver `await` nó trong `connect()` (nhánh catch) và `disconnect()` (`modbusDriver.ts`, `techmanDriver.ts:234,244`; thư viện `tcpport.js:203`).
  2. **Mitsubishi MC (`mcprotocol`) có thể làm SẬP tiến trình:** `dropConnection()` không nhận callback ⇒ `connect()` lỗi và mọi `disconnect()` treo; `connectionCleanup` gỡ listener `error` khỏi socket còn kết nối ⇒ ~21 s sau `ETIMEDOUT` không ai bắt ⇒ `uncaughtException` ⇒ handler `server/_core/index.ts:6589` gọi `process.exit(1)`. Suy ra (chưa thử qua HTTP vì sẽ đánh sập server dùng chung): **`deviceAdapter.testConnection` chỉ cần `machine_control:canView` — nhập sai IP cho một adapter `mitsubishi-mc` là có thể làm sập server.**
  3. **Bật `OT_GATEWAY_ENABLED` sẽ làm boot treo:** `await startOt()` (`index.ts:6300`) chạy trước `server.listen` (`index.ts:6420`), vòng khởi động adapter tuần tự. **Phát lại đúng 15 dòng `device_adapters` của DB qua driver + supervisor sản phẩm: cả nhánh HA lẫn legacy kẹt vô hạn (>90 s) ở adapter thứ 3 `ADP-SIM-L1-ASSY` (Modbus 127.0.0.1:5020)** ⇒ HTTP server không bao giờ listen.
- **Đính chính tài liệu cũ:** doc 54 / doc 80 ghi "15 adapter disabled" — **thực tế cả 15 có `isEnabled=true`**; chưa chạy chỉ vì `OT_GATEWAY_ENABLED` vắng trong `.env` và không tiến trình nào nghe ở 4840–4842, 5020, 1102, 44818. Adapter S7 (1102) và EIP (44818) không có simulator nào trong repo (README `scripts/sim-factory` tự ghi là "khung").

## 1. Theo giao thức

### 1.1 PLC & I/O (`server/services/ot/drivers/*`)

| Driver / thư viện | Mức | Kết quả đo | GAP tới M4/M5 |
|---|---|---|---|
| **OPC UA** `opcuaDriver.ts`, `node-opcua` 2.174 | **M3** | server :48400: connect 133 ms; đọc 5 tag 6 ms; 200 tag p50 6 / max 18 ms; ghi+đọc lại Double/String đúng; poll 500 ms trễ 40–439 ms; monitored-item 6/6; kill server: supervisor phát hiện <0,5 s, có dữ liệu lại 3,3 s sau khi bật lại (**nhánh legacy: 0 mẫu sau khi bật lại**); host không định tuyến 3 017 ms, cổng đóng 28 ms. **Server chỉ cho SignAndEncrypt ⇒ không kết nối được** (chỉ SecurityMode None, không PKI). **Ghi `BadTypeMismatch` với Float/Int16/UInt16/UInt32/Byte** (luôn ép Int32/Double). **Một địa chỉ sai làm hỏng cả lô đọc** | Basic256Sha256 + SignAndEncrypt, trust-list/PKI, chứng chỉ người dùng; đọc DataType rồi ép kiểu; `nsu=`; cô lập lỗi theo tag; browse đệ quy; FAT S7-1500, Omron NX, KEPServerEX |
| **Modbus TCP** `modbusDriver.ts`, `modbus-serial` 8.0.25 | **M3 nhưng có P0** | ServerTCP :50200: đọc 4 tag như DB, float BE, int16 âm, coil/DI/IR đúng; **100 tag p50 1 301 ms** (mỗi tag một giao dịch); ghi int/float/coil/scale đúng; ghi IR bị từ chối đúng; exception 2 đúng; **ghi 70000 trả `ok:true` nhưng đọc lại 4464** (cắt `& 0xffff` im lặng); server treo ⇒ 1,5 s/tag rồi bad; **kill server: sau 20 s vẫn `reconnecting`, số lần thử đứng ở 2; `sup.stop()` treo >8 s; cổng đóng/IP không định tuyến treo >10 s dù timeoutMs=3000** | close/destroy có hạn giờ; đọc gộp khối; int32/uint16/uint32 + word-order theo tag; báo lỗi tràn; RTU/gateway; FAT |
| **Siemens S7** `s7Driver.ts`, `nodes7` 0.3.18 | **M2** | chỉ nhánh lỗi: cổng đóng 2,6 s; không định tuyến 5,5 s (lỗi hiện `[object Object]`); server treo/rác timeout 3 s. Không có giả lập S7 | snap7/PLCSIM Advanced; FAT S7-1200/1500; STRING/DINT/REAL theo tag |
| **EtherNet/IP** `ethernetIpDriver.ts`, `st-ethernet-ip` 2.7.5 | **M2** | chỉ nhánh lỗi: cổng đóng 1,1 s, không định tuyến 3 s; **cổng khai trong endpoint bị bỏ qua** (luôn 44818); lỗi chỉ "SOCKET error" | giả lập CIP; FAT CompactLogix; Omron NJ/NX phải kiểm tương thích |
| **Mitsubishi MC 1E** `mitsubishiMcDriver.ts`, `mcprotocol` 0.1.2 | **M2 — P0 sập server** | cổng đóng/không định tuyến treo >12 s; `UNCAUGHT_EXCEPTION ETIMEDOUT` ~21 s sau; server treo/rác: đọc `BAD 255`, **disconnect treo >5 s** | **ĐỪNG DÙNG** — chuyển sang SLMP 3E hoặc sửa hẳn (destroy socket, giữ listener `error`) |
| **SLMP 3E/4E** `slmpDriver.ts` + `slmpEncoder.ts` (`node:net` tự viết) | **M3** (với mock SLMP độc lập viết theo đặc tả SH-080956) | 3E và 4E (có serial): đọc D/âm/float/M/X1F đúng; ghi D/float/M đọc lại đúng; endCode C056 ⇒ bad; 100 tag 5 ms; cổng đóng báo ngay 3 ms; disconnect sạch. **D300=40000 đọc ra −25536** (chỉ Int16) | 32-bit; lệnh 0403/0406; ASCII; UDP; FAT FX5U/iQ-R (thứ tự nibble, cổng Open-Setting) |
| Stub | M1 | ghi luôn `ok:false` | — |

### 1.2 Giao thức khác

| Giao thức | Mức | Kết quả / ghi chú | GAP |
|---|---|---|---|
| **MTConnect** (axios + parser regex) | M3 | sim repo :50501: probe 119 ms, current 6 mẫu, sample 10 mẫu; XML cppagent 2.0 parse đúng (PartCount xếp vào SAMPLE, Load=UNAVAILABLE vào EVENT); **agent tắt ⇒ trả `[]` sau 6 ms, không báo lỗi**; poll có thể chồng nhau; không `nextSequence` | `/sample` theo sequence; phát hiện agent chết; parser XML thật; FAT FANUC/Mazak/Okuma |
| **SECS/GEM HSMS** (codec tự viết) | M3 — **tự so với chính mình** | sim `scripts/sim/hsms-equipment.ts` :50500: S1F2/F14/F18 đúng, 3 alarm + 4 event trong 5 s; **kill thiết bị ⇒ vẫn `SELECTED/COMMUNICATING/ONLINE_REMOTE`**; sim dùng lại codec repo | thư viện đã kiểm định hoặc bộ GEM compliance; passive; T3–T8; reconnect |
| **IPC-CFX** (AMQP 1.0, `rhea` 3.0.5) | M3 | UnitsProcessed / StationStateChanged / FaultOccurred đúng; **body gzip parse lỗi**; kill cứng broker ⇒ nối lại, 32 mẫu/8 s; **broker đóng êm ⇒ 6 s vẫn chưa gắn lại**; TLS không có CA/client cert | TLS/CA; gzip; RabbitMQ AMQP 1.0 + endpoint CFX thật |
| **VDA 5050** (MQTT, `mqtt` 5.15) | M3 | aedes :51883 + `scripts/sim/vda5050-agv.mjs`: state (pin 87 %), order publish, AGV chạy tới (1,04; 0,69); **instantActions báo "job has no usable nodes"**; **kill AGV / tắt broker ⇒ vẫn `connected:true`**; `abort` rỗng | instantActions/cancelOrder, factsheet, LWT, sửa publish trùng; FAT AGV/AMR |
| **MQTT ingest** (aedes nhúng) | telemetry M2 · inspection M0 | chưa đo (ghi DB); bridge `synapse/…/telemetry` → `ot_telemetry` TẮT (`MQTT_TELEMETRY_BRIDGE_ENABLED` vắng); topic inspection không lưu; thiết bị lạ tự đăng ký PENDING | bật bridge; tắt tự nhận thiết bị lạ; persistence; soak |
| **REST ingest** `/api/v1/ingest/*`, `/api/machine/*` | M3 (pilot doc 56 Đ3) | `/api/v1/ingest/telemetry` không khoá ⇒ 401; `/api/ot/ingest` kiểm body trước quyền (400); `process_results` 5 932 dòng, mới nhất 2026-07-19 | FAT firmware thật; benchmark phần cứng production |
| **Hot-folder** (AOI/AVI, chokidar) | M2 | `hot_folder_configs` **0 dòng** dù cờ bật; parser các hãng (Saki, Koh Young, Mirtec, Cognex, Keyence, TRI) là "ASSUMED SHAPE", fixture tự tạo; không Omron, không CyberOptics | file xuất thật từng hãng, golden test, SMB |
| FANUC FOCAS | M1 | chỉ mapping; `testConnection` luôn `ok:false`; không link Fwlib | Fwlib32/64 + tuỳ chọn Ethernet CNC, hoặc qua MTConnect |
| Euromap 63/83 | M0 | chỉ enum | — |
| Euromap 77 | M1–M2 | dùng lại driver OPC UA (mang lỗi không bảo mật); mỗi yêu cầu connect/đọc/ngắt; nodemap tay | SignAndEncrypt + companion nodeset |
| IO-Link | M1 | bảng dữ liệu, không module nào import | — |

### 1.3 Robot & chuyển động

| Driver | Mức | Ghi chú |
|---|---|---|
| **Techman** (`modbus-serial` + TCP 5890) | M2 — **P0 treo** | connect tới cổng đóng/IP không định tuyến **treo >12 s** (cùng lỗi `close(cb)`); bảng thanh ghi 7000–7015 **repo tự khai là placeholder** (int16, 0,01°) — phải đối chiếu tài liệu Modbus TMflow; (xem thêm BE2: checksum TMSCT sai, mọi reply ⇒ `done`) |
| FANUC RMI (`node:net`) | M2 | timeout FIFO, không reconnect, 13 test mock; mã ghi đã đối chiếu B-84184EN; cần tuỳ chọn R912 RMI + FAT |
| UR (`ursimBridge.ts` 30002/29999) | M2 | test repo có socket loopback thật; không RTDE (30004) |
| Zmotion (`zauxFfi.ts`, koffi + `zauxdll.dll`) | M1 | **koffi không có trong `node_modules`**; deploy `ok:false`; bỏ qua dispatcher/interlock (FLOW-03) |

**Dữ liệu robot:** bảng `robots` có UR-01 và FANUC-01 `status="online"` nhưng `lastSeenAt=NULL` và không tiến trình nào nghe 30002/16001 — "online" là dữ liệu seed cũ.
Chỉ đọc mã (chưa chạy): ROS2 (M2, không reconnect), Sparkplug B publish (M2; NDEATH bdSeq lệch NBIRTH), plugin sidecar (M2), NATS (M2).

## 2. Đường từ thiết bị thật vào nền tảng

1. **Driver poll (otManager)** — OPC UA/Modbus/S7/SLMP/MC/EIP → `ingest.ts` → `telemetryBus` → `ot_telemetry`. **Đang tắt** (`OT_GATEWAY_ENABLED` vắng); mặc định ghi từng mẫu (`TELEMETRY_BATCH_ENABLED` tắt); thêm/sửa adapter **không tự nạp lại**; **bị chặn bởi 3 P0 ở §0.**
2. **REST** — `/api/v1/ingest/{inspection,process-result,telemetry}`, `/api/machine/*` (submit-inspection, heartbeat, config-sync), `/api/ot/ingest` — **tuyến duy nhất đã có pilot live** (doc 56 Đ3).
3. **MQTT** — chỉ `factory/…/sensor/*` → `machine_sensor_readings` (PdM) đang bật; bridge `synapse/` tắt; inspection qua MQTT không lưu.
4. **Hot-folder** — cờ bật nhưng 0 thư mục cấu hình.
5. **MTConnect / CFX / SECS-GEM / VDA 5050** — client thật, cờ riêng (SECS cần thêm `SECS_GEM_LIVE_ENABLED`).
6. **Edge gateway** (`server/edge/edgeGatewayMain.ts`) → Sparkplug → UNS — không thấy thành phần trung tâm chuyển Sparkplug DDATA thành `ot_telemetry`. **C# EdgeCore chỉ nói HTTP REST + MQTT, không OPC UA/Modbus** (chưa build).

| Họ thiết bị | Tuyến nên dùng | Điều kiện trước |
|---|---|---|
| Siemens S7-1200/1500 | OPC UA (licence runtime) | driver phải có bảo mật + ép kiểu; S7 (nodes7) chỉ dự phòng, cần PUT/GET |
| Mitsubishi iQ-R/iQ-F/FX5U, Q | SLMP 3E binary | thêm 32-bit; **không dùng `mcprotocol`** |
| Omron NJ/NX | OPC UA (NX102/NX1P2/NJ) | FINS chưa có; EIP chưa kiểm với Omron |
| Zmotion | **chưa có đường an toàn** | koffi + DLL + cổng ghi chung; telemetry có thể qua Modbus TCP của ZMC (sau khi sửa lỗi treo) |
| Techman | Modbus (trạng thái) + Listen Node (lệnh) | sửa lỗi treo; bảng thanh ghi thật |
| AOI/AVI | máy nội bộ: REST `/api/v1/ingest/inspection` (+ảnh); máy hãng: hot-folder | file mẫu thật từng hãng |
| CNC FANUC | MTConnect agent trên PC edge | FOCAS native chưa có |
| Máy ép nhựa | Euromap 77 qua OPC UA | driver cần SignAndEncrypt |
| IoT ESP32 | REST telemetry khoá `mk_` (SDK `examples/device-client`) | MQTT chỉ khi bật bridge + bỏ tự nhận thiết bị lạ |

**Chưa ai kiểm đầu–cuối:** otManager → ingest → `ot_telemetry` (0 dòng thật trong lịch sử); MQTT bridge; hot-folder với file thật; Sparkplug edge → trung tâm; C# EdgeCore; reconnect ở quy mô nhiều adapter; HA supervisor ↔ presence.

## 3. Checklist HW-FAT theo họ thiết bị

**Chung:** connect ≤2 s; đọc N tag p95 ≤ ½ chu kỳ poll; giá trị/đơn vị/scale khớp HMI 100 % (≥20 điểm); kiểu biên (âm, >32767, DINT, REAL, STRING, BOOL); rút cáp ⇒ phát hiện ≤2 chu kỳ, cắm lại ⇒ dữ liệu ≤10 s, không treo/crash/rò socket, lặp 20 lần; tắt nguồn PLC khi chạy — như trên; **thiết bị tắt lúc server khởi động ⇒ HTTP vẫn listen ≤5 s**; soak 24 h (bộ nhớ, socket phẳng, mất mẫu ≤0,1 %); lệch timestamp ≤1 s; ghi chỉ qua dispatcher/commissioning/interlock, đọc lại khớp, giá trị tràn bị từ chối; biên bản `commissioning_records` ký tay.

| Họ | Tiêu chí riêng |
|---|---|
| Siemens S7-1200/1500 | OPC UA Basic256Sha256 SignAndEncrypt + user, trust cert hai chiều; ghi REAL/INT/DINT/BOOL đúng kiểu (Float/Int16 đang lỗi); namespace đúng sau khi tải lại project; S7: PUT/GET, DB không tối ưu, rack/slot |
| Mitsubishi iQ-R/FX5U | SLMP 3E/4E qua Open-Setting; D, M, X/Y (bát phân FX), counter DINT đúng dấu; thứ tự nibble ghi bit; endCode hiện rõ; không MC 1E tới khi hết P0 |
| Omron NJ/NX | OPC UA (hoặc FINS); biến "Network Publish"; LREAL/INT/STRING |
| Zmotion | chỉ FAT sau khi ghi qua cổng chung; tải BASIC, checksum, rollback; e-stop độc lập phần mềm; mất Ethernet ⇒ trục dừng an toàn |
| Techman | thanh ghi khớp TMflow (khớp, TCP, lỗi, chế độ); TMSCT chỉ khi flow ở Listen Node; stop/abort ≤200 ms; connect robot tắt nguồn không treo |
| AOI/AVI | mỗi hãng ≥50 file OK/NG thật khớp máy; chống trùng khi gửi lại; ảnh gắn đúng board; mất mạng ⇒ store-forward đủ, không trùng; SMB khoá ⇒ retry |
| CNC FANUC | MTConnect: execution/mode/part count/alarm (nativeCode) khớp màn CNC; agent chết phải phát hiện; không mất sự kiện giữa hai poll (`/sample`) |
| Máy ép (E77) | SignAndEncrypt; chu kỳ, áp suất, nhiệt, số shot; job/recipe chỉ đọc nếu chưa duyệt đường ghi |
| IoT ESP32 | onboarding token → `mk_`; retry idempotent; mất Wi-Fi 1 h đệm + đổ lại; xoay khoá; tắt nguồn ⇒ OFFLINE ≤ TTL |

## 4. Chưa kiểm được
Nhánh thành công S7/EIP/MC 1E (không có giả lập trong `node_modules`, không cài thêm); robot FANUC RMI/UR/MELFA/Delta, ROS2, Sparkplug, NATS, plugin sidecar (chỉ đọc mã); pipeline đầy đủ otManager → DB, MQTT ingest, hot-folder, REST ingest (ghi DB — chỉ SELECT; không chạy `scripts/sim-factory/simulator.mjs` vì POST vào :3000); P0 sập server qua `deviceAdapter.testConnection` bằng HTTP (sẽ đánh sập server dùng chung — suy từ lỗi tầng driver + mã router); C# EdgeCore (cần `dotnet restore`); Zmotion (không koffi/DLL); FOCAS, Euromap 63; thiết bị thật, chứng chỉ thật, tải nhà máy. Mock SLMP và listener CFX do agent tự viết; sim HSMS dùng chung codec với repo.
