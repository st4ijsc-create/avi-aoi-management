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
 *   - CONFINEMENT: both preview() and execute() resolve the target through
 *     resolveWorkspacePath (shared with the read tool), which rejects absolute
 *     paths, `..` traversal, and anything that escapes PROG_WORKSPACE_DIR. execute()
 *     is the HARD gate: on a rejected/oob path it writes NOTHING and returns an
 *     honest failure — a file is NEVER written outside the workspace root.
 *   - preview() READS ONLY (loads the current file to diff) and NEVER mutates disk.
 *   - This tool NEVER writes to a device and NEVER deploys/runs code.
 *   - RBAC: machine_monitoring/canEdit (editing the programming workspace).
 * ════════════════════════════════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
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
  resolveWorkspacePath,
  programmingWorkspaceRoot,
  type WorkspaceRejectReason,
} from "../readToolsProgramming";

// ─── i18n helper (vi/en/zh) ───────────────────────────────────────────────────
function w(lang: ToolLang, vi: string, en: string, zh: string): string {
  return lang === "en" ? en : lang === "zh" ? zh : vi;
}

function rejectReasonMsg(reason: WorkspaceRejectReason, lang: ToolLang): string {
  switch (reason) {
    case "ABSOLUTE":
      return w(lang, "Đường dẫn tuyệt đối không được phép.", "Absolute paths are not allowed.", "不允许使用绝对路径。");
    case "TRAVERSAL":
      return w(lang, "Đường dẫn chứa '..' (thoát thư mục) bị từ chối.", "Path contains '..' (traversal) — rejected.", "路径包含 '..'（越界）——已拒绝。");
    case "ESCAPE":
      return w(lang, "Đường dẫn thoát khỏi thư mục làm việc bị từ chối.", "Path escapes the workspace root — rejected.", "路径越出工作区根目录——已拒绝。");
    case "NUL":
      return w(lang, "Đường dẫn chứa ký tự NUL không hợp lệ.", "Path contains an invalid NUL byte.", "路径包含无效的 NUL 字符。");
    case "EMPTY":
    default:
      return w(lang, "Đường dẫn trống hoặc không hợp lệ.", "Empty or invalid path.", "路径为空或无效。");
  }
}

// Snippet length for the before/after diff surfaced in preview + audit.
const DIFF_SNIPPET_CHARS = 2000;
const LARGE_CONTENT_WARN = 200 * 1024; // warn (still allowed) above this size

function snippet(text: string | null): string | null {
  if (text == null) return null;
  return text.length > DIFF_SNIPPET_CHARS ? `${text.slice(0, DIFF_SNIPPET_CHARS)}\n…(${text.length} chars)` : text;
}

/** Read current file content (capped) if it exists AND is a regular file. READ-ONLY. */
function readCurrentIfFile(absPath: string): { exists: boolean; content: string | null; isDir: boolean } {
  try {
    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) return { exists: true, content: null, isDir: true };
    if (!stat.isFile()) return { exists: true, content: null, isDir: false };
    const buf = fs.readFileSync(absPath);
    return { exists: true, content: buf.toString("utf8", 0, Math.min(buf.length, DIFF_SNIPPET_CHARS * 4)), isDir: false };
  } catch {
    return { exists: false, content: null, isDir: false };
  }
}

/** Best-effort symlink hardening: the parent dir's REAL path must stay inside the root. */
function parentRealpathContained(absPath: string): boolean {
  try {
    const parent = path.dirname(absPath);
    if (!fs.existsSync(parent)) return true; // will be created under the (contained) root
    const realRoot = fs.realpathSync(programmingWorkspaceRoot());
    const realParent = fs.realpathSync(parent);
    const rel = path.relative(realRoot, realParent);
    return rel === "" ? true : !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return true;
  }
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

async function previewWriteFile(p: WriteFileParams, ctx: ToolExecContext): Promise<ActionPreview> {
  const warnings: string[] = [];
  const resolved = resolveWorkspacePath(p.path);
  if (!resolved.ok || !resolved.absPath) {
    warnings.push(rejectReasonMsg(resolved.reason ?? "EMPTY", ctx.lang));
    return { entityType: "project_file", entityName: p.path, changes: [], warnings, humanSummary: summarizeWriteFile(p, ctx.lang) };
  }

  const current = readCurrentIfFile(resolved.absPath);
  if (current.isDir) {
    warnings.push(w(ctx.lang, "Đường dẫn trỏ tới một thư mục — không thể ghi đè.", "Path points to a directory — cannot overwrite.", "路径指向一个目录——无法覆盖。"));
  }
  if (!parentRealpathContained(resolved.absPath)) {
    warnings.push(rejectReasonMsg("ESCAPE", ctx.lang));
  }
  if (current.exists && !current.isDir) {
    warnings.push(w(ctx.lang, `File đã tồn tại — sẽ GHI ĐÈ "${resolved.relPath}".`, `File exists — this will OVERWRITE "${resolved.relPath}".`, `文件已存在——将覆盖 "${resolved.relPath}"。`));
  } else if (!current.exists) {
    warnings.push(w(ctx.lang, `Sẽ tạo file mới "${resolved.relPath}".`, `Will create a new file "${resolved.relPath}".`, `将创建新文件 "${resolved.relPath}"。`));
  }
  const bytes = Buffer.byteLength(p.content ?? "", "utf8");
  if (bytes > LARGE_CONTENT_WARN) {
    warnings.push(w(ctx.lang, `Nội dung lớn (${bytes} byte).`, `Large content (${bytes} bytes).`, `内容较大（${bytes} 字节）。`));
  }

  const changes: AuditChangeField[] = [
    { field: "path", oldValue: current.exists ? resolved.relPath ?? null : null, newValue: resolved.relPath ?? p.path, displayName: "File" },
    { field: "content", oldValue: snippet(current.content), newValue: snippet(p.content ?? ""), displayName: w(ctx.lang, "Nội dung", "Content", "内容") },
  ];

  return {
    entityType: "project_file",
    entityName: resolved.relPath ?? p.path,
    changes,
    warnings,
    humanSummary: summarizeWriteFile(p, ctx.lang),
  };
}

export const writeProjectFileTool: Tool<WriteFileParams, { ok: boolean; path: string | null; bytes: number }> = {
  name: "write_project_file",
  description:
    "Ghi/tạo một file NẰM TRONG thư mục làm việc lập trình (PROG_WORKSPACE_DIR). " +
    "WRITE-ACTION (HITL): xem trước diff → cần quyền machine_monitoring/canEdit + XÁC NHẬN của người dùng. " +
    "Từ chối đường dẫn tuyệt đối/'..'/thoát thư mục; KHÔNG BAO GIỜ ghi ra thiết bị.",
  parameters: writeFileParams,
  triggers: [
    "ghi file", "tạo file", "lưu file", "write file", "save file", "create file", "写文件", "保存文件",
  ],
  kind: "write",
  requiredPermission: { module: "machine_monitoring", action: "canEdit" },
  summarize: summarizeWriteFile,
  preview: previewWriteFile,
  execute: async (p, ctx) => {
    // HARD GATE (defense-in-depth): re-resolve at execute time. Args come from the
    // ai_pending_actions row (confirmAction), but we re-validate confinement anyway
    // and write NOTHING on any rejection.
    const resolved = resolveWorkspacePath(p.path);
    if (!resolved.ok || !resolved.absPath) {
      const msg = rejectReasonMsg(resolved.reason ?? "EMPTY", ctx.lang);
      return { type: "action_result", title: w(ctx.lang, "Ghi file bị chặn", "File write blocked", "文件写入已阻止"), data: { ok: false, path: null, bytes: 0 }, textSummary: msg, note: "PATH_REJECTED" };
    }
    // Reject overwriting a directory or a symlinked-out parent.
    try {
      const stat = fs.existsSync(resolved.absPath) ? fs.statSync(resolved.absPath) : null;
      if (stat && stat.isDirectory()) {
        return { type: "action_result", title: w(ctx.lang, "Ghi file bị chặn", "File write blocked", "文件写入已阻止"), data: { ok: false, path: null, bytes: 0 }, textSummary: w(ctx.lang, "Đường dẫn là thư mục.", "Path is a directory.", "路径是目录。"), note: "NOT_A_FILE" };
      }
    } catch {
      /* stat race is non-fatal; the write below still targets a confined path */
    }
    if (!parentRealpathContained(resolved.absPath)) {
      return { type: "action_result", title: w(ctx.lang, "Ghi file bị chặn", "File write blocked", "文件写入已阻止"), data: { ok: false, path: null, bytes: 0 }, textSummary: rejectReasonMsg("ESCAPE", ctx.lang), note: "PATH_REJECTED" };
    }

    try {
      fs.mkdirSync(path.dirname(resolved.absPath), { recursive: true });
      fs.writeFileSync(resolved.absPath, p.content ?? "", "utf8");
      const bytes = Buffer.byteLength(p.content ?? "", "utf8");
      return {
        type: "action_result",
        title: w(ctx.lang, `Đã ghi file "${resolved.relPath}"`, `Wrote file "${resolved.relPath}"`, `已写入文件 "${resolved.relPath}"`),
        data: { ok: true, path: resolved.relPath ?? p.path, bytes },
        textSummary: w(ctx.lang, `Đã ghi ${bytes} byte vào "${resolved.relPath}".`, `Wrote ${bytes} bytes to "${resolved.relPath}".`, `已向 "${resolved.relPath}" 写入 ${bytes} 字节。`),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { type: "action_result", title: w(ctx.lang, "Ghi file thất bại", "File write failed", "文件写入失败"), data: { ok: false, path: null, bytes: 0 }, textSummary: msg, note: "WRITE_ERROR" };
    }
  },
};

registerTool(writeProjectFileTool);
