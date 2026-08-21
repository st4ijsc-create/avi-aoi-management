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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ doc 79 · VÒNG TỰ ĐỘNG SAU KHI NGƯỜI DUYỆT — BỘ ĐIỀU KHIỂN Ở ĐÂY, VÀ VÌ SAO Ở ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vòng *ghi → chạy test → đọc lỗi → sửa tiếp* **phải** có một cú bấm của người ở giữa mỗi lượt
 * (HITL cho mọi lượt GHI là bất biến). Một luồng SSE trên server không thể chờ qua một cú bấm, nên
 * bộ điều khiển vòng buộc phải sống ở client. Ba hệ quả, đã xử lý:
 *
 *   1. **Quyết định DỪNG không được nằm rải trong component.** Toàn bộ cầu chì (trần · không tiến
 *      bộ · đọc kết quả test) nằm ở `@shared/aiCodingLoop` và có lưới đơn vị chạy thẳng trên nó.
 *      Ở đây chỉ có *nối dây*, và `aiCodingWorkspaceVong.unit.test.ts` kiểm chính lời nối dây ấy.
 *   2. **HITL không được lách bằng một lời gọi confirm thứ hai.** Trong file này có **ĐÚNG MỘT**
 *      điểm gọi `confirmM.mutateAsync(`, và nó nằm trong `handleConfirm` — thứ chỉ được gọi từ
 *      `onConfirm` của hai thẻ duyệt. Lưới đếm điểm gọi ấy; thêm một điểm nữa ⇒ ĐỎ.
 *   3. **Im lặng là nói dối.** Mọi lượt của vòng hiện: *lượt i/trần*, *đang làm gì*, và khi dừng
 *      thì **vì sao dừng** — kể cả khi lý do là "cờ đang tắt".
 *
 * ⚠ Bước "chạy test" KHÔNG đi qua thẻ duyệt (đó chính là thứ được tự động hoá), nhưng nó chỉ chạy
 *   được **tập con KIỂM CHỨNG** của danh sách trắng — `dotnet format` (mục duy nhất ghi đè tệp) bị
 *   loại ở server. Xem `server/services/aiCodingVerify.ts`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ doc 79 · DANH SÁCH PHIÊN — KHUNG THỨ TƯ (ngoài cùng TRÁI), và ba thứ nó KHÔNG làm
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Khung ba phần trên **giữ nguyên**; doc 79 chỉ THÊM một cột phiên bên trái (mẫu Claude Code
 * *"Sessions you start will show up here"*). Phiên lưu ở CSDL (`ai_coding_sessions`, mig 0333),
 * phạm vi **CHỦ SỞ HỮU** — kỹ sư A không đọc được phiên của kỹ sư B, kể cả `admin`.
 *
 * Nạp lại một phiên **KHÔNG**:
 *   1. tái phát một **thẻ duyệt HITL** — phiên chỉ lưu `{role, content}` (phép chiếu `locLuot`
 *      chạy ở CẢ cửa ghi LẪN cửa đọc), nên không có gì để dựng lại; `chonPhien` còn xoá tường minh
 *      `pending`/`pendingDiff`. Một băm TOCTOU cũ vì thế không có đường tới `confirmAction` — và
 *      server vẫn chặn ĐỘC LẬP (đọc lại băm từ đĩa + TTL + token gắn userId).
 *   2. hồi sinh một **vòng tự động** — `VONG_RONG` được đặt lại; vòng thuộc về MỘT lượt chạy.
 *   3. mang một **đường dẫn** — phiên chỉ mang `projectId` (id danh sách trắng), như trục 2.
 * `aiCodingWorkspacePhien.unit.test.ts` đo cả ba trên chính mã nguồn file này.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageContainer } from "@/components/patterns";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { mapAppRoleToAiRole } from "@/lib/aiRole";
import { mapTrpcError } from "@/lib/trpcErrors";
import {
  useKbChatStream,
  type KbPendingAction,
  type KbToolLoopProgress,
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
// ★ doc 81 · VIỆC 3 (1) — `Input` ĐÃ GỠ: ô nhập nay là `<textarea>` (xem `phanQuyetPhimNhap`).
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { phanQuyetPhimNhap, tuGianChieuCao, TRAN_CAO_O_NHAP_PX } from "@/lib/aiCodingInput";
import {
  bamChuoi, catLoiChoPrompt, chuanHoaDauRa, deXuatLapLai, quyetDinhTiep,
  type LyDoDungVong,
} from "@shared/aiCodingLoop";
// ★★★ doc 79 · DANH SÁCH PHIÊN — `locLuot` là PHÉP CHIẾU dùng chung với server: client cũng chiếu
// trước khi gửi, nên payload **không thể** mang một ô thẻ duyệt kể cả khi `ChatTurn` mọc thêm ô.
import { locLuot, type LuotPhien } from "@shared/aiCodingSession";
import {
  FolderTree, FileCode, ChevronRight, ChevronDown, RefreshCw, Send, StopCircle,
  Bot, User, Loader2, ShieldAlert, AlertTriangle, Eye, FileDiff, Clock, Wrench, Lock,
  Repeat, CheckCircle2, OctagonX, MessagesSquare, Plus, Trash2,
} from "lucide-react";
import { toast } from "sonner";
/**
 * ★★★ doc 81 · VIỆC 3 (2) — `Streamdown` THAY `react-markdown` trần.
 *
 * `react-markdown` trần không tô cú pháp và không có nút chép, nên một khối mã 60 dòng model vừa sinh
 * ra là một khối chữ xám phải bôi đen bằng tay. `Streamdown` **đã là dependency TRỰC TIẾP**
 * (`package.json`), **đã dùng ở `AIChatBox.tsx`**, và mặc định `controls: true` ⇒ tô cú pháp bằng
 * Shiki + nút CHÉP trên mỗi khối mã.
 *
 * ⚠ KHÔNG cài gói mới, và cố ý KHÔNG dùng `rehype-highlight`: gói ấy **không có** trong repo.
 * (`shiki`/`rehype-raw`/`remark-gfm` CÓ trong `node_modules` nhưng chỉ là dependency BẮC CẦU của
 * `streamdown` — nhập thẳng chúng là dựng một "phantom dependency" sẽ vỡ ở lượt nâng cấp sau.)
 */
import { Streamdown } from "streamdown";

// ── Basename tương đối (repo dùng "/" cho relPath, kể cả trên Windows) ──
function baseName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

// ★★★ doc 81 · VIỆC 3 (1) — chính sách ô nhập ở module LÁ `@/lib/aiCodingInput` (thuần, đo thẳng
// bằng lưới đơn vị). Xem docblock ở đó để biết vì sao nó KHÔNG nằm inline trong JSX.

// ════════════════════════════════════════════════════════════════════════════════════════════════
// CÂY TỆP — mỗi thư mục tự nạp con (list_files depth 1) khi mở
// ════════════════════════════════════════════════════════════════════════════════════════════════
interface TreeProps {
  path: string;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
  depth: number;
  // ★★★ doc 79 · TRỤC 2 — id DỰ ÁN đang chọn; cây tệp bám gốc này. Là ID, KHÔNG phải đường dẫn.
  projectId: string;
}

function FolderChildren({ path, selectedPath, onOpenFile, depth, projectId }: TreeProps) {
  const { t } = useTranslation();
  const q = trpc.repoWorkspace.listFiles.useQuery(
    { path: path || undefined, depth: 1, projectId },
    { staleTime: 30_000, enabled: !!projectId },
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
        <FolderRow key={e.path} path={e.path} selectedPath={selectedPath} onOpenFile={onOpenFile} depth={depth} projectId={projectId} />
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

function FolderRow({ path, selectedPath, onOpenFile, depth, projectId }: TreeProps) {
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
        <FolderChildren path={path} selectedPath={selectedPath} onOpenFile={onOpenFile} depth={depth + 1} projectId={projectId} />
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
// ★★★ doc 79 · VÒNG TỰ ĐỘNG — BẢNG TRẠNG THÁI NGƯỜI DÙNG NHÌN THẤY
// ════════════════════════════════════════════════════════════════════════════════════════════════
/** Vòng đang làm GÌ. Ba pha, và người dùng phải đọc được pha nào đang chạy. */
type PhaVong = "nghi" | "chay_test" | "de_xuat";

/**
 * Trạng thái vòng. **Nguồn sự thật là `vongRef`** (đọc/ghi đồng bộ trong một lượt bất đồng bộ);
 * đối tượng này chỉ là bản sao để render. Giữ hai bản vì một vòng bất đồng bộ đọc `useState` sẽ
 * thấy giá trị của lần render TRƯỚC — đúng lớp lỗi làm một cái trần đếm sai rồi không chặn được gì.
 */
interface TrangThaiVong {
  dangChay: boolean;
  /** Số lượt TEST đã chạy (0 = chưa chạy lượt nào). */
  luot: number;
  tran: number;
  pha: PhaVong;
  lenh: string | null;
  tep: string | null;
  lyDoDung: LyDoDungVong | null;
  /** Chi tiết đi kèm lý do dừng (thông điệp lỗi thật của server, số ca đỏ…). */
  chiTietDung: string | null;
  // ── Bộ nhớ giữa hai lượt: đầu vào của `quyetDinhTiep`/`deXuatLapLai` ──
  soDoTruoc: number | null;
  bamDauRaTruoc: string | null;
  bamDeXuatTruoc: string | null;
  /** Câu hỏi GỐC của người dùng — dùng để nhận ra lệnh họ nêu đích danh. */
  cauHoiGoc: string | null;
}

const VONG_RONG: TrangThaiVong = {
  dangChay: false, luot: 0, tran: 0, pha: "nghi", lenh: null, tep: null,
  lyDoDung: null, chiTietDung: null,
  soDoTruoc: null, bamDauRaTruoc: null, bamDeXuatTruoc: null, cauHoiGoc: null,
};

/**
 * Thẻ trạng thái vòng. **Im lặng là nói dối** — thẻ này luôn nói ba điều: lượt thứ mấy / trần bao
 * nhiêu · đang làm gì · (khi dừng) VÌ SAO dừng. Nó cũng là chỗ người dùng bấm DỪNG giữa chừng.
 */
function VongTuDongCard({ vong, onDung }: { vong: TrangThaiVong; onDung: () => void }) {
  const { t } = useTranslation();
  if (!vong.dangChay && vong.lyDoDung === null) return null;

  const nhanPha =
    vong.pha === "chay_test"
      ? t("repoWs.loop.phase.run", "đang CHẠY lệnh kiểm chứng")
      : vong.pha === "de_xuat"
        ? t("repoWs.loop.phase.propose", "đang ĐỌC lỗi thật và đề xuất bản sửa kế tiếp")
        : t("repoWs.loop.phase.idle", "đang chờ bạn duyệt bản sửa");

  const nhanLyDo: Record<LyDoDungVong, string> = {
    xanh: t("repoWs.loop.stop.green", "XONG — lệnh kiểm chứng đã xanh hết."),
    het_tran: t("repoWs.loop.stop.cap", "DỪNG vì hết trần lượt. Vẫn còn ca đỏ — hãy xem lỗi rồi tự yêu cầu sửa tiếp."),
    khong_tien_bo: t("repoWs.loop.stop.stuck", "DỪNG vì KHÔNG TIẾN BỘ: số ca đỏ không giảm, hoặc kết quả/bản sửa lặp lại y hệt lượt trước."),
    nguoi_tu_choi: t("repoWs.loop.stop.user", "DỪNG vì bạn đã hủy đề xuất hoặc bấm dừng vòng."),
    khong_co_lenh: t("repoWs.loop.stop.noCmd", "KHÔNG chạy được vòng: không suy ra được lệnh kiểm chứng cho dự án này (cần .sln/.csproj, hoặc package.json kèm thư mục test). Hãy nêu đích danh lệnh trong câu hỏi."),
    khong_quyen: t("repoWs.loop.stop.perm", "KHÔNG chạy được vòng: tài khoản thiếu quyền CHẠY LỆNH (ai_repo_exec). Server mới là hàng rào — xin quyền rồi thử lại."),
    co_tat: t("repoWs.loop.stop.off", "Vòng tự động đang TẮT (mặc định) — bản sửa ĐÃ ghi, nhưng bạn phải tự chạy test. Bật bằng AI_CODING_AUTOLOOP=1 rồi khởi động lại máy chủ."),
    loi: t("repoWs.loop.stop.error", "DỪNG vì một hỏng THẬT ở lượt chạy kiểm chứng."),
  };

  const xong = vong.lyDoDung === "xanh";
  return (
    <div className={cn("space-y-1.5 rounded-lg border p-2.5 text-[12px]", xong ? "border-green-400 bg-green-50 dark:border-green-800 dark:bg-green-950/30" : vong.dangChay ? "border-sky-300 bg-sky-50 dark:border-sky-800 dark:bg-sky-950/30" : "border-muted-foreground/30 bg-muted/40")}>
      <div className="flex items-center gap-1.5 font-semibold">
        {xong ? <CheckCircle2 className="size-4 shrink-0 text-green-600" /> : vong.dangChay ? <Repeat className="size-4 shrink-0 animate-pulse text-sky-600" /> : <OctagonX className="size-4 shrink-0 text-muted-foreground" />}
        <span>{t("repoWs.loop.title", "Vòng tự động — lượt {{luot}}/{{tran}}", { luot: vong.luot, tran: vong.tran })}</span>
        {vong.dangChay && (
          <Button variant="outline" size="sm" className="ml-auto h-6 px-2 text-[11px]" onClick={onDung}>
            {t("repoWs.loop.stopBtn", "Dừng vòng")}
          </Button>
        )}
      </div>
      {vong.dangChay && <div className="text-muted-foreground">{nhanPha}</div>}
      {vong.lenh && <div className="font-mono text-[11px] text-muted-foreground">$ {vong.lenh}</div>}
      {vong.lyDoDung && <div className={cn("font-medium", xong ? "text-green-700 dark:text-green-400" : "text-foreground")}>{nhanLyDo[vong.lyDoDung]}</div>}
      {vong.chiTietDung && <div className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">{vong.chiTietDung}</div>}
      <div className="text-[11px] text-muted-foreground">{t("repoWs.loop.hitl", "Mỗi lượt GHI vẫn cần bạn bấm duyệt — vòng chỉ tự CHẠY test, ĐỌC lỗi và ĐỀ XUẤT bản sửa.")}</div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ doc 79 · DANH SÁCH PHIÊN — CỘT TRÁI (mẫu "Sessions you start will show up here")
// ════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * ⚠⚠ CỘT NÀY **THUẦN HIỂN THỊ + BA CALLBACK**. Nó không giữ một mảnh trạng thái sống nào của
 * không gian làm việc: không thẻ duyệt, không vòng tự động, không đường dẫn gốc. Mọi việc dựng lại
 * trạng thái nằm ở `chonPhien`/`phienMoi` của trang — một chỗ, đọc được, có lưới đếm.
 */
interface TomTatPhienUI {
  id: string;
  title: string;
  turnCount: number;
  updatedAt: string;
}

function DanhSachPhienCot({
  phien, dangChon, dangTai, biTuChoi, onChon, onMoi, onXoa,
}: {
  phien: TomTatPhienUI[];
  dangChon: string | null;
  dangTai: boolean;
  biTuChoi: boolean;
  onChon: (id: string) => void;
  onMoi: () => void;
  onXoa: (id: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const dinhDangNgay = (iso: string): string => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(i18n.language, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex flex-col overflow-hidden border-r">
      {/* `shrink-0`: cùng lý do như khối "Dự án" — xem chú thích ở đó. */}
      <div className="flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
        <MessagesSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate text-xs font-semibold">{t("repoWs.sessions.title", "Phiên")}</span>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-6 gap-1 px-1.5 text-[11px]"
          onClick={onMoi}
          title={t("repoWs.sessions.new", "Phiên mới")}
        >
          <Plus className="h-3 w-3" />
          {t("repoWs.sessions.new", "Phiên mới")}
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-1">
          {biTuChoi ? (
            <p className="px-2 py-3 text-[11px] text-destructive">
              {t("repoWs.sessions.denied", "Server từ chối đọc phiên: thiếu quyền ai_repo_read.")}
            </p>
          ) : dangTai ? (
            <p className="px-2 py-3 text-[11px] text-muted-foreground">{t("repoWs.sessions.loading", "Đang tải phiên…")}</p>
          ) : phien.length === 0 ? (
            <p className="px-2 py-3 text-[11px] leading-relaxed text-muted-foreground">
              {t("repoWs.sessions.empty", "Phiên bạn bắt đầu sẽ hiện ở đây.")}
            </p>
          ) : (
            phien.map((p) => (
              <div
                key={p.id}
                className={cn(
                  "group flex items-start gap-1 rounded-md px-1.5 py-1 hover:bg-muted",
                  dangChon === p.id && "bg-muted",
                )}
              >
                <button
                  type="button"
                  onClick={() => onChon(p.id)}
                  aria-current={dangChon === p.id ? "true" : undefined}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className={cn("block truncate text-[11px] leading-snug", dangChon === p.id ? "font-semibold text-primary" : "font-medium")}>
                    {p.title || t("repoWs.sessions.untitled", "Phiên chưa đặt tên")}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t("repoWs.sessions.meta", "{{n}} lượt · {{luc}}", { n: p.turnCount, luc: dinhDangNgay(p.updatedAt) })}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onXoa(p.id)}
                  title={t("repoWs.sessions.delete", "Xoá phiên")}
                  aria-label={t("repoWs.sessions.delete", "Xoá phiên")}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <p className="border-t px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
        {t("repoWs.sessions.scopeNote", "Phiên lưu trên máy chủ, riêng theo tài khoản và theo dự án — người khác không đọc được.")}
      </p>
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

  // ── Bộ chọn DỰ ÁN (doc 79 · TRỤC 2) — danh sách từ server (danh sách TRẮNG .env). Client giữ và
  //    gửi lên MỘT id, KHÔNG BAO GIỜ đường dẫn. Phiên nhớ id đang chọn qua sessionStorage. ──
  const PROJECT_KEY = "aiCodingWorkspace.projectId";
  const projectsQ = trpc.repoWorkspace.listProjects.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [projectId, setProjectId] = useState<string>(() => {
    try { return sessionStorage.getItem(PROJECT_KEY) ?? ""; } catch { return ""; }
  });
  // Khi danh sách nạp xong: đảm bảo id đang chọn CÒN hợp lệ; nếu không, về defaultId (hoặc mục đầu).
  useEffect(() => {
    const data = projectsQ.data;
    if (!data) return;
    const ids = data.projects.map((p) => p.id);
    if (projectId && ids.includes(projectId)) return;
    const next = data.defaultId && ids.includes(data.defaultId) ? data.defaultId : (ids[0] ?? "");
    if (next) setProjectId(next);
  }, [projectsQ.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { if (projectId) sessionStorage.setItem(PROJECT_KEY, projectId); } catch { /* ignore */ }
  }, [projectId]);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ doc 79 · DANH SÁCH PHIÊN — trạng thái + ba bất biến, đọc trước khi sửa
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // (1) **Phiên KHÔNG lưu thẻ duyệt HITL.** Payload đi qua `locLuot()` (dùng chung với server) nên
  //     chỉ có `{role, content}`; đường nạp lại vì thế KHÔNG CÓ GÌ để dựng một `pending_action`.
  //     Và `chonPhien` còn XOÁ tường minh `pending`/`pendingDiff` — nạp một phiên là bắt đầu từ
  //     một trang sạch, không phải hồi sinh một cú bấm chưa bấm. Băm chống TOCTOU của một thẻ cũ
  //     đã hết nghĩa; server cũng chặn ĐỘC LẬP (băm đọc lại + TTL + token gắn userId).
  // (2) **Vòng tự động KHÔNG được khôi phục.** Nó thuộc về MỘT lượt chạy. `chonPhien` đặt lại
  //     `VONG_RONG` ⇒ không có "lượt 2/3" nào sống dậy mà không có tiến trình phía sau.
  // (3) **Phiên chỉ mang `projectId`**, không mang đường dẫn gốc — cùng luật trục 2.
  const utils = trpc.useUtils();
  /**
   * ⚠⚠ HAI BẢN, và đây là cùng lý do đã ghi cho `vongRef` ở trên: **`sessionIdRef` là NGUỒN SỰ
   * THẬT**, `sessionId` chỉ là bản sao để render. Một lượt lưu là bất đồng bộ; nếu nó đọc
   * `sessionId` từ bao đóng thì nó thấy giá trị của lần render TRƯỚC. Hậu quả đo được: lượt lưu
   * thứ nhất (câu người hỏi) TẠO phiên và gọi `setSessionId`, nhưng lượt thứ hai (câu AI trả lời)
   * có thể được dựng bao đóng TRƯỚC khi state kịp cập nhật ⇒ nó cũng thấy `null` ⇒ **đẻ ra phiên
   * thứ hai cho cùng một mạch**. Ref được ghi ĐỒNG BỘ ngay trong lượt lưu nên không có khe ấy.
   */
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Ghi NGUỒN SỰ THẬT trước, rồi mới đồng bộ bản render — thứ tự này là điều kiện của bất biến trên. */
  const datSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);
  const phienQ = trpc.repoWorkspace.danhSachPhien.useQuery(
    { projectId },
    { enabled: !!projectId, staleTime: 10_000 },
  );
  const luuPhienM = trpc.repoWorkspace.luuPhien.useMutation();
  const xoaPhienM = trpc.repoWorkspace.xoaPhien.useMutation();
  /** Nối tiếp các lượt lưu: lượt sau chờ lượt trước để `sessionId` mới kịp về (chống đẻ 2 hàng). */
  const luuRef = useRef<Promise<void>>(Promise.resolve());
  /** Băm mạch vừa lưu — bỏ qua lượt lưu không đổi gì (khỏi bump `updatedAt` làm đảo danh sách). */
  const bamDaLuuRef = useRef<string>("");
  /** true trong đúng một nhịp sau khi NẠP một phiên: nạp xong không được lưu ngược lại. */
  const dangKhoiPhucRef = useRef(false);

  // ── Trình xem tệp ──
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const fileQ = trpc.repoWorkspace.readFile.useQuery(
    { path: selectedPath ?? "", projectId },
    { enabled: !!selectedPath && !!projectId, staleTime: 5_000 },
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
  const oNhapRef = useRef<HTMLTextAreaElement>(null);
  /**
   * ★★★ doc 81 · VIỆC 2 — vòng lặp tool ĐANG chạy tới vòng mấy. `null` ⇔ không có vòng nào.
   * ⚠ Bắt buộc phải hiện: trần là 180 s, và một màn hình đứng im 180 s là chỉ dấu "treo", không
   * phải "đang làm việc". Đây là điều kiện brief nêu đích danh cho việc 2.
   */
  const [vongTool, setVongTool] = useState<KbToolLoopProgress | null>(null);

  const {
    streamingText, isStreaming, error: streamError, abortedRef, startKbStream, stopKbStream,
  } = useKbChatStream();

  const confirmM = trpc.aiCopilot.confirmAction.useMutation();
  const cancelM = trpc.aiCopilot.cancelAction.useMutation();

  // ── ★★★ doc 79 · VÒNG TỰ ĐỘNG — cấu hình từ SERVER (không đoán) + bộ chạy kiểm chứng ──
  const cauHinhVongQ = trpc.repoWorkspace.cauHinhVong.useQuery(undefined, { staleTime: 5 * 60_000 });
  const kiemChungM = trpc.repoWorkspace.chayKiemChung.useMutation();
  const vongRef = useRef<TrangThaiVong>({ ...VONG_RONG });
  const [vong, setVong] = useState<TrangThaiVong>({ ...VONG_RONG });
  /** Ghi vào NGUỒN SỰ THẬT rồi mới đồng bộ bản render — thứ tự này là điều kiện để trần đếm đúng. */
  const datVong = useCallback((patch: Partial<TrangThaiVong>) => {
    vongRef.current = { ...vongRef.current, ...patch };
    setVong({ ...vongRef.current });
  }, []);
  const dungVong = useCallback((lyDo: LyDoDungVong, chiTiet: string | null = null) => {
    datVong({ dangChay: false, pha: "nghi", lyDoDung: lyDo, chiTietDung: chiTiet });
  }, [datVong]);
  /** `handleSend` qua ref: vòng bất đồng bộ không được bắt một bản đóng gói CŨ của nó. */
  const handleSendRef = useRef<((override?: string, tuVong?: { tep: string }) => Promise<void>) | null>(null);

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

  /**
   * `tuVong` có mặt ⇔ lượt này do VÒNG TỰ ĐỘNG phát, không phải người gõ. Hai khác biệt:
   *   • **KHÔNG** đặt lại trạng thái vòng (một lượt người gõ thì có — câu hỏi mới = ý định mới);
   *   • gửi kèm `codingEditPath` GHIM tệp đang sửa. ⚠ Chỉ gửi ĐƯỜNG DẪN; nội dung tệp do server đọc
   *     LẠI từ đĩa trong lượt ấy (điểm neo của băm chống TOCTOU — sau lượt ghi trước, đĩa đã đổi).
   */
  const handleSend = useCallback(async (override?: string, tuVong?: { tep: string }) => {
    const text = (override ?? input).trim();
    if (!text || isStreaming) return;
    setInput("");
    if (!tuVong) {
      // Người gõ một câu mới ⇒ vòng cũ kết thúc; câu này thành "câu hỏi gốc" của vòng kế tiếp.
      vongRef.current = { ...VONG_RONG, cauHoiGoc: text };
      setVong({ ...vongRef.current });
    }
    const history = transcript.slice(-10);
    setTranscript((prev) => [...prev, { role: "user", content: text }]);
    setStreamTool(null);
    setPending(null);
    setActionState("pending");
    setVongTool(null);
    // Ô nhập vừa bị xoá ⇒ trả chiều cao về một dòng (nếu không nó giữ nguyên chiều cao cũ).
    requestAnimationFrame(() => tuGianChieuCao(oNhapRef.current));

    const res = await startKbStream(
      {
        question: text,
        topK: 5,
        history,
        userRole: mapAppRoleToAiRole(user?.role),
        // ★★★ doc 79 · TRỤC 1 (A) — cờ phiên LẬP TRÌNH: server định tuyến tới tác nhân lập trình
        // (persona lập trình + 5 tool đọc/sửa/chạy repo), KHÔNG tới trợ lý vận hành + RAG tri thức.
        // ★★★ doc 79 · TRỤC 2 — projectId (ID, KHÔNG phải đường dẫn): tác nhân bám gốc dự án đang chọn.
        context: {
          route: "/ai-coding-workspace", uiLanguage: i18n.language, codingMode: true, projectId,
          ...(tuVong ? { codingEditPath: tuVong.tep } : {}),
        },
      },
      {
        onToolResult: (tr) => setStreamTool(tr),
        // ★★★ doc 81 · VIỆC 2 — "đang ở vòng mấy". `phase:"dung"` mang theo lý do dừng.
        onToolLoop: (p) => setVongTool(p),
        onPendingAction: (pa) => {
          setPending(pa);
          setActionState("pending");
          // apply_diff → mở diff ở khung giữa (dựng từ args THẬT server gửi kèm).
          if (pa.tool === "apply_diff" && pa.args && typeof pa.args.path === "string") {
            const a = pa.args as unknown as DiffArgs;
            setPendingDiff({ action: pa, args: { path: a.path, original: a.original ?? "", modified: a.modified ?? "" } });
            setSelectedPath(a.path);
            // ★★★ CẦU CHÌ THỨ BA của vòng: model 30B thoái hoá hay trả lại ĐÚNG bản diff vừa bị
            // chứng minh là sai. Bắt ở đây tiết kiệm nguyên một lượt chạy test (tới 240 s).
            const bam = bamChuoi(a.modified ?? "");
            if (deXuatLapLai(bam, vongRef.current.bamDeXuatTruoc)) {
              dungVong("khong_tien_bo");
            }
            vongRef.current = { ...vongRef.current, bamDeXuatTruoc: bam };
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
  }, [input, isStreaming, transcript, startKbStream, user?.role, i18n.language, abortedRef, t, projectId, dungVong]);
  handleSendRef.current = handleSend;

  /**
   * ★★★ MỘT LƯỢT CỦA VÒNG: **CHẠY** lệnh kiểm chứng → **ĐỌC** đầu ra thật → **ĐỀ XUẤT** bản sửa
   * kế tiếp (hoặc DỪNG, nói rõ lý do).
   *
   * ⚠⚠ Không có một dòng nào ở đây ghi tệp. Bước ĐỀ XUẤT kết thúc bằng một thẻ duyệt; byte chỉ rời
   * ra đĩa khi người bấm "Duyệt & ghi" (→ `handleConfirm` → `confirmM.mutateAsync`, điểm gọi DUY
   * NHẤT của file này).
   */
  const chayLuotVong = useCallback(async (tep: string) => {
    const cfg = cauHinhVongQ.data;
    // Trần hiện ngay cả ở các đường dừng SỚM — "lượt 0/3" đọc được, "lượt 0/0" thì không.
    datVong({ tran: cfg?.tran ?? 0 });
    if (!cfg || !cfg.bat) { dungVong("co_tat"); return; }
    if (!canExec) { dungVong("khong_quyen"); return; }

    const truoc = vongRef.current;
    /**
     * ⚠ VÒNG ĐÃ TUYÊN BỐ DỪNG THÌ Ở YÊN. Nếu người dùng vẫn bấm duyệt bản sửa cuối (quyền của họ),
     * ta KHÔNG được lặng lẽ khởi động lại vòng — ta vừa nói với họ là nó dừng, và một cầu chì tự
     * gỡ mình sau khi nổ thì không phải cầu chì. Muốn vòng chạy lại: gõ một yêu cầu mới (lượt ấy
     * đặt lại trạng thái ở `handleSend`).
     */
    if (truoc.lyDoDung !== null) return;
    const luot = truoc.luot + 1;
    // TRẦN — cầu chì thứ nhất. Server kiểm LẠI con số này (client không tự nới được).
    if (luot > cfg.tran) { dungVong("het_tran"); return; }
    datVong({ dangChay: true, luot, tran: cfg.tran, pha: "chay_test", tep, lyDoDung: null, chiTietDung: null });

    let r: Awaited<ReturnType<typeof kiemChungM.mutateAsync>>;
    try {
      r = await kiemChungM.mutateAsync({
        projectId, luot, lang,
        ...(truoc.lenh ? { command: truoc.lenh } : {}),
        ...(truoc.cauHoiGoc ? { cauHoi: truoc.cauHoiGoc } : {}),
      });
    } catch (e) {
      dungVong("loi", mapTrpcError(e));
      return;
    }

    if (!r.ok) {
      const map: Record<string, LyDoDungVong> = {
        AUTOLOOP_OFF: "co_tat", LOOP_CAP: "het_tran", NO_VERIFY_CMD: "khong_co_lenh",
        DENIED: "khong_quyen", PROJECT_NOT_FOUND: "loi", CMD_NOT_VERIFY: "loi",
        NO_EXEC_CONTEXT: "loi", RUN_FAILED: "loi",
      };
      dungVong(map[r.ma ?? ""] ?? "loi", r.message ?? r.ma ?? null);
      return;
    }

    // ĐỌC ĐẦU RA THẬT — đưa nguyên văn vào hội thoại để người dùng thấy đúng thứ tác nhân thấy.
    const dauRa = r.output ?? "";
    setTranscript((prev) => [
      ...prev,
      { role: "assistant", content: `${t("repoWs.loop.ranTurn", "Vòng tự động — lượt {{luot}}/{{tran}} đã chạy `{{lenh}}`", { luot, tran: cfg.tran, lenh: r.command ?? "" })}\n\n\`\`\`\n${dauRa}\n\`\`\`` },
    ]);

    const bamDauRa = bamChuoi(chuanHoaDauRa(dauRa));
    const pq = quyetDinhTiep({
      luot, tran: cfg.tran, xanh: r.xanh, soDo: r.soDo,
      soDoTruoc: truoc.soDoTruoc, bamDauRa, bamDauRaTruoc: truoc.bamDauRaTruoc,
    });
    // Nhớ cho lượt sau TRƯỚC khi rẽ nhánh — nếu không, một đường thoát sớm làm mất phép so.
    datVong({ soDoTruoc: r.soDo, bamDauRaTruoc: bamDauRa, lenh: r.command });

    if (!pq.tiep) {
      const soCa = r.soDo === null ? null : t("repoWs.loop.counts", "{{do}} ca đỏ / {{xanh}} ca xanh", { do: r.soDo, xanh: r.soXanh ?? 0 });
      dungVong(pq.lyDo ?? "loi", soCa);
      return;
    }

    // ĐỀ XUẤT bản sửa kế tiếp — dựa trên LỖI THẬT vừa đọc, trên ĐÚNG tệp vừa được duyệt ghi.
    datVong({ pha: "de_xuat" });
    const cau = t("repoWs.loop.fixPrompt", "sửa {{tep}} để khắc phục lỗi sau khi chạy `{{lenh}}`. Đây là đầu ra THẬT:", { tep, lenh: r.command ?? "" });
    await handleSendRef.current?.(`${cau}\n\n${catLoiChoPrompt(dauRa)}`, { tep });
  }, [cauHinhVongQ.data, canExec, datVong, dungVong, kiemChungM, projectId, lang, t]);

  // ── Đổi dự án ⇒ cây tệp + trình xem + hội thoại bám gốc mới (doc 79 · TRỤC 2) ──
  const changeProject = useCallback((id: string) => {
    if (!id || id === projectId) return;
    setProjectId(id);
    setSelectedPath(null);
    setPendingDiff(null);
    setStreamTool(null);
    setPending(null);
    setDiffPreview("");
    setTranscript([]);
    // Vòng bám một dự án cụ thể (lệnh kiểm chứng + tệp đang sửa đều thuộc gốc cũ) ⇒ đổi dự án là
    // kết thúc vòng, không phải mang nó sang.
    vongRef.current = { ...VONG_RONG };
    setVong({ ...VONG_RONG });
    // ★★★ doc 79 · PHIÊN — phiên bám MỘT dự án suốt đời. Đổi dự án ⇒ RỜI phiên (không mang sang,
    //   không "di chuyển"): danh sách bên trái sẽ nạp lại theo gốc mới.
    datSessionId(null);
    bamDaLuuRef.current = "";
  }, [projectId, datSessionId]);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ doc 79 · PHIÊN — LƯU / MỞ LẠI / XOÁ
  // ══════════════════════════════════════════════════════════════════════════════════════════

  /**
   * Lưu mạch hội thoại hiện tại. Chạy từ một `useEffect` theo `transcript` nên nó bắt được **mọi**
   * nguồn thêm lượt (người gõ · đầu ra lệnh · đầu ra vòng tự động), không chỉ lượt gõ tay.
   *
   * ⚠ `locLuot()` là phép CHIẾU dùng chung với server — payload gửi đi **không thể** mang một ô
   *   thẻ duyệt (`actionId`/`token`/`args`) kể cả khi `ChatTurn` mọc thêm ô trong tương lai.
   */
  const luuTranscript = useCallback((turns: ChatTurn[]) => {
    if (!projectId) return;
    const sach: LuotPhien[] = locLuot(turns);
    if (sach.length === 0) return;
    const bam = bamChuoi(JSON.stringify(sach));
    if (bam === bamDaLuuRef.current) return;
    bamDaLuuRef.current = bam;
    luuRef.current = luuRef.current
      .then(async () => {
        // ⚠ ĐỌC REF, KHÔNG đọc `sessionId` của bao đóng — xem khối ⚠⚠ ở `sessionIdRef`. Đọc ở ĐÂY
        //   (trong thân đã nối tiếp) chứ không ở ngoài, để lượt này thấy id lượt trước vừa tạo.
        const idHienTai = sessionIdRef.current;
        const r = await luuPhienM.mutateAsync({ projectId, sessionId: idHienTai, turns: sach });
        if (r.ok && r.id) {
          if (!idHienTai) datSessionId(r.id);
          void utils.repoWorkspace.danhSachPhien.invalidate();
        }
      })
      .catch(() => {
        // Lưu hỏng ⇒ cho phép thử lại ở lượt sau (nếu giữ băm thì mạch này không bao giờ được lưu).
        bamDaLuuRef.current = "";
      });
  }, [projectId, luuPhienM, utils, datSessionId]);

  useEffect(() => {
    if (dangKhoiPhucRef.current) { dangKhoiPhucRef.current = false; return; }
    if (transcript.length === 0) return;
    luuTranscript(transcript);
  }, [transcript, luuTranscript]);

  /**
   * ★★★ MỞ LẠI MỘT PHIÊN CŨ. Ba lệnh xoá dưới đây **KHÔNG phải dọn dẹp cho gọn** — chúng là ba
   * bất biến của mục (C):
   *   • `setPending(null)` + `setPendingDiff(null)` — **KHÔNG tái phát một thẻ duyệt.** Phiên
   *     không lưu thẻ, nên chẳng có gì để dựng lại; hai dòng này chặn nốt thẻ của phiên ĐANG mở
   *     đi lạc sang phiên vừa nạp (băm TOCTOU của nó thuộc về ngữ cảnh khác).
   *   • `vongRef = VONG_RONG` — **KHÔNG hồi sinh một vòng tự động ma.**
   *   • `setStreamTool(null)` — kết quả tool của mạch cũ không được dán vào mạch mới.
   */
  const chonPhien = useCallback(async (id: string) => {
    if (isStreaming || id === sessionId) return;
    const r = await utils.repoWorkspace.moPhien.fetch({ sessionId: id }).catch(() => null);
    if (!r || !r.ok || !r.session) {
      toast.error(t("repoWs.sessions.openFailed", "Không mở được phiên (đã bị xoá hoặc không thuộc về bạn)."));
      void utils.repoWorkspace.danhSachPhien.invalidate();
      return;
    }
    setPending(null);
    setPendingDiff(null);
    setStreamTool(null);
    setDiffPreview("");
    setActionState("pending");
    vongRef.current = { ...VONG_RONG };
    setVong({ ...VONG_RONG });
    datSessionId(r.session.id);
    dangKhoiPhucRef.current = true;
    bamDaLuuRef.current = bamChuoi(JSON.stringify(r.session.turns));
    setTranscript(r.session.turns.map((x) => ({ role: x.role, content: x.content })));
  }, [isStreaming, sessionId, utils, t, datSessionId]);

  /** Phiên mới = trang sạch. Không gọi server: một phiên rỗng không được đẻ ra một hàng. */
  const phienMoi = useCallback(() => {
    if (isStreaming) return;
    datSessionId(null);
    setPending(null);
    setPendingDiff(null);
    setStreamTool(null);
    setDiffPreview("");
    setActionState("pending");
    vongRef.current = { ...VONG_RONG };
    setVong({ ...VONG_RONG });
    dangKhoiPhucRef.current = true;
    bamDaLuuRef.current = "";
    setTranscript([]);
  }, [isStreaming, datSessionId]);

  const xoaPhienNay = useCallback(async (id: string) => {
    const r = await xoaPhienM.mutateAsync({ sessionId: id }).catch(() => null);
    if (!r?.ok) {
      toast.error(t("repoWs.sessions.deleteFailed", "Không xoá được phiên."));
      return;
    }
    if (id === sessionId) phienMoi();
    void utils.repoWorkspace.danhSachPhien.invalidate();
  }, [xoaPhienM, sessionId, phienMoi, utils, t]);

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
          const tepDaGhi = (pending.args as unknown as DiffArgs | undefined)?.path ?? pendingDiff?.args.path ?? null;
          setPendingDiff(null);
          if (selectedPath) fileQ.refetch();
          setTranscript((prev) => [...prev, { role: "assistant", content: t("repoWs.chat.applied", "Đã áp diff — đã đọc lại tệp.") }]);
          // ★★★ doc 79 · VÒNG TỰ ĐỘNG BẮT ĐẦU ĐÚNG Ở ĐÂY — sau khi NGƯỜI đã duyệt và byte đã rời
          //   ra đĩa. Trước cú bấm này không có một lượt tự động nào chạy.
          if (tepDaGhi) void chayLuotVong(tepDaGhi);
        }
      } else {
        toast.error(res.message ?? t("repoWs.diff.denied", "Bị từ chối."));
      }
    } catch {
      toast.error(t("repoWs.chat.confirmFailed", "Không thực thi được."));
    }
  }, [pending, actionState, confirmM, lang, t, selectedPath, fileQ, pendingDiff, chayLuotVong]);

  const handleCancel = useCallback(async () => {
    if (!pending || actionState !== "pending") return;
    try {
      await cancelM.mutateAsync({ actionId: pending.actionId });
      setActionState("cancelled");
      if (pending.tool === "apply_diff") setPendingDiff(null);
      // Người từ chối bản sửa ⇒ vòng KẾT THÚC, và nói ra lý do (không im lặng biến mất).
      if (vongRef.current.dangChay || vongRef.current.luot > 0) dungVong("nguoi_tu_choi");
      toast.success(t("repoWs.diff.cancelled", "Đã hủy."));
    } catch {
      toast.error(t("repoWs.chat.confirmFailed", "Không thực thi được."));
    }
  }, [pending, actionState, cancelM, t, dungVong]);

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

        {/* ⚠ BỐ CỤC: ba khung cũ (cây tệp · trình xem · hội thoại) GIỮ NGUYÊN thứ tự và vai trò;
            doc 79 chỉ THÊM một cột phiên ở ngoài cùng bên trái, đúng mẫu Claude Code. */}
        <div className="grid h-[calc(100vh-8.5rem)] grid-cols-1 lg:grid-cols-[190px_240px_1fr_400px]">
          {/* ── 0. DANH SÁCH PHIÊN (doc 79) ── */}
          <DanhSachPhienCot
            phien={phienQ.data?.sessions ?? []}
            dangChon={sessionId}
            dangTai={phienQ.isLoading}
            biTuChoi={phienQ.data?.note === "PERMISSION_DENIED"}
            onChon={(id) => void chonPhien(id)}
            onMoi={phienMoi}
            onXoa={(id) => void xoaPhienNay(id)}
          />

          {/* ── 1. CÂY TỆP ── */}
          <div className="flex flex-col overflow-hidden border-r">
            {/* Bộ chọn DỰ ÁN (doc 79 · TRỤC 2) — tham khảo "Select folder" của Claude Code. Client
                giữ + gửi MỘT id; server tra danh sách TRẮNG .env để ra gốc (không nhận đường dẫn). */}
            {/* ⚠ `shrink-0` KHÔNG phải trang trí — nghiệm thu LIVE 2026-08-19 bắt được: thiếu nó thì
                trong `flex flex-col` có `ScrollArea flex-1`, khối này bị co xuống **13 px** trong khi
                `<select>` bên trong cao 20 px ⇒ nó TRÀN và ĐÈ lên khối "Cây tệp". Mọi lưới đều xanh —
                đây là lớp lỗi chỉ MẮT bắt được (bài học nhóm C: cổng tĩnh xanh chỉ chứng minh
                "không còn thứ TÔI BIẾT CÁCH NHÌN"). Cột phiên của đợt này làm lưới co chặt hơn nên
                lỗi mới lộ. */}
            <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
              <label htmlFor="repows-project" className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                <FolderTree className="h-3.5 w-3.5" /> {t("repoWs.project.label", "Dự án")}
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                  {t("repoWs.project.local", "Cục bộ")}
                </span>
              </label>
              <select
                id="repows-project"
                value={projectId}
                onChange={(e) => changeProject(e.target.value)}
                disabled={projectsQ.isLoading || (projectsQ.data?.projects.length ?? 0) <= 1}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs disabled:opacity-70"
                aria-label={t("repoWs.project.select", "Chọn dự án")}
              >
                {projectsQ.isLoading && <option value="">{t("repoWs.project.loading", "Đang tải dự án…")}</option>}
                {(projectsQ.data?.projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="flex shrink-0 items-center justify-between border-b px-2 py-1.5">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <FolderTree className="h-3.5 w-3.5" /> {t("repoWs.tree.title", "Cây tệp")}
              </span>
            </div>
            <ScrollArea className="flex-1">
              <div className="py-1">
                {projectId ? (
                  <FolderChildren key={projectId} path="" selectedPath={selectedPath} onOpenFile={openFile} depth={0} projectId={projectId} />
                ) : (
                  <div className="px-2 py-1 text-xs text-muted-foreground">{t("repoWs.project.none", "Chưa có dự án nào để hiển thị.")}</div>
                )}
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
                        <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed"><Streamdown mode="static">{m.content}</Streamdown></div>
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
                      {/* `mode="streaming"` — Streamdown vá markdown DỞ DANG (``` chưa đóng) nên khối
                          mã đang stream vẫn hiện đúng thay vì nhảy layout ở mỗi token. */}
                      {streamingText && <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed"><Streamdown mode="streaming">{streamingText}</Streamdown></div>}
                    </div>
                  </div>
                )}
                {/* ★★★ doc 81 · VIỆC 2 — VÒNG LẶP TOOL: đang ở vòng mấy / trần bao nhiêu / vì sao dừng. */}
                {vongTool && isStreaming && vongTool.phase !== "dung" && (
                  <div className="flex items-center gap-2 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span>
                      {t("repoWs.toolLoop.running", "Vòng đọc mã — lượt {{round}}/{{tran}}", {
                        round: vongTool.round,
                        tran: cauHinhVongQ.data?.tranTool ?? vongTool.round,
                      })}
                      {vongTool.toolName ? ` · ${vongTool.toolName}` : ""}
                    </span>
                  </div>
                )}
                {isStreaming && !streamingText && !streamTool && (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("repoWs.chat.thinking", "Đang suy nghĩ…")}</div>
                )}

                {/* Kết quả tool đã xong (không stream nữa) */}
                {!isStreaming && streamTool && <AIToolResultCard toolResult={streamTool} />}

                {/* ★★★ doc 79 · VÒNG TỰ ĐỘNG — lượt/trần · đang làm gì · vì sao dừng. */}
                <VongTuDongCard vong={vong} onDung={() => dungVong("nguoi_tu_choi")} />
                {vong.dangChay && vong.pha === "chay_test" && (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("repoWs.loop.waitCmd", "Đang chờ lệnh kiểm chứng chạy xong (có thể tới vài phút)…")}</div>
                )}

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

            {/* ★★★ doc 81 · VIỆC 3 (1) — Ô nhập NHIỀU DÒNG: dán được stack trace, Shift+Enter xuống dòng. */}
            <div className="border-t p-2">
              <div className="flex items-end gap-2">
                <textarea
                  ref={oNhapRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); tuGianChieuCao(e.currentTarget); }}
                  placeholder={t("repoWs.chat.placeholder", "Hỏi tác nhân: đọc/tìm mã, đề xuất sửa, chạy test…")}
                  onKeyDown={(e) => {
                    const pq = phanQuyetPhimNhap({
                      key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
                      isComposing: (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing,
                    });
                    // "xuong_dong" và "bo_qua" ⇒ KHÔNG `preventDefault` ⇒ trình duyệt tự chèn "\n".
                    if (pq === "gui") { e.preventDefault(); void handleSend(); }
                  }}
                  disabled={isStreaming}
                  rows={1}
                  className={cn(
                    "flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-[13px] leading-relaxed",
                    "ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                  style={{ maxHeight: TRAN_CAO_O_NHAP_PX }}
                  aria-label={t("repoWs.chat.placeholder", "Hỏi tác nhân: đọc/tìm mã, đề xuất sửa, chạy test…")}
                />
                {isStreaming ? (
                  <Button variant="destructive" size="icon" className="shrink-0" onClick={stopKbStream}><StopCircle className="h-4 w-4" /></Button>
                ) : (
                  <Button size="icon" className="shrink-0" onClick={() => handleSend()} disabled={!input.trim()}><Send className="h-4 w-4" /></Button>
                )}
              </div>
              <p className="mt-1 px-1 text-[10px] text-muted-foreground">
                {t("repoWs.chat.keyHint", "Enter để gửi · Shift+Enter để xuống dòng (dán được stack trace nhiều dòng)")}
              </p>
            </div>
          </div>
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
