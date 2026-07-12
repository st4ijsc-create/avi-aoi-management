# Doc 45 — SYN-W0 Owner Runbook: hạ tầng nền + kích hoạt cờ (2026-07-12)

> **TRẠNG THÁI: HƯỚNG DẪN CHO OWNER — CHƯA AI CHẠY CÁC BƯỚC NÀY.**
> Code + migration + compose profile đã sẵn trong repo (batch W0, doc 44 §10 SYN-W0).
> Đây là phần W0 mà **code không tự làm được**: cần quyền superuser DB, restart
> service, quyết định thời điểm (giờ thấp điểm), và xác nhận bằng mắt người.
>
> Quyết định đã chốt (doc 44 §12 D2): **NATS JetStream trước — Kafka chỉ khi Site
> Edition cần scale.** Kiến trúc "gập được": mọi hạ tầng lớn dưới đây là **PROFILE
> TÙY CHỌN** — single-node mặc định (`docker compose up`) không đổi.
>
> Tham chiếu: doc 44 §10 (SYN-W0) · doc 41 §3 (migration + 2FA) · doc 38 (cờ P/Q/R)
> · `scripts/migrate-to-timescaledb.md` (cutover Timescale chi tiết).

**Quy ước chung:**
- DB thật hiện tại: `postgresql://aoi:<mật-khẩu>@127.0.0.1:5434/aoi_management`
  (dòng `DATABASE_URL` đầu tiên không-comment trong `.env`). Các lệnh `psql` dưới
  đây viết tắt là `psql "$DATABASE_URL"` — thay bằng connstring thật của bạn.
- Không có `psql` trên máy Windows? Dùng pgAdmin, hoặc
  `docker exec -it <container-pg> psql -U aoi -d aoi_management`.
- Mỗi mục: **Mục đích → Lệnh → Verify → Rollback**. Làm theo THỨ TỰ a → i
  (b phụ thuộc a về mặt hiệu quả; c nên làm sau khi a+b xong để smoke 1 lần).

---

## a. Cài TimescaleDB trên DB chính + re-apply 5 migration Timescale

**Mục đích.** Doc 27 quyết định #1: hypertable cho `product_inspections` /
`measurement_results` / `ot_telemetry`…; 0125/0234/0235 từng FAIL và 0172/0173
ghi `missing` vào `db_feature_status` vì server PG tại `127.0.0.1:5434` **chưa có
extension timescaledb** (memory doc "DB Schema Sync" 2026-07-10).

**Lệnh.**

*Trường hợp 1 — PG chạy trên Linux (apt/deb chuẩn):*
```bash
# 1. Thêm repo Timescale + cài đúng bản PG đang chạy (ví dụ PG17):
sudo apt install timescaledb-2-postgresql-17
# 2. timescaledb-tune tự thêm shared_preload_libraries='timescaledb' vào postgresql.conf:
sudo timescaledb-tune --quiet --yes
# 3. Gói apt/deb chuẩn thường restart service ngay trong bước cài/tune — KHÔNG bắt
#    buộc restart tay. NHƯNG nếu bước CREATE EXTENSION dưới báo
#    "timescaledb is not in shared_preload_libraries" thì restart:
sudo systemctl restart postgresql
# 4. CREATE EXTENSION — CẦN QUYỀN SUPERUSER (role `aoi` thường không đủ):
psql "postgresql://postgres:<pw-superuser>@127.0.0.1:5434/aoi_management" \
  -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"
```

*Trường hợp 2 — PG chạy native trên Windows (không có gói TimescaleDB tin cậy):*
Dùng **container timescaledb thay thế** rồi chuyển `DATABASE_URL`:
```powershell
# 1. Dựng container (image có SẴN timescaledb + pgvector), cổng 5435 để không đụng 5434:
docker run -d --name aoi-tsdb -p 5435:5432 -e POSTGRES_USER=aoi -e POSTGRES_PASSWORD=<pw> `
  -e POSTGRES_DB=aoi_management -v aoi_tsdb_data:/home/postgres/pgdata/data `
  timescale/timescaledb-ha:pg17
# 2. Dump DB cũ → restore vào container (làm GIỜ THẤP ĐIỂM; chi tiết + checklist
#    trong scripts/migrate-to-timescaledb.md):
pg_dump  "postgresql://aoi:<pw>@127.0.0.1:5434/aoi_management" -Fc -f aoi_management.dump
pg_restore -d "postgresql://aoi:<pw>@127.0.0.1:5435/aoi_management" --no-owner aoi_management.dump
# 3. Đổi .env:  DATABASE_URL=postgresql://aoi:<pw>@127.0.0.1:5435/aoi_management
#    rồi restart app. DB cũ 5434 GIỮ NGUYÊN (chính là rollback).
```

*Re-apply 5 migration Timescale (cả 2 trường hợp).* `migrate-standalone` chỉ chạy
file **chưa có row success=true** trong `__applied_migrations` — 0172/0173 đã
"thành công" (nhưng ghi `missing` vào `db_feature_status`) nên phải xoá row
tracking để ép chạy lại; 0125/0234/0235 từng fail (success=false) sẽ tự re-run,
xoá luôn cho chắc:
```bash
psql "$DATABASE_URL" -c "DELETE FROM __applied_migrations WHERE filename IN (
  '0125_tenant_rls_hot_tables.sql',
  '0172_inspection_hypertables.sql',
  '0173_retention_12mo.sql',
  '0234_perf_indexes.sql',
  '0235_hourly_yield_continuous_aggregate.sql');"
npm run db:push
```

⚠️ **Gotcha đã biết:**
- **0234** dùng `CREATE INDEX CONCURRENTLY` — không chạy được trong transaction.
  Nếu FAIL: chạy tay statement đó qua `psql` (ngoài transaction), hoặc dùng bản
  non-CONCURRENTLY đã comment sẵn trong file (khoá ghi ngắn, chạy giờ thấp điểm).
- **0235** INSERT vào cột `checked_at` trong khi bảng `db_feature_status` (0172)
  đặt tên `"checkedAt"`. Nếu FAIL với `column "checked_at" does not exist`, tạo
  cột shim tương thích rồi re-apply (vô hại, migration sau sẽ hợp nhất):
  ```sql
  ALTER TABLE db_feature_status ADD COLUMN IF NOT EXISTS checked_at timestamp DEFAULT now();
  ```
- 0172 convert bảng LỚN sang hypertable (`migrate_data => true` quét toàn bảng)
  — chạy **giờ thấp điểm, có backup trước** (mục g).

**Verify.**
```sql
SELECT extversion FROM pg_extension WHERE extname='timescaledb';   -- có row = OK
SELECT * FROM db_feature_status ORDER BY feature;
-- Kỳ vọng: timescaledb_hypertables='ok' · timescaledb_retention_12mo='ok'
--          · cagg_hourly_yield='ok'  (không còn 'missing')
SELECT hypertable_name FROM timescaledb_information.hypertables;
-- Kỳ vọng ≥6: product_inspections, measurement_results, ot_telemetry,
--             oee_metrics, machine_heartbeats, process_results
```

**Rollback.** Trường hợp 1: extension cài thêm không phá dữ liệu — không cần gỡ;
tệ nhất `DROP EXTENSION timescaledb` (chỉ khi CHƯA convert hypertable). Trường
hợp 2: đổi `DATABASE_URL` về `:5434` + restart app — DB cũ còn nguyên.

---

## b. Áp 5 migration mới 0246-0250

**Mục đích.** Batch W0 (doc 44): correlation-id + deadline trên command ledger
(0246, G1.7) · idempotency replay cho `ot_telemetry` (0247, G2.9) · persist
contract-schema registry (0248, G2.5) · runbook/recommendation ref trên alert
trung tâm (0249, G5.5) · `external_id`/`source_system` cho đối soát ERP (0250,
G5.6). Tất cả additive + idempotent.

**Lệnh.**
```bash
npm run db:push
```
⚠️ **0247 trên bảng lớn:** bước dedupe là self-join DELETE + tạo UNIQUE INDEX quét
toàn bảng `ot_telemetry` → **chạy giờ thấp điểm**. Trên hypertable có **chunk đã
nén** (compression 0172), DELETE/CREATE INDEX có thể fail → migration KHÔNG đánh
fail cả lượt mà ghi `'partial'` vào `db_feature_status`. Khi đó: decompress chunk
liên quan (hoặc để retention dọn), xoá row tracking rồi re-apply:
```sql
DELETE FROM __applied_migrations WHERE filename='0247_ot_telemetry_idempotency.sql';
```
Volume rất cao? Tạo index tay bằng `CREATE UNIQUE INDEX CONCURRENTLY` ngoài giờ
rồi re-apply (IF NOT EXISTS sẽ bỏ qua).

**Verify từng migration.**
```sql
-- 0246: 2 cột + index partial trên command_log
SELECT column_name FROM information_schema.columns
 WHERE table_name='command_log' AND column_name IN ('correlation_id','deadline_ms'); -- 2 row
SELECT indexname FROM pg_indexes WHERE indexname='idx_command_log_correlation';       -- 1 row

-- 0247: unique index + trạng thái feature
SELECT indexname FROM pg_indexes WHERE indexname='uq_ot_telemetry_device_metric_ts';  -- 1 row
SELECT status, detail FROM db_feature_status WHERE feature='ot_telemetry_idempotency';
-- Kỳ vọng 'ok'; nếu 'partial' → xem detail + gotcha ở trên

-- 0248: bảng registry
SELECT to_regclass('public.contract_schemas');                                        -- NOT NULL

-- 0249: 2 cột trên predictive_alerts
SELECT column_name FROM information_schema.columns
 WHERE table_name='predictive_alerts' AND column_name IN ('runbook_ref','recommendation_ref'); -- 2 row

-- 0250: 2 cột + unique partial index trên production_orders
SELECT column_name FROM information_schema.columns
 WHERE table_name='production_orders' AND column_name IN ('external_id','source_system'); -- 2 row
SELECT indexname FROM pg_indexes WHERE indexname='uq_po_external_source';             -- 1 row
```

**Rollback.** Tất cả additive (cột nullable / bảng mới / index) — không đổi hành
vi code cũ. Cần gỡ thật sự: `DROP INDEX ...; ALTER TABLE ... DROP COLUMN ...;`
(chỉ làm nếu có sự cố cụ thể, bình thường KHÔNG cần).

---

## c. Cutover DATABASE_URL sang role `avi_app` (WORM enforced — mig 0224)

**Mục đích.** App đang nối DB bằng role owner/superuser → **bypass RLS**, nghĩa là
append-only trên `audit_logs`/`control_audit_log` chỉ là "advisory". Mig 0224 đã
tạo role `avi_app` NOLOGIN least-privilege + FORCE RLS. Cutover làm WORM **thật**.

**Lệnh.**
```sql
-- 1. Kiểm tra role + grant có sẵn (0224 đã áp):
SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname='avi_app';
SELECT has_table_privilege('avi_app','users','SELECT'),          -- true
       has_table_privilege('avi_app','audit_logs','UPDATE'),     -- FALSE (WORM)
       has_table_privilege('avi_app','contract_schemas','INSERT'); -- true (bảng mới 0248
                                                                    -- hưởng default privileges)
-- Nếu bảng MỚI nào trả false (migration chạy bằng role khác role đã chạy 0224):
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO avi_app;
--   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO avi_app;
--   REVOKE UPDATE, DELETE ON audit_logs, control_audit_log FROM avi_app;

-- 2. Cấp login + mật khẩu (GIỮ NGOÀI git):
ALTER ROLE avi_app WITH LOGIN PASSWORD '<mật-khẩu-mạnh>';
```
```bash
# 3. Đổi .env:  DATABASE_URL=postgresql://avi_app:<mật-khẩu>@127.0.0.1:5434/aoi_management
# 4. Restart app + smoke.
```

**Verify.**
- App boot sạch; login, CRUD thường (tạo/sửa 1 bản ghi master-data), ingest
  inspection chạy.
- WORM thật:
  ```sql
  -- nối bằng avi_app:
  UPDATE audit_logs SET action='x' WHERE id=(SELECT id FROM audit_logs LIMIT 1);  -- 0 row / denied
  DELETE FROM control_audit_log;                                                  -- 0 row / denied
  ```
- Migration về sau: chạy `npm run db:push` bằng connstring role **owner** (aoi)
  chứ KHÔNG bằng avi_app (avi_app không có quyền DDL — đúng thiết kế).

**Rollback.** Đổi `DATABASE_URL` về connstring cũ + restart. (Muốn khoá hẳn:
`ALTER ROLE avi_app NOLOGIN;`.)

---

## d. Bật cờ theo canary (thứ tự + điều kiện + verify từng cờ)

**Mục đích.** Code các đường này đã xây và test (doc 37/38/40/41), cờ mặc định
OFF. Bật TUẦN TỰ — mỗi cờ: sửa `.env` → restart app → verify → mới sang cờ kế.
Trạng thái `.env` hiện tại (2026-07-12): `TENANT_RLS_ENABLED`, `METRICS_ENABLED`,
`UNS_BRIDGE_ENABLED`, `UNS_SPARKPLUG_ENABLED`, `OT_STORE_FORWARD_ENABLED` **đã
true**; số còn lại chưa đặt (mặc định off).

| # | Cờ | Điều kiện trước | Verify | Rollback |
|---|----|-----------------|--------|----------|
| 1 | `OBSERVABILITY=true` | không | `curl localhost:3000/health` OK; `curl localhost:3000/api/observability/health` trả JSON store-forward/supervisor; log có SLO evaluator; trang `/control-readiness` hiện cờ xanh | set `false` + restart |
| 2 | `METRICS_ENABLED=true` *(đã true)* | package `prom-client` có trong node_modules (nếu thiếu, log in "bỏ qua Prometheus metrics" — cài khi được phép) | `curl localhost:3000/metrics` có metric tiền tố `avi_aoi_`; Prometheus (monitoring/) scrape xanh | set `false` |
| 3 | `UNS_BRIDGE_ENABLED` / `UNS_SPARKPLUG_ENABLED` *(đã true)* — **xác nhận broker** | container `emqx` chạy (`docker compose ps emqx` healthy) và `UNS_BROKER_URL=mqtt://localhost:1884` đúng cổng | Dashboard EMQX `http://localhost:18083` → Clients thấy app nối; topic UNS có message | tắt 2 cờ |
| 4 | `TELEMETRY_BATCH_ENABLED=true` | ingest đang chạy ổn định (quan sát 1 ngày sau cờ 3) | log báo batch/coalesce; `SELECT count(*) FROM ot_telemetry WHERE ts > now()-interval '5 min'` vẫn tăng; latency ingest không xấu đi | set `false` (đường ghi cũ trở lại NGAY) |
| 5 | `OT_STORE_FORWARD_ENABLED` *(đã true)* | — | rút mạng broker 1 phút → `/api/observability/health` thấy buffer tăng rồi drain về 0 khi nối lại | set `false` |
| 6 | `REPORTING_MART_ENABLED=true` | DB khoẻ sau a+b | sau ≥1 giờ: `SELECT count(*) FROM fact_inspection_hourly;` > 0 và tăng theo giờ | set `false` |
| 7 | `ACTUATION_STEPUP_2FA=true` | ⚠️ **BẬT 2FA CHO MỌI ACCOUNT PRIVILEGED (admin/supervisor/engineer) TRƯỚC — nếu không sẽ TỰ KHOÁ đường deploy/actuation** (doc 41 §3.1; user test `engineer1`/`supervisor1` đã bật 2FA, OTP: `node scripts/print-otp.mjs engineer1`) | deploy workflow / lệnh actuation đòi OTP TƯƠI; account chưa 2FA bị chặn kèm hướng dẫn | set `false` (mở khoá ngay) |
| 8 | `TENANT_RLS_ENABLED` *(đã true)* | sau mục a, re-apply 0125 thành công | `SELECT count(*) FROM pg_policies WHERE policyname LIKE '%tenant%';` > 0; smoke đọc/ghi bình thường | set `false` |
| 9 | `CONTRACT_REGISTRY_PERSIST_ENABLED=true` | 0248 đã áp (mục b) | `SELECT count(*) FROM contract_schemas;` — seed/persist tăng khi registry đăng ký schema; log không lỗi | set `false` (registry về in-memory) |
| 10 | `CFX_ENABLED` / `UNS_CMD_ACK_ENABLED` | **CHỈ khi có endpoint thật** (máy nói CFX / consumer cmd_ack) | CFX: log kết nối AMQP; cmd_ack: topic `syn/<enterprise>/cmd_ack/adapter/<id>` có message khi phát lệnh | tắt cờ |

---

## e. Khởi động NATS JetStream (profile `bus`)

**Mục đích.** Chuẩn bị G2.7 bước 1 (quyết định D2: NATS trước Kafka) — durable
log cho tầng streaming SYN-W4. App **chưa** có client NATS (wire ở W4); bước này
chỉ dựng + verify hạ tầng.

**Lệnh.**
```bash
docker compose --profile bus up -d nats
```

**Verify.**
```bash
curl http://localhost:8222/healthz     # → {"status":"ok"}
curl http://localhost:8222/jsz         # → JetStream config: "store_dir":"/data", streams: 0
docker compose ps nats                 # healthy
```

**Rollback.**
```bash
docker compose --profile bus stop nats   # dừng — volume natsdata giữ nguyên
# gỡ hẳn: docker compose --profile bus rm -sf nats (volume vẫn còn, xoá riêng nếu muốn)
```

---

## f. Dựng EMQX HA cluster 3 node + test failover (khi sẵn sàng)

**Mục đích.** G2.4 — broker UNS hết single-point-of-failure. File riêng
`deploy/compose/docker-compose.uns-ha.yml` (không phá compose chính).
⚠️ **License:** EMQX ≥5.9 là BSL 1.1 (cluster production trả phí) — file đã pin
`emqx/emqx:5.8` (Apache-2.0). Nâng version = quyết định license riêng.

**Lệnh.**
```bash
# 0. Cùng máy với compose chính? Dừng emqx đơn trước (đụng cổng 1884/18083):
docker compose stop emqx
# 1. Sinh cookie cluster (SECRET — thêm vào .env, KHÔNG commit):
#    EMQX_CLUSTER_COOKIE=<openssl rand -hex 32>
# 2. Dựng 3 node:
docker compose -f deploy/compose/docker-compose.uns-ha.yml up -d
# 3. (khuyến nghị) kèm HAProxy LB:
docker compose -f deploy/compose/docker-compose.uns-ha.yml --profile lb up -d
```

**Verify.**
```bash
docker compose -f deploy/compose/docker-compose.uns-ha.yml exec emqx1 emqx ctl cluster status
# Kỳ vọng: Cluster status: running nodes 3 (node1/node2/node3.emqx.local)

# Test failover: hạ node1, client vẫn pub/sub qua node2 (1884) hoặc LB (1890):
docker compose -f deploy/compose/docker-compose.uns-ha.yml stop emqx1
mosquitto_sub -h localhost -p 1884 -t 'test/#' &      # (hoặc -p 1890 qua LB)
mosquitto_pub -h localhost -p 1885 -t test/failover -m ok   # sub nhận được "ok"
docker compose -f deploy/compose/docker-compose.uns-ha.yml start emqx1
# HAProxy stats: http://localhost:8404/stats — emqx1 DOWN→UP đúng nhịp
```

**Chuyển app qua LB.** `.env`: `UNS_BROKER_URL=mqtt://localhost:1890` (qua
HAProxy) → restart app → dashboard `http://localhost:18083` thấy client app.
Production: LB (HAProxy+keepalived VIP hoặc LB hạ tầng) độc chiếm 1883, node
không expose host-port, `UNS_BROKER_URL=mqtt://<vip>:1883`.

**Rollback.** `UNS_BROKER_URL` về `mqtt://localhost:1884` + `docker compose start
emqx` (broker đơn cũ) + restart app; hạ cluster bằng
`docker compose -f deploy/compose/docker-compose.uns-ha.yml down` (volume giữ).

---

## g. PG streaming replica + backup/restore

**Mục đích.** G2.19 — tách read analytics khỏi primary (seam `getReadDb()` đã có,
doc 38 T-3) + backup có kiểm chứng (ISO 22301).

**Lệnh — replica (tóm tắt, làm trên 2 máy/2 instance):**
```bash
# PRIMARY (postgresql.conf):  wal_level = replica · max_wal_senders = 5
# pg_hba.conf:                host replication replicator <ip-standby>/32 scram-sha-256
psql "$DATABASE_URL_SUPERUSER" -c "CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '<pw>';"
# restart primary nếu đổi wal_level

# STANDBY (data dir RỖNG):
pg_basebackup -h <ip-primary> -p 5434 -U replicator -D /var/lib/postgresql/standby -R -X stream
# -R tự sinh standby.signal + primary_conninfo → start postgres trên standby
```

**Verify replica + seam app.**
```sql
-- trên STANDBY:  SELECT pg_is_in_recovery();            -- true
-- trên PRIMARY:  SELECT client_addr, state, replay_lag FROM pg_stat_replication;  -- 1 row, streaming
```
```bash
# Đấu app vào replica (CHỈ đường đọc analytics; env do server/db/connection.ts đọc):
# .env:  DATABASE_READ_URL=postgresql://avi_app:<pw>@<ip-standby>:5432/aoi_management
#        (tùy chọn) DB_POOL_MAX_READ=15
# Restart → log app:  "[Database] Read-replica pool ready (max 15)"
# Honest-degrade: không đặt DATABASE_READ_URL / replica chết → tự về primary, không hỏng gì.
```
⚠️ Replica trễ ms–giây (eventual consistency) — code chỉ route dashboard/report
qua seam này, KHÔNG route đường ghi (đã đúng sẵn, không phải cấu hình gì thêm).

**Lệnh — backup định kỳ (backupService + backupSchedulerService đã có sẵn):**
- Vào UI **Data Settings → Backup** tạo lịch (bảng `scheduled_backups`, node-cron
  chạy `pg_dump`, ghi `backup_logs`, tự xoá bản cũ theo `retentionCount`).
- Offsite (khuyến nghị bật ≥1): `.env` `AWS_S3_BACKUP_BUCKET=...` +
  `AWS_S3_BACKUP_PREFIX=...` hoặc `OFFSITE_BACKUP_DIR=<ổ/mount khác máy>`.
- Máy app cần `pg_dump` trong PATH (thiếu → service fallback JSON-lines, vẫn chạy
  nhưng kém hơn — cài postgresql-client).

**Verify — TEST RESTORE BẮT BUỘC (backup chưa restore thử = chưa có backup):**
```bash
createdb -h 127.0.0.1 -p 5434 -U <owner> aoi_restore_test
gunzip -c uploads/backups/<bản-mới-nhất>.sql.gz | psql "postgresql://<owner>:<pw>@127.0.0.1:5434/aoi_restore_test"
psql .../aoi_restore_test -c "SELECT count(*) FROM users;"                # khớp DB thật
psql .../aoi_restore_test -c "SELECT max(\"inspectionTime\") FROM product_inspections;"  # dữ liệu mới
dropdb -h 127.0.0.1 -p 5434 -U <owner> aoi_restore_test
```

**Rollback.** Replica: bỏ `DATABASE_READ_URL` + restart (mọi read về primary).
Backup: tắt lịch trong UI.

---

## h. OpenBao (thay Vault) — CHUẨN BỊ, wire ở SYN-W6

**Mục đích.** G5.23 bước 1 — dựng secret manager để W6 di trú secrets (.env →
OpenBao) + rotation. Bước này CHỈ dựng + init + policy tối thiểu; **app chưa đọc
OpenBao** (chưa wire — đừng xoá gì khỏi `.env`).

**Lệnh.**
```bash
# 1. Dựng (file storage, TLS tắt cho nội bộ — production đặt sau reverse-proxy TLS):
docker run -d --name openbao --cap-add=IPC_LOCK -p 8200:8200 \
  -v openbao-data:/openbao/file \
  -e 'BAO_LOCAL_CONFIG={"storage":{"file":{"path":"/openbao/file"}},
      "listener":[{"tcp":{"address":"0.0.0.0:8200","tls_disable":true}}],"ui":true}' \
  openbao/openbao:2 server

# 2. Init (IN RA 5 unseal key + root token — cất OFFLINE, mất là mất hết):
docker exec -e BAO_ADDR=http://127.0.0.1:8200 openbao bao operator init
# 3. Unseal (3/5 key, lặp 3 lần):
docker exec -e BAO_ADDR=http://127.0.0.1:8200 openbao bao operator unseal <key-i>
# 4. KV v2 + secret đầu tiên + policy tối thiểu cho app:
docker exec -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN=<root-token> openbao \
  bao secrets enable -path=secret kv-v2
docker exec ... bao kv put secret/avi-aoi/prod JWT_SECRET=<...> SIGNOFF_SECRET=<...>
# policy chỉ-đọc đúng path app:
#   path "secret/data/avi-aoi/*" { capabilities = ["read"] }
docker exec ... bao policy write avi-app-read - <<'EOF'
path "secret/data/avi-aoi/*" { capabilities = ["read"] }
EOF
docker exec ... bao token create -policy=avi-app-read -period=768h   # token cho app (W6)
```

**Verify.** `curl http://localhost:8200/v1/sys/health` → `"sealed":false,
"initialized":true`; `bao kv get secret/avi-aoi/prod` đọc lại được; UI
`http://localhost:8200/ui` đăng nhập bằng token.

**Kế hoạch di trú (W6 — chưa làm):** JWT_SECRET/SIGNOFF_SECRET/MASTER_API_KEY/
SMTP/HiveMQ/EMQX_CLUSTER_COOKIE → `secret/avi-aoi/prod`; app đọc qua env-injector
hoặc bao-agent template; rotation theo lịch. Đến lúc đó `.env` chỉ còn con trỏ
(BAO_ADDR + token file).

**Rollback.** `docker stop openbao` — không ảnh hưởng app (chưa wire).

---

## i. Checklist tổng verify cuối W0

| Hạng mục | Lệnh verify | Kỳ vọng |
|---|---|---|
| Timescale active | `psql -c "SELECT feature,status FROM db_feature_status"` | `timescaledb_hypertables`, `timescaledb_retention_12mo`, `cagg_hourly_yield` = **ok** |
| Hypertables | `SELECT count(*) FROM timescaledb_information.hypertables` | ≥ 6 |
| Migration 0246-0250 | 5 khối SQL ở mục b | đủ cột/bảng/index; `ot_telemetry_idempotency`='ok' |
| WORM enforced | `UPDATE audit_logs ...` bằng avi_app | denied / 0 row |
| App chạy bằng avi_app | log boot + `SELECT current_user` qua app | `avi_app` |
| SLO evaluator | `curl localhost:3000/api/observability/health` | JSON trạng thái, không 404 |
| Metrics | `curl localhost:3000/metrics \| grep avi_aoi_` | có metric |
| Cờ readiness | mở `/control-readiness` | các cờ đã bật hiện xanh, không cờ "ma" |
| NATS | `curl localhost:8222/healthz` | `{"status":"ok"}` |
| EMQX cluster | `emqx ctl cluster status` trên emqx1 | running nodes = 3 |
| Failover broker | stop emqx1 → pub/sub qua 1884/1890 | message vẫn thông |
| App → broker qua LB | dashboard 18083 → Clients | client app hiện diện sau khi đổi `UNS_BROKER_URL` |
| Replica | `SELECT state FROM pg_stat_replication` (primary) | `streaming`; log app "Read-replica pool ready" |
| Backup + restore | mục g test restore | count khớp, có dữ liệu mới nhất |
| OpenBao | `curl :8200/v1/sys/health` | `initialized:true, sealed:false` |
| Single-node không đổi | `docker compose config --services` | KHÔNG có `nats` (chỉ hiện khi `--profile bus`) |

**Biến env liên quan (thêm vào `.env` khi đến bước tương ứng — `.env.example` sẽ
được cập nhật ở batch code kế):**
```
EMQX_CLUSTER_COOKIE=          # mục f — secret, openssl rand -hex 32, GIỐNG NHAU cả 3 node
DATABASE_READ_URL=            # mục g — connstring replica (seam getReadDb; bỏ trống = dùng primary)
DB_POOL_MAX_READ=15           # mục g — tùy chọn, pool đọc
NATS_URL=nats://localhost:4222  # mục e — CHƯA được app đọc (client NATS wire ở SYN-W4)
```

---

## ADDENDUM (2026-07-12, sau khi thực thi W2 + W3) — migration & cờ mới

**Migration mới cần áp (`npm run db:push`) — TẤT CẢ idempotent:**

| Mig | Nội dung | Đợt |
|---|---|---|
| 0251 | machines.urn + isa95_path + backfill; lifecycle registered/faulted | W2-A |
| 0252 | config_snapshots (config-drift) | W2-A |
| 0253 | device_tags.deadband + sampling_ms | W2-A |
| 0254 | contract_quarantine | W2-B |
| 0255 | genealogy_chain.correlation_id (NGOÀI hash — verifyChain không đổi) | W2-B |
| 0256 | policy_definitions + policy_decision_log (append-only) | W3-A |
| 0257 | line_states + line_state_transitions | W3-A |
| 0258 | production_orders.lifecycle_state + order_state_transitions | W3-A |
| 0259 | recipe_sets + recipe_set_items + line_state_transitions.metadata | W3-B |

**Cờ mới (mặc định OFF — bật theo thứ tự canary khuyến nghị, mô tả đầy đủ trong `.env.example`):**

1. Sau khi áp mig xong, an toàn bật ngay (read-side/observe): `STATE_STORE_ENABLED`,
   `CONTRACT_REGISTRY_PERSIST_ENABLED`, `CONFIG_DRIFT_ENABLED`, `LINE_CONTROLLER_ENABLED`
   (chỉ sweep quan sát), `CONTRACT_VALIDATE_INGEST_MODE=log`.
2. Khi UNS broker sẵn: `UNS_TOPIC_V2_ENABLED`, `UNS_AGGREGATES_ENABLED`,
   `UNS_CMD_ACK_ENABLED`, `WS_UNS_STREAM_ENABLED`.
3. Nghiệp vụ (thử trên line pilot/Full-Sim trước): `ORDER_LIFECYCLE_ENABLED`,
   `QT_TEMPLATES_ENABLED` (+FOE_ENABLED), `MATERIAL_REPLENISH_ENABLED`,
   `OT_TAG_DEADBAND_ENABLED`, `OT_CMD_SERIALIZE_ENABLED`.
4. Siết quyền (SAU khi 2FA privileged sẵn — xem doc 41): `SEC_PLATFORM=true` →
   `POLICY_STORE_ENABLED` → thêm dần nhóm vào `POLICY_DEFAULT_DENY_ACTIONS`
   (vd `ot.command.*` trước, quan sát decision-log, rồi `robot.command.*`,
   `foe.command.*`, `fleet.vda5050.*`). Fail-safe: action trong nhóm mà evaluator
   lỗi → DENY (không fail-open).
5. Cuối: `CONTRACT_VALIDATE_INGEST_MODE=quarantine` (sau khi mode=log sạch ≥1 tuần),
   `LINE_CONTROLLER_AUTOHOLD_ENABLED` (sau khi quan sát blocking-alert chính xác).

**UI mới:** trang Line View tại `/line-view` (app Giám sát máy trong launcher).
**REST mới (scoped API key):** /v1/assets · /v1/state|query/timeseries|events|metrics|genealogy · /v1/policy/* · /v1/lines/* · /v1/orders/* (xem /api/v1/openapi.json).

---

## ADDENDUM 2 (2026-07-12, sau W5-A Trí tuệ) — migration 0260-0262

| Mig | Nội dung | Đợt |
|---|---|---|
| 0260 | simulation_runs + twin_trust (twin fidelity loop) | W5-A1 |
| 0261 | parameter_guardrails + parameter_change_log (guardrail per-param + closed-loop) | W5-A2 |
| 0262 | model_versions.stage/stage_history/owner/trained_on (MLOps stage pipeline) | W5-A4 |

**Cờ mới W5-A (mặc định OFF, bật sau khi áp mig + có dữ liệu tích lũy):**
- `TWIN_FIDELITY_ENABLED` — chỉ có ý nghĩa khi line_balance_metrics có dữ liệu thật (DES so với thực tế).
- `PARAM_GUARDRAIL_ENABLED` + `PARAM_VERIFY_ENABLED` — cần kỹ sư nhập dải min/max per-parameter trước (bảng parameter_guardrails, qua tRPC parameterGuardrail.set).
- `ADVICE_CONTRACT_ENABLED` — cưỡng chế requires[] tại confirm; chỉ chặn thực khi POLICY_DEFAULT_DENY_ACTIONS khớp `ai.recommendation.execute`.
- `FEATURE_STORE_ENABLED` + `MODEL_STAGE_PIPELINE_ENABLED` — MLOps; cần bảng g3 (ml_feature_cache) trong DB.

**REST mới:** /v1/predict/{task} · /v1/recommend · /v1/recommendations (scope advice:read) · /v1/models nay có stage thật. **tRPC mới:** parameterGuardrail · twinGov.twinTrusted/runFidelityCheck · aiModel.listStages/promoteStage.
