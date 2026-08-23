/**
 * ★★★ doc 83 — **ĐIỂM VÀO DUY NHẤT của cả CLI lẫn MCP. Và nó tồn tại vì MỘT lý do đo được.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `import "dotenv/config"` PHẢI Ở ĐÂY, **KHÔNG** ĐƯỢC Ở `cli.ts`/`mcpServer.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai sự thật đối nghịch nhau, và file này là chỗ giải quyết:
 *
 *  1. **CLI CẦN `.env`.** Không có nó thì `AI_REPO_SANDBOX_ROOTS` rỗng (⇒ chỉ còn dự án mặc định),
 *     `DATABASE_URL` vắng (⇒ không đăng nhập được), `LLAMA_SERVER_URL` vắng (⇒ không gọi model
 *     được). Đó là lý do `server/_core/index.ts` và `server/worker.ts` đều mở đầu bằng đúng dòng ấy.
 *  2. **LƯỚI KHÔNG ĐƯỢC nạp `.env`.** `vitest.setup.ts` cố ý chỉ đọc **một khoá** (`DATABASE_URL`)
 *     và nói thẳng vì sao: *"we deliberately do NOT load the whole .env — that would inject
 *     production feature flags (FOE_ENABLED, AI_*, GGUF_*, …) and break the many tests that assert
 *     a flag is OFF-by-default"*. Một `import "dotenv/config"` trong `cli.ts` sẽ nạp toàn bộ `.env`
 *     vào **mọi tiến trình vitest nào import `./cli`** — tức lượt này sẽ làm hỏng những lưới KHÁC,
 *     ở những file KHÁC, theo một cách không ai truy ngược về đây được.
 *
 * ⇒ Tách: `cli.ts`/`mcpServer.ts` là **thư viện thuần** (lưới nhập được, 0 tác dụng phụ môi
 *   trường); file này là **vỏ chạy** và là nơi DUY NHẤT chạm `dotenv`.
 *
 * ⚠ Thứ tự import ở đây là **có ý nghĩa**: ESM đánh giá XONG toàn bộ import rồi mới chạy thân hàm,
 *   nên `dotenv/config` phải là câu `import` ĐẦU TIÊN — nếu không, một module nào đó đọc
 *   `process.env` ở tầng module sẽ thấy giá trị TRỐNG. Đây là cùng cạm bẫy mà
 *   `server/_core/index.ts` đã ghi lại trong docblock của nó.
 *
 * CÁCH CHẠY
 *   npm run ai:cli  -- --du-an repo
 *   npm run ai:mcp                    (MCP client tự sinh tiến trình này)
 */
import "dotenv/config";
import { chayCliVoiTerminalThat } from "./cli";
import { chayMcp } from "./mcpServer";
import { chotAnToanTienTrinh } from "./cauNoiCli";

async function main(): Promise<number> {
  // ★ CHỐT VRAM — sớm nhất có thể. `chayCli`/`chayMcp` cũng tự chốt (phòng vệ theo tầng).
  chotAnToanTienTrinh();
  const argv = process.argv.slice(2);
  if (argv[0] === "mcp") {
    await chayMcp();
    return 0;
  }
  return chayCliVoiTerminalThat(argv);
}

main()
  .then((ma) => process.exit(ma))
  .catch((e) => {
    process.stderr.write(`✖ ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exit(1);
  });
