# Phụ lục BE3 — Data-in · Realtime · Runtime · Nền tảng: sẵn sàng cho nhà máy thật?

> Thuộc doc 81. 2026-09-27. Đo bằng **instance riêng** `dist/index.js` trên :3017 (`NODE_ENV=production ROLE=api`, DB `aoi_management_test`, Redis/NATS/UNS tắt, MQTT dời sang 11883/18883) — :3000 (PID 15544) không bị động tới. Số thô (ngoài repo): scratchpad phiên `B3-platform/` (`load_results.json`, `mqtt_results.json`, `sock*_results_N*.json`, `db_*.txt`).
> Thang mức: M0 không có · M1 khung · M2 cài thật + test mock · M3 chạy thật end-to-end với giả lập · M4 chứng minh với thiết bị/tải thật · M5 sẵn sàng sản xuất.

**Tác dụng phụ của phép đo (ghi thẳng):** lần khởi động đầu instance đo đã nối vào EMQX dùng chung `localhost:1884` và phát Sparkplug NBIRTH `spBv1.0/avi/NBIRTH/avi-aoi-ot` **trùng edge-node id với :3000**; khi tắt, broker phát will NDEATH (không tìm thấy nơi nào trong repo tiêu thụ NDEATH). Instance cũng nạp `Qwen3-Embedding-0.6B` lên GPU ~1 phút. Trong `_test`: tạo 2 máy pilot (id 17118/17119) + khoá `mk_` (vẫn còn); đã xoá dữ liệu thử (943.461 dòng `ot_telemetry`, 208 `mqtt_clients`, 2.018 `machine_status_logs`). Tệp khoá plaintext của `_test` đã bị phiên chính xoá.

## Kết luận

**Chưa sẵn sàng.** Lõi kỹ thuật tốt hơn mong đợi — một node đo được: ingest REST **700 req/s** (21,7k mẫu/s theo lô), fan-out socket **1.000 client p99 95 ms**, broker MQTT **32k msg/s**. Nhưng có nhiều lỗ **mất dữ liệu im lặng** và **giả mạo thiết bị** (đã tái hiện), **chưa từng có bản backup nào**, **server không đồng bộ giờ**, health check báo sai, và không lớp nào có bằng chứng M4. Mức chung **M2–M3**.

## 1. Mức trưởng thành theo lớp

### L4 — Ingest & telemetry

| Thành phần | Mức | Bằng chứng | GAP |
|---|---|---|---|
| REST `/api/ot/ingest` | **M3** | `server/_core/index.ts:389-439`; 1 mẫu/req 700 req/s p99 50 ms; lô 100 → 13,7k mẫu/s; lô 2000 → 21,7k/s p99 815 ms; số dòng DB khớp số nhận (940.030) | **Mất dữ liệu im lặng: lô ≥7.000 mẫu trả `200 {ok:true, accepted:0}`** (giới hạn tham số bind Postgres; đo 7k/8k/12k). Mẫu `ts` sai ⇒ 500 và **làm hỏng WAL store-forward** (`telemetryBus.ts:260`, `storeForward.ts:166`) |
| Ràng buộc máy ↔ khoá | **M1** | **Đo: khoá của ESP32 ghi được telemetry cho `SCRW-SIM-01`** (HTTP 200, dòng rơi vào máy 17118); body quyết định `deviceId` (`api/v1/router.ts:149-165`) | danh sách thiết bị được phép theo khoá/gateway — presence/OEE hiện giả mạo được |
| `/api/v1/ingest/telemetry` (đường doc 61 hướng dẫn) | **M2** | **Đo: sau 300 request toàn bộ trả 429** (47.952/48.252) — dùng chung limiter 300/phút của trình duyệt; `api/v1/auth.ts:147-162` nhận khoá dùng chung plaintext bất kể `MACHINE_SHARED_KEY_ALLOWED` | chuyển sang tầng rate-limit OT; tuân chính sách khoá dùng chung |
| `/api/v1/ingest/process-result` | **M3** (pilot doc 56) | cờ `PROCESS_RESULT_INGEST_ENABLED` **vắng** ⇒ đang tắt; mọi lỗi (kể cả DB sập, 429) gộp thành **400** (`router.ts:406-410`) ⇒ SDK coi 4xx là vĩnh viễn và **vứt bản ghi** | phân biệt 503/429 với 400 |
| Khoá `mk_` | **M3** | băm sha256; kiểm hết hạn có nhưng TTL mặc định **vô hạn**; `MACHINE_CRED_MK_ONLY_ENABLED` chưa đặt ⇒ cột plaintext `machines.apiKey` vẫn dùng được | TTL, xoay khoá, bỏ plaintext |
| Broker MQTT (aedes) | **M2** | 32.360 msg/s QoS1 loopback p99 35 ms; **username lạ không mật khẩu được nhận** (tự đăng ký PENDING); 200 kết nối lạ trong 261 ms, mỗi cái INSERT `mqtt_clients`; publish chéo `avi/` bị chặn; thiết bị PENDING publish ngoài phạm vi chỉ WARN **mỗi message một dòng log — 730.200 dòng / 154 MB trong ~1 phút**; lưu trong RAM, **không TLS** (8883 là WebSocket plaintext); cầu MQTT → `ot_telemetry` TẮT | chặn admission, bắt mật khẩu, TLS 8884, giới hạn log; EMQX nếu cần HA |
| Hypertable & chính sách | **M3** | DB thật: `ot_telemetry` **69 GB / 234,8 triệu dòng**; chunk 17–24/9 chưa nén 54 GB; nén 17–22×; 18 job Timescale lần cuối Success nhưng lịch sử lỗi ~10–30 %; 2 index 0 lượt quét (~800 MB mỗi 2,5 ngày); không continuous aggregate; truy vấn 7 ngày thô >30 s | nén sau 1 ngày; bỏ index thừa; cagg 1 phút/1 giờ |
| Presence | **M3** | 1.699 thiết bị sim: 13.592 dòng/phút (226 dòng/s) | bị giả mạo theo dòng ràng buộc |
| Store-and-forward | server **M2** · SDK **M1** | WAL ghi lại toàn tệp, không fsync, không temp+rename (`storeForward.ts:171-184`); hàng đợi SDK không giới hạn, xoá tệp trước khi gửi lại | WAL nguyên tử; cách ly mẫu hỏng; hàng đợi SDK bền; **chưa có phép thử "kill DB" nào** |
| Idempotency | process M3 · telemetry M3− | UNIQUE `(deviceId, metric, ts)` + `ON CONFLICT`; `deviceId` NULL ⇒ không chống trùng | `NULLS NOT DISTINCT` hoặc khoá theo machineId |
| Thời gian | **M2** | **`w32tm`: "Leap Indicator 3 (not synchronized), Source: Local CMOS Clock"** trên chính máy chủ; còn 5 chỗ lệch −7 h (`db/machine.ts:119`, `oeeService.ts:786/1026/1555`, `warRoomService.ts:378`); telemetry không kiểm lệch/giờ tương lai | NTP/PTP; sửa 5 truy vấn; cổng kiểm lệch giờ |

### L4b — Realtime

| Thành phần | Mức | Bằng chứng | GAP |
|---|---|---|---|
| Handshake | **M2** | trình duyệt không cookie bị từ chối; socket `machine` bị từ chối `subscribe` (Đợt 0 PLT-01); **NHƯNG `machine:confirm_mapping` với `SOCKET_MACHINE_AUTH_MODE`=off (mặc định, vắng trong `.env`) cho 1.000 socket vô danh vào phòng `machine:17119`, nhận 100 % telemetry, và đánh dấu máy online** (`socket.ts:555-600`) | `SOCKET_MACHINE_AUTH_MODE=enforce` (Task 10 Đợt 1 chạm phần handshake) |
| ACL phòng cho trình duyệt | **M1–M2** | chỉ `twin:` và `engineering:` kiểm quyền/phạm vi; `factory:`, `machine:`, `line:`, `robot:`, `telemetry:all` ai đăng nhập cũng vào (`socket.ts:249-376`) | kiểm quyền + phạm vi nhà máy khi join |
| Fan-out | **M3** | 20 client p99 39 ms; 200 → 112 ms; **1.000 client p50 35 / p99 95 ms, 88,5k lượt giao/s, 100 % nhận đủ** | mới loopback |
| Backpressure | **M1** | **bão 1.000 `confirm_mapping` vô danh ⇒ 1.000 INSERT, pool DB 25 bão hoà, một request ingest treo 18,3 s** | giới hạn tần suất sự kiện socket; xác thực trước khi ghi DB; tách pool ingest |
| Redis adapter / HA | **M2** | `@socket.io/redis-adapter` tự gắn khi có `REDIS_URL`; chưa từng chạy 2 node; `WORKER_LEADER_ELECTION_ENABLED=false` | diễn tập 2 node |

### L5 — Runtime

| Thành phần | Mức | Bằng chứng | GAP |
|---|---|---|---|
| FOE | M2 (M3 dry-run) | ORC-01 đã sửa (`foeEngine.ts:1638-1666`), resume CAS; `FOE_DURABLE` tắt; `rehydrateInterruptedRuns` chạy ở **mọi** lần boot kể cả `ROLE=api`, không leader (`index.ts:5985`); resume chạy theo `definitionJson` hiện tại chứ không theo snapshot đã deploy | lease cho run (owner/heartbeat/fencing) — 2 node ⇒ 2 driver cho một run |
| Command dispatch | M2 | ledger ghi **sau** khi ghi thiết bị (at-least-once); Sparkplug NCMD dispatch `hitl` không actionId ⇒ **bỏ qua xác nhận người** (`sparkplugCommand.ts:298-306`); `command_log` = 0 trong khi `OT_CONTROL_ENABLED=true` | ledger write-ahead; bắt buộc actionId |
| Fleet VDA 5050 | M2 | topic `uagv/v2` thật; "done" = đã publish; không last-will; `abort()` rỗng; 0 AMR | đối soát trạng thái AGV |
| Safety | M1–M2 | PLC backend SIM; e-stop Pilz/Sick là khung; preflight `UNKNOWN` **cho ghi** | mạch an toàn cứng có chứng nhận; chặn khi `UNKNOWN` |
| Interlock | M2 | fail-closed khi DB lỗi nhưng **thiếu dữ liệu thì cho qua** (`ruleEvaluator.ts:15`); engine poll 10 s, không leader | max-age mỗi rule; engine chỉ trên leader |
| Alarm → Andon | M2 | `andon_events` 0 dòng trong 7 ngày; CLEAR bị bỏ; không chống chattering; thông báo gửi đồng bộ | máy trạng thái ISA-18.2; outbox |

### L7 — Nền tảng

| Thành phần | Mức | Bằng chứng | GAP |
|---|---|---|---|
| Topology | M2 | một tiến trình all-in-one trên Windows (PID 15544), build `053a51aad` (`sach=false`, HEAD đã tiến); RSS 5,5 GB; có Dockerfile/compose/Helm (`values-site-ha.yaml`) chưa chạy thật; Helm không mở cổng MQTT, mỗi replica một aedes; edge gateway vẫn cần `DATABASE_URL` trung tâm | chọn mô hình triển khai; tách api/worker; EMQX |
| Cờ cấu hình | M1–M2 | 984 biến env trong mã, 224 `*_ENABLED`; `.env` 271 khoá, 1 trùng, 366 biến không tài liệu; `.env` đặt `NODE_ENV=development` | cấu hình có schema, hồ sơ theo edition |
| DB | M2 | Postgres 17 một container; `shared_buffers` **128 MB** trên máy 31 GB; `max_connections` 100; `archive_mode` off; 0 replica; không `pg_stat_statements`; **`backup_logs`=0, `scheduled_backups`=0, `dr_restore_checks`=0**; 4 migration thất bại (có 0125 RLS, 0234 index); migration không trong transaction | backup/PITR, tuning, diễn tập restore |
| Bảo mật | M1–M2 | HTTP + MQTT plaintext; **`/metrics` không xác thực** (437 KB, có cả RUM); `LICENSE_BYPASS=true`; secretBox suy khoá từ `JWT_SECRET`; RLS vô tác dụng | TLS, xoay khoá, xác thực metrics |
| Observability | M2 | 41 nhóm metric (runtime/HTTP/AI/RUM) nhưng **không** có metric ingest/MQTT/pool/WAL; **`/health` và `/readyz` chỉ kiểm `Boolean(getDb())` ⇒ báo OK cả khi DB sập** (`index.ts:444-451`, `healthProbes.ts:49-57`); log console thô không xoay vòng; không alerting | health `SELECT 1`; Alertmanager |
| License | M2 | bypass bật; `moduleGate` fail-open | — |
| Nâng cấp | M1–M2 | không down migration; version cố định 1.0.0; bundle NSSM 2026-04 | quy trình phát hành + rollback |

## 2. Năng lực một node

Giả định: phần cứng hiện tại (Postgres Docker 24 core, 31 GB); trong lúc đo DB đồng thời gánh sim 226 dòng/s của :3000 và truy vấn của agent khác ⇒ số là **cận dưới**, burst 15 s, chưa chạy bền.

| Tầng | Năng lực | Chỗ gãy |
|---|---|---|
| HTTP ingest | 700 req/s p99 50 ms; ~20k mẫu/s nếu lô ≥500 | lô ≥7k mất dữ liệu; đường v1 chỉ 5 req/s mỗi khoá/IP |
| Ghi DB | ~20k dòng/s burst | pool 25; chưa đo bền |
| **Lưu trữ (gãy đầu tiên)** | ~340 B/dòng thô (6 index); nén sau 7 ngày; ổ trống 805 GB | sim hiện tại ≈54 GB/tuần thô, giữ 365 ngày ~200–250 GB — ổn; **10k mẫu/s (vd 500 máy × 20 tag × 1 Hz) ≈ 290 GB/ngày thô ⇒ đầy ổ ~3 ngày** |
| Truy vấn dashboard | quét 7 ngày thô >30 s | cần cagg trước khi có hàng trăm máy |
| Socket | 1.000 client, 88k lượt giao/s, p99 95 ms | bão sự kiện vô danh nghẽn pool DB |
| MQTT | 32k msg/s thô | chưa có đường vào DB; log flood 154 MB/phút |

**Khuyến nghị hôm nay:** ~**1–2k mẫu/s chạy bền** (≈300–600 máy × 4–5 tag mỗi 1–2 s) qua gateway theo lô 100–1.000. Nén sau 1 ngày + bỏ 2 index thừa + cagg ⇒ ~5k mẫu/s.

## 3. Checklist nhà máy thật

| Hạng mục | Hiện trạng | Việc cần làm |
|---|---|---|
| Mạng / phân vùng | broker và HTTP bind `0.0.0.0`; CORS cho qua request không Origin | VLAN OT; firewall chỉ 443/8884; bind interface OT |
| TLS / chứng chỉ | HTTPS tắt; MQTT TLS tắt; mTLS permissive | bật HTTPS/MQTT TLS; CA nội bộ + gia hạn |
| Thông tin xác thực máy | `mk_` không TTL; plaintext cũ dùng được; MQTT nhận thiết bị lạ không mật khẩu | TTL + xoay; `MK_ONLY`; chặn admission; `SOCKET_MACHINE_AUTH_MODE=enforce` |
| Đồng bộ giờ | **server không đồng bộ (CMOS)**; 5 truy vấn lệch −7 h | NTP/PTP server + PLC; sửa truy vấn; kiểm lệch ở ingest |
| Store-and-forward | WAL yếu; SDK dễ mất; chưa thử DB sập | WAL nguyên tử; diễn tập DB sập / mất WAN |
| HA / failover | một node; điều khiển/FOE/interlock không leader; Postgres không replica | leader/lease; EMQX; replica |
| Backup / restore | **0 backup; 0 lần kiểm restore; không lưu WAL** | pgBackRest/PITR; diễn tập restore đo RTO/RPO |
| Giám sát / cảnh báo | metric runtime-only; health sai; không Alertmanager | metric ingest/MQTT/WAL/pool; cảnh báo DB/broker/đĩa/độ trễ |
| Log | console thô, không xoay, bị flood được | JSON + xoay + giới hạn |
| Nâng cấp | build cũ/bẩn; migration lỏng | pipeline có tag; migration nghiêm ngặt; rollback |

## 4. GAP ưu tiên

**P0 — trước khi nối thiết bị thật:** (1) hết mất dữ liệu im lặng (`accepted < received` ⇒ 503/207; lô quá lớn ⇒ 413 hoặc tự chia; `ts` sai ⇒ 400, không hỏng WAL); (2) ràng buộc khoá ↔ thiết bị (REST + MQTT `asset_id`); (3) socket `SOCKET_MACHINE_AUTH_MODE=enforce` + ACL phòng trình duyệt + giới hạn tần suất `machine:*`; (4) MQTT từ chối thiết bị lạ/thiếu mật khẩu + TLS + giới hạn log; (5) backup + PITR + **một lần diễn tập restore có biên bản**; (6) health thật + cảnh báo tối thiểu; (7) NTP; (8) vì `OT_CONTROL_ENABLED=true`: interlock chặn khi thiếu/cũ, safety chặn khi `UNKNOWN`, actionId bắt buộc, ledger write-ahead.
**P1:** đưa `/api/v1/ingest/telemetry` vào tầng rate-limit OT; lưu trữ (nén 1 ngày, bỏ index, cagg, tuning, `pg_stat_statements`); leader election + lease FOE + EMQX; sửa 5 truy vấn −7 h; 503≠400 ở process-result + hàng đợi SDK bền; xoay `mk_`, `SECRET_ENCRYPTION_KEY` riêng, xác thực `/metrics`; migration nghiêm ngặt; metric nền tảng + log JSON; build sạch có provenance.
**P2:** `FOE_DURABLE` + lease; VDA 5050 đối soát; alarm ISA-18.2; registry cờ có schema; RLS; license gate; Helm mở MQTT; edge gateway không phụ thuộc DB trung tâm.
**P3:** dọn `.env`; semver + changelog.

## 5. Chưa kiểm được
Diễn tập DB sập / store-and-forward (Postgres dùng chung, không được dừng); thiết bị thật (M4); TLS/mTLS (không chứng chỉ, không sửa `.env`); HA nhiều node + Redis adapter (Redis dùng chung sẽ phát sự kiện chéo sang :3000); socket bằng phiên trình duyệt thật trên `_test`; cầu MQTT → `ot_telemetry` và process-result (cờ tắt); soak test dài và mạng thật; FOE/interlock/VDA/safety chỉ đọc mã. Doc 80 ghi nén `ot_telemetry` sau 30 ngày theo migration — DB live cho thấy `compress_after` = 7 ngày (job 1023); lấy số DB.
