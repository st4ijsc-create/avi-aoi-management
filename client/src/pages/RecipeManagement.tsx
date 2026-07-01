/**
 * Sprint G2.2b — Machine Recipe management (CONFIG + VIEW only).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This page manages the recipe CATALOG (versioned parameter sets) and shows the
 *     deployment LEDGER. recipes.deploy / recipes.rollback ONLY flip the active
 *     version + write a recipe_deployments ledger row (the router guarantees this —
 *     no commandDispatcher, no driver write path).
 *   - To actually PUSH a recipe down to a real machine, use the HITL write-action
 *     flow in the AI Copilot. This page NEVER bypasses HITL.
 * RBAC via module 'machine_control':
 *   view = canView ; create = canCreate ; deploy/rollback/archive = canEdit.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { useTranslation } from "react-i18next";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { FlaskConical, Plus, AlertTriangle, RotateCcw, Rocket } from "lucide-react";
import { toast } from "sonner";

type RecipeStatus = "draft" | "active" | "archived";

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "draft") return "secondary";
  return "outline";
}

interface NewVersionForm {
  code: string;
  name: string;
  payloadText: string;
  notes: string;
}

const emptyNewVersion: NewVersionForm = { code: "", name: "", payloadText: "{\n  \n}", notes: "" };

export default function RecipeManagement() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("machine_control", "canView");
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");

  const utils = trpc.useUtils();

  const codesQuery = trpc.machineRecipe.recipes.listCodes.useQuery(undefined, { enabled: canView });
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const versionsQuery = trpc.machineRecipe.recipes.listVersions.useQuery(
    { code: selectedCode ?? "" },
    { enabled: canView && selectedCode != null && selectedCode.length > 0 },
  );

  const deploymentsQuery = trpc.machineRecipe.deployments.list.useQuery(
    { limit: 100 },
    { enabled: canView },
  );

  const invalidateAll = () => {
    void utils.machineRecipe.recipes.listCodes.invalidate();
    if (selectedCode) void utils.machineRecipe.recipes.listVersions.invalidate({ code: selectedCode });
    void utils.machineRecipe.deployments.list.invalidate();
  };

  // ── Create new version dialog ──
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<NewVersionForm>(emptyNewVersion);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const createRecipe = trpc.machineRecipe.recipes.create.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastCreated")); setCreateOpen(false); setForm(emptyNewVersion); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Deploy dialog ──
  const [deployRecipeId, setDeployRecipeId] = useState<number | null>(null);
  const [deployMachineId, setDeployMachineId] = useState("");
  const [deployNotes, setDeployNotes] = useState("");

  const deploy = trpc.machineRecipe.recipes.deploy.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastDeployed")); setDeployRecipeId(null); setDeployMachineId(""); setDeployNotes(""); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Rollback (AlertDialog) ──
  const [rollbackMachineId, setRollbackMachineId] = useState<number | null>(null);
  const rollback = trpc.machineRecipe.recipes.rollback.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastRolledBack")); setRollbackMachineId(null); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  // ── Archive ──
  const archive = trpc.machineRecipe.recipes.archive.useMutation({
    onSuccess: () => { toast.success(t("recipes.toastArchived")); invalidateAll(); },
    onError: (e) => toast.error(e.message),
  });

  const openCreate = () => {
    setForm({ ...emptyNewVersion, code: selectedCode ?? "" });
    setJsonError(null);
    setCreateOpen(true);
  };

  const submitCreate = () => {
    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(form.payloadText);
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        setJsonError(t("recipes.jsonMustBeObject"));
        return;
      }
      parsed = value as Record<string, unknown>;
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : String(err));
      return;
    }
    setJsonError(null);
    createRecipe.mutate({
      code: form.code.trim(),
      name: form.name.trim(),
      payload: parsed,
      notes: form.notes.trim() || null,
    });
  };

  const codes = codesQuery.data ?? [];
  const versions = versionsQuery.data ?? [];
  const deployments = deploymentsQuery.data ?? [];

  if (!canView) {
    return (
      <DashboardLayout title={t("recipes.title")} navItems={navItems} currentPath="/recipes">
        <div className="p-6 text-muted-foreground">{t("recipes.noViewPermission")}</div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("recipes.title")} navItems={navItems} currentPath="/recipes">
    <div className="p-6 space-y-6">
      <PageHeader
        icon={<FlaskConical className="h-6 w-6" />}
        title={
          <span className="flex items-center gap-2">
            {t("recipes.title")}<ViewOnlyBadge module="machine_control" />
          </span>
        }
        actions={
          canCreate ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> {t("recipes.newVersion")}
            </Button>
          ) : undefined
        }
      />

      {/* SAFETY banner — HITL */}
      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0" />
        <span>{t("recipes.hitlBanner")}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Codes list */}
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>{t("recipes.codes")} ({codes.length})</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("recipes.code")}</TableHead>
                  <TableHead>{t("recipes.versionsCount")}</TableHead>
                  <TableHead>{t("recipes.active")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codes.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
                )}
                {codes.map((c) => (
                  <TableRow
                    key={c.code}
                    className={`cursor-pointer ${selectedCode === c.code ? "bg-muted" : ""}`}
                    onClick={() => setSelectedCode(c.code)}
                  >
                    <TableCell className="font-medium">{c.code}<div className="text-xs text-muted-foreground">{c.name}</div></TableCell>
                    <TableCell>{c.versions}</TableCell>
                    <TableCell>{c.activeVersion != null ? <Badge>v{c.activeVersion}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Versions of selected code */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{selectedCode ? t("recipes.versionsOf", { code: selectedCode }) : t("recipes.selectCode")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("recipes.version")}</TableHead>
                  <TableHead>{t("recipes.name")}</TableHead>
                  <TableHead>{t("recipes.status")}</TableHead>
                  <TableHead>{t("recipes.checksum")}</TableHead>
                  <TableHead className="text-right">{t("recipes.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedCode == null && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("recipes.selectCodeHint")}</TableCell></TableRow>
                )}
                {selectedCode != null && versions.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
                )}
                {versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">v{v.version}</TableCell>
                    <TableCell>{v.name}</TableCell>
                    <TableCell><Badge variant={statusVariant(v.status)}>{v.status}</Badge></TableCell>
                    <TableCell className="max-w-[140px] truncate font-mono text-xs" title={v.checksum ?? ""}>{v.checksum ?? "—"}</TableCell>
                    <TableCell className="text-right space-x-1">
                      {canEdit && (
                        <Button
                          size="sm" variant="outline"
                          disabled={deploy.isPending}
                          onClick={() => { setDeployRecipeId(v.id); setDeployMachineId(v.machineId != null ? String(v.machineId) : ""); setDeployNotes(""); }}
                        >
                          <Rocket className="h-4 w-4 mr-1" /> {t("recipes.deploy")}
                        </Button>
                      )}
                      {canEdit && v.status !== "archived" && (
                        <Button
                          size="sm" variant="outline"
                          disabled={archive.isPending}
                          onClick={() => { if (confirm(t("recipes.confirmArchive", { version: v.version }))) archive.mutate({ id: v.id }); }}
                        >
                          {t("recipes.archive")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Deployment ledger */}
      <Card>
        <CardHeader><CardTitle>{t("recipes.deployHistory")} ({deployments.length})</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("recipes.machine")}</TableHead>
                <TableHead>{t("recipes.recipeVersion")}</TableHead>
                <TableHead>{t("recipes.deployedBy")}</TableHead>
                <TableHead>{t("recipes.deployedAt")}</TableHead>
                <TableHead>{t("recipes.status")}</TableHead>
                <TableHead>{t("recipes.previous")}</TableHead>
                <TableHead>{t("recipes.notes")}</TableHead>
                <TableHead className="text-right">{t("recipes.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deployments.length === 0 && (
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">{t("recipes.empty")}</TableCell></TableRow>
              )}
              {deployments.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.machineId}</TableCell>
                  <TableCell>{d.recipeCode != null ? `${d.recipeCode} v${d.recipeVersion}` : `#${d.recipeId}`}</TableCell>
                  <TableCell>{d.deployedBy}</TableCell>
                  <TableCell className="text-xs">{d.deployedAt ? new Date(d.deployedAt).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant={statusVariant(d.status)}>{d.status}</Badge></TableCell>
                  <TableCell>{d.previousRecipeId ?? "—"}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={d.notes ?? ""}>{d.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {canEdit && d.previousRecipeId != null && (
                      <Button size="sm" variant="outline" disabled={rollback.isPending}
                        onClick={() => setRollbackMachineId(d.machineId)}>
                        <RotateCcw className="h-4 w-4 mr-1" /> {t("recipes.rollback")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── New version dialog ── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("recipes.newVersion")}</DialogTitle>
            <DialogDescription>{t("recipes.newVersionDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t("recipes.code")}</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </div>
              <div>
                <Label>{t("recipes.name")}</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{t("recipes.payloadJson")}</Label>
              <Textarea
                className="font-mono text-xs min-h-[180px]"
                value={form.payloadText}
                onChange={(e) => { setForm({ ...form, payloadText: e.target.value }); setJsonError(null); }}
              />
              {jsonError && <p className="text-xs text-rose-600 mt-1">{t("recipes.jsonError")}: {jsonError}</p>}
            </div>
            <div>
              <Label>{t("recipes.notes")}</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>{t("recipes.cancel")}</Button>
            <Button
              onClick={submitCreate}
              disabled={createRecipe.isPending || !form.code.trim() || !form.name.trim()}
            >
              {t("recipes.saveNewVersion")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Deploy dialog ── */}
      <Dialog open={deployRecipeId != null} onOpenChange={(o) => { if (!o) setDeployRecipeId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("recipes.deploy")}</DialogTitle>
            <DialogDescription>{t("recipes.deployDesc")}</DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{t("recipes.hitlBanner")}</span>
          </div>
          <div className="space-y-3 mt-2">
            <div>
              <Label>{t("recipes.machineId")}</Label>
              <Input type="number" value={deployMachineId} onChange={(e) => setDeployMachineId(e.target.value)} />
            </div>
            <div>
              <Label>{t("recipes.notes")}</Label>
              <Input value={deployNotes} onChange={(e) => setDeployNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeployRecipeId(null)}>{t("recipes.cancel")}</Button>
            <Button
              disabled={deploy.isPending || !deployMachineId.trim() || Number.isNaN(Number(deployMachineId))}
              onClick={() => {
                if (deployRecipeId == null) return;
                deploy.mutate({
                  recipeId: deployRecipeId,
                  machineId: Number(deployMachineId),
                  notes: deployNotes.trim() || null,
                });
              }}
            >
              {t("recipes.confirmDeploy")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Rollback confirm ── */}
      <AlertDialog open={rollbackMachineId != null} onOpenChange={(o) => { if (!o) setRollbackMachineId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("recipes.rollback")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("recipes.rollbackConfirm", { machineId: rollbackMachineId ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("recipes.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (rollbackMachineId != null) rollback.mutate({ machineId: rollbackMachineId }); }}
            >
              {t("recipes.confirmRollback")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </DashboardLayout>
  );
}
