/**
 * Anomaly Memory Banks — admin management surface.
 *
 * The PatchCore-style anomaly banks (ai_anomaly_memory_bank + ai_anomaly_profiles)
 * were built only via cron / admin procedures with no UI. This page lists the
 * existing profiles/scopes (per machine / per product) with their stats — bank
 * size, threshold, k, source, and the BOOTSTRAP / low-confidence flag — and
 * exposes the admin ops: rebuild a scope from stored vectors (buildBankFromDb),
 * delete a scope (deleteBank), and a global "build from stored vectors" trigger.
 *
 * HONEST about confidence: a bootstrap/low-sample bank is badged so the operator
 * never mistakes a thin bank for a trustworthy one.
 *
 * RBAC: admin-only ops (the underlying procedures are adminProcedure). The page
 * gates view on `analytics_ai_performance`; the build/delete buttons require admin.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer, EmptyState } from "@/components/patterns";
import { ProductModelSelect, MachineSelect } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Database, AlertTriangle, RefreshCw, Trash2, Hammer } from "lucide-react";
import { toast } from "sonner";

type Profile = {
  id: number;
  productModelId: number | null;
  machineId: number | null;
  modelCode: string;
  threshold: string | number | null;
  k: number | null;
  bankSize: number | null;
  source: string | null;
  degraded: boolean | null;
  builtAt: string | Date | null;
  distStats: Record<string, any> | null;
};

// Map a profile's modelCode back to the `source` enum deleteBank needs.
function sourceOf(modelCode: string): "onnx" | "text-of-image" | "heuristic" {
  if (modelCode.startsWith("anomaly:onnx")) return "onnx";
  if (modelCode.startsWith("anomaly:text-of-image")) return "text-of-image";
  return "heuristic";
}
function modelIdOf(modelCode: string): number | null {
  const m = modelCode.match(/^anomaly:onnx:(\d+)$/);
  return m ? Number(m[1]) : null;
}
function isBootstrap(p: Profile): boolean {
  return !!(p.distStats && (p.distStats as any).bootstrap) || !!p.degraded;
}
function scopeLabel(p: Profile, t: (k: string) => string): string {
  if (p.machineId != null) return `${t("anomalyBanks.machine")} #${p.machineId}`;
  if (p.productModelId != null) return `${t("anomalyBanks.product")} #${p.productModelId}`;
  return t("anomalyBanks.global");
}

export default function AnomalyBankPage() {
  const { t } = useTranslation();
  const { hasPermission, isAdmin } = usePermissions();
  const canView = hasPermission("analytics_ai_performance", "canView");
  const admin = isAdmin === true;

  const utils = trpc.useUtils();
  const [productModelId, setProductModelId] = useState<number | null>(null);
  const [machineId, setMachineId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);

  const statsQ = trpc.aiAnomaly.stats.useQuery(
    {
      productModelId: productModelId ?? null,
      machineId: machineId ?? null,
    },
    { enabled: canView },
  );

  const invalidate = () => { void utils.aiAnomaly.stats.invalidate(); };

  const rebuildM = trpc.aiAnomaly.buildBankFromDb.useMutation({
    onSuccess: (res: any) => {
      const flag = res?.bootstrap || res?.degraded ? ` (${t("anomalyBanks.bootstrapNote")})` : "";
      toast.success(t("anomalyBanks.rebuilt") + flag);
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const deleteM = trpc.aiAnomaly.deleteBank.useMutation({
    onSuccess: () => { toast.success(t("anomalyBanks.deleted")); setConfirmDelete(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });

  const profiles = ((statsQ.data as any)?.profiles ?? []) as Profile[];
  const totalVectors = (statsQ.data as any)?.totalVectors ?? 0;

  const rebuildScope = (p: Profile) => {
    rebuildM.mutate({
      machineId: p.machineId ?? null,
      productModelId: p.productModelId ?? null,
      modelCode: p.modelCode,
      okOnly: true,
    });
  };

  const buildGlobal = () => {
    rebuildM.mutate({
      machineId: machineId ?? null,
      productModelId: productModelId ?? null,
      okOnly: true,
    });
  };

  if (!canView) {
    return (
      <DashboardLayout title={t("anomalyBanks.title")} navItems={navItems} currentPath="/anomaly-banks">
        <PageContainer>
          <Card>
            <EmptyState
              variant="error"
              icon={AlertTriangle}
              title={t("anomalyBanks.noPermission")}
              description={t("common.noPermissionDesc", "You do not have permission to view this page.")}
            />
          </Card>
        </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("anomalyBanks.title")} navItems={navItems} currentPath="/anomaly-banks">
      <PageContainer>
        <PageHeader
          icon={<Database className="h-6 w-6" />}
          title={t("anomalyBanks.title")}
          description={t("anomalyBanks.subtitle", "Manage PatchCore-style anomaly memory banks per machine / product scope.")}
          badge={<ViewOnlyBadge module="analytics_ai_performance" />}
          actions={
            <>
              <Badge variant="outline">PatchCore</Badge>
              <Badge variant="secondary">{t("anomalyBanks.totalVectors")}: {totalVectors}</Badge>
            </>
          }
        />

        {/* Scope filter + global build-from-vectors trigger */}
        <div className="flex gap-3 flex-wrap items-end">
          <div className="grid gap-1">
            <Label>{t("anomalyBanks.machineId")}</Label>
            <MachineSelect value={machineId}
              onChange={(v) => setMachineId(v == null ? null : Number(v))}
              aria-label={t("anomalyBanks.machineId")} clearable />
          </div>
          <div className="grid gap-1">
            <Label>{t("anomalyBanks.productModelId")}</Label>
            <ProductModelSelect value={productModelId}
              onChange={(v) => setProductModelId(v == null ? null : Number(v))}
              aria-label={t("anomalyBanks.productModelId")} clearable />
          </div>
          <Button variant="outline" onClick={() => statsQ.refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> {t("anomalyBanks.refresh")}
          </Button>
          {admin && (
            <Button onClick={buildGlobal} disabled={rebuildM.isPending}>
              <Hammer className="h-4 w-4 mr-1" /> {t("anomalyBanks.buildFromVectors")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("anomalyBanks.buildHint")}</p>

        <Card>
          <CardContent className="p-0">
            <div className="w-full overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("anomalyBanks.col.scope")}</TableHead>
                  <TableHead>{t("anomalyBanks.col.modelCode")}</TableHead>
                  <TableHead>{t("anomalyBanks.col.bankSize")}</TableHead>
                  <TableHead>{t("anomalyBanks.col.threshold")}</TableHead>
                  <TableHead>k</TableHead>
                  <TableHead>{t("anomalyBanks.col.confidence")}</TableHead>
                  <TableHead>{t("anomalyBanks.col.builtAt")}</TableHead>
                  <TableHead className="text-right">{t("anomalyBanks.col.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {statsQ.isLoading && (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={`sk-${i}`}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
                {!statsQ.isLoading && profiles.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="py-4">
                      <EmptyState
                        variant="no-data"
                        icon={Database}
                        title={t("anomalyBanks.empty")}
                        description={t("anomalyBanks.emptyDesc", "No anomaly banks for this scope yet. Build one from stored vectors.")}
                        compact
                      />
                    </TableCell>
                  </TableRow>
                )}
                {profiles.map((p) => {
                  const boot = isBootstrap(p);
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{scopeLabel(p, t)}</TableCell>
                      <TableCell className="font-mono text-xs">{p.modelCode}</TableCell>
                      <TableCell>{p.bankSize ?? 0}</TableCell>
                      <TableCell className="text-xs">{p.threshold != null ? Number(p.threshold).toFixed(4) : "—"}</TableCell>
                      <TableCell>{p.k ?? "—"}</TableCell>
                      <TableCell>
                        {boot
                          ? <Badge variant="destructive">{t("anomalyBanks.bootstrap")}</Badge>
                          : <Badge variant="secondary">{t("anomalyBanks.ok")}</Badge>}
                      </TableCell>
                      <TableCell className="text-xs">{p.builtAt ? new Date(p.builtAt).toLocaleString() : "—"}</TableCell>
                      <TableCell className="text-right">
                        {admin && (
                          <div className="flex gap-1 justify-end">
                            <Button size="sm" variant="ghost" disabled={rebuildM.isPending} onClick={() => rebuildScope(p)}>
                              <RefreshCw className="h-4 w-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(p)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
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

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("anomalyBanks.confirmDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("anomalyBanks.confirmDeleteBody", { scope: confirmDelete ? scopeLabel(confirmDelete, t) : "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("anomalyBanks.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && deleteM.mutate({
              machineId: confirmDelete.machineId ?? null,
              productModelId: confirmDelete.productModelId ?? null,
              modelId: modelIdOf(confirmDelete.modelCode) ?? undefined,
              source: sourceOf(confirmDelete.modelCode),
            } as any)}>
              {t("anomalyBanks.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
