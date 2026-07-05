import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation, Redirect } from "wouter";
import React, { Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SiteProvider } from "./contexts/SiteContext";
import { AiCopilotProvider } from "./contexts/AiCopilotContext";
import { EngineeringProvider } from "./contexts/EngineeringContext";
import { AILocalChatBubble } from "./components/AILocalChatBubble";
import { ConnectionBanner } from "./components/ConnectionBanner";
import { RouteGuard } from "./components/RouteGuard";
import { useKioskMode } from "./hooks/useKioskMode";
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
import SystemConfiguration from "./pages/SystemConfiguration";
import ImportExport from "./pages/ImportExport";
import UserAssignments from "./pages/UserAssignments";
import ScheduledReports from "./pages/ScheduledReports";
import ProcessManagement from "./pages/ProcessManagement";
import WorkstationManagement from "./pages/WorkstationManagement";
import CategoryAnalytics from "./pages/CategoryAnalytics";
import UserGuide from "./pages/UserGuide";
import AboutSystem from "./pages/AboutSystem";
import BackupRestore from "./pages/BackupRestore";
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
import DefectHeatmapPage from "./pages/DefectHeatmapPage";
import DefectPredictionPage from "./pages/DefectPredictionPage";
import RootCauseAnalysisPage from "./pages/RootCauseAnalysisPage";
const CausalGraphEditorPage = React.lazy(() => import("./pages/CausalGraphEditorPage")); // Causal knowledge-graph admin editor (validated atomic write)
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
const EnergyAnalyticsPage = React.lazy(() => import("./pages/EnergyAnalyticsPage")); // G2.6b: energy analytics (READ/ANALYTICS only)
const AISettingsPage = React.lazy(() => import("./pages/AISettingsPage"));
const AIDataProcessingPage = React.lazy(() => import("./pages/AIDataProcessingPage"));
const AIModelManagementPage = React.lazy(() => import("./pages/AIModelManagementPage"));
const AIInspectionAnalyticsPage = React.lazy(() => import("./pages/AIInspectionAnalyticsPage"));
const AdvancedVisionLabPage = React.lazy(() => import("./pages/AdvancedVisionLabPage"));
const AIGgufModelsPage = React.lazy(() => import("./pages/AIGgufModelsPage"));
const AIBrainDashboard = React.lazy(() => import("./pages/AIBrainDashboard"));
const ManagementInsight = React.lazy(() => import("./pages/ManagementInsight")); // B4.5: manager-facing insight (NL Q&A + exec summary + AI alerts)
const AILocalKnowledgeBasePage = React.lazy(() => import("./pages/AILocalKnowledgeBasePage"));
const TechnicianCopilot = React.lazy(() => import("./pages/TechnicianCopilot")); // LUỒNG ③: RCA Copilot — one-tap fix approval
const OperatorHome = React.lazy(() => import("./pages/OperatorHome")); // Role landing: simplified big-button floor operator shell
const QualityHome = React.lazy(() => import("./pages/QualityHome")); // Role landing: quality_inspector inspection workspace (P1 doc 07 §④)
const GoldenSamplesPage = React.lazy(() => import("./pages/GoldenSamplesPage")); // W7-C (doc 27 V8/V11): golden-sample capture + approval + align/diff management
const RepairStation = React.lazy(() => import("./pages/RepairStation")); // W8-C (doc 27 V10): dedicated repair workstation (scan serial → repair walk → re-inspect; ?kiosk=1)
const DefectCatalogPage = React.lazy(() => import("./pages/DefectCatalogPage")); // Doc 31 Đợt B (OP4): IPC-A-610 defect catalog curation + unmatched-code + repair guidance
const MeasurementPointHealthPage = React.lazy(() => import("./pages/MeasurementPointHealthPage")); // Doc 31 Đợt B (MP3): __UNMAPPED__ unmatched-rate metric + bulk remap
const MaintenanceHome = React.lazy(() => import("./pages/MaintenanceHome")); // F1 (doc 23): maintenance/technician workspace front door (role landing)
const MaskAnnotationPage = React.lazy(() => import("./pages/MaskAnnotationPage"));
const OpsConsole = React.lazy(() => import("./pages/OpsConsole")); // P1 (doc 12 §8): unified Ops Console / War-Room (consolidates Andon + Predictive + alert sources)
const DeviceAdapterManagement = React.lazy(() => import("./pages/DeviceAdapterManagement")); // G2.2a: OT adapter/tag CONFIG
const UnsMappingDesigner = React.lazy(() => import("./pages/UnsMappingDesigner")); // Doc 24 (Connectivity): no-code Tag → UNS mapping designer (CONFIG + live preview)
const SystemHealth = React.lazy(() => import("./pages/SystemHealth")); // Tier-1b (doc 24): OT store-and-forward + connection HA supervisors + DINOv2 model health + commissioning + twin export
const RecipeManagement = React.lazy(() => import("./pages/RecipeManagement")); // G2.2b: recipe catalog + deploy ledger (CONFIG/VIEW)
const InterlockRuleManagement = React.lazy(() => import("./pages/InterlockRuleManagement")); // G2.2b: interlock rule admin (CONFIG/VIEW)
const BomManagement = React.lazy(() => import("./pages/BomManagement")); // G2.4: BOM + Feeder + component genealogy (data/telemetry/trace)
const MasterDataManagement = React.lazy(() => import("./pages/MasterDataManagement")); // Doc 07 §③: MES/MOM master data (supplier/material/customer/skill/tool)
const OperatorBadges = React.lazy(() => import("./pages/OperatorBadges")); // W8-B (doc 29 §3): operator/badge master — badgeCode → users.id with validity windows
const ComponentLibrary = React.lazy(() => import("./pages/ComponentLibrary")); // W8-A (doc 27 M12a / doc 29 §1): component package/footprint master + material links
const WorkOrdersPage = React.lazy(() => import("./pages/WorkOrdersPage")); // Maintenance work-order CRUD + CLOSE→MTTR (machine_monitoring)
const ThresholdApprovalsPage = React.lazy(() => import("./pages/ThresholdApprovalsPage")); // Threshold approval review queue (approve/reject/withdraw)
const AnomalyBankPage = React.lazy(() => import("./pages/AnomalyBankPage")); // Anomaly memory bank management (rebuild/delete per scope, admin)
const OrchestrationStudio = React.lazy(() => import("./pages/OrchestrationStudio")); // E3b: visual orchestration studio (author → simulate → deploy/run)
const EngineeringHub = React.lazy(() => import("./pages/EngineeringHub")); // W6-26 (doc 25 T8): Engineering hub-and-spoke front door (task-grouped tiles + golden-thread)
const EngineeringWorkspace = React.lazy(() => import("./pages/EngineeringWorkspace")); // Doc 09 D1: Unified Engineering Workspace (author/build/simulate/deploy device programs)
const IrEditor = React.lazy(() => import("./pages/IrEditor")); // D1 (doc 16 §11.1 Khối 6): Visual IR Editor — author motion/IO blocks, lint + transpile preview (mutations gated by DPC_IR_V2_ENABLED)
const PouStudio = React.lazy(() => import("./pages/PouStudio")); // P4 (doc 24 Wave-3): IEC 61131 POU Studio — structured LAD/FBD/SFC + PLCopen XML round-trip + transpile-to-ST (pure preview, open runtime only)
const ProgrammingCopilot = React.lazy(() => import("./pages/ProgrammingCopilot")); // Doc 34 P3: in-app Programming Copilot — LLM codegen (generate/complete/translate/review/explain), validated by the safety substrate; advisory + display-only
const SupervisorHome = React.lazy(() => import("./pages/SupervisorHome")); // Doc 10 U1: supervisor/manager briefing landing
const ViewerHome = React.lazy(() => import("./pages/ViewerHome")); // Doc 10 U3: viewer/user read-only landing
const AdminHome = React.lazy(() => import("./pages/AdminHome")); // Doc 10 U5: admin governance briefing landing
const RequestRole = React.lazy(() => import("./pages/RequestRole")); // Doc 10 U12: request a higher role
const RfTestCellSim = React.lazy(() => import("./pages/RfTestCellSim")); // Realtime digital-twin playback of an RF shielded test cell (feeder XYZ + robot + RF tester)
const FactoryLiveMap3D = React.lazy(() => import("./pages/FactoryLiveMap3D")); // L4 plant view: 3D factory floor, machines coloured by live status, drill-down
const FactoryFloorEditor = React.lazy(() => import("./pages/FactoryFloorEditor")); // 2D drag editor: set real floor-plan coords (layoutPositionX/Y) the 3D view reads
const CellTwinPlayer = React.lazy(() => import("./pages/CellTwinPlayer")); // Generic data-driven realtime twin playback for ANY orchestration workflow
const DigitalTwinCenter = React.lazy(() => import("./pages/DigitalTwinCenter")); // T1 (doc 16 Khối 7): 3D Digital Twin Center — scene-graph + glTF + live deltas + replay (TWIN_LIVE_ENABLED)
const CommandCenter = React.lazy(() => import("./pages/CommandCenter")); // U2 (doc 21 §6 G-3): Ecosystem Command Center — single pane (hierarchy tree + factory twin + KPI strip + unified live alarm rail)
const MachineCockpit = React.lazy(() => import("./pages/MachineCockpit")); // U3 (doc 21 §6 G-4): /machine/:id unified per-machine cockpit (tabbed: overview/health/oee/alarms/recipes/programs/genealogy/3d/actions)
const RobotCockpit = React.lazy(() => import("./pages/RobotCockpit")); // U3 (doc 21 §6 G-4/G-5): /robot/:id unified per-robot cockpit (LIVE robot:telemetry; tabbed overview/joints/jobs/tasks/programs/safety/anomalies/alarms/3d/teach/actions)
const ApiKeysPage = React.lazy(() => import("./pages/ApiKeysPage")); // Control plane: scoped API-key admin CRUD (create-show-once)
const SitesRegistry = React.lazy(() => import("./pages/SitesRegistry")); // Doc 13 / F0: Multi-site Federation sites registry (admin)
const FederationDashboard = React.lazy(() => import("./pages/FederationDashboard")); // Doc 13 / F2: cross-site federation roll-up (admin)
const ModulesMarketplace = React.lazy(() => import("./pages/ModulesMarketplace")); // Doc 13 / F3: read-only modules + license marketplace (admin)
const EdgeNodesPage = React.lazy(() => import("./pages/EdgeNodesPage")); // E4: edge node registry management
const HotFolderConfigPage = React.lazy(() => import("./pages/HotFolderConfigPage")); // Doc 27 C1 (W2-A): AOI/AVI hot-folder file-drop ingestion config + status + dry-run
const UnifiedDeviceMonitor = React.lazy(() => import("./pages/UnifiedDeviceMonitor")); // P3-W2 (doc 12 §8): flagship unified device monitor — default DEVICES & OT landing
const RobotControl = React.lazy(() => import("./pages/RobotControl")); // P4-D: robot/AGV registry + telemetry + job log (read-mostly; motion via internal HITL dispatcher)
const FleetOrchestration = React.lazy(() => import("./pages/FleetOrchestration")); // G1 (doc 16 §7 Khối 2): fleet task allocation + zone traffic (read-mostly; mutations gated by FLEET_ORCH_ENABLED)
const ControlPlane = React.lazy(() => import("./pages/ControlPlane")); // P4-D: Factory Control Plane (equipment capability/PackML + FOE + edge runtime, read-only projections)
const SafetyWorkforce = React.lazy(() => import("./pages/SafetyWorkforce")); // S1 (doc 16 §8): advisory safety monitoring + mixed-workforce board + human↔robot handover (read-mostly; mutations gated by SAFETY_AUDIT_ENABLED / WORKFORCE_ENABLED)
const RobotModelHealth = React.lazy(() => import("./pages/RobotModelHealth")); // I2 (doc 16 §9 Khối 4): advisory robot-behaviour anomaly + AI model rollback audit (read-mostly; mutations gated by AI_ROBOT_ANOMALY_ENABLED / AI_MODEL_AUTOROLLBACK_ENABLED)
const EquipmentStandards = React.lazy(() => import("./pages/EquipmentStandards")); // E1 (doc 16 §10 Khối 5): device-type hierarchy + ISA-18.2 alarm taxonomy + Equipment Standards Board (governance metadata only; mutations gated by EQ_GOVERN_ENABLED)
const EquipmentIntegration = React.lazy(() => import("./pages/EquipmentIntegration")); // I1 (doc 16 §6 Khối 1B): FOCAS/Euromap integration frameworks (read-only) + recipe versioning genealogy (mutations gated by EQ_INTEG_ENABLED)
const FieldDevices = React.lazy(() => import("./pages/FieldDevices")); // X1 (doc 16 §5 Khối 1): Field & device abstraction — UDM state/liveness board + hot-plug discovery (mutations gated by FIELD_V2_ENABLED)
const QualityCockpit = React.lazy(() => import("./pages/QualityCockpit")); // P3-W2 (doc 12 §8): flagship Quality Cockpit (SPC/Pareto/Heatmap/Gates/Annotation tabs)
const InboxPage = React.lazy(() => import("./pages/InboxPage")); // P3-W2: full-screen Action Inbox route (read-open)
const TodayPage = React.lazy(() => import("./pages/TodayPage")); // P3-W2: full-screen Today Briefing route (read-open)
const AndonBoard = React.lazy(() => import("./pages/AndonBoard")); // W5-C (doc 27 F7): dedicated Andon/TV wall board (huge type, auto-cycle, socket-first + poll fallback)
import AOIPackages from "./pages/AOIPackages";
import MqttBulletin from "./pages/MqttBulletin";
import CorrelationAnalysis from "./pages/CorrelationAnalysis";
import RoleBuilder from "./pages/RoleBuilder";
import PdfReports from "./pages/PdfReports";
import DataComparison from "./pages/DataComparison";
import ReportBuilder from "./pages/ReportBuilder";
import PowerPointExport from "./pages/PowerPointExport";
import QualityGateTemplates from "./pages/QualityGateTemplates";
import ProductionScheduling from "./pages/ProductionScheduling";
import MachineRegistration from "./pages/MachineRegistration";
import MachineOnboardingWizard from "./pages/MachineOnboardingWizard";
const AoiOnboardingWizard = React.lazy(() => import("./pages/AoiOnboardingWizard")); // W2-D (doc 27 §3 C4): guided AOI/AVI connection wizard — vendor adapter + dry-run + credential + commissioning sign-off (soft gate)
const ProductOnboardingWizard = React.lazy(() => import("./pages/ProductOnboardingWizard")); // WD-1 (doc 31 Đợt D · UX1): product-side onboarding wizard — resumable guided setup (fiducials/points/limits/golden/panel/release/mapping)
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

function RedirectToAdminHome() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/admin-home", { replace: true }); }, []);
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
      {/* ── Public routes (no guard) ────────────────────────────────────── */}
      <Route path="/" component={Home} />
      <Route path="/setup" component={Setup} />
      <Route path="/login" component={Login} />
      <Route path="/api-docs" component={ApiDocs} />

      {/* ── OVERVIEW ─────────────────────────────────────────────────────── */}
      <Route path="/dashboard"><RouteGuard navHref="/dashboard"><Dashboard /></RouteGuard></Route>
      {/* P1 consolidation: Andon + Predictive Alerts merged into the unified Ops Console. */}
      <Route path="/ops-console"><RouteGuard navHref="/ops-console"><AIPageWrapper><OpsConsole /></AIPageWrapper></RouteGuard></Route>
      {/* W5-C (doc 27 F7): /andon is now the dedicated TV board (was a redirect to /ops-console). */}
      <Route path="/andon"><RouteGuard navHref="/andon"><AIPageWrapper><AndonBoard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/predictive-alerts"><Redirect to="/ops-console" /></Route>
      <Route path="/dashboard-center"><RouteGuard navHref="/dashboard-center"><DashboardCenter /></RouteGuard></Route>
      <Route path="/drill-down"><RouteGuard navHref="/drill-down"><DrillDownDashboard /></RouteGuard></Route>
      <Route path="/corporate-dashboard"><RouteGuard navHref="/corporate-dashboard"><CorporateDashboard /></RouteGuard></Route>
      <Route path="/corporate-layout"><RouteGuard requirePermission="dashboard_corporate"><CorporateLayout /></RouteGuard></Route>

      {/* ── PRODUCTION ───────────────────────────────────────────────────── */}
      <Route path="/production-dashboard"><RouteGuard navHref="/production-dashboard"><ProductionDashboard /></RouteGuard></Route>
      <Route path="/mes-control-tower"><RouteGuard navHref="/mes-control-tower"><MESControlTower /></RouteGuard></Route>
      <Route path="/wip-dashboard"><RouteGuard navHref="/wip-dashboard"><WipLineBalance /></RouteGuard></Route>
      <Route path="/traceability"><RouteGuard navHref="/traceability"><TraceabilityLineage /></RouteGuard></Route>
      <Route path="/digital-twin"><RouteGuard navHref="/digital-twin"><DigitalTwinDashboard /></RouteGuard></Route>
      <Route path="/history"><RouteGuard navHref="/history"><History /></RouteGuard></Route>
      <Route path="/inspection/:id"><RouteGuard requirePermission="history_view"><InspectionDetail /></RouteGuard></Route>
      <Route path="/aoi-packages"><RouteGuard navHref="/aoi-packages"><AOIPackages /></RouteGuard></Route>
      <Route path="/production-orders"><RouteGuard navHref="/production-orders"><ProductionOrders /></RouteGuard></Route>
      <Route path="/production-scheduling"><RouteGuard navHref="/production-scheduling"><ProductionScheduling /></RouteGuard></Route>
      <Route path="/production-signoff"><RouteGuard navHref="/production-signoff"><ProductionSessionSignOff /></RouteGuard></Route>
      <Route path="/history-export-scheduling"><RouteGuard navHref="/history-export-scheduling"><HistoryExportScheduling /></RouteGuard></Route>
      <Route path="/bom-management"><RouteGuard navHref="/bom-management"><BomManagement /></RouteGuard></Route>
      <Route path="/product-comparison"><RouteGuard requirePermission="history_view"><ProductComparison /></RouteGuard></Route>
      <Route path="/station-analysis/:id"><RouteGuard requirePermission="analytics_spc"><StationAnalysis /></RouteGuard></Route>

      {/* ── QUALITY ──────────────────────────────────────────────────────── */}
      {/* P3-W2: Quality Cockpit is the default QUALITY landing (SPC/Pareto/Heatmap/Gates/Annotation tabs). */}
      <Route path="/quality-cockpit"><RouteGuard navHref="/quality-cockpit"><AIPageWrapper><QualityCockpit /></AIPageWrapper></RouteGuard></Route>
      <Route path="/quality-home"><RouteGuard navHref="/quality-home"><AIPageWrapper><QualityHome /></AIPageWrapper></RouteGuard></Route>
      <Route path="/golden-samples"><RouteGuard navHref="/golden-samples"><GoldenSamplesPage /></RouteGuard></Route>
      {/* Doc 31 Đợt B (OP4/OP3): defect catalog curation + unmatched defect codes. */}
      <Route path="/defect-catalog"><RouteGuard navHref="/defect-catalog"><DefectCatalogPage /></RouteGuard></Route>
      {/* Doc 31 Đợt B (MP3): __UNMAPPED__ measurement-point mapping health + bulk remap. */}
      <Route path="/measurement-point-health"><RouteGuard navHref="/measurement-point-health"><MeasurementPointHealthPage /></RouteGuard></Route>
      {/* W8-C (doc 27 V10): dedicated repair workstation — scan serial, one-tap repair walk (?kiosk=1 friendly). */}
      <Route path="/repair-station"><RouteGuard navHref="/repair-station"><AIPageWrapper><RepairStation /></AIPageWrapper></RouteGuard></Route>
      <Route path="/quality-gate-templates"><RouteGuard navHref="/quality-gate-templates"><QualityGateTemplates /></RouteGuard></Route>
      {/* P3-W2 consolidation: legacy quality screens now live as Cockpit tabs (deep-link ?tab=). */}
      <Route path="/quality-gates"><Redirect to="/quality-cockpit?tab=gates" /></Route>
      <Route path="/spc-analysis"><Redirect to="/quality-cockpit?tab=spc" /></Route>
      {/* /spc-advanced previously consolidated into /spc-analysis → now the cockpit SPC tab. */}
      <Route path="/spc-advanced"><Redirect to="/quality-cockpit?tab=spc" /></Route>
      <Route path="/pareto-analysis"><Redirect to="/quality-cockpit?tab=pareto" /></Route>
      <Route path="/annotation-statistics"><Redirect to="/quality-cockpit?tab=annotation" /></Route>
      <Route path="/annotation-comparison"><Redirect to="/quality-cockpit?tab=annotation" /></Route>
      {/* KEEP — factory-layout defect heatmap (different concept from the cockpit product heatmap). */}
      <Route path="/defect-heatmap"><RouteGuard navHref="/defect-heatmap"><DefectHeatmapPage /></RouteGuard></Route>
      <Route path="/defect-prediction"><RouteGuard requirePermission="analytics_advanced"><DefectPredictionPage /></RouteGuard></Route>
      <Route path="/root-cause-analysis"><RouteGuard requirePermission="analytics_root_cause"><RootCauseAnalysisPage /></RouteGuard></Route>

      {/* ── DEVICES & OT ─────────────────────────────────────────────────── */}
      {/* P3-W2: unified Device Monitor is the default device landing. */}
      <Route path="/device-monitor"><RouteGuard navHref="/device-monitor"><AIPageWrapper><UnifiedDeviceMonitor /></AIPageWrapper></RouteGuard></Route>
      {/* P3-W2 consolidation: legacy machine-status grid → unified Device Monitor. */}
      <Route path="/machine-status"><Redirect to="/device-monitor" /></Route>
      <Route path="/machine-health"><RouteGuard navHref="/machine-health"><MachineHealthMonitoring /></RouteGuard></Route>
      <Route path="/oee-dashboard"><RouteGuard navHref="/oee-dashboard"><OEEDashboard /></RouteGuard></Route>
      <Route path="/factory-live-map"><RouteGuard navHref="/factory-live-map"><AIPageWrapper><FactoryLiveMap3D /></AIPageWrapper></RouteGuard></Route>
      <Route path="/field-devices"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><FieldDevices /></AIPageWrapper></RouteGuard></Route>
      <Route path="/mqtt-dashboard"><RouteGuard navHref="/mqtt-dashboard"><MqttDashboard /></RouteGuard></Route>
      <Route path="/mqtt-bulletin"><RouteGuard navHref="/mqtt-bulletin"><MqttBulletin /></RouteGuard></Route>
      <Route path="/mqtt-replay"><RouteGuard navHref="/mqtt-replay"><MQTTReplay /></RouteGuard></Route>
      <Route path="/mqtt-clients"><RouteGuard navHref="/mqtt-clients"><MqttClientManagement /></RouteGuard></Route>
      <Route path="/mqtt-alerts"><RouteGuard navHref="/mqtt-alerts"><MqttAlertRules /></RouteGuard></Route>
      <Route path="/mqtt-profiles"><RouteGuard requireRole={["admin"]} requirePermission="mqtt_monitoring"><MqttProfileManagement /></RouteGuard></Route>
      <Route path="/mqtt-topics"><RouteGuard requirePermission="mqtt_monitoring"><MqttTopicsMessages /></RouteGuard></Route>
      <Route path="/mqtt-ng-rate"><RouteGuard requirePermission="mqtt_alerts"><MqttNgRateThreshold /></RouteGuard></Route>
      <Route path="/machine-onboarding"><RouteGuard navHref="/machine-onboarding"><MachineOnboardingWizard /></RouteGuard></Route>
      <Route path="/aoi-onboarding"><RouteGuard navHref="/aoi-onboarding"><AIPageWrapper><AoiOnboardingWizard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/product-onboarding"><RouteGuard navHref="/product-onboarding"><AIPageWrapper><ProductOnboardingWizard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/machine-registration"><RouteGuard navHref="/machine-registration"><MachineRegistration /></RouteGuard></Route>
      <Route path="/device-adapters"><RouteGuard navHref="/device-adapters"><DeviceAdapterManagement /></RouteGuard></Route>
      <Route path="/uns-mapping"><RouteGuard navHref="/uns-mapping"><UnsMappingDesigner /></RouteGuard></Route>
      <Route path="/system-health"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><SystemHealth /></AIPageWrapper></RouteGuard></Route>
      <Route path="/edge-nodes"><RouteGuard navHref="/edge-nodes"><AIPageWrapper><EdgeNodesPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/hot-folders"><RouteGuard navHref="/hot-folders"><AIPageWrapper><HotFolderConfigPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/robot-control"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><RobotControl /></AIPageWrapper></RouteGuard></Route>
      <Route path="/fleet-orchestration"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><FleetOrchestration /></AIPageWrapper></RouteGuard></Route>
      <Route path="/control-plane"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><ControlPlane /></AIPageWrapper></RouteGuard></Route>
      <Route path="/safety-workforce"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><SafetyWorkforce /></AIPageWrapper></RouteGuard></Route>
      <Route path="/robot-model-health"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><RobotModelHealth /></AIPageWrapper></RouteGuard></Route>
      <Route path="/equipment-standards"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><EquipmentStandards /></AIPageWrapper></RouteGuard></Route>
      <Route path="/equipment-integration"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><EquipmentIntegration /></AIPageWrapper></RouteGuard></Route>
      <Route path="/engineering-home"><RouteGuard navHref="/engineering-home"><EngineeringHub /></RouteGuard></Route>
      <Route path="/engineering"><RouteGuard navHref="/engineering"><EngineeringWorkspace /></RouteGuard></Route>
      <Route path="/recipes"><RouteGuard navHref="/recipes"><RecipeManagement /></RouteGuard></Route>
      <Route path="/interlock-rules"><RouteGuard navHref="/interlock-rules"><InterlockRuleManagement /></RouteGuard></Route>
      <Route path="/orchestration-studio"><RouteGuard navHref="/orchestration-studio"><AIPageWrapper><OrchestrationStudio /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ir-editor"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><IrEditor /></AIPageWrapper></RouteGuard></Route>
      <Route path="/pou-studio"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><PouStudio /></AIPageWrapper></RouteGuard></Route>
      <Route path="/programming-copilot"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><ProgrammingCopilot /></AIPageWrapper></RouteGuard></Route>
      <Route path="/factory-floor-editor"><RouteGuard navHref="/factory-floor-editor"><AIPageWrapper><FactoryFloorEditor /></AIPageWrapper></RouteGuard></Route>
      <Route path="/rf-test-cell"><RouteGuard navHref="/rf-test-cell"><AIPageWrapper><RfTestCellSim /></AIPageWrapper></RouteGuard></Route>
      <Route path="/cell-twin"><RouteGuard navHref="/cell-twin"><AIPageWrapper><CellTwinPlayer /></AIPageWrapper></RouteGuard></Route>
      <Route path="/digital-twin-center"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><DigitalTwinCenter /></AIPageWrapper></RouteGuard></Route>
      <Route path="/command-center"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><CommandCenter /></AIPageWrapper></RouteGuard></Route>
      {/* U3 (doc 21 §6 G-4/G-5): per-asset cockpits — reached by drill (no top-nav entry). */}
      <Route path="/machine/:id"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><MachineCockpit /></AIPageWrapper></RouteGuard></Route>
      <Route path="/robot/:id"><RouteGuard requirePermission="machine_monitoring"><AIPageWrapper><RobotCockpit /></AIPageWrapper></RouteGuard></Route>
      <Route path="/technician-copilot"><RouteGuard navHref="/technician-copilot"><AIPageWrapper><TechnicianCopilot /></AIPageWrapper></RouteGuard></Route>
      <Route path="/work-orders"><RouteGuard navHref="/work-orders"><WorkOrdersPage /></RouteGuard></Route>
      <Route path="/alerts"><RouteGuard navHref="/alerts"><Alerts /></RouteGuard></Route>
      <Route path="/monitoring-setting"><RouteGuard requireRole={["admin"]}><MonitoringSettings /></RouteGuard></Route>
      {/* P1 consolidation: command audit is now the "command" tab of the unified Audit page. */}
      <Route path="/command-audit"><Redirect to="/audit-logs?tab=command" /></Route>

      {/* ── ANALYTICS ────────────────────────────────────────────────────── */}
      <Route path="/reports"><RouteGuard navHref="/reports"><Reports /></RouteGuard></Route>
      <Route path="/scheduled-reports"><RouteGuard navHref="/scheduled-reports"><ScheduledReports /></RouteGuard></Route>
      {/* P1 consolidation: enhanced scheduled reports folded into the canonical Scheduled Reports page. */}
      <Route path="/enhanced-scheduled-reports"><Redirect to="/scheduled-reports" /></Route>
      <Route path="/report-builder"><RouteGuard navHref="/report-builder"><ReportBuilder /></RouteGuard></Route>
      <Route path="/category-analytics"><RouteGuard navHref="/category-analytics"><CategoryAnalytics /></RouteGuard></Route>
      <Route path="/correlation-analysis"><RouteGuard navHref="/correlation-analysis"><CorrelationAnalysis /></RouteGuard></Route>
      <Route path="/data-comparison"><RouteGuard navHref="/data-comparison"><DataComparison /></RouteGuard></Route>
      <Route path="/realtime-report"><RouteGuard navHref="/realtime-report"><RealtimeReportView /></RouteGuard></Route>
      <Route path="/energy-analytics"><RouteGuard navHref="/energy-analytics"><EnergyAnalyticsPage /></RouteGuard></Route>
      <Route path="/carbon-dashboard"><RouteGuard navHref="/carbon-dashboard"><CarbonDashboard /></RouteGuard></Route>
      <Route path="/pdf-reports"><RouteGuard navHref="/pdf-reports"><PdfReports /></RouteGuard></Route>
      <Route path="/powerpoint-export"><RouteGuard navHref="/powerpoint-export"><PowerPointExport /></RouteGuard></Route>
      <Route path="/threshold-approvals"><RouteGuard navHref="/threshold-approvals"><ThresholdApprovalsPage /></RouteGuard></Route>
      <Route path="/oee-target-settings"><RouteGuard navHref="/oee-target-settings"><OEETargetSettings /></RouteGuard></Route>
      <Route path="/analytics-setting"><RouteGuard requireRole={["admin"]}><AnalyticsSettings /></RouteGuard></Route>

      {/* ── AI ───────────────────────────────────────────────────────────── */}
      {/* Workspace (read-open to all roles): chat / hub / management-insight. */}
      <Route path="/ai-chat"><AIPageWrapper><AIChatPage /></AIPageWrapper></Route>
      <Route path="/ai-hub"><AIPageWrapper><AIHub /></AIPageWrapper></Route>
      <Route path="/management-insight"><AIPageWrapper><ManagementInsight /></AIPageWrapper></Route>
      <Route path="/ai-local-kb"><AIPageWrapper><AILocalKnowledgeBasePage /></AIPageWrapper></Route>
      {/* AI Control Plane / Ops / Vision — admin-gated. */}
      <Route path="/ai-brain"><RouteGuard navHref="/ai-brain"><AIPageWrapper><AIBrainDashboard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-monitoring"><RouteGuard navHref="/ai-monitoring"><AIPageWrapper><ModelMonitoringPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-performance"><RouteGuard navHref="/ai-performance"><AIPageWrapper><AIPerformanceDashboard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-models"><RouteGuard navHref="/ai-models"><AIPageWrapper><AIModelManagementPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/model-versions"><RouteGuard navHref="/model-versions"><AIPageWrapper><ModelVersionsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-settings"><RouteGuard navHref="/ai-settings"><AIPageWrapper><AISettingsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-active-learning"><RouteGuard navHref="/ai-active-learning"><AIPageWrapper><AIActiveLearningPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-batch-jobs"><RouteGuard navHref="/ai-batch-jobs"><AIPageWrapper><BatchInferencePage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-data-processing"><RouteGuard navHref="/ai-data-processing"><AIPageWrapper><AIDataProcessingPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-time-series"><RouteGuard navHref="/ai-time-series"><AIPageWrapper><AITimeSeriesPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-reports"><RouteGuard navHref="/ai-reports"><AIPageWrapper><AIReportsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-quality-gate"><RouteGuard navHref="/ai-quality-gate"><AIPageWrapper><AIQualityGatePage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-image-search"><RouteGuard navHref="/ai-image-search"><AIPageWrapper><AIImageSearchPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-advanced-vision-lab"><RouteGuard navHref="/ai-advanced-vision-lab"><AIPageWrapper><AdvancedVisionLabPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/anomaly-banks"><RouteGuard navHref="/anomaly-banks"><AnomalyBankPage /></RouteGuard></Route>
      <Route path="/mask-annotation"><RouteGuard navHref="/mask-annotation"><AIPageWrapper><MaskAnnotationPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/causal-graph"><RouteGuard navHref="/causal-graph"><AIPageWrapper><CausalGraphEditorPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-inspection-analytics"><RouteGuard requirePermission="analytics_ai_performance"><AIPageWrapper><AIInspectionAnalyticsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-gguf-models"><RouteGuard requireRole={["admin"]}><AIPageWrapper><AIGgufModelsPage /></AIPageWrapper></RouteGuard></Route>
      {/* X3: /ai-ab-testing was a deprecated stub → redirect to the B6 canary tab. */}
      <Route path="/ai-ab-testing"><Redirect to="/ai-performance" /></Route>

      {/* ── ADMIN + Master Data / Data Management ────────────────────────── */}
      <Route path="/admin-home"><RouteGuard requireRole={["admin"]}><AdminHome /></RouteGuard></Route>
      <Route path="/users"><RouteGuard navHref="/users"><Users /></RouteGuard></Route>
      <Route path="/role-builder"><RouteGuard navHref="/role-builder"><RoleBuilder /></RouteGuard></Route>
      <Route path="/audit-logs"><RouteGuard requireRole={["admin"]}><AuditLogs /></RouteGuard></Route>
      {/* P1 consolidation: enhanced audit is now the "enhanced" tab of the unified Audit page. */}
      <Route path="/enhanced-audit"><Redirect to="/audit-logs?tab=enhanced" /></Route>
      <Route path="/license"><RouteGuard navHref="/license"><LicenseManagement /></RouteGuard></Route>
      <Route path="/api-keys"><RouteGuard navHref="/api-keys"><AIPageWrapper><ApiKeysPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/sites"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><SitesRegistry /></AIPageWrapper></RouteGuard></Route>
      <Route path="/federation-dashboard"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><FederationDashboard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/modules"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><ModulesMarketplace /></AIPageWrapper></RouteGuard></Route>
      <Route path="/backup-restore"><RouteGuard navHref="/backup-restore"><BackupRestore /></RouteGuard></Route>
      <Route path="/system-config"><RouteGuard requireRole={["admin"]}><SystemConfiguration /></RouteGuard></Route>
      <Route path="/admin-setting"><RouteGuard navHref="/admin-setting"><AdminSettings /></RouteGuard></Route>
      <Route path="/import-export"><RouteGuard requireRole={["admin"]}><ImportExport /></RouteGuard></Route>
      <Route path="/user-assignments"><RouteGuard requireRole={["admin"]} requirePermission="admin_users"><UserAssignments /></RouteGuard></Route>
      <Route path="/corporate-management"><RouteGuard requireRole={["admin"]}><CorporateManagement /></RouteGuard></Route>
      <Route path="/master-data"><RouteGuard navHref="/master-data"><MasterDataManagement /></RouteGuard></Route>
      <Route path="/operator-badges"><RouteGuard navHref="/operator-badges"><OperatorBadges /></RouteGuard></Route>
      <Route path="/component-library"><RouteGuard navHref="/component-library"><AIPageWrapper><ComponentLibrary /></AIPageWrapper></RouteGuard></Route>
      <Route path="/products"><RouteGuard navHref="/products"><ProductModels /></RouteGuard></Route>
      <Route path="/product-mapping"><RouteGuard navHref="/product-mapping"><ProductMachineMapping /></RouteGuard></Route>
      <Route path="/layout"><RouteGuard navHref="/layout"><Layout /></RouteGuard></Route>
      <Route path="/layout/:id"><RouteGuard requirePermission="settings_factory"><Layout /></RouteGuard></Route>
      <Route path="/workstation-management"><RouteGuard navHref="/workstation-management"><WorkstationManagement /></RouteGuard></Route>
      <Route path="/process-management"><RouteGuard navHref="/process-management"><ProcessManagement /></RouteGuard></Route>
      <Route path="/datasettings"><RouteGuard navHref="/datasettings"><DataSettings /></RouteGuard></Route>
      <Route path="/settings"><RouteGuard requirePermission="settings_view"><Settings /></RouteGuard></Route>
      {/* U7 (doc 21 §6 / §3 G-11) consolidation: the standalone Custom Dashboard is
          already embedded as the default tab of the Dashboard Center hub — redirect
          the loose route in (reversible; CustomDashboard.tsx retained + embedded). */}
      <Route path="/custom-dashboard"><Redirect to="/dashboard-center?tab=custom-dashboard" /></Route>

      {/* ── ME (self) — read-open to every authenticated role ─────────────── */}
      {/* P3-W2: full-screen Action Inbox + Today Briefing surfaces (read-open). */}
      <Route path="/inbox"><AIPageWrapper><InboxPage /></AIPageWrapper></Route>
      <Route path="/today"><AIPageWrapper><TodayPage /></AIPageWrapper></Route>
      <Route path="/operator"><AIPageWrapper><OperatorHome /></AIPageWrapper></Route>
      <Route path="/maintenance-home"><AIPageWrapper><MaintenanceHome /></AIPageWrapper></Route>
      <Route path="/supervisor-home"><AIPageWrapper><SupervisorHome /></AIPageWrapper></Route>
      <Route path="/viewer-home"><AIPageWrapper><ViewerHome /></AIPageWrapper></Route>
      <Route path="/profile" component={Profile} />
      <Route path="/change-password" component={ChangePassword} />
      <Route path="/sessions" component={SessionManagement} />
      <Route path="/request-role"><RequestRole /></Route>
      <Route path="/user-guide" component={UserGuide} />
      <Route path="/about-system" component={AboutSystem} />

      {/* ── Redirects (no guard needed) ──────────────────────────────────── */}
      <Route path="/admin" component={RedirectToAdminHome} />
      <Route path="/analytics" component={RedirectToCategoryAnalytics} />
      <Route path="/ai-analytics" component={RedirectToAIInspectionAnalytics} />
      <Route path="/dashboard-templates"><Redirect to="/dashboard-center?tab=dashboard-templates" /></Route>
      <Route path="/template-marketplace"><Redirect to="/dashboard-center?tab=dashboard-marketplace" /></Route>
      <Route path="/dashboard-marketplace"><Redirect to="/dashboard-center?tab=dashboard-marketplace" /></Route>

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useKioskMode();
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        {/* F0/F2 (doc 23): SiteProvider — the multi-site scope store. F2 populates
            it from the header SiteSwitcher (admin-gated sites.list) and persists the
            active site to localStorage. Non-admins degrade to a static "All sites". */}
        <SiteProvider>
          <TooltipProvider>
            {/* U1 (doc 26): EngineeringProvider — store lastSelected {project/thiết bị/
                workflow} làm fallback cho deep-link golden-thread giữa các trang Kỹ thuật. */}
            <EngineeringProvider>
            <AiCopilotProvider>
              <ConnectionBanner />
              <Toaster />
              <Router />
              {/* C3a — global copilot bubble: mounted ONCE here (inside the tRPC
                  provider from main.tsx) so it appears on every route, including
                  lazy AI pages. The bubble hides itself when not logged in. */}
              <AILocalChatBubble />
            </AiCopilotProvider>
            </EngineeringProvider>
          </TooltipProvider>
        </SiteProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
