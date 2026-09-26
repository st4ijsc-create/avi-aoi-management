/**
 * U2 (doc 21 §6 / §3 G-3) — ECOSYSTEM COMMAND CENTER — the single pane of glass.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ONE screen that answers "is the whole ecosystem healthy right now?" without
 * hopping across ~16 fragmented dashboards. Three panes over the `commandCenter.*`
 * aggregation router (which reuses twin.sceneGraph / oeeService / andon+safety /
 * federation roll-ups — no data recomputed here) + the U1 live event stream:
 *
 *   TOP  · KPI STRIP  — OEE, WIP/bottleneck, alarms(crit/high), fleet, sites, AI
 *                        insights, energy(honest "—"). A LIVE/POLLING badge from
 *                        commandCenter.status.mode (U1 ECOSYSTEM_EVENTS_ENABLED).
 *   LEFT · HIERARCHY  — expandable live tree site→factory→line→station→machine/robot,
 *                        status dot rolled UP, deviceType chip, alarm/task/offline
 *                        badges. Select a node → filters the center + alarm rail; a
 *                        machine/robot leaf → "Open cockpit" → /machine|/robot/:id (U3).
 *   CENTER · OVERVIEW — the selected factory's live STATUS GRID (line→station→device),
 *                        enriched with PackML state from its own twin.sceneGraph query.
 *                        ★ Đợt 61 (QĐ-31): cảnh 3D compact (Canvas drei đời cũ) ĐÃ BỎ —
 *                        nó trùng /twin (kit twin3d) và đốt thêm 1 WebGL context.
 *                        Trang + 4 thủ tục commandCenter.* + 10 lối vào giữ nguyên.
 *   RIGHT · ALARM RAIL — seeded from commandCenter.recentAlerts, then LIVE-appended
 *                        from useEcosystemEvents() (dedupe by id, cap ~100). Click an
 *                        alert → navigate to the scoped machine/robot cockpit.
 *
 * LIVE-vs-POLL: when status.mode==="live" the rail is driven by the U1 socket; when
 * "polling" we ALSO poll recentAlerts every ~15s. The hierarchy is polled every ~10s
 * for roll-up freshness regardless (status is a slow aggregate, not a live delta).
 *
 * READ-ONLY. No control path. RBAC: machine_monitoring/canView (router-enforced).
 * i18n via t("cmd.*","English default") fallbacks (nav keys added to locale files).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useMemo, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { MetricCard, PageHeader, StatusBadge, SectionCard, severityDotClass, toneHex } from "@/components/patterns";
import { EmptyState } from "@/components/EmptyState";
import { isScopeEmpty } from "@/lib/scopeEmpty";
import { relTimeShort } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEcosystemEvents, type EcosystemEvent, type EcosystemSeverity } from "@/hooks/useEcosystemEvents";
import PollFreshness from "@/components/PollFreshness";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ContextDrawer } from "@/components/workspace/ContextDrawer";
import {
  Gauge, Boxes, AlertTriangle, Bot, Network, Sparkles, Zap, Activity, Factory,
  ChevronRight, ChevronDown, Cpu, Radio, RefreshCw, ExternalLink,
  ListChecks, WifiOff as OfflineIcon, MapPin, Info, Layers, ServerCog, Clock,
} from "lucide-react";

// ── Typesafe shapes inferred from the commandCenter router output ──────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type HierarchyResult = RouterOutputs["commandCenter"]["hierarchy"];
type HierarchyNode = HierarchyResult["sites"][number];
type KpiSummary = RouterOutputs["commandCenter"]["kpiSummary"];
type SeedAlert = RouterOutputs["commandCenter"]["recentAlerts"]["alerts"][number];
type TwinScene = RouterOutputs["twin"]["sceneGraph"];
type TwinDevice = TwinScene["devices"][number];

type NodeStatus = HierarchyNode["status"];
type NodeKind = HierarchyNode["kind"];

// A unified alarm row: the live EcosystemEvent envelope, which the SeedAlert mirrors.
type AlarmRow = EcosystemEvent;

// doc67 W8 — ngưỡng "tồn đọng" của rail cảnh báo: quá 24h chưa xử lý.
const DAY_MS = 86_400_000;

// doc 68 §3.1 [P1] — chiều cao thân CHUNG cho 3 pane (cây | twin | dải cảnh báo)
// để canh đáy đều nhau (thay 3 height lệch cũ 520/420/532). Một hằng → sửa 1 chỗ.
const PANE_BODY_H = "h-[544px]";

// doc 68 §3.1 [P1] — hình chuẩn hoá thiết bị mở ContextDrawer chi tiết. Gộp 2 nguồn:
// khối twin/chip 2D (có state PackML + activeTaskId) và lá cây (chỉ có status roll-up).
// Trường thiếu → drawer hiển thị "—" trung thực, không bịa số.
interface DrawerDevice {
  refId: number;
  kind: "machine" | "robot";
  name: string;
  code: string;
  /** Trạng thái PackML từ twin (khi mở từ khối twin / chip 2D). */
  state?: string | null;
  /** Lệnh đang chạy (robot) từ twin. */
  activeTaskId?: number | null;
  /** Trạng thái roll-up của node cây (khi mở từ lá cây). */
  status?: NodeStatus;
}

// ════════════════════════════════════════════════════════════════════════════
// SMALL HELPERS
// ════════════════════════════════════════════════════════════════════════════

// ── doc 67 W7 GĐ2 (việc 1) — màu trạng thái lấy từ nguồn DS chung
// (patterns/isaStateBadges): toneHex() cho chấm trạng thái 2D (stateHex + legend
// 3D đã bỏ ở Đợt 61 cùng Canvas)
// (đọc CSS var theo theme, cache, fallback tĩnh khớp đúng bảng STATUS_HEX cũ),
// severityDotClass() cho chấm 2D. Bảng STATUS_DOT/STATUS_HEX local đã xoá.
// LƯU Ý ĐÃ DUYỆT: bảng cũ tự mâu thuẫn — STATUS_HEX.idle = amber (#f59e0b) trong
// khi STATUS_DOT.idle = muted-xám; bản shared thống nhất idle → muted-xám, nên
// node idle trên canvas 3D ĐỔI MÀU (amber → xám) là CHỦ ĐÍCH, không phải regression.

/** Chấm 2D theo NodeStatus. severityDotClass (GĐ1) nhận từ vựng severity nên
 * chưa hiểu "down" của NodeStatus → ánh xạ về "critical" trước khi gọi
 * (ok→success · warn→warning · down→danger · idle/unknown→muted). */
const statusDotClass = (s: NodeStatus): string =>
  severityDotClass(s === "down" ? "critical" : s);

// ── W4 (doc 67) — nhãn tiếng Việt trực tiếp (UI tiếng Việt, key i18n cmd.* chưa
// có trong JSON locale nên các chuỗi thô EN bị lộ; nhãn mới đi thẳng tiếng Việt). ──

/** Trạng thái node cây/lưới (title + sr). */
const STATUS_KEY: Record<NodeStatus, string> = {
  ok: "cmdCenter.status.ok",
  warn: "cmdCenter.status.warn",
  down: "cmdCenter.status.down",
  idle: "cmdCenter.status.idle",
  unknown: "cmdCenter.status.unknown",
};

/** Mức độ cảnh báo trên rail. */
const SEVERITY_KEY: Record<EcosystemSeverity, string> = {
  critical: "cmdCenter.severity.critical",
  high: "cmdCenter.severity.high",
  medium: "cmdCenter.severity.medium",
  low: "cmdCenter.severity.low",
  info: "cmdCenter.severity.info",
};

/** Loại sự kiện (kind) trên rail. */
const KIND_KEY: Record<string, string> = {
  inspection: "cmdCenter.kind.inspection",
  andon: "cmdCenter.kind.andon",
  safety: "cmdCenter.kind.safety",
  spc: "SPC",
  quality_gate: "cmdCenter.kind.quality_gate",
  escalation: "cmdCenter.kind.escalation",
  maintenance: "cmdCenter.kind.maintenance",
  downtime: "cmdCenter.kind.downtime",
  oee: "OEE",
  task: "cmdCenter.kind.task",
  workorder: "cmdCenter.kind.workorder",
  anomaly: "cmdCenter.kind.anomaly",
  program: "cmdCenter.kind.program",
  twin: "cmdCenter.kind.twin",
  ng: "NG",
  yield: "cmdCenter.kind.yield",
  event: "cmdCenter.kind.event",
};

/** Nhóm trạng thái twin → nhãn tiếng Việt (đồng bộ với statusHexFromTwinState). */
function twinStateCategoryKey(state: string | null | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "running": case "execute": case "active": return "cmdCenter.twin.dangChay";
    case "idle": return "cmdCenter.twin.cho";
    case "stopped": case "held": case "suspended": return "cmdCenter.twin.tamDung";
    case "aborted": case "error": case "fault": case "estop": return "cmdCenter.twin.loiEStop";
    case "offline": return "cmdCenter.twin.ngoaiTuyen";
    default: return "cmdCenter.twin.khongRo";
  }
}

function statusHexFromTwinState(state: string | null | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "running": case "execute": case "active": return toneHex("success");
    // idle → muted-xám (trước là amber — đổi CHỦ ĐÍCH, xem ghi chú GĐ2 phía trên).
    case "idle": return toneHex("muted");
    // Cam "tạm dừng/giữ" + xám-lam "ngoại tuyến": hạng mục riêng của twin, DS chưa
    // có tone tương đương → giữ hex như bản cũ (không thuộc bảng STATUS_HEX đã xoá).
    case "stopped": case "held": case "suspended": return "#f97316";
    case "aborted": case "error": case "fault": case "estop": return toneHex("danger");
    case "offline": return "#64748b";
    default: return toneHex("muted");
  }
}

/** Map an alert severity → a StatusBadge tone (mirrors the U1 alert-class rule). */
function severityTone(sev: EcosystemSeverity): "error" | "warning" | "info" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "info";
}

/** Walk a node's descendants, returning every id in its subtree (for scope filtering). */
function collectScope(node: HierarchyNode): {
  factoryIds: Set<number>;
  machineIds: Set<number>;
  robotIds: Set<number>;
  lineIds: Set<number>;
} {
  const factoryIds = new Set<number>();
  const machineIds = new Set<number>();
  const robotIds = new Set<number>();
  const lineIds = new Set<number>();
  const walk = (n: HierarchyNode) => {
    if (n.kind === "factory" && typeof n.refId === "number") factoryIds.add(n.refId);
    if (n.kind === "line" && typeof n.refId === "number") lineIds.add(n.refId);
    if (n.kind === "machine" && typeof n.refId === "number") machineIds.add(n.refId);
    if (n.kind === "robot" && typeof n.refId === "number") robotIds.add(n.refId);
    n.children?.forEach(walk);
  };
  walk(node);
  return { factoryIds, machineIds, robotIds, lineIds };
}

/**
 * doc67 W8 [P2] — TREE SEARCH: lọc cây theo text (tên/mã, đã lowercase) +
 * toggle "chỉ node có cảnh báo" (dựa roll-up counts.activeAlarms — server đã
 * cộng dồn con lên cha nên nhánh sạch bị cắt cả cụm, nhánh chứa cảnh báo giữ
 * nguyên đường xuống lá). Node khớp text giữ NGUYÊN nhánh con (vẫn lọc theo
 * alarmOnly) để duyệt tiếp được; nhánh không chứa kết quả bị cắt.
 */
function filterHierarchy(nodes: HierarchyNode[], q: string, alarmOnly: boolean): HierarchyNode[] {
  const out: HierarchyNode[] = [];
  for (const n of nodes) {
    if (alarmOnly && n.counts.activeAlarms === 0) continue; // roll-up: nhánh sạch → cắt
    const selfMatch =
      q === "" || n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q);
    const kids = n.children ? filterHierarchy(n.children, q, alarmOnly) : [];
    if (selfMatch) {
      // Node khớp: giữ toàn bộ con (chỉ áp alarmOnly, bỏ điều kiện text) để
      // chọn "Factory A" vẫn mở xem được line/máy bên trong.
      out.push({
        ...n,
        children: q === "" ? kids : n.children ? filterHierarchy(n.children, "", alarmOnly) : [],
      });
    } else if (kids.length > 0) {
      out.push({ ...n, children: kids });
    }
  }
  return out;
}

/** doc67 W8 — highlight đoạn khớp trong tên node (giữ text thuần khi không khớp). */
function HighlightedName({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded-sm bg-warning/40 px-0 text-inherit">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Find a node anywhere in the tree by id. */
function findNode(sites: HierarchyNode[], id: string): HierarchyNode | null {
  let hit: HierarchyNode | null = null;
  const walk = (n: HierarchyNode) => {
    if (hit) return;
    if (n.id === id) { hit = n; return; }
    n.children?.forEach(walk);
  };
  sites.forEach(walk);
  return hit;
}

/** The nearest factory refId in/under a selected node (for the center twin). */
function factoryIdForSelection(node: HierarchyNode | null): number | null {
  if (!node) return null;
  if (node.kind === "factory" && typeof node.refId === "number") return node.refId;
  // For a machine/robot/line/station leaf we don't carry the factory back-ref; the
  // caller resolves the factory by finding the ancestor. We handle that separately.
  const s = collectScope(node);
  const first = [...s.factoryIds][0];
  return first ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// LEFT PANE — the live hierarchy tree.
// ════════════════════════════════════════════════════════════════════════════

function kindIcon(kind: NodeKind) {
  switch (kind) {
    case "site": return <Network className="h-3.5 w-3.5" />;
    case "factory": return <Factory className="h-3.5 w-3.5" />;
    case "line": return <Layers className="h-3.5 w-3.5" />;
    case "station": return <MapPin className="h-3.5 w-3.5" />;
    case "robot": return <Bot className="h-3.5 w-3.5" />;
    case "machine": default: return <Cpu className="h-3.5 w-3.5" />;
  }
}

function TreeNode({
  node, depth, expanded, onToggle, selectedId, onSelect, onOpenDevice, t, highlight = "",
}: {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** doc 68 §3.1 [P1] — lá cây (máy/robot) → mở ContextDrawer chi tiết thiết bị. */
  onOpenDevice: (node: HierarchyNode) => void;
  t: ReturnType<typeof useTranslation>["t"];
  /** doc67 W8 — chuỗi tìm kiếm (lowercase) để highlight đoạn khớp trong tên. */
  highlight?: string;
}) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const isOpen = expanded.has(node.id);
  const isLeaf = node.kind === "machine" || node.kind === "robot";
  const selected = selectedId === node.id;

  // W4 (doc 67) — pattern chạm cho node có con: chạm cả HÀNG luôn chọn node; nếu
  // node đang ĐÓNG thì đồng thời MỞ (1 chạm = chọn + mở, kiểu VS Code); khi node
  // đã được chọn và đang mở, chạm lần 2 lên hàng sẽ THU GỌN. Nút mũi tên vẫn
  // toggle riêng (stopPropagation) cho thao tác chuột quen kiểu cũ.
  const handleRowActivate = () => {
    if (hasChildren && (!isOpen || selected)) onToggle(node.id);
    onSelect(node.id);
    // doc 68 §3.1 [P1] — lá máy/robot: chọn (scope dải cảnh báo) + mở drawer chi tiết.
    if (isLeaf) onOpenDevice(node);
  };

  // W4 (doc 67) — bàn phím theo WAI-ARIA tree (subset gọn, roving tabindex qua
  // node đang chọn): Enter/Space = chọn; ArrowRight = mở; ArrowLeft = đóng.
  // stopPropagation để phím không nổi bọt lên treeitem cha (DOM lồng nhau).
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // phím phát từ nút con → bỏ qua
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); e.stopPropagation();
      onSelect(node.id);
      if (isLeaf) onOpenDevice(node); // doc 68 §3.1 — bàn phím cũng mở drawer cho lá.
    } else if (e.key === "ArrowRight" && hasChildren && !isOpen) {
      e.preventDefault(); e.stopPropagation();
      onToggle(node.id);
    } else if (e.key === "ArrowLeft" && hasChildren && isOpen) {
      e.preventDefault(); e.stopPropagation();
      onToggle(node.id);
    }
  };

  return (
    <div>
      {/* W4 (doc 67): min-h-11 (44px) đạt chuẩn chạm; role="treeitem" + tabIndex
          roving (node đang chọn = 0; fallback các site gốc khi chưa chọn gì). */}
      <div
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasChildren ? isOpen : undefined}
        aria-level={depth + 1}
        tabIndex={selected ? 0 : selectedId == null && depth === 0 ? 0 : -1}
        className={cn(
          "group flex min-h-11 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm cursor-pointer hover:bg-muted/60",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          selected && "bg-primary/10 ring-1 ring-primary/30",
        )}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={handleRowActivate}
        onKeyDown={handleKeyDown}
      >
        {/* expander — W4 (doc 67): hit-area 40×40 (h-10 w-10, margin âm giữ hàng
            gọn), icon giữ nhỏ; tabIndex=-1 vì hàng treeitem đã nhận bàn phím. */}
        {hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            className="-my-1 -ml-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={(e) => { e.stopPropagation(); onToggle(node.id); }}
            aria-label={isOpen ? t("commandCenter.thuGon", "Thu gọn") : t("commandCenter.moRong", "Mở rộng")}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="-ml-1.5 w-10 shrink-0" />
        )}

        {/* status dot */}
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(node.status))} title={t(STATUS_KEY[node.status])} />

        {/* kind icon + name */}
        <span className="shrink-0 text-muted-foreground">{kindIcon(node.kind)}</span>
        <span className="truncate font-medium"><HighlightedName text={node.name} query={highlight} /></span>

        {/* deviceType chip (leaves only) */}
        {isLeaf && node.deviceType && (
          <Badge variant="outline" className="ml-0.5 shrink-0 px-1 py-0 text-[10px] text-muted-foreground">
            {node.deviceType}
          </Badge>
        )}

        {/* count badges */}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {node.counts.activeAlarms > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-destructive/15 px-1 text-[10px] font-medium text-destructive" title={t("cmd.alarms", "Active alarms")}>
              <AlertTriangle className="h-2.5 w-2.5" />{node.counts.activeAlarms}
            </span>
          )}
          {node.counts.activeTasks > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-info/15 px-1 text-[10px] font-medium text-info" title={t("cmd.tasks", "Active tasks")}>
              <ListChecks className="h-2.5 w-2.5" />{node.counts.activeTasks}
            </span>
          )}
          {node.counts.offline > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground" title={t("cmd.offline", "Offline")}>
              <OfflineIcon className="h-2.5 w-2.5" />{node.counts.offline}
            </span>
          )}
          {/* doc 68 §3.1 [P1+P3]: nút mở CHI TIẾT (ContextDrawer phải) thay nút
              "mở cockpit" điều-hướng-ngay cũ — cockpit nay là CTA bước-2 trong drawer.
              Hit-area 40×40 (W4), hiện thường trực (cảm ứng không hover). */}
          {isLeaf && typeof node.refId === "number" && (
            <button
              type="button"
              className="-my-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={t("commandCenter.xemChiTietThietBi", "Xem chi tiết thiết bị")}
              aria-label={t("commandCenter.xemChiTietNode", { name: node.name })}
              onClick={(e) => { e.stopPropagation(); onSelect(node.id); onOpenDevice(node); }}
            >
              <Info className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>

      {hasChildren && isOpen && (
        <div role="group">
          {node.children!.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
              onSelect={onSelect}
              onOpenDevice={onOpenDevice}
              t={t}
              highlight={highlight}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CENTER PANE — lưới trạng thái trực tiếp của nhà máy đang chọn.
//
// ★★★ ĐỢT 61 (QĐ-31) — CẢNH 3D CỦA MÀN NÀY ĐÃ BỊ BỎ (177 dòng: FLOOR_W/FLOOR_D,
//   gridPositions, TwinBlock, CompactTwinScene) cùng `<Canvas>` drei đời cũ, bộ
//   chuyển 2D/3D, khoá localStorage `commandCenter:viewMode`, thăm dò WebGL và
//   hàm `Legend`. Lý do: cảnh ấy TRÙNG `/twin` (đã chạy kit `twin3d/loi`, 1 draw
//   call, dispose triệt để) trong khi bản ở đây là `@react-three/fiber` + drei
//   dựng tay ⇒ mỗi lượt mở `/command-center` đốt thêm MỘT WebGL context cho một
//   cảnh người dùng đã có chỗ xem tốt hơn. Trang, 4 thủ tục `commandCenter.*` và
//   10 lối vào GIỮ NGUYÊN.
//
// ⚠ `twin.sceneGraph` **KHÔNG** bị bỏ theo — đo được nó phục vụ 4 thứ của đường
//   2D, không riêng cảnh 3D: (1) số thiết bị trên tiêu đề pane, (2) chấm tươi
//   `PollFreshness`, (3) trạng thái đang tải của pane, (4) làm giàu PackML
//   (`state`, `activeTaskId`) cho chip 2D khi mở ContextDrawer. Bỏ nó là bỏ 4
//   tính năng đang sống của lưới 2D, không phải dọn bản sao của cảnh 3D.
// ════════════════════════════════════════════════════════════════════════════

/** Status-grid fallback: line→station→device cells coloured by hierarchy status.
 *  doc 68 §3.1 [P1]: chip thiết bị = <button> → mở ContextDrawer chi tiết (onDeviceOpen). */
function StatusGridFallback({
  factory, t, onDeviceOpen,
}: {
  factory: HierarchyNode | null;
  t: ReturnType<typeof useTranslation>["t"];
  onDeviceOpen?: (dev: HierarchyNode) => void;
}) {
  if (!factory || !factory.children?.length) {
    return (
      <div className={cn("flex items-center justify-center text-sm text-muted-foreground", PANE_BODY_H)}>
        {t("cmd.noFactoryLayout", "No line/station layout for this factory yet.")}
      </div>
    );
  }
  return (
    <ScrollArea className={cn("pr-2", PANE_BODY_H)}>
      <div className="space-y-3">
        {factory.children.map((line) => (
          <div key={line.id} className="rounded-md border p-2">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <span className={cn("h-2 w-2 rounded-full", statusDotClass(line.status))} />
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              {line.name}
            </div>
            <div className="space-y-1.5">
              {(line.children ?? []).map((station) => (
                <div key={station.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(station.status))} />
                    {station.name}
                  </span>
                  {(station.children ?? []).map((dev) => {
                    const isDev = (dev.kind === "machine" || dev.kind === "robot") && typeof dev.refId === "number";
                    const chipCls = cn(
                      "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      dev.status === "ok" && "bg-success/15 text-success",
                      dev.status === "warn" && "bg-warning/15 text-warning",
                      dev.status === "down" && "bg-destructive/15 text-destructive",
                      (dev.status === "idle" || dev.status === "unknown") && "bg-muted text-muted-foreground",
                    );
                    const chipInner = (
                      <>
                        {dev.kind === "robot" ? <Bot className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
                        {dev.code}
                      </>
                    );
                    return isDev && onDeviceOpen ? (
                      <button
                        key={dev.id}
                        type="button"
                        className={cn(chipCls, "cursor-pointer transition-colors hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
                        title={`${dev.name} · ${t(STATUS_KEY[dev.status])} — ${t("cmdCenter.moChiTiet", "mở chi tiết")}`}
                        onClick={() => onDeviceOpen(dev)}
                      >
                        {chipInner}
                      </button>
                    ) : (
                      <span key={dev.id} className={chipCls} title={`${dev.name} · ${t(STATUS_KEY[dev.status])}`}>
                        {chipInner}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

function CenterOverview({
  factoryNode, factoryId, t, onDeviceOpen,
}: {
  factoryNode: HierarchyNode | null;
  factoryId: number | null;
  t: ReturnType<typeof useTranslation>["t"];
  /** doc 68 §3.1 [P1] — mở ContextDrawer chi tiết thiết bị (khối twin / chip 2D). */
  onDeviceOpen?: (d: DrawerDevice) => void;
}) {
  // ★ Đợt 61: `selectedDeviceId`/`webglOk`/`viewMode` đã bỏ cùng cảnh 3D. Khoá
  //   localStorage `commandCenter:viewMode` KHÔNG còn được đọc/ghi — người dùng
  //   nào còn giá trị cũ trong trình duyệt cũng không đổi gì (không ai tra nữa).

  // W6 (doc 67, việc 4): 10s → 30s — sceneGraph trả mảng mới mỗi lần fetch nên
  // mỗi chu kỳ là 1 lần re-render toàn scene; 30s đủ tươi cho sơ đồ tổng quan.
  const sceneQ = trpc.twin.sceneGraph.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId != null, refetchInterval: 30_000, staleTime: 5_000 },
  );
  const devices = useMemo<TwinDevice[]>(() => sceneQ.data?.devices ?? [], [sceneQ.data]);

  // doc 68 §3.1 [P1] — chuẩn hoá → DrawerDevice rồi báo lên trang mở ContextDrawer.
  // ★ Đợt 61: `openTwinDevice` (lối bấm TỪ KHỐI 3D) đã bỏ cùng cảnh. Chip 2D
  //   (HierarchyNode) vẫn được làm giàu bằng cách tra TwinDevice cùng refId
  //   trong scene — đó là lý do `sceneQ` ở trên PHẢI ở lại.
  const openGridDevice = useCallback((dev: HierarchyNode) => {
    if (typeof dev.refId !== "number" || (dev.kind !== "machine" && dev.kind !== "robot")) return;
    const twin = devices.find((d) => d.refId === dev.refId && d.kind === dev.kind) ?? null;
    onDeviceOpen?.({
      refId: dev.refId, kind: dev.kind, name: dev.name, code: dev.code,
      state: twin?.state ?? null, activeTaskId: twin?.activeTaskId ?? null, status: dev.status,
    });
  }, [devices, onDeviceOpen]);

  // ★ Đợt 61: thăm dò WebGL (`getContext("webgl")`), `canRender3D`, `stateSummary`
  //   và `sceneAriaLabel` đã bỏ — cả bốn chỉ tồn tại để phục vụ `<Canvas>`.

  return (
    <SectionCard
      icon={<Factory className="h-4 w-4" />}
      title={
        factoryNode
          ? t("commandCenter.nhaMayThietBi", { name: factoryNode.name, count: devices.length })
          : t("cmd.selectFactory", "Select a factory")
      }
      action={
        <div className="flex items-center gap-2">
          {/* ★ Đợt 61: bộ chuyển 2D/3D đã bỏ — chỉ còn MỘT đường hiển thị (lưới
              trạng thái trực tiếp), nên một nút chọn giữa một lựa chọn là nhiễu. */}
          {/* AUD-01 (doc 65 W2) + W6 (việc 4): tuổi dữ liệu scene — poll 30s, amber khi >2× chu kỳ.
              doc 68 §3.1 [P2]: BỎ nút "Làm mới" trùng (đã có 1 ở header trang) — chỉ giữ
              1 chấm freshness/pane; scene tự poll 30s + nút header trang làm mới toàn cục. */}
          {factoryId != null && (
            <PollFreshness
              updatedAt={sceneQ.dataUpdatedAt || undefined}
              isFetching={sceneQ.isFetching}
              staleAfterMs={60_000}
            />
          )}
        </div>
      }
    >
      {factoryId == null ? (
        <div className={cn("flex items-center justify-center text-sm text-muted-foreground", PANE_BODY_H)}>
          {t("cmd.pickFactoryHint", "Select a site or factory in the tree to view its live floor.")}
        </div>
      ) : sceneQ.isLoading ? (
        <div className={cn("flex items-center justify-center text-sm text-muted-foreground", PANE_BODY_H)}>
          {t("cmd.loadingScene", "Loading factory scene…")}
        </div>
      ) : devices.length > 0 ? (
        /* ★ Đợt 61: đường DUY NHẤT — lưới trạng thái trực tiếp (line→station→device).
           Trước đây đây là nhánh "2D chủ động" và đã là MẶC ĐỊNH trên panel-PC
           (bề rộng ≤1366px), nên nó là đường ĐÃ ĐƯỢC DÙNG THẬT, không phải nhánh dự
           phòng chưa ai chạy. `<Canvas>` KHÔNG còn được mount ở màn này ⇒ __soCanvas = 0. */
        <StatusGridFallback factory={factoryNode} t={t} onDeviceOpen={openGridDevice} />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-[11px] text-info">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {t("cmd.gridEmptyScene", "No devices placed in this factory's scene — showing the live status grid.")}
          </div>
          <StatusGridFallback factory={factoryNode} t={t} onDeviceOpen={openGridDevice} />
        </>
      )}
    </SectionCard>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PAGE
// ════════════════════════════════════════════════════════════════════════════

export default function CommandCenter() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // ── status (live-vs-poll) ──
  const statusQ = trpc.commandCenter.status.useQuery(undefined, { refetchInterval: 30_000 });
  const mode = statusQ.data?.mode ?? "polling";
  const isLive = mode === "live";

  // ── hierarchy (polled every 10s for roll-up freshness) ──
  const hierarchyQ = trpc.commandCenter.hierarchy.useQuery(
    {},
    { refetchInterval: 10_000, staleTime: 5_000 },
  );
  const sites = useMemo<HierarchyNode[]>(() => hierarchyQ.data?.sites ?? [], [hierarchyQ.data]);

  // ── KPI summary (polled every 15s) ──
  const kpiQ = trpc.commandCenter.kpiSummary.useQuery({}, { refetchInterval: 15_000, staleTime: 5_000 });
  const kpi = kpiQ.data as (KpiSummary | undefined);

  // ── selection + expansion ──
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // doc 68 §3.1 [P1] — ContextDrawer chi tiết thiết bị: state ở TRANG để cả khối
  // twin, chip 2D và lá cây đều mở CÙNG 1 drawer (fly-out phải), giữ dải cảnh báo
  // cột 3 nguyên vẹn phía sau (đây là BỔ SUNG, không thay dải cảnh báo).
  const [drawerDevice, setDrawerDevice] = useState<DrawerDevice | null>(null);
  const openDeviceDrawer = useCallback((d: DrawerDevice) => setDrawerDevice(d), []);
  // Adapter lá cây (HierarchyNode) → DrawerDevice (chỉ mở cho lá máy/robot có refId số).
  const openTreeDevice = useCallback((node: HierarchyNode) => {
    if (typeof node.refId !== "number" || (node.kind !== "machine" && node.kind !== "robot")) return;
    setDrawerDevice({ refId: node.refId, kind: node.kind, name: node.name, code: node.code, status: node.status });
  }, []);

  // ── doc67 W8 [P2] — TREE SEARCH: ô tìm kiếm (debounce 200ms) + toggle
  // "chỉ node có cảnh báo". Cây hiển thị = bản lọc; expand của người dùng GIỮ
  // NGUYÊN (auto-expand chỉ cộng thêm khi bộ lọc đang bật, không ghi đè state). ──
  const [treeSearch, setTreeSearch] = useState("");
  const [treeSearchDebounced, setTreeSearchDebounced] = useState("");
  const [alarmOnlyFilter, setAlarmOnlyFilter] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setTreeSearchDebounced(treeSearch.trim().toLowerCase()), 200);
    return () => clearTimeout(id);
  }, [treeSearch]);
  const treeFilterActive = treeSearchDebounced !== "" || alarmOnlyFilter;
  const visibleSites = useMemo<HierarchyNode[]>(
    () => (treeFilterActive ? filterHierarchy(sites, treeSearchDebounced, alarmOnlyFilter) : sites),
    [sites, treeFilterActive, treeSearchDebounced, alarmOnlyFilter],
  );
  // Tự expand nhánh CHỨA kết quả (ancestor của match); KHÔNG tự mở toàn bộ cây
  // con dưới một node đã khớp text (tránh bung ồ ạt khi khớp tên factory).
  const autoExpanded = useMemo<Set<string> | null>(() => {
    if (!treeFilterActive) return null;
    const ids = new Set<string>();
    const q = treeSearchDebounced;
    const walk = (n: HierarchyNode, underMatch: boolean) => {
      if (!n.children?.length) return;
      if (!underMatch) ids.add(n.id);
      const selfMatch = q !== "" && (n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q));
      n.children.forEach((c) => walk(c, underMatch || selfMatch));
    };
    visibleSites.forEach((s) => walk(s, false));
    return ids;
  }, [treeFilterActive, treeSearchDebounced, visibleSites]);
  const effectiveExpanded = useMemo<Set<string>>(
    () => (autoExpanded ? new Set([...expanded, ...autoExpanded]) : expanded),
    [expanded, autoExpanded],
  );

  // ── doc67 W8 [P2] — RAIL FILTER: chip mức độ (Tất cả / Nghiêm trọng / Cao). ──
  const [railSeverity, setRailSeverity] = useState<"all" | "critical" | "high">("all");

  // Auto-expand the first site + its first factory once loaded (once).
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || sites.length === 0) return;
    const next = new Set<string>();
    const firstSite = sites[0];
    next.add(firstSite.id);
    const firstFactory = firstSite.children?.[0];
    if (firstFactory) next.add(firstFactory.id);
    setExpanded(next);
    setSelectedId(firstFactory?.id ?? firstSite.id);
    didInit.current = true;
  }, [sites]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const selectedNode = useMemo(() => (selectedId ? findNode(sites, selectedId) : null), [sites, selectedId]);

  // Resolve the factory + factory-scope for the center pane + rail filter.
  const { centerFactoryId, centerFactoryNode, scopeFilter } = useMemo(() => {
    if (!selectedNode) return { centerFactoryId: null, centerFactoryNode: null, scopeFilter: null as ReturnType<typeof collectScope> | null };
    // Find the factory node that contains the selection (self, ancestor, or first descendant).
    let facNode: HierarchyNode | null = null;
    if (selectedNode.kind === "factory") {
      facNode = selectedNode;
    } else {
      // ancestor search
      const findFactoryAncestor = (): HierarchyNode | null => {
        let found: HierarchyNode | null = null;
        const walk = (n: HierarchyNode, chain: HierarchyNode[]) => {
          if (found) return;
          if (n.id === selectedNode.id) {
            for (let i = chain.length - 1; i >= 0; i--) if (chain[i].kind === "factory") { found = chain[i]; return; }
            return;
          }
          n.children?.forEach((c) => walk(c, [...chain, n]));
        };
        sites.forEach((s) => walk(s, []));
        return found;
      };
      facNode = findFactoryAncestor();
      // If the selection is a site with factory children, use its first factory.
      if (!facNode && selectedNode.kind === "site") facNode = selectedNode.children?.find((c) => c.kind === "factory") ?? null;
    }
    const facId = facNode ? factoryIdForSelection(facNode) : null;
    return { centerFactoryId: facId, centerFactoryNode: facNode, scopeFilter: collectScope(selectedNode) };
  }, [selectedNode, sites]);

  // ── ALARM RAIL: seed + live merge ──
  const alertsQ = trpc.commandCenter.recentAlerts.useQuery(
    { limit: 60 },
    { refetchInterval: isLive ? false : 15_000, staleTime: 5_000 }, // poll fallback only when not live
  );
  const seeds = useMemo<SeedAlert[]>(() => alertsQ.data?.alerts ?? [], [alertsQ.data]);

  // Live stream (U1). alertsOnly → filtered `alerts:stream`. Only meaningful when live.
  const { events: liveEvents } = useEcosystemEvents({ alertsOnly: true, enabled: isLive, bufferSize: 100 });

  // Merge seed + live, dedupe by id, newest first, cap 100.
  const alarms = useMemo<AlarmRow[]>(() => {
    const byId = new Map<string, AlarmRow>();
    // seeds first (older), then live (overwrites/wins on id collision)
    for (const s of seeds) byId.set(s.id, s as AlarmRow);
    for (const e of liveEvents) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.ts - a.ts).slice(0, 100);
  }, [seeds, liveEvents]);

  // Filter the rail to the selected scope (when a scoped node is chosen).
  const scopedAlarms = useMemo<AlarmRow[]>(() => {
    if (!scopeFilter || !selectedNode || selectedNode.kind === "site") return alarms;
    const { factoryIds, machineIds, robotIds, lineIds } = scopeFilter;
    return alarms.filter((a) => {
      const sc = a.scope ?? {};
      if (sc.machineId != null && machineIds.has(sc.machineId)) return true;
      if (sc.robotId != null && robotIds.has(sc.robotId)) return true;
      if (sc.lineId != null && lineIds.has(sc.lineId)) return true;
      if (sc.factoryId != null && factoryIds.has(sc.factoryId)) return true;
      // If the alarm carries no matching scope key at all, keep it visible only when
      // the selection is factory-or-wider (avoid hiding unscoped alarms on a machine).
      const hasAnyScope = sc.machineId != null || sc.robotId != null || sc.lineId != null || sc.factoryId != null;
      if (!hasAnyScope) return selectedNode.kind === "factory";
      return false;
    });
  }, [alarms, scopeFilter, selectedNode]);

  // doc67 W8 [P2] — RAIL FILTER: áp chip mức độ lên danh sách đã scope, rồi tách
  // nhóm "Hôm nay" (≤24h) vs "Tồn đọng" (>24h, dựa ageMs = now − a.ts; `now`
  // tick 15s sẵn có). Cảnh báo tồn đọng mang badge "tồn đọng Nd" tone warning.
  const railAlarms = useMemo<AlarmRow[]>(
    () => (railSeverity === "all" ? scopedAlarms : scopedAlarms.filter((a) => a.severity === railSeverity)),
    [scopedAlarms, railSeverity],
  );
  const todayRailAlarms = useMemo<AlarmRow[]>(() => railAlarms.filter((a) => now - a.ts <= DAY_MS), [railAlarms, now]);
  const backlogRailAlarms = useMemo<AlarmRow[]>(() => railAlarms.filter((a) => now - a.ts > DAY_MS), [railAlarms, now]);

  // doc 68 §3.1 [P1] — cảnh báo/lịch sử của RIÊNG thiết bị đang mở drawer, lọc từ
  // danh sách hợp nhất `alarms` theo scope.machineId/robotId (khớp kind + refId).
  const drawerDeviceAlarms = useMemo<AlarmRow[]>(() => {
    if (!drawerDevice) return [];
    return alarms.filter((a) => {
      const sc = a.scope ?? {};
      return drawerDevice.kind === "machine"
        ? sc.machineId === drawerDevice.refId
        : sc.robotId === drawerDevice.refId;
    });
  }, [alarms, drawerDevice]);
  // "Đang mở" = mức nghiêm trọng/cao (cần chú ý); phần còn lại rơi vào lịch sử.
  const drawerOpenAlarms = useMemo<AlarmRow[]>(
    () => drawerDeviceAlarms.filter((a) => a.severity === "critical" || a.severity === "high"),
    [drawerDeviceAlarms],
  );
  // Nhãn trạng thái drawer: ưu tiên state PackML (twin); fallback status roll-up (cây).
  const drawerStateLabel = drawerDevice
    ? drawerDevice.state
      ? t(twinStateCategoryKey(drawerDevice.state))
      : drawerDevice.status
        ? t(STATUS_KEY[drawerDevice.status])
        : t("cmdCenter.status.unknown")
    : "";

  // Cockpit = CTA bước-2 trong drawer (thay điều-hướng-ngay cũ ở nút cây). U3 routes.
  const openCockpitDevice = useCallback((d: DrawerDevice) => {
    if (d.kind === "robot") setLocation(`/robot/${d.refId}`);
    else setLocation(`/machine/${d.refId}`);
  }, [setLocation]);

  const openAlarm = useCallback((a: AlarmRow) => {
    const sc = a.scope ?? {};
    if (sc.robotId != null) setLocation(`/robot/${sc.robotId}`);
    else if (sc.machineId != null) setLocation(`/machine/${sc.machineId}`);
    else if (a.kind === "andon") setLocation("/ops-console");
    else if (a.kind === "safety") setLocation("/safety-workforce");
  }, [setLocation]);

  // doc67 W8 — thẻ cảnh báo rail (tách từ inline map cũ để dùng cho cả 2 nhóm
  // Hôm nay / Tồn đọng); backlog=true thêm badge "tồn đọng Nd" tone warning.
  const renderAlarmRow = (a: AlarmRow, backlog: boolean) => {
    const clickable = a.scope?.machineId != null || a.scope?.robotId != null || a.kind === "andon" || a.kind === "safety";
    const backlogDays = Math.max(1, Math.floor((now - a.ts) / DAY_MS));
    // W4 (doc 67): nhãn severity/kind tiếng Việt (SEVERITY_KEY/KIND_KEY).
    // doc 68 §3.1 [P1]: thẻ COMPACT 2 dòng — dòng 1 mức độ/loại/tồn-đọng/thời gian,
    // dòng 2 tiêu đề (truncate) + tham chiếu máy/robot inline (bỏ dòng nguồn riêng;
    // "loại" đã ở badge dòng 1) để dải cảnh báo gọn hơn.
    const inner = (
      <>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={a.severity} label={t(SEVERITY_KEY[a.severity])} tone={severityTone(a.severity)} className="px-1 py-0 text-[10px]" />
          <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">{KIND_KEY[a.kind] ? t(KIND_KEY[a.kind]) : a.kind}</Badge>
          {backlog && (
            <Badge className="border-warning/40 bg-warning/15 px-1 py-0 text-[10px] font-medium text-warning" variant="outline">
              tồn đọng {backlogDays}d
            </Badge>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">{relTimeShort(a.ts, now)}</span>
        </div>
        <div className="mt-1 flex items-center gap-1">
          <span className="min-w-0 flex-1 truncate font-medium leading-snug" title={a.title}>{a.title}</span>
          {a.scope?.machineId != null && <span className="shrink-0 text-[10px] text-muted-foreground">Máy #{a.scope.machineId}</span>}
          {a.scope?.robotId != null && <span className="shrink-0 text-[10px] text-muted-foreground">Robot #{a.scope.robotId}</span>}
          {clickable && <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </div>
      </>
    );
    // W4 (doc 67): thẻ điều hướng được là <button> full-width thật
    // (bàn phím Tab/Enter + focus-visible ring); thẻ chỉ-đọc giữ <div>.
    return clickable ? (
      <button
        key={a.id}
        type="button"
        className="block w-full rounded-md border px-2 py-1.5 text-left text-xs cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => openAlarm(a)}
      >
        {inner}
      </button>
    ) : (
      <div key={a.id} className="rounded-md border px-2 py-1.5 text-xs">
        {inner}
      </div>
    );
  };

  // ── KPI display helpers (honest "—" on available:false) ──
  const fmtNum = (v: number | null | undefined) => (v == null ? "—" : String(v));
  const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

  const oeeVal = kpi?.oee.available ? fmtPct(kpi.oee.value?.oee ?? null) : "—";
  const wipVal = kpi?.wip.available ? fmtNum(kpi.wip.value?.count) : "—";
  const alarmsCrit = kpi?.alarms.available ? (kpi.alarms.value?.critical ?? 0) : null;
  const alarmsHigh = kpi?.alarms.available ? (kpi.alarms.value?.high ?? 0) : null;
  const energyVal = kpi?.energy.available ? fmtNum(kpi.energy.value?.kwh) : "—";
  const aiVal = kpi?.aiInsights.available ? fmtNum(kpi.aiInsights.value?.count) : "—";
  const fleetRobots = kpi?.fleet.available ? (kpi.fleet.value?.robotsOnline ?? 0) : null;
  const fleetTasks = kpi?.fleet.available ? ((kpi.fleet.value?.tasksPending ?? 0) + (kpi.fleet.value?.tasksRunning ?? 0)) : null;
  const sitesReporting = kpi?.sites.available ? (kpi.sites.value?.reporting ?? 0) : null;
  const sitesTotal = kpi?.sites.available ? (kpi.sites.value?.total ?? 0) : null;
  const sitesStale = kpi?.sites.available ? (kpi.sites.value?.stale ?? 0) : 0;
  const sitesDown = kpi?.sites.available ? (kpi.sites.value?.down ?? 0) : 0;

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        {/* ── Header + live/poll badge ── */}
        <PageHeader
          icon={<Gauge className="h-6 w-6" />}
          // doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.commandCenter.
          title={t("nav.commandCenter", "Layout & Digital Twin")}
          description={t("cmd.subtitle", "One live pane: hierarchy, factory twin, KPIs and the unified alarm rail across the whole estate.")}
          actions={
            <div className="flex items-center gap-2">
              {/* AUD-01 (doc 65 W2): badge PHẠM VI SỰ KIỆN — không được đọc như trạng thái
                  kết nối toàn cục (header shell đã có đèn socket "Trực tiếp" riêng).
                  Khi cờ ECOSYSTEM_EVENTS tắt → mode="polling": nói rõ chỉ luồng sự kiện
                  là định kỳ, KHÔNG dùng icon WifiOff (gây hiểu lầm mất kết nối). */}
              {isLive ? (
                /* GĐ2 (việc 3): emerald/amber hardcode → token success/warning
                   (tự lật light/dark, đồng bộ DS). */
                <Badge
                  className="gap-1 bg-success text-success-foreground"
                  title={t("commandCenter.luongSuKienHeSinh", "Luồng sự kiện hệ sinh thái đang phát trực tiếp qua socket")}
                >
                  <Radio className="h-3.5 w-3.5" /> Sự kiện: trực tiếp
                </Badge>
              ) : (
                <Badge
                  className="gap-1 bg-warning text-warning-foreground"
                  title={t("commandCenter.ketNoiMayChuVan", "Kết nối máy chủ vẫn trực tiếp — luồng sự kiện realtime chưa bật (cờ ECOSYSTEM_EVENTS)")}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Sự kiện hệ sinh thái: định kỳ 15s
                </Badge>
              )}
              <Button size="sm" variant="outline" onClick={() => { hierarchyQ.refetch(); kpiQ.refetch(); alertsQ.refetch(); }}>
                <RefreshCw className={cn("mr-1 h-4 w-4", (hierarchyQ.isFetching || kpiQ.isFetching) && "animate-spin")} />
                {t("cmd.refreshAll", "Refresh")}
              </Button>
            </div>
          }
        />

        {/* doc 67 W5 (việc 6) — trang đã rút khỏi menu: rail 2-chiều từ map tập trung
            là đường quay về Tổng quan nhà máy + các màn anh em. */}
        <RelatedViews pageId="command-center" />

        {/* ── TOP KPI STRIP ── */}
        {/* AUD-01 (doc 65 W2): tuổi dữ liệu KPI — poll 15s, cảnh báo khi stale >2× chu kỳ. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            Chỉ số toàn hệ sinh thái
          </span>
          <PollFreshness
            updatedAt={kpiQ.dataUpdatedAt || undefined}
            isFetching={kpiQ.isFetching}
            staleAfterMs={30_000}
          />
        </div>
        {/* W4 (doc 67) + doc 68 §3.1 [P2] — responsive 1280: xl=4 cột (hết cắt cụt
            nhãn ở panel-PC), 2xl=7 cột; MetricCard size="compact" (ribbon mỏng).
            2 chỉ số CHƯA-tổng-hợp-toàn-hệ (OEE + Năng lượng) gộp 1 ô muted CUỐI
            strip thay vì 2 ô "—" rời đầu/cuối. Nhãn rút gọn + title tooltip đầy đủ. */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-7">
          <div title={t("commandCenter.soDonViWipDang", "Số đơn vị WIP đang trên chuyền")}>
            <MetricCard
              icon={<Boxes className="h-4 w-4" />}
              label="WIP"
              value={wipVal}
              size="compact"
              delta={kpi?.wip.value?.bottleneck ? t("commandCenter.nutCoChai", { name: kpi.wip.value.bottleneck }) : undefined}
            />
          </div>
          <div title={t("commandCenter.canhBaoNghiemTrongCao", "Cảnh báo nghiêm trọng / cao đang hoạt động")}>
            <MetricCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label={t("commandCenter.canhBao", "Cảnh báo")}
              value={alarmsCrit == null ? "—" : `${alarmsCrit} / ${alarmsHigh}`}
              size="compact"
              tone={alarmsCrit ? "error" : "default"}
            />
          </div>
          <div title={t("commandCenter.nhiemVuDoiRobotCho", "Nhiệm vụ đội robot (chờ + đang chạy) / robot trực tuyến")}>
            <MetricCard
              icon={<Bot className="h-4 w-4" />}
              label={t("commandCenter.nhiemVu", "Nhiệm vụ")}
              value={fleetTasks == null ? "—" : `${fleetTasks} / ${fleetRobots}`}
              size="compact"
            />
          </div>
          <div title={t("commandCenter.soSiteDangBaoCao", "Số site đang báo cáo / tổng số site")}>
            <MetricCard
              icon={<Network className="h-4 w-4" />}
              label="Site"
              value={sitesReporting == null ? "—" : `${sitesReporting} / ${sitesTotal}`}
              size="compact"
              delta={sitesStale + sitesDown > 0 ? t("commandCenter.siteTreMat", { stale: sitesStale, down: sitesDown }) : undefined}
              tone={sitesDown > 0 ? "error" : sitesStale > 0 ? "warning" : "default"}
            />
          </div>
          <div title={t("commandCenter.soGoiYAiDang", "Số gợi ý AI đang hoạt động")}>
            <MetricCard
              icon={<Sparkles className="h-4 w-4" />}
              label={t("commandCenter.goiYAi", "Gợi ý AI")}
              value={aiVal}
              size="compact"
            />
          </div>
          {/* doc 68 §3.1 [P2] — ô GỘP muted: OEE trung bình + Năng lượng (cả hai
              chưa có tổng hợp toàn hệ → "—"); trung thực độ phủ dữ liệu, không bịa. */}
          <div
            className="sm:col-span-2"
            title={t("commandCenter.oeeTrungBinhToanHe", "OEE trung bình toàn hệ (%) · Năng lượng toàn nhà máy (kWh) — chưa có tổng hợp toàn hệ sinh thái")}
          >
            <MetricCard
              icon={<Zap className="h-4 w-4" />}
              label={t("commandCenter.oeeNangLuongToanHe", "OEE · Năng lượng (toàn hệ)")}
              value={`${oeeVal} · ${energyVal}`}
              size="compact"
              delta={
                kpi?.oee.sourceLabel && kpi?.oee.available
                  ? t("commandCenter.oeeSnapshot", { source: kpi.oee.sourceLabel })
                  : t("commandCenter.chuaTongHopToanHe", "Chưa tổng hợp toàn hệ")
              }
              tone={kpi?.oee.value?.oee != null && kpi.oee.value.oee < 60 ? "warning" : "default"}
            />
          </div>
        </div>

        {/* ── 3-PANE: tree · overview · rail ── */}
        {/* doc 68 §3.1 [P1]: tỷ lệ ~2.5/7/2.5 (thay 3/6/3) — cả 2 cột bên hẹp lại,
            twin GIỮA nới rộng, VẪN GIỮ 3 CỘT. min-w-0 từng cột để nội dung truncate. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2.5fr_7fr_2.5fr]">
          {/* LEFT — hierarchy tree */}
          <div className="min-w-0">
            <SectionCard
              icon={<ServerCog className="h-4 w-4" />}
              // doc 68 §3.1 [P1]: header 1 dòng "Cây phân cấp" (thay "Cây phân cấp hệ
              // sinh thái" wrap 3 dòng); mô tả đường phân cấp đưa vào tooltip title.
              title={<span title={t("commandCenter.cayPhanCapTooltip", "Site → nhà máy → chuyền → trạm → máy / robot")}>{t("commandCenter.cayPhanCap", "Cây phân cấp")}</span>}
              action={
                /* AUD-01 (doc 65 W2): tuổi dữ liệu cây — poll 10s, amber khi >2× chu kỳ. */
                <PollFreshness
                  updatedAt={hierarchyQ.dataUpdatedAt || undefined}
                  isFetching={hierarchyQ.isFetching}
                  staleAfterMs={20_000}
                />
              }
              contentClassName="p-2"
            >
              {hierarchyQ.isLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t("cmd.loadingTree", "Loading hierarchy…")}</div>
              ) : sites.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">{t("cmd.noSites", "No sites reporting yet.")}</div>
              ) : (
                <>
                  {/* doc67 W8 [P2] — TREE SEARCH: ô lọc (debounce 200ms) + toggle
                      "chỉ node có cảnh báo"; tự expand nhánh chứa kết quả +
                      highlight đoạn khớp. Giữ nguyên role="tree" ARIA W4. */}
                  <div className="mb-2 space-y-1.5 px-1">
                    <Input
                      value={treeSearch}
                      onChange={(e) => setTreeSearch(e.target.value)}
                      placeholder={t("commandCenter.timTheoTenMaNode", "Tìm theo tên / mã node…")}
                      aria-label={t("commandCenter.timKiemNodeTrongCay", "Tìm kiếm node trong cây phân cấp")}
                      className="h-8 text-sm"
                    />
                    <button
                      type="button"
                      aria-pressed={alarmOnlyFilter}
                      onClick={() => setAlarmOnlyFilter((v) => !v)}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        alarmOnlyFilter
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : "border-border text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      Chỉ node có cảnh báo
                    </button>
                  </div>
                  {visibleSites.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Không có node khớp bộ lọc.
                    </div>
                  ) : (
                    <ScrollArea className={cn("pr-1", PANE_BODY_H)}>
                      {/* W4 (doc 67): role="tree" cho cây WAI-ARIA (treeitem/group bên trong). */}
                      <div role="tree" aria-label={t("commandCenter.cayPhanCapHeSinh", "Cây phân cấp hệ sinh thái")}>
                      {visibleSites.map((site) => (
                        <TreeNode
                          key={site.id}
                          node={site}
                          depth={0}
                          expanded={effectiveExpanded}
                          onToggle={toggle}
                          selectedId={selectedId}
                          onSelect={setSelectedId}
                          onOpenDevice={openTreeDevice}
                          t={t}
                          highlight={treeSearchDebounced}
                        />
                      ))}
                      </div>
                    </ScrollArea>
                  )}
                </>
              )}
            </SectionCard>
          </div>

          {/* CENTER — factory twin / status grid */}
          <div className="min-w-0">
            <CenterOverview factoryNode={centerFactoryNode} factoryId={centerFactoryId} t={t} onDeviceOpen={openDeviceDrawer} />
          </div>

          {/* RIGHT — unified alarm rail */}
          <div className="min-w-0">
            <SectionCard
              icon={<Radio className="h-4 w-4" />}
              title={t("cmd.alarmRail", "Alarm rail")}
              description={
                selectedNode && selectedNode.kind !== "site"
                  ? t("cmd.railScoped", "Scoped to {{name}}", { name: selectedNode.name })
                  : (isLive ? t("cmd.railLive", "Live · unified alert stream") : t("cmd.railPoll", "Polling · seed + 15s refresh"))
              }
              action={
                /* AUD-01 (doc 65 W2): tuổi dữ liệu rail khi ở chế độ poll 15s. Khi live,
                   rail được socket đẩy trực tiếp và alertsQ ngừng poll → badge poll-age
                   sẽ báo amber sai, nên chỉ hiện ở chế độ định kỳ. */
                isLive ? undefined : (
                  <PollFreshness
                    updatedAt={alertsQ.dataUpdatedAt || undefined}
                    isFetching={alertsQ.isFetching}
                    staleAfterMs={30_000}
                  />
                )
              }
              contentClassName="p-2"
            >
              {/* doc67 W8 [P2] — hàng chip lọc mức độ (luôn hiện để bỏ lọc được
                  cả khi danh sách lọc ra rỗng). */}
              <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1" role="group" aria-label={t("commandCenter.locMucDoCanhBao", "Lọc mức độ cảnh báo")}>
                {([["all", "cmdCenter.filterAll"], ["critical", "cmdCenter.severity.critical"], ["high", "cmdCenter.severity.high"]] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={railSeverity === v}
                    onClick={() => setRailSeverity(v)}
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      railSeverity === v
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/60",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {scopedAlarms.length === 0 ? (
                alarms.length === 0 ? (
                  /* GĐ2 (việc 4): rỗng = TIN TỐT → EmptyState allClear DS (icon
                     check success) thay div tự chế; nhánh "ngoài phạm vi chọn"
                     là trạng thái lọc, giữ dòng trung tính.
                     ★★★ 2026-08-18 (nhóm B #5): "rỗng = TIN TỐT" chỉ ĐÚNG khi phạm vi
                     người xem KHÔNG rỗng. `recentAlerts` nay lọc theo nhà máy được gán,
                     nên một tài khoản 0-gán nhận 0 dòng — và câu "Không có cảnh báo đang
                     hoạt động" kèm icon check XANH nói với người vận hành rằng xưởng đang
                     yên ổn. Đó là lời khai SAI VỀ THẾ GIỚI ở đúng chỗ nguy hiểm nhất. */
                  isScopeEmpty(alertsQ.data?.scopeEmptyReason) ? (
                    <EmptyState
                      compact
                      title={t("common.scopeEmpty.title")}
                      description={alertsQ.data?.scopeMessage ?? t("common.scopeEmpty.hint")}
                    />
                  ) : (
                    <EmptyState allClear compact title={t("commandCenter.khongCoCanhBaoDang", "Không có cảnh báo đang hoạt động")} />
                  )
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t("cmd.noScopedAlarms", "No alarms in the selected scope.")}
                  </div>
                )
              ) : railAlarms.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Không có cảnh báo ở mức đã lọc.
                </div>
              ) : (
                <ScrollArea className={cn("pr-1", PANE_BODY_H)}>
                  <div className="space-y-1.5">
                    {/* doc67 W8 [P2] — separator nhóm "Hôm nay" vs "Tồn đọng" (>24h). */}
                    {todayRailAlarms.length > 0 && (
                      <div className="px-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Hôm nay ({todayRailAlarms.length})
                      </div>
                    )}
                    {todayRailAlarms.map((a) => renderAlarmRow(a, false))}
                    {backlogRailAlarms.length > 0 && (
                      <div className="border-t px-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                        Tồn đọng &gt;24h ({backlogRailAlarms.length})
                      </div>
                    )}
                    {backlogRailAlarms.map((a) => renderAlarmRow(a, true))}
                  </div>
                </ScrollArea>
              )}
            </SectionCard>
          </div>
        </div>

        {/* doc 68 §3.1 [P1] — ContextDrawer chi tiết thiết bị (fly-out phải, primitive
            workspace/ContextDrawer). Mở từ khối twin / chip 2D / lá cây; dải cảnh báo
            cột 3 GIỮ NGUYÊN phía sau (đây là BỔ SUNG, không thay dải). */}
        <ContextDrawer
          open={drawerDevice != null}
          onOpenChange={(o) => { if (!o) setDrawerDevice(null); }}
          title={drawerDevice?.name ?? ""}
          description={
            drawerDevice
              ? t("commandCenter.thietBiMa", { kind: drawerDevice.kind === "robot" ? t("commandCenter.robot", "Robot") : t("commandCenter.may", "Máy"), code: drawerDevice.code })
              : undefined
          }
        >
          {drawerDevice && (
            <div className="space-y-4">
              {/* Trạng thái + CTA cockpit (bước-2) */}
              <div className="flex items-center justify-between gap-2">
                <StatusBadge
                  status={drawerDevice.state ?? drawerDevice.status ?? "unknown"}
                  label={drawerStateLabel}
                />
                <Button size="sm" onClick={() => openCockpitDevice(drawerDevice)}>
                  Mở cockpit đầy đủ
                  <ExternalLink className="ml-1 h-4 w-4" />
                </Button>
              </div>

              {/* KPI máy: trạng thái / OEE / nhiệm vụ (compact). OEE per-máy chưa
                  có trong scene-graph → "—" trung thực (không bịa số). */}
              <div className="grid grid-cols-3 gap-2">
                <MetricCard
                  size="compact"
                  icon={<Activity className="h-4 w-4" />}
                  label={t("commandCenter.trangThai", "Trạng thái")}
                  value={drawerStateLabel}
                />
                <MetricCard
                  size="compact"
                  icon={<Gauge className="h-4 w-4" />}
                  label={t("commandCenter.oeeMay", "OEE máy")}
                  value="—"
                />
                <MetricCard
                  size="compact"
                  icon={<ListChecks className="h-4 w-4" />}
                  label={t("commandCenter.nhiemVu2", "Nhiệm vụ")}
                  value={drawerDevice.activeTaskId != null ? `#${drawerDevice.activeTaskId}` : "—"}
                />
              </div>

              {/* Cảnh báo đang mở của RIÊNG máy (lọc từ danh sách hợp nhất theo scope). */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Cảnh báo đang mở ({drawerOpenAlarms.length})
                </div>
                {drawerOpenAlarms.length === 0 ? (
                  <EmptyState allClear compact title={t("commandCenter.khongCoCanhBaoNghiem", "Không có cảnh báo nghiêm trọng/cao")} />
                ) : (
                  <div className="space-y-1.5">
                    {drawerOpenAlarms.map((a) => renderAlarmRow(a, now - a.ts > DAY_MS))}
                  </div>
                )}
              </div>

              {/* Lịch sử gần đây của máy (tối đa 8 sự kiện mới nhất trong luồng cảnh báo). */}
              <div>
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  Lịch sử gần đây ({Math.min(drawerDeviceAlarms.length, 8)})
                </div>
                {drawerDeviceAlarms.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    Chưa có sự kiện nào cho thiết bị này trong luồng cảnh báo hiện tại.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {drawerDeviceAlarms.slice(0, 8).map((a) => renderAlarmRow(a, now - a.ts > DAY_MS))}
                  </div>
                )}
              </div>
            </div>
          )}
        </ContextDrawer>
      </div>
    </DashboardLayout>
  );
}
