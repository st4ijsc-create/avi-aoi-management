# Runbook — Chuyển DB chính sang TimescaleDB (doc 27 §11 quyết định #1)

**Mục tiêu:** DB chính phải chạy trên server PostgreSQL có extension `timescaledb`
(và `vector`) để migration `0172_inspection_hypertables.sql` chuyển
`product_inspections`, `measurement_results` + 4 bảng telemetry thành hypertable,
và `0173_retention_12mo.sql` gắn retention 12 tháng (quyết định #2).

Image chuẩn: **`timescale/timescaledb-ha:pg17`** — có sẵn CẢ `timescaledb` LẪN
`pgvector` (thỏa đồng thời 0121 RAG/HNSW và 0172 hypertables).

**Trạng thái hiện tại cần biết:**

| Môi trường | Server | timescaledb? | Ghi chú |
|---|---|---|---|
| Dev (Windows) | PG 17.6 native (localhost:5433/avi_aoi_db) | ❌ không có (`pg_available_extensions` rỗng) | 0172/0173 chạy nhánh WARNING; startup banner báo lỗi; app-level retention là đường prune đang hoạt động |
| Docker prod (cũ) | `pgvector/pgvector:pg16` (volume `pgdata`) | ❌ | Cần dump/restore theo runbook này |
| Docker prod (mới) | `timescale/timescaledb-ha:pg17` (volume `pgdata_ts`) | ✅ | compose đã đổi image; 0172/0173 tự chuyển đổi khi service `migrate` chạy |

> TimescaleDB **không có bản Windows chính thức cho PG17** — dev muốn đủ decision #1
> thì chạy DB qua Docker (mục C) thay vì PG native.

---

## A. Docker prod — dump PG16 cũ → restore vào timescaledb-ha:pg17

Downtime dự kiến: theo kích thước DB (dump+restore). Làm ngoài giờ sản xuất.

```bash
# 0) Backup bắt buộc trước khi làm gì khác
docker compose exec postgres pg_dumpall -U ${POSTGRES_USER:-aoi} > backup_all_$(date +%Y%m%d).sql

# 1) Dừng app (giữ postgres cũ chạy để dump)
docker compose stop app

# 2) Dump DB chính (custom format, nén)
docker compose exec postgres pg_dump -U ${POSTGRES_USER:-aoi} -d ${POSTGRES_DB:-aoi_management} \
  -Fc -f /tmp/aoi.dump
docker compose cp postgres:/tmp/aoi.dump ./aoi.dump

# 3) Dừng postgres cũ; kéo compose mới (image timescale/timescaledb-ha:pg17,
#    volume mới pgdata_ts — volume pgdata cũ GIỮ NGUYÊN làm phao cứu hộ)
docker compose stop postgres
git pull   # lấy docker-compose.yml đã đổi image
docker compose up -d postgres          # init volume mới + deploy/postgres-init (vector + timescaledb)

# 4) Restore. --no-owner vì role có thể khác; -j4 cho nhanh.
docker compose cp ./aoi.dump postgres:/tmp/aoi.dump
docker compose exec postgres pg_restore -U ${POSTGRES_USER:-aoi} -d ${POSTGRES_DB:-aoi_management} \
  --no-owner --no-privileges -j4 /tmp/aoi.dump

# 5) Chạy migration (0172 chuyển hypertable + migrate_data, 0173 gắn retention 365d)
docker compose up migrate              # hoặc: node scripts/migrate-standalone.mjs

# 6) Xác minh (mục D) rồi khởi động lại app
docker compose up -d app
```

Rollback: `docker compose stop postgres` → đổi lại image/volume cũ trong compose →
`docker compose up -d`. Volume `pgdata` chưa bị đụng tới.

## B. Dev/prod PG native (không Docker) → chuyển vào container

```bash
pg_dump "postgresql://<user>:<pass>@localhost:5433/avi_aoi_db" -Fc -f aoi_dev.dump
docker compose up -d postgres
docker compose cp ./aoi_dev.dump postgres:/tmp/aoi_dev.dump
docker compose exec postgres createdb -U ${POSTGRES_USER:-aoi} avi_aoi_db
docker compose exec postgres pg_restore -U ${POSTGRES_USER:-aoi} -d avi_aoi_db \
  --no-owner --no-privileges -j4 /tmp/aoi_dev.dump
# .env: trỏ DATABASE_URL sang container (port 5432), rồi:
node scripts/migrate-standalone.mjs
```

## C. Dev chỉ cần một DB Timescale nhanh (không giữ dữ liệu cũ)

```bash
docker run -d --name aoi-tsdb -p 5434:5432 -e POSTGRES_PASSWORD=dev timescale/timescaledb-ha:pg17
# .env: DATABASE_URL=postgresql://postgres:dev@localhost:5434/postgres
node scripts/migrate-standalone.mjs      # provision toàn bộ schema + 0172/0173
```

## D. Xác minh sau chuyển đổi

```sql
-- 1) Extension
SELECT extname, extversion FROM pg_extension WHERE extname IN ('timescaledb','vector');

-- 2) 6 hypertable phải có mặt
SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables
WHERE hypertable_name IN ('product_inspections','measurement_results',
  'ot_telemetry','oee_metrics','machine_heartbeats','process_results');

-- 3) Retention 365d (policy_retention job trên từng bảng)
SELECT hypertable_name, config FROM timescaledb_information.jobs
WHERE proc_name = 'policy_retention';

-- 4) Trạng thái ghi bởi 0172/0173
SELECT * FROM db_feature_status;

-- 5) Đếm dòng khớp trước/sau restore (so với số đếm chụp trước khi dump)
SELECT count(*) FROM product_inspections;
SELECT count(*) FROM measurement_results;
```

Ngoài ra khi app khởi động, `server/services/dbRequirementsCheck.ts` in
`[DbRequirements] OK — TimescaleDB ...` (thay vì banner lỗi) là đạt.

Lưu ý sau khi 0173 áp dụng: `dataRetentionService` tự SKIP các bảng đã có native
retention policy (đọc `timescaledb_information.jobs` lúc chạy) — không cần chỉnh env,
không double-delete.

## E. Hệ quả schema cần biết (0172)

- PK của 6 bảng trở thành **composite** `(id, <cột thời gian>)` — Timescale yêu cầu
  cột partition nằm trong mọi unique index. `id` vẫn là serial duy nhất trên thực tế
  (app không tạo id trùng), query `WHERE id = ?` vẫn đúng nhưng quét mọi chunk nếu
  không kèm điều kiện thời gian — hot path hiện đã kèm (`idx_inspections_machine_time`…).
- KHÔNG bật compression cho `product_inspections`/`measurement_results` (operator còn
  UPDATE các dòng cũ khi verify/acknowledge); 4 bảng telemetry giữ compression như 0118.
- Container TimescaleDB phụ ở cổng 5433 (energy/ot_telemetry qua TSDB_URL) giữ nguyên
  vai trò cho đến khi hợp nhất (đúng quyết định #1).

## F. Continuous aggregate thay matview full-refresh (doc 38 Đợt S — P0-B)

**Vấn đề:** `hourly_yield_cache` (0111/0174) là matview PostgreSQL thường, `REFRESH ...
CONCURRENTLY` **quét TOÀN BỘ** `product_inspections` mỗi 5 phút — ở ~180M dòng/năm chi
phí cố định tăng tuyến tính, cạnh tranh I/O ingest. TimescaleDB continuous aggregate
refresh **tăng dần** (chỉ chunk đổi) → chi phí bám hoạt động gần đây, không theo kích thước bảng.

**Điều kiện:** chạy SAU khi 0172 đã biến `product_inspections` thành hypertable (mục A/D).
Migration `0235_hourly_yield_continuous_aggregate.sql` là **guarded** — thiếu extension/chưa-hypertable
thì no-op + ghi `db_feature_status('cagg_hourly_yield','missing')`; đủ điều kiện thì tạo
`hourly_yield_cagg` (WITH NO DATA) + policy refresh 1h/90 ngày. **KHÔNG drop matview cũ**
(giữ làm nguồn đọc tới khi validate).

```bash
# 1) Áp 0235 standalone (CREATE MATERIALIZED VIEW ... continuous KHÔNG chạy trong transaction)
psql "$DATABASE_URL" -f drizzle/0235_hourly_yield_continuous_aggregate.sql

# 2) Backfill lần đầu (CAgg tạo ra rỗng)
psql "$DATABASE_URL" -c "CALL refresh_continuous_aggregate('hourly_yield_cagg', NULL, NULL);"

# 3) Xác minh
psql "$DATABASE_URL" -c "SELECT view_name, materialization_hypertable_name FROM timescaledb_information.continuous_aggregates WHERE view_name='hourly_yield_cagg';"
psql "$DATABASE_URL" -c "SELECT * FROM db_feature_status WHERE feature='cagg_hourly_yield';"
```

**CẢNH BÁO timezone trước khi đổi read-path:** matview bucket theo **giờ factory-local**
(`to_factory_time()`), CAgg bucket theo **giờ UTC** (`time_bucket` trên cột naive-UTC). Với
factory không ở UTC, biên giờ lệch bằng offset. Trước khi trỏ dashboard sang `hourly_yield_cagg`:
so số 2 nguồn trên một cửa sổ, rồi chọn (a) re-bucket ở read-path, hoặc (b) đổi
`inspectionTime`→timestamptz + `time_bucket('1 hour', ts, 'Asia/Ho_Chi_Minh')`. Math yield y hệt 0174.

**Đổi read-path (follow-up code, chưa làm trong 0235):** `server/functions/cachedStatistics.ts`
đọc `hourly_yield_cache` → thêm nhánh đọc `hourly_yield_cagg` khi `db_feature_status.cagg_hourly_yield='ok'`,
fallback matview. Song song: cân nhắc dùng `fact_inspection_hourly` (reportingMart, đã incremental,
có `factoryId`) làm nguồn cho dashboard đa-cấp factory/workshop/line (doc 38 P0-E) — bật
`REPORTING_MART_ENABLED` để cron populate (hiện 0 dòng).

**Giải pháp tạm KHÔNG cần Timescale (nếu hoãn cutover):** thu hẹp matview `hourly_yield_cache`
về cửa sổ cuộn (vd `WHERE inspectionTime > now() - INTERVAL '90 days'`) để `REFRESH` chỉ quét
gần đây thay vì toàn bảng — đổi nghĩa (mất bucket >90 ngày, dashboard chủ yếu xem gần đây).
