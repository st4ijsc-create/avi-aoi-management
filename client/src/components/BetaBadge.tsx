/**
 * doc 22 P4 — "Beta / Cần thiết lập" badge + banner.
 *
 * Framework/flag-gated pages that are not live yet (RF Test Cell, Cell Twin,
 * IR Editor, Orchestration Studio, Fleet Orchestration, Safety cockpit,
 * Federation, …) surface a small "Beta" chip in the nav and a one-line banner on
 * the page, so first-time users don't hit a dead end expecting live data.
 *
 * Both are i18n-driven (nav.beta / nav.betaBanner) and purely presentational.
 */
import { FlaskConical } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { TFunction } from "i18next";
import type { NoticeItem } from "@/components/patterns/NoticeChip";

/** Tiny inline chip for nav rows / flyouts. */
export function BetaBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0 text-[10px] font-medium leading-4 text-amber-600 dark:text-amber-400",
        className,
      )}
      title={t("nav.betaHint", "Preview — may need setup before it shows live data")}
    >
      {t("nav.beta", "Beta")}
    </span>
  );
}

/**
 * Page-level banner for a not-yet-live surface. Drop it near the top of any page
 * whose nav item is flagged `beta`. Optionally pass a `message` i18n key override.
 */
export function BetaBanner({
  messageKey = "nav.betaBanner",
  className,
}: {
  messageKey?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="note"
      className={cn(
        "mb-4 flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {t(
          messageKey,
          "This is a preview feature. It may require setup or an enabled flag before it shows live data.",
        )}
      </span>
    </div>
  );
}

/**
 * Doc 81 Đợt 2 Task 2 — biến thể CHIP của `BetaBanner` cho top bar của shell: cùng câu (`nav.betaBanner`),
 * cùng điều kiện (shell vẫn gọi `isBetaRoute`), nhưng là mục NoticeStack (chip 1 dòng + popover; gộp vào
 * "+N" khi top bar hẹp) thay vì dải banner 40–54 px chen giữa top bar và tiêu đề trang.
 */
export function betaNoticeItem(t: TFunction, messageKey = "nav.betaBanner"): NoticeItem {
  return {
    id: "beta",
    kind: "beta",
    testId: "shell-notice-beta",
    label: t("nav.beta", "Beta"),
    content: t(
      messageKey,
      "This is a preview feature. It may require setup or an enabled flag before it shows live data.",
    ),
  };
}

export default BetaBadge;
