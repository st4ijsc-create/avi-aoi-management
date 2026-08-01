/**
 * W4-D (doc 27 §8 gap B7) — worker entry smoke tests.
 *
 * 1. Importing server/worker.ts must start the worker via
 *    backgroundJobs.runWorkerProcess (mocked — no schedulers actually run).
 * 2. The worker entry must NOT bind HTTP: neither worker.ts nor
 *    backgroundJobs.ts may reference express / http server creation / Vite —
 *    asserted at the source level (the honest guarantee "no HTTP in a worker"
 *    is a property of these two files only; scheduler services are shared).
 * 3. startBackgroundSchedulers with every flag off completes, is idempotent,
 *    and stopBackgroundSchedulers cleans up (safe to call in any ROLE).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

vi.mock("./_core/backgroundJobs", () => ({
  runWorkerProcess: vi.fn(async () => {}),
  startBackgroundSchedulers: vi.fn(async () => {}),
  stopBackgroundSchedulers: vi.fn(() => {}),
  backgroundSchedulersStarted: vi.fn(() => false),
}));

describe("worker entry (server/worker.ts)", () => {
  it("starts the scheduler-only worker via runWorkerProcess", async () => {
    await import("./worker");
    const { runWorkerProcess } = await import("./_core/backgroundJobs");
    expect(runWorkerProcess).toHaveBeenCalledTimes(1);
  });

  it("binds no HTTP: worker entry + scheduler bootstrap reference no express/http server", () => {
    for (const rel of ["worker.ts", path.join("_core", "backgroundJobs.ts")]) {
      const src = fs.readFileSync(path.join(HERE, rel), "utf-8");
      expect(src, `${rel} must not import express`).not.toMatch(/from ["']express["']/);
      expect(src, `${rel} must not create an HTTP(S) server`).not.toMatch(
        /createServer|\.listen\(/,
      );
      expect(src, `${rel} must not touch Vite/socket.io`).not.toMatch(
        /["'](\.\/vite|socket\.io)["']/,
      );
    }
  });
});

describe("backgroundJobs bootstrap (real module, flags off)", () => {
  const FLAG_ENV: Record<string, string> = {
    // default-ON schedulers → explicitly off so this smoke test registers no cron
    AI_BATCH_RCA_ENABLED: "false",
    INTEGRITY_SCAN_ENABLED: "false",
    EDGE_STALE_CHECK_ENABLED: "false",
    // default-OFF schedulers pinned off for determinism
    DATA_RETENTION_ENABLED: "false",
    MATVIEW_REFRESH_ENABLED: "false",
    EXEC_REPORT_ENABLED: "false",
    ANOMALY_BANK_AUTO_REBUILD_ENABLED: "false",
    AI_THRESHOLD_AUTOTUNE_ENABLED: "false",
    KB_AUTOSYNC_ENABLED: "false",
    AI_SELF_LEARNING_ENABLED: "false",
    PREDICTIVE_MAINTENANCE_ENABLED: "false",
    ERP_OUTBOX_ENABLED: "false",
    FLEET_ORCH_ENABLED: "false",
    FLEET_RESOURCE_ENABLED: "false",
    PDM_WORKORDER_ENABLED: "false",
    DR_VERIFY_ENABLED: "false",
    EDGE_RUNTIME_ENABLED: "false",
    AI_MODEL_AUTOROLLBACK_ENABLED: "false",
    AI_MODEL_PERF_SNAPSHOTS_ENABLED: "false",
  };
  const backup: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const [k, v] of Object.entries(FLAG_ENV)) {
      backup[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(backup)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // Generous timeout: real-module bootstrap loads ~25 scheduler modules and
  // can exceed vitest's 5s default under full-suite parallel load.
  it("start → idempotent re-start → stop, without throwing", { timeout: 20_000 }, async () => {
    // Real module (bypasses the vi.mock above).
    const real = (await vi.importActual(
      "./_core/backgroundJobs",
    )) as typeof import("./_core/backgroundJobs");

    await real.startBackgroundSchedulers();
    expect(real.backgroundSchedulersStarted()).toBe(true);

    // Second call is a guarded no-op.
    await real.startBackgroundSchedulers();
    expect(real.backgroundSchedulersStarted()).toBe(true);

    real.stopBackgroundSchedulers();
    expect(real.backgroundSchedulersStarted()).toBe(false);
    // Give the fire-and-forget stop imports a tick to settle.
    await new Promise((r) => setTimeout(r, 50));
  });
});
