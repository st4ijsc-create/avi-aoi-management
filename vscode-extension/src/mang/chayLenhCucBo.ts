/**
 * ★★★ ĐỢT M / TASK M2 — THỰC THI LỆNH ĐÃ DUYỆT (M1), TRÊN MÁY LẬP TRÌNH VIÊN. LỚP I/O SPAWN.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TÁI DÙNG ĐÚNG KHUÔN `mang/mcpClient.ts` — KHÔNG VIẾT LỚP SPAWN THỨ HAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `mcpClient.ts` đã trả giá cho ba bài học Windows mà tệp này THỪA HƯỞNG NGUYÊN VẸN, không đo lại:
 *   1. `spawn()` với một chương trình phân giải ra tệp `.cmd` (npm/npx/yarn khi KHÔNG `shell:true`)
 *      NÉM ĐỒNG BỘ `Error: spawn EINVAL` ngay tại lời gọi — bọc try/catch quanh CHÍNH lời gọi spawn.
 *   2. Chương trình không tồn tại (`ENOENT`) chỉ bắn sự kiện `'error'` KHÔNG ĐỒNG BỘ — không được
 *      để lọt thành "unhandled error event" làm sập extension host.
 *   3. Hai trần (THỜI GIAN + KÍCH THƯỚC) phải kiểm NGAY khi có dữ liệu mới, không đợi tiến trình
 *      tự kết thúc — một lệnh treo hoặc phun log khổng lồ (test loop vô hạn, build lỗi in triệu
 *      dòng) phải bị CẮT ĐỨT giữa chừng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO `npm`/`npx` PHẢI QUA `cmd /c`, CÒN `git`/`dotnet` THÌ KHÔNG (ĐO TRÊN MÁY WINDOWS THẬT)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đo trực tiếp bằng `node -e` trên máy Windows đang phát triển đợt này:
 *   · `spawn("npx.cmd", [...], {shell:false})`  ⇒ NÉM ĐỒNG BỘ `spawn EINVAL` (tệp `.cmd` cần một
 *     trình thông dịch dòng lệnh để đọc, Windows không tự nạp nó qua CreateProcess trần).
 *   · `spawn("npx", [...], {shell:false})` (không đuôi) ⇒ `ENOENT` KHÔNG ĐỒNG BỘ — Windows
 *     `spawn` KHÔNG tự dò `PATHEXT` như shell vẫn làm, nên "npx" trần không được tìm thấy dù
 *     `npx.cmd` có thật trên PATH.
 *   · `spawn("git", [...], {shell:false})` / `spawn("dotnet", [...], {shell:false})` ⇒ chạy THẲNG,
 *     không cần `cmd /c` — cả hai là `.exe` thật, `CreateProcess` nạp trực tiếp được.
 * ⇒ HAI CHƯƠNG TRÌNH DUY NHẤT trong allowlist (`npm`, `npx`) BẮT BUỘC đi qua `cmd /c` trên Windows.
 * KHÔNG dùng `shell: true` trên TOÀN BỘ lệnh (đó sẽ mở lại đúng cửa tiêm lệnh mà M1 vừa đóng bằng
 * cấu trúc) — thay vào đó `cmd /c` chỉ được dùng làm TRÌNH NẠP một chương trình `.cmd` CỤ THỂ, với
 * PHẦN CÒN LẠI của argv vẫn là các PHẦN TỬ MẢNH RIÊNG (không nối chuỗi rồi giao cho `cmd` tự tách).
 * `child_process.spawn` trên Windows dựng dòng lệnh cho `cmd.exe` bằng CÁCH TRÍCH DẪN TỪNG PHẦN TỬ
 * ĐÚNG QUY TẮC CreateProcess (đã đo ở trên: một token mang `;`/`&&` vẫn tới `cmd` như MỘT đối số
 * duy nhất, không bị `cmd` tách thành hai lệnh) — nhưng vì M1 không bao giờ để một token như vậy
 * lọt vào argv của SÁU khuôn hợp lệ, đây là phòng thủ CHIỀU SÂU, không phải hàng rào chính.
 * `/d /s /c`: `/d` bỏ qua AutoRun registry (một máy bị cấu hình AutoRun độc hại không tự chạy được
 * gì thêm), `/s` giữ nguyên quy tắc trích dẫn "bật soạn thảo" (an toàn hơn cho đường dẫn có dấu cách
 * bên trong MỘT đối số, dù M1 đã từ chối tham số có dấu cách).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * TỆP NÀY TRẢ VỀ DỮ LIỆU THÔ — KHÔNG CHE, KHÔNG ĐỊNH DẠNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `cheBiMat` + cắt theo trần hiển thị là việc của lớp THUẦN (`loi/dinhDangKetQuaLenh.ts`, không
 * `vscode`, đo được bằng vitest thường) — cùng ranh giới `mang/toolCucBo.ts` (chạm `vscode`+đĩa) đã
 * tách khỏi `loi/docCucBo.ts` (thuần, lọc/che/định dạng). Tệp CHẠM SPAWN không có logic đáng lưới
 * ngoài chính việc spawn, nên không cố nhét thêm quyết định vào đây.
 */
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import type { LenhDaDuyet } from "../loi/lenhChoPhep";
import { moiTruongDaLocChoTienTrinhCon } from "../loi/moiTruongAnToan";
import { BoDemDauRa } from "../../../shared/tienTrinhAnToan";
import { gietCayThenLopHai } from "./gietCay";
import { LOI_KHONG_TIN_CAY_NGUOI, workspaceTinCay } from "../loi/tinCayWorkspace";

/**
 * Đầu ra giữ ĐẦU + CUỐI trong bộ nhớ hằng số (Đợt 12/H2; trước đó: giữ 2 MB ĐẦU rồi GIẾT tiến trình — lỗi build/test nằm ở CUỐI nên bị mất,
 * và một lệnh đang chạy tốt bị giết chỉ vì nói nhiều). Tổng 18 000 ký tự < `TRAN_KY_TU_KET_QUA_LENH` (20 000, `loi/dinhDangKetQuaLenh.ts`) ⇒ bước
 * hiển thị KHÔNG cắt thêm đuôi; phần giữa bị bỏ được khai ngay trong chuỗi ("ĐÃ CẮT … Ở GIỮA"). Trần THỜI GIAN vẫn giết lệnh chạy vô hạn.
 */
export const TRAN_DAU_DAU_RA_LENH = 6_000;
export const TRAN_CUOI_DAU_RA_LENH = 12_000;

export interface KetQuaChayLenh {
  ok: boolean;
  /** stdout + stderr GỘP, theo đúng thứ tự chunk tới (mất khả năng tách hai luồng, nhưng đơn giản
   *  hơn và đủ cho mục đích "đọc lỗi build/test" — lỗi build thường in ra CẢ HAI luồng lẫn lộn). */
  output: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  daCatSom: boolean;
  durationMs: number;
}

/** Hai chương trình BẮT BUỘC nạp qua `cmd /c` trên Windows (tệp `.cmd`, ném EINVAL đồng bộ nếu
 *  spawn trần) — xem docblock trên. Danh sách CỐ Ý hẹp: chỉ hai tên CÓ THẬT trong sáu khuôn M1. */
const CAN_CMD_TREN_WINDOWS = new Set(["npm", "npx"]);

/** Dựng argv THẬT cho `spawn`, tuỳ nền tảng. `lenh.argv` (đã qua M1) không đổi ý nghĩa — chỉ đổi
 *  CHƯƠNG TRÌNH nạp nó khi cần, KHÔNG chuyển sang `shell:true` cho toàn bộ lệnh (xem docblock trên). */
function dungArgvThuc(argv: string[]): { chuongTrinh: string; doi: string[] } {
  const [chuongTrinh, ...doi] = argv;
  if (process.platform === "win32" && CAN_CMD_TREN_WINDOWS.has(chuongTrinh)) {
    return { chuongTrinh: "cmd", doi: ["/d", "/s", "/c", chuongTrinh, ...doi] };
  }
  return { chuongTrinh, doi };
}

/**
 * ★★★ LỚP I/O THẬT DUY NHẤT của Đợt M gọi `child_process.spawn`. Không unit-test trực tiếp — cùng
 * lý do `taoTienTrinhMcpNgoai` không được lưới trực tiếp (I/O thật, không phải quyết định thuần);
 * bằng chứng cho tệp này là M5 (đo LIVE, dán output thật) + M6 (ablation).
 *
 * ⚠ `cwd`: PHẢI là thư mục workspace của người dùng (`vscode.workspace.workspaceFolders`, tiêm vào
 *   qua tham số — tệp này không tự đọc `vscode`), KHÔNG BAO GIỜ `process.cwd()` của tiến trình
 *   extension host — đây CHÍNH LÀ lỗi đã huỷ I-3/I-4 (`gocHopCat()` rơi về `process.cwd()` của máy
 *   CHỦ). Không có giá trị mặc định nào ở tham số này — bắt buộc nơi gọi truyền tường minh.
 * ⚠ `shell: false` — KHÔNG THƯƠNG LƯỢNG, xem docblock đầu tệp. Chỉ HAI chương trình cụ thể được
 *   nạp qua `cmd /c` (bản thân `cmd` cũng `shell:false`, không có bước "diễn giải một chuỗi lệnh"
 *   nào chạy trên đầu vào của người dùng).
 * ⚠ `windowsHide: true` — cùng lý do `mcpClient.ts`: không cần cửa sổ console nháy lên.
 * ⚠ `stdin: "ignore"` — sáu lệnh trong allowlist không lệnh nào cần đọc từ bàn phím; để mở stdin sẽ
 *   khiến một số công cụ (đặc biệt `dotnet test` với runner tương tác) TREO chờ input không bao giờ
 *   tới, vô hiệu hoá trần thời gian bằng cách khiến tiến trình "còn sống" nhưng vô dụng cho tới khi
 *   trần buộc phải giết nó — đóng `stdin` giúp các công cụ đó tự thấy KHÔNG có input và thoát sớm
 *   thay vì chờ.
 */
export function chayLenhCucBo(dv: { lenh: LenhDaDuyet; cwd: string; tranMs: number }): Promise<KetQuaChayLenh> {
  const batDau = Date.now();
  // (Đợt 11.4) Workspace Trust: workspace chưa tin cậy ⇒ KHÔNG spawn gì (lệnh dự án = mã của repo lạ).
  if (!workspaceTinCay()) {
    return Promise.resolve({ ok: false, output: LOI_KHONG_TIN_CAY_NGUOI, exitCode: null, signal: null, timedOut: false, daCatSom: false, durationMs: 0 });
  }
  const { chuongTrinh, doi } = dungArgvThuc(dv.lenh.argv);

  return new Promise((resolveP) => {
    // ★★★ TOÀN BỘ thân hàm nằm trong try (không tách `spawn()` riêng ra ngoài rồi gán vào một biến
    // `let` khai kiểu tay — cùng bài học `mcpClient.ts#taoTienTrinhMcpNgoai`): giữ NGUYÊN cách
    // TypeScript suy luận kiểu overload HẸP `ChildProcessByStdio<null, Readable, Readable>`
    // (stdout/stderr KHÔNG `null`, stdin LÀ `null` vì ta truyền "ignore" cho nó) từ đúng object
    // `stdio` truyền thẳng vào lời gọi. Một `let cp: ReturnType<typeof spawn>` khai riêng sẽ rơi về
    // overload RỘNG nhất (`ChildProcess`, mọi luồng CÓ THỂ `null`) và làm `tsc` đỏ ở
    // `cp.stdout.on(...)`/`cp.stderr.on(...)` bên dưới.
    try {
      const cp = spawn(chuongTrinh, doi, {
        cwd: dv.cwd,
        // ★ 2026-10-18 — `lenh.env` là HẰNG của allowlist (khoá mạng go/cargo), không bao giờ từ chuỗi người gõ.
        // ★ Đợt 12/H2 — KHÔNG truyền nguyên `process.env`: token/khoá đám mây của dev không được lọt vào tiến trình chạy mã model viết.
        //   `lenh.env` (hằng của allowlist) đặt SAU khi lọc.
        env: { ...moiTruongDaLocChoTienTrinhCon(process.env), ...(dv.lenh.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // POSIX: pid thành thủ lĩnh nhóm ⇒ `gietCayTienTrinh` giết được cả nhóm (Windows dùng `taskkill /T`).
        detached: process.platform !== "win32",
      });
      chayTiepSauKhiSpawn(cp, dv.tranMs, batDau, resolveP);
    } catch (e) {
      // ★★★ Bài học H4 của `mcpClient.ts` — `spawn()` có thể ném ĐỒNG BỘ (tệp `.cmd` mà vì lý do
      // nào đó không nằm trong `CAN_CMD_TREN_WINDOWS`/nền tảng khác biệt). Trả về một kết cục "lỗi"
      // BÌNH THƯỜNG thay vì để ngoại lệ thoát ra ngoài Promise executor (một throw ở đây sẽ làm cả
      // `Promise` không bao giờ resolve/reject đúng cách vì đã ở trong executor đồng bộ — Node CÓ
      // biến throw trong executor thành reject, nhưng khai rõ ràng ở đây rõ ràng hơn dựa vào hành vi
      // ngầm định đó).
      resolveP({
        ok: false,
        output: `không khởi động được tiến trình: ${(e as Error).message}`,
        exitCode: null,
        signal: null,
        timedOut: false,
        daCatSom: false,
        durationMs: Date.now() - batDau,
      });
    }
  });
}

/** Phần XỬ LÝ SỰ KIỆN sau khi `spawn` đã thành công — tách khỏi `chayLenhCucBo` chỉ để giữ nguyên
 *  kiểu HẸP của `cp` (xem bình luận tại nơi gọi); KHÔNG mang thêm quyết định nào ngoài chính nó. */
function chayTiepSauKhiSpawn(
  cp: import("node:child_process").ChildProcessByStdio<null, import("node:stream").Readable, import("node:stream").Readable>,
  tranMs: number,
  batDau: number,
  resolveP: (kq: KetQuaChayLenh) => void,
): void {
  let daXongMotLan = false;
  const bo = new BoDemDauRa(TRAN_DAU_DAU_RA_LENH, TRAN_CUOI_DAU_RA_LENH);
  let loiKhoiDong = "";
  let timedOut = false;

  const hetHan = setTimeout(() => {
    timedOut = true;
    // Cả CÂY (npm → cmd → node…), rồi `cp.kill()` làm lớp thứ hai (taskkill vắng mặt / pid đã chết).
    gietCayThenLopHai(cp);
  }, tranMs);

  const doanXong = (thanhCong: boolean, exitCode: number | null, signal: NodeJS.Signals | null) => {
    if (daXongMotLan) return; // `close` VÀ `error` có thể cùng bắn — chỉ resolve một lần.
    daXongMotLan = true;
    clearTimeout(hetHan);
    resolveP({
      ok: thanhCong,
      output: loiKhoiDong || bo.ket().text,
      exitCode,
      signal,
      timedOut,
      daCatSom: bo.catBot,
      durationMs: Date.now() - batDau,
    });
  };

  // Mỗi luồng một bộ giải mã: một ký tự UTF-8 nhiều byte bị chia đôi giữa hai chunk không hoá thành "�".
  const giaiMaOut = new StringDecoder("utf8");
  const giaiMaErr = new StringDecoder("utf8");
  cp.stdout.on("data", (buf: Buffer) => bo.them(giaiMaOut.write(buf)));
  cp.stderr.on("data", (buf: Buffer) => bo.them(giaiMaErr.write(buf)));
  // ENOENT (chương trình không tồn tại) bắn sự kiện KHÔNG ĐỒNG BỘ này — xem bài học H4.
  cp.on("error", (e) => {
    if (bo.byteThat === 0) loiKhoiDong = `lỗi tiến trình: ${e.message}`;
    doanXong(false, null, null);
  });
  cp.on("close", (code, signal) => doanXong(!timedOut && code === 0, code, signal));
}
