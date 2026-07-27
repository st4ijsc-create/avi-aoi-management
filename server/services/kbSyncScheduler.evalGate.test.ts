/**
 * doc69 Giai đoạn 6 / Wave 5 (B1) — kbSyncScheduler answer-eval gate unit tests.
 *
 * Everything is mocked: node:child_process (spawn → FakeChild EventEmitter, for BOTH the
 * `npm run kb:sync` child and the `node scripts/ai-kb/eval-rag.mjs --ci` child) and node:fs
 * (in-memory store). No real process is ever spawned, no real file under knowledge/ is ever
 * touched, no live kb:sync/eval ever runs.
 *
 * KB_AUTOSYNC_ENABLED must be "true" at module load (autosync's own master switch — the gate
 * only matters inside an autosync run), set via vi.hoisted before the static import, mirroring
 * aiThresholdTuneScheduler.test.ts. KB_AUTOSYNC_EVAL_GATE is read PER-CALL by the SUT
 * (isEvalGateEnabled()), so it's simply flipped per-test via process.env — no module reset
 * needed.
 *
 * Covers (per the B1 brief):
 *   - gate PASS: sync ok + eval exit 0 with a fresh result → new KB kept, snapshot discarded,
 *     evalGate:"pass" + recall.
 *   - gate FAIL: sync ok + eval exit 1 with a FRESH (regressed) result → snapshot RESTORED —
 *     the pre-sync artifacts are verifiably back — evalGate:"fail" + reason.
 *   - eval UNAVAILABLE: eval exit 1 WITHOUT a fresh result (harness crash / golden set
 *     missing) → NEW KB KEPT (no rollback), evalGate:"skipped" — proves eval-unavailable is
 *     NOT conflated with a regression, even with a STALE results file left over from a
 *     previous run.
 *   - sync FAIL: npm run kb:sync exits non-zero → no eval spawned, no corruption, snapshot
 *     discarded (cleaned up).
 *   - gate flag OFF (KB_AUTOSYNC_EVAL_GATE=false): sync runs, no snapshot ever taken, no eval
 *     spawned — behaves exactly as before B1.
 *   - fail-safe: a transient error on the FIRST restore attempt does not corrupt the KB — the
 *     gate's own catch retries the restore and the pre-sync KB ends up live.
 *   - fail-safe (worse case): the retry ALSO fails → the run still resolves (never hangs/
 *     throws out of runKbSyncNow, single-flight lock still released) and honestly reports
 *     rolledBack as falsy rather than claiming a restore it couldn't verify.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";

vi.hoisted(() => {
  process.env.KB_AUTOSYNC_ENABLED = "true";
});

// ─── node:fs — in-memory store ────────────────────────────────────────────────
const fsStore = new Map<string, string>();
const fsExist = new Set<string>();
let tmpDirCounter = 0;
// # of RESTORE-direction copyFileSync calls (dst = an original knowledge/ path, NOT the
// snapshot temp dir) that should throw before behaving normally again. Snapshot-direction
// copies (dst = the temp backup dir) are never affected — see isBackupPath below.
let restoreFailuresRemaining = 0;

function isBackupPath(p: string): boolean {
  return p.includes("kb-eval-gate-backup");
}

vi.mock("node:fs", () => {
  const api = {
    existsSync: (p: string) => fsExist.has(p),
    readFileSync: (p: string) => {
      if (!fsStore.has(p)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file, open '${p}'`);
        err.code = "ENOENT";
        throw err;
      }
      return fsStore.get(p)!;
    },
    writeFileSync: (p: string, data: string) => {
      fsStore.set(p, String(data));
      fsExist.add(p);
    },
    copyFileSync: (src: string, dst: string) => {
      if (!isBackupPath(dst) && restoreFailuresRemaining > 0) {
        restoreFailuresRemaining--;
        throw new Error("simulated transient disk error during restore");
      }
      if (!fsStore.has(src)) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file, copyfile '${src}'`);
        err.code = "ENOENT";
        throw err;
      }
      fsStore.set(dst, fsStore.get(src)!);
      fsExist.add(dst);
    },
    unlinkSync: (p: string) => {
      fsStore.delete(p);
      fsExist.delete(p);
    },
    mkdirSync: (p: string) => {
      fsExist.add(p);
    },
    mkdtempSync: (prefix: string) => {
      const dir = `${prefix}${tmpDirCounter++}`;
      fsExist.add(dir);
      return dir;
    },
    rmSync: (p: string) => {
      fsExist.delete(p);
      fsStore.delete(p);
      const prefix1 = `${p}${path.sep}`;
      const prefix2 = `${p}/`;
      for (const k of [...fsExist]) {
        if (k.startsWith(prefix1) || k.startsWith(prefix2)) fsExist.delete(k);
      }
      for (const k of [...fsStore.keys()]) {
        if (k.startsWith(prefix1) || k.startsWith(prefix2)) fsStore.delete(k);
      }
    },
  };
  return { default: api, ...api };
});

// ─── node:child_process — spawn → controllable FakeChild ──────────────────────
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;
  kill() {
    this.killed = true;
  }
}

type SpawnBehavior = (child: FakeChild) => void;
const spawnCalls: { cmd: string; args: string[]; opts: Record<string, unknown> | undefined }[] = [];
let syncBehavior: SpawnBehavior = (child) => child.emit("close", 0);
let evalBehavior: SpawnBehavior = (child) => child.emit("close", 0);

const spawnMock = vi.fn((cmd: string, args: string[], opts?: Record<string, unknown>) => {
  spawnCalls.push({ cmd, args, opts });
  const child = new FakeChild();
  const isEvalCall = args.some((a) => String(a).includes("eval-rag.mjs"));
  // Defer to a microtask so the SUT's synchronous `.on(...)` listener registration
  // (which happens right after spawn() returns) is guaranteed to run first.
  queueMicrotask(() => {
    (isEvalCall ? evalBehavior : syncBehavior)(child);
  });
  return child;
});
vi.mock("node:child_process", () => ({
  spawn: (...a: [string, string[], Record<string, unknown>?]) => (spawnMock as unknown as (...a: unknown[]) => FakeChild)(...a),
}));

import { runKbSyncNow, getKbSyncSchedulerStatus } from "./kbSyncScheduler";

// ─── fixtures ──────────────────────────────────────────────────────────────────
function kbPath(name: string): string {
  return path.join(process.cwd(), "knowledge", name);
}
function seed(name: string, content: string) {
  const p = kbPath(name);
  fsStore.set(p, content);
  fsExist.add(p);
}
function read(name: string): string | undefined {
  return fsStore.get(kbPath(name));
}
function exists(name: string): boolean {
  return fsExist.has(kbPath(name));
}

/** Pre-sync fixture: the "old" KB. embeddings/meta/chunks are present; semantic-graph.json
 * is intentionally ABSENT (as if it's this artifact's first-ever build), so restore must
 * exercise BOTH branches: "copy the backup back" and "delete what the sync created". */
function seedOldKb() {
  seed("embeddings.jsonl", "OLD_EMBEDDINGS");
  seed(
    "embeddings-meta.json",
    JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", model: "Qwen3-Embedding-0.6B-f16" }),
  );
  seed("chunks.jsonl", "OLD_CHUNK_LINE\n");
}

/** Default sync behavior: overwrites the corpus in place + creates semantic-graph.json
 * (mirrors what `npm run kb:sync` really does), then exits 0. */
function syncSucceedsMutating(child: FakeChild) {
  seed("embeddings.jsonl", "NEW_EMBEDDINGS");
  seed(
    "embeddings-meta.json",
    JSON.stringify({ generatedAt: "2026-07-27T03:00:00.000Z", model: "Qwen3-Embedding-0.6B-f16" }),
  );
  seed("chunks.jsonl", "NEW_CHUNK_LINE\n");
  seed("semantic-graph.json", "NEW_GRAPH"); // did not exist before this sync
  child.emit("close", 0);
}

function evalPass(recall: number): SpawnBehavior {
  return (child) => {
    seed("rag-eval-results.json", JSON.stringify({ overall: { recall }, timestamp: new Date().toISOString() }));
    child.emit("close", 0);
  };
}
function evalFailRegression(recall: number): SpawnBehavior {
  return (child) => {
    seed("rag-eval-results.json", JSON.stringify({ overall: { recall }, timestamp: new Date().toISOString() }));
    child.emit("close", 1);
  };
}
/** Golden set missing / embed-model load error / any harness crash BEFORE it can write the
 * machine-readable summary — exits 1 but rag-eval-results.json is left untouched. */
function evalHarnessCrash(): SpawnBehavior {
  return (child) => child.emit("close", 1);
}

beforeEach(() => {
  fsStore.clear();
  fsExist.clear();
  spawnCalls.length = 0;
  spawnMock.mockClear();
  tmpDirCounter = 0;
  restoreFailuresRemaining = 0;
  syncBehavior = syncSucceedsMutating;
  evalBehavior = evalPass(0.95);
  process.env.KB_AUTOSYNC_EVAL_GATE = "true";
  delete process.env.KB_AUTOSYNC_EVAL_TIMEOUT_MS;
  seedOldKb();
});

afterEach(() => {
  delete process.env.KB_AUTOSYNC_EVAL_GATE;
  delete process.env.KB_AUTOSYNC_EVAL_TIMEOUT_MS;
});

describe("kbSyncScheduler — B1 answer-eval gate", () => {
  it('PASS: eval exit 0 with a fresh result → new KB kept, snapshot discarded, evalGate:"pass"', async () => {
    evalBehavior = evalPass(0.97);

    const stats = await runKbSyncNow();

    expect(stats.ok).toBe(true);
    expect(stats.evalGate).toBe("pass");
    expect(stats.evalRecall).toBe(0.97);
    expect(stats.rolledBack).toBeFalsy();

    // new KB stayed live — nothing rolled back.
    expect(read("embeddings.jsonl")).toBe("NEW_EMBEDDINGS");
    expect(read("chunks.jsonl")).toBe("NEW_CHUNK_LINE\n");
    expect(exists("semantic-graph.json")).toBe(true);

    // both processes were spawned: npm run kb:sync, then the eval harness as an argv array
    // (no shell string).
    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]!.cmd).toBe("npm");
    expect(spawnCalls[1]!.cmd).toBe(process.execPath);
    expect(spawnCalls[1]!.args).toEqual([path.join(process.cwd(), "scripts", "ai-kb", "eval-rag.mjs"), "--ci"]);
    expect(spawnCalls[1]!.opts?.shell).toBeFalsy();

    expect(getKbSyncSchedulerStatus().running).toBe(false);
  });

  it('FAIL: eval exit 1 with a fresh (regressed) result → snapshot RESTORED, evalGate:"fail"', async () => {
    evalBehavior = evalFailRegression(0.55);

    const stats = await runKbSyncNow();

    expect(stats.evalGate).toBe("fail");
    expect(stats.evalRecall).toBe(0.55);
    expect(stats.evalReason).toBe("recall_below_floor");
    expect(stats.rolledBack).toBe(true);
    expect(stats.ok).toBe(false); // did NOT promote a new KB this run

    // the pre-sync KB is verifiably live again — this is the actual rollback assertion.
    expect(read("embeddings.jsonl")).toBe("OLD_EMBEDDINGS");
    expect(read("chunks.jsonl")).toBe("OLD_CHUNK_LINE\n");
    expect(JSON.parse(read("embeddings-meta.json")!).generatedAt).toBe("2026-01-01T00:00:00.000Z");
    // semantic-graph.json did not exist pre-sync → the sync's copy must be deleted.
    expect(exists("semantic-graph.json")).toBe(false);
  });

  it('UNAVAILABLE: eval exit 1 with NO fresh result (harness crash) → NEW KB KEPT, evalGate:"skipped"', async () => {
    // A STALE results file left over from a PREVIOUS (unrelated) eval run — proves the gate
    // doesn't mistake old data lying around for a fresh verdict.
    seed("rag-eval-results.json", JSON.stringify({ overall: { recall: 0.4 }, timestamp: "2020-01-01T00:00:00.000Z" }));
    evalBehavior = evalHarnessCrash();

    const stats = await runKbSyncNow();

    expect(stats.evalGate).toBe("skipped");
    expect(stats.evalReason).toBe("eval_no_fresh_result");
    expect(stats.rolledBack).toBeFalsy();
    expect(stats.ok).toBe(true); // the good build is still kept — eval-unavailable ≠ regressed

    expect(read("embeddings.jsonl")).toBe("NEW_EMBEDDINGS");
    expect(exists("semantic-graph.json")).toBe(true);
  });

  it("sync FAIL: npm run kb:sync exits non-zero → no eval spawned, no corruption, snapshot cleaned", async () => {
    syncBehavior = (child) => child.emit("close", 1); // sync itself never touched the corpus

    const stats = await runKbSyncNow();

    expect(stats.ok).toBe(false);
    expect(stats.evalGate).toBeUndefined();
    expect(spawnCalls).toHaveLength(1); // eval never spawned
    expect(read("embeddings.jsonl")).toBe("OLD_EMBEDDINGS"); // untouched

    // the unused snapshot's temp dir must have been cleaned up.
    const backupDirs = [...fsExist].filter((p) => p.includes("kb-eval-gate-backup"));
    expect(backupDirs).toHaveLength(0);
  });

  it("gate flag OFF (KB_AUTOSYNC_EVAL_GATE=false): sync runs without the eval gate, as before B1", async () => {
    process.env.KB_AUTOSYNC_EVAL_GATE = "false";

    const stats = await runKbSyncNow();

    expect(stats.ok).toBe(true);
    expect(stats.evalGate).toBeUndefined();
    expect(spawnCalls).toHaveLength(1); // only npm run kb:sync — no eval spawned

    // no snapshot was ever taken (the flag being off skips it entirely).
    const backupDirs = [...fsExist].filter((p) => p.includes("kb-eval-gate-backup"));
    expect(backupDirs).toHaveLength(0);
    expect(read("embeddings.jsonl")).toBe("NEW_EMBEDDINGS"); // sync's write stands, ungated
  });

  it("fail-safe: a transient error on the first restore attempt does not corrupt the KB — the gate retries and the pre-sync KB ends up live", async () => {
    evalBehavior = evalFailRegression(0.4); // a genuine regression → triggers a restore
    restoreFailuresRemaining = 1; // the FIRST restore-direction copyFileSync call throws once

    const stats = await runKbSyncNow();

    expect(stats.evalGate).toBe("fail");
    expect(stats.evalReason).toBe("gate_exception"); // the exception path recorded this run
    expect(stats.rolledBack).toBe(true); // the retried restore succeeded
    expect(stats.ok).toBe(false);

    // the pre-sync KB is genuinely live again, despite the mid-gate exception.
    expect(read("embeddings.jsonl")).toBe("OLD_EMBEDDINGS");
    expect(read("chunks.jsonl")).toBe("OLD_CHUNK_LINE\n");
    expect(exists("semantic-graph.json")).toBe(false);

    // never hangs / never leaves the single-flight lock stuck.
    expect(getKbSyncSchedulerStatus().running).toBe(false);
  });

  it("fail-safe (worse case): the retry ALSO fails → the run still resolves and honestly reports rolledBack as falsy rather than claiming an unverified restore", async () => {
    evalBehavior = evalFailRegression(0.4);
    restoreFailuresRemaining = 999; // every restore-direction copy throws — the retry can't succeed either

    const stats = await runKbSyncNow();

    expect(stats.evalGate).toBe("fail");
    expect(stats.evalReason).toBe("gate_exception");
    expect(stats.ok).toBe(false);
    // must NOT claim a success it could not verify — this is the honesty half of fail-safe.
    expect(stats.rolledBack).toBeFalsy();

    // runKbSyncNow still resolved (never threw/hung) and released the single-flight lock.
    expect(getKbSyncSchedulerStatus().running).toBe(false);
  });
});
