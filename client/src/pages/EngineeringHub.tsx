/**
 * EngineeringHub — "/engineering-home" — W6-26 (doc 25 T8); doc 81 Đợt 2 Task 15: mẫu P4 Cockpit + gộp Studio.
 *
 * Bố cục (doc 81 §1.2 dòng "Hub", FE1 §2.1/§2.2):
 * - Header MỘT hàng (`CockpitLayout` ⇒ `PageHeaderCompact`): h1 · chip "Luồng vàng" (khối chữ tĩnh 57 px cũ ⇒ popover,
 *   giữ nguyên câu) · chip TƯ THẾ AN TOÀN ghim (R-2-p): vàng khi ghi lệnh thật BẬT mà engine interlock TẮT (ILK-06) —
 *   luôn ở header kể cả dưới 1024 px, khi panel phụ xuống dưới MAIN.
 * - MAIN = hàng tab `?tab=` [Hộp việc | Danh mục công cụ] + nội dung.
 *   · Hộp việc = BẢNG của `PendingReviewStrip` (Đợt 1 Task 2): cùng nguồn `oversight.pendingSummary`, cùng link sâu
 *     `?filter=pending`, cùng luật HUB-01/HUB-02. Phạm vi `?scope=` (cùng hàng tab): "Chờ duyệt" (MẶC ĐỊNH — loại việc
 *     KHÔNG khẩn của `PENDING_CATEGORIES` (`critical:false` = chờ duyệt bình thường), chỉ ở màn người dùng mở được theo
 *     bản đồ quyền nav) | "Toàn module" (đủ 9 loại như dải cũ). Spec ghi "của tôi": `pendingSummary` KHÔNG mang người
 *     được giao ⇒ không thể lọc "giao cho tôi" mà không đổi server; nhãn nói đúng thứ nó lọc (task-15-report).
 *   · Danh mục (Studio cũ gộp vào — `/engineering-studio` chuyển hướng tới `?tab=catalog`): ô 64 px theo nhóm, ghim
 *     được (kho ghim chung `nav-favorites` của thanh bên/⌘K), gồm cả mục chỉ Studio có (ECN, Bảng lệnh, Copilot nháp).
 * - Panel phụ (`aside`): tư thế an toàn đầy đủ (cờ, độ phủ rule, cảnh báo ILK-06 — nội dung Đợt 1 Task 2 giữ nguyên)
 *   + công cụ Đã ghim / Gần đây (ô 64 px) + "Tất cả công cụ".
 *
 * Chỉ điều hướng (read-only) — không có mutation. Mỗi route đích tự thực thi RBAC của nó; ô công cụ báo trước mức quyền
 * (U7) và công cụ soạn thảo chỉ hiện cho người soạn được (doc 81 §1.4 — `passesNavAuthoringGate`, như thanh bên).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import {
  CockpitLayout,
  NoticeChip,
  PageContainer,
  StatusChipStrip,
  chipStateFromQuery,
  type StatusChipItem,
} from "@/components/patterns";
import { useUrlParam } from "@/components/patterns/useUrlParam";
import type { TabbedHubTab } from "@/components/workspace/TabbedHub";
import { PendingReviewStrip, PENDING_CATEGORIES, type CategoryDef } from "@/components/PendingReviewStrip";
import { getNavItemByHref, hasAccessToItem, passesNavAuthoringGate } from "@/lib/navigation";
import { readFavorites, readRecent, toggleFavorite } from "@/lib/navRecent";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useAuth } from "@/_core/hooks/useAuth";
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
  Eye,
  AlertTriangle,
  GitPullRequest,
  Sparkles,
  Terminal,
  Star,
  type LucideIcon,
} from "lucide-react";

const BASE_PATH = "/engineering-home";

interface HubTile {
  icon: LucideIcon;
  href: string;
  /** Key nav.* dùng cho nhãn; blurb = <key>Desc. */
  navKey?: string;
  /** Mục không có trong nav (Bảng lệnh, Copilot nháp): khoá i18n nhãn riêng (cổng F13 navKeyResolution quét `label:`). */
  label?: string;
  /** Quyền route khi mục không phải mục nav (App.tsx RouteGuard). */
  requiredPermission?: string;
}

interface HubGroup {
  /** Section key (khớp nav.section.*). */
  sectionKey: string;
  tiles: HubTile[];
}

/**
 * Danh mục — HỢP của nhóm tác vụ Hub cũ (khớp navigation.tsx group "engineering") và launcher Studio cũ
 * (EngineeringStudioHub: thêm ECN, Command Console; Programming Copilot ⇒ chế độ scratch của IDE).
 */
export const HUB_CATALOG: HubGroup[] = [
  {
    sectionKey: "authoring",
    tiles: [
      { icon: Code2, navKey: "engineeringWorkspace", href: "/engineering" },
      { icon: Sparkles, label: "engineeringHome.tools.copilotScratch", href: "/engineering?copilot=scratch" },
      { icon: GitBranch, navKey: "irEditor", href: "/ir-editor" },
      { icon: FileCode2, navKey: "pouStudio", href: "/pou-studio" },
      { icon: FlaskConical, navKey: "recipes", href: "/recipes" },
      { icon: GitPullRequest, navKey: "engineeringChanges", href: "/engineering-changes" },
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
    // Product-audit fix — nửa "vận hành" của miền (control/ops/audit).
    sectionKey: "operationsControl",
    tiles: [
      { icon: Network, navKey: "controlPlane", href: "/control-plane" },
      { icon: Bot, navKey: "robotControl", href: "/robot-control" },
      { icon: Terminal, label: "engineeringHome.tools.commandConsole", href: "/command-console", requiredPermission: "machine_control" },
      { icon: Gauge, navKey: "opsConsole", href: "/ops-console" },
      { icon: ScrollText, navKey: "commandAudit", href: "/audit-logs?tab=command" },
    ],
  },
  {
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
const ALL_TILES = HUB_CATALOG.flatMap((g) => g.tiles);

/** R-2-v — vùng nội dung của MAIN (cả hai tab): cao theo khung nhìn, cuộn BÊN TRONG; trang không cuộn. */
const HUB_SCROLL_REGION = "mt-2 h-[calc(100dvh_-_var(--shell-chrome-h,3.5rem)_-_9.25rem)] min-h-[16rem] overflow-auto rounded-md border px-2";

/** Perm coi là "điều khiển" — tile cần quyền này để làm việc, không chỉ để xem. */
const CONTROL_PERMS = new Set(["machine_control", "interlock"]);

/** Quyền + cổng điều hướng của từng ô (U7 + doc 81 §1.4). */
function useTileAccess() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const role = (user as { role?: string } | null | undefined)?.role;
  /**
   * false ⇒ ẩn: (a) ô người dùng KHÔNG MỞ ĐƯỢC (quyền route — như `HubLauncher` của Studio cũ ẩn ô thiếu quyền; fix 1)
   * (b) công cụ soạn thảo với người không soạn được (cùng luật thanh bên — doc 81 §1.4).
   */
  const visible = (tile: HubTile) => {
    const nav = getNavItemByHref(tile.href);
    const perm = nav?.requiredPermission ?? tile.requiredPermission;
    if (perm && !hasPermission(perm, "canView")) return false;
    return !nav || passesNavAuthoringGate(nav, role, hasPermission as never);
  };
  const meta = (tile: HubTile) => {
    const nav = getNavItemByHref(tile.href);
    const perm = nav?.requiredPermission ?? tile.requiredPermission;
    let note: string | undefined;
    let noteIcon: LucideIcon | undefined;
    // Ô thiếu quyền xem đã bị ẩn (`visible`) ⇒ chỉ còn báo trước mức "Chỉ xem" (U7).
    if (perm && CONTROL_PERMS.has(perm) && !hasPermission(perm, "canEdit")) {
      note = t("engineeringHome.viewOnly", "Chỉ xem");
      noteIcon = Eye;
    }
    return { beta: nav?.beta === true, note, noteIcon };
  };
  const label = (tile: HubTile) => (tile.navKey ? t(`nav.${tile.navKey}`) : t(tile.label ?? tile.href));
  const blurb = (tile: HubTile) => (tile.navKey ? t(`nav.${tile.navKey}Desc`) : undefined);
  return { visible, meta, label, blurb };
}

/** Kho ghim chung (nav-favorites) — phản ứng với ghim ở thanh bên / ⌘K / tab khác. */
function useFavorites(): [string[], (href: string) => void] {
  const [favs, setFavs] = useState<string[]>(() => readFavorites());
  useEffect(() => {
    const refresh = () => setFavs(readFavorites());
    window.addEventListener("nav-favorites-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("nav-favorites-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return [favs, (href) => setFavs(toggleFavorite(href))];
}

/** Ô công cụ 64 px: link (icon + nhãn) + nút ghim. */
function ToolCell({ tile, pinned, onTogglePin }: { tile: HubTile; pinned?: boolean; onTogglePin?: () => void }) {
  const { t } = useTranslation();
  const { meta, label, blurb } = useTileAccess();
  const m = meta(tile);
  const name = label(tile);
  const NoteIcon = m.noteIcon;
  return (
    <div data-hub-tool={tile.href} className="group/tool flex h-16 min-w-0 items-center gap-1 rounded-lg border bg-card pr-1 hover:border-primary/50">
      <Link
        href={tile.href}
        title={[blurb(tile), m.note].filter(Boolean).join(" — ") || undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <tile.icon className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-xs font-semibold leading-tight text-foreground">{name}</span>
          {(m.beta || m.note) && (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] leading-none text-muted-foreground">
              {m.beta && <span className="font-medium text-warning">{t("layoutKit.notice.kind.beta", "Beta")}</span>}
              {NoteIcon && <NoteIcon className="h-3 w-3" aria-hidden="true" />}
              {m.note && <span className="truncate">{m.note}</span>}
            </span>
          )}
        </span>
      </Link>
      {onTogglePin && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-pressed={pinned}
          aria-label={pinned ? t("engineeringHome.tools.unpin", { name, defaultValue: "Unpin {{name}}" }) : t("engineeringHome.tools.pin", { name, defaultValue: "Pin {{name}}" })}
          title={pinned ? t("engineeringHome.tools.unpin", { name, defaultValue: "Unpin {{name}}" }) : t("engineeringHome.tools.pin", { name, defaultValue: "Pin {{name}}" })}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            !pinned && "opacity-60 group-hover/tool:opacity-100 focus-visible:opacity-100",
          )}
        >
          <Star className={cn("h-4 w-4", pinned && "fill-primary text-primary")} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Tab Danh mục — một lưới duy nhất (tiêu đề nhóm trải hết hàng) để chính lưới là vùng làm việc của MAIN. */
function CatalogTab() {
  const { t } = useTranslation();
  const { visible } = useTileAccess();
  const [favs, toggle] = useFavorites();
  return (
    // R-2-v — cùng vùng cuộn cao theo khung nhìn như Hộp việc (MAIN không đổi hình khi đổi tab; danh mục cuộn BÊN TRONG).
    <div data-hub-catalog-scroll="" className={HUB_SCROLL_REGION}>
    <div data-hub-catalog="" className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2 py-2">
      {HUB_CATALOG.map((group) => {
        const tiles = group.tiles.filter(visible);
        if (tiles.length === 0) return null;
        return [
          <h2 key={`h-${group.sectionKey}`} className="col-span-full pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
            {t(`nav.section.${group.sectionKey}`)}
          </h2>,
          ...tiles.map((tile) => (
            <ToolCell key={tile.href} tile={tile} pinned={favs.includes(tile.href)} onTogglePin={() => toggle(tile.href)} />
          )),
        ];
      })}
    </div>
    </div>
  );
}

/**
 * Doc 80 Đợt 1 Task 2 (ILK-06) — một cờ tư thế: chấm màu + nhãn + BẬT/TẮT. `warn` tô vàng khi cờ này (dù bật hay tắt)
 * là một phần của tình huống rủi ro (ghi lệnh thật BẬT trong khi engine interlock TẮT).
 */
function PostureFlag({ label, on, warn }: { label: string; on: boolean; warn?: boolean }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", warn ? "bg-warning" : on ? "bg-success" : "bg-muted-foreground/40")} aria-hidden="true" />
      <span className="min-w-0 flex-1 text-muted-foreground">{label}</span>
      <span className={cn("font-semibold", warn ? "text-warning" : "text-foreground")}>
        {on ? t("oversight.posture.on", "ON") : t("oversight.posture.off", "OFF")}
      </span>
    </li>
  );
}

function usePostureQuery() {
  return trpc.oversight.posture.useQuery(undefined, { staleTime: 30_000 });
}

/**
 * Doc 80 Phụ lục D §6/§7.1 (ILK-06) — "Tư thế an toàn" (nội dung Đợt 1 Task 2, nay là mục đầu của panel phụ): cờ ghi
 * lệnh thật (OT/robot/nạp chương trình) + engine interlock + độ phủ rule. Nguồn `trpc.oversight.posture` (READ-ONLY, cờ ở
 * SERVER — không lộ tên biến `.env`). Ghi lệnh thật BẬT mà engine interlock TẮT ⇒ cảnh báo VÀNG.
 */
function PostureSection() {
  const { t } = useTranslation();
  const query = usePostureQuery();
  const data = query.data;
  return (
    <section aria-labelledby="hub-posture-title" className="space-y-2 text-sm">
      <h2 id="hub-posture-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("oversight.posture.title", "Safety posture")}
      </h2>
      {query.isLoading && <p className="text-muted-foreground">{t("common.loading", "Đang tải…")}</p>}
      {query.isError && <p className="text-destructive">{t("common.error", "Có lỗi khi tải")}</p>}
      {data != null && (
        <>
          <ul className="space-y-1">
            <PostureFlag label={t("oversight.posture.otWrites", "Real OT writes")} on={data.otControlEnabled} warn={data.writesOnEngineOff && data.otControlEnabled} />
            <PostureFlag label={t("oversight.posture.robotWrites", "Real robot writes")} on={data.robotControlEnabled} warn={data.writesOnEngineOff && data.robotControlEnabled} />
            <PostureFlag label={t("oversight.posture.dpcDeploy", "Program deploy")} on={data.dpcDeployEnabled} />
            <PostureFlag label={t("oversight.posture.interlockEngine", "Interlock engine")} on={data.interlockEngineEnabled} warn={data.writesOnEngineOff} />
            <PostureFlag label={t("oversight.posture.interlockAutoBlock", "Interlock auto-block")} on={data.interlockAutoBlockEnabled} />
          </ul>
          <p className="text-xs text-muted-foreground">
            {data.interlockCoverageDegraded
              ? t("oversight.posture.coverageUnavailable", "Rule coverage unavailable")
              : t("oversight.posture.ruleCoverage", "Rules enabled with a target: {{count}}", { count: data.interlockRulesEnabledWithTarget })}
          </p>
          {data.writesOnEngineOff && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                {t(
                  "oversight.posture.writesOnEngineOffWarning",
                  "Real device writes are ON while the interlock engine is OFF — violations will not be auto-blocked.",
                )}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Công cụ trong panel phụ: Đã ghim + Gần đây (ô 64 px, cùng kho với thanh bên/⌘K) + "Tất cả công cụ". */
function ToolsSection({ onShowAll }: { onShowAll: () => void }) {
  const { t } = useTranslation();
  const { visible } = useTileAccess();
  const [favs, toggle] = useFavorites();
  const byHref = useMemo(() => new Map(ALL_TILES.map((x) => [x.href, x])), []);
  const pinned = favs.map((h) => byHref.get(h)).filter((x): x is HubTile => !!x && visible(x));
  const recent = readRecent()
    .filter((h) => !favs.includes(h))
    .map((h) => byHref.get(h))
    .filter((x): x is HubTile => !!x && visible(x))
    .slice(0, 4);
  const list = (titleKey: string, fallback: string, tiles: HubTile[], pinnable: boolean) => (
    <div className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t(titleKey, fallback)}</h3>
      <ul aria-label={t(titleKey, fallback)} className="grid grid-cols-1 gap-1.5">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <ToolCell tile={tile} pinned={pinnable} onTogglePin={pinnable ? () => toggle(tile.href) : undefined} />
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <section aria-labelledby="hub-tools-title" className="space-y-2">
      <h2 id="hub-tools-title" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t("engineeringHome.tools.title", "Tools")}
      </h2>
      {pinned.length > 0
        ? list("engineeringHome.tools.pinned", "Pinned", pinned, true)
        : <p className="text-xs text-muted-foreground">{t("engineeringHome.tools.none", "No pinned tools yet — press ☆ in the catalog to pin one.")}</p>}
      {recent.length > 0 && list("engineeringHome.tools.recent", "Recent", recent, false)}
      <button
        type="button"
        onClick={onShowAll}
        className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        {t("engineeringHome.tools.all", "All tools")} <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

type Scope = "approvals" | "all";

/** Lọc phạm vi "Chờ duyệt": loại việc không khẩn, ở màn người dùng mở được (bản đồ quyền nav — như RouteGuard). */
function useScopeFilters() {
  const { hasPermission } = usePermissions();
  const { user } = useAuth();
  const role = (user as { role?: string } | null | undefined)?.role;
  const canOpen = (c: CategoryDef) => {
    const nav = getNavItemByHref(c.href);
    return !nav || hasAccessToItem(nav.href, role, hasPermission as never);
  };
  const approvals = (c: CategoryDef) => !c.critical && canOpen(c);
  return { approvals, canOpen };
}

/** R-2-y — loại KHẨN (`critical:true` = thẻ ĐỎ của Hub cũ): luôn thấy, mọi phạm vi. */
const isCritical = (c: CategoryDef) => c.critical;

function InboxTab() {
  const [scopeParam] = useUrlParam("scope");
  const scope: Scope = scopeParam === "all" ? "all" : "approvals";
  const { approvals, canOpen } = useScopeFilters();
  return (
    // R-2-v — hộp việc lấp chiều cao còn lại của khung nhìn; danh sách cuộn BÊN TRONG (thead dính), trang không cuộn.
    <div data-hub-inbox-scroll="" className={HUB_SCROLL_REGION}>
      {/* R-2-z5 — dòng (kể cả loại khẩn ghim) mà vai không mở được: giữ số, không là link. */}
      <PendingReviewStrip variant="table" pinned={isCritical} categoryFilter={scope === "all" ? undefined : approvals} canOpen={canOpen} />
    </div>
  );
}

/** Nút phạm vi hộp việc (cùng hàng tab — toolbar duy nhất của MAIN) + số đếm của từng phạm vi. */
function ScopeToggle() {
  const { t } = useTranslation();
  const [scopeParam, setScope] = useUrlParam("scope");
  const scope: Scope = scopeParam === "all" ? "all" : "approvals";
  const { approvals } = useScopeFilters();
  const q = trpc.oversight.pendingSummary.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  const count = (filter?: (c: CategoryDef) => boolean) =>
    q.data == null ? null : PENDING_CATEGORIES.filter(filter ?? (() => true)).reduce((n, c) => n + q.data![c.key].count, 0);
  const item = (value: Scope, labelKey: string, fallback: string, hintKey: string, hintFallback: string, n: number | null) => (
    <button
      type="button"
      aria-pressed={scope === value}
      title={t(hintKey, hintFallback)}
      onClick={() => setScope(value === "approvals" ? null : "all")}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        scope === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {t(labelKey, fallback)}
      {n != null && <span className="tabular-nums">{n > 99 ? "99+" : n}</span>}
    </button>
  );
  return (
    <div role="group" aria-label={t("engineeringHome.scopeLabel", "Inbox scope")} className="ml-auto flex shrink-0 items-center gap-1 rounded-lg border p-0.5">
      {item("approvals", "engineeringHome.scopeApprovals", "Awaiting approval", "engineeringHome.scopeApprovalsHint", "", count(approvals))}
      {item("all", "engineeringHome.scopeAll", "Whole module", "engineeringHome.scopeAllHint", "", count())}
    </div>
  );
}

const TABS: readonly TabbedHubTab[] = [
  { value: "inbox", labelKey: "engineeringHome.inboxTab", fallback: "Work inbox", Content: InboxTab },
  { value: "catalog", labelKey: "engineeringHome.catalogTab", fallback: "Tool catalog", Content: CatalogTab },
];

export default function EngineeringHub() {
  const { t } = useTranslation();
  const [tab, setTab] = useUrlParam("tab");
  const postureQ = usePostureQuery();
  const p = postureQ.data;
  // R-2-y — chip KHẨN ghim (R-2-p): tổng 4 loại khẩn, thấy ở MỌI tab/phạm vi và dưới 1024 px. Đang tải/lỗi KHÔNG
  // bao giờ đọc thành 0/OK (chipStateFromQuery); một nguồn khẩn không đọc được ⇒ "degraded" (≥).
  const pendingQ = trpc.oversight.pendingSummary.useQuery(undefined, { staleTime: 30_000, refetchOnWindowFocus: true });
  const criticalCats = PENDING_CATEGORIES.filter(isCritical);
  const criticalTotal = pendingQ.data == null ? null : criticalCats.reduce((n, c) => n + pendingQ.data![c.key].count, 0);
  const criticalChip: StatusChipItem = {
    id: "critical",
    label: t("engineeringHome.criticalChip", "Urgent"),
    value: criticalTotal,
    state: chipStateFromQuery(pendingQ, (d) => criticalCats.some((c) => d[c.key].degraded)),
    source: t("engineeringHome.criticalSource", "oversight.pendingSummary — urgent categories"),
    tone: criticalTotal != null && criticalTotal > 0 ? "error" : "success",
    pinned: true,
    onClick: () => setTab("inbox"),
  };

  const postureChip: StatusChipItem = {
    id: "posture",
    label: t("engineeringHome.postureChip", "Safety posture"),
    value: p == null ? null : p.writesOnEngineOff ? t("engineeringHome.postureWarn", "Warning") : t("engineeringHome.postureOk", "Normal"),
    state: chipStateFromQuery(postureQ),
    source: t("engineeringHome.postureSource", "oversight.posture — server-side flags, read-only"),
    tone: p?.writesOnEngineOff ? "warning" : "success",
    pinned: true,
  };

  return (
    <DashboardLayout>
      {/* doc 81 Đợt 2 Task 2 — PageContainer: không đệm kép với <main> của shell. */}
      <PageContainer className="space-y-0">
        <CockpitLayout
          icon={<LayoutDashboard />}
          title={t("engineeringHome.title", "Engineering Hub")}
          notices={
            <NoticeChip kind="hint" label={t("engineeringHome.goldenThreadChip", "Golden thread")}>
              {t(
                "engineeringHome.goldenThread",
                "Golden thread: author → simulate → deploy → monitor. Programs authored here flow into the pipeline, run in the twin, then surface on the monitoring pages.",
              )}
            </NoticeChip>
          }
          chips={<StatusChipStrip items={[criticalChip, postureChip]} />}
          tabs={TABS}
          basePath={BASE_PATH}
          defaultTab="inbox"
          toolbarEnd={tab === "catalog" ? undefined : <ScopeToggle />}
          side={
            <div className="space-y-5">
              <PostureSection />
              <ToolsSection onShowAll={() => setTab("catalog")} />
            </div>
          }
          sideLabel={t("engineeringHome.sideLabel", "Safety posture and tools")}
          mainName="engineering-home"
        />
      </PageContainer>
    </DashboardLayout>
  );
}
