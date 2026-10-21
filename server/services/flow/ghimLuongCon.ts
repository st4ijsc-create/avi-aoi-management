/**
 * ★★★ H1 (audit bảo mật 2026-10-21) — GHIM PHIÊN BẢN LUỒNG CON.
 *
 * Lỗ: `luong.goi-con` / tool `ai.agent` gọi PHIÊN BẢN HOẠT ĐỘNG HIỆN TẠI của luồng con, còn admin chỉ duyệt hạng + nội dung của luồng
 * CHA. Một người ghi (operator…) tự `luu` + `datPhienBanHoatDong` phiên bản mới của con (hạng thuần/đọc không đòi admin) rồi đổi đầu ra
 * mà cha — hạng `ngoai-ghi`, có credential — đưa thẳng vào URL/body của một POST. Cổng "admin duyệt hạng cao" bị vòng bằng DỮ LIỆU.
 *
 * Sửa: định nghĩa cha MANG phiên bản con (`parameters.version`):
 *   • LÚC LƯU, tham chiếu thiếu `version` ⇒ máy chủ ghim = phiên bản HOẠT ĐỘNG hiện tại của con (con chưa có bản hoạt động ⇒ lỗi như cũ);
 *   • hạng của cha tính trên ĐÚNG bản ghim (con có nhiều bản hạng khác nhau ⇒ bản ghim quyết định);
 *   • LÚC CHẠY (`luong.ts`): chạy đúng bản ghim; bật bản mới của con KHÔNG đổi cha — muốn cập nhật phải LƯU LẠI cha, tức là hạng ≥ ngoai-ghi
 *     phải được duyệt lại; con đang TẮT (kill switch) ⇒ từ chối; định nghĩa cũ không có `version` ⇒ từ chối, KHÔNG fallback im lặng.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { aiFlowVersions, aiFlows } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { LOAI_AGENT, LOAI_GOI_LUONG_CON, luongConThamChieu, type HangTacDungPhu, type ThamChieuLuongCon } from "../../../shared/flow/model";

type NutTho = { id?: unknown; type?: unknown; parameters?: unknown };

const nutCua = (raw: unknown): NutTho[] => {
  const nodes = (raw as { nodes?: unknown })?.nodes;
  return Array.isArray(nodes) ? (nodes.filter((n) => n && typeof n === "object") as NutTho[]) : [];
};
const thamSoCua = (n: NutTho): Record<string, unknown> => (n.parameters && typeof n.parameters === "object" ? (n.parameters as Record<string, unknown>) : {});

/** Mọi tham chiếu luồng con (đọc thô, trước khi kiểm). */
export function thamChieuTho(raw: unknown): ThamChieuLuongCon[] {
  const ra: ThamChieuLuongCon[] = [];
  for (const n of nutCua(raw)) {
    ra.push(...luongConThamChieu({ id: String(n.id ?? ""), type: String(n.type ?? ""), parameters: thamSoCua(n) }).refs);
  }
  return ra;
}

/** Phiên bản HOẠT ĐỘNG của các luồng (flowId → version; vắng ⇒ không có bản hoạt động). */
async function phienBanHoatDongCua(ids: readonly string[]): Promise<Map<string, number>> {
  const ra = new Map<string, number>();
  if (!ids.length) return ra;
  const db = await getDb();
  if (!db) return ra;
  const rows = await db.select({ id: aiFlows.id, v: aiFlows.activeVersion }).from(aiFlows).where(inArray(aiFlows.id, [...ids]));
  for (const r of rows) if (r.v) ra.set(r.id, r.v);
  return ra;
}

/**
 * Bản sao định nghĩa với MỌI tham chiếu luồng con thiếu `version` được ghim = phiên bản hoạt động hiện tại của con. Tham chiếu đã có
 * `version` giữ nguyên (người lưu chủ động ghim bản cũ/khác). Con không có bản hoạt động ⇒ để nguyên (kiemLuong báo lỗi).
 */
export async function ghimLuongCon<T>(raw: T): Promise<T> {
  const ban = structuredClone(raw);
  const ids = [...new Set(thamChieuTho(ban).filter((r) => r.version === undefined).map((r) => r.flowId))];
  if (!ids.length) return ban;
  const hd = await phienBanHoatDongCua(ids);
  const ghim = (o: unknown) => {
    const x = o as { flowId?: unknown; version?: unknown } | null;
    if (!x || typeof x.flowId !== "string" || (x.version !== undefined && x.version !== null)) return;
    const v = hd.get(x.flowId);
    if (v !== undefined) x.version = v;
  };
  for (const n of nutCua(ban)) {
    const p = thamSoCua(n);
    if (n.type === LOAI_GOI_LUONG_CON) ghim(p);
    else if (n.type === LOAI_AGENT && Array.isArray(p.luongCon)) (p.luongCon as unknown[]).forEach(ghim);
  }
  return ban;
}

/** Bộ tra hạng cho `kiemLuong({ hangLuongCon })`: có `version` ⇒ hạng ĐÚNG bản đó; vắng ⇒ hạng bản hoạt động (đường xem trước). */
export async function hangLuongConGhim(refs: readonly ThamChieuLuongCon[]): Promise<(flowId: string, version?: number) => HangTacDungPhu | null> {
  const bang = new Map<string, HangTacDungPhu | null>();
  const key = (f: string, v?: number) => `${f}@${v ?? "*"}`;
  const db = await getDb();
  if (db && refs.length) {
    const ghim = refs.filter((r) => r.version !== undefined);
    const khongGhim = [...new Set(refs.filter((r) => r.version === undefined).map((r) => r.flowId))];
    if (ghim.length) {
      const rows = await db
        .select({ f: aiFlowVersions.flowId, v: aiFlowVersions.version, h: aiFlowVersions.riskClass })
        .from(aiFlowVersions)
        .where(sql`(${aiFlowVersions.flowId}, ${aiFlowVersions.version}) IN (${sql.join(ghim.map((r) => sql`(${r.flowId}, ${r.version})`), sql`, `)})`);
      for (const r of rows) bang.set(key(r.f, r.v), r.h as HangTacDungPhu);
    }
    if (khongGhim.length) {
      const rows = await db
        .select({ f: aiFlows.id, h: aiFlowVersions.riskClass })
        .from(aiFlows)
        .innerJoin(aiFlowVersions, and(eq(aiFlowVersions.flowId, aiFlows.id), eq(aiFlowVersions.version, aiFlows.activeVersion)))
        .where(inArray(aiFlows.id, khongGhim));
      for (const r of rows) bang.set(key(r.f), r.h as HangTacDungPhu);
    }
  }
  return (f, v) => bang.get(key(f, v)) ?? null;
}
