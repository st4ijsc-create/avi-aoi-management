/**
 * SECS/GEM — E30 Communication + Control STATE MODELS (pure reducers).
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * This file implements the two SEMI E30 (GEM) top-level state models as PURE,
 * deterministic finite state machines with the standard sub-states:
 *
 *   COMMUNICATION STATE model:
 *     DISABLED  ↔  ENABLED { NOT_COMMUNICATING → { WAIT_CR_FROM_HOST | WAIT_DELAY }
 *                                              → COMMUNICATING }
 *
 *   CONTROL STATE model:
 *     OFFLINE { EQUIPMENT_OFFLINE, ATTEMPT_ONLINE, HOST_OFFLINE }
 *       ↔  ONLINE { LOCAL, REMOTE }
 *
 * What this file IS: the deterministic transition logic (`nextCommState` /
 * `nextControlState`), the event vocabulary, and a tiny observable holder
 * (`GemStateMachine`) that applies events and notifies listeners of changes.
 * It is IO-free: no sockets, no timers run *inside* the reducers — the CALLER
 * drives events (including the comms/timeout events). Fail-safe: an event that
 * has no defined transition from the current state is a NO-OP (state unchanged).
 *
 * What this file is NOT (deliberately out of scope — driven elsewhere or not at
 * all in this framework):
 *   - Collection Events / Data Variables / Status Variables report linking
 *     (S2F33/F35/F37) — not implemented.
 *   - Spooling (S2F43/F45, spool state) — not implemented.
 *   - Alarms (S5), recipe management (S7) — not implemented.
 *   - The full T1–T8 protocol timer set — NOT implemented here. The reducers
 *     accept a single `COMM_TIMEOUT` (T-comm, i.e. the establish-communications
 *     retry timeout) and `WAIT_DELAY_EXPIRED` event that the caller raises from
 *     its own timer; the FSM itself starts/stops no timers.
 *   - This is the STATE MODEL only. The connectivity S1 messages that DRIVE the
 *     comm handshake (S1F13/F14) and the online request (S1F17/F18) live in
 *     s1Messages.ts; the wiring that maps HSMS + those messages onto this FSM
 *     lives in gemStateModel wiring below (`GemStateMachine`) and hsmsClient.
 *
 * This is READ/MONITOR oriented. The only "write" the model participates in is
 * the standard ONLINE-request handshake (S1F17/S1F18) — no recipe/parameter/
 * host-command write path is modelled.
 */

// ─── Communication State model (SEMI E30) ────────────────────────────────────

/**
 * GEM Communication State — the full E30 sub-state set.
 *   DISABLED                 — operator/host has NOT enabled communications.
 *   NOT_COMMUNICATING        — ENABLED but comms not yet established (transient
 *                              parent; entered on ENABLE, then immediately the
 *                              equipment picks WAIT_CR_FROM_HOST or WAIT_DELAY).
 *   WAIT_CR_FROM_HOST        — ENABLED, awaiting an S1F13 (Communication Request)
 *                              from the host (equipment is the responder).
 *   WAIT_DELAY               — ENABLED, waiting out the retry delay before the
 *                              equipment re-sends its own S1F13.
 *   COMMUNICATING            — S1F13/S1F14 handshake succeeded (COMMACK=accepted).
 */
export type GemCommState =
  | "DISABLED"
  | "NOT_COMMUNICATING"
  | "WAIT_CR_FROM_HOST"
  | "WAIT_DELAY"
  | "COMMUNICATING";

/**
 * Communication-state events (caller-driven):
 *   ENABLE / DISABLE          — operator/host enable/disable of communications.
 *   ENTER_WAIT_CR             — equipment chose to wait for the host's S1F13.
 *   ENTER_WAIT_DELAY          — equipment chose to wait out the retry delay
 *                               before sending its own S1F13.
 *   WAIT_DELAY_EXPIRED        — the retry delay elapsed; attempt the handshake.
 *   COMM_ESTABLISHED          — S1F13/S1F14 handshake succeeded (COMMACK accepted).
 *   COMM_FAIL                 — the handshake failed / was denied (COMMACK denied).
 *   COMM_TIMEOUT              — the establish-comms timeout (T-comm) fired while
 *                               waiting; fall back to NOT_COMMUNICATING to retry.
 */
export type GemCommEvent =
  | "ENABLE"
  | "DISABLE"
  | "ENTER_WAIT_CR"
  | "ENTER_WAIT_DELAY"
  | "WAIT_DELAY_EXPIRED"
  | "COMM_ESTABLISHED"
  | "COMM_FAIL"
  | "COMM_TIMEOUT";

/**
 * Pure Communication-State reducer. Deterministic and total: every (state,event)
 * pair maps to a next state, and any transition NOT explicitly defined returns
 * the input state unchanged (fail-safe no-op). No IO, no timers.
 *
 * Transition table:
 *   DISABLED
 *     ENABLE               → NOT_COMMUNICATING
 *   NOT_COMMUNICATING
 *     ENTER_WAIT_CR        → WAIT_CR_FROM_HOST
 *     ENTER_WAIT_DELAY     → WAIT_DELAY
 *     COMM_ESTABLISHED     → COMMUNICATING   (host-initiated handshake completed)
 *     DISABLE              → DISABLED
 *   WAIT_CR_FROM_HOST
 *     COMM_ESTABLISHED     → COMMUNICATING
 *     COMM_FAIL            → NOT_COMMUNICATING
 *     COMM_TIMEOUT         → NOT_COMMUNICATING
 *     DISABLE              → DISABLED
 *   WAIT_DELAY
 *     WAIT_DELAY_EXPIRED   → NOT_COMMUNICATING  (re-attempt: pick a wait sub-state)
 *     COMM_ESTABLISHED     → COMMUNICATING
 *     COMM_TIMEOUT         → NOT_COMMUNICATING
 *     DISABLE              → DISABLED
 *   COMMUNICATING
 *     COMM_FAIL            → NOT_COMMUNICATING  (comms lost; re-establish)
 *     COMM_TIMEOUT         → NOT_COMMUNICATING
 *     DISABLE              → DISABLED
 */
export function nextCommState(state: GemCommState, event: GemCommEvent): GemCommState {
  // DISABLE is universal within ENABLED: from any enabled sub-state → DISABLED.
  if (event === "DISABLE") return "DISABLED";

  switch (state) {
    case "DISABLED":
      return event === "ENABLE" ? "NOT_COMMUNICATING" : state;

    case "NOT_COMMUNICATING":
      switch (event) {
        case "ENTER_WAIT_CR":
          return "WAIT_CR_FROM_HOST";
        case "ENTER_WAIT_DELAY":
          return "WAIT_DELAY";
        case "COMM_ESTABLISHED":
          return "COMMUNICATING";
        default:
          return state;
      }

    case "WAIT_CR_FROM_HOST":
      switch (event) {
        case "COMM_ESTABLISHED":
          return "COMMUNICATING";
        case "COMM_FAIL":
        case "COMM_TIMEOUT":
          return "NOT_COMMUNICATING";
        default:
          return state;
      }

    case "WAIT_DELAY":
      switch (event) {
        case "COMM_ESTABLISHED":
          return "COMMUNICATING";
        case "WAIT_DELAY_EXPIRED":
        case "COMM_TIMEOUT":
          return "NOT_COMMUNICATING";
        default:
          return state;
      }

    case "COMMUNICATING":
      switch (event) {
        case "COMM_FAIL":
        case "COMM_TIMEOUT":
          return "NOT_COMMUNICATING";
        default:
          return state;
      }

    default:
      // Exhaustive over GemCommState; unreachable. Fail-safe no-op.
      return state;
  }
}

/** True once communications are established (E30 COMMUNICATING). */
export function isCommunicating(state: GemCommState): boolean {
  return state === "COMMUNICATING";
}

// ─── Control State model (SEMI E30) ──────────────────────────────────────────

/**
 * GEM Control State — the full E30 sub-state set (parents OFFLINE / ONLINE).
 *   EQUIPMENT_OFFLINE — offline; the equipment itself is offline.
 *   ATTEMPT_ONLINE    — offline; an online attempt is in progress (S1F17 sent,
 *                       awaiting S1F18).
 *   HOST_OFFLINE      — offline; the host requested offline (or denied online).
 *   ONLINE_LOCAL      — online, LOCAL control (operator has local command).
 *   ONLINE_REMOTE     — online, REMOTE control (host has remote command).
 */
export type GemControlState =
  | "EQUIPMENT_OFFLINE"
  | "ATTEMPT_ONLINE"
  | "HOST_OFFLINE"
  | "ONLINE_LOCAL"
  | "ONLINE_REMOTE";

/** The OFFLINE / ONLINE super-state a control sub-state belongs to. */
export function controlSuperState(state: GemControlState): "OFFLINE" | "ONLINE" {
  return state === "ONLINE_LOCAL" || state === "ONLINE_REMOTE" ? "ONLINE" : "OFFLINE";
}

/**
 * Control-state events (caller-driven):
 *   REQUEST_ONLINE       — an online attempt begins (S1F17 about to be / just sent).
 *   ONLINE_ACCEPTED      — S1F18 ONLACK=accepted; go online. Default sub-state is
 *                          REMOTE unless a LOCAL/REMOTE switch says otherwise.
 *   ONLINE_DENIED        — S1F18 ONLACK=denied/already-online-refused; stay offline.
 *   GO_OFFLINE           — equipment/operator forced offline (equipment offline).
 *   HOST_GO_OFFLINE      — host requested the equipment go offline.
 *   SWITCH_LOCAL         — online local/remote switch → LOCAL.
 *   SWITCH_REMOTE        — online local/remote switch → REMOTE.
 */
export type GemControlEvent =
  | "REQUEST_ONLINE"
  | "ONLINE_ACCEPTED"
  | "ONLINE_DENIED"
  | "GO_OFFLINE"
  | "HOST_GO_OFFLINE"
  | "SWITCH_LOCAL"
  | "SWITCH_REMOTE";

/**
 * Pure Control-State reducer. Deterministic and total; undefined transitions are
 * fail-safe no-ops. No IO, no timers.
 *
 * Transition table:
 *   EQUIPMENT_OFFLINE
 *     REQUEST_ONLINE   → ATTEMPT_ONLINE
 *     HOST_GO_OFFLINE  → HOST_OFFLINE
 *   ATTEMPT_ONLINE
 *     ONLINE_ACCEPTED  → ONLINE_REMOTE      (default online sub-state = REMOTE)
 *     ONLINE_DENIED    → HOST_OFFLINE
 *     GO_OFFLINE       → EQUIPMENT_OFFLINE
 *     HOST_GO_OFFLINE  → HOST_OFFLINE
 *   HOST_OFFLINE
 *     REQUEST_ONLINE   → ATTEMPT_ONLINE
 *     GO_OFFLINE       → EQUIPMENT_OFFLINE
 *   ONLINE_LOCAL
 *     SWITCH_REMOTE    → ONLINE_REMOTE
 *     GO_OFFLINE       → EQUIPMENT_OFFLINE
 *     HOST_GO_OFFLINE  → HOST_OFFLINE
 *   ONLINE_REMOTE
 *     SWITCH_LOCAL     → ONLINE_LOCAL
 *     GO_OFFLINE       → EQUIPMENT_OFFLINE
 *     HOST_GO_OFFLINE  → HOST_OFFLINE
 *
 * Note: SWITCH_LOCAL / SWITCH_REMOTE only apply while ONLINE (a switch event
 * received while OFFLINE is a no-op — you cannot pick a control sub-state you
 * are not in). ONLINE_ACCEPTED is only meaningful from ATTEMPT_ONLINE.
 */
export function nextControlState(state: GemControlState, event: GemControlEvent): GemControlState {
  switch (state) {
    case "EQUIPMENT_OFFLINE":
      switch (event) {
        case "REQUEST_ONLINE":
          return "ATTEMPT_ONLINE";
        case "HOST_GO_OFFLINE":
          return "HOST_OFFLINE";
        default:
          return state;
      }

    case "ATTEMPT_ONLINE":
      switch (event) {
        case "ONLINE_ACCEPTED":
          return "ONLINE_REMOTE";
        case "ONLINE_DENIED":
          return "HOST_OFFLINE";
        case "GO_OFFLINE":
          return "EQUIPMENT_OFFLINE";
        case "HOST_GO_OFFLINE":
          return "HOST_OFFLINE";
        default:
          return state;
      }

    case "HOST_OFFLINE":
      switch (event) {
        case "REQUEST_ONLINE":
          return "ATTEMPT_ONLINE";
        case "GO_OFFLINE":
          return "EQUIPMENT_OFFLINE";
        default:
          return state;
      }

    case "ONLINE_LOCAL":
      switch (event) {
        case "SWITCH_REMOTE":
          return "ONLINE_REMOTE";
        case "GO_OFFLINE":
          return "EQUIPMENT_OFFLINE";
        case "HOST_GO_OFFLINE":
          return "HOST_OFFLINE";
        default:
          return state;
      }

    case "ONLINE_REMOTE":
      switch (event) {
        case "SWITCH_LOCAL":
          return "ONLINE_LOCAL";
        case "GO_OFFLINE":
          return "EQUIPMENT_OFFLINE";
        case "HOST_GO_OFFLINE":
          return "HOST_OFFLINE";
        default:
          return state;
      }

    default:
      // Exhaustive over GemControlState; unreachable. Fail-safe no-op.
      return state;
  }
}

/** True once online in either LOCAL or REMOTE control. */
export function isOnline(state: GemControlState): boolean {
  return controlSuperState(state) === "ONLINE";
}

// ─── Observable holder (thin, still IO-free) ─────────────────────────────────

/**
 * State-change notification payloads. `prev`/`next` are the sub-states; a change
 * is emitted ONLY when the reducer actually moved (a no-op does not notify).
 */
export interface CommStateChange {
  prev: GemCommState;
  next: GemCommState;
  event: GemCommEvent;
}
export interface ControlStateChange {
  prev: GemControlState;
  next: GemControlState;
  event: GemControlEvent;
}

/** Listener callbacks. The module uses no shared eventBus, so callers subscribe here. */
export interface GemStateListeners {
  /** Fired the first time (and each subsequent time) comms reach COMMUNICATING. */
  onCommEstablished?: (change: CommStateChange) => void;
  /** Fired on any Communication-State change (including into/out of COMMUNICATING). */
  onCommStateChange?: (change: CommStateChange) => void;
  /** Fired on any Control-State change. */
  onControlStateChange?: (change: ControlStateChange) => void;
}

/**
 * A tiny stateful holder around the pure reducers. It keeps the current comm +
 * control states, applies caller-driven events via the pure reducers, and fires
 * listener callbacks ONLY on real transitions. It runs no timers and performs no
 * IO — it is safe to construct and drive with the master flag OFF (the FLAG is
 * enforced by the wiring that decides whether to *send* real SECS messages, not
 * by this holder). Deterministic: the same event sequence always yields the same
 * states + notifications.
 */
export class GemStateMachine {
  private _comm: GemCommState;
  private _control: GemControlState;

  constructor(
    private readonly listeners: GemStateListeners = {},
    initial: { comm?: GemCommState; control?: GemControlState } = {},
  ) {
    this._comm = initial.comm ?? "DISABLED";
    this._control = initial.control ?? "EQUIPMENT_OFFLINE";
  }

  get commState(): GemCommState {
    return this._comm;
  }
  get controlState(): GemControlState {
    return this._control;
  }
  get communicating(): boolean {
    return isCommunicating(this._comm);
  }
  get online(): boolean {
    return isOnline(this._control);
  }

  /** Apply a Communication-State event. Returns the (possibly unchanged) new state. */
  dispatchComm(event: GemCommEvent): GemCommState {
    const prev = this._comm;
    const next = nextCommState(prev, event);
    if (next === prev) return prev; // fail-safe no-op → no notification
    this._comm = next;
    const change: CommStateChange = { prev, next, event };
    this.listeners.onCommStateChange?.(change);
    if (next === "COMMUNICATING") this.listeners.onCommEstablished?.(change);
    return next;
  }

  /** Apply a Control-State event. Returns the (possibly unchanged) new state. */
  dispatchControl(event: GemControlEvent): GemControlState {
    const prev = this._control;
    const next = nextControlState(prev, event);
    if (next === prev) return prev; // fail-safe no-op → no notification
    this._control = next;
    this.listeners.onControlStateChange?.({ prev, next, event });
    return next;
  }
}
