/**
 * G2-D — XEM DIFF THEO KHỐI, NHẬN/BỎ TỪNG KHỐI.
 *
 * Bổ sung cho <LineDiff/> (chỉ XEM). Ở đây mỗi khối thay đổi có nút Nhận / Hoàn tác riêng.
 * Toàn bộ phép tính nằm ở `@/lib/diffHunks` (thuần, có lưới + đã đột biến); component này
 * chỉ giữ TẬP KHỐI ĐANG ÁP và vẽ.
 *
 * ── BA ĐIỀU KHÔNG ĐƯỢC LÀM HỎNG ─────────────────────────────────────────────────
 * 1. AN TOÀN DỮ LIỆU. Mọi lượt ghi đi qua `applyHunkSelection`, vốn đòi buffer sống bằng
 *    ĐÚNG cái lượt trước ta ghi ra. Người dùng gõ thêm ⇒ nhánh `buffer-changed` ⇒ KHÔNG
 *    ghi, hiện băng cảnh báo, mời tính lại từ buffer hiện tại. Không có đường nào áp mù.
 * 2. HOÀN TÁC. Bỏ một khối = bỏ id khỏi tập rồi CHIẾU LẠI TỪ BẢN GỐC — không phải phép
 *    nghịch đảo tại chỗ, nên không tích luỹ sai số dù bật/tắt bao nhiêu lần.
 * 3. GHOST-TEXT. Component này KHÔNG gắn listener bàn phím toàn cục nào. `Tab` và `Escape`
 *    vẫn thuộc về `inlineCopilotExtension` (Prec.highest trong CodeMirror) và về Dock.
 *    Mọi thao tác ở đây là bấm nút. Khi ghi, doc của CodeMirror đổi ⇒ `ghostField` tự xoá
 *    gợi ý đang treo (nhánh `tr.docChanged`), nên không có chuyện chèn ghost-text cũ vào
 *    một văn bản đã dịch dòng.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Undo2, AlertTriangle, RefreshCw, Info } from "lucide-react";
import {
  applyHunkSelection,
  computeHunkPlan,
  detectEol,
  planStats,
  projectHunks,
  type DiffHunk,
} from "@/lib/diffHunks";

export interface HunkDiffViewProps {
  /** Ảnh chụp buffer TẠI LÚC gợi ý được sinh ra. Mọi toạ độ khối nói về chuỗi này. */
  base: string;
  /** Toàn văn gợi ý của model. */
  suggested: string;
  /** Buffer SỐNG ngay lúc này (để phát hiện người dùng gõ thêm giữa chừng). */
  currentText: string;
  /** Ghi ĐÈ toàn bộ buffer host bằng `text`. Khác `onApply` cũ (host tự quyết định chèn/nối). */
  onApplyText: (text: string) => void;
  /** Chụp lại `base` từ buffer hiện tại (lối thoát khi băng "buffer đã đổi" hiện lên). */
  onResync?: () => void;
  className?: string;
  /**
   * ★★★ ĐỢT 3 (2026-08-23) — CHẾ ĐỘ **ĐIỀU KHIỂN TỪ NGOÀI**, cho thẻ duyệt HITL (`TheDuyetDiff`).
   * Ở đó tập khối đang chọn KHÔNG còn là "trạng thái xem trước" mà là **thứ quyết định byte sẽ
   * ghi**, nên nó phải sống ở CHA (nơi bấm Duyệt) chứ không trong component vẽ diff. Có mặt ⇒
   * component KHÔNG giữ state chọn riêng và KHÔNG tự đặt lại khi plan đổi — vòng đời thuộc về cha.
   */
  chonNgoai?: { daChon: string[]; onDoi: (ids: string[]) => void };
  /**
   * ★ GHIM luật EOL về đúng `keHoachKhoiDuyet` (matchEol ⇔ phát hiện lệch): ẩn checkbox tuỳ chọn.
   * Bắt buộc bật cùng `chonNgoai` trong thẻ duyệt — một checkbox đổi được plan ở MỘT phía sẽ làm
   * chỉ số khối client gửi trỏ vào khối SAI trên plan mà server tự dựng lại.
   */
  khoaEol?: boolean;
}

function LineRow({ sign, text }: { sign: "+" | "-"; text: string }) {
  const add = sign === "+";
  return (
    <div className={cn("flex", add ? "bg-emerald-500/10" : "bg-red-500/10")}>
      <span
        className={cn(
          "w-4 shrink-0 select-none text-center",
          add ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
        )}
      >
        {sign}
      </span>
      <span
        className={cn(
          "whitespace-pre px-1",
          add ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300",
        )}
      >
        {/* `\r` cuối dòng của file CRLF không được vẽ ra màn — nó vẫn nằm nguyên trong dữ liệu. */}
        {text.replace(/\r$/, "") || " "}
      </span>
    </div>
  );
}

export function HunkDiffView({
  base,
  suggested,
  currentText,
  onApplyText,
  onResync,
  className,
  chonNgoai,
  khoaEol,
}: HunkDiffViewProps) {
  const { t } = useTranslation();

  // Model hay trả LF cho một buffer CRLF. Không khớp lại thì MỌI dòng đều "khác" và diff
  // biến thành một khối nuốt cả file — đúng nhưng vô dụng. Mặc định BẬT khi phát hiện lệch.
  // ⚠ `khoaEol` (ĐỢT 3): luật bị GHIM = đúng mặc định ấy, checkbox không render — xem docblock prop.
  const eolMismatch = detectEol(base) !== detectEol(suggested);
  const [matchEolPref, setMatchEolPref] = useState<boolean | null>(null);
  const matchEol = khoaEol ? eolMismatch : (matchEolPref ?? eolMismatch);

  const plan = useMemo(
    () => computeHunkPlan(base, suggested, { matchEol }),
    [base, suggested, matchEol],
  );

  /**
   * Tập khối phía ta TIN là đang nằm trong buffer. Nguồn sự thật cho cả nhận lẫn hoàn tác.
   * ⚠ ĐỢT 3: có `chonNgoai` ⇒ nguồn sự thật là CHA (thẻ duyệt — tập này quyết định byte sẽ ghi);
   *   state nội bộ chỉ dùng cho chế độ cũ (xem-trước trong editor).
   */
  const [appliedNoiBo, setAppliedNoiBo] = useState<string[]>([]);
  const applied = chonNgoai ? chonNgoai.daChon : appliedNoiBo;
  const datApplied = chonNgoai ? chonNgoai.onDoi : setAppliedNoiBo;

  // Gợi ý mới / bản gốc mới ⇒ mọi id cũ vô nghĩa. Đặt lại tập chọn (và lựa chọn EOL).
  // ⚠ Chế độ điều khiển từ ngoài KHÔNG đặt lại ở đây — cha sở hữu vòng đời (nó đặt lại về TẤT CẢ,
  //   không phải về rỗng; hai mặc định khác nhau vì hai nghĩa khác nhau: xem-trước vs sẽ-ghi).
  const dieuKhienNgoai = chonNgoai !== undefined;
  const planKey = `${plan.baseSignature}|${plan.modified.length}|${plan.hunks.length}|${plan.eolMatched}`;
  useEffect(() => {
    if (!dieuKhienNgoai) setAppliedNoiBo([]);
  }, [planKey, dieuKhienNgoai]);
  useEffect(() => {
    setMatchEolPref(null);
  }, [base, suggested]);

  const expected = useMemo(() => projectHunks(plan, applied), [plan, applied]);
  const stale = !expected.ok || currentText !== expected.text;
  const stats = planStats(plan);
  const appliedSet = useMemo(() => new Set(applied), [applied]);

  const ghi = (next: string[]) => {
    const r = applyHunkSelection({ plan, applied, next, currentText });
    if (!r.ok) {
      if (r.reason === "buffer-changed") {
        toast.error(
          t("diff.hunk.refusedChanged", "Buffer đã thay đổi từ lúc sinh gợi ý — không áp để tránh ghi đè mã của bạn."),
        );
      } else {
        toast.error(t("diff.hunk.refusedUnknown", "Khối không còn hợp lệ — hãy tính lại diff."));
      }
      return;
    }
    datApplied(next);
    onApplyText(r.text);
  };

  const toggle = (h: DiffHunk) =>
    ghi(appliedSet.has(h.id) ? applied.filter((x) => x !== h.id) : [...applied, h.id]);
  const apDung = () => ghi(plan.hunks.map((h) => h.id));
  const boHet = () => ghi([]);

  const nhanPhamVi = (h: DiffHunk): string =>
    h.origEnd > h.origStart
      ? t("diff.hunk.range", "Dòng {{from}}–{{to}}", { from: h.origStart + 1, to: h.origEnd })
      : h.origStart === 0
        ? t("diff.hunk.insertTop", "Chèn ở đầu tệp")
        : t("diff.hunk.insertAfter", "Chèn sau dòng {{n}}", { n: h.origStart });

  if (plan.hunks.length === 0) {
    return (
      <div className={cn("rounded-md border bg-muted/20 p-2 text-xs text-muted-foreground", className)}>
        {t("diff.hunk.none", "Gợi ý trùng khớp buffer hiện tại — không có khối nào để áp.")}
      </div>
    );
  }

  return (
    // ★★★ 2026-08-23 · `min-w-0` — thành phần này sống trong thẻ duyệt HITL của
    //   `/ai-coding-workspace`, một cột hẹp. Thiếu `min-w-0` thì bề rộng `max-content` của DÒNG
    //   DIFF DÀI NHẤT trở thành bề rộng tối thiểu của cả thẻ, và thẻ kéo khung rộng ra (đo được
    //   736 px trong khung 400 px) — đúng cơ chế đẩy nút "Hủy" ra ngoài vùng nhìn.
    <div className={cn("min-w-0 space-y-2", className)}>
      {/* ── Thanh điều khiển ────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline" className="text-[10px]">
          {t("diff.hunk.count", "{{n}} khối", { n: plan.hunks.length })}
        </Badge>
        <span className="text-[11px] text-emerald-600 dark:text-emerald-400">+{stats.added}</span>
        <span className="text-[11px] text-red-600 dark:text-red-400">−{stats.removed}</span>
        <Badge variant="secondary" className="text-[10px]">
          {t("diff.hunk.appliedN", "Đã nhận {{n}}", { n: applied.length })}
        </Badge>
        {/* `flex-wrap` + `ml-auto`: khi còn chỗ thì hai nút dạt phải như cũ; khi hẹp thì chúng
            XUỐNG DÒNG. Không có `flex-wrap`, cặp nút này là một khối cứng ~200 px và nó góp vào
            bề rộng tối thiểu của cả thẻ duyệt. */}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Button
            type="button" size="sm" variant="outline" className="h-7 text-[11px]"
            disabled={stale || applied.length === 0} onClick={boHet}
          >
            <Undo2 className="mr-1 h-3.5 w-3.5" /> {t("diff.hunk.revertAll", "Hoàn tác hết")}
          </Button>
          <Button
            type="button" size="sm" className="h-7 text-[11px]"
            disabled={stale || applied.length === plan.hunks.length} onClick={apDung}
          >
            <Check className="mr-1 h-3.5 w-3.5" /> {t("diff.hunk.applyAll", "Áp tất cả")}
          </Button>
        </span>
      </div>

      {/* ── Lệch kiểu xuống dòng (Windows: CRLF là ca thật) ─────────────────── */}
      {/* `khoaEol` ⇒ KHÔNG có checkbox: luật EOL phải tất định để chỉ số khối hai đầu dây khớp nhau. */}
      {!khoaEol && eolMismatch && (
        <label className="flex items-start gap-1.5 rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox" className="mt-0.5" checked={matchEol}
            onChange={(e) => setMatchEolPref(e.target.checked)}
          />
          <span>
            {t("diff.hunk.eolMismatch", "Gợi ý dùng kiểu xuống dòng khác buffer — khớp lại theo buffer trước khi so (bỏ chọn để so nguyên văn).")}
          </span>
        </label>
      )}

      {/* ── Cầu chì kích thước ──────────────────────────────────────────────── */}
      {plan.oversize && (
        <p className="flex items-start gap-1.5 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          {t("diff.hunk.oversize", "Tệp quá lớn để tách khối — chỉ còn một khối cả tệp.")}
        </p>
      )}

      {/* ── BUFFER ĐÃ ĐỔI: chặn ghi, nói thẳng, mời tính lại ────────────────── */}
      {stale && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-2 text-[11px] text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div className="space-y-1">
            <p>
              {t("diff.hunk.staleTitle", "Buffer đã đổi từ lúc sinh gợi ý. Không áp khối nào để tránh ghi đè mã bạn vừa gõ.")}
            </p>
            {onResync && (
              <Button type="button" size="sm" variant="outline" className="h-6 text-[11px]" onClick={onResync}>
                <RefreshCw className="mr-1 h-3 w-3" /> {t("diff.hunk.resync", "Tính lại diff từ buffer hiện tại")}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* ── Danh sách khối ──────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {plan.hunks.map((h) => {
          const on = appliedSet.has(h.id);
          return (
            <div key={h.id} className={cn("min-w-0 overflow-hidden rounded-md border", on && "border-primary/50")}>
              <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-muted/40 px-2 py-1">
                <span className="font-mono text-[10px] text-muted-foreground">#{h.index + 1}</span>
                <span className="text-[11px] text-muted-foreground">{nhanPhamVi(h)}</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">+{h.added.length}</span>
                <span className="text-[10px] text-red-600 dark:text-red-400">−{h.removed.length}</span>
                {on && (
                  <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                    {t("diff.hunk.on", "Đã nhận")}
                  </Badge>
                )}
                <Button
                  type="button" size="sm" variant={on ? "outline" : "default"}
                  className="ml-auto h-6 px-2 text-[11px]" aria-pressed={on}
                  disabled={stale} onClick={() => toggle(h)}
                >
                  {on ? (
                    <><Undo2 className="mr-1 h-3 w-3" /> {t("diff.hunk.undo", "Hoàn tác")}</>
                  ) : (
                    <><Check className="mr-1 h-3 w-3" /> {t("diff.hunk.accept", "Nhận khối")}</>
                  )}
                </Button>
              </div>
              {/* ★★★ 2026-08-23 · ĐÂY mới là chỗ đúng của một thanh cuộn ngang: dòng diff là nội
                  dung THẬT SỰ rộng và **không được** xuống dòng (xuống dòng làm sai lệch mã). `w-full
                  min-w-0` ghim hộp này bằng bề rộng khung, `overflow-auto` cho nó tự cuộn — nên nó
                  KHÔNG còn kéo thẻ duyệt rộng ra. `overscroll-x-contain`: cuộn hết dòng thì dừng ở
                  đây, không hất tiếp sang khung cha. */}
              <pre className="max-h-56 w-full min-w-0 overflow-auto overscroll-x-contain text-[11px] leading-relaxed">
                <code className="block">
                  {h.removed.map((l, i) => <LineRow key={`d${i}`} sign="-" text={l} />)}
                  {h.added.map((l, i) => <LineRow key={`a${i}`} sign="+" text={l} />)}
                </code>
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default HunkDiffView;
