/**
 * ★★★ ĐỢT E — chạy lưới TRONG extension host VSCode THẬT (không phải `vscode` giả của vitest).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ 2026-08-30 (vòng sửa 1) — ĐẢO NGƯỢC chỉ thị ban đầu, theo đúng chỉ đạo của điều phối viên.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu trỏ THẲNG vào `vscodeExecutablePath` = bản VSCode ĐÃ CÀI trên máy — và bị CHẶN CỨNG:
 * `checkInnoSetupMutex` của chính VSCode từ chối khởi động vì hai tiến trình cài đặt
 * (`CodeSetup-stable-...`) giữ mutex "vscode-updating" kẹt nhiều ngày. Không được giết tiến trình
 * của người dùng để lấy đường chạy.
 *
 * Nên GIỜ LÀM NGƯỢC LẠI: KHÔNG truyền `vscodeExecutablePath` (trừ khi ép bằng biến môi trường
 * `AVI_VSCODE_EXE` — lối thoát cho người muốn quay lại bản cũ) ⇒ `@vscode/test-electron` TỰ TẢI một
 * bản VSCode `stable` về cache cục bộ (`.vscode-test/` trong `vscode-extension/`, mặc định của
 * `runTests()` khi không truyền `cachePath`). Bản tải về là ARCHIVE giải nén thẳng, KHÔNG qua trình
 * cài Inno Setup ⇒ không có tiến trình `CodeSetup-*` nào giữ mutex "vscode-updating" của NÓ (mutex
 * đó gắn với BẢN CÀI qua Inno Setup trên máy, không phải bản archive độc lập trong `.vscode-test/`).
 *
 * `--user-data-dir`/`--extensions-dir` vẫn trỏ riêng vào scratchpad như cũ — không đụng đến profile
 * thật của người dùng dù chạy bản tải về hay bản đã cài.
 *
 * `delete process.env.ELECTRON_RUN_AS_NODE` (phát hiện ở vòng trước) GIỮ NGUYÊN — vẫn cần dù chạy
 * bản nào, vì lỗ đó nằm ở TIẾN TRÌNH CHA, không phải ở bản Code.exe cụ thể.
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
  /** `undefined` ⇒ để `@vscode/test-electron` TỰ TẢI bản `stable` (xem docblock đầu tệp). */
  vscodeExecutablePath: string | undefined;
  cachePath: string;
  extensionDevelopmentPath: string;
  extensionTestsPath: string;
  mocOpen: string;
  userDataDir: string;
  extensionsDir: string;
  env: Record<string, string>;
}): Promise<number> {
  console.log(`\n[real-host] ═══ lượt "${opts.ten}" ═══`);
  console.log(`[real-host] mở: ${opts.mocOpen}`);
  console.log(
    opts.vscodeExecutablePath
      ? `[real-host] VSCode: ĐÃ CÀI tại ${opts.vscodeExecutablePath} (ép qua AVI_VSCODE_EXE)`
      : `[real-host] VSCode: TỰ TẢI bản stable về ${opts.cachePath} (không dùng bản đã cài)`,
  );
  try {
    const code = await runTests({
      ...(opts.vscodeExecutablePath ? { vscodeExecutablePath: opts.vscodeExecutablePath } : {}),
      cachePath: opts.cachePath,
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

  // ★ Mặc định: KHÔNG truyền vscodeExecutablePath ⇒ @vscode/test-electron tự tải bản `stable`.
  //   Ép dùng bản ĐÃ CÀI (đường cũ, bị chặn bởi mutex cài đặt kẹt trên máy này) chỉ khi người gọi
  //   TỰ ĐẶT AVI_VSCODE_EXE — không còn là mặc định.
  const vscodeExecutablePath = process.env.AVI_VSCODE_EXE || undefined;
  if (vscodeExecutablePath && !existsSync(vscodeExecutablePath)) {
    console.error(`[real-host] AVI_VSCODE_EXE trỏ tới đường KHÔNG tồn tại: ${vscodeExecutablePath}`);
    process.exit(1);
  }
  // Cache bản VSCode tự tải — mặc định của `runTests()` là `.vscode-test/` trong CWD; đặt TƯỜNG
  // MINH ở đây (neo theo `extRoot`, không phụ thuộc CWD lúc gọi script) để luôn nằm trong
  // `vscode-extension/.vscode-test/` bất kể ai gọi từ thư mục nào. Đã thêm vào `.gitignore`.
  const cachePath = join(extRoot, ".vscode-test");

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
    cachePath,
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
    cachePath,
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
