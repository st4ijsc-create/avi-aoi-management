/**
 * Unit tests — imageLifecycleService (doc 27 §11 decisions #2/#5, gap R6).
 *
 * Pure filesystem tests against a temp uploads root:
 *   • deleteStorageKeys: deletes files, counts missing, blocks path traversal.
 *   • deleteInspectionDirs: removes uploads/inspections/<id>/, rejects bad ids.
 *   • pruneOldInspectionImages: mtime-based sweep — old dirs removed, fresh kept,
 *     respects maxDirsPerRun bound and retentionDays<=0 disable.
 *   • evaluateDiskUsage: pure 80%-threshold logic (decision #5).
 *   • checkUploadsDiskUsage: alert fires via injected notify at ≥ threshold,
 *     is debounced, and is silent below threshold.
 *   • startImageLifecycle: no-op when DATA_RETENTION_ENABLED is off or storage
 *     is not local.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  deleteStorageKeys,
  deleteInspectionDirs,
  pruneOldInspectionImages,
  evaluateDiskUsage,
  checkUploadsDiskUsage,
  startImageLifecycle,
  stopImageLifecycle,
  uploadsRoot,
  resolveUnderRoot,
  __resetDiskAlertDebounce,
} from "./imageLifecycleService";

let tmpRoot: string;
const envBackup: Record<string, string | undefined> = {};

function setEnv(key: string, value: string | undefined) {
  if (!(key in envBackup)) envBackup[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function mkFile(rel: string, mtimeMs?: number): Promise<string> {
  const p = path.join(tmpRoot, rel);
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  await fs.promises.writeFile(p, "x");
  if (mtimeMs !== undefined) {
    const t = new Date(mtimeMs);
    await fs.promises.utimes(p, t, t);
  }
  return p;
}

beforeEach(async () => {
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "img-lifecycle-"));
  setEnv("STORAGE_MODE", "local");
  setEnv("LOCAL_STORAGE_DIR", tmpRoot);
  setEnv("DATA_RETENTION_ENABLED", undefined);
  __resetDiskAlertDebounce();
});

afterEach(async () => {
  stopImageLifecycle();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(envBackup)) delete envBackup[k];
  await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe("uploadsRoot / resolveUnderRoot", () => {
  it("resolves LOCAL_STORAGE_DIR and keeps keys inside the root", () => {
    expect(uploadsRoot()).toBe(path.resolve(tmpRoot));
    expect(resolveUnderRoot("inspections/1/a.jpg")).toBe(
      path.resolve(tmpRoot, "inspections", "1", "a.jpg"),
    );
  });

  it("rejects traversal keys", () => {
    expect(resolveUnderRoot("../evil.txt")).toBeNull();
    expect(resolveUnderRoot("inspections/../../evil.txt")).toBeNull();
  });
});

describe("deleteStorageKeys", () => {
  it("deletes existing files and counts missing/blocked", async () => {
    await mkFile("inspections/42/p1-abc.jpg");
    const res = await deleteStorageKeys([
      "inspections/42/p1-abc.jpg", // exists
      "inspections/42/gone.jpg",   // missing
      "../outside.txt",            // traversal
      null,
      undefined,
      "",
    ]);
    expect(res).toEqual({ deleted: 1, missing: 1, blocked: 1 });
    expect(fs.existsSync(path.join(tmpRoot, "inspections/42/p1-abc.jpg"))).toBe(false);
  });

  it("is a no-op when storage is not local", async () => {
    await mkFile("inspections/7/x.jpg");
    setEnv("STORAGE_MODE", "forge");
    const res = await deleteStorageKeys(["inspections/7/x.jpg"]);
    expect(res).toEqual({ deleted: 0, missing: 0, blocked: 0 });
    expect(fs.existsSync(path.join(tmpRoot, "inspections/7/x.jpg"))).toBe(true);
  });
});

describe("deleteInspectionDirs", () => {
  it("removes whole per-inspection directories", async () => {
    await mkFile("inspections/100/a.jpg");
    await mkFile("inspections/100/b.jpg");
    await mkFile("inspections/101/c.jpg");
    const res = await deleteInspectionDirs([100]);
    expect(res.deletedDirs).toBe(1);
    expect(fs.existsSync(path.join(tmpRoot, "inspections/100"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "inspections/101/c.jpg"))).toBe(true);
  });

  it("ignores non-numeric ids (defence-in-depth vs path abuse)", async () => {
    await mkFile("inspections/200/a.jpg");
    const res = await deleteInspectionDirs(["../200" as unknown as string, "abc", "200/.." as any]);
    expect(res.deletedDirs).toBe(0);
    expect(fs.existsSync(path.join(tmpRoot, "inspections/200/a.jpg"))).toBe(true);
  });
});

describe("pruneOldInspectionImages", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("removes dirs older than the window, keeps fresh ones", async () => {
    const now = Date.now();
    await mkFile("inspections/1/old.jpg", now - 400 * DAY);
    await mkFile("inspections/2/fresh.jpg", now - 10 * DAY);
    // dir 3: one old + one fresh file → newest wins → kept
    await mkFile("inspections/3/old.jpg", now - 400 * DAY);
    await mkFile("inspections/3/new.jpg", now - 5 * DAY);

    const res = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now });
    expect(res.skipped).toBe(false);
    expect(res.deletedDirs).toBe(1);
    expect(fs.existsSync(path.join(tmpRoot, "inspections/1"))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, "inspections/2/fresh.jpg"))).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, "inspections/3/new.jpg"))).toBe(true);
  });

  it("respects retentionDays <= 0 (disabled) and missing base dir", async () => {
    const res1 = await pruneOldInspectionImages({ retentionDays: 0 });
    expect(res1.skipped).toBe(true);
    const res2 = await pruneOldInspectionImages({ retentionDays: 365 }); // no inspections/ dir
    expect(res2.deletedDirs).toBe(0);
  });

  it("bounds work per run via maxDirsPerRun", async () => {
    const now = Date.now();
    await mkFile("inspections/10/a.jpg", now - 400 * DAY);
    await mkFile("inspections/11/a.jpg", now - 400 * DAY);
    await mkFile("inspections/12/a.jpg", now - 400 * DAY);
    const res = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: 2 });
    expect(res.scannedDirs).toBe(2);
    expect(res.deletedDirs).toBe(2);
  });
});

describe("evaluateDiskUsage (decision #5 — alert at 80%)", () => {
  it("no alert below threshold", () => {
    const r = evaluateDiskUsage(1000, 300, 80); // 70% used
    expect(r.alert).toBe(false);
    expect(r.usedPct).toBeCloseTo(70);
  });

  it("alerts at/above threshold", () => {
    expect(evaluateDiskUsage(1000, 200, 80).alert).toBe(true); // exactly 80%
    expect(evaluateDiskUsage(1000, 50, 80).alert).toBe(true);  // 95%
  });

  it("handles degenerate totals safely", () => {
    expect(evaluateDiskUsage(0, 0, 80)).toEqual({ usedPct: 0, alert: false });
  });
});

describe("checkUploadsDiskUsage", () => {
  it("notifies once at >= threshold and debounces repeats", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const statfsFn = async () => ({ bsize: 4096, blocks: 1000, bavail: 100 }); // 90% used
    const first = await checkUploadsDiskUsage({ statfsFn, notifyFn: notify });
    expect(first?.alert).toBe(true);
    expect(first?.usedPct).toBeCloseTo(90);
    expect(notify).toHaveBeenCalledTimes(1);

    await checkUploadsDiskUsage({ statfsFn, notifyFn: notify });
    expect(notify).toHaveBeenCalledTimes(1); // debounced (24h)
  });

  it("stays silent below threshold", async () => {
    const notify = vi.fn();
    const res = await checkUploadsDiskUsage({
      statfsFn: async () => ({ bsize: 4096, blocks: 1000, bavail: 600 }), // 40%
      notifyFn: notify,
    });
    expect(res?.alert).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("returns null when storage is not local", async () => {
    setEnv("STORAGE_MODE", "forge");
    expect(await checkUploadsDiskUsage()).toBeNull();
  });
});

describe("startImageLifecycle gating", () => {
  it("is a no-op when DATA_RETENTION_ENABLED is not 'true'", () => {
    setEnv("DATA_RETENTION_ENABLED", "false");
    expect(() => {
      startImageLifecycle();
      stopImageLifecycle();
    }).not.toThrow();
  });

  it("is inactive when storage is not local (even with the flag on)", () => {
    setEnv("DATA_RETENTION_ENABLED", "true");
    setEnv("STORAGE_MODE", "forge");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    startImageLifecycle();
    stopImageLifecycle();
    expect(log.mock.calls.some((c) => String(c[0]).includes("not 'local'"))).toBe(true);
    log.mockRestore();
  });
});
