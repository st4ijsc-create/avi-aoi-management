/**
 * W3-A (doc 27 §2 M1/M6/M11 — Đợt 3 item 3.1) — Master-data INTEGRITY admin API.
 *
 * Surfaces the two-phase FK/unique rollout (migrations 0179 orphan audit + 0180
 * conditional enforcement) to administrators:
 *   • summary — per relationship: the REAL DB enforcement state (pg_constraint
 *     convalidated / pg_indexes) + the latest orphan/duplicate scan snapshot
 *     from integrity_scan_results + scheduler status. Read-only, fail-safe.
 *   • runNow  — trigger an on-demand scan (writes a fresh snapshot).
 *   • history — recent scan rows for one relationship (trend while repairing).
 *
 * BG-131 (Lô 9 Mục 3, 2026-09-05) — RBAC ĐỔI từ `adminProcedure` (đòi
 * `role==='admin'` ĐÚNG CHỮ) sang `protectedProcedure` +
 * `requirePermission("admin_system", <action>)` — CÙNG nhóm quyền
 * `aoiPackageRouter.listDeadLetters`/`getDeadLetterDetail` (Lô 4, BG-36) đã
 * dùng cho tab quản trị ingest LIỀN KỀ (dead-letter WAL) trong CÙNG một tab UI
 * (`AOIPackages.tsx`, panel integrityScan). Trước bản vá này, hai panel cùng
 * một tab dùng HAI MÔ HÌNH QUYỀN khác nhau: một scoped-admin (không phải admin
 * role, nhưng có hàng `permissions.admin_system.canView=true`) xem được
 * dead-letter nhưng bị `integrity.summary` từ chối FORBIDDEN — đúng lớp lỗi
 * "một lối vào rồi từ chối" (đã vá TRUNG THỰC hoá ở Lô 4:
 * `client/src/pages/ingestIntegrityScanPresentation.ts: laLoiTuChoiQuyen`,
 * nhưng gốc rễ — HAI mô hình quyền — vẫn còn, ghi lại thành BG-131). Đóng thật
 * là hợp nhất về MỘT mô hình.
 *
 * summary/history = ĐỌC ⇒ `canView`. runNow = GHI (kích hoạt quét, persist một
 * snapshot mới vào `integrity_scan_results`) ⇒ `canEdit` — một bậc CHẶT HƠN
 * đọc, đúng quy ước `canView`≤`canEdit` mà `requirePermission` dùng ở mọi router
 * khác (vd `aoiPackageRouter.listDeadLetters`=canView vs các mutation ghi khác
 * trong repo dùng canEdit).
 *
 * ⚠ ĐÂY LÀ NỚI QUYỀN cho scoped-admin (một user KHÔNG có role='admin' nhưng
 * ĐƯỢC CẤP hàng `permissions.admin_system` giờ xem/chạy được integrity scan —
 * trước đây bị chặn tuyệt đối bởi `adminProcedure` bất kể `permissions` nói
 * gì) — KHÔNG ai MẤT quyền: `checkPermission` (`server/_core/accessControl.ts`)
 * cho role='admin' bypass tuyệt đối khi `!scopedAdminEnabled()` (mặc định), và
 * khi scoped-admin ON thì admin vẫn phải có hàng permissions như mọi module
 * khác — hành vi nhất quán với toàn bộ `requirePermission` call site còn lại,
 * không phải một ngoại lệ mới.
 *
 * ⚠⚠ HỆ QUẢ PHỤ ĐO ĐƯỢC (tự-review, ghi trong report Lô 9) — `adminProcedure`
 * (CŨ) chain HAI việc gộp: (a) `role==='admin'`, (b) `batBuoc2FA() &&
 * !ctx.user.twoFactorEnabled` ⇒ TWO_FACTOR_NOT_SET_UP (dòng ~368-376 của
 * `server/_core/trpc.ts` bản trước bản vá này). `protectedProcedure +
 * requirePermission(...)` KHÔNG chain `require2FA` — router này nay CÙNG tư
 * thế 2FA với `aoiPackageRouter.listDeadLetters`/`getDeadLetterDetail` (cũng
 * `protectedProcedure + requirePermission("admin_system", ...)`, KHÔNG
 * `require2FA`) — tức một admin CHƯA bật 2FA (chế độ nội bộ,
 * `AUTH_2FA_BAT_BUOC=0`, quyết định chủ dự án 2026-08-24) nay gọi được
 * `integrity.summary/runNow` mà TRƯỚC ĐÂY bị chặn bởi khối 2FA của
 * `adminProcedure` khi `AUTH_2FA_BAT_BUOC` không phải "0". Đây là hệ quả THẬT
 * của "hợp nhất về MỘT mô hình" mà brief BG-131 yêu cầu (integrityRoun ĐÃ ở tư
 * thế lỏng hơn dead-letter TRƯỚC bản vá — hợp nhất nghĩa là kéo integrityRouter
 * VỀ tư thế dead-letter, không phải ngược lại), không phải một lỗ hổng tự chế
 * mới — nhưng CHƯA từng được nói rõ trong brief gốc, cần chủ dự án biết khi ở
 * chế độ CẤP QUA INTERNET (`AUTH_2FA_BAT_BUOC` không phải "0"). Nếu muốn giữ
 * NGUYÊN mức 2FA cũ cho hai procedure này, thêm `.use(require2FA)` (export sẵn,
 * `server/_core/trpc.ts`) là việc CÓ THỂ làm sau, ngoài phạm vi hợp nhất quyền
 * của lô này.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import {
  INTEGRITY_RELATIONSHIPS,
  getConstraintStates,
  getIntegrityScanSchedulerStatus,
  runIntegrityScanNow,
} from "../services/integrityScanService";

interface LastScanRow {
  scanKey: string;
  violationCount: number;
  sampleIds: unknown;
  scanSource: string;
  scannedAt: Date | string;
}

export const integrityRouter = router({
  /** Enforcement + latest-scan overview for every governed relationship. */
  summary: protectedProcedure.use(requirePermission("admin_system", "canView")).query(async () => {
    const db = await getDb();
    const scheduler = getIntegrityScanSchedulerStatus();

    // Latest scan row per key (fail-safe: table may predate migration 0179).
    let lastScans = new Map<string, LastScanRow>();
    if (db) {
      try {
        const rows = (await db.execute(sql`
          SELECT DISTINCT ON ("scanKey")
            "scanKey" AS "scanKey", "violationCount" AS "violationCount",
            "sampleIds" AS "sampleIds", "scanSource" AS "scanSource", "scannedAt" AS "scannedAt"
          FROM integrity_scan_results
          ORDER BY "scanKey", "scannedAt" DESC`)) as unknown as LastScanRow[];
        lastScans = new Map(rows.map((r) => [r.scanKey, r]));
      } catch (err) {
        console.warn("[integrityRouter] integrity_scan_results unavailable (run migration 0179?):", (err as Error)?.message);
      }
    }

    const states = new Map((await getConstraintStates()).map((s) => [s.key, s]));

    const relationships = INTEGRITY_RELATIONSHIPS.map((rel) => {
      const state = states.get(rel.key);
      const last = lastScans.get(rel.key);
      return {
        key: rel.key,
        kind: rel.kind,
        childTable: rel.childTable,
        childColumn: rel.childColumn,
        parentTable: rel.parentTable ?? null,
        parentColumn: rel.parentColumn ?? null,
        enforcement: rel.enforcement,
        repair: rel.repair,
        constraintName: rel.constraintName,
        // Real DB state: 'validated' | 'not-valid' (new writes checked, legacy
        // rows unverified) | 'missing' (deferred/skipped — scanner-covered).
        dbState: !state || !state.exists ? "missing" : state.validated ? "validated" : "not-valid",
        lastScan: last
          ? {
              violationCount: Number(last.violationCount),
              samples: last.sampleIds ?? [],
              scanSource: last.scanSource,
              scannedAt: last.scannedAt instanceof Date ? last.scannedAt.toISOString() : String(last.scannedAt),
            }
          : null,
      };
    });

    return {
      relationships,
      scheduler,
      totals: {
        relationships: relationships.length,
        validated: relationships.filter((r) => r.dbState === "validated").length,
        notValid: relationships.filter((r) => r.dbState === "not-valid").length,
        missing: relationships.filter((r) => r.dbState === "missing").length,
        dirty: relationships.filter((r) => (r.lastScan?.violationCount ?? 0) > 0).length,
      },
      generatedAt: new Date().toISOString(),
    };
  }),

  /** Run the orphan/duplicate scan now (single-flight; result also persisted). */
  runNow: protectedProcedure.use(requirePermission("admin_system", "canEdit")).mutation(async () => {
    return runIntegrityScanNow("manual");
  }),

  /** Recent scan snapshots for one relationship key (repair-progress trend). */
  history: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .input(z.object({
      key: z.string().min(1).max(160),
      limit: z.number().int().min(1).max(100).default(20),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return { rows: [] };
      try {
        const rows = (await db.execute(sql`
          SELECT "violationCount" AS "violationCount", "sampleIds" AS "sampleIds",
                 "scanSource" AS "scanSource", "scannedAt" AS "scannedAt"
          FROM integrity_scan_results
          WHERE "scanKey" = ${input.key}
          ORDER BY "scannedAt" DESC
          LIMIT ${input.limit}`)) as unknown as Array<Record<string, unknown>>;
        return { rows };
      } catch (err) {
        console.warn("[integrityRouter] history query failed:", (err as Error)?.message);
        return { rows: [] };
      }
    }),
});
