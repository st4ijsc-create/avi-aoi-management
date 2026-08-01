/**
 * doc 44 W2-A2 (G1.11) — config-drift service tests.
 *
 * Covers: secret redaction (credentials NEVER enter the hash — rotating a
 * password is NOT drift), endpoint userinfo stripping, stable stringify (key
 * order agnostic), computeConfigHash stability (tag order agnostic; real config
 * change ⇒ different hash), and the drift state machine over a faked DB:
 * unapproved → approve (in_sync) → change (drift, newlyDrifted once) → repeat
 * sweep (drift, NOT newly) — plus sweepConfigDrift routing exactly ONE central
 * alert per new episode. DB faked at ../../db/connection (FIFO selects +
 * recorded upserts); routeAlert mocked at ../aiSmartAlertRouter.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    upserts: [] as Array<{ values: Record<string, unknown>; set: Record<string, unknown> }>,
  };
  function chain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.from = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  }
  const db = {
    select: (_cols?: unknown) => chain(state.selectResults.shift() ?? []),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
          state.upserts.push({ values, set: cfg.set });
        },
      }),
    }),
  };
  return { state, db, routeAlert: vi.fn(async () => ({ targets: [] })) };
});

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fake.db) }));
vi.mock("../../../drizzle/schema", () => ({
  deviceAdapters: { id: "id", machineId: "machineId" },
  deviceTags: { adapterId: "adapterId", tagKey: "tagKey" },
  configSnapshots: { entityType: "entityType", entityId: "entityId" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  asc: (x: unknown) => x,
}));
vi.mock("../aiSmartAlertRouter", () => ({ routeAlert: fake.routeAlert }));

import {
  redactSecrets,
  redactEndpoint,
  stableStringify,
  computeConfigHash,
  checkAdapterDrift,
  approveCurrentConfig,
  sweepConfigDrift,
  configDriftEnabled,
  configDriftIntervalMs,
  type AdapterConfigInput,
  type TagConfigInput,
} from "./configDriftService";

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.upserts = [];
  fake.routeAlert.mockClear();
});

// ── pure: redaction + stable hashing ─────────────────────────────────────────
describe("G1.11 — secret redaction", () => {
  it("drops password/secret/token/credential keys recursively", () => {
    const out = redactSecrets({
      host: "10.0.0.5",
      password: "hunter2",
      auth: { clientSecret: "s3cret", user: "svc", accessToken: "t" },
      nested: [{ apiKey: "k", keep: 1 }],
    }) as Record<string, unknown>;
    expect(out.password).toBeUndefined();
    expect((out.auth as Record<string, unknown>).clientSecret).toBeUndefined();
    expect((out.auth as Record<string, unknown>).accessToken).toBeUndefined();
    expect((out.auth as Record<string, unknown>).user).toBe("svc");
    expect((out.nested as Array<Record<string, unknown>>)[0].apiKey).toBeUndefined();
    expect((out.nested as Array<Record<string, unknown>>)[0].keep).toBe(1);
    expect(out.host).toBe("10.0.0.5");
  });

  it("strips URL userinfo from the endpoint", () => {
    expect(redactEndpoint("opc.tcp://user:pw@10.0.0.5:4840/ua")).toBe("opc.tcp://10.0.0.5:4840/ua");
    expect(redactEndpoint("mqtt://broker:1883")).toBe("mqtt://broker:1883");
    expect(redactEndpoint(null)).toBe("");
  });

  it("stableStringify is key-order agnostic", () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

const ADAPTER: AdapterConfigInput = {
  code: "plc-1",
  name: "PLC 1",
  protocol: "modbus_tcp",
  endpoint: "modbus://user:pw@10.0.0.9:502",
  machineId: 7,
  pollIntervalMs: 5000,
  isEnabled: true,
  connectionOptions: { unitId: 1, password: "pw" },
};
const TAGS: TagConfigInput[] = [
  { tagKey: "temp", address: "40001", dataType: "float", unit: "C", scale: "1", offset: "0", writable: false, isEnabled: true },
  { tagKey: "run", address: "00001", dataType: "bool", unit: null, scale: null, offset: null, writable: true, isEnabled: true },
];

describe("G1.11 — computeConfigHash", () => {
  it("is stable across tag order and connectionOptions key order", () => {
    const h1 = computeConfigHash(ADAPTER, TAGS);
    const h2 = computeConfigHash(
      { ...ADAPTER, connectionOptions: { password: "pw", unitId: 1 } },
      [...TAGS].reverse(),
    );
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rotating a secret does NOT change the hash (secrets never enter it)", () => {
    const h1 = computeConfigHash(ADAPTER, TAGS);
    const h2 = computeConfigHash(
      { ...ADAPTER, endpoint: "modbus://other:rotated@10.0.0.9:502", connectionOptions: { unitId: 1, password: "ROTATED" } },
      TAGS,
    );
    expect(h1).toBe(h2);
  });

  it("a REAL config change (tag address / poll interval) changes the hash", () => {
    const h1 = computeConfigHash(ADAPTER, TAGS);
    expect(computeConfigHash(ADAPTER, [{ ...TAGS[0], address: "40002" }, TAGS[1]])).not.toBe(h1);
    expect(computeConfigHash({ ...ADAPTER, pollIntervalMs: 1000 }, TAGS)).not.toBe(h1);
  });
});

// ── DB-backed drift state machine ────────────────────────────────────────────
// checkAdapterDrift select order: [adapter row] → [tag rows] → [snapshot row?].
const ADAPTER_ROW = {
  id: 3,
  code: "plc-1",
  name: "PLC 1",
  protocol: "modbus_tcp",
  endpoint: "modbus://10.0.0.9:502",
  machineId: 7,
  pollIntervalMs: 5000,
  isEnabled: true,
  connectionOptions: { unitId: 1 },
};
const TAG_ROWS = [
  { tagKey: "temp", address: "40001", dataType: "float", unit: "C", scale: "1", offset: "0", writable: false, isEnabled: true },
];

describe("G1.11 — checkAdapterDrift / approveCurrentConfig", () => {
  it("no baseline yet → 'unapproved' (never fabricates drift)", async () => {
    fake.state.selectResults = [[ADAPTER_ROW], TAG_ROWS, []];
    const v = await checkAdapterDrift(3, { persist: false });
    expect(v?.status).toBe("unapproved");
    expect(v?.approvedHash).toBeNull();
    expect(v?.newlyDrifted).toBe(false);
    expect(fake.state.upserts).toHaveLength(0); // persist:false — a GET never mutates
  });

  it("approveCurrentConfig sets approved_hash := current and status in_sync", async () => {
    fake.state.selectResults = [[ADAPTER_ROW], TAG_ROWS];
    const v = await approveCurrentConfig(3, null, "api-key:tester");
    expect(v.status).toBe("in_sync");
    expect(v.approvedHash).toBe(v.currentHash);
    expect(fake.state.upserts).toHaveLength(1);
    const up = fake.state.upserts[0];
    expect(up.values.approvedHash).toBe(v.currentHash);
    expect(up.values.status).toBe("in_sync");
    expect((up.values.payloadSummary as Record<string, unknown>).approvedByPrincipal).toBe("api-key:tester");
    // summary must never carry secrets
    expect(JSON.stringify(up.values.payloadSummary)).not.toMatch(/password|secret/i);
  });

  it("config change vs approved baseline → 'drift', newlyDrifted exactly once", async () => {
    const approvedHash = computeConfigHash(
      { ...ADAPTER_ROW, protocol: "modbus_tcp", connectionOptions: ADAPTER_ROW.connectionOptions } as never,
      TAG_ROWS as never,
    );
    const changedAdapter = { ...ADAPTER_ROW, pollIntervalMs: 1000 }; // real change

    // 1st sweep of the episode: snapshot says in_sync/approved → NEW drift.
    fake.state.selectResults = [
      [changedAdapter],
      TAG_ROWS,
      [{ entityId: 3, approvedHash, status: "in_sync", driftDetectedAt: null, approvedBy: 1, approvedAt: new Date() }],
    ];
    const first = await checkAdapterDrift(3, { persist: true });
    expect(first?.status).toBe("drift");
    expect(first?.newlyDrifted).toBe(true);
    expect(first?.driftDetectedAt).toBeInstanceOf(Date);
    expect(fake.state.upserts).toHaveLength(1);
    expect(fake.state.upserts[0].values.status).toBe("drift");

    // 2nd sweep of the SAME episode: snapshot already 'drift' → not newly.
    const episodeStart = new Date("2026-07-01T00:00:00Z");
    fake.state.selectResults = [
      [changedAdapter],
      TAG_ROWS,
      [{ entityId: 3, approvedHash, status: "drift", driftDetectedAt: episodeStart, approvedBy: 1, approvedAt: new Date() }],
    ];
    const second = await checkAdapterDrift(3, { persist: true });
    expect(second?.status).toBe("drift");
    expect(second?.newlyDrifted).toBe(false);
    expect(second?.driftDetectedAt).toEqual(episodeStart); // episode start preserved
  });

  it("hash matching the baseline again → back to 'in_sync', episode cleared", async () => {
    const currentHash = computeConfigHash(ADAPTER_ROW as never, TAG_ROWS as never);
    fake.state.selectResults = [
      [ADAPTER_ROW],
      TAG_ROWS,
      [{ entityId: 3, approvedHash: currentHash, status: "drift", driftDetectedAt: new Date(), approvedBy: 1, approvedAt: new Date() }],
    ];
    const v = await checkAdapterDrift(3, { persist: true });
    expect(v?.status).toBe("in_sync");
    expect(v?.driftDetectedAt).toBeNull();
  });
});

describe("G1.11 — sweepConfigDrift", () => {
  it("routes exactly ONE central alert per NEW drift episode", async () => {
    const approvedHash = "0".repeat(64); // never matches the real hash → drift
    fake.state.selectResults = [
      [{ id: 3 }], // adapter id list
      [ADAPTER_ROW],
      TAG_ROWS,
      [{ entityId: 3, approvedHash, status: "in_sync", driftDetectedAt: null, approvedBy: 1, approvedAt: new Date() }],
    ];
    const r = await sweepConfigDrift();
    expect(r).toEqual({ checked: 1, drifted: 1, alerted: 1 });
    expect(fake.routeAlert).toHaveBeenCalledTimes(1);
    const event = fake.routeAlert.mock.calls[0][0] as Record<string, any>;
    expect(event.type).toBe("PATTERN_ANOMALY");
    expect(event.severity).toBe("MEDIUM");
    expect(event.machineId).toBe(7);
    expect(event.data.kind).toBe("config_drift");
    expect(event.data.expectedHash).toBe(approvedHash);
    // credentials must never ride along in the alert payload
    expect(JSON.stringify(event)).not.toMatch(/password|secret/i);
  });

  it("same episode on the next sweep → persists but does NOT re-alert", async () => {
    const approvedHash = "0".repeat(64);
    fake.state.selectResults = [
      [{ id: 3 }],
      [ADAPTER_ROW],
      TAG_ROWS,
      [{ entityId: 3, approvedHash, status: "drift", driftDetectedAt: new Date(), approvedBy: 1, approvedAt: new Date() }],
    ];
    const r = await sweepConfigDrift();
    expect(r).toEqual({ checked: 1, drifted: 1, alerted: 0 });
    expect(fake.routeAlert).not.toHaveBeenCalled();
  });
});

describe("G1.11 — flags", () => {
  it("CONFIG_DRIFT_ENABLED defaults OFF; interval defaults 10 min with a 60s floor", () => {
    const prevEnabled = process.env.CONFIG_DRIFT_ENABLED;
    const prevInterval = process.env.CONFIG_DRIFT_INTERVAL_MS;
    try {
      delete process.env.CONFIG_DRIFT_ENABLED;
      delete process.env.CONFIG_DRIFT_INTERVAL_MS;
      expect(configDriftEnabled()).toBe(false);
      expect(configDriftIntervalMs()).toBe(10 * 60 * 1000);
      process.env.CONFIG_DRIFT_ENABLED = "true";
      expect(configDriftEnabled()).toBe(true);
      process.env.CONFIG_DRIFT_INTERVAL_MS = "5"; // below floor → default
      expect(configDriftIntervalMs()).toBe(10 * 60 * 1000);
      process.env.CONFIG_DRIFT_INTERVAL_MS = "120000";
      expect(configDriftIntervalMs()).toBe(120000);
    } finally {
      if (prevEnabled === undefined) delete process.env.CONFIG_DRIFT_ENABLED; else process.env.CONFIG_DRIFT_ENABLED = prevEnabled;
      if (prevInterval === undefined) delete process.env.CONFIG_DRIFT_INTERVAL_MS; else process.env.CONFIG_DRIFT_INTERVAL_MS = prevInterval;
    }
  });
});
