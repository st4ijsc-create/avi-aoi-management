/**
 * ★★★ Đợt 3c (2026-10-17) — **CỬA DUY NHẤT** sinh tiến trình ỨNG DỤNG xem trước.
 *
 * Mọi lượt "chạy ứng dụng" của trình quản lý đi qua `sinhUngDungThat` — census `chayUngDung.census.test.ts` ghim
 * rằng `child_process` chỉ được nhập ở file này trong `chayUngDung/`, và `vramAllocationSites.ts` khai nó.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * CÙNG HÀNG RÀO VỚI HỘP CÁT LỆNH (`repoCommandSandbox.chayLenhTrongHopCat`), KHÁC VÒNG ĐỜI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • argv RỜI, `shell: false` — lệnh dựng từ KHAI BÁO (`KhaiBaoChay`), không từ chuỗi. ⚠ Đính chính như hộp cát
 *     lệnh: `npm run dev` tự chạy `scripts.dev` qua cmd.exe — cơ chế của npm, và chuỗi ấy là của package.json dự
 *     án (người/AI sửa nó phải qua thẻ duyệt apply_diff), không của model lúc chạy.
 *   • Môi trường = `moiTruongDaLoc()` (danh sách TRẮNG tên biến: không DATABASE_URL/MASTER_API_KEY/…) + biến của
 *     ứng dụng: PORT/HOST (+ASPNETCORE_URLS) theo cổng TRONG DẢI do trình quản lý cấp. `envThem` của lệnh đặt
 *     TRƯỚC nên KHÔNG đè được PORT/HOST — cổng là của trình quản lý (proxy chỉ chuyển tới cổng ấy).
 *   • HOST=127.0.0.1: ứng dụng chỉ nghe loopback — đường vào DUY NHẤT từ trình duyệt là proxy xem trước có xác
 *     thực. (Ứng dụng nào lờ biến HOST mà nghe 0.0.0.0 thì vẫn lộ ra LAN — giới hạn khai thẳng ở báo cáo.)
 *   • cwd = gốc dự án (đã qua danh sách trắng `repoProjects`); POSIX `detached` để giết theo nhóm, Windows
 *     `taskkill /T` (`gietCayTienTrinh`).
 *   • KHÔNG hạn giờ: ứng dụng là tiến trình SỐNG LÂU — trần của nó là nhàn rỗi 30 phút + dừng khi tắt máy
 *     (trình quản lý), không phải "giết sau N giây".
 * ⚠ KHÔNG chạm GPU theo cấu tạo — nhưng mã của dự án có thể (một app Python nạp torch.cuda). Khai ở
 *   `vramAllocationSites.ts` như `repoCommandSandbox` (hộ CPU mặc định, HITL + người bấm Chạy).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dotnetChoPhepRestore, duongDanNpmCli, duongPythonVenv, moiTruongDaLoc } from "../../aiLocalTools/repoCommandSandbox";
import type { KhaiBaoChay } from "./cauHinhChayDuAn";
import type { LenhUngDung, TienTrinhUngDung } from "./quanLyUngDung";

/** Dựng lệnh THẬT từ khai báo đã kiểm (`suyLenhChay`). `{thieu}` ⇔ môi trường máy chủ thiếu npm-cli.js. */
export function dungLenhUngDung(khai: KhaiBaoChay, goc: string): LenhUngDung | { thieu: string } {
  if (khai.loai === "npm") {
    const cli = duongDanNpmCli();
    if (cli === null) return { thieu: "không tìm thấy npm-cli.js cạnh node của máy chủ" };
    return { file: process.execPath, args: [cli, "run", khai.script], envThem: { BROWSER: "none" }, moTa: `npm run ${khai.script}` };
  }
  if (khai.loai === "python") {
    const venv = duongPythonVenv(goc);
    const py = existsSync(venv) ? venv : "python";
    return { file: py, args: [khai.tep], envThem: { PYTHONUNBUFFERED: "1" }, moTa: `python ${khai.tep}` };
  }
  const args = ["run", "--project", khai.duAn, ...(dotnetChoPhepRestore() ? [] : ["--no-restore"])];
  return { file: "dotnet", args, envThem: {}, moTa: `dotnet ${args.join(" ")}` };
}

/** ★ CỬA DUY NHẤT. `envNguon` chỉ để lưới đo phép lọc mà không làm bẩn tiến trình. */
export function sinhUngDungThat(lenh: LenhUngDung, goc: string, cong: number, envNguon: NodeJS.ProcessEnv = process.env): TienTrinhUngDung {
  const env: NodeJS.ProcessEnv = {
    ...moiTruongDaLoc(envNguon),
    ...lenh.envThem,
    PORT: String(cong),
    HOST: "127.0.0.1",
    ASPNETCORE_URLS: `http://127.0.0.1:${cong}`,
  };
  return spawn(lenh.file, [...lenh.args], {
    cwd: goc,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
  });
}
