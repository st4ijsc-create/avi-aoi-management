-- doc 42 Đợt 4B (H2 — "Gán máy vào trạm / xem máy thuộc trạm", §6.4 P1) —
-- junction workstation ↔ machine.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: bảng `workstations` (điểm/trạm kiểm tra AVI/AOI) và `machines` (máy)
-- chưa có bất kỳ quan hệ nào — doc 42 §6.4: "quan hệ cốt lõi của workstation hiện
-- không tồn tại". Migration này thêm bảng nối many-to-many để một trạm gán được
-- nhiều máy (và một máy phục vụ nhiều trạm).
--
-- ADDITIVE + IDEMPOTENT: CREATE TABLE / INDEX IF NOT EXISTS. Không ALTER TYPE,
-- không cột mới trên bảng cũ, không feature flag. Trơ cho tới khi router
-- workstation.assignMachine/unassignMachine/machinesForWorkstation đọc/ghi.
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0244 (0243 = robot_vendor_ur).
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "workstation_machines" (
  "id"            serial PRIMARY KEY NOT NULL,
  "workstationId" integer NOT NULL,
  "machineId"     integer NOT NULL,
  "orderIndex"    integer DEFAULT 0 NOT NULL,
  "isActive"      boolean DEFAULT true NOT NULL,
  "createdAt"     timestamp DEFAULT now() NOT NULL,
  "updatedAt"     timestamp DEFAULT now() NOT NULL
);

-- Một cặp (trạm, máy) chỉ tồn tại 1 lần → chống gán trùng.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_workstation_machines_ws_machine"
  ON "workstation_machines" ("workstationId", "machineId");
CREATE INDEX IF NOT EXISTS "idx_workstation_machines_ws"
  ON "workstation_machines" ("workstationId");
CREATE INDEX IF NOT EXISTS "idx_workstation_machines_machine"
  ON "workstation_machines" ("machineId");

-- FK: gỡ trạm → gỡ luôn liên kết máy của trạm (workstations xoá mềm nên CASCADE
-- gần như không kích hoạt; giữ để dọn khi hard-delete). machines cũng xoá mềm
-- (isActive=false) nên CASCADE trên machineId không kích hoạt lúc xoá mềm.
DO $$ BEGIN
  ALTER TABLE "workstation_machines"
    ADD CONSTRAINT "fk_workstation_machines_workstation"
    FOREIGN KEY ("workstationId") REFERENCES "workstations"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "workstation_machines"
    ADD CONSTRAINT "fk_workstation_machines_machine"
    FOREIGN KEY ("machineId") REFERENCES "machines"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
