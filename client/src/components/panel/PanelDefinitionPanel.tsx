/**
 * W8-B (doc 29 §2 — doc 27 M12b) — Panel N-up definition editor.
 *
 * Mounted from ProductModels.tsx inside a dialog next to the point editor
 * (same integration pattern as ProgramReleasePanel). Lets an engineer describe
 * how a product's PANEL is built: rows×cols quick-generate, per-board offset/
 * rotation/mirror/X-out table and a simple SVG grid preview. The ACTIVE def is
 * what analytics (panel-aware heatmap) and the InspectionDetail "Board i/n"
 * chip resolve against.
 *
 * RBAC: settings_products canCreate/canEdit/canDelete (server re-enforces).
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { toastTrpcError } from "@/lib/trpcErrors";
import { useCanWrite } from "@/components/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Grid3X3, Loader2, Plus, Save, Trash2, Wand2 } from "lucide-react";

interface BoardRow {
  boardIndex: number;
  offsetXMm: number;
  offsetYMm: number;
  rotationDeg: number;
  mirrored: boolean;
  skipped: boolean;
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function PanelDefinitionPanel({ productModelId }: { productModelId: number }) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const { canCreate, canEdit, canDelete } = useCanWrite("settings_products");

  const listQuery = trpc.productPanel.listByProduct.useQuery({ productModelId });
  const defs = listQuery.data ?? [];

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const selected = useMemo(
    () => defs.find((d) => d.id === selectedId) ?? defs[0] ?? null,
    [defs, selectedId],
  );

  // Editable board table (local copy of the selected def's boards).
  const [boards, setBoards] = useState<BoardRow[]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!selected) {
      setBoards([]);
      setDirty(false);
      return;
    }
    setBoards(
      selected.boards.map((b) => ({
        boardIndex: b.boardIndex,
        offsetXMm: num(b.offsetXMm),
        offsetYMm: num(b.offsetYMm),
        rotationDeg: num(b.rotationDeg),
        mirrored: b.mirrored,
        skipped: b.skipped,
      })),
    );
    setDirty(false);
  }, [selected?.id, selected?.boards]);

  // ── Create form ──
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    rows: 2,
    cols: 2,
    panelWidthMm: "",
    panelHeightMm: "",
    boardWidthMm: "",
    boardHeightMm: "",
  });

  const invalidate = () => utils.productPanel.listByProduct.invalidate({ productModelId });
  const onError = (err: { message: string }) => toastTrpcError(err);

  const createMutation = trpc.productPanel.create.useMutation({
    onSuccess: (r) => {
      toast.success(t("panelDef.created"));
      setShowCreate(false);
      setSelectedId(r.id);
      invalidate();
    },
    onError,
  });
  const updateMutation = trpc.productPanel.update.useMutation({
    onSuccess: () => { toast.success(t("panelDef.updated")); invalidate(); },
    onError,
  });
  const removeMutation = trpc.productPanel.remove.useMutation({
    onSuccess: () => { toast.success(t("panelDef.deleted")); setSelectedId(null); invalidate(); },
    onError,
  });
  const saveBoardsMutation = trpc.productPanel.saveBoards.useMutation({
    onSuccess: () => { toast.success(t("panelDef.boardsSaved")); setDirty(false); invalidate(); },
    onError,
  });

  const handleCreate = () => {
    if (!form.code.trim()) {
      toast.error(t("panelDef.codeRequired"));
      return;
    }
    createMutation.mutate({
      productModelId,
      code: form.code.trim(),
      name: form.name.trim() || undefined,
      rows: form.rows,
      cols: form.cols,
      panelWidthMm: form.panelWidthMm ? num(form.panelWidthMm) : undefined,
      panelHeightMm: form.panelHeightMm ? num(form.panelHeightMm) : undefined,
      boardWidthMm: form.boardWidthMm ? num(form.boardWidthMm) : undefined,
      boardHeightMm: form.boardHeightMm ? num(form.boardHeightMm) : undefined,
    });
  };

  const regenerateGrid = () => {
    if (!selected) return;
    const rows = selected.rows;
    const cols = selected.cols;
    const panelW = num(selected.panelWidthMm, 0) || null;
    const panelH = num(selected.panelHeightMm, 0) || null;
    const cellW = num(selected.boardWidthMm, 0) || (panelW != null ? panelW / cols : 0);
    const cellH = num(selected.boardHeightMm, 0) || (panelH != null ? panelH / rows : 0);
    const generated: BoardRow[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        generated.push({
          boardIndex: r * cols + c + 1,
          offsetXMm: Math.round(c * cellW * 1000) / 1000,
          offsetYMm: Math.round(r * cellH * 1000) / 1000,
          rotationDeg: 0,
          mirrored: false,
          skipped: false,
        });
      }
    }
    setBoards(generated);
    setDirty(true);
  };

  const patchBoard = (idx: number, patch: Partial<BoardRow>) => {
    setBoards((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
    setDirty(true);
  };

  // ── SVG preview geometry ──
  const preview = useMemo(() => {
    if (!selected) return null;
    const cols = Math.max(1, selected.cols);
    const rows = Math.max(1, selected.rows);
    const bw = num(selected.boardWidthMm, 0) || (num(selected.panelWidthMm, 0) ? num(selected.panelWidthMm) / cols : 20);
    const bh = num(selected.boardHeightMm, 0) || (num(selected.panelHeightMm, 0) ? num(selected.panelHeightMm) / rows : 15);
    const extentX = Math.max(num(selected.panelWidthMm, 0), ...boards.map((b) => b.offsetXMm + bw), 1);
    const extentY = Math.max(num(selected.panelHeightMm, 0), ...boards.map((b) => b.offsetYMm + bh), 1);
    return { bw, bh, extentX, extentY };
  }, [selected, boards]);

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Def selector + actions */}
      <div className="flex flex-wrap items-center gap-2">
        {defs.map((d) => (
          <Button
            key={d.id}
            size="sm"
            variant={selected?.id === d.id ? "default" : "outline"}
            onClick={() => setSelectedId(d.id)}
            className="gap-1"
          >
            <Grid3X3 className="h-3 w-3" />
            {d.code} · v{d.version}
            {!d.isActive && (
              <Badge variant="outline" className="ml-1 text-[10px]">{t("panelDef.inactive")}</Badge>
            )}
          </Button>
        ))}
        {canCreate && (
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="h-3 w-3" />
            {t("panelDef.newDef")}
          </Button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border p-3 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.code")}</Label>
              <Input value={form.code} placeholder="PNL-2x4-V1" onChange={(e) => setForm({ ...form, code: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.name")}</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.rows")}</Label>
              <Input type="number" min={1} max={64} value={form.rows} onChange={(e) => setForm({ ...form, rows: Math.max(1, num(e.target.value, 1)) })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.cols")}</Label>
              <Input type="number" min={1} max={64} value={form.cols} onChange={(e) => setForm({ ...form, cols: Math.max(1, num(e.target.value, 1)) })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.panelWidthMm")}</Label>
              <Input type="number" step="0.001" value={form.panelWidthMm} onChange={(e) => setForm({ ...form, panelWidthMm: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.panelHeightMm")}</Label>
              <Input type="number" step="0.001" value={form.panelHeightMm} onChange={(e) => setForm({ ...form, panelHeightMm: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.boardWidthMm")}</Label>
              <Input type="number" step="0.001" value={form.boardWidthMm} onChange={(e) => setForm({ ...form, boardWidthMm: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("panelDef.boardHeightMm")}</Label>
              <Input type="number" step="0.001" value={form.boardHeightMm} onChange={(e) => setForm({ ...form, boardHeightMm: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("panelDef.quickGenerateHint")}</p>
          <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending} className="gap-1">
            {createMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
            {t("panelDef.create")}
          </Button>
        </div>
      )}

      {!selected && !showCreate && (
        <p className="text-sm text-muted-foreground py-4">{t("panelDef.empty")}</p>
      )}

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Preview */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {t("panelDef.preview")} — {selected.rows}×{selected.cols} ({t("panelDef.nUp", { count: selected.nUp })})
              </span>
              <div className="flex gap-1">
                {canEdit && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={regenerateGrid}>
                    <Wand2 className="h-3 w-3" />
                    {t("panelDef.regenerate")}
                  </Button>
                )}
                {canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMutation.mutate({ id: selected.id, isActive: !selected.isActive })
                    }
                  >
                    {selected.isActive ? t("panelDef.deactivate") : t("panelDef.activate")}
                  </Button>
                )}
                {canDelete && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive gap-1"
                    onClick={() => removeMutation.mutate({ id: selected.id })}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            {preview && (
              <svg
                viewBox={`-2 -2 ${preview.extentX + 4} ${preview.extentY + 4}`}
                className="w-full max-h-72 border rounded bg-muted/30"
                preserveAspectRatio="xMidYMid meet"
              >
                {/* Panel outline */}
                <rect
                  x={0} y={0}
                  width={num(selected.panelWidthMm, 0) || preview.extentX}
                  height={num(selected.panelHeightMm, 0) || preview.extentY}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={Math.max(preview.extentX, preview.extentY) / 300}
                  className="text-muted-foreground"
                />
                {boards.map((b, i) => (
                  <g
                    key={i}
                    transform={`rotate(${b.rotationDeg} ${b.offsetXMm} ${b.offsetYMm})`}
                  >
                    <rect
                      x={b.offsetXMm}
                      y={b.offsetYMm}
                      width={preview.bw}
                      height={preview.bh}
                      className={b.skipped ? "fill-destructive/15 text-destructive" : "fill-primary/15 text-primary"}
                      stroke="currentColor"
                      strokeWidth={Math.max(preview.extentX, preview.extentY) / 400}
                    />
                    {b.skipped && (
                      <>
                        <line x1={b.offsetXMm} y1={b.offsetYMm} x2={b.offsetXMm + preview.bw} y2={b.offsetYMm + preview.bh} stroke="currentColor" strokeWidth={Math.max(preview.extentX, preview.extentY) / 400} className="text-destructive" />
                        <line x1={b.offsetXMm + preview.bw} y1={b.offsetYMm} x2={b.offsetXMm} y2={b.offsetYMm + preview.bh} stroke="currentColor" strokeWidth={Math.max(preview.extentX, preview.extentY) / 400} className="text-destructive" />
                      </>
                    )}
                    <text
                      x={b.offsetXMm + preview.bw / 2}
                      y={b.offsetYMm + preview.bh / 2}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={Math.min(preview.bw, preview.bh) / 2.5}
                      className="fill-foreground"
                    >
                      {b.boardIndex}{b.mirrored ? "ᴹ" : ""}
                    </text>
                  </g>
                ))}
              </svg>
            )}
            <p className="text-[11px] text-muted-foreground">{t("panelDef.previewHint")}</p>
          </div>

          {/* Board offset table */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("panelDef.boardTable")}</span>
              {canEdit && (
                <Button
                  size="sm"
                  className="gap-1"
                  disabled={!dirty || saveBoardsMutation.isPending}
                  onClick={() =>
                    saveBoardsMutation.mutate({ panelDefId: selected.id, boards })
                  }
                >
                  {saveBoardsMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  {t("common.save")}
                </Button>
              )}
            </div>
            <ScrollArea className="h-72">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="p-1">#</th>
                    <th className="p-1">X (mm)</th>
                    <th className="p-1">Y (mm)</th>
                    <th className="p-1">{t("panelDef.rotation")}</th>
                    <th className="p-1">{t("panelDef.mirrored")}</th>
                    <th className="p-1">{t("panelDef.xOut")}</th>
                  </tr>
                </thead>
                <tbody>
                  {boards.map((b, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-1 font-medium">{b.boardIndex}</td>
                      <td className="p-1">
                        <Input className="h-7 w-20 text-xs" type="number" step="0.001" value={b.offsetXMm} disabled={!canEdit}
                          onChange={(e) => patchBoard(i, { offsetXMm: num(e.target.value) })} />
                      </td>
                      <td className="p-1">
                        <Input className="h-7 w-20 text-xs" type="number" step="0.001" value={b.offsetYMm} disabled={!canEdit}
                          onChange={(e) => patchBoard(i, { offsetYMm: num(e.target.value) })} />
                      </td>
                      <td className="p-1">
                        <Input className="h-7 w-16 text-xs" type="number" step="90" value={b.rotationDeg} disabled={!canEdit}
                          onChange={(e) => patchBoard(i, { rotationDeg: num(e.target.value) })} />
                      </td>
                      <td className="p-1 text-center">
                        <Checkbox checked={b.mirrored} disabled={!canEdit}
                          onCheckedChange={(v) => patchBoard(i, { mirrored: v === true })} />
                      </td>
                      <td className="p-1 text-center">
                        <Checkbox checked={b.skipped} disabled={!canEdit}
                          onCheckedChange={(v) => patchBoard(i, { skipped: v === true })} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

export default PanelDefinitionPanel;
