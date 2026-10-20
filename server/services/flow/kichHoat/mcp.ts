/**
 * ★★ Luồng AI Đợt 8.4 — KÍCH HOẠT MCP: luồng có node `kich-hoat.mcp` được công bố thành TOOL của MCP server stdio
 * (`server/services/aiCodingCli/mcpServer.ts`). Spec §4.10 ("Luồng thành tool … Hạng tác dụng phụ đi theo").
 *
 * Tham số node: `moTa` (mô tả tool cho tác nhân gọi) · `thamSo: [{ ten, kieu: chuoi|so|boolean, batBuoc?, moTa? }]` (lược đồ
 * đầu vào JSON đơn giản). Tên tool = id luồng.
 *
 * Công bố KHI VÀ CHỈ KHI: luồng BẬT, có phiên bản hoạt động, phiên bản ấy có `kich-hoat.mcp` không tắt, hạng `thuan`/`doc`.
 * Hạng `ngoai-ghi`/`ot` KHÔNG BAO GIỜ thành tool MCP: bên kia đường ống là một TÁC NHÂN; luồng ghi ra ngoài/OT cần người
 * kích hoạt có quyền theo hạng, không phải một model gọi tool. Id trùng tiền tố `avi_` (tool sẵn có) bị bỏ.
 *
 * Gọi tool ⇒ kiểm LẠI điều kiện công bố (phiên bản hoạt động có thể đã đổi) ⇒ kiểm tham số theo khai báo ⇒ `batDauRun`
 * (trigger `mcp`, item = đối số) ⇒ chạy đồng bộ có trần (`AI_FLOW_MCP_TRAN_MS`, mặc định 120 s) ⇒ đầu ra node cuối (JSON).
 * Lượt dừng chờ duyệt ⇒ báo đang chờ (lượt vẫn sống; người duyệt ở web — MCP không có tool duyệt).
 */
import { and, eq } from "drizzle-orm";
import { aiFlowVersions, aiFlows } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { THU_TU_HANG, type FlowDefinition, type HangTacDungPhu, type NodeInstance } from "../../../../shared/flow/model";
import { dangKyNut } from "../dangKyNut";
import { kiemThamSoTool, type KhaiToolLuong } from "../nut/agent";

export const LOAI_MCP = "kich-hoat.mcp";

dangKyNut({
  type: LOAI_MCP,
  typeVersion: 1,
  laKichHoat: true,
  congVao: [],
  congRa: ["main"],
  tacDungPhu: "thuan",
  lapLai: "idempotent",
  async chay(_t, ngu) {
    return { main: ngu.inputs.main ?? [{ json: {} }] };
  },
});

export interface ToolLuongMcp {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  flowId: string;
  version: number;
  nodeId: string;
  hang: HangTacDungPhu;
}

/** Hạng được phép công bố qua MCP. */
export const laHangCongBoMcp = (h: string | null | undefined): boolean => THU_TU_HANG[(h ?? "ot") as HangTacDungPhu] <= THU_TU_HANG.doc;

function khaiCuaNut(n: NodeInstance): KhaiToolLuong {
  const ds = Array.isArray(n.parameters?.thamSo) ? (n.parameters.thamSo as KhaiToolLuong["thamSo"]) : [];
  return { flowId: "", thamSo: ds };
}

/** Tool của MỘT phiên bản luồng (null nếu không đủ điều kiện công bố). */
export function toolCuaPhienBan(def: FlowDefinition, version: number, hang: string, enabled: boolean): ToolLuongMcp | null {
  if (!enabled || !laHangCongBoMcp(hang) || /^avi_/i.test(def.id)) return null;
  const n = def.nodes.find((x) => x.type === LOAI_MCP && !x.disabled);
  if (!n) return null;
  const props: Record<string, unknown> = {};
  const req: string[] = [];
  for (const t of khaiCuaNut(n).thamSo ?? []) {
    if (!t || typeof t.ten !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(t.ten)) continue;
    props[t.ten] = { type: t.kieu === "so" ? "number" : t.kieu === "boolean" ? "boolean" : "string", ...(t.moTa ? { description: String(t.moTa).slice(0, 300) } : {}) };
    if (t.batBuoc) req.push(t.ten);
  }
  const moTa = typeof n.parameters?.moTa === "string" && n.parameters.moTa.trim() ? n.parameters.moTa.trim() : `Chạy Luồng AI "${def.name}"`;
  return {
    name: def.id,
    description: `${moTa.slice(0, 800)} (Luồng AI ${def.id}@${version}, hạng ${hang}; trả đầu ra node cuối dạng JSON)`,
    inputSchema: { type: "object", properties: props, required: req, additionalProperties: false },
    flowId: def.id,
    version,
    nodeId: n.id,
    hang: hang as HangTacDungPhu,
  };
}

/** Mọi luồng đang công bố thành tool MCP. CSDL vắng ⇒ rỗng. */
export async function lietKeToolLuongMcp(): Promise<ToolLuongMcp[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({ id: aiFlows.id, enabled: aiFlows.enabled, version: aiFlowVersions.version, hang: aiFlowVersions.riskClass, def: aiFlowVersions.definition })
    .from(aiFlows)
    .innerJoin(aiFlowVersions, and(eq(aiFlowVersions.flowId, aiFlows.id), eq(aiFlowVersions.version, aiFlows.activeVersion)))
    .where(eq(aiFlows.enabled, true));
  const ra: ToolLuongMcp[] = [];
  for (const r of rows) {
    const t = toolCuaPhienBan(r.def as FlowDefinition, r.version, r.hang, r.enabled);
    if (t) ra.push(t);
  }
  return ra.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 200);
}

export interface KetQuaGoiLuongMcp {
  chu: string;
  loi: boolean;
}

/** Gọi một tool luồng: kiểm lại công bố + tham số ⇒ chạy ⇒ đầu ra node cuối. `null` = không có tool luồng tên này. */
export async function goiToolLuongMcp(ten: string, args: Record<string, unknown>, tranMs?: number): Promise<KetQuaGoiLuongMcp | null> {
  const t = (await lietKeToolLuongMcp()).find((x) => x.name === ten);
  if (!t) return null;
  const db = (await getDb())!;
  const [v] = await db.select().from(aiFlowVersions).where(and(eq(aiFlowVersions.flowId, t.flowId), eq(aiFlowVersions.version, t.version)));
  const n = (v?.definition as FlowDefinition | undefined)?.nodes.find((x) => x.id === t.nodeId);
  if (!n) return null;
  const p = kiemThamSoTool(JSON.stringify(args ?? {}), khaiCuaNut(n));
  if (!p.ok) return { chu: `Tham số không hợp lệ: ${p.loi}`, loi: true };
  const { batDauRun, chayLuotDongBo } = await import("../dongCo");
  const runId = await batDauRun({ flowId: t.flowId, version: t.version, items: [{ json: p.v }], nutKichHoat: t.nodeId, triggerKind: "mcp" });
  const kq = await chayLuotDongBo(runId, tranMs ?? Math.max(5_000, Number(process.env.AI_FLOW_MCP_TRAN_MS ?? 120_000) || 120_000));
  if (kq.status === "xong") return { chu: JSON.stringify({ runId, items: kq.items.map((i) => i.json) }).slice(0, 64_000), loi: false };
  if (kq.status === "cho-duyet") return { chu: `Lượt ${runId} đang CHỜ NGƯỜI DUYỆT (duyệt ở web /ai-flows/duyet) — chưa có kết quả.`, loi: false };
  if (kq.status === "het-gio") return { chu: `Lượt ${runId} chưa xong sau trần thời gian — xem ở web /ai-flows/${t.flowId}?run=${runId}.`, loi: true };
  return { chu: `Lượt ${runId} kết thúc '${kq.status}'${kq.thongDiep ? `: ${kq.thongDiep}` : ""}`, loi: true };
}
