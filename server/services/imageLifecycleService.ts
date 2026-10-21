/**
 * Image lifecycle service — local-FS blob retention for inspection images
 * (doc 27 §4 gap R6 · §11 decisions #2 "12-month retention for everything" and
 * #5 "Local FS + lifecycle, 32TB, alert at 80%").
 *
 * Inspection/defect images are stored on the local filesystem under
 * `LOCAL_STORAGE_DIR` (default ./uploads) with keys `inspections/{inspectionId}/
 * {pointCode}-{nanoid}.{ext}` (see server/routers/machineApiRouters.ts). Before
 * this service NOTHING ever deleted them (gap R6), so pruning DB rows would
 * orphan files and the 32TB volume would eventually fill.
 *
 * Responsibilities:
 *   1. deleteStorageKeys(keys)      — remove specific files. Called by
 *      dataRetentionService with imageKey/defectCropKey values CAPTURED from
 *      measurement_results rows it just deleted (row-synchronous cleanup).
 *   2. deleteInspectionDirs(ids)    — remove whole uploads/inspections/<id>/
 *      directories for pruned product_inspections rows (covers every image of
 *      that inspection, including files whose keys were never persisted).
 *   3. pruneOldInspectionImages()   — age-based fallback sweep: removes
 *      inspection image directories whose NEWEST file mtime is older than the
 *      retention window (RETENTION_INSPECTION_IMAGES_DAYS, default 365). This
 *      catches files orphaned before key-capture existed, or rows deleted
 *      outside the sweeper (e.g. native Timescale retention dropping chunks).
 *   4. checkUploadsDiskUsage()      — statfs on the uploads volume; notifies
 *      all admins (existing notifications mechanism) when usage crosses
 *      UPLOADS_DISK_ALERT_PCT (default 80%, per decision #5), debounced 24h.
 *
 * SAFETY:
 *   - Only active when STORAGE_MODE=local (files on other backends are not ours
 *     to delete) and DATA_RETENTION_ENABLED=true (same master switch as the row
 *     sweeper — image lifecycle must run in the same rhythm as row pruning).
 *   - Path-traversal guard on every key; deletions never escape the uploads root.
 *   - Bounded work per run (IMAGE_LIFECYCLE_MAX_DIRS_PER_RUN, default 5000 dirs).
 */
import fs from "fs";
import { DbUnavailableError } from "../_core/dbErrors";
import path from "path";

// ── Configuration helpers ─────────────────────────────────────────────────────

function envInt(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function isLocalStorage(): boolean {
  return (process.env.STORAGE_MODE ?? "forge") === "local";
}

/** Uploads root — mirrors server/storage.ts resolution exactly. */
export function uploadsRoot(): string {
  return process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), "uploads");
}

/** Resolve a storage key under the uploads root; null if it escapes the root. */
export function resolveUnderRoot(key: string): string | null {
  const root = uploadsRoot();
  const resolved = path.resolve(root, key.replace(/^\/+/, ""));
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  return resolved;
}

// ── 1. Key-level deletion (row-synchronous cleanup) ───────────────────────────

export interface DeleteKeysResult {
  deleted: number;
  missing: number;
  blocked: number;
}

/**
 * Delete individual storage keys (e.g. measurement_results.imageKey /
 * defectCropKey captured from pruned rows). Null/empty keys are ignored;
 * missing files are not errors (row may predate local storage mode).
 */
export async function deleteStorageKeys(
  keys: Array<string | null | undefined>,
): Promise<DeleteKeysResult> {
  const result: DeleteKeysResult = { deleted: 0, missing: 0, blocked: 0 };
  if (!isLocalStorage()) return result;

  for (const key of keys) {
    if (!key || typeof key !== "string") continue;
    const filePath = resolveUnderRoot(key);
    if (!filePath) {
      result.blocked++;
      console.warn(`[ImageLifecycle] blocked suspicious storage key (traversal): ${key}`);
      continue;
    }
    try {
      await fs.promises.unlink(filePath);
      result.deleted++;
    } catch (err: any) {
      if (err?.code === "ENOENT") result.missing++;
      else console.warn(`[ImageLifecycle] failed to delete ${key}:`, err?.message ?? err);
    }
  }
  return result;
}

// ── 2. Per-inspection directory deletion ──────────────────────────────────────

/**
 * Remove uploads/inspections/<id>/ for each pruned product_inspections row.
 * Deleting the directory covers ALL images of the inspection (measurement
 * images, defect crops) regardless of whether their keys were captured.
 */
export async function deleteInspectionDirs(
  inspectionIds: Array<number | string>,
): Promise<{ deletedDirs: number }> {
  let deletedDirs = 0;
  if (!isLocalStorage()) return { deletedDirs };

  for (const id of inspectionIds) {
    // ids come from the DB (serial ints) but sanitize anyway — they become paths.
    const safe = String(id).trim();
    if (!/^\d+$/.test(safe)) continue;
    const dir = resolveUnderRoot(path.posix.join("inspections", safe));
    if (!dir) continue;
    try {
      await fs.promises.rm(dir, { recursive: true, force: true });
      deletedDirs++;
    } catch (err: any) {
      console.warn(`[ImageLifecycle] failed to remove ${dir}:`, err?.message ?? err);
    }
  }
  return { deletedDirs };
}

// ── 3. Age-based fallback sweep ───────────────────────────────────────────────

/** Newest file mtime (ms) under a directory, recursive; dir mtime as fallback. */
async function newestMtimeMs(dir: string): Promise<number> {
  let newest = 0;
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        newest = Math.max(newest, await newestMtimeMs(p));
      } else {
        try {
          const st = await fs.promises.stat(p);
          newest = Math.max(newest, st.mtimeMs);
        } catch {
          /* file vanished mid-scan — ignore */
        }
      }
    }
    if (newest === 0) {
      const st = await fs.promises.stat(dir);
      newest = st.mtimeMs;
    }
  } catch {
    /* dir vanished mid-scan */
  }
  return newest;
}

export interface PruneImagesResult {
  /** Số thư mục ĐÃ XÉT trong lượt này (mỗi thư mục xét đúng một lần; đây là thứ bị chặn bởi maxDirsPerRun). */
  scannedDirs: number;
  deletedDirs: number;
  skipped: boolean;
  /** Tên thư mục cuối cùng đã xét — con trỏ bền của lượt kế tiếp (null = hết vòng, lượt sau quay lại đầu). */
  nextCursor?: string | null;
  /** true khi lượt này chạm cuối danh sách và đặt con trỏ về đầu. */
  wrapped?: boolean;
}

// ── 3a. Con trỏ bền cho các bộ quét theo lượt ─────────────────────────────────
//
// ⚠ VÌ SAO: bản cũ của `pruneOldInspectionImages` duyệt `readdir` theo thứ tự chữ, ĐẾM MỌI thư mục (kể cả chưa hết hạn)
// vào trần 5 000 rồi `break`, và KHÔNG nhớ gì giữa các lượt ⇒ mỗi lượt chỉ xét lại ~5 000 tên ĐẦU. Khi 5 000 tên đầu
// là thư mục còn trẻ thì mọi thư mục cũ đứng sau chúng KHÔNG BAO GIỜ được xét. Ở quy mô sản xuất (hàng triệu bo, mỗi bo một
// thư mục) lưới này vì thế gần như chết. Nay: sắp theo id SỐ tăng dần (id ≈ thời gian ⇒ cũ trước), xét tối đa `max`
// thư mục kể từ sau con trỏ, lưu con trỏ vào tệp trạng thái; hết danh sách thì quay lại đầu. Mọi thư mục được xét sau
// ⌈N / max⌉ lượt, bất kể chúng trẻ hay già.
//
// Tệp trạng thái nằm ở `<uploadsRoot>/.lifecycle/` — NGOÀI mọi tiền tố mà reaper liệt kê (`inspections/`), nếu không
// reaper sẽ coi chính con trỏ là "ảnh mồ côi".

const STATE_DIR_NAME = ".lifecycle";

function stateFile(name: string, stateDir?: string): string {
  return path.join(stateDir ?? path.join(uploadsRoot(), STATE_DIR_NAME), name);
}

async function docConTro(file: string): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.promises.readFile(file, "utf8"));
    return typeof j?.cursor === "string" ? j.cursor : null;
  } catch {
    return null; // chưa có / hỏng ⇒ bắt đầu từ đầu (an toàn: chỉ làm lượt đầu dài hơn)
  }
}

async function ghiConTro(file: string, cursor: string | null): Promise<void> {
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify({ cursor, at: new Date().toISOString() }));
  } catch (err: any) {
    // Không ghi được con trỏ ⇒ lượt sau lại bắt đầu từ đầu: giảm tiến độ nhưng KHÔNG được làm sập lượt dọn.
    console.warn(`[ImageLifecycle] cannot persist sweep cursor ${file}:`, err?.message ?? err);
  }
}

/** So sánh tên thư mục: số nguyên tăng dần trước, rồi tên không phải số theo chữ. */
export function soSanhTenThuMuc(a: string, b: string): number {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) {
    const x = BigInt(a), y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Chọn lô tên thư mục cho lượt này: các tên đứng SAU `conTro` (theo `soSanhTenThuMuc`), tối đa `max`.
 * Hết danh sách trong lượt này ⇒ `nextCursor = null` và `wrapped = true` (lượt sau quay lại đầu). Nếu con trỏ đã ở cuối
 * (không còn tên nào sau nó) thì quay lại đầu NGAY trong lượt này để lượt không rỗng vô ích.
 */
export function chonLoDuyet(
  ten: readonly string[],
  conTro: string | null,
  max: number,
): { batch: string[]; nextCursor: string | null; wrapped: boolean } {
  const sorted = [...ten].sort(soSanhTenThuMuc);
  let start = 0;
  if (conTro !== null) {
    start = sorted.findIndex((t) => soSanhTenThuMuc(t, conTro) > 0);
    if (start === -1) start = 0; // con trỏ đã ở cuối ⇒ quay lại đầu
  }
  const batch = sorted.slice(start, start + max);
  const het = start + batch.length >= sorted.length;
  return { batch, nextCursor: het ? null : (batch[batch.length - 1] ?? null), wrapped: het };
}

/**
 * Sweep uploads/inspections/*: delete directories whose newest content is older
 * than the retention window. RETENTION_INSPECTION_IMAGES_DAYS <= 0 disables.
 *
 * Duyệt theo id tăng dần với CON TRỎ BỀN (xem 3a): trần `maxDirsPerRun` chỉ đếm thư mục ĐÃ XÉT, và lượt sau tiếp tục
 * sau thư mục cuối cùng của lượt trước.
 */
export async function pruneOldInspectionImages(opts?: {
  retentionDays?: number;
  maxDirsPerRun?: number;
  nowMs?: number;
  /** Ghi đè thư mục trạng thái (test). */
  stateDir?: string;
}): Promise<PruneImagesResult> {
  const result: PruneImagesResult = { scannedDirs: 0, deletedDirs: 0, skipped: true };
  if (!isLocalStorage()) return result;

  const retentionDays = opts?.retentionDays ?? envInt("RETENTION_INSPECTION_IMAGES_DAYS", 365);
  if (retentionDays <= 0) return result;

  const maxDirs = Math.max(1, opts?.maxDirsPerRun ?? envInt("IMAGE_LIFECYCLE_MAX_DIRS_PER_RUN", 5000));
  const cutoffMs = (opts?.nowMs ?? Date.now()) - retentionDays * 24 * 60 * 60 * 1000;
  const base = path.join(uploadsRoot(), "inspections");

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(base, { withFileTypes: true });
  } catch {
    return result; // no inspections dir yet — nothing to prune
  }

  result.skipped = false;
  const cursorFile = stateFile("inspections-prune.cursor.json", opts?.stateDir);
  const lo = chonLoDuyet(
    entries.filter((e) => e.isDirectory()).map((e) => e.name),
    await docConTro(cursorFile),
    maxDirs,
  );
  for (const name of lo.batch) {
    result.scannedDirs++;
    const dir = path.join(base, name);
    const newest = await newestMtimeMs(dir);
    if (newest > 0 && newest < cutoffMs) {
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
        result.deletedDirs++;
      } catch (err: any) {
        console.warn(`[ImageLifecycle] failed to prune ${dir}:`, err?.message ?? err);
      }
    }
  }
  result.nextCursor = lo.nextCursor;
  result.wrapped = lo.wrapped;
  await ghiConTro(cursorFile, lo.nextCursor);
  if (result.deletedDirs > 0) {
    console.log(
      `[ImageLifecycle] pruned ${result.deletedDirs} inspection image dirs older than ${retentionDays}d ` +
        `(examined ${result.scannedDirs}${lo.wrapped ? ", end of list — next run restarts from the first dir" : ""})`,
    );
  }
  return result;
}

// ── 3b. Bộ quét bộ nhớ đệm ảnh AOI (`aoi-cache/<packageId>/<tệp>`) ─────────────
//
// Bộ nhớ đệm này chỉ có TTL LƯỜI: `aoiPackageRouter` xoá một tệp hết hạn khi có người truy cập đúng tệp đó; không ai quét.
// Đo 2026-10-21 trên dev: 368 thư mục / 2 336 tệp / 661 MB, TẤT CẢ cũ hơn 7 ngày (cũ nhất 2026-02-07) và không còn hàng
// `inspection_packages` nào. Tệp bóc ra từ ZIP nên LUÔN dựng lại được — xoá là an toàn về dữ liệu, nhưng việc xoá là
// quyết định vận hành ⇒ MẶC ĐỊNH DRY-RUN (chỉ báo cáo); bật xoá bằng cờ riêng AOI_CACHE_SWEEP_DELETE=true.

/** Thư mục gốc bộ nhớ đệm — PHẢI khớp với `CACHE_DIR` của `aoiPackageRouter`. */
export function aoiCacheRoot(): string {
  return process.env.AOI_CACHE_DIR
    ? path.resolve(process.env.AOI_CACHE_DIR)
    : path.join(process.cwd(), "uploads", "aoi-cache");
}

export interface AoiCacheSweepResult {
  dryRun: boolean;
  /** Thư mục đã xét trong lượt này. */
  scannedDirs: number;
  /** Thư mục hết hạn (mtime tệp mới nhất cũ hơn TTL) — ứng viên xoá. */
  expiredDirs: number;
  expiredFiles: number;
  expiredBytes: number;
  /** Thư mục thật sự bị xoá (0 khi dry-run). */
  deletedDirs: number;
  nextCursor: string | null;
  wrapped: boolean;
  skipped: boolean;
}

async function dirStats(dir: string): Promise<{ files: number; bytes: number; newestMs: number }> {
  let files = 0, bytes = 0, newestMs = 0;
  async function walk(d: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else {
        try {
          const st = await fs.promises.stat(p);
          files++;
          bytes += st.size;
          newestMs = Math.max(newestMs, st.mtimeMs);
        } catch {
          /* vanished */
        }
      }
    }
  }
  await walk(dir);
  return { files, bytes, newestMs };
}

/**
 * Quét `aoi-cache`: thư mục có tệp mới nhất cũ hơn TTL (AOI_CACHE_TTL_DAYS, mặc định 7) là hết hạn. Tối đa
 * `maxDirsPerRun` thư mục ĐÃ XÉT mỗi lượt (AOI_CACHE_SWEEP_MAX_DIRS, mặc định 500), có con trỏ bền như 3a.
 * DRY-RUN trừ khi `dryRun:false` được truyền tường minh (scheduler chỉ truyền khi AOI_CACHE_SWEEP_DELETE=true).
 */
export async function sweepAoiCache(opts?: {
  ttlDays?: number;
  maxDirsPerRun?: number;
  nowMs?: number;
  dryRun?: boolean;
  cacheDir?: string;
  stateDir?: string;
}): Promise<AoiCacheSweepResult> {
  const dryRun = opts?.dryRun !== false;
  const r: AoiCacheSweepResult = {
    dryRun, scannedDirs: 0, expiredDirs: 0, expiredFiles: 0, expiredBytes: 0, deletedDirs: 0,
    nextCursor: null, wrapped: false, skipped: true,
  };
  const ttlDays = opts?.ttlDays ?? envInt("AOI_CACHE_TTL_DAYS", 7);
  if (!(ttlDays > 0)) return r;
  const maxDirs = Math.max(1, opts?.maxDirsPerRun ?? envInt("AOI_CACHE_SWEEP_MAX_DIRS", 500));
  const root = opts?.cacheDir ?? aoiCacheRoot();
  const cutoffMs = (opts?.nowMs ?? Date.now()) - ttlDays * 24 * 60 * 60 * 1000;

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return r; // chưa có bộ nhớ đệm
  }
  r.skipped = false;
  const cursorFile = stateFile("aoi-cache-sweep.cursor.json", opts?.stateDir);
  const lo = chonLoDuyet(entries.filter((e) => e.isDirectory()).map((e) => e.name), await docConTro(cursorFile), maxDirs);
  for (const name of lo.batch) {
    r.scannedDirs++;
    const dir = path.join(root, name);
    const st = await dirStats(dir);
    // Thư mục rỗng (không còn tệp) ⇒ newestMs = 0 ⇒ coi là hết hạn bằng mtime của chính thư mục.
    let newest = st.newestMs;
    if (newest === 0) {
      try {
        newest = (await fs.promises.stat(dir)).mtimeMs;
      } catch {
        continue;
      }
    }
    if (newest >= cutoffMs) continue;
    r.expiredDirs++;
    r.expiredFiles += st.files;
    r.expiredBytes += st.bytes;
    if (!dryRun) {
      try {
        await fs.promises.rm(dir, { recursive: true, force: true });
        r.deletedDirs++;
      } catch (err: any) {
        console.warn(`[AoiCacheSweep] failed to remove ${dir}:`, err?.message ?? err);
      }
    }
  }
  r.nextCursor = lo.nextCursor;
  r.wrapped = lo.wrapped;
  await ghiConTro(cursorFile, lo.nextCursor);
  if (r.expiredDirs > 0) {
    console.log(
      `[AoiCacheSweep] ${dryRun ? "DRY-RUN — would delete" : "deleted"} ${r.expiredDirs} dirs / ${r.expiredFiles} files / ` +
        `${(r.expiredBytes / 1048576).toFixed(1)} MB older than ${ttlDays}d (examined ${r.scannedDirs}` +
        `${r.wrapped ? ", end of list" : ""}) — root=${root}`,
    );
  }
  return r;
}

// ── 4. Disk-usage monitor (decision #5 — 32TB volume, alert at 80%) ──────────

export interface DiskUsageEvaluation {
  usedPct: number;
  alert: boolean;
}

/** Pure threshold logic (unit-testable without a real volume). */
export function evaluateDiskUsage(
  totalBytes: number,
  freeBytes: number,
  thresholdPct: number,
): DiskUsageEvaluation {
  if (!(totalBytes > 0)) return { usedPct: 0, alert: false };
  const usedPct = Math.min(100, Math.max(0, ((totalBytes - freeBytes) / totalBytes) * 100));
  return { usedPct, alert: usedPct >= thresholdPct };
}

let lastDiskAlertAtMs = 0;
const DISK_ALERT_DEBOUNCE_MS = 24 * 60 * 60 * 1000; // re-alert at most daily

async function notifyAdminsDiskAlert(usedPct: number, thresholdPct: number): Promise<void> {
  // Dynamic imports: keeps this module light for unit tests and avoids pulling
  // socket.io/db barrels unless an alert actually fires.
  const [{ getUsersByRole }, { sendNotification }] = await Promise.all([
    import("../db"),
    import("./notificationService"),
  ]);
  const admins = await getUsersByRole("admin");
  for (const admin of admins ?? []) {
    try {
      await sendNotification(admin.id, {
        type: "SYSTEM",
        title: `Uploads disk ${usedPct.toFixed(1)}% full`,
        message:
          `The inspection image volume (${uploadsRoot()}) is at ${usedPct.toFixed(1)}% capacity ` +
          `(alert threshold ${thresholdPct}%). Image retention prunes files older than 12 months ` +
          `(doc 27 decision #2/#5); if usage keeps climbing, lower RETENTION_INSPECTION_IMAGES_DAYS ` +
          `or expand the volume.`,
        entityType: "system",
        priority: usedPct >= 90 ? "URGENT" : "HIGH",
        metadata: { usedPct, thresholdPct, uploadsRoot: uploadsRoot() },
      });
    } catch (err: any) {
      console.error(`[ImageLifecycle] disk alert to admin ${admin.id} failed:`, err?.message ?? err);
    }
  }
}

/**
 * Measure the uploads volume via statfs and alert admins at the threshold
 * (UPLOADS_DISK_ALERT_PCT, default 80 per doc 27 decision #5).
 */
export async function checkUploadsDiskUsage(opts?: {
  statfsFn?: (p: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  notifyFn?: (usedPct: number, thresholdPct: number) => Promise<void>;
}): Promise<DiskUsageEvaluation | null> {
  if (!isLocalStorage()) return null;
  const thresholdPct = envInt("UPLOADS_DISK_ALERT_PCT", 80);
  const root = uploadsRoot();

  let stats: { bsize: number; blocks: number; bavail: number };
  try {
    const statfsFn = opts?.statfsFn ?? (fs.promises.statfs as any);
    if (typeof statfsFn !== "function") return null; // very old Node — no statfs
    const raw = await statfsFn(root);
    stats = { bsize: Number(raw.bsize), blocks: Number(raw.blocks), bavail: Number(raw.bavail) };
  } catch (err: any) {
    // Root may not exist yet (no image ever stored) — not an error worth alerting on.
    if (err?.code !== "ENOENT") {
      console.warn("[ImageLifecycle] statfs failed:", err?.message ?? err);
    }
    return null;
  }

  const totalBytes = stats.bsize * stats.blocks;
  const freeBytes = stats.bsize * stats.bavail;
  const evaluation = evaluateDiskUsage(totalBytes, freeBytes, thresholdPct);

  if (evaluation.alert) {
    const now = Date.now();
    console.error(
      `[ImageLifecycle] ⚠️ uploads volume at ${evaluation.usedPct.toFixed(1)}% ` +
        `(threshold ${thresholdPct}%) — ${root}`,
    );
    if (now - lastDiskAlertAtMs >= DISK_ALERT_DEBOUNCE_MS) {
      lastDiskAlertAtMs = now;
      await (opts?.notifyFn ?? notifyAdminsDiskAlert)(evaluation.usedPct, thresholdPct);
    }
  }
  return evaluation;
}

/** Test hook: reset the alert debounce. */
export function __resetDiskAlertDebounce(): void {
  lastDiskAlertAtMs = 0;
}

// ── 5. Orphan-image reaper (DB-diff sweep) — CASE #5, doc 51 §11.2 ────────────
//
// The age-based sweep (#3) only removes whole inspection directories older than
// the retention window, and only in STORAGE_MODE=local. It therefore MISSES:
//   • Freshly-orphaned objects — the image upload succeeded but the DB row that
//     should reference it failed to persist (P2 idempotency compensation reduced
//     this window but cannot close it entirely). Such objects can sit for a full
//     year before the age sweep touches them, and only if their whole inspection
//     dir also ages out.
//   • forge/S3 backends — #3 is local-only, so a hosted backend never reclaims
//     any orphaned inspection image.
//
// This reaper closes both gaps with a DB-DIFF: list storage objects under the
// inspection prefix, subtract every key any measurement_results row references
// (imageKey / defectCropKey, plus keys derived from imageUrl / defectCropUrl for
// legacy rows), and treat the remainder — once older than a grace period — as
// orphans.
//
// SAFETY (non-negotiable):
//   • DRY-RUN by default. `reapOrphanImages()` never deletes unless dryRun:false
//     is passed explicitly; the scheduler only passes it when
//     ORPHAN_IMAGE_REAPER_DELETE=true (and the whole reaper is gated OFF by
//     ORPHAN_IMAGE_REAPER_ENABLED, default off — QĐ#1 backward-compatible).
//   • Grace period (ORPHAN_IMAGE_REAPER_GRACE_HOURS, default 24h): an object
//     younger than the grace window is NEVER touched — it may be mid-write, or
//     its DB row may not have committed yet.
//   • Honest-refuse: if the DB reference set cannot be built (DB down), the run
//     is SKIPPED, never a blind delete. Same for backends without a list adapter.
//   • Scoped to the `inspections/` prefix only, so product-model / export /
//     ai-model / floor-plan objects (different prefixes) are never at risk.

export interface StorageObject {
  /** Storage key relative to the storage root, posix-normalized (no leading /). */
  key: string;
  /** Last-modified time in epoch ms; 0 when unknown (such objects are never eligible). */
  mtimeMs: number;
}

export interface ReapOrphansResult {
  mode: string;
  scanned: number; // objects listed under the prefix
  referenced: number; // listed objects that have a DB row
  orphans: number; // listed objects with no DB row (any age)
  eligible: number; // orphans older than the grace period
  deleted: number; // objects actually deleted (0 in dry-run)
  failed: number; // delete attempts that did not remove the object
  dryRun: boolean;
  skipped: boolean; // true when the run refused to proceed (see skipReason)
  skipReason?: string;
  graceHours: number;
  prefix: string;
  /** Capped sample of eligible orphan keys for logging / the ops report. */
  sampleOrphanKeys: string[];
}

const INSPECTION_PREFIX_DEFAULT = "inspections";
const SAMPLE_ORPHAN_CAP = 50;

/** Normalize a storage key: backslashes → slashes, strip leading slashes. */
export function normalizeStorageKey(key: string): string {
  return key.replace(/\\/g, "/").replace(/^\/+/, "");
}

/**
 * Derive a storage key from a stored URL. In local mode imageUrl/defectCropUrl
 * are served as `/uploads/<key>`; we recover `<key>`. Absolute http(s) URLs
 * (forge mode) yield null — those rows carry the key in imageKey/defectCropKey.
 */
export function deriveKeyFromUploadsUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  const marker = "/uploads/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const key = url.slice(idx + marker.length);
  return key ? normalizeStorageKey(key) : null;
}

/**
 * List local storage objects (files) under a prefix, recursively. Keys are
 * returned relative to the uploads root and posix-normalized so they compare
 * 1:1 with DB imageKey values. Missing prefix dir → empty list (not an error).
 */
export async function listLocalStorageObjects(prefix: string): Promise<StorageObject[]> {
  const root = uploadsRoot();
  const base = resolveUnderRoot(prefix);
  if (!base) return [];
  const out: StorageObject[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return; // dir vanished mid-scan or does not exist
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!e.isFile()) continue;
      let mtimeMs = 0;
      try {
        mtimeMs = (await fs.promises.stat(p)).mtimeMs;
      } catch {
        continue; // file vanished mid-scan
      }
      out.push({ key: normalizeStorageKey(path.relative(root, p)), mtimeMs });
    }
  }
  await walk(base);
  return out;
}

/**
 * Build the set of every storage key referenced by measurement_results. Includes
 * imageKey + defectCropKey directly, plus keys derived from imageUrl/defectCropUrl
 * (covers legacy rows that persisted only a URL, never a key). Injected `db`/`sqlTag`
 * keep the drizzle/postgres barrels out of unit tests.
 *
 * ⚠ Scale note: this materializes referenced keys into an in-memory Set. At the
 * hot-table's scale (millions of rows) that is tens of MB — acceptable for an
 * opt-in maintenance sweep, but the standalone script does the same diff in SQL
 * for very large datasets.
 */
export async function defaultFetchReferencedKeys(db: any, sqlTag: any): Promise<Set<string>> {
  const set = new Set<string>();
  const rows = (await db.execute(sqlTag`
    SELECT "imageKey", "defectCropKey", "imageUrl", "defectCropUrl"
    FROM measurement_results
    WHERE "imageKey" IS NOT NULL OR "defectCropKey" IS NOT NULL
       OR "imageUrl" LIKE '%/uploads/%' OR "defectCropUrl" LIKE '%/uploads/%'
  `)) as unknown as Array<Record<string, string | null>>;
  for (const r of rows ?? []) {
    if (r.imageKey) set.add(normalizeStorageKey(r.imageKey));
    if (r.defectCropKey) set.add(normalizeStorageKey(r.defectCropKey));
    const u1 = deriveKeyFromUploadsUrl(r.imageUrl);
    if (u1) set.add(u1);
    const u2 = deriveKeyFromUploadsUrl(r.defectCropUrl);
    if (u2) set.add(u2);
  }
  return set;
}

/**
 * Reap orphaned inspection images by DB-diff. DRY-RUN unless `dryRun:false`.
 * Fully injectable (listFn / referencedKeysFn / deleteFn) for testing and for
 * wiring a future forge/S3 list adapter without touching this function.
 */
export async function reapOrphanImages(opts?: {
  dryRun?: boolean;
  graceHours?: number;
  prefix?: string;
  nowMs?: number;
  maxDeletePerRun?: number;
  mode?: string;
  listFn?: (prefix: string) => Promise<StorageObject[]>;
  referencedKeysFn?: () => Promise<Set<string>>;
  deleteFn?: (key: string) => Promise<{ deleted: boolean; error?: string }>;
}): Promise<ReapOrphansResult> {
  const mode = opts?.mode ?? (process.env.STORAGE_MODE ?? "forge");
  const dryRun = opts?.dryRun ?? true; // SAFE DEFAULT — deletion is always opt-in.
  const graceHours = Math.max(0, opts?.graceHours ?? envInt("ORPHAN_IMAGE_REAPER_GRACE_HOURS", 24));
  const prefix = normalizeStorageKey(
    opts?.prefix ?? process.env.ORPHAN_IMAGE_REAPER_PREFIX ?? INSPECTION_PREFIX_DEFAULT,
  ).replace(/\/+$/, "");
  const nowMs = opts?.nowMs ?? Date.now();
  const maxDelete = Math.max(0, opts?.maxDeletePerRun ?? envInt("ORPHAN_IMAGE_REAPER_MAX_DELETE", 10000));
  const graceMs = graceHours * 60 * 60 * 1000;

  const result: ReapOrphansResult = {
    mode,
    scanned: 0,
    referenced: 0,
    orphans: 0,
    eligible: 0,
    deleted: 0,
    failed: 0,
    dryRun,
    skipped: false,
    graceHours,
    prefix,
    sampleOrphanKeys: [],
  };

  // Resolve the list adapter. Local → fs walk. Any other backend without an
  // injected listFn → honest-refuse (storage.ts exposes no storageList yet).
  let listFn = opts?.listFn;
  if (!listFn) {
    if (mode === "local") {
      listFn = listLocalStorageObjects;
    } else {
      result.skipped = true;
      result.skipReason =
        `storage listing not supported for STORAGE_MODE='${mode}' — ` +
        `server/storage.ts exposes no storageList adapter. Inject listFn, or add a ` +
        `list adapter (forge v1/storage/list, or S3 ListObjectsV2) to enable reaping here.`;
      console.warn(`[OrphanReaper] ${result.skipReason}`);
      return result;
    }
  }

  // Build the DB reference set FIRST. If this fails we must NOT delete anything.
  const referencedKeysFn =
    opts?.referencedKeysFn ??
    (async () => {
      const [{ getJobsDb }, drizzle] = await Promise.all([
        import("../db/connection"),
        import("drizzle-orm"),
      ]);
      const db = await getJobsDb();
      if (!db) throw new DbUnavailableError();
      return defaultFetchReferencedKeys(db, (drizzle as any).sql);
    });

  let referenced: Set<string>;
  try {
    referenced = await referencedKeysFn();
  } catch (err: any) {
    result.skipped = true;
    result.skipReason = `could not load DB references — refusing to reap: ${err?.message ?? err}`;
    console.error(`[OrphanReaper] ${result.skipReason}`);
    return result;
  }

  const objects = await listFn(prefix);
  result.scanned = objects.length;

  const eligibleOrphans: string[] = [];
  for (const obj of objects) {
    const key = normalizeStorageKey(obj.key);
    if (referenced.has(key)) {
      result.referenced++;
      continue;
    }
    result.orphans++;
    const ageOk = obj.mtimeMs > 0 && nowMs - obj.mtimeMs >= graceMs;
    if (!ageOk) continue; // too new (or unknown mtime) — protect mid-write objects
    result.eligible++;
    eligibleOrphans.push(key);
    if (result.sampleOrphanKeys.length < SAMPLE_ORPHAN_CAP) result.sampleOrphanKeys.push(key);
  }

  if (dryRun) {
    if (result.eligible > 0) {
      console.log(
        `[OrphanReaper] DRY-RUN mode=${mode} prefix=${prefix}: ${result.eligible} orphan object(s) ` +
          `older than ${graceHours}h would be deleted ` +
          `(scanned ${result.scanned}, referenced ${result.referenced}, orphans ${result.orphans})`,
      );
    }
    return result;
  }

  const deleteFn =
    opts?.deleteFn ??
    (async (key: string) => {
      const { storageDelete } = await import("../storage");
      return storageDelete(key);
    });

  for (const key of eligibleOrphans) {
    if (result.deleted >= maxDelete) {
      console.warn(`[OrphanReaper] hit maxDeletePerRun=${maxDelete}; stopping (more orphans remain)`);
      break;
    }
    try {
      const res = await deleteFn(key);
      if (res.deleted) {
        result.deleted++;
      } else {
        result.failed++;
        if (res.error) console.warn(`[OrphanReaper] delete ${key} not removed: ${res.error}`);
      }
    } catch (err: any) {
      result.failed++;
      console.warn(`[OrphanReaper] delete ${key} threw: ${err?.message ?? err}`);
    }
  }
  console.log(
    `[OrphanReaper] mode=${mode} prefix=${prefix}: deleted ${result.deleted} orphan object(s) ` +
      `(failed ${result.failed}, scanned ${result.scanned}, referenced ${result.referenced}, grace ${graceHours}h)`,
  );
  return result;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

let pruneTimer: NodeJS.Timeout | null = null;
let diskTimer: NodeJS.Timeout | null = null;
let orphanTimer: NodeJS.Timeout | null = null;
let aoiCacheTimer: NodeJS.Timeout | null = null;

/**
 * Start the image lifecycle scheduler. Gated by DATA_RETENTION_ENABLED (same
 * master switch as row pruning — the two must run together, doc 27 §11 #2) and
 * STORAGE_MODE=local (decision #5 — local FS blob backend).
 */
export function startImageLifecycle(): void {
  if (process.env.DATA_RETENTION_ENABLED !== "true") return;
  if (!isLocalStorage()) {
    console.log("[ImageLifecycle] STORAGE_MODE is not 'local' — image lifecycle inactive");
    return;
  }
  if (pruneTimer || diskTimer) return;

  const pruneIntervalMs = Math.max(60_000, envInt("IMAGE_LIFECYCLE_INTERVAL_MS", 24 * 60 * 60 * 1000));
  const diskIntervalMs = Math.max(60_000, envInt("UPLOADS_DISK_CHECK_INTERVAL_MS", 60 * 60 * 1000));

  // Orphan reaper (CASE #5) is a SEPARATE opt-in gate, default OFF (QĐ#1). When
  // on, it runs DRY-RUN (report only) unless ORPHAN_IMAGE_REAPER_DELETE=true.
  const reaperEnabled = process.env.ORPHAN_IMAGE_REAPER_ENABLED === "true";
  const reaperDelete = process.env.ORPHAN_IMAGE_REAPER_DELETE === "true";
  // Bộ quét aoi-cache (3b): LUÔN chạy ở chế độ báo cáo; chỉ XOÁ khi cờ riêng AOI_CACHE_SWEEP_DELETE=true (mặc định tắt).
  const aoiCacheDelete = process.env.AOI_CACHE_SWEEP_DELETE === "true";
  const sweepAoiCacheOnce = () =>
    void sweepAoiCache({ dryRun: !aoiCacheDelete }).catch((e) =>
      console.error("[AoiCacheSweep] run failed:", e?.message ?? e),
    );

  // First runs shortly after boot (don't block startup), then on interval.
  setTimeout(() => {
    void pruneOldInspectionImages().catch((e) =>
      console.error("[ImageLifecycle] prune failed:", e?.message ?? e),
    );
    void checkUploadsDiskUsage().catch((e) =>
      console.error("[ImageLifecycle] disk check failed:", e?.message ?? e),
    );
    sweepAoiCacheOnce();
    if (reaperEnabled) {
      void reapOrphanImages({ dryRun: !reaperDelete }).catch((e) =>
        console.error("[OrphanReaper] run failed:", e?.message ?? e),
      );
    }
  }, 45_000);

  pruneTimer = setInterval(() => {
    void pruneOldInspectionImages().catch((e) =>
      console.error("[ImageLifecycle] prune failed:", e?.message ?? e),
    );
  }, pruneIntervalMs);
  if (typeof pruneTimer.unref === "function") pruneTimer.unref();

  aoiCacheTimer = setInterval(sweepAoiCacheOnce, pruneIntervalMs);
  if (typeof aoiCacheTimer.unref === "function") aoiCacheTimer.unref();

  diskTimer = setInterval(() => {
    void checkUploadsDiskUsage().catch((e) =>
      console.error("[ImageLifecycle] disk check failed:", e?.message ?? e),
    );
  }, diskIntervalMs);
  if (typeof diskTimer.unref === "function") diskTimer.unref();

  if (reaperEnabled) {
    const reaperIntervalMs = Math.max(
      60_000,
      envInt("ORPHAN_IMAGE_REAPER_INTERVAL_MS", 24 * 60 * 60 * 1000),
    );
    orphanTimer = setInterval(() => {
      void reapOrphanImages({ dryRun: !reaperDelete }).catch((e) =>
        console.error("[OrphanReaper] run failed:", e?.message ?? e),
      );
    }, reaperIntervalMs);
    if (typeof orphanTimer.unref === "function") orphanTimer.unref();
    console.log(
      `[OrphanReaper] scheduled every ${Math.round(reaperIntervalMs / 3600000)}h — ` +
        `${reaperDelete ? "DELETE" : "DRY-RUN (report only)"} ` +
        `(grace ${envInt("ORPHAN_IMAGE_REAPER_GRACE_HOURS", 24)}h, prefix=` +
        `${process.env.ORPHAN_IMAGE_REAPER_PREFIX ?? INSPECTION_PREFIX_DEFAULT})`,
    );
  }

  console.log(
    `[ImageLifecycle] enabled — image prune every ${Math.round(pruneIntervalMs / 3600000)}h, ` +
      `disk check every ${Math.round(diskIntervalMs / 60000)}min ` +
      `(alert at ${envInt("UPLOADS_DISK_ALERT_PCT", 80)}%), root=${uploadsRoot()}`,
  );
}

export function stopImageLifecycle(): void {
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  if (diskTimer) {
    clearInterval(diskTimer);
    diskTimer = null;
  }
  if (orphanTimer) {
    clearInterval(orphanTimer);
    orphanTimer = null;
  }
  if (aoiCacheTimer) {
    clearInterval(aoiCacheTimer);
    aoiCacheTimer = null;
  }
}
