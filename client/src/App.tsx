import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation, Redirect } from "wouter";
import { isWorkspaceShellEnabled } from "./components/workspace/hubState";
import { isDeviceOnboardWizardV2Enabled } from "./components/deviceOnboarding/types";
import React, { Suspense, useEffect } from "react";
import { Loader2 } from "lucide-react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SiteProvider } from "./contexts/SiteContext";
// doc 64 IA-10 — trục phạm vi ISA-95 bền (Xưởng›Chuyền›Máy) sống qua điều hướng.
import { AssetScopeProvider } from "./contexts/AssetScopeContext";
import { AiCopilotProvider } from "./contexts/AiCopilotContext";
import { EngineeringProvider } from "./contexts/EngineeringContext";
import { ProgrammingCopilotProvider } from "./contexts/ProgrammingCopilotContext";
// doc64 S5-OPT: 2 component global-mount này kéo ~1.9MB lib vào bundle chính
// (Dock→Panel→CodeEditor→@codemirror ~1MB; ChatBubble→react-markdown+AIToolResultCard→recharts).
// Lazy để chúng tải SAU first-paint — hành vi giữ nguyên, chỉ xuất hiện muộn vài trăm ms.
const ProgrammingCopilotDock = React.lazy(() =>
  import("./components/programming/ProgrammingCopilotDock").then((m) => ({ default: m.ProgrammingCopilotDock })),
);
const AILocalChatBubble = React.lazy(() =>
  import("./components/AILocalChatBubble").then((m) => ({ default: m.AILocalChatBubble })),
);
import { ConnectionBanner } from "./components/ConnectionBanner";
import { RouteGuard } from "./components/RouteGuard";
// ★★★ Pha 7 / I-4 — cổng buộc đổi mật khẩu (bọc CHÍNH `<Router/>`, xem điểm dùng ở cuối file).
import { CongDoiMatKhau } from "./components/CongDoiMatKhau";
import DashboardLayout from "./components/DashboardLayout";
import { isPersistentShellEnabled, isChromelessShellRoute } from "./lib/appLauncherFlag";
import { useKioskMode } from "./hooks/useKioskMode";
import Home from "./pages/Home";
// Wave 1 (foundation): code-split the heaviest eager page monoliths (2.7k–7.2k LOC)
// so they no longer inflate the initial bundle. Rendered under the top-level
// <Suspense> added around <Router/> below. (audit T5 — code-split monoliths.)
const Dashboard = React.lazy(() => import("./pages/Dashboard"));
const History = React.lazy(() => import("./pages/History"));
const DataSettings = React.lazy(() => import("./pages/DataSettings"));
const ApiDocs = React.lazy(() => import("./pages/ApiDocs"));
const ProductModels = React.lazy(() => import("./pages/ProductModels"));
const InspectionDetail = React.lazy(() => import("./pages/InspectionDetail")); // doc64 S5-OPT: eager→lazy
const Layout = React.lazy(() => import("./pages/Layout")); // doc64 S5-OPT: eager→lazy
const Settings = React.lazy(() => import("./pages/Settings")); // doc64 S5-OPT: eager→lazy
const CorporateLayout = React.lazy(() => import("./pages/CorporateLayout")); // doc64 S5-OPT: eager→lazy
const Reports = React.lazy(() => import("./pages/Reports")); // doc64 S5-OPT: eager→lazy
const Alerts = React.lazy(() => import("./pages/Alerts")); // doc64 S5-OPT: eager→lazy
const Users = React.lazy(() => import("./pages/Users")); // doc64 S5-OPT: eager→lazy
const ProductMachineMapping = React.lazy(() => import("./pages/ProductMachineMapping")); // doc64 S5-OPT: eager→lazy
const ProductionOrders = React.lazy(() => import("./pages/ProductionOrders")); // doc64 S5-OPT: eager→lazy
import Login from "./pages/Login";
const Profile = React.lazy(() => import("./pages/Profile")); // doc64 S5-OPT: eager→lazy
const ChangePassword = React.lazy(() => import("./pages/ChangePassword")); // doc64 S5-OPT: eager→lazy
const AuditLogs = React.lazy(() => import("./pages/AuditLogs")); // doc64 S5-OPT: eager→lazy
const SessionManagement = React.lazy(() => import("./pages/SessionManagement")); // doc64 S5-OPT: eager→lazy
const ProductionSessionSignOff = React.lazy(() => import("./pages/ProductionSessionSignOff")); // doc64 S5-OPT: eager→lazy
const ProductComparison = React.lazy(() => import("./pages/ProductComparison").then((m) => ({ default: m.ProductComparison }))); // doc64 S5-OPT: eager→lazy
import Setup from "./pages/Setup";
// doc 39 Wave 4 — the 9 MQTT/UNS pages are consolidated into one lazy Connectivity
// hub (their bodies are imported as *Content there). Legacy routes redirect in.
const ConnectivityHub = React.lazy(() => import("./pages/ConnectivityHub"));
const SystemConfiguration = React.lazy(() => import("./pages/SystemConfiguration")); // doc64 S5-OPT: eager→lazy
const ImportExport = React.lazy(() => import("./pages/ImportExport")); // doc64 S5-OPT: eager→lazy
const UserAssignments = React.lazy(() => import("./pages/UserAssignments")); // doc64 S5-OPT: eager→lazy
const ScheduledReports = React.lazy(() => import("./pages/ScheduledReports")); // doc64 S5-OPT: eager→lazy
const ProcessManagement = React.lazy(() => import("./pages/ProcessManagement")); // doc64 S5-OPT: eager→lazy
const WorkstationManagement = React.lazy(() => import("./pages/WorkstationManagement")); // doc64 S5-OPT: eager→lazy
const CategoryAnalytics = React.lazy(() => import("./pages/CategoryAnalytics")); // doc64 S5-OPT: eager→lazy
const UserGuide = React.lazy(() => import("./pages/UserGuide")); // doc64 S5-OPT: eager→lazy
const AboutSystem = React.lazy(() => import("./pages/AboutSystem")); // doc64 S5-OPT: eager→lazy
const BackupRestore = React.lazy(() => import("./pages/BackupRestore")); // doc64 S5-OPT: eager→lazy
const OEEDashboard = React.lazy(() => import("./pages/OEEDashboard")); // doc64 S5-OPT: eager→lazy
const OEETargetSettings = React.lazy(() => import("./pages/OEETargetSettings")); // doc64 S5-OPT: eager→lazy
const MESControlTower = React.lazy(() => import("./pages/MESControlTower")); // doc64 S5-OPT: eager→lazy
const WipLineBalance = React.lazy(() => import("./pages/WipLineBalance")); // doc64 S5-OPT: eager→lazy
const TraceabilityLineage = React.lazy(() => import("./pages/TraceabilityLineage")); // doc64 S5-OPT: eager→lazy
const RealtimeReportView = React.lazy(() => import("./pages/RealtimeReportView")); // doc64 S5-OPT: eager→lazy
const CarbonDashboard = React.lazy(() => import("./pages/CarbonDashboard")); // doc64 S5-OPT: eager→lazy
const DrillDownDashboard = React.lazy(() => import("./pages/DrillDownDashboard")); // doc64 S5-OPT: eager→lazy
const DefectHeatmapPage = React.lazy(() => import("./pages/DefectHeatmapPage")); // doc64 S5-OPT: eager→lazy
const DefectPredictionPage = React.lazy(() => import("./pages/DefectPredictionPage")); // doc64 S5-OPT: eager→lazy
const RootCauseAnalysisPage = React.lazy(() => import("./pages/RootCauseAnalysisPage")); // doc64 S5-OPT: eager→lazy
const CausalGraphEditorPage = React.lazy(() => import("./pages/CausalGraphEditorPage")); // Causal knowledge-graph admin editor (validated atomic write)
const HistoryExportScheduling = React.lazy(() => import("./pages/HistoryExportScheduling")); // doc64 S5-OPT: eager→lazy
const CorporateDashboard = React.lazy(() => import("./pages/CorporateDashboard")); // doc64 S5-OPT: eager→lazy
const AIPerformanceDashboard = React.lazy(() => import("./pages/AIPerformanceDashboard"));
// doc 69 Wave E1 (T7) — split out of AIPerformanceDashboard (evaluation before/after
// + A/B canary tabs) and AIDataProcessingPage (dataset-split tab) respectively.
const AIExperimentsPage = React.lazy(() => import("./pages/AIExperimentsPage"));
const AIDatasetsPage = React.lazy(() => import("./pages/AIDatasetsPage"));
const KbStudioPage = React.lazy(() => import("./pages/KbStudioPage")); // doc69 GĐ5/Wave E3 (E3-2): Training Studio — corpus registry + job-tracked ingest (Source/Jobs/Corpus/Eval/Model Builder)
const BatchInferencePage = React.lazy(() => import("./pages/BatchInferencePage"));
const ModelMonitoringPage = React.lazy(() => import("./pages/ModelMonitoringPage"));
const ModelVersionsPage = React.lazy(() => import("./pages/ModelVersionsPage"));
// doc 69 T6 — AIHub retired: merged into AIHome (/ai-home). Source file kept on
// disk unreferenced (not deleted, per task brief) — /ai-hub now redirects below.
const AIHome = React.lazy(() => import("./pages/AIHome"));
const AIChatPage = React.lazy(() => import("./pages/AIChatPage"));
// doc 78 PHA D — Không gian lập trình AI (cây tệp · trình xem+diff · hội thoại tác nhân). RBAC ai_repo_read.
const AICodingWorkspace = React.lazy(() => import("./pages/AICodingWorkspace"));
const AIQualityGatePage = React.lazy(() => import("./pages/AIQualityGatePage"));
const AIActiveLearningPage = React.lazy(() => import("./pages/AIActiveLearningPage"));
const AIImageSearchPage = React.lazy(() => import("./pages/AIImageSearchPage"));
const AIReportsPage = React.lazy(() => import("./pages/AIReportsPage"));
const AITimeSeriesPage = React.lazy(() => import("./pages/AITimeSeriesPage"));
const EnergyAnalyticsPage = React.lazy(() => import("./pages/EnergyAnalyticsPage")); // G2.6b: energy analytics (READ/ANALYTICS only)
const ProcessAnalyticsPage = React.lazy(() => import("./pages/ProcessAnalytics")); // doc 56 Đ3 — automation process-result analytics
const DeviceOnboardingHubV2 = React.lazy(() => import("./pages/DeviceOnboardingHubV2")); // doc 56 Đ2b — unified add-device wizard V2 (self-gated OFF)
const AISettingsPage = React.lazy(() => import("./pages/AISettingsPage"));
const AIDataProcessingPage = React.lazy(() => import("./pages/AIDataProcessingPage"));
const AIModelManagementPage = React.lazy(() => import("./pages/AIModelManagementPage"));
const AIInspectionAnalyticsPage = React.lazy(() => import("./pages/AIInspectionAnalyticsPage"));
const AdvancedVisionLabPage = React.lazy(() => import("./pages/AdvancedVisionLabPage"));
const AIGgufModelsPage = React.lazy(() => import("./pages/AIGgufModelsPage"));
const AIBrainDashboard = React.lazy(() => import("./pages/AIBrainDashboard"));
const AIAgentCommandCenter = React.lazy(() => import("./pages/AIAgentCommandCenter")); // doc69 GĐ4/E2-3: Agent Command Center (roster + savings + task feed + HITL drill-in)
const AISpecialistStudio = React.lazy(() => import("./pages/AISpecialistStudio")); // Wave 1 T4: dispatch card + result card for the 4 specialist agents (trpc.aiSpecialistAgent.*)
const ManagementInsight = React.lazy(() => import("./pages/ManagementInsight")); // B4.5: manager-facing insight (NL Q&A + exec summary + AI alerts)
// doc 69 T6 — /ai-local-kb was a mislabeled chatbot (not a real knowledge base);
// route now redirects to /ai-chat. Source file kept on disk unreferenced.
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
const SystemHealth = React.lazy(() => import("./pages/SystemHealth")); // Tier-1b (doc 24): OT store-and-forward + connection HA supervisors + DINOv2 model health + commissioning + twin export
const ControlReadiness = React.lazy(() => import("./pages/ControlReadiness")); // doc 40 Wave 3A (§11): Trust & Enforcement Center — READ-ONLY gate/flag readiness matrix
const RecipeManagement = React.lazy(() => import("./pages/RecipeManagement")); // G2.2b: recipe catalog + deploy ledger (CONFIG/VIEW)
const InterlockRuleManagement = React.lazy(() => import("./pages/InterlockRuleManagement")); // G2.2b: interlock rule admin (CONFIG/VIEW)
const BomManagement = React.lazy(() => import("./pages/BomManagement")); // G2.4: BOM + Feeder + component genealogy (data/telemetry/trace)
const MasterDataManagement = React.lazy(() => import("./pages/MasterDataManagement")); // Doc 07 §③: MES/MOM master data (supplier/material/customer/skill/tool)
const DataManagementHub = React.lazy(() => import("./pages/DataManagementHub")); // doc 59 Cụm D: hub "nhà Data" thống nhất (rail category ⇄ launcher)
const ProductWorkspaceHub = React.lazy(() => import("./pages/ProductWorkspaceHub")); // doc 59 Cụm E
// doc 69 T6 — AIStudioHub retired: merged into AIHome (/ai-home). Source file
// kept on disk unreferenced (not deleted, per task brief) — /ai-studio now
// redirects below.
const MaintenanceWorkspaceHub = React.lazy(() => import("./pages/MaintenanceWorkspaceHub")); // doc 59 Cụm I
const ReportingStudio = React.lazy(() => import("./pages/ReportingStudio")); // doc 59 Cụm G
const SettingsHub = React.lazy(() => import("./pages/SettingsHub")); // doc 59 cụm phụ — Settings hub
const EngineeringStudioHub = React.lazy(() => import("./pages/EngineeringStudioHub")); // doc 59 cụm phụ — Engineering Studio
const OperatorBadges = React.lazy(() => import("./pages/OperatorBadges")); // W8-B (doc 29 §3): operator/badge master — badgeCode → users.id with validity windows
const ComponentLibrary = React.lazy(() => import("./pages/ComponentLibrary")); // W8-A (doc 27 M12a / doc 29 §1): component package/footprint master + material links
const MasterDataAudit = React.lazy(() => import("./pages/MasterDataAudit")); // doc 42 Đợt 4B (H4): master-data audit trail (read-only "ai đổi gì, khi nào")
const DataQualityDashboard = React.lazy(() => import("./pages/DataQualityDashboard")); // doc 42 Đợt 5 (K1): master-data quality dashboard (missing-field / orphan-ref profiler, read-only)
const WorkOrdersPage = React.lazy(() => import("./pages/WorkOrdersPage")); // Maintenance work-order CRUD + CLOSE→MTTR (machine_monitoring)
const ThresholdApprovalsPage = React.lazy(() => import("./pages/ThresholdApprovalsPage")); // Threshold approval review queue (approve/reject/withdraw)
const EngineeringChanges = React.lazy(() => import("./pages/EngineeringChanges")); // doc 35 W4-D: ECN/ECO change control (request→impact→approve→effectivity) + componentCode backfill
const NonconformanceReports = React.lazy(() => import("./pages/NonconformanceReports")); // doc 35 W4-B: NCR/MRB management (raise→review→disposition→close, SoD)
const RoutingMaster = React.lazy(() => import("./pages/RoutingMaster")); // doc 35 W4-E: ISA-95 routing master + steps (ERP order resolves operations against this)
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
// doc 39 Wave 4 — the 6 twin/3D surfaces are consolidated into one lazy Digital Twin
// hub (their bodies are imported as *Content there). Legacy routes redirect in.
const TwinHub = React.lazy(() => import("./pages/TwinHub"));
const CommandCenter = React.lazy(() => import("./pages/CommandCenter")); // U2 (doc 21 §6 G-3): Ecosystem Command Center — single pane (hierarchy tree + factory twin + KPI strip + unified live alarm rail)
const ControlTower = React.lazy(() => import("./pages/ControlTower")); // doc 46 FE-W3.1 (D4): persona-configurable Executive Control Tower — consolidates 6 command screens (compose + cross-link)
const ComparisonStudio = React.lazy(() => import("./pages/ComparisonStudio")); // doc 46 FE-W3.3: unified multi-dim comparison (line/shift/product/period + benchmark)
const ExecutiveMobile = React.lazy(() => import("./pages/ExecutiveMobile")); // doc 46 FE-W3.5 (D5): executive mobile/PWA view (OEE/KPI + AI summary + approvals)
const MachineCockpit = React.lazy(() => import("./pages/MachineCockpit")); // U3 (doc 21 §6 G-4): /machine/:id unified per-machine cockpit (tabbed: overview/health/oee/alarms/recipes/programs/genealogy/3d/actions)
const RobotCockpit = React.lazy(() => import("./pages/RobotCockpit")); // U3 (doc 21 §6 G-4/G-5): /robot/:id unified per-robot cockpit (LIVE robot:telemetry; tabbed overview/joints/jobs/tasks/programs/safety/anomalies/alarms/3d/teach/actions)
const ApiKeysPage = React.lazy(() => import("./pages/ApiKeysPage")); // Control plane: scoped API-key admin CRUD (create-show-once)
const SitesRegistry = React.lazy(() => import("./pages/SitesRegistry")); // Doc 13 / F0: Multi-site Federation sites registry (admin)
const FederationDashboard = React.lazy(() => import("./pages/FederationDashboard")); // Doc 13 / F2: cross-site federation roll-up (admin)
const ModulesMarketplace = React.lazy(() => import("./pages/ModulesMarketplace")); // Doc 13 / F3: read-only modules + license marketplace (admin)
const SynapsePlatformPage = React.lazy(() => import("./pages/SynapsePlatformPage")); // doc 33: read-only SYNAPSE platform cockpit
const EdgeNodesPage = React.lazy(() => import("./pages/EdgeNodesPage")); // E4: edge node registry management
const HotFolderConfigPage = React.lazy(() => import("./pages/HotFolderConfigPage")); // Doc 27 C1 (W2-A): AOI/AVI hot-folder file-drop ingestion config + status + dry-run
// doc 39 Wave 4 — device-monitoring surfaces (fleet list / health-OEE / field devices)
// consolidated into one lazy Device hub; legacy routes redirect into their tab.
const DeviceHub = React.lazy(() => import("./pages/DeviceHub"));
const FactoryCommandView = React.lazy(() => import("./pages/FactoryCommandView")); // doc 40 Wave 4d §13.1: màn hình chỉ huy toàn nhà máy (2D/3D theo Line, click máy → drawer chi tiết)
const LineView = React.lazy(() => import("./pages/LineView")); // doc 44 W3-B4 §G5.10: Line View HMI (LDS-L5 Ch.4.2) — sơ đồ tuyến + FSM 7 trạng thái + readiness + lệnh tuyến (ConfirmWithReason → lineController.command)
const SopViewer = React.lazy(() => import("./pages/SopViewer")); // doc 44 W6-1 §G5.14: e-SOP viewer (LDS-L5 §6.2) — bước theo ngữ cảnh + checklist bắt buộc confirm
const SopManagement = React.lazy(() => import("./pages/SopManagement")); // doc 44 W6-1 §G5.14: quản trị e-SOP (soạn bước/phiên bản/kích hoạt)
const AlarmKpiDashboard = React.lazy(() => import("./pages/AlarmKpiDashboard")); // doc 44 W6-1 §G5.11: ISA-18.2 alarm KPI (rate/flood/standing/bad-actors/distribution)
const WarRoom = React.lazy(() => import("./pages/WarRoom")); // doc 40 Wave 4c §11: "Giao ban 7h" theo ca — KPI + OEE theo line + top downtime + so sánh ca + plan-vs-actual (trpc.warRoom.briefing)
const SlaCockpit = React.lazy(() => import("./pages/SlaCockpit")); // doc 46 FE-W2: Andon/alert SLA cockpit (MTTA/MTTR/escalation-breach; trpc.andon.metrics + andon.list)
const MetricCatalog = React.lazy(() => import("./pages/MetricCatalog")); // doc 46 FE-W2: semantic-layer Metric Catalog (KPI definitions/versions/lineage; trpc.semantics)
const MaintenanceHub = React.lazy(() => import("./pages/MaintenanceHub")); // doc 40 Wave 4c §11: CMMS hub — lịch bảo trì phòng ngừa + parts/reliability (agent C)
const RobotControl = React.lazy(() => import("./pages/RobotControl")); // P4-D: robot/AGV registry + telemetry + job log (read-mostly; motion via internal HITL dispatcher)
const CommandConsole = React.lazy(() => import("./pages/CommandConsole")); // ENG-F1 (doc 40): gated command console — phát 1 lệnh robot đơn lẻ qua HITL dispatcher (mọi gate giữ nguyên)
const FleetOrchestration = React.lazy(() => import("./pages/FleetOrchestration")); // G1 (doc 16 §7 Khối 2): fleet task allocation + zone traffic (read-mostly; mutations gated by FLEET_ORCH_ENABLED)
const ControlPlane = React.lazy(() => import("./pages/ControlPlane")); // P4-D: Factory Control Plane (equipment capability/PackML + FOE + edge runtime, read-only projections)
const SafetyWorkforce = React.lazy(() => import("./pages/SafetyWorkforce")); // S1 (doc 16 §8): advisory safety monitoring + mixed-workforce board + human↔robot handover (read-mostly; mutations gated by SAFETY_AUDIT_ENABLED / WORKFORCE_ENABLED)
const RobotModelHealth = React.lazy(() => import("./pages/RobotModelHealth")); // I2 (doc 16 §9 Khối 4): advisory robot-behaviour anomaly + AI model rollback audit (read-mostly; mutations gated by AI_ROBOT_ANOMALY_ENABLED / AI_MODEL_AUTOROLLBACK_ENABLED)
const EquipmentStandards = React.lazy(() => import("./pages/EquipmentStandards")); // E1 (doc 16 §10 Khối 5): device-type hierarchy + ISA-18.2 alarm taxonomy + Equipment Standards Board (governance metadata only; mutations gated by EQ_GOVERN_ENABLED)
const EquipmentIntegration = React.lazy(() => import("./pages/EquipmentIntegration")); // I1 (doc 16 §6 Khối 1B): FOCAS/Euromap integration frameworks (read-only) + recipe versioning genealogy (mutations gated by EQ_INTEG_ENABLED)
const QualityCockpit = React.lazy(() => import("./pages/QualityCockpit")); // P3-W2 (doc 12 §8): flagship Quality Cockpit (SPC/Pareto/Heatmap/Gates/Annotation tabs)
const InboxPage = React.lazy(() => import("./pages/InboxPage")); // P3-W2: full-screen Action Inbox route (read-open)
const ApprovalsInbox = React.lazy(() => import("./pages/ApprovalsInbox")); // doc 39 W6: unified HITL pending-approvals inbox (threshold + AI action; self-gates actions)
const TodayPage = React.lazy(() => import("./pages/TodayPage")); // P3-W2: full-screen Today Briefing route (read-open)
const AndonBoard = React.lazy(() => import("./pages/AndonBoard")); // W5-C (doc 27 F7): dedicated Andon/TV wall board (huge type, auto-cycle, socket-first + poll fallback)
const AOIPackages = React.lazy(() => import("./pages/AOIPackages")); // doc64 S5-OPT: eager→lazy
const CorrelationAnalysis = React.lazy(() => import("./pages/CorrelationAnalysis")); // doc64 S5-OPT: eager→lazy
const RoleBuilder = React.lazy(() => import("./pages/RoleBuilder")); // doc64 S5-OPT: eager→lazy
const PdfReports = React.lazy(() => import("./pages/PdfReports")); // doc64 S5-OPT: eager→lazy
const DataComparison = React.lazy(() => import("./pages/DataComparison")); // doc64 S5-OPT: eager→lazy
const ReportBuilder = React.lazy(() => import("./pages/ReportBuilder")); // doc64 S5-OPT: eager→lazy
const PowerPointExport = React.lazy(() => import("./pages/PowerPointExport")); // doc64 S5-OPT: eager→lazy
const QualityGateTemplates = React.lazy(() => import("./pages/QualityGateTemplates")); // doc64 S5-OPT: eager→lazy
const ProductionScheduling = React.lazy(() => import("./pages/ProductionScheduling")); // doc64 S5-OPT: eager→lazy
const MachineRegistration = React.lazy(() => import("./pages/MachineRegistration")); // doc64 S5-OPT: eager→lazy
const MachineOnboardingWizard = React.lazy(() => import("./pages/MachineOnboardingWizard")); // doc64 S5-OPT: eager→lazy
const AoiOnboardingWizard = React.lazy(() => import("./pages/AoiOnboardingWizard")); // W2-D (doc 27 §3 C4): guided AOI/AVI connection wizard — vendor adapter + dry-run + credential + commissioning sign-off (soft gate)
const ProductOnboardingWizard = React.lazy(() => import("./pages/ProductOnboardingWizard")); // WD-1 (doc 31 Đợt D · UX1): product-side onboarding wizard — resumable guided setup (fiducials/points/limits/golden/panel/release/mapping)
const ProductChangeoverWizard = React.lazy(() => import("./pages/ProductChangeoverWizard")); // doc 40 Wave 4 — operator changeover: quét sản phẩm mới → kiểm tra readiness/mapping/feeder → xác nhận đổi
const FeederVerify = React.lazy(() => import("./pages/FeederVerify")); // doc 35 W4-C: SMT feeder-setup scan verification (slot↔BOM/program, anti-mispick)
const CorporateManagement = React.lazy(() => import("./pages/CorporateManagement")); // doc64 S5-OPT: eager→lazy
const LicenseManagement = React.lazy(() => import("./pages/LicenseManagement")); // doc64 S5-OPT: eager→lazy
const MonitoringSettings = React.lazy(() => import("./pages/MonitoringSettings")); // doc64 S5-OPT: eager→lazy
// doc 40 DEV-03 — AdminMonitoring (giám sát slow-query) trước đây orphan (không route).
const AdminMonitoring = React.lazy(() => import("./pages/AdminMonitoring")); // doc64 S5-OPT: eager→lazy
const AnalyticsSettings = React.lazy(() => import("./pages/AnalyticsSettings")); // doc64 S5-OPT: eager→lazy
const AdminSettings = React.lazy(() => import("./pages/AdminSettings")); // doc64 S5-OPT: eager→lazy
const DashboardCenter = React.lazy(() => import("./pages/DashboardCenter")); // doc64 S5-OPT: eager→lazy
const ProductionDashboard = React.lazy(() => import("./pages/ProductionDashboard")); // doc64 S5-OPT: eager→lazy
const StationAnalysis = React.lazy(() => import("./pages/StationAnalysis")); // Wave 1: code-split (2.7k LOC)
const ComponentShowcase = React.lazy(() => import("./pages/ComponentShowcase")); // Wave 1: dev showcase of DS + foundation primitives

function AIPageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary variant="compact">
      <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * doc 39 Wave 1b — the persistent app-shell hoist (flag-gated, default OFF).
 *
 * OFF (default): passthrough — every page keeps mounting its own <DashboardLayout>,
 * byte-for-byte the legacy behavior. ON (APP_SHELL_PERSISTENT): ONE <DashboardLayout asShell>
 * is hoisted here so the sidebar/header/nav no longer remount on navigation; each page's
 * own <DashboardLayout> collapses to a passthrough via InShellContext. Chromeless routes
 * (login/setup/andon/inbox/showcase/404) render bare so the shell never wraps a TV board
 * or the login screen.
 */
function AppShell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  if (!isPersistentShellEnabled()) return <>{children}</>;
  if (isChromelessShellRoute(location)) return <>{children}</>;
  return <DashboardLayout asShell>{children}</DashboardLayout>;
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
      {/* Wave 1 (foundation): dev-open showcase of the shared design-system +
          the new foundation primitives (DataTable/AsyncBoundary/FilterBar/FormScaffold). */}
      <Route path="/component-showcase" component={ComponentShowcase} />

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
      {/* doc 46 FE-W3.1 (D4) — persona-configurable Executive Control Tower (single command surface). */}
      <Route path="/control-tower"><RouteGuard navHref="/control-tower"><AIPageWrapper><ControlTower /></AIPageWrapper></RouteGuard></Route>
      {/* doc 46 FE-W3.5 (D5) — executive mobile/PWA view (glanceable OEE/KPI + AI summary + approvals). */}
      <Route path="/executive"><RouteGuard navHref="/executive"><ExecutiveMobile /></RouteGuard></Route>
      <Route path="/corporate-layout"><RouteGuard requirePermission="dashboard_corporate"><CorporateLayout /></RouteGuard></Route>

      {/* ── PRODUCTION ───────────────────────────────────────────────────── */}
      <Route path="/production-dashboard"><RouteGuard navHref="/production-dashboard"><ProductionDashboard /></RouteGuard></Route>
      {/* doc 40 Wave 4c §11 — War-room "Giao ban 7h": one-pager giao ban theo ca (OEE theo line + top downtime + so sánh ca + plan-vs-actual). Read-only → machine_status. */}
      <Route path="/war-room"><RouteGuard requirePermission="machine_status"><AIPageWrapper><WarRoom /></AIPageWrapper></RouteGuard></Route>
      <Route path="/mes-control-tower"><RouteGuard navHref="/mes-control-tower"><MESControlTower /></RouteGuard></Route>
      <Route path="/wip-dashboard"><RouteGuard navHref="/wip-dashboard"><WipLineBalance /></RouteGuard></Route>
      <Route path="/traceability"><RouteGuard navHref="/traceability"><TraceabilityLineage /></RouteGuard></Route>
      {/* doc 39 Wave 4 — Digital Twin hub consolidates the 6 twin/3D surfaces into one
          tabbed page; the legacy routes deep-link into their tab. */}
      <Route path="/digital-twin"><RouteGuard navHref="/digital-twin"><AIPageWrapper><TwinHub /></AIPageWrapper></RouteGuard></Route>
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
      {/* doc 39 Wave 4 — Device hub consolidates fleet list + health/OEE + field devices
          into one tabbed page; /machine-health & /field-devices deep-link into their tab. */}
      <Route path="/device-monitor"><RouteGuard navHref="/device-monitor"><AIPageWrapper><DeviceHub /></AIPageWrapper></RouteGuard></Route>
      {/* doc 40 Wave 4d §13.1 — Factory Command View: chỉ huy toàn nhà máy 2D/3D (xem = giám sát). */}
      <Route path="/factory-command"><RouteGuard requirePermission="machine_status"><AIPageWrapper><FactoryCommandView /></AIPageWrapper></RouteGuard></Route>
      {/* doc 44 W3-B4 §G5.10 — Line View (LDS-L5 Ch.4.2): xem = machine_status; lệnh tuyến tự gate machine_control/edit + server actuationProcedure (2FA). */}
      <Route path="/line-view/:lineId?"><RouteGuard requirePermission="machine_status"><AIPageWrapper><LineView /></AIPageWrapper></RouteGuard></Route>
      {/* doc 44 W6-1 §G5.14 — e-SOP (LDS-L5 §6.2): viewer vận hành (machine_status read-open) + quản trị (settings_products); server gate role/2FA. */}
      <Route path="/sop/:sopId?"><RouteGuard requirePermission="machine_status"><SopViewer /></RouteGuard></Route>
      <Route path="/sop-management"><RouteGuard requirePermission="settings_products"><SopManagement /></RouteGuard></Route>
      {/* doc 44 W6-1 §G5.11 — ISA-18.2 alarm KPI dashboard (READ-ONLY, đọc andon+predictive). */}
      <Route path="/alarm-kpi"><RouteGuard requirePermission="machine_status"><AIPageWrapper><AlarmKpiDashboard /></AIPageWrapper></RouteGuard></Route>
      {/* doc 46 FE-W2 — Andon/alert SLA cockpit (MTTA/MTTR/escalation-breach), SLA companion to alarm-kpi. */}
      <Route path="/sla-cockpit"><RouteGuard navHref="/sla-cockpit"><AIPageWrapper><SlaCockpit /></AIPageWrapper></RouteGuard></Route>
      {/* P3-W2 consolidation: legacy machine-status grid → unified Device Monitor. */}
      <Route path="/machine-status"><Redirect to="/device-monitor" /></Route>
      <Route path="/machine-health"><Redirect to="/device-monitor?tab=health" /></Route>
      <Route path="/oee-dashboard"><RouteGuard navHref="/oee-dashboard"><OEEDashboard /></RouteGuard></Route>
      <Route path="/factory-live-map"><Redirect to="/digital-twin?tab=map" /></Route>
      <Route path="/field-devices"><Redirect to="/device-monitor?tab=field" /></Route>
      {/* doc 39 Wave 4 — Connectivity hub consolidates the 9 MQTT/UNS surfaces into one
          tabbed page; legacy routes deep-link into their tab (deep-links preserved). */}
      <Route path="/connectivity"><RouteGuard requirePermission="mqtt_monitoring"><AIPageWrapper><ConnectivityHub /></AIPageWrapper></RouteGuard></Route>
      <Route path="/mqtt-dashboard"><Redirect to="/connectivity?tab=overview" /></Route>
      <Route path="/mqtt-bulletin"><Redirect to="/connectivity?tab=bulletin" /></Route>
      <Route path="/mqtt-replay"><Redirect to="/connectivity?tab=replay" /></Route>
      <Route path="/mqtt-clients"><Redirect to="/connectivity?tab=clients" /></Route>
      <Route path="/mqtt-alerts"><Redirect to="/connectivity?tab=alerts" /></Route>
      <Route path="/mqtt-profiles"><Redirect to="/connectivity?tab=profiles" /></Route>
      <Route path="/mqtt-topics"><Redirect to="/connectivity?tab=topics" /></Route>
      <Route path="/mqtt-ng-rate"><Redirect to="/connectivity?tab=ngrate" /></Route>
      {/* doc 59 Cụm C — wizard hợp nhất default-ON: các wizard cũ fold vào /device-onboarding
          (aoi_avi branch tái dùng nguyên AoiOnboardingWizardContent; automation/iot có nhánh riêng).
          Giữ standalone khi cờ wizard OFF. */}
      <Route path="/machine-onboarding">
        {() => isDeviceOnboardWizardV2Enabled()
          ? <Redirect to="/device-onboarding" />
          : <RouteGuard navHref="/machine-onboarding"><MachineOnboardingWizard /></RouteGuard>}
      </Route>
      <Route path="/aoi-onboarding">
        {() => isDeviceOnboardWizardV2Enabled()
          ? <Redirect to="/device-onboarding" />
          : <RouteGuard navHref="/aoi-onboarding"><AIPageWrapper><AoiOnboardingWizard /></AIPageWrapper></RouteGuard>}
      </Route>
      <Route path="/product-onboarding"><RouteGuard navHref="/product-onboarding"><AIPageWrapper><ProductOnboardingWizard /></AIPageWrapper></RouteGuard></Route>
      {/* doc 40 Wave 4 — Đổi sản phẩm (changeover) tại line: gate machine_status qua navHref (operator/maintenance đều có canView). */}
      <Route path="/product-changeover"><RouteGuard navHref="/product-changeover"><AIPageWrapper><ProductChangeoverWizard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/machine-registration"><RouteGuard navHref="/machine-registration"><MachineRegistration /></RouteGuard></Route>
      <Route path="/device-adapters"><RouteGuard navHref="/device-adapters"><DeviceAdapterManagement /></RouteGuard></Route>
      <Route path="/uns-mapping"><Redirect to="/connectivity?tab=uns" /></Route>
      <Route path="/system-health"><RouteGuard requirePermission="machine_status"><AIPageWrapper><SystemHealth /></AIPageWrapper></RouteGuard></Route>
      {/* doc 40 Wave 3A (§11): Trust & Enforcement Center — READ-ONLY gate/flag readiness matrix (QA + audit). RBAC machine_control (admin bypass). */}
      <Route path="/control-readiness"><RouteGuard requirePermission="machine_control"><AIPageWrapper><ControlReadiness /></AIPageWrapper></RouteGuard></Route>
      <Route path="/edge-nodes"><RouteGuard navHref="/edge-nodes"><AIPageWrapper><EdgeNodesPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/hot-folders"><RouteGuard navHref="/hot-folders"><AIPageWrapper><HotFolderConfigPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/robot-control"><RouteGuard requirePermission="machine_control"><AIPageWrapper><RobotControl /></AIPageWrapper></RouteGuard></Route>
      {/* ENG-F1 (doc 40): gated command console — actuation qua HITL dispatcher (mode/commissioning/interlock gate giữ nguyên). */}
      <Route path="/command-console"><RouteGuard requirePermission="machine_control"><AIPageWrapper><CommandConsole /></AIPageWrapper></RouteGuard></Route>
      <Route path="/fleet-orchestration"><RouteGuard requirePermission="machine_control"><AIPageWrapper><FleetOrchestration /></AIPageWrapper></RouteGuard></Route>
      <Route path="/control-plane"><RouteGuard requirePermission="machine_control"><AIPageWrapper><ControlPlane /></AIPageWrapper></RouteGuard></Route>
      <Route path="/safety-workforce"><RouteGuard requirePermission="machine_status"><AIPageWrapper><SafetyWorkforce /></AIPageWrapper></RouteGuard></Route>
      <Route path="/robot-model-health"><RouteGuard requirePermission="machine_status" requireModule="MOD_AI"><AIPageWrapper><RobotModelHealth /></AIPageWrapper></RouteGuard></Route>
      <Route path="/equipment-standards"><RouteGuard requirePermission="machine_status"><AIPageWrapper><EquipmentStandards /></AIPageWrapper></RouteGuard></Route>
      <Route path="/equipment-integration"><RouteGuard requirePermission="machine_status"><AIPageWrapper><EquipmentIntegration /></AIPageWrapper></RouteGuard></Route>
      <Route path="/engineering-home"><RouteGuard navHref="/engineering-home"><EngineeringHub /></RouteGuard></Route>
      <Route path="/engineering"><RouteGuard navHref="/engineering"><EngineeringWorkspace /></RouteGuard></Route>
      <Route path="/recipes"><RouteGuard navHref="/recipes"><RecipeManagement /></RouteGuard></Route>
      <Route path="/interlock-rules"><RouteGuard navHref="/interlock-rules"><InterlockRuleManagement /></RouteGuard></Route>
      <Route path="/orchestration-studio"><RouteGuard navHref="/orchestration-studio"><AIPageWrapper><OrchestrationStudio /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ir-editor"><RouteGuard requirePermission="machine_control"><AIPageWrapper><IrEditor /></AIPageWrapper></RouteGuard></Route>
      <Route path="/pou-studio"><RouteGuard requirePermission="machine_control"><AIPageWrapper><PouStudio /></AIPageWrapper></RouteGuard></Route>
      <Route path="/programming-copilot"><RouteGuard requirePermission="machine_status"><AIPageWrapper><ProgrammingCopilot /></AIPageWrapper></RouteGuard></Route>
      <Route path="/factory-floor-editor"><Redirect to="/digital-twin?tab=floor" /></Route>
      <Route path="/rf-test-cell"><Redirect to="/digital-twin?tab=rf" /></Route>
      <Route path="/cell-twin"><Redirect to="/digital-twin?tab=cell" /></Route>
      <Route path="/digital-twin-center"><Redirect to="/digital-twin?tab=center" /></Route>
      <Route path="/command-center"><RouteGuard requirePermission="machine_status"><AIPageWrapper><CommandCenter /></AIPageWrapper></RouteGuard></Route>
      {/* U3 (doc 21 §6 G-4/G-5): per-asset cockpits — reached by drill (no top-nav entry). */}
      {/* doc 59 P3 — workspace default-ON: /machine/:id folds into the Machine Workspace
          (rail + cockpit) at /device-monitor?machine=; standalone cockpit kept for flag-off. */}
      <Route path="/machine/:id">
        {(params) =>
          isWorkspaceShellEnabled() ? (
            <Redirect to={`/device-monitor?machine=${params.id}`} />
          ) : (
            <RouteGuard requirePermission="machine_status"><AIPageWrapper><MachineCockpit /></AIPageWrapper></RouteGuard>
          )
        }
      </Route>
      <Route path="/robot/:id"><RouteGuard requirePermission="machine_status"><AIPageWrapper><RobotCockpit /></AIPageWrapper></RouteGuard></Route>
      <Route path="/technician-copilot"><RouteGuard navHref="/technician-copilot"><AIPageWrapper><TechnicianCopilot /></AIPageWrapper></RouteGuard></Route>
      <Route path="/work-orders"><RouteGuard navHref="/work-orders"><WorkOrdersPage /></RouteGuard></Route>
      {/* doc 40 Wave 4c §11 — CMMS hub: lịch bảo trì phòng ngừa (maintenance_schedules) + phụ tùng/độ tin cậy. Gate machine_control (bảo trì). */}
      <Route path="/cmms"><RouteGuard requirePermission="machine_control"><AIPageWrapper><MaintenanceHub /></AIPageWrapper></RouteGuard></Route>
      <Route path="/feeder-verify"><RouteGuard navHref="/feeder-verify"><AIPageWrapper><FeederVerify /></AIPageWrapper></RouteGuard></Route>
      <Route path="/alerts"><RouteGuard navHref="/alerts"><Alerts /></RouteGuard></Route>
      {/* doc 40 DEV-02 — nav row đòi machine_status; đồng bộ guard về machine_status
          (trang chỉ là device-mapping/registration, không phải quản trị hệ thống). */}
      <Route path="/monitoring-setting"><RouteGuard requirePermission="machine_status"><MonitoringSettings /></RouteGuard></Route>
      {/* P1 consolidation: command audit is now the "command" tab of the unified Audit page. */}
      <Route path="/command-audit"><Redirect to="/audit-logs?tab=command" /></Route>

      {/* ── ANALYTICS ────────────────────────────────────────────────────── */}
      <Route path="/reporting-studio"><RouteGuard navHref="/reporting-studio"><ReportingStudio /></RouteGuard></Route>
      <Route path="/reports"><RouteGuard navHref="/reports"><Reports /></RouteGuard></Route>
      <Route path="/scheduled-reports"><RouteGuard navHref="/scheduled-reports"><ScheduledReports /></RouteGuard></Route>
      {/* P1 consolidation: enhanced scheduled reports folded into the canonical Scheduled Reports page. */}
      <Route path="/enhanced-scheduled-reports"><Redirect to="/scheduled-reports" /></Route>
      <Route path="/report-builder"><RouteGuard navHref="/report-builder"><ReportBuilder /></RouteGuard></Route>
      <Route path="/category-analytics"><RouteGuard navHref="/category-analytics"><CategoryAnalytics /></RouteGuard></Route>
      <Route path="/correlation-analysis"><RouteGuard navHref="/correlation-analysis"><CorrelationAnalysis /></RouteGuard></Route>
      <Route path="/data-comparison"><RouteGuard navHref="/data-comparison"><DataComparison /></RouteGuard></Route>
      {/* doc 46 FE-W3.3 — unified Comparison Studio (line/shift/product/period + benchmark). */}
      <Route path="/comparison-studio"><RouteGuard navHref="/comparison-studio"><ComparisonStudio /></RouteGuard></Route>
      <Route path="/realtime-report"><RouteGuard navHref="/realtime-report"><RealtimeReportView /></RouteGuard></Route>
      <Route path="/energy-analytics"><RouteGuard navHref="/energy-analytics"><EnergyAnalyticsPage /></RouteGuard></Route>
      {/* doc 56 Đ3/Đ2b — no navHref: authenticated-user access; PROCESS_ANALYTICS_ENABLED
          gates the data (empty-state when OFF) and DEVICE_ONBOARD_WIZARD_V2_ENABLED
          self-gates the wizard (fallback card when OFF). Menu entry deferred to Đ7 IA. */}
      <Route path="/process-analytics"><RouteGuard navHref="/process-analytics"><ProcessAnalyticsPage /></RouteGuard></Route>
      <Route path="/device-onboarding"><RouteGuard navHref="/device-onboarding"><DeviceOnboardingHubV2 /></RouteGuard></Route>
      <Route path="/carbon-dashboard"><RouteGuard navHref="/carbon-dashboard"><CarbonDashboard /></RouteGuard></Route>
      <Route path="/pdf-reports"><RouteGuard navHref="/pdf-reports"><PdfReports /></RouteGuard></Route>
      <Route path="/powerpoint-export"><RouteGuard navHref="/powerpoint-export"><PowerPointExport /></RouteGuard></Route>
      <Route path="/threshold-approvals"><RouteGuard navHref="/threshold-approvals"><ThresholdApprovalsPage /></RouteGuard></Route>
      <Route path="/engineering-changes"><RouteGuard navHref="/engineering-changes"><AIPageWrapper><EngineeringChanges /></AIPageWrapper></RouteGuard></Route>
      <Route path="/nonconformance"><RouteGuard navHref="/nonconformance"><AIPageWrapper><NonconformanceReports /></AIPageWrapper></RouteGuard></Route>
      <Route path="/routing-master"><RouteGuard navHref="/routing-master"><AIPageWrapper><RoutingMaster /></AIPageWrapper></RouteGuard></Route>
      <Route path="/oee-target-settings"><RouteGuard navHref="/oee-target-settings"><OEETargetSettings /></RouteGuard></Route>
      {/* doc 36 follow-up — REDUNDANT hub: every tab is its own route (surfaced in the
          Analytics/Quality app menus). Redirect the bare hub away. */}
      <Route path="/analytics-setting"><Redirect to="/reports" /></Route>

      {/* ── AI ───────────────────────────────────────────────────────────── */}
      {/* doc 69 T6 — single AI taxonomy: AI Home merges the old AIHub (/ai-hub)
          + AIStudioHub (/ai-studio) tile walls into one landing; both old URLs
          keep working via redirect. Workspace (read-open to all roles): chat /
          AI Home / management-insight / inbox. */}
      {/* ★★★ doc 80 — `requireModule="MOD_AI"` trên MỌI tuyến thuộc SKU AI. Nó KHÔNG thay RBAC
          (`navHref`/`requirePermission`/`requireRole` giữ nguyên từng ký tự) — nó THÊM chiều
          GIẤY PHÉP, và chỉ chặn khi SKU **đã khai** mà không gồm MOD_AI (xem RouteGuard §1a-bis).
          Ba tuyến "read-open" dưới đây trước nay KHÔNG có RouteGuard nào; chúng được bọc mới
          CHỈ để mang cổng module — không thêm một điều kiện vai/quyền nào. */}
      <Route path="/ai-chat"><RouteGuard requireModule="MOD_AI"><AIPageWrapper><AIChatPage /></AIPageWrapper></RouteGuard></Route>
      {/* doc 78 PHA D — Không gian lập trình AI: ghim RBAC ai_repo_read (engineer/admin), KHÔNG mở cho mọi tài khoản. */}
      <Route path="/ai-coding-workspace"><RouteGuard requirePermission="ai_repo_read" requireModule="MOD_AI"><AIPageWrapper><AICodingWorkspace /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-home"><RouteGuard requireModule="MOD_AI"><AIPageWrapper><AIHome /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-hub"><Redirect to="/ai-home" /></Route>
      <Route path="/management-insight"><RouteGuard requireModule="MOD_AI"><AIPageWrapper><ManagementInsight /></AIPageWrapper></RouteGuard></Route>
      {/* /ai-local-kb was a mislabeled chatbot (not a real knowledge base) — the
          real RAG knowledge base is a later task (doc 69 Wave E3). */}
      <Route path="/ai-local-kb"><Redirect to="/ai-chat" /></Route>
      {/* AI Control Plane / Ops / Vision — admin-gated. */}
      <Route path="/ai-brain"><RouteGuard navHref="/ai-brain" requireModule="MOD_AI"><AIPageWrapper><AIBrainDashboard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-command-center"><RouteGuard navHref="/ai-command-center" requireModule="MOD_AI"><AIPageWrapper><AIAgentCommandCenter /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-specialist-studio"><RouteGuard navHref="/ai-specialist-studio" requireModule="MOD_AI"><AIPageWrapper><AISpecialistStudio /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-monitoring"><RouteGuard navHref="/ai-monitoring" requireModule="MOD_AI"><AIPageWrapper><ModelMonitoringPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-performance"><RouteGuard navHref="/ai-performance" requireModule="MOD_AI"><AIPageWrapper><AIPerformanceDashboard /></AIPageWrapper></RouteGuard></Route>
      {/* doc 69 Wave E1 (T7) — split from AIPerformanceDashboard (evaluation before/after
          + A/B canary); same RBAC guard as /ai-performance. */}
      <Route path="/ai-experiments"><RouteGuard navHref="/ai-experiments" requireModule="MOD_AI"><AIPageWrapper><AIExperimentsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-models"><RouteGuard navHref="/ai-models" requireModule="MOD_AI"><AIPageWrapper><AIModelManagementPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/model-versions"><RouteGuard navHref="/model-versions" requireModule="MOD_AI"><AIPageWrapper><ModelVersionsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-settings"><RouteGuard navHref="/ai-settings" requireModule="MOD_AI"><AIPageWrapper><AISettingsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-active-learning"><RouteGuard navHref="/ai-active-learning" requireModule="MOD_AI"><AIPageWrapper><AIActiveLearningPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-batch-jobs"><RouteGuard navHref="/ai-batch-jobs" requireModule="MOD_AI"><AIPageWrapper><BatchInferencePage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-data-processing"><RouteGuard navHref="/ai-data-processing" requireModule="MOD_AI"><AIPageWrapper><AIDataProcessingPage /></AIPageWrapper></RouteGuard></Route>
      {/* doc 69 Wave E1 (T7) — split from AIDataProcessingPage (dataset-split tab, a
          durable Knowledge & Training asset); same RBAC guard as /ai-data-processing. */}
      <Route path="/ai-datasets"><RouteGuard navHref="/ai-datasets" requireModule="MOD_AI"><AIPageWrapper><AIDatasetsPage /></AIPageWrapper></RouteGuard></Route>
      {/* doc69 GĐ5/Wave E3 (E3-2) — Training Studio: the nav comment at /ai-datasets's
          registration (doc 69 Wave E1/T7) said Training Studio was "a later E3 task — NOT
          added here"; this is that task. Same admin-gated RouteGuard shape as /ai-datasets
          (kbStudioRouter.ts itself allows admin+engineer — see navigation.tsx's comment). */}
      <Route path="/ai-training-studio"><RouteGuard navHref="/ai-training-studio" requireModule="MOD_AI"><AIPageWrapper><KbStudioPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-time-series"><RouteGuard navHref="/ai-time-series" requireModule="MOD_AI"><AIPageWrapper><AITimeSeriesPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-reports"><RouteGuard navHref="/ai-reports" requireModule="MOD_AI"><AIPageWrapper><AIReportsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-quality-gate"><RouteGuard navHref="/ai-quality-gate" requireModule="MOD_AI"><AIPageWrapper><AIQualityGatePage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-image-search"><RouteGuard navHref="/ai-image-search" requireModule="MOD_AI"><AIPageWrapper><AIImageSearchPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-advanced-vision-lab"><RouteGuard navHref="/ai-advanced-vision-lab" requireModule="MOD_AI"><AIPageWrapper><AdvancedVisionLabPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/anomaly-banks"><RouteGuard navHref="/anomaly-banks" requireModule="MOD_AI"><AnomalyBankPage /></RouteGuard></Route>
      <Route path="/mask-annotation"><RouteGuard navHref="/mask-annotation" requireModule="MOD_AI"><AIPageWrapper><MaskAnnotationPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/causal-graph"><RouteGuard navHref="/causal-graph" requireModule="MOD_AI"><AIPageWrapper><CausalGraphEditorPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-inspection-analytics"><RouteGuard requirePermission="analytics_ai_performance" requireModule="MOD_AI"><AIPageWrapper><AIInspectionAnalyticsPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/ai-gguf-models"><RouteGuard requireRole={["admin"]} requireModule="MOD_AI"><AIPageWrapper><AIGgufModelsPage /></AIPageWrapper></RouteGuard></Route>
      {/* X3: /ai-ab-testing was a deprecated stub → redirect to the B6 canary tab. */}
      <Route path="/ai-ab-testing"><Redirect to="/ai-performance" /></Route>

      {/* ── ADMIN + Master Data / Data Management ────────────────────────── */}
      <Route path="/admin-home"><RouteGuard requireRole={["admin"]}><AdminHome /></RouteGuard></Route>
      <Route path="/users"><RouteGuard navHref="/users"><Users /></RouteGuard></Route>
      <Route path="/role-builder"><RouteGuard navHref="/role-builder"><RoleBuilder /></RouteGuard></Route>
      <Route path="/audit-logs"><RouteGuard requirePermission="admin_system"><AuditLogs /></RouteGuard></Route>
      {/* doc 40 DEV-03 — đưa AdminMonitoring (giám sát slow-query, backend thật) vào app Admin. */}
      <Route path="/admin-monitoring"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AdminMonitoring /></RouteGuard></Route>
      {/* P1 consolidation: enhanced audit is now the "enhanced" tab of the unified Audit page. */}
      <Route path="/enhanced-audit"><Redirect to="/audit-logs?tab=enhanced" /></Route>
      <Route path="/license"><RouteGuard navHref="/license"><LicenseManagement /></RouteGuard></Route>
      <Route path="/api-keys"><RouteGuard navHref="/api-keys"><AIPageWrapper><ApiKeysPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/sites"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><SitesRegistry /></AIPageWrapper></RouteGuard></Route>
      <Route path="/federation-dashboard"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><FederationDashboard /></AIPageWrapper></RouteGuard></Route>
      <Route path="/modules"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><ModulesMarketplace /></AIPageWrapper></RouteGuard></Route>
      <Route path="/synapse-platform"><RouteGuard requireRole={["admin"]} requirePermission="admin_system"><AIPageWrapper><SynapsePlatformPage /></AIPageWrapper></RouteGuard></Route>
      <Route path="/backup-restore"><RouteGuard navHref="/backup-restore"><BackupRestore /></RouteGuard></Route>
      <Route path="/system-config"><RouteGuard requireRole={["admin"]}><SystemConfiguration /></RouteGuard></Route>
      <Route path="/admin-setting"><RouteGuard navHref="/admin-setting"><AdminSettings /></RouteGuard></Route>
      <Route path="/import-export"><RouteGuard requireRole={["admin"]}><ImportExport /></RouteGuard></Route>
      <Route path="/user-assignments"><RouteGuard requireRole={["admin"]} requirePermission="admin_users"><UserAssignments /></RouteGuard></Route>
      <Route path="/corporate-management"><RouteGuard requireRole={["admin"]}><CorporateManagement /></RouteGuard></Route>
      <Route path="/data-management"><RouteGuard navHref="/data-management"><DataManagementHub /></RouteGuard></Route>
      {/* doc 59 Cụm E/H/I — hub-launcher hợp nhất (additive, giữ mọi route con). */}
      <Route path="/product-workspace"><RouteGuard navHref="/product-workspace"><ProductWorkspaceHub /></RouteGuard></Route>
      {/* doc 69 T6 — AIStudioHub retired: merged into AI Home. Old URL keeps working. */}
      <Route path="/ai-studio"><Redirect to="/ai-home" /></Route>
      <Route path="/maintenance-hub"><RouteGuard navHref="/maintenance-hub"><MaintenanceWorkspaceHub /></RouteGuard></Route>
      {/* doc 59 cụm phụ — Settings + Engineering-Studio hub-launcher (additive). */}
      <Route path="/settings-hub"><RouteGuard navHref="/settings-hub"><SettingsHub /></RouteGuard></Route>
      <Route path="/engineering-studio"><RouteGuard navHref="/engineering-studio"><EngineeringStudioHub /></RouteGuard></Route>
      <Route path="/master-data"><RouteGuard navHref="/master-data"><MasterDataManagement /></RouteGuard></Route>
      <Route path="/operator-badges"><RouteGuard navHref="/operator-badges"><OperatorBadges /></RouteGuard></Route>
      <Route path="/component-library"><RouteGuard navHref="/component-library"><AIPageWrapper><ComponentLibrary /></AIPageWrapper></RouteGuard></Route>
      <Route path="/master-data-audit"><RouteGuard navHref="/master-data-audit"><MasterDataAudit /></RouteGuard></Route>
      <Route path="/data-quality"><RouteGuard navHref="/data-quality"><DataQualityDashboard /></RouteGuard></Route>
      {/* doc 46 FE-W2 — semantic-layer Metric Catalog (KPI definitions/versions/lineage, read-only). */}
      <Route path="/metric-catalog"><RouteGuard navHref="/metric-catalog"><MetricCatalog /></RouteGuard></Route>
      <Route path="/products"><RouteGuard navHref="/products"><ProductModels /></RouteGuard></Route>
      <Route path="/product-mapping"><RouteGuard navHref="/product-mapping"><ProductMachineMapping /></RouteGuard></Route>
      {/* Task 1 Khối D — /layout (không :id) gộp vào TwinHub làm tab "layout" (mode edit).
          /layout/:id GIỮ RIÊNG: mang route param mà tab không có, và gate
          requirePermission="settings_factory" khác navHref của route trên. */}
      <Route path="/layout"><Redirect to="/digital-twin?tab=layout" /></Route>
      <Route path="/layout/:id"><RouteGuard requirePermission="settings_factory"><Layout /></RouteGuard></Route>
      <Route path="/workstation-management"><RouteGuard navHref="/workstation-management"><WorkstationManagement /></RouteGuard></Route>
      <Route path="/process-management"><RouteGuard navHref="/process-management"><ProcessManagement /></RouteGuard></Route>
      <Route path="/datasettings"><RouteGuard navHref="/datasettings"><DataSettings /></RouteGuard></Route>
      <Route path="/settings"><RouteGuard requirePermission="settings_view"><Settings /></RouteGuard></Route>
      {/* U7 (doc 21 §6 / §3 G-11) consolidation: the standalone Custom Dashboard is
          already embedded as the default tab of the Dashboard Center hub — redirect
          the loose route in (doc 67 W7: pages/CustomDashboard.tsx deleted — the
          embedded copy lives on as components/CustomDashboardContent.tsx). */}
      <Route path="/custom-dashboard"><Redirect to="/dashboard-center?tab=custom-dashboard" /></Route>

      {/* ── ME (self) — read-open to every authenticated role ─────────────── */}
      {/* P3-W2: full-screen Action Inbox + Today Briefing surfaces (read-open). */}
      <Route path="/inbox"><AIPageWrapper><InboxPage /></AIPageWrapper></Route>
      {/* doc 39 W6 — unified HITL pending-approvals inbox (read-open; the page self-gates
          each section's actions with the same SoD/permission rules as the domain page). */}
      <Route path="/approvals-inbox"><AIPageWrapper><ApprovalsInbox /></AIPageWrapper></Route>
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

// doc64 S5-OPT-2 — kiosk direct-load: RouteGuard chỉ render con SAU khi auth.me về, nên
// chunk trang bị NỐI TIẾP sau auth (POC: /andon 2.252ms, hụt 252ms). Warm chunk của màn
// operator NGAY sau khe paint đầu → fetch+parse chạy SONG SONG với auth RTT (main thread
// đang rảnh chờ mạng). Vite dedupe import() → React.lazy resolve tức thì khi guard mở.
const OPERATOR_ROUTE_WARMERS: Record<string, () => Promise<unknown>> = {
  "/andon": () => import("./pages/AndonBoard"),
  "/dashboard": () => import("./pages/Dashboard"),
  "/line-view": () => import("./pages/LineView"),
  "/device-monitor": () => import("./pages/DeviceHub"),
  "/oee-dashboard": () => import("./pages/OEEDashboard"),
  "/wip-dashboard": () => import("./pages/WipLineBalance"),
  // doc 67 W6 — hai màn command trực-ca cũng direct-load qua RouteGuard nối tiếp auth.
  "/control-tower": () => import("./pages/ControlTower"),
  "/command-center": () => import("./pages/CommandCenter"),
};

function useOperatorRouteWarmer() {
  useEffect(() => {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const base = "/" + (path.split("/")[1] ?? "");
    const warm = OPERATOR_ROUTE_WARMERS[base];
    if (!warm) return;
    // double-rAF: nhường frame đầu paint xong rồi mới parse chunk.
    requestAnimationFrame(() => requestAnimationFrame(() => { void warm(); }));
  }, []);
}

function App() {
  useKioskMode();
  useOperatorRouteWarmer();
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark" switchable>
        {/* F0/F2 (doc 23): SiteProvider — the multi-site scope store. F2 populates
            it from the header SiteSwitcher (admin-gated sites.list) and persists the
            active site to localStorage. Non-admins degrade to a static "All sites". */}
        <SiteProvider>
          {/* doc 64 IA-10 — AssetScopeProvider: trục phạm vi tài sản, localStorage-persisted. */}
          <AssetScopeProvider>
          <TooltipProvider>
            {/* U1 (doc 26): EngineeringProvider — store lastSelected {project/thiết bị/
                workflow} làm fallback cho deep-link golden-thread giữa các trang Kỹ thuật. */}
            <EngineeringProvider>
            <ProgrammingCopilotProvider>
            <AiCopilotProvider>
              <ConnectionBanner />
              <Toaster />
              {/* Wave 1 (foundation): a single top-level Suspense boundary so any
                  code-split page (including bare `component={}` routes like /api-docs)
                  has a fallback while its chunk loads. Per-page AIPageWrapper boundaries
                  still take precedence where present.
                  Wave 1b: AppShell (flag-gated, default OFF) optionally hoists ONE
                  persistent DashboardLayout ABOVE the Suspense so the chrome stays put
                  and only the page content area shows the fallback during lazy loads. */}
              <AppShell>
                <Suspense fallback={<div className="flex items-center justify-center h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>}>
                  {/* ★★★★ Pha 7 / I-4 — CỔNG BUỘC ĐỔI MẬT KHẨU. Nó bọc CHÍNH `<Router/>`: khi khoá,
                      TOÀN BỘ bảng route không được render, nên không có "route lách được" — kể cả
                      các route KHÔNG có <RouteGuard> (`/`, `/login`, `/setup`, `/api-docs`,
                      `/component-showcase`) và kể cả `<Route>` thứ 201 thêm vào ngày mai.
                      ⚠ Đừng hạ nó xuống trong cây (vào RouteGuard hay từng Route): làm thế là biến
                        một lượng từ ∀ thành một DANH SÁCH, đúng lớp lỗi "phần tử thứ N+1". Lưới
                        cấu trúc canh đúng vị trí này: client/src/lib/congDoiMatKhau.unit.test.ts §3. */}
                  <CongDoiMatKhau>
                    <Router />
                  </CongDoiMatKhau>
                </Suspense>
              </AppShell>
              {/* C3a — global copilot bubble: mounted ONCE here (inside the tRPC
                  provider from main.tsx) so it appears on every route, including
                  lazy AI pages. The bubble hides itself when not logged in.
                  doc64 S5-OPT: lazy + fallback null — tải sau first-paint, không chặn LCP. */}
              <Suspense fallback={null}>
                <AILocalChatBubble />
              </Suspense>
              {/* doc 41 — Programming Copilot DOCK: mounted ONCE, renders only when a
                  programming surface (Engineering/IR/POU) has published a binding. */}
              <Suspense fallback={null}>
                <ProgrammingCopilotDock />
              </Suspense>
            </AiCopilotProvider>
            </ProgrammingCopilotProvider>
            </EngineeringProvider>
          </TooltipProvider>
          </AssetScopeProvider>
        </SiteProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
