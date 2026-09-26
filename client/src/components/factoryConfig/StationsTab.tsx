/**
 * doc 47 Đợt 4 (tech-debt) — "Trạm" CRUD tab body extracted VERBATIM from
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
import { Cpu, Plus, Loader2, Pencil, Trash2, RotateCcw } from "lucide-react";
import type { Factory, Workshop, Line, Station } from "./entityTypes";

type StationForm = { factoryId: string; workshopId: string; lineId: string; code: string; name: string; description: string; orderIndex: string };

interface StationsTabProps {
  filteredStations: Station[];
  stations: Station[] | undefined;
  stationsLoading: boolean;
  deletedStations: Station[] | undefined;
  factories: Factory[] | undefined;
  workshops: Workshop[] | undefined;
  lines: Line[] | undefined;
  isAdmin: boolean;
  showDeleted: boolean;
  stationFilterLine: string;
  setStationFilterLine: Dispatch<SetStateAction<string>>;
  stationDialogOpen: boolean;
  setStationDialogOpen: Dispatch<SetStateAction<boolean>>;
  stationForm: StationForm;
  setStationForm: Dispatch<SetStateAction<StationForm>>;
  createStationMutation: ReturnType<typeof trpc.station.create.useMutation>;
  importStationsMutation: ReturnType<typeof trpc.import.importStations.useMutation>;
  exportStationsMutation: ReturnType<typeof trpc.export.exportStations.useMutation>;
  refetchStations: () => void;
  handleEditStation: (station: Station) => void;
  setStationToDelete: Dispatch<SetStateAction<Station | null>>;
  restoreStationMutation: ReturnType<typeof trpc.station.restore.useMutation>;
}

export function StationsTab({
  filteredStations,
  stations,
  stationsLoading,
  deletedStations,
  factories,
  workshops,
  lines,
  isAdmin,
  showDeleted,
  stationFilterLine,
  setStationFilterLine,
  stationDialogOpen,
  setStationDialogOpen,
  stationForm,
  setStationForm,
  createStationMutation,
  importStationsMutation,
  exportStationsMutation,
  refetchStations,
  handleEditStation,
  setStationToDelete,
  restoreStationMutation,
}: StationsTabProps) {
  const { t } = useTranslation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.stationList")}</CardTitle>
                    <CardDescription>{t("settings.stationCount", { count: filteredStations.length })} {stationFilterLine !== "all" && `(${t("common.filtered")})`}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                  <ExcelImportExport
                    entityType={t("stationsTab.tram", "trạm")}
                    templateData={[{ lineCode: "L001", code: "S001", name: "Station 1", description: "", orderIndex: 1, isActive: true }]}
                    templateFilename="stations_template.xlsx"
                    onImport={async (data, replaceIfExists) => importStationsMutation.mutateAsync({ data, replaceIfExists })}
                    onExport={async () => exportStationsMutation.mutateAsync()}
                    onImportComplete={() => refetchStations()}
                  />
                  <Dialog open={stationDialogOpen} onOpenChange={setStationDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addStation")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addStationNew")}</DialogTitle>
                        <DialogDescription className="sr-only">{t("settings.addStationNew")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.factory")} *</label>
                          <Select value={stationForm.factoryId} onValueChange={(v) => setStationForm({ ...stationForm, factoryId: v, workshopId: "", lineId: "" })}>
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
                          <Select value={stationForm.workshopId} onValueChange={(v) => setStationForm({ ...stationForm, workshopId: v, lineId: "" })} disabled={!stationForm.factoryId}>
                            <SelectTrigger><SelectValue placeholder={stationForm.factoryId ? t("settings.selectWorkshop") : t("dataSettings.selectFactoryFirst")} /></SelectTrigger>
                            <SelectContent>
                              {workshops?.filter(w => String(w.factoryId) === stationForm.factoryId).map((w) => (
                                <SelectItem key={w.id} value={String(w.id)}>{w.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("dashboard.line")} *</label>
                          <Select value={stationForm.lineId} onValueChange={(v) => setStationForm({ ...stationForm, lineId: v })} disabled={!stationForm.workshopId}>
                            <SelectTrigger><SelectValue placeholder={stationForm.workshopId ? t("settings.selectLine") : t("dataSettings.selectWorkshopFirst")} /></SelectTrigger>
                            <SelectContent>
                              {lines?.filter(l => String(l.workshopId) === stationForm.workshopId).map((l) => (
                                <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.stationCode")} *</label>
                          <Input
                            placeholder={t("settings.stationCodePlaceholder")}
                            value={stationForm.code}
                            onChange={(e) => setStationForm({ ...stationForm, code: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.stationName")} *</label>
                          <Input
                            placeholder={t("settings.stationNamePlaceholder")}
                            value={stationForm.name}
                            onChange={(e) => setStationForm({ ...stationForm, name: e.target.value })}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.order")}</label>
                          <Input
                            type="number"
                            placeholder="0"
                            value={stationForm.orderIndex}
                            onChange={(e) => setStationForm({ ...stationForm, orderIndex: e.target.value })}
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setStationDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createStationMutation.mutate({
                            code: stationForm.code,
                            name: stationForm.name,
                            description: stationForm.description,
                            lineId: parseInt(stationForm.lineId),
                            orderIndex: parseInt(stationForm.orderIndex)
                          })}
                          disabled={createStationMutation.isPending}
                        >
                          {createStationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("common.createBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <DataTable<Station>
                  data={filteredStations}
                  getRowId={(s) => s.id}
                  loading={stationsLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchStationPlaceholder")}
                  initialSort={{ columnId: "order", dir: "asc" }}
                  toolbar={
                    <Select value={stationFilterLine} onValueChange={setStationFilterLine}>
                      <SelectTrigger className="w-52 h-9">
                        <SelectValue placeholder={t("dataSettings.filterByLine")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t("common.all")} {t("dashboard.line").toLowerCase()}</SelectItem>
                        {lines?.map((l) => (
                          <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  }
                  emptyState={(stations?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Cpu}
                      title={t("settings.noStation")}
                      description={t("dataSettings.emptyStationDesc", "Chưa có trạm nào. Thêm trạm kiểm tra vào dây chuyền.")}
                      actionLabel={t("settings.addStation")}
                      onAction={() => setStationDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "name", header: t("settings.stationName"), cell: (s) => <span className="font-medium text-foreground">{s.name}</span>, sortValue: (s) => s.name, filterValue: (s) => s.name },
                    { id: "code", header: t("settings.stationCode"), width: "160px", cell: (s) => <span className="font-mono text-sm text-muted-foreground">{s.code}</span>, sortValue: (s) => s.code, filterValue: (s) => s.code },
                    { id: "line", header: t("dashboard.line"), cell: (s) => <span className="text-sm text-muted-foreground">{lines?.find(l => l.id === s.lineId)?.name || t("common.na")}</span>, sortValue: (s) => lines?.find(l => l.id === s.lineId)?.name || "", filterValue: (s) => lines?.find(l => l.id === s.lineId)?.name || "" },
                    { id: "order", header: t("settings.order"), align: "right", width: "100px", cell: (s) => <span className="tabular-nums text-sm text-muted-foreground">{s.orderIndex.toLocaleString('vi-VN')}</span>, sortValue: (s) => s.orderIndex },
                    { id: "actions", header: "", align: "right", width: "96px", cell: (s) => (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleEditStation(s)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={() => setStationToDelete(s)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    ) },
                  ]}
                />
                {/* Deleted stations (admin) */}
                {showDeleted && isAdmin && deletedStations && deletedStations.length > 0 && (
                  <div className="space-y-3 mt-4">
                    <div className="border-t pt-3">
                      <p className="text-sm font-medium text-muted-foreground mb-2">{t("settings.deletedItems")}</p>
                    </div>
                    {deletedStations.map((station: any) => (
                        <div key={station.id} className="flex items-center justify-between p-4 rounded-lg bg-secondary/30 opacity-60 border border-dashed border-muted-foreground/30">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                              <Cpu className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium text-muted-foreground line-through">{station.name}</p>
                              <p className="text-sm text-muted-foreground">{station.code}</p>
                            </div>
                            <Badge variant="outline" className="text-destructive border-destructive/50">{t("settings.deleted")}</Badge>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1"
                            onClick={() => restoreStationMutation.mutate({ id: station.id })}
                            disabled={restoreStationMutation.isPending}
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
