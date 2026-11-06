-- ============================================================================
-- Migration 0490: MỘT nguồn chính sách Timescale (Pha 0 T0-3, TechDocs 30 §1.4 + quyết định 4).
--
-- Bảng VALUES dưới đây là NGUỒN DUY NHẤT của cấu hình nén + giữ dữ liệu cho hypertable trên DB chính.
-- Giá trị = trạng thái DEV và _test đo 2026-11-06 (0271 thắng); trên hai DB đó migration này là NO-OP
-- (job_id không đổi, apply-migration-0490.mjs kiểm).
--
-- Vì sao cần: lịch sử 0118 → 0172 → 0271 cho KẾT QUẢ KHÁC theo thứ tự đời DB. 0271 chỉ ALTER khi nén chưa bật
-- và add_*_policy(if_not_exists) giữ nguyên chính sách cũ, nên DB mới mà 0172 chuyển được ot_telemetry sẽ
-- kẹt ở (machineId, metric) + nén 30 d thay vì (deviceId, metric) + 7 d.
-- Vì sao KHÔNG bỏ 0118/0172 khỏi thứ tự áp: 0172 là nơi tạo hypertable measurement_results /
-- product_inspections / ... ; bỏ đi thì DB mới không có hypertable. Migration này là lời cuối, không xoá lịch sử.
--
-- Chỉ hoà giải KHI LỆCH. Không đụng dữ liệu, không tạo hypertable, không đụng audit_logs (90) và CAGG.
-- Không có extension ⇒ no-op (NOTICE), như 0118/0172/0271.
-- ============================================================================
DO $$
DECLARE
  r record;
  bang regclass;
  da_bat boolean;
  seg_hien text[];
  ord_hien text[];
  so_job int;
  khop boolean;
  so_thieu int := 0;
  so_sua int := 0;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    RAISE NOTICE '[0490] timescaledb extension not installed — skipped.';
    RETURN;
  END IF;

  FOR r IN
    SELECT * FROM (VALUES
      -- bang                  segmentby                    orderby (cột, luôn DESC)  nén sau             giữ
      ('ot_telemetry',         ARRAY['deviceId', 'metric'], 'ts',                     INTERVAL '7 days',  INTERVAL '365 days'),
      ('oee_metrics',          ARRAY['machineId'],          'timestamp',              INTERVAL '90 days', INTERVAL '365 days'),
      ('machine_heartbeats',   ARRAY['machineId'],          'timestamp',              INTERVAL '14 days', INTERVAL '365 days'),
      ('process_results',      ARRAY['machineId'],          'measuredAt',             INTERVAL '60 days', INTERVAL '365 days'),
      ('measurement_results',  ARRAY['pointDefId'],         'createdAt',              INTERVAL '30 days', INTERVAL '365 days'),
      ('product_inspections',  ARRAY['machineId'],          'inspectionTime',         INTERVAL '30 days', INTERVAL '365 days'),
      ('robot_telemetry',      ARRAY['robotId'],            'timestamp',              INTERVAL '14 days', INTERVAL '365 days')
    ) AS t(ten, seg, ord_cot, nen_sau, giu)
  LOOP
    SELECT h.compression_enabled INTO da_bat
      FROM timescaledb_information.hypertables h
      WHERE h.hypertable_schema = 'public' AND h.hypertable_name = r.ten;
    IF NOT FOUND THEN
      RAISE WARNING '[0490] % is NOT a hypertable — left as is.', r.ten;
      so_thieu := so_thieu + 1;
      CONTINUE;
    END IF;
    bang := format('public.%I', r.ten)::regclass;

    -- ── cấu hình nén ──
    SELECT array_agg(s.attname::text ORDER BY s.segmentby_column_index) FILTER (WHERE s.segmentby_column_index IS NOT NULL),
           array_agg(s.attname::text || CASE WHEN s.orderby_asc THEN ' ASC' ELSE ' DESC' END ORDER BY s.orderby_column_index) FILTER (WHERE s.orderby_column_index IS NOT NULL)
      INTO seg_hien, ord_hien
      FROM timescaledb_information.compression_settings s
      WHERE s.hypertable_schema = 'public' AND s.hypertable_name = r.ten;
    IF NOT da_bat OR seg_hien IS DISTINCT FROM r.seg OR ord_hien IS DISTINCT FROM ARRAY[r.ord_cot || ' DESC'] THEN
      EXECUTE format('ALTER TABLE %s SET (timescaledb.compress, timescaledb.compress_orderby = %L, timescaledb.compress_segmentby = %L)',
        bang,
        format('%I DESC', r.ord_cot),
        (SELECT string_agg(format('%I', c), ',') FROM unnest(r.seg) AS c));
      RAISE NOTICE '[0490] % compression settings reconciled.', r.ten;
      so_sua := so_sua + 1;
    END IF;

    -- ── chính sách nén ──
    SELECT count(*), coalesce(bool_and((j.config->>'compress_after')::interval = r.nen_sau), false) INTO so_job, khop
      FROM timescaledb_information.jobs j
      WHERE j.proc_name = 'policy_compression' AND j.hypertable_schema = 'public' AND j.hypertable_name = r.ten;
    IF so_job <> 1 OR NOT khop THEN
      PERFORM remove_compression_policy(bang, if_exists => TRUE);
      PERFORM add_compression_policy(bang, r.nen_sau);
      RAISE NOTICE '[0490] % compression policy reconciled (%).', r.ten, r.nen_sau;
      so_sua := so_sua + 1;
    END IF;

    -- ── chính sách giữ dữ liệu ──
    SELECT count(*), coalesce(bool_and((j.config->>'drop_after')::interval = r.giu), false) INTO so_job, khop
      FROM timescaledb_information.jobs j
      WHERE j.proc_name = 'policy_retention' AND j.hypertable_schema = 'public' AND j.hypertable_name = r.ten;
    IF so_job <> 1 OR NOT khop THEN
      PERFORM remove_retention_policy(bang, if_exists => TRUE);
      PERFORM add_retention_policy(bang, r.giu);
      RAISE NOTICE '[0490] % retention policy reconciled (%).', r.ten, r.giu;
      so_sua := so_sua + 1;
    END IF;
  END LOOP;

  INSERT INTO db_feature_status ("feature", "status", "detail", "checkedAt")
  VALUES (
    'timescaledb_mot_nguon_chinh_sach',
    CASE WHEN so_thieu = 0 THEN 'ok' ELSE 'partial' END,
    format('0490: reconciled %s item(s); %s table(s) not hypertable', so_sua, so_thieu),
    now()
  )
  ON CONFLICT ("feature") DO UPDATE
    SET "status" = EXCLUDED."status", "detail" = EXCLUDED."detail", "checkedAt" = now();

  RAISE NOTICE '[0490] done: reconciled %, missing %.', so_sua, so_thieu;
END $$;
