-- doc 51 P1/P2 (R4) — measurement_point_defs integrity: live-code uniqueness + tombstone version.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh (doc 51 §5.2 P2 + CASE #4). HAI thay đổi, cùng một bảng:
--
-- (1) UNIQUE (partial) ("productModelId", "code") WHERE "deletedAt" IS NULL
--     createMeasurementPointDef là plain INSERT, KHÔNG có unique nào đứng sau.
--     Toàn hệ ĐÃ COI (productModelId, code) là danh tính điểm đo —
--     getMeasurementPointDefByCode / measurementPointResolver / remapMeasurementPoints
--     đều tra theo bộ này rồi LIMIT 1 — nhưng KHÔNG có gì cưỡng chế. Hệ quả:
--       • 2 request cùng code mới (double-click Save, retry tRPC batch, 2 worker
--         ingest cùng lách qua khe check-then-insert của resolver) → 2 ROW SỐNG
--         cùng code = "điểm-ma".
--       • Mọi tra-cứu-theo-code sau đó LIMIT-1 trúng row NGẪU NHIÊN → một nửa
--         measurement_results gắn vào def mà không ai đang sửa; kỹ sư chỉnh
--         ngưỡng ở def này, máy chấm theo def kia.
--     PARTIAL trên "deletedAt" IS NULL: lịch sử soft-delete KHÔNG chặn việc tạo
--     lại một code đã khai tử (nghiệp vụ hợp lệ, phải giữ).
--
-- (2) ADD COLUMN "deletedAtVersion" integer NULL
--     deltaSyncPoints trước đây chỉ trả điểm ACTIVE → điểm bị xoá lặng lẽ biến
--     mất khỏi danh sách. Máy nào MERGE (thay vì REPLACE) point set — hoặc cache
--     theo code — KHÔNG BAO GIỜ biết điểm đã khai tử: nó kiểm tiếp, đánh rớt
--     board theo một spec không còn tồn tại. Cột này ghi pointsConfigVersion TẠI
--     THỜI ĐIỂM xoá, để getPointsChangedSinceVersion chỉ gửi tombstone cho máy
--     còn đứng dưới version đó.
--     NULL = xoá TRƯỚC 0274 (không biết version) → tombstone gửi VÔ ĐIỀU KIỆN.
--     Gửi thừa = no-op ở máy; thiếu = điểm chết không bao giờ chết. Chọn thừa.
--
-- LÀM GÌ:
--   (a) ADD COLUMN — additive, nullable, không backfill (không có nguồn sự thật
--       nào để suy ra version lịch sử; bịa ra một con số còn tệ hơn NULL).
--   (b) ĐẾM duplicate ("productModelId","code") đang sống — KHÔNG XOÁ. Giống 0272:
--       measurement_point_defs là DỮ LIỆU KỸ THUẬT có con (measurement_results.pointDefId)
--       + ý nghĩa audit. Gộp/xoá điểm-ma là quyết định của kỹ sư, KHÔNG phải của
--       migration — chọn nhầm row-giữ-lại là re-point sai toàn bộ kết quả.
--       (QĐ#3 doc 51: "nhận-và-gắn-cờ, không từ chối cứng".)
--   (c) CREATE UNIQUE INDEX IF NOT EXISTS partial.
--   (d) GUARDED: mọi bước bọc BEGIN/EXCEPTION + ghi db_feature_status (pattern
--       0172/0247/0272). Fail ⇒ WARNING loud + 'partial', KHÔNG đánh fail cả lượt migrate.
--
-- ⚠ CHI PHÍ: measurement_point_defs là bảng CẤU HÌNH (cỡ ngàn–chục ngàn row,
--   không phải bảng nóng như product_inspections) → build index nhanh, lock ngắn.
--   KHÔNG cần cửa sổ bảo trì. Không phải hypertable → không dính chuyện chunk nén.
--
-- App-side (an toàn CẢ KHI index không tạo được):
--   • createMeasurementPointDef → ON CONFLICT DO NOTHING **không nêu conflict
--     target** + resolve row cũ. Bare DO NOTHING KHÔNG cần index tồn tại. Nếu nêu
--     target mà index vắng mặt thì MỌI insert sẽ throw → hồi quy nặng. Index vắng
--     ⇒ không có gì conflict ⇒ hành vi y hệt plain insert cũ (KHÔNG hồi quy).
--   • applyCadImportJob → cũng bare ON CONFLICT DO NOTHING: re-import CAD chồng
--     lấn chỉ bỏ qua row trùng thay vì làm hỏng cả job.
--   • deleteMeasurementPointDef → 1 transaction: bump pointsConfigVersion (atomic
--     col = col + 1) + stamp "deletedAtVersion" = version mới.
--
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0274 (0272 = inspection_idempotency, 0273 = machine_claim_token).
-- ════════════════════════════════════════════════════════════════════════════

-- Bảng trạng thái ops-visible (đã có từ 0172; tạo lại an toàn nếu môi trường mới).
CREATE TABLE IF NOT EXISTS "db_feature_status" (
  "feature"   varchar(100) PRIMARY KEY,
  "status"    varchar(20) NOT NULL,          -- 'ok' | 'missing' | 'partial'
  "detail"    text,
  "checkedAt" timestamp NOT NULL DEFAULT now()
);

-- ── (a) Tombstone version stamp. Additive + nullable ⇒ an toàn tuyệt đối, chạy
--        ngoài khối DO để lỗi ở (c) không cuốn cột này theo.
ALTER TABLE "measurement_point_defs"
  ADD COLUMN IF NOT EXISTS "deletedAtVersion" integer;

COMMENT ON COLUMN "measurement_point_defs"."deletedAtVersion" IS
  'doc 51 P1/CASE#4: product_models."pointsConfigVersion" tại thời điểm soft-delete. NULL = xoá trước 0274 (version không xác định) → deltaSync gửi tombstone vô điều kiện.';

DO $$
DECLARE
  col_ok     boolean := false;
  dup_groups bigint  := 0;   -- số bộ ("productModelId","code") sống bị lặp
  dup_rows   bigint  := 0;   -- số row THỪA (tổng - 1 mỗi bộ) = số điểm-ma
  index_ok   boolean := false;
  err_detail text    := '';
BEGIN
  -- Xác nhận (a) thật sự có mặt (ALTER ở trên có thể đã bị env lạ chặn).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'measurement_point_defs' AND column_name = 'deletedAtVersion'
  ) INTO col_ok;

  IF NOT col_ok THEN
    RAISE WARNING '[0274] cột "deletedAtVersion" KHÔNG tồn tại — deltaSync sẽ không lọc tombstone theo version được (mọi tombstone gửi vô điều kiện = thừa băng thông, KHÔNG sai kết quả).';
  END IF;

  -- ── (b) ĐO duplicate hiện hữu (chỉ đọc — không xoá gì).
  BEGIN
    SELECT count(*), COALESCE(sum(c - 1), 0)
      INTO dup_groups, dup_rows
      FROM (
        SELECT count(*) AS c
          FROM measurement_point_defs
         WHERE "deletedAt" IS NULL
         GROUP BY "productModelId", "code"
        HAVING count(*) > 1
      ) d;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[0274] không đếm được duplicate measurement_point_defs (%) — vẫn thử tạo unique index.', SQLERRM;
  END;

  IF dup_groups > 0 THEN
    RAISE WARNING '[0274] measurement_point_defs ĐANG CÓ % bộ ("productModelId","code") SỐNG bị trùng (% row thừa = điểm-ma). Mỗi bộ trùng nghĩa là các tra-cứu-theo-code đang trúng row NGẪU NHIÊN → kết quả đo phân mảnh giữa 2 def. UNIQUE INDEX sẽ FAIL cho tới khi kỹ sư gộp. KHÔNG xoá mù (measurement_results.pointDefId trỏ vào cả hai):
  -- 1) SOI:    SELECT "productModelId","code", count(*), array_agg(id ORDER BY id)
  --              FROM measurement_point_defs WHERE "deletedAt" IS NULL
  --             GROUP BY 1,2 HAVING count(*) > 1;
  -- 2) ĐẾM kết quả bám mỗi def trước khi chọn row GIỮ:
  --            SELECT "pointDefId", count(*) FROM measurement_results
  --             WHERE "pointDefId" = ANY(''{<id...>}'') GROUP BY 1;
  -- 3) GỘP (giữ id NHỎ NHẤT = bản gốc; re-point kết quả rồi khai tử bản thừa —
  --    CHẠY CÓ BACKUP, xem xét từng bộ, KHÔNG chạy hàng loạt mù):
  --            UPDATE measurement_results SET "pointDefId" = <keep_id> WHERE "pointDefId" = <dup_id>;
  --            UPDATE measurement_point_defs SET "deletedAt" = now(), "isActive" = false WHERE id = <dup_id>;
  -- 4) RE-APPLY drizzle/0274 (idempotent).', dup_groups, dup_rows;
  END IF;

  -- ── (c) UNIQUE INDEX (partial). Thử kể cả khi (b) lỗi/có dup — EXCEPTION bắt trọn.
  BEGIN
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_point_defs_product_code"
      ON measurement_point_defs ("productModelId", "code")
      WHERE "deletedAt" IS NULL;
    index_ok := true;
    RAISE NOTICE '[0274] uq_point_defs_product_code in force — điểm-ma (2 def sống cùng code) không tạo được nữa.';
  EXCEPTION WHEN OTHERS THEN
    index_ok   := false;
    err_detail := 'unique index failed: ' || SQLERRM;
    RAISE WARNING '[0274] uq_point_defs_product_code creation FAILED (%) — measurement_point_defs VẪN CHƯA có chống-trùng ở DB; ON CONFLICT DO NOTHING phía app trở thành no-op (hành vi = như cũ, KHÔNG hồi quy). Nguyên nhân thường gặp: duplicate còn tồn (xem WARNING ở trên). Gộp rồi re-apply 0274.', SQLERRM;
  END;

  -- ── (d) Ghi kết quả vào db_feature_status (pattern 0172/0247/0272) cho ops/dashboards.
  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'measurement_point_integrity',
    CASE WHEN index_ok AND col_ok THEN 'ok' ELSE 'partial' END,
    CASE
      WHEN index_ok AND col_ok THEN
        'unique index uq_point_defs_product_code ("productModelId","code") WHERE "deletedAt" IS NULL in force + "deletedAtVersion" present. Concurrent create of the same code resolves to the original row (ON CONFLICT DO NOTHING + resolve); delta sync ships version-scoped tombstones. ' || dup_groups || ' pre-existing duplicate group(s) found at apply time. LIMIT: tombstones with NULL "deletedAtVersion" (deleted before 0274) are shipped on EVERY delta regardless of the machine version — bandwidth only, never a wrong verdict.'
      ELSE
        COALESCE(NULLIF(err_detail, ''), 'index ok') || '; column "deletedAtVersion" ' || CASE WHEN col_ok THEN 'present' ELSE 'MISSING' END ||
        ' — ' || dup_groups || ' live duplicate group(s) / ' || dup_rows || ' ghost row(s) present. Merge (re-point measurement_results, then soft-delete the surplus def) and re-apply drizzle/0274. Until then a race can still mint a second live def per code.'
    END,
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();
END $$;
