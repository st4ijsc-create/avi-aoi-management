-- ============================================================================
-- Migration 0279 (doc 54 Wave C · decision Đ5) — extend WORM (append-only) to the
-- operational ledgers by REVOKE-ing tamper DML from the least-privilege app role.
--
-- WHAT / WHY:
--   Migration 0224 made audit_logs / control_audit_log true WORM for the runtime
--   role `avi_app` (REVOKE UPDATE, DELETE + FORCE RLS). The same integrity
--   guarantee is now extended to the command / inspection / deploy / robot-job
--   ledgers so a compromised app path cannot rewrite or erase the operational
--   audit trail. This mirrors 0224 §4 (defense-in-depth REVOKE ... FROM avi_app);
--   RLS policies are NOT added here (decision Đ5 = REVOKE-only for these tables).
--
-- PER-TABLE DECISION (grep-verified against server/** on 2026-07-16):
--   • command_log        → REVOKE UPDATE, DELETE  (TRUE append-only).
--       commandDispatcher.ts writes each ledger branch (rejected/simulated/acked/
--       failed/timeout) as a FRESH .insert(commandLog) row — there is NO
--       .update(commandLog) / .delete(commandLog) anywhere in server code.
--   • product_inspections → REVOKE DELETE ONLY (UPDATE kept — downgraded).
--       It HAS legitimate runtime UPDATE paths (ack, ntfScore, quality-gate
--       verdicts, variant remap, machine-API status) across server/db/inspection.ts,
--       inspectionRouters.ts, aiQualityGate(.ts/Router), ntfPredictorService.ts,
--       aoiPackageRouter.ts, inspectionVariantRouter.ts, machineApiRouters.ts.
--       No non-test DELETE path (deletes only in *.test.ts cleanup) → block DELETE.
--   • program_deployments → REVOKE DELETE ONLY (UPDATE kept — lifecycle).
--       programmingService.ts UPDATEs status transitions + rolledBackFromId /
--       'rolled_back' (5 update sites) — keep UPDATE, block only DELETE.
--   • robot_jobs          → REVOKE DELETE ONLY (UPDATE kept — lifecycle headroom).
--       Grep note: current code is INSERT-only for robot_jobs (each terminal
--       state inserted as a fresh row; no .update(robotJobs) today). We still keep
--       the UPDATE grant because the robotJobStatusEnum is a full lifecycle
--       (draft→pending→confirmed→running→done/failed) and a future status-update
--       path is expected; REVOKE-DELETE-only is the conservative choice and never
--       breaks an append-only writer. Only DELETE is truly tamper here.
--
-- GUARDS: each REVOKE is wrapped in a to_regclass('public.<t>') IS NOT NULL guard
--   (a missing table must not abort the migration), and the whole block no-ops if
--   the avi_app role is absent (dev DB without the least-privilege role). REVOKE of
--   an already-revoked privilege is itself a no-op → fully idempotent / re-runnable.
--
-- NOTE: WORM here is enforced only against `avi_app`. It becomes real once the app
--   actually connects as avi_app (see .env DATABASE_URL) — the postgres superuser
--   bypasses grants, exactly as documented in 0224's cutover notes.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'avi_app') THEN
    RAISE NOTICE '[0279] role avi_app absent — WORM ledger REVOKEs skipped (dev DB without least-privilege role; apply 0224 first).';
    RETURN;
  END IF;

  -- ── True append-only ledger: no legit runtime UPDATE/DELETE ────────────────
  IF to_regclass('public.command_log') IS NOT NULL THEN
    EXECUTE 'REVOKE UPDATE, DELETE ON public.command_log FROM avi_app';
    RAISE NOTICE '[0279] command_log: REVOKE UPDATE, DELETE (append-only command ledger).';
  END IF;

  -- ── Downgraded to DELETE-only: legit runtime UPDATE paths exist ────────────
  IF to_regclass('public.product_inspections') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON public.product_inspections FROM avi_app';
    RAISE NOTICE '[0279] product_inspections: REVOKE DELETE only (UPDATE kept — ack/ntf/quality-gate/variant runtime updates).';
  END IF;

  -- ── Lifecycle ledgers: need UPDATE for status transitions → DELETE-only ────
  IF to_regclass('public.program_deployments') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON public.program_deployments FROM avi_app';
    RAISE NOTICE '[0279] program_deployments: REVOKE DELETE only (UPDATE kept — deploy status/rollback lifecycle).';
  END IF;

  IF to_regclass('public.robot_jobs') IS NOT NULL THEN
    EXECUTE 'REVOKE DELETE ON public.robot_jobs FROM avi_app';
    RAISE NOTICE '[0279] robot_jobs: REVOKE DELETE only (UPDATE kept — job status lifecycle headroom).';
  END IF;
END $$;
