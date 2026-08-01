/**
 * W7-E (doc 27 V14) — acquisition worker tests.
 *
 * Covers: flag gating (LIVE_ACQUISITION_ENABLED), per-config enable, the
 * grab→quality→ledger→submit loop over a mock source (completion on
 * exhaustion), canonical NTF submission with the injected submit seam,
 * duplicate-id refusal, stop semantics, and config schema honesty
 * (submit:true requires machineCode).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  acquisitionWorkerConfigSchema,
  getAcquisitionWorkersStatus,
  startAcquisitionWorker,
  stopAcquisitionWorker,
  __resetAcquisitionWorkersForTests,
  __setAcquisitionQualityForTests,
  __setAcquisitionSubmitForTests,
} from "./acquisitionWorker";
import type { CanonicalInspection } from "../visionAdapterRegistry";

const FLAG = "LIVE_ACQUISITION_ENABLED";
let savedFlag: string | undefined;

beforeEach(() => {
  savedFlag = process.env[FLAG];
  process.env[FLAG] = "true";
});

afterEach(async () => {
  await __resetAcquisitionWorkersForTests();
  if (savedFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = savedFlag;
});

async function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waitFor timeout");
}

describe("config schema", () => {
  it("submit:true without machineCode is rejected (a frame must belong to a machine)", () => {
    const bad = acquisitionWorkerConfigSchema.safeParse({
      id: "w1",
      source: { kind: "mock", maxFrames: 1 },
      submit: true,
    });
    expect(bad.success).toBe(false);
  });

  it("accepts a minimal mock config", () => {
    const ok = acquisitionWorkerConfigSchema.safeParse({ id: "w1", source: { kind: "mock" } });
    expect(ok.success).toBe(true);
  });
});

describe("gating", () => {
  it("refuses to start when LIVE_ACQUISITION_ENABLED is off", async () => {
    delete process.env[FLAG];
    const res = await startAcquisitionWorker({ id: "gated", source: { kind: "mock", maxFrames: 1 } });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/LIVE_ACQUISITION_ENABLED/);
  });

  it("refuses a per-config disabled worker", async () => {
    const res = await startAcquisitionWorker({
      id: "disabled",
      source: { kind: "mock", maxFrames: 1 },
      enabled: false,
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/disabled/);
  });
});

describe("grab → quality → ledger → submit loop", () => {
  it("runs a mock source to exhaustion, submitting canonical NTF inspections", async () => {
    const submitted: CanonicalInspection[] = [];
    __setAcquisitionSubmitForTests(async (c) => {
      submitted.push(c);
      return { inspectionId: 1000 + submitted.length };
    });
    __setAcquisitionQualityForTests(async () => ({
      sharpness: 12,
      brightness: 128,
      contrast: 40,
      blurScore: 0.1,
      acceptable: true,
    }));

    const res = await startAcquisitionWorker({
      id: "loop1",
      source: { kind: "mock", maxFrames: 3, width: 16, height: 16 },
      machineCode: "CAM-01",
      intervalMs: 50,
      submit: true,
    });
    expect(res.ok).toBe(true);

    await waitFor(() => {
      const w = getAcquisitionWorkersStatus().workers.find((x) => x.id === "loop1");
      return w?.state === "completed";
    });

    const w = getAcquisitionWorkersStatus().workers.find((x) => x.id === "loop1")!;
    expect(w.framesGrabbed).toBe(3);
    expect(w.submitted).toBe(3);
    expect(w.errors).toBe(0);
    expect(w.ledger).toHaveLength(3);
    expect(w.ledger[0].quality?.acceptable).toBe(true);
    expect(w.ledger[0].submitted).toBe(true);
    expect(w.ledger[0].inspectionId).toBe(1001);

    // HONESTY: acquisition ≠ judgement — canonical result is NTF, machine stamped.
    expect(submitted[0].machineCode).toBe("CAM-01");
    expect(submitted[0].overallResult).toBe("NTF");
    expect(submitted[0].serialNumber).toContain("mock-source");
  });

  it("quality-only mode (submit off) never calls the submit seam", async () => {
    let calls = 0;
    __setAcquisitionSubmitForTests(async () => {
      calls++;
      return { inspectionId: null };
    });
    __setAcquisitionQualityForTests(async () => null);

    await startAcquisitionWorker({
      id: "loop2",
      source: { kind: "mock", maxFrames: 2 },
      intervalMs: 50,
    });
    await waitFor(() => {
      const w = getAcquisitionWorkersStatus().workers.find((x) => x.id === "loop2");
      return w?.state === "completed";
    });
    const w = getAcquisitionWorkersStatus().workers.find((x) => x.id === "loop2")!;
    expect(w.framesGrabbed).toBe(2);
    expect(w.submitted).toBe(0);
    expect(calls).toBe(0);
    // quality honestly null (assessor unavailable) — never fabricated.
    expect(w.ledger[0].quality).toBeNull();
  });

  it("refuses a duplicate id while running; stop() halts the loop", async () => {
    __setAcquisitionQualityForTests(async () => null);
    const res1 = await startAcquisitionWorker({
      id: "dup",
      source: { kind: "mock" }, // unlimited frames
      intervalMs: 60_000, // long interval → stays running
    });
    expect(res1.ok).toBe(true);
    const res2 = await startAcquisitionWorker({ id: "dup", source: { kind: "mock" } });
    expect(res2.ok).toBe(false);
    expect(res2.reason).toMatch(/already running/);

    const stop = await stopAcquisitionWorker("dup");
    expect(stop.ok).toBe(true);
    const w = getAcquisitionWorkersStatus().workers.find((x) => x.id === "dup")!;
    expect(w.state).toBe("stopped");
  });

  it("unknown source directory is an honest start failure, not a crash", async () => {
    const res = await startAcquisitionWorker({
      id: "badsrc",
      source: { kind: "file", directory: "Z:/definitely/not/here-" + Date.now() },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/cannot read directory/i);
  });
});
