/**
 * doc 47 Đợt 4 (tech-debt) — "Ca làm việc" (Shifts) tab body extracted VERBATIM from
 * DataSettings.tsx. PURE RELOCATION: orchestrator owns all state/queries/mutations and
 * threads them as props (1:1 names). Identical JSX/handlers — no behavior change.
 * The create-shift Dialog moves with the tab body (mirrors the entity tabs); the
 * edit-shift and delete-confirm dialogs stay at the page root, wired to shared state.
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
import { DataTable } from "@/components/DataTable";
import { EmptyState, StatusBadge } from "@/components/patterns";
import { ValidationMessage } from "@/components/ValidationMessage";
import { Plus, Loader2, Clock, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { Factory, ShiftConfig } from "./entityTypes";

type ShiftForm = {
  factoryId: string; name: string; code: string;
  startHour: string; startMinute: string; endHour: string; endMinute: string; orderIndex: string;
};

interface ShiftsTabProps {
  shifts: ShiftConfig[] | undefined;
  shiftsLoading: boolean;
  factories: Factory[] | undefined;
  shiftValidation: ReturnType<typeof useFormValidation<{ code: string; name: string; startHour: string; endHour: string }>>;
  shiftDialogOpen: boolean;
  setShiftDialogOpen: Dispatch<SetStateAction<boolean>>;
  shiftForm: ShiftForm;
  setShiftForm: Dispatch<SetStateAction<ShiftForm>>;
  createShiftMutation: ReturnType<typeof trpc.shiftConfig.create.useMutation>;
  setEditingShift: Dispatch<SetStateAction<ShiftConfig | null>>;
  setEditShiftDialogOpen: Dispatch<SetStateAction<boolean>>;
  setShiftToDelete: Dispatch<SetStateAction<ShiftConfig | null>>;
  setDeleteShiftDialogOpen: Dispatch<SetStateAction<boolean>>;
}

export function ShiftsTab({
  shifts,
  shiftsLoading,
  factories,
  shiftValidation,
  shiftDialogOpen,
  setShiftDialogOpen,
  shiftForm,
  setShiftForm,
  createShiftMutation,
  setEditingShift,
  setEditShiftDialogOpen,
  setShiftToDelete,
  setDeleteShiftDialogOpen,
}: ShiftsTabProps) {
  const { t } = useTranslation();
  return (
    <Card className="glass-card">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>{t("settings.shiftConfig")}</CardTitle>
                    <CardDescription>{t("settings.shiftConfigDesc")}</CardDescription>
                  </div>
                  <Dialog open={shiftDialogOpen} onOpenChange={setShiftDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="gap-2">
                        <Plus className="h-4 w-4" />
                        {t("settings.addShift")}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t("settings.addShiftNew")}</DialogTitle>
                        <DialogDescription>{t("settings.addShiftDesc")}</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.shiftCode")}<span className="text-destructive">*</span></label>
                            <Input
                              placeholder={t("settings.shiftCodePlaceholder")}
                              value={shiftForm.code}
                              onChange={(e) => setShiftForm({ ...shiftForm, code: e.target.value })}
                              onBlur={() => shiftValidation.handleBlur("code", shiftForm.code)}
                              className={shiftValidation.hasError("code") ? "border-destructive" : ""}
                            />
                            <ValidationMessage error={shiftValidation.getFieldError("code")} />
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.shiftName")}<span className="text-destructive">*</span></label>
                            <Input
                              placeholder={t("settings.shiftNamePlaceholder")}
                              value={shiftForm.name}
                              onChange={(e) => setShiftForm({ ...shiftForm, name: e.target.value })}
                              onBlur={() => shiftValidation.handleBlur("name", shiftForm.name)}
                              className={shiftValidation.hasError("name") ? "border-destructive" : ""}
                            />
                            <ValidationMessage error={shiftValidation.getFieldError("name")} />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.factoryOptional")}</label>
                          <Select value={shiftForm.factoryId} onValueChange={(v) => setShiftForm({ ...shiftForm, factoryId: v })}>
                            <SelectTrigger><SelectValue placeholder={t("settings.allFactoriesShift")} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t("settings.allFactoriesShift")}</SelectItem>
                              {factories?.map((f) => (
                                <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.startTime")} *</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                placeholder={t("settings.hourPlaceholder")}
                                value={shiftForm.startHour}
                                onChange={(e) => setShiftForm({ ...shiftForm, startHour: e.target.value })}
                                className="w-20"
                              />
                              <span className="self-center">:</span>
                              <Input
                                type="number"
                                min="0"
                                max="59"
                                placeholder={t("settings.minutePlaceholder")}
                                value={shiftForm.startMinute}
                                onChange={(e) => setShiftForm({ ...shiftForm, startMinute: e.target.value })}
                                className="w-20"
                              />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">{t("settings.endTime")} *</label>
                            <div className="flex gap-2">
                              <Input
                                type="number"
                                min="0"
                                max="23"
                                placeholder={t("settings.hourPlaceholder")}
                                value={shiftForm.endHour}
                                onChange={(e) => setShiftForm({ ...shiftForm, endHour: e.target.value })}
                                className="w-20"
                              />
                              <span className="self-center">:</span>
                              <Input
                                type="number"
                                min="0"
                                max="59"
                                placeholder={t("settings.minutePlaceholder")}
                                value={shiftForm.endMinute}
                                onChange={(e) => setShiftForm({ ...shiftForm, endMinute: e.target.value })}
                                className="w-20"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium">{t("settings.orderDisplay")}</label>
                          <Input
                            type="number"
                            value={shiftForm.orderIndex}
                            onChange={(e) => setShiftForm({ ...shiftForm, orderIndex: e.target.value })}
                            className="w-24"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setShiftDialogOpen(false)}>{t("common.cancel")}</Button>
                        <Button
                          onClick={() => createShiftMutation.mutate({
                            factoryId: shiftForm.factoryId && shiftForm.factoryId !== "all" ? parseInt(shiftForm.factoryId) : undefined,
                            code: shiftForm.code,
                            name: shiftForm.name,
                            startHour: parseInt(shiftForm.startHour),
                            startMinute: parseInt(shiftForm.startMinute),
                            endHour: parseInt(shiftForm.endHour),
                            endMinute: parseInt(shiftForm.endMinute),
                            orderIndex: parseInt(shiftForm.orderIndex),
                          })}
                          disabled={createShiftMutation.isPending || !shiftForm.code || !shiftForm.name}
                        >
                          {createShiftMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                          {t("settings.createShiftBtn")}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                <DataTable<ShiftConfig>
                  data={(shifts ?? []) as ShiftConfig[]}
                  getRowId={(s) => s.id}
                  loading={shiftsLoading}
                  searchable
                  searchPlaceholder={t("dataSettings.searchShiftPlaceholder", "Tìm ca theo tên hoặc mã…")}
                  initialSort={{ columnId: "order", dir: "asc" }}
                  emptyState={(shifts?.length ?? 0) === 0 ? (
                    <EmptyState
                      variant="no-data"
                      icon={Clock}
                      title={t("settings.noShifts")}
                      description={t("dataSettings.emptyShiftDesc", "Chưa có ca làm việc nào. Thêm ca để cấu hình lịch sản xuất.")}
                      actionLabel={t("settings.addShift")}
                      onAction={() => setShiftDialogOpen(true)}
                    />
                  ) : undefined}
                  columns={[
                    { id: "code", header: t("settings.tableCode"), width: "140px", cell: (s) => <span className="font-mono text-sm">{s.code}</span>, sortValue: (s) => s.code, filterValue: (s) => s.code },
                    { id: "name", header: t("settings.tableShiftName"), cell: (s) => <span className="font-medium">{s.name}</span>, sortValue: (s) => s.name, filterValue: (s) => s.name },
                    { id: "factory", header: t("settings.tableFactory"), cell: (s) => s.factoryId
                        ? <span>{factories?.find(f => f.id === s.factoryId)?.name || t('common.na')}</span>
                        : <span className="text-muted-foreground">{t("settings.entireSystem")}</span>,
                      sortValue: (s) => s.factoryId ? (factories?.find(f => f.id === s.factoryId)?.name || "") : "",
                      filterValue: (s) => s.factoryId ? (factories?.find(f => f.id === s.factoryId)?.name || "") : "" },
                    { id: "time", header: t("settings.tableTime"), width: "150px", cell: (s) => (
                      <span className="font-mono tabular-nums">
                        {String(s.startHour).padStart(2, '0')}:{String(s.startMinute).padStart(2, '0')}
                        {' - '}
                        {String(s.endHour).padStart(2, '0')}:{String(s.endMinute).padStart(2, '0')}
                      </span>
                    ), sortValue: (s) => s.startHour * 60 + s.startMinute },
                    { id: "status", header: t("settings.tableStatus"), width: "130px", cell: (s) => (
                      <StatusBadge status={s.isActive ? "active" : "paused"} tone={s.isActive ? "success" : "default"} label={s.isActive ? t('settings.shiftActive') : t('settings.shiftPaused')} />
                    ), sortValue: (s) => s.isActive ? 1 : 0 },
                    { id: "order", header: t("settings.orderDisplay"), align: "right", width: "80px", cell: (s) => <span className="tabular-nums text-sm text-muted-foreground">{s.orderIndex.toLocaleString('vi-VN')}</span>, sortValue: (s) => s.orderIndex },
                    { id: "actions", header: "", align: "right", width: "64px", cell: (s) => (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => {
                            setEditingShift(s);
                            setEditShiftDialogOpen(true);
                          }}>
                            <Pencil className="h-4 w-4 mr-2" />
                            {t("settings.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => {
                              setShiftToDelete(s);
                              setDeleteShiftDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) },
                  ]}
                />
              </CardContent>
            </Card>
  );
}
