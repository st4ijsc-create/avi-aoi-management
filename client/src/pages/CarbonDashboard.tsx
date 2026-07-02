import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import {
  PageHeader,
  PageContainer,
  MetricCard,
  chartColor,
  chartAxisTick,
  chartGridProps,
  chartTooltipStyle,
  chartTooltipLabelStyle,
} from "@/components/patterns";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { Leaf, Zap, Gauge, Factory } from "lucide-react";

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

export default function CarbonDashboard() {
  const { t } = useTranslation();
  const enpi = trpc.realtimeReport.enpiSummary.useQuery({ limit: 500 });

  const rows = enpi.data ?? [];

  const kpis = useMemo(() => {
    let totalKwh = 0;
    let totalCarbon = 0;
    let goodUnits = 0;
    let epuSum = 0;
    let epuCount = 0;
    for (const r of rows as any[]) {
      totalKwh += num(r.totalKwh);
      totalCarbon += num(r.carbonKg);
      goodUnits += num(r.goodUnits);
      const epu = num(r.energyPerUnit);
      if (epu > 0) {
        epuSum += epu;
        epuCount += 1;
      }
    }
    return {
      totalKwh,
      totalCarbon,
      goodUnits,
      avgEpu: epuCount > 0 ? epuSum / epuCount : 0,
    };
  }, [rows]);

  // Xu hướng theo periodStart (carbon + kWh)
  const trend = useMemo(() => {
    return [...(rows as any[])]
      .filter((r) => r.periodStart)
      .sort((a, b) => new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime())
      .map((r) => ({
        time: new Date(r.periodStart).toLocaleDateString(),
        carbon: num(r.carbonKg),
        kwh: num(r.totalKwh),
      }));
  }, [rows]);

  // EnPI thực tế vs baseline theo máy (top 12 theo kWh)
  const byMachine = useMemo(() => {
    return [...(rows as any[])]
      .map((r) => ({
        machine: `#${r.machineId ?? "—"}`,
        epu: num(r.energyPerUnit),
        baseline: num(r.baselineEnergyPerUnit),
        kwh: num(r.totalKwh),
      }))
      .sort((a, b) => b.kwh - a.kwh)
      .slice(0, 12);
  }, [rows]);

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          icon={<Leaf className="h-6 w-6" />}
          title={t("carbon.title", "Năng lượng & Carbon (ISO 50001)")}
          description={t("carbon.subtitle", "EnPI, tiêu thụ năng lượng và phát thải CO₂ quy đổi theo máy")}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            icon={<Zap className="h-5 w-5" />}
            label={t("carbon.totalKwh", "Tổng năng lượng") + " (kWh)"}
            value={kpis.totalKwh.toLocaleString(undefined, { maximumFractionDigits: 1 })}
          />
          <MetricCard
            icon={<Factory className="h-5 w-5" />}
            label={t("carbon.totalCarbon", "Tổng phát thải") + " (kg CO₂)"}
            value={kpis.totalCarbon.toLocaleString(undefined, { maximumFractionDigits: 1 })}
            tone="success"
          />
          <MetricCard
            icon={<Gauge className="h-5 w-5" />}
            label={t("carbon.avgEpu", "EnPI trung bình") + " (kWh/SP)"}
            value={kpis.avgEpu.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            tone="info"
          />
          <MetricCard
            icon={<Factory className="h-5 w-5" />}
            label={t("carbon.goodUnits", "Sản phẩm đạt")}
            value={kpis.goodUnits.toLocaleString()}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("carbon.trend", "Xu hướng năng lượng & phát thải")}</CardTitle>
            <CardDescription>{t("carbon.trendDesc", "kWh và CO₂ theo kỳ")}</CardDescription>
          </CardHeader>
          <CardContent className="h-72">
            {trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="time" tick={chartAxisTick} />
                  <YAxis yAxisId="left" width={44} tick={chartAxisTick} />
                  <YAxis yAxisId="right" orientation="right" width={44} tick={chartAxisTick} />
                  <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                  <Legend />
                  <Area yAxisId="left" type="monotone" dataKey="kwh" name="kWh" stroke={chartColor(0)} fill={chartColor(0)} fillOpacity={0.2} />
                  <Area yAxisId="right" type="monotone" dataKey="carbon" name="CO₂ (kg)" stroke={chartColor(1)} fill={chartColor(1)} fillOpacity={0.2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState variant="no-analytics" compact title={t("carbon.noData", "Không có dữ liệu")} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("carbon.byMachine", "EnPI thực tế vs baseline theo máy")}</CardTitle>
            <CardDescription>{t("carbon.byMachineDesc", "Top 12 máy theo tiêu thụ kWh")}</CardDescription>
          </CardHeader>
          <CardContent className="h-80">
            {byMachine.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byMachine}>
                  <CartesianGrid {...chartGridProps} />
                  <XAxis dataKey="machine" tick={chartAxisTick} />
                  <YAxis width={44} tick={chartAxisTick} />
                  <Tooltip contentStyle={chartTooltipStyle} labelStyle={chartTooltipLabelStyle} />
                  <Legend />
                  <Bar dataKey="epu" name={t("carbon.epu", "EnPI thực tế")} fill={chartColor(0)} />
                  <Bar dataKey="baseline" name={t("carbon.baseline", "Baseline")} fill="var(--muted-foreground)" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState variant="no-analytics" compact title={t("carbon.noData", "Không có dữ liệu")} />
            )}
          </CardContent>
        </Card>
      </PageContainer>
    </DashboardLayout>
  );
}
