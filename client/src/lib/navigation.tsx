import { 
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
  LayoutTemplate,
  Archive,
  Store,
  Timer,
  Play,
  Heart,
  Tags,
  GitCompare,
  Map,
  Grid3X3,
  Sparkles,
  Search,
  MessageSquare,
  LayoutDashboard,
  Camera,
  Newspaper,
  Presentation,
  GitCompareArrows,
  ClipboardCheck,
  ScrollText,
  CalendarClock,
  HardDrive,
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
    ],
  },

  // 3. MONITORING
  {
    id: "monitoring",
    label: "nav.monitoringGroup",
    icon: <Activity className="h-4 w-4" />,
    description: "nav.monitoringGroupDesc",
    defaultOpen: true,
    permissionCategory: "machine_monitoring",
    items: [
      { 
        href: "/machine-status", 
        label: "nav.machineStatusPage", 
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.machineStatusDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      {
        href: "/machine-registration",
        label: "nav.machineRegistration",
        icon: <HardDrive className="h-4 w-4" />,
        description: "nav.machineRegistrationDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
      },
      { 
        href: "/mqtt-dashboard", 
        label: "nav.mqttDashboard", 
        icon: <Radio className="h-4 w-4" />,
        description: "nav.mqttDashboardDesc",
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
      },
      { 
        href: "/mqtt-clients", 
        label: "nav.mqttClients", 
        icon: <Wifi className="h-4 w-4" />,
        description: "nav.mqttClientsDesc",
        requiredPermission: "mqtt_configure",
        permissionCategory: "mqtt",
      },
      { 
        href: "/mqtt-topics", 
        label: "nav.mqttTopics", 
        icon: <MessageSquare className="h-4 w-4" />,
        description: "nav.mqttTopicsDesc",
        requiredPermission: "mqtt_view",
        permissionCategory: "mqtt",
      },
      { 
        href: "/mqtt-replay", 
        label: "nav.mqttReplay", 
        icon: <Play className="h-4 w-4" />,
        description: "nav.mqttReplayDesc",
        requiredPermission: "mqtt_replay",
        permissionCategory: "mqtt",
      },
      { 
        href: "/mqtt-profiles", 
        label: "nav.mqttProfiles", 
        icon: <Server className="h-4 w-4" />,
        description: "nav.mqttProfilesDesc",
        requiredPermission: "mqtt_profiles",
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
    ],
  },

  // 4. ALERTS
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

  // 5. PRODUCTION
  {
    id: "production",
    label: "nav.productionGroup",
    icon: <Factory className="h-4 w-4" />,
    description: "nav.productionGroupDesc",
    defaultOpen: true,
    permissionCategory: "production",
    items: [
      { 
        href: "/production-orders", 
        label: "nav.productionOrdersPage", 
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.productionOrdersDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
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
        href: "/production-scheduling",
        label: "nav.productionScheduling",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.productionSchedulingDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
      },
    ],
  },

  // 6. ANALYTICS
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
        label: "nav.scheduledReportsPage", 
        icon: <Calendar className="h-4 w-4" />,
        description: "nav.scheduledReportsDesc",
        requiredPermission: "reports_schedule",
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
        href: "/spc-advanced", 
        label: "nav.spcAdvanced", 
        icon: <LineChart className="h-4 w-4" />,
        description: "nav.spcAdvancedDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      { 
        href: "/correlation-analysis", 
        label: "nav.correlationAnalysis", 
        icon: <Grid3X3 className="h-4 w-4" />,
        description: "nav.correlationAnalysisDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      { 
        href: "/quality-gates", 
        label: "nav.qualityGates", 
        icon: <Shield className="h-4 w-4" />,
        description: "nav.qualityGatesDesc",
        requiredPermission: "analytics_advanced",
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
        href: "/quality-gate-templates",
        label: "nav.qualityGateTemplates",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.qualityGateTemplatesDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      { 
        href: "/annotation-statistics", 
        label: "nav.annotationStats", 
        icon: <Tags className="h-4 w-4" />,
        description: "nav.annotationStatsDesc",
        requiredPermission: "annotation_view",
        permissionCategory: "annotations",
      },
      { 
        href: "/annotation-comparison", 
        label: "nav.annotationComparison", 
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.annotationComparisonDesc",
        requiredPermission: "annotation_view",
        permissionCategory: "annotations",
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
        href: "/defect-prediction", 
        label: "nav.defectPrediction", 
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.defectPredictionDesc",
        requiredPermission: "analytics_defect_prediction",
        permissionCategory: "analytics",
      },
      { 
        href: "/root-cause-analysis", 
        label: "nav.rootCauseAnalysis", 
        icon: <Search className="h-4 w-4" />,
        description: "nav.rootCauseAnalysisDesc",
        requiredPermission: "analytics_root_cause",
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
        href: "/data-comparison", 
        label: "nav.dataComparison", 
        icon: <GitCompareArrows className="h-4 w-4" />,
        description: "nav.dataComparisonDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
      },
      { 
        href: "/report-builder", 
        label: "nav.reportBuilder", 
        icon: <LayoutTemplate className="h-4 w-4" />,
        description: "nav.reportBuilderDesc",
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
        href: "/enhanced-scheduled-reports", 
        label: "nav.enhancedScheduledReports", 
        icon: <CalendarClock className="h-4 w-4" />,
        description: "nav.enhancedScheduledReportsDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
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
    ],
  },

  // 8. PROCESS MANAGEMENT
  {
    id: "process-management",
    label: "nav.processGroup",
    icon: <Workflow className="h-4 w-4" />,
    description: "nav.processGroupDesc",
    defaultOpen: false,
    requiredRole: 'admin',
    permissionCategory: "settings",
    items: [
      { 
        href: "/process-management", 
        label: "nav.processPage", 
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.processPageDesc",
        requiredRole: 'admin',
        requiredPermission: "settings_process",
        permissionCategory: "settings",
      },
      { 
        href: "/workstation-management", 
        label: "nav.workstationPage", 
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.workstationPageDesc",
        requiredRole: 'admin',
        requiredPermission: "settings_workstations",
        permissionCategory: "settings",
      },
    ],
  },

  // 9. SETTINGS
  {
    id: "settings",
    label: "nav.settingsGroup",
    icon: <Settings className="h-4 w-4" />,
    description: "nav.settingsGroupDesc",
    defaultOpen: false,
    permissionCategory: "settings",
    items: [
      { 
        href: "/settings", 
        label: "nav.generalSettings", 
        icon: <Cog className="h-4 w-4" />,
        description: "nav.generalSettingsDesc",
        requiredPermission: "settings_view",
        permissionCategory: "settings",
      },
      { 
        href: "/settings?tab=notification-sounds", 
        label: "nav.notificationSounds", 
        icon: <Bell className="h-4 w-4" />,
        description: "nav.notificationSoundsDesc",
        requiredPermission: "settings_notification_sounds",
        permissionCategory: "settings",
      },
      { 
        href: "/system-config", 
        label: "nav.systemConfig", 
        icon: <Server className="h-4 w-4" />,
        description: "nav.systemConfigDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
      },
      { 
        href: "/backup-restore", 
        label: "nav.backupRestore", 
        icon: <Archive className="h-4 w-4" />,
        description: "nav.backupRestoreDesc",
        requiredRole: "admin",
        requiredPermission: "admin_backup",
        permissionCategory: "admin",
      },
      { 
        href: "/import-export", 
        label: "nav.importExport", 
        icon: <Upload className="h-4 w-4" />,
        description: "nav.importExportDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_import_export",
        permissionCategory: "admin",
      },
    ],
  },

  // 10. ADMIN
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
        href: "/user-assignments", 
        label: "nav.userAssignments", 
        icon: <UserCog className="h-4 w-4" />,
        description: "nav.userAssignmentsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_permissions",
        permissionCategory: "admin",
      },
      { 
        href: "/role-builder", 
        label: "nav.roleBuilder", 
        icon: <Shield className="h-4 w-4" />,
        description: "nav.roleBuilderDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_roles",
        permissionCategory: "admin",
      },
      { 
        href: "/enhanced-audit", 
        label: "nav.auditTrail", 
        icon: <ScrollText className="h-4 w-4" />,
        description: "nav.auditTrailDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_audit",
        permissionCategory: "admin",
      },
      { 
        href: "/api-docs", 
        label: "nav.apiDocsPage", 
        icon: <FileText className="h-4 w-4" />,
        description: "nav.apiDocsPageDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_api_docs",
        permissionCategory: "admin",
      },
      { 
        href: "/user-guide", 
        label: "nav.userGuide", 
        icon: <BookOpen className="h-4 w-4" />,
        description: "nav.userGuideDesc",
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