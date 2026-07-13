/**
 * doc 47 Đợt 4 (tech-debt) — "Dây chuyền" CRUD tab body extracted VERBATIM from
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
import { GitBranch, Plus, Loader2, Pencil, Trash2, RotateCcw } from "lucide-react";
import type { Factory, Workshop, Line } from "./entityTypes";

type LineForm = { factoryId: string; workshopId: string; code: string; name: string; description: string };

interface LinesTabProps {
  filteredLines: Line[];
  lines: Line[] | undefined;
  linesLoading: boolean;
  deletedLines: Line[] | undefined;
  factories: Factory[] | undefined;
  workshops: Workshop[] | undefined;
  isAdmin: boolean;
  showDeleted: boolean;
  lineFilterWorkshop: string;
  setLineFilterWorkshop: Dispatch<SetStateAction<string>>;
  lineDialogOpen: boolean;
  setLineDialogOpen: Dispatch<SetStateAction<boolean>>;
  lineForm: LineForm;
  setLineForm: Dispatch<SetStateAction<LineForm>>;
  createLineMutation: ReturnType<typeof trpc.line.create.useMutation>;
  importLinesMutation: ReturnType<typeof trpc.import.importLines.useMutation>;
  exportLinesMutation: ReturnType<typeof trpc.export.exportLines.useMutation>;
  refetchLines: () => void;
  handleEditLine: (line: Line) => void;
  setLineToDelete: Dispatch<SetStateAction<Line | null>>;
  restoreLineMutation: ReturnType<typeof trpc.line.restore.useMutation>;
}

export function LinesTab({
  filteredLines,
  lines,
  linesLoading,
  deletedLines,
  factories,
  workshops,
  isAdmin,
  showDeleted,
  lineFilterWorkshop,
  setLineFilterWorkshop,
  lineDialogOpen,
  setLineDialogOpen,
  lineForm,
  setLineForm,
  createLineMutation,
  importLinesMutation,
  exportLinesMutation,
  refetchLines,
  handleEditLine,
  setLineToDelete,
  restoreLineMutation,
}: LinesTabProps) {
  const { t } = useTranslation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.lineList")}</CardTitle>
                    <CardDescription>{t("settings.lineCount", { count: filteredLines.length })} {lineFilterWorkshop !== "all" && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType="dây chuyền"
                    templateData={[{ workshopCode: "W001", code: "L001", name: "Line 1", description: "", capacityPerHour: 100, maxConcurrentOrders: 1, isActive: true }]}
                    templateFilename="lines_template.xlsx"
                    onImport={async (data, replaceIfExists) => importLinesMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportLinesMutation.mutateAsync()}
                    onImportComplete={() => refetchLines()}
                  />
                  <Dialog open={lineDialogOpen} onOpenChange={setLineDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addLine")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addLineNew")}</DialogTitle>
                        <DialogDescription className="sr-only">{t("settings.addLineNew")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={lineForm.factoryId} onValueChange={(v) => setLineForm({ ...lineForm, factoryId: v, workshopId: "" })}>
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
                          <Select value={lineForm.workshopId} onValueChange={(v) => setLineForm({ ...lineForm, workshopId: v })} disabled={!lineForm.factoryId}>
                            <SelectTrigger><SelectValue placeholder={lineForm.factoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.filter(w => String(w.factoryId) === lineForm.factoryId).map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.lineCode")} *</label>
                          <Input
                            placeholder={t("settings.lineCodePlaceholder")}
                            value={lineForm.code}
                            onChange={(e) => setLineForm({ ...lineForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.lineName")} *</label>
                          <Input
                            placeholder={t("settings.lineNamePlaceholder")}
                            value={lineForm.name}
                            onChange={(e) => setLineForm({ ...lineForm, name: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setLineDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createLineMutation.mutate({ code: lineForm.code, name: lineForm.name, description: lineForm.description, workshopId: parseInt(lineForm.workshopId) })}
                          disabled={createLineMutation.isPending}
                        >
                          {createLineMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <DataTable<Line>
                  data={filteredLines}
                  getRowId={(l) => l.id}
                  loading={linesLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchLinePlaceholder")}
                  toolbar={
                    <Select value={lineFilterWorkshop} onValueChange={setLineFilterWorkshop}>
                      <SelectTrigger className="w-52 h-9">
                        <SelectValue placeholder={t("dataSettings.filterByWorkshop")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")} {t("dashboard.workshop").toLowerCase()}</SelectItem>
                        {workshops?.map((w) => (
                          <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  emptyState={(lines?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={GitBranch}
                      title={t("settings.noLine")}
                      description={t("dataSettings.emptyLineDesc", "Chưa có dây chuyền nào. Thêm dây chuyền vào phân xưởng.")}
                      actionLabel={t("settings.addLine")}
                      onAction={() => setLineDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.lineName"), cell: (l) => <span className="font-medium text-foreground">{l.name}</span>, sortValue: (l) => l.name, filterValue: (l) => l.name },
                    { id: "code", header: t("settings.lineCode"), width: "160px", cell: (l) => <span className="font-mono text-sm text-muted-foreground">{l.code}</span>, sortValue: (l) => l.code, filterValue: (l) => l.code },
                    { id: "workshop", header: t("dashboard.workshop"), cell: (l) => <span className="text-sm text-muted-foreground">{workshops?.find(w => w.id === l.workshopId)?.name || t("common.na")}</span>, sortValue: (l) => workshops?.find(w => w.id === l.workshopId)?.name || "", filterValue: (l) => workshops?.find(w => w.id === l.workshopId)?.name || "" },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (l) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditLine(l)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setLineToDelete(l)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted lines (admin) */}
                {showDeleted && isAdmin && deletedLines && deletedLines.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
                      <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                    </div>
                    {deletedLines.map((line: any) => (
                        <div key={line.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <GitBranch className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{line.name}</p>
                              <p className="text-sm text-muted-foreground">{line.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreLineMutation.mutate({ id: line.id })}
                            disabled={restoreLineMutation.isPending}
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
