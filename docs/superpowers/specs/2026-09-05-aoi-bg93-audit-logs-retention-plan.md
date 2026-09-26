# BG-93 — Kế hoạch retention cho `audit_logs` (chủ dự án ĐỒNG Ý lên plan, 2026-09-05)

**Trạng thái:** KẾ HOẠCH — chưa thực thi. Thực thi khi chuẩn bị môi trường thật (điều kiện ghi ở §5).

## 1. Vấn đề (số đo gốc, backlog BG-93)

`audit_logs` là bảng WORM (`avi_app` chỉ `INSERT`+`SELECT`, mig 0224) — **đúng chủ đích** — nhưng vì
thế **không tác vụ dọn nào chạy bằng vai ứng dụng được**, và không có job retention nào tồn tại.
Nhịp ước lượng khi chạy thật: ~5,7 MB/ngày ≈ **2 GB/năm** chỉ riêng tín hiệu đếm ingest. Ràng buộc
thiết kế đã chốt từ BG-93 gốc: **KHÔNG cấp `DELETE` cho `avi_app`** (mất WORM), **KHÔNG viết
`DELETE` từ mã ứng dụng**.

Số đo nền 2026-09-05 (`current_database()=aoi_management`, vai `avi_app`):
- TimescaleDB **2.28.2** đang hoạt động; 5 hypertable sẵn có: `ot_telemetry`, `product_inspections`,
  `measurement_results`, `machine_heartbeats`, `oee_metrics`.
- `audit_logs` hiện là bảng thường: **4.443 hàng / 3.464 kB** (dev).

## 2. Thiết kế chọn: hypertable + retention policy của TimescaleDB

Thay vì partition tay + vai riêng có `DELETE`/`DROP PARTITION` (phương án (a) BG-93 gốc), dùng đúng
cơ chế repo đã vận hành cho 5 bảng khác:

1. `create_hypertable('audit_logs', by_range('createdAt'))` — chunk theo thời gian (đề xuất
   `chunk_time_interval => INTERVAL '7 days'`).
2. `add_retention_policy('audit_logs', drop_after => INTERVAL '<RETENTION>')` — background worker của
   Timescale **drop cả chunk** (không phải DELETE từng hàng), chạy dưới owner của policy — **không
   đụng grants của `avi_app`** ⇒ WORM giữ nguyên đúng nghĩa: ứng dụng không xóa được gì, vòng đời do
   hạ tầng DB quản.
3. RETENTION đề xuất: **365 ngày** mặc định (khớp yêu cầu truy vết một năm), cấu hình lại được bằng
   một câu SQL vận hành (không cần deploy).

**Vì sao không partition tay:** thêm một vai + một scheduler + một lớp mã phải canh — đúng thứ
Timescale đã làm sẵn, đã chạy trên 5 bảng của repo này, và không mở đường `DELETE` nào cho tầng app.

## 3. Đường thực thi (migration, khuôn repo)

Migration `04xx_audit_logs_hypertable.sql` + script `apply-migration-04xx.mjs` (tái dùng cầu chì
`rolsuper`/`rolbypassrls` của `apply-migration-0338.mjs:74-84`, chạy bằng owner `aoi`):

- **Bước đo TRƯỚC (trong script):** `information_schema` xác nhận `audit_logs` chưa phải hypertable;
  đếm hàng + kích thước; in `current_database()` (Đ-28).
- `SELECT create_hypertable('audit_logs', by_range('"createdAt"'), migrate_data => true);`
  ⚠ `migrate_data => true` **khóa bảng trong lúc chuyển** — với ~vài nghìn hàng dev là tức thời;
  môi trường thật phải chạy trong cửa sổ bảo trì (xem §5). Nếu bảng thật đã quá lớn: phương án B —
  tạo bảng hypertable mới + INSERT-SELECT theo lô + rename swap (viết sẵn trong script, chọn bằng cờ).
- `SELECT add_retention_policy('audit_logs', drop_after => INTERVAL '365 days');`
- **Bước đo SAU:** bảng xuất hiện trong `timescaledb_information.hypertables`; policy xuất hiện trong
  `timescaledb_information.jobs`; grants của `avi_app` KHÔNG đổi (so trước/sau bằng
  `role_table_grants`).
- ⚠ BG-95: migration tái-chạy-được phải KIỂM đã-là-hypertable thì bỏ qua, không tạo lại policy trùng
  (`if_not_exists => true`).

## 4. Lưới đi kèm (cùng đợt thực thi)

- Db test: `audit_logs` là hypertable + policy tồn tại với `drop_after` đúng cấu hình (đọc
  `timescaledb_information.jobs`) — lưới đỏ nếu ai gỡ policy.
- Test bất biến WORM giữ nguyên: `avi_app` INSERT được, DELETE bị 42501 (ca âm thật, vai thật).
- Census không cần mới: không mở API/đường mã nào.

## 5. Điều kiện thực thi (vì sao CHƯA chạy hôm nay)

1. Chạy trên môi trường thật cần **cửa sổ bảo trì** cho `migrate_data` (hoặc chọn phương án B).
2. Chủ dự án chốt con số RETENTION cuối (mặc định đề xuất 365 ngày) — một dòng trả lời là đủ.
3. Dev có thể chạy trước làm bằng chứng (an toàn, 4.443 hàng) — sẽ chạy cùng đợt viết migration.

**Ước phí:** 1 migration + 1 script + 2 lưới ≈ nửa ngày agent; rủi ro chính là cửa sổ khóa bảng ở
môi trường thật — đã có phương án B.
