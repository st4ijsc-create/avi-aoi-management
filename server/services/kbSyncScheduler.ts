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
 * Fail-safe: ANY unexpected error inside the gate's decision logic triggers a
 * best-effort restore of the snapshot too. That restore (restoreKbArtifacts)
 * is a plain sequential copyFileSync/unlinkSync loop over the artifact list —
 * it is NOT atomic across files. A hard kill mid-restore, or a second failure
 * during this fail-safe retry, can leave a MIXED old/new corpus on disk. When
 * both restore attempts fail we do not pretend otherwise: the run records
 * rollbackFailed on the KB health signal (lastAutosyncEvalGate) so ops/UI can
 * see the corpus may be inconsistent. That mixed state SELF-HEALS on the next
 * successful autosync, which overwrites every artifact again regardless of
 * what state it found them in.
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
// ★★★ Pha 2B Task 5 — vị từ "lỗi này có phải LỜI TỪ CHỐI không". Import TĨNH của một module
// LÁ (không import gì, không I/O): nó phải dùng được NGAY TRONG `catch` của một lượt
// `await import()` vừa hỏng. Xem `vramRefusalSignal.ts` để biết vì sao so TÊN, không `instanceof`.
import { isVramRefusal } from "./vram/vramRefusalSignal";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Pha 1 Task 6 (điều phối VRAM) — `import type` bị xoá hoàn toàn lúc biên dịch; module telemetry
// chỉ được nạp bằng `import()` động tại đúng điểm xin phép, không nằm trên đường nạp file này.
import type { VramTicket } from "./vram/vramWiring";

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
  // true when a rollback was NEEDED (evalGate:"fail", or the gate's own
  // fail-safe path) but BOTH the primary restore attempt and the fail-safe
  // retry threw — rolledBack stays false/unset and the corpus may be left in
  // a mixed old/new state on disk (restoreKbArtifacts is a best-effort,
  // non-atomic per-file loop). SELF-HEALS on the next successful autosync.
  // Surfaced on the KB health signal (getLastAutosyncEvalGate) so ops/UI can
  // see the corpus may be inconsistent in the meantime.
  rollbackFailed?: boolean;
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
  // Hoisted out of the try so the catch can clean it up even when mkdtempSync
  // itself succeeded but a later copyFileSync in the loop throws — otherwise
  // the already-created temp dir is orphaned in os.tmpdir() forever.
  let backupDir: string | undefined;
  try {
    backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-eval-gate-backup-"));
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
    if (backupDir) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {
        /* best-effort — a leftover temp dir here is not worth crashing over */
      }
    }
    return null;
  }
}

/** Restore every artifact from the snapshot: copy back what existed, delete
 * what the (now-rejected) sync created. Best-effort, NOT atomic — a plain
 * sequential per-file loop, so a crash partway through (or a second failure
 * on the fail-safe retry) can leave a mixed old/new corpus on disk rather
 * than a clean all-old-or-all-new swap. May throw — callers MUST handle that
 * as the fail-safe case (never assume a restore silently succeeded); the
 * caller is also responsible for recording rollbackFailed when even the
 * retry can't restore cleanly, so the KB health signal stays honest. */
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

/**
 * ★ C-1 (review TOÀN NHÁNH) — GIẤY PHÉP VRAM CHO CỔNG EVAL.
 *
 * Task 6 nối `runKbSyncNow()` → `spawnKbSyncWithVram()` nhưng bỏ sót tiến trình con **THỨ HAI
 * của chính file này**, nằm cách đó 143 dòng bên trên: `runEvalHarness()` spawn
 * `node scripts/ai-kb/eval-rag.mjs --ci`. Script đó gọi `getLlama({ gpu: "auto" })` rồi
 * `loadModel(...)` — trực tiếp ở `eval-rag.mjs:211/221` cho đường rerank, và qua
 * `scripts/ai-kb/_gguf-embed.mjs:73-75` cho đường nhúng câu hỏi mà `--ci` LUÔN đi qua ⇒ backend
 * CUDA (~430 MiB, báo cáo §5) + embedding context trong một tiến trình Node THỨ HAI.
 *
 * ⚠ KHÔNG PHẢI GIẢ THUYẾT: `.env:748` `KB_AUTOSYNC_ENABLED=true`, `.env:749`
 * `KB_AUTOSYNC_EVAL_GATE=true` (mặc định trong mã cũng `"true"`, `isEvalGateEnabled()` bên trên).
 * Không nối thì **03:00 mỗi đêm** `reconcileOnce()` báo *"cấp phát KHÔNG XIN PHÉP"* cho chính
 * tiến trình con mà app tự spawn — báo động giả, đêm nào cũng có, và người trực không có cách
 * nào biết nó là của ai.
 *
 * ⚠ `1251` (MiB): CÙNG hằng số với `cron:kb-sync`, và đó là lựa chọn CÓ NGUỒN chứ không phải
 * tiện tay. `eval-rag.mjs --ci` nhúng câu hỏi qua ĐÚNG module `scripts/ai-kb/_gguf-embed.mjs` mà
 * `kb:embed:inc` dùng — cùng `getLlama`, cùng `loadModel`, cùng `createEmbeddingContext`, cùng
 * biến môi trường — nên số đo được ở Đợt 2 cho tiến trình con kb:sync là số gần nhất ta CÓ. Đi
 * qua `configDefaultBytes` để sự kiện ghi `estimateSource: "config-default"` (dấu vết cho Task 7).
 *
 * ⚠ `ttlMs` = `evalTimeoutMs()` — trần thời lượng gate: quá mốc này tiến trình bị `SIGKILL`
 * (xem `timer` bên dưới), nên giấy phép không bao giờ sống lâu hơn khoảng tiến trình con được
 * PHÉP sống.
 */
async function beginEvalGateVram(): Promise<VramTicket> {
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    return await beginVramAllocation({
      owner: "cron:kb-eval-gate",
      kind: "external-process",
      priority: "background",
      configDefaultBytes: Number(process.env.VRAM_KB_EVAL_ESTIMATE_MB ?? 1251) * 1024 * 1024,
      ttlMs: evalTimeoutMs(),
      releaseProof: "process-exit",
    });
  } catch (err) {
    // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG: nuốt ở đây là TẮT cưỡng chế tại điểm gọi này.
    // ⚠ Việc NỀN bị từ chối thì phải HOÃN rồi thử lại (§5.4) — đó là Task 6. Task 5 chỉ bảo đảm
    // lời từ chối tới được người gọi thay vì biến mất ở đây.
    if (isVramRefusal(err)) throw err;
    return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
  }
}

/**
 * Spawn tiến trình eval với giấy phép đã xin TRƯỚC (tham số `ticket`) và gắn sẵn dây trả chỗ.
 *
 * ⚠ BA nhánh thoát, thiếu MỘT là giấy phép treo vĩnh viễn (Task 5 mất ba vòng sửa vì đúng họ
 * lỗi này, Task 6 vòng 1 tìm ra nhánh thứ ba):
 *   1. `"exit"`  — tiến trình đã chết, dù xong việc hay bị SIGKILL vì quá hạn.
 *   2. `"error"` — spawn thất bại (ENOENT/EACCES); `"exit"` có thể KHÔNG BAO GIỜ tới.
 *   3. `spawn()` NÉM ĐỒNG BỘ — người gọi bắt và tự trả (xem `catch` trong `runEvalHarness`).
 * `ticket.release()` idempotent nên gọi từ nhiều nhánh là vô hại.
 *
 * ⚠ Nhả ở `"exit"` chứ KHÔNG phải lúc quyết định kill: kỷ luật thứ tự nhả DUY NHẤT nằm ở đầu
 * `vram/vramWiring.ts` — sổ chỉ nhả SAU khi thiết bị đã nhả (I-1).
 */
function spawnEvalGateWithVram(ticket: VramTicket): ReturnType<typeof spawn> {
  const child = spawn(process.execPath, [EVAL_SCRIPT, "--ci"], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const releaseVram = () => {
    try {
      ticket.release();
    } catch {
      /* telemetry KHÔNG được làm hỏng vòng đời tiến trình con */
    }
  };
  child.on("exit", releaseVram);
  child.on("error", releaseVram);
  return child;
}

/**
 * Spawn `node scripts/ai-kb/eval-rag.mjs --ci` as an argv array (NO shell string) and wait for it
 * to exit. Bounded by evalTimeoutMs(). Mọi kết cục của TIẾN TRÌNH CON (spawn error, hết giờ, exit
 * khác 0) đều **giải thành một kết quả** để người gọi đọc được nghĩa — hàm không ném vì chúng.
 *
 * ⚠⚠ N-1 (re-review) — NHƯNG NÓ **NÉM CÓ CHỦ Ý** ĐÚNG MỘT ĐƯỜNG: `beginEvalGateVram()` ngay dòng
 * đầu ném `VramRefusedError` khi cổng sổ từ chối (Pha 2B Task 5). Câu *"Never throws"* của bản
 * trước nay **SAI**, và nó sai đúng lớp hợp-đồng-lệch mà C-1 vừa bắt — chỉ ngược chiều: C-1 là mã
 * ném trong khi tài liệu hứa không ném **và người gọi tin lời hứa**; ở đây chính bản vá I-6 **DỰA
 * VÀO** lượt ném đó để phân biệt "từ chối" với "cổng eval hỏng". Ai xoá lượt ném này (hoặc bọc nó
 * lại thành một kết quả) sẽ làm nhánh I-6 chết âm thầm và một lời từ chối lại đi lùi cả một lượt
 * sync ĐÃ THÀNH CÔNG.
 */
async function runEvalHarness(): Promise<EvalRunResult> {
  // C-1 — xin giấy phép NGAY TRƯỚC khi spawn (spec §3.1). TRƯỚC khi vào Promise theo dõi vì
  // `beginEvalGateVram()` là async còn executor bên dưới cố tình giữ ĐỒNG BỘ (cùng khuôn
  // `runKbSyncNow`).
  const vramTicket = await beginEvalGateVram();

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
      // ⚠ KHÔNG trả giấy phép ở đây: SIGKILL mới là YÊU CẦU chết, chưa phải cái chết. Nhánh
      // `"exit"` (gắn trong `spawnEvalGateWithVram`) trả chỗ khi tiến trình THẬT SỰ chết — kỷ
      // luật I-1, giống hệt `llamaVisionSidecar.stopSidecar()`.
      done({ exitCode: null, timedOut: true, spawnError: false });
    }, timeoutMs);

    try {
      // `spawnEvalGateWithVram` đã nối "exit"/"error" → `vramTicket.release()`; các listener
      // dưới đây là THÊM (Node cho nhiều listener mỗi sự kiện) và chỉ lo kết quả eval.
      child = spawnEvalGateWithVram(vramTicket);
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
      // Nhánh thoát thứ BA — `spawn()` ném ĐỒNG BỘ: không listener nào kịp gắn, KHÔNG CÒN chỗ
      // nào khác trả được giấy phép này. Bài học Task 6 vòng 1.
      try {
        vramTicket.release();
      } catch {
        /* telemetry KHÔNG được làm hỏng đường lỗi */
      }
      console.error("[kbSyncScheduler] eval run error:", (err as Error)?.message ?? err);
      done({ exitCode: null, timedOut: false, spawnError: true });
    }
  });
}

/**
 * Chỉ dùng trong test (`vram/wiring.outofprocess.test.ts`). Gọi ĐÚNG hai bước THẬT (xin phép rồi
 * spawn — cùng hai hàm mà `runEvalHarness()` dùng, không nhảy qua cổng nào) mà KHÔNG chờ tiến
 * trình con thoát / không đọc phán quyết eval. Cùng khuôn `__runKbSyncForTests`.
 */
export async function __runEvalGateForTests(): Promise<void> {
  const ticket = await beginEvalGateVram();
  try {
    spawnEvalGateWithVram(ticket);
  } catch {
    // Nhánh thoát thứ BA, y như `runEvalHarness` — test 11 canh đúng nhánh này.
    ticket.release();
  }
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

// ─── Pha 1 Task 6 — điều phối VRAM cho tiến trình con `npm run kb:sync` ───────────────────────
//
// ⚠ CỐT LÕI (spec §3.1): ta KHÔNG sửa `npm`/`node` — ta sửa THỨ KHỞI ĐỘNG chúng. Người GIÁM SÁT
// (module này) xin giấy phép VRAM THAY CHO tiến trình con, NGAY TRƯỚC khi spawn, và trả khi tiến
// trình con thoát (dù xong việc, bị kill, hay spawn lỗi) — CHỈ KHAI BÁO, không đổi hành vi sync.

/**
 * Mở MỘT giấy phép VRAM cho lượt `npm run kb:sync` sắp spawn. KHÔNG BAO GIỜ ném (cùng kỷ luật
 * `vramWiring.ts` — module đó đã gom "telemetry không bao giờ ném" về MỘT chỗ; hàm này chỉ GỌI
 * nó, không phát minh một khuôn thứ hai).
 *
 * ⚠ `1251` (MiB) là hằng số ĐO ĐƯỢC ở Đợt 2 cho riêng lượt `kb:embed:inc` (bước duy nhất trong
 * pipeline có thể chạm GPU) — dùng cho LƯỢT ĐẦU TIÊN thôi, truyền qua `configDefaultBytes` (không
 * hard-code vào estimatedBytes) để sự kiện ghi `estimateSource: "config-default"` — dấu vết để
 * Task 7 truy "chỗ nào còn dựa hằng số". ⚠ KHÔNG commit số thật cho cron (khác sidecar): khi tiến
 * trình con thoát, lượt embed GPU bên trong nó đã tự giải phóng VRAM từ lâu — đo delta lúc đó chỉ
 * cho ra 0 giả, còn tệ hơn không đo. `estimateSource` vì vậy CỐ Ý giữ nguyên "config-default" mãi
 * mãi cho hộ này ở Pha 1 — một giới hạn đã biết, không phải một khiếm khuyết bị bỏ sót.
 *
 * ⚠ `ttlMs` = TIMEOUT_MS — trần thời lượng job thật (kb:sync bị `SIGKILL` cưỡng bức sau mốc này,
 * xem `timer` bên dưới), nên giấy phép không bao giờ sống lâu hơn tiến trình được PHÉP sống.
 *
 * ⚠ Pha 1 CHƯA có cơ chế hoãn (spec §5.4: cron bị từ chối thì lùi dần 15→60 phút, đáy 6 giờ, quá
 * đáy thì kêu). `reserve()` ở Pha 1 KHÔNG BAO GIỜ từ chối (vramBroker.ts) nên CHƯA có gì để hoãn —
 * đây là đúng chỗ Pha 2 sẽ đọc `wouldRefuse` và cài lịch lùi thật khi nó tới.
 */
async function beginKbSyncVram(): Promise<VramTicket> {
  try {
    const { beginVramAllocation } = await import("./vram/vramWiring");
    return await beginVramAllocation({
      owner: "cron:kb-sync",
      kind: "external-process",
      priority: "background",
      configDefaultBytes: Number(process.env.VRAM_KB_SYNC_ESTIMATE_MB ?? 1251) * 1024 * 1024,
      ttlMs: TIMEOUT_MS,
    });
  } catch (err) {
    // ★★★ Pha 2B Task 5 — TỪ CHỐI ≠ TELEMETRY HỎNG (xem `beginEvalGateVram`). Hoãn-không-chặn
    // (§5.4) là Task 6; ở đây chỉ bảo đảm lời từ chối KHÔNG biến mất.
    if (isVramRefusal(err)) throw err;
    return { commitMeasured: async () => {}, release: () => {}, noteRefCount: () => {} };
  }
}

/**
 * Spawn `npm run kb:sync` với giấy phép VRAM đã xin TRƯỚC (tham số `ticket`). Trả tiến trình con
 * NGAY — người gọi (`runKbSyncNow`) tự đăng ký thêm listener stdout/stderr/close để tính
 * `KbSyncRunStats`; hàm này chỉ lo vòng đời giấy phép.
 *
 * ⚠ `release()` PHẢI chạy ở CẢ HAI nhánh thoát — "exit" (tiến trình đã chết, dù xong việc hay bị
 * kill) VÀ "error" (spawn thất bại, ENOENT/EACCES — "exit" có thể KHÔNG BAO GIỜ tới trong ca này).
 * Thiếu MỘT nhánh là giấy phép TREO vĩnh viễn — Task 5 vừa mất ba vòng sửa vì đúng họ lỗi này.
 * `ticket.release()` idempotent (vramWiring.ts) nên gọi từ nhiều nhánh là vô hại.
 */
function spawnKbSyncWithVram(ticket: VramTicket): ReturnType<typeof spawn> {
  const child = spawn("npm", ["run", "kb:sync"], {
    cwd: process.cwd(),
    shell: true,
    env: process.env, // inherits .env-resolved GGUF_* the server already loaded
    stdio: ["ignore", "pipe", "pipe"],
  });
  const releaseVram = () => {
    try {
      ticket.release();
    } catch {
      /* telemetry KHÔNG được làm hỏng vòng đời tiến trình con */
    }
  };
  child.on("exit", releaseVram);
  child.on("error", releaseVram);
  return child;
}

/**
 * Chỉ dùng trong test (Task 6, `vram/wiring.outofprocess.test.ts`). Gọi ĐÚNG hai bước THẬT (xin
 * phép rồi spawn — cùng hai hàm mà `runKbSyncNow()` dùng, không nhảy qua cổng nào) mà KHÔNG chờ
 * tiến trình con thoát / không tính `KbSyncRunStats` — phần đơn-luồng + hạn giờ + eval-gate +
 * snapshot đã có bộ test riêng (`kbSyncScheduler.evalGate.test.ts`) và không phải phạm vi của
 * việc canh dây nối VRAM. Bỏ qua cờ `KB_AUTOSYNC_ENABLED`/khoá đơn-luồng có chủ đích — test này
 * canh giấy phép XIN ĐÚNG LÚC NÀO, không canh vòng đời sync đầy đủ.
 */
export async function __runKbSyncForTests(): Promise<void> {
  const ticket = await beginKbSyncVram();
  spawnKbSyncWithVram(ticket);
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
  /**
   * ★★★ Pha 2B Task 5, review vòng 1 (C-1) — `running` PHẢI ĐƯỢC TRẢ TRONG `finally`.
   *
   * LỖI ĐANG VÁ, và nó CHẾT VĨNH VIỄN chứ không phải hỏng một lượt: `beginKbSyncVram()` ngay dưới
   * đây **nay NÉM** (`VramRefusedError`, từ Task 5) và nó nằm NGOÀI mọi `try`; dòng
   * `running = false` cũ thì nằm ở CUỐI thân hàm, không có lưới nào. ⇒ Một lời từ chối bình thường
   * — thứ pha này sinh ra để tạo — sẽ chốt cờ ở `true` **tới lúc khởi động lại tiến trình**: mọi
   * lượt sau trả `skipped: "already_running"` trong khi **không có lượt nào đang chạy**, và ảnh
   * chụp KB rò lại trên đĩa.
   *
   * ⚠ Đây KHÔNG phải cơ chế hoãn-không-chặn (§5.4, Task 6). Đây là "không để một hệ con chết vì
   * một lời từ chối bình thường" — hai việc khác nhau, và việc này không được chờ Task 6.
   */
  try {
    const chunksBefore = countChunks();

    // B1 — snapshot the KB artifacts BEFORE the sync so a regressing rebuild can
    // be rolled back. null when the gate is off, OR when the snapshot itself
    // failed (in which case we run this sync WITHOUT the gate rather than risk
    // a rollback we can't actually perform).
    const snapshot = isEvalGateEnabled() ? snapshotKbArtifacts() : null;

    // Pha 1 Task 6 — xin giấy phép VRAM NGAY TRƯỚC khi spawn (spec §3.1). TRƯỚC khi vào Promise
    // theo dõi vì `beginKbSyncVram()` là async còn executor bên dưới cố tình giữ ĐỒNG BỘ.
    /**
   * ★★★ C-1 (review vòng 1) — LỜI TỪ CHỐI PHẢI THÀNH MỘT KẾT QUẢ, KHÔNG PHẢI MỘT NGOẠI LỆ.
   *
   * `runKbSyncNow()` khai ngay trong docstring: *"Fail-safe: never throws"*, và người gọi là CRON
   * (`node-cron` nuốt lỗi im lặng) lẫn router. Từ Task 5, `beginKbSyncVram()` ném `VramRefusedError`
   * — một kết cục HỢP LỆ và THƯỜNG GẶP của mức `background` (§5.2: nền nhường trước tiên), không
   * phải một sự cố. Để nó bay ra ngoài là vỡ hợp đồng và **bỏ lại ảnh chụp KB trên đĩa**.
   *
   * ⚠ `skipped: true` + `reason: "vram_refused"` là VẾT mà Task 6 sẽ đọc để lùi dần 15→60 phút và
   * kêu khi quá đáy (§5.4). Ở đây CHƯA hoãn gì cả — chỉ bảo đảm lượt này **để lại dấu** thay vì
   * biến mất, và hệ con còn gọi được lần sau.
   */
  let kbSyncVramTicket: VramTicket;
  try {
    kbSyncVramTicket = await beginKbSyncVram();
  } catch (err) {
    if (!isVramRefusal(err)) throw err;
    // ⚠ `snapshot` là `null` khi cổng eval tắt — chỉ dọn khi THẬT SỰ có ảnh chụp, nếu không lượt
    // dọn này lại là một cú ném mới trên đúng đường vừa vá.
    if (snapshot) discardKbSnapshot(snapshot);
    console.warn(
      `[kbSyncScheduler] kb:sync BỊ TỪ CHỐI VRAM ⇒ BỎ QUA lượt này (chưa có cơ chế hoãn — §5.4 là ` +
        `Task 6). Ảnh chụp KB đã dọn, cờ running đã trả: ${(err as Error)?.message ?? String(err)}`,
    );
    /**
     * ★★ N-2 (re-review) — VẾT PHẢI ĐỌC ĐƯỢC BẰNG MÃ, KHÔNG CHỈ BẰNG MẮT TRÊN CONSOLE.
     *
     * Người gọi sản xuất DUY NHẤT là cron (`startKbSyncScheduler`) và nó **vứt giá trị trả về**.
     * Một nhánh return sớm không cập nhật `lastRunAt`/`lastRunStats` là một lượt **vô hình với mọi
     * câu truy vấn** (`getKbSyncSchedulerStatus()` — thứ Task 6 và mặt sức khoẻ KB sẽ đọc). Báo cáo
     * vòng trước của tôi hứa *"có vết cho Task 6"* trong khi vết đó mới chỉ là một dòng console —
     * đúng lớp "hứa nhiều hơn cơ chế".
     */
    const stats: KbSyncRunStats = {
      ok: false, exitCode: null, chunksBefore, chunksAfter: chunksBefore, added: 0,
      durationMs: Date.now() - start, skipped: true, reason: "vram_refused",
    };
    lastRunAt = new Date();
    lastRunStats = stats;
    return stats;
  }

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
        // shell:true so `npm`/`npm.cmd` resolves on both Windows and POSIX. `spawnKbSyncWithVram`
        // already wires "exit"/"error" → `kbSyncVramTicket.release()` (Task 6) — the listeners
        // below are ADDITIONAL (Node supports many listeners per event) and only compute stats.
        child = spawnKbSyncWithVram(kbSyncVramTicket);
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
        // `spawnKbSyncWithVram` threw BEFORE it could attach its own "exit"/"error" listeners
        // (e.g. `spawn()` itself threw synchronously) — no event will ever fire to release the
        // ticket, so release it here directly. Idempotent; harmless if it also already fired.
        try { kbSyncVramTicket.release(); } catch { /* telemetry KHÔNG được làm hỏng lượt sync */ }
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
        /**
         * ★★★ I-6 (review vòng 1) — LỜI TỪ CHỐI **KHÔNG** ĐƯỢC ĐI VÀO NHÁNH FAIL-SAFE BÊN DƯỚI.
       *
       * Nhánh đó gọi `restoreKbArtifacts()` — tức **LÙI LẠI MỘT LƯỢT SYNC ĐÃ THÀNH CÔNG** — vì nó
       * giả định "lỗi trong logic quyết định của cổng ⇒ KB có thể đang nửa vời". Nhưng một lượt xin
       * VRAM bị từ chối thì **KB chưa hề bị đụng tới**: tiến trình eval còn chưa được sinh ra.
       *
       * ⇒ Đúng ngữ nghĩa là `"skipped"`, và file này ĐÃ CÓ SẴN nguyên tắc ấy bằng chữ ở nhánh trên:
       * *"eval-unavailable ≠ regressed"* ⇒ **GIỮ KB MỚI**, không lùi, không hạ `stats.ok`.
       */
      if (isVramRefusal(err)) {
        stats.evalGate = "skipped";
        stats.evalReason = "vram_refused";
        console.warn(
          `[kbSyncScheduler] eval-gate BỊ TỪ CHỐI VRAM — GIỮ KB MỚI (eval không chạy được ≠ KB tụt ` +
            `chất lượng, và KB chưa hề bị đụng tới): ${(err as Error)?.message ?? String(err)}`,
        );
      } else {
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
          // Both restore attempts failed — record the honest, durable signal so
          // the KB health surface can flag the corpus as possibly mixed until
          // the next successful autosync self-heals it.
          stats.rollbackFailed = true;
        }
        stats.evalGate = "fail";
        stats.evalReason = "gate_exception";
        stats.ok = false;
      }
    } finally {
      discardKbSnapshot(snapshot);
      }
    } else if (snapshot) {
      // Sync failed (or was killed/timed out) before the gate could matter —
      // nothing to evaluate, nothing to roll back. Clean up the unused snapshot.
      discardKbSnapshot(snapshot);
    }

    lastRunAt = new Date();
    lastRunStats = stats;
    console.log(
      `[kbSyncScheduler] done in ${stats.durationMs}ms — ok=${stats.ok} exit=${stats.exitCode} ` +
        `chunks ${stats.chunksBefore}→${stats.chunksAfter} (Δ${stats.added})` +
        (stats.evalGate ? ` evalGate=${stats.evalGate}` : "") +
        (stats.rollbackFailed ? " rollbackFailed=true (KB may be inconsistent until next autosync)" : ""),
    );
    return stats;
  } finally {
    // ⚠ TRẢ CỜ Ở ĐÂY, KHÔNG Ở CUỐI THÂN HÀM: mọi đường thoát (trả về bình thường · `await` NÉM ·
    // lời từ chối VRAM) đều đi qua đây. Đây là thứ DUY NHẤT bảo đảm hàm còn gọi được lần sau.
    running = false;
  }
}

/** B1 — the last autosync run's answer-eval gate outcome, for the KB health
 * signal. null when no autosync run has recorded a gate outcome yet (gate off,
 * or no run since boot). rollbackFailed (fix, doc69-B1 review) is true only
 * when a rollback was needed AND both restore attempts failed — the corpus
 * may be mixed old/new until the next successful autosync self-heals it. */
export function getLastAutosyncEvalGate(): {
  evalGate: "pass" | "fail" | "skipped";
  recall: number | null;
  reason?: string;
  rolledBack: boolean;
  rollbackFailed: boolean;
  at: string;
} | null {
  if (!lastRunStats?.evalGate) return null;
  return {
    evalGate: lastRunStats.evalGate,
    recall: lastRunStats.evalRecall ?? null,
    reason: lastRunStats.evalReason,
    rolledBack: lastRunStats.rolledBack === true,
    rollbackFailed: lastRunStats.rollbackFailed === true,
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
