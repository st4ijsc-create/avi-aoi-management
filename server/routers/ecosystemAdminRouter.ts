/**
 * U6-c (doc 21 §6 U6 / G-12) — ecosystem admin read router.
 *
 * A tiny admin-only READ surface for the soft-reference integrity checker
 * (server/services/ecosystem/integrityCheck.ts). Read-only: it runs SELECT-only
 * scans and returns an orphan report. No mutation, no device path, no flag.
 *
 * Gated with the SAME pattern as erpAdminRouter — protectedProcedure +
 * requirePermission("admin_system","canView") — so only a system admin can see
 * the integrity report.
 */
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { checkSoftRefIntegrity } from "../services/ecosystem/integrityCheck";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";

export const ecosystemAdminRouter = router({
  /**
   * Scan the canonical asset↔task↔program↔genealogy soft-refs and report orphans
   * (a non-null soft-ref pointing at a missing target row). Read-only visibility
   * into integrity drift WITHOUT a risky FK migration (G-12).
   */
  softRefIntegrity: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async ({ ctx }) => {
      const bao = await checkSoftRefIntegrity();
      // phạm vi người dùng (L6c 2026-10-25) (dieu-phoi duyệt): toàn quyền thấy đủ; người hẹp chỉ thấy SỐ ĐẾM — mẫu (id + tham chiếu mồ côi, có thể thuộc nhà máy khác) để trống
      if ((await idsTrongPhamVi("factory", phamViCua(ctx), { strict: true })) === null) return bao;
      return { ...bao, rules: bao.rules.map((r) => ({ ...r, sample: [] })) };
    }),
});
