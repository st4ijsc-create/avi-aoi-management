/**
 * doc 69 §B1.3 (T8/E1) — QualityAIInsightCard: contextual AI embed for Quality
 * Cockpit, MachineAISummary-style (compact), mirroring the proven pattern
 * instead of inventing new visual language:
 *   - <MachineAISummary compact> for the machine currently picked in the
 *     cockpit scope (same anomaly/PdM/insight queries — no new backend).
 *   - trpc.spcAlerts.list (the SAME query SpcAlertsPanel's "Cảnh báo SPC" tab
 *     already uses) to find the latest OPEN SPC excursion, and an "Explain
 *     this SPC excursion" action that deep-links /ai-chat with that
 *     excursion's rule/point/severity/time.
 *
 * Fail-safe: no machine picked ("all machines") → honest empty line, never a
 * fabricated fleet-wide signal; no open excursion → the explain action stays
 * disabled with an honest "no active excursion" message.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import MachineAISummary from "@/components/MachineAISummary";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, MessageCircle } from "lucide-react";

export interface QualityAIInsightCardProps {
  /** The machine currently picked in the cockpit scope (undefined = all machines). */
  machineId?: number;
  className?: string;
}

interface SpcExcursion {
  id: number;
  ruleName?: string | null;
  ruleCode?: string | null;
  severity?: string | null;
  pointDefId?: number | null;
  createdAt?: string | Date | null;
}

export default function QualityAIInsightCard({ machineId, className }: QualityAIInsightCardProps) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();

  // Resolve the picked machine's code/name (cockpit scope only carries the id).
  const machinesQ = trpc.machine.list.useQuery();
  const machine = useMemo(
    () => (machineId ? machinesQ.data?.find((m: any) => m.id === machineId) : undefined),
    [machinesQ.data, machineId],
  );

  // Latest OPEN SPC excursion — same procedure SpcAlertsPanel's alerts tab uses.
  const alertsQ = trpc.spcAlerts.list.useQuery({ unackedOnly: true, limit: 1 }, { retry: false });
  const excursion = ((alertsQ.data ?? [])[0] ?? undefined) as SpcExcursion | undefined;

  const explainExcursion = () => {
    if (!excursion) return;
    const question = t(
      "qualityCockpit.aiInsight.askQuestion",
      "Giải thích vi phạm SPC: luật {{rule}} tại điểm đo #{{point}}, mức độ {{severity}}, phát hiện lúc {{time}}. Nguyên nhân khả dĩ và hành động khắc phục là gì?",
      {
        rule: excursion.ruleName ?? excursion.ruleCode ?? "?",
        point: excursion.pointDefId ?? "?",
        severity: excursion.severity ?? "?",
        time: excursion.createdAt ? new Date(excursion.createdAt).toLocaleString() : "?",
      },
    );
    const params = new URLSearchParams({ q: question });
    if (machine?.code) params.set("machine", machine.code);
    navigate(`/ai-chat?${params.toString()}`);
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="h-4 w-4 text-primary" />
          {t("qualityCockpit.aiInsight.title", "Tín hiệu AI")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {machineId ? (
          <MachineAISummary machineId={machineId} machineCode={machine?.code} machineName={machine?.name} compact />
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("qualityCockpit.aiInsight.selectMachine", "Chọn máy để xem tín hiệu AI cho phạm vi này")}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2">
          <span className="text-xs text-muted-foreground">
            {excursion
              ? t("qualityCockpit.aiInsight.hasExcursion", "Có excursion SPC đang mở")
              : t("qualityCockpit.aiInsight.noExcursion", "Không có excursion SPC đang mở")}
          </span>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={!excursion} onClick={explainExcursion}>
            <MessageCircle className="h-3.5 w-3.5" />
            {t("qualityCockpit.aiInsight.explainExcursion", "Giải thích excursion SPC này")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
