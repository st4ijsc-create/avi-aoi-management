-- doc 40 Wave 5 — OT-F8 / CTL-04 / MTX: SLMP 3E/4E protocol value.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: 'mitsubishi-mc' (driver mcprotocol) CHỈ nói 1E frame (A-compatible);
-- iQ-R/iQ-F/FX5U MẶC ĐỊNH SLMP 3E frame. Thêm giá trị 'slmp' vào otprotocolenum để
-- deviceAdapters.protocol chọn được driver SLMP thật (server/services/ot/drivers/
-- slmpDriver.ts, trên node:net — KHÔNG npm dep). Driver đã đăng ký ở ot/index.ts.
--
-- ADD VALUE là additive, KHÔNG phá dữ liệu cũ; adapter cũ giữ nguyên protocol.
-- 'IF NOT EXISTS' → idempotent (áp lại nhiều lần vô hại).
--
-- ⚠️ Postgres KHÔNG cho ALTER TYPE ... ADD VALUE chạy trong transaction block chung
-- với việc DÙNG value đó ngay sau; migration này CHỈ thêm value (không dùng) nên an toàn.
-- Numbered 0241 (0240 = robot_commissioning). Owner chạy migration; KHÔNG tự áp.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TYPE "public"."otprotocolenum" ADD VALUE IF NOT EXISTS 'slmp';--> statement-breakpoint
