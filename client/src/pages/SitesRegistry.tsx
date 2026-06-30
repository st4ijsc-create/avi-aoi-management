/**
 * Multi-Site Federation — Sites Registry (Admin). Doc 13 / F0.
 *
 * Lists the remote (and local self-enrolled) platform deployments the CORE
 * control-tower knows about. Admin can add / edit / delete a site, PROBE its
 * read-only /api/external/health, and "Enroll this deployment" as a local site
 * so the UI works with a single deployment.
 *
 * Honesty: the status badge is derived from the persisted `status` + `lastSyncAt`
 * (OK / STALE / DOWN / UNKNOWN). With 0 sites we show an empty state + enroll CTA
 * — never fabricated site data. Secrets are never entered/shown here; the per-site
 * read token lives in env (SITE_TOKEN_<CODE>) and we only surface whether it is
 * configured (hasToken).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
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
import { Network, Plus, RadioTower, Trash2, Pencil, MapPin, ShieldAlert, ShieldCheck, ServerCog } from "lucide-react";
import { toast } from "sonner";

type SiteRow = {
  id: number;
  code: string;
  name: string;
  corporateCode?: string | null;
  baseUrl: string;
  region?: string | null;
  authType: string;
  authTokenRef?: string | null;
  unsBrokerUrl?: string | null;
  pollIntervalSec: number;
  status: string;
  isLocal: boolean;
  lastSyncAt?: string | Date | null;
  lastError?: string | null;
  consecutiveFailures: number;
  hasToken: boolean;
  tokenEnvVar: string;
};

function fmtDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

/**
 * Honest staleness: OK when status=active and synced within 2× the poll
 * interval; STALE when active but the last sync is older; DOWN on error;
 * UNKNOWN before the first probe / paused.
 */
function deriveHealth(r: SiteRow): { key: "ok" | "stale" | "down" | "unknown"; ageMs: number | null } {
  if (r.status === "error") return { key: "down", ageMs: null };
  if (r.status === "paused" || r.status === "unknown" || !r.lastSyncAt) {
    return { key: "unknown", ageMs: null };
  }
  const ts = new Date(r.lastSyncAt).getTime();
  if (Number.isNaN(ts)) return { key: "unknown", ageMs: null };
  const ageMs = Date.now() - ts;
  const staleThreshold = Math.max(r.pollIntervalSec, 30) * 1000 * 2;
  return { key: ageMs <= staleThreshold ? "ok" : "stale", ageMs };
}

export default function SitesRegistry() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("admin_system", "canView");
  const canCreate = hasPermission("admin_system", "canCreate");
  const canEdit = hasPermission("admin_system", "canEdit");
  const canDelete = hasPermission("admin_system", "canDelete");

  const utils = trpc.useUtils();
  const listQ = trpc.sites.list.useQuery(undefined, { enabled: canView });
  const invalidate = () => void utils.sites.list.invalidate();

  // ── Create / Edit dialog (shared form) ──
  const [formOpen, setFormOpen] = useState(false);
  const [editRow, setEditRow] = useState<SiteRow | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [corporateCode, setCorporateCode] = useState("");
  const [region, setRegion] = useState("");
  const [authType, setAuthType] = useState("master_key");
  const [pollIntervalSec, setPollIntervalSec] = useState("60");
  const [unsBrokerUrl, setUnsBrokerUrl] = useState("");

  const resetForm = () => {
    setEditRow(null); setCode(""); setName(""); setBaseUrl(""); setCorporateCode("");
    setRegion(""); setAuthType("master_key"); setPollIntervalSec("60"); setUnsBrokerUrl("");
  };

  const openCreate = () => { resetForm(); setFormOpen(true); };
  const openEdit = (r: SiteRow) => {
    setEditRow(r);
    setCode(r.code); setName(r.name); setBaseUrl(r.baseUrl);
    setCorporateCode(r.corporateCode ?? ""); setRegion(r.region ?? "");
    setAuthType(r.authType); setPollIntervalSec(String(r.pollIntervalSec));
    setUnsBrokerUrl(r.unsBrokerUrl ?? "");
    setFormOpen(true);
  };

  const createM = trpc.sites.create.useMutation({
    onSuccess: () => { setFormOpen(false); resetForm(); invalidate(); toast.success(t("sites.toastCreated", "Đã thêm site")); },
    onError: (e) => toast.error(e.message),
  });
  const updateM = trpc.sites.update.useMutation({
    onSuccess: () => { setFormOpen(false); resetForm(); invalidate(); toast.success(t("sites.toastUpdated", "Đã cập nhật site")); },
    onError: (e) => toast.error(e.message),
  });
  const probeM = trpc.sites.probe.useMutation({
    onSuccess: (r) => {
      invalidate();
      if (r.probe?.ok) toast.success(t("sites.probeOk", "Probe thành công — site đang hoạt động"));
      else toast.error(t("sites.probeFail", "Probe thất bại: ") + (r.probe?.error ?? ""));
    },
    onError: (e) => toast.error(e.message),
  });
  const enrollM = trpc.sites.selfEnrollLocal.useMutation({
    onSuccess: (r) => {
      invalidate();
      toast.success(r.created ? t("sites.enrolled", "Đã đăng ký deployment này (local)") : t("sites.enrollRefreshed", "Đã làm mới site local"));
    },
    onError: (e) => toast.error(e.message),
  });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteM = trpc.sites.delete.useMutation({
    onSuccess: () => { setDeleteId(null); invalidate(); toast.success(t("sites.toastDeleted", "Đã xóa site")); },
    onError: (e) => toast.error(e.message),
  });

  const submitForm = () => {
    const poll = Math.max(10, parseInt(pollIntervalSec, 10) || 60);
    if (editRow) {
      updateM.mutate({
        id: editRow.id,
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        corporateCode: corporateCode.trim() || null,
        region: region.trim() || null,
        authType: authType as "master_key" | "bearer",
        pollIntervalSec: poll,
        unsBrokerUrl: unsBrokerUrl.trim() || null,
      });
    } else {
      createM.mutate({
        code: code.trim(),
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        corporateCode: corporateCode.trim() || null,
        region: region.trim() || null,
        authType: authType as "master_key" | "bearer",
        pollIntervalSec: poll,
        unsBrokerUrl: unsBrokerUrl.trim() || null,
      });
    }
  };

  const rows = (listQ.data ?? []) as SiteRow[];

  const healthBadge = (r: SiteRow) => {
    const { key } = deriveHealth(r);
    if (key === "ok") return <Badge className="bg-emerald-500 text-white">{t("sites.statusOk", "OK")}</Badge>;
    if (key === "stale") return <Badge variant="outline" className="text-amber-600 border-amber-400">{t("sites.statusStale", "STALE")}</Badge>;
    if (key === "down") return <Badge variant="outline" className="text-red-600 border-red-400">{t("sites.statusDown", "DOWN")}</Badge>;
    return <Badge variant="outline" className="text-muted-foreground">{t("sites.statusUnknown", "UNKNOWN")}</Badge>;
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6">
          <p className="text-sm text-muted-foreground">{t("sites.noPermission", "Bạn không có quyền quản lý sites federation.")}</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-4 p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Network className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              {t("sites.title", "Sites Federation")}<ViewOnlyBadge module="admin_system" />
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("sites.subtitle", "Đăng ký các site (đa nhà máy) mà control-tower sẽ tổng hợp dữ liệu read-only. Core CHỈ đọc — không điều khiển site.")}
            </p>
          </div>
          <Button variant="outline" onClick={() => enrollM.mutate({})} disabled={!canCreate || enrollM.isPending}>
            <ServerCog className="mr-1.5 h-4 w-4" /> {t("sites.enrollThis", "Đăng ký deployment này")}
          </Button>
          <Button onClick={openCreate} disabled={!canCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> {t("sites.add", "Thêm site")}
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("sites.listTitle", "Danh sách site")}</CardTitle>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <Network className="h-10 w-10 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  {t("sites.emptyTitle", "Chưa có site nào.")}
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {t("sites.emptyHint", "Bấm \"Đăng ký deployment này\" để tự-enroll bản thân làm site local (hoạt động ngay với 1 deployment), hoặc \"Thêm site\" để đăng ký một nhà máy từ xa.")}
                </p>
                <Button onClick={() => enrollM.mutate({})} disabled={!canCreate || enrollM.isPending}>
                  <ServerCog className="mr-1.5 h-4 w-4" /> {t("sites.enrollThis", "Đăng ký deployment này")}
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sites.colCode", "Mã")}</TableHead>
                    <TableHead>{t("sites.colName", "Tên")}</TableHead>
                    <TableHead>{t("sites.colBaseUrl", "Base URL")}</TableHead>
                    <TableHead>{t("sites.colStatus", "Trạng thái")}</TableHead>
                    <TableHead>{t("sites.colLastSync", "Đồng bộ gần nhất")}</TableHead>
                    <TableHead>{t("sites.colToken", "Token")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {r.code}
                        {r.isLocal && <Badge variant="outline" className="ml-1.5 text-[10px]">{t("sites.localBadge", "local")}</Badge>}
                      </TableCell>
                      <TableCell className="font-medium">
                        {r.name}
                        {(r.region || r.corporateCode) && (
                          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <MapPin className="h-3 w-3" />{[r.corporateCode, r.region].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate font-mono text-xs" title={r.baseUrl}>{r.baseUrl}</TableCell>
                      <TableCell>
                        {healthBadge(r)}
                        {r.lastError && <div className="mt-0.5 max-w-[180px] truncate text-[10px] text-red-500" title={r.lastError}>{r.lastError}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDate(r.lastSyncAt)}</TableCell>
                      <TableCell>
                        {r.hasToken ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-400"><ShieldCheck className="mr-1 h-3 w-3" />{t("sites.tokenSet", "đã cấu hình")}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 border-amber-400" title={r.tokenEnvVar}><ShieldAlert className="mr-1 h-3 w-3" />{t("sites.tokenMissing", "thiếu env")}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit || probeM.isPending} onClick={() => probeM.mutate({ id: r.id })} title={t("sites.probe", "Probe")}>
                            <RadioTower className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit} onClick={() => openEdit(r)} title={t("common.edit", "Sửa")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={!canDelete} onClick={() => setDeleteId(r.id)} title={t("common.delete", "Xóa")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Create / Edit dialog ── */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!o) { setFormOpen(false); resetForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editRow ? t("sites.editTitle", "Sửa site") : t("sites.add", "Thêm site")}</DialogTitle>
            <DialogDescription>
              {t("sites.formDesc", "Token đọc KHÔNG nhập ở đây — đặt qua biến môi trường SITE_TOKEN_<CODE>. DB chỉ lưu tham chiếu.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sites.fieldCode", "Mã site *")}</Label>
              <Input value={code} disabled={!!editRow} onChange={(e) => setCode(e.target.value)} placeholder="HCM01" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sites.fieldName", "Tên *")}</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("sites.namePlaceholder", "Factory HCM")} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">{t("sites.fieldBaseUrl", "Base URL *")}</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://hcm.factory.local" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sites.fieldCorporate", "Mã tập đoàn")}</Label>
              <Input value={corporateCode} onChange={(e) => setCorporateCode(e.target.value)} placeholder="CORP01" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sites.fieldRegion", "Khu vực")}</Label>
              <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Vietnam South" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sites.fieldAuthType", "Kiểu xác thực")}</Label>
              <Select value={authType} onValueChange={setAuthType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="master_key">master_key (x-master-key)</SelectItem>
                  <SelectItem value="bearer">bearer (Authorization)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("sites.fieldPoll", "Poll interval (giây)")}</Label>
              <Input type="number" min={10} value={pollIntervalSec} onChange={(e) => setPollIntervalSec(e.target.value)} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">{t("sites.fieldUns", "UNS broker URL (tùy chọn, F3)")}</Label>
              <Input value={unsBrokerUrl} onChange={(e) => setUnsBrokerUrl(e.target.value)} placeholder="mqtts://hcm.factory.local:8883" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFormOpen(false); resetForm(); }}>{t("common.cancel", "Hủy")}</Button>
            <Button
              disabled={!name.trim() || !baseUrl.trim() || (!editRow && !code.trim()) || createM.isPending || updateM.isPending}
              onClick={submitForm}
            >
              {editRow ? t("common.save", "Lưu") : t("sites.add", "Thêm site")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sites.deleteTitle", "Xóa site?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("sites.deleteDesc", "Site sẽ bị gỡ khỏi registry. Aggregator sẽ ngừng poll site này. Không thể hoàn tác.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Hủy")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteId && deleteM.mutate({ id: deleteId })}>
              {t("common.delete", "Xóa")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
