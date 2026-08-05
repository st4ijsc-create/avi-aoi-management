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
 *   KB_SYNC_MAX_DEFER_HOURS (default 6 — Pha 2B Task 6 / spec §5.4: ĐÁY của việc hoãn khi cổng
 *                          sổ VRAM từ chối. Hết ngân sách thì hệ KHÔNG âm thầm bỏ: nó ghi sự kiện
 *                          `defer_exceeded` và kêu, nêu đích danh ai đang giữ chỗ.)
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
/**
 * ★★★ Pha 3 Task 5 (B) — CƠ CHẾ HOÃN NAY LÀ **DÙNG CHUNG** cho cả sáu hộ `background`.
 * Ba thứ dưới đây từng sống ở CHÍNH FILE NÀY và nay chỉ còn **một bản cài đặt** ở `vramDefer`:
 * người quyết định (`planVramDefer`), người đọc ngân sách (`docNganSachHoanMs`), và chốt "đã kêu
 * về cấu hình". `kb:sync` giữ **biến `.env` riêng** (`KB_SYNC_MAX_DEFER_HOURS`) vì đó là một hợp
 * đồng vận hành đã công bố ở `.env.example` — chỉ **cơ chế** dùng chung, không phải **con số**.
 */
import {
  planVramDefer,
  docNganSachHoanMs,
  VRAM_DEFER_FIRST_DELAY_MS,
  __resetVramDeferForTests,
} from "./vram/vramDefer";
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
  /**
   * ★ Pha 2B Task 6 (§5.4) — trạng thái HOÃN của một lượt bị cổng sổ VRAM từ chối.
   * Chỉ có mặt khi `reason === "vram_refused"`. `defer.exceeded === true` ⇒ ngân sách hoãn đã
   * hết: **không** có lượt thử lại nào được lên lịch nữa, và một sự kiện `defer_exceeded` + một
   * cảnh báo nêu tên hộ đang giữ chỗ đã được phát.
   * ⚠ `undefined` KHÔNG có nghĩa "không hoãn" khi `reason === "vram_refused"` — nó có nghĩa
   * **chính cơ chế hoãn đã hỏng** (xem `catch` cuối của `ghiNhanKbSyncBiTuChoi`).
   */
  defer?: KbSyncDeferState;
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
    const { xinVramCoHoan, vramRequestDeferBudgetMs } = await import("./vram/vramDefer");
    /**
     * ★★★ Pha 3 Task 5 (B) — HỘ `background` THỨ HAI ĐI QUA CƠ CHẾ HOÃN DÙNG CHUNG, **NHƯNG VỚI
     * NGÂN SÁCH CỦA "ĐƯỜNG ĐANG CÓ NGƯỜI ĐỢI" (mặc định 0), KHÔNG PHẢI CỦA "ĐƯỜNG JOB NỀN".**
     *
     * ⚠⚠ ĐÂY LÀ MỘT PHÁT HIỆN CỦA BỘ TEST, KHÔNG PHẢI MỘT LỰA CHỌN KHẨU VỊ — và nó đúng lớp lỗi
     * *"cơ chế phòng vệ MỚI vô hiệu hoá cơ chế CŨ"* đã tái diễn ba lần: cổng eval chạy **BÊN
     * TRONG** `runKbSyncNow()`, tức **đang giữ chốt đơn-luồng `running`**. Ngủ 15-60 phút ở đây thì
     * (a) lượt `kb:sync` đó treo hàng giờ, (b) **mọi** lượt thử lại của chuỗi hoãn `cron:kb-sync`
     * rơi vào nhánh `already_running` — tức chính cơ chế hoãn của Task 6 bị cơ chế hoãn của Task 5
     * vô hiệu hoá. Bộ ca `kbSyncScheduler.evalGate.test.ts` bắt được ngay: một ca hết giờ và **chín
     * ca sau đó đổ theo** vì chốt `running` không bao giờ được trả.
     *
     * ⇒ Ngân sách 0 = *"đừng đợi, kêu ngay"*: hành vi y hệt trước Task 5 (`evalGate: "skipped"`,
     * KHÔNG lùi một lượt sync đã thành công), cộng thêm **VẾT** (`defer_exceeded` + ô trạng thái).
     * Người vận hành muốn nó đợi thì đặt `VRAM_DEFER_REQUEST_BUDGET_MS` — và phải biết mình đang
     * đánh đổi cái chốt kia.
     */
    return await xinVramCoHoan({
      owner: "cron:kb-eval-gate",
      leaseKind: "external-process",
      priority: "background",
      budgetMs: vramRequestDeferBudgetMs(),
      xin: () =>
        beginVramAllocation({
          owner: "cron:kb-eval-gate",
          kind: "external-process",
          priority: "background",
          configDefaultBytes: Number(process.env.VRAM_KB_EVAL_ESTIMATE_MB ?? 1251) * 1024 * 1024,
          ttlMs: evalTimeoutMs(),
          releaseProof: "process-exit",
        }),
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
 * ⚠ Pha 2B Task 6 — CƠ CHẾ HOÃN NAY ĐÃ CÓ, và nó **KHÔNG nằm ở đây**. Hàm này chỉ ném lời từ chối
 * lên trên; người lên lịch lại là `ghiNhanKbSyncBiTuChoi()` ở nhánh `catch` của `runKbSyncNow()`
 * (§5.4: lùi 15→60 phút, đáy `KB_SYNC_MAX_DEFER_HOURS`, quá đáy thì `defer_exceeded` + cảnh báo).
 * Ai bọc thêm một `catch` quanh lời gọi này sẽ **tắt toàn bộ cơ chế hoãn, im lặng** — đúng lớp lỗi
 * "một `catch` rộng hơn ở tầng trên nuốt lại" mà Task 5 mất một vòng sửa để bắt.
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
    // (§5.4) do người gọi lo (Task 6); ở đây chỉ bảo đảm lời từ chối KHÔNG biến mất.
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 2B Task 6 — HOÃN, KHÔNG CHẶN (§5.4)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Quyết định của chủ dự án (2026-08-02): việc `background` bị từ chối thì **hoãn rồi thử lại**,
// **không** hỏng và **không** bỏ qua. Người bắt lỗi là **người giám sát** (file này) chứ không phải
// tiến trình con — con chưa kịp sinh ra khi cổng sổ từ chối.
//
// ⚠⚠ **NHƯNG HOÃN MÃI CHÍNH LÀ BỎ QUA, MỘT CÁCH IM LẶNG** — đúng lớp lỗi cả ba đợt vừa diệt. Nên
// mọi thứ ở dưới được dựng quanh MỘT bất biến, và nó là điều kiện ra số 6 của Pha 2B:
//
//        KHÔNG ĐƯỜNG NÀO ĐỂ MỘT LƯỢT `kb:sync` BIẾN MẤT MÀ KHÔNG ĐỂ LẠI VẾT.
//
// Bốn vết, mỗi vết đọc được bằng MỘT cơ chế khác nhau (một cơ chế chết thì ba cơ chế kia còn):
//   1. `lastRunStats.reason = "vram_refused"` + `lastRunStats.defer` — máy đọc được qua
//      `getKbSyncSchedulerStatus()` (Task 5 N-2 đã trả giá vì vết cũ **chỉ là console**).
//   2. sự kiện `defer` / `defer_exceeded` trong `vram_events` — BỀN, truy được bằng SQL (Task 7).
//   3. `console.warn` / `console.error` — người trực đọc ngay lúc chạy.
//   4. **TÍN HIỆU SẴN CÓ, KHÔNG PHÁT MINH MỚI**: biển báo *"KB có thể đã cũ"*
//      (`aiLocalKnowledgeService.getKbHealth().staleDays` → badge `aiHealth.kbAge` ở
//      `AILocalChatBubble`) **tự nổi lên** khi sync trượt, vì `kbBuiltAt` không nhích. Task này
//      **không** đụng vào nó và **không** dựng biển báo thứ hai — spec §5.4 nói thẳng *"dùng lại
//      nó, đừng phát minh tín hiệu mới"*.
//
// ⚠ Ba việc file này CỐ Ý KHÔNG làm: không đo byte, không cộng byte, không so hai thước (Đ4 —
// số tuyệt đối của hai nguồn không thay thế nhau được). Danh sách hộ đang giữ được **chép
// nguyên** từ `VramRefusedError.facts`, giữ nguyên cờ `measured` của từng hộ, và **không có một
// phép cộng nào**.

/**
 * §5.4 — thử lại sau **15 phút**, nhân đôi, trần **60 phút**.
 * ⚠ Pha 3 Task 5 — **ĐỌC LẠI TỪ `vramDefer`, KHÔNG khai một hằng số thứ hai**: bậc thang lùi nay
 * là tài sản của cơ chế dùng chung, và một bản sao ở đây sẽ trôi khỏi nó ở lượt đổi đầu tiên.
 */
const DEFER_FIRST_DELAY_MS = VRAM_DEFER_FIRST_DELAY_MS;
/** §5.4 — đáy mặc định **6 giờ** (03:00 → 09:00, vẫn trong đêm). */
const DEFER_DEFAULT_BUDGET_HOURS = 6;
/**
 * M-1 — SÀN cho đường **vũ trang LẠI** (`ensureDeferArmed`), KHÔNG phải cho lịch chính. Một
 * `nextRetryAt` đã qua (cửa sổ `already_running`, hoặc mọi lượt khôi phục sau khởi động lại) cho
 * `delay ≤ 0`; không có sàn thì chuỗi quay vòng 0 ms cho tới khi cổng sổ trả lời.
 */
const DEFER_REARM_FLOOR_MS = 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;
const BYTES_PER_MIB = 1024 * 1024;

/**
 * Đáy hoãn tính bằng ms. Đọc PER-CALL (như `isEvalGateEnabled()`) — người vận hành đổi được mà
 * không phải khởi động lại, và test đặt được từng ca.
 *
 * ⚠⚠ Pha 3 Task 5 — THÂN HÀM ĐÃ CHUYỂN XUỐNG `vramDefer.docNganSachHoanMs()`. Bốn hình dạng đầu
 * vào (chưa đặt · để trống · `NaN`/∞/âm · `0` tường minh) và chốt "kêu MỘT lần" nay có **một bản
 * cài đặt duy nhất** dùng chung cho cả sáu hộ `background`. Khối lý lẽ bên dưới giữ nguyên vì nó
 * là hợp đồng vận hành của ĐÚNG biến `KB_SYNC_MAX_DEFER_HOURS`.
 *
 * ⚠⚠ ĐÂY LÀ MỘT SỢI **DÂY** THEO ĐÚNG QUY TẮC TASK 3 (*"mỗi `?? <mặc_định>` cho một đường ra là
 * một dây, và dây thì phải có lưới"*), và nó là sợi dây NGUY HIỂM NHẤT của task này: đáy chính là
 * thứ duy nhất biến "hoãn" thành "hoãn CÓ ĐÁY". Ba hình dạng đầu vào phải được kể tên, không
 * được để một phép `Number()` tự quyết:
 *   • **chưa đặt** ⇒ 6 giờ (mặc định của spec).
 *   • **đặt rồi để TRỐNG** (`KB_SYNC_MAX_DEFER_HOURS=`) ⇒ `Number("")` là **0** — tức "không hoãn
 *     một giây nào". Đây đúng bẫy F của Task 5 (*"đặt rồi để trống ⇒ âm thầm về một giá trị
 *     khác"*) ⇒ coi là **LỖI CẤU HÌNH**: về mặc định và KÊU.
 *   • **`NaN` / `Infinity` / âm** ⇒ về mặc định và KÊU. ⚠ `NaN` là hình dạng CHẾT NGƯỜI: phép so
 *     `elapsed + delay > NaN` cho `false` ⇒ nhánh "thử lại" ⇒ **hoãn VÔ HẠN, IM LẶNG** — đúng thứ
 *     §5.4 tồn tại để chặn.
 *   • **`0` TƯỜNG MINH** vẫn hợp lệ: nghĩa *"đừng hoãn, kêu ngay"* — chiều AN TOÀN (ồn hơn, không
 *     im hơn), cùng kỷ luật với "0 tường minh hợp lệ cho đệm/đơn vị" ở cổng cấu hình Task 5.
 *
 * ⚠⚠ M-6 (review) — THAM SỐ `keu` KHÔNG PHẢI KHẨU VỊ. Chốt một-lần `deferBudgetWarned` là một
 * **tài nguyên tiêu thụ được**: chỉ đúng MỘT lời gọi trong cả đời tiến trình được in dòng cảnh
 * báo cấu hình. `getKbSyncSchedulerStatus()` cũng cần con số này, và nếu một mặt sức khoẻ bị
 * **poll định kỳ** gọi vào đây thì lượt poll đó **ăn mất** tiếng kêu trước khi người vận hành kịp
 * thấy — cảnh báo bốc hơi vào một lượt poll lúc 03:00:01. ⇒ Chỉ **đường QUYẾT ĐỊNH** được kêu;
 * mọi đường CHỈ-ĐỌC dùng `keu = false`.
 */
function docDayHoanMs(keu: boolean): number {
  return docNganSachHoanMs(
    "KB_SYNC_MAX_DEFER_HOURS",
    DEFER_DEFAULT_BUDGET_HOURS * MS_PER_HOUR,
    "gio",
    keu,
  );
}

/** Đáy hoãn cho **đường QUYẾT ĐỊNH** — được phép kêu khi cấu hình vô nghĩa. */
export function kbSyncDeferBudgetMs(): number {
  return docDayHoanMs(true);
}

export type KbSyncDeferPlan =
  | {
      readonly kind: "retry";
      readonly delayMs: number;
      readonly retryAt: number;
      readonly elapsedMs: number;
      readonly budgetMs: number;
    }
  | {
      readonly kind: "exceeded";
      readonly elapsedMs: number;
      /** Lượt thử lại LẼ RA sẽ cách bao lâu — `null` ⇔ chính con số đó không hữu hạn. */
      readonly wouldRetryInMs: number | null;
      readonly budgetMs: number;
    };

/**
 * Người quyết định DUY NHẤT của §5.4. **Thuần, đồng bộ, không đọc đồng hồ, KHÔNG BAO GIỜ NÉM** —
 * mọi đầu vào là tham số nên đột biến nào cũng đo được mà không phải dựng lịch thật.
 *
 * `elapsed + delay > budget` chứ không phải `elapsed > budget`: đáy là **ngân sách hoãn**, nên
 * lượt thử lại nào **rơi ra ngoài** ngân sách thì lượt đó không được lên lịch. Với 15→30→60→60…
 * và đáy 6 giờ, cộng dồn là 15·45·105·165·225·285·345 phút ⇒ lượt thứ **8** vượt đáy.
 *
 * ⚠⚠ NHÁNH KHÔNG-HỮU-HẠN LÀ **NHÁNH ĐẦU TIÊN**, CÓ CHỦ Ý. Để phép so sánh tự xử `NaN` là chọn
 * `false` ⇒ "thử lại" ⇒ hoãn vô hạn không tiếng. Ở đây `NaN` đi thẳng vào `exceeded`: **kêu**,
 * chứ không **im**. Cùng chiều fail-closed với `NaN ≤ x === false` ở `vramEnforcement`.
 */
export function planKbSyncDefer(input: {
  readonly now: number;
  readonly firstRefusedAt: number;
  readonly previousDelayMs: number | null;
  readonly budgetMs: number;
}): KbSyncDeferPlan {
  /**
   * ⚠⚠ Pha 3 Task 5 — **KHÔNG CÒN BẢN CÀI ĐẶT THỨ HAI.** Thân hàm cũ (bốn nhánh, cùng hằng số
   * 15/60 phút) nay sống ở `vramDefer.planVramDefer` và phục vụ **cả sáu** hộ `background`. Đây
   * đúng ràng buộc 12: khi hai bản sao của một vị từ đứng dưới một bất biến, lời giải không phải
   * "thêm một ca canh chúng khớp nhau" mà là **xoá bản thứ hai đi**.
   */
  return planVramDefer(input);
}

/** Một hộ đang giữ chỗ, chép từ `VramRefusalFacts.holders`. **Không cộng, không đổi thước.** */
export interface KbSyncDeferHolder {
  readonly owner: string;
  readonly kind: string;
  readonly priority: string;
  /** MiB theo SỔ. `"?"` ⇔ con số không hữu hạn — KHÔNG bịa `0` (bẫy `jsonb` ⇒ `null` im lặng). */
  readonly mib: number | "?";
  /** `true` ⇔ số ĐO, `false` ⇔ ƯỚC LƯỢNG. **Đ4: hai thước KHÔNG được trộn**, nên phải đi kèm. */
  readonly measured: boolean;
  readonly reclaimable: boolean;
}

export interface KbSyncRefusalNote {
  /**
   * ⚠⚠ **`false` nghĩa "KHÔNG ĐỌC ĐƯỢC", KHÔNG phải "không có ai giữ".**
   *
   * `isVramRefusal()` nhận diện bằng `Error.name` (cố ý — nó phải đi qua ranh giới
   * `await import()`), nên một lỗi mang đúng tên mà **không** mang `facts` vẫn lọt tới đây. Nếu
   * ô này không tồn tại thì `holders: []` sẽ được đọc thành *"sổ rỗng"* — tức biến một câu
   * *"tôi không biết"* thành *"tôi đã kiểm và không có gì"*, đúng lớp lỗi đắt nhất của cả chuỗi
   * này (`VramUnledgeredFact` = `null` tồn tại vì đúng lý do đó).
   */
  readonly holdersKnown: boolean;
  readonly holders: readonly KbSyncDeferHolder[];
  /** Byte đang xin — chỉ nhận số HỮU HẠN (cột `estimated_bytes` là `bigint`: một `NaN` mất CẢ LÔ). */
  readonly requestedBytes: number | null;
  readonly message: string;
}

function mibOrUnknown(v: unknown): number | "?" {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v / BYTES_PER_MIB) : "?";
}

/**
 * Đọc *"ai đang giữ chỗ"* ra khỏi một `VramRefusedError`. **KHÔNG BAO GIỜ NÉM** — nó chạy trên
 * đúng đường đang vá, và một cú ném ở đây biến "hoãn có tiếng" thành "hỏng cả lượt".
 */
export function readKbSyncRefusalNote(err: unknown): KbSyncRefusalNote {
  const message = (() => {
    try {
      return String((err as { message?: unknown })?.message ?? err);
    } catch {
      return "(không đọc được câu từ chối)";
    }
  })();
  const khongDocDuoc: KbSyncRefusalNote = {
    holdersKnown: false,
    holders: [],
    requestedBytes: null,
    message,
  };
  try {
    const facts = (err as { facts?: unknown })?.facts;
    if (typeof facts !== "object" || facts === null) return khongDocDuoc;
    const raw = (facts as { holders?: unknown }).holders;
    if (!Array.isArray(raw)) return khongDocDuoc;
    const holders: KbSyncDeferHolder[] = raw.map((h) => {
      const o = (h ?? {}) as Record<string, unknown>;
      return {
        owner: String(o.owner ?? "?"),
        kind: String(o.kind ?? "?"),
        priority: String(o.priority ?? "?"),
        mib: mibOrUnknown(o.bytes),
        measured: o.measured === true,
        reclaimable: o.reclaimable === true,
      };
    });
    const rb = (facts as { requestedBytes?: unknown }).requestedBytes;
    return {
      holdersKnown: true,
      holders,
      requestedBytes: typeof rb === "number" && Number.isFinite(rb) ? rb : null,
      message,
    };
  } catch {
    return khongDocDuoc;
  }
}

/**
 * ★ I-1 — dựng lại `KbSyncRefusalNote` từ **`detail` đã ghi vào `vram_events`** (khôi phục sau
 * khởi động lại). Khác `readKbSyncRefusalNote()` ở đầu vào: ở đó hộ mang `bytes` THÔ, ở đây hộ đã
 * là `KbSyncDeferHolder` (đã sang MiB). **KHÔNG BAO GIỜ NÉM.**
 *
 * ⚠⚠ `holdersKnown` mặc định **`false`**, và đó là fail-closed có chủ ý: một dòng cũ (ghi bởi một
 * bản trước khi có ô này) hoặc một `detail` bị cắt sẽ khai *"KHÔNG ĐỌC ĐƯỢC"* chứ **không** khai
 * *"sổ rỗng"*. Đây đúng sợi dây mà §2.3 của báo cáo dựng ra để chặn, chỉ khác đầu vào.
 */
function readKbSyncRefusalNoteFromDetail(detail: Record<string, unknown> | null): KbSyncRefusalNote {
  const trong: KbSyncRefusalNote = {
    holdersKnown: false,
    holders: [],
    requestedBytes: null,
    message: "(khôi phục sau khởi động lại — không có câu từ chối gốc)",
  };
  if (detail === null || typeof detail !== "object") return trong;
  try {
    const raw = detail.holders;
    const holders: KbSyncDeferHolder[] = Array.isArray(raw)
      ? raw.map((h) => {
          const o = (h ?? {}) as Record<string, unknown>;
          return {
            owner: String(o.owner ?? "?"),
            kind: String(o.kind ?? "?"),
            priority: String(o.priority ?? "?"),
            mib: typeof o.mib === "number" && Number.isFinite(o.mib) ? o.mib : "?",
            measured: o.measured === true,
            reclaimable: o.reclaimable === true,
          };
        })
      : [];
    return {
      holdersKnown: detail.holdersKnown === true && Array.isArray(raw),
      holders,
      requestedBytes: null,
      message:
        typeof detail.refusalMessage === "string" ? detail.refusalMessage : trong.message,
    };
  } catch {
    return trong;
  }
}

function holderLine(h: KbSyncDeferHolder): string {
  // `=` số ĐO · `≈` ƯỚC LƯỢNG — cùng ký hiệu với `vramRefusal.holderText()`, không phát minh
  // ký hiệu thứ hai cho cùng một ý (Đ4: nói rõ con số đến từ thước nào).
  return `${h.owner}${h.measured ? "=" : "≈"}${h.mib} MiB (${h.priority}, ${h.reclaimable ? "thu hồi được" : "CHƯA có cơ chế thu hồi"})`;
}

/** Câu *"ai đang giữ chỗ"* cho cảnh báo. Ba hình dạng, và **không hình dạng nào nói dối**. */
function holdersText(note: KbSyncRefusalNote): string {
  if (!note.holdersKnown) {
    return (
      `KHÔNG ĐỌC ĐƯỢC — lời từ chối không mang \`facts\`. ⚠ Đừng đọc thành "không có ai giữ": ` +
      `đây là "chưa biết".`
    );
  }
  if (note.holders.length === 0) {
    return (
      `sổ KHÔNG có hộ nào — nhưng sổ chỉ bao một phần các điểm cấp phát đã biết, nên đây KHÔNG ` +
      `phải bằng chứng thiết bị đang trống`
    );
  }
  return note.holders.map(holderLine).join(", ");
}

/**
 * ★ M-4 (review) — RÚT KẾT LUẬN MÀ CHÍNH HỆ ĐÃ CÓ ĐỦ DỮ LIỆU ĐỂ RÚT.
 *
 * Khi **mọi** hộ đang giữ chỗ đều `reclaimable === false`, câu "thử lại sau N phút" được in **bảy
 * lần liên tiếp** trong khi hệ đã biết lượt thử lại nhiều khả năng trượt vì đúng lý do cũ.
 * `holderLine()` in cờ `reclaimable` từng hộ nên người trực **suy ra được** — nhưng *"suy ra
 * được"* không bằng *"được nói"*, và đó đúng lớp "hứa nhiều hơn dữ liệu" đã bắt tám lần.
 *
 * ⚠⚠ VÀ SỰ THẬT CÒN CỨNG HƠN (review (C), kiểm bằng mã): `cron:kb-sync` chạy ở mức
 * **`background`** — mức **THẤP NHẤT** (`vramBroker.PRIORITY_RANK`) — còn `preemptable` được định
 * nghĩa là *"mức THẤP HƠN mức đang xin"* ⇒ với hộ này nó **RỖNG THEO ĐỊNH NGHĨA, VĨNH VIỄN**.
 * Nghĩa là `preempt()` mở rộng của Task 7 **cũng KHÔNG giành được byte nào** cho `kb:sync`. Đường
 * DUY NHẤT để một lượt thử lại thành công là **một hộ khác TỰ NHẢ** (model bị dispose, sidecar
 * thoát, trainer xong việc) — điều đó CÓ xảy ra thật, nên cửa sổ chờ 6 giờ không vô nghĩa; nhưng
 * câu chữ không được để người trực ngồi đợi một cơ chế không tồn tại.
 *
 * ⚠ Một CÂU, không phải một cơ chế: không đổi lịch, không rút ngắn đáy. Rút ngắn đáy dựa trên
 * `reclaimable` là để một ô ƯỚC LƯỢNG lái một quyết định — đúng thứ pha này cấm.
 */
function trienVongText(note: KbSyncRefusalNote): string {
  if (!note.holdersKnown || note.holders.length === 0) return "";
  if (note.holders.some((h) => h.reclaimable)) return "";
  return (
    ` ⚠ KHÔNG hộ nào thu hồi được ⇒ lượt thử lại nhiều khả năng VẪN BỊ TỪ CHỐI vì đúng lý do này; ` +
    `nó chỉ thành công nếu một hộ TỰ NHẢ. Cần người can thiệp.`
  );
}

/** Trạng thái hoãn — máy đọc được qua `getKbSyncSchedulerStatus().defer` và `lastRunStats.defer`. */
export interface KbSyncDeferState {
  readonly firstRefusedAt: string | null;
  readonly attempts: number;
  readonly nextRetryAt: string | null;
  /** Khoảng lùi của lượt tới. `null` ⇔ **đã quá đáy** ⇒ KHÔNG còn lượt thử lại nào được lên lịch. */
  readonly nextDelayMs: number | null;
  readonly budgetMs: number;
  readonly deadlineAt: string | null;
  readonly exceeded: boolean;
  readonly holdersKnown: boolean;
  readonly holders: readonly KbSyncDeferHolder[];
  readonly lastRefusalMessage: string;
}

/**
 * ★★★ I-2, vòng sửa 2 — **HAI BIẾN THỂ, KHÔNG PHẢI MỘT BẢN GHI CÓ CỜ.**
 *
 * Bản trước là `{ exceeded: boolean; nextRetryAt: number | null; … }` với bất biến
 * `exceeded ⇔ nextRetryAt === null`. Reviewer đột biến người TIÊU THỤ để nó **tự viết lại** vị từ
 * (`s === null || s.nextRetryAt === null`, quên `exceeded`) và bộ test cho **0 đỏ / 500**: dưới
 * bất biến đó hai cách viết trùng nhau, nên **không ca hành vi nào phân biệt nổi**.
 *
 * ⇒ Lời giải không phải thêm một ca nữa, mà là làm cho **bản sao thứ hai KHÔNG VIẾT RA ĐƯỢC**:
 * biến thể `"exceeded"` **không có trường `nextRetryAt`**, nên mọi cách viết lại vị từ bằng
 * `nextRetryAt` đều **`tsc` chặn**, và nếu ai lách qua `tsc` (esbuild của vitest KHÔNG kiểm kiểu)
 * thì giá trị là `undefined` ⇒ `armDeferTimer(NaN)` ⇒ hẹn giờ vẫn được vũ trang ⇒ ca khôi phục
 * `already-exceeded` ĐỎ. Trình biên dịch là lưới thứ nhất, ca test là lưới thứ hai.
 *
 * Đây cùng khuôn với `VramUnledgeredFact = {…} | null` (Task 4): dùng KIỂU để chặn người gọi
 * đọc "chưa biết" thành "không có gì", thay vì dùng một quy ước và hy vọng.
 */
type DeferStreak =
  | {
      readonly kind: "alive";
      readonly firstRefusedAt: number;
      readonly attempts: number;
      /** Khoảng lùi vừa dùng — LUÔN biết khi chuỗi còn sống. */
      readonly lastDelayMs: number;
      readonly nextRetryAt: number;
      readonly budgetMs: number;
      readonly note: KbSyncRefusalNote;
    }
  | {
      readonly kind: "exceeded";
      readonly firstRefusedAt: number;
      readonly attempts: number;
      /** `null` khi chuỗi quá đáy ngay lượt ĐẦU (chưa từng lùi lần nào). */
      readonly lastDelayMs: number | null;
      readonly budgetMs: number;
      readonly note: KbSyncRefusalNote;
    };

type DeferStreakAlive = Extract<DeferStreak, { kind: "alive" }>;

let deferStreak: DeferStreak | null = null;
let deferTimer: NodeJS.Timeout | null = null;

/**
 * ★★★ I-2 (review) — VỊ TỪ DÙNG CHUNG: *"chuỗi hoãn này còn SỐNG không"* (= còn một lượt thử lại
 * để lên lịch).
 *
 * ⚠⚠ TRƯỚC BẢN VÁ NÀY VỊ TỪ ĐƯỢC VIẾT **HAI LẦN**, hai hình dạng khác nhau:
 *   • người SẢN XUẤT (`ghiNhanKbSyncBiTuChoi`): `deferStreak !== null && !deferStreak.exceeded`
 *   • người TIÊU THỤ (`ensureDeferArmed`): `s === null || s.exceeded || s.nextRetryAt === null`
 * Chúng tương đương **chỉ nhờ** bất biến `exceeded ⇔ nextRetryAt === null` — một bất biến mà
 * **không hàm nào cưỡng chế**. Đột biến (D) của review chứng minh: bỏ `s.exceeded ||` khỏi bản
 * TIÊU THỤ cho **0 đỏ / 500**. Hướng hỏng nguy hiểm nhất là **vũ trang lại một chuỗi đã tuyên bố
 * quá đáy** ⇒ cơ chế chống-hoãn-mãi **tự phá chính nó**, sau khi đã kêu "NGỪNG thử lại".
 *
 * ⇒ **MỘT bản cài đặt, hai người gọi.** Đây đúng lớp lỗi *"cơ chế phòng vệ mới vô hiệu hoá cơ chế
 * cũ qua VỊ TỪ DÙNG CHUNG"* đã đẻ ba Critical liên tiếp ở pha trước và tái diễn hai lần ở pha này.
 * Ai thêm một trạng thái thứ ba (vd. "tạm dừng theo lệnh người vận hành", hoặc khôi phục
 * `nextRetryAt` từ DB mà chưa khôi phục `exceeded`) chỉ phải sửa ĐÚNG MỘT CHỖ.
 *
 * ⚠ EXPORT có lý do, không phải rò rỉ nội bộ: dưới bất biến của người sản xuất, tổ hợp
 * `(exceeded: true, nextRetryAt: ≠ null)` **không đạt tới được từ ngoài** ⇒ một ca hành vi KHÔNG
 * thể phân biệt "bỏ mệnh đề `!exceeded`" với "bỏ mệnh đề `nextRetryAt !== null`". Ghim **trực
 * tiếp** cả bốn tổ hợp là cách duy nhất làm **từng mệnh đề** đột biến-được — và "đột biến-được"
 * chính là điều review đòi.
 */
export function kbSyncDeferStreakIsAlive(s: { readonly kind: "alive" | "exceeded" } | null): boolean {
  return s !== null && s.kind === "alive";
}

/** Bản có type-guard cho dùng nội bộ. **Ủy quyền**, không chép lại — nếu không lại là hai bản. */
function chuoiHoanConSong(s: DeferStreak | null): s is DeferStreakAlive {
  return kbSyncDeferStreakIsAlive(s);
}

/** `new Date(NaN).toISOString()` NÉM `RangeError` — và hàm gọi nó khai "không bao giờ ném". */
function isoOrNull(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function publicDeferState(): KbSyncDeferState | null {
  const s = deferStreak;
  if (s === null) return null;
  return {
    firstRefusedAt: isoOrNull(s.firstRefusedAt),
    attempts: s.attempts,
    // ⚠ Mặt CÔNG KHAI giữ nguyên hình dạng `exceeded` + `nextRetryAt` (hợp đồng của Task 6 gốc);
    // biến thể chỉ là cách BIỂU DIỄN bên trong. Người ngoài không phải biết.
    nextRetryAt: s.kind === "alive" ? isoOrNull(s.nextRetryAt) : null,
    nextDelayMs: s.kind === "alive" ? s.lastDelayMs : null,
    budgetMs: s.budgetMs,
    deadlineAt: isoOrNull(s.firstRefusedAt + s.budgetMs),
    exceeded: s.kind === "exceeded",
    holdersKnown: s.note.holdersKnown,
    holders: s.note.holders,
    lastRefusalMessage: s.note.message,
  };
}

function clearDeferTimer(): void {
  if (deferTimer !== null) {
    clearTimeout(deferTimer);
    deferTimer = null;
  }
}

/**
 * ⚠ HẸN GIỜ, KHÔNG PHẢI MỘT CHỐT. Bài học Task 5 (C-1) là *"đặt cờ trước một lời gọi nay có thể
 * ném, gỡ ngoài `finally`"* ⇒ `running` kẹt VĨNH VIỄN. Ở đây trạng thái hoãn được dựng để **không
 * thể** thành chốt thứ hai: `deferTimer` được gỡ về `null` **ngay dòng đầu** của callback (trước
 * mọi lời gọi có thể ném), `clearDeferTimer()` chạy trước mỗi lượt vũ trang, và
 * `stopKbSyncScheduler()` gỡ nó khi tắt.
 *
 * ⚠ `.unref()` theo đúng quyết định Pha 2A cho MỌI hẹn giờ của đường VRAM: một hẹn giờ 15–60 phút
 * KHÔNG được giữ tiến trình sống (và không được treo bộ test). Ở máy chủ thật, cron của
 * `node-cron` + máy chủ HTTP đã giữ vòng lặp sự kiện, nên hẹn giờ vẫn nổ đúng hạn.
 */
function armDeferTimer(delayMs: number): void {
  clearDeferTimer();
  const safe = Number.isFinite(delayMs) ? Math.max(0, delayMs) : DEFER_FIRST_DELAY_MS;
  deferTimer = setTimeout(() => {
    deferTimer = null;
    void (async () => {
      try {
        await runKbSyncNow();
      } catch (e) {
        // `runKbSyncNow()` khai "never throws"; nếu nó ném thì đó là một lỗi RIÊNG và nó vẫn
        // KHÔNG được phép giết chuỗi hoãn (một chuỗi chết = lượt sync biến mất không vết).
        console.error("[kbSyncScheduler] lượt thử lại sau khi hoãn NÉM (không được phép):", e);
      }
      ensureDeferArmed();
    })();
  }, safe);
  deferTimer.unref?.();
}

/**
 * ⚠⚠ LƯỚI CHO ĐƯỜNG THOÁT KHÔNG AI LÊN LỊCH TIẾP — *"lưới phải đi theo ĐƯỜNG THOÁT, không theo
 * FILE"* (bài học Task 5).
 *
 * Đường vũ trang bình thường là nhánh BỊ TỪ CHỐI của `runKbSyncNow()`. Nhưng lượt thử lại có thể
 * rơi vào một nhánh khác — điển hình `skipped: "already_running"` khi cron 03:00 và hẹn giờ hoãn
 * chạm nhau — và nhánh đó **không vũ trang gì cả**. Thiếu lưới này, chuỗi hoãn đứng im mãi mãi
 * với `nextRetryAt` đã qua: một lượt `kb:sync` **biến mất, im lặng**, đúng thứ bị cấm.
 *
 * ⚠ M-1 (review) — SÀN `DEFER_REARM_FLOOR_MS`. `nextRetryAt` đã qua (ca `already_running`, và mọi
 * lượt khôi phục sau khởi động lại) cho `delay ≤ 0` ⇒ `Math.max(0, …)` ⇒ chuỗi quay vòng **0 ms
 * liên tục** tới khi cổng sổ trả lời. Mỗi vòng gần như miễn phí (`runKbSyncNow` trả sớm) nên đây
 * không phải lỗi đúng-sai — nhưng nếu phép đo thiết bị làm cổng sổ chậm vài trăm ms thì đó là
 * hàng nghìn lượt gọi vô ích, và sau khởi động lại nó là một lượt nện vào đúng lúc máy đang bận
 * khởi động. Sàn chỉ áp cho **đường vũ trang LẠI**, không đụng lịch 15→60 phút của đường chính.
 */
function ensureDeferArmed(): void {
  if (deferTimer !== null) return;
  const s = deferStreak;
  if (!chuoiHoanConSong(s)) return;
  armDeferTimer(Math.max(DEFER_REARM_FLOOR_MS, s.nextRetryAt - Date.now()));
}

/**
 * Chuỗi hoãn kết thúc. Gỡ cả hẹn giờ lẫn trạng thái.
 *
 * ⚠ M-2 (review) — `lyDo` KHÔNG PHẢI TRANG TRÍ. `stopKbSyncScheduler()` trước bản vá chỉ gỡ HẸN
 * GIỜ và để lại chuỗi mồ côi ⇒ `getKbSyncSchedulerStatus().defer` vẫn khai `exceeded: false` +
 * `nextRetryAt` ở TƯƠNG LAI + `nextDelayMs: 900000` cho một lượt thử lại **không bao giờ nổ**.
 * Mặt trạng thái NÓI DỐI. Nhưng dùng đúng câu "cổng sổ đã CẤP" cho đường tắt máy thì cũng là nói
 * dối theo chiều khác — nên hai đường, hai câu.
 */
function clearKbSyncDefer(lyDo: "granted" | "shutdown"): void {
  clearDeferTimer();
  if (deferStreak !== null) {
    console.log(
      lyDo === "granted"
        ? `[kbSyncScheduler] chuỗi HOÃN kết thúc — cổng sổ đã CẤP sau ${deferStreak.attempts} lượt ` +
            `bị từ chối${deferStreak.kind === "exceeded" ? " (chuỗi trước đã quá đáy)" : ""}.`
        : `[kbSyncScheduler] chuỗi HOÃN bị BỎ DỞ vì tiến trình đang tắt (${deferStreak.attempts} ` +
            `lượt bị từ chối). Lượt thử lại đã hứa KHÔNG nổ; chuỗi được khôi phục từ ` +
            `\`vram_events\` ở lần khởi động sau (xem khoiPhucChuoiHoan).`,
    );
    deferStreak = null;
  }
}

/** Số hữu hạn hoặc NHÃN CHUỖI — không bao giờ để `NaN`/`±Infinity` chạm ống dẫn sự kiện. */
function soHuuHan(v: number): number | string {
  if (Number.isFinite(v)) return v;
  return Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity";
}

/**
 * Ghi MỘT sự kiện `defer` / `defer_exceeded`. **KHÔNG BAO GIỜ NÉM.**
 *
 * ⚠ `estimatedBytes` chỉ được truyền khi HỮU HẠN: năm cột byte của `vram_events` là
 * `bigint(mode:"number")` ⇒ một `NaN`/`Infinity` làm Postgres ném `22P02` và `flushVramEvents()`
 * ghi theo LÔ ⇒ **mất CẢ LÔ**. `detail` là `jsonb` ⇒ `JSON.stringify(-Infinity)` cho `null`, tức
 * con số biến mất IM LẶNG — nên mọi số trong `detail` đi qua `soHuuHan()` trước.
 * (`vramEventLog.sanitizeVramEvent()` cũng làm sạch ở cửa vào; đây là lớp thứ hai ở NGUỒN, vì một
 * cơ chế chống-im-lặng mà tự nó im lặng thì tệ hơn không có.)
 */
async function logDeferEvent(
  event: "defer" | "defer_exceeded",
  detail: Record<string, unknown>,
  requestedBytes: number | null,
): Promise<void> {
  try {
    const { logVramEvent } = await import("./vram/vramEventLog");
    logVramEvent({
      event,
      owner: "cron:kb-sync",
      leaseKind: "external-process",
      priority: "background",
      ...(requestedBytes !== null && Number.isFinite(requestedBytes)
        ? { estimatedBytes: requestedBytes }
        : {}),
      detail,
    });
  } catch {
    /* telemetry KHÔNG được làm hỏng chính đường hoãn mà nó đang ghi */
  }
}

/**
 * ★★★ TRÁI TIM CỦA §5.4 — biến MỘT lời từ chối thành MỘT lượt hoãn có vết, hoặc thành tiếng kêu
 * khi đã quá đáy. **KHÔNG BAO GIỜ NÉM** (nó chạy trong `catch` của `runKbSyncNow`, mà hàm đó khai
 * *"Fail-safe: never throws"* và người gọi sản xuất là `node-cron` — thứ nuốt lỗi im lặng).
 */
async function ghiNhanKbSyncBiTuChoi(err: unknown): Promise<KbSyncDeferState | null> {
  try {
    const now = Date.now();
    const note = readKbSyncRefusalNote(err);
    const budgetMs = kbSyncDeferBudgetMs();
    // Một chuỗi ĐÃ quá đáy thì KHÔNG kéo dài thêm: lượt cron kế tiếp (đêm sau) mở một ngân sách
    // MỚI. Nếu nối tiếp, đáy 6 giờ sẽ chỉ kêu đúng MỘT lần trong cả đời tiến trình.
    // ★ I-2 — CÙNG MỘT vị từ mà `ensureDeferArmed()` dùng. Đây là người SẢN XUẤT của bất biến
    // `exceeded ⇔ nextRetryAt === null`; trước bản vá, người TIÊU THỤ tự viết lại nó.
    const truoc = chuoiHoanConSong(deferStreak) ? deferStreak : null;
    const firstRefusedAt = truoc !== null ? truoc.firstRefusedAt : now;
    const attempts = (truoc !== null ? truoc.attempts : 0) + 1;
    const plan = planKbSyncDefer({
      now,
      firstRefusedAt,
      previousDelayMs: truoc !== null ? truoc.lastDelayMs : null,
      budgetMs,
    });

    const chung = {
      attempt: attempts,
      elapsedMs: soHuuHan(plan.elapsedMs),
      budgetMs: soHuuHan(plan.budgetMs),
      firstRefusedAt: isoOrNull(firstRefusedAt),
      deadlineAt: isoOrNull(firstRefusedAt + budgetMs),
      // ⚠ "ai đang giữ chỗ" — CẢ HAI ô, luôn luôn. `holders: []` một mình không phân biệt được
      // "sổ rỗng" với "không đọc được", và đó chính là câu hỏi người trực cần trả lời.
      holdersKnown: note.holdersKnown,
      holders: note.holders,
      refusalMessage: note.message,
    };

    if (plan.kind === "retry") {
      deferStreak = {
        kind: "alive",
        firstRefusedAt,
        attempts,
        lastDelayMs: plan.delayMs,
        nextRetryAt: plan.retryAt,
        budgetMs,
        note,
      };
      await logDeferEvent(
        "defer",
        { ...chung, delayMs: soHuuHan(plan.delayMs), nextRetryAt: isoOrNull(plan.retryAt) },
        note.requestedBytes,
      );
      console.warn(
        `[kbSyncScheduler] kb:sync BỊ TỪ CHỐI VRAM ⇒ HOÃN (§5.4), thử lại sau ` +
          `${Math.round(plan.delayMs / 60_000)} phút — lượt ${attempts}, đã hoãn ` +
          `${Math.round(plan.elapsedMs / 60_000)}/${Math.round(budgetMs / 60_000)} phút của đáy. ` +
          `Đang giữ chỗ: ${holdersText(note)}.${trienVongText(note)}`,
      );
      armDeferTimer(plan.delayMs);
    } else {
      deferStreak = {
        kind: "exceeded",
        firstRefusedAt,
        attempts,
        lastDelayMs: truoc !== null ? truoc.lastDelayMs : null,
        budgetMs,
        note,
      };
      clearDeferTimer();
      await logDeferEvent(
        "defer_exceeded",
        {
          ...chung,
          wouldRetryInMs: plan.wouldRetryInMs === null ? null : soHuuHan(plan.wouldRetryInMs),
        },
        note.requestedBytes,
      );
      /**
       * ⚠ CẢNH BÁO, KHÔNG PHẢI MỘT DÒNG NHẬT KÝ. Ba thứ BẮT BUỘC có mặt: (1) hệ **đã bỏ** lượt
       * này — nói thẳng, không úp mở; (2) **AI ĐANG GIỮ CHỖ** — người trực cần biết đi hỏi ai;
       * (3) trỏ về **tín hiệu sẵn có** (`staleDays`) chứ không dựng biển báo thứ hai.
       */
      console.error(
        `[kbSyncScheduler] ★ QUÁ ĐÁY HOÃN (defer_exceeded) — kb:sync đã bị VRAM từ chối ` +
          `${attempts} lượt trong ${Math.round(plan.elapsedMs / 60_000)} phút, vượt đáy ` +
          `KB_SYNC_MAX_DEFER_HOURS=${(budgetMs / MS_PER_HOUR).toFixed(2)} giờ ⇒ NGỪNG thử lại ` +
          `cho tới lượt cron kế tiếp. KHÔNG bỏ qua âm thầm: tri thức sẽ CŨ DẦN và biển báo ` +
          `"KB … ngày tuổi" (getKbHealth().staleDays) tự nổi lên. AI ĐANG GIỮ CHỖ: ` +
          `${holdersText(note)}. Câu từ chối gần nhất: ${note.message}`,
      );
    }
    return publicDeferState();
  } catch (e) {
    // Kể cả khi chính cơ chế hoãn hỏng, lượt này vẫn KHÔNG được biến mất không vết.
    console.error(
      "[kbSyncScheduler] cơ chế HOÃN (§5.4) tự hỏng — lượt kb:sync bị từ chối này KHÔNG được lên " +
        "lịch lại; vết còn lại: lastRunStats.reason='vram_refused' + dòng này:",
      e,
    );
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-1 (review) — CHUỖI HOÃN PHẢI SỐNG QUA MỘT LẦN KHỞI ĐỘNG LẠI
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Bản đầu của Task 6 giữ `deferStreak` + `deferTimer` **hoàn toàn trong bộ nhớ**, và
// `startKbSyncScheduler()` chỉ đăng ký cron. Hậu quả nặng hơn một bậc so với điều báo cáo tự khai
// (*"ngân sách mở lại từ đầu"*):
//
//   1. lượt thử lại đã hứa (`nextRetryAt`) **KHÔNG BAO GIỜ NỔ** — không phải "hoãn lâu hơn", mà là
//      **không thử lại nữa**; người gọi sản xuất kế tiếp là **cron 03:00 ĐÊM SAU** (`runKbSyncNow`
//      không có điểm gọi sản xuất nào khác);
//   2. `firstRefusedAt` mất ⇒ đáy 6 giờ **không bao giờ chạm tới**;
//   3. ⇒ trong một vòng khởi-động-lại lặp, `defer_exceeded` **KHÔNG BAO GIỜ KÊU** — bảo đảm
//      *"quá đáy phải CÓ TIẾNG"* bốc hơi im lặng, đúng lớp lỗi §5.4 tồn tại để diệt.
//
// ⚠ Kịch bản khởi-động-lại lặp là THẬT ở cả hai môi trường của dự án này:
// `docker-compose.yml` dịch vụ `app` mang `restart: unless-stopped`; `package.json`
// `"dev": "tsx watch …"` ⇒ **mỗi lần lưu file là một lần khởi động lại**. Và cửa sổ 03:00→09:00 mà
// đáy 6 giờ sống trong đó là cửa sổ DÀI NHẤT và THƯA NHẤT: một lần khởi động lại bất kỳ trong 6
// giờ đó xoá sạch cả đêm.
//
// ⚠⚠ **KHÔNG DDL, KHÔNG CỘT MỚI, KHÔNG BẢNG MỚI.** Dữ liệu **đã bền rồi** — mỗi sự kiện `defer` đã
// mang `detail.firstRefusedAt` · `deadlineAt` · `attempt` · `budgetMs` · `delayMs` · `nextRetryAt`
// vào `vram_events`, và bảng đã có index `vram_events_owner_idx`. Thứ thiếu là **CHIỀU ĐỌC NGƯỢC**:
// đúng MỘT câu `SELECT … ORDER BY id DESC LIMIT 1`, một lần trong đời tiến trình.

/**
 * Kết luận của lượt đọc ngược. **Bốn** kết cục, và ba trong số đó KHÔNG vũ trang lại gì cả —
 * `"none"` là kết cục **FAIL-CLOSED** cho mọi dòng méo mó: thà mở một chuỗi mới (đáy đầy đủ, có
 * tiếng) còn hơn khôi phục một trạng thái rác rồi hoãn theo nó.
 */
export type KbSyncDeferResumePlan =
  | { readonly kind: "none"; readonly reason: string }
  | {
      /**
       * `resume` — chuỗi còn trong ngân sách ⇒ vũ trang lại.
       * `overdue` — hạn đáy **đã qua trong lúc tiến trình chết** ⇒ hệ đang **NỢ MỘT TIẾNG KÊU**;
       *   phát `defer_exceeded` NGAY rồi đóng chuỗi.
       * `already-exceeded` — đêm trước đã kêu rồi ⇒ khôi phục để mặt trạng thái trung thực,
       *   **KHÔNG** kêu lại, **KHÔNG** vũ trang.
       */
      readonly kind: "resume" | "overdue" | "already-exceeded";
      readonly firstRefusedAt: number;
      readonly attempts: number;
      readonly lastDelayMs: number | null;
      readonly nextRetryAt: number | null;
      readonly budgetMs: number;
      readonly reason: string;
    };

function soTuDetail(v: unknown): number | null {
  // ⚠ M-3 — ô số trong `detail` là kiểu hợp `number | string`: `soHuuHan()` (và
  // `sanitizeVramEvent()`) thay giá trị không hữu hạn bằng NHÃN CHUỖI `"NaN"`/`"Infinity"`. Một
  // `Number("NaN")` ở đây sẽ cho `NaN` rồi trôi thẳng vào phép so đáy — đúng đường "hoãn vô hạn,
  // im lặng". Nên: CHỈ nhận `number` HỮU HẠN, mọi thứ khác là `null` ⇒ fail-closed về `"none"`.
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function mocThoiGianTuDetail(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

/**
 * **Thuần, đồng bộ, KHÔNG BAO GIỜ NÉM.** Đọc một dòng `vram_events` thành kết luận khôi phục.
 * Tách khỏi I/O để đột biến hoá được mà không cần DB.
 */
export function planKbSyncDeferResume(input: {
  readonly now: number;
  readonly event: string | null;
  readonly detail: Record<string, unknown> | null;
  /**
   * ★★★ Pha 3 Task 5 (D) — **"KHÔNG ĐỌC ĐƯỢC NHẬT KÝ" ≠ "ĐỌC ĐƯỢC, KHÔNG CÓ DÒNG NÀO".**
   *
   * Bản Task 6 ép cả hai về `event: null` ⇒ cùng một kết cục `"khong-co-dong-hoan-nao"`, tức đúng
   * lớp lỗi *"`null` bị đọc thành 0"* mà cả module VRAM tồn tại để diệt — chỉ khác chỗ đứng. Hậu
   * quả cụ thể ở **cài đặt không DB** (`getDb()` trả `null`): mỗi lần khởi động lại, hệ kết luận
   * *"đêm qua không có lượt hoãn nào"*, `firstRefusedAt` mở lại từ đầu, đáy 6 giờ **không bao giờ
   * chạm tới**, và `defer_exceeded` **KHÔNG BAO GIỜ KÊU** — bảo đảm *"quá đáy phải CÓ TIẾNG"* bốc
   * hơi trong im lặng, đúng thứ §5.4 tồn tại để chặn.
   *
   * ⚠ Task 5 **KHÔNG** vá được cái mù đó (không có kho bền thì không có gì để đọc lại — sổ chung
   * `vram_leases` cũng nằm trên cùng cái DB ấy). Thứ Task 5 sửa là: cái mù nay **CÓ TÊN** và
   * **CÓ TIẾNG**, thay vì đội lốt một câu trả lời khẳng định. `false` ⇒ lý do riêng + một dòng
   * cảnh báo ở `resumeKbSyncDeferFromLog()`.
   */
  readonly docDuoc?: boolean;
}): KbSyncDeferResumePlan {
  const { now, event, detail } = input;
  if (input.docDuoc === false) {
    return { kind: "none", reason: "khong-doc-duoc-nhat-ky-hoan" };
  }
  if (event !== "defer" && event !== "defer_exceeded") {
    return { kind: "none", reason: "khong-co-dong-hoan-nao" };
  }
  if (detail === null || typeof detail !== "object") {
    return { kind: "none", reason: "dong-hoan-khong-co-detail" };
  }
  const firstRefusedAt = mocThoiGianTuDetail(detail.firstRefusedAt);
  const budgetMs = soTuDetail(detail.budgetMs);
  const attempts = soTuDetail(detail.attempt);
  if (firstRefusedAt === null || budgetMs === null || attempts === null || attempts < 1) {
    return { kind: "none", reason: "detail-thieu-hoac-khong-huu-han" };
  }
  const lastDelayMs = soTuDetail(detail.delayMs);
  const chung = { firstRefusedAt, attempts, lastDelayMs, budgetMs };

  if (event === "defer_exceeded") {
    return { ...chung, kind: "already-exceeded", nextRetryAt: null, reason: "dem-truoc-da-keu" };
  }
  // ⚠ So với ĐÁY, không so với `nextRetryAt`: một lượt thử lại trễ 3 phút vẫn đáng chạy, nhưng một
  // chuỗi đã vượt ngân sách thì **món nợ là TIẾNG KÊU**, không phải một lượt thử nữa.
  if (!Number.isFinite(now) || now >= firstRefusedAt + budgetMs) {
    return { ...chung, kind: "overdue", nextRetryAt: null, reason: "day-da-qua-luc-tien-trinh-chet" };
  }
  const nextRetryAt = mocThoiGianTuDetail(detail.nextRetryAt);
  if (nextRetryAt === null) {
    return { kind: "none", reason: "dong-defer-khong-co-nextRetryAt" };
  }
  return { ...chung, kind: "resume", nextRetryAt, reason: "con-trong-ngan-sach" };
}

/**
 * Dòng `defer`/`defer_exceeded` gần nhất của `cron:kb-sync`.
 *
 * ★★★ Pha 3 Task 5 (D) — **BA kết cục, không phải hai.** Bản Task 6 trả `null` cho CẢ "đọc được,
 * không có dòng nào" LẪN "không đọc được" — xem `planKbSyncDeferResume.docDuoc` để biết vì sao
 * gộp hai thứ đó lại làm `defer_exceeded` **không bao giờ kêu** ở cài đặt không DB.
 */
type LuotDocNhatKyHoan =
  | { readonly kind: "co"; readonly event: string; readonly detail: Record<string, unknown> | null }
  | { readonly kind: "khong-co" }
  | { readonly kind: "khong-doc-duoc"; readonly viSao: string };

async function docDongHoanGanNhat(): Promise<LuotDocNhatKyHoan> {
  try {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    // ⚠ KHÔNG CÓ DB (cài đặt tối giản / test) ⇒ **KHÔNG ĐỌC ĐƯỢC**, tuyệt đối không phải "không
    // có dòng nào". Đây là ô mà cả cơ chế đáy 6 giờ đứng lên sau một lượt khởi động lại.
    if (!db) return { kind: "khong-doc-duoc", viSao: "khong-co-DB" };
    const { vramEvents } = await import("../../drizzle/schema/vram");
    const { and, desc, eq, inArray } = await import("drizzle-orm");
    const rows = await db
      .select({ event: vramEvents.event, detail: vramEvents.detail })
      .from(vramEvents)
      // ⚠ `inArray`, KHÔNG `= ANY(${jsArray})` — antipattern đã đo: `42809` ⇒ 500.
      .where(and(eq(vramEvents.owner, "cron:kb-sync"), inArray(vramEvents.event, ["defer", "defer_exceeded"])))
      .orderBy(desc(vramEvents.id))
      .limit(1);
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return { kind: "khong-co" };
    return {
      kind: "co",
      event: String(row.event),
      detail: row.detail !== null && typeof row.detail === "object" ? (row.detail as Record<string, unknown>) : null,
    };
  } catch (e) {
    console.warn("[kbSyncScheduler] không đọc lại được chuỗi hoãn từ vram_events:", (e as Error)?.message ?? e);
    return { kind: "khong-doc-duoc", viSao: "truy-van-hong" };
  }
}

/** Đã kêu về "không đọc lại được nhật ký hoãn" chưa — kêu MỘT lần mỗi đời tiến trình. */
let daKeuVeNhatKyMu = false;

/**
 * ★★★ Khôi phục chuỗi hoãn sau một lần khởi động lại. Gọi từ `startKbSyncScheduler()`.
 * **KHÔNG BAO GIỜ NÉM.**
 *
 * ⚠ `ensureDeferArmed()` là **điểm quyết định DUY NHẤT** ở cuối hàm — kể cả cho nhánh
 * `already-exceeded`. Đó là chủ ý: nó buộc vị từ dùng chung `chuoiHoanConSong()` phải TỰ từ chối
 * vũ trang một chuỗi đã quá đáy, thay vì để lời từ chối đó nằm rải ở ba nhánh `if` khác nhau.
 * Đây chính là đường thoát mà đột biến (D) của review đi qua mà **không ca nào đỏ** — nay có.
 */
export async function resumeKbSyncDeferFromLog(): Promise<KbSyncDeferResumePlan> {
  try {
    // Trạng thái SỐNG trong bộ nhớ luôn thắng một dòng lịch sử: không đè lên chuỗi đang chạy.
    if (deferStreak !== null) return { kind: "none", reason: "da-co-chuoi-trong-bo-nho" };
    const doc = await docDongHoanGanNhat();
    if (doc.kind === "khong-doc-duoc" && !daKeuVeNhatKyMu) {
      daKeuVeNhatKyMu = true;
      // ⚠ MỘT LẦN, và phải KÊU: im lặng ở đây đúng bằng việc tuyên bố "đêm qua không có lượt hoãn
      // nào" — một câu KHẲNG ĐỊNH dựng trên chỗ không có dữ liệu.
      console.warn(
        `[kbSyncScheduler] KHÔNG đọc lại được nhật ký hoãn (${doc.viSao}) ⇒ ngân sách hoãn ` +
          `(${(kbSyncDeferBudgetMs() / MS_PER_HOUR).toFixed(2)} giờ) KHÔNG sống qua được lượt khởi ` +
          `động lại này: mỗi lần khởi động lại sẽ mở một chuỗi MỚI, nên "quá đáy" có thể KHÔNG BAO ` +
          `GIỜ kêu trong một vòng khởi-động-lại lặp (docker restart / tsx watch). Đây là MẤT KHẢ ` +
          `NĂNG ĐỌC, KHÔNG phải bằng chứng "đêm qua không có lượt hoãn nào".`,
      );
    }
    const plan = planKbSyncDeferResume({
      now: Date.now(),
      event: doc.kind === "co" ? doc.event : null,
      detail: doc.kind === "co" ? doc.detail : null,
      docDuoc: doc.kind !== "khong-doc-duoc",
    });
    if (plan.kind === "none") return plan;

    const note = readKbSyncRefusalNoteFromDetail(doc.kind === "co" ? doc.detail : null);
    // ⚠ `tsc` là thứ bắt buộc hai nhánh này phải TÁCH: biến thể `"alive"` đòi `nextRetryAt` và
    // `lastDelayMs` là SỐ, nên một lượt "khôi phục quá đáy nhưng vẫn giữ nextRetryAt" — đúng hình
    // dạng đã làm bản sao thứ hai của vị từ trôi — **không viết ra được**.
    deferStreak =
      plan.kind === "resume" && plan.nextRetryAt !== null
        ? {
            kind: "alive",
            firstRefusedAt: plan.firstRefusedAt,
            attempts: plan.attempts,
            lastDelayMs: plan.lastDelayMs ?? DEFER_FIRST_DELAY_MS,
            nextRetryAt: plan.nextRetryAt,
            budgetMs: plan.budgetMs,
            note,
          }
        : {
            kind: "exceeded",
            firstRefusedAt: plan.firstRefusedAt,
            attempts: plan.attempts,
            lastDelayMs: plan.lastDelayMs,
            budgetMs: plan.budgetMs,
            note,
          };

    if (plan.kind === "resume") {
      console.warn(
        `[kbSyncScheduler] khôi phục chuỗi HOÃN từ vram_events sau khởi động lại — lượt ` +
          `${plan.attempts}, hạn đáy ${isoOrNull(plan.firstRefusedAt + plan.budgetMs)}, ` +
          `thử lại lúc ${isoOrNull(plan.nextRetryAt ?? 0)}. Đang giữ chỗ (theo dòng cuối): ` +
          `${holdersText(note)}.`,
      );
    } else if (plan.kind === "overdue") {
      // ⚠ MÓN NỢ: đáy đã qua trong lúc tiến trình chết, nên tiếng kêu chưa ai phát. Phát BÂY GIỜ,
      // và nói rõ nó đến muộn — một `defer_exceeded` không có nhãn này sẽ bị Task 7 đọc thành
      // "đêm nay vừa quá đáy" trong khi thật ra là "đêm qua, và hệ vừa mới biết".
      await logDeferEvent(
        "defer_exceeded",
        {
          attempt: plan.attempts,
          elapsedMs: soHuuHan(Date.now() - plan.firstRefusedAt),
          budgetMs: soHuuHan(plan.budgetMs),
          firstRefusedAt: isoOrNull(plan.firstRefusedAt),
          deadlineAt: isoOrNull(plan.firstRefusedAt + plan.budgetMs),
          holdersKnown: note.holdersKnown,
          holders: note.holders,
          refusalMessage: note.message,
          recoveredAfterRestart: true,
        },
        null,
      );
      console.error(
        `[kbSyncScheduler] ★ QUÁ ĐÁY HOÃN (defer_exceeded, PHÁT MUỘN sau khởi động lại) — chuỗi ` +
          `bắt đầu ${isoOrNull(plan.firstRefusedAt)} đã vượt đáy ` +
          `${(plan.budgetMs / MS_PER_HOUR).toFixed(2)} giờ trong lúc tiến trình không chạy, nên ` +
          `tiếng kêu này BỊ NỢ tới bây giờ. Lượt kb:sync kế tiếp là cron theo lịch. AI ĐANG GIỮ ` +
          `CHỖ (theo dòng cuối trước khi tắt): ${holdersText(note)}.`,
      );
    }
    // ĐIỂM QUYẾT ĐỊNH DUY NHẤT — vị từ dùng chung tự lọc `overdue`/`already-exceeded`.
    ensureDeferArmed();
    return plan;
  } catch (e) {
    console.error("[kbSyncScheduler] khôi phục chuỗi hoãn tự hỏng (bỏ qua, chuỗi mới sẽ mở ở lượt cron):", e);
    return { kind: "none", reason: "khoi-phuc-tu-hong" };
  }
}

/** Chỉ dùng trong test — gỡ hẹn giờ + xoá chuỗi hoãn + đặt lại chốt "đã kêu về cấu hình". */
export function __resetKbSyncDeferForTests(): void {
  clearDeferTimer();
  deferStreak = null;
  daKeuVeNhatKyMu = false;
  // ⚠ Pha 3 Task 5 — chốt "đã kêu về cấu hình" nay nằm ở `vramDefer` (một chốt cho MỖI biến
  // `.env`). Không gọi dòng này thì ca "giá trị vô nghĩa ⇒ mặc định + KÊU" chỉ đỏ được ở lượt đầu.
  __resetVramDeferForTests();
}

/** Chỉ dùng trong test — có hẹn giờ hoãn nào đang sống không (canh trực tiếp, không suy đoán). */
export function __hasKbSyncDeferTimer(): boolean {
  return deferTimer !== null;
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
   * ⚠ `skipped: true` + `reason: "vram_refused"` là VẾT; từ Task 6, `stats.defer` nói thêm lượt
   * này **đã được lên lịch lại lúc nào** (hoặc đã QUÁ ĐÁY và hệ đang kêu) — §5.4.
   */
  let kbSyncVramTicket: VramTicket;
  try {
    kbSyncVramTicket = await beginKbSyncVram();
  } catch (err) {
    if (!isVramRefusal(err)) throw err;
    // ⚠ `snapshot` là `null` khi cổng eval tắt — chỉ dọn khi THẬT SỰ có ảnh chụp, nếu không lượt
    // dọn này lại là một cú ném mới trên đúng đường vừa vá.
    if (snapshot) discardKbSnapshot(snapshot);
    /**
     * ★★★ Pha 2B Task 6 (§5.4) — HOÃN, KHÔNG CHẶN. Lượt này không "bỏ qua" nữa: nó được LÊN LỊCH
     * LẠI (15 phút, nhân đôi, trần 60 phút) cho tới khi hết ngân sách `KB_SYNC_MAX_DEFER_HOURS`,
     * và lúc hết thì nó **KÊU** (`defer_exceeded` + cảnh báo nêu ai đang giữ chỗ) chứ không im.
     * Toàn bộ cơ chế nằm trong `ghiNhanKbSyncBiTuChoi()`, và hàm đó KHÔNG BAO GIỜ NÉM.
     */
    const defer = await ghiNhanKbSyncBiTuChoi(err);
    /**
     * ★★ N-2 (re-review) — VẾT PHẢI ĐỌC ĐƯỢC BẰNG MÃ, KHÔNG CHỈ BẰNG MẮT TRÊN CONSOLE.
     *
     * Người gọi sản xuất DUY NHẤT là cron (`startKbSyncScheduler`) và nó **vứt giá trị trả về**.
     * Một nhánh return sớm không cập nhật `lastRunAt`/`lastRunStats` là một lượt **vô hình với mọi
     * câu truy vấn** (`getKbSyncSchedulerStatus()` — thứ Task 6 và mặt sức khoẻ KB sẽ đọc). Báo cáo
     * vòng trước của tôi hứa *"có vết cho Task 6"* trong khi vết đó mới chỉ là một dòng console —
     * đúng lớp "hứa nhiều hơn cơ chế".
     *
     * ⚠ `reason` GIỮ NGUYÊN `"vram_refused"` cho cả hai kết cục (hoãn / quá đáy): nó trả lời
     * *"vì sao lượt này không chạy"*, và câu trả lời đó không đổi. *"Đã hoãn hay đã bỏ"* là một
     * câu hỏi KHÁC và có ô RIÊNG (`defer.exceeded`) — nhồi hai câu hỏi vào một ô là đúng thứ
     * `measureSource` vs `fallbackReason` đã tách ở `types.ts`.
     */
    const stats: KbSyncRunStats = {
      ok: false, exitCode: null, chunksBefore, chunksAfter: chunksBefore, added: 0,
      durationMs: Date.now() - start, skipped: true, reason: "vram_refused",
      ...(defer !== null ? { defer } : {}),
    };
    lastRunAt = new Date();
    lastRunStats = stats;
    return stats;
  }
  // ĐƯỢC CẤP ⇒ chuỗi hoãn (nếu có) kết thúc tại đây. Đặt NGAY SAU lời gọi thành công, không đợi
  // tới cuối hàm: một lượt sync hỏng VÌ LÝ DO KHÁC (hết giờ / spawn lỗi) không phải là lý do để
  // giữ lại một chuỗi hoãn của VRAM — cổng sổ đã cho qua rồi.
  clearKbSyncDefer("granted");

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
  /**
   * ★★★ I-1 (review) — KHÔI PHỤC CHUỖI HOÃN. Không có dòng này thì một lượt thử lại đã hứa
   * **không bao giờ nổ** sau khởi động lại, và trong vòng khởi-động-lại lặp `defer_exceeded`
   * **không bao giờ kêu**. Fire-and-forget có chủ ý: `startKbSyncScheduler()` nằm trên đường boot
   * và **không được** chờ DB; `resumeKbSyncDeferFromLog()` khai KHÔNG BAO GIỜ NÉM và tự bắt hết.
   */
  void resumeKbSyncDeferFromLog();
}

/** Stop the cron job (shutdown). Safe to call when not started. */
export function stopKbSyncScheduler(): void {
  // ⚠ Pha 2B Task 6 — GỠ CẢ HẸN GIỜ HOÃN, không chỉ cron. Một hẹn giờ 15–60 phút còn sống sau khi
  // đã "stopped" sẽ khởi động lại `runKbSyncNow()` ở một tiến trình đang tắt dở. (Nó `.unref()`
  // nên không giữ tiến trình sống, nhưng "không giữ sống" ≠ "không nổ".)
  //
  // ⚠⚠ M-2 (review) — XOÁ CẢ CHUỖI, không chỉ hẹn giờ. Gỡ hẹn giờ mà để lại chuỗi mồ côi khiến
  // `getKbSyncSchedulerStatus().defer` tiếp tục khai `exceeded: false` + `nextRetryAt` ở TƯƠNG LAI
  // + `nextDelayMs: 900000` cho một lượt thử lại **không bao giờ nổ** — mặt trạng thái NÓI DỐI.
  // An toàn vì dòng `defer` vẫn nằm trong `vram_events`: lần khởi động sau đọc lại được (I-1).
  clearKbSyncDefer("shutdown");
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
    /**
     * ★ Pha 2B Task 6 (§5.4) — chuỗi HOÃN đang sống. `null` ⇔ không có chuỗi nào (chưa từng bị từ
     * chối, hoặc lượt gần nhất ĐÃ ĐƯỢC CẤP). Đây là vết máy-đọc-được cho *"vì sao KB đang cũ dần"*,
     * bổ sung cho biển báo `staleDays` vốn chỉ nói *"nó cũ"* chứ không nói *"vì sao"*.
     */
    defer: publicDeferState(),
    // ⚠ M-6 — đường CHỈ-ĐỌC: KHÔNG được tiêu thụ chốt một-lần `deferBudgetWarned`.
    deferBudgetMs: docDayHoanMs(false),
  };
}
