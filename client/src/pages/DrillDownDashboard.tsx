/**
 * doc 46 FE-W3.2 — DRILL-DOWN DASHBOARD (the interactive Corporate→Machine spine).
 *
 * ONE consistent hierarchical drill-down over the `drillDown.*` router:
 *   Corporate → Factory → (Workshop*) → Line → (Station*) → Machine
 *
 * Each tier shows its real inspection KPI rollup (Output / OK / NG / Yield). The
 * drill is a continuous NAVIGATION SPINE, not a dead-end dashboard: clicking a
 * node continues drilling, a Line row exposes "Open Line View →" (/line-view/:id)
 * and a Machine row "Open Cockpit →" (/machine/:id).
 *
 * HONEST-DEGRADATION: (*) the Workshop & Station tiers are NOT rolled up by the
 * drillDown backend — `linesByFactory` collapses workshops (no workshopId in its
 * output) and `machinesByLine` collapses stations (no stationId) — so those two
 * tiers are shown in the canonical spine but carry NO fabricated numbers. OEE is
 * likewise not part of this inspection-based rollup, so it is not displayed.
 *
 * Realtime: U1 socket-first (invalidate drillDown on inspection/ng/yield/quality
 * events, debounced) + a 60s poll fallback so the numbers never freeze.
 *
 * doc 67 W8 — DRILL-STATE VÀO URL (deep-link):
 *   /drill-down?range=today|7d|30d|all&corp=<code>&factory=<id>&line=<id>&focus=<machineCode>
 * Tầng đang xem suy ra từ param sâu nhất (line → tầng máy, factory → tầng line,
 * corp → tầng nhà máy). Mỗi bước drill là 1 history entry (replace:false) → nút
 * Back của trình duyệt lùi đúng MỘT TẦNG. Param thiếu cha (?line=7 trần từ
 * Andon) hoặc ?focus=<machineCode> được hydrate/validate qua master data
 * (factory/line/workshop/station/machine.list) rồi normalize URL bằng replace;
 * id không tồn tại → rơi về tầng trên. focus=<machineCode> highlight node (ring
 * 5s + scroll tới).
 */
import { useMemo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { ContextDrawer } from "@/components/workspace/ContextDrawer";
import {
  useEcosystemEvents,
  type EcosystemEvent,
  type EcosystemKind,
} from "@/hooks/useEcosystemEvents";
import {
  MetricCard,
  EmptyState,
  SectionCard,
  Sparkline,
  chartTooltipStyle,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  DrillSpine,
  type DrillLevel,
  type DrillDownState,
} from "@/components/drilldown/DrillSpine";
import { DrillNode, yieldTone, type DrillRow } from "@/components/drilldown/DrillNode";
import {
  Building2,
  Factory,
  GitBranch,
  Cpu,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  BarChart3,
  Info,
  Crosshair,
  ExternalLink,
} from "lucide-react";
import {
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// ── Typesafe drillDown router output shapes (converged to the CommandCenter
//    pattern: inferred router types instead of `any`). ─────────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type CorporateStat = RouterOutputs["drillDown"]["corporateStats"][number];
type FactoryStat = RouterOutputs["drillDown"]["factoriesByCorporate"][number];
type LineStat = RouterOutputs["drillDown"]["linesByFactory"][number];
type MachineStat = RouterOutputs["drillDown"]["machinesByLine"][number];
type AnyStat = CorporateStat | FactoryStat | LineStat | MachineStat;

/**
 * U1 (ecosystem:event) kinds that move drill-down production numbers (OK/NG/NTF/
 * yield). These are the real inspection/NG/yield/quality-gate alert-layer kinds
 * in the server stream; routine inspections often don't hit this stream, so the
 * 60s poll fallback keeps background freshness.
 */
const DRILLDOWN_EVENT_KINDS: ReadonlySet<EcosystemKind> = new Set<EcosystemKind>([
  "inspection",
  "ng",
  "yield",
  "quality_gate",
]);

/**
 * doc 67 W6 — kỳ dữ liệu của drill-down. Trước đây số liệu là "toàn bộ lịch sử
 * cắt 50k" không khai kỳ; giờ người dùng chọn kỳ tường minh, mặc định "Hôm nay".
 * State đặt trong URL (?range=...) để giữ nguyên khi F5 / chia sẻ link.
 */
type DrillRange = "today" | "7d" | "30d" | "all";

const DRILL_RANGE_LABELS: Record<DrillRange, string> = {
  today: "Hôm nay",
  "7d": "7 ngày qua",
  "30d": "30 ngày qua",
  all: "Toàn thời gian",
};

function parseDrillRange(raw: string | null): DrillRange {
  return raw === "7d" || raw === "30d" || raw === "all" || raw === "today"
    ? raw
    : "today";
}

/**
 * Mốc bắt đầu kỳ, chặt về 00:00 địa phương — GIÁ TRỊ ổn định trong ngày (đổi
 * identity mỗi render không sao: react-query hash input theo cấu trúc), chỉ đổi
 * khi sang ngày mới hoặc đổi kỳ. 'all' → undefined = không lọc thời gian.
 */
function drillRangeFrom(range: DrillRange): Date | undefined {
  if (range === "all") return undefined;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (range === "7d") start.setDate(start.getDate() - 6);
  else if (range === "30d") start.setDate(start.getDate() - 29);
  return start;
}

/**
 * doc 67 W8 — sentinel "chưa gán tập đoàn" (khớp UNASSIGNED_CORPORATE_CODE phía
 * server annotationRouters): corporateStats phát code 'Unknown' cho inspection
 * có corporateCode NULL/rỗng, và factoriesByCorporate hiểu sentinel = match NULL.
 */
const UNASSIGNED_CORPORATE_CODE = "Unknown";

/** doc 67 W8 — drill params đọc từ URL (chưa validate với master data). */
interface DrillUrlParams {
  range: DrillRange;
  corp?: string;
  factoryId?: number;
  lineId?: number;
  /** Deep-link từ Andon/alarm: mã máy cần drill tới + highlight (ring 5s). */
  focus?: string;
}

function parsePositiveInt(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const n = Number.parseInt(raw, 10);
  // id âm (sentinel -1 "chưa gán") / NaN không bao giờ là id drill hợp lệ.
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseDrillSearch(search: string): DrillUrlParams {
  const sp = new URLSearchParams(search);
  return {
    range: parseDrillRange(sp.get("range")),
    corp: sp.get("corp")?.trim() || undefined,
    factoryId: parsePositiveInt(sp.get("factory")),
    lineId: parsePositiveInt(sp.get("line")),
    focus: sp.get("focus")?.trim() || undefined,
  };
}

/**
 * doc 67 W8 — search-string CHUẨN của drill-down (thứ tự param cố định →
 * effect normalize so sánh chuỗi hội tụ, không loop replace). range luôn ghi
 * tường minh (W6: số liệu luôn khai kỳ).
 */
function buildDrillSearch(p: DrillUrlParams): string {
  const q = new URLSearchParams();
  q.set("range", p.range);
  if (p.corp) q.set("corp", p.corp);
  if (p.factoryId != null) q.set("factory", String(p.factoryId));
  if (p.lineId != null) q.set("line", String(p.lineId));
  if (p.focus) q.set("focus", p.focus);
  return q.toString();
}

/** Normalise any tier's stat into the shared KPI row. */
function toRow(item: AnyStat): DrillRow {
  const id = "id" in item ? item.id : undefined;
  return {
    key: String(id ?? item.code ?? item.name),
    id,
    code: item.code,
    name: item.name,
    total: item.total ?? 0,
    ok: item.ok ?? 0,
    ng: item.ng ?? 0,
    ntf: item.ntf ?? 0,
    yieldRate: item.yieldRate ?? (item.total > 0 ? (item.ok / item.total) * 100 : 0),
    // W1: bucket "chưa gán" (corporate 'Unknown' / factory dư ngoài master data).
    isUnassigned: "isUnassigned" in item && item.isUnassigned === true ? true : undefined,
  };
}

export default function DrillDownDashboard(): React.JSX.Element {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const search = useSearch();

  // ── doc 67 W8: NGUỒN SỰ THẬT của drill-state là URL (?corp/&factory/&line +
  //    ?focus deep-link). F5 giữ chỗ, link gửi được, Back lùi đúng 1 tầng. ─────
  const params = useMemo(() => parseDrillSearch(search), [search]);

  // ── doc 67 W6: kỳ dữ liệu — URL (?range=today|7d|30d|all), mặc định "Hôm nay".
  //    Đổi kỳ chỉ ghi URL (replace, GIỮ nguyên drill params) → không rác history.
  const range = params.range;
  const rangeFrom = drillRangeFrom(range);
  // doc 68 §3.6 (việc 5): nhãn kỳ trùng Select đã bỏ; chuỗi kỳ vẫn dùng làm nhãn
  // kỳ cho khối KPI trong ContextDrawer máy (KPI ăn theo kỳ đã chọn).
  const rangeLabel = DRILL_RANGE_LABELS[range];
  // Input kỳ truyền xuống cả 4 tầng (máy cũng nhận — thiếu thì tổng các tầng lệch).
  const periodInput = rangeFrom ? { from: rangeFrom } : {};

  // ── W8: master data để (a) hydrate tên node khi vào bằng deep-link, (b)
  //    validate id (không tồn tại → rơi về tầng trên), (c) resolve cha còn thiếu
  //    (?line=7 trần từ Andon) và ?focus=<machineCode> → line chứa máy. Chỉ fetch
  //    khi URL thật sự cần (enabled), cache 5 phút — KHÔNG poll. ───────────────
  const needFactoryMaster = params.factoryId != null || params.lineId != null || params.focus != null;
  const needLineMaster = params.lineId != null || params.focus != null;
  const { data: masterFactories } = trpc.factory.list.useQuery(undefined, {
    enabled: needFactoryMaster,
    staleTime: 300_000,
  });
  const { data: masterWorkshops } = trpc.workshop.list.useQuery(undefined, {
    enabled: needLineMaster,
    staleTime: 300_000,
  });
  const { data: masterLines } = trpc.line.list.useQuery(undefined, {
    enabled: needLineMaster,
    staleTime: 300_000,
  });
  const { data: masterStations } = trpc.station.list.useQuery(undefined, {
    enabled: params.focus != null,
    staleTime: 300_000,
  });
  const { data: masterMachines } = trpc.machine.list.useQuery(undefined, {
    enabled: params.focus != null,
    staleTime: 300_000,
  });

  // ── W8: resolve + validate URL params với master data. Khi master chưa về
  //    (pending) thì dùng nguyên params (optimistic) và HOÃN normalize URL. ────
  const resolved = useMemo(() => {
    let { corp, factoryId, lineId, focus } = params;
    const focusMastersReady =
      !!masterMachines && !!masterStations && !!masterLines && !!masterWorkshops && !!masterFactories;
    const lineMastersReady = !!masterLines && !!masterWorkshops && !!masterFactories;
    const pending =
      (focus != null && !focusMastersReady) ||
      (lineId != null && !lineMastersReady) ||
      (factoryId != null && !masterFactories);

    // focus=<machineCode> → line chứa máy (đè lên line/factory/corp nếu lệch).
    if (focus != null && focusMastersReady) {
      const machine = masterMachines!.find((m) => m.code === focus);
      const station = machine ? masterStations!.find((s) => s.id === machine.stationId) : undefined;
      if (station) lineId = station.lineId;
      else focus = undefined; // mã máy không tồn tại → bỏ focus, giữ phần còn lại
    }
    // line → suy factory/corp thật từ master data (validate + hydrate cha thiếu).
    if (lineId != null && lineMastersReady) {
      const line = masterLines!.find((l) => l.id === lineId);
      if (!line) {
        lineId = undefined; // line không tồn tại → rơi về tầng trên
      } else {
        const workshop = masterWorkshops!.find((w) => w.id === line.workshopId);
        const factory = workshop ? masterFactories!.find((f) => f.id === workshop.factoryId) : undefined;
        if (factory) {
          factoryId = factory.id;
          corp = factory.corporateCode ?? UNASSIGNED_CORPORATE_CODE;
        }
      }
    }
    // factory → validate + suy corp (corporateCode NULL → sentinel 'Unknown').
    if (factoryId != null && masterFactories) {
      const factory = masterFactories.find((f) => f.id === factoryId);
      if (!factory) {
        factoryId = undefined; // factory không tồn tại → rơi về tầng trên
      } else {
        corp = factory.corporateCode ?? UNASSIGNED_CORPORATE_CODE;
      }
    }
    // corp: không có danh mục tập đoàn độc lập phía client (corporateStats sinh
    // từ inspection + sentinel) → chấp nhận chuỗi bất kỳ; server trả rỗng nếu lạ.
    return { corp, factoryId, lineId, focus, pending };
  }, [params, masterFactories, masterWorkshops, masterLines, masterStations, masterMachines]);

  // ── W8: normalize URL (replace — không thêm history) khi params ≠ dạng chuẩn:
  //    thêm cha còn thiếu, bỏ id chết, range tường minh. So sánh chuỗi chuẩn
  //    (thứ tự param cố định trong buildDrillSearch) nên hội tụ sau 1 replace. ──
  useEffect(() => {
    if (resolved.pending) return;
    const desired = buildDrillSearch({
      range,
      corp: resolved.corp,
      factoryId: resolved.factoryId,
      lineId: resolved.lineId,
      focus: resolved.focus,
    });
    const current = search.startsWith("?") ? search.slice(1) : search;
    if (desired !== current) setLocation(`/drill-down?${desired}`, { replace: true });
  }, [resolved, range, search, setLocation]);

  // ── W8: cache tên node đã biết lúc click (URL chỉ mang id/code) — breadcrumb
  //    hiện tên ngay, không đợi master list; master data ghi đè khi về. ─────────
  const nameHintRef = useRef(new Map<string, string>());
  const rememberName = useCallback((key: string, name: string) => {
    nameHintRef.current.set(key, name);
  }, []);

  const drillState = useMemo<DrillDownState>(() => {
    const { corp, factoryId, lineId } = resolved;
    const corporateName =
      corp == null
        ? undefined
        : corp === UNASSIGNED_CORPORATE_CODE
          ? "Chưa gán tập đoàn"
          : nameHintRef.current.get(`c:${corp}`) ?? corp;
    const factoryName =
      factoryId != null
        ? masterFactories?.find((f) => f.id === factoryId)?.name ?? nameHintRef.current.get(`f:${factoryId}`)
        : undefined;
    const lineName =
      lineId != null
        ? masterLines?.find((l) => l.id === lineId)?.name ?? nameHintRef.current.get(`l:${lineId}`)
        : undefined;
    if (lineId != null) {
      return { level: "machine", corporateCode: corp, corporateName, factoryId, factoryName, lineId, lineName };
    }
    if (factoryId != null) {
      return { level: "line", corporateCode: corp, corporateName, factoryId, factoryName };
    }
    if (corp != null) {
      return { level: "factory", corporateCode: corp, corporateName };
    }
    return { level: "corporate" };
  }, [resolved, masterFactories, masterLines]);

  // ── Queries per level. Realtime = socket-first (U1 invalidate); refetchInterval
  //    60s is the POLL FALLBACK so an enabled level never freezes if the socket
  //    drops. Only the enabled level polls. ────────────────────────────────────
  const { data: corporateStats, isLoading: corporateLoading, dataUpdatedAt: corporateUpdatedAt } = trpc.drillDown.corporateStats.useQuery(
    rangeFrom ? { from: rangeFrom } : undefined,
    { enabled: drillState.level === "corporate", refetchInterval: 60_000 },
  );
  const { data: factoryStats, isLoading: factoryLoading, dataUpdatedAt: factoryUpdatedAt } = trpc.drillDown.factoriesByCorporate.useQuery(
    { corporateCode: drillState.corporateCode!, ...periodInput },
    { enabled: drillState.level === "factory" && !!drillState.corporateCode, refetchInterval: 60_000 },
  );
  const { data: lineStats, isLoading: lineLoading, dataUpdatedAt: lineUpdatedAt } = trpc.drillDown.linesByFactory.useQuery(
    { factoryId: drillState.factoryId!, ...periodInput },
    { enabled: drillState.level === "line" && !!drillState.factoryId, refetchInterval: 60_000 },
  );
  const { data: machineStats, isLoading: machineLoading, dataUpdatedAt: machineUpdatedAt } = trpc.drillDown.machinesByLine.useQuery(
    { lineId: drillState.lineId!, ...periodInput },
    { enabled: drillState.level === "machine" && !!drillState.lineId, refetchInterval: 60_000 },
  );

  // ── W2 (AUD-01): freshness của TẦNG ĐANG XEM — chỉ 1 trong 4 query được
  //    enabled theo drillState.level, nên độ tươi của trang = dataUpdatedAt của
  //    đúng query đó (0 = chưa từng fetch → undefined, không bịa mốc). ─────────
  const activeUpdatedAtRaw =
    drillState.level === "corporate" ? corporateUpdatedAt :
    drillState.level === "factory" ? factoryUpdatedAt :
    drillState.level === "line" ? lineUpdatedAt : machineUpdatedAt;
  const activeUpdatedAt = activeUpdatedAtRaw > 0 ? activeUpdatedAtRaw : undefined;

  // ── Realtime U1: socket-first + poll fallback ──
  const utils = trpc.useUtils();
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleDrillRefresh = useCallback(() => {
    if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    invalidateTimer.current = setTimeout(() => {
      void utils.drillDown.invalidate();
    }, 1_500);
  }, [utils]);
  const onEcoEvent = useCallback(
    (evt: EcosystemEvent) => {
      if (DRILLDOWN_EVENT_KINDS.has(evt.kind)) scheduleDrillRefresh();
    },
    [scheduleDrillRefresh],
  );
  const { isConnected: liveConnected } = useEcosystemEvents({ onEvent: onEcoEvent });
  useEffect(
    () => () => {
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
    },
    [],
  );

  // ── W8: mọi điều hướng drill = ghi URL, replace:false → mỗi bước drill là 1
  //    history entry, nút Back của trình duyệt lùi đúng MỘT TẦNG (drill 3 tầng
  //    → Back 3 lần về gốc). focus chủ động bỏ khi drill tiếp (highlight đã xong).
  const pushDrill = useCallback(
    (p: { corp?: string; factoryId?: number; lineId?: number; focus?: string }) => {
      setLocation(`/drill-down?${buildDrillSearch({ range, ...p })}`, { replace: false });
    },
    [range, setLocation],
  );

  // Đổi kỳ chỉ replace URL và GIỮ nguyên vị trí drill + focus.
  const handleRangeChange = useCallback(
    (value: string) => {
      setLocation(
        `/drill-down?${buildDrillSearch({
          range: parseDrillRange(value),
          corp: resolved.corp,
          factoryId: resolved.factoryId,
          lineId: resolved.lineId,
          focus: resolved.focus,
        })}`,
        { replace: true },
      );
    },
    [setLocation, resolved],
  );

  // ── Navigation within the drill (breadcrumb / stepper về tầng đã qua) ──
  const handleNavigate = useCallback(
    (level: DrillLevel, data?: Partial<DrillDownState>) => {
      if (level === "corporate") pushDrill({});
      else if (level === "factory") pushDrill({ corp: data?.corporateCode });
      else if (level === "line") pushDrill({ corp: data?.corporateCode, factoryId: data?.factoryId });
      else pushDrill({ corp: data?.corporateCode, factoryId: data?.factoryId, lineId: data?.lineId });
    },
    [pushDrill],
  );

  const drillInto = useCallback(
    (row: DrillRow) => {
      const { level } = drillState;
      if (level === "corporate" && row.code) {
        rememberName(`c:${row.code}`, row.name);
        pushDrill({ corp: row.code });
      } else if (level === "factory" && row.id != null) {
        rememberName(`f:${row.id}`, row.name);
        pushDrill({ corp: resolved.corp, factoryId: row.id });
      } else if (level === "line" && row.id != null) {
        rememberName(`l:${row.id}`, row.name);
        pushDrill({ corp: resolved.corp, factoryId: resolved.factoryId, lineId: row.id });
      }
    },
    [drillState, resolved, pushDrill, rememberName],
  );

  // ── Leaf-out navigation (continuous spine) ──
  const openLineView = useCallback((lineId: number) => setLocation(`/line-view/${lineId}`), [setLocation]);
  const openCockpit = useCallback((machineId: number) => setLocation(`/machine/${machineId}`), [setLocation]);

  // ── doc 68 §3.6 (việc 2): tầng máy click → ContextDrawer preview (thay hard-
  //    navigate rời trang). Drawer hiện KPI máy (từ row đã có) + sparkline lịch
  //    sử NG theo kỳ + top điểm-đo lỗi; "Mở buồng lái" = CTA bước-2. Giữ danh
  //    sách rank phía sau để so sánh máy liên tiếp. ────────────────────────────
  const [previewMachine, setPreviewMachine] = useState<DrillRow | null>(null);
  const previewMachineId = previewMachine?.id ?? null;

  // Cửa sổ sparkline độc lập với KPI-range: KPI ăn theo kỳ đã chọn (từ row), còn
  // sparkline luôn cần ≥7 ngày để đọc được XU HƯỚNG (kỳ "Hôm nay" 1 điểm là vô
  // nghĩa). Memo theo range → chuỗi ISO ổn định giữa các render (không refetch
  // loạn). Trần 30 ngày, an toàn dưới ràng buộc ≤90 ngày của endpoint.
  const previewWindow = useMemo(() => {
    const days = range === "30d" || range === "all" ? 30 : 7;
    const end = new Date();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    return { days, startDate: start.toISOString(), endDate: end.toISOString() };
  }, [range]);

  // Chỉ fetch khi drawer mở & máy có id thật. retry:false + xử lý lỗi tại chỗ
  // (endpoint analytics có canary-gate: non-admin ngoài rollout → FORBIDDEN;
  // honest-degradation thay vì spinner treo). Số liệu là inspection thật.
  const previewTrendQ = trpc.aiInspectionAnalytics.defectTrend.useQuery(
    { machineId: previewMachineId ?? 0, startDate: previewWindow.startDate, endDate: previewWindow.endDate },
    { enabled: previewMachineId != null, retry: false, staleTime: 60_000 },
  );
  const previewParetoQ = trpc.aiInspectionAnalytics.defectPareto.useQuery(
    { machineId: previewMachineId ?? 0, startDate: previewWindow.startDate, endDate: previewWindow.endDate },
    { enabled: previewMachineId != null, retry: false, staleTime: 60_000 },
  );
  // Chuỗi NG theo ngày (sparkline) + top-5 điểm-đo lỗi (Pareto theo TÊN điểm đo).
  const previewTrend = previewTrendQ.data ?? [];
  const previewTrendNg = previewTrend.map((p) => p.fail);
  const previewTrendNgTotal = previewTrendNg.reduce((a, b) => a + b, 0);
  const previewPareto = (previewParetoQ.data ?? []).slice(0, 5);
  const previewParetoMax = Math.max(...previewPareto.map((p) => p.count), 1);
  const openPreviewCockpit = useCallback(() => {
    const id = previewMachine?.id;
    setPreviewMachine(null);
    if (id != null) openCockpit(id);
  }, [previewMachine, openCockpit]);

  // ── Current level's rows + rollup ──
  const rows = useMemo<DrillRow[]>(() => {
    let data: AnyStat[] = [];
    if (drillState.level === "corporate" && corporateStats) data = corporateStats;
    else if (drillState.level === "factory" && factoryStats) data = factoryStats;
    else if (drillState.level === "line" && lineStats) data = lineStats;
    else if (drillState.level === "machine" && machineStats) data = machineStats;
    const level = drillState.level;
    return (
      data
        .map(toRow)
        // W1: hàng "chưa gán" — nhãn tiếng Việt rõ nghĩa + tooltip hướng khắc phục.
        .map((row) => {
          if (!row.isUnassigned) return row;
          if (level === "corporate") {
            return {
              ...row,
              name: "Chưa gán tập đoàn",
              unassignedNote:
                "Thiếu mapping tập đoàn — gán trong Quản lý dữ liệu. Bấm để xem các nhà máy của nhóm này.",
            };
          }
          return {
            ...row,
            unassignedNote:
              "Kết quả kiểm tra có mã nhà máy không khớp danh mục (hoặc thiếu) — gán trong Quản lý dữ liệu.",
          };
        })
        // doc 68 §3.6 (việc 1) — RANK THEO MỨC XẤU: job của trang là "yield tụt ở
        // ĐÂU", nên node tệ nhất phải nổi lên ĐẦU danh sách (không phải quét từng
        // dòng theo total). Thứ tự: (1) bucket "chưa gán" luôn cuối; (2) node
        // KHÔNG sản lượng (total≤0) chìm dưới node đang chạy — 0% không phải
        // "yield tệ" mà là "đứng im"; (3) trong nhóm đã-gán & có sản lượng: yield
        // TĂNG DẦN (thấp nhất = tụt nhất lên đầu), hoà thì NG nhiều hơn lên trước.
        .sort((a, b) => {
          const ua = Number(a.isUnassigned ?? false) - Number(b.isUnassigned ?? false);
          if (ua !== 0) return ua;
          const pa = Number(a.total <= 0) - Number(b.total <= 0);
          if (pa !== 0) return pa;
          if (a.yieldRate !== b.yieldRate) return a.yieldRate - b.yieldRate;
          return b.ng - a.ng;
        })
    );
  }, [drillState.level, corporateStats, factoryStats, lineStats, machineStats]);

  const rollup = useMemo(() => {
    let total = 0, ok = 0, ng = 0, ntf = 0;
    for (const r of rows) {
      total += r.total;
      ok += r.ok;
      ng += r.ng;
      ntf += r.ntf;
    }
    return { total, ok, ng, ntf, yieldRate: total > 0 ? (ok / total) * 100 : 0 };
  }, [rows]);

  const isLoading = corporateLoading || factoryLoading || lineLoading || machineLoading;
  const maxValue = Math.max(...rows.map((r) => r.total), 1);
  // W4 (ISA-101): NG bars scale against the tier's max NG — scaled by max Output
  // they were invisible even on the worst node.
  const maxNg = Math.max(...rows.map((r) => r.ng), 1);
  // ── doc 67 W8 (việc 2): 'Yield thấp nhất' hết là con số chết — chọn NODE xấu
  //    nhất của tầng (loại hàng isUnassigned + hàng không có sản lượng: line
  //    đứng im 0% không phải "yield tệ"), hiển thị TÊN + giá trị, click drill
  //    thẳng vào node đó. Tone theo ngưỡng yieldTone như W4. ───────────────────
  const worstRow = useMemo<DrillRow | null>(() => {
    let worst: DrillRow | null = null;
    for (const r of rows) {
      if (r.isUnassigned || r.total <= 0) continue;
      if (!worst || r.yieldRate < worst.yieldRate) worst = r;
    }
    return worst;
  }, [rows]);

  // ── W8 (việc 3): highlight node theo deep-link ?focus=<machineCode> (hoặc khi
  //    bấm node xấu nhất ở tầng máy) — ring 5s rồi tự tắt, node tự scroll tới. ──
  const [highlightCode, setHighlightCode] = useState<string | null>(null);
  useEffect(() => {
    if (params.focus) setHighlightCode(params.focus);
  }, [params.focus]);
  useEffect(() => {
    // Chỉ bắt đầu đếm 5s khi node highlight THẬT SỰ có mặt trong danh sách đang render.
    if (!highlightCode || !rows.some((r) => r.code === highlightCode)) return;
    const timer = setTimeout(() => setHighlightCode(null), 5_000);
    return () => clearTimeout(timer);
  }, [highlightCode, rows]);

  // Click 'Yield thấp nhất': tầng còn drill được → drillInto; tầng máy (lá) →
  // highlight node (ring 5s + scroll) thay vì rời trang.
  const focusWorstRow = useCallback(() => {
    if (!worstRow) return;
    if (drillState.level === "machine") setHighlightCode(worstRow.code ?? null);
    else drillInto(worstRow);
  }, [worstRow, drillState.level, drillInto]);

  // ── W8 (việc 2): 'Đi tới điểm xấu nhất' — tự drill theo nhánh yield thấp nhất
  //    qua các tầng (corporate→factory→line, mỗi tầng chọn min yieldRate, loại
  //    isUnassigned/không sản lượng), dừng ở tầng máy của line xấu nhất. Đích
  //    cuối là MỘT history entry (Back 1 lần về chỗ đứng trước khi bấm). ────────
  const [walkingToWorst, setWalkingToWorst] = useState(false);
  const goToWorstPath = useCallback(async () => {
    if (walkingToWorst) return;
    setWalkingToWorst(true);
    try {
      const pInput = rangeFrom ? { from: rangeFrom } : {};
      const pickWorst = <T extends { total: number; yieldRate: number; isUnassigned?: boolean }>(
        list: readonly T[],
      ): T | null => {
        let worst: T | null = null;
        for (const item of list) {
          if (item.isUnassigned || item.total <= 0) continue;
          if (!worst || item.yieldRate < worst.yieldRate) worst = item;
        }
        return worst;
      };

      let corp = drillState.corporateCode;
      let factoryId = drillState.factoryId;
      const lineId = drillState.lineId;

      if (lineId != null) {
        // Đã đứng ở tầng máy — điểm xấu nhất là máy xấu nhất ngay trước mặt.
        if (worstRow?.code) setHighlightCode(worstRow.code);
        return;
      }
      if (corp == null) {
        const corps = await utils.drillDown.corporateStats.fetch(rangeFrom ? { from: rangeFrom } : undefined);
        const worst = pickWorst(corps ?? []);
        if (!worst) return;
        corp = worst.code;
        rememberName(`c:${worst.code}`, worst.name);
      }
      if (factoryId == null) {
        const factories = await utils.drillDown.factoriesByCorporate.fetch({ corporateCode: corp, ...pInput });
        const worst = pickWorst(factories ?? []);
        if (!worst) {
          pushDrill({ corp }); // không còn nhánh drill được — dừng ở tầng sâu nhất đã tới
          return;
        }
        factoryId = worst.id;
        rememberName(`f:${worst.id}`, worst.name);
      }
      const lines = await utils.drillDown.linesByFactory.fetch({ factoryId, ...pInput });
      const worstLine = pickWorst(lines ?? []);
      if (!worstLine) {
        pushDrill({ corp, factoryId });
        return;
      }
      rememberName(`l:${worstLine.id}`, worstLine.name);
      pushDrill({ corp, factoryId, lineId: worstLine.id });
    } finally {
      setWalkingToWorst(false);
    }
  }, [walkingToWorst, rangeFrom, drillState, worstRow, utils, pushDrill, rememberName]);

  const pieData = [
    { name: "OK", value: rollup.ok, color: "var(--success)" },
    { name: "NG", value: rollup.ng, color: "var(--destructive)" },
    { name: "NTF", value: rollup.ntf, color: "var(--warning)" },
  ].filter((d) => d.value > 0);
  // W4: donut center total + legend figures (outer labels overflowed the card
  // edge and collided with the chat FAB).
  const pieSum = pieData.reduce((acc, d) => acc + d.value, 0);
  // doc 68 §3.6 (việc 5): donut co lại khi THƯA (≤2 lát, ví dụ chỉ OK/NG) —
  // vòng nhỏ 250→180px hết phình nửa card cho 1-2 điểm dữ liệu.
  const donutSparse = pieData.length <= 2;
  const donutHeight = donutSparse ? 180 : 240;
  const donutInner = donutSparse ? 46 : 60;
  const donutOuter = donutSparse ? 64 : 80;

  // ── Level presentation (title + node icon + how a row behaves) ──
  const levelMeta = {
    corporate: {
      title: t("dashboard.drill.corporatesTitle", "All corporates"),
      icon: <Building2 className="h-4 w-4" />,
      hint: t("dashboard.clickToViewDetails", "Click to view details"),
    },
    factory: {
      title: t("dashboard.drill.factoriesTitle", "Factories in {{name}}", {
        name: drillState.corporateName || drillState.corporateCode,
      }),
      icon: <Factory className="h-4 w-4" />,
      hint: t("dashboard.clickToViewDetails", "Click to view details"),
    },
    line: {
      title: t("dashboard.drill.linesTitle", "Lines in {{name}}", { name: drillState.factoryName }),
      icon: <GitBranch className="h-4 w-4" />,
      hint: t("dashboard.drill.lineHint", "Drill into this line's machines, or open the full Line View."),
    },
    machine: {
      title: t("dashboard.drill.machinesTitle", "Machines in {{name}}", { name: drillState.lineName }),
      icon: <Cpu className="h-4 w-4" />,
      hint: t("dashboard.drill.machineHint", "Machine is the leaf tier — open its cockpit for full detail."),
    },
  }[drillState.level];

  // Build the correct per-row behaviour for the active tier.
  const rowFor = (row: DrillRow) => {
    // W1: hàng "Chưa gán nhà máy" (tầng factory trở xuống) là bucket giải thích
    // chênh lệch tổng — KHÔNG drill được (không có id thật trong master data).
    // Riêng tầng corporate, "Chưa gán tập đoàn" VẪN drill được (server hiểu
    // sentinel 'Unknown' = corporateCode NULL).
    if (row.isUnassigned && drillState.level !== "corporate") {
      return { onDrill: undefined, onPreview: undefined, leafAction: undefined };
    }
    if (drillState.level === "line") {
      return {
        onDrill: () => drillInto(row),
        onPreview: undefined,
        leafAction:
          row.id != null
            ? {
                label: t("dashboard.drill.openLineView", "Open Line View"),
                ariaLabel: t("dashboard.drill.openLineViewAria", "Open Line View for {{name}}", { name: row.name }),
                onClick: () => openLineView(row.id!),
              }
            : undefined,
      };
    }
    if (drillState.level === "machine") {
      // doc 68 §3.6: tầng lá — click hàng mở ContextDrawer preview (KPI +
      // sparkline NG + top điểm-đo lỗi) thay vì hard-navigate; "Mở buồng lái"
      // là CTA trong drawer. Máy chưa có id thật → không mở preview được.
      return {
        onDrill: undefined,
        onPreview: row.id != null ? () => setPreviewMachine(row) : undefined,
        leafAction: undefined,
      };
    }
    // corporate / factory: click continues drilling, no leaf-out.
    return { onDrill: () => drillInto(row), onPreview: undefined, leafAction: undefined };
  };

  return (
    <DashboardLayout title={t("nav.drillDown", "Corporate Analytics")}>
      <div className="space-y-6">
        {/* W4 a11y: trang chưa có h1 — DashboardLayout chỉ hiện title ở sidebar,
            không phải tiêu đề trang → h1 sr-only cho screen reader / landmark.
            doc 67 W5 (việc 2) — 1 key/trang: h1 = breadcrumb = menu = nav.drillDown. */}
        <h1 className="sr-only">{t("nav.drillDown", "Phân tích tập đoàn")}</h1>
        {/* Canonical spine: breadcrumb + 6-tier stepper (honest degradation).
            W2 (AUD-01): badge độ tươi = socket + dataUpdatedAt của query đang
            active — socket sống mà query fail/stale thì KHÔNG còn nhận LIVE. */}
        <DrillSpine
          state={drillState}
          onNavigate={handleNavigate}
          updatedAt={activeUpdatedAt}
          connected={liveConnected}
        />

        {/* doc 68 §3.6 (việc 5) — bộ chọn kỳ dữ liệu: BỎ nhãn "Kỳ: {rangeLabel}"
            trùng giá trị đang hiện trong Select (chỉ giữ caption tĩnh + Select).
            RelatedViews đã đẩy xuống chân trang (rail phụ, không phải đường chính).
            State kỳ nằm trong URL (?range=). */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="drill-range" className="text-sm text-muted-foreground">
            {t("dashboard.dataPeriod", "Kỳ dữ liệu")}
          </label>
          <Select value={range} onValueChange={handleRangeChange}>
            {/* W4 touch: min-h-11 (44px) — operator panel-PC với găng tay. */}
            <SelectTrigger id="drill-range" className="min-h-11 w-[180px]" aria-label="Chọn kỳ dữ liệu">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hôm nay</SelectItem>
              <SelectItem value="7d">7 ngày</SelectItem>
              <SelectItem value="30d">30 ngày</SelectItem>
              <SelectItem value="all">Toàn thời gian</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary rollup — real inspection metrics only (no fabricated OEE). */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label={t("dashboard.totalProduction", "Output")}
            value={rollup.total.toLocaleString()}
            icon={<Activity className="h-5 w-5" />}
            tone="info"
          />
          <MetricCard
            label={t("dashboard.okProducts", "OK")}
            value={rollup.ok.toLocaleString()}
            delta={`${((rollup.ok / rollup.total) * 100 || 0).toFixed(1)}%`}
            icon={<CheckCircle2 className="h-5 w-5" />}
            tone="good"
          />
          <MetricCard
            label={t("dashboard.ngProducts", "NG")}
            value={rollup.ng.toLocaleString()}
            delta={`${((rollup.ng / rollup.total) * 100 || 0).toFixed(1)}%`}
            icon={<XCircle className="h-5 w-5" />}
            tone="danger"
          />
          <MetricCard
            label={t("dashboard.yieldRate", "Yield")}
            value={`${rollup.yieldRate.toFixed(2)}%`}
            icon={<TrendingUp className="h-5 w-5" />}
            tone={rollup.yieldRate >= 95 ? "good" : rollup.yieldRate >= 90 ? "warning" : "danger"}
          />
        </div>

        {/* Honest note on rollup source */}
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(
            "dashboard.drill.metricsSource",
            "Rollup from inspection results (OK / NG / NTF). OEE isn't part of this inspection-based drill.",
          )}
        </p>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Main drill-down list */}
          <div className="lg:col-span-2">
            <SectionCard
              icon={<BarChart3 className="h-5 w-5" />}
              title={levelMeta.title}
              description={levelMeta.hint}
              // doc 68 §3.6 (việc 4): "Đi tới điểm xấu nhất" NỔI ở cạnh tiêu đề
              // danh sách (trước chôn trong Quick-stats outline/sm) — đây là hành
              // động chính của job "yield tụt ở đâu": tự drill nhánh yield thấp
              // nhất tới tầng máy của line xấu nhất.
              action={
                <Button
                  type="button"
                  size="sm"
                  className="min-h-11 shrink-0 gap-1.5"
                  onClick={() => void goToWorstPath()}
                  disabled={walkingToWorst || isLoading || worstRow == null}
                >
                  <Crosshair className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {walkingToWorst ? "Đang tìm điểm xấu nhất…" : "Đi tới điểm xấu nhất"}
                  </span>
                </Button>
              }
            >
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              ) : rows.length === 0 ? (
                <EmptyState variant="no-data" icon={AlertTriangle} title={t("common.noData", "No data")} compact />
              ) : (
                <div className="space-y-3">
                  {rows.map((row) => {
                    const behaviour = rowFor(row);
                    return (
                      <DrillNode
                        key={row.key}
                        data={row}
                        maxValue={maxValue}
                        maxNg={maxNg}
                        icon={levelMeta.icon}
                        onDrill={behaviour.onDrill}
                        onPreview={behaviour.onPreview}
                        leafAction={behaviour.leafAction}
                        // W8 (việc 3): deep-link ?focus=<machineCode> / node xấu nhất → ring 5s.
                        highlighted={highlightCode != null && row.code === highlightCode}
                      />
                    );
                  })}
                </div>
              )}
            </SectionCard>
          </div>

          {/* Pie + quick stats */}
          <div className="space-y-4">
            <SectionCard title={t("dashboard.resultDistribution", "Result distribution")}>
              {isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : pieData.length === 0 ? (
                <div className="flex h-64 items-center justify-center text-muted-foreground">
                  {t("common.noData", "No data")}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={donutHeight}>
                  {/* W4: bỏ label ngoài + labelLine (tràn mép card, bị FAB chat đè) —
                      tổng vào tâm donut, số liệu từng phần vào Legend.
                      doc 68 §3.6: bán kính co theo mật độ dữ liệu (donutSparse). */}
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={donutInner}
                      outerRadius={donutOuter}
                      paddingAngle={5}
                      dataKey="value"
                      label={false}
                      labelLine={false}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <text
                      x="50%"
                      y="44%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-foreground text-xl font-bold"
                    >
                      {pieSum.toLocaleString()}
                    </text>
                    <text
                      x="50%"
                      y="53%"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="fill-muted-foreground text-xs"
                    >
                      Tổng
                    </text>
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(value: number) => value.toLocaleString()} />
                    <Legend
                      formatter={(value, entry) => {
                        const v = Number((entry?.payload as { value?: number } | undefined)?.value ?? 0);
                        const pct = pieSum > 0 ? Math.round((v / pieSum) * 100) : 0;
                        return `${value} ${v.toLocaleString()} · ${pct}%`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title={t("dashboard.quickStats", "Quick stats")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("common.quantity", "Quantity")}</span>
                  <Badge variant="outline">{rows.length}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{t("dashboard.highestYield", "Highest yield")}</span>
                  <Badge variant="default">{Math.max(...rows.map((r) => r.yieldRate), 0).toFixed(1)}%</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground">{t("dashboard.lowestYield", "Lowest yield")}</span>
                  {/* W8 (việc 2): hết con số chết — TÊN node xấu nhất + giá trị,
                      click → drill thẳng vào node (tầng máy → highlight ring).
                      Tone giữ ngưỡng yieldTone (W4). Loại isUnassigned + node
                      không sản lượng khỏi lựa chọn min. */}
                  {worstRow ? (
                    <button
                      type="button"
                      onClick={focusWorstRow}
                      title={`${worstRow.name} — bấm để đi tới node này`}
                      className="flex min-h-11 min-w-0 items-center justify-end gap-2 rounded-md px-1.5 text-right transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">{worstRow.name}</span>
                      <Badge variant={yieldTone(worstRow.yieldRate)}>{worstRow.yieldRate.toFixed(1)}%</Badge>
                    </button>
                  ) : (
                    <Badge variant="outline">—</Badge>
                  )}
                </div>
                {/* doc 68 §3.6 (việc 4): nút "Đi tới điểm xấu nhất" đã chuyển lên
                    cạnh tiêu đề danh sách (nổi hơn) — Quick-stats chỉ còn số liệu. */}
              </div>
            </SectionCard>
          </div>
        </div>

        {/* doc 68 §3.6 (việc 3): ĐÃ BỎ bar chart đáy — nó lặp lại đúng progress
            bar OK/NG đã có trong mỗi DrillNode. Danh sách giờ RANK theo mức xấu
            (việc 1) + sparkline NG trong drawer máy (việc 2) đã phục vụ trọn câu
            hỏi "yield tụt ở đâu", nên khối trùng này chỉ tổ nhiễu → gỡ hẳn. */}

        {/* doc 68 §3.6 (việc 5): RelatedViews xuống chân trang — rail 2-chiều là
            lối tắt PHỤ, không chiếm vùng đắt giá đầu trang nữa. */}
        <RelatedViews pageId="drill-down" />
      </div>

      {/* doc 68 §3.6 (việc 2): ContextDrawer preview máy — click hàng máy mở
          overlay phải (KPI + sparkline NG lịch sử + top điểm-đo lỗi), giữ danh
          sách rank phía sau để so sánh máy liên tiếp. "Mở buồng lái" = CTA bước-2. */}
      <ContextDrawer
        open={previewMachine != null}
        onOpenChange={(open) => {
          if (!open) setPreviewMachine(null);
        }}
        title={
          <span className="flex items-center gap-2">
            <Cpu className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{previewMachine?.name}</span>
          </span>
        }
        description={
          previewMachine
            ? [previewMachine.code, drillState.lineName].filter(Boolean).join(" · ")
            : undefined
        }
      >
        {previewMachine && (
          <div className="space-y-5">
            {/* KPI máy — ăn theo KỲ đã chọn (từ row rollup, không fetch thêm). */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("dashboard.machineKpiPeriod", "KPI · kỳ {{period}}", { period: rangeLabel })}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <MetricCard
                  size="compact"
                  label={t("dashboard.totalProduction", "Output")}
                  value={previewMachine.total.toLocaleString()}
                  icon={<Activity className="h-4 w-4" />}
                  tone="info"
                />
                <MetricCard
                  size="compact"
                  label={t("dashboard.okProducts", "OK")}
                  value={previewMachine.ok.toLocaleString()}
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  tone="good"
                />
                <MetricCard
                  size="compact"
                  label={t("dashboard.ngProducts", "NG")}
                  value={previewMachine.ng.toLocaleString()}
                  icon={<XCircle className="h-4 w-4" />}
                  tone="danger"
                />
                <MetricCard
                  size="compact"
                  label={t("dashboard.yieldRate", "Yield")}
                  value={`${previewMachine.yieldRate.toFixed(1)}%`}
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone={previewMachine.yieldRate >= 95 ? "good" : previewMachine.yieldRate >= 90 ? "warning" : "danger"}
                />
              </div>
            </div>

            {/* Sparkline lịch sử NG theo ngày — cửa sổ ≥7 ngày để đọc XU HƯỚNG. */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("dashboard.ngHistoryDays", "NG {{n}} ngày gần đây", { n: previewWindow.days })}
                </p>
                {!previewTrendQ.isLoading && !previewTrendQ.isError && previewTrend.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t("dashboard.ngTotalShort", "Tổng NG {{n}}", { n: previewTrendNgTotal.toLocaleString() })}
                  </span>
                )}
              </div>
              {previewTrendQ.isLoading ? (
                <Skeleton className="h-12 w-full" />
              ) : previewTrendQ.isError ? (
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.analyticsUnavailable", "Phân tích không khả dụng cho tài khoản này.")}
                </p>
              ) : previewTrend.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.noNgInPeriod", "Không có NG trong kỳ.")}
                </p>
              ) : (
                <Sparkline
                  data={previewTrendNg}
                  tone="critical"
                  showArea
                  showEndDot
                  width={372}
                  height={48}
                  className="w-full"
                  aria-label={t("dashboard.ngHistoryAria", "Lịch sử NG {{n}} ngày", { n: previewWindow.days })}
                />
              )}
            </div>

            {/* Top điểm-đo lỗi (Pareto theo TÊN điểm đo) — "tụt ở ĐÂU trên board". */}
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("dashboard.topDefectPoints", "Top điểm-đo lỗi")}
              </p>
              {previewParetoQ.isLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : previewParetoQ.isError ? (
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.analyticsUnavailable", "Phân tích không khả dụng cho tài khoản này.")}
                </p>
              ) : previewPareto.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("dashboard.noDefectPoints", "Không có điểm-đo lỗi trong kỳ.")}
                </p>
              ) : (
                <ul className="space-y-2">
                  {previewPareto.map((p, i) => (
                    <li key={`${p.defectType}-${i}`} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate">{p.defectType}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {p.count.toLocaleString()} · {p.percentage.toFixed(0)}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-destructive"
                          style={{ width: `${(p.count / previewParetoMax) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* CTA bước-2: mở buồng lái đầy đủ (đóng drawer rồi điều hướng). */}
            <Button className="min-h-11 w-full gap-1.5" onClick={openPreviewCockpit}>
              {t("dashboard.drill.openCockpit", "Open Cockpit")}
              <ExternalLink className="h-4 w-4" />
            </Button>
          </div>
        )}
      </ContextDrawer>
    </DashboardLayout>
  );
}
