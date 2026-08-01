/**
 * SECS/GEM — E30 Communication + Control STATE MODEL tests.
 *
 * Exhaustive coverage of both pure reducers:
 *   - every documented transition (state × event → next state),
 *   - illegal / out-of-context events are fail-safe NO-OPS (state unchanged),
 *   - the observable GemStateMachine fires listeners ONLY on real transitions,
 * plus the S1F17/S1F18 online-request builders + parser round-trip.
 */
import { describe, it, expect, vi } from "vitest";

import {
  nextCommState,
  nextControlState,
  isCommunicating,
  isOnline,
  controlSuperState,
  GemStateMachine,
  type GemCommState,
  type GemCommEvent,
  type GemControlState,
  type GemControlEvent,
} from "./gemStateModel";
import {
  s1f17,
  s1f18,
  parseS1F18,
  ONLACK,
  encodeBody,
  decodeBody,
} from "./s1Messages";

// ─── Communication State reducer ──────────────────────────────────────────────

const ALL_COMM_STATES: GemCommState[] = [
  "DISABLED",
  "NOT_COMMUNICATING",
  "WAIT_CR_FROM_HOST",
  "WAIT_DELAY",
  "COMMUNICATING",
];
const ALL_COMM_EVENTS: GemCommEvent[] = [
  "ENABLE",
  "DISABLE",
  "ENTER_WAIT_CR",
  "ENTER_WAIT_DELAY",
  "WAIT_DELAY_EXPIRED",
  "COMM_ESTABLISHED",
  "COMM_FAIL",
  "COMM_TIMEOUT",
];

describe("nextCommState — documented transitions", () => {
  const cases: Array<[GemCommState, GemCommEvent, GemCommState]> = [
    // DISABLED
    ["DISABLED", "ENABLE", "NOT_COMMUNICATING"],
    // NOT_COMMUNICATING
    ["NOT_COMMUNICATING", "ENTER_WAIT_CR", "WAIT_CR_FROM_HOST"],
    ["NOT_COMMUNICATING", "ENTER_WAIT_DELAY", "WAIT_DELAY"],
    ["NOT_COMMUNICATING", "COMM_ESTABLISHED", "COMMUNICATING"],
    ["NOT_COMMUNICATING", "DISABLE", "DISABLED"],
    // WAIT_CR_FROM_HOST
    ["WAIT_CR_FROM_HOST", "COMM_ESTABLISHED", "COMMUNICATING"],
    ["WAIT_CR_FROM_HOST", "COMM_FAIL", "NOT_COMMUNICATING"],
    ["WAIT_CR_FROM_HOST", "COMM_TIMEOUT", "NOT_COMMUNICATING"],
    ["WAIT_CR_FROM_HOST", "DISABLE", "DISABLED"],
    // WAIT_DELAY
    ["WAIT_DELAY", "WAIT_DELAY_EXPIRED", "NOT_COMMUNICATING"],
    ["WAIT_DELAY", "COMM_ESTABLISHED", "COMMUNICATING"],
    ["WAIT_DELAY", "COMM_TIMEOUT", "NOT_COMMUNICATING"],
    ["WAIT_DELAY", "DISABLE", "DISABLED"],
    // COMMUNICATING
    ["COMMUNICATING", "COMM_FAIL", "NOT_COMMUNICATING"],
    ["COMMUNICATING", "COMM_TIMEOUT", "NOT_COMMUNICATING"],
    ["COMMUNICATING", "DISABLE", "DISABLED"],
  ];

  for (const [from, event, to] of cases) {
    it(`${from} --${event}--> ${to}`, () => {
      expect(nextCommState(from, event)).toBe(to);
    });
  }
});

describe("nextCommState — illegal events are fail-safe no-ops", () => {
  // Build the set of legal (state,event) pairs; every other pair must be a no-op.
  const legal = new Set<string>([
    "DISABLED|ENABLE",
    "NOT_COMMUNICATING|ENTER_WAIT_CR",
    "NOT_COMMUNICATING|ENTER_WAIT_DELAY",
    "NOT_COMMUNICATING|COMM_ESTABLISHED",
    "NOT_COMMUNICATING|DISABLE",
    "WAIT_CR_FROM_HOST|COMM_ESTABLISHED",
    "WAIT_CR_FROM_HOST|COMM_FAIL",
    "WAIT_CR_FROM_HOST|COMM_TIMEOUT",
    "WAIT_CR_FROM_HOST|DISABLE",
    "WAIT_DELAY|WAIT_DELAY_EXPIRED",
    "WAIT_DELAY|COMM_ESTABLISHED",
    "WAIT_DELAY|COMM_TIMEOUT",
    "WAIT_DELAY|DISABLE",
    "COMMUNICATING|COMM_FAIL",
    "COMMUNICATING|COMM_TIMEOUT",
    "COMMUNICATING|DISABLE",
  ]);

  for (const state of ALL_COMM_STATES) {
    for (const event of ALL_COMM_EVENTS) {
      if (legal.has(`${state}|${event}`)) continue;
      it(`${state} --${event}--> (no-op) ${state}`, () => {
        expect(nextCommState(state, event)).toBe(state);
      });
    }
  }

  it("DISABLE from DISABLED is a no-op (stays DISABLED)", () => {
    expect(nextCommState("DISABLED", "DISABLE")).toBe("DISABLED");
  });

  it("isCommunicating only true in COMMUNICATING", () => {
    for (const s of ALL_COMM_STATES) {
      expect(isCommunicating(s)).toBe(s === "COMMUNICATING");
    }
  });
});

// ─── Control State reducer ──────────────────────────────────────────────────

const ALL_CONTROL_STATES: GemControlState[] = [
  "EQUIPMENT_OFFLINE",
  "ATTEMPT_ONLINE",
  "HOST_OFFLINE",
  "ONLINE_LOCAL",
  "ONLINE_REMOTE",
];
const ALL_CONTROL_EVENTS: GemControlEvent[] = [
  "REQUEST_ONLINE",
  "ONLINE_ACCEPTED",
  "ONLINE_DENIED",
  "GO_OFFLINE",
  "HOST_GO_OFFLINE",
  "SWITCH_LOCAL",
  "SWITCH_REMOTE",
];

describe("nextControlState — documented transitions", () => {
  const cases: Array<[GemControlState, GemControlEvent, GemControlState]> = [
    // EQUIPMENT_OFFLINE
    ["EQUIPMENT_OFFLINE", "REQUEST_ONLINE", "ATTEMPT_ONLINE"],
    ["EQUIPMENT_OFFLINE", "HOST_GO_OFFLINE", "HOST_OFFLINE"],
    // ATTEMPT_ONLINE
    ["ATTEMPT_ONLINE", "ONLINE_ACCEPTED", "ONLINE_REMOTE"],
    ["ATTEMPT_ONLINE", "ONLINE_DENIED", "HOST_OFFLINE"],
    ["ATTEMPT_ONLINE", "GO_OFFLINE", "EQUIPMENT_OFFLINE"],
    ["ATTEMPT_ONLINE", "HOST_GO_OFFLINE", "HOST_OFFLINE"],
    // HOST_OFFLINE
    ["HOST_OFFLINE", "REQUEST_ONLINE", "ATTEMPT_ONLINE"],
    ["HOST_OFFLINE", "GO_OFFLINE", "EQUIPMENT_OFFLINE"],
    // ONLINE_LOCAL
    ["ONLINE_LOCAL", "SWITCH_REMOTE", "ONLINE_REMOTE"],
    ["ONLINE_LOCAL", "GO_OFFLINE", "EQUIPMENT_OFFLINE"],
    ["ONLINE_LOCAL", "HOST_GO_OFFLINE", "HOST_OFFLINE"],
    // ONLINE_REMOTE
    ["ONLINE_REMOTE", "SWITCH_LOCAL", "ONLINE_LOCAL"],
    ["ONLINE_REMOTE", "GO_OFFLINE", "EQUIPMENT_OFFLINE"],
    ["ONLINE_REMOTE", "HOST_GO_OFFLINE", "HOST_OFFLINE"],
  ];

  for (const [from, event, to] of cases) {
    it(`${from} --${event}--> ${to}`, () => {
      expect(nextControlState(from, event)).toBe(to);
    });
  }
});

describe("nextControlState — illegal events are fail-safe no-ops", () => {
  const legal = new Set<string>([
    "EQUIPMENT_OFFLINE|REQUEST_ONLINE",
    "EQUIPMENT_OFFLINE|HOST_GO_OFFLINE",
    "ATTEMPT_ONLINE|ONLINE_ACCEPTED",
    "ATTEMPT_ONLINE|ONLINE_DENIED",
    "ATTEMPT_ONLINE|GO_OFFLINE",
    "ATTEMPT_ONLINE|HOST_GO_OFFLINE",
    "HOST_OFFLINE|REQUEST_ONLINE",
    "HOST_OFFLINE|GO_OFFLINE",
    "ONLINE_LOCAL|SWITCH_REMOTE",
    "ONLINE_LOCAL|GO_OFFLINE",
    "ONLINE_LOCAL|HOST_GO_OFFLINE",
    "ONLINE_REMOTE|SWITCH_LOCAL",
    "ONLINE_REMOTE|GO_OFFLINE",
    "ONLINE_REMOTE|HOST_GO_OFFLINE",
  ]);

  for (const state of ALL_CONTROL_STATES) {
    for (const event of ALL_CONTROL_EVENTS) {
      if (legal.has(`${state}|${event}`)) continue;
      it(`${state} --${event}--> (no-op) ${state}`, () => {
        expect(nextControlState(state, event)).toBe(state);
      });
    }
  }

  it("SWITCH_LOCAL/REMOTE while OFFLINE are no-ops", () => {
    expect(nextControlState("EQUIPMENT_OFFLINE", "SWITCH_LOCAL")).toBe("EQUIPMENT_OFFLINE");
    expect(nextControlState("HOST_OFFLINE", "SWITCH_REMOTE")).toBe("HOST_OFFLINE");
  });

  it("controlSuperState / isOnline classify the super-state", () => {
    expect(controlSuperState("EQUIPMENT_OFFLINE")).toBe("OFFLINE");
    expect(controlSuperState("ATTEMPT_ONLINE")).toBe("OFFLINE");
    expect(controlSuperState("HOST_OFFLINE")).toBe("OFFLINE");
    expect(controlSuperState("ONLINE_LOCAL")).toBe("ONLINE");
    expect(controlSuperState("ONLINE_REMOTE")).toBe("ONLINE");
    expect(isOnline("ONLINE_LOCAL")).toBe(true);
    expect(isOnline("ONLINE_REMOTE")).toBe(true);
    expect(isOnline("ATTEMPT_ONLINE")).toBe(false);
  });
});

// ─── Full lifecycle sequences ─────────────────────────────────────────────────

describe("state model — lifecycle sequences", () => {
  it("comms: disabled → equipment-initiated establish → communicating", () => {
    let s: GemCommState = "DISABLED";
    s = nextCommState(s, "ENABLE");
    expect(s).toBe("NOT_COMMUNICATING");
    s = nextCommState(s, "ENTER_WAIT_DELAY");
    expect(s).toBe("WAIT_DELAY");
    s = nextCommState(s, "COMM_ESTABLISHED");
    expect(s).toBe("COMMUNICATING");
  });

  it("comms: host-initiated establish via WAIT_CR then loss + re-establish", () => {
    let s: GemCommState = "NOT_COMMUNICATING";
    s = nextCommState(s, "ENTER_WAIT_CR");
    expect(s).toBe("WAIT_CR_FROM_HOST");
    s = nextCommState(s, "COMM_ESTABLISHED");
    expect(s).toBe("COMMUNICATING");
    s = nextCommState(s, "COMM_FAIL"); // lost
    expect(s).toBe("NOT_COMMUNICATING");
  });

  it("control: offline → attempt → online-remote → local → offline", () => {
    let s: GemControlState = "EQUIPMENT_OFFLINE";
    s = nextControlState(s, "REQUEST_ONLINE");
    expect(s).toBe("ATTEMPT_ONLINE");
    s = nextControlState(s, "ONLINE_ACCEPTED");
    expect(s).toBe("ONLINE_REMOTE");
    s = nextControlState(s, "SWITCH_LOCAL");
    expect(s).toBe("ONLINE_LOCAL");
    s = nextControlState(s, "GO_OFFLINE");
    expect(s).toBe("EQUIPMENT_OFFLINE");
  });

  it("control: online request denied → host-offline, retry succeeds", () => {
    let s: GemControlState = "EQUIPMENT_OFFLINE";
    s = nextControlState(s, "REQUEST_ONLINE");
    s = nextControlState(s, "ONLINE_DENIED");
    expect(s).toBe("HOST_OFFLINE");
    s = nextControlState(s, "REQUEST_ONLINE");
    expect(s).toBe("ATTEMPT_ONLINE");
    s = nextControlState(s, "ONLINE_ACCEPTED");
    expect(s).toBe("ONLINE_REMOTE");
  });
});

// ─── Observable GemStateMachine ────────────────────────────────────────────────

describe("GemStateMachine — observable holder", () => {
  it("defaults to DISABLED / EQUIPMENT_OFFLINE and reports flags", () => {
    const m = new GemStateMachine();
    expect(m.commState).toBe("DISABLED");
    expect(m.controlState).toBe("EQUIPMENT_OFFLINE");
    expect(m.communicating).toBe(false);
    expect(m.online).toBe(false);
  });

  it("fires onCommStateChange + onCommEstablished only on real transitions", () => {
    const onCommStateChange = vi.fn();
    const onCommEstablished = vi.fn();
    const m = new GemStateMachine({ onCommStateChange, onCommEstablished });

    m.dispatchComm("ENABLE"); // DISABLED → NOT_COMMUNICATING
    m.dispatchComm("ENTER_WAIT_DELAY"); // → WAIT_DELAY
    m.dispatchComm("COMM_ESTABLISHED"); // → COMMUNICATING

    expect(onCommStateChange).toHaveBeenCalledTimes(3);
    expect(onCommEstablished).toHaveBeenCalledTimes(1);
    expect(onCommEstablished).toHaveBeenCalledWith({
      prev: "WAIT_DELAY",
      next: "COMMUNICATING",
      event: "COMM_ESTABLISHED",
    });
    expect(m.communicating).toBe(true);
  });

  it("a no-op event fires NO listener", () => {
    const onCommStateChange = vi.fn();
    const m = new GemStateMachine({ onCommStateChange });
    // COMM_ESTABLISHED from DISABLED is illegal → no-op.
    const result = m.dispatchComm("COMM_ESTABLISHED");
    expect(result).toBe("DISABLED");
    expect(onCommStateChange).not.toHaveBeenCalled();
  });

  it("fires onControlStateChange with prev/next/event on transition", () => {
    const onControlStateChange = vi.fn();
    const m = new GemStateMachine({ onControlStateChange });
    m.dispatchControl("REQUEST_ONLINE");
    m.dispatchControl("ONLINE_ACCEPTED");
    expect(onControlStateChange).toHaveBeenCalledTimes(2);
    expect(onControlStateChange).toHaveBeenLastCalledWith({
      prev: "ATTEMPT_ONLINE",
      next: "ONLINE_REMOTE",
      event: "ONLINE_ACCEPTED",
    });
    expect(m.online).toBe(true);
  });

  it("honours a custom initial state", () => {
    const m = new GemStateMachine({}, { comm: "COMMUNICATING", control: "ONLINE_LOCAL" });
    expect(m.communicating).toBe(true);
    expect(m.online).toBe(true);
  });
});

// ─── S1F17 / S1F18 round-trip ──────────────────────────────────────────────────

describe("S1F17 / S1F18 — Request ON-LINE / Acknowledge", () => {
  it("S1F17 is an empty-list W-bit request on Stream 1 Function 17", () => {
    const msg = s1f17();
    expect(msg.stream).toBe(1);
    expect(msg.streamFunction).toBe(17);
    expect(msg.wbit).toBe(true);
    expect(msg.body).toEqual({ format: "L", value: [] });
    // body round-trips through the codec.
    expect(decodeBody(encodeBody(msg))).toEqual(msg.body);
  });

  it("S1F18 carries ONLACK as a binary item and round-trips", () => {
    const msg = s1f18(ONLACK.ACCEPTED);
    expect(msg.stream).toBe(1);
    expect(msg.streamFunction).toBe(18);
    expect(msg.wbit).toBe(false);
    expect(msg.body).toEqual({ format: "B", value: [0x00] });
    const decoded = decodeBody(encodeBody(msg));
    expect(decoded).toEqual(msg.body);
    expect(parseS1F18(decoded)).toEqual({ onlack: 0x00, online: true });
  });

  it("parseS1F18 treats ACCEPTED and ALREADY_ONLINE as online", () => {
    expect(parseS1F18(decodeBody(encodeBody(s1f18(ONLACK.ACCEPTED))))).toEqual({ onlack: 0, online: true });
    expect(parseS1F18(decodeBody(encodeBody(s1f18(ONLACK.ALREADY_ONLINE))))).toEqual({ onlack: 2, online: true });
  });

  it("parseS1F18 treats NOT_ALLOWED (and unknown codes) as NOT online", () => {
    expect(parseS1F18(decodeBody(encodeBody(s1f18(ONLACK.NOT_ALLOWED))))).toEqual({ onlack: 1, online: false });
    expect(parseS1F18(decodeBody(encodeBody(s1f18(0x7f))))).toEqual({ onlack: 0x7f, online: false });
  });

  it("parseS1F18 is fail-safe on a wrong-shape body", () => {
    // An empty list (no ONLACK) → onlack 0xff, not online.
    expect(parseS1F18({ format: "L", value: [] })).toEqual({ onlack: 0xff, online: false });
    // A wrapped binary (L[ B[ONLACK] ]) is also accepted.
    expect(parseS1F18({ format: "L", value: [{ format: "B", value: [0x00] }] })).toEqual({ onlack: 0, online: true });
  });
});
