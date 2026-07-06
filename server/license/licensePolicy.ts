/**
 * License enforcement policy — SYNAPSE §4.3 "không bao giờ dừng sản xuất vì license"
 * (doc 33 §3.3 / F4 · P2 Licensing hardening).
 *
 * THE FIX: the previous middleware blocked ALL mutations at expiry (readonly) and blocked
 * EVERYTHING 15 days later (locked) — halting the production line. SYNAPSE's iron rule is the
 * opposite: react COMMERCIALLY (negotiate), never TECHNICALLY (stop the machine). The license
 * STATUS stays honest (still reports expired/locked); only ENFORCEMENT changes so that the
 * data-recording / production-execution / SAFETY path is NEVER blocked by license state.
 *
 * Precedence per procedure (pure, testable):
 *   1. normal/warning                       → allow
 *   2. always-allowed (auth/license/health) → allow
 *   3. PRODUCTION-CRITICAL                   → allow ALWAYS (never stop the line) ★ the fix
 *   4. non-critical: `locked` degrades to `readonly` when never-stop-production is on (default)
 *      → GET allowed, POST (config/premium mutation) blocked until renewal
 *
 * The never-stop flag (LICENSE_NEVER_STOP_PRODUCTION, default TRUE) only tunes how strict
 * NON-critical config is; production-critical (rule 3) is unconditional.
 */

/**
 * Namespaces whose EVERY procedure is runtime recording / production execution / safety — these
 * must keep working even with an expired/absent license (the "never stop the line" allowlist):
 * inspection recording, production sessions, machine/OT telemetry, andon, safety/interlock,
 * alerts/notifications, command audit, quality recording. A tRPC procedure "inspection.record"
 * matches namespace "inspection". Tunable per vendor.
 */
export const RUNTIME_CRITICAL_PREFIXES: readonly string[] = [
  "inspection",
  "inspectionVariant",
  "machineStatus",
  "machineApi",
  "productionSession",
  "session",
  "andon",
  "interlock",
  "safety",
  "commandLog",
  "hotFolder",
  "qualityGate",
  "alert",
  "mqttAlert",
  "alertEscalation",
  "predictiveAlert",
  "spcAlerts",
  "notification",
];

/**
 * Namespaces that MIX runtime execution with premium CONFIG/AUTHORING. A procedure here is
 * production-critical ONLY when it is NOT a config/authoring mutation — those legitimately wait for
 * license renewal (the commercial lever). This closes the license-bypass where whole-namespace
 * matching let `robot.create` / `robot.setEnabled` / `inspectionProgram.createDraft|submit|approve|
 * release` / `field.registerDiscovered` ride the allowlist and mutate config on a lapsed license.
 * — doc 33 §11 audit fix.
 */
export const MIXED_CRITICAL_PREFIXES: readonly string[] = ["robot", "equipment", "inspectionProgram", "field"];

/**
 * Verbs (the procedure's method segment) that are config/authoring, never never-stop, even inside a
 * MIXED critical namespace. Kept to UNAMBIGUOUS config verbs so genuine runtime ops
 * (robot.sendCommand, equipment.reportStatus, inspectionProgram.<runtime>) stay critical.
 */
const CONFIG_AUTHORING_VERBS = new Set<string>([
  "create", "createDraft", "update", "delete", "remove", "setEnabled", "enable", "disable",
  "approve", "reject", "release", "submit", "publish", "register", "registerDiscovered",
  "import", "rename", "archive", "assign", "unassign", "duplicate", "clone",
  "bulkCreate", "bulkUpdate", "bulkDelete",
]);

const RUNTIME_SET = new Set(RUNTIME_CRITICAL_PREFIXES);
const MIXED_SET = new Set(MIXED_CRITICAL_PREFIXES);

/** Back-compat: the full union of namespaces that CAN be production-critical (for tuning/inspection). */
export const PRODUCTION_CRITICAL_PREFIXES: readonly string[] = [...RUNTIME_CRITICAL_PREFIXES, ...MIXED_CRITICAL_PREFIXES];

/**
 * Is a tRPC procedure part of the never-stop-production path? Runtime namespaces are always
 * critical; MIXED namespaces are critical EXCEPT for config/authoring verbs (which wait for renewal).
 */
export function isProductionCritical(procedure: string): boolean {
  const [ns, verb = ""] = procedure.split(".");
  if (RUNTIME_SET.has(ns)) return true;
  if (MIXED_SET.has(ns)) return !CONFIG_AUTHORING_VERBS.has(verb);
  return false;
}

/** Is the never-stop-production policy active? Default TRUE (SYNAPSE §4.3). */
export function neverStopProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.LICENSE_NEVER_STOP_PRODUCTION ?? "").trim().toLowerCase() !== "false";
}

export type LicenseState = "normal" | "warning" | "readonly" | "locked" | "no_license";

/**
 * Decide whether ONE procedure is allowed under the current license state. Pure.
 * `alwaysAllowed` = the auth/license/health allowlist the middleware already maintains.
 */
export function isProcedureAllowed(args: {
  procedure: string;
  method: string;
  state: LicenseState;
  alwaysAllowed: (proc: string) => boolean;
  neverStop?: boolean;
}): boolean {
  const { procedure, method, state, alwaysAllowed } = args;
  const neverStop = args.neverStop ?? neverStopProduction();

  if (state === "normal" || state === "warning") return true;
  if (alwaysAllowed(procedure)) return true;
  if (isProductionCritical(procedure)) return true; // ★ never stop the line

  // Non-critical config/premium mutation: never-stop downgrades `locked` → `readonly`.
  const eff: LicenseState = neverStop && state === "locked" ? "readonly" : state;
  if (eff === "readonly") return method.toUpperCase() === "GET"; // queries ok, mutations wait
  // strict locked / no_license: block non-critical
  return false;
}

export interface BatchDecision {
  allow: boolean;
  /** Error code for the blocked batch (when !allow). */
  code: "LICENSE_READONLY" | "LICENSE_LOCKED" | "NO_LICENSE" | null;
}

/**
 * Decide a whole tRPC batch: allowed iff EVERY procedure is allowed. Returns a representative
 * error code for the current state (for the 403 body) when blocked.
 */
export function decideLicenseBatch(args: {
  procedures: string[];
  method: string;
  state: LicenseState;
  alwaysAllowed: (proc: string) => boolean;
  neverStop?: boolean;
}): BatchDecision {
  const { procedures, method, state, alwaysAllowed } = args;
  const neverStop = args.neverStop ?? neverStopProduction();
  const allow = procedures.every((procedure) =>
    isProcedureAllowed({ procedure, method, state, alwaysAllowed, neverStop }),
  );
  if (allow) return { allow: true, code: null };
  const eff: LicenseState = neverStop && state === "locked" ? "readonly" : state;
  const code =
    eff === "readonly"
      ? "LICENSE_READONLY"
      : state === "no_license"
        ? "NO_LICENSE"
        : "LICENSE_LOCKED";
  return { allow: false, code };
}
