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
  FileCode2,
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
  Inbox,
  Sun,
  Bot,
  Network,
  Globe,
  Share2,
} from "lucide-react";
import { ReactNode } from "react";

/**
 * Menu "tier" (doc 22 P4 — Simple vs Advanced mode).
 *   - `simple`   → everyday surface shown to non-technical roles by default.
 *   - `advanced` → engineering-heavy surface hidden behind the Advanced toggle.
 * Untagged items/groups are treated as `simple` (visible in both modes) so nothing
 * is ever hidden by accident — tagging is opt-IN to advanced-only.
 */
export type NavTier = 'simple' | 'advanced';

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
  /** Cấp-2 section key; items sharing a key are grouped under one sub-header (i18n nav.section.<key>) */
  section?: string;
  /**
   * Menu tier (doc 22 P4). `advanced` → engineering-only; hidden in Simple mode.
   * Absent → simple (always visible).
   */
  tier?: NavTier;
  /**
   * i18n key for a plain-language tooltip explaining an insider acronym/term
   * (FOE, UNS, PackML, …). Rendered as a hover title + a subtitle in flyouts.
   */
  hint?: string;
  /** Marks an engineer-oriented item (used to visually flag jargon rows). */
  engineerOriented?: boolean;
  /**
   * Framework/flag-gated page that is not live yet → renders a small "Beta /
   * Cần thiết lập" badge in the nav and a banner on the page so users don't hit
   * a dead end expecting live data.
   */
  beta?: boolean;
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
  /** Ordered Cấp-2 sections for this group; absent → render flat (no sub-headers) */
  sections?: { key: string; label: string }[];
  /**
   * Menu tier (doc 22 P4). `advanced` groups (Devices & OT, AI ops internals,
   * Federation lives under Admin) are hidden in Simple mode. Absent → simple.
   */
  tier?: NavTier;
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
        // U2 (doc 21 §6 G-3) — flagship single pane of glass: hierarchy tree +
        // factory twin + KPI strip + unified live alarm rail. First/prominent item.
        href: "/command-center",
        label: "nav.commandCenter",
        icon: <Gauge className="h-4 w-4" />,
        description: "nav.commandCenterDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
      },
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
    sections: [
      { key: "mes", label: "nav.section.mes" },
      { key: "inspection", label: "nav.section.inspection" },
      { key: "ordersSchedule", label: "nav.section.ordersSchedule" },
      { key: "bom", label: "nav.section.bom" },
    ],
    items: [
      {
        href: "/production-dashboard",
        label: "nav.productionDashboard",
        icon: <Gauge className="h-4 w-4" />,
        description: "nav.productionDashboardDesc",
        requiredPermission: "dashboard_view",
        permissionCategory: "dashboard",
        section: "mes",
      },
      {
        href: "/mes-control-tower",
        label: "nav.mesControlTower",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.mesControlTowerDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/wip-dashboard",
        label: "nav.wipDashboard",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.wipDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/traceability",
        label: "nav.traceability",
        icon: <GitMerge className="h-4 w-4" />,
        description: "nav.traceabilityDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/digital-twin",
        label: "nav.digitalTwin",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.digitalTwinDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "mes",
      },
      {
        href: "/history",
        label: "nav.historyPage",
        icon: <History className="h-4 w-4" />,
        description: "nav.historyPageDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
        section: "inspection",
      },
      {
        href: "/aoi-packages",
        label: "nav.aoiPackages",
        icon: <Camera className="h-4 w-4" />,
        description: "nav.aoiPackagesDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
        section: "inspection",
      },
      {
        href: "/production-orders",
        label: "nav.productionOrdersPage",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.productionOrdersDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
        section: "ordersSchedule",
      },
      {
        href: "/production-scheduling",
        label: "nav.productionScheduling",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.productionSchedulingDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
        section: "ordersSchedule",
      },
      {
        href: "/production-signoff",
        label: "nav.productionSignoff",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.productionSignoffDesc",
        requiredPermission: "production_orders",
        permissionCategory: "production",
        section: "ordersSchedule",
      },
      {
        href: "/history-export-scheduling",
        label: "nav.exportSchedule",
        icon: <Calendar className="h-4 w-4" />,
        description: "nav.exportScheduleDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
        section: "ordersSchedule",
      },
      {
        href: "/bom-management",
        label: "nav.bomManagement",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.bomManagementDesc",
        requiredPermission: "mes_bom",
        permissionCategory: "mes_bom",
        section: "bom",
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
        // P3-W2: flagship Quality Cockpit — default QUALITY landing. SPC / Pareto /
        // Heatmap / Gates / Annotation now live as tabs here (legacy routes redirect in).
        href: "/quality-cockpit",
        label: "nav.qualityCockpit",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.qualityCockpitDesc",
        requiredPermission: "analytics_spc",
        permissionCategory: "analytics",
      },
      {
        href: "/quality-home",
        label: "nav.qualityHome",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.qualityHomeDesc",
        requiredPermission: "history_view",
        permissionCategory: "history",
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
        // KEEP — factory-layout defect heatmap (distinct from the cockpit product heatmap tab).
        href: "/defect-heatmap",
        label: "nav.defectHeatmap",
        icon: <Map className="h-4 w-4" />,
        description: "nav.defectHeatmapDesc",
        requiredPermission: "analytics_defect_heatmap",
        permissionCategory: "analytics",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4. DEVICES & MONITORING — realtime status/health · device adapters / edge /
  //    MQTT telemetry · onboarding · Maintenance. Landing for maintenance.
  //    (F2 doc 23 §5 E2: the engineering/control + automation surface split out
  //    into its own `engineering` module below to relieve this over-loaded group.)
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "devices",
    label: "nav.devicesGroup",
    icon: <Cpu className="h-4 w-4" />,
    description: "nav.devicesGroupDesc",
    defaultOpen: false,
    permissionCategory: "machine_monitoring",
    // doc 22 P4 — engineering-heavy module: hidden in Simple mode.
    tier: "advanced",
    sections: [
      { key: "monitoring", label: "nav.section.monitoring" },
      { key: "telemetry", label: "nav.section.telemetry" },
      { key: "onboarding", label: "nav.section.onboarding" },
      { key: "maintenance", label: "nav.section.maintenance" },
    ],
    items: [
      // — Status & health —
      {
        // P3-W2: unified Device Monitor — default DEVICES & OT landing (machines +
        // OT adapters + edge nodes in one live table; legacy /machine-status redirects here).
        href: "/device-monitor",
        label: "nav.deviceMonitor",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.deviceMonitorDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
      },
      {
        href: "/machine-health",
        label: "nav.machineHealth",
        icon: <Heart className="h-4 w-4" />,
        description: "nav.machineHealthDesc",
        requiredPermission: "analytics_machine_health",
        permissionCategory: "analytics",
        section: "monitoring",
      },
      {
        href: "/oee-dashboard",
        label: "nav.oeeDashboard",
        icon: <Timer className="h-4 w-4" />,
        description: "nav.oeeDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "monitoring",
      },
      {
        href: "/factory-live-map",
        label: "nav.factoryLiveMap",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.factoryLiveMapDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "monitoring",
      },
      {
        // Automation Orchestration (Khối 1) — Field & Device Abstraction: UDM state +
        // heartbeat liveness board + hot-plug discovery (read-only; mutations gated by
        // FIELD_V2_ENABLED). View on machine_monitoring.
        href: "/field-devices",
        label: "nav.fieldDevices",
        icon: <Radio className="h-4 w-4" />,
        description: "nav.fieldDevicesDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        hint: "nav.hint.fieldDevices",
        engineerOriented: true,
      },
      {
        // Automation Orchestration (Khối 7) — live 3D digital twin + replay.
        // Monitoring (view-only) gated on machine_monitoring.
        href: "/digital-twin-center",
        label: "nav.digitalTwinCenter",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.digitalTwinCenterDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        hint: "nav.hint.digitalTwinCenter",
        engineerOriented: true,
        beta: true,
      },
      {
        // Tier-1b (doc 24): read-only system health — OT store-and-forward buffer +
        // connection HA supervisors + DINOv2 model tier (+ commissioning ledger &
        // twin export). View on machine_monitoring.
        href: "/system-health",
        label: "nav.systemHealth",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.systemHealthDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "monitoring",
        engineerOriented: true,
      },
      // — MQTT / telemetry —
      {
        href: "/mqtt-dashboard",
        label: "nav.mqttDashboard",
        icon: <Radio className="h-4 w-4" />,
        description: "nav.mqttDashboardDesc",
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
        section: "telemetry",
      },
      {
        href: "/mqtt-bulletin",
        label: "nav.mqttBulletin",
        icon: <Newspaper className="h-4 w-4" />,
        description: "nav.mqttBulletinDesc",
        requiredPermission: "mqtt_bulletin",
        permissionCategory: "mqtt",
        section: "telemetry",
        hint: "nav.hint.mqttBulletin",
        engineerOriented: true,
      },
      {
        href: "/mqtt-replay",
        label: "nav.mqttReplay",
        icon: <Play className="h-4 w-4" />,
        description: "nav.mqttReplayDesc",
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
        section: "telemetry",
        hint: "nav.hint.mqttReplay",
        engineerOriented: true,
      },
      {
        href: "/mqtt-clients",
        label: "nav.mqttClients",
        icon: <Wifi className="h-4 w-4" />,
        description: "nav.mqttClientsDesc",
        requiredRole: 'admin',
        requiredPermission: "mqtt_monitoring",
        permissionCategory: "mqtt",
        section: "telemetry",
      },
      // — Onboarding & adapters —
      {
        href: "/machine-onboarding",
        label: "nav.machineOnboarding",
        icon: <Rocket className="h-4 w-4" />,
        description: "nav.machineOnboardingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "onboarding",
      },
      {
        href: "/machine-registration",
        label: "nav.machineRegistration",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.machineRegistrationDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "onboarding",
      },
      {
        href: "/device-adapters",
        label: "nav.deviceAdapters",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.deviceAdaptersDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "onboarding",
      },
      {
        // Doc 24 (Connectivity): no-code Tag → UNS mapping designer (CONFIG + preview)
        href: "/uns-mapping",
        label: "nav.unsMapping",
        icon: <Share2 className="h-4 w-4" />,
        description: "nav.unsMappingDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "onboarding",
      },
      {
        href: "/edge-nodes",
        label: "nav.edgeNodes",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.edgeNodesDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "onboarding",
      },
      {
        // P4-D: robot/AGV registry + telemetry + job log (read-mostly; motion via HITL dispatcher)
        href: "/robot-control",
        label: "nav.robotControl",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.robotControlDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "onboarding",
      },
      {
        // P4-D: Factory Control Plane (equipment capability/PackML + FOE + edge runtime, read-only)
        href: "/control-plane",
        label: "nav.controlPlane",
        icon: <Network className="h-4 w-4" />,
        description: "nav.controlPlaneDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "onboarding",
        hint: "nav.hint.controlPlane",
        engineerOriented: true,
        beta: true,
      },
      // — Maintenance / predictive —
      {
        href: "/technician-copilot",
        label: "nav.technicianCopilot",
        icon: <Wrench className="h-4 w-4" />,
        description: "nav.technicianCopilotDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
      },
      {
        href: "/work-orders",
        label: "nav.workOrders",
        icon: <ClipboardList className="h-4 w-4" />,
        description: "nav.workOrdersDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
      },
      {
        href: "/alerts",
        label: "nav.alertsList",
        icon: <Bell className="h-4 w-4" />,
        description: "nav.alertsListDesc",
        requiredPermission: "mqtt_alerts",
        permissionCategory: "mqtt",
        section: "maintenance",
      },
      {
        href: "/mqtt-alerts",
        label: "nav.alertRules",
        icon: <AlertTriangle className="h-4 w-4" />,
        description: "nav.alertRulesDesc",
        requiredPermission: "mqtt_alerts",
        permissionCategory: "mqtt",
        section: "maintenance",
      },
      {
        href: "/monitoring-setting",
        label: "nav.monitoringSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.monitoringSettingDesc",
        requiredPermission: "machine_status",
        permissionCategory: "machine_monitoring",
        section: "maintenance",
      },
    ],
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 4b. ENGINEERING & CONTROL (ADVANCED) — the programming / interlock / recipe
  //     surface + the Automation-Orchestration cockpits (fleet · safety · standards
  //     · integration · twin/RF · IR editor · floor editor) split out of Devices
  //     (F2 doc 23 §5 E2). Advanced-tier; every item keeps its ORIGINAL href /
  //     icon / permission / tier / hint / beta verbatim — regrouped only. Gating is
  //     inherited from the items (machine_control / machine_monitoring / interlock),
  //     so this group respects the same role/permission filtering as its pages.
  // ──────────────────────────────────────────────────────────────────────────
  {
    id: "engineering",
    label: "nav.engineeringGroup",
    icon: <Code2 className="h-4 w-4" />,
    description: "nav.engineeringGroupDesc",
    defaultOpen: false,
    permissionCategory: "machine_monitoring",
    // doc 22 P4 — engineering-heavy module: hidden in Simple mode.
    tier: "advanced",
    sections: [
      { key: "engineering", label: "nav.section.engineering" },
    ],
    items: [
      // — Engineering & Control —
      {
        href: "/engineering",
        label: "nav.engineeringWorkspace",
        icon: <Code2 className="h-4 w-4" />,
        description: "nav.engineeringWorkspaceDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "engineering",
        hint: "nav.hint.engineeringWorkspace",
        engineerOriented: true,
      },
      {
        href: "/recipes",
        label: "nav.recipes",
        icon: <FlaskConical className="h-4 w-4" />,
        description: "nav.recipesDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "engineering",
      },
      {
        href: "/interlock-rules",
        label: "nav.interlockRules",
        icon: <ShieldAlert className="h-4 w-4" />,
        description: "nav.interlockRulesDesc",
        requiredPermission: "interlock",
        permissionCategory: "interlock",
        section: "engineering",
        hint: "nav.hint.interlockRules",
        engineerOriented: true,
      },
      {
        href: "/orchestration-studio",
        label: "nav.orchestrationStudio",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.orchestrationStudioDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "engineering",
        hint: "nav.hint.orchestrationStudio",
        engineerOriented: true,
        beta: true,
      },
      {
        // D1 (doc 16 §11.1 Khối 6) — Visual IR Editor: author motion/IO device
        // programs as first-class IR blocks, lint + transpile preview. Read-open
        // (machine_monitoring); save/build gated by DPC_IR_V2_ENABLED + machine_control.
        href: "/ir-editor",
        label: "nav.irEditor",
        icon: <Code2 className="h-4 w-4" />,
        description: "nav.irEditorDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
        hint: "nav.hint.irEditor",
        engineerOriented: true,
        beta: true,
      },
      {
        // P4 (doc 24 Wave-3) — IEC 61131 POU Studio: structured LAD/FBD/SFC POUs with
        // PLCopen TC6 XML import/export, semantic lint, and transpile-to-ST preview.
        // Read-open (machine_monitoring); all pure previews (open runtime only, no device path).
        href: "/pou-studio",
        label: "nav.pouStudio",
        icon: <FileCode2 className="h-4 w-4" />,
        description: "nav.pouStudioDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
        hint: "nav.hint.pouStudio",
        engineerOriented: true,
        beta: true,
      },
      {
        // Automation Orchestration (Khối 2) — fleet task allocation, zones/traffic,
        // skill/resource/charging. Read-mostly cockpit gated on machine_monitoring.
        href: "/fleet-orchestration",
        label: "nav.fleetOrchestration",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.fleetOrchestrationDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
        hint: "nav.hint.fleetOrchestration",
        engineerOriented: true,
        beta: true,
      },
      {
        // Automation Orchestration (Khối 3) — advisory safety cockpit + workforce
        // board (safety-adjacent, next to interlock rules). View-only.
        href: "/safety-workforce",
        label: "nav.safetyWorkforce",
        icon: <ShieldQuestion className="h-4 w-4" />,
        description: "nav.safetyWorkforceDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
        hint: "nav.hint.safetyWorkforce",
        engineerOriented: true,
        beta: true,
      },
      {
        // Automation Orchestration (Khối 5) — equipment standards & governance:
        // device-type hierarchy + ISA-18.2 alarm taxonomy + Standards Board. View-only.
        href: "/equipment-standards",
        label: "nav.equipmentStandards",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.equipmentStandardsDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
        hint: "nav.hint.equipmentStandards",
        engineerOriented: true,
        beta: true,
      },
      {
        // Equipment Integration (Khối 1B) — FOCAS/Euromap integration frameworks
        // (read-only, no live device) + recipe versioning genealogy. View-only.
        href: "/equipment-integration",
        label: "nav.equipmentIntegration",
        icon: <Plug className="h-4 w-4" />,
        description: "nav.equipmentIntegrationDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
        hint: "nav.hint.equipmentIntegration",
        engineerOriented: true,
        beta: true,
      },
      {
        href: "/factory-floor-editor",
        label: "nav.factoryFloorEditor",
        icon: <Boxes className="h-4 w-4" />,
        description: "nav.factoryFloorEditorDesc",
        // View-open like its sibling /factory-live-map: a machine_monitoring user
        // can OPEN the floor editor; editing/saving positions stays gated to
        // machine_control inside the page (<PermissionGate action="canEdit"> +
        // ViewOnlyBadge). Previously this required machine_control to even view,
        // which blocked monitoring users from reaching the page at all.
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "engineering",
      },
      {
        href: "/rf-test-cell",
        label: "nav.rfTestCell",
        icon: <Radio className="h-4 w-4" />,
        description: "nav.rfTestCellDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "engineering",
        hint: "nav.hint.rfTestCell",
        engineerOriented: true,
        beta: true,
      },
      {
        href: "/cell-twin",
        label: "nav.cellTwin",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.cellTwinDesc",
        requiredPermission: "machine_control",
        permissionCategory: "machine_control",
        section: "engineering",
        hint: "nav.hint.cellTwin",
        engineerOriented: true,
        beta: true,
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
    sections: [
      { key: "reports", label: "nav.section.reports" },
      { key: "analysis", label: "nav.section.analysis" },
      { key: "energy", label: "nav.section.energy" },
      { key: "targetsSettings", label: "nav.section.targetsSettings" },
    ],
    items: [
      {
        href: "/reports",
        label: "nav.reportsPage",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.reportsPageDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/scheduled-reports",
        label: "nav.scheduledReports",
        icon: <CalendarClock className="h-4 w-4" />,
        description: "nav.scheduledReportsDesc",
        requiredPermission: "reports_schedule",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/report-builder",
        label: "nav.reportBuilder",
        icon: <FileText className="h-4 w-4" />,
        description: "nav.reportBuilderDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/category-analytics",
        label: "nav.categoryAnalytics",
        icon: <PieChart className="h-4 w-4" />,
        description: "nav.categoryAnalyticsDesc",
        requiredPermission: "analytics_category",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/correlation-analysis",
        label: "nav.correlationAnalysis",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.correlationAnalysisDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/data-comparison",
        label: "nav.dataComparison",
        icon: <GitCompare className="h-4 w-4" />,
        description: "nav.dataComparisonDesc",
        requiredPermission: "analytics_advanced",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/realtime-report",
        label: "nav.realtimeReport",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.realtimeReportDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "analysis",
      },
      {
        href: "/energy-analytics",
        label: "nav.energyAnalytics",
        icon: <Zap className="h-4 w-4" />,
        description: "nav.energyAnalyticsDesc",
        requiredPermission: "energy",
        permissionCategory: "analytics",
        section: "energy",
      },
      {
        href: "/carbon-dashboard",
        label: "nav.carbonDashboard",
        icon: <Leaf className="h-4 w-4" />,
        description: "nav.carbonDashboardDesc",
        requiredPermission: "analytics_oee",
        permissionCategory: "analytics",
        section: "energy",
      },
      {
        href: "/pdf-reports",
        label: "nav.pdfReports",
        icon: <FileText className="h-4 w-4" />,
        description: "nav.pdfReportsDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/powerpoint-export",
        label: "nav.powerpointExport",
        icon: <Presentation className="h-4 w-4" />,
        description: "nav.powerpointExportDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "reports",
      },
      {
        href: "/threshold-approvals",
        label: "nav.thresholdApprovals",
        icon: <ClipboardCheck className="h-4 w-4" />,
        description: "nav.thresholdApprovalsDesc",
        requiredPermission: "settings_alerts",
        permissionCategory: "analytics",
        section: "targetsSettings",
      },
      {
        href: "/oee-target-settings",
        label: "nav.oeeTargets",
        icon: <Target className="h-4 w-4" />,
        description: "nav.oeeTargetsDesc",
        requiredPermission: "analytics_oee_targets",
        permissionCategory: "analytics",
        section: "targetsSettings",
      },
      {
        href: "/analytics-setting",
        label: "nav.analyticsSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.analyticsSettingDesc",
        requiredPermission: "reports_view",
        permissionCategory: "reports",
        section: "targetsSettings",
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
    // doc 22 P4 — AI Control Plane / Ops / Vision are engineering internals; the
    // whole module is hidden in Simple mode. (The read-open AI Workspace chat/inbox
    // stays reachable via /ai-chat + the Me group, which remain Simple.)
    tier: "advanced",
    // No permissionCategory → group is visible to every authenticated role; the
    // AI Workspace items below are read-open. Admin-only items below still gate.
    sections: [
      { key: "aiWorkspace", label: "nav.section.aiWorkspace" },
      { key: "aiControlPlane", label: "nav.section.aiControlPlane" },
      { key: "aiOps", label: "nav.section.aiOps" },
      { key: "aiVision", label: "nav.section.aiVision" },
    ],
    items: [
      // ─ AI Workspace (read-open, all roles) ─
      {
        href: "/ai-chat",
        label: "nav.aiChat",
        icon: <MessageSquare className="h-4 w-4" />,
        description: "nav.aiChatDesc",
        section: "aiWorkspace",
      },
      {
        href: "/ai-hub",
        label: "nav.aiHub",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.aiHubDesc",
        section: "aiWorkspace",
      },
      {
        href: "/management-insight",
        label: "nav.managementInsight",
        icon: <Sparkles className="h-4 w-4" />,
        description: "nav.managementInsightDesc",
        section: "aiWorkspace",
      },
      // ─ AI Control Plane (admin) ─
      {
        href: "/ai-brain",
        label: "nav.aiBrainDashboard",
        icon: <Brain className="h-4 w-4" />,
        description: "nav.aiBrainDashboardDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiControlPlane",
      },
      {
        href: "/ai-monitoring",
        label: "nav.aiMonitoring",
        icon: <MonitorCheck className="h-4 w-4" />,
        description: "nav.aiMonitoringDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiControlPlane",
      },
      {
        href: "/ai-performance",
        label: "nav.aiPerformance",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.aiPerformanceDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiControlPlane",
      },
      {
        href: "/ai-models",
        label: "nav.aiModelManagement",
        icon: <Cpu className="h-4 w-4" />,
        description: "nav.aiModelManagementDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiControlPlane",
      },
      {
        href: "/model-versions",
        label: "nav.modelVersions",
        icon: <GitBranch className="h-4 w-4" />,
        description: "nav.modelVersionsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiControlPlane",
      },
      {
        // Automation Orchestration (Khối 4, I2) — advisory robot-behaviour anomaly
        // monitoring + AI model rollback audit. AI-observability, read-mostly cockpit;
        // reads gated on machine_monitoring (like robot-control / fleet-orchestration),
        // mutations gated on machine_control/canEdit inside the page + I2 flags.
        href: "/robot-model-health",
        label: "nav.robotModelHealth",
        icon: <Bot className="h-4 w-4" />,
        description: "nav.robotModelHealthDesc",
        requiredPermission: "machine_monitoring",
        permissionCategory: "machine_monitoring",
        section: "aiControlPlane",
      },
      {
        href: "/ai-settings",
        label: "nav.aiSettings",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.aiSettingsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "aiControlPlane",
      },
      // ─ AI Ops (admin) ─
      {
        href: "/ai-active-learning",
        label: "nav.aiActiveLearning",
        icon: <GraduationCap className="h-4 w-4" />,
        description: "nav.aiActiveLearningDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiOps",
      },
      {
        href: "/ai-batch-jobs",
        label: "nav.aiBatchJobs",
        icon: <Layers className="h-4 w-4" />,
        description: "nav.aiBatchJobsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiOps",
      },
      {
        href: "/ai-data-processing",
        label: "nav.aiDataProcessing",
        icon: <Database className="h-4 w-4" />,
        description: "nav.aiDataProcessingDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiOps",
      },
      {
        href: "/ai-time-series",
        label: "nav.aiTimeSeries",
        icon: <TrendingUp className="h-4 w-4" />,
        description: "nav.aiTimeSeriesDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiOps",
      },
      {
        href: "/ai-reports",
        label: "nav.aiReports",
        icon: <FileBarChart className="h-4 w-4" />,
        description: "nav.aiReportsDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiOps",
      },
      // ─ AI Vision (admin) ─
      {
        href: "/ai-quality-gate",
        label: "nav.aiQualityGate",
        icon: <ShieldCheck className="h-4 w-4" />,
        description: "nav.aiQualityGateDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiVision",
      },
      {
        href: "/ai-image-search",
        label: "nav.aiImageSearch",
        icon: <Search className="h-4 w-4" />,
        description: "nav.aiImageSearchDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiVision",
      },
      {
        href: "/ai-advanced-vision-lab",
        label: "nav.advancedVisionLab",
        icon: <Camera className="h-4 w-4" />,
        description: "nav.advancedVisionLabDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiVision",
      },
      {
        href: "/anomaly-banks",
        label: "nav.anomalyBanks",
        icon: <Database className="h-4 w-4" />,
        description: "nav.anomalyBanksDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiVision",
      },
      {
        href: "/mask-annotation",
        label: "nav.maskAnnotation",
        icon: <Brush className="h-4 w-4" />,
        description: "nav.maskAnnotationDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "aiVision",
      },
      {
        href: "/causal-graph",
        label: "nav.causalGraph",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.causalGraphDesc",
        requiredPermission: "analytics_root_cause",
        permissionCategory: "analytics",
        section: "aiVision",
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
    // doc 22 P4 — platform/governance internals (incl. Federation): Advanced-only.
    tier: "advanced",
    sections: [
      { key: "securityAccess", label: "nav.section.securityAccess" },
      { key: "platform", label: "nav.section.platform" },
      { key: "masterData", label: "nav.section.masterData" },
      { key: "factoryConfig", label: "nav.section.factoryConfig" },
    ],
    items: [
      {
        href: "/admin-home",
        label: "nav.adminHome",
        icon: <Activity className="h-4 w-4" />,
        description: "nav.adminHomeDesc",
        requiredRole: 'admin',
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/users",
        label: "nav.usersPage",
        icon: <Users className="h-4 w-4" />,
        description: "nav.usersPageDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/role-builder",
        label: "nav.roleBuilder",
        icon: <UserCog className="h-4 w-4" />,
        description: "nav.roleBuilderDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_users",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/audit-logs?tab=enhanced",
        label: "nav.enhancedAudit",
        icon: <ScrollText className="h-4 w-4" />,
        description: "nav.enhancedAuditDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/license",
        label: "nav.licenseManagement",
        icon: <KeyRound className="h-4 w-4" />,
        description: "nav.licenseManagementDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/api-keys",
        label: "nav.apiKeys",
        icon: <KeyRound className="h-4 w-4" />,
        description: "nav.apiKeysDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      {
        href: "/sites",
        label: "nav.sites",
        icon: <Network className="h-4 w-4" />,
        description: "nav.sitesDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        href: "/federation-dashboard",
        label: "nav.federationDashboard",
        icon: <Globe className="h-4 w-4" />,
        description: "nav.federationDashboardDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
        hint: "nav.hint.federationDashboard",
        engineerOriented: true,
        beta: true,
      },
      {
        href: "/modules",
        label: "nav.modules",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.modulesDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        href: "/backup-restore",
        label: "nav.backupRestore",
        icon: <Archive className="h-4 w-4" />,
        description: "nav.backupRestoreDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
      },
      {
        href: "/sessions",
        label: "nav.sessions",
        icon: <Monitor className="h-4 w-4" />,
        description: "nav.sessionsDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "securityAccess",
      },
      // — Master Data / Data Management —
      {
        href: "/master-data",
        label: "nav.masterData",
        icon: <Tags className="h-4 w-4" />,
        description: "nav.masterDataDesc",
        requiredPermission: "masterdata",
        permissionCategory: "settings",
        section: "masterData",
      },
      {
        href: "/products",
        label: "nav.productsPage",
        icon: <Package className="h-4 w-4" />,
        description: "nav.productsPageDesc",
        requiredPermission: "settings_products",
        permissionCategory: "settings",
        section: "masterData",
      },
      {
        href: "/product-mapping",
        label: "nav.productMapping",
        icon: <Link className="h-4 w-4" />,
        description: "nav.productMappingDesc",
        requiredPermission: "settings_product_mapping",
        permissionCategory: "settings",
        section: "masterData",
      },
      {
        href: "/layout",
        label: "nav.factoryLayout",
        icon: <LayoutGrid className="h-4 w-4" />,
        description: "nav.factoryLayoutDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/workstation-management",
        label: "nav.workstationManagement",
        icon: <Warehouse className="h-4 w-4" />,
        description: "nav.workstationManagementDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/process-management",
        label: "nav.processManagement",
        icon: <Workflow className="h-4 w-4" />,
        description: "nav.processManagementDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/datasettings",
        label: "nav.dataSettingsPage",
        icon: <Database className="h-4 w-4" />,
        description: "nav.dataSettingsPageDesc",
        requiredPermission: "settings_factory",
        permissionCategory: "settings",
        section: "factoryConfig",
      },
      {
        href: "/corporate-management",
        label: "nav.corporateManagement",
        icon: <Settings className="h-4 w-4" />,
        description: "nav.corporateManagementDesc",
        requiredRole: 'admin',
        requiredPermission: "dashboard_corporate",
        permissionCategory: "dashboard",
        section: "masterData",
      },
      {
        href: "/settings",
        label: "nav.generalSettings",
        icon: <Settings className="h-4 w-4" />,
        description: "nav.generalSettingsDesc",
        requiredPermission: "settings_view",
        permissionCategory: "settings",
        section: "platform",
      },
      {
        href: "/admin-setting",
        label: "nav.adminSetting",
        icon: <Cog className="h-4 w-4" />,
        description: "nav.adminSettingDesc",
        requiredRole: 'admin',
        requiredPermission: "admin_system",
        permissionCategory: "admin",
        section: "platform",
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
        // P3-W2: full-screen Action Inbox (read-open all roles).
        href: "/inbox",
        label: "nav.inbox",
        icon: <Inbox className="h-4 w-4" />,
        description: "nav.inboxDesc",
      },
      {
        // P3-W2: full-screen Today Briefing (read-open all roles).
        href: "/today",
        label: "nav.today",
        icon: <Sun className="h-4 w-4" />,
        description: "nav.todayDesc",
      },
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

// ──────────────────────────────────────────────────────────────────────────────
// Simple vs Advanced menu mode (doc 22 P4).
// ──────────────────────────────────────────────────────────────────────────────

export type NavMode = 'simple' | 'advanced';

/** Roles that DEFAULT to Advanced mode (see everything up-front). Everyone else
 *  (operator/supervisor/viewer/user/quality_inspector/…) defaults to Simple. */
const ADVANCED_DEFAULT_ROLES = new Set(['admin', 'it_admin', 'engineer']);

/** The default menu mode for a role — technical roles start Advanced, the rest Simple. */
export function defaultNavModeForRole(role?: string | null): NavMode {
  return role && ADVANCED_DEFAULT_ROLES.has(role) ? 'advanced' : 'simple';
}

/** An item/group is "advanced" only when explicitly tagged; untagged → simple. */
function isAdvancedGroup(group: NavGroup): boolean {
  return group.tier === 'advanced';
}
function isAdvancedItem(item: NavItem): boolean {
  return item.tier === 'advanced';
}

/**
 * Does the given (already role/permission-filtered) group list contain anything
 * that Simple mode would hide? Used to decide whether to SHOW the Advanced toggle
 * at all (no point offering it to a role that has no advanced surface).
 */
export function hasAdvancedContent(groups: NavGroup[]): boolean {
  return groups.some(g => isAdvancedGroup(g) || g.items.some(isAdvancedItem));
}

/**
 * Filter nav groups by menu mode. In `advanced` mode nothing is removed. In
 * `simple` mode, advanced groups are dropped entirely and advanced items are
 * removed from the surviving groups (empty groups then drop out). Purely additive
 * — this runs AFTER getFilteredNavGroups, so power-user (advanced) flows are
 * untouched.
 */
export function filterNavGroupsByMode(groups: NavGroup[], mode: NavMode): NavGroup[] {
  if (mode === 'advanced') return groups;
  return groups
    .filter(group => !isAdvancedGroup(group))
    .map(group => ({ ...group, items: group.items.filter(item => !isAdvancedItem(item)) }))
    .filter(group => group.items.length > 0);
}

// Helper to get group by item href
export function getGroupByHref(href: string): NavGroup | undefined {
  return navGroups.find(group => group.items.some(item => item.href === href));
}

/**
 * F2 (doc 23 §5 E3) — route-prefix active matcher.
 *
 * Highlights a nav item as active when the CURRENT location matches the item's
 * href by PATH PREFIX (query strings stripped on both sides), so child/query
 * routes light up their parent:
 *   - `/audit-logs?tab=enhanced` → matches item `/audit-logs?tab=enhanced` AND
 *     the bare `/audit-logs` family (query ignored).
 *   - `/machine/42`              → matches item `/machine`.
 *
 * Guarded against false positives: a prefix match must break on a path boundary
 * (the next char in the location is `/`), so `/reports` does NOT match
 * `/report-builder`. The root href `/` only matches the exact root path.
 */
export function isNavItemActive(itemHref: string, currentPath: string): boolean {
  const item = (itemHref || "").split("?")[0];
  const current = (currentPath || "").split("?")[0];
  if (item === current) return true;
  // Root ("/") must be exact — never a prefix of every route.
  if (item === "/") return false;
  return current.startsWith(item + "/");
}

/** Look up a nav item by its href (ignoring any query string). */
export function getNavItemByHref(href: string): NavItem | undefined {
  const path = href.split("?")[0];
  return navItems.find(item => item.href.split("?")[0] === path);
}

/** doc 22 P4 — is the given route a not-yet-live (beta) surface? Drives the page banner. */
export function isBetaRoute(href: string): boolean {
  return getNavItemByHref(href)?.beta === true;
}

/**
 * Group an (already role/permission/license-filtered) group's items by their `section`.
 * Returns ordered buckets following group.sections; items without a section (or groups
 * without a sections array) fall into a single { key: null } bucket rendered flat.
 * Empty buckets (all items filtered out) are dropped.
 */
export function groupItemsBySection(
  group: NavGroup,
): { key: string | null; label: string | null; items: NavItem[] }[] {
  // No section definition → render flat.
  if (!group.sections) {
    return [{ key: null, label: null, items: group.items }];
  }

  const buckets: { key: string | null; label: string | null; items: NavItem[] }[] = [];

  // Ordered, labelled section buckets — skip any that ended up empty after filtering.
  for (const { key, label } of group.sections) {
    const items = group.items.filter(item => item.section === key);
    if (items.length > 0) {
      buckets.push({ key, label, items });
    }
  }

  // Trailing catch-all for items with no section (or a section not declared in
  // group.sections) so nothing is ever dropped; rendered flat (no sub-header).
  const sectionKeys = new Set(group.sections.map(s => s.key));
  const orphanItems = group.items.filter(
    item => item.section === undefined || !sectionKeys.has(item.section),
  );
  if (orphanItems.length > 0) {
    buckets.push({ key: null, label: null, items: orphanItems });
  }

  return buckets;
}

/**
 * Hub routes — "settings/management hub" pages that carry their OWN in-page navigation
 * MENU (a vertical sub-menu of sections, e.g. /monitoring-setting). These are promoted
 * to Level 2 as directly-clickable entries (click → straight to the page; the page's own
 * in-page menu is the sub-nav, so no Level-3 flyout). Non-hub pages stay grouped under
 * their section category with a Level-3 menu. (Flat modules — Overview / Quality / Me —
 * already render items at Level 2, so a flag here is a no-op for them.)
 *
 * To extend: add the href of any page that has a real in-page navigation menu.
 */
export const HUB_ROUTES = new Set<string>([
  "/monitoring-setting", // Devices — vertical sub-menu (registration / devices / MQTT clients / topics / replay / profiles / NG-rate)
  "/analytics-setting",  // Analytics — settings sub-menu
  "/settings",           // Admin — general settings sub-menu
  "/admin-setting",      // Admin — admin settings sub-menu
  "/datasettings",       // Admin — data settings sub-menu
  "/dashboard-center",   // Overview (flat — already L2) — dashboard hub sub-menu
]);

export function isHubItem(item: NavItem): boolean {
  return HUB_ROUTES.has(item.href);
}

/** A Level-2 entry: either a directly-clickable hub link, or a category that opens
 *  a Level-3 menu of its (non-hub) pages. */
export type L2Entry =
  | { kind: "link"; item: NavItem }
  | { kind: "category"; key: string; label: string; items: NavItem[] };

/**
 * Build the Level-2 list for a module (already role/permission/license-filtered):
 * hub pages → direct `link` entries; the remaining non-hub pages stay grouped into
 * `category` entries (Level-3 on hover/tap). Within each section the category is
 * emitted first, then that section's hub links, so hubs stay near their group.
 * Flat / orphan items render as direct links (they are already Level 2).
 */
export function buildModuleL2(group: NavGroup): L2Entry[] {
  const out: L2Entry[] = [];
  for (const bucket of groupItemsBySection(group)) {
    if (bucket.key === null || bucket.label === null) {
      for (const item of bucket.items) out.push({ kind: "link", item });
      continue;
    }
    const nonHub = bucket.items.filter(i => !isHubItem(i));
    const hub = bucket.items.filter(i => isHubItem(i));
    // Keep a category only when ≥2 non-hub pages remain — a 0/1-item category after
    // pulling out hubs is noise, so those pages become direct links too.
    if (nonHub.length >= 2) {
      out.push({ kind: "category", key: bucket.key, label: bucket.label, items: nonHub });
    } else {
      for (const item of nonHub) out.push({ kind: "link", item });
    }
    for (const item of hub) out.push({ kind: "link", item });
  }
  return out;
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