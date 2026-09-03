/**
 * ★★★ ĐỢT H / TASK H2 / B1 — PHÂN TÍCH CẤU HÌNH MCP SERVER NGOÀI (`aviAiLocal.mcpServers`).
 *
 * Khuôn `mcpServers` quen thuộc (Claude Desktop/Cursor…): một object, mỗi khoá là TÊN server, giá
 * trị mang `command`/`args`/`cwd`/`env`. Khoá cấu hình được khai `scope: "machine"` trong
 * `package.json` — VSCode sẽ TỰ CHẶN một `.vscode/settings.json` (workspace) ghi đè nó; đây là
 * hàng rào của CHÍNH VSCode, không phải của tệp này (bài học Đợt A: `aviAiLocal.serverUrl` thiếu
 * `scope` từng để một repo thù địch chiếm đường dữ liệu qua `.vscode/settings.json`).
 *
 * THUẦN (không `import "vscode"`) — tệp này chỉ biết diễn dịch một `unknown` (giá trị đọc thô từ
 * `workspace.getConfiguration`) thành một danh sách có kiểu, KHÔNG BAO GIỜ ném lỗi: một mục hỏng
 * (thiếu `command`, sai kiểu `args`…) bị BỎ QUA cùng lý do đã ghi ở `mucQuyen.ts`/`khoHoiThoai.ts`
 * — "không biết/không hợp lệ" phải rơi về AN TOÀN (server đó coi như không tồn tại), không phải
 * đoán hay làm sập cả danh sách vì một mục xấu.
 */

export interface CauHinhMcpServer {
  /** Tên khoá trong object `mcpServers` — dùng làm định danh HIỂN THỊ và để model gọi lại đúng nó. */
  ten: string;
  lenh: string;
  doi: string[];
  thuMuc?: string;
  moi: Record<string, string>;
}

export interface KetQuaDocCauHinhMcp {
  danhSach: CauHinhMcpServer[];
  /** Lý do từng mục bị BỎ QUA — chỉ để hiện ở giao diện quản lý (B5), không phải lỗi chặn cả lượt hỏi. */
  loi: string[];
}

function laChuoiKhongRong(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

/** Diễn dịch MỘT mục — trả `undefined` kèm lý do khi hình dạng không hợp lệ, không đoán giá trị. */
function docMotMuc(ten: string, gt: unknown): { cfg?: CauHinhMcpServer; loi?: string } {
  if (!gt || typeof gt !== "object" || Array.isArray(gt)) {
    return { loi: `server "${ten}": giá trị không phải object` };
  }
  const o = gt as Record<string, unknown>;
  if (!laChuoiKhongRong(o.command)) {
    return { loi: `server "${ten}": thiếu "command" (chuỗi không rỗng)` };
  }
  let doi: string[] = [];
  if (o.args !== undefined) {
    if (!Array.isArray(o.args) || !o.args.every((x) => typeof x === "string")) {
      return { loi: `server "${ten}": "args" phải là mảng chuỗi` };
    }
    doi = o.args as string[];
  }
  let thuMuc: string | undefined;
  if (o.cwd !== undefined) {
    if (typeof o.cwd !== "string") return { loi: `server "${ten}": "cwd" phải là chuỗi` };
    thuMuc = o.cwd;
  }
  let moi: Record<string, string> = {};
  if (o.env !== undefined) {
    if (!o.env || typeof o.env !== "object" || Array.isArray(o.env)) {
      return { loi: `server "${ten}": "env" phải là object` };
    }
    const eo = o.env as Record<string, unknown>;
    for (const [k, v] of Object.entries(eo)) {
      if (typeof v !== "string") return { loi: `server "${ten}": env["${k}"] phải là chuỗi` };
    }
    moi = eo as Record<string, string>;
  }
  return { cfg: { ten, lenh: o.command, doi, thuMuc, moi } };
}

export function docCauHinhMcpServers(raw: unknown): KetQuaDocCauHinhMcp {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { danhSach: [], loi: raw === undefined ? [] : ["cấu hình aviAiLocal.mcpServers không phải object — bỏ qua toàn bộ"] };
  }
  const danhSach: CauHinhMcpServer[] = [];
  const loi: string[] = [];
  for (const [ten, gt] of Object.entries(raw as Record<string, unknown>)) {
    if (!laChuoiKhongRong(ten)) {
      loi.push(`tên server rỗng — bỏ qua`);
      continue;
    }
    const r = docMotMuc(ten, gt);
    if (r.cfg) danhSach.push(r.cfg);
    else if (r.loi) loi.push(r.loi);
  }
  return { danhSach, loi };
}
