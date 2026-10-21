/**
 * ★★ Luồng AI Đợt 8.4 — NODE `luong.goi-con`: gọi PHIÊN BẢN HOẠT ĐỘNG của một luồng khác với các item đầu vào, CHỜ nó xong
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
import { DO_SAU_LUONG_CON_TOI_DA, LOAI_GOI_LUONG_CON, type FlowDefinition, type HangTacDungPhu } from "../../../../shared/flow/model";
import { dangKyNut, type NguCanhChay } from "../dangKyNut";

export class LoiLuongCon extends Error {
  constructor(message: string) {
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

/**
 * Kiểm LÚC CHẠY trước khi gọi một luồng con (dùng chung `luong.goi-con` và tool của `ai.agent`): luồng con có phiên bản hoạt
 * động, hạng của nó ≤ hạng phiên bản cha đang chạy, không vòng, không quá sâu, có node vào. Trả phiên bản + node vào.
 */
export async function kiemGoiLuongCon(ngu: NguCanhChay, flowIdCon: string): Promise<{ version: number; hang: HangTacDungPhu; nutVao: string; def: FlowDefinition }> {
  const { chuoiLuotCha, hangDu, hangPhienBan, phienBanHoatDong } = await import("../dongCo");
  // Đợt 9 (IDOR) — luồng con phải thuộc phạm vi CHỦ LƯỢT; vắng bộ kiểm / ngoài phạm vi ⇒ cùng câu với "không tồn tại" (không lộ).
  if (!ngu.kiemPhamVi || !(await ngu.kiemPhamVi.luong(flowIdCon))) throw new LoiLuongCon(`luồng con '${flowIdCon}' không tồn tại hoặc chưa có phiên bản hoạt động`);
  const con = await phienBanHoatDong(flowIdCon);
  if (!con) throw new LoiLuongCon(`luồng con '${flowIdCon}' không tồn tại hoặc chưa có phiên bản hoạt động`);
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
    const k = await kiemGoiLuongCon(ngu, flowIdCon);
    const vao = ngu.inputs.main ?? [];
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
