-- doc 44 W0-D / G2.9 — ot_telemetry replay idempotency (dedupe + unique natural key).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: ot_telemetry (kho telemetry canonical duy nhất) KHÔNG có unique key →
-- một replay (store-forward backfill sau crash, reader retry, edge re-send) nhân
-- đôi dữ liệu. Natural key = ("deviceId", metric, ts) — khớp ngữ nghĩa natural key
-- của store-forward (adapterId|tag|ts; với OT sample deviceId = adapter.code và
-- metric = tagKey, xem server/services/ot/ingest.ts + storeForward.ts).
--
-- LÀM GÌ:
--   (a) DEDUPE trước: xoá các bản ghi trùng (deviceId, metric, ts), GIỮ id LỚN NHẤT
--       (bản mới nhất). Row có deviceId NULL không đụng tới.
--   (b) CREATE UNIQUE INDEX IF NOT EXISTS trên ("deviceId", metric, ts).
--       • Cột partition `ts` NẰM TRONG index → hợp lệ CẢ trên plain PG lẫn
--         Timescale hypertable (0172 yêu cầu partition column trong mọi unique index).
--       • Row deviceId NULL được MIỄN unique (PG NULLS DISTINCT mặc định) — cố ý:
--         hai reader chưa map deviceId không được phép va nhau trên (metric, ts).
--   (c) GUARDED: cả (a) lẫn (b) bọc BEGIN/EXCEPTION — trên hypertable có CHUNK ĐÃ
--       NÉN (compression 0172/0118), DELETE/CREATE INDEX có thể fail tuỳ version
--       Timescale → ghi 'partial' vào db_feature_status + WARNING (loud, greppable),
--       KHÔNG đánh fail cả lượt migrate (pattern 0172). Sau khi decompress/retention
--       dọn chunk nén, re-apply migration này (idempotent).
--
-- ⚠ CHI PHÍ trên bảng LỚN: bước DEDUPE là self-join DELETE — trên bảng hàng trăm
--   triệu row hãy chạy off-peak + có backup; index idx_ot_telemetry_metric_ts hỗ
--   trợ một phần. CREATE UNIQUE INDEX cũng scan toàn bảng (không CONCURRENTLY được
--   trong migration transaction). Với DB production volume cao: cân nhắc chạy tay
--   CREATE UNIQUE INDEX CONCURRENTLY ngoài giờ rồi re-apply (IF NOT EXISTS bỏ qua).
--
-- App-side: telemetryBus persistRows (main-DB fallback) chuyển sang
-- ON CONFLICT DO NOTHING → replay idempotent một khi index này tồn tại; khi index
-- CHƯA tồn tại, ON CONFLICT DO NOTHING là no-op vô hại (không đổi hành vi).
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0247 (0246 = command_correlation_deadline).
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
  dup_count  bigint := 0;
  dedupe_ok  boolean := true;
  index_ok   boolean := true;
  err_detail text := '';
BEGIN
  -- ── (a) DEDUPE: giữ id lớn nhất (bản ghi mới nhất) cho mỗi (deviceId, metric, ts).
  --        Self-join theo id (KHÔNG dùng ctid — ctid không ổn định trên hypertable
  --        nhiều chunk). Chỉ đụng row có deviceId NOT NULL (đúng phạm vi unique key).
  BEGIN
    DELETE FROM ot_telemetry a
      USING ot_telemetry b
      WHERE a."deviceId" IS NOT NULL
        AND b."deviceId" = a."deviceId"
        AND b."metric"   = a."metric"
        AND b."ts"       = a."ts"
        AND b."id"       > a."id";
    GET DIAGNOSTICS dup_count = ROW_COUNT;
    IF dup_count > 0 THEN
      RAISE NOTICE '[0247] deduped % duplicate ot_telemetry row(s) — kept the newest id per ("deviceId", metric, ts)', dup_count;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    dedupe_ok  := false;
    err_detail := 'dedupe failed: ' || SQLERRM;
    RAISE WARNING '[0247] ot_telemetry dedupe FAILED (%) — likely compressed hypertable chunks (0172 compression). Decompress the affected chunks (or let retention drop them), then re-apply this migration.', SQLERRM;
  END;

  -- ── (b) UNIQUE INDEX — chỉ thử khi dedupe thành công (còn duplicate ⇒ chắc chắn fail).
  IF dedupe_ok THEN
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_ot_telemetry_device_metric_ts"
        ON ot_telemetry ("deviceId", "metric", "ts");
    EXCEPTION WHEN OTHERS THEN
      index_ok   := false;
      err_detail := 'unique index failed: ' || SQLERRM;
      RAISE WARNING '[0247] uq_ot_telemetry_device_metric_ts creation FAILED (%) — ot_telemetry has NO replay guard yet; the app-side ON CONFLICT DO NOTHING is then inert. Fix the cause (compressed chunks / duplicates) and re-apply.', SQLERRM;
    END;
  ELSE
    index_ok := false;
  END IF;

  -- ── (c) Ghi kết quả vào db_feature_status (pattern 0172) để ops/dashboards thấy.
  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'ot_telemetry_idempotency',
    CASE WHEN dedupe_ok AND index_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN dedupe_ok AND index_ok THEN
        'unique index uq_ot_telemetry_device_metric_ts ("deviceId", metric, ts) in force; ' || dup_count || ' duplicate row(s) removed. Replays are idempotent (ON CONFLICT DO NOTHING).'
      ELSE
        err_detail || ' — re-apply drizzle/0247 after remediation. Rows with NULL "deviceId" are always exempt from the unique key by design.'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
