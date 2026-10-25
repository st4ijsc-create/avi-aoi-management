/**
 * ★★ Lô MCP client (2026-10-26; dieu-phoi duyệt) — NODE `tich-hop.mcp-goi`: gọi MỘT tool của MCP server qua HTTP (Streamable HTTP, JSON-RPC 2.0: initialize → notifications/initialized → tools/call).
 *
 * HÀNG RÀO (mặc định ĐÓNG):
 *   • Danh sách trắng `AI_FLOW_MCP_CHO_PHEP` = JSON `{ "<tên>": { "url": "https://host/mcp", "tools": ["tool-a", …], "noiBo": true? } }`. RỖNG / hỏng ⇒ node TỪ CHỐI mọi lời gọi (tính năng tắt tới khi chủ dự án điền).
 *     Luồng chỉ mang TÊN máy chủ + TÊN tool (khớp CHÍNH XÁC, không wildcard) — không mang URL/host/id nhà máy ⇒ xuất/nhập giữa nhà máy an toàn. `server` và `tool` là chuỗi CỐ ĐỊNH (không biểu thức).
 *   • Mạng: cùng lớp chống SSRF của node HTTP (`kiemDichDen` + ghim IP, không theo chuyển hướng). Host công cộng mặc định; địa chỉ NỘI BỘ chỉ khi mục khai `"noiBo": true` (ghi rõ host:cổng).
 *   • Hạng `ngoai-ghi` + `atMostOnce` (tool có thể có tác dụng phụ; gửi kèm `Idempotency-Key`); bật luồng cần quyền hạng ngoai-ghi.
 *   • Trần: 30 s cho CẢ lời gọi, 1 MiB mỗi phản hồi, đối số ≤ 64 KiB, ≤ 20 item mỗi lượt-node (vượt ⇒ lỗi rõ, không cắt âm thầm).
 *   • KẾT QUẢ LÀ DỮ LIỆU KHÔNG TIN CẬY: chỉ được ghi vào item (`[truongRa]: { may, tool, noiDung, cauTruc }`), KHÔNG BAO GIỜ được đánh giá như biểu thức / lệnh. Tool báo `isError` ⇒ node lỗi.
 *   • Bí mật: chỉ qua `credentialRef` + `kieuXacThuc` (như HTTP), và bí mật phải KHAI host của máy chủ này (`hostChoPhep`) — không bí mật nào của luồng tự chảy sang máy chủ MCP.
 */
import { danhGiaThamSo, type ItemLuong } from "../../../../shared/flow/bieuThuc";
import { dangKyNut, nguCanhItem, type KetQuaChay, type NguCanhChay } from "../dangKyNut";
import { LoiHttpLuong, docThanCoTran, kiemDichDen, type DichDen } from "./mangAnToan";
import { layFetchLuong, tieuDeXacThuc } from "./tichHop";

export const TRAN_ITEM_MCP = 20;
export const TRAN_THAN_MCP = 1024 * 1024;
export const TRAN_DOI_SO_MCP = 64 * 1024;
export const TRAN_MS_MCP = 30_000;
export const TRAN_CHU_NOI_DUNG_MCP = 100_000;
export const RE_TEN_MAY_CHU_MCP = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const RE_TEN_TOOL_MCP = /^[A-Za-z0-9_.-]{1,64}$/;
const PHIEN_BAN_GIAO_THUC = "2025-03-26";

export class LoiMcp extends Error {
  constructor(message: string, readonly ma?: string) {
    super(message);
    this.name = "LoiMcp";
  }
}

export interface MayChuMcp {
  url: URL;
  tools: ReadonlySet<string>;
  noiBo: boolean;
}

/** Đọc danh sách trắng từ env. Rỗng / không phải JSON / mục sai ⇒ bỏ mục đó (đóng theo mặc định). */
export function mayChuMcpChoPhep(env: NodeJS.ProcessEnv = process.env): Map<string, MayChuMcp> {
  const ra = new Map<string, MayChuMcp>();
  let goc: unknown;
  try {
    goc = JSON.parse(env.AI_FLOW_MCP_CHO_PHEP ?? "");
  } catch {
    return ra;
  }
  if (!goc || typeof goc !== "object" || Array.isArray(goc)) return ra;
  for (const [ten, v] of Object.entries(goc as Record<string, unknown>).slice(0, 20)) {
    const m = v as { url?: unknown; tools?: unknown; noiBo?: unknown } | null;
    if (!RE_TEN_MAY_CHU_MCP.test(ten) || !m || typeof m.url !== "string" || !Array.isArray(m.tools)) continue;
    let u: URL;
    try {
      u = new URL(m.url);
    } catch {
      continue;
    }
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) continue;
    const tools = m.tools.filter((x): x is string => typeof x === "string" && RE_TEN_TOOL_MCP.test(x)).slice(0, 50);
    if (!tools.length) continue;
    ra.set(ten, { url: u, tools: new Set(tools), noiBo: m.noiBo === true });
  }
  return ra;
}

/** Thông điệp JSON-RPC có `id` trong thân JSON hoặc luồng SSE (`data:`); lỗi JSON-RPC ⇒ ném. */
export function timPhanHoiJsonRpc(chu: string, kieu: string, id: number): { result?: unknown } {
  const thu = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  let ds: unknown[];
  if (kieu.includes("text/event-stream")) {
    ds = chu
      .split(/\r?\n\r?\n/)
      .map((khoi) => khoi.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).replace(/^ /, "")).join("\n"))
      .filter(Boolean)
      .map(thu);
  } else {
    const j = thu(chu);
    ds = Array.isArray(j) ? j : [j];
  }
  const m = ds.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === id) as { result?: unknown; error?: { code?: unknown; message?: unknown } } | undefined;
  if (!m) throw new LoiMcp("MCP: phản hồi không có thông điệp JSON-RPC khớp lời gọi", "MCP_PHAN_HOI_SAI");
  if (m.error) throw new LoiMcp(`MCP lỗi ${String(m.error.code).slice(0, 12)}: ${String(m.error.message ?? "").slice(0, 200)}`, "MCP_LOI_RPC");
  return { result: m.result };
}

type HamGuiMcp = (url: URL, init: RequestInit, dich: DichDen) => Promise<Response>;

/** Rút văn bản + cấu trúc từ kết quả `tools/call`. DỮ LIỆU — chỉ cắt/đóng gói, không diễn giải. */
export function gonKetQuaTool(res: unknown, tool: string): { noiDung: string; cauTruc: unknown } {
  const r = (res && typeof res === "object" ? res : {}) as { content?: unknown; isError?: unknown; structuredContent?: unknown };
  const phan = Array.isArray(r.content) ? r.content : [];
  const chu = phan
    .map((p) => {
      const o = p as { type?: unknown; text?: unknown };
      return o?.type === "text" && typeof o.text === "string" ? o.text : `[${String(o?.type ?? "khong-ro").slice(0, 24)}]`;
    })
    .join("\n")
    .slice(0, TRAN_CHU_NOI_DUNG_MCP);
  if (r.isError === true) throw new LoiMcp(`MCP tool '${tool}' báo lỗi: ${chu.slice(0, 200)}`, "MCP_TOOL_LOI");
  return { noiDung: chu, cauTruc: r.structuredContent ?? null };
}

async function goiMotLan(tenMay: string, may: MayChuMcp, tool: string, doiSo: Record<string, unknown>, ngu: NguCanhChay, kieuXacThuc: unknown): Promise<{ noiDung: string; cauTruc: unknown }> {
  const xacThuc = tieuDeXacThuc(kieuXacThuc, ngu.biMat);
  const biMat = ngu.biMat;
  // Bí mật chỉ đi tới host NÓ KHAI (như node HTTP): chưa khai ⇒ chưa dùng được.
  if (biMat && !biMat.hostChoPhep.includes(may.url.hostname.toLowerCase())) {
    throw new LoiHttpLuong(
      biMat.hostChoPhep.length === 0 ? "bí mật chưa khai host cho phép (quản trị viên khai ở Bí mật → host)" : `host '${may.url.hostname}' không nằm trong danh sách host của bí mật`,
      biMat.hostChoPhep.length === 0 ? "BI_MAT_CHUA_KHAI_HOST" : undefined,
    );
  }
  const congHT = may.url.port || (may.url.protocol === "https:" ? "443" : "80");
  const choPhep = new Set([may.noiBo ? `${may.url.hostname.toLowerCase()}:${congHT}` : may.url.hostname.toLowerCase()]);
  const dich = await kiemDichDen(may.url, choPhep);
  const gui = layFetchLuong() as HamGuiMcp;
  const tinHieu = AbortSignal.timeout(TRAN_MS_MCP);
  let phien: string | undefined;
  const post = async (body: unknown, themTieuDe: Record<string, string> = {}): Promise<Response> => {
    const tieuDe: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...themTieuDe };
    if (phien) tieuDe["Mcp-Session-Id"] = phien;
    if (xacThuc) tieuDe[xacThuc[0]] = xacThuc[1];
    const r = await gui(may.url, { method: "POST", headers: tieuDe, body: JSON.stringify(body), redirect: "manual", signal: tinHieu }, dich);
    if (r.status < 200 || r.status >= 300) {
      await r.body?.cancel().catch(() => undefined);
      throw new LoiMcp(`MCP HTTP ${r.status} từ máy chủ '${tenMay}'`, "MCP_HTTP");
    }
    return r;
  };
  const rpc = async (id: number, method: string, params: unknown, themTieuDe?: Record<string, string>) => {
    const r = await post({ jsonrpc: "2.0", id, method, params }, themTieuDe);
    const s = r.headers.get("mcp-session-id");
    if (s && !phien) phien = s.slice(0, 200);
    return timPhanHoiJsonRpc(await docThanCoTran(r, TRAN_THAN_MCP), r.headers.get("content-type") ?? "", id).result;
  };
  try {
    await rpc(1, "initialize", { protocolVersion: PHIEN_BAN_GIAO_THUC, capabilities: {}, clientInfo: { name: "avi-aoi-flow", version: "1" } });
    await docThanCoTran(await post({ jsonrpc: "2.0", method: "notifications/initialized" }), TRAN_THAN_MCP);
    const kq = await rpc(2, "tools/call", { name: tool, arguments: doiSo }, { "Idempotency-Key": ngu.idempotencyKey });
    return gonKetQuaTool(kq, tool);
  } catch (e) {
    if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) throw new LoiMcp(`MCP quá ${TRAN_MS_MCP / 1000} giây — dừng chờ`, "MCP_HET_GIO");
    throw e;
  }
}

dangKyNut({
  type: "tich-hop.mcp-goi",
  typeVersion: 1,
  laKichHoat: false,
  congVao: ["main"],
  congRa: ["main"],
  tacDungPhu: "ngoai-ghi",
  lapLai: "atMostOnce",
  nhanBiMat: true,
  async chay(thamSo, ngu): Promise<KetQuaChay> {
    const vao = ngu.inputs.main ?? [];
    if (vao.length > TRAN_ITEM_MCP) throw new LoiMcp(`tich-hop.mcp-goi nhận ${vao.length} item — tối đa ${TRAN_ITEM_MCP} mỗi lượt (không cắt âm thầm).`, "QUA_TRAN_ITEM");
    const tenMay = thamSo.server;
    const tool = thamSo.tool;
    if (typeof tenMay !== "string" || !RE_TEN_MAY_CHU_MCP.test(tenMay)) throw new LoiMcp("server phải là tên máy chủ MCP cố định (a-z, 0-9, -, _)", "THAM_SO_SAI");
    if (typeof tool !== "string" || !RE_TEN_TOOL_MCP.test(tool)) throw new LoiMcp("tool phải là tên tool cố định", "THAM_SO_SAI");
    const ds = mayChuMcpChoPhep();
    if (ds.size === 0) throw new LoiMcp("MCP client TẮT: AI_FLOW_MCP_CHO_PHEP rỗng — quản trị viên chưa khai máy chủ MCP nào", "MCP_TAT");
    const may = ds.get(tenMay);
    if (!may) throw new LoiMcp(`máy chủ MCP '${tenMay}' không có trong AI_FLOW_MCP_CHO_PHEP`, "MCP_MAY_CHU_CHUA_KHAI");
    if (!may.tools.has(tool)) throw new LoiMcp(`tool '${tool}' không có trong danh sách của máy chủ MCP '${tenMay}'`, "MCP_TOOL_CHUA_KHAI");
    const ra: ItemLuong[] = [];
    for (const item of vao) {
      // `thamSo.thamSo` (đối số tool) là biểu thức theo item; KẾT QUẢ trả về KHÔNG BAO GIỜ đi qua bộ đánh giá biểu thức.
      const t = danhGiaThamSo({ doiSo: thamSo.thamSo ?? {}, truongRa: thamSo.truongRa }, nguCanhItem(ngu, item, vao)) as { doiSo: unknown; truongRa?: unknown };
      if (!t.doiSo || typeof t.doiSo !== "object" || Array.isArray(t.doiSo)) throw new LoiMcp("thamSo phải là đối tượng", "THAM_SO_SAI");
      if (JSON.stringify(t.doiSo).length > TRAN_DOI_SO_MCP) throw new LoiMcp(`đối số quá ${TRAN_DOI_SO_MCP} byte`, "THAM_SO_SAI");
      const kq = await goiMotLan(tenMay, may, tool, t.doiSo as Record<string, unknown>, ngu, thamSo.kieuXacThuc);
      ra.push({ json: { ...item.json, [typeof t.truongRa === "string" && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(t.truongRa) ? t.truongRa : "mcp"]: { may: tenMay, tool, ...kq } } });
    }
    return { main: ra };
  },
});
