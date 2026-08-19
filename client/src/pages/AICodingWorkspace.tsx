/**
 * ★★★ doc 78 · PHA D — KHÔNG GIAN LÀM VIỆC LẬP TRÌNH AI (khung ba phần).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * PHA D LÀ GIAO DIỆN — KHÔNG NỚI LỎNG BẤT KỲ HÀNG RÀO SERVER NÀO
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Mọi lượt GHI (apply_diff) và CHẠY (run_command) vẫn đi qua đúng đường HITL đã dựng ở pha B/C:
 * tác nhân ĐỀ XUẤT (proposeAction, server) → SSE trả `pending_action` → người bấm DUYỆT →
 * `confirmAction` (aiCopilotRouter) mới chạm đĩa/sinh tiến trình. Trang này CHỈ hiển thị + gửi xác
 * nhận; nó KHÔNG có một đường nào tự áp diff hay tự chạy lệnh. Nếu thấy mình viết logic ghi tệp ở
 * client thì đã sai tầng.
 *
 * Khung ba phần (doc 78 §4/PHA D):
 *   1. CÂY TỆP        — điều hướng repo qua `trpc.repoWorkspace.listFiles` (tool `list_files`).
 *   2. TRÌNH XEM+DIFF — nội dung tệp qua `trpc.repoWorkspace.readFile` (tool `read_file`); khi tác
 *      nhân đề xuất `apply_diff`, hiện <HunkDiffView/> dựng từ `args.original`/`args.modified`.
 *   3. HỘI THOẠI TÁC NHÂN — vòng chat (useKbChatStream → /api/ai/local-kb/stream) với thẻ xác nhận
 *      cho mỗi write tool. Dòng chảy: hỏi → tác nhân đọc/grep → đề xuất diff (HunkDiffView) → người
 *      duyệt → chạy test (run_command) → ĐỌC LỖI THẬT rồi sửa tiếp (đầu ra lệnh được đưa lại vào
 *      lịch sử hội thoại nên lượt sau tác nhân nhìn thấy).
 *
 * ⚠ RBAC ở client CHỈ để ẩn/hiện cho lịch sự — server (`ai_repo_read`/`ai_repo_exec`) mới là hàng
 *   rào. Route được RouteGuard ghim `ai_repo_read`; nút chạy lệnh ẩn khi thiếu `ai_repo_exec`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { mapAppRoleToAiRole } from "@/lib/aiRole";
import {
  useKbChatStream,
  type KbPendingAction,
} from "@/hooks/useKbChatStream";
import { AIToolResultCard, type ToolResultPayload } from "@/components/AIToolResultCard";
import {
  ConfirmActionCard,
  useTtlCountdown,
  type PendingAction,
  type ActionState,
} from "@/components/ConfirmActionCard";
import { HunkDiffView } from "@/components/diff/HunkDiffView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  FolderTree, FileCode, ChevronRight, ChevronDown, RefreshCw, Send, StopCircle,
  Bot, User, Loader2, ShieldAlert, AlertTriangle, Eye, FileDiff, Clock, Wrench, Lock,
} from "lucide-react";
import { toast } from "sonner";
import Markdown from "react-markdown";

// ── Basename tương đối (repo dùng "/" cho relPath, kể cả trên Windows) ──
function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CÂY TỆP — mỗi thư mục tự nạp con (list_files depth 1) khi mở
// ════════════════════════════════════════════════════════════════════════════════════════════════
interface TreeProps {
  path: string;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
  depth: number;
}

function FolderChildren({ path, selectedPath, onOpenFile, depth }: TreeProps) {
  const { t } = useTranslation();
  const q = trpc.repoWorkspace.listFiles.useQuery(
    { path: path || undefined, depth: 1 },
    { staleTime: 30_000 },
  );

  if (q.isLoading) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">{t("repoWs.tree.loading", "Đang tải…")}</div>;
  }
  if (q.isError) {
    return <div className="px-2 py-1 text-xs text-destructive">{t("repoWs.tree.error", "Không đọc được thư mục")}</div>;
  }
  const reply = q.data;
  // Server từ chối (thiếu ai_repo_read) ⇒ note=PERMISSION_DENIED; đây là hàng rào THẬT, không phải rỗng.
  if (reply && !reply.ok && reply.note === "PERMISSION_DENIED") {
    return <div className="px-2 py-1 text-xs text-destructive">{t("repoWs.tree.denied", "Server từ chối: thiếu quyền ai_repo_read")}</div>;
  }
  const entries = reply?.data?.entries ?? [];
  if (entries.length === 0) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">{t("repoWs.tree.empty", "Không có mục nào hộp cát cho phép hiện")}</div>;
  }
  const dirs = entries.filter((e) => e.kind === "dir");
  const files = entries.filter((e) => e.kind !== "dir");
  return (
    <div>
      {dirs.map((e) => (
        <FolderRow key={e.path} path={e.path} selectedPath={selectedPath} onOpenFile={onOpenFile} depth={depth} />
      ))}
      {files.map((e) => (
        <button
          key={e.path}
          type="button"
          onClick={() => onOpenFile(e.path)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className={cn(
            "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted",
            selectedPath === e.path && "bg-muted font-medium text-primary",
          )}
        >
          <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{baseName(e.path)}</span>
        </button>
      ))}
    </div>
  );
}

function FolderRow({ path, selectedPath, onOpenFile, depth }: TreeProps) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium hover:bg-muted"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <FolderTree className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="truncate">{baseName(path)}</span>
      </button>
      {open && (
        <FolderChildren path={path} selectedPath={selectedPath} onOpenFile={onOpenFile} depth={depth + 1} />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THẺ XÁC NHẬN apply_diff — DIFF ĐẦY ĐỦ (HunkDiffView) + duyệt/hủy + đồng hồ đếm ngược
// ════════════════════════════════════════════════════════════════════════════════════════════════
interface DiffArgs { path: string; original: string; modified: string }

function DiffConfirmCard({
  action, args, state, busy, preview, onPreview, onConfirm, onCancel,
}: {
  action: KbPendingAction;
  args: DiffArgs;
  state: ActionState;
  busy: boolean;
  /** Buffer đang xem trước ở khung giữa (để HunkDiffView phát hiện "buffer đã đổi"). */
  preview: string;
  onPreview: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const ttl = useTtlCountdown(action.expiresAt, state === "pending");

  return (
    <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50 p-3 text-[13px] dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-800 dark:text-amber-300">
          <FileDiff className="size-4 shrink-0" />
          {t("repoWs.diff.cardTitle", "Đề xuất SỬA tệp — cần bạn duyệt")}
        </div>
        {state === "pending" && (
          <span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            <Clock className="size-3.5" />
            {ttl.expired ? "0:00" : ttl.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-[12px]">
        <span className="font-medium text-foreground">{t("repoWs.diff.file", "Tệp")}:</span>
        <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px]">{args.path}</code>
      </div>

      {/* Diff ĐẦY ĐỦ — người duyệt có cơ sở. Nút nhận/hoàn tác từng khối chỉ để XEM TRƯỚC ở khung giữa. */}
      <HunkDiffView
        base={args.original}
        suggested={args.modified}
        currentText={preview}
        onApplyText={onPreview}
      />

      <p className="flex items-start gap-1.5 rounded-md border border-amber-300/60 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground dark:border-amber-900/50">
        <AlertTriangle className="mt-0.5 size-3 shrink-0" />
        {t("repoWs.diff.writesAll", "Xác nhận sẽ ghi TOÀN BỘ thay đổi đề xuất xuống đĩa. Nhận/hoàn tác từng khối chỉ để xem trước ở khung giữa — không đổi thứ được ghi.")}
      </p>

      {state === "pending" ? (
        <div className="flex items-center gap-2 pt-0.5">
          <Button className="h-10 flex-1 text-[13px] font-semibold" disabled={busy || ttl.expired} onClick={onConfirm}>
            {busy ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            {t("repoWs.diff.confirm", "Duyệt & ghi")}
          </Button>
          <Button variant="outline" className="h-10 flex-1 text-[13px]" disabled={busy} onClick={onCancel}>
            {t("repoWs.diff.cancel", "Hủy")}
          </Button>
        </div>
      ) : (
        <div className={cn("text-[13px] font-medium", state === "executed" ? "text-green-600 dark:text-green-400" : "text-muted-foreground")}>
          {state === "executed" && t("repoWs.diff.executed", "Đã ghi tệp.")}
          {state === "cancelled" && t("repoWs.diff.cancelled", "Đã hủy.")}
          {state === "denied" && t("repoWs.diff.denied", "Bị từ chối.")}
          {state === "expired" && t("repoWs.diff.expired", "Đã hết hạn.")}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRANG
// ════════════════════════════════════════════════════════════════════════════════════════════════
type ChatTurn = { role: "user" | "assistant"; content: string };

export default function AICodingWorkspace() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("ai_repo_read", "canView");
  const canExec = hasPermission("ai_repo_exec", "canCreate");

  // ── Trình xem tệp ──
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const fileQ = trpc.repoWorkspace.readFile.useQuery(
    { path: selectedPath ?? "" },
    { enabled: !!selectedPath, staleTime: 5_000 },
  );
  const fileReply = fileQ.data;

  // ── Diff đang chờ duyệt (từ chat) + buffer xem trước ở khung giữa ──
  const [pendingDiff, setPendingDiff] = useState<{ action: KbPendingAction; args: DiffArgs } | null>(null);
  const [diffPreview, setDiffPreview] = useState<string>("");
  useEffect(() => {
    if (pendingDiff) setDiffPreview(pendingDiff.args.original);
  }, [pendingDiff?.action.actionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hội thoại tác nhân ──
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [streamTool, setStreamTool] = useState<ToolResultPayload | null>(null);
  const [pending, setPending] = useState<KbPendingAction | null>(null);
  const [actionState, setActionState] = useState<ActionState>("pending");
  const endRef = useRef<HTMLDivElement>(null);

  const {
    streamingText, isStreaming, error: streamError, abortedRef, startKbStream, stopKbStream,
  } = useKbChatStream();

  const confirmM = trpc.aiCopilot.confirmAction.useMutation();
  const cancelM = trpc.aiCopilot.cancelAction.useMutation();

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, streamingText]);
  useEffect(() => {
    if (streamError) toast.error(streamError);
  }, [streamError]);

  const openFile = useCallback((path: string) => {
    setSelectedPath(path);
    setPendingDiff((cur) => cur); // giữ diff nếu đang mở; người dùng có thể xem tệp khác song song
  }, []);

  const lang = (i18n.language as "vi" | "en" | "zh") ?? "vi";

  const handleSend = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || isStreaming) return;
    setInput("");
    const history = transcript.slice(-10);
    setTranscript((prev) => [...prev, { role: "user", content: text }]);
    setStreamTool(null);
    setPending(null);
    setActionState("pending");

    const res = await startKbStream(
      {
        question: text,
        topK: 5,
        history,
        userRole: mapAppRoleToAiRole(user?.role),
        // ★★★ doc 79 · TRỤC 1 (A) — cờ phiên LẬP TRÌNH: server định tuyến tới tác nhân lập trình
        // (persona lập trình + 5 tool đọc/sửa/chạy repo), KHÔNG tới trợ lý vận hành + RAG tri thức.
        context: { route: "/ai-coding-workspace", uiLanguage: i18n.language, codingMode: true },
      },
      {
        onToolResult: (tr) => setStreamTool(tr),
        onPendingAction: (pa) => {
          setPending(pa);
          setActionState("pending");
          // apply_diff → mở diff ở khung giữa (dựng từ args THẬT server gửi kèm).
          if (pa.tool === "apply_diff" && pa.args && typeof pa.args.path === "string") {
            const a = pa.args as unknown as DiffArgs;
            setPendingDiff({ action: pa, args: { path: a.path, original: a.original ?? "", modified: a.modified ?? "" } });
            setSelectedPath(a.path);
          }
        },
        onClientAction: () => { /* không auto-điều hướng trong không gian làm việc */ },
      },
    );

    if (res) {
      const answer = res.fullText.trim() || t("repoWs.chat.noAnswer", "(không có nội dung trả lời)");
      setTranscript((prev) => [...prev, { role: "assistant", content: answer }]);
    } else if (!abortedRef.current) {
      setTranscript((prev) => [...prev, { role: "assistant", content: t("repoWs.chat.streamFailed", "Luồng bị lỗi — thử lại.") }]);
    }
  }, [input, isStreaming, transcript, startKbStream, user?.role, i18n.language, abortedRef, t]);

  // ── Duyệt / hủy một đề xuất ghi/chạy ──
  const handleConfirm = useCallback(async () => {
    if (!pending || actionState !== "pending") return;
    try {
      const res = await confirmM.mutateAsync({ actionId: pending.actionId, token: pending.token, lang });
      const next: ActionState =
        res.status === "executed" ? "executed" : res.status === "denied" ? "denied" : res.status === "expired" ? "expired" : "pending";
      setActionState(next);
      if (res.ok) {
        toast.success(res.message ?? t("repoWs.diff.executed", "Đã ghi tệp."));
        const out = res.result as { textSummary?: string; data?: any } | null;
        if (pending.tool === "run_command" && out?.textSummary) {
          // ★ NHỊP KHÉP VÒNG — đưa đầu ra THẬT vào lịch sử để lượt sau tác nhân đọc lỗi rồi sửa tiếp.
          setTranscript((prev) => [
            ...prev,
            { role: "assistant", content: `${t("repoWs.chat.cmdOutput", "Kết quả lệnh (đã đưa vào ngữ cảnh để sửa tiếp)")}:\n\n\`\`\`\n${out.textSummary}\n\`\`\`` },
          ]);
        } else if (pending.tool === "apply_diff") {
          setPendingDiff(null);
          if (selectedPath) fileQ.refetch();
          setTranscript((prev) => [...prev, { role: "assistant", content: t("repoWs.chat.applied", "Đã áp diff — đã đọc lại tệp.") }]);
        }
      } else {
        toast.error(res.message ?? t("repoWs.diff.denied", "Bị từ chối."));
      }
    } catch {
      toast.error(t("repoWs.chat.confirmFailed", "Không thực thi được."));
    }
  }, [pending, actionState, confirmM, lang, t, selectedPath, fileQ]);

  const handleCancel = useCallback(async () => {
    if (!pending || actionState !== "pending") return;
    try {
      await cancelM.mutateAsync({ actionId: pending.actionId });
      setActionState("cancelled");
      if (pending.tool === "apply_diff") setPendingDiff(null);
      toast.success(t("repoWs.diff.cancelled", "Đã hủy."));
    } catch {
      toast.error(t("repoWs.chat.confirmFailed", "Không thực thi được."));
    }
  }, [pending, actionState, cancelM, t]);

  // ── Đường âm: chưa đủ quyền ĐỌC ⇒ báo rõ (route đã chặn, đây là lớp phòng thêm) ──
  if (!canView) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <ShieldAlert className="h-10 w-10 text-destructive" />
          <p className="max-w-md text-sm text-muted-foreground">
            {t("repoWs.noPermission", "Bạn không có quyền ĐỌC mã nguồn (ai_repo_read). Liên hệ quản trị viên.")}
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const busyConfirm = confirmM.isPending || cancelM.isPending;

  return (
    <DashboardLayout>
      <PageContainer fluid className="p-0">
        {/* Đầu trang */}
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
          <FolderTree className="h-5 w-5 text-primary" />
          <h1 className="text-base font-semibold">{t("repoWs.title", "Không gian lập trình AI")}</h1>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t("repoWs.subtitle", "Đọc mã → đề xuất diff → người duyệt → chạy test → đọc lỗi thật rồi sửa tiếp")}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">{t("repoWs.badge.read", "đọc")}</Badge>
            <Badge variant={canExec ? "outline" : "secondary"} className="text-[10px]">
              {canExec ? t("repoWs.badge.exec", "chạy lệnh") : t("repoWs.badge.execOff", "chạy lệnh (ẩn)")}
            </Badge>
          </div>
        </div>

        <div className="grid h-[calc(100vh-8.5rem)] grid-cols-1 lg:grid-cols-[260px_1fr_420px]">
          {/* ── 1. CÂY TỆP ── */}
          <div className="flex flex-col overflow-hidden border-r">
            <div className="flex items-center justify-between border-b px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FolderTree className="h-3.5 w-3.5" /> {t("repoWs.tree.title", "Cây tệp")}
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="py-1">
                <FolderChildren path="" selectedPath={selectedPath} onOpenFile={openFile} depth={0} />
              </div>
            </ScrollArea>
          </div>

          {/* ── 2. TRÌNH XEM + DIFF ── */}
          <div className="flex flex-col overflow-hidden border-r">
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              {pendingDiff ? (
                <>
                  <FileDiff className="h-4 w-4 text-amber-500" />
                  <span className="truncate text-xs font-medium">
                    {t("repoWs.viewer.diffFor", "Xem trước diff")}: <code className="font-mono">{pendingDiff.args.path}</code>
                  </span>
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">{selectedPath ?? t("repoWs.viewer.title", "Trình xem")}</span>
                  {selectedPath && (
                    <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => fileQ.refetch()} title={t("repoWs.tree.refresh", "Làm mới")}>
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </>
              )}
            </div>
            <ScrollArea className="flex-1">
              <div className="p-3">
                {pendingDiff ? (
                  <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{diffPreview}</pre>
                ) : !selectedPath ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">{t("repoWs.viewer.empty", "Chọn một tệp ở cây bên trái để xem nội dung.")}</p>
                ) : fileQ.isLoading ? (
                  <p className="p-6 text-center text-sm text-muted-foreground">{t("repoWs.viewer.loading", "Đang đọc tệp…")}</p>
                ) : fileReply && !fileReply.ok ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                    <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{fileReply.summary ?? t("repoWs.viewer.denied", "Không đọc được (bị hộp cát/server từ chối).")}</span>
                  </div>
                ) : (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                      {fileReply?.data?.bytes != null && <Badge variant="outline" className="text-[10px]">{fileReply.data.bytes} B</Badge>}
                      {fileReply?.data?.redacted && <Badge variant="secondary" className="text-[10px]">{t("repoWs.viewer.redacted", "Đã che bí mật")}</Badge>}
                      {fileReply?.data?.truncated && <Badge variant="secondary" className="text-[10px]">{t("repoWs.viewer.truncated", "Đã cắt bớt")}</Badge>}
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{fileReply?.data?.content ?? ""}</pre>
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* ── 3. HỘI THOẠI TÁC NHÂN ── */}
          <div className="flex flex-col overflow-hidden">
            <div className="flex items-center gap-1.5 border-b px-3 py-1.5">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold">{t("repoWs.chat.title", "Hội thoại tác nhân")}</span>
            </div>
            <ScrollArea className="flex-1">
              <div className="space-y-3 p-3">
                {transcript.length === 0 && !isStreaming && (
                  <div className="space-y-3 py-6">
                    <p className="text-center text-xs text-muted-foreground">
                      {t("repoWs.chat.empty", "Hỏi để tác nhân đọc mã thật, đề xuất diff (bạn duyệt), rồi chạy test và đọc lỗi thật.")}
                    </p>
                    <div className="flex flex-col gap-1.5">
                      <button type="button" onClick={() => handleSend(t("repoWs.suggest.read", "Đọc file server/routers.ts và tóm tắt"))} className="rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                        {t("repoWs.suggest.read", "Đọc file server/routers.ts và tóm tắt")}
                      </button>
                      <button type="button" onClick={() => handleSend(t("repoWs.suggest.grep", "Tìm nơi gọi executeDecision trong repo"))} className="rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                        {t("repoWs.suggest.grep", "Tìm nơi gọi executeDecision trong repo")}
                      </button>
                      {canExec && (
                        <button type="button" onClick={() => handleSend(t("repoWs.suggest.check", "Chạy npm run check rồi đọc lỗi"))} className="rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-muted">
                          {t("repoWs.suggest.check", "Chạy npm run check rồi đọc lỗi")}
                        </button>
                      )}
                    </div>
                    {!canExec && (
                      <p className="flex items-start gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
                        <Wrench className="mt-0.5 h-3 w-3 shrink-0" />
                        {t("repoWs.exec.noPerm", "Tài khoản của bạn không có quyền CHẠY LỆNH (ai_repo_exec) — gợi ý chạy test bị ẩn. Nếu gọi thẳng, server vẫn chặn.")}
                      </p>
                    )}
                  </div>
                )}

                {transcript.map((m, i) => (
                  <div key={i} className={cn("flex gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                    {m.role !== "user" && <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10"><Bot className="h-3.5 w-3.5 text-primary" /></div>}
                    <div className={cn("max-w-[85%] rounded-lg px-3 py-2 text-[13px]", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      ) : (
                        <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed"><Markdown>{m.content}</Markdown></div>
                      )}
                    </div>
                    {m.role === "user" && <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary"><User className="h-3.5 w-3.5" /></div>}
                  </div>
                ))}

                {/* Đang stream */}
                {isStreaming && (streamingText || streamTool) && (
                  <div className="flex gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /></div>
                    <div className="max-w-[85%] space-y-2 rounded-lg bg-muted px-3 py-2 text-[13px]">
                      {streamTool && <AIToolResultCard toolResult={streamTool} />}
                      {streamingText && <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed"><Markdown>{streamingText}</Markdown></div>}
                    </div>
                  </div>
                )}
                {isStreaming && !streamingText && !streamTool && (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("repoWs.chat.thinking", "Đang suy nghĩ…")}</div>
                )}

                {/* Kết quả tool đã xong (không stream nữa) */}
                {!isStreaming && streamTool && <AIToolResultCard toolResult={streamTool} />}

                {/* Thẻ xác nhận write-tool */}
                {pending && pending.tool === "apply_diff" && pendingDiff && pendingDiff.action.actionId === pending.actionId ? (
                  <DiffConfirmCard
                    action={pending}
                    args={pendingDiff.args}
                    state={actionState}
                    busy={busyConfirm}
                    preview={diffPreview}
                    onPreview={setDiffPreview}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                  />
                ) : pending ? (
                  // run_command (và mọi write tool khác) — ConfirmActionCard hiện argv + cwd + hạn giờ + cảnh báo.
                  <ConfirmActionCard
                    action={pending as unknown as PendingAction}
                    state={actionState}
                    busy={busyConfirm}
                    onConfirm={handleConfirm}
                    onCancel={handleCancel}
                    t={t}
                  />
                ) : null}

                <div ref={endRef} />
              </div>
            </ScrollArea>

            {/* Ô nhập */}
            <div className="border-t p-2">
              <div className="flex gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t("repoWs.chat.placeholder", "Hỏi tác nhân: đọc/tìm mã, đề xuất sửa, chạy test…")}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  disabled={isStreaming}
                />
                {isStreaming ? (
                  <Button variant="destructive" size="icon" onClick={stopKbStream}><StopCircle className="h-4 w-4" /></Button>
                ) : (
                  <Button size="icon" onClick={() => handleSend()} disabled={!input.trim()}><Send className="h-4 w-4" /></Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
