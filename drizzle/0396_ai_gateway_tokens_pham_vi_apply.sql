-- ★★★ Đợt 4B-server (2026-10-17) — phạm vi token mới `apply` trên `ai_gateway_tokens` + `ai_gateway_device_codes` (0392).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0396.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- `apply` mở ĐÚNG hai tuyến REST ghi SỔ KIỂM TOÁN lượt áp tệp ở client (`POST /api/ai/client-apply/bat-dau|chot`) —
-- trước đây extension phải gọi tRPC `aiCopilot.batDauApDungOClient|chotApDungOClient` bằng COOKIE phiên web. Nó KHÔNG
-- mở đường nào của cổng `/v1` (phân loại phạm vi theo đường ở `maToken.phamViCuaDuong`).
--
-- Chỉ NỚI hai CHECK `chk_ai_gateway_tokens_pham_vi` / `chk_ai_gateway_device_codes_pham_vi` từ {chat, fim, embed} lên
-- {chat, fim, embed, apply}; vẫn "mảng con KHÔNG RỖNG" ⇒ một phạm vi lạ (vd 'admin') vẫn bị CSDL từ chối (23514).
-- Mọi hàng cũ thoả CHECK mới (tập cũ ⊂ tập mới) ⇒ ADD CONSTRAINT kiểm lại bảng không thể hỏng. Không đổi quyền, không
-- cột mới, không FUNCTION/TRIGGER (không search_path nào phải ghim).
-- Idempotent: mỗi CHECK chỉ được thay khi định nghĩa hiện tại CHƯA chứa 'apply'; chạy lại ⇒ không làm gì.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_ai_gateway_tokens_pham_vi' AND pg_get_constraintdef(oid) LIKE '%apply%'
  ) THEN
    ALTER TABLE public.ai_gateway_tokens DROP CONSTRAINT IF EXISTS chk_ai_gateway_tokens_pham_vi;
    ALTER TABLE public.ai_gateway_tokens
      ADD CONSTRAINT chk_ai_gateway_tokens_pham_vi
      CHECK (cardinality("phamVi") >= 1 AND "phamVi" <@ ARRAY['chat', 'fim', 'embed', 'apply']::text[]);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_ai_gateway_device_codes_pham_vi' AND pg_get_constraintdef(oid) LIKE '%apply%'
  ) THEN
    ALTER TABLE public.ai_gateway_device_codes DROP CONSTRAINT IF EXISTS chk_ai_gateway_device_codes_pham_vi;
    ALTER TABLE public.ai_gateway_device_codes
      ADD CONSTRAINT chk_ai_gateway_device_codes_pham_vi
      CHECK (cardinality("phamVi") >= 1 AND "phamVi" <@ ARRAY['chat', 'fim', 'embed', 'apply']::text[]);
  END IF;
END $$;
