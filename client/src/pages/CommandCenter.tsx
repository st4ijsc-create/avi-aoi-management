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
import { MetricCard, PageHeader, StatusBadge, SectionCard } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { useEcosystemEvents, type EcosystemEvent, type EcosystemSeverity } from "@/hooks/useEcosystemEvents";
import PollFreshness from "@/components/PollFreshness";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Gauge, Boxes, AlertTriangle, Bot, Network, Sparkles, Zap, Activity, Factory,
  ChevronRight, ChevronDown, Cpu, Radio, RefreshCw, ExternalLink,
  ListChecks, WifiOff as OfflineIcon, MapPin, Info, Layers, ServerCog,
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

// ════════════════════════════════════════════════════════════════════════════
// SMALL HELPERS
// ════════════════════════════════════════════════════════════════════════════

/** Semantic token colour for a rolled-up node status dot. */
const STATUS_DOT: Record<NodeStatus, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  down: "bg-destructive",
  idle: "bg-muted-foreground/50",
  unknown: "bg-muted-foreground/30",
};

/** three.js hex colour for a status (mirrors the twin's palette). */
const STATUS_HEX: Record<NodeStatus, string> = {
  ok: "#10b981",
  warn: "#f59e0b",
  down: "#ef4444",
  idle: "#f59e0b",
  unknown: "#94a3b8",
};

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
    case "running": case "execute": case "active": return STATUS_HEX.ok;
    case "idle": return STATUS_HEX.idle;
    case "stopped": case "held": case "suspended": return "#f97316";
    case "aborted": case "error": case "fault": case "estop": return STATUS_HEX.down;
    case "offline": return "#64748b";
    default: return STATUS_HEX.unknown;
  }
}

/** Map an alert severity → a StatusBadge tone (mirrors the U1 alert-class rule). */
function severityTone(sev: EcosystemSeverity): "error" | "warning" | "info" {
  if (sev === "critical" || sev === "high") return "error";
  if (sev === "medium") return "warning";
  return "info";
}

function relTime(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
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
  node, depth, expanded, onToggle, selectedId, onSelect, onOpenCockpit, t,
}: {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenCockpit: (node: HierarchyNode) => void;
  t: (k: string, f: string) => string;
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
  };

  // W4 (doc 67) — bàn phím theo WAI-ARIA tree (subset gọn, roving tabindex qua
  // node đang chọn): Enter/Space = chọn; ArrowRight = mở; ArrowLeft = đóng.
  // stopPropagation để phím không nổi bọt lên treeitem cha (DOM lồng nhau).
  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // phím phát từ nút con → bỏ qua
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault(); e.stopPropagation();
      onSelect(node.id);
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
        <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[node.status])} title={STATUS_VI[node.status]} />

        {/* kind icon + name */}
        <span className="shrink-0 text-muted-foreground">{kindIcon(node.kind)}</span>
        <span className="truncate font-medium">{node.name}</span>

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
          {/* Open cockpit — leaf nodes only (U3 route).
              W4 (doc 67): hiện THƯỜNG TRỰC (không hover-only — cảm ứng không có
              hover), hit-area 40×40 (h-10 w-10, margin âm giữ hàng gọn); desktop
              vẫn có hiệu ứng hover đổi màu/nền. */}
          {isLeaf && typeof node.refId === "number" && (
            <button
              type="button"
              className="-my-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title="Mở cockpit"
              aria-label={`Mở cockpit ${node.name}`}
              onClick={(e) => { e.stopPropagation(); onOpenCockpit(node); }}
            >
              <ExternalLink className="h-4 w-4" />
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
              onOpenCockpit={onOpenCockpit}
              t={t}
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
  devices, selectedId, onSelect,
}: {
  devices: TwinDevice[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const camDist = Math.max(18, FLOOR_W * 0.9);
  // W6 (doc 67, việc 2): frameloop='demand' — dữ liệu/lựa chọn đổi thì vẽ lại
  // 1 frame (kèm invalidate theo hover/selection trong TwinBlock; OrbitControls
  // của drei tự invalidate khi xoay/zoom ở demand-mode).
  useEffect(() => { invalidate(); }, [devices, selectedId]);
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, camDist * 0.8, camDist]} fov={50} />
      <OrbitControls enablePan enableZoom enableRotate minDistance={8} maxDistance={140} maxPolarAngle={Math.PI / 2.1} target={[0, 0, 0]} />
      {/* W6 (doc 67, việc 1 — AIR-GAP): BỎ <Environment preset="night"> vì drei
          tải HDR từ CDN internet → mạng nhà máy không internet sẽ suspend vĩnh
          viễn (khung đen). Bù sáng bằng ambient/directional tăng nhẹ. */}
      <ambientLight intensity={0.7} />
      <directionalLight position={[16, 22, 10]} intensity={1.25} castShadow />
      <pointLight position={[-10, 9, -10]} intensity={0.45} color="#06b6d4" />
      <Grid args={[FLOOR_W + 10, FLOOR_D + 12]} cellSize={1} cellThickness={0.5} cellColor="#1e293b" sectionSize={5} sectionThickness={1} sectionColor="#334155" fadeDistance={60} fadeStrength={1} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W + 12, FLOOR_D + 14]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.85} />
      </mesh>
      {devices.map((d, i) => (
        <TwinBlock
          key={d.id}
          node={d}
          position={toScenePos(d.position, i, devices.length)}
          selected={selectedId === d.id}
          onSelect={() => onSelect(d.id)}
        />
      ))}
    </>
  );
}

/** Status-grid fallback: line→station→device cells coloured by hierarchy status. */
function StatusGridFallback({ factory, t }: { factory: HierarchyNode | null; t: (k: string, f: string) => string }) {
  if (!factory || !factory.children?.length) {
    return (
      <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
        {t("cmd.noFactoryLayout", "No line/station layout for this factory yet.")}
      </div>
    );
  }
  return (
    <ScrollArea className="h-[420px] pr-2">
      <div className="space-y-3">
        {factory.children.map((line) => (
          <div key={line.id} className="rounded-md border p-2">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-medium">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[line.status])} />
              <Layers className="h-3.5 w-3.5 text-muted-foreground" />
              {line.name}
            </div>
            <div className="space-y-1.5">
              {(line.children ?? []).map((station) => (
                <div key={station.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[station.status])} />
                    {station.name}
                  </span>
                  {(station.children ?? []).map((dev) => (
                    <span
                      key={dev.id}
                      className={cn(
                        "flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium",
                        dev.status === "ok" && "bg-success/15 text-success",
                        dev.status === "warn" && "bg-warning/15 text-warning",
                        dev.status === "down" && "bg-destructive/15 text-destructive",
                        (dev.status === "idle" || dev.status === "unknown") && "bg-muted text-muted-foreground",
                      )}
                      title={`${dev.name} · ${STATUS_VI[dev.status]}`}
                    >
                      {dev.kind === "robot" ? <Bot className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
                      {dev.code}
                    </span>
                  ))}
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
  factoryNode, factoryId, t,
}: {
  factoryNode: HierarchyNode | null;
  factoryId: number | null;
  t: (k: string, f: string) => string;
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
          {/* AUD-01 (doc 65 W2) + W6 (việc 4): tuổi dữ liệu scene — poll 30s, amber khi >2× chu kỳ. */}
          {factoryId != null && (
            <PollFreshness
              updatedAt={sceneQ.dataUpdatedAt || undefined}
              isFetching={sceneQ.isFetching}
              staleAfterMs={60_000}
            />
          )}
          {factoryId != null && (
            <Button size="sm" variant="outline" onClick={() => sceneQ.refetch()}>
              <RefreshCw className={cn("mr-1 h-4 w-4", sceneQ.isFetching && "animate-spin")} />
              {t("cmd.refresh", "Refresh")}
            </Button>
          )}
        </div>
      }
    >
      {factoryId == null ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
          {t("cmd.pickFactoryHint", "Select a site or factory in the tree to view its live floor.")}
        </div>
      ) : sceneQ.isLoading ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-muted-foreground">
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
              <StatusGridFallback factory={factoryNode} t={t} />
            </>
          }
        >
          {/* W4 (doc 67): role="img" + aria-label mô tả — nội dung WebGL vô hình
              với screen-reader; kèm tóm tắt sr-only số liệu theo trạng thái. */}
          <div
            role="img"
            aria-label={sceneAriaLabel}
            className="h-[420px] w-full overflow-hidden rounded-lg border bg-[#0a0a0f]"
          >
            {/* W6 (doc 67): frameloop='demand' — cảnh tĩnh không đốt GPU 60fps;
                dpr trần 1.5 giới hạn độ phân giải render cho iGPU panel-PC. */}
            <Canvas shadows frameloop="demand" dpr={[1, 1.5]} onPointerMissed={() => setSelectedDeviceId(null)}>
              <Suspense fallback={null}>
                <CompactTwinScene devices={devices} selectedId={selectedDeviceId} onSelect={setSelectedDeviceId} />
              </Suspense>
            </Canvas>
          </div>
          <p className="sr-only">
            {`Tóm tắt bản sao số: ${devices.length} thiết bị${stateSummary ? ` — ${stateSummary}` : ""}. ${activeAlarmCount} cảnh báo đang hoạt động trong phạm vi nhà máy này.`}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {/* W4 (doc 67): nhãn chữ tiếng Việt cạnh chấm màu (không chỉ dựa màu). */}
            <Legend hex={STATUS_HEX.ok} label="Đang chạy" />
            <Legend hex={STATUS_HEX.idle} label="Chờ" />
            <Legend hex="#f97316" label="Tạm dừng/Giữ" />
            <Legend hex={STATUS_HEX.down} label="Lỗi/E-stop" />
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
        <StatusGridFallback factory={factoryNode} t={t} />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 rounded-md border border-info/30 bg-info/10 px-2 py-1 text-[11px] text-info">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {webglOk
              ? t("cmd.gridEmptyScene", "No devices placed in this factory's scene — showing the live status grid.")
              : t("cmd.gridNoWebgl", "3D not available in this browser — showing the live status grid.")}
          </div>
          <StatusGridFallback factory={factoryNode} t={t} />
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

  const openCockpit = useCallback((node: HierarchyNode) => {
    if (typeof node.refId !== "number") return;
    // U3 routes (delivered next phase) — wire now; they resolve once U3 lands.
    if (node.kind === "robot") setLocation(`/robot/${node.refId}`);
    else if (node.kind === "machine") setLocation(`/machine/${node.refId}`);
  }, [setLocation]);

  const openAlarm = useCallback((a: AlarmRow) => {
    const sc = a.scope ?? {};
    if (sc.robotId != null) setLocation(`/robot/${sc.robotId}`);
    else if (sc.machineId != null) setLocation(`/machine/${sc.machineId}`);
    else if (a.kind === "andon") setLocation("/ops-console");
    else if (a.kind === "safety") setLocation("/safety-workforce");
  }, [setLocation]);

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
                <Badge
                  className="gap-1 bg-emerald-500 text-white"
                  title="Luồng sự kiện hệ sinh thái đang phát trực tiếp qua socket"
                >
                  <Radio className="h-3.5 w-3.5" /> Sự kiện: trực tiếp
                </Badge>
              ) : (
                <Badge
                  className="gap-1 bg-amber-500 text-white"
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
            Chỉ số toàn hệ sinh thái (làm mới 15s)
          </span>
          <PollFreshness
            updatedAt={kpiQ.dataUpdatedAt || undefined}
            isFetching={kpiQ.isFetching}
            staleAfterMs={30_000}
          />
        </div>
        {/* W4 (doc 67) — responsive 1280: xl mới lên 7 cột (1280 rơi về 4 cột,
            hết cắt cụt nhãn); nhãn rút gọn tiếng Việt + title tooltip đầy đủ trên
            wrapper (MetricCard truncate nội bộ — không sửa file DS ngoài phạm vi). */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <div title="OEE trung bình toàn hệ sinh thái (%)">
            <MetricCard
              icon={<Activity className="h-4 w-4" />}
              label="OEE"
              value={oeeVal}
              tone={kpi?.oee.value?.oee != null && kpi.oee.value.oee < 60 ? "warning" : "default"}
            />
          </div>
          <div title="Số đơn vị WIP đang trên chuyền">
            <MetricCard
              icon={<Boxes className="h-4 w-4" />}
              label="WIP"
              value={wipVal}
              delta={kpi?.wip.value?.bottleneck ? `Nút cổ chai: ${kpi.wip.value.bottleneck}` : undefined}
            />
          </div>
          <div title="Cảnh báo nghiêm trọng / cao đang hoạt động">
            <MetricCard
              icon={<AlertTriangle className="h-4 w-4" />}
              label="Cảnh báo"
              value={alarmsCrit == null ? "—" : `${alarmsCrit} / ${alarmsHigh}`}
              tone={alarmsCrit ? "error" : "default"}
            />
          </div>
          <div title="Nhiệm vụ đội robot (chờ + đang chạy) / robot trực tuyến">
            <MetricCard
              icon={<Bot className="h-4 w-4" />}
              label="Nhiệm vụ"
              value={fleetTasks == null ? "—" : `${fleetTasks} / ${fleetRobots}`}
            />
          </div>
          <div title="Số site đang báo cáo / tổng số site">
            <MetricCard
              icon={<Network className="h-4 w-4" />}
              label="Site"
              value={sitesReporting == null ? "—" : `${sitesReporting} / ${sitesTotal}`}
              delta={sitesStale + sitesDown > 0 ? `${sitesStale} trễ dữ liệu · ${sitesDown} mất kết nối` : undefined}
              tone={sitesDown > 0 ? "error" : sitesStale > 0 ? "warning" : "default"}
            />
          </div>
          <div title="Số gợi ý AI đang hoạt động">
            <MetricCard
              icon={<Sparkles className="h-4 w-4" />}
              label="Gợi ý AI"
              value={aiVal}
            />
          </div>
          <div title="Năng lượng tiêu thụ toàn nhà máy (kWh)">
            <MetricCard
              icon={<Zap className="h-4 w-4" />}
              label="Năng lượng"
              value={energyVal}
              delta={!kpi?.energy.available ? "Chưa có tổng hợp toàn hệ" : undefined}
            />
          </div>
        </div>

        {/* ── 3-PANE: tree · overview · rail ── */}
        {/* W4 (doc 67): min-w-0 từng cột để nội dung truncate được trong grid. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          {/* LEFT — hierarchy tree */}
          <div className="min-w-0 xl:col-span-3">
            <SectionCard
              icon={<ServerCog className="h-4 w-4" />}
              title={t("cmd.hierarchy", "Ecosystem hierarchy")}
              description={t("cmd.hierarchyHint", "Site → factory → line → station → machine / robot")}
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
                <ScrollArea className="h-[560px] pr-1">
                  {/* W4 (doc 67): role="tree" cho cây WAI-ARIA (treeitem/group bên trong). */}
                  <div role="tree" aria-label="Cây phân cấp hệ sinh thái">
                  {sites.map((site) => (
                    <TreeNode
                      key={site.id}
                      node={site}
                      depth={0}
                      expanded={expanded}
                      onToggle={toggle}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                      onOpenCockpit={openCockpit}
                      t={t}
                    />
                  ))}
                  </div>
                </ScrollArea>
              )}
            </SectionCard>
          </div>

          {/* CENTER — factory twin / status grid */}
          <div className="min-w-0 xl:col-span-6">
            <CenterOverview factoryNode={centerFactoryNode} factoryId={centerFactoryId} t={t} />
          </div>

          {/* RIGHT — unified alarm rail */}
          <div className="min-w-0 xl:col-span-3">
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
              {scopedAlarms.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {alarms.length === 0
                    ? t("cmd.noAlarms", "No active alarms. All clear.")
                    : t("cmd.noScopedAlarms", "No alarms in the selected scope.")}
                </div>
              ) : (
                <ScrollArea className="h-[560px] pr-1">
                  <div className="space-y-1.5">
                    {scopedAlarms.map((a) => {
                      const clickable = a.scope?.machineId != null || a.scope?.robotId != null || a.kind === "andon" || a.kind === "safety";
                      // W4 (doc 67): nhãn severity/kind tiếng Việt (SEVERITY_VI/KIND_VI).
                      const inner = (
                        <>
                          <div className="flex items-center gap-1.5">
                            <StatusBadge status={a.severity} label={SEVERITY_VI[a.severity]} tone={severityTone(a.severity)} className="px-1 py-0 text-[10px]" />
                            <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">{KIND_VI[a.kind] ?? a.kind}</Badge>
                            <span className="ml-auto text-[10px] text-muted-foreground">{relTime(a.ts, now)}</span>
                          </div>
                          <div className="mt-1 font-medium leading-snug">{a.title}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                            <span>{a.source}</span>
                            {a.scope?.machineId != null && <span>· Máy #{a.scope.machineId}</span>}
                            {a.scope?.robotId != null && <span>· Robot #{a.scope.robotId}</span>}
                            {clickable && <ExternalLink className="ml-auto h-3 w-3" aria-hidden="true" />}
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
                    })}
                  </div>
                </ScrollArea>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
