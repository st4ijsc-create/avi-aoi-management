-- doc 51 P2 batch-2 (§12.2 #2) — VERSION-EXACT SPEC-GATE provenance:
--   measurement_point_versions."productPointsConfigVersion".
--
-- ════════════════════════════════════════════════════════════════════════════
-- VẤN ĐỀ (nối tiếp QĐ#2 / 0276):
--   P1 (0276) chấm spec-gate theo MỐC THỜI GIAN server nhận board vì
--   measurement_point_versions.version là bộ đếm PER-POINT, KHÔNG ánh xạ tới
--   product_models."pointsConfigVersion" (version SẢN PHẨM mà máy khai). Cách theo
--   instant đóng đúng ca "ngưỡng bị SIẾT sau khi board đã đo", nhưng KHÔNG tái dựng
--   được ngưỡng THEO ĐÚNG version máy khai khi máy trễ nhiều đời cấu hình.
--
--   0282 thêm cột GHI product-version tại mỗi snapshot: khi một điểm được sửa,
--   snapshot (trạng thái TRƯỚC khi sửa) được đóng dấu bằng
--   product_models."pointsConfigVersion" ĐANG HIỆU LỰC lúc sửa — tức version CUỐI
--   CÙNG mà ngưỡng-trước-khi-sửa còn sống. Nhờ đó, khi máy khai pointsConfigVersion=V,
--   spec-gate tìm snapshot có productPointsConfigVersion NHỎ NHẤT >= V (đúng version
--   máy dùng) thay vì theo instant. Thiếu dấu (row cũ trước 0282) ⇒ fall back về
--   instant-based HIỆN CÓ (KHÔNG hồi quy P1).
--
-- GHI GÌ VÀO "productPointsConfigVersion":
--   • App (updateMeasurementPointDef) đọc product_models."pointsConfigVersion" hiện
--     tại TRONG cùng transaction ghi snapshot, và đóng dấu vào cột này = version mà
--     ngưỡng-cũ (snapshotJson) còn sống tới. Version SẢN PHẨM được bump (+1) NGAY SAU
--     bởi router (bumpAndNotify / POINTS_PUSH), nên dấu = "version cuối cùng ngưỡng cũ
--     còn hiệu lực". Spec-gate: snapshot NHỎ NHẤT có dấu >= V phủ đúng version V.
--   NULL = row snapshot trước 0282, hoặc cột chưa áp (app fail-open, bỏ dấu) →
--     "không biết version" — sự thật, KHÔNG backfill. Gate tự fall back instant-based.
--
-- ĐẶC TÍNH:
--   • MỘT cột NULLABLE, KHÔNG default, KHÔNG backfill, KHÔNG index. Bảng
--     measurement_point_versions là bảng lịch sử sửa điểm-đo (ghi khi kỹ sư/máy sửa,
--     tần suất THẤP — KHÔNG phải bảng nóng ingest), nên ADD COLUMN metadata-only là
--     an toàn; truy vấn version-exact dùng idx_point_versions_point sẵn có + lọc theo
--     productPointsConfigVersion trong bộ nhớ (mỗi điểm có ít snapshot).
--   • App ghi cột này qua drizzle insert CÓ ĐIỀU KIỆN: chỉ đưa cột vào values khi
--     đã dò thấy cột tồn tại (information_schema probe, cache). Cột THIẾU ⇒ app bỏ
--     dấu, ghi snapshot như cũ, version-gate fall back instant — KHÔNG GÃY insert.
--   • GUARDED: BEGIN/EXCEPTION + ghi db_feature_status (pattern 0275/0276/0281).
--     Fail ⇒ WARNING loud + 'partial', KHÔNG đánh fail cả lượt migrate.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0282 (0281 = ingest_hardening_p2).
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
    -- product-version mà ngưỡng-cũ (snapshotJson) còn sống tới. Xem header cho ngữ nghĩa.
    ALTER TABLE measurement_point_versions
      ADD COLUMN IF NOT EXISTS "productPointsConfigVersion" integer;
    col_ok := true;
    RAISE NOTICE '[0282] measurement_point_versions."productPointsConfigVersion" in force — version-exact spec-gate giờ tái dựng được theo version máy khai.';
  EXCEPTION WHEN OTHERS THEN
    col_ok := false;
    err_detail := 'ADD COLUMN failed: ' || SQLERRM;
    RAISE WARNING '[0282] ADD COLUMN "productPointsConfigVersion" trên measurement_point_versions FAILED (%) — version-exact gate KHÔNG kích hoạt; app fail-open (bỏ dấu, spec-gate fall back instant-based như P1, KHÔNG hồi quy).', SQLERRM;
  END;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'mp_version_config_provenance',
    CASE WHEN col_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN col_ok THEN
        'measurement_point_versions."productPointsConfigVersion" in force. Stamps the product pointsConfigVersion that the pre-edit limits (snapshotJson) were live UNDER, so the spec-gate can reconstruct limits by the machine-declared version V (smallest stamp >= V) instead of by the server-received instant. '
        'Legacy snapshot rows keep NULL (never backfilled) → the gate falls back to the instant-based reconstruction (0276/P1) for them, no regression. '
        'Written by updateMeasurementPointDef only when this column is detected present (information_schema probe, cached); absent ⇒ stamp omitted, ingest/edit fail-open. '
        'Version-exact gating stays behind SPEC_GATE_SNAPSHOT_ENABLED (default OFF) and engages only for STALE boards.'
      ELSE
        err_detail || ' — 0282 not applied. App is fail-open: spec-gate still runs (instant-based, P1); only the version-exact provenance column is missing. Remediate and re-apply drizzle/0282 (idempotent).'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
