import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation, Redirect } from "wouter";
import React, { Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AiCopilotProvider } from "./contexts/AiCopilotContext";
import { AILocalChatBubble } from "./components/AILocalChatBubble";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import InspectionDetail from "./pages/InspectionDetail";
import Layout from "./pages/Layout";
import Settings from "./pages/Settings";
import DataSettings from "./pages/DataSettings";
import ApiDocs from "./pages/ApiDocs";
import ProductModels from "./pages/ProductModels";
import CorporateLayout from "./pages/CorporateLayout";
import Reports from "./pages/Reports";
import Alerts from "./pages/Alerts";
import Users from "./pages/Users";
import ProductMachineMapping from "./pages/ProductMachineMapping";
import ProductionOrders from "./pages/ProductionOrders";
import MachineStatusMonitor from "./pages/MachineStatusMonitor";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import ChangePassword from "./pages/ChangePassword";
import AuditLogs from "./pages/AuditLogs";
import SessionManagement from "./pages/SessionManagement";
import ProductionSessionSignOff from "./pages/ProductionSessionSignOff";
import { ProductComparison } from "./pages/ProductComparison";
import Setup from "./pages/Setup";
import MqttDashboard from "./pages/MqttDashboard";
import MqttAlertRules from "./pages/MqttAlertRules";
import MqttClientManagement from "./pages/MqttClientManagement";
import MqttProfileManagement from "./pages/MqttProfileManagement";
import MqttTopicsMessages from "./pages/MqttTopicsMessages";
import CustomDashboard from "./pages/CustomDashboard";
import SystemConfiguration from "./pages/SystemConfiguration";
import ImportExport from "./pages/ImportExport";
import UserAssignments from "./pages/UserAssignments";
import ScheduledReports from "./pages/ScheduledReports";
import SPCAnalysis from "./pages/SPCAnalysis";
import ProcessManagement from "./pages/ProcessManagement";
import WorkstationManagement from "./pages/WorkstationManagement";
import CategoryAnalytics from "./pages/CategoryAnalytics";
import UserGuide from "./pages/UserGuide";
import AboutSystem from "./pages/AboutSystem";
import DashboardTemplates from "./pages/DashboardTemplates";
import BackupRestore from "./pages/BackupRestore";
import TemplateMarketplace from "./pages/TemplateMarketplace";
import OEEDashboard from "./pages/OEEDashboard";
import MQTTReplay from "./pages/MQTTReplay";
import OEETargetSettings from "./pages/OEETargetSettings";
import MachineHealthMonitoring from "./pages/MachineHealthMonitoring";
import MESControlTower from "./pages/MESControlTower";
import WipLineBalance from "./pages/WipLineBalance";
import TraceabilityLineage from "./pages/TraceabilityLineage";
import DigitalTwinDashboard from "./pages/DigitalTwinDashboard";
import RealtimeReportView from "./pages/RealtimeReportView";
import CarbonDashboard from "./pages/CarbonDashboard";
import DrillDownDashboard from "./pages/DrillDownDashboard";
import AnnotationStatistics from "./pages/AnnotationStatistics";
import AnnotationComparisonPage from "./pages/AnnotationComparisonPage";
import DefectHeatmapPage from "./pages/DefectHeatmapPage";
import DefectPredictionPage from "./pages/DefectPredictionPage";
import RootCauseAnalysisPage from "./pages/RootCauseAnalysisPage";
import PredictiveAlertsPage from "./pages/PredictiveAlertsPage";
import DashboardMarketplace from "./pages/DashboardMarketplace";
import HistoryExportScheduling from "./pages/HistoryExportScheduling";
import CorporateDashboard from "./pages/CorporateDashboard";
const AIPerformanceDashboard = React.lazy(() => import("./pages/AIPerformanceDashboard"));
const BatchInferencePage = React.lazy(() => import("./pages/BatchInferencePage"));
const ModelMonitoringPage = React.lazy(() => import("./pages/ModelMonitoringPage"));
const ModelVersionsPage = React.lazy(() => import("./pages/ModelVersionsPage"));
const AIHub = React.lazy(() => import("./pages/AIHub"));
const AIChatPage = React.lazy(() => import("./pages/AIChatPage"));
const AIQualityGatePage = React.lazy(() => import("./pages/AIQualityGatePage"));
const AIActiveLearningPage = React.lazy(() => import("./pages/AIActiveLearningPage"));
const AIImageSearchPage = React.lazy(() => import("./pages/AIImageSearchPage"));
const AIReportsPage = React.lazy(() => import("./pages/AIReportsPage"));
const AITimeSeriesPage = React.lazy(() => import("./pages/AITimeSeriesPage"));
const AISettingsPage = React.lazy(() => import("./pages/AISettingsPage"));
const AIDataProcessingPage = React.lazy(() => import("./pages/AIDataProcessingPage"));
const AIModelManagementPage = React.lazy(() => import("./pages/AIModelManagementPage"));
const AIInspectionAnalyticsPage = React.lazy(() => import("./pages/AIInspectionAnalyticsPage"));
const AdvancedVisionLabPage = React.lazy(() => import("./pages/AdvancedVisionLabPage"));
const AIGgufModelsPage = React.lazy(() => import("./pages/AIGgufModelsPage"));
const AILocalKnowledgeBasePage = React.lazy(() => import("./pages/AILocalKnowledgeBasePage"));
import TestAnnotationPage from "./pages/TestAnnotationPage";
const MaskAnnotationPage = React.lazy(() => import("./pages/MaskAnnotationPage"));
const AndonBoard = React.lazy(() => import("./pages/AndonBoard")); // F5a: Andon board (ALERT-ONLY)
import AOIPackages from "./pages/AOIPackages";
import MqttBulletin from "./pages/MqttBulletin";
import CorrelationAnalysis from "./pages/CorrelationAnalysis";
import QualityGates from "./pages/QualityGates";
import RoleBuilder from "./pages/RoleBuilder";
import EnhancedAuditLogs from "./pages/EnhancedAuditLogs";
import PdfReports from "./pages/PdfReports";
import DataComparison from "./pages/DataComparison";
import ReportBuilder from "./pages/ReportBuilder";
import PowerPointExport from "./pages/PowerPointExport";
import EnhancedScheduledReports from "./pages/EnhancedScheduledReports";
import ParetoAnalysis from "./pages/ParetoAnalysis";
import QualityGateTemplates from "./pages/QualityGateTemplates";
import ProductionScheduling from "./pages/ProductionScheduling";
import MachineRegistration from "./pages/MachineRegistration";
import MachineOnboardingWizard from "./pages/MachineOnboardingWizard";
import CorporateManagement from "./pages/CorporateManagement";
import LicenseManagement from "./pages/LicenseManagement";
import MqttNgRateThreshold from "./pages/MqttNgRateThreshold";
import MonitoringSettings from "./pages/MonitoringSettings";
import AnalyticsSettings from "./pages/AnalyticsSettings";
import AdminSettings from "./pages/AdminSettings";
import DashboardCenter from "./pages/DashboardCenter";
import ProductionDashboard from "./pages/ProductionDashboard";
import StationAnalysis from "./pages/StationAnalysis";

function AIPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary variant="compact">
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function RedirectToAdminSetting() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/admin-setting", { replace: true }); }, []);
  return null;
}

function RedirectToCategoryAnalytics() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/category-analytics", { replace: true }); }, []);
  return null;
}

function RedirectToAIInspectionAnalytics() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/ai-inspection-analytics", { replace: true }); }, []);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/setup" component={Setup} />
      <Route path="/login" component={Login} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/andon" component={AndonBoard} />
      <Route path="/history" component={History} />
      <Route path="/inspection/:id" component={InspectionDetail} />
      <Route path="/layout" component={Layout} />
      <Route path="/layout/:id" component={Layout} />
      <Route path="/settings" component={Settings} />
      <Route path="/datasettings" component={DataSettings} />
      <Route path="/admin" component={RedirectToAdminSetting} />
      <Route path="/analytics" component={RedirectToCategoryAnalytics} />
      <Route path="/ai-analytics" component={RedirectToAIInspectionAnalytics} />
      <Route path="/dashboard-center" component={DashboardCenter} />
      <Route path="/api-docs" component={ApiDocs} />
      <Route path="/products" component={ProductModels} />
      <Route path="/corporate-layout" component={CorporateLayout} />
      <Route path="/corporate-dashboard" component={CorporateDashboard} />
      <Route path="/corporate-management" component={CorporateManagement} />
      <Route path="/reports" component={Reports} />
      <Route path="/alerts" component={Alerts} />
      <Route path="/users" component={Users} />
      <Route path="/product-mapping" component={ProductMachineMapping} />
      <Route path="/production-orders" component={ProductionOrders} />
      <Route path="/machine-status" component={MachineStatusMonitor} />
      <Route path="/profile" component={Profile} />
      <Route path="/change-password" component={ChangePassword} />
      <Route path="/audit-logs" component={AuditLogs} />
      <Route path="/sessions" component={SessionManagement} />
      <Route path="/production-signoff" component={ProductionSessionSignOff} />
      <Route path="/product-comparison" component={ProductComparison} />
      <Route path="/mqtt-dashboard" component={MqttDashboard} />
      <Route path="/mqtt-alerts" component={MqttAlertRules} />
      <Route path="/mqtt-clients" component={MqttClientManagement} />
      <Route path="/mqtt-profiles" component={MqttProfileManagement} />
      <Route path="/mqtt-topics" component={MqttTopicsMessages} />
      <Route path="/custom-dashboard" component={CustomDashboard} />
      <Route path="/system-config" component={SystemConfiguration} />
      <Route path="/import-export" component={ImportExport} />
      <Route path="/user-assignments" component={UserAssignments} />
      <Route path="/scheduled-reports" component={ScheduledReports} />
      <Route path="/spc-analysis" component={SPCAnalysis} />
      <Route path="/process-management" component={ProcessManagement} />
      <Route path="/workstation-management" component={WorkstationManagement} />
      <Route path="/category-analytics" component={CategoryAnalytics} />
      <Route path="/user-guide" component={UserGuide} />
      <Route path="/about-system" component={AboutSystem} />
      <Route path="/dashboard-templates" component={DashboardTemplates} />
      <Route path="/backup-restore" component={BackupRestore} />
      <Route path="/template-marketplace" component={TemplateMarketplace} />
      <Route path="/oee-dashboard" component={OEEDashboard} />
      <Route path="/mqtt-replay" component={MQTTReplay} />
      <Route path="/oee-target-settings" component={OEETargetSettings} />
      <Route path="/machine-health" component={MachineHealthMonitoring} />
      <Route path="/mes-control-tower" component={MESControlTower} />
      <Route path="/wip-dashboard" component={WipLineBalance} />
      <Route path="/traceability" component={TraceabilityLineage} />
      <Route path="/digital-twin" component={DigitalTwinDashboard} />
      <Route path="/realtime-report" component={RealtimeReportView} />
      <Route path="/carbon-dashboard" component={CarbonDashboard} />
      <Route path="/drill-down" component={DrillDownDashboard} />
      <Route path="/annotation-statistics" component={AnnotationStatistics} />
      <Route path="/annotation-comparison" component={AnnotationComparisonPage} />
      <Route path="/defect-heatmap" component={DefectHeatmapPage} />
      <Route path="/defect-prediction" component={DefectPredictionPage} />
      <Route path="/root-cause-analysis" component={RootCauseAnalysisPage} />
      <Route path="/predictive-alerts" component={PredictiveAlertsPage} />
      <Route path="/dashboard-marketplace" component={DashboardMarketplace} />
      <Route path="/history-export-scheduling" component={HistoryExportScheduling} />
      <Route path="/ai-hub"><AIPageWrapper><AIHub /></AIPageWrapper></Route>
      <Route path="/ai-chat"><AIPageWrapper><AIChatPage /></AIPageWrapper></Route>
      <Route path="/ai-quality-gate"><AIPageWrapper><AIQualityGatePage /></AIPageWrapper></Route>
      <Route path="/ai-active-learning"><AIPageWrapper><AIActiveLearningPage /></AIPageWrapper></Route>
      <Route path="/ai-image-search"><AIPageWrapper><AIImageSearchPage /></AIPageWrapper></Route>
      <Route path="/ai-reports"><AIPageWrapper><AIReportsPage /></AIPageWrapper></Route>
      <Route path="/ai-time-series"><AIPageWrapper><AITimeSeriesPage /></AIPageWrapper></Route>
      <Route path="/ai-performance"><AIPageWrapper><AIPerformanceDashboard /></AIPageWrapper></Route>
      <Route path="/ai-batch-jobs"><AIPageWrapper><BatchInferencePage /></AIPageWrapper></Route>
      {/* X3: /ai-ab-testing was a deprecated stub. The live A/B feature is the
          B6 canary tab in the AI Performance Dashboard — redirect there. */}
      <Route path="/ai-ab-testing"><Redirect to="/ai-performance" /></Route>
      <Route path="/ai-monitoring"><AIPageWrapper><ModelMonitoringPage /></AIPageWrapper></Route>
      <Route path="/ai-models"><AIPageWrapper><AIModelManagementPage /></AIPageWrapper></Route>
      <Route path="/model-versions"><AIPageWrapper><ModelVersionsPage /></AIPageWrapper></Route>
      <Route path="/ai-settings"><AIPageWrapper><AISettingsPage /></AIPageWrapper></Route>
      <Route path="/ai-data-processing"><AIPageWrapper><AIDataProcessingPage /></AIPageWrapper></Route>
      <Route path="/ai-inspection-analytics"><AIPageWrapper><AIInspectionAnalyticsPage /></AIPageWrapper></Route>
      <Route path="/ai-advanced-vision-lab"><AIPageWrapper><AdvancedVisionLabPage /></AIPageWrapper></Route>
      <Route path="/ai-gguf-models"><AIPageWrapper><AIGgufModelsPage /></AIPageWrapper></Route>
      <Route path="/ai-local-kb"><AIPageWrapper><AILocalKnowledgeBasePage /></AIPageWrapper></Route>
      <Route path="/test-annotation" component={TestAnnotationPage} />
      <Route path="/mask-annotation"><AIPageWrapper><MaskAnnotationPage /></AIPageWrapper></Route>
      <Route path="/aoi-packages" component={AOIPackages} />
      <Route path="/mqtt-bulletin" component={MqttBulletin} />
      {/* /spc-advanced consolidated into /spc-analysis (redirect for backward-compat) */}
      <Route path="/spc-advanced"><Redirect to="/spc-analysis" /></Route>
      <Route path="/correlation-analysis" component={CorrelationAnalysis} />
      <Route path="/quality-gates" component={QualityGates} />
      <Route path="/role-builder" component={RoleBuilder} />
      <Route path="/enhanced-audit" component={EnhancedAuditLogs} />
      <Route path="/pdf-reports" component={PdfReports} />
      <Route path="/data-comparison" component={DataComparison} />
      <Route path="/report-builder" component={ReportBuilder} />
      <Route path="/powerpoint-export" component={PowerPointExport} />
      <Route path="/enhanced-scheduled-reports" component={EnhancedScheduledReports} />
      <Route path="/pareto-analysis" component={ParetoAnalysis} />
      <Route path="/quality-gate-templates" component={QualityGateTemplates} />
      <Route path="/production-scheduling" component={ProductionScheduling} />
      <Route path="/machine-registration" component={MachineRegistration} />
      <Route path="/machine-onboarding" component={MachineOnboardingWizard} />
      <Route path="/license" component={LicenseManagement} />
      <Route path="/mqtt-ng-rate" component={MqttNgRateThreshold} />
      <Route path="/monitoring-setting" component={MonitoringSettings} />
      <Route path="/analytics-setting" component={AnalyticsSettings} />
      <Route path="/admin-setting" component={AdminSettings} />
      <Route path="/production-dashboard" component={ProductionDashboard} />
      <Route path="/station-analysis/:id" component={StationAnalysis} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        <TooltipProvider>
          <AiCopilotProvider>
            <Toaster />
            <Router />
            {/* C3a — global copilot bubble: mounted ONCE here (inside the tRPC
                provider from main.tsx) so it appears on every route, including
                lazy AI pages. The bubble hides itself when not logged in. */}
            <AILocalChatBubble />
          </AiCopilotProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
