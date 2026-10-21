/**
 * ★★ Luồng AI Đợt 8.4 — NODE `luong.goi-con`: gọi một PHIÊN BẢN ĐÃ GHIM (H1, 2026-10-21 — trước đây: phiên bản hoạt động hiện tại) của một luồng khác với các item đầu vào, CHỜ nó xong
 * rồi đi tiếp với đầu ra node cuối của nó (cổng `main`). Spec §4.5 ("gọi sub-flow"), §4.6 (hạng luồng gồm cả sub-flow).
 *
 * Cách chờ — BỀN, không giữ worker: node trả `YeuCauCho` kind `luong-con` mang yêu cầu tạo lượt con; động cơ ghi hàng chờ
 * của cha VÀ tạo lượt con trong CÙNG MỘT giao dịch (con không thể xong trước khi cha kịp chờ; chạy lại node sau sập ⇒ hàng
 * chờ đã có ⇒ không tạo con thứ hai). Con đóng ⇒ `dongRun` trả lời hàng chờ của cha trong giao dịch đóng con. Con lỗi/huỷ ⇒
 * bước của cha lỗi (theo `khiLoi`). Cha lỗi/huỷ ⇒ con đang chạy bị huỷ.
 *
 * Hạng: tham số `flowId` là chuỗi CỐ ĐỊNH (kiemLuong từ chối biểu thức); hạng của luồng cha đã gồm hạng phiên bản hoạt động
 * của con LÚC LƯU. Lúc CHẠY kiểm lại (con có thể đã đổi phiên bản hoạt động): hạng con > hạng phiên bản cha đang chạy ⇒ TỪ CHỐI.
 * Lồng sâu > `DO_SAU_LUONG_CON_TOI_DA` hoặc vòng (con đã có trong chuỗi cha) ⇒ từ chối.
 * Lượt con bắt đầu ở node `kich-hoat.thu-cong` (hoặc `kich-hoat.mcp`) không tắt của nó.
 */
import { DO_SAU_LUONG_CON_TOI_DA, LOAI_GOI_LUONG_CON, TRAN_ITEM_GOI_CON, TRAN_LUOT_TRONG_CAY, type FlowDefinition, type HangTacDungPhu } from "../../../../shared/flow/model";
import { dangKyNut, type NguCanhChay } from "../dangKyNut";
import { and, eq, sql } from "drizzle-orm";
import { aiFlowVersions, aiFlows } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";

export class LoiLuongCon extends Error {
  /** `ma`: mã ỔN ĐỊNH (không dịch) cho chú giải ở UI. */
  constructor(message: string, public readonly ma?: string) {
    super(message);
    this.name = "LoiLuongCon";
  }
}

/** Node kích hoạt mà lượt con (gọi từ luồng khác / agent / MCP) bắt đầu ở đó. */
export function nutVaoLuongCon(def: FlowDefinition, uuTien: readonly string[] = ["kich-hoat.thu-cong", "kich-hoat.mcp"]): string | null {
  for (const t of uuTien) {
    const n = def.nodes.find((x) => x.type === t && !x.disabled);
    if (n) return n.id;
  }
  return null;
}

/** Số lượt trong cây lượt có gốc `rootRunId` (gồm gốc). */
export async function demLuotTrongCay(rootRunId: string): Promise<number> {
  const db = await getDb();
  if (!db) throw new LoiLuongCon("không có kết nối CSDL");
  const [r] = (await db.execute(sql`WITH RECURSIVE c AS (
      SELECT id, 0 AS d FROM ai_flow_runs WHERE id = ${rootRunId}::uuid
      UNION ALL SELECT r.id, c.d + 1 FROM ai_flow_runs r JOIN c ON r."parentRunId" = c.id WHERE c.d < 16)
    SELECT count(*)::int AS n FROM c`)) as unknown as { n: number }[];
  return r?.n ?? 0;
}

/** Bản ĐÃ GHIM của một luồng con: định nghĩa + hạng của đúng bản đó + cờ BẬT của luồng (tắt ⇒ không gọi). */
async function docBanGhim(flowId: string, version: number): Promise<{ version: number; hang: HangTacDungPhu; enabled: boolean; def: FlowDefinition } | null> {
  const db = await getDb();
  if (!db) throw new LoiLuongCon("không có kết nối CSDL");
  const [f] = await db.select({ enabled: aiFlows.enabled }).from(aiFlows).where(eq(aiFlows.id, flowId));
  if (!f) return null;
  const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, flowId), eq(aiFlowVersions.version, version)));
  if (!v) return null;
  return { version: v.version, hang: v.riskClass as HangTacDungPhu, enabled: f.enabled, def: v.definition as FlowDefinition };
}

/**
 * Kiểm LÚC CHẠY trước khi gọi một luồng con (dùng chung `luong.goi-con` và tool của `ai.agent`): ĐÚNG phiên bản ĐÃ GHIM trong
 * định nghĩa cha (H1), luồng con đang BẬT (tắt = kill switch), hạng của bản ghim ≤ hạng phiên bản cha đang chạy, không vòng,
 * không quá sâu, có node vào. Trả phiên bản + node vào.
 *
 * ★ H1: KHÔNG còn đọc "phiên bản hoạt động hiện tại" của con — bật bản mới của con không đổi được cha đã duyệt. Định nghĩa cũ không
 *   có `version` ⇒ TỪ CHỐI (lưu lại cha để ghim), không fallback im lặng.
 */
export async function kiemGoiLuongCon(ngu: NguCanhChay, flowIdCon: string, versionGhim?: number): Promise<{ version: number; hang: HangTacDungPhu; nutVao: string; def: FlowDefinition }> {
  const { chuoiLuotCha, hangDu, hangPhienBan } = await import("../dongCo");
  // Đợt 9 (IDOR) — luồng con phải thuộc phạm vi CHỦ LƯỢT; vắng bộ kiểm / ngoài phạm vi ⇒ cùng câu với "không tồn tại" (không lộ).
  if (!ngu.kiemPhamVi || !(await ngu.kiemPhamVi.luong(flowIdCon))) throw new LoiLuongCon(`luồng con '${flowIdCon}' không tồn tại hoặc chưa có phiên bản hoạt động`);
  if (versionGhim === undefined || !Number.isInteger(versionGhim) || versionGhim < 1) {
    throw new LoiLuongCon(`luồng con '${flowIdCon}' chưa được GHIM phiên bản trong định nghĩa luồng cha — cần LƯU LẠI luồng ${ngu.flowId} để ghim (không tự dùng phiên bản hoạt động)`);
  }
  const con = await docBanGhim(flowIdCon, versionGhim);
  if (!con) throw new LoiLuongCon(`luồng con '${flowIdCon}'@${versionGhim} không tồn tại`);
  if (!con.enabled) throw new LoiLuongCon(`từ chối: luồng con '${flowIdCon}' đang TẮT (kill switch) — không gọi được`);
  const hangCha = ngu.version ? await hangPhienBan(ngu.flowId, ngu.version) : null;
  if (!hangCha) throw new LoiLuongCon(`không xác định được hạng của luồng ${ngu.flowId}@${ngu.version ?? "?"}`);
  if (!hangDu(hangCha, con.hang)) {
    throw new LoiLuongCon(
      `từ chối: luồng con '${flowIdCon}'@${con.version} hạng '${con.hang}' cao hơn hạng '${hangCha}' của luồng ${ngu.flowId}@${ngu.version} — lưu lại luồng cha để tính lại hạng (và bật lại theo quyền của hạng mới)`,
    );
  }
  const chuoi = await chuoiLuotCha(ngu.runId);
  if (chuoi.some((c) => c.flowId === flowIdCon)) throw new LoiLuongCon(`từ chối: vòng gọi luồng ('${flowIdCon}' đã nằm trong chuỗi lượt cha)`);
  if (chuoi.length >= DO_SAU_LUONG_CON_TOI_DA) throw new LoiLuongCon(`từ chối: lồng luồng con quá ${DO_SAU_LUONG_CON_TOI_DA} cấp`);
  // M5: tổng số lượt trong CẢ CÂY lượt (gốc + mọi con/cháu) — độ sâu 4 một mình không chặn fan-out nhân bậc ba.
  const soLuot = await demLuotTrongCay(chuoi[chuoi.length - 1]!.runId);
  if (soLuot >= TRAN_LUOT_TRONG_CAY) throw new LoiLuongCon(`từ chối: cây lượt của luồng ${ngu.flowId} đã có ${soLuot} lượt (trần ${TRAN_LUOT_TRONG_CAY}) — không tạo thêm lượt con`, "CAY_LUOT_DAY");
  const nutVao = nutVaoLuongCon(con.def);
  if (!nutVao) throw new LoiLuongCon(`luồng con '${flowIdCon}' không có node kích hoạt thủ công/MCP để gọi vào`);
  return { version: con.version, hang: con.hang, nutVao, def: con.def };
}

dangKyNut({
  type: LOAI_GOI_LUONG_CON,
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  // Hạng THẬT của node = hạng luồng con — `kiemLuong` cộng vào hạng luồng (khai báo loại chỉ là sàn).
  tacDungPhu: "thuan",
  // Chạy lại sau sập: hàng chờ (runId,nodeId) đã có ⇒ động cơ không tạo lượt con thứ hai.
  lapLai: "idempotent",
  async chay(thamSo, ngu) {
    const flowIdCon = thamSo.flowId;
    if (typeof flowIdCon !== "string") throw new LoiLuongCon("luong.goi-con cần 'flowId' cố định");
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_GOI_CON) throw new LoiLuongCon(`từ chối: ${vao.length} item vào luong.goi-con vượt trần ${TRAN_ITEM_GOI_CON} — chia lô trước khi gọi`, "ITEM_GOI_CON_QUA_NHIEU");
    const k = await kiemGoiLuongCon(ngu, flowIdCon, typeof thamSo.version === "number" ? thamSo.version : undefined);
    return {
      __cho: {
        kind: "luong-con",
        items: vao,
        payload: { flowIdCon, versionCon: k.version, hangCon: k.hang },
        con: { flowId: flowIdCon, version: k.version, nutKichHoat: k.nutVao, items: vao.length ? vao : [{ json: {} }] },
      },
    };
  },
});
