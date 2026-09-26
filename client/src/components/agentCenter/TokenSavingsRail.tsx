/**
 * TokenSavingsRail — ROI rail from `trpc.aiAgentCenter.getSavingsSummary`
 * (doc69 GĐ4/E2-2 + E2-3). HONEST empty state when `dataAvailable:false` — never a
 * fabricated $0 hero (see server/services/aiAgentCenterService.ts's own
 * "HONEST-EMPTY" contract). Figures are clearly labeled as cloud-equivalent
 * ESTIMATES with configurable/illustrative pricing.
 */
import { useTranslation } from "react-i18next";
import { PiggyBank, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtUsd, fmtIntCompact, fmtPct } from "@/lib/format";
import type { SavingsSummary } from "./types";

export interface TokenSavingsRailProps {
  savings: SavingsSummary | undefined;
  isLoading: boolean;
}

export function TokenSavingsRail({ savings, isLoading }: TokenSavingsRailProps) {
  const { t } = useTranslation();

  return (
    <Card className="h-fit">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <PiggyBank className="size-4 text-primary" />
          {t("agentCenter.savings.title", "Tiết kiệm & token")}
        </CardTitle>
        <CardDescription className="text-[11.5px]">
          {t("agentCenter.savings.estimateNote", "Ước tính chi phí tương đương nếu chạy trên cloud — giá minh họa, có thể cấu hình.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && !savings ? (
          <>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-24 w-full" />
          </>
        ) : !savings || !savings.dataAvailable ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
            <Info className="size-5" />
            <p className="text-[12.5px]">{t("agentCenter.savings.empty", "Chưa đủ dữ liệu để ước tính tiết kiệm.")}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border p-2.5">
                <div className="text-[10.5px] text-muted-foreground">{t("agentCenter.savings.today", "Hôm nay")}</div>
                <div className="text-base font-semibold tabular-nums">{fmtUsd(savings.today.cloudEquivalentUsd)}</div>
                <div className="text-[10.5px] text-muted-foreground tabular-nums">
                  {fmtIntCompact(savings.today.totalTokens)} {t("agentCenter.savings.tokensSuffix", "token")}
                </div>
              </div>
              <div className="rounded-lg border p-2.5">
                <div className="text-[10.5px] text-muted-foreground">{t("agentCenter.savings.month", "Tháng này")}</div>
                <div className="text-base font-semibold tabular-nums">{fmtUsd(savings.month.cloudEquivalentUsd)}</div>
                <div className="text-[10.5px] text-muted-foreground tabular-nums">
                  {fmtIntCompact(savings.month.totalTokens)} {t("agentCenter.savings.tokensSuffix", "token")}
                </div>
              </div>
            </div>

            <div className="rounded-lg border p-2.5">
              <div className="flex items-center justify-between text-[11.5px]">
                <span className="text-muted-foreground">{t("agentCenter.savings.onPrem", "Tải giữ on-prem")}</span>
                <span className="font-semibold tabular-nums">{fmtPct(savings.onPremPercent, 0)}</span>
              </div>
              <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.max(0, savings.onPremPercent))}%` }} />
              </div>
            </div>

            {savings.byModel.length > 0 && (
              <div>
                <div className="text-[10.5px] uppercase tracking-wide text-muted-foreground mb-1.5">
                  {t("agentCenter.savings.byModel", "Theo model (toàn thời gian)")}
                </div>
                <div className="space-y-1">
                  {savings.byModel.slice(0, 5).map((m) => (
                    <div key={m.model} className="flex items-center justify-between gap-2 text-[11.5px]">
                      <span className="truncate font-mono text-[10.5px] text-muted-foreground" title={m.model}>
                        {m.model}
                      </span>
                      <span className="shrink-0 tabular-nums font-medium">{fmtUsd(m.cloudEquivalentUsd)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default TokenSavingsRail;
