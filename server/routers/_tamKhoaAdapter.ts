/**
 * SCADA R1b-2b-2b Phần A — C2 mục 2.2 (dieu-phoi 2026-10-30, từ 2a T3B-0) — trường POSTURE `tamKhoa` của hàng adapter
 * (`scadaDiag.danhSach`, `deviceAdapter.list|get|create|update` qua `redactAdapterRow`).
 *
 * HỢP ĐỒNG (Phần B — huy hiệu "tạm khoá"): `tamKhoa: { ma: string; lyDo: string } | null`.
 *   • Adapter MC (`mitsubishi-mc`) do TRUNG TÂM chạy, khi driver đang tạm khoá ghi (`mcGhiTamKhoa()` — luôn đúng ở sản xuất tới bản sửa 3B) ⇒
 *     `{ ma: "OT_MC_TAM_KHOA", lyDo: "errors.reason.otMcTamKhoa" }` (`lyDo` = KHOÁ i18n, vi / en / zh).
 *   • Lấy từ TRẠNG THÁI KHOÁ của driver, KHÔNG từ `lastError`: khoá có hiệu lực cả khi adapter đang `connected` (không có lỗi nào).
 *   • Adapter do EDGE sở hữu ⇒ `null` (trung tâm không bảo chứng cho bản build của edge — cùng luật T3B-0 fix 1 ở `loi` của M10).
 *   • KHÔNG BAO GIỜ bị che dưới canEdit (khác `endpoint` / `lastError` — `_chiTietKyThuat.ts`): người vận hành phải thấy thiết bị đang khoá
 *     (STOP qua MC không đi được — dùng E-STOP cứng). Test `scadaDiagRouter.tomTat.r1b2b2b.db.test.ts` khẳng định vai vận hành thấy.
 */
import { sql } from "drizzle-orm";
import { MA_MC_TAM_KHOA, mcGhiTamKhoa } from "../services/ot/drivers/mitsubishiMcDriver";
import { isEdgeControlSchemaMissing } from "../services/edge/edgeControlSchema";

export type TamKhoaAdapter = { ma: string; lyDo: string };

/** Khoá i18n (server `errors.reason.*`, vi / en / zh) giải thích khoá ghi MC. */
export const KHOA_I18N_MC_TAM_KHOA = "errors.reason.otMcTamKhoa";

/** Posture tạm khoá của MỘT adapter (thuần, không DB). */
export function tamKhoaAdapter(protocol: string, laEdge: boolean): TamKhoaAdapter | null {
  if (protocol !== "mitsubishi-mc" || laEdge) return null;
  return mcGhiTamKhoa() ? { ma: MA_MC_TAM_KHOA, lyDo: KHOA_I18N_MC_TAM_KHOA } : null;
}

/** Có hàng nào cần tra sở hữu edge để quyết `tamKhoa` không (chỉ MC khi đang khoá) — tránh một lượt DB cho trường hợp thường. */
export function canTraEdgeChoTamKhoa(rows: ReadonlyArray<{ protocol: string }>): boolean {
  return rows.some((r) => r.protocol === "mitsubishi-mc") && mcGhiTamKhoa();
}

type DbThucThi = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Tập id adapter do EDGE sở hữu (`device_adapters."edgeNodeId"`, mig 0374 — không có trong schema drizzle). Thiếu schema edge ⇒ tập rỗng (mọi adapter là
 * trung tâm, như `scadaDiag.soHuuEdge`); lỗi khác ⇒ ném (không đoán "trung tâm" — sẽ gắn nhầm huy hiệu khoá cho adapter edge).
 */
export async function idsAdapterDoEdge(db: DbThucThi, ids: number[]): Promise<Set<number>> {
  const out = new Set<number>();
  if (ids.length === 0) return out;
  try {
    const rows = (await db.execute(sql`SELECT a."id" AS id FROM device_adapters a WHERE a."edgeNodeId" IS NOT NULL AND a."id" IN (${sql.join(
      ids.map((i) => sql`${i}`),
      sql`, `,
    )})`)) as unknown as Array<{ id: number }>;
    for (const r of rows) out.add(Number(r.id));
  } catch (err) {
    if (!isEdgeControlSchemaMissing(err)) throw err;
  }
  return out;
}
