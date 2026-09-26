/**
 * Doc 24 / Connectivity — No-code Tag → UNS mapping designer (HighByte-style).
 *
 * Map a raw OT adapter tag → an ISA-95 UNS topic + a Sparkplug metric name, with
 * per-tag CONDITIONING (rename, scale, offset, unit, cast, deadband) — configured
 * here in the UI instead of in code. A LIVE PREVIEW reshapes a sample raw value so
 * you see the resulting UNS topic + transformed value before saving.
 *
 * SAFETY: CONFIG only. This never writes a value to a machine; it reshapes the READ
 * direction (telemetry → UNS). Mappings are consulted at publish time only when the
 * server flag UNS_MAPPING_ENABLED is on (default OFF ⇒ today's normalization).
 *
 * RBAC: module 'machine_control' — create/edit/delete are hidden without the grant.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { usePermissions } from "@/_core/hooks/usePermissions";
import DashboardLayout from "@/components/DashboardLayout";
import { ViewOnlyBadge } from "@/components/PermissionGate";
import { PageHeader, PageContainer } from "@/components/patterns";
import { navItems } from "@/lib/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Share2, Plus, Pencil, Trash2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const CAST_OPTIONS = ["none", "number", "bool", "string"] as const;
type CastOption = (typeof CAST_OPTIONS)[number];

interface MappingForm {
  id?: number;
  tag: string;
  unsTopic: string;
  sparkplugMetric: string;
  rename: string;
  scale: string;
  offset: string;
  unit: string;
  cast: CastOption;
  deadband: string;
  enabled: boolean;
  notes: string;
}

const emptyForm: MappingForm = {
  tag: "", unsTopic: "", sparkplugMetric: "", rename: "", scale: "", offset: "",
  unit: "", cast: "none", deadband: "", enabled: true, notes: "",
};

/** Parse a sample string into a scalar for preview: number → bool → string. */
function parseSample(s: string): number | boolean | string {
  const t = s.trim();
  if (t === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.toLowerCase() === "true") return true;
  if (t.toLowerCase() === "false") return false;
  return s;
}

export function UnsMappingDesignerContent() {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission("machine_control", "canCreate");
  const canEdit = hasPermission("machine_control", "canEdit");
  const canDelete = hasPermission("machine_control", "canDelete");

  const utils = trpc.useUtils();
  const adaptersQuery = trpc.deviceAdapter.list.useQuery();
  const adapters = adaptersQuery.data ?? [];

  const [adapterId, setAdapterId] = useState<number | null>(null);
  const selectedAdapter = useMemo(() => adapters.find((a) => a.id === adapterId) ?? null, [adapters, adapterId]);

  const mappingsQuery = trpc.unsMapping.list.useQuery(
    { adapterId: adapterId ?? 0 },
    { enabled: adapterId != null },
  );
  const tagsQuery = trpc.deviceAdapter.tags.listByAdapter.useQuery(
    { adapterId: adapterId ?? 0 },
    { enabled: adapterId != null },
  );
  const mappings = mappingsQuery.data ?? [];
  const tags = tagsQuery.data ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<MappingForm>(emptyForm);
  const [sample, setSample] = useState("");
  const [toDelete, setToDelete] = useState<{ id: number; tag: string } | null>(null);

  const invalidate = () => { if (adapterId != null) void utils.unsMapping.list.invalidate({ adapterId }); };

  const createMut = trpc.unsMapping.create.useMutation({
    onSuccess: () => { toast.success(t("unsMapping.toast.created", "Đã tạo mapping")); setDialogOpen(false); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const updateMut = trpc.unsMapping.update.useMutation({
    onSuccess: () => { toast.success(t("unsMapping.toast.updated", "Đã cập nhật mapping")); setDialogOpen(false); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const deleteMut = trpc.unsMapping.delete.useMutation({
    onSuccess: () => { toast.success(t("unsMapping.toast.deleted", "Đã xoá mapping")); invalidate(); },
    onError: (e) => toastTrpcError(e),
  });
  const toggleMut = trpc.unsMapping.update.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toastTrpcError(e),
  });

  // Build a transform object from the form (only set fields).
  const buildTransform = (f: MappingForm) => {
    const tr: Record<string, unknown> = {};
    if (f.rename.trim()) tr.rename = f.rename.trim();
    if (f.scale.trim()) tr.scale = Number(f.scale);
    if (f.offset.trim()) tr.offset = Number(f.offset);
    if (f.unit.trim()) tr.unit = f.unit.trim();
    if (f.cast !== "none") tr.cast = f.cast;
    if (f.deadband.trim()) tr.deadband = Number(f.deadband);
    return Object.keys(tr).length ? (tr as any) : null;
  };

  // ── Live preview (pure, server-side) ──
  const previewInput = useMemo(() => {
    if (adapterId == null || !form.tag.trim() || !form.unsTopic.trim() || sample.trim() === "") return null;
    return {
      adapterId,
      tag: form.tag.trim(),
      unsTopic: form.unsTopic.trim(),
      sparkplugMetric: form.sparkplugMetric.trim() || null,
      transform: buildTransform(form),
      rawValue: parseSample(sample),
      adapterCode: selectedAdapter?.code,
      machineId: selectedAdapter?.machineId ?? null,
    };
  }, [adapterId, form, sample, selectedAdapter]);

  const previewQuery = trpc.unsMapping.preview.useQuery(previewInput as NonNullable<typeof previewInput>, {
    enabled: dialogOpen && previewInput != null,
  });
  const preview = previewQuery.data;

  const openCreate = () => { setForm(emptyForm); setSample(""); setDialogOpen(true); };
  const openEdit = (m: any) => {
    const tr = (m.transform ?? {}) as Record<string, any>;
    setForm({
      id: m.id,
      tag: m.tag,
      unsTopic: m.unsTopic,
      sparkplugMetric: m.sparkplugMetric ?? "",
      rename: tr.rename ?? "",
      scale: tr.scale != null ? String(tr.scale) : "",
      offset: tr.offset != null ? String(tr.offset) : "",
      unit: tr.unit ?? "",
      cast: (tr.cast as CastOption) ?? "none",
      deadband: tr.deadband != null ? String(tr.deadband) : "",
      enabled: m.enabled,
      notes: m.notes ?? "",
    });
    setSample("");
    setDialogOpen(true);
  };

  const submit = () => {
    if (adapterId == null) return;
    const base = {
      tag: form.tag.trim(),
      unsTopic: form.unsTopic.trim(),
      sparkplugMetric: form.sparkplugMetric.trim() || null,
      transform: buildTransform(form),
      enabled: form.enabled,
      notes: form.notes.trim() || null,
    };
    if (form.id != null) updateMut.mutate({ id: form.id, ...base });
    else createMut.mutate({ adapterId, ...base });
  };

  return (
    <PageContainer>
      <PageHeader
        icon={<Share2 className="h-6 w-6" />}
        title={t("unsMapping.title", "Tag → UNS Mapping")}
        badge={<ViewOnlyBadge module="machine_control" />}
        description={t(
          "unsMapping.subtitle",
          "Ánh xạ tag OT thô → topic UNS (ISA-95) + metric Sparkplug, kèm điều kiện (đổi tên, scale/offset, đơn vị, ép kiểu, deadband). Cấu hình không cần code. Chỉ ảnh hưởng chiều ĐỌC (telemetry → UNS); áp dụng khi cờ UNS_MAPPING_ENABLED bật.",
        )}
        actions={
          canCreate && adapterId != null ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> {t("unsMapping.add", "Thêm mapping")}
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader><CardTitle>{t("unsMapping.selectAdapter", "Chọn adapter")}</CardTitle></CardHeader>
        <CardContent>
          <div className="max-w-md">
            <Select
              value={adapterId != null ? String(adapterId) : ""}
              onValueChange={(v) => setAdapterId(Number(v))}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("unsMapping.selectAdapterPlaceholder", "— chọn adapter OT —")} />
              </SelectTrigger>
              <SelectContent>
                {adapters.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>{a.code} · {a.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {adapters.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("unsMapping.noAdapters", "Chưa có adapter OT. Tạo adapter ở trang Device Adapter trước.")}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {adapterId != null && (
        <Card>
          <CardHeader>
            <CardTitle>{t("unsMapping.mappingsTitle", "Mapping")} ({mappings.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("unsMapping.col.tag", "Tag nguồn")}</TableHead>
                  <TableHead>{t("unsMapping.col.topic", "UNS topic")}</TableHead>
                  <TableHead>{t("unsMapping.col.metric", "Sparkplug metric")}</TableHead>
                  <TableHead>{t("unsMapping.col.transform", "Điều kiện")}</TableHead>
                  <TableHead>{t("unsMapping.col.enabled", "Bật")}</TableHead>
                  <TableHead className="text-right">{t("common.actions", "Thao tác")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mappings.length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">{t("unsMapping.empty", "Chưa có mapping cho adapter này.")}</TableCell></TableRow>
                )}
                {mappings.map((m) => {
                  const tr = (m.transform ?? {}) as Record<string, any>;
                  const chips: string[] = [];
                  if (tr.rename) chips.push(`rename→${tr.rename}`);
                  if (tr.scale != null) chips.push(`×${tr.scale}`);
                  if (tr.offset != null) chips.push(`+${tr.offset}`);
                  if (tr.cast) chips.push(tr.cast);
                  if (tr.unit) chips.push(tr.unit);
                  if (tr.deadband != null) chips.push(`db ${tr.deadband}`);
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.tag}</TableCell>
                      <TableCell className="max-w-[240px] truncate font-mono text-xs" title={m.unsTopic}>{m.unsTopic}</TableCell>
                      <TableCell className="font-mono text-xs">{m.sparkplugMetric || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {chips.length === 0 && <span className="text-muted-foreground text-xs">{t("unsMapping.passthrough", "pass-through")}</span>}
                          {chips.map((c) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={m.enabled}
                          disabled={!canEdit || toggleMut.isPending}
                          onCheckedChange={(v) => toggleMut.mutate({ id: m.id, enabled: v })}
                        />
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        {canEdit && (
                          <Button size="sm" variant="outline" onClick={() => openEdit(m)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="destructive" disabled={deleteMut.isPending}
                            onClick={() => setToDelete({ id: m.id, tag: m.tag })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Mapping create/edit dialog with live preview ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id != null ? t("unsMapping.edit", "Sửa mapping") : t("unsMapping.add", "Thêm mapping")}</DialogTitle>
            <DialogDescription>
              {t("unsMapping.dialogDesc", "Ánh xạ tag → UNS topic + metric, kèm điều kiện. Xem trước kết quả với một giá trị mẫu.")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: mapping fields */}
            <div className="space-y-3">
              <div>
                <Label>{t("unsMapping.col.tag", "Tag nguồn")}</Label>
                {tags.length > 0 ? (
                  <Select value={form.tag} onValueChange={(v) => setForm({ ...form, tag: v })}>
                    <SelectTrigger><SelectValue placeholder={t("unsMapping.pickTag", "— chọn tag —")} /></SelectTrigger>
                    <SelectContent>
                      {tags.map((tg) => <SelectItem key={tg.id} value={tg.tagKey}>{tg.tagKey} ({tg.dataType})</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} placeholder="temperature" />
                )}
              </div>
              <div>
                <Label>{t("unsMapping.col.topic", "UNS topic (ISA-95)")}</Label>
                <Input value={form.unsTopic} className="font-mono text-xs"
                  placeholder="{enterprise}/{adapterCode}/{tag}"
                  onChange={(e) => setForm({ ...form, unsTopic: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">{t("unsMapping.topicHint", "Placeholder: {enterprise} {adapterCode} {tag} {rename} {machineId}")}</p>
              </div>
              <div>
                <Label>{t("unsMapping.col.metric", "Sparkplug metric")}</Label>
                <Input value={form.sparkplugMetric} className="font-mono text-xs"
                  placeholder={t("unsMapping.metricPlaceholder", "(mặc định = rename hoặc tag)")}
                  onChange={(e) => setForm({ ...form, sparkplugMetric: e.target.value })} />
              </div>

              <div className="border-t pt-3 font-medium text-sm">{t("unsMapping.conditioning", "Điều kiện (transform)")}</div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>{t("unsMapping.tr.rename", "Đổi tên")}</Label>
                  <Input value={form.rename} onChange={(e) => setForm({ ...form, rename: e.target.value })} />
                </div>
                <div>
                  <Label>{t("unsMapping.tr.unit", "Đơn vị")}</Label>
                  <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="°C" />
                </div>
                <div>
                  <Label>{t("unsMapping.tr.scale", "Scale (×)")}</Label>
                  <Input value={form.scale} inputMode="decimal" onChange={(e) => setForm({ ...form, scale: e.target.value })} placeholder="1" />
                </div>
                <div>
                  <Label>{t("unsMapping.tr.offset", "Offset (+)")}</Label>
                  <Input value={form.offset} inputMode="decimal" onChange={(e) => setForm({ ...form, offset: e.target.value })} placeholder="0" />
                </div>
                <div>
                  <Label>{t("unsMapping.tr.cast", "Ép kiểu")}</Label>
                  <Select value={form.cast} onValueChange={(v) => setForm({ ...form, cast: v as CastOption })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CAST_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("unsMapping.tr.deadband", "Deadband")}</Label>
                  <Input value={form.deadband} inputMode="decimal" onChange={(e) => setForm({ ...form, deadband: e.target.value })} placeholder="0" />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
                <Label>{t("unsMapping.enable", "Bật mapping")}</Label>
              </div>
              <div>
                <Label>{t("unsMapping.notes", "Ghi chú")}</Label>
                <Textarea value={form.notes} rows={2} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>

            {/* Right: live preview */}
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="font-medium text-sm mb-2">{t("unsMapping.preview", "Xem trước (live)")}</div>
                <Label>{t("unsMapping.sampleValue", "Giá trị thô mẫu")}</Label>
                <Input value={sample} onChange={(e) => setSample(e.target.value)} placeholder="23.7 / true / OK" />
                <p className="mt-1 text-xs text-muted-foreground">{t("unsMapping.sampleHint", "Số / true / false / chuỗi.")}</p>

                {previewInput == null ? (
                  <p className="mt-3 text-sm text-muted-foreground">{t("unsMapping.previewEmpty", "Nhập tag, topic và giá trị mẫu để xem trước.")}</p>
                ) : preview ? (
                  <div className="mt-3 space-y-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">{t("unsMapping.col.topic", "UNS topic")}</div>
                      <code className="block break-all text-xs bg-background rounded px-2 py-1 border">{preview.unsTopic}</code>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("unsMapping.col.metric", "Sparkplug metric")}</div>
                      <code className="text-xs">{preview.sparkplugMetric}</code>
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="text-xs bg-background rounded px-2 py-1 border">{String(parseSample(sample))}</code>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <code className="text-xs bg-background rounded px-2 py-1 border font-medium">
                        {preview.transformedValue === null ? "null" : String(preview.transformedValue)}
                        {preview.unit ? ` ${preview.unit}` : ""}
                      </code>
                    </div>
                    <div>
                      {preview.willPublish
                        ? <Badge variant="outline" className="text-success border-success/40">{t("unsMapping.willPublish", "Sẽ phát")}</Badge>
                        : <Badge variant="outline" className="text-warning border-warning/40">{t("unsMapping.suppressed", "Bị deadband chặn")}</Badge>}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">{t("common.loading", "Đang tải...")}</p>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>{t("common.cancel", "Huỷ")}</Button>
            <Button onClick={submit}
              disabled={createMut.isPending || updateMut.isPending || !form.tag.trim() || !form.unsTopic.trim()}>
              {t("common.save", "Lưu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog open={toDelete != null} onOpenChange={(o) => { if (!o) setToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("unsMapping.deleteTitle", "Xoá mapping?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("unsMapping.deleteDesc", "Xoá mapping cho tag \"{{tag}}\"? Hành động này không thể hoàn tác.", { tag: toDelete?.tag ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel", "Huỷ")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (toDelete) deleteMut.mutate({ id: toDelete.id }); setToDelete(null); }}
            >
              {t("common.delete", "Xoá")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

export default function UnsMappingDesigner() {
  return (
    <DashboardLayout title="UNS Mapping" navItems={navItems} currentPath="/uns-mapping">
      <UnsMappingDesignerContent />
    </DashboardLayout>
  );
}
