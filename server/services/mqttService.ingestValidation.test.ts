/**
 * doc 44 W2-B2 (G2.6) — mqttService inbound contract-validation hook (gated, default OFF).
 *
 * processAedesPublish is the pure entry the aedes on('publish') handler calls. The hook
 * must:
 *   • mode off (default): pass EVERYTHING through unchanged (publishNormalized always runs)
 *   • mode quarantine: BLOCK an invalid frame on a contract topic (syn/…/telemetry) from
 *     the whole pipeline (publishNormalized NOT called); valid frames flow
 *   • skip topics not under contract (avi/… legacy Android/AOI traffic) in every mode
 *   • mode log: warn/count only — never block
 *
 * Pattern: vi.resetModules + doMock of unsPublisher/aoiBridge/sensorIngestService
 * (mirrors mqttService.aoiBridge.test.ts) — no broker, no DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const VALID_TELEMETRY = JSON.stringify({
  asset_id: "aoi-01",
  ts: "2026-07-12T00:00:00Z",
  metrics: [{ name: "spindle.temp", value: 61.2 }],
});
const INVALID_TELEMETRY = JSON.stringify({ ts: "t", metrics: [] }); // missing asset_id

let lastIv: typeof import("./contracts/ingestValidation") | null = null;

async function load() {
  vi.resetModules();
  const publishNormalized = vi.fn();
  vi.doMock("./unsPublisher", () => ({
    initUnsPublisher: vi.fn(),
    publishNormalized,
    publishAoiBridge: vi.fn(),
    publishNdeathGraceful: vi.fn(),
    shutdownUnsPublisher: vi.fn(),
  }));
  vi.doMock("./uns/aoiBridge", () => ({ mapAoiTopicToSparkplug: vi.fn(() => null) }));
  vi.doMock("./sensorIngestService", () => ({ handleSensorMessage: vi.fn(async () => {}) }));
  // quarantine persist path: no DB available → write skipped with a warning, block stands
  vi.doMock("../db/connection", () => ({
    getDb: vi.fn(async () => null),
    getJobsDb: vi.fn(async () => null),
  }));
  const mod = await import("./mqttService");
  const iv = await import("./contracts/ingestValidation");
  lastIv = iv;
  iv._resetIngestValidation();
  return { processAedesPublish: mod.processAedesPublish, publishNormalized, iv };
}

beforeEach(() => {
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
});
afterEach(async () => {
  lastIv?.stopQuarantineRetention();
  await lastIv?.flushQuarantineWrites();
  lastIv = null;
  delete process.env.CONTRACT_VALIDATE_INGEST_MODE;
  vi.resetModules();
});

describe("processAedesPublish — G2.6 inbound contract gate", () => {
  it("mode off (default): even an INVALID contract frame flows through", async () => {
    const { processAedesPublish, publishNormalized } = await load();
    processAedesPublish("syn/hn/smt/l1/c2/aoi01/telemetry", Buffer.from(INVALID_TELEMETRY));
    expect(publishNormalized).toHaveBeenCalledTimes(1);
  });

  it("mode quarantine: invalid frame on a contract topic is BLOCKED from the pipeline", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    const { processAedesPublish, publishNormalized, iv } = await load();
    processAedesPublish("syn/hn/smt/l1/c2/aoi01/telemetry", Buffer.from(INVALID_TELEMETRY));
    expect(publishNormalized).not.toHaveBeenCalled();
    const s = iv.getIngestValidationStats().subjects.find((x) => x.subject === iv.TELEMETRY_SUBJECT);
    expect(s).toMatchObject({ invalid: 1, quarantined: 1 });
  });

  it("mode quarantine: VALID frame on a contract topic flows through", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    const { processAedesPublish, publishNormalized } = await load();
    processAedesPublish("syn/hn/smt/l1/c2/aoi01/telemetry", Buffer.from(VALID_TELEMETRY));
    expect(publishNormalized).toHaveBeenCalledTimes(1);
  });

  it("mode quarantine: non-contract topic (legacy avi/…) is skipped — even garbage flows", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "quarantine";
    const { processAedesPublish, publishNormalized } = await load();
    processAedesPublish("avi/client/dev-1/info", Buffer.from("not-even-json"));
    expect(publishNormalized).toHaveBeenCalledTimes(1);
  });

  it("mode log: invalid frame is NOT blocked (warn/count only)", async () => {
    process.env.CONTRACT_VALIDATE_INGEST_MODE = "log";
    const { processAedesPublish, publishNormalized, iv } = await load();
    processAedesPublish("syn/hn/smt/l1/c2/aoi01/telemetry", Buffer.from(INVALID_TELEMETRY));
    expect(publishNormalized).toHaveBeenCalledTimes(1);
    const s = iv.getIngestValidationStats().subjects.find((x) => x.subject === iv.TELEMETRY_SUBJECT);
    expect(s).toMatchObject({ invalid: 1, quarantined: 0 });
  });
});
