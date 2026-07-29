-- Wave 4 §3 — nhật ký LẦN-TÁI-DIỄN.
-- Wave 3 gộp cảnh báo trùng thành MỘT dòng, khiến KPI (đếm mỗi dòng = 1 sự kiện)
-- báo thiếu và làm cảnh báo đang sống rơi khỏi cửa sổ thời gian. Bảng này ghi
-- từng lần tái diễn kèm mốc thời gian riêng để KPI đếm đúng và phát hiện lại
-- được "ngập báo động" (>10 lượt trong 10 phút, ISA-18.2).
CREATE TABLE IF NOT EXISTS "predictive_alert_occurrences" (
  "id"              serial PRIMARY KEY,
  "alertId"         integer NOT NULL
                      REFERENCES "predictive_alerts"("id") ON DELETE CASCADE,
  "occurredAt"      timestamptz NOT NULL DEFAULT now(),
  -- Mức độ + độ tin cậy TẠI LẦN NÀY (không phải mức đã gộp của dòng cha).
  "severity"        varchar(20),
  "confidenceScore" decimal(5,2)
);

-- KPI lọc theo cửa sổ thời gian rồi gộp theo cảnh báo cha.
CREATE INDEX IF NOT EXISTS "idx_alert_occurrences_time"
  ON "predictive_alert_occurrences" ("occurredAt");
CREATE INDEX IF NOT EXISTS "idx_alert_occurrences_alert"
  ON "predictive_alert_occurrences" ("alertId");
