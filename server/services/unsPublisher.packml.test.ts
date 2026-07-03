/**
 * doc 24 Wave-4 · C5 — unsPublisher.publishPackmlState WIRING + flag gate.
 *
 * Covers:
 *  (c) with the channel enabled, a PackML state change PUBLISHES the expected
 *      Sparkplug DBIRTH+DDATA (decoded to assert the PackML/Identity metric shape);
 *  (d) with UNS_PACKML_STATE_ENABLED OFF (legacy), NOTHING is published — no
 *      behaviour change. Also: with the Sparkplug transport off it stays a no-op.
 *
 * mqtt is mocked with a fake client that captures publish() + the connect handler.
 * db/schema/dispatcher are stubbed so the import is offline (no broker, no DB). The
 * real SparkplugNode + packmlStateBridge run so the published buffers are genuine.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { decodePayload } from "./uns/sparkplugEncoder";
import { PACKML_METRIC } from "./uns/packmlStateBridge";

// Shared fake-client capture (survives vi.resetModules — lives in test scope).
const H = vi.hoisted(() => {
  const state = {
    publishes: [] as Array<{ topic: string; buffer: Buffer }>,
    handlers: {} as Record<string, (...a: any[]) => void>,
  };
  const client: any = {
    on(ev: string, cb: (...a: any[]) => void) {
      state.handlers[ev] = cb;
      return client;
    },
    publish(topic: string, buffer: Buffer) {
      state.publishes.push({ topic, buffer });
      return client;
    },
    subscribe(_f: unknown, _o: unknown, cb?: (e?: Error) => void) {
      if (typeof cb === "function") cb();
      return client;
    },
    removeListener() {
      return client;
    },
    end(_f: boolean, _o: unknown, cb?: () => void) {
      if (typeof cb === "function") cb();
      return client;
    },
  };
  return { state, client };
});

vi.mock("mqtt", () => ({ default: { connect: () => H.client }, connect: () => H.client }));
vi.mock("./ot/commandDispatcher", () => ({
  dispatch: vi.fn(async () => ({ ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] })),
}));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("drizzle-orm", () => ({ eq: () => () => true, and: () => () => true }));
vi.mock("../../drizzle/schema", () => ({ machines: {}, deviceAdapters: {} }));

const IDENTITY = { machineId: 7, machineCode: "OVEN-1", machineType: "AUTOMATION" };

/**
 * Fresh-import unsPublisher with the given flags, open the (fake) connection, and fire
 * the connect handler so `connected` is true (+ NBIRTH when Sparkplug is enabled).
 */
async function bootstrap(packmlEnabled: boolean, sparkplugEnabled = true) {
  vi.resetModules();
  H.state.publishes.length = 0;
  H.state.handlers = {};
  vi.stubEnv("UNS_BRIDGE_ENABLED", "true");
  vi.stubEnv("UNS_SPARKPLUG_ENABLED", sparkplugEnabled ? "true" : "false");
  vi.stubEnv("UNS_PACKML_STATE_ENABLED", packmlEnabled ? "true" : "false");
  const mod = await import("./unsPublisher");
  mod.initUnsPublisher();
  H.state.handlers.connect?.();
  return mod;
}

describe("publishPackmlState — enabled channel (c)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("publishes DBIRTH + DDATA carrying the PackML state + identity", async () => {
    const mod = await bootstrap(true);
    // isolate the PackML publish from the connect-time NBIRTH
    H.state.publishes.length = 0;

    mod.publishPackmlState(
      { state: "Execute", previousState: "Starting", command: "Start", unitMode: "Production" },
      IDENTITY,
    );

    expect(H.state.publishes.length).toBeGreaterThanOrEqual(2);
    const dbirth = H.state.publishes.find((p) => p.topic.includes("/DBIRTH/"));
    const ddata = H.state.publishes.find((p) => p.topic.includes("/DDATA/"));
    expect(dbirth).toBeTruthy();
    expect(ddata).toBeTruthy();
    // device id is the machineCode
    expect(dbirth!.topic.endsWith("/OVEN-1")).toBe(true);

    const decoded = decodePayload(dbirth!.buffer);
    const byName = Object.fromEntries(decoded.metrics.map((m) => [m.name, m.value]));
    expect(String(byName[PACKML_METRIC.state])).toBe("Execute");
    expect(byName[PACKML_METRIC.machineCode]).toBe("OVEN-1");
    expect(String(byName[PACKML_METRIC.command])).toBe("Start");
  });

  it("a second transition on the same device emits DDATA only", async () => {
    const mod = await bootstrap(true);
    mod.publishPackmlState({ state: "Execute" }, IDENTITY);
    H.state.publishes.length = 0;
    mod.publishPackmlState({ state: "Holding", command: "Hold" }, IDENTITY);
    expect(H.state.publishes).toHaveLength(1);
    expect(H.state.publishes[0].topic.includes("/DDATA/")).toBe(true);
  });
});

describe("publishPackmlState — flag OFF ⇒ legacy no-op (d)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("UNS_PACKML_STATE_ENABLED off → nothing published", async () => {
    const mod = await bootstrap(false); // Sparkplug on, PackML channel OFF
    H.state.publishes.length = 0;
    mod.publishPackmlState({ state: "Execute", command: "Start" }, IDENTITY);
    expect(H.state.publishes).toHaveLength(0);
  });

  it("PackML on but Sparkplug transport off → no-op (honest: needs the transport)", async () => {
    const mod = await bootstrap(true, false); // PackML channel on, Sparkplug OFF
    H.state.publishes.length = 0;
    mod.publishPackmlState({ state: "Execute" }, IDENTITY);
    expect(H.state.publishes).toHaveLength(0);
  });
});
