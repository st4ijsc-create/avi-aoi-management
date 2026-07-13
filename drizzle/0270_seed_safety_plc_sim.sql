-- ============================================================================
-- Migration 0270 — doc 48 R1 (T1): seed ≥1 SIM safety-PLC config
--
-- WHY: commandDispatcher now runs a SAFETY-PLC PREFLIGHT before every real device
-- write (spec invariant #1 — a BLOCKED safety-PLC MUST deny actuation). The
-- preflight reads SafetyState via the adapter facade → safetyPlcAdapter, which
-- returns UNKNOWN when NO safety_plc_configs row is enabled. This seed guarantees
-- ≥1 enabled config so the path can actually be EXERCISED (OK / BLOCKED) once
-- SAFETY_PLC_ADAPTER_ENABLED=true — instead of always UNKNOWN.
--
-- ⚠ READ-ONLY / ADVISORY (mirrors 0154): this is a clearly-labelled 'sim' backend.
-- Nothing here is safety-rated; the certified Safety-PLC performs any rated stop in
-- hardware. The sim backend NEVER fabricates a fault — the seeded simScript is
-- ALL-CLEAR ⇒ getSafetyStatus() reports OK (non-blocking) when the adapter flag is on.
--
-- To EXERCISE the BLOCKED path (denies actuation with SAFETY_BLOCKED), flip the first
-- sim snapshot's estop true, e.g.:
--   UPDATE "safety_plc_configs"
--     SET "statusMap" = '{"simScript":[{"estop":true}]}'::jsonb
--     WHERE "code" = 'SIM-SAFETY-PLC-1';
--
-- IDEMPOTENT: guarded by code (no unique constraint exists on code, so INSERT..SELECT
-- ..WHERE NOT EXISTS is used rather than ON CONFLICT). Re-runnable / --force safe.
-- Inert until SAFETY_PLC_ADAPTER_ENABLED=true (default OFF) → non-breaking.
-- ============================================================================

INSERT INTO "safety_plc_configs" ("code", "name", "vendor", "backend", "statusMap", "enabled", "scope", "notes")
SELECT
  'SIM-SAFETY-PLC-1',
  'SIM Safety PLC #1 (sim backend, READ-ONLY advisory)',
  'generic',
  'sim',
  '{"simScript":[{"estop":false,"zoneOccupied":false,"resetRequired":false,"muting":false}]}'::jsonb,
  true,
  'sim',
  'doc 48 R1 (T1) seed. READ-ONLY sim safety-PLC status source so the commandDispatcher SAFETY_BLOCKED preflight reads OK (not UNKNOWN) when SAFETY_PLC_ADAPTER_ENABLED=true. Set statusMap.simScript[0].estop=true to exercise the BLOCKED (SAFETY_BLOCKED) path. NOT safety-rated — advisory monitoring only.'
WHERE NOT EXISTS (
  SELECT 1 FROM "safety_plc_configs" WHERE "code" = 'SIM-SAFETY-PLC-1'
);
