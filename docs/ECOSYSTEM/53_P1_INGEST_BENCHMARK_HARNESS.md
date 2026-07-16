# 53 — P1: Harness benchmark ingest AVI/AOI (QĐ#7)

> **Thuộc:** doc 51 §8 P1 · **QĐ#7**: benchmark thật *100 máy × 1 inspection/giây + ảnh* là **deliverable bắt buộc** trước khi cam kết SLA.
> **Bối cảnh:** doc 48 ghi *"scale benchmark chỉ dry-run"*. Doc này đóng đúng lỗ đó cho **tầng inspection**.
> **Ngày:** 2026-07-16 · **Trạng thái:** harness XONG + tự smoke-test LIVE. **Chưa chạy 100 máy** (xem §7 — có vật cản môi trường).

---

## 1. Đây là cái gì, và KHÔNG phải cái gì

`scripts/bench/bench-inspection-ingest.mjs` phát HTTP **thật** vào server **thật**, mỗi máy dùng
**credential riêng**, payload khớp `submitInspectionInputSchema` hiện tại, ảnh base64 thật —
rồi **đếm lại từ DB** để đối chiếu với những gì server đã ACK.

**KHÔNG phải dry-run.** Không có chế độ "giả lập cho vui": không `--yes` thì script chỉ in kế hoạch rồi thoát.

| | `bench-ingest.mjs` (doc 44/48) | `bench-inspection-ingest.mjs` (doc 51 P1) |
|---|---|---|
| Tầng | OT telemetry `/api/ot/ingest` | **Inspection máy** `submitInspection` |
| Payload | tag sample phẳng | header + N điểm đo + **ảnh base64** |
| Rate-limit | tier riêng 300k/phút/key | **tier `/api` 300/phút** (xem §5) |
| Đơn vị | điểm/giây | **inspection/giây** |

Hai cái **cố ý KHÔNG gộp** — khác payload, khác limiter, khác SLA.

---

## 2. Chạy

```bash
# 0. Xem kế hoạch (KHÔNG phát tải, KHÔNG ghi DB) — luôn làm bước này trước
npm run bench:ingest -- --machines=100 --rate=1 --duration=60 --image-kb=200

# 1. Smoke: chứng minh đường ống sống (header-only, không phụ thuộc seed điểm đo)
npm run bench:ingest -- --machines=3 --rate=1 --duration=3 --points=0 --image-kb=0 --yes

# 2. DELIVERABLE QĐ#7 — 100 máy × 1/s × 60s + ảnh 200KB
npm run bench:ingest -- --machines=100 --rate=1 --duration=60 --image-kb=200 --points=20 --provision --yes

# 3. Dò idempotency P0 (0272) dưới tải: 20% bản gửi là replay
npm run bench:ingest -- --machines=100 --rate=1 --duration=60 --dup-pct=20 --provision --yes

# 4. Kịch bản NAT — mọi máy chung 1 IP, KHÔNG gửi x-api-key header (§5)
npm run bench:ingest -- --machines=100 --rate=1 --duration=60 --auth=body --provision --yes

# 5. Dọn dữ liệu nếu đã chạy --keep-data
npm run bench:ingest -- --cleanup=<runId> --yes      # hoặc --cleanup=all
```

### Cờ

| Cờ | Mặc định | Ý nghĩa |
|---|---|---|
| `--machines` | 100 | Số máy mô phỏng, **mỗi máy 1 credential riêng** |
| `--rate` | 1 | inspection/giây/máy |
| `--duration` | 60 | giây |
| `--points` | 20 | điểm đo/inspection (`0` = header-only smoke) |
| `--image-kb` | 200 | KB ảnh **đã giải mã**/inspection (`0` = không ảnh) |
| `--image-points` | 1 | số điểm mang ảnh (`--image-kb` chia đều) |
| `--dup-pct` | 0 | % bản **gửi lặp lại** payload trước (dò idempotency) |
| `--endpoint` | `rest` | `rest` \| `trpc` — xem §5 (rest **bẹp mã lỗi**) |
| `--auth` | `header` | `header` \| `body` — xem §5 (quyết định bucket rate-limit) |
| `--concurrency` | 200 | trần request đang bay |
| `--provision` | off | cho phép **TẠO** máy bench khi DB không đủ |
| `--keep-data` | off | giữ dữ liệu bench (mặc định: xoá sạch sau khi chạy) |
| `--yes` | off | **BẮT BUỘC** để phát tải thật |

---

## 3. Ý nghĩa TỪNG chỉ số

### 3.1 Thông lượng

| Chỉ số | Đọc thế nào |
|---|---|
| `offeredPct` | **Đọc CÁI NÀY TRƯỚC.** % tải harness thực sự phát ra được. `< 99%` ⇒ **harness** là nút thắt, không phải server ⇒ mọi số bên dưới là **cận dưới**, KHÔNG được coi là bằng chứng đạt SLA. |
| `achievedPerSec` | inspection/giây được nhận. |
| `acceptedPct` | % request được nhận (ok + duplicate + queued). |
| `wireMbPerSec` | Băng thông thật — với ảnh 200KB, 100 máy × 1/s ≈ **27 MB/s** lên dây. |

### 3.2 Độ trễ
`p50/p95/p99/p99.9` mili-giây, đo **client-side** (gửi → nhận đủ body). Đã bao gồm mạng + JSON + base64.

### 3.3 Bucket kết quả — chỗ quan trọng nhất

| Bucket | Nghĩa |
|---|---|
| `ok` | Đã ghi thật, có `inspectionId`. |
| `duplicate` | **P0 short-circuit** bắt được bản trùng (`duplicate:true`). **Đúng như thiết kế.** |
| `queued` | Store-and-forward ACK: `success:true, queued:true, inspectionId:null`. ⚠ **ĐÃ NHẬN NHƯNG CHƯA VÀO DB.** **KHÔNG BAO GIỜ tính là `ok`.** |
| `http_429` | Bị rate-limit (xem §5). |
| `http_503` / `http_5xx` | Server quá tải / lỗi. |
| `http_4xx` | Payload/credential sai. |
| `timeout` / `network` | Không có phản hồi. |

### 3.4 Chính trực dữ liệu — **deliverable của QĐ#7**

Harness **đếm lại từ `product_inspections`**, độc lập với những gì server nói.

Vì `queued` có thể được WAL replay vào DB sau đó, số dòng DB chỉ **bị chặn hai đầu**:

```
minExpected = ok                 (chưa replay gì)
maxExpected = ok + queued        (replay hết)
```

| Chỉ số | Phải bằng | Nếu khác ⇒ |
|---|---|---|
| `unaccountedRows` = `max(0, ok − dbRows)` | **0** | **THẤT THOÁT ÂM THẦM** — server ACK ok nhưng DB không có dòng. |
| `unexplainedExcessRows` = `max(0, dbRows − (ok+queued))` | **0** | DB có dòng không ai ACK. |
| `duplicateRowsInDb` = `dbRows − distinctSerials` | **0** | **P0 (mig 0272) THỦNG dưới tải.** |
| `queuedNotInDb` | **0** | Còn dữ liệu kẹt trong WAL, chưa truy vấn được. |

> **Vì sao hai chiều riêng, không gộp thành một số có dấu:** một số `ok − dbRows` duy nhất sẽ báo `-4`
> cho một lần replay lành mạnh (trông như lỗi), và báo `0` cho *4 mất + 4 replay* (giấu mất lỗi thật).
> Trung bình cộng không phải sự thật. (Đã pin bằng test `loss and replay do NOT cancel out`.)

### 3.5 Tài nguyên app-server
Lấy RSS/heap qua `/metrics` — **chỉ khi `METRICS_ENABLED=true`**, và chỉ là mẫu **đầu/cuối**
(không phải đỉnh liên tục — đỉnh thật lúc chạy có thể cao hơn). Không lấy được → ghi thẳng
**"KHÔNG ĐO ĐƯỢC"**, không bịa số.

---

## 4. Ngưỡng PASS/FAIL **đề xuất** cho SLA

> ⚠ Đây là **ĐỀ XUẤT chờ chủ hệ chốt**, **KHÔNG phải số đã đo được**. Đừng trích dẫn như thành tích.
> Cách chốt đúng: chạy baseline → xem thực tế → chủ hệ ratify → khoá số vào `DEFAULT_THRESHOLDS`.

| Cổng | Ngưỡng đề xuất | Vì sao |
|---|---|---|
| offered load | ≥ 99% | Harness phải theo kịp thì số mới có nghĩa. |
| accepted rate | ≥ 99.9% | Máy AOI mất bản kiểm = mất truy xuất nguồn gốc. |
| error rate | ≤ 0.1% | |
| latency p95 | ≤ 1000 ms | Máy chờ ACK trước khi chạy board kế. |
| latency p99 | ≤ 2000 ms | |
| **unaccounted rows** | **= 0** | Không khoan nhượng. Mất là mất. |
| **duplicate rows in DB** | **= 0** | Cột sống của P0/QĐ#3. |
| **queued-not-in-DB** | **= 0** | "Đã nhận" ≠ "truy vấn được". |

**Cổng không đo được ⇒ KHÔNG phải PASS.** `evaluateGates` trả `pass:null` và tổng kết là **FAIL**.
Đây là chủ ý: im lặng không bao giờ được đọc thành xanh.

---

## 5. Bẫy phải biết trước khi tin con số

### 5.1 `--auth=header` vs `--auth=body` — **kịch bản NAT có thật**

`server/_core/rateLimitConfig.ts` key bucket theo `x-api-key` **header**. Nhưng
`/api/machine/submit-inspection` cho phép gửi `apiKey` **trong body** — mà rate-limiter chạy
**trước** khi parse body, nên nó chỉ thấy **IP**.

⇒ 100 máy sau **cùng một NAT**, gửi key trong body: **dùng chung 1 bucket = 300/phút = 5/giây cho cả nhà máy**.
Đúng nỗi lo doc 51. `--auth=body` **đo được** nó; `--auth=header` là đường "ngoan".

**Chạy CẢ HAI.** Chênh lệch chính là rủi ro tồn đọng.

### 5.2 `/api/machine/submit-inspection` **KHÔNG** ở tier ingest cao
`OT_INGEST_PATHS` chỉ có `/api/ot/ingest`. Đường inspection đi tier trình duyệt **300/phút/key**
(= 5/giây/máy). Ở 1/giây/máy thì thoải mái, nhưng **hết biên ở ~5/giây/máy** — cần biết trước khi hứa SLA.

### 5.3 REST **bẹp mọi mã lỗi về 400**
`server/_core/index.ts:577-581` bắt mọi lỗi → `res.status(400)`. Nên `--endpoint=rest` **không phân biệt được**
429 vs 503 vs 500. **Muốn phân tích lỗi theo mã ⇒ dùng `--endpoint=trpc`** (giữ đúng mã).

### 5.4 Áp lực RAM
Mọi ảnh base64 được `Buffer.from()` **trong RAM** (`machineApiRouters.ts`, concurrency upload = 6).
100 máy × 200KB = ~20MB ảnh **đã giải mã** mỗi giây, chưa kể ~27MB/s base64 trên dây. Đây chính là
thứ `--image-kb` sinh ra để ép — đừng chạy benchmark với `--image-kb=0` rồi tuyên bố đạt SLA.

---

## 6. Đọc kết quả để trả lời **"hệ chịu được bao nhiêu máy?"**

Đây là quy trình, không phải một lần chạy:

1. **Kiểm harness trước.** `offeredPct < 99%` ⇒ tăng `--concurrency`, hoặc chia tải ra nhiều tiến trình/máy phát.
   Chưa sửa xong thì **chưa có số nào về server là hợp lệ**.
2. **Baseline** `--machines=100 --rate=1`. Toàn PASS ⇒ 100 máy **đạt** ở cấu hình ĐÓ (ảnh đó, điểm đo đó, phần cứng đó).
3. **Leo thang** 150 → 200 → 300… Điểm gãy = lần đầu **bất kỳ** cổng nào FAIL. Ghi lại **cổng nào gãy trước**:
   - gãy `latency p95/p99` trước ⇒ nghẽn **CPU/IO app-server**;
   - gãy `http_429` trước ⇒ nghẽn **rate-limit** (§5.1/5.2) — chỉnh cấu hình, không phải mua máy;
   - gãy `unaccounted/duplicate rows` ⇒ **nghẽn tính đúng đắn** — DỪNG, đây là bug, không phải giới hạn công suất;
   - gãy `queued` tăng vọt ⇒ DB không theo kịp, WAL đang gánh.
4. **Công suất công bố = điểm gãy ÷ hệ số an toàn** (đề xuất ÷2 — nhà máy có burst, retry, và ngày xấu trời).
5. **Ghi rõ điều kiện.** "N máy" mà không kèm ảnh-KB / điểm đo / phần cứng / endpoint là **con số vô nghĩa**.

---

## 7. Trung thực: cái này **CHƯA** chứng minh được

| Việc | Trạng thái |
|---|---|
| Harness chạy thật end-to-end (auth → gửi → ACK → đếm lại DB → dọn) | ✅ **ĐÃ SMOKE LIVE** 3 máy × 1/s × 3s → 9/9 `ok`, DB khớp 9, offered 100%, dọn sạch |
| **P0 idempotency (0272) giữ dưới tải đồng thời** | ✅ **ĐÃ CHỨNG MINH LIVE**: 4 máy × 2/s, `--dup-pct=50` → 17 `duplicate` + 15 `ok`, DB đúng **15 dòng / 15 serial**, **0 dòng trùng** |
| **100 máy × 1/s + ảnh 200KB (deliverable QĐ#7)** | ❌ **CHƯA CHẠY** — vướng §7.1 |
| Lỗi theo mã 429/503/500 dưới bão tải | ❌ chưa — cần chạy được ở quy mô thật |
| RSS/heap app-server | ⚠ chỉ mẫu đầu/cuối, cần `METRICS_ENABLED=true` |
| Soak dài (giờ/ngày) | ❌ ngoài phạm vi P1 |

### 7.1 VẬT CẢN: DB dev thiếu cột `deletedAtVersion` ⇒ **mọi inspection có điểm đo đều hỏng**

DB dev `aoi_management` **chưa áp `drizzle/0274_measurement_point_integrity.sql`** (việc của agent P1 khác,
đang bay). `drizzle/schema/inspection.ts` đã khai cột `deletedAtVersion` nhưng DB chưa có ⇒ mọi truy vấn
`measurement_point_defs` **fail** ⇒ mọi `submitInspection` có `measurements` rơi vào WAL.

**Điều phối viên cần làm trước khi chạy deliverable 100 máy:**

```bash
# 1) Áp migration còn thiếu (chủ nhân: agent P1 measurement-point-integrity)
node scripts/migrate-standalone.mjs        # hoặc quy trình migration đang dùng

# 2) Xác nhận
node -e "…SELECT column_name FROM information_schema.columns WHERE table_name='measurement_point_defs' AND column_name='deletedAtVersion'"

# 3) Server phải sống + có metrics
METRICS_ENABLED=true npm run dev

# 4) Chạy deliverable
npm run bench:ingest -- --machines=100 --rate=1 --duration=60 --image-kb=200 --points=20 --provision --yes
```

### 7.2 ⚠ PHÁT HIỆN THẬT (ngoài vùng — cần chủ nhân P0 quyết): **WAL replay + P0 short-circuit = mất điểm đo âm thầm**

Smoke-test **bắt được lỗi thật**, và tôi đã **kiểm chứng bằng DB**:

```
inspection 85982  BENCH-PROBE1-1-0  → measurement_results = 0
inspection 85983  BENCH-PROBE1-0-0  → measurement_results = 0
TOTAL header rows: 2 | rows with ZERO measurements: 2      ← máy nhận success:true, queued:true
```

**Cơ chế** (đọc từ code, không suy đoán):

1. `processInspectionSubmission` insert **header** → **COMMIT** (`duplicate=false`).
2. Bước sau (resolve điểm đo) **ném lỗi transient**.
3. Mutation bắt lỗi → **buffer TOÀN BỘ payload vào WAL** → trả `{success:true, queued:true}`.
   **Header đã nằm trong DB rồi.**
4. Backfill replay → `createProductInspection` → `ON CONFLICT DO NOTHING` → **`duplicate=true`**
   → **SHORT-CIRCUIT `return` trước khi ghi `measurement_results`** (`machineApiRouters.ts:386-393`).
5. Kết quả: **header tồn tại vĩnh viễn với 0 điểm đo.** Máy đã được ACK `success`. **Không ai biết.**

**Vì sao đáng lo:** cú kích trong lần chạy của tôi là schema drift (§7.1, tự hết khi áp 0274), **nhưng
failure mode thì không phụ thuộc cú kích đó** — **bất kỳ** lỗi transient nào xảy ra *sau* khi header commit
(DB blip, deadlock, storage hiccup, timeout) đều tạo ra đúng bản ghi cụt đó. P0 short-circuit giả định
"đã trùng ⇒ mọi side-effect ĐÃ chạy xong" — giả định này **sai** khi lần đầu chỉ chạy được **một nửa**.

**Không sửa ở P1 này** (thuộc `machineApiRouters.ts`/`inspectionStoreForward` — vùng agent P0). Hướng đề xuất:

- **(a)** Bọc header + measurements trong **MỘT transaction** (không có nửa vời để mà replay) — sạch nhất; hoặc
- **(b)** Cho short-circuit **kiểm tra tính đầy đủ** (`duplicate && count(measurement_results)==0` ⇒ ghi tiếp thay vì return); hoặc
- **(c)** Chỉ buffer WAL khi lỗi xảy ra **trước** khi header commit.

Ngoài ra: `--dup-pct` của harness **không** phát hiện được ca này (payload replay là bản *đầy đủ*, không phải
bản cụt). Muốn cover ⇒ cần fault-injection ở tầng service — **đề xuất P2**.

---

## 8. Cổng an toàn

Harness **GHI** hàng chục nghìn dòng inspection và **ép tải** đường ingest.

- **Từ chối chạy** khi đích trông giống production: `NODE_ENV=production` · tên DB khớp `prod|production|live` ·
  host DB **hoặc** host app không phải loopback/RFC1918. Thoát hiểm **duy nhất**: `BENCH_UNSAFE_ALLOW_PROD=1` (in banner to đùng).
- **Không `--yes` ⇒ không phát tải.** Chỉ in kế hoạch.
- Mọi dòng ghi ra mang serial **`BENCH-<runId>-*`** ⇒ luôn tìm/xoá được. Mặc định **tự dọn**; key bench **luôn** bị thu hồi kể cả khi chạy lỗi.
- Máy bench chỉ được tạo khi có **`--provision`** (tạo máy = ghi master data ⇒ phải cố ý).
- ⚠ Nếu còn bản `queued` lúc thu hồi key, WAL replay sau đó sẽ **dead-letter** ("Invalid API key").
  Đó là **hiện vật của harness**, không phải lỗi server — script **cảnh báo thẳng**. Muốn đo đường replay:
  chạy `INSPECTION_STORE_FORWARD_ENABLED=false`, hoặc `--keep-data` rồi tự dọn sau khi WAL drain.

---

## 9. File

| Đường dẫn | Vai trò |
|---|---|
| `scripts/bench/bench-inspection-ingest.mjs` | Runner (mọi I/O: postgres, fetch, fs) |
| `scripts/bench/lib/inspection-load.mjs` | Lõi **thuần** (guard, payload, phân loại, toán chính trực, chấm cổng) |
| `server/services/bench/benchInspectionHarness.test.ts` | 38 test — đã **mutation-test** (xem dưới) |
| `scripts/bench/results/<label>.json` / `.md` | Kết quả (thư mục đã gitignore) |

Test **đã được kiểm bằng mutation test** — gỡ fix thì test phải đỏ, và nó đỏ thật:

| Mutation | Kết quả |
|---|---|
| `queued` bị tính thành `ok` | **2 test đỏ** |
| Guard bỏ kiểm tên DB production | **1 test đỏ** |
| `unaccountedRows` hardcode `0` | **3 test đỏ** |
| Cổng "không đo được" tính thành PASS | **1 test đỏ** |
