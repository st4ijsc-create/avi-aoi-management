/**
 * Doc 81 Đợt 2 Task 3 — <NoticeChip> + <NoticeStack> + <FeatureStatusNoticeChip>.
 *
 * Thay các banner nhiều dòng trước nội dung chính (gợi ý, cờ tắt, lưu ý trung thực số liệu, cổng mô
 * phỏng, Beta, "Khi nào dùng") bằng CHIP 1 DÒNG mở popover. Chip đặt trong slot `chips` của
 * `PageHeaderCompact` — cùng hàng với h1 — nên không còn khối nào chen giữa tiêu đề và MAIN
 * (thiết bị đo đếm mọi khối nằm dưới đáy h1 và trên MAIN là banner).
 *
 * Nội dung và ĐIỀU KIỆN hiện của từng notice giữ nguyên ở trang gọi; component chỉ đổi hình dạng.
 * "Khi nào dùng": trang dùng `<NoticeChip kind="whenToUse">` với KHOÁ i18n riêng của trang (vd `engineering.whenToUse`) —
 * không gộp khoá (final wave M-3: bỏ atom `WhenToUseHint`/`whenToUseNotice` không còn nơi dùng).
 * `FeatureStatusNoticeChip` giữ đủ 4 trạng thái của `FeatureStatusGate` (loading/off/on/error):
 * "on" không hiện gì, "loading"/"error" KHÔNG BAO GIỜ hiện như "off" hay "on".
 *
 * Popover mặc định ĐÓNG (thiết bị đo coi popover mở sẵn là lớp phủ dải đầu trang).
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Cpu, FlaskConical, Info, Lightbulb, Loader2, PowerOff, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { FeatureStatus } from "@/components/common/FeatureStatusGate";
import { useHeaderChipFold } from "./headerChipFold";

export type NoticeKind =
  | "hint"
  | "whenToUse"
  | "flagOff"
  | "honesty"
  | "simGate"
  | "beta"
  | "loading"
  | "error"
  /** Đợt 3b Task 2 fix 1 — chip thuộc tính (vd metadata luồng IR: popover là form sửa). */
  | "meta"
  /** Đợt 3b Task 2 fix 1 — chip trạng thái ĐẠT (vd "Lint OK" của IR). */
  | "status";

const KIND_ICON: Record<NoticeKind, LucideIcon> = {
  hint: Lightbulb,
  whenToUse: Info,
  flagOff: PowerOff,
  honesty: ShieldAlert,
  simGate: FlaskConical,
  beta: FlaskConical,
  loading: Loader2,
  error: AlertTriangle,
  meta: Cpu,
  status: ShieldCheck,
};

const KIND_TONE: Record<NoticeKind, string> = {
  hint: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  whenToUse: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  flagOff: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  honesty: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  simGate: "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  beta: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  loading: "border-border bg-muted text-muted-foreground",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  meta: "border-border bg-card text-foreground hover:bg-muted",
  status: "border-success/40 bg-success/10 text-success",
};

/** Nhãn mặc định theo loại (khoá `layoutKit.notice.kind.*`). */
const KIND_LABEL_KEY: Record<NoticeKind, [string, string]> = {
  hint: ["layoutKit.notice.kind.hint", "Hint"],
  whenToUse: ["layoutKit.notice.kind.whenToUse", "When to use"],
  flagOff: ["layoutKit.notice.kind.flagOff", "Turned off"],
  honesty: ["layoutKit.notice.kind.honesty", "Data note"],
  simGate: ["layoutKit.notice.kind.simGate", "Simulation only"],
  beta: ["layoutKit.notice.kind.beta", "Beta"],
  loading: ["layoutKit.notice.kind.loading", "Checking"],
  error: ["layoutKit.notice.kind.error", "Status unknown"],
  meta: ["layoutKit.notice.kind.meta", "Properties"],
  status: ["layoutKit.notice.kind.status", "Status"],
};

export interface NoticeChipProps {
  kind: NoticeKind;
  /** Nhãn chip; mặc định là nhãn theo loại. Giữ NGẮN (1 dòng). */
  label?: React.ReactNode;
  /** Nội dung đầy đủ của notice (câu cũ của banner) — hiện trong popover. */
  children: React.ReactNode;
  /** Mở sẵn — CHỈ dùng trong test/story; trang thật để mặc định (đóng). */
  defaultOpen?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function NoticeChip({ kind, label, children, defaultOpen, className, ...rest }: NoticeChipProps): React.JSX.Element {
  const { t } = useTranslation();
  const Icon = KIND_ICON[kind];
  const [labelKey, labelFallback] = KIND_LABEL_KEY[kind];
  return (
    <Popover defaultOpen={defaultOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-notice-kind={kind}
          data-testid={rest["data-testid"]}
          className={cn(
            "inline-flex h-7 max-w-[16rem] shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            KIND_TONE[kind],
            className,
          )}
        >
          <Icon className={cn("h-3.5 w-3.5 shrink-0", kind === "loading" && "animate-spin")} aria-hidden="true" />
          <span className="truncate">{label ?? t(labelKey, labelFallback)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm" data-notice-popover={kind}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export interface NoticeItem {
  id: string;
  kind: NoticeKind;
  label?: React.ReactNode;
  content: React.ReactNode;
  /** `data-testid` của chip (và của mục trong popover "+N" khi bị gộp) — Task 2 shell. */
  testId?: string;
  /**
   * Đợt 3b Task 2 fix 1 — câu đọc NGAY cho trình đọc màn hình (vùng `role="alert"` sr-only), hiện ĐỘC LẬP với việc chip
   * đang hiện thẳng hay đã gộp vào "+N" (giữ final wave M-9 của `FeatureStatusNoticeChip` khi chip đó vào NoticeStack).
   */
  alert?: React.ReactNode;
  /** Lớp thêm cho chip khi hiện thẳng (vd chữ mono của metadata). */
  className?: string;
}

export interface NoticeStackProps {
  items: ReadonlyArray<NoticeItem | null | false | undefined>;
  /** Số chip hiện thẳng; phần dư gộp vào chip "+N". Mặc định 3. */
  maxVisible?: number;
  className?: string;
}

/**
 * Dải notice 1 dòng (không xuống dòng). Mục `null/false` bị bỏ — trang giữ điều kiện hiện
 * của từng notice ngay trong mảng: `[flagOff && {...}, {...whenToUse}]`.
 */
export function NoticeStack({ items, maxVisible = 3, className }: NoticeStackProps): React.JSX.Element | null {
  const { t } = useTranslation();
  // doc 81 Đợt 3b Task 2 (b) — trong header ở 640–1023 px: chỉ notice LỖI hiện, phần còn lại vào "+N".
  const fold = useHeaderChipFold();
  const list = items.filter((x): x is NoticeItem => Boolean(x));
  if (list.length === 0) return null;
  // Fix round 1: notice LỖI không bao giờ bị gộp vào "+N" trước notice khác (header cắt phần tràn).
  const ranked = [...list.filter((n) => n.kind === "error"), ...list.filter((n) => n.kind !== "error")];
  const limit = fold ? Math.min(maxVisible, list.filter((n) => n.kind === "error").length) : maxVisible;
  const keep = new Set(ranked.slice(0, Math.max(0, limit)));
  const visible = list.filter((n) => keep.has(n));
  const hidden = list.filter((n) => !keep.has(n));
  return (
    <div
      role="group"
      aria-label={t("layoutKit.notice.stackLabel", "Page notes")}
      data-notice-stack=""
      className={cn("flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden", className)}
    >
      {visible.map((n) => (
        <NoticeChip key={n.id} kind={n.kind} label={n.label} data-testid={n.testId} className={n.className}>
          {n.content}
        </NoticeChip>
      ))}
      {list.map((n) =>
        n.alert != null ? (
          <span key={`alert-${n.id}`} role="alert" className="sr-only" data-feature-status-alert="">
            {n.alert}
          </span>
        ) : null,
      )}
      {hidden.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              data-notice-more={hidden.length}
              aria-label={t("layoutKit.notice.moreLabel", "Show {{count}} more notes", { count: hidden.length })}
              className="inline-flex h-7 shrink-0 items-center rounded-full border bg-muted px-2 text-xs font-medium text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("layoutKit.notice.more", "+{{count}}", { count: hidden.length })}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 space-y-3 text-sm">
            {hidden.map((n) => {
              const [labelKey, labelFallback] = KIND_LABEL_KEY[n.kind];
              return (
                <section key={n.id} data-notice-kind={n.kind} data-testid={n.testId} className="space-y-1">
                  <h3 className="text-xs font-semibold text-muted-foreground">{n.label ?? t(labelKey, labelFallback)}</h3>
                  <div>{n.content}</div>
                </section>
              );
            })}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/**
 * Đợt 3b Task 2 fix 1 (R-3b-b (2)) — bản `NoticeItem` của `FeatureStatusNoticeChip` (cùng 4 trạng thái, cùng nhãn, cùng
 * `data-testid`, cùng câu; lỗi ⇒ vẫn có vùng `role="alert"` đọc ngay qua `alert`) để chip cờ vào `NoticeStack` của trang
 * và gộp được vào "+N". `on` ⇒ null (không hiện gì) như chip.
 */
export function featureStatusNoticeItem(
  t: (key: string, fallback: string) => string,
  { status, offMessage, errorMessage, subject, id = "feature-status" }: FeatureStatusNoticeChipProps & { id?: string },
): NoticeItem | null {
  if (status === "on") return null;
  const label = (kind: NoticeKind): React.ReactNode => {
    if (subject == null) return undefined;
    const [labelKey, labelFallback] = KIND_LABEL_KEY[kind];
    return (
      <>
        {subject}: {t(labelKey, labelFallback)}
      </>
    );
  };
  if (status === "loading") {
    return { id, kind: "loading", label: label("loading"), testId: "feature-status-loading", content: <p>{t("layoutKit.notice.flagLoading", "Checking feature status…")}</p> };
  }
  if (status === "error") {
    const msg = errorMessage ?? t("common.featureStatusError", "Could not check this feature's status — treating it as unavailable.");
    return { id, kind: "error", label: label("error"), testId: "feature-status-error", content: <p>{msg}</p>, alert: msg };
  }
  return { id, kind: "flagOff", label: label("flagOff"), testId: "feature-status-off", content: <p>{offMessage}</p> };
}

export interface FeatureStatusNoticeChipProps {
  status: FeatureStatus;
  /** Câu cho trạng thái TẮT — câu thân thiện cũ của trang, không tên biến môi trường. */
  offMessage: React.ReactNode;
  /** Câu riêng cho trạng thái LỖI; không truyền thì dùng câu chung `common.featureStatusError`. */
  errorMessage?: React.ReactNode;
  /**
   * Doc 81 Đợt 2 Task 8 — tên cờ khi một trang có NHIỀU cờ (Safety: kiểm định an toàn + nhân lực): nhãn chip
   * thành "<subject>: <trạng thái>" để người dùng biết cờ NÀO đang tắt/lỗi mà không phải mở popover.
   * Không truyền ⇒ nhãn mặc định theo trạng thái như cũ.
   */
  subject?: React.ReactNode;
  className?: string;
}

/**
 * Bản chip của `FeatureStatusGate` — ĐỦ 4 trạng thái, không gộp:
 *   on → không hiện gì · loading → chip "Đang kiểm tra" · off → chip "Đang tắt" + câu cũ ·
 *   error → chip lỗi + câu lỗi. Trang vẫn dùng `isFeatureStatusUnsettled` để khoá nút ghi.
 */
export function FeatureStatusNoticeChip({ status, offMessage, errorMessage, subject, className }: FeatureStatusNoticeChipProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (status === "on") return null;
  const label = (kind: NoticeKind): React.ReactNode => {
    if (subject == null) return undefined;
    const [labelKey, labelFallback] = KIND_LABEL_KEY[kind];
    return (
      <>
        {subject}: {t(labelKey, labelFallback)}
      </>
    );
  };
  if (status === "loading") {
    return (
      <NoticeChip kind="loading" label={label("loading")} className={className} data-testid="feature-status-loading">
        <p>{t("layoutKit.notice.flagLoading", "Checking feature status…")}</p>
      </NoticeChip>
    );
  }
  if (status === "error") {
    const msg = errorMessage ?? t("common.featureStatusError", "Could not check this feature's status — treating it as unavailable.");
    // final wave M-9 — câu lỗi được ĐỌC NGAY khi chip lỗi xuất hiện (vùng role=alert sr-only cạnh chip), không đợi
    // người dùng mở popover; popover vẫn hiện câu đó cho người nhìn (không role=alert ⇒ không đọc đôi).
    return (
      <>
        <NoticeChip kind="error" label={label("error")} className={className} data-testid="feature-status-error">
          <p>{msg}</p>
        </NoticeChip>
        <span role="alert" className="sr-only" data-feature-status-alert="">{msg}</span>
      </>
    );
  }
  return (
    <NoticeChip kind="flagOff" label={label("flagOff")} className={className} data-testid="feature-status-off">
      <p>{offMessage}</p>
    </NoticeChip>
  );
}

export default NoticeChip;
