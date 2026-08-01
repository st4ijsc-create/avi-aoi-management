/**
 * W7-1 (doc 44 gap G1.14) — EDGE GATEWAY RUNTIME tests (vitest, no broker/DB).
 *
 * Covers:
 *   • bufferUnsSample routes an OtSample → the edge UNS store-and-forward.
 *   • getEdgeGatewayHealth reports DEGRADED while central is unreachable OR a buffer
 *     has a backlog; online only when reachable + empty.
 *   • sendHeartbeat reports the degraded status to the edge_nodes registry.
 *   • publishPendingUns replays through the UNS publisher (all-or-nothing on the
 *     broker-connected gate) IN ORDER; a disconnected broker sends nothing.
 *   • wireUnsStoreForward + backfillUns drain the buffer in order once reachable.
 *   • the entrypoint binds NO HTTP / socket / MQTT broker (source guard).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { RuntimeAdapter } from "../ot/deviceAdapter";
import type { OtSample } from "../ot/otDriver";

// ── mock the northbound UNS publisher (no mqtt, no broker) ──
const unsState = { connected: false };
const spCalls: Array<{ deviceId: string; metrics: unknown[] }> = [];
const normCalls: Array<{ topic: string; payload: unknown }> = [];
vi.mock("../unsPublisher", () => ({
  isUnsPublisherConnected: () => unsState.connected,
  publishSparkplugDData: (deviceId: string, metrics: unknown[]) => spCalls.push({ deviceId, metrics }),
  publishNormalized: (topic: string, payload: unknown) => normCalls.push({ topic, payload }),
  initUnsPublisher: () => undefined,
  shutdownUnsPublisher: async () => undefined,
  publishNdeathGraceful: async () => undefined,
}));

// ── mock the edge_nodes registry (no DB) ──
const registerCalls: unknown[] = [];
const heartbeatCalls: Array<{ code: string; status?: string; health?: Record<string, unknown> }> = [];
vi.mock("./edgeCoordinator", () => ({
  registerNode: async (input: unknown) => {
    registerCalls.push(input);
    return { ok: true, enabled: true, data: {} };
  },
  heartbeat: async (input: { code: string; status?: string; health?: Record<string, unknown> }) => {
    heartbeatCalls.push(input);
    return { ok: true, enabled: true, data: {} };
  },
}));

// ── mock otManager so no native OT deps / no live adapters are pulled in ──
vi.mock("../ot/otManager", () => ({
  listActiveAdapters: () => [] as RuntimeAdapter[],
}));

import {
  edgeGatewayModeEnabled,
  bufferUnsSample,
  buildPendingUnsSample,
  getEdgeGatewayHealth,
  sendHeartbeat,
  publishPendingUns,
  wireUnsStoreForward,
  centralReachable,
  setReachabilityProbe,
  _resetForTests,
} from "./edgeGatewayRuntime";
import {
  unsBufferedCount,
  bufferUnsSamples,
  backfillUns,
  _resetUnsStoreForward,
  type PendingUnsSample,
} from "../ot/storeForward";

function adapter(): RuntimeAdapter {
  return {
    adapterId: 7,
    code: "edge-line1",
    machineId: 42,
    protocol: "modbus",
    connection: { endpoint: "modbus://127.0.0.1:502" },
    pollIntervalMs: 1000,
    tags: [{ tagKey: "torque", address: "40001", dataType: "float" } as never],
    driver: {} as never,
  };
}
function sample(tag: string, tsMs: number, value: number | boolean | string = 1.5): OtSample {
  return { tagKey: tag, value, quality: "good", timestamp: new Date(tsMs) } as OtSample;
}

let walPath: string;
let livenessPath: string;

beforeEach(() => {
  const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  walPath = path.join(os.tmpdir(), `edge-uns-${stamp}.jsonl`);
  livenessPath = path.join(os.tmpdir(), `edge-alive-${stamp}.json`);
  process.env.EDGE_UNS_STORE_FORWARD_FILE = walPath;
  process.env.EDGE_GATEWAY_LIVENESS_FILE = livenessPath; // keep the repo ./data clean
  process.env.EDGE_GATEWAY_MODE = "true";
  process.env.EDGE_GATEWAY_NODE_CODE = "edge-test";
  delete process.env.UNS_SPARKPLUG_ENABLED;
  unsState.connected = false;
  spCalls.length = 0;
  normCalls.length = 0;
  registerCalls.length = 0;
  heartbeatCalls.length = 0;
  _resetUnsStoreForward();
  _resetForTests();
});

afterEach(async () => {
  _resetForTests();
  _resetUnsStoreForward();
  setReachabilityProbe(null);
  for (const f of [walPath, livenessPath]) {
    try {
      await fs.unlink(f);
    } catch {
      /* ignore */
    }
  }
});

describe("edge gateway — flag + pending-sample builder", () => {
  it("edgeGatewayModeEnabled reflects EDGE_GATEWAY_MODE", () => {
    expect(edgeGatewayModeEnabled()).toBe(true);
    process.env.EDGE_GATEWAY_MODE = "false";
    expect(edgeGatewayModeEnabled()).toBe(false);
  });

  it("buildPendingUnsSample is self-contained (deviceId/tag/ts/type/topic)", async () => {
    const p = await buildPendingUnsSample(adapter(), sample("torque", 1000, 1.5));
    expect(p.deviceId).toBe("edge-line1");
    expect(p.adapterId).toBe(7);
    expect(p.machineId).toBe(42);
    expect(p.tagKey).toBe("torque");
    expect(p.tsMs).toBe(1000);
    expect(p.topic).toBe("avi/0/workshop/ot/station/edge-line1/torque");
    expect(typeof p.sparkplugType).toBe("string");
  });
});

describe("edge gateway — buffer routing (central unreachable → store-forward)", () => {
  it("bufferUnsSample enqueues into the edge UNS store-and-forward", async () => {
    expect(unsBufferedCount()).toBe(0);
    await bufferUnsSample(adapter(), sample("torque", 1000));
    await bufferUnsSample(adapter(), sample("torque", 2000));
    expect(unsBufferedCount()).toBe(2);
  });

  it("bufferUnsSample is a no-op when edge mode is off", async () => {
    process.env.EDGE_GATEWAY_MODE = "false";
    await bufferUnsSample(adapter(), sample("torque", 1000));
    expect(unsBufferedCount()).toBe(0);
  });
});

describe("edge gateway — degraded health + heartbeat", () => {
  it("online only when central reachable AND buffers empty", async () => {
    setReachabilityProbe(() => true);
    const h1 = await getEdgeGatewayHealth();
    expect(h1.status).toBe("online");
    expect(h1.centralReachable).toBe(true);

    // A backlog forces degraded even while reachable.
    await bufferUnsSample(adapter(), sample("torque", 1000));
    const h2 = await getEdgeGatewayHealth();
    expect(h2.unsBuffered).toBe(1);
    expect(h2.status).toBe("degraded");
  });

  it("degraded when central unreachable", async () => {
    setReachabilityProbe(() => false);
    const h = await getEdgeGatewayHealth();
    expect(h.centralReachable).toBe(false);
    expect(h.status).toBe("degraded");
  });

  it("sendHeartbeat reports the degraded status to the registry", async () => {
    setReachabilityProbe(() => false);
    const h = await sendHeartbeat();
    expect(h.status).toBe("degraded");
    expect(registerCalls.length).toBeGreaterThanOrEqual(1); // registers on first beat
    expect(heartbeatCalls.length).toBe(1);
    expect(heartbeatCalls[0].status).toBe("degraded");
    expect(heartbeatCalls[0].code).toBe("edge-test");
  });

  it("centralReachable falls back to the UNS publisher connection when no probe", async () => {
    unsState.connected = true;
    expect(await centralReachable()).toBe(true);
    unsState.connected = false;
    expect(await centralReachable()).toBe(false);
  });
});

describe("edge gateway — northbound replay (publishPendingUns)", () => {
  const pending = (tag: string, tsMs: number): PendingUnsSample => ({
    deviceId: "edge-line1",
    adapterId: 7,
    machineId: 42,
    tagKey: tag,
    value: 1,
    quality: "good",
    tsMs,
    sparkplugType: "Double",
    topic: `avi/0/workshop/ot/station/edge-line1/${tag}`,
  });

  it("sends NOTHING when the broker is disconnected (all-or-nothing)", async () => {
    unsState.connected = false;
    const n = await publishPendingUns([pending("torque", 1000)]);
    expect(n).toBe(0);
    expect(normCalls.length).toBe(0);
    expect(spCalls.length).toBe(0);
  });

  it("publishes normalized JSON in order when connected", async () => {
    unsState.connected = true;
    const n = await publishPendingUns([pending("a", 1000), pending("b", 2000)]);
    expect(n).toBe(2);
    expect(normCalls.map((c) => c.topic)).toEqual([
      "avi/0/workshop/ot/station/edge-line1/a",
      "avi/0/workshop/ot/station/edge-line1/b",
    ]);
  });

  it("publishes Sparkplug DDATA when UNS_SPARKPLUG_ENABLED", async () => {
    unsState.connected = true;
    process.env.UNS_SPARKPLUG_ENABLED = "true";
    const n = await publishPendingUns([pending("torque", 1000)]);
    expect(n).toBe(1);
    expect(spCalls.length).toBe(1);
    expect(spCalls[0].deviceId).toBe("edge-line1");
  });
});

describe("edge gateway — wire + drain end-to-end (buffer → replay in order)", () => {
  it("wireUnsStoreForward + backfillUns replays the buffer through the publisher IN ORDER", async () => {
    // Buffer 3 samples while disconnected.
    unsState.connected = false;
    const s1 = await buildPendingUnsSample(adapter(), sample("torque", 1000));
    const s2 = await buildPendingUnsSample(adapter(), sample("torque", 2000));
    const s3 = await buildPendingUnsSample(adapter(), sample("angle", 2000));
    await bufferUnsSamples([s1, s2, s3]);
    expect(unsBufferedCount()).toBe(3);

    // Wire the real replay transport; a backfill while down drains nothing.
    await wireUnsStoreForward();
    const down = await backfillUns();
    expect(down.drained).toBe(0);
    expect(unsBufferedCount()).toBe(3);

    // Reconnect → the drain replays all 3, in order, exactly once.
    unsState.connected = true;
    const up = await backfillUns();
    expect(up.drained).toBe(3);
    expect(unsBufferedCount()).toBe(0);
    expect(normCalls.map((c) => c.topic)).toEqual([
      "avi/0/workshop/ot/station/edge-line1/torque",
      "avi/0/workshop/ot/station/edge-line1/torque",
      "avi/0/workshop/ot/station/edge-line1/angle",
    ]);
    // idempotent: a second drain (or re-buffer of the same keys) publishes nothing more.
    const again = await backfillUns();
    expect(again.drained).toBe(0);
    const readd = await bufferUnsSamples([s1, s2, s3]);
    expect(readd).toBe(0);
    expect(normCalls.length).toBe(3); // still exactly 3 — no re-publish
  });
});

describe("edge gateway — entrypoint binds no HTTP/socket/broker (source guard)", () => {
  it("edgeGatewayMain.ts + edgeGatewayRuntime.ts do not import express/socket.io/aedes/_core/index or .listen", async () => {
    const files = [
      path.resolve(__dirname, "../../edge/edgeGatewayMain.ts"),
      path.resolve(__dirname, "./edgeGatewayRuntime.ts"),
    ];
    // Match only real import/require STATEMENTS (not doc comments that mention a path).
    const forbiddenImport: RegExp[] = [
      /(?:from|import)\s+["']express["']/,
      /require\(\s*["']express["']\s*\)/,
      /(?:from|import\(?)\s*["'][^"']*socket\.io/,
      /(?:from|import\(?)\s*["'][^"']*aedes/,
      /(?:from|import\(?)\s*["'][^"']*_core\/index/,
    ];
    // Runtime bind calls that would open a listener (safe: never appear in comments here).
    const forbiddenBind: RegExp[] = [/\.listen\s*\(/, /createServer\s*\(/, /new\s+Server\s*\(/];
    for (const f of files) {
      const src = await fs.readFile(f, "utf8");
      // Strip line + block comments so a doc reference to a path never trips the guard.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      for (const re of [...forbiddenImport, ...forbiddenBind]) {
        expect(re.test(code), `${path.basename(f)} must not match ${re}`).toBe(false);
      }
    }
  });
});
