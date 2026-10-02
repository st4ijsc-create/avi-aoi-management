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
import { getNavItemByHref } from "@/lib/navigation";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
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
  AlertTriangle,
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

/**
 * Doc 80 Đợt 1 Task 2 (ILK-06) — một cờ tư thế: chấm màu + nhãn + BẬT/TẮT. `warn`
 * tô vàng khi cờ này (dù bật hay tắt) là một phần của tình huống rủi ro (ILK-06:
 * ghi lệnh thật BẬT trong khi engine interlock TẮT) — không suy diễn tốt/xấu từ
 * riêng giá trị BẬT/TẮT của MỘT cờ.
 */
function PostureFlag({ label, on, warn }: { label: string; on: boolean; warn?: boolean }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn("h-2 w-2 rounded-full", warn ? "bg-warning" : on ? "bg-success" : "bg-muted-foreground/40")}
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", warn ? "text-warning" : "text-foreground")}>
        {on ? t("oversight.posture.on", "ON") : t("oversight.posture.off", "OFF")}
      </span>
    </span>
  );
}

/**
 * Doc 80 Phụ lục D §6/§7.1 (ILK-06) — dải "Tư thế an toàn": trạng thái các cờ ghi
 * lệnh thật (OT/robot/nạp chương trình) + engine interlock, và độ phủ interlock
 * (số rule đang bật CÓ ĐÍCH). Nguồn: trpc.oversight.posture (READ-ONLY, đọc cờ ở
 * SERVER — không lộ tên biến `.env` ra client). Khi ghi lệnh thật BẬT mà engine
 * interlock TẮT ⇒ cảnh báo VÀNG rõ ràng (interlock không tự động chặn được gì).
 */
function SafetyPostureStrip() {
  const { t } = useTranslation();
  const query = trpc.oversight.posture.useQuery(undefined, { staleTime: 30_000 });
  const data = query.data;

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="font-semibold uppercase tracking-wide text-muted-foreground text-xs">
          {t("oversight.posture.title", "Safety posture")}
        </span>
        {query.isLoading && <span className="text-muted-foreground">{t("common.loading", "Đang tải…")}</span>}
        {data != null && (
          <>
            <PostureFlag label={t("oversight.posture.otWrites", "Real OT writes")} on={data.otControlEnabled} warn={data.writesOnEngineOff && data.otControlEnabled} />
            <PostureFlag label={t("oversight.posture.robotWrites", "Real robot writes")} on={data.robotControlEnabled} warn={data.writesOnEngineOff && data.robotControlEnabled} />
            <PostureFlag label={t("oversight.posture.dpcDeploy", "Program deploy")} on={data.dpcDeployEnabled} />
            <PostureFlag label={t("oversight.posture.interlockEngine", "Interlock engine")} on={data.interlockEngineEnabled} warn={data.writesOnEngineOff} />
            <PostureFlag label={t("oversight.posture.interlockAutoBlock", "Interlock auto-block")} on={data.interlockAutoBlockEnabled} />
            <span className="text-muted-foreground">
              {data.interlockCoverageDegraded
                ? t("oversight.posture.coverageUnavailable", "Rule coverage unavailable")
                : t("oversight.posture.ruleCoverage", "Rules enabled with a target: {{count}}", { count: data.interlockRulesEnabledWithTarget })}
            </span>
          </>
        )}
      </div>
      {data?.writesOnEngineOff && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-sm text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <span>
            {t(
              "oversight.posture.writesOnEngineOffWarning",
              "Real device writes are ON while the interlock engine is OFF — violations will not be auto-blocked.",
            )}
          </span>
        </div>
      )}
    </div>
  );
}

export default function EngineeringHub() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();

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

        {/* Doc 80 Đợt 1 Task 2 (ILK-06) — dải "Tư thế an toàn". */}
        <SafetyPostureStrip />

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
