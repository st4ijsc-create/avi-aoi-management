/**
 * ★★★ doc 78 · PHA B — **`run_command`: WRITE TOOL, KHÔNG BAO GIỜ TỰ CHẠY.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO `kind: "write"` — VÀ MỘT ĐÍNH CHÍNH BẮT BUỘC ĐỌC (2026-08-20)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ Bản trước của khối này mở đầu bằng *"Cả năm mục trong danh sách trắng đều là lệnh HỎI/KIỂM
 * TRA — không mục nào ghi vào cây làm việc"*. **SAI, và sai từ 2026-08-19.** Bảng có **CHÍN** mục,
 * và mục thứ tám — `dotnet format <đường>` — **GHI ĐÈ mọi tệp `.cs`** dưới cây được trỏ. Nó là mục
 * DUY NHẤT làm vậy (`ghiDia: true` ở `repoCommandSandbox.DANH_SACH_TRANG`), và nó đi vòng **cả bốn**
 * hàng rào của `apply_diff`: không hỏi tệp bẩn · không băm chống TOCTOU · không diff để xem trước ·
 * không hộp cát từng tệp. ⇒ `xemTruoc` dưới đây **phải** đẩy một cảnh báo NỔI BẬT cho mục ấy, và
 * `repoCommand.census.test.ts` ĐỎ nếu cảnh báo biến mất.
 *
 * Tám mục còn lại đúng là lệnh HỎI/KIỂM TRA.
 * Vậy mà tool vẫn là `write` **cho cả chín**, và đó là một quyết định có tải trọng: `kind` ở repo này quyết định
 * **có phải qua NGƯỜI hay không** (`isWriteTool` → `proposeAction` → `confirmAction`), chứ không
 * phát biểu về hướng của byte. Một lượt sinh tiến trình tiêu CPU/RAM thật, chạy 4 phút, và
 * `npx vitest run` **thi hành mã của repo** — thứ không ai muốn một model tự làm mà không hỏi.
 * ⇒ `kind: "write"` là cách DUY NHẤT trong kiến trúc này để nói *"phải có người bấm duyệt"*.
 * ⚠ Đảo nó về `"read"` là **gỡ HITL** — `executeDecision` sẽ gọi thẳng `handler`, và tool này cố ý
 * **KHÔNG có `handler`** nên lượt ấy chết bằng `READ_TOOL_MISSING_HANDLER`. Lưới
 * `repoCommand.census.test.ts` §D đo đúng cả hai vế.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `preview()` **KHÔNG CHẠY LỆNH** — BÀI HỌC C-1 CỦA `writeHandlers/programmingFile.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `preview()` chạy **TRƯỚC** cổng HITL và kết quả của nó đi tới **BA đích không cần ai xác nhận**
 * (`aiCopilotActions.ts`): trả thẳng về Agent/UI · ghi vào `ai_pending_actions.previewJson` · ghi
 * vào sổ audit. Ở `programmingFile.ts` điều đó đã thành một lỗ Critical THẬT (bí mật ngoài
 * workspace rò qua `preview`). Ở đây, một `preview` mà **chạy lệnh** sẽ là lỗ nặng hơn hẳn: nó biến
 * "xin phép chạy" thành "đã chạy rồi mới xin phép" — tức HITL trở thành trang trí.
 * ⇒ `preview()` ở dưới **chỉ phán quyết + mô tả**. Nó không nhập bộ chạy, và không gọi
 * `chayLenhTrongHopCat` ở bất kỳ nhánh nào. §E của lưới cưỡng chế bằng AST.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ RBAC — `ai_repo_exec/canCreate`, MỘT MODULE **RIÊNG**, KHÔNG DÙNG LẠI `ai_repo_read`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Câu hỏi thật không phải *"bit mới có đắt không"* mà *"cấp bit ĐỌC có được phép kéo theo quyền
 * CHẠY không"*. Ba lý lẽ đo được, theo đúng tiền lệ `vram_control` (Pha 5 Task 3b) — dòng catalog
 * của nó nói thẳng *"KHÔNG bao gồm quyền XEM trạng thái VRAM — mặt đọc đứng trên
 * machine_control/canView"*:
 *
 *   1. **Nếu dùng chung `moduleName`, hai năng lực nằm CÙNG MỘT HÀNG `permissions`.** Người quản
 *      trị mở bảng quyền thấy một dòng *"AI đọc mã nguồn"* với năm ô tick; tick thêm một ô là mở
 *      quyền sinh tiến trình. Đó đúng là chế độ hỏng (b) mà chính mig 0330 viết ra để **tránh**:
 *      *"cấp X là một quyết định hợp lý, và nó sẽ mở Y trong im lặng"*.
 *   2. **Câu từ chối phải nói đúng sự thật.** `cauTuChoi`/`denyMessage` nêu đích danh `module/action`.
 *      *"Bạn không có quyền ai_repo_read/canCreate"* cho một người vừa xin **chạy test** là một lời
 *      khai sai về lý do — đúng lớp lỗi mà `readToolRbac.cauTuChoi` và `_uyQuyenAnh` tồn tại để chống.
 *   3. **Mig 0330 đã ĐẶT TRƯỚC `ai_repo_read/canEdit` cho PHA C (ghi tệp).** Đọc/ghi **cùng một đối
 *      tượng** (tệp trong repo) là đúng chỗ để dùng hai `action` trên một `module`. **Chạy lệnh là
 *      đối tượng KHÁC** — tiến trình, CPU, thời gian máy. Nhét nó vào cùng module là trộn hai trục.
 *
 * ⇒ `ai_repo_exec` · `action: "canCreate"` ("tạo một lượt chạy"). Chi phí đo được: `moduleName` là
 *   `varchar(100)` tự do ⇒ bit mới = **MỘT HÀNG**, KHÔNG DDL; `category` dùng lại `settings` đã có
 *   trong pgEnum ⇒ cũng không đụng enum. Seed: `admin` + `engineer` (mig 0331 backfill cho tài
 *   khoản đã tồn tại; `DEFAULT_ROLE_PERMISSIONS` cho tài khoản mới) — đúng phạm vi doc 78 §7.3.
 * ⚠ `admin` KHÔNG cần hàng: `accessControl.checkPermission` short-circuit `true` cho vai admin khi
 *   chưa bật scoped-admin. Hàng seed chỉ để bảng quyền của giao diện không thiếu mục.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÍNH CHÍNH 2026-08-20 — LÝ LẼ SỐ 3 Ở TRÊN **KHÔNG CÒN ĐÚNG CHO CẢ CHÍN MỤC**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Chạy lệnh là đối tượng KHÁC — tiến trình, CPU, thời gian máy"* đúng cho **tám** mục. Với mục
 * thứ tám (`dotnet format`, `ghiDia: true`) thì đối tượng là **ĐÚNG CÁI ĐỐI TƯỢNG của lý lẽ số 3**:
 * tệp mã nguồn trong repo. Hệ quả đo được: một quản trị viên bỏ tick `ai_repo_read/canEdit` để
 * **thu quyền ghi** của AI vẫn để lại một đường ghi đè mã nguồn qua bit `ai_repo_exec/canCreate` —
 * tức việc tách hai bit (mig 0330/0332) mua được ÍT HƠN thứ nó khai.
 * ⇒ Bản vá để sẵn: `QUYEN_GHI_THEM` + cờ `AI_REPO_EXEC_GHIDIA_DOI_CANEDIT` (**mặc định TẮT**, xem
 *   khối lý lẽ ở hằng ấy). Bật hay không là quyết định của **chủ dự án**, vì nó đổi hành vi cho
 *   tài khoản đang chạy.
 */
import { z } from "zod";
import { checkPermission } from "../../../_core/accessControl";
import {
  DANH_SACH_TRANG,
  HAN_GIO_TOI_DA_MS,
  HAN_GIO_TOI_THIEU_MS,
  MA_TU_CHOI_LENH,
  TRAN_DAU_RA,
  TRAN_KY_TU_LENH,
  chayLenhTrongHopCat,
  hanGioThucTe,
  phanQuyetLenh,
  tachArgv,
  type MaTuChoiLenh,
  type MucDanhSachTrang,
} from "../repoCommandSandbox";
import {
  TRAN_BYTE_MOI_PHIEN,
  gocHopCat,
  nganSachConLai,
  tieuNganSach,
} from "../repoSandbox";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

/** Không thêm thành viên nào vào `ToolResultType` — dùng lại `action_result`. */
const KIEU = "action_result" as const;

/** ★ MỘT nguồn cho cả lời khai (`requiredPermission`) lẫn phép cưỡng chế (`proposeAction`). */
const QUYEN = { module: "ai_repo_exec", action: "canCreate" } as const;

/**
 * ★★★ (D) 2026-08-20 — **BIT THỨ HAI CHO CÁC MỤC `ghiDia`, SAU MỘT CỜ MẶC ĐỊNH TẮT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VẤN ĐỀ ĐO ĐƯỢC
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mig 0330/0332 tách hai bit đúng để một quản trị viên có thể **thu quyền GHI mà giữ quyền ĐỌC**:
 * bỏ tick `ai_repo_read/canEdit` ⇒ `apply_diff` chết. Nhưng `dotnet format` **ghi đè tệp mã nguồn**
 * và nó đứng sau `ai_repo_exec/canCreate`. ⇒ Sau khi thu bit ghi, AI **vẫn ghi đè được mã nguồn**
 * qua cửa "chạy lệnh". Việc tách hai bit vì thế mua được ít hơn hẳn thứ nó khai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO **SAU MỘT CỜ**, KHÔNG BẬT THẲNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đổi ma trận quyền là **đổi hành vi cho tài khoản đang chạy**. Trên máy này `engineer` có cả hai
 * bit (mig 0331 + 0332) nên bật thẳng sẽ *"không thấy gì đổi"* — và đó chính là kiểu bằng chứng
 * xanh-vì-lý-do-sai đã trả giá nhiều lần: một khách hàng đã cố ý bỏ tick `canEdit` sẽ mất một luồng
 * đang dùng, im lặng, sau một lần cập nhật. ⇒ Quyết định là của **chủ dự án**, mã chỉ để sẵn.
 *
 * ⚠ `"1"` ⇒ mục `ghiDia` đòi **CẢ HAI** bit. Vắng/`"0"` ⇒ hành vi **KHÔNG đổi một byte** (và không
 *   một lượt gọi `checkPermission` phụ nào xảy ra — cờ được hỏi TRƯỚC).
 */
export const QUYEN_GHI_THEM = { module: "ai_repo_read", action: "canEdit" } as const;

/** Đọc env **tại chỗ gọi** (lưới lật env theo ca — không nhớ đệm ở tầng module). */
export function congGhiDiaBat(): boolean {
  return process.env.AI_REPO_EXEC_GHIDIA_DOI_CANEDIT === "1";
}

/**
 * ★ CHÍNH SÁCH, tách khỏi phép CƯỠNG CHẾ — và đây là một quyết định về **đo được**, không phải
 * thẩm mỹ. `checkPermission` cần CSDL; nếu vị từ *"mục này có đòi bit thứ hai không"* nằm lẫn trong
 * lượt gọi ấy thì cách duy nhất để đo nó là **mock một module**, đúng thứ đã cắn hôm 2026-08-19
 * (một lưới mock-module XANH khi chạy riêng, **ĐỎ trong suite**). Tách ra thì chính sách là **hàm
 * thuần** — đo được đủ hai chiều cờ, cho cả chín mục, không CSDL, không mock.
 */
export function canDoiBitGhiThem(muc: MucDanhSachTrang): boolean {
  return muc.ghiDia && congGhiDiaBat();
}

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

/** Khoá sổ ngân sách byte — **cùng sổ, cùng hình dạng khoá** với ba read tool của pha A. */
function khoaNganSach(ctx: ToolExecContext): string {
  return `u:${ctx.user.id}`;
}

interface ThamSo {
  command: string;
  timeoutMs?: number;
}

const thamSo = z
  .object({
    command: z.string().min(1).max(TRAN_KY_TU_LENH),
    /**
     * ⚠ CHỈ HẠ ĐƯỢC, KHÔNG NÂNG ĐƯỢC. `max` ở đây là trần của cả hệ; `hanGioThucTe()` còn kẹp
     * xuống trần RIÊNG của từng mục danh sách trắng. Một `timeoutMs` khổng lồ do model đưa vào
     * do đó **không thể** kéo dài lượt chạy quá trần của mục.
     */
    timeoutMs: z.number().int().min(HAN_GIO_TOI_THIEU_MS).max(HAN_GIO_TOI_DA_MS).optional(),
  })
  .strict();

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CÂU TỪ CHỐI — mỗi mã một câu, nói rõ CÓ ĐƯỜNG SỬA hay KHÔNG
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Mỗi mã viết THẲNG bằng hằng chữ ở nơi đặt `note` (xem `napLoi()` bên dưới), có chủ ý:
 * `toolNoteCensus.test.ts` §1 quét mã nguồn tìm `note:` + hằng chữ VIẾT HOA. Viết `note: BANG[ma]`
 * làm §1 mù và §2 đỏ.
 */
function cauTuChoiLenh(ma: MaTuChoiLenh, chiTiet: string, lang: ToolLang): string {
  /**
   * ⚠⚠ SỐ LƯỢNG LẤY TỪ **CHÍNH BẢNG**, KHÔNG VIẾT TAY. Bản trước viết cứng *"Năm lệnh được phép"* /
   * *"The five allowed commands"* / *"允许的五条命令"* rồi in **chín** dòng ngay bên dưới — một câu tự
   * mâu thuẫn với chính nó, ở cả ba ngôn ngữ, suốt từ lượt mở bảng lên chín mục. Đọc `.length` thì
   * lớp lỗi ấy **không còn chỗ tồn tại**, thay vì phải nhớ sửa ở ba chỗ mỗi lần bảng đổi.
   */
  const so = DANH_SACH_TRANG.length;
  const bang = DANH_SACH_TRANG.map((m) => `• ${m.nhan}${m.ghiDia ? " ⚠ GHI ĐÈ TỆP MÃ NGUỒN" : ""} — ${m.moTa}`).join("\n");
  switch (ma) {
    case "CMD_METACHAR":
      return w(
        lang,
        `Lệnh chứa ký tự KHÔNG nằm trong tập cho phép (${chiTiet}). Hộp cát lệnh chỉ nhận chữ, số, dấu cách, và _ . / \\ : - @ — nên mọi ký tự nối/chuyển hướng của shell (; && || | \` $ > <) đều bị chặn ngay ở đây. Nếu bạn định chạy HAI lệnh thì hãy gọi tool HAI lần; nối lệnh KHÔNG BAO GIỜ được cho phép.`,
        `The command contains a character outside the allowed set (${chiTiet}). Only letters, digits, space and _ . / \\ : - @ are accepted, so every shell chaining/redirect character is rejected here. To run two commands, call the tool twice; chaining is never allowed.`,
        `命令包含不在允许字符集内的字符（${chiTiet}）。仅接受字母、数字、空格及 _ . / \\ : - @，因此所有 shell 连接/重定向字符都会在此被拒绝。需要运行两条命令请调用工具两次；串联永远不被允许。`,
      );
    case "CMD_NOT_ALLOWED":
      return w(
        lang,
        `Lệnh "${chiTiet}" KHÔNG nằm trong danh sách TRẮNG. Đây là danh sách trắng, không phải danh sách đen: mọi lệnh không được khai đều bị từ chối, và danh sách không nới ra lúc chạy. ${so} lệnh được phép:\n${bang}\n⚠ git checkout / git reset / rm / DROP KHÔNG BAO GIỜ được thêm vào — ngày 2026-08-18 một tác nhân chạy "git checkout <file>" để hoàn nguyên một sửa đổi 1 dòng và xoá mất 123 dòng chưa commit.`,
        `Command "${chiTiet}" is NOT on the allowlist. This is an allowlist, not a denylist: anything not declared is refused, and the list never widens at runtime. The ${so} allowed commands:\n${bang}\n⚠ git checkout / git reset / rm / DROP will never be added.`,
        `命令 "${chiTiet}" 不在白名单中。这是白名单而非黑名单：未声明的一律拒绝，且运行时不会放宽。允许的 ${so} 条命令：\n${bang}\n⚠ git checkout / git reset / rm / DROP 永不加入。`,
      );
    case "CMD_ARG_PATH_REJECTED":
      return w(
        lang,
        `Đường dẫn của "npx vitest run" bị HỘP CÁT REPO từ chối: ${chiTiet}. Hộp cát chặn đường tuyệt đối, "..", đoạn dạng ổ đĩa "C:" ở bất kỳ vị trí nào, thư mục loại trừ (node_modules/.git/dist/…) và tệp bí mật (.env*, khoá riêng). Hãy dùng đường dẫn TƯƠNG ĐỐI trong cây mã nguồn.`,
        `The path for "npx vitest run" was rejected by the repo sandbox: ${chiTiet}. Use a RELATIVE path inside the source tree.`,
        `"npx vitest run" 的路径被仓库沙箱拒绝：${chiTiet}。请使用源码树内的相对路径。`,
      );
    case "CMD_RESOLVE_ERROR":
      return w(
        lang,
        `Lệnh HỢP LỆ nhưng KHÔNG phân giải được tệp chạy: ${chiTiet}. Đây là lỗi CÀI ĐẶT của môi trường (thiếu npm-cli.js hoặc node_modules/vitest), KHÔNG phải lệnh của bạn sai — đừng đi sửa lệnh.`,
        `The command is VALID but its executable could not be resolved: ${chiTiet}. This is an environment/installation fault, not a bad command.`,
        `命令有效但无法解析可执行文件：${chiTiet}。这是环境安装问题，而非命令有误。`,
      );
    case "CMD_SPAWN_ERROR":
      return w(
        lang,
        `Không sinh được tiến trình con: ${chiTiet}. Lệnh chưa hề chạy.`,
        `Failed to spawn the child process: ${chiTiet}. The command never ran.`,
        `无法创建子进程：${chiTiet}。命令从未运行。`,
      );
    case "CMD_GOC_THIEU_PACKAGE_JSON":
      return w(
        lang,
        `Lệnh KHÔNG chạy: ${chiTiet}`,
        `The command did NOT run: ${chiTiet}`,
        `命令未运行：${chiTiet}`,
      );
    case "CMD_TIMEOUT":
      return w(
        lang,
        `Lệnh bị GIẾT vì quá hạn (${chiTiet}). Đầu ra dưới đây là một BẢN CẮT — nó KHÔNG phải kết luận "lệnh chạy xong" hay "mã nguồn có/không có lỗi".`,
        `The command was KILLED on timeout (${chiTiet}). The output below is PARTIAL — it is not a verdict on the code.`,
        `命令因超时被终止（${chiTiet}）。以下输出是部分结果，不构成对代码的结论。`,
      );
    default: {
      /**
       * ★★★ 2026-08-23 — **`default` TỪNG DÍNH LIỀN `case "CMD_TIMEOUT"`, VÀ NÓ ĐÃ NÓI DỐI THẬT.**
       * Thêm `CMD_GOC_THIEU_PACKAGE_JSON` mà chưa viết câu cho nó ⇒ lượt từ chối rơi vào nhánh
       * chung và người dùng đọc được *"Lệnh bị GIẾT vì quá hạn"* cho một lệnh **chưa hề chạy** —
       * bắt được ở nghiệm thu live, không lưới nào phát biểu (lưới chỉ so `r.ma`, không đọc câu chữ).
       * ⇒ Tách ra, và `never` biến "quên viết câu" từ **lời nói dối lúc chạy** thành **lỗi biên dịch**:
       *   thêm một mã vào `MA_TU_CHOI_LENH` mà không thêm `case` ở đây thì `npm run check` ĐỎ.
       * ⚠ Vẫn trả về một câu (không `throw`): một lời từ chối mà làm sập tiến trình còn tệ hơn.
       */
      const chuaKhai: never = ma;
      return w(
        lang,
        `Lệnh bị từ chối (${String(chuaKhai)}): ${chiTiet}`,
        `The command was refused (${String(chuaKhai)}): ${chiTiet}`,
        `命令被拒绝（${String(chuaKhai)}）：${chiTiet}`,
      );
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PREVIEW — PHÁN QUYẾT + MÔ TẢ. **KHÔNG CHẠY GÌ.**
// ══════════════════════════════════════════════════════════════════════════════════════════════
function tomTat(p: ThamSo, lang: ToolLang): string {
  return w(
    lang,
    `Chạy lệnh "${p.command ?? ""}" trong thư mục repo (danh sách TRẮNG, không mạng, môi trường đã lọc).`,
    `Run "${p.command ?? ""}" in the repo directory (allowlisted, no network, filtered environment).`,
    `在仓库目录运行 "${p.command ?? ""}"（白名单、无网络、已过滤环境）。`,
  );
}

async function xemTruoc(p: ThamSo, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const chan = (msg: string): ActionPreview => {
    warnings.push(msg);
    return { entityType: "repo_command", entityName: String(p.command ?? ""), changes: [], warnings, humanSummary: tomTat(p, ctx.lang) };
  };

  // doc 79 TRỤC 2 — gốc dự án đang chọn (server-authoritative), mặc định repo.
  const goc = ctx.projectRoot ?? gocHopCat();
  const tach = tachArgv(p.command);
  if (!tach.ok) return chan(cauTuChoiLenh(tach.ma, tach.chiTiet, ctx.lang));
  const pq = phanQuyetLenh(tach.argv, goc);
  if (!pq.ok) return chan(cauTuChoiLenh(pq.ma, pq.chiTiet, ctx.lang));

  const hanGio = hanGioThucTe(pq.hanGioMs, p.timeoutMs);

  /**
   * ★★★ 2026-08-20 — **CẢNH BÁO GHI ĐĨA ĐỨNG ĐẦU DANH SÁCH, TRƯỚC MỌI CẢNH BÁO KHÁC.**
   *
   * Trước lượt này thẻ duyệt có ĐÚNG bốn cảnh báo — thư mục chạy · hạn giờ giết cây · môi trường đã
   * lọc · đầu ra bị cắt — và **không dòng nào** nói rằng lệnh sắp bấm sẽ **ghi đè tệp mã nguồn**.
   * Người bấm "Duyệt" cho `dotnet format` đang duyệt một thay đổi **họ chưa từng nhìn thấy**: không
   * diff, không danh sách tệp, không cả một chữ "ghi".
   *
   * ⚠ Vị trí là **thứ nhất**, không phải thứ năm, có chủ đích: `ConfirmActionCard` render mảng này
   *   theo thứ tự, và một câu quan trọng nằm dưới bốn câu thủ tục là một câu không được đọc.
   */
  if (pq.muc.ghiDia) {
    warnings.push(
      w(
        ctx.lang,
        `⚠⚠ LỆNH NÀY GHI ĐÈ TỆP MÃ NGUỒN dưới "${pq.oTuDo ?? goc}" — nó sửa và LƯU ĐÈ tại chỗ mọi tệp khớp (với dotnet format là mọi tệp .cs), không hỏi lại. Ba hàng rào của đường ghi tệp (apply_diff) KHÔNG áp dụng ở đây: KHÔNG kiểm tệp có thay đổi chưa commit · KHÔNG so băm chống ghi nhầm phiên bản (TOCTOU) · KHÔNG có diff để bạn xem trước. Hãy commit hoặc stash phần đang làm dở TRƯỚC khi duyệt; muốn xem nó đã đổi gì thì chạy "git diff" SAU.`,
        `⚠⚠ THIS COMMAND OVERWRITES SOURCE FILES under "${pq.oTuDo ?? goc}" — it rewrites every matching file in place (for dotnet format, every .cs file) without asking again. The three guardrails of the file-write path (apply_diff) do NOT apply here: NO uncommitted-changes check · NO content-hash TOCTOU check · NO diff to review beforehand. Commit or stash your work-in-progress BEFORE approving; run "git diff" AFTER to see what changed.`,
        `⚠⚠ 此命令会覆盖源代码文件（位于 "${pq.oTuDo ?? goc}"）——它会就地重写每个匹配文件（dotnet format 即所有 .cs 文件），且不再询问。文件写入通道（apply_diff）的三道防线在此均不适用：不检查未提交改动 · 不做内容哈希 TOCTOU 校验 · 没有可预览的差异。请在批准前先提交或暂存进行中的工作；批准后可用 "git diff" 查看改动。`,
      ),
    );
    if (congGhiDiaBat()) {
      warnings.push(
        w(
          ctx.lang,
          `Cổng bổ sung ĐANG BẬT (AI_REPO_EXEC_GHIDIA_DOI_CANEDIT=1): lượt chạy này còn đòi quyền "${QUYEN_GHI_THEM.module}/${QUYEN_GHI_THEM.action}" ngoài "${QUYEN.module}/${QUYEN.action}". Thiếu nó thì lượt duyệt sẽ bị TỪ CHỐI lúc chạy.`,
          `Extra gate is ON (AI_REPO_EXEC_GHIDIA_DOI_CANEDIT=1): this run additionally requires "${QUYEN_GHI_THEM.module}/${QUYEN_GHI_THEM.action}" on top of "${QUYEN.module}/${QUYEN.action}". Without it the approved run will be REFUSED at execution time.`,
          `附加权限门已开启（AI_REPO_EXEC_GHIDIA_DOI_CANEDIT=1）：本次运行除 "${QUYEN.module}/${QUYEN.action}" 外还需要 "${QUYEN_GHI_THEM.module}/${QUYEN_GHI_THEM.action}"。缺少该权限时，即使批准也会在执行阶段被拒绝。`,
        ),
      );
    }
  }

  warnings.push(w(ctx.lang, `Thư mục chạy: ${goc}`, `Working directory: ${goc}`, `工作目录：${goc}`));
  warnings.push(
    w(
      ctx.lang,
      `Hạn giờ ${hanGio} ms — quá hạn thì CẢ CÂY tiến trình con bị giết (taskkill /T trên Windows, kill nhóm trên POSIX), không chỉ tiến trình cha.`,
      `Timeout ${hanGio} ms — on expiry the WHOLE child process tree is killed, not just the direct child.`,
      `超时 ${hanGio} 毫秒——超时将终止整个子进程树，而不仅是直接子进程。`,
    ),
  );
  warnings.push(
    w(
      ctx.lang,
      `Biến môi trường ĐÃ LỌC: tiến trình con KHÔNG nhận DATABASE_URL / MASTER_API_KEY / ANH_KY_SECRET hay bất kỳ biến ứng dụng nào. ⚠ Hệ quả: một ca kiểm thử cần CSDL sẽ HỎNG ở đây — đó là chiều hỏng đã chọn, không phải sự cố.`,
      `Environment is FILTERED: the child gets no application secrets. ⚠ Consequence: a DB-backed test WILL fail here — that is the chosen failure direction.`,
      `环境变量已过滤：子进程拿不到任何应用密钥。⚠ 因此依赖数据库的测试将在此失败——这是刻意选择的失败方向。`,
    ),
  );
  warnings.push(
    w(
      ctx.lang,
      `Đầu ra bị cắt ở ${TRAN_DAU_RA} byte (giữ ĐẦU và CUỐI, khai số byte bỏ giữa) và đi qua một lớp che bí mật.`,
      `Output is capped at ${TRAN_DAU_RA} bytes (head + tail kept, middle declared) and passes a secret-redaction layer.`,
      `输出上限 ${TRAN_DAU_RA} 字节（保留头尾并声明中间省略量），并经过密钥脱敏。`,
    ),
  );

  const changes: AuditChangeField[] = [
    { field: "command", oldValue: null, newValue: pq.nhan, displayName: w(ctx.lang, "Lệnh (danh sách trắng)", "Command (allowlisted)", "命令（白名单）") },
    { field: "argv", oldValue: null, newValue: [pq.spec.file, ...pq.spec.args].join(" "), displayName: w(ctx.lang, "argv THẬT sẽ chạy", "Actual argv", "实际 argv") },
    { field: "cwd", oldValue: null, newValue: goc, displayName: w(ctx.lang, "Thư mục", "Directory", "目录") },
    /**
     * ⚠ Giá trị là **mã máy đọc được**, không phải câu tiếng Việt: nó đi vào `ai_pending_actions.
     * previewJson` + sổ audit, tức bị đọc lại bởi mã và bởi người sau nhiều tháng. Ghim một ngôn ngữ
     * vào DỮ LIỆU là đúng lỗi mà nhãn phiên (`nhanTuLuot`) đã tránh. `displayName` mới đa ngữ.
     */
    {
      field: "ghiDia",
      oldValue: null,
      newValue: pq.muc.ghiDia ? "ghi_de_ma_nguon" : "chi_hoi_kiem_tra",
      displayName: w(ctx.lang, "Có ghi đè mã nguồn?", "Overwrites source?", "是否覆盖源码？"),
    },
    { field: "timeoutMs", oldValue: null, newValue: String(hanGio), displayName: w(ctx.lang, "Hạn giờ (ms)", "Timeout (ms)", "超时（毫秒）") },
  ];

  return { entityType: "repo_command", entityName: pq.nhan, changes, warnings, humanSummary: tomTat(p, ctx.lang) };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TOOL
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface DuLieuChay {
  command: string | null;
  argv: string[] | null;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number | null;
  bytes: number | null;
  truncated: boolean;
  redacted: boolean;
  output: string | null;
}

const RONG: DuLieuChay = {
  command: null, argv: null, exitCode: null, signal: null, timedOut: false,
  durationMs: null, bytes: null, truncated: false, redacted: false, output: null,
};

export const runCommandTool: Tool<ThamSo, DuLieuChay> = {
  name: "run_command",
  description:
    "Chạy MỘT lệnh trong DANH SÁCH TRẮNG ở thư mục repo nền tảng để lấy kết quả THẬT (kiểm kiểu, chạy lưới, trạng thái git, build/test dự án thử). " +
    "Được phép: `npm run check` · `npm run check:tests` · `npx vitest run <đường-dẫn>` · `git status` · `git diff` · " +
    "`dotnet build <đường>` · `dotnet test <đường>` · `dotnet format <đường>` · `node --test <đường>` (đường qua hộp cát). " +
    "⚠ TÁM lệnh chỉ HỎI/KIỂM TRA; riêng `dotnet format <đường>` GHI ĐÈ mọi tệp .cs dưới đường đó (không có diff xem trước, không kiểm tệp bẩn, không băm TOCTOU) — chỉ đề xuất nó khi người dùng thật sự xin ĐỊNH DẠNG LẠI mã. " +
    "Mọi lệnh khác bị TỪ CHỐI (danh sách TRẮNG, không phải danh sách đen); git checkout/git reset/rm KHÔNG BAO GIỜ được phép. " +
    "WRITE-ACTION (HITL): chỉ ĐỀ XUẤT, người dùng phải XÁC NHẬN mới chạy; quyền ai_repo_exec/canCreate. " +
    "Không shell, không nối lệnh, có hạn giờ giết CẢ CÂY tiến trình, đầu ra bị cắt, môi trường ĐÃ LỌC nên " +
    "tiến trình con KHÔNG có DATABASE_URL/khoá bí mật (⇒ ca kiểm thử cần CSDL sẽ hỏng ở đây).",
  parameters: thamSo,
  /**
   * ⚠ Write tool **không** được `findToolByTriggers` chọn (`chonDuocTheoTrigger` loại
   * `kind:"write"`); trigger ở đây chỉ đi vào bản kê tool đưa cho bộ định tuyến LLM. Vẫn viết cho
   * đúng ngữ nghĩa, và cố ý **rời nhau** với `compile_program`/`syntax_check_program` (miền PLC):
   * không dùng cụm "biên dịch chương trình" hay "kiểm tra cú pháp".
   */
  triggers: [
    "chạy lệnh", "chạy test", "chạy kiểm tra kiểu", "chạy lưới", "npm run", "npx vitest",
    "kiểm kiểu", "git status", "git diff", "run command", "run tests", "type check",
    "dotnet build", "dotnet test", "dotnet format", "node --test", "chạy build", "chạy dotnet",
    "运行命令", "运行测试", "类型检查",
  ],
  kind: "write",
  requiredPermission: QUYEN,
  summarize: tomTat,
  preview: xemTruoc,
  /**
   * ★ HARD GATE (phòng vệ theo chiều sâu): `args` tới đây từ **hàng `ai_pending_actions`**
   * (`confirmAction`), không phải từ `preview`. Nên cả hai lớp phán quyết chạy **LẠI** ở đây —
   * cùng kỷ luật `writeHandlers/programmingFile.ts:execute` re-chứng minh `confineTarget`.
   */
  execute: async (p, ctx) => {
    const title = w(ctx.lang, "Chạy lệnh trong repo", "Run command in repo", "在仓库中运行命令");
    const napLoi = (ma: MaTuChoiLenh, chiTiet: string, data: DuLieuChay) => {
      const cau = cauTuChoiLenh(ma, chiTiet, ctx.lang);
      /**
       * ★★★ 2026-08-23 — NHÁNH CUỐI TỪNG LÀ `case "CMD_TIMEOUT": default:` DÙNG CHUNG. Đo được ở
       * nghiệm thu live: một lượt từ chối vì `CMD_GOC_THIEU_PACKAGE_JSON` hiện lên màn hình là
       * **`[CMD_TIMEOUT]`** — lệnh chưa hề chạy mà nhãn nói nó bị giết vì quá hạn. Câu chữ sai ở
       * `cauTuChoiLenh`, NHÃN sai ở đây: hai chỗ khác nhau, cùng một cơ chế.
       *
       * ⚠⚠ VÌ SAO KHÔNG GỌN LẠI THÀNH `note: ma` (đã thử, và **census bắt được**):
       *   `toolNoteCensus` soi **VĂN BẢN** để liệt kê mọi nhãn người dùng có thể thấy. Viết `note: ma`
       *   thì nhãn vẫn đúng lúc chạy nhưng census hoá mù — nó báo *"mã không còn ai sinh ra"* cho cả
       *   năm mã. Gọn hơn mà mất một phép đo là đổi sai chiều.
       * ⇒ Giữ chữ cho census đọc được, và đóng cái bẫy bằng `never`: thêm mã vào `MA_TU_CHOI_LENH`
       *   mà quên nhánh ở đây thì `npm run check` ĐỎ, thay vì lặng lẽ mang nhãn của người khác.
       */
      switch (ma) {
        case "CMD_METACHAR":
          return { type: KIEU, title, data, note: "CMD_METACHAR", textSummary: cau };
        case "CMD_NOT_ALLOWED":
          return { type: KIEU, title, data, note: "CMD_NOT_ALLOWED", textSummary: cau };
        case "CMD_ARG_PATH_REJECTED":
          return { type: KIEU, title, data, note: "CMD_ARG_PATH_REJECTED", textSummary: cau };
        case "CMD_RESOLVE_ERROR":
          return { type: KIEU, title, data, note: "CMD_RESOLVE_ERROR", textSummary: cau };
        case "CMD_SPAWN_ERROR":
          return { type: KIEU, title, data, note: "CMD_SPAWN_ERROR", textSummary: cau };
        case "CMD_GOC_THIEU_PACKAGE_JSON":
          return { type: KIEU, title, data, note: "CMD_GOC_THIEU_PACKAGE_JSON", textSummary: cau };
        case "CMD_TIMEOUT":
          return { type: KIEU, title, data, note: "CMD_TIMEOUT", textSummary: cau };
        default: {
          const chuaKhai: never = ma;
          return { type: KIEU, title, data, note: String(chuaKhai), textSummary: cau };
        }
      }
    };

    // doc 79 TRỤC 2 — cùng gốc dự án với preview (ctx.projectRoot dựng lại ở confirmAction).
    const goc = ctx.projectRoot ?? gocHopCat();
    const tach = tachArgv(p.command);
    if (!tach.ok) return napLoi(tach.ma, tach.chiTiet, RONG);
    const pq = phanQuyetLenh(tach.argv, goc);
    if (!pq.ok) return napLoi(pq.ma, pq.chiTiet, { ...RONG, command: tach.argv.join(" ") });

    /**
     * ★★★ (D) CỔNG BỔ SUNG CHO MỤC `ghiDia` — **MẶC ĐỊNH TẮT, HỎI CỜ TRƯỚC.**
     *
     * Thứ tự hai vế của phép `&&` là có tải trọng: `congGhiDiaBat()` đứng TRƯỚC nên khi cờ tắt
     * (mặc định) **không một lượt `checkPermission` phụ nào xảy ra** — không thêm truy vấn, không
     * thêm bề mặt hỏng, và đường chạy hiện tại không đổi một byte.
     *
     * ⚠ FAIL-CLOSED: `checkPermission` NÉM ⇒ TỪ CHỐI, không phải "coi như có quyền". Cùng luật với
     *   `readToolRbac` ("RBAC hỏng không được biến thành cửa mở").
     */
    if (canDoiBitGhiThem(pq.muc)) {
      let duoc = false;
      try {
        duoc = await checkPermission(ctx.user.id, ctx.user.role, QUYEN_GHI_THEM.module, QUYEN_GHI_THEM.action as any);
      } catch {
        duoc = false;
      }
      if (!duoc) {
        return {
          type: KIEU,
          title,
          data: { ...RONG, command: pq.nhan },
          note: "EXEC_WRITE_NEEDS_EDIT_BIT",
          textSummary: w(
            ctx.lang,
            `Lệnh "${pq.nhan}" GHI ĐÈ TỆP MÃ NGUỒN, nên ngoài quyền "${QUYEN.module}/${QUYEN.action}" (chạy lệnh) nó còn đòi quyền "${QUYEN_GHI_THEM.module}/${QUYEN_GHI_THEM.action}" (AI ghi/sửa tệp) — bạn chưa có quyền ấy. Đây là TỪ CHỐI VÌ THIẾU QUYỀN, không phải lệnh sai: lệnh CHƯA chạy và không một byte nào bị đổi. Lý do tách hai bit: cấp quyền CHẠY không được lặng lẽ kéo theo quyền GHI ĐÈ mã nguồn.`,
            `Command "${pq.nhan}" OVERWRITES SOURCE FILES, so on top of "${QUYEN.module}/${QUYEN.action}" (run a command) it also requires "${QUYEN_GHI_THEM.module}/${QUYEN_GHI_THEM.action}" (AI writes/edits files) — which you do not have. This is a PERMISSION refusal, not a bad command: nothing ran and no byte changed. Rationale: granting "run" must not silently grant "overwrite source".`,
            `命令 "${pq.nhan}" 会覆盖源代码文件，因此除 "${QUYEN.module}/${QUYEN.action}"（运行命令）外，还需要 "${QUYEN_GHI_THEM.module}/${QUYEN_GHI_THEM.action}"（AI 写入/修改文件）权限——您当前没有该权限。这是权限拒绝而非命令错误：命令未运行，也没有任何字节被修改。理由：授予"运行"不应悄悄带来"覆盖源码"。`,
          ),
        };
      }
    }

    // ── NGÂN SÁCH: hỏi TRƯỚC khi sinh tiến trình. Hết ngân sách thì đầu ra không có đường ra, nên
    //    chạy một lượt 4 phút để rồi vứt đi là vô nghĩa. Cùng sổ với ba read tool của pha A.
    const khoa = khoaNganSach(ctx);
    const ns = nganSachConLai(khoa);
    if (ns.conLai <= 0) {
      return {
        type: KIEU,
        title,
        data: { ...RONG, command: pq.nhan },
        note: "BUDGET_EXCEEDED",
        textSummary: w(
          ctx.lang,
          `Phiên này đã rút hết ngân sách byte của hộp cát repo (${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}). Đây là một cái TRẦN, không phải một sự cố — lệnh CHƯA chạy. Hãy chờ cửa sổ ngân sách đặt lại.`,
          `This session has exhausted the repo sandbox byte budget (${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}). This is a CAP, not a fault — the command did NOT run.`,
          `本会话已用尽仓库沙箱字节预算（${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}）。这是上限而非故障——命令未运行。`,
        ),
      };
    }

    const hanGio = hanGioThucTe(pq.hanGioMs, p.timeoutMs);
    const kq = await chayLenhTrongHopCat(pq.spec, { hanGioMs: hanGio, goc });

    const data: DuLieuChay = {
      command: pq.nhan,
      argv: [pq.spec.file, ...pq.spec.args],
      exitCode: kq.maThoat,
      signal: kq.tinHieu,
      timedOut: kq.hetGio,
      durationMs: kq.msChay,
      bytes: kq.byteThat,
      truncated: kq.catBot,
      redacted: kq.daChe,
      output: kq.dauRa,
    };

    if (kq.ma === MA_TU_CHOI_LENH.CMD_SPAWN_ERROR) {
      return napLoi(MA_TU_CHOI_LENH.CMD_SPAWN_ERROR, kq.chiTiet, data);
    }

    const dau =
      `$ ${pq.nhan}\n` +
      w(ctx.lang, "mã thoát", "exit code", "退出码") +
      ` ${kq.maThoat ?? "—"}${kq.tinHieu ? ` (tín hiệu ${kq.tinHieu})` : ""} · ${kq.msChay} ms · ${kq.byteThat} byte` +
      (kq.catBot ? w(ctx.lang, " · ĐÃ CẮT", " · TRUNCATED", " · 已截断") : "") +
      (kq.daChe ? w(ctx.lang, " · CÓ chuỗi bí mật đã bị che", " · secrets redacted", " · 已脱敏") : "") +
      (kq.chuaXacNhanChet ? w(ctx.lang, " · ⚠ đã ra lệnh giết cây nhưng CHƯA quan sát được tiến trình thoát", " · ⚠ kill issued, exit NOT observed", " · ⚠ 已发出终止指令但未观察到退出") : "");

    if (kq.hetGio) {
      const than = `${cauTuChoiLenh(MA_TU_CHOI_LENH.CMD_TIMEOUT, `${hanGio} ms`, ctx.lang)}\n${dau}\n---\n${kq.dauRa}`;
      tieuNganSach(khoa, than.length);
      return { type: KIEU, title, data, note: "CMD_TIMEOUT", textSummary: than };
    }

    /**
     * ★★★ **MÃ THOÁT KHÁC 0 KHÔNG PHẢI MỘT `note`** — và đây là quyết định quan trọng nhất của file.
     *
     * Luật của cổng thứ tám (`toolKhongCoGiDeNoi`): *có `note` ⇒ CHẶN, trả nguyên văn `textSummary`
     * không qua LLM*. Một lượt `npm run check` trả về **mã 2 kèm 40 dòng lỗi kiểu** là một phát biểu
     * ĐẦY ĐỦ về hiện trường — nó **không** rỗng, **không** lỗi hệ, **không** bị từ chối, **không**
     * suy giảm. Đặt `note` cho nó là chặn đúng nhịp mà cả pha B tồn tại để nối: *"đọc lỗi THẬT rồi
     * sửa tiếp"* (doc 78 §2). ⇒ lượt chạy nào **thoát được** thì KHÔNG mang `note`, dù mã thoát là gì.
     * ⚠ Ngược lại, `CMD_TIMEOUT` **có** `note`: ở đó đầu ra là BẢN CẮT của một lệnh **chưa xong**, và
     * để model văn vẻ hoá nó là mời nó rút gọn thành *"build hỏng"* — biến một phép đo BỘ PHẬN thành
     * một khẳng định TOÀN THỂ (đúng lý lẽ đã dùng cho `GREP_DEADLINE` ở pha A).
     */
    const than = `${dau}\n---\n${kq.dauRa}`;
    tieuNganSach(khoa, than.length);
    return { type: KIEU, title, data, textSummary: than };
  },
};

registerTool(runCommandTool);
