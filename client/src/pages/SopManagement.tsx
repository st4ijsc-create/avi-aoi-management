/**
 * doc 44 W6-1 (G5.14) — QUẢN TRỊ e-SOP (SYNAPSE LDS-L5 §6.2).
 *
 * Kỹ sư/quản trị soạn SOP: list theo code+version+status, tạo/sửa bước (text +
 * media + checklist bắt buộc requires_confirm + expected_input), kích hoạt (active
 * tự retire bản cũ cùng code), tạo phiên mới (clone), xoá bản draft.
 *
 * Đọc trpc.sop.*; mutations gate server roleProcedure(admin/supervisor/engineer).
 * Route /sop-management (RouteGuard settings_products). ISA-101 nền trung tính.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ClipboardList, Copy, GripVertical, Loader2, Plus, Power, Trash2, X } from "lucide-react";

import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { navItems } from "@/lib/navigation";
import { buildBreadcrumbs } from "@/lib/breadcrumbs";
import { EmptyState } from "@/components/EmptyState";
import { PageContainer, PageHeader, SectionCard, StatusBadge, EntityPicker, ProductModelSelect, ConfirmDeleteDialog } from "@/components/patterns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const CURRENT_PATH = "/sop-management";

const STATUS_MAP = {
  draft: { tone: "default" as const, label: "Nháp" },
  active: { tone: "success" as const, label: "Hiệu lực" },
  retired: { tone: "warning" as const, label: "Ngừng" },
};

interface StepDraft {
  stepNo: number;
  text: string;
  requiresConfirm: boolean;
  expectedInput: string;
  mediaRef: string;
}

interface SopFormState {
  id: number | null;
  code: string;
  title: string;
  description: string;
  productModelId: number | null;
  stationId: number | null;
  steps: StepDraft[];
}

const emptyForm = (): SopFormState => ({
  id: null,
  code: "",
  title: "",
  description: "",
  productModelId: null,
  stationId: null,
  steps: [{ stepNo: 1, text: "", requiresConfirm: false, expectedInput: "", mediaRef: "" }],
});

export default function SopManagement() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const crumbs = buildBreadcrumbs(location, t);

  const utils = trpc.useUtils();
  const invalidate = () => void utils.sop.invalidate();

  const listQ = trpc.sop.list.useQuery({});
  const stationsQ = trpc.station.list.useQuery();
  const stationOptions = useMemo(
    () => (stationsQ.data ?? []).map((s: { id: number; code?: string | null; name?: string | null }) => ({
      value: s.id,
      label: s.name ?? s.code ?? `#${s.id}`,
      sublabel: s.code ?? undefined,
    })),
    [stationsQ.data],
  );

  const [form, setForm] = useState<SopFormState | null>(null);

  const createM = trpc.sop.create.useMutation({
    onSuccess: () => { toast.success(t("sop.mgmt.created", "Đã tạo SOP")); setForm(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const updateM = trpc.sop.update.useMutation({
    onSuccess: () => { toast.success(t("sop.mgmt.updated", "Đã cập nhật SOP")); setForm(null); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const statusM = trpc.sop.setStatus.useMutation({
    onSuccess: () => { toast.success(t("sop.mgmt.statusChanged", "Đã đổi trạng thái")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const cloneM = trpc.sop.cloneNewVersion.useMutation({
    onSuccess: () => { toast.success(t("sop.mgmt.cloned", "Đã tạo phiên bản mới (nháp)")); invalidate(); },
    onError: (e) => toast.error(e.message),
  });
  const deleteM = trpc.sop.delete.useMutation({
    onSuccess: (r) => {
      if (r && "ok" in r && !r.ok) {
        toast.error(t(`sop.mgmt.delErr.${r.code}`, r.code ?? "Không xoá được"));
      } else {
        toast.success(t("sop.mgmt.deleted", "Đã xoá SOP nháp"));
      }
      invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const openEdit = async (id: number) => {
    const full = await utils.sop.get.fetch({ id });
    if (!full) return;
    setForm({
      id: full.id,
      code: full.code,
      title: full.title,
      description: full.description ?? "",
      productModelId: full.productModelId ?? null,
      stationId: full.stationId ?? null,
      steps: full.steps.length
        ? full.steps.map((s) => ({
            stepNo: s.stepNo,
            text: s.text,
            requiresConfirm: s.requiresConfirm,
            expectedInput: s.expectedInput ?? "",
            mediaRef: s.mediaRef ?? "",
          }))
        : [{ stepNo: 1, text: "", requiresConfirm: false, expectedInput: "", mediaRef: "" }],
    });
  };

  const submit = () => {
    if (!form) return;
    const steps = form.steps
      .filter((s) => s.text.trim() !== "")
      .map((s, i) => ({
        stepNo: i + 1,
        text: s.text.trim(),
        requiresConfirm: s.requiresConfirm,
        expectedInput: s.expectedInput.trim() || null,
        mediaRef: s.mediaRef.trim() || null,
      }));
    if (form.id == null) {
      if (!form.code.trim() || !form.title.trim()) {
        toast.error(t("sop.mgmt.needCodeTitle", "Nhập mã và tiêu đề SOP"));
        return;
      }
      createM.mutate({
        code: form.code.trim(),
        title: form.title.trim(),
        description: form.description.trim() || null,
        productModelId: form.productModelId,
        stationId: form.stationId,
        steps,
      });
    } else {
      updateM.mutate({
        id: form.id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        productModelId: form.productModelId,
        stationId: form.stationId,
        steps,
      });
    }
  };

  const busy = createM.isPending || updateM.isPending;
  const rows = listQ.data ?? [];

  return (
    <DashboardLayout title={t("sop.mgmt.title", "Quản trị e-SOP")} navItems={navItems} currentPath={CURRENT_PATH}>
      <PageContainer className="space-y-6">
        <PageHeader
          breadcrumbs={crumbs}
          icon={<ClipboardList className="h-6 w-6" />}
          title={t("sop.mgmt.title", "Quản trị e-SOP")}
          description={t("sop.mgmt.subtitle", "Soạn quy trình thao tác chuẩn: bước, checklist bắt buộc, phiên bản, kích hoạt.")}
          actions={
            <Button onClick={() => setForm(emptyForm())}>
              <Plus className="mr-1 h-4 w-4" /> {t("sop.mgmt.new", "SOP mới")}
            </Button>
          }
        />

        {listQ.isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!listQ.isLoading && rows.length === 0 && (
          <EmptyState
            icon={ClipboardList}
            title={t("sop.mgmt.empty", "Chưa có SOP nào")}
            description={t("sop.mgmt.emptyDesc", "Tạo SOP đầu tiên để hướng dẫn thao tác từng bước cho vận hành viên.")}
          />
        )}

        {!listQ.isLoading && rows.length > 0 && (
          <SectionCard title={t("sop.mgmt.listTitle", "Danh sách SOP")}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("sop.mgmt.col.code", "Mã")}</TableHead>
                    <TableHead>{t("sop.mgmt.col.title", "Tiêu đề")}</TableHead>
                    <TableHead className="text-center">{t("sop.mgmt.col.version", "Phiên bản")}</TableHead>
                    <TableHead className="text-center">{t("sop.mgmt.col.steps", "Số bước")}</TableHead>
                    <TableHead>{t("sop.mgmt.col.status", "Trạng thái")}</TableHead>
                    <TableHead className="text-right">{t("sop.mgmt.col.actions", "Thao tác")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id} className="cursor-pointer" onClick={() => openEdit(r.id)}>
                      <TableCell className="font-mono text-xs">{r.code}</TableCell>
                      <TableCell className="font-medium">{r.title}</TableCell>
                      <TableCell className="text-center tabular-nums">v{r.version}</TableCell>
                      <TableCell className="text-center tabular-nums">{r.stepCount}</TableCell>
                      <TableCell>
                        <StatusBadge status={r.status} tone={STATUS_MAP[r.status as keyof typeof STATUS_MAP]?.tone} label={t(`sop.status.${r.status}`, STATUS_MAP[r.status as keyof typeof STATUS_MAP]?.label ?? r.status)} />
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          {r.status !== "active" && (
                            <Button size="sm" variant="outline" title={t("sop.mgmt.activate", "Kích hoạt")}
                              onClick={() => statusM.mutate({ id: r.id, status: "active" })}>
                              <Power className="h-4 w-4" />
                            </Button>
                          )}
                          {r.status === "active" && (
                            <Button size="sm" variant="outline" title={t("sop.mgmt.retire", "Ngừng hiệu lực")}
                              onClick={() => statusM.mutate({ id: r.id, status: "retired" })}>
                              <Power className="h-4 w-4 text-warning" />
                            </Button>
                          )}
                          <Button size="sm" variant="outline" title={t("sop.mgmt.clone", "Tạo phiên bản mới")}
                            onClick={() => cloneM.mutate({ sopId: r.id })}>
                            <Copy className="h-4 w-4" />
                          </Button>
                          {r.status === "draft" && (
                            <ConfirmDeleteDialog
                              trigger={
                                <Button size="sm" variant="outline" title={t("sop.mgmt.delete", "Xoá (nháp)")}>
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              }
                              itemLabel={`${t("sop.mgmt.entityLabel", "SOP")} ${r.code}`}
                              onConfirm={async () => { await deleteM.mutateAsync({ id: r.id }); }}
                            />
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </SectionCard>
        )}
      </PageContainer>

      {/* ── Dialog tạo/sửa SOP ─────────────────────────────────────────────────── */}
      <Dialog open={form != null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form?.id == null ? t("sop.mgmt.new", "SOP mới") : t("sop.mgmt.edit", "Sửa SOP")}
            </DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("sop.mgmt.field.code", "Mã SOP")}</Label>
                  <Input
                    value={form.code}
                    disabled={form.id != null}
                    onChange={(e) => setForm({ ...form, code: e.target.value })}
                    placeholder="SOP-CHANGEOVER-X"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("sop.mgmt.field.title", "Tiêu đề")}</Label>
                  <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("sop.mgmt.field.description", "Mô tả")}</Label>
                <Textarea value={form.description} rows={2} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("sop.mgmt.field.product", "Sản phẩm (tuỳ chọn)")}</Label>
                  <ProductModelSelect value={form.productModelId} onChange={(v) => setForm({ ...form, productModelId: v as number | null })} />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("sop.mgmt.field.station", "Trạm (tuỳ chọn)")}</Label>
                  <EntityPicker
                    options={stationOptions}
                    value={form.stationId}
                    onChange={(v) => setForm({ ...form, stationId: v as number | null })}
                    placeholder={t("sop.mgmt.field.stationPh", "Chọn trạm…")}
                  />
                </div>
              </div>

              {/* Bước SOP */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>{t("sop.mgmt.field.steps", "Các bước")}</Label>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setForm({
                        ...form,
                        steps: [...form.steps, { stepNo: form.steps.length + 1, text: "", requiresConfirm: false, expectedInput: "", mediaRef: "" }],
                      })
                    }
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> {t("sop.mgmt.addStep", "Thêm bước")}
                  </Button>
                </div>
                {form.steps.map((s, i) => (
                  <div key={i} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                        <GripVertical className="h-3.5 w-3.5" /> {i + 1}
                      </span>
                      <Textarea
                        value={s.text}
                        rows={2}
                        placeholder={t("sop.mgmt.stepText", "Nội dung bước…")}
                        className="flex-1"
                        onChange={(e) => {
                          const steps = [...form.steps];
                          steps[i] = { ...s, text: e.target.value };
                          setForm({ ...form, steps });
                        }}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}
                        title={t("sop.mgmt.removeStep", "Xoá bước")}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 pl-6">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={s.requiresConfirm}
                          onCheckedChange={(v) => {
                            const steps = [...form.steps];
                            steps[i] = { ...s, requiresConfirm: v };
                            setForm({ ...form, steps });
                          }}
                        />
                        <span className="text-xs">{t("sop.mgmt.requiresConfirm", "Bắt buộc xác nhận")}</span>
                      </div>
                      <Input
                        value={s.expectedInput}
                        placeholder={t("sop.mgmt.expectedInput", "Giá trị mong đợi (scan jig/vật tư)")}
                        disabled={!s.requiresConfirm}
                        onChange={(e) => {
                          const steps = [...form.steps];
                          steps[i] = { ...s, expectedInput: e.target.value };
                          setForm({ ...form, steps });
                        }}
                      />
                      <Input
                        value={s.mediaRef}
                        placeholder={t("sop.mgmt.mediaRef", "Đường dẫn ảnh/video (tuỳ chọn)")}
                        className="sm:col-span-2"
                        onChange={(e) => {
                          const steps = [...form.steps];
                          steps[i] = { ...s, mediaRef: e.target.value };
                          setForm({ ...form, steps });
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>{t("common.cancel", "Huỷ")}</Button>
            <Button onClick={submit} disabled={busy}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("common.save", "Lưu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
