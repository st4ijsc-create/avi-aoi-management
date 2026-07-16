-- doc 51 P0 (R2) — product_inspections ingest idempotency (unique natural key).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (doc 51, rủi ro R2 ĐÃ TỰ-KIỂM-CHỨNG): product_inspections KHÔNG có
-- unique key nào. Máy AVI/AOI retry một board (ACK timeout, agent restart, WAL
-- replay đua với live retry) → ghi THÊM một row → ĐẾM TRÙNG:
--   • production_orders.completedQuantity +2 cho 1 board
--   • yield/FPY sai, ERP outbox bắn 2 lần, cảnh báo NG nổ 2 lần vào mặt operator
--
-- Natural key = ("machineId", "serialNumber", "inspectionTime") — đúng bộ khoá mà
-- inspectionAlreadyPersisted() (server/routers/machineApiRouters.ts) + WAL dedup
-- ĐANG dùng; migration này chỉ nâng nó từ "kiểm tra ở tầng app" (có TOCTOU race)
-- lên "ràng buộc ở DB" (không thể lách).
--
-- LÀM GÌ:
--   (a) ĐẾM duplicate hiện hữu — KHÔNG XOÁ. Khác 0247 (ot_telemetry) ở chỗ:
--       product_inspections là DỮ LIỆU CHẤT LƯỢNG có con (measurement_results,
--       FK ON DELETE CASCADE của 0180) + ý nghĩa audit. Xoá tự động trong
--       migration là phá dữ liệu sản xuất → migration CHỈ báo cáo, ops quyết định.
--       (QĐ#3 doc 51: "nhận-và-gắn-cờ, không từ chối cứng" — không tự ý huỷ.)
--   (b) CREATE UNIQUE INDEX IF NOT EXISTS partial trên
--       ("machineId", "serialNumber", "inspectionTime") WHERE "serialNumber" <> ''.
--       • Cột partition `inspectionTime` NẰM TRONG index → hợp lệ CẢ trên plain PG
--         lẫn Timescale hypertable (0172: mọi unique index phải chứa cột partition).
--         inspectionTime bằng nhau ⇒ CÙNG chunk ⇒ unique là TOÀN CỤC, không phải
--         per-chunk.
--       • PARTIAL (serialNumber <> ''): MIỄN unique cho row serial rỗng (dữ liệu
--         cũ). Ingest mới không tạo được nữa (zod .trim().min(1) ở submitInspection).
--   (c) GUARDED: mọi bước bọc BEGIN/EXCEPTION + ghi db_feature_status (pattern
--       0172/0247). Fail ⇒ WARNING loud + 'partial', KHÔNG đánh fail cả lượt migrate.
--
-- ⚠ CHUNK ĐÃ NÉN: 0271 (doc 48 R3) đã BẬT columnstore compression trên
--   product_inspections (compress_after 30 ngày). CREATE INDEX trên hypertable có
--   chunk nén có thể fail tuỳ version TimescaleDB → khối EXCEPTION ghi 'partial'.
--   Khắc phục: decompress_chunk() các chunk liên quan (hoặc chờ retention 365d dọn),
--   rồi re-apply migration này (idempotent, IF NOT EXISTS).
--
-- ⚠ CHI PHÍ trên bảng LỚN: CREATE UNIQUE INDEX (không CONCURRENTLY được — cả vì
--   nằm trong khối DO/transaction, lẫn vì Timescale hạn chế CONCURRENTLY trên
--   hypertable) giữ lock SHARE → CHẶN GHI trong lúc build. product_inspections là
--   bảng nóng nhất của hệ → CHẠY OFF-PEAK / trong cửa sổ bảo trì.
--
-- ⚠ GIỚI HẠN ĐÃ BIẾT (doc 51 P1 sẽ đóng): khoá dựa trên inspectionTime DO MÁY GỬI.
--   Máy KHÔNG gửi inspectionTime → server đóng dấu now() ở mỗi lần nhận → mỗi retry
--   một timestamp khác → index này KHÔNG bắt được. Chỉ idempotencyKey tường minh
--   trong hợp đồng máy (P1) mới đóng nốt phần đó.
--
-- App-side: server/db/inspection.ts createProductInspection chuyển sang
-- ON CONFLICT DO NOTHING + resolve row cũ, và processInspectionSubmission
-- SHORT-CIRCUIT khi trùng (không đụng completedQuantity / outbox / NG alert /
-- measurement_results). Khi index CHƯA tồn tại → ON CONFLICT DO NOTHING là no-op
-- vô hại (không đổi hành vi cũ).
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0272 (0271 = timescale_hardening).
-- ════════════════════════════════════════════════════════════════════════════

-- Bảng trạng thái ops-visible (đã có từ 0172; tạo lại an toàn nếu môi trường mới).
CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  dup_groups bigint := 0;   -- số bộ (machineId, serialNumber, inspectionTime) bị lặp
  dup_rows   bigint := 0;   -- số row THỪA (tổng - 1 mỗi bộ) = số lần đếm trùng
  index_ok   boolean := false;
  err_detail text := '';
BEGIN
  -- ── (a) ĐO duplicate hiện hữu (chỉ đọc — không xoá gì).
  BEGIN
    SELECT count(*), COALESCE(sum(c - 1), 0)
      INTO dup_groups, dup_rows
      FROM (
        SELECT count(*) AS c
          FROM product_inspections
         WHERE "serialNumber" <> ''
         GROUP BY "machineId", "serialNumber", "inspectionTime"
        HAVING count(*) > 1
      ) d;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[0272] không đếm được duplicate product_inspections (%) — vẫn thử tạo unique index.', SQLERRM;
  END;

  IF dup_groups > 0 THEN
    RAISE WARNING '[0272] product_inspections ĐANG CÓ % bộ ("machineId","serialNumber","inspectionTime") trùng (% row thừa) — mỗi row thừa là MỘT LẦN ĐẾM TRÙNG đã lọt vào yield/completedQuantity. UNIQUE INDEX sẽ FAIL cho tới khi ops dọn. Xem xét thủ công trước khi xoá (measurement_results là con, FK CASCADE 0180):
  -- 1) SOI:    SELECT "machineId","serialNumber","inspectionTime", count(*), array_agg(id ORDER BY id)
  --              FROM product_inspections WHERE "serialNumber" <> ''
  --             GROUP BY 1,2,3 HAVING count(*) > 1;
  -- 2) DỌN (GIỮ id NHỎ NHẤT = bản gốc, CHẠY CÓ BACKUP, OFF-PEAK):
  --            DELETE FROM product_inspections a USING product_inspections b
  --             WHERE a."serialNumber" <> '''' AND b."machineId" = a."machineId"
  --               AND b."serialNumber" = a."serialNumber" AND b."inspectionTime" = a."inspectionTime"
  --               AND b.id < a.id;
  -- 3) RE-APPLY drizzle/0272 (idempotent).', dup_groups, dup_rows;
  END IF;

  -- ── (b) UNIQUE INDEX (partial). Thử kể cả khi (a) lỗi/có dup — EXCEPTION bắt trọn:
  --        có dup ⇒ fail sạch, ghi 'partial'; chunk nén ⇒ fail sạch, ghi 'partial'.
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_inspections_machine_serial_time"
      ON product_inspections ("machineId", "serialNumber", "inspectionTime")
      WHERE "serialNumber" <> '';
    index_ok := true;
    RAISE NOTICE '[0272] uq_inspections_machine_serial_time in force — retry ingest giờ idempotent ở tầng DB.';
  EXCEPTION WHEN OTHERS THEN
    index_ok   := false;
    err_detail := 'unique index failed: ' || SQLERRM;
    RAISE WARNING '[0272] uq_inspections_machine_serial_time creation FAILED (%) — product_inspections VẪN CHƯA có chống-trùng ở DB; ON CONFLICT DO NOTHING phía app trở thành no-op (hành vi = như cũ, KHÔNG hồi quy). Nguyên nhân thường gặp: (1) duplicate còn tồn (xem WARNING ở trên), (2) hypertable có chunk NÉN (0271). Khắc phục rồi re-apply 0272.', SQLERRM;
  END;

  -- ── (c) Ghi kết quả vào db_feature_status (pattern 0172/0247) cho ops/dashboards.
  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'inspection_ingest_idempotency',
    CASE WHEN index_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN index_ok THEN
        'unique index uq_inspections_machine_serial_time ("machineId","serialNumber","inspectionTime") WHERE "serialNumber" <> '''' in force. Machine retries are idempotent (ON CONFLICT DO NOTHING + short-circuit); ' || dup_groups || ' pre-existing duplicate group(s) found at apply time. LIMIT: only covers submissions that CARRY inspectionTime — doc 51 P1 (explicit idempotencyKey) closes the rest.'
      ELSE
        err_detail || ' — ' || dup_groups || ' duplicate group(s) / ' || dup_rows || ' surplus row(s) present. Remediate (dedupe / decompress chunks) and re-apply drizzle/0272. Rows with empty "serialNumber" are exempt from the key by design.'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
