/**
 * Engineering Changes (ECN / ECO) — doc 35 Wave W4-D, task 2 + 3.
 *
 * The system had no GENERAL engineering-change workflow. This page is the ECN
 * queue: list changes with status, DRAFT a new change (title / type / target /
 * reason / effectivity / impact), and advance the maker-checker lifecycle
 * (submit → review → approve / reject → implement → close). Decision buttons are
 * gated on the permission hook; the SERVER additionally enforces role + SoD
 * (requester ≠ approver), so the client gate is a UX hint only.
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
import { PageHeader, StatusBadge, type BadgeVariant } from "@/components/patterns";
import { GitPullRequestArrow, AlertTriangle, Wrench, Plus } from "lucide-react";
import { toast } from "sonner";

const CHANGE_TYPES = ["product", "bom", "recipe", "program", "process", "document"] as const;
type ChangeType = (typeof CHANGE_TYPES)[number];

type Ecn = {
  id: number;
  ecnKey: string;
  title: string;
  changeType: string;
  productModelId: number | null;
  targetDescription: string | null;
  reason: string | null;
  status: string;
  effectivityDate: string | Date | null;
  requestedBy: number | null;
  approvedBy: number | null;
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

/** Which lifecycle actions are offered for a given current status. */
function actionsFor(status: string): Array<{ action: string; label: string; variant?: "destructive" }> {
  switch (status) {
    case "draft": return [{ action: "submit", label: "Submit" }];
    case "submitted": return [{ action: "review", label: "Start review" }, { action: "reject", label: "Reject", variant: "destructive" }];
    case "in_review": return [{ action: "approve", label: "Approve" }, { action: "reject", label: "Reject", variant: "destructive" }];
    case "approved": return [{ action: "implement", label: "Mark implemented" }, { action: "close", label: "Close" }];
    case "rejected": return [{ action: "close", label: "Close" }];
    case "implemented": return [{ action: "close", label: "Close" }];
    default: return [];
  }
}

export default function EngineeringChanges() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  const canView = isAdmin || hasPermission("masterdata", "canView");
  const canCreate = isAdmin || hasPermission("masterdata", "canCreate");
  const canDecide = isAdmin || hasPermission("masterdata", "canEdit");

  const utils = trpc.useUtils();
  const listQ = trpc.ecn.list.useQuery({ limit: 200 }, { enabled: canView });
  const productsQ = trpc.productModel.list.useQuery({ limit: 200 });
  const products = (productsQ.data ?? []) as Array<{ id: number; code?: string | null; name?: string | null }>;

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

  const resetForm = () => {
    setTitle(""); setChangeType("product"); setProductModelId("");
    setTargetDescription(""); setReason(""); setImpactNotes(""); setEffectivityDate("");
  };

  const createM = trpc.ecn.create.useMutation({
    onSuccess: () => { toast.success(t("ecn.created", "Engineering change created")); setOpen(false); resetForm(); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const transitionM = trpc.ecn.transition.useMutation({
    onSuccess: () => { toast.success(t("ecn.updated", "Engineering change updated")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const submitCreate = () => {
    if (!title.trim()) { toast.error(t("ecn.titleRequired", "Title is required")); return; }
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

  const rows = (listQ.data ?? []) as Ecn[];

  if (!canView) {
    return (
      <DashboardLayout title={t("ecn.title", "Engineering Changes")} navItems={navItems} currentPath="/engineering-changes">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("ecn.noPermission", "You do not have permission to view engineering changes.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("ecn.title", "Engineering Changes")} navItems={navItems} currentPath="/engineering-changes">
      <div className="space-y-6 p-6">
        <PageHeader
          icon={<GitPullRequestArrow className="h-6 w-6 text-primary" />}
          title={t("ecn.title", "Engineering Changes")}
          description={t("ecn.subtitle", "ECN / ECO change-request workflow — impact analysis, maker-checker approval, and effectivity.")}
          actions={
            canCreate ? (
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                  <Button size="sm"><Plus className="mr-1 h-4 w-4" />{t("ecn.new", "New change")}</Button>
                </DialogTrigger>
                <DialogContent className="max-w-lg">
                  <DialogHeader><DialogTitle>{t("ecn.newTitle", "New engineering change")}</DialogTitle></DialogHeader>
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label>{t("ecn.field.title", "Title")}</Label>
                      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Update R12 tolerance on model A" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>{t("ecn.field.type", "Change type")}</Label>
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
                        <Label>{t("ecn.field.effectivity", "Effectivity date")}</Label>
                        <Input type="date" value={effectivityDate} onChange={(e) => setEffectivityDate(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.product", "Target product (optional)")}</Label>
                      <Select value={productModelId || "none"} onValueChange={(v) => setProductModelId(v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder={t("ecn.noProduct", "None / not product-specific")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">{t("ecn.noProduct", "None / not product-specific")}</SelectItem>
                          {products.map((p) => (
                            <SelectItem key={p.id} value={String(p.id)}>{p.code || p.name || `#${p.id}`}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.target", "Target description (optional)")}</Label>
                      <Input value={targetDescription} onChange={(e) => setTargetDescription(e.target.value)} placeholder="e.g. BOM v3 line R12 / recipe SMT-01" />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.reason", "Reason")}</Label>
                      <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label>{t("ecn.field.impact", "Impact analysis notes")}</Label>
                      <Textarea rows={2} value={impactNotes} onChange={(e) => setImpactNotes(e.target.value)} placeholder="Affected products / programs / lines, risk, rollback…" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)}>{t("common.cancel", "Cancel")}</Button>
                    <Button onClick={submitCreate} disabled={createM.isPending}>{t("common.create", "Create")}</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            ) : undefined
          }
        />

        {/* ── ECN list ─────────────────────────────────────────────────── */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ecn.col.key", "ECN")}</TableHead>
                  <TableHead>{t("ecn.col.title", "Title")}</TableHead>
                  <TableHead>{t("ecn.col.type", "Type")}</TableHead>
                  <TableHead>{t("ecn.col.effectivity", "Effectivity")}</TableHead>
                  <TableHead>{t("ecn.col.status", "Status")}</TableHead>
                  <TableHead className="text-right">{t("ecn.col.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {listQ.isLoading ? t("common.loading", "Loading…") : t("ecn.empty", "No engineering changes yet.")}
                  </TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.ecnKey}</TableCell>
                    <TableCell className="max-w-[24rem] truncate">{r.title}</TableCell>
                    <TableCell>{t(`ecn.type.${r.changeType}`, r.changeType)}</TableCell>
                    <TableCell>{fmtDate(r.effectivityDate)}</TableCell>
                    <TableCell><StatusBadge status={r.status} variant={ecnStatusVariant(r.status)} label={t(`ecn.status.${r.status}`, r.status)} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {canDecide ? actionsFor(r.status).map((a) => (
                          <Button
                            key={a.action}
                            size="sm"
                            variant={a.variant === "destructive" ? "destructive" : "outline"}
                            disabled={transitionM.isPending}
                            onClick={() => {
                              const comment = a.action === "reject"
                                ? (window.prompt(t("ecn.rejectReason", "Reason for rejection:")) ?? undefined)
                                : undefined;
                              if (a.action === "reject" && !comment) return;
                              transitionM.mutate({ id: r.id, action: a.action as any, comment });
                            }}
                          >
                            {a.label}
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
    </DashboardLayout>
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
    if (!productId) { toast.error(t("ecn.backfill.pickProduct", "Pick a product first")); return; }
    if (!backfillM) { toast.error("Backfill procedure unavailable"); return; }
    setResult(null);
    backfillM.mutate({ productModelId: Number(productId), dryRun });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wrench className="h-4 w-4 text-primary" />
          {t("ecn.backfill.title", "Backfill componentCode from BOM")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {t("ecn.backfill.help", "Fill empty measurement-point componentCodes from the product's BOM (refDesignator match). Non-destructive — existing links are never overwritten. Preview with a dry-run before applying.")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] space-y-1">
            <Label>{t("ecn.backfill.product", "Product")}</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger><SelectValue placeholder={t("ecn.backfill.selectProduct", "Select product…")} /></SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.code || p.name || `#${p.id}`}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" disabled={backfillM?.isPending} onClick={() => run(true)}>
            {t("ecn.backfill.dryRun", "Dry-run preview")}
          </Button>
          <Button disabled={backfillM?.isPending} onClick={() => run(false)}>
            {t("ecn.backfill.apply", "Apply backfill")}
          </Button>
        </div>
        {result && (
          <div className="rounded-md border bg-muted/30 p-3 text-sm">
            <div className="flex flex-wrap gap-4">
              <span>{t("ecn.backfill.bom", "BOM")}: <b>{result.bomDefinitionId ?? "—"}</b></span>
              <span>{t("ecn.backfill.matched", "Matched")}: <b>{result.matched}</b></span>
              <span>{t("ecn.backfill.updated", "Updated")}: <b>{result.updated}</b></span>
              <span>{t("ecn.backfill.skipped", "Already linked")}: <b>{result.skippedAlreadyLinked}</b></span>
              <span>{t("ecn.backfill.unmatched", "Unmatched")}: <b>{result.unmatched?.length ?? 0}</b></span>
              {result.dryRun && <span className="text-amber-600">{t("ecn.backfill.dryRunTag", "(dry-run — nothing written)")}</span>}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
