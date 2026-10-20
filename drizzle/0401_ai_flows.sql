-- ★★ AI Local Đợt 8.0 (2026-10-20) — LUỒNG AI: luồng · phiên bản bất biến · lượt chạy · bước · sự kiện · hàng đợi bền ·
-- hộp nhận (node chờ đủ cổng) · chờ dài. Spec §4.3–4.4; kế hoạch docs/superpowers/plans/2026-10-20-ai-local-dot8-pha0-dong-co-luong.md.
--
-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠⚠ DDL ⇒ CHẠY BẰNG OWNER `aoi` qua `node scripts/apply-migration-0401.mjs --test-only|--dev-only|--both`.
-- ══════════════════════════════════════════════════════════════════════════════════════════════
--
-- Thời điểm của hàng đợi/lease/lượt chạy dùng `timestamptz` (so với now() — `timestamp` naive qua postgres.js lệch giờ).
-- Bước (`ai_flow_steps`) có UNIQUE (run, node, lần, lần thử) ⇒ một mục hàng không thể ghi hai bước "xong" cho cùng lần.
-- KHÔNG FUNCTION/TRIGGER. Idempotent: IF NOT EXISTS + CHECK qua DO $$.

CREATE TABLE IF NOT EXISTS public.ai_flows (
  id               varchar(64) PRIMARY KEY,
  "tenantId"       varchar(64),
  name             varchar(200) NOT NULL,
  "activeVersion"  integer,
  "ownerId"        integer REFERENCES public.users(id) ON DELETE SET NULL,
  "riskClass"      varchar(12) NOT NULL DEFAULT 'thuan',
  enabled          boolean NOT NULL DEFAULT false,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_flow_versions (
  "flowId"      varchar(64) NOT NULL REFERENCES public.ai_flows(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  definition    jsonb NOT NULL,
  "riskClass"   varchar(12) NOT NULL,
  "createdBy"   integer REFERENCES public.users(id) ON DELETE SET NULL,
  "approvedBy"  integer REFERENCES public.users(id) ON DELETE SET NULL,
  "createdAt"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("flowId", version)
);

CREATE TABLE IF NOT EXISTS public.ai_flow_runs (
  id                uuid PRIMARY KEY,
  "flowId"          varchar(64) NOT NULL,
  version           integer NOT NULL,
  "triggerKind"     varchar(24) NOT NULL,
  status            varchar(16) NOT NULL DEFAULT 'dang-chay',
  "uuTien"          varchar(12) NOT NULL DEFAULT 'background',
  "idempotencyKey"  varchar(128) UNIQUE,
  "parentRunId"     uuid,
  "retryOf"         uuid,
  error             jsonb,
  "startedAt"       timestamptz NOT NULL DEFAULT now(),
  "finishedAt"      timestamptz,
  FOREIGN KEY ("flowId", version) REFERENCES public.ai_flow_versions("flowId", version)
);
CREATE INDEX IF NOT EXISTS ai_flow_runs_flow_idx ON public.ai_flow_runs ("flowId", "startedAt");

CREATE TABLE IF NOT EXISTS public.ai_flow_steps (
  id                bigserial PRIMARY KEY,
  "runId"           uuid NOT NULL REFERENCES public.ai_flow_runs(id) ON DELETE CASCADE,
  "nodeId"          varchar(64) NOT NULL,
  lan               integer NOT NULL,
  "lanThu"          integer NOT NULL DEFAULT 1,
  status            varchar(12) NOT NULL,
  "idempotencyKey"  varchar(200) NOT NULL,
  input             jsonb,
  output            jsonb,
  error             jsonb,
  "startedAt"       timestamptz NOT NULL DEFAULT now(),
  "finishedAt"      timestamptz,
  UNIQUE ("runId", "nodeId", lan, "lanThu")
);

CREATE TABLE IF NOT EXISTS public.ai_flow_events (
  id        bigserial PRIMARY KEY,
  "runId"   uuid NOT NULL REFERENCES public.ai_flow_runs(id) ON DELETE CASCADE,
  kind      varchar(32) NOT NULL,
  payload   jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_flow_events_run_idx ON public.ai_flow_events ("runId", id);

CREATE TABLE IF NOT EXISTS public.ai_flow_queue (
  id             bigserial PRIMARY KEY,
  "runId"        uuid NOT NULL REFERENCES public.ai_flow_runs(id) ON DELETE CASCADE,
  "nodeId"       varchar(64) NOT NULL,
  lan            integer NOT NULL,
  inputs         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "uuTien"       smallint NOT NULL DEFAULT 2,
  "availableAt"  timestamptz NOT NULL DEFAULT now(),
  "leaseOwner"   varchar(64),
  "leaseUntil"   timestamptz,
  attempts       integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_flow_queue_nhat_idx ON public.ai_flow_queue ("uuTien", "availableAt");

-- Node chờ ĐỦ cổng vào (vd logic.gop): item của từng cổng nằm đây tới khi đủ ⇒ thành MỘT mục hàng.
CREATE TABLE IF NOT EXISTS public.ai_flow_inbox (
  "runId"   uuid NOT NULL REFERENCES public.ai_flow_runs(id) ON DELETE CASCADE,
  "nodeId"  varchar(64) NOT NULL,
  port      varchar(32) NOT NULL,
  items     jsonb NOT NULL,
  PRIMARY KEY ("runId", "nodeId", port)
);

-- Chờ dài (duyệt người / webhook / thời gian) — pha 8.1 dùng; tạo sẵn để mô hình đủ.
CREATE TABLE IF NOT EXISTS public.ai_flow_waits (
  "runId"       uuid NOT NULL REFERENCES public.ai_flow_runs(id) ON DELETE CASCADE,
  "nodeId"      varchar(64) NOT NULL,
  kind          varchar(16) NOT NULL,
  "tokenHash"   varchar(64),
  "expiresAt"   timestamptz,
  payload       jsonb,
  PRIMARY KEY ("runId", "nodeId")
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flows_id') THEN
    ALTER TABLE public.ai_flows ADD CONSTRAINT chk_ai_flows_id CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flows_risk') THEN
    ALTER TABLE public.ai_flows ADD CONSTRAINT chk_ai_flows_risk CHECK ("riskClass" IN ('thuan', 'doc', 'ngoai-ghi', 'ot'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_versions_risk') THEN
    ALTER TABLE public.ai_flow_versions ADD CONSTRAINT chk_ai_flow_versions_risk CHECK ("riskClass" IN ('thuan', 'doc', 'ngoai-ghi', 'ot'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_runs_status') THEN
    ALTER TABLE public.ai_flow_runs ADD CONSTRAINT chk_ai_flow_runs_status CHECK (status IN ('dang-chay', 'cho-duyet', 'xong', 'loi', 'huy'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_steps_status') THEN
    ALTER TABLE public.ai_flow_steps ADD CONSTRAINT chk_ai_flow_steps_status CHECK (status IN ('dang-chay', 'xong', 'loi', 'khong-ro', 'bo-qua'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ai_flow_waits_kind') THEN
    ALTER TABLE public.ai_flow_waits ADD CONSTRAINT chk_ai_flow_waits_kind CHECK (kind IN ('duyet', 'webhook', 'thoi-gian'));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_flows, public.ai_flow_versions, public.ai_flow_runs, public.ai_flow_steps,
      public.ai_flow_events, public.ai_flow_queue, public.ai_flow_inbox, public.ai_flow_waits TO avi_app;
    GRANT USAGE, SELECT ON SEQUENCE public.ai_flow_steps_id_seq, public.ai_flow_events_id_seq, public.ai_flow_queue_id_seq TO avi_app;
  END IF;
END $$;
