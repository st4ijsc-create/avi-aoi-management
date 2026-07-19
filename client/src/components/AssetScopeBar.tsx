/**
 * doc 64 IA-10 S0.3 — AssetScopeBar: bộ chọn TRỤC PHẠM VI ISA-95 ở header vỏ.
 *
 * Xưởng ▸ Chuyền ▸ Máy — cascade từ CÂY THẬT `commandCenter.hierarchy`
 * (site→factory→line→station→machine; refId = id số của bảng nguồn, name = nhãn
 * vật lý). Chọn cha → danh sách con lọc theo cha; đổi cha → con tự xoá
 * (AssetScopeContext cascade-clear). Ghi vào trục bền (localStorage) — điều
 * hướng KHÔNG mất scope; URL param của từng trang vẫn THẮNG khi có (useScope).
 *
 * ISA-101: bar im lặng (ghost/outline); chỉ là điều khiển phạm vi, không màu trạng thái.
 * Q2 (user): default = TOÀN NHÀ MÁY — không auto-scope; user tự chọn.
 */
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAssetScope } from "@/contexts/AssetScopeContext";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface HNode {
  id: string;
  kind: string;
  code: string;
  name: string;
  refId: number | string | null;
  children?: HNode[];
}

function collect(nodes: HNode[] | undefined, kind: string, out: HNode[] = []): HNode[] {
  for (const n of nodes ?? []) {
    if (n.kind === kind) out.push(n);
    collect(n.children, kind, out);
  }
  return out;
}

function findByRefId(nodes: HNode[] | undefined, kind: string, refId: number): HNode | null {
  for (const n of nodes ?? []) {
    if (n.kind === kind && Number(n.refId) === refId) return n;
    const hit = findByRefId(n.children, kind, refId);
    if (hit) return hit;
  }
  return null;
}

export function AssetScopeBar({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { axis, setAxis, clearAxis } = useAssetScope();

  const hierarchy = trpc.commandCenter.hierarchy.useQuery(undefined, {
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Shape thật của procedure: { sites: HierarchyNode[], status } (buildHierarchy) —
  // KHÔNG phải mảng trần. Guard Array.isArray để mọi biến thể tương lai không làm
  // crash chrome (bài học: object không iterable → ErrorBoundary nuốt cả layout).
  const rootsRaw = (hierarchy.data as { sites?: HNode[] } | undefined)?.sites;
  const roots = Array.isArray(rootsRaw) ? rootsRaw : [];

  // Cấp 1: mọi factory trong cây (site được đi xuyên — SiteSwitcher lo tầng site).
  const factories = useMemo(() => collect(roots, "factory"), [roots]);
  // Cấp 2: line dưới factory đã chọn (chưa chọn → toàn bộ line).
  const lines = useMemo(() => {
    if (axis.factoryId !== undefined) {
      const f = findByRefId(roots, "factory", axis.factoryId);
      return collect(f ? [f] : [], "line");
    }
    return collect(roots, "line");
  }, [roots, axis.factoryId]);
  // Cấp 3: máy dưới line đã chọn (đi xuyên station).
  const machines = useMemo(() => {
    if (axis.lineId !== undefined) {
      const l = findByRefId(roots, "line", axis.lineId);
      return collect(l ? [l] : [], "machine");
    }
    if (axis.factoryId !== undefined) {
      const f = findByRefId(roots, "factory", axis.factoryId);
      return collect(f ? [f] : [], "machine");
    }
    return [];
  }, [roots, axis.factoryId, axis.lineId]);

  if (!hierarchy.isSuccess || factories.length === 0) return null;

  const hasAny = axis.factoryId !== undefined || axis.lineId !== undefined || axis.machineId !== undefined;

  const pick = (kind: "factory" | "line" | "machine", nodes: HNode[]) => (v: string) => {
    const refId = Number(v);
    const node = nodes.find((n) => Number(n.refId) === refId);
    if (kind === "factory") setAxis({ factoryId: refId }, { factory: node?.name });
    else if (kind === "line") setAxis({ lineId: refId }, { line: node?.name });
    else setAxis({ machineId: refId }, { machine: node?.name });
  };

  const selectCls = "h-8 w-auto min-w-24 max-w-40 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent focus:ring-1";

  return (
    <div className={cn("items-center gap-0.5 rounded-full border border-border/60 px-1", className)}>
      <Select value={axis.factoryId != null ? String(axis.factoryId) : ""} onValueChange={pick("factory", factories)}>
        <SelectTrigger className={selectCls} aria-label={t("scopeAxis.factory", "Xưởng")}>
          <SelectValue placeholder={t("scopeAxis.factory", "Xưởng")} />
        </SelectTrigger>
        <SelectContent>
          {factories.map((f) => (
            <SelectItem key={f.id} value={String(f.refId)}>{f.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground/60">›</span>
      <Select value={axis.lineId != null ? String(axis.lineId) : ""} onValueChange={pick("line", lines)} disabled={lines.length === 0}>
        <SelectTrigger className={selectCls} aria-label={t("scopeAxis.line", "Chuyền")}>
          <SelectValue placeholder={t("scopeAxis.line", "Chuyền")} />
        </SelectTrigger>
        <SelectContent>
          {lines.map((l) => (
            <SelectItem key={l.id} value={String(l.refId)}>{l.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground/60">›</span>
      <Select value={axis.machineId != null ? String(axis.machineId) : ""} onValueChange={pick("machine", machines)} disabled={machines.length === 0}>
        <SelectTrigger className={selectCls} aria-label={t("scopeAxis.machine", "Máy")}>
          <SelectValue placeholder={t("scopeAxis.machine", "Máy")} />
        </SelectTrigger>
        <SelectContent>
          {machines.map((m) => (
            <SelectItem key={m.id} value={String(m.refId)}>{m.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasAny && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t("scopeAxis.clear", "Xoá phạm vi")}
          onClick={clearAxis}
        >
          <X className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/**
 * doc 64 IA-10 S0.4 — chip BẤT BIẾN TRUNG THỰC dưới breadcrumb: khi trục có
 * selection, trang ĐÃ wire (useScopeWired) hiện đường vật lý; trang CHƯA wire
 * hiện rõ "chưa lọc theo phạm vi" — không bao giờ ngầm-toàn-cục.
 */
export function ScopeStatusChip({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { axis, labels, wiredCount } = useAssetScope();
  const hasAny = axis.factoryId !== undefined || axis.lineId !== undefined || axis.machineId !== undefined;
  if (!hasAny) return null;
  const path = [labels.factory, labels.line, labels.machine].filter(Boolean).join(" › ");
  const wired = wiredCount > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-none",
        wired ? "border-border text-muted-foreground" : "border-amber-400/60 text-amber-700 dark:text-amber-300",
        className,
      )}
    >
      {t("scopeAxis.prefix", "Phạm vi")}: {path || "—"}
      {!wired && <span>· {t("scopeAxis.notWired", "trang này chưa lọc")}</span>}
    </span>
  );
}

export default AssetScopeBar;
