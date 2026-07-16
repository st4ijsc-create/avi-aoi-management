/**
 * doc 47 Đợt 4 (tech-debt) — "Máy" CRUD tab body extracted VERBATIM from
 * DataSettings.tsx. PURE RELOCATION: orchestrator owns all state/queries/mutations and
 * threads them as props (1:1 names). Identical JSX/handlers — no behavior change.
 * The copy-api-key button re-derives `trpc.useUtils()` locally (same provider, same
 * cache) exactly as the parent did with `trpcUtils`.
 */
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { EmptyState, StatusBadge } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { ExcelImportExport } from "@/components/ExcelImportExport";
import { Cpu, Plus, Loader2, Pencil, Trash2, RotateCcw, Key } from "lucide-react";
import { MACHINE_TYPES, type MachineType } from "@/constants/machineTypes";
import { machineTypeLabel } from "@/lib/machineTypeLabel";
import type { Factory, Workshop, Line, Station, Machine } from "./entityTypes";

type MachineForm = {
  factoryId: string; workshopId: string; lineId: string; stationId: string; code: string; name: string;
  machineType: MachineType; model: string; manufacturer: string; description: string;
};

interface MachinesTabProps {
  filteredMachines: Machine[];
  machines: Machine[] | undefined;
  machinesLoading: boolean;
  deletedMachines: Machine[] | undefined;
  factories: Factory[] | undefined;
  workshops: Workshop[] | undefined;
  lines: Line[] | undefined;
  stations: Station[] | undefined;
  machineTypes: string[];
  isAdmin: boolean;
  showDeleted: boolean;
  machineFilterStation: string;
  setMachineFilterStation: Dispatch<SetStateAction<string>>;
  machineFilterType: string;
  setMachineFilterType: Dispatch<SetStateAction<string>>;
  machineDialogOpen: boolean;
  setMachineDialogOpen: Dispatch<SetStateAction<boolean>>;
  machineForm: MachineForm;
  setMachineForm: Dispatch<SetStateAction<MachineForm>>;
  createMachineMutation: ReturnType<typeof trpc.machine.create.useMutation>;
  importMachinesMutation: ReturnType<typeof trpc.import.importMachines.useMutation>;
  exportMachinesMutation: ReturnType<typeof trpc.export.exportMachines.useMutation>;
  refetchMachines: () => void;
  copyToClipboard: (text: string) => void;
  handleEditMachine: (machine: Machine) => void;
  setMachineToDelete: Dispatch<SetStateAction<Machine | null>>;
  setDeleteMachineDialogOpen: Dispatch<SetStateAction<boolean>>;
  restoreMachineMutation: ReturnType<typeof trpc.machine.restore.useMutation>;
}

export function MachinesTab({
  filteredMachines,
  machines,
  machinesLoading,
  deletedMachines,
  factories,
  workshops,
  lines,
  stations,
  machineTypes,
  isAdmin,
  showDeleted,
  machineFilterStation,
  setMachineFilterStation,
  machineFilterType,
  setMachineFilterType,
  machineDialogOpen,
  setMachineDialogOpen,
  machineForm,
  setMachineForm,
  createMachineMutation,
  importMachinesMutation,
  exportMachinesMutation,
  refetchMachines,
  copyToClipboard,
  handleEditMachine,
  setMachineToDelete,
  setDeleteMachineDialogOpen,
  restoreMachineMutation,
}: MachinesTabProps) {
  const { t } = useTranslation();
  const trpcUtils = trpc.useUtils();
  // doc 54 P0-1 — read paths no longer return the plaintext apiKey. The only way to
  // obtain a key is the admin-only rotate (returns it once).
  const regenApiKey = trpc.machine.regenerateApiKey.useMutation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.machineList")}</CardTitle>
                    <CardDescription>{t("settings.machineCount", { count: filteredMachines.length })} {(machineFilterStation !== "all" || machineFilterType !== "all") && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="máy"
                    templateData={[{ stationCode: "S001", code: "M001", name: "Machine 1", machineType: "AVI", model: "", manufacturer: "", isActive: true }]}
                    templateFilename="machines_template.xlsx"
                    onImport={async (data, replaceIfExists) => importMachinesMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportMachinesMutation.mutateAsync()}
                    onImportComplete={() => refetchMachines()}
                  />
                  <Dialog open={machineDialogOpen} onOpenChange={setMachineDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addMachine")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addMachineNew")}</DialogTitle>
                        <DialogDescription>{t("settings.addMachineDesc")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={machineForm.factoryId} onValueChange={(v) => setMachineForm({ ...machineForm, factoryId: v, workshopId: "", lineId: "", stationId: "" })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.workshop")} *</label>
                          <Select value={machineForm.workshopId} onValueChange={(v) => setMachineForm({ ...machineForm, workshopId: v, lineId: "", stationId: "" })} disabled={!machineForm.factoryId}>
                            <SelectTrigger><SelectValue placeholder={machineForm.factoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.filter(w => String(w.factoryId) === machineForm.factoryId).map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.line")} *</label>
                          <Select value={machineForm.lineId} onValueChange={(v) => setMachineForm({ ...machineForm, lineId: v, stationId: "" })} disabled={!machineForm.workshopId}>
                            <SelectTrigger><SelectValue placeholder={machineForm.workshopId ? t("settings.selectLine") : t("dataSettings.selectWorkshopFirst")} /></SelectTrigger>
                            <SelectContent>
                              {lines?.filter(l => String(l.workshopId) === machineForm.workshopId).map((l) => (
                                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.sidebar.workstation")} *</label>
                          <Select value={machineForm.stationId} onValueChange={(v) => setMachineForm({ ...machineForm, stationId: v })} disabled={!machineForm.lineId}>
                            <SelectTrigger><SelectValue placeholder={machineForm.lineId ? t("settings.selectStation") : t("dataSettings.selectLineFirst")} /></SelectTrigger>
                            <SelectContent>
                              {stations?.filter(s => String(s.lineId) === machineForm.lineId).map((s) => (
                                <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.machineCode")} *</label>
                          <Input
                            placeholder={t("settings.machineCodePlaceholder")}
                            value={machineForm.code}
                            onChange={(e) => setMachineForm({ ...machineForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.machineName")} *</label>
                          <Input
                            placeholder={t("settings.machineNamePlaceholder")}
                            value={machineForm.name}
                            onChange={(e) => setMachineForm({ ...machineForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.machineType")} *</label>
                          <Select value={machineForm.machineType} onValueChange={(v: MachineType) => setMachineForm({ ...machineForm, machineType: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {MACHINE_TYPES.map((mt) => (
                                <SelectItem key={mt} value={mt}>{machineTypeLabel(t, mt)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.model")}</label>
                          <Input
                            placeholder={t("settings.modelPlaceholder")}
                            value={machineForm.model}
                            onChange={(e) => setMachineForm({ ...machineForm, model: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.manufacturer")}</label>
                          <Input
                            placeholder={t("settings.manufacturerPlaceholder")}
                            value={machineForm.manufacturer}
                            onChange={(e) => setMachineForm({ ...machineForm, manufacturer: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setMachineDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createMachineMutation.mutate({
                            code: machineForm.code,
                            name: machineForm.name,
                            description: machineForm.description,
                            machineType: machineForm.machineType,
                            model: machineForm.model,
                            manufacturer: machineForm.manufacturer,
                            stationId: parseInt(machineForm.stationId)
                          })}
                          disabled={createMachineMutation.isPending}
                        >
                          {createMachineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <DataTable<Machine>
                  data={filteredMachines}
                  getRowId={(m) => m.id}
                  loading={machinesLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchMachinePlaceholder")}
                  toolbar={
                    <>
                      <Select value={machineFilterStation} onValueChange={setMachineFilterStation}>
                        <SelectTrigger className="w-48 h-9">
                          <SelectValue placeholder={t("dataSettings.filterByStation")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("common.all")} {t("settings.sidebar.workstation").toLowerCase()}</SelectItem>
                          {stations?.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select value={machineFilterType} onValueChange={setMachineFilterType}>
                        <SelectTrigger className="w-40 h-9">
                          <SelectValue placeholder={t("dataSettings.filterByType")} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">{t("common.all")} {t("settings.machineType").toLowerCase()}</SelectItem>
                          {machineTypes.map((type) => (
                            <SelectItem key={type} value={type}>{machineTypeLabel(t, type as MachineType)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  }
                  emptyState={(machines?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Cpu}
                      title={t("settings.noMachine")}
                      description={t("dataSettings.emptyMachineDesc", "Chưa có máy nào. Thêm máy kiểm tra vào trạm.")}
                      actionLabel={t("settings.addMachine")}
                      onAction={() => setMachineDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.machineName"), cell: (m) => <span className="font-medium text-foreground">{m.name}</span>, sortValue: (m) => m.name, filterValue: (m) => m.name },
                    { id: "code", header: t("settings.machineCode"), width: "160px", cell: (m) => <span className="font-mono text-sm text-muted-foreground">{m.code}</span>, sortValue: (m) => m.code, filterValue: (m) => m.code },
                    { id: "type", header: t("settings.machineType"), width: "140px", cell: (m) => <StatusBadge status={m.machineType} tone="info" label={machineTypeLabel(t, m.machineType as MachineType)} />, sortValue: (m) => m.machineType, filterValue: (m) => `${m.machineType} ${machineTypeLabel(t, m.machineType as MachineType)}` },
                    { id: "station", header: t("settings.sidebar.workstation"), cell: (m) => <span className="text-sm text-muted-foreground">{stations?.find(s => s.id === m.stationId)?.name || t("common.na")}</span>, sortValue: (m) => stations?.find(s => s.id === m.stationId)?.name || "", filterValue: (m) => stations?.find(s => s.id === m.stationId)?.name || "" },
                    { id: "actions", header: "", align: "right", width: "180px", cell: (m) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1"
                          onClick={async () => {
                            // doc 54 P0-1 — cannot read the stored key; rotate to reveal
                            // once. Warn: this invalidates the machine's current key.
                            if (!window.confirm(t("settings.regenApiKeyConfirm", "Tạo lại API key sẽ VÔ HIỆU key hiện tại của máy cho tới khi cấu hình lại. Tiếp tục?"))) return;
                            const res = await regenApiKey.mutateAsync({ id: m.id });
                            copyToClipboard(res?.apiKey || '');
                          }}
                          disabled={regenApiKey.isPending}
                        >
                          <RotateCcw className="h-3 w-3" />
                          {t("settings.regenApiKey", "Tạo lại & sao chép key")}
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleEditMachine(m)}><Pencil className="h-4 w-4" /></Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            setMachineToDelete(m);
                            setDeleteMachineDialogOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted machines (admin) */}
                {showDeleted && isAdmin && deletedMachines && deletedMachines.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
                      <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                    </div>
                    {deletedMachines.map((machine: any) => (
                        <div key={machine.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Cpu className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{machine.name}</p>
                              <p className="text-sm text-muted-foreground">{machine.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreMachineMutation.mutate({ id: machine.id })}
                            disabled={restoreMachineMutation.isPending}
                          >
                            <RotateCcw className="h-3 w-3" />
                            {t("settings.restore")}
                          </Button>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
  );
}
