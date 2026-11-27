/**
 * MỘT NGUỒN cho môi trường của tiến trình CON chạy mã không tin cậy: `run_command` (repoCommandSandbox.ts, xuất lại) và bộ chạy pilot
 * (scripts/tho-ca-pilot/kiemChung.ts, bộ chạy BỎ thêm nhóm proxy). Không import gì: nạp được trước khi môi trường được dựng.
 */

/**
 * Hệ điều hành + chuỗi công cụ, **không một biến ứng dụng nào**. So khớp **KHÔNG phân biệt hoa
 * thường** vì Windows để `Path` còn POSIX để `PATH`, và một phép so phân biệt hoa thường ở đây sẽ
 * cắt mất `PATH` trên Windows ⇒ mọi lượt chạy `git` hỏng ENOENT (một lỗi trông y như "git chưa cài").
 *
 * ★★ 2026-08-24 (mục 5) — NHÓM PROXY. `dotnet restore`/`npm` sau tường lửa doanh nghiệp cần
 *   `HTTP(S)_PROXY`/`NO_PROXY` để ra được internet. Đây là **cấu hình MẠNG của chuỗi công cụ, KHÔNG
 *   phải bí mật ứng dụng** (không khớp regex bí mật của census §G: `SECRET|TOKEN|KEY|PASSWORD|DATABASE
 *   |API`), nên nó vào danh sách trắng đúng chỗ. Và nó **TRƠ khi offline**: mặc định `--no-restore`
 *   (dotnet) + `npm_config_offline` (`BIEN_MOI_TRUONG_DAT_THEM`) ⇒ không lệnh nào ra mạng để mà dùng
 *   proxy; biến chỉ có tác dụng khi triển khai CÓ internet bật `DOTNET_CHO_PHEP_RESTORE=1`. Ai nhét
 *   mật khẩu vào URL proxy (`http://user:pass@…`) là nhét **cred của chính mình** để mở restore —
 *   quyết định của người triển khai, không phải bí mật máy chủ mà pha A canh.
 */
export const BIEN_MOI_TRUONG_CHO_PHEP: readonly string[] = [
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR",
  "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
  "LANG", "LC_ALL", "TZ",
  // ★ Proxy chuỗi công cụ (mục 5) — xem docblock trên. So khớp KHÔNG phân biệt hoa/thường nên bản
  //   viết hoa ở đây phủ luôn `http_proxy`/`https_proxy`/`no_proxy` viết thường mà npm/curl hay đọc.
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  // ★ 2026-10-19 — NuGet dựng đường cấu hình máy từ `ProgramFiles(x86)`/`ProgramFiles`; vắng cả hai ⇒ MỌI restore chết
  //   ngay ("ConfigurationDefaults … Value cannot be null (Parameter 'path1')", đo trên SDK 10.0.302). Đường HĐH, không
  //   phải bí mật. Lưới: `repoCommandDotnetRestoreOffline.test.ts` §2b + §3 (chạy thật).
  "PROGRAMFILES", "PROGRAMFILES(X86)",
];

/**
 * Biến ĐẶT THÊM (không đến từ `process.env`): tắt mọi đường ra mạng của npm + tắt màu để đầu ra
 * vào cửa sổ chat không lẫn mã ANSI.
 */
export const BIEN_MOI_TRUONG_DAT_THEM: Readonly<Record<string, string>> = {
  npm_config_offline: "true",
  npm_config_audit: "false",
  npm_config_fund: "false",
  npm_config_update_notifier: "false",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
  CI: "1",
  // ★ doc 79 (D) — dotnet: tắt telemetry (một đường ra mạng) + logo + trải nghiệm lần đầu (tải gói).
  //   Cùng vai với `npm_config_offline`: chặn đường ra mạng NGẦM của chuỗi công cụ, không phải một
  //   hộp cát mạng. `--no-restore` ở argv lo phần restore (mặc định — triển khai có internet mở
  //   bằng `DOTNET_CHO_PHEP_RESTORE=1`, xem `dotnetChoPhepRestore`); ba biến này lo phần còn lại
  //   và KHÔNG đổi theo cờ ấy.
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
  DOTNET_NOLOGO: "1",
  DOTNET_SKIP_FIRST_TIME_EXPERIENCE: "1",
};

/**
 * Hai URL CSDL CHẾT (cổng 9), tên CSDL khác nhau (vitest.setup từ chối khi trùng tên). Đặt NGAY CHỖ SINH tiến trình chạy mã không tin cậy (run_command,
 * lệnh kiểm của bộ chạy) để vitest.setup không rơi vào nhánh đọc `.env`. CỐ Ý KHÔNG nằm trong BIEN_MOI_TRUONG_DAT_THEM: cửa chạy ứng dụng của người dùng
 * (cuaSinhUngDung.ts) dùng chung danh sách ấy và ứng dụng cần URL thật của dự án nó.
 */
export const URL_CSDL_CHET: Readonly<Record<string, string>> = {
  DATABASE_URL: "postgresql://pilot_kiem:x@127.0.0.1:9/aoi_management",
  TEST_DATABASE_URL: "postgresql://pilot_kiem:x@127.0.0.1:9/aoi_management_test",
};
