/**
 * Doc 34 · P2 — AI Local Tools: PROGRAMMING file-WRITE handler (HITL, workspace-confined).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY (§5.2 — the ONLY write tool in the P2 programming set):
 *   - kind:'write' → routed ONLY through the HITL lifecycle (aiCopilotActions
 *     proposeAction → confirmAction; RBAC #1 at propose + #2 at execute + audit).
 *     The AI can ONLY propose a file write; a human must confirm. There is NO code
 *     path here that writes without a prior confirmAction (the orchestrator/index
 *     never calls tool.execute directly — mirrors writeHandlers/engineering.ts).
 *   - CONFINEMENT: both preview() and execute() go through the SINGLE shared door in
 *     readToolsProgramming.ts — confineTarget() + readConfined()/writeConfined(). That
 *     door rejects absolute paths, `..` traversal, anything escaping PROG_WORKSPACE_DIR,
 *     a target whose realpath leaves the root (symlink / NTFS junction), and any file
 *     with `nlink > 1` (NTFS HARD LINK — its realpath stays INSIDE the root, so no path
 *     check can see it). The nlink/isFile checks are made on the OPEN fd, so there is no
 *     stat-then-open race.
 *   - ⚠⚠ Pha 5 Task 1 (review C-1/C-2): this docstring used to claim "a file is NEVER
 *     written outside the workspace root" while execute() had NO nlink check at all —
 *     a reviewer measured a real overwrite of an out-of-workspace file that returned
 *     `ok: true`. And preview() was a SECOND READ PATH that leaked the same secrets
 *     BEFORE any human confirmation (into the Agent reply, ai_pending_actions.previewJson
 *     and the audit trail). Both are closed by routing through the shared door; the claim
 *     above is now backed by code instead of by hope.
 *   - preview() READS ONLY (loads the current file to diff) and NEVER mutates disk.
 *   - This tool NEVER writes to a device and NEVER deploys/runs code.
 *   - RBAC: machine_monitoring/canEdit (editing the programming workspace).
 * ════════════════════════════════════════════════════════════════════════════
 */

/**
 * ⚠⚠⚠ **KHÔNG import `node:fs` / `node:path` ở file này — CÓ CHỦ Ý.**
 * Sau bản vá C-1/C-2, file này **không còn một lượt chạm đĩa nào của riêng nó**: mọi byte vào/ra đi
 * qua `confineTarget` + `readConfined`/`writeConfined`. Thêm lại `import fs` ở đây gần như chắc chắn
 * là đang dựng **đường thoát thứ hai** — thứ đã đẻ ra đúng hai lỗ Critical mà file này vừa đóng.
 * ⚠ Lưới `programmingFileIo.census.test.ts` canh điều này bằng AST và sẽ ĐỎ kèm con trỏ file:dòng.
 */
import { z } from "zod";
import {
  registerTool,
  type ActionPreview,
  type Tool,
  type ToolExecContext,
  type ToolLang,
} from "../toolRegistry";
import type { AuditChangeField } from "../../auditTrailService";
import {
  confineTarget,
  readConfined,
  writeConfined,
  confinementRejectMsg,
  type ConfinementRejectReason,
} from "../readToolsProgramming";

// ─── i18n helper (vi/en/zh) ───────────────────────────────────────────────────
function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

/**
 * ⚠⚠ Bảng câu từ chối **KHÔNG còn chép ở đây**. Bản cũ giống bản của `readToolsProgramming.ts`
 * **từng byte** (khác đúng một alias kiểu) — và hai bản sao ấy là hình dạng nhẹ của đúng lớp lỗi
 * đã đẻ ra C-1/C-2: *"hai bản sao của một vị từ trùng nhau dưới một bất biến"*. Một bảng, một chủ.
 */

// Snippet length for the before/after diff surfaced in preview + audit.
const DIFF_SNIPPET_CHARS = 2000;
const LARGE_CONTENT_WARN = 200 * 1024; // warn (still allowed) above this size

function snippet(text: string | null): string | null {
  if (text == null) return null;
  return text.length > DIFF_SNIPPET_CHARS ? `${text.slice(0, DIFF_SNIPPET_CHARS)}\n…(${text.length} chars)` : text;
}

function notAFileMsg(lang: ToolLang): string {
  return w(lang, "Đường dẫn trỏ tới một thư mục — không thể ghi đè.", "Path points to a directory — cannot overwrite.", "路径指向一个目录——无法覆盖。");
}

// ─── write_project_file (machine_monitoring/canEdit) ──────────────────────────

const writeFileParams = z
  .object({
    path: z.string().min(1).max(1024),
    content: z.string().max(1_000_000),
  })
  .strict();
type WriteFileParams = z.infer<typeof writeFileParams>;

function summarizeWriteFile(p: WriteFileParams, lang: ToolLang): string {
  const bytes = Buffer.byteLength(p.content ?? "", "utf8");
  return w(
    lang,
    `Ghi file "${p.path}" (${bytes} byte) trong thư mục làm việc lập trình.`,
    `Write file "${p.path}" (${bytes} bytes) in the programming workspace.`,
    `在编程工作区写入文件 "${p.path}"（${bytes} 字节）。`,
  );
}

/**
 * ★★★ Pha 5 Task 1 (review, **C-1 Critical**) — **`preview()` LÀ MỘT ĐƯỜNG ĐỌC, VÀ NÓ CHẠY TRƯỚC HITL.**
 *
 * ⚠⚠⚠ Người review đo được: `preview.changes[1].oldValue = "SECRET_TOKEN=RVW-CANARY-…\nAWS_KEY=zzz\n"`
 * — nội dung một file **ngoài workspace**, lấy qua hard link. Lý lẽ *"tool này đòi HITL nên hạng
 * thấp hơn"* **SAI Ở VẾ HITL**: HITL canh `execute()`, còn rò xảy ra ở `preview()`, tức **TRƯỚC**
 * cổng ấy. Bí mật đi tới **BA đích không cần ai xác nhận** (`aiCopilotActions.ts`): trả thẳng về
 * Agent/UI (`:390`) · **ghi vào DB** `ai_pending_actions.previewJson` (`:284`) · **ghi vào sổ
 * audit** (`:309`). ⇒ bề mặt rò **RỘNG HƠN** N13 gốc (một sink → ba sink), và hai sink kia **lưu lại**.
 *
 * ⇒ Nay `preview` đi qua **đúng cái cửa** mà `read_project_file` đi qua. Khi cửa từ chối:
 * **KHÔNG đọc một byte nào**, `changes` **rỗng**, và cảnh báo nói **vì sao**.
 */
async function previewWriteFile(p: WriteFileParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const blocked = (msg: string): ActionPreview => {
    warnings.push(msg);
    return { entityType: "project_file", entityName: p.path, changes: [], warnings, humanSummary: summarizeWriteFile(p, ctx.lang) };
  };

  const confined = confineTarget(p.path);
  if (!confined.ok) {
    return blocked(confined.kind === "NOT_A_FILE" ? notAFileMsg(ctx.lang) : confinementRejectMsg(confined.reason, ctx.lang));
  }
  const { relPath, exists } = confined.target;

  // Nội dung hiện tại — CHỈ qua cửa. `readConfined` kiểm lại `nlink`/`isFile` trên chính fd.
  let currentContent: string | null = null;
  if (exists) {
    const rd = readConfined(confined.target, DIFF_SNIPPET_CHARS * 4);
    if (rd.ok) {
      currentContent = rd.content;
    } else if (rd.kind === "PATH_REJECTED") {
      return blocked(confinementRejectMsg(rd.reason, ctx.lang));
    } else if (rd.kind === "NOT_A_FILE") {
      return blocked(notAFileMsg(ctx.lang));
    }
    // NOT_FOUND / READ_ERROR: đích biến mất giữa chừng ⇒ coi như tạo mới, KHÔNG rò gì.
  }

  if (exists) {
    warnings.push(w(ctx.lang, `File đã tồn tại — sẽ GHI ĐÈ "${relPath}".`, `File exists — this will OVERWRITE "${relPath}".`, `文件已存在——将覆盖 "${relPath}"。`));
  } else {
    warnings.push(w(ctx.lang, `Sẽ tạo file mới "${relPath}".`, `Will create a new file "${relPath}".`, `将创建新文件 "${relPath}"。`));
  }
  const bytes = Buffer.byteLength(p.content ?? "", "utf8");
  if (bytes > LARGE_CONTENT_WARN) {
    warnings.push(w(ctx.lang, `Nội dung lớn (${bytes} byte).`, `Large content (${bytes} bytes).`, `内容较大（${bytes} 字节）。`));
  }

  const changes: AuditChangeField[] = [
    { field: "path", oldValue: exists ? relPath : null, newValue: relPath, displayName: "File" },
    { field: "content", oldValue: snippet(currentContent), newValue: snippet(p.content ?? ""), displayName: w(ctx.lang, "Nội dung", "Content", "内容") },
  ];

  return { entityType: "project_file", entityName: relPath, changes, warnings, humanSummary: summarizeWriteFile(p, ctx.lang) };
}

export const writeProjectFileTool: Tool<WriteFileParams, { ok: boolean; path: string | null; bytes: number }> = {
  name: "write_project_file",
  description:
    "Ghi/tạo một file NẰM TRONG thư mục làm việc lập trình (PROG_WORKSPACE_DIR). " +
    "WRITE-ACTION (HITL): xem trước diff → cần quyền machine_monitoring/canEdit + XÁC NHẬN của người dùng. " +
    "Từ chối đường dẫn tuyệt đối/'..'/thoát thư mục, và từ chối cả file có liên kết cứng (hard link) " +
    "vì nội dung của nó có thể nằm ngoài thư mục làm việc; KHÔNG BAO GIỜ ghi ra thiết bị.",
  parameters: writeFileParams,
  triggers: [
    "ghi file", "tạo file", "lưu file", "write file", "save file", "create file", "写文件", "保存文件",
  ],
  kind: "write",
  requiredPermission: { module: "machine_monitoring", action: "canEdit" },
  summarize: summarizeWriteFile,
  preview: previewWriteFile,
  /**
   * ★★★ Pha 5 Task 1 (review, **C-2 Critical**) — **GHI ĐÈ XUYÊN HARD LINK, RỒI TRẢ `ok: true`.**
   *
   * ⚠⚠⚠ Đo được: file `…\prod.env` **ngoài workspace** từ `SECRET_TOKEN=…` thành `PWNED-BY-REVIEWER`,
   * tool trả **`ok: true`, `note: undefined`**. Đó là lớp *"làm hỏng rồi BÁO CÁO THÀNH CÔNG"* — đã
   * là Critical của Pha 3 (giết nhầm tiến trình rồi khai `nvidia-smi` xác nhận).
   * ⚠ Nặng hơn ĐỌC ở ba trục: **không hoàn tác được** · ghi đè một file **được thứ khác chạy** biến
   * lỗ dữ liệu thành **lỗ thực thi** · và sau bản vá đọc thì `read_project_file` **cũng không đọc
   * lại được** file ấy (`nlink > 1`) ⇒ **không có đường khôi phục qua chính hệ**.
   */
  execute: async (p, ctx) => {
    const blocked = (msg: string, note: "PATH_REJECTED" | "NOT_A_FILE") => ({
      type: "action_result" as const,
      title: w(ctx.lang, "Ghi file bị chặn", "File write blocked", "文件写入已阻止"),
      data: { ok: false, path: null, bytes: 0 },
      textSummary: msg,
      note,
    });

    // HARD GATE (defense-in-depth): args come from the ai_pending_actions row
    // (confirmAction), so confinement is re-proven here — through the SAME door.
    const confined = confineTarget(p.path);
    if (!confined.ok) {
      return confined.kind === "NOT_A_FILE"
        ? blocked(notAFileMsg(ctx.lang), "NOT_A_FILE")
        : blocked(confinementRejectMsg(confined.reason, ctx.lang), "PATH_REJECTED");
    }

    const res = writeConfined(confined.target, p.content ?? "");
    if (!res.ok) {
      if (res.kind === "NOT_A_FILE") return blocked(notAFileMsg(ctx.lang), "NOT_A_FILE");
      if (res.kind === "PATH_REJECTED") return blocked(confinementRejectMsg(res.reason, ctx.lang), "PATH_REJECTED");
      return { type: "action_result", title: w(ctx.lang, "Ghi file thất bại", "File write failed", "文件写入失败"), data: { ok: false, path: null, bytes: 0 }, textSummary: res.message, note: "WRITE_ERROR" };
    }

    const rel = confined.target.relPath;
    return {
      type: "action_result",
      title: w(ctx.lang, `Đã ghi file "${rel}"`, `Wrote file "${rel}"`, `已写入文件 "${rel}"`),
      data: { ok: true, path: rel, bytes: res.bytes },
      textSummary: w(ctx.lang, `Đã ghi ${res.bytes} byte vào "${rel}".`, `Wrote ${res.bytes} bytes to "${rel}".`, `已向 "${rel}" 写入 ${res.bytes} 字节。`),
    };
  },
};

registerTool(writeProjectFileTool);
