/**
 * ★★★ Đợt 9 (IDOR) — MỘT bộ kiểm PHẠM VI cho Luồng AI: dùng chung cho chạy thử (người gọi, `ctx`), chạy thật (CHỦ LƯỢT, dựng
 * lúc chạy từ người dùng hiện tại) và kiểm tham chiếu tĩnh lúc BẬT luồng (người bật). Quy tắc duy nhất:
 *
 *   • máy phải TỒN TẠI và thuộc phạm vi (`trongPhamVi("machine", id, phạm vi)` — cùng bộ phân giải với mọi router);
 *   • ngoài phạm vi và không tồn tại KHÔNG phân biệt được (cùng `false`);
 *   • chủ lượt vắng / bị xoá / bị khoá (`isActive=false`) / vai chỉ-đọc (viewer, user — cùng sàn `writeProcedure`) ⇒ `null` ⇒ node
 *     tham chiếu tài nguyên TỪ CHỐI (đóng theo mặc định).
 */
import { eq } from "drizzle-orm";
import { machines, users } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { trongPhamVi, type PhamViNguoiXem } from "../../db/hierarchy";
import type { FlowDefinition } from "../../../shared/flow/model";
import type { BoKiemPhamVi } from "./dangKyNut";
import { chuanHoaIdMay } from "./idTaiNguyen";
import { docLuongFoeHienHanh, luongFoeTrongPhamVi } from "./ot/congOtLuong";
import { biMatTrongPhamVi, luongTrongPhamVi } from "./phamViLuong";

/** Vai KHÔNG được ghi (sàn của `writeProcedure`) — chủ lượt mang vai này ⇒ mất quyền ⇒ từ chối. */
const VAI_CHI_DOC: ReadonlySet<string> = new Set(["viewer", "user"]);

export function boKiemPhamVi(pv: PhamViNguoiXem): BoKiemPhamVi {
  return {
    async may(id) {
      if (!Number.isInteger(id) || id <= 0) return false;
      const db = await getDb();
      if (!db) return false;
      const [m] = await db.select({ id: machines.id }).from(machines).where(eq(machines.id, id)).limit(1);
      return !!m && (await trongPhamVi("machine", id, pv));
    },
    biMat: (id) => biMatTrongPhamVi(pv, id),
    luong: (flowId) => luongTrongPhamVi(pv, flowId),
  };
}

/** Chỉ lưới: bộ kiểm cho-qua-hết (test động cơ không liên quan phạm vi, vd bí mật / luồng con / cổng OT với máy tuỳ ý). */
export const BO_KIEM_CHO_QUA: BoKiemPhamVi = { may: async () => true, biMat: async () => true, luong: async () => true };

let ghiDeChoTest: ((userId: number | null | undefined) => Promise<BoKiemPhamVi | null>) | null = null;
/** Chỉ lưới: thay cách dựng bộ kiểm cho chủ lượt (vd. cho phép mọi máy khi test cổng OT). `null` ⇒ về mặc định. */
export function __datBoKiemChuLuongChoTest(f: typeof ghiDeChoTest): void {
  ghiDeChoTest = f;
}

/** Bộ kiểm của CHỦ LƯỢT, tính từ người dùng HIỆN TẠI. `null` ⇒ không có chủ hợp lệ (đóng). */
export async function boKiemChoChuLuong(userId: number | null | undefined): Promise<BoKiemPhamVi | null> {
  if (ghiDeChoTest) return ghiDeChoTest(userId);
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return null;
  const db = await getDb();
  if (!db) return null;
  const [u] = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, userId)).limit(1);
  if (!u || u.isActive === false || VAI_CHI_DOC.has(String(u.role))) return null;
  return boKiemPhamVi({ userId: u.id, userRole: String(u.role) });
}

/**
 * Kiểm tham chiếu TĨNH của một định nghĩa luồng (id viết thẳng trong tham số, không phải biểu thức) so với phạm vi `boKiem` — gọi lúc
 * BẬT luồng. Biểu thức động để kiểm lúc chạy. Trả danh sách lỗi (rỗng ⇒ ổn); thông điệp không phân biệt "ngoài phạm vi" / "không có".
 */
export async function kiemThamChieuTinh(def: FlowDefinition, boKiem: BoKiemPhamVi): Promise<string[]> {
  const loi: string[] = [];
  for (const n of def.nodes) {
    const t = n.parameters ?? {};
    // id viết thẳng (số hoặc chuỗi số — cùng chuẩn hoá như node); biểu thức `{{ … }}` để kiểm lúc chạy.
    const tinh = (v: unknown): number | null => (typeof v === "string" && v.includes("{{") ? null : chuanHoaIdMay(v));
    const may = tinh(t.may);
    if ((n.type === "ot.doc-tag" || n.type === "ot.de-xuat-lenh") && may !== null && !(await boKiem.may(may))) {
      loi.push(`node "${n.id}" tham chiếu máy ngoài phạm vi của bạn hoặc không tồn tại`);
    }
    const wid = tinh(t.workflowId);
    const ver = tinh(t.version);
    if (n.type === "ot.de-xuat-luong" && wid !== null && ver !== null) {
      const wf = await docLuongFoeHienHanh(wid, ver);
      if (!wf || !(await luongFoeTrongPhamVi(wf.definition, boKiem))) loi.push(`node "${n.id}" tham chiếu FOE workflow ngoài phạm vi của bạn hoặc không tồn tại`);
    }
  }
  return loi;
}
