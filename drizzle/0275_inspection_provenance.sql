-- doc 51 P1 — INSPECTION PROVENANCE: server receive-time + clock-skew flag (CASE #3),
-- machine-declared config version pin (CASE #12), explicit idempotency key ledger
-- (closes the P0/0272 hole).
--
-- ════════════════════════════════════════════════════════════════════════════
-- BA VẤN ĐỀ, MỘT MIGRATION (cùng chạm product_inspections → gộp để chỉ khoá bảng
-- nóng nhất MỘT lần):
--
-- ── (1) CASE #3 CLOCK SKEW (GAP — sai ca ÂM THẦM) ───────────────────────────
--   product_inspections."inspectionTime" là giờ DO MÁY GỬI, không đối chiếu với
--   giờ server, không validate định dạng. Máy lệch 6h (RTC trôi, NTP chết, ai đó
--   chỉnh tay) → board rơi SAI CA / SAI NGÀY, không một cảnh báo nào. Không có
--   cột nào ghi "server nhận lúc nào" ⇒ SAU KHI hỏng cũng KHÔNG truy ngược được
--   dữ liệu nào bị ảnh hưởng.
--   → "serverReceivedAt" (sự thật server, không thể bị máy nói dối) +
--     "timeSkewSeconds" (machineTime − serverNow, CÓ DẤU) + "clockSkewFlagged" +
--     "timeSource" (giờ đến từ đâu). Từ nay MỌI row đều đo được, kể cả khi cờ
--     cưỡng chế còn tắt.
--
-- ── (2) CASE #12 VERSION PINNING (GAP — QĐ#2 phụ thuộc) ─────────────────────
--   "board này chấm theo ngưỡng nào?" hiện KHÔNG trả lời được: product_inspections
--   không lưu version cấu hình điểm-đo mà máy đang dùng, mà product_models.
--   "pointsConfigVersion" thì LIVE (đổi mỗi lần kỹ sư sửa ngưỡng). Chấm lại theo
--   limit LIVE = chấm board hôm qua bằng ngưỡng hôm nay — chính là điều QĐ#2 CẤM.
--   → "pointsConfigVersion" (máy KHAI, server đóng dấu NGUYÊN VĂN — đây là seam
--     để tầng chấm-lại tra SNAPSHOT đúng version) + "configVersionStatus"
--     ('current' | 'stale' | 'ahead' | 'unknown') = TAG MỀM, KHÔNG chặn (QĐ#3).
--
-- ── (3) IDEMPOTENCY: bịt nốt lỗ P0 ──────────────────────────────────────────
--   0272 khoá theo natural key ("machineId","serialNumber","inspectionTime"). Máy
--   KHÔNG gửi inspectionTime → server đóng dấu now() ở MỖI lần nhận → mỗi retry
--   một khoá khác ⇒ 0272 KHÔNG bắt được. Chỉ khoá tường minh do client sinh (ổn
--   định qua retry) mới đóng được.
--
--   ⚠⚠ TẠI SAO KHÔNG PHẢI unique index trên product_inspections("machineId",
--      "idempotencyKey") NHƯ KẾ HOẠCH: product_inspections LÀ HYPERTABLE
--      TimescaleDB (partition theo "inspectionTime"). ĐÃ KIỂM CHỨNG TRỰC TIẾP
--      trên DB dev:
--        CREATE UNIQUE INDEX ... ON product_inspections ("machineId", <col>)
--        → ERROR: cannot create a unique index without the column
--                 "inspectionTime" (used in partitioning)
--      (Cùng lý do 0172 phải viết lại PK thành (id, "inspectionTime").) Mà thêm
--      "inspectionTime" vào khoá thì khoá VÔ DỤNG — chính cái cột đổi mỗi retry
--      là thứ ta đang cố loại khỏi khoá. ⇒ Trên hypertable, unique-index-only
--      là ĐƯỜNG CỤT, không phải lựa chọn thẩm mỹ.
--
--   → LEDGER "inspection_idempotency_keys": bảng THƯỜNG (không hypertable) nên
--     PK ("machineId","idempotencyKey") hợp lệ, cưỡng chế TOÀN CỤC. Đây là mẫu
--     idempotency-key ledger chuẩn (Stripe-style), không phải sáng chế riêng.
--     Cột "idempotencyKey" trên product_inspections vẫn thêm — để AUDIT ("row này
--     sinh ra từ khoá nào") — nhưng RÀNG BUỘC nằm ở ledger.
--     App: db/inspection.ts createProductInspection bọc claim-ledger + insert
--     header trong MỘT transaction (ON CONFLICT DO NOTHING của PG chờ tx đang
--     bay rồi mới quyết định ⇒ hai retry đồng thời được tuần tự hoá đúng).
--
-- ĐẶC TÍNH CHUNG:
--   • MỌI cột đều NULLABLE, KHÔNG default, KHÔNG backfill. 22.995 row lịch sử
--     giữ NULL = "không biết" — đó là SỰ THẬT. Bịa serverReceivedAt = createdAt
--     cho row cũ nghe hợp lý nhưng là bịa: createdAt là giờ ghi DB, và với row
--     đến qua WAL replay thì lệch hàng giờ so với giờ nhận thật.
--   • ADD COLUMN nullable/no-default = metadata-only, KHÔNG rewrite bảng →
--     an toàn trên bảng 23k row lẫn bảng 100M row. ĐÃ KIỂM CHỨNG chạy được trên
--     hypertable ĐÃ BẬT compression (0271) ở dev (hiện 0 chunk nén; khi đã có
--     chunk nén, TimescaleDB < 2.10 có thể từ chối → khối EXCEPTION ghi 'partial',
--     KHÔNG đánh fail cả lượt migrate).
--   • KHÔNG thêm index nào lên product_inspections. Bảng nóng nhất hệ (100
--     máy × 1/s theo QĐ#7); mỗi index là thuế trên MỌI insert. Truy vấn
--     "khoá X → inspection nào" đã do ledger trả lời; "board nào lệch giờ" là
--     truy vấn báo cáo/off-peak (seq scan chấp nhận được), chưa đáng một index.
--   • GUARDED: bọc BEGIN/EXCEPTION + ghi db_feature_status (pattern 0172/0247/
--     0272/0274). Fail ⇒ WARNING loud + 'partial'.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0275 (0274 = measurement_point_integrity).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  cols_ok    boolean := false;
  ledger_ok  boolean := false;
  err_detail text := '';
BEGIN
  -- ── (a) Cột provenance trên product_inspections (metadata-only adds).
  BEGIN
    -- CASE #3 — clock skew.
    -- Giờ SERVER nhận submission. Sự thật duy nhất máy KHÔNG can thiệp được.
    -- Với bản replay từ WAL: là giờ NHẬN GỐC (mutation đóng dấu rồi mới buffer),
    -- KHÔNG phải giờ replay — nếu không mọi bản replay đều trông như lệch giờ.
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "serverReceivedAt" timestamp;
    -- machineTime − serverReceivedAt, giây, CÓ DẤU (âm = máy chạy chậm/quá khứ).
    -- Giữ dấu để phân biệt "máy trễ" với "máy chạy trước" — hai nguyên nhân khác nhau.
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "timeSkewSeconds" integer;
    -- true = |skew| vượt ngưỡng INGEST_CLOCK_SKEW_WARN_SECONDS (mặc định 300s) tại
    -- thời điểm nhận. NULL = row trước 0275 (chưa từng được đo) — KHÁC false.
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "clockSkewFlagged" boolean;
    -- 'machine_utc'   = máy gửi timestamp CÓ offset/Z → mốc thời gian TUYỆT ĐỐI, skew đáng tin.
    -- 'machine_naive' = máy gửi timestamp KHÔNG offset → server buộc phải ĐOÁN là giờ
    --                   local của mình. skew đo được DƯỚI GIẢ ĐỊNH ĐÓ ⇒ máy lệch đúng
    --                   một số nguyên múi giờ sẽ đo ra skew ≈ 0. Đây chính là lý do cờ
    --                   INGEST_REQUIRE_TIME_OFFSET tồn tại (bật ⇒ từ chối naive).
    -- 'server'        = máy KHÔNG gửi giờ → server đóng dấu now(). skew = 0 theo định nghĩa
    --                   (và board này KHÔNG được 0272 bảo vệ — cần idempotencyKey).
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "timeSource" varchar(20);

    -- (3) Idempotency — AUDIT ONLY (ràng buộc ở ledger, xem dưới).
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "idempotencyKey" varchar(200);

    -- CASE #12 — version pinning.
    -- Version cấu hình điểm-đo mà MÁY KHAI đang dùng. Đóng dấu NGUYÊN VĂN: đây là
    -- LỜI KHAI của máy, không phải phán quyết của server. Server chỉ so sánh rồi
    -- gắn cờ ở "configVersionStatus" — sự thật gốc phải giữ nguyên để audit.
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "pointsConfigVersion" integer;
    -- 'current' = khớp product_models."pointsConfigVersion" lúc nhận
    -- 'stale'   = máy khai version CŨ HƠN ⇒ board này chấm bằng ngưỡng lỗi thời
    --             (KHÔNG chặn — QĐ#3 nhận-và-gắn-cờ; đây là tín hiệu để ops đẩy sync)
    -- 'ahead'   = máy khai version MỚI HƠN server ⇒ bất thường (rollback cấu hình,
    --             máy nói dối, hoặc DB bị khôi phục về bản cũ) — phải nhìn thấy được
    -- 'unknown' = máy KHÔNG khai, hoặc không resolve được product model
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "configVersionStatus" varchar(20);

    cols_ok := true;
    RAISE NOTICE '[0275] product_inspections: +serverReceivedAt/timeSkewSeconds/clockSkewFlagged/timeSource/idempotencyKey/pointsConfigVersion/configVersionStatus.';
  EXCEPTION WHEN OTHERS THEN
    cols_ok := false;
    err_detail := 'ADD COLUMN failed: ' || SQLERRM;
    RAISE WARNING '[0275] ADD COLUMN trên product_inspections FAILED (%) — provenance/skew/version KHÔNG được ghi; app fail-open (ingest chạy như cũ, KHÔNG hồi quy) nhưng CASE #3 + CASE #12 VẪN HỞ. Nguyên nhân thường gặp: hypertable có chunk NÉN (0271) trên TimescaleDB cũ. Khắc phục: decompress_chunk() rồi re-apply 0275 (idempotent).', SQLERRM;
  END;

  -- ── (b) Ledger idempotency-key. BẢNG THƯỜNG — CỐ Ý.
  --    KHÔNG BAO GIỜ chuyển bảng này thành hypertable: toàn bộ giá trị của nó nằm ở
  --    PK ("machineId","idempotencyKey") KHÔNG chứa cột thời gian — thứ mà hypertable
  --    cấm (xem header). Hypertable-hoá = vô hiệu hoá chống-trùng.
  BEGIN
    CREATE TABLE IF NOT EXISTS "inspection_idempotency_keys" (
      "machineId"      integer      NOT NULL,
      "idempotencyKey" varchar(200) NOT NULL,
      -- inspection mà khoá này đã sinh ra. NULL chỉ tồn tại BÊN TRONG transaction
      -- đang claim (claim → insert header → update). Một row ĐÃ COMMIT mà còn NULL
      -- ⇒ bất biến bị vi phạm; app NÉM lỗi (transient → WAL đệm), không bịa id.
      "inspectionId"   integer,
      -- Bản sao inspectionTime của header: để retention prune ledger theo cùng
      -- chân trời với product_inspections (365d, doc 48 R3) mà không phải join
      -- ngược vào hypertable.
      "inspectionTime" timestamp,
      "createdAt"      timestamp    NOT NULL DEFAULT now(),
      PRIMARY KEY ("machineId", "idempotencyKey")
    );
    -- Prune theo tuổi (retention). KHÔNG có index này thì việc dọn ledger phải
    -- seq-scan toàn bảng.
    CREATE INDEX IF NOT EXISTS "idx_inspection_idem_created"
      ON "inspection_idempotency_keys" ("createdAt");
    ledger_ok := true;
    RAISE NOTICE '[0275] inspection_idempotency_keys in force — retry KHÔNG kèm inspectionTime giờ đã idempotent.';
  EXCEPTION WHEN OTHERS THEN
    ledger_ok := false;
    err_detail := err_detail || CASE WHEN err_detail = '' THEN '' ELSE ' | ' END
                  || 'ledger failed: ' || SQLERRM;
    RAISE WARNING '[0275] inspection_idempotency_keys creation FAILED (%) — submission có idempotencyKey KHÔNG được chống-trùng; app fail-open về đúng hành vi 0272 (chỉ natural key). Re-apply 0275 sau khi khắc phục.', SQLERRM;
  END;

  -- ── (c) db_feature_status cho ops/dashboards.
  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'inspection_provenance',
    CASE WHEN cols_ok AND ledger_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN cols_ok AND ledger_ok THEN
        'product_inspections provenance columns (serverReceivedAt, timeSkewSeconds, clockSkewFlagged, timeSource, idempotencyKey, pointsConfigVersion, configVersionStatus) + inspection_idempotency_keys ledger in force. '
        'Legacy rows keep NULL (never backfilled — no honest source). '
        'LIMIT 1: dedup by idempotencyKey only covers machines that actually SEND one; machines that send neither idempotencyKey nor inspectionTime remain unprotected by design. '
        'LIMIT 2: the ledger is NOT pruned by any retention job yet — it grows ~1 row per submission that carries a key (doc 51 P1 report, follow-up owner: dataRetentionService). '
        'LIMIT 3: inspectionTime is still stored "fake-UTC" shifted (process-TZ dependent, see processInspectionSubmission) — 0275 MEASURES the skew, it does NOT change how time is stored. Cutover is a separate migration.'
      ELSE
        err_detail || ' — 0275 partially applied (cols_ok=' || cols_ok || ', ledger_ok=' || ledger_ok || '). App is fail-open: ingest keeps working with 0272-level protection only. Remediate and re-apply drizzle/0275 (idempotent).'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
