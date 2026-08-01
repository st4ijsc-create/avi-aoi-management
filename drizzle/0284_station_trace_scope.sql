-- doc 51 P3 batch-2 (CASE #8) — station_traces genealogy SCOPE:
--   replace UNIQUE("serialNumber") with UNIQUE("serialNumber","productModelId").
--
-- ════════════════════════════════════════════════════════════════════════════
-- VẤN ĐỀ (doc 51 §12.3 CASE #8):
--   station_traces là bảng TỔNG-HỢP 1-row-mỗi-serial (per-serial genealogy: một
--   board đi qua SPI → AOI_PRE → REFLOW → AOI_POST → AXI → ICT → FCT). 0094 khoá
--   UNIQUE("serialNumber") THUẦN. Nhưng serial chỉ duy nhất TRÊN-MỖI-SẢN-PHẨM ở
--   dây chuyền EMS: HAI board KHÁC model có thể mang cùng serial in, và serial quét
--   lỗi / firmware-default có thể RỖNG. Dưới khoá serial-thuần, các đơn vị vật lý
--   KHÁC NHAU này GỘP vào MỘT row: stations/defects/escapes của board này ghi đè
--   board kia → genealogy + escape analytics trộn lẫn hai đơn vị mà không báo.
--
-- LÀM GÌ:
--   (a) ĐẾM duplicate ("serialNumber","productModelId") đang có — KHÔNG XOÁ. Vì khoá
--       CŨ là UNIQUE(serialNumber), về lý thuyết KHÔNG thể có bộ trùng mới; đếm vẫn
--       giữ để phòng env lạ + theo pattern 0274 (QĐ#3: nhận-và-gắn-cờ, không từ chối).
--   (b) DROP CONSTRAINT/INDEX "uq_station_traces_serial" (0094 tạo là CONSTRAINT;
--       drop cả constraint lẫn index cho chắc — env có thể khác nhau).
--   (c) CREATE UNIQUE INDEX composite ("serialNumber","productModelId").
--   (d) GUARDED: mọi bước bọc BEGIN/EXCEPTION + ghi db_feature_status (pattern
--       0274/0282). Fail ⇒ WARNING loud + 'partial', KHÔNG đánh fail cả lượt migrate.
--
-- ⚠ NULL "productModelId": Postgres coi NULL là PHÂN BIỆT trong unique index (NULLS
--   DISTINCT mặc định) → hai board serial trùng + model NULL VẪN cho phép 2 row. Đây
--   là giới hạn THẬT: không có gì để tách chúng. App (upsertStationTrace) khớp
--   null-safe (IS NOT DISTINCT FROM) nên MỘT board model-NULL vẫn giữ 1 row; hai
--   board model-NULL cùng serial vẫn gộp (không thể phân biệt). Caller nào biết
--   productModelId (stationTriangulationRouter) nên luôn truyền để tách đúng.
--
-- App-side (an toàn CẢ KHI index không tạo được):
--   • upsertStationTrace SELECT-then-write theo (serialNumber, productModelId)
--     null-safe + BỎ QUA serial rỗng. Index vắng ⇒ hành vi y hệt (app tự scope);
--     index có ⇒ DB cưỡng chế thêm cho row có-model. KHÔNG hồi quy.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0284 (0283 = machine_enrollment).
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
  dup_groups bigint  := 0;   -- số bộ ("serialNumber","productModelId") bị lặp
  dup_rows   bigint  := 0;   -- số row THỪA (tổng - 1 mỗi bộ)
  dropped_ok boolean := false;
  index_ok   boolean := false;
  err_detail text    := '';
BEGIN
  -- ── (a) ĐO duplicate hiện hữu (chỉ đọc — không xoá gì). productModelId NULL được
  --        gom chung một nhóm ở đây (GROUP BY coi NULL bằng nhau) — chỉ để CẢNH BÁO;
  --        unique index thật vẫn NULLS DISTINCT (xem header).
  BEGIN
    SELECT count(*), COALESCE(sum(c - 1), 0)
      INTO dup_groups, dup_rows
      FROM (
        SELECT count(*) AS c
          FROM station_traces
         WHERE btrim(COALESCE("serialNumber", '')) <> ''
         GROUP BY "serialNumber", "productModelId"
        HAVING count(*) > 1
      ) d;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[0284] không đếm được duplicate station_traces (%) — vẫn thử rebuild unique.', SQLERRM;
  END;

  IF dup_groups > 0 THEN
    RAISE WARNING '[0284] station_traces ĐANG CÓ % bộ ("serialNumber","productModelId") trùng (% row thừa). UNIQUE INDEX composite sẽ FAIL cho tới khi gộp. KHÔNG xoá mù — station_traces là tổng-hợp genealogy, chọn nhầm row-giữ mất lịch sử stations/escapes. Gộp thủ công (chọn row lastSeenAt mới nhất, hợp nhất stationsTouched/summary) rồi re-apply drizzle/0284.', dup_groups, dup_rows;
  END IF;

  -- ── (b) DROP khoá serial-thuần cũ (0094 tạo là CONSTRAINT). Drop cả constraint
  --        lẫn index phòng env khác nhau.
  BEGIN
    ALTER TABLE station_traces DROP CONSTRAINT IF EXISTS "uq_station_traces_serial";
    DROP INDEX IF EXISTS "uq_station_traces_serial";
    dropped_ok := true;
    RAISE NOTICE '[0284] uq_station_traces_serial (serial-thuần) đã gỡ.';
  EXCEPTION WHEN OTHERS THEN
    dropped_ok := false;
    err_detail := 'drop old unique failed: ' || SQLERRM;
    RAISE WARNING '[0284] gỡ uq_station_traces_serial FAILED (%) — khoá serial-thuần CŨ còn nguyên; composite sẽ không tạo được cạnh nó. App vẫn scope đúng (SELECT-then-write), nhưng insert board thứ 2 cùng serial khác model sẽ bị khoá cũ CHẶN. Khắc phục rồi re-apply.', SQLERRM;
  END;

  -- ── (c) UNIQUE INDEX composite (serialNumber, productModelId). Chỉ thử khi đã gỡ
  --        được khoá cũ (nếu còn thì tạo composite là dư thừa/không giải quyết gì).
  IF dropped_ok THEN
    BEGIN
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_station_traces_serial_model"
        ON station_traces ("serialNumber", "productModelId");
      index_ok := true;
      RAISE NOTICE '[0284] uq_station_traces_serial_model in force — 2 board khác model cùng serial không còn gộp.';
    EXCEPTION WHEN OTHERS THEN
      index_ok   := false;
      err_detail := 'composite unique index failed: ' || SQLERRM;
      RAISE WARNING '[0284] uq_station_traces_serial_model creation FAILED (%) — DB CHƯA cưỡng chế scope; app-side vẫn scope theo (serial, model) nên KHÔNG hồi quy. Nguyên nhân thường gặp: duplicate còn tồn (xem WARNING trên). Gộp rồi re-apply 0284.', SQLERRM;
    END;
  END IF;

  -- ── (d) Ghi kết quả vào db_feature_status (pattern 0274/0282) cho ops/dashboards.
  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'station_trace_scope',
    CASE WHEN dropped_ok AND index_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN dropped_ok AND index_ok THEN
        'unique index uq_station_traces_serial_model ("serialNumber","productModelId") in force (old serial-only UNIQUE dropped). Two boards sharing a printed serial but on different product models no longer collapse into one trace. ' || dup_groups || ' pre-existing duplicate group(s) at apply time. LIMIT: rows with NULL "productModelId" are NULLS-DISTINCT (Postgres default) → two blank-model boards with the same serial can still coexist; upsertStationTrace matches them null-safe and skips blank serials.'
      ELSE
        COALESCE(NULLIF(err_detail, ''), 'ok') || '; old constraint dropped=' || CASE WHEN dropped_ok THEN 'yes' ELSE 'NO' END ||
        ', composite index=' || CASE WHEN index_ok THEN 'yes' ELSE 'NO' END ||
        ' — ' || dup_groups || ' live duplicate group(s) / ' || dup_rows || ' surplus row(s). App still scopes by (serial, model) in upsertStationTrace (no regression). Merge duplicates and re-apply drizzle/0284.'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
