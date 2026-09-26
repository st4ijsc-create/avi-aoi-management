import { useState, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Cog, 
  Plus, 
  Pencil, 
  Trash2, 
  Loader2,
  Factory,
  GitBranch,
  Warehouse,
  Search,
  Eye,
  RotateCcw
} from "lucide-react";
import { ExcelImportExport } from "@/components/ExcelImportExport";

type Workstation = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  lineId?: number | null;
  workshopId?: number | null;
  factoryId?: number | null;
  processType?: string | null;
  orderIndex?: number | null;
  isActive: boolean;
};

const processTypes = [
  { value: 'SMT', label: 'SMT' },
  { value: 'DIP', label: 'DIP' },
  { value: 'ASSEMBLY', label: 'Assembly' },
  { value: 'TESTING', label: 'Testing' },
  { value: 'PACKAGING', label: 'Packaging' },
  { value: 'OTHER', label: 'Other' },
];

export default function WorkstationManagement() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingWorkstation, setEditingWorkstation] = useState<Workstation | null>(null);
  const [editWsWorkshopId, setEditWsWorkshopId] = useState("");
  const [form, setForm] = useState({
    code: "",
    name: "",
    description: "",
    lineId: "",
    workshopId: "",
    factoryId: "",
    processType: "",
    orderIndex: "0",
  });

  // Queries
  const { data: workstations, isLoading, refetch } = trpc.workstation.list.useQuery({});
  const { data: factories } = trpc.factory.list.useQuery();
  const { data: workshops } = trpc.workshop.list.useQuery();
  const { data: lines } = trpc.line.list.useQuery();

  // Search & Filter states
  const [wsSearch, setWsSearch] = useState("");
  const [wsFilterFactory, setWsFilterFactory] = useState("all");
  const [wsFilterLine, setWsFilterLine] = useState("all");
  const [wsFilterType, setWsFilterType] = useState("all");
  const [showDeleted, setShowDeleted] = useState(false);

  const filteredWorkstations = useMemo(() => {
    if (!workstations) return [];
    const q = wsSearch.toLowerCase().trim();
    return workstations.filter((ws: Workstation) => {
      if (wsFilterFactory !== "all" && String(ws.factoryId) !== wsFilterFactory) return false;
      if (wsFilterLine !== "all" && String(ws.lineId) !== wsFilterLine) return false;
      if (wsFilterType !== "all" && ws.processType !== wsFilterType) return false;
      if (q && !ws.name.toLowerCase().includes(q) && !ws.code.toLowerCase().includes(q) && !(ws.description || "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [workstations, wsSearch, wsFilterFactory, wsFilterLine, wsFilterType]);

  // Mutations
  const createMutation = trpc.workstation.create.useMutation({
    onSuccess: () => {
      toast.success(t('workstations.created'));
      setDialogOpen(false);
      resetForm();
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const updateMutation = trpc.workstation.update.useMutation({
    onSuccess: () => {
      toast.success(t('workstations.updated'));
      setEditDialogOpen(false);
      setEditingWorkstation(null);
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const deleteMutation = trpc.workstation.delete.useMutation({
    onSuccess: () => {
      toast.success(t('workstations.deleted'));
      refetch();
    },
    onError: (err) => toastTrpcError(err),
  });

  const importWorkstationsMutation = trpc.import.importWorkstations.useMutation();
  const exportWorkstationsMutation = trpc.export.exportWorkstations.useMutation();

  // Deleted items
  const { data: deletedWorkstations, refetch: refetchDeletedWorkstations } = trpc.workstation.listDeleted.useQuery(
    undefined, 
    { enabled: showDeleted && isAdmin }
  );

  const restoreMutation = trpc.workstation.restore.useMutation({
    onSuccess: () => {
      toast.success(t('workstations.restored'));
      refetch();
      refetchDeletedWorkstations();
    },
    onError: (err) => toastTrpcError(err),
  });

  const resetForm = () => {
    setForm({
      code: "",
      name: "",
      description: "",
      lineId: "",
      workshopId: "",
      factoryId: "",
      processType: "",
      orderIndex: "0",
    });
  };

  const handleCreate = () => {
    if (!form.code || !form.name) {
      toast.error(t('workstations.enterCodeAndName'));
      return;
    }

    createMutation.mutate({
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      lineId: form.lineId ? parseInt(form.lineId) : undefined,
      workshopId: form.workshopId ? parseInt(form.workshopId) : undefined,
      factoryId: form.factoryId ? parseInt(form.factoryId) : undefined,
      processType: form.processType as any || undefined,
      orderIndex: parseInt(form.orderIndex) || 0,
    });
  };

  const handleUpdate = () => {
    if (!editingWorkstation) return;

    updateMutation.mutate({
      id: editingWorkstation.id,
      code: editingWorkstation.code,
      name: editingWorkstation.name,
      description: editingWorkstation.description || undefined,
      lineId: editingWorkstation.lineId,
      workshopId: editingWorkstation.workshopId,
      factoryId: editingWorkstation.factoryId,
      processType: editingWorkstation.processType as any || undefined,
      orderIndex: editingWorkstation.orderIndex || 0,
      isActive: editingWorkstation.isActive,
    });
  };

  const openEditDialog = (ws: Workstation) => {
    const line = ws.lineId ? lines?.find(l => l.id === ws.lineId) : null;
    setEditWsWorkshopId(ws.workshopId ? String(ws.workshopId) : (line ? String(line.workshopId) : ""));
    setEditingWorkstation({ ...ws });
    setEditDialogOpen(true);
  };

  const getFactoryName = (factoryId?: number | null) => {
    if (!factoryId) return "-";
    return factories?.find(f => f.id === factoryId)?.name || "-";
  };

  const getWorkshopName = (workshopId?: number | null) => {
    if (!workshopId) return "-";
    return workshops?.find(w => w.id === workshopId)?.name || "-";
  };

  const getLineName = (lineId?: number | null) => {
    if (!lineId) return "-";
    return lines?.find(l => l.id === lineId)?.name || "-";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Cog className="h-5 w-5 text-orange-500" />
                {t('workstations.title')}
              </CardTitle>
              <CardDescription>
                {filteredWorkstations.length} {t('workstations.workstation')} {(wsSearch || wsFilterFactory !== "all" || wsFilterLine !== "all" || wsFilterType !== "all") && `(${t("common.filtered")})`}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
            <ExcelImportExport
              entityType="workstation"
              templateData={[{ code: "WS001", name: "Workstation 1", description: "", factoryCode: "F001", workshopCode: "W001", lineCode: "L001", processType: "SMT", orderIndex: 1, isActive: true }]}
              templateFilename="workstations_template.xlsx"
              onImport={async (data, replaceIfExists) => importWorkstationsMutation.mutateAsync({ data, replaceIfExists })}
              onExport={async () => exportWorkstationsMutation.mutateAsync()}
              onImportComplete={() => refetch()}
            />
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="h-4 w-4" />
                  {t('workstations.addWorkstation')}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{t('workstations.addNewWorkstation')}</DialogTitle>
                  <DialogDescription>
                    {t('workstations.addNewWorkstationDesc')}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('workstations.code')} *</label>
                      <Input
                        placeholder={t('workstations.codePlaceholder')}
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('workstations.workstationName')} *</label>
                      <Input
                        placeholder={t('workstations.namePlaceholder')}
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('common.description')}</label>
                    <Input
                      placeholder={t('workstations.descriptionPlaceholder')}
                      value={form.description}
                      onChange={(e) => setForm({ ...form, description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('workstations.factory')}</label>
                      <Select value={form.factoryId} onValueChange={(v) => setForm({ ...form, factoryId: v, workshopId: "", lineId: "" })}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('workstations.selectFactory')} />
                        </SelectTrigger>
                        <SelectContent>
                          {factories?.map((f) => (
                            <SelectItem key={f.id} value={f.id.toString()}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('workstations.workshop')}</label>
                      <Select value={form.workshopId} onValueChange={(v) => setForm({ ...form, workshopId: v, lineId: "" })} disabled={!form.factoryId}>
                        <SelectTrigger>
                          <SelectValue placeholder={form.factoryId ? t('workstations.selectWorkshop') : t('dataSettings.selectFactoryFirst')} />
                        </SelectTrigger>
                        <SelectContent>
                          {workshops?.filter(w => String(w.factoryId) === form.factoryId).map((w) => (
                            <SelectItem key={w.id} value={w.id.toString()}>
                              {w.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('workstations.line')}</label>
                      <Select value={form.lineId} onValueChange={(v) => setForm({ ...form, lineId: v })} disabled={!form.workshopId}>
                        <SelectTrigger>
                          <SelectValue placeholder={form.workshopId ? t('workstations.selectLine') : t('dataSettings.selectWorkshopFirst')} />
                        </SelectTrigger>
                        <SelectContent>
                          {lines?.filter(l => String(l.workshopId) === form.workshopId).map((l) => (
                            <SelectItem key={l.id} value={l.id.toString()}>
                              {l.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">{t('workstations.processType')}</label>
                      <Select value={form.processType} onValueChange={(v) => setForm({ ...form, processType: v })}>
                        <SelectTrigger>
                          <SelectValue placeholder={t('workstations.selectType')} />
                        </SelectTrigger>
                        <SelectContent>
                          {processTypes.map((pt) => (
                            <SelectItem key={pt.value} value={pt.value}>
                              {pt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">{t('workstations.order')}</label>
                    <Input
                      type="number"
                      placeholder="0"
                      value={form.orderIndex}
                      onChange={(e) => setForm({ ...form, orderIndex: e.target.value })}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    {t('common.cancel')}
                  </Button>
                  <Button onClick={handleCreate} disabled={createMutation.isPending}>
                    {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {t('common.create')}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder={t("dataSettings.searchWorkstationPlaceholder")}
                value={wsSearch}
                onChange={(e) => setWsSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={wsFilterFactory} onValueChange={setWsFilterFactory}>
              <SelectTrigger className="w-45">
                <SelectValue placeholder={t("dataSettings.filterByFactory")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")} {t("workstations.factory").toLowerCase()}</SelectItem>
                {factories?.map((f) => (
                  <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={wsFilterLine} onValueChange={setWsFilterLine}>
              <SelectTrigger className="w-45">
                <SelectValue placeholder={t("dataSettings.filterByLine")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")} {t("workstations.line").toLowerCase()}</SelectItem>
                {lines?.map((l) => (
                  <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={wsFilterType} onValueChange={setWsFilterType}>
              <SelectTrigger className="w-37.5">
                <SelectValue placeholder={t("dataSettings.filterByType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("common.all")} {t("workstations.type").toLowerCase()}</SelectItem>
                {processTypes.map((pt) => (
                  <SelectItem key={pt.value} value={pt.value}>{pt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          {isAdmin && (
            <div className="flex items-center gap-2 mb-4">
              <Switch 
                id="show-deleted-workstations" 
                checked={showDeleted} 
                onCheckedChange={setShowDeleted} 
              />
              <Label 
                htmlFor="show-deleted-workstations" 
                className="text-sm text-muted-foreground flex items-center gap-1 cursor-pointer"
              >
                <Eye className="h-4 w-4" />
                {t("settings.showDeleted")}
              </Label>
            </div>
          )}
          
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('workstations.code')}</TableHead>
                  <TableHead>{t('common.name')}</TableHead>
                  <TableHead>{t('workstations.type')}</TableHead>
                  <TableHead>{t('workstations.factory')}</TableHead>
                  <TableHead>{t('workstations.line')}</TableHead>
                  <TableHead>{t('common.status')}</TableHead>
                  <TableHead className="text-right">{t('common.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWorkstations.map((ws) => (
                  <TableRow key={ws.id}>
                    <TableCell className="font-medium">{ws.code}</TableCell>
                    <TableCell>{ws.name}</TableCell>
                    <TableCell>
                      {ws.processType && (
                        <Badge variant="outline">{ws.processType}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <Factory className="h-3 w-3" />
                        {getFactoryName(ws.factoryId)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-sm text-muted-foreground">
                        <GitBranch className="h-3 w-3" />
                        {getLineName(ws.lineId)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ws.isActive ? "default" : "secondary"}>
                        {ws.isActive ? t('common.active') : t('common.paused')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(ws)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(t('workstations.confirmDelete'))) {
                              deleteMutation.mutate(ws.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filteredWorkstations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {(wsSearch || wsFilterFactory !== "all" || wsFilterLine !== "all" || wsFilterType !== "all") ? t("common.noResults") : t('workstations.emptyState')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          
          {/* Deleted Items Section */}
          {isAdmin && showDeleted && deletedWorkstations && deletedWorkstations.length > 0 && (
            <>
              <div className="border-t pt-3 mt-3">
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  {t("settings.deletedItems")}
                </p>
              </div>
              <div className="space-y-2">
                {deletedWorkstations.map((ws: Workstation) => (
                  <div 
                    key={ws.id} 
                    className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                        <Cog className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-muted-foreground line-through">{ws.name}</p>
                          <Badge variant="outline" className="text-destructive border-destructive/50">
                            {t("settings.deleted")}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{ws.code}</p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => restoreMutation.mutate({ id: ws.id })}
                      disabled={restoreMutation.isPending}
                    >
                      <RotateCcw className="h-3 w-3" />
                      {t("settings.restore")}
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
          
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('workstations.editWorkstation')}</DialogTitle>
          </DialogHeader>
          {editingWorkstation && (
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.code')}</label>
                  <Input
                    value={editingWorkstation.code}
                    onChange={(e) => setEditingWorkstation({ ...editingWorkstation, code: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.workstationName')}</label>
                  <Input
                    value={editingWorkstation.name}
                    onChange={(e) => setEditingWorkstation({ ...editingWorkstation, name: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('common.description')}</label>
                <Input
                  value={editingWorkstation.description || ""}
                  onChange={(e) => setEditingWorkstation({ ...editingWorkstation, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.factory')}</label>
                  <Select 
                    value={editingWorkstation.factoryId?.toString() || ""} 
                    onValueChange={(v) => {
                      setEditWsWorkshopId("");
                      setEditingWorkstation({ ...editingWorkstation, factoryId: v ? parseInt(v) : null, workshopId: null, lineId: null });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('workstations.selectFactory')} />
                    </SelectTrigger>
                    <SelectContent>
                      {factories?.map((f) => (
                        <SelectItem key={f.id} value={f.id.toString()}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.workshop')}</label>
                  <Select 
                    value={editWsWorkshopId} 
                    onValueChange={(v) => {
                      setEditWsWorkshopId(v);
                      setEditingWorkstation({ ...editingWorkstation, workshopId: v ? parseInt(v) : null, lineId: null });
                    }}
                    disabled={!editingWorkstation.factoryId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={editingWorkstation.factoryId ? t('workstations.selectWorkshop') : t('dataSettings.selectFactoryFirst')} />
                    </SelectTrigger>
                    <SelectContent>
                      {workshops?.filter(w => String(w.factoryId) === String(editingWorkstation.factoryId)).map((w) => (
                        <SelectItem key={w.id} value={w.id.toString()}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.line')}</label>
                  <Select 
                    value={editingWorkstation.lineId?.toString() || ""} 
                    onValueChange={(v) => setEditingWorkstation({ ...editingWorkstation, lineId: v ? parseInt(v) : null })}
                    disabled={!editWsWorkshopId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={editWsWorkshopId ? t('workstations.selectLine') : t('dataSettings.selectWorkshopFirst')} />
                    </SelectTrigger>
                    <SelectContent>
                      {lines?.filter(l => String(l.workshopId) === editWsWorkshopId).map((l) => (
                        <SelectItem key={l.id} value={l.id.toString()}>
                          {l.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.processType')}</label>
                  <Select 
                    value={editingWorkstation.processType || ""} 
                    onValueChange={(v) => setEditingWorkstation({ ...editingWorkstation, processType: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('workstations.selectType')} />
                    </SelectTrigger>
                    <SelectContent>
                      {processTypes.map((pt) => (
                        <SelectItem key={pt.value} value={pt.value}>
                          {pt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('workstations.order')}</label>
                  <Input
                    type="number"
                    value={editingWorkstation.orderIndex || 0}
                    onChange={(e) => setEditingWorkstation({ ...editingWorkstation, orderIndex: parseInt(e.target.value) || 0 })}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">{t('workstations.activeStatus')}</label>
                <Switch
                  checked={editingWorkstation.isActive}
                  onCheckedChange={(checked) => setEditingWorkstation({ ...editingWorkstation, isActive: checked })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
