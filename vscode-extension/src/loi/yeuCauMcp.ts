/**
 * ★★★ ĐỢT H / TASK H2 / B2 — ĐỌC YÊU CẦU GỌI TOOL MCP NGOÀI TỪ VĂN BẢN MODEL.
 *
 * CÙNG KHUÔN với `loi/yeuCauDoc.ts` (ba tool đọc cục bộ): dùng CHUNG `tachKhoiAviTool`
 * (`khoiAviTool.ts`) — KHÔNG chép lại regex hàng rào, đúng luật "không chép bản sao thứ hai của
 * khung JSON-RPC/hàng rào gửi/logic vòng tác nhân" mà kế hoạch Task H2 đặt ra. MỘT tên tool MỚI
 * (`mcp_goi`) trong CÙNG từ vựng `avi-tool` — không phải một giao thức song song.
 *
 * ⚠ Đây là module CHỈ ĐỌC — không `import "vscode"`, không chạm mạng/đĩa. Thực thi (gọi tiến trình
 * MCP thật) nằm ở `mang/mcpDieuPhoi.ts`. Thiếu trường/sai kiểu ⇒ BỎ QUA khối đó (không đoán), đúng
 * quy ước `docYeuCauDoc`/`deXuatCucBo.ts`.
 */
import { tachKhoiAviTool } from "./khoiAviTool";

/** Tên tool trong từ vựng `avi-tool` dành cho lời gọi MCP ngoài. */
export const TEN_TOOL_MCP = "mcp_goi";

export interface YeuCauMcp {
  server: string;
  tool: string;
  dauVao: Record<string, unknown>;
}

export function docYeuCauMcpNgoai(vanBan: string): YeuCauMcp[] {
  const ra: YeuCauMcp[] = [];
  for (const { tool, args } of tachKhoiAviTool(vanBan)) {
    if (tool !== TEN_TOOL_MCP) continue;
    if (typeof args.server !== "string" || args.server.trim() === "") continue;
    if (typeof args.tool !== "string" || args.tool.trim() === "") continue;
    // `dauVao` tuỳ chọn — vắng mặt ⇒ object rỗng (nhiều tool MCP không cần tham số).
    if (args.dauVao !== undefined && (typeof args.dauVao !== "object" || args.dauVao === null || Array.isArray(args.dauVao))) {
      continue;
    }
    ra.push({
      server: args.server,
      tool: args.tool,
      dauVao: (args.dauVao as Record<string, unknown> | undefined) ?? {},
    });
  }
  return ra;
}
