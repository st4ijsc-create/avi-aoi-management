/**
 * Engineering Changes (ECN / ECO) — doc 35 Wave W4-D + doc 40 Wave 4b (ENG-F9 polish).
 *
 * The system had no GENERAL engineering-change workflow. This page is the ECN
 * queue: list changes with status, DRAFT a new change (title / type / target /
 * reason / effectivity / impact), and advance the maker-checker lifecycle
 * (submit → review → approve / reject → implement → close). Decision buttons are
 * gated on the permission hook; the SERVER additionally enforces role + SoD
 * (requester ≠ approver), so the client gate is a UX hint only.
 *
 * ENG-F9 polish (doc 40 Wave 4b):
 *  - Reject reason now uses a DS AlertDialog + Textarea (was a raw window.prompt).
 *  - Clicking a row opens a detail dialog: impact summary, actors, and a lifecycle
 *    timeline built from the row's own stamped timestamps.
 *  - A URL-synced FilterBar filters the queue by status / change type.
 *  - Lifecycle action labels are i18n'd (ecn.action.*).
 *
 * TASK 3 — componentCode backfill surface: an ADMIN-only panel that triggers the
 * EXISTING `measurementPoint.backfillComponentCodesFromBom` procedure (doc 31
 * MP1/PM6, server/services/componentLinkBackfill.ts) for a chosen product —
 * dry-run preview then apply — and shows the matched/updated/skipped counts.
 * The backfill is NOT reimplemented here; only surfaced.
 *
 * RBAC: view/create gated on the `masterdata` grant; decisions on `masterdata`
 * canEdit; backfill on admin. SAFETY: no machine write — pure metadata/workflow.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { FilterBar, useUrlFilters, type FilterDef } from "@/components/FilterBar";
import { PageHeader, StatusBadge, type BadgeVariant } from "@/components/patterns";
import { GitPullRequestArrow, AlertTriangle, Wrench, Plus } from "lucide-react";
import { toast } from "sonner";

const CHANGE_TYPES = ["product", "bom", "recipe", "program", "process", "document"] as const;
type ChangeType = (typeof CHANGE_TYPES)[number];

const ECN_STATUSES = ["draft", "submitted", "in_review", "approved", "rejected", "implemented", "closed"] as const;

type EcnImpactSummary = {
  affectedProducts?: Array<number | string>;
  affectedPrograms?: Array<number | string>;
  affectedLines?: Array<number | string>;
  notes?: string;
  [k: string]: unknown;
};

type Ecn = {
  id: number;
  ecnKey: string;
  title: string;
  changeType: string;
  productModelId: number | null;
  targetDescription: string | null;
  reason: string | null;
  impactSummary: EcnImpactSummary | null;
  status: string;
  effectivityDate: string | Date | null;
  decisionComment: string | null;
  note: string | null;
  requestedBy: number | null;
  reviewedBy: number | null;
  approvedBy: number | null;
  implementedBy: number | null;
  closedBy: number | null;
  submittedAt: string | Date | null;
  reviewedAt: string | Date | null;
  approvedAt: string | Date | null;
  implementedAt: string | Date | null;
  closedAt: string | Date | null;
  createdAt: string | Date | null;
};

// ECN status → solid shadcn <Badge> variant (unified onto <StatusBadge>).
function ecnStatusVariant(s: string): BadgeVariant {
  if (s === "approved" || s === "implemented") return "secondary";
  if (s === "rejected") return "destructive";
  if (s === "closed") return "outline";
  return "default"; // draft / submitted / in_review
}

function fmtDate(v: string | Date | null | undefined): string {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString() : "—";
}

function fmtDateTime(v: string | Date | null | undefined): string {
  if (v == null) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : "—";
}

/** Which lifecycle actions are offered for a given current status. */
function actionsFor(status: string): Array<{ action: string; labelKey: string; fallback: string; variant?: "destructive" }> {
  switch (status) {
    case "draft": return [{ action: "submit", labelKey: "ecn.action.submit", fallback: "Gửi duyệt" }];
    case "submitted": return [{ action: "review", labelKey: "ecn.action.review", fallback: "Bắt đầu xem xét" }, { action: "reject", labelKey: "ecn.action.reject", fallback: "Từ chối", variant: "destructive" }];
    case "in_review": return [{ action: "approve", labelKey: "ecn.action.approve", fallback: "Phê duyệt" }, { action: "reject", labelKey: "ecn.action.reject", fallback: "Từ chối", variant: "destructive" }];
    case "approved": return [{ action: "implement", labelKey: "ecn.action.implement", fallback: "Đánh dấu triển khai" }, { action: "close", labelKey: "ecn.action.close", fallback: "Đóng" }];
    case "rejected": return [{ action: "close", labelKey: "ecn.action.close", fallback: "Đóng" }];
    case "implemented": return [{ action: "close", labelKey: "ecn.action.close", fallback: "Đóng" }];
    default: return [];
  }
}

export default function EngineeringChanges() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  // doc 54 Đ2 — ECN is an engineering task: gate on machine_control (engineer has it)
  // instead of masterdata. Server (ecnRouter MOD_ENGINEERING + roleProcedure incl.
  // engineer) already allows it; SoD (requester≠approver) is enforced server-side.
  const canView = isAdmin || hasPermission("machine_control", "canView");
  const canCreate = isAdmin || hasPermission("machine_control", "canCreate");
  const canDecide = isAdmin || hasPermission("machine_control", "canEdit");

  const utils = trpc.useUtils();
  const listQ = trpc.ecn.list.useQuery({ limit: 200 }, { enabled: canView });
  const productsQ = trpc.productModel.list.useQuery({ limit: 100 }); // productModel.list cap = max(100)
  const products = (productsQ.data ?? []) as Array<{ id: number; code?: string | null; name?: string | null }>;

  // Actor id → display name. user.list is admin-only, so only admins get names;
  // everyone else sees an honest "Người dùng #id" fallback (no crash, no leak of PII).
  const usersQ = (trpc as any).user?.list?.useQuery?.(undefined, { enabled: isAdmin });
  const userName = useMemo(() => {
    const map = new Map<number, string>();
    for (const u of ((usersQ?.data ?? []) as Array<{ id: number; name?: string | null; username?: string | null }>)) {
      map.set(u.id, u.name || u.username || `#${u.id}`);
    }
    return (id: number | null | undefined): string => {
      if (id == null) return "—";
      return map.get(id) ?? t("ecn.userFallback", "Người dùng #{{id}}", { id });
    };
  }, [usersQ?.data, t]);

  const invalidate = () => { void utils.ecn.list.invalidate(); };

  // ── Create dialog state ────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [changeType, setChangeType] = useState<ChangeType>("product");
  const [productModelId, setProductModelId] = useState<string>("");
  const [targetDescription, setTargetDescription] = useState("");
  const [reason, setReason] = useState("");
  const [impactNotes, setImpactNotes] = useState("");
  const [effectivityDate, setEffectivityDate] = useState("");

  // ── Reject dialog state (replaces window.prompt) ───────────────────────
  const [rejectTarget, setRejectTarget] = useState<Ecn | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // ── Detail dialog state ────────────────────────────────────────────────
  const [detail, setDetail] = useState<Ecn | null>(null);

  const resetForm = () => {
    setTitle(""); setChangeType("product"); setProductModelId("");
    setTargetDescription(""); setReason(""); setImpactNotes(""); setEffectivityDate("");
  };

  const createM = trpc.ecn.create.useMutation({
    onSuccess: () => { toast.success(t("ecn.created", "Đã tạo thay đổi kỹ thuật")); setOpen(false); resetForm(); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const transitionM = trpc.ecn.transition.useMutation({
    onSuccess: () => { toast.success(t("ecn.updated", "Đã cập nhật thay đổi kỹ thuật")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const submitCreate = () => {
    if (!title.trim()) { toast.error(t("ecn.titleRequired", "Bắt buộc nhập tiêu đề")); return; }
    createM.mutate({
      title: title.trim(),
      changeType,
      productModelId: productModelId ? Number(productModelId) : undefined,
      targetDescription: targetDescription.trim() || undefined,
      reason: reason.trim() || undefined,
      impactSummary: impactNotes.trim() ? { notes: impactNotes.trim() } : undefined,
      effectivityDate: effectivityDate || undefined,
    });
  };

  const doTransition = (ecn: Ecn, action: string) => {
    if (action === "reject") {
      setRejectReason("");
      setRejectTarget(ecn);
      return;
    }
    transitionM.mutate({ id: ecn.id, action: action as any });
  };

  const confirmReject = () => {
    const comment = rejectReason.trim();
    if (!comment) { toast.error(t("ecn.rejectReasonRequired", "Bắt buộc nhập lý do từ chối")); return; }
    if (!rejectTarget) return;
    transitionM.mutate(
      { id: rejectTarget.id, action: "reject", comment },
      { onSuccess: () => setRejectTarget(null) },
    );
  };

  // ── URL-synced status / type filter ────────────────────────────────────
  const filterDefs: FilterDef[] = useMemo(() => [
    {
      key: "status", type: "select", label: t("ecn.col.status", "Trạng thái"),
      placeholder: t("ecn.filter.allStatuses", "Mọi trạng thái"),
      options: ECN_STATUSES.map((s) => ({ value: s, label: t(`ecn.status.${s}`, s) })),
    },
    {
      key: "type", type: "select", label: t("ecn.col.type", "Loại"),
      placeholder: t("ecn.filter.allTypes", "Mọi loại"),
      options: CHANGE_TYPES.map((ct) => ({ value: ct, label: t(`ecn.type.${ct}`, ct) })),
    },
  ], [t]);
  const { values: filterValues } = useUrlFilters(filterDefs);

  const allRows = (listQ.data ?? []) as Ecn[];
  const rows = useMemo(() => allRows.filter((r) =>
    (!filterValues.status || r.status === filterValues.status) &&
    (!filterValues.type || r.changeType === filterValues.type)
  ), [allRows, filterValues.status, filterValues.type]);

  if (!canView) {
    return (
      <DashboardLayout title={t("ecn.title", "Thay đổi kỹ thuật")} navItems={navItems} currentPath="/engineering-changes">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("ecn.noPermission", "Bạn không có quyền xem thay đổi kỹ thuật.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("ecn.title", "Thay đổi kỹ thuật")} navItems={navItems} currentPath="/engineering-changes">
      <div className="space-y-6 p-6">
        <PageHeader
          icon={<GitPullRequestArrow className="h-6 w-6 text-primary" />}
          title={t("ecn.title", "Thay đổi kỹ thuật")}
          description={t("ecn.subtitle", "Quy trình yêu cầu thay đổi ECN / ECO — phân tích tác động, phê duyệt maker-checker và ngày hiệu lực.")}
          actions={
            canCreate ? (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="mr-1 h-4 w-4" />{t("ecn.new", "Thay đổi mới")}</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{t("ecn.newTitle", "Thay đổi kỹ thuật mới")}</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>{t("ecn.field.title", "Tiêu đề")}</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("ecn.field.titlePlaceholder", "VD: Cập nhật dung sai R12 trên model A")} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>{t("ecn.field.type", "Loại thay đổi")}</Label>
                        <Select value={changeType} onValueChange={(v) => setChangeType(v as ChangeType)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CHANGE_TYPES.map((ct) => (
                              <SelectItem key={ct} value={ct}>{t(`ecn.type.${ct}`, ct)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>{t("ecn.field.effectivity", "Ngày hiệu lực")}</Label>
                        <Input type="date" value={effectivityDate} onChange={(e) => setEffectivityDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.product", "Sản phẩm đích (tùy chọn)")}</Label>
                      <Select value={productModelId || "none"} onValueChange={(v) => setProductModelId(v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder={t("ecn.noProduct", "Không / không riêng sản phẩm")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("ecn.noProduct", "Không / không riêng sản phẩm")}</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>{p.code || p.name || `#${p.id}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.target", "Mô tả đối tượng (tùy chọn)")}</Label>
                      <Input value={targetDescription} onChange={(e) => setTargetDescription(e.target.value)} placeholder={t("ecn.field.targetPlaceholder", "VD: BOM v3 dòng R12 / recipe SMT-01")} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.reason", "Lý do")}</Label>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.impact", "Ghi chú phân tích tác động")}</Label>
                      <Textarea rows={2} value={impactNotes} onChange={(e) => setImpactNotes(e.target.value)} placeholder={t("ecn.field.impactPlaceholder", "Sản phẩm / chương trình / dây chuyền ảnh hưởng, rủi ro, phương án khôi phục…")} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", "Hủy")}</Button>
                    <Button onClick={submitCreate} disabled={createM.isPending}>{t("common.create", "Tạo")}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : undefined
          }
        />

        {/* ── Status / type filter ─────────────────────────────────────── */}
        <FilterBar filters={filterDefs} />

        {/* ── ECN list ─────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ecn.col.key", "ECN")}</TableHead>
                  <TableHead>{t("ecn.col.title", "Tiêu đề")}</TableHead>
                  <TableHead>{t("ecn.col.type", "Loại")}</TableHead>
                  <TableHead>{t("ecn.col.effectivity", "Hiệu lực")}</TableHead>
                  <TableHead>{t("ecn.col.status", "Trạng thái")}</TableHead>
                  <TableHead className="text-right">{t("ecn.col.actions", "Thao tác")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {listQ.isLoading
                      ? t("common.loading", "Đang tải…")
                      : allRows.length > 0
                        ? t("ecn.emptyFiltered", "Không có thay đổi nào khớp bộ lọc.")
                        : t("ecn.empty", "Chưa có thay đổi kỹ thuật nào.")}
                  </TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => setDetail(r)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter") setDetail(r); }}
                  >
                    <TableCell className="font-mono text-xs">{r.ecnKey}</TableCell>
                    <TableCell className="max-w-[24rem] truncate">{r.title}</TableCell>
                    <TableCell>{t(`ecn.type.${r.changeType}`, r.changeType)}</TableCell>
                    <TableCell>{fmtDate(r.effectivityDate)}</TableCell>
                    <TableCell><StatusBadge status={r.status} variant={ecnStatusVariant(r.status)} label={t(`ecn.status.${r.status}`, r.status)} /></TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap justify-end gap-1">
                        {canDecide ? actionsFor(r.status).map((a) => (
                          <Button
                            key={a.action}
                            size="sm"
                            variant={a.variant === "destructive" ? "destructive" : "outline"}
                            disabled={transitionM.isPending}
                            onClick={() => doTransition(r, a.action)}
                          >
                            {t(a.labelKey, a.fallback)}
                          </Button>
                        )) : <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Task 3: componentCode backfill (admin only) ──────────────── */}
        {isAdmin && <ComponentCodeBackfillPanel products={products} />}
      </div>

      {/* ── Reject reason dialog (replaces window.prompt) ──────────────── */}
      <AlertDialog open={rejectTarget != null} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("ecn.rejectTitle", "Từ chối thay đổi kỹ thuật")}</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget
                ? t("ecn.rejectPrompt", "Nêu rõ lý do từ chối {{key}}. Lý do được ghi vào nhật ký quyết định.", { key: rejectTarget.ecnKey })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label>{t("ecn.rejectReason", "Lý do từ chối:")}</Label>
            <Textarea
              rows={3}
              autoFocus
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("ecn.rejectPlaceholder", "VD: Thiếu phân tích tác động; cần đánh giá lại rủi ro…")}
            />
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>{t("common.cancel", "Hủy")}</Button>
            <Button variant="destructive" disabled={transitionM.isPending || !rejectReason.trim()} onClick={confirmReject}>
              {t("ecn.action.reject", "Từ chối")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Detail dialog ─────────────────────────────────────────────── */}
      <EcnDetailDialog ecn={detail} onClose={() => setDetail(null)} userName={userName} products={products} />
    </DashboardLayout>
  );
}

/** ECN detail — impact summary, actors, and a lifecycle timeline. Read-only. */
function EcnDetailDialog({
  ecn, onClose, userName, products,
}: {
  ecn: Ecn | null;
  onClose: () => void;
  userName: (id: number | null | undefined) => string;
  products: Array<{ id: number; code?: string | null; name?: string | null }>;
}) {
  const { t } = useTranslation();
  if (!ecn) return null;

  const productLabel = ecn.productModelId != null
    ? (products.find((p) => p.id === ecn.productModelId)?.code
        ?? products.find((p) => p.id === ecn.productModelId)?.name
        ?? `#${ecn.productModelId}`)
    : null;

  const impact = ecn.impactSummary ?? null;
  const impactList = (arr?: Array<number | string>) => (arr && arr.length ? arr.join(", ") : null);

  // Timeline steps in lifecycle order — only rendered when the stamp exists.
  const steps: Array<{ key: string; label: string; at: string | Date | null; who?: number | null }> = [
    { key: "created", label: t("ecn.timeline.created", "Tạo (bản nháp)"), at: ecn.createdAt, who: ecn.requestedBy },
    { key: "submitted", label: t("ecn.timeline.submitted", "Gửi duyệt"), at: ecn.submittedAt },
    { key: "reviewed", label: t("ecn.timeline.reviewed", "Xem xét"), at: ecn.reviewedAt, who: ecn.reviewedBy },
    { key: "approved", label: t("ecn.timeline.approved", "Phê duyệt"), at: ecn.approvedAt, who: ecn.approvedBy },
    { key: "implemented", label: t("ecn.timeline.implemented", "Triển khai"), at: ecn.implementedAt, who: ecn.implementedBy },
    { key: "closed", label: t("ecn.timeline.closed", "Đóng"), at: ecn.closedAt, who: ecn.closedBy },
  ].filter((s) => s.at != null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{ecn.ecnKey}</span>
            <StatusBadge status={ecn.status} variant={ecnStatusVariant(ecn.status)} label={t(`ecn.status.${ecn.status}`, ecn.status)} />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 text-sm">
          <div>
            <h3 className="font-semibold">{ecn.title}</h3>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>{t("ecn.col.type", "Loại")}: <b className="text-foreground">{t(`ecn.type.${ecn.changeType}`, ecn.changeType)}</b></span>
              <span>{t("ecn.col.effectivity", "Hiệu lực")}: <b className="text-foreground">{fmtDate(ecn.effectivityDate)}</b></span>
              {productLabel && <span>{t("ecn.field.product", "Sản phẩm đích")}: <b className="text-foreground">{productLabel}</b></span>}
            </div>
          </div>

          {(ecn.targetDescription || ecn.reason) && (
            <div className="space-y-2">
              {ecn.targetDescription && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ecn.field.target", "Mô tả đối tượng")}</div>
                  <p className="whitespace-pre-wrap">{ecn.targetDescription}</p>
                </div>
              )}
              {ecn.reason && (
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ecn.field.reason", "Lý do")}</div>
                  <p className="whitespace-pre-wrap">{ecn.reason}</p>
                </div>
              )}
            </div>
          )}

          {/* Impact summary */}
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ecn.detail.impact", "Phân tích tác động")}</div>
            {impact && (impact.notes || impactList(impact.affectedProducts) || impactList(impact.affectedPrograms) || impactList(impact.affectedLines)) ? (
              <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                {impactList(impact.affectedProducts) && <div>{t("ecn.detail.affectedProducts", "Sản phẩm ảnh hưởng")}: <b>{impactList(impact.affectedProducts)}</b></div>}
                {impactList(impact.affectedPrograms) && <div>{t("ecn.detail.affectedPrograms", "Chương trình ảnh hưởng")}: <b>{impactList(impact.affectedPrograms)}</b></div>}
                {impactList(impact.affectedLines) && <div>{t("ecn.detail.affectedLines", "Dây chuyền ảnh hưởng")}: <b>{impactList(impact.affectedLines)}</b></div>}
                {impact.notes && <p className="whitespace-pre-wrap text-muted-foreground">{impact.notes}</p>}
              </div>
            ) : (
              <p className="text-muted-foreground">{t("ecn.detail.noImpact", "Chưa ghi nhận phân tích tác động.")}</p>
            )}
          </div>

          {/* Actors */}
          <div>
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ecn.detail.actors", "Người liên quan")}</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              <span>{t("ecn.detail.requestedBy", "Người yêu cầu")}: <b>{userName(ecn.requestedBy)}</b></span>
              <span>{t("ecn.detail.reviewedBy", "Người xem xét")}: <b>{userName(ecn.reviewedBy)}</b></span>
              <span>{t("ecn.detail.approvedBy", "Người duyệt")}: <b>{userName(ecn.approvedBy)}</b></span>
              <span>{t("ecn.detail.implementedBy", "Người triển khai")}: <b>{userName(ecn.implementedBy)}</b></span>
              <span>{t("ecn.detail.closedBy", "Người đóng")}: <b>{userName(ecn.closedBy)}</b></span>
            </div>
          </div>

          {ecn.decisionComment && (
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ecn.detail.decisionComment", "Ghi chú quyết định")}</div>
              <p className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3">{ecn.decisionComment}</p>
            </div>
          )}

          {/* Timeline */}
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("ecn.detail.timeline", "Dòng thời gian")}</div>
            {steps.length === 0 ? (
              <p className="text-muted-foreground">{t("ecn.detail.noTimeline", "Chưa có mốc thời gian.")}</p>
            ) : (
              <ol className="space-y-2 border-l pl-4">
                {steps.map((s) => (
                  <li key={s.key} className="relative">
                    <span className="absolute -left-[1.35rem] top-1 h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(s.at)}</span>
                    </div>
                    {s.who != null && (
                      <div className="text-xs text-muted-foreground">{userName(s.who)}</div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.close", "Đóng")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * TASK 3 surface — triggers the EXISTING backfill procedure
 * `trpc.measurementPoint.backfillComponentCodesFromBom` (adminProcedure). Not a
 * reimplementation: this only calls it (dry-run preview → apply) and shows the
 * counts it returns.
 */
function ComponentCodeBackfillPanel({ products }: { products: Array<{ id: number; code?: string | null; name?: string | null }> }) {
  const { t } = useTranslation();
  const [productId, setProductId] = useState<string>("");
  const [result, setResult] = useState<null | { matched: number; updated: number; skippedAlreadyLinked: number; unmatched: any[]; bomDefinitionId: number | null; dryRun: boolean }>(null);

  // Access defensively so this compiles even if the proc path shifts.
  const mpApi = (trpc as any).measurementPoint;
  const backfillM = mpApi?.backfillComponentCodesFromBom?.useMutation?.({
    onSuccess: (r: any) => {
      setResult(r);
      toast.success(t("ecn.backfill.done", `Backfill ${r?.dryRun ? "(dry-run) " : ""}— matched ${r?.matched ?? 0}, updated ${r?.updated ?? 0}`));
    },
    onError: (e: any) => toast.error(e?.message ?? "Backfill failed"),
  });

  const run = (dryRun: boolean) => {
    if (!productId) { toast.error(t("ecn.backfill.pickProduct", "Hãy chọn một sản phẩm trước")); return; }
    if (!backfillM) { toast.error("Backfill procedure unavailable"); return; }
    setResult(null);
    backfillM.mutate({ productModelId: Number(productId), dryRun });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" />
          {t("ecn.backfill.title", "Bổ sung componentCode từ BOM")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("ecn.backfill.help", "Điền componentCode còn trống của điểm đo từ BOM sản phẩm (khớp refDesignator). Không phá hủy — liên kết sẵn có không bị ghi đè. Xem trước bằng dry-run trước khi áp dụng.")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] space-y-1">
            <Label>{t("ecn.backfill.product", "Sản phẩm")}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder={t("ecn.backfill.selectProduct", "Chọn sản phẩm…")} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code || p.name || `#${p.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={backfillM?.isPending} onClick={() => run(true)}>
            {t("ecn.backfill.dryRun", "Xem trước (dry-run)")}
          </Button>
          <Button disabled={backfillM?.isPending} onClick={() => run(false)}>
            {t("ecn.backfill.apply", "Áp dụng bổ sung")}
          </Button>
        </div>
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>{t("ecn.backfill.bom", "BOM")}: <b>{result.bomDefinitionId ?? "—"}</b></span>
              <span>{t("ecn.backfill.matched", "Khớp")}: <b>{result.matched}</b></span>
              <span>{t("ecn.backfill.updated", "Đã cập nhật")}: <b>{result.updated}</b></span>
              <span>{t("ecn.backfill.skipped", "Đã liên kết")}: <b>{result.skippedAlreadyLinked}</b></span>
              <span>{t("ecn.backfill.unmatched", "Chưa khớp")}: <b>{result.unmatched?.length ?? 0}</b></span>
              {result.dryRun && <span className="text-amber-600">{t("ecn.backfill.dryRunTag", "(dry-run — chưa ghi gì)")}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
