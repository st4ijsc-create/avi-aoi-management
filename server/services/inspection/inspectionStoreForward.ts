/**
 * Doc 27 Đợt 2 / W2-C — INSPECTION INGEST STORE-AND-FORWARD (disk-backed WAL).
 * Gaps C3 (P0) + R11 + C5-partial.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM: `machineApi.submitInspection` (machineApiRouters.ts) inserts the
 * inspection + measurement rows DIRECTLY. If the DB is down/degraded the mutation
 * throws, the machine client gets an error and — depending on the vendor client —
 * the result AND its base64 defect images are lost forever. The existing WAL
 * (server/services/ot/storeForward.ts) only covers `ot_telemetry` rows.
 *
 * FIX (additive, flag-gated): when the submit pipeline fails with a TRANSIENT
 * error (DB unreachable / insert threw — NOT an auth/validation error), the FULL
 * submission payload (incl. inline base64 images) is appended to a durable local
 * WAL (append-only JSONL + in-memory mirror), the machine is ACKed with
 * `{ success:true, queued:true, submissionId }`, and a background worker replays
 * the payload through the SAME pipeline once the DB recovers.
 *
 * IDEMPOTENCY (exactly-once):
 *   • submission key = sha256(machine-identity | serialNumber | inspectionTime |
 *     overallResult | measurementCount). The router stamps `inspectionTime` at
 *     receive-time when the machine omitted it, so the key is stable across a
 *     WAL replay of the same received payload.
 *   • a machine-side retry of the SAME submission while it is queued dedupes
 *     in-memory (queuedKeys) — one WAL entry, one ACK.
 *   • before replaying, the backfill consults (a) the applied-key ledger and
 *     (b) an injected DB existence check (machineId + serialNumber +
 *     inspectionTime on product_inspections) — so a submission that ALSO landed
 *     live (machine retried directly after DB recovery) is never double-inserted.
 *   • a live-path success marks its key applied, guarding the crash-replay case.
 *
 * ── 2026-08-29 (WAL cho cây v2.0, §QĐ-WAL-A) — HAI HỌ KHOÁ, MỘT ĐIỂM ĐIỀU PHỐI ──
 * The formula above collides on v2.0 tree payloads: `serialNumber` empty is a
 * VALID shape in v2.0 ("empty if the machine hasn't scanned yet") and v2.0
 * carries `surfaces` — never `measurements` — so `measurementCount` is always 0.
 * Two GENUINELY DIFFERENT v2.0 boards, same station, same `inspectionTime`, both
 * empty serial ⇒ SAME key with this formula ⇒ the second board would be silently
 * swallowed as a "duplicate". `bufferSubmission`/`restoreInspectionWal` therefore
 * never call `computeSubmissionKey` directly — they go through
 * `dungKhoaGuiTheoHinhDang`, which dispatches BY SHAPE (`laHinhDangCayV2`, not the
 * optional `schemaVersion` field): v2.0 payloads key off `dungKhoaKhuTrungV2()`
 * (`server/contracts/machineDataContract.ts` — identity+productId+startedAt, not
 * serial-dependent); v1.x payloads keep this exact formula, unchanged.
 * `submitInspectionTreeV2` (`machineApiRouters.ts`) now also buffers on a
 * TRANSIENT failure and ACKs `{success:true, queued:true, submissionId}`, same
 * contract as the v1.x path below.
 *
 * ── 2026-08-29 (WAL cho cây v2.0, Task 2, §QĐ-WAL-B) — PHÁT LẠI ĐÚNG ĐƯỜNG ──────────
 * `ensureInspectionWalWired` (`machineApiRouters.ts`) nay CŨNG dispatch theo hình dạng
 * (`laHinhDangCayV2`, cùng vị từ mà `dungKhoaGuiTheoHinhDang` dùng ở trên): payload cây
 * v2.0 phát lại qua `submitInspectionTreeV2` (dichCayKetQua → persistInspectionAtomic
 * với `opts.cay`) — CHUỖI RIÊNG của nó, KHÔNG bị ép qua `processInspectionSubmission`
 * (đường v1.x — không hiểu `surfaces`, sẽ ghi được header rồi ÂM THẦM bỏ mất cả ba cấp
 * cây). Đây là gốc rễ đã đóng — TRƯỚC bản vá này một mục v2.0 xếp hàng thành công
 * (§QĐ-WAL-A) vẫn KHÔNG rút được: nó nằm an toàn trên đĩa (không mất) nhưng phát lại
 * qua v1.x cứ ghi thiếu mãi. Dedup khi phát lại cũng theo hình dạng:
 * `inspectionAlreadyPersistedV2` (machineApiRouters.ts) tra bảng LEDGER
 * `inspection_idempotency_keys` theo `dungKhoaKhuTrungV2()` — v1.x giữ nguyên
 * `inspectionAlreadyPersisted` (machineId+serialNumber+inspectionTime).
 *
 * BOUNDS (never grow unbounded, never drop silently): max entries + max age +
 * max bytes; on overflow the OLDEST entries are dropped — counted + warned.
 * PERMANENTLY invalid payloads (auth/validation TRPCErrors, Postgres 22xxx data-
 * exception / 23xxx constraint-violation on replay — `isPermanentSubmitError`,
 * BG-40) go to a dead-letter JSONL file instead of poisoning the queue.
 *
 * ── 2026-08-29 (BG-40 ⛔) — TRẦN `attempts` + BỎ CHẶN-ĐẦU-HÀNG ────────────────────
 * Hai lỗ mà bản vá này đóng, CẢ HAI đều nằm bên trong lời hứa BOUNDS ở trên:
 *   • `isPermanentSubmitError` TRƯỚC ĐÂY chỉ nhận `TRPCError` — mọi lỗi Postgres
 *     (kể cả `22001`/`23505`, không-retry-được) rơi vào nhánh TẠM THỜI, khiến câu
 *     "never drop silently" đúng NGHĨA ĐEN nhưng không đúng THỰC TẾ: mục đó không
 *     bị vứt, nhưng cũng không bao giờ rút được — nằm chờ 72h.
 *   • `backfillInspections` `break` thoát CẢ VÒNG khi gặp lỗi tạm thời ở ĐẦU hàng
 *     ⇒ một mục kẹt (dù xếp đúng hay xếp nhầm) chặn đứng MỌI mục lành xếp sau nó
 *     (đo THẬT: 1 bo độc + 4 bo lành, 20 lượt rút ⇒ `drained=0` cả 20 lượt).
 * Sửa: (1) mở rộng phân loại sang lớp SQLSTATE 22xxx/23xxx (không đụng ranh giới
 * kết nối/timeout — vẫn TẠM THỜI, chống mất bo khi DB chỉ chớp nháy); (2) TRẦN
 * `INSPECTION_STORE_FORWARD_MAX_ATTEMPTS` (mặc định 20) — vượt trần ⇒ dead-letter
 * CÓ GHI NHẬN thay vì chờ evictAged/evictBounds vứt câm; (3) vòng rút quét THEO CHỈ
 * SỐ thay vì neo `queue[0]` — một mục tạm-thời-lỗi bị bỏ qua trong CÙNG lượt (không
 * `break`), các mục lành phía sau vẫn được thử, ngân sách `drainBatch()` có sẵn vẫn
 * chặn trần tổng công việc mỗi tick. Chi tiết + lưới chứng minh:
 * `inspectionStoreForwardKhongChanDauHang.test.ts`.
 *
 * HONESTY: with the flag OFF every entry point is a no-op → behaviour is exactly
 * as before (throw on DB failure). The process/dedup functions are INJECTED so
 * tests exercise buffer/backfill/idempotency without a live DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
// Doc 2026-08-29 (WAL cho cây v2.0, §QĐ-WAL-A) — khoá gửi RIÊNG cho payload hình dạng
// cây v2.0 + vị từ nhận diện hình dạng. Cả hai sống ở module hợp đồng LÁ
// (`server/contracts/machineDataContract.ts`, KHÔNG import gì từ `routers/`), nên import
// TĨNH ở đây không tạo vòng với `machineApiRouters.ts` (file đó import NGƯỢC LẠI từ module
// này ở cấp module — xem `dungKhoaGuiTheoHinhDang` bên dưới để hiểu VÌ SAO không đặt điều
// phối khoá ở `machineApiRouters.ts`).
import { dungKhoaKhuTrungV2, laHinhDangCayV2 } from "../../contracts/machineDataContract";
import type { MachineDataContractV2 } from "../../contracts/machineDataContractV2";

/**
 * The buffered payload is the raw `submitInspection` input (plus the resolved
 * credential when the machine authenticated via Authorization header). Kept
 * structurally typed here to avoid a value-level import cycle with the router.
 *
 * 2026-08-29 (WAL cho cây v2.0) — this ALSO stands in for a v2.0 tree payload
 * (`MachineDataContractV2`): it has no `measurements` (index signature absorbs
 * its `surfaces`/`identity`/`productId` instead) and `serialNumber`/`overallResult`
 * are both present, just narrower-typed (`overallResult: "OK"|"NG"`, no "NTF").
 * Structural compatibility is intentional — see `dungKhoaGuiTheoHinhDang` below.
 */
export interface BufferedSubmission {
  machineCode?: string;
  apiKey?: string;
  serialNumber: string;
  inspectionTime?: string;
  overallResult: string;
  measurements?: unknown[];
  [key: string]: unknown;
}

// ── flag ────────────────────────────────────────────────────────────────────

/**
 * Read at call time so config toggles / tests take effect. Dedicated flag with
 * fallback to the OT store-forward master switch (one "production profile"
 * switch covers both durability layers — doc 27 §11 hạng mục 2.3).
 */
export function inspectionStoreForwardEnabled(): boolean {
  const own = process.env.INSPECTION_STORE_FORWARD_ENABLED;
  if (own === "true" || own === "1") return true;
  if (own === "false" || own === "0") return false;
  return (
    process.env.OT_STORE_FORWARD_ENABLED === "true" ||
    process.env.OT_STORE_FORWARD_ENABLED === "1"
  );
}

// ── config (env-driven; honest defaults) ────────────────────────────────────

function walFile(): string {
  const p = process.env.INSPECTION_STORE_FORWARD_FILE?.trim();
  return path.resolve(p && p.length > 0 ? p : "./data/inspection-store-forward.jsonl");
}

function deadLetterFile(): string {
  return walFile().replace(/\.jsonl$/, "") + ".dead.jsonl";
}

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max buffered entries before the OLDEST are dropped (counted, never silent). */
function maxEntries(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX", 20000);
}

/** Max age (ms) an entry may live before it is dropped on the next sweep. 72h default. */
function maxAgeMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_AGE_MS", 72 * 60 * 60 * 1000);
}

/** Max approximate WAL bytes (payloads carry base64 images). 512 MiB default. */
function maxBytes(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_BYTES", 512 * 1024 * 1024);
}

/** How many entries to replay per backfill call (bounded work per attempt). */
function drainBatch(): number {
  return envInt("INSPECTION_STORE_FORWARD_DRAIN_BATCH", 50);
}

/**
 * BG-40 việc 2 — TRẦN số lần thử phát lại TẠM THỜI trước khi một mục bị chuyển
 * dead-letter thay vì đệm vô thời hạn. TRƯỚC bản vá này, `attempts` chỉ được GHI và
 * ĐỌC để in log — không nơi nào so với ngưỡng; lối thoát DUY NHẤT cho một mục kẹt là
 * `evictAged` (72h) hoặc `evictBounds` (tràn 20.000 mục/512 MiB) — cả hai đều VỨT mục,
 * không ghi nhận lý do. Mặc định 20 lượt: với interval nền 15s lùi-mũ tới trần 5 phút
 * (`baseIntervalMs`/`maxIntervalMs`), 20 lượt thất bại LIÊN TỤC tương ứng khoảng một
 * đến vài giờ DB gián đoạn thật — đủ xa một "chớp nháy" (1-3 lượt) để không giết oan
 * một mục đang chờ DB hồi phục, nhưng xa DƯỚI 72h để không phải chờ tới lúc evictAged
 * mới biết mục đó có vấn đề thật.
 */
function maxSubmitAttempts(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_ATTEMPTS", 20);
}

/** Warn loudly when the queue depth reaches this (repeated at most every 5 min). */
function alertDepth(): number {
  return envInt("INSPECTION_STORE_FORWARD_ALERT_DEPTH", 500);
}

// ── WAL state (in-memory queue is source of truth; file mirror for restart) ──

interface WalEntry {
  /** Idempotency key (see computeSubmissionKey). */
  key: string;
  enqueuedAt: number;
  /** Số lần phát lại TẠM THỜI thất bại — vượt `maxSubmitAttempts()` ⇒ dead-letter
   * thay vì tiếp tục đệm (BG-40 việc 2). */
  attempts: number;
  /** Approximate serialized size (for the byte bound). */
  bytes: number;
  payload: BufferedSubmission;
}

const queue: WalEntry[] = [];
const queuedKeys = new Set<string>();
let queueBytes = 0;

/** Keys CONFIRMED persisted (live path or backfill). Bounded FIFO ledger. */
const appliedKeys = new Set<string>();
const appliedOrder: string[] = [];
const APPLIED_LEDGER_MAX = 100000;

// ── honest metrics ───────────────────────────────────────────────────────────

export interface InspectionStoreForwardMetrics {
  buffered: number;
  backfilled: number;
  deduped: number;
  deadLettered: number;
  droppedOverflow: number;
  droppedAge: number;
  droppedBytes: number;
  lastBackfillAt: string | null;
  lastBufferedAt: string | null;
}

const metrics: InspectionStoreForwardMetrics = {
  buffered: 0,
  backfilled: 0,
  deduped: 0,
  deadLettered: 0,
  droppedOverflow: 0,
  droppedAge: 0,
  droppedBytes: 0,
  lastBackfillAt: null,
  lastBufferedAt: null,
};

// ── injected pipeline (router wires the real submit path; tests mock it) ─────

/** Re-run the FULL submit pipeline for a buffered payload. Throws on failure. */
export type ProcessFn = (payload: BufferedSubmission) => Promise<{ inspectionId: number }>;
/** Return true when this submission ALREADY has a persisted inspection row. */
export type DedupFn = (payload: BufferedSubmission) => Promise<boolean>;

let processFn: ProcessFn = async () => {
  throw new Error("[InspectionSF] process fn not wired (call setProcessFn)");
};
let dedupFn: DedupFn = async () => false;

export function setProcessFn(fn: ProcessFn): void {
  processFn = fn;
}
export function setDedupFn(fn: DedupFn): void {
  dedupFn = fn;
}

// ── idempotency key ──────────────────────────────────────────────────────────

/**
 * submission id = machine identity + serial + timestamp hash (doc 27 W2-C).
 * The raw apiKey never appears in the key — only a sha256 fingerprint prefix.
 * overallResult + measurement count are folded in as a collision guard for
 * clients that omit inspectionTime on two different boards of the same serial.
 */
export function computeSubmissionKey(payload: BufferedSubmission): string {
  const machineIdentity = payload.machineCode?.trim()
    ? `mc:${payload.machineCode.trim()}`
    : payload.apiKey
      ? `ak:${createHash("sha256").update(payload.apiKey).digest("hex").slice(0, 16)}`
      : "anon";
  const material = [
    machineIdentity,
    payload.serialNumber ?? "",
    payload.inspectionTime ?? "",
    payload.overallResult ?? "",
    String(Array.isArray(payload.measurements) ? payload.measurements.length : 0),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

/**
 * §QĐ-WAL-A (`docs/superpowers/plans/2026-08-29-aoi-wal-cho-cay-v2.md`) — điều phối
 * khoá gửi THEO HÌNH DẠNG payload (`laHinhDangCayV2`), KHÔNG theo trường `schemaVersion`
 * khai báo (trường đó `optional()` — máy có thể không gửi, xem doc-comment tại chỗ khai
 * `laHinhDangCayV2`).
 *
 * `computeSubmissionKey` (ngay phía trên) băm `serialNumber | inspectionTime |
 * overallResult | measurements.length`. HAI thành phần cuối là hàng rào chống đụng độ
 * cho client bỏ trống `inspectionTime` — nhưng hàng rào đó KHÔNG chắn được payload
 * v2.0: `serialNumber` RỖNG là HỢP LỆ ở v2.0 (tài liệu máy: "rỗng nếu máy chưa gửi"),
 * và payload v2.0 mang `surfaces` — KHÔNG có `measurements` ⇒ `measurements.length`
 * luôn là 0. ⇒ Hai bo v2.0 KHÁC NHAU, cùng trạm, cùng `inspectionTime`, cả hai serial
 * rỗng, cùng `overallResult` ⇒ TRÙNG KHOÁ theo công thức v1 ⇒ WAL nuốt bo thứ hai và
 * coi là bản sao — MẤT DỮ LIỆU do chính cơ chế chống mất dữ liệu (chứng minh live bằng
 * ca đỏ/xanh ở `walCayV2.test.ts`, không suy đoán từ đọc mã).
 *
 * Payload v2.0 dùng `dungKhoaKhuTrungV2()` (`server/contracts/machineDataContract.ts`)
 * — dựng từ `identity` (7 trường BẮT BUỘC) + `productId` + `startedAt`, KHÔNG phụ thuộc
 * serial, đã chứng minh tất định + không đụng độ ranh giới trường (Pha 1C Task 2, lưới
 * `server/db/ingestV2KhuTrung.db.test.ts`). Payload v1.x GIỮ NGUYÊN `computeSubmissionKey`
 * — chống hồi quy, đường cũ không đổi hành vi (mệnh đề 3, task-1-brief.md).
 *
 * Gọi TỪ bên trong `bufferSubmission`/`restoreInspectionWal` (không phải tại nơi gọi) để
 * MỌI đường enqueue — kể cả restore từ file WAL sau khi restart — cùng dùng đúng MỘT
 * điểm quyết định, không thể vô tình gọi `computeSubmissionKey` trực tiếp cho payload v2.0.
 */
export function dungKhoaGuiTheoHinhDang(payload: BufferedSubmission): string {
  if (laHinhDangCayV2(payload)) {
    return dungKhoaKhuTrungV2(payload as unknown as MachineDataContractV2);
  }
  return computeSubmissionKey(payload);
}

// ── error classification (transient → buffer; permanent → throw/dead-letter) ─

const PERMANENT_TRPC_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
]);

/**
 * ── 2026-08-29 (BG-40 ⛔) — LỚP SQLSTATE KHÔNG-RETRY-ĐƯỢC ─────────────────────────
 * TRƯỚC bản vá này, `isPermanentSubmitError` chỉ nhận diện `TRPCError` — MỌI lỗi
 * Postgres (kể cả `22001` chuỗi quá dài, `23505` vi phạm ràng buộc) rơi vào nhánh
 * TRANSIENT ⇒ nằm đệm mãi mãi, máy nhận `{success:true, queued:true}` và không bao
 * giờ gửi lại. Đo THẬT trên mã cũ (1 bo độc code=22001 + 4 bo lành, 20 lượt rút):
 * `drained=0` ở CẢ 20 lượt — 4 bo lành không được thử lấy một lần (xem
 * `inspectionStoreForwardKhongChanDauHang.test.ts`).
 *
 * Hai lớp SQLSTATE dưới đây KHÔNG BAO GIỜ thành công khi thử lại NGUYÊN VĂN payload:
 *   22xxx — data exception (chuỗi quá dài, sai kiểu, tràn số…)
 *   23xxx — integrity constraint violation (unique/FK/not-null/check…)
 * ⚠ CHỐNG SIẾT QUÁ (mệnh đề 2, task-1-brief.md): lỗi kết nối/timeout dùng SQLSTATE
 * lớp KHÁC hẳn — 08xxx (connection exception), 53xxx (insufficient resources),
 * 57Pxx (admin shutdown / cannot connect now) — hoặc hoàn toàn KHÔNG có SQLSTATE
 * (`ECONNREFUSED`/`ETIMEDOUT` là mã lỗi của Node, không phải Postgres). Không cái
 * nào khớp `/^(22|23)/` ⇒ vẫn TRANSIENT. Xếp nhầm một kết nối chớp nháy thành "vĩnh
 * viễn" là MẤT BO — đúng thứ WAL này sinh ra để chống, nên biên này KHÔNG được nới.
 */
const PERMANENT_SQLSTATE_PREFIX = /^(22|23)\d{3}$/;

/**
 * Đi bộ err → err.cause → ... tìm SQLSTATE lớp 22xxx/23xxx. postgres.js đặt `code`
 * THẲNG trên lỗi driver thô; drizzle-orm ≥0.44 bọc trong `DrizzleQueryError` (message
 * bắt đầu "Failed query: ...") mang mã thật ở `.cause` — CÙNG kiểu đi bộ với
 * `isUniqueViolation`/`isMissingTable`/`isMissingColumn` (`server/_core/dbErrors.ts`),
 * không chế lại một lần nữa.
 */
function isPermanentDbSqlState(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") break;
    const e = current as { code?: unknown; cause?: unknown };
    if (typeof e.code === "string" && PERMANENT_SQLSTATE_PREFIX.test(e.code)) return true;
    current = e.cause;
  }
  return false;
}

/**
 * A PERMANENT error means retrying the same payload can never succeed
 * (bad credentials / validation / Postgres 22xxx data-exception / 23xxx
 * constraint-violation) — it must be surfaced to the caller (live path) or
 * dead-lettered (replay), never left in the queue. Everything else (connection
 * errors, timeouts, TRPC INTERNAL_SERVER_ERROR) is TRANSIENT.
 */
export function isPermanentSubmitError(err: unknown): boolean {
  if (err instanceof TRPCError && PERMANENT_TRPC_CODES.has(err.code)) return true;
  return isPermanentDbSqlState(err);
}

// ── file mirror (append-only JSONL rewrite; memory is the truth) ─────────────

let fileDirty = false;

function entryToLine(e: WalEntry): string {
  return JSON.stringify({ key: e.key, enqueuedAt: e.enqueuedAt, attempts: e.attempts, payload: e.payload });
}

async function flushFile(): Promise<void> {
  if (!fileDirty) return;
  fileDirty = false;
  const file = walFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lines = queue.map(entryToLine).join("\n");
    await fs.writeFile(file, lines.length ? lines + "\n" : "", "utf8");
  } catch (err) {
    fileDirty = true; // retry on next flush; memory remains the source of truth
    console.warn("[InspectionSF] WAL file flush failed:", (err as Error)?.message || err);
  }
}

/** Restore the buffer from the WAL file mirror (call once on process start). */
export async function restoreInspectionWal(): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(walFile(), "utf8");
  } catch {
    return queue.length; // no file yet
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as { key?: string; enqueuedAt?: number; attempts?: number; payload?: BufferedSubmission };
      if (!parsed.payload) continue;
      const key =
        typeof parsed.key === "string" ? parsed.key : dungKhoaGuiTheoHinhDang(parsed.payload);
      if (queuedKeys.has(key) || appliedKeys.has(key)) continue;
      const bytes = t.length;
      queue.push({ key, enqueuedAt: parsed.enqueuedAt ?? Date.now(), attempts: parsed.attempts ?? 0, bytes, payload: parsed.payload });
      queuedKeys.add(key);
      queueBytes += bytes;
    } catch {
      /* skip corrupt line */
    }
  }
  if (queue.length > 0) {
    console.warn(`[InspectionSF] restored ${queue.length} buffered inspection submission(s) from WAL`);
  }
  return queue.length;
}

// ── applied ledger ────────────────────────────────────────────────────────────

export function markSubmissionApplied(key: string): void {
  if (appliedKeys.has(key)) return;
  appliedKeys.add(key);
  appliedOrder.push(key);
  if (appliedOrder.length > APPLIED_LEDGER_MAX) {
    const evict = appliedOrder.splice(0, appliedOrder.length - APPLIED_LEDGER_MAX);
    for (const k of evict) appliedKeys.delete(k);
  }
}

export function isSubmissionQueuedOrApplied(key: string): boolean {
  return queuedKeys.has(key) || appliedKeys.has(key);
}

// ── eviction (bounded, counted, warned — never silent) ───────────────────────

function dropFront(reason: "age" | "overflow" | "bytes"): void {
  const e = queue.shift();
  if (!e) return;
  queuedKeys.delete(e.key);
  queueBytes -= e.bytes;
  fileDirty = true;
  if (reason === "age") metrics.droppedAge += 1;
  else if (reason === "overflow") metrics.droppedOverflow += 1;
  else metrics.droppedBytes += 1;
}

function evictAged(): void {
  const cutoff = Date.now() - maxAgeMs();
  let dropped = 0;
  while (queue.length > 0 && queue[0].enqueuedAt < cutoff) {
    dropFront("age");
    dropped += 1;
  }
  if (dropped > 0) {
    console.warn(`[InspectionSF] dropped ${dropped} submission(s) past max age (total aged-drop=${metrics.droppedAge})`);
  }
}

function evictBounds(): void {
  let dropped = 0;
  while (queue.length > maxEntries()) {
    dropFront("overflow");
    dropped += 1;
  }
  let droppedBytes = 0;
  while (queue.length > 1 && queueBytes > maxBytes()) {
    dropFront("bytes");
    droppedBytes += 1;
  }
  if (dropped > 0 || droppedBytes > 0) {
    console.warn(
      `[InspectionSF] BUFFER OVERFLOW — dropped ${dropped + droppedBytes} oldest submission(s) ` +
        `(cap=${maxEntries()} entries / ${maxBytes()} bytes; total overflow-drop=${metrics.droppedOverflow + metrics.droppedBytes})`,
    );
  }
}

let lastDepthAlertAt = 0;

function maybeAlertDepth(): void {
  if (queue.length < alertDepth()) return;
  const now = Date.now();
  if (now - lastDepthAlertAt < 5 * 60 * 1000) return;
  lastDepthAlertAt = now;
  console.error(
    `[InspectionSF] ALERT — inspection WAL depth ${queue.length} ≥ ${alertDepth()} ` +
      `(bytes≈${queueBytes}). DB has been unreachable for a while; investigate before the buffer bounds evict data.`,
  );
}

// ── enqueue ───────────────────────────────────────────────────────────────────

/**
 * Buffer a submission that could not be persisted. Idempotent: a payload whose
 * key is already queued (machine-side retry while DB is down) or already applied
 * returns `duplicate: true` without a second entry. No-op when the flag is off.
 */
export async function bufferSubmission(
  payload: BufferedSubmission,
): Promise<{ buffered: boolean; duplicate: boolean; key: string }> {
  const key = dungKhoaGuiTheoHinhDang(payload);
  if (!inspectionStoreForwardEnabled()) return { buffered: false, duplicate: false, key };
  evictAged();
  if (queuedKeys.has(key) || appliedKeys.has(key)) {
    return { buffered: false, duplicate: true, key };
  }
  const line = JSON.stringify({ key, enqueuedAt: Date.now(), attempts: 0, payload });
  const entry: WalEntry = { key, enqueuedAt: Date.now(), attempts: 0, bytes: line.length, payload };
  queue.push(entry);
  queuedKeys.add(key);
  queueBytes += entry.bytes;
  metrics.buffered += 1;
  metrics.lastBufferedAt = new Date().toISOString();
  fileDirty = true;
  evictBounds();
  await flushFile();
  const stillQueued = queuedKeys.has(key);
  console.warn(
    `[InspectionSF] buffered inspection submission (serial=${payload.serialNumber}, key=${key.slice(0, 12)}…); ` +
      `queue=${queue.length} bytes≈${queueBytes}${stillQueued ? "" : " (immediately evicted by bounds!)"}`,
  );
  maybeAlertDepth();
  return { buffered: stillQueued, duplicate: false, key };
}

// ── dead-letter ───────────────────────────────────────────────────────────────

async function deadLetter(entry: WalEntry, err: unknown): Promise<void> {
  metrics.deadLettered += 1;
  const line = JSON.stringify({
    key: entry.key,
    deadAt: new Date().toISOString(),
    attempts: entry.attempts,
    error: err instanceof Error ? `${(err as TRPCError).code ?? err.name}: ${err.message}` : String(err),
    payload: entry.payload,
  });
  try {
    await fs.mkdir(path.dirname(deadLetterFile()), { recursive: true });
    await fs.appendFile(deadLetterFile(), line + "\n", "utf8");
  } catch (e) {
    console.error("[InspectionSF] dead-letter append failed:", (e as Error)?.message || e);
  }
  console.error(
    `[InspectionSF] DEAD-LETTERED submission ${entry.key.slice(0, 12)}… (serial=${entry.payload.serialNumber}): ` +
      `${err instanceof Error ? err.message : err} → ${deadLetterFile()}`,
  );
}

// ── backfill (replay oldest-first through the real pipeline, idempotent) ─────

let draining = false;

export async function backfillInspections(): Promise<{
  enabled: boolean;
  drained: number;
  deduped: number;
  deadLettered: number;
  remaining: number;
}> {
  if (!inspectionStoreForwardEnabled()) {
    return { enabled: false, drained: 0, deduped: 0, deadLettered: 0, remaining: queue.length };
  }
  if (draining) {
    return { enabled: true, drained: 0, deduped: 0, deadLettered: 0, remaining: queue.length };
  }
  draining = true;
  evictAged();
  let drained = 0;
  let deduped = 0;
  let deadLettered = 0;
  try {
    let budget = drainBatch();
    // ── BG-40 việc 3 — quét THEO CHỈ SỐ, không neo cứng vào queue[0] ─────────────
    // TRƯỚC bản vá: một mục TẠM THỜI ở đầu hàng `break` thoát CẢ VÒNG — đo THẬT (1 bo
    // độc + 4 bo lành, 20 lượt rút) cho `drained=0` cả 20 lượt, 4 bo lành không được
    // thử lấy một lần (xem `inspectionStoreForwardKhongChanDauHang.test.ts`).
    // Mục thành công/dead-letter bị `removeAt` splice khỏi mảng (mục kế thừa TỰ trượt
    // vào đúng chỉ số `i`, KHÔNG tăng `i`); mục còn tạm-thời-lỗi ở lại tại chỗ và `i`
    // tăng lên để thử mục kế tiếp NGAY trong cùng lượt — thay vì chờ tick sau.
    // `budget` (=`drainBatch()`, đã có sẵn cho mục đích "bounded work per attempt")
    // vẫn giảm ở MỌI nhánh (thành công, dead-letter, HAY tạm-thời) nên tổng số lần
    // gọi `processFn` mỗi lượt bị chặn trần — kể cả khi CẢ HÀNG đang lỗi tạm thời
    // (DB sập thật): tối đa `drainBatch()` (mặc định 50) lần gọi mỗi tick, KHÔNG quét
    // vô hạn toàn bộ hàng đợi mỗi lần — đây là câu trả lời cho cảnh báo "lãng phí" ở
    // task-1-brief.md mục 3: phí tổn bị chặn trần bởi đúng ngân sách đã tồn tại sẵn
    // cho mục đích khác, không phải cơ chế mới; và interval nền lùi-mũ (workerTick)
    // càng làm phí tổn đó thưa dần khi KHÔNG mục nào rút được nhiều tick liên tiếp.
    //
    // (b) DB existence dedupe vẫn `break` khi CHÍNH lời gọi `dedupFn` (không phải
    // `processFn`) ném lỗi — đó là phép kiểm tra tồn tại chạm DB TRỰC TIẾP, nên lỗi ở
    // đây là tín hiệu "kết nối DB tự nó đang hỏng" DÙNG CHUNG cho mọi mục còn lại
    // trong tick này (không phải lỗi riêng của một payload) — dừng sớm ở đây vẫn là
    // tối ưu hợp lý, KHÔNG phải chặn-đầu-hàng (mục nó chặn không phải "mục lành xếp
    // sau", mà là chính DB không trả lời được).
    let i = 0;
    while (i < queue.length && budget > 0) {
      const entry = queue[i];

      // (a) ledger dedupe — live path already persisted it (or a prior replay did).
      if (appliedKeys.has(entry.key)) {
        removeAt(i, entry);
        deduped += 1;
        continue;
      }

      // (b) DB existence dedupe — the machine retried directly after recovery,
      // or a crash happened between insert-confirm and ledger update.
      let exists = false;
      try {
        exists = await dedupFn(entry.payload);
      } catch {
        // dedup check needs the DB — if it fails, the DB is still down. Stop.
        break;
      }
      if (exists) {
        markSubmissionApplied(entry.key);
        removeAt(i, entry);
        deduped += 1;
        continue;
      }

      try {
        await processFn(entry.payload);
      } catch (err) {
        if (isPermanentSubmitError(err)) {
          await deadLetter(entry, err);
          removeAt(i, entry);
          deadLettered += 1;
          budget -= 1;
          continue;
        }

        entry.attempts += 1;
        fileDirty = true;

        // BG-40 việc 2 — vượt TRẦN số lần thử ⇒ dead-letter CÓ GHI NHẬN, không tiếp
        // tục đệm vô thời hạn chờ evictAged (72h)/evictBounds (tràn) vứt câm.
        if (entry.attempts >= maxSubmitAttempts()) {
          console.warn(
            `[InspectionSF] mục VƯỢT TRẦN ${maxSubmitAttempts()} lần thử (key=${entry.key.slice(0, 12)}…, ` +
              `serial=${entry.payload.serialNumber}) — chuyển dead-letter thay vì đệm vô thời hạn`,
          );
          await deadLetter(
            entry,
            new Error(
              `vượt trần ${maxSubmitAttempts()} lần thử phát lại — lỗi gần nhất: ${(err as Error)?.message || err}`,
            ),
          );
          removeAt(i, entry);
          deadLettered += 1;
          budget -= 1;
          continue;
        }

        // Vẫn tạm thời và CHƯA vượt trần → giữ nguyên trong hàng đợi, nhưng KHÔNG
        // `break` cả vòng (BG-40 việc 3): thử mục kế tiếp trong CÙNG lượt rút thay vì
        // để một mục lỗi (thật hoặc xếp nhầm) chặn đứng mọi mục lành xếp sau nó.
        console.warn(
          `[InspectionSF] backfill still failing (attempt ${entry.attempts}, key=${entry.key.slice(0, 12)}…): ` +
            `${(err as Error)?.message || err} — giữ trong hàng đợi, thử mục kế tiếp (không chặn đầu hàng)`,
        );
        budget -= 1;
        i += 1;
        continue;
      }

      markSubmissionApplied(entry.key);
      removeAt(i, entry);
      drained += 1;
      budget -= 1;
    }
  } finally {
    draining = false;
  }

  if (drained > 0) {
    metrics.backfilled += drained;
    metrics.lastBackfillAt = new Date().toISOString();
  }
  if (deduped > 0) metrics.deduped += deduped;
  if (drained > 0 || deduped > 0 || deadLettered > 0) {
    await flushFile();
    console.log(
      `[InspectionSF] backfilled ${drained} submission(s) (${deduped} deduped, ${deadLettered} dead-lettered); queue=${queue.length}`,
    );
  } else {
    await flushFile(); // persist attempt counters
  }
  return { enabled: true, drained, deduped, deadLettered, remaining: queue.length };
}

/**
 * Gỡ mục tại chỉ số `i` khỏi hàng đợi (BG-40 việc 3 — thay `removeHead`/`queue.shift()`
 * vì vòng rút nay quét theo chỉ số, không neo cứng vào đầu mảng). `splice` giữ nguyên
 * thứ tự tương đối của các mục còn lại — mục kế thừa tự trượt vào đúng chỉ số `i`.
 */
function removeAt(i: number, expected: WalEntry): void {
  if (queue[i] !== expected) return; // phòng thủ — không xảy ra khi rút đơn luồng
  queue.splice(i, 1);
  queuedKeys.delete(expected.key);
  queueBytes -= expected.bytes;
  fileDirty = true;
}

// ── background worker (interval + exponential backoff while the DB is down) ──

let workerTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;

function baseIntervalMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_INTERVAL_MS", 15000);
}
function maxIntervalMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_INTERVAL_MS", 5 * 60 * 1000);
}

async function workerTick(): Promise<void> {
  workerTimer = null;
  try {
    const r = await backfillInspections();
    // Backoff only while there IS work that cannot drain (DB still down).
    consecutiveFailures = r.remaining > 0 && r.drained === 0 && r.deduped === 0 && r.deadLettered === 0
      ? consecutiveFailures + 1
      : 0;
  } catch (err) {
    consecutiveFailures += 1;
    console.warn("[InspectionSF] backfill worker tick failed:", (err as Error)?.message || err);
  }
  scheduleNext();
}

function scheduleNext(): void {
  if (workerTimer) return;
  const delay = Math.min(baseIntervalMs() * Math.pow(2, Math.min(consecutiveFailures, 6)), maxIntervalMs());
  workerTimer = setTimeout(() => void workerTick(), delay);
  workerTimer.unref?.();
}

/** Start the periodic backfill worker (idempotent; no-op when the flag is off). */
export function startInspectionBackfillWorker(): void {
  if (!inspectionStoreForwardEnabled() || workerTimer) return;
  scheduleNext();
  console.log(
    `[InspectionSF] backfill worker started (interval=${baseIntervalMs()}ms, WAL=${walFile()}, ` +
      `bounds=${maxEntries()} entries/${maxBytes()} bytes/${maxAgeMs()}ms)`,
  );
}

export function stopInspectionBackfillWorker(): void {
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
}

/**
 * One-call startup init (wired from server bootstrap): binds the REAL submit
 * pipeline + dedup check (dynamic import → no module-load cycle), restores the
 * WAL from disk, starts the worker. Safe no-op when the flag is off.
 *
 * ── 2026-08-29 (WAL cho cây v2.0, Task 3 hotfix) — GỌI CHUNG `ensureInspectionWalWired`,
 * KHÔNG TỰ CHÉP LẠI PHÉP DISPATCH ─────────────────────────────────────────────────────────
 * TRƯỚC bản vá này, hàm này tự `setProcessFn`/`setDedupFn` thẳng vào
 * `processInspectionSubmission`/`inspectionAlreadyPersisted` (v1.x CỨNG) — một BẢN THỨ HAI của
 * phép dispatch, độc lập với `ensureInspectionWalWired` (`machineApiRouters.ts`, dispatch THEO
 * HÌNH DẠNG mà Task 2 dựng cho đường LIVE). Vì hàm này chạy Ở BOOT — TRƯỚC bất kỳ lượt
 * `submitInspection` LIVE nào (lượt live là nơi DUY NHẤT trước đây gọi
 * `ensureInspectionWalWired`) — một mục v2.0 còn trên đĩa từ trước khi khởi động lại có thể bị
 * `backfillInspections()` rút qua ĐÚNG đường v1.x này TRƯỚC KHI có lượt live nào kịp rewire lại
 * cho đúng: ghi được header rồi ÂM THẦM bỏ mất cả ba cấp cây — TÁI DIỄN đúng lớp lỗi §QĐ-WAL-B
 * (Task 2 đã đóng ở đường live) qua cửa BOOT. `.env` của repo này đặt
 * `INSPECTION_STORE_FORWARD_ENABLED=true` — không phải rủi ro chỉ-trên-giấy (phát hiện bởi
 * `ghiInspectionWalScan.ts`/`ghiInspectionWalCensus.test.ts`, Task 3).
 *
 * Sửa bằng cách gọi THẲNG `ensureInspectionWalWired()` (nay export) — MỘT điểm điều phối duy
 * nhất cho CẢ HAI đường (boot và live), đúng kỷ luật đã nêu ở docblock của hàm đó. Mệnh đề BOOT
 * (không gọi live trước khi gọi hàm này) canh ở `server/db/walCayV2PhatLai.db.test.ts`.
 */
export async function initInspectionStoreForward(): Promise<void> {
  if (!inspectionStoreForwardEnabled()) return;
  const router = await import("../../routers/machineApiRouters");
  router.ensureInspectionWalWired();
  await restoreInspectionWal();
  startInspectionBackfillWorker();
}

// ── status ────────────────────────────────────────────────────────────────────

export interface InspectionStoreForwardStatus extends InspectionStoreForwardMetrics {
  enabled: boolean;
  bufferedCount: number;
  bufferedBytes: number;
  maxEntries: number;
  maxAgeMs: number;
  maxBytes: number;
  /** BG-40 việc 2 — trần số lần thử phát lại trước dead-letter. */
  maxAttempts: number;
  walFile: string;
  deadLetterFile: string;
}

export function getInspectionStoreForwardStatus(): InspectionStoreForwardStatus {
  return {
    enabled: inspectionStoreForwardEnabled(),
    bufferedCount: queue.length,
    bufferedBytes: queueBytes,
    maxEntries: maxEntries(),
    maxAgeMs: maxAgeMs(),
    maxBytes: maxBytes(),
    maxAttempts: maxSubmitAttempts(),
    walFile: walFile(),
    deadLetterFile: deadLetterFile(),
    ...metrics,
  };
}

export function bufferedInspectionCount(): number {
  return queue.length;
}

// ── test / maintenance helpers ────────────────────────────────────────────────

export function _resetInspectionStoreForward(): void {
  stopInspectionBackfillWorker();
  queue.length = 0;
  queuedKeys.clear();
  queueBytes = 0;
  appliedKeys.clear();
  appliedOrder.length = 0;
  metrics.buffered = 0;
  metrics.backfilled = 0;
  metrics.deduped = 0;
  metrics.deadLettered = 0;
  metrics.droppedOverflow = 0;
  metrics.droppedAge = 0;
  metrics.droppedBytes = 0;
  metrics.lastBackfillAt = null;
  metrics.lastBufferedAt = null;
  fileDirty = false;
  draining = false;
  consecutiveFailures = 0;
  lastDepthAlertAt = 0;
  processFn = async () => {
    throw new Error("[InspectionSF] process fn not wired (call setProcessFn)");
  };
  dedupFn = async () => false;
}
