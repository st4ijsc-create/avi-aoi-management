-- doc 42 T9 (followup Đợt 4C J1 — "Ca làm việc áp dụng cho từng ngày lịch") —
-- junction calendar_days ↔ shift_configs.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: `calendar_days` (lịch nhà máy — ngày làm/nghỉ/ngừng-kế-hoạch) và
-- `shift_configs` (định nghĩa ca: mã/tên/giờ bắt đầu-kết thúc) chưa có quan hệ.
-- Migration này thêm bảng nối many-to-many để một ngày lịch chạy nhiều ca (và
-- một ca dùng lại cho nhiều ngày). TÁI DÙNG shift_configs, không tạo bảng ca mới.
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS. Không ALTER TYPE,
-- không cột mới trên bảng cũ, không feature flag. Trơ cho tới khi router
-- calendar.assignShift/unassignShift/listDayShifts/listShiftConfigs đọc/ghi.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0245 (0244 = workstation_machines).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "calendar_day_shifts" (
  "id"            serial PRIMARY KEY NOT NULL,
  "calendarDayId" integer NOT NULL,
  "shiftConfigId" integer NOT NULL,
  "isActive"      boolean DEFAULT true NOT NULL,
  "createdAt"     timestamp DEFAULT now() NOT NULL,
  "updatedAt"     timestamp DEFAULT now() NOT NULL
);

-- Một cặp (ngày lịch, ca) chỉ tồn tại 1 lần → chống gán trùng.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_caldayshifts_day_shift"
  ON "calendar_day_shifts" ("calendarDayId", "shiftConfigId");
CREATE INDEX IF NOT EXISTS "idx_caldayshifts_day"
  ON "calendar_day_shifts" ("calendarDayId");
CREATE INDEX IF NOT EXISTS "idx_caldayshifts_shift"
  ON "calendar_day_shifts" ("shiftConfigId");

-- FK: xoá ngày lịch → gỡ luôn ca gán cho ngày đó (CASCADE dọn bảng nối).
DO $$ BEGIN
  ALTER TABLE "calendar_day_shifts"
    ADD CONSTRAINT "fk_caldayshifts_day"
    FOREIGN KEY ("calendarDayId") REFERENCES "calendar_days"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- FK: xoá 1 định nghĩa ca → gỡ mọi lần gán ca đó vào các ngày lịch.
DO $$ BEGIN
  ALTER TABLE "calendar_day_shifts"
    ADD CONSTRAINT "fk_caldayshifts_shift"
    FOREIGN KEY ("shiftConfigId") REFERENCES "shift_configs"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
