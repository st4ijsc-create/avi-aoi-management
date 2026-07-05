/**
 * Hot-folder ingestion config (doc 27 §3 gap C1 · W2-A).
 *
 * Manage the watched result-file folders of real AOI/AVI machines: list configs
 * (machine, adapter, folder, live watcher status + counters), create/edit dialog,
 * delete confirm, manual "process folder now" trigger, recent-file ledger viewer,
 * and a DRY-RUN dialog (paste/upload a sample CSV/XML/JSON export → parsed
 * canonical inspection preview, persists nothing). RBAC mirrors EdgeNodesPage:
 * view = machine_monitoring/canView, create = machine_control/canCreate,
 * edit = canEdit, delete = canDelete. Flag-gated by HOT_FOLDER_INGEST_ENABLED —
 * when off, configs stay editable (prepare first) but watchers/processNow are off.
 */
import { useMemo, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
import {
  FolderSearch, Plus, Trash2, Pencil, RefreshCw, AlertTriangle, Eye, FlaskConical,
  PlayCircle, FileClock, CheckCircle2, XCircle, CopyMinus,
} from "lucide-react";
import { toast } from "sonner";

type StatusRow = {
  config: {
    id: number;
    machineId: number;
    adapterKey: string;
    watchPath: string;
    filePattern: string;
    archivePath?: string | null;
    errorPath?: string | null;
    enabled: boolean;
    pollFallbackMs: number;
    stabilityWindowMs: number;
    deleteAfterDays: number;
  };
  watching: boolean;
  usePolling: boolean;
  lastFile: string | null;
  lastFileAt: string | Date | null;
  lastError: string | null;
  lastErrorAt: string | Date | null;
  processedCount: number;
  errorCount: number;
  duplicateCount: number;
};

function fmtDate(v?: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

const EMPTY_FORM = {
  machineId: "",
  adapterKey: "",
  watchPath: "",
  filePattern: "*.{csv,xml,json}",
  archivePath: "",
  errorPath: "",
  enabled: true,
  pollFallbackMs: "0",
  stabilityWindowMs: "2000",
  deleteAfterDays: "30",
};

export default function HotFolderConfigPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_monitoring", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const statusQ = trpc.hotFolder.status.useQuery(undefined, {
    enabled: canView,
    refetchInterval: 15_000,
  });
  const adaptersQ = trpc.visionAdapter.listAdapters.useQuery(undefined, { enabled: canView });
  const machinesQ = trpc.machine.list.useQuery(undefined, { enabled: canView });

  const enabled = statusQ.data?.enabled ?? false;
  const rows = (statusQ.data?.configs ?? []) as StatusRow[];
  const machines = (machinesQ.data ?? []) as Array<{ id: number; code: string; name: string }>;
  const adapters = adaptersQ.data?.adapters ?? [];
  const machineById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);

  const invalidate = () => void utils.hotFolder.status.invalidate();

  // ── Create / edit dialog ──
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const set = (k: keyof typeof EMPTY_FORM, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const openCreate = () => { setEditingId(null); setForm({ ...EMPTY_FORM }); setOpen(true); };
  const openEdit = (r: StatusRow) => {
    setEditingId(r.config.id);
    setForm({
      machineId: String(r.config.machineId),
      adapterKey: r.config.adapterKey,
      watchPath: r.config.watchPath,
      filePattern: r.config.filePattern,
      archivePath: r.config.archivePath ?? "",
      errorPath: r.config.errorPath ?? "",
      enabled: r.config.enabled,
      pollFallbackMs: String(r.config.pollFallbackMs),
      stabilityWindowMs: String(r.config.stabilityWindowMs),
      deleteAfterDays: String(r.config.deleteAfterDays),
    });
    setOpen(true);
  };

  const createM = trpc.hotFolder.createConfig.useMutation({
    onSuccess: () => { toast.success(t("hotFolders.toastCreated", "Đã tạo cấu hình hot-folder")); setOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateM = trpc.hotFolder.updateConfig.useMutation({
    onSuccess: () => { toast.success(t("hotFolders.toastUpdated", "Đã cập nhật cấu hình")); setOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteM = trpc.hotFolder.deleteConfig.useMutation({
    onSuccess: () => { toast.success(t("hotFolders.toastDeleted", "Đã xoá cấu hình")); setDeleteId(null); invalidate(); },
    onError: (e) => { toast.error(e.message); setDeleteId(null); },
  });
  const processM = trpc.hotFolder.processNow.useMutation({
    onSuccess: (r) => {
      if (r && "enabled" in r && r.enabled === false) {
        toast.warning((r as { message?: string }).message ?? t("hotFolders.disabledBanner", "Hot-folder ingest chưa bật"));
        return;
      }
      const s = r as { scanned: number; processed: number; duplicates: number; errors: number };
      toast.success(
        t("hotFolders.toastScanned", "Đã quét: {{scanned}} file — {{processed}} nhập, {{duplicates}} trùng, {{errors}} lỗi", {
          scanned: s.scanned, processed: s.processed, duplicates: s.duplicates, errors: s.errors,
        }),
      );
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const submitForm = () => {
    const payload = {
      machineId: Number(form.machineId),
      adapterKey: form.adapterKey,
      watchPath: form.watchPath.trim(),
      filePattern: form.filePattern.trim() || "*.{csv,xml,json}",
      archivePath: form.archivePath.trim() || null,
      errorPath: form.errorPath.trim() || null,
      enabled: form.enabled,
      pollFallbackMs: Math.max(0, Number(form.pollFallbackMs) || 0),
      stabilityWindowMs: Math.max(200, Number(form.stabilityWindowMs) || 2000),
      deleteAfterDays: Math.max(0, Number(form.deleteAfterDays) || 0),
    };
    if (editingId != null) updateM.mutate({ id: editingId, patch: payload });
    else createM.mutate(payload);
  };
  const formValid = Number(form.machineId) > 0 && form.adapterKey.trim() && form.watchPath.trim();

  // ── Dry-run dialog ──
  const [dryOpen, setDryOpen] = useState(false);
  const [dryAdapter, setDryAdapter] = useState("");
  const [dryFileName, setDryFileName] = useState("sample.csv");
  const [dryContent, setDryContent] = useState("");
  const [dryMachineCode, setDryMachineCode] = useState("");
  const dryM = trpc.hotFolder.dryRun.useMutation({ onError: (e) => toast.error(e.message) });
  const openDryRun = (r?: StatusRow) => {
    dryM.reset();
    if (r) {
      setDryAdapter(r.config.adapterKey);
      setDryMachineCode(machineById.get(r.config.machineId)?.code ?? "");
    }
    setDryOpen(true);
  };
  const onDryFile = (file: File | null) => {
    if (!file) return;
    setDryFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setDryContent(String(reader.result ?? ""));
    reader.readAsText(file);
  };

  // ── Recent files dialog ──
  const [ledgerId, setLedgerId] = useState<number | null>(null);
  const ledgerQ = trpc.hotFolder.recentFiles.useQuery(
    { configId: ledgerId ?? 0, limit: 20 },
    { enabled: canView && ledgerId != null },
  );

  const watchBadge = (r: StatusRow) => {
    if (!r.config.enabled) {
      return <Badge variant="outline" className="text-muted-foreground">{t("hotFolders.stateDisabled", "Tắt")}</Badge>;
    }
    if (r.watching) {
      return (
        <Badge variant="outline" className="border-success/30 bg-success/15 text-success">
          <Eye className="mr-1 h-3 w-3" />
          {r.usePolling ? t("hotFolders.statePolling", "Đang quét (poll)") : t("hotFolders.stateWatching", "Đang theo dõi")}
        </Badge>
      );
    }
    if (r.lastError) {
      return <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive"><XCircle className="mr-1 h-3 w-3" />{t("hotFolders.stateError", "Lỗi")}</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground">{t("hotFolders.stateStopped", "Chưa chạy")}</Badge>;
  };

  const ledgerStatusBadge = (s: string) => {
    if (s === "processed") return <Badge variant="outline" className="border-success/30 bg-success/15 text-success"><CheckCircle2 className="mr-1 h-3 w-3" />{t("hotFolders.fileProcessed", "Đã nhập")}</Badge>;
    if (s === "duplicate") return <Badge variant="outline" className="text-muted-foreground"><CopyMinus className="mr-1 h-3 w-3" />{t("hotFolders.fileDuplicate", "Trùng")}</Badge>;
    if (s === "error") return <Badge variant="outline" className="border-destructive/30 bg-destructive/15 text-destructive"><XCircle className="mr-1 h-3 w-3" />{t("hotFolders.fileError", "Lỗi")}</Badge>;
    return <Badge variant="outline">{s}</Badge>;
  };

  if (!canView) {
    return (
      <DashboardLayout>
        <div className="p-6"><p className="text-sm text-muted-foreground">{t("hotFolders.noPermission", "Bạn không có quyền xem cấu hình hot-folder.")}</p></div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<FolderSearch className="h-6 w-6" />}
          title={t("hotFolders.title", "Hot-folder Ingest (AOI/AVI)")}
          badge={<ViewOnlyBadge module="machine_control" />}
          description={t("hotFolders.subtitle", "Theo dõi thư mục kết quả (CSV/XML/JSON) của máy AOI/AVI thật — parse theo vendor adapter rồi nhập qua đường submitInspection chuẩn")}
          actions={
            <>
              <Button size="icon" variant="ghost" onClick={() => void statusQ.refetch()} title={t("common.refresh", "Làm mới")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button variant="outline" onClick={() => openDryRun()} disabled={!canCreate}>
                <FlaskConical className="mr-1.5 h-4 w-4" /> {t("hotFolders.dryRun", "Thử file mẫu")}
              </Button>
              <Button onClick={openCreate} disabled={!canCreate}>
                <Plus className="mr-1.5 h-4 w-4" /> {t("hotFolders.create", "Thêm hot-folder")}
              </Button>
            </>
          }
        />

        {!statusQ.isLoading && !enabled && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>{t("hotFolders.disabledBanner", "Hot-folder ingest chưa bật (HOT_FOLDER_INGEST_ENABLED) — vẫn cấu hình và thử file mẫu được, nhưng watcher không chạy.")}</span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">{t("hotFolders.listTitle", "Thư mục đang cấu hình")}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("hotFolders.colMachine", "Máy")}</TableHead>
                    <TableHead>{t("hotFolders.colAdapter", "Adapter")}</TableHead>
                    <TableHead>{t("hotFolders.colFolder", "Thư mục")}</TableHead>
                    <TableHead>{t("hotFolders.colState", "Trạng thái")}</TableHead>
                    <TableHead>{t("hotFolders.colLastFile", "File gần nhất")}</TableHead>
                    <TableHead className="text-right">{t("hotFolders.colCounts", "Nhập / Trùng / Lỗi")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground">{t("hotFolders.empty", "Chưa có hot-folder nào. Thêm một thư mục để bắt đầu nhận kết quả từ máy.")}</TableCell></TableRow>
                  )}
                  {rows.map((r) => {
                    const m = machineById.get(r.config.machineId);
                    return (
                      <TableRow key={r.config.id}>
                        <TableCell className="font-medium">
                          {m ? m.name : `#${r.config.machineId}`}
                          {m ? <div className="font-mono text-[11px] text-muted-foreground">{m.code}</div> : null}
                        </TableCell>
                        <TableCell><Badge variant="outline" className="font-mono text-[11px]">{r.config.adapterKey}</Badge></TableCell>
                        <TableCell className="max-w-[260px]">
                          <div className="truncate font-mono text-xs" title={r.config.watchPath}>{r.config.watchPath}</div>
                          <div className="font-mono text-[11px] text-muted-foreground">{r.config.filePattern}</div>
                        </TableCell>
                        <TableCell>
                          {watchBadge(r)}
                          {r.lastError ? (
                            <div className="mt-1 max-w-[220px] truncate text-[11px] text-destructive" title={r.lastError}>{r.lastError}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">
                          {r.lastFile ? (
                            <>
                              <div className="max-w-[180px] truncate font-mono" title={r.lastFile}>{r.lastFile}</div>
                              <div className="text-[11px] text-muted-foreground">{fmtDate(r.lastFileAt)}</div>
                            </>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          <span className="text-success">{r.processedCount}</span>
                          {" / "}<span className="text-muted-foreground">{r.duplicateCount}</span>
                          {" / "}<span className={r.errorCount > 0 ? "text-destructive" : "text-muted-foreground"}>{r.errorCount}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canCreate || !enabled || processM.isPending} onClick={() => processM.mutate({ configId: r.config.id })} title={t("hotFolders.processNow", "Quét thư mục ngay")}>
                              <PlayCircle className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setLedgerId(r.config.id)} title={t("hotFolders.recentFiles", "File đã xử lý")}>
                              <FileClock className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canCreate} onClick={() => openDryRun(r)} title={t("hotFolders.dryRun", "Thử file mẫu")}>
                              <FlaskConical className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit} onClick={() => openEdit(r)} title={t("common.edit", "Sửa")}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={!canDelete} onClick={() => setDeleteId(r.config.id)} title={t("common.delete", "Xoá")}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </PageContainer>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId != null ? t("hotFolders.editTitle", "Sửa hot-folder") : t("hotFolders.create", "Thêm hot-folder")}</DialogTitle>
            <DialogDescription>{t("hotFolders.formDesc", "Máy AOI/AVI xuất file kết quả vào thư mục này; hệ thống parse theo adapter đã chọn rồi nhập như submitInspection.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldMachine", "Máy")} *</Label>
                <Select value={form.machineId} onValueChange={(v) => set("machineId", v)}>
                  <SelectTrigger><SelectValue placeholder={t("hotFolders.pickMachine", "Chọn máy")} /></SelectTrigger>
                  <SelectContent>
                    {machines.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>{m.name} ({m.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldAdapter", "Vendor adapter")} *</Label>
                <Select value={form.adapterKey} onValueChange={(v) => set("adapterKey", v)}>
                  <SelectTrigger><SelectValue placeholder={t("hotFolders.pickAdapter", "Chọn adapter")} /></SelectTrigger>
                  <SelectContent>
                    {adapters.map((a) => (
                      <SelectItem key={a.vendorKey} value={a.vendorKey}>{a.label} ({a.vendorKey})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("hotFolders.fieldWatchPath", "Thư mục theo dõi (đường dẫn tuyệt đối / UNC)")} *</Label>
              <Input value={form.watchPath} onChange={(e) => set("watchPath", e.target.value)} className="font-mono" placeholder="D:\\aoi-results\\line-a  |  \\\\smb-server\\aoi\\results" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldPattern", "Mẫu tên file (glob)")}</Label>
                <Input value={form.filePattern} onChange={(e) => set("filePattern", e.target.value)} className="font-mono" placeholder="*.{csv,xml,json}" />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} id="hf-enabled" />
                <Label htmlFor="hf-enabled" className="text-xs">{t("hotFolders.fieldEnabled", "Kích hoạt watcher")}</Label>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldArchive", "Thư mục lưu trữ (mặc định <watch>/archive)")}</Label>
                <Input value={form.archivePath} onChange={(e) => set("archivePath", e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldError", "Thư mục lỗi (mặc định <watch>/error)")}</Label>
                <Input value={form.errorPath} onChange={(e) => set("errorPath", e.target.value)} className="font-mono" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldStability", "Cửa sổ ổn định (ms)")}</Label>
                <Input type="number" value={form.stabilityWindowMs} onChange={(e) => set("stabilityWindowMs", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldPoll", "Poll fallback SMB (ms, 0=tắt)")}</Label>
                <Input type="number" value={form.pollFallbackMs} onChange={(e) => set("pollFallbackMs", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldRetention", "Xoá archive sau (ngày, 0=giữ)")}</Label>
                <Input type="number" value={form.deleteAfterDays} onChange={(e) => set("deleteAfterDays", e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button disabled={!formValid || createM.isPending || updateM.isPending} onClick={submitForm}>
              {editingId != null ? t("common.save", "Lưu") : t("hotFolders.create", "Thêm hot-folder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dry-run dialog */}
      <Dialog open={dryOpen} onOpenChange={setDryOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("hotFolders.dryRunTitle", "Thử file mẫu (không ghi dữ liệu)")}</DialogTitle>
            <DialogDescription>{t("hotFolders.dryRunDesc", "Dán hoặc chọn một file kết quả thật (CSV/XML/JSON) — hệ thống parse + normalize và trả về bản ghi chuẩn hoá, KHÔNG lưu gì.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldAdapter", "Vendor adapter")} *</Label>
                <Select value={dryAdapter} onValueChange={setDryAdapter}>
                  <SelectTrigger><SelectValue placeholder={t("hotFolders.pickAdapter", "Chọn adapter")} /></SelectTrigger>
                  <SelectContent>
                    {adapters.map((a) => (
                      <SelectItem key={a.vendorKey} value={a.vendorKey}>{a.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldFileName", "Tên file (định dạng theo đuôi)")}</Label>
                <Input value={dryFileName} onChange={(e) => setDryFileName(e.target.value)} className="font-mono" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t("hotFolders.fieldMachineCode", "Mã máy (tuỳ chọn)")}</Label>
                <Input value={dryMachineCode} onChange={(e) => setDryMachineCode(e.target.value)} className="font-mono" placeholder="AOI-01" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("hotFolders.fieldSampleFile", "Chọn file mẫu")}</Label>
              <Input type="file" accept=".csv,.txt,.xml,.json" onChange={(e) => onDryFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("hotFolders.fieldContent", "Nội dung file")}</Label>
              <Textarea value={dryContent} onChange={(e) => setDryContent(e.target.value)} rows={6} className="font-mono text-xs" placeholder='serial,point,value,judged&#10;SN001,MP001,0.42,OK' />
            </div>
            {dryM.data && (
              dryM.data.ok ? (
                <div className="space-y-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    <span className="font-medium">{t("hotFolders.dryRunOk", "Parse + normalize thành công")}</span>
                    <Badge variant="outline">{dryM.data.format.toUpperCase()}</Badge>
                    <Badge variant="outline">SN {dryM.data.summary.serialNumber}</Badge>
                    <Badge variant="outline">{dryM.data.summary.overallResult}</Badge>
                    <Badge variant="outline">{t("hotFolders.dryRunPoints", "{{count}} điểm đo", { count: dryM.data.summary.measurementCount })}</Badge>
                    <Badge variant="outline" className={dryM.data.summary.ngCount > 0 ? "text-destructive" : ""}>NG {dryM.data.summary.ngCount}</Badge>
                    {!dryM.data.summary.machineIdentityResolved && (
                      <Badge variant="outline" className="border-warning/40 text-warning">{t("hotFolders.dryRunNoMachine", "Chưa có mã máy")}</Badge>
                    )}
                  </div>
                  <pre className="max-h-56 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(dryM.data.canonical, null, 2)}</pre>
                </div>
              ) : (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm">
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <div>
                    <div className="font-medium">{dryM.data.stage === "parse" ? t("hotFolders.dryRunParseFail", "Parse thất bại") : t("hotFolders.dryRunNormalizeFail", "Normalize thất bại")}</div>
                    <div className="text-xs">{dryM.data.error}</div>
                  </div>
                </div>
              )
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDryOpen(false)}>{t("common.close", "Đóng")}</Button>
            <Button
              disabled={!dryAdapter || !dryFileName.trim() || !dryContent.trim() || dryM.isPending}
              onClick={() => dryM.mutate({ adapterKey: dryAdapter, fileName: dryFileName.trim(), content: dryContent, machineCode: dryMachineCode.trim() || undefined })}
            >
              <FlaskConical className="mr-1.5 h-4 w-4" /> {t("hotFolders.dryRunRun", "Chạy thử")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recent-files ledger dialog */}
      <Dialog open={ledgerId != null} onOpenChange={(o) => !o && setLedgerId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("hotFolders.recentFiles", "File đã xử lý")}</DialogTitle>
            <DialogDescription>{t("hotFolders.recentFilesDesc", "20 file gần nhất của cấu hình này (sổ cái idempotency).")}</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("hotFolders.colFile", "File")}</TableHead>
                  <TableHead>{t("hotFolders.colStatus", "Kết quả")}</TableHead>
                  <TableHead>{t("hotFolders.colInspection", "Inspection")}</TableHead>
                  <TableHead>{t("hotFolders.colWhen", "Lúc")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ledgerQ.data ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="text-center text-sm text-muted-foreground">{t("hotFolders.noFiles", "Chưa có file nào được xử lý.")}</TableCell></TableRow>
                )}
                {(ledgerQ.data ?? []).map((f: any) => (
                  <TableRow key={f.id}>
                    <TableCell className="max-w-[220px]">
                      <div className="truncate font-mono text-xs" title={f.fileName}>{f.fileName}</div>
                      {f.errorReason ? <div className="max-w-[220px] truncate text-[11px] text-destructive" title={f.errorReason}>{f.errorReason}</div> : null}
                    </TableCell>
                    <TableCell>{ledgerStatusBadge(f.status)}</TableCell>
                    <TableCell className="font-mono text-xs">{f.inspectionId ? `#${f.inspectionId}` : "—"}</TableCell>
                    <TableCell className="text-xs">{fmtDate(f.processedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("hotFolders.deleteTitle", "Xoá cấu hình hot-folder?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("hotFolders.deleteDesc", "Watcher của thư mục này sẽ dừng. File đã archive và sổ cái xử lý được giữ nguyên.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={() => deleteId && deleteM.mutate({ id: deleteId })}>
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
