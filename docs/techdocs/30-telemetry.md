# 30 · Chuỗi thời gian, ingest, lớp sống (telemetry)

| | |
|---|---|
| Mục tiêu phục vụ | M2 giám sát thời gian thực (trực tiếp); M4 thu thập dữ liệu (trực tiếp); M3/M5 (mô phỏng và AI đọc cùng kho tín hiệu) |
| Phụ thuộc | 10 hierarchy (site.origin, isa95_path), 20 asset (tag, connection, connection_status) |
| Module phụ thuộc vào đây | 40 alarm (đánh giá trên tín hiệu sống), 50 control (đọc lại xác nhận lệnh), 60 inspection (process_results dùng cùng khuôn), 70 engineering (mô phỏng phát tín hiệu), 80 ai (phân tích), 90 platform (OEE/CAGG, twin xem) |
| Mốc đo | `_ai8_wt c49f03c06` (2026-11-03), DB `aoi_management@5434` read-only; spec SCADA mượt v3 `@72930dba2` §2, §3, §12A |
| Trạng thái | **v1.1 — ĐÃ DUYỆT 2026-11-03** (8 câu hỏi §7 duyệt theo khuyến nghị; mig 0490–0509) |

## 0. Phạm vi của module

Module này sở hữu **giá trị của tag theo thời gian**: đường vào (ingest), kho lưu (hypertable + tổng hợp), lớp sống (giá trị hiện tại + tuổi + chất lượng), kênh đẩy ra màn hình, và phát hành UNS/Sparkplug. Nó bảo đảm hai bất biến: **mọi mẫu có `ts` nguồn, `quality`, `reason`** và **màn hình không bao giờ hiện số tươi khi dữ liệu cũ** (S‑1 = 0, ràng buộc #7, #8).

Module này **không** sở hữu: định nghĩa tag (20), đánh giá cảnh báo (40), ghi lệnh (50), kết quả kiểm tra/ảnh (60), OEE/KPI (90).

**Hợp đồng kênh đẩy SCADA ("1a") do scada-master sở hữu** theo spec v3 §3.6 và brief 1a; module này **nhận** nguyên văn, không viết hợp đồng khác (§3.3).

---

## 1. Hiện trạng đo được

### 1.1 Một bus, bảy đường vào, bảy bảng lẻ

Bus duy nhất: `ingestTelemetry()` ở `server/services/telemetryBus.ts` (1 135 dòng) `[đo]`: `CanonicalSample` → cổng `ts` (không hợp lệ / tương lai > 24 h / không múi giờ ⇒ từ chối, ghi bảng lệch đồng hồ) → chunk 1 000 hàng INSERT `ot_telemetry` ON CONFLICT DO NOTHING → store-forward khi DB hỏng → phát `telemetry:sample` + tap.

| # | Đường vào | Tệp | Xác thực | Quality/ts | Trạng thái |
|---|---|---|---|---|---|
| I1 | `POST /api/ot/ingest` | `_core/otIngestRoute.ts` (186) | khoá máy scope `ingest:write`; gateway bị ràng allowlist | quality lạ → `good`; ts không múi giờ bị từ chối; **không Zod** | sống |
| I2 | `POST /api/v1/ingest/telemetry` | `api/v1/router.ts:502` | scope INGEST_WRITE | như I1 | sống, trùng I1 |
| I3 | Poll OT trong tiến trình | `ot/ingest.ts` (245) ← `vongPoll`/`otManager` | nội bộ | **có** quality 3 mức + `tsSource` từ driver; nạp bộ đệm sống trước DB | gateway tắt ở dev |
| I4 | Edge → trung tâm | `edge/edgeIngestCentral.ts` (260) | principal edge, chỉ adapter sở hữu | Zod; `ts null ⇒ server` | sống |
| I5 | MQTT `synapse/…/telemetry` | `mqttService.ts:372` (3 759) | thiết bị MQTT + `mqtt_clients.machineId` | theo `contracts/canonical/telemetry.schema.json` | cờ `MQTT_TELEMETRY_BRIDGE_ENABLED` OFF |
| I6 | Simulator | `simOtTelemetryService.ts` (247) | — | 4 metric cố định, `protocol=other`, `quality=good` | **BẬT**, 30 s |
| I7 | Fan-out Redis | `telemetryBus.ts:240` | — | không ghi DB | |

Bảng chuỗi thời gian **ngoài bus** `[đo]`:

| Bảng | Writer | Hàng / dung lượng | Hypertable | Retention | Ghi chú |
|---|---|---|---|---|---|
| `robot_telemetry` | `robot/robotIngest.ts` | 1,99 M / 155 MB | có | 365 d | không quality; ts naive |
| `machine_sensor_readings` | `sensorIngestService.ts` (MQTT `factory/…/sensor/{type}`) | 576 | không | không | dừng 16/07; cờ OFF |
| `machine_status_logs` | `machinePresenceService.ts` suy từ recency | 95 971 / 14 MB | không | không | là sự kiện đổi trạng thái |
| `machine_health_history` | PdM job 30 phút | **2,81 M / 1 034 MB** | không | **không** | tăng vô hạn |
| `rul_estimates` | `rulEstimatorService.ts` | **2,78 M / 772 MB** | không | **không** | tăng vô hạn |
| `machine_heartbeats` | `createMachineHeartbeat` **không ai gọi** | 5 100 (một cửa sổ 12 phút 26/09) | có | 365 d | bảng chết |
| `energy_readings` | REST thủ công / tap OFF | 0 | chỉ TSDB riêng | — | |
| `machines.lastHeartbeat` | tRPC/REST/socket/MQTT (tiết lưu 45 s) | cột | — | — | nguồn "tươi" 5 phút của twin |

### 1.2 Dữ liệu thật trong DB `[đo]`

- `ot_telemetry` 576,9 triệu hàng, 65 GB (bảng 30,5 · index 33,8), 16 chunk (14 nén; trước nén 136 GB → 7,1 GB); min ts 2026-07-13.
- **24 h gần nhất: 17,5 triệu hàng từ 1 699 máy, đúng 4 metric (`cycle_time, heartbeat, temperature, machine_state`), 100 % `protocol=other`, 100 % `quality=good`** ⇒ toàn bộ là simulator (I6). Quality thật chưa từng được quan sát ở quy mô.
- Job Timescale: nén 7 d (243 lần / 44 lỗi), retention 365 d (172 / 67), CAGG `hourly_yield_cagg` (2 313 / 110) — **không code server nào đọc CAGG này**. Tỉ lệ lỗi tích luỹ 17–28 %.
- Bảng `cached_statistics` mà `functions/cachedStatistics.ts` tham chiếu **không tồn tại**.

### 1.3 Store-and-forward ×3 + edge

| | OT | Inspection | Process |
|---|---|---|---|
| Tệp | `ot/storeForward.ts` (1 175) | `inspection/inspectionStoreForward.ts` (1 188) | `process/processStoreForward.ts` (653) |
| Hàng đợi | RAM + JSONL atomic, quarantine | JSONL + dead-letter, 512 MB | JSONL + dead-letter, 256 MB |
| Dedup | `adapterId\|tag\|ts` + UNIQUE DB | sổ `inspection_idempotency_keys` | `process_idempotency_keys` |
| Retry | backfill khi DB lành + timer 45 s | worker 15 s, backoff tới 5 phút, 20 lần → dead | như inspection |

Edge dùng lại `DurableBuffer` của OT cho UNS (500 000 mục, 24 h). Ba bản có cùng mẫu, khác chi tiết; inspection/process thuộc 60 nhưng **lõi WAL nên dùng chung**.

### 1.4 DDL Timescale xung đột

9 migration chạm hypertable `[đo]`: `0118` segmentby `"adapterId"` (**cột không tồn tại**), `0172` segmentby `(machineId, metric)` nén 30 d, `0271` segmentby `(deviceId, metric)` nén 7 d (đang hiệu lực), `timescale/0003` chỉ cho TSDB riêng (`TSDB_URL`, không đặt) retention 90 d + CAGG 1m/1h, `0173` retention 365 d cho 6 bảng, `0349` audit_logs không gác extension. Drizzle khai PK `id` trong khi DB là `(id, ts)`.

### 1.5 Lớp sống và kênh đẩy

| Thành phần | Tệp | Thực tế |
|---|---|---|
| Bộ đệm hiện tại | `scada/boDemHienTai.ts` (384) | `Map<adapterId:tagKey, {v,q,statusCode,reason,ts,tsSource,rx,lichSu}>`; stale = `now−rx > max(3·poll, deadband?70 000:0)`; nạp DB 24 h lúc boot với tuổi thật; **chỉ adapter OT trung tâm, chỉ tiến trình API**; cờ `SCADA_LIVE_CACHE_ENABLED` OFF |
| Kênh SCADA | `scada/scadaSocket.ts` (381) | `scada:subscribe/snapshot/delta/unsubscribe/error`, tuple 8 phần tử, 500 tag/đăng ký, 10 đăng ký/socket, khung 250 ms, **không join/io.emit**; cờ `SCADA_SOCKET_ENABLED` OFF; client **chưa dùng** |
| Firehose | `_core/socket.ts:1763` | `telemetry:sample` tới `telemetry:all` + `machine:{id}`; có quality+ts, **không ageMs/stale** |
| Các kênh khác | `socket.ts` | `machine:status_update`, `machine:status_change`, `oee:update` 60 s, `twin:trangThai` 10 s (có `doTuoiGiay`), `twin:device` ≤10 Hz, `robot:telemetry`, `engineering:samples`… 78 tên sự kiện, mỗi kênh một hình dạng |
| UNS stream WS | `stateStore/unsStreamGateway.ts` (463) | từ RAM heartbeat, không từ bus; cờ OFF |
| NATS/lake | `streaming/*` | tap `syn/telemetry/*` BẬT nhưng backend inprocess "non-durable"; lake OFF |

Client `[đo]`: 241 `refetchInterval` trong 97 tệp. Faceplate poll **2 000 ms** (`scadaDiag.tagCuaAdapter`), MachineCockpit 10 000, UnifiedDeviceMonitor 60 000 (stale 120 s), LineView 5–15 s, TwinVanHanh socket `twin:trangThai` + poll 5 s/30 s (ngưỡng 25 s/60 s/300 s), RobotCockpit 15 s. Ba trang tự mở `io()` riêng. Tuổi dữ liệu có **5 ngưỡng khác nhau** (SCADA server-tính, twin 25/60/300 s, UDM 120 s, FreshnessStrip 30 s thường không được truyền mốc, unsStreamClient 60 s).

### 1.6 Chất lượng và C1

- Driver có quality 3 mức + `statusCode` + `reason ∈ {comm_lost, device_error, config_error, out_of_range, stale}` (`ot/chatLuong.ts`), cột `quality NOT NULL`, `ingestedAt`; **`tsSource` chỉ ở RAM**, không có cột.
- **C1**: `trangThaiAdapter.phatMauXau` phát mẫu `bad/comm_lost` khi mất kết nối **chỉ khi `OT_CHAT_LUONG_V2_ENABLED=true`** (OFF) ⇒ bộ đệm giữ giá trị tốt cuối (chính mã ghi "nguy cơ C1").
- Spec v3 §2 đặt SLO: L‑A p95 ≤ 300 ms (bộ đệm → màn), L‑C < 300 ms tầng nóng, S‑1 = 0; hiện L‑A ≈ 1–2 s do poll.

### 1.7 UNS/Sparkplug

`unsPublisher.ts` (1 119): broker `UNS_BROKER_URL` mặc định `mqtt://localhost:1884` (không thấy đặt ⇒ `[cần kiểm]` có broker nghe không); topic legacy `avi/…` + `spBv1.0/{group}/DDATA/{edge}/{device}`; v2 `syn/{site}/{area}/{line}/{cell}/{equipment}/{aspect}` sau cờ `UNS_TOPIC_V2_ENABLED` OFF. Sparkplug: NBIRTH/NDEATH/DBIRTH lazy/DDEATH/REBIRTH có; **STATE host không phát** (Sparkplug 3.0 đòi `spBv1.0/STATE/{host}` JSON). Trong repo **không consumer UNS nào nuôi màn hình**; chỉ federation subscriber (tắt).

---

## 2. Mục tiêu: mô hình dữ liệu

### 2.1 Quyết định thiết kế `[QĐ 2026-11-03]`

1. **Một bảng tín hiệu thô `signal_sample`** (= `ot_telemetry` đổi tên, thêm cột). Gộp vào đây: `robot_telemetry` (metric `joint_*`, `mode`, `busy`…), `machine_sensor_readings`, `energy_readings`, và **điểm phái sinh** của PdM (`health_score`, `rul_days`) với `source='calc'` ⇒ cùng một retention và nén. `machine_heartbeats` gỡ. `machine_status_logs` thành sự kiện `state_change` ở module 40 (phái sinh từ metric `state`).
2. **Mọi mẫu neo vào `tag_id`** (20). Mẫu từ máy tự gửi (AOI heartbeat, cycle_time…) neo vào **tag ảo** sinh từ `tag_template` của lớp với `connection.protocol='push'`; không còn `metric` tự do không tra được.
3. **Ba cột chất lượng là cột thật**: `quality`, `reason`, `ts_source` (đưa từ `meta` lên để lọc/chỉ mục).
4. **Một nguồn DDL Timescale**: migration trong `drizzle/` chính; gỡ `timescale/0003` (TSDB riêng), xoá 0118/0172 khỏi thứ tự áp (đã bị 0271 đè); `TSDB_URL` bỏ.
5. **Retention theo nguồn**: `site.origin=real` 90 d thô + CAGG 1m/1h/1d giữ 3 năm; `origin∈{sim,qa}` 7 d thô, không CAGG dài ⇒ chấm dứt 17,5 M hàng/ngày của simulator chiếm 65 GB.
6. **Lớp sống là một kho RAM** `LiveStore` keyed `tag_id` cho **mọi** tín hiệu (không chỉ adapter OT trung tâm), nuôi bởi bus; ngưỡng cũ theo tag = `staleAfterMs` của 1a (một hàm `nguongCuMs`, một nguồn sự thật).
7. **C1 mặc định bật**: mất kết nối ⇒ mỗi tag của connection nhận đúng một mẫu `bad/comm_lost` (ghi DB + lớp sống); cờ `OT_CHAT_LUONG_V2_ENABLED` bỏ.
8. **Hai đường ingest**: (a) nội bộ tin cậy — poll OT, edge, simulator, robot driver, process calc → `ingestSignals()` với `tag_id` do server đặt; (b) ngoài — HTTP (`/api/v1/ingest/telemetry`), MQTT `synapse/…/telemetry` → cùng `rangBuocMauTheoKhoa` + ánh xạ `metric → tag` qua tag ảo; `/api/ot/ingest` thành alias một chu kỳ.
9. **Một WAL store-forward** dùng chung (`DurableBuffer`), ba bản hiện tại thành ba *cấu hình* (đường dẫn, trần, dedup).
10. **UNS v2 là topic duy nhất**, dẫn xuất từ `asset.isa95_path + tag.key` (20 §2.1 QĐ8); legacy `avi/…` gỡ; Sparkplug 3.0 phát `STATE` host; publisher đọc từ bus (không mirror aedes).

### 2.2 Đặc tả bảng

#### `signal_sample` (hypertable)

| Cột | Kiểu | Null | Mặc định | Ghi chú |
|---|---|---|---|---|
| ts | timestamptz | no | | giờ nguồn; cột partition; PK `(ts, tag_id)` |
| tag_id | bigint | no | | **không FK vật lý** (hypertable), kiểm ở app; index |
| asset_id | bigint | no | | chép từ tag; index `(asset_id, ts desc)` |
| site_id | bigint | no | | chép; RLS |
| num_value | double | yes | | |
| text_value | text (≤1 000) | yes | | |
| bool_value | boolean | yes | | |
| quality | varchar(10) | no | 'good' | `good \| uncertain \| bad` |
| reason | varchar(16) | yes | | `comm_lost \| device_error \| config_error \| out_of_range \| stale \| sim` |
| status_code | text | yes | | mã driver (OPC UA/Modbus) |
| ts_source | varchar(8) | no | 'server' | `device \| server \| calc` |
| source | varchar(8) | no | 'poll' | `poll \| push \| edge \| mqtt \| sim \| calc` |
| ingested_at | timestamptz | no | now() | giờ nhận |
| seq | bigint | yes | | thứ tự nguồn (MQTT/Sparkplug) |
| meta | jsonb | yes | | phần thừa |

Index: `(tag_id, ts desc)`, `(asset_id, ts desc)`, UNIQUE `(tag_id, ts)` thay `(deviceId, metric, ts)`. Hypertable chunk 1 d (17 M hàng/ngày hiện tại ⇒ chunk 7 d là 120 M, quá lớn), nén sau 2 d, `segmentby (tag_id)`, `orderby ts desc`. Retention: policy 90 d + job xoá `site.origin≠real` sau 7 d. RLS: policy theo `site_id`.

Cột gỡ so với `ot_telemetry`: `id` (không cần với PK `(ts, tag_id)`), `machineId`, `deviceId`, `protocol`, `metric`, `unit` (lấy từ tag).

#### CAGG (Timescale continuous aggregate)

| Tên | Bucket | Cột | Dùng cho |
|---|---|---|---|
| `signal_1m` | 1 phút | tag_id, asset_id, site_id, n, avg, min, max, last, last_ts, n_bad | xu hướng faceplate/cockpit ≤ 24 h |
| `signal_1h` | 1 giờ | như trên + first | xu hướng 7–90 d, OEE (90) |
| `signal_1d` | 1 ngày | như trên | báo cáo, giữ 3 năm |

Refresh policy native (không `MatviewRefresh` tay). `hourly_yield_cagg` (không ai đọc) gỡ sau khi 90 chuyển OEE sang `signal_1h` + kết quả kiểm tra (60).

#### `signal_ingest_stat` (bảng thường, 1 hàng/phút/đường)

`ts_minute, path (poll|push|edge|mqtt|sim|calc), site_id, accepted, rejected_ts, rejected_scope, rejected_other, db_error, buffered` — nguồn cho màn Kết nối và SLO; thay `telemetry reporter` job.

#### `clock_skew_observation` (= bảng lệch đồng hồ hiện có, đổi tên, thêm `asset_id`)

#### Store-forward WAL: tệp JSONL `data/wal/{kind}.jsonl` + `data/wal/{kind}.dead.jsonl`; cấu hình trong `shared/telemetry/walConfig.ts` (kind: `signal`, `inspection`, `process`, `uns`). Không bảng DB.

#### Bảng gỡ / chuyển

| Bảng | Hành động |
|---|---|
| `robot_telemetry`, `machine_sensor_readings`, `energy_readings` | copy vào `signal_sample` (tag ảo theo role) rồi gỡ |
| `machine_health_history`, `rul_estimates` | điểm mới ghi `signal_sample(source=calc)` với tag role `health_score`, `rul_days`; lịch sử cũ: giữ 90 d gần nhất copy sang, phần còn lại **xoá** (1,8 GB) `[QĐ 2026-11-03]` |
| `machine_status_logs` | → 40 `event(type=state_change)`; bảng gỡ sau khi 40 backfill |
| `machine_heartbeats` | gỡ |
| `mqtt_message_logs/_history` | không phải telemetry; thuộc đóng băng FactoryAlert |
| `hourly_yield_cache`, `machine_status_latest` (matview), `cached_statistics` (không tồn tại) | thay bằng CAGG + `LiveStore`; `functions/cachedStatistics.ts` đọc nguồn mới |

### 2.3 Hợp đồng mẫu (`shared/telemetry/signal.ts`)

```ts
export type Signal = {
  tagId: number; assetId: number; siteId: number;
  ts: number;            // epoch ms nguồn
  tsSource: 'device'|'server'|'calc';
  v: number|string|boolean|null;
  q: 'good'|'uncertain'|'bad';
  reason?: 'comm_lost'|'device_error'|'config_error'|'out_of_range'|'stale'|'sim';
  statusCode?: string; seq?: number;
  source: 'poll'|'push'|'edge'|'mqtt'|'sim'|'calc';
};
export type LiveValue = Signal & { rx: number; staleAfterMs: number; stale: boolean; ageMs: number };
```

Zod schema cùng tên; `contracts/canonical/telemetry.schema.json` cập nhật để `metrics[].name` ánh xạ `tag.key` và thêm `reason`.

---

## 3. Mục tiêu: backend

### 3.1 Namespace `telemetry.*`

| Procedure | Loại | Input | Output | Thay cho |
|---|---|---|---|---|
| `telemetry.latest` | protected (phạm vi theo asset) | `{ tagIds[] \| assetId }` | `LiveValue[]` từ `LiveStore` (DB fallback 24 h nếu tiến trình không phải API) | `scadaDiag.tagCuaAdapter` (phần giá trị), `assetCockpit.machineDetail` phần sống, `machineStatus.listWithStatus` |
| `telemetry.series` | protected | `{ tagId, from, to, bucket?: raw\|1m\|1h\|1d, limit }` | điểm `{ts, v\|avg/min/max/last, q/n_bad}` | `sensor.readSeries`, `robot.telemetry`, `engineering:samples` lịch sử |
| `telemetry.assetSummary` | protected | `{ assetId }` | tag theo role: giá trị sống + tuổi + chất lượng + sparkline 1m×60 | cockpit/faceplate tổng quan |
| `telemetry.ingestStats` | permission(connection_manage, view) | `{ siteId?, window }` | từ `signal_ingest_stat` + WAL depth | `/metrics` phần OT, `SystemHealth` phần OT |
| `telemetry.wal.status/drain/listDead/requeue` | admin | | | (mới có UI) |
| `telemetry.uns.topics` | protected | `{ nodeFilter }` | topic v2 cho cây trong phạm vi | `hierarchyTree.getMqttTopics` (10 §3.3) |
| `telemetry.uns.status` | admin | | broker, Sparkplug STATE, seq, lỗi | `MqttDashboard` phần UNS |
| `telemetry.jobs` | admin | | job Timescale (nén/retention/CAGG) + lỗi tích luỹ | (mới) |
| `telemetry.retention.get/set` | admin | theo site/origin | | `dataRetentionService` cấu hình qua `settings` (90) |

Ingest (không phải tRPC):

| Đường | Xác thực | Ghi chú |
|---|---|---|
| `POST /api/v1/ingest/telemetry` | api key máy, scope ingest | chuẩn ngoài; `/api/ot/ingest` alias 1 chu kỳ; Zod `IngestEnvelope { assetId\|assetUrn, samples: {tagKey, ts?, v, q?, reason?, seq?}[] }`; `tagKey` tra tag của asset (tag ảo tự tạo theo template nếu lớp cho phép `auto_tags`) |
| MQTT `syn/{…}/{equipment}/telemetry` | client MQTT gắn asset | cùng hàm; topic legacy `synapse/…`, `factory/…/sensor/…` gỡ |
| Edge → trung tâm | principal edge | giữ `edgeIngestCentral` nhưng payload = `Signal[]` |
| Nội bộ | — | `ingestSignals(Signal[])`: poll OT, simulator (gắn `reason='sim'`, chỉ cho asset thuộc site `origin=sim`), calc (PdM, process) |

Thứ tự trong `ingestSignals`: kiểm tag/phạm vi → cổng `ts` → **`LiveStore.apply` trước DB** (giữ hành vi `napTuOt`) → INSERT chunk (COPY khi lô > 5 000, cờ bỏ) → WAL khi DB lỗi → phát bus `signal.batch` (cho socket, alarm, UNS, twin) → `signal_ingest_stat`.

### 3.2 `LiveStore` (server/services/telemetry/liveStore.ts)

- `Map<tagId, LiveValue>` + lịch sử ngắn 50 điểm; nạp DB 24 h lúc boot với `rx = ingested_at`.
- `staleAfterMs(tag) = max(3·connection.poll_ms, tag.deadband ? 70 000 : 0)` (= `nguongCuMs` hiện tại, một chỗ); tag `source=push` dùng `3 × khoảng gửi quan sát` với sàn 15 s.
- Mất kết nối (20 `connection_status.state=lost`) ⇒ `applyBad(connectionId, reason=comm_lost)` một lần cho mọi tag ⇒ C1.
- Chạy ở tiến trình API **và** worker (worker cho alarm engine); đồng bộ giữa tiến trình qua bus Redis fan-out đã có (I7).
- Phát `signal.changed(tagIds)` cho socket và 40.

### 3.3 Kênh đẩy ra màn hình — nhận hợp đồng 1a

Module này **tuân theo** spec v3 §3.6 và brief 1a (scada-master làm sau A2(o)): `scada:subscribe {subId?, tags[], capMs ∈ {50,100,250,1000}, nguon: "that"}` → `scada:snapshot {subId, seq, serverTs, values: GiaTriGoi[8], staleAfterMs, denied}` / `scada:delta {subId, seq, serverTs, values}` / **`scada:tick` 1 000 ms** `{subId, seq, serverTs, adapters: [{adapterId, trangThai, tuoiMauMoiNhatMs}]}` / `scada:error {… TOO_MANY_HOT}`; không `socket.join`/`io.emit`; kiểm quyền và phạm vi từng tag lúc đăng ký; trần 500 tag/đăng ký, 10 đăng ký/socket, ≤ 2 đăng ký nóng/socket.

Điều module này bổ sung **sau khi 1a lên main** (không chen trước):

| Việc | Nội dung |
|---|---|
| Nguồn | `scadaSocket` đọc `LiveStore` (mọi tag) thay `boDemHienTai` (chỉ OT trung tâm); khoá `(adapterId, tagKey)` giữ trong hợp đồng, ánh xạ sang `tag_id` ở server |
| Gộp kênh | `telemetry:sample` (firehose), `machine:status_update`, `robot:telemetry`, `engineering:samples`, `twin:device` **đều** phát từ `LiveStore` qua cùng `GiaTriGoi` + `ageMs/stale`; firehose `telemetry:all` chỉ còn cho admin chẩn đoán, có cờ tắt |
| `twin:trangThai` | giữ nhịp 10 s nhưng `doTuoiGiay` lấy từ `LiveStore` (một ngưỡng) |
| Fallback | `telemetry.latest` poll có nhãn; client hiện pill "Chế độ hỏi vòng · tuổi tối đa ~N s" (spec §3.4) |

### 3.4 UNS/Sparkplug (`services/uns/`)

- Publisher đọc bus `signal.batch`; topic `syn/{site}/{area}/{line}/{cell|_}/{equipment}/telemetry` (dẫn xuất) và aspect `state/health/events` do 40/90 phát; retain + QoS theo `uns/topicV2.ts` (đã có).
- Sparkplug 3.0: NBIRTH/DBIRTH/DDATA/NDEATH như hiện tại + **STATE host** `spBv1.0/STATE/{host}` JSON `{online, timestamp}` khi SYNAPSE là Primary Host; alias ổn định theo `tag_id`.
- Cờ: `UNS_ENABLED` (một cờ) + `UNS_BROKER_URL` bắt buộc khi bật; `UNS_TOPIC_V2_ENABLED`, `UNS_BRIDGE_ENABLED`, `OT_INGEST_TO_UNS`, `UNS_SPARKPLUG_AOI_BRIDGE` gỡ.
- NATS/lake: **đóng băng** (tap tắt, lakeSink giữ mã) cho tới khi có nhu cầu lưu trữ lạnh thật `[QĐ 2026-11-03]`; `stateStore` + `unsStreamGateway` gỡ (1a thay).

### 3.5 Job (worker)

| Job | Chu kỳ | Thay cho |
|---|---|---|
| `signal.compress/retention` | native Timescale policy; worker chỉ giám sát lỗi → `telemetry.jobs` | job 1023/1024 + `dataRetentionService` phần telemetry |
| `signal.retentionSim` | 1 h: xoá chunk/hàng `site.origin≠real` > 7 d | (mới) |
| `signal.cagg` | native refresh 1m (lag 2 phút), 1h, 1d | `MatviewRefresh`, `hourly_yield_cagg`, `ReportingMart` phần telemetry |
| `wal.drain` | 15 s, backoff | 3 timer riêng |
| `clockSkew.report` | 1 h | giữ |
| `presence` | gỡ: trạng thái máy = tag role `heartbeat/run/state` + `staleAfterMs`; sự kiện đổi trạng thái do 40 sinh | `machinePresenceService` |

### 3.6 Gỡ / chuyển

`simOtTelemetryService` giữ nhưng **chỉ ghi cho asset thuộc site `origin=sim`**, `reason='sim'`, chu kỳ 30 s giữ; `sensorIngestService`, `robotIngest` (phần ghi) → `ingestSignals`; `stateStore/*`, `unsStreamGateway` gỡ (kênh 1a thay); `streaming/*` đóng băng; `federation/unsSubscriber` đóng băng; `machinePresenceService` gỡ; `functions/cachedStatistics.ts` viết lại đọc CAGG; `timescale/0003`, `TSDB_URL`, `db/timescale.ts` gỡ.

---

## 4. Mục tiêu: frontend

### 4.1 Một cửa đọc dữ liệu sống: `client/src/lib/live/`

- `liveStore.ts`: **một socket** (từ `socketManager`), kho `Map<"adapterId:tagKey", LiveValue>`, đếm tham chiếu đăng ký, gộp subscribe 50 ms, đăng ký lại sau reconnect (snapshot trước rồi mới tươi), đồng hồ cũ 4 Hz lật cờ `cu`, phát hiện mất tick > 3 s ⇒ toàn bộ đăng ký cũ. (= `scadaLive.ts` của spec §3.7; scada-ui làm ở pha 1b — module này ghi để mọi màn **khác SCADA** cũng dùng nó.)
- `useTagSong(adapterId, tagKey)` → `{v, q, tuoiMs, cu, nguon: 'day'|'hoi'|'mo_phong'}`; `useAssetLive(assetId)` → theo role; `useSeries(tagId, range, bucket)` → `telemetry.series` (TanStack Query, không socket).
- **Cấm** component tự gọi `io()` (3 trang hiện tại), tự `refetchInterval` cho dữ liệu sống, tự tính stale. ESLint rule `no-direct-live-poll`.

### 4.2 Component dùng chung (`components/live/`)

| Component | Nhiệm vụ |
|---|---|
| `LiveValue` | ô số/bool/chuỗi: giá trị + đơn vị + viền chất lượng (uncertain chấm xám, bad/stale tím gạch, D10) + tooltip tuổi |
| `FreshnessPill` | một pill chuẩn: `Đẩy trực tiếp` (có tick 3 s) / `Hỏi vòng · tuổi ≤ N s` / `Mất kết nối` / `Mô phỏng`; thay `FreshnessStrip`, `PollFreshness`, `RealtimeBadge`, pill twin |
| `TrendPanel` | xu hướng 1m/1h/1d từ `useSeries`, có vùng n_bad, endpoint nhấn; thay `SensorTrendTab`, chart robot |
| `ConnectionStateChip` | từ 20 `connection_status` + tick 1a |

### 4.3 Màn "Kết nối" — `/ket-noi` (vùng Giám sát)

- Quyền: `asset_view` (xem), `connection_manage` (hành động), admin cho tab Hệ thống.
- Tab **Kết nối**: bảng connection theo phạm vi: trạng thái sống (tick), rtt, tuổi mẫu mới nhất, số tag, WAL đang đệm; hành động `[Kết nối lại] [Tạm tắt]` (2FA, 20). Thay `UnifiedDeviceMonitor` phần sống, `FieldDevices` health.
- Tab **Tag sống**: chọn connection ⇒ `TagTable` (20) + cột `LiveValue` + `[Đọc thử]`; lọc theo role/chất lượng. Thay `ScadaDiag` phần giá trị, `NganTagAdapter` **sau khi A2 xong** (không chen trước).
- Tab **Edge**: edge_node, heartbeat, connection sở hữu, WAL edge. Thay `edgeRuntime` trong UDM.
- Tab **UNS**: broker, Sparkplug STATE/seq, topic theo cây (`telemetry.uns.topics`), tin nhắn gần nhất (mẫu, không firehose). Thay `MqttDashboard` phần UNS, `MqttTopicsMessages` (phần FactoryAlert đóng băng).
- Tab **Ingest & lưu trữ** (admin): `signal_ingest_stat` 24 h theo đường, từ chối theo lý do, WAL depth/dead-letter `[Xả lại]`, job Timescale + lỗi tích luỹ, dung lượng hypertable, retention theo origin. Thay `SystemHealth` phần OT, `/metrics` thủ công.
- Trạng thái: phạm vi rỗng; mô phỏng (site origin ≠ real ⇒ nhãn); không có connection ⇒ CTA tới wizard 20.
- i18n: `giamSat.ketNoi.*`.

### 4.4 Màn khác tiêu thụ module này (đặc tả ở module sở hữu)

Faceplate L3 (50) đọc `useTagSong`; Line L2 mimic (50/spec mượt) đọc `useTagSong` theo định nghĩa màn; MachineCockpit/RobotCockpit (giữ, ràng buộc #15) chuyển `SensorTrendTab`/`robot.telemetry` sang `TrendPanel` + `useAssetLive`; TwinVanHanh (90) giữ `twin:trangThai` nhưng tuổi từ `LiveStore`; LineView, FactoryCommandView, UDM → thay như trên.

---

## 5. Di trú từ hiện trạng

Dải migration: **0490–0509** `[QĐ 2026-11-03: duyệt]`. Phụ thuộc: 20-A3 (tag FK, connection_status) trước T2; **T4 (socket) chỉ sau khi 1a của scada-master lên main và chủ dự án bật 2 cờ** (§12A #1); không đụng `services/scada/*` trước A2(o).

| Bước | Nội dung | Tương thích | Nghiệm thu |
|---|---|---|---|
| **T0** Chặn chảy máu | simulator chỉ ghi asset thuộc `SIM-FAC` (origin=sim) + `reason='sim'`; retention 7 d cho origin≠real; điều tra 44 lỗi job nén, 67 lỗi retention; `machine_health_history`/`rul_estimates` thành hypertable có retention 90 d (sau khi chủ dự án duyệt xoá lịch sử cũ) | không đổi API | dung lượng `ot_telemetry` giảm ≥ 50 % sau 14 d; 0 lỗi job trong 7 d; 2 bảng PdM < 200 MB |
| **T1** Một nguồn DDL | migration chuẩn hoá policy (0271 thắng), gỡ `timescale/0003`/`TSDB_URL`/`db/timescale.ts`; Drizzle khai PK `(id, ts)`; `audit_logs` không đụng (90) | | `timescaledb_information.*` khớp migration; 0 DDL ngoài drizzle/ |
| **T2** Cột mới trên `ot_telemetry` + tag ảo | thêm `tag_id`, `asset_id`, `site_id`, `reason`, `ts_source`, `source`, `seq`; backfill `tag_id` từ `(deviceId, metric)` → tag (tạo tag ảo `protocol=push` theo template cho 4 metric sim + metric AOI); `ingestTelemetry` ghi cả cột cũ và mới | API cũ giữ | 100 % hàng mới có `tag_id`; backfill 7 d gần nhất xong (hàng cũ hơn để retention dọn) |
| **T3** `LiveStore` + `ingestSignals` + WAL chung | `LiveStore` thay `boDemHienTai` (adapter OT trung tâm vẫn đúng hành vi); C1 mặc định bật; `sensorIngest`, `robotIngest`, `simOt`, PdM calc → `ingestSignals`; 3 store-forward → `DurableBuffer` cấu hình; `signal_ingest_stat` | `telemetry:sample` giữ hình dạng | test C1: ngắt simulator ⇒ mẫu `bad/comm_lost` trong DB và `telemetry.latest` ≤ 10 s; đột biến "bỏ applyBad" đỏ |
| **T4** Kênh đẩy | *sau 1a lên main*: `scadaSocket` đọc `LiveStore`; các kênh `machine:status_update/robot:telemetry/engineering:samples/twin:device` phát từ `LiveStore` với `ageMs/stale`; `unsStreamGateway` gỡ | client cũ vẫn chạy (tuple giữ) | L‑A p95 ≤ 300 ms với capMs=100 trên simulator (đo theo spec §2); S‑1 = 0 |
| **T5** Client một cửa | `lib/live/` + `components/live/`; `/ket-noi`; Faceplate/cockpit/twin/UDM chuyển sang `useTagSong`/`useAssetLive`/`TrendPanel`; ESLint cấm `io()` và poll sống trực tiếp | redirect `/device-adapters`, `/field-devices`, `/scada/diag` (sau A2) | 0 `io(` ngoài `socketManager`; `refetchInterval` cho dữ liệu sống = 0; một ngưỡng tuổi |
| **T6** CAGG + đọc | `signal_1m/1h/1d`; `telemetry.series/assetSummary`; `cachedStatistics` đọc CAGG; OEE (90) chuyển nguồn; gỡ `hourly_yield_cagg`, matview, `MatviewRefresh`, `ReportingMart` phần telemetry | | 0 code đọc matview cũ; `telemetry.series` 24 h/1m < 150 ms p95 |
| **T7** UNS v2 duy nhất + Sparkplug STATE | publisher từ bus; topic v2; STATE host; gỡ legacy/alias cờ; broker URL bắt buộc | | topic legacy = 0 trên broker; STATE phát khi connect/disconnect |
| **T8** Đổi tên và dọn | `ot_telemetry→signal_sample` (+ view), gỡ `robot_telemetry`, `machine_sensor_readings`, `energy_readings`, `machine_heartbeats`, `machine_status_logs` (sau 40), `stateStore`, `machinePresenceService`, `streaming` đóng băng, cột cũ `machineId/deviceId/protocol/metric/unit` | view 1 chu kỳ | 1 bảng chuỗi thời gian thô; 0 tham chiếu tên cũ ngoài view |

---

## 6. Tiêu chí nghiệm thu module

| # | Tiêu chí | Cách đo |
|---|---|---|
| N1 | Một bảng thô `signal_sample`, 100 % hàng có `tag_id`, `quality`, `ts_source` | SQL |
| N2 | Một bus: 0 INSERT trực tiếp vào bảng chuỗi thời gian ngoài `ingestSignals` | grep census |
| N3 | C1: mất kết nối ⇒ mẫu `bad/comm_lost` ≤ 10 s, mặc định không cờ | test tích hợp simulator |
| N4 | S‑1 = 0: 0 khung hiện số không gạch sau ngưỡng cũ (đột biến bỏ tick ⇒ đỏ) | Playwright + đột biến |
| N5 | L‑A p95 ≤ 300 ms (capMs 100) sau T4; L‑C < 300 ms tầng nóng; tầng thường hiện tuổi đúng ±1 s | đo theo spec §2 (pha 0 mốc trước) |
| N6 | Một ngưỡng tuổi: `staleAfterMs` server-tính dùng ở SCADA, twin, cockpit, Kết nối; 0 ngưỡng cứng client | grep |
| N7 | Simulator không chiếm DB: dung lượng thô origin=sim ≤ 7 d; thô real retention 90 d; CAGG 3 năm | SQL |
| N8 | Job Timescale 0 lỗi mới trong 30 d; `telemetry.jobs` hiện lỗi nếu có | DB |
| N9 | UNS: topic v2 duy nhất, Sparkplug STATE phát; 0 topic legacy | broker log |
| N10 | 3 WAL → 1 `DurableBuffer`; dead-letter có UI xả lại | code + Playwright |
| N11 | 5 bảng lẻ gỡ; `machine_health_history`/`rul_estimates` không còn tăng vô hạn | SQL |
| N12 | Lớp màu thô trong `components/live/`, `pages/giam-sat/KetNoi*` = 0 | grep |

---

## 7. Câu hỏi mở — đã trả lời `[QĐ 2026-11-03]`

| # | Câu hỏi | Quyết định | Hệ quả |
|---|---|---|---|
| 1 | Simulator 1 699 máy × 30 s = 17,5 M hàng/ngày | **Retention 7 d cho `origin=sim`; dev mặc định topology 36 máy** (3 line × 12); 1 699 máy chỉ khi chạy bench | T1 (policy theo origin), T0 (SIM_* mặc định đổi); DB dev giảm ≈ 65 GB → < 2 GB sau 7 d |
| 2 | Lịch sử PdM 1,8 GB không retention | **Giữ 90 d gần nhất → `signal_sample(source=calc)`, xoá phần còn lại** | T8; báo trước khi xoá (nguyên tắc seed sai thì xoá) |
| 3 | Gộp `robot_telemetry` ngay | **Có** — tag ảo theo role `joint_*`/`mode`/`busy`; chỉ còn một bảng | T8; router robot vẫn tạm dừng (20 §7 Q2) |
| 4 | NATS/lake/stateStore/unsStreamGateway | **`stateStore` + `unsStreamGateway` gỡ; `streaming/*` + `lakeSink` đóng băng** (tap tắt, giữ mã) | T4 (sau 1a), T7 |
| 5 | Topic UNS legacy `avi/…` | **Gỡ hẳn ở T7, không alias**; trước T7 bật log subscriber trên aedes 1 chu kỳ (7 d) để chứng minh không consumer ngoài | T7; nếu log có subscriber ngoài ⇒ ghi Nhật ký và giữ alias thêm 14 d |
| 6 | `UNS_BROKER_URL` không đặt dù `UNS_BRIDGE_ENABLED=true` | **Đo tại máy dev 2026-11-03: cổng 1884 không có tiến trình lắng nghe ⇒ tắt cờ ở T0**; bật lại chỉ khi có EMQX thật và đặt URL | T0 |
| 7 | Dải migration 0490–0509 | **Đồng ý** | §5 |
| 8 | Chunk 1 ngày cho `signal_sample` | **Đồng ý** | §2.2 |

---

## 8. Nhật ký

| Ngày | Phiên | Việc | Số đo |
|---|---|---|---|
| 2026-11-03 | chủ dự án + chu-du-an-HST | **Duyệt v1.1**: 8 câu hỏi §7 theo khuyến nghị (sim 36 máy + 7 d; PdM xoá >90 d; gộp robot_telemetry; gỡ stateStore/unsStreamGateway; UNS legacy gỡ T7; UNS_BRIDGE tắt T0; mig 0490–0509; chunk 1 d) | cổng 1884/1883: không tiến trình lắng nghe (Get-NetTCPConnection) |
| 2026-11-03 | chu-du-an-HST | Viết v1 từ kiểm kê read-only `_ai8_wt c49f03c06` + DB live; nhận hợp đồng 1a (spec v3 §3.6) | 1 bus + 7 đường vào + 7 bảng lẻ; 576,9 M hàng/65 GB, 24 h = 17,5 M hàng 100 % simulator; 3 WAL; 5 ngưỡng tuổi; kênh SCADA tắt cờ, client poll 2 s |
| 2026-11-06 | do-model + dieu-phoi | **T0‑1 ĐÓNG — GIỮ `UNS_BRIDGE_ENABLED=true`, không lật cờ**: tiền đề "không có broker 1884" (đo 03/11) sai ở lần đo lại; điều kiện §7 câu 6 "bật lại khi có EMQX thật và đặt URL" đang thoả | `avi-aoi-management-emqx-1` (compose, `restart: unless-stopped`) map 1884→1883 đang chạy; :3000 có kết nối ESTABLISHED tới `[::1]:1884` |
| 2026-11-06 | do-model | **T0‑2 chờ E0‑2**: không có mã để sửa — `topology.mjs` vốn 3 line × 12, không có chế độ 1 699; nguồn 1 699 máy là `simOtTelemetryService` lặp mọi máy active (E0‑2 gỡ trên eng-ai). Đóng sau khi eng-ai lên main + :3000 bản mới + đo 24 h. ⚠ §3 dòng "`simOtTelemetryService` giữ" mâu thuẫn 70 (gỡ); **chủ dự án chốt 06/11: GỠ, chấp nhận máy DEV offline tới 70‑E5** ⇒ dòng §3 lỗi thời | `ot_telemetry` 1 h gần nhất: 197 084 hàng, 1 699 `deviceId` |
| 2026-11-06 | do-model + dieu-phoi | **T0‑3 thu hẹp**: mig `0490` (dieu-phoi duyệt SQL) là nguồn duy nhất chính sách 7 hypertable, chỉ hoà giải khi lệch, no-op trên DB đã chuẩn. **Giữ 0118/0172 trong thứ tự áp** (`migrate-standalone` chạy mọi `drizzle/*.sql`; 0172 tạo `measurement_results`, `product_inspections` — bỏ thì DB mới mất hypertable). **Gỡ `timescale/0003` + `TSDB_URL` dời sang T1** (đúng lộ trình §5 T1; còn energy, `telemetryBus`, `twinReplay`, compose/helm/k3s, 16 tệp test dùng) | DEV + _test: đúng 1 job nén + 1 job giữ/bảng, segmentby đúng, last_run Success; `job_errors`/`job_history` không còn hàng lỗi ⇒ không truy được nguồn 44/67 lỗi cũ |
| 2026-11-06 | do-model (dieu-phoi yêu cầu ghi) | **Nghi vấn cho 60/30, KHÔNG đổi ở T0‑3**: `product_inspections` là sổ WORM (mig 0279 REVOKE DELETE) nhưng chính sách giữ 365 d vẫn drop chunk; `0490` chỉ ghi lại trạng thái đang có (cùng `measurement_results`), không thêm mới. Cần 60 quyết WORM có bao gồm drop chunk theo tuổi hay không | job `policy_retention` `product_inspections` `drop_after` 365 days trên DEV + _test |
