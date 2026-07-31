// Doc 31 MP6 (decision #2) — per-point lighting / illumination recipe editor.
// Manages mp_lighting_profiles rows (multi-shot: light source / color / intensity
// / exposure / gain / angle / filter) for one measurement point. These are
// surfaced to the machine via deltaSyncPoints (point.lighting[]) so an AOI/AVI
// can apply the illumination recipe. Consumes the existing mpLightingProfile
// tRPC router (list/create/update/delete). Machine-side APPLICATION of the
// recipe is vendor-dependent — this wires the authoring + transport.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { toastTrpcError } from "@/lib/trpcErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Lightbulb } from "lucide-react";

interface Props {
  pointDefId: number;
  canEdit?: boolean;
}

const LIGHT_SOURCES = ["ring", "coaxial", "dome", "side_low_angle", "back", "uv", "ir", "multi_spectral", "dark_field"];
const COLORS = ["white", "red", "green", "blue", "rgb", "ir", "uv", "custom"];

export function PointLightingEditor({ pointDefId, canEdit }: Props) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { data: profiles, isLoading } = trpc.mpLightingProfile.listByPoint.useQuery({ pointDefId });

  const [newSource, setNewSource] = useState("ring");
  const [newColor, setNewColor] = useState("white");
  const [newIntensity, setNewIntensity] = useState("100");
  const [newPurpose, setNewPurpose] = useState("");

  const invalidate = () => utils.mpLightingProfile.listByPoint.invalidate({ pointDefId });

  const createMut = trpc.mpLightingProfile.create.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("measurementPointP2.lightingAdded")); },
    onError: (e) => toastTrpcError(e),
  });
  const updateMut = trpc.mpLightingProfile.update.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toastTrpcError(e),
  });
  const deleteMut = trpc.mpLightingProfile.delete.useMutation({
    onSuccess: () => { invalidate(); toast.success(t("measurementPointP2.lightingRemoved")); },
    onError: (e) => toastTrpcError(e),
  });

  const rows = profiles ?? [];

  const addShot = () => {
    const nextShotIndex = rows.length > 0 ? Math.max(...rows.map((r: any) => r.shotIndex)) + 1 : 1;
    createMut.mutate({
      pointDefId,
      shotIndex: nextShotIndex,
      lightSource: newSource as any,
      color: newColor as any,
      intensityPct: Math.max(0, Math.min(100, parseInt(newIntensity, 10) || 100)),
      purpose: newPurpose.trim() || undefined,
    });
  };

  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1 text-sm font-medium">
          <Lightbulb className="h-4 w-4" />
          {t("measurementPointP2.lightingTitle")}
          <Badge variant="secondary" className="ml-1">{rows.length}</Badge>
        </Label>
      </div>
      <p className="text-xs text-muted-foreground">{t("measurementPointP2.lightingHelp")}</p>

      {isLoading && <div className="text-xs text-muted-foreground">…</div>}

      {rows.map((r: any) => (
        <div key={r.id} className="grid grid-cols-12 gap-2 items-end border-t pt-2">
          <div className="col-span-1">
            <Badge variant="outline">#{r.shotIndex}</Badge>
          </div>
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightSource")}</Label>
            <Select value={r.lightSource} onValueChange={(v) => updateMut.mutate({ id: r.id, lightSource: v as any })} disabled={!canEdit}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{LIGHT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightColor")}</Label>
            <Select value={r.color} onValueChange={(v) => updateMut.mutate({ id: r.id, color: v as any })} disabled={!canEdit}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightIntensity")}</Label>
            <Input
              className="h-8"
              type="number"
              defaultValue={r.intensityPct}
              disabled={!canEdit}
              onBlur={(e) => {
                const v = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                if (v !== r.intensityPct) updateMut.mutate({ id: r.id, intensityPct: v });
              }}
            />
          </div>
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightPurpose")}</Label>
            <Input
              className="h-8"
              defaultValue={r.purpose ?? ""}
              disabled={!canEdit}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v !== (r.purpose ?? "")) updateMut.mutate({ id: r.id, purpose: v || undefined });
              }}
            />
          </div>
          <div className="col-span-1">
            {canEdit && (
              <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => deleteMut.mutate({ id: r.id })}>
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            )}
          </div>
        </div>
      ))}

      {canEdit && (
        <div className="grid grid-cols-12 gap-2 items-end border-t pt-2">
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightSource")}</Label>
            <Select value={newSource} onValueChange={setNewSource}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{LIGHT_SOURCES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightColor")}</Label>
            <Select value={newColor} onValueChange={setNewColor}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightIntensity")}</Label>
            <Input className="h-8" type="number" value={newIntensity} onChange={(e) => setNewIntensity(e.target.value)} />
          </div>
          <div className="col-span-3 space-y-1">
            <Label className="text-xs">{t("measurementPointP2.lightPurpose")}</Label>
            <Input className="h-8" value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)} placeholder="presence / solder_height" />
          </div>
          <div className="col-span-2">
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={addShot} disabled={createMut.isPending}>
              <Plus className="h-3 w-3 mr-1" />{t("measurementPointP2.lightingAdd")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default PointLightingEditor;
