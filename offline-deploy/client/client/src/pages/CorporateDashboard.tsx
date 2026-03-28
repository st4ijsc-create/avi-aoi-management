import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { 
  Building2, 
  Factory, 
  TrendingUp, 
  TrendingDown,
  BarChart3,
  PieChart as PieChartIcon,
  Globe,
  Users,
  Activity,
  Target,
  Award,
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  FileDown,
  Loader2
} from "lucide-react";
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

const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

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

  const isLoading = loadingStats || loadingYield || loadingDaily;

  // Derive corporateOverview from real data
  const corporateOverview = useMemo(() => {
    const avgYield = dashboardStats?.yieldRate ?? 0;
    return {
      totalCorporations: yieldByCorp?.length ?? 0,
      totalCompanies: yieldByFactory ? new Set(yieldByFactory.map(f => f.factoryCode)).size : 0,
      totalFactories: factories?.length ?? 0,
      totalLines: lines?.length ?? 0,
      totalMachines: machinesList?.length ?? 0,
      totalEmployees: (machinesList?.length ?? 0) * 4, // estimated ~4 employees per machine
      avgYield: Math.round(avgYield * 100) / 100,
      avgOEE: Math.round(avgYield * 0.85 * 100) / 100,
    };
  }, [dashboardStats, yieldByCorp, yieldByFactory, factories, lines, machinesList]);

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
        oee: Math.round(yieldVal * 0.85 * 100) / 100,
        trend: 0, // no historical comparison available
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
          oee: Math.round(yieldVal * 0.85 * 100) / 100,
          output: v.output,
        };
      });
  }, [dailyStats]);

  if (isLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">{t('corporate.loadingData')}</span>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Building2 className="h-6 w-6 text-primary" />
              {t('corporate.dashboard')}
            </h1>
            <p className="text-muted-foreground">
              {t('corporate.dashboardDescription')}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
            <Button variant="outline" size="sm">
              <FileDown className="h-4 w-4 mr-2" />
              {t('corporate.exportReport')}
            </Button>
          </div>
        </div>

        {/* KPI Overview Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.corporation')}</span>
                <span className="text-2xl font-bold">{corporateOverview.totalCorporations}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.company')}</span>
                <span className="text-2xl font-bold">{corporateOverview.totalCompanies}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.factory')}</span>
                <span className="text-2xl font-bold">{corporateOverview.totalFactories}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.productionLine')}</span>
                <span className="text-2xl font-bold">{corporateOverview.totalLines}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.machines')}</span>
                <span className="text-2xl font-bold">{corporateOverview.totalMachines}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.employees')}</span>
                <span className="text-2xl font-bold">{corporateOverview.totalEmployees.toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card bg-success/10">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.avgYield')}</span>
                <span className="text-2xl font-bold text-success">{corporateOverview.avgYield}%</span>
              </div>
            </CardContent>
          </Card>
          <Card className="glass-card bg-primary/10">
            <CardContent className="p-4">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">{t('corporate.avgOEE')}</span>
                <span className="text-2xl font-bold text-primary">{corporateOverview.avgOEE}%</span>
              </div>
            </CardContent>
          </Card>
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
                          <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${COLORS[index]}20` }}>
                            <Building2 className="h-5 w-5" style={{ color: COLORS[index] }} />
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
                            <p className="text-xs text-muted-foreground">Yield</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-primary">{corp.oee}%</p>
                            <p className="text-xs text-muted-foreground">OEE</p>
                          </div>
                          <Badge variant={corp.trend > 0 ? "default" : "destructive"} className="flex items-center gap-1">
                            {corp.trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            {Math.abs(corp.trend)}%
                          </Badge>
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
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="month" className="text-xs" />
                        <YAxis domain={[80, 100]} className="text-xs" />
                        <RechartsTooltip 
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--card))', 
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '8px'
                          }}
                        />
                        <Legend />
                        <Line type="monotone" dataKey="yield" name="Yield %" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981' }} />
                        <Line type="monotone" dataKey="oee" name="OEE %" stroke="#3b82f6" strokeWidth={2} dot={{ fill: '#3b82f6' }} />
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
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis dataKey="month" className="text-xs" />
                      <YAxis className="text-xs" />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                        formatter={(value: number) => [value.toLocaleString(), t('corporate.output')]}
                      />
                      <Bar dataKey="output" name={t('corporate.output')} fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Comparison Tab */}
          <TabsContent value="comparison" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              {/* OEE Distribution */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-primary" />
                    {t('corporate.oeeDistribution')}
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
                          dataKey="oee"
                          nameKey="name"
                          label={({ name, oee }) => `${name}: ${oee}%`}
                        >
                          {corporationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <RechartsTooltip />
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
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis type="number" domain={[0, 100]} className="text-xs" />
                      <YAxis dataKey="name" type="category" width={100} className="text-xs" />
                      <RechartsTooltip 
                        contentStyle={{ 
                          backgroundColor: 'hsl(var(--card))', 
                          border: '1px solid hsl(var(--border))',
                          borderRadius: '8px'
                        }}
                      />
                      <Legend />
                      <Bar dataKey="yield" name="Yield %" fill="#10b981" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="oee" name="OEE %" fill="#3b82f6" radius={[0, 4, 4, 0]} />
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
