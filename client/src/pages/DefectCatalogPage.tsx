/**
 * Doc 31 Đợt B (OP4) — Defect Catalog curation page.
 *
 * The IPC-A-610 defect_catalog (104 rows) had a full CRUD router (qualityProcedure)
 * but NO client ever called create/update/delete — curation was script-only. This
 * page closes that gap:
 *   • List / search / filter (severity · acceptance class · category)
 *   • Create / edit / delete (RBAC: admin · supervisor · quality_inspector)
 *   • repairGuidance field (surfaced at RepairStation / InspectionDetail)
 *   • Unmatched-code panel (OP3): codes reported by machines/AI that are NOT in
 *     the catalog ("BRIDGING seen 400×") → one click to curate them in.
 *   • Per-component defect tendency (Pareto-by-package precursor; tolerates the
 *     empty componentCode that WB-1 fills).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import { PageHeader, PageContainer } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Bug, Plus, Trash2, Pencil, RefreshCw, Search, AlertTriangle, Wrench, PackageSearch } from "lucide-react";
import { toast } from "sonner";

type Severity = "critical" | "major" | "minor" | "cosmetic";
const SEVERITIES: Severity[] = ["critical", "major", "minor", "cosmetic"];
const CLASSES = ["1", "2", "3"] as const;

const severityTone: Record<Severity, string> = {
  critical: "border-destructive/30 bg-destructive/15 text-destructive",
  major: "border-warning/30 bg-warning/15 text-warning",
  minor: "border-primary/30 bg-primary/10 text-primary",
  cosmetic: "border-muted-foreground/30 bg-muted text-muted-foreground",
};

interface CatalogRow {
  id: number;
  code: string;
  name: string;
  nameVi?: string | null;
  category: string;
  severity: Severity;
  ipcReference?: string | null;
  ipcSection?: string | null;
  acceptanceClass?: string | null;
  appliesTo?: string[] | null;
  detectableBy?: string[] | null;
  description?: string | null;
  descriptionVi?: string | null;
  repairGuidance?: string | null;
  repairGuidanceVi?: string | null;
  isActive: boolean;
}

const emptyForm = {
  id: 0,
  code: "",
  name: "",
  nameVi: "",
  category: "solder",
  severity: "major" as Severity,
  ipcReference: "",
  ipcSection: "",
  acceptanceClass: "2",
  appliesTo: "",
  detectableBy: "",
  description: "",
  descriptionVi: "",
  repairGuidance: "",
  repairGuidanceVi: "",
  isActive: true,
};

export default function DefectCatalogPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const role = user?.role ?? "";
  const canEdit = ["admin", "supervisor", "quality_inspector"].includes(role);

  const utils = trpc.useUtils();
  const listQ = trpc.defectCatalog.list.useQuery({ includeInactive: true });
  const unmatchedQ = trpc.defectCatalog.listUnmatchedCodes.useQuery({ onlyUnresolved: true });
  const tendencyQ = trpc.defectCatalog.defectTendency.useQuery(undefined);

  const [search, setSearch] = useState("");
  const [sevFilter, setSevFilter] = useState<string>("all");
  const [classFilter, setClassFilter] = useState<string>("all");

  const rows = (listQ.data ?? []) as CatalogRow[];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sevFilter !== "all" && r.severity !== sevFilter) return false;
      if (classFilter !== "all" && (r.acceptanceClass ?? "") !== classFilter) return false;
      if (!q) return true;
      return (
        r.code.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        (r.nameVi ?? "").toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q)
      );
    });
  }, [rows, search, sevFilter, classFilter]);

  // ── create / edit dialog ──
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const isEdit = form.id > 0;

  const openCreate = (prefillCode?: string) => {
    setForm({ ...emptyForm, code: prefillCode ?? "" });
    setOpen(true);
  };
  const openEdit = (r: CatalogRow) => {
    setForm({
      id: r.id,
      code: r.code,
      name: r.name,
      nameVi: r.nameVi ?? "",
      category: r.category,
      severity: r.severity,
      ipcReference: r.ipcReference ?? "",
      ipcSection: r.ipcSection ?? "",
      acceptanceClass: r.acceptanceClass ?? "2",
      appliesTo: (r.appliesTo ?? []).join(", "),
      detectableBy: (r.detectableBy ?? []).join(", "),
      description: r.description ?? "",
      descriptionVi: r.descriptionVi ?? "",
      repairGuidance: r.repairGuidance ?? "",
      repairGuidanceVi: r.repairGuidanceVi ?? "",
      isActive: r.isActive,
    });
    setOpen(true);
  };

  const invalidate = () => {
    void utils.defectCatalog.list.invalidate();
    void utils.defectCatalog.listUnmatchedCodes.invalidate();
  };

  const createM = trpc.defectCatalog.create.useMutation({
    onSuccess: () => { toast.success(t("defectCatalog.toastCreated", "Đã tạo mã lỗi")); setOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateM = trpc.defectCatalog.update.useMutation({
    onSuccess: () => { toast.success(t("defectCatalog.toastUpdated", "Đã cập nhật")); setOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const deleteM = trpc.defectCatalog.delete.useMutation({
    onSuccess: () => { toast.success(t("defectCatalog.toastDeleted", "Đã xoá")); setDeleteId(null); invalidate(); },
    onError: (e) => { toast.error(e.message); setDeleteId(null); },
  });

  const toArr = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  const submit = () => {
    const base = {
      code: form.code.trim(),
      name: form.name.trim(),
      nameVi: form.nameVi.trim() || undefined,
      category: form.category.trim(),
      severity: form.severity,
      ipcReference: form.ipcReference.trim() || undefined,
      ipcSection: form.ipcSection.trim() || undefined,
      acceptanceClass: (form.acceptanceClass || undefined) as "1" | "2" | "3" | undefined,
      appliesTo: toArr(form.appliesTo),
      detectableBy: toArr(form.detectableBy),
      description: form.description.trim() || undefined,
      descriptionVi: form.descriptionVi.trim() || undefined,
      repairGuidance: form.repairGuidance.trim() || undefined,
      repairGuidanceVi: form.repairGuidanceVi.trim() || undefined,
      isActive: form.isActive,
    };
    if (isEdit) updateM.mutate({ id: form.id, ...base });
    else createM.mutate(base);
  };

  const unmatched = (unmatchedQ.data ?? []) as Array<{ code: string; seenCount: number; lastSeenAt: string | Date }>;
  const tendency = (tendencyQ.data ?? []) as Array<{ componentCode: string | null; defectCode: string | null; defectName: string | null; severity: string | null; count: number }>;
  const tendencyWithComponent = tendency.filter((r) => r.componentCode);

  return (
    <DashboardLayout>
      <PageContainer className="space-y-4">
        <PageHeader
          icon={<Bug className="h-6 w-6" />}
          title={t("defectCatalog.title", "Danh mục lỗi (IPC-A-610)")}
          description={t("defectCatalog.subtitle", "Quản lý mã lỗi tiêu chuẩn + hướng dẫn sửa chữa; theo dõi mã lỗi chưa có trong danh mục")}
          actions={
            <>
              <Button size="icon" variant="ghost" onClick={() => void listQ.refetch()} title={t("common.refresh", "Làm mới")}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button onClick={() => openCreate()} disabled={!canEdit}>
                <Plus className="mr-1.5 h-4 w-4" /> {t("defectCatalog.new", "Thêm mã lỗi")}
              </Button>
            </>
          }
        />

        {!canEdit && (
          <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>{t("defectCatalog.readOnlyBanner", "Bạn chỉ có quyền xem. Chỉ admin / giám sát / kiểm tra chất lượng mới sửa được danh mục.")}</span>
          </div>
        )}

        {/* Unmatched-code panel (OP3) */}
        {unmatched.length > 0 && (
          <Card className="border-warning/40">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {t("defectCatalog.unmatchedTitle", "Mã lỗi chưa có trong danh mục")}
                <Badge variant="outline" className="ml-1">{unmatched.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-xs text-muted-foreground">
                {t("defectCatalog.unmatchedHint", "Các máy/AI đã báo những mã lỗi này nhưng chúng không khớp danh mục — kết quả không được phân loại. Thêm vào danh mục để phân loại được.")}
              </p>
              <div className="flex flex-wrap gap-2">
                {unmatched.map((u) => (
                  <button
                    key={u.code}
                    disabled={!canEdit}
                    onClick={() => openCreate(u.code)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-xs hover:bg-warning/20 disabled:opacity-50"
                    title={canEdit ? t("defectCatalog.addToCatalog", "Thêm vào danh mục") : undefined}
                  >
                    <span className="font-mono">{u.code}</span>
                    <Badge variant="outline" className="text-[10px]">{u.seenCount}×</Badge>
                    {canEdit && <Plus className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Filters + list */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="mr-auto text-base">{t("defectCatalog.listTitle", "Danh mục")} ({filtered.length})</CardTitle>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("common.search", "Tìm kiếm")} className="h-8 w-48 pl-7 text-xs" />
              </div>
              <Select value={sevFilter} onValueChange={setSevFilter}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder={t("defectCatalog.severity", "Mức độ")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("defectCatalog.allSeverities", "Mọi mức độ")}</SelectItem>
                  {SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`defectCatalog.sev.${s}`, s)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={classFilter} onValueChange={setClassFilter}>
                <SelectTrigger className="h-8 w-32 text-xs"><SelectValue placeholder={t("defectCatalog.class", "Class")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("defectCatalog.allClasses", "Mọi class")}</SelectItem>
                  {CLASSES.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("defectCatalog.code", "Mã")}</TableHead>
                    <TableHead>{t("defectCatalog.name", "Tên")}</TableHead>
                    <TableHead>{t("defectCatalog.category", "Nhóm")}</TableHead>
                    <TableHead>{t("defectCatalog.severity", "Mức độ")}</TableHead>
                    <TableHead>IPC</TableHead>
                    <TableHead>{t("defectCatalog.class", "Class")}</TableHead>
                    <TableHead>{t("defectCatalog.repair", "Sửa chữa")}</TableHead>
                    <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow><TableCell colSpan={8} className="text-center text-sm text-muted-foreground">{t("defectCatalog.empty", "Không có mã lỗi.")}</TableCell></TableRow>
                  )}
                  {filtered.map((r) => (
                    <TableRow key={r.id} className={r.isActive ? "" : "opacity-50"}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">
                        {r.name}
                        {r.nameVi ? <div className="text-[11px] text-muted-foreground">{r.nameVi}</div> : null}
                      </TableCell>
                      <TableCell className="text-xs">{r.category}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={severityTone[r.severity]}>{t(`defectCatalog.sev.${r.severity}`, r.severity)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.ipcReference ?? "—"}{r.ipcSection ? <span className="ml-1 opacity-70">§{r.ipcSection}</span> : null}
                      </TableCell>
                      <TableCell className="text-xs">{r.acceptanceClass ?? "—"}</TableCell>
                      <TableCell>{r.repairGuidance ? <Wrench className="h-3.5 w-3.5 text-success" /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="ghost" className="h-7 w-7" disabled={!canEdit} onClick={() => openEdit(r)} title={t("common.edit", "Sửa")}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" disabled={!canEdit} onClick={() => setDeleteId(r.id)} title={t("common.delete", "Xoá")}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Per-component defect tendency (Pareto-by-package precursor) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <PackageSearch className="h-4 w-4" />
              {t("defectCatalog.tendencyTitle", "Xu hướng lỗi theo linh kiện")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tendencyWithComponent.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("defectCatalog.tendencyEmpty", "Chưa có dữ liệu NG được phân loại kèm mã linh kiện. Điền componentCode cho điểm đo (và đảm bảo NG được phân loại) để thấy xu hướng lỗi theo package.")}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("defectCatalog.component", "Linh kiện")}</TableHead>
                      <TableHead>{t("defectCatalog.defectClass", "Loại lỗi")}</TableHead>
                      <TableHead>{t("defectCatalog.severity", "Mức độ")}</TableHead>
                      <TableHead className="text-right">{t("defectCatalog.count", "Số lần")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tendencyWithComponent.slice(0, 50).map((r, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono text-xs">{r.componentCode}</TableCell>
                        <TableCell className="text-xs">{r.defectName ?? r.defectCode ?? "—"}</TableCell>
                        <TableCell>{r.severity ? <Badge variant="outline" className={severityTone[(r.severity as Severity)] ?? ""}>{r.severity}</Badge> : "—"}</TableCell>
                        <TableCell className="text-right font-medium">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PageContainer>

      {/* Create / edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEdit ? t("defectCatalog.editTitle", "Sửa mã lỗi") : t("defectCatalog.new", "Thêm mã lỗi")}</DialogTitle>
            <DialogDescription>{t("defectCatalog.formDesc", "Mã (code) là định danh máy/AI gửi lên khi báo lỗi. Trùng mã sẽ bị từ chối.")}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.code", "Mã")} *</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={isEdit} className="font-mono" placeholder="BRIDGING" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.category", "Nhóm")} *</Label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="solder" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.name", "Tên (EN)")} *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Bridging" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.nameVi", "Tên (VI)")}</Label>
              <Input value={form.nameVi} onChange={(e) => setForm({ ...form, nameVi: e.target.value })} placeholder="Cầu thiếc" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.severity", "Mức độ")} *</Label>
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v as Severity })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SEVERITIES.map((s) => <SelectItem key={s} value={s}>{t(`defectCatalog.sev.${s}`, s)}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.class", "Acceptance class")}</Label>
              <Select value={form.acceptanceClass} onValueChange={(v) => setForm({ ...form, acceptanceClass: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CLASSES.map((c) => <SelectItem key={c} value={c}>Class {c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.ipcRef", "IPC ref")}</Label>
              <Input value={form.ipcReference} onChange={(e) => setForm({ ...form, ipcReference: e.target.value })} placeholder="5.2.5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.ipcSection", "IPC section")}</Label>
              <Input value={form.ipcSection} onChange={(e) => setForm({ ...form, ipcSection: e.target.value })} placeholder="5" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.appliesTo", "Áp dụng cho (phân tách bằng dấu phẩy)")}</Label>
              <Input value={form.appliesTo} onChange={(e) => setForm({ ...form, appliesTo: e.target.value })} placeholder="SMT, THT" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.detectableBy", "Phát hiện bởi")}</Label>
              <Input value={form.detectableBy} onChange={(e) => setForm({ ...form, detectableBy: e.target.value })} placeholder="AOI, AXI" />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.description", "Mô tả")}</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs"><Wrench className="h-3.5 w-3.5" /> {t("defectCatalog.repairGuidance", "Hướng dẫn sửa chữa (EN)")}</Label>
              <Textarea value={form.repairGuidance} onChange={(e) => setForm({ ...form, repairGuidance: e.target.value })} rows={2} placeholder={t("defectCatalog.repairPlaceholder", "Bước sửa chữa / disposition khi gặp lỗi này…")} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">{t("defectCatalog.repairGuidanceVi", "Hướng dẫn sửa chữa (VI)")}</Label>
              <Textarea value={form.repairGuidanceVi} onChange={(e) => setForm({ ...form, repairGuidanceVi: e.target.value })} rows={2} />
            </div>
            <div className="col-span-2 flex items-center gap-2">
              <Switch checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v })} />
              <Label className="text-xs">{t("defectCatalog.active", "Đang hoạt động")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button
              disabled={!form.code.trim() || !form.name.trim() || createM.isPending || updateM.isPending}
              onClick={submit}
            >
              {isEdit ? t("common.save", "Lưu") : t("common.create", "Tạo")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId != null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("defectCatalog.deleteTitle", "Xoá mã lỗi?")}</AlertDialogTitle>
            <AlertDialogDescription>{t("defectCatalog.deleteDesc", "Mã lỗi sẽ bị vô hiệu hoá (soft-delete). Kết quả NG đã phân loại vẫn giữ liên kết lịch sử.")}</AlertDialogDescription>
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
