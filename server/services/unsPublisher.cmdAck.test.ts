/**
 * doc 44 W0-D / G1.6 — unsPublisher.publishCmdAck unit tests.
 *
 * Proves the publisher side of the cmd_ack channel:
 *   - flag OFF (default) → publishCmdAck is a complete no-op (returns false,
 *     nothing published, no counter movement)
 *   - flag ON but broker NOT connected → returns false + failed counter (honest:
 *     nothing is fabricated or buffered)
 *   - flag ON + connected → publishes ONE JSON message on the syn/ cmd_ack topic
 *     (adapter-addressed), QoS 1, retain false, payload per LDS-L1 §8.5
 *   - client.publish throwing → returns false, failed counter, NEVER throws
 *
 * mqtt + the DB/dispatcher chain are mocked — no broker, no DB.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── hoisted fakes (vi.mock factories run before module init) ─────────────────
const h = vi.hoisted(() => {
  const handlers = new Map<string, Array<(...a: any[]) => void>>();
  const fakeClient = {
    on: vi.fn((ev: string, cb: (...a: any[]) => void) => {
      const list = handlers.get(ev) ?? [];
      list.push(cb);
      handlers.set(ev, list);
    }),
    publish: vi.fn(),
    subscribe: vi.fn(),
    removeListener: vi.fn(),
    end: vi.fn((_f: any, _o: any, cb: () => void) => cb()),
  };
  return {
    handlers,
    fakeClient,
    fire(ev: string, ...args: any[]) {
      for (const cb of handlers.get(ev) ?? []) cb(...args);
    },
  };
});

vi.mock("mqtt", () => ({ default: { connect: vi.fn(() => h.fakeClient) } }));
// Force the bridge ON without touching the module-load-cached env const.
vi.mock("./unsBridge", () => ({
  isUnsBridgeEnabled: () => true,
  normalize: vi.fn(() => []),
}));
// Cut the heavy import chains (dispatcher gates / DB). Never exercised here.
vi.mock("./ot/commandDispatcher", () => ({ dispatch: vi.fn() }));
vi.mock("../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../drizzle/schema", () => ({ machines: {}, deviceAdapters: {} }));

import {
  initUnsPublisher,
  publishCmdAck,
  isUnsCmdAckEnabled,
  getCmdAckStats,
  type CmdAckMessage,
} from "./unsPublisher";

const ack: CmdAckMessage = {
  command_id: "key-9",
  correlation_id: "corr-9",
  status: "acked",
  reason: null,
  ts: "2026-07-12T00:00:00.000Z",
  result: [{ tagKey: "cmd_start", ok: true, status: "acked" }],
};

beforeEach(() => {
  delete process.env.UNS_CMD_ACK_ENABLED;
  delete process.env.UNS_CMD_ACK_TOPIC_ROOT;
  delete process.env.UNS_ENTERPRISE_NAME;
  delete process.env.UNS_SPARKPLUG_ENABLED;
  h.fakeClient.publish.mockClear();
});

describe("G1.6 — publishCmdAck", () => {
  it("flag OFF (default) → no-op: returns false, nothing published", () => {
    expect(isUnsCmdAckEnabled()).toBe(false);
    const before = getCmdAckStats();
    expect(publishCmdAck(ack, { adapterId: 10 })).toBe(false);
    expect(h.fakeClient.publish).not.toHaveBeenCalled();
    expect(getCmdAckStats()).toEqual(before); // flag-off does not even count
  });

  it("flag ON but broker not connected → false + failed counter (honest, no buffering)", () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    const before = getCmdAckStats();
    expect(publishCmdAck(ack, { adapterId: 10 })).toBe(false);
    expect(h.fakeClient.publish).not.toHaveBeenCalled();
    const after = getCmdAckStats();
    expect(after.failed).toBe(before.failed + 1);
    expect(after.published).toBe(before.published);
  });

  it("flag ON + connected → ONE JSON publish on syn/{site}/cmd_ack/adapter/{id}, QoS 1", () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    initUnsPublisher(); // bridge mocked ON; mqtt mocked → fakeClient
    h.fire("connect"); // connected = true
    const before = getCmdAckStats();

    expect(publishCmdAck(ack, { adapterId: 10, machineId: 5 })).toBe(true);

    expect(h.fakeClient.publish).toHaveBeenCalledTimes(1);
    const [topic, buf, opts] = h.fakeClient.publish.mock.calls[0];
    expect(topic).toBe("syn/AVI-AOI/cmd_ack/adapter/10");
    expect(opts).toEqual({ qos: 1, retain: false });
    const payload = JSON.parse(String(buf));
    expect(payload).toEqual({
      command_id: "key-9",
      correlation_id: "corr-9",
      status: "acked",
      reason: null,
      ts: "2026-07-12T00:00:00.000Z",
      result: [{ tagKey: "cmd_start", ok: true, status: "acked" }],
    });
    expect(getCmdAckStats().published).toBe(before.published + 1);
  });

  it("no adapter target → 'unmapped' segment; topic root/site are env-tunable", () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    process.env.UNS_CMD_ACK_TOPIC_ROOT = "synx";
    process.env.UNS_ENTERPRISE_NAME = "PlantA";
    initUnsPublisher();
    h.fire("connect");
    expect(publishCmdAck(ack)).toBe(true);
    const [topic] = h.fakeClient.publish.mock.calls.at(-1)!;
    expect(topic).toBe("synx/PlantA/cmd_ack/unmapped");
  });

  it("client.publish throwing → returns false + failed counter, NEVER throws", () => {
    process.env.UNS_CMD_ACK_ENABLED = "true";
    initUnsPublisher();
    h.fire("connect");
    h.fakeClient.publish.mockImplementationOnce(() => { throw new Error("EPIPE"); });
    const before = getCmdAckStats();
    expect(() => publishCmdAck(ack, { adapterId: 3 })).not.toThrow();
    expect(publishCmdAck(ack, { adapterId: 3 })).toBe(true); // next publish recovers
    expect(getCmdAckStats().failed).toBe(before.failed + 1);
  });
});
