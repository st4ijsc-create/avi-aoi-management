import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { saveLicenseKey } from "@/hooks/useLicenseModules";
import {
  PageHeader, PageContainer, MetricCard, EmptyState,
  StatusBadge as DsStatusBadge,
} from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import {
  Key,
  Shield,
  ShieldCheck,
  Download,
  RefreshCw,
  Eye,
  Monitor,
  Clock,
  Package,
  BarChart3,
  Ban,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Activity,
  Upload,
  Wifi,
  WifiOff,
  FileText,
  Clipboard,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// STATUS BADGE
// ═══════════════════════════════════════════════════════════════

const STATUS_ICON: Record<string, React.ReactNode> = {
  active: <CheckCircle2 className="w-3 h-3" />,
  expired: <Clock className="w-3 h-3" />,
  revoked: <Ban className="w-3 h-3" />,
  suspended: <AlertTriangle className="w-3 h-3" />,
  pending: <Clock className="w-3 h-3" />,
};

const STATUS_VARIANT_MAP: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  expired: "secondary",
  revoked: "destructive",
  suspended: "outline",
  pending: "outline",
};

function StatusBadge({ status }: { status: string }) {
  const variant = STATUS_VARIANT_MAP[status] || STATUS_VARIANT_MAP.pending;
  const icon = STATUS_ICON[status] || STATUS_ICON.pending;
  return (
    <DsStatusBadge
      status={status}
      variant={variant}
      className="gap-1"
      label={<span className="inline-flex items-center gap-1">{icon}{status}</span>}
    />
  );
}

function TypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    trial: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    standard: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    professional: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    enterprise: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    lifetime: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  return (
    <Badge className={`${colors[type] || ""} border-0`}>
      {type}
    </Badge>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════

export function LicenseManagementContent() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <PageContainer>
      <PageHeader
        icon={<Shield className="h-6 w-6" />}
        title={t('license.title')}
        description={t('license.subtitle')}
      />

      <Tabs defaultValue={isAdmin ? "licenses" : "activate"}>
        <TabsList>
          <TabsTrigger value="activate" className="gap-1">
            <Key className="w-4 h-4" />
            {t('license.tabActivate')}
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="licenses" className="gap-1">
                <ShieldCheck className="w-4 h-4" />
                {t('license.tabLicenses')}
              </TabsTrigger>
              <TabsTrigger value="modules" className="gap-1">
                <Package className="w-4 h-4" />
                {t('license.tabModules')}
              </TabsTrigger>
              <TabsTrigger value="stats" className="gap-1">
                <BarChart3 className="w-4 h-4" />
                {t('license.tabStats')}
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="activate">
          <ActivateTab />
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="licenses">
              <LicensesTab />
            </TabsContent>
            <TabsContent value="modules">
              <ModulesTab />
            </TabsContent>
            <TabsContent value="stats">
              <StatsTab />
            </TabsContent>
          </>
        )}
      </Tabs>
    </PageContainer>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVATE TAB
// ═══════════════════════════════════════════════════════════════

function ActivateTab() {
  const { t } = useTranslation();
  const [licenseKey, setLicenseKey] = useState("");
  const [productCode, setProductCode] = useState("avi-aoi-management");
  const [result, setResult] = useState<any>(null);
  const [activationMode, setActivationMode] = useState<"online" | "offline">("online");

  // Offline activation state
  const [offlineStep, setOfflineStep] = useState<1 | 2 | 3>(1);
  const [offlineRequest, setOfflineRequest] = useState<any>(null);
  const [offlinePackageBase64, setOfflinePackageBase64] = useState("");
  const [offlineResult, setOfflineResult] = useState<any>(null);

  // Check License Server status
  const { data: serverStatus } = trpc.license.serverStatus.useQuery();

  // ─── Online Activation ───
  const activateMutation = trpc.license.activate.useMutation({
    onSuccess: (data) => {
      setResult(data);
      saveLicenseKey(licenseKey.trim());
      toast.success(t('license.activateSuccess'));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  // ─── Offline Activation ───
  const generateOfflineRequestMutation = trpc.license.generateOfflineRequest.useMutation({
    onSuccess: (data) => {
      setOfflineRequest(data);
      setOfflineStep(2);
      toast.success(t('license.offlineRequestCreated'));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const applyOfflineMutation = trpc.license.applyOfflineLicense.useMutation({
    onSuccess: (data) => {
      setOfflineResult(data);
      setOfflineStep(3);
      saveLicenseKey(licenseKey.trim());
      toast.success(t('license.offlineApplySuccess'));
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleActivate = () => {
    if (!licenseKey.trim()) {
      toast.error(t('license.enterLicenseKey'));
      return;
    }
    activateMutation.mutate({
      licenseKey: licenseKey.trim(),
      productCode,
      machineName: navigator.userAgent.substring(0, 100),
    });
  };

  const handleGenerateOfflineRequest = () => {
    if (!licenseKey.trim()) {
      toast.error(t('license.enterLicenseKey'));
      return;
    }
    generateOfflineRequestMutation.mutate({
      licenseKey: licenseKey.trim(),
    });
  };

  const handleApplyOfflineLicense = () => {
    if (!offlinePackageBase64.trim()) {
      toast.error(t('license.pasteOfflinePackage'));
      return;
    }
    if (!licenseKey.trim()) {
      toast.error(t('license.enterLicenseKey'));
      return;
    }
    applyOfflineMutation.mutate({
      offlinePackageBase64: offlinePackageBase64.trim(),
      licenseKey: licenseKey.trim(),
    });
  };

  const downloadRequestFile = () => {
    if (!offlineRequest?.requestBase64) return;
    const blob = new Blob([offlineRequest.requestBase64], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline-request-${licenseKey.trim() || "unknown"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyRequestToClipboard = () => {
    if (!offlineRequest?.requestBase64) return;
    navigator.clipboard.writeText(offlineRequest.requestBase64);
    toast.success(t('license.copiedToClipboard'));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setOfflinePackageBase64(content.trim());
      toast.success(t('license.fileLoaded', { name: file.name }));
    };
    reader.readAsText(file);
  };

  const downloadLicenseFile = () => {
    if (!result?.offlineLicenseBase64) return;
    const content = atob(result.offlineLicenseBase64);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${licenseKey}.lic`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Mode Selector */}
      <div className="flex gap-2">
        <Button
          variant={activationMode === "online" ? "default" : "outline"}
          onClick={() => { setActivationMode("online"); setResult(null); }}
          className="flex items-center gap-2"
        >
          <Wifi className="w-4 h-4" />
          {t('license.activateOnline')}
        </Button>
        <Button
          variant={activationMode === "offline" ? "default" : "outline"}
          onClick={() => { setActivationMode("offline"); setOfflineStep(1); setOfflineRequest(null); setOfflineResult(null); }}
          className="flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4" />
          {t('license.activateOffline')}
        </Button>
      </div>

      {/* ─── ONLINE ACTIVATION ─── */}
      {activationMode === "online" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                {t('license.activateOnline')}
              </CardTitle>
              <CardDescription>
                {t('license.activateOnlineDesc')}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* License Server Status */}
              <div className="flex items-center gap-2 text-sm">
                {serverStatus?.configured ? (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success" />
                    </span>
                    <span className="text-muted-foreground">
                      {t('license.licenseServer')}: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{serverStatus.serverUrl}</code>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-warning" />
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {t('license.serverNotConfigured')}
                    </span>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label>{t('license.licenseKey')}</Label>
                <Input
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>{t('license.productCode')}</Label>
                <Input
                  value={productCode}
                  onChange={(e) => setProductCode(e.target.value)}
                />
              </div>
              <Button
                onClick={handleActivate}
                disabled={activateMutation.isPending}
                className="w-full"
              >
                {activateMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mr-2" />
                )}
                {t('license.activateOnline')}
              </Button>
            </CardContent>
          </Card>

          {/* Online Result */}
          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="w-5 h-5" />
                  {t('license.activateSuccessTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('license.customer')}</span>
                  <span className="font-medium">{result.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('license.licenseType')}</span>
                  <TypeBadge type={result.licenseType} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('license.expiresAt')}</span>
                  <span className="font-medium">
                    {result.expiresAt
                      ? new Date(result.expiresAt).toLocaleDateString("vi-VN")
                      : t('license.perpetual')}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('license.modules')}</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {result.moduleCodes?.map((m: string) => (
                      <Badge key={m} variant="secondary">{m}</Badge>
                    ))}
                    {(!result.moduleCodes || result.moduleCodes.length === 0) && (
                      <span className="text-sm text-muted-foreground">{t('common.all')}</span>
                    )}
                  </div>
                </div>
                <div className="pt-3 border-t">
                  <Button onClick={downloadLicenseFile} variant="outline" className="w-full">
                    <Download className="w-4 h-4 mr-2" />
                    {t('license.downloadLicenseFile')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ─── OFFLINE ACTIVATION ─── */}
      {activationMode === "offline" && (
        <div className="space-y-6">
          {/* Steps indicator */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((step) => (
              <div key={step} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    offlineStep === step
                      ? "bg-primary text-primary-foreground"
                      : offlineStep > step
                        ? "bg-success text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {offlineStep > step ? <CheckCircle2 className="w-4 h-4" /> : step}
                </div>
                <span className={`text-sm ${offlineStep === step ? "font-medium" : "text-muted-foreground"}`}>
                  {step === 1 && t('license.stepCreate')}
                  {step === 2 && t('license.stepSendAdmin')}
                  {step === 3 && t('license.stepApply')}
                </span>
                {step < 3 && <div className="w-8 h-px bg-border" />}
              </div>
            ))}
          </div>

          {/* Step 1: Generate Activation Request */}
          {offlineStep === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  {t('license.step1Title')}
                </CardTitle>
                <CardDescription>
                  {t('license.step1Desc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('license.licenseKey')}</Label>
                  <Input
                    placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                    value={licenseKey}
                    onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                    className="font-mono"
                  />
                </div>
                <Button
                  onClick={handleGenerateOfflineRequest}
                  disabled={generateOfflineRequestMutation.isPending}
                  className="w-full"
                >
                  {generateOfflineRequestMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <FileText className="w-4 h-4 mr-2" />
                  )}
                  {t('license.generateRequest')}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Step 2: Send to Admin → Get offline package */}
          {offlineStep === 2 && offlineRequest && (
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clipboard className="w-5 h-5" />
                    {t('license.step2Title')}
                  </CardTitle>
                  <CardDescription>
                    {t('license.step2Desc')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t('license.requestInfo')}</Label>
                    <div className="text-sm space-y-1 bg-muted p-3 rounded-md">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('license.licenseKey')}:</span>
                        <code className="text-xs">{licenseKey}</code>
                   </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('license.productCode')}:</span>
                        <code className="text-xs">{offlineRequest.productCode}</code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('license.hardwareFingerprint')}:</span>
                        <code className="text-xs">{offlineRequest.hardwareFingerprint?.substring(0, 16)}...</code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('common.time')}:</span>
                        <span className="text-xs">{new Date(offlineRequest.timestamp).toLocaleString("vi-VN")}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('license.requestCode')}</Label>
                    <Textarea
                      readOnly
                      value={offlineRequest.requestBase64}
                      rows={4}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={copyRequestToClipboard} variant="outline" className="flex-1">
                      <Copy className="w-4 h-4 mr-2" />
                      {t('common.copy')}
                    </Button>
                    <Button onClick={downloadRequestFile} variant="outline" className="flex-1">
                      <Download className="w-4 h-4 mr-2" />
                      {t('license.downloadTxt')}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="w-5 h-5" />
                    {t('license.receivePackageTitle')}
                  </CardTitle>
                  <CardDescription>
                    {t('license.receivePackageDesc')}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>{t('license.offlinePackage')}</Label>
                    <Textarea
                      placeholder={t('license.offlinePackagePlaceholder')}
                      value={offlinePackageBase64}
                      onChange={(e) => setOfflinePackageBase64(e.target.value)}
                      rows={6}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="text-center text-sm text-muted-foreground">{t('license.or')}</div>
                  <div className="space-y-2">
                    <Label>{t('license.uploadFile')}</Label>
                    <Input
                      type="file"
                      accept=".txt,.dat,.b64,.lic"
                      onChange={handleFileUpload}
                    />
                  </div>
                  <Button
                    onClick={handleApplyOfflineLicense}
                    disabled={applyOfflineMutation.isPending || !offlinePackageBase64.trim()}
                    className="w-full"
                  >
                    {applyOfflineMutation.isPending ? (
                      <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <ShieldCheck className="w-4 h-4 mr-2" />
                    )}
                    {t('license.applyOffline')}
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 3: Result */}
          {offlineStep === 3 && offlineResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-success">
                  <CheckCircle2 className="w-5 h-5" />
                  {t('license.offlineSuccessTitle')}
                </CardTitle>
                <CardDescription>
                  {t('license.offlineSuccessDesc')}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {offlineResult.validationResult && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('common.status')}</span>
                      <Badge variant="default">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {offlineResult.validationResult.status || "active"}
                      </Badge>
                    </div>
                    {offlineResult.validationResult.customerName && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('license.customer')}</span>
                        <span className="font-medium">{offlineResult.validationResult.customerName}</span>
                      </div>
                    )}
                    {offlineResult.validationResult.licenseType && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('license.licenseType')}</span>
                        <TypeBadge type={offlineResult.validationResult.licenseType} />
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('license.expiresAt')}</span>
                      <span className="font-medium">
                        {offlineResult.validationResult.expiresAt
                          ? new Date(offlineResult.validationResult.expiresAt).toLocaleDateString("vi-VN")
                          : t('license.perpetual')}
                      </span>
                    </div>
                    {offlineResult.validationResult.moduleCodes?.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('license.modules')}</span>
                        <div className="flex gap-1 flex-wrap justify-end">
                          {offlineResult.validationResult.moduleCodes.map((m: string) => (
                            <Badge key={m} variant="secondary">{m}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t('license.mode')}</span>
                      <Badge variant="outline">
                        <WifiOff className="w-3 h-3 mr-1" />
                        {t('license.offline')}
                      </Badge>
                    </div>
                  </>
                )}
                <div className="pt-3 border-t">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setActivationMode("offline");
                      setOfflineStep(1);
                      setOfflineRequest(null);
                      setOfflineResult(null);
                      setOfflinePackageBase64("");
                    }}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t('license.activateAnother')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// LICENSES TAB (Admin)
// ═══════════════════════════════════════════════════════════════

function LicensesTab() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const { data, isLoading, refetch } = trpc.license.admin.list.useQuery({
    search: search || undefined,
    status: statusFilter as any,
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <Input
          placeholder={t('license.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('license.licenseKey')}</TableHead>
                <TableHead>{t('license.customer')}</TableHead>
                <TableHead>{t('common.type')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('license.activations')}</TableHead>
                <TableHead>{t('license.expiresAt')}</TableHead>
                <TableHead className="text-right">{t('common.details')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={`sk-${i}`}>
                    <TableCell colSpan={7} className="py-2">
                      <Skeleton className="h-8 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : !data?.licenses?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="p-0">
                    <EmptyState variant="no-data" title={t('license.noLicenses')} compact />
                  </TableCell>
                </TableRow>
              ) : (
                data.licenses.map((lic: any) => (
                  <TableRow key={lic.id}>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <code className="text-xs">{lic.licenseKey}</code>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => {
                            navigator.clipboard.writeText(lic.licenseKey);
                            toast.success(t('common.copied'));
                          }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">{lic.customerName}</div>
                      {lic.companyName && (
                        <div className="text-xs text-muted-foreground">{lic.companyName}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <TypeBadge type={lic.licenseType} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={lic.status} />
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {lic.currentActivations}/{lic.maxActivations}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {lic.expiresAt
                          ? new Date(lic.expiresAt).toLocaleDateString("vi-VN")
                          : "∞"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setSelectedKey(lic.licenseKey)}
                        title={t('license.viewActivations')}
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Activations Dialog */}
      {selectedKey && (
        <ActivationsDialog
          licenseKey={selectedKey}
          onClose={() => setSelectedKey(null)}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVATIONS DIALOG (read-only)
// ═══════════════════════════════════════════════════════════════

function ActivationsDialog({ licenseKey, onClose }: { licenseKey: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: activations, isLoading } = trpc.license.admin.activations.useQuery({ licenseKey });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            {t('license.activatedDevices')}
          </DialogTitle>
          <DialogDescription>
            {t('license.licenseKey')}: <code className="text-xs bg-muted px-1 py-0.5 rounded">{licenseKey}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !activations?.length ? (
            <EmptyState variant="no-data" title={t('license.noDevices')} compact />
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">{t('license.device')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('license.fingerprint')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('license.ip')}</TableHead>
                    <TableHead className="whitespace-nowrap">{t('license.lastSeen')}</TableHead>
                    <TableHead className="whitespace-nowrap text-right">{t('common.status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activations.map((act: any) => {
                    // Extract short device name from User-Agent or machineName
                    const rawName: string = act.machineName || "—";
                    let displayName = rawName;
                    // If machineName is a User-Agent string, extract OS + browser
                    if (rawName.includes("Mozilla/") || rawName.includes("AppleWebKit")) {
                      const osMatch = rawName.match(/\(([^)]+)\)/);
                      const browserMatch = rawName.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/);
                      const osPart = osMatch ? osMatch[1].split(";")[0].trim() : "";
                      const browserPart = browserMatch ? browserMatch[0] : "";
                      displayName = [osPart, browserPart].filter(Boolean).join(" — ") || rawName;
                    }

                    return (
                      <TableRow key={act.id}>
                        <TableCell className="font-medium max-w-[180px]">
                          <span className="block truncate" title={rawName}>
                            {displayName}
                          </span>
                        </TableCell>
                        <TableCell>
                          <code className="text-xs" title={act.hardwareFingerprint}>
                            {act.hardwareFingerprint?.substring(0, 10)}...
                          </code>
                        </TableCell>
                        <TableCell>{act.ipAddress || "—"}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {act.lastSeenAt
                            ? new Date(act.lastSeenAt).toLocaleString("vi-VN", {
                                hour: "2-digit",
                                minute: "2-digit",
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                              })
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {act.isActive ? (
                            <DsStatusBadge
                              status="active"
                              tone="success"
                              className="gap-1 text-xs"
                              label={<span className="inline-flex items-center gap-1"><Activity className="w-3 h-3" />{t('common.active')}</span>}
                            />
                          ) : (
                            <DsStatusBadge status="inactive" variant="secondary" className="text-xs" label={t('common.inactive')} />
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ═══════════════════════════════════════════════════════════════
// MODULES TAB (Admin) – Hiển thị System Modules + Export
// ═══════════════════════════════════════════════════════════════

function ModulesTab() {
  const { t } = useTranslation();
  // System modules from registry
  const { data: systemModules, isLoading: sysLoading } = trpc.license.modules.systemModules.useQuery();

  // Export (manual trigger)
  const { refetch: doExport, isFetching: exporting } = trpc.license.modules.exportModules.useQuery(
    undefined,
    { enabled: false },
  );

  // Download export JSON
  const handleExport = async () => {
    try {
      const result = await doExport();
      const json = result.data;
      if (!json) return;
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `modules-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t('license.exportSuccess'));
    } catch (err: any) {
      toast.error(t('license.exportError', { message: err.message || "Unknown" }));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + Export */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold">{t('license.systemModules')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('license.systemModulesDesc')}
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="w-4 h-4 mr-1" />
          {exporting ? t('license.exporting') : t('license.exportModules')}
        </Button>
      </div>

      {/* System Modules Grid */}
      {sysLoading ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {systemModules?.map((mod: any) => (
            <Card key={mod.code} className={mod.isCore ? "border-primary/30" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="w-4 h-4" />
                  {mod.name}
                </CardTitle>
                <CardDescription className="flex items-center gap-2">
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{mod.code}</code>
                  <span className="text-xs">v{mod.version}</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-2">{mod.description}</p>
                <div className="flex items-center justify-between">
                  <Badge variant={mod.isCore ? "default" : "outline"}>
                    {mod.isCore ? t('license.core') : t('license.optional')}
                  </Badge>
                  {mod.routes && (
                    <span className="text-xs text-muted-foreground">
                      {t('license.routesCount', { count: mod.routes.length })}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATS TAB (Admin)
// ═══════════════════════════════════════════════════════════════

function StatsTab() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = trpc.license.admin.stats.useQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const statCards: { title: string; value: number; icon: React.ReactNode; tone: "info" | "success" | "warning" | "error" | "default" }[] = [
    {
      title: t('license.totalLicenses'),
      value: stats.totalLicenses || 0,
      icon: <Key className="h-5 w-5" />,
      tone: "info",
    },
    {
      title: t('license.activeLicenses'),
      value: stats.activeLicenses || 0,
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "success",
    },
    {
      title: t('license.expiredLicenses'),
      value: stats.expiredLicenses || 0,
      icon: <Clock className="h-5 w-5" />,
      tone: "warning",
    },
    {
      title: t('license.revokedLicenses'),
      value: stats.revokedLicenses || 0,
      icon: <Ban className="h-5 w-5" />,
      tone: "error",
    },
    {
      title: t('license.suspendedLicenses'),
      value: 0,
      icon: <AlertTriangle className="h-5 w-5" />,
      tone: "warning",
    },
    {
      title: t('license.activeDevices'),
      value: stats.totalActiveActivations || 0,
      icon: <Monitor className="h-5 w-5" />,
      tone: "default",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {statCards.map((stat) => (
        <MetricCard
          key={stat.title}
          icon={stat.icon}
          label={stat.title}
          value={stat.value}
          tone={stat.tone}
        />
      ))}
    </div>
  );
}

export default function LicenseManagement() {
  return (
    <DashboardLayout>
      <LicenseManagementContent />
    </DashboardLayout>
  );
}
