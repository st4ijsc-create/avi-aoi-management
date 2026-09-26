import { useState, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { mapTrpcError, toastTrpcError } from "@/lib/trpcErrors";
import {
  Upload, Trash2, Star, Download, Send, Package, RefreshCw, Smartphone, Power, PowerOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export function SoftwareVersionsTab() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── State ───
  const [createDialog, setCreateDialog] = useState(false);
  const [uploadVersionId, setUploadVersionId] = useState<number | null>(null);
  const [pushDialog, setPushDialog] = useState<{ open: boolean; command: "CHECK_UPDATE" | "FORCE_UPDATE" }>({
    open: false,
    command: "CHECK_UPDATE",
  });
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [createForm, setCreateForm] = useState({
    version: "",
    versionCode: "",
    changelog: "",
    mandatory: false,
    minVersionCode: "",
  });

  // ─── Queries ───
  const { data: versions = [], isLoading } = trpc.mqttSoftwareVersion.list.useQuery();
  const { data: versionSummary = [] } = trpc.mqttSoftwareVersion.deviceVersionSummary.useQuery();
  const { data: clients = [] } = trpc.mqttClient.list.useQuery();

  // ─── Mutations ───
  const createMutation = trpc.mqttSoftwareVersion.create.useMutation({
    onSuccess: () => {
      toast.success(t("mqtt.versions.createSuccess"));
      utils.mqttSoftwareVersion.list.invalidate();
      setCreateDialog(false);
      setCreateForm({ version: "", versionCode: "", changelog: "", mandatory: false, minVersionCode: "" });
    },
    onError: (err) => toastTrpcError(err),
  });

  const uploadMutation = trpc.mqttSoftwareVersion.uploadApk.useMutation({
    onSuccess: () => {
      toast.success(t("mqtt.versions.uploadSuccess"));
      utils.mqttSoftwareVersion.list.invalidate();
      setUploadVersionId(null);
    },
    onError: (err) => toastTrpcError(err),
  });

  const setLatestMutation = trpc.mqttSoftwareVersion.setLatest.useMutation({
    onSuccess: () => {
      toast.success(t("mqtt.versions.setLatestSuccess"));
      utils.mqttSoftwareVersion.list.invalidate();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteMutation = trpc.mqttSoftwareVersion.delete.useMutation({
    onSuccess: () => {
      toast.success(t("mqtt.versions.deleteSuccess"));
      utils.mqttSoftwareVersion.list.invalidate();
    },
    onError: (err) => toastTrpcError(err),
  });

  const pushUpdateMutation = trpc.mqttSoftwareVersion.pushUpdate.useMutation({
    onSuccess: (data) => {
      toast.success(t("mqtt.versions.pushSuccess", { succeeded: data.succeeded, total: data.total }));
      setPushDialog({ open: false, command: "CHECK_UPDATE" });
      setSelectedDeviceIds([]);
    },
    onError: (err) => toastTrpcError(err),
  });

  // ─── FactoryAlert Version Management ───
  const [factoryAlertPushing, setFactoryAlertPushing] = useState(false);
  const [factoryAlertUploading, setFactoryAlertUploading] = useState(false);
  const [faCreateDialog, setFaCreateDialog] = useState(false);
  const factoryAlertFileRef = useRef<HTMLInputElement>(null);
  const [faUploadForm, setFaUploadForm] = useState({
    version: "",
    versionCode: "",
    changelog: "",
    mandatory: false,
  });
  const queryClient = useQueryClient();

  const { data: faVersions = [], isLoading: faLoading } = useQuery({
    queryKey: ["factoryAlertVersions"],
    queryFn: async () => {
      const res = await fetch("/api/factory-alert/versions");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const handleFactoryAlertUpload = async (file: File) => {
    const { version, versionCode, changelog, mandatory } = faUploadForm;
    if (!version || !versionCode) {
      toast.error(t("mqtt.versions.faFillRequired"));
      return;
    }
    setFactoryAlertUploading(true);
    try {
      const params = new URLSearchParams({
        version,
        versionCode,
        changelog: changelog || `Release v${version}`,
        mandatory: mandatory ? "true" : "false",
      });
      const res = await fetch(`/api/factory-alert/upload?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: file,
      });
      const data = await res.json();
      if (data.success) {
        toast.success(t("softwareVersions.uploadOk", { version: data.version, size: data.fileSize }));
        queryClient.invalidateQueries({ queryKey: ["factoryAlertVersions"] });
        setFaUploadForm({ version: "", versionCode: "", changelog: "", mandatory: false });
        setFaCreateDialog(false);
      } else {
        toast.error(data.error || "Upload failed");
      }
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    } finally {
      setFactoryAlertUploading(false);
    }
  };

  const handleFactoryAlertPush = async () => {
    setFactoryAlertPushing(true);
    try {
      const res = await fetch("/api/factory-alert/push-update", { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(t("mqtt.versions.factoryAlertPushSuccess", { version: data.version }));
      } else {
        toast.error(data.error || "Push update failed");
      }
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    } finally {
      setFactoryAlertPushing(false);
    }
  };

  const handleFaActivate = async (id: number) => {
    try {
      const res = await fetch(`/api/factory-alert/versions/${id}/activate`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(t("mqtt.versions.faActivateSuccess", { version: data.version?.version }));
        queryClient.invalidateQueries({ queryKey: ["factoryAlertVersions"] });
      } else {
        toast.error(data.error);
      }
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  };

  const handleFaDeactivate = async (id: number) => {
    try {
      const res = await fetch(`/api/factory-alert/versions/${id}/deactivate`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast.success(t("mqtt.versions.faDeactivateSuccess"));
        queryClient.invalidateQueries({ queryKey: ["factoryAlertVersions"] });
      } else {
        toast.error(data.error);
      }
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  };

  const handleFaDelete = async (id: number, version: string) => {
    if (!confirm(t("mqtt.versions.faDeleteConfirm", { version }))) return;
    try {
      const res = await fetch(`/api/factory-alert/versions/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast.success(t("mqtt.versions.faDeleteSuccess", { version }));
        queryClient.invalidateQueries({ queryKey: ["factoryAlertVersions"] });
      } else {
        toast.error(data.error);
      }
    } catch (err: any) {
      toast.error(mapTrpcError(err));
    }
  };

  // ─── Handlers ───
  const handleCreate = () => {
    createMutation.mutate({
      version: createForm.version,
      versionCode: parseInt(createForm.versionCode),
      changelog: createForm.changelog || undefined,
      mandatory: createForm.mandatory,
      minVersionCode: createForm.minVersionCode ? parseInt(createForm.minVersionCode) : undefined,
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadVersionId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      uploadMutation.mutate({
        versionId: uploadVersionId,
        fileName: file.name,
        fileBase64: base64,
      });
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const approvedClients = clients.filter((c: any) => c.approvalStatus === "APPROVED" && c.isActive);

  return (
    <div className="space-y-4">
      {/* Version Distribution Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">{t("mqtt.versions.distribution")}</CardTitle>
            <CardDescription>{t("mqtt.versions.distributionDesc")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setPushDialog({ open: true, command: "CHECK_UPDATE" })}>
              <RefreshCw className="w-4 h-4 mr-1" />
              {t("mqtt.versions.checkUpdate")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPushDialog({ open: true, command: "FORCE_UPDATE" })}>
              <Send className="w-4 h-4 mr-1" />
              {t("mqtt.versions.forceUpdate")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {versionSummary.length > 0 ? (
              versionSummary.map((s: any) => (
                <div key={s.appVersion || "unknown"} className="flex items-center gap-2 px-3 py-2 bg-muted rounded-md">
                  <Package className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{s.appVersion || t("mqtt.versions.unknown")}</span>
                  <Badge variant="secondary">{s.count}</Badge>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{t("mqtt.versions.noDevices")}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Versions Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg">{t("mqtt.versions.title")}</CardTitle>
            <CardDescription>{t("mqtt.versions.desc")}</CardDescription>
          </div>
          <Button onClick={() => setCreateDialog(true)}>
            <Package className="w-4 h-4 mr-1" />
            {t("mqtt.versions.addVersion")}
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("mqtt.versions.version")}</TableHead>
                <TableHead>{t("mqtt.versions.code")}</TableHead>
                <TableHead>{t("mqtt.versions.releaseDate")}</TableHead>
                <TableHead>APK</TableHead>
                <TableHead>{t("mqtt.versions.mandatory")}</TableHead>
                <TableHead>{t("mqtt.versions.status")}</TableHead>
                <TableHead className="text-right">{t("mqtt.versions.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t("mqtt.versions.loading")}
                  </TableCell>
                </TableRow>
              ) : versions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t("mqtt.versions.noVersions")}
                  </TableCell>
                </TableRow>
              ) : (
                versions.map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      v{v.version}
                      {v.isLatest && (
                        <Badge variant="default" className="ml-2 text-xs">
                          <Star className="w-3 h-3 mr-1" />
                          Latest
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{v.versionCode}</TableCell>
                    <TableCell>
                      {v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell>
                      {v.apkFileName ? (
                        <div className="flex items-center gap-2">
                          <span className="text-sm truncate max-w-37.5" title={v.apkFileName}>
                            {v.apkFileName}
                          </span>
                          <Badge variant="outline">{formatFileSize(v.fileSize)}</Badge>
                          {v.apkFileUrl && (
                            <a href={v.apkFileUrl} download className="text-blue-500 hover:text-blue-700">
                              <Download className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-yellow-600">
                          {t("mqtt.versions.noApk")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.mandatory ? (
                        <Badge variant="destructive">{t("mqtt.versions.required")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("mqtt.versions.optional")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.isLatest ? (
                        <Badge className="bg-green-100 text-green-800">{t("mqtt.versions.active")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("mqtt.versions.inactive")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setUploadVersionId(v.id);
                            fileInputRef.current?.click();
                          }}
                          title={t("mqtt.versions.uploadApk")}
                        >
                          <Upload className="w-4 h-4" />
                        </Button>
                        {!v.isLatest && v.apkFileUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLatestMutation.mutate({ id: v.id })}
                            title={t("mqtt.versions.setAsLatest")}
                          >
                            <Star className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteMutation.mutate({ id: v.id })}
                          className="text-destructive hover:text-destructive"
                          title={t("mqtt.versions.deleteVersion")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Hidden file input for APK upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".apk"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Create Version Dialog */}
      <Dialog open={createDialog} onOpenChange={setCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.versions.addVersion")}</DialogTitle>
            <DialogDescription>{t("mqtt.versions.addVersionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("mqtt.versions.version")}</Label>
                <Input
                  placeholder="1.2.0"
                  value={createForm.version}
                  onChange={(e) => setCreateForm((f) => ({ ...f, version: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("mqtt.versions.code")}</Label>
                <Input
                  type="number"
                  placeholder="3"
                  value={createForm.versionCode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, versionCode: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("mqtt.versions.changelog")}</Label>
              <Textarea
                placeholder={t("mqtt.versions.changelogPlaceholder")}
                rows={4}
                value={createForm.changelog}
                onChange={(e) => setCreateForm((f) => ({ ...f, changelog: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  checked={createForm.mandatory}
                  onCheckedChange={(v) => setCreateForm((f) => ({ ...f, mandatory: v }))}
                />
                <Label>{t("mqtt.versions.mandatory")}</Label>
              </div>
              <div className="space-y-2">
                <Label>{t("mqtt.versions.minVersionCode")}</Label>
                <Input
                  type="number"
                  placeholder={t("mqtt.versions.minVersionCodePlaceholder")}
                  value={createForm.minVersionCode}
                  onChange={(e) => setCreateForm((f) => ({ ...f, minVersionCode: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialog(false)}>
              {t("mqtt.versions.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!createForm.version || !createForm.versionCode || createMutation.isPending}
            >
              {t("mqtt.versions.create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Push Update Dialog */}
      <Dialog open={pushDialog.open} onOpenChange={(open) => setPushDialog((p) => ({ ...p, open }))}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {pushDialog.command === "FORCE_UPDATE"
                ? t("mqtt.versions.forceUpdateTitle")
                : t("mqtt.versions.checkUpdateTitle")}
            </DialogTitle>
            <DialogDescription>
              {pushDialog.command === "FORCE_UPDATE"
                ? t("mqtt.versions.forceUpdateDesc")
                : t("mqtt.versions.checkUpdateDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-75 overflow-y-auto">
            <div className="flex items-center gap-2 pb-2 border-b">
              <Checkbox
                checked={selectedDeviceIds.length === approvedClients.length && approvedClients.length > 0}
                onCheckedChange={(checked) => {
                  setSelectedDeviceIds(checked ? approvedClients.map((c: any) => c.deviceId) : []);
                }}
              />
              <Label className="font-medium">
                {t("mqtt.versions.selectAll")} ({approvedClients.length})
              </Label>
            </div>
            {approvedClients.map((c: any) => (
              <div key={c.deviceId} className="flex items-center gap-2">
                <Checkbox
                  checked={selectedDeviceIds.includes(c.deviceId)}
                  onCheckedChange={(checked) => {
                    setSelectedDeviceIds((prev) =>
                      checked ? [...prev, c.deviceId] : prev.filter((id) => id !== c.deviceId)
                    );
                  }}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {c.deviceName || c.deviceId}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    v{c.appVersion || "?"} • {c.deviceModel || ""}
                  </p>
                </div>
                <Badge variant={c.connectionStatus === "ONLINE" ? "default" : "outline"} className="text-xs">
                  {c.connectionStatus}
                </Badge>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPushDialog({ open: false, command: "CHECK_UPDATE" })}>
              {t("mqtt.versions.cancel")}
            </Button>
            <Button
              onClick={() =>
                pushUpdateMutation.mutate({
                  deviceIds: selectedDeviceIds,
                  command: pushDialog.command,
                })
              }
              disabled={selectedDeviceIds.length === 0 || pushUpdateMutation.isPending}
              variant={pushDialog.command === "FORCE_UPDATE" ? "destructive" : "default"}
            >
              <Send className="w-4 h-4 mr-1" />
              {t("mqtt.versions.sendToDevices", { count: selectedDeviceIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* FactoryAlertSystem OTA Management */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Smartphone className="w-5 h-5" />
              FactoryAlertSystem OTA
            </CardTitle>
            <CardDescription>{t("mqtt.versions.factoryAlertDesc")}</CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setFaCreateDialog(true)}>
              <Package className="w-4 h-4 mr-1" />
              {t("mqtt.versions.addVersion")}
            </Button>
            <Button
              size="sm"
              onClick={handleFactoryAlertPush}
              disabled={factoryAlertPushing || !faVersions.some((v: any) => v.isActive)}
            >
              <Send className="w-4 h-4 mr-1" />
              {t("mqtt.versions.pushUpdateToAllDevices")}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("mqtt.versions.version")}</TableHead>
                <TableHead>{t("mqtt.versions.code")}</TableHead>
                <TableHead>{t("mqtt.versions.releaseDate")}</TableHead>
                <TableHead>{t("mqtt.versions.changelog")}</TableHead>
                <TableHead>APK</TableHead>
                <TableHead>{t("mqtt.versions.mandatory")}</TableHead>
                <TableHead>{t("mqtt.versions.status")}</TableHead>
                <TableHead className="text-right">{t("mqtt.versions.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {faLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {t("mqtt.versions.loading")}
                  </TableCell>
                </TableRow>
              ) : faVersions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    {t("mqtt.versions.factoryAlertNoVersion")}
                  </TableCell>
                </TableRow>
              ) : (
                faVersions.map((v: any) => (
                  <TableRow key={v.id} className={v.isActive ? "bg-green-50 dark:bg-green-950/20" : ""}>
                    <TableCell className="font-medium">
                      v{v.version}
                      {v.isActive && (
                        <Badge variant="default" className="ml-2 text-xs">
                          <Star className="w-3 h-3 mr-1" />
                          Latest
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{v.versionCode}</TableCell>
                    <TableCell>
                      {v.releaseDate ? new Date(v.releaseDate).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="max-w-50 truncate text-muted-foreground" title={v.changelog}>
                      {v.changelog || "-"}
                    </TableCell>
                    <TableCell>
                      <a
                        href={`/api/factory-alert/download/${v.version}/${v.apkFileName}`}
                        download
                        className="text-blue-500 hover:text-blue-700 inline-flex items-center gap-1 text-xs"
                      >
                        <Download className="w-3 h-3" />
                        {v.fileSize ? `${v.fileSize} MB` : "APK"}
                      </a>
                    </TableCell>
                    <TableCell>
                      {v.mandatory ? (
                        <Badge variant="destructive">{t("mqtt.versions.required")}</Badge>
                      ) : (
                        <Badge variant="secondary">{t("mqtt.versions.optional")}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {v.isActive ? (
                        <Badge className="bg-green-100 text-green-800">{t("mqtt.versions.active")}</Badge>
                      ) : (
                        <Badge variant="outline">{t("mqtt.versions.inactive")}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {v.isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleFaDeactivate(v.id)}
                            title={t("mqtt.versions.faDeactivate")}
                          >
                            <PowerOff className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleFaActivate(v.id)}
                            title={t("mqtt.versions.faActivate")}
                          >
                            <Power className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleFaDelete(v.id, v.version)}
                          disabled={v.isActive}
                          className="text-destructive hover:text-destructive"
                          title={t("mqtt.versions.deleteVersion")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

        </CardContent>
      </Card>

      {/* FactoryAlert Create Version Dialog */}
      <Dialog open={faCreateDialog} onOpenChange={setFaCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("mqtt.versions.addVersion")} — FactoryAlert</DialogTitle>
            <DialogDescription>{t("mqtt.versions.factoryAlertUploadTitle")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t("mqtt.versions.version")}</Label>
                <Input
                  placeholder="1.0.2"
                  value={faUploadForm.version}
                  onChange={(e) => setFaUploadForm((f) => ({ ...f, version: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("mqtt.versions.code")}</Label>
                <Input
                  type="number"
                  placeholder="3"
                  value={faUploadForm.versionCode}
                  onChange={(e) => setFaUploadForm((f) => ({ ...f, versionCode: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("mqtt.versions.changelog")}</Label>
              <Textarea
                placeholder="Bug fixes, new features..."
                rows={3}
                value={faUploadForm.changelog}
                onChange={(e) => setFaUploadForm((f) => ({ ...f, changelog: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={faUploadForm.mandatory}
                onCheckedChange={(v) => setFaUploadForm((f) => ({ ...f, mandatory: v }))}
              />
              <Label>{t("mqtt.versions.mandatory")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFaCreateDialog(false)}>
              {t("mqtt.versions.cancel")}
            </Button>
            <Button
              onClick={() => factoryAlertFileRef.current?.click()}
              disabled={!faUploadForm.version || !faUploadForm.versionCode || factoryAlertUploading}
            >
              <Upload className="w-4 h-4 mr-1" />
              {factoryAlertUploading ? "Uploading..." : t("mqtt.versions.factoryAlertUploadApk")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <input
        ref={factoryAlertFileRef}
        type="file"
        accept=".apk"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFactoryAlertUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
