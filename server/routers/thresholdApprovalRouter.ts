/**
 * P4.B G18 — Threshold suggestion approval workflow router.
 *
 * Operator/engineer flow:
 *   1. `request`  — submit a proposed LSL/USL (typically derived from
 *                   `thresholdSuggestion.suggestForPoint`).
 *   2. `approve`  — QUALITY manager accepts → optional `apply: true` writes
 *                   the new limits onto the `measurement_point_defs` row.
 *   3. `reject`   — quality manager rejects with a reason.
 *   4. `withdraw` — original requester pulls back a still-pending request.
 *   5. `list`     — filter by status / pointDefId / requester (now joins the
 *                   point + product metadata so a reviewer sees code/name, not
 *                   just `MP-{id}`).
 *   6. `batchApprove` — approve many pending requests in one call; SoD + state
 *                   are checked per-item, never all-or-nothing.
 *   7. `revert`   — restore a point's previous limits from measurement_point_versions.
 *
 * ════════════ Doc 31 Đợt A (OP1 / OP2 / OP8) governance hardening ════════════
 *   • OP1 SoD: `approve`/`batchApprove` are `qualityProcedure` (role-gated, 2FA
 *     for privileged roles) AND reject when the approver === the requester
 *     (assertApprovalSoD, server/services/thresholdGovernanceService). This is
 *     the server-side wall that makes AI-Suggest self-approve impossible even if
 *     a stale client still tries request+approve as one user.
 *   • The lifecycle bypass (OP2) is closed on the DIRECT edit paths
 *     (productRouters.measurementPoint.update + spcAnalysisRouter.saveSpecLimits),
 *     NOT here — the approval queue is the SANCTIONED path and therefore may
 *     apply limits to a live product.
 *
 * All transitions are logged into the `threshold_approvals` row itself
 * (decidedBy, decidedAt, decidedComment) — full audit trail.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { eq, and, desc, inArray } from "drizzle-orm";
import { protectedProcedure, qualityProcedure, router } from "../_core/trpc";
import { getDb } from "../db/connection";
import { updateMeasurementPointDef, createAuditLog } from "../db";
import {
  thresholdApprovals,
  measurementPointDefs,
  measurementPointVersions,
  productModels,
} from "../../drizzle/schema/product";
import { assertApprovalSoD } from "../services/thresholdGovernanceService";
// BG-126 (Khối C, "nợ còn mở") — chặn `comment` NGƯỜI DÙNG giả tiền tố cấu
// trúc [VARIANT:n] trước khi nó chảy vào changeReason của updateMeasurementPointDef
// (đường `revert` dưới đây). Xem docblock `server/utils/changeReasonGuard.ts`.
import { assertChangeReasonKhongGiaTienToBienThe } from "../utils/changeReasonGuard";
// Lô 7 Mục 2 (BG-111) — `deXuat` (hợp đồng `request` MỞ RỘNG) dùng ĐÚNG danh
// sách 20 field kiểu-chuỗi mà BG-123 (measurementPoint.update/setLimitsBatch)
// đã suy từ `APPROVAL_LIMIT_FIELDS` (shared/pointLimitSpec.ts) — KHÔNG chép
// tay danh sách lần thứ ba. `criteria` (jsonb array)/`toleranceMode` (enum)
// loại trừ vì lý do y hệt BG-123 đã ghi ở measurementPointLimitGate.ts.
import { NULLABLE_LIMIT_STRING_FIELDS, xayZodShapeGioiHanNullable } from "../utils/measurementPointLimitGate";

const STATUS_PENDING = "requested";
const STATUS_APPROVED = "approved";
const STATUS_REJECTED = "rejected";
const STATUS_APPLIED = "applied";
const STATUS_WITHDRAWN = "withdrawn";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ThresholdApprovalRow = typeof thresholdApprovals.$inferSelect;

async function getById(id: number) {
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
  const [row] = await db
    .select()
    .from(thresholdApprovals)
    .where(eq(thresholdApprovals.id, id))
    .limit(1);
  if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "thresholdApproval" }, `threshold_approval ${id} not found`);
  return row;
}

/**
 * Lô 7 Mục 2 (BG-111) — đọc lại "ĐỦ BỘ field đề xuất" từ một hàng
 * `threshold_approvals`, TƯƠNG THÍCH cả hàng MỚI (`suggestion.deXuat`, ghi bởi
 * `request` mở rộng ở trên) lẫn 176+30 hàng CŨ đang tồn kho (`status='requested'`,
 * đo được ở dev/test TRƯỚC bản vá này — `suggestion` của chúng là blob metadata
 * AI, KHÔNG có khoá `deXuat`) — hàng CŨ rơi về nhánh fallback: đúng 3 field
 * legacy (`lowerLimit`/`upperLimit`/`nominalValue`) từ `proposedLsl`/`proposedUsl`/
 * `proposedNominal`, giữ NGUYÊN VĂN hành vi TRƯỚC Lô 7 cho tập hàng này.
 *
 * Hàng MỚI (`deXuat` là object hợp lệ): CHỈ những field CÓ MẶT trong `deXuat`
 * được đưa vào kết quả (khoá vắng mặt = "hàng này không đề xuất field đó",
 * KHÔNG được coi là "đặt về null" — khác với khoá CÓ MẶT nhưng giá trị `null`,
 * đó MỚI là ý "xoá", đúng ngữ nghĩa BG-123/`updateMeasurementPointDef`).
 * `proposedNominal` (cột riêng, không thuộc `NULLABLE_LIMIT_STRING_FIELDS`) vẫn
 * áp dụng thêm nếu có, kể cả cho hàng MỚI — `nominalValue` không nằm trong
 * `deXuat` hôm nay (client hiện tại không sửa nominal qua đường request này).
 */
function deXuatDayDuTuHang(row: ThresholdApprovalRow): Partial<Record<string, string | null>> {
  const suggestion = (row.suggestion ?? {}) as Record<string, unknown>;
  const deXuat = suggestion.deXuat;
  const laDeXuatHopLe = deXuat != null && typeof deXuat === "object" && !Array.isArray(deXuat);

  const ket: Partial<Record<string, string | null>> = {};
  if (laDeXuatHopLe) {
    for (const f of NULLABLE_LIMIT_STRING_FIELDS) {
      const v = (deXuat as Record<string, unknown>)[f];
      if (v === undefined) continue; // field này hàng KHÔNG đề xuất — bỏ qua, không đụng.
      ket[f] = v === null ? null : String(v);
    }
  } else {
    // Fallback hàng CŨ (176 dev + 30 test đo được TRƯỚC Lô 7, xem lo-7-report.md) —
    // NGUYÊN VĂN 2 field legacy, giữ hành vi TRƯỚC bản vá này.
    if (row.proposedLsl != null) ket.lowerLimit = String(row.proposedLsl);
    if (row.proposedUsl != null) ket.upperLimit = String(row.proposedUsl);
  }
  if (row.proposedNominal != null) ket.nominalValue = String(row.proposedNominal);
  return ket;
}

/**
 * Shared apply/approve writer — updates the approval row and, when `apply`,
 * writes the proposed limits onto the point. Used by both `approve` and
 * `batchApprove` so the two never diverge. SoD MUST be checked by the caller
 * BEFORE invoking this.
 */
async function decideApproval(
  db: Db,
  row: ThresholdApprovalRow,
  decidedBy: number,
  comment: string | undefined,
  apply: boolean,
) {
  const newStatus = apply ? STATUS_APPLIED : STATUS_APPROVED;
  const [updated] = await db
    .update(thresholdApprovals)
    .set({
      status: newStatus,
      decidedBy,
      decidedAt: new Date(),
      decidedComment: comment,
      updatedAt: new Date(),
    })
    .where(eq(thresholdApprovals.id, row.id))
    .returning();

  if (apply) {
    // Lô 7 Mục 2 (BG-111) — ÁP TOÀN BỘ deXuat (không chỉ 3 cột tay LSL/USL/
    // nominal như TRƯỚC bản vá này) qua ĐÚNG đường ghi giới hạn chuẩn
    // (updateMeasurementPointDef — CÓ version + bump, mirror `revert` bên
    // dưới) — chuỗi snapshot BG-97 không đứt dù duyệt field NGOÀI LSL/USL.
    await updateMeasurementPointDef(
      row.pointDefId,
      deXuatDayDuTuHang(row) as any,
      { changedBy: decidedBy, changeReason: `threshold_approval:${row.id}` },
    );

    // W2-A / doc 35 D4 — bump product_models.pointsConfigVersion so machines that
    // pull via deltaSyncPoints (which only returns points when
    // pointsConfigVersion > sinceVersion) actually receive the approved limit.
    // Mirrors the CAD-import / centroid-import bump. Best-effort resolve of the
    // owning product via the point-def's productModelId.
    const [pd] = await db
      .select({ productModelId: measurementPointDefs.productModelId })
      .from(measurementPointDefs)
      .where(eq(measurementPointDefs.id, row.pointDefId))
      .limit(1);
    if (pd?.productModelId != null) {
      const [pm] = await db
        .select({ v: productModels.pointsConfigVersion })
        .from(productModels)
        .where(eq(productModels.id, pd.productModelId))
        .limit(1);
      const next = (pm?.v ?? 1) + 1;
      await db
        .update(productModels)
        .set({ pointsConfigVersion: next, updatedAt: new Date() } as any)
        .where(eq(productModels.id, pd.productModelId));
    }
  }
  return updated;
}

export const thresholdApprovalRouter = router({
  // Lô 7 Mục 2 (BG-111) — hợp đồng `request` MỞ RỘNG: `deXuat` thay LSL/USL
  // BẮT BUỘC bằng ĐỦ BỘ `APPROVAL_LIMIT_FIELDS` (trừ criteria/toleranceMode —
  // xem import ở đầu file). `undefined` (khoá vắng mặt) = không đề xuất field
  // đó; `null` = đề xuất XOÁ (khớp ngữ nghĩa BG-123); chuỗi = giá trị mới.
  //
  // Tương thích ngược: `proposedLsl`/`proposedUsl` (number, TRƯỚC bản vá này
  // BẮT BUỘC) nay `.optional()` — client CŨ gọi y nguyên vẫn ghi được (map vào
  // `deXuat.lowerLimit`/`upperLimit` bên dưới, xem docblock `mutation`).
  request: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive(),
      proposedLsl: z.number().optional(),
      proposedUsl: z.number().optional(),
      proposedNominal: z.number().optional(),
      deXuat: z.object(xayZodShapeGioiHanNullable()).partial().optional(),
      suggestion: z.record(z.string(), z.any()).optional(),
      comment: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // BG-126 — chặn Ở INPUT, TRƯỚC bất kỳ đọc/ghi DB nào (cùng khuôn `revert`).
      assertChangeReasonKhongGiaTienToBienThe(input.comment, "comment");

      const coLsl = input.proposedLsl != null;
      const coUsl = input.proposedUsl != null;
      if (coLsl !== coUsl) {
        // Một cận có mặt, cận kia vắng — hợp đồng LSL/USL cũ luôn đòi CẢ HAI
        // (đúng hành vi TRƯỚC bản vá này, giữ nguyên qua Lô 7).
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "proposedLsl" }, "proposedLsl and proposedUsl must be provided together");
      }
      if (coLsl && coUsl && !(input.proposedLsl! < input.proposedUsl!)) {
        throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "proposedLsl" }, "proposedLsl must be < proposedUsl");
      }

      // Lô 7 Mục 2 — `deXuat` là hợp đồng CHÍNH: field tường minh trong đó
      // THẮNG map từ proposedLsl/Usl (một client vừa gửi cả hai kiểu — hiếm,
      // nhưng "cái mới ghi đè cái map từ cái cũ" là quy tắc rõ ràng nhất).
      // legacy proposedLsl/Usl chỉ ĐIỀN VÀO chỗ deXuat.lowerLimit/upperLimit
      // còn TRỐNG (đo hộ gọi hiện có, BG-111 Mục 2 §1).
      const deXuat: Partial<Record<(typeof NULLABLE_LIMIT_STRING_FIELDS)[number], string | null>> = {
        ...(input.deXuat ?? {}),
      };
      if (coLsl && deXuat.lowerLimit === undefined) deXuat.lowerLimit = String(input.proposedLsl);
      if (coUsl && deXuat.upperLimit === undefined) deXuat.upperLimit = String(input.proposedUsl);

      if (Object.keys(deXuat).length === 0) {
        throw appError(
          "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "deXuat" },
          "A threshold approval request must propose at least one field (deXuat or proposedLsl/proposedUsl)",
        );
      }

      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");

      const [mp] = await db
        .select({
          id: measurementPointDefs.id,
          lsl: measurementPointDefs.lowerLimit,
          usl: measurementPointDefs.upperLimit,
          nominalValue: measurementPointDefs.nominalValue,
        })
        .from(measurementPointDefs)
        .where(eq(measurementPointDefs.id, input.pointDefId))
        .limit(1);
      if (!mp) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, `measurement_point_def ${input.pointDefId} not found`);
      }

      // Cột legacy `proposedLsl`/`proposedUsl` (0348 — nay NULLABLE) vẫn được
      // đổ khi `deXuat` mang field đó — màn duyệt CŨ (chỉ đọc hai cột này,
      // xem Mục 4) tiếp tục hiển thị đúng cho một yêu cầu có chạm LSL/USL.
      // Yêu cầu CHỈ chạm field khác (vd heightMax-only) để hai cột này NULL —
      // đúng ý nghĩa "không đề xuất LSL/USL", KHÔNG bịa số 0.
      const [row] = await db.insert(thresholdApprovals).values({
        pointDefId: input.pointDefId,
        requestedBy: ctx.user.id,
        suggestion: { ...(input.suggestion ?? {}), deXuat } as any,
        currentLsl: mp.lsl as any,
        currentUsl: mp.usl as any,
        currentNominal: mp.nominalValue as any,
        proposedLsl: deXuat.lowerLimit !== undefined ? (deXuat.lowerLimit as any) : null,
        proposedUsl: deXuat.upperLimit !== undefined ? (deXuat.upperLimit as any) : null,
        proposedNominal: input.proposedNominal != null ? (String(input.proposedNominal) as any) : undefined,
        comment: input.comment,
        status: STATUS_PENDING,
      }).returning();
      return row;
    }),

  // OP1 — SoD + quality role gate. A quality manager (or supervisor/admin)
  // accepts, and they must NOT be the requester.
  approve: qualityProcedure
    .input(z.object({
      id: z.number().int().positive(),
      apply: z.boolean().default(true),
      comment: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const row = await getById(input.id);
      if (row.status !== STATUS_PENDING) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "approveThreshold" }, `Cannot approve from status ${row.status}`);
      }
      // OP1 Segregation of Duties — requester ≠ approver. `requestedBy` ≤ 0
      // (AI auto-tune sentinel) or null counts as system/non-self.
      assertApprovalSoD(row.requestedBy, ctx.user.id);

      const updated = await decideApproval(db, row, ctx.user.id, input.comment, input.apply);
      return updated;
    }),

  // Batch approve (OP8) — per-item SoD + state validity; atomic per item so one
  // bad id never blocks the rest. Returns a per-id outcome for the UI.
  batchApprove: qualityProcedure
    .input(z.object({
      ids: z.array(z.number().int().positive()).min(1).max(200),
      apply: z.boolean().default(true),
      comment: z.string().max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");

      // F14 — như trên: kết quả từng dòng của một lô, trả về bằng cửa THÀNH CÔNG.
      const results: Array<{ id: number; status: "approved" | "skipped" | "failed"; reason?: string; errorCode?: "OPERATION_FAILED"; errorParams?: Record<string, string | number> }> = [];
      // De-dupe while preserving order.
      const ids = [...new Set(input.ids)];
      for (const id of ids) {
        try {
          const row = await getById(id);
          if (row.status !== STATUS_PENDING) {
            results.push({ id, status: "skipped", reason: `not pending (status=${row.status})` });
            continue;
          }
          try {
            assertApprovalSoD(row.requestedBy, ctx.user.id);
          } catch {
            results.push({ id, status: "failed", reason: "segregation of duties: cannot approve your own request" });
            continue;
          }
          await decideApproval(db, row, ctx.user.id, input.comment, input.apply);
          results.push({ id, status: "approved" });
        } catch (err: any) {
          results.push({
            id,
            status: "failed",
            // data-raw-ok: chi tiết KỸ THUẬT cho DÒNG này trong lô.
            reason: err?.message ?? "error",
            errorCode: "OPERATION_FAILED",
            errorParams: { operation: "approveThreshold" },
          });
        }
      }
      const summary = {
        approved: results.filter((r) => r.status === "approved").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        failed: results.filter((r) => r.status === "failed").length,
      };
      return { results, summary };
    }),

  reject: qualityProcedure
    .input(z.object({
      id: z.number().int().positive(),
      comment: z.string().max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const row = await getById(input.id);
      if (row.status !== STATUS_PENDING) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "rejectThreshold" }, `Cannot reject from status ${row.status}`);
      }
      const [updated] = await db.update(thresholdApprovals)
        .set({
          status: STATUS_REJECTED,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decidedComment: input.comment,
          updatedAt: new Date(),
        })
        .where(eq(thresholdApprovals.id, input.id))
        .returning();
      return updated;
    }),

  // Requester-only pull-back — stays open to any authenticated user because the
  // requester may be an engineer/operator, but ONLY the original requester.
  withdraw: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      comment: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const row = await getById(input.id);
      if (row.status !== STATUS_PENDING) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "withdrawThreshold" }, `Cannot withdraw from status ${row.status}`);
      }
      if (row.requestedBy !== ctx.user.id) {
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "withdrawThreshold" }, "Only the requester can withdraw");
      }
      const [updated] = await db.update(thresholdApprovals)
        .set({
          status: STATUS_WITHDRAWN,
          decidedBy: ctx.user.id,
          decidedAt: new Date(),
          decidedComment: input.comment,
          updatedAt: new Date(),
        })
        .where(eq(thresholdApprovals.id, input.id))
        .returning();
      return updated;
    }),

  /** Wave 2 đường A — số đề xuất ĐANG CHỜ theo từng điểm đo, để gắn badge ngay trên /products. */
  countPendingByProduct: protectedProcedure
    .input(z.object({ productModelId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const { countPendingByPoint } = await import("../services/thresholdApprovalCount");
      return countPendingByPoint(input.productModelId);
    }),

  // OP8 — list now resolves point + product metadata so the reviewer sees
  // pointCode / pointName / productCode / productName instead of just MP-{id}.
  list: protectedProcedure
    .input(z.object({
      pointDefId: z.number().int().positive().optional(),
      status: z.enum(["requested", "approved", "rejected", "applied", "withdrawn"]).optional(),
      requestedBy: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(500).default(100),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");
      const conds = [] as any[];
      if (input?.pointDefId) conds.push(eq(thresholdApprovals.pointDefId, input.pointDefId));
      if (input?.status) conds.push(eq(thresholdApprovals.status, input.status));
      if (input?.requestedBy) conds.push(eq(thresholdApprovals.requestedBy, input.requestedBy));

      const rows = await db.select().from(thresholdApprovals)
        .where(conds.length ? (and(...conds) as any) : undefined)
        .orderBy(desc(thresholdApprovals.createdAt))
        .limit(input?.limit ?? 100);

      // Resolve point + product metadata in two batched lookups (mirrors the
      // name-resolution pattern in inspectionProgramService.listReleases — no
      // SQL join so the shape stays trivially testable).
      const pointIds = [...new Set(rows.map((r) => r.pointDefId).filter((v): v is number => v != null))];
      const pointMeta = new Map<number, { code: string | null; name: string | null; productModelId: number | null }>();
      const productMeta = new Map<number, { code: string | null; name: string | null }>();

      if (pointIds.length > 0) {
        const points = await db
          .select({
            id: measurementPointDefs.id,
            code: measurementPointDefs.code,
            name: measurementPointDefs.name,
            productModelId: measurementPointDefs.productModelId,
          })
          .from(measurementPointDefs)
          .where(inArray(measurementPointDefs.id, pointIds));
        for (const p of points) {
          pointMeta.set(p.id, { code: p.code ?? null, name: p.name ?? null, productModelId: p.productModelId ?? null });
        }

        const productIds = [...new Set(
          [...pointMeta.values()].map((p) => p.productModelId).filter((v): v is number => v != null),
        )];
        if (productIds.length > 0) {
          const products = await db
            .select({ id: productModels.id, code: productModels.code, name: productModels.name })
            .from(productModels)
            .where(inArray(productModels.id, productIds));
          for (const p of products) {
            productMeta.set(p.id, { code: p.code ?? null, name: p.name ?? null });
          }
        }
      }

      return rows.map((r) => {
        const pm = pointMeta.get(r.pointDefId);
        const prod = pm?.productModelId != null ? productMeta.get(pm.productModelId) : undefined;
        return {
          ...r,
          pointCode: pm?.code ?? null,
          pointName: pm?.name ?? null,
          productModelId: pm?.productModelId ?? null,
          productCode: prod?.code ?? null,
          productName: prod?.name ?? null,
        };
      });
    }),

  // OP8 — restore a point's PREVIOUS limits from measurement_point_versions.
  // Target by approvalId (resolves to its pointDefId) or directly by pointDefId.
  // Uses updateMeasurementPointDef so the revert is itself versioned + audited.
  revert: qualityProcedure
    .input(z.object({
      approvalId: z.number().int().positive().optional(),
      pointDefId: z.number().int().positive().optional(),
      comment: z.string().max(500).optional(),
    }).refine((d) => d.approvalId != null || d.pointDefId != null, {
      message: "approvalId or pointDefId is required",
    }))
    .mutation(async ({ ctx, input }) => {
      // BG-126 — chặn Ở INPUT, TRƯỚC bất kỳ đọc/ghi DB nào.
      assertChangeReasonKhongGiaTienToBienThe(input.comment, "comment");
      const db = await getDb();
      if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "DB unavailable");

      let pointDefId = input.pointDefId ?? null;
      const approvalId = input.approvalId ?? null;
      if (approvalId != null) {
        const appr = await getById(approvalId);
        pointDefId = appr.pointDefId;
      }
      if (pointDefId == null) {
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "revertThresholdToSnapshot" }, "Could not resolve a point to revert");
      }

      // Latest prior snapshot = the state BEFORE the most recent edit (that is
      // exactly what we want to restore).
      const [snap] = await db
        .select()
        .from(measurementPointVersions)
        .where(eq(measurementPointVersions.pointDefId, pointDefId))
        .orderBy(desc(measurementPointVersions.version))
        .limit(1);
      if (!snap) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPointVersion" }, `No prior version snapshot to revert to for point ${pointDefId}`);
      }
      const prev = ((snap as any).snapshotJson ?? {}) as Record<string, any>;

      const [cur] = await db
        .select()
        .from(measurementPointDefs)
        .where(eq(measurementPointDefs.id, pointDefId))
        .limit(1);
      if (!cur) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "measurementPoint" }, `measurement_point_def ${pointDefId} not found`);
      }

      const restored = {
        lowerLimit: prev.lowerLimit ?? null,
        upperLimit: prev.upperLimit ?? null,
        nominalValue: prev.nominalValue ?? null,
        toleranceMode: prev.toleranceMode ?? null,
        tolPlus: prev.tolPlus ?? null,
        tolMinus: prev.tolMinus ?? null,
      };

      await updateMeasurementPointDef(pointDefId, restored as any, {
        changedBy: ctx.user.id,
        changeReason: input.comment ?? "threshold.revert (doc31 OP8)",
      });

      try {
        await createAuditLog({
          userId: ctx.user.id,
          userName: (ctx.user as any).name ?? undefined,
          action: "threshold.revert",
          entityType: "measurement_point_def",
          entityId: pointDefId,
          details: {
            approvalId,
            fromVersion: (snap as any).version,
            before: {
              lowerLimit: (cur as any).lowerLimit,
              upperLimit: (cur as any).upperLimit,
              nominalValue: (cur as any).nominalValue,
            },
            after: restored,
          },
          status: "success",
        });
      } catch (err) {
        console.warn("audit log failed (threshold.revert)", err);
      }

      return { ok: true, pointDefId, restored };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => getById(input.id)),
});
