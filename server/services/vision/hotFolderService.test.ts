/**
 * Unit tests — hotFolderService (doc 27 gap C1 · W2-A).
 *
 * Covers the production-grade file pipeline against REAL temp dirs + a FakeDb:
 *   • complete CSV → processed, archived, ledger row, submitInspection called ONCE
 *     with the canonical payload (machineCode stamped from the machines table).
 *   • transient-lock (EBUSY) reads retry with backoff → processed.
 *   • malformed file → moved to errorPath + "<name>.reason.txt" sidecar + ledger 'error'.
 *   • idempotent re-drop — identical content dedups (no second submit); previous
 *     'error' rows are taken over and retried; different content processes again.
 *   • archive name collision → timestamp-suffixed copy (both files kept).
 *   • buildWatchOptions — awaitWriteFinish / usePolling safety knobs.
 *   • scanConfigNow — manual folder scan counts.
 *   • dryRunSample — parse+normalize preview, persists nothing.
 * No real chokidar watcher is started (watch loops are exercised via the same
 * processHotFolderFile pipeline the watcher enqueues into).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FakeDb, makeEq, makeAnd, makeDesc, resetSeq } from "../../routers/__otFakeDb";

const fake = new FakeDb();

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: makeEq,
    and: makeAnd,
    desc: makeDesc,
    asc: (col: { name: string }) => ({ name: col.name, dir: "asc" }),
  };
});
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));

import { hotFolderConfigs, hotFolderFiles, machines, type HotFolderConfig } from "../../../drizzle/schema";
import { registerVisionAdapter } from "./visionAdapterRegistry";
import {
  processHotFolderFile,
  readFileWithRetry,
  moveFileSafe,
  buildWatchOptions,
  shouldProcessFileName,
  resolveConfigDirs,
  buildIdempotencyKey,
  scanConfigNow,
  dryRunSample,
  hotFolderIngestEnabled,
  __resetHotFolderRuntimeForTests,
  __setSubmitForTests,
} from "./hotFolderService";
import type { CanonicalInspection } from "./visionAdapterRegistry";

// A CSV-envelope test adapter registered by KEY only (mirrors how W2-B vendor
// adapters plug in — the service resolves via the registry, never a hardcoded list).
let adapterShouldFail = false;
registerVisionAdapter("test-csv", () => ({
  vendorKey: "test-csv",
  label: "Test CSV",
  normalize(raw: unknown, ctx): CanonicalInspection {
    if (adapterShouldFail) throw new Error("test adapter forced failure");
    const env = raw as { rows: Array<Record<string, string>> };
    if (!Array.isArray(env?.rows)) throw new Error("test-csv: expected CSV envelope with rows[]");
    const measurements = env.rows.map((r) => ({
      pointCode: r.point,
      measuredValue: r.value,
      result: (r.judged === "OK" ? "OK" : "NG") as "OK" | "NG",
    }));
    return {
      machineCode: ctx?.machineCode,
      serialNumber: env.rows[0]?.serial ?? "SN-UNKNOWN",
      overallResult: measurements.some((m) => m.result === "NG") ? "NG" : "OK",
      measurements,
    };
  },
}));

let tmpRoot: string;
let cfg: HotFolderConfig;
const submitCalls: CanonicalInspection[] = [];

function makeConfig(overrides: Partial<HotFolderConfig> = {}): HotFolderConfig {
  return {
    id: 1,
    machineId: 5,
    adapterKey: "test-csv",
    watchPath: tmpRoot,
    filePattern: "*.csv",
    archivePath: null,
    errorPath: null,
    enabled: true,
    pollFallbackMs: 0,
    stabilityWindowMs: 500,
    deleteAfterDays: 30,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as HotFolderConfig;
}

const CSV_OK = "serial,point,value,judged\nSN100,MP001,0.42,OK\nSN100,MP002,0.55,OK\n";

async function dropFile(name: string, content: string): Promise<string> {
  const p = path.join(tmpRoot, name);
  await fs.promises.writeFile(p, content, "utf8");
  return p;
}

beforeEach(async () => {
  await __resetHotFolderRuntimeForTests();
  fake.store.clear();
  resetSeq();
  submitCalls.length = 0;
  adapterShouldFail = false;
  process.env.HOT_FOLDER_INGEST_ENABLED = "true";
  tmpRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hotfolder-test-"));
  cfg = makeConfig();
  fake.seed(machines, [{ id: 5, code: "AOI-01", name: "AOI Line A" }]);
  fake.seed(hotFolderConfigs, [cfg as never]);
  fake.setUnique(hotFolderFiles, [["idempotencyKey"]]);
  __setSubmitForTests(async (canonical) => {
    submitCalls.push(canonical);
    return { inspectionId: 4242 };
  });
});

afterEach(async () => {
  await __resetHotFolderRuntimeForTests();
  await fs.promises.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
});

describe("processHotFolderFile — happy path", () => {
  it("ingests a complete CSV: submit once, archive move, ledger 'processed'", async () => {
    const file = await dropFile("board1.csv", CSV_OK);
    const r = await processHotFolderFile(cfg, file);

    expect(r.outcome).toBe("processed");
    expect(r.inspectionId).toBe(4242);
    // submitted through the canonical path with the machine code stamped
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0].machineCode).toBe("AOI-01");
    expect(submitCalls[0].serialNumber).toBe("SN100");
    expect(submitCalls[0].measurements).toHaveLength(2);
    // file moved out of the watch folder into <watch>/archive
    expect(fs.existsSync(file)).toBe(false);
    const { archiveDir } = resolveConfigDirs(cfg);
    expect(fs.existsSync(path.join(archiveDir, "board1.csv"))).toBe(true);
    // ledger row
    const ledger = fake.store.get("hot_folder_files") ?? [];
    expect(ledger).toHaveLength(1);
    expect(ledger[0].status).toBe("processed");
    expect(ledger[0].inspectionId).toBe(4242);
    expect(ledger[0].idempotencyKey).toBe(buildIdempotencyKey(5, ledger[0].contentHash, "board1.csv"));
  });

  it("retries transient EBUSY locks with backoff, then succeeds", async () => {
    const file = await dropFile("locked.csv", CSV_OK);
    let failures = 2;
    const readFn = vi.fn(async (p: string) => {
      if (failures-- > 0) {
        const err: NodeJS.ErrnoException = new Error("resource busy");
        err.code = "EBUSY";
        throw err;
      }
      return fs.promises.readFile(p);
    });
    const r = await processHotFolderFile(cfg, file, {
      read: { readFn, sleepFn: async () => {}, attempts: 5 },
    });
    expect(r.outcome).toBe("processed");
    expect(readFn).toHaveBeenCalledTimes(3);
  });
});

describe("processHotFolderFile — failures", () => {
  it("malformed file → errorPath + .reason.txt sidecar + ledger 'error'", async () => {
    const file = await dropFile("bad.csv", 'a,b\n1,"unterminated');
    const r = await processHotFolderFile(cfg, file);

    expect(r.outcome).toBe("error");
    expect(r.reason).toMatch(/unterminated/);
    const { errorDir } = resolveConfigDirs(cfg);
    const moved = path.join(errorDir, "bad.csv");
    expect(fs.existsSync(moved)).toBe(true);
    const sidecar = `${moved}.reason.txt`;
    expect(fs.existsSync(sidecar)).toBe(true);
    expect(await fs.promises.readFile(sidecar, "utf8")).toMatch(/unterminated/);
    const ledger = fake.store.get("hot_folder_files") ?? [];
    expect(ledger[0].status).toBe("error");
    expect(ledger[0].errorReason).toMatch(/unterminated/);
  });

  it("missing machine row → error outcome (no submit)", async () => {
    fake.seed(machines, []);
    const file = await dropFile("nomachine.csv", CSV_OK);
    const r = await processHotFolderFile(cfg, file);
    expect(r.outcome).toBe("error");
    expect(r.reason).toMatch(/Machine id=5 not found/);
    expect(submitCalls).toHaveLength(0);
  });

  it("unknown adapter key → error with the registry message", async () => {
    const badCfg = makeConfig({ adapterKey: "no-such-vendor" });
    const file = await dropFile("x.csv", CSV_OK);
    const r = await processHotFolderFile(badCfg, file);
    expect(r.outcome).toBe("error");
    expect(r.reason).toMatch(/No vision adapter registered/);
  });
});

describe("processHotFolderFile — idempotency / dedup", () => {
  it("re-drop of IDENTICAL content is a duplicate (single submit), archived with suffix", async () => {
    const f1 = await dropFile("same.csv", CSV_OK);
    expect((await processHotFolderFile(cfg, f1)).outcome).toBe("processed");

    const f2 = await dropFile("same.csv", CSV_OK); // re-drop, same name + content
    const r2 = await processHotFolderFile(cfg, f2);
    expect(r2.outcome).toBe("duplicate");
    expect(submitCalls).toHaveLength(1); // never double-inserted
    expect(fs.existsSync(f2)).toBe(false); // re-drop still cleaned out of the watch dir

    const { archiveDir } = resolveConfigDirs(cfg);
    const archived = await fs.promises.readdir(archiveDir);
    expect(archived.filter((n) => n.startsWith("same"))).toHaveLength(2); // collision → suffix
  });

  it("re-drop with DIFFERENT content (new hash) processes again", async () => {
    const f1 = await dropFile("board.csv", CSV_OK);
    await processHotFolderFile(cfg, f1);
    const f2 = await dropFile("board.csv", CSV_OK.replace("SN100", "SN200"));
    const r2 = await processHotFolderFile(cfg, f2);
    expect(r2.outcome).toBe("processed");
    expect(submitCalls).toHaveLength(2);
    expect(submitCalls[1].serialNumber).toBe("SN200");
  });

  it("takes over a previous 'error' row and retries the same content", async () => {
    adapterShouldFail = true;
    const f1 = await dropFile("retry.csv", CSV_OK);
    expect((await processHotFolderFile(cfg, f1)).outcome).toBe("error");

    adapterShouldFail = false;
    const f2 = await dropFile("retry.csv", CSV_OK); // same content re-dropped after fix
    const r2 = await processHotFolderFile(cfg, f2);
    expect(r2.outcome).toBe("processed");
    expect(submitCalls).toHaveLength(1);
    // the SAME ledger row was reused (claim takeover), not a second row
    const rows = (fake.store.get("hot_folder_files") ?? []).filter((r) => r.fileName === "retry.csv");
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("processed");
  });
});

describe("file-name filtering + watch options", () => {
  it("shouldProcessFileName ignores sidecars, temp files, dotfiles, non-matches", () => {
    expect(shouldProcessFileName("ok.csv", "*.csv")).toBe(true);
    expect(shouldProcessFileName("bad.csv.reason.txt", "*")).toBe(false);
    expect(shouldProcessFileName("x.tmp", "*")).toBe(false);
    expect(shouldProcessFileName("x.part", "*")).toBe(false);
    expect(shouldProcessFileName(".hidden.csv", "*.csv")).toBe(false);
    expect(shouldProcessFileName("y.xml", "*.csv")).toBe(false);
  });

  it("buildWatchOptions wires partial-write + SMB-poll safety knobs", () => {
    const o1 = buildWatchOptions({ stabilityWindowMs: 2000, pollFallbackMs: 0 });
    expect(o1.ignoreInitial).toBe(false); // startup catch-up scan
    expect(o1.awaitWriteFinish.stabilityThreshold).toBe(2000);
    expect(o1.usePolling).toBe(false);
    expect(o1.depth).toBe(0);

    const o2 = buildWatchOptions({ stabilityWindowMs: 100, pollFallbackMs: 1500 });
    expect(o2.awaitWriteFinish.stabilityThreshold).toBe(200); // floor
    expect(o2.usePolling).toBe(true);
    expect(o2.interval).toBe(1500);
  });

  it("readFileWithRetry returns null when the file vanished (ENOENT)", async () => {
    const r = await readFileWithRetry(path.join(tmpRoot, "gone.csv"));
    expect(r).toBeNull();
  });

  it("readFileWithRetry rethrows after exhausting attempts", async () => {
    const readFn = vi.fn(async () => {
      const err: NodeJS.ErrnoException = new Error("still busy");
      err.code = "EBUSY";
      throw err;
    });
    await expect(
      readFileWithRetry("x", { readFn, sleepFn: async () => {}, attempts: 3 }),
    ).rejects.toThrow(/still busy/);
    expect(readFn).toHaveBeenCalledTimes(3);
  });

  it("moveFileSafe keeps both files on a name collision", async () => {
    const dest = path.join(tmpRoot, "arch");
    const a = await dropFile("dup.csv", "one");
    await moveFileSafe(a, dest);
    const b = await dropFile("dup.csv", "two");
    const moved = await moveFileSafe(b, dest);
    expect(path.basename(moved)).toMatch(/^dup-\d+\.csv$/);
    expect((await fs.promises.readdir(dest)).length).toBe(2);
  });
});

describe("scanConfigNow (manual trigger / catch-up)", () => {
  it("processes every matching file in the folder and reports counts", async () => {
    await dropFile("a.csv", CSV_OK);
    await dropFile("b.csv", CSV_OK.replace("SN100", "SN101"));
    await dropFile("skip.xml", "<x/>"); // does not match *.csv
    await dropFile("broken.csv", 'a,b\n"open');

    const r = await scanConfigNow(cfg.id);
    expect(r.scanned).toBe(3); // a, b, broken (skip.xml filtered out)
    expect(r.processed).toBe(2);
    expect(r.errors).toBe(1);
    expect(submitCalls).toHaveLength(2);
  });

  it("throws a clear error for an unknown config id", async () => {
    await expect(scanConfigNow(999)).rejects.toThrow(/not found/);
  });
});

describe("dryRunSample (persists nothing)", () => {
  it("returns the canonical inspection for a valid sample", () => {
    const r = dryRunSample({
      adapterKey: "test-csv",
      fileName: "sample.csv",
      content: CSV_OK,
      machineCode: "AOI-01",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.format).toBe("csv");
      expect(r.canonical.serialNumber).toBe("SN100");
      expect(r.summary.measurementCount).toBe(2);
      expect(r.summary.machineIdentityResolved).toBe(true);
    }
    expect(submitCalls).toHaveLength(0); // nothing persisted
    expect(fake.store.get("hot_folder_files") ?? []).toHaveLength(0);
  });

  it("reports the parse stage for malformed content", () => {
    const r = dryRunSample({ adapterKey: "test-csv", fileName: "x.json", content: "{bad" });
    expect(r).toMatchObject({ ok: false, stage: "parse" });
  });

  it("reports the normalize stage for adapter rejections", () => {
    const r = dryRunSample({ adapterKey: "generic-json", fileName: "x.json", content: "{}" });
    expect(r).toMatchObject({ ok: false, stage: "normalize" });
    if (!r.ok) expect(r.error).toMatch(/serial/);
  });
});

describe("flag gating", () => {
  it("hotFolderIngestEnabled reads the env at call time", () => {
    process.env.HOT_FOLDER_INGEST_ENABLED = "false";
    expect(hotFolderIngestEnabled()).toBe(false);
    process.env.HOT_FOLDER_INGEST_ENABLED = "true";
    expect(hotFolderIngestEnabled()).toBe(true);
  });
});
