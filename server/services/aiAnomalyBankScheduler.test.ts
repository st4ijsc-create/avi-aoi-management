/**
 * Unit tests for the Anomaly Bank Auto-Rebuild Scheduler.
 *
 * Covers:
 *   • decideRebuild pure logic (no_profile / bootstrap_now_enough / delta_exceeded / no_change).
 *   • runAnomalyBankRebuildNow: candidate enumeration → decision → MAX_SCOPES cap →
 *     per-scope build (+ backfill), with per-scope failure isolation.
 *   • startAnomalyBankScheduler is a safe no-op when the flag is OFF.
 *
 * The DB helpers and detection functions are mocked so the test is pure/offline.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (declared before importing the SUT) ─────────────────────────────────
const enumerateOkScopes = vi.fn();
const getProfileSnapshot = vi.fn();
const buildBankFromStoredEmbeddings = vi.fn();
const backfillAnomalyScores = vi.fn();

vi.mock("../db/aiAnomaly", () => ({
  enumerateOkScopes: (...a: any[]) => enumerateOkScopes(...a),
  getProfileSnapshot: (...a: any[]) => getProfileSnapshot(...a),
}));
vi.mock("./aiAnomalyDetection", () => ({
  buildBankFromStoredEmbeddings: (...a: any[]) => buildBankFromStoredEmbeddings(...a),
  backfillAnomalyScores: (...a: any[]) => backfillAnomalyScores(...a),
}));

// node-cron mock (capture schedule calls; never run a real timer).
const cronSchedule = vi.fn(() => ({ stop: vi.fn() }));
vi.mock("node-cron", () => ({
  schedule: (...a: any[]) => cronSchedule(...a),
}));

import {
  decideRebuild,
  runAnomalyBankRebuildNow,
  startAnomalyBankScheduler,
} from "./aiAnomalyBankScheduler";

// Defaults used by the SUT (env not set in test): MIN_OK=30, REBUILD_DELTA=20,
// MAX_SCOPES_PER_RUN=25, BACKFILL=true, MODEL_CODE="dinov2-small", SCOPE="machine".
const MIN_OK = 30;
const DELTA = 20;

function profile(over: Partial<{ bankSize: number; builtAt: Date | null; bootstrap: boolean }> = {}) {
  return { bankSize: 0, builtAt: null, bootstrap: false, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildBankFromStoredEmbeddings.mockResolvedValue({ bankSize: 10, storedCount: 40, bootstrap: false });
  backfillAnomalyScores.mockResolvedValue({ scored: 40, flaggedAnomaly: 1, failures: 0 });
  getProfileSnapshot.mockResolvedValue(null);
});

describe("decideRebuild", () => {
  it("rebuilds when no profile exists yet", () => {
    const d = decideRebuild({ okCount: 100, profile: null, minOk: MIN_OK, rebuildDelta: DELTA });
    expect(d).toEqual({ rebuild: true, reason: "no_profile" });
  });

  it("rebuilds a bootstrap profile once it has enough OK samples", () => {
    const d = decideRebuild({
      okCount: MIN_OK, // exactly at threshold
      profile: profile({ bootstrap: true, bankSize: 5 }),
      minOk: MIN_OK,
      rebuildDelta: DELTA,
    });
    expect(d).toEqual({ rebuild: true, reason: "bootstrap_now_enough" });
  });

  it("rebuilds when OK count grew by ≥ delta since last build", () => {
    const d = decideRebuild({
      okCount: 100,
      profile: profile({ bankSize: 80 }), // delta = 20, exactly at threshold
      minOk: MIN_OK,
      rebuildDelta: DELTA,
    });
    expect(d).toEqual({ rebuild: true, reason: "delta_exceeded" });
  });

  it("skips when growth is below delta and not bootstrap", () => {
    const d = decideRebuild({
      okCount: 95,
      profile: profile({ bankSize: 80 }), // delta = 15 < 20
      minOk: MIN_OK,
      rebuildDelta: DELTA,
    });
    expect(d).toEqual({ rebuild: false, reason: "no_change" });
  });

  it("bootstrap but still below minOk → does not rebuild on bootstrap rule (delta also small → skip)", () => {
    const d = decideRebuild({
      okCount: 12,
      profile: profile({ bootstrap: true, bankSize: 10 }),
      minOk: MIN_OK,
      rebuildDelta: DELTA,
    });
    expect(d).toEqual({ rebuild: false, reason: "no_change" });
  });
});

describe("runAnomalyBankRebuildNow", () => {
  it("rebuilds qualifying scopes and backfills them", async () => {
    enumerateOkScopes.mockResolvedValue([
      { kind: "machine", machineId: 1, productModelId: null, okCount: 100 },
      { kind: "machine", machineId: 2, productModelId: null, okCount: 200 },
    ]);
    // No profile → both qualify (no_profile).
    getProfileSnapshot.mockResolvedValue(null);

    const stats = await runAnomalyBankRebuildNow();

    expect(stats.considered).toBe(2);
    expect(stats.rebuilt).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(buildBankFromStoredEmbeddings).toHaveBeenCalledTimes(2);
    expect(backfillAnomalyScores).toHaveBeenCalledTimes(2);
  });

  it("skips non-qualifying scopes (avoids churn)", async () => {
    enumerateOkScopes.mockResolvedValue([
      { kind: "machine", machineId: 1, productModelId: null, okCount: 85 },
    ]);
    // Existing healthy profile with bankSize 80 → delta 5 < 20 → skip.
    getProfileSnapshot.mockResolvedValue(profile({ bankSize: 80, bootstrap: false }));

    const stats = await runAnomalyBankRebuildNow();

    expect(stats.considered).toBe(1);
    expect(stats.rebuilt).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(buildBankFromStoredEmbeddings).not.toHaveBeenCalled();
  });

  it("caps at MAX_SCOPES_PER_RUN and reports cappedOut (no silent truncation)", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      kind: "machine" as const,
      machineId: i + 1,
      productModelId: null,
      okCount: 100,
    }));
    enumerateOkScopes.mockResolvedValue(many);
    getProfileSnapshot.mockResolvedValue(null); // all qualify

    const stats = await runAnomalyBankRebuildNow();

    expect(stats.considered).toBe(30);
    expect(stats.rebuilt).toBe(25); // default cap
    expect(stats.cappedOut).toBe(5);
    expect(buildBankFromStoredEmbeddings).toHaveBeenCalledTimes(25);
  });

  it("isolates a per-scope build failure (one failure does not abort the run)", async () => {
    enumerateOkScopes.mockResolvedValue([
      { kind: "machine", machineId: 1, productModelId: null, okCount: 100 },
      { kind: "machine", machineId: 2, productModelId: null, okCount: 100 },
      { kind: "machine", machineId: 3, productModelId: null, okCount: 100 },
    ]);
    getProfileSnapshot.mockResolvedValue(null);
    buildBankFromStoredEmbeddings
      .mockResolvedValueOnce({ bankSize: 10, storedCount: 40, bootstrap: false })
      .mockRejectedValueOnce(new Error("boom")) // scope 2 fails
      .mockResolvedValueOnce({ bankSize: 10, storedCount: 40, bootstrap: false });

    const stats = await runAnomalyBankRebuildNow();

    expect(stats.considered).toBe(3);
    expect(stats.rebuilt).toBe(2);
    expect(stats.failures).toBe(1);
    expect(buildBankFromStoredEmbeddings).toHaveBeenCalledTimes(3);
  });

  it("counts bootstrap rebuilds", async () => {
    enumerateOkScopes.mockResolvedValue([
      { kind: "machine", machineId: 1, productModelId: null, okCount: 100 },
    ]);
    getProfileSnapshot.mockResolvedValue(null);
    buildBankFromStoredEmbeddings.mockResolvedValue({ bankSize: 5, storedCount: 8, bootstrap: true });

    const stats = await runAnomalyBankRebuildNow();
    expect(stats.bootstrap).toBe(1);
    expect(stats.rebuilt).toBe(1);
  });
});

describe("startAnomalyBankScheduler", () => {
  it("is a safe no-op when the flag is OFF (default)", () => {
    // ANOMALY_BANK_AUTO_REBUILD_ENABLED is unset in tests → disabled.
    startAnomalyBankScheduler();
    expect(cronSchedule).not.toHaveBeenCalled();
  });
});
