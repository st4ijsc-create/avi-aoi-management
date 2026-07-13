/**
 * doc 47 Đợt 4 (tech-debt) — "Nhà máy" CRUD tab body extracted VERBATIM from
 * DataSettings.tsx. PURE RELOCATION: the orchestrator still owns every piece of
 * state / query / mutation and threads them in as props (1:1 names). Identical JSX,
 * identical handlers — no behavior change.
 */
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/patterns";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ExcelImportExport } from "@/components/ExcelImportExport";
import { Building2, Plus, Loader2, Pencil, Trash2, RotateCcw, Eye } from "lucide-react";
import type { Factory } from "./entityTypes";

type FactoryForm = { code: string; name: string; description: string; address: string };

interface FactoriesTabProps {
  filteredFactories: Factory[];
  factories: Factory[] | undefined;
  factoriesLoading: boolean;
  deletedFactories: Factory[] | undefined;
  isAdmin: boolean;
  showDeleted: boolean;
  setShowDeleted: Dispatch<SetStateAction<boolean>>;
  factoryDialogOpen: boolean;
  setFactoryDialogOpen: Dispatch<SetStateAction<boolean>>;
  factoryForm: FactoryForm;
  setFactoryForm: Dispatch<SetStateAction<FactoryForm>>;
  createFactoryMutation: ReturnType<typeof trpc.factory.create.useMutation>;
  importFactoriesMutation: ReturnType<typeof trpc.import.importFactories.useMutation>;
  exportFactoriesMutation: ReturnType<typeof trpc.export.exportFactories.useMutation>;
  refetchFactories: () => void;
  handleEditFactory: (factory: Factory) => void;
  setFactoryToDelete: Dispatch<SetStateAction<Factory | null>>;
  restoreFactoryMutation: ReturnType<typeof trpc.factory.restore.useMutation>;
}

export function FactoriesTab({
  filteredFactories,
  factories,
  factoriesLoading,
  deletedFactories,
  isAdmin,
  showDeleted,
  setShowDeleted,
  factoryDialogOpen,
  setFactoryDialogOpen,
  factoryForm,
  setFactoryForm,
  createFactoryMutation,
  importFactoriesMutation,
  exportFactoriesMutation,
  refetchFactories,
  handleEditFactory,
  setFactoryToDelete,
  restoreFactoryMutation,
}: FactoriesTabProps) {
  const { t } = useTranslation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.factoryList")}</CardTitle>
                    <CardDescription>{t("settings.factoryCount", { count: filteredFactories.length })}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="nhà máy"
                    templateData={[{ code: "F001", name: "Factory 1", description: "", address: "", region: "", country: "", isActive: true }]}
                    templateFilename="factories_template.xlsx"
                    onImport={async (data, replaceIfExists) => importFactoriesMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportFactoriesMutation.mutateAsync()}
                    onImportComplete={() => refetchFactories()}
                  />
                  <Dialog open={factoryDialogOpen} onOpenChange={setFactoryDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addFactory")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addFactoryNew")}</DialogTitle>
                        <DialogDescription className="sr-only">{t("settings.addFactoryNew")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.factoryCode")} *</label>
                          <Input
                            placeholder={t("settings.factoryCodePlaceholder")}
                            value={factoryForm.code}
                            onChange={(e) => setFactoryForm({ ...factoryForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.factoryName")} *</label>
                          <Input
                            placeholder={t("settings.factoryNamePlaceholder")}
                            value={factoryForm.name}
                            onChange={(e) => setFactoryForm({ ...factoryForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.address")}</label>
                          <Input
                            placeholder={t("settings.addressPlaceholder")}
                            value={factoryForm.address}
                            onChange={(e) => setFactoryForm({ ...factoryForm, address: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setFactoryDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createFactoryMutation.mutate(factoryForm)}
                          disabled={createFactoryMutation.isPending}
                        >
                          {createFactoryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {isAdmin && (
                  <div className="flex items-center gap-2 mb-4">
                    <Switch id="show-deleted" checked={showDeleted} onCheckedChange={setShowDeleted} />
                    <Label htmlFor="show-deleted" className="text-sm text-muted-foreground flex items-center gap-1">
                      <Eye className="h-4 w-4" />
                      {t("settings.showDeleted")}
                    </Label>
                  </div>
                )}
                <DataTable<Factory>
                  data={filteredFactories}
                  getRowId={(f) => f.id}
                  loading={factoriesLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchFactoryPlaceholder")}
                  emptyState={(factories?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Building2}
                      title={t("settings.noFactory")}
                      description={t("dataSettings.emptyFactoryDesc", "Chưa có nhà máy nào. Tạo nhà máy đầu tiên để bắt đầu.")}
                      actionLabel={t("settings.addFactory")}
                      onAction={() => setFactoryDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.factoryName"), cell: (f) => <span className="font-medium text-foreground">{f.name}</span>, sortValue: (f) => f.name, filterValue: (f) => f.name },
                    { id: "code", header: t("settings.factoryCode"), width: "160px", cell: (f) => <span className="font-mono text-sm text-muted-foreground">{f.code}</span>, sortValue: (f) => f.code, filterValue: (f) => f.code },
                    { id: "address", header: t("settings.address"), cell: (f) => <span className="text-sm text-muted-foreground">{f.address || t("common.na")}</span>, filterValue: (f) => f.address || "" },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (f) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditFactory(f)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setFactoryToDelete(f)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted factories (admin) */}
                {showDeleted && isAdmin && deletedFactories && deletedFactories.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
                      <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                    </div>
                    {deletedFactories.map((factory: Factory) => (
                        <div key={factory.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Building2 className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{factory.name}</p>
                              <p className="text-sm text-muted-foreground">{factory.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreFactoryMutation.mutate({ id: factory.id })}
                            disabled={restoreFactoryMutation.isPending}
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
