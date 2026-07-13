/**
 * doc 47 Đợt 4 (tech-debt) — "Công đoạn" (Stages) tab body extracted VERBATIM from
 * DataSettings.tsx. PURE RELOCATION: orchestrator owns all state/queries/mutations and
 * threads them as props (1:1 names). Identical JSX/handlers — no behavior change.
 * The drag-reorder handlers are inline in the JSX and reference only `draggedStageId` /
 * `setDraggedStageId` / `reorderStageMutation` (all threaded as props), so they move
 * cleanly with the tab body. The create-stage Dialog moves with the body (mirrors the
 * entity tabs); the edit-stage and delete-confirm dialogs stay at the page root, wired
 * to shared state.
 */
import type { Dispatch, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useFormValidation } from "@/hooks/useFormValidation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/patterns";
import { ValidationMessage } from "@/components/ValidationMessage";
import { Plus, Loader2, GitBranch, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Line, Station, LineStage } from "./entityTypes";

type StageForm = {
  lineId: string; code: string; name: string; description: string; orderIndex: string; stationId: string;
};

interface StagesTabProps {
  stages: LineStage[] | undefined;
  stagesLoading: boolean;
  lines: Line[] | undefined;
  stations: Station[] | undefined;
  canManageFactory: boolean;
  stageValidation: ReturnType<typeof useFormValidation<{ lineId: string; code: string; name: string }>>;
  stageDialogOpen: boolean;
  setStageDialogOpen: Dispatch<SetStateAction<boolean>>;
  stageForm: StageForm;
  setStageForm: Dispatch<SetStateAction<StageForm>>;
  createStageMutation: ReturnType<typeof trpc.lineStage.create.useMutation>;
  reorderStageMutation: ReturnType<typeof trpc.lineStage.reorder.useMutation>;
  draggedStageId: number | null;
  setDraggedStageId: Dispatch<SetStateAction<number | null>>;
  setEditingStage: Dispatch<SetStateAction<LineStage | null>>;
  setEditStageDialogOpen: Dispatch<SetStateAction<boolean>>;
  setStageToDelete: Dispatch<SetStateAction<LineStage | null>>;
  setDeleteStageDialogOpen: Dispatch<SetStateAction<boolean>>;
}

export function StagesTab({
  stages,
  stagesLoading,
  lines,
  stations,
  canManageFactory,
  stageValidation,
  stageDialogOpen,
  setStageDialogOpen,
  stageForm,
  setStageForm,
  createStageMutation,
  reorderStageMutation,
  draggedStageId,
  setDraggedStageId,
  setEditingStage,
  setEditStageDialogOpen,
  setStageToDelete,
  setDeleteStageDialogOpen,
}: StagesTabProps) {
  const { t } = useTranslation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.productionStages")}</CardTitle>
                    <CardDescription>{t("settings.stageCount", { count: stages?.length || 0 })}</CardDescription>
                  </div>
                  {canManageFactory && (
                    <Dialog open={stageDialogOpen} onOpenChange={setStageDialogOpen}>
                      <DialogTrigger asChild>
                        <Button className="gap-2">
                          <Plus className="h-4 w-4" />
                          {t("settings.addStage")}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t("settings.addStageNew")}</DialogTitle>
                          <DialogDescription>{t("settings.addStageDesc")}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("dashboard.line")}<span className="text-destructive">*</span></label>
                            <Select value={stageForm.lineId} onValueChange={(v) => {
                              setStageForm({ ...stageForm, lineId: v });
                              stageValidation.validateSingleField("lineId", v);
                            }}>
                              <SelectTrigger className={stageValidation.hasError("lineId") ? "border-destructive" : ""}><SelectValue placeholder={t("settings.selectLine")} /></SelectTrigger>
                              <SelectContent>
                                {lines?.map((line) => (
                                  <SelectItem key={line.id} value={String(line.id)}>{line.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <ValidationMessage error={stageValidation.getFieldError("lineId")} />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.stageCode")}<span className="text-destructive">*</span></label>
                              <Input
                                placeholder={t("settings.stageCodePlaceholder")}
                                value={stageForm.code}
                                onChange={(e) => setStageForm({ ...stageForm, code: e.target.value })}
                                onBlur={() => stageValidation.handleBlur("code", stageForm.code)}
                                className={stageValidation.hasError("code") ? "border-destructive" : ""}
                              />
                              <ValidationMessage error={stageValidation.getFieldError("code")} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.stageName")}<span className="text-destructive">*</span></label>
                              <Input
                                placeholder={t("settings.stageNamePlaceholder")}
                                value={stageForm.name}
                                onChange={(e) => setStageForm({ ...stageForm, name: e.target.value })}
                                onBlur={() => stageValidation.handleBlur("name", stageForm.name)}
                                className={stageValidation.hasError("name") ? "border-destructive" : ""}
                              />
                              <ValidationMessage error={stageValidation.getFieldError("name")} />
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.order")}</label>
                              <Input type="number" value={stageForm.orderIndex} onChange={(e) => setStageForm({ ...stageForm, orderIndex: e.target.value })} />
                            </div>
                            <div className="space-y-2">
                              <label className="text-sm font-medium">{t("settings.linkedStation")}</label>
                              <Select value={stageForm.stationId} onValueChange={(v) => setStageForm({ ...stageForm, stationId: v })}>
                                <SelectTrigger><SelectValue placeholder={t("settings.selectStation2")} /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">{t("settings.noLink")}</SelectItem>
                                  {stations?.filter(s => {
                                    const line = lines?.find(l => l.id === Number(stageForm.lineId));
                                    return line && s.lineId === line.id;
                                  }).map((station) => (
                                    <SelectItem key={station.id} value={String(station.id)}>{station.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("common.description")}</label>
                            <Input placeholder={t("settings.descriptionPlaceholder")} value={stageForm.description} onChange={(e) => setStageForm({ ...stageForm, description: e.target.value })} />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setStageDialogOpen(false)}>{t("common.cancel")}</Button>
                          <Button onClick={() => createStageMutation.mutate({
                            lineId: Number(stageForm.lineId),
                            code: stageForm.code,
                            name: stageForm.name,
                            description: stageForm.description || undefined,
                            orderIndex: Number(stageForm.orderIndex),
                            stationId: stageForm.stationId && stageForm.stationId !== "none" ? Number(stageForm.stationId) : undefined,
                          })} disabled={!stageForm.lineId || !stageForm.code || !stageForm.name || createStageMutation.isPending}>
                            {createStageMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            {t("settings.createStageBtn")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {lines?.map((line) => {
                    const lineStages = stages?.filter(s => s.lineId === line.id).sort((a, b) => a.orderIndex - b.orderIndex) || [];
                    if (lineStages.length === 0) return null;
                    return (
                      <div key={line.id} className="border rounded-lg p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <GitBranch className="h-4 w-4 text-primary" />
                          <span className="font-medium">{line.name}</span>
                          <span className="text-sm text-muted-foreground">({t("settings.stageCountLabel", { count: lineStages.length })})</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {lineStages.map((stage, index) => (
                            <div
                              key={stage.id}
                              draggable
                              onDragStart={() => setDraggedStageId(stage.id)}
                              onDragOver={(e) => e.preventDefault()}
                              onDrop={() => {
                                if (draggedStageId && draggedStageId !== stage.id) {
                                  const newOrder = lineStages.map(s => s.id);
                                  const dragIndex = newOrder.indexOf(draggedStageId);
                                  const dropIndex = newOrder.indexOf(stage.id);
                                  newOrder.splice(dragIndex, 1);
                                  newOrder.splice(dropIndex, 0, draggedStageId);
                                  reorderStageMutation.mutate({ lineId: line.id, stageIds: newOrder });
                                }
                                setDraggedStageId(null);
                              }}
                              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-move transition-all ${
                                draggedStageId === stage.id ? 'opacity-50 border-primary' : 'hover:border-primary/50'
                              }`}
                            >
                              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold">
                                {stage.code}
                              </span>
                              <span className="text-sm">{stage.name}</span>
                              {index < lineStages.length - 1 && (
                                <span className="text-muted-foreground">→</span>
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-6 w-6 ml-1">
                                    <MoreHorizontal className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  <DropdownMenuItem onClick={() => {
                                    setEditingStage(stage);
                                    setEditStageDialogOpen(true);
                                  }}>
                                    <Pencil className="h-4 w-4 mr-2" />
                                    {t("settings.edit")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    className="text-destructive"
                                    onClick={() => {
                                      setStageToDelete(stage);
                                      setDeleteStageDialogOpen(true);
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    {t("common.delete")}
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {stagesLoading && (
                    <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-sm">{t("common.loading", "Đang tải…")}</span>
                    </div>
                  )}
                  {!stagesLoading && (!stages || stages.length === 0) && (
                    <EmptyState
                      variant="no-data"
                      icon={GitBranch}
                      title={t("settings.noStages")}
                      description={t("dataSettings.emptyStageDesc", "Chưa có công đoạn nào. Thêm công đoạn để định nghĩa luồng sản xuất theo dây chuyền.")}
                      actionLabel={canManageFactory ? t("settings.addStage") : undefined}
                      onAction={canManageFactory ? () => setStageDialogOpen(true) : undefined}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
  );
}
