/**
 * KB Auto-Sync Scheduler (doc 11 · W1.2) — keeps the AI knowledge base fresh.
 *
 * The RAG corpus (knowledge/chunks.jsonl + embeddings.jsonl) is built offline by
 * scripts/ai-kb/*. Without this, the corpus drifts as routers/pages/schema/docs
 * change (the audit found it 24 days stale, missing 71 routers). This scheduler
 * periodically runs the SAME incremental pipeline a developer would run by hand:
 *
 *     npm run kb:sync  ==  kb:extract → kb:cards → kb:chunk → kb:embed:inc → kb:graph
 *
 * Incremental embed re-uses unchanged vectors by content hash, so a nightly run
 * only embeds the delta (new/changed chunks) — cheap and brief. The model-switch
 * guard added to embed-incremental.mjs (W1.2) aborts if the corpus model would
 * mix, so auto-sync can never re-introduce the mixed-embedding-space corruption.
 *
 * Design: additive, FLAG-GATED (default OFF → safe no-op), fail-safe (a failed
 * run logs and never crashes boot), single-flight (overlapping ticks skip).
 * Mirrors aiThresholdTuneScheduler / aiAnomalyBankScheduler.
 *
 * doc 69 Giai đoạn 6 / Wave 5 (B1) — ANSWER-EVAL GATE. A rebuild can silently
 * REGRESS retrieval quality (bad chunking, a corpus/query embed-model mismatch,
 * a bug in the extractor). Without a gate, that bad corpus goes live unnoticed
 * the moment kb:sync exits 0 — exit 0 only proves the pipeline ran, not that
 * answers are still good. So when the gate is active, runKbSyncNow():
 *   1. SNAPSHOTS the current KB artifacts BEFORE spawning kb:sync.
 *   2. Runs kb:sync as today.
 *   3. On a successful sync, spawns `node scripts/ai-kb/eval-rag.mjs --ci`
 *      (argv array, no shell string) and reads its verdict.
 *   4. PASS  → keeps the new KB, discards the snapshot, evalGate:"pass".
 *      FAIL  → a genuine recall regression → RESTORES the snapshot (the
 *              pre-sync KB is live again), evalGate:"fail". A regressing
 *              rebuild must never stay live.
 *      SKIP  → the harness itself was unavailable (golden set missing, model
 *              load error, timeout) — NOT the same as "regressed". Keeps the
 *              new KB (an inconclusive eval must not roll back a good build),
 *              evalGate:"skipped".
 * Fail-safe: ANY unexpected error inside the gate's decision logic restores
 * the snapshot too — never leave a half-swapped KB up because the gate itself
 * crashed mid-decision.
 *
 * Env flags:
 *   KB_AUTOSYNC_ENABLED  (default "false" — master switch; safe no-op when off)
 *   KB_AUTOSYNC_CRON     (default "0 3 * * *" — 03:00 daily, off-peak for VRAM)
 *   KB_AUTOSYNC_TZ       (default "Asia/Ho_Chi_Minh")
 *   KB_AUTOSYNC_TIMEOUT_MS (default 1_800_000 — 30 min hard cap on a run)
 *   KB_AUTOSYNC_EVAL_GATE (default "true" — the eval gate runs whenever autosync
 *                          runs; set "false" to skip straight to promoting the
 *                          new KB, as before B1)
 *   KB_AUTOSYNC_EVAL_TIMEOUT_MS (default 600_000 — 10 min hard cap on the eval run)
 *
 * NOTE: a normal, manual `npm run kb:sync` (the package.json script) is NOT
 * wrapped by this gate — it only runs inside an autosync run via runKbSyncNow().
 */

import * as cron from "node-cron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ─── Config (env, safe defaults) ──────────────────────────────────────────────

const ENABLED = String(process.env.KB_AUTOSYNC_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.KB_AUTOSYNC_CRON || "0 3 * * *";
const TZ = process.env.KB_AUTOSYNC_TZ || "Asia/Ho_Chi_Minh";
const TIMEOUT_MS = Math.max(60_000, Number(process.env.KB_AUTOSYNC_TIMEOUT_MS ?? 30 * 60 * 1000));

// B1 — answer-eval gate config. Default ON (a rebuild WITHOUT the gate is the
// risky path) but flag-controllable so ops can disable it if the eval harness
// itself is broken/unavailable in an environment (e.g. no GPU for the embed
// model). Read PER-CALL (unlike ENABLED/CRON/TZ above, which are boot-time
// scheduler-registration config) — this is a per-run decision, mirrors
// localSidecarTrainer's isSidecarEnabled().
function isEvalGateEnabled(): boolean {
  return String(process.env.KB_AUTOSYNC_EVAL_GATE ?? "true").toLowerCase() === "true";
}
function evalTimeoutMs(): number {
  return Math.max(30_000, Number(process.env.KB_AUTOSYNC_EVAL_TIMEOUT_MS ?? 10 * 60 * 1000));
}

const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge");
const CHUNKS_FILE = path.join(KNOWLEDGE_DIR, "chunks.jsonl");
const EMBEDDINGS_FILE = path.join(KNOWLEDGE_DIR, "embeddings.jsonl");
const EMBEDDINGS_META_FILE = path.join(KNOWLEDGE_DIR, "embeddings-meta.json");
const EVAL_RESULTS_FILE = path.join(KNOWLEDGE_DIR, "rag-eval-results.json");
const EVAL_SCRIPT = path.join(process.cwd(), "scripts", "ai-kb", "eval-rag.mjs");

// B1 — the flat KB artifact files `npm run kb:sync` (extract → cards → chunk →
// embed:inc → graph) writes directly under knowledge/. This is what gets
// snapshotted before the sync and restored on a rollback. NOTE:
// build-operational-cards.mjs also (re)writes per-card knowledge/operational/*.md
// files, but only the operational-cards.json INDEX is read at runtime
// (aiOperationalGrounding.ts) — the .md files are human-readable byproducts, not
// part of the serving path, so they're intentionally out of the gate's scope.
const KB_ARTIFACT_FILES: string[] = [
  "routers-catalog.json",
  "services-catalog.json",
  "types-dictionary.json",
  "code-graph.json",
  "docs-catalog.json",
  "patterns.json",
  "routes-catalog.json",
  "nav-catalog.json",
  "schema-tables.json",
  "modules-catalog.json",
  "phase1-summary.json",
  "operational-cards.json",
  "operational-cards-stats.json",
  "chunks.jsonl",
  "chunks-stats.json",
  "embeddings.jsonl",
  "embeddings-meta.json",
  "semantic-graph.json",
].map((f) => path.join(KNOWLEDGE_DIR, f));

// ─── Run state ────────────────────────────────────────────────────────────────

export interface KbSyncRunStats {
  ok: boolean;
  exitCode: number | null;
  chunksBefore: number;
  chunksAfter: number;
  added: number;
  durationMs: number;
  skipped?: boolean; // already running
  reason?: string;
  // B1 (doc69 Wave5) — answer-eval gate outcome. Undefined when the gate did not
  // run at all (sync failed before eval, or KB_AUTOSYNC_EVAL_GATE=false).
  //   "pass"    — eval ran, recall met the floor → new KB kept.
  //   "fail"    — eval ran, recall regressed below the floor → ROLLED BACK.
  //   "skipped" — eval harness unavailable (golden set missing/crash/timeout),
  //               NOT the same as a regression → new KB kept anyway.
  evalGate?: "pass" | "fail" | "skipped";
  evalRecall?: number | null;
  evalReason?: string;
  // true when the pre-sync KB snapshot was restored (evalGate:"fail" or an
  // unexpected error inside the gate itself — the fail-safe path).
  rolledBack?: boolean;
}

// ─── B1 — answer-eval gate: snapshot / restore / eval-harness helpers ─────────

interface KbArtifactSnapshot {
  /** Temp dir holding a copy of every artifact that existed pre-sync. */
  backupDir: string;
  /** artifact absolute path → did it exist before the sync? (false ⇒ sync CREATED it). */
  existed: Map<string, boolean>;
}

/** Copy every existing KB artifact into a fresh temp dir. Never throws — a
 * failure here means the gate can't safely promise a rollback, so the caller
 * treats it as "no snapshot" and skips the gate for this run rather than risk
 * a broken restore later. */
function snapshotKbArtifacts(): KbArtifactSnapshot | null {
  try {
    const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-eval-gate-backup-"));
    const existed = new Map<string, boolean>();
    for (const file of KB_ARTIFACT_FILES) {
      const isPresent = fs.existsSync(file);
      existed.set(file, isPresent);
      if (isPresent) {
        fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
      }
    }
    return { backupDir, existed };
  } catch (err) {
    console.error("[kbSyncScheduler] snapshot failed — running this sync WITHOUT the eval gate:", (err as Error)?.message ?? err);
    return null;
  }
}

/** Restore every artifact from the snapshot: copy back what existed, delete
 * what the (now-rejected) sync created. May throw — callers MUST handle that
 * as the fail-safe case (never assume a restore silently succeeded). */
function restoreKbArtifacts(snapshot: KbArtifactSnapshot): void {
  for (const [file, wasPresent] of snapshot.existed) {
    const backupPath = path.join(snapshot.backupDir, path.basename(file));
    if (wasPresent) {
      fs.copyFileSync(backupPath, file);
    } else if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }
}

/** Best-effort cleanup of the temp snapshot dir. Never throws. */
function discardKbSnapshot(snapshot: KbArtifactSnapshot): void {
  try {
    fs.rmSync(snapshot.backupDir, { recursive: true, force: true });
  } catch {
    /* best-effort — a leftover temp dir is not worth crashing over */
  }
}

interface EvalRunResult {
  exitCode: number | null;
  timedOut: boolean;
  spawnError: boolean;
}

/** Spawn `node scripts/ai-kb/eval-rag.mjs --ci` as an argv array (NO shell
 * string) and wait for it to exit. Bounded by evalTimeoutMs(). Never throws —
 * every failure mode (spawn error, timeout) resolves to a result the caller
 * can read the meaning of. */
function runEvalHarness(): Promise<EvalRunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: EvalRunResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const timeoutMs = evalTimeoutMs();
    let child: ReturnType<typeof spawn> | null = null;
    const timer = setTimeout(() => {
      console.error(`[kbSyncScheduler] eval-gate exceeded ${timeoutMs}ms — killing`);
      try {
        child?.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      done({ exitCode: null, timedOut: true, spawnError: false });
    }, timeoutMs);

    try {
      child = spawn(process.execPath, [EVAL_SCRIPT, "--ci"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (d) => {
        const line = String(d).trim();
        if (line) console.log(`[kbSyncScheduler:eval] ${line}`);
      });
      child.stderr?.on("data", (d) => {
        const line = String(d).trim();
        if (line) console.warn(`[kbSyncScheduler:eval] ${line}`);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        console.error("[kbSyncScheduler] eval spawn error:", (err as Error)?.message ?? err);
        done({ exitCode: null, timedOut: false, spawnError: true });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        done({ exitCode: code, timedOut: false, spawnError: false });
      });
    } catch (err) {
      clearTimeout(timer);
      console.error("[kbSyncScheduler] eval run error:", (err as Error)?.message ?? err);
      done({ exitCode: null, timedOut: false, spawnError: true });
    }
  });
}

interface EvalVerdict {
  outcome: "pass" | "fail" | "skipped";
  recall: number | null;
  reason: string;
}

/**
 * Turn a raw eval-harness run into an honest PASS/FAIL/SKIPPED verdict.
 *
 * eval-rag.mjs --ci writes knowledge/rag-eval-results.json ONLY after it
 * finishes computing recall for every golden question, then exits 1 if the
 * CI gate fails (regression) — exits 1 the SAME WAY if it crashes before that
 * point (missing golden set, embed-model load error, etc). Both look like
 * "exit 1" from the outside, but only the first is an actual answer-quality
 * regression. We tell them apart by requiring a FRESH results file — one
 * written AT OR AFTER this eval run started — before trusting exit 1 as a
 * real regression. No fresh file ⇒ the harness never finished ⇒ "skipped"
 * (unavailable), NOT "fail" (regressed): an inconclusive eval must not roll
 * back a good build.
 */
function readEvalVerdict(evalStartedAt: number, run: EvalRunResult): EvalVerdict {
  if (run.timedOut) return { outcome: "skipped", recall: null, reason: "eval_timeout" };
  if (run.spawnError) return { outcome: "skipped", recall: null, reason: "eval_spawn_error" };

  let freshRecall: number | null = null;
  let hasFreshResult = false;
  try {
    if (fs.existsSync(EVAL_RESULTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(EVAL_RESULTS_FILE, "utf8")) as {
        overall?: { recall?: number };
        timestamp?: string;
      };
      const ts = raw?.timestamp ? Date.parse(raw.timestamp) : NaN;
      // small tolerance for clock skew between this process and the child's.
      if (Number.isFinite(ts) && ts >= evalStartedAt - 2000) {
        hasFreshResult = true;
        freshRecall = typeof raw.overall?.recall === "number" ? raw.overall.recall : null;
      }
    }
  } catch (err) {
    console.warn("[kbSyncScheduler] could not read eval results file:", (err as Error)?.message ?? err);
  }

  if (run.exitCode === 0 && hasFreshResult) {
    return { outcome: "pass", recall: freshRecall, reason: "recall_ok" };
  }
  if (run.exitCode === 0 && !hasFreshResult) {
    // Exited clean but no verifiable summary — treat as inconclusive rather
    // than assume pass on faith.
    return { outcome: "skipped", recall: null, reason: "eval_no_verifiable_result" };
  }
  if (hasFreshResult) {
    // Non-zero exit WITH a fresh summary = the harness completed and the CI
    // gate genuinely failed (recall/domain floor not met) — a real regression.
    return { outcome: "fail", recall: freshRecall, reason: "recall_below_floor" };
  }
  // Non-zero exit, no fresh summary = the harness crashed/errored before it
  // could finish (e.g. golden set missing) — unavailable, not a regression.
  return { outcome: "skipped", recall: null, reason: "eval_no_fresh_result" };
}

let job: cron.ScheduledTask | null = null;
let running = false;
let lastRunAt: Date | null = null;
let lastRunStats: KbSyncRunStats | null = null;

function countChunks(): number {
  try {
    if (!fs.existsSync(CHUNKS_FILE)) return 0;
    // Cheap line count without loading the whole file into structured memory.
    const raw = fs.readFileSync(CHUNKS_FILE, "utf8");
    let n = 0;
    for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) n++;
    // last line may have no trailing newline
    return raw.length > 0 && raw.charCodeAt(raw.length - 1) !== 10 ? n + 1 : n;
  } catch {
    return 0;
  }
}

/**
 * Run the incremental KB sync pipeline once. Fail-safe: never throws. Single-flight:
 * returns a skipped stat if a run is already in progress. Safe no-op when disabled.
 */
export async function runKbSyncNow(): Promise<KbSyncRunStats> {
  const start = Date.now();
  if (!ENABLED) {
    return { ok: true, exitCode: 0, chunksBefore: 0, chunksAfter: 0, added: 0, durationMs: 0, skipped: true, reason: "disabled" };
  }
  if (running) {
    return { ok: true, exitCode: null, chunksBefore: 0, chunksAfter: 0, added: 0, durationMs: 0, skipped: true, reason: "already_running" };
  }
  running = true;
  const chunksBefore = countChunks();

  // B1 — snapshot the KB artifacts BEFORE the sync so a regressing rebuild can
  // be rolled back. null when the gate is off, OR when the snapshot itself
  // failed (in which case we run this sync WITHOUT the gate rather than risk
  // a rollback we can't actually perform).
  const snapshot = isEvalGateEnabled() ? snapshotKbArtifacts() : null;

  const stats: KbSyncRunStats = await new Promise<KbSyncRunStats>((resolve) => {
    let settled = false;
    const done = (s: KbSyncRunStats) => {
      if (settled) return;
      settled = true;
      resolve(s);
    };

    let child: ReturnType<typeof spawn> | null = null;
    const timer = setTimeout(() => {
      console.error(`[kbSyncScheduler] run exceeded ${TIMEOUT_MS}ms — killing`);
      try { child?.kill("SIGKILL"); } catch { /* ignore */ }
      const after = countChunks();
      done({ ok: false, exitCode: null, chunksBefore, chunksAfter: after, added: after - chunksBefore, durationMs: Date.now() - start, reason: "timeout" });
    }, TIMEOUT_MS);

    try {
      // shell:true so `npm`/`npm.cmd` resolves on both Windows and POSIX.
      child = spawn("npm", ["run", "kb:sync"], {
        cwd: process.cwd(),
        shell: true,
        env: process.env, // inherits .env-resolved GGUF_* the server already loaded
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.stdout?.on("data", (d) => {
        const line = String(d).trim();
        if (line) console.log(`[kbSyncScheduler] ${line}`);
      });
      child.stderr?.on("data", (d) => {
        const line = String(d).trim();
        if (line) console.warn(`[kbSyncScheduler] ${line}`);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        console.error("[kbSyncScheduler] spawn error:", (err as Error)?.message ?? err);
        const after = countChunks();
        done({ ok: false, exitCode: null, chunksBefore, chunksAfter: after, added: after - chunksBefore, durationMs: Date.now() - start, reason: "spawn_error" });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        const after = countChunks();
        done({ ok: code === 0, exitCode: code, chunksBefore, chunksAfter: after, added: after - chunksBefore, durationMs: Date.now() - start });
      });
    } catch (err) {
      clearTimeout(timer);
      console.error("[kbSyncScheduler] run error:", (err as Error)?.message ?? err);
      done({ ok: false, exitCode: null, chunksBefore, chunksAfter: chunksBefore, added: 0, durationMs: Date.now() - start, reason: "exception" });
    }
  });

  // B1 — the answer-eval gate. Only runs when we HAVE a snapshot AND the sync
  // itself succeeded (a failed sync gets no eval, no rollback — same as before
  // B1; the pre-sync KB was never at risk because kb:sync never touched it
  // successfully).
  if (snapshot && stats.ok) {
    try {
      const evalStartedAt = Date.now();
      const run = await runEvalHarness();
      const verdict = readEvalVerdict(evalStartedAt, run);
      stats.evalGate = verdict.outcome;
      stats.evalRecall = verdict.recall;
      stats.evalReason = verdict.reason;

      if (verdict.outcome === "fail") {
        restoreKbArtifacts(snapshot); // may throw → caught below (fail-safe)
        stats.rolledBack = true;
        stats.ok = false; // the new KB did NOT get promoted this run
        console.error(
          `[kbSyncScheduler] eval-gate FAIL (${verdict.reason}, recall=${verdict.recall ?? "n/a"}) — rolled back to the pre-sync KB`,
        );
      } else if (verdict.outcome === "pass") {
        console.log(`[kbSyncScheduler] eval-gate PASS (recall=${verdict.recall ?? "n/a"}) — new KB kept`);
      } else {
        console.warn(
          `[kbSyncScheduler] eval-gate SKIPPED (${verdict.reason}) — keeping the new KB (eval-unavailable ≠ regressed)`,
        );
      }
    } catch (err) {
      // Fail-safe: an unexpected error ANYWHERE in the gate's own decision
      // logic (including a failed restore above) must not leave a half-swapped
      // KB live. Best-effort restore again; if even that fails, say so loudly
      // but never throw out of runKbSyncNow.
      console.error("[kbSyncScheduler] eval-gate threw — attempting fail-safe restore:", (err as Error)?.message ?? err);
      try {
        restoreKbArtifacts(snapshot);
        stats.rolledBack = true;
      } catch (restoreErr) {
        console.error(
          "[kbSyncScheduler] CRITICAL — fail-safe restore ALSO failed; the KB may be inconsistent:",
          (restoreErr as Error)?.message ?? restoreErr,
        );
      }
      stats.evalGate = "fail";
      stats.evalReason = "gate_exception";
      stats.ok = false;
    } finally {
      discardKbSnapshot(snapshot);
    }
  } else if (snapshot) {
    // Sync failed (or was killed/timed out) before the gate could matter —
    // nothing to evaluate, nothing to roll back. Clean up the unused snapshot.
    discardKbSnapshot(snapshot);
  }

  running = false;
  lastRunAt = new Date();
  lastRunStats = stats;
  console.log(
    `[kbSyncScheduler] done in ${stats.durationMs}ms — ok=${stats.ok} exit=${stats.exitCode} ` +
      `chunks ${stats.chunksBefore}→${stats.chunksAfter} (Δ${stats.added})` +
      (stats.evalGate ? ` evalGate=${stats.evalGate}` : ""),
  );
  return stats;
}

/** B1 — the last autosync run's answer-eval gate outcome, for the KB health
 * signal. null when no autosync run has recorded a gate outcome yet (gate off,
 * or no run since boot). */
export function getLastAutosyncEvalGate(): {
  evalGate: "pass" | "fail" | "skipped";
  recall: number | null;
  reason?: string;
  rolledBack: boolean;
  at: string;
} | null {
  if (!lastRunStats?.evalGate) return null;
  return {
    evalGate: lastRunStats.evalGate,
    recall: lastRunStats.evalRecall ?? null,
    reason: lastRunStats.evalReason,
    rolledBack: lastRunStats.rolledBack === true,
    at: (lastRunAt ?? new Date()).toISOString(),
  };
}

// ─── Scheduler lifecycle (mirror the other schedulers) ────────────────────────

/** Register the cron job. No-op when KB_AUTOSYNC_ENABLED is not "true". */
export function startKbSyncScheduler(): void {
  if (!ENABLED) {
    console.log("[kbSyncScheduler] disabled (set KB_AUTOSYNC_ENABLED=true to enable)");
    return;
  }
  if (job) return; // already started
  job = cron.schedule(
    CRON,
    () => {
      runKbSyncNow().catch((e) => console.error("[kbSyncScheduler] cron error:", e));
    },
    { timezone: TZ },
  );
  console.log(`[kbSyncScheduler] scheduled '${CRON}' (${TZ})`);
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopKbSyncScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    console.log("[kbSyncScheduler] stopped");
  }
}

/** Status for dashboards / health. */
export function getKbSyncSchedulerStatus() {
  return {
    enabled: ENABLED,
    cron: CRON,
    timezone: TZ,
    timeoutMs: TIMEOUT_MS,
    evalGateEnabled: isEvalGateEnabled(), // B1
    evalTimeoutMs: evalTimeoutMs(), // B1
    running,
    lastRunAt,
    lastRunStats,
  };
}
