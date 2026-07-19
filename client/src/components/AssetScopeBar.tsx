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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ListFilter, X } from "lucide-react";
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

  // doc65 F: 40px vùng chạm (panel + găng); chữ vẫn text-xs cho gọn thị giác.
  // doc 67 W4 [P0] — min-w-0 (bỏ min-w-24): selector là flex-item phải CO THẬT được khi
  // topbar chật (panel-PC 1280×800 tràn ngang 1423/1280). Nhãn dài vẫn đọc được nhờ
  // line-clamp-1 sẵn có của SelectTrigger (*:data-[slot=select-value]:line-clamp-1).
  const selectCls = "h-10 w-auto min-w-0 max-w-40 border-0 bg-transparent px-2 text-xs shadow-none hover:bg-accent focus:ring-1";
  // Trong Popover thu gọn: select bản đầy đủ, chiếm hết bề ngang hàng.
  const popoverSelectCls = "h-10 w-full min-w-0 text-xs";

  const labelFactory = t("scopeAxis.factory", "Xưởng");
  const labelLine = t("scopeAxis.line", "Chuyền");
  const labelMachine = t("scopeAxis.machine", "Máy");

  // Một selector cấp (Xưởng/Chuyền/Máy) — dùng lại cho cả chuỗi đầy đủ lẫn Popover thu gọn.
  const renderSelect = (
    kind: "factory" | "line" | "machine",
    value: number | undefined,
    nodes: HNode[],
    label: string,
    cls: string,
    disabled = false,
  ) => (
    <Select value={value != null ? String(value) : ""} onValueChange={pick(kind, nodes)} disabled={disabled}>
      <SelectTrigger className={cls} aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {nodes.map((n) => (
          <SelectItem key={n.id} value={String(n.refId)}>{n.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const hasSubScope = axis.lineId !== undefined || axis.machineId !== undefined;

  return (
    <div className={cn("min-w-0 items-center gap-0.5 rounded-full border border-border/60 px-1", className)}>
      {/* ≥2xl — chuỗi đầy đủ Xưởng › Chuyền › Máy (đủ chỗ). min-w-0 để cả cụm co được. */}
      <div className="hidden min-w-0 items-center gap-0.5 2xl:flex">
        {renderSelect("factory", axis.factoryId, factories, labelFactory, selectCls)}
        <span className="text-muted-foreground/60" aria-hidden>›</span>
        {renderSelect("line", axis.lineId, lines, labelLine, selectCls, lines.length === 0)}
        <span className="text-muted-foreground/60" aria-hidden>›</span>
        {renderSelect("machine", axis.machineId, machines, labelMachine, selectCls, machines.length === 0)}
      </div>
      {/* doc 67 W4 [P0] — <2xl (gồm panel-PC 1280×800): Xưởng inline, còn Chuyền + Máy thu
          thành 1 nút icon mở Popover chứa BỘ SELECTOR ĐẦY ĐỦ (không cắt chức năng, chỉ đổi
          chỗ đứng) — diệt tràn ngang tận gốc thay vì che bằng overflow-hidden. */}
      <div className="flex min-w-0 items-center gap-0.5 2xl:hidden">
        {renderSelect("factory", axis.factoryId, factories, labelFactory, selectCls)}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative size-10 shrink-0 rounded-full"
              aria-label={t("scopeAxis.compactOpen", "Chọn phạm vi Chuyền / Máy")}
            >
              <ListFilter className="size-4" />
              {/* Chấm báo trục con đang có selection (khi selector bị thu vào Popover). */}
              {hasSubScope && (
                <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" aria-hidden />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">{labelFactory}</span>
                {renderSelect("factory", axis.factoryId, factories, labelFactory, popoverSelectCls)}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">{labelLine}</span>
                {renderSelect("line", axis.lineId, lines, labelLine, popoverSelectCls, lines.length === 0)}
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-foreground">{labelMachine}</span>
                {renderSelect("machine", axis.machineId, machines, labelMachine, popoverSelectCls, machines.length === 0)}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
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
