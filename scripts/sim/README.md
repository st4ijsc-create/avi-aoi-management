# Nhà máy ảo — Device Simulators (doc 40 §13.4)

Bộ **6 simulator thiết bị ảo** để đánh giá TOÀN HỆ ở mức hoàn thiện cao nhất
**trước khi có phần cứng**. Mỗi simulator **nói protocol THẬT** (bind cổng thật /
nói MQTT thật) để driver của hệ thống kết nối vào như thiết bị thật — **không** bơm
dữ liệu thẳng vào DB, mọi dữ liệu chảy qua đúng driver/bus.

> KHÔNG đụng `.env` production. Simulator chỉ nhận tham số qua CLI/env truyền vào.
> Để bật các cờ ingest của hệ thống (SECS/GEM, PdM sensor…) hãy dùng file `.env.sim`
> riêng khi khởi động app — bộ simulator này độc lập với app.

## 6 simulator

| # | File | Protocol | Cổng mặc định | Driver hệ thống tiêu thụ |
|---|------|----------|---------------|---------------------------|
| 1 | `opcua-server.mjs` | OPC-UA (node-opcua) | `4840` TCP | `ot/deviceAdapter` (OPC-UA) |
| 2 | `modbus-slave.mjs` | Modbus TCP slave (modbus-serial) | `5020` TCP | Modbus driver |
| 3 | `hsms-equipment.ts` | HSMS / SECS-II passive (SEMI E37) | `5000` TCP | `secsgem/hsmsClient` |
| 4 | `mtconnect-agent.mjs` | MTConnect HTTP/XML (MTC1.4) | `5001` HTTP | `mtconnect/mtconnectClient` |
| 5 | `vda5050-agv.mjs` | VDA 5050 v2 qua MQTT | broker `1883` | `vda5050/vda5050Driver` |
| 6 | `sensor-generator.mjs` | Telemetry sensor qua MQTT | broker `1883` | `sensorIngestService` |

- Simulator 3 (HSMS) tái dùng **codec SECS-II thật** của server
  (`server/services/secsgem/*`) — chạy qua `tsx`.
- Simulator 5 & 6 là **MQTT client** nối tới broker Aedes nội bộ của app
  (`mqtt://127.0.0.1:1883`). Chạy app trước để có broker; hoặc trỏ `--url` tới broker khác.

## Chạy — launcher (khuyến nghị)

```bash
# Chạy toàn bộ nhà máy ảo theo devices.config.json (3 line × vài thiết bị/loại)
node scripts/sim/sim-devices.mjs

# Chỉ một số loại
node scripts/sim/sim-devices.mjs --only hsms,sensor

# Config khác / broker khác
node scripts/sim/sim-devices.mjs --config my.json --url mqtt://10.0.0.5:1883
```

### Lệnh tương tác (gõ vào stdin khi launcher đang chạy)

```
list                      liệt kê thiết bị + pid + trạng thái
kill <id>                 HẠ 1 thiết bị (mô phỏng mất kết nối đột ngột → test link-loss)
start <id>                bật lại thiết bị đã hạ
restart <id>              hạ rồi bật lại
fault <id> [spike|drift]  bật lại 1 sensor với sự cố ngay (test PdM)
quit                      tắt sạch tất cả rồi thoát
```

`kill`/`start` cho phép chạy **kịch bản phá hoại**: hạ `OPCUA-L1` để
`connectionSupervisor` phát hiện link-loss (OT-F1), hạ AGV để broker phát
`CONNECTIONBROKEN` (LWT), `fault SENSOR-L2 drift` để PdM thấy tín hiệu trôi.

## Chạy — từng simulator độc lập

```bash
node scripts/sim/opcua-server.mjs   --port 4840 --id OPCUA-L1
node scripts/sim/modbus-slave.mjs   --port 5020 --id MODBUS-L1 --unit 1
node --import tsx scripts/sim/hsms-equipment.ts --port 5000 --id HSMS-L1
node scripts/sim/mtconnect-agent.mjs --port 5001 --id MTC-L1 --device CNC-01
node scripts/sim/vda5050-agv.mjs    --url mqtt://127.0.0.1:1883 --manufacturer st4i --serial AGV01
node scripts/sim/sensor-generator.mjs --url mqtt://127.0.0.1:1883 \
     --factory 1 --machine SMT-01 --sensors vibration,current,temperature \
     --fault drift --faultAt 30
```

> File `.ts` (HSMS) cần `tsx` vì nó import codec TS của server. Launcher tự dùng
> `node --import tsx` cho nó; các file `.mjs` chạy bằng `node` thuần.

## Điểm dữ liệu mỗi simulator expose

- **OPC-UA** `opc.tcp://host:4840/UA/AviSim` — nodes: `Temperature`, `Speed`,
  `Counter`, `Status`, `Running` (đổi giá trị mỗi giây).
- **Modbus** unit 1 — `HR[0]`=temp×10, `HR[1]`=rpm, `HR[2..3]`=counter(lo/hi),
  `HR[4]`=pressure×100, `IR[0]`=status(0/1/2), `Coil[0]`=running, `Coil[1]`=fault
  (host ghi `Coil[1]`=on để cưỡng bức fault).
- **HSMS** passive — trả `Select`/`Linktest`/`S1F1→S1F2`/`S1F13→S1F14`/`S1F17→S1F18`;
  bắn `S5F1` alarm + `S6F11` event định kỳ (`--alarmMs` / `--eventMs`).
- **MTConnect** — `/probe` `/current` `/sample` (SAMPLE Position/SpindleSpeed đổi
  theo thời gian, EVENT Availability/Execution, CONDITION Normal/Fault).
- **VDA 5050** — publish `connection`(ONLINE, retain + LWT CONNECTIONBROKEN) +
  `state`(~1Hz: pose, battery, driving…); nhận `order`/`instantActions`, lái tới node,
  phản hồi `cancelOrder`/`stopPause`/`startCharging`.
- **Sensor** — `factory/{fid}/{machine}/sensor/{type}` JSON `{value,unit,timestamp}`;
  fault `spike` (gai transient) / `drift` (trôi baseline) sau `--faultAt` giây.

## Kịch bản đánh giá gợi ý

1. Chạy app (có broker + bật cờ trong `.env.sim`: `SECS_GEM_ENABLED`,
   `SECS_GEM_LIVE_ENABLED`, `PDM_SENSOR_INGEST_ENABLED`, `EQ_INTEG_ENABLED`…).
2. `node scripts/sim/sim-devices.mjs` — dựng nhà máy ảo.
3. Đảm bảo `machines.code` khớp `--machine` của sensor (vd `SMT-01`) để reading vào
   `machine_sensor_readings`.
4. Phá hoại: `kill OPCUA-L1` (link-loss), `fault SENSOR-L2 drift` (PdM), `kill AGV-01`
   (LWT), rồi `start`/`restart` để xem hệ phục hồi.

## Process-feed emitter — máy bắt vít (REST, doc 56 Đ1)

`screwdriver-emitter.mjs` **KHÁC bản chất 6 simulator trên**: không bind cổng cho
driver nối vào — nó là **HTTP client CHỦ ĐỘNG** mô phỏng controller máy bắt vít
(SCREWDRIVE) đẩy kết quả từng chu trình siết qua đường ingest THẬT:

```
POST {BASE}/api/v1/ingest/process-result   (envelope "ST4I Standard Process Feed v1")
```

Dữ liệu đi qua `requireScope(ingest:write)` → `machineApi.submitProcessResult` →
`recordProcessResult` (idempotency ledger + WAL) — **KHÔNG ghi thẳng DB**.

```bash
# cần: PROCESS_RESULT_INGEST_ENABLED=true + máy SCRW-SIM-01 đã enroll có khoá mk_
node scripts/sim/screwdriver-emitter.mjs --machine SCRW-SIM-01 --apiKey mk_xxx \
     --intervalMs 3000 --faultRate 0.05
SIM_MACHINE_KEY=mk_xxx node scripts/sim/screwdriver-emitter.mjs --count 20
node scripts/sim/screwdriver-emitter.mjs --apiKey mk_xxx --count 3 --idempotencyRetry
node scripts/sim/screwdriver-emitter.mjs --help          # in tham số, không cần mạng
```

- Auth: khoá `mk_` gửi ở header `Authorization: Bearer <mk_…>` (server chỉ nhận
  `Bearer` / `X-API-Key`, không nhận scheme "ApiKey"); `machineCode` trong body cho
  khớp envelope. `--idempotencyRetry` gửi trùng `idempotencyKey` để chứng minh dedup.

## Ghi chú kỹ thuật

- Không thêm dependency mới — chỉ dùng `node-opcua`, `modbus-serial`, `mqtt`, `aedes`
  đã có trong `package.json`, cộng Node core.
- Trên Windows, `kill <id>` gửi `SIGTERM` (Node dịch thành terminate cứng) — chính là
  hành vi "mất kết nối đột ngột" ta muốn cho kịch bản link-loss; cleanup graceful
  (vd AGV publish OFFLINE) có thể không chạy kịp — đó là mong đợi.
- Mỗi process con bind cổng/nối broker riêng, độc lập, dừng/bật lại được.
