-- doc 44 W6-1 (gap G5.14) — e-SOP: định nghĩa quy trình + bước + phiên thực thi.
--
-- ════════════════════════════════════════════════════════════════════════════
-- SYNAPSE LDS-L5 §6.2 (e-SOP): hướng dẫn từng bước theo ngữ cảnh sản phẩm/trạm,
-- checklist bắt buộc xác nhận (requires_confirm + expected_input), ghi vết thao
-- tác tay (sop_executions.step_confirmations) vào genealogy con người.
--
-- ADDITIVE + IDEMPOTENT (CREATE TABLE/INDEX IF NOT EXISTS). Không FK ràng buộc
-- CASCADE/RESTRICT ở SQL này khớp drizzle (schema là nguồn); giữ khớp cột
-- snake_case với drizzle/schema/sop.ts.
-- ════════════════════════════════════════════════════════════════════════════

-- ── sops : định nghĩa SOP (code + version; bản hiệu lực = status='active') ─────
CREATE TABLE IF NOT EXISTS sops (
  id               serial PRIMARY KEY,
  code             varchar(80)  NOT NULL,
  title            varchar(255) NOT NULL,
  description      text,
  product_model_id integer REFERENCES product_models(id) ON DELETE SET NULL,
  station_id       integer REFERENCES stations(id) ON DELETE SET NULL,
  version          integer      NOT NULL DEFAULT 1,
  status           varchar(16)  NOT NULL DEFAULT 'draft',
  created_by       integer,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sops_code_version ON sops (code, version);
CREATE INDEX IF NOT EXISTS idx_sops_status  ON sops (status);
CREATE INDEX IF NOT EXISTS idx_sops_product ON sops (product_model_id);
CREATE INDEX IF NOT EXISTS idx_sops_station ON sops (station_id);

-- ── sop_steps : các bước của một SOP ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sop_steps (
  id               serial PRIMARY KEY,
  sop_id           integer NOT NULL REFERENCES sops(id) ON DELETE CASCADE,
  step_no          integer NOT NULL,
  text             text    NOT NULL,
  media_ref        varchar(500),
  requires_confirm boolean NOT NULL DEFAULT false,
  expected_input   varchar(255),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sop_steps_sop_stepno ON sop_steps (sop_id, step_no);
CREATE INDEX IF NOT EXISTS idx_sop_steps_sop ON sop_steps (sop_id);

-- ── sop_executions : sổ append-only mỗi phiên thực thi SOP ─────────────────────
CREATE TABLE IF NOT EXISTS sop_executions (
  id                 serial PRIMARY KEY,
  sop_id             integer NOT NULL REFERENCES sops(id) ON DELETE RESTRICT,
  unit_serial        varchar(128),
  line_id            integer,
  station_id         integer,
  operator_id        integer,
  status             varchar(16) NOT NULL DEFAULT 'in_progress',
  step_confirmations jsonb       NOT NULL DEFAULT '[]'::jsonb,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sop_exec_sop     ON sop_executions (sop_id);
CREATE INDEX IF NOT EXISTS idx_sop_exec_status  ON sop_executions (status);
CREATE INDEX IF NOT EXISTS idx_sop_exec_started ON sop_executions (started_at);
