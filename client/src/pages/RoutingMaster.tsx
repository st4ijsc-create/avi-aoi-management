/**
 * Routing Master (ISA-95 operations sequence) — per-product process routes.
 *
 * Backend: server/routers/routingRouter.ts (doc 35 Wave W4-E). The ERP order
 * intake path (erpIntake.ts) had no routing master to resolve an order's
 * operations against; this page is the missing authoring UI. It surfaces:
 *   • list routings (filter by product / status) with code · version · status
 *     (draft | active | archived),
 *   • create a routing (product + code + version + name + optional initial steps),
 *   • ACTIVATE a routing — the server atomically archives any sibling active
 *     routing for the same product (one active per product invariant),
 *   • archive / delete,
 *   • a STEPS editor per routing (stepNo · operationCode · station/machine-type ·
 *     standard time · description) saved via replaceSteps.
 *
 * RBAC (UX gate; server also enforces via requirePermission): module
 * `production_orders`. canView gates the page; canCreate/canEdit gate
 * create/activate/archive/step-editing; canDelete gates delete.
 *
 * SAFETY: pure master-data CRUD — never writes a value to a machine.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Route, Plus, Trash2, CheckCircle2, Archive, ListOrdered, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

const STATUSES = ["draft", "active", "archived"] as const;
type RoutingStatus = (typeof STATUSES)[number];

type Routing = {
  id: number;
  productModelId: number;
  code: string;
  version: number;
  name: string | null;
  description: string | null;
  status: RoutingStatus;
  updatedAt: string | Date | null;
};

type Step = {
  id?: number;
  stepNo: number;
  operationCode: string;
  stationOrMachineType: string | null;
  standardTimeSec: number | null;
  description: string | null;
};

const STATUS_VARIANT: Record<RoutingStatus, BadgeVariant> = {
  draft: "outline",
  active: "default",
  archived: "secondary",
};

/** Local, editable draft-step shape used by both create + steps editor. */
type DraftStep = {
  stepNo: string;
  operationCode: string;
  stationOrMachineType: string;
  standardTimeSec: string;
  description: string;
};

const emptyDraftStep = (stepNo: number): DraftStep => ({
  stepNo: String(stepNo),
  operationCode: "",
  stationOrMachineType: "",
  standardTimeSec: "",
  description: "",
});

function toStepPayload(rows: DraftStep[]): Step[] {
  return rows
    .filter((r) => r.operationCode.trim().length > 0)
    .map((r, i) => ({
      stepNo: Number(r.stepNo) || i + 1,
      operationCode: r.operationCode.trim(),
      stationOrMachineType: r.stationOrMachineType.trim() || null,
      standardTimeSec: r.standardTimeSec ? Number(r.standardTimeSec) : null,
      description: r.description.trim() || null,
    }));
}

export default function RoutingMaster() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canView = hasPermission("production_orders", "canView");
  const canCreate = hasPermission("production_orders", "canCreate");
  const canEdit = hasPermission("production_orders", "canEdit");
  const canDelete = hasPermission("production_orders", "canDelete");

  const [productFilter, setProductFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [stepsFor, setStepsFor] = useState<Routing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Routing | null>(null);
  const [activateTarget, setActivateTarget] = useState<Routing | null>(null);

  const utils = trpc.useUtils();
  const productsQ = trpc.productModel.list.useQuery({ limit: 100 }, { enabled: canView });
  const listQ = trpc.routing.list.useQuery(
    {
      productModelId: productFilter ? Number(productFilter) : undefined,
      status: (statusFilter || undefined) as RoutingStatus | undefined,
      limit: 200,
    },
    { enabled: canView },
  );

  const products = (productsQ.data ?? []) as Array<{ id: number; code: string; name?: string | null }>;
  const productLabel = (id: number) => {
    const p = products.find((x) => x.id === id);
    return p ? `${p.code}${p.name ? ` — ${p.name}` : ""}` : `#${id}`;
  };

  const invalidate = () => { void utils.routing.list.invalidate(); };

  const createM = trpc.routing.create.useMutation({
    onSuccess: () => { toast.success(t("routing.created", "Routing created")); setCreateOpen(false); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const activateM = trpc.routing.activate.useMutation({
    onSuccess: () => { toast.success(t("routing.activated", "Routing activated")); setActivateTarget(null); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const archiveM = trpc.routing.archive.useMutation({
    onSuccess: () => { toast.success(t("routing.archived", "Routing archived")); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const deleteM = trpc.routing.delete.useMutation({
    onSuccess: () => { toast.success(t("routing.deleted", "Routing deleted")); setConfirmDelete(null); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });

  const rows = (listQ.data ?? []) as Routing[];

  if (!canView) {
    return (
      <DashboardLayout title={t("routing.title", "Routing Master")} navItems={navItems} currentPath="/routing-master">
        <div className="p-6">
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
            {t("routing.noPermission", "You do not have permission to view routing master data.")}
          </CardContent></Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={t("routing.title", "Routing Master")} navItems={navItems} currentPath="/routing-master">
      <PageContainer fluid className="space-y-4">
        <PageHeader
          icon={<Route className="h-6 w-6 text-primary" />}
          title={t("routing.title", "Routing Master")}
          description={t("routing.subtitle", "ISA-95 per-product operation routes that ERP order intake resolves against.")}
          actions={
            canCreate && (
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-1" /> {t("routing.create", "New routing")}
              </Button>
            )
          }
        />

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <Label>{t("routing.filterProduct", "Product")}</Label>
            <Select value={productFilter || "ALL"} onValueChange={(v) => setProductFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger aria-label={t("routing.filterProduct", "Product")} className="h-9 w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("routing.all", "All products")}</SelectItem>
                {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}{p.name ? ` — ${p.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1">
            <Label>{t("routing.filterStatus", "Status")}</Label>
            <Select value={statusFilter || "ALL"} onValueChange={(v) => setStatusFilter(v === "ALL" ? "" : v)}>
              <SelectTrigger aria-label={t("routing.filterStatus", "Status")} className="h-9 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("routing.all", "All")}</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`routing.status.${s}`, s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("routing.col.code", "Code")}</TableHead>
                  <TableHead>{t("routing.col.version", "Ver")}</TableHead>
                  <TableHead>{t("routing.col.name", "Name")}</TableHead>
                  <TableHead>{t("routing.col.product", "Product")}</TableHead>
                  <TableHead>{t("routing.col.status", "Status")}</TableHead>
                  <TableHead className="text-right">{t("routing.col.actions", "Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("routing.loading", "Loading…")}</TableCell></TableRow>
                )}
                {listQ.isError && !listQ.isLoading && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-destructive">{t("routing.loadError", "Failed to load routings.")}</TableCell></TableRow>
                )}
                {!listQ.isLoading && !listQ.isError && rows.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">{t("routing.empty", "No routings yet.")}</TableCell></TableRow>
                )}
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.code}</TableCell>
                    <TableCell className="text-xs">v{r.version}</TableCell>
                    <TableCell className="max-w-[18rem] truncate">{r.name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{productLabel(r.productModelId)}</TableCell>
                    <TableCell><StatusBadge status={r.status} variant={STATUS_VARIANT[r.status]} label={t(`routing.status.${r.status}`, r.status)} /></TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {canEdit && (
                          <Button size="sm" variant="ghost" onClick={() => setStepsFor(r)}>
                            <ListOrdered className="h-4 w-4 mr-1" /> {t("routing.steps", "Steps")}
                          </Button>
                        )}
                        {canEdit && r.status !== "active" && (
                          <Button size="sm" variant="ghost" aria-label={t("routing.activate", "Activate")} onClick={() => setActivateTarget(r)}>
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          </Button>
                        )}
                        {canEdit && r.status === "active" && (
                          <Button size="sm" variant="ghost" aria-label={t("routing.archive", "Archive")} onClick={() => archiveM.mutate({ id: r.id })}>
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="ghost" aria-label={t("common.delete", "Delete")} onClick={() => setConfirmDelete(r)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
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
          onClose={() => setCreateOpen(false)}
          onSubmit={(v) => createM.mutate(v as any)}
          pending={createM.isPending}
        />
      )}

      {stepsFor && (
        <StepsDialog
          routing={stepsFor}
          productLabel={productLabel}
          onClose={() => setStepsFor(null)}
        />
      )}

      {/* Activate confirm — surfaces the sibling-archive side effect. */}
      <AlertDialog open={activateTarget != null} onOpenChange={(o) => { if (!o) setActivateTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("routing.activateConfirmTitle", "Activate routing?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("routing.activateConfirmBody", "Activating {{code}} v{{version}} archives any currently-active routing for this product (one active route per product).", { code: activateTarget?.code, version: activateTarget?.version })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={activateM.isPending} onClick={() => { if (activateTarget) activateM.mutate({ id: activateTarget.id }); }}>
              {t("routing.activate", "Activate")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete != null} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("routing.deleteConfirmTitle", "Delete routing?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("routing.deleteConfirmBody", "Delete {{code}} v{{version}} and all its steps? This cannot be undone.", { code: confirmDelete?.code, version: confirmDelete?.version })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction disabled={deleteM.isPending} onClick={() => { if (confirmDelete) deleteM.mutate({ id: confirmDelete.id }); }}>
              {t("common.delete", "Delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function CreateDialog({
  products, onClose, onSubmit, pending,
}: {
  products: Array<{ id: number; code: string; name?: string | null }>;
  onClose: () => void;
  onSubmit: (v: Record<string, any>) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [productModelId, setProductModelId] = useState<string>("");
  const [code, setCode] = useState("");
  const [version, setVersion] = useState<string>("1");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([emptyDraftStep(1)]);

  const addRow = () => setSteps((s) => [...s, emptyDraftStep(s.length + 1)]);
  const removeRow = (i: number) => setSteps((s) => s.filter((_, idx) => idx !== i));
  const patchRow = (i: number, patch: Partial<DraftStep>) =>
    setSteps((s) => s.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = () => {
    if (!productModelId) { toast.error(t("routing.productRequired", "Select a product")); return; }
    if (code.trim().length === 0) { toast.error(t("routing.codeRequired", "Code is required")); return; }
    onSubmit({
      productModelId: Number(productModelId),
      code: code.trim(),
      version: Number(version) || 1,
      name: name.trim() || undefined,
      description: description.trim() || undefined,
      steps: toStepPayload(steps),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t("routing.create", "New routing")}</DialogTitle></DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1">
            <Label>{t("routing.col.product", "Product")} *</Label>
            <Select value={productModelId} onValueChange={setProductModelId}>
              <SelectTrigger aria-label={t("routing.col.product", "Product")} className="h-9 w-full">
                <SelectValue placeholder={t("routing.selectProduct", "Select a product…")} />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}{p.name ? ` — ${p.name}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1 col-span-2">
              <Label>{t("routing.col.code", "Code")} *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label>{t("routing.col.version", "Version")}</Label>
              <Input type="number" min={1} value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1">
            <Label>{t("routing.col.name", "Name")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1">
            <Label>{t("routing.field.description", "Description")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <StepsEditor steps={steps} onAdd={addRow} onRemove={removeRow} onPatch={patchRow} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={submit} disabled={pending}>{t("routing.create", "Create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StepsDialog({
  routing, productLabel, onClose,
}: {
  routing: Routing;
  productLabel: (id: number) => string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const detailQ = trpc.routing.getById.useQuery({ id: routing.id });
  const [steps, setSteps] = useState<DraftStep[] | null>(null);

  // Seed the local editable list from the server once loaded.
  const seed = useMemo<DraftStep[]>(() => {
    const s = (detailQ.data as any)?.steps as Step[] | undefined;
    if (!s || s.length === 0) return [emptyDraftStep(1)];
    return s.map((x) => ({
      stepNo: String(x.stepNo),
      operationCode: x.operationCode,
      stationOrMachineType: x.stationOrMachineType ?? "",
      standardTimeSec: x.standardTimeSec != null ? String(x.standardTimeSec) : "",
      description: x.description ?? "",
    }));
  }, [detailQ.data]);

  const rows = steps ?? seed;

  const addRow = () => setSteps([...rows, emptyDraftStep(rows.length + 1)]);
  const removeRow = (i: number) => setSteps(rows.filter((_, idx) => idx !== i));
  const patchRow = (i: number, patch: Partial<DraftStep>) =>
    setSteps(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const replaceM = trpc.routing.replaceSteps.useMutation({
    onSuccess: () => {
      toast.success(t("routing.stepsSaved", "Steps saved"));
      void utils.routing.getById.invalidate({ id: routing.id });
      onClose();
    },
    onError: (e) => toastTrpcError(e),
  });

  const save = () => {
    replaceM.mutate({ routingId: routing.id, steps: toStepPayload(rows) as any });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {routing.code} v{routing.version}
            <span className="ml-2 font-sans text-xs text-muted-foreground">{productLabel(routing.productModelId)}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {detailQ.isLoading ? (
            <div className="py-8 text-center text-muted-foreground">{t("routing.loading", "Loading…")}</div>
          ) : detailQ.isError ? (
            <div className="py-8 text-center text-destructive">{t("routing.loadStepsError", "Failed to load steps.")}</div>
          ) : (
            <StepsEditor steps={rows} onAdd={addRow} onRemove={removeRow} onPatch={patchRow} />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
          <Button onClick={save} disabled={replaceM.isPending || detailQ.isLoading}>{t("routing.saveSteps", "Save steps")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared editable step-rows grid used by create + the steps dialog. */
function StepsEditor({
  steps, onAdd, onRemove, onPatch,
}: {
  steps: DraftStep[];
  onAdd: () => void;
  onRemove: (i: number) => void;
  onPatch: (i: number, patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium flex items-center gap-1">
          <ListOrdered className="h-4 w-4" /> {t("routing.stepsTitle", "Operation steps")}
        </div>
        <Button size="sm" variant="outline" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5 mr-1" /> {t("routing.addStep", "Add step")}
        </Button>
      </div>
      <div className="space-y-2">
        {steps.map((s, i) => (
          <div key={i} className="grid grid-cols-12 gap-2 items-center">
            <Input
              className="col-span-1 h-9" type="number" min={1} aria-label={t("routing.step.no", "Step #")}
              value={s.stepNo} onChange={(e) => onPatch(i, { stepNo: e.target.value })}
            />
            <Input
              className="col-span-3 h-9" placeholder={t("routing.step.opCode", "Operation code")}
              value={s.operationCode} onChange={(e) => onPatch(i, { operationCode: e.target.value })}
            />
            <Input
              className="col-span-3 h-9" placeholder={t("routing.step.station", "Station / machine type")}
              value={s.stationOrMachineType} onChange={(e) => onPatch(i, { stationOrMachineType: e.target.value })}
            />
            <Input
              className="col-span-2 h-9" type="number" min={0} placeholder={t("routing.step.time", "Std time (s)")}
              value={s.standardTimeSec} onChange={(e) => onPatch(i, { standardTimeSec: e.target.value })}
            />
            <Input
              className="col-span-2 h-9" placeholder={t("routing.step.desc", "Description")}
              value={s.description} onChange={(e) => onPatch(i, { description: e.target.value })}
            />
            <div className="col-span-1 flex justify-end">
              {steps.length > 1 && (
                <Button size="sm" variant="ghost" className="h-9 w-9 p-0" aria-label={t("routing.removeStep", "Remove step")} onClick={() => onRemove(i)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("routing.stepsHint", "Rows with an empty operation code are ignored on save.")}
      </p>
    </div>
  );
}
