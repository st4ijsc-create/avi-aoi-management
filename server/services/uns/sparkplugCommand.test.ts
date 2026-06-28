/**
 * Sprint F4 HITL — sparkplugCommand: inbound NCMD/DCMD decode + safe routing.
 *
 * Covers:
 *   - NCMD "Node Control/Rebirth" → triggers onRebirth (mock), no dispatch.
 *   - DCMD device command → routes to the dispatcher in DRY-RUN (simulated:true),
 *     asserts NO real execute (mock dispatch returns simulated; never writes HW).
 *   - malformed payload → dropped, no throw, no dispatch.
 *   - flag OFF → start() does not subscribe.
 *
 * Real Sparkplug protobuf is used for the payloads (encodePayload) so the decode
 * path is exercised end-to-end; MQTT + dispatcher + rebirth are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { encodePayload } from "./sparkplugEncoder";
import {
  SparkplugCommandHandler,
  REBIRTH_METRIC,
  commandTopicFilters,
  parseCommandTopic,
  type SparkplugCommandDeps,
  type MachineTarget,
} from "./sparkplugCommand";
import type { DispatchInput, DispatchResult } from "../ot/commandDispatcher";

const GROUP = "avi";
const NODE = "avi-aoi-ot";
const DEVICE = "Station45";

/** A simulated (dry-run) dispatch result — what dispatch() returns by default. */
function simulatedResult(): DispatchResult {
  return { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] };
}

function makeDeps(over: Partial<SparkplugCommandDeps> = {}): {
  deps: SparkplugCommandDeps;
  dispatch: ReturnType<typeof vi.fn>;
  onRebirth: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
} {
  const dispatch = vi.fn(async (_input: DispatchInput) => simulatedResult());
  const onRebirth = vi.fn(() => {});
  const subscribe = vi.fn(() => {});
  const target: MachineTarget = { machineId: 7, adapterId: 3 };
  const deps: SparkplugCommandDeps = {
    subscribe,
    dispatch,
    onRebirth,
    resolveTarget: () => target,
    // Map a DCMD metric "cmd_stop" → a stop write; ignore anything else.
    metricToWrite: (m) =>
      m.name === "cmd_stop"
        ? { tagKey: "cmd_stop", value: m.value, commandType: "stop" }
        : null,
    systemUserId: 0,
    log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    ...over,
  };
  return { deps, dispatch, onRebirth, subscribe };
}

const ORIG = process.env.SPARKPLUG_COMMAND_ENABLED;
beforeEach(() => {
  process.env.SPARKPLUG_COMMAND_ENABLED = "true";
});
afterEach(() => {
  if (ORIG === undefined) delete process.env.SPARKPLUG_COMMAND_ENABLED;
  else process.env.SPARKPLUG_COMMAND_ENABLED = ORIG;
});

describe("parseCommandTopic", () => {
  it("parses NCMD (no device)", () => {
    expect(parseCommandTopic(`spBv1.0/${GROUP}/NCMD/${NODE}`)).toEqual({
      kind: "NCMD",
      groupId: GROUP,
      edgeNodeId: NODE,
    });
  });
  it("parses DCMD (with device)", () => {
    expect(parseCommandTopic(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`)).toEqual({
      kind: "DCMD",
      groupId: GROUP,
      edgeNodeId: NODE,
      deviceId: DEVICE,
    });
  });
  it("rejects non-command / malformed topics", () => {
    expect(parseCommandTopic(`spBv1.0/${GROUP}/DDATA/${NODE}/${DEVICE}`)).toBeNull();
    expect(parseCommandTopic(`spBv1.0/${GROUP}/NCMD/${NODE}/${DEVICE}`)).toBeNull(); // NCMD w/ device
    expect(parseCommandTopic(`spBv1.0/${GROUP}/DCMD/${NODE}`)).toBeNull(); // DCMD w/o device
    expect(parseCommandTopic("garbage")).toBeNull();
  });
});

describe("commandTopicFilters", () => {
  it("returns NCMD + DCMD wildcard filters", () => {
    expect(commandTopicFilters(GROUP, NODE)).toEqual([
      `spBv1.0/${GROUP}/NCMD/${NODE}`,
      `spBv1.0/${GROUP}/DCMD/${NODE}/+`,
    ]);
  });
});

describe("SparkplugCommandHandler — NCMD Rebirth", () => {
  it("decodes NCMD Rebirth → triggers rebirth (mock), no dispatch", async () => {
    const { deps, dispatch, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({
      timestamp: Date.now(),
      metrics: [{ name: REBIRTH_METRIC, type: "Boolean", value: true }],
    });
    const cmd = await handler.handleMessage(`spBv1.0/${GROUP}/NCMD/${NODE}`, payload);
    expect(cmd?.kind).toBe("NCMD");
    expect(onRebirth).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("ignores NCMD Rebirth with value=false", async () => {
    const { deps, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({
      metrics: [{ name: REBIRTH_METRIC, type: "Boolean", value: false }],
    });
    await handler.handleMessage(`spBv1.0/${GROUP}/NCMD/${NODE}`, payload);
    expect(onRebirth).not.toHaveBeenCalled();
  });
});

describe("SparkplugCommandHandler — DCMD routes to dispatcher (DRY-RUN)", () => {
  it("decodes DCMD device command → dispatches HITL trigger, simulated (no real execute)", async () => {
    const { deps, dispatch, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({
      metrics: [{ name: "cmd_stop", type: "Boolean", value: true }],
    });
    await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, payload);

    expect(dispatch).toHaveBeenCalledTimes(1);
    const input = dispatch.mock.calls[0][0] as DispatchInput;
    expect(input.machineId).toBe(7);
    expect(input.adapterId).toBe(3);
    expect(input.commandType).toBe("stop");
    expect(input.writes).toEqual([{ tagKey: "cmd_stop", value: true }]);
    // HITL trigger with NO actionId → flows through dispatcher gates (dry-run).
    expect(input.triggeredBy.kind).toBe("hitl");
    expect((input.triggeredBy as { actionId?: string }).actionId).toBeUndefined();
    // The mock dispatch returned simulated → confirms the DRY-RUN contract.
    await expect(dispatch.mock.results[0].value).resolves.toMatchObject({ simulated: true });
    expect(onRebirth).not.toHaveBeenCalled();
  });

  it("drops a DCMD when no machine maps (resolveTarget → null), no dispatch", async () => {
    const { deps, dispatch } = makeDeps({ resolveTarget: () => null });
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: "cmd_stop", type: "Boolean", value: true }] });
    await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, payload);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("ignores unknown metrics (metricToWrite → null), no dispatch", async () => {
    const { deps, dispatch } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: "unknown_metric", type: "Int64", value: 1 }] });
    await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, payload);
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("SparkplugCommandHandler — fail-safe", () => {
  it("malformed payload → dropped, no throw, no dispatch/rebirth", async () => {
    const { deps, dispatch, onRebirth } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const garbage = Buffer.from([0xff, 0xfe, 0x00, 0x11, 0x22, 0x33]);
    let cmd: unknown;
    await expect(
      (async () => {
        cmd = await handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, garbage);
      })(),
    ).resolves.not.toThrow();
    expect(cmd).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
    expect(onRebirth).not.toHaveBeenCalled();
  });

  it("non-command topic → dropped, no dispatch", async () => {
    const { deps, dispatch } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: "cmd_stop", type: "Boolean", value: true }] });
    const cmd = await handler.handleMessage(`spBv1.0/${GROUP}/DDATA/${NODE}/${DEVICE}`, payload);
    expect(cmd).toBeUndefined();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatch throwing does NOT escape the handler", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("boom");
    });
    const { deps } = makeDeps({ dispatch });
    const handler = new SparkplugCommandHandler(deps);
    const payload = encodePayload({ metrics: [{ name: "cmd_stop", type: "Boolean", value: true }] });
    await expect(
      handler.handleMessage(`spBv1.0/${GROUP}/DCMD/${NODE}/${DEVICE}`, payload),
    ).resolves.toBeDefined();
  });
});

describe("SparkplugCommandHandler — flag gating", () => {
  it("flag OFF → start() does not subscribe", () => {
    delete process.env.SPARKPLUG_COMMAND_ENABLED;
    const { deps, subscribe } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const ok = handler.start(GROUP, NODE);
    expect(ok).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("flag ON → start() subscribes to NCMD/DCMD filters", () => {
    process.env.SPARKPLUG_COMMAND_ENABLED = "true";
    const { deps, subscribe } = makeDeps();
    const handler = new SparkplugCommandHandler(deps);
    const ok = handler.start(GROUP, NODE);
    expect(ok).toBe(true);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(subscribe.mock.calls[0][0]).toEqual([
      `spBv1.0/${GROUP}/NCMD/${NODE}`,
      `spBv1.0/${GROUP}/DCMD/${NODE}/+`,
    ]);
  });
});
