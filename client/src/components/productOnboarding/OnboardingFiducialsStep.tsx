// H3 #3 (doc 42 §10.12 findings #36/#37) — theme-aware, error-surfacing fiducial
// editor for the onboarding wizard's (required) Fiducial step.
//
// Replaces the hand-rolled modal in ProductFiducialsTab, which for the wizard
// rendered a hardcoded `bg-white` panel → white-on-white on dark theme (#36),
// and whose create/update mutations had NO onError → an empty save 400'd in
// total silence (#37). This version:
//   • uses the shared <Dialog> primitive (bg-background, a11y, ESC/overlay),
//   • validates code+name client-side (server needs both; code matches
//     ^[A-Za-z0-9_-]+$) with inline errors + a disabled Save,
//   • surfaces EVERY mutation failure via toastTrpcError (no silent 400s),
//   • routes delete through the shared <ConfirmDeleteDialog> (no native confirm).
// It reuses the exact same trpc.fiducialMark.* procedures + measurementPointP1
// i18n namespace, so behaviour/counts stay identical to the shared tab.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDeleteDialog } from "@/components/patterns";
import { Pencil, Plus, Trash2 } from "lucide-react";

type FiducialType = "cross" | "circle" | "square" | "custom";
const FIDUCIAL_TYPES: FiducialType[] = ["cross", "circle", "square", "custom"];

/** Server contract: code min 1, ^[A-Za-z0-9_-]+$; name min 1. */
const CODE_RE = /^[A-Za-z0-9_-]+$/;

interface Props {
  productModelId: number;
}

interface EditState {
  id?: number;
  code: string;
  name: string;
  type: FiducialType;
  positionX: number;
  positionY: number;
  searchWindowW: number;
  searchWindowH: number;
  orderIndex: number;
}

const blankEdit = (): EditState => ({
  code: "",
  name: "",
  type: "cross",
  positionX: 0,
  positionY: 0,
  searchWindowW: 64,
  searchWindowH: 64,
  orderIndex: 0,
});

export function OnboardingFiducialsStep({ productModelId }: Props) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<EditState | null>(null);
  const [showDialog, setShowDialog] = useState(false);

  const utils = trpc.useUtils();
  const { data: fiducials, isLoading } = trpc.fiducialMark.listByProductModel.useQuery({
    productModelId,
  });

  const refetch = () => utils.fiducialMark.listByProductModel.invalidate({ productModelId });
  const closeDialog = () => {
    setShowDialog(false);
    setEditing(null);
  };

  const createMut = trpc.fiducialMark.create.useMutation({
    onSuccess: () => {
      toast.success(t("measurementPointP1.fiducial.saved", "Đã lưu điểm chuẩn"));
      refetch();
      closeDialog();
    },
    onError: (e) => toastTrpcError(e), // #37 — no more silent 400 on empty save
  });
  const updateMut = trpc.fiducialMark.update.useMutation({
    onSuccess: () => {
      toast.success(t("measurementPointP1.fiducial.saved", "Đã lưu điểm chuẩn"));
      refetch();
      closeDialog();
    },
    onError: (e) => toastTrpcError(e),
  });
  const deleteMut = trpc.fiducialMark.delete.useMutation({
    onSuccess: () => {
      toast.success(t("measurementPointP1.fiducial.deleted", "Đã xóa điểm chuẩn"));
      refetch();
    },
    onError: (e) => toastTrpcError(e),
  });

  // ── Client-side validation mirroring the server contract ──────────────────
  const codeError = useMemo(() => {
    if (!editing) return null;
    const c = editing.code.trim();
    if (!c) return t("measurementPointP1.fiducial.codeRequired", "Mã là bắt buộc");
    if (!CODE_RE.test(c))
      return t(
        "measurementPointP1.fiducial.codeInvalid",
        "Mã chỉ gồm chữ, số, gạch dưới, gạch ngang",
      );
    return null;
  }, [editing, t]);
  const nameError = useMemo(() => {
    if (!editing) return null;
    return editing.name.trim()
      ? null
      : t("measurementPointP1.fiducial.nameRequired", "Tên là bắt buộc");
  }, [editing, t]);
  const canSave = !codeError && !nameError;

  const onSave = () => {
    if (!editing || !canSave) return;
    const payload = {
      code: editing.code.trim(),
      name: editing.name.trim(),
      type: editing.type,
      positionX: editing.positionX,
      positionY: editing.positionY,
      searchWindowW: editing.searchWindowW,
      searchWindowH: editing.searchWindowH,
      orderIndex: editing.orderIndex,
    };
    if (editing.id) updateMut.mutate({ id: editing.id, ...payload });
    else createMut.mutate({ productModelId, ...payload });
  };

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t("measurementPointP1.fiducial.title")}</h3>
        <Button
          size="sm"
          className="gap-1"
          onClick={() => {
            setEditing(blankEdit());
            setShowDialog(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {t("measurementPointP1.fiducial.addButton")}
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">…</div>
      ) : !fiducials || fiducials.length === 0 ? (
        <div className="text-sm text-muted-foreground italic">
          {t("measurementPointP1.fiducial.empty")}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border rounded">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.code")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.name")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.type")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.position")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.searchWindow")}</th>
                <th className="px-3 py-2 text-left">{t("measurementPointP1.fiducial.orderIndex")}</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {fiducials.map((f: any) => (
                <tr key={f.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{f.code}</td>
                  <td className="px-3 py-2">{f.name}</td>
                  <td className="px-3 py-2">
                    {t(`measurementPointP1.fiducial.types.${f.type as FiducialType}`)}
                  </td>
                  <td className="px-3 py-2">
                    ({f.positionX}, {f.positionY})
                  </td>
                  <td className="px-3 py-2">
                    {f.searchWindowW ?? 64} × {f.searchWindowH ?? 64}
                  </td>
                  <td className="px-3 py-2">{f.orderIndex ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() => {
                          setEditing({
                            id: f.id,
                            code: f.code,
                            name: f.name,
                            type: (f.type as FiducialType) ?? "cross",
                            positionX: f.positionX,
                            positionY: f.positionY,
                            searchWindowW: f.searchWindowW ?? 64,
                            searchWindowH: f.searchWindowH ?? 64,
                            orderIndex: f.orderIndex ?? 0,
                          });
                          setShowDialog(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        {t("measurementPointP1.fiducial.edit")}
                      </Button>
                      <ConfirmDeleteDialog
                        trigger={
                          <Button size="sm" variant="ghost" className="text-destructive gap-1">
                            <Trash2 className="h-3.5 w-3.5" />
                            {t("measurementPointP1.fiducial.delete")}
                          </Button>
                        }
                        itemLabel={t("measurementPointP1.fiducial.itemLabel", {
                          defaultValue: "điểm chuẩn {{code}}",
                          code: f.code,
                        })}
                        onConfirm={async () => {
                          await deleteMut.mutateAsync({ id: f.id });
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* #36 — themed Dialog primitive (bg-background) replaces the bg-white modal. */}
      <Dialog open={showDialog} onOpenChange={(o) => (o ? setShowDialog(true) : closeDialog())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing?.id
                ? t("measurementPointP1.fiducial.edit")
                : t("measurementPointP1.fiducial.addButton")}
            </DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col gap-1">
                <Label>{t("measurementPointP1.fiducial.code")} *</Label>
                <Input
                  value={editing.code}
                  aria-invalid={!!codeError}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                />
                {codeError && <span className="text-xs text-destructive">{codeError}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("measurementPointP1.fiducial.name")} *</Label>
                <Input
                  value={editing.name}
                  aria-invalid={!!nameError}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
                {nameError && <span className="text-xs text-destructive">{nameError}</span>}
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("measurementPointP1.fiducial.type")}</Label>
                <Select
                  value={editing.type}
                  onValueChange={(v) => setEditing({ ...editing, type: v as FiducialType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIDUCIAL_TYPES.map((tp) => (
                      <SelectItem key={tp} value={tp}>
                        {t(`measurementPointP1.fiducial.types.${tp}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <Label>{t("measurementPointP1.fiducial.orderIndex")}</Label>
                <Input
                  type="number"
                  value={editing.orderIndex}
                  onChange={(e) =>
                    setEditing({ ...editing, orderIndex: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>X</Label>
                <Input
                  type="number"
                  value={editing.positionX}
                  onChange={(e) =>
                    setEditing({ ...editing, positionX: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Y</Label>
                <Input
                  type="number"
                  value={editing.positionY}
                  onChange={(e) =>
                    setEditing({ ...editing, positionY: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>W</Label>
                <Input
                  type="number"
                  value={editing.searchWindowW}
                  onChange={(e) =>
                    setEditing({ ...editing, searchWindowW: Number(e.target.value) || 0 })
                  }
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>H</Label>
                <Input
                  type="number"
                  value={editing.searchWindowH}
                  onChange={(e) =>
                    setEditing({ ...editing, searchWindowH: Number(e.target.value) || 0 })
                  }
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              {t("common.cancel", "Hủy")}
            </Button>
            <Button type="button" disabled={saving || !canSave} onClick={onSave}>
              {saving
                ? t("common.saving", "Đang lưu…")
                : t("common.save", "Lưu")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default OnboardingFiducialsStep;
