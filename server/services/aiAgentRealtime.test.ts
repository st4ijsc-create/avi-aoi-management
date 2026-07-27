/**
 * E2-4 (doc69 Giai đoạn 4/Wave E2) — realtime `ai:agents` refresh channel tests.
 *
 * Covers, without a DB and without a real Socket.IO server:
 *   • publishAiAgentEvent() — publishes a minimal, non-sensitive `ai:agent` event
 *     on the eventBus (no plan/args/secret fields), and never throws even if the
 *     underlying eventBus somehow misbehaves.
 *   • installAiAgentSocketBridge() — mirrors installEcosystemSocketBridge's
 *     subscribe-and-re-emit shape: with AI_AGENTS_LIVE_ENABLED on, an `ai:agent`
 *     bus event results in `io.to("ai:agents").emit("ai:agents", …)`; with the
 *     flag off it's a clean NO-OP (no socket emit) — the FE 5s poll stays the
 *     fallback either way.
 *
 * The choke-point tests (proposeAction/advance actually CALLING
 * publishAiAgentEvent at the right moment) live alongside their own service's
 * existing test harness — aiAgentOrchestrator.test.ts / aiCopilotActions.test.ts
 * (search "E2-4") — reusing those files' established DB mocks instead of
 * duplicating them here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eventBus, EventTypes } from "../_core/eventBus";

// Fake io — just enough surface for `io.to(room).emit(channel, payload)`.
const emitCalls: Array<{ room: string; channel: string; payload: unknown }> = [];
const fakeIo = {
  to: (room: string) => ({
    emit: (channel: string, payload: unknown) => {
      emitCalls.push({ room, channel, payload });
    },
  }),
};
const getIO = vi.fn(() => fakeIo as any);
vi.mock("../_core/socket", () => ({
  getIO: (...a: unknown[]) => getIO(...(a as [])),
}));

import { publishAiAgentEvent, installAiAgentSocketBridge, uninstallAiAgentSocketBridge } from "./aiAgentRealtime";

describe("publishAiAgentEvent — minimal, non-sensitive payload", () => {
  it("publishes on the eventBus with ONLY event/sessionId/at/kind — no plan/args/secret", () => {
    const calls: any[] = [];
    const unsub = eventBus.subscribe(EventTypes.AI_AGENT, (e) => calls.push(e));
    publishAiAgentEvent("advanced", "sess-1");
    unsub();

    expect(calls).toHaveLength(1);
    const payload = calls[0].payload;
    expect(payload).toMatchObject({ event: "advanced", sessionId: "sess-1" });
    expect(typeof payload.at).toBe("number");
    // Exhaustive key allowlist — a future edit that adds a new field here MUST
    // be a conscious, reviewed change (see the module docblock on payload safety).
    const allowedKeys = new Set(["kind", "event", "sessionId", "at"]);
    for (const k of Object.keys(payload)) expect(allowedKeys.has(k)).toBe(true);
    // Explicitly guard against the fields the brief calls out by name.
    expect(payload).not.toHaveProperty("plan");
    expect(payload).not.toHaveProperty("planJson");
    expect(payload).not.toHaveProperty("args");
    expect(payload).not.toHaveProperty("argsJson");
    expect(payload).not.toHaveProperty("token");
    expect(payload).not.toHaveProperty("secret");
    expect(payload).not.toHaveProperty("result");
    expect(payload).not.toHaveProperty("preview");
  });

  it("sessionId is optional (action_proposed/action_confirmed have none)", () => {
    const calls: any[] = [];
    const unsub = eventBus.subscribe(EventTypes.AI_AGENT, (e) => calls.push(e));
    publishAiAgentEvent("action_proposed");
    unsub();
    expect(calls[0].payload.sessionId).toBeUndefined();
    expect(calls[0].payload.event).toBe("action_proposed");
  });

  it("a throwing eventBus.publish does not escape publishAiAgentEvent", () => {
    const spy = vi.spyOn(eventBus, "publish").mockImplementation(() => {
      throw new Error("bus boom");
    });
    expect(() => publishAiAgentEvent("cancelled", "sess-2")).not.toThrow();
    spy.mockRestore();
  });
});

describe("installAiAgentSocketBridge — flag-gated NO-OP (mirrors TWIN_LIVE_ENABLED)", () => {
  const prevFlag = process.env.AI_AGENTS_LIVE_ENABLED;

  beforeEach(() => {
    emitCalls.length = 0;
    getIO.mockClear();
    uninstallAiAgentSocketBridge();
  });
  afterEach(() => {
    uninstallAiAgentSocketBridge();
    process.env.AI_AGENTS_LIVE_ENABLED = prevFlag;
  });

  it("flag OFF (default) → NO socket emit", async () => {
    process.env.AI_AGENTS_LIVE_ENABLED = "false";
    installAiAgentSocketBridge();
    publishAiAgentEvent("advanced", "sess-off");
    await new Promise((r) => setTimeout(r, 20));
    expect(emitCalls).toHaveLength(0);
  });

  it("flag ON → io.to('ai:agents').emit('ai:agents', payload)", async () => {
    process.env.AI_AGENTS_LIVE_ENABLED = "true";
    installAiAgentSocketBridge();
    publishAiAgentEvent("session_started", "sess-on");
    await new Promise((r) => setTimeout(r, 20));
    expect(emitCalls).toHaveLength(1);
    expect(emitCalls[0].room).toBe("ai:agents");
    expect(emitCalls[0].channel).toBe("ai:agents");
    expect(emitCalls[0].payload).toMatchObject({ event: "session_started", sessionId: "sess-on" });
  });

  it("install is idempotent (double install → single delivery per event)", async () => {
    process.env.AI_AGENTS_LIVE_ENABLED = "true";
    installAiAgentSocketBridge();
    installAiAgentSocketBridge();
    publishAiAgentEvent("advanced", "sess-idem");
    await new Promise((r) => setTimeout(r, 20));
    expect(emitCalls).toHaveLength(1);
  });

  it("io not yet initialized (getIO() → null) does not throw", async () => {
    process.env.AI_AGENTS_LIVE_ENABLED = "true";
    getIO.mockReturnValueOnce(null as any);
    installAiAgentSocketBridge();
    expect(() => publishAiAgentEvent("advanced", "sess-null")).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(emitCalls).toHaveLength(0);
  });

  it("other eventBus types (e.g. safety.event) are ignored — no cross-talk", async () => {
    process.env.AI_AGENTS_LIVE_ENABLED = "true";
    installAiAgentSocketBridge();
    eventBus.publish(EventTypes.SAFETY_EVENT, { eventType: "estop" }, "test");
    await new Promise((r) => setTimeout(r, 20));
    expect(emitCalls).toHaveLength(0);
  });
});
