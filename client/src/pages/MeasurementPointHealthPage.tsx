/**
 * Doc 31 Đợt B (MP3) — Measurement-point mapping health.
 *
 * 68% of measurement points were auto-provisioned under the synthetic
 * __UNMAPPED__ product model (machine-reported code did not match a real def)
 * with NO visibility and NO way to fix it. This page adds:
 *   • Unmatched-rate metric — % of results landing under __UNMAPPED__ (overall
 *     + per-machine), so the problem is measurable.
 *   • Bulk-remap tool — select __UNMAPPED__ points → reassign to a real product
 *     model. A same-code target def is auto-merged (results re-pointed); else
 *     the def is moved. A per-point suggestion pre-fills the likely target.
 */
import { useMemo, useState } from "react";
// doc 64 IA-10 S2 — truc pham vi ISA-95.
import { useScope } from "@/components/patterns/ScopeFilterBar";
import { useScopeWired } from "@/contexts/AssetScopeContext";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { MapPin, RefreshCw, AlertTriangle, ArrowRightLeft, Lightbulb } from "lucide-react";
import { toast } from "sonner";

const UNMAPPED_CODE = "__UNMAPPED__";
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

interface UnmappedPoint {
  id: number;
  code: string;
  name: string;
  machineId: number | null;
  resultCount: number;
  suggestion: { productModelId: number; productModelCode: string; productModelName: string } | null;
}

export default function MeasurementPointHealthPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canRemap = user?.role === "admin";

  const utils = trpc.useUtils();
  // doc 64 IA-10 S2 — trục phạm vi: tỉ lệ unmapped lọc theo Máy của trục
  // (listUnmapped server chưa nhận input — DEP-S3, doc 64).
  const { scope: assetScope } = useScope(["machine"]);
  useScopeWired();
  const rateQ = trpc.measurementPoint.unmappedRate.useQuery({ machineId: assetScope.machineId });
  const listQ = trpc.measurementPoint.listUnmapped.useQuery(undefined);
  const modelsQ = trpc.productModel.list.useQuery({});

  const points = (listQ.data?.points ?? []) as UnmappedPoint[];
  const models = useMemo(
    () => ((modelsQ.data ?? []) as Array<{ id: number; code: string; name: string }>)
      .filter((m) => m.code !== UNMAPPED_CODE),
    [modelsQ.data],
  );

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const allSelected = points.length > 0 && selected.size === points.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(points.map((p) => p.id)));

  const [dialogOpen, setDialogOpen] = useState(false);
  const [targetModelId, setTargetModelId] = useState<string>("");

  const invalidate = () => {
    void utils.measurementPoint.listUnmapped.invalidate();
    void utils.measurementPoint.unmappedRate.invalidate();
  };

  const remapM = trpc.measurementPoint.remapUnmapped.useMutation({
    onSuccess: (r) => {
      toast.success(t("mpHealth.remapDone", "Đã remap: {{moved}} chuyển, {{merged}} gộp, {{results}} kết quả cập nhật", {
        moved: r.moved, merged: r.merged, results: r.resultsReassigned,
      }));
      setDialogOpen(false);
      setSelected(new Set());
      setTargetModelId("");
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openRemap = (prefillTarget?: number) => {
    setTargetModelId(prefillTarget ? String(prefillTarget) : "");
    setDialogOpen(true);
  };

  const doRemap = () => {
    const targetProductModelId = Number(targetModelId);
    if (!targetProductModelId) return;
    remapM.mutate({
      pointDefIds: Array.from(selected),
      targetProductModelId,
    });
  };

  // Quick-remap a single point using its own suggestion.
  const quickRemap = (p: UnmappedPoint) => {
    if (!p.suggestion) return;
    remapM.mutate({ pointDefIds: [p.id], targetProductModelId: p.suggestion.productModelId });
  };

  const rate = rateQ.data;

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<MapPin className="h-6 w-6" />}
          title={t("mpHealth.title", "Sức khoẻ ánh xạ điểm đo")}
          description={t("mpHealth.subtitle", "Theo dõi tỉ lệ điểm đo chưa ánh xạ (__UNMAPPED__) và remap về model sản phẩm thật")}
          actions={
            <Button size="icon" variant="ghost" onClick={() => { void rateQ.refetch(); void listQ.refetch(); }} title={t("common.refresh", "Làm mới")}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          }
        />

        {/* Metric cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">{t("mpHealth.totalResults", "Tổng kết quả")}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold">{rate?.total ?? 0}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">{t("mpHealth.unmatched", "Chưa ánh xạ")}</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-semibold text-warning">{rate?.unmatched ?? 0}</div></CardContent>
          </Card>
          <Card className={rate && rate.rate > 0.2 ? "border-destructive/40" : ""}>
            <CardHeader className="pb-1"><CardTitle className="text-xs font-normal text-muted-foreground">{t("mpHealth.rate", "Tỉ lệ chưa ánh xạ")}</CardTitle></CardHeader>
            <CardContent>
              <div className={`text-2xl font-semibold ${rate && rate.rate > 0.2 ? "text-destructive" : ""}`}>{pct(rate?.rate ?? 0)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Per-machine breakdown */}
        {rate && rate.byMachine.length > 0 && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">{t("mpHealth.byMachine", "Theo máy")}</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("mpHealth.machine", "Máy")}</TableHead>
                      <TableHead className="text-right">{t("mpHealth.total", "Tổng")}</TableHead>
                      <TableHead className="text-right">{t("mpHealth.unmatched", "Chưa ánh xạ")}</TableHead>
                      <TableHead className="text-right">{t("mpHealth.rate", "Tỉ lệ")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rate.byMachine.map((m) => (
                      <TableRow key={m.machineId}>
                        <TableCell className="font-mono text-xs">#{m.machineId}</TableCell>
                        <TableCell className="text-right">{m.total}</TableCell>
                        <TableCell className="text-right text-warning">{m.unmatched}</TableCell>
                        <TableCell className="text-right font-medium">{pct(m.rate)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* __UNMAPPED__ point list + remap */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="mr-auto text-base">{t("mpHealth.unmappedPoints", "Điểm đo chưa ánh xạ")} ({points.length})</CardTitle>
              <Button size="sm" disabled={!canRemap || selected.size === 0} onClick={() => openRemap()}>
                <ArrowRightLeft className="mr-1.5 h-4 w-4" /> {t("mpHealth.remapSelected", "Remap đã chọn")} ({selected.size})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!canRemap && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{t("mpHealth.adminOnly", "Chỉ admin mới remap được điểm đo (thao tác thay đổi cấu trúc dữ liệu).")}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} disabled={!canRemap || points.length === 0} />
                    </TableHead>
                    <TableHead>{t("defectCatalog.code", "Mã")}</TableHead>
                    <TableHead>{t("defectCatalog.name", "Tên")}</TableHead>
                    <TableHead className="text-right">{t("mpHealth.results", "Kết quả")}</TableHead>
                    <TableHead>{t("mpHealth.suggestion", "Gợi ý")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-center text-sm text-muted-foreground">{t("mpHealth.noUnmapped", "Không có điểm đo chưa ánh xạ. 🎉")}</TableCell></TableRow>
                  )}
                  {points.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell><Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} disabled={!canRemap} /></TableCell>
                      <TableCell className="font-mono text-xs">{p.code}</TableCell>
                      <TableCell className="text-xs">{p.name}</TableCell>
                      <TableCell className="text-right">{p.resultCount}</TableCell>
                      <TableCell className="text-xs">
                        {p.suggestion ? (
                          <span className="inline-flex items-center gap-1 text-success"><Lightbulb className="h-3.5 w-3.5" />{p.suggestion.productModelCode}</span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {p.suggestion && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!canRemap || remapM.isPending} onClick={() => quickRemap(p)}>
                            {t("mpHealth.applySuggestion", "Áp dụng gợi ý")}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageContainer>

      {/* Bulk remap dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("mpHealth.remapTitle", "Remap điểm đo")}</DialogTitle>
            <DialogDescription>
              {t("mpHealth.remapDesc", "Chọn model sản phẩm đích. Điểm có cùng mã ở model đích sẽ được gộp (kết quả chuyển sang def đích); còn lại được di chuyển sang model đích.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/40 p-2 text-xs">
              {t("mpHealth.remapCount", "{{n}} điểm đã chọn", { n: selected.size })}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("mpHealth.targetModel", "Model sản phẩm đích")} *</Label>
              <Select value={targetModelId} onValueChange={setTargetModelId}>
                <SelectTrigger><SelectValue placeholder={t("mpHealth.pickModel", "Chọn model…")} /></SelectTrigger>
                <SelectContent>
                  {models.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.code} — {m.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button disabled={!targetModelId || remapM.isPending} onClick={doRemap}>
              {t("mpHealth.remap", "Remap")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
