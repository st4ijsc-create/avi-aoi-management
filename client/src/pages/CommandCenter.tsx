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
 *   CENTER · OVERVIEW — the selected factory's live twin. We embed a compact 3D scene
 *                        (own twin.sceneGraph query, reusing the twin's three.js
 *                        approach) with a STATUS-GRID fallback when the scene is empty
 *                        or WebGL is unavailable — pragmatic, never breaks the page.
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
import { Suspense, useEffect, useMemo, useRef, useState, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Canvas, invalidate, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Grid, Text } from "@react-three/drei";
import * as THREE from "three";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { MetricCard, PageHeader, StatusBadge, SectionCard, severityDotClass, stateHex, toneHex } from "@/components/patterns";
import { EmptyState } from "@/components/EmptyState";
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
// (patterns/isaStateBadges): stateHex()/toneHex() cho material three.js + legend
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
const STATUS_VI: Record<NodeStatus, string> = {
  ok: "Bình thường",
  warn: "Cảnh báo",
  down: "Dừng",
  idle: "Chờ",
  unknown: "Không rõ",
};

/** Mức độ cảnh báo trên rail. */
const SEVERITY_VI: Record<EcosystemSeverity, string> = {
  critical: "Nghiêm trọng",
  high: "Cao",
  medium: "Trung bình",
  low: "Thấp",
  info: "Thông tin",
};

/** Loại sự kiện (kind) trên rail. */
const KIND_VI: Record<string, string> = {
  inspection: "Kiểm tra",
  andon: "Andon",
  safety: "An toàn",
  spc: "SPC",
  quality_gate: "Cổng chất lượng",
  escalation: "Leo thang",
  maintenance: "Bảo trì",
  downtime: "Dừng máy",
  oee: "OEE",
  task: "Nhiệm vụ",
  workorder: "Lệnh SX",
  anomaly: "Bất thường",
  program: "Chương trình",
  twin: "Bản sao số",
  ng: "NG",
  yield: "Tỷ lệ đạt",
  event: "Sự kiện",
};

/** Nhóm trạng thái twin → nhãn tiếng Việt (đồng bộ với statusHexFromTwinState). */
function twinStateCategoryVi(state: string | null | undefined): string {
  switch ((state ?? "").toLowerCase()) {
    case "running": case "execute": case "active": return "Đang chạy";
    case "idle": return "Chờ";
    case "stopped": case "held": case "suspended": return "Tạm dừng";
    case "aborted": case "error": case "fault": case "estop": return "Lỗi/E-stop";
    case "offline": return "Ngoại tuyến";
    default: return "Không rõ";
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
  t: (k: string, f: string) => string;
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
            aria-label={isOpen ? "Thu gọn" : "Mở rộng"}
          >
            {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="-ml-1.5 w-10 shrink-0" />
        )}

        {/* status dot */}
        <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(node.status))} title={STATUS_VI[node.status]} />

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
              title="Xem chi tiết thiết bị"
              aria-label={`Xem chi tiết ${node.name}`}
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
// CENTER PANE — compact live 3D twin for the selected factory (own sceneGraph
// query), with a status-grid fallback when the scene is empty or WebGL is off.
// ════════════════════════════════════════════════════════════════════════════

const FLOOR_W = 34;
const FLOOR_D = 24;

function toScenePos(pos: { x: number; y: number; z?: number } | null, idx: number, n: number): [number, number, number] {
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    const norm = pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1;
    if (norm) return [(pos.x - 0.5) * FLOOR_W, 0.5, (pos.y - 0.5) * FLOOR_D];
    return [pos.x, typeof pos.z === "number" ? pos.z + 0.5 : 0.5, pos.y];
  }
  const cols = Math.max(1, Math.ceil(Math.sqrt(n || 1)));
  const c = idx % cols, r = Math.floor(idx / cols);
  return [-FLOOR_W / 2 + 1.5 + c * 3, 0.5, FLOOR_D / 2 + 2 + r * 3];
}

function TwinBlock({
  node, position, selected, onSelect,
}: {
  node: TwinDevice;
  position: [number, number, number];
  selected: boolean;
  onSelect: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isRobot = node.kind === "robot";
  const color = node.color || statusHexFromTwinState(node.state);
  // W6 (doc 67, việc 2+3): frameloop='demand' — bỏ useFrame-lerp (đứng hình ở
  // demand-mode) + bỏ cấp phát new THREE.Vector3 mỗi frame × N thiết bị; scale
  // đặt TRỰC TIẾP qua prop, đổi hover/selection thì invalidate() vẽ lại 1 frame.
  const scale = selected || hovered ? 1.12 : 1;
  useEffect(() => { invalidate(); }, [hovered, selected]);
  // W6 (việc 5): thiết bị KHÔNG-ok hiện nhãn mã máy thường trực (không chỉ hover).
  const st = (node.state ?? "").toLowerCase();
  const isOk = st === "running" || st === "execute" || st === "active";
  const stop = (e: ThreeEvent<PointerEvent | MouseEvent>) => e.stopPropagation();
  return (
    <group
      position={position}
      scale={scale}
      onClick={(e) => { stop(e); onSelect(); }}
      onPointerOver={(e) => { stop(e); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
    >
      <mesh castShadow>
        {isRobot ? <cylinderGeometry args={[0.4, 0.5, 1, 16]} /> : <boxGeometry args={[1.4, 0.9, 1.4]} />}
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.22} metalness={0.4} roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.9, 0]}>
        <sphereGeometry args={[0.12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} />
      </mesh>
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.48, 0]}>
          <ringGeometry args={[1, 1.25, 32]} />
          <meshBasicMaterial color="#06b6d4" side={THREE.DoubleSide} />
        </mesh>
      )}
      {(hovered || selected || !isOk) && (
        <Text position={[0, -0.7, 0.8]} fontSize={0.24} color="#fff" anchorX="center" anchorY="top" outlineWidth={0.01} outlineColor="#000">
          {node.code}
        </Text>
      )}
    </group>
  );
}

function CompactTwinScene({
  devices, selectedId, onSelect, onOpen,
}: {
  devices: TwinDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpen: (d: TwinDevice) => void;
}) {
  // doc 68 §3.1 [P1] — AUTO-FIT CAMERA: tính vị-trí-scene 1 lần rồi khung camera
  // theo hộp bao (bounding box) của 44 thiết bị → lấp đầy canvas, diệt lề đen trên/
  // dưới (nguyên nhân "mất cân đối" chính, không phải tỷ lệ pane). Trước đây camera
  // cố định [0,24.5,30.6] nhìn gốc toạ độ nên cụm máy lệch tâm & thu nhỏ giữa khung.
  const positions = useMemo<[number, number, number][]>(
    () => devices.map((d, i) => toScenePos(d.position, i, devices.length)),
    [devices],
  );
  const fit = useMemo(() => {
    const fov = 50;
    // doc 68 §3.1 [P1-fix] — CĂN KHUNG lại (phản hồi user "twin mất cân đối / nửa
    // dưới đen"): (a) góc DỐC hơn 52° thay vì 45° chếch-thấp → bớt sàn foreground
    // chiếm nửa dưới; (b) đệm auto-fit 1.08× (cũ 1.25×) + đặt magnitude camera ĐÚNG
    // = dist (cũ dist×0.82×√2 = 1.16×dist làm cụm nhỏ thêm) → cụm lấp ~70-80% khung.
    const PAD = 1.08;                     // đệm mép (giảm từ 1.25 → cụm to hơn)
    const ELEV = (52 * Math.PI) / 180;    // độ chếch xuống ~52° (dốc hơn 45° cũ)
    const sinE = Math.sin(ELEV), cosE = Math.cos(ELEV);
    if (positions.length === 0) {
      const d = Math.max(18, FLOOR_W * 0.9);
      return {
        center: [0, 0, 0] as [number, number, number],
        camPos: [0, d * sinE, d * cosE] as [number, number, number],
        floorW: FLOOR_W, floorD: FLOOR_D,
      };
    }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, , z] of positions) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const spanX = maxX - minX, spanZ = maxZ - minZ;
    // Bán kính hộp bao (nửa cạnh lớn nhất) + đệm 2.5u cho nhãn/khối máy.
    const radius = Math.max(spanX, spanZ, 6) / 2 + 2.5;
    // Khoảng cách khớp fov đứng + đệm PAD; kẹp trong [12,130].
    const dist = Math.min(130, Math.max(12, (radius / Math.tan((fov * Math.PI) / 180 / 2)) * PAD));
    return {
      center: [cx, 0, cz] as [number, number, number],
      // magnitude = dist chuẩn; phân rã theo góc chếch ELEV → cao/ngang cân đối.
      camPos: [cx, dist * sinE, cz + dist * cosE] as [number, number, number],
      // sàn + lưới THU về vừa hộp bao (+đệm 6u), không trải mênh mông ra foreground.
      floorW: spanX + 6, floorD: spanZ + 6,
    };
  }, [positions]);
  // W6 (doc 67, việc 2): frameloop='demand' — dữ liệu/lựa chọn/khung camera đổi thì
  // vẽ lại 1 frame (kèm invalidate theo hover/selection trong TwinBlock; OrbitControls
  // của drei tự invalidate khi xoay/zoom ở demand-mode).
  useEffect(() => { invalidate(); }, [fit, selectedId]);
  return (
    <>
      {/* key theo fit → đổi phạm vi thiết bị thì camera reset về khung vừa-khít mới. */}
      <PerspectiveCamera key={`${fit.camPos[0]}:${fit.camPos[2]}`} makeDefault position={fit.camPos} fov={50} />
      <OrbitControls enablePan enableZoom enableRotate minDistance={8} maxDistance={140} maxPolarAngle={Math.PI / 2.1} target={fit.center} />
      {/* W6 (doc 67, việc 1 — AIR-GAP): BỎ <Environment preset="night"> vì drei
          tải HDR từ CDN internet → mạng nhà máy không internet sẽ suspend vĩnh
          viễn (khung đen). Bù sáng bằng ambient/directional tăng nhẹ. */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[16, 22, 10]} intensity={1.25} castShadow />
      <pointLight position={[-10, 9, -10]} intensity={0.45} color="#06b6d4" />
      {/* Lưới + sàn THU về vừa hộp bao thiết bị & CĂN THEO tâm cụm (fit.center) —
          bỏ infiniteGrid/plane cố-định-gốc-toạ-độ vì chúng trải ra foreground trống
          gây mảng đen nửa dưới. */}
      <Grid position={[fit.center[0], -0.49, fit.center[2]]} args={[fit.floorW, fit.floorD]} cellSize={1} cellThickness={0.5} cellColor="#1e293b" sectionSize={5} sectionThickness={1} sectionColor="#334155" fadeDistance={Math.max(fit.floorW, fit.floorD)} fadeStrength={1.2} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[fit.center[0], -0.5, fit.center[2]]} receiveShadow>
        <planeGeometry args={[fit.floorW, fit.floorD]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.85} />
      </mesh>
      {devices.map((d, i) => (
        <TwinBlock
          key={d.id}
          node={d}
          position={positions[i]}
          selected={selectedId === d.id}
          onSelect={() => { onSelect(d.id); onOpen(d); }}
        />
      ))}
    </>
  );
}

/** Status-grid fallback: line→station→device cells coloured by hierarchy status.
 *  doc 68 §3.1 [P1]: chip thiết bị = <button> → mở ContextDrawer chi tiết (onDeviceOpen). */
function StatusGridFallback({
  factory, t, onDeviceOpen,
}: {
  factory: HierarchyNode | null;
  t: (k: string, f: string) => string;
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
                        title={`${dev.name} · ${STATUS_VI[dev.status]} — mở chi tiết`}
                        onClick={() => onDeviceOpen(dev)}
                      >
                        {chipInner}
                      </button>
                    ) : (
                      <span key={dev.id} className={chipCls} title={`${dev.name} · ${STATUS_VI[dev.status]}`}>
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
  t: (k: string, f: string) => string;
  /** doc 68 §3.1 [P1] — mở ContextDrawer chi tiết thiết bị (khối twin / chip 2D). */
  onDeviceOpen?: (d: DrawerDevice) => void;
}) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [webglOk, setWebglOk] = useState(true);

  // W6 (doc 67, việc 5): toggle 2D/3D — persist localStorage; mặc định '2d' trên
  // panel-PC (bề rộng ≤1366px lúc mount), '3d' màn lớn. Ở 2D KHÔNG mount Canvas
  // (tiết kiệm toàn bộ GPU cho iGPU panel-PC).
  const [viewMode, setViewMode] = useState<"2d" | "3d">(() => {
    try {
      const saved = localStorage.getItem("commandCenter:viewMode");
      if (saved === "2d" || saved === "3d") return saved;
    } catch { /* storage bị chặn → rơi về mặc định theo bề rộng */ }
    return window.innerWidth <= 1366 ? "2d" : "3d";
  });
  const changeViewMode = useCallback((m: "2d" | "3d") => {
    setViewMode(m);
    try { localStorage.setItem("commandCenter:viewMode", m); } catch { /* noop */ }
  }, []);

  // W6 (doc 67, việc 4): 10s → 30s — sceneGraph trả mảng mới mỗi lần fetch nên
  // mỗi chu kỳ là 1 lần re-render toàn scene; 30s đủ tươi cho sơ đồ tổng quan.
  const sceneQ = trpc.twin.sceneGraph.useQuery(
    { factoryId: factoryId ?? 0 },
    { enabled: factoryId != null, refetchInterval: 30_000, staleTime: 5_000 },
  );
  const devices = useMemo<TwinDevice[]>(() => sceneQ.data?.devices ?? [], [sceneQ.data]);
  const selectedDevice = devices.find((d) => d.id === selectedDeviceId) ?? null;

  // doc 68 §3.1 [P1] — chuẩn hoá → DrawerDevice rồi báo lên trang mở ContextDrawer.
  // Khối twin có state PackML + activeTaskId đầy đủ; chip 2D (HierarchyNode) được làm
  // giàu thêm bằng cách tra TwinDevice cùng refId trong scene (nếu có).
  const openTwinDevice = useCallback((d: TwinDevice) => {
    onDeviceOpen?.({ refId: d.refId, kind: d.kind, name: d.name, code: d.code, state: d.state, activeTaskId: d.activeTaskId });
  }, [onDeviceOpen]);
  const openGridDevice = useCallback((dev: HierarchyNode) => {
    if (typeof dev.refId !== "number" || (dev.kind !== "machine" && dev.kind !== "robot")) return;
    const twin = devices.find((d) => d.refId === dev.refId && d.kind === dev.kind) ?? null;
    onDeviceOpen?.({
      refId: dev.refId, kind: dev.kind, name: dev.name, code: dev.code,
      state: twin?.state ?? null, activeTaskId: twin?.activeTaskId ?? null, status: dev.status,
    });
  }, [devices, onDeviceOpen]);

  // Detect WebGL availability once — if absent, skip the Canvas (status grid instead).
  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
      setWebglOk(!!gl);
    } catch { setWebglOk(false); }
  }, []);

  const canRender3D = webglOk && devices.length > 0;

  // W4 (doc 67) — a11y cho canvas 3D: aria-label mô tả + tóm tắt sr-only theo
  // nhóm trạng thái (screen-reader không đọc được nội dung WebGL).
  const activeAlarmCount = factoryNode?.counts.activeAlarms ?? 0;
  const stateSummary = useMemo(() => {
    const byCat = new Map<string, number>();
    for (const d of devices) {
      const cat = twinStateCategoryVi(d.state);
      byCat.set(cat, (byCat.get(cat) ?? 0) + 1);
    }
    return [...byCat.entries()].map(([cat, n]) => `${n} ${cat.toLowerCase()}`).join(", ");
  }, [devices]);
  const sceneAriaLabel = `Bản sao số nhà máy${factoryNode ? ` ${factoryNode.name}` : ""} — ${devices.length} thiết bị, ${activeAlarmCount} cảnh báo đang hoạt động`;

  return (
    <SectionCard
      icon={<Factory className="h-4 w-4" />}
      title={
        factoryNode
          ? `${factoryNode.name} — ${devices.length} thiết bị`
          : t("cmd.selectFactory", "Select a factory")
      }
      action={
        <div className="flex items-center gap-2">
          {/* W6 (doc 67, việc 5): toggle 2D/3D — chỉ hiện khi 3D là lựa chọn khả dụng. */}
          {factoryId != null && webglOk && devices.length > 0 && (
            <div className="flex items-center gap-0.5 rounded-md border p-0.5" role="group" aria-label="Chế độ hiển thị sơ đồ nhà máy">
              <Button
                size="sm"
                variant={viewMode === "2d" ? "secondary" : "ghost"}
                className="h-7 px-2"
                aria-pressed={viewMode === "2d"}
                onClick={() => changeViewMode("2d")}
              >
                2D
              </Button>
              <Button
                size="sm"
                variant={viewMode === "3d" ? "secondary" : "ghost"}
                className="h-7 px-2"
                aria-pressed={viewMode === "3d"}
                onClick={() => changeViewMode("3d")}
              >
                3D
              </Button>
            </div>
          )}
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
      ) : canRender3D && viewMode === "3d" ? (
        /* W6 (doc 67, việc 1): ErrorBoundary quanh Canvas — scene lỗi (driver GPU,
           context-lost, shader…) rơi về lưới trạng thái thay vì khung đen; key theo
           factoryId để đổi nhà máy thì boundary tự reset. */
        <ErrorBoundary
          key={factoryId}
          fallback={
            <>
              <div className="mb-2 flex items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-1 text-[11px] text-warning">
                <Info className="h-3.5 w-3.5 shrink-0" />
                Không dựng được cảnh 3D — hiển thị lưới trạng thái trực tiếp thay thế.
              </div>
              <StatusGridFallback factory={factoryNode} t={t} onDeviceOpen={openGridDevice} />
            </>
          }
        >
          {/* W4 (doc 67): role="img" + aria-label mô tả — nội dung WebGL vô hình
              với screen-reader; kèm tóm tắt sr-only số liệu theo trạng thái.
              GĐ2 (việc 1): bg-[#0a0a0f] CỐ ĐỊNH có chủ đích — scene 3D (đèn,
              emissive, grid slate) được cân sáng cho nền tối, phải giữ tối ở CẢ
              light lẫn dark theme, không chuyển sang token nền theo theme. */}
          <div
            role="img"
            aria-label={sceneAriaLabel}
            className={cn("w-full overflow-hidden rounded-lg border bg-[#0a0a0f]", PANE_BODY_H)}
          >
            {/* W6 (doc 67): frameloop='demand' — cảnh tĩnh không đốt GPU 60fps;
                dpr trần 1.5 giới hạn độ phân giải render cho iGPU panel-PC. */}
            <Canvas shadows frameloop="demand" dpr={[1, 1.5]} onPointerMissed={() => setSelectedDeviceId(null)}>
              <Suspense fallback={null}>
                <CompactTwinScene devices={devices} selectedId={selectedDeviceId} onSelect={setSelectedDeviceId} onOpen={openTwinDevice} />
              </Suspense>
            </Canvas>
          </div>
          <p className="sr-only">
            {`Tóm tắt bản sao số: ${devices.length} thiết bị${stateSummary ? ` — ${stateSummary}` : ""}. ${activeAlarmCount} cảnh báo đang hoạt động trong phạm vi nhà máy này.`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {/* W4 (doc 67): nhãn chữ tiếng Việt cạnh chấm màu (không chỉ dựa màu). */}
            {/* GĐ2: legend đọc cùng nguồn stateHex — "Chờ" nay là muted-xám (đồng
                bộ chấm 2D; đổi so với amber cũ là CHỦ ĐÍCH, xem ghi chú đầu file). */}
            <Legend hex={stateHex("running")} label="Đang chạy" />
            <Legend hex={stateHex("idle")} label="Chờ" />
            <Legend hex="#f97316" label="Tạm dừng/Giữ" />
            <Legend hex={stateHex("fault")} label="Lỗi/E-stop" />
            <Legend hex="#64748b" label="Ngoại tuyến" />
            {selectedDevice && (
              <span className="ml-auto text-foreground">
                {selectedDevice.name} · {selectedDevice.state}
                {selectedDevice.activeTaskId != null ? ` · lệnh #${selectedDevice.activeTaskId}` : ""}
              </span>
            )}
          </div>
        </ErrorBoundary>
      ) : canRender3D ? (
        /* W6 (doc 67, việc 5): chế độ 2D chủ động — Canvas KHÔNG được mount,
           lưới trạng thái trực tiếp (line→station→device) thay thế toàn phần. */
        <StatusGridFallback factory={factoryNode} t={t} onDeviceOpen={openGridDevice} />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-[11px] text-info">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {webglOk
              ? t("cmd.gridEmptyScene", "No devices placed in this factory's scene — showing the live status grid.")
              : t("cmd.gridNoWebgl", "3D not available in this browser — showing the live status grid.")}
          </div>
          <StatusGridFallback factory={factoryNode} t={t} onDeviceOpen={openGridDevice} />
        </>
      )}
    </SectionCard>
  );
}

function Legend({ hex, label }: { hex: string; label: string }) {
  return <span className="flex items-center gap-1"><span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ background: hex }} /> {label}</span>;
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
      ? twinStateCategoryVi(drawerDevice.state)
      : drawerDevice.status
        ? STATUS_VI[drawerDevice.status]
        : "Không rõ"
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
    // W4 (doc 67): nhãn severity/kind tiếng Việt (SEVERITY_VI/KIND_VI).
    // doc 68 §3.1 [P1]: thẻ COMPACT 2 dòng — dòng 1 mức độ/loại/tồn-đọng/thời gian,
    // dòng 2 tiêu đề (truncate) + tham chiếu máy/robot inline (bỏ dòng nguồn riêng;
    // "loại" đã ở badge dòng 1) để dải cảnh báo gọn hơn.
    const inner = (
      <>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={a.severity} label={SEVERITY_VI[a.severity]} tone={severityTone(a.severity)} className="px-1 py-0 text-[10px]" />
          <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">{KIND_VI[a.kind] ?? a.kind}</Badge>
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
                  title="Luồng sự kiện hệ sinh thái đang phát trực tiếp qua socket"
                >
                  <Radio className="h-3.5 w-3.5" /> Sự kiện: trực tiếp
                </Badge>
              ) : (
                <Badge
                  className="gap-1 bg-warning text-warning-foreground"
                  title="Kết nối máy chủ vẫn trực tiếp — luồng sự kiện realtime chưa bật (cờ ECOSYSTEM_EVENTS)"
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
          <div title="Số đơn vị WIP đang trên chuyền">
            <MetricCard
              icon={<Boxes className="h-4 w-4" />}
              label="WIP"
              value={wipVal}
              size="compact"
              delta={kpi?.wip.value?.bottleneck ? `Nút cổ chai: ${kpi.wip.value.bottleneck}` : undefined}
            />
          </div>
          <div title="Cảnh báo nghiêm trọng / cao đang hoạt động">
            <MetricCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Cảnh báo"
              value={alarmsCrit == null ? "—" : `${alarmsCrit} / ${alarmsHigh}`}
              size="compact"
              tone={alarmsCrit ? "error" : "default"}
            />
          </div>
          <div title="Nhiệm vụ đội robot (chờ + đang chạy) / robot trực tuyến">
            <MetricCard
              icon={<Bot className="h-4 w-4" />}
              label="Nhiệm vụ"
              value={fleetTasks == null ? "—" : `${fleetTasks} / ${fleetRobots}`}
              size="compact"
            />
          </div>
          <div title="Số site đang báo cáo / tổng số site">
            <MetricCard
              icon={<Network className="h-4 w-4" />}
              label="Site"
              value={sitesReporting == null ? "—" : `${sitesReporting} / ${sitesTotal}`}
              size="compact"
              delta={sitesStale + sitesDown > 0 ? `${sitesStale} trễ dữ liệu · ${sitesDown} mất kết nối` : undefined}
              tone={sitesDown > 0 ? "error" : sitesStale > 0 ? "warning" : "default"}
            />
          </div>
          <div title="Số gợi ý AI đang hoạt động">
            <MetricCard
              icon={<Sparkles className="h-4 w-4" />}
              label="Gợi ý AI"
              value={aiVal}
              size="compact"
            />
          </div>
          {/* doc 68 §3.1 [P2] — ô GỘP muted: OEE trung bình + Năng lượng (cả hai
              chưa có tổng hợp toàn hệ → "—"); trung thực độ phủ dữ liệu, không bịa. */}
          <div
            className="sm:col-span-2"
            title="OEE trung bình toàn hệ (%) · Năng lượng toàn nhà máy (kWh) — chưa có tổng hợp toàn hệ sinh thái"
          >
            <MetricCard
              icon={<Zap className="h-4 w-4" />}
              label="OEE · Năng lượng (toàn hệ)"
              value={`${oeeVal} · ${energyVal}`}
              size="compact"
              delta={
                kpi?.oee.sourceLabel && kpi?.oee.available
                  ? `OEE ${kpi.oee.sourceLabel} (snapshot) · năng lượng chưa tổng hợp`
                  : "Chưa tổng hợp toàn hệ"
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
              title={<span title="Site → nhà máy → chuyền → trạm → máy / robot">Cây phân cấp</span>}
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
                      placeholder="Tìm theo tên / mã node…"
                      aria-label="Tìm kiếm node trong cây phân cấp"
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
                      <div role="tree" aria-label="Cây phân cấp hệ sinh thái">
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
              <div className="mb-1.5 flex flex-wrap items-center gap-1 px-1" role="group" aria-label="Lọc mức độ cảnh báo">
                {([["all", "Tất cả"], ["critical", "Nghiêm trọng"], ["high", "Cao"]] as const).map(([v, label]) => (
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
                     là trạng thái lọc, giữ dòng trung tính. */
                  <EmptyState allClear compact title="Không có cảnh báo đang hoạt động" />
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
              ? `${drawerDevice.kind === "robot" ? "Robot" : "Máy"} · ${drawerDevice.code}`
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
                  label="Trạng thái"
                  value={drawerStateLabel}
                />
                <MetricCard
                  size="compact"
                  icon={<Gauge className="h-4 w-4" />}
                  label="OEE máy"
                  value="—"
                />
                <MetricCard
                  size="compact"
                  icon={<ListChecks className="h-4 w-4" />}
                  label="Nhiệm vụ"
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
                  <EmptyState allClear compact title="Không có cảnh báo nghiêm trọng/cao" />
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
