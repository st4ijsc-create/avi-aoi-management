/**
 * Plugin lifecycle state machine — SYNAPSE §6.4.3 (doc 33 §3.2 / F3 · P4 out-of-process).
 *
 * Full vòng đời: install → discover → configure → validate → run → drain → upgrade/rollback →
 * uninstall. `validate` MUST pass before `run` (kết nối thử + kiểm tra kiểu dữ liệu mẫu). Pure,
 * testable transition guard — the supervisor drives an out-of-process plugin through these.
 */

export type PluginPhase =
  | "installed"
  | "discovered"
  | "configured"
  | "validating"
  | "validated"
  | "running"
  | "draining"
  | "stopped"
  | "upgrading"
  | "failed"
  | "uninstalled";

export type PluginAction =
  | "discover"
  | "configure"
  | "validate"
  | "validate_ok"
  | "validate_fail"
  | "run"
  | "drain"
  | "stop"
  | "upgrade"
  | "upgrade_done"
  | "fail"
  | "uninstall";

/** Allowed transitions: phase → (action → next phase). Anything else is rejected. */
const TRANSITIONS: Record<PluginPhase, Partial<Record<PluginAction, PluginPhase>>> = {
  installed: { discover: "discovered", uninstall: "uninstalled" },
  discovered: { configure: "configured", uninstall: "uninstalled" },
  configured: { validate: "validating", configure: "configured", uninstall: "uninstalled" },
  validating: { validate_ok: "validated", validate_fail: "failed" },
  // `run` is ONLY reachable from `validated` — the hard gate.
  validated: { run: "running", configure: "configured", uninstall: "uninstalled" },
  running: { drain: "draining", fail: "failed", upgrade: "upgrading" },
  draining: { stop: "stopped", fail: "failed" },
  stopped: { run: "running", configure: "configured", upgrade: "upgrading", uninstall: "uninstalled" },
  upgrading: { upgrade_done: "stopped", fail: "failed" },
  failed: { configure: "configured", uninstall: "uninstalled", validate: "validating" },
  uninstalled: {},
};

export interface TransitionResult {
  ok: boolean;
  from: PluginPhase;
  to?: PluginPhase;
  error?: string;
}

/** Attempt a transition. Pure — returns the next phase or an error (never throws). */
export function transition(from: PluginPhase, action: PluginAction): TransitionResult {
  const to = TRANSITIONS[from]?.[action];
  if (!to) return { ok: false, from, error: `illegal transition: ${from} --${action}--> ?` };
  return { ok: true, from, to };
}

/** Is the plugin allowed to serve traffic (only in `running`)? */
export function isServing(phase: PluginPhase): boolean {
  return phase === "running";
}

/** Terminal phases. */
export function isTerminal(phase: PluginPhase): boolean {
  return phase === "uninstalled";
}

/** The hard gate: a plugin can NEVER reach `running` without passing through `validated`. */
export function canRun(phase: PluginPhase): boolean {
  return transition(phase, "run").ok;
}
