/**
 * Phạm vi NHÀ MÁY của phiên / hàng agent — luật "ngoài phạm vi ≡ không thấy" cho các màn đọc CHÉO NGƯỜI của AI
 * (Command Center: aiAgentCenter.getReadModel/getRoster, aiAgent.listAgentSessionsForOps, kênh socket `ai:agents`).
 *
 * ★ Gốc lỗi: `ai_agent_sessions` / `ai_specialist_sessions` / `ai_pending_actions` KHÔNG có cột nhà máy, chỉ có `userId`.
 *   Màn chéo-người cho MỌI engineer đọc mục tiêu của MỌI người ở MỌI nhà máy. Phạm vi của một hàng = phạm vi NHÀ MÁY CỦA CHỦ HÀNG.
 *
 * ★ KHÔNG viết bộ phân giải thứ hai (luật G12): phạm vi người dùng đi qua ĐÚNG `resolveTenantFactoryScope` (db/reportAggregators — nó
 *   gọi `resolveDataScope`/`getUserAssignmentCodes`, tính cả `corporateCodes`) ở chế độ `strict` (DB chính vắng ⇒ ném ⇒ ở đây là CHẶN).
 *
 * Phép quyết định DUY NHẤT (`chuThayDuoc`), `null` = toàn quyền, `[]` = đã phân giải và KHÔNG có nhà máy nào (hai câu khác hẳn nhau):
 *   • người xem toàn quyền (admin)                        ⇒ thấy hết
 *   • người xem là CHÍNH chủ hàng                          ⇒ thấy
 *   • chủ hàng toàn quyền (admin) mà người xem thì không   ⇒ KHÔNG (phiên của admin không lộ cho engineer)
 *   • một bên không có nhà máy nào / không phân giải được ⇒ KHÔNG (fail-closed)
 *   • ngược lại                                            ⇒ thấy khi hai tập nhà máy GIAO nhau
 *
 * Bộ nhớ đệm phạm vi chủ hàng: TTL NGẮN (≤ 30 s) — nợ ghi nhận: khi hook F5 (đổi phân công / vai / isActive) của scada-master lên main,
 * `xoaCachePhamViChu` được nối vào ĐÚNG hook đó, không tự dựng hook thứ hai.
 */
import { inArray } from "drizzle-orm";

export type PhamViNhaMay = number[] | null;

export interface NguoiXemAgent {
  id: number;
  role: string;
}

/** Trần TTL của bộ đệm phạm vi chủ hàng (ms). Nợ: thay bằng hook F5 khi có. */
export const TTL_PHAM_VI_CHU_MS = 30_000;

export interface PhuThuocPhamVi {
  /** Phạm vi nhà máy của một người (ném khi không phân giải được ⇒ người gọi coi như chặn). */
  phanGiai(u: { userId: number; userRole: string }): Promise<PhamViNhaMay>;
  /** Vai của các chủ hàng (id → role); id không có trong bảng users ⇒ vắng khỏi Map. */
  layVaiTro(ids: number[]): Promise<Map<number, string>>;
  /** Đồng hồ (ms) — tiêm được để test TTL. */
  bay(): number;
}

/** THUẦN. Xem docblock đầu tệp. `chu === undefined` = chưa/không phân giải được. */
export function chuThayDuoc(nguoiXem: { id: number; pv: PhamViNhaMay }, chu: { id: number; pv: PhamViNhaMay | undefined }): boolean {
  if (nguoiXem.pv === null) return true;
  if (nguoiXem.id === chu.id) return true;
  if (chu.pv === undefined || chu.pv === null) return false;
  if (nguoiXem.pv.length === 0 || chu.pv.length === 0) return false;
  const co = new Set(nguoiXem.pv);
  return chu.pv.some((f) => co.has(f));
}

const PHU_THUOC_THAT: PhuThuocPhamVi = {
  async phanGiai(u) {
    const { resolveTenantFactoryScope } = await import("../db/reportAggregators");
    const r = await resolveTenantFactoryScope({ userId: u.userId, userRole: u.userRole }, { strict: true });
    return r.factoryIds;
  },
  async layVaiTro(ids) {
    const m = new Map<number, string>();
    if (ids.length === 0) return m;
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) return m;
    const { users } = await import("../../drizzle/schema");
    const rows = await db.select({ id: users.id, role: users.role }).from(users).where(inArray(users.id, ids));
    for (const r of rows as Array<{ id: number; role: string | null }>) m.set(Number(r.id), String(r.role ?? ""));
    return m;
  },
  bay: () => Date.now(),
};

/** Cổng chỉ để TEST thay bộ phân giải/đọc vai mặc định (đối xứng `__datCongPhamViChoTest` ở socketPhongQuyen). `null` = trả về bản thật. */
let phuThuocMacDinh: PhuThuocPhamVi = PHU_THUOC_THAT;
export function __datPhuThuocChoTest(d: PhuThuocPhamVi | null): void {
  phuThuocMacDinh = d ?? PHU_THUOC_THAT;
}

const dem = new Map<number, { pv: PhamViNhaMay; het: number }>();

/** Xoá bộ đệm phạm vi chủ hàng (một người, hoặc tất cả). Điểm nối cho hook F5 / test. */
export function xoaCachePhamViChu(userId?: number): void {
  if (userId === undefined) dem.clear();
  else dem.delete(userId);
}

/** Phạm vi của NGƯỜI XEM. Admin ⇒ `null` không cần DB; lỗi phân giải ⇒ `undefined` (người gọi coi là chỉ-thấy-của-mình). */
export async function phamViNguoiXem(nv: NguoiXemAgent, dep: PhuThuocPhamVi = phuThuocMacDinh): Promise<PhamViNhaMay | undefined> {
  if (nv.role === "admin") return null;
  try {
    return await dep.phanGiai({ userId: nv.id, userRole: nv.role });
  } catch (err) {
    console.error("[aiAgentPhamVi] không phân giải được phạm vi người xem (chặn):", (err as Error)?.message ?? err);
    return undefined;
  }
}

/** Phạm vi của các CHỦ hàng; chủ không phân giải được ⇒ vắng khỏi Map (⇒ `chuThayDuoc` chặn). Dùng bộ đệm TTL. */
export async function phamViCacChu(ids: number[], dep: PhuThuocPhamVi = phuThuocMacDinh, ttl = TTL_PHAM_VI_CHU_MS): Promise<Map<number, PhamViNhaMay>> {
  const kq = new Map<number, PhamViNhaMay>();
  const bay = dep.bay();
  const thieu: number[] = [];
  for (const id of new Set(ids)) {
    const c = dem.get(id);
    if (c && c.het > bay) kq.set(id, c.pv);
    else thieu.push(id);
  }
  if (thieu.length === 0) return kq;
  let vai: Map<number, string>;
  try {
    vai = await dep.layVaiTro(thieu);
  } catch (err) {
    console.error("[aiAgentPhamVi] không đọc được vai chủ hàng (chặn):", (err as Error)?.message ?? err);
    return kq;
  }
  await Promise.all(
    thieu.map(async (id) => {
      const role = vai.get(id);
      if (role === undefined) return; // chủ không còn trong users ⇒ không phân giải ⇒ chặn
      try {
        const pv = role === "admin" ? null : await dep.phanGiai({ userId: id, userRole: role });
        dem.set(id, { pv, het: dep.bay() + ttl });
        kq.set(id, pv);
      } catch (err) {
        console.error("[aiAgentPhamVi] không phân giải được phạm vi chủ hàng (chặn):", (err as Error)?.message ?? err);
      }
    }),
  );
  return kq;
}

/**
 * Lọc danh sách hàng theo chủ. Người xem admin ⇒ trả nguyên (không DB). Người xem không phân giải được ⇒ chỉ hàng của CHÍNH họ.
 * Giữ thứ tự gốc.
 */
export async function locTheoChu<T>(hang: readonly T[], nv: NguoiXemAgent, layChuId: (h: T) => number, dep: PhuThuocPhamVi = phuThuocMacDinh): Promise<T[]> {
  if (hang.length === 0) return [];
  if (nv.role === "admin") return [...hang];
  const pvXem = await phamViNguoiXem(nv, dep);
  if (pvXem === undefined) return hang.filter((h) => layChuId(h) === nv.id);
  const chu = await phamViCacChu(hang.map(layChuId), dep);
  return hang.filter((h) => {
    const id = layChuId(h);
    return chuThayDuoc({ id: nv.id, pv: pvXem }, { id, pv: chu.get(id) });
  });
}

/** Người nhận (socket) có được nhận sự kiện của chủ `chuId` không — dùng cho bridge `ai:agents`. Chủ không rõ ⇒ chỉ admin. */
export async function nguoiNhanThayChu(nv: NguoiXemAgent, chuId: number | undefined, dep: PhuThuocPhamVi = phuThuocMacDinh): Promise<boolean> {
  if (nv.role === "admin") return true;
  if (chuId === undefined || !Number.isInteger(chuId)) return false;
  return (await locTheoChu([chuId], nv, (x) => x, dep)).length === 1;
}
