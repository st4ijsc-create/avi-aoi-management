import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Grid3X3,
  TrendingUp,
  Save,
  History,
  RefreshCw,
  Search,
  AlertTriangle,
} from "lucide-react";

// --- Helpers ---

function getCellColor(r: number, isDiagonal: boolean): string {
  if (isDiagonal) return "bg-blue-100 text-blue-900";
  const abs = Math.abs(r);
  if (abs < 0.1) return "bg-gray-50 text-gray-700";
  if (r > 0) {
    if (abs >= 0.7) return "bg-green-600 text-white";
    if (abs >= 0.5) return "bg-green-400 text-white";
    if (abs >= 0.3) return "bg-green-200 text-green-900";
    return "bg-green-100 text-green-800";
  }
  if (abs >= 0.7) return "bg-red-600 text-white";
  if (abs >= 0.5) return "bg-red-400 text-white";
  if (abs >= 0.3) return "bg-red-200 text-red-900";
  return "bg-red-100 text-red-800";
}

function strengthLabelKey(r: number): string {
  const abs = Math.abs(r);
  if (abs >= 0.7) return "reports.strengthStrong";
  if (abs >= 0.5) return "reports.strengthModerate";
  return "reports.strengthWeak";
}

// --- Component ---

export default function CorrelationAnalysis() {
  const { t } = useTranslation();
  // Filters
  const [selectedProductModel, setSelectedProductModel] = useState<string>("");
  const [selectedMachine, setSelectedMachine] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Point selection
  const [selectedPointIds, setSelectedPointIds] = useState<number[]>([]);
  const [pointSearch, setPointSearch] = useState("");

  // Analysis trigger
  const [analyzeParams, setAnalyzeParams] = useState<{
    pointIds: number[];
    startDate?: string;
    endDate?: string;
    machineId?: number;
  } | null>(null);

  // History
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [viewingSaved, setViewingSaved] = useState<any | null>(null);

  // --- Queries ---
  const productModelsQuery = trpc.productModel.list.useQuery();
  const machinesQuery = trpc.machine.list.useQuery();
  const pointsQuery = trpc.measurementPoint.list.useQuery();

  const analysisQuery = trpc.correlation.analyze.useQuery(
    analyzeParams!,
    { enabled: !!analyzeParams }
  );

  const savedListQuery = trpc.correlation.list.useQuery({
    productModelId: selectedProductModel ? Number(selectedProductModel) : undefined,
    limit: 20,
  });

  const saveMutation = trpc.correlation.save.useMutation({
    onSuccess: () => {
      toast.success(t('reports.analysisSaved'));
      savedListQuery.refetch();
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  // --- Derived data ---
  const filteredPoints = useMemo(() => {
    if (!pointsQuery.data) return [];
    let pts = pointsQuery.data;
    if (selectedProductModel) {
      pts = pts.filter(
        (p: any) => String(p.productModelId) === selectedProductModel
      );
    }
    if (pointSearch.trim()) {
      const q = pointSearch.toLowerCase();
      pts = pts.filter(
        (p: any) =>
          p.code?.toLowerCase().includes(q) ||
          p.name?.toLowerCase().includes(q)
      );
    }
    return pts;
  }, [pointsQuery.data, selectedProductModel, pointSearch]);

  const analysis = analysisQuery.data;

  // Map point ids to codes for matrix headers
  const pointCodeMap = useMemo(() => {
    const m: Record<number, string> = {};
    (pointsQuery.data ?? []).forEach((p: any) => {
      m[p.id] = p.code ?? `#${p.id}`;
    });
    return m;
  }, [pointsQuery.data]);

  // --- Handlers ---
  function togglePoint(id: number) {
    setSelectedPointIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 20) {
        toast.warning(t('reports.maxPointsWarning'));
        return prev;
      }
      return [...prev, id];
    });
  }

  function handleAnalyze() {
    if (selectedPointIds.length < 2) return;
    setAnalyzeParams({
      pointIds: selectedPointIds,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      machineId: selectedMachine ? Number(selectedMachine) : undefined,
    });
  }

  function handleSave() {
    if (!analysis || analysis.insufficient) return;
    saveMutation.mutate({
      productModelId: selectedProductModel
        ? Number(selectedProductModel)
        : undefined,
      machineId: selectedMachine ? Number(selectedMachine) : undefined,
      pointIds: analysis.pointIds ?? [],
      correlationMatrix: analysis.matrix ?? [],
      sampleSize: analysis.sampleSize,
      strongCorrelations: analysis.strongCorrelations,
    });
  }

  // --- Render ---
  return (
    <DashboardLayout title={t('reports.correlationAnalysis')}>
      <div className="space-y-6 p-4 md:p-6">
        {/* ===== Section 1: Analysis Setup ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Grid3X3 className="h-5 w-5" />
              {t('reports.analysisSetup')}
            </CardTitle>
            <CardDescription>
              {t('reports.analysisSetupDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters row */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="space-y-1.5">
                <Label>{t('common.productModel')}</Label>
                <Select
                  value={selectedProductModel}
                  onValueChange={(v) => {
                    setSelectedProductModel(v === "__all__" ? "" : v);
                    setSelectedPointIds([]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.allModels')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t('common.allModels')}</SelectItem>
                    {(productModelsQuery.data ?? []).map((pm: any) => (
                      <SelectItem key={pm.id} value={String(pm.id)}>
                        {pm.code} – {pm.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t('common.machine')}</Label>
                <Select
                  value={selectedMachine}
                  onValueChange={(v) =>
                    setSelectedMachine(v === "__all__" ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('common.allMachines')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{t('common.allMachines')}</SelectItem>
                    {(machinesQuery.data ?? []).map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{t('common.startDate')}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label>{t('common.endDate')}</Label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>

            {/* Point search */}
            <div className="space-y-1.5">
              <Label>{t('spc.searchMeasurementPoints')}</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder={t('spc.filterByCodeOrName')}
                  value={pointSearch}
                  onChange={(e) => setPointSearch(e.target.value)}
                />
              </div>
            </div>

            {/* Point list */}
            {pointsQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : filteredPoints.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('spc.noPointsFound')}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                  <span>
                    {t('reports.selectedOfTotal', { selected: selectedPointIds.length, total: filteredPoints.length })}
                  </span>
                  {selectedPointIds.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedPointIds([])}
                    >
                      {t('common.clearAll')}
                    </Button>
                  )}
                </div>
                <div className="max-h-60 overflow-y-auto rounded-md border p-2">
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredPoints.map((p: any) => (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-accent"
                      >
                        <Checkbox
                          checked={selectedPointIds.includes(p.id)}
                          onCheckedChange={() => togglePoint(p.id)}
                        />
                        <span className="truncate text-sm">
                          <span className="font-mono font-medium">
                            {p.code}
                          </span>{" "}
                          – {p.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Analyze button */}
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleAnalyze}
                disabled={
                  selectedPointIds.length < 2 || analysisQuery.isFetching
                }
              >
                {analysisQuery.isFetching ? (
                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <TrendingUp className="mr-2 h-4 w-4" />
                )}
                {t('reports.analyzePoints', { count: selectedPointIds.length })}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Loading state */}
        {analysisQuery.isFetching && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-64 w-full" />
            </CardContent>
          </Card>
        )}

        {/* Insufficient data alert */}
        {analysis?.insufficient && !analysisQuery.isFetching && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('reports.insufficientData')}</AlertTitle>
            <AlertDescription>
              {t('reports.insufficientDataDesc', { size: analysis.sampleSize ?? 0 })}
            </AlertDescription>
          </Alert>
        )}

        {/* ===== Section 2: Correlation Matrix ===== */}
        {analysis && !analysis.insufficient && !analysisQuery.isFetching && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Grid3X3 className="h-5 w-5" />
                {t('reports.correlationMatrix')}
              </CardTitle>
              <CardDescription>
                {t('reports.pearsonValues', { size: analysis.sampleSize })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Color legend */}
              <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
                <span className="font-medium">{t('common.legend')}:</span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded bg-green-600" />
                  {t('reports.strongPositive')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded bg-green-300" />
                  {t('reports.moderatePositive')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded bg-gray-100 border" />
                  {t('reports.nearZero')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded bg-red-300" />
                  {t('reports.moderateNegative')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded bg-red-600" />
                  {t('reports.strongNegative')}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-4 w-4 rounded bg-blue-100 border" />
                  {t('reports.diagonal')}
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-background px-2 py-1" />
                      {(analysis.pointIds ?? []).map((id: number) => (
                        <th
                          key={id}
                          className="px-2 py-1 text-center font-mono text-xs font-medium"
                          style={{ minWidth: 56 }}
                        >
                          {pointCodeMap[id] ?? id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(analysis.pointIds ?? []).map((rowId: number, ri: number) => (
                      <tr key={rowId}>
                        <td className="sticky left-0 z-10 bg-background px-2 py-1 font-mono text-xs font-medium whitespace-nowrap">
                          {pointCodeMap[rowId] ?? rowId}
                        </td>
                        {(analysis.pointIds ?? []).map(
                          (_colId: number, ci: number) => {
                            const r = (analysis.matrix ?? [])[ri]?.[ci] ?? 0;
                            const isDiag = ri === ci;
                            return (
                              <td
                                key={ci}
                                className={`px-2 py-1 text-center font-mono text-xs ${getCellColor(
                                  r,
                                  isDiag
                                )}`}
                                title={`r = ${r.toFixed(4)}`}
                              >
                                {r.toFixed(3)}
                              </td>
                            );
                          }
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ===== Section 3: Strong Correlations List ===== */}
        {analysis &&
          !analysis.insufficient &&
          !analysisQuery.isFetching &&
          analysis.strongCorrelations && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5" />
                  {t('reports.strongCorrelations')}
                </CardTitle>
                <CardDescription>
                  {t('reports.sortedByRDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {analysis.strongCorrelations.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('reports.noCorrelationsDetected')}
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('reports.pointA')}</TableHead>
                          <TableHead>{t('reports.pointB')}</TableHead>
                          <TableHead className="text-right">r</TableHead>
                          <TableHead className="text-right">
                            {t('reports.tStatistic')}
                          </TableHead>
                          <TableHead className="text-center">
                            {t('reports.significantQuestion')}
                          </TableHead>
                          <TableHead className="text-center">
                            {t('reports.strength')}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {[...analysis.strongCorrelations]
                          .sort(
                            (a: any, b: any) =>
                              Math.abs(b.r) - Math.abs(a.r)
                          )
                          .map((c: any, i: number) => (
                            <TableRow key={i}>
                              <TableCell className="font-mono text-sm">
                                {pointCodeMap[c.pointA] ?? c.pointA}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {pointCodeMap[c.pointB] ?? c.pointB}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {Number(c.r).toFixed(3)}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {Number(c.tStat).toFixed(3)}
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant={
                                    c.significant ? "default" : "secondary"
                                  }
                                  className={
                                    c.significant
                                      ? "bg-green-600 hover:bg-green-700"
                                      : ""
                                  }
                                >
                                  {c.significant
                                    ? t('reports.significant')
                                    : t('reports.notSignificant')}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge
                                  variant="outline"
                                  className={
                                    Math.abs(c.r) >= 0.7
                                      ? "border-green-600 text-green-700"
                                      : Math.abs(c.r) >= 0.5
                                      ? "border-yellow-600 text-yellow-700"
                                      : ""
                                  }
                                >
                                  {t(strengthLabelKey(c.r))}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

        {/* ===== Section 4: Save & History ===== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {t('reports.saveAndHistory')}
            </CardTitle>
            <CardDescription>
              {t('reports.saveAndHistoryDesc')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Save button */}
            <Button
              onClick={handleSave}
              disabled={
                !analysis ||
                analysis.insufficient ||
                saveMutation.isPending
              }
            >
              {saveMutation.isPending ? (
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              {t('reports.saveAnalysis')}
            </Button>

            {/* Saved analyses table */}
            {savedListQuery.isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : !savedListQuery.data || savedListQuery.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t('reports.noSavedAnalyses')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.date')}</TableHead>
                      <TableHead>{t('common.productModel')}</TableHead>
                      <TableHead className="text-right">
                        {t('reports.sampleSize')}
                      </TableHead>
                      <TableHead className="text-right">
                        {t('reports.pointCount')}
                      </TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {savedListQuery.data.map((s: any) => (
                      <TableRow key={s.id}>
                        <TableCell className="whitespace-nowrap text-sm">
                          {s.createdAt
                            ? new Date(s.createdAt).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {s.productModelId ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {s.sampleSize}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm">
                          {s.pointIds?.length ?? 0}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setViewingSaved(s);
                              setHistoryDialogOpen(true);
                            }}
                          >
                            {t('common.view')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ===== Saved Analysis Dialog ===== */}
        <Dialog
          open={historyDialogOpen}
          onOpenChange={setHistoryDialogOpen}
        >
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{t('reports.savedAnalysisDetails')}</DialogTitle>
              <DialogDescription>
                {viewingSaved?.createdAt
                  ? t('reports.savedOn', { date: new Date(
                      viewingSaved.createdAt
                    ).toLocaleString() })
                  : ""}
                {" — "}{t('reports.sampleSize')}: {viewingSaved?.sampleSize ?? "—"}
              </DialogDescription>
            </DialogHeader>

            {viewingSaved?.correlationMatrix &&
            viewingSaved?.pointIds?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1" />
                      {viewingSaved.pointIds.map((id: number) => (
                        <th
                          key={id}
                          className="px-2 py-1 text-center font-mono text-xs"
                          style={{ minWidth: 56 }}
                        >
                          {pointCodeMap[id] ?? id}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {viewingSaved.pointIds.map(
                      (rowId: number, ri: number) => (
                        <tr key={rowId}>
                          <td className="px-2 py-1 font-mono text-xs font-medium whitespace-nowrap">
                            {pointCodeMap[rowId] ?? rowId}
                          </td>
                          {viewingSaved.pointIds.map(
                            (_colId: number, ci: number) => {
                              const r =
                                viewingSaved.correlationMatrix[ri]?.[ci] ?? 0;
                              const isDiag = ri === ci;
                              return (
                                <td
                                  key={ci}
                                  className={`px-2 py-1 text-center font-mono text-xs ${getCellColor(
                                    r,
                                    isDiag
                                  )}`}
                                >
                                  {r.toFixed(3)}
                                </td>
                              );
                            }
                          )}
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('reports.noMatrixData')}
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
