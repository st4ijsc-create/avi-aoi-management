-- ============================================================================
-- Migration 0290a: UNIT DIMENSIONS — mở rộng enum "uomdimensionenum"
--   (doc 56 Đ1 việc 7, API-6; phản biện GAP-3 [MEDIUM]).
--
-- CHỈ `ALTER TYPE ... ADD VALUE` — KHÔNG seed, KHÔNG tham chiếu giá trị mới ở file này.
--
-- ⚠ GOTCHA (đã ghi trong drizzle/0242_smt_machine_types.sql): Postgres KHÔNG cho dùng
--   một giá trị enum vừa ADD trong CÙNG transaction đã thêm nó. Vì vậy phần SEED
--   (units_of_measure.dimension = 'torque'|'pressure'|…) BẮT BUỘC nằm ở file RIÊNG
--   0290b, áp SAU khi 0290a đã COMMIT.
--
--   THỨ TỰ ÁP (scripts/migrate-standalone.mjs sort theo TÊN FILE):
--      … 0289 → 0290a → 0290b → 0291.
--   0290a PHẢI chạy & commit TRƯỚC 0290b. TUYỆT ĐỐI KHÔNG gộp 2 file.
--
-- Mỗi ADD VALUE là một câu lệnh auto-commit riêng, tách bằng statement-breakpoint.
-- ROLLBACK: giá trị enum KHÔNG xoá được trong Postgres — để nguyên là VÔ HẠI (không
--   unit nào tham chiếu dimension mới thì nó trơ; tiền lệ 0241/0242/0287).
-- ============================================================================

ALTER TYPE "uomdimensionenum" ADD VALUE IF NOT EXISTS 'torque';--> statement-breakpoint
ALTER TYPE "uomdimensionenum" ADD VALUE IF NOT EXISTS 'pressure';--> statement-breakpoint
ALTER TYPE "uomdimensionenum" ADD VALUE IF NOT EXISTS 'flow';--> statement-breakpoint
ALTER TYPE "uomdimensionenum" ADD VALUE IF NOT EXISTS 'current';--> statement-breakpoint
ALTER TYPE "uomdimensionenum" ADD VALUE IF NOT EXISTS 'frequency';
