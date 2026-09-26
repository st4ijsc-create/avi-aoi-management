/**
 * ★★★ ĐỢT H / TASK H2 / B2 — KHUNG DÒNG JSON-RPC 2.0 PHÍA CLIENT (đọc trả lời của MCP server ngoài).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KHÔNG IMPORT TRỰC TIẾP `server/services/aiCodingCli/mcpServer.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `mcpServer.ts` đã có khung DÒNG cho transport stdio (`dongTuStdin`/`phucVu`) — đúng khuôn cần
 * DÙNG LẠI, không phát minh lại. Nhưng import thẳng tệp đó kéo theo `danhTinhCli`/`repoProjects`
 * (bcrypt, Drizzle/DB thật) vào bundle của MỘT EXTENSION VSCode — nặng, sai tầng, và phá chính
 * spirit "0 gói mới" của tệp gốc. Nên tệp NÀY chỉ PHỎNG lại đúng thuật toán khung dòng của
 * `dongTuStdin` (đệm chuỗi, tách theo `\n`, giữ phần dư), viết dưới hình dạng THUẦN
 * (đệm-cũ, chunk-mới) → (đã tách, dư) — CÙNG hợp đồng mà `loi/khungSse.ts::tachKhungSse` đã dùng
 * cho SSE (đúng bài học "cắt ngang giữa hai chunk" của dự án này) — thay vì mô phỏng một
 * `AsyncGenerator` trên `process.stdin` như bản gốc (không hợp với việc lưới cần đo TỪNG BƯỚC
 * đệm mà không cần dựng luồng thật).
 *
 * ⚠ Đây LÀ một bản sao thuật toán, không phải một khung THỨ HAI với luật khác: cùng cách "mỗi
 *   thông điệp một dòng, JSON hỏng/rác thì bỏ qua chứ không ném" như `xuLyGoi`/`phucVu` gốc. Server
 *   `mcpServer.ts` CỐ Ý không sửa theo hướng dùng chung tệp này (ưu tiên không đụng mã một phiên
 *   khác đang giữ, xem báo cáo Task H2) — nếu sau này người khác muốn hợp nhất, thuật toán ở đây
 *   khớp 1-1 với `dongTuStdin`/`phucVu` nên việc hợp nhất là đổi con trỏ, không phải viết lại.
 *
 * THUẦN (không `import "vscode"`, không mạng/đĩa) — I/O thật (spawn tiến trình, ghi/đọc stdio) nằm
 * ở `mang/mcpClient.ts`.
 */

/** Hình dạng một GÓI trả lời JSON-RPC — chỉ những trường ta thật sự đọc. */
export interface TraLoiJsonRpcMcp {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface KetQuaTachDongJsonRpc {
  /** Các gói ĐÃ tách được trong lượt gọi này — object hợp lệ, KHÔNG NÉM khi một dòng hỏng. */
  thongDiep: TraLoiJsonRpcMcp[];
  /** Phần DƯ (dòng chưa hoàn chỉnh, chưa gặp `\n`) — người gọi mang sang lượt gọi kế tiếp. */
  du: string;
  /** Dòng RÁC (không phải JSON hợp lệ, hoặc JSON không phải object) — để người gọi khai/đếm, KHÔNG làm sập phiên. */
  dongRac: string[];
}

/**
 * ★★★ Nhận (đệm cũ, chunk mới) trả (đã tách, dư, rác) — cùng hợp đồng `tachKhungSse`. Vòng đọc chỉ
 * việc mang `du` sang lần gọi kế tiếp; không có trạng thái ẩn nào khác được giữ giữa các lần gọi.
 *
 * ★ Xử lý ĐÚNG BA hình dạng lưới yêu cầu (B2): (1) một thông điệp bị CẮT NGANG giữa hai chunk —
 * nửa đầu không có `\n` nên rơi vào `du`, ghép với nửa sau ở lần gọi kế mới ra đủ một dòng; (2)
 * DÒNG RÁC (không phải JSON) — vào `dongRac`, các dòng khác trong CÙNG lượt gọi vẫn được xử lý
 * bình thường; (3) JSON HỎNG cú pháp — cùng nhánh với (2), `JSON.parse` bắt ở `try/catch` LOCAL
 * cho từng dòng, một dòng hỏng không làm mất các dòng hợp lệ khác trong cùng chunk.
 */
export function tachDongJsonRpc(dem: string, chunk: string): KetQuaTachDongJsonRpc {
  const buf = dem + chunk;
  const dong = buf.split(/\r?\n/);
  // Phần tử CUỐI của split có thể là một dòng CHƯA hoàn chỉnh (buf không kết thúc bằng \n) — đó là
  // phần DƯ, mang sang lần gọi kế. Nếu buf kết thúc đúng bằng \n thì phần tử cuối là chuỗi rỗng.
  const du = dong.pop() ?? "";
  const thongDiep: TraLoiJsonRpcMcp[] = [];
  const dongRac: string[] = [];

  for (const d of dong) {
    const s = d.trim();
    if (s === "") continue; // dòng trống giữa hai gói — vô hại, không phải rác
    let obj: unknown;
    try {
      obj = JSON.parse(s);
    } catch {
      dongRac.push(s);
      continue;
    }
    // Cùng bài học đã trả giá ở `khoiAviTool.ts`: `null`/số/chuỗi/mảng đều là JSON hợp lệ — phải
    // kiểm là OBJECT trước khi coi nó là một gói JSON-RPC.
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      thongDiep.push(obj as TraLoiJsonRpcMcp);
    } else {
      dongRac.push(s);
    }
  }

  return { thongDiep, du, dongRac };
}

/** Dựng MỘT dòng yêu cầu JSON-RPC (kèm `\n` kết dòng — đúng khuôn "mỗi thông điệp một dòng"). */
export function dungDongYeuCauJsonRpc(id: number, method: string, params: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

/** Dựng MỘT dòng NOTIFICATION (không `id` — theo JSON-RPC, không được chờ trả lời cho dòng này). */
export function dungDongThongBaoJsonRpc(method: string): string {
  return `${JSON.stringify({ jsonrpc: "2.0", method })}\n`;
}
