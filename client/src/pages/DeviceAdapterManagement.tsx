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
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
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
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plug, Plus, Pencil, Trash2, Tags as TagsIcon, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

const PROTOCOLS = ["stub", "opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip"] as const;
const DATA_TYPES = ["bool", "int", "float", "string", "json"] as const;

type Protocol = (typeof PROTOCOLS)[number];
type DataType = (typeof DATA_TYPES)[number];

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
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const adaptersQuery = trpc.deviceAdapter.list.useQuery();

  // ── Adapter dialog state ──
  const [adapterOpen, setAdapterOpen] = useState(false);
  const [adapterForm, setAdapterForm] = useState<AdapterForm>(emptyAdapter);

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
    onSuccess: () => { toast.success("Đã tạo adapter"); setAdapterOpen(false); invalidateAdapters(); },
    onError: (e) => toast.error(e.message),
  });
  const updateAdapter = trpc.deviceAdapter.update.useMutation({
    onSuccess: () => { toast.success("Đã cập nhật adapter"); setAdapterOpen(false); invalidateAdapters(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteAdapter = trpc.deviceAdapter.delete.useMutation({
    onSuccess: () => { toast.success("Đã xoá adapter"); invalidateAdapters(); },
    onError: (e) => toast.error(e.message),
  });
  const testConnection = trpc.deviceAdapter.testConnection.useMutation({
    onSuccess: (res) => {
      if (res.ok) toast.success(`Kết nối OK (${res.latencyMs}ms)`);
      else toast.error(`Kết nối thất bại: ${res.error ?? "unknown"}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const createTag = trpc.deviceAdapter.tags.create.useMutation({
    onSuccess: () => { toast.success("Đã tạo tag"); setTagForm(emptyTag); invalidateTags(); },
    onError: (e) => toast.error(e.message),
  });
  const updateTag = trpc.deviceAdapter.tags.update.useMutation({
    onSuccess: () => { toast.success("Đã cập nhật tag"); setTagForm(emptyTag); invalidateTags(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteTag = trpc.deviceAdapter.tags.delete.useMutation({
    onSuccess: () => { toast.success("Đã xoá tag"); invalidateTags(); },
    onError: (e) => toast.error(e.message),
  });

  const openCreateAdapter = () => { setAdapterForm(emptyAdapter); setAdapterOpen(true); };
  const openEditAdapter = (a: any) => {
    setAdapterForm({
      id: a.id, code: a.code, name: a.name, protocol: a.protocol, endpoint: a.endpoint,
      pollIntervalMs: a.pollIntervalMs, machineId: a.machineId != null ? String(a.machineId) : "", isEnabled: a.isEnabled,
    });
    setAdapterOpen(true);
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
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Plug className="h-6 w-6 text-rose-600" />
          <h1 className="text-2xl font-bold">Device Adapter (OT)</h1>
          <ViewOnlyBadge module="machine_control" />
        </div>
        {canCreate && (
          <Button onClick={openCreateAdapter}>
            <Plus className="h-4 w-4 mr-1" /> Thêm adapter
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Quản lý CẤU HÌNH kết nối OT + định nghĩa tag. Trang này KHÔNG ghi lệnh xuống máy — lệnh ghi đi qua luồng HITL/interlock.
      </p>

      <Card>
        <CardHeader><CardTitle>Adapter ({adapters.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Tên</TableHead>
                <TableHead>Protocol</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Bật</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adapters.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Chưa có adapter.</TableCell></TableRow>
              )}
              {adapters.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.code}</TableCell>
                  <TableCell>{a.name}</TableCell>
                  <TableCell><Badge variant="outline">{a.protocol}</Badge></TableCell>
                  <TableCell className="max-w-[200px] truncate" title={a.endpoint}>{a.endpoint}</TableCell>
                  <TableCell><Badge variant={a.status === "connected" ? "default" : "secondary"}>{a.status}</Badge></TableCell>
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
                      Test
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
                        onClick={() => { if (confirm(`Xoá adapter "${a.code}"?`)) deleteAdapter.mutate({ id: a.id }); }}>
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
            <DialogTitle>{adapterForm.id != null ? "Sửa adapter" : "Thêm adapter"}</DialogTitle>
            <DialogDescription>Định nghĩa kết nối OT. Bật adapter để bắt đầu polling.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Code</Label>
              <Input value={adapterForm.code} disabled={adapterForm.id != null}
                onChange={(e) => setAdapterForm({ ...adapterForm, code: e.target.value })} />
            </div>
            <div>
              <Label>Tên</Label>
              <Input value={adapterForm.name} onChange={(e) => setAdapterForm({ ...adapterForm, name: e.target.value })} />
            </div>
            <div>
              <Label>Protocol</Label>
              <Select value={adapterForm.protocol} onValueChange={(v) => setAdapterForm({ ...adapterForm, protocol: v as Protocol })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROTOCOLS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Endpoint</Label>
              <Input value={adapterForm.endpoint} placeholder="opc.tcp://… / tcp://host:port / stub://x"
                onChange={(e) => setAdapterForm({ ...adapterForm, endpoint: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Poll (ms)</Label>
                <Input type="number" value={adapterForm.pollIntervalMs}
                  onChange={(e) => setAdapterForm({ ...adapterForm, pollIntervalMs: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Machine ID</Label>
                <Input value={adapterForm.machineId} placeholder="(tùy chọn)"
                  onChange={(e) => setAdapterForm({ ...adapterForm, machineId: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={adapterForm.isEnabled} onCheckedChange={(v) => setAdapterForm({ ...adapterForm, isEnabled: v })} />
              <Label>Bật adapter</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline"
              disabled={testConnection.isPending || !adapterForm.endpoint.trim()}
              onClick={() => testConnection.mutate({ protocol: adapterForm.protocol, endpoint: adapterForm.endpoint.trim() })}>
              Test kết nối
            </Button>
            <Button onClick={submitAdapter} disabled={createAdapter.isPending || updateAdapter.isPending}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Tag drawer ── */}
      <Sheet open={tagSheetAdapterId != null} onOpenChange={(o) => { if (!o) { setTagSheetAdapterId(null); setTagForm(emptyTag); } }}>
        <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Tag của adapter</SheetTitle>
            <SheetDescription>Định nghĩa điểm đọc/ghi.</SheetDescription>
          </SheetHeader>

          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span><b>writable</b> chỉ KHAI BÁO tag có thể là đích ghi; lệnh ghi thực tế chỉ thực hiện qua xác nhận HITL hoặc interlock đã duyệt.</span>
          </div>

          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Kiểu</TableHead>
                  <TableHead>Writable</TableHead>
                  <TableHead>Bật</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tags.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Chưa có tag.</TableCell></TableRow>
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
                          onClick={() => { if (confirm(`Xoá tag "${tg.tagKey}"?`)) deleteTag.mutate({ id: tg.id }); }}>
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
              <div className="font-medium">Thêm tag</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Tag key</Label>
                  <Input value={tagForm.tagKey} onChange={(e) => setTagForm({ ...tagForm, tagKey: e.target.value })} />
                </div>
                <div>
                  <Label>Address</Label>
                  <Input value={tagForm.address} onChange={(e) => setTagForm({ ...tagForm, address: e.target.value })} />
                </div>
                <div>
                  <Label>Kiểu dữ liệu</Label>
                  <Select value={tagForm.dataType} onValueChange={(v) => setTagForm({ ...tagForm, dataType: v as DataType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DATA_TYPES.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Đơn vị</Label>
                  <Input value={tagForm.unit} onChange={(e) => setTagForm({ ...tagForm, unit: e.target.value })} />
                </div>
                <div>
                  <Label>Scale</Label>
                  <Input value={tagForm.scale} onChange={(e) => setTagForm({ ...tagForm, scale: e.target.value })} />
                </div>
                <div>
                  <Label>Offset</Label>
                  <Input value={tagForm.offset} onChange={(e) => setTagForm({ ...tagForm, offset: e.target.value })} />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch checked={tagForm.writable} onCheckedChange={(v) => setTagForm({ ...tagForm, writable: v })} />
                  <Label>Writable</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={tagForm.isEnabled} onCheckedChange={(v) => setTagForm({ ...tagForm, isEnabled: v })} />
                  <Label>Bật</Label>
                </div>
              </div>
              <Button onClick={submitTag} disabled={createTag.isPending || !tagForm.tagKey.trim() || !tagForm.address.trim()}>
                Thêm tag
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
    </DashboardLayout>
  );
}
