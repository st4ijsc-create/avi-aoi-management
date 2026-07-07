/**
 * Non-Conformance Reports (NCR / MRB) — quality governance surface.
 *
 * Backend: server/routers/ncrRouter.ts (doc 35 Wave W4-B). This page was the
 * missing UI the audit flagged: an NG inspection / rejected lot / audit finding
 * had a backend to be RAISED → REVIEWED → DISPOSITIONED → CLOSED but nowhere to
 * do it. It surfaces:
 *   • list (filter by status / source) with status + source + disposition badges
 *     and linked serial / lot / product traceability handles,
 *   • create (raise) — any authenticated user may raise (server: protectedProcedure),
 *   • lifecycle transitions (review → disposition → close) — quality-gated. SoD
 *     (raiser ≠ decider) is SERVER-enforced in ncrService.transitionNcr; the UI
 *     mirrors it (own-NCR disposition disabled + hint) and hides decision buttons
 *     unless the user holds the quality grant.
 *
 * RBAC (UX gate only — server also enforces role): module `analytics_spc`
 * (the quality analytics grant shared by the Quality group). canView gates the
 * page; canEdit gates the review/disposition/close actions. Raise is offered to
 * any viewer because the server allows any authenticated user to raise.
 *
 * NOTE: createNcr has no `disposition` input — a disposition is chosen at the
 * DISPOSITION transition (MRB decision), not at raise time. So the create dialog
 * omits it; the disposition select lives in the transition action.
 *
 * SAFETY: pure quality-record lifecycle — never writes a value to a machine.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { StatusBadge, PageHeader, PageContainer, type BadgeVariant } from "@/components/patterns";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ClipboardX, Plus, AlertTriangle, ArrowRightCircle, CheckCircle2, Gavel } from "lucide-react";
import { toast } from "sonner";

const SOURCES = ["inspection", "lot", "audit"] as const;
const STATUSES = ["open", "in_review", "dispositioned", "closed"] as const;
const DISPOSITIONS = ["use_as_is", "rework", "scrap", "return", "rtv"] as const;

type NcrSource = (typeof SOURCES)[number];
type NcrStatus = (typeof STATUSES)[number];
type NcrDisposition = (typeof DISPOSITIONS)[number];
type NcrAction = "review" | "disposition" | "close";

type Ncr = {
  id: number;
  ncrKey: string;
  source: NcrSource;
  linkedInspectionId: number | null;
  lotNumber: string | null;
  serialNumber: string | null;
  productModelId: number | null;
  defectSummary: string | null;
  disposition: NcrDisposition | null;
  status: NcrStatus;
  quarantineLocationId: number | null;
  raisedBy: number | null;
  reviewedBy: number | null;
  decidedBy: number | null;
  closedBy: number | null;
  reason: string | null;
  note: string | null;
  raisedAt: string | Date | null;
};

const STATUS_VARIANT: Record<NcrStatus, BadgeVariant> = {
  open: "default",
  in_review: "secondary",
  dispositioned: "secondary",
  closed: "outline",
};

function dispositionVariant(d: NcrDisposition): BadgeVariant {
  if (d === "scrap" || d === "return" || d === "rtv") return "destructive";
  if (d === "rework") return "default";
  return "secondary"; // use_as_is
}

/** The single forward action offered for a given status (mirrors LEGAL_TRANSITIONS). */
function nextAction(status: NcrStatus): NcrAction | null {
  if (status === "open") return "review";
  if (status === "in_review") return "disposition";
  if (status === "dispositioned") return "close";
  return null; // closed
}

export default function NonconformanceReports() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("analytics_spc", "canView");
  const canDecide = hasPermission("analytics_spc", "canEdit");

  const meQ = trpc.auth.me.useQuery(undefined, { enabled: canView });
  const myId = (meQ.data as any)?.id as number | undefined;

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [sourceFilter, setSourceFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Ncr | null>(null);

  // Inbound hand-off (e.g. from InspectionDetail "Raise NCR"): ?serial=…&inspectionId=…
  // Prefill + auto-open the create dialog once on mount; guard so it does not
  // reopen after the user closes it, and clear the prefill when they do.
  const search = useSearch();
  const [prefill, setPrefill] = useState<
    { serialNumber?: string; linkedInspectionId?: number } | undefined
  >(undefined);
  const handledPrefill = useRef(false);
  useEffect(() => {
    if (handledPrefill.current) return;
    const params = new URLSearchParams(search);
    const serial = params.get("serial")?.trim();
    const inspRaw = params.get("inspectionId")?.trim();
    const linkedInspectionId = inspRaw && /^\d+$/.test(inspRaw) ? Number(inspRaw) : undefined;
    if (serial || linkedInspectionId != null) {
      handledPrefill.current = true;
      setPrefill({ serialNumber: serial || undefined, linkedInspectionId });
      setCreateOpen(true);
    }
  }, [search]);

  const utils = trpc.useUtils();
  const productsQ = trpc.productModel.list.useQuery({ limit: 100 }, { enabled: canView });
  const listQ = trpc.ncr.list.useQuery(
    {
      status: (statusFilter || undefined) as NcrStatus | undefined,
      source: (sourceFilter || undefined) as NcrSource | undefined,
      limit: 200,
    },
    { enabled: canView },
  );

  const products = (productsQ.data ?? []) as Array<{ id: number; code: string; name?: string | null }>;
  const productLabel = (id: number | null) => {
    if (id == null) return "—";
    const p = products.find((x) => x.id === id);
    return p ? `${p.code}${p.name ? ` — ${p.name}` : ""}` : `#${id}`;
  };

  const invalidate = () => { void utils.ncr.list.invalidate(); };

  const createM = trpc.ncr.create.useMutation({
    onSuccess: () => { toast.success(t("ncr.created", "NCR raised")); setCreateOpen(false); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const transitionM = trpc.ncr.transition.useMutation({
    onSuccess: () => { toast.success(t("ncr.transitioned", "NCR updated")); setDetail(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const rows = (listQ.data ?? []) as Ncr[];

  const counts = useMemo(() => {
    const c = { open: 0, in_review: 0, dispositioned: 0, closed: 0 } as Record<NcrStatus, number>;
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  if (!canView) {
    return (
      <DashboardLayout title={t("ncr.title", "Non-Conformance Reports")} navItems={navItems} currentPath="/nonconformance">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("ncr.noPermission", "You do not have permission to view non-conformance reports.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("ncr.title", "Non-Conformance Reports")} navItems={navItems} currentPath="/nonconformance">
      <PageContainer fluid className="space-y-4">
        <PageHeader
          icon={<ClipboardX className="h-6 w-6 text-primary" />}
          title={t("ncr.title", "Non-Conformance Reports")}
          description={t("ncr.subtitle", "MRB — raise, review, disposition and close quality non-conformances.")}
          actions={
            <>
              <span className="flex flex-wrap gap-1">
                <Badge variant="default">{t("ncr.count.open", "Open")}: {counts.open}</Badge>
                <Badge variant="secondary">{t("ncr.count.inReview", "In review")}: {counts.in_review}</Badge>
                <Badge variant="secondary">{t("ncr.count.dispositioned", "Dispositioned")}: {counts.dispositioned}</Badge>
                <Badge variant="outline">{t("ncr.count.closed", "Closed")}: {counts.closed}</Badge>
              </span>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("ncr.raise", "Raise NCR")}
              </Button>
            </>
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label>{t("ncr.filterStatus", "Status")}</Label>
            <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger aria-label={t("ncr.filterStatus", "Status")} className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("ncr.all", "All")}</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`ncr.status.${s}`, s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("ncr.filterSource", "Source")}</Label>
            <Select value={sourceFilter || "ALL"} onValueChange={(v) => setSourceFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger aria-label={t("ncr.filterSource", "Source")} className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("ncr.all", "All")}</SelectItem>
                {SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`ncr.source.${s}`, s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("ncr.col.key", "NCR")}</TableHead>
                  <TableHead>{t("ncr.col.source", "Source")}</TableHead>
                  <TableHead>{t("ncr.col.linked", "Linked")}</TableHead>
                  <TableHead>{t("ncr.col.product", "Product")}</TableHead>
                  <TableHead>{t("ncr.col.summary", "Defect summary")}</TableHead>
                  <TableHead>{t("ncr.col.disposition", "Disposition")}</TableHead>
                  <TableHead>{t("ncr.col.status", "Status")}</TableHead>
                  <TableHead className="text-right">{t("ncr.col.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t("ncr.loading", "Loading…")}</TableCell></TableRow>
                )}
                {listQ.isError && !listQ.isLoading && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-destructive">{t("ncr.loadError", "Failed to load NCRs.")}</TableCell></TableRow>
                )}
                {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">{t("ncr.empty", "No non-conformance reports.")}</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.ncrKey}</TableCell>
                    <TableCell><Badge variant="outline">{t(`ncr.source.${r.source}`, r.source)}</Badge></TableCell>
                    <TableCell className="text-xs">
                      {r.serialNumber && <div>SN: {r.serialNumber}</div>}
                      {r.lotNumber && <div>Lot: {r.lotNumber}</div>}
                      {r.linkedInspectionId != null && <div>Insp #{r.linkedInspectionId}</div>}
                      {!r.serialNumber && !r.lotNumber && r.linkedInspectionId == null && <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-xs">{productLabel(r.productModelId)}</TableCell>
                    <TableCell className="max-w-[20rem] truncate">{r.defectSummary || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {r.disposition
                        ? <StatusBadge status={r.disposition} variant={dispositionVariant(r.disposition)} label={t(`ncr.disposition.${r.disposition}`, r.disposition)} />
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell><StatusBadge status={r.status} variant={STATUS_VARIANT[r.status]} label={t(`ncr.status.${r.status}`, r.status)} /></TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>{t("ncr.open", "Open")}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </PageContainer>

      {createOpen && (
        <CreateDialog
          products={products}
          initialSerial={prefill?.serialNumber}
          initialInspectionId={prefill?.linkedInspectionId}
          onClose={() => { setCreateOpen(false); setPrefill(undefined); }}
          onSubmit={(v) => createM.mutate(v as any)}
          pending={createM.isPending}
        />
      )}

      {detail && (
        <DetailDialog
          ncr={detail}
          productLabel={productLabel}
          canDecide={canDecide}
          isRaiser={myId != null && myId === detail.raisedBy}
          onClose={() => setDetail(null)}
          onTransition={(action, disposition, note) =>
            transitionM.mutate({ id: detail.id, action, disposition, note })}
          busy={transitionM.isPending}
        />
      )}
    </DashboardLayout>
  );
}

function CreateDialog({
  products, initialSerial, initialInspectionId, onClose, onSubmit, pending,
}: {
  products: Array<{ id: number; code: string; name?: string | null }>;
  initialSerial?: string;
  initialInspectionId?: number;
  onClose: () => void;
  onSubmit: (v: Record<string, any>) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [source, setSource] = useState<NcrSource>("inspection");
  const [ncrKey, setNcrKey] = useState("");
  const [productModelId, setProductModelId] = useState<string>("");
  const [serialNumber, setSerialNumber] = useState(initialSerial ?? "");
  const [lotNumber, setLotNumber] = useState("");
  const [linkedInspectionId, setLinkedInspectionId] = useState(
    initialInspectionId != null ? String(initialInspectionId) : "",
  );
  const [defectSummary, setDefectSummary] = useState("");
  const [reason, setReason] = useState("");

  const submit = () => {
    onSubmit({
      source,
      ncrKey: ncrKey.trim() || undefined,
      productModelId: productModelId ? Number(productModelId) : undefined,
      serialNumber: serialNumber.trim() || undefined,
      lotNumber: lotNumber.trim() || undefined,
      linkedInspectionId: linkedInspectionId ? Number(linkedInspectionId) : undefined,
      defectSummary: defectSummary.trim() || undefined,
      reason: reason.trim() || undefined,
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("ncr.raise", "Raise NCR")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label>{t("ncr.col.source", "Source")} *</Label>
              <Select value={source} onValueChange={(v) => setSource(v as NcrSource)}>
                <SelectTrigger aria-label={t("ncr.col.source", "Source")} className="h-9 w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => <SelectItem key={s} value={s}>{t(`ncr.source.${s}`, s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label>{t("ncr.field.key", "NCR key")}</Label>
              <Input placeholder={t("ncr.field.keyAuto", "Auto-generated if blank")} value={ncrKey} onChange={(e) => setNcrKey(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("ncr.col.product", "Product")}</Label>
            <Select value={productModelId || "NONE"} onValueChange={(v) => setProductModelId(v === "NONE" ? "" : v)}>
              <SelectTrigger aria-label={t("ncr.col.product", "Product")} className="h-9 w-full">
                <SelectValue placeholder={t("ncr.field.selectProduct", "Select a product…")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NONE">{t("ncr.field.noProduct", "— none —")}</SelectItem>
                {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}{p.name ? ` — ${p.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1">
              <Label>{t("ncr.field.serial", "Serial")}</Label>
              <Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("ncr.field.lot", "Lot")}</Label>
              <Input value={lotNumber} onChange={(e) => setLotNumber(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("ncr.field.inspection", "Inspection #")}</Label>
              <Input type="number" value={linkedInspectionId} onChange={(e) => setLinkedInspectionId(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("ncr.col.summary", "Defect summary")}</Label>
            <Textarea value={defectSummary} onChange={(e) => setDefectSummary(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("ncr.field.reason", "Reason / notes")}</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t("ncr.field.dispositionHint", "A disposition (use-as-is / rework / scrap / return / RTV) is decided later at the MRB disposition step — not at raise time.")}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>{t("ncr.raise", "Raise NCR")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailDialog({
  ncr, productLabel, canDecide, isRaiser, onClose, onTransition, busy,
}: {
  ncr: Ncr;
  productLabel: (id: number | null) => string;
  canDecide: boolean;
  isRaiser: boolean;
  onClose: () => void;
  onTransition: (action: NcrAction, disposition: NcrDisposition | undefined, note: string | undefined) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [disposition, setDisposition] = useState<NcrDisposition>("rework");
  const [note, setNote] = useState("");

  const action = nextAction(ncr.status);
  const isDisposition = action === "disposition";
  // SoD (server-enforced): the raiser cannot disposition their own NCR.
  const sodBlocked = isDisposition && isRaiser;

  const actionLabel =
    action === "review" ? t("ncr.action.review", "Send to review")
    : action === "disposition" ? t("ncr.action.disposition", "Record disposition")
    : action === "close" ? t("ncr.action.close", "Close NCR")
    : "";
  const ActionIcon = action === "review" ? ArrowRightCircle : action === "disposition" ? Gavel : CheckCircle2;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{ncr.ncrKey}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t(`ncr.source.${ncr.source}`, ncr.source)}</Badge>
            <StatusBadge status={ncr.status} variant={STATUS_VARIANT[ncr.status]} label={t(`ncr.status.${ncr.status}`, ncr.status)} />
            {ncr.disposition && (
              <StatusBadge status={ncr.disposition} variant={dispositionVariant(ncr.disposition)} label={t(`ncr.disposition.${ncr.disposition}`, ncr.disposition)} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><span className="text-muted-foreground">{t("ncr.col.product", "Product")}: </span>{productLabel(ncr.productModelId)}</div>
            <div><span className="text-muted-foreground">{t("ncr.field.serial", "Serial")}: </span>{ncr.serialNumber || "—"}</div>
            <div><span className="text-muted-foreground">{t("ncr.field.lot", "Lot")}: </span>{ncr.lotNumber || "—"}</div>
            <div><span className="text-muted-foreground">{t("ncr.field.inspection", "Inspection #")}: </span>{ncr.linkedInspectionId ?? "—"}</div>
          </div>

          {ncr.defectSummary && (
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">{t("ncr.col.summary", "Defect summary")}</div>
              <p className="whitespace-pre-wrap">{ncr.defectSummary}</p>
            </div>
          )}
          {ncr.note && (
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">{t("ncr.field.lastNote", "Last note")}: {ncr.note}</div>
          )}

          {/* Lifecycle action */}
          {action == null ? (
            <div className="rounded-md border p-3 text-muted-foreground">
              {t("ncr.closedInfo", "This NCR is closed — no further actions.")}
            </div>
          ) : !canDecide ? (
            <div className="flex items-start gap-2 rounded-md border p-2.5 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("ncr.noDecidePermission", "You need the quality grant to advance this NCR.")}</span>
            </div>
          ) : (
            <div className="rounded-md border p-3 space-y-3 bg-muted/30">
              <div className="text-sm font-medium">{t("ncr.advanceTitle", "Advance NCR")}</div>
              {isDisposition && (
                <div className="grid gap-1">
                  <Label>{t("ncr.col.disposition", "Disposition")} *</Label>
                  <Select value={disposition} onValueChange={(v) => setDisposition(v as NcrDisposition)}>
                    <SelectTrigger aria-label={t("ncr.col.disposition", "Disposition")} className="h-9 w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DISPOSITIONS.map((d) => <SelectItem key={d} value={d}>{t(`ncr.disposition.${d}`, d)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1">
                <Label>{t("ncr.field.note", "Note")}</Label>
                <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              {sodBlocked && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{t("ncr.sodHint", "Segregation of duties: you raised this NCR, so a different reviewer must disposition it.")}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>{t("common.close", "Close")}</Button>
          {action != null && canDecide && (
            <Button
              disabled={busy || sodBlocked}
              onClick={() => onTransition(action, isDisposition ? disposition : undefined, note.trim() || undefined)}
            >
              <ActionIcon className="h-4 w-4 mr-1" /> {actionLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
