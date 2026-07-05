import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { PageHeader, MetricCard, chartColor, chartTooltipStyle, chartGridProps, chartAxisTick } from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { 
  Building2,
  Factory,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  Calendar
} from "lucide-react";
import ReportExportButton, { type ReportExportConfig } from "@/components/ReportExportButton";
import { CorporateFactoryStats } from "@/components/CorporateFactoryStats";
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip as RechartsTooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  Legend,
  LineChart,
  Line
} from "recharts";

export default function CorporateDashboard() {
  const { t } = useTranslation();
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const [activeTab, setActiveTab] = useState("overview");

  // Fetch real data from API
  const { data: dashboardStats, isLoading: loadingStats } = trpc.dashboard.getStats.useQuery({});
  const { data: yieldByCorp, isLoading: loadingYield } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery({});
  const { data: yieldByFactory } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery({});
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();
  const { data: machinesList } = trpc.machine.list.useQuery();
  const { data: dailyStats, isLoading: loadingDaily } = trpc.dashboard.getDailyStats.useQuery({ days: 180 });
  // Real OEE source: live per-machine OEE computed from MQTT (same source as OEEDashboard).
  // Returns [] when no live OEE has been reported — we surface that honestly as "N/A".
  const { data: allOEE } = trpc.mqttClient.getAllOEE.useQuery();

  const isLoading = loadingStats || loadingYield || loadingDaily;

  // Real corporate-wide average OEE: mean of live per-machine OEE values.
  // null when there is no live OEE data (honest "no data" rather than a fabricated number).
  const realAvgOEE = useMemo<number | null>(() => {
    if (!allOEE || allOEE.length === 0) return null;
    const valid = allOEE.filter(m => typeof m.oee === 'number' && !Number.isNaN(m.oee));
    if (valid.length === 0) return null;
    const sum = valid.reduce((acc, m) => acc + m.oee, 0);
    return Math.round((sum / valid.length) * 100) / 100;
  }, [allOEE]);

  // Derive corporateOverview from real data
  const corporateOverview = useMemo(() => {
    const avgYield = dashboardStats?.yieldRate ?? 0;
    return {
      totalCorporations: yieldByCorp?.length ?? 0,
      totalCompanies: yieldByFactory ? new Set(yieldByFactory.map(f => f.factoryCode)).size : 0,
      totalFactories: factories?.length ?? 0,
      totalLines: lines?.length ?? 0,
      totalMachines: machinesList?.length ?? 0,
      avgYield: Math.round(avgYield * 100) / 100,
      avgOEE: realAvgOEE,
    };
  }, [dashboardStats, yieldByCorp, yieldByFactory, factories, lines, machinesList, realAvgOEE]);

  // Derive corporationData from yieldRateByCorporate
  const corporationData = useMemo(() => {
    if (!yieldByCorp) return [];
    // Count factories per corporate from yieldByFactory
    const factoriesPerCorp: Record<string, number> = {};
    if (yieldByFactory) {
      for (const f of yieldByFactory) {
        factoriesPerCorp[f.corporateCode] = (factoriesPerCorp[f.corporateCode] || 0) + 1;
      }
    }
    return yieldByCorp.map(c => {
      const yieldVal = parseFloat(String(c.yieldRate));
      return {
        name: c.corporateCode,
        companies: factoriesPerCorp[c.corporateCode] || 1,
        factories: factoriesPerCorp[c.corporateCode] || 1,
        yield: yieldVal,
        // NOTE: per-corporate OEE and trend are intentionally omitted — there is no
        // real per-corporate OEE/historical data source. Showing yield×0.85 or trend=0
        // would be fabricated. Corporate-wide avg OEE (live) is shown in the KPI cards.
      };
    });
  }, [yieldByCorp, yieldByFactory]);

  // Derive monthlyTrend from dailyStats aggregated by month
  const monthlyTrend = useMemo(() => {
    if (!dailyStats || dailyStats.length === 0) return [];
    const monthMap: Record<string, { total: number; ok: number; ntf: number; output: number }> = {};
    for (const d of dailyStats) {
      const monthKey = d.date.slice(0, 7); // "YYYY-MM"
      if (!monthMap[monthKey]) monthMap[monthKey] = { total: 0, ok: 0, ntf: 0, output: 0 };
      monthMap[monthKey].total += d.totalProducts;
      monthMap[monthKey].ok += d.okCount;
      monthMap[monthKey].ntf += (d.ntfCount ?? 0);
      monthMap[monthKey].output += d.totalProducts;
    }
    return Object.entries(monthMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, v]) => {
        const yieldVal = v.total > 0 ? Math.round(((v.ok + v.ntf) / v.total) * 10000) / 100 : 0;
        const monthNum = parseInt(key.slice(5, 7), 10);
        return {
          month: `T${monthNum}`,
          yield: yieldVal,
          // OEE omitted: no real historical OEE source — only live OEE exists (no monthly history)
          output: v.output,
        };
      });
  }, [dailyStats]);

  // Real export (PDF / XLSX / HTML) — replaces the "coming soon" placeholder.
  const getExportConfig = (): ReportExportConfig => {
    const sections: ReportExportConfig["sections"] = [];
    sections.push({
      title: t('reports.summary', 'Summary'),
      type: 'stats',
      stats: [
        { label: t('corporate.corporation'), value: corporateOverview.totalCorporations },
        { label: t('corporate.company'), value: corporateOverview.totalCompanies },
        { label: t('corporate.factory', 'Factories'), value: corporateOverview.totalFactories },
        { label: t('corporate.line', 'Lines'), value: corporateOverview.totalLines },
        { label: t('corporate.machine', 'Machines'), value: corporateOverview.totalMachines },
        { label: t('reports.yieldRate', 'Yield Rate'), value: `${corporateOverview.avgYield}%` },
        { label: 'OEE', value: corporateOverview.avgOEE != null ? `${corporateOverview.avgOEE}%` : '—' },
      ],
    });
    if (corporationData.length)
      sections.push({
        title: t('corporate.byCorporation', 'By corporation'),
        type: 'table',
        tableHeaders: [
          t('corporate.corporation'), t('corporate.company', 'Companies'),
          t('corporate.factory', 'Factories'), t('reports.yieldRate', 'Yield Rate'),
        ],
        tableRows: corporationData.map((c) => [c.name, c.companies, c.factories, `${c.yield}%`]),
      });
    if (yieldByFactory && yieldByFactory.length)
      sections.push({
        title: t('corporate.byFactory', 'By factory'),
        type: 'table',
        tableHeaders: [
          t('corporate.corporation'), t('reports.factoryCode', 'Factory'),
          t('reports.totalProducts', 'Total'), t('reports.yieldRate', 'Yield Rate'),
        ],
        tableRows: yieldByFactory.map((f: any) => [f.corporateCode, f.factoryCode, f.totalInspections, `${f.yieldRate}%`]),
      });
    if (monthlyTrend.length)
      sections.push({
        title: t('corporate.monthlyTrend', 'Monthly trend'),
        type: 'table',
        tableHeaders: [t('common.month', 'Month'), t('reports.yieldRate', 'Yield Rate'), t('reports.output', 'Output')],
        tableRows: monthlyTrend.map((m) => [m.month, `${m.yield}%`, m.output]),
      });
    return {
      title: t('corporate.dashboard'),
      subtitle: t(`corporate.this${selectedPeriod.charAt(0).toUpperCase()}${selectedPeriod.slice(1)}`, selectedPeriod),
      sections,
      filenamePrefix: 'corporate_dashboard',
      orientation: 'landscape',
    };
  };

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <Skeleton className="h-9 w-64" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[0, 1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} className="h-20 w-full" />
            ))}
          </div>
          <Skeleton className="h-80 w-full" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <PageHeader
          icon={<Building2 className="h-6 w-6" />}
          title={t('corporate.dashboard')}
          description={t('corporate.dashboardDescription')}
          actions={
            <>
              <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                <SelectTrigger className="w-[150px]">
                  <Calendar className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="week">{t('corporate.thisWeek')}</SelectItem>
                  <SelectItem value="month">{t('corporate.thisMonth')}</SelectItem>
                  <SelectItem value="quarter">{t('corporate.thisQuarter')}</SelectItem>
                  <SelectItem value="year">{t('corporate.thisYear')}</SelectItem>
                </SelectContent>
              </Select>
              <ReportExportButton getConfig={getExportConfig} />
            </>
          }
        />

        {/* U7 cross-links — executive corporate roll-up; drill or go live. */}
        <RelatedViews
          links={[
            { href: "/drill-down", labelKey: "nav.drillDown", labelDefault: "Drill-Down" },
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
          ]}
        />

        {/* KPI Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label={t('corporate.corporation')}
            value={corporateOverview.totalCorporations}
          />
          <MetricCard
            label={t('corporate.company')}
            value={corporateOverview.totalCompanies}
          />
          <MetricCard
            label={t('corporate.factory')}
            value={corporateOverview.totalFactories}
          />
          <MetricCard
            label={t('corporate.productionLine')}
            value={corporateOverview.totalLines}
          />
          <MetricCard
            label={t('corporate.machines')}
            value={corporateOverview.totalMachines}
          />
          <MetricCard
            label={t('corporate.avgYield')}
            value={`${corporateOverview.avgYield}%`}
            tone="success"
          />
          {corporateOverview.avgOEE !== null ? (
            <MetricCard
              label={t('corporate.avgOEE')}
              value={`${corporateOverview.avgOEE}%`}
              tone="info"
            />
          ) : (
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="min-w-0">
                  <div
                    className="text-sm font-medium text-muted-foreground"
                    title={t('corporate.noOeeDataSource')}
                  >
                    {t('corporate.noData')}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">{t('corporate.avgOEE')}</div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-xl grid-cols-3">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              {t('corporate.overview')}
            </TabsTrigger>
            <TabsTrigger value="comparison" className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" />
              {t('corporate.comparison')}
            </TabsTrigger>
            <TabsTrigger value="details" className="flex items-center gap-2">
              <Factory className="h-4 w-4" />
              {t('corporate.details')}
            </TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Corporation Performance */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-primary" />
                    {t('corporate.performanceByCorporation')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {corporationData.map((corp, index) => (
                      <div key={corp.name} className="flex items-center justify-between p-3 rounded-lg bg-muted/30">
                        <div className="flex items-center gap-3">
                          <div
                            className="h-10 w-10 rounded-lg flex items-center justify-center"
                            style={{ backgroundColor: `color-mix(in oklch, ${chartColor(index)} 15%, transparent)` }}
                          >
                            <Building2 className="h-5 w-5" style={{ color: chartColor(index) }} />
                          </div>
                          <div>
                            <p className="font-medium">{corp.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {corp.companies} {t('corporate.companies')} • {corp.factories} {t('corporate.factories')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-bold text-success">{corp.yield}%</p>
                            <p className="text-xs text-muted-foreground">{t('corporate.yield')}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Monthly Trend Chart */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    {t('corporate.monthlyTrend')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyTrend}>
                        <CartesianGrid {...chartGridProps} />
                        <XAxis dataKey="month" tick={chartAxisTick} />
                        <YAxis domain={[80, 100]} tick={chartAxisTick} />
                        <RechartsTooltip contentStyle={chartTooltipStyle} />
                        <Legend />
                        <Line type="monotone" dataKey="yield" name={t('corporate.yieldPercent')} stroke="var(--success)" strokeWidth={2} dot={{ fill: 'var(--success)' }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Output Trend */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-primary" />
                  {t('corporate.monthlyOutput')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyTrend}>
                      <CartesianGrid {...chartGridProps} />
                      <XAxis dataKey="month" tick={chartAxisTick} />
                      <YAxis tick={chartAxisTick} />
                      <RechartsTooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number) => [value.toLocaleString(), t('corporate.output')]}
                      />
                      <Bar dataKey="output" name={t('corporate.output')} fill={chartColor(1)} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 gap-6">
              {/* Yield Distribution */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-success" />
                    {t('corporate.yieldDistribution')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={corporationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="yield"
                          nameKey="name"
                          label={({ name, yield: y }) => `${name}: ${y}%`}
                        >
                          {corporationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={chartColor(index)} />
                          ))}
                        </Pie>
                        <RechartsTooltip contentStyle={chartTooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Comparison Bar Chart */}
            <Card className="glass-card">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-primary" />
                  {t('corporate.performanceComparison')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={corporationData} layout="vertical">
                      <CartesianGrid {...chartGridProps} />
                      <XAxis type="number" domain={[0, 100]} tick={chartAxisTick} />
                      <YAxis dataKey="name" type="category" width={100} tick={chartAxisTick} />
                      <RechartsTooltip contentStyle={chartTooltipStyle} />
                      <Legend />
                      <Bar dataKey="yield" name={t('corporate.yieldPercent')} fill="var(--success)" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Details Tab - Use existing CorporateFactoryStats */}
          <TabsContent value="details" className="space-y-6 mt-6">
            <CorporateFactoryStats />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
