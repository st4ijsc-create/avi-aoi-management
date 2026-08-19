/**
 * ★★★ doc 78 · PHA C — **`apply_diff`: GHI TỆP REPO QUA NGƯỜI DUYỆT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PHA RỦI RO CAO NHẤT: tác nhân ghi THẲNG vào cây làm việc THẬT của repo đang phát triển. doc 78
 * §3: hỏng ở đây KHÔNG lộ dữ liệu — nó **PHÁ MÃ NGUỒN**. Vì thế tool này gánh BỐN hàng rào, và
 * **không hàng rào nào là tuỳ chọn**:
 *   1. HITL — `kind:"write"` ⇒ mọi lượt qua `proposeAction`/`confirmAction`; tool KHÔNG BAO GIỜ tự
 *      chạm đĩa. Người bấm duyệt, `confirmAction` mới gọi `execute` để ghi.
 *   2. HỘP CÁT — đường dẫn qua `phanQuyetDuongDan()` (pha A) + đuôi trong danh sách TRẮNG; ghi qua
 *      `writeConfined` (cửa đĩa DUY NHẤT đã tôi qua nhiều vòng đột biến, chống symlink/hard link/
 *      TOCTOU trên fd). KHÔNG viết cửa ghi thứ hai — `programmingFileIo.census.test.ts` cưỡng chế.
 *   3. TỆP BẨN — `git status --porcelain -- <tệp>` phải RỖNG (tệp không có thay đổi chưa commit).
 *      Chống đúng sự cố 2026-08-18: mất 123 dòng chưa commit vì một lượt hoàn nguyên đè lên.
 *   4. BĂM CHỐNG TOCTOU — băm nội dung tệp ở CẢ propose LẪN confirm, so với `original` model gửi;
 *      khác băm ⇒ TỪ CHỐI (tệp đã đổi dưới chân giữa lúc duyệt và lúc ghi).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ARGS LÀ `{ path, original, modified }` — KHÔNG PHẢI MỘT CHUỖI DIFF
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đây là ĐÚNG hợp đồng an toàn của `client/src/lib/diffHunks.ts` (`computeHunkPlan(original,
 * modified)` + `applyHunkSelection`): tác nhân gửi **thứ nó TIN rằng tệp đang là** (`original`, lấy
 * từ `read_file`) và **thứ nó muốn tệp thành** (`modified`). "Diff" là PHÉP CHIẾU từ hai chuỗi ấy,
 * dùng cho HIỂN THỊ (pha D dựng hunk bằng chính `diffHunks.ts`) — server chỉ cần GHI `modified`
 * sau khi đã CHỨNG MINH tệp thật đúng bằng `original`.
 *
 * Lằn ranh mà lựa chọn này khoá lại (doc 78 bẫy 2 — "diff áp vào tệp SAI phiên bản"): nếu `original`
 * KHÔNG khớp tệp thật thì tác nhân đang nhìn một phiên bản CŨ, và áp mù `modified` sẽ **hỏng câm**.
 * Ta bắt được bằng cách so **băm(tệp thật)** với **băm(original)** — nếu lệch, TỪ CHỐI, không ghi.
 * Đó cũng chính là băm dùng cho hàng rào TOCTOU: một điểm neo (`băm(original)`, nằm trong `argsJson`
 * nên đi được từ propose sang confirm), so lại ở cả hai đầu.
 *
 * ⚠ KHÔNG che bí mật trước khi so/ghi: ta đọc nội dung THẬT (không `redactSecretsOnly`) để băm khớp
 *   `original` và để không ghi đè một bí mật bằng chuỗi đã che. Nếu một tệp mã NGUỒN chứa thứ trông
 *   như bí mật, `read_file` (pha A) đã che khi tác nhân đọc ⇒ `original` mang chỗ che ⇒ băm LỆCH ⇒
 *   `BASE_MISMATCH` ⇒ TỪ CHỐI (fail-closed, an toàn). Tệp bí mật thật (`.env*`, khoá) đã bị
 *   `phanQuyetDuongDan` chặn từ tầng chính sách. Nội dung ĐEM RA hiển thị/audit thì VẪN qua một lớp
 *   che (bề mặt đi vào cửa sổ chat + sổ audit).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ RBAC — `ai_repo_read/canEdit` (mig 0330 đặt trước, mig 0332 cấp `canEdit=true`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỌC và GHI **cùng một đối tượng** (tệp trong repo) ⇒ **cùng module `ai_repo_read`, khác action**:
 * đọc = `canView` (pha A), ghi = `canEdit` (pha C). Khác `ai_repo_exec` của pha B (chạy lệnh — một
 * đối tượng KHÁC: tiến trình/CPU/thời gian máy). `checkPermission` được `proposeAction` gọi ở lúc
 * ĐỀ XUẤT và `confirmAction` gọi LẠI ở lúc CHẠY (vai có thể đổi giữa hai pha).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ `preview()` CHỈ PHÁN QUYẾT + MÔ TẢ — bài học C-1 của `writeHandlers/programmingFile.ts`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `preview()` chạy TRƯỚC cổng HITL, kết quả đi tới BA đích không cần ai xác nhận (Agent/UI ·
 * `ai_pending_actions.previewJson` · sổ audit). Nó ĐỌC tệp hiện tại để dựng diff + băm, và HỎI git
 * (chỉ-đọc) để báo trạng thái bẩn — nhưng nó **KHÔNG ghi một byte nào ra đĩa**. Phép ghi DUY NHẤT
 * (`writeConfined`) nằm trong `execute`, chạy SAU `confirmAction`.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { redactSecretsOnly } from "../../ai/aiSafety";
import {
  confineTargetUnder,
  readConfined,
  writeConfined,
  type ConfinedTarget,
} from "../readToolsProgramming";
import {
  MA_TU_CHOI_HOP_CAT,
  TRAN_BYTE_MOI_PHIEN,
  duoiDuocPhep,
  gocHopCat,
  nganSachConLai,
  phanQuyetDuongDan,
  tieuNganSach,
} from "../repoSandbox";
import { trangThaiGitCuaTep } from "../repoGitStatus";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";

/** Dùng lại `action_result` — không thêm thành viên nào vào `ToolResultType`. */
const KIEU = "action_result" as const;

/** ★ MỘT nguồn cho cả lời khai (`requiredPermission`) lẫn phép cưỡng chế (`proposeAction`). */
const QUYEN = { module: "ai_repo_read", action: "canEdit" } as const;

/** Trần đọc/ghi: đủ cho gần hết tệp mã nguồn; lớn hơn ⇒ không so khớp băm an toàn được ⇒ từ chối. */
const TRAN_TEP = 2_000_000;
/** Số ký tự trích cho diff hiển thị trong preview + audit. */
const TRICH = 2_000;

function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

/** Khoá sổ ngân sách byte — **cùng sổ, cùng hình dạng khoá** với read tool pha A và run_command. */
function khoaNganSach(ctx: ToolExecContext): string {
  return `u:${ctx.user.id}`;
}

function bam(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function trich(text: string): string {
  const che = redactSecretsOnly(text).text;
  return che.length > TRICH ? `${che.slice(0, TRICH)}\n…(${che.length} ký tự)` : che;
}

function demDong(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ MÁY-ĐỌC-ĐƯỢC — **0 dòng im lặng là nói dối**
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠ Mỗi mã một hành động khác nhau của người vận hành — đúng luật đã dùng ở pha A/B và `_uyQuyenAnh`.
 *   • `PATH_REJECTED`/`DENIED_SECRET`/`DENIED_DIR` — từ `phanQuyetDuongDan` (dùng lại nguyên mã pha A).
 *   • `DENIED_EXT`        — đuôi ngoài danh sách TRẮNG ⇒ không phải tệp mã nguồn để ghi.
 *   • `MISSING_REQUIRED_ARG` — thiếu `original`/`modified` ⇒ tác nhân chưa gửi đủ để dựng diff.
 *   • `NO_CHANGE`         — `original === modified` ⇒ không có gì để áp (không phải sự cố).
 *   • `NOT_A_FILE`        — đích là thư mục ⇒ không ghi đè.
 *   • `FILE_TOO_LARGE`    — tệp lớn hơn trần so-khớp ⇒ không băm khớp an toàn được.
 *   • `BASE_MISMATCH`     — băm(tệp thật) ≠ băm(original) ⇒ tác nhân nhìn phiên bản CŨ, hoặc tệp đã
 *                           đổi dưới chân giữa propose và confirm. KHÔNG áp mù.
 *   • `GIT_STATUS_FAILED` — không hỏi được git ⇒ KHÔNG chứng minh được tệp sạch ⇒ fail-closed.
 *   • `FILE_DIRTY`        — tệp có thay đổi CHƯA COMMIT ⇒ TỪ CHỐI (hàng rào cốt lõi của pha C).
 *   • `BUDGET_EXCEEDED`   — hết ngân sách byte của phiên ⇒ chờ, không phải hệ hỏng.
 *   • `WRITE_ERROR`       — cửa ghi (`writeConfined`) hỏng ⇒ lỗi hệ tệp thật.
 */
type MaApplyDiff =
  | "PATH_REJECTED"
  | "DENIED_SECRET"
  | "DENIED_DIR"
  | "DENIED_EXT"
  | "MISSING_REQUIRED_ARG"
  | "NO_CHANGE"
  | "NOT_A_FILE"
  | "FILE_TOO_LARGE"
  | "BASE_MISMATCH"
  | "GIT_STATUS_FAILED"
  | "FILE_DIRTY"
  | "BUDGET_EXCEEDED"
  | "WRITE_ERROR";

function cauTuChoi(ma: MaApplyDiff, chiTiet: string, lang: ToolLang): string {
  switch (ma) {
    case "PATH_REJECTED":
      return w(
        lang,
        `Đường dẫn bị hộp cát TỪ CHỐI (${chiTiet}). Hộp cát chặn: đường tuyệt đối, "..", ký tự NUL, đoạn dạng ổ đĩa "C:" ở BẤT KỲ vị trí nào, symlink/junction trỏ ra ngoài gốc, và tệp có nhiều liên kết cứng. Hãy dùng đường dẫn TƯƠNG ĐỐI so với thư mục repo.`,
        `Path rejected by the sandbox (${chiTiet}). Use a RELATIVE path inside the repo.`,
        `路径被沙箱拒绝（${chiTiet}）。请使用仓库内的相对路径。`,
      );
    case "DENIED_SECRET":
      return w(
        lang,
        `Tệp "${chiTiet}" nằm trong danh sách CẤM (bí mật: .env*, khoá riêng, chứng thư). Không ghi được vào đây — đây là thiết kế, không có đường vòng kể cả cho quản trị viên.`,
        `File "${chiTiet}" is on the secret denylist (.env*, private keys, certs). Writing here is forbidden by design.`,
        `文件 "${chiTiet}" 在禁止列表中（.env*、私钥、证书）。按设计不允许写入。`,
      );
    case "DENIED_DIR":
      return w(
        lang,
        `Đường dẫn "${chiTiet}" nằm trong một thư mục bị hộp cát loại trừ (node_modules, .git, dist, build, uploads…). Chỉ ghi được vào cây mã nguồn: server/, client/, shared/, drizzle/, scripts/.`,
        `Path "${chiTiet}" is inside an excluded directory (node_modules, .git, dist, build, uploads…).`,
        `路径 "${chiTiet}" 位于被排除的目录中（node_modules、.git、dist、build、uploads…）。`,
      );
    case "DENIED_EXT":
      return w(
        lang,
        `Phần mở rộng ${chiTiet} không nằm trong danh sách TRẮNG. apply_diff chỉ ghi tệp mã nguồn/cấu hình dạng văn bản (.ts/.tsx/.js/.json/.sql/.md/.css/.yml…); mọi đuôi khác bị từ chối theo mặc định.`,
        `Extension ${chiTiet} is not on the whitelist. apply_diff only writes source/config text files.`,
        `扩展名 ${chiTiet} 不在白名单中。apply_diff 仅写入源码/配置文本文件。`,
      );
    case "MISSING_REQUIRED_ARG":
      return w(
        lang,
        `Thiếu tham số bắt buộc (${chiTiet}). apply_diff cần CẢ "original" (nội dung tệp bạn đang nhìn, lấy từ read_file) LẪN "modified" (nội dung mong muốn).`,
        `Missing required argument (${chiTiet}). apply_diff needs BOTH "original" (current content from read_file) AND "modified".`,
        `缺少必填参数（${chiTiet}）。apply_diff 需要 "original"（read_file 的当前内容）和 "modified"。`,
      );
    case "NO_CHANGE":
      return w(
        lang,
        `"original" và "modified" GIỐNG HỆT nhau — không có thay đổi nào để áp cho "${chiTiet}".`,
        `"original" and "modified" are identical — nothing to apply for "${chiTiet}".`,
        `"original" 与 "modified" 完全相同——"${chiTiet}" 没有可应用的更改。`,
      );
    case "NOT_A_FILE":
      return w(
        lang,
        `"${chiTiet}" là một thư mục (hoặc không phải tệp thường) — không ghi đè được.`,
        `"${chiTiet}" is a directory (or not a regular file) — cannot overwrite.`,
        `"${chiTiet}" 是目录（或非常规文件）——无法覆盖。`,
      );
    case "FILE_TOO_LARGE":
      return w(
        lang,
        `Tệp "${chiTiet}" lớn hơn trần so-khớp (${TRAN_TEP} byte) nên KHÔNG băm khớp an toàn được. apply_diff dành cho tệp mã nguồn; một tệp lớn như vậy hầu như chắc chắn không phải thứ nên sửa qua đây.`,
        `File "${chiTiet}" exceeds the match cap (${TRAN_TEP} bytes) — cannot safely verify the base.`,
        `文件 "${chiTiet}" 超过匹配上限（${TRAN_TEP} 字节）——无法安全校验基线。`,
      );
    case "BASE_MISMATCH":
      return w(
        lang,
        `Nội dung tệp trên đĩa KHÔNG khớp "original" bạn gửi (${chiTiet}). Nghĩa là bạn đang nhìn một PHIÊN BẢN CŨ, hoặc tệp đã đổi kể từ lúc bạn đọc. Hãy đọc lại bằng read_file rồi dựng lại thay đổi trên nội dung MỚI NHẤT — TUYỆT ĐỐI không áp mù, vì áp một diff lên phiên bản sai sẽ hỏng câm.`,
        `On-disk content does NOT match your "original" (${chiTiet}). You are looking at a STALE version. Re-read with read_file and rebuild the change on the latest content.`,
        `磁盘内容与你的 "original" 不匹配（${chiTiet}）。你看的是旧版本。请用 read_file 重新读取后在最新内容上重建更改。`,
      );
    case "GIT_STATUS_FAILED":
      return w(
        lang,
        `Không hỏi được trạng thái git của "${chiTiet}". KHÔNG chứng minh được tệp có sạch hay không thì KHÔNG ghi (fail-closed) — một hàng rào không kiểm được thì không phải hàng rào.`,
        `Could not query git status for "${chiTiet}". Cannot prove the file is clean ⇒ refusing to write (fail-closed).`,
        `无法查询 "${chiTiet}" 的 git 状态。无法证明文件干净 ⇒ 拒绝写入（fail-closed）。`,
      );
    case "FILE_DIRTY":
      return w(
        lang,
        `Tệp "${chiTiet}" có thay đổi CHƯA COMMIT — TỪ CHỐI ghi đè. Đây là hàng rào cốt lõi của pha C: ngày 2026-08-18 một lượt hoàn nguyên đè lên đã xoá mất 123 dòng chưa commit. Hãy COMMIT (hoặc stash) thay đổi hiện có của tệp này trước, rồi đề xuất lại.`,
        `File "${chiTiet}" has UNCOMMITTED changes — refusing to overwrite. Commit or stash the current changes first, then propose again.`,
        `文件 "${chiTiet}" 有未提交的更改——拒绝覆盖。请先提交或暂存现有更改，再重新提议。`,
      );
    case "BUDGET_EXCEEDED":
      return w(
        lang,
        `Phiên này đã rút hết ngân sách byte của hộp cát repo (${chiTiet}). Đây là một cái TRẦN, không phải sự cố — tệp CHƯA bị ghi. Hãy chờ cửa sổ ngân sách đặt lại.`,
        `This session exhausted the repo sandbox byte budget (${chiTiet}). This is a CAP, not a fault — the file was NOT written.`,
        `本会话已用尽仓库沙箱字节预算（${chiTiet}）。这是上限而非故障——文件未被写入。`,
      );
    case "WRITE_ERROR":
    default:
      return w(
        lang,
        `Không ghi được tệp (lỗi hệ tệp): ${chiTiet}.`,
        `Failed to write the file (filesystem error): ${chiTiet}.`,
        `写入文件失败（文件系统错误）：${chiTiet}。`,
      );
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÁN QUYẾT — bốn hàng rào, dùng CHUNG cho `preview` VÀ `execute`
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface ThamSo {
  path: string;
  original: string;
  modified: string;
}

const thamSo = z
  .object({
    path: z.string().min(1).max(1024),
    original: z.string().max(TRAN_TEP),
    modified: z.string().max(TRAN_TEP),
  })
  .strict();

type PhanQuyet =
  | {
      ok: true;
      target: ConfinedTarget;
      relPath: string;
      hienTai: string;
      daCo: boolean;
      bamTruoc: string;
      bamSau: string;
    }
  | { ok: false; ma: MaApplyDiff; chiTiet: string };

/**
 * ★ Bốn hàng rào, theo đúng thứ tự (rẻ và không-I/O trước, sinh-tiến-trình sau):
 *   1. CHÍNH SÁCH đường dẫn (`phanQuyetDuongDan` + đuôi) — thuần, trước mọi I/O.
 *   2. THAM SỐ — có `original`/`modified` không, có khác nhau không.
 *   3. HỘP CÁT + ĐỌC RAW + BĂM — `confineTargetUnder` (realpath/nlink trên fd) → `readConfined` →
 *      băm(tệp thật) phải bằng băm(original). Bẫy "phiên bản sai" đóng ở đây.
 *   4. TỆP BẨN — `git status --porcelain -- <tệp>` phải rỗng.
 * ⚠ Cùng một hàm cho preview và execute ⇒ **không có đường nào tại confirm bỏ qua một hàng rào mà
 *   propose đã kiểm** — đó chính là điểm của hàng rào TOCTOU (kiểm LẠI tại confirm).
 */
async function phanQuyet(p: Partial<ThamSo>, goc: string): Promise<PhanQuyet> {
  // 1. CHÍNH SÁCH đường dẫn (dùng lại nguyên mã pha A).
  const maPath = phanQuyetDuongDan(p.path);
  if (maPath !== null) {
    const ma =
      maPath === MA_TU_CHOI_HOP_CAT.DENIED_SECRET
        ? "DENIED_SECRET"
        : maPath === MA_TU_CHOI_HOP_CAT.DENIED_DIR
          ? "DENIED_DIR"
          : "PATH_REJECTED";
    return { ok: false, ma, chiTiet: String(p.path ?? "") };
  }
  const ten = String(p.path).replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
  if (!duoiDuocPhep(ten)) {
    return { ok: false, ma: "DENIED_EXT", chiTiet: path.extname(ten) || "(không có đuôi)" };
  }

  // 2. THAM SỐ.
  if (typeof p.original !== "string" || typeof p.modified !== "string") {
    return { ok: false, ma: "MISSING_REQUIRED_ARG", chiTiet: "original + modified" };
  }
  if (p.original === p.modified) {
    return { ok: false, ma: "NO_CHANGE", chiTiet: String(p.path) };
  }

  // 3. HỘP CÁT + ĐỌC RAW + BĂM.
  const confined = confineTargetUnder(goc, p.path);
  if (!confined.ok) {
    if (confined.kind === "NOT_A_FILE") return { ok: false, ma: "NOT_A_FILE", chiTiet: String(p.path) };
    return { ok: false, ma: "PATH_REJECTED", chiTiet: confined.reason };
  }
  let hienTai = "";
  let daCo = false;
  if (confined.target.exists) {
    const rd = readConfined(confined.target, TRAN_TEP);
    if (rd.ok) {
      if (rd.truncated) return { ok: false, ma: "FILE_TOO_LARGE", chiTiet: confined.target.relPath };
      hienTai = rd.content;
      daCo = true;
    } else if (rd.kind === "NOT_FOUND") {
      hienTai = "";
      daCo = false;
    } else if (rd.kind === "NOT_A_FILE") {
      return { ok: false, ma: "NOT_A_FILE", chiTiet: confined.target.relPath };
    } else if (rd.kind === "PATH_REJECTED") {
      return { ok: false, ma: "PATH_REJECTED", chiTiet: rd.reason };
    } else {
      return { ok: false, ma: "WRITE_ERROR", chiTiet: rd.message };
    }
  }

  const bamTruoc = bam(hienTai);
  if (bamTruoc !== bam(p.original)) {
    return {
      ok: false,
      ma: "BASE_MISMATCH",
      chiTiet: `băm đĩa ${bamTruoc.slice(0, 12)}… ≠ băm original ${bam(p.original).slice(0, 12)}…${daCo ? "" : " (tệp chưa tồn tại nên original phải RỖNG cho một lượt TẠO)"}`,
    };
  }

  // 4. TỆP BẨN — hỏi git về ĐÚNG tệp này, với cwd = gốc DỰ ÁN đang chọn (doc 79 TRỤC 2).
  const git = await trangThaiGitCuaTep(confined.target.relPath, goc);
  if (!git.ok) return { ok: false, ma: "GIT_STATUS_FAILED", chiTiet: confined.target.relPath };
  if (!git.sach) return { ok: false, ma: "FILE_DIRTY", chiTiet: `${confined.target.relPath} [git: ${git.trangThai}]` };

  return {
    ok: true,
    target: confined.target,
    relPath: confined.target.relPath,
    hienTai,
    daCo,
    bamTruoc,
    bamSau: bam(p.modified),
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PREVIEW — PHÁN QUYẾT + MÔ TẢ. **KHÔNG GHI GÌ.**
// ══════════════════════════════════════════════════════════════════════════════════════════════
function tomTat(p: Partial<ThamSo>, lang: ToolLang): string {
  return w(
    lang,
    `Áp thay đổi vào tệp "${p.path ?? ""}" trong repo (qua người duyệt; kiểm tệp bẩn + băm chống TOCTOU).`,
    `Apply a change to "${p.path ?? ""}" in the repo (human-reviewed; dirty-file + TOCTOU-hash checks).`,
    `对仓库文件 "${p.path ?? ""}" 应用更改（需人工审核；脏文件 + TOCTOU 哈希校验）。`,
  );
}

async function xemTruoc(p: ThamSo, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  // doc 79 TRỤC 2 — gốc dự án đang chọn (server-authoritative qua `ctx.projectRoot`), mặc định repo.
  const goc = ctx.projectRoot ?? gocHopCat();
  const chan = (ma: MaApplyDiff): ActionPreview => {
    // Preview không REJECT được (nó luôn trả một ActionPreview) — nó KHAI ra, và `execute` cưỡng
    // chế. Đây là ĐÚNG khuôn `writeHandlers/repoCommand.xemTruoc`.
    warnings.push(cauTuChoi(ma, String((p as Partial<ThamSo>).path ?? ""), ctx.lang));
    return { entityType: "repo_file", entityName: String(p.path ?? ""), changes: [], warnings, humanSummary: tomTat(p, ctx.lang) };
  };

  const pq = await phanQuyet(p, goc);
  if (!pq.ok) return chan(pq.ma);

  warnings.push(
    w(
      ctx.lang,
      pq.daCo ? `Tệp SẠCH (không có thay đổi chưa commit) — sẽ GHI ĐÈ "${pq.relPath}".` : `Sẽ TẠO tệp mới "${pq.relPath}".`,
      pq.daCo ? `Clean file — will OVERWRITE "${pq.relPath}".` : `Will CREATE a new file "${pq.relPath}".`,
      pq.daCo ? `文件干净——将覆盖 "${pq.relPath}"。` : `将创建新文件 "${pq.relPath}"。`,
    ),
  );
  warnings.push(
    w(
      ctx.lang,
      `Băm TRƯỚC ${pq.bamTruoc.slice(0, 16)}… → SAU ${pq.bamSau.slice(0, 16)}… Băm này được so LẠI ở lúc bạn xác nhận: nếu tệp đổi giữa chừng, lượt ghi bị TỪ CHỐI.`,
      `sha256 BEFORE ${pq.bamTruoc.slice(0, 16)}… → AFTER ${pq.bamSau.slice(0, 16)}… Re-checked at confirm time.`,
      `sha256 前 ${pq.bamTruoc.slice(0, 16)}… → 后 ${pq.bamSau.slice(0, 16)}… 确认时会再次校验。`,
    ),
  );
  const soDongTruoc = demDong(pq.hienTai);
  const soDongSau = demDong(p.modified);
  warnings.push(w(ctx.lang, `${soDongTruoc} dòng → ${soDongSau} dòng.`, `${soDongTruoc} → ${soDongSau} lines.`, `${soDongTruoc} → ${soDongSau} 行。`));

  const changes: AuditChangeField[] = [
    { field: "path", oldValue: pq.daCo ? pq.relPath : null, newValue: pq.relPath, displayName: w(ctx.lang, "Tệp", "File", "文件") },
    { field: "sha256Before", oldValue: null, newValue: pq.bamTruoc, displayName: w(ctx.lang, "Băm TRƯỚC", "sha256 before", "前哈希") },
    { field: "sha256After", oldValue: null, newValue: pq.bamSau, displayName: w(ctx.lang, "Băm SAU", "sha256 after", "后哈希") },
    // ⚠ Trích ĐÃ CHE bí mật: bề mặt này đi vào Agent/UI + audit; xem khối ⚠ ở đầu file.
    { field: "content", oldValue: pq.daCo ? trich(pq.hienTai) : null, newValue: trich(p.modified), displayName: w(ctx.lang, "Nội dung", "Content", "内容") },
  ];

  return { entityType: "repo_file", entityName: pq.relPath, changes, warnings, humanSummary: tomTat(p, ctx.lang) };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TOOL
// ══════════════════════════════════════════════════════════════════════════════════════════════
interface DuLieuApDung {
  ok: boolean;
  path: string | null;
  bytes: number | null;
  created: boolean;
  sha256Before: string | null;
  sha256After: string | null;
}

const RONG: DuLieuApDung = { ok: false, path: null, bytes: null, created: false, sha256Before: null, sha256After: null };

export const applyDiffTool: Tool<ThamSo, DuLieuApDung> = {
  name: "apply_diff",
  description:
    "Áp một thay đổi vào MỘT tệp mã nguồn trong repo nền tảng. Tham số: `path` (tương đối), `original` " +
    "(nội dung tệp bạn đang nhìn — lấy từ read_file), `modified` (nội dung mong muốn). " +
    "WRITE-ACTION (HITL): chỉ ĐỀ XUẤT, người dùng phải XÁC NHẬN mới ghi; quyền ai_repo_read/canEdit. " +
    "HÀNG RÀO: (1) TỪ CHỐI nếu tệp có thay đổi CHƯA COMMIT (git status của đúng tệp đó); " +
    "(2) TỪ CHỐI nếu nội dung đĩa không khớp `original` (bạn đang nhìn phiên bản CŨ) — băm được so " +
    "LẠI ở lúc xác nhận để chặn tệp đổi dưới chân; (3) hộp cát chặn .env*/khoá/node_modules/.git/dist " +
    "và mọi đường thoát; (4) tạo tệp mới được, nhưng `original` khi ấy phải RỖNG. Ghi WORM mỗi lượt áp.",
  parameters: thamSo,
  /**
   * ⚠ Write tool KHÔNG được `findToolByTriggers` chọn (`chonDuocTheoTrigger` loại `kind:"write"`);
   * trigger chỉ đi vào bản kê tool đưa cho bộ định tuyến LLM. Cố ý RỜI NHAU với `write_project_file`
   * (miền workspace lập trình): không dùng cụm "ghi file"/"tạo file" trần.
   */
  triggers: [
    "sửa mã nguồn", "áp thay đổi", "vá mã nguồn", "sửa file trong repo", "chỉnh mã nguồn",
    "apply diff", "edit source", "patch file", "modify source file", "写入源码", "修改源码", "应用改动",
  ],
  kind: "write",
  requiredPermission: QUYEN,
  summarize: tomTat,
  preview: xemTruoc,
  /**
   * ★ HARD GATE (phòng vệ theo chiều sâu): `args` tới đây từ HÀNG `ai_pending_actions`
   * (`confirmAction`), KHÔNG phải từ preview. Nên **cả bốn hàng rào chạy LẠI ở đây** — đây chính là
   * "kiểm lại tại confirmAction" của doc 78 bẫy 1: git-status được hỏi LẠI (tệp có thể vừa bị sửa
   * tay trong 30 giây người duyệt cân nhắc), và băm(tệp thật) được so LẠI với băm(original) (tệp có
   * thể đã đổi/commit dưới chân). Chỉ khi cả bốn còn xanh mới có một byte rời cửa `writeConfined`.
   */
  execute: async (p, ctx) => {
    const title = w(ctx.lang, "Áp thay đổi vào tệp repo", "Apply change to repo file", "对仓库文件应用更改");
    const napLoi = (ma: MaApplyDiff, chiTiet: string) => {
      const cau = cauTuChoi(ma, chiTiet, ctx.lang);
      const data = { ...RONG, path: null };
      switch (ma) {
        case "PATH_REJECTED":
          return { type: KIEU, title, data, note: "PATH_REJECTED", textSummary: cau };
        case "DENIED_SECRET":
          return { type: KIEU, title, data, note: "DENIED_SECRET", textSummary: cau };
        case "DENIED_DIR":
          return { type: KIEU, title, data, note: "DENIED_DIR", textSummary: cau };
        case "DENIED_EXT":
          return { type: KIEU, title, data, note: "DENIED_EXT", textSummary: cau };
        case "MISSING_REQUIRED_ARG":
          return { type: KIEU, title, data, note: "MISSING_REQUIRED_ARG", textSummary: cau };
        case "NO_CHANGE":
          return { type: KIEU, title, data, note: "NO_CHANGE", textSummary: cau };
        case "NOT_A_FILE":
          return { type: KIEU, title, data, note: "NOT_A_FILE", textSummary: cau };
        case "FILE_TOO_LARGE":
          return { type: KIEU, title, data, note: "FILE_TOO_LARGE", textSummary: cau };
        case "BASE_MISMATCH":
          return { type: KIEU, title, data, note: "BASE_MISMATCH", textSummary: cau };
        case "GIT_STATUS_FAILED":
          return { type: KIEU, title, data, note: "GIT_STATUS_FAILED", textSummary: cau };
        case "FILE_DIRTY":
          return { type: KIEU, title, data, note: "FILE_DIRTY", textSummary: cau };
        case "BUDGET_EXCEEDED":
          return { type: KIEU, title, data, note: "BUDGET_EXCEEDED", textSummary: cau };
        case "WRITE_ERROR":
        default:
          return { type: KIEU, title, data, note: "WRITE_ERROR", textSummary: cau };
      }
    };

    // doc 79 TRỤC 2 — cùng gốc dự án với preview (ctx.projectRoot được dựng lại ở confirmAction từ
    // previewJson.__projectRoot, nên confirm chạy ĐÚNG gốc mà propose đã kiểm).
    const goc = ctx.projectRoot ?? gocHopCat();
    const pq = await phanQuyet(p, goc);
    if (!pq.ok) return napLoi(pq.ma, pq.chiTiet);

    // ── NGÂN SÁCH: byte GHI vào cùng sổ với read tool pha A + run_command. Hỏi TRƯỚC khi ghi.
    const khoa = khoaNganSach(ctx);
    const ns = nganSachConLai(khoa);
    if (ns.conLai <= 0) {
      return napLoi("BUDGET_EXCEEDED", `${ns.daDung}/${TRAN_BYTE_MOI_PHIEN}`);
    }

    // ── GHI qua cửa DUY NHẤT. `writeConfined` kiểm LẠI nlink/isFile trên chính fd (chống TOCTOU ở
    //    tầng đĩa) trước khi cắt một byte nào.
    const res = writeConfined(pq.target, p.modified);
    if (!res.ok) {
      if (res.kind === "NOT_A_FILE") return napLoi("NOT_A_FILE", pq.relPath);
      if (res.kind === "PATH_REJECTED") return napLoi("PATH_REJECTED", res.reason);
      return napLoi("WRITE_ERROR", res.message);
    }

    tieuNganSach(khoa, res.bytes);

    const data: DuLieuApDung = {
      ok: true,
      path: pq.relPath,
      bytes: res.bytes,
      created: !pq.daCo,
      sha256Before: pq.bamTruoc,
      sha256After: pq.bamSau,
    };
    return {
      type: KIEU,
      title: w(ctx.lang, `Đã áp thay đổi vào "${pq.relPath}"`, `Applied change to "${pq.relPath}"`, `已对 "${pq.relPath}" 应用更改`),
      data,
      textSummary: w(
        ctx.lang,
        `Đã ${pq.daCo ? "ghi đè" : "tạo"} "${pq.relPath}" (${res.bytes} byte). Băm ${pq.bamTruoc.slice(0, 12)}… → ${pq.bamSau.slice(0, 12)}….`,
        `${pq.daCo ? "Overwrote" : "Created"} "${pq.relPath}" (${res.bytes} bytes). sha256 ${pq.bamTruoc.slice(0, 12)}… → ${pq.bamSau.slice(0, 12)}….`,
        `已${pq.daCo ? "覆盖" : "创建"} "${pq.relPath}"（${res.bytes} 字节）。sha256 ${pq.bamTruoc.slice(0, 12)}… → ${pq.bamSau.slice(0, 12)}…。`,
      ),
    };
  },
};

registerTool(applyDiffTool);
