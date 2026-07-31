/**
 * Threshold Approvals — manager review queue (doc 31 OP8).
 *
 * The `thresholdApproval` router provides request/approve/reject/withdraw/list/
 * getById. AIThresholdSuggestButton now only *requests* (SoD — a different
 * reviewer must approve). This page is the review queue: list pending + history,
 * open an item to see resolved point/product metadata + current vs proposed
 * LSL/USL/nominal + the AI suggestion basis (incl. Cpk) + recent-NG evidence
 * thumbnails, and Approve (optionally apply) / Reject / Withdraw.
 *
 * OP8 upgrades:
 *   - Metadata: resolved point code/name + product code/name (WA-1's enriched
 *     `list`), falling back to `MP-{pointDefId}` when the enrichment is absent.
 *   - Batch approve: multi-select + "Approve selected (N)" → `batchApprove(ids[])`
 *     with a per-id result summary (approved / skipped-SoD / failed). Your own
 *     requests show a disabled checkbox (server enforces SoD).
 *   - Revert: per-applied-row "Revert" → `revert({ id })` (confirm dialog),
 *     restoring the prior limits.
 *
 * batchApprove/revert are delivered by WA-1 in the same wave; they are accessed
 * defensively (see `thresholdApi`) so this page type-checks and degrades to a
 * friendly error if a proc is momentarily absent.
 *
 * RBAC: gated on `settings_alerts` (the analytics/quality manager grant). The
 * server additionally enforces SoD (decidedBy ≠ requestedBy) + "only requester
 * can withdraw". SAFETY: only edits measurement-point spec limits (no machine write).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader, StatusBadge, type BadgeVariant } from "@/components/patterns";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SlidersHorizontal, AlertTriangle, CheckCircle2, XCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { mapTrpcError } from "@/lib/trpcErrors";
import { normalizeBatchResponse, type BatchSummary } from "./thresholdApprovalsBatch";

type Approval = {
  id: number;
  pointDefId: number;
  requestedBy: number;
  suggestion: Record<string, any> | null;
  currentLsl: string | null;
  currentUsl: string | null;
  currentNominal: string | null;
  proposedLsl: string | null;
  proposedUsl: string | null;
  proposedNominal: string | null;
  status: string;
  comment: string | null;
  decidedBy: number | null;
  decidedAt: string | Date | null;
  decidedComment: string | null;
  createdAt: string | Date | null;
  // WA-1 enriched `list` (optional — feature-detected by presence).
  pointCode?: string | null;
  pointName?: string | null;
  productCode?: string | null;
  productName?: string | null;
};

const PENDING = "requested";

// Approval status → solid shadcn <Badge> variant, unified onto the shared
// <StatusBadge> (W4). Preserves the exact prior look.
function approvalStatusVariant(s: string): BadgeVariant {
  if (s === "applied" || s === "approved") return "secondary";
  if (s === "rejected") return "destructive";
  if (s === "withdrawn") return "outline";
  return "default"; // requested
}

function num(v: string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

/** Resolved point label (WA-1 enriched) with graceful fallback to MP-{id}. */
function pointPrimary(r: Approval): string {
  return r.pointCode?.trim() || `MP-${r.pointDefId}`;
}

export default function ThresholdApprovalsPage() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("settings_alerts", "canView");
  const canDecide = hasPermission("settings_alerts", "canEdit");

  const meQ = trpc.auth.me.useQuery();
  const myId = (meQ.data as any)?.id as number | undefined;

  const utils = trpc.useUtils();
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [detail, setDetail] = useState<Approval | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [revertTarget, setRevertTarget] = useState<Approval | null>(null);

  // batchApprove/revert are WA-1's; access defensively so tsc passes regardless
  // of WA-1's landing time and a missing proc degrades to a toast, not a crash.
  const thresholdApi = trpc.thresholdApproval as any;

  const pendingQ = trpc.thresholdApproval.list.useQuery({ status: PENDING, limit: 200 }, { enabled: canView });
  const historyQ = trpc.thresholdApproval.list.useQuery({ limit: 200 }, { enabled: canView });

  const invalidate = () => {
    void utils.thresholdApproval.list.invalidate();
  };

  const isOwn = (r: Approval) => myId != null && myId === r.requestedBy;

  const approveM = trpc.thresholdApproval.approve.useMutation({
    onSuccess: () => { toast.success(t("thresholdApprovals.approved")); setDetail(null); invalidate(); },
    onError: (e) => toast.error(mapTrpcError(e)),
  });
  const rejectM = trpc.thresholdApproval.reject.useMutation({
    onSuccess: () => { toast.success(t("thresholdApprovals.rejected")); setDetail(null); invalidate(); },
    onError: (e) => toast.error(mapTrpcError(e)),
  });
  const withdrawM = trpc.thresholdApproval.withdraw.useMutation({
    onSuccess: () => { toast.success(t("thresholdApprovals.withdrawn")); setDetail(null); invalidate(); },
    onError: (e) => toast.error(mapTrpcError(e)),
  });
  const batchApproveM = thresholdApi.batchApprove.useMutation({
    onSuccess: (resp: unknown) => {
      const s = normalizeBatchResponse(resp);
      setBatchSummary(s);
      setSelected(new Set());
      toast.success(
        t("thresholdApprovals.batchResult", { approved: s.approved, skipped: s.skipped, failed: s.failed }),
      );
      invalidate();
    },
    onError: (e: any) => toast.error(mapTrpcError(e)),
  });
  const revertM = thresholdApi.revert.useMutation({
    onSuccess: () => { toast.success(t("thresholdApprovals.reverted")); setRevertTarget(null); invalidate(); },
    onError: (e: any) => toast.error(mapTrpcError(e)),
  });

  // Rows a reviewer may batch-approve: pending + not their own (mirror server SoD).
  const selectableIds = useMemo(
    () => ((pendingQ.data ?? []) as Approval[]).filter((r) => !isOwn(r)).map((r) => r.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingQ.data, myId],
  );
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selectableIds.some((id) => selected.has(id));
  const headerChecked: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false;

  const toggleAll = (v: boolean) => setSelected(v ? new Set(selectableIds) : new Set());
  const toggleOne = (id: number, v: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (v) n.add(id); else n.delete(id);
      return n;
    });

  const runBatch = () => {
    if (selected.size === 0) return;
    setBatchSummary(null);
    batchApproveM.mutate({ ids: Array.from(selected) });
  };

  if (!canView) {
    return (
      <DashboardLayout title={t("thresholdApprovals.title")} navItems={navItems} currentPath="/threshold-approvals">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("thresholdApprovals.noPermission")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  const renderTable = (q: typeof pendingQ, rows: Approval[], mode: "pending" | "history") => {
    const showCheckbox = mode === "pending" && canDecide;
    const colCount = 7 + (showCheckbox ? 1 : 0); // [chk] id point product current proposed status actions
    return (
      <Card>
        <CardContent className="p-0">
          {showCheckbox && (
            <div className="flex flex-wrap items-center gap-2 border-b p-3">
              <Button
                size="sm"
                disabled={selected.size === 0 || batchApproveM.isPending}
                onClick={runBatch}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                {t("thresholdApprovals.approveSelected", { n: selected.size })}
              </Button>
              {selected.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  {t("thresholdApprovals.clearSelection")}
                </Button>
              )}
              {batchSummary && (
                <span className="text-xs text-muted-foreground">
                  {t("thresholdApprovals.batchResult", {
                    approved: batchSummary.approved,
                    skipped: batchSummary.skipped,
                    failed: batchSummary.failed,
                  })}
                </span>
              )}
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                {showCheckbox && (
                  <TableHead className="w-10">
                    <Checkbox
                      checked={headerChecked}
                      disabled={selectableIds.length === 0}
                      onCheckedChange={(v) => toggleAll(v === true)}
                      aria-label={t("thresholdApprovals.selectAll")}
                    />
                  </TableHead>
                )}
                <TableHead>{t("thresholdApprovals.col.id")}</TableHead>
                <TableHead>{t("thresholdApprovals.col.point")}</TableHead>
                <TableHead>{t("thresholdApprovals.col.product")}</TableHead>
                <TableHead>{t("thresholdApprovals.col.current")}</TableHead>
                <TableHead>{t("thresholdApprovals.col.proposed")}</TableHead>
                <TableHead>{t("thresholdApprovals.col.status")}</TableHead>
                <TableHead className="text-right">{t("thresholdApprovals.col.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading && (
                <TableRow><TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">{t("thresholdApprovals.loading")}</TableCell></TableRow>
              )}
              {!q.isLoading && rows.length === 0 && (
                <TableRow><TableCell colSpan={colCount} className="text-center py-8 text-muted-foreground">{t("thresholdApprovals.empty")}</TableCell></TableRow>
              )}
              {rows.map((r) => (
                <TableRow key={r.id}>
                  {showCheckbox && (
                    <TableCell>
                      {isOwn(r) ? (
                        <span title={t("thresholdApprovals.ownRequestHint")} className="inline-flex">
                          <Checkbox checked={false} disabled aria-label={t("thresholdApprovals.ownRequestHint")} />
                        </span>
                      ) : (
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={(v) => toggleOne(r.id, v === true)}
                          aria-label={t("thresholdApprovals.selectRow", { id: r.id })}
                        />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs">#{r.id}</TableCell>
                  <TableCell>
                    <div className="font-medium">{pointPrimary(r)}</div>
                    {r.pointName && <div className="text-xs text-muted-foreground">{r.pointName}</div>}
                  </TableCell>
                  <TableCell>
                    {r.productCode ? (
                      <div>
                        <div className="text-sm">{r.productCode}</div>
                        {r.productName && <div className="text-xs text-muted-foreground">{r.productName}</div>}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">[{num(r.currentLsl)}, {num(r.currentUsl)}]</TableCell>
                  <TableCell className="text-xs">[{num(r.proposedLsl)}, {num(r.proposedUsl)}]</TableCell>
                  <TableCell><StatusBadge status={r.status} variant={approvalStatusVariant(r.status)} label={t(`thresholdApprovals.statusEnum.${r.status}`)} /></TableCell>
                  <TableCell className="text-right space-x-1">
                    {mode === "history" && canDecide && r.status === "applied" && (
                      <Button size="sm" variant="outline" onClick={() => setRevertTarget(r)}>
                        <Undo2 className="h-3.5 w-3.5 mr-1" /> {t("thresholdApprovals.revert")}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setDetail(r)}>{t("thresholdApprovals.review")}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    );
  };

  return (
    <DashboardLayout title={t("thresholdApprovals.title")} navItems={navItems} currentPath="/threshold-approvals">
      <div className="p-6 space-y-4">
        <PageHeader
          icon={<SlidersHorizontal className="h-6 w-6 text-primary" />}
          title={t("thresholdApprovals.title")}
          actions={<Badge variant="outline">{t("thresholdApprovals.queueBadge")}</Badge>}
        />

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <TabsList>
            <TabsTrigger value="pending">
              {t("thresholdApprovals.tabPending")}
              {pendingQ.data && (pendingQ.data as Approval[]).length > 0 && (
                <Badge className="ml-2" variant="default">{(pendingQ.data as Approval[]).length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="history">{t("thresholdApprovals.tabHistory")}</TabsTrigger>
          </TabsList>
          <TabsContent value="pending">{renderTable(pendingQ, (pendingQ.data ?? []) as Approval[], "pending")}</TabsContent>
          <TabsContent value="history">{renderTable(historyQ, (historyQ.data ?? []) as Approval[], "history")}</TabsContent>
        </Tabs>
      </div>

      {detail && (
        <ReviewDialog
          item={detail}
          canDecide={canDecide}
          isRequester={isOwn(detail)}
          onClose={() => setDetail(null)}
          onApprove={(apply, comment) => approveM.mutate({ id: detail.id, apply, comment })}
          onReject={(comment) => rejectM.mutate({ id: detail.id, comment })}
          onWithdraw={(comment) => withdrawM.mutate({ id: detail.id, comment })}
          busy={approveM.isPending || rejectM.isPending || withdrawM.isPending}
        />
      )}

      <AlertDialog open={revertTarget != null} onOpenChange={(o) => { if (!o) setRevertTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("thresholdApprovals.revertConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>{t("thresholdApprovals.revertConfirmBody", { id: revertTarget?.id ?? 0 })}</p>
                {revertTarget && (
                  <p className="mt-2 text-xs">
                    {t("thresholdApprovals.revertRestore", {
                      lsl: num(revertTarget.currentLsl),
                      usl: num(revertTarget.currentUsl),
                    })}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("thresholdApprovals.close")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={revertM.isPending}
              onClick={() => { if (revertTarget) revertM.mutate({ approvalId: revertTarget.id }); }}
            >
              <Undo2 className="h-4 w-4 mr-1" /> {t("thresholdApprovals.revert")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function ReviewDialog({
  item, canDecide, isRequester, onClose, onApprove, onReject, onWithdraw, busy,
}: {
  item: Approval;
  canDecide: boolean;
  isRequester: boolean;
  onClose: () => void;
  onApprove: (apply: boolean, comment: string | undefined) => void;
  onReject: (comment: string) => void;
  onWithdraw: (comment: string | undefined) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const [apply, setApply] = useState(true);
  const [comment, setComment] = useState("");
  const isPending = item.status === PENDING;

  // Pull a Cpk / basis out of the suggestion JSON if present (best-effort, honest).
  const s = item.suggestion ?? {};
  const cpk = s.cpk ?? s.Cpk ?? s.proposedCpk ?? null;
  const basis = s.basis ?? s.reason ?? s.rationale ?? null;
  // V25 — explicit AI auto-tune provenance (suggestion.proposedBy/source markers).
  const isAutoTune = s.proposedBy === "ai_autotune" || s.source === "ai_threshold_autotune";
  // V20 — recent-NG image evidence attached by the auto-tune scheduler.
  const recentNg: Array<{
    measurementId?: number;
    imageUrl?: string | null;
    aiDescription?: string | null;
    at?: string | null;
  }> = Array.isArray(s.evidence?.recentNg) ? s.evidence.recentNg : [];

  const submitReject = () => {
    if (comment.trim().length === 0) { toast.error(t("thresholdApprovals.commentRequired")); return; }
    onReject(comment.trim());
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("thresholdApprovals.reviewTitle", { id: item.id })}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2 text-sm">
          {/* resolved point + product metadata */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{pointPrimary(item)}</span>
            {item.pointName && <span className="text-muted-foreground">· {item.pointName}</span>}
            {item.productCode && (
              <Badge variant="outline">
                {item.productCode}{item.productName ? ` — ${item.productName}` : ""}
              </Badge>
            )}
            <StatusBadge status={item.status} variant={approvalStatusVariant(item.status)} label={t(`thresholdApprovals.statusEnum.${item.status}`)} />
            {isAutoTune && (
              <Badge variant="outline">{t("thresholdApprovals.aiAutoTuneLabel")}</Badge>
            )}
          </div>

          {/* current vs proposed */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">{t("thresholdApprovals.current")}</div>
              <div>LSL: <b>{num(item.currentLsl)}</b></div>
              <div>USL: <b>{num(item.currentUsl)}</b></div>
              <div>{t("thresholdApprovals.nominal")}: <b>{num(item.currentNominal)}</b></div>
            </div>
            <div className="rounded-md border p-3 bg-muted/30">
              <div className="text-xs font-medium text-muted-foreground mb-1">{t("thresholdApprovals.proposed")}</div>
              <div>LSL: <b>{num(item.proposedLsl)}</b></div>
              <div>USL: <b>{num(item.proposedUsl)}</b></div>
              <div>{t("thresholdApprovals.nominal")}: <b>{num(item.proposedNominal)}</b></div>
            </div>
          </div>

          {/* AI basis */}
          {(cpk != null || basis != null) && (
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-1">{t("thresholdApprovals.aiBasis")}</div>
              {cpk != null && <div>Cpk: <b>{typeof cpk === "number" ? cpk.toFixed(3) : String(cpk)}</b></div>}
              {basis != null && <p className="text-muted-foreground whitespace-pre-wrap">{String(basis)}</p>}
            </div>
          )}

          {/* V20 — recent-NG image evidence (thumbnails + persisted VLM description) */}
          {recentNg.length > 0 && (
            <div className="rounded-md border p-3">
              <div className="text-xs font-medium text-muted-foreground mb-2">
                {t("thresholdApprovals.evidenceTitle")}
              </div>
              <div className="flex flex-wrap gap-3">
                {recentNg.slice(0, 3).map((e, i) => (
                  <div key={e.measurementId ?? i} className="w-32 space-y-1">
                    {e.imageUrl ? (
                      <img
                        src={e.imageUrl}
                        alt={t("thresholdApprovals.evidenceImageAlt")}
                        className="h-20 w-32 rounded border object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-20 w-32 items-center justify-center rounded border text-xs text-muted-foreground">
                        {t("thresholdApprovals.evidenceNoImage")}
                      </div>
                    )}
                    {e.aiDescription && (
                      <p className="line-clamp-3 text-[11px] leading-tight text-muted-foreground" title={e.aiDescription}>
                        {e.aiDescription}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {item.comment && (
            <div className="text-xs text-muted-foreground">{t("thresholdApprovals.requesterComment")}: {item.comment}</div>
          )}
          {!isPending && item.decidedComment && (
            <div className="text-xs text-muted-foreground">{t("thresholdApprovals.decisionComment")}: {item.decidedComment}</div>
          )}

          {isPending && isRequester && canDecide && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t("thresholdApprovals.ownRequestHint")}</span>
            </div>
          )}

          {isPending && (
            <>
              <div className="grid gap-1">
                <Label>{t("thresholdApprovals.comment")}</Label>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
              </div>
              {canDecide && !isRequester && (
                <div className="flex items-center gap-2">
                  <Switch checked={apply} onCheckedChange={setApply} id="apply" />
                  <Label htmlFor="apply" className="cursor-pointer">{t("thresholdApprovals.applyToggle")}</Label>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>{t("thresholdApprovals.close")}</Button>
          {isPending && isRequester && (
            <Button variant="secondary" disabled={busy} onClick={() => onWithdraw(comment.trim() || undefined)}>
              <Undo2 className="h-4 w-4 mr-1" /> {t("thresholdApprovals.withdraw")}
            </Button>
          )}
          {/* SoD: never offer approve/reject to the requester (server also blocks). */}
          {isPending && canDecide && !isRequester && (
            <>
              <Button variant="destructive" disabled={busy} onClick={submitReject}>
                <XCircle className="h-4 w-4 mr-1" /> {t("thresholdApprovals.reject")}
              </Button>
              <Button disabled={busy} onClick={() => onApprove(apply, comment.trim() || undefined)}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> {t("thresholdApprovals.approve")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
