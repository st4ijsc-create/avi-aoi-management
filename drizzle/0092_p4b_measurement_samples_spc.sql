-- ============================================================================
-- Migration 0092: P4.B G14 — measurement_samples time-series for real-time SPC
-- High-volume table; partitioned by month using PostgreSQL declarative partitioning.
-- 1 row = 1 measurement = 1 MP at 1 timestamp.
-- Used for: rolling Cpk/Ppk, EWMA charts, Western Electric / Nelson rules.
-- ============================================================================

-- Parent partitioned table. NOTE: an earlier auto-generated migration (0008) may
-- have already created "measurement_samples" as a PLAIN (non-partitioned) table.
-- Cột giống hệt bản này; bảng KHÔNG có FK trỏ tới. Nên: nếu bảng tồn tại nhưng
-- chưa partition và còn RỖNG → drop + tạo lại dạng partitioned (an toàn). Nếu đã có
-- dữ liệu → giữ nguyên (không phá dữ liệu) và bỏ qua việc tạo partition theo tháng.
DO $$
DECLARE
  v_exists      boolean;
  v_partitioned boolean := false;
  v_has_rows    boolean := false;
  v_need_create boolean := false;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'measurement_samples') INTO v_exists;
  IF NOT v_exists THEN
    v_need_create := true;
  ELSE
    SELECT (relkind = 'p') INTO v_partitioned FROM pg_class WHERE relname = 'measurement_samples';
    IF NOT v_partitioned THEN
      EXECUTE 'SELECT EXISTS(SELECT 1 FROM measurement_samples LIMIT 1)' INTO v_has_rows;
      IF v_has_rows THEN
        RAISE NOTICE '[0092] measurement_samples tồn tại dạng NON-partitioned và có dữ liệu — giữ nguyên; bỏ qua partition theo tháng.';
      ELSE
        DROP TABLE "measurement_samples";
        v_need_create := true;
        RAISE NOTICE '[0092] chuyển measurement_samples (rỗng) sang dạng partitioned.';
      END IF;
    END IF;
  END IF;

  IF v_need_create THEN
    EXECUTE $sql$
      CREATE TABLE "measurement_samples" (
        "id" bigserial NOT NULL,
        "pointDefId" integer NOT NULL,
        "machineId" integer,
        "inspectionId" integer,
        "serialNumber" varchar(128),
        "stationCode" varchar(50),         -- SPI | AOI_PRE | AOI_POST | AXI | ICT | FCT
        "value" numeric(15, 6) NOT NULL,
        "isOk" boolean,
        "operatorId" integer,
        "instrumentId" integer,
        "lotCode" varchar(80),
        "shiftCode" varchar(20),
        "envTempC" numeric(6, 2),
        "envRhPct" numeric(5, 2),
        "sampledAt" timestamp NOT NULL,
        PRIMARY KEY ("id", "sampledAt")
      ) PARTITION BY RANGE ("sampledAt");
    $sql$;
  END IF;
END $$;

-- Helper function to create monthly partition idempotently
CREATE OR REPLACE FUNCTION ensure_measurement_samples_partition(p_year int, p_month int)
RETURNS void
LANGUAGE plpgsql
AS $func$
DECLARE
  partition_name text;
  start_ts text;
  end_ts text;
BEGIN
  -- Bảng chưa partition (vd bị giữ nguyên vì đã có dữ liệu) → no-op an toàn,
  -- tránh lỗi "is not partitioned" khi cron/migration gọi hàm này.
  IF (SELECT relkind FROM pg_class WHERE relname = 'measurement_samples') IS DISTINCT FROM 'p' THEN
    RETURN;
  END IF;
  partition_name := format('measurement_samples_y%sm%s',
    to_char(p_year, 'FM0000'),
    to_char(p_month, 'FM00'));
  start_ts := format('%s-%s-01 00:00:00',
    to_char(p_year, 'FM0000'),
    to_char(p_month, 'FM00'));
  end_ts := format('%s-%s-01 00:00:00',
    to_char(CASE WHEN p_month = 12 THEN p_year + 1 ELSE p_year END, 'FM0000'),
    to_char(CASE WHEN p_month = 12 THEN 1 ELSE p_month + 1 END, 'FM00'));
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = partition_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF measurement_samples FOR VALUES FROM (%L) TO (%L)',
      partition_name, start_ts, end_ts
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I ("pointDefId","sampledAt")',
      'idx_' || partition_name || '_point_time', partition_name
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I ("machineId","sampledAt")',
      'idx_' || partition_name || '_machine_time', partition_name
    );
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I ("serialNumber")',
      'idx_' || partition_name || '_serial', partition_name
    );
  END IF;
END;
$func$;

-- Pre-create partitions for current month and next 6 months
DO $$
DECLARE
  cur_ts timestamp := date_trunc('month', NOW());
  i int;
  yr int;
  mo int;
BEGIN
  FOR i IN 0..6 LOOP
    yr := EXTRACT(YEAR  FROM (cur_ts + (i || ' months')::interval))::int;
    mo := EXTRACT(MONTH FROM (cur_ts + (i || ' months')::interval))::int;
    PERFORM ensure_measurement_samples_partition(yr, mo);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- mp_spc_alerts — Western Electric / Nelson rule violations sink
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "mp_spc_alerts" (
  "id" serial PRIMARY KEY,
  "pointDefId" integer NOT NULL,
  "machineId" integer,
  -- ruleCode: WE_1 | WE_2 | WE_3 | WE_4 | NELSON_1 .. NELSON_8 | EWMA_OOC
  "ruleCode" varchar(40) NOT NULL,
  "ruleName" varchar(120) NOT NULL,
  "severity" varchar(20) NOT NULL DEFAULT 'warn', -- warn | critical
  "windowFrom" timestamp NOT NULL,
  "windowTo" timestamp NOT NULL,
  "sampleIds" bigint[] NOT NULL DEFAULT '{}',
  "summary" jsonb,
  "ackBy" integer,
  "ackAt" timestamp,
  "ackNote" text,
  "createdAt" timestamp NOT NULL DEFAULT NOW(),
  CONSTRAINT "chk_mp_spc_alerts_severity"
    CHECK ("severity" IN ('warn','critical'))
);

CREATE INDEX IF NOT EXISTS "idx_mp_spc_alerts_point" ON "mp_spc_alerts" ("pointDefId");
CREATE INDEX IF NOT EXISTS "idx_mp_spc_alerts_rule" ON "mp_spc_alerts" ("ruleCode");
CREATE INDEX IF NOT EXISTS "idx_mp_spc_alerts_window" ON "mp_spc_alerts" ("windowFrom","windowTo");
CREATE INDEX IF NOT EXISTS "idx_mp_spc_alerts_unack" ON "mp_spc_alerts" ("ackAt") WHERE "ackAt" IS NULL;

-- ----------------------------------------------------------------------------
-- mp_spc_rolling — cached rolling stats per MP (refreshed by background job)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "mp_spc_rolling" (
  "id" serial PRIMARY KEY,
  "pointDefId" integer NOT NULL,
  "windowSize" integer NOT NULL DEFAULT 30,
  "n" integer NOT NULL,
  "mean" numeric(18, 6),
  "stdDev" numeric(18, 6),
  "minValue" numeric(18, 6),
  "maxValue" numeric(18, 6),
  "cp" numeric(10, 4),
  "cpk" numeric(10, 4),
  "pp" numeric(10, 4),
  "ppk" numeric(10, 4),
  "ewmaLast" numeric(18, 6),
  "computedAt" timestamp NOT NULL DEFAULT NOW(),
  "validUntil" timestamp
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_mp_spc_rolling_point_window"
  ON "mp_spc_rolling" ("pointDefId","windowSize");
CREATE INDEX IF NOT EXISTS "idx_mp_spc_rolling_computed" ON "mp_spc_rolling" ("computedAt");
