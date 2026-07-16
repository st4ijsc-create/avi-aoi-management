-- doc 51 P1 (QĐ#2) — SPEC-GATE CONFIG-VERSION TRACE: product_inspections."gateConfigVersion".
--
-- ════════════════════════════════════════════════════════════════════════════
-- VẤN ĐỀ (doc 51 CASE #12 / QĐ#2 — SPLIT-BRAIN chấm-lại):
--   Spec-gate phía server (pointResultEvaluator) có thể HẠ máy-"OK" → "NG" khi một
--   ngưỡng cấu hình bị vi phạm. Nhưng nó đọc ngưỡng LIVE — ngưỡng HIỆN TẠI trong DB.
--   Một board do máy chấm dưới recipe CŨ (máy khai pointsConfigVersion=V, sản phẩm
--   nay đã sang version mới hơn) rồi bị đệm/replay/chấm-lại sẽ bị gate theo ngưỡng
--   MỚI (thường siết chặt hơn) → board máy đã cho PASS bị server hạ NG oan. OK/NG
--   thôi phản ánh cấu hình board THẬT SỰ được đo dưới.
--
--   QĐ#2 chốt: chấm theo SNAPSHOT ĐÚNG VERSION MÁY KHAI, KHÔNG theo limit LIVE.
--   0276 thêm cột GHI LẠI gate đã dùng version nào cho từng board → truy vết được,
--   hết "split-brain mù". Cưỡng chế bật/tắt qua cờ app SPEC_GATE_SNAPSHOT_ENABLED
--   (mặc định TẮT = giữ nguyên hành vi gate-theo-LIVE hiện tại; QĐ#1).
--
-- GHI GÌ VÀO "gateConfigVersion":
--   • cờ TẮT, hoặc board 'current'/'ahead'/'unknown'  → version LIVE mà gate đã dùng
--     (product_models."pointsConfigVersion" lúc nhận). Một row có gateConfigVersion
--     KHÁC pointsConfigVersion (máy khai) trong khi configVersionStatus='stale' cho
--     biết board CŨ đã bị chấm theo LIVE — chính là split-brain, nay NHÌN THẤY được.
--   • cờ BẬT và board 'stale'                          → version MÁY KHAI (declared).
--     Gate đã tái dựng ngưỡng theo lịch sử snapshot (measurement_point_versions) tại
--     mốc server nhận board, thay vì theo LIVE.
--   NULL = row trước 0276, hoặc board không có product model / không khai version →
--   "không biết gate dùng version nào" — đó là sự thật, KHÔNG backfill.
--
-- ĐẶC TÍNH:
--   • MỘT cột NULLABLE, KHÔNG default, KHÔNG backfill, KHÔNG index (metadata-only
--     ADD COLUMN — không rewrite bảng, an toàn trên hypertable 23k lẫn 100M row).
--     product_inspections là bảng NÓNG NHẤT (100 máy × 1/s, QĐ#7): mỗi index là thuế
--     trên MỌI insert; truy vấn "board nào bị gate theo version nào" là báo cáo
--     off-peak (seq scan chấp nhận được), chưa đáng một index.
--   • App ghi cột này bằng câu UPDATE RIÊNG best-effort (drizzle table type chưa có
--     cột — nằm ngoài vùng sửa của P1 này) SAU khi header + measurement đã commit;
--     cột THIẾU (0276 chưa áp) ⇒ app nuốt lỗi + tắt thử lại, ingest KHÔNG hồi quy.
--   • GUARDED: BEGIN/EXCEPTION + ghi db_feature_status (pattern 0172/0272/0274/0275).
--     Fail ⇒ WARNING loud + 'partial', KHÔNG đánh fail cả lượt migrate.
--
--   ⚠ GIỚI HẠN ĐÃ BIẾT (doc 51 P1 report): measurement_point_versions ghi lịch sử
--     sửa THEO TỪNG ĐIỂM (cột version là bộ đếm per-point) kèm changedAt — KHÔNG ghi
--     product_models."pointsConfigVersion" tại mỗi lần sửa. Vì vậy KHÔNG có ánh xạ
--     lưu-sẵn từ product-version V → snapshot chính xác. App tái dựng ngưỡng theo
--     MỐC THỜI GIAN server nhận board (xấp xỉ tốt nhất KHÔNG cần đổi schema): đóng
--     đúng ca "ngưỡng bị SIẾT sau khi board đã đo" (board còn bay/đệm/chấm-lại). Tái
--     dựng version-V TUYỆT ĐỐI cho máy trễ nhiều đời cần đổi schema (ghi product
--     version vào mỗi snapshot row, hoặc bảng lịch sử product-config-version) — VIỆC
--     NGOÀI VÙNG, xem báo cáo.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0276 (0275 = inspection_provenance).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

DO $$
DECLARE
  col_ok     boolean := false;
  err_detail text := '';
BEGIN
  BEGIN
    -- Version cấu hình mà SPEC-GATE đã dùng để chấm board này. Xem header cho ngữ nghĩa.
    ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "gateConfigVersion" integer;
    col_ok := true;
    RAISE NOTICE '[0276] product_inspections."gateConfigVersion" in force — spec-gate version giờ truy vết được.';
  EXCEPTION WHEN OTHERS THEN
    col_ok := false;
    err_detail := 'ADD COLUMN failed: ' || SQLERRM;
    RAISE WARNING '[0276] ADD COLUMN "gateConfigVersion" trên product_inspections FAILED (%) — spec-gate version KHÔNG được ghi; app fail-open (câu UPDATE best-effort nuốt lỗi, ingest chạy như cũ, KHÔNG hồi quy). Nguyên nhân thường gặp: hypertable có chunk NÉN (0271) trên TimescaleDB cũ. Khắc phục: decompress_chunk() rồi re-apply 0276 (idempotent).', SQLERRM;
  END;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'spec_gate_config_version',
    CASE WHEN col_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN col_ok THEN
        'product_inspections."gateConfigVersion" in force. Records which pointsConfigVersion the server spec-gate used per board (declared version under SPEC_GATE_SNAPSHOT_ENABLED + stale; else the LIVE version). Legacy rows keep NULL (never backfilled). '
        'LIMIT: measurement_point_versions has no stored product-version→snapshot mapping, so the snapshot re-grade anchors on the board''s server-received INSTANT (closes the "limit tightened after the board was measured" case); exact per-declared-version reconstruction for machines lagging many edits needs a schema change (doc 51 P1 report).'
      ELSE
        err_detail || ' — 0276 not applied. App is fail-open: spec-gate still runs, only the gateConfigVersion trace column is missing. Remediate and re-apply drizzle/0276 (idempotent).'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
