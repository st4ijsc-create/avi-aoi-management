-- ════════════════════════════════════════════════════════════════════════════
-- 0356 — Twin 3D Đợt 51: index `machine_health_history ("machineId","createdAt" DESC)`
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501 permission denied for schema public).
-- ⚠ QĐ-27 (chủ sở hữu, 2026-09-12): DUYỆT tạo index này **CHỈ trên DB dev**.
--   Production để sau, trong cửa sổ bảo trì — xem mục "ÁP LÊN PRODUCTION" cuối tệp.
--
-- ─── LỖI ĐƯỢC VÁ ────────────────────────────────────────────────────────────
-- `server/db/twinCanh.ts:2196 traSucKhoeMay` (thủ tục `twinCanh.sucKhoeMay`) chạy
--
--     SELECT DISTINCT ON ("machineId") … FROM machine_health_history
--     WHERE "machineId" IN (…42 id…)
--     ORDER BY "machineId", "createdAt" DESC
--
-- Bảng CÓ SẴN 6 index, trong đó hai cái trông như đúng cái ta cần:
--     idx_health_machine_time              ("machineId", "timestamp")
--     uq_machine_health_history_machine_ts UNIQUE ("machineId", "timestamp")
-- nhưng cả hai sắp theo **`timestamp`** còn câu sắp theo **`createdAt`** — hai cột
-- KHÁC NHAU và cố ý khác nhau (`timestamp` = mốc của KỲ ĐO, `createdAt` = lúc hàng
-- được GHI; docblock của `traSucKhoeMay` nói thẳng điều đó). Postgres không dùng
-- được index nào, nên kế hoạch đo được trên DB dev (213 567 hàng / 42 máy) là:
--
--     Unique (actual time=258.113..286.590 rows=42)
--       ->  Sort  Sort Method: external merge  Disk: 7848kB
--             ->  Seq Scan on machine_health_history  rows=212194
--     Execution Time: 288.534 ms
--
-- Tức là **kéo 212 194 hàng, sắp ra ĐĨA (7,8 MB temp), để giữ đúng 42 hàng**.
-- Đợt 50 đo: `traSucKhoeMay` chiếm 24/32 câu chậm còn lại của phiên.
--
-- ─── VÌ SAO INDEX, KHÔNG PHẢI ĐỔI HÌNH DẠNG CÂU ─────────────────────────────
-- Đợt 50 đã thử đổi hình dạng (per-máy `UNION ALL … ORDER BY "createdAt" DESC LIMIT 1`
-- ×42): **233–412 ms, TỆ HƠN** `DISTINCT ON` (126–154 ms ở lần đo đó). Lý do là cả hai
-- hình dạng đều không có index sắp theo `createdAt` để tựa vào — 42 câu con thì mỗi
-- câu vẫn phải Seq Scan. Vấn đề nằm ở **cấu trúc lưu trữ**, không ở cách viết câu;
-- vá bằng cách viết lại câu là chữa triệu chứng (G112: số từ vá-thử không phải tiêu chí).
--
-- ⚠ KHÔNG sửa `traSucKhoeMay` cho "hợp index". Câu hiện tại đã là hình dạng đúng cho
--   `DISTINCT ON`; index này chỉ làm nó chạy được bằng Index Scan thay vì Seq+Sort.
--
-- ─── VÌ SAO `CONCURRENTLY` ──────────────────────────────────────────────────
-- `scripts/migrate-standalone.mjs` chạy TỪNG câu bằng `sql.unsafe(stmt)` và **KHÔNG**
-- bọc transaction (đọc `migrate-standalone.mjs:222-231`) ⇒ `CREATE INDEX CONCURRENTLY`
-- dùng được. Đã đo trên DB dev bằng một index thăm dò cùng định nghĩa: **147 ms, 6 608 kB**.
-- Đánh đổi: `CONCURRENTLY` KHÔNG khoá đường GHI (`machine_health_history` đang được
-- ghi ~42 hàng mỗi vài phút bởi job sức khoẻ), đổi lại nó quét bảng hai lượt và có thể
-- để lại index INVALID nếu bị ngắt giữa chừng — nên có bước 1 dưới đây.
--
-- ⚠ Nếu một môi trường nào đó chạy migration TRONG transaction, `CONCURRENTLY` sẽ nổ
--   `25001`. Khi đó dùng bản không-CONCURRENTLY: khoá `SHARE` trên bảng, chặn mọi INSERT
--   trong ~0,2–1 s ở kích thước hiện tại (213 k hàng / 42 MB heap). Đo lại trước khi làm.
--
-- ─── TÁI CHẠY ĐƯỢC (bài học BG-95) ──────────────────────────────────────────
-- Bước 1 dọn index INVALID còn sót của một lần CONCURRENTLY bị ngắt — vì
-- `CREATE INDEX CONCURRENTLY IF NOT EXISTS` sẽ **bỏ qua** index INVALID cùng tên và
-- để nguyên nó ở đó (một index INVALID không được planner dùng, nhưng vẫn bị mọi
-- INSERT/UPDATE bảo trì ⇒ tệ nhất của hai thế giới).

-- ─── 1. Dọn index cùng tên nhưng INVALID (lần CONCURRENTLY trước bị ngắt) ───
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
      JOIN pg_index i ON i.indexrelid = c.oid
     WHERE c.relname = 'idx_health_machine_created_desc'
       AND NOT i.indisvalid
  ) THEN
    EXECUTE 'DROP INDEX idx_health_machine_created_desc';
    RAISE NOTICE '0356: da xoa index INVALID cung ten (lan CONCURRENTLY truoc bi ngat)';
  END IF;
END $$;

-- ─── 2. Index cho `DISTINCT ON ("machineId") ORDER BY "machineId","createdAt" DESC` ───
-- DESC nằm ở cột thứ hai để thứ tự index TRÙNG thứ tự câu cần; Postgres quét ngược được
-- một index ASC, nhưng khi đó `DISTINCT ON` phải Backward Index Scan toàn bộ thay vì
-- nhảy tới hàng đầu mỗi nhóm. Ghi DESC là nói thẳng thứ tự ta cần.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_health_machine_created_desc
  ON machine_health_history ("machineId", "createdAt" DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- ÁP LÊN PRODUCTION (CHƯA LÀM — cần cửa sổ bảo trì + người ký)
-- ════════════════════════════════════════════════════════════════════════════
-- 1. Đo `count(*)` và `pg_total_relation_size` của `machine_health_history` trên
--    production TRƯỚC. Dev = 213 567 hàng / 75 MB; production có thể lớn hơn nhiều bậc,
--    và thời gian build CONCURRENTLY tỉ lệ với nó.
-- 2. Chạy đúng câu này (CONCURRENTLY, không khoá ghi). Nếu bị ngắt ⇒ index INVALID
--    ⇒ chạy lại migration (bước 1 dọn giúp).
-- 3. Đo lại `traSucKhoeMay` + `pg_stat_user_indexes.idx_scan` sau 24 h để xác nhận
--    planner thật sự dùng index (index không ai dùng = chi phí ghi thuần).
