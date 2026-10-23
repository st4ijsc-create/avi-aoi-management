# Thiết kế hoàn chỉnh — Hệ sinh thái nhà máy tự động hoá thông minh (lớp SCADA tham chiếu FUXA + Rapid SCADA)

- Ngày: 2026-10-22 · Trạng thái: **CHỜ CHỦ DỰ ÁN DUYỆT** — chưa viết mã, chưa tạo migration.
- Phạm vi: lớp giám sát – điều khiển (SCADA/HMI) cho SYNAPSE, đặt **lên trên** những gì repo đã có, không thay thế.
- Nguồn tham chiếu: mã nguồn `github.com/frangoteam/FUXA@master` (v1.3.5), `github.com/RapidScada/scada-v6@master` (6.5.0), tài liệu `rapidscada.net/docs`, các CVE công bố của FUXA. Đọc ngày 2026-10-22.

---

## 1. Ý định và lý do

SYNAPSE đã mạnh ở tầng 3 (MES/MOM, AOI/AVI, OEE, AI) và đã có **gần đủ ruột** của một SCADA: 6 driver giao thức thật, hàng đợi lệnh duy nhất có cổng an toàn, edge gateway có store-and-forward, UNS/Sparkplug, twin 3D, ISA-101. Cái còn thiếu là **"khuôn SCADA"** gom chúng thành một hệ mà kỹ sư tự động hoá quen dùng:

1. Mô hình **kênh (channel)** rõ kiểu vào/ra/tính toán — hiện `device_tags` chỉ có cờ `writable`.
2. **Cảnh báo theo tag** với vòng đời ISA-18.2 hợp nhất — hiện mảnh ghép nằm rải ở `master_alarms`, `predictive_alerts`, andon.
3. **Màn hình HMI 2D (mimic/P&ID)** có trình soạn thảo trên web và gắn tag — hiện **không có**.
4. **Lưu trữ phân tầng** hiện tại / lịch sử (phút–giờ–ngày) / sự kiện có hạn lưu từng loại.
5. **Công thức/script** chạy được trên dữ liệu nhưng không phá được an toàn.
6. **Lộ dữ liệu ra ngoài** chuẩn công nghiệp (OPC UA server) — hiện chỉ có vai client.
7. **Dự án cấu hình dạng tệp** xuất/nhập được, kiểm tra toàn vẹn.

FUXA cho ta mẫu **trải nghiệm** (soạn HMI SVG trên trình duyệt, gắn tag khai báo, chỉ gửi tag của màn đang xem). Rapid SCADA cho ta mẫu **kiến trúc** (tách Communicator khỏi Server, kiểu kênh, chuỗi kiểm `SendCommand`, trạng thái-là-dữ-liệu, quyền theo cây đối tượng, lưu trữ phân loại). Cả hai cho ta **danh sách lỗi phải tránh** (§3.3).

## 2. Mục tiêu · không mục tiêu · phản mục tiêu

**Mục tiêu (G)**
- G1. Kỹ sư cấu hình một máy mới từ **thiết bị → kênh → cảnh báo → màn HMI** hoàn toàn trên web, không sửa mã.
- G2. Mọi giá trị trên màn HMI, twin 3D, OEE, AI đều đọc từ **một** nguồn sự thật (`ot_telemetry` + state store); không thêm kho song song.
- G3. Mọi lệnh ghi — từ HMI, script, cảnh báo, AI, API — đi qua **đúng một** cửa `commandDispatcher.dispatch()`.
- G4. Cảnh báo theo tag có vòng đời đầy đủ (kích hoạt → xác nhận → hết → tạm gác/che), đo được KPI ISA-18.2 bằng `/alarm-kpi` sẵn có.
- G5. An toàn mặc định: tắt cờ ⇒ hành vi cũ y nguyên; bật cờ ⇒ vẫn đóng khi lỗi (fail-closed).
- G6. Hệ ngoài (MES khác, BI, SCADA cấp trên) đọc được tag qua OPC UA / MQTT‑Sparkplug / REST.

**Không mục tiêu (NG)**
- NG1. Không viết lại driver, không thay `otManager`/`commandDispatcher`/edge gateway.
- NG2. Không làm phần mềm desktop cấu hình kiểu Rapid SCADA Administrator — mọi thứ trên web.
- NG3. Không cạnh tranh làm runtime PLC. Logic điều khiển thời gian thực ở PLC/OpenPLC; SCADA chỉ giám sát và gửi lệnh có kiểm.
- NG4. Không làm SIL/an toàn chức năng. Mạch an toàn vẫn ở safety PLC; ta chỉ đọc trạng thái (`safetyPlcAdapter` sẵn có).
- NG5. Không nhúng Node-RED (FUXA có) — đã có Luồng AI/flow riêng.

**Phản mục tiêu (thất bại dù "chạy được")**
- A1. Một đường ghi thiết bị thứ hai đi vòng qua dispatcher (dù "chỉ cho script").
- A2. Một bảng telemetry/lịch sử thứ hai cho HMI.
- A3. Script phía server truy cập được `require`/hệ tệp/mạng (lỗ RCE của FUXA).
- A4. Một công thức lỗi làm sập cả server (lỗi của Rapid SCADA).
- A5. Tài khoản/khoá mặc định hoặc endpoint chạy mã không cần xác thực mạnh.
- A6. Màn HMI hiển thị giá trị cũ mà không báo chất lượng (quality) — người vận hành tin số giả.

## 3. Tham chiếu: lấy gì, tránh gì

### 3.1 Từ Rapid SCADA (kiến trúc)
| Ý tưởng | Bên họ | Ở ta |
|---|---|---|
| Tách vào/ra thiết bị khỏi lõi | Communicator ↔ Server qua TCP | **Đã có**: `server/edge/edgeGatewayMain.ts` (mỗi line một tiến trình) ↔ trung tâm qua `/edge/node/*`. Giữ, chuẩn hoá thành "Communicator". |
| Kiểu kênh | `CnlType` 1 Input · 2 In/Out · 3 Calc · 4 Calc/Out · 5 Output | Thêm cột `channel_kind` vào `device_tags` (§5.1). |
| Chuỗi kiểm lệnh | bật toàn cục → kênh tồn tại → là kênh ra → quyền `Control` trên Obj → công thức ra (veto) → audit mọi lần thử | `dispatch()` đã có 6 cổng; thêm 2 cổng: *kiểu kênh* và *veto công thức ra* (§5.5). |
| Trạng thái là dữ liệu | bảng `CnlStatus` (severity 1–999, AckRequired, màu) + `Lim` (LoLo/Low/High/HiHi/Deadband) | Bảng `scada_limit_sets` + `scada_status_styles` (§5.4). |
| Quyền theo cây đối tượng | `Obj` + `ObjRight` + `RoleRef` | Cây sẵn có `corporates→factories→workshops→production_lines→stations→machines`; thêm quyền phạm vi theo nút (§5.8). |
| Lưu trữ phân loại | Current / Historical (Min, Hour, Day) / Events, mỗi loại `Retention`, `ArchiveMask` | Current = `stateStore`; Historical = `ot_telemetry` + continuous aggregates Timescale; Events = bảng sự kiện cảnh báo (§5.3). |
| Đồng bộ chính/dự phòng, hàng đợi qua đường truyền kém | Rapid Gate | `storeForward.ts` (WAL JSONL) đã có ở edge; HA trung tâm để giai đoạn sau (§5.10). |

### 3.2 Từ FUXA (trải nghiệm)
- Trình soạn HMI **SVG trên trình duyệt** + thư viện ký hiệu P&ID (bơm, van, bồn, motor, băng tải).
- **Gắn tag khai báo** theo phần tử: giá trị, dải màu, ẩn/hiện, nhấp nháy, xoay, di chuyển, sự kiện bấm.
- **Chỉ đẩy tag của màn đang mở** (`broadcastAll=false`) + tải màn lười.
- Chế độ xác nhận cảnh báo `float / ackactive / ackpassive`; `checkdelay` (trễ kiểm) + `timedelay` (trễ bật).
- Hành động theo cảnh báo (popup, chuyển màn, gửi tin, chạy script) — ở ta mọi hành động *ghi* phải quy về lệnh qua dispatcher.
- OpenAPI + API key — ta đã có `/api/v1` + `openapi.ts`.

### 3.3 Phải tránh (đã xảy ra thật ở hai dự án)
1. FUXA tắt bảo mật mặc định, `admin/123456`, chuỗi CVE RCE trước xác thực (CVE‑2025‑69985 `/api/runscript`, CVE‑2026‑25893, CVE‑2026‑43945, CVE‑2026‑43947 chế độ "test" script vượt phân quyền).
2. FUXA chạy script server trong cùng tiến trình với toàn quyền Node.
3. FUXA chọn driver bằng chuỗi `if/else` + cài npm lúc chạy.
4. FUXA không audit lệnh (bản mã mở), không phân biệt tag ra/vào — ghi được mọi tag.
5. Rapid SCADA: một công thức C# biên dịch lỗi ⇒ Server không chạy.
6. Rapid SCADA: kênh đánh số nguyên phẳng; cấu hình bằng ứng dụng desktop; HA và driver S7 là trả phí.

## 4. Hiện trạng đã kiểm (2026-10-22, nhánh `feat/ai-local-L7-hang-rao` @ `b49cb142a`)

| Khối SCADA | Đã có (đường dẫn) | Thiếu |
|---|---|---|
| Driver | `server/services/ot/otDriver.ts` (interface), `driverRegistry.ts`, drivers OPC UA/Modbus/S7/EtherNet‑IP/Mitsubishi MC/SLMP + stub; plugin sidecar `services/plugins/` | OpenPLC chưa nối (chỉ có `openplcNotConfigured`); chưa có "kênh tính toán" |
| Mô hình | `drizzle/schema/ot.ts`: `device_adapters`, `device_tags` (writable, scale/offset, deadband, stop_value), `ot_telemetry`, `command_log` (WORM), `uns_tag_mappings`; cây `hierarchy.ts` | kiểu kênh, ngưỡng/giới hạn, nhãn hiển thị, định dạng |
| Lưu trữ | `ot_telemetry` + `drizzle/timescale/0003` (chunk 7 ngày, nén 30 ngày, giữ 90 ngày — **chỉ trên TSDB riêng `TSDB_URL`, hiện đang comment trong `.env`**; bảng ở DB chính không có hạn lưu); `stateStore.ts` (bản chụp theo **thiết bị**, tối đa 16–64 giá trị, chỉ được nuôi từ heartbeat Socket.IO của máy — `stateStore/ingest.ts` ghi rõ **không** móc vào `telemetryBus`) | tổng hợp phút/giờ/ngày có hạn lưu riêng; mặt nạ lưu theo kênh; **giá trị hiện tại theo từng tag** |
| Cảnh báo | `master_alarms` (danh mục hợp lý hoá, shelvedUntil), `alarm_taxonomy`, `alertEvaluationService`, `services/alerts/` (**hàm quyết định thuần**, không có subscriber eventBus), andon, `/alarm-kpi` (**chỉ đếm `andon_events` + `predictive_alert_occurrences`**), `notificationService`, app `FactoryAlertSystem/` | bộ máy cảnh báo **theo tag** có vòng đời hợp nhất |
| Lệnh | `services/ot/commandDispatcher.ts` `dispatch()` (xác nhận người `triggeredBy.kind:"hitl"` gắn băm đúng lệnh qua `ai_pending_actions`, allowlist writable, `OT_CONTROL_ENABLED`, commissioning, sổ ghi trước + advisory lock, readback, `cmd_ack`); **adapter có `edgeNodeId` ⇒ trung tâm từ chối `ADAPTER_OWNED_BY_EDGE`** trừ lệnh DỪNG (chuyển xuống edge) — ghi vào máy do edge sở hữu đi đường riêng `services/edge/edgeExecutionCentral.ts`/`edgeExecutionAgent.ts`; `aiControlGate.ts` (L7), khoá chuyển động robot, interlock, `actuationProcedure` (2FA) | cổng kiểu kênh, veto công thức ra, **đường ghi HMI cho máy do edge sở hữu** |
| HMI | twin 3D `/twin*`, `TwinStudio`, `Layout`, ISA‑101 (`hmiFlags.ts`), `MachineCockpit`, `DeviceHub`, dashboard builder | **trình soạn mimic 2D SVG + gắn tag** |
| Thời gian thực | Socket.IO (`server/_core/socket.ts` + Redis adapter, phòng `machine:{id}`), UNS stream `uns:subscribe {path_prefix, aspects, min_severity}` ≤ 20 tiền tố/socket, gộp delta khi nghẽn (`unsStreamGateway.ts`, cờ `WS_UNS_STREAM_ENABLED`), tap `registerTelemetryTap` trên `telemetryBus`, SSE, NATS | đăng ký **theo danh sách tag** của màn |
| Hướng bắc | REST `/api/v1`, MQTT (aedes), Sparkplug, federation | **OPC UA server** |
| Cấu hình dạng mã | `ot/mappingAsCode.ts` | gói dự án SCADA đầy đủ (thiết bị+kênh+cảnh báo+màn) |

Cờ trong `.env` cục bộ: `OT_CONTROL_ENABLED` bật, `OT_GATEWAY_ENABLED` **đang comment** (trung tâm không tự poll; thu thập ở edge), `WS_UNS_STREAM_ENABLED`/`STATE_STORE_ENABLED` vắng.

## 5. Thiết kế

### 5.0 Kiến trúc tổng thể

```
 Tầng 4  ERP/PLM ── B2MML/REST (có sẵn)
 Tầng 3  MES · OEE · AOI/AVI · AI · Twin 3D · Báo cáo          (có sẵn)
         ───────────────────────────────────────────────────────────────
 Tầng 2  ┌──────────────── SCADA CORE (MỚI, trong server trung tâm) ───────────────┐
 SCADA   │ K1 Mô hình kênh  K3 Lưu trữ  K4 Cảnh báo tag  K5 Cổng lệnh (bọc dispatch)│
         │ K6 HMI mimic 2D  K7 Công thức sandbox  K8 Quyền theo cây  K9 OPC UA srv │
         └───────▲─────────────────────────────▲──────────────────────────┬────────┘
                 │ telemetry/ack (/edge/node/*, UNS)                       │ lệnh đã kiểm
                 │                    máy trung tâm sở hữu: dispatch() ─────┤
                 │          máy edge sở hữu: edgeExecutionCentral → agent ──┤ (xem Q1 §11)
 Tầng 1  ┌───────┴──────── COMMUNICATOR = edge gateway mỗi line (có sẵn) ─▼────────┐
         │ otManager · drivers · store-forward · deadband · supervisor HA          │
         └───────▲─────────────────────────────────────────────────────────────────┘
 Tầng 0  PLC (S7/MC/AB/OpenPLC) · OPC UA server máy · Modbus · robot · safety PLC
```

Nguyên tắc tương thích:
- **Chỉ thêm (additive)**: cột nullable + bảng mới; không đổi tên/xoá cột cũ.
- Mỗi khối có cờ riêng `SCADA_*_ENABLED`, **mặc định OFF** trong `.env.example`.
- Dải migration đề xuất **0430–0449** (0400–0419 đã chia cho các phiên AI; để trống 0420–0429 làm vùng đệm). *(Quyết định của tôi — đổi được.)*
- Không thêm tiến trình mới ở trung tâm ngoại trừ worker sandbox công thức (K7). OPC UA server (K9) chạy **trong** tiến trình server, bật bằng cờ.
- Phản mục tiêu A2 hiểu là: không thêm **kho bền** song song. Bộ nhớ đệm giá trị mới nhất trong RAM (§5.3) suy ra từ `telemetryBus` là được phép — nó không phải nguồn sự thật, mất khi khởi động lại và được nạp lại từ `ot_telemetry`.

### 5.1 K1 — Mô hình kênh

Mở rộng `device_tags` (nullable, NULL = hành vi cũ):

| Cột mới | Kiểu | Ý nghĩa |
|---|---|---|
| `channel_kind` | enum `input · input_output · calculated · calculated_output · output` | NULL ⇒ suy ra: `writable=true` → `input_output`, ngược lại `input`. |
| `display_name`, `description` | varchar/text | tên cho HMI. |
| `format` | varchar | ví dụ `0.00`, `enum:dung,chay,loi`. |
| `limit_set_id` | int FK `scada_limit_sets` | ngưỡng cảnh báo (K4). |
| `archive_mask` | int (bitmask) | bit0 current, bit1 phút, bit2 giờ, bit3 ngày, bit4 sự kiện. NULL ⇒ như hiện nay (mọi mẫu vào `ot_telemetry`). |
| `formula_in_id`, `formula_out_id` | int FK `scada_formulas` | K7. |
| `write_min`, `write_max` | double | dải ghi cho phép (kiểm ở cổng lệnh). |

Kênh tính toán (`calculated*`) không có địa chỉ thiết bị thật: dùng một adapter ảo protocol `calc` (đăng ký vào `driverRegistry` như `stub`), giá trị do K7 sinh rồi đi **cùng đường** `ingestTelemetry` ⇒ HMI/twin/OEE thấy như kênh thường.

Định danh: giữ `(adapterId, tagKey)` làm khoá; **không** dùng số nguyên phẳng kiểu `CnlNum`. Đường hiển thị = đường ISA‑95 của máy + `tagKey` (đã có trong `isa95Resolver.ts`).

### 5.2 K2 — Communicator (edge) và driver

- Giữ nguyên edge gateway làm "Communicator". Chuẩn hoá hợp đồng: edge chỉ đọc/ghi thiết bị, đẩy mẫu + chất lượng; mọi quyết định (ngưỡng, quyền, công thức) ở trung tâm. Ngoại lệ có chủ đích: deadband và store‑forward ở edge (đã có).
- **OpenPLC**: nối qua driver Modbus TCP sẵn có (OpenPLC runtime là Modbus slave: `%IX/%QX/%IW/%QW/%MW`). Thêm *mẫu thiết bị* "OpenPLC runtime" sinh sẵn bảng địa chỉ chuẩn → không cần driver mới. Phù hợp bench OpenPLC + MATIEC đang dùng.
- **Mẫu thiết bị (device template)**: một bản ghi khai báo danh sách kênh + ngưỡng + ký hiệu HMI mặc định cho một loại máy; áp vào máy mới ⇒ sinh `device_tags`. Liên kết với `device_types` (doc 56).
- Không đổi `OtDriver`. Driver bên thứ ba đi qua plugin sidecar sẵn có (không cài npm lúc chạy).

### 5.3 K3 — Lưu trữ

| Loại | Nguồn | Hạn lưu mặc định |
|---|---|---|
| Current | **mới**: `scadaLiveCache` — Map trong RAM `(adapterId,tagKey) → {value, quality, ts}`, nuôi bằng `registerTelemetryTap` trên `telemetryBus`; khởi động nạp từ `getLatestTelemetry`. Không đụng `stateStore` (giữ nguyên cho `/v1/state` và twin). *(Quyết định của tôi.)* | RAM |
| Thô | `ot_telemetry` (hypertable khi có `TSDB_URL`) | 90 ngày trên TSDB; DB chính: thêm job xoá theo `DATA_RETENTION_ENABLED` sẵn có, mặc định 90 ngày |
| Phút / Giờ / Ngày | **continuous aggregates** Timescale trên `ot_telemetry`: min/max/avg/last/count + tỉ lệ quality tốt | 1 năm / 3 năm / 10 năm |
| Sự kiện | `scada_alarm_events` (K4) + `command_log` | 3 năm (WORM giữ nguyên quy tắc hiện có) |

- `archive_mask` lọc kênh nào được tổng hợp (giảm tải). Vì continuous aggregate nằm ở TSDB riêng (không join được `device_tags`), mặt nạ được **đẩy thành cột `meta.arc`** lúc ingest (hoặc bảng sao nhỏ `scada_archive_mask` đồng bộ sang TSDB) — người xây chọn, miễn không join chéo DB. Thiếu TimescaleDB ⇒ tổng hợp phút/giờ bằng job `node-cron` ghi bảng thường `scada_rollup_*` — **cùng hợp đồng đọc** để HMI không phân biệt. *(Quyết định của tôi: hai đường cài đặt, một API.)*
- API đọc lịch sử dùng lại `/api/v1/timeseries`, thêm tham số `resolution=raw|1m|1h|1d`, tự chọn độ phân giải theo khoảng thời gian.
- Chú ý bẫy đã biết: timestamp naive bị lệch −7 h với postgres.js — mọi cột thời gian mới dùng `timestamptz`.

### 5.4 K4 — Cảnh báo theo tag (ISA‑18.2)

Bảng mới:
- `scada_limit_sets(id, name, lolo, low, high, hihi, deadband, check_delay_ms, on_delay_ms, off_delay_ms)` — dùng chung được cho nhiều kênh (như `Lim`).
- `scada_alarm_defs(id, tag_id, condition` (`hihi|high|low|lolo|bool_true|bool_false|change|bad_quality|expr`)`, severity 1–1000, priority` (`critical|high|medium|low|diagnostic` — trùng `alarm_taxonomy`)`, ack_mode` (`none|ack_active|ack_any`)`, message_template, master_alarm_code` (FK mềm sang `master_alarms`)`, enabled)`.
- `scada_alarm_state(alarm_def_id PK, state, since, value, acked_by, acked_at, shelved_until, shelved_by, suppressed_by)` — một dòng mỗi định nghĩa, cập nhật tại chỗ.
- `scada_alarm_events` — append‑only: mọi chuyển trạng thái, có user, giá trị, lý do.

Máy trạng thái (ISA‑18.2): `NORMAL → UNACK_ACTIVE → ACK_ACTIVE → NORMAL`, nhánh `UNACK_RTN` (hết nhưng chưa xác nhận), cộng `SHELVED` (có hạn, bắt buộc lý do), `SUPPRESSED_BY_DESIGN` (che theo trạng thái máy — ví dụ máy đang bảo trì từ `downtime_events`/PackML), `OUT_OF_SERVICE`.

Đánh giá: chạy ở trung tâm trên luồng `telemetry:sample` (đã có), không ở edge. Trễ bật/tắt + deadband chống "chattering". Quality `bad` quá `check_delay_ms` ⇒ cảnh báo chất lượng riêng (chống A6).

Nối với hiện có — không thay *(quyết định của tôi: giữ `scada_alarm_*` riêng, không đội lốt andon/predictive)*:
- Sự kiện kích hoạt ⇒ phát `eventBus` loại mới `scada.alarm`. **Viết mới** một subscriber `scadaAlarmNotifier` dùng lại các hàm quyết định thuần trong `services/alerts/` (`decideNotify`…) + `notificationService` + kênh MQTT của app di động. (Hiện chưa có subscriber nào làm việc này.)
- **Mở rộng `alarmKpiRouter.ts`** thêm nguồn thứ ba `scada_alarm_events` (cùng cổng phạm vi `resolveAlertScope`), để `/alarm-kpi` đếm cảnh báo tag. `master_alarm_code` chỉ dùng để gộp/khử trùng và tra hậu quả/hướng xử lý.
- Khử trùng với andon: khoá `(machineId, master_alarm_code)` trong cửa sổ ngắn — nếu andon đã mở cùng mã thì cảnh báo tag gắn vào chứ không thông báo lần hai.
- Hành động theo cảnh báo chỉ gồm: thông báo, mở màn, **đề xuất** lệnh (người bấm xác nhận rồi mới vào dispatcher). Không có hành động tự ghi trong bản đầu.

### 5.5 K5 — Cổng lệnh SCADA

Không viết đường ghi mới. Thêm lớp mỏng `scadaCommandService` có **hai bước** `request()` → `confirm()`, rồi giao cho đường ghi sẵn có theo chủ sở hữu adapter: máy trung tâm sở hữu ⇒ `dispatch()`; máy edge sở hữu ⇒ đường thực thi edge (xem **Q1 §11** — chờ bạn chọn).

Xác nhận người: **dùng lại** cơ chế `triggeredBy.kind:"hitl"` + `ai_pending_actions` với băm payload: `request()` tạo bản ghi chờ (đánh dấu nguồn `scada_hmi`), người vận hành bấm xác nhận trong hộp thoại ⇒ `confirm()` gọi `dispatch()` với đúng bản ghi đó. Không thêm `kind` mới vào dispatcher (giữ NG1). *(Quyết định của tôi.)*

Thứ tự cổng (theo Rapid SCADA), bước 1–6 chạy **trong `request()` trước khi hiện hộp thoại** — nên hộp thoại hiển thị giá trị **sau** công thức, và băm gắn đúng giá trị đó:

1. Cờ `SCADA_COMMANDS_ENABLED` (thêm vào cùng `OT_CONTROL_ENABLED`).
2. Kênh tồn tại, `enabled`.
3. **Kiểu kênh là ra** (`input_output|calculated_output|output`) — kênh `input` từ chối kể cả khi `writable=true` bị đặt sai. *(Với `channel_kind` NULL giữ quy tắc cũ của `writable`.)*
4. Giá trị trong `write_min..write_max` và đúng kiểu.
5. Quyền **Control** trên nút cây chứa máy (K8) + `requirePermission("machine_control","canEdit")` như hiện nay.
6. **Công thức ra** (K7) — được biến đổi hoặc **veto**; lỗi/timeout công thức ⇒ từ chối (fail‑closed).
7. Bàn giao `dispatch()` — mọi cổng hiện có (xác nhận người gắn lệnh dùng một lần, commissioning, interlock, khoá chuyển động, L7 cho AI, sổ ghi trước, readback) giữ nguyên.
8. Audit **mọi lần thử**, kể cả bị từ chối ở bước 1–6, vào `command_log` với lý do.

HMI: nút ghi luôn mở hộp xác nhận hiển thị *giá trị cũ → mới (sau công thức), máy, kênh*.

2FA: thêm cột `actuation_level` (1–5) cho kênh ra, **cùng thang với L7** (`aiControlGate.ts`: 1 dừng/tạm dừng · 3 tham số · 4 khởi động/reset · 5 chuyển động/tham số an toàn/interlock). Mức ≥ 4 ⇒ `confirm()` chạy qua `actuationProcedure` (2FA); mức 5 thêm TOTP mới mỗi lần như `deployProcedure`. Kênh ra chưa khai mức ⇒ coi là 5 (đóng mặc định). *(Quyết định của tôi.)*

### 5.6 K6 — HMI mimic 2D

- Trang mới `/scada/views` (cây màn theo cây nhà máy) và `/scada/views/:id` (chạy), `/scada/views/:id/edit` (soạn). Đặt cạnh twin 3D: twin cho **không gian**, mimic cho **quy trình** (P&ID, sơ đồ điện, trạm). Từ twin bấm máy ⇒ mở mimic của máy và ngược lại.
- Lưu trữ: `scada_views(id, node_type, node_id, name, svg, bindings jsonb, version, published_at, created_by)` + `scada_view_versions` (lưu bản cũ). Bản nháp và bản phát hành tách nhau; chỉ bản phát hành hiển thị cho vận hành.
- Soạn thảo: **viết mới bằng React + SVG** (không nhúng svg‑edit của FUXA — tránh gánh mã minified, khó bảo trì). *(Quyết định của tôi.)* Gồm: lưới/bắt dính, nhóm, lớp, thư viện ký hiệu (ISA‑5.1 P&ID + ký hiệu ISA‑101 có sẵn), nhập SVG ngoài (lọc `<script>`, `on*`, `foreignObject`, href ngoài — chống XSS).
- Gắn tag khai báo (`bindings`): `text` (giá trị + định dạng + đơn vị), `fill/stroke` theo dải hoặc trạng thái cảnh báo, `visible`, `blink`, `rotate`, `translate`, `level` (mức bồn), `click → openView | command(kênh, giá trị) | showTrend(kênh)`. Không có binding nào chạy mã tuỳ ý.
- Màu theo ISA‑101: nền xám, chỉ tô màu khi bất thường; màu cảnh báo lấy từ `scada_status_styles` (bảng nhỏ priority → màu/nhấp nháy), không cứng trong mã.
- Thời gian thực: `uns:subscribe` hiện chỉ nhận tiền tố đường (≤ 20) và gộp delta theo thiết bị — không hợp cho màn 200 tag. Thêm sự kiện Socket.IO riêng `scada:subscribe { tags: [{adapterId, tagKey}] }` → `scada:snapshot` (từ `scadaLiveCache`) + `scada:delta` (từ tap), kiểm quyền `view` theo phạm vi từng tag, giới hạn 500 tag/màn, **không bỏ** giá trị cuối khi nghẽn (gộp theo tag, giữ bản mới nhất). *(Quyết định của tôi.)*
- Tag `quality≠good` hoặc quá tuổi ⇒ vẽ gạch chéo/viền tím "không tin được". Ngưỡng tuổi = `max(3 × chu kỳ poll, heartbeat deadband 60 s + 10 s)` khi tag có deadband; = `3 × chu kỳ poll` khi không. Kênh tính toán: tuổi của đầu vào cũ nhất.
- Biểu đồ xu hướng: thành phần dùng recharts sẵn có, đọc K3.

### 5.7 K7 — Công thức / script an toàn

- Bảng `scada_formulas(id, name, kind` (`input|output|calculated|scheduled`)`, language='js-expr', source, enabled, status` (`ok|quarantined`)`, last_error)`.
- Chạy trong **worker thread riêng** với **`isolated-vm`** (phụ thuộc native **mới**, chưa có trong `package.json` — phải thử build trên Windows ở đầu S4) (heap giới hạn, timeout 50 ms/lần, không `require`, không mạng, không tệp). API trắng duy nhất: `val(tag)`, `stat(tag)`, `prev(tag)`, `now()`, `deriv(tag)`, hàm toán học; công thức ra có thêm `cmd.value` và trả về giá trị mới hoặc `REJECT(lý do)`.
- Biên dịch **từng công thức riêng**; lỗi ⇒ chỉ công thức đó `quarantined` + cảnh báo kỹ thuật, phần còn lại chạy tiếp (chống A4).
- Script **không có quyền ghi**. Kết quả của công thức tính toán đi vào kênh `calculated`; muốn ghi thiết bị phải là kênh `calculated_output` và lệnh vẫn qua K5 — tức vẫn bị xác nhận người/cổng (chống A1, A3).
- Có chế độ "thử" trên dữ liệu lịch sử — chạy cùng sandbox, cùng phân quyền (bài học CVE‑2026‑43947).

### 5.8 K8 — Bảo mật và phân quyền

- Dùng lại: phiên đăng nhập, `requirePermission`, `actuationProcedure`/`deployProcedure` (2FA), `control_audit_log` chuỗi băm, RLS theo mã nhà máy.
- Thêm quyền **theo phạm vi cây**: `scada_scope_grants(user_id|role, node_type, node_id, right` (`view|control|configure`)`)`, thừa kế xuống nút con (như `ObjRight`). Kiểm ở mọi API SCADA và ở bước 5 của K5. Không có bản ghi ⇒ không có quyền (đóng mặc định).
- Triển khai không khoá người dùng *(quyết định của tôi)*: quyền phạm vi **AND** với phạm vi nhà máy sẵn có (`resolveAlertScope`/RLS) — không thay thế. Migration gieo sẵn `view` cho mọi người dùng theo nhà máy hiện được phép; `control` và `configure` **không gieo**, admin cấp tay. Trước khi bật cờ có báo cáo "ai sẽ mất quyền gì". Admin vẫn bypass như quy tắc hiện tại của `requirePermission` — ghi rõ trong audit.
- Không tài khoản mặc định, không endpoint "chạy script" từ xa. Kiểm thử **ma trận phân quyền** (vai trò × endpoint × phạm vi) chạy trong CI — FUXA chỉ thêm sau khi dính CVE.

### 5.9 K9 — Hướng bắc: OPC UA server

- OPC UA server chạy trong tiến trình server trung tâm, bằng `node-opcua` (đã là phụ thuộc) — `OPCUAServer`, **chỉ đọc** ở bản đầu. Không gian địa chỉ = cây ISA‑95 → máy → kênh; biến mang `StatusCode` từ quality, `SourceTimestamp` từ `ts`.
- Bảo mật: chỉ `SignAndEncrypt` + `Basic256Sha256` trở lên, chứng chỉ qua PKI sẵn có `opcuaSecurity.ts`, user/password hoặc chứng chỉ; không cho Anonymous.
- Ghi qua OPC UA: **không** ở bản đầu. Nếu sau này mở, ghi phải đổi thành lệnh K5.
- Cờ `SCADA_OPCUA_SERVER_ENABLED`, cổng 4840 mặc định, chỉ nghe trên giao diện cấu hình.

### 5.10 K10 — Sẵn sàng cao

- Edge: đã có store‑forward + supervisor HA kết nối. Giữ.
- Trung tâm: bản này **không** làm HA chủ/dự phòng (ngoài phạm vi). Thiết kế để không cản: trạng thái cảnh báo ở DB (không ở RAM), máy đánh giá cảnh báo chỉ chạy một bản nhờ advisory lock (như dispatcher), Socket.IO đã có Redis adapter.

### 5.11 K11 — Gói dự án dạng tệp

- Xuất/nhập một **gói JSON có phiên bản** gồm: mẫu thiết bị, adapter (không kèm bí mật — tham chiếu `connectionSecrets`), kênh, bộ ngưỡng, định nghĩa cảnh báo, công thức, màn mimic. Mở rộng `mappingAsCode.ts` thay vì viết mới.
- Nhập = chạy thử (dry‑run) trước: kiểm khoá ngoại, tag trùng, công thức biên dịch được, binding trỏ tới kênh có thật; báo diff; áp trong một giao dịch.
- Lưu trong git được (thân thiện diff), đúng tinh thần XML của Rapid SCADA.

## 6. Lộ trình theo đợt (mỗi đợt có cổng nghiệm thu đo được)

| Đợt | Nội dung | Cổng nghiệm thu |
|---|---|---|
| S0 | Đo hiện trạng: chạy edge + Modbus sim + OpenPLC bench, đo độ trễ mẫu → HMI hiện có, kiểm kê tag thật | Bảng số đo gốc; thiết bị đo được kiểm trước (đột biến biết trước phải bị bắt) |
| S1 | K1 + K5 (kiểu kênh, dải ghi, cổng mới, audit lần từ chối) | Kênh `input` bị từ chối ghi dù `writable=true`; 100 % lần thử có dòng audit; tắt cờ ⇒ suite cũ xanh y nguyên |
| S2 | K4 cảnh báo tag + nối eventBus/andon/app | Kịch bản HiHi → ack → RTN → shelve hết hạn đúng trạng thái; chattering 10 Hz sinh ≤ 1 sự kiện; `/alarm-kpi` đếm đúng |
| S3 | K6 HMI mimic (chạy trước, soạn sau) + K3 xu hướng | Kỹ sư dựng màn trạm từ đầu < 30 phút không sửa mã; tag stale hiển thị "không tin được" trong ≤ 3 chu kỳ; màn 200 tag ≤ 5 % CPU client |
| S4 | K7 công thức sandbox | Công thức `while(true)` bị cắt ≤ 50 ms, server sống; công thức có `require` bị từ chối; công thức lỗi chỉ cách ly chính nó |
| S5 | K3 tổng hợp phút/giờ/ngày + K11 gói dự án | Xuất → xoá → nhập ra cùng cấu hình (so băm); truy vấn 1 năm dữ liệu giờ < 1 s |
| S6 | K9 OPC UA server + K8 ma trận quyền CI + mẫu OpenPLC | UaExpert đọc đúng giá trị/quality; Anonymous bị từ chối; ma trận quyền 100 % ô có kiểm |

Mỗi đợt: TDD, đột biến kiểm lưới, cờ OFF mặc định, chạy trên dev trước, báo cáo tách LOGIC · DỮ LIỆU · VẬN HÀNH.

## 7. Thước đo thành công cuối cùng
- Thời gian đưa một máy mới lên SCADA (thiết bị → màn HMI có cảnh báo): mục tiêu < 2 giờ với mẫu thiết bị, đo trên 3 máy thật.
- 0 đường ghi thiết bị ngoài `dispatch()` (kiểm bằng AST census, như lưới hiện có).
- Độ trễ mẫu → màn HMI p95 < 1 s trên LAN.
- 0 tài khoản/khoá mặc định; ma trận quyền xanh trong CI.

## 8. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Trình soạn SVG tốn công hơn dự tính | S3 làm *chạy* trước bằng SVG nhập từ công cụ ngoài (Inkscape) + gắn binding bằng bảng; trình soạn kéo thả sau |
| `isolated-vm` là addon native, có thể vướng build Windows | Phương án B: `worker_threads` + `vm` với `resourceLimits` và timeout ở luồng chính (yếu hơn) — chỉ dùng nếu A không build được, phải ghi rõ |
| Hai hệ cảnh báo (cũ + tag) gây báo trùng | Tag‑alarm phát qua cùng `services/alerts/` với khoá khử trùng theo `master_alarm_code` + máy |
| Không có TimescaleDB ở một số nơi | Đường rollup bằng cron cùng hợp đồng đọc (§5.3) |
| Mở rộng `device_tags` đụng phiên khác | Chỉ cột nullable, dải migration riêng, census thủ tục trước khi thêm |

## 9. Các quyết định tôi đã tự đưa ra (cần bạn xem lại)
1. Dải migration 0430–0449.
2. Viết trình soạn HMI mới bằng React/SVG, không nhúng svg‑edit của FUXA.
3. Script dùng biểu thức JavaScript trong `isolated-vm`, không dùng C# như Rapid SCADA.
4. OPC UA server bản đầu **chỉ đọc**.
5. Cảnh báo theo tag đánh giá ở trung tâm, không ở edge.
6. Hành động tự động theo cảnh báo **không được ghi thiết bị** ở bản đầu (chỉ đề xuất).
7. OpenPLC nối qua Modbus TCP sẵn có + mẫu thiết bị, không viết driver riêng.
8. Không làm HA trung tâm trong phạm vi này.

9. Giá trị hiện tại theo tag lấy từ bộ đệm RAM mới nuôi bằng tap `telemetryBus`, không sửa `stateStore`.
10. Kênh thời gian thực riêng `scada:subscribe` theo danh sách tag, không dùng `uns:subscribe`.
11. Xác nhận người dùng lại `ai_pending_actions` + băm, không thêm kiểu trigger vào dispatcher; công thức ra chạy trước hộp thoại.
12. Cảnh báo tag ở bảng riêng; viết subscriber thông báo mới; mở rộng `/alarm-kpi`.
13. 2FA theo `actuation_level` cùng thang L7; chưa khai ⇒ mức 5.
14. Quyền phạm vi AND với phạm vi nhà máy; chỉ gieo `view`.

## 10. Để lại cho người xây dựng
Thư viện vẽ trong trình soạn, cấu trúc thư mục client/server cho module `scada`, tên route tRPC, chi tiết lược đồ JSON của `bindings`, định dạng gói dự án (miễn có `schemaVersion`), chiến lược cache phía client.

## 11. Câu hỏi chờ chủ dự án (thay đổi thứ sẽ xây)

- **Q1. Lệnh ghi từ HMI vào máy do edge sở hữu đi đường nào?** Hiện trung tâm từ chối mọi lệnh ghi (trừ DỪNG) vào adapter có `edgeNodeId`, và thu thập đang ở edge. Phương án:
  - (a) **[đề xuất]** Đi qua đường thực thi edge sẵn có (`edgeExecutionCentral` → `edgeExecutionAgent`, có ký, có ủy quyền từng bước, doc 81 Đợt 9–10). K5 làm cổng 1–6 + xác nhận người ở trung tâm rồi tạo lượt thực thi edge. Khối lượng S1 tăng, nhưng không nới hàng rào nào.
  - (b) Nới cổng sở hữu để trung tâm ghi thẳng — **không khuyến nghị**, đi ngược quyết định "edge là người ghi duy nhất".
  - (c) Bản đầu chỉ ghi cho máy trung tâm sở hữu; máy edge chỉ giám sát.
- **Q2. Môi trường nghiệm thu:** có dựng TimescaleDB (`TSDB_URL`) cho S5 không, và 3 máy thật + bench OpenPLC nào dùng để đo thước đo §7?

## 12. Kiểm tra độc lập đã chạy
Một người đọc độc lập (vai kỹ sư xây dựng) đã đối chiếu bản này với mã ngày 2026-10-22 và chỉ ra 5 khẳng định sai về hiện trạng (sở hữu edge của dispatcher, hợp đồng `uns:subscribe`, `stateStore` không nhận telemetry, `/alarm-kpi` không đếm `master_alarms`, `services/alerts/` không có subscriber). Cả 5 đã được kiểm lại bằng `grep` và sửa trong §4–§5; các câu hỏi còn lại đã được tôi quyết định (§9 mục 9–14) hoặc chuyển lên §11.
