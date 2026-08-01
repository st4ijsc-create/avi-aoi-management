/**
 * Doc 31 Đợt D (UX2 / PM9 / UX7 — WD-2) — Product readiness (config-completeness).
 *
 *  • ProductReadinessBadge — a compact "62%" pill for each product row in the list.
 *    Fed a pre-fetched readiness object (the list batches getReadinessBatch once,
 *    so rows do NOT each hit the server).
 *  • ProductReadinessPanel — the detailed checklist + contextual cross-links shown
 *    when a product is selected (image/dims, points, limits%, componentCode%,
 *    fiducials, golden, release, mapping, panel) + jump links to that product's
 *    golden / mapping / component-library / onboarding (UX7 cross-linking).
 *
 * Additive & self-contained — reuses existing UI primitives only.
 */
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  MinusCircle,
  Gauge,
  Loader2,
  Link as LinkIcon,
  Cpu,
  Star,
  Rocket,
} from "lucide-react";

type ItemStatus = "ok" | "partial" | "missing" | "na";
export interface ReadinessItem {
  key: string;
  status: ItemStatus;
  weight: number;
  fraction: number;
  detail: string;
  counts?: Record<string, number>;
}
export interface ReadinessData {
  productModelId: number;
  productCode: string;
  productName: string;
  score: number;
  band: "ready" | "in_progress" | "blocked";
  items: ReadinessItem[];
  summary?: Record<string, unknown>;
}

// ── Colour helpers (band → tailwind classes; theme-aware via design tokens) ──
function bandClasses(band: ReadinessData["band"]): string {
  if (band === "ready") return "bg-success/15 text-success border-success/30";
  if (band === "in_progress") return "bg-warning/15 text-warning border-warning/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
}

/** Compact percentage pill for the product list. */
export function ProductReadinessBadge({
  readiness,
  className,
}: {
  readiness?: ReadinessData | null;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!readiness) return null;
  // Surface the single most-impactful gap in the tooltip / subtitle.
  const worst = [...readiness.items]
    .filter((i) => i.weight > 0 && i.status !== "ok" && i.status !== "na")
    .sort((a, b) => b.weight * (1 - b.fraction) - a.weight * (1 - a.fraction))[0];
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`} title={worst?.detail ?? ""}>
      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${bandClasses(readiness.band)}`}>
        <Gauge className="h-3 w-3 mr-0.5" />
        {t("products.readiness.pct", "{{score}}%", { score: readiness.score })}
      </Badge>
      {worst && (
        <span className="text-[10px] text-muted-foreground truncate max-w-[10rem]">{worst.detail}</span>
      )}
    </span>
  );
}

function StatusIcon({ status }: { status: ItemStatus }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-success shrink-0" />;
  if (status === "partial") return <AlertTriangle className="h-4 w-4 text-warning shrink-0" />;
  if (status === "na") return <MinusCircle className="h-4 w-4 text-muted-foreground shrink-0" />;
  return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
}

const ITEM_LABEL: Record<string, [string, string]> = {
  image: ["products.readiness.item.image", "Reference image + dimensions"],
  points: ["products.readiness.item.points", "Measurement points"],
  limits: ["products.readiness.item.limits", "Spec limits"],
  componentCode: ["products.readiness.item.componentCode", "Component linkage"],
  fiducials: ["products.readiness.item.fiducials", "Fiducials"],
  golden: ["products.readiness.item.golden", "Golden sample"],
  release: ["products.readiness.item.release", "Released program"],
  mapping: ["products.readiness.item.mapping", "Machine mapping"],
  panel: ["products.readiness.item.panel", "Panel definition"],
};

/** Detailed readiness checklist + cross-links for the selected product. */
export default function ProductReadinessPanel({
  productModelId,
  productCode,
}: {
  productModelId: number;
  productCode: string;
}) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  const q = trpc.productModel.getReadiness.useQuery(
    { productModelId },
    { enabled: productModelId > 0 },
  );
  const data = q.data as ReadinessData | null | undefined;

  return (
    <Card className="glass-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          {t("products.readiness.title", "Độ hoàn thiện cấu hình")}
          {data && (
            <Badge variant="outline" className={`ml-1 ${bandClasses(data.band)}`}>
              {t("products.readiness.pct", "{{score}}%", { score: data.score })}
            </Badge>
          )}
        </CardTitle>
        {/* UX7 — contextual cross-links to this product's scattered data. */}
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7"
            onClick={() => setLocation(`/golden-samples?product=${encodeURIComponent(productCode)}`)}
          >
            <Star className="h-3.5 w-3.5" />
            {t("products.readiness.link.golden", "Golden")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7"
            onClick={() => setLocation(`/product-mapping?product=${encodeURIComponent(productCode)}`)}
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {t("products.readiness.link.mapping", "Mapping")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7"
            onClick={() => setLocation(`/component-library`)}
          >
            <Cpu className="h-3.5 w-3.5" />
            {t("products.readiness.link.components", "Components")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1 h-7"
            onClick={() => setLocation(`/aoi-onboarding`)}
          >
            <Rocket className="h-3.5 w-3.5" />
            {t("products.readiness.link.onboarding", "Onboarding")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !data ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            {t("products.readiness.unavailable", "Chưa có dữ liệu độ hoàn thiện.")}
          </div>
        ) : (
          <>
            {/* Progress bar */}
            <div className="mb-3">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={
                    data.band === "ready"
                      ? "h-full bg-success"
                      : data.band === "in_progress"
                        ? "h-full bg-warning"
                        : "h-full bg-destructive"
                  }
                  style={{ width: `${data.score}%` }}
                />
              </div>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {data.items.map((item) => {
                const [key, fallback] = ITEM_LABEL[item.key] ?? [item.key, item.key];
                return (
                  <li key={item.key} className="flex items-start gap-2 text-sm">
                    <StatusIcon status={item.status} />
                    <div className="min-w-0">
                      <span className="font-medium">{t(key, fallback)}</span>
                      <span className="block text-xs text-muted-foreground truncate" title={item.detail}>
                        {item.detail}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}
