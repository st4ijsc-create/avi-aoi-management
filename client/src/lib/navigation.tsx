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
  Zap,
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
 * Navigation structure organized by functional categories.
 * Labels and descriptions use i18n translation keys (nav.*).
 * Components consuming these should use t(item.label) and t(item.description) to translate.
 */
export const navGroups: NavGroup[] = [
  // 1. DASHBOARD
  {
    id: "dashboard",
    label: "nav.dashboardGroup",
    icon: <Gauge className="h-4 w-4" />,
    description: "nav.dashboardGroupDesc",
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
        href: "/drill-down", 
        label: "nav.drillDown", 
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.drillDownDesc",
        requiredPermission: "dashboard_drilldown",
        permissionCategory: "dashboard",
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
    ],
  },

  // 1b. AI ASSISTANT — top-level shortcut so technicians/operators reach the
  // AI chat in ≤1 click (the full chat also stays under the AI Analytics group).
  // No requiredRole / requiredPermission / permissionCategory → visible to every
  // authenticated role (operator, maintenance, supervisor, …); the chat page
  // itself enforces its own access. License gating still applies per-route.
  {
    id: "ai-assistant",
    label: "nav.aiAssistantGroup",
    icon: <Sparkles className="h-4 w-4" />,
    description: "nav.aiAssistantGroupDesc",
    defaultOpen: false,
    items: [
      {
        href: "/ai-chat",
        label: "nav.aiAssistant",
        icon: <MessageSquare className="h-4 w-4" />,
        description: "nav.aiAssistantDesc",
      },
    ],
  },

  // 2. CORPORATE
  {
    id: "corporate",
    label: "nav.corporateGroup",
    icon: <Building2 className="h-4 w-4" />,
    description: "nav.corporateGroupDesc",
    defaultOpen: false,
    requiredRole: 'admin',
    permissionCategory: "dashboard",
    items: [
      { 
        href: "/corporate-dashboard", 
        label: "nav.corporateDashboard", 
        icon: <Building2 className="h-4 w-4" />,
        description: "nav.corporateDashboardDesc",
        requiredRole: 'admin',
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
      },
      { 
        href: "/corporate-layout", 
        label: "nav.corporateStructure", 
        icon: <Building2 className="h-4 w-4" />,
        description: "nav.corporateStructureDesc",
        requiredRole: 'admin',
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
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
    ],
  },

  // 3. PRODUCTION
  {
    id: "production",
    label: "nav.productionGroup",
    icon: <Factory className="h-4 w-4" />,
    description: "nav.productionGroupDesc",
    defaultOpen: true,
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
        href: "/history-export-scheduling", 
        label: "nav.exportSchedule", 
        icon: <Calendar className="h-4 w-4" />,
        description: "nav.exportScheduleDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
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
    ],
  },

  // 4. MONITORING
  {
    id: "monitoring",
    label: "nav.monitoringGroup",
    icon: <Activity className="h-4 w-4" />,
    description: "nav.monitoringGroupDesc",
    defaultOpen: true,
    permissionCategory: "machine_monitoring",
    items: [
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
        href: "/machine-status",
        label: "nav.machineStatusPage",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.machineStatusDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/machine-onboarding",
        label: "nav.machineOnboarding",
        icon: <Rocket className="h-4 w-4" />,
        description: "nav.machineOnboardingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
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
        href: "/machine-health", 
        label: "nav.machineHealth", 
        icon: <Heart className="h-4 w-4" />,
        description: "nav.machineHealthDesc",
        requiredPermission: "analytics_machine_health",
        permissionCategory: "analytics",
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
        href: "/realtime-report", 
        label: "nav.realtimeReport", 
        icon: <Activity className="h-4 w-4" />,
        description: "nav.realtimeReportDesc",
        requiredPermission: "analytics_oee",
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
        href: "/energy-analytics",
        label: "nav.energyAnalytics",
        icon: <Zap className="h-4 w-4" />,
        description: "nav.energyAnalyticsDesc",
        requiredPermission: "energy",
        permissionCategory: "analytics",
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

  // 5. ANALYTICS
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
        href: "/category-analytics", 
        label: "nav.categoryAnalytics", 
        icon: <PieChart className="h-4 w-4" />,
        description: "nav.categoryAnalyticsDesc",
        requiredPermission: "analytics_category",
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
        href: "/defect-heatmap", 
        label: "nav.defectHeatmap", 
        icon: <Map className="h-4 w-4" />,
        description: "nav.defectHeatmapDesc",
        requiredPermission: "analytics_defect_heatmap",
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
        href: "/analytics-setting", 
        label: "nav.analyticsSetting", 
        icon: <Cog className="h-4 w-4" />,
        description: "nav.analyticsSettingDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
      },
    ],
  },

  // 6. AI ANALYTICS
  {
    id: "ai-analytics",
    label: "nav.aiAnalyticsGroup",
    icon: <Brain className="h-4 w-4" />,
    description: "nav.aiAnalyticsGroupDesc",
    defaultOpen: false,
    permissionCategory: "analytics",
    items: [
      // -- Core --
      {
        href: "/ai-hub",
        label: "nav.aiHub",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.aiHubDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/ai-chat",
        label: "nav.aiChat",
        icon: <MessageSquare className="h-4 w-4" />,
        description: "nav.aiChatDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      // -- Quality & Learning --
      {
        href: "/ai-quality-gate",
        label: "nav.aiQualityGate",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.aiQualityGateDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/ai-active-learning",
        label: "nav.aiActiveLearning",
        icon: <GraduationCap className="h-4 w-4" />,
        description: "nav.aiActiveLearningDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/mask-annotation",
        label: "nav.maskAnnotation",
        icon: <Brush className="h-4 w-4" />,
        description: "nav.maskAnnotationDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      // -- Analysis & Search --
      {
        href: "/ai-image-search",
        label: "nav.aiImageSearch",
        icon: <Search className="h-4 w-4" />,
        description: "nav.aiImageSearchDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/ai-reports",
        label: "nav.aiReports",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.aiReportsDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/ai-time-series",
        label: "nav.aiTimeSeries",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.aiTimeSeriesDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/ai-data-processing",
        label: "nav.aiDataProcessing",
        icon: <Database className="h-4 w-4" />,
        description: "nav.aiDataProcessingDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      // -- Performance & Operations --
      {
        href: "/ai-performance",
        label: "nav.aiPerformance",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.aiPerformanceDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/ai-batch-jobs",
        label: "nav.aiBatchJobs",
        icon: <Layers className="h-4 w-4" />,
        description: "nav.aiBatchJobsDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      // X3: standalone "A/B Testing" nav removed — the live A/B canary now lives
      // as a tab in the AI Performance Dashboard (/ai-performance).
      {
        href: "/ai-monitoring",
        label: "nav.aiMonitoring",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.aiMonitoringDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      // -- Model Management --
      {
        href: "/ai-models",
        label: "nav.aiModelManagement",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.aiModelManagementDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
      },
      {
        href: "/model-versions",
        label: "nav.modelVersions",
        icon: <GitBranch className="h-4 w-4" />,
        description: "nav.modelVersionsDesc",
        requiredPermission: "analytics_ai_performance",
        permissionCategory: "analytics",
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
    ],
  },

  // 6b. OT / MACHINE CONTROL (Sprint G2.2a — config + audit; no write-to-device path here)
  {
    id: "ot-control",
    label: "nav.otGroup",
    icon: <Cpu className="h-4 w-4" />,
    description: "nav.otGroupDesc",
    defaultOpen: false,
    permissionCategory: "machine_control",
    items: [
      {
        href: "/andon",
        label: "nav.andonBoard",
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "nav.andonBoardDesc",
        requiredPermission: "andon",
        permissionCategory: "andon",
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
        href: "/command-audit",
        label: "nav.commandAudit",
        icon: <ScrollText className="h-4 w-4" />,
        description: "nav.commandAuditDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
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

  // 7. DATA MANAGEMENT
  {
    id: "data-management",
    label: "nav.dataGroup",
    icon: <Database className="h-4 w-4" />,
    description: "nav.dataGroupDesc",
    defaultOpen: false,
    permissionCategory: "settings",
    items: [
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
        href: "/datasettings", 
        label: "nav.dataSettingsPage", 
        icon: <Database className="h-4 w-4" />,
        description: "nav.dataSettingsPageDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
      },
    ],
  },

  // 8. ALERTS
  {
    id: "alerts",
    label: "nav.alertsGroup",
    icon: <Bell className="h-4 w-4" />,
    description: "nav.alertsGroupDesc",
    defaultOpen: false,
    permissionCategory: "mqtt",
    items: [
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
        href: "/predictive-alerts", 
        label: "nav.predictiveAlerts", 
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.predictiveAlertsDesc",
        requiredPermission: "analytics_predictive_alerts",
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
    ],
  },

  // 9. SETTINGS — General Settings
  {
    id: "settings",
    label: "nav.generalSettings",
    icon: <Settings className="h-4 w-4" />,
    description: "nav.generalSettingsDesc",
    defaultOpen: false,
    permissionCategory: "settings",
    items: [
      { 
        href: "/settings", 
        label: "nav.generalSettings", 
        icon: <Settings className="h-4 w-4" />,
        description: "nav.generalSettingsDesc",
        requiredPermission: "settings_view",
        permissionCategory: "settings",
      },
    ],
  },

  // 10. ADMIN — System Administration
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
        href: "/users", 
        label: "nav.usersPage", 
        icon: <Users className="h-4 w-4" />,
        description: "nav.usersPageDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
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