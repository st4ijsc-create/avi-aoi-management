/**
 * ★★★ doc 79 · VÒNG TỰ ĐỘNG — **BƯỚC "CHẠY TEST"**: lượt chạy kiểm chứng KHÔNG cần người bấm.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ RANH GIỚI ĐÃ CHỐT VỚI CHỦ DỰ ÁN — ĐỌC TRƯỚC KHI SỬA MỘT DÒNG NÀO Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Vòng tự động vẫn giữ bạn duyệt mỗi lần GHI — cái được tự động hoá là chạy test → đọc lỗi →
 * đề xuất bản sửa tiếp, không phải quyền ghi đĩa."*
 *
 * File này là chỗ DUY NHẤT của vòng tự động được sinh một tiến trình. Nó bị bó bằng bốn ràng buộc,
 * và cả bốn đều đo được:
 *   1. **CHỈ `run_command`.** Tên tool là một hằng viết thẳng ở lời gọi `executeDecision` bên dưới;
 *      không có tham số nào, không có biến nào chọn tool. ⇒ `apply_diff` **không tới được** file này.
 *   2. **CHỈ TẬP CON KIỂM CHỨNG** của danh sách trắng (`NHAN_KIEM_CHUNG`). Đây KHÔNG phải bản sao
 *      danh sách trắng — nó tra `DANH_SACH_TRANG` rồi lọc theo `nhan`, nên một mục mới của pha B
 *      **không** tự động được vòng tự động chạy.
 *   3. **TRẦN LƯỢT** kiểm ở server, không chỉ ở client.
 *   4. **RBAC + hộp cát + môi trường đã lọc + hạn giờ + cắt đầu ra** — không có gì mới: lượt chạy đi
 *      qua ĐÚNG `executeDecision` → `proposeAction` → `confirmAction` mà người bấm nút vẫn đi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO `dotnet format` BỊ LOẠI KHỎI TẬP KIỂM CHỨNG — LỖ THẬT, KHÔNG PHẢI LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `DANH_SACH_TRANG` có chín mục và tám mục CHỈ HỎI. Mục thứ chín — `dotnet format <đường>` — **GHI
 * ĐÈ TỆP MÃ NGUỒN** theo `.editorconfig`. Nó nằm trong danh sách trắng là ĐÚNG (người bấm duyệt,
 * người biết mình xin gì). Nhưng nếu vòng TỰ ĐỘNG được phép chọn nó thì ta vừa dựng đúng cái đường
 * mà cả thiết kế này tồn tại để chặn: **byte rời ra đĩa mà không ai bấm duyệt.**
 * ⇒ `NHAN_KIEM_CHUNG` là DANH SÁCH TRẮNG THỨ HAI, hẹp hơn, và `verifySubset.test.ts` khẳng định
 *   `dotnet format` KHÔNG có trong đó — một đột biến thêm nó vào ⇒ ĐỎ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO PHÉP SUY LỆNH **KHÔNG BAO GIỜ** TỰ CHỌN `npm run check`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `npm run check` là `tsc --noEmit` toàn repo với heap 8 GB, trần 240 s. Một người vừa duyệt một
 * diff hai dòng trong một dự án demo mà máy tự nổ một lượt tsc bốn phút là **bất ngờ**, và bất ngờ
 * là cách nhanh nhất để người dùng tắt hẳn tính năng. ⇒ Phép SUY chỉ chọn lệnh **phạm vi dự án**
 * (`dotnet test <sln>` · `node --test <thư mục>`). Lệnh phạm vi repo vẫn chạy được — nhưng chỉ khi
 * người dùng **nêu đích danh** nó trong câu hỏi (nêu đích danh = đã đồng ý).
 */
import { DANH_SACH_TRANG, phanQuyetLenh, tachArgv } from "./aiLocalTools/repoCommandSandbox";
import { phanGiaiGoc } from "./aiLocalTools/repoProjects";
import { executeDecision, type ToolExecContext, type ToolLang } from "./aiLocalTools";
import { confirmAction, type CopilotUser } from "./aiCopilotActions";
import { docKetQuaTest, kepTranVong, type KetQuaTest } from "@shared/aiCodingLoop";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CỜ + TRẦN
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ★★★ `AI_CODING_AUTOLOOP` — vòng tự động sau khi người duyệt. **MẶC ĐỊNH TẮT.** Đặt `"1"` để bật.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO TẮT — NÓ VA VÀO MỘT BẤT BIẾN ĐÃ ĐƯỢC VIẾT RA CỦA CHÍNH REPO NÀY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `server/services/ai/autonomyPolicy.ts` xếp `run_command` vào `AUTONOMY_INELIGIBLE` kèm lý lẽ
 * NGUYÊN VĂN (doc 78 PHA B):
 *
 *   *"Danh sách trắng + hộp cát chặn được LỆNH NÀO được chạy; chúng KHÔNG phát biểu gì về BAO
 *   NHIÊU LƯỢT hay LÚC NÀO — và đó đúng là thứ tự trị quyết định. Một vòng lặp tác nhân tự trị gọi
 *   `npm run check` mỗi bước là một cách làm nghẽn máy chủ mà không lệnh nào trong đó 'sai'.
 *   ⇒ Con người bấm duyệt từng lượt. Không có cấu hình nào mở được điều này."*
 *
 * Cờ này **LÀ** một cấu hình mở được điều đó — qua một cửa KHÁC (nó không đi qua `evaluateAutonomy`,
 * nên denylist tự trị không hề được hỏi). Nói thẳng: đây là một NGOẠI LỆ có chủ ý với một bất biến
 * đã viết ra, và người duyệt ngoại lệ phải là chủ dự án, không phải mặc định của một tệp cấu hình.
 *
 * Ngoại lệ này trả lời ĐÚNG hai câu hỏi mà lý lẽ trên nêu ra — đó là điều kiện để nó tồn tại:
 *   • **BAO NHIÊU LƯỢT** — trần (mặc định 3, cứng 5), kiểm ở CẢ client LẪN server; cộng ba tín hiệu
 *     dừng-khi-không-tiến-bộ (`shared/aiCodingLoop.ts`).
 *   • **LÚC NÀO** — chỉ NGAY SAU khi một người vừa bấm duyệt một lượt ghi. Không có đường nào cho
 *     nó tự khởi động.
 *   • **`npm run check` mỗi bước** — chính kịch bản bị nêu tên: phép SUY không bao giờ chọn lệnh
 *     phạm vi repo; muốn chạy nó thì người dùng phải nêu đích danh.
 *   • Và tập lệnh HẸP HƠN cả `run_command`: `dotnet format` (mục duy nhất ghi đè tệp) bị loại.
 *
 * ⇒ **Chi phí của việc để TẮT là bằng 0**: mã server mới đằng nào cũng cần restart mới có hiệu lực,
 *   nên đặt `AI_CODING_AUTOLOOP=1` cùng lúc ấy không thêm một bước nào cho người vận hành.
 * `"0"`/vắng ⇒ vòng KHÔNG chạy và giao diện **nói ra** điều đó (im lặng là nói dối).
 */
export function vongTuDongBat(): boolean {
  return process.env.AI_CODING_AUTOLOOP === "1";
}

/** Trần số lượt, đọc env TẠI CHỖ GỌI (lưới lật env theo ca — không nhớ đệm ở tầng module). */
export function tranVongLap(): number {
  return kepTranVong(process.env.AI_CODING_AUTOLOOP_MAX);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DANH SÁCH TRẮNG THỨ HAI — TẬP CON "KIỂM CHỨNG"
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * `nhan` của những mục danh sách trắng mà vòng TỰ ĐỘNG được phép chạy.
 *
 * ⚠ Đây là các chuỗi `nhan` NGUYÊN VĂN của `DANH_SACH_TRANG` — `laLenhKiemChung` tra lại vào bảng
 * gốc, nên một lần đổi tên ở bảng gốc làm tập này rỗng và lưới ĐỎ (thay vì âm thầm cho qua tất cả).
 *
 * KHÔNG có mặt, mỗi cái một lý do khác nhau:
 *   • `dotnet format <đường-dẫn>` — **GHI ĐÈ MÃ NGUỒN** (xem khối ⚠⚠⚠ đầu file);
 *   • `git status` / `git diff`   — không phải phép kiểm chứng; chạy tự động chỉ tốn lượt mà không
 *     bao giờ trả lời được câu *"đã xanh chưa"*, tức vòng sẽ quay đủ trần rồi dừng vô ích.
 */
export const NHAN_KIEM_CHUNG: ReadonlySet<string> = new Set([
  "npm run check",
  "npm run check:tests",
  "npx vitest run <đường-dẫn>",
  "dotnet build <đường-dẫn>",
  "dotnet test <đường-dẫn>",
  "node --test <đường-dẫn>",
]);

/**
 * Tập con HẸP HƠN NỮA: những lệnh phép SUY được phép tự chọn. Lệnh phạm vi repo (`npm run check…`)
 * chỉ chạy khi người dùng nêu đích danh — xem khối ⚠⚠ đầu file.
 */
export const NHAN_SUY_DUOC: ReadonlySet<string> = new Set([
  "npx vitest run <đường-dẫn>",
  "dotnet test <đường-dẫn>",
  "node --test <đường-dẫn>",
]);

export type MaTuChoiKiemChung =
  | "AUTOLOOP_OFF"
  | "LOOP_CAP"
  | "PROJECT_NOT_FOUND"
  | "CMD_NOT_VERIFY"
  | "NO_VERIFY_CMD"
  | "NO_EXEC_CONTEXT"
  | "DENIED"
  | "RUN_FAILED";

export type PhanQuyetLenhKiemChung =
  | { ok: true; nhan: string; command: string }
  | { ok: false; ma: "CMD_NOT_VERIFY"; chiTiet: string };

/**
 * ★★★ CỬA PHÁN QUYẾT: chuỗi lệnh này có phải một lệnh KIỂM CHỨNG hợp lệ không.
 *
 * Chạy LẠI đúng hai lớp của pha B (`tachArgv` danh sách trắng ký tự → `phanQuyetLenh` khớp cấu
 * trúc + hộp cát đường dẫn) rồi mới hỏi câu thứ ba (`nhan ∈ NHAN_KIEM_CHUNG`). Không rút gọn lớp
 * nào: một lệnh do CLIENT gửi lên phải đi qua đủ ba lớp, nếu không thì client tự chọn được
 * `dotnet format` và cả thiết kế này vô nghĩa.
 */
export function laLenhKiemChung(command: unknown, goc?: string): PhanQuyetLenhKiemChung {
  const tach = tachArgv(command);
  if (!tach.ok) return { ok: false, ma: "CMD_NOT_VERIFY", chiTiet: `${tach.ma}: ${tach.chiTiet}` };
  // `goc` vắng (`undefined`) ⇒ `phanQuyetLenh` dùng mặc định `gocHopCat()` (đúng đường cũ của pha B).
  // ⚠ MỘT điểm gọi duy nhất, cố ý: `repoCommand.census.test.ts` §J đếm điểm gọi theo AST, và một
  //   nhánh ba ngôi ở đây sẽ mọc thành HAI dòng trong bản kiểm đếm mà không thêm một hàng rào nào.
  const pq = phanQuyetLenh(tach.argv, goc);
  if (!pq.ok) return { ok: false, ma: "CMD_NOT_VERIFY", chiTiet: `${pq.ma}: ${pq.chiTiet}` };
  if (!NHAN_KIEM_CHUNG.has(pq.muc.nhan)) {
    return { ok: false, ma: "CMD_NOT_VERIFY", chiTiet: pq.muc.nhan };
  }
  return { ok: true, nhan: pq.muc.nhan, command: tach.argv.join(" ") };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// SUY LỆNH KIỂM CHỨNG
// ══════════════════════════════════════════════════════════════════════════════════════════════
/** Một mục ở thư mục gốc dự án (đúng hình dạng `list_files` trả về). */
export interface MucGoc {
  path: string;
  kind: string;
}

export type KetQuaSuyLenh =
  | { ok: true; command: string; nguon: "cau_hoi" | "du_an" }
  | { ok: false; ma: "NO_VERIFY_CMD" };

/**
 * Trích một lệnh KIỂM CHỨNG mà người dùng **nêu đích danh** trong câu hỏi.
 * ⚠ Cố ý KHÔNG dùng lại `extractRunCommand` của `intentClassifier`: hàm ấy còn nhận `git status`/
 * `git diff` (đúng cho đường chat, SAI cho vòng tự động), và nhập nó vào đây sẽ buộc mọi thay đổi
 * của bộ định tuyến chat phải nghĩ tới vòng tự động. Hai việc khác nhau ⇒ hai vị từ.
 */
function lenhNeuDichDanh(cauHoi: string): string | null {
  const q = cauHoi ?? "";
  let m = q.match(/\bdotnet\s+(build|test)\s+([^\s"'`,;]+)/i);
  if (m) return `dotnet ${m[1]!.toLowerCase()} ${m[2]}`;
  m = q.match(/\bnode\s+--test\s+([^\s"'`,;]+)/i);
  if (m) return `node --test ${m[1]}`;
  m = q.match(/\bnpx\s+vitest\s+run\s+([^\s"'`,;]+)/i);
  if (m) return `npx vitest run ${m[1]}`;
  if (/\bnpm\s+run\s+check:tests\b/i.test(q)) return "npm run check:tests";
  if (/\bnpm\s+run\s+check\b/i.test(q)) return "npm run check";
  return null;
}

/** Tên tệp/thư mục ở gốc (list_files trả `path` tương đối với gốc dự án). */
function ten(m: MucGoc): string {
  const p = m.path.replace(/\\/g, "/");
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

/**
 * ★★★ SUY LỆNH — tất định, KHÔNG gọi model.
 *
 * Vì sao KHÔNG hỏi model: mỗi lượt gọi 30B là 30–75 s và một cơ hội nữa để nó bịa. Hình dạng "dự án
 * này chạy test bằng gì" đọc được từ MỘT lượt `list_files` đã có sẵn (persona lập trình vốn đã gọi
 * nó để dựng ngữ cảnh) — đây là dữ liệu, không phải suy luận.
 *
 * Thứ tự:
 *   1. Người dùng **nêu đích danh** một lệnh kiểm chứng ⇒ dùng nó (nêu đích danh = đã đồng ý, kể cả
 *      lệnh phạm vi repo).
 *   2. `*.sln` ở gốc            ⇒ `dotnet test <sln>`
 *   3. `*.csproj` ở gốc         ⇒ `dotnet test <csproj>`
 *   4. `package.json` + thư mục `test`/`tests` ⇒ `node --test <thư mục>`
 *   5. Không thì **NÓI THẲNG** `NO_VERIFY_CMD` — vòng không chạy, và giao diện khai lý do. Đoán bừa
 *      một lệnh ở đây là cách đốt 4 phút cho một câu trả lời không liên quan.
 */
export function suyLenhKiemChung(mucGoc: readonly MucGoc[], cauHoi = ""): KetQuaSuyLenh {
  const dichDanh = lenhNeuDichDanh(cauHoi);
  if (dichDanh) return { ok: true, command: dichDanh, nguon: "cau_hoi" };

  const tep = mucGoc.filter((m) => m.kind !== "dir");
  const thuMuc = mucGoc.filter((m) => m.kind === "dir");

  const sln = tep.find((m) => /\.sln$/i.test(ten(m)));
  if (sln) return { ok: true, command: `dotnet test ${sln.path}`, nguon: "du_an" };

  const csproj = tep.find((m) => /\.csproj$/i.test(ten(m)));
  if (csproj) return { ok: true, command: `dotnet test ${csproj.path}`, nguon: "du_an" };

  if (tep.some((m) => ten(m).toLowerCase() === "package.json")) {
    const thu = thuMuc.find((m) => ["test", "tests", "__tests__"].includes(ten(m).toLowerCase()));
    if (thu) return { ok: true, command: `node --test ${thu.path}`, nguon: "du_an" };
  }

  return { ok: false, ma: "NO_VERIFY_CMD" };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CHẠY MỘT LƯỢT KIỂM CHỨNG
// ══════════════════════════════════════════════════════════════════════════════════════════════
export interface YeuCauKiemChung {
  /** id dự án (danh sách TRẮNG). Vắng ⇒ gốc mặc định. **KHÔNG BAO GIỜ là một đường dẫn.** */
  projectId?: string;
  /** Lệnh client đề nghị (thường là lệnh đã suy ở lượt 1). Vắng ⇒ server tự suy. */
  command?: string;
  /** Lượt thứ mấy (1-based). Server kiểm trần — client không tự nới được. */
  luot: number;
  /** Câu hỏi gốc, để trích lệnh người dùng nêu đích danh. */
  cauHoi?: string;
}

export interface KetQuaKiemChung extends KetQuaTest {
  ok: boolean;
  ma: MaTuChoiKiemChung | null;
  /** Câu người-đọc-được khi `ok=false` (đã bản địa hoá ở tầng tool khi là từ chối RBAC/hộp cát). */
  message: string | null;
  /** Lệnh THẬT đã chạy (hoặc định chạy). */
  command: string | null;
  exitCode: number | null;
  timedOut: boolean;
  /** Đầu ra THẬT (đã cắt + che bí mật ở tầng hộp cát). */
  output: string | null;
  /** Trần lượt đang áp dụng — client hiện "lượt i/tran". */
  tran: number;
}

function rong(ma: MaTuChoiKiemChung, message: string | null, tran: number, command: string | null = null): KetQuaKiemChung {
  return {
    ok: false, ma, message, command,
    exitCode: null, timedOut: false, output: null,
    xanh: false, soDo: null, soXanh: null, tran,
  };
}

/**
 * ★★★ MỘT LƯỢT "CHẠY TEST" CỦA VÒNG TỰ ĐỘNG.
 *
 * ⚠⚠ Lượt chạy đi qua `executeDecision` → (write tool) → `proposeAction` → `confirmAction`. Ta
 * **không** rút ngắn đường đó: cùng RBAC hai lần, cùng hàng `ai_pending_actions`, cùng sổ audit,
 * cùng bộ chạy hộp cát. Thứ DUY NHẤT khác một lượt người bấm là **không có người bấm** — và điều
 * đó được ghi vào audit bằng đúng cơ chế đã có (`autonomy: { reason }` ⇒ `confirmedBy: "autonomy"`),
 * chứ không phải bằng một lượt chạy vô danh.
 *
 * ⚠ `apply_diff` KHÔNG tới được đây: tên tool ở lời gọi dưới là một HẰNG CHỮ.
 */
export async function chayKiemChung(
  y: YeuCauKiemChung,
  execCtx: ToolExecContext | undefined,
  user: CopilotUser,
  lang: ToolLang,
): Promise<KetQuaKiemChung> {
  const tran = tranVongLap();
  if (!vongTuDongBat()) return rong("AUTOLOOP_OFF", null, tran);
  if (!execCtx) return rong("NO_EXEC_CONTEXT", null, tran);
  if (!Number.isInteger(y.luot) || y.luot < 1 || y.luot > tran) return rong("LOOP_CAP", null, tran);

  const goc = phanGiaiGoc(y.projectId);
  if (!goc.ok) return rong("PROJECT_NOT_FOUND", null, tran);
  const ctx: ToolExecContext = goc.goc ? { ...execCtx, projectRoot: goc.goc } : execCtx;
  // Vắng projectId ⇒ `undefined` để `laLenhKiemChung` dùng `gocHopCat()` (đường cũ của pha B).
  const gocPhanQuyet = ctx.projectRoot;

  // ── 1) LỆNH: client đề nghị, hoặc server suy từ mục ở gốc dự án ───────────────────────────
  let lenh = typeof y.command === "string" && y.command.trim() !== "" ? y.command.trim() : null;
  if (lenh === null) {
    const lf = await executeDecision({ tool: "list_files", args: { depth: 1 } }, ctx);
    const entries = (lf.result?.data as { entries?: MucGoc[] } | undefined)?.entries ?? [];
    const suy = suyLenhKiemChung(entries, y.cauHoi ?? "");
    if (!suy.ok) return rong("NO_VERIFY_CMD", null, tran);
    lenh = suy.command;
  }

  // ── 2) PHÁN QUYẾT: ba lớp, kể cả khi lệnh do client gửi ───────────────────────────────────
  const pq = laLenhKiemChung(lenh, gocPhanQuyet);
  if (!pq.ok) return rong("CMD_NOT_VERIFY", pq.chiTiet, tran, lenh);

  // ── 3) ĐỀ XUẤT (đúng cửa HITL) ────────────────────────────────────────────────────────────
  const out = await executeDecision({ tool: "run_command", args: { command: pq.command } }, ctx);
  if (out.denied) return rong("DENIED", out.denied.message ?? null, tran, pq.command);
  if (!out.pendingAction) return rong("RUN_FAILED", out.error ?? null, tran, pq.command);

  // ── 4) XÁC NHẬN — không có người bấm, và audit GHI RÕ điều đó ─────────────────────────────
  const kq = await confirmAction(
    out.pendingAction.actionId,
    out.pendingAction.token,
    user,
    lang,
    execCtx.req,
    {},
    { reason: "AI_CODING_AUTOLOOP_VERIFY" },
  );
  if (!kq.ok) return rong("RUN_FAILED", kq.message ?? kq.status, tran, pq.command);

  const r = kq.result as
    | { textSummary?: string | null; note?: string | null; data?: { exitCode?: number | null; timedOut?: boolean; output?: string | null } }
    | null
    | undefined;
  const exitCode = r?.data?.exitCode ?? null;
  const timedOut = r?.data?.timedOut === true;
  const output = r?.textSummary ?? r?.data?.output ?? null;
  const doc = docKetQuaTest(output, exitCode, timedOut);

  return {
    ok: true,
    ma: null,
    message: r?.note ?? null,
    command: pq.command,
    exitCode,
    timedOut,
    output,
    tran,
    ...doc,
  };
}
