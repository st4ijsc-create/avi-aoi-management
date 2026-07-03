/**
 * Doc 24 Wave-4 P5 — CLIENT VERSION-DIFF panel for the IR editor.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A compact, block-level diff view: pick a BASE (a saved ir-flow version) and a COMPARE
 * source (another saved version OR the live in-editor draft), and see exactly which blocks
 * were added / removed / modified / moved between them. The block-level diff is computed by
 * the read-gated server procedure (ir.diff / ir.diffVersions) over the SAME typed IR AST —
 * this panel only renders it.
 *
 * The COMPARE flow's tree is rendered nested and each block is TINTED by its change kind
 * (added = success · modified = warning · moved = primary); removed blocks (absent from the
 * compare tree) are listed separately with a destructive tint. A summary strip tallies the
 * four change kinds. Merge is a separate (dry-run) server procedure; this slice focuses on
 * diff — a minimal conflict summary is shown when a merge preview is requested elsewhere.
 *
 * Semantic tokens only (dark-first). No raw hex / palette classes.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useMemo, useState } from "react";
import type { TFunction } from "i18next";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCompare, Plus, Minus, Pencil, ArrowLeftRight, Loader2 } from "lucide-react";
import {
  BLOCK_ICON, BLOCK_LABEL, summarize, childSlots, getChildren,
  type Flow, type IrBlock,
} from "@/components/programming/irTree";

type RouterOutputs = inferRouterOutputs<AppRouter>;
type DiffOutput = RouterOutputs["ir"]["diff"];
type IrChangeKind = DiffOutput["changes"][number]["kind"];

/** A saved ir-flow row (subset of ir.listFlows output). */
export type SavedFlowRow = {
  id: number;
  branch: string;
  version: number;
  summary: { flowId: string } | null;
};

const CURRENT = "current"; // sentinel: compare against the live editor draft

// ── Per-kind visual tokens (semantic only) ────────────────────────────────────
const KIND_TONE: Record<IrChangeKind, string> = {
  added: "border-success bg-success/10 text-success",
  removed: "border-destructive bg-destructive/10 text-destructive",
  modified: "border-warning bg-warning/10 text-warning",
  moved: "border-primary bg-primary/10 text-primary",
};
const KIND_ICON: Record<IrChangeKind, typeof Plus> = {
  added: Plus,
  removed: Minus,
  modified: Pencil,
  moved: ArrowLeftRight,
};

function kindLabel(kind: IrChangeKind, t: TFunction): string {
  return {
    added: t("ir.diff.added", "added"),
    removed: t("ir.diff.removed", "removed"),
    modified: t("ir.diff.modified", "modified"),
    moved: t("ir.diff.moved", "moved"),
  }[kind];
}

// ── Annotated tree row (tints a block by its change kind) ──────────────────────
function DiffBlockRow({ block, tintById, t }: { block: IrBlock; tintById: Map<string, IrChangeKind>; t: TFunction }) {
  const Icon = BLOCK_ICON[block.type];
  const kind = block.id ? tintById.get(block.id) : undefined;
  const tone = kind ? KIND_TONE[kind] : "border-border";
  const slots = childSlots(block);
  return (
    <div className="space-y-1">
      <div className={`flex items-center gap-2 rounded-md border px-2 py-1 text-sm ${tone}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">{t(BLOCK_LABEL[block.type].key, BLOCK_LABEL[block.type].def)}</span>
        <span className="font-mono text-[10px] opacity-70">{block.id}</span>
        <span className="ml-auto truncate text-[11px] opacity-80">{summarize(block, t)}</span>
        {kind && <Badge variant="outline" className="ml-1 shrink-0 text-[10px]">{kindLabel(kind, t)}</Badge>}
      </div>
      {slots.map((slot) => {
        const items = getChildren(block, slot);
        if (items.length === 0) return null;
        return (
          <div key={slot} className="ml-4 space-y-1 border-l-2 border-dashed border-muted-foreground/30 pl-3">
            {items.map((child) => (
              <DiffBlockRow key={child.id} block={child} tintById={tintById} t={t} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function IrDiffPanel({ flows, currentFlow, t }: { flows: SavedFlowRow[]; currentFlow: Flow; t: TFunction }) {
  const [baseId, setBaseId] = useState<string>("");
  const [cmpId, setCmpId] = useState<string>(CURRENT);

  const flowLabel = (r: SavedFlowRow) => `${r.summary?.flowId ?? `#${r.id}`} · ${r.branch} v${r.version}`;

  // ── Load the two sides (base always a saved version; compare = a version or the draft) ──
  const baseQ = trpc.ir.getFlow.useQuery(
    { artifactId: Number(baseId) },
    { enabled: baseId !== "" && Number.isInteger(Number(baseId)), retry: false },
  );
  const cmpQ = trpc.ir.getFlow.useQuery(
    { artifactId: Number(cmpId) },
    { enabled: cmpId !== CURRENT && cmpId !== "" && Number.isInteger(Number(cmpId)), retry: false },
  );

  const beforeFlow = (baseQ.data?.flow ?? null) as Flow | null;
  const afterFlow: Flow | null = cmpId === CURRENT ? currentFlow : ((cmpQ.data?.flow ?? null) as Flow | null);

  const diffQ = trpc.ir.diff.useQuery(
    { before: beforeFlow as Flow, after: afterFlow as Flow },
    { enabled: !!beforeFlow && !!afterFlow, retry: false },
  );
  const diff = diffQ.data as DiffOutput | undefined;

  // blockId → change kind (for tinting the compare tree). Modified takes precedence over moved.
  const tintById = useMemo(() => {
    const m = new Map<string, IrChangeKind>();
    for (const c of diff?.changes ?? []) {
      const prev = m.get(c.blockId);
      if (prev === "modified") continue; // keep the stronger tint
      if (prev === "moved" && c.kind !== "modified") continue;
      m.set(c.blockId, c.kind);
    }
    return m;
  }, [diff]);

  const removed = (diff?.changes ?? []).filter((c) => c.kind === "removed");

  return (
    <div className="space-y-3">
      {/* Version pickers */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t("ir.diff.base", "Base version")}</label>
          <Select value={baseId} onValueChange={setBaseId}>
            <SelectTrigger className="h-9"><SelectValue placeholder={t("ir.diff.pickBase", "Pick a saved version…")} /></SelectTrigger>
            <SelectContent>
              {flows.length === 0 && <div className="px-2 py-1.5 text-xs text-muted-foreground">{t("ir.noFlows", "No saved IR flows yet.")}</div>}
              {flows.map((r) => <SelectItem key={r.id} value={String(r.id)}>{flowLabel(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] text-muted-foreground">{t("ir.diff.compare", "Compare with")}</label>
          <Select value={cmpId} onValueChange={setCmpId}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={CURRENT}>{t("ir.diff.currentDraft", "Current editor draft")}</SelectItem>
              {flows.map((r) => <SelectItem key={r.id} value={String(r.id)}>{flowLabel(r)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary strip */}
      {diff && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-success"><Plus className="h-3 w-3" />{diff.summary.added} {t("ir.diff.added", "added")}</span>
          <span className="inline-flex items-center gap-1 rounded border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-destructive"><Minus className="h-3 w-3" />{diff.summary.removed} {t("ir.diff.removed", "removed")}</span>
          <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-warning"><Pencil className="h-3 w-3" />{diff.summary.modified} {t("ir.diff.modified", "modified")}</span>
          <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary"><ArrowLeftRight className="h-3 w-3" />{diff.summary.moved} {t("ir.diff.moved", "moved")}</span>
        </div>
      )}

      {/* States */}
      {(!beforeFlow || !afterFlow) ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          <GitCompare className="mx-auto mb-2 h-5 w-5" />
          {t("ir.diff.pickTwo", "Pick a base version and a compare source to see the block-level diff.")}
        </div>
      ) : diffQ.isFetching ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("ir.diff.computing", "Computing diff…")}</div>
      ) : diff && diff.changes.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">{t("ir.diff.identical", "No differences — the two versions are identical.")}</div>
      ) : (
        <div className="space-y-3">
          {/* Annotated COMPARE tree */}
          <ScrollArea className="max-h-[360px] pr-2">
            <div className="space-y-1">
              {afterFlow.blocks.map((b) => <DiffBlockRow key={b.id} block={b} tintById={tintById} t={t} />)}
            </div>
          </ScrollArea>

          {/* Removed blocks (absent from the compare tree) */}
          {removed.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("ir.diff.removedBlocks", "Removed blocks")}</div>
              {removed.map((c) => (
                <div key={c.blockId} className="flex items-center gap-2 rounded-md border border-destructive bg-destructive/10 px-2 py-1 text-sm text-destructive line-through">
                  <Minus className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium">{t(BLOCK_LABEL[c.blockType].key, BLOCK_LABEL[c.blockType].def)}</span>
                  <span className="font-mono text-[10px] opacity-70">{c.blockId}</span>
                  <span className="ml-auto font-mono text-[10px] opacity-70">{c.path}</span>
                </div>
              ))}
            </div>
          )}

          {/* Per-block modified-param detail */}
          {(diff?.changes ?? []).some((c) => c.kind === "modified") && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("ir.diff.changedParams", "Changed parameters")}</div>
              {(diff?.changes ?? []).filter((c) => c.kind === "modified").map((c) => (
                <div key={c.blockId} className="rounded-md border border-warning/40 bg-warning/5 px-2 py-1 text-[11px]">
                  <span className="font-mono text-warning">{c.blockType} #{c.blockId}</span>
                  <span className="ml-2 text-muted-foreground">
                    {(c.params ?? []).map((p) => p.param).join(", ")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
