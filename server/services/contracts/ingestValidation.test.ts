/**
 * Ingest contract-validation + quarantine tests — doc 44 Batch W2-B2 (gap G2.6).
 *
 *   • mode "off" (default): zero-call — no seed, no validation, no DB touch, same-ref batch
 *   • mode "log": invalid counted + passed through, NEVER blocked, no quarantine write
 *   • mode "quarantine": invalid BLOCKED + persisted to contract_quarantine; valid flows
 *   • fail-safe: an internal validator error → pass-through (never blocks production)
 *   • payload cap: >64KB serialized → { truncated, sizeBytes, preview } wrapper
 *   • topic → subject mapping (only syn/… contract topics validate)
 *   • retention: days<=0 disables the sweep entirely (no DB touch)
 *
 * DB is mocked (pattern: schemaRegistryPersistence.test.ts); the canonical schemas are the
 * REAL contracts/canonical/*.schema.json files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── mocked DB (quarantine writes land in-memory) ─────────────────────────────
const quarantineRows: any[] = [];
const insertValues = vi.fn(async (v: any) => {
  quarantineRows.push(v);
});
const getDb = vi.fn(async () => ({ insert: () => ({ values: insertValues }) }));
const jobsExecute = vi.fn(async () => [] as unknown[]);
const getJobsDb = vi.fn(async () => ({ execute: jobsExecute }));

vi.mock("../../db/connection", () => ({
  getDb: (...args: unknown[]) => getDb(...(args as [])),
  getJobsDb: (...args: unknown[]) => getJobsDb(...(args as [])),
}));

import {
  ingestValidationMode,
  topicToSubject,
  validateInbound,
  validateInboundMqtt,
  filterTelemetrySamples,
  sampleToCanonicalTelemetry,
  capQuarantinePayload,
  getIngestValidationStats,
  flushQuarantineWrites,
  sweepQuarantineRetention,
  quarantineRetentionDays,
  stopQuarantineRetention,
  _resetIngestValidation,
  TELEMETRY_SUBJECT,
  QUARANTINE_MAX_PAYLOAD_BYTES,
} from "./ingestValidation";
import { _clearSchemaRegistry } from "./schemaRegistry";

const VALID_TELEMETRY = {
  asset_id: "aoi-01",
  ts: "2026-07-12T00:00:00Z",
  seq: 1,
  metrics: [{ name: "spindle.temp", value: 61.2, unit: "degC", quality: "good" }],
};

beforeEach(() => {
  _resetIngestValidation();
  _clearSchemaRegistry();
  quarantineRows.length = 0;
  insertValues.mockClear();
  getDb.mockClear();
  getJobsDb.mockClear();
  jobsExecute.mockClear();
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
  delete process.env.CONTRACT_QUARANTINE_RETENTION_DAYS;
});
afterEach(() => {
  stopQuarantineRetention();
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
  delete process.env.CONTRACT_QUARANTINE_RETENTION_DAYS;
});

describe("mode resolution + topic mapping", () => {
  it("unknown/unset mode fails safe to 'off'", () => {
    expect(ingestValidationMode()).toBe("off");
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "banana";
    expect(ingestValidationMode()).toBe("off");
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "log";
    expect(ingestValidationMode()).toBe("log");
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    expect(ingestValidationMode()).toBe("quarantine");
  });

  it("maps syn UNS topics to their canonical subject; everything else → null", () => {
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/telemetry")).toBe("syn/+/+/+/+/+/telemetry");
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/state")).toBe("syn/+/+/+/+/+/state");
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/events")).toBe("syn/+/+/+/+/+/events");
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/health")).toBe("syn/+/+/+/+/+/health");
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/cmd")).toBe("syn/+/+/+/+/+/cmd");
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/cmd/ack")).toBe("syn/+/+/+/+/+/cmd/ack");
    // not under contract → null (skip)
    expect(topicToSubject("avi/client/dev-1/info")).toBeNull();
    expect(topicToSubject("syn/hn/smt/l1/aoi01/telemetry")).toBeNull(); // wrong depth
    expect(topicToSubject("syn/hn/smt/l1/c2/aoi01/unknownleaf")).toBeNull();
    expect(topicToSubject("")).toBeNull();
  });
});

describe("mode 'off' (default) — zero-call", () => {
  it("validateInbound skips without touching registry, DB, or counters", () => {
    const v = validateInbound("mqtt", TELEMETRY_SUBJECT, {});
    expect(v).toEqual({ ok: true, action: "skipped" });
    expect(getDb).not.toHaveBeenCalled();
    expect(getIngestValidationStats().subjects).toHaveLength(0);
  });

  it("filterTelemetrySamples returns the SAME array reference (zero-cost)", () => {
    const batch = [{ metric: "t", value: 1 }];
    expect(filterTelemetrySamples(batch)).toBe(batch);
  });

  it("validateInboundMqtt skips even an invalid frame on a contract topic", () => {
    const v = validateInboundMqtt("syn/a/b/c/d/e/telemetry", Buffer.from("{}"));
    expect(v).toEqual({ ok: true, action: "skipped" });
  });
});

describe("mode 'log' — count + warn, never block", () => {
  beforeEach(() => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "log";
  });

  it("invalid message passes through with action 'logged' and is counted", async () => {
    const v = validateInbound("mqtt", TELEMETRY_SUBJECT, { ts: "t", metrics: [] }); // missing asset_id
    expect(v.ok).toBe(true);
    expect(v.action).toBe("logged");
    expect(v.errors?.join(" ")).toMatch(/asset_id/);
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(0); // log mode never writes the quarantine table
    const stats = getIngestValidationStats();
    expect(stats.mode).toBe("log");
    expect(stats.subjects).toEqual([
      { subject: TELEMETRY_SUBJECT, valid: 0, invalid: 1, quarantined: 0 },
    ]);
  });

  it("valid message passes with action 'pass'", () => {
    const v = validateInbound("mqtt", TELEMETRY_SUBJECT, VALID_TELEMETRY);
    expect(v).toEqual({ ok: true, action: "pass" });
    expect(getIngestValidationStats().subjects[0].valid).toBe(1);
  });
});

describe("mode 'quarantine' — block + persist", () => {
  beforeEach(() => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
  });

  it("invalid message is BLOCKED and lands in contract_quarantine", async () => {
    const bad = { ts: "t", metrics: [{ value: 1 }] }; // missing asset_id + metric name
    const v = validateInbound("telemetry_bus", TELEMETRY_SUBJECT, bad);
    expect(v.ok).toBe(false);
    expect(v.action).toBe("quarantined");
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(1);
    expect(quarantineRows[0]).toMatchObject({
      subject: TELEMETRY_SUBJECT,
      source: "telemetry_bus",
      payload: bad,
    });
    expect(quarantineRows[0].errors.join(" ")).toMatch(/asset_id/);
    expect(getIngestValidationStats().subjects[0]).toMatchObject({ invalid: 1, quarantined: 1 });
  });

  it("valid message flows through untouched (nothing quarantined)", async () => {
    const v = validateInbound("telemetry_bus", TELEMETRY_SUBJECT, VALID_TELEMETRY);
    expect(v).toEqual({ ok: true, action: "pass" });
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(0);
  });

  it("subject with no registered schema stays OPEN (validateMessage contract)", () => {
    const v = validateInbound("api", "syn/+/+/+/+/+/nonexistent", { anything: 1 });
    expect(v.ok).toBe(true);
  });

  it("non-JSON payload on a CONTRACT topic is itself a violation → quarantined", async () => {
    const v = validateInboundMqtt("syn/hn/smt/l1/c2/aoi01/telemetry", Buffer.from("not json"));
    expect(v.ok).toBe(false);
    expect(v.errors).toEqual(["payload is not valid JSON"]);
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(1);
    expect(quarantineRows[0].payload).toEqual({ raw: "not json" });
  });

  it("non-contract topic is skipped even in quarantine mode", () => {
    const v = validateInboundMqtt("avi/client/dev-1/info", Buffer.from("garbage-not-json"));
    expect(v).toEqual({ ok: true, action: "skipped" });
  });

  it("valid mqtt frame on a contract topic passes", () => {
    const v = validateInboundMqtt(
      "syn/hn/smt/l1/c2/aoi01/telemetry",
      Buffer.from(JSON.stringify(VALID_TELEMETRY)),
    );
    expect(v.ok).toBe(true);
  });
});

describe("filterTelemetrySamples — batch semantics", () => {
  it("quarantine mode drops ONLY invalid samples; valid ones flow", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    const valid = { deviceId: "DEV-1", metric: "temperature", value: 42 };
    const invalid = { deviceId: null, machineId: null, metric: "temperature", value: 42 }; // no asset identity
    const out = filterTelemetrySamples([valid, invalid]);
    expect(out).toEqual([valid]);
    await flushQuarantineWrites();
    expect(quarantineRows).toHaveLength(1);
    expect(quarantineRows[0].source).toBe("telemetry_bus");
  });

  it("log mode keeps the whole batch (same reference)", () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "log";
    const batch = [{ deviceId: null, machineId: null, metric: "m", value: 1 }];
    expect(filterTelemetrySamples(batch)).toBe(batch);
  });

  it("sampleToCanonicalTelemetry: asset from deviceId, else machine:<id>; non-canonical quality dropped", () => {
    expect(sampleToCanonicalTelemetry({ deviceId: "D1", metric: "m", value: 1, quality: "stale" })).toMatchObject({
      asset_id: "D1",
      metrics: [{ name: "m", value: 1 }],
    });
    expect(
      (sampleToCanonicalTelemetry({ deviceId: "D1", metric: "m", value: 1, quality: "stale" }).metrics as any[])[0].quality,
    ).toBeUndefined();
    expect(sampleToCanonicalTelemetry({ machineId: 7, metric: "m", value: null, quality: "bad" })).toMatchObject({
      asset_id: "machine:7",
      metrics: [{ name: "m", value: null, quality: "bad" }],
    });
  });
});

describe("payload cap (64KB)", () => {
  it("small payloads stored as-is; oversized become a truncated wrapper", () => {
    const small = { a: 1 };
    expect(capQuarantinePayload(small)).toBe(small);

    const big = { blob: "x".repeat(QUARANTINE_MAX_PAYLOAD_BYTES + 1000) };
    const capped = capQuarantinePayload(big) as any;
    expect(capped.truncated).toBe(true);
    expect(capped.sizeBytes).toBeGreaterThan(QUARANTINE_MAX_PAYLOAD_BYTES);
    expect(Buffer.byteLength(capped.preview, "utf8")).toBeLessThanOrEqual(QUARANTINE_MAX_PAYLOAD_BYTES);
  });

  it("unserializable payload → honest wrapper (never throws)", () => {
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(capQuarantinePayload(cyclic)).toEqual({ truncated: true, unserializable: true });
  });
});

describe("quarantine retention sweep", () => {
  it("default window is 30 days; env overrides; <=0 disables without touching DB", async () => {
    expect(quarantineRetentionDays()).toBe(30);
    process.env.CONTRACT_QUARANTINE_RETENTION_DAYS = "7";
    expect(quarantineRetentionDays()).toBe(7);
    process.env.CONTRACT_QUARANTINE_RETENTION_DAYS = "0";
    expect(await sweepQuarantineRetention()).toBe(0);
    expect(getJobsDb).not.toHaveBeenCalled();
  });

  it("enabled sweep runs a bounded batched DELETE on the jobs pool", async () => {
    const n = await sweepQuarantineRetention();
    expect(n).toBe(0); // fake execute returns [] → nothing deleted, loop exits
    expect(getJobsDb).toHaveBeenCalledTimes(1);
    expect(jobsExecute).toHaveBeenCalledTimes(1);
  });
});

describe("fail-safe — internal validator error must NEVER block", () => {
  it("validateMessage throwing → pass-through + validatorErrors counted", async () => {
    vi.resetModules();
    vi.doMock("./schemaRegistry", () => ({
      validateMessage: vi.fn(() => {
        throw new Error("validator exploded");
      }),
      seedCanonicalSchemas: vi.fn(async () => []),
    }));
    const iv = await import("./ingestValidation");
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";

    const v = iv.validateInbound("mqtt", iv.TELEMETRY_SUBJECT, { totally: "broken" });
    expect(v).toEqual({ ok: true, action: "pass" }); // NOT blocked despite quarantine mode
    expect(iv.getIngestValidationStats().validatorErrors).toBe(1);

    iv.stopQuarantineRetention();
    vi.doUnmock("./schemaRegistry");
    vi.resetModules();
  });
});
