-- ============================================================================
-- Migration 0348 — Lô 7 Mục 1 (BG-111): DROP NOT NULL cho
-- threshold_approvals."proposedLsl"/"proposedUsl".
--
-- ⚠ DDL phải chạy bằng owner `aoi` (`avi_app` → 42501). Nghiệm thu bằng vai
--   `avi_app` (cầu chì rolsuper/rolbypassrls, tái dùng nguyên văn
--   scripts/apply-migration-0338.mjs:74-84 / apply-migration-0347.mjs).
-- ⚠ KHÔNG có một câu DELETE/UPDATE nào. Không xoá, không đụng một byte dữ liệu.
-- ⚠ BG-95 — chỉ DROP một ràng buộc (không tạo lại ràng buộc nào migration sau
--   đã bỏ) ⇒ an toàn tái chạy nhiều lần (idempotent tự nhiên: DROP NOT NULL
--   trên cột đã nullable không lỗi).
--
-- ════════════════════════════════════════════════════════════════════════════
-- VÌ SAO — cầu nối sửa-bị-chặn → hàng đợi duyệt (BG-111, Lô 7)
-- ════════════════════════════════════════════════════════════════════════════
-- Brief Mục 2 mở `thresholdApproval.request` nhận `deXuat: Record<field, string|null>`
-- cho ĐỦ BỘ `APPROVAL_LIMIT_FIELDS` (shared/pointLimitSpec.ts), không chỉ
-- LSL/USL. Một yêu cầu duyệt CHỈ đề xuất `heightMax` (không đụng lowerLimit/
-- upperLimit) là hợp lệ theo hợp đồng mới — nhưng `proposedLsl`/`proposedUsl`
-- đang NOT NULL ⇒ INSERT sẽ vỡ `23502` (not_null_violation) trước khi kịp ghi
-- `suggestion.deXuat`. Migration này gỡ đúng ràng buộc đó, KHÔNG đổi gì khác:
-- hai cột vẫn tồn tại (đường ghi CŨ/legacy — client cũ gửi proposedLsl/Usl vẫn
-- ghi được y như trước, xem Mục 2 báo cáo), chỉ không còn BẮT BUỘC phải có giá
-- trị khi yêu cầu duyệt không chạm LSL/USL.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ĐO TRƯỚC KHI SỬA (vai `avi_app`, 2026-09-05) — information_schema.columns
-- ════════════════════════════════════════════════════════════════════════════
--   current_database()=aoi_management       proposedLsl.is_nullable=NO  proposedUsl.is_nullable=NO
--                                            threshold_approvals: status='requested'=176, status='applied'=4
--   current_database()=aoi_management_test  proposedLsl.is_nullable=NO  proposedUsl.is_nullable=NO
--                                            threshold_approvals: status='requested'=30
-- => 176 (dev) + 30 (test) hàng "requested" ĐANG TỒN KHO mang `proposedLsl`/Usl
--    CÓ giá trị (đường LSL/USL cũ) — migration chỉ nới lỏng ràng buộc, không hồi
--    tố/ghi đè các hàng này, nên chúng không bị ảnh hưởng bởi DDL này.
-- ============================================================================

ALTER TABLE threshold_approvals ALTER COLUMN "proposedLsl" DROP NOT NULL;
ALTER TABLE threshold_approvals ALTER COLUMN "proposedUsl" DROP NOT NULL;

COMMENT ON COLUMN threshold_approvals."proposedLsl" IS
  '0348 (Lô 7 Mục 1, BG-111): NULLABLE — một yêu cầu duyệt có thể chỉ đề xuất field khác LSL (vd heightMax), xem suggestion.deXuat. Đường ghi legacy (client cũ gửi proposedLsl/Usl) vẫn hoạt động y nguyên.';
COMMENT ON COLUMN threshold_approvals."proposedUsl" IS
  '0348 (Lô 7 Mục 1, BG-111): NULLABLE — cùng lý do proposedLsl ở trên.';
