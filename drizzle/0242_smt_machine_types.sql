-- doc 40 W5 — MTX-03: SMT LINE MACHINE TYPES (mở rộng độ phủ thiết bị).
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bổ sung 4 loại máy dây chuyền SMT vào machinetypeenum để một máy loại này ghi
-- được xuống DB (cột machines.machineType là pgEnum). Đồng bộ 1:1 với hằng
-- MACHINE_TYPES (server/constants/machineTypes.ts) và machineTypeEnum
-- (drizzle/schema/enums.ts). capabilityModel đã có profile năng lực cho 4 lớp này
-- (throughput mounter / zone-temps reflow / squeegee printer / solder-pot wave).
--
-- KHÔNG có bảng mới, KHÔNG có dữ liệu seed — chỉ mở rộng enum (backward-compatible,
-- các giá trị cũ không đổi). Idempotent nhờ ADD VALUE IF NOT EXISTS.
--
-- LƯU Ý: mỗi ADD VALUE phải là một câu lệnh auto-commit riêng (Postgres không cho
-- dùng giá trị enum mới trong cùng transaction đã thêm nó). Migration này KHÔNG
-- tham chiếu các giá trị mới ở nơi khác nên an toàn chạy tuần tự.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'MOUNTER';--> statement-breakpoint
ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'REFLOW';--> statement-breakpoint
ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'STENCIL_PRINTER';--> statement-breakpoint
ALTER TYPE "machinetypeenum" ADD VALUE IF NOT EXISTS 'WAVE_SOLDER';
