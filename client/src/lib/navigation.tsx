import {
  Brush,
  BarChart3,
  History,
  LayoutGrid, 
  Settings, 
  FileText, 
  Package, 
  Building2, 
  TrendingUp, 
  Bell, 
  Users, 
  Link, 
  ClipboardList, 
  Wifi,
  Gauge,
  Factory,
  Database,
  Shield,
  BookOpen,
  Radio,
  AlertTriangle,
  Upload,
  Activity,
  Mail,
  Calendar,
  Server,
  UserCog,
  Boxes,
  LineChart,
  PieChart,
  Target,
  Cog,
  FileBarChart,
  MonitorCheck,
  Workflow,
  Brain,
  Wrench,
  Rocket,
  LayoutTemplate,
  Archive,
  Store,
  Timer,
  Play,
  Heart,
  Tags,
  GitCompare,
  GitMerge,
  Map,
  Grid3X3,
  Sparkles,
  Search,
  MessageSquare,
  LayoutDashboard,
  Camera,
  Newspaper,
  Presentation,
  ClipboardCheck,
  ScrollText,
  CalendarClock,
  HardDrive,
  Warehouse,
  GitBranch,
  Cpu,
  Code2,
  Layers,
  Clock,
  Lock,
  KeyRound,
  ShieldCheck,
  GraduationCap,
  Leaf,
  Plug,
  FlaskConical,
  ShieldAlert,
  ShieldQuestion,
  Zap,
  User,
  Monitor,
} from "lucide-react";
import { ReactNode } from "react";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: string | number;
  description?: string;
  requiredRole?: 'admin' | 'user';
  /** Module permission name required to view this item (checked via canView) */
  requiredPermission?: string;
  /** Permission category this item belongs to */
  permissionCategory?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon?: ReactNode;
  items: NavItem[];
  defaultOpen?: boolean;
  description?: string;
  requiredRole?: 'admin' | 'user';
  /** Permission category that controls group visibility */
  permissionCategory?: string;
}

/**
 * Navigation structure — role-aware 8-group IA (doc 12 §7).
 *
 * The sidebar is reorganized into 8 top-level groups by the work people actually
 * do (Overview · Production · Quality · Devices & OT · Analytics · AI · Admin ·
 * Me). Every leaf maps to an EXISTING route. Group + item visibility is filtered
 * by role/permission via getFilteredNavGroups (admin sees all; each group hides
 * when none of its items are visible).
 *
 * Read-open everywhere (no permission gate so EVERY authenticated role — including
 * viewer/user — can reach them): the AI Workspace (chat / inbox / today / copilot)
 * and the personal "Me" group. This implements doc 12 §7's rule that chat/inbox/
 * today are read-open for all roles (fixes P-F8 — decoupled from
 * analytics_ai_performance). The pages themselves still enforce their own RBAC.
 *
 * Labels/descriptions are i18n keys (nav.*); consumers call t(item.label).
 */
export const navGroups: NavGroup[] = [
  // ──────────────────────────────────────────────────────────────────────────
  // 1. OVERVIEW — Dashboard Center · War-Room (Ops Console) · drill-down.
  //    Landing for viewer/user (read-only). defaultOpen so it's the first thing
  //    every role sees.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "overview",
    label: "nav.overviewGroup",
    icon: <Gauge className="h-4 w-4" />,
    description: "nav.overviewGroupDesc",
    defaultOpen: true,
    permissionCategory: "dashboard",
    items: [
      {
        href: "/dashboard",
        label: "nav.dashboardMain",
        icon: <BarChart3 className="h-4 w-4" />,
        description: "nav.dashboardMainDesc",
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
      },
      {
        // P1: unified War-Room / Ops Console (consolidates Andon + Predictive + alerts).
        href: "/ops-console",
        label: "nav.opsConsole",
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "nav.opsConsoleDesc",
        requiredPermission: "andon",
        permissionCategory: "andon",
      },
      {
        href: "/dashboard-center",
        label: "nav.dashboardCenter",
        icon: <LayoutDashboard className="h-4 w-4" />,
        description: "nav.dashboardCenterDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      {
        href: "/drill-down",
        label: "nav.drillDown",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.drillDownDesc",
        requiredPermission: "dashboard_drilldown",
        permissionCategory: "dashboard",
      },
      {
        href: "/corporate-dashboard",
        label: "nav.corporateDashboard",
        icon: <Building2 className="h-4 w-4" />,
        description: "nav.corporateDashboardDesc",
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 2. PRODUCTION — MES (control tower / WIP / trace / twin) · Inspection
  //    (history / AOI packages) · Orders / Schedule / Sessions · BOM.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "production",
    label: "nav.productionGroup",
    icon: <Factory className="h-4 w-4" />,
    description: "nav.productionGroupDesc",
    defaultOpen: false,
    permissionCategory: "production",
    items: [
      {
        href: "/production-dashboard",
        label: "nav.productionDashboard",
        icon: <Gauge className="h-4 w-4" />,
        description: "nav.productionDashboardDesc",
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
      },
      {
        href: "/mes-control-tower",
        label: "nav.mesControlTower",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.mesControlTowerDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/wip-dashboard",
        label: "nav.wipDashboard",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.wipDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/traceability",
        label: "nav.traceability",
        icon: <GitMerge className="h-4 w-4" />,
        description: "nav.traceabilityDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/digital-twin",
        label: "nav.digitalTwin",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.digitalTwinDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/history",
        label: "nav.historyPage",
        icon: <History className="h-4 w-4" />,
        description: "nav.historyPageDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        href: "/aoi-packages",
        label: "nav.aoiPackages",
        icon: <Camera className="h-4 w-4" />,
        description: "nav.aoiPackagesDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        href: "/production-orders",
        label: "nav.productionOrdersPage",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.productionOrdersDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
      },
      {
        href: "/production-scheduling",
        label: "nav.productionScheduling",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.productionSchedulingDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
      },
      {
        href: "/production-signoff",
        label: "nav.productionSignoff",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.productionSignoffDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
      },
      {
        href: "/history-export-scheduling",
        label: "nav.exportSchedule",
        icon: <Calendar className="h-4 w-4" />,
        description: "nav.exportScheduleDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
      },
      {
        href: "/bom-management",
        label: "nav.bomManagement",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.bomManagementDesc",
        requiredPermission: "mes_bom",
        permissionCategory: "mes_bom",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3. QUALITY — Quality Cockpit (Home · Gates · Templates · SPC · Pareto ·
  //    Heatmap · Annotation). Landing for quality_inspector.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "quality",
    label: "nav.qualityGroup",
    icon: <ClipboardCheck className="h-4 w-4" />,
    description: "nav.qualityGroupDesc",
    defaultOpen: false,
    permissionCategory: "history",
    items: [
      {
        href: "/quality-home",
        label: "nav.qualityHome",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.qualityHomeDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
      },
      {
        href: "/quality-gates",
        label: "nav.qualityGates",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.qualityGatesDesc",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
      },
      {
        href: "/quality-gate-templates",
        label: "nav.qualityGateTemplates",
        icon: <LayoutTemplate className="h-4 w-4" />,
        description: "nav.qualityGateTemplatesDesc",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
      },
      {
        href: "/spc-analysis",
        label: "nav.spcAnalysis",
        icon: <Brain className="h-4 w-4" />,
        description: "nav.spcAnalysisDesc",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
      },
      {
        href: "/pareto-analysis",
        label: "nav.paretoAnalysis",
        icon: <BarChart3 className="h-4 w-4" />,
        description: "nav.paretoAnalysisDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      {
        href: "/defect-heatmap",
        label: "nav.defectHeatmap",
        icon: <Map className="h-4 w-4" />,
        description: "nav.defectHeatmapDesc",
        requiredPermission: "analytics_defect_heatmap",
        permissionCategory: "analytics",
      },
      {
        href: "/annotation-statistics",
        label: "nav.annotationStatistics",
        icon: <Brush className="h-4 w-4" />,
        description: "nav.annotationStatisticsDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      {
        href: "/annotation-comparison",
        label: "nav.annotationComparison",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.annotationComparisonDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4. DEVICES & OT — realtime status/health · device adapters / edge / MQTT ·
  //    Engineering & Control (programming / interlock / recipe) · Maintenance.
  //    Landing for maintenance.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "devices",
    label: "nav.devicesGroup",
    icon: <Cpu className="h-4 w-4" />,
    description: "nav.devicesGroupDesc",
    defaultOpen: false,
    permissionCategory: "machine_monitoring",
    items: [
      // — Status & health —
      {
        href: "/machine-status",
        label: "nav.machineStatusPage",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.machineStatusDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/machine-health",
        label: "nav.machineHealth",
        icon: <Heart className="h-4 w-4" />,
        description: "nav.machineHealthDesc",
        requiredPermission: "analytics_machine_health",
        permissionCategory: "analytics",
      },
      {
        href: "/oee-dashboard",
        label: "nav.oeeDashboard",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.oeeDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/factory-live-map",
        label: "nav.factoryLiveMap",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.factoryLiveMapDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      // — MQTT / telemetry —
      {
        href: "/mqtt-dashboard",
        label: "nav.mqttDashboard",
        icon: <Radio className="h-4 w-4" />,
        description: "nav.mqttDashboardDesc",
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
      },
      {
        href: "/mqtt-bulletin",
        label: "nav.mqttBulletin",
        icon: <Newspaper className="h-4 w-4" />,
        description: "nav.mqttBulletinDesc",
        requiredPermission: "mqtt_bulletin",
        permissionCategory: "mqtt",
      },
      {
        href: "/mqtt-replay",
        label: "nav.mqttReplay",
        icon: <Play className="h-4 w-4" />,
        description: "nav.mqttReplayDesc",
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
      },
      {
        href: "/mqtt-clients",
        label: "nav.mqttClients",
        icon: <Wifi className="h-4 w-4" />,
        description: "nav.mqttClientsDesc",
        requiredRole: 'admin',
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
      },
      // — Onboarding & adapters —
      {
        href: "/machine-onboarding",
        label: "nav.machineOnboarding",
        icon: <Rocket className="h-4 w-4" />,
        description: "nav.machineOnboardingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/machine-registration",
        label: "nav.machineRegistration",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.machineRegistrationDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/device-adapters",
        label: "nav.deviceAdapters",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.deviceAdaptersDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        href: "/edge-nodes",
        label: "nav.edgeNodes",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.edgeNodesDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      // — Engineering & Control —
      {
        href: "/engineering",
        label: "nav.engineeringWorkspace",
        icon: <Code2 className="h-4 w-4" />,
        description: "nav.engineeringWorkspaceDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        href: "/recipes",
        label: "nav.recipes",
        icon: <FlaskConical className="h-4 w-4" />,
        description: "nav.recipesDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        href: "/interlock-rules",
        label: "nav.interlockRules",
        icon: <ShieldAlert className="h-4 w-4" />,
        description: "nav.interlockRulesDesc",
        requiredPermission: "interlock",
        permissionCategory: "interlock",
      },
      {
        href: "/orchestration-studio",
        label: "nav.orchestrationStudio",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.orchestrationStudioDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        href: "/factory-floor-editor",
        label: "nav.factoryFloorEditor",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.factoryFloorEditorDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        href: "/rf-test-cell",
        label: "nav.rfTestCell",
        icon: <Radio className="h-4 w-4" />,
        description: "nav.rfTestCellDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      {
        href: "/cell-twin",
        label: "nav.cellTwin",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.cellTwinDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
      },
      // — Maintenance / predictive —
      {
        href: "/technician-copilot",
        label: "nav.technicianCopilot",
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.technicianCopilotDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/work-orders",
        label: "nav.workOrders",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.workOrdersDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/alerts",
        label: "nav.alertsList",
        icon: <Bell className="h-4 w-4" />,
        description: "nav.alertsListDesc",
        requiredPermission: "mqtt_alerts",
        permissionCategory: "mqtt",
      },
      {
        href: "/mqtt-alerts",
        label: "nav.alertRules",
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "nav.alertRulesDesc",
        requiredPermission: "mqtt_alerts",
        permissionCategory: "mqtt",
      },
      {
        href: "/monitoring-setting",
        label: "nav.monitoringSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.monitoringSettingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 5. ANALYTICS — Reports / scheduled / builder · Category / Correlation /
  //    Comparison · Energy / Carbon · realtime report · threshold approvals.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "analytics",
    label: "nav.analyticsGroup",
    icon: <LineChart className="h-4 w-4" />,
    description: "nav.analyticsGroupDesc",
    defaultOpen: false,
    permissionCategory: "analytics",
    items: [
      {
        href: "/reports",
        label: "nav.reportsPage",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.reportsPageDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
      },
      {
        href: "/scheduled-reports",
        label: "nav.scheduledReports",
        icon: <CalendarClock className="h-4 w-4" />,
        description: "nav.scheduledReportsDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
      },
      {
        href: "/report-builder",
        label: "nav.reportBuilder",
        icon: <FileText className="h-4 w-4" />,
        description: "nav.reportBuilderDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
      },
      {
        href: "/category-analytics",
        label: "nav.categoryAnalytics",
        icon: <PieChart className="h-4 w-4" />,
        description: "nav.categoryAnalyticsDesc",
        requiredPermission: "analytics_category",
        permissionCategory: "analytics",
      },
      {
        href: "/correlation-analysis",
        label: "nav.correlationAnalysis",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.correlationAnalysisDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      {
        href: "/data-comparison",
        label: "nav.dataComparison",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.dataComparisonDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      {
        href: "/realtime-report",
        label: "nav.realtimeReport",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.realtimeReportDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/energy-analytics",
        label: "nav.energyAnalytics",
        icon: <Zap className="h-4 w-4" />,
        description: "nav.energyAnalyticsDesc",
        requiredPermission: "energy",
        permissionCategory: "analytics",
      },
      {
        href: "/carbon-dashboard",
        label: "nav.carbonDashboard",
        icon: <Leaf className="h-4 w-4" />,
        description: "nav.carbonDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
      },
      {
        href: "/pdf-reports",
        label: "nav.pdfReports",
        icon: <FileText className="h-4 w-4" />,
        description: "nav.pdfReportsDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
      },
      {
        href: "/powerpoint-export",
        label: "nav.powerpointExport",
        icon: <Presentation className="h-4 w-4" />,
        description: "nav.powerpointExportDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
      },
      {
        href: "/threshold-approvals",
        label: "nav.thresholdApprovals",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.thresholdApprovalsDesc",
        requiredPermission: "settings_alerts",
        permissionCategory: "analytics",
      },
      {
        href: "/oee-target-settings",
        label: "nav.oeeTargets",
        icon: <Target className="h-4 w-4" />,
        description: "nav.oeeTargetsDesc",
        requiredPermission: "analytics_oee_targets",
        permissionCategory: "analytics",
      },
      {
        href: "/analytics-setting",
        label: "nav.analyticsSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.analyticsSettingDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 6. AI — AI Workspace (chat / copilot / management-insight) is READ-OPEN to
  //    EVERY role (no requiredPermission). AI Control Plane / AI Ops / AI Vision
  //    are admin-gated (requiredRole:'admin').
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "ai",
    label: "nav.aiGroup",
    icon: <Sparkles className="h-4 w-4" />,
    description: "nav.aiGroupDesc",
    defaultOpen: false,
    // No permissionCategory → group is visible to every authenticated role; the
    // AI Workspace items below are read-open. Admin-only items below still gate.
    items: [
      // ─ AI Workspace (read-open, all roles) ─
      {
        href: "/ai-chat",
        label: "nav.aiChat",
        icon: <MessageSquare className="h-4 w-4" />,
        description: "nav.aiChatDesc",
      },
      {
        href: "/ai-hub",
        label: "nav.aiHub",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.aiHubDesc",
      },
      {
        href: "/management-insight",
        label: "nav.managementInsight",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.managementInsightDesc",
      },
      // ─ AI Control Plane (admin) ─
      {
        href: "/ai-brain",
        label: "nav.aiBrainDashboard",
        icon: <Brain className="h-4 w-4" />,
        description: "nav.aiBrainDashboardDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-monitoring",
        label: "nav.aiMonitoring",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.aiMonitoringDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-performance",
        label: "nav.aiPerformance",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.aiPerformanceDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-models",
        label: "nav.aiModelManagement",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.aiModelManagementDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/model-versions",
        label: "nav.modelVersions",
        icon: <GitBranch className="h-4 w-4" />,
        description: "nav.modelVersionsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-settings",
        label: "nav.aiSettings",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.aiSettingsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      // ─ AI Ops (admin) ─
      {
        href: "/ai-active-learning",
        label: "nav.aiActiveLearning",
        icon: <GraduationCap className="h-4 w-4" />,
        description: "nav.aiActiveLearningDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-batch-jobs",
        label: "nav.aiBatchJobs",
        icon: <Layers className="h-4 w-4" />,
        description: "nav.aiBatchJobsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-data-processing",
        label: "nav.aiDataProcessing",
        icon: <Database className="h-4 w-4" />,
        description: "nav.aiDataProcessingDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-time-series",
        label: "nav.aiTimeSeries",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.aiTimeSeriesDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-reports",
        label: "nav.aiReports",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.aiReportsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      // ─ AI Vision (admin) ─
      {
        href: "/ai-quality-gate",
        label: "nav.aiQualityGate",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.aiQualityGateDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-image-search",
        label: "nav.aiImageSearch",
        icon: <Search className="h-4 w-4" />,
        description: "nav.aiImageSearchDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/ai-advanced-vision-lab",
        label: "nav.advancedVisionLab",
        icon: <Camera className="h-4 w-4" />,
        description: "nav.advancedVisionLabDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/anomaly-banks",
        label: "nav.anomalyBanks",
        icon: <Database className="h-4 w-4" />,
        description: "nav.anomalyBanksDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/mask-annotation",
        label: "nav.maskAnnotation",
        icon: <Brush className="h-4 w-4" />,
        description: "nav.maskAnnotationDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/causal-graph",
        label: "nav.causalGraph",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.causalGraphDesc",
        requiredPermission: "analytics_root_cause",
        permissionCategory: "analytics",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 7. ADMIN — Admin & Security (hub / users / roles / audit / license / backup
  //    / api keys / sessions) · Master Data / Data Management. Landing for admin.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "admin",
    label: "nav.adminGroup",
    icon: <Shield className="h-4 w-4" />,
    description: "nav.adminGroupDesc",
    defaultOpen: false,
    requiredRole: 'admin',
    permissionCategory: "admin",
    items: [
      {
        href: "/admin-home",
        label: "nav.adminHome",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.adminHomeDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
      },
      {
        href: "/users",
        label: "nav.usersPage",
        icon: <Users className="h-4 w-4" />,
        description: "nav.usersPageDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
      },
      {
        href: "/role-builder",
        label: "nav.roleBuilder",
        icon: <UserCog className="h-4 w-4" />,
        description: "nav.roleBuilderDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
      },
      {
        href: "/audit-logs?tab=enhanced",
        label: "nav.enhancedAudit",
        icon: <ScrollText className="h-4 w-4" />,
        description: "nav.enhancedAuditDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      {
        href: "/license",
        label: "nav.licenseManagement",
        icon: <KeyRound className="h-4 w-4" />,
        description: "nav.licenseManagementDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      {
        href: "/api-keys",
        label: "nav.apiKeys",
        icon: <KeyRound className="h-4 w-4" />,
        description: "nav.apiKeysDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      {
        href: "/backup-restore",
        label: "nav.backupRestore",
        icon: <Archive className="h-4 w-4" />,
        description: "nav.backupRestoreDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      {
        href: "/sessions",
        label: "nav.sessions",
        icon: <Monitor className="h-4 w-4" />,
        description: "nav.sessionsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      // — Master Data / Data Management —
      {
        href: "/master-data",
        label: "nav.masterData",
        icon: <Tags className="h-4 w-4" />,
        description: "nav.masterDataDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
      },
      {
        href: "/products",
        label: "nav.productsPage",
        icon: <Package className="h-4 w-4" />,
        description: "nav.productsPageDesc",
        requiredPermission: "settings_products",
        permissionCategory: "settings",
      },
      {
        href: "/product-mapping",
        label: "nav.productMapping",
        icon: <Link className="h-4 w-4" />,
        description: "nav.productMappingDesc",
        requiredPermission: "settings_product_mapping",
        permissionCategory: "settings",
      },
      {
        href: "/layout",
        label: "nav.factoryLayout",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.factoryLayoutDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
      },
      {
        href: "/workstation-management",
        label: "nav.workstationManagement",
        icon: <Warehouse className="h-4 w-4" />,
        description: "nav.workstationManagementDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
      },
      {
        href: "/process-management",
        label: "nav.processManagement",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.processManagementDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
      },
      {
        href: "/datasettings",
        label: "nav.dataSettingsPage",
        icon: <Database className="h-4 w-4" />,
        description: "nav.dataSettingsPageDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
      },
      {
        href: "/corporate-management",
        label: "nav.corporateManagement",
        icon: <Settings className="h-4 w-4" />,
        description: "nav.corporateManagementDesc",
        requiredRole: 'admin',
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
      },
      {
        href: "/settings",
        label: "nav.generalSettings",
        icon: <Settings className="h-4 w-4" />,
        description: "nav.generalSettingsDesc",
        requiredPermission: "settings_view",
        permissionCategory: "settings",
      },
      {
        href: "/admin-setting",
        label: "nav.adminSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.adminSettingDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 8. ME (self) — personal surfaces, READ-OPEN to every authenticated role
  //    (no permission gate). Profile · Operator inbox/today shell · Request role
  //    · User guide · About.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "me",
    label: "nav.meGroup",
    icon: <User className="h-4 w-4" />,
    description: "nav.meGroupDesc",
    defaultOpen: false,
    items: [
      {
        href: "/operator",
        label: "nav.operatorHome",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.operatorHomeDesc",
      },
      {
        href: "/profile",
        label: "nav.profile",
        icon: <User className="h-4 w-4" />,
        description: "nav.profileDesc",
      },
      {
        href: "/change-password",
        label: "nav.changePassword",
        icon: <Lock className="h-4 w-4" />,
        description: "nav.changePasswordDesc",
      },
      {
        href: "/request-role",
        label: "nav.requestRole",
        icon: <ShieldQuestion className="h-4 w-4" />,
        description: "nav.requestRoleDesc",
      },
      {
        href: "/user-guide",
        label: "nav.userGuide",
        icon: <BookOpen className="h-4 w-4" />,
        description: "nav.userGuideDesc",
      },
      {
        href: "/about-system",
        label: "nav.aboutSystem",
        icon: <Building2 className="h-4 w-4" />,
        description: "nav.aboutSystemDesc",
      },
    ],
  },
];

// Flat navigation items for backward compatibility
export const navItems: NavItem[] = navGroups.flatMap(group => group.items);

// Helper to get group by item href
export function getGroupByHref(href: string): NavGroup | undefined {
  return navGroups.find(group => group.items.some(item => item.href === href));
}

type PermissionChecker = (moduleName: string, action: string) => boolean;
type CategoryChecker = (category: string) => boolean;

/**
 * Check if a single nav item is accessible based on role + permissions
 */
function isItemAccessible(
  item: NavItem,
  userRole?: string,
  hasPermission?: PermissionChecker,
): boolean {
  // Admin bypasses all checks
  if (userRole === 'admin') return true;

  // Legacy role-based gate (still enforced even with permissions)
  if (item.requiredRole === 'admin' && userRole !== 'admin') {
    return false;
  }

  // Permission-based gate (if permission checker is provided and item has a mapping)
  if (hasPermission && item.requiredPermission) {
    return hasPermission(item.requiredPermission, 'canView');
  }

  // No permission mapping -> visible by default (backward compat)
  return true;
}

/**
 * Check if user has access to a navigation group
 */
export function hasAccessToGroup(
  groupId: string,
  userRole?: string,
  hasPermission?: PermissionChecker,
  hasAnyCategoryPermission?: CategoryChecker,
): boolean {
  const group = navGroups.find(g => g.id === groupId);
  if (!group) return false;

  // Admin bypasses
  if (userRole === 'admin') return true;

  // Legacy role gate
  if (group.requiredRole === 'admin' && userRole !== 'admin') {
    return false;
  }

  // If we have permission checkers, verify at least one child item is visible
  if (hasPermission) {
    return group.items.some(item => isItemAccessible(item, userRole, hasPermission));
  }

  return true;
}

/**
 * Check if user has access to a specific navigation item
 */
export function hasAccessToItem(
  href: string,
  userRole?: string,
  hasPermission?: PermissionChecker,
): boolean {
  for (const group of navGroups) {
    const item = group.items.find(i => i.href === href);
    if (item) {
      // Check group-level first
      if (group.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      return isItemAccessible(item, userRole, hasPermission);
    }
  }
  return false;
}

/**
 * Get filtered navigation groups based on user role AND granular permissions.
 */
export function getFilteredNavGroups(
  userRole?: string,
  hasPermission?: PermissionChecker,
  hasAnyCategoryPermission?: CategoryChecker,
): NavGroup[] {
  // Admin sees everything
  if (userRole === 'admin') return navGroups;

  return navGroups
    .filter(group => {
      // Legacy role gate
      if (group.requiredRole === 'admin' && userRole !== 'admin') {
        return false;
      }
      // Quick category-level check if available
      if (hasAnyCategoryPermission && group.permissionCategory) {
        return hasAnyCategoryPermission(group.permissionCategory);
      }
      return true;
    })
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        isItemAccessible(item, userRole, hasPermission),
      ),
    }))
    .filter(group => group.items.length > 0);
}