/**
 * Doc 81 Đợt 2 Task 3 — <ApprovalQueue> / <TransitionDialog>: luồng duyệt/từ chối dùng chung cho
 * ECN (EngineeringChanges) và CR của Standards (FE2 §4.5 — "hàng đợi duyệt viết 2 lần").
 *
 * ── HAI BẤT BIẾN (plan Global Constraint 3) ─────────────────────────────────────────────────────
 * 1. MAKER-CHECKER. `checkSegregation` khớp luật server:
 *    - `approve` LUÔN tách khỏi tác giả (ecnService "cannot approve your own", equipmentStandardsRouter
 *      `selfReviewChangeRequest`) — trang không tắt được;
 *    - trang khai thêm `segregateFrom` (vd ECN-05: người xem xét ≠ người duyệt ⇒ `["reviewer"]`;
 *      ECN review ⇒ `["author"]`; CR reject ⇒ `["author"]`);
 *    - tác giả null/≤0 (hệ thống sinh) coi là không-phải-mình, như `ecnService`;
 *    - KHÔNG biết người dùng hiện tại ⇒ chặn mọi quyết định (approve/reject) và mọi hành động có
 *      tách vai — không đoán.
 *    Client chặn sớm và NÓI lý do; server vẫn là cổng thật.
 * 2. TỪ CHỐI BẮT BUỘC LÝ DO (mặc định): chuỗi trắng không tính; tối thiểu `max(1, minReasonLength)`.
 *
 * ── CẤU HÌNH THEO HỢP ĐỒNG HIỆN TẠI CỦA TRANG (Ruling R-2-g) ─────────────────────────────────────
 * - `confirmStep` (mặc định true): approve/reject mở `TransitionDialog` (SHEET phải — flyout, không
 *   phải dialog giữa màn). false ⇒ gọi thẳng `onTransition` như Standards CR hôm nay.
 *   `advance` (submit/review/implement/close) mặc định gọi thẳng; `action.confirmStep` ghi đè.
 * - `rejectReasonRequired` (mặc định true). false ⇒ ý kiến từ chối không bắt buộc (CR hôm nay).
 *   Khi lý do còn bắt buộc, từ chối LUÔN mở sheet dù `confirmStep=false`.
 * - Maker-checker KHÔNG có công tắc: mọi đường (sheet hay gọi thẳng) đều qua `checkSegregation`.
 *
 * Lỗi của `onTransition` (promise reject) hiện qua `toastTrpcError`; ở đường sheet, sheet GIỮ mở và
 * giữ chữ. Trang đã tự toast trong `onError` thì gọi `mutate` (không trả promise) để khỏi báo đôi.
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toastTrpcError } from "@/lib/trpcErrors";

export type TransitionKind = "approve" | "reject" | "advance";
export type SegregationRole = "author" | "reviewer";

export interface TransitionAction {
  /** Khoá hành động gửi lên server, vd "approve", "reject", "review", "in_review". */
  key: string;
  /** Nhãn đã dịch. */
  label: string;
  kind: TransitionKind;
  /** Tách vai THÊM (approve luôn tách khỏi tác giả). */
  segregateFrom?: readonly SegregationRole[];
  /** Lý do tối thiểu khi từ chối (mặc định 1 = không rỗng). */
  minReasonLength?: number;
  /** Ghi đè `confirmStep` của hàng đợi cho riêng hành động này (advance mặc định false). */
  confirmStep?: boolean;
  /** Đợt 2 Task 9 — tooltip của nút khi được phép (vd câu "title" cũ của trang). Bị chặn tách vai ⇒ lý do chặn thắng. */
  hint?: string;
}

export interface ApprovalItem {
  id: string | number;
  /** Mã hiển thị, vd "ECN-0003" / "CR-12". */
  key: string;
  title: React.ReactNode;
  status: React.ReactNode;
  authorId: number | null | undefined;
  authorName?: React.ReactNode;
  reviewerId?: number | null;
  actions: readonly TransitionAction[];
  /** Đợt 2 Task 9 — hiện ở ô quyết định khi mục KHÔNG có hành động nào (vd "Chỉ xem", "—" của trạng thái cuối). */
  actionsFallback?: React.ReactNode;
}

export type SegregationResult = { allowed: true } | { allowed: false; reason: "author" | "reviewer" | "userUnknown" };

export interface SegregationContext {
  currentUserId: number | null | undefined;
  authorId: number | null | undefined;
  reviewerId?: number | null;
}

const isRealUser = (id: number | null | undefined): id is number => id != null && id > 0;

/** Luật maker-checker thuần (xem docblock). */
export function checkSegregation(action: Pick<TransitionAction, "kind" | "segregateFrom">, ctx: SegregationContext): SegregationResult {
  const roles = new Set<SegregationRole>(action.segregateFrom ?? []);
  if (action.kind === "approve") roles.add("author");
  const isDecision = action.kind === "approve" || action.kind === "reject";
  if ((isDecision || roles.size > 0) && !isRealUser(ctx.currentUserId)) return { allowed: false, reason: "userUnknown" };
  if (roles.has("author") && isRealUser(ctx.authorId) && ctx.authorId === ctx.currentUserId) return { allowed: false, reason: "author" };
  if (roles.has("reviewer") && isRealUser(ctx.reviewerId) && ctx.reviewerId === ctx.currentUserId) return { allowed: false, reason: "reviewer" };
  return { allowed: true };
}

function useSegregationMessage() {
  const { t } = useTranslation();
  return (r: SegregationResult): string | null => {
    if (r.allowed) return null;
    if (r.reason === "author") return t("layoutKit.approval.sodAuthor", "You created this item — someone else must decide (maker-checker).");
    if (r.reason === "reviewer") return t("layoutKit.approval.sodReviewer", "You reviewed this item — the approver must be someone else.");
    return t("layoutKit.approval.userUnknown", "The current user is not known yet — decisions are disabled.");
  };
}

export interface TransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: TransitionAction;
  /** Mục đang quyết định, vd "ECN-0003". */
  subject: React.ReactNode;
  description?: React.ReactNode;
  /** Kết quả `checkSegregation` cho mục + người dùng hiện tại. */
  segregation: SegregationResult;
  /** Gọi mutation; reject ⇒ dialog giữ mở. `comment` đã trim, undefined khi rỗng. */
  onConfirm: (comment: string | undefined) => void | Promise<void>;
  pending?: boolean;
  /** Lý do bắt buộc. Mặc định: true khi `action.kind === "reject"`. */
  reasonRequired?: boolean;
}

export function TransitionDialog({ open, onOpenChange, action, subject, description, segregation, onConfirm, pending = false, reasonRequired }: TransitionDialogProps) {
  const { t } = useTranslation();
  const sodMessage = useSegregationMessage()(segregation);
  const fieldId = React.useId();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) setText("");
  }, [open]);

  const isReject = action.kind === "reject";
  const needsReason = reasonRequired ?? isReject;
  const min = Math.max(1, action.minReasonLength ?? 1);
  const trimmed = text.trim();
  const reasonOk = !needsReason || trimmed.length >= min;
  const canConfirm = segregation.allowed && reasonOk && !busy && !pending;

  const submit = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm(trimmed === "" ? undefined : trimmed);
      onOpenChange(false);
    } catch (e) {
      // Giữ sheet mở và giữ chữ đã gõ; lỗi không bị nuốt.
      toastTrpcError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        onOpenChange(o);
      }}
    >
      <SheetContent side="right" data-transition-kind={action.kind} className="flex w-[92vw] flex-col gap-0 p-0 sm:max-w-[440px]">
        <SheetHeader className="border-b px-4 py-3 pr-10">
          <SheetTitle className="text-base">
            {action.label} — {subject}
          </SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {sodMessage && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{sodMessage}</span>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={fieldId}>
              {needsReason
                ? t("layoutKit.approval.reasonLabel", "Reason (required)")
                : t("layoutKit.approval.commentLabel", "Comment (optional)")}
            </Label>
            <Textarea
              id={fieldId}
              rows={4}
              value={text}
              required={needsReason}
              aria-invalid={needsReason && trimmed.length > 0 && !reasonOk ? true : undefined}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            {needsReason && trimmed.length > 0 && !reasonOk && (
              <p className="text-xs text-destructive">{t("layoutKit.approval.reasonTooShort", "The reason needs at least {{min}} characters.", { min })}</p>
            )}
            {needsReason && trimmed.length === 0 && (
              <p className="text-xs text-muted-foreground">{t("layoutKit.approval.reasonRequired", "A reason is required.")}</p>
            )}
          </div>
        </div>
        <SheetFooter className="flex-row justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("layoutKit.approval.cancel", "Cancel")}
          </Button>
          <Button variant={isReject ? "destructive" : "default"} disabled={!canConfirm} onClick={submit}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" />}
            {action.label}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export interface ApprovalQueueProps {
  items: readonly ApprovalItem[] | undefined;
  status: "loading" | "error" | "ready";
  /** id người dùng đăng nhập; null/undefined ⇒ chưa biết ⇒ chặn quyết định. */
  currentUserId: number | null | undefined;
  onTransition: (item: ApprovalItem, action: TransitionAction, comment: string | undefined) => void | Promise<void>;
  /** Mutation đang chạy ⇒ khoá mọi nút. */
  pending?: boolean;
  /** approve/reject qua sheet xác nhận (mặc định true). false = gọi thẳng như Standards CR hôm nay. */
  confirmStep?: boolean;
  /** Lý do từ chối bắt buộc (mặc định true). */
  rejectReasonRequired?: boolean;
  /** Đợt 2 Task 9 — câu khi danh sách trống (mặc định "Không có gì chờ quyết định"). */
  emptyTitle?: string;
  ariaLabel?: string;
  className?: string;
}

/** Hành động này có mở sheet xác nhận không (lý do bắt buộc ⇒ luôn mở). */
export function needsConfirmSheet(action: TransitionAction, opts: { confirmStep: boolean; rejectReasonRequired: boolean }): boolean {
  if (action.kind === "reject" && opts.rejectReasonRequired) return true;
  return action.confirmStep ?? (action.kind === "advance" ? false : opts.confirmStep);
}

export function ApprovalQueue({
  items,
  status,
  currentUserId,
  onTransition,
  pending = false,
  confirmStep = true,
  rejectReasonRequired = true,
  emptyTitle,
  ariaLabel,
  className,
}: ApprovalQueueProps) {
  const { t } = useTranslation();
  const sodMessageOf = useSegregationMessage();
  const baseId = React.useId();
  const [target, setTarget] = React.useState<{ item: ApprovalItem; action: TransitionAction } | null>(null);
  const list = items ?? [];

  if (status === "loading") {
    return <p className="py-6 text-center text-sm text-muted-foreground">{t("layoutKit.approval.loading", "Loading the queue…")}</p>;
  }
  if (status === "error") {
    return (
      <p role="alert" className="py-6 text-center text-sm text-destructive">
        {t("layoutKit.approval.error", "Could not load the approval queue.")}
      </p>
    );
  }
  if (list.length === 0) {
    return <EmptyState variant="no-data" compact title={emptyTitle ?? t("layoutKit.approval.empty", "Nothing is waiting for a decision.")} />;
  }

  const ctxOf = (it: ApprovalItem): SegregationContext => ({ currentUserId, authorId: it.authorId, reviewerId: it.reviewerId });

  return (
    <div className={cn("min-w-0", className)}>
      <Table aria-label={ariaLabel ?? t("layoutKit.approval.label", "Approval queue")}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("layoutKit.approval.colItem", "Item")}</TableHead>
            <TableHead>{t("layoutKit.approval.colAuthor", "Author")}</TableHead>
            <TableHead>{t("layoutKit.approval.colStatus", "Status")}</TableHead>
            <TableHead className="text-right">{t("layoutKit.approval.colActions", "Decision")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((it) => (
            <TableRow key={String(it.id)} data-approval-id={String(it.id)}>
              <TableCell>
                <span className="font-mono text-xs">{it.key}</span>
                <span className="ml-2">{it.title}</span>
              </TableCell>
              <TableCell className="text-xs">{it.authorName ?? "—"}</TableCell>
              <TableCell>{it.status}</TableCell>
              <TableCell className="text-right">
                <div className="flex flex-wrap justify-end gap-1">
                  {it.actions.length === 0 && it.actionsFallback != null ? it.actionsFallback : null}
                  {it.actions.map((a) => {
                    const seg = checkSegregation(a, ctxOf(it));
                    const msg = sodMessageOf(seg);
                    const descId = `${baseId}-${String(it.id)}-${a.key}`;
                    return (
                      <React.Fragment key={a.key}>
                        <Button
                          size="sm"
                          variant={a.kind === "reject" ? "destructive" : "outline"}
                          disabled={!seg.allowed || pending}
                          aria-describedby={msg ? descId : undefined}
                          title={msg ?? a.hint}
                          onClick={() => {
                            // Maker-checker kiểm lại ở mọi đường, kể cả gọi thẳng.
                            if (!checkSegregation(a, ctxOf(it)).allowed) return;
                            if (needsConfirmSheet(a, { confirmStep, rejectReasonRequired })) {
                              setTarget({ item: it, action: a });
                              return;
                            }
                            // Gọi ĐỒNG BỘ (như trang cũ); lỗi đồng bộ hay promise reject đều được báo.
                            try {
                              const r = onTransition(it, a, undefined);
                              if (r && typeof (r as Promise<void>).then === "function") {
                                (r as Promise<void>).catch((e: unknown) => {
                                  toastTrpcError(e);
                                });
                              }
                            } catch (e) {
                              toastTrpcError(e);
                            }
                          }}
                        >
                          {a.label}
                        </Button>
                        {msg && (
                          <span id={descId} className="sr-only">
                            {msg}
                          </span>
                        )}
                      </React.Fragment>
                    );
                  })}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {target && (
        <TransitionDialog
          open
          onOpenChange={(o) => {
            if (!o) setTarget(null);
          }}
          action={target.action}
          subject={target.item.key}
          segregation={checkSegregation(target.action, ctxOf(target.item))}
          pending={pending}
          reasonRequired={target.action.kind === "reject" ? rejectReasonRequired : false}
          onConfirm={(comment) => onTransition(target.item, target.action, comment)}
        />
      )}
    </div>
  );
}

export default ApprovalQueue;
