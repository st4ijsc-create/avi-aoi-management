/**
 * ★★★ doc 83 · (A) — **MCP SERVER (stdio): PHƠI BỘ TOOL REPO RA MỘT RANH GIỚI GIAO THỨC.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ NÓI THẲNG NÓ DÙNG ĐỂ LÀM GÌ — VÀ KHÔNG DÙNG ĐỂ LÀM GÌ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cắm file này vào Claude Code / Cursor thì **model đang suy nghĩ là model TRÊN MẠNG**. Nhà máy
 * không có internet ⇒ đường này **vô dụng ở nhà máy**; nó là tiện ích cho **máy phát triển**.
 * Cổng ra phục vụ nhà máy là `cli.ts` (model local :8091). Đừng đọc nhầm thứ tự ưu tiên ấy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO **KHÔNG** DÙNG `@modelcontextprotocol/sdk` — ĐO, KHÔNG PHẢI SỢ GÓI MỚI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npm view @modelcontextprotocol/sdk@1.30.0 dependencies` (đo 2026-08-23, npm CÓ mạng trên máy
 * này) trả về **17 phụ thuộc**, trong đó:
 *   • `express: ^5.2.1` — repo này chạy `express@^4.22.1`. Kéo về là có **HAI major của Express**
 *     trong `node_modules` của một sản phẩm giao cho nhà máy.
 *   • `hono`, `@hono/node-server`, `cors`, `express-rate-limit` — một khung HTTP **thứ hai**.
 *   • `jose: ^6.1.3` (repo ghim `6.1.0` để KÝ VÉ PHIÊN), `pkce-challenge`, `eventsource`, `ajv` …
 * Tất cả để phục vụ các transport HTTP/SSE/OAuth mà lượt này **không dùng một dòng nào**: MCP qua
 * **stdio** là JSON-RPC 2.0, **mỗi thông điệp một dòng**, trên `stdin`/`stdout`. Phần ta thật sự
 * cần là khung dòng + bốn phương thức, và nó nằm gọn trong file này.
 * ⇒ **0 gói mới.** Đổi lại ta gánh rủi ro trôi giao thức — nên `mcpGiaoThuc.test.ts` chạy đúng bắt
 *   tay thật (`initialize` → `tools/list` → `tools/call`) và khẳng định từng ô của khung JSON-RPC.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẤT BIẾN LỚN NHẤT CỦA FILE NÀY: **KHÔNG CÓ TOOL DUYỆT.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bên kia đường ống MCP là **một tác nhân**, không phải một con người. Nếu ta phơi ra một tool
 * `avi_confirm`, thì "người trong vòng lặp" trở thành *"một model khác bấm nút"* — và HITL chết
 * trong im lặng, đúng kiểu hỏng mà cả doc 78/79 dựng ra để chặn. Có người sẽ nói *"Claude Code hỏi
 * người dùng trước khi chạy tool mà"* — đúng, nhưng đó là **hành vi của một chương trình bên thứ
 * ba**, không phải một hàng rào của hệ này. Hàng rào phải đứng ở phía ta.
 *
 * ⇒ Tool GHI (`avi_propose_edit`, `avi_propose_command`) qua đây chỉ tạo được một **ĐỀ XUẤT**
 *   (`ai_pending_actions.status='proposed'`, **0 byte chạm đĩa**). Người duyệt ở **web
 *   `/ai-coding-workspace`** hoặc ở **`npm run ai:cli`**. `cauNoiCli.census.test.ts` §4 khẳng định
 *   file này KHÔNG nhập `confirmAction` và KHÔNG khai một tool nào có chữ "confirm"/"duyệt".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * DANH TÍNH: `$AVI_MCP_USER` + `$AVI_MCP_PASSWORD`, phân giải LƯỜI, fail-closed
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tiến trình này do một MCP client sinh ra — **không có TTY để hỏi mật khẩu**. Nên danh tính đến
 * từ hai biến môi trường trong cấu hình MCP client, và đi qua **đúng** `xacThucCli` (bcrypt thật,
 * khoá tài khoản thật, audit thật, 2FA fail-closed). Thiếu/sai ⇒ **mọi** `tools/call` trả lỗi;
 * không có nhánh nào chạy tool mà chưa biết là ai.
 * ⚠ Mật khẩu trong tệp cấu hình MCP là một sự thật cần nói ra: nó là **thông tin đăng nhập của
 *   một tài khoản THẬT**, và RBAC của tài khoản ấy (`ai_repo_read`, `ai_repo_exec`) quyết định
 *   MCP làm được gì. Dùng một tài khoản riêng cho MCP, đừng dùng tài khoản admin của bạn.
 *
 * ⚠ **`stdout` LÀ ĐƯỜNG ỐNG GIAO THỨC.** Một `console.log` lạc vào đó làm hỏng khung dòng và
 *   client sẽ ngắt. Mọi lời kể đi `stderr` (`ke()`).
 *
 * CẮM VÀO CLAUDE CODE / CURSOR (mcp config):
 *   { "command": "npx", "args": ["tsx", "server/services/aiCodingCli/mcpServer.ts"],
 *     "cwd": "D:/SOURCES/avi-aoi-management",
 *     "env": { "AVI_MCP_USER": "…", "AVI_MCP_PASSWORD": "…" } }
 */
import { BIEN_MAT_KHAU, BIEN_NGUOI_DUNG, xacThucCli, type DanhTinhCli } from "./danhTinhCli";
// ★ QUẢN LÝ DỰ ÁN 2026-08-23 — nạp ảnh chụp dự án nguồn DB đúng MỘT lần lúc MCP khởi động (xem
// điểm gọi trong `chayMcp` — chép đúng khuôn `chayCli`). Danh sách vẫn chỉ có MỘT chủ:
// `repoProjects.danhSachDuAn()`.
import { napLaiDuAnTuDb } from "../aiLocalTools/repoProjects";
import { chayTool, chotAnToanTienTrinh, danhSachDuAnCli, moPhienCli } from "./cauNoiCli";

export const TEN_MAY_CHU = "avi-coding-repo";
export const BAN_MAY_CHU = "0.1.0";
/** Bản giao thức mặc định khi client không nêu (hoặc nêu một chuỗi không phải ngày). */
export const BAN_GIAO_THUC_MAC_DINH = "2025-06-18";

function ke(s: string): void {
  process.stderr.write(`[avi-mcp] ${s}\n`);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SỔ TOOL — mỗi mục nói rõ nó rơi vào NHÁNH ĐỌC hay NHÁNH ĐỀ XUẤT của `executeDecision`
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface MucToolMcp {
  readonly ten: string;
  readonly moTa: string;
  readonly luoc: Record<string, unknown>;
  /** Tên tool THẬT trong `toolRegistry`. `null` ⇒ tool cục bộ (chỉ liệt kê dự án). */
  readonly toolThat: string | null;
}

const O_DU_AN = {
  type: "string",
  description: "ID dự án trong danh sách TRẮNG (gọi avi_list_projects để lấy). KHÔNG phải đường dẫn.",
};

/**
 * ⚠ Tên tool mang tiền tố `avi_` để không đụng tên tool của chính MCP client.
 * ⚠ **Không có mục nào nhận một đường dẫn GỐC.** Ô `projectId` là ID; server tra danh sách trắng.
 */
export const SO_TOOL_MCP: readonly MucToolMcp[] = [
  {
    ten: "avi_list_projects",
    moTa: "Liệt kê các dự án (gốc hộp cát) đã khai trong danh sách TRẮNG AI_REPO_SANDBOX_ROOTS. Gọi đầu tiên để lấy ID.",
    luoc: { type: "object", properties: {}, additionalProperties: false },
    toolThat: null,
  },
  {
    ten: "avi_read_file",
    moTa:
      "Đọc nội dung THẬT một tệp mã nguồn trong hộp cát của dự án (đường dẫn TƯƠNG ĐỐI theo gốc dự án). " +
      "Hộp cát chặn đường tuyệt đối, '..', symlink/hard link ra ngoài, .env*/khoá/chứng thư, node_modules/.git/dist. CHỈ ĐỌC.",
    luoc: {
      type: "object",
      properties: {
        projectId: O_DU_AN,
        path: { type: "string", description: "Đường dẫn TƯƠNG ĐỐI so với gốc dự án." },
        maxBytes: { type: "number", description: "Trần byte đọc (tuỳ chọn)." },
      },
      required: ["projectId", "path"],
      additionalProperties: false,
    },
    toolThat: "read_file",
  },
  {
    ten: "avi_list_files",
    moTa: "Liệt kê tệp/thư mục trong hộp cát của dự án. Bỏ trống `path` = gốc dự án.",
    luoc: {
      type: "object",
      properties: {
        projectId: O_DU_AN,
        path: { type: "string" },
        depth: { type: "number", description: "1..3" },
      },
      required: ["projectId"],
      additionalProperties: false,
    },
    toolThat: "list_files",
  },
  {
    ten: "avi_grep_repo",
    moTa: "Tìm một biểu thức chính quy trong mã nguồn của dự án; trả đường dẫn + số dòng + dòng khớp.",
    luoc: {
      type: "object",
      properties: {
        projectId: O_DU_AN,
        pattern: { type: "string" },
        path: { type: "string" },
        ignoreCase: { type: "boolean" },
        maxResults: { type: "number" },
      },
      required: ["projectId", "pattern"],
      additionalProperties: false,
    },
    toolThat: "grep_repo",
  },
  {
    ten: "avi_propose_edit",
    moTa:
      "ĐỀ XUẤT sửa một tệp. KHÔNG GHI. Trả về một actionId; một NGƯỜI phải duyệt ở giao diện web " +
      "/ai-coding-workspace hoặc ở `npm run ai:cli`. `original` phải là byte HIỆN TẠI trên đĩa (đọc bằng " +
      "avi_read_file trước) — nó là điểm neo của băm chống TOCTOU; lệch ⇒ TỪ CHỐI.",
    luoc: {
      type: "object",
      properties: {
        projectId: O_DU_AN,
        path: { type: "string" },
        original: { type: "string", description: "Nội dung HIỆN TẠI trên đĩa. Rỗng ⇒ tạo tệp mới." },
        modified: { type: "string", description: "Nội dung mong muốn, ĐẦY ĐỦ." },
      },
      required: ["projectId", "path", "original", "modified"],
      additionalProperties: false,
    },
    toolThat: "apply_diff",
  },
  {
    ten: "avi_propose_command",
    moTa:
      "ĐỀ XUẤT chạy một lệnh trong DANH SÁCH TRẮNG (npm run check · check:tests · vitest run <đường> · " +
      "git status · git diff · dotnet test …). KHÔNG CHẠY. Một NGƯỜI phải duyệt ở web hoặc ở CLI.",
    luoc: {
      type: "object",
      properties: { projectId: O_DU_AN, command: { type: "string" } },
      required: ["projectId", "command"],
      additionalProperties: false,
    },
    toolThat: "run_command",
  },
];

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DANH TÍNH — phân giải LƯỜI, nhớ trong bộ nhớ tiến trình, KHÔNG có đường mặc định
// ══════════════════════════════════════════════════════════════════════════════════════════════
let daCo: DanhTinhCli | null = null;

export function xoaDanhTinhNho(): void {
  daCo = null;
}

async function layDanhTinh(): Promise<{ ok: true; danhTinh: DanhTinhCli } | { ok: false; loi: string }> {
  if (daCo !== null) return { ok: true, danhTinh: daCo };
  const kq = await xacThucCli({
    tenDangNhap: process.env[BIEN_NGUOI_DUNG.mcp],
    matKhau: process.env[BIEN_MAT_KHAU.mcp],
    nguon: "mcp",
  });
  if (!kq.ok) {
    return {
      ok: false,
      loi:
        `[${kq.ma}] ${kq.loi}\n` +
        `Đặt ${BIEN_NGUOI_DUNG.mcp} và ${BIEN_MAT_KHAU.mcp} trong khối "env" của cấu hình MCP client.`,
    };
  }
  daCo = kq.danhTinh;
  return { ok: true, danhTinh: kq.danhTinh };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GỌI MỘT TOOL — MỘT đường duy nhất, đi thẳng vào `executeDecision` qua `cauNoiCli.chayTool`
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface KetQuaGoiMcp {
  readonly chu: string;
  readonly loi: boolean;
}

/**
 * ⚠⚠ Không có nhánh nào ở đây tự quyết định *"tool này an toàn, chạy luôn"*. Phân loại đọc/ghi là
 * việc của `executeDecision` (`isWriteTool`), và một tool ghi **luôn** quay ra dưới dạng
 * `pendingAction`. Nếu ai đó đổi `apply_diff` thành `kind:"read"` thì lỗ nằm ở đó chứ không phải
 * ở đây — và `applyDiff.census.test.ts` canh đúng chỗ ấy.
 */
export async function goiToolMcp(ten: string, args: Record<string, unknown>): Promise<KetQuaGoiMcp> {
  const muc = SO_TOOL_MCP.find((m) => m.ten === ten);
  if (!muc) return { chu: `Không có tool "${ten}".`, loi: true };

  const dt = await layDanhTinh();
  if (!dt.ok) return { chu: `Chưa xác định được danh tính nên KHÔNG chạy gì cả.\n${dt.loi}`, loi: true };

  if (muc.toolThat === null) {
    const ds = danhSachDuAnCli().map((d) => `${d.id}\t${d.ten}`);
    return { chu: ["ID\tTên", ...ds].join("\n"), loi: false };
  }

  const { projectId, ...conLai } = args;
  const mp = moPhienCli({
    danhTinh: dt.danhTinh,
    projectId: typeof projectId === "string" ? projectId : null,
    lang: "vi",
    nguon: "mcp",
  });
  if (!mp.ok) return { chu: `[${mp.ma}] ${mp.loi}`, loi: true };

  const kq = await chayTool(mp.phien, muc.toolThat, conLai as Record<string, unknown>);

  if (kq.denied) return { chu: `TỪ CHỐI [${kq.denied.reason ?? "DENIED"}]: ${kq.denied.message}`, loi: true };
  if (kq.pendingAction) {
    const p = kq.pendingAction;
    return {
      loi: false,
      chu: [
        `ĐỀ XUẤT ĐÃ TẠO — CHƯA GHI/CHƯA CHẠY MỘT BYTE NÀO.`,
        `  actionId : ${p.actionId}`,
        `  tool     : ${p.tool}`,
        `  tóm tắt  : ${p.summary}`,
        `  hết hạn  : ${p.expiresAt}`,
        ...(p.preview?.warnings ?? []).map((w) => `  ⚠ ${w}`),
        ``,
        `MỘT NGƯỜI phải duyệt: mở /ai-coding-workspace trên web, hoặc chạy \`npm run ai:cli -- --du-an ${mp.phien.duAn.id}\`.`,
        `MCP cố ý KHÔNG có tool duyệt — một tác nhân bấm nút thay người thì "người trong vòng lặp" không còn là người.`,
      ].join("\n"),
    };
  }
  if (kq.result) {
    const r = kq.result;
    return { chu: `${r.title}\n${r.textSummary}`, loi: r.note != null };
  }
  return { chu: `Không có kết quả.${kq.error ? ` (${kq.error})` : ""}`, loi: true };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// JSON-RPC 2.0 — khung DÒNG của transport stdio
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface GoiJsonRpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export type TraLoiJsonRpc =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

/** Mã lỗi chuẩn JSON-RPC dùng ở đây. */
export const MA_JSONRPC = { KHONG_CO_PHUONG_THUC: -32601, THAM_SO_XAU: -32602 } as const;

/**
 * ★ Xử lý MỘT thông điệp. Trả `null` cho **notification** (không có `id`) — theo JSON-RPC, một
 * notification KHÔNG được trả lời; trả lời nó là lỗi giao thức và một số client sẽ ngắt.
 */
export async function xuLyGoi(goi: GoiJsonRpc): Promise<TraLoiJsonRpc | null> {
  const id = goi.id ?? null;
  const laThongBao = goi.id === undefined || goi.id === null;
  const p = goi.params ?? {};

  switch (goi.method) {
    case "initialize": {
      const xin = typeof p.protocolVersion === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.protocolVersion)
        ? p.protocolVersion
        : BAN_GIAO_THUC_MAC_DINH;
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: xin,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: TEN_MAY_CHU, version: BAN_MAY_CHU },
        },
      };
    }
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return laThongBao ? null : { jsonrpc: "2.0", id, result: {} };
    case "tools/list":
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: SO_TOOL_MCP.map((m) => ({ name: m.ten, description: m.moTa, inputSchema: m.luoc })),
        },
      };
    case "tools/call": {
      const ten = typeof p.name === "string" ? p.name : "";
      const args = p.arguments && typeof p.arguments === "object" ? (p.arguments as Record<string, unknown>) : {};
      if (ten === "") {
        return { jsonrpc: "2.0", id, error: { code: MA_JSONRPC.THAM_SO_XAU, message: "Thiếu `name`." } };
      }
      const kq = await goiToolMcp(ten, args);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: kq.chu }], isError: kq.loi } };
    }
    default:
      if (laThongBao) return null;
      return {
        jsonrpc: "2.0",
        id,
        error: { code: MA_JSONRPC.KHONG_CO_PHUONG_THUC, message: `Không hỗ trợ phương thức "${String(goi.method)}".` },
      };
  }
}

/**
 * ★ Bộ tách dòng + vòng lặp phục vụ. Tách khỏi `process.stdin` để lưới chạy được **đúng bắt tay
 * thật** mà không phải sinh một tiến trình con.
 */
export async function phucVu(
  docDong: AsyncIterable<string>,
  ghi: (s: string) => void,
): Promise<void> {
  for await (const dong of docDong) {
    const s = dong.trim();
    if (s === "") continue;
    let goi: GoiJsonRpc;
    try {
      goi = JSON.parse(s) as GoiJsonRpc;
    } catch {
      ke(`bỏ một dòng không phải JSON (${s.length} ký tự)`);
      continue;
    }
    let tra: TraLoiJsonRpc | null;
    try {
      tra = await xuLyGoi(goi);
    } catch (e) {
      tra = {
        jsonrpc: "2.0",
        id: goi.id ?? null,
        error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
      };
    }
    if (tra !== null) ghi(JSON.stringify(tra) + "\n");
  }
}

/** Tách `stdin` thành từng DÒNG (transport stdio của MCP: một thông điệp = một dòng). */
async function* dongTuStdin(): AsyncGenerator<string> {
  let dem = "";
  for await (const khuc of process.stdin as AsyncIterable<Buffer | string>) {
    dem += typeof khuc === "string" ? khuc : khuc.toString("utf8");
    let i = dem.indexOf("\n");
    while (i >= 0) {
      yield dem.slice(0, i);
      dem = dem.slice(i + 1);
      i = dem.indexOf("\n");
    }
  }
  if (dem.trim() !== "") yield dem;
}

/**
 * ★ Vòng phục vụ trên `stdin`/`stdout` thật. Người gọi là `batDau.ts`; file này KHÔNG tự chạy khi
 * được nhập (lưới phải `import` được nó mà không chiếm lấy `stdin`).
 */
export async function chayMcp(): Promise<void> {
  chotAnToanTienTrinh();
  // ★ QUẢN LÝ DỰ ÁN (2026-08-23) — nạp ẢNH CHỤP dự án nguồn DB đúng MỘT lần lúc tiến trình MCP
  // khởi động (đối xứng với `chayCli`; trước dòng này MCP chỉ thấy danh sách `.env` nên
  // `avi_list_projects` thiếu dự án admin vừa thêm qua UI). Máy không với được DB ⇒ degrade im
  // lặng về danh sách env thuần — cùng khuôn fail-safe, xem docblock `napLaiDuAnTuDb`.
  await napLaiDuAnTuDb();
  ke(`sẵn sàng — ${SO_TOOL_MCP.length} tool, KHÔNG có tool duyệt (HITL ở web hoặc ở ai:cli).`);
  await phucVu(dongTuStdin(), (s) => process.stdout.write(s));
}
