/**
 * AOI Image Packages - Traceability Screen
 * Quản lý upload ảnh AOI: tra cứu, xem ảnh, tải ZIP
 */
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader } from "@/components/patterns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Link } from "wouter";
import { format } from "date-fns";
import { PACKAGE_STATUS_BADGE_VARIANTS, PACKAGE_STATUS_FILTER_OPTIONS } from "./aoiPackagesStatusPresentation";
import { locIngestLienQuan } from "./ingestIntegrityScanPresentation";
import {
  Package,
  Search,
  Download,
  Eye,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  HardDrive,
  Activity,
  BarChart3,
  Camera,
  RefreshCcw,
  ChevronLeft,
  ChevronRight,
  Filter,
  FileArchive,
  Cpu,
  ScrollText,
  Info,
  AlertCircle,
  ArrowUpCircle,
  ArrowDownCircle,
  Timer,
  User,
  Globe,
  Skull,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";

// ============================================================
// Status badge helper
// ============================================================
function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  // Lô 4 Mục 2 (BG-74) — bảng biến thể RÚT RA `aoiPackagesStatusPresentation.ts`
  // (logic thuần, test được không cần hạ tầng render-test) — bao gồm 'dead',
  // trước bản vá rơi vào fallback xám nhạt bên dưới, thấp hơn cả `failed`.
  const v = PACKAGE_STATUS_BADGE_VARIANTS[status] || { labelKey: "", className: "bg-muted text-muted-foreground" };
  return <Badge className={v.className}>{v.labelKey ? t(v.labelKey) : status}</Badge>;
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <Badge variant="outline">N/A</Badge>;
  if (result === "OK") return <Badge className="bg-success/15 text-success border-success/30">OK</Badge>;
  if (result === "NG") return <Badge className="bg-destructive/15 text-destructive border-destructive/30">NG</Badge>;
  return <Badge className="bg-warning/15 text-warning border-warning/30">{result}</Badge>;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ============================================================
// Main Page Component
// ============================================================
export default function AOIPackages() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("packages");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [searchSerial, setSearchSerial] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterResult, setFilterResult] = useState<string>("all");
  const [filterMachineCode, setFilterMachineCode] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [viewImageDialog, setViewImageDialog] = useState<{ packageId: string; pointCode: string; fileName: string } | null>(null);
  const [detailTab, setDetailTab] = useState<string>("info");
  // Lô 4 Mục 3 (BG-36) — tab dead-letter + integrityScan.
  const [deadLetterPage, setDeadLetterPage] = useState(0);
  const [deadLetterPageSize] = useState(20);
  const [selectedDeadLetterKey, setSelectedDeadLetterKey] = useState<string | null>(null);

  // Queries
  const packagesQuery = trpc.aoiPackage.listPackages.useQuery({
    page,
    pageSize,
    serialNumber: searchSerial || undefined,
    status: filterStatus !== "all" ? (filterStatus as any) : undefined,
    overallResult: filterResult !== "all" ? (filterResult as any) : undefined,
    machineCode: filterMachineCode || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const statsQuery = trpc.aoiPackage.getUploadStats.useQuery({});
  const queueQuery = trpc.aoiPackage.getQueueStatus.useQuery({});

  // Lô 4 Mục 3 (BG-36) — dead-letter WAL (phạm vi ĐỌC-only) + integrityScan gần nhất.
  const deadLettersQuery = trpc.aoiPackage.listDeadLetters.useQuery(
    { offset: deadLetterPage * deadLetterPageSize, limit: deadLetterPageSize },
    { enabled: activeTab === "deadLetter" }
  );
  const deadLetterDetailQuery = trpc.aoiPackage.getDeadLetterDetail.useQuery(
    { key: selectedDeadLetterKey! },
    { enabled: !!selectedDeadLetterKey }
  );
  const integrityScanQuery = trpc.integrity.summary.useQuery(undefined, {
    enabled: activeTab === "deadLetter",
  });
  const ingestIntegrityRelationships = useMemo(
    () => locIngestLienQuan(integrityScanQuery.data?.relationships ?? []),
    [integrityScanQuery.data],
  );
  const runIntegrityScanMutation = trpc.integrity.runNow.useMutation({
    onSuccess: () => {
      toast.success(t('packages.integrityScanRunSuccess'));
      integrityScanQuery.refetch();
    },
    onError: (err) => {
      toast.error(err.message || t('packages.integrityScanRunError'));
    },
  });

  const packageDetailQuery = trpc.aoiPackage.getPackage.useQuery(
    { packageId: selectedPackageId! },
    { enabled: !!selectedPackageId }
  );

  const logsQuery = trpc.aoiPackage.getPackageLogs.useQuery(
    { packageId: selectedPackageId! },
    { enabled: !!selectedPackageId && detailTab === "logs" }
  );

  const imageQuery = trpc.aoiPackage.getImage.useQuery(
    {
      packageId: viewImageDialog?.packageId || "",
      pointCode: viewImageDialog?.pointCode,
      fileName: viewImageDialog?.fileName,
    },
    { enabled: !!viewImageDialog }
  );

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Header */}
        <PageHeader
          icon={<Camera className="h-6 w-6" />}
          title={t('packages.title')}
          description={t('packages.description')}
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                packagesQuery.refetch();
                statsQuery.refetch();
                queueQuery.refetch();
              }}
            >
              <RefreshCcw className="h-4 w-4 mr-2" />
              {t('common.refresh')}
            </Button>
          }
        />

        {/* Stats Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Package className="h-8 w-8 text-info" />
                <div>
                  <p className="text-sm text-muted-foreground">{t('packages.totalPackages')}</p>
                  <p className="text-2xl font-bold">{statsQuery.data?.summary?.total || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-8 w-8 text-success" />
                <div>
                  <p className="text-sm text-muted-foreground">{t('packages.committedCount')}</p>
                  <p className="text-2xl font-bold">{statsQuery.data?.summary?.committed || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <XCircle className="h-8 w-8 text-destructive" />
                <div>
                  <p className="text-sm text-muted-foreground">{t('packages.failedCount')}</p>
                  <p className="text-2xl font-bold">{statsQuery.data?.summary?.failed || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <ImageIcon className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">{t('packages.totalImages')}</p>
                  <p className="text-2xl font-bold">{statsQuery.data?.summary?.totalImages || 0}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <HardDrive className="h-8 w-8 text-warning" />
                <div>
                  <p className="text-sm text-muted-foreground">{t('packages.totalSize')}</p>
                  <p className="text-2xl font-bold">{formatBytes(statsQuery.data?.summary?.totalSize || 0)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="packages" className="gap-2">
              <Package className="h-4 w-4" /> {t('packages.packagesTab')}
            </TabsTrigger>
            <TabsTrigger value="queue" className="gap-2">
              <Activity className="h-4 w-4" /> {t('packages.uploadQueueTab')}
            </TabsTrigger>
            <TabsTrigger value="stats" className="gap-2">
              <BarChart3 className="h-4 w-4" /> {t('packages.statisticsTab')}
            </TabsTrigger>
            <TabsTrigger value="deadLetter" className="gap-2">
              <Skull className="h-4 w-4" /> {t('packages.deadLetterTab')}
              {(deadLettersQuery.data?.total ?? 0) > 0 && (
                <Badge className="ml-1 bg-destructive text-destructive-foreground border-destructive px-1.5 py-0 text-[10px]">
                  {deadLettersQuery.data?.total}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab: Packages List */}
          <TabsContent value="packages" className="space-y-4">
            {/* Filters */}
            <Card>
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-50">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">Serial Number</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        aria-label="Serial Number"
                        placeholder={t('packages.searchBySerial')}
                        className="pl-10"
                        value={searchSerial}
                        onChange={(e) => { setSearchSerial(e.target.value); setPage(1); }}
                      />
                    </div>
                  </div>
                  <div className="min-w-32.5">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packages.machineCode')}</label>
                    <Input
                      aria-label={t('packages.machineCode')}
                      placeholder={t('packages.machineCodePlaceholder')}
                      value={filterMachineCode}
                      onChange={(e) => { setFilterMachineCode(e.target.value); setPage(1); }}
                    />
                  </div>
                  <div className="min-w-32.5">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('common.status')}</label>
                    <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(1); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        {/* Lô 4 Mục 2 (BG-74) — danh sách RÚT RA `aoiPackagesStatusPresentation.ts`,
                            nối `listPackages` (Mục 1, enum input đã mở rộng đủ 6 giá trị kể cả 'dead'). */}
                        {PACKAGE_STATUS_FILTER_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{t(opt.labelKey)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-30">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packages.result')}</label>
                    <Select value={filterResult} onValueChange={(v) => { setFilterResult(v); setPage(1); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all')}</SelectItem>
                        <SelectItem value="OK">OK</SelectItem>
                        <SelectItem value="NG">NG</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="min-w-35">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packages.fromDate')}</label>
                    <Input type="date" aria-label={t('packages.fromDate')} value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
                  </div>
                  <div className="min-w-35">
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t('packages.toDate')}</label>
                    <Input type="date" aria-label={t('packages.toDate')} value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-3 font-medium">Package ID</th>
                        <th className="text-left p-3 font-medium">Serial Number</th>
                        <th className="text-left p-3 font-medium">Product Model</th>
                        <th className="text-left p-3 font-medium">Machine</th>
                        <th className="text-left p-3 font-medium">{t('packages.result')}</th>
                        <th className="text-center p-3 font-medium">{t('packages.images')}</th>
                        <th className="text-right p-3 font-medium">{t('packages.fileSize')}</th>
                        <th className="text-left p-3 font-medium">{t('common.status')}</th>
                        <th className="text-left p-3 font-medium">{t('packages.time')}</th>
                        <th className="text-center p-3 font-medium">{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {packagesQuery.isLoading ? (
                        <tr><td colSpan={10} className="text-center p-8 text-muted-foreground">{t('common.loading')}</td></tr>
                      ) : packagesQuery.data?.data.length === 0 ? (
                        <tr><td colSpan={10} className="text-center p-8 text-muted-foreground">{t('packages.noData')}</td></tr>
                      ) : (
                        packagesQuery.data?.data.map((pkg) => (
                          <tr
                            key={pkg.id}
                            className="border-b hover:bg-muted/30 cursor-pointer transition-colors"
                            onClick={() => setSelectedPackageId(pkg.packageId)}
                          >
                            <td className="p-3">
                              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                                {pkg.packageId.length > 16 ? `${pkg.packageId.slice(0, 16)}...` : pkg.packageId}
                              </code>
                            </td>
                            <td className="p-3 font-medium">{pkg.serialNumber || "—"}</td>
                            <td className="p-3">{pkg.productModel || "—"}</td>
                            <td className="p-3">
                              <Badge variant="outline" className="font-mono text-xs">
                                <Cpu className="h-3 w-3 mr-1" />
                                {pkg.machineCode || "—"}
                              </Badge>
                            </td>
                            <td className="p-3"><ResultBadge result={pkg.overallResult} /></td>
                            <td className="p-3 text-center">
                              <span className="text-xs">
                                {pkg.imageCount || 0}
                                {pkg.ngCount && pkg.ngCount > 0 ? (
                                  <span className="text-destructive ml-1">({pkg.ngCount} NG)</span>
                                ) : null}
                              </span>
                            </td>
                            <td className="p-3 text-right text-xs">{formatBytes(pkg.fileSizeBytes)}</td>
                            <td className="p-3"><StatusBadge status={pkg.status} /></td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {pkg.inspectionTime
                                ? format(new Date(pkg.inspectionTime), "dd/MM/yyyy HH:mm")
                                : pkg.createdAt
                                  ? format(new Date(pkg.createdAt), "dd/MM/yyyy HH:mm")
                                  : "—"}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center gap-1 justify-center" onClick={(e) => e.stopPropagation()}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedPackageId(pkg.packageId)}
                                  title={t('packages.viewDetail')}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {pkg.status === "committed" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      window.open(`/api/aoi/download/${pkg.packageId}`, "_blank");
                                    }}
                                    title={t('packages.downloadZip')}
                                  >
                                    <Download className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {packagesQuery.data && packagesQuery.data.totalPages > 1 && (
                  <div className="flex items-center justify-between p-3 border-t">
                    <span className="text-sm text-muted-foreground">
                      {t('packages.pagination', { page, totalPages: packagesQuery.data.totalPages, total: packagesQuery.data.total })}
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t('common.previous', 'Previous')}
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                      >
                        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={t('common.next', 'Next')}
                        disabled={page >= packagesQuery.data.totalPages}
                        onClick={() => setPage(page + 1)}
                      >
                        <ChevronRight aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Upload Queue Status */}
          <TabsContent value="queue" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  {t('packages.uploadQueueTitle')}
                </CardTitle>
                <CardDescription>
                  {t('packages.uploadQueueDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {queueQuery.isLoading ? (
                  <p className="text-center text-muted-foreground py-8">{t('common.loading')}</p>
                ) : !queueQuery.data || queueQuery.data.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Activity className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>{t('packages.noAgentData')}</p>
                    <p className="text-xs mt-1">{t('packages.agentMetricsHint')}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {queueQuery.data.map((metric, i) => (
                      <Card key={i} className="border-l-4 border-l-info">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="font-mono">
                              Machine #{metric.machineId}
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {metric.recordedAt ? format(new Date(metric.recordedAt), "HH:mm:ss") : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div className="flex items-center gap-2">
                              <Clock className="h-4 w-4 text-warning" />
                              <span>Queued: <strong>{metric.queuedCount}</strong></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Activity className="h-4 w-4 text-info" />
                              <span>Uploading: <strong>{metric.uploadingCount}</strong></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="h-4 w-4 text-success" />
                              <span>Done: <strong>{metric.completedCount}</strong></span>
                            </div>
                            <div className="flex items-center gap-2">
                              <XCircle className="h-4 w-4 text-destructive" />
                              <span>Failed: <strong>{metric.failedCount}</strong></span>
                            </div>
                          </div>
                          {metric.diskUsedBytes != null && metric.diskFreeBytes != null && (
                            <div className="text-xs text-muted-foreground">
                              <HardDrive className="h-3 w-3 inline mr-1" />
                              Disk: {formatBytes(metric.diskUsedBytes)} / {formatBytes((metric.diskUsedBytes || 0) + (metric.diskFreeBytes || 0))}
                              {metric.diskFreeBytes != null && metric.diskUsedBytes != null && (
                                <div className="mt-1 h-2 bg-muted rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      metric.diskUsedBytes / ((metric.diskUsedBytes || 1) + (metric.diskFreeBytes || 1)) > 0.85
                                        ? "bg-destructive"
                                        : "bg-info"
                                    }`}
                                    style={{
                                      width: `${Math.min(100, (metric.diskUsedBytes / ((metric.diskUsedBytes || 1) + (metric.diskFreeBytes || 1))) * 100)}%`,
                                    }}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                          {metric.avgUploadLatencyMs && (
                            <div className="text-xs text-muted-foreground">
                              Avg latency: {metric.avgUploadLatencyMs}ms
                            </div>
                          )}
                          {metric.lastErrorMessage && (
                            <div className="text-xs text-destructive flex items-start gap-1">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              {metric.lastErrorMessage}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Statistics */}
          <TabsContent value="stats" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {t('packages.uploadStatsByMachine')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {statsQuery.isLoading ? (
                  <p className="text-center text-muted-foreground py-8">{t('common.loading')}</p>
                ) : !statsQuery.data?.perMachine || statsQuery.data.perMachine.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">{t('packages.noData')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">Machine</th>
                          <th className="text-right p-3 font-medium">{t('packages.total')}</th>
                          <th className="text-right p-3 font-medium">{t('packages.committedCount')}</th>
                          <th className="text-right p-3 font-medium">{t('packages.failedCount')}</th>
                          <th className="text-right p-3 font-medium">{t('packages.successRate')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statsQuery.data.perMachine.map((m, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-3">
                              <Badge variant="outline" className="font-mono">
                                {m.machineCode || `#${m.machineId}`}
                              </Badge>
                            </td>
                            <td className="p-3 text-right font-medium">{m.total}</td>
                            <td className="p-3 text-right text-success">{m.committed}</td>
                            <td className="p-3 text-right text-destructive">{m.failed}</td>
                            <td className="p-3 text-right">
                              {m.total > 0
                                ? `${((m.committed / m.total) * 100).toFixed(1)}%`
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Dead-letter (BG-36) + integrityScan (BG-36) — Lô 4 Mục 3 */}
          <TabsContent value="deadLetter" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Skull className="h-5 w-5 text-destructive" />
                  {t('packages.deadLetterTitle')}
                </CardTitle>
                <CardDescription>{t('packages.deadLetterDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {deadLettersQuery.isLoading ? (
                  <p className="text-center text-muted-foreground py-8">{t('common.loading')}</p>
                ) : !deadLettersQuery.data || deadLettersQuery.data.total === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <ShieldCheck className="h-12 w-12 mx-auto mb-3 opacity-30 text-success" />
                    <p>{t('packages.deadLetterEmpty')}</p>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 text-sm text-muted-foreground">
                      {t('packages.deadLetterSummary', {
                        total: deadLettersQuery.data.total,
                        totalSize: formatBytes(deadLettersQuery.data.totalBytes),
                      })}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-muted/50">
                            <th className="text-left p-3 font-medium">{t('packages.time')}</th>
                            <th className="text-left p-3 font-medium">{t('packages.machineCode')}</th>
                            <th className="text-left p-3 font-medium">Serial Number</th>
                            <th className="text-left p-3 font-medium">{t('packages.deadLetterReason')}</th>
                            <th className="text-center p-3 font-medium">{t('packages.deadLetterAttempts')}</th>
                            <th className="text-center p-3 font-medium">{t('common.actions')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deadLettersQuery.data.entries.map((e) => (
                            <tr key={e.key} className="border-b hover:bg-muted/30">
                              <td className="p-3 text-xs text-muted-foreground">
                                {e.deadAt ? format(new Date(e.deadAt), "dd/MM/yyyy HH:mm:ss") : "—"}
                              </td>
                              <td className="p-3">
                                <Badge variant="outline" className="font-mono text-xs">
                                  <Cpu className="h-3 w-3 mr-1" />
                                  {e.machineCode || "—"}
                                </Badge>
                              </td>
                              <td className="p-3 font-medium">{e.serialNumber || "—"}</td>
                              <td className="p-3 text-xs max-w-80 truncate" title={e.error}>{e.error}</td>
                              <td className="p-3 text-center">{e.attempts}</td>
                              <td className="p-3 text-center">
                                <Button variant="ghost" size="sm" onClick={() => setSelectedDeadLetterKey(e.key)} title={t('packages.viewDetail')}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between p-3 border-t">
                      <span className="text-sm text-muted-foreground">
                        {t('packages.pagination', {
                          page: deadLetterPage + 1,
                          totalPages: Math.max(1, Math.ceil(deadLettersQuery.data.total / deadLetterPageSize)),
                          total: deadLettersQuery.data.total,
                        })}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('common.previous', 'Previous')}
                          disabled={deadLetterPage <= 0}
                          onClick={() => setDeadLetterPage((p) => Math.max(0, p - 1))}
                        >
                          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={t('common.next', 'Next')}
                          disabled={(deadLetterPage + 1) * deadLetterPageSize >= deadLettersQuery.data.total}
                          onClick={() => setDeadLetterPage((p) => p + 1)}
                        >
                          <ChevronRight aria-hidden="true" className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Panel: integrityScan (BG-36) — quan hệ liên quan ingest, đọc từ integrity.summary có sẵn */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5" />
                  {t('packages.integrityScanTitle')}
                </CardTitle>
                <CardDescription>{t('packages.integrityScanDesc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={runIntegrityScanMutation.isPending}
                    onClick={() => runIntegrityScanMutation.mutate()}
                  >
                    <RefreshCcw className={`h-4 w-4 mr-2 ${runIntegrityScanMutation.isPending ? "animate-spin" : ""}`} />
                    {t('packages.integrityScanRunNow')}
                  </Button>
                </div>
                {integrityScanQuery.isLoading ? (
                  <p className="text-center text-muted-foreground py-8">{t('common.loading')}</p>
                ) : ingestIntegrityRelationships.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Info className="h-10 w-10 mx-auto mb-2 opacity-30" />
                    <p>{t('packages.integrityScanEmpty')}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-3 font-medium">{t('packages.integrityScanRelationship')}</th>
                          <th className="text-right p-3 font-medium">{t('packages.integrityScanViolations')}</th>
                          <th className="text-left p-3 font-medium">{t('packages.integrityScanLastRun')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ingestIntegrityRelationships.map((rel) => (
                          <tr key={rel.key} className="border-b">
                            <td className="p-3">
                              <code className="text-xs bg-muted px-1 py-0.5 rounded">{rel.key}</code>
                            </td>
                            <td className="p-3 text-right">
                              {rel.lastScan == null ? (
                                <span className="text-muted-foreground text-xs">{t('packages.integrityScanNeverRun')}</span>
                              ) : rel.lastScan.violationCount > 0 ? (
                                <span className="text-destructive font-medium">{rel.lastScan.violationCount}</span>
                              ) : (
                                <span className="text-success font-medium">0</span>
                              )}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {rel.lastScan?.scannedAt ? format(new Date(rel.lastScan.scannedAt), "dd/MM/yyyy HH:mm:ss") : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Package Detail Dialog */}
        <Dialog open={!!selectedPackageId} onOpenChange={(open) => { if (!open) { setSelectedPackageId(null); setDetailTab("info"); } }}>
          <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <FileArchive className="h-5 w-5" />
                {t('packages.packageDetail')}
              </DialogTitle>
              <DialogDescription>
                {selectedPackageId && (
                  <code className="text-xs">{selectedPackageId}</code>
                )}
              </DialogDescription>
            </DialogHeader>

            {packageDetailQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>
            ) : packageDetailQuery.data ? (
              <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 flex flex-col overflow-hidden">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="info" className="gap-1.5">
                    <Info className="h-4 w-4" /> {t('packages.infoTab')}
                  </TabsTrigger>
                  <TabsTrigger value="images" className="gap-1.5">
                    <ImageIcon className="h-4 w-4" /> {t('packages.imagesTab', { count: packageDetailQuery.data.images?.length || 0 })}
                  </TabsTrigger>
                  <TabsTrigger value="logs" className="gap-1.5">
                    <ScrollText className="h-4 w-4" /> {t('packages.logsTab')}
                    {packageDetailQuery.data.status === "failed" && (
                      <span className="ml-1 h-2 w-2 rounded-full bg-destructive animate-pulse" />
                    )}
                  </TabsTrigger>
                </TabsList>

                {/* Tab: Info */}
                <TabsContent value="info" className="flex-1 overflow-auto mt-4">
                  <ScrollArea className="h-full pr-4">
                    <div className="space-y-6">
                      {/* Error Message Alert */}
                      {packageDetailQuery.data.errorMessage && (
                        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
                            <div>
                              <h4 className="text-sm font-semibold text-destructive">{t('packages.uploadError')}</h4>
                              <p className="text-sm text-destructive/90 mt-1 whitespace-pre-wrap break-all">
                                {packageDetailQuery.data.errorMessage}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Package Info */}
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground block text-xs">Serial Number</span>
                          <span className="font-medium">{packageDetailQuery.data.serialNumber || "—"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Product Model</span>
                          <span className="font-medium">{packageDetailQuery.data.productModel || "—"}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">Machine</span>
                          <Badge variant="outline" className="font-mono">
                            {packageDetailQuery.data.machine?.name || packageDetailQuery.data.machineCode || "—"}
                          </Badge>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">{t('packages.result')}</span>
                          <ResultBadge result={packageDetailQuery.data.overallResult} />
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">{t('common.status')}</span>
                          <StatusBadge status={packageDetailQuery.data.status} />
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">{t('packages.fileSize')}</span>
                          <span>{formatBytes(packageDetailQuery.data.fileSizeBytes)}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">{t('packages.inspectionTime')}</span>
                          <span>
                            {packageDetailQuery.data.inspectionTime
                              ? format(new Date(packageDetailQuery.data.inspectionTime), "dd/MM/yyyy HH:mm:ss")
                              : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">{t('packages.uploadedAt')}</span>
                          <span>
                            {packageDetailQuery.data.uploadedAt
                              ? format(new Date(packageDetailQuery.data.uploadedAt), "dd/MM/yyyy HH:mm:ss")
                              : "—"}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground block text-xs">{t('packages.measurementPoints')}</span>
                          <span>
                            {packageDetailQuery.data.totalPoints || 0} ({packageDetailQuery.data.okCount || 0} OK / {packageDetailQuery.data.ngCount || 0} NG)
                          </span>
                        </div>
                      </div>

                      {/* Download button */}
                      {packageDetailQuery.data.status === "committed" && (
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => window.open(`/api/aoi/download/${selectedPackageId}`, "_blank")}
                          >
                            <Download className="h-4 w-4 mr-2" />
                            {t('packages.downloadZipAudit')}
                          </Button>
                          {packageDetailQuery.data.inspectionId && (
                            <Link href={`/inspection/${packageDetailQuery.data.inspectionId}`}>
                              <Button variant="outline" size="sm">
                                <Eye className="h-4 w-4 mr-2" />
                                {t('packages.viewInspection')}
                              </Button>
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Tab: Images */}
                <TabsContent value="images" className="flex-1 overflow-auto mt-4">
                  <ScrollArea className="h-full pr-4">
                    {packageDetailQuery.data.images && packageDetailQuery.data.images.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {packageDetailQuery.data.images.map((img) => (
                          <Card
                            key={img.id}
                            className={`cursor-pointer hover:ring-2 hover:ring-primary transition-all ${
                              img.result === "NG" ? "border-destructive/40" : ""
                            }`}
                            onClick={() =>
                              setViewImageDialog({
                                packageId: selectedPackageId!,
                                pointCode: img.pointCode,
                                fileName: img.fileName,
                              })
                            }
                          >
                            <CardContent className="p-3 space-y-2">
                              <div className="aspect-square bg-muted rounded-lg overflow-hidden flex items-center justify-center relative">
                                <img
                                  src={`/api/aoi/image/${selectedPackageId}/${img.fileName}`}
                                  alt={img.pointCode}
                                  className="object-cover w-full h-full"
                                  loading="lazy"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = "none";
                                    (e.target as HTMLImageElement).parentElement!.innerHTML =
                                      '<div class="flex flex-col items-center justify-center h-full text-muted-foreground"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg><span class="text-xs mt-1">Preview</span></div>';
                                  }}
                                />
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-mono font-medium">{img.pointCode}</span>
                                <ResultBadge result={img.result} />
                              </div>
                              {img.pointName && (
                                <span className="text-xs text-muted-foreground block truncate">{img.pointName}</span>
                              )}
                              {img.measurementValue && (
                                <span className="text-xs text-muted-foreground">{img.measurementValue}</span>
                              )}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p>{t('packages.noImageInfo')}</p>
                        <p className="text-xs mt-1">{t('packages.imageAvailableAfterCommit')}</p>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>

                {/* Tab: Activity Logs */}
                <TabsContent value="logs" className="flex-1 overflow-auto mt-4">
                  <ScrollArea className="h-full pr-4">
                    {logsQuery.isLoading ? (
                      <div className="text-center py-8 text-muted-foreground">{t('packages.loadingLogs')}</div>
                    ) : logsQuery.data?.logs && logsQuery.data.logs.length > 0 ? (
                      <div className="relative">
                        {/* Timeline line */}
                        <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
                        <div className="space-y-0">
                          {logsQuery.data.logs.map((log: any, i: number) => {
                            const eventConfig: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
                              presign: { icon: <Clock className="h-3.5 w-3.5" />, color: "bg-info/15 text-info border-info/30", label: t('packages.logInit') },
                              upload_start: { icon: <ArrowUpCircle className="h-3.5 w-3.5" />, color: "bg-info/15 text-info border-info/30", label: t('packages.logUploadStart') },
                              upload_success: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "bg-success/15 text-success border-success/30", label: t('packages.logUploadSuccess') },
                              upload_fail: { icon: <XCircle className="h-3.5 w-3.5" />, color: "bg-destructive/15 text-destructive border-destructive/30", label: t('packages.logUploadFail') },
                              commit_start: { icon: <Activity className="h-3.5 w-3.5" />, color: "bg-primary/15 text-primary border-primary/30", label: t('packages.logCommitStart') },
                              commit_success: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: "bg-success/15 text-success border-success/30", label: t('packages.logCommitSuccess') },
                              commit_fail: { icon: <XCircle className="h-3.5 w-3.5" />, color: "bg-destructive/15 text-destructive border-destructive/30", label: t('packages.logCommitFail') },
                              retry: { icon: <RefreshCcw className="h-3.5 w-3.5" />, color: "bg-warning/15 text-warning border-warning/30", label: t('packages.logRetry') },
                              image_view: { icon: <Eye className="h-3.5 w-3.5" />, color: "bg-muted text-muted-foreground border-border", label: t('packages.logImageView') },
                              zip_download: { icon: <ArrowDownCircle className="h-3.5 w-3.5" />, color: "bg-primary/15 text-primary border-primary/30", label: t('packages.logZipDownload') },
                              status_change: { icon: <Activity className="h-3.5 w-3.5" />, color: "bg-warning/15 text-warning border-warning/30", label: t('packages.logStatusChange') },
                            };
                            const cfg = eventConfig[log.event] || { icon: <Info className="h-3.5 w-3.5" />, color: "bg-muted text-muted-foreground border-border", label: log.event };
                            const levelColors: Record<string, string> = {
                              error: "border-l-destructive",
                              warn: "border-l-warning",
                              info: "border-l-info",
                            };
                            const borderColor = levelColors[log.level] || "border-l-border";

                            return (
                              <div key={log.id || i} className="relative pl-10 pb-4">
                                {/* Timeline dot */}
                                <div className={`absolute left-2.5 top-1.5 h-3 w-3 rounded-full border-2 border-background ${
                                  log.level === "error" ? "bg-destructive" : log.level === "warn" ? "bg-warning" : "bg-info"
                                }`} />

                                <div className={`rounded-lg border border-l-4 ${borderColor} p-3 space-y-2`}>
                                  {/* Header row */}
                                  <div className="flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                      <Badge className={`text-xs ${cfg.color}`}>
                                        {cfg.icon}
                                        <span className="ml-1">{cfg.label}</span>
                                      </Badge>
                                      {log.level === "error" && (
                                        <Badge variant="destructive" className="text-xs">ERROR</Badge>
                                      )}
                                      {log.level === "warn" && (
                                        <Badge className="text-xs bg-warning/15 text-warning border-warning/30">WARN</Badge>
                                      )}
                                    </div>
                                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                                      {log.createdAt ? format(new Date(log.createdAt), "HH:mm:ss dd/MM/yyyy") : "—"}
                                    </span>
                                  </div>

                                  {/* Message */}
                                  <p className="text-sm">{log.message}</p>

                                  {/* Detail (expandable for errors) */}
                                  {log.detail && (
                                    <details className="text-xs">
                                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                                        {t('packages.errorDetailStackTrace')}
                                      </summary>
                                      <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                                        {log.detail}
                                      </pre>
                                    </details>
                                  )}

                                  {/* Metadata row */}
                                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                                    {log.source && (
                                      <span className="flex items-center gap-1">
                                        <Cpu className="h-3 w-3" /> {log.source}
                                      </span>
                                    )}
                                    {log.ipAddress && (
                                      <span className="flex items-center gap-1">
                                        <Globe className="h-3 w-3" /> {log.ipAddress}
                                      </span>
                                    )}
                                    {log.durationMs != null && (
                                      <span className="flex items-center gap-1">
                                        <Timer className="h-3 w-3" /> {log.durationMs}ms
                                      </span>
                                    )}
                                    {log.fileSizeBytes != null && (
                                      <span className="flex items-center gap-1">
                                        <HardDrive className="h-3 w-3" /> {formatBytes(log.fileSizeBytes)}
                                      </span>
                                    )}
                                    {log.userName && (
                                      <span className="flex items-center gap-1">
                                        <User className="h-3 w-3" /> {log.userName}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        <ScrollText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p>{t('packages.noLogs')}</p>
                        <p className="text-xs mt-1">{t('packages.logsAutoRecorded')}</p>
                      </div>
                    )}
                  </ScrollArea>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-8 text-muted-foreground">{t('packages.packageNotFound')}</div>
            )}
          </DialogContent>
        </Dialog>

        {/* Image Viewer Dialog */}
        <Dialog open={!!viewImageDialog} onOpenChange={(open) => !open && setViewImageDialog(null)}>
          <DialogContent
            className="max-w-3xl"
            onKeyDown={(e) => {
              if (!viewImageDialog || !packageDetailQuery.data?.images) return;
              const images = packageDetailQuery.data.images;
              const idx = images.findIndex((img) => img.fileName === viewImageDialog.fileName);
              if (e.key === "ArrowLeft" && idx > 0) {
                e.preventDefault();
                const prev = images[idx - 1];
                setViewImageDialog({ packageId: viewImageDialog.packageId, pointCode: prev.pointCode, fileName: prev.fileName });
              } else if (e.key === "ArrowRight" && idx < images.length - 1) {
                e.preventDefault();
                const next = images[idx + 1];
                setViewImageDialog({ packageId: viewImageDialog.packageId, pointCode: next.pointCode, fileName: next.fileName });
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                {viewImageDialog?.pointCode || viewImageDialog?.fileName}
                {viewImageDialog && packageDetailQuery.data?.images && (() => {
                  const idx = packageDetailQuery.data.images.findIndex((img) => img.fileName === viewImageDialog.fileName);
                  return idx >= 0 ? (
                    <span className="text-sm font-normal text-muted-foreground ml-auto">
                      {idx + 1} / {packageDetailQuery.data.images.length}
                    </span>
                  ) : null;
                })()}
              </DialogTitle>
              <DialogDescription>
                Package: {viewImageDialog?.packageId}
              </DialogDescription>
            </DialogHeader>
            <div className="relative flex items-center justify-center min-h-100 bg-muted rounded-lg overflow-hidden group">
              {/* Previous arrow */}
              {viewImageDialog && packageDetailQuery.data?.images && (() => {
                const images = packageDetailQuery.data.images;
                const idx = images.findIndex((img) => img.fileName === viewImageDialog.fileName);
                return idx > 0 ? (
                  <button
                    type="button"
                    aria-label={t('common.previous', 'Previous')}
                    className="absolute left-2 z-10 p-1.5 rounded-full bg-background/80 hover:bg-background shadow-md border opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      const prev = images[idx - 1];
                      setViewImageDialog({ packageId: viewImageDialog.packageId, pointCode: prev.pointCode, fileName: prev.fileName });
                    }}
                  >
                    <ChevronLeft aria-hidden="true" className="h-5 w-5" />
                  </button>
                ) : null;
              })()}

              {viewImageDialog && (
                <img
                  src={`/api/aoi/image/${viewImageDialog.packageId}/${viewImageDialog.fileName}`}
                  alt={viewImageDialog.pointCode || viewImageDialog.fileName}
                  className="max-w-full max-h-[60vh] object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                    (e.target as HTMLImageElement).parentElement!.innerHTML =
                      '<div class="text-center text-muted-foreground py-8"><p>Cannot load image</p><p class="text-xs">ZIP may not be uploaded or image does not exist</p></div>';
                  }}
                />
              )}

              {/* Next arrow */}
              {viewImageDialog && packageDetailQuery.data?.images && (() => {
                const images = packageDetailQuery.data.images;
                const idx = images.findIndex((img) => img.fileName === viewImageDialog.fileName);
                return idx >= 0 && idx < images.length - 1 ? (
                  <button
                    type="button"
                    aria-label={t('common.next', 'Next')}
                    className="absolute right-2 z-10 p-1.5 rounded-full bg-background/80 hover:bg-background shadow-md border opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => {
                      const next = images[idx + 1];
                      setViewImageDialog({ packageId: viewImageDialog.packageId, pointCode: next.pointCode, fileName: next.fileName });
                    }}
                  >
                    <ChevronRight aria-hidden="true" className="h-5 w-5" />
                  </button>
                ) : null;
              })()}
            </div>
            <div className="flex justify-end gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (viewImageDialog) {
                    window.open(`/api/aoi/image/${viewImageDialog.packageId}/${viewImageDialog.fileName}`, "_blank");
                  }
                }}
              >
                <ImageIcon className="h-4 w-4 mr-2" />
                {t('packages.openOriginalImage')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Dead-letter Detail Dialog (BG-36) — payload đã CẮT GỌN AN TOÀN ở server, xem
            server/services/inspection/deadLetterReader.ts */}
        <Dialog open={!!selectedDeadLetterKey} onOpenChange={(open) => !open && setSelectedDeadLetterKey(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Skull className="h-5 w-5 text-destructive" />
                {t('packages.deadLetterDetailTitle')}
              </DialogTitle>
              <DialogDescription>
                {selectedDeadLetterKey && <code className="text-xs">{selectedDeadLetterKey}</code>}
              </DialogDescription>
            </DialogHeader>
            {deadLetterDetailQuery.isLoading ? (
              <div className="text-center py-8 text-muted-foreground">{t('common.loading')}</div>
            ) : !deadLetterDetailQuery.data ? (
              <div className="text-center py-8 text-muted-foreground">{t('packages.deadLetterNotFound')}</div>
            ) : (
              <ScrollArea className="flex-1 pr-4">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground block text-xs">{t('packages.machineCode')}</span>
                      <span className="font-medium">{deadLetterDetailQuery.data.machineCode || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">Serial Number</span>
                      <span className="font-medium">{deadLetterDetailQuery.data.serialNumber || "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">{t('packages.time')}</span>
                      <span>{deadLetterDetailQuery.data.deadAt ? format(new Date(deadLetterDetailQuery.data.deadAt), "dd/MM/yyyy HH:mm:ss") : "—"}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-xs">{t('packages.deadLetterAttempts')}</span>
                      <span>{deadLetterDetailQuery.data.attempts}</span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                    <h4 className="text-sm font-semibold text-destructive">{t('packages.deadLetterReason')}</h4>
                    <p className="text-sm text-destructive/90 mt-1 whitespace-pre-wrap break-all">{deadLetterDetailQuery.data.error}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold mb-2">{t('packages.deadLetterPayloadHint')}</h4>
                    <pre className="text-xs bg-muted rounded p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-60">
                      {JSON.stringify(deadLetterDetailQuery.data.payload, null, 2)}
                    </pre>
                  </div>
                </div>
              </ScrollArea>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
