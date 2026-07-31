/**
 * W8-B (doc 29 §3 — doc 27 M14) — Operator/Badge master admin page.
 *
 * Maps the free badge codes machines send (product_inspections.operatorId) to
 * canonical users.id with validity windows: issue / re-issue (same code, new
 * holder — the old row keeps resolving historical timestamps) / revoke, plus
 * the "unassigned badges" queue (auto_seen codes harvested from ingest that no
 * one has mapped yet).
 *
 * SAFETY: pure master-data CRUD — never touches the ingest path (ingest stamps
 * operatorUserId fail-open; unknown badges are queued here, never rejected).
 * RBAC: module 'masterdata' (server re-enforces every mutation).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import { ViewOnlyBadge, useCanWrite } from "@/components/PermissionGate";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer, EmptyState } from "@/components/patterns";
import { DataTable } from "@/components/DataTable";
import { AlertTriangle, BadgeCheck, IdCard, Loader2, Plus, QrCode, UserCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { format } from "date-fns";

type BadgeRow = {
  id: number;
  badgeCode: string;
  userId: number | null;
  userName: string | null;
  displayName: string | null;
  source: string;
  validFrom: Date | string | null;
  validTo: Date | string | null;
  isActive: boolean;
  notes: string | null;
};

function fmtDate(v: Date | string | null): string {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : format(d, "dd/MM/yyyy HH:mm");
}

/** Thời điểm (ms) để sắp xếp cột ngày; null cho giá trị rỗng/không hợp lệ (sort cuối). */
function toTime(v: Date | string | null): number | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export default function OperatorBadges() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("masterdata", "canView");
  const { canCreate, canEdit } = useCanWrite("masterdata");
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<"all" | "unassigned">("all");
  const [search, setSearch] = useState("");
  const listQuery = trpc.operatorBadge.list.useQuery(
    { unassignedOnly: tab === "unassigned", search: search || undefined },
    { enabled: canView },
  );
  const unassignedCount = trpc.operatorBadge.unassignedCount.useQuery(undefined, { enabled: canView });
  // user.list is admin-only — fail quietly for non-admin masterdata editors
  // (they can still see/revoke badges; user mapping is an admin task).
  const usersQuery = trpc.user.list.useQuery(undefined, {
    enabled: canView && (canCreate || canEdit),
    retry: false,
  });
  const users = (usersQuery.data ?? []) as Array<{ id: number; name: string | null; username?: string | null }>;

  const invalidate = () => {
    utils.operatorBadge.list.invalidate();
    utils.operatorBadge.unassignedCount.invalidate();
  };
  const onError = (err: { message: string }) => toastTrpcError(err);

  const issueMutation = trpc.operatorBadge.issue.useMutation({
    onSuccess: () => { toast.success(t("operatorBadge.issued")); setIssueOpen(false); invalidate(); },
    onError,
  });
  const updateMutation = trpc.operatorBadge.update.useMutation({
    onSuccess: () => { toast.success(t("operatorBadge.updated")); setAssignTarget(null); invalidate(); },
    onError,
  });
  const revokeMutation = trpc.operatorBadge.revoke.useMutation({
    onSuccess: () => { toast.success(t("operatorBadge.revoked")); invalidate(); },
    onError,
  });

  // Issue / re-issue dialog
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueForm, setIssueForm] = useState({ badgeCode: "", userId: "", displayName: "" });
  // Assign-user dialog (for auto_seen rows)
  const [assignTarget, setAssignTarget] = useState<BadgeRow | null>(null);
  const [assignUserId, setAssignUserId] = useState("");
  // QR badge dialog — dùng dep `qrcode` sẵn có (dynamic import, ngoài main bundle).
  const [qrTarget, setQrTarget] = useState<BadgeRow | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [qrLoading, setQrLoading] = useState(false);

  const openQr = async (b: BadgeRow) => {
    setQrTarget(b);
    setQrDataUrl("");
    setQrLoading(true);
    try {
      const QRCode = await import("qrcode");
      const dataUrl = await QRCode.toDataURL(b.badgeCode, { width: 240, margin: 1 });
      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error("QR generation failed", err);
      toast.error(t("operatorBadge.qrError", "Không tạo được mã QR"));
      setQrTarget(null);
    } finally {
      setQrLoading(false);
    }
  };

  if (!canView) {
    return (
      <DashboardLayout title={t("operatorBadge.title")} navItems={navItems} currentPath="/operator-badges">
        <PageContainer>
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground">
              <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
              {t("masterData.noPermission")}
            </CardContent>
          </Card>
        </PageContainer>
      </DashboardLayout>
    );
  }

  const badges = (listQuery.data?.badges ?? []) as BadgeRow[];

  return (
    <DashboardLayout title={t("operatorBadge.title")} navItems={navItems} currentPath="/operator-badges">
      <PageContainer>
        <PageHeader
          icon={<IdCard className="h-6 w-6" />}
          title={t("operatorBadge.title")}
          description={t("operatorBadge.subtitle")}
          badge={<ViewOnlyBadge module="masterdata" />}
          actions={
            canCreate ? (
              <Button size="sm" className="gap-1" onClick={() => { setIssueForm({ badgeCode: "", userId: "", displayName: "" }); setIssueOpen(true); }}>
                <Plus className="h-4 w-4" />
                {t("operatorBadge.issueButton")}
              </Button>
            ) : undefined
          }
        />

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unassigned")}>
            <TabsList>
              <TabsTrigger value="all">{t("operatorBadge.tabAll")}</TabsTrigger>
              <TabsTrigger value="unassigned">
                {t("operatorBadge.tabUnassigned")}
                {(unassignedCount.data?.count ?? 0) > 0 && (
                  <Badge variant="secondary" className="ml-1 text-[10px]">{unassignedCount.data?.count}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            className="max-w-xs"
            placeholder={t("operatorBadge.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Card>
          <CardContent className="p-3">
            <DataTable<BadgeRow>
              data={badges}
              getRowId={(b) => b.id}
              loading={listQuery.isLoading}
              initialSort={{ columnId: "badgeCode", dir: "asc" }}
              emptyState={
                <EmptyState
                  variant={search ? "no-results" : "no-data"}
                  title={
                    tab === "unassigned"
                      ? t("operatorBadge.emptyUnassignedTitle", "Không có badge chờ gán")
                      : t("operatorBadge.emptyTitle", "Chưa có badge")
                  }
                  description={
                    search
                      ? t("operatorBadge.emptySearch", "Không có badge nào khớp từ khoá tìm kiếm.")
                      : t("operatorBadge.empty")
                  }
                />
              }
              columns={[
                { id: "badgeCode", header: t("operatorBadge.badgeCode"), sortValue: (b) => b.badgeCode, cell: (b) => <span className="font-mono">{b.badgeCode}</span> },
                {
                  id: "user",
                  header: t("operatorBadge.user"),
                  sortValue: (b) => b.userName ?? b.displayName ?? "",
                  cell: (b) => (b.userId ? (
                    <span className="flex items-center gap-1">
                      <BadgeCheck className="h-3 w-3 text-success" />
                      {b.userName ?? `#${b.userId}`}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{b.displayName || t("operatorBadge.unassigned")}</span>
                  )),
                },
                {
                  id: "source",
                  header: t("operatorBadge.source"),
                  sortValue: (b) => b.source,
                  cell: (b) => (
                    <Badge variant={b.source === "auto_seen" ? "secondary" : "outline"} className="text-[10px]">
                      {t(`operatorBadge.sources.${b.source}`, b.source)}
                    </Badge>
                  ),
                },
                { id: "validFrom", header: t("operatorBadge.validFrom"), sortValue: (b) => toTime(b.validFrom), cell: (b) => <span className="text-xs">{fmtDate(b.validFrom)}</span> },
                { id: "validTo", header: t("operatorBadge.validTo"), sortValue: (b) => toTime(b.validTo), cell: (b) => <span className="text-xs">{fmtDate(b.validTo)}</span> },
                {
                  id: "status",
                  header: t("operatorBadge.status"),
                  sortValue: (b) => (b.isActive ? 1 : 0),
                  cell: (b) => (b.isActive ? (
                    <Badge className="bg-success/20 text-success border-success/30 text-[10px]">{t("operatorBadge.active")}</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">{t("operatorBadge.revokedStatus")}</Badge>
                  )),
                },
                {
                  id: "actions",
                  header: t("common.actions"),
                  align: "right",
                  cell: (b) => (
                    <div className="flex justify-end gap-1 whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="gap-1" title={t("operatorBadge.showQr", "Xem mã QR")}
                        onClick={() => openQr(b)}>
                        <QrCode className="h-3 w-3" />
                      </Button>
                      {canEdit && (
                        <>
                          {!b.userId && (
                            <Button size="sm" variant="outline" className="gap-1"
                              onClick={() => { setAssignTarget(b); setAssignUserId(""); }}>
                              <UserCheck className="h-3 w-3" />
                              {t("operatorBadge.assign")}
                            </Button>
                          )}
                          {b.isActive && (
                            <Button size="sm" variant="outline" className="gap-1 text-destructive"
                              disabled={revokeMutation.isPending}
                              onClick={() => revokeMutation.mutate({ id: b.id })}>
                              <XCircle className="h-3 w-3" />
                              {t("operatorBadge.revoke")}
                            </Button>
                          )}
                          {!b.isActive && canCreate && (
                            <Button size="sm" variant="outline" className="gap-1"
                              onClick={() => { setIssueForm({ badgeCode: b.badgeCode, userId: "", displayName: "" }); setIssueOpen(true); }}>
                              <Plus className="h-3 w-3" />
                              {t("operatorBadge.reissue")}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>

        {/* Issue / re-issue dialog */}
        <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("operatorBadge.issueTitle")}</DialogTitle>
              <DialogDescription>{t("operatorBadge.issueDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label>{t("operatorBadge.badgeCode")}</Label>
                <Input value={issueForm.badgeCode} maxLength={50}
                  onChange={(e) => setIssueForm({ ...issueForm, badgeCode: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label>{t("operatorBadge.user")}</Label>
                <Select value={issueForm.userId} onValueChange={(v) => setIssueForm({ ...issueForm, userId: v })}>
                  <SelectTrigger><SelectValue placeholder={t("operatorBadge.selectUser")} /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name || u.username || `#${u.id}`}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("operatorBadge.displayName")}</Label>
                <Input value={issueForm.displayName} maxLength={255}
                  onChange={(e) => setIssueForm({ ...issueForm, displayName: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIssueOpen(false)}>{t("common.cancel")}</Button>
              <Button
                disabled={issueMutation.isPending || !issueForm.badgeCode.trim()}
                onClick={() =>
                  issueMutation.mutate({
                    badgeCode: issueForm.badgeCode.trim(),
                    userId: issueForm.userId ? Number(issueForm.userId) : undefined,
                    displayName: issueForm.displayName.trim() || undefined,
                  })
                }
                className="gap-1"
              >
                {issueMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("operatorBadge.issueButton")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Assign-user dialog (auto_seen queue) */}
        <Dialog open={assignTarget != null} onOpenChange={(open) => { if (!open) setAssignTarget(null); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("operatorBadge.assignTitle", { code: assignTarget?.badgeCode ?? "" })}</DialogTitle>
              <DialogDescription>{t("operatorBadge.assignDesc")}</DialogDescription>
            </DialogHeader>
            <div className="space-y-1 py-2">
              <Label>{t("operatorBadge.user")}</Label>
              <Select value={assignUserId} onValueChange={setAssignUserId}>
                <SelectTrigger><SelectValue placeholder={t("operatorBadge.selectUser")} /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.name || u.username || `#${u.id}`}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignTarget(null)}>{t("common.cancel")}</Button>
              <Button
                disabled={updateMutation.isPending || !assignUserId}
                onClick={() => assignTarget && updateMutation.mutate({ id: assignTarget.id, userId: Number(assignUserId) })}
                className="gap-1"
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("operatorBadge.assign")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* QR badge dialog */}
        <Dialog open={qrTarget != null} onOpenChange={(open) => { if (!open) setQrTarget(null); }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>{t("operatorBadge.qrTitle", "Mã QR badge")}</DialogTitle>
              <DialogDescription className="font-mono">{qrTarget?.badgeCode}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center justify-center py-4">
              {qrLoading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt={qrTarget?.badgeCode ?? "QR"} className="h-60 w-60 rounded-md border bg-white p-2" />
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setQrTarget(null)}>{t("common.close", "Đóng")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageContainer>
    </DashboardLayout>
  );
}
