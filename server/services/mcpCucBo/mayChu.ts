/**
 * ★ MCP cục bộ — máy chủ MCP qua Streamable HTTP (JSON-RPC 2.0, trả `application/json`), phục vụ node `tich-hop.mcp-goi` của Luồng
 * và client MCP khác trên CÙNG máy (extension VS Code, trợ lý lập trình). Chạy: `npx tsx scripts/mcp-cuc-bo.ts`.
 *
 * 0 gói mới — cùng lý do với `aiCodingCli/mcpServer.ts` (SDK kéo Express 5 + khung HTTP thứ hai). Phần dùng: `initialize`,
 * `notifications/*`, `ping`, `tools/list`, `tools/call`; không phiên, không SSE (máy chủ phi trạng thái — được phép theo đặc tả).
 *
 * HÀNG RÀO MẠNG:
 *   • chỉ nghe 127.0.0.1 (không bao giờ 0.0.0.0);
 *   • `Host` phải là 127.0.0.1:<cổng> hoặc localhost:<cổng>; có `Origin` ⇒ 403 (chặn DNS-rebinding từ trình duyệt — đặc tả MCP);
 *   • `MCP_CUC_BO_TOKEN` đặt ⇒ bắt buộc `Authorization: Bearer <token>` (so thời gian hằng);
 *   • thân ≤ 1 MiB, chỉ `application/json`, không batch.
 * Mỗi `tools/call` ghi MỘT dòng JSON nhật ký (tool, gốc, đường dẫn / băm SQL, thời gian, kết quả) — không ghi nội dung tệp / dữ liệu.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { LoiDb, lietKeBang, truyVan, type KetNoiDb } from "./dbChiDoc";
import { LoiTep, docTep, ghiTep, lietKe, timGoc, timTep, type GocTep } from "./tepAnToan";

export const TEN_MAY_CHU = "avi-mcp-cuc-bo";
export const BAN_MAY_CHU = "0.1.0";
export const BAN_GIAO_THUC = ["2025-06-18", "2025-03-26"] as const;
export const TRAN_THAN = 1024 * 1024;

export interface CauHinhMcpCucBo {
  cong: number;
  token?: string;
  goc: GocTep[];
  db?: KetNoiDb;
  ghiNhatKy?: (dong: Record<string, unknown>) => void;
}

type GoiJsonRpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
type TraLoi = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const S = { type: "string" } as const;
const GOC = { type: "string", description: "Tên gốc thư mục (bỏ trống nếu chỉ có một gốc)." } as const;

export function moTaTool(cfg: Pick<CauHinhMcpCucBo, "goc" | "db">): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  const dsGoc = cfg.goc.map((g) => `${g.ten}${g.chiDoc ? " (chỉ đọc)" : ""}`).join(", ") || "(chưa khai)";
  const ra: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [];
  if (cfg.goc.length > 0) {
    ra.push(
      { name: "tep_liet_ke", description: `Liệt kê thư mục trong gốc cho phép. Gốc: ${dsGoc}.`, inputSchema: { type: "object", properties: { goc: GOC, duongDan: { ...S, description: "Đường dẫn tương đối; trống = gốc." } } } },
      { name: "tep_doc", description: "Đọc tệp văn bản (UTF-8, tối đa 512 KiB mỗi lần; dùng batDau để đọc tiếp).", inputSchema: { type: "object", properties: { goc: GOC, duongDan: S, batDau: { type: "integer", minimum: 0 }, soByte: { type: "integer", minimum: 1 } }, required: ["duongDan"] } },
      { name: "tep_tim", description: "Tìm tệp theo một phần tên (không phân biệt hoa thường), tối đa 200 kết quả.", inputSchema: { type: "object", properties: { goc: GOC, mau: S, duongDan: S }, required: ["mau"] } },
    );
    if (cfg.goc.some((g) => !g.chiDoc)) {
      ra.push({ name: "tep_ghi", description: "Ghi tệp văn bản (tối đa 512 KiB) vào gốc GHI được; không ghi đè trừ khi ghiDe=true.", inputSchema: { type: "object", properties: { goc: GOC, duongDan: S, noiDung: S, ghiDe: { type: "boolean" } }, required: ["duongDan", "noiDung"] } });
    }
  }
  if (cfg.db) {
    ra.push(
      { name: "db_liet_ke_bang", description: "Liệt kê bảng + cột ĐỌC ĐƯỢC (vai trò chỉ đọc; cột nhạy cảm bị ẩn).", inputSchema: { type: "object", properties: { loc: { ...S, description: "Lọc theo một phần tên bảng." } } } },
      { name: "db_truy_van", description: "Chạy MỘT câu SELECT / WITH / EXPLAIN trong giao dịch chỉ đọc; tối đa 500 hàng, hạn 5 s. Cột nhạy cảm không đọc được — liệt kê cột cụ thể thay vì SELECT *.", inputSchema: { type: "object", properties: { sql: S }, required: ["sql"] } },
    );
  }
  return ra;
}

function ketQuaChu(doiTuong: unknown, loi = false): { content: Array<{ type: "text"; text: string }>; structuredContent?: unknown; isError: boolean } {
  const text = typeof doiTuong === "string" ? doiTuong : JSON.stringify(doiTuong, null, 2);
  return loi ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }], structuredContent: typeof doiTuong === "object" ? doiTuong : undefined, isError: false };
}

export async function goiTool(cfg: CauHinhMcpCucBo, ten: string, a: Record<string, unknown>): Promise<ReturnType<typeof ketQuaChu>> {
  const t0 = Date.now();
  const nk: Record<string, unknown> = { luc: new Date().toISOString(), tool: ten };
  try {
    let kq: unknown;
    switch (ten) {
      case "tep_liet_ke": {
        const g = timGoc(cfg.goc, a.goc);
        Object.assign(nk, { goc: g.ten, duongDan: a.duongDan ?? "" });
        kq = await lietKe(g, a.duongDan ?? "");
        break;
      }
      case "tep_doc": {
        const g = timGoc(cfg.goc, a.goc);
        Object.assign(nk, { goc: g.ten, duongDan: a.duongDan });
        kq = await docTep(g, a.duongDan, a.batDau, a.soByte);
        break;
      }
      case "tep_tim": {
        const g = timGoc(cfg.goc, a.goc);
        Object.assign(nk, { goc: g.ten, mau: a.mau });
        kq = await timTep(g, a.mau, a.duongDan);
        break;
      }
      case "tep_ghi": {
        const g = timGoc(cfg.goc, a.goc);
        Object.assign(nk, { goc: g.ten, duongDan: a.duongDan, ghiDe: a.ghiDe === true });
        kq = await ghiTep(g, a.duongDan, a.noiDung, a.ghiDe);
        break;
      }
      case "db_liet_ke_bang":
        if (!cfg.db) throw new LoiDb("chưa cấu hình MCP_CUC_BO_DB_URL", "DB_TAT");
        kq = { bang: await lietKeBang(cfg.db, a.loc) };
        break;
      case "db_truy_van":
        if (!cfg.db) throw new LoiDb("chưa cấu hình MCP_CUC_BO_DB_URL", "DB_TAT");
        nk.sqlBam = createHash("sha256").update(String(a.sql ?? "")).digest("hex").slice(0, 16);
        kq = await truyVan(cfg.db, a.sql);
        break;
      default:
        throw new LoiTep(`không có tool "${ten.slice(0, 64)}"`, "KHONG_CO_TOOL");
    }
    cfg.ghiNhatKy?.({ ...nk, ok: true, ms: Date.now() - t0 });
    return ketQuaChu(kq);
  } catch (e) {
    const ma = e instanceof LoiTep || e instanceof LoiDb ? e.ma : "LOI_NOI_BO";
    const thongDiep = e instanceof LoiTep || e instanceof LoiDb ? e.message : "lỗi nội bộ máy chủ MCP";
    cfg.ghiNhatKy?.({ ...nk, ok: false, ma, ms: Date.now() - t0 });
    return ketQuaChu(`[${ma}] ${thongDiep}`, true);
  }
}

export async function xuLyGoi(cfg: CauHinhMcpCucBo, goi: GoiJsonRpc): Promise<TraLoi | null> {
  const coId = typeof goi.id === "string" || typeof goi.id === "number";
  const id = coId ? (goi.id as string | number) : null;
  const p = (goi.params && typeof goi.params === "object" ? goi.params : {}) as Record<string, unknown>;
  if (goi.jsonrpc !== "2.0" || typeof goi.method !== "string") return coId ? { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } } : null;
  switch (goi.method) {
    case "initialize": {
      const xin = typeof p.protocolVersion === "string" && (BAN_GIAO_THUC as readonly string[]).includes(p.protocolVersion) ? p.protocolVersion : BAN_GIAO_THUC[0];
      return { jsonrpc: "2.0", id, result: { protocolVersion: xin, capabilities: { tools: { listChanged: false } }, serverInfo: { name: TEN_MAY_CHU, version: BAN_MAY_CHU } } };
    }
    case "ping":
      return coId ? { jsonrpc: "2.0", id, result: {} } : null;
    case "tools/list":
      return { jsonrpc: "2.0", id, result: { tools: moTaTool(cfg) } };
    case "tools/call": {
      const ten = typeof p.name === "string" ? p.name : "";
      // data-raw-ok: khung lỗi JSON-RPC theo đúng chuẩn MCP (-32602) — client parse theo hợp đồng giao thức.
      if (!ten) return { jsonrpc: "2.0", id, error: { code: -32602, message: "Missing tool name" } };
      const args = p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments) ? (p.arguments as Record<string, unknown>) : {};
      return { jsonrpc: "2.0", id, result: await goiTool(cfg, ten, args) };
    }
    default:
      if (goi.method.startsWith("notifications/") || !coId) return null;
      // data-raw-ok: mã chuẩn JSON-RPC "Method not found".
      return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${goi.method.slice(0, 64)}` } };
  }
}

function bangNhau(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

function tra(res: http.ServerResponse, ma: number, than?: unknown): void {
  if (than === undefined) {
    res.writeHead(ma).end();
    return;
  }
  const s = JSON.stringify(than);
  res.writeHead(ma, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(s) }).end(s);
}

export function taoMayChuHttp(cfg: CauHinhMcpCucBo): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") return tra(res, 404, { error: "not found" });
      const host = String(req.headers.host ?? "").toLowerCase();
      const congThat = (req.socket.localPort ?? cfg.cong).toString();
      if (host !== `127.0.0.1:${congThat}` && host !== `localhost:${congThat}`) return tra(res, 403, { error: "host not allowed" });
      if (req.headers.origin !== undefined) return tra(res, 403, { error: "origin not allowed" });
      if (cfg.token) {
        const h = String(req.headers.authorization ?? "");
        if (!h.startsWith("Bearer ") || !bangNhau(h.slice(7), cfg.token)) return tra(res, 401, { error: "unauthorized" });
      }
      if (req.method === "GET" || req.method === "DELETE") return tra(res, 405);
      if (req.method !== "POST") return tra(res, 405);
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) return tra(res, 415, { error: "content-type must be application/json" });
      const phan: Buffer[] = [];
      let n = 0;
      for await (const c of req) {
        n += (c as Buffer).length;
        if (n > TRAN_THAN) return tra(res, 413, { error: "body too large" });
        phan.push(c as Buffer);
      }
      let goi: unknown;
      try {
        goi = JSON.parse(Buffer.concat(phan).toString("utf8"));
      } catch {
        return tra(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
      if (Array.isArray(goi) || !goi || typeof goi !== "object") return tra(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } });
      const kq = await xuLyGoi(cfg, goi as GoiJsonRpc);
      return kq === null ? tra(res, 202) : tra(res, 200, kq);
    })().catch(() => {
      if (!res.headersSent) tra(res, 500, { error: "internal error" });
      else res.destroy();
    });
  });
}
