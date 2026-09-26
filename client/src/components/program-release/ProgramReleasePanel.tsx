/**
 * W3-C (doc 27 §2 M9) — "Phát hành chương trình" (inspection-program release) panel.
 *
 * Surfaces the release workflow of a product's measurement-point program:
 *   Tạo bản nháp (snapshot point-set) → Gửi duyệt → Duyệt / Từ chối (SoD:
 *   creator ≠ approver, server-enforced) → Phát hành (atomically supersedes the
 *   previously released version) — plus a field-level diff viewer between two
 *   releases (server-side structural diff keyed by point code).
 *
 * Mounted from ProductModels.tsx inside a dialog next to the point editor.
 * RBAC: create/submit gated by settings_products canCreate/canEdit; decisions
 * (approve/reject/release) shown to quality roles only (server re-enforces via
 * qualityProcedure + SoD).
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useAuth } from "@/_core/hooks/useAuth";
import { useCanWrite } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, GitCompare, Loader2, Plus, Rocket, Send, XCircle } from "lucide-react";

const DECIDER_ROLES = ["admin", "supervisor", "quality_inspector"];

type ReleaseStatus = "draft" | "pending_approval" | "approved" | "released" | "superseded" | "rejected";

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const map: Record<ReleaseStatus, { cls: string }> = {
    draft: { cls: "bg-muted text-muted-foreground" },
    pending_approval: { cls: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
    approved: { cls: "bg-blue-500/15 text-blue-700 dark:text-blue-400" },
    released: { cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
    superseded: { cls: "bg-muted text-muted-foreground" },
    rejected: { cls: "bg-red-500/15 text-red-700 dark:text-red-400" },
  };
  const cfg = map[status as ReleaseStatus] ?? map.draft;
  return <Badge variant="outline" className={`border-transparent ${cfg.cls}`}>{t(`programRelease.status.${status}`, status)}</Badge>;
}

export function ProgramReleasePanel({ productModelId }: { productModelId: number }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const { canCreate, canEdit } = useCanWrite("settings_products");
  const canDecide = DECIDER_ROLES.includes(user?.role ?? "");

  const [rejectTarget, setRejectTarget] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [diffA, setDiffA] = useState<string>("");
  const [diffB, setDiffB] = useState<string>("");

  const listQuery = trpc.inspectionProgram.list.useQuery({ productModelId });
  const releases = listQuery.data ?? [];

  const invalidate = () => utils.inspectionProgram.list.invalidate({ productModelId });
  const onError = (err: unknown) => toastTrpcError(err);

  const createDraft = trpc.inspectionProgram.createDraft.useMutation({
    onSuccess: (r) => { toast.success(t("programRelease.draftCreated", { version: r.version })); invalidate(); },
    onError,
  });
  const submit = trpc.inspectionProgram.submit.useMutation({
    onSuccess: () => { toast.success(t("programRelease.submitted")); invalidate(); },
    onError,
  });
  const approve = trpc.inspectionProgram.approve.useMutation({
    onSuccess: () => { toast.success(t("programRelease.approved")); invalidate(); },
    onError,
  });
  const reject = trpc.inspectionProgram.reject.useMutation({
    onSuccess: () => {
      toast.success(t("programRelease.rejected"));
      setRejectTarget(null);
      setRejectReason("");
      invalidate();
    },
    onError,
  });
  const release = trpc.inspectionProgram.release.useMutation({
    onSuccess: () => { toast.success(t("programRelease.released")); invalidate(); },
    onError,
  });

  const compareQuery = trpc.inspectionProgram.compare.useQuery(
    { aId: Number(diffA), bId: Number(diffB) },
    { enabled: diffA !== "" && diffB !== "" && diffA !== diffB },
  );

  const busy =
    createDraft.isPending || submit.isPending || approve.isPending || reject.isPending || release.isPending;

  const versionOptions = useMemo(
    () => releases.map((r) => ({ id: r.id, label: `v${r.version} · ${t(`programRelease.status.${r.status}`, r.status)}` })),
    [releases, t],
  );

  const fmtDate = (v: string | Date | null | undefined) =>
    v ? new Date(v).toLocaleString() : "—";

  return (
    <div className="space-y-4">
      {/* Create draft */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("programRelease.panelDesc")}</p>
        {canCreate && (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => createDraft.mutate({ productModelId })}
            className="gap-1 shrink-0"
          >
            {createDraft.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("programRelease.createDraft")}
          </Button>
        )}
      </div>

      {/* Release list */}
      <ScrollArea className="max-h-[320px] rounded-md border">
        {listQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : releases.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("programRelease.empty")}</div>
        ) : (
          <div className="divide-y">
            {releases.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="w-10 font-mono font-medium">v{r.version}</span>
                <StatusBadge status={r.status} />
                <span className="text-xs text-muted-foreground">
                  {t("programRelease.pointCount", { count: r.pointCount })}
                </span>
                <span className="hidden font-mono text-[10px] text-muted-foreground md:inline" title={r.checksum}>
                  #{r.checksum.slice(0, 8)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.createdByName ?? "—"} · {fmtDate(r.createdAt)}
                </span>
                {r.status === "released" && (
                  <span className="text-xs text-emerald-700 dark:text-emerald-400">
                    {t("programRelease.releasedBy", { name: r.releasedByName ?? "—" })}
                  </span>
                )}
                {r.status === "approved" && r.approvedByName && (
                  <span className="text-xs text-muted-foreground">
                    {t("programRelease.approvedBy", { name: r.approvedByName })}
                  </span>
                )}
                {r.status === "rejected" && r.rejectReason && (
                  <span className="max-w-[280px] truncate text-xs text-red-700 dark:text-red-400" title={r.rejectReason}>
                    {t("programRelease.rejectReasonShort", { reason: r.rejectReason })}
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {r.status === "draft" && canEdit && (
                    <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1"
                      onClick={() => submit.mutate({ releaseId: r.id })}>
                      <Send className="h-3.5 w-3.5" />
                      {t("programRelease.submit")}
                    </Button>
                  )}
                  {r.status === "pending_approval" && canDecide && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1 text-emerald-700 dark:text-emerald-400"
                        onClick={() => approve.mutate({ releaseId: r.id })}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {t("programRelease.approve")}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} className="h-7 gap-1 text-red-700 dark:text-red-400"
                        onClick={() => { setRejectTarget(r.id); setRejectReason(""); }}>
                        <XCircle className="h-3.5 w-3.5" />
                        {t("programRelease.reject")}
                      </Button>
                    </>
                  )}
                  {r.status === "approved" && canDecide && (
                    <Button size="sm" disabled={busy} className="h-7 gap-1"
                      onClick={() => release.mutate({ releaseId: r.id })}>
                      <Rocket className="h-3.5 w-3.5" />
                      {t("programRelease.release")}
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* SoD hint */}
      <p className="text-xs text-muted-foreground">{t("programRelease.sodHint")}</p>

      {/* Diff viewer */}
      {releases.length >= 2 && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <GitCompare className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("programRelease.compareTitle")}</span>
            <Select value={diffA} onValueChange={setDiffA}>
              <SelectTrigger className="h-8 w-44"><SelectValue placeholder={t("programRelease.versionA")} /></SelectTrigger>
              <SelectContent>
                {versionOptions.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">→</span>
            <Select value={diffB} onValueChange={setDiffB}>
              <SelectTrigger className="h-8 w-44"><SelectValue placeholder={t("programRelease.versionB")} /></SelectTrigger>
              <SelectContent>
                {versionOptions.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {compareQuery.isLoading && diffA && diffB && diffA !== diffB && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> {t("common.loading", "Loading…")}
            </div>
          )}
          {compareQuery.data && (
            <div className="space-y-2 text-sm">
              {compareQuery.data.diff.identical ? (
                <p className="text-muted-foreground">{t("diff.identical")}</p>
              ) : (
                <>
                  <div className="flex gap-3 text-xs">
                    <span className="text-emerald-700 dark:text-emerald-400">+{compareQuery.data.diff.added.length} {t("programRelease.diffAdded")}</span>
                    <span className="text-red-700 dark:text-red-400">−{compareQuery.data.diff.removed.length} {t("programRelease.diffRemoved")}</span>
                    <span className="text-amber-700 dark:text-amber-400">~{compareQuery.data.diff.modified.length} {t("programRelease.diffModified")}</span>
                    <span className="text-muted-foreground">={compareQuery.data.diff.unchangedCount} {t("programRelease.diffUnchanged")}</span>
                  </div>
                  <ScrollArea className="max-h-[240px]">
                    <div className="space-y-1">
                      {compareQuery.data.diff.added.map((p) => (
                        <div key={`a-${p.code}`} className="rounded bg-emerald-500/10 px-2 py-1 text-xs">
                          <span className="font-mono font-medium">+ {p.code}</span> {p.name}
                        </div>
                      ))}
                      {compareQuery.data.diff.removed.map((p) => (
                        <div key={`r-${p.code}`} className="rounded bg-red-500/10 px-2 py-1 text-xs">
                          <span className="font-mono font-medium">− {p.code}</span> {p.name}
                        </div>
                      ))}
                      {compareQuery.data.diff.modified.map((p) => (
                        <div key={`m-${p.code}`} className="rounded bg-amber-500/10 px-2 py-1 text-xs">
                          <div className="font-mono font-medium">~ {p.code} <span className="font-sans font-normal">{p.name}</span></div>
                          <div className="mt-0.5 grid gap-0.5 pl-4">
                            {p.changes.map((c) => (
                              <div key={c.field} className="font-mono text-[11px]">
                                {c.field}: <span className="text-red-700 dark:text-red-400">{JSON.stringify(c.before)}</span>
                                {" → "}
                                <span className="text-emerald-700 dark:text-emerald-400">{JSON.stringify(c.after)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reject reason dialog */}
      <Dialog open={rejectTarget != null} onOpenChange={(open) => { if (!open) setRejectTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("programRelease.rejectTitle")}</DialogTitle>
            <DialogDescription>{t("programRelease.rejectDesc")}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={t("programRelease.rejectPlaceholder")}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectTarget(null)}>{t("common.cancel")}</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length === 0 || reject.isPending}
              onClick={() => rejectTarget != null && reject.mutate({ releaseId: rejectTarget, reason: rejectReason.trim() })}
            >
              {reject.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("programRelease.reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ProgramReleasePanel;
