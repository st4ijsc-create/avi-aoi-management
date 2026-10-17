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
 *   • ★★★ (vá cookie-tossing, lỗ còn lại) HOST = ĐỊA CHỈ ỨNG DỤNG (`capCong.docDiaChiUngDung`: loopback 127.x KHÁC
 *     127.0.0.1, vd 127.0.0.2) — KHÔNG BAO GIỜ 127.0.0.1/0.0.0.0/localhost: ứng dụng nghe 127.0.0.1 thì mã AI trong
 *     khung xem trước `window.open("http://127.0.0.1:51xx")` là chạy CÙNG SITE với ứng dụng chính. Mỗi khuôn ÉP
 *     host bằng cách của nó (`phanLoaiScript` / `argvVoiDiaChi`):
 *       – vite  ⇒ `npm run dev -- --host <đc> --port <cổng> --strictPort` (vite KHÔNG đọc biến HOST);
 *       – next  ⇒ `npm run dev -- -H <đc> -p <cổng>`;
 *       – dotnet⇒ `--no-launch-profile` (launchSettings.json không đè được ASPNETCORE_URLS=http://<đc>:<cổng>);
 *       – còn lại (node server.js, react-scripts, python app.py) ⇒ HOST/PORT — mã của dự án phải đọc chúng.
 *     Khuôn vite/next mà KHÔNG ép được (đã có --host/--port, nằm trong lệnh ghép/trích dẫn, có tiền tố như
 *     cross-env) ⇒ TỪ CHỐI `KHUON_KHONG_EP_DUOC_HOST`. Mọi khuôn — kể cả khuôn chỉ có HOST — còn bị trình quản lý
 *     KIỂM LÚC CHẠY: cổng nghe trên 127.0.0.1/::1 ⇒ dừng (`nghe-sai-dia-chi`), proxy không chuyển tới trước khi kiểm.
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
import { laDiaChiUngDungHopLe } from "./capCong";
import { docScriptsGoc, type KhaiBaoChay } from "./cauHinhChayDuAn";
import type { CachEpHost, LenhUngDung, TienTrinhUngDung } from "./quanLyUngDung";

export type TuChoiKhuon = { tuChoi: { ma: "KHUON_KHONG_EP_DUOC_HOST"; chiTiet: string } };

/** Ký tự của lệnh GHÉP / trích dẫn / biến — có chúng thì `-- <cờ>` của npm không chắc rơi đúng vào vite/next. */
const KY_TU_GHEP = /[&|;<>`$()"'\\^%]/;
const CO_HOST_PORT_VITE = /^--(host|port)(=|$)/;
const CO_HOST_PORT_NEXT = /^(-H|-p|--hostname|--port)(=|$)/;

function laLenh(token: string, ten: "vite" | "next"): boolean {
  const t = token.replace(/^["']+|["']+$/g, "").toLowerCase();
  return t === ten || t.endsWith(`/${ten}`) || t.endsWith(`\\${ten}`) || t === `${ten}.cmd` || t.endsWith(`/${ten}.js`);
}

/** Phân loại `scripts.<dev|start>`: ép host được bằng cách nào, hay phải từ chối. */
export function phanLoaiScript(script: string): { ep: CachEpHost } | TuChoiKhuon {
  const t = script.trim().split(/\s+/).filter(Boolean);
  const coVite = t.some((x) => laLenh(x, "vite"));
  const coNext = t.some((x) => laLenh(x, "next"));
  if (!coVite && !coNext) return { ep: "env" };
  const tuChoi = (chiTiet: string): TuChoiKhuon => ({ tuChoi: { ma: "KHUON_KHONG_EP_DUOC_HOST", chiTiet } });
  if (KY_TU_GHEP.test(script)) return tuChoi(`"${script}": lệnh ghép/trích dẫn — không ép được --host cho vite/next. Để script là đúng "vite" hoặc "next dev".`);
  if (t[0] === "vite") {
    if (t.some((x) => CO_HOST_PORT_VITE.test(x))) return tuChoi(`"${script}": bỏ --host/--port khỏi script — máy chủ tự đặt địa chỉ/cổng xem trước.`);
    return { ep: "vite" };
  }
  if (t[0] === "next" && (t[1] === "dev" || t[1] === "start")) {
    if (t.some((x) => CO_HOST_PORT_NEXT.test(x))) return tuChoi(`"${script}": bỏ -H/-p (--hostname/--port) khỏi script — máy chủ tự đặt địa chỉ/cổng xem trước.`);
    return { ep: "next" };
  }
  return tuChoi(`"${script}": vite/next phải đứng ĐẦU script (không tiền tố) để máy chủ ép được địa chỉ nghe.`);
}

/** Dựng lệnh THẬT từ khai báo đã kiểm (`suyLenhChay`). `{thieu}` ⇔ môi trường máy chủ thiếu npm-cli.js. */
export function dungLenhUngDung(khai: KhaiBaoChay, goc: string): LenhUngDung | { thieu: string } | TuChoiKhuon {
  if (khai.loai === "npm") {
    const scripts = docScriptsGoc(goc);
    const pl = phanLoaiScript(String(scripts?.[khai.script] ?? ""));
    if ("tuChoi" in pl) return pl;
    const cli = duongDanNpmCli();
    if (cli === null) return { thieu: "không tìm thấy npm-cli.js cạnh node của máy chủ" };
    return { file: process.execPath, args: [cli, "run", khai.script], envThem: { BROWSER: "none" }, moTa: `npm run ${khai.script}`, epHost: pl.ep };
  }
  if (khai.loai === "python") {
    const venv = duongPythonVenv(goc);
    const py = existsSync(venv) ? venv : "python";
    return { file: py, args: [khai.tep], envThem: { PYTHONUNBUFFERED: "1" }, moTa: `python ${khai.tep}`, epHost: "env" };
  }
  const args = ["run", "--project", khai.duAn, "--no-launch-profile", ...(dotnetChoPhepRestore() ? [] : ["--no-restore"])];
  return { file: "dotnet", args, envThem: {}, moTa: `dotnet ${args.join(" ")}`, epHost: "env" };
}

/** argv cuối cùng: khuôn vite/next nhận cờ địa chỉ/cổng qua `npm run <script> -- …`; khuôn khác giữ nguyên. */
export function argvVoiDiaChi(lenh: LenhUngDung, diaChi: string, cong: number): string[] {
  if (lenh.epHost === "vite") return [...lenh.args, "--", "--host", diaChi, "--port", String(cong), "--strictPort"];
  if (lenh.epHost === "next") return [...lenh.args, "--", "-H", diaChi, "-p", String(cong)];
  return [...lenh.args];
}

/** ★ CỬA DUY NHẤT. `envNguon` chỉ để lưới đo phép lọc mà không làm bẩn tiến trình. */
export function sinhUngDungThat(
  lenh: LenhUngDung,
  goc: string,
  cong: number,
  diaChi: string,
  envNguon: NodeJS.ProcessEnv = process.env,
): TienTrinhUngDung {
  // Lớp cuối (trình quản lý đã kiểm): không bao giờ sinh với 127.0.0.1/0.0.0.0/localhost.
  if (!laDiaChiUngDungHopLe(diaChi)) throw new Error(`DIA_CHI_UNG_DUNG_KHONG_HOP_LE: ${String(diaChi)}`);
  const env: NodeJS.ProcessEnv = {
    ...moiTruongDaLoc(envNguon),
    ...lenh.envThem,
    PORT: String(cong),
    HOST: diaChi,
    ASPNETCORE_URLS: `http://${diaChi}:${cong}`,
  };
  return spawn(lenh.file, argvVoiDiaChi(lenh, diaChi, cong), {
    cwd: goc,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
    shell: false,
  });
}
