/**
 * ManualHelp — doc 37 Đợt-B1 (manual-grounded UX).
 *
 * A small, reusable "?" affordance that surfaces PAGE-CITED vendor-manual context
 * from the programming knowledge base (`trpc.aiProgrammingKb.search`). Until this
 * component shipped, ZERO frontend surfaces read that corpus — engineers had to
 * leave the app to consult a PDF. Drop `<ManualHelp query=… vendor=… />` next to
 * any protocol/alarm/parameter and the operator gets "Manual, tr.N" excerpts inline.
 *
 * READ-ONLY: retrieval only, no LLM synthesis, no device path. Query fires only
 * while the popover is open. Flag-off / empty corpus → a friendly, honest note
 * (the router returns a well-formed EMPTY result rather than erroring).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BookOpen, HelpCircle, Loader2, Info, AlertTriangle } from "lucide-react";

interface ManualHelpProps {
  /** Free-text retrieval query (keywords + any known codes). Required. */
  query: string;
  /** Optional vendor/protocol metadata pre-filter (soft — empty → widened search). */
  vendor?: string;
  /** Optional language tag pre-filter (en/vi/zh…). */
  lang?: string;
  /** How many cited chunks to pull. */
  topK?: number;
  /** Trigger label. Pass `null`/omit for an icon-only button. */
  buttonLabel?: React.ReactNode;
  size?: "sm" | "icon" | "default";
  variant?: "outline" | "ghost" | "secondary" | "default";
  align?: "start" | "center" | "end";
  className?: string;
}

export default function ManualHelp({
  query,
  vendor,
  lang,
  topK = 5,
  buttonLabel,
  size = "sm",
  variant = "outline",
  align = "end",
  className,
}: ManualHelpProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const trimmedVendor = vendor?.trim() || undefined;
  const searchQuery = trpc.aiProgrammingKb.search.useQuery(
    { query: query.trim() || " ", vendor: trimmedVendor, lang, topK },
    { enabled: open && query.trim().length > 0, retry: false, staleTime: 60_000 },
  );

  const data = searchQuery.data;
  const chunks = data?.chunks ?? [];
  const kbOff = data != null && data.enabled === false;
  const isIcon = buttonLabel == null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={isIcon ? "icon" : size === "icon" ? "sm" : size}
          className={cn(isIcon ? "h-7 w-7" : "gap-1.5", className)}
          title={t("manualHelp.title", "Tra sổ tay (trích trang)")}
          aria-label={t("manualHelp.title", "Tra sổ tay (trích trang)")}
        >
          <HelpCircle className={cn(isIcon ? "h-4 w-4" : "h-3.5 w-3.5")} />
          {buttonLabel}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-96 max-w-[92vw] p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <BookOpen className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold">{t("manualHelp.header", "Sổ tay nhà sản xuất")}</p>
          {trimmedVendor && (
            <Badge variant="secondary" className="ml-auto text-[10px] uppercase">{trimmedVendor}</Badge>
          )}
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {searchQuery.isLoading && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("manualHelp.loading", "Đang tra tài liệu…")}
            </div>
          )}

          {searchQuery.isError && (
            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>{t("manualHelp.error", "Không tra được tài liệu. Thử lại sau.")}</span>
            </div>
          )}

          {!searchQuery.isLoading && !searchQuery.isError && kbOff && (
            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t("manualHelp.kbOff", "Kho tài liệu nhà sản xuất chưa được bật.")}</span>
            </div>
          )}

          {!searchQuery.isLoading && !searchQuery.isError && !kbOff && chunks.length === 0 && (
            <div className="flex items-start gap-2 rounded-md border border-dashed bg-muted/30 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t("manualHelp.empty", "Không tìm thấy đoạn tài liệu phù hợp.")}</span>
            </div>
          )}

          {chunks.length > 0 && (
            <ul className="space-y-3">
              {chunks.map((c) => (
                <li key={c.id} className="rounded-md border bg-muted/20 p-2.5">
                  <div className="mb-1 flex items-center gap-2 text-xs font-semibold">
                    <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate" title={c.docTitle}>
                      {/* Page-cited: "Manual, tr.N" (fall back to doc only when unpaginated). */}
                      {c.page != null
                        ? t("manualHelp.cite", "{{doc}}, tr.{{page}}", { doc: c.docTitle, page: c.page })
                        : c.docTitle}
                    </span>
                    {c.vendor && (
                      <Badge variant="outline" className="ml-auto shrink-0 text-[9px] uppercase">{c.vendor}</Badge>
                    )}
                  </div>
                  {c.section && (
                    <p className="mb-1 truncate text-[11px] text-muted-foreground" title={c.section}>{c.section}</p>
                  )}
                  <p className="whitespace-pre-line break-words text-xs leading-snug text-foreground/90">
                    {c.text.length > 480 ? `${c.text.slice(0, 480)}…` : c.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {chunks.length > 0 && (
          <p className="border-t px-4 py-2 text-[10px] leading-snug text-muted-foreground">
            {t("manualHelp.footnote", "Trích từ sổ tay nhà sản xuất — luôn đối chiếu bản gốc trước khi thao tác.")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
