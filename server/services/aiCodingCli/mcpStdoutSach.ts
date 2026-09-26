/**
 * ★★★ 2026-08-24 — **MCP stdio: STDOUT PHẢI THUẦN JSON-RPC.** Đo LIVE bắt được lỗi:
 *
 * Transport của MCP là stdio — `stdout` là KÊNH GIAO THỨC, mỗi dòng một thông điệp JSON-RPC. Nhưng
 * hạ tầng dùng chung của app log bằng `console.log`/`console.info`, mà trong Node hai hàm ấy ghi
 * thẳng ra **stdout**. Boot-smoke 2026-08-24 thấy `[Database] Connecting…`, `[Redis] Connected`,
 * `[OAuth] Initialized…` rơi vào stdout — xen vào đúng khung JSON-RPC. Client dễ dãi (harness) bỏ
 * qua được, nhưng client NGHIÊM (Claude Desktop/Cursor) có thể báo "failed to parse" hoặc hỏng bắt
 * tay. `console.warn`/`console.error` mặc định đã ra stderr nên KHÔNG đụng tới (lỗi ở stderr là hợp
 * lệ với MCP).
 *
 * ⇒ Ở CHẾ ĐỘ MCP (và CHỈ chế độ ấy), chuyển `console.log`/`info`/`debug` sang **stderr**. Đáp
 *   JSON-RPC vẫn đi qua `process.stdout.write` TRỰC TIẾP ở `mcpServer.chayMcp` (không qua `console`),
 *   nên kênh giao thức KHÔNG bị đụng. Chế độ CLI giữ nguyên `console.log` → stdout (terminal cần nó).
 *
 * ⚠⚠ VÌ SAO IMPORT NÀY ĐỨNG TRƯỚC `dotenv/config` TRONG `batDau.ts`:
 *   Một số log rác phát ra lúc **nạp module** (ví dụ `[OAuth] Initialized`), tức TRƯỚC khi `main()`
 *   chạy. Cài lại `console` ở đầu `chayMcp()` là QUÁ MUỘN cho những dòng ấy. ESM đánh giá import theo
 *   thứ tự, nên để bắt được chúng, phép chuyển hướng phải cài ở module được import ĐẦU TIÊN. File này
 *   đọc **0 biến `process.env`** ở tầng module (chỉ `process.argv` + `console`), nên đặt nó trước
 *   `dotenv/config` KHÔNG phạm vào lý do của quy tắc "dotenv phải nạp trước" (quy tắc ấy chống module
 *   đọc env RỖNG — file này không đọc env).
 */
import { Console } from "node:console";

/**
 * ★ THUẦN: *"tiến trình này có chạy ở chế độ MCP không?"* Khớp ĐÚNG điều kiện điều phối của
 * `batDau.ts` (`process.argv.slice(2)[0] === "mcp"`). Nhận `argv` tường minh để lưới kiểm được.
 * ⚠ Đột biến đổi thành `.includes("mcp")` sẽ bật nhầm khi ai đó đặt tên/đối số dự án là "mcp" ở CLI
 *   ⇒ nuốt log terminal; ca lưới ghim vị trí SỐ 0 của subcommand.
 */
export function laCheDoMcp(argv: readonly string[] = process.argv): boolean {
  return argv.slice(2)[0] === "mcp";
}

/**
 * Chuyển `console.log`/`info`/`debug` sang một `Console` mà CẢ HAI luồng đều là `process.stderr`.
 * Trả về hàm KHÔI PHỤC (cho lưới; production không gọi). `warn`/`error` để nguyên (đã ra stderr).
 */
export function chuyenLogRaStderr(): () => void {
  const raStderr = new Console({ stdout: process.stderr, stderr: process.stderr });
  const goc = { log: console.log, info: console.info, debug: console.debug };
  console.log = raStderr.log.bind(raStderr);
  console.info = raStderr.info.bind(raStderr);
  console.debug = raStderr.debug.bind(raStderr);
  return () => {
    console.log = goc.log;
    console.info = goc.info;
    console.debug = goc.debug;
  };
}

// ★ TÁC DỤNG PHỤ LÚC NẠP: chỉ khi MCP. Import trong lưới (argv của vitest) ⇒ không kích hoạt.
if (laCheDoMcp()) {
  chuyenLogRaStderr();
}
