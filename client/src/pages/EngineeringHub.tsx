/**
 * EngineeringHub — "/engineering-home" — W6-26 (doc 25 T8).
 *
 * Hub-and-spoke front door cho nhóm "Kỹ thuật & Điều khiển". Trước đây 13 mục
 * nằm phẳng trong MỘT section, breadcrumb ném thẳng vào IDE (/engineering). Trang
 * này gom theo TÁC VỤ thành các nhóm (soạn thảo · điều phối · an toàn · chuẩn hoá &
 * tích hợp · twin & mô phỏng) + một dải "luồng vàng" nêu rõ mạch soạn → mô phỏng →
 * deploy → giám sát để các editor chồng lấn không còn mơ hồ "dùng cái nào".
 *
 * Chỉ điều hướng (read-only) — không có mutation nên không cần PermissionGate/
 * loading/error. Mỗi route đích tự thực thi RBAC của nó. Nhãn/blurb tái dùng các
 * key nav.* sẵn có để không nhân bản chuỗi i18n.
 */
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer, ToolTile } from "@/components/patterns";
import { PendingReviewStrip } from "@/components/PendingReviewStrip";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { getNavItemByHref } from "@/lib/navigation";
import { usePermissions } from "@/_core/hooks/usePermissions";
import {
  Code2,
  GitBranch,
  FileCode2,
  FlaskConical,
  Workflow,
  Bot,
  ShieldAlert,
  ShieldQuestion,
  ShieldCheck,
  Plug,
  Boxes,
  Radio,
  Network,
  Gauge,
  ScrollText,
  LayoutDashboard,
  GitMerge,
  Lock,
  Eye,
  type LucideIcon,
} from "lucide-react";

interface HubTile {
  icon: LucideIcon;
  /** Key nav.* dùng cho nhãn; blurb = <key>Desc. */
  navKey: string;
  href: string;
}

interface HubGroup {
  /** Section key (khớp nav.section.*) — đồng bộ với navigation.tsx. */
  sectionKey: string;
  tiles: HubTile[];
}

// Nhóm tác vụ — thứ tự & thành phần khớp navigation.tsx group "engineering".
const GROUPS: HubGroup[] = [
  {
    sectionKey: "authoring",
    tiles: [
      { icon: Code2, navKey: "engineeringWorkspace", href: "/engineering" },
      { icon: GitBranch, navKey: "irEditor", href: "/ir-editor" },
      { icon: FileCode2, navKey: "pouStudio", href: "/pou-studio" },
      { icon: FlaskConical, navKey: "recipes", href: "/recipes" },
    ],
  },
  {
    sectionKey: "orchestration",
    tiles: [
      { icon: Workflow, navKey: "orchestrationStudio", href: "/orchestration-studio" },
      { icon: Bot, navKey: "fleetOrchestration", href: "/fleet-orchestration" },
    ],
  },
  {
    // Product-audit fix — surface the run-time HALF of the domain (control/ops/audit)
    // so the hub's "author → deploy → operate → audit" loop is actually reachable.
    sectionKey: "operationsControl",
    tiles: [
      { icon: Network, navKey: "controlPlane", href: "/control-plane" },
      { icon: Bot, navKey: "robotControl", href: "/robot-control" },
      { icon: Gauge, navKey: "opsConsole", href: "/ops-console" },
      { icon: ScrollText, navKey: "commandAudit", href: "/audit-logs?tab=command" },
    ],
  },
  {
    // U15 (doc 26 §3.1) — tách "safetyStandards" thành An toàn + Chuẩn hoá & Tích hợp.
    sectionKey: "safety",
    tiles: [
      { icon: ShieldAlert, navKey: "interlockRules", href: "/interlock-rules" },
      { icon: ShieldQuestion, navKey: "safetyWorkforce", href: "/safety-workforce" },
    ],
  },
  {
    sectionKey: "standardsIntegration",
    tiles: [
      { icon: ShieldCheck, navKey: "equipmentStandards", href: "/equipment-standards" },
      { icon: Plug, navKey: "equipmentIntegration", href: "/equipment-integration" },
    ],
  },
  {
    sectionKey: "twin",
    tiles: [
      { icon: Boxes, navKey: "factoryFloorEditor", href: "/factory-floor-editor" },
      { icon: Radio, navKey: "rfTestCell", href: "/rf-test-cell" },
      { icon: Workflow, navKey: "cellTwin", href: "/cell-twin" },
    ],
  },
];

/** Perm coi là "điều khiển" — tile cần quyền này để làm việc, không chỉ để xem. */
const CONTROL_PERMS = new Set(["machine_control", "interlock"]);

export default function EngineeringHub() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const crumbs = buildBreadcrumbs("/engineering-home", t).map((c) => ({
    label: c.label,
    href: c.href,
  }));

  /**
   * U7 (doc 26 §2.1) — báo TRƯỚC khi bấm: đọc metadata nav (beta + requiredPermission)
   * cho từng tile để gắn chip "Thử nghiệm" và dấu quyền:
   *  · không đủ quyền xem      → "Cần quyền điều khiển" (khoá, sẽ chạm màn chặn)
   *  · xem được nhưng không sửa (perm điều khiển) → "Chỉ xem"
   */
  const tileMeta = (href: string) => {
    const nav = getNavItemByHref(href);
    const perm = nav?.requiredPermission;
    let note: string | undefined;
    let noteIcon: LucideIcon | undefined;
    if (perm) {
      if (!hasPermission(perm, "canView")) {
        note = t("engineeringHome.needControl", "Cần quyền điều khiển");
        noteIcon = Lock;
      } else if (CONTROL_PERMS.has(perm) && !hasPermission(perm, "canEdit")) {
        note = t("engineeringHome.viewOnly", "Chỉ xem");
        noteIcon = Eye;
      }
    }
    return { beta: nav?.beta === true, note, noteIcon };
  };

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          breadcrumbs={crumbs}
          icon={<LayoutDashboard className="text-primary" />}
          title={t("engineeringHome.title", "Engineering Hub")}
          description={t(
            "engineeringHome.subtitle",
            "Pick a task — author programs, orchestrate the fleet, enforce safety & standards, or run the twin.",
          )}
        />

        {/* Luồng vàng — nêu rõ mạch soạn → mô phỏng → deploy → giám sát. */}
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
          <GitMerge className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              "engineeringHome.goldenThread",
              "Golden thread: author → simulate → deploy → monitor. Programs authored here flow into the pipeline, run in the twin, then surface on the monitoring pages.",
            )}
          </p>
        </div>

        {/* U5 (doc 26 §2.3) — dải "Đang chờ duyệt & cảnh báo" gộp toàn module. */}
        <PendingReviewStrip />

        {/* Các nhóm tác vụ */}
        <div className="space-y-8">
          {GROUPS.map((group) => (
            <section key={group.sectionKey} className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                {t(`nav.section.${group.sectionKey}`)}
              </h2>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
                {group.tiles.map((tile) => {
                  const meta = tileMeta(tile.href);
                  return (
                    <ToolTile
                      key={tile.href}
                      icon={tile.icon}
                      label={t(`nav.${tile.navKey}`)}
                      blurb={t(`nav.${tile.navKey}Desc`)}
                      href={tile.href}
                      beta={meta.beta}
                      note={meta.note}
                      noteIcon={meta.noteIcon}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </PageContainer>
    </DashboardLayout>
  );
}
