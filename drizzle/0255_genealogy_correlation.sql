-- doc 44 Batch W2-B2 (G5.17 — genealogy slice) — correlation id on the genealogy ledger.
--
-- ════════════════════════════════════════════════════════════════════════════
-- Bối cảnh: genealogy_chain (P4.C G11) là sổ cái hash-chain append-only nhưng
-- chưa mang correlation id xuyên tầng (order → work-order → command → genealogy
-- event, LDS-L1). Cột mới được điền từ AsyncLocalStorage backbone
-- (server/services/observability/correlation.ts getCorrelationId) tại 3 điểm
-- ghi: genealogyRouter.appendEvent, componentInstallationService,
-- processResultService. NULL khi ngoài correlation context (hành vi cũ).
--
-- QUAN TRỌNG — KHÔNG PHÁ HASH-CHAIN: utils/genealogyChain.hashEntry băm một
-- danh sách trường CỐ ĐỊNH (prevHash, serialNumber, parentSerial, eventType,
-- stationCode, lotCode, productModelId, payload, recordedAt). correlation_id
-- nằm NGOÀI danh sách đó → verifyChain trên dữ liệu cũ (cột NULL) lẫn dữ liệu
-- mới (cột có giá trị) đều pass không đổi. Đổi lại (trade-off, ghi chú honest):
-- correlation_id là trace-metadata, KHÔNG được hash-chain bảo vệ chống sửa đổi.
--
-- ADDITIVE + IDEMPOTENT: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
-- (partial — bỏ NULL vì đa số row lịch sử không có correlation id; mirrors
-- idx_command_log_correlation, mig 0246).
-- Applied by scripts/migrate-standalone.mjs, tracked in __applied_migrations.
-- Numbered 0255 (0254 = contract_quarantine).
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE "genealogy_chain" ADD COLUMN IF NOT EXISTS "correlation_id" text;

CREATE INDEX IF NOT EXISTS "idx_genealogy_chain_correlation"
  ON "genealogy_chain" ("correlation_id")
  WHERE "correlation_id" IS NOT NULL;
