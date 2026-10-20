-- ★★ AI Local Đợt 8.1 Task 4b (2026-10-20) — TOKEN WEBHOOK theo luồng Luồng AI. Spec §4.5 (kích hoạt webhook, token theo luồng);
-- kế hoạch docs/superpowers/plans/2026-10-20-ai-local-dot8-pha1-node-loi.md.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0402.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Chỉ lưu BĂM sha256 (hex thường, 64 ký tự) — token thô trả cho người bật luồng đúng một lần, không bao giờ nằm trong CSDL.
-- Một hàng mỗi luồng (PK = flowId); xoá luồng ⇒ xoá token (CASCADE). KHÔNG FUNCTION/TRIGGER. Idempotent.

CREATE TABLE IF NOT EXISTS public.ai_flow_webhooks (
  "flowId"     varchar(64) PRIMARY KEY REFERENCES public.ai_flows(id) ON DELETE CASCADE,
  "tokenHash"  varchar(64) NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_webhooks_hash') THEN
    ALTER TABLE public.ai_flow_webhooks ADD CONSTRAINT chk_ai_flow_webhooks_hash CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_flow_webhooks TO avi_app;
  END IF;
END $$;
