import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ShieldCheck,
  Plus,
  RefreshCw,
  Settings,
  CheckCircle,
  XCircle,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import { toast } from "sonner";

const decisionColors: Record<string, string> = {
  AUTO_OK: "bg-green-500",
  AUTO_NG: "bg-red-500",
  NEEDS_REVIEW: "bg-yellow-500",
  MANUAL: "bg-blue-500",
};

export default function AIQualityGatePage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("configs");
  const [createOpen, setCreateOpen] = useState(false);
  const [filterDecision, setFilterDecision] = useState<string>("all");

  // Form state for new config
  const [form, setForm] = useState({
    name: "",
    modelId: 0,
    autoOkThreshold: 0.95,
    autoNgThreshold: 0.9,
    reviewThreshold: 0.5,
    ngLabels: "NG,DEFECT",
    okLabels: "OK,PASS",
    alertOnAutoNg: true,
  });

  // Queries
  const { data: configs, isLoading: loadingConfigs, refetch: refetchConfigs } =
    trpc.aiQualityGate.listConfigs.useQuery({ limit: 50, offset: 0 });

  const { data: results, isLoading: loadingResults, refetch: refetchResults } =
    trpc.aiQualityGate.listResults.useQuery({
      limit: 50,
      offset: 0,
      ...(filterDecision !== "all" ? { decision: filterDecision as any } : {}),
    });

  const { data: stats } = trpc.aiQualityGate.stats.useQuery({});

  const { data: ensembles } = trpc.aiQualityGate.listEnsembles.useQuery({ limit: 20 });

  const { data: models } = trpc.aiModel.list.useQuery(
    { status: "ACTIVE", limit: 100 },
    { staleTime: 60_000 }
  );

  // Mutations
  const createConfig = trpc.aiQualityGate.createConfig.useMutation({
    onSuccess: () => {
      toast.success(t("qg.configCreated", "Đã tạo cấu hình Quality Gate"));
      setCreateOpen(false);
      refetchConfigs();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteConfig = trpc.aiQualityGate.deleteConfig.useMutation({
    onSuccess: () => {
      toast.success(t("qg.configDeleted", "Đã xóa cấu hình"));
      refetchConfigs();
    },
  });

  const reviewDecision = trpc.aiQualityGate.reviewDecision.useMutation({
    onSuccess: () => {
      toast.success(t("qg.reviewed", "Đã cập nhật quyết định"));
      refetchResults();
    },
  });

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6 p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <ShieldCheck className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">{t("qg.title", "AI Quality Gate")}</h1>
              <p className="text-sm text-muted-foreground">
                {t("qg.subtitle", "Quản lý cổng chất lượng tự động - Tự động phân loại OK/NG/Cần đánh giá")}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { refetchConfigs(); refetchResults(); }}>
              <RefreshCw className="h-4 w-4 mr-1.5" />
              {t("common.refresh", "Làm mới")}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t("qg.createConfig", "Tạo cấu hình")}
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm text-muted-foreground">{t("qg.autoOk", "Auto OK")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.autoOk ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm text-muted-foreground">{t("qg.autoNg", "Auto NG")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.autoNg ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <span className="text-sm text-muted-foreground">{t("qg.needsReview", "Cần đánh giá")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.needsReview ?? 0}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-muted-foreground">{t("qg.total", "Tổng cộng")}</span>
                </div>
                <p className="text-2xl font-bold mt-1">{stats.total ?? 0}</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="configs">
              <Settings className="h-4 w-4 mr-1.5" />
              {t("qg.configs", "Cấu hình")}
            </TabsTrigger>
            <TabsTrigger value="results">
              <BarChart3 className="h-4 w-4 mr-1.5" />
              {t("qg.results", "Kết quả")}
            </TabsTrigger>
            <TabsTrigger value="ensembles">
              <ShieldCheck className="h-4 w-4 mr-1.5" />
              {t("qg.ensembles", "Ensemble")}
            </TabsTrigger>
          </TabsList>

          {/* Configs Tab */}
          <TabsContent value="configs">
            <Card>
              <CardContent className="p-0">
                {loadingConfigs ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("qg.name", "Tên")}</TableHead>
                        <TableHead>{t("qg.thresholds", "Ngưỡng")}</TableHead>
                        <TableHead>{t("qg.labels", "Nhãn")}</TableHead>
                        <TableHead>{t("qg.enabled", "Kích hoạt")}</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {configs?.map((cfg: any) => (
                        <TableRow key={cfg.id}>
                          <TableCell className="font-medium">{cfg.name}</TableCell>
                          <TableCell>
                            <div className="flex gap-1.5 text-xs">
                              <Badge variant="outline" className="text-green-600">OK≥{cfg.autoOkThreshold}</Badge>
                              <Badge variant="outline" className="text-red-600">NG≥{cfg.autoNgThreshold}</Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {cfg.ngLabels?.join(", ")}
                          </TableCell>
                          <TableCell>
                            <Badge variant={cfg.enabled !== false ? "default" : "secondary"}>
                              {cfg.enabled !== false ? "ON" : "OFF"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => deleteConfig.mutate({ id: cfg.id })}
                            >
                              {t("common.delete", "Xóa")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!configs || configs.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            {t("qg.noConfigs", "Chưa có cấu hình Quality Gate")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Results Tab */}
          <TabsContent value="results">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <Select value={filterDecision} onValueChange={setFilterDecision}>
                    <SelectTrigger className="w-48">
                      <SelectValue placeholder={t("qg.filterDecision", "Lọc theo quyết định")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t("common.all", "Tất cả")}</SelectItem>
                      <SelectItem value="AUTO_OK">Auto OK</SelectItem>
                      <SelectItem value="AUTO_NG">Auto NG</SelectItem>
                      <SelectItem value="NEEDS_REVIEW">Needs Review</SelectItem>
                      <SelectItem value="MANUAL">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingResults ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>{t("qg.decision", "Quyết định")}</TableHead>
                        <TableHead>{t("qg.confidence", "Độ tin cậy")}</TableHead>
                        <TableHead>{t("qg.review", "Đánh giá")}</TableHead>
                        <TableHead className="w-32" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {results?.map((r: any) => (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                          <TableCell>
                            <Badge className={decisionColors[r.decision] || "bg-gray-500"}>
                              {r.decision}
                            </Badge>
                          </TableCell>
                          <TableCell>{((r.confidence ?? 0) * 100).toFixed(1)}%</TableCell>
                          <TableCell>
                            {r.reviewDecision ? (
                              <Badge variant="outline">{r.reviewDecision}</Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {r.decision === "NEEDS_REVIEW" && !r.reviewDecision && (
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-green-600 h-7 text-xs"
                                  onClick={() => reviewDecision.mutate({ resultId: r.id, reviewDecision: "OK" })}
                                >
                                  OK
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-red-600 h-7 text-xs"
                                  onClick={() => reviewDecision.mutate({ resultId: r.id, reviewDecision: "NG" })}
                                >
                                  NG
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {(!results || results.length === 0) && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                            {t("qg.noResults", "Chưa có kết quả Quality Gate")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Ensembles Tab */}
          <TabsContent value="ensembles">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("qg.name", "Tên")}</TableHead>
                      <TableHead>{t("qg.strategy", "Chiến lược")}</TableHead>
                      <TableHead>{t("qg.models", "Số mô hình")}</TableHead>
                      <TableHead>{t("qg.enabled", "Kích hoạt")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ensembles?.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell><Badge variant="outline">{e.strategy}</Badge></TableCell>
                        <TableCell>{e.modelIds?.length ?? 0}</TableCell>
                        <TableCell>
                          <Badge variant={e.enabled ? "default" : "secondary"}>
                            {e.enabled ? "ON" : "OFF"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                    {(!ensembles || ensembles.length === 0) && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                          {t("qg.noEnsembles", "Chưa có cấu hình Ensemble")}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Create Config Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("qg.createConfig", "Tạo cấu hình Quality Gate")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>{t("qg.configName", "Tên cấu hình")}</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Production Line 1 QG"
                />
              </div>
              <div className="grid gap-2">
                <Label>{t("qg.selectModel", "Chọn mô hình AI")}</Label>
                <Select
                  value={form.modelId ? String(form.modelId) : ""}
                  onValueChange={(v) => setForm({ ...form, modelId: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("qg.selectModelPlaceholder", "Chọn mô hình...")} />
                  </SelectTrigger>
                  <SelectContent>
                    {models?.map((m: any) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">Auto OK ≥</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.autoOkThreshold}
                    onChange={(e) => setForm({ ...form, autoOkThreshold: parseFloat(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Auto NG ≥</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.autoNgThreshold}
                    onChange={(e) => setForm({ ...form, autoNgThreshold: parseFloat(e.target.value) })}
                  />
                </div>
                <div>
                  <Label className="text-xs">Review ≥</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    value={form.reviewThreshold}
                    onChange={(e) => setForm({ ...form, reviewThreshold: parseFloat(e.target.value) })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("qg.ngLabels", "Nhãn NG (phẩy phân cách)")}</Label>
                  <Input
                    value={form.ngLabels}
                    onChange={(e) => setForm({ ...form, ngLabels: e.target.value })}
                  />
                </div>
                <div>
                  <Label className="text-xs">{t("qg.okLabels", "Nhãn OK (phẩy phân cách)")}</Label>
                  <Input
                    value={form.okLabels}
                    onChange={(e) => setForm({ ...form, okLabels: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.alertOnAutoNg}
                  onCheckedChange={(c) => setForm({ ...form, alertOnAutoNg: c })}
                />
                <Label className="text-sm">{t("qg.alertOnNg", "Cảnh báo khi Auto NG")}</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                {t("common.cancel", "Hủy")}
              </Button>
              <Button
                onClick={() => {
                  if (!form.name || !form.modelId) {
                    toast.error(t("qg.fillRequired", "Vui lòng điền đầy đủ thông tin"));
                    return;
                  }
                  createConfig.mutate({
                    name: form.name,
                    modelId: form.modelId,
                    autoOkThreshold: form.autoOkThreshold,
                    autoNgThreshold: form.autoNgThreshold,
                    reviewThreshold: form.reviewThreshold,
                    ngLabels: form.ngLabels.split(",").map((s) => s.trim()),
                    okLabels: form.okLabels.split(",").map((s) => s.trim()),
                    alertOnAutoNg: form.alertOnAutoNg,
                  });
                }}
                disabled={createConfig.isPending}
              >
                {t("common.create", "Tạo")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
