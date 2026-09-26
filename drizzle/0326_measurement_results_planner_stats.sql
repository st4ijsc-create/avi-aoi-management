-- ═══════════════════════════════════════════════════════════════════════════════════════════
-- 0326 — THỐNG KÊ PLANNER cho `measurement_results` × `product_inspections`.
--
-- ⚠⚠ MIGRATION NÀY KHÔNG TẠO INDEX. Chẩn đoán ban đầu ("gốc-của-gốc: `measurement_results`
-- không có index trên `inspectionId`") đã được ĐO VÀ BÁC BỎ ngày 2026-08-18. Xem §1.
--
-- ── §1. CÁI ĐƯỢC CHO LÀ GỐC RỄ KHÔNG TỒN TẠI ───────────────────────────────────────────────
-- `pg_indexes` trên `aoi_management` VÀ `aoi_management_test` (đo 2026-08-18):
--     idx_results_inspection        ON measurement_results ("inspectionId")
--     idx_results_inspection_result ON measurement_results ("inspectionId", result)
-- Cả hai đã tồn tại từ migration 0000, được khai trong drizzle/schema/inspection.ts:323/327,
-- và ĐANG ĐƯỢC DÙNG THẬT (`_hyper_12_5_chunk_idx_results_inspection` xuất hiện trong kế hoạch
-- của 4/6 truy vấn đo được). Index KHÔNG hề thiếu.
--
-- ── §2. GỐC RỄ THẬT: BẢNG CHƯA BAO GIỜ ĐƯỢC `ANALYZE` ──────────────────────────────────────
-- `pg_stat_all_tables.last_analyze` = NULL và `last_autoanalyze` = NULL trên MỌI chunk của cả
-- hai hypertable, ở CẢ HAI CSDL. `pg_class.reltuples` = **-1** (chưa biết) trên hypertable cha
-- và trên chunk nén `_hyper_11_7_chunk`. Autoanalyze KHÔNG cứu được: `n_mod_since_analyze` = 0
-- vì dữ liệu vào bằng restore/seed chứ không qua đường INSERT đếm được ⇒ với autovacuum bảng
-- trông "sạch" trong khi thống kê là rác. Đây là cái bẫy: thiết bị đo im lặng, không đỏ.
--
-- Hệ quả đo được trên chính truy vấn xuất `measurements.csv` (trang cuối, `aoi_management`):
--     TRƯỚC:  Nested Loop + Materialize, Join Filter (mr."inspectionId" = pi.id)
--             Rows Removed by Join Filter: 2 997 964 925      ← BA TỶ hàng
--             Execution Time: 184 122,944 ms
--     SAU `ANALYZE` (KHÔNG thêm index nào):
--             Parallel Hash Join
--             Rows Removed by Join Filter: 0
--             Execution Time: 21,047 ms                       ← NHANH GẤP ~8 750 LẦN
-- Ước lượng của planner trước ANALYZE là `rows=29 203 245` cho một phép nối thực tế trả 599
-- hàng. Chính con số ước lượng sai ~49 000 lần ấy khiến planner tin `LIMIT 1000` sẽ được thoả
-- ngay, nên đánh cược vào nested loop — rồi quét gần trọn tích Descartes 157 369 × 22 996.
--
-- ── §3. VÌ SAO KHÔNG THÊM `(inspectionId, id)` ─────────────────────────────────────────────
-- Đã dựng CSDL đo riêng ở QUY MÔ THẬT (`aoi_idxbench`: 5 000 000 hàng đo / 500 000 bản ghi
-- kiểm / 755 MB, cùng tỷ lệ khớp 17,6% như dev) vì ở 157 k hàng cả bảng nằm gọn trong
-- shared_buffers và mọi index đều "hoà" — một ca 10 hàng sẽ không phân biệt được gì.
--     Truy vấn tra theo lô inspection : nền 1,134 ms · +(inspectionId,id) 1,683 ms  (XẤU HƠN)
--     Truy vấn keyset trong 1 inspection: nền 0,126 ms · +(inspectionId,id) 0,068 ms (đều <1ms)
--     Truy vấn xuất/pareto/NG-gần-đây  : không đổi hoặc chậm hơn
-- Giá phải trả: **+108 MB** index trên bảng 755 MB (+14%) — trên bảng GHI NÓNG NHẤT hệ thống.
-- ⇒ BÁC BỎ. Lợi ích đo được bằng không, chi phí ghi là thật.
--
-- ── §4. NHƯNG index ĐANG CÓ thì PHẢI GIỮ ───────────────────────────────────────────────────
-- Cùng bộ đo, bỏ hẳn `idx_results_inspection`(+`_result`) ở quy mô 5 triệu hàng:
--     tra theo lô inspection      : 1,134 ms → 629,803 ms   (chậm 555 lần)
--     keyset trong một inspection : 0,126 ms →  68,527 ms   (chậm 544 lần)
-- Vì vậy có một ca kiểm CẤU TRÚC canh sự tồn tại của index này (xem
-- server/db/measurementResultsPlannerStats.db.test.ts) — không phải trang trí.
--
-- ── §5. MIGRATION NÀY LÀM GÌ ───────────────────────────────────────────────────────────────
--   (a) `ANALYZE` cả hai hypertable ⇒ vá ngay kế hoạch hỏng.
--   (b) Hạ `autovacuum_analyze_scale_factor` 0,10 → 0,02 trên hai hypertable cha VÀ mọi chunk
--       hiện có, để thống kê không lặng lẽ mốc lại. Timescale chép reloptions của cha sang
--       chunk mới, nên chunk sinh sau cũng được thừa hưởng.
-- Idempotent: `ANALYZE` và `ALTER TABLE … SET (…)` chạy bao nhiêu lần cũng cùng kết quả.
-- KHÔNG `CREATE INDEX CONCURRENTLY`: không tạo index nào cả, nên không có khoá bảng để né.
-- (Ghi nhận cho lần sau: đo được `CREATE INDEX` trên 5 triệu hàng chỉ mất 740 ms cho index
--  đơn và 1 191 ms cho index tổ hợp — ngắn hơn nhiều so với chi phí vận hành của CONCURRENTLY,
--  vốn KHÔNG chạy được trên hypertable cha.)
-- ═══════════════════════════════════════════════════════════════════════════════════════════

-- (b) Ngưỡng autoanalyze chặt hơn cho hai bảng nóng nhất — làm TRƯỚC, để ANALYZE ở (a) ghi
--     thống kê dưới cấu hình mới.
-- Hypertable cha (Timescale chép reloptions sang chunk sinh sau).
ALTER TABLE public.measurement_results  SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE public.product_inspections  SET (autovacuum_analyze_scale_factor = 0.02);

-- Chunk ĐANG TỒN TẠI không thừa hưởng reloptions của cha — phải đặt tay từng cái.
DO $$
DECLARE
  c record;
BEGIN
  -- `timescaledb_information.chunks` là API CÔNG KHAI, ổn định giữa các bản Timescale.
  -- (`_timescaledb_catalog.chunk.dropped` ĐÃ BIẾN MẤT ở 2.28.2 — đã đo, migration hỏng thật.)
  IF to_regclass('timescaledb_information.chunks') IS NULL THEN
    RAISE NOTICE '0326: khong co timescaledb — bo qua buoc chunk';
    RETURN;
  END IF;
  FOR c IN
    SELECT ch.chunk_schema AS schema_name, ch.chunk_name AS table_name
    FROM timescaledb_information.chunks ch
    WHERE ch.hypertable_name IN ('measurement_results', 'product_inspections')
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE %I.%I SET (autovacuum_analyze_scale_factor = 0.02)',
                     c.schema_name, c.table_name);
    EXCEPTION WHEN others THEN
      -- chunk nén / chunk chỉ đọc có thể từ chối — không được làm hỏng migration vì việc này
      RAISE NOTICE '0326: bo qua chunk %.%: %', c.schema_name, c.table_name, SQLERRM;
    END;
  END LOOP;
END $$;

-- (a) BẢN VÁ THẬT — nạp thống kê cho planner.
ANALYZE public.measurement_results;
ANALYZE public.product_inspections;
