/**
 * Phase E0 — Factory Control Plane: PackML / ISA-TR88.00.02 STATE MODEL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A PURE, dependency-free implementation of the standard PackML state machine.
 * It is the canonical "device state" vocabulary the Equipment Capability Model
 * (capabilityModel.ts), the Unified API (E1) and the Orchestration Engine (E2)
 * all program against — orchestration sequences by PackML STATE, not by vendor.
 *
 * SAFETY: this file has NO side-effects and NO control path. It only answers
 * "given the current PackML state + a PackML command, what is the next state?"
 * (canTransition / nextOnCommand). It NEVER writes to a device — issuing the
 * resulting command goes through the existing HITL dispatcher (equipmentAdapter).
 *
 * The model follows ISA-TR88.00.02: 17 states grouped as
 *   • WAIT states (rest):     Idle · Complete · Held · Suspended · Stopped · Aborted
 *   • ACTING states (worker): Resetting · Starting · Execute · Completing · Holding
 *                             · Unholding · Suspending · Unsuspending · Clearing
 *                             · Stopping · Aborting
 * Each ACTING state runs its logic then auto-advances ("State Complete" SC) to a
 * WAIT state; the 7 PackML commands move the cube between them.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** The 17 canonical PackML states (ISA-TR88.00.02). */
export type PackmlState =
  | "Idle"
  | "Starting"
  | "Execute"
  | "Completing"
  | "Complete"
  | "Holding"
  | "Held"
  | "Unholding"
  | "Suspending"
  | "Suspended"
  | "Unsuspending"
  | "Aborting"
  | "Aborted"
  | "Clearing"
  | "Stopping"
  | "Stopped"
  | "Resetting";

/** All 17 states as a frozen tuple (stable order for UI / iteration). */
export const PACKML_STATES = [
  "Idle",
  "Starting",
  "Execute",
  "Completing",
  "Complete",
  "Holding",
  "Held",
  "Unholding",
  "Suspending",
  "Suspended",
  "Unsuspending",
  "Aborting",
  "Aborted",
  "Clearing",
  "Stopping",
  "Stopped",
  "Resetting",
] as const satisfies readonly PackmlState[];

/** The 7 PackML operator commands (the only inputs that move the state cube). */
export type PackmlCommand =
  | "Start"
  | "Hold"
  | "Unhold"
  | "Suspend"
  | "Unsuspend"
  | "Reset"
  | "Stop"
  | "Abort"
  | "Clear";

/** All 9 PackML commands as a frozen tuple. (Unsuspend included for symmetry.) */
export const PACKML_COMMANDS = [
  "Start",
  "Hold",
  "Unhold",
  "Suspend",
  "Unsuspend",
  "Reset",
  "Stop",
  "Abort",
  "Clear",
] as const satisfies readonly PackmlCommand[];

/**
 * The "ACTING" states auto-advance to a WAIT state once their internal logic
 * completes (the ISA-TR88 "State Complete" / SC transition). Orchestration uses
 * this to know which transient states settle where.
 */
export const STATE_COMPLETE: Partial<Record<PackmlState, PackmlState>> = Object.freeze({
  Resetting: "Idle",
  Starting: "Execute",
  Completing: "Complete",
  Holding: "Held",
  Unholding: "Execute",
  Suspending: "Suspended",
  Unsuspending: "Execute",
  Clearing: "Stopped",
  Stopping: "Stopped",
  Aborting: "Aborted",
  // Execute → Completing is the machine's own work finishing, modelled separately
});

/** True for the transient "ACTING" states (a worker is running). */
export function isActingState(state: PackmlState): boolean {
  return state in STATE_COMPLETE || state === "Execute";
}

/**
 * Command → next state, evaluated PER current state. This encodes the standard
 * PackML state-transition diagram. A command absent for a state is NOT allowed
 * from that state (canTransition returns false / nextOnCommand returns null).
 *
 * Conventions (ISA-TR88):
 *   • Stop is allowed from EVERY non-resting-Stopped state → Stopping.
 *   • Abort is allowed from EVERY non-Aborted state → Aborting (panic).
 *   • Clear is only valid from Aborted → Clearing.
 *   • Reset is valid from Complete & Stopped → Resetting.
 *   • Start is valid from Idle → Starting.
 *   • Hold/Unhold/Suspend/Unsuspend operate around the Execute region.
 */
const TRANSITIONS: Record<PackmlState, Partial<Record<PackmlCommand, PackmlState>>> = {
  Idle: { Start: "Starting", Stop: "Stopping", Abort: "Aborting" },
  Starting: { Stop: "Stopping", Abort: "Aborting" },
  Execute: { Hold: "Holding", Suspend: "Suspending", Stop: "Stopping", Abort: "Aborting" },
  Completing: { Stop: "Stopping", Abort: "Aborting" },
  Complete: { Reset: "Resetting", Stop: "Stopping", Abort: "Aborting" },
  Holding: { Stop: "Stopping", Abort: "Aborting" },
  Held: { Unhold: "Unholding", Stop: "Stopping", Abort: "Aborting" },
  Unholding: { Stop: "Stopping", Abort: "Aborting" },
  Suspending: { Stop: "Stopping", Abort: "Aborting" },
  Suspended: { Unsuspend: "Unsuspending", Stop: "Stopping", Abort: "Aborting" },
  Unsuspending: { Stop: "Stopping", Abort: "Aborting" },
  Aborting: {},
  Aborted: { Clear: "Clearing" },
  Clearing: { Abort: "Aborting" },
  Stopping: { Abort: "Aborting" },
  Stopped: { Reset: "Resetting", Abort: "Aborting" },
  Resetting: { Stop: "Stopping", Abort: "Aborting" },
};

/** Commands allowed from a given state (deterministic, sorted by PACKML_COMMANDS order). */
export function allowedCommands(state: PackmlState): PackmlCommand[] {
  const map = TRANSITIONS[state] ?? {};
  return PACKML_COMMANDS.filter((c) => c in map);
}

/** True iff `command` is a legal PackML transition from `state`. */
export function canTransition(state: PackmlState, command: PackmlCommand): boolean {
  return Boolean(TRANSITIONS[state]?.[command]);
}

/**
 * The next state for a command applied to a state, or `null` if the command is
 * not allowed from that state. Fail-safe: never throws on a bad pair — returns
 * null so the caller (HITL dispatcher / orchestrator) can reject cleanly.
 */
export function nextOnCommand(state: PackmlState, command: PackmlCommand): PackmlState | null {
  return TRANSITIONS[state]?.[command] ?? null;
}

/**
 * Follow the auto "State Complete" (SC) edge of an ACTING state, or `null` for a
 * resting state. Lets a simulator/twin settle transient states deterministically.
 */
export function settleState(state: PackmlState): PackmlState | null {
  return STATE_COMPLETE[state] ?? null;
}

/** Narrow an arbitrary string to a PackmlState (fail-safe; null if not a state). */
export function asPackmlState(raw: unknown): PackmlState | null {
  return typeof raw === "string" && (PACKML_STATES as readonly string[]).includes(raw)
    ? (raw as PackmlState)
    : null;
}

/** Narrow an arbitrary string to a PackmlCommand (fail-safe; null if not a command). */
export function asPackmlCommand(raw: unknown): PackmlCommand | null {
  return typeof raw === "string" && (PACKML_COMMANDS as readonly string[]).includes(raw)
    ? (raw as PackmlCommand)
    : null;
}

/**
 * A tiny mutable state-machine helper (handy for a digital-twin / simulator).
 * Pure with respect to the outside world — it only tracks an in-memory state.
 */
export class PackmlStateMachine {
  private _state: PackmlState;
  constructor(initial: PackmlState = "Idle") {
    this._state = initial;
  }
  get state(): PackmlState {
    return this._state;
  }
  can(command: PackmlCommand): boolean {
    return canTransition(this._state, command);
  }
  /** Apply a command; returns the new state, or null (and no-op) if illegal. */
  apply(command: PackmlCommand): PackmlState | null {
    const next = nextOnCommand(this._state, command);
    if (next) this._state = next;
    return next;
  }
  /** Advance the auto SC edge once (transient → resting); no-op for resting states. */
  settle(): PackmlState {
    const next = settleState(this._state);
    if (next) this._state = next;
    return this._state;
  }
}
