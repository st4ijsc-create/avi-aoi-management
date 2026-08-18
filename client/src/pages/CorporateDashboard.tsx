import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { PageHeader, MetricCard, chartColor, chartTooltipStyle, chartGridProps, chartAxisTick } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { ScopeEmptyNotice } from "@/components/ScopeEmptyNotice";
import { 
  Building2,
  Factory,
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
  Calendar,
  Globe,
  ArrowRight,
  ChevronRight
} from "lucide-react";
import ReportExportButton, { type ReportExportConfig } from "@/components/ReportExportButton";
import PollFreshness from "@/components/PollFreshness";
import { CorporateFactoryStats } from "@/components/CorporateFactoryStats";
import { ContextDrawer } from "@/components/workspace";
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
  Line,
  ReferenceLine
} from "recharts";

export default function CorporateDashboard() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission } = usePermissions();
  // Cross-link to the federation roll-up is only surfaced to users who can enter
  // it (same gate as the /federation-dashboard RouteGuard: admin / admin_system).
  const canViewFederation = hasPermission("admin_system", "canView");
  const [selectedPeriod, setSelectedPeriod] = useState("month");
  const [activeTab, setActiveTab] = useState("overview");
  // doc 68 §3.7 P1 — dòng tập đoàn click → ContextDrawer preview (KPI + so-sánh
  // kỳ + drill), thay vì bắt executive đổi tab "Chi tiết" (có filter kỳ riêng).
  const [drawerCorp, setDrawerCorp] = useState<{
    name: string;
    isUnassigned: boolean;
    factories: number;
    yield: number;
    output: number;
  } | null>(null);

  // W1-P0: bộ lọc kỳ KHÔNG còn là trang trí — map selectedPeriod → khoảng thời
  // gian thật truyền vào các query. startDate ổn định theo selectedPeriod (không
  // tạo Date mới mỗi render → tránh churn query-key / refetch vô hạn, cùng pattern
  // ExecutiveMobile). endDate bỏ trống = "đến nay" (server hiểu open-ended).
  const periodRange = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    let days: number;
    switch (selectedPeriod) {
      case "week": {
        // Đầu tuần hiện tại (Thứ 2) → nay
        const dow = (start.getDay() + 6) % 7; // 0 = Thứ 2
        start.setDate(start.getDate() - dow);
        days = 7;
        break;
      }
      case "quarter": {
        start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
        days = 92;
        break;
      }
      case "year": {
        start.setMonth(0, 1);
        days = 365;
        break;
      }
      case "month":
      default: {
        start.setDate(1);
        days = 31;
        break;
      }
    }
    return { startDate: start, days };
  }, [selectedPeriod]);

  // Fetch real data from API — các nguồn theo-kỳ đều nhận startDate (đã xác minh
  // server: dashboard.getStats + corporateFactoryStats.* nhận startDate/endDate
  // optional; getDailyStats nhận days không cap).
  // W2 (AUD-01): trang giao ban/TV mở hàng giờ — poll 60s cho dữ liệu chính để
  // không "đứng yên vĩnh viễn" sau lần fetch lúc mount (giả-live). Lịch sử ngày
  // (getDailyStats) đổi chậm → staleTime 5' + poll 5'. refetchOnWindowFocus giữ
  // mặc định TanStack (true).
  const POLL_MAIN_MS = 60_000;
  const POLL_HISTORY_MS = 300_000;
  const {
    data: dashboardStats,
    isLoading: loadingStats,
    dataUpdatedAt: statsUpdatedAt,
    isFetching: fetchingStats,
  } = trpc.dashboard.getStats.useQuery(
    { startDate: periodRange.startDate },
    { refetchInterval: POLL_MAIN_MS },
  );
  const {
    data: yieldByCorp,
    isLoading: loadingYield,
    dataUpdatedAt: yieldCorpUpdatedAt,
    isFetching: fetchingYieldCorp,
  } = trpc.corporateFactoryStats.yieldRateByCorporate.useQuery(
    { startDate: periodRange.startDate },
    { refetchInterval: POLL_MAIN_MS },
  );
  const {
    data: yieldByFactory,
    dataUpdatedAt: yieldFactoryUpdatedAt,
    isFetching: fetchingYieldFactory,
  } = trpc.corporateFactoryStats.yieldRateByFactory.useQuery(
    { startDate: periodRange.startDate },
    { refetchInterval: POLL_MAIN_MS },
  );
  // Danh mục thực thể (factory/line/machine) là số đăng ký HIỆN CÓ — không phải
  // chuỗi thời gian, không lọc theo kỳ được → card tương ứng ghi chú trung thực.
  // doc 67 W6 (việc 4): trước đây fetch NGUYÊN 3 list (factory/line/machine) chỉ
  // để đếm .length → thay bằng 1 procedure COUNT(*) (cùng filter isActive với các
  // list). Danh mục đổi chậm → staleTime 5', không cần poll.
  const { data: overviewCounts } = trpc.dashboard.overviewCounts.useQuery(undefined, {
    staleTime: 300_000,
  });
  const { data: dailyStats, isLoading: loadingDaily } = trpc.dashboard.getDailyStats.useQuery(
    { days: periodRange.days },
    { staleTime: POLL_HISTORY_MS, refetchInterval: POLL_HISTORY_MS },
  );
  // Real OEE source: live per-machine OEE computed from MQTT (same source as OEEDashboard).
  // Returns [] when no live OEE has been reported — we surface that honestly as "N/A".
  const {
    data: allOEE,
    dataUpdatedAt: oeeUpdatedAt,
    isFetching: fetchingOEE,
  } = trpc.mqttClient.getAllOEE.useQuery(undefined, { refetchInterval: POLL_MAIN_MS });

  const isLoading = loadingStats || loadingYield || loadingDaily;

  // W2 (AUD-01): mốc tươi của trang = lần fetch thành công MỚI NHẤT trong các
  // query dữ liệu chính (dataUpdatedAt = 0 khi chưa có dữ liệu → lọc bỏ).
  const freshnessUpdatedAt = useMemo(() => {
    const stamps = [statsUpdatedAt, yieldCorpUpdatedAt, yieldFactoryUpdatedAt, oeeUpdatedAt].filter(
      (ts) => ts > 0,
    );
    return stamps.length ? Math.max(...stamps) : undefined;
  }, [statsUpdatedAt, yieldCorpUpdatedAt, yieldFactoryUpdatedAt, oeeUpdatedAt]);
  const freshnessFetching = fetchingStats || fetchingYieldCorp || fetchingYieldFactory || fetchingOEE;

  // Real corporate-wide average OEE: mean of live per-machine OEE values.
  // null when there is no live OEE data (honest "no data" rather than a fabricated number).
  const realAvgOEE = useMemo<number | null>(() => {
    if (!allOEE || allOEE.length === 0) return null;
    const valid = allOEE.filter(m => typeof m.oee === 'number' && !Number.isNaN(m.oee));
    if (valid.length === 0) return null;
    const sum = valid.reduce((acc, m) => acc + m.oee, 0);
    return Math.round((sum / valid.length) * 100) / 100;
  }, [allOEE]);

  // Derive corporateOverview from real data.
  // W1-P0: KPI "Công ty" cũ đếm Set(factoryCode) dán nhãn Công ty — SAI (không có
  // tầng company thật trong data: yieldRateByFactory chỉ trả corporateCode +
  // factoryCode, đã xác minh server/db/statistics.ts). Thay bằng KPI trung thực
  // "Nhà máy có dữ liệu" (distinct factoryCode có inspection trong kỳ).
  const corporateOverview = useMemo(() => {
    const avgYield = dashboardStats?.yieldRate ?? 0;
    const isUnassignedCode = (code: string | null | undefined) => !code || code === 'N/A';
    return {
      // Chỉ đếm tập đoàn THẬT (loại nhóm chưa-gán 'N/A' khỏi số đếm).
      totalCorporations: yieldByCorp
        ? new Set(yieldByCorp.filter(c => !isUnassignedCode(c.corporateCode)).map(c => c.corporateCode)).size
        : 0,
      factoriesWithData: yieldByFactory ? new Set(yieldByFactory.map(f => f.factoryCode)).size : 0,
      totalFactories: overviewCounts?.factories ?? 0,
      totalLines: overviewCounts?.lines ?? 0,
      totalMachines: overviewCounts?.machines ?? 0,
      avgYield: Math.round(avgYield * 100) / 100,
      avgOEE: realAvgOEE,
      // doc 68 §3.7 P1 — "Sản lượng" cho hero band = tổng inspection trong kỳ
      // (dashboardStats.total, cùng nguồn yieldRate).
      totalOutput: dashboardStats?.total ?? 0,
    };
  }, [dashboardStats, yieldByCorp, yieldByFactory, overviewCounts, realAvgOEE]);

  // W1-P2: nhãn hiển thị cho nhóm inspection chưa gán tập đoàn (corporateCode
  // null/'N/A' phía server) — gộp một dòng, style muted, xếp CUỐI danh sách và
  // LOẠI khỏi pie/bar so sánh (chỉ hiện trong danh sách chi tiết).
  const UNASSIGNED_CORP_LABEL = "Chưa gán tập đoàn";

  // Derive corporationData from yieldRateByCorporate
  const corporationData = useMemo(() => {
    if (!yieldByCorp) return [];
    const isUnassignedCode = (code: string | null | undefined) => !code || code === 'N/A';
    // Count factories per corporate from yieldByFactory (nhóm chưa-gán gộp chung)
    const factoriesPerCorp: Record<string, number> = {};
    if (yieldByFactory) {
      for (const f of yieldByFactory) {
        const key = isUnassignedCode(f.corporateCode) ? UNASSIGNED_CORP_LABEL : f.corporateCode;
        factoriesPerCorp[key] = (factoriesPerCorp[key] || 0) + 1;
      }
    }
    // Gộp mọi dòng chưa-gán thành MỘT dòng; yield gộp tính lại từ ok+ntf/total
    // (cùng công thức FINAL yield của server) thay vì trung bình các %.
    const merged: Record<string, { name: string; isUnassigned: boolean; factories: number; ok: number; ntf: number; total: number }> = {};
    for (const c of yieldByCorp) {
      const isUnassigned = isUnassignedCode(c.corporateCode);
      const name = isUnassigned ? UNASSIGNED_CORP_LABEL : c.corporateCode;
      if (!merged[name]) {
        merged[name] = { name, isUnassigned, factories: factoriesPerCorp[name] || 0, ok: 0, ntf: 0, total: 0 };
      }
      merged[name].ok += Number(c.okCount ?? 0);
      merged[name].ntf += Number(c.ntfCount ?? 0);
      merged[name].total += Number(c.totalInspections ?? 0);
    }
    return Object.values(merged)
      .map(m => ({
        name: m.name,
        isUnassigned: m.isUnassigned,
        factories: m.factories,
        yield: m.total > 0 ? Math.round(((m.ok + m.ntf) / m.total) * 10000) / 100 : 0,
        // W4: sản lượng (tổng inspection trong kỳ) — nguồn dữ liệu đúng ngữ nghĩa
        // cho pie "phân bố" (pie theo yield% là sai ngữ nghĩa part-of-whole).
        output: m.total,
        // NOTE: per-corporate OEE and trend are intentionally omitted — there is no
        // real per-corporate OEE/historical data source. Showing yield×0.85 or trend=0
        // would be fabricated. Corporate-wide avg OEE (live) is shown in the KPI cards.
      }))
      // Nhóm chưa-gán xếp cuối danh sách
      .sort((a, b) => Number(a.isUnassigned) - Number(b.isUnassigned));
  }, [yieldByCorp, yieldByFactory]);

  // Dữ liệu cho pie/bar so sánh: chỉ tập đoàn thật (loại nhóm chưa-gán).
  const assignedCorporationData = useMemo(
    () => corporationData.filter(c => !c.isUnassigned),
    [corporationData],
  );

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

  // doc 68 §3.7 P2 — chart co khi dữ liệu thưa (<3 tháng): tránh biểu đồ phình
  // nửa card cho 1-2 điểm. Hạ ~120px (line 280→160, bar 250→140).
  const sparseTrend = monthlyTrend.length > 0 && monthlyTrend.length < 3;

  // Real export (PDF / XLSX / HTML) — replaces the "coming soon" placeholder.
  const getExportConfig = (): ReportExportConfig => {
    const sections: ReportExportConfig["sections"] = [];
    sections.push({
      title: t('reports.summary', 'Summary'),
      type: 'stats',
      stats: [
        { label: t('corporate.corporation'), value: corporateOverview.totalCorporations },
        { label: 'Nhà máy có dữ liệu', value: corporateOverview.factoriesWithData },
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
          t('corporate.corporation'),
          t('corporate.factory', 'Factories'), t('reports.yieldRate', 'Yield Rate'),
        ],
        tableRows: corporationData.map((c) => [c.name, c.factories, `${c.yield}%`]),
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
      {/*
        ⚠ 2026-08-17 — hero "tỷ lệ đạt" và "sản lượng" của trang này lấy từ `dashboard.getStats`, vốn mang nhãn.
        Trước bản vá, tài khoản CHƯA ĐƯỢC GÁN NHÀ MÁY đọc những con số này như một phép đo về
        nhà máy. Chúng không phải phép đo — chúng là hệ quả của một phạm vi rỗng.
      */}
        <ScopeEmptyNotice reason={(dashboardStats as { scopeEmptyReason?: string | null } | undefined)?.scopeEmptyReason} />
        {/* Header */}
        <PageHeader
          icon={<Building2 className="h-6 w-6" />}
          // doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.corporateDashboard.
          title={t("nav.corporateDashboard", "Corporate Overview")}
          description={t('corporate.dashboardDescription')}
          actions={
            <>
              {/* W2 (AUD-01): freshness trung thực — "Cập nhật Xs trước"; amber khi
                  quá 1,5× chu kỳ poll 60s (trễ mạng bình thường không nháy cảnh báo). */}
              <PollFreshness
                updatedAt={freshnessUpdatedAt}
                isFetching={freshnessFetching}
                staleAfterMs={POLL_MAIN_MS * 1.5}
              />
              {canViewFederation && (
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => setLocation("/federation-dashboard")}
                  title={t('nav.federationDashboardDesc', 'Roll-up view across multiple connected sites/plants (preview)')}
                >
                  <Globe className="h-4 w-4" />
                  {t('nav.federationDashboard', 'Federation Dashboard')}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
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

        {/* doc 67 W5 (việc 6) — rail 2-chiều từ map tập trung (RelatedViews.tsx). */}
        <RelatedViews pageId="corporate-dashboard" />

        {/* doc 68 §3.7 P1 — HERO BAND: 3 số điều hành đọc-trong-5s (Tỷ lệ đạt /
            OEE / Sản lượng), số LỚN (MetricCard size="hero"). Tách khỏi 5 số đếm
            (→ strip muted 1 hàng bên dưới) để khử đồng-trọng-số + neo mắt. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {/* W4: tone theo ngưỡng thật (≥98 success · ≥95 trung tính · <95 danger)
              — success vô điều kiện là "màu nói dối" khi yield xấu. */}
          <MetricCard
            size="hero"
            icon={<TrendingUp />}
            label={t('corporate.avgYield')}
            value={`${corporateOverview.avgYield}%`}
            tone={corporateOverview.avgYield >= 98 ? "success" : corporateOverview.avgYield >= 95 ? "default" : "danger"}
          />
          {corporateOverview.avgOEE !== null ? (
            /* OEE là số ĐO TRỰC TIẾP (live MQTT) — không có lịch sử theo kỳ. */
            <MetricCard
              size="hero"
              icon={<Activity />}
              label={t('corporate.avgOEE')}
              value={`${corporateOverview.avgOEE}%`}
              tone="info"
              delta="Trực tiếp — không theo kỳ"
            />
          ) : (
            /* doc 68 §3.7 P1 — ô no-OEE dùng MetricCard chuẩn (value="—") thay Card
               tự chế lệch chuẩn → đồng nhất hero band + hết ô mồ côi. */
            <MetricCard
              size="hero"
              icon={<Activity />}
              label={t('corporate.avgOEE')}
              value="—"
              tone="default"
              delta={t('corporate.noData', 'Chưa có dữ liệu')}
            />
          )}
          {/* W4: "Sản lượng" (tổng inspection trong kỳ) hoàn tất bộ 3 câu-hỏi-số-1. */}
          <MetricCard
            size="hero"
            icon={<BarChart3 />}
            label={t('corporate.output')}
            value={corporateOverview.totalOutput.toLocaleString()}
          />
        </div>

        {/* doc 68 §3.7 P1 — strip 5 số đếm MUTED 1 hàng: hạ trọng số so với hero
            (số đếm danh mục, không phải KPI điều hành) + khử ô mồ côi. */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
            {[
              { label: t('corporate.corporation'), value: corporateOverview.totalCorporations },
              { label: 'Nhà máy có dữ liệu', value: corporateOverview.factoriesWithData },
              { label: t('corporate.factory'), value: corporateOverview.totalFactories },
              { label: t('corporate.productionLine'), value: corporateOverview.totalLines },
              { label: t('corporate.machines'), value: corporateOverview.totalMachines },
            ].map((s) => (
              <span key={s.label} className="flex items-baseline gap-1.5">
                <span className="text-lg font-semibold tabular-nums text-foreground">{s.value}</span>
                <span className="text-xs text-muted-foreground">{s.label}</span>
              </span>
            ))}
          </CardContent>
        </Card>

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
                      /* W1-P2: nhóm "Chưa gán tập đoàn" hiển thị muted, xếp cuối
                         (sort trong corporationData) và không vào pie/bar so sánh.
                         doc 68 §3.7 P1: dòng click → ContextDrawer (KPI + so-kỳ +
                         drill) thay vì bắt đổi tab "Chi tiết" (đứt mạch). */
                      <button
                        type="button"
                        key={corp.name}
                        onClick={() => setDrawerCorp(corp)}
                        className={`flex w-full items-center justify-between rounded-lg p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${corp.isUnassigned ? 'bg-muted/10 opacity-70' : 'bg-muted/30'}`}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="h-10 w-10 rounded-lg flex items-center justify-center"
                            style={corp.isUnassigned
                              ? { backgroundColor: 'color-mix(in oklch, var(--muted-foreground) 15%, transparent)' }
                              : { backgroundColor: `color-mix(in oklch, ${chartColor(index)} 15%, transparent)` }}
                          >
                            <Building2
                              className={`h-5 w-5 ${corp.isUnassigned ? 'text-muted-foreground' : ''}`}
                              style={corp.isUnassigned ? undefined : { color: chartColor(index) }}
                            />
                          </div>
                          <div>
                            <p className={corp.isUnassigned ? 'font-medium text-muted-foreground' : 'font-medium'}>{corp.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {corp.factories} {t('corporate.factories')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <p className={`font-bold ${corp.isUnassigned ? 'text-muted-foreground' : 'text-success'}`}>{corp.yield}%</p>
                            <p className="text-xs text-muted-foreground">{t('corporate.yield')}</p>
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </div>
                      </button>
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
                  {/* W4: kỳ ngắn → nói thật thay vì để trend 1-2 điểm gây hiểu nhầm. */}
                  {monthlyTrend.length > 0 && monthlyTrend.length < 3 && (
                    <p className="text-xs text-muted-foreground">Mới có {monthlyTrend.length} tháng dữ liệu</p>
                  )}
                </CardHeader>
                {/* doc 68 §3.7 P2 — cân card danh sách vs chart: flex items-center
                    giữ chart canh giữa dọc khi thưa (list bên trái cao hơn). */}
                <CardContent className="flex items-center">
                  <div
                    className={`w-full ${sparseTrend ? 'h-[160px]' : 'h-[280px]'}`}
                    role="img"
                    aria-label={t("corpDash.xuHuongTyLeDat", "Xu hướng tỷ lệ đạt theo tháng — biểu đồ đường, đường tham chiếu mục tiêu 95%")}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={monthlyTrend}>
                        <CartesianGrid {...chartGridProps} />
                        <XAxis dataKey="month" tick={chartAxisTick} />
                        {/* W4: domain cứng [80,100] cắt mất tháng yield xấu — nới sàn theo dataMin. */}
                        <YAxis
                          domain={[(dataMin: number) => Math.min(80, Math.floor(dataMin - 2)), 100]}
                          tick={chartAxisTick}
                        />
                        <RechartsTooltip contentStyle={chartTooltipStyle} />
                        <Legend />
                        <ReferenceLine
                          y={95}
                          stroke="var(--warning)"
                          strokeDasharray="4 4"
                          label={{ value: 'Mục tiêu', position: 'insideTopRight', fill: 'var(--muted-foreground)', fontSize: 11 }}
                        />
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
                {monthlyTrend.length > 0 && monthlyTrend.length < 3 && (
                  <p className="text-xs text-muted-foreground">Mới có {monthlyTrend.length} tháng dữ liệu</p>
                )}
              </CardHeader>
              <CardContent>
                <div className={sparseTrend ? 'h-[140px]' : 'h-[250px]'} role="img" aria-label={t("corpDash.sanLuongTheoThangBieu", "Sản lượng theo tháng — biểu đồ cột")}>
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
                  {/* W4: pie theo yield% là sai ngữ nghĩa (yield không phải part-of-whole)
                      → pie theo SẢN LƯỢNG (tổng inspection trong kỳ) + đổi tiêu đề. */}
                  <CardTitle className="text-base flex items-center gap-2">
                    <PieChartIcon className="h-4 w-4 text-success" />
                    Phân bố sản lượng theo tập đoàn
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div
                    className="h-[300px]"
                    role="img"
                    aria-label={t("corpDash.phanBoSanLuongTheo", "Phân bố sản lượng theo tập đoàn — biểu đồ tròn")}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={assignedCorporationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="output"
                          nameKey="name"
                          label={({ name, value }) => `${name}: ${Number(value ?? 0).toLocaleString()}`}
                        >
                          {assignedCorporationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={chartColor(index)} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          contentStyle={chartTooltipStyle}
                          formatter={(value: number) => [value.toLocaleString(), 'Sản lượng']}
                        />
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
                <div
                  className="h-[300px]"
                  role="img"
                  aria-label={t("corpDash.soSanhTyLeDat", "So sánh tỷ lệ đạt giữa các tập đoàn — biểu đồ cột ngang")}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={assignedCorporationData} layout="vertical">
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
            {/* Trung thực: tab chi tiết có bộ lọc thời gian RIÊNG (7/30/90 ngày),
                không theo kỳ đã chọn ở đầu trang. */}
            <p className="text-xs text-muted-foreground">
              Tab chi tiết dùng bộ lọc thời gian riêng bên dưới, không theo kỳ đã chọn ở đầu trang.
            </p>
            <CorporateFactoryStats />
          </TabsContent>
        </Tabs>

        {/* doc 68 §3.7 P1 — ContextDrawer preview cho dòng tập đoàn: KPI + mini
            so-sánh kỳ (vs trung bình tập đoàn / mục tiêu 95%) + CTA drill. Giữ
            danh sách nền để so sánh liên tiếp, thay điều hướng đổi tab đứt-mạch. */}
        <ContextDrawer
          open={drawerCorp !== null}
          onOpenChange={(o) => { if (!o) setDrawerCorp(null); }}
          title={drawerCorp?.name ?? ''}
          description={drawerCorp
            ? `${drawerCorp.factories} ${t('corporate.factories')} · ${t(`corporate.this${selectedPeriod.charAt(0).toUpperCase()}${selectedPeriod.slice(1)}`, selectedPeriod)}`
            : undefined}
        >
          {drawerCorp && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label={t('corporate.yield')}
                  value={`${drawerCorp.yield}%`}
                  tone={drawerCorp.isUnassigned ? 'default' : drawerCorp.yield >= 98 ? 'success' : drawerCorp.yield >= 95 ? 'default' : 'danger'}
                />
                <MetricCard label={t('corporate.output')} value={drawerCorp.output.toLocaleString()} />
                <MetricCard label={t('corporate.factories')} value={drawerCorp.factories} />
              </div>

              {/* Mini so-sánh kỳ: yield tập đoàn này vs trung bình toàn + mục tiêu. */}
              <div className="space-y-2 rounded-lg border p-3">
                <p className="text-xs font-medium text-muted-foreground">{t("corpDash.soSanhTrongKy", "So sánh trong kỳ")}</p>
                {(() => {
                  const dVsAvg = Math.round((drawerCorp.yield - corporateOverview.avgYield) * 100) / 100;
                  const dVsTarget = Math.round((drawerCorp.yield - 95) * 100) / 100;
                  const row = (lbl: string, d: number) => (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{lbl}</span>
                      <span className={`font-semibold tabular-nums ${d > 0 ? 'text-success' : d < 0 ? 'text-destructive' : 'text-foreground'}`}>
                        {d > 0 ? '+' : ''}{d} pp
                      </span>
                    </div>
                  );
                  return (
                    <>
                      {row('vs. Trung bình tập đoàn', dVsAvg)}
                      {row('vs. Mục tiêu 95%', dVsTarget)}
                    </>
                  );
                })()}
              </div>

              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => { setDrawerCorp(null); setLocation('/drill-down'); }}
              >
                <Factory className="h-4 w-4" />
                Chi tiết theo nhà máy
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </ContextDrawer>
      </div>
    </DashboardLayout>
  );
}
