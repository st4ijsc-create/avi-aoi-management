/**
 * KB Auto-Sync Scheduler (doc 11 · W1.2) — keeps the AI knowledge base fresh.
 *
 * The RAG corpus (knowledge/chunks.jsonl + embeddings.jsonl) is built offline by
 * scripts/ai-kb/*. Without this, the corpus drifts as routers/pages/schema/docs
 * change (the audit found it 24 days stale, missing 71 routers). This scheduler
 * periodically runs the SAME incremental pipeline a developer would run by hand:
 *
 *     npm run kb:sync  ==  kb:extract → kb:chunk → kb:embed:inc → kb:graph
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
 * Env flags:
 *   KB_AUTOSYNC_ENABLED  (default "false" — master switch; safe no-op when off)
 *   KB_AUTOSYNC_CRON     (default "0 3 * * *" — 03:00 daily, off-peak for VRAM)
 *   KB_AUTOSYNC_TZ       (default "Asia/Ho_Chi_Minh")
 *   KB_AUTOSYNC_TIMEOUT_MS (default 1_800_000 — 30 min hard cap on a run)
 */

import * as cron from "node-cron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ─── Config (env, safe defaults) ──────────────────────────────────────────────

const ENABLED = String(process.env.KB_AUTOSYNC_ENABLED ?? "false").toLowerCase() === "true";
const CRON = process.env.KB_AUTOSYNC_CRON || "0 3 * * *";
const TZ = process.env.KB_AUTOSYNC_TZ || "Asia/Ho_Chi_Minh";
const TIMEOUT_MS = Math.max(60_000, Number(process.env.KB_AUTOSYNC_TIMEOUT_MS ?? 30 * 60 * 1000));

const CHUNKS_FILE = path.join(process.cwd(), "knowledge", "chunks.jsonl");

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

  running = false;
  lastRunAt = new Date();
  lastRunStats = stats;
  console.log(
    `[kbSyncScheduler] done in ${stats.durationMs}ms — ok=${stats.ok} exit=${stats.exitCode} ` +
      `chunks ${stats.chunksBefore}→${stats.chunksAfter} (Δ${stats.added})`,
  );
  return stats;
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
    running,
    lastRunAt,
    lastRunStats,
  };
}
