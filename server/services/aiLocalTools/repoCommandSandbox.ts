/**
 * ★★★ doc 78 · PHA B — **CHÍNH SÁCH + BỘ CHẠY LỆNH.** Bề mặt tool nằm ở
 * `writeHandlers/repoCommand.ts`; file này không đăng ký tool nào và không biết gì về HITL.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * QUAN HỆ VỚI PHA A — CỘNG THÊM MỘT TẦNG, KHÔNG DỰNG MỘT HỘP CÁT SONG SONG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `repoSandbox.ts` để lại đúng bốn mặt tiếp xúc cho pha này, và pha này dùng **cả bốn**:
 *   • `gocHopCat()`         — `cwd` của tiến trình con. Không có `cwd` thứ hai ở đâu trong file này.
 *   • `phanQuyetDuongDan()` — THUẦN, chạy **TRƯỚC** khi sinh tiến trình, cho ô tự do của `vitest`.
 *   • `tieuNganSach()` / `nganSachConLai()` — **cùng một sổ byte** với ba read tool của pha A.
 *   • `MA_TU_CHOI_HOP_CAT`  — mã của pha A đi kèm nguyên văn trong chi tiết từ chối.
 * Không một phép kiểm đường dẫn nào được viết lại ở đây.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ DANH SÁCH **TRẮNG** THEO **ARGV**, KHÔNG THEO CHUỖI — VÀ ĐÂY LÀ LÝ DO ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npm run check; rm -rf /` **khớp tiền tố** `npm run check`. Một phép khớp chuỗi (`startsWith`,
 * `includes`, hay một regex neo đầu) do đó là **một danh sách trắng chỉ trên giấy**: nó cho qua một
 * lệnh có phần đuôi tuỳ ý. Vì thế lượt phán quyết đi hai lớp **ĐỘC LẬP**, mỗi lớp một mình đã đủ
 * chặn ca trên — cùng kỷ luật hai lớp mà `repoSandbox` dùng cho `.env*`:
 *
 *   LỚP 1 — `tachArgv()`: **danh sách TRẮNG KÝ TỰ**. Ký tự nào không thuộc tập cho phép ⇒
 *           `CMD_METACHAR`. Nó chặn `;` `&` `|` `` ` `` `$` `>` `<` `(` `)` `\n` `%` `"` `'` … mà
 *           **không phải liệt kê chúng** — danh sách đen ký tự luôn có phần tử thứ N+1 (repo này
 *           đã đếm lớp lỗi ấy 17 lần, xem `toolPermissionQuantifier.test.ts`).
 *   LỚP 2 — `phanQuyetLenh()`: khớp **CẤU TRÚC** trên argv đã tách — đúng **số phần tử** và đúng
 *           **từng phần tử**. `["npm","run","check;","rm","-rf","/"]` sai cả arity lẫn phần tử ⇒
 *           `CMD_NOT_ALLOWED`. Lớp này KHÔNG BAO GIỜ nhìn vào chuỗi gốc.
 *
 * ⚠ Hai lớp được tách thành **hai hàm xuất riêng** có chủ đích: một lưới chỉ gọi được hàm ngoài sẽ
 * không bao giờ chứng minh được lớp 2 tự nó chặn được gì (lớp 1 đã nuốt mọi đầu vào bẩn). Tách ra
 * thì đột biến trên từng lớp mới **đỏ được một mình** — xem `repoCommand.census.test.ts` §B/§C.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ `git checkout`, `git reset`, `rm`, `DROP` **KHÔNG BAO GIỜ** VÀO DANH SÁCH TRẮNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * doc 78 §3 mục 1, và nó **đã xảy ra thật** ngày 2026-08-18: một tác nhân chạy `git checkout <file>`
 * để hoàn nguyên một đột biến 1 dòng và **xoá mất 123 dòng chưa commit**. Bằng chứng nằm ngay trong
 * đầu ra của chính nó (`git diff --stat` báo **124 insertions** cho một sửa đổi 1 dòng) và nó đọc
 * lướt qua. ⇒ Không lệnh nào **HOÀN NGUYÊN/XOÁ** mã được vào bảng dưới đây; hai lệnh `git` đều là
 * lệnh hỏi.
 *
 * ⚠⚠⚠ **ĐÍNH CHÍNH 2026-08-20 — CÂU CŨ Ở ĐÂY ĐÃ SAI, VÀ NÓ SAI TỪ 2026-08-19.**
 * Bản trước viết *"danh sách trắng chỉ có lệnh ĐỌC hoặc KIỂM TRA; không lệnh nào ghi vào cây làm
 * việc"*. Đó là sự thật của **năm** mục đầu. Mục thứ **tám** — `dotnet format <đường>` — **GHI ĐÈ
 * mọi tệp `.cs`** dưới cây được trỏ, và nó vào bảng cùng lượt doc 79 (D) mà câu trên **không được
 * sửa theo**. Một bất biến sống trong văn xuôi là một bất biến sẽ mục mà không ai đỏ.
 * ⇒ Nay nó là **DỮ LIỆU**: ô `ghiDia` dưới, khai cho **cả chín** mục, và `repoCommand.census.test.ts
 *   §A` ghim dân số **đúng 1/9**. Đổi con số ấy ⇒ ĐỎ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ `npm run build` **CỐ Ý KHÔNG** CÓ TRONG DANH SÁCH TRẮNG Ở LƯỢT ĐẦU — BA LÝ DO ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * doc 78 §4/PHA B có liệt kê nó. Đây là chỗ tôi **đi chệch bản kế hoạch**, và nói rõ vì sao:
 *   1. **Nó phá đúng cái đồng hồ dùng để nhận diện tiến trình cổng 3000.** Máy này có lúc **bảy**
 *      instance `node.exe` chồng nhau, và cách duy nhất đang dùng để biết cái nào đang phục vụ là
 *      so **giờ khởi động tiến trình** với **giờ build `dist/index.js`**. `npm run build` ghi đè
 *      `dist/index.js` ⇒ dấu vết ấy biến mất. Một lệnh phá **phương tiện chẩn đoán** thì phải do
 *      con người gõ, không phải do một tác nhân đề xuất.
 *   2. Nó là lệnh DUY NHẤT trong danh sách đề xuất có **tác dụng phụ ghi ra đĩa** — mà pha B được
 *      chốt là *"chạy lệnh"*, còn *"ghi tệp"* là pha C và pha C có hàng rào riêng ("tệp bẩn thì từ
 *      chối"). Cho `npm run build` vào pha B là **lách hàng rào của pha C bằng một lệnh**.
 *      ⚠⚠ **ĐÍNH CHÍNH 2026-08-20**: lý lẽ này ĐÚNG và vẫn ĐÚNG — nhưng **chính nó đã bị vi phạm ở
 *      lượt sau**. `dotnet format` (doc 79 D) làm **đúng cái việc** mục 2 vừa cấm: nó ghi tệp qua
 *      cửa pha B, tức lách cả bốn hàng rào của pha C. Nó ở lại danh sách trắng (hữu ích thật cho dự
 *      án C#), nhưng từ nay phải **khai `ghiDia: true`** và **nói ra trên thẻ duyệt**. Bài học ghi
 *      lại đúng chỗ nó bị bỏ qua: một lý lẽ viết ra không tự cưỡng chế lượt mở rộng tiếp theo.
 *   3. ~2 phút/lượt: dài hơn mọi hạn giờ hợp lý của một vòng lặp tác nhân, và `dist/` nằm trong
 *      `DOAN_THU_MUC_CAM` của pha A nên tác nhân **không đọc lại được thứ nó vừa tạo** — giá trị
 *      phản hồi bằng không.
 * ⇒ Thêm nó sau, nếu có nhu cầu thật, là **một dòng** trong bảng dưới. Bỏ ra thì khó hơn nhiều.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ KHÔNG MẠNG — **BẰNG CẤU TẠO CỦA DANH SÁCH TRẮNG, KHÔNG BẰNG MỘT HỘP CÁT MẠNG**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Node không cắt được socket của tiến trình con, và tôi **không** dựng một lớp giả vờ làm việc đó.
 * Cái có thật: (a) không lệnh nào trong bảng đi ra mạng — `npm run <script>` KHÔNG cài gì,
 * `vitest` được phân giải về **tệp cục bộ** nên `npx` không bao giờ tải về, `git status`/`git diff`
 * là lệnh cục bộ; (b) môi trường con được đặt `npm_config_offline=true` + tắt audit/fund/notifier
 * nên chính `npm` cũng không tự gọi ra ngoài. Đó là **giảm thiểu theo cấu tạo**, và tôi khai đúng
 * mức ấy chứ không khai là một hộp cát.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BIẾN MÔI TRƯỜNG: **LỌC**, VÀ NẾU KHÔNG LỌC THÌ CẢ PHA A LÀ VÔ NGHĨA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tiến trình con thừa kế `process.env` theo mặc định — tức thừa kế cả `.env` mà máy chủ đã nạp:
 * khoá CSDL, `MASTER_API_KEY`, `ANH_KY_SECRET`. Và **stdout của tiến trình con đi thẳng vào cửa sổ
 * chat**. Pha A bỏ công dựng ba lớp để `.env` không bao giờ ra khỏi hộp cát; nếu pha B trao đúng
 * những bí mật ấy cho một tiến trình con mà **model chọn tệp cho nó chạy** (`npx vitest run <đường>`
 * — ô TỰ DO), thì bảo đảm của pha A **hết hiệu lực trong một lượt**: một tệp test in
 * `process.env` ra là xong.
 * ⇒ Môi trường con dựng từ **danh sách TRẮNG TÊN BIẾN** (`BIEN_MOI_TRUONG_CHO_PHEP`) — hệ điều
 *   hành + chuỗi công cụ, không một biến ứng dụng nào.
 * ⚠ **GIÁ PHẢI TRẢ, KHAI THẲNG**: `npx vitest run` trên một ca cần CSDL sẽ **HỎNG** vì không có
 *   `DATABASE_URL`. Đó là chiều hỏng ĐÚNG — một ca hỏng thì kêu to, một bí mật rò thì im lặng. Ai
 *   cần chạy ca CSDL thì gõ tay ở terminal, nơi họ đã có sẵn mọi biến.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ HẠN GIỜ PHẢI GIẾT **CẢ CÂY**, KHÔNG CHỈ TIẾN TRÌNH CHA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npm run check` là `node npm-cli.js` → `cmd.exe` → `cross-env` → `tsc`: **cháu và chắt**.
 * `child.kill()` trên Windows gọi `TerminateProcess` **đúng một PID** — cháu sống tiếp, giữ nguyên
 * pipe stdout, và lượt chạy treo vĩnh viễn trong khi tool đã "hết giờ". Vì thế:
 *   • Windows — `taskkill /PID <pid> /T /F` (`/T` = cả cây con).
 *   • POSIX   — `detached: true` lúc sinh ⇒ tiến trình con là **thủ lĩnh nhóm** ⇒
 *               `process.kill(-pid)` giết cả nhóm.
 * ⚠ Và sau khi ra lệnh giết, hàm **chờ `exit` thật** (có ân hạn) chứ không tự khai là đã chết —
 * *"`kill(pid,0)` KHÔNG phải quan sát cái chết"* (VRAM Pha 3, `giết nhầm rồi báo cáo thành công`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * KHÔNG `shell: true`, KHÔNG CHUỖI LỆNH — VÀ MỘT ĐÍNH CHÍNH TRUNG THỰC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mọi lượt `spawn` ở đây truyền **argv rời** với `shell: false`. Đính chính phải nói ra: `npm` tự
 * chạy nội dung `scripts.check` **qua `cmd.exe`** — đó là cơ chế của npm, không phải của file này.
 * Điều quan trọng là **chuỗi ấy đến từ `package.json`, không từ model**: model chỉ chọn được *tên
 * script*, và chỉ trong hai tên đã khai ở bảng. Không có đường nào cho một byte do model viết đi
 * vào một trình thông dịch dòng lệnh.
 *
 * ⚠ File này **KHÔNG chạm đĩa theo byte** — nó chỉ hỏi sự tồn tại (`existsSync`) để phân giải
 * `npm-cli.js`/`vitest.mjs`. `programmingFileIo.census.test.ts` cố ý không tính `existsSync` là
 * điểm chạm byte ("phép hỏi/dựng khung"), nên bất biến "mọi byte qua ĐÚNG HAI hàm cửa" vẫn nguyên.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { redactSecretsOnly } from "../ai/aiSafety";
import { MA_TU_CHOI_HOP_CAT, gocHopCat, phanQuyetDuongDan } from "./repoSandbox";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ MÁY-ĐỌC-ĐƯỢC — **0 dòng im lặng là nói dối**
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Mỗi mã tương ứng **một hành động khác nhau của người vận hành**, đúng luật đã dùng ở pha A và ở
 * `_uyQuyenAnh.ts`:
 *   • `CMD_METACHAR`          — có ký tự ngoài tập cho phép ⇒ **gõ lại lệnh cho sạch** (và nếu định
 *                               nối hai lệnh thì câu trả lời là KHÔNG, gọi tool hai lần).
 *   • `CMD_NOT_ALLOWED`       — cấu trúc argv không khớp mục nào ⇒ **không có đường sửa lệnh này**;
 *                               đây là danh sách TRẮNG, và nó không nới ra lúc chạy.
 *   • `CMD_ARG_PATH_REJECTED` — ô TỰ DO của `vitest` bị hộp cát pha A từ chối ⇒ **sửa đường dẫn**.
 *   • `CMD_RESOLVE_ERROR`     — không tìm thấy `npm-cli.js`/`vitest.mjs` ⇒ **hỏng cài đặt**, không
 *                               phải người dùng sai. Phân biệt với `CMD_NOT_ALLOWED` là bắt buộc:
 *                               gộp chúng là bắt người ta đi sửa một lệnh vốn hợp lệ.
 *   • `CMD_SPAWN_ERROR`       — `spawn` hỏng (ENOENT/EACCES) ⇒ hỏng môi trường.
 *   • `CMD_TIMEOUT`           — quá hạn, cây tiến trình đã bị giết, đầu ra là **BẢN CẮT**.
 */
export const MA_TU_CHOI_LENH = {
  CMD_METACHAR: "CMD_METACHAR",
  CMD_NOT_ALLOWED: "CMD_NOT_ALLOWED",
  CMD_ARG_PATH_REJECTED: "CMD_ARG_PATH_REJECTED",
  CMD_RESOLVE_ERROR: "CMD_RESOLVE_ERROR",
  CMD_SPAWN_ERROR: "CMD_SPAWN_ERROR",
  CMD_TIMEOUT: "CMD_TIMEOUT",
  /**
   * ★★★ 2026-08-23 — BẮT ĐƯỢC Ở NGHIỆM THU LIVE, KHÔNG LƯỚI NÀO PHÁT BIỂU.
   * Gốc được trỏ KHÔNG có `package.json`, mà lệnh này là lệnh của **hệ sinh thái Node**.
   * `npm`/`npx` **đi NGƯỢC lên cây thư mục** để tìm `package.json` gần nhất — hộp cát giam đúng
   * `cwd`, nhưng npm tự thoát ra. Đo thật: `npm prefix` chạy trong `sandbox-projects/csharp-demo`
   * trả về `D:\SOURCES\avi-aoi-management`. Hệ quả **đã xảy ra**: người dùng hỏi *"chạy test của dự
   * án này"* trong dự án C#, tác nhân chạy `npm run check:tests` và bê về **lỗi TypeScript của REPO
   * CHÍNH** — thẻ duyệt khai *"Thư mục chạy: …csharp-demo"*, đúng chữ mà sai nghĩa.
   * ⇒ Đây KHÔNG phải lỗ thực thi (danh sách trắng vẫn khớp chính xác, không chạy được script tuỳ
   *   ý), mà là **một lời nói dối về việc lệnh tác động lên cái gì** — và người ta ra quyết định
   *   dựa trên nó. Từ chối, nói rõ, để tác nhân chuyển sang lệnh ĐÚNG của dự án (`dotnet test`).
   */
  CMD_GOC_THIEU_PACKAGE_JSON: "CMD_GOC_THIEU_PACKAGE_JSON",
} as const;

export type MaTuChoiLenh = (typeof MA_TU_CHOI_LENH)[keyof typeof MA_TU_CHOI_LENH];

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TRẦN
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Độ dài tối đa của chuỗi lệnh người/model gõ vào. */
export const TRAN_KY_TU_LENH = 300;
/** Số phần tử argv tối đa — một cái trần thứ hai, rẻ, chặn đầu vào bệnh lý trước cả phép khớp. */
export const TRAN_PHAN_TU_ARGV = 8;
/**
 * Hạn giờ TRẦN cho **mọi** mục. Người gọi hạ xuống được, KHÔNG nâng lên được: `hanGioThucTe()` kẹp
 * hai đầu, nên một `timeoutMs` do model đưa chỉ có thể làm lượt chạy **ngắn hơn**.
 */
export const HAN_GIO_TOI_DA_MS = 300_000;
/** Hạn giờ SÀN — dưới mức này thì mọi lệnh đều chết vì chưa kịp khởi động, tức một cái trần giả. */
export const HAN_GIO_TOI_THIEU_MS = 1_000;
/**
 * Ân hạn sau khi ra lệnh giết cây: chờ `exit` THẬT. Hết ân hạn mà chưa `exit` thì vẫn trả về,
 * **và khai ra** — thà nói "đã ra lệnh giết, chưa quan sát được cái chết" còn hơn treo cả cổng.
 */
export const AN_HAN_SAU_GIET_MS = 5_000;
/** Cửa sổ vét nốt stdout sau khi tiến trình con đã `exit` nhưng pipe chưa đóng (cháu giữ pipe). */
export const CUA_SO_VET_DAU_RA_MS = 500;
/** Trần đầu ra ĐEM RA khỏi hộp cát: 8 KiB đầu + 24 KiB cuối. */
export const TRAN_DAU_RA_DAU = 8_192;
export const TRAN_DAU_RA_CUOI = 24_576;

/**
 * ★ Vì sao giữ **CẢ ĐẦU LẪN CUỐI** thay vì cắt phẳng ở 32 KiB: `tsc` in lỗi rồi in dòng tổng kết,
 * `vitest` in thất bại rồi in bảng tóm tắt. Cắt phẳng ở đầu ⇒ mất đúng dòng *"Found N errors"*;
 * cắt phẳng ở cuối ⇒ mất lỗi đầu tiên, thường là lỗi gốc. Phần bị bỏ giữa **được khai bằng số byte**
 * — một danh sách bị cắt mà không khai là một lời nói dối (cùng luật với `duyetTepDocDuoc` pha A).
 */
export const TRAN_DAU_RA = TRAN_DAU_RA_DAU + TRAN_DAU_RA_CUOI;

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LỚP 1 — TÁCH ARGV BẰNG DANH SÁCH **TRẮNG KÝ TỰ**
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★ Tập ký tự cho phép, viết **dương** (cái được phép), không viết âm (cái bị cấm).
 *
 * Đủ cho toàn bộ bảng trắng: chữ/số · khoảng trắng (dấu tách argv) · `_` `.` `/` `\` `:` `-` `@`.
 *   • `:` — bắt buộc cho `check:tests`.
 *   • `/` và `\` — đường dẫn tương đối. `\` an toàn ở đây vì **không có trình thông dịch nào** trên
 *     đường đi (không `shell`), và `phanQuyetDuongDan()` của pha A tự chuẩn hoá `\` → `/` rồi soi
 *     **TỪNG ĐOẠN** (nên `server\..\..\etc` bị chặn ở đó, không phải ở đây).
 *   • `@` — tên gói có phạm vi (`@scope/pkg`), để bảng trắng nới được mà không phải sửa lớp này.
 * Cố ý VẮNG: `;` `&` `|` `` ` `` `$` `<` `>` `(` `)` `{` `}` `[` `]` `*` `?` `!` `~` `^` `%` `"`
 * `'` `#` `=` `,` `+` và **mọi** khoảng trắng không phải dấu cách (`\t` `\n` `\r`). Không cái nào
 * được liệt kê ở đâu — chúng bị chặn vì **không nằm trong tập trên**, nên ký tự thứ N+1 (một dạng
 * unicode lạ, một dấu tách mới của shell nào đó) cũng bị chặn theo, miễn phí.
 */
const KY_TU_CHO_PHEP = /^[A-Za-z0-9 _./\\:@-]+$/;

export type KetQuaTachArgv =
  | { ok: true; argv: string[] }
  | { ok: false; ma: MaTuChoiLenh; chiTiet: string };

/**
 * Tách chuỗi lệnh thành argv. **Không** hiểu dấu nháy, **không** hiểu thoát ký tự, **không** hiểu
 * biến — cố ý: mọi cơ chế ấy là một trình thông dịch nhỏ, và một trình thông dịch nhỏ là chỗ lỗ
 * chui vào. Ở đây "tách" đúng nghĩa đen: cắt theo dấu cách.
 */
export function tachArgv(lenh: unknown): KetQuaTachArgv {
  if (typeof lenh !== "string") {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_METACHAR, chiTiet: "lệnh không phải chuỗi" };
  }
  const raw = lenh.trim();
  if (raw === "") {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_METACHAR, chiTiet: "lệnh rỗng" };
  }
  if (raw.length > TRAN_KY_TU_LENH) {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_METACHAR, chiTiet: `lệnh dài ${raw.length} ký tự, trần ${TRAN_KY_TU_LENH}` };
  }
  if (!KY_TU_CHO_PHEP.test(raw)) {
    // Nêu ĐÍCH DANH ký tự đầu tiên phạm luật — người đọc phải sửa được mà không phải đoán.
    const xau = [...raw].find((c) => !KY_TU_CHO_PHEP.test(c)) ?? "?";
    const ma = xau.codePointAt(0) ?? 0;
    return {
      ok: false,
      ma: MA_TU_CHOI_LENH.CMD_METACHAR,
      chiTiet: `ký tự ${JSON.stringify(xau)} (U+${ma.toString(16).toUpperCase().padStart(4, "0")})`,
    };
  }
  const argv = raw.split(" ").filter((s) => s !== "");
  if (argv.length === 0) {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_METACHAR, chiTiet: "lệnh rỗng" };
  }
  if (argv.length > TRAN_PHAN_TU_ARGV) {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_NOT_ALLOWED, chiTiet: `${argv.length} phần tử argv, trần ${TRAN_PHAN_TU_ARGV}` };
  }
  return { ok: true, argv };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÂN GIẢI TỆP CHẠY — KHÔNG QUA `npm.cmd`/`npx.cmd`, KHÔNG QUA SHELL
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ Trên Windows `npm`/`npx` là **`.cmd`**. Từ Node 20 (CVE-2024-27980) `spawn()` **từ chối** chạy
 * `.cmd`/`.bat` khi không có `shell: true` — nên "spawn npm" và "không dùng shell" là hai yêu cầu
 * loại trừ nhau **nếu** đi qua cái tên `npm`. Lối ra không phải bật shell: đi thẳng vào
 * `node <npm-cli.js> run <script>` — cùng một chương trình, argv rời, không trình thông dịch nào.
 */
function duongDanNpmCli(): string | null {
  const d = path.dirname(process.execPath);
  const ung = [
    // Windows: <nodejs>/node_modules/npm/bin/npm-cli.js
    path.join(d, "node_modules", "npm", "bin", "npm-cli.js"),
    // POSIX: <prefix>/bin/node ⇒ <prefix>/lib/node_modules/npm/bin/npm-cli.js
    path.join(d, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  for (const p of ung) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * `vitest` phân giải về **tệp cục bộ trong repo**, không qua `npx`. Hai hệ quả, cả hai đều là điểm:
 * `npx` không bao giờ có cơ hội **tải gói về từ mạng**, và phiên bản chạy đúng bằng phiên bản repo
 * đã ghim.
 */
function duongDanVitest(goc: string): string | null {
  const p = path.join(goc, "node_modules", "vitest", "vitest.mjs");
  return existsSync(p) ? p : null;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// LỚP 2 — DANH SÁCH **TRẮNG** KHỚP THEO **CẤU TRÚC ARGV**
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface LenhDaPhanGiai {
  /** Tệp chạy THẬT (tuyệt đối, hoặc một tên để hệ điều hành tra PATH — chỉ `git`). */
  readonly file: string;
  readonly args: readonly string[];
}

export interface MucDanhSachTrang {
  /** Dạng chính tắc để hiển thị cho người duyệt. `<…>` đánh dấu ô TỰ DO. */
  readonly nhan: string;
  /**
   * Khuôn argv. Phần tử `null` là **ô TỰ DO** (nhiều nhất một ô, và mọi ô tự do đều có bộ phán
   * quyết riêng). Khớp = **cùng độ dài** VÀ **từng phần tử bằng nhau**.
   */
  readonly khuon: readonly (string | null)[];
  /** Hạn giờ mặc định của mục — cũng là **trần** cho mục ấy. */
  readonly hanGioMs: number;
  /** Một câu cho người duyệt biết lệnh này LÀM GÌ. */
  readonly moTa: string;
  /**
   * ★★★ 2026-08-20 — **LỆNH NÀY CÓ GHI ĐÈ TỆP MÃ NGUỒN KHÔNG.**
   * `true` ⇔ lệnh sửa THẲNG các tệp mã nguồn **do người viết**, nằm dưới cây làm việc của gốc được
   * trỏ. Hôm nay đúng **một** mục: `dotnet format <đường>` (ghi đè mọi `.cs` theo `.editorconfig`).
   *
   * ⚠⚠⚠ VÌ SAO Ô NÀY PHẢI TỒN TẠI, THAY VÌ MỘT CÂU TRONG DOCBLOCK
   * Một mục `ghiDia` đi vòng **CẢ BỐN** hàng rào mà `apply_diff` (pha C) dựng cho đường ghi tệp:
   *   (a) KHÔNG hỏi `git status` ⇒ tệp có thay đổi chưa commit vẫn bị đè;
   *   (b) KHÔNG so băm ⇒ không có phòng vệ TOCTOU giữa lúc đề xuất và lúc chạy;
   *   (c) KHÔNG có diff để người duyệt xem trước ⇒ họ bấm duyệt một thay đổi **chưa nhìn thấy**;
   *   (d) KHÔNG qua hộp cát TỪNG TỆP — ô tự do là một **THƯ MỤC**, và mọi `.cs` bên dưới bị ghi.
   * Và nó đứng sau bit `ai_repo_exec/canCreate`, **không** phải `ai_repo_read/canEdit` ⇒ thu hồi
   * quyền GHI của AI mà vẫn để quyền CHẠY thì AI **vẫn ghi đè được mã nguồn**. Sự thật ấy trước
   * lượt này chỉ sống trong văn xuôi, và **văn xuôi đã sai ở bảy chỗ**.
   * ⇒ Là dữ liệu thì đo được: census ghim dân số, thẻ duyệt đọc được, cổng (D) tra được.
   *
   * ⚠ Ô này **KHÔNG** phát biểu *"lệnh có tạo byte nào trên đĩa không"* — xem `sinhSanPhamDung`.
   */
  readonly ghiDia: boolean;
  /**
   * ★★★ **LỆNH NÀY CÓ ĐI NGƯỢC LÊN CÂY THƯ MỤC ĐỂ TÌM DỰ ÁN KHÔNG.**
   * `true` ⇔ lệnh thuộc hệ sinh thái Node (`npm`/`npx`), tức nó **tự tìm `package.json` gần nhất
   * TÍNH TỪ `cwd` TRỞ LÊN**. Hộp cát đặt đúng `cwd`, nhưng npm không dừng ở đó.
   * ⇒ Khi gốc được trỏ KHÔNG có `package.json`, lệnh vẫn CHẠY — chỉ là nó chạy trên **một dự án
   *   khác** với dự án người duyệt tưởng. Xem `CMD_GOC_THIEU_PACKAGE_JSON` để biết chuyện đã xảy ra.
   *
   * ⚠ Vì sao là DỮ LIỆU chứ không phải một phép `if` chôn trong `phanQuyetLenh`: mọi mục thêm vào
   *   bảng sau này đều bị census bắt khai ô này, nên câu hỏi *"lệnh của bạn có thoát cwd không?"*
   *   được hỏi **một lần cho mỗi mục**, thay vì phụ thuộc vào việc ai đó nhớ ra.
   */
  readonly thoatCwdTheoCayThuMuc: boolean;
  /**
   * **LỆNH NÀY CÓ SINH/CẬP NHẬT SẢN PHẨM DỰNG KHÔNG** (`bin/`, `obj/`, `tsbuildinfo`…).
   * `true` ⇔ có byte rơi xuống đĩa, nhưng là byte **SINH RA**, không phải mã nguồn do người viết.
   *
   * ⚠⚠ VÌ SAO **HAI Ô** CHỨ KHÔNG GỘP LÀM MỘT: gộp lại thì `dotnet build` (sinh `obj/`, không ai
   * mất gì) và `dotnet format` (viết đè `Program.cs` **của bạn**) mang **cùng một nhãn** — và nhãn
   * chung ấy chỉ có hai kết cục, cả hai đều sai: hoặc nó kêu oan cho `build` (người ta học cách bỏ
   * qua cảnh báo), hoặc nó bào chữa cho `format` (*"thì lệnh nào chả ghi đĩa"*) — đúng cái lỗ đang
   * vá. Hai hậu quả NGƯỢC nhau ⇒ phải là hai ô.
   * ⚠ Khai theo ĐO, không theo trực giác: `npm run check`/`check:tests` **CÓ** ghi tệp —
   *   `tsconfig.json` đặt `"incremental": true` + `tsBuildInfoFile:
   *   ./node_modules/typescript/tsbuildinfo` (đã kiểm: cả `tsbuildinfo` lẫn `tsbuildinfo.tests` tồn
   *   tại trên máy này). Khai `false` cho chúng là nói dối một cách tiện lợi.
   * ⇒ `sinhSanPhamDung` đúng **5/9**; `ghiDia` đúng **1/9**. Hai con số KHÁC nhau là điểm.
   *
   * ⚠⚠ TRỤC THỨ BA, KHAI THẲNG LÀ **KHÔNG** ĐƯỢC HAI Ô NÀY PHỦ: *"lệnh có THI HÀNH mã của repo
   * không"*. `npx vitest run` · `node --test` · `dotnet test` · `dotnet build` (MSBuild target,
   * analyzer) đều chạy mã do repo cung cấp, và mã ấy có thể ghi bất cứ đâu nó muốn. Đó là hồ sơ rủi
   * ro ĐÃ ĐƯỢC nhận và đã được trả lời bằng thứ khác (hộp cát đường dẫn + môi trường ĐÃ LỌC + hạn
   * giờ giết cây + HITL), không phải bằng hai ô này. Ghi ra để không ai đọc `ghiDia:false` thành
   * *"lệnh này không thể chạm tệp nào"*.
   */
  readonly sinhSanPhamDung: boolean;
  /** Phán quyết ô TỰ DO. Bắt buộc có khi `khuon` chứa `null`; `null` ⇔ được phép. */
  readonly phanQuyetOTuDo?: (v: string) => { ma: MaTuChoiLenh; chiTiet: string } | null;
  /** Dựng argv THẬT. `null` ⇔ không phân giải được (thiếu `npm-cli.js`/`vitest.mjs`). */
  readonly phanGiai: (oTuDo: string | null, goc: string) => LenhDaPhanGiai | null;
}

/** Tên biến môi trường của công tắc restore — xem `dotnetChoPhepRestore`. */
export const BIEN_DOTNET_CHO_PHEP_RESTORE = "DOTNET_CHO_PHEP_RESTORE";

/**
 * ★★★ 2026-08-24 — CÔNG TẮC RESTORE THEO TRIỂN KHAI (quyết định chủ dự án, cùng khuôn
 * `AUTH_2FA_BAT_BUOC` ở `server/_core/trpc.ts`): *"bản chất đối với các bên sử dụng hệ sinh thái
 * có internet thì vẫn phải kéo về bình thường được"*.
 *
 * Hai kiểu triển khai, hai chế độ:
 *   • VẮNG biến / mọi giá trị khác `"1"` (mặc định trong MÃ — an toàn cho máy OFFLINE):
 *     `dotnet build`/`dotnet test` chạy `--no-restore`. Trên máy không mạng, một lượt restore chỉ
 *     đổi lỗi rõ ("cần restore trước ở terminal") lấy lỗi khó hiểu hơn (NuGet timeout/DNS sau vài
 *     phút treo) — người dùng tự tải package và chép vào local feed rồi `dotnet restore` tay.
 *   • `"1"` (triển khai CÓ INTERNET): bỏ `--no-restore` khỏi argv phân giải — restore NGẦM của
 *     `dotnet build`/`dotnet test` kéo NuGet về bình thường, đúng chữ chủ dự án.
 *
 * ⚠ CHỈ chuỗi `"1"` bật — không `"true"`, không "khác rỗng": đổi mặc định là đổi tư thế mạng của
 *   mọi bản cài chưa khai biến (lưới A/B ghim cả ba chiều: vắng · `"1"` · giá trị lạ).
 * ⚠ Đọc TẠI THỜI ĐIỂM GỌI, không nhớ đệm ở tầng module — bài học `TENANT_RLS_ENABLED`: lưới đặt
 *   env trong ca phải lật được cờ mà không nạp lại module; `moTa` (getter) và `phanGiai` của hai
 *   mục dotnet cùng đọc qua hàm này nên lời khai trên thẻ duyệt KHÔNG lệch được argv thật.
 * ⚠ Cờ này KHÔNG chạm phần còn lại của "không mạng bằng cấu tạo": `npm_config_offline`, telemetry
 *   dotnet, môi trường ĐÃ LỌC giữ nguyên — nó chỉ mở đúng MỘT đường đã khai: restore NuGet.
 */
export function dotnetChoPhepRestore(): boolean {
  return process.env[BIEN_DOTNET_CHO_PHEP_RESTORE] === "1";
}

/**
 * ★★★ DANH SÁCH TRẮNG — **CHÍN MỤC: TÁM CHỈ HỎI/KIỂM TRA, MỘT GHI ĐÈ MÃ NGUỒN.**
 *
 * Mục thứ chín ấy là **`dotnet format <đường>`** (`ghiDia: true`). Đừng đọc bảng này là *"toàn lệnh
 * đọc"* — đó đúng là câu docblock cũ đã khai, và nó SAI từ 2026-08-19 (xem khối ĐÍNH CHÍNH đầu
 * file). Mỗi mục **BẮT BUỘC** khai `ghiDia` + `sinhSanPhamDung`; census ghim dân số cả hai.
 *
 * ⚠ Đây là **toàn bộ** tập lệnh tác nhân chạy được, và nó là một hằng của mã nguồn: không cờ môi
 * trường nào nới nó, không tham số nào thêm mục vào nó. Muốn thêm thì phải sửa file này, tức phải
 * đọc khối "git checkout / npm run build" ở đầu file một lần.
 */
export const DANH_SACH_TRANG: readonly MucDanhSachTrang[] = [
  {
    nhan: "npm run check",
    khuon: ["npm", "run", "check"],
    hanGioMs: 240_000,
    moTa: "Kiểm kiểu toàn bộ mã sản phẩm (tsc --noEmit, heap 8 GB qua cross-env). KHÔNG sinh mã, chỉ cập nhật bộ nhớ đệm tsbuildinfo trong node_modules.",
    thoatCwdTheoCayThuMuc: true,
    ghiDia: false,
    // `--noEmit`, nhưng `"incremental": true` ⇒ ghi `node_modules/typescript/tsbuildinfo`.
    sinhSanPhamDung: true,
    phanGiai: () => {
      const cli = duongDanNpmCli();
      return cli === null ? null : { file: process.execPath, args: [cli, "run", "check"] };
    },
  },
  {
    nhan: "npm run check:tests",
    khuon: ["npm", "run", "check:tests"],
    hanGioMs: 240_000,
    moTa: "Kiểm kiểu bộ lưới (tsconfig.tests.json). KHÔNG sinh mã, chỉ cập nhật tsbuildinfo.tests trong node_modules.",
    thoatCwdTheoCayThuMuc: true,
    ghiDia: false,
    sinhSanPhamDung: true,
    phanGiai: () => {
      const cli = duongDanNpmCli();
      return cli === null ? null : { file: process.execPath, args: [cli, "run", "check:tests"] };
    },
  },
  {
    nhan: "npx vitest run <đường-dẫn>",
    khuon: ["npx", "vitest", "run", null],
    hanGioMs: 180_000,
    moTa: "Chạy lưới cho MỘT đường dẫn (bộ lọc theo tên tệp). Đường dẫn BẮT BUỘC — bỏ trống là chạy cả 12.777 ca.",
    thoatCwdTheoCayThuMuc: true,
    ghiDia: false,
    sinhSanPhamDung: false,
    /**
     * ★★★ BẪY SỐ HAI CỦA PHA NÀY: **ô này là đối số TỰ DO DUY NHẤT trong cả danh sách trắng**, nên
     * nó là chỗ duy nhất một byte do model viết đi vào argv của một tiến trình. Nếu nó không qua
     * `phanQuyetDuongDan()` thì **danh sách trắng có một lỗ hộp cát nằm ngay bên trong nó**.
     * ⚠ Dùng `phanQuyetDuongDan` (hình dạng + thư mục cấm + tệp bí mật) mà **KHÔNG** đòi
     * `duoiDuocPhep`: `vitest run server/services/aiLocalTools` (một THƯ MỤC) là cách gọi hợp lệ và
     * thường dùng nhất. Đòi đuôi ở đây là vá quá tay — nó giết đúng cách dùng chính.
     * ⚠ Và **KHÔNG** đòi tệp phải TỒN TẠI: `vitest` coi đối số là **bộ lọc theo tên**, không phải
     * một đường dẫn phải mở được. Đòi tồn tại là phát biểu sai về thứ mình đang canh.
     */
    phanQuyetOTuDo: (v) => {
      const ma = phanQuyetDuongDan(v);
      return ma === null ? null : { ma: MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED, chiTiet: `${v} (hộp cát pha A: ${ma})` };
    },
    phanGiai: (oTuDo, goc) => {
      if (oTuDo === null) return null;
      const vit = duongDanVitest(goc);
      return vit === null ? null : { file: process.execPath, args: [vit, "run", oTuDo] };
    },
  },
  /**
   * ★★★ 2026-08-23 — **`-- .` KHÔNG PHẢI THẨM MỸ: NÓ ĐÓNG MỘT LỖ RÒ QUA RANH GIỚI DỰ ÁN.**
   * `git` cũng đi NGƯỢC lên cây thư mục để tìm `.git` — cùng họ với npm, nhưng hậu quả KHÁC: npm
   * chạy sai dự án, còn `git status` **báo cáo đúng repo mẹ**. Với hộp cát ĐA DỰ ÁN, dự án con nằm
   * trong cây làm việc của repo mẹ ⇒ một lượt `git status` "trong dự án csharp" trả về **171 dòng
   * đường dẫn của repo chính** (đo 2026-08-23), tức tên tệp và cấu trúc của một dự án mà phiên ấy
   * KHÔNG được phép nhìn. `-- .` giới hạn vào cây con của `cwd`: cùng lượt ấy trả về **0 dòng**.
   * ⚠ Với dự án `repo` (gốc = chính repo chính) thì `.` = toàn bộ repo ⇒ hành vi KHÔNG đổi.
   * ⚠ `-- .` chứ không phải `.`: dấu `--` chốt rằng token sau nó là ĐƯỜNG DẪN, không phải một tên
   *   nhánh/ref — `git status .` với một thư mục tên trùng tên nhánh là chỗ mơ hồ không cần thiết.
   */
  {
    nhan: "git status",
    khuon: ["git", "status"],
    hanGioMs: 20_000,
    moTa: "Liệt kê tệp đã đổi/chưa theo dõi. CHỈ HỎI — không đổi một byte nào của cây làm việc.",
    thoatCwdTheoCayThuMuc: false,
    ghiDia: false,
    sinhSanPhamDung: false,
    // `--no-pager` là phòng vệ chứ không phải thẩm mỹ: git chỉ phân trang khi stdout là TTY, nhưng
    // một cấu hình `core.pager` cứng đầu vẫn có thể treo một tiến trình con đọc stdin đã đóng.
    phanGiai: () => ({ file: "git", args: ["--no-pager", "status", "--", "."] }),
  },
  {
    nhan: "git diff",
    khuon: ["git", "diff"],
    hanGioMs: 20_000,
    moTa: "Khác biệt chưa staged của cây làm việc. CHỈ HỎI — không hoàn nguyên gì (xem khối `git checkout` ở đầu file).",
    thoatCwdTheoCayThuMuc: false,
    ghiDia: false,
    sinhSanPhamDung: false,
    phanGiai: () => ({ file: "git", args: ["--no-pager", "diff", "--", "."] }),
  },
  // ════════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ doc 79 · TRỤC 1 (D) — VÒNG KHÉP KÍN CHO DỰ ÁN THỬ C# (`dotnet`) VÀ REACT/NODE (`node --test`)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  /**
   * ⚠⚠ MỖI MỤC = **MỘT SUBCOMMAND CỐ ĐỊNH + MỘT ĐƯỜNG TRONG HỘP CÁT**, không gì khác. Đây là chỗ dễ
   * hỏng nhất khi mở rộng bảng, nên ghi ra hai bất biến đã cân nhắc:
   *
   *  1. **KHÔNG `--` rồi lệnh tuỳ ý.** Khuôn có ĐÚNG BA phần tử; `dotnet build -- rm -rf /` tách ra
   *     6 phần tử argv ⇒ `khopKhuon` lệch arity ⇒ `CMD_NOT_ALLOWED`. `dotnet -- rm` (4 phần tử, index
   *     1 = `--` ≠ `build`/`test`/`format`) cũng `CMD_NOT_ALLOWED`. Không có đường nào cho một token
   *     thứ hai do model viết đi vào argv của tiến trình con.
   *  2. **`node --test <đường>` KHÔNG PHẢI `node <script>`.** Index 1 ghim CỨNG `--test`, nên
   *     `node evil.mjs` (index 1 = `evil.mjs`) lệch khuôn ⇒ từ chối. Chỉ chế độ TRÌNH CHẠY TEST được
   *     mở — cùng hồ sơ rủi ro với `npx vitest run <đường>` (cả hai đều THI HÀNH mã của tệp test trong
   *     hộp cát), và cùng phòng vệ: môi trường ĐÃ LỌC (không bí mật), đường qua `phanQuyetDuongDan`.
   *
   * ⚠ **RESTORE THEO TRIỂN KHAI — MẶC ĐỊNH OFFLINE (`--no-restore`), MỞ BẰNG CỜ.**
   *   `dotnet build`/`dotnet test` mặc định chạy một lượt `restore` NGẦM chạm NuGet feed (mạng).
   *   Mặc định của MÃ vẫn là thêm `--no-restore` vào argv phân giải (hằng của mã, không phải đầu
   *   vào model): trên máy không mạng, lần ĐẦU một người phải chạy `dotnet restore <dự-án>` tay ở
   *   terminal (package tự tải + chép vào local feed), sau đó vòng lặp tác nhân chạy offline trên
   *   cache toàn cục. ★ 2026-08-24 — quyết định chủ dự án: triển khai CÓ INTERNET đặt
   *   `DOTNET_CHO_PHEP_RESTORE=1` ⇒ bỏ `--no-restore`, restore ngầm kéo về bình thường. Cờ được
   *   đọc TẠI LÚC PHÂN GIẢI qua `dotnetChoPhepRestore()` (một hàm thuần, CHỈ `"1"` bật) — `moTa`
   *   của hai mục là getter đọc cùng hàm, nên thẻ duyệt khai đúng chế độ đang chạy, không phải chế
   *   độ lúc nạp module. `dotnet format` không nhận `--no-restore` ổn định giữa các bản SDK nên để
   *   trần. Telemetry của dotnet (một đường ra mạng khác) bị tắt qua `DOTNET_*` ở
   *   `BIEN_MOI_TRUONG_DAT_THEM` — cờ restore KHÔNG chạm các biến ấy.
   *
   * ⚠ `dotnet` phân giải qua PATH (như `git`), không `existsSync`: vắng SDK ⇒ `spawn` ném ENOENT ⇒
   *   `CMD_SPAWN_ERROR` (một lỗi môi trường TRUNG THỰC, không phải "lệnh sai").
   * ⚠ `node --test` dùng CHÍNH `process.execPath` (như `npx vitest`), không tra PATH — cùng node đang
   *   phục vụ, không mơ hồ phiên bản.
   */
  {
    nhan: "dotnet build <đường-dẫn>",
    khuon: ["dotnet", "build", null],
    hanGioMs: 240_000,
    // ★ getter, KHÔNG phải chuỗi đóng băng: thẻ duyệt phải khai đúng chế độ restore ĐANG chạy —
    //   một moTa tính lúc nạp module sẽ nói dối ngay khi cờ được lật (bài học `TENANT_RLS_ENABLED`).
    get moTa() {
      return dotnetChoPhepRestore()
        ? "Biên dịch một dự án/solution C# (.csproj/.sln hoặc thư mục). DOTNET_CHO_PHEP_RESTORE=1 — restore NGẦM được phép, NuGet kéo về qua mạng như bình thường. KHÔNG sửa tệp mã nguồn; chỉ sinh bin/ obj/."
        : "Biên dịch một dự án/solution C# (.csproj/.sln hoặc thư mục). Chạy OFFLINE (--no-restore) — cần restore trước ở terminal. KHÔNG sửa tệp mã nguồn; chỉ sinh bin/ obj/.";
    },
    // ⚠ `bin/`+`obj/` là SẢN PHẨM DỰNG, không phải mã nguồn của người viết ⇒ `ghiDia: false`.
    //   Xem lý lẽ "vì sao HAI ô" ở `MucDanhSachTrang`.
    thoatCwdTheoCayThuMuc: false,
    ghiDia: false,
    sinhSanPhamDung: true,
    phanQuyetOTuDo: (v) => {
      const ma = phanQuyetDuongDan(v);
      return ma === null ? null : { ma: MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED, chiTiet: `${v} (hộp cát pha A: ${ma})` };
    },
    // ⚠ Cờ đọc TẠI LÚC PHÂN GIẢI (mỗi lượt phán quyết) — xem `dotnetChoPhepRestore`.
    phanGiai: (oTuDo) =>
      oTuDo === null
        ? null
        : { file: "dotnet", args: dotnetChoPhepRestore() ? ["build", oTuDo] : ["build", oTuDo, "--no-restore"] },
  },
  {
    nhan: "dotnet test <đường-dẫn>",
    khuon: ["dotnet", "test", null],
    hanGioMs: 240_000,
    // ★ getter — cùng lý lẽ với `dotnet build` ngay trên.
    get moTa() {
      return dotnetChoPhepRestore()
        ? "Chạy bộ test C# của một dự án/solution (.csproj/.sln hoặc thư mục). DOTNET_CHO_PHEP_RESTORE=1 — restore NGẦM được phép, NuGet kéo về qua mạng như bình thường. KHÔNG sửa tệp mã nguồn; chỉ sinh bin/ obj/."
        : "Chạy bộ test C# của một dự án/solution (.csproj/.sln hoặc thư mục). Chạy OFFLINE (--no-restore). KHÔNG sửa tệp mã nguồn; chỉ sinh bin/ obj/.";
    },
    thoatCwdTheoCayThuMuc: false,
    ghiDia: false,
    sinhSanPhamDung: true,
    phanQuyetOTuDo: (v) => {
      const ma = phanQuyetDuongDan(v);
      return ma === null ? null : { ma: MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED, chiTiet: `${v} (hộp cát pha A: ${ma})` };
    },
    phanGiai: (oTuDo) =>
      oTuDo === null
        ? null
        : { file: "dotnet", args: dotnetChoPhepRestore() ? ["test", oTuDo] : ["test", oTuDo, "--no-restore"] },
  },
  {
    nhan: "dotnet format <đường-dẫn>",
    khuon: ["dotnet", "format", null],
    hanGioMs: 180_000,
    moTa:
      "⚠ GHI ĐÈ TỆP MÃ NGUỒN: định dạng lại mọi tệp .cs dưới đường được trỏ theo .editorconfig và " +
      "LƯU ĐÈ tại chỗ. Không đổi ngữ nghĩa mã, nhưng đổi BYTE trên đĩa — và không có diff để xem trước.",
    /**
     * ★★★ **MỤC DUY NHẤT CÓ `ghiDia: true` TRONG CẢ BẢNG.**
     *
     * Nó ở lại danh sách trắng có chủ ý (dự án C# cần nó thật, và người bấm duyệt là người biết mình
     * xin gì). Cái được siết là **LỜI KHAI**, không phải tính năng:
     *   • `xemTruoc` đẩy một cảnh báo NỔI BẬT lên **đầu** thẻ duyệt (không có nó ⇒ census ĐỎ);
     *   • `NHAN_KIEM_CHUNG` của vòng tự động **loại** nó (`aiCodingVerify.ts`) ⇒ không lượt ghi nào
     *     rời đĩa mà không có người bấm;
     *   • cờ `AI_REPO_EXEC_GHIDIA_DOI_CANEDIT` (mặc định TẮT) đòi **thêm** `ai_repo_read/canEdit`.
     */
    thoatCwdTheoCayThuMuc: false,
    ghiDia: true,
    // MSBuild workspace load ⇒ cũng chạm `obj/`. Hai ô độc lập, và mục này bật cả hai.
    sinhSanPhamDung: true,
    phanQuyetOTuDo: (v) => {
      const ma = phanQuyetDuongDan(v);
      return ma === null ? null : { ma: MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED, chiTiet: `${v} (hộp cát pha A: ${ma})` };
    },
    phanGiai: (oTuDo) => (oTuDo === null ? null : { file: "dotnet", args: ["format", oTuDo] }),
  },
  {
    nhan: "node --test <đường-dẫn>",
    khuon: ["node", "--test", null],
    hanGioMs: 180_000,
    moTa: "Chạy trình chạy test tích hợp của Node cho MỘT đường (tệp .test.mjs hoặc thư mục). CHỈ chế độ --test, KHÔNG chạy script tuỳ ý.",
    thoatCwdTheoCayThuMuc: false,
    ghiDia: false,
    sinhSanPhamDung: false,
    phanQuyetOTuDo: (v) => {
      const ma = phanQuyetDuongDan(v);
      return ma === null ? null : { ma: MA_TU_CHOI_LENH.CMD_ARG_PATH_REJECTED, chiTiet: `${v} (hộp cát pha A: ${ma})` };
    },
    phanGiai: (oTuDo) => (oTuDo === null ? null : { file: process.execPath, args: ["--test", oTuDo] }),
  },
];

export type KetQuaPhanQuyetLenh =
  | { ok: true; muc: MucDanhSachTrang; oTuDo: string | null; nhan: string; spec: LenhDaPhanGiai; hanGioMs: number }
  | { ok: false; ma: MaTuChoiLenh; chiTiet: string };

/** Khớp CẤU TRÚC: cùng độ dài, từng phần tử bằng nhau (ô `null` bỏ qua phép so). */
function khopKhuon(khuon: readonly (string | null)[], argv: readonly string[]): boolean {
  if (khuon.length !== argv.length) return false;
  for (let i = 0; i < khuon.length; i++) {
    const k = khuon[i]!;
    if (k === null) continue;
    if (k !== argv[i]) return false;
  }
  return true;
}

/**
 * ★ LỚP 2. Nhận **argv đã tách**, không bao giờ nhìn chuỗi gốc — nên nó phán quyết được một mình,
 * và một lưới có thể đo nó một mình (xem khối hai-lớp ở đầu file).
 */
export function phanQuyetLenh(argv: readonly string[], goc = gocHopCat()): KetQuaPhanQuyetLenh {
  if (!Array.isArray(argv) || argv.length === 0) {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_NOT_ALLOWED, chiTiet: "argv rỗng" };
  }
  if (argv.length > TRAN_PHAN_TU_ARGV) {
    return { ok: false, ma: MA_TU_CHOI_LENH.CMD_NOT_ALLOWED, chiTiet: `${argv.length} phần tử argv, trần ${TRAN_PHAN_TU_ARGV}` };
  }
  for (const muc of DANH_SACH_TRANG) {
    if (!khopKhuon(muc.khuon, argv)) continue;
    /**
     * ★★★ GỐC KHÔNG PHẢI DỰ ÁN NODE ⇒ TỪ CHỐI LỆNH NODE. Xem `CMD_GOC_THIEU_PACKAGE_JSON`.
     * ⚠ Phép kiểm chỉ nhìn **đúng gốc**, KHÔNG đi ngược lên — đi ngược lên chính là hành vi của npm
     *   mà đoạn này được viết ra để chặn. Tìm thấy `package.json` ở thư mục CHA nghĩa là npm sẽ dùng
     *   dự án CHA, tức đúng tình huống phải từ chối chứ không phải lý do để cho qua.
     */
    if (muc.thoatCwdTheoCayThuMuc && !existsSync(path.join(goc, "package.json"))) {
      return {
        ok: false,
        ma: MA_TU_CHOI_LENH.CMD_GOC_THIEU_PACKAGE_JSON,
        chiTiet:
          `${muc.nhan}: dự án đang mở KHÔNG có "package.json" ở gốc. ` +
          `npm/npx sẽ đi NGƯỢC lên cây thư mục và chạy trên một dự án KHÁC — kết quả trả về sẽ ` +
          `không nói gì về dự án này. Dùng lệnh của đúng hệ sinh thái dự án (ví dụ "dotnet test <đường>").`,
      };
    }
    const viTri = muc.khuon.indexOf(null);
    const oTuDo = viTri >= 0 ? (argv[viTri] ?? null) : null;
    if (viTri >= 0) {
      if (typeof oTuDo !== "string" || oTuDo === "") {
        return { ok: false, ma: MA_TU_CHOI_LENH.CMD_NOT_ALLOWED, chiTiet: `${muc.nhan}: thiếu đối số` };
      }
      /**
       * ⚠ FAIL-CLOSED: một mục có ô tự do mà QUÊN khai bộ phán quyết là một lỗ; ở đây nó bị từ chối
       * thay vì được cho qua. `repoCommand.census.test.ts` §A còn bắt nó ở mức cấu trúc.
       *
       * ⚠⚠ **BẪY `??` — ĐÃ DÍNH THẬT, LƯỚI BẮT ĐƯỢC NGAY LƯỢT CHẠY ĐẦU.** Bản trước viết
       * `muc.phanQuyetOTuDo?.(oTuDo) ?? {…từ chối…}`. Nhưng quy ước của repo là **`null` ⇔ ĐƯỢC
       * PHÉP** (`phanQuyetDuongDan` cũng vậy), và `null ?? x` **là `x`** — nên một đường dẫn HỢP LỆ
       * rơi thẳng vào nhánh từ chối: `npx vitest run <bất kỳ>` **không bao giờ chạy được**, trong
       * khi mọi ca ÂM vẫn xanh. Đúng lớp *"vá quá tay, và chỉ chiều DƯƠNG mới thấy"*.
       * ⇒ Phải tách **"thiếu bộ phán quyết"** khỏi **"phán quyết nói ĐƯỢC"**; `??` không phân biệt
       *   được hai thứ đó vì cả `undefined` lẫn `null` đều rơi cùng một nhánh.
       */
      const bpq = muc.phanQuyetOTuDo;
      if (typeof bpq !== "function") {
        return {
          ok: false,
          ma: MA_TU_CHOI_LENH.CMD_NOT_ALLOWED,
          chiTiet: `${muc.nhan}: ô tự do KHÔNG có bộ phán quyết — từ chối theo chiều AN TOÀN`,
        };
      }
      const pq = bpq(oTuDo);
      if (pq !== null) return { ok: false, ma: pq.ma, chiTiet: pq.chiTiet };
    }
    const spec = muc.phanGiai(oTuDo, goc);
    if (spec === null) {
      return {
        ok: false,
        ma: MA_TU_CHOI_LENH.CMD_RESOLVE_ERROR,
        chiTiet: `${muc.nhan}: không tìm thấy tệp chạy (npm-cli.js / vitest.mjs)`,
      };
    }
    return {
      ok: true,
      muc,
      oTuDo,
      nhan: oTuDo === null ? muc.nhan : `${muc.khuon.filter((k) => k !== null).join(" ")} ${oTuDo}`,
      spec,
      hanGioMs: muc.hanGioMs,
    };
  }
  return { ok: false, ma: MA_TU_CHOI_LENH.CMD_NOT_ALLOWED, chiTiet: argv.join(" ") };
}

/**
 * ★ 2026-08-23 · UX LÔ 1 (B3) — **GỢI Ý LỆNH GẦN ĐÚNG NHẤT theo `argv[0]`**, cho câu từ chối
 * `CMD_NOT_ALLOWED`.
 *
 * Sự việc đo được: mỗi lượt gõ sai, người dùng "ăn nguyên bức tường 9 lệnh (~2.300 ký tự)" — trong
 * khi họ chỉ cần 1–3 mục CÙNG HỌ với thứ vừa gõ. Hàm này trả về các mục danh sách trắng có
 * `khuon[0]` trùng chữ đầu của lệnh bị từ chối (`dotnet` ⇒ 3 mục dotnet · `npm` ⇒ 2 · `git` ⇒ 2 ·
 * `npx`/`node` ⇒ 1); không đoán được ⇒ `[]` (câu từ chối khi ấy chỉ nói "N lệnh được phép, xem
 * danh sách đầy đủ").
 *
 * ⚠ THUẦN, đọc thẳng `DANH_SACH_TRANG` — thêm một mục vào bảng là gợi ý tự có, không ai phải nhớ
 *   cập nhật một bảng ánh xạ thứ hai (bảng thứ hai nào rồi cũng trôi khỏi bảng thứ nhất).
 * ⚠ CHỈ đổi LỜI KHAI, không đổi phán quyết: danh sách trắng vẫn khớp cấu trúc argv y nguyên.
 */
export function goiYLenhGanNhat(argv0: unknown): MucDanhSachTrang[] {
  if (typeof argv0 !== "string" || argv0 === "") return [];
  const dau = argv0.toLowerCase();
  return DANH_SACH_TRANG.filter((m) => m.khuon[0] === dau);
}

/** Hạn giờ THỰC TẾ: kẹp hai đầu. Người gọi hạ được, **không nâng được** quá trần của mục. */
export function hanGioThucTe(hanGioMuc: number, yeuCau?: number): number {
  const tran = Math.min(hanGioMuc, HAN_GIO_TOI_DA_MS);
  if (typeof yeuCau !== "number" || !Number.isFinite(yeuCau)) return tran;
  return Math.max(HAN_GIO_TOI_THIEU_MS, Math.min(tran, Math.floor(yeuCau)));
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÔI TRƯỜNG CON — DANH SÁCH **TRẮNG TÊN BIẾN**
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Hệ điều hành + chuỗi công cụ, **không một biến ứng dụng nào**. So khớp **KHÔNG phân biệt hoa
 * thường** vì Windows để `Path` còn POSIX để `PATH`, và một phép so phân biệt hoa thường ở đây sẽ
 * cắt mất `PATH` trên Windows ⇒ mọi lượt chạy `git` hỏng ENOENT (một lỗi trông y như "git chưa cài").
 */
export const BIEN_MOI_TRUONG_CHO_PHEP: readonly string[] = [
  "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR",
  "HOME", "HOMEDRIVE", "HOMEPATH", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS",
  "LANG", "LC_ALL", "TZ",
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

export function moiTruongDaLoc(nguon: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const chp = new Set(BIEN_MOI_TRUONG_CHO_PHEP.map((s) => s.toUpperCase()));
  const ra: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(nguon)) {
    if (v === undefined) continue;
    if (chp.has(k.toUpperCase())) ra[k] = v;
  }
  return { ...ra, ...BIEN_MOI_TRUONG_DAT_THEM };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ ĐỆM ĐẦU RA — ĐẦU + CUỐI, BỘ NHỚ HẰNG SỐ
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Bộ nhớ O(1) là một yêu cầu AN TOÀN, không phải tối ưu: một lệnh in ra vô hạn (một vòng lặp
 * `console.log` trong một ca test) sẽ làm **tiến trình máy chủ** hết bộ nhớ nếu ta gom hết rồi mới
 * cắt. Trần đầu ra phải chặn ở chỗ **nhận**, không ở chỗ **trả**.
 */
export class BoDemDauRa {
  private dau = "";
  private duoi = "";
  private tong = 0;

  constructor(
    private readonly tranDau = TRAN_DAU_RA_DAU,
    private readonly tranCuoi = TRAN_DAU_RA_CUOI,
  ) {}

  them(s: string): void {
    if (s === "") return;
    this.tong += s.length;
    if (this.dau.length < this.tranDau) this.dau += s.slice(0, this.tranDau - this.dau.length);
    this.duoi = (this.duoi + s).slice(-this.tranCuoi);
  }

  get byteThat(): number {
    return this.tong;
  }

  get catBot(): boolean {
    return this.tong > this.dau.length + Math.min(this.tong - this.dau.length, this.duoi.length);
  }

  /** Ghép ĐẦU + (khai số byte bỏ giữa) + CUỐI. */
  ket(): { text: string; boQua: number } {
    if (this.tong <= this.dau.length) return { text: this.dau, boQua: 0 };
    const conLai = this.tong - this.dau.length;
    const soCuoi = Math.min(conLai, this.duoi.length);
    const phanCuoi = this.duoi.slice(this.duoi.length - soCuoi);
    const boQua = conLai - soCuoi;
    if (boQua <= 0) return { text: this.dau + phanCuoi, boQua: 0 };
    return { text: `${this.dau}\n…[ĐÃ CẮT ${boQua} byte Ở GIỮA — đầu ${this.dau.length}, cuối ${soCuoi}]…\n${phanCuoi}`, boQua };
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// GIẾT **CẢ CÂY** TIẾN TRÌNH
// ══════════════════════════════════════════════════════════════════════════════════════════════
export type KetQuaGiet = "khong-can" | "khong-co-pid" | "da-ra-lenh" | "loi";

export function gietCayTienTrinh(pid: number | undefined | null): KetQuaGiet {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return "khong-co-pid";
  if (process.platform === "win32") {
    try {
      // `/T` = cả cây con, `/F` = cưỡng bức. Đây là cách DUY NHẤT trên Windows giết được cháu/chắt.
      const tk = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      tk.on("error", () => {
        /* taskkill vắng mặt là chuyện của môi trường; đã có ân hạn + khai báo ở tầng trên */
      });
      tk.unref();
      return "da-ra-lenh";
    } catch {
      return "loi";
    }
  }
  // POSIX: `detached: true` lúc sinh ⇒ pid là THỦ LĨNH NHÓM ⇒ pid âm giết cả nhóm.
  try {
    process.kill(-pid, "SIGKILL");
    return "da-ra-lenh";
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return "da-ra-lenh";
    } catch {
      return "loi";
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHẠY
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface KetQuaChayLenh {
  /** `true` ⇔ tiến trình đã SINH RA và đã THOÁT (mã thoát nào cũng tính). */
  ok: boolean;
  /** `null` ⇔ lượt chạy bình thường. Khác `null` ⇒ có mã máy-đọc-được. */
  ma: MaTuChoiLenh | null;
  maThoat: number | null;
  tinHieu: string | null;
  hetGio: boolean;
  /** Kết cục của lượt giết cây khi hết giờ. `"khong-can"` ⇔ không phải giết. */
  giet: KetQuaGiet;
  /** `true` ⇔ đã ra lệnh giết mà **chưa quan sát được** `exit` trong ân hạn. Khai, không giấu. */
  chuaXacNhanChet: boolean;
  msChay: number;
  /** stdout + stderr đã trộn theo thứ tự tới, ĐÃ cắt, ĐÃ qua `redactSecretsOnly`. */
  dauRa: string;
  byteThat: number;
  catBot: boolean;
  /** `true` ⇔ `redactSecretsOnly` đã thay ít nhất một chỗ. */
  daChe: boolean;
  chiTiet: string;
}

export interface TuyChonChay {
  hanGioMs: number;
  goc?: string;
  /** Chỉ dùng trong lưới: thay `process.env` nguồn để đo phép lọc mà không phải bẩn tiến trình. */
  envNguon?: NodeJS.ProcessEnv;
}

/**
 * ★ Chạy MỘT lệnh **ĐÃ PHÂN GIẢI**. Hàm này cố ý **không** biết gì về danh sách trắng: phán quyết
 * là việc của `tachArgv` + `phanQuyetLenh`, và tách ra thì đo được riêng lượt giết cây bằng một
 * lệnh ngủ (thứ **không** và **không được** có trong danh sách trắng).
 *
 * ⚠ Người gọi trong mã sản phẩm **chỉ có một** — `writeHandlers/repoCommand.ts:execute`, và ở đó
 * `phanQuyetLenh()` chạy TRƯỚC, lần thứ hai (args đến từ hàng `ai_pending_actions`, không tin được).
 * `repoCommand.census.test.ts` §E cưỡng chế bất biến "chỉ một người gọi, và người ấy phán quyết
 * trước" bằng AST.
 */
export function chayLenhTrongHopCat(spec: LenhDaPhanGiai, tuyChon: TuyChonChay): Promise<KetQuaChayLenh> {
  const goc = tuyChon.goc ?? gocHopCat();
  const hanGio = Math.max(HAN_GIO_TOI_THIEU_MS, Math.min(tuyChon.hanGioMs, HAN_GIO_TOI_DA_MS));
  const batDau = Date.now();
  const bo = new BoDemDauRa();

  return new Promise<KetQuaChayLenh>((giaiQuyet) => {
    let xong = false;
    let hetGio = false;
    let giet: KetQuaGiet = "khong-can";
    let maThoat: number | null = null;
    let tinHieu: string | null = null;
    let dongHoHanGio: NodeJS.Timeout | null = null;
    let dongHoAnHan: NodeJS.Timeout | null = null;
    let dongHoVet: NodeJS.Timeout | null = null;

    const donDongHo = () => {
      if (dongHoHanGio) clearTimeout(dongHoHanGio);
      if (dongHoAnHan) clearTimeout(dongHoAnHan);
      if (dongHoVet) clearTimeout(dongHoVet);
      dongHoHanGio = dongHoAnHan = dongHoVet = null;
    };

    const hoanTat = (ma: MaTuChoiLenh | null, chiTiet: string, chuaXacNhanChet: boolean) => {
      if (xong) return;
      xong = true;
      donDongHo();
      const { text } = bo.ket();
      const che = redactSecretsOnly(text);
      giaiQuyet({
        ok: ma === null || ma === MA_TU_CHOI_LENH.CMD_TIMEOUT,
        ma,
        maThoat,
        tinHieu,
        hetGio,
        giet,
        chuaXacNhanChet,
        msChay: Date.now() - batDau,
        dauRa: che.text,
        byteThat: bo.byteThat,
        catBot: bo.catBot,
        daChe: che.text !== text,
        chiTiet,
      });
    };

    let con: ReturnType<typeof spawn>;
    try {
      con = spawn(spec.file, [...spec.args], {
        cwd: goc,
        env: moiTruongDaLoc(tuyChon.envNguon),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        // ⚠ POSIX: nhóm tiến trình RIÊNG để `process.kill(-pid)` với tới được cháu/chắt.
        //   Windows: `detached` đổi nghĩa (bỏ console) và KHÔNG cho phép giết theo nhóm ⇒ ở đó
        //   phép giết cây là `taskkill /T`, xem `gietCayTienTrinh`.
        detached: process.platform !== "win32",
        shell: false,
      });
    } catch (e) {
      // `spawn()` NÉM ĐỒNG BỘ (EACCES/EINVAL): không listener nào kịp gắn ⇒ đây là nhánh thoát duy nhất.
      hoanTat(MA_TU_CHOI_LENH.CMD_SPAWN_ERROR, e instanceof Error ? e.message : String(e), false);
      return;
    }

    con.stdout?.setEncoding("utf8");
    con.stderr?.setEncoding("utf8");
    con.stdout?.on("data", (c: string) => bo.them(c));
    con.stderr?.on("data", (c: string) => bo.them(c));
    con.stdout?.on("error", () => {});
    con.stderr?.on("error", () => {});

    con.on("error", (e) => {
      hoanTat(MA_TU_CHOI_LENH.CMD_SPAWN_ERROR, e instanceof Error ? e.message : String(e), false);
    });

    /**
     * ⚠ `close` (mọi pipe đã đóng) là tín hiệu ĐẦY ĐỦ nhất, nhưng nó **có thể không bao giờ tới**:
     * `npm` để cháu thừa kế đúng hai pipe ấy, nên một tiến trình cháu còn sống là một `close` treo.
     * ⇒ `exit` quyết định mã thoát; sau `exit` mở một cửa sổ VÉT ngắn cho phần stdout còn trên
     * đường; `close` tới sớm hơn thì kết thúc ngay. Không nhánh nào chờ vô hạn.
     */
    con.on("exit", (code, sig) => {
      maThoat = typeof code === "number" ? code : null;
      tinHieu = sig ?? null;
      if (hetGio) {
        hoanTat(MA_TU_CHOI_LENH.CMD_TIMEOUT, `quá hạn ${hanGio} ms`, false);
        return;
      }
      if (dongHoVet) return;
      dongHoVet = setTimeout(() => hoanTat(null, "", false), CUA_SO_VET_DAU_RA_MS);
    });

    con.on("close", (code, sig) => {
      // ⚠ Thứ tự `exit`/`close` do Node quyết; đừng giả định. Lấy mã thoát ở CẢ HAI chỗ để một lượt
      //   `close` tới trước không làm mất mã thoát THẬT (nó sẽ hiện ra là `null` — một lời khai sai).
      if (maThoat === null) maThoat = typeof code === "number" ? code : con.exitCode;
      if (tinHieu === null) tinHieu = sig ?? con.signalCode;
      if (hetGio) {
        hoanTat(MA_TU_CHOI_LENH.CMD_TIMEOUT, `quá hạn ${hanGio} ms`, false);
        return;
      }
      hoanTat(null, "", false);
    });

    dongHoHanGio = setTimeout(() => {
      hetGio = true;
      giet = gietCayTienTrinh(con.pid);
      /**
       * ⚠⚠ **KHÔNG tự khai là đã giết xong.** Ra lệnh giết ≠ quan sát cái chết (VRAM Pha 3: *"giết
       * nhầm rồi báo cáo thành công"*). Chờ `exit` THẬT; hết ân hạn mà chưa thấy thì vẫn trả về —
       * nhưng trả về kèm `chuaXacNhanChet: true`, để lời khai đúng bằng thứ quan sát được.
       */
      dongHoAnHan = setTimeout(() => {
        hoanTat(MA_TU_CHOI_LENH.CMD_TIMEOUT, `quá hạn ${hanGio} ms; đã ra lệnh giết cây nhưng CHƯA quan sát được tiến trình thoát trong ${AN_HAN_SAU_GIET_MS} ms`, true);
      }, AN_HAN_SAU_GIET_MS);
    }, hanGio);
  });
}
