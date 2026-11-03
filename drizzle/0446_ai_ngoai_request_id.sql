-- Dot 12 H3.3a (2026-11-03) — id yeu cau cua NHA CUNG CAP AI ngoai trong so WORM (hop dong docs/superpowers/plans/2026-11-03-h3-3-adapter-ngoai-hop-dong.md).
--
-- ⚠ DDL ⇒ owner `aoi` qua `node scripts/apply-migration-0446.mjs --test-only|--dev-only|--both`. DEV chi sau khi dieu-phoi duyet SQL.
--
-- Vi sao: 429 / 5xx / tra loi la ⇒ hoi nha cung cap can `request-id` (Anthropic) / `x-request-id` (OpenAI) / `x-goog-request-id` (Gemini).
--   • ai_external_calls."requestId"   text NULL — CONG ghi o hang `ket-qua` (ok / loi / tu-choi khi co phan hoi HTTP). Gia tri la DU LIEU
--                                      NGOAI ⇒ ma kiem `requestIdHopLe` (^[A-Za-z0-9_.:-]{1,128}$, khac ⇒ bo) VA CHECK duoi day (lop hai).
--   • Hang `y-dinh` KHONG co requestId (chua gui) ⇒ CHECK cam.
--   • Khong chi muc (chua co truy van can — dieu-phoi 03/11). Bang WORM: chi ADD COLUMN, trigger WORM giu nguyen.
-- Cot moi mac dinh NULL = hanh vi cu.
--
-- ROLLBACK:
--   ALTER TABLE public."ai_external_calls" DROP CONSTRAINT IF EXISTS "ai_external_calls_request_id_chk", DROP COLUMN IF EXISTS "requestId";

ALTER TABLE public."ai_external_calls" ADD COLUMN IF NOT EXISTS "requestId" text;
ALTER TABLE public."ai_external_calls" DROP CONSTRAINT IF EXISTS "ai_external_calls_request_id_chk";
ALTER TABLE public."ai_external_calls" ADD CONSTRAINT "ai_external_calls_request_id_chk"
  CHECK ("requestId" IS NULL OR ("loai" = 'ket-qua' AND "requestId" ~ '^[A-Za-z0-9_.:-]{1,128}$'));
