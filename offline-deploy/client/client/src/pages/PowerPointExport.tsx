import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from 'react-i18next';
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import {
  Presentation, Download, Loader2, BarChart3, GitCompareArrows,
  FileDown, Monitor, Calendar, Factory, Settings2, CheckCircle2,
  Layout, PieChart, LineChart, Table2,
} from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export function PowerPointExportContent() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("quality");

  // Quality Report state
  const [qualityDays, setQualityDays] = useState(7);
  const [qualityFactory, setQualityFactory] = useState("all");
  const [qualityTitle, setQualityTitle] = useState("");
  const [includeCharts, setIncludeCharts] = useState(true);
  const [includeTables, setIncludeTables] = useState(true);
  const [includeSummary, setIncludeSummary] = useState(true);

  // Comparison state
  const [compPeriod, setCompPeriod] = useState("week");
  const [compFactory, setCompFactory] = useState("all");
  const [compTitle, setCompTitle] = useState("");

  // Custom state
  const [customTitle, setCustomTitle] = useState("");
  const [customSlides, setCustomSlides] = useState<{ title: string; kpis: { label: string; value: string }[] }[]>([]);

  const { data: factories } = trpc.factory.list.useQuery();

  const qualityMutation = trpc.powerpoint.exportQualityReport.useMutation({
    onSuccess: (data) => downloadPptx(data, "quality-report.pptx"),
    onError: (err) => toast.error(err.message),
  });

  const comparisonMutation = trpc.powerpoint.exportComparison.useMutation({
    onSuccess: (data) => downloadPptx(data, "comparison-report.pptx"),
    onError: (err) => toast.error(err.message),
  });

  const customMutation = trpc.powerpoint.exportCustom.useMutation({
    onSuccess: (data) => downloadPptx(data, "custom-report.pptx"),
    onError: (err) => toast.error(err.message),
  });

  const downloadPptx = (data: any, defaultFilename: string) => {
    try {
      const base64 = data.data || data.base64 || (typeof data === "string" ? data : "");
      const binaryStr = atob(typeof base64 === "string" ? base64 : "");
      const filename = data.filename || defaultFilename;
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('reports.pptxDownloaded'));
    } catch {
      toast.error(t('reports.fileDownloadError'));
    }
  };

  const handleQualityExport = () => {
    const endDate = new Date();
    const startDate = new Date(Date.now() - qualityDays * 24 * 60 * 60 * 1000);
    qualityMutation.mutate({
      startDate,
      endDate,
      factoryId: qualityFactory && qualityFactory !== 'all' ? parseInt(qualityFactory) : undefined,
      config: {
        title: qualityTitle,
      },
    });
  };

  const handleComparisonExport = () => {
    const now = new Date();
    let currentStart: Date;
    let currentEnd: Date = now;
    let periodType: "day" | "week" | "month" | "quarter" = "week";
    switch (compPeriod) {
      case "day":
        currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        periodType = "day";
        break;
      case "month":
        currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
        periodType = "month";
        break;
      case "quarter":
        currentStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        periodType = "quarter";
        break;
      default:
        const dayOfWeek = now.getDay();
        currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
        periodType = "week";
    }
    comparisonMutation.mutate({
      periodType,
      currentStart,
      currentEnd,
      factoryId: compFactory && compFactory !== 'all' ? parseInt(compFactory) : undefined,
      config: {
        title: compTitle,
      },
    });
  };

  const addCustomSlide = (type: string) => {
    const slideLabels: Record<string, string> = {
      kpi: "KPI Dashboard",
      bar_chart: t('reports.barChart'),
      line_chart: t('reports.lineChart'),
      pie_chart: t('reports.pieChart'),
      table: t('reports.dataTable'),
    };
    setCustomSlides((prev) => [
      ...prev,
      { title: slideLabels[type] || type, kpis: [{ label: t('reports.sampleKpi'), value: "0" }] },
    ]);
  };

  const removeCustomSlide = (idx: number) => {
    setCustomSlides((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleCustomExport = () => {
    if (!customTitle.trim()) {
      toast.error(t('reports.pleaseEnterReportName'));
      return;
    }
    if (customSlides.length === 0) {
      toast.error(t('reports.pleaseAddAtLeastOneSlide'));
      return;
    }
    customMutation.mutate({
      config: {
        title: customTitle,
      },
      slides: customSlides,
    });
  };

  return (
    <>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Presentation className="h-6 w-6 text-primary" />
            {t('reports.exportPowerPoint')}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t('reports.exportPptxDescription')}
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid md:grid-cols-3 gap-4">
          <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setActiveTab("quality")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Monitor className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <div className="font-medium text-sm">{t('reports.qualityReport')}</div>
                <div className="text-xs text-muted-foreground">KPI, yield, NG analysis</div>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setActiveTab("comparison")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <GitCompareArrows className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <div className="font-medium text-sm">{t('reports.dataComparison')}</div>
                <div className="text-xs text-muted-foreground">Week-over-week, month</div>
              </div>
            </CardContent>
          </Card>
          <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => setActiveTab("custom")}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Settings2 className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <div className="font-medium text-sm">{t('reports.custom')}</div>
                <div className="text-xs text-muted-foreground">{t('reports.selectSlidesCustom')}</div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="quality">
              <Monitor className="h-4 w-4 mr-1" /> {t('reports.quality')}
            </TabsTrigger>
            <TabsTrigger value="comparison">
              <GitCompareArrows className="h-4 w-4 mr-1" /> {t('reports.comparison')}
            </TabsTrigger>
            <TabsTrigger value="custom">
              <Settings2 className="h-4 w-4 mr-1" /> {t('reports.custom')}
            </TabsTrigger>
          </TabsList>

          {/* ============ Quality Report ============ */}
          <TabsContent value="quality">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('reports.exportQualityReport')}</CardTitle>
                <CardDescription>{t('reports.qualityPptxDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.title')}</Label>
                    <Input
                      value={qualityTitle}
                      onChange={(e) => setQualityTitle(e.target.value)}
                      placeholder={t('reports.reportNamePlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.timeRangeDays')}</Label>
                    <Input
                      type="number"
                      value={qualityDays}
                      onChange={(e) => setQualityDays(parseInt(e.target.value) || 7)}
                      min={1}
                      max={365}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.factory')}</Label>
                    <Select value={qualityFactory} onValueChange={setQualityFactory}>
                      <SelectTrigger><SelectValue placeholder={t('common.all')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        {(factories || []).map((f: any) => (
                          <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch checked={includeCharts} onCheckedChange={setIncludeCharts} />
                    <Label className="text-xs flex items-center gap-1">
                      <BarChart3 className="h-3 w-3" /> {t('reports.charts')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={includeTables} onCheckedChange={setIncludeTables} />
                    <Label className="text-xs flex items-center gap-1">
                      <Table2 className="h-3 w-3" /> {t('reports.dataTable')}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={includeSummary} onCheckedChange={setIncludeSummary} />
                    <Label className="text-xs flex items-center gap-1">
                      <Layout className="h-3 w-3" /> {t('reports.overview')}
                    </Label>
                  </div>
                </div>

                {/* Preview what slides will be generated */}
                <div className="bg-muted/30 rounded-lg p-4 border">
                  <div className="text-xs font-medium mb-2">{t('reports.pptxContents')}:</div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.titleSlide')}
                    </div>
                    {includeSummary && (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.kpiOverviewSlide')}
                      </div>
                    )}
                    {includeCharts && (
                      <>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.yieldByDayChart')}
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.ngAnalysisChart')}
                        </div>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.machineComparisonChart')}
                        </div>
                      </>
                    )}
                    {includeTables && (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.topNgPointsTable')}
                      </div>
                    )}
                  </div>
                </div>

                <Button
                  onClick={handleQualityExport}
                  disabled={qualityMutation.isPending}
                  className="w-full"
                >
                  {qualityMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {t('reports.downloadPptx')}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ Comparison Report ============ */}
          <TabsContent value="comparison">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('reports.exportComparisonReport')}</CardTitle>
                <CardDescription>{t('reports.comparisonPptxDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.title')}</Label>
                    <Input
                      value={compTitle}
                      onChange={(e) => setCompTitle(e.target.value)}
                      placeholder={t('reports.reportNamePlaceholder')}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.comparisonPeriod')}</Label>
                    <Select value={compPeriod} onValueChange={setCompPeriod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="week">{t('reports.lastWeekVsThisWeek')}</SelectItem>
                        <SelectItem value="month">{t('reports.lastMonthVsThisMonth')}</SelectItem>
                        <SelectItem value="quarter">{t('reports.lastQuarterVsThisQuarter')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t('reports.factory')}</Label>
                    <Select value={compFactory} onValueChange={setCompFactory}>
                      <SelectTrigger><SelectValue placeholder={t('common.all')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        {(factories || []).map((f: any) => (
                          <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="bg-muted/30 rounded-lg p-4 border">
                  <div className="text-xs font-medium mb-2">{t('reports.pptxContents')}:</div>
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.titleSlide')}
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.kpiComparisonOverview')}
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.dailyTrendChart')}
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-500" /> {t('reports.machinePerformanceComparison')}
                    </div>
                  </div>
                </div>

                <Button
                  onClick={handleComparisonExport}
                  disabled={comparisonMutation.isPending}
                  className="w-full"
                >
                  {comparisonMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {t('reports.downloadPptx')}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ Custom ============ */}
          <TabsContent value="custom">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{t('reports.exportCustomPptx')}</CardTitle>
                <CardDescription>{t('reports.customPptxDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs">{t('reports.reportTitle')}</Label>
                  <Input
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder={t('reports.customReportPlaceholder')}
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label className="text-xs">{t('reports.addSlide')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { type: "kpi", icon: <Layout className="h-3 w-3" />, label: "KPI Dashboard" },
                      { type: "bar_chart", icon: <BarChart3 className="h-3 w-3" />, label: t('reports.barChart') },
                      { type: "line_chart", icon: <LineChart className="h-3 w-3" />, label: t('reports.lineChart') },
                      { type: "pie_chart", icon: <PieChart className="h-3 w-3" />, label: t('reports.pieChart') },
                      { type: "table", icon: <Table2 className="h-3 w-3" />, label: t('reports.dataTable') },
                    ].map((s) => (
                      <Button
                        key={s.type}
                        variant="outline"
                        size="sm"
                        onClick={() => addCustomSlide(s.type)}
                      >
                        {s.icon} <span className="ml-1">{s.label}</span>
                      </Button>
                    ))}
                  </div>
                </div>

                {customSlides.length > 0 && (
                  <div className="space-y-2 border rounded-lg p-3">
                    <div className="text-xs font-medium">{t('reports.slideList')} ({customSlides.length})</div>
                    {customSlides.map((slide, idx) => (
                      <div key={idx} className="flex items-center justify-between bg-muted/30 rounded p-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px]">{idx + 1}</Badge>
                          <span className="text-xs">{slide.title}</span>
                          <Badge variant="outline" className="text-[10px]">{slide.kpis.length} KPIs</Badge>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive"
                          onClick={() => removeCustomSlide(idx)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <Button
                  onClick={handleCustomExport}
                  disabled={customMutation.isPending || customSlides.length === 0}
                  className="w-full"
                >
                  {customMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <FileDown className="h-4 w-4 mr-2" />
                  )}
                  {t('reports.downloadPptxWithCount', { count: customSlides.length })}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

export default function PowerPointExport() {
  return (
    <DashboardLayout>
      <PowerPointExportContent />
    </DashboardLayout>
  );
}
