/**
 * Pending Approvals — unified HITL (human-in-the-loop) approval inbox.
 *
 * A product audit found there is no single place to see everything awaiting a
 * human decision — pending items are scattered across domains. This page is a
 * FRONTEND-ONLY AGGREGATOR: it reuses the EXISTING per-domain tRPC queries and
 * mutations (no new backend) and renders one section per source that has work
 * pending, with a top summary strip of the total.
 *
 * Sources aggregated
 *   1. Threshold-change requests — `trpc.thresholdApproval.list({ status:
 *      "requested" })`. INLINE approve/reject reusing `thresholdApproval.approve`
 *      / `thresholdApproval.reject`, gated by the SAME Segregation-of-Duties rule
 *      the ThresholdApprovals page enforces: a reviewer may act only when they
 *      hold `settings_alerts.canEdit` AND are NOT the requester (the server also
 *      enforces this via assertApprovalSoD — this is defence-in-depth, not the
 *      only wall).
 *   2. AI Action Inbox — `trpc.aiInbox.list`. PROPOSAL items carry a HITL confirm
 *      token, so they get an INLINE 1-tap approve reusing the existing
 *      `aiCopilot.confirmAction` mutation (same call the slide-over inbox uses),
 *      plus dismiss (`aiInbox.dismiss`). Advisory INSIGHT/ALERT items have no safe
 *      inline write, so they link out to `/inbox`.
 *
 * SAFETY: this page NEVER introduces a new mutation or fabricates items. Every
 * action here already exists and is server-authorised. Where a source has no safe
 * inline action, it links out to its domain page instead.
 */
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { useActuationReadiness } from "@/hooks/useActuationReadiness";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { AsyncBoundary } from "@/components/AsyncBoundary";
import { LineDiff } from "@/components/diff/LineDiff";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, StatusBadge, type BadgeVariant } from "@/components/patterns";
import {
  ClipboardCheck, SlidersHorizontal, Sparkles, CheckCircle2, XCircle,
  ArrowRight, ShieldAlert, Inbox as InboxIcon, Rocket, GitCompare, FlaskConical,
} from "lucide-react";
import { toast } from "sonner";

const THRESHOLD_PENDING = "requested";

// ── Types (a narrow view of the existing router outputs — no `any`) ────────────

type ThresholdApproval = {
  id: number;
  pointDefId: number;
  requestedBy: number;
  currentLsl: string | null;
  currentUsl: string | null;
  proposedLsl: string | null;
  proposedUsl: string | null;
  status: string;
  createdAt: string | Date | null;
  pointCode?: string | null;
  pointName?: string | null;
  productCode?: string | null;
  productName?: string | null;
};

type InboxItemType = "proposal" | "insight" | "alert";
type InboxAction = "approve" | "dismiss" | "ask" | "view";

type InboxItem = {
  id: string;
  type: InboxItemType;
  severity: "critical" | "warning" | "info";
  title: string;
  body: string;
  actions: InboxAction[];
  machineCode?: string | null;
  createdAt: string;
  actionId?: string;
  token?: string;
  expiresAt?: string;
};

// doc 40 ENG-F2 — Source 3: production deploys awaiting a SECOND person's sign-off.
type DeployApproval = {
  deployment: {
    id: number;
    buildId: number;
    projectId: number;
    stage: string;
    status: string;
    requestedBy: number | null;
    createdAt: string | Date | null;
  };
  project: { id: number; code: string; name: string; kind: string } | null;
  build: { id: number; ok: boolean; status: string } | null;
  artifact: { id: number; version: number; branch: string; contentHash: string | null; content: string | null } | null;
  prevContent: string | null;
  latestSim: { ok: boolean; warnings: string[] } | null;
  requestedByUser: { id: number; username: string | null; name: string | null } | null;
  approvalReason: string | null;
};

// ── Small presentational helpers ───────────────────────────────────────────────

function num(v: string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v;
}

function fmtWhen(v: string | Date | null | undefined): string {
  if (v == null) return "—";
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function severityVariant(s: InboxItem["severity"]): BadgeVariant {
  if (s === "critical") return "destructive";
  if (s === "warning") return "default";
  return "secondary";
}

/** Section shell: title + icon + accessible pending-count badge + body. */
function ApprovalSection({
  icon, title, count, action, children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span aria-hidden className="text-primary">{icon}</span>
        <h2 className="text-lg font-semibold">{title}</h2>
        <Badge
          variant={count > 0 ? "default" : "secondary"}
          aria-label={t("approvalsInbox.pendingCountAria", "{{count}} pending", { count })}
        >
          {count}
        </Badge>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

export default function ApprovalsInbox() {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const { hasPermission } = usePermissions();

  const canViewThresholds = hasPermission("settings_alerts", "canView");
  const canDecideThresholds = hasPermission("settings_alerts", "canEdit");

  const meQ = trpc.auth.me.useQuery();
  const myId = (meQ.data as { id?: number } | undefined)?.id;

  const utils = trpc.useUtils();

  // ── Source 1: threshold-change requests (pending only) ──────────────────────
  const thresholdQ = trpc.thresholdApproval.list.useQuery(
    { status: THRESHOLD_PENDING, limit: 200 },
    { enabled: canViewThresholds },
  );
  const thresholdRows = (thresholdQ.data ?? []) as ThresholdApproval[];

  const isOwn = (r: ThresholdApproval) => myId != null && myId === r.requestedBy;

  const invalidateThreshold = () => { void utils.thresholdApproval.list.invalidate(); };

  const approveM = trpc.thresholdApproval.approve.useMutation({
    onSuccess: () => { toast.success(t("approvalsInbox.threshold.approved", "Threshold approved")); invalidateThreshold(); },
    onError: (e) => toast.error(e.message),
  });
  const rejectM = trpc.thresholdApproval.reject.useMutation({
    onSuccess: () => { toast.success(t("approvalsInbox.threshold.rejected", "Threshold rejected")); setRejectTarget(null); invalidateThreshold(); },
    onError: (e) => toast.error(e.message),
  });
  const [rejectTarget, setRejectTarget] = useState<ThresholdApproval | null>(null);

  // ── Source 2: AI action inbox (proposals + advisory insights/alerts) ────────
  const inboxQ = trpc.aiInbox.list.useQuery({ limit: 50 });
  const inboxItems = (inboxQ.data?.items ?? []) as InboxItem[];

  const confirmM = trpc.aiCopilot.confirmAction.useMutation();
  const dismissM = trpc.aiInbox.dismiss.useMutation();
  const invalidateInbox = () => {
    void utils.aiInbox.list.invalidate();
    void utils.aiInbox.count.invalidate();
  };

  const approveProposal = async (item: InboxItem) => {
    const actionId = item.actionId ?? item.id;
    const token = item.token ?? item.id;
    if (!actionId || !token) return;
    try {
      const res = await confirmM.mutateAsync({
        actionId,
        token,
        lang: (i18n.language as "vi" | "en" | "zh") ?? "vi",
      });
      if (res.ok) toast.success(res.message ?? t("approvalsInbox.ai.approved", "Action approved"));
      else toast.error(res.message ?? t("approvalsInbox.ai.failed", "Could not complete the action"));
    } catch {
      toast.error(t("approvalsInbox.ai.failed", "Could not complete the action"));
    } finally {
      invalidateInbox();
    }
  };

  const dismissItem = async (item: InboxItem) => {
    try {
      await dismissM.mutateAsync({ type: item.type, id: item.id });
      toast.success(t("approvalsInbox.ai.dismissed", "Dismissed"));
    } catch {
      toast.error(t("approvalsInbox.ai.failed", "Could not complete the action"));
    } finally {
      invalidateInbox();
    }
  };

  // ── Source 3: production deploys awaiting sign-off (doc 40 ENG-F2) ───────────
  const canViewDeploys = hasPermission("machine_monitoring", "canView");
  const canApproveDeploys = hasPermission("machine_control", "canCreate");
  const readiness = useActuationReadiness();

  const deployQ = trpc.programming.listDeployApprovals.useQuery(
    undefined,
    { enabled: canViewDeploys },
  );
  const deployRows = (deployQ.data ?? []) as DeployApproval[];
  const isOwnDeploy = (r: DeployApproval) => myId != null && myId === r.deployment.requestedBy;

  const invalidateDeploys = () => { void utils.programming.listDeployApprovals.invalidate(); void utils.programming.listDeployments.invalidate(); };
  const approveDeployM = trpc.programming.approveDeployment.useMutation({
    onSuccess: (row) => {
      // Trung thực theo trạng thái THẬT trả về (đi qua mọi gate cũ).
      switch (row.status) {
        case "verified":
          toast.success(t("approvalsInbox.deploy.verified", "Đã duyệt & deploy (read-back khớp)")); break;
        case "deployed":
          toast.warning(t("approvalsInbox.deploy.deployed", "Đã duyệt & deploy (CHƯA xác minh read-back)")); break;
        case "simulated":
          toast.success(t("approvalsInbox.deploy.simulated", "Đã duyệt (SIMULATED — flag deploy OFF)")); break;
        case "rejected":
        case "failed":
          toast.error(row.error || t("approvalsInbox.deploy.rejected", "Deploy bị từ chối bởi cổng an toàn")); break;
        default:
          toast.success(t("approvalsInbox.deploy.done", "Đã xử lý duyệt"));
      }
      invalidateDeploys();
    },
    onError: (e) => toast.error(e.message),
  });
  const rejectDeployM = trpc.programming.rejectDeployment.useMutation({
    onSuccess: () => { toast.success(t("approvalsInbox.deploy.rejectedOk", "Đã từ chối yêu cầu deploy")); setRejectDeployTarget(null); invalidateDeploys(); },
    onError: (e) => toast.error(e.message),
  });
  const [rejectDeployTarget, setRejectDeployTarget] = useState<DeployApproval | null>(null);
  const [diffOpenId, setDiffOpenId] = useState<number | null>(null);

  // ── Summary ─────────────────────────────────────────────────────────────────
  const thresholdCount = canViewThresholds ? thresholdRows.length : 0;
  const inboxCount = inboxItems.length;
  const deployCount = canViewDeploys ? deployRows.length : 0;
  const totalPending = thresholdCount + inboxCount + deployCount;

  const anyLoading =
    (canViewThresholds && thresholdQ.isLoading) || inboxQ.isLoading || (canViewDeploys && deployQ.isLoading);
  const globalEmpty = !anyLoading && totalPending === 0;

  const aiBusy = confirmM.isPending || dismissM.isPending;
  const deployBusy = approveDeployM.isPending || rejectDeployM.isPending;

  const summaryTiles = useMemo(() => ([
    { key: "total", label: t("approvalsInbox.summary.total", "Total pending"), value: totalPending, emphasis: true },
    { key: "threshold", label: t("approvalsInbox.threshold.title", "Threshold changes"), value: thresholdCount, emphasis: false },
    { key: "ai", label: t("approvalsInbox.ai.title", "AI action inbox"), value: inboxCount, emphasis: false },
    { key: "deploy", label: t("approvalsInbox.deploy.title", "Deploy chờ duyệt"), value: deployCount, emphasis: false },
  ]), [t, totalPending, thresholdCount, inboxCount, deployCount]);

  return (
    <DashboardLayout
      title={t("approvalsInbox.title", "Pending Approvals")}
      navItems={navItems}
      currentPath="/approvals-inbox"
    >
      <div className="p-6 space-y-6">
        <PageHeader
          icon={<ClipboardCheck className="h-6 w-6 text-primary" />}
          title={t("approvalsInbox.title", "Pending Approvals")}
          description={t("approvalsInbox.subtitle", "Everything across the platform that is waiting for a human decision, in one place.")}
        />

        {/* Summary strip */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summaryTiles.map((tile) => (
            <Card key={tile.key} className={tile.emphasis ? "border-primary/40" : undefined}>
              <CardContent className="py-4">
                <div className="text-sm text-muted-foreground">{tile.label}</div>
                <div className={tile.emphasis ? "text-3xl font-bold text-primary" : "text-3xl font-bold"}>
                  {tile.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Global empty state */}
        {globalEmpty && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-14 text-center text-muted-foreground">
              <InboxIcon className="h-8 w-8" aria-hidden />
              <div className="text-base font-medium text-foreground">
                {t("approvalsInbox.globalEmpty.title", "Nothing awaiting approval")}
              </div>
              <div className="text-sm">
                {t("approvalsInbox.globalEmpty.body", "You're all caught up. New items appear here the moment they need a decision.")}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Section 1: Threshold changes ──────────────────────────────────── */}
        {canViewThresholds && (
          <ApprovalSection
            icon={<SlidersHorizontal className="h-5 w-5" />}
            title={t("approvalsInbox.threshold.title", "Threshold changes")}
            count={thresholdCount}
            action={
              <Button variant="ghost" size="sm" onClick={() => setLocation("/threshold-approvals")}>
                {t("approvalsInbox.reviewIn", "Open full queue")}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            }
          >
            <Card>
              <CardContent className="p-0">
                <AsyncBoundary
                  isLoading={thresholdQ.isLoading}
                  isError={thresholdQ.isError}
                  error={thresholdQ.error}
                  onRetry={thresholdQ.refetch}
                  preset="table"
                  isEmpty={thresholdRows.length === 0}
                  emptyState={
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      {t("approvalsInbox.threshold.empty", "Nothing pending")}
                    </div>
                  }
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("approvalsInbox.threshold.col.point", "Measurement point")}</TableHead>
                        <TableHead>{t("approvalsInbox.threshold.col.change", "Proposed change")}</TableHead>
                        <TableHead>{t("approvalsInbox.threshold.col.requestedBy", "Requested by")}</TableHead>
                        <TableHead>{t("approvalsInbox.threshold.col.when", "When")}</TableHead>
                        <TableHead className="text-right">{t("approvalsInbox.col.actions", "Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {thresholdRows.map((r) => {
                        const own = isOwn(r);
                        const canAct = canDecideThresholds && !own;
                        return (
                          <TableRow key={r.id}>
                            <TableCell>
                              <div className="font-medium">{r.pointCode?.trim() || `MP-${r.pointDefId}`}</div>
                              {r.productCode && (
                                <div className="text-xs text-muted-foreground">{r.productCode}</div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs">
                              <span className="text-muted-foreground">[{num(r.currentLsl)}, {num(r.currentUsl)}]</span>
                              <span aria-hidden> → </span>
                              <span className="font-medium">[{num(r.proposedLsl)}, {num(r.proposedUsl)}]</span>
                            </TableCell>
                            <TableCell className="text-sm">
                              {t("approvalsInbox.userRef", "User #{{id}}", { id: r.requestedBy })}
                              {own && (
                                <Badge variant="outline" className="ml-2">{t("approvalsInbox.you", "You")}</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">{fmtWhen(r.createdAt)}</TableCell>
                            <TableCell className="text-right">
                              {canAct ? (
                                <div className="flex justify-end gap-1">
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    disabled={rejectM.isPending}
                                    onClick={() => setRejectTarget(r)}
                                    aria-label={t("approvalsInbox.threshold.rejectAria", "Reject threshold change #{{id}}", { id: r.id })}
                                  >
                                    <XCircle className="mr-1 h-4 w-4" aria-hidden />
                                    {t("approvalsInbox.reject", "Reject")}
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={approveM.isPending}
                                    onClick={() => approveM.mutate({ id: r.id, apply: true })}
                                    aria-label={t("approvalsInbox.threshold.approveAria", "Approve threshold change #{{id}}", { id: r.id })}
                                  >
                                    <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                                    {t("approvalsInbox.approve", "Approve")}
                                  </Button>
                                </div>
                              ) : own ? (
                                <span
                                  className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                                  title={t("approvalsInbox.threshold.ownHint", "Segregation of duties: you cannot approve your own request")}
                                >
                                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                                  {t("approvalsInbox.threshold.ownRequest", "Your request")}
                                </span>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setLocation("/threshold-approvals")}
                                >
                                  {t("approvalsInbox.review", "Review")}
                                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </AsyncBoundary>
              </CardContent>
            </Card>
          </ApprovalSection>
        )}

        {/* ── Section 2: AI action inbox ────────────────────────────────────── */}
        <ApprovalSection
          icon={<Sparkles className="h-5 w-5" />}
          title={t("approvalsInbox.ai.title", "AI action inbox")}
          count={inboxCount}
          action={
            <Button variant="ghost" size="sm" onClick={() => setLocation("/inbox")}>
              {t("approvalsInbox.ai.openInbox", "Open inbox")}
              <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
            </Button>
          }
        >
          <Card>
            <CardContent className="p-3">
              <AsyncBoundary
                isLoading={inboxQ.isLoading}
                isError={inboxQ.isError}
                error={inboxQ.error}
                onRetry={inboxQ.refetch}
                preset="list"
                isEmpty={inboxItems.length === 0}
                emptyState={
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    {t("approvalsInbox.ai.empty", "Nothing pending")}
                  </div>
                }
              >
                <ul className="space-y-2">
                  {inboxItems.map((item) => {
                    const isProposal = item.type === "proposal" && item.actions.includes("approve");
                    return (
                      <li
                        key={`${item.type}:${item.id}`}
                        className="flex flex-wrap items-start gap-3 rounded-md border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge
                              status={item.severity}
                              variant={severityVariant(item.severity)}
                              label={t(`approvalsInbox.ai.severity.${item.severity}`, item.severity)}
                            />
                            <Badge variant="outline">
                              {t(`approvalsInbox.ai.type.${item.type}`, item.type)}
                            </Badge>
                            {item.machineCode && (
                              <span className="text-xs text-muted-foreground">{item.machineCode}</span>
                            )}
                            <span className="text-xs text-muted-foreground">{fmtWhen(item.createdAt)}</span>
                          </div>
                          <div className="mt-1 font-medium">{item.title}</div>
                          {item.body && item.body !== item.title && (
                            <div className="text-sm text-muted-foreground">{item.body}</div>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {isProposal ? (
                            <>
                              <Button
                                size="sm"
                                disabled={aiBusy}
                                onClick={() => void approveProposal(item)}
                                aria-label={t("approvalsInbox.ai.approveAria", "Approve: {{title}}", { title: item.title })}
                              >
                                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                                {t("approvalsInbox.approve", "Approve")}
                              </Button>
                              {item.actions.includes("dismiss") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={aiBusy}
                                  onClick={() => void dismissItem(item)}
                                  aria-label={t("approvalsInbox.ai.dismissAria", "Dismiss: {{title}}", { title: item.title })}
                                >
                                  {t("approvalsInbox.ai.dismiss", "Dismiss")}
                                </Button>
                              )}
                            </>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setLocation("/inbox")}
                              aria-label={t("approvalsInbox.ai.reviewAria", "Review: {{title}}", { title: item.title })}
                            >
                              {t("approvalsInbox.review", "Review")}
                              <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                            </Button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </AsyncBoundary>
            </CardContent>
          </Card>
        </ApprovalSection>

        {/* ── Section 3: Deploy chờ duyệt (doc 40 ENG-F2) ──────────────────────── */}
        {canViewDeploys && (
          <ApprovalSection
            icon={<Rocket className="h-5 w-5" />}
            title={t("approvalsInbox.deploy.title", "Deploy chờ duyệt")}
            count={deployCount}
            action={
              <Button variant="ghost" size="sm" onClick={() => setLocation("/engineering-workspace")}>
                {t("approvalsInbox.deploy.openWorkspace", "Mở xưởng lập trình")}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
            }
          >
            {/* Pre-flight: approver cần role-floor + 2FA để KÝ (actuation). Cảnh báo TRƯỚC. */}
            {deployRows.length > 0 && canApproveDeploys && readiness.blockers.length > 0 && (
              <div className="mb-2 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  {t("approvalsInbox.deploy.readiness", "Bạn chưa đủ điều kiện để KÝ duyệt deploy:")}{" "}
                  {readiness.blockers.map((bl) => t(`actuationReadiness.${bl.code}`, bl.defaultMessage)).join(" ")}
                </span>
              </div>
            )}
            <Card>
              <CardContent className="p-0">
                <AsyncBoundary
                  isLoading={deployQ.isLoading}
                  isError={deployQ.isError}
                  error={deployQ.error}
                  onRetry={deployQ.refetch}
                  preset="table"
                  isEmpty={deployRows.length === 0}
                  emptyState={
                    <div className="py-10 text-center text-sm text-muted-foreground">
                      {t("approvalsInbox.deploy.empty", "Không có yêu cầu deploy nào chờ duyệt")}
                    </div>
                  }
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("approvalsInbox.deploy.col.project", "Dự án / phiên bản")}</TableHead>
                        <TableHead>{t("approvalsInbox.deploy.col.checks", "Sim & hash dự kiến")}</TableHead>
                        <TableHead>{t("approvalsInbox.deploy.col.requestedBy", "Người yêu cầu")}</TableHead>
                        <TableHead>{t("approvalsInbox.threshold.col.when", "When")}</TableHead>
                        <TableHead className="text-right">{t("approvalsInbox.col.actions", "Actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deployRows.map((r) => {
                        const own = isOwnDeploy(r);
                        const canAct = canApproveDeploys && !own && readiness.ready;
                        const simOk = r.latestSim?.ok === true;
                        const hasDiff = r.artifact?.content != null && r.prevContent != null;
                        return (
                          <Fragment key={r.deployment.id}>
                            <TableRow>
                              <TableCell>
                                <div className="font-medium">{r.project?.code?.trim() || `#${r.deployment.projectId}`}</div>
                                <div className="text-xs text-muted-foreground">
                                  {r.artifact ? `v${r.artifact.version} · ${r.artifact.branch}` : `build #${r.deployment.buildId}`}
                                  {r.project?.kind && <> · {r.project.kind}</>}
                                </div>
                                {r.approvalReason && (
                                  <div className="mt-0.5 text-xs italic text-muted-foreground">“{r.approvalReason}”</div>
                                )}
                              </TableCell>
                              <TableCell className="text-xs">
                                <div className="flex items-center gap-1">
                                  <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                  {r.latestSim ? (
                                    <Badge variant={simOk ? "default" : "destructive"}>
                                      {simOk
                                        ? t("approvalsInbox.deploy.simPass", "Sim ĐẠT")
                                        : t("approvalsInbox.deploy.simFail", "Sim KHÔNG ĐẠT")}
                                    </Badge>
                                  ) : (
                                    <Badge variant="secondary">{t("approvalsInbox.deploy.simNone", "Chưa mô phỏng")}</Badge>
                                  )}
                                </div>
                                <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                                  {t("approvalsInbox.deploy.hash", "hash")}: {r.artifact?.contentHash?.slice(0, 16) ?? "—"}…
                                </div>
                                {hasDiff && (
                                  <Button
                                    variant="ghost" size="sm" className="mt-1 h-6 px-1 text-[11px]"
                                    onClick={() => setDiffOpenId(diffOpenId === r.deployment.id ? null : r.deployment.id)}
                                  >
                                    <GitCompare className="mr-1 h-3 w-3" aria-hidden />
                                    {diffOpenId === r.deployment.id
                                      ? t("approvalsInbox.deploy.hideDiff", "Ẩn diff")
                                      : t("approvalsInbox.deploy.showDiff", "Xem diff vs bản đã deploy")}
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="text-sm">
                                {r.requestedByUser?.name || r.requestedByUser?.username ||
                                  t("approvalsInbox.userRef", "User #{{id}}", { id: r.deployment.requestedBy ?? 0 })}
                                {own && (
                                  <Badge variant="outline" className="ml-2">{t("approvalsInbox.you", "You")}</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">{fmtWhen(r.deployment.createdAt)}</TableCell>
                              <TableCell className="text-right">
                                {own ? (
                                  <div className="flex flex-col items-end gap-1">
                                    <span
                                      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
                                      title={t("approvalsInbox.deploy.ownHint", "Phân tách nhiệm vụ: bạn không thể tự duyệt yêu cầu của mình")}
                                    >
                                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                                      {t("approvalsInbox.threshold.ownRequest", "Your request")}
                                    </span>
                                    {canApproveDeploys && (
                                      <Button
                                        size="sm" variant="ghost" className="h-7"
                                        disabled={deployBusy}
                                        onClick={() => setRejectDeployTarget(r)}
                                      >
                                        {t("approvalsInbox.deploy.withdraw", "Rút yêu cầu")}
                                      </Button>
                                    )}
                                  </div>
                                ) : (
                                  <div className="flex justify-end gap-1">
                                    <Button
                                      size="sm" variant="destructive"
                                      disabled={!canApproveDeploys || deployBusy}
                                      onClick={() => setRejectDeployTarget(r)}
                                      aria-label={t("approvalsInbox.deploy.rejectAria", "Từ chối deploy #{{id}}", { id: r.deployment.id })}
                                    >
                                      <XCircle className="mr-1 h-4 w-4" aria-hidden />
                                      {t("approvalsInbox.reject", "Reject")}
                                    </Button>
                                    <Button
                                      size="sm"
                                      disabled={!canAct || deployBusy}
                                      title={!canApproveDeploys
                                        ? t("common.gate.needPerm", "Requires {{perm}} permission", { perm: "machine_control" })
                                        : !readiness.ready
                                          ? readiness.blockers.map((bl) => t(`actuationReadiness.${bl.code}`, bl.defaultMessage)).join(" ")
                                          : undefined}
                                      onClick={() => approveDeployM.mutate({ deploymentId: r.deployment.id })}
                                      aria-label={t("approvalsInbox.deploy.approveAria", "Duyệt & deploy #{{id}}", { id: r.deployment.id })}
                                    >
                                      <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden />
                                      {t("approvalsInbox.deploy.approve", "Duyệt & deploy")}
                                    </Button>
                                  </div>
                                )}
                              </TableCell>
                            </TableRow>
                            {diffOpenId === r.deployment.id && hasDiff && (
                              <TableRow>
                                <TableCell colSpan={5} className="bg-muted/20">
                                  <LineDiff left={r.prevContent ?? ""} right={r.artifact?.content ?? ""} maxHeightClass="max-h-[280px]" />
                                </TableCell>
                              </TableRow>
                            )}
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </AsyncBoundary>
              </CardContent>
            </Card>
          </ApprovalSection>
        )}
      </div>

      {/* Deploy reject/withdraw reason */}
      <Dialog open={rejectDeployTarget != null} onOpenChange={(o) => { if (!o) setRejectDeployTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rejectDeployTarget && isOwnDeploy(rejectDeployTarget)
                ? t("approvalsInbox.deploy.withdrawTitle", "Rút yêu cầu deploy #{{id}}", { id: rejectDeployTarget?.deployment.id ?? 0 })
                : t("approvalsInbox.deploy.rejectTitle", "Từ chối yêu cầu deploy #{{id}}", { id: rejectDeployTarget?.deployment.id ?? 0 })}
            </DialogTitle>
          </DialogHeader>
          {rejectDeployTarget && (
            <RejectReasonForm
              busy={rejectDeployM.isPending}
              onCancel={() => setRejectDeployTarget(null)}
              onSubmit={(reason) => rejectDeployM.mutate({ deploymentId: rejectDeployTarget.deployment.id, reason })}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Threshold reject reason — mirrors the domain page's non-empty-comment rule */}
      <Dialog open={rejectTarget != null} onOpenChange={(o) => { if (!o) setRejectTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("approvalsInbox.threshold.rejectTitle", "Reject threshold change #{{id}}", { id: rejectTarget?.id ?? 0 })}
            </DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <RejectReasonForm
              busy={rejectM.isPending}
              onCancel={() => setRejectTarget(null)}
              onSubmit={(comment) => rejectM.mutate({ id: rejectTarget.id, comment })}
            />
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}

/** Reject reason capture — the server requires a comment; enforce non-empty here
 *  exactly as the ThresholdApprovals review dialog does. */
function RejectReasonForm({
  busy, onCancel, onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (comment: string) => void;
}) {
  const { t } = useTranslation();
  const [comment, setComment] = useState("");
  const submit = () => {
    if (comment.trim().length === 0) {
      toast.error(t("approvalsInbox.threshold.commentRequired", "A reason is required to reject"));
      return;
    }
    onSubmit(comment.trim());
  };
  return (
    <>
      <div className="grid gap-1 py-2">
        <Label htmlFor="reject-reason">{t("approvalsInbox.threshold.reason", "Reason")}</Label>
        <Textarea
          id="reject-reason"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t("approvalsInbox.threshold.reasonPlaceholder", "Explain why this change is rejected…")}
        />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>{t("approvalsInbox.cancel", "Cancel")}</Button>
        <Button variant="destructive" disabled={busy} onClick={submit}>
          <XCircle className="mr-1 h-4 w-4" aria-hidden />
          {t("approvalsInbox.reject", "Reject")}
        </Button>
      </DialogFooter>
    </>
  );
}
