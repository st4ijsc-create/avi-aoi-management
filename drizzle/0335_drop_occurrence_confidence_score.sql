-- ═══════════════════════════════════════════════════════════════════════════════════
-- D4 — BỎ CỘT CHỈ-GHI `predictive_alert_occurrences.confidenceScore`
-- ═══════════════════════════════════════════════════════════════════════════════════
--
-- Backlog D4 ghi: *"được ghi nhưng không nơi nào đọc — cột chết, hoặc dùng nó, hoặc bỏ"*.
-- Đo lại 2026-08-22: đúng là KHÔNG có chỗ đọc nào.
--   • chỗ ĐỌC DUY NHẤT của bảng này là `alarmKpiRouter`, và nó liệt kê cột TƯỜNG MINH
--     (`occurrenceId`, `occurredAt`, `occurrenceSeverity`) — `confidenceScore` không có mặt;
--   • không có `select()` rỗng (SELECT *) nào trên bảng này;
--   • `server/api/v1/advice.ts:144` đọc `confidenceScore` của **bảng CHA**
--     `predictive_alerts`, một cột KHÁC trùng tên — đã kiểm để không nhầm.
--
-- ── VÌ SAO BỎ CHỨ KHÔNG PHẢI "ĐEM RA ĐỌC" ─────────────────────────────────────────
-- Cả hai hướng đều khép được mục D4, nên phải chọn theo một tiêu chí: **hướng nào làm hệ
-- thống dễ ĐÚNG hơn sau sáu tháng?**
--   • Đem ra đọc: thêm một trường vào phản hồi KPI mà KHÔNG có màn hình nào tiêu thụ ⇒
--     chỉ DỜI cái chết lên một tầng, và tầng mới cũng không ai kiểm.
--   • Bỏ: bớt bề mặt, bớt một phép ghi trên MỌI lần tái diễn (một máy có thể tái diễn
--     ~22 lần/ngày). Khi nào thật sự cần "xu hướng độ tin cậy", người cần nó sẽ nói rõ
--     muốn thấy gì, và thêm lại là một thay đổi nhỏ CÓ người tiêu thụ.
-- ⇒ Chọn BỎ. Hàm tính (`buildOccurrence`) có test, nhưng GIÁ TRỊ lưu xuống thì không ai
--   đọc — nên nếu nó sai, sẽ không bao giờ có ai biết. Trạng thái không được đọc là
--   trạng thái không được kiểm.
--
-- ⚠ KHÔNG HOÀN NGUYÊN ĐƯỢC (mất dữ liệu cột). Chủ dự án xác nhận 2026-08-22: dữ liệu
--   hiện có là dữ liệu TEST, dựng lại được.

ALTER TABLE predictive_alert_occurrences
  DROP COLUMN IF EXISTS "confidenceScore";
