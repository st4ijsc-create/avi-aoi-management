-- drizzle/0339_inspection_result_tree.sql
-- Pha 1A — cây KẾT QUẢ. Ba bảng thường, FK thật GIỮA CHÚNG; chỉ liên kết lên
-- product_inspections là MỀM (đích là hypertable ⇒ Postgres cấm FK tới hypertable).
--
-- inspectionTime được SAO xuống mọi cấp để dọn theo cửa sổ thời gian mà KHÔNG phải
-- join ngược vào hypertable.
--
-- Mỗi cấp lưu CẢ "cái máy KHAI" (result/ntf) LẪN "cái CUỘN ra từ con"
-- (rolledResult/rolledNtf) — lệch nhau ⇒ có bug ở máy hoặc ở ta, và PHÁT HIỆN ĐƯỢC.
--
-- ⚠ DDL bằng owner `aoi`.

CREATE TABLE IF NOT EXISTS inspection_surfaces (
  id                 serial PRIMARY KEY,
  "inspectionId"     integer NOT NULL,          -- SOFT ref → product_inspections.id
  "inspectionTime"   timestamp NOT NULL,
  "surfaceName"      varchar(100) NOT NULL,
  "surfaceExtId"     varchar(64),
  "result"           overallresultenum NOT NULL,
  "ntf"              boolean NOT NULL DEFAULT false,
  "ntfSource"        varchar(10),
  "rolledResult"     overallresultenum NOT NULL,
  "rolledNtf"        boolean NOT NULL DEFAULT false,
  "declaredMismatch" boolean NOT NULL DEFAULT false,
  "startedAt"        timestamp,
  "completedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insp_surfaces_inspection ON inspection_surfaces ("inspectionId");
CREATE INDEX IF NOT EXISTS idx_insp_surfaces_time       ON inspection_surfaces ("inspectionTime");
CREATE INDEX IF NOT EXISTS idx_insp_surfaces_mismatch   ON inspection_surfaces ("declaredMismatch")
  WHERE "declaredMismatch";

CREATE TABLE IF NOT EXISTS inspection_positions (
  id                 serial PRIMARY KEY,
  "surfaceRowId"     integer NOT NULL REFERENCES inspection_surfaces(id) ON DELETE CASCADE,
  "inspectionId"     integer NOT NULL,
  "inspectionTime"   timestamp NOT NULL,
  "positionId"       varchar(64) NOT NULL,
  "positionNumber"   integer,
  "result"           overallresultenum NOT NULL,
  "ntf"              boolean NOT NULL DEFAULT false,
  "ntfSource"        varchar(10),
  "rolledResult"     overallresultenum NOT NULL,
  "rolledNtf"        boolean NOT NULL DEFAULT false,
  "declaredMismatch" boolean NOT NULL DEFAULT false,
  "startedAt"        timestamp,
  "completedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insp_positions_surface ON inspection_positions ("surfaceRowId");
CREATE INDEX IF NOT EXISTS idx_insp_positions_time    ON inspection_positions ("inspectionTime");

CREATE TABLE IF NOT EXISTS inspection_captures (
  id                 serial PRIMARY KEY,
  "positionRowId"    integer NOT NULL REFERENCES inspection_positions(id) ON DELETE CASCADE,
  "inspectionId"     integer NOT NULL,
  "inspectionTime"   timestamp NOT NULL,
  "captureExtId"     varchar(64) NOT NULL,
  "captureName"      varchar(255),
  "captureIndex"     integer,
  -- Ở cấp capture, result/ntf là field TRỰC TIẾP từ pipeline máy (tài liệu mẫu ghi rõ:
  -- "không phải tự OR ngược từ components") ⇒ declaredMismatch ở đây có giá trị chẩn
  -- đoán mạnh nhất trong cả cây.
  "result"           overallresultenum NOT NULL,
  "ntf"              boolean NOT NULL DEFAULT false,
  "ntfSource"        varchar(10),
  "rolledResult"     overallresultenum NOT NULL,
  "rolledNtf"        boolean NOT NULL DEFAULT false,
  "declaredMismatch" boolean NOT NULL DEFAULT false,
  "startedAt"        timestamp,
  "completedAt"      timestamp,
  "createdAt"        timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insp_captures_position_extid
  ON inspection_captures ("positionRowId", "captureExtId");
CREATE INDEX IF NOT EXISTS idx_insp_captures_time ON inspection_captures ("inspectionTime");

-- Mở rộng hai hypertable. §13 Đ-6: ADD COLUMN NULLABLE đã chứng minh an toàn trên
-- hypertable đã nén (Timescale 2.28.2). KHÔNG dùng NOT NULL DEFAULT.
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "ntfSource"           varchar(10);
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "machineProductIndex" integer;
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "configDriftFlags"    jsonb;
ALTER TABLE product_inspections ADD COLUMN IF NOT EXISTS "summaryCounts"       jsonb;

-- FK TỪ hypertable TỚI bảng thường là HỢP LỆ (chiều ngược lại mới bị cấm). Nhưng
-- `captureRowId` cố ý KHÔNG mang FK trong migration này: Task 3 chỉ dựng schema; ràng
-- buộc FK từ hypertable tới bảng thường tuy hợp lệ nhưng chi phí trên chunk ĐÃ NÉN
-- chưa đo được — để Pha 1B quyết sau khi có dữ liệu thật.
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "captureRowId"   integer;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "componentExtId" varchar(64);
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "ntf"            boolean;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "ntfSource"      varchar(10);
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "errorCode"      varchar(50);
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "errorDesc"      text;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "startedAt"      timestamp;
ALTER TABLE measurement_results ADD COLUMN IF NOT EXISTS "completedAt"    timestamp;

CREATE INDEX IF NOT EXISTS idx_results_capture ON measurement_results ("captureRowId")
  WHERE "captureRowId" IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON inspection_surfaces, inspection_positions, inspection_captures TO avi_app;
GRANT USAGE, SELECT ON SEQUENCE inspection_surfaces_id_seq, inspection_positions_id_seq, inspection_captures_id_seq TO avi_app;
