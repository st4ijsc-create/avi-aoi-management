import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Beaker,
  Plus,
  RefreshCw,
  PlayCircle,
  CheckCircle2,
  BarChart3,
  TrendingUp,
  TrendingDown,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline",
  RUNNING: "default",
  COMPLETED: "secondary",
  CONCLUDED: "secondary",
  CANCELLED: "destructive",
};

export default function ABTestingPage() {
  const { t } = useTranslation();

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedExpId, setSelectedExpId] = useState<number | null>(null);

  // Form state for creating an experiment
  const [form, setForm] = useState({
    name: "",
    description: "",
    modelAId: "",
    modelAVersion: "",
    modelBId: "",
    modelBVersion: "",
    trafficSplitPercent: "50",
  });

  // ── Queries ────────────────────────────────────────────────
  const { data: experiments, isLoading, refetch } = trpc.aiAdvanced.abTest.list.useQuery(
    { limit: 50 },
    { refetchInterval: 8000 },
  );

  const { data: models } = trpc.aiModel.list.useQuery(
    { status: "ACTIVE", limit: 100 },
    { staleTime: 60_000 },
  );

  const { data: stats, isLoading: statsLoading } = trpc.aiAdvanced.abTest.stats.useQuery(
    { experimentId: selectedExpId! },
    { enabled: selectedExpId !== null, refetchInterval: 5000 },
  );

  // ── Mutations ──────────────────────────────────────────────
  const createMutation = trpc.aiAdvanced.abTest.create.useMutation({
    onSuccess: () => {
      toast.success(t("ab.created", "Experiment created"));
      setCreateOpen(false);
      setForm({ name: "", description: "", modelAId: "", modelAVersion: "", modelBId: "", modelBVersion: "", trafficSplitPercent: "50" });
      refetch();
    },
    onError: (err) => toast.error(err.message),
  });

  const startMutation = trpc.aiAdvanced.abTest.start.useMutation({
    onSuccess: () => { toast.success(t("ab.started", "Experiment started")); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  const concludeMutation = trpc.aiAdvanced.abTest.conclude.useMutation({
    onSuccess: () => { toast.success(t("ab.concluded", "Experiment concluded")); refetch(); },
    onError: (err) => toast.error(err.message),
  });

  // ── Helpers ────────────────────────────────────────────────
  const formField = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(prev => ({ ...prev, [key]: e.target.value })),
  });

  function handleCreate() {
    createMutation.mutate({
      name: form.name,
      description: form.description || undefined,
      modelAId: Number(form.modelAId),
      modelAVersion: form.modelAVersion,
      modelBId: Number(form.modelBId),
      modelBVersion: form.modelBVersion,
      trafficSplitPercent: Number(form.trafficSplitPercent),
    });
  }

  const selectedExp = experiments?.find((e: any) => e.id === selectedExpId) ?? null;

  // Compute win indicator per group from stats
  const aAcc = stats?.modelA?.accuracy ?? 0;
  const bAcc = stats?.modelB?.accuracy ?? 0;
  const aDiff = aAcc - bAcc;

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Beaker className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">{t("ab.title", "A/B Model Testing")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("ab.subtitle", "Compare two AI model versions head-to-head on live inference")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" />
              {t("common.refresh", "Refresh")}
            </Button>

            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" />
                  {t("ab.newExperiment", "New Experiment")}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t("ab.createTitle", "Create A/B Experiment")}</DialogTitle>
                  <DialogDescription>
                    {t("ab.createDesc", "Traffic will be split between model A and model B automatically.")}
                  </DialogDescription>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                  <div>
                    <Label>{t("ab.expName", "Experiment Name")}</Label>
                    <Input placeholder={t("ab.expNamePlaceholder", "e.g. v1 vs v2 accuracy test")} {...formField("name")} />
                  </div>
                  <div>
                    <Label>{t("ab.description", "Description (optional)")}</Label>
                    <Input placeholder="" {...formField("description")} />
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t("ab.modelA", "Model A")}</Label>
                      <select
                        className="border rounded px-3 py-2 text-sm w-full bg-background"
                        {...formField("modelAId")}
                      >
                        <option value="">—</option>
                        {models?.map((m) => (
                          <option key={m.id} value={m.id}>{m.code}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>{t("ab.versionA", "Version A")}</Label>
                      <Input placeholder="1.0.0" {...formField("modelAVersion")} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>{t("ab.modelB", "Model B")}</Label>
                      <select
                        className="border rounded px-3 py-2 text-sm w-full bg-background"
                        {...formField("modelBId")}
                      >
                        <option value="">—</option>
                        {models?.map((m) => (
                          <option key={m.id} value={m.id}>{m.code}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>{t("ab.versionB", "Version B")}</Label>
                      <Input placeholder="2.0.0" {...formField("modelBVersion")} />
                    </div>
                  </div>

                  <div>
                    <Label>{t("ab.trafficSplit", "Traffic sent to Model B (%)")}</Label>
                    <Input type="number" min={1} max={99} {...formField("trafficSplitPercent")} />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    {t("common.cancel", "Cancel")}
                  </Button>
                  <Button
                    onClick={handleCreate}
                    disabled={
                      !form.name || !form.modelAId || !form.modelAVersion ||
                      !form.modelBId || !form.modelBVersion || createMutation.isPending
                    }
                  >
                    {createMutation.isPending ? t("common.creating", "Creating…") : t("common.create", "Create")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Experiments list */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("ab.experiments", "Experiments")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {isLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                  </div>
                ) : !experiments?.length ? (
                  <p className="p-6 text-center text-muted-foreground text-sm">
                    {t("ab.noExp", "No experiments yet.")}
                  </p>
                ) : (
                  <div className="divide-y">
                    {experiments.map((exp: any) => (
                      <button
                        key={exp.id}
                        className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${selectedExpId === exp.id ? "bg-muted/50" : ""}`}
                        onClick={() => setSelectedExpId(exp.id)}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm truncate">{exp.name}</span>
                          <Badge variant={statusVariant[exp.status] ?? "outline"} className="ml-2 text-xs">
                            {exp.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {exp.createdAt ? format(new Date(exp.createdAt), "yyyy-MM-dd") : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Experiment detail */}
          <div className="lg:col-span-2">
            {!selectedExp ? (
              <Card className="flex items-center justify-center h-64">
                <p className="text-sm text-muted-foreground">{t("ab.selectHint", "Select an experiment to view details")}</p>
              </Card>
            ) : (
              <Tabs defaultValue="overview">
                <div className="flex items-center justify-between mb-3">
                  <TabsList>
                    <TabsTrigger value="overview">{t("ab.overview", "Overview")}</TabsTrigger>
                    <TabsTrigger value="stats">{t("ab.stats", "Statistics")}</TabsTrigger>
                  </TabsList>
                  <div className="flex gap-2">
                    {selectedExp.status === "DRAFT" && (
                      <Button
                        size="sm"
                        onClick={() => startMutation.mutate({ id: selectedExp.id })}
                        disabled={startMutation.isPending}
                      >
                        <PlayCircle className="h-4 w-4 mr-1" />
                        {t("ab.start", "Start")}
                      </Button>
                    )}
                    {selectedExp.status === "RUNNING" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => concludeMutation.mutate({ id: selectedExp.id })}
                        disabled={concludeMutation.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-1" />
                        {t("ab.conclude", "Conclude")}
                      </Button>
                    )}
                  </div>
                </div>

                <TabsContent value="overview">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">{selectedExp.name}</CardTitle>
                      {selectedExp.description && (
                        <CardDescription>{selectedExp.description}</CardDescription>
                      )}
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableBody>
                          <TableRow>
                            <TableHead className="w-40">{t("ab.status", "Status")}</TableHead>
                            <TableCell>
                              <Badge variant={statusVariant[selectedExp.status] ?? "outline"}>
                                {selectedExp.status}
                              </Badge>
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead>{t("ab.modelA", "Model A")}</TableHead>
                            <TableCell>ID {selectedExp.modelAId} — v{selectedExp.modelAVersion}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead>{t("ab.modelB", "Model B")}</TableHead>
                            <TableCell>ID {selectedExp.modelBId} — v{selectedExp.modelBVersion}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead>{t("ab.trafficSplit", "Traffic Split")}</TableHead>
                            <TableCell>
                              A: {100 - (selectedExp.trafficSplitPercent ?? 50)}% / B: {selectedExp.trafficSplitPercent ?? 50}%
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableHead>{t("common.created", "Created")}</TableHead>
                            <TableCell>
                              {selectedExp.createdAt ? format(new Date(selectedExp.createdAt), "yyyy-MM-dd HH:mm") : "—"}
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="stats">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <BarChart3 className="h-4 w-4" />
                        {t("ab.liveStats", "Live Performance Comparison")}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      {statsLoading ? (
                        <div className="space-y-2">
                          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                        </div>
                      ) : !stats ? (
                        <p className="text-sm text-muted-foreground text-center py-6">
                          {t("ab.noStats", "No inference results yet. Run the experiment to collect statistics.")}
                        </p>
                      ) : (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("ab.metric", "Metric")}</TableHead>
                              <TableHead className="text-right">{t("ab.modelALabel", "Model A")}</TableHead>
                              <TableHead className="text-right">{t("ab.modelBLabel", "Model B")}</TableHead>
                              <TableHead className="text-right">{t("ab.delta", "Δ")}</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {[
                              { key: "accuracy",  label: t("ab.accuracy", "Accuracy"),   fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
                              { key: "avgConfidence", label: t("ab.avgConf", "Avg Confidence"), fmt: (v: number) => `${(v * 100).toFixed(1)}%` },
                              { key: "totalInferences", label: t("ab.totalInf", "Total Inferences"), fmt: (v: number) => v.toLocaleString() },
                              { key: "avgLatencyMs", label: t("ab.latency", "Avg Latency (ms)"),  fmt: (v: number) => `${v.toFixed(0)} ms` },
                            ].map(({ key, label, fmt }) => {
                              const aVal = (stats.modelA as any)?.[key] ?? 0;
                              const bVal = (stats.modelB as any)?.[key] ?? 0;
                              const delta = bVal - aVal;
                              const isGoodMetric = key === "accuracy" || key === "avgConfidence";
                              const bWins = isGoodMetric ? delta > 0 : delta < 0;
                              return (
                                <TableRow key={key}>
                                  <TableCell className="text-muted-foreground">{label}</TableCell>
                                  <TableCell className="text-right font-mono">{fmt(aVal)}</TableCell>
                                  <TableCell className="text-right font-mono">{fmt(bVal)}</TableCell>
                                  <TableCell className="text-right">
                                    <span className={`flex items-center justify-end gap-1 font-mono text-xs ${bWins ? "text-green-600" : delta !== 0 ? "text-red-500" : "text-muted-foreground"}`}>
                                      {delta > 0 ? <TrendingUp className="h-3 w-3" /> : delta < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                                      {delta > 0 ? "+" : ""}{fmt(delta)}
                                    </span>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      )}

                      {stats && (
                        <div className={`mt-4 rounded-md p-3 text-sm flex items-center gap-2 ${aDiff > 0.02 ? "bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300" : aDiff < -0.02 ? "bg-green-50 dark:bg-green-950 text-green-700 dark:text-green-300" : "bg-muted text-muted-foreground"}`}>
                          {aDiff > 0.02 && <><TrendingUp className="h-4 w-4" /> {t("ab.recommendA", "Model A is performing better — consider making it the primary model.")}</>}
                          {aDiff < -0.02 && <><TrendingUp className="h-4 w-4" /> {t("ab.recommendB", "Model B is performing better — consider promoting it to production.")}</>}
                          {Math.abs(aDiff) <= 0.02 && t("ab.noSignificantDiff", "Performance difference is not yet statistically significant.")}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
