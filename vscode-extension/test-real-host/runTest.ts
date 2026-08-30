/**
 * ★★★ ĐỢT E — chạy lưới TRONG extension host VSCode THẬT (không phải `vscode` giả của vitest).
 *
 * Trỏ THẲNG vào bản VSCode ĐÃ CÀI trên máy (`vscodeExecutablePath`), KHÔNG tải bản mới — nhanh hơn
 * và đo đúng thứ người dùng đang chạy. `@vscode/test-electron` vẫn dùng một `--user-data-dir` +
 * `--extensions-dir` RIÊNG trong scratchpad (không phải profile thật của người dùng), nên lượt chạy
 * này không đụng cấu hình/extension khác đang cài.
 *
 * Chạy HAI lượt VSCode tuần tự — hai workspace KHÁC HÌNH DẠNG không thể trộn vào một cửa sổ:
 *   1. Workspace MỘT gốc — kích hoạt, lệnh, ghi đĩa thật, EOL/BOM, diff provider.
 *   2. Workspace HAI gốc — riêng cho `asRelativePath`/`giaiDuongDeXuat` (mục ★★, xem spec Đợt E §5).
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";
import { prepareMultiRoot, prepareSingleRoot } from "./fixtures";

async function chayMotLuot(opts: {
  ten: string;
  vscodeExecutablePath: string;
  extensionDevelopmentPath: string;
  extensionTestsPath: string;
  mocOpen: string;
  userDataDir: string;
  extensionsDir: string;
  env: Record<string, string>;
}): Promise<number> {
  console.log(`\n[real-host] ═══ lượt "${opts.ten}" ═══`);
  console.log(`[real-host] mở: ${opts.mocOpen}`);
  try {
    const code = await runTests({
      vscodeExecutablePath: opts.vscodeExecutablePath,
      extensionDevelopmentPath: opts.extensionDevelopmentPath,
      extensionTestsPath: opts.extensionTestsPath,
      launchArgs: [
        opts.mocOpen,
        "--user-data-dir",
        opts.userDataDir,
        "--extensions-dir",
        opts.extensionsDir,
        "--disable-workspace-trust",
        "--skip-welcome",
        "--skip-release-notes",
        "--disable-updates",
      ],
      extensionTestsEnv: opts.env,
    });
    console.log(`[real-host] lượt "${opts.ten}" xong, mã thoát ${code}`);
    return code;
  } catch (e) {
    console.error(`[real-host] lượt "${opts.ten}" NÉM lỗi (coi như ĐỎ):`, e);
    return 1;
  }
}

/**
 * ★★★ GOTCHA MÔI TRƯỜNG (đo được, không phải giả thuyết) — `ELECTRON_RUN_AS_NODE=1` rò từ tiến
 * trình cha (shell chạy Claude Code) vào MỌI tiến trình con Node của phiên này. `Code.exe` cũng là
 * một app Electron: với biến này, nó bỏ qua GUI và tự chạy như `node <đối số đầu>` — chính là lý do
 * lượt đầu tiên thất bại với `Cannot find module "<đường workspace>"` (Code.exe coi đường workspace
 * như một ENTRY SCRIPT để require). `@vscode/test-electron` kế thừa NGUYÊN `process.env` của tiến
 * trình Node đang chạy file này khi spawn `Code.exe` (`runTest.js:83`, `Object.assign({}, process.
 * env, testRunnerEnv)`) — nên xoá biến này ở ĐÂY, trước khi gọi `runTests()`, là đủ.
 */
delete process.env.ELECTRON_RUN_AS_NODE;

async function main(): Promise<void> {
  const extRoot = resolve(__dirname, "..");
  const distEntry = join(extRoot, "dist", "extension.js");
  if (!existsSync(distEntry)) {
    console.error(
      `[real-host] THIẾU ${distEntry} — chưa build extension. Chạy \`npm run build\` trong vscode-extension/ trước.`,
    );
    process.exit(1);
  }

  const vscodeExecutablePath =
    process.env.AVI_VSCODE_EXE || "C:\\Users\\Admin\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe";
  if (!existsSync(vscodeExecutablePath)) {
    console.error(`[real-host] Không thấy VSCode đã cài tại: ${vscodeExecutablePath}`);
    console.error(`[real-host] (đây là "bin\\code" CLI shim, KHÔNG dùng được — cần Code.exe thật)`);
    process.exit(1);
  }

  const tmpBase = process.env.AVI_TEST_TMP || join(tmpdir(), "avi-ai-local-real-host");
  rmSync(tmpBase, { recursive: true, force: true });
  mkdirSync(tmpBase, { recursive: true });

  const ws1 = join(tmpBase, "ws1");
  prepareSingleRoot(ws1);
  const { wsFile } = prepareMultiRoot(join(tmpBase, "ws-multi"));

  const extensionTestsPath = join(extRoot, "test-real-host-out", "suite", "index");

  let ma1 = 0;
  let ma2 = 0;
  ma1 = await chayMotLuot({
    ten: "workspace MỘT gốc",
    vscodeExecutablePath,
    extensionDevelopmentPath: extRoot,
    extensionTestsPath,
    mocOpen: ws1,
    userDataDir: join(tmpBase, "user-data-1"),
    extensionsDir: join(tmpBase, "extensions-1"),
    env: { AVI_TEST_WORKSPACE: ws1, AVI_TEST_SUITE: "single-root" },
  });

  ma2 = await chayMotLuot({
    ten: "workspace HAI gốc",
    vscodeExecutablePath,
    extensionDevelopmentPath: extRoot,
    extensionTestsPath,
    mocOpen: wsFile,
    userDataDir: join(tmpBase, "user-data-2"),
    extensionsDir: join(tmpBase, "extensions-2"),
    env: { AVI_TEST_WORKSPACE: join(tmpBase, "ws-multi"), AVI_TEST_SUITE: "multi-root" },
  });

  const maThoat = ma1 !== 0 ? ma1 : ma2;
  console.log(`\n[real-host] TỔNG KẾT: một-gốc=${ma1} · hai-gốc=${ma2} · mã thoát cuối=${maThoat}`);
  process.exit(maThoat);
}

main();
