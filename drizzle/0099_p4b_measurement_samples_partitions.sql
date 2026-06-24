-- ============================================================================
-- Migration 0099: P4.B G14 — Pre-provision measurement_samples partitions
-- Pre-creates monthly partitions for current month + 24 months forward + a
-- DEFAULT partition so any out-of-range insert still succeeds (and surfaces
-- in monitoring as data outside the planned window).
--
-- Idempotent: ensure_measurement_samples_partition() (introduced in 0092)
-- already short-circuits if the partition exists. The DEFAULT partition is
-- guarded with a NOT EXISTS check.
-- ============================================================================

DO $$
DECLARE
  start_date date := date_trunc('month', now())::date;
  d date;
BEGIN
  FOR i IN 0..23 LOOP
    d := (start_date + (i || ' month')::interval)::date;
    PERFORM ensure_measurement_samples_partition(
      EXTRACT(YEAR FROM d)::int,
      EXTRACT(MONTH FROM d)::int
    );
  END LOOP;
END $$;

-- DEFAULT partition (catches anything outside the 24-month window).
DO $$
BEGIN
  -- Chỉ tạo DEFAULT partition khi measurement_samples thực sự là bảng partitioned
  -- (xem 0092: bảng có thể bị giữ nguyên dạng thường nếu đã có dữ liệu).
  IF (SELECT relkind FROM pg_class WHERE relname = 'measurement_samples') IS DISTINCT FROM 'p' THEN
    RAISE NOTICE '[0099] measurement_samples chưa partition — bỏ qua DEFAULT partition.';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'measurement_samples_default'
  ) THEN
    EXECUTE $sql$
      CREATE TABLE measurement_samples_default
      PARTITION OF measurement_samples DEFAULT;
    $sql$;
    EXECUTE $sql$
      CREATE INDEX IF NOT EXISTS idx_msd_pointdef_sampledat
      ON measurement_samples_default ("pointDefId","sampledAt");
    $sql$;
  END IF;
END $$;
