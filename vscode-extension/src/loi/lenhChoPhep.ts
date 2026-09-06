/**
 * ★★★ ĐỢT M / TASK M1 — ALLOWLIST LỆNH CHẠY TRÊN MÁY LẬP TRÌNH VIÊN. THUẦN, KHÔNG `vscode`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO TỆP NÀY TỒN TẠI (đọc `task-I3-I4-report.md` + `progress.md` trước khi sửa)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * I-3/I-4 bị HUỶ vì `run_command` phía máy chủ (`repoCommandSandbox.ts`) chạy trên checkout của
 * MÁY CHỦ, không phải workspace của kỹ sư. Đợt M xây một đường MỚI: allowlist RIÊNG, thực thi RIÊNG
 * (`mang/chayLenhCucBo.ts`), chạy TRONG tiến trình extension, trên `vscode.workspace.workspaceFolders`
 * của máy lập trình viên. Tệp này KHÔNG được dùng lại `DANH_SACH_TRANG` của server — nó ghim đường
 * `npm-cli.js`/`vitest.mjs` theo cấu trúc CÀI ĐẶT SERVER, hoàn toàn vô nghĩa trên máy khác.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ CHỐNG TIÊM LỆNH BẰNG CẤU TRÚC — KHÔNG PHẢI BẰNG BỘ LỌC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đây là mặt tấn công LỚN NHẤT của cả dự án. Thiết kế bám đúng hai lớp phòng thủ, cả hai đều bắt
 * buộc — thiếu một lớp là mở lại lỗ:
 *
 *   LỚP 1 — `execFile`-shape (thực thi ở `mang/chayLenhCucBo.ts`, KHÔNG PHẢI ở đây): lệnh và MỖI
 *   PHẦN TỬ argv được truyền cho `child_process.spawn` dưới dạng MẢNH TÁCH SẴN, `shell:false`. Một
 *   phần tử argv mang ký tự `;`/`|`/`&&`/backtick/`>`/newline vẫn chỉ là MỘT CHUỖI trong MỘT Ô của
 *   mảng — không có trình thông dịch shell nào đọc lại chuỗi đó để tách lệnh phụ. Đây là hàng rào
 *   THẬT (cấu trúc), không phải bộ lọc — không có "quên chặn một ký tự đặc biệt" nào có thể xảy ra
 *   vì không có bước "diễn giải chuỗi thành nhiều lệnh" nào tồn tại trên đường đi.
 *
 *   LỚP 2 — HÀM DƯỚI ĐÂY: quyết định TRƯỚC KHI spawn, "chuỗi lệnh người dùng gõ này có khớp ĐÚNG
 *   MỘT khuôn argv đã biết không". Không phải "bắt đầu bằng", không phải "không chứa ký tự cấm" —
 *   khớp CHÍNH XÁC khuôn (số token cố định + tối đa MỘT token tham số ở cuối, tham số ấy phải qua
 *   `thamSoAnToan`). `git status; rm -rf /` KHÔNG khớp khuôn `["git","status"]` (5 token thay vì 2)
 *   ⇒ TỪ CHỐI Ở LỚP 2 dù LỚP 1 đã đủ để không có gì phụ được thực thi — phòng thủ CHIỀU SÂU, để một
 *   lỗi tương lai ở LỚP 1 (vd ai đó "tối ưu" bằng cách nối chuỗi rồi `shell:true`) vẫn bị chặn ở đây.
 *
 * ⚠⚠⚠ HỆ QUẢ THIẾT KẾ: hàm nhận diện **CHUỖI LỆNH NGƯỜI DÙNG GÕ TRONG THẺ DUYỆT**, tách nó thành
 *   token BẰNG TAY (`tachToken`, không dùng shell nào), rồi so khớp DANH SÁCH TOKEN đó với khuôn.
 *   Việc tách token này KHÔNG PHẢI là "diễn giải shell" — nó chỉ nhận dấu cách làm ranh giới, không
 *   hiểu `;`/`|`/`&&`/backtick/`$()`/`>` là gì cả. Một chuỗi `git status; rm -rf /` tách thành TOKEN
 *   `["git","status;","rm","-rf","/"]` — `status;` (có dấu `;` dính liền) không khớp token `"status"`
 *   nào trong khuôn ⇒ từ chối. Không có "diễn giải" nào coi `;` là dấu phân cách lệnh ở đây.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BẮT ĐẦU HẸP — CHÍNH XÁC SÁU LỆNH, KHÔNG THAM SỐ TỰ DO NGOÀI MỘT ĐƯỜNG DẪN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `git status` / `git diff` — CHẠY CỐ ĐỊNH `git --no-pager <status|diff> -- .`, KHÔNG chấp nhận
 * BẤT KỲ tham số nào từ người dùng (chặn đúng ca `git diff $(whoami)` của đề bài — không có chỗ nào
 * để nhét `$(...)` vào vì không có tham số tự do nào được đọc từ chuỗi lệnh gốc cả). `npm run check`
 * cũng cố định tuyệt đối. `npx vitest run <path>`/`dotnet build <path>`/`dotnet test <path>` nhận
 * ĐÚNG MỘT tham số ở cuối, phải qua `thamSoAnToan` (không tuyệt đối, không `..`, không ký tự shell).
 */
import { isAbsolute } from "node:path";

/** Nhãn NGUYÊN VĂN của một lệnh trong allowlist — dùng để hiện trên thẻ duyệt (M3) và để lưới đối
 *  chiếu đúng khuôn đang được khai. */
export type TenLenhChoPhep =
  | "git_status"
  | "git_diff"
  | "npm_run_check"
  | "vitest_run"
  | "dotnet_build"
  | "dotnet_test";

export interface LenhDaDuyet {
  ten: TenLenhChoPhep;
  /** argv THẬT sẽ đưa cho `spawn` — mảng, KHÔNG PHẢI chuỗi. Phần tử [0] là tên chương trình. */
  argv: string[];
  /** Nhãn hiển thị cho người dùng trên thẻ duyệt — NGUYÊN VĂN lệnh sắp chạy, ghép lại từ `argv`. */
  hienThi: string;
}

export type KetQuaChoPhepLenh = { ok: true; lenh: LenhDaDuyet } | { ok: false; lyDo: string };

/** Trần độ dài chuỗi lệnh đầu vào — một chuỗi quá dài không thể là một lệnh hợp lệ trong sáu khuôn
 *  hẹp dưới đây; từ chối sớm tránh phải tách token trên một chuỗi rác dài. */
export const TRAN_KY_TU_LENH = 300;

/**
 * ★★★ Tách token BẰNG DẤU CÁCH/TAB THUẦN — KHÔNG diễn giải bất kỳ ký tự shell nào.
 *
 * ⚠ CỐ Ý không hỗ trợ dấu nháy (`"..."`/`'...'`) để gộp nhiều từ thành một token: một cú pháp gộp
 *   token là một cú pháp DIỄN GIẢI, và diễn giải càng nhiều thì càng gần một trình thông dịch shell
 *   thu nhỏ — đúng thứ thiết kế này cố tránh. Tham số hợp lệ duy nhất (một đường dẫn) không cần dấu
 *   nháy trong bất kỳ ca thật nào của sáu lệnh trên; một tham số CẦN dấu nháy (có dấu cách) bị từ
 *   chối ở `thamSoAnToan` (xem dưới) chứ không được "sửa" bằng cách thêm cú pháp gộp.
 */
function tachToken(chuoi: string): string[] {
  return chuoi.split(/[ \t]+/).filter((t) => t.length > 0);
}

/**
 * ★★★ Vị từ AN TOÀN cho MỘT tham số tự do (đường dẫn truyền cho `vitest run`/`dotnet build`/
 * `dotnet test`). Đây là nơi DUY NHẤT trong tệp này chấp nhận một chuỗi KHÔNG cố định trước — mọi
 * luật ở đây từ chối theo hướng AN TOÀN HƠN (fail-closed), không đoán ý.
 *
 * Bị từ chối nếu:
 *   · rỗng, hoặc chứa BẤT KỲ ký tự nào ngoài chữ/số/`.`/`_`/`-`/`/`/`\` (khoá CHẶT — không phải danh
 *     sách đen ký tự cấm, mà là danh sách TRẮNG ký tự cho phép; một ký tự lạ nào cũng bị từ chối,
 *     kể cả ký tự chưa ai nghĩ tới hôm nay — đây là khác biệt giữa "lọc-sau" và "không thể chèn");
 *   · tuyệt đối (`C:\...`, `/...`) — một lệnh test/build phải nhắm vào một đường TRONG workspace,
 *     không phải một đường tuỳ ý trên máy;
 *   · chứa đoạn `..` — chặn thoát khỏi workspace bằng đường tương đối ngược.
 * ⚠ Việc tệp/thư mục đó CÓ TỒN TẠI hay không KHÔNG được kiểm ở đây (module này THUẦN, không
 *   `node:fs`) — đó là việc của `mang/chayLenhCucBo.ts` lúc thực thi thật; `spawn` trên một đường
 *   không tồn tại chỉ đơn giản LỖI, không phải một lỗ an toàn.
 */
export function thamSoAnToan(thamSo: string): boolean {
  if (thamSo.length === 0) return false;
  if (!/^[A-Za-z0-9._/\\-]+$/.test(thamSo)) return false;
  if (isAbsolute(thamSo)) return false;
  if (thamSo.split(/[\\/]+/).includes("..")) return false;
  return true;
}

/** Ghép argv thành một chuỗi hiển thị AN TOÀN cho thẻ duyệt — chỉ nối bằng dấu cách, không có
 *  bước diễn giải nào; đây là NHÃN, không phải thứ đưa lại cho `spawn` (spawn nhận mảng `argv`). */
function hienThiArgv(argv: string[]): string {
  return argv.join(" ");
}

/**
 * ★★★ HÀM DUY NHẤT của M1 — nhận CHUỖI lệnh người dùng gõ (hoặc model đề xuất), trả về ĐÚNG một
 * khuôn `LenhDaDuyet` (argv cố định, sẵn sàng đưa cho `spawn`) hoặc từ chối kèm lý do.
 *
 * ⚠⚠⚠ KHÔNG kiểm bằng `startsWith`/`includes` trên chuỗi gốc — mọi so khớp đi qua DANH SÁCH TOKEN
 *   đã tách, so TỪNG TOKEN một với khuôn kỳ vọng. Đây là lý do `git status; rm -rf /` bị từ chối:
 *   tách token cho `["git","status;","rm","-rf","/"]`, khuôn `git_status` kỳ vọng ĐÚNG HAI token
 *   `["git","status"]` — độ dài đã lệch (5 ≠ 2) VÀ token thứ hai `"status;"` ≠ `"status"` (dấu `;`
 *   dính liền làm hai chuỗi khác nhau ở cấp ký tự) ⇒ từ chối trước khi xét tới bất kỳ điều gì khác.
 */
export function xetDuyetLenh(chuoiLenh: string): KetQuaChoPhepLenh {
  if (typeof chuoiLenh !== "string" || chuoiLenh.length === 0) {
    return { ok: false, lyDo: "lệnh rỗng" };
  }
  if (chuoiLenh.length > TRAN_KY_TU_LENH) {
    return { ok: false, lyDo: `lệnh dài hơn ${TRAN_KY_TU_LENH} ký tự — không khớp bất kỳ khuôn nào` };
  }
  // Newline/CR trong CHUỖI GỐC (trước khi tách token) là dấu hiệu rõ nhất của một cố gắng nhét
  // nhiều "dòng lệnh" vào một ô nhập — `tachToken` chỉ tách theo dấu cách/tab nên một newline sẽ
  // dính vào token liền trước/sau nó (không tách thành lệnh riêng), nhưng từ chối SỚM ở đây vẫn rõ
  // ràng hơn: một newline không bao giờ là một phần hợp lệ của sáu khuôn dưới.
  if (/[\r\n]/.test(chuoiLenh)) {
    return { ok: false, lyDo: "lệnh chứa xuống dòng — không phải một lệnh đơn" };
  }

  const token = tachToken(chuoiLenh);

  // ── git status / git diff — CỐ ĐỊNH TUYỆT ĐỐI, KHÔNG THAM SỐ NÀO TỪ NGƯỜI DÙNG ───────────────
  // ⚠ `-- .` là PHẦN CỦA ARGV CỐ ĐỊNH đưa cho spawn (giới hạn phạm vi vào thư mục hiện tại của
  //   tiến trình con — chính workspace, xem `mang/chayLenhCucBo.ts`), KHÔNG PHẢI một tham số đọc từ
  //   chuỗi người dùng gõ. Người dùng chỉ được gõ ĐÚNG "git status"/"git diff", không hơn — khớp
  //   token PHẢI đúng độ dài 2, nên "git status -- ." (nếu ai đó gõ y hệt argv thật) vẫn bị từ chối
  //   vì đó là 4 token, không phải khuôn ("không thương lượng" nghĩa là không có đường vòng nào để
  //   tự tay thêm tham số, kể cả tham số TRÙNG với cái ta tự thêm).
  if (token.length === 2 && token[0] === "git" && token[1] === "status") {
    return {
      ok: true,
      lenh: { ten: "git_status", argv: ["git", "--no-pager", "status", "--", "."], hienThi: "git status" },
    };
  }
  if (token.length === 2 && token[0] === "git" && token[1] === "diff") {
    return {
      ok: true,
      lenh: { ten: "git_diff", argv: ["git", "--no-pager", "diff", "--", "."], hienThi: "git diff" },
    };
  }

  // ── npm run check — CỐ ĐỊNH TUYỆT ĐỐI ─────────────────────────────────────────────────────────
  if (token.length === 3 && token[0] === "npm" && token[1] === "run" && token[2] === "check") {
    return {
      ok: true,
      lenh: { ten: "npm_run_check", argv: ["npm", "run", "check"], hienThi: "npm run check" },
    };
  }

  // ── npx vitest run <path> — ĐÚNG MỘT tham số cuối, phải qua `thamSoAnToan` ───────────────────
  if (token.length === 4 && token[0] === "npx" && token[1] === "vitest" && token[2] === "run") {
    if (!thamSoAnToan(token[3])) {
      return { ok: false, lyDo: `tham số đường dẫn không an toàn: "${token[3]}"` };
    }
    const argv = ["npx", "vitest", "run", token[3]];
    return { ok: true, lenh: { ten: "vitest_run", argv, hienThi: hienThiArgv(argv) } };
  }

  // ── dotnet build <path> ────────────────────────────────────────────────────────────────────
  if (token.length === 3 && token[0] === "dotnet" && token[1] === "build") {
    if (!thamSoAnToan(token[2])) {
      return { ok: false, lyDo: `tham số đường dẫn không an toàn: "${token[2]}"` };
    }
    const argv = ["dotnet", "build", token[2]];
    return { ok: true, lenh: { ten: "dotnet_build", argv, hienThi: hienThiArgv(argv) } };
  }

  // ── dotnet test <path> ─────────────────────────────────────────────────────────────────────
  if (token.length === 3 && token[0] === "dotnet" && token[1] === "test") {
    if (!thamSoAnToan(token[2])) {
      return { ok: false, lyDo: `tham số đường dẫn không an toàn: "${token[2]}"` };
    }
    const argv = ["dotnet", "test", token[2]];
    return { ok: true, lenh: { ten: "dotnet_test", argv, hienThi: hienThiArgv(argv) } };
  }

  return {
    ok: false,
    lyDo:
      `"${chuoiLenh}" không khớp bất kỳ lệnh nào trong allowlist (git status · git diff · ` +
      `npm run check · npx vitest run <path> · dotnet build <path> · dotnet test <path>)`,
  };
}

/** Trần THỜI GIAN theo TỪNG lệnh — lệnh git/npm-check nhanh, build/test cần rộng hơn. Dùng ở
 *  `mang/chayLenhCucBo.ts` (M2), khai ở đây để một chỗ DUY NHẤT quyết định "lệnh này cho phép chạy
 *  bao lâu" — cùng khuôn với hai trần của `mcpClient.ts` (đo TỪNG lượt gọi riêng). */
export const TRAN_MS_THEO_LENH: Record<TenLenhChoPhep, number> = {
  git_status: 20_000,
  git_diff: 20_000,
  npm_run_check: 240_000,
  vitest_run: 180_000,
  dotnet_build: 240_000,
  dotnet_test: 240_000,
};
