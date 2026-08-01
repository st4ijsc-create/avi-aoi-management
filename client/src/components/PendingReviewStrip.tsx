/**
 * U5 (doc 26 §2.3) — "Hộp phê duyệt" gộp: dải "Đang chờ duyệt & cảnh báo".
 *
 * Hiển thị trên Engineering Hub cho trưởng ca (L3): 5 thẻ đếm gộp việc đang chờ
 * duyệt/xử lý toàn tầng Kỹ thuật & Điều khiển + deep-link tới đúng nơi xử lý.
 * Nguồn: trpc.oversight.pendingSummary (READ-ONLY, fail-safe từng nhánh).
 *
 * - Chỉ điều hướng: mỗi thẻ là một <Link> tới trang đích (?filter=… gợi ý lọc).
 *   KHÔNG có mutation — mọi cổng quyền/HITL/SoD ở trang đích giữ nguyên.
 * - Trạng thái đầy đủ: loading (skeleton) · error (thông báo nhẹ) · empty
 *   (không có việc chờ → dòng "tất cả đã xử lý").
 * - DS token thuần (bg-card/border/warning/destructive) — đúng sáng/tối.
 */
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  FlaskConical,
  ShieldAlert,
  Workflow,
  ShieldQuestion,
  Bot,
  Inbox,
  CheckCircle2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Một loại việc chờ: icon + khóa i18n nhãn + deep-link + mức độ khẩn. */
interface CategoryDef {
  key: "recipes" | "interlock" | "orchestration" | "safety" | "deadlocks";
  icon: LucideIcon;
  href: string;
  /** true → khi >0 tô đỏ (an toàn/deadlock); false → tô vàng (chờ duyệt). */
  critical: boolean;
}

// Thứ tự: soạn thảo → an toàn → điều phối → an toàn sự cố → đội xe.
const CATEGORIES: CategoryDef[] = [
  { key: "recipes", icon: FlaskConical, href: "/recipes?filter=pending", critical: false },
  { key: "interlock", icon: ShieldAlert, href: "/interlock-rules?filter=pending", critical: false },
  { key: "orchestration", icon: Workflow, href: "/orchestration-studio?filter=pending", critical: false },
  { key: "safety", icon: ShieldQuestion, href: "/safety-workforce?filter=pending", critical: true },
  { key: "deadlocks", icon: Bot, href: "/fleet-orchestration?filter=deadlock", critical: true },
];

export function PendingReviewStrip() {
  const { t } = useTranslation();
  const query = trpc.oversight.pendingSummary.useQuery(undefined, {
    // Việc chờ duyệt thay đổi chậm — làm mới nhẹ, không spam.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return (
    <section className="space-y-3" aria-label={t("oversight.title", "Pending review & alerts")}>
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("oversight.title", "Pending review & alerts")}
        </h2>
        {query.data != null && query.data.total > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums">
            {query.data.total > 99 ? "99+" : query.data.total}
          </span>
        )}
      </div>

      {/* Loading — 5 skeleton khớp lưới thẻ. */}
      {query.isLoading && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <Skeleton key={c.key} className="h-[92px] rounded-xl" />
          ))}
        </div>
      )}

      {/* Error — thông báo nhẹ, không chặn phần điều hướng còn lại của Hub. */}
      {query.isError && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{t("oversight.error", "Could not load the pending-review summary. It will retry automatically.")}</span>
        </div>
      )}

      {/* Empty — không có việc nào đang chờ. */}
      {query.data != null && query.data.total === 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <span>{t("oversight.allClear", "Nothing waiting for approval right now.")}</span>
        </div>
      )}

      {/* Data — 5 thẻ đếm + deep-link. */}
      {query.data != null && query.data.total > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((cat) => {
            const bucket = query.data[cat.key];
            const Icon = cat.icon;
            const active = bucket.count > 0;
            const toneText = active ? (cat.critical ? "text-destructive" : "text-warning") : "text-muted-foreground";
            return (
              <Link
                key={cat.key}
                href={cat.href}
                className={cn(
                  "group flex flex-col gap-1.5 rounded-xl border bg-card p-4 text-left shadow-sm transition-colors",
                  "hover:border-primary/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.99]",
                  active && cat.critical && "border-destructive/40",
                  active && !cat.critical && "border-warning/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
                  </div>
                  <span className={cn("text-2xl font-bold tabular-nums", toneText)}>{bucket.count}</span>
                </div>
                <span className="text-xs font-semibold leading-tight text-foreground">
                  {t(`oversight.category.${cat.key}`)}
                </span>
                {/* Mục mẫu (tối đa 2) — cho biết CÁI GÌ đang chờ, không cần mở trang. */}
                {bucket.samples.length > 0 ? (
                  <span className="truncate text-[11px] leading-snug text-muted-foreground" title={bucket.samples.map((s) => s.label).join(", ")}>
                    {bucket.samples[0].label}
                    {bucket.samples.length > 1 ? ` +${bucket.count - 1}` : ""}
                  </span>
                ) : bucket.degraded ? (
                  <span className="text-[11px] leading-snug text-muted-foreground">
                    {t("oversight.degraded", "unavailable")}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default PendingReviewStrip;
