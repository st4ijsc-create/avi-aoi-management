/**
 * Unit tests — orphan-image reaper (CASE #5, doc 51 §11.2).
 *
 * The reaper diffs storage objects under the inspection prefix against the set of
 * keys referenced by measurement_results, and (only when NOT in dry-run) deletes
 * objects that have no DB row and are older than the grace period.
 *
 * Coverage (mutation-tested — each assertion goes RED if the guard it protects is
 * removed):
 *   • DRY-RUN default: eligible orphans are reported but NEVER deleted.
 *   • DELETE mode: ONLY orphan + aged objects are deleted; referenced objects and
 *     fresh (< grace) orphans are left alone.
 *   • Grace period protects objects younger than the window (mid-write safety).
 *   • Honest-refuse: DB reference load failure → skipped, zero deletes.
 *   • Unsupported backend (mode!=local, no listFn) → skipped, zero deletes.
 *   • Local fs listing walks nested inspection dirs.
 *   • URL-derived reference keys (legacy rows) are honored.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  reapOrphanImages,
  listLocalStorageObjects,
  deriveKeyFromUploadsUrl,
  normalizeStorageKey,
  type StorageObject,
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

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // fixed clock for deterministic ageing

beforeEach(async () => {
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "orphan-reaper-"));
  setEnv("STORAGE_MODE", "local");
  setEnv("LOCAL_STORAGE_DIR", tmpRoot);
});

afterEach(async () => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(envBackup)) delete envBackup[k];
  await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe("listLocalStorageObjects", () => {
  it("walks nested inspection dirs and returns posix keys with mtimes", async () => {
    await mkFile("inspections/1/p1-aaa.png", NOW - 5 * HOUR);
    await mkFile("inspections/2/nested/p2-bbb.jpg", NOW - 5 * HOUR);
    await mkFile("exports/report.xlsx", NOW); // different prefix — must not appear

    const objs = await listLocalStorageObjects("inspections");
    const keys = objs.map((o) => o.key).sort();
    expect(keys).toEqual(["inspections/1/p1-aaa.png", "inspections/2/nested/p2-bbb.jpg"]);
    expect(objs.every((o) => o.mtimeMs > 0)).toBe(true);
  });

  it("returns [] for a missing prefix dir", async () => {
    expect(await listLocalStorageObjects("inspections")).toEqual([]);
  });
});

describe("deriveKeyFromUploadsUrl", () => {
  it("recovers the key from a /uploads/ URL and ignores http(s)/data URLs", () => {
    expect(deriveKeyFromUploadsUrl("/uploads/inspections/1/p1-aaa.png")).toBe(
      "inspections/1/p1-aaa.png",
    );
    expect(deriveKeyFromUploadsUrl("https://cdn.example/x.png")).toBeNull();
    expect(deriveKeyFromUploadsUrl(null)).toBeNull();
  });
});

describe("reapOrphanImages — DB diff", () => {
  it("DRY-RUN (default): reports eligible orphans but deletes nothing", async () => {
    const referenced = await mkFile("inspections/1/kept-aaa.png", NOW - 48 * HOUR);
    const orphan = await mkFile("inspections/1/orphan-bbb.png", NOW - 48 * HOUR);

    const res = await reapOrphanImages({
      nowMs: NOW,
      graceHours: 24,
      referencedKeysFn: async () => new Set(["inspections/1/kept-aaa.png"]),
    });

    expect(res.dryRun).toBe(true);
    expect(res.scanned).toBe(2);
    expect(res.referenced).toBe(1);
    expect(res.eligible).toBe(1);
    expect(res.deleted).toBe(0);
    expect(res.sampleOrphanKeys).toContain("inspections/1/orphan-bbb.png");
    // Nothing was actually removed.
    expect(fs.existsSync(referenced)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(true);
  });

  it("DELETE mode: removes ONLY aged orphans; keeps referenced + fresh orphans", async () => {
    const referenced = await mkFile("inspections/1/kept-aaa.png", NOW - 48 * HOUR);
    const agedOrphan = await mkFile("inspections/1/orphan-old.png", NOW - 48 * HOUR);
    const freshOrphan = await mkFile("inspections/2/orphan-new.png", NOW - 1 * HOUR);

    const res = await reapOrphanImages({
      dryRun: false,
      nowMs: NOW,
      graceHours: 24,
      referencedKeysFn: async () => new Set(["inspections/1/kept-aaa.png"]),
    });

    expect(res.dryRun).toBe(false);
    expect(res.scanned).toBe(3);
    expect(res.referenced).toBe(1);
    expect(res.orphans).toBe(2);
    expect(res.eligible).toBe(1); // only the aged orphan
    expect(res.deleted).toBe(1);
    expect(res.failed).toBe(0);

    expect(fs.existsSync(referenced)).toBe(true); // referenced kept
    expect(fs.existsSync(freshOrphan)).toBe(true); // fresh (< grace) kept
    expect(fs.existsSync(agedOrphan)).toBe(false); // aged orphan deleted
  });

  it("grace period protects objects younger than the window", async () => {
    const justUnder = await mkFile("inspections/1/orphan-young.png", NOW - 23 * HOUR);
    const res = await reapOrphanImages({
      dryRun: false,
      nowMs: NOW,
      graceHours: 24,
      referencedKeysFn: async () => new Set<string>(),
    });
    expect(res.orphans).toBe(1);
    expect(res.eligible).toBe(0);
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(justUnder)).toBe(true);
  });

  it("honors URL-derived reference keys (legacy rows without imageKey)", async () => {
    const legacy = await mkFile("inspections/9/legacy-ref.png", NOW - 100 * HOUR);
    // Referenced only via imageUrl → derived key must protect it.
    const referencedViaUrl = deriveKeyFromUploadsUrl("/uploads/inspections/9/legacy-ref.png")!;
    const res = await reapOrphanImages({
      dryRun: false,
      nowMs: NOW,
      graceHours: 24,
      referencedKeysFn: async () => new Set([referencedViaUrl]),
    });
    expect(res.referenced).toBe(1);
    expect(res.deleted).toBe(0);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it("HONEST-REFUSE: DB reference load failure → skipped, zero deletes", async () => {
    const orphan = await mkFile("inspections/1/orphan.png", NOW - 100 * HOUR);
    const res = await reapOrphanImages({
      dryRun: false,
      nowMs: NOW,
      referencedKeysFn: async () => {
        throw new Error("database unavailable");
      },
    });
    expect(res.skipped).toBe(true);
    expect(res.skipReason).toMatch(/refusing to reap/i);
    expect(res.deleted).toBe(0);
    expect(res.scanned).toBe(0);
    expect(fs.existsSync(orphan)).toBe(true); // never touched
  });

  it("unsupported backend (mode!=local, no listFn) → skipped, zero deletes", async () => {
    const res = await reapOrphanImages({
      dryRun: false,
      mode: "forge",
      referencedKeysFn: async () => new Set<string>(),
    });
    expect(res.skipped).toBe(true);
    expect(res.skipReason).toMatch(/not supported/i);
    expect(res.deleted).toBe(0);
  });

  it("forge backend works when a listFn + deleteFn adapter is injected", async () => {
    const listed: StorageObject[] = [
      { key: "inspections/1/ref.png", mtimeMs: NOW - 48 * HOUR },
      { key: "inspections/1/orphan.png", mtimeMs: NOW - 48 * HOUR },
    ];
    const deleted: string[] = [];
    const res = await reapOrphanImages({
      dryRun: false,
      mode: "forge",
      nowMs: NOW,
      graceHours: 24,
      listFn: async () => listed,
      referencedKeysFn: async () => new Set(["inspections/1/ref.png"]),
      deleteFn: async (key) => {
        deleted.push(key);
        return { deleted: true };
      },
    });
    expect(res.eligible).toBe(1);
    expect(res.deleted).toBe(1);
    expect(deleted).toEqual(["inspections/1/orphan.png"]);
  });

  it("respects maxDeletePerRun bound", async () => {
    const listed: StorageObject[] = Array.from({ length: 5 }, (_, i) => ({
      key: `inspections/1/orphan-${i}.png`,
      mtimeMs: NOW - 48 * HOUR,
    }));
    let deletes = 0;
    const res = await reapOrphanImages({
      dryRun: false,
      mode: "forge",
      nowMs: NOW,
      graceHours: 24,
      maxDeletePerRun: 2,
      listFn: async () => listed,
      referencedKeysFn: async () => new Set<string>(),
      deleteFn: async () => {
        deletes++;
        return { deleted: true };
      },
    });
    expect(res.eligible).toBe(5);
    expect(res.deleted).toBe(2);
    expect(deletes).toBe(2);
  });
});

describe("normalizeStorageKey", () => {
  it("converts backslashes and strips leading slashes", () => {
    expect(normalizeStorageKey("\\inspections\\1\\a.png")).toBe("inspections/1/a.png");
    expect(normalizeStorageKey("/inspections/1/a.png")).toBe("inspections/1/a.png");
  });
});
