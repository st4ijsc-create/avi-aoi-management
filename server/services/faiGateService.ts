/**
 * First-Article-Inspection (FAI) gate — doc 35 Wave W4-B, task 3.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * FAI was schema-only (inspectionVariant faiPayloadSchema): nothing ever blocked
 * production acceptance of a product on a machine until a first-article passed.
 * This service adds the enforcement SEAM.
 *
 * A "passing FAI" = a product_inspections row with inspectionType='FAI' and
 * overallResult='OK' for the (productModelId [, machineId]) scope. Resolution:
 *   • a machine-scoped passing FAI wins; otherwise
 *   • a product-level passing FAI (any machine) is accepted as fallback.
 *
 * FLAG: FAI_GATE_ENABLED (default OFF). When OFF, getFaiStatus still reports the
 * true status (advisory), but assertFaiPassed NEVER throws — current flows are
 * untouched. When ON, assertFaiPassed throws a FORBIDDEN the caller surfaces as a
 * blocking status the operator can act on (run + pass an FAI, then retry).
 *
 * This gate is wired into the inspection-program RELEASE path (a deliberate
 * governance action), NOT the high-volume ingest path — so a missing FAI never
 * hard-breaks ingest.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { appError } from "../_core/appError";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../db/connection";
import { productInspections } from "../../drizzle/schema";

export function isFaiGateEnabled(): boolean {
  return process.env.FAI_GATE_ENABLED === "true";
}

export interface FaiGateStatus {
  productModelId: number;
  machineId: number | null;
  passed: boolean;
  /** id of the passing FAI inspection (machine-scoped preferred), or null. */
  faiInspectionId: number | null;
  /** "machine" = FAI matched this machine; "product" = product-level fallback. */
  matchedLevel: "machine" | "product" | null;
  /** false when FAI_GATE_ENABLED=off — the status is advisory only. */
  enforced: boolean;
}

/**
 * Resolve FAI status for a product on a machine (no throw). Pure read.
 */
export async function getFaiStatus(
  productModelId: number,
  machineId?: number | null,
): Promise<FaiGateStatus> {
  const enforced = isFaiGateEnabled();
  const base: FaiGateStatus = {
    productModelId,
    machineId: machineId ?? null,
    passed: false,
    faiInspectionId: null,
    matchedLevel: null,
    enforced,
  };
  const d = await getDb();
  if (!d) return base; // honest: cannot confirm ⇒ not passed (fail-safe when enforced)

  // Machine-scoped passing FAI first.
  if (machineId != null) {
    const [row] = await d
      .select({ id: productInspections.id })
      .from(productInspections)
      .where(and(
        eq(productInspections.productModelId, productModelId),
        eq(productInspections.machineId, machineId),
        eq(productInspections.inspectionType, "FAI"),
        eq(productInspections.overallResult, "OK"),
      ))
      .orderBy(desc(productInspections.id))
      .limit(1);
    if (row) return { ...base, passed: true, faiInspectionId: row.id, matchedLevel: "machine" };
  }

  // Product-level fallback (any machine).
  const [pRow] = await d
    .select({ id: productInspections.id })
    .from(productInspections)
    .where(and(
      eq(productInspections.productModelId, productModelId),
      eq(productInspections.inspectionType, "FAI"),
      eq(productInspections.overallResult, "OK"),
    ))
    .orderBy(desc(productInspections.id))
    .limit(1);
  if (pRow) return { ...base, passed: true, faiInspectionId: pRow.id, matchedLevel: "product" };

  return base;
}

/**
 * Assert a passing FAI exists. Returns the resolved status when it may proceed.
 * Throws FORBIDDEN ONLY when FAI_GATE_ENABLED is ON and no passing FAI exists —
 * so with the flag OFF this is a pure no-op pass-through.
 */
export async function assertFaiPassed(
  productModelId: number,
  machineId?: number | null,
): Promise<FaiGateStatus> {
  const status = await getFaiStatus(productModelId, machineId);
  if (status.enforced && !status.passed) {
    // reason "faiNotPassed" mang {{productModelId}} — khôi phục chỉ dẫn hành
    // động CỤ THỂ (sản phẩm nào cần FAI) thay vì câu chung chung, đúng tinh
    // thần Task 5 (F4). machineId (tuỳ chọn, không có trong mọi lần gọi) CỐ Ý
    // không đưa vào reason template (placeholder bắt buộc phải LUÔN có mặt) —
    // vẫn còn nguyên trong fallbackMessage.
    throw appError(
      "FORBIDDEN",
      "OPERATION_FAILED",
      { operation: "acceptFaiProduction", reason: "faiNotPassed", productModelId },
      `First-Article Inspection (FAI) chưa PASS cho sản phẩm #${productModelId}` +
        (machineId != null ? ` trên máy #${machineId}` : "") +
        ` — thực hiện & đạt FAI trước khi phát hành/chấp nhận sản xuất. ` +
        `Production acceptance is blocked until a passing FAI (inspectionType='FAI', result OK) exists.`,
    );
  }
  return status;
}
