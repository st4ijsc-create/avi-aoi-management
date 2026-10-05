/**
 * U5 (doc 26 §2.3) — "Hộp phê duyệt" gộp: dải "Đang chờ duyệt & cảnh báo".
 *
 * Hiển thị trên Engineering Hub cho trưởng ca (L3): thẻ đếm gộp việc đang chờ
 * duyệt/xử lý toàn tầng Kỹ thuật & Điều khiển + deep-link tới đúng nơi xử lý.
 * Nguồn: trpc.oversight.pendingSummary (READ-ONLY, fail-safe từng nhánh).
 *
 * - Chỉ điều hướng: mỗi thẻ là một <Link> tới trang đích (?filter=pending gợi ý
 *   lọc — /recipes, /interlock-rules, /engineering-changes đọc query này, doc 80
 *   Đợt 1 Task 2 HUB-03). KHÔNG có mutation — mọi cổng quyền/HITL/SoD ở trang đích
 *   giữ nguyên.
 * - Trạng thái đầy đủ: loading (skeleton) · error (thông báo nhẹ) · empty (không
 *   có việc chờ → dòng "tất cả đã xử lý") · **degraded** (doc 80 Đợt 1 Task 2
 *   HUB-01 — trước đây một nhánh lỗi trả count=0 và bị hiểu lầm là "không có gì
 *   chờ"; nay CHỈ hiện "tất cả đã xử lý" khi MỌI nhánh đọc được VÀ tổng = 0. Có
 *   nhánh lỗi ⇒ luôn hiện banner "Không đọc được: <nguồn>", kể cả khi tổng = 0).
 * - DS token thuần (bg-card/border/warning/destructive) — đúng sáng/tối.
 */
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  FlaskConical,
  ShieldAlert,
  Siren,
  AlertOctagon,
  Workflow,
  ShieldQuestion,
  Bot,
  GitPullRequestArrow,
  ArrowLeftRight,
  Inbox,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

/** Một loại việc chờ: icon + khóa i18n nhãn + deep-link + mức độ khẩn. */
export interface CategoryDef {
  key:
    | "ecn"
    | "recipes"
    | "recipeActiveUnapproved"
    | "interlock"
    | "changeover"
    | "interlockEventsOpen"
    | "orchestration"
    | "safety"
    | "deadlocks";
  icon: LucideIcon;
  href: string;
  /** true → khi >0 tô đỏ (an toàn/bất biến vỡ); false → tô vàng (chờ duyệt bình thường). */
  critical: boolean;
  /** Chữ mặc định (EN) khi khoá i18n chưa nạp — khớp `en.json#oversight.category.*`. */
  fallbackLabel: string;
}

// Thứ tự: soạn thảo (ECN → recipe) → an toàn (interlock) → điều phối → an toàn
// sự cố → đội xe. Doc 80 Đợt 1 Task 2 (HUB-02) — bốn nguồn MỚI: ecn,
// recipeActiveUnapproved, interlockEventsOpen, changeover ("deployment chờ duyệt").
export const PENDING_CATEGORIES: readonly CategoryDef[] = [
  { key: "ecn", icon: GitPullRequestArrow, href: "/engineering-changes?filter=pending", critical: false, fallbackLabel: "ECNs to approve" },
  { key: "recipes", icon: FlaskConical, href: "/recipes?filter=pending", critical: false, fallbackLabel: "Recipes to approve" },
  // RCP-06 — recipe ĐANG CHẠY trên máy thật mà chưa qua second-approver: bất biến
  // "chỉ chạy recipe đã duyệt" đã vỡ trên dữ liệu thật — tô đỏ (critical).
  { key: "recipeActiveUnapproved", icon: AlertOctagon, href: "/recipes?filter=pending", critical: true, fallbackLabel: "Running recipe unapproved" },
  { key: "interlock", icon: ShieldAlert, href: "/interlock-rules?filter=pending", critical: false, fallbackLabel: "Interlocks to approve" },
  { key: "changeover", icon: ArrowLeftRight, href: "/product-changeover", critical: false, fallbackLabel: "Changeovers to approve" },
  { key: "interlockEventsOpen", icon: Siren, href: "/interlock-rules?filter=pending", critical: true, fallbackLabel: "Open interlock events" },
  { key: "orchestration", icon: Workflow, href: "/orchestration-studio?filter=pending", critical: false, fallbackLabel: "Runs awaiting confirm" },
  { key: "safety", icon: ShieldQuestion, href: "/safety-workforce?filter=pending", critical: true, fallbackLabel: "Unaudited safety events" },
  { key: "deadlocks", icon: Bot, href: "/fleet-orchestration?filter=deadlock", critical: true, fallbackLabel: "Fleet deadlocks" },
];
const CATEGORIES = PENDING_CATEGORIES;

export interface PendingReviewStripProps {
  /**
   * Doc 81 Đợt 2 Task 15 — `"table"`: MAIN "hộp việc" của Hub (FE1 §2.1 "bảng 8 dòng") — MỘT `<table>`, mỗi loại
   * việc một dòng, cùng nguồn/cùng link sâu/cùng luật HUB-01, HUB-02; trạng thái (đang tải / lỗi / trống / không đọc
   * được) nằm TRONG bảng. Mặc định `"cards"` = lưới thẻ cũ (không đổi).
   */
  variant?: "cards" | "table";
  /** Chỉ hiện các loại việc này (phạm vi của Hub). "Tất cả đã xử lý" / "Không đọc được" tính TRÊN tập đang hiện. */
  categoryFilter?: (c: CategoryDef) => boolean;
  /**
   * Doc 81 Đợt 2 Task 15 fix 1 (R-2-y) — các loại này LUÔN hiện, ghim ĐẦU bảng (`tbody[data-pending-pinned]`), bất kể
   * `categoryFilter` (vd loại KHẨN `critical:true` của Hub ở mọi phạm vi).
   */
  pinned?: (c: CategoryDef) => boolean;
  /**
   * doc 81 Đợt 2 final wave (R-2-z5 / M-7) — chỉ `variant="table"`: loại mà vai hiện tại KHÔNG mở được trang đích
   * (cùng luật RouteGuard của nav) vẫn hiện số (loại khẩn phải luôn thấy) nhưng KHÔNG là link — kèm ghi chú "không có
   * quyền mở". Không truyền ⇒ mọi dòng là link như cũ.
   */
  canOpen?: (c: CategoryDef) => boolean;
  /**
   * doc 81 Đợt 3 Task 4 — chỉ `variant="table"`: `"mine"` ⇒ các dòng KHÔNG ghim đọc số + mẫu từ `pendingSummary.mine`
   * (mục giao cho người xem; server đã áp luật tên HUB-02 — dòng KHÔNG BAO GIỜ mượn mẫu của nhóm toàn module). Dòng
   * ghim (loại khẩn, R-2-y) vẫn đọc số TOÀN module. Mặc định `"summary"` = như cũ.
   */
  source?: "summary" | "mine";
}

export function PendingReviewStrip({ variant = "cards", categoryFilter, pinned, canOpen, source = "summary" }: PendingReviewStripProps = {}) {
  const { t } = useTranslation();
  const query = trpc.oversight.pendingSummary.useQuery(undefined, {
    // Việc chờ duyệt thay đổi chậm — làm mới nhẹ, không spam.
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const data = query.data;
  if (variant === "table") {
    const pin = pinned ? CATEGORIES.filter(pinned) : [];
    const rest = (categoryFilter ? CATEGORIES.filter(categoryFilter) : CATEGORIES).filter((c) => !pin.includes(c));
    return <PendingReviewTable query={query} pinned={pin} categories={rest} canOpen={canOpen} source={source} />;
  }
  // HUB-01 — nguồn nào ĐANG lỗi (bảng thiếu, quyền hạ tầng, DB rớt…), bất kể tổng.
  const degradedCategories = data != null ? CATEGORIES.filter((c) => data[c.key].degraded) : [];
  const hasDegraded = degradedCategories.length > 0;
  // "Tất cả đã xử lý" CHỈ khi MỌI nhánh đọc được (không degraded) VÀ tổng = 0 —
  // trước bản vá, một nhánh lỗi (count=0 do throw) đủ để rơi vào nhánh này.
  const allClear = data != null && data.total === 0 && !hasDegraded;
  // Có việc chờ HOẶC có nguồn lỗi thì phải thấy lưới thẻ (kể cả khi tổng đang là 0
  // vì chính nhánh lỗi đó) — không được im lặng gộp vào "tất cả đã xử lý".
  const showGrid = data != null && !allClear;

  return (
    <section className="space-y-3" aria-label={t("oversight.title", "Pending review & alerts")}>
      <div className="flex items-center gap-2">
        <Inbox className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("oversight.title", "Pending review & alerts")}
        </h2>
        {data != null && data.total > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums">
            {data.total > 99 ? "99+" : data.total}
          </span>
        )}
      </div>

      {/* Loading — skeleton khớp lưới thẻ. */}
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

      {/* Empty — KHÔNG có việc nào đang chờ VÀ mọi nguồn đọc được (HUB-01). */}
      {allClear && (
        <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-3 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          <span>{t("oversight.allClear", "Nothing waiting for approval right now.")}</span>
        </div>
      )}

      {/* Degraded — ÍT NHẤT một nguồn không đọc được, kể cả khi tổng đang là 0
          (HUB-01: đây chính là ca "SEED-ECN-0003 đang xem xét nhưng Hub báo trống"). */}
      {showGrid && hasDegraded && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm text-muted-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {t("oversight.sourcesUnavailable", "Could not read: {{sources}}", {
              sources: degradedCategories.map((c) => t(`oversight.category.${c.key}`, c.fallbackLabel)).join(", "),
            })}
          </span>
        </div>
      )}

      {/* Data — thẻ đếm + deep-link (hiện cả khi tổng=0 nếu có nguồn lỗi ở trên). */}
      {showGrid && (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
          {CATEGORIES.map((cat) => {
            const bucket = data[cat.key];
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
                  bucket.degraded && "border-warning/40",
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
                  </div>
                  <span className={cn("text-2xl font-bold tabular-nums", toneText)}>{bucket.count}</span>
                </div>
                <span className="text-xs font-semibold leading-tight text-foreground">
                  {t(`oversight.category.${cat.key}`, cat.fallbackLabel)}
                </span>
                {/* Mục mẫu (tối đa 2) — cho biết CÁI GÌ đang chờ, không cần mở trang.
                    HUB-02: người chỉ có quyền xem chung (machine_status) nhận count
                    thật nhưng KHÔNG nhận samples (server trả samples:[] cho họ) — ở
                    đây hiển thị như "không có mẫu", không nói dối bằng chữ "unavailable". */}
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

type PendingSummary = inferRouterOutputs<AppRouter>["oversight"]["pendingSummary"];
type Bucket = PendingSummary["ecn"];
const NO_BUCKET: Bucket = { count: 0, samples: [], degraded: false };

/**
 * Doc 81 Đợt 2 Task 15 — thân bảng của `variant="table"`. Cùng luật HUB-01 với lưới thẻ, nhưng tính trên `categories`
 * (tập đang hiện): "Tất cả đã xử lý" CHỈ khi mọi nguồn TRONG TẬP đọc được VÀ tổng tập = 0; nguồn nào không đọc được
 * thì ô số là "—" (không bao giờ in 0) và chú thích `role=status` gọi tên nó. HUB-02: mẫu rỗng không tự xưng
 * "unavailable". Bảng là phần tử làm việc (W) của MAIN — mọi trạng thái nằm TRONG bảng (caption/dòng), không có khối
 * nào chen trên bảng.
 */
function PendingReviewTable({
  query,
  categories: rest,
  pinned = [],
  canOpen,
  source = "summary",
}: {
  query: { data?: PendingSummary; isLoading: boolean; isError: boolean };
  categories: readonly CategoryDef[];
  pinned?: readonly CategoryDef[];
  canOpen?: (c: CategoryDef) => boolean;
  source?: "summary" | "mine";
}) {
  const { t } = useTranslation();
  const data = query.data;
  // doc 81 Đợt 3 Task 4 — nguồn của từng dòng: ghim ⇒ toàn module (R-2-y); còn lại theo `source`.
  const bucketOf = (c: CategoryDef, d: PendingSummary): Bucket =>
    source === "mine" && !pinned.includes(c) ? ((d.mine as Partial<Record<CategoryDef["key"], Bucket>>)?.[c.key] ?? NO_BUCKET) : d[c.key];
  // Tập đang hiện = loại ghim (luôn) + loại theo phạm vi. HUB-01 tính trên CẢ tập này.
  const categories = [...pinned, ...rest];
  // Chưa có dữ liệu và không lỗi (kể cả trước lượt tải đầu) ⇒ khung chờ, không bao giờ là bảng rỗng/0.
  const waiting = data == null && !query.isError;
  const label = (c: CategoryDef) => t(`oversight.category.${c.key}`, c.fallbackLabel);
  const degraded = data != null ? categories.filter((c) => bucketOf(c, data).degraded) : [];
  const shownTotal = data != null ? categories.reduce((n, c) => n + bucketOf(c, data).count, 0) : 0;
  const allClear = data != null && shownTotal === 0 && degraded.length === 0;

  return (
    <table className="w-full border-collapse text-sm" aria-label={t("oversight.title", "Pending review & alerts")}>
      {(query.isError || allClear || degraded.length > 0) && (
        <caption className="caption-top pb-2 text-left text-sm">
          {query.isError ? (
            <span className="inline-flex items-start gap-2 text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
              {t("oversight.error", "Could not load the pending-review summary. It will retry automatically.")}
            </span>
          ) : degraded.length > 0 ? (
            <span role="status" className="inline-flex items-start gap-2 text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              {t("oversight.sourcesUnavailable", "Could not read: {{sources}}", { sources: degraded.map(label).join(", ") })}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              {source === "mine"
                ? t("oversight.mineAllClear", "Nothing is assigned to you right now.")
                : t("oversight.allClear", "Nothing waiting for approval right now.")}
            </span>
          )}
        </caption>
      )}
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th scope="col" className="py-2 pr-3 font-medium">{t("oversight.table.kind", "Work item")}</th>
          <th scope="col" className="w-20 py-2 pr-3 text-right font-medium">{t("oversight.table.count", "Count")}</th>
          <th scope="col" className="py-2 font-medium">{t("oversight.table.samples", "Waiting")}</th>
        </tr>
      </thead>
      {waiting ? (
        <tbody>
          {categories.map((c) => (
            <tr key={c.key} data-pending-skeleton="" className="border-b">
              <td className="py-2 pr-3"><Skeleton className="h-5 w-40" /></td>
              <td className="py-2 pr-3"><Skeleton className="ml-auto h-5 w-8" /></td>
              <td className="py-2"><Skeleton className="h-5 w-48" /></td>
            </tr>
          ))}
        </tbody>
      ) : data != null && (
        <>
          {pinned.length > 0 && <tbody data-pending-pinned="" className="border-b-2">{pinned.map((cat) => renderRow(cat, data))}</tbody>}
          <tbody>{rest.map((cat) => renderRow(cat, data))}</tbody>
        </>
      )}
    </table>
  );

  function renderRow(cat: CategoryDef, data: PendingSummary) {
    const bucket = bucketOf(cat, data);
    const Icon = cat.icon;
    const active = bucket.count > 0;
    const tone = active ? (cat.critical ? "text-destructive" : "text-warning") : "text-muted-foreground";
    return (
      <tr key={cat.key} data-pending-row={cat.key} className="border-b hover:bg-muted/40">
        <td className="py-2 pr-3">
          {canOpen && !canOpen(cat) ? (
            // R-2-z5 — vai này không mở được trang đích: giữ tên + số (loại khẩn luôn thấy), không dẫn tới trang bị từ chối.
            <span data-pending-no-access="" className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium text-foreground">
              <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2.1} aria-hidden="true" />
              <span>{label(cat)}</span>
              <span className="text-xs font-normal text-muted-foreground">{t("oversight.noAccess", "(you don't have access to this page)")}</span>
            </span>
          ) : (
            <Link
              href={cat.href}
              className="inline-flex items-center gap-2 font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.1} aria-hidden="true" />
              <span>{label(cat)}</span>
            </Link>
          )}
        </td>
        <td className="py-2 pr-3 text-right">
          <span data-pending-count="" className={cn("text-base font-bold tabular-nums", bucket.degraded ? "text-warning" : tone)}>
            {bucket.degraded ? "—" : bucket.count}
          </span>
        </td>
        <td className="max-w-0 py-2 text-xs text-muted-foreground">
          {bucket.samples.length > 0 ? (
            <span className="block truncate" title={bucket.samples.map((x) => x.label).join(", ")}>
              {bucket.samples[0].label}
              {bucket.samples.length > 1 ? ` +${bucket.count - 1}` : ""}
            </span>
          ) : bucket.degraded ? (
            t("oversight.degraded", "unavailable")
          ) : null}
        </td>
      </tr>
    );
  }
}

export default PendingReviewStrip;

