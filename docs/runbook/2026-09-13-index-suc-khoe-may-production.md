# Runbook — áp `idx_health_machine_created_desc` lên **production** (QĐ-30)

| | |
|---|---|
| **Quyết định** | QĐ-30 (chủ sở hữu, 2026-09-13) — duyệt áp index `drizzle/0356` lên production |
| **Tiền đề** | QĐ-27 đã áp **chỉ trên dev** (Đợt 51); đo lại Đợt 57: vẫn hiệu lực |
| **Migration** | `drizzle/0356_index_suc_khoe_may_theo_createdat.sql` |
| **Bảng** | `machine_health_history` |
| **Index** | `idx_health_machine_created_desc ("machineId", "createdAt" DESC)` |
| **Thiết bị đo** | `scripts/do-index-suc-khoe.mjs` — **CHỈ ĐỌC**, chạy được cả trước lẫn sau |
| **Trạng thái** | ⛔ **CHƯA CHẠY TRÊN PRODUCTION.** Môi trường phát triển không có chuỗi kết nối production (`.env` chỉ có dev `127.0.0.1:5434/aoi_management`). Tài liệu này + script là thứ Đợt 57 giao được. |

> ### ⚠ Đọc trước khi làm bất cứ gì
> Con số trong tài liệu này là số đo **trên DB dev**. Production có thể lớn hơn nhiều bậc,
> và **thời gian build `CONCURRENTLY` tỉ lệ thuận với số hàng**. Bước 1 tồn tại chính là để
> bạn thay số dev bằng số của bạn **trước khi** mở cửa sổ bảo trì, chứ không phải để xác nhận
> một điều đã biết.

---

## 0. Tiền điều kiện

| # | Điều kiện | Cách kiểm | Vì sao |
|---|---|---|---|
| 0.1 | DDL chạy bằng **owner `aoi`** | `SELECT current_user` | `avi_app` ⇒ `42501 permission denied for schema public` (đo được ở Đợt 51) |
| 0.2 | **KHÔNG** trong transaction | đọc mã runner | `CREATE INDEX CONCURRENTLY` trong transaction ⇒ `25001`. `scripts/migrate-standalone.mjs:222-231` chạy **từng câu bằng `sql.unsafe`, không bọc transaction** — đã đọc mã, không đoán. Runner khác ⇒ kiểm lại. |
| 0.3 | Nối vào **primary**, không phải replica | `SELECT pg_is_in_recovery()` ⇒ `false` (mục 0 của script) | index tạo trên primary rồi mới chảy sang replica |
| 0.4 | Còn **đủ đĩa**: ≥ 2 × `pg_relation_size` của bảng | mục 1 của script | `CONCURRENTLY` quét bảng hai lượt và dựng index mới song song với bảng cũ |
| 0.5 | Không có index cùng tên đang **INVALID** | mục 2 của script | index INVALID không được planner dùng **nhưng vẫn bị mọi INSERT bảo trì** — tệ nhất của hai thế giới |
| 0.6 | Có người **ký** và có cửa sổ theo dõi ≥ 24 h sau đó | — | bước 3 (`idx_scan`) chỉ đọc được sau khi có lưu lượng thật |

---

## 1. BƯỚC 1 — ĐO TRƯỚC (chỉ đọc, làm **ngoài** cửa sổ bảo trì được)

```bash
DATABASE_URL='postgres://aoi:***@<host>:5432/<db>' \
  node scripts/do-index-suc-khoe.mjs --json | tee truoc-$(date +%F).txt
```

Script in, theo thứ tự: danh tính CSDL · kích cỡ bảng · **mọi index hiện có + `indisvalid` + `idx_scan`** ·
`EXPLAIN (ANALYZE, BUFFERS)` đúng câu `DISTINCT ON` của `traSucKhoeMay` (1 lượt nguội + 4 lượt ấm) ·
bảng đối chiếu 7 tiêu chí · nhịp ghi 1 h/24 h.

**Nó không chạy một câu DDL nào và không ghi một hàng nào**, và phiên tự đặt
`default_transaction_read_only = on` nên kể cả một câu ghi lọt vào cũng bị CSDL từ chối (`25006`).

### 1b. Xem trước "cái giá đang trả" — **không cần DROP index**

```bash
DATABASE_URL=... node scripts/do-index-suc-khoe.mjs --khong-index
```

`--khong-index` tắt Index/Bitmap Scan **chỉ trong phiên ấy** (`SET enable_indexscan = off` …).
Dùng nó để (a) xem kế hoạch "như thể chưa có index", (b) **chứng minh bảng 7 tiêu chí biết kêu TRƯỢT**
— một bảng "ĐẠT 7/7" không kèm ca trượt chỉ là lời khai của một thiết bị chưa ai thử.

### Số nền đã đo (DB **dev**, 2026-09-13, `scripts/do-index-suc-khoe.mjs`)

| | có index | `--khong-index` (đối chứng) |
|---|---|---|
| kế hoạch | `Custom Scan (SkipScan)` → `Index Scan using idx_health_machine_created_desc` | `Seq Scan` **220 681 hàng** → `Sort` |
| `Sort Method` | — | **`external merge  Disk: 8 144 kB`** |
| nguội | **0,378 ms** | 157,99 ms |
| ấm p50 (4 lượt) | **0,211 ms** | 160,74 ms |
| buffers | `shared hit=176` | `shared hit=2 019 read=3 348`, **`temp read=1 018 written=1 021`** |
| 7 tiêu chí | **ĐẠT 7/7** | **TRƯỢT T1–T5**, ĐẠT T6–T7 (index vẫn tồn tại) |

⇒ chênh **≈ 752 ×** trên cùng một CSDL, cùng một câu, cùng một thiết bị đo.
Bảng dev: **220 681 hàng · 43 máy · 115 MB** (heap 42 + index 73); index này **6 952 kB**.

---

## 2. BƯỚC 2 — TẠO INDEX (`CREATE INDEX CONCURRENTLY`)

Chạy **migration**, không gõ tay:

```bash
DATABASE_URL='postgres://aoi:***@<host>:5432/<db>' node scripts/migrate-standalone.mjs
```

`0356` gồm hai câu và **tái chạy được**:

1. một khối `DO $$ … $$` **dọn index cùng tên nhưng INVALID** (vết của một lần `CONCURRENTLY` bị ngắt);
2. `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_machine_created_desc ON machine_health_history ("machineId", "createdAt" DESC);`

Bước 1 là bắt buộc vì `CREATE INDEX CONCURRENTLY IF NOT EXISTS` **bỏ qua** một index INVALID cùng tên
và để nguyên nó ở đó (bài học BG-95).

**Trong lúc chạy** — theo dõi từ một phiên khác:

```sql
SELECT phase, blocks_done, blocks_total, tuples_done, tuples_total
  FROM pg_stat_progress_create_index;
```

**Đánh đổi đã biết**

* `CONCURRENTLY` **không khoá đường ghi** (bảng này được job PdM ghi liên tục — dev đo ~292 hàng/giờ,
  ~8 000 hàng/ngày), đổi lại nó quét bảng **hai lượt** và **có thể để lại index INVALID nếu bị ngắt**.
* Dev đo: **114,92 ms → 147 ms**, index **6 608–6 952 kB**. Nhân theo tỉ lệ số hàng của bạn.
* Nếu môi trường của bạn chạy migration **trong** transaction, `CONCURRENTLY` sẽ nổ `25001`. Khi đó
  dùng bản không-`CONCURRENTLY` — nó lấy khoá `SHARE`, **chặn mọi INSERT** trong thời gian build
  (~0,2–1 s ở cỡ dev). **Đo lại ở cỡ của bạn trước khi chọn nhánh này.**

---

## 3. Phát hiện và dọn index **INVALID**

Bị Ctrl-C, mất kết nối, hay `statement_timeout` giữa chừng ⇒ index tồn tại nhưng `indisvalid = false`.

**Phát hiện** — mục 2 của script in cột `hợp_lệ` cho từng index và cảnh báo riêng; hoặc trực tiếp:

```sql
SELECT c.relname, i.indisvalid, i.indisready
  FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid
 WHERE i.indrelid = 'machine_health_history'::regclass AND NOT i.indisvalid;
```

**Dọn** — chạy lại migration (bước 1 của `0356` tự dọn), hoặc bằng tay:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_health_machine_created_desc;
```

rồi làm lại bước 2. ⚠ **Không** để một index INVALID nằm lại: planner không dùng nó, nhưng mọi
`INSERT`/`UPDATE` vẫn phải bảo trì nó.

---

## 4. Rollback

Index này **chỉ thêm một đường đọc**; nó không đổi lược đồ, không đổi dữ liệu, và
**`traSucKhoeMay` không bị sửa một dòng nào** để "hợp index" (cố ý — xem docblock `0356`).
Nên rollback là một câu, và an toàn chạy lúc đang tải:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_health_machine_created_desc;
```

* `CONCURRENTLY` ⇒ không khoá đường đọc/ghi.
* Sau khi drop, kế hoạch trở lại `Seq Scan + external merge` — **xác nhận bằng bước 1** (`--khong-index`
  cho ra đúng hình dạng ấy, nên bạn biết trước mình sẽ thấy gì).
* Không có bước dữ liệu nào phải hoàn nguyên.

**Khi nào rollback:** `idx_scan` vẫn `0` sau ≥ 7 ngày lưu lượng thật (index không ai dùng = chi phí ghi
thuần), hoặc đường ghi chậm đi đo được và truy ra đúng index này.

---

## 5. Tiêu chí thành công — **bằng số**, không bằng cảm nhận

Script in đúng bảng này ở mục 4. Chạy lại nó sau bước 2 (T1–T6) và **sau ≥ 24 h** (T7).

| # | Tiêu chí | Ngưỡng | Dev trước | Dev sau |
|---|---|---|---|---|
| **T1** | kế hoạch **không còn** `Sort Method: external merge` | bắt buộc | có (8 144 kB) | không |
| **T2** | kế hoạch **không còn** `Seq Scan on machine_health_history` | bắt buộc | có (220 681 hàng) | không |
| **T3** | kế hoạch **có** nhắc `idx_health_machine_created_desc` | bắt buộc | không | có |
| **T4** | EXPLAIN **ấm p50** | **< 10 ms** | 160,74 ms | **0,211 ms** |
| **T5** | `temp read` | **= 0 khối** | 1 018 khối | 0 |
| **T6** | `indisvalid` | `true` | — | true |
| **T7** | `idx_scan` sau **≥ 24 h** | **> 0** | — | 102 544 |

**T7 là tiêu chí duy nhất không đo được ngay.** Đừng đóng phiếu trước khi có nó: một index đúng về
kế hoạch nhưng planner thật không chọn (vì thống kê, vì `work_mem` lớn, vì phân bố dữ liệu khác) là
một index chỉ tốn chi phí ghi.

**Tiêu chí phụ — đường người dùng.** Nếu có `dist` chạy được trên môi trường ấy, đo thêm
`twinCanh.sucKhoeMay` **qua chính thủ tục** (không chỉ SQL thuần). Dev Đợt 51: admin nguội
**523,31 → 45,58 ms**, ấm ×5 p50 **319,26 → 11,82 ms (27,0 ×)**. Chênh giữa 752 × (SQL) và 27 ×
(thủ tục) là **đúng và đáng nhớ**: phần còn lại của thủ tục không do index này quyết định.

---

## 6. Sổ ghi khi thực hiện

| Mốc | Ghi gì | Nguồn |
|---|---|---|
| trước | `truoc-<ngày>.txt` (cả bản `--khong-index`) | script |
| lúc tạo | thời gian build, cỡ index, có bị ngắt không | `pg_stat_progress_create_index` + log migration |
| ngay sau | `sau-<ngày>.txt`, bảng T1–T6 | script |
| +24 h | `sau24h-<ngày>.txt`, **T7** | script |
| người ký | tên + thời điểm | — |

---

### Phụ lục — vì sao **index**, không phải viết lại câu

Đợt 50 đã thử đổi hình dạng câu (per-máy `UNION ALL … ORDER BY "createdAt" DESC LIMIT 1` × 42):
**233–412 ms, TỆ HƠN** `DISTINCT ON` (126–154 ms lúc ấy). Cả hai hình dạng đều không có index sắp
theo `createdAt` để tựa vào, nên 42 câu con vẫn là 42 lần Seq Scan. Vấn đề nằm ở **cấu trúc lưu
trữ**, không ở cách viết câu.

Bảng đã có sẵn 6 index, **hai cái trông như đúng cái ta cần** — `idx_health_machine_time` và
`uq_machine_health_history_machine_ts`, cả hai `("machineId", "timestamp")`. Nhưng câu sắp theo
**`createdAt`**, một cột **khác** và khác **có chủ ý**: `timestamp` là mốc của KỲ ĐO, `createdAt` là
lúc hàng được GHI. Đó là lý do sáu index không cứu được gì, và là lý do phải đọc `pg_get_indexdef`
chứ không đọc tên index.

---

## 7. Diễn tập trên bản sao — **ĐÃ ĐO, CHƯA CHẠY DDL** (và vì sao)

Brief Đợt 57 giả định môi trường này *"có thể không có DB test"*. **Đo lại thì có**:
`aoi_management_test` nằm ngay trên cùng instance dev (`127.0.0.1:5434`) — liệt kê bằng
`pg_database`. Nên bước diễn tập là **làm được**, chỉ bị chặn bởi một ràng buộc khác.

**Đã làm (chỉ đọc):** chạy `scripts/do-index-suc-khoe.mjs` lên `aoi_management_test`
(`.qa-dot57/B-do-index-DBTEST.txt`). Kết quả cho một bài học đáng đưa vào chính runbook này:

| | dev `aoi_management` (chưa index — mô phỏng `--khong-index`) | test `aoi_management_test` (**thật sự** chưa có index) |
|---|---|---|
| số hàng | 220 681 | **30 633** |
| số máy trong `IN` | 43 | **1 466** |
| `Sort Method` | **`external merge  Disk: 8 144 kB`** | **`quicksort  Memory: 2 248 kB`** |
| ấm p50 | 160,74 ms | **19,96 ms** |
| 7 tiêu chí | TRƯỢT T1–T5 | TRƯỢT T2/T3/T4/T6/T7, **ĐẠT T1 + T5** |

> ### ★ Bệnh này phụ thuộc **KÍCH CỠ**, không phụ thuộc hình dạng câu.
> Cùng một câu `DISTINCT ON`, cùng một bảng thiếu đúng một index, nhưng ở 30 k hàng
> Postgres sắp **trong RAM** (`quicksort`) nên **T1 và T5 vẫn ĐẠT** — chỉ T2/T3 lộ ra.
> Ở 220 k hàng nó tràn `work_mem` và rơi xuống **`external merge` ra đĩa**, và thời gian
> nhảy **×8**. Hệ quả cho người vận hành: **một môi trường staging nhỏ sẽ báo "không sao"
> cho đúng cái bệnh đang giết production.** Khi đọc bảng tiêu chí, **T2/T3 là tín hiệu
> sớm; T1/T4/T5 chỉ kêu sau khi đã đủ lớn.**

**Chưa làm (DDL):** không chạy `CREATE INDEX` trên `aoi_management_test`. Lệnh giao việc
của Đợt 57 có **hai câu mâu thuẫn nhau** — *"diễn tập trên DB test nếu có"* và *"**tuyệt đối
không** chạy DDL lên bất kỳ DB nào ngoài DB dev đã được duyệt ở QĐ-27"*. Khi một lệnh cấm
tuyệt đối va vào một lệnh cho phép, phần cấm thắng, và người giao việc là người gỡ — không
phải người thực thi tự nới quyền của mình.

**Muốn diễn tập thì chạy đúng ba lệnh này** (cần owner `aoi`, DB test là bản dùng-rồi-bỏ):

```bash
T='postgres://aoi:***@127.0.0.1:5434/aoi_management_test'
DATABASE_URL=$T node scripts/do-index-suc-khoe.mjs --json > dientap-truoc.txt   # bước 1
DATABASE_URL=$T node scripts/migrate-standalone.mjs                            # bước 2
DATABASE_URL=$T node scripts/do-index-suc-khoe.mjs --json > dientap-sau.txt     # bước 3
```

⚠ Diễn tập ở **30 633 hàng** chỉ đo được *thủ tục* (migration chạy trót lọt, `CONCURRENTLY`
không nổ `25001`, index hợp lệ) — **không** đo được *thời gian build ở cỡ production*, và theo
đúng bảng trên, **không** tái hiện được `external merge`. Muốn ước cửa sổ bảo trì thì nhân
thời gian build dev (**115–147 ms cho 220 k hàng**) theo số hàng THẬT của production, lấy từ
mục 1 của script chạy trên chính production.
