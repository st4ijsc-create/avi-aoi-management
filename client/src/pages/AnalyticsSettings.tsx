import { useAuth } from "@/_core/hooks/useAuth";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { navItems } from "@/lib/navigation";
import { ErrorBoundary } from "@/components/ErrorBoundary";

import {
  LineChart,
  Calendar,
  FileText,
  LayoutTemplate,
  Presentation,
  CalendarClock,
  Brain,
  Grid3X3,
  Shield,
  ClipboardCheck,
  GitCompareArrows,
  Tags,
  GitCompare,
  Sparkles,
  Search,
  ChevronDown,
  ChevronRight,
  Settings,
  BarChart3,
} from "lucide-react";

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";

// Import content components from existing pages
import { ScheduledReportsContent } from "@/pages/ScheduledReports";
import { SPCAdvancedContent } from "@/pages/SPCAdvanced";
import { CorrelationAnalysisContent } from "@/pages/CorrelationAnalysis";
import { QualityGatesContent } from "@/pages/QualityGates";
import { QualityGateTemplatesContent } from "@/pages/QualityGateTemplates";
import { AnnotationStatisticsContent } from "@/pages/AnnotationStatistics";
import { AnnotationComparisonPageContent } from "@/pages/AnnotationComparisonPage";
import { DefectPredictionPageContent } from "@/pages/DefectPredictionPage";
import { RootCauseAnalysisPageContent } from "@/pages/RootCauseAnalysisPage";
import { PdfReportsContent } from "@/pages/PdfReports";
import { DataComparisonContent } from "@/pages/DataComparison";
import { ReportBuilderContent } from "@/pages/ReportBuilder";
import { PowerPointExportContent } from "@/pages/PowerPointExport";
import { EnhancedScheduledReportsContent } from "@/pages/EnhancedScheduledReports";

export default function AnalyticsSettings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const search = useSearch();
  const [location, setLocation] = useLocation();

  const getTabFromUrl = () => {
    const params = new URLSearchParams(search);
    return params.get("tab") || "scheduled-reports";
  };

  const [activeTab, setActiveTab] = useState(getTabFromUrl);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setLocation(`/analytics-setting?tab=${tab}`);
  };

  useEffect(() => {
    const tabFromUrl = getTabFromUrl();
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [search]);

  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const toggleCategory = (category: string) => {
    setCollapsedCategories((prev) => ({ ...prev, [category]: !prev[category] }));
  };

  if (!isAdmin) {
    return (
      <DashboardLayout title={t("analyticsSettings.title")} navItems={navItems} currentPath="/analytics-setting">
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <LineChart className="h-16 w-16 text-muted-foreground/50" />
          <p className="text-xl font-medium text-foreground">{t("settings.adminOnlyAccess")}</p>
          <p className="text-muted-foreground">{t("settings.contactAdmin")}</p>
        </div>
      </DashboardLayout>
    );
  }

  const sidebarButton = (tab: string, icon: React.ReactNode, label: string) => (
    <button
      key={tab}
      onClick={() => handleTabChange(tab)}
      className={`w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors ${
        activeTab === tab ? "bg-primary text-primary-foreground" : "hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <DashboardLayout title={t("analyticsSettings.title")} navItems={navItems} currentPath="/analytics-setting">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Settings className="h-6 w-6 text-primary" />
              {t("analyticsSettings.title")}
            </h1>
            <p className="text-muted-foreground">{t("analyticsSettings.description")}</p>
          </div>
        </div>

        <ErrorBoundary>
          <Tabs value={activeTab} onValueChange={handleTabChange}>
            <div className="flex gap-6">
              {/* Vertical Sidebar Navigation */}
              <div className="w-64 shrink-0 space-y-1">

                {/* Category: Reports */}
                <div className="space-y-1">
                  <button
                    onClick={() => toggleCategory("reports")}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span>{t("analyticsSettings.cat.reports")}</span>
                    </div>
                    {collapsedCategories["reports"] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {!collapsedCategories["reports"] && (
                    <div className="ml-6 space-y-1">
                      {sidebarButton("scheduled-reports", <Calendar className="h-4 w-4" />, t("analyticsSettings.sidebar.scheduledReports"))}
                      {sidebarButton("pdf-reports", <FileText className="h-4 w-4" />, t("analyticsSettings.sidebar.pdfReports"))}
                      {sidebarButton("report-builder", <LayoutTemplate className="h-4 w-4" />, t("analyticsSettings.sidebar.reportBuilder"))}
                      {sidebarButton("powerpoint-export", <Presentation className="h-4 w-4" />, t("analyticsSettings.sidebar.powerpointExport"))}
                      {sidebarButton("enhanced-scheduled-reports", <CalendarClock className="h-4 w-4" />, t("analyticsSettings.sidebar.enhancedScheduledReports"))}
                    </div>
                  )}
                </div>

                {/* Category: SPC & Quality */}
                <div className="space-y-1">
                  <button
                    onClick={() => toggleCategory("spc")}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Brain className="h-4 w-4 text-purple-500" />
                      <span>{t("analyticsSettings.cat.spc")}</span>
                    </div>
                    {collapsedCategories["spc"] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {!collapsedCategories["spc"] && (
                    <div className="ml-6 space-y-1">
                      {sidebarButton("spc-advanced", <LineChart className="h-4 w-4" />, t("analyticsSettings.sidebar.spcAdvanced"))}
                      {sidebarButton("correlation-analysis", <Grid3X3 className="h-4 w-4" />, t("analyticsSettings.sidebar.correlationAnalysis"))}
                      {sidebarButton("quality-gates", <Shield className="h-4 w-4" />, t("analyticsSettings.sidebar.qualityGates"))}
                      {sidebarButton("quality-gate-templates", <ClipboardCheck className="h-4 w-4" />, t("analyticsSettings.sidebar.qualityGateTemplates"))}
                      {sidebarButton("data-comparison", <GitCompareArrows className="h-4 w-4" />, t("analyticsSettings.sidebar.dataComparison"))}
                    </div>
                  )}
                </div>

                {/* Category: Annotations */}
                <div className="space-y-1">
                  <button
                    onClick={() => toggleCategory("annotations")}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Tags className="h-4 w-4 text-orange-500" />
                      <span>{t("analyticsSettings.cat.annotations")}</span>
                    </div>
                    {collapsedCategories["annotations"] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {!collapsedCategories["annotations"] && (
                    <div className="ml-6 space-y-1">
                      {sidebarButton("annotation-statistics", <Tags className="h-4 w-4" />, t("analyticsSettings.sidebar.annotationStatistics"))}
                      {sidebarButton("annotation-comparison", <GitCompare className="h-4 w-4" />, t("analyticsSettings.sidebar.annotationComparison"))}
                    </div>
                  )}
                </div>

                {/* Category: Predictions */}
                <div className="space-y-1">
                  <button
                    onClick={() => toggleCategory("predictions")}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium rounded-md hover:bg-accent transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-500" />
                      <span>{t("analyticsSettings.cat.predictions")}</span>
                    </div>
                    {collapsedCategories["predictions"] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {!collapsedCategories["predictions"] && (
                    <div className="ml-6 space-y-1">
                      {sidebarButton("defect-prediction", <Sparkles className="h-4 w-4" />, t("analyticsSettings.sidebar.defectPrediction"))}
                      {sidebarButton("root-cause-analysis", <Search className="h-4 w-4" />, t("analyticsSettings.sidebar.rootCauseAnalysis"))}
                    </div>
                  )}
                </div>
              </div>

              {/* Content Area */}
              <div className="flex-1 min-w-0">
                <TabsContent value="scheduled-reports" className="mt-0">
                  <ErrorBoundary><ScheduledReportsContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="spc-advanced" className="mt-0">
                  <ErrorBoundary><SPCAdvancedContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="correlation-analysis" className="mt-0">
                  <ErrorBoundary><CorrelationAnalysisContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="quality-gates" className="mt-0">
                  <ErrorBoundary><QualityGatesContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="quality-gate-templates" className="mt-0">
                  <ErrorBoundary><QualityGateTemplatesContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="annotation-statistics" className="mt-0">
                  <ErrorBoundary><AnnotationStatisticsContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="annotation-comparison" className="mt-0">
                  <ErrorBoundary><AnnotationComparisonPageContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="defect-prediction" className="mt-0">
                  <ErrorBoundary><DefectPredictionPageContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="root-cause-analysis" className="mt-0">
                  <ErrorBoundary><RootCauseAnalysisPageContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="pdf-reports" className="mt-0">
                  <ErrorBoundary><PdfReportsContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="data-comparison" className="mt-0">
                  <ErrorBoundary><DataComparisonContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="report-builder" className="mt-0">
                  <ErrorBoundary><ReportBuilderContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="powerpoint-export" className="mt-0">
                  <ErrorBoundary><PowerPointExportContent /></ErrorBoundary>
                </TabsContent>
                <TabsContent value="enhanced-scheduled-reports" className="mt-0">
                  <ErrorBoundary><EnhancedScheduledReportsContent /></ErrorBoundary>
                </TabsContent>
              </div>
            </div>
          </Tabs>
        </ErrorBoundary>
      </div>
    </DashboardLayout>
  );
}
