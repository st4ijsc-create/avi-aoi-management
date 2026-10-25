/**
 * W17a (kiểm định phamViGhi, 2026-10-25) — PHẠM VI NHÀ MÁY CỦA BÁO CÁO ĐÃ XUẤT (`report_artifacts`).
 *
 * Bảng không có cột nhà máy; "nhà máy" của một tệp là phạm vi của NGƯỜI TẠO lúc xuất (bộ xuất đã ép phạm vi đó, `reportExportScope`).
 * Trước: mọi `supervisor` / `quality_inspector` (PRIVILEGED_ROLES) xem / tải / XOÁ được tệp của MỌI người — kể cả giám sát viên chỉ gán nhà máy A
 * xoá báo cáo nhà máy B. Luật mới cho người xem vai đặc quyền KHÔNG phải admin:
 *   • tệp của chính họ ⇒ thấy;
 *   • tệp của người khác ⇒ chỉ khi phạm vi người tạo NẰM TRỌN trong phạm vi người xem (người tạo toàn quyền / chưa gán nhà máy / hệ thống
 *     createdBy NULL ⇒ KHÔNG thấy — tệp có thể chứa mọi nhà máy);
 *   • ngoài phạm vi ≡ không tồn tại (cùng `not_found`).
 * Admin và chủ thể máy–máy `privileged` (khoá API có phạm vi riêng, đã kiểm ở tầng khoá) giữ nguyên.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { resolveTenantFactoryScope } from "../db/reportAggregators";

export interface NguoiXemTep {
  id?: number | null;
  role?: string | null;
  privileged?: boolean;
}

/** Người xem có phải loại phải lọc theo phạm vi người tạo (vai đặc quyền, không admin, không phải chủ thể máy–máy)? */
export function canLocTheoNguoiTao(viewer: NguoiXemTep | null | undefined, vaiDacQuyen: ReadonlySet<string>): boolean {
  if (!viewer || viewer.privileged) return false;
  if (!viewer.role || viewer.role === "admin") return false;
  return vaiDacQuyen.has(viewer.role);
}

/**
 * Trong các `nguoiTaoIds`, những id mà người xem được thấy tệp. Chủ thể gọi đã qua `canLocTheoNguoiTao`.
 * Lỗi / thiếu CSDL ⇒ chỉ chính người xem (fail-closed).
 */
export async function nguoiTaoTrongPhamVi(viewer: NguoiXemTep, nguoiTaoIds: ReadonlyArray<number>): Promise<Set<number>> {
  const ra = new Set<number>();
  if (viewer.id == null) return ra;
  const khac = [...new Set(nguoiTaoIds.filter((x) => x !== viewer.id))];
  if (nguoiTaoIds.includes(viewer.id)) ra.add(viewer.id);
  if (khac.length === 0) return ra;
  try {
    const nx = await resolveTenantFactoryScope({ userId: viewer.id, userRole: viewer.role ?? undefined }, { strict: true });
    if (nx.factoryIds === null) {
      // người xem toàn quyền theo phạm vi (không phải admin theo tên vai) ⇒ thấy hết
      for (const x of khac) ra.add(x);
      return ra;
    }
    if (nx.factoryIds.length === 0) return ra;
    const db = await getDb();
    if (!db) return ra;
    const hang = (await db.execute(sql`SELECT id, role FROM users WHERE id IN (${sql.join(khac.map((i) => sql`${i}`), sql`, `)})`)) as unknown as Array<{ id: number; role: string }>;
    const choPhep = new Set(nx.factoryIds);
    for (const h of hang) {
      const nt = await resolveTenantFactoryScope({ userId: Number(h.id), userRole: h.role }, { strict: true });
      if (nt.factoryIds !== null && nt.factoryIds.length > 0 && nt.factoryIds.every((f) => choPhep.has(f))) ra.add(Number(h.id));
    }
  } catch {
    return new Set(ra);
  }
  return ra;
}
