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
  sweepAoiCache,
  aoiCacheRoot,
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

describe("pruneOldInspectionImages — con trỏ bền (không để thư mục cũ đói vì thư mục trẻ đứng trước)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("★ nhiều thư mục TRẺ (> trần mỗi lượt) đứng trước một thư mục CŨ ⇒ thư mục cũ vẫn bị xử lý ở lượt kế (bản cũ: không bao giờ)", async () => {
    const now = Date.now();
    // Cùng tính chất với ca 5 001 thư mục nhưng thu nhỏ theo TRẦN: trần mỗi lượt = 40, 41 thư mục trẻ (ids 1..41) đứng trước thư mục
    // cũ (id 42). Bản cũ: đếm mọi thư mục và không có con trỏ ⇒ lượt nào cũng chỉ xét 40 tên đầu ⇒ thư mục cũ KHÔNG BAO GIỜ được xét.
    // (Bản 5 001 thư mục tốn ~100 s khi cả lô đang tải và gây timeout giả; tính chất kiểm không phụ thuộc cỡ tuyệt đối.)
    const TRAN = 40;
    for (let id = 1; id <= TRAN + 1; id++) await mkFile(`inspections/${id}/a.jpg`, now - 10 * DAY);
    await mkFile(`inspections/${TRAN + 2}/old.jpg`, now - 400 * DAY);

    const r1 = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: TRAN });
    expect(r1.scannedDirs).toBe(TRAN);
    expect(r1.deletedDirs).toBe(0);
    expect(r1.wrapped).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, `inspections/${TRAN + 2}`))).toBe(true);

    const r2 = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: TRAN });
    expect(r2.scannedDirs).toBe(2); // id 41 và 42 — phần còn lại sau con trỏ
    expect(r2.deletedDirs).toBe(1);
    expect(r2.wrapped).toBe(true);
    expect(fs.existsSync(path.join(tmpRoot, `inspections/${TRAN + 2}`))).toBe(false);
    expect(fs.existsSync(path.join(tmpRoot, `inspections/${TRAN + 1}/a.jpg`))).toBe(true);
  });

  it("duyệt theo id SỐ tăng dần (2 trước 10), trần chỉ đếm thư mục đã xét, hết vòng thì quay lại đầu", async () => {
    const now = Date.now();
    for (const id of [10, 2, 33, 4, 100]) await mkFile(`inspections/${id}/a.jpg`, now - 5 * DAY);
    const r1 = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: 2 });
    expect([r1.scannedDirs, r1.nextCursor, r1.wrapped]).toEqual([2, "4", false]); // 2, 4
    const r2 = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: 2 });
    expect([r2.scannedDirs, r2.nextCursor, r2.wrapped]).toEqual([2, "33", false]); // 10, 33
    const r3 = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: 2 });
    expect([r3.scannedDirs, r3.nextCursor, r3.wrapped]).toEqual([1, null, true]); // 100 ⇒ hết vòng
    const r4 = await pruneOldInspectionImages({ retentionDays: 365, nowMs: now, maxDirsPerRun: 2 });
    expect([r4.scannedDirs, r4.nextCursor]).toEqual([2, "4"]); // quay lại đầu
  });

  it("tệp con trỏ nằm NGOÀI `inspections/` (reaper liệt kê tiền tố đó sẽ không coi nó là ảnh mồ côi)", async () => {
    await mkFile("inspections/1/a.jpg", Date.now());
    await pruneOldInspectionImages({ retentionDays: 365, maxDirsPerRun: 1 });
    expect(fs.existsSync(path.join(tmpRoot, ".lifecycle", "inspections-prune.cursor.json"))).toBe(true);
    expect(fs.readdirSync(path.join(tmpRoot, "inspections"))).toEqual(["1"]);
  });

  it("con trỏ hỏng/không ghi được ⇒ không sập, lượt sau chỉ bắt đầu từ đầu", async () => {
    await mkFile("inspections/1/a.jpg", Date.now());
    await mkFile(".lifecycle/inspections-prune.cursor.json");
    await fs.promises.writeFile(path.join(tmpRoot, ".lifecycle", "inspections-prune.cursor.json"), "{not json");
    const r = await pruneOldInspectionImages({ retentionDays: 365 });
    expect(r.scannedDirs).toBe(1);
  });
});

describe("sweepAoiCache — bộ quét bộ nhớ đệm ảnh AOI (mặc định DRY-RUN)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  let cache: string;
  beforeEach(() => {
    cache = path.join(tmpRoot, "aoi-cache");
  });
  async function mk(rel: string, bytes: number, mtimeMs: number) {
    const p = path.join(cache, rel);
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    await fs.promises.writeFile(p, Buffer.alloc(bytes, 1));
    const t = new Date(mtimeMs);
    await fs.promises.utimes(p, t, t);
  }

  it("mặc định chỉ BÁO CÁO: đếm đúng thư mục/tệp/byte hết hạn, KHÔNG xoá gì", async () => {
    const now = Date.now();
    await mk("PKG-OLD/a.jpg", 100, now - 30 * DAY);
    await mk("PKG-OLD/b.jpg", 50, now - 20 * DAY);
    await mk("PKG-MIX/old.jpg", 10, now - 30 * DAY);
    await mk("PKG-MIX/new.jpg", 10, now - 1 * DAY); // tệp mới nhất còn trẻ ⇒ cả thư mục KHÔNG hết hạn
    await mk("PKG-NEW/c.jpg", 10, now - 2 * DAY);
    const r = await sweepAoiCache({ cacheDir: cache, ttlDays: 7, nowMs: now });
    expect(r).toMatchObject({ dryRun: true, scannedDirs: 3, expiredDirs: 1, expiredFiles: 2, expiredBytes: 150, deletedDirs: 0 });
    expect(fs.existsSync(path.join(cache, "PKG-OLD/a.jpg"))).toBe(true);
  });

  it("dryRun:false xoá ĐÚNG thư mục hết hạn, giữ thư mục còn tươi", async () => {
    const now = Date.now();
    await mk("PKG-OLD/a.jpg", 5, now - 30 * DAY);
    await mk("PKG-MIX/old.jpg", 5, now - 30 * DAY);
    await mk("PKG-MIX/new.jpg", 5, now - 1 * DAY);
    const r = await sweepAoiCache({ cacheDir: cache, ttlDays: 7, nowMs: now, dryRun: false });
    expect(r.deletedDirs).toBe(1);
    expect(fs.existsSync(path.join(cache, "PKG-OLD"))).toBe(false);
    expect(fs.existsSync(path.join(cache, "PKG-MIX/old.jpg"))).toBe(true);
  });

  it("giới hạn thư mục/lượt + con trỏ: nhiều lượt mới phủ hết, không lượt nào xét quá trần", async () => {
    const now = Date.now();
    for (let i = 0; i < 7; i++) await mk(`P${i}/a.jpg`, 1, now - 30 * DAY);
    const seen: number[] = [];
    let exp = 0;
    for (let k = 0; k < 3; k++) {
      const r = await sweepAoiCache({ cacheDir: cache, ttlDays: 7, nowMs: now, maxDirsPerRun: 3 });
      seen.push(r.scannedDirs);
      exp += r.expiredDirs;
    }
    expect(seen).toEqual([3, 3, 1]);
    expect(exp).toBe(7);
  });

  it("TTL <= 0 ⇒ tắt; thư mục gốc chưa có ⇒ bỏ qua êm", async () => {
    expect((await sweepAoiCache({ cacheDir: cache, ttlDays: 0 })).skipped).toBe(true);
    expect((await sweepAoiCache({ cacheDir: path.join(tmpRoot, "khong-co"), ttlDays: 7 })).skipped).toBe(true);
  });

  it("aoiCacheRoot khớp quy tắc của aoiPackageRouter (AOI_CACHE_DIR hoặc ./uploads/aoi-cache)", () => {
    setEnv("AOI_CACHE_DIR", path.join(tmpRoot, "x"));
    expect(aoiCacheRoot()).toBe(path.join(tmpRoot, "x"));
    setEnv("AOI_CACHE_DIR", undefined);
    expect(aoiCacheRoot()).toBe(path.join(process.cwd(), "uploads", "aoi-cache"));
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
