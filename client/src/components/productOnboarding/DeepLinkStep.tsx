// WD-1 (doc 31 Đợt D · UX1) — reusable "deep-link to an existing editor" step.
// Used for the steps whose real UI is a heavy existing surface we don't rebuild
// (the measurement-point canvas editor, its threshold/limit fields, and the
// product↔machine mapping page). Opens the target in a NEW TAB so the wizard
// (and its server-persisted draft) stays put; a Refresh button re-reads the live
// count after the engineer returns.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ExternalLink, RefreshCw } from "lucide-react";

interface Props {
  /** Absolute app path incl. query, e.g. /products?product=123. */
  href: string;
  openLabel: string;
  onRefresh: () => void;
  /** Live stat / progress block rendered above the actions. */
  children?: ReactNode;
}

export function DeepLinkStep({ href, openLabel, onRefresh, children }: Props) {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      {children}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={() => window.open(href, "_blank", "noopener")}
          className="gap-1"
        >
          <ExternalLink className="h-4 w-4" />
          {openLabel}
        </Button>
        <Button size="sm" variant="outline" onClick={onRefresh} className="gap-1">
          <RefreshCw className="h-4 w-4" />
          {t("productOnboarding.refreshCount", "I'm back — refresh count")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t(
          "productOnboarding.deepLinkHint",
          "Opens in a new tab so this wizard keeps your place. Return here and refresh when done.",
        )}
      </p>
    </div>
  );
}

export default DeepLinkStep;
