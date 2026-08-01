/**
 * Sprint G2.2a — Device Adapter & Tag management (CONFIG only).
 *
 * This page manages OT adapter connection definitions + their tag definitions, and
 * runs a READ-ONLY connectivity probe (testConnection). It NEVER writes a value to a
 * machine — actual writes go through the HITL / interlock dispatcher elsewhere. The
 * `writable` flag on a tag only DECLARES that the tag may be a write target.
 *
 * RBAC: module 'machine_control' — create/edit/delete buttons are hidden unless the
 * user has the matching grant. View requires canView.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, StatusBadge } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plug, Plus, Pencil, Trash2, Tags as TagsIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import ManualHelp from "@/components/ManualHelp";
import JsonSchemaForm, { jsonSchemaDefaults } from "@/components/JsonSchemaForm";

const PROTOCOLS = ["stub", "opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip"] as const;
const DATA_TYPES = ["bool", "int", "float", "string", "json"] as const;

// doc 37 B1: manifest-declared default ports (fallback when the connector manifest
// catalogue is unavailable). Mirrors server/services/plugins/otConnectorManifests.ts.
const PROTOCOL_DEFAULT_PORT: Record<string, number> = {
  opcua: 4840, modbus: 502, s7: 102, "mitsubishi-mc": 5007, "ethernet-ip": 44818, "omron-njnx": 44818,
};
// Endpoint URI scheme per protocol (so host+port from the auto-form compose an endpoint).
const ENDPOINT_SCHEME: Record<string, string> = {
  opcua: "opc.tcp", modbus: "tcp", s7: "tcp", "mitsubishi-mc": "tcp",
  "ethernet-ip": "tcp", "omron-njnx": "tcp", stub: "stub",
};
// Protocol → manual-KB vendor hint (soft pre-filter; unknown → widened search).
const PROTOCOL_VENDOR_HINT: Record<string, string | undefined> = {
  s7: "siemens", "mitsubishi-mc": "mitsubishi", "omron-njnx": "omron",
};

type Protocol = (typeof PROTOCOLS)[number];
type DataType = (typeof DATA_TYPES)[number];

/** Compose an endpoint string from the auto-form host/port (empty host → keep manual value). */
function composeEndpoint(protocol: string, host: string, port: number | undefined): string {
  if (protocol === "stub") return "stub://x";
  const h = host.trim();
  if (!h) return "";
  const scheme = ENDPOINT_SCHEME[protocol] ?? "tcp";
  return port ? `${scheme}://${h}:${port}` : `${scheme}://${h}`;
}

interface AdapterForm {
  id?: number;
  code: string;
  name: string;
  protocol: Protocol;
  endpoint: string;
  pollIntervalMs: number;
  machineId: string;
  isEnabled: boolean;
}

interface TagForm {
  id?: number;
  tagKey: string;
  address: string;
  dataType: DataType;
  unit: string;
  scale: string;
  offset: string;
  writable: boolean;
  isEnabled: boolean;
}

const emptyAdapter: AdapterForm = {
  code: "", name: "", protocol: "stub", endpoint: "", pollIntervalMs: 5000, machineId: "", isEnabled: false,
};
const emptyTag: TagForm = {
  tagKey: "", address: "", dataType: "float", unit: "", scale: "", offset: "", writable: false, isEnabled: true,
};

export default function DeviceAdapterManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const adaptersQuery = trpc.deviceAdapter.list.useQuery();

  // doc 37 B1: OT connector manifest catalogue → manifest-driven auto-form + default ports.
  const connectorsQuery = trpc.plugin.listByKind.useQuery({ kind: "device-connector" });
  const connectorManifests = (connectorsQuery.data ?? []) as Array<{
    id: string; name: string; protocols?: string[]; configSchema?: Record<string, unknown> | null;
  }>;
  const manifestForProtocol = (p: string) =>
    connectorManifests.find((m) => (m.protocols ?? []).includes(p));

  // ── Adapter dialog state ──
  const [adapterOpen, setAdapterOpen] = useState(false);
  const [adapterForm, setAdapterForm] = useState<AdapterForm>(emptyAdapter);
  // Manifest auto-form values (host/port/…); host+port feed the endpoint string.
  const [connectorConfig, setConnectorConfig] = useState<Record<string, unknown>>({});

  // ── Delete confirmation state ──
  const [adapterToDelete, setAdapterToDelete] = useState<{ id: number; code: string } | null>(null);
  const [tagToDelete, setTagToDelete] = useState<{ id: number; tagKey: string } | null>(null);

  // ── Tag drawer state ──
  const [tagSheetAdapterId, setTagSheetAdapterId] = useState<number | null>(null);
  const [tagForm, setTagForm] = useState<TagForm>(emptyTag);
  const tagsQuery = trpc.deviceAdapter.tags.listByAdapter.useQuery(
    { adapterId: tagSheetAdapterId ?? 0 },
    { enabled: tagSheetAdapterId != null },
  );

  const invalidateAdapters = () => void utils.deviceAdapter.list.invalidate();
  const invalidateTags = () => {
    if (tagSheetAdapterId != null) void utils.deviceAdapter.tags.listByAdapter.invalidate({ adapterId: tagSheetAdapterId });
  };

  const createAdapter = trpc.deviceAdapter.create.useMutation({
    onSuccess: () => { toast.success(t("deviceAdapter.toast.created", "Đã tạo adapter")); setAdapterOpen(false); invalidateAdapters(); },
    onError: (e) => toast.error(e.message),
  });
  const updateAdapter = trpc.deviceAdapter.update.useMutation({
    onSuccess: () => { toast.success(t("deviceAdapter.toast.updated", "Đã cập nhật adapter")); setAdapterOpen(false); invalidateAdapters(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteAdapter = trpc.deviceAdapter.delete.useMutation({
    onSuccess: () => { toast.success(t("deviceAdapter.toast.deleted", "Đã xoá adapter")); invalidateAdapters(); },
    onError: (e) => toast.error(e.message),
  });
  const testConnection = trpc.deviceAdapter.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) toast.success(t("deviceAdapter.toast.connOk", "Kết nối OK ({{ms}}ms)", { ms: res.latencyMs }));
      else toast.error(t("deviceAdapter.toast.connFail", "Kết nối thất bại: {{err}}", { err: res.error ?? "unknown" }));
    },
    onError: (e) => toast.error(e.message),
  });

  const createTag = trpc.deviceAdapter.tags.create.useMutation({
    onSuccess: () => { toast.success(t("deviceAdapter.toast.tagCreated", "Đã tạo tag")); setTagForm(emptyTag); invalidateTags(); },
    onError: (e) => toast.error(e.message),
  });
  const updateTag = trpc.deviceAdapter.tags.update.useMutation({
    onSuccess: () => { toast.success(t("deviceAdapter.toast.tagUpdated", "Đã cập nhật tag")); setTagForm(emptyTag); invalidateTags(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteTag = trpc.deviceAdapter.tags.delete.useMutation({
    onSuccess: () => { toast.success(t("deviceAdapter.toast.tagDeleted", "Đã xoá tag")); invalidateTags(); },
    onError: (e) => toast.error(e.message),
  });

  /** Seed the manifest auto-form (defaults + declared/fallback default port) for a protocol. */
  const configForProtocol = (p: string): Record<string, unknown> => {
    const schema = manifestForProtocol(p)?.configSchema ?? null;
    const cfg = jsonSchemaDefaults(schema);
    const declaredPort = (schema as any)?.properties?.port?.default;
    const port = declaredPort ?? PROTOCOL_DEFAULT_PORT[p];
    if (port != null) cfg.port = port;
    return cfg;
  };

  const openCreateAdapter = () => {
    setAdapterForm(emptyAdapter);
    setConnectorConfig(configForProtocol(emptyAdapter.protocol));
    setAdapterOpen(true);
  };
  const openEditAdapter = (a: any) => {
    setAdapterForm({
      id: a.id, code: a.code, name: a.name, protocol: a.protocol, endpoint: a.endpoint,
      pollIntervalMs: a.pollIntervalMs, machineId: a.machineId != null ? String(a.machineId) : "", isEnabled: a.isEnabled,
    });
    // Best-effort: seed defaults (endpoint is preserved — we never clobber a saved endpoint).
    setConnectorConfig(configForProtocol(a.protocol));
    setAdapterOpen(true);
  };

  // Protocol change: reseed the auto-form + default port; only fill endpoint if still blank.
  const handleProtocolChange = (p: Protocol) => {
    const cfg = configForProtocol(p);
    setConnectorConfig(cfg);
    setAdapterForm((f) => {
      const host = typeof cfg.host === "string" ? cfg.host : "";
      const ep = composeEndpoint(p, host, Number(cfg.port) || undefined);
      return { ...f, protocol: p, endpoint: f.endpoint.trim() ? f.endpoint : ep };
    });
  };

  // Auto-form change: keep endpoint in sync from host+port (only once a host is present).
  const handleConfigChange = (next: Record<string, unknown>) => {
    setConnectorConfig(next);
    const host = typeof next.host === "string" ? next.host : "";
    const port = Number(next.port) || PROTOCOL_DEFAULT_PORT[adapterForm.protocol];
    const ep = composeEndpoint(adapterForm.protocol, host, port);
    if (ep) setAdapterForm((f) => ({ ...f, endpoint: ep }));
  };

  const submitAdapter = () => {
    const machineId = adapterForm.machineId.trim() ? Number(adapterForm.machineId) : null;
    const base = {
      code: adapterForm.code.trim(),
      name: adapterForm.name.trim(),
      protocol: adapterForm.protocol,
      endpoint: adapterForm.endpoint.trim(),
      pollIntervalMs: Number(adapterForm.pollIntervalMs) || 5000,
      machineId,
      isEnabled: adapterForm.isEnabled,
    };
    if (adapterForm.id != null) updateAdapter.mutate({ id: adapterForm.id, ...base });
    else createAdapter.mutate(base);
  };

  const submitTag = () => {
    if (tagSheetAdapterId == null) return;
    const base = {
      tagKey: tagForm.tagKey.trim(),
      address: tagForm.address.trim(),
      dataType: tagForm.dataType,
      unit: tagForm.unit.trim() || null,
      scale: tagForm.scale.trim() ? Number(tagForm.scale) : null,
      offset: tagForm.offset.trim() ? Number(tagForm.offset) : null,
      writable: tagForm.writable,
      isEnabled: tagForm.isEnabled,
    };
    if (tagForm.id != null) updateTag.mutate({ id: tagForm.id, ...base });
    else createTag.mutate({ adapterId: tagSheetAdapterId, ...base });
  };

  const adapters = adaptersQuery.data ?? [];
  const tags = tagsQuery.data ?? [];

  return (
    <DashboardLayout title="Device Adapter (OT)" navItems={navItems} currentPath="/device-adapters">
    <PageContainer>
      <PageHeader
        icon={<Plug className="h-6 w-6" />}
        title="Device Adapter (OT)"
        badge={<ViewOnlyBadge module="machine_control" />}
        description={t("deviceAdapter.subtitle", "Quản lý CẤU HÌNH kết nối OT + định nghĩa tag. Trang này KHÔNG ghi lệnh xuống máy — lệnh ghi đi qua luồng HITL/interlock.")}
        actions={
          canCreate ? (
            <Button onClick={openCreateAdapter}>
              <Plus className="h-4 w-4 mr-1" /> {t("deviceAdapter.addAdapter", "Thêm adapter")}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader><CardTitle>{t("deviceAdapter.adaptersTitle", "Adapter")} ({adapters.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("deviceAdapter.col.code", "Mã")}</TableHead>
                <TableHead>{t("deviceAdapter.col.name", "Tên")}</TableHead>
                <TableHead>{t("deviceAdapter.col.protocol", "Giao thức")}</TableHead>
                <TableHead>{t("deviceAdapter.col.endpoint", "Endpoint")}</TableHead>
                <TableHead>{t("common.status", "Trạng thái")}</TableHead>
                <TableHead>{t("deviceAdapter.col.enabled", "Bật")}</TableHead>
                <TableHead>{t("deviceAdapter.col.machine", "Máy")}</TableHead>
                <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adapters.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{t("deviceAdapter.empty", "Chưa có adapter.")}</TableCell></TableRow>
              )}
              {adapters.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell><Badge variant="outline">{a.protocol}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate" title={a.endpoint}>{a.endpoint}</TableCell>
                  <TableCell><StatusBadge status={a.status} tone={a.status === "connected" ? "success" : "default"} /></TableCell>
                  <TableCell>
                    <Switch
                      checked={a.isEnabled}
                      disabled={!canEdit || updateAdapter.isPending}
                      onCheckedChange={(v) => updateAdapter.mutate({ id: a.id, isEnabled: v })}
                    />
                  </TableCell>
                  <TableCell>{a.machineId ?? "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="sm" variant="outline"
                      disabled={testConnection.isPending}
                      onClick={() => testConnection.mutate({ id: a.id })}>
                      {t("deviceAdapter.test", "Kiểm tra")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setTagSheetAdapterId(a.id)}>
                      <TagsIcon className="h-4 w-4" />
                    </Button>
                    {canEdit && (
                      <Button size="sm" variant="outline" onClick={() => openEditAdapter(a)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete && (
                      <Button size="sm" variant="destructive"
                        disabled={deleteAdapter.isPending}
                        onClick={() => setAdapterToDelete({ id: a.id, code: a.code })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Adapter create/edit dialog ── */}
      <Dialog open={adapterOpen} onOpenChange={setAdapterOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{adapterForm.id != null ? t("deviceAdapter.editAdapter", "Sửa adapter") : t("deviceAdapter.addAdapter", "Thêm adapter")}</DialogTitle>
            <DialogDescription>{t("deviceAdapter.dialogDesc", "Định nghĩa kết nối OT. Bật adapter để bắt đầu polling.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t("deviceAdapter.col.code", "Mã")}</Label>
              <Input value={adapterForm.code} disabled={adapterForm.id != null}
                onChange={(e) => setAdapterForm({ ...adapterForm, code: e.target.value })} />
            </div>
            <div>
              <Label>{t("deviceAdapter.col.name", "Tên")}</Label>
              <Input value={adapterForm.name} onChange={(e) => setAdapterForm({ ...adapterForm, name: e.target.value })} />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>{t("deviceAdapter.col.protocol", "Giao thức")}</Label>
                {/* doc 37 B1: page-cited manual help for the selected protocol. */}
                <ManualHelp
                  vendor={PROTOCOL_VENDOR_HINT[adapterForm.protocol] ?? adapterForm.protocol}
                  query={`${adapterForm.protocol} default port register map connection settings`}
                  buttonLabel={t("deviceAdapter.manualHelp", "Sổ tay")}
                  size="sm"
                  variant="ghost"
                />
              </div>
              <Select value={adapterForm.protocol} onValueChange={(v) => handleProtocolChange(v as Protocol)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* doc 37 B1: manifest-driven auto-form (host/port/…). host+port compose the endpoint. */}
            {(() => {
              const schema = manifestForProtocol(adapterForm.protocol)?.configSchema;
              if (!schema) return null;
              return (
                <div className="rounded-md border bg-muted/20 p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("deviceAdapter.autoForm", "Cấu hình theo manifest (tự sinh) — host + cổng sẽ tạo endpoint bên dưới")}
                  </p>
                  <JsonSchemaForm schema={schema} value={connectorConfig} onChange={handleConfigChange} />
                </div>
              );
            })()}

            <div>
              <Label>{t("deviceAdapter.col.endpoint", "Endpoint")}</Label>
              <Input value={adapterForm.endpoint} placeholder="opc.tcp://… / tcp://host:port / stub://x"
                onChange={(e) => setAdapterForm({ ...adapterForm, endpoint: e.target.value })} />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t("deviceAdapter.defaultPortHint", "Cổng mặc định {{protocol}}: {{port}}", {
                  protocol: adapterForm.protocol,
                  port: PROTOCOL_DEFAULT_PORT[adapterForm.protocol] ?? "—",
                })}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("deviceAdapter.pollMs", "Poll (ms)")}</Label>
                <Input type="number" value={adapterForm.pollIntervalMs}
                  onChange={(e) => setAdapterForm({ ...adapterForm, pollIntervalMs: Number(e.target.value) })} />
              </div>
              <div>
                <Label>{t("deviceAdapter.machineId", "Machine ID")}</Label>
                <Input value={adapterForm.machineId} placeholder={t("common.optional", "(tùy chọn)")}
                  onChange={(e) => setAdapterForm({ ...adapterForm, machineId: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={adapterForm.isEnabled} onCheckedChange={(v) => setAdapterForm({ ...adapterForm, isEnabled: v })} />
              <Label>{t("deviceAdapter.enableAdapter", "Bật adapter")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline"
              disabled={testConnection.isPending || !adapterForm.endpoint.trim()}
              onClick={() => testConnection.mutate({ protocol: adapterForm.protocol, endpoint: adapterForm.endpoint.trim() })}>
              {t("deviceAdapter.testConn", "Kiểm tra kết nối")}
            </Button>
            <Button onClick={submitAdapter} disabled={createAdapter.isPending || updateAdapter.isPending}>{t("common.save", "Lưu")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Tag drawer ── */}
      <Sheet open={tagSheetAdapterId != null} onOpenChange={(o) => { if (!o) { setTagSheetAdapterId(null); setTagForm(emptyTag); } }}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("deviceAdapter.tagsTitle", "Tag của adapter")}</SheetTitle>
            <SheetDescription>{t("deviceAdapter.tagsDesc", "Định nghĩa điểm đọc/ghi.")}</SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("deviceAdapter.writableNote", "writable chỉ KHAI BÁO tag có thể là đích ghi; lệnh ghi thực tế chỉ thực hiện qua xác nhận HITL hoặc interlock đã duyệt.")}</span>
          </div>

          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("deviceAdapter.tag.tag", "Tag")}</TableHead>
                  <TableHead>{t("deviceAdapter.tag.address", "Địa chỉ")}</TableHead>
                  <TableHead>{t("deviceAdapter.tag.type", "Kiểu")}</TableHead>
                  <TableHead>{t("deviceAdapter.tag.writable", "Ghi được")}</TableHead>
                  <TableHead>{t("deviceAdapter.col.enabled", "Bật")}</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("deviceAdapter.tag.empty", "Chưa có tag.")}</TableCell></TableRow>
                )}
                {tags.map((tg) => (
                  <TableRow key={tg.id}>
                    <TableCell className="font-medium">{tg.tagKey}</TableCell>
                    <TableCell>{tg.address}</TableCell>
                    <TableCell><Badge variant="outline">{tg.dataType}</Badge></TableCell>
                    <TableCell>
                      <Switch checked={tg.writable} disabled={!canEdit || updateTag.isPending}
                        onCheckedChange={(v) => updateTag.mutate({ id: tg.id, writable: v })} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={tg.isEnabled} disabled={!canEdit || updateTag.isPending}
                        onCheckedChange={(v) => updateTag.mutate({ id: tg.id, isEnabled: v })} />
                    </TableCell>
                    <TableCell>
                      {canDelete && (
                        <Button size="sm" variant="destructive" disabled={deleteTag.isPending}
                          onClick={() => setTagToDelete({ id: tg.id, tagKey: tg.tagKey })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {canCreate && (
            <div className="mt-6 space-y-3 border-t pt-4">
              <div className="font-medium">{t("deviceAdapter.addTag", "Thêm tag")}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>{t("deviceAdapter.tag.key", "Tag key")}</Label>
                  <Input value={tagForm.tagKey} onChange={(e) => setTagForm({ ...tagForm, tagKey: e.target.value })} />
                </div>
                <div>
                  <Label>{t("deviceAdapter.tag.address", "Địa chỉ")}</Label>
                  <Input value={tagForm.address} onChange={(e) => setTagForm({ ...tagForm, address: e.target.value })} />
                </div>
                <div>
                  <Label>{t("deviceAdapter.tag.dataType", "Kiểu dữ liệu")}</Label>
                  <Select value={tagForm.dataType} onValueChange={(v) => setTagForm({ ...tagForm, dataType: v as DataType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DATA_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("deviceAdapter.tag.unit", "Đơn vị")}</Label>
                  <Input value={tagForm.unit} onChange={(e) => setTagForm({ ...tagForm, unit: e.target.value })} />
                </div>
                <div>
                  <Label>{t("deviceAdapter.tag.scale", "Scale")}</Label>
                  <Input value={tagForm.scale} onChange={(e) => setTagForm({ ...tagForm, scale: e.target.value })} />
                </div>
                <div>
                  <Label>{t("deviceAdapter.tag.offset", "Offset")}</Label>
                  <Input value={tagForm.offset} onChange={(e) => setTagForm({ ...tagForm, offset: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={tagForm.writable} onCheckedChange={(v) => setTagForm({ ...tagForm, writable: v })} />
                  <Label>{t("deviceAdapter.tag.writable", "Ghi được")}</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={tagForm.isEnabled} onCheckedChange={(v) => setTagForm({ ...tagForm, isEnabled: v })} />
                  <Label>{t("deviceAdapter.col.enabled", "Bật")}</Label>
                </div>
              </div>
              <Button onClick={submitTag} disabled={createTag.isPending || !tagForm.tagKey.trim() || !tagForm.address.trim()}>
                {t("deviceAdapter.addTag", "Thêm tag")}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Delete adapter confirmation ── */}
      <AlertDialog open={adapterToDelete != null} onOpenChange={(o) => { if (!o) setAdapterToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deviceAdapter.deleteAdapterTitle", "Xoá adapter?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deviceAdapter.deleteAdapterDesc", "Xoá adapter \"{{code}}\"? Hành động này không thể hoàn tác.", { code: adapterToDelete?.code ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (adapterToDelete) deleteAdapter.mutate({ id: adapterToDelete.id }); setAdapterToDelete(null); }}
            >
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete tag confirmation ── */}
      <AlertDialog open={tagToDelete != null} onOpenChange={(o) => { if (!o) setTagToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deviceAdapter.deleteTagTitle", "Xoá tag?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deviceAdapter.deleteTagDesc", "Xoá tag \"{{key}}\"? Hành động này không thể hoàn tác.", { key: tagToDelete?.tagKey ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (tagToDelete) deleteTag.mutate({ id: tagToDelete.id }); setTagToDelete(null); }}
            >
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
    </DashboardLayout>
  );
}
