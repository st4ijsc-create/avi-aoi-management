-- ★★ AI Local Đợt 7.0 (2026-10-20) — SỔ MODEL: artifact · hồ sơ phục vụ · vai trò · gán · lượt đo.
-- Spec: docs/superpowers/specs/2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md §3.3 (dải mig AI Local mới 0400–0419).
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0400.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Bề mặt gọi model theo VAI TRÒ; tên tệp GGUF chỉ nằm ở `ai_model_artifacts`. Gán (`ai_model_bindings`) trỏ ĐÚNG MỘT
-- trong hai: `profileId` (hồ sơ cố định) hoặc `envKey` (THEO-ENV — đi theo khoá `.env`/lựa chọn quản trị của
-- `luaChonModelLlamaServer`). Seed = 11 gán global theo-env ⇒ ngày đầu hành vi y nguyên `.env` bằng CẤU TRÚC.
--
-- Lịch sử gán: KHÔNG sửa tại chỗ — đặt `retiredAt` cho hàng cũ rồi chèn hàng mới (một giao dịch, tầng ứng dụng).
-- Ràng buộc "một gán còn hiệu lực cho mỗi (vai trò, phạm vi, chế độ)" là UNIQUE một phần ở CSDL, không ở ứng dụng.
-- KHÔNG có FUNCTION/TRIGGER ⇒ không search_path nào phải ghim. Idempotent: IF NOT EXISTS + CHECK qua DO $$.

CREATE TABLE IF NOT EXISTS public.ai_model_artifacts (
  id              varchar(96) PRIMARY KEY,
  "filePath"      varchar(260) NOT NULL UNIQUE,
  sha256          varchar(64),
  family          varchar(48) NOT NULL,
  "paramsTotalB"  numeric,
  "paramsActiveB" numeric,
  quant           varchar(24),
  "ctxNative"     integer,
  license         varchar(48) NOT NULL DEFAULT 'unknown',
  "sizeBytes"     bigint,
  "vramWeightsMb" integer,
  modalities      text[] NOT NULL DEFAULT '{text}',
  loai            varchar(16) NOT NULL DEFAULT 'sinh-chu',
  status          varchar(16) NOT NULL DEFAULT 'available',
  "createdAt"     timestamp NOT NULL DEFAULT now(),
  "updatedAt"     timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_serving_profiles (
  id            varchar(96) PRIMARY KEY,
  "artifactId"  varchar(96) NOT NULL REFERENCES public.ai_model_artifacts(id),
  "slotClass"   varchar(8) NOT NULL,
  ctx           integer NOT NULL,
  "serverArgs"  jsonb NOT NULL DEFAULT '{}'::jsonb,
  sampling      jsonb NOT NULL DEFAULT '{}'::jsonb,
  thinking      varchar(8) NOT NULL DEFAULT 'auto',
  "vramEstMb"   integer,
  enabled       boolean NOT NULL DEFAULT true,
  "createdAt"   timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_roles (
  id           varchar(48) PRIMARY KEY,
  "moTa"       text NOT NULL,
  "evalSuite"  varchar(64),
  examples     text[] NOT NULL DEFAULT '{}',
  "envKey"     varchar(32) NOT NULL,
  "taskKind"   varchar(16) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_model_bindings (
  id           bigserial PRIMARY KEY,
  "roleId"     varchar(48) NOT NULL REFERENCES public.ai_roles(id),
  "scopeKind"  varchar(8) NOT NULL,
  "scopeId"    varchar(64),
  "profileId"  varchar(96) REFERENCES public.ai_serving_profiles(id),
  "envKey"     varchar(32),
  fallback     text[] NOT NULL DEFAULT '{}',
  "evalRunId"  bigint,
  mode         varchar(8) NOT NULL DEFAULT 'active',
  "createdBy"  integer REFERENCES public.users(id) ON DELETE SET NULL,
  "createdAt"  timestamp NOT NULL DEFAULT now(),
  "retiredAt"  timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_model_bindings_hieu_luc_uq
  ON public.ai_model_bindings ("roleId", "scopeKind", COALESCE("scopeId", ''), mode)
  WHERE "retiredAt" IS NULL;

CREATE TABLE IF NOT EXISTS public.ai_model_eval_runs (
  id           bigserial PRIMARY KEY,
  "profileId"  varchar(96) NOT NULL,
  suite        varchar(64) NOT NULL,
  "nTasks"     integer,
  "nPass"      integer,
  "nRuns"      integer,
  "p50Ms"      integer,
  "p90Ms"      integer,
  detail       jsonb,
  "gitSha"     varchar(40),
  "createdAt"  timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_model_eval_runs_profile_idx ON public.ai_model_eval_runs ("profileId", suite, "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_artifacts_status') THEN
    ALTER TABLE public.ai_model_artifacts
      ADD CONSTRAINT chk_ai_model_artifacts_status CHECK (status IN ('available', 'missing', 'quarantined'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_artifacts_loai') THEN
    ALTER TABLE public.ai_model_artifacts
      ADD CONSTRAINT chk_ai_model_artifacts_loai CHECK (loai IN ('sinh-chu', 'nhung', 'xep-hang', 'chieu-thi-giac'));
  END IF;
  -- Tên tệp ở GỐC kho — không thư mục, không đi ngược (cùng luật `xacThucTenModel`).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_artifacts_file_path') THEN
    ALTER TABLE public.ai_model_artifacts
      ADD CONSTRAINT chk_ai_model_artifacts_file_path CHECK (
        "filePath" !~ '[/\\]' AND "filePath" NOT LIKE '%..%' AND "filePath" ~* '\.gguf$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_serving_profiles_slot') THEN
    ALTER TABLE public.ai_serving_profiles
      ADD CONSTRAINT chk_ai_serving_profiles_slot CHECK ("slotClass" IN ('nang', 'nho', 'sidecar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_serving_profiles_thinking') THEN
    ALTER TABLE public.ai_serving_profiles
      ADD CONSTRAINT chk_ai_serving_profiles_thinking CHECK (thinking IN ('on', 'off', 'auto'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_serving_profiles_ctx') THEN
    ALTER TABLE public.ai_serving_profiles
      ADD CONSTRAINT chk_ai_serving_profiles_ctx CHECK (ctx BETWEEN 512 AND 262144);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_roles_id') THEN
    ALTER TABLE public.ai_roles
      ADD CONSTRAINT chk_ai_roles_id CHECK (id ~ '^[a-z][a-z0-9]*(\.[a-z0-9-]+)?$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_bindings_dich') THEN
    ALTER TABLE public.ai_model_bindings
      ADD CONSTRAINT chk_ai_model_bindings_dich CHECK (("profileId" IS NULL) <> ("envKey" IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_bindings_scope') THEN
    ALTER TABLE public.ai_model_bindings
      ADD CONSTRAINT chk_ai_model_bindings_scope CHECK (
        "scopeKind" IN ('global', 'tenant', 'project', 'flow')
        AND (("scopeKind" = 'global') = ("scopeId" IS NULL))
        AND ("scopeId" IS NULL OR "scopeId" ~ '^[A-Za-z0-9_-]{1,64}$'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_model_bindings_mode') THEN
    ALTER TABLE public.ai_model_bindings
      ADD CONSTRAINT chk_ai_model_bindings_mode CHECK (mode IN ('active', 'shadow', 'thu'));
  END IF;
END $$;

-- Seed vai trò gốc (khớp `shared/aiRoles.ts` VAI_TRO_GOC — lưới `soModelSeed.test.ts` canh hai bên không lệch).
INSERT INTO public.ai_roles (id, "moTa", "envKey", "taskKind") VALUES
  ('chat',          'Hỏi đáp chung',                                   'GGUF_DEFAULT_MODEL',  'chat'),
  ('chat.ops',      'Câu vận hành ngắn (trợ lý nhà máy)',              'GGUF_FAST_MODEL',     'fast'),
  ('code.software', 'Lập trình phần mềm (TS/JS, C#, Python…)',         'GGUF_CODE_MODEL',     'code'),
  ('code.plc',      'Lập trình tự động hoá (IEC 61131-3 ST/SCL/IL)',   'GGUF_CODE_MODEL',     'code'),
  ('extract',       'Trích xuất có cấu trúc (JSON schema)',            'GGUF_FAST_MODEL',     'fast'),
  ('classify',      'Phân loại / gắn nhãn',                            'GGUF_FAST_MODEL',     'fast'),
  ('summarize',     'Tóm tắt, viết báo cáo',                           'GGUF_DEFAULT_MODEL',  'chat'),
  ('vision',        'Thị giác (ảnh lỗi, tài liệu)',                    'GGUF_VISION_MODEL',   'vision'),
  ('embed',         'Nhúng văn bản',                                   'GGUF_EMBED_MODEL',    'embed'),
  ('rerank',        'Xếp hạng lại kết quả tra cứu',                    'GGUF_RERANKER_MODEL', 'embed'),
  ('fim',           'Gợi ý mã tại chỗ (fill-in-the-middle)',           'GGUF_FIM_MODEL',      'fim')
ON CONFLICT (id) DO NOTHING;

-- Seed gán global THEO-ENV (một hàng/vai trò, chỉ khi chưa có gán global active còn hiệu lực).
INSERT INTO public.ai_model_bindings ("roleId", "scopeKind", "envKey", mode)
SELECT r.id, 'global', r."envKey", 'active'
  FROM public.ai_roles r
 WHERE NOT EXISTS (
   SELECT 1 FROM public.ai_model_bindings b
    WHERE b."roleId" = r.id AND b."scopeKind" = 'global' AND b.mode = 'active' AND b."retiredAt" IS NULL);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_model_artifacts, public.ai_serving_profiles, public.ai_roles,
      public.ai_model_bindings, public.ai_model_eval_runs TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE public.ai_model_bindings_id_seq, public.ai_model_eval_runs_id_seq TO avi_app;
  END IF;
END $$;
