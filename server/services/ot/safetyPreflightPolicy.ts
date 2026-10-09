/**
 * doc 81 Đợt 1B final wave (item 3, final review Important #1) — ONE safety-preflight policy
 * for BOTH dispatchers.
 *
 * Before this module the OT dispatcher read `OT_SAFETY_PREFLIGHT_ENABLED` and the robot
 * dispatcher read no flag at all, while a comment on the robot side claimed the OT path "lets
 * UNKNOWN pass" (false since Task 6). An operator benching a line with the documented OT flag
 * found OT writes pass but robot motion still refused, with no flag to reach for. The two sides
 * also named the same condition differently (SAFETY_BLOCKED/UNKNOWN vs SAFETY_PLC_BLOCKED/NOT_OK).
 *
 * Rule, identical on both sides:
 *   • the preflight is ON unless the side's flag is EXACTLY the string "false" (any other value,
 *     including "0"/"off"/"", keeps it ON — fail-closed); each side has ITS OWN flag with the
 *     same default, so a bench can open one plane without the other;
 *   • a reading of BLOCKED refuses with SAFETY_BLOCKED; anything that is not OK (UNKNOWN, a read
 *     error, a hung read) refuses with SAFETY_UNKNOWN. OK is the only state that lets a real
 *     write / motion through.
 * Both dispatchers import these functions; a third read-site with a different default is the
 * defect this file exists to prevent.
 *
 * doc 81 Đợt 1C Task 1 (owner decision 2026-09-27): on a REAL write/motion a SIM safety PLC (or a
 * real endpoint with no safety tag mapped) can no longer satisfy the preflight, and a mapped safety
 * tag read with bad quality makes that config unable to vouch "clean". The rule and the one config
 * classification it uses live at the bottom of this file (actuationPreflightVerdict / effectiveBackend).
 */

/** The env flag each side reads (documented in .env.example under the OT control block). */
export const SAFETY_PREFLIGHT_FLAGS = {
  ot: "OT_SAFETY_PREFLIGHT_ENABLED",
  robot: "ROBOT_SAFETY_PREFLIGHT_ENABLED",
} as const;

/** Read at RUNTIME (operators/tests toggle). ON unless exactly "false". */
function flagEnabled(name: string): boolean {
  return process.env[name] !== "false";
}

/** OT dispatcher (commandDispatcher 5a-safety). */
export function isOtSafetyPreflightEnabled(): boolean {
  return flagEnabled(SAFETY_PREFLIGHT_FLAGS.ot);
}

/** Robot dispatcher (robotCommandDispatcher 4a-safety). Same default and semantics as OT. */
export function isRobotSafetyPreflightEnabled(): boolean {
  return flagEnabled(SAFETY_PREFLIGHT_FLAGS.robot);
}

/**
 * The one refusal vocabulary both ledgers / UIs / alerts key on.
 * doc 81 Đợt 1C Task 1 (owner decision 2026-09-27) adds SAFETY_SIM_ONLY: on a REAL write/motion
 * the only configs that read clean were SIM / real-endpoint-without-safety-tags — i.e. no real
 * safety PLC with a mapped tag is configured, so nothing real vouches for the target.
 */
export type SafetyPreflightReason = "SAFETY_BLOCKED" | "SAFETY_UNKNOWN" | "SAFETY_SIM_ONLY";

/**
 * Why an UNKNOWN reading is unknown, when the facade can say (set only by the real-actuation
 * read, see adapterFacade.getSafetyStatus({ forRealActuation: true })). "sim_only" ⇒ no enabled
 * config is a real safety PLC with a mapped tag (SAFETY_SIM_ONLY).
 */
export type SafetyUnknownBasis = "sim_only";

/**
 * Map a preflight reading that is NOT "OK" onto the refusal reason. BLOCKED (a tripped safety
 * PLC) ⇒ SAFETY_BLOCKED; UNKNOWN with basis "sim_only" ⇒ SAFETY_SIM_ONLY (Đợt 1C Task 1);
 * everything else (UNKNOWN: no configured/readable safety PLC; ERROR: the read threw or hung)
 * ⇒ SAFETY_UNKNOWN. Calling it with "OK" is a programming error.
 */
export function safetyPreflightReason(state: string, basis?: SafetyUnknownBasis | null): SafetyPreflightReason {
  if (state === "OK") throw new RangeError("safetyPreflightReason: OK is not a refusal");
  if (state === "BLOCKED") return "SAFETY_BLOCKED";
  return basis === "sim_only" ? "SAFETY_SIM_ONLY" : "SAFETY_UNKNOWN";
}

// ════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 1C Task 1 — ONE classification of a safety-PLC config, shared by the real-actuation
// preflight (adapterFacade.getSafetyStatus({ forRealActuation: true })) and the Safety panel
// (safetySourceHealth, which re-exports effectiveBackend). Moved here from safetySourceHealth.ts
// (definition unchanged) so the preflight path does not import the panel's DB/socket loaders and
// the two can never disagree on what "real" means.
// ════════════════════════════════════════════════════════════════════════════════════════

/** The four safety status flags a config can map to a PLC tag (mirror OtReadSafetyPlcBackend.tagList). */
export const SAFETY_STATUS_FLAGS = ["estop", "zoneOccupied", "resetRequired", "muting"] as const;

/**
 * What ONE enabled config actually gives getSafetyStatus (mirror of backendForConfig + read()):
 *   sim_empty     — SIM with no script (or modbus/opcua without endpoint): always all-clear ⇒ OK.
 *   sim_scripted  — SIM cycling a script: OK/BLOCKED follows a SCRIPT, not a PLC.
 *   real_unmapped — real endpoint but NO safety flag has a tag address: OtReadSafetyPlcBackend.read()
 *                   returns {} WITHOUT connecting ⇒ OK based on nothing read (Fix round 1 #1).
 *   real          — real endpoint + ≥1 of estop/zoneOccupied/resetRequired/muting mapped.
 */
export type EffectivePlcBackend = "sim_empty" | "sim_scripted" | "real_unmapped" | "real";

/** The config fields the classification reads (structural — a DB row or the panel's lite row). */
export interface PlcConfigShape {
  backend: string;
  endpoint: string | null;
  statusMap: {
    estop?: { address?: string | null } | null;
    zoneOccupied?: { address?: string | null } | null;
    resetRequired?: { address?: string | null } | null;
    muting?: { address?: string | null } | null;
    simScript?: unknown[] | null;
  } | null;
}

/**
 * Mirror `backendForConfig` + the backend's `read()`:
 *   • modbus/opcua WITH endpoint ⇒ OtReadSafetyPlcBackend; its tagList() keeps only flags that have
 *     `statusMap[flag].address` — none ⇒ read() returns {} without connecting ⇒ real_unmapped.
 *   • modbus/opcua WITHOUT endpoint ⇒ SimSafetyPlcBackend([]) (script ignored) ⇒ sim_empty.
 *   • sim ⇒ SimSafetyPlcBackend(statusMap.simScript ?? []) ⇒ empty ⇒ sim_empty, else sim_scripted.
 */
export function effectiveBackend(cfg: PlcConfigShape): EffectivePlcBackend {
  const map = cfg.statusMap ?? {};
  if (cfg.backend === "modbus" || cfg.backend === "opcua") {
    if (!cfg.endpoint) return "sim_empty";
    return SAFETY_STATUS_FLAGS.some((k) => !!map[k]?.address) ? "real" : "real_unmapped";
  }
  return (map.simScript?.length ?? 0) > 0 ? "sim_scripted" : "sim_empty";
}

/**
 * One config's contribution to a REAL-actuation preflight:
 *   clean      — read OK and no active safety flag;
 *   blocked    — ≥1 safety flag ACTIVE (estop / zone / reset-required / muting);
 *   incomplete — read OK but ≥1 mapped safety tag came back with BAD quality (or missing):
 *                that flag is unknown, so the config cannot vouch "clean" (Đợt 1C Task 1);
 *   error      — the read threw (unreachable endpoint, driver error).
 */
export type PlcReadOutcome = "clean" | "blocked" | "incomplete" | "error";

export interface PlcPreflightReading {
  kind: EffectivePlcBackend;
  outcome: PlcReadOutcome;
}

export interface ActuationPreflightVerdict {
  state: "OK" | "BLOCKED" | "UNKNOWN";
  /** Refusal reason when state ≠ OK (null when OK). */
  reason: SafetyPreflightReason | null;
}

/**
 * doc 81 Đợt 1C Task 1 — the REAL write / motion rule (owner decision 2026-09-27), in order:
 *   1. any config reads BLOCKED (sim or real)                       ⇒ BLOCKED  / SAFETY_BLOCKED
 *      (a tripped safety flag always denies — even a SIM script's, conservative as before);
 *   2. ANY `real` config is incomplete (bad-quality / missing tag) or errored (unreadable)
 *                                                                   ⇒ UNKNOWN / SAFETY_UNKNOWN
 *      — fix round 1, ruling R-1C-b: a clean PLC-B must not mask an unreadable e-stop on PLC-A.
 *      doc 81 Đợt 4 Task A1: the readings passed here are ONLY the configs that apply to the
 *      target (plcConfigAppliesToTarget below), so an offline real PLC on line 2 no longer
 *      blocks a write on line 1; untargeted configs and unresolvable targets still see every
 *      config (fail-closed). A SIM reading next to it never counts;
 *   3. ≥1 `real` config and every `real` config read CLEAN (every mapped tag good) ⇒ OK;
 *   4. configs exist but none is `real` (only sim_empty / sim_scripted / real_unmapped)
 *                                                                   ⇒ UNKNOWN / SAFETY_SIM_ONLY;
 *   5. no config at all                                             ⇒ UNKNOWN / SAFETY_UNKNOWN.
 * PURE. The panel evaluates the same function on "every config reads clean" to predict the verdict.
 */
export function actuationPreflightVerdict(readings: readonly PlcPreflightReading[]): ActuationPreflightVerdict {
  if (readings.some((r) => r.outcome === "blocked")) return { state: "BLOCKED", reason: "SAFETY_BLOCKED" };
  const real = readings.filter((r) => r.kind === "real");
  if (real.some((r) => r.outcome === "incomplete" || r.outcome === "error")) return { state: "UNKNOWN", reason: "SAFETY_UNKNOWN" };
  if (real.some((r) => r.outcome === "clean")) return { state: "OK", reason: null };
  if (readings.length > 0) return { state: "UNKNOWN", reason: "SAFETY_SIM_ONLY" };
  return { state: "UNKNOWN", reason: "SAFETY_UNKNOWN" };
}

// ════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 4 Task A1 — WHICH configs a preflight reads. ONE matcher shared by the gate
// (adapterFacade.getSafetyStatus) and the Safety panel (safetySourceHealth) — never two copies.
// ════════════════════════════════════════════════════════════════════════════════════════

/** The target-column part of a safety-PLC config (a DB row or the panel's lite row). */
export interface PlcConfigTargetShape {
  robotId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
  factoryId?: number | null;
}

/**
 * Where the command lands, resolved to the WHOLE chain (factory ← line ← station ← machine, or
 * the robot's line/station). Built only by safetyTarget.resolveSafetyTargets: a partial chain is
 * never built — anything it cannot resolve is `null` (⇒ every config applies).
 */
export interface SafetyTarget {
  robotId: number | null;
  machineId: number | null;
  /** null only for a robot placed at line level (robots.stationId NULL). */
  stationId: number | null;
  lineId: number;
  factoryId: number;
}

/**
 * doc 81 Đợt 4 Task A1 (ruling R-4-c) — does `cfg` guard `target`? PURE.
 *   • target null (could not be resolved: DB error, unknown robot/machine, unplaced robot)
 *     ⇒ TRUE for every config — never fewer than before (fail-closed);
 *   • config with NO target column set ⇒ TRUE (applies globally, as before);
 *   • otherwise the config's MOST SPECIFIC column decides — robot › station › line › factory —
 *     because the coarser columns on a targeted row are its owner/context (a line-2 PLC row also
 *     carries its factory); a line config applies to every station/machine/robot on that line, a
 *     factory config to everything in that factory, a station config to its machines and robots,
 *     a robot config to that robot only. A robot placed at line level only (no station) is
 *     guarded by every station-targeted config — its station cannot be ruled out.
 */
export function plcConfigAppliesToTarget(cfg: PlcConfigTargetShape, target: SafetyTarget | null): boolean {
  if (target === null) return true;
  if (cfg.robotId != null) return target.robotId === cfg.robotId;
  // A robot placed at line level only (robots.stationId NULL) cannot be ruled out of any station ⇒ applies.
  if (cfg.stationId != null) return target.stationId === null || target.stationId === cfg.stationId;
  if (cfg.lineId != null) return target.lineId === cfg.lineId;
  if (cfg.factoryId != null) return target.factoryId === cfg.factoryId;
  return true;
}

/**
 * doc 81 Đợt 4 fix round 1 (ruling R-4-d) — the UNION over every target a command touches (the written adapter's
 * machine + the caller's machine/robot). `null` => not resolvable => every config applies. PURE; built on the ONE
 * per-target matcher above (gate and Safety panel both call this).
 */
export function plcConfigAppliesToTargets(cfg: PlcConfigTargetShape, targets: readonly SafetyTarget[] | null): boolean {
  if (targets === null || targets.length === 0) return true;
  return targets.some((t) => plcConfigAppliesToTarget(cfg, t));
}
