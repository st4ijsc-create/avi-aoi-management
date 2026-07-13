/**
 * doc 47 IA Đợt 2 — Cây mô hình nhà máy (Nhà máy → Xưởng → Dây chuyền → Trạm → Máy).
 *
 * Ghép cây phía client từ 5 query `list` (qua useFactoryModel — react-query dedupe,
 * không gọi mạng thừa). Mỗi nút: mở/gập, icon, mã + tên, badge đếm con trực tiếp,
 * chấm health (xanh/hổ phách/đỏ theo rule ở factoryModel), và "Sửa →" nhảy tới tab
 * CRUD tương ứng trong hub (lọc sẵn theo cha).
 *
 * Perf: subtree gập KHÔNG render (lazy) → vài trăm nút vẫn nhẹ. Ô tìm kiếm lọc theo
 * mã/tên (khớp con thì cha tự bung + hiện). HONEST: loading/empty/error tách bạch.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Warehouse,
  GitBranch,
  Cpu,
  Cog,
  ChevronRight,
  ChevronDown,
  Search,
  ArrowRight,
  Network,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/patterns";
import { ListSkeleton } from "@/components/AnalyticsSkeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  useFactoryModel,
  CHILD_UNIT,
  type TreeNode,
  type Navigate,
  type FactoryConfigLevel,
  type Sev,
} from "./factoryModel";

const LEVEL_ICON: Record<FactoryConfigLevel, React.ComponentType<{ className?: string }>> = {
  factory: Building2,
  workshop: Warehouse,
  line: GitBranch,
  station: Cpu,
  machine: Cog,
};

/** Chấm health: xanh (ok) / hổ phách (cảnh báo) / đỏ (lỗi). Semantic token, tự light/dark. */
const SEV_DOT: Record<Sev, string> = {
  0: "bg-success",
  1: "bg-warning",
  2: "bg-destructive",
};

export interface FactoryTreeProps {
  /** "Sửa →" — hub mở tab CRUD + lọc theo cha. */
  onNavigate: Navigate;
  className?: string;
}

export function FactoryTree({ onNavigate, className }: FactoryTreeProps): React.JSX.Element {
  const { t } = useTranslation();
  const { isLoading, isError, error, refetch, isEmpty, model } = useFactoryModel();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();

  // Chỉ số con-nào-khớp để khi tìm kiếm thì bung + hiện đúng nhánh chứa kết quả.
  const matchInfo = useMemo(() => {
    const map = new Map<string, boolean>(); // key → subtree có khớp
    const self = (n: TreeNode) => `${n.code} ${n.name}`.toLowerCase().includes(q);
    const walk = (n: TreeNode): boolean => {
      let hit = self(n);
      for (const c of n.children) if (walk(c)) hit = true;
      map.set(n.key, hit);
      return hit;
    };
    if (q) model.roots.forEach(walk);
    return map;
  }, [model.roots, q]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    const walk = (n: TreeNode) => {
      if (n.children.length > 0) {
        keys.push(n.key);
        n.children.forEach(walk);
      }
    };
    model.roots.forEach(walk);
    return keys;
  }, [model.roots]);

  if (isLoading) return <div className={className}><ListSkeleton /></div>;

  if (isError) {
    return (
      <div className={className}>
        <Alert variant="destructive" className="border-destructive/30">
          <AlertTitle>{t("dataSettings.overview.loadError", "Không tải được mô hình nhà máy")}</AlertTitle>
          <AlertDescription>
            {error instanceof Error ? error.message : null}
            <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>
              {t("common.retry", "Thử lại")}
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={className}>
        <EmptyState
          variant="no-data"
          icon={Building2}
          title={t("dataSettings.overview.emptyTitle", "Chưa có nhà máy nào")}
          description={t("dataSettings.overview.empty", "Chưa có nhà máy nào. Tạo nhà máy đầu tiên để bắt đầu.")}
          actionLabel={t("dataSettings.overview.addFactory", "Thêm nhà máy")}
          onAction={() => onNavigate({ level: "factory", id: 0 })}
        />
      </div>
    );
  }

  const visibleRoots = q
    ? model.roots.filter((r) => matchInfo.get(r.key))
    : model.roots;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("dataSettings.overview.searchPlaceholder", "Tìm theo mã hoặc tên…")}
            className="pl-8"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(new Set(allKeys))}
        >
          {t("dataSettings.overview.expandAll", "Mở hết")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(new Set())}
        >
          {t("dataSettings.overview.collapseAll", "Thu hết")}
        </Button>
      </div>

      {q && visibleRoots.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          {t("dataSettings.overview.noMatch", 'Không có nút nào khớp "{{q}}"').replace("{{q}}", query.trim())}
        </p>
      ) : (
        <div className="max-h-[560px] overflow-y-auto rounded-lg border border-border/60 p-1" role="tree">
          {visibleRoots.map((n) => (
            <TreeRow
              key={n.key}
              node={n}
              depth={0}
              expanded={expanded}
              toggle={toggle}
              onNavigate={onNavigate}
              matchInfo={q ? matchInfo : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface TreeRowProps {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onNavigate: Navigate;
  /** Khi tìm kiếm: chỉ số subtree-khớp (để bung + lọc). null = không tìm kiếm. */
  matchInfo: Map<string, boolean> | null;
}

function TreeRow({ node, depth, expanded, toggle, onNavigate, matchInfo }: TreeRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const hasChildren = node.children.length > 0;
  // Tìm kiếm → coi như bung để lộ kết quả; ngược lại theo state.
  const isOpen = matchInfo ? true : expanded.has(node.key);
  const Icon = LEVEL_ICON[node.level];
  const unit = CHILD_UNIT[node.level];

  const children = matchInfo
    ? node.children.filter((c) => matchInfo.get(c.key))
    : node.children;

  const sevLabel = t(
    `dataSettings.overview.sevDot.${node.sev}`,
    node.sev === 2 ? "Lỗi cấu hình" : node.sev === 1 ? "Cảnh báo cấu hình" : "Hợp lệ",
  );

  return (
    <div role="treeitem" aria-expanded={hasChildren ? isOpen : undefined}>
      <div
        className="group flex items-center gap-1.5 rounded-md py-1.5 pr-1.5 hover:bg-accent/60"
        style={{ paddingLeft: `${depth * 18 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggle(node.key)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            aria-label={isOpen ? t("dataSettings.overview.collapse", "Thu gọn") : t("dataSettings.overview.expand", "Mở rộng")}
          >
            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}

        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", SEV_DOT[node.sev])}
          title={sevLabel}
          aria-label={sevLabel}
        />

        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />

        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-foreground">{node.name}</span>
          <span className="ml-2 font-mono text-xs text-muted-foreground">{node.code}</span>
        </span>

        {unit && (
          <span
            className={cn(
              "shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] tabular-nums",
              node.childCount === 0
                ? "border-warning/40 text-warning"
                : "border-border text-muted-foreground",
            )}
          >
            {t(`dataSettings.overview.count.${unit}`, `{{count}} ${unit}`).replace("{{count}}", String(node.childCount))}
          </span>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs text-primary opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
          onClick={() => onNavigate(node.nav)}
        >
          {t("dataSettings.overview.edit", "Sửa")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      {hasChildren && isOpen && (
        children.length > 0 ? (
          children.map((c) => (
            <TreeRow
              key={c.key}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              onNavigate={onNavigate}
              matchInfo={matchInfo}
            />
          ))
        ) : (
          <p
            className="py-1 text-xs italic text-muted-foreground"
            style={{ paddingLeft: `${(depth + 1) * 18 + 26}px` }}
          >
            <Network className="mr-1 inline h-3 w-3" />
            {t("dataSettings.overview.emptyChild", "Chưa có mục con")}
          </p>
        )
      )}
    </div>
  );
}

export default FactoryTree;
