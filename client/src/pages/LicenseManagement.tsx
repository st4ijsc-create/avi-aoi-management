import { useState } from "react";
import { useTranslation } from "react-i18next";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { saveLicenseKey } from "@/hooks/useLicenseModules";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    active: { variant: "default", icon: <CheckCircle2 className="w-3 h-3" /> },
    expired: { variant: "secondary", icon: <Clock className="w-3 h-3" /> },
    revoked: { variant: "destructive", icon: <Ban className="w-3 h-3" /> },
    suspended: { variant: "outline", icon: <AlertTriangle className="w-3 h-3" /> },
    pending: { variant: "outline", icon: <Clock className="w-3 h-3" /> },
  };

  const config = variants[status] || variants.pending;

  return (
    <Badge variant={config.variant} className="gap-1">
      {config.icon}
      {status}
    </Badge>
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

export default function LicenseManagement() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Shield className="w-8 h-8" />
              Quản lý Bản quyền
            </h1>
            <p className="text-muted-foreground mt-1">
              Quản lý license đã kích hoạt từ License Server, xem thiết bị và module
            </p>
          </div>
        </div>

        <Tabs defaultValue={isAdmin ? "licenses" : "activate"}>
          <TabsList>
            <TabsTrigger value="activate" className="gap-1">
              <Key className="w-4 h-4" />
              Kích hoạt
            </TabsTrigger>
            {isAdmin && (
              <>
                <TabsTrigger value="licenses" className="gap-1">
                  <ShieldCheck className="w-4 h-4" />
                  Danh sách License
                </TabsTrigger>
                <TabsTrigger value="modules" className="gap-1">
                  <Package className="w-4 h-4" />
                  Modules
                </TabsTrigger>
                <TabsTrigger value="stats" className="gap-1">
                  <BarChart3 className="w-4 h-4" />
                  Thống kê
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
      </div>
    </DashboardLayout>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVATE TAB
// ═══════════════════════════════════════════════════════════════

function ActivateTab() {
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
      toast.success("Kích hoạt license thành công!");
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
      toast.success("Đã tạo yêu cầu kích hoạt offline");
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
      toast.success("Áp dụng license offline thành công!");
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const handleActivate = () => {
    if (!licenseKey.trim()) {
      toast.error("Vui lòng nhập license key");
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
      toast.error("Vui lòng nhập license key");
      return;
    }
    generateOfflineRequestMutation.mutate({
      licenseKey: licenseKey.trim(),
    });
  };

  const handleApplyOfflineLicense = () => {
    if (!offlinePackageBase64.trim()) {
      toast.error("Vui lòng dán nội dung gói license offline");
      return;
    }
    if (!licenseKey.trim()) {
      toast.error("Vui lòng nhập license key");
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
    toast.success("Đã sao chép vào clipboard");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      setOfflinePackageBase64(content.trim());
      toast.success(`Đã tải file: ${file.name}`);
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
          Kích hoạt Online
        </Button>
        <Button
          variant={activationMode === "offline" ? "default" : "outline"}
          onClick={() => { setActivationMode("offline"); setOfflineStep(1); setOfflineRequest(null); setOfflineResult(null); }}
          className="flex items-center gap-2"
        >
          <WifiOff className="w-4 h-4" />
          Kích hoạt Offline
        </Button>
      </div>

      {/* ─── ONLINE ACTIVATION ─── */}
      {activationMode === "online" && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Kích hoạt Online
              </CardTitle>
              <CardDescription>
                Nhập license key để kích hoạt bản quyền từ License Server
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* License Server Status */}
              <div className="flex items-center gap-2 text-sm">
                {serverStatus?.configured ? (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
                    </span>
                    <span className="text-muted-foreground">
                      License Server: <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{serverStatus.serverUrl}</code>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-yellow-500" />
                    </span>
                    <span className="text-muted-foreground text-xs">
                      License Server chưa cấu hình — sử dụng kích hoạt offline
                    </span>
                  </>
                )}
              </div>

              <div className="space-y-2">
                <Label>License Key</Label>
                <Input
                  placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value.toUpperCase())}
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>Product Code</Label>
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
                Kích hoạt Online
              </Button>
            </CardContent>
          </Card>

          {/* Online Result */}
          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                  Kích hoạt thành công
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Khách hàng</span>
                  <span className="font-medium">{result.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Loại license</span>
                  <TypeBadge type={result.licenseType} />
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Hết hạn</span>
                  <span className="font-medium">
                    {result.expiresAt
                      ? new Date(result.expiresAt).toLocaleDateString("vi-VN")
                      : "Vĩnh viễn"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Modules</span>
                  <div className="flex gap-1 flex-wrap justify-end">
                    {result.moduleCodes?.map((m: string) => (
                      <Badge key={m} variant="secondary">{m}</Badge>
                    ))}
                    {(!result.moduleCodes || result.moduleCodes.length === 0) && (
                      <span className="text-sm text-muted-foreground">Tất cả</span>
                    )}
                  </div>
                </div>
                <div className="pt-3 border-t">
                  <Button onClick={downloadLicenseFile} variant="outline" className="w-full">
                    <Download className="w-4 h-4 mr-2" />
                    Tải file License (.lic)
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
                        ? "bg-green-500 text-white"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {offlineStep > step ? <CheckCircle2 className="w-4 h-4" /> : step}
                </div>
                <span className={`text-sm ${offlineStep === step ? "font-medium" : "text-muted-foreground"}`}>
                  {step === 1 && "Tạo yêu cầu"}
                  {step === 2 && "Gửi Admin"}
                  {step === 3 && "Áp dụng"}
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
                  Bước 1: Tạo yêu cầu kích hoạt
                </CardTitle>
                <CardDescription>
                  Nhập license key → hệ thống tạo file yêu cầu chứa thông tin máy (hardware fingerprint).
                  Gửi file này cho quản trị viên.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>License Key</Label>
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
                  Tạo yêu cầu kích hoạt
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
                    Bước 2: Gửi yêu cầu cho Admin
                  </CardTitle>
                  <CardDescription>
                    Sao chép hoặc tải file yêu cầu bên dưới, gửi cho quản trị viên License Server.
                    Admin sẽ tạo gói license offline và gửi lại cho bạn.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Thông tin yêu cầu</Label>
                    <div className="text-sm space-y-1 bg-muted p-3 rounded-md">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">License Key:</span>
                        <code className="text-xs">{licenseKey}</code>
                   </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Product Code:</span>
                        <code className="text-xs">{offlineRequest.productCode}</code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Hardware Fingerprint:</span>
                        <code className="text-xs">{offlineRequest.hardwareFingerprint?.substring(0, 16)}...</code>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Thời gian:</span>
                        <span className="text-xs">{new Date(offlineRequest.timestamp).toLocaleString("vi-VN")}</span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Mã yêu cầu (Base64)</Label>
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
                      Sao chép
                    </Button>
                    <Button onClick={downloadRequestFile} variant="outline" className="flex-1">
                      <Download className="w-4 h-4 mr-2" />
                      Tải file .txt
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Upload className="w-5 h-5" />
                    Nhận gói License Offline
                  </CardTitle>
                  <CardDescription>
                    Sau khi Admin tạo gói license, dán nội dung base64 hoặc tải file lên bên dưới
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Gói License Offline (Base64)</Label>
                    <Textarea
                      placeholder="Dán nội dung gói license offline base64 tại đây..."
                      value={offlinePackageBase64}
                      onChange={(e) => setOfflinePackageBase64(e.target.value)}
                      rows={6}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="text-center text-sm text-muted-foreground">hoặc</div>
                  <div className="space-y-2">
                    <Label>Tải file lên</Label>
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
                    Áp dụng License Offline
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Step 3: Result */}
          {offlineStep === 3 && offlineResult && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-600">
                  <CheckCircle2 className="w-5 h-5" />
                  Kích hoạt Offline thành công!
                </CardTitle>
                <CardDescription>
                  License đã được xác thực và lưu trữ. Hệ thống sẽ sử dụng license offline cho các lần khởi động sau.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {offlineResult.validationResult && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Trạng thái</span>
                      <Badge variant="default">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        {offlineResult.validationResult.status || "active"}
                      </Badge>
                    </div>
                    {offlineResult.validationResult.customerName && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Khách hàng</span>
                        <span className="font-medium">{offlineResult.validationResult.customerName}</span>
                      </div>
                    )}
                    {offlineResult.validationResult.licenseType && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Loại license</span>
                        <TypeBadge type={offlineResult.validationResult.licenseType} />
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hết hạn</span>
                      <span className="font-medium">
                        {offlineResult.validationResult.expiresAt
                          ? new Date(offlineResult.validationResult.expiresAt).toLocaleDateString("vi-VN")
                          : "Vĩnh viễn"}
                      </span>
                    </div>
                    {offlineResult.validationResult.moduleCodes?.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Modules</span>
                        <div className="flex gap-1 flex-wrap justify-end">
                          {offlineResult.validationResult.moduleCodes.map((m: string) => (
                            <Badge key={m} variant="secondary">{m}</Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Chế độ</span>
                      <Badge variant="outline">
                        <WifiOff className="w-3 h-3 mr-1" />
                        Offline
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
                    Kích hoạt license khác
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
          placeholder="Tìm theo key, tên, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? undefined : v)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tất cả</SelectItem>
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
          Làm mới
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>License Key</TableHead>
                <TableHead>Khách hàng</TableHead>
                <TableHead>Loại</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead>Kích hoạt</TableHead>
                <TableHead>Hết hạn</TableHead>
                <TableHead className="text-right">Chi tiết</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Đang tải...
                  </TableCell>
                </TableRow>
              ) : !data?.licenses?.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Chưa có license nào
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
                            toast.success("Đã sao chép");
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
                        title="Xem activations"
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
  const { data: activations, isLoading } = trpc.license.admin.activations.useQuery({ licenseKey });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5" />
            Thiết bị đã kích hoạt
          </DialogTitle>
          <DialogDescription>
            License: <code className="text-xs bg-muted px-1 py-0.5 rounded">{licenseKey}</code>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoading ? (
            <div className="text-center py-8">
              <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
            </div>
          ) : !activations?.length ? (
            <p className="text-center text-muted-foreground py-8">
              Chưa có thiết bị nào được kích hoạt
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Thiết bị</TableHead>
                    <TableHead className="whitespace-nowrap">Fingerprint</TableHead>
                    <TableHead className="whitespace-nowrap">IP</TableHead>
                    <TableHead className="whitespace-nowrap">Lần cuối</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Trạng thái</TableHead>
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
                            <Badge variant="default" className="gap-1 text-xs">
                              <Activity className="w-3 h-3" /> Active
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Inactive</Badge>
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
      toast.success("Đã xuất file modules JSON");
    } catch (err: any) {
      toast.error("Lỗi xuất file: " + (err.message || "Unknown"));
    }
  };

  return (
    <div className="space-y-4">
      {/* Header + Export */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold">System Modules</h3>
          <p className="text-sm text-muted-foreground">
            Danh sách module hệ thống. Nhấn "Export" để tạo file JSON gửi đến License Server đồng bộ.
          </p>
        </div>
        <Button variant="outline" onClick={handleExport} disabled={exporting}>
          <Download className="w-4 h-4 mr-1" />
          {exporting ? "Đang xuất..." : "Export Modules"}
        </Button>
      </div>

      {/* System Modules Grid */}
      {sysLoading ? (
        <div className="text-center py-8">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto" />
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
                    {mod.isCore ? "Core" : "Optional"}
                  </Badge>
                  {mod.routes && (
                    <span className="text-xs text-muted-foreground">
                      {mod.routes.length} routes
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
  const { data: stats, isLoading } = trpc.license.admin.stats.useQuery();

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
        Đang tải thống kê...
      </div>
    );
  }

  if (!stats) return null;

  const statCards = [
    {
      title: "Tổng License",
      value: stats.totalLicenses || 0,
      icon: Key,
      color: "text-blue-500",
    },
    {
      title: "Đang hoạt động",
      value: stats.activeLicenses || 0,
      icon: CheckCircle2,
      color: "text-green-500",
    },
    {
      title: "Hết hạn",
      value: stats.expiredLicenses || 0,
      icon: Clock,
      color: "text-yellow-500",
    },
    {
      title: "Đã thu hồi",
      value: stats.revokedLicenses || 0,
      icon: Ban,
      color: "text-red-500",
    },
    {
      title: "Tạm ngưng",
      value: 0,
      icon: AlertTriangle,
      color: "text-orange-500",
    },
    {
      title: "Thiết bị Active",
      value: stats.totalActiveActivations || 0,
      icon: Monitor,
      color: "text-purple-500",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
      {statCards.map((stat) => (
        <Card key={stat.title}>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <stat.icon className={`w-8 h-8 ${stat.color}`} />
              <div>
                <p className="text-2xl font-bold">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.title}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
