/**
 * AdvancedSection — progressive disclosure (doc 07 §④ P2).
 *
 * Wraps "advanced" controls in a collapsible "Nâng cao" section that is COLLAPSED
 * BY DEFAULT, so low-skill users see a simpler surface and can opt into the dense
 * controls when needed. The basic/advanced preference is PERSISTED in localStorage
 * (per `storageKey`) so a user who prefers the advanced view keeps it across visits.
 *
 * It only HIDES advanced controls by default — it never removes them. Wrapping an
 * existing advanced block is fully non-breaking: the children still mount when
 * expanded, with identical behavior.
 *
 * Usage:
 *   <AdvancedSection storageKey="spc-analysis">
 *     ...advanced blocks...
 *   </AdvancedSection>
 */
import { ReactNode, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

const STORAGE_PREFIX = "advancedSection:";

function readPref(storageKey: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    return v == null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writePref(storageKey: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, value ? "1" : "0");
  } catch {
    /* localStorage unavailable (private mode / quota) — ignore, stay session-only */
  }
}

export interface AdvancedSectionProps {
  children: ReactNode;
  /** Unique key for persisting the basic/advanced preference in localStorage. */
  storageKey: string;
  /** Override the section title (defaults to the i18n "Nâng cao"). */
  title?: string;
  /** Expand by default the very first time (before any user preference). */
  defaultOpen?: boolean;
  className?: string;
}

export function AdvancedSection({
  children,
  storageKey,
  title,
  defaultOpen = false,
  className,
}: AdvancedSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<boolean>(() => readPref(storageKey, defaultOpen));

  const handleChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      writePref(storageKey, next);
    },
    [storageKey],
  );

  return (
    <Collapsible
      open={open}
      onOpenChange={handleChange}
      className={cn("rounded-lg border bg-card/40", className)}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
          {title ?? t("advancedSection.title", "Nâng cao")}
          <span className="text-xs font-normal text-muted-foreground">
            {open
              ? t("advancedSection.hideHint", "Nhấn để ẩn")
              : t("advancedSection.showHint", "Nhấn để hiện tùy chọn nâng cao")}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default AdvancedSection;
