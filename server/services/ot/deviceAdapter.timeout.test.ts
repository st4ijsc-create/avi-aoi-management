/**
 * SCADA R0 Task 1 (C5) — timeoutMs của adapter phải TỚI driver (trước đây cứng `undefined`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  adapterRows: [] as Record<string, unknown>[],
  tagRows: [] as Record<string, unknown>[],
}));

vi.mock("../../db/connection", () => ({
  getDb: async () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          const t = (table as { __t?: string })?.__t;
          return t === "tags" ? hoisted.tagRows : t === "adapters" ? hoisted.adapterRows : [];
        },
      }),
    }),
  }),
}));
vi.mock("../../../drizzle/schema", () => ({
  deviceAdapters: { __t: "adapters", isEnabled: {} },
  deviceTags: { __t: "tags", adapterId: {} },
}));
// Không adapter nào thuộc edge.
vi.mock("../edge/edgeControlSchema", () => ({
  adapterOwnership: { __t: "ownership", id: {}, edgeNodeId: {} },
  isEdgeControlSchemaMissing: () => false,
}));
vi.mock("./driverRegistry", () => ({ createDriver: () => ({ protocol: "stub" }) }));

import { docTimeoutMs, loadEnabledAdapters } from "./deviceAdapter";

describe("docTimeoutMs", () => {
  it("so nguyen duong <= 60000 (nhan ca chuoi so)", () => {
    expect(docTimeoutMs({ timeoutMs: 1500 })).toBe(1500);
    expect(docTimeoutMs({ timeoutMs: "1500" })).toBe(1500);
    expect(docTimeoutMs({ timeoutMs: 60000 })).toBe(60000);
  });
  it.each([0, -1, "abc", 60001, undefined, 1.5, null, NaN])("%s => undefined", (v) => {
    expect(docTimeoutMs({ timeoutMs: v as never })).toBeUndefined();
  });
  it("opts null/undefined => undefined", () => {
    expect(docTimeoutMs(undefined)).toBeUndefined();
    expect(docTimeoutMs(null)).toBeUndefined();
  });
});

describe("loadEnabledAdapters - timeoutMs", () => {
  beforeEach(() => {
    delete process.env.AVI_PROCESS_ROLE;
    hoisted.tagRows = [];
  });

  it("connection.timeoutMs va backupConnection.timeoutMs lay tu connectionOptions", async () => {
    hoisted.adapterRows = [
      {
        id: 7,
        code: "ad-7",
        machineId: 3,
        protocol: "modbus",
        endpoint: "tcp://10.0.0.1:502",
        pollIntervalMs: 1000,
        isEnabled: true,
        connectionOptions: { timeoutMs: 1500, ha: { secondaryEndpoint: "tcp://10.0.0.2:502" } },
      },
    ];
    const out = await loadEnabledAdapters();
    expect(out).toHaveLength(1);
    expect(out[0].connection.timeoutMs).toBe(1500);
    expect(out[0].backupConnection?.timeoutMs).toBe(1500);
  });

  it("khong khai timeoutMs => undefined (giu hanh vi cu)", async () => {
    hoisted.adapterRows = [
      {
        id: 8,
        code: "ad-8",
        machineId: null,
        protocol: "modbus",
        endpoint: "tcp://10.0.0.1:502",
        pollIntervalMs: null,
        isEnabled: true,
        connectionOptions: null,
      },
    ];
    const out = await loadEnabledAdapters();
    expect(out[0].connection.timeoutMs).toBeUndefined();
  });
});
