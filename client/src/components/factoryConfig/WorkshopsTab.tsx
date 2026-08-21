/**
 * doc 47 Đợt 4 (tech-debt) — "Phân xưởng" CRUD tab body extracted VERBATIM from
 * DataSettings.tsx. PURE RELOCATION: orchestrator owns all state/queries/mutations and
 * threads them as props (1:1 names). Identical JSX/handlers — no behavior change.
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
import { EmptyState } from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { ExcelImportExport } from "@/components/ExcelImportExport";
import { Warehouse, Plus, Loader2, Pencil, Trash2, RotateCcw } from "lucide-react";
import type { Factory, Workshop } from "./entityTypes";

type WorkshopForm = { factoryId: string; code: string; name: string; description: string };

interface WorkshopsTabProps {
  filteredWorkshops: Workshop[];
  workshops: Workshop[] | undefined;
  workshopsLoading: boolean;
  deletedWorkshops: Workshop[] | undefined;
  factories: Factory[] | undefined;
  isAdmin: boolean;
  showDeleted: boolean;
  workshopFilterFactory: string;
  setWorkshopFilterFactory: Dispatch<SetStateAction<string>>;
  workshopDialogOpen: boolean;
  setWorkshopDialogOpen: Dispatch<SetStateAction<boolean>>;
  workshopForm: WorkshopForm;
  setWorkshopForm: Dispatch<SetStateAction<WorkshopForm>>;
  createWorkshopMutation: ReturnType<typeof trpc.workshop.create.useMutation>;
  importWorkshopsMutation: ReturnType<typeof trpc.import.importWorkshops.useMutation>;
  exportWorkshopsMutation: ReturnType<typeof trpc.export.exportWorkshops.useMutation>;
  refetchWorkshops: () => void;
  handleEditWorkshop: (workshop: Workshop) => void;
  setWorkshopToDelete: Dispatch<SetStateAction<Workshop | null>>;
  restoreWorkshopMutation: ReturnType<typeof trpc.workshop.restore.useMutation>;
}

export function WorkshopsTab({
  filteredWorkshops,
  workshops,
  workshopsLoading,
  deletedWorkshops,
  factories,
  isAdmin,
  showDeleted,
  workshopFilterFactory,
  setWorkshopFilterFactory,
  workshopDialogOpen,
  setWorkshopDialogOpen,
  workshopForm,
  setWorkshopForm,
  createWorkshopMutation,
  importWorkshopsMutation,
  exportWorkshopsMutation,
  refetchWorkshops,
  handleEditWorkshop,
  setWorkshopToDelete,
  restoreWorkshopMutation,
}: WorkshopsTabProps) {
  const { t } = useTranslation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.workshopList")}</CardTitle>
                    <CardDescription>{t("settings.workshopCount", { count: filteredWorkshops.length })} {workshopFilterFactory !== "all" && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType={t("workshopsTab.phanXuong", "phân xưởng")}
                    templateData={[{ factoryCode: "F001", code: "W001", name: "Workshop 1", description: "", isActive: true }]}
                    templateFilename="workshops_template.xlsx"
                    onImport={async (data, replaceIfExists) => importWorkshopsMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportWorkshopsMutation.mutateAsync()}
                    onImportComplete={() => refetchWorkshops()}
                  />
                  <Dialog open={workshopDialogOpen} onOpenChange={setWorkshopDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addWorkshop")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addWorkshopNew")}</DialogTitle>
                        <DialogDescription className="sr-only">{t("settings.addWorkshopNew")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={workshopForm.factoryId} onValueChange={(v) => setWorkshopForm({ ...workshopForm, factoryId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.selectFactory")} /></SelectTrigger>
                            <SelectContent>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.workshopCode")} *</label>
                          <Input
                            placeholder={t("settings.workshopCodePlaceholder")}
                            value={workshopForm.code}
                            onChange={(e) => setWorkshopForm({ ...workshopForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.workshopName")} *</label>
                          <Input
                            placeholder={t("settings.workshopNamePlaceholder")}
                            value={workshopForm.name}
                            onChange={(e) => setWorkshopForm({ ...workshopForm, name: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setWorkshopDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createWorkshopMutation.mutate({ ...workshopForm, factoryId: parseInt(workshopForm.factoryId) })}
                          disabled={createWorkshopMutation.isPending}
                        >
                          {createWorkshopMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <DataTable<Workshop>
                  data={filteredWorkshops}
                  getRowId={(w) => w.id}
                  loading={workshopsLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchWorkshopPlaceholder")}
                  toolbar={
                    <Select value={workshopFilterFactory} onValueChange={setWorkshopFilterFactory}>
                      <SelectTrigger className="w-52 h-9">
                        <SelectValue placeholder={t("dataSettings.filterByFactory")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")} {t("dashboard.factory").toLowerCase()}</SelectItem>
                        {factories?.map((f) => (
                          <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  emptyState={(workshops?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Warehouse}
                      title={t("settings.noWorkshop")}
                      description={t("dataSettings.emptyWorkshopDesc", "Chưa có phân xưởng nào. Thêm phân xưởng để tổ chức nhà máy.")}
                      actionLabel={t("settings.addWorkshop")}
                      onAction={() => setWorkshopDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.workshopName"), cell: (w) => <span className="font-medium text-foreground">{w.name}</span>, sortValue: (w) => w.name, filterValue: (w) => w.name },
                    { id: "code", header: t("settings.workshopCode"), width: "160px", cell: (w) => <span className="font-mono text-sm text-muted-foreground">{w.code}</span>, sortValue: (w) => w.code, filterValue: (w) => w.code },
                    { id: "factory", header: t("dashboard.factory"), cell: (w) => <span className="text-sm text-muted-foreground">{factories?.find(f => f.id === w.factoryId)?.name || t("common.na")}</span>, sortValue: (w) => factories?.find(f => f.id === w.factoryId)?.name || "", filterValue: (w) => factories?.find(f => f.id === w.factoryId)?.name || "" },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (w) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditWorkshop(w)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setWorkshopToDelete(w)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted workshops (admin) */}
                {showDeleted && isAdmin && deletedWorkshops && deletedWorkshops.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
                      <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                    </div>
                    {deletedWorkshops.map((workshop: Workshop) => (
                        <div key={workshop.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Warehouse className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{workshop.name}</p>
                              <p className="text-sm text-muted-foreground">{workshop.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreWorkshopMutation.mutate({ id: workshop.id })}
                            disabled={restoreWorkshopMutation.isPending}
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
