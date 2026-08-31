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
 * ★★★ doc 79 · DANH SÁCH PHIÊN — và ba thứ nó KHÔNG làm
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * doc 79 dựng danh sách phiên thành một CỘT thứ tư bên trái; **2026-08-23 cột ấy thu thành nút
 * đồng hồ + popover trên thanh đầu khung Hội thoại** (mẫu bộ chọn phiên của Claude Code trong VS
 * Code — xem `@/components/ai/BoChonPhien`, và docblock ở đó cho số đo cái đổi này mua được:
 * Trình xem +190 px ở khung 1240, khung 920 thoát chế độ một-khung). Phiên vẫn lưu ở CSDL
 * (`ai_coding_sessions`, mig 0333), phạm vi **CHỦ SỞ HỮU** — kỹ sư A không đọc được phiên của kỹ
 * sư B, kể cả `admin`. Ba bất biến dưới đây KHÔNG đổi theo hình dạng UI.
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
  type PendingAction,
  type ActionState,
} from "@/components/ConfirmActionCard";
// ★★★ 2026-08-23 — CỬA DUYỆT ở tệp riêng để lưới render được CÂY THẬT. Xem docblock của tệp ấy.
import { TheDuyetDiff, type DiffArgs } from "@/components/ai/TheDuyetDiff";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
// ★ doc 81 · VIỆC 3 (1) — `Input` ĐÃ GỠ: ô nhập nay là `<textarea>` (xem `phanQuyetPhimNhap`).
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { phanQuyetPhimNhap, phanGiaiPhimTatKhung, tuGianChieuCao, TRAN_CAO_O_NHAP_PX } from "@/lib/aiCodingInput";
// ★★★ 2026-08-23 — trần chiều cao khung ĐO ĐƯỢC (hằng `8.5rem` cũ sai ở cả ba cỡ màn; xem tệp).
import { tinhChieuCaoVua, xepMotKhung } from "@/lib/khungVuaManHinh";
import {
  bamChuoi, catLoiChoPrompt, chuanHoaDauRa, daBiTuChoiGhi, deXuatLapLai, ketLuanTest, maTuChoiGhi,
  quyetDinhTiep, type LyDoDungVong,
} from "@shared/aiCodingLoop";
// ★★★ 2026-08-23 · UX (D1) — lọc dòng mốc SEARCH/REPLACE ở TẦNG HIỂN THỊ (chúng đang thành H1/
// blockquote qua markdown). MỘT nguồn hình dạng mốc ở `shared/` — xem docblock ở đó; KHÔNG áp lên
// chuỗi gửi server/lưu phiên, chỉ áp ngay tại chỗ render <Streamdown>.
import { lamSachMocChoHienThi } from "@shared/aiCodingMoc";
// ★★★ 2026-08-23 · UX (B1) — gợi ý mở đầu THEO DỰ ÁN (một bảng, khoá theo id; id lạ ⇒ ẩn gợi ý).
import { goiYTheoDuAn, MAC_DINH_KHAM_PHA } from "@/lib/goiYDuAn";
import { dongTab, moTab } from "@/lib/aiCodingTabs";
import { timDongKhop, chiSoKhopKeTiep, viTriKhopTrongChuoi, thoatRegex } from "@/lib/aiCodingTimTep";
// ★★★ 2026-08-23 · UX (D2) — lọc nhiễu cây tệp ở TẦNG HIỂN THỊ (ảnh/log/nhị phân gom sau một nút).
import { chiaTepHienThi } from "@/lib/cayTepHienThi";
// ★ UX (B2) — tooltip cho ba huy hiệu quyền; provider đã bọc cả App (App.tsx).
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
// ★★★ doc 79 · DANH SÁCH PHIÊN — `locLuot` là PHÉP CHIẾU dùng chung với server: client cũng chiếu
// trước khi gửi, nên payload **không thể** mang một ô thẻ duyệt kể cả khi `ChatTurn` mọc thêm ô.
import { locLuot, type LuotPhien } from "@shared/aiCodingSession";
// ★★★ 2026-08-23 — BỘ CHỌN PHIÊN ở tệp riêng (nút đồng hồ + popover, mẫu Claude Code). Xem
// docblock của tệp ấy cho lý do tách và số đo; `MessagesSquare`/`Plus`/`Trash2` đi theo nó.
import { BoChonPhien } from "@/components/ai/BoChonPhien";
// ★★★ QUẢN LÝ DỰ ÁN 2026-08-23 — nút bánh răng + dialog thêm/xoá dự án (admin-only, tệp riêng
// cùng lý do BoChonPhien: Portal nuốt ruột dialog khỏi mọi lưới render tĩnh dựng từ trang).
import { QuanLyDuAnRepo } from "@/components/ai/QuanLyDuAnRepo";
// ★★★ 2026-08-23 · LÔ 3 — NHÃN TIN CẬY cho khối mã trong văn xuôi model (tầng 1: nguồn gốc; tầng
// 2: chip đối chiếu tất định với thẻ đọc tệp). Component ở tệp riêng để lưới render CÂY THẬT —
// cùng bài học TheDuyetDiff; phép so THUẦN + neo ở `@/lib/soKhoiMa` (lưới + đột biến riêng).
import { taoBoKhoiMaCoNhan } from "@/components/ai/KhoiMaCoNhan";
import { bocTheDocTep, dinhDangLucNhan, viTriCauTraLoiCungLuot } from "@/lib/soKhoiMa";
// ★★★ 2026-08-24 · WAVE NỐI DÂY — bốn thành phần mới (ribbon tác vụ · bảng terminal · panel
// Problems · thẻ duyệt LÔ). Tất cả THUẦN HIỂN THỊ + callback; mọi hành động THẬT vẫn ở TRANG,
// và mọi lượt GHI/CHẠY vẫn đi qua ĐÚNG MỘT cửa `handleConfirm` → `confirmM.mutateAsync`.
import { RibbonTacVu } from "@/components/ai/RibbonTacVu";
import { BangTerminal, type LuotLenh } from "@/components/ai/BangTerminal";
import { BangProblems } from "@/components/ai/BangProblems";
import { TheDuyetDiffLo } from "@/components/ai/TheDuyetDiffLo";
// ★★★ 2026-08-25 · UX (Đợt 1) — TRÌNH XEM MÃ: tô cú pháp + SỐ DÒNG THẬT + cuộn ngang, thay `<pre>`
// trơn ở khung Trình xem. Component thuần hiển thị (lưới render riêng `trinhXemMa.unit.test.ts`).
import { TrinhXemMa } from "@/components/ai/TrinhXemMa";
// Bộ đọc "đầu ra lệnh → ĐỊA ĐIỂM LỖI" DUY NHẤT (thuần, shared) — trang parse MỘT lần, panel dùng lại.
import { phanTichLoiViTri } from "@shared/aiCodingLoiViTri";
// ★ 2026-08-24 — `baseName` nay ở module lá dùng chung (`TheDuyetDiffLo` cũng cần) — bản cục bộ đã xoá.
import { baseName } from "@/lib/repoPath";
// ★★★ 2026-08-25 · ĐỢT 2 (C) — @-mention tệp ở ô nhập: component dropdown + bộ lọc/xếp-hạng THUẦN
// (`goiYTep.unit.test.ts` đo cả hai). TRANG bắt `@`, giữ chỉ số chọn, chèn đường dẫn; `GoiYTep` chỉ
// VẼ danh sách ĐÃ lọc + báo chọn (cùng khuôn `BangProblems`/`BoChonPhien`).
import { GoiYTep, locTepTheoQuery } from "@/components/ai/GoiYTep";
import {
  FolderTree, FileCode, ChevronRight, ChevronDown, RefreshCw, Send, StopCircle,
  Bot, User, Loader2, ShieldAlert, AlertTriangle, Eye, FileDiff, Clock, Wrench, Lock,
  Repeat, CheckCircle2, OctagonX, Terminal, Search, X, ChevronUp, Wand2, Copy,
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

/**
 * ★ UX (A1) — CÂU ĐẦU của `textSummary` server cho chân thẻ duyệt: chân thẻ là một DÒNG trạng thái,
 * không phải chỗ chứa cả bài giải thích (bài đầy đủ đã vào transcript ngay trên nó). Cắt ở ngắt
 * dòng đầu tiên + trần ký tự — KHÔNG viết lại câu (câu của server phải tới người dùng nguyên nghĩa).
 */
function cauDauKetCuc(textSummary: string | null | undefined, tran = 300): string | null {
  const s = String(textSummary ?? "").trim();
  if (s === "") return null;
  const dong = s.split("\n", 1)[0]!.trim();
  return dong.length > tran ? `${dong.slice(0, tran - 1)}…` : dong;
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
  /**
   * ★ UX (D2) — nếp gấp "tệp khác" MỞ/ĐÓNG theo TỪNG thư mục (state cục bộ của component này).
   * Mặc định ĐÓNG: nhiễu (ảnh/log/nhị phân) gom sau một nút đếm số — cây chỉ còn tệp mã thật.
   */
  const [hienNhieu, setHienNhieu] = useState(false);
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
    return <div className="px-2 py-1 text-xs text-destructive">{t("repoWs.tree.denied", "Server từ chối: thiếu quyền ĐỌC mã (ai_repo_read)")}</div>;
  }
  const entries = reply?.data?.entries ?? [];
  if (entries.length === 0) {
    return <div className="px-2 py-1 text-xs text-muted-foreground">{t("repoWs.tree.empty", "Không có mục nào được hộp cát cho phép hiển thị.")}</div>;
  }
  const dirs = entries.filter((e) => e.kind === "dir");
  // ★ UX (D2) — chia ở TẦNG HIỂN THỊ (`chiaTepHienThi`, thuần, có lưới riêng); API server KHÔNG đổi.
  const { chinh, nhieu } = chiaTepHienThi(entries.filter((e) => e.kind !== "dir"));
  const veTep = (e: { path: string }, mo: boolean) => (
    <button
      key={e.path}
      type="button"
      onClick={() => onOpenFile(e.path)}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-muted",
        mo && "opacity-60",
        selectedPath === e.path && "bg-muted font-medium text-primary",
      )}
    >
      <FileCode className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{baseName(e.path)}</span>
    </button>
  );
  return (
    <div>
      {dirs.map((e) => (
        <FolderRow key={e.path} path={e.path} selectedPath={selectedPath} onOpenFile={onOpenFile} depth={depth} projectId={projectId} />
      ))}
      {chinh.map((e) => veTep(e, false))}
      {nhieu.length > 0 && (
        <button
          type="button"
          data-hien-tep-khac
          onClick={() => setHienNhieu((v) => !v)}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] italic text-muted-foreground hover:bg-muted"
        >
          {hienNhieu
            ? t("repoWs.tree.hideOther", "Ẩn tệp khác ({{n}})", { n: nhieu.length })
            : t("repoWs.tree.showOther", "Hiện tệp khác ({{n}})", { n: nhieu.length })}
        </button>
      )}
      {hienNhieu && nhieu.map((e) => veTep(e, true))}
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
// THẺ XÁC NHẬN apply_diff — nay ở `@/components/ai/TheDuyetDiff`
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 — thẻ duyệt ĐÃ TÁCH RA TỆP RIÊNG. Lý do đầy đủ ở docblock của tệp ấy; tóm tắt:
// nằm trong trang thì nó KHÔNG render được ngoài trang (trang kéo theo `trpc`, `DashboardLayout`,
// `Streamdown`…), nên mọi lưới về CỬA DUYỆT buộc phải quét VĂN BẢN mã nguồn — và lưới quét văn bản
// mù với ĐƯỜNG THOÁT thật. Tách ra ⇒ `renderToStaticMarkup` dựng CÂY THẬT, và lưới
// `client/src/components/ai/theDuyetDiff.unit.test.ts` hỏi được câu đúng.
// ⚠ ĐỪNG nhập lại vào trang: một bản sao thứ hai của cửa duyệt là một cửa KHÔNG ai đo.

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
 * ★★★ 2026-08-23 — Tham số thứ hai của `handleSend` khi lượt gửi do **VÒNG TỰ ĐỘNG** phát.
 *
 * ⚠⚠ Hai ô, và chúng đi **hai đường KHÁC NHAU trong prompt** — đó là toàn bộ lý do phải tách:
 *   • `tep`      → `context.codingEditPath`   — GHIM tệp đang sửa (server đọc lại từ đĩa).
 *   • `dauRaMay` → `context.dauRaKhongTinCay` — ĐẦU RA MÁY, **DỮ LIỆU không tin được**. Server bọc
 *     nó rồi đặt vào khối LỊCH SỬ (thẩm quyền THẤP NHẤT). Trước bản vá 2026-08-23, ô này không tồn
 *     tại và đầu ra bị nối thẳng vào `question` — tức khối `=== YÊU CẦU ===`, thẩm quyền CAO NHẤT.
 * ⚠ KHÔNG BAO GIỜ nối `dauRaMay` vào chuỗi câu hỏi ở bất kỳ đường nào khác.
 */
interface TuVongSend {
  tep: string;
  dauRaMay?: string;
}

/**
 * Thẻ trạng thái vòng. **Im lặng là nói dối** — thẻ này luôn nói ba điều: lượt thứ mấy / trần bao
 * nhiêu · đang làm gì · (khi dừng) VÌ SAO dừng. Nó cũng là chỗ người dùng bấm DỪNG giữa chừng.
 */
function VongTuDongCard({ vong, onDung, laAdmin }: { vong: TrangThaiVong; onDung: () => void; laAdmin: boolean }) {
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
    /**
     * ★ UX (A3) — câu "Bật bằng AI_CODING_AUTOLOOP=1 rồi khởi động lại" là chỉ dẫn cho NGƯỜI SỬA
     * ĐƯỢC `.env` máy chủ. Nói nó với một kỹ sư thường là bảo họ đi sửa một thứ họ không chạm được
     * (đo ở buổi trải nghiệm: "Vòng tự động bảo tôi sửa biến môi trường máy chủ"). Vai thường nhận
     * câu đúng việc-phải-làm: liên hệ quản trị viên. Đây là phép LỊCH SỰ hiển thị — cờ vẫn do server
     * quyết (`cauHinhVong`), không có nhánh quyền mới nào.
     */
    co_tat: laAdmin
      ? t("repoWs.loop.stop.off", "Vòng tự động đang TẮT (mặc định) — bản sửa ĐÃ ghi, nhưng bạn phải tự chạy test. Bật bằng AI_CODING_AUTOLOOP=1 rồi khởi động lại máy chủ.")
      : t("repoWs.loop.stop.offUser", "Vòng tự động đang TẮT — bản sửa ĐÃ ghi, nhưng bạn phải tự chạy test. Tính năng này do quản trị viên bật trên máy chủ — hãy liên hệ quản trị viên."),
    loi: t("repoWs.loop.stop.error", "DỪNG vì một hỏng THẬT ở lượt chạy kiểm chứng."),
    // ★★★ 2026-08-24 — VÒNG TỰ-TRỊ-GHI: hai lý do RIÊNG (khác `loi`/`co_tat`) — xem `LyDoDungVong`.
    tep_ban_nguoi: t("repoWs.loop.stop.dirty", "DỪNG vì tệp đích có thay đổi CHƯA COMMIT của bạn — vòng tự-ghi KHÔNG đè lên công việc chưa lưu. Hãy commit (hoặc stash) rồi thử lại."),
    kill_switch: t("repoWs.loop.stop.kill", "DỪNG vì công tắc khẩn cấp (kill-switch) đã được bật — vòng tự-ghi dừng ngay. Liên hệ quản trị viên để gỡ."),
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
// ★★★ doc 79 · DANH SÁCH PHIÊN — nay là NÚT + POPOVER ở `@/components/ai/BoChonPhien`
// ════════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 — cột "Phiên" 190 px đã thu thành nút đồng hồ + popover trên thanh đầu khung
// Hội thoại (mẫu Claude Code trong VS Code). Thành phần ở tệp riêng để lưới render CÂY THẬT
// (`boChonPhien.unit.test.ts`) — cùng bài học với `TheDuyetDiff`. Nó vẫn THUẦN HIỂN THỊ + BA
// CALLBACK: mọi việc dựng lại trạng thái ở `chonPhien`/`phienMoi` của trang, một chỗ, có lưới đếm.
// ⚠ ĐỪNG dựng lại một cột phiên thứ hai ở đây: hai bộ chọn phiên = hai chỗ phải giữ đồng bộ tay.

// ════════════════════════════════════════════════════════════════════════════════════════════════
// TRANG
// ════════════════════════════════════════════════════════════════════════════════════════════════
type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * ★★★ 2026-08-23 — CHIỀU CAO KHUNG ĐO ĐƯỢC, THAY CHO HẰNG `calc(100vh-8.5rem)` ĐOÁN SAI.
 *
 * Toàn bộ lý lẽ (kèm ba phép đo bác bỏ hằng cũ) nằm ở `@/lib/khungVuaManHinh`. Ở đây chỉ là phần
 * ĐỌC DOM: lấy đỉnh tuyệt đối của khung và tổng `padding-bottom` của các tổ tiên tới khối cuộn gần
 * nhất (`<main class="… pb-24">` ⇒ 96 px).
 *
 * ⚠ `ResizeObserver` gắn vào CHA, không vào chính khung: quan sát chính mình trong khi mình đang
 *   đổi chiều cao là một vòng lặp vô tận. Phép tính chỉ dùng `dinhTuyetDoi` — đại lượng KHÔNG phụ
 *   thuộc chiều cao ta vừa đặt — nên nó hội tụ sau đúng một nhịp.
 */
function useKhungVua(ref: React.RefObject<HTMLElement | null>): { cao: number | null; rong: number } {
  const [cao, setCao] = useState<number | null>(null);
  const [rong, setRong] = useState(0);
  useEffect(() => {
    const tinh = () => {
      const el = ref.current;
      if (!el) return;
      let demDuoi = 0;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        demDuoi += parseFloat(s.paddingBottom) || 0;
        if (p.tagName === "MAIN" || s.overflowY === "auto" || s.overflowY === "scroll") break;
      }
      const r = el.getBoundingClientRect();
      const next = tinhChieuCaoVua({
        dinhTuyetDoi: r.top + window.scrollY,
        caoManHinh: window.innerHeight,
        demDuoi,
      });
      // Chỉ ghi khi lệch thật — chống nhịp render thừa và chống mọi khả năng dao động 1 px.
      setCao((cu) => (cu !== null && Math.abs(cu - next) <= 1 ? cu : next));
      setRong((cu) => (Math.abs(cu - r.width) <= 1 ? cu : r.width));
    };
    tinh();
    window.addEventListener("resize", tinh);
    const cha = ref.current?.parentElement;
    const ro = cha ? new ResizeObserver(tinh) : null;
    if (cha && ro) ro.observe(cha);
    return () => {
      window.removeEventListener("resize", tinh);
      ro?.disconnect();
    };
  }, [ref]);
  return { cao, rong };
}

export default function AICodingWorkspace() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("ai_repo_read", "canView");
  const canExec = hasPermission("ai_repo_exec", "canCreate");

  // ── Bộ chọn DỰ ÁN (doc 79 · TRỤC 2) — danh sách từ server (danh sách TRẮNG .env). Client giữ và
  //    gửi lên MỘT id, KHÔNG BAO GIỜ đường dẫn. ──
  // ★★★ 2026-08-23 · UX (D2) — NHỚ dự án qua **localStorage khoá theo userId** (bản trước chỉ
  //   sessionStorage: đóng tab là quên, người dùng mở lại luôn rơi về "Repo chinh" — đo ở buổi trải
  //   nghiệm). sessionStorage GIỮ LẠI làm liên tục cùng-tab; localStorage per-user để hai tài khoản
  //   trên một máy xưởng không kế thừa lựa chọn của nhau. Vẫn CHỈ là một id danh sách trắng — id lạ
  //   bị effect dưới đưa về defaultId, đúng luật trục 2.
  const PROJECT_KEY = "aiCodingWorkspace.projectId";
  const khoaLuuTheoUser = user?.id != null ? `${PROJECT_KEY}.u${user.id}` : null;
  const projectsQ = trpc.repoWorkspace.listProjects.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [projectId, setProjectId] = useState<string>(() => {
    try { return sessionStorage.getItem(PROJECT_KEY) ?? ""; } catch { return ""; }
  });
  /** Khôi phục từ localStorage đúng MỘT lần (khi user + danh sách cùng sẵn sàng) — không giật lại
   *  lựa chọn người dùng vừa đổi tay ở lượt sau. */
  const daKhoiPhucDuAnRef = useRef(false);
  // Khi danh sách nạp xong: khôi phục per-user (một lần) → đảm bảo id CÒN hợp lệ → defaultId.
  useEffect(() => {
    const data = projectsQ.data;
    if (!data) return;
    const ids = data.projects.map((p) => p.id);
    if (!daKhoiPhucDuAnRef.current && khoaLuuTheoUser !== null) {
      daKhoiPhucDuAnRef.current = true;
      if (!projectId || !ids.includes(projectId)) {
        try {
          const luu = localStorage.getItem(khoaLuuTheoUser);
          if (luu && ids.includes(luu)) { setProjectId(luu); return; }
        } catch { /* ignore */ }
      }
    }
    if (projectId && ids.includes(projectId)) return;
    const next = data.defaultId && ids.includes(data.defaultId) ? data.defaultId : (ids[0] ?? "");
    if (next) setProjectId(next);
  }, [projectsQ.data, khoaLuuTheoUser]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      if (projectId) {
        sessionStorage.setItem(PROJECT_KEY, projectId);
        if (khoaLuuTheoUser !== null) localStorage.setItem(khoaLuuTheoUser, projectId);
      }
    } catch { /* ignore */ }
  }, [projectId, khoaLuuTheoUser]);

  /**
   * ★ 2026-08-31 · ĐỢT A (UX H5) — BÀN LÀM VIỆC SỐNG QUA RELOAD. Transcript đã lưu DB từ doc 79,
   * nhưng F5 vẫn mất sạch tab/tệp/panel — nửa bàn làm việc bay hơi. Lưu {openTabs, selectedPath,
   * duoiChat} vào localStorage KHOÁ THEO user+DỰ ÁN (cùng khuôn `khoaLuuTheoUser` ở trên): đổi dự
   * án nay KHÔI PHỤC đúng bàn của dự án ấy thay vì đóng trắng. Chỉ TRẠNG THÁI XEM — 0 nội dung
   * tệp, 0 thẻ duyệt, 0 vòng tự động được hồi sinh (ba thứ ấy có lý do an toàn riêng để chết).
   * Khôi phục qua ref cờ MỘT-LẦN-MỖI-DỰ-ÁN để không giật lại thao tác người dùng vừa làm.
   */
  const khoaBanLamViec = user?.id != null ? `repoWs.ban.u${user.id}.${projectId}` : null;
  const duAnDaKhoiPhucRef = useRef<string | null>(null);

  /**
   * ★★★ 2026-08-31 · ĐỢT C (UX H2) — SỬA TAY = MỘT ĐỀ XUẤT DIFF. `dangSuaTay` bật chế độ sửa của
   * Trình xem (textarea v1 — CodeMirror để đợt sau); "Tạo đề xuất" gửi buffer qua
   * `repoWorkspace.deXuatSuaTay` → server dựng MỘT lượt `apply_diff` pending → trang nạp vào ĐÚNG
   * thẻ duyệt hiện có (setPending/setPendingDiff — cùng đường với diff của model). KHÔNG một byte
   * nào rời trình duyệt ngoài đường đã kiểm toán; Duyệt/Hủy vẫn là hai nút cũ.
   */
  const [dangSuaTay, setDangSuaTay] = useState(false);
  const [banSua, setBanSua] = useState("");

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
  // ★★★ 2026-08-26 · CURSOR-PARITY — TAB ĐA-TỆP: danh sách tệp ĐANG MỞ (đi kèm `selectedPath` = tab HOẠT
  //   ĐỘNG). Thuần additive — đường đọc tệp vẫn theo `selectedPath`; logic đóng-tab thuần ở `@/lib/aiCodingTabs`.
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  // ★★★ 2026-08-26 · CURSOR-PARITY — TÌM TRONG TỆP (Ctrl+F): thanh tìm ở Trình xem. Điều hướng đặt
  //   `dongMucTieu` = dòng khớp ⇒ TÁI DÙNG cuộn+tô-sáng của nhảy-tới-dòng (xem `@/lib/aiCodingTimTep`).
  const [timMo, setTimMo] = useState(false);
  const [tuKhoaTim, setTuKhoaTim] = useState("");
  const [chiSoTim, setChiSoTim] = useState(0);
  const oTimRef = useRef<HTMLInputElement>(null);
  // ★★★ 2026-08-27 · CURSOR-PARITY — TÌM TOÀN REPO (Ctrl+Shift+F): khung Cây có chế độ "cay" | "tim".
  //   DÙNG LẠI endpoint `repoWorkspace.grep` (ĐÃ CÓ). Debounce 300ms để không gọi grep mỗi phím.
  const [cheDoCay, setCheDoCay] = useState<"cay" | "tim">("cay");
  const [tuKhoaRepo, setTuKhoaRepo] = useState("");
  const [tuKhoaRepoTre, setTuKhoaRepoTre] = useState("");
  const oTimRepoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const id = setTimeout(() => setTuKhoaRepoTre(tuKhoaRepo), 300);
    return () => clearTimeout(id);
  }, [tuKhoaRepo]);
  // Vào chế độ "tim" ⇒ LẤY NÉT ô tìm-repo (effect chạy sau mount — đáng tin hơn rAF trong handler phím).
  useEffect(() => { if (cheDoCay === "tim") oTimRepoRef.current?.select(); }, [cheDoCay]);

  // ★★★ 2026-08-27 · CURSOR-PARITY — Cmd+K SỬA ĐOẠN CHỌN: ô-lệnh cho đoạn mã đang BÔI ĐEN ở Trình xem.
  //   AN TOÀN: chỉ DỰNG một câu hỏi có bối cảnh (đoạn + yêu cầu) rồi GỬI qua `handleSend` → model →
  //   apply_diff → CỬA DUYỆT. KHÔNG mở đường ghi mới, KHÔNG chạm luồng propose/HITL.
  const [suaChonMo, setSuaChonMo] = useState(false);
  const [doanChon, setDoanChon] = useState("");
  const [soDongChon, setSoDongChon] = useState(0);
  const [yeuCauSua, setYeuCauSua] = useState("");
  const oSuaChonRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (suaChonMo) oSuaChonRef.current?.focus(); }, [suaChonMo]);
  /**
   * ★★★ 2026-08-24 — DÒNG ĐÍCH để trình xem CUỘN tới khi mở tệp từ panel Problems. `null` ⇔ mở
   * bình thường (không nhảy). Effect cuộn (khoá `selectedPath`/`dongMucTieu`/`fileReply`) nay tìm
   * ĐÚNG ô gutter `[data-so-dong={dongMucTieu}]` của `TrinhXemMa` (số dòng THẬT) ⇒ cuộn CHÍNH XÁC,
   * KHÔNG còn xấp xỉ "cao dòng trung bình". Mở tệp qua CÂY (`openFile`) đặt lại `null` ⇒ không kéo
   * tệp mới về dòng của tệp cũ.
   */
  const [dongMucTieu, setDongMucTieu] = useState<number | null>(null);
  const fileQ = trpc.repoWorkspace.readFile.useQuery(
    { path: selectedPath ?? "", projectId },
    { enabled: !!selectedPath && !!projectId, staleTime: 5_000 },
  );
  const fileReply = fileQ.data;

  // ★★★ CURSOR-PARITY — TÌM TRONG TỆP: dòng khớp từ khoá (rỗng khi không mở tìm / không nội dung).
  const ketQuaTim = useMemo(
    () => (timMo && tuKhoaTim ? timDongKhop(fileReply?.data?.content ?? "", tuKhoaTim) : []),
    [timMo, tuKhoaTim, fileReply?.data?.content],
  );
  /** Điều hướng ▲▼ / Enter-Shift+Enter: đặt `dongMucTieu` = dòng khớp ⇒ tái dùng cuộn+tô-sáng. */
  const nhayKhopTim = useCallback((tien: boolean) => {
    if (ketQuaTim.length === 0) return;
    const moi = chiSoKhopKeTiep(chiSoTim, ketQuaTim.length, tien);
    setChiSoTim(moi);
    setDongMucTieu(ketQuaTim[moi]);
  }, [ketQuaTim, chiSoTim]);
  const dongThanhTim = useCallback(() => {
    setTimMo(false);
    setTuKhoaTim("");
    setDongMucTieu(null); // bỏ tô-sáng khớp cuối khi đóng thanh tìm
  }, []);
  // Đổi TỪ KHOÁ (hoặc mở tìm / đổi nội dung) ⇒ nhảy về khớp ĐẦU; điều hướng ▲▼ KHÔNG kích lại (ketQuaTim
  //   ổn định khi chỉ `chiSoTim` đổi). Đóng tìm / hết khớp ⇒ không đụng `dongMucTieu` ở đây.
  useEffect(() => {
    if (timMo && ketQuaTim.length > 0) { setChiSoTim(0); setDongMucTieu(ketQuaTim[0]); }
  }, [ketQuaTim, timMo]);
  // Mở thanh tìm ⇒ LẤY NÉT + chọn văn bản (gõ đè ngay như VSCode). Effect chạy SAU khi thanh đã mount,
  //   nên đáng tin hơn `requestAnimationFrame` trong chính handler phím (ref có thể chưa gắn lúc ấy).
  useEffect(() => { if (timMo) oTimRef.current?.select(); }, [timMo]);

  // ★★★ 2026-08-27 — TÔ CỤM KHỚP TRONG DÒNG (tìm-trong-tệp) qua CSS Custom Highlight API: dựng `Range`
  //   trên các cụm khớp trong `[data-ma]` rồi đăng ký MỘT `Highlight` — TÔ ĐÈ lên nội dung Shiki mà
  //   KHÔNG chèn DOM. Feature-detect: trình duyệt thiếu API ⇒ no-op (vẫn còn tô-sáng DÒNG hiện tại qua
  //   `dongMucTieu`). rAF chờ nội dung render xong mới đo Range. Cụm khớp CẮT NGANG span màu (hiếm) sẽ
  //   không tô — giới hạn đã chấp nhận (một Range chỉ trong một text-node).
  useEffect(() => {
    const st = document.createElement("style");
    st.textContent = "::highlight(repows-tim-cum){background-color:rgba(250,204,21,0.5);border-radius:2px;}";
    document.head.appendChild(st);
    return () => { st.remove(); };
  }, []);
  useEffect(() => {
    const kho = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HL = (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!kho || !HL) return;
    if (!timMo || tuKhoaTim.trim().length < 1) { kho.delete("repows-tim-cum"); return; }
    const id = requestAnimationFrame(() => {
      const goc = preRef.current?.querySelector("[data-ma]");
      if (!goc) { kho.delete("repows-tim-cum"); return; }
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(goc, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const txt = node.textContent ?? "";
        for (const off of viTriKhopTrongChuoi(txt, tuKhoaTim)) {
          const r = document.createRange();
          r.setStart(node, off);
          r.setEnd(node, off + tuKhoaTim.length);
          ranges.push(r);
        }
      }
      if (ranges.length) kho.set("repows-tim-cum", new HL(...ranges));
      else kho.delete("repows-tim-cum");
    });
    return () => cancelAnimationFrame(id); // set() ghi đè nên KHÔNG delete ở đây (tránh nháy khi gõ)
  }, [timMo, tuKhoaTim, fileReply, selectedPath]);

  // ── Diff đang chờ duyệt (từ chat) + buffer xem trước ở khung giữa ──
  const [pendingDiff, setPendingDiff] = useState<{ action: KbPendingAction; args: DiffArgs } | null>(null);
  /**
   * ★★★ 2026-08-24 — DIFF **LÔ** đang chờ duyệt (`apply_diff_batch`). Trước đây một đề xuất sửa N
   * tệp rơi vào `ConfirmActionCard` phẳng (nội dung CẮT, không phải diff); nay đặc-cách sang
   * `TheDuyetDiffLo` (mỗi tệp một tab, mỗi tab một diff THẬT). CHỈ mang args để HIỂN THỊ — mọi lượt
   * ghi vẫn qua `handleConfirm` → `confirmM` (server đọc args từ hàng ai_pending_actions). Ba hàm
   * reset đặt lại `null` (không hồi sinh một thẻ duyệt của mạch cũ).
   */
  const [pendingBatch, setPendingBatch] = useState<{ action: KbPendingAction; files: DiffArgs[] } | null>(null);
  const [diffPreview, setDiffPreview] = useState<string>("");
  useEffect(() => {
    if (pendingDiff) setDiffPreview(pendingDiff.args.original);
  }, [pendingDiff?.action.actionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Hội thoại tác nhân ──
  const [transcript, setTranscript] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState("");
  /**
   * ★★★ 2026-08-24 · LỊCH SỬ LƯỢT LỆNH cho bảng Terminal + panel Problems. Mỗi lượt `run_command`
   * ĐÃ CHẠY (qua cửa duyệt HITL) hoặc mỗi lượt vòng tự-ghi được đẩy vào đây từ CHÍNH các biến đã có
   * tại chỗ (`d.*`/`out.*`/`kl` ở `handleConfirm`, `r.*` ở `chayLuotVong`) — **0 lời gọi tRPC mới**.
   * `diaDiemLoi` do trang parse MỘT lần (`phanTichLoiViTri`) để panel Problems dùng lại. Ba hàm reset
   * đặt lại `[]` (đổi dự án / nạp phiên / phiên mới ⇒ lịch sử lệnh của mạch cũ không dán sang mạch mới).
   */
  const [lenhDaChay, setLenhDaChay] = useState<LuotLenh[]>([]);
  /**
   * Vỏ DƯỚI khung Hội thoại: gập (`dong`) · Terminal · Vấn đề. Là TUỲ CHỌN HIỂN THỊ (như `khungHep`)
   * ⇒ **KHÔNG** nằm trong ba hàm reset. Mặc định GẬP: nội dung có `max-h` + cuộn nội bộ nên không đẩy
   * ô nhập xuống dưới nếp gấp (bài học `khungVuaManHinh`).
   */
  const [duoiChat, setDuoiChat] = useState<"dong" | "terminal" | "problems">("dong");

  // ★ ĐỢT A (UX H5) — KHÔI PHỤC bàn làm việc của dự án (một lần mỗi projectId; xem docblock khoá).
  useEffect(() => {
    if (!projectId || khoaBanLamViec === null || duAnDaKhoiPhucRef.current === projectId) return;
    duAnDaKhoiPhucRef.current = projectId;
    try {
      const tho = localStorage.getItem(khoaBanLamViec);
      if (!tho) return;
      const ban = JSON.parse(tho) as { tabs?: unknown; tep?: unknown; duoi?: unknown };
      if (Array.isArray(ban.tabs) && ban.tabs.every((x) => typeof x === "string")) {
        setOpenTabs(ban.tabs.slice(0, 12));
        if (typeof ban.tep === "string" && ban.tabs.includes(ban.tep)) setSelectedPath(ban.tep);
      }
      if (ban.duoi === "terminal" || ban.duoi === "problems") setDuoiChat(ban.duoi);
    } catch { /* hỏng dữ liệu lưu ⇒ bàn trắng, không vỡ trang */ }
  }, [projectId, khoaBanLamViec]);
  // ★ ĐỢT A — LƯU (mỗi thay đổi; try/catch vì localStorage có thể đầy/bị chặn).
  useEffect(() => {
    if (!projectId || khoaBanLamViec === null) return;
    try {
      localStorage.setItem(khoaBanLamViec, JSON.stringify({ tabs: openTabs, tep: selectedPath, duoi: duoiChat }));
    } catch { /* ignore */ }
  }, [openTabs, selectedPath, duoiChat, projectId, khoaBanLamViec]);
  const [streamTool, setStreamTool] = useState<ToolResultPayload | null>(null);
  /**
   * ★ LÔ 3 — MỐC-NHẬN của `streamTool` (đã định dạng), đóng dấu ngay trong `onToolResult`.
   * Display-only: payload thẻ đọc không mang timestamp và lô này cấm đổi server để cõng thêm —
   * nên chip nói "đọc {{luc}}" với mốc client NHẬN sự kiện, ghi rõ ở `dinhDangLucNhan`. Không cần
   * xoá kèm `setStreamTool(null)`: mốc chỉ được ĐỌC khi có thẻ/neo tương ứng đang hiện.
   */
  const [lucNhanTool, setLucNhanTool] = useState<string | null>(null);
  const [pending, setPending] = useState<KbPendingAction | null>(null);
  const [actionState, setActionState] = useState<ActionState>("pending");
  /**
   * ★★★ 2026-08-23 · UX (A1) — CÂU KẾT CỤC cho chân thẻ duyệt khi một lượt xác nhận bị TỪ CHỐI.
   *
   * Đo live: lệnh bị chặn vì KÝ TỰ CẤM (`CMD_METACHAR`) mà chân thẻ hiện *"Bạn không có quyền thực
   * hiện thao tác này."* — vì `ConfirmActionCard` không được truyền `message`, nó rơi về câu mặc
   * định `copilot.denied` (một câu về RBAC) cho MỌI kết cục "denied". Người dùng đi tìm nhầm chỗ
   * (đi xin quyền, trong khi lỗi là một chữ "và" lọt vào lệnh).
   * ⇒ State này giữ CÂU THẬT của server (`textSummary` — `cauTuChoiLenh` đã viết đúng bản chất +
   *   việc-phải-làm cho từng mã CMD_*) và được truyền vào `message` của thẻ. KHÔNG chép một bảng
   *   mã→câu thứ hai ở client: câu của server phải TỚI người dùng, không bị một câu generic đè.
   */
  const [ketCucThongDiep, setKetCucThongDiep] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const oNhapRef = useRef<HTMLTextAreaElement>(null);
  const khungRef = useRef<HTMLDivElement>(null);
  /** ★★★ 2026-08-25 — bọc `TrinhXemMa` (trình xem) để effect cuộn tìm ô `[data-so-dong]` tới `dongMucTieu`. */
  const preRef = useRef<HTMLDivElement>(null);
  const { cao: caoKhung, rong: rongKhung } = useKhungVua(khungRef);
  /** Ba khung cạnh nhau, hay một khung mỗi lần — hỏi BỀ RỘNG KHUNG, không hỏi cửa sổ. */
  const hep = xepMotKhung(rongKhung);
  /**
   * ★★★ 2026-08-23 · KHUNG NÀO ĐANG HIỆN KHI MÀN HẸP.
   *
   * Khi khung cha không chứa nổi tổng sàn các cột thì xếp cạnh nhau là vỡ: nghiệm thu live đo ở
   * 1280×800 (thời còn bốn khung) rằng các cột cố định nuốt hết `1fr` và khung "Trình xem" co còn
   * **82 px** — chữ rơi một từ mỗi dòng. Xếp DỌC cũng không cứu được: ở 900×700 các khung xếp chồng
   * cho ô nhập ở `y ≈ 1405` trong màn cao 700 và **cuộn hết cỡ vẫn không tới** ⇒ *không gõ được câu
   * hỏi*. Nên khi hẹp: **một khung mỗi lần, cao trọn khung, ô nhập ghim đáy**.
   * (2026-08-23: cột "phiên" đã thành popover ⇒ hết ô "phien" — danh sách phiên mở được từ thanh
   * đầu Hội thoại ở MỌI chế độ, kể cả hẹp.)
   * ⚠ Mặc định `"chat"` — không phải tuỳ tiện: đây là khung DUY NHẤT có ô nhập, và màn này vô dụng
   *   nếu không hỏi được. Mặc định "tệp"/"xem" sẽ làm lượt gõ đầu tiên tốn một cú bấm.
   */
  const [khungHep, setKhungHep] = useState<"tep" | "xem" | "chat">("chat");
  /**
   * ★★★ doc 81 · VIỆC 2 — vòng lặp tool ĐANG chạy tới vòng mấy. `null` ⇔ không có vòng nào.
   * ⚠ Bắt buộc phải hiện: trần là 180 s, và một màn hình đứng im 180 s là chỉ dấu "treo", không
   * phải "đang làm việc". Đây là điều kiện brief nêu đích danh cho việc 2.
   */
  const [vongTool, setVongTool] = useState<KbToolLoopProgress | null>(null);

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // ★★★ 2026-08-25 · ĐỢT 2 (audit UX cho model LOCAL chậm) — (A) đồng hồ elapsed · (B) dấu vết
  // đa-tool · (C) @-mention tệp. Ba thứ ĐỀU thuần hiển thị/nhập; KHÔNG mở đường ghi nào (mọi lượt
  // GHI/CHẠY vẫn qua ĐÚNG MỘT cửa `handleConfirm` → `confirmM.mutateAsync`).
  // ══════════════════════════════════════════════════════════════════════════════════════════
  /**
   * (A) Số giây đã trôi của thao tác đang chờ — đang stream (đọc mã/vòng tool) HOẶC vòng tự động
   * đang chờ lệnh kiểm chứng. Mốc bắt đầu ở `mocChoRef` (KHÔNG ở render — đếm đúng qua re-render).
   * TRẦN cố ý KHÔNG hiện: `cauHinhVong` chỉ trả SỐ LƯỢT (`tran`/`tranTool`), không trả GIÂY — một
   * con số giây viết ở client là một lời khai có thể sai. Elapsed nói "thực tế"; ETA tĩnh nói "kỳ vọng".
   */
  const [giayCho, setGiayCho] = useState(0);
  const mocChoRef = useRef<number | null>(null);
  /**
   * (B) MỌI thẻ tool của lượt (dấu vết "đã đọc/grep gì"). `streamTool` VẪN là thẻ CUỐI và VẪN là mỏ
   * neo của NHÃN TIN CẬY khối mã (`neoDocTep`) — mảng này chỉ THÊM để hiển thị dấu vết, không đụng nó.
   */
  const [streamTools, setStreamTools] = useState<ToolResultPayload[]>([]);
  /**
   * (C) @-mention: danh sách đường-dẫn KHỚP đang hiện, mục đang tô (điều hướng ↑/↓), và vị trí dấu
   * `@` trong ô nhập (chèn đè lên đoạn nào). `dsTepDuAn` là danh sách tệp dự án đã phẳng.
   * ★ 2026-08-31 · PDCA vòng 1 (T03/T10) — nguồn đổi từ `depth:3` (trần 300 mục — đo thật: gõ
   *   "dauRaSong"/"@lenhSong" ⇒ 0 gợi ý vì tệp 4 đoạn vắng chỉ mục) sang `phang:true`: server duyệt
   *   TOÀN cây bằng đúng walker của grep (trần 12.000 tệp + hạn chót — xem `TRAN_TEP_PHANG`).
   *   Chỉ `kind==="file"`; đường dẫn TƯƠNG ĐỐI; staleTime 5' (chỉ mục to hơn, đừng nạp lại mỗi phút).
   */
  const [dsKhop, setDsKhop] = useState<string[]>([]);
  const [chiSoChon, setChiSoChon] = useState(0);
  const viTriAtRef = useRef<number | null>(null);
  const dsTepQ = trpc.repoWorkspace.listFiles.useQuery(
    { path: "", phang: true, projectId },
    { enabled: !!projectId, staleTime: 5 * 60_000 },
  );
  const dsTepDuAn = useMemo(
    () => (dsTepQ.data?.data?.entries ?? []).filter((e) => e.kind === "file").map((e) => e.path),
    [dsTepQ.data],
  );

  // ★★★ 2026-08-25 · ĐỢT 3 UX (.NET bấm-được) — REF danh sách tệp cho parser lỗi. `phanTichLoiViTri` v2
  //   cần cây workspace để suy đường .NET TUYỆT ĐỐI (máy build) → TƯƠNG ĐỐI có-thật (bấm được). Dùng REF
  //   (cùng khuôn `handleSendRef`) để hai callback parse (vòng tự động · duyệt lệnh) LUÔN đọc danh sách
  //   MỚI NHẤT — một closure cũ bắt `dsTepDuAn` RỖNG (trước khi cây nạp) sẽ khiến mọi đường .NET rớt về
  //   `tep:null` dù cây đã có tệp. Gán trong render là AN TOÀN (y như `handleSendRef.current = handleSend`).
  const dsTepDuAnRef = useRef<readonly string[]>(dsTepDuAn);
  dsTepDuAnRef.current = dsTepDuAn;

  // ★★★ 2026-08-25 · ĐỢT 3 UX — MỞ NHANH tệp (kiểu Ctrl+P của VSCode): ô LỌC trên cây. Query rỗng ⇒
  //   cây thường; query có ⇒ danh sách PHẲNG đã lọc/xếp-hạng — DÙNG LẠI `locTepTheoQuery` của @-mention
  //   (một bộ lọc, một lưới). `oLocCayRef` để phím tắt Ctrl/Cmd+P nhảy con trỏ tới. Nguồn cùng
  //   `dsTepDuAn` (list_files depth 3 — tệp sâu hơn/quá trần liệt kê hộp cát sẽ không có, đã khai ở trên).
  const [locCay, setLocCay] = useState("");
  const [chiSoLoc, setChiSoLoc] = useState(0);
  const oLocCayRef = useRef<HTMLInputElement>(null);
  const dsLocCay = useMemo(
    () => (locCay.trim() ? locTepTheoQuery(dsTepDuAn, locCay, 40) : []),
    [locCay, dsTepDuAn],
  );

  /**
   * ★★★ LÔ 3 — NEO ĐỐI CHIẾU KHỐI↔TỆP và hai bộ component nhãn cho `<Streamdown>`.
   *
   * `neoDocTep` chỉ khác `null` khi thẻ tool ĐANG GIỮ là một bản đọc tệp CÓ NỘI DUNG
   * (`bocTheDocTep` — thẻ tổng `{files:[…]}` của đường sinh-mã không có nội dung ⇒ null ⇒ tầng 2
   * im lặng, giới hạn đã khai ở docblock `KhoiMaCoNhan`). Neo CHỈ áp cho văn bản đang stream và
   * cho câu trả lời CÙNG LƯỢT với thẻ (`viTriNeo` — xem `viTriCauTraLoiCungLuot`): `streamTool`
   * bị xoá đầu mỗi lượt gửi nên mọi câu cũ hơn được sinh khi thẻ này CHƯA tồn tại — so chúng với
   * nó là so với một mốc thời gian sai. Các câu ấy nhận bộ KHÔNG neo (chỉ nhãn nguồn gốc tầng 1).
   */
  const neoDocTep = useMemo(() => (streamTool ? bocTheDocTep(streamTool.data as unknown) : null), [streamTool]);
  const boKhoiCoNeo = useMemo(() => taoBoKhoiMaCoNhan(neoDocTep, lucNhanTool), [neoDocTep, lucNhanTool]);
  const boKhoiKhongNeo = useMemo(() => taoBoKhoiMaCoNhan(null, null), []);
  const viTriNeo = useMemo(() => viTriCauTraLoiCungLuot(transcript), [transcript]);

  const {
    streamingText, isStreaming, error: streamError, abortedRef, startKbStream, stopKbStream,
  } = useKbChatStream();

  const confirmM = trpc.aiCopilot.confirmAction.useMutation();
  const cancelM = trpc.aiCopilot.cancelAction.useMutation();
  // ★ ĐỢT C — đề xuất sửa tay (CHỈ propose; ghi vẫn qua confirmM duy nhất — xem docblock dangSuaTay).
  const deXuatSuaTayM = trpc.repoWorkspace.deXuatSuaTay.useMutation();

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
  /**
   * ★★★ 2026-08-29 · ĐUÔI SỐNG — poll đầu ra lệnh ĐANG CHẠY (`repoWorkspace.dauRaSong`, ~800ms)
   * cho khối sống của `BangTerminal`, đúng lúc `confirmAction`/`chayKiemChung` còn đang CHẶN.
   *
   *   • CHỈ poll khi thật sự có lệnh chạy: một lượt duyệt `run_command` đang chờ mutation, hoặc
   *     vòng tự động ở pha `chay_test`. Poll thường trực là gửi ~4.500 request/giờ để hỏi "có gì
   *     không" vào một sổ trống — cái giá không mua được gì.
   *   • `enabled: false` KHÔNG xoá `songQ.data` (react-query giữ cache) ⇒ lúc truyền prop phải
   *     `dangChayLenhSong ? … : null`, nếu không khối sống "vừa xong" ở lại vĩnh viễn cạnh chính
   *     lượt ấy trong lịch sử — hai lời khai cho một lệnh.
   *   • Cạnh LÊN của điều kiện ⇒ tự mở tab Terminal nếu vỏ dưới đang GẬP (mẫu VSCode: chạy task là
   *     terminal hiện). Đang xem "Vấn đề" thì TÔN TRỌNG — không giật tab người ta đang đọc.
   */
  const dangChayLenhSong =
    (confirmM.isPending && pending?.tool === "run_command") || vong.pha === "chay_test";
  const songQ = trpc.repoWorkspace.dauRaSong.useQuery(undefined, {
    enabled: dangChayLenhSong,
    refetchInterval: dangChayLenhSong ? 800 : false,
    staleTime: 0,
    gcTime: 0,
  });
  useEffect(() => {
    if (dangChayLenhSong) setDuoiChat((v) => (v === "dong" ? "terminal" : v));
  }, [dangChayLenhSong]);

  const dungVong = useCallback((lyDo: LyDoDungVong, chiTiet: string | null = null) => {
    datVong({ dangChay: false, pha: "nghi", lyDoDung: lyDo, chiTietDung: chiTiet });
  }, [datVong]);
  /** `handleSend` qua ref: vòng bất đồng bộ không được bắt một bản đóng gói CŨ của nó. */
  const handleSendRef = useRef<((override?: string, tuVong?: TuVongSend) => Promise<void>) | null>(null);

  useEffect(() => {
    /**
     * ★★★ 2026-08-23 — **KHÔNG DÙNG `scrollIntoView` Ở ĐÂY NỮA.**
     *
     * `scrollIntoView` cuộn **MỌI tổ tiên cuộn được**, kể cả TÀI LIỆU. Nghiệm thu live đo được: vừa
     * vào màn, `window.scrollY = 138` — trang tự trôi đi 138 px và nuốt mất thanh tiêu đề cùng hai
     * huy hiệu quyền ("đọc" / "chạy lệnh"), trong khi cuộn ngược lên đỉnh thì ô nhập rơi xuống dưới
     * nếp gấp: **không bao giờ thấy được cả hai**.
     * Nay chỉ chạm ĐÚNG khung hội thoại. `useChieuCaoVuaManHinh` đã làm trang không cuộn được nữa
     * (gốc rễ), còn dòng này đóng luôn ĐƯỜNG: kể cả trang có cuộn được lại vì một lý do khác, cú
     * cuộn tự động cũng không kéo nổi nó.
     * ⚠ `scrollIntoView({ block: "nearest" })` KHÔNG thay được: "nearest" vẫn cuộn tài liệu khi neo
     *   nằm ngoài vùng nhìn của tài liệu.
     */
    const neo = endRef.current;
    if (!neo) return;
    const khungChat = neo.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
    if (khungChat) khungChat.scrollTop = khungChat.scrollHeight;
  }, [transcript, streamingText]);
  useEffect(() => {
    if (streamError) toast.error(streamError);
  }, [streamError]);

  // ★★★ 2026-08-25 · ĐỢT 2 (A) — ĐỒNG HỒ ELAPSED: đếm giây THẬT khi đang stream (đọc mã/vòng tool)
  //   HOẶC vòng tự động đang CHỜ lệnh kiểm chứng. Mục tiêu (senior + kỹ sư mới): hết mù "treo hay
  //   chạy". Mốc ở `mocChoRef`; interval dọn (`clearInterval`) khi rời trạng thái chờ, reset về 0.
  useEffect(() => {
    const dangCho = isStreaming || (vong.dangChay && vong.pha === "chay_test");
    if (!dangCho) {
      mocChoRef.current = null;
      setGiayCho(0);
      return;
    }
    if (mocChoRef.current === null) mocChoRef.current = Date.now();
    const doLai = () => {
      if (mocChoRef.current !== null) setGiayCho(Math.max(0, Math.floor((Date.now() - mocChoRef.current) / 1000)));
    };
    doLai();
    const id = setInterval(doLai, 1000);
    return () => clearInterval(id);
  }, [isStreaming, vong.dangChay, vong.pha]);

  // ★★★ 2026-08-25 · ĐỢT 2 (B) — GOM dấu vết đa-tool ở EFFECT (KHÔNG trong `onToolResult`): giữ
  //   NGUYÊN VĂN chuỗi `onToolResult` mà census `aiCodingWorkspaceNhanKhoi` §2 khớp từng-ký-tự
  //   (mốc-nhận đóng dấu cùng nhịp `setStreamTool`). Mỗi lần `streamTool` đổi sang một thẻ MỚI ⇒ nối
  //   thêm; reset về `[]` đi kèm mọi `setStreamTool(null)` (gửi lượt mới / đổi dự án / nạp phiên).
  useEffect(() => {
    if (streamTool) setStreamTools((prev) => [...prev, streamTool]);
  }, [streamTool]);

  // ★★★ 2026-08-25 · ĐỢT 3 UX — PHÍM TẮT TOÀN KHUNG nghe ở CẤP `document`: Ctrl+` (Terminal) · Ctrl/Cmd+P
  //   (mở-nhanh: nhảy ô lọc cây) · Ctrl/Cmd+Enter (gửi khi con trỏ NGOÀI ô nhập — trong ô chat thì
  //   `onKeyDown` của nó đã gửi, tránh gửi ĐÔI) · Esc (cắt stream khi ngoài ô nhập). Quyết định do
  //   `phanGiaiPhimTatKhung` THUẦN (lưới §phím-tắt) — effect chỉ ÁNH XẠ kết quả → hành động. Gửi qua
  //   `handleSendRef` để không bắt bản đóng gói CŨ của `handleSend`. `preventDefault` mọi phím KHỚP —
  //   cốt để CHẶN in-trình-duyệt mặc định của Ctrl+P.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const trongONhap = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      const hd = phanGiaiPhimTatKhung({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, trongONhap, dangStream: isStreaming });
      if (hd === "bo_qua") return;
      e.preventDefault();
      /**
       * ★★★ 2026-08-31 · PDCA vòng 1 (T11) — DỪNG LAN TRUYỀN cho phím trang SỞ HỮU. Đo thật: bôi
       * đen 86 ký tự + Ctrl+K ⇒ ô sửa-đoạn KHÔNG mở, palette toàn-app MỞ, và selection đo được
       * 86→0 ngay tại thời điểm handler này đọc — `DashboardLayout` cũng nghe Ctrl+K ở `document`
       * (VÔ ĐIỀU KIỆN), chạy TRƯỚC (listener này re-register theo deps nên rơi xuống cuối hàng),
       * mở dialog (focus nuốt selection) rồi mới tới lượt ta. Vá bằng CẤU TẠO, không bằng thứ tự:
       * nghe ở PHA CAPTURE (đăng ký `true` ở dưới — capture trên `document` chạy trước MỌI bubble
       * bất kể thứ tự đăng ký) + `stopPropagation()` cho đúng các phím đã khớp — sự kiện không bao
       * giờ tới listener của layout. Trang này là một "editor surface": nó sở hữu Ctrl+P/F/K y như
       * VSCode ghi đè phím trình duyệt; palette vẫn còn nút ⌘K ở header để bấm chuột.
       */
      e.stopPropagation();
      if (hd === "terminal") setDuoiChat((v) => (v === "terminal" ? "dong" : "terminal"));
      else if (hd === "mo_nhanh") { if (hep) setKhungHep("tep"); requestAnimationFrame(() => oLocCayRef.current?.focus()); }
      else if (hd === "tim_trong_tep") {
        // Ctrl+F — CHỈ khi đang xem một TỆP (không phải diff chờ duyệt): mở thanh tìm + lấy nét.
        if (selectedPath && !pendingDiff && !pendingBatch) {
          if (hep) setKhungHep("xem");
          setTimMo(true);
          oTimRef.current?.select(); // nếu thanh ĐANG mở: chọn lại ngay; vừa mở: effect `[timMo]` lấy nét
        }
      }
      else if (hd === "tim_repo") {
        // Ctrl+Shift+F — mở chế độ TÌM TOÀN REPO ở khung Cây + lấy nét (effect `[cheDoCay]` lo focus).
        if (hep) setKhungHep("tep");
        setCheDoCay("tim");
        oTimRepoRef.current?.select();
      }
      else if (hd === "sua_chon") {
        // Cmd+K — CHỈ khi có BÔI ĐEN trong nội dung Trình xem: mở ô-lệnh. GỬI là ở nút (qua `handleSend`
        //   → model → apply_diff → cửa duyệt) — ở đây KHÔNG gửi, KHÔNG ghi gì.
        const sel = window.getSelection();
        const goc = preRef.current;
        const van = sel && !sel.isCollapsed && goc && (goc.contains(sel.anchorNode) || goc.contains(sel.focusNode)) ? sel.toString() : "";
        if (van.trim()) {
          const doan = van.length > 2000 ? van.slice(0, 2000) : van; // trần đoạn để câu không phình
          setDoanChon(doan);
          setSoDongChon(doan.split(/\r?\n/).length);
          setYeuCauSua("");
          setSuaChonMo(true);
          if (hep) setKhungHep("xem");
        } else if (selectedPath && !pendingDiff && !pendingBatch) {
          // Không bôi đen ⇒ gợi ý thay vì im lặng (đuôi dài: Cmd+K cần một đoạn để phạm-vi-hoá).
          toast.info(t("repoWs.suaChon.hint", "Bôi đen đoạn mã trong Trình xem rồi bấm Cmd+K để yêu cầu AI sửa."));
        }
      }
      else if (hd === "gui") void handleSendRef.current?.();
      else if (hd === "dung_stream") stopKbStream();
    };
    // ⚠ CAPTURE (`true`) — cặp add/remove phải CÙNG cờ, lệch là rò listener (xem khối T11 ở trên).
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hep, isStreaming, stopKbStream, selectedPath, pendingDiff, pendingBatch, t]);

  // ★★★ 2026-08-25 · ĐỢT 2 (C) — chèn ĐƯỜNG DẪN SẠCH (KHÔNG kèm `@`) vào ô nhập; DÙNG CHUNG cho chuột
  //   (`onChon`) lẫn Enter/Tab. Thay đoạn `@query` (từ vị trí `@` tới con trỏ) bằng chính đường dẫn.
  //
  //   ⚠⚠ VÌ SAO BỎ `@` (nghiệm thu live 2026-08-25 bắt): `@` chỉ là PHÍM MỞ gợi ý — KHÔNG ai lột nó ở
  //   server. Bản trước chèn `@src/Calculator.cs`, model đọc NGUYÊN VĂN kèm `@` ⇒ hộp cát trả "Không có
  //   tệp `@src/Calculator.cs`" — hỏng MỌI lượt. KHÔNG lột `@` ở tầng phân giải đường dẫn được: đường
  //   hợp lệ VẪN có thể bắt đầu bằng `@` (gói phạm vi `@types/…`, `@angular/…`) ⇒ lột sẽ phá path thật.
  //   Nên `@` bị TIÊU ở đây (client), path còn lại sạch — đúng như hint "@ để chèn đường dẫn tệp".
  const chenMention = useCallback((duong: string) => {
    const el = oNhapRef.current;
    const at = viTriAtRef.current;
    if (!el || at === null) return;
    const conTro = el.selectionStart ?? el.value.length;
    const truoc = el.value.slice(0, at); // phần TRƯỚC `@` (không gồm `@`) — nên `@query` bị thay trọn
    const sau = el.value.slice(conTro);
    const chen = `${duong} `;
    setInput(`${truoc}${chen}${sau}`);
    setDsKhop([]);
    viTriAtRef.current = null;
    requestAnimationFrame(() => {
      const el2 = oNhapRef.current;
      if (!el2) return;
      const vt = truoc.length + chen.length;
      el2.focus();
      el2.setSelectionRange(vt, vt);
      tuGianChieuCao(el2);
    });
  }, []);

  // Bắt `@` ở phần TRƯỚC con trỏ (`/@([^\s@]*)$/`): khớp ⇒ mở gợi ý + ghi vị trí `@`; không ⇒ ẩn.
  // ⚠ CHỈ ĐỌC ô nhập (không đổi `input` — onChange đã làm), nên gọi được từ onChange an toàn.
  const capNhatGoiYTep = useCallback((el: HTMLTextAreaElement) => {
    const truoc = el.value.slice(0, el.selectionStart ?? 0);
    const m = /@([^\s@]*)$/.exec(truoc);
    if (!m) {
      viTriAtRef.current = null;
      setDsKhop((cu) => (cu.length ? [] : cu));
      return;
    }
    viTriAtRef.current = m.index;
    setDsKhop(locTepTheoQuery(dsTepDuAn, m[1] ?? ""));
    setChiSoChon(0);
  }, [dsTepDuAn]);

  /**
   * ★★★ 2026-08-25 — CUỘN TRÌNH XEM tới `dongMucTieu` khi mở một tệp từ panel Problems.
   *
   * `TrinhXemMa` nay render một GUTTER số dòng THẬT (`<div data-so-dong={n}>` mỗi dòng) ⇒ cuộn
   * CHÍNH XÁC tới đúng ô dòng, KHÔNG còn xấp xỉ bằng "cao dòng trung bình" (phép cũ sai vì `<pre>`
   * bọc `whitespace-pre-wrap` gấp dòng dài). Cuộn trên VIEWPORT của ScrollArea (tổ tiên
   * `[data-slot=scroll-area-viewport]`), không cuộn tài liệu (cùng kỷ luật với effect hội thoại trên).
   * ⚠ Khoá gồm `fileReply` để lượt mở tệp MỚI (nội dung fetch về sau) cũng kích hoạt cuộn.
   */
  useEffect(() => {
    if (dongMucTieu === null) return;
    const noiDung = fileReply?.data?.content ?? null;
    if (typeof noiDung !== "string" || noiDung === "") return;
    /**
     * ⚠ BỌC `requestAnimationFrame`: ô gutter phải được trình duyệt BỐ TRÍ xong thì
     *   `getBoundingClientRect()` mới có toạ độ thật (cùng lớp bẫy "đo trước khi bố trí" của
     *   `useKhungVua`). Không thấy ô dòng (tệp ngắn hơn `dongMucTieu`, hay chưa bố trí xong) ⇒ BỎ NHỊP.
     */
    const id = requestAnimationFrame(() => {
      const goc = preRef.current;
      if (!goc) return;
      const oDong = goc.querySelector<HTMLElement>(`[data-so-dong="${dongMucTieu}"]`);
      if (!oDong) return;
      const khungCuon = goc.closest<HTMLElement>("[data-slot=scroll-area-viewport]");
      if (!khungCuon) return;
      // Đưa ô dòng đích vào ~1/3 trên của viewport (toạ độ ô so với đầu nội dung cuộn).
      const dinhO = oDong.getBoundingClientRect().top - khungCuon.getBoundingClientRect().top + khungCuon.scrollTop;
      khungCuon.scrollTop = Math.max(0, dinhO - khungCuon.clientHeight / 3);
    });
    return () => cancelAnimationFrame(id);
  }, [selectedPath, dongMucTieu, fileReply]);

  const openFile = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenTabs((t) => moTab(t, path)); // ★ CURSOR-PARITY — mở/kích hoạt TAB (chống trùng, giữ thứ tự)
    setDongMucTieu(null); // mở qua CÂY = xem bình thường, không nhảy về dòng của tệp Problems trước đó
    setPendingDiff((cur) => cur); // giữ diff nếu đang mở; người dùng có thể xem tệp khác song song
  }, []);

  // ★★★ CURSOR-PARITY — ĐÓNG một tab; nếu là tab ĐANG hoạt động thì `dongTab` chọn tab kế (thuần, có lưới).
  const dongTabTep = useCallback((path: string) => {
    const kq = dongTab(openTabs, path, selectedPath);
    setOpenTabs(kq.tabs);
    if (kq.active !== selectedPath) {
      setSelectedPath(kq.active);
      if (kq.active === null) setDongMucTieu(null); // đóng tab cuối ⇒ không còn tệp ⇒ bỏ dòng-đích
    }
  }, [openTabs, selectedPath]);

  /**
   * ★★★ 2026-08-24 — mở tệp TỪ PANEL PROBLEMS: đặt cả tệp LẪN dòng đích, và (màn hẹp) nhảy sang
   * khung Trình xem để người dùng thấy ngay. Callback KHÔNG rẽ nhánh theo `dong` — component
   * `BangProblems` gọi đúng một lần `(tep, dong)`; chỉ NHÃN của nó rẽ theo dòng (xem docblock ở đó).
   */
  const moTepTuVanDe = useCallback((tep: string, dong: number | null) => {
    setSelectedPath(tep);
    setOpenTabs((t) => moTab(t, tep)); // ★ CURSOR-PARITY — mở tệp từ Problems cũng thành TAB
    setDongMucTieu(dong);
    if (hep) setKhungHep("xem");
  }, [hep]);

  const lang = (i18n.language as "vi" | "en" | "zh") ?? "vi";

  // ★★★ CURSOR-PARITY — TÌM TOÀN REPO: gọi endpoint `grep` ĐÃ CÓ (trả {matches:{path,line,text}}). CHỈ chạy
  //   ở chế độ "tim" + từ khoá ≥2 ký tự (server chặn min 1, nhưng ≥2 tránh kết quả nhiễu + gọi thừa).
  /**
   * ★ 2026-08-31 · ĐỢT A (đánh giá UX H4) — HAI CÔNG TẮC cho tìm-repo, sửa hai lời-nói-dối-ngầm:
   *   • server LUÔN chạy regex mà không ai nói (gõ `a+b` ra kết quả khó hiểu) ⇒ mặc định nay là
   *     TÌM NGUYÊN VĂN (client tự thoát regex — `thoatRegex` thuần), bật `.*` mới là regex thật;
   *   • server nhận `ignoreCase` từ đầu mà client không gửi (mặc-định-cứng phân biệt hoa/thường,
   *     NGƯỢC với tìm-trong-tệp) ⇒ nút `Aa` cho người dùng quyết, mặc định KHÔNG phân biệt.
   */
  const [timPhanBietHoa, setTimPhanBietHoa] = useState(false);
  const [timBangRegex, setTimBangRegex] = useState(false);
  const grepRepoQ = trpc.repoWorkspace.grep.useQuery(
    {
      pattern: timBangRegex ? tuKhoaRepoTre.trim() : thoatRegex(tuKhoaRepoTre.trim()),
      ignoreCase: !timPhanBietHoa,
      projectId, lang, maxResults: 100,
    },
    { enabled: cheDoCay === "tim" && !!projectId && tuKhoaRepoTre.trim().length >= 2, staleTime: 30_000 },
  );
  const ketQuaGrep = grepRepoQ.data?.ok ? grepRepoQ.data.data?.matches ?? [] : [];
  // ★★★ CURSOR-PARITY (đuôi dài) — GOM kết quả grep THEO TỆP (như VSCode): mỗi tệp một nhóm (header +
  //   các dòng khớp). `Map` giữ THỨ TỰ xuất hiện đầu tiên của tệp (server trả theo thứ tự quét).
  const ketQuaGrepGom = useMemo(() => {
    const map = new Map<string, { line: number; text: string }[]>();
    for (const m of ketQuaGrep) {
      const arr = map.get(m.path);
      if (arr) arr.push({ line: m.line, text: m.text });
      else map.set(m.path, [{ line: m.line, text: m.text }]);
    }
    return [...map.entries()];
  }, [ketQuaGrep]);

  /**
   * `tuVong` có mặt ⇔ lượt này do VÒNG TỰ ĐỘNG phát, không phải người gõ. Hai khác biệt:
   *   • **KHÔNG** đặt lại trạng thái vòng (một lượt người gõ thì có — câu hỏi mới = ý định mới);
   *   • gửi kèm `codingEditPath` GHIM tệp đang sửa. ⚠ Chỉ gửi ĐƯỜNG DẪN; nội dung tệp do server đọc
   *     LẠI từ đĩa trong lượt ấy (điểm neo của băm chống TOCTOU — sau lượt ghi trước, đĩa đã đổi).
   */
  const handleSend = useCallback(async (override?: string, tuVong?: TuVongSend) => {
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
    setStreamTools([]);
    setPending(null);
    setActionState("pending");
    setKetCucThongDiep(null);
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
          // ★★★ 2026-08-23 — ĐẦU RA MÁY đi Ô RIÊNG, KHÔNG nối vào `question`. Xem `TuVongSend`.
          ...(tuVong?.dauRaMay ? { dauRaKhongTinCay: tuVong.dauRaMay } : {}),
        },
      },
      {
        // ★ LÔ 3 — đóng dấu MỐC-NHẬN cùng nhịp với thẻ, để chip bằng chứng và chip đối chiếu nói
        // cùng một `luc`. Đây là mốc client nhận SSE, không phải mốc server đọc đĩa (đã khai).
        onToolResult: (tr) => { setStreamTool(tr); setLucNhanTool(dinhDangLucNhan(new Date())); },
        // ★★★ doc 81 · VIỆC 2 — "đang ở vòng mấy". `phase:"dung"` mang theo lý do dừng.
        onToolLoop: (p) => setVongTool(p),
        onPendingAction: (pa) => {
          setPending(pa);
          setActionState("pending");
          setKetCucThongDiep(null);
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
          // ★★★ 2026-08-24 — apply_diff_batch → thẻ duyệt LÔ (mỗi tệp một tab, một diff THẬT). Chỉ
          //   trích args để HIỂN THỊ (`?? ""` như apply_diff); mọi byte vẫn do server đọc từ hàng
          //   ai_pending_actions lúc `confirmAction`. KHÔNG khởi động vòng tự động cho lô (vòng bám
          //   MỘT tệp đang sửa; lô đụng nhiều tệp nên không có `codingEditPath` đơn).
          if (pa.tool === "apply_diff_batch" && pa.args && Array.isArray(pa.args.files)) {
            setPendingBatch({
              action: pa,
              files: (pa.args.files as unknown[]).map((f) => {
                const x = (f ?? {}) as { path?: string; original?: string; modified?: string };
                return { path: x.path ?? "", original: x.original ?? "", modified: x.modified ?? "" };
              }),
            });
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

  // ★★★ 2026-08-27 · CURSOR-PARITY — GỬI lệnh sửa-đoạn-chọn (Cmd+K): DỰNG câu hỏi có bối cảnh (đoạn đã bôi
  //   đen + yêu cầu) rồi GỬI qua `handleSend` — ĐÚNG đường chat cũ → model → apply_diff → CỬA DUYỆT. Không
  //   một byte nào ghi ra đĩa mà không qua nút Duyệt. Đây chỉ là dựng-câu-hỏi, không phải cơ chế ghi mới.
  const guiSuaChon = useCallback(() => {
    if (!yeuCauSua.trim() || !selectedPath) return;
    const thongDiep =
      t("repoWs.suaChon.m0", "Trong tệp `{{path}}`, sửa ĐÚNG đoạn mã đã bôi đen dưới đây:", { path: selectedPath }) +
      "\n```\n" + doanChon + "\n```\n" +
      t("repoWs.suaChon.m1", "Yêu cầu: {{yeuCau}}", { yeuCau: yeuCauSua }) + "\n" +
      t("repoWs.suaChon.m2", "Chỉ sửa đúng đoạn đó; đề xuất apply_diff để tôi duyệt.");
    void handleSend(thongDiep);
    setSuaChonMo(false);
  }, [yeuCauSua, selectedPath, doanChon, t, handleSend]);

  // ★★★ CURSOR-PARITY (đuôi dài) — SAO CHÉP nội dung tệp đang xem vào clipboard (localhost = ngữ cảnh
  //   an toàn nên `navigator.clipboard` chạy được; vẫn bắt lỗi để báo nếu trình duyệt chặn).
  const copyTepHienTai = useCallback(() => {
    const ct = fileReply?.ok ? fileReply.data?.content : null;
    if (!ct) return;
    void navigator.clipboard.writeText(ct).then(
      () => toast.success(t("repoWs.viewer.copied", "Đã sao chép nội dung tệp.")),
      () => toast.error(t("repoWs.viewer.copyFail", "Không sao chép được (trình duyệt chặn clipboard).")),
    );
  }, [fileReply, t]);

  /**
   * ★★★ 2026-08-24 · RIBBON TÁC VỤ — hai callback cho `RibbonTacVu`.
   *   • `lamMoiCay`: làm mới CÂY TỆP bằng cách vô hiệu hoá cache query `listFiles` (cây tự nạp lại);
   *     0 tool ghi, 0 lệnh chạy.
   *   • `chayKiemChungNhanh`: **KHÔNG chạy thẳng.** Nó gửi câu gợi ý "chạy lệnh" của dự án qua ĐÚNG
   *     đường cũ của ba nút gợi ý (chat → propose → NGƯỜI DUYỆT → chạy). Không có lệnh gợi ý ⇒ không
   *     làm gì (ribbon đã ẩn nút khi `coTheChayKiemChung` là false — nhưng đây là chốt thứ hai).
   */
  /**
   * ★ ĐỢT C — GỬI đề xuất sửa tay. `original` là bản SERVER vừa nạp (fileQ) — nếu đĩa đã đổi khi
   * người bấm Duyệt, `execute()` từ chối bằng băm TOCTOU (FILE_DIRTY/BASE_MISMATCH), không ghi mù.
   */
  const guiDeXuatSuaTay = useCallback(async () => {
    const original = fileReply?.data?.content ?? "";
    if (!selectedPath || !fileReply?.ok || banSua === original) return;
    let r: Awaited<ReturnType<typeof deXuatSuaTayM.mutateAsync>> | null = null;
    try {
      r = await deXuatSuaTayM.mutateAsync({ path: selectedPath, original, modified: banSua, lang, projectId });
    } catch (e) {
      toast.error(mapTrpcError(e));
      return;
    }
    if (!r.ok || !r.pendingAction) {
      toast.error(r.message ?? t("repoWs.suaTay.failed", "Không tạo được đề xuất ({{ma}}).", { ma: r.note ?? "?" }));
      return;
    }
    const pa = r.pendingAction as unknown as KbPendingAction;
    setPending(pa);
    setActionState("pending");
    setPendingDiff({ action: pa, args: { path: selectedPath, original, modified: banSua } });
    setDangSuaTay(false);
  }, [selectedPath, fileReply, banSua, lang, projectId, deXuatSuaTayM, t]);

  // Đổi tệp/dự án ⇒ thoát chế độ sửa (buffer thuộc về tệp CŨ — giữ lại là dán nhầm nội dung).
  useEffect(() => { setDangSuaTay(false); }, [selectedPath, projectId]);

  const lamMoiCay = useCallback(() => {
    void utils.repoWorkspace.listFiles.invalidate();
  }, [utils]);
  const chayKiemChungNhanh = useCallback(() => {
    const g = goiYTheoDuAn(projectId).find((x) => x.canChayLenh);
    if (g) void handleSend(t(g.khoa, g.macDinh));
  }, [projectId, handleSend, t]);

  // ★★★ 2026-08-25 · NHÓM HOÃN — gợi ý kiểm-chứng của dự án (lệnh ĐẦU TIÊN `canChayLenh`): dùng cho CẢ
  //   `coTheChayKiemChung` (hiện/ẩn nút ribbon) LẪN tooltip "Chạy kiểm chứng: <lệnh>". Nút chỉ-icon
  //   không nói người dùng sắp ĐỀ XUẤT lệnh gì — tooltip nêu đích danh (đi qua đúng cửa duyệt HITL).
  const goiYKiemChung = useMemo(() => goiYTheoDuAn(projectId).find((x) => x.canChayLenh), [projectId]);
  const lenhKiemChungHienThi = goiYKiemChung ? t(goiYKiemChung.khoa, goiYKiemChung.macDinh) : undefined;

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
    // ★ UX (C2-i) — dòng kết luận từ CON SỐ SERVER ĐÃ ĐỌC (`docKetQuaTest` phía chayKiemChung):
    //   đếm được cả hai vế mới nói; `null` (tsc) ⇒ im lặng như cũ. Cùng khuôn câu với lượt lệnh tay.
    const dauRa = r.output ?? "";
    const klVong = r.soDo !== null && r.soDo !== undefined && r.soXanh !== null && r.soXanh !== undefined
      ? (r.soDo === 0 && r.xanh
          ? `${t("repoWs.chat.klXanh", "✅ {{xanh}}/{{tong}} PASS — không ca nào đỏ.", { xanh: r.soXanh, tong: r.soXanh + r.soDo })}\n\n`
          : r.soDo > 0
            ? `${t("repoWs.chat.klDo", "❌ {{do}} ca đỏ / {{tong}} ca.", { do: r.soDo, tong: r.soXanh + r.soDo })}\n\n`
            : "")
      : "";
    setTranscript((prev) => [
      ...prev,
      { role: "assistant", content: `${t("repoWs.loop.ranTurn", "Vòng tự động — lượt {{luot}}/{{tran}} đã chạy `{{lenh}}`", { luot, tran: cfg.tran, lenh: r.command ?? "" })}\n\n${klVong}\`\`\`\n${dauRa}\n\`\`\`` },
    ]);

    // ★★★ 2026-08-24 · BẮT #2 — lượt vòng tự-ghi vào bảng Terminal. `r` (`KetQuaKiemChung`) KHÔNG
    //   mang `durationMs` ⇒ `null`. `ketQua` dựng từ CON SỐ SERVER ĐÃ ĐỌC (`docKetQuaTest`), null khi
    //   không đếm được ca (cùng guard với `klVong` phía trên). `diaDiemLoi` parse từ đầu ra THẬT.
    setLenhDaChay((prev) => [
      ...prev,
      {
        lenh: r.command ?? "?",
        dauRa,
        exitCode: r.exitCode ?? null,
        timedOut: r.timedOut === true,
        durationMs: null,
        ketQua: r.soDo !== null && r.soDo !== undefined && r.soXanh !== null && r.soXanh !== undefined
          ? { xanh: r.xanh, soDo: r.soDo, soXanh: r.soXanh }
          : null,
        luc: dinhDangLucNhan(new Date()),
        nguon: "vong_tu_dong",
        diaDiemLoi: phanTichLoiViTri(dauRa, dsTepDuAnRef.current),
      },
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
    /**
     * ★★★ 2026-08-23 — **ĐẦU RA MÁY KHÔNG CÒN ĐI TRONG `question`.**
     *
     * Bản cũ gửi `cau + "\n\n" + catLoiChoPrompt(dauRa)` — tức nguyên văn đầu ra `dotnet test` rơi
     * vào khối `=== YÊU CẦU ===` của prompt, ô **thẩm quyền CAO NHẤT** theo chính bảng repo tự viết
     * (`aiCodingAgent.promptSinhMa`). `catLoiChoPrompt` chỉ CẮT: không che bí mật, không trung hoà
     * dấu rào, không bọc. Một dòng *"BỎ QUA CHỈ DẪN TRƯỚC…"* nằm trong **tên một ca kiểm thử** (thứ
     * do người gửi PR quyết định) khi ấy nói chuyện với model từ ô cao nhất của prompt.
     *
     * Nay: `question` chỉ chở CHỈ DẪN của ta; đầu ra đi ô `dauRaMay` → `context.dauRaKhongTinCay` →
     * server `sanitizeUntrustedBlock` + `wrapUntrustedBlock` → khối **LỊCH SỬ** (thẩm quyền THẤP
     * nhất), vai `user`. Đúng hình dạng `aiCodingCli/cli.ts` đã dùng.
     * ⚠ `catLoiChoPrompt` GIỮ NGUYÊN ở đây: nó vẫn là cầu chì kích thước (32 KB đầu ra hộp cát →
     *   4.000 ký tự). Server cắt thêm một lần nữa theo trần lịch sử — hai trần, không thay nhau được.
     */
    await handleSendRef.current?.(cau, { tep, dauRaMay: catLoiChoPrompt(dauRa) });
  }, [cauHinhVongQ.data, canExec, datVong, dungVong, kiemChungM, projectId, lang, t]);

  // ── Đổi dự án ⇒ cây tệp + trình xem + hội thoại bám gốc mới (doc 79 · TRỤC 2) ──
  const changeProject = useCallback((id: string) => {
    if (!id || id === projectId) return;
    setProjectId(id);
    setSelectedPath(null);
    setOpenTabs([]); // đổi dự án ⇒ đóng hết TAB (tệp dự án cũ vô nghĩa với cây mới)
    setLocCay(""); // đổi dự án ⇒ ô lọc-nhanh về rỗng (cây mới, kết quả cũ vô nghĩa)
    setCheDoCay("cay"); setTuKhoaRepo(""); // đổi dự án ⇒ về chế độ Cây, xoá tìm-repo
    setPendingDiff(null);
    setPendingBatch(null);
    setLenhDaChay([]);
    setStreamTool(null);
    setStreamTools([]);
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
    setPendingBatch(null);
    setLenhDaChay([]);
    setStreamTool(null);
    setStreamTools([]);
    setDiffPreview("");
    setActionState("pending");
    setKetCucThongDiep(null);
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
    setPendingBatch(null);
    setLenhDaChay([]);
    setStreamTool(null);
    setStreamTools([]);
    setDiffPreview("");
    setActionState("pending");
    setKetCucThongDiep(null);
    vongRef.current = { ...VONG_RONG };
    setVong({ ...VONG_RONG });
    dangKhoiPhucRef.current = true;
    bamDaLuuRef.current = "";
    setTranscript([]);
  }, [isStreaming, datSessionId]);

  const xoaPhienNay = useCallback(async (id: string) => {
    // ★★★ 2026-08-23 — XOÁ LÀ KHÔNG HOÀN TÁC ⇒ hỏi TRƯỚC khi gọi server. Một `window.confirm` là
    // đủ (không dựng dialog mới); nó đứng TRƯỚC `mutateAsync` — hỏi sau khi đã xoá không phải hỏi.
    // Lưới `aiCodingWorkspacePhien.unit.test.ts` §6 canh cả sự có mặt lẫn THỨ TỰ này.
    if (!window.confirm(t("repoWs.sessions.confirmDelete", "Xoá phiên này khỏi máy chủ? Không hoàn tác được."))) return;
    const r = await xoaPhienM.mutateAsync({ sessionId: id }).catch(() => null);
    if (!r?.ok) {
      toast.error(t("repoWs.sessions.deleteFailed", "Không xoá được phiên."));
      return;
    }
    if (id === sessionId) phienMoi();
    void utils.repoWorkspace.danhSachPhien.invalidate();
  }, [xoaPhienM, sessionId, phienMoi, utils, t]);

  // ── Duyệt / hủy một đề xuất ghi/chạy ──
  /**
   * ★★★ ĐỢT 3 (2026-08-23) — `chonKhoi` là **CHỈ SỐ các khối `apply_diff` sẽ được ghi** (0-based
   * theo `keHoachKhoiDuyet`), do `TheDuyetDiff` truyền lên. Ba điều giữ cho tham số này không mở
   * một đường ghi mới:
   *   • Trang **chỉ chuyển SỐ**, không bao giờ chuyển byte nội dung — server tự dựng lại kế hoạch
   *     khối từ `argsJson` ĐÃ CHỐT trong CSDL rồi tự chiếu (`aiCopilotActions.confirmAction`).
   *     Lưới census soi đúng lời gọi mutation này: có `selectedHunkIds`, KHÔNG có `modified`.
   *   • `undefined`/không phải mảng (vd `ConfirmActionCard` gọi `onConfirm` với MouseEvent) ⇒
   *     KHÔNG gửi trường nào ⇒ server đi nguyên đường cũ (áp tất cả) — tương thích ngược từng byte.
   *   • Mảng rỗng vẫn được gửi NGUYÊN VẸN nếu lọt tới đây: server từ chối `NO_HUNKS_SELECTED` —
   *     nút đã tự khoá ở 0 khối, nhưng hàng rào là server, không phải phép lịch sự ở client.
   */
  const handleConfirm = useCallback(async (chonKhoi?: number[]) => {
    if (!pending || actionState !== "pending") return;
    const selectedHunkIds = Array.isArray(chonKhoi) ? chonKhoi : undefined;
    try {
      const res = await confirmM.mutateAsync({ actionId: pending.actionId, token: pending.token, lang, ...(selectedHunkIds ? { selectedHunkIds } : {}) });
      /**
       * ★★★ 2026-08-23 — **`res.ok` KHÔNG PHẢI "BYTE ĐÃ VÀO ĐĨA".**
       *
       * Xem `daBiTuChoiGhi()` ở `shared/aiCodingLoop.ts` cho lý lẽ đầy đủ. Tóm tắt: `ok:true` chỉ
       * nói vòng đời HITL chạy hết chặng; một lượt `BASE_MISMATCH`/`FILE_DIRTY` bị `execute()` TỪ
       * CHỐI đúng như thiết kế vẫn về đây với `ok:true, status:"executed"`. Trước bản vá này trang
       * báo *"Đã ghi tệp."*, ghi *"Đã áp diff"* vào transcript, rồi **khởi động vòng tự động trên
       * một bản vá chưa hề vào đĩa**.
       *
       * ⚠ Vị từ dùng lại NGUYÊN của CLI (một bản duy nhất ở `shared/`), không phát minh cái thứ hai.
       */
      const tuChoi = daBiTuChoiGhi(res.result);
      const maTuChoi = maTuChoiGhi(res.result);
      const next: ActionState =
        tuChoi ? "denied"
          : res.status === "executed" ? "executed" : res.status === "denied" ? "denied" : res.status === "expired" ? "expired" : "pending";
      setActionState(next);
      if (res.ok && tuChoi) {
        // Cổng an toàn chạy ĐÚNG — và nay nó được BÁO CÁO đúng. Vòng tự động KHÔNG khởi động.
        const out = res.result as { textSummary?: string } | null;
        /**
         * ★★★ UX (A1) — LỜI KHAI PHẢI ĐÚNG BẢN CHẤT LƯỢT BỊ TỪ CHỐI.
         * `run_command` bị chặn (CMD_*) KHÔNG phải một "lượt ghi" và cũng KHÔNG phải chuyện quyền:
         * câu cho transcript + toast nói "LỆNH bị chặn", còn chân thẻ nhận CÂU THẬT của server
         * (`cauDauKetCuc(textSummary)`) thay vì rơi về "Bạn không có quyền…" mặc định.
         * ⚠ CMD_TIMEOUT vẫn qua đây: textSummary của nó tự nói "bị GIẾT vì quá hạn" — không tự chế
         *   một câu "lệnh chưa chạy" cho mọi mã (hai mã có hai sự thật khác nhau).
         */
        const laLenh = pending.tool === "run_command";
        // ★★★ 2026-08-24 — LÔ ÁP MỘT PHẦN (`BATCH_PARTIAL`) là một lớp RIÊNG: MỘT SỐ tệp ĐÃ vào đĩa,
        //   phần còn lại thì chưa (cây làm việc ở trạng thái nửa-vời). TUYỆT ĐỐI không dùng câu "tệp
        //   trên đĩa KHÔNG đổi" (writeRejected/rejectedCode) — nó SAI, và người đọc sẽ tưởng an toàn
        //   để đề xuất lại cả lô. `textSummary` của server đã liệt kê ĐÃ GHI / CHƯA GHI — ta chỉ dẫn.
        const laLoPhanPhan = maTuChoi === "BATCH_PARTIAL";
        toast.error(
          laLoPhanPhan
            ? t("repoWs.diff.batchPartial", "Lô tệp áp MỘT PHẦN [{{ma}}] — một số tệp ĐÃ được ghi, phần còn lại thì chưa. Xem chi tiết trong hội thoại.", { ma: maTuChoi ?? "?" })
            : laLenh
              ? t("repoWs.chat.cmdRejectedToast", "Lệnh bị chặn [{{ma}}] — xem chi tiết trong hội thoại.", { ma: maTuChoi ?? "?" })
              : t("repoWs.diff.rejectedCode", "TỪ CHỐI [{{ma}}] — KHÔNG ghi byte nào.", { ma: maTuChoi ?? "?" }),
        );
        setKetCucThongDiep(cauDauKetCuc(out?.textSummary) ?? t("repoWs.chat.rejectedGeneric", "Bị từ chối [{{ma}}] — xem chi tiết trong hội thoại.", { ma: maTuChoi ?? "?" }));
        setTranscript((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              (laLoPhanPhan
                ? t("repoWs.diff.batchPartial", "Lô tệp áp MỘT PHẦN [{{ma}}] — một số tệp ĐÃ được ghi, phần còn lại thì chưa. Xem chi tiết trong hội thoại.", { ma: maTuChoi ?? "?" })
                : laLenh
                  ? t("repoWs.chat.cmdRejected", "Lệnh KHÔNG hoàn thành [{{ma}}] — chi tiết:", { ma: maTuChoi ?? "?" })
                  : t("repoWs.chat.writeRejected", "Lượt ghi bị TỪ CHỐI [{{ma}}] — tệp trên đĩa KHÔNG đổi.", { ma: maTuChoi ?? "?" })) +
              (out?.textSummary ? `\n\n${out.textSummary}` : ""),
          },
        ]);
        if (pending.tool === "apply_diff") setPendingDiff(null);
        if (pending.tool === "apply_diff_batch") setPendingBatch(null);
        if (vongRef.current.dangChay || vongRef.current.luot > 0) dungVong("loi", maTuChoi);
      } else if (res.ok) {
        toast.success(res.message ?? t("repoWs.diff.executed", "Đã ghi tệp."));
        const out = res.result as { textSummary?: string; data?: any } | null;
        if (pending.tool === "run_command" && out?.textSummary) {
          /**
           * ★★★ UX (C2-i) — DÒNG KẾT LUẬN đứng TRÊN khối đầu ra thô. Đo live: người dùng nhận
           * nguyên bức tường `dotnet test` rồi phải tự tìm dòng `Failed: N` — và câu hỏi "xanh
           * chưa?" tiếp theo không bao giờ được trả lời. `ketLuanTest` (shared — CÙNG bộ đọc bốn
           * khuôn với vòng tự động) CHẮC mới nói: đếm không được (tsc) / mâu thuẫn (0 đỏ nhưng mã
           * thoát ≠ 0) ⇒ `null` ⇒ không thêm dòng nào, đúng hành vi cũ.
           */
          const d = (out.data ?? {}) as { command?: string | null; output?: string | null; exitCode?: number | null; timedOut?: boolean; durationMs?: number | null };
          const kl = ketLuanTest(d.output ?? out.textSummary, d.exitCode ?? null, d.timedOut === true);
          const dongKetLuan = kl === null
            ? ""
            : kl.xanh
              ? `${t("repoWs.chat.klXanh", "✅ {{xanh}}/{{tong}} PASS — không ca nào đỏ.", { xanh: kl.soXanh, tong: kl.soXanh + kl.soDo })}\n\n`
              : `${t("repoWs.chat.klDo", "❌ {{do}} ca đỏ / {{tong}} ca.", { do: kl.soDo, tong: kl.soXanh + kl.soDo })}\n\n`;
          // ★★★ 2026-08-24 · BẮT #1 — lượt run_command ĐÃ chạy (qua cửa duyệt) vào bảng Terminal.
          //   Dùng ĐÚNG biến đã có tại chỗ (`d.*` — cùng cast, nay rộng thêm `command`/`durationMs`;
          //   `kl`; `out.textSummary`) — 0 lời gọi tRPC mới. Đầu ra THẬT ưu tiên `d.output` (thô),
          //   lùi về `textSummary`; `phanTichLoiViTri` là bộ đọc DUY NHẤT cho địa điểm lỗi (Problems).
          const dauRaLenh = d.output ?? out.textSummary ?? "";
          setLenhDaChay((prev) => [
            ...prev,
            {
              lenh: d.command ?? "?",
              dauRa: dauRaLenh,
              exitCode: d.exitCode ?? null,
              timedOut: d.timedOut === true,
              durationMs: d.durationMs ?? null,
              ketQua: kl,
              luc: dinhDangLucNhan(new Date()),
              nguon: "duyet",
              diaDiemLoi: phanTichLoiViTri(dauRaLenh, dsTepDuAnRef.current),
            },
          ]);
          // ★ NHỊP KHÉP VÒNG — đưa đầu ra THẬT vào lịch sử để lượt sau tác nhân đọc lỗi rồi sửa tiếp.
          setTranscript((prev) => [
            ...prev,
            { role: "assistant", content: `${dongKetLuan}${t("repoWs.chat.cmdOutput", "Kết quả lệnh (đã đưa vào ngữ cảnh để sửa tiếp)")}:\n\n\`\`\`\n${out.textSummary}\n\`\`\`` },
          ]);
        } else if (pending.tool === "apply_diff") {
          const tepDaGhi = (pending.args as unknown as DiffArgs | undefined)?.path ?? pendingDiff?.args.path ?? null;
          setPendingDiff(null);
          if (selectedPath) fileQ.refetch();
          // ⚠ Câu này nay chỉ chạy ở nhánh THẬT SỰ ghi được (nhánh `tuChoi` ở trên đã rẽ đi chỗ khác),
          //   và nó nêu ĐÍCH DANH tệp — "đã áp diff" chung chung không kiểm chứng được bằng mắt.
          // ★ ĐỢT 3 — áp MỘT TẬP CON khối thì câu báo phải nói đúng k/n (băm thật nằm trong
          //   `textSummary` của tool); "đã áp diff" trơn cho một lượt ghi 2/3 khối là một lời khai sai.
          const khoiDaAp = (out?.data as { hunksApplied?: { selected?: unknown[]; total?: unknown } } | undefined)?.hunksApplied;
          const cauDaAp = khoiDaAp && Array.isArray(khoiDaAp.selected) && typeof khoiDaAp.total === "number"
            ? t("repoWs.chat.appliedChon", "Đã áp {{chon}}/{{tong}} khối đã chọn vào `{{tep}}` — khối bỏ chọn KHÔNG vào đĩa; đã đọc lại tệp.", { chon: khoiDaAp.selected.length, tong: khoiDaAp.total, tep: tepDaGhi ?? "?" })
            : t("repoWs.chat.applied", "Đã áp diff vào `{{tep}}` — đã đọc lại tệp.", { tep: tepDaGhi ?? "?" });
          setTranscript((prev) => [...prev, { role: "assistant", content: cauDaAp }]);
          // ★★★ doc 79 · VÒNG TỰ ĐỘNG BẮT ĐẦU ĐÚNG Ở ĐÂY — sau khi NGƯỜI đã duyệt và byte đã rời
          //   ra đĩa. Trước cú bấm này không có một lượt tự động nào chạy.
          if (tepDaGhi) void chayLuotVong(tepDaGhi);
        } else if (pending.tool === "apply_diff_batch") {
          // ★★★ 2026-08-24 — LÔ GHI THÀNH CÔNG. `out.textSummary` do SERVER viết (liệt kê từng tệp
          //   đã ghi) — đưa NGUYÊN vào transcript sau câu dẫn, không viết lại. Refetch trình xem CHỈ
          //   khi tệp đang mở nằm trong `daGhi`. KHÔNG khởi động vòng tự động: lô đụng NHIỀU tệp nên
          //   không có `codingEditPath` đơn để vòng bám (vòng thuộc về một tệp đang sửa).
          const daGhi = (out?.data as { daGhi?: Array<{ path?: string }> } | undefined)?.daGhi ?? [];
          setPendingBatch(null);
          if (selectedPath && daGhi.some((f) => f.path === selectedPath)) fileQ.refetch();
          setTranscript((prev) => [
            ...prev,
            { role: "assistant", content: `${t("repoWs.diff.appliedBatch", "Đã ghi lô tệp — chi tiết:")}\n\n${out?.textSummary ?? ""}` },
          ]);
        }
      } else {
        toast.error(res.message ?? t("repoWs.diff.denied", "Bị từ chối."));
      }
    } catch {
      toast.error(t("repoWs.chat.confirmFailed", "Không thực thi được."));
    }
  }, [pending, actionState, confirmM, lang, t, selectedPath, fileQ, pendingDiff, chayLuotVong, dungVong]);

  const handleCancel = useCallback(async () => {
    if (!pending || actionState !== "pending") return;
    try {
      await cancelM.mutateAsync({ actionId: pending.actionId });
      setActionState("cancelled");
      if (pending.tool === "apply_diff") setPendingDiff(null);
      if (pending.tool === "apply_diff_batch") setPendingBatch(null);
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
  /** Số vấn đề của lượt lệnh MỚI NHẤT — huy hiệu tab "Vấn đề" (panel Problems đọc cùng nguồn này). */
  const soVanDe = lenhDaChay[lenhDaChay.length - 1]?.diaDiemLoi.length ?? 0;
  /**
   * ★ UX (C2) — TÍN HIỆU THẬT "chỉ CHẠY, KHÔNG ghi đĩa" cho thẻ duyệt `run_command`. Server đặt một
   * ô `preview.changes` `{ field:"ghiDia", newValue:"chi_hoi_kiem_tra" | "ghi_de_ma_nguon" }` (xem
   * `server/services/aiLocalTools/writeHandlers/repoCommand.ts`): TÁM lệnh HỎI/KIỂM TRA (dotnet
   * build/test · vitest · git status/diff · node --test) = `chi_hoi_kiem_tra`; riêng `dotnet format`
   * = `ghi_de_ma_nguon`. ⇒ CHỈ trấn an khi cờ THẬT nói KHÔNG ghi (không bịa); `dotnet format` rơi về
   * `false` nên GIỮ NGUYÊN cảnh báo GHI ĐÈ của server.
   */
  const lenhChiChay =
    pending !== null &&
    pending.tool === "run_command" &&
    pending.preview.changes.some((c) => c.field === "ghiDia" && c.newValue === "chi_hoi_kiem_tra");

  /**
   * ★★★ 2026-08-26 · NHÓM HOÃN (diff khung-giữa, kiểu CURSOR) — thẻ duyệt DIFF hiện Ở KHUNG GIỮA (trình
   * biên tập), KHÔNG ở cột chat: đúng mô hình Cursor/VSCode — đề xuất sửa hiện NGAY trong editor, bấm
   * Duyệt/Hủy TẠI ĐÓ. `TheDuyetDiff`/`TheDuyetDiffLo` (+ census của chúng) KHÔNG sửa MỘT DÒNG — chỉ DỜI
   * KHUNG render. Hai cờ này là MỘT nguồn quyết định: khung giữa vẽ THẺ, cột chat vẽ CON TRỎ. Thẻ
   * `run_command` (không phải diff) VẪN ở chat (nhỏ, thuộc mạch hội thoại). Điều kiện khớp đúng như cũ
   * (tool + actionId) để không lệch khi một pending mới đè lên. */
  const theDuyetDiffDon =
    pending?.tool === "apply_diff" && pendingDiff && pendingDiff.action.actionId === pending.actionId ? pendingDiff : null;
  const theDuyetDiffLo =
    pending?.tool === "apply_diff_batch" && pendingBatch && pendingBatch.action.actionId === pending.actionId ? pendingBatch : null;
  const coDiffChoDuyet = !!(theDuyetDiffDon || theDuyetDiffLo);

  // Màn HẸP một-khung: khi có diff chờ duyệt, nhảy sang khung XEM (nơi thẻ duyệt hiện) — như Cursor tự
  //   lấy nét editor. Không có dòng này, thẻ duyệt sống ở khung người dùng KHÔNG đang xem ⇒ họ tưởng treo.
  useEffect(() => {
    if (coDiffChoDuyet && hep) setKhungHep("xem");
  }, [coDiffChoDuyet, hep]);

  /**
   * ★★★ 2026-08-25 · ĐỢT 2 (B) — DẤU VẾT đa-tool (gọn): các thẻ TRƯỚC hiện `title`, thẻ CUỐI đậm.
   * Chỉ hiện khi có TỪ HAI thẻ (một thẻ thì bản thân `AIToolResultCard` đã đủ). Dùng chung cho khối
   * đang-stream lẫn khối đã-xong, đặt NGAY TRÊN thẻ chi tiết cuối. Thuần hiển thị, 0 tRPC.
   */
  const dauVetTool = streamTools.length > 1 ? (
    <div data-dau-vet-tool className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
      <Wrench className="h-3 w-3 shrink-0" />
      {streamTools.map((tr, i) => (
        <span key={i} className="inline-flex min-w-0 items-center gap-1">
          {i > 0 && <span aria-hidden className="opacity-40">·</span>}
          <span className={cn("truncate", i === streamTools.length - 1 ? "max-w-[160px] font-medium text-foreground" : "max-w-[120px]")}>
            {tr.title}
          </span>
        </span>
      ))}
    </div>
  ) : null;

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
          {/* ★ UX (B2) — ba huy hiệu trần trụi ("đọc"/"chạy lệnh"/"Cục bộ") không tự giải nghĩa cho
              người lần đầu; tooltip nói chúng LÀ GÌ (Radix Tooltip, provider đã bọc cả App). */}
          <div className="ml-auto flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="cursor-help text-[10px]">{t("repoWs.badge.read", "đọc")}</Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs">
                {t("repoWs.badgeTip.read", "Tài khoản có quyền ĐỌC mã nguồn (ai_repo_read): cây tệp, nội dung tệp, tìm kiếm. Hộp cát server quyết định tệp nào đọc được.")}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant={canExec ? "outline" : "secondary"} className="cursor-help text-[10px]">
                  {canExec ? t("repoWs.badge.exec", "chạy lệnh") : t("repoWs.badge.execOff", "chạy lệnh (ẩn)")}
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-[280px] text-xs">
                {canExec
                  ? t("repoWs.badgeTip.exec", "Tài khoản có quyền CHẠY LỆNH (ai_repo_exec): chỉ các lệnh trong danh sách trắng, và luôn phải bấm duyệt trước khi chạy.")
                  : t("repoWs.badgeTip.execOff", "Tài khoản KHÔNG có quyền CHẠY LỆNH (ai_repo_exec) — gợi ý chạy test bị ẩn; server vẫn chặn nếu gọi thẳng.")}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ★★★ 2026-08-24 · RIBBON TÁC VỤ — MỘT HÀNG nút icon NGOÀI `khungRef`, giữa đầu trang và
            khung làm việc. Đặt TRƯỚC `khungRef` là cố ý: `useKhungVua` đo ĐỈNH tuyệt đối của
            `khungRef`, nên chiều cao khung TỰ trừ đi phần ribbon (đã xác minh) — KHÔNG chạm
            `khungVuaManHinh.ts`. Nút "Chạy kiểm chứng" đi qua ĐÚNG đường ba nút gợi ý (chat →
            propose → NGƯỜI DUYỆT → chạy); ribbon KHÔNG nới quyền (ẩn khi thiếu `coTheChayKiemChung`). */}
        <RibbonTacVu
          hep={hep}
          dangStream={isStreaming}
          coTheChayKiemChung={canExec && !!goiYKiemChung}
          lenhKiemChung={lenhKiemChungHienThi}
          onLamMoiCay={lamMoiCay}
          onChayKiemChung={chayKiemChungNhanh}
          onDung={stopKbStream}
          onNhayTep={() => setKhungHep("tep")}
          onNhayChat={() => setKhungHep("chat")}
          duoiChat={duoiChat}
          onToggleTerminal={() => setDuoiChat((v) => (v === "terminal" ? "dong" : "terminal"))}
          onToggleProblems={() => setDuoiChat((v) => (v === "problems" ? "dong" : "problems"))}
          soVanDe={soVanDe}
          onPhienMoi={phienMoi}
          className="shrink-0 border-b px-3 py-1"
        />

        {/* ⚠ BỐ CỤC: ba khung (cây tệp · trình xem · hội thoại) giữ nguyên thứ tự và vai trò.
            Cột phiên của doc 79 ĐÃ THU thành nút + popover trên thanh đầu Hội thoại (2026-08-23,
            mẫu Claude Code trong VS Code) — không gian dồn cho Trình xem, xem `BoChonPhien`.
            ★★★ 2026-08-23 · chiều cao nay ĐO ĐƯỢC (`useChieuCaoVuaManHinh`) thay cho hằng
            `calc(100vh-8.5rem)` — hằng ấy hụt 138 px ở màn rộng và 167 px ở 900×700, và chính chỗ
            hụt ấy làm trang cuộn được ⇒ đẻ ra CẢ hiện tượng "tự cuộn 138 px lúc vào màn" LẪN
            "900×700 không gõ được câu hỏi". `h-[calc(...)]` giữ lại làm ĐƯỜNG LÙI cho nhịp render
            đầu tiên (trước khi hook đo xong) và cho môi trường không có `ResizeObserver`. */}
        <div
          ref={khungRef}
          data-khung-lam-viec
          style={caoKhung != null ? { height: `${caoKhung}px` } : undefined}
          className="flex h-[calc(100vh-8.5rem)] flex-col"
        >
          {/*
            ★★★ 2026-08-23 · THANH CHỌN KHUNG — chỉ hiện ở chế độ MỘT KHUNG.
            ⚠ Điều kiện là `hep = xepMotKhung(rongKhung)`, **không** phải một điểm ngắt `lg:`/`xl:`.
              Điểm ngắt hỏi bề rộng CỬA SỔ, mà thứ quyết định là bề rộng KHUNG: ở cửa sổ 1600 px
              khung chỉ rộng 1240 px (thanh điều hướng trái ăn ~360 px và **gập được**). Chính vì
              hỏi sai đại lượng mà bố cục cũ "đúng" ở 1600 và vỡ ở 1280 — khung Trình xem còn 82 px.
          */}
          {hep && (
          <div className="flex shrink-0 gap-1 border-b px-2 py-1.5" role="tablist" aria-label={t("repoWs.pane.tablist", "Chọn khung")}>
            {([
              ["tep", t("repoWs.pane.files", "Tệp")],
              ["xem", t("repoWs.pane.viewer", "Trình xem")],
              ["chat", t("repoWs.pane.chat", "Hội thoại")],
            ] as const).map(([ma, nhan]) => (
              <button
                key={ma}
                type="button"
                role="tab"
                aria-selected={khungHep === ma}
                onClick={() => setKhungHep(ma)}
                className={cn(
                  "min-w-0 flex-1 truncate rounded-md border px-2 py-1 text-[11px] font-medium",
                  khungHep === ma ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {nhan}
              </button>
            ))}
          </div>
          )}

          {/* ⚠ `min-h-0`: không có nó, khung con trong một `flex flex-col` lấy chiều cao theo NỘI
              DUNG chứ không theo phần còn lại — đúng lớp lỗi đẩy ô nhập xuống dưới nếp gấp.
              ⚠ Ba số trong `grid-cols` phải KHỚP `SAN_KHUNG_PX` ở `@/lib/khungVuaManHinh` — đó là
                nguồn sự thật cho ngưỡng chuyển chế độ, và lệch nhau thì trang lại nói dối. Có lưới
                canh (`khungVuaManHinh.unit.test.ts` §3).
              ⚠ `minmax(320px,1fr)` cho Trình xem là SÀN CÓ SỐ: 82 px của bản cũ không được phép lặp
                lại. `minmax(360px,440px)` cho hội thoại — thẻ duyệt là thứ quan trọng nhất màn này
                nên cột chat được nới (400 → tới 440), nhưng có TRẦN để nó không nuốt Trình xem.
              ★★★ 2026-08-23 — cột "Phiên" 190 px ĐÃ BỎ (thành popover, xem `BoChonPhien`): phần
                dồn lại về `1fr` của Trình xem. Đo được (Playwright, grid thật): khung 1240 ⇒ Trình
                xem 370 → 560 px; khung 920 ⇒ thoát chế độ một-khung, ba khung cùng hiện. */}
          <div
            data-luoi-khung
            className={cn(
              "grid min-h-0 flex-1",
              hep ? "grid-cols-1" : "grid-cols-[240px_minmax(320px,1fr)_minmax(360px,440px)]",
            )}
          >
          {/* ── 1. CÂY TỆP ── */}
          <div className={cn("flex min-h-0 flex-col overflow-hidden border-r", hep && khungHep !== "tep" && "hidden")}>
            {/* Bộ chọn DỰ ÁN (doc 79 · TRỤC 2) — tham khảo "Select folder" của Claude Code. Client
                giữ + gửi MỘT id; server tra danh sách TRẮNG .env để ra gốc (không nhận đường dẫn). */}
            {/* ⚠ `shrink-0` KHÔNG phải trang trí — nghiệm thu LIVE 2026-08-19 bắt được: thiếu nó thì
                trong `flex flex-col` có `ScrollArea flex-1`, khối này bị co xuống **13 px** trong khi
                `<select>` bên trong cao 20 px ⇒ nó TRÀN và ĐÈ lên khối "Cây tệp". Mọi lưới đều xanh —
                đây là lớp lỗi chỉ MẮT bắt được (bài học nhóm C: cổng tĩnh xanh chỉ chứng minh
                "không còn thứ TÔI BIẾT CÁCH NHÌN"). Cột phiên của đợt này làm lưới co chặt hơn nên
                lỗi mới lộ. */}
            <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <label htmlFor="repows-project" className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                  <FolderTree className="h-3.5 w-3.5" /> {t("repoWs.project.label", "Dự án")}
                  {/* ★ UX (B2) — "Cục bộ" là lời cam kết quan trọng nhất màn này với khách nhà máy;
                      tooltip nói rõ nó nghĩa là gì thay vì bắt người dùng đoán. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-auto cursor-help rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
                        {t("repoWs.project.local", "Cục bộ")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px] text-xs">
                      {t("repoWs.badgeTip.local", "Mã nguồn và model AI chạy NGAY TRÊN máy chủ nội bộ của nhà máy — không một byte mã nào rời khỏi mạng nội bộ.")}
                    </TooltipContent>
                  </Tooltip>
                </label>
                {/* ★ QUẢN LÝ DỰ ÁN — bánh răng NGOÀI <label> (nút trong label ăn cú bấm của label)
                    và chỉ gắn cho admin: phép LỊCH SỰ; hàng rào thật là `adminProcedure` ở server
                    (repoWorkspace.themDuAn/xoaDuAn) — gọi thẳng API vẫn FORBIDDEN. */}
                {user?.role === "admin" && <QuanLyDuAnRepo />}
              </div>
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
            {/* ★★★ 2026-08-25 · ĐỢT 3 — tiêu đề cây + Ô LỌC/MỞ-NHANH (Ctrl+P). ★★★ 2026-08-27 · CURSOR-PARITY
                — thêm CHẾ ĐỘ "Cây | Tìm" (Ctrl+Shift+F tìm-toàn-repo qua endpoint `grep` đã có). */}
            <div className="flex shrink-0 flex-col gap-1 border-b px-2 py-1.5">
              <div className="flex items-center gap-1" role="tablist" aria-label={t("repoWs.search.modeLabel", "Chế độ khung Cây")}>
                <button
                  type="button" role="tab" data-che-do="cay" aria-selected={cheDoCay === "cay"}
                  onClick={() => setCheDoCay("cay")}
                  className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold", cheDoCay === "cay" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
                >
                  <FolderTree className="h-3.5 w-3.5" /> {t("repoWs.tree.title", "Cây tệp")}
                </button>
                <button
                  type="button" role="tab" data-che-do="tim" aria-selected={cheDoCay === "tim"}
                  onClick={() => setCheDoCay("tim")}
                  className={cn("flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold", cheDoCay === "tim" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted")}
                >
                  <Search className="h-3.5 w-3.5" /> {t("repoWs.search.tab", "Tìm")}
                </button>
              </div>
              {cheDoCay === "cay" ? (
                <div className="relative">
                  <Search aria-hidden className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={oLocCayRef}
                    data-loc-cay
                    type="text"
                    value={locCay}
                    onChange={(e) => { setLocCay(e.target.value); setChiSoLoc(0); }}
                    onKeyDown={(e) => {
                      if (dsLocCay.length > 0) {
                        if (e.key === "ArrowDown") { e.preventDefault(); setChiSoLoc((i) => Math.min(i + 1, dsLocCay.length - 1)); return; }
                        if (e.key === "ArrowUp") { e.preventDefault(); setChiSoLoc((i) => Math.max(i - 1, 0)); return; }
                        if (e.key === "Enter") { e.preventDefault(); const tep = dsLocCay[chiSoLoc] ?? dsLocCay[0]; if (tep) { openFile(tep); setLocCay(""); } return; }
                      }
                      if (e.key === "Escape") { e.preventDefault(); setLocCay(""); e.currentTarget.blur(); }
                    }}
                    placeholder={t("repoWs.tree.filter", "Lọc / mở nhanh tệp…  (Ctrl+P)")}
                    aria-label={t("repoWs.tree.filter", "Lọc / mở nhanh tệp…  (Ctrl+P)")}
                    role="combobox"
                    aria-expanded={dsLocCay.length > 0}
                    aria-controls="repows-mo-nhanh"
                    className="h-7 w-full rounded-md border bg-background pl-6 pr-2 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  />
                </div>
              ) : (
                <div className="relative">
                  <Search aria-hidden className="pointer-events-none absolute left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={oTimRepoRef}
                    data-tim-repo
                    type="text"
                    value={tuKhoaRepo}
                    onChange={(e) => setTuKhoaRepo(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setCheDoCay("cay"); } }}
                    placeholder={t("repoWs.search.placeholder", "Tìm trong TOÀN repo…  (Ctrl+Shift+F)")}
                    aria-label={t("repoWs.search.placeholder", "Tìm trong TOÀN repo…  (Ctrl+Shift+F)")}
                    className="h-7 w-full rounded-md border bg-background pl-6 pr-12 text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                  />
                  {/* ★ ĐỢT A (UX H4) — hai công tắc kiểu VSCode, nằm TRONG ô tìm (pr-12 chừa chỗ). */}
                  <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                    <button
                      type="button"
                      data-tim-hoa
                      aria-pressed={timPhanBietHoa}
                      onClick={() => setTimPhanBietHoa((v) => !v)}
                      title={t("repoWs.search.caseToggle", "Phân biệt hoa/thường")}
                      aria-label={t("repoWs.search.caseToggle", "Phân biệt hoa/thường")}
                      className={cn("rounded px-1 font-mono text-[10px] leading-5", timPhanBietHoa ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
                    >Aa</button>
                    <button
                      type="button"
                      data-tim-regex
                      aria-pressed={timBangRegex}
                      onClick={() => setTimBangRegex((v) => !v)}
                      title={t("repoWs.search.regexToggle", "Dùng biểu thức chính quy (regex)")}
                      aria-label={t("repoWs.search.regexToggle", "Dùng biểu thức chính quy (regex)")}
                      className={cn("rounded px-1 font-mono text-[10px] leading-5", timBangRegex ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted")}
                    >.*</button>
                  </div>
                </div>
              )}
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <div className="py-1">
                {cheDoCay === "tim" ? (
                  /* ★★★ CURSOR-PARITY — KẾT QUẢ TÌM TOÀN REPO (endpoint `grep`). Mỗi khớp bấm ⇒ mở tệp +
                     nhảy dòng (`moTepTuVanDe` — cùng đường tab + tô-sáng của panel Vấn đề). */
                  !projectId ? (
                    <div className="px-2 py-1 text-xs text-muted-foreground">{t("repoWs.project.none", "Chưa có dự án nào để hiển thị.")}</div>
                  ) : tuKhoaRepoTre.trim().length < 2 ? (
                    <div className="px-2 py-2 text-[11px] leading-relaxed text-muted-foreground">{t("repoWs.search.hint", "Gõ ≥2 ký tự để tìm trong MỌI tệp của dự án (hộp cát server).")}</div>
                  ) : grepRepoQ.isLoading ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">{t("repoWs.search.loading", "Đang tìm…")}</div>
                  ) : ketQuaGrep.length === 0 ? (
                    <div className="px-2 py-2 text-xs text-muted-foreground">
                      {t("repoWs.search.none", "Không thấy kết quả nào.")}
                      {/* ★ PDCA vòng 1 (T05) — BẢN CẮT phải nói ra CẢ khi 0 kết quả: "không thấy" trên
                          một phạm vi bị cắt KHÔNG phải "repo không có" (GREP_DEADLINE cùng lý lẽ). */}
                      {grepRepoQ.data?.data?.truncated === true && (
                        <span data-grep-cat className="mt-1 block text-[10px] text-amber-700 dark:text-amber-400">
                          {t("repoWs.search.truncatedNone", "⚠ Phạm vi quét bị CẮT ({{n}} tệp đã quét) — chưa phải cả repo.", { n: grepRepoQ.data?.data?.scanned ?? 0 })}
                        </span>
                      )}
                    </div>
                  ) : (
                    /* ★★★ CURSOR-PARITY (đuôi dài) — GOM THEO TỆP: header (tệp + thư mục + số khớp) rồi các
                       dòng khớp thụt vào (dòng + đoạn text). Sạch hơn danh sách phẳng khi nhiều tệp. */
                    <div aria-label={t("repoWs.search.results", "Kết quả tìm toàn repo")}>
                      <div className="px-2 pb-0.5 text-[10px] font-medium text-muted-foreground">{t("repoWs.search.count", "{{n}} kết quả", { n: ketQuaGrep.length })}</div>
                      {/* ★ PDCA vòng 1 (T05) — server khai BẢN CẮT trong `data.truncated` nhưng UI cũ
                          NUỐT lời khai ấy: người dùng thấy "1 kết quả" như thể đã quét hết (đo thật —
                          tìm "StreamingSecretRedactor" ra 1/≥5 tệp mà không một dấu hiệu nào). */}
                      {grepRepoQ.data?.data?.truncated === true && (
                        <div data-grep-cat className="mx-2 mb-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[10px] leading-snug text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                          {grepRepoQ.data?.data?.timedOut
                            ? t("repoWs.search.truncatedTime", "⚠ BẢN CẮT vì hết giờ: mới quét {{n}} tệp — kết quả CHƯA đầy đủ, thu hẹp bằng thư mục để quét trọn.", { n: grepRepoQ.data?.data?.scanned ?? 0 })
                            : t("repoWs.search.truncatedCap", "⚠ BẢN CẮT: chạm trần quét/kết quả ({{n}} tệp đã quét) — có thể còn khớp chưa hiện.", { n: grepRepoQ.data?.data?.scanned ?? 0 })}
                        </div>
                      )}
                      {ketQuaGrepGom.map(([path, matches]) => {
                        const cat = path.lastIndexOf("/");
                        const ten = cat >= 0 ? path.slice(cat + 1) : path;
                        const thuMuc = cat >= 0 ? path.slice(0, cat + 1) : "";
                        return (
                          <div key={path} className="mb-0.5">
                            <div className="flex items-baseline gap-1.5 px-2 py-0.5 text-[11px] font-semibold">
                              <FileCode className="h-3 w-3 shrink-0 translate-y-0.5 text-muted-foreground" />
                              <span className="truncate">{ten}</span>
                              {thuMuc && <span className="min-w-0 truncate text-[10px] font-normal text-muted-foreground">{thuMuc}</span>}
                              <span className="ml-auto shrink-0 tabular-nums text-[10px] font-normal text-muted-foreground">{matches.length}</span>
                            </div>
                            {matches.map((m, i) => (
                              <button
                                key={`${m.line}:${i}`}
                                type="button"
                                data-ket-qua-grep
                                onClick={() => moTepTuVanDe(path, m.line)}
                                className="flex w-full min-w-0 items-baseline gap-1.5 py-0.5 pl-7 pr-2 text-left hover:bg-muted"
                              >
                                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{m.line}</span>
                                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">{m.text}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : !projectId ? (
                  <div className="px-2 py-1 text-xs text-muted-foreground">{t("repoWs.project.none", "Chưa có dự án nào để hiển thị.")}</div>
                ) : locCay.trim() ? (
                  dsLocCay.length > 0 ? (
                    <ul id="repows-mo-nhanh" role="listbox" aria-label={t("repoWs.tree.filterResults", "Kết quả mở nhanh tệp")}>
                      {dsLocCay.map((p, i) => {
                        const cat = p.lastIndexOf("/");
                        const ten = cat >= 0 ? p.slice(cat + 1) : p;
                        const thuMuc = cat >= 0 ? p.slice(0, cat + 1) : "";
                        return (
                          <li key={p}>
                            <button
                              type="button"
                              data-mo-nhanh-item
                              role="option"
                              aria-selected={i === chiSoLoc}
                              onMouseEnter={() => setChiSoLoc(i)}
                              onClick={() => { openFile(p); setLocCay(""); }}
                              className={cn(
                                "flex w-full items-baseline gap-1.5 px-2 py-1 text-left text-xs",
                                i === chiSoLoc ? "bg-primary/10 text-primary" : "hover:bg-muted",
                              )}
                            >
                              <FileCode className="h-3 w-3 shrink-0 translate-y-0.5 text-muted-foreground" />
                              <span className="truncate font-medium">{ten}</span>
                              {thuMuc && <span className="truncate text-[10px] text-muted-foreground">{thuMuc}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="px-2 py-2 text-xs text-muted-foreground">{t("repoWs.tree.filterEmpty", "Không tệp nào khớp.")}</div>
                  )
                ) : (
                  <FolderChildren key={projectId} path="" selectedPath={selectedPath} onOpenFile={openFile} depth={0} projectId={projectId} />
                )}
              </div>
            </ScrollArea>
          </div>

          {/* ── 2. TRÌNH XEM + DIFF ── */}
          <div className={cn("flex min-h-0 flex-col overflow-hidden border-r", hep && khungHep !== "xem" && "hidden")}>
            <div className="flex items-center gap-2 border-b px-3 py-1.5">
              {coDiffChoDuyet ? (
                <>
                  <FileDiff className="h-4 w-4 text-amber-500" />
                  {/* ★ UX (C4) — "diff" là thuật ngữ; tooltip (cùng mẫu ba huy hiệu quyền) chú giải
                      cho kỹ sư mới thay vì bắt đoán. Đơn: nêu đường tệp; LÔ: thẻ tự liệt kê tệp. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help truncate text-xs font-medium">
                        {t("repoWs.viewer.diffFor", "Xem trước diff")}
                        {theDuyetDiffDon ? <>: <code className="font-mono">{theDuyetDiffDon.args.path}</code></> : null}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px] text-xs">
                      {t("repoWs.viewer.diffTip", "Diff là danh sách những DÒNG sẽ đổi: bản cũ so với bản mới. Bạn xem rồi mới bấm duyệt ghi.")}
                    </TooltipContent>
                  </Tooltip>
                </>
              ) : openTabs.length > 0 ? (
                /* ★★★ 2026-08-26 · CURSOR-PARITY — THANH TAB đa-tệp: mỗi tệp đang mở một tab (basename +
                   nút đóng X), tab HOẠT ĐỘNG (`=== selectedPath`) tô đậm + gạch chân. Bấm tên = chuyển
                   tab (openFile no-op moTab vì đã có); bấm X = `dongTabTep` (thuần `dongTab`, có lưới).
                   `overflow-x-auto` cuộn ngang khi nhiều tab; nút Làm mới ngoài vùng cuộn (luôn thấy). */
                <>
                  <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto" role="tablist" aria-label={t("repoWs.viewer.tabsLabel", "Tệp đang mở")}>
                    {openTabs.map((tp) => {
                      const cat = tp.lastIndexOf("/");
                      const ten = cat >= 0 ? tp.slice(cat + 1) : tp;
                      const active = tp === selectedPath;
                      return (
                        <span
                          key={tp}
                          role="tab"
                          aria-selected={active}
                          data-tab-tep={tp}
                          className={cn(
                            "group flex shrink-0 items-center gap-0.5 rounded-t border-b-2 py-1 pl-2 pr-1 text-xs",
                            active ? "border-primary bg-muted font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/50",
                          )}
                        >
                          <button type="button" onClick={() => openFile(tp)} className="min-w-0 max-w-[130px] truncate" title={tp}>{ten}</button>
                          <button
                            type="button"
                            data-dong-tab={tp}
                            onClick={() => dongTabTep(tp)}
                            aria-label={t("repoWs.viewer.closeTab", "Đóng {{ten}}", { ten })}
                            className={cn(
                              "shrink-0 rounded p-0.5 hover:bg-foreground/10",
                              active ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                            )}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  {selectedPath && (
                    <>
                      {/* ★ ĐỢT C (UX H2) — vào chế độ SỬA TAY. Khoá khi tệp bị CẮT (buffer thiếu đuôi
                          ⇒ đề xuất sẽ XOÁ phần chưa nạp) hoặc đang có diff chờ duyệt. */}
                      <Button
                        variant="ghost" size="icon" className="ml-1 h-6 w-6 shrink-0" data-nut-sua-tay
                        disabled={!fileReply?.ok || !fileReply.data?.content || fileReply.data?.truncated === true || dangSuaTay || coDiffChoDuyet}
                        onClick={() => { setBanSua(fileReply?.data?.content ?? ""); setDangSuaTay(true); }}
                        title={fileReply?.data?.truncated ? t("repoWs.suaTay.truncated", "Tệp bị cắt bớt khi nạp — không sửa tay được (đề xuất sẽ xoá phần chưa nạp).") : t("repoWs.suaTay.enter", "Sửa tệp (tạo đề xuất, bạn duyệt)")}
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" data-nut-copy onClick={copyTepHienTai} disabled={!fileReply?.ok || !fileReply.data?.content} title={t("repoWs.viewer.copy", "Sao chép nội dung tệp")}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => fileQ.refetch()} title={t("repoWs.tree.refresh", "Làm mới")}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate text-xs font-medium">{t("repoWs.viewer.title", "Trình xem")}</span>
                </>
              )}
            </div>
            {/* ★★★ 2026-08-26 · CURSOR-PARITY — THANH TÌM TRONG TỆP (Ctrl+F). Enter/▼ tới, Shift+Enter/▲
                lui (vòng lại), Esc đóng. Điều hướng đặt `dongMucTieu` ⇒ cuộn+tô-sáng dòng khớp (tái dùng
                nhảy-tới-dòng). CHỈ hiện khi đang xem TỆP (không diff chờ duyệt). */}
            {timMo && !coDiffChoDuyet && selectedPath && (
              <div className="flex shrink-0 items-center gap-1 border-b bg-muted/30 px-2 py-1" data-thanh-tim>
                <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={oTimRef}
                  data-o-tim
                  type="text"
                  value={tuKhoaTim}
                  onChange={(e) => setTuKhoaTim(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); nhayKhopTim(!e.shiftKey); }
                    else if (e.key === "Escape") { e.preventDefault(); dongThanhTim(); }
                  }}
                  placeholder={t("repoWs.find.placeholder", "Tìm trong tệp…")}
                  aria-label={t("repoWs.find.placeholder", "Tìm trong tệp…")}
                  className="h-6 min-w-0 flex-1 rounded border bg-background px-1.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <span data-tim-dem className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                  {tuKhoaTim ? (ketQuaTim.length > 0 ? t("repoWs.find.count", "{{i}}/{{n}}", { i: chiSoTim + 1, n: ketQuaTim.length }) : t("repoWs.find.none", "0/0")) : ""}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={ketQuaTim.length === 0} onClick={() => nhayKhopTim(false)} title={t("repoWs.find.prev", "Khớp trước (Shift+Enter)")} aria-label={t("repoWs.find.prev", "Khớp trước (Shift+Enter)")}><ChevronUp className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={ketQuaTim.length === 0} onClick={() => nhayKhopTim(true)} title={t("repoWs.find.next", "Khớp sau (Enter)")} aria-label={t("repoWs.find.next", "Khớp sau (Enter)")}><ChevronDown className="h-3.5 w-3.5" /></Button>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={dongThanhTim} title={t("repoWs.find.close", "Đóng (Esc)")} aria-label={t("repoWs.find.close", "Đóng (Esc)")}><X className="h-3.5 w-3.5" /></Button>
              </div>
            )}
            {/* ★★★ 2026-08-27 · CURSOR-PARITY — Ô-LỆNH SỬA ĐOẠN CHỌN (Cmd+K). Gửi ⇒ dựng câu hỏi có bối cảnh
                (đoạn bôi đen + yêu cầu) qua `handleSend` → model → apply_diff → CỬA DUYỆT (thẻ hiện ngay ở
                khung này). KHÔNG ghi thẳng. Enter gửi · Esc đóng. */}
            {suaChonMo && !coDiffChoDuyet && selectedPath && (
              <div className="flex shrink-0 flex-col gap-1 border-b border-primary/30 bg-primary/5 px-2 py-1.5" data-sua-chon>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
                  <Wand2 className="h-3.5 w-3.5 shrink-0" />
                  {t("repoWs.suaChon.title", "Sửa {{n}} dòng đã chọn — mô tả thay đổi (AI đề xuất, bạn duyệt):", { n: soDongChon })}
                </div>
                <div className="flex items-center gap-1">
                  <input
                    ref={oSuaChonRef}
                    data-o-sua-chon
                    type="text"
                    value={yeuCauSua}
                    onChange={(e) => setYeuCauSua(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); guiSuaChon(); }
                      else if (e.key === "Escape") { e.preventDefault(); setSuaChonMo(false); }
                    }}
                    placeholder={t("repoWs.suaChon.placeholder", "vd: thêm kiểm tra null, đổi tên biến, tách hàm…")}
                    aria-label={t("repoWs.suaChon.placeholder", "vd: thêm kiểm tra null, đổi tên biến, tách hàm…")}
                    className="h-7 min-w-0 flex-1 rounded border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button size="sm" data-gui-sua-chon className="h-7 shrink-0 px-2 text-xs" disabled={!yeuCauSua.trim() || isStreaming} onClick={guiSuaChon}>
                    {t("repoWs.suaChon.send", "Gửi")}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setSuaChonMo(false)} title={t("repoWs.suaChon.cancel", "Hủy (Esc)")} aria-label={t("repoWs.suaChon.cancel", "Hủy (Esc)")}><X className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-3">
                {coDiffChoDuyet ? (
                  /* ★★★ 2026-08-26 · NHÓM HOÃN (diff khung-giữa, kiểu CURSOR) — THẺ DUYỆT DIFF ĐẦY ĐỦ hiện
                     Ở ĐÂY (trình biên tập), KHÔNG ở cột chat: đề xuất sửa hiện NGAY trong editor, đọc DIFF
                     TO + chọn khối + bấm Duyệt/Hủy TẠI ĐÓ — đúng mô hình Cursor. `TheDuyetDiff`/`TheDuyetDiffLo`
                     y NGUYÊN (census của chúng không đụng), chỉ DỜI khung. `aria-live="assertive"` giữ ở ĐÂY
                     để trình đọc màn hình vẫn báo thẻ khi hiện (cột chat nay chỉ còn con trỏ). Cột chat vẽ
                     con trỏ; thẻ `run_command` (không phải diff) VẪN ở chat. */
                  <div aria-live="assertive" role="status" data-diff-khung-giua>
                    {theDuyetDiffDon ? (
                      <TheDuyetDiff
                        action={pending!}
                        args={theDuyetDiffDon.args}
                        state={actionState}
                        busy={busyConfirm}
                        preview={diffPreview}
                        onPreview={setDiffPreview}
                        onConfirm={handleConfirm}
                        onCancel={handleCancel}
                      />
                    ) : theDuyetDiffLo ? (
                      <TheDuyetDiffLo
                        action={pending!}
                        files={theDuyetDiffLo.files}
                        state={actionState}
                        busy={busyConfirm}
                        onConfirm={handleConfirm}
                        onCancel={handleCancel}
                      />
                    ) : null}
                  </div>
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
                    {dangSuaTay ? (
                      /* ★ ĐỢT C (UX H2) — CHẾ ĐỘ SỬA TAY (textarea v1). Gửi ⇒ `guiDeXuatSuaTay` →
                         thẻ duyệt apply_diff HIỆN NGAY khung này; không một đường ghi thẳng nào. */
                      <div data-sua-tay className="flex min-h-0 flex-col gap-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Wand2 className="h-3.5 w-3.5 shrink-0 text-primary" />
                          {t("repoWs.suaTay.hint", "Sửa trực tiếp rồi bấm Tạo đề xuất — thay đổi thành một DIFF chờ bạn duyệt, không ghi thẳng.")}
                        </div>
                        <textarea
                          data-o-sua-tay
                          value={banSua}
                          onChange={(e) => setBanSua(e.target.value)}
                          spellCheck={false}
                          className="min-h-[320px] w-full flex-1 resize-y rounded-md border bg-background p-2 font-mono text-[12px] leading-snug focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t("repoWs.suaTay.enter", "Sửa tệp (tạo đề xuất, bạn duyệt)")}
                        />
                        <div className="flex items-center gap-2">
                          <Button size="sm" data-gui-sua-tay className="h-7 px-3 text-xs" disabled={deXuatSuaTayM.isPending || banSua === (fileReply?.data?.content ?? "")} onClick={() => void guiDeXuatSuaTay()}>
                            {deXuatSuaTayM.isPending ? t("repoWs.suaTay.sending", "Đang tạo…") : t("repoWs.suaTay.propose", "Tạo đề xuất")}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" onClick={() => setDangSuaTay(false)}>
                            {t("repoWs.suaTay.cancel", "Hủy")}
                          </Button>
                          {banSua === (fileReply?.data?.content ?? "") && (
                            <span className="text-[10px] text-muted-foreground">{t("repoWs.suaTay.unchanged", "Chưa có thay đổi nào.")}</span>
                          )}
                        </div>
                      </div>
                    ) : (
                    /* ★★★ 2026-08-25 · UX (Đợt 1 A) — TrinhXemMa: tô cú pháp (Streamdown/Shiki) +
                        GUTTER số dòng THẬT (`[data-so-dong]`) + cuộn ngang, thay `<pre>` trơn. `preRef`
                        bọc nó để effect cuộn tìm được ô `[data-so-dong={dongMucTieu}]`. Hàng huy hiệu
                        (bytes/redacted/truncated) phía trên GIỮ NGUYÊN. */
                    <div ref={preRef} className="min-w-0">
                      <TrinhXemMa noiDung={fileReply?.data?.content ?? ""} duongDan={selectedPath ?? ""} dongMucTieu={dongMucTieu} />
                    </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* ── 3. HỘI THOẠI TÁC NHÂN ── */}
          <div className={cn("flex min-h-0 flex-col overflow-hidden", hep && khungHep !== "chat" && "hidden")}>
            <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
              <Bot className="h-4 w-4 text-primary" />
              <span className="text-xs font-semibold">{t("repoWs.chat.title", "Hội thoại tác nhân")}</span>
              {/* ★★★ 2026-08-23 — BỘ CHỌN PHIÊN: đồng hồ (lịch sử) + ＋ (phiên mới) ở góc phải,
                  đúng mẫu Claude Code. Nạp/tạo/xoá đi qua ĐÚNG các handler cũ (`chonPhien`/
                  `phienMoi`/`xoaPhienNay`) — không có đường nạp thứ hai. */}
              <BoChonPhien
                className="ml-auto"
                phien={phienQ.data?.sessions ?? []}
                dangChon={sessionId}
                dangTai={phienQ.isLoading}
                biTuChoi={phienQ.data?.note === "PERMISSION_DENIED"}
                onChon={(id) => void chonPhien(id)}
                onMoi={phienMoi}
                onXoa={(id) => void xoaPhienNay(id)}
              />
            </div>
            {/*
              ★★★ 2026-08-23 · `vuaKhung` — Ô MỞ QUAN TRỌNG NHẤT CỦA ĐỢT NÀY.
              Radix dựng trong viewport một `<div style="display:table">` (shrink-to-fit) nên bất kỳ
              khối con nào rộng hơn khung đều **kéo cả tấm bảng rộng ra**, và mọi `%`/`flex-1` bên
              trong khi ấy tính theo tấm bảng ĐÃ PHÌNH. Đo được ở 1600×1000: `clientWidth 400` ·
              `scrollWidth 736` ⇒ nút "Hủy" của thẻ duyệt chỉ hiện **12,2%** còn "Duyệt & ghi" hiện
              **100%**. `vuaKhung` ép tấm bảng ấy về `display:block` ⇒ con KHÔNG kéo khung rộng ra
              được nữa; thứ gì thật sự rộng (dòng diff) tự cuộn trong hộp của nó.
              `ngang` bật kèm, nhưng **thứ tự quan trọng**: nó là LƯỚI AN TOÀN cho thứ thật sự rộng
              mà chưa ai lường (một khối mã model sinh ra không có hộp cuộn riêng), **không** phải
              cách chữa hàng nút. Một thẻ duyệt phải *cuộn ngang mới bấm được Hủy* vẫn là thẻ duyệt
              hỏng: người ta không cuộn, họ bấm cái đang thấy. Với `vuaKhung` bật, thanh này gần như
              không bao giờ hiện — và đó là dấu hiệu bản vá đúng, không phải dấu hiệu nó thừa.
            */}
            <ScrollArea vuaKhung ngang className="min-h-0 flex-1">
              <div className="min-w-0 space-y-3 p-3">
                {transcript.length === 0 && !isStreaming && (
                  <div className="space-y-3 py-6">
                    <p className="text-center text-xs text-muted-foreground">
                      {t("repoWs.chat.empty", "Hỏi để tác nhân đọc mã thật, đề xuất diff (bạn duyệt), rồi chạy test và đọc lỗi thật.")}
                    </p>
                    {/* ★★★ UX (B1) — gợi ý THEO DỰ ÁN đang chọn (`goiYTheoDuAn`): bản cũ viết cứng
                        cho repo chính nên ở dự án csharp nút đầu tiên dẫn vào một tệp KHÔNG tồn tại.
                        ★ NHÓM HOÃN (onboarding) — dự án id-lạ ⇒ `goiYTheoDuAn` rỗng; thay vì MÀN TRẮNG,
                        đổ `MAC_DINH_KHAM_PHA` (khám phá THUẦN, không nêu tên tệp ⇒ an toàn mọi cây) +
                        một dòng dẫn nhập. Nút "Chạy kiểm chứng"/quick-run vẫn đọc `goiYTheoDuAn` thẳng
                        nên KHÔNG mọc lệnh chạy cho dự án lạ (xem docblock `MAC_DINH_KHAM_PHA`). */}
                    {projectId && goiYTheoDuAn(projectId).length === 0 && (
                      <p data-onboarding-macdinh className="flex items-start gap-1.5 rounded-md border border-dashed border-sky-300 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                        <FolderTree className="mt-0.5 h-3 w-3 shrink-0" />
                        {t("repoWs.onboarding.unknownProject", "Dự án này chưa có gợi ý riêng. Bắt đầu bằng vài lệnh khám phá — tác nhân tự đọc cây tệp thật:")}
                      </p>
                    )}
                    <div className="flex flex-col gap-1.5">
                      {(goiYTheoDuAn(projectId).length > 0 ? goiYTheoDuAn(projectId) : (projectId ? MAC_DINH_KHAM_PHA : []))
                        .filter((g) => !g.canChayLenh || canExec)
                        .map((g) => (
                          <button
                            key={g.khoa}
                            type="button"
                            onClick={() => handleSend(t(g.khoa, g.macDinh))}
                            className="rounded-md border px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                          >
                            {t(g.khoa, g.macDinh)}
                          </button>
                        ))}
                    </div>
                    {!canExec && (
                      <p className="flex items-start gap-1.5 rounded-md border border-dashed px-2 py-1.5 text-[11px] text-muted-foreground">
                        <Wrench className="mt-0.5 h-3 w-3 shrink-0" />
                        {t("repoWs.exec.noPerm", "Tài khoản của bạn không có quyền CHẠY LỆNH (ai_repo_exec) — gợi ý chạy test bị ẩn. Nếu gọi thẳng, server vẫn chặn.")}
                      </p>
                    )}
                  </div>
                )}

                {/* ★★★ 2026-08-23 · `min-w-0` + `break-words` trên BONG BÓNG.
                    `max-w-[85%]` một mình KHÔNG chặn tràn: nó giới hạn theo bề rộng CHA, mà cha là
                    tấm bảng `display:table` của Radix — thứ chính nội dung này kéo rộng ra. Đo được
                    `scrollWidth 588…754` vs `clientWidth 400` ⇒ mất 188…354 px, cắt cứng, không có
                    thanh cuộn ngang. `vuaKhung` ghim tấm bảng; `min-w-0 break-words` để chuỗi dài
                    không dấu cách (đường dẫn tệp, băm sha256) tự ngắt thay vì đẩy khung. */}
                {transcript.map((m, i) => (
                  <div key={i} className={cn("flex min-w-0 gap-2", m.role === "user" ? "justify-end" : "justify-start")}>
                    {m.role !== "user" && <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10"><Bot className="h-3.5 w-3.5 text-primary" /></div>}
                    <div className={cn("min-w-0 max-w-[85%] break-words rounded-lg px-3 py-2 text-[13px]", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                      {m.role === "user" ? (
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                      ) : (
                        /* ★ UX (D1) — `lamSachMocChoHienThi`: dòng mốc SEARCH/REPLACE trong văn xuôi
                           model đang thành H1/blockquote qua markdown; lọc CHỈ ở chỗ render, chuỗi
                           lưu phiên/gửi server không đổi một byte. */
                        /* ★ LÔ 3 — nhãn khối mã: câu CÙNG LƯỢT với thẻ đọc nhận bộ CÓ neo (tầng 2
                           so được), mọi câu cũ hơn nhận bộ KHÔNG neo — xem docblock `viTriNeo`. */
                        <div className="prose prose-sm dark:prose-invert min-w-0 max-w-none break-words text-[13px] leading-relaxed"><Streamdown mode="static" components={i === viTriNeo ? boKhoiCoNeo : boKhoiKhongNeo}>{lamSachMocChoHienThi(m.content)}</Streamdown></div>
                      )}
                    </div>
                    {m.role === "user" && <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary"><User className="h-3.5 w-3.5" /></div>}
                  </div>
                ))}

                {/* ★★★ 2026-08-25 · A11Y (Đợt 1 B) — vùng TRẠNG THÁI ĐỘNG (stream · "đang suy nghĩ"
                    · vòng tự động) trong MỘT `aria-live="polite"`: trình đọc màn hình đọc cập nhật khi
                    chúng XUẤT HIỆN, không im lặng. Bọc NHÓM này — KHÔNG bọc cả trang. `empty:hidden`
                    để lúc nhàn (rỗng) nó không chiếm chỗ trong luồng `space-y-3`. */}
                <div aria-live="polite" className="space-y-3 empty:hidden">
                {/* Đang stream */}
                {isStreaming && (streamingText || streamTool) && (
                  <div className="flex min-w-0 gap-2">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /></div>
                    <div className="min-w-0 max-w-[85%] space-y-2 break-words rounded-lg bg-muted px-3 py-2 text-[13px]">
                      {/* ★★★ 2026-08-25 · ĐỢT 2 (A) — ĐỒNG HỒ ELAPSED Ở ĐÂY (nghiệm thu live bắt): 3 chỗ đặt cũ
                          (pre-think trống · vòng-tool nhiều lượt · chờ chay_test) ĐỀU KHÔNG bật cho câu trả lời
                          stream-ngay MỘT-lượt — model local phát token/thẻ TỨC THÌ nên nhánh `!streamingText &&
                          !streamTool` không bao giờ đúng ⇒ giây tàng hình đúng lúc người dùng hỏi "treo hay chạy".
                          Header này (`streamingText || streamTool`) và khối pre-think (`!… && !…`) LOẠI TRỪ NHAU và
                          PHỦ HẾT thời gian `isStreaming` ⇒ đặt giây ở CẢ HAI = một đồng hồ LIÊN TỤC, đúng một chỗ,
                          không nhân đôi. (Đã bỏ giây ở dòng vòng-tool bên dưới để khỏi trùng khi thẻ tool đang hiện.) */}
                      {giayCho > 0 && <div className="tabular-nums text-[10px] text-muted-foreground/80">{t("repoWs.chat.elapsed", "{{giay}} giây", { giay: giayCho })}</div>}
                      {dauVetTool}
                      {streamTool && <AIToolResultCard toolResult={streamTool} lucNhan={lucNhanTool ?? undefined} />}
                      {/* `mode="streaming"` — Streamdown vá markdown DỞ DANG (``` chưa đóng) nên khối
                          mã đang stream vẫn hiện đúng thay vì nhảy layout ở mỗi token. */}
                      {/* ★ UX (D1) — cùng phép lọc mốc với bản tĩnh; dòng mốc đang gõ dở chưa khớp
                          hình dạng thì giữ nguyên, dòng đã trọn được bọc ở nhịp render sau. */}
                      {/* ★ LÔ 3 — văn bản đang stream LUÔN cùng lượt với thẻ đang giữ ⇒ bộ CÓ neo. */}
                      {streamingText && <div className="prose prose-sm dark:prose-invert min-w-0 max-w-none break-words text-[13px] leading-relaxed"><Streamdown mode="streaming" components={boKhoiCoNeo}>{lamSachMocChoHienThi(streamingText)}</Streamdown></div>}
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
                      {/* Giây ĐÃ DỜI lên header stream (mục A ở trên) — bỏ ở đây để khỏi hiện HAI lần khi thẻ
                          tool của vòng đang hiển thị (header luôn bật vì `streamTool` được set trong vòng). */}
                    </span>
                  </div>
                )}
                {isStreaming && !streamingText && !streamTool && (
                  <div className="px-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("repoWs.chat.thinking", "Đang suy nghĩ…")}{giayCho > 0 && <span className="tabular-nums font-medium text-muted-foreground/90">{t("repoWs.chat.elapsed", "{{giay}} giây", { giay: giayCho })}</span>}</div>
                    {/* ★ UX (B2) — kỳ vọng thời gian THEO SỐ ĐO THẬT (buổi trải nghiệm 2026-08-23:
                        đọc 8–20 s · sửa tệp nhỏ 15–20 s trên model 30B cục bộ) — không chép một con
                        số "3–5 phút" từ tài liệu nào. */}
                    <p className="mt-0.5 pl-6 text-[10px] text-muted-foreground/80">
                      {t("repoWs.chat.thinkingEta", "đọc: thường 8–20 giây · sửa tệp: thường 15–30 giây, tệp lớn/lệnh dài có thể lâu hơn")}
                    </p>
                  </div>
                )}

                {/* Kết quả tool đã xong (không stream nữa) — ★ ĐỢT 2 (B): kèm dấu vết các thẻ trước. */}
                {!isStreaming && streamTool && (
                  <div className="space-y-2">
                    {dauVetTool}
                    <AIToolResultCard toolResult={streamTool} lucNhan={lucNhanTool ?? undefined} />
                  </div>
                )}

                {/* ★★★ doc 79 · VÒNG TỰ ĐỘNG — lượt/trần · đang làm gì · vì sao dừng.
                    ★ UX (A3) — `laAdmin`: câu "cờ TẮT" nói tên biến env cho admin, nói "liên hệ
                    quản trị viên" cho vai thường (họ không sửa được `.env` máy chủ). */}
                <VongTuDongCard vong={vong} onDung={() => dungVong("nguoi_tu_choi")} laAdmin={user?.role === "admin"} />
                {vong.dangChay && vong.pha === "chay_test" && (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("repoWs.loop.waitCmd", "Đang chờ lệnh kiểm chứng chạy xong (có thể tới vài phút)…")}{giayCho > 0 && <span className="tabular-nums font-medium">{t("repoWs.chat.elapsed", "{{giay}} giây", { giay: giayCho })}</span>}</div>
                )}
                </div>

                {/* ★★★ 2026-08-25 · A11Y (Đợt 1 B) — THẺ DUYỆT (HITL) phải được trình đọc màn hình
                    thông báo NGAY khi hiện (công cụ bắt-duyệt-mỗi-lượt): `aria-live="assertive"` +
                    `role="status"`. Vùng LUÔN có trong DOM và LUÔN hiển thị (KHÔNG `empty:hidden`) để
                    lượt chèn thẻ chắc chắn được đọc. */}
                <div aria-live="assertive" role="status">
                {/* Thẻ xác nhận write-tool */}
                {coDiffChoDuyet ? (
                  /* ★★★ 2026-08-26 · NHÓM HOÃN (kiểu CURSOR) — thẻ duyệt DIFF (`TheDuyetDiff`/`TheDuyetDiffLo`)
                     nay hiện Ở KHUNG XEM (editor); cột chat chỉ còn CON TRỎ, KHÔNG lặp thẻ. Bấm ⇒ nhảy sang
                     khung Xem (hữu ích ở màn HẸP; màn rộng thẻ đã hiện sẵn ở giữa). Thẻ `run_command` (không
                     phải diff) VẪN ở nhánh dưới. `coDiffChoDuyet` = đúng cùng điều kiện tool+actionId cũ. */
                  <button
                    type="button"
                    data-diff-con-tro
                    onClick={() => setKhungHep("xem")}
                    className="flex w-full items-center gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2 text-left dark:border-amber-800 dark:bg-amber-950/30"
                  >
                    <FileDiff className="h-4 w-4 shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-amber-800 dark:text-amber-300">{t("repoWs.diff.pointer", "Đề xuất SỬA tệp — xem & duyệt ở khung Xem")}</span>
                      {theDuyetDiffDon ? (
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">{theDuyetDiffDon.args.path}</span>
                      ) : theDuyetDiffLo ? (
                        <span className="block text-[11px] text-muted-foreground">{t("repoWs.diff.pointerBatch", "{{n}} tệp", { n: theDuyetDiffLo.files.length })}</span>
                      ) : null}
                    </span>
                    <span aria-hidden className="shrink-0 text-amber-600 dark:text-amber-400">→</span>
                  </button>
                ) : pending ? (
                  // run_command (và mọi write tool khác) — ConfirmActionCard hiện argv + cwd + hạn giờ + cảnh báo.
                  // ★ UX (A1) — `message`: câu kết cục THẬT của server; không truyền thì thẻ rơi về
                  //   câu RBAC mặc định ("Bạn không có quyền…") cho MỌI kết cục denied — đo live sai.
                  // ★ UX (C2) — DÒNG TRẤN AN cho `run_command` KHÔNG ghi đĩa. Đợt 4 (96c193e8) ĐÃ cho
                  //   ConfirmActionCard prop `title` ⇒ trang truyền "Xác nhận CHẠY lệnh" (KHÔNG còn tiêu đề
                  //   dùng-chung "thao tác GHI" gây hoảng). Banner này GIỮ LẠI để trấn an THÊM — CHỈ hiện khi
                  //   cờ THẬT `ghiDia=false` (xem `lenhChiChay`); `dotnet format` (ghi-đè) rơi false ⇒ giữ cảnh báo.
                  <>
                    {lenhChiChay && (
                      <div className="mb-2 flex items-start gap-1.5 rounded-md border border-sky-300 bg-sky-50 px-2 py-1.5 text-[12px] text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-300">
                        <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span>{t("repoWs.cmd.noWrite", "Lệnh này chỉ CHẠY, KHÔNG ghi tệp mã nguồn.")}</span>
                      </div>
                    )}
                    <ConfirmActionCard
                      action={pending as unknown as PendingAction}
                      state={actionState}
                      message={ketCucThongDiep}
                      busy={busyConfirm}
                      onConfirm={handleConfirm}
                      onCancel={handleCancel}
                      t={t}
                      // ★ ĐỢT 4 UX — `run_command` là CHẠY, không phải GHI: tiêu đề đúng nghĩa thay câu
                      //   dùng-chung "thao tác ghi". Tool khác ⇒ undefined ⇒ thẻ giữ tiêu đề ghi mặc định.
                      title={pending.tool === "run_command" ? t("repoWs.cmd.confirmRunTitle", "Xác nhận CHẠY lệnh") : undefined}
                    />
                  </>
                ) : null}
                </div>

                <div ref={endRef} />
              </div>
            </ScrollArea>

            {/* ★★★ doc 81 · VIỆC 3 (1) — Ô nhập NHIỀU DÒNG: dán được stack trace, Shift+Enter xuống dòng.
                ⚠ `shrink-0` (2026-08-23): ô nhập là thứ DUY NHẤT làm màn này dùng được. Không có nó,
                  trong một `flex flex-col` chật nó là khối co được đầu tiên và bị bóp về 0. */}
            <div data-o-nhap className="relative shrink-0 border-t p-2">
              {/* ★★★ 2026-08-25 · ĐỢT 2 (C) — DROPDOWN @-mention: NỔI trên ô nhập (absolute) nên
                  KHÔNG đẩy ô nhập xuống dưới nếp gấp (cùng kỷ luật `khungVuaManHinh`). Ẩn khi rỗng.
                  A11y: textarea là `combobox` trỏ `aria-controls` tới hộp này. ⚠ Giới hạn đã ghi:
                  KHÔNG có `aria-activedescendant` — `GoiYTep` (cấm sửa ở đợt này) không phát id cho
                  từng mục, nên không neo được con trỏ đọc màn hình vào mục đang tô. */}
              {dsKhop.length > 0 && (
                <div id="repows-goiy-tep" className="absolute inset-x-2 bottom-full z-20 mb-1">
                  <GoiYTep dsKhop={dsKhop} chiSoChon={chiSoChon} onChon={chenMention} />
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  ref={oNhapRef}
                  value={input}
                  onChange={(e) => { setInput(e.target.value); tuGianChieuCao(e.currentTarget); capNhatGoiYTep(e.currentTarget); }}
                  placeholder={t("repoWs.chat.placeholder", "Hỏi tác nhân: đọc/tìm mã, đề xuất sửa, chạy test…")}
                  onKeyDown={(e) => {
                    const dangGoIme = (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing;
                    // ★ ĐỢT 2 (C) — điều hướng gợi ý @-mention CHẶN TRƯỚC `phanQuyetPhimNhap` (chỉ khi
                    //   đang gợi ý VÀ không trong lúc gõ IME). dsKhop rỗng ⇒ để `phanQuyetPhimNhap` xử
                    //   như cũ (Enter gửi). `phanQuyetPhimNhap` KHÔNG đổi — chỉ chèn xử lý @ TRƯỚC nó.
                    if (!dangGoIme && dsKhop.length > 0) {
                      if (e.key === "ArrowDown") { e.preventDefault(); setChiSoChon((i) => Math.min(i + 1, dsKhop.length - 1)); return; }
                      if (e.key === "ArrowUp") { e.preventDefault(); setChiSoChon((i) => Math.max(i - 1, 0)); return; }
                      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); chenMention(dsKhop[chiSoChon] ?? dsKhop[0]!); return; }
                      if (e.key === "Escape") { e.preventDefault(); setDsKhop([]); viTriAtRef.current = null; return; }
                    }
                    const pq = phanQuyetPhimNhap({
                      key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey,
                      isComposing: dangGoIme,
                    });
                    // "xuong_dong" và "bo_qua" ⇒ KHÔNG `preventDefault` ⇒ trình duyệt tự chèn "\n".
                    if (pq === "gui") { e.preventDefault(); void handleSend(); }
                  }}
                  disabled={isStreaming}
                  rows={1}
                  role="combobox"
                  aria-expanded={dsKhop.length > 0}
                  aria-controls="repows-goiy-tep"
                  aria-autocomplete="list"
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
        {/* ★★★ 2026-08-24 · TERMINAL/VẤN ĐỀ — CỬA SỔ FULL-WIDTH Ở ĐÁY (mẫu VSCode). Đặt NGOÀI
            lưới 3 cột, dưới cùng khung: KHÔNG chen cột chat nên KHÔNG đè thẻ duyệt/ đẩy ô nhập
            (hai lỗi layout của bản trong-cột đã hết theo cấu tạo). Co được + cap ≤45% khung; nội
            dung `flex-1` cuộn nội bộ. Bấm tab đang mở ⇒ gập. `duoiChat` TUỲ CHỌN HIỂN THỊ (không
            reset). Panel Vấn đề đọc lỗi đã parse ở `lenhDaChay` lượt mới nhất (`phanTichLoiViTri`). */}
        <div data-vo-duoi className="flex min-h-0 shrink flex-col overflow-hidden border-t max-h-[45%]">
          <div className="flex shrink-0 items-center gap-1 px-2 py-1" role="tablist" aria-label={t("repoWs.pane.tablist", "Chọn khung")}>
            <button
              type="button"
              role="tab"
              id="repows-tab-terminal"
              aria-selected={duoiChat === "terminal"}
              aria-controls="repows-panel-duoi"
              data-tab-duoi="terminal"
              onClick={() => setDuoiChat((v) => (v === "terminal" ? "dong" : "terminal"))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                duoiChat === "terminal" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              {t("repoWs.pane.terminalTab", "Terminal")}
              {lenhDaChay.length > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{lenhDaChay.length}</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              id="repows-tab-problems"
              aria-selected={duoiChat === "problems"}
              aria-controls="repows-panel-duoi"
              data-tab-duoi="problems"
              onClick={() => setDuoiChat((v) => (v === "problems" ? "dong" : "problems"))}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
                duoiChat === "problems" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("repoWs.pane.problemsTab", "Vấn đề")}
              {soVanDe > 0 && (
                <span className="rounded-full bg-amber-100 px-1.5 text-[10px] tabular-nums text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  {t("repoWs.pane.problemsCount", "{{n}}", { n: soVanDe })}
                </span>
              )}
            </button>
          </div>
          {duoiChat !== "dong" && (
            <div
              className="min-h-0 flex-1 overflow-y-auto border-t px-2 py-2"
              role="tabpanel"
              id="repows-panel-duoi"
              aria-labelledby={duoiChat === "terminal" ? "repows-tab-terminal" : "repows-tab-problems"}
            >
              {duoiChat === "terminal" ? (
                <BangTerminal
                  luotLenh={lenhDaChay}
                  goiYNhanh={goiYTheoDuAn(projectId)}
                  dangGui={isStreaming}
                  onChayNhanh={(g) => handleSend(t(g.khoa, g.macDinh))}
                  luotSong={dangChayLenhSong ? songQ.data ?? null : null}
                  onChayLai={(lenh) => handleSend(t("repoWs.terminal.rerunPrompt", "chạy {{lenh}}", { lenh }))}
                  onXoaLichSu={() => setLenhDaChay([])}
                />
              ) : (
                <BangProblems
                  diaDiem={lenhDaChay[lenhDaChay.length - 1]?.diaDiemLoi ?? []}
                  tepDangChon={selectedPath}
                  onMoTep={moTepTuVanDe}
                />
              )}
            </div>
          )}
        </div>

        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
