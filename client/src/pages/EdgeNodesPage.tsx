/**
 * Phase E4 — Factory Control Plane: EDGE NODES management (OT / Machine Control).
 *
 * Lists the registered edge control runtimes (code/name/status/heartbeat freshness/
 * assigned lines/version), lets an operator REGISTER (or re-register = edit, upsert
 * by code) a node and DEREGISTER (delete) one. Health is derived from heartbeat
 * freshness so a stale "online" still surfaces as a warning. RBAC machine_control:
 * view = canView, register/edit = canCreate, delete = canDelete. Flag-gated by
 * EDGE_RUNTIME_ENABLED — when off, writes are disabled with a banner.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Cpu, Plus, Trash2, Pencil, RefreshCw, AlertTriangle, Wifi, WifiOff, Activity } from "lucide-react";
import { toast } from "sonner";

type EdgeNodeRow = {
  id: number;
  code: string;
  name: string;
  factoryCode?: string | null;
  status: string;
  lastHeartbeatAt?: string | Date | null;
  assignedLineCodes?: string[] | null;
  version?: string | null;
};

const STALE_MS = 2 * 60_000; // mirrors markStaleNodesOffline(thresholdMin=2)

function fmtDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function heartbeatStale(v?: string | Date | null): boolean {
  if (!v) return true;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) || Date.now() - d.getTime() > STALE_MS;
}

export default function EdgeNodesPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const statusQ = trpc.edgeRuntime.status.useQuery(undefined, { enabled: canView });
  const enabled = statusQ.data?.enabled ?? false;
  const listQ = trpc.edgeRuntime.listNodes.useQuery(undefined, { enabled: canView });

  const invalidate = () => void utils.edgeRuntime.listNodes.invalidate();

  // ── Register / edit dialog (upsert by code) ──
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [factoryCode, setFactoryCode] = useState("");
  const [lines, setLines] = useState("");
  const [version, setVersion] = useState("");

  const reset = () => { setCode(""); setName(""); setFactoryCode(""); setLines(""); setVersion(""); setEditing(false); };

  const openCreate = () => { reset(); setOpen(true); };
  const openEdit = (n: EdgeNodeRow) => {
    setEditing(true);
    setCode(n.code);
    setName(n.name ?? "");
    setFactoryCode(n.factoryCode ?? "");
    setLines((n.assignedLineCodes ?? []).join(", "));
    setVersion(n.version ?? "");
    setOpen(true);
  };

  const registerM = trpc.edgeRuntime.registerNode.useMutation({
    onSuccess: (r) => {
      if (r?.ok) { toast.success(editing ? t("edgeNodes.toastUpdated", "Đã cập nhật node") : t("edgeNodes.toastRegistered", "Đã đăng ký node")); setOpen(false); reset(); invalidate(); }
      else toast.error(r?.message ?? t("edgeNodes.opFail", "Thao tác thất bại"));
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteM = trpc.edgeRuntime.deleteNode.useMutation({
    onSuccess: (r) => {
      if (r?.ok) { toast.success(t("edgeNodes.toastDeleted", "Đã gỡ node")); setDeleteId(null); invalidate(); }
      else { toast.error(r?.message ?? t("edgeNodes.opFail", "Thao tác thất bại")); setDeleteId(null); }
    },
    onError: (e) => toast.error(e.message),
  });

  const submit = () => {
    const assignedLineCodes = lines.split(",").map((s) => s.trim()).filter(Boolean);
    registerM.mutate({
      code: code.trim(),
      name: name.trim() || undefined,
      factoryCode: factoryCode.trim() || null,
      assignedLineCodes: assignedLineCodes.length ? assignedLineCodes : null,
      version: version.trim() || null,
    });
  };

  const rows = (listQ.data ?? []) as EdgeNodeRow[];

  const statusBadge = (n: EdgeNodeRow) => {
    const stale = heartbeatStale(n.lastHeartbeatAt);
    if (n.status === "offline" || (stale && n.status !== "offline")) {
      return <Badge variant="outline" className="text-muted-foreground"><WifiOff className="mr-1 h-3 w-3" />{t("edgeNodes.offline", "Ngoại tuyến")}</Badge>;
    }
    if (n.status === "degraded") {
      return <Badge variant="outline" className="border-warning/30 bg-warning/15 text-warning"><Activity className="mr-1 h-3 w-3" />{t("edgeNodes.degraded", "Suy giảm")}</Badge>;
    }
    return <Badge variant="outline" className="border-success/30 bg-success/15 text-success"><Wifi className="mr-1 h-3 w-3" />{t("edgeNodes.online", "Trực tuyến")}</Badge>;
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6"><p className="text-sm text-muted-foreground">{t("edgeNodes.noPermission", "Bạn không có quyền xem node biên.")}</p></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<Cpu className="h-6 w-6" />}
          title={t("edgeNodes.title", "Node biên (Edge)")}
          badge={<ViewOnlyBadge module="machine_control" />}
          description={t("edgeNodes.subtitle", "Đăng ký & theo dõi các runtime điều phối biên gần dây chuyền")}
          actions={
            <>
              <Button size="icon" variant="ghost" onClick={() => void listQ.refetch()} title={t("common.refresh", "Làm mới")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button onClick={openCreate} disabled={!canCreate || !enabled}>
                <Plus className="mr-1.5 h-4 w-4" /> {t("edgeNodes.register", "Đăng ký node")}
              </Button>
            </>
          }
        />

        {!statusQ.isLoading && !enabled && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>{t("edgeNodes.disabledBanner", "Edge runtime chưa bật (EDGE_RUNTIME_ENABLED) — vẫn xem được danh sách, nhưng đăng ký/gỡ bị tắt.")}</span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("edgeNodes.listTitle", "Danh sách node")}</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("edgeNodes.colCode", "Mã")}</TableHead>
                  <TableHead>{t("edgeNodes.colName", "Tên")}</TableHead>
                  <TableHead>{t("edgeNodes.colStatus", "Trạng thái")}</TableHead>
                  <TableHead>{t("edgeNodes.colHeartbeat", "Heartbeat")}</TableHead>
                  <TableHead>{t("edgeNodes.colLines", "Dây chuyền")}</TableHead>
                  <TableHead>{t("edgeNodes.colVersion", "Phiên bản")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">{t("edgeNodes.empty", "Chưa có node nào.")}</TableCell></TableRow>
                )}
                {rows.map((n) => (
                  <TableRow key={n.id}>
                    <TableCell className="font-mono text-xs">{n.code}</TableCell>
                    <TableCell className="font-medium">{n.name}{n.factoryCode ? <div className="text-[11px] text-muted-foreground">{n.factoryCode}</div> : null}</TableCell>
                    <TableCell>{statusBadge(n)}</TableCell>
                    <TableCell className="text-xs">
                      <span className={heartbeatStale(n.lastHeartbeatAt) ? "text-warning" : ""}>{fmtDate(n.lastHeartbeatAt)}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      {(n.assignedLineCodes ?? []).length ? (n.assignedLineCodes ?? []).map((l) => <Badge key={l} variant="outline" className="mr-1 text-[10px]">{l}</Badge>) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{n.version ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canCreate || !enabled} onClick={() => openEdit(n)} title={t("common.edit", "Sửa")}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={!canDelete || !enabled} onClick={() => setDeleteId(n.id)} title={t("edgeNodes.deregister", "Gỡ node")}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageContainer>

      {/* Register / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t("edgeNodes.editTitle", "Sửa node biên") : t("edgeNodes.register", "Đăng ký node")}</DialogTitle>
            <DialogDescription>{t("edgeNodes.formDesc", "Mã (code) là định danh duy nhất node tự khai báo khi báo cáo về trung tâm.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("edgeNodes.colCode", "Mã")} *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={editing} className="font-mono" placeholder="edge-line-a" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("edgeNodes.colName", "Tên")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("edgeNodes.namePlaceholder", "Node biên dây chuyền A")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("edgeNodes.fieldFactory", "Mã nhà máy")}</Label>
                <Input value={factoryCode} onChange={(e) => setFactoryCode(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("edgeNodes.colVersion", "Phiên bản")}</Label>
                <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.0" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("edgeNodes.fieldLines", "Dây chuyền phụ trách (phân tách bằng dấu phẩy)")}</Label>
              <Input value={lines} onChange={(e) => setLines(e.target.value)} placeholder="LINE-A, LINE-B" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button disabled={!code.trim() || registerM.isPending} onClick={submit}>{editing ? t("common.save", "Lưu") : t("edgeNodes.register", "Đăng ký node")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("edgeNodes.deleteTitle", "Gỡ node biên?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("edgeNodes.deleteDesc", "Node sẽ bị xoá khỏi danh sách. Nếu còn lượt chạy đang hoạt động được giao cho node, thao tác sẽ bị từ chối.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteId && deleteM.mutate({ id: deleteId })}>
              {t("edgeNodes.deregister", "Gỡ node")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
