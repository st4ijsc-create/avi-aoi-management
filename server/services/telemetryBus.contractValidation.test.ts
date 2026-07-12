/**
 * doc 44 W2-B2 (G2.6) — telemetryBus contract-validation hook (gated, default OFF).
 *
 * Proves the seam at ingestTelemetry:
 *   • mode off (default): byte-for-byte prior behaviour — every sample persists
 *   • mode quarantine: a sample whose canonical telemetry shape is invalid (no asset
 *     identity) is DROPPED from the batch + written to contract_quarantine; valid
 *     samples in the SAME batch still persist
 *   • mode log: nothing is dropped, the invalid sample is only counted
 *
 * TSDB is mocked off (main-DB fallback path); the fake DB serves BOTH the telemetry
 * insert (…values(rows).onConflictDoNothing()) and the quarantine insert (…values(row)
 * awaited directly) — distinguished by row shape (subject+errors ⇒ quarantine).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../db/timescale", () => ({
  insertOtTelemetryRows: vi.fn(async () => null), // TSDB off → main-DB fallback
}));

const persistedRows: any[] = [];
const quarantineRows: any[] = [];

const fakeDb = {
  insert: () => ({
    values: (v: any) => {
      // quarantine insert: single object carrying subject+errors, awaited directly
      if (!Array.isArray(v) && v && typeof v === "object" && "subject" in v && "errors" in v) {
        quarantineRows.push(v);
        return Promise.resolve() as any;
      }
      // telemetry fallback insert: row array with .onConflictDoNothing()
      return {
        onConflictDoNothing: async () => {
          for (const r of Array.isArray(v) ? v : [v]) persistedRows.push(r);
        },
      };
    },
  }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
};
vi.mock("../db/connection", () => ({
  getDb: vi.fn(async () => fakeDb),
  getJobsDb: vi.fn(async () => null),
}));
vi.mock("../_core/socket", () => ({ emitTelemetrySamples: vi.fn() }));

import { ingestTelemetry, type CanonicalSample } from "./telemetryBus";
import {
  _resetIngestValidation,
  flushQuarantineWrites,
  stopQuarantineRetention,
  getIngestValidationStats,
  TELEMETRY_SUBJECT,
} from "./contracts/ingestValidation";
import { _clearSchemaRegistry } from "./contracts/schemaRegistry";

const VALID: CanonicalSample = {
  ts: new Date(1000),
  machineId: 5,
  deviceId: "DEV-1",
  protocol: "modbus",
  metric: "temperature",
  value: 42,
};
// No deviceId AND no machineId → canonical telemetry has no asset_id → contract-invalid.
const INVALID: CanonicalSample = {
  ts: new Date(2000),
  machineId: null,
  deviceId: null,
  protocol: "modbus",
  metric: "temperature",
  value: 43,
};

beforeEach(() => {
  _resetIngestValidation();
  _clearSchemaRegistry();
  persistedRows.length = 0;
  quarantineRows.length = 0;
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
  delete process.env.TELEMETRY_BATCH_ENABLED;
  delete process.env.OT_STORE_FORWARD_ENABLED;
});
afterEach(() => {
  stopQuarantineRetention();
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
});

describe("telemetryBus — G2.6 contract-validation hook", () => {
  it("mode off (default): both samples persist (prior behaviour, hook is a no-op)", async () => {
    const n = await ingestTelemetry([VALID, INVALID]);
    expect(n).toBe(2);
    expect(persistedRows).toHaveLength(2);
    expect(quarantineRows).toHaveLength(0);
    expect(getIngestValidationStats().subjects).toHaveLength(0); // truly zero-call
  });

  it("mode quarantine: invalid sample dropped + quarantined; valid one still persists", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    const n = await ingestTelemetry([VALID, INVALID]);
    expect(n).toBe(1);
    expect(persistedRows).toHaveLength(1);
    expect(persistedRows[0].deviceId).toBe("DEV-1");
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(1);
    expect(quarantineRows[0]).toMatchObject({ subject: TELEMETRY_SUBJECT, source: "telemetry_bus" });
    expect(quarantineRows[0].errors.join(" ")).toMatch(/asset_id/);
  });

  it("mode quarantine: an all-invalid batch persists nothing (returns 0)", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    const n = await ingestTelemetry([INVALID]);
    expect(n).toBe(0);
    expect(persistedRows).toHaveLength(0);
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(1);
  });

  it("mode log: nothing dropped — invalid sample persists AND is counted", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "log";
    const n = await ingestTelemetry([VALID, INVALID]);
    expect(n).toBe(2);
    expect(persistedRows).toHaveLength(2);
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(0);
    const s = getIngestValidationStats().subjects.find((x) => x.subject === TELEMETRY_SUBJECT);
    expect(s).toMatchObject({ valid: 1, invalid: 1, quarantined: 0 });
  });
});
