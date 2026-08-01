/**
 * Doc 24 Tier-1c — CLIENT 3-WAY MERGE + CONFLICT-RESOLUTION panel for the IR editor.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Sibling to IrDiffPanel. Pick a common ANCESTOR (base), an OURS side (a saved version OR
 * the live editor draft) and a THEIRS side (a saved version), then call the read-gated
 * dry-run `ir.merge` procedure. The server auto-merges the non-overlapping edits and
 * returns the merged flow with the true CONFLICTS surfaced (never silently picking a side).
 *
 * This panel renders every conflict inline — its kind + the base / ours / theirs values —
 * with a per-conflict PICK-A-SIDE control (choose ours or theirs; param/add-add conflicts
 * are per-field). Those choices are applied CLIENT-SIDE to the server's ours-provisional
 * `merged` flow to produce a fully-RESOLVED flow:
 *   • param / add-add / meta → the chosen field value overrides the ours-provisional one;
 *   • move                    → the block is re-parented into the chosen side's container;
 *   • modify-delete           → the chosen side's action (keep-modified vs delete) is taken;
 *   • structural              → the un-placeable block is kept at top level (acknowledged).
 *
 * SAVE routes through the EXISTING gated `ir.saveFlow` (DPC_IR_V2_ENABLED + machine_control)
 * — the same append-a-validated-artifact path the editor's Save uses. NOTHING here bypasses
 * that gate: when the flag or permission is off the button is disabled with an explanatory
 * tooltip, and a conflict must be EXPLICITLY picked before Save is enabled (no silent auto-
 * resolution). Semantic tokens only (dark-first). No raw hex / palette classes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useEffect, useMemo, useState } from "react";
import type { TFunction } from "i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { StatusBadge } from "@/components/patterns";
import {
  GitMerge, ArrowLeftRight, Pencil, Trash2, AlertTriangle, Info, GitBranch,
  Loader2, Save, Check, ListTree,
} from "lucide-react";
import type { SavedFlowRow } from "@/components/programming/IrDiffPanel";
import {
  BLOCK_ICON, BLOCK_LABEL, childSlots, getChildren, summarize,
  findBlock, updateBlock, deleteBlock, addChild, cloneBlocks,
  type Flow, type IrBlock, type Slot,
} from "@/components/programming/irTree";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type MergeOutput = RouterOutputs["ir"]["merge"];
type MergeConflict = MergeOutput["conflicts"][number];
type MergeConflictType = MergeConflict["type"];

type Side = "ours" | "theirs";

/** Minimal ir-flow project shape needed to target `saveFlow` (from programming.listProjects). */
export type IrProjectRow = { id: number; code: string; name: string };

const CURRENT = "current"; // sentinel: OURS = the live editor draft

// ── Per-conflict-kind visual metadata (semantic tokens only) ──────────────────
const CONFLICT_META: Record<MergeConflictType, { icon: typeof Pencil; key: string; def: string }> = {
  param: { icon: Pencil, key: "ir.merge.kind.param", def: "Parameter" },
  "add-add": { icon: GitMerge, key: "ir.merge.kind.addAdd", def: "Added on both" },
  move: { icon: ArrowLeftRight, key: "ir.merge.kind.move", def: "Moved" },
  "modify-delete": { icon: Trash2, key: "ir.merge.kind.modifyDelete", def: "Modify vs delete" },
  structural: { icon: AlertTriangle, key: "ir.merge.kind.structural", def: "Structural" },
  meta: { icon: Info, key: "ir.merge.kind.meta", def: "Flow field" },
};

// ── Value formatting ──────────────────────────────────────────────────────────
function formatValue(v: unknown): string {
  if (v === undefined) return "—";
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Position pair as returned by the server for move conflicts. */
type PosPairLike = { parentId: string | null; slot: string };

function posText(v: unknown, t: TFunction): string {
  const p = v as PosPairLike | undefined;
  if (!p || typeof p !== "object") return "—";
  return p.parentId ? `${p.parentId} · ${p.slot}` : t("ir.merge.topLevel", "top level");
}

// ── Pure tree helpers (merge-specific; do not belong in the shared editor helpers) ──
/** Remove a block (with its whole subtree) from the tree; return the rest + the extracted block. */
function extractBlock(blocks: IrBlock[], id: string): { without: IrBlock[]; found: IrBlock | null } {
  let found: IrBlock | null = null;
  const strip = (list: IrBlock[]): IrBlock[] => {
    const out: IrBlock[] = [];
    for (const b of list) {
      if (b.id === id) { found = b; continue; }
      if (b.type === "if_condition") out.push({ ...b, true_branch: strip(b.true_branch), false_branch: strip(b.false_branch) });
      else if (b.type === "loop") out.push({ ...b, body: strip(b.body) });
      else out.push(b);
    }
    return out;
  };
  const without = strip(blocks);
  return { without, found };
}

/** Re-parent a block into `parentId`/`slot`. Falls back to top level if the target parent is gone. */
function reparentBlock(blocks: IrBlock[], id: string, parentId: string | null, slot: string): IrBlock[] {
  const { without, found } = extractBlock(blocks, id);
  if (!found) return blocks;
  if (parentId === null || slot === "root") return [...without, found];
  if (!findBlock(without, parentId)) return [...without, found];
  return addChild(without, parentId, slot as Slot, found);
}

/**
 * Apply the human PICKS to the server's ours-provisional `merged` flow → a fully-resolved
 * flow. "ours" is a no-op (the merged flow already shows ours for every conflict); "theirs"
 * overrides that side. Pure / immutable — starts from a fresh clone of `merged`.
 */
function applyResolutions(
  merged: Flow,
  conflicts: MergeConflict[],
  picks: Record<number, Side>,
  oursFlow: Flow,
  theirsFlow: Flow,
): Flow {
  let flow: Flow = { ...merged, blocks: cloneBlocks(merged.blocks) };

  // Phase 1 — value picks (param / add-add / meta).
  conflicts.forEach((c, i) => {
    if (picks[i] !== "theirs") return;
    if ((c.type === "param" || c.type === "add-add") && c.blockId && c.param) {
      flow = { ...flow, blocks: updateBlock(flow.blocks, c.blockId, { [c.param]: c.theirs } as Partial<IrBlock>) };
    } else if (c.type === "meta" && c.param) {
      flow = { ...flow, [c.param]: c.theirs } as Flow;
    }
  });

  // Phase 2 — move picks (re-parent into theirs' container).
  conflicts.forEach((c, i) => {
    if (c.type !== "move" || picks[i] !== "theirs" || !c.blockId) return;
    const pos = c.theirs as PosPairLike | undefined;
    if (!pos) return;
    flow = { ...flow, blocks: reparentBlock(flow.blocks, c.blockId, pos.parentId, pos.slot) };
  });

  // Phase 3 — modify/delete picks (take the CHOSEN side's action: keep-modified vs delete).
  conflicts.forEach((c, i) => {
    if (c.type !== "modify-delete" || !c.blockId) return;
    const side = picks[i];
    if (!side) return;
    const sideFlow = side === "ours" ? oursFlow : theirsFlow;
    const sideDeleted = !findBlock(sideFlow.blocks, c.blockId);
    if (sideDeleted) flow = { ...flow, blocks: deleteBlock(flow.blocks, c.blockId) };
  });

  return flow;
}

/** Short description of what taking a given side DOES for one conflict. */
function sideDetail(c: MergeConflict, side: Side, oursFlow: Flow, theirsFlow: Flow, t: TFunction): string {
  const val = side === "ours" ? c.ours : c.theirs;
  switch (c.type) {
    case "param":
    case "add-add":
    case "meta":
      return formatValue(val);
    case "move":
      return posText(val, t);
    case "modify-delete": {
      const flow = side === "ours" ? oursFlow : theirsFlow;
      const deleted = c.blockId ? !findBlock(flow.blocks, c.blockId) : false;
      return deleted ? t("ir.merge.actDelete", "delete the block") : t("ir.merge.actKeep", "keep (modified)");
    }
    case "structural":
      return t("ir.merge.actKeepTop", "keep at top level");
  }
}

// ── One conflict, its values, and its pick-a-side control ─────────────────────
function ConflictCard({
  conflict, blockLabel, pick, onPick, oursFlow, theirsFlow, t,
}: {
  conflict: MergeConflict;
  blockLabel: string;
  pick: Side | undefined;
  onPick: (side: Side) => void;
  oursFlow: Flow;
  theirsFlow: Flow;
  t: TFunction;
}) {
  const meta = CONFLICT_META[conflict.type];
  const Icon = meta.icon;
  const showBase = conflict.base !== undefined;
  const resolved = pick !== undefined;

  const sides: Side[] = ["ours", "theirs"];
  return (
    <div className={`rounded-md border p-2.5 ${resolved ? "border-success/40 bg-success/5" : "border-warning/50 bg-warning/5"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
          <Icon className="h-3 w-3" />{t(meta.key, meta.def)}
        </span>
        <span className="text-sm font-medium">{blockLabel}</span>
        {conflict.param && <span className="font-mono text-[11px] text-muted-foreground">· {conflict.param}</span>}
        {conflict.blockId && <span className="font-mono text-[10px] text-muted-foreground opacity-70">#{conflict.blockId}</span>}
        {resolved && (
          <StatusBadge
            status="resolved"
            tone="success"
            className="ml-auto"
            label={<span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />{pick === "ours" ? t("ir.merge.tookOurs", "took ours") : t("ir.merge.tookTheirs", "took theirs")}</span>}
          />
        )}
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">{conflict.message}</p>

      {showBase && (
        <div className="mt-1.5 text-[11px]">
          <span className="text-muted-foreground">{t("ir.merge.base", "Base")}: </span>
          <span className="font-mono">{conflict.type === "move" ? posText(conflict.base, t) : formatValue(conflict.base)}</span>
        </div>
      )}

      {/* Pick-a-side control */}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {sides.map((side) => {
          const active = pick === side;
          const isOurs = side === "ours";
          return (
            <button
              key={side}
              type="button"
              onClick={() => onPick(side)}
              aria-pressed={active}
              className={`flex flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                active
                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <span className="flex w-full items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
                <GitBranch className="h-3 w-3" />
                {isOurs ? t("ir.merge.ours", "Ours") : t("ir.merge.theirs", "Theirs")}
                {active && <Check className="ml-auto h-3.5 w-3.5 text-primary" />}
              </span>
              <span className="break-all font-mono text-[11px] text-muted-foreground">
                {sideDetail(conflict, side, oursFlow, theirsFlow, t)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Merged-flow tree preview (conflicted blocks tinted by resolution state) ────
function MergeBlockRow({
  block, conflictsByBlock, picks, t,
}: {
  block: IrBlock;
  conflictsByBlock: Map<string, number[]>;
  picks: Record<number, Side>;
  t: TFunction;
}) {
  const Icon = BLOCK_ICON[block.type];
  const idxs = block.id ? conflictsByBlock.get(block.id) : undefined;
  const hasConflict = !!idxs && idxs.length > 0;
  const resolved = hasConflict && idxs!.every((i) => picks[i] !== undefined);
  const tone = !hasConflict
    ? "border-border"
    : resolved
      ? "border-success bg-success/10 text-success"
      : "border-warning bg-warning/10 text-warning";
  const slots = childSlots(block);
  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-2 rounded-md border px-2 py-1 text-sm ${tone}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{t(BLOCK_LABEL[block.type].key, BLOCK_LABEL[block.type].def)}</span>
        <span className="font-mono text-[10px] opacity-70">{block.id}</span>
        <span className="ml-auto truncate text-[11px] opacity-80">{summarize(block, t)}</span>
        {hasConflict && (
          <Badge variant="outline" className="ml-1 shrink-0 text-[10px]">
            {resolved ? t("ir.merge.resolvedShort", "resolved") : t("ir.merge.conflictN", "{{n}} conflict", { n: idxs!.length })}
          </Badge>
        )}
      </div>
      {slots.map((slot) => {
        const items = getChildren(block, slot);
        if (items.length === 0) return null;
        return (
          <div key={slot} className="ml-4 space-y-1 border-l-2 border-dashed border-muted-foreground/30 pl-3">
            {items.map((child) => (
              <MergeBlockRow key={child.id} block={child} conflictsByBlock={conflictsByBlock} picks={picks} t={t} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function IrMergePanel({
  flows, currentFlow, irProjects, canControl, flagEnabled, onSaved, t,
}: {
  flows: SavedFlowRow[];
  currentFlow: Flow;
  irProjects: IrProjectRow[];
  canControl: boolean;
  flagEnabled: boolean;
  onSaved?: () => void;
  t: TFunction;
}) {
  const [baseId, setBaseId] = useState<string>("");
  const [oursId, setOursId] = useState<string>(CURRENT);
  const [theirsId, setTheirsId] = useState<string>("");
  const [picks, setPicks] = useState<Record<number, Side>>({});
  const [saveProjectId, setSaveProjectId] = useState<string>("");

  const flowLabel = (r: SavedFlowRow) => `${r.summary?.flowId ?? `#${r.id}`} · ${r.branch} v${r.version}`;

  // ── Load the three sides (base + theirs always saved versions; ours = a version OR draft) ──
  const baseQ = trpc.ir.getFlow.useQuery(
    { artifactId: Number(baseId) },
    { enabled: baseId !== "" && Number.isInteger(Number(baseId)), retry: false },
  );
  const oursQ = trpc.ir.getFlow.useQuery(
    { artifactId: Number(oursId) },
    { enabled: oursId !== CURRENT && oursId !== "" && Number.isInteger(Number(oursId)), retry: false },
  );
  const theirsQ = trpc.ir.getFlow.useQuery(
    { artifactId: Number(theirsId) },
    { enabled: theirsId !== "" && Number.isInteger(Number(theirsId)), retry: false },
  );

  const baseFlow = (baseQ.data?.flow ?? null) as Flow | null;
  const oursFlow: Flow | null = oursId === CURRENT ? currentFlow : ((oursQ.data?.flow ?? null) as Flow | null);
  const theirsFlow = (theirsQ.data?.flow ?? null) as Flow | null;

  const mergeQ = trpc.ir.merge.useQuery(
    { base: baseFlow as Flow, ours: oursFlow as Flow, theirs: theirsFlow as Flow },
    { enabled: !!baseFlow && !!oursFlow && !!theirsFlow, retry: false },
  );
  const result = mergeQ.data as MergeOutput | undefined;
  const mergedFlow = useMemo<Flow | null>(() => (result ? (result.merged as unknown as Flow) : null), [result]);

  // A fresh merge resets all prior picks (never carry a stale resolution across inputs).
  useEffect(() => { setPicks({}); }, [result]);

  // blockId → the indices of the conflicts touching it (for the tree tint + inline count).
  const conflictsByBlock = useMemo(() => {
    const m = new Map<string, number[]>();
    (result?.conflicts ?? []).forEach((c, i) => {
      if (!c.blockId) return;
      const arr = m.get(c.blockId) ?? [];
      arr.push(i);
      m.set(c.blockId, arr);
    });
    return m;
  }, [result]);

  const conflicts = result?.conflicts ?? [];
  const resolvedCount = conflicts.filter((_, i) => picks[i] !== undefined).length;
  const allResolved = conflicts.every((_, i) => picks[i] !== undefined);

  // The client-side RESOLVED flow (applies picks to the ours-provisional merged flow).
  const resolvedFlow = useMemo<Flow | null>(() => {
    if (!result || !mergedFlow || !oursFlow || !theirsFlow) return null;
    return applyResolutions(mergedFlow, result.conflicts, picks, oursFlow, theirsFlow);
  }, [result, mergedFlow, oursFlow, theirsFlow, picks]);

  const blockLabelOf = (c: MergeConflict): string => {
    if (c.blockId === null) return t("ir.merge.flowField", "Flow field");
    const b = mergedFlow ? findBlock(mergedFlow.blocks, c.blockId) : null;
    return b ? t(BLOCK_LABEL[b.type].key, BLOCK_LABEL[b.type].def) : c.blockId;
  };

  // ── Save the resolved flow through the EXISTING gated saveFlow (no gate bypass) ──
  const saveM = trpc.ir.saveFlow.useMutation({
    onSuccess: (r) => {
      const ok = r?.validation?.ok ?? true;
      if (ok) toast.success(t("ir.merge.saved", "Merged flow saved (validated)"));
      else toast.warning(t("ir.merge.savedInvalid", "Merged flow saved, but the linter flagged issues — see diagnostics."));
      onSaved?.();
    },
    onError: (e: { data?: { code?: string } | null; message: string }) => {
      if (e.data?.code === "CONFLICT" && /disabled/i.test(e.message)) {
        toast.info(t("ir.merge.flagOffToast", "IR programming is disabled (preview). Set DPC_IR_V2_ENABLED=true to save."));
      } else {
        toast.error(e.message);
      }
    },
  });

  const projectSelected = Number.isInteger(Number(saveProjectId)) && Number(saveProjectId) > 0;
  const hasUnresolved = conflicts.length > 0 && !allResolved;
  const saveDisabledReason =
    !flagEnabled ? t("ir.merge.flagOffTip", "Enable DPC_IR_V2_ENABLED to save the merged flow")
      : !canControl ? t("ir.merge.noPermTip", "You need machine_control permission to save.")
        : hasUnresolved ? t("ir.merge.unresolvedTip", "Pick a side for every conflict before saving.")
          : !projectSelected ? t("ir.merge.pickProjectTip", "Pick an ir-flow project to save into.")
            : undefined;
  const saveDisabled = !!saveDisabledReason || saveM.isPending || !resolvedFlow;

  const doSaveMerged = () => {
    if (!resolvedFlow) return;
    const pid = Number(saveProjectId);
    if (!Number.isInteger(pid) || pid <= 0) {
      toast.error(t("ir.merge.pickProject", "Pick an ir-flow project to save into."));
      return;
    }
    saveM.mutate({ projectId: pid, branch: "main", flow: resolvedFlow });
  };

  const allThree = !!baseFlow && !!oursFlow && !!theirsFlow;

  return (
    <div className="space-y-3">
      {/* Version pickers: base (ancestor) · ours (draft or version) · theirs */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t("ir.merge.base", "Base")} · {t("ir.merge.ancestor", "common ancestor")}</label>
          <Select value={baseId} onValueChange={setBaseId}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t("ir.merge.pickVersion", "Pick a saved version…")} /></SelectTrigger>
            <SelectContent>
              {flows.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("ir.noFlows", "No saved IR flows yet.")}</div>}
              {flows.map((r) => <SelectItem key={r.id} value={String(r.id)}>{flowLabel(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t("ir.merge.ours", "Ours")}</label>
          <Select value={oursId} onValueChange={setOursId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={CURRENT}>{t("ir.merge.currentDraft", "Current editor draft")}</SelectItem>
              {flows.map((r) => <SelectItem key={r.id} value={String(r.id)}>{flowLabel(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t("ir.merge.theirs", "Theirs")}</label>
          <Select value={theirsId} onValueChange={setTheirsId}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t("ir.merge.pickVersion", "Pick a saved version…")} /></SelectTrigger>
            <SelectContent>
              {flows.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("ir.noFlows", "No saved IR flows yet.")}</div>}
              {flows.map((r) => <SelectItem key={r.id} value={String(r.id)}>{flowLabel(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary + Save-merged action */}
      {result && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-2">
          {result.clean ? (
            <StatusBadge status="clean" tone="success" label={
              <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />{t("ir.merge.cleanBadge", "Clean auto-merge")}</span>
            } />
          ) : (
            <StatusBadge status="conflicts" tone={allResolved ? "success" : "warning"} label={
              <span className="inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t("ir.merge.conflictSummary", "{{resolved}}/{{total}} conflicts resolved", { resolved: resolvedCount, total: conflicts.length })}
              </span>
            } />
          )}
          <span className="text-[11px] text-muted-foreground">
            {t("ir.merge.stats", "{{auto}} auto-merged · {{added}} added · {{deleted}} deleted", { auto: result.stats.autoMerged, added: result.stats.added, deleted: result.stats.deleted })}
          </span>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={saveProjectId} onValueChange={setSaveProjectId}>
              <SelectTrigger className="h-9 w-52"><SelectValue placeholder={t("ir.pickProjectPlaceholder", "Save into project…")} /></SelectTrigger>
              <SelectContent>
                {irProjects.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("ir.noProjects", "No ir-flow projects")}</div>}
                {irProjects.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} · {p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={doSaveMerged} disabled={saveDisabled} title={saveDisabledReason}>
              {saveM.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              {t("ir.merge.save", "Save merged")}
            </Button>
          </div>
        </div>
      )}

      {/* States */}
      {!allThree ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <GitMerge className="mx-auto mb-2 h-5 w-5" />
          {t("ir.merge.pickThree", "Pick a base (common ancestor), ours (a version or the live draft) and theirs to 3-way merge.")}
        </div>
      ) : mergeQ.isFetching ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("ir.merge.computing", "Computing 3-way merge…")}</div>
      ) : result && result.clean ? (
        <div className="rounded-md border border-success/40 bg-success/5 p-4 text-sm text-success">
          {t("ir.merge.cleanNote", "No conflicts — the two sides merged cleanly. Review the merged tree below and save it as a new version.")}
        </div>
      ) : result ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Conflicts + pick-a-side */}
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-3 w-3" />{t("ir.merge.conflictsHeading", "Conflicts — pick a side")}
            </div>
            <ScrollArea className="max-h-[420px] pr-2">
              <div className="space-y-2">
                {conflicts.map((c, i) => (
                  <ConflictCard
                    key={i}
                    conflict={c}
                    blockLabel={blockLabelOf(c)}
                    pick={picks[i]}
                    onPick={(side) => setPicks((p) => ({ ...p, [i]: side }))}
                    oursFlow={oursFlow!}
                    theirsFlow={theirsFlow!}
                    t={t}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Merged tree preview */}
          <div className="space-y-2">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ListTree className="h-3 w-3" />{t("ir.merge.previewHeading", "Merged flow preview")}
            </div>
            <ScrollArea className="max-h-[420px] pr-2">
              <div className="space-y-1">
                {mergedFlow && mergedFlow.blocks.length > 0
                  ? mergedFlow.blocks.map((b) => (
                    <MergeBlockRow key={b.id} block={b} conflictsByBlock={conflictsByBlock} picks={picks} t={t} />
                  ))
                  : <p className="py-4 text-center text-xs text-muted-foreground">{t("ir.merge.emptyMerged", "The merged flow has no blocks.")}</p>}
              </div>
            </ScrollArea>
          </div>
        </div>
      ) : null}

      <p className="text-[10px] text-muted-foreground">
        {t("ir.merge.gateNote", "Merge preview is a pure read. “Save merged” appends a validated ir-flow version through the existing gated save (DPC_IR_V2_ENABLED + machine_control) — it never bypasses that gate, and a real deploy stays a separate step.")}
      </p>
    </div>
  );
}
