/**
 * Doc 24 Tier-1d — GRAPHICAL LAD / FBD / SFC CANVAS for the IEC 61131-3 POU Studio.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * A @xyflow/react (react-flow) visual renderer + node-level editor for the STRUCTURED
 * POU model (server/services/programming/iec61131/pouModel.ts). It is the graphical
 * sibling of the JSON editor on /pou-studio: BOTH are views over the SAME model, which
 * stays the single source of truth so the JSON view, the PLCopen XML export, and the
 * transpile-to-ST preview never diverge from what the canvas shows.
 *
 * Three body languages, each with its own layout mode:
 *   • LAD (LD)  — one horizontal rung per network: a LEFT power rail → the series/parallel
 *                 CONTACT network → the driven COILS → a RIGHT rail. `series` chains left→
 *                 right (AND); `parallel` stacks branches (OR) whose entries/exits fan out
 *                 to the surrounding elements — exactly how a ladder branch reads.
 *   • FBD       — the block DAG, laid out in dependency COLUMNS (a block sits one column to
 *                 the right of its deepest block input). Edges carry var / const / block
 *                 sources, labelled with the destination input-pin name.
 *   • SFC       — steps in a vertical column (initial step marked ▶); each transition is a
 *                 small bar node wired from-step → transition → to-step (loop-back and long
 *                 edges route through a side lane).
 *
 * EDITING (tractable, model-in-sync): select a node → an inspector edits its typed fields
 * (contact/coil variable + NO/NC + coil mode · block operator + per-input source wiring ·
 * step name/initial/actions · transition from/to/condition). A palette adds a contact / coil
 * / rung · block / output · step / transition. Every edit produces a NEW immutable POU body
 * and calls `onChange` with the new project — the parent serialises it back to the JSON view.
 * Delete (button in the inspector or the ⌫ / Del key) prunes the node from the model.
 *
 * Free-form rung drawing (dragging wires to compose arbitrary series/parallel graphs) is the
 * deferred stretch; this is a faithful visual view + node-level authoring.
 *
 * Lint markers per node come from the existing pouLinter diagnostics (error → destructive
 * border, warn → warning). Semantic tokens only (dark-first). No raw hex.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useCallback, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Plus, Trash2, GitBranch, Info, Variable, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
// Type-only import of the POU model (the single source of truth). `import type` guarantees
// no server runtime is bundled into the client — the same convention PouStudio uses for the
// tRPC AppRouter type.
import type {
  PouProject, PouBody, PouVar, VarSection, IecType,
  LadBody, LadElement, LadContact, LadCoil,
  FbdBody, FbdSource,
  SfcBody, SfcAction, SfcQualifier,
} from "../../../../server/services/programming/iec61131/pouModel";

// ── Lint diagnostic shape (structurally identical to pouLinter.PouLintDiagnostic) ─────
export type PouCanvasDiag = {
  pou: string;
  ref: string;
  severity: "error" | "warn";
  rule: string;
  message: string;
};

// ── Layout constants ──────────────────────────────────────────────────────────
const CW = 128;              // contact / coil width
const CH = 52;               // contact / coil height
const HGAP = 48;             // horizontal gap between series elements
const VGAP = 28;             // vertical gap between parallel branches / stacked coils
const RAILW = 8;             // power-rail bar width
const RAIL_GAP = 26;         // gap either side of the network between the rails
const RUNG_VGAP = 52;        // vertical gap between rungs

const COLW = 214;            // FBD column pitch
const FBD_VGAP = 22;         // FBD vertical stacking gap
const FBLOCK_W = 152;
const FBLOCK_BASE = 42;      // FBD block header+id height
const FBLOCK_PIN = 16;       // per-input-pin row height
const SRC_H = 40;            // FBD var/const/output node height

const STEP_W = 168;
const STEP_H = 56;
const SFC_VGAP = 52;         // vertical gap between SFC steps (transition lives here)
const SFC_X = 150;
const TRANS_W = 168;
const TRANS_H = 40;

// ── Node id encode / decode (also the selection key + edit address) ───────────
const SEP = "::";
const ladContactId = (r: number, path: number[]) => `ct${SEP}${r}${SEP}${path.join(".")}`;
const ladCoilId = (r: number, c: number) => `co${SEP}${r}${SEP}${c}`;
const ladRailId = (r: number, side: "L" | "R") => `rl${SEP}${r}${SEP}${side}`;
const fbdBlockId = (n: number, id: string) => `blk${SEP}${n}${SEP}${id}`;
const fbdVarId = (n: number, name: string) => `var${SEP}${n}${SEP}${name}`;
const fbdConstId = (n: number, key: string) => `cst${SEP}${n}${SEP}${key}`;
const fbdOutputId = (n: number, o: number) => `out${SEP}${n}${SEP}${o}`;
const sfcStepId = (i: number) => `stp${SEP}${i}`;
const sfcTransId = (i: number) => `trn${SEP}${i}`;

const SELECTABLE = new Set(["ct", "co", "blk", "out", "stp", "trn"]);

type Decoded =
  | { tag: "ct"; rung: number; path: number[] }
  | { tag: "co"; rung: number; coil: number }
  | { tag: "blk"; net: number; blockId: string }
  | { tag: "out"; net: number; out: number }
  | { tag: "stp"; step: number }
  | { tag: "trn"; trans: number }
  | { tag: "other" };

function decode(id: string): Decoded {
  const p = id.split(SEP);
  switch (p[0]) {
    case "ct": return { tag: "ct", rung: Number(p[1]), path: p[2] === "" ? [] : p[2].split(".").map(Number) };
    case "co": return { tag: "co", rung: Number(p[1]), coil: Number(p[2]) };
    case "blk": return { tag: "blk", net: Number(p[1]), blockId: p.slice(2).join(SEP) };
    case "out": return { tag: "out", net: Number(p[1]), out: Number(p[2]) };
    case "stp": return { tag: "stp", step: Number(p[1]) };
    case "trn": return { tag: "trn", trans: Number(p[1]) };
    default: return { tag: "other" };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// NODE DATA (one react-flow node type "pou", discriminated by `kind`)
// ══════════════════════════════════════════════════════════════════════════════
type Orient = "h" | "v";
type PouNodeData =
  | { kind: "contact"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; label: string; negated: boolean }
  | { kind: "coil"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; label: string; coilKind: "coil" | "negated" | "set" | "reset" }
  | { kind: "rail"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; side: "L" | "R"; tall: number }
  | { kind: "fbdBlock"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; op: string; refId: string; pins: string[]; boxH: number }
  | { kind: "fbdSource"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; label: string; srcKind: "var" | "const" }
  | { kind: "fbdOutput"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; label: string }
  | { kind: "sfcStep"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; label: string; initial: boolean; actionCount: number }
  | { kind: "sfcTransition"; orient: Orient; selected: boolean; hasError: boolean; hasWarn: boolean; label: string };

type PouNode = Node<PouNodeData>;

function toneClass(d: PouNodeData): string {
  if (d.hasError) return "border-destructive ring-1 ring-destructive/40";
  if (d.hasWarn) return "border-warning ring-1 ring-warning/30";
  if (d.selected) return "border-primary ring-2 ring-primary";
  return "border-border";
}

// ── The single node component ─────────────────────────────────────────────────
function PouNodeComp({ data }: NodeProps<Node<PouNodeData>>) {
  const isH = data.orient === "h";
  const handles = (
    <>
      <Handle type="target" position={isH ? Position.Left : Position.Top} className="!h-2 !w-2 !border-border !bg-muted-foreground" />
      <Handle type="source" position={isH ? Position.Right : Position.Bottom} className="!h-2 !w-2 !border-border !bg-primary" />
    </>
  );
  const tone = toneClass(data);

  switch (data.kind) {
    case "rail":
      return (
        <div className="relative flex items-center justify-center" style={{ width: RAILW, height: data.tall }}>
          <div className="h-full w-1.5 rounded-full bg-primary/50" />
          {handles}
        </div>
      );

    case "contact":
      return (
        <div className={`relative rounded-md border bg-card px-2 py-1.5 shadow-sm ${tone}`} style={{ width: CW }}>
          {handles}
          <div className="text-center font-mono text-base leading-none text-primary">{data.negated ? "|/|" : "| |"}</div>
          <div className="mt-1 truncate text-center text-xs font-medium">{data.label || "—"}</div>
          <div className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">{data.negated ? "NC" : "NO"}</div>
        </div>
      );

    case "coil": {
      const glyph = data.coilKind === "set" ? "(S)" : data.coilKind === "reset" ? "(R)" : data.coilKind === "negated" ? "(/)" : "( )";
      return (
        <div className={`relative rounded-md border bg-card px-2 py-1.5 shadow-sm ${tone}`} style={{ width: CW }}>
          {handles}
          <div className="text-center font-mono text-base leading-none text-success">{glyph}</div>
          <div className="mt-1 truncate text-center text-xs font-medium">{data.label || "—"}</div>
          <div className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">coil</div>
        </div>
      );
    }

    case "fbdBlock":
      return (
        <div className={`relative overflow-hidden rounded-md border bg-card shadow-sm ${tone}`} style={{ width: FBLOCK_W, height: data.boxH }}>
          {handles}
          <div className="bg-primary/10 px-2 py-1 text-center text-xs font-semibold text-primary">{data.op}</div>
          <div className="px-2 py-0.5 text-center font-mono text-[9px] text-muted-foreground">{data.refId}</div>
          <div className="space-y-0.5 px-2 pb-1">
            {data.pins.map((p) => (
              <div key={p} className="truncate text-[10px] text-muted-foreground">▸ {p}</div>
            ))}
          </div>
        </div>
      );

    case "fbdSource":
      return (
        <div className={`relative rounded-full border bg-muted/40 px-2 py-1 shadow-sm ${tone}`} style={{ width: 116 }}>
          {handles}
          <div className="truncate text-center font-mono text-xs">{data.label}</div>
          <div className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">{data.srcKind}</div>
        </div>
      );

    case "fbdOutput":
      return (
        <div className={`relative rounded-md border bg-card px-2 py-1.5 shadow-sm ${tone}`} style={{ width: 140 }}>
          {handles}
          <div className="truncate text-center text-xs font-medium">{data.label}</div>
          <div className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">output</div>
        </div>
      );

    case "sfcStep": {
      const border = data.hasError ? "border-destructive" : data.hasWarn ? "border-warning" : data.selected ? "border-primary" : data.initial ? "border-primary/70" : "border-border";
      return (
        <div className={`relative rounded-md border-2 bg-card px-3 py-2 shadow-sm ${border} ${data.selected ? "ring-2 ring-primary" : ""}`} style={{ width: STEP_W }}>
          {handles}
          <div className="flex items-center justify-center gap-1">
            {data.initial && <span className="text-primary" title="initial step">▶</span>}
            <span className="truncate text-sm font-semibold">{data.label}</span>
          </div>
          <div className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">{data.actionCount} action(s)</div>
        </div>
      );
    }

    case "sfcTransition":
      return (
        <div className={`relative rounded border-l-4 border-warning bg-card px-2 py-1 shadow-sm ${tone}`} style={{ width: TRANS_W, minHeight: TRANS_H }}>
          {handles}
          <div className="truncate text-center font-mono text-[11px]">{data.label || "TRUE"}</div>
          <div className="text-center text-[9px] uppercase tracking-wide text-muted-foreground">transition</div>
        </div>
      );
  }
}

const NODE_TYPES: NodeTypes = { pou: PouNodeComp };

// ══════════════════════════════════════════════════════════════════════════════
// DIAGNOSTIC MATCHING (map rung/net/step-level diagnostics onto individual nodes)
// ══════════════════════════════════════════════════════════════════════════════
function varTone(diags: PouCanvasDiag[], variable: string): { hasError: boolean; hasWarn: boolean } {
  const hit = diags.filter((d) => d.message.includes(`"${variable}"`));
  return { hasError: hit.some((d) => d.severity === "error"), hasWarn: hit.some((d) => d.severity === "warn") };
}
function textTone(diags: PouCanvasDiag[], needle: string): { hasError: boolean; hasWarn: boolean } {
  const hit = diags.filter((d) => d.message.includes(needle));
  return { hasError: hit.some((d) => d.severity === "error"), hasWarn: hit.some((d) => d.severity === "warn") };
}
function refTone(diags: PouCanvasDiag[], ref: string): { hasError: boolean; hasWarn: boolean } {
  const hit = diags.filter((d) => d.ref === ref);
  return { hasError: hit.some((d) => d.severity === "error"), hasWarn: hit.some((d) => d.severity === "warn") };
}

// ══════════════════════════════════════════════════════════════════════════════
// EDGE helpers
// ══════════════════════════════════════════════════════════════════════════════
function makeEdgeFactory() {
  let i = 0;
  return (source: string, target: string, opts?: { label?: string; arrow?: boolean; rail?: boolean }): Edge => ({
    id: `e${i++}-${source}-${target}`,
    source,
    target,
    type: "smoothstep",
    ...(opts?.label ? { label: opts.label } : {}),
    ...(opts?.arrow ? { markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "var(--muted-foreground)" } } : {}),
    style: { stroke: opts?.rail ? "var(--primary)" : "var(--muted-foreground)", strokeWidth: 1.5 },
    labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--card)", fillOpacity: 0.85 },
  });
}

function offset(nodes: PouNode[], dx: number, dy: number): PouNode[] {
  return nodes.map((n) => ({ ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }));
}

// ══════════════════════════════════════════════════════════════════════════════
// LAD — layout a rung's series/parallel network, then wire rails + coils.
// Built = a self-contained sub-graph with its exposed entry/exit node ids.
// ══════════════════════════════════════════════════════════════════════════════
type Built = { nodes: PouNode[]; edges: Edge[]; width: number; height: number; entryIds: string[]; exitIds: string[] };
type LadCtx = { rung: number; rungRef: string; diags: PouCanvasDiag[]; selectedId: string | null; edge: ReturnType<typeof makeEdgeFactory> };

function buildLadElement(el: LadElement, path: number[], ctx: LadCtx): Built {
  if (el.kind === "contact") {
    const id = ladContactId(ctx.rung, path);
    const tt = varTone(ctx.diags, el.variable);
    const node: PouNode = {
      id, type: "pou", position: { x: 0, y: 0 }, selectable: true, deletable: true, draggable: false,
      selected: ctx.selectedId === id,
      data: { kind: "contact", orient: "h", selected: ctx.selectedId === id, hasError: tt.hasError, hasWarn: tt.hasWarn, label: el.variable, negated: !!el.negated },
    };
    return { nodes: [node], edges: [], width: CW, height: CH, entryIds: [id], exitIds: [id] };
  }
  const children = el.elements.map((c, i) => buildLadElement(c, [...path, i], ctx));
  // Guard malformed (empty) networks that can reach the canvas from raw, not-yet-zod-validated
  // JSON — render an empty box rather than producing -Infinity positions.
  if (children.length === 0) return { nodes: [], edges: [], width: CW, height: CH, entryIds: [], exitIds: [] };

  if (el.kind === "series") {
    const maxH = Math.max(...children.map((b) => b.height));
    const nodes: PouNode[] = [];
    const edges: Edge[] = [];
    let x = 0;
    let entryIds: string[] = [];
    let prevExit: string[] = [];
    children.forEach((b, i) => {
      nodes.push(...offset(b.nodes, x, (maxH - b.height) / 2));
      edges.push(...b.edges);
      if (i === 0) entryIds = b.entryIds;
      else for (const s of prevExit) for (const t of b.entryIds) edges.push(ctx.edge(s, t, { rail: true }));
      prevExit = b.exitIds;
      x += b.width + HGAP;
    });
    return { nodes, edges, width: x - HGAP, height: maxH, entryIds, exitIds: prevExit };
  }

  // parallel — stack branches vertically; expose all entries/exits (surrounding series fans out)
  const w = Math.max(...children.map((b) => b.width));
  const nodes: PouNode[] = [];
  const edges: Edge[] = [];
  const entryIds: string[] = [];
  const exitIds: string[] = [];
  let y = 0;
  children.forEach((b) => {
    nodes.push(...offset(b.nodes, 0, y));
    edges.push(...b.edges);
    entryIds.push(...b.entryIds);
    exitIds.push(...b.exitIds);
    y += b.height + VGAP;
  });
  return { nodes, edges, width: w, height: y - VGAP, entryIds, exitIds };
}

function buildLad(body: LadBody, ctxDiags: Map<string, PouCanvasDiag[]>, selectedId: string | null): { nodes: PouNode[]; edges: Edge[] } {
  const nodes: PouNode[] = [];
  const edges: Edge[] = [];
  const edge = makeEdgeFactory();
  let yOff = 0;

  (body.networks ?? []).forEach((rung, ri) => {
    const rungRef = rung.id ?? `rung${ri + 1}`;
    const diags = ctxDiags.get(rungRef) ?? [];
    const root = buildLadElement(rung.logic, [], { rung: ri, rungRef, diags, selectedId, edge });

    const coils = rung.coils ?? [];
    const coilsH = coils.length ? coils.length * CH + (coils.length - 1) * VGAP : 0;
    const rungH = Math.max(root.height, coilsH, CH);

    const local: PouNode[] = [];
    const localEdges: Edge[] = [];

    // left / right rails
    const railL = ladRailId(ri, "L");
    const railR = ladRailId(ri, "R");
    local.push({ id: railL, type: "pou", position: { x: 0, y: 0 }, selectable: false, draggable: false, data: { kind: "rail", orient: "h", selected: false, hasError: false, hasWarn: false, side: "L", tall: rungH } });

    // the network, vertically centred in the rung band
    const netX = RAILW + RAIL_GAP;
    local.push(...offset(root.nodes, netX, (rungH - root.height) / 2));
    localEdges.push(...root.edges);
    for (const e of root.entryIds) localEdges.push(edge(railL, e, { rail: true }));

    // coils to the right of the network
    const coilsX = netX + root.width + HGAP;
    const coilIds: string[] = [];
    coils.forEach((c: LadCoil, ci) => {
      const id = ladCoilId(ri, ci);
      const tt = varTone(diags, c.variable);
      const cy = (rungH - coilsH) / 2 + ci * (CH + VGAP);
      local.push({
        id, type: "pou", position: { x: coilsX, y: cy }, selectable: true, deletable: true, draggable: false,
        selected: selectedId === id,
        data: { kind: "coil", orient: "h", selected: selectedId === id, hasError: tt.hasError, hasWarn: tt.hasWarn, label: c.variable, coilKind: c.kind ?? "coil" },
      });
      coilIds.push(id);
    });

    if (coilIds.length) {
      for (const ex of root.exitIds) for (const cid of coilIds) localEdges.push(edge(ex, cid, { rail: true }));
      for (const cid of coilIds) localEdges.push(edge(cid, railR, { rail: true }));
    } else {
      for (const ex of root.exitIds) localEdges.push(edge(ex, railR, { rail: true }));
    }

    const railRX = (coilIds.length ? coilsX + CW : coilsX) + RAIL_GAP;
    local.push({ id: railR, type: "pou", position: { x: railRX, y: 0 }, selectable: false, draggable: false, data: { kind: "rail", orient: "h", selected: false, hasError: false, hasWarn: false, side: "R", tall: rungH } });

    nodes.push(...offset(local, 0, yOff));
    edges.push(...localEdges);
    yOff += rungH + RUNG_VGAP;
  });

  return { nodes, edges };
}

// ── LAD element-tree edit helpers (immutable) ─────────────────────────────────
const newContact = (): LadContact => ({ kind: "contact", variable: "X", negated: false });

function mapElementAtPath(root: LadElement, path: number[], fn: (el: LadElement) => LadElement): LadElement {
  if (path.length === 0) return fn(root);
  const [i, ...rest] = path;
  if (root.kind === "series" || root.kind === "parallel") {
    return { ...root, elements: root.elements.map((c, idx) => (idx === i ? mapElementAtPath(c, rest, fn) : c)) };
  }
  return root;
}
function getElementAtPath(root: LadElement, path: number[]): LadElement | null {
  if (path.length === 0) return root;
  const [i, ...rest] = path;
  if (root.kind === "series" || root.kind === "parallel") {
    const c = root.elements[i];
    return c ? getElementAtPath(c, rest) : null;
  }
  return null;
}
function removeElementAtPath(root: LadElement, path: number[]): LadElement | null {
  if (path.length === 0) return null;
  const [i, ...rest] = path;
  if (root.kind !== "series" && root.kind !== "parallel") return root;
  let elements: LadElement[];
  if (rest.length === 0) {
    elements = root.elements.filter((_, idx) => idx !== i);
  } else {
    const nc = removeElementAtPath(root.elements[i], rest);
    elements = nc === null ? root.elements.filter((_, idx) => idx !== i) : root.elements.map((c, idx) => (idx === i ? nc : c));
  }
  if (elements.length === 0) return null;
  if (elements.length === 1) return elements[0]; // collapse a single-child series/parallel
  return { ...root, elements };
}
function appendContactSeries(root: LadElement): LadElement {
  if (root.kind === "series") return { ...root, elements: [...root.elements, newContact()] };
  return { kind: "series", elements: [root, newContact()] };
}

function ladUpdateContact(body: LadBody, ri: number, path: number[], patch: Partial<LadContact>): LadBody {
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, logic: mapElementAtPath(r.logic, path, (el) => (el.kind === "contact" ? { ...el, ...patch } : el)) })) };
}
function ladWrapParallel(body: LadBody, ri: number, path: number[]): LadBody {
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, logic: mapElementAtPath(r.logic, path, (el) => ({ kind: "parallel", elements: [el, newContact()] })) })) };
}
function ladAddContact(body: LadBody, ri: number): LadBody {
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, logic: appendContactSeries(r.logic) })) };
}
function ladRemoveContact(body: LadBody, ri: number, path: number[]): LadBody {
  const rung = body.networks[ri];
  if (!rung) return body;
  const nl = removeElementAtPath(rung.logic, path);
  if (nl === null) return { ...body, networks: body.networks.filter((_, i) => i !== ri) }; // whole network gone → drop rung
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, logic: nl })) };
}
function ladUpdateCoil(body: LadBody, ri: number, ci: number, patch: Partial<LadCoil>): LadBody {
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, coils: r.coils.map((c, j) => (j === ci ? { ...c, ...patch } : c)) })) };
}
function ladAddCoil(body: LadBody, ri: number): LadBody {
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, coils: [...r.coils, { variable: "X", kind: "coil" }] })) };
}
function ladRemoveCoil(body: LadBody, ri: number, ci: number): LadBody {
  const rung = body.networks[ri];
  if (!rung || rung.coils.length <= 1) return body; // a rung must drive ≥1 coil
  return { ...body, networks: body.networks.map((r, i) => (i !== ri ? r : { ...r, coils: r.coils.filter((_, j) => j !== ci) })) };
}
function ladAddRung(body: LadBody): LadBody {
  return { ...body, networks: [...body.networks, { logic: newContact(), coils: [{ variable: "Y", kind: "coil" }] }] };
}

// ══════════════════════════════════════════════════════════════════════════════
// FBD — layered DAG. A block sits one column right of its deepest block-input.
// var/const sources sit to the left; output assignments sit in the last column.
// ══════════════════════════════════════════════════════════════════════════════
function buildFbd(body: FbdBody, ctxDiags: Map<string, PouCanvasDiag[]>, selectedId: string | null): { nodes: PouNode[]; edges: Edge[] } {
  const outNodes: PouNode[] = [];
  const outEdges: Edge[] = [];
  const edge = makeEdgeFactory();
  let yOff = 0;

  (body.networks ?? []).forEach((net, ni) => {
    const netRef = net.id ?? `net${ni + 1}`;
    const diags = ctxDiags.get(netRef) ?? [];
    const blocks = net.blocks ?? [];
    const outputs = net.outputs ?? [];
    const byId = new Map(blocks.map((b) => [b.id, b]));

    // dependency depth (blocks are depth ≥ 1; var/const inputs are depth 0)
    const depthMemo = new Map<string, number>();
    const depth = (id: string, stack: Set<string> = new Set()): number => {
      const memo = depthMemo.get(id);
      if (memo !== undefined) return memo;
      if (stack.has(id)) return 1;
      const b = byId.get(id);
      if (!b) return 0;
      stack.add(id);
      let d = 1;
      for (const inp of b.inputs) if (inp.source.kind === "block") d = Math.max(d, 1 + depth(inp.source.blockId, stack));
      stack.delete(id);
      depthMemo.set(id, d);
      return d;
    };
    const blockCol = new Map<string, number>();
    let maxCol = 0;
    blocks.forEach((b) => { const c = depth(b.id); blockCol.set(b.id, c); maxCol = Math.max(maxCol, c); });
    const outCol = maxCol + 1;

    const local: PouNode[] = [];
    const localEdges: Edge[] = [];
    const colY = new Map<number, number>();
    const place = (col: number, h: number): number => { const y = colY.get(col) ?? 0; colY.set(col, y + h + FBD_VGAP); return y; };

    // var source nodes (col 0) — one per unique name
    const varMade = new Map<string, string>();
    const ensureVar = (name: string): string => {
      const existing = varMade.get(name);
      if (existing) return existing;
      const id = fbdVarId(ni, name);
      varMade.set(name, id);
      const tt = varTone(diags, name);
      local.push({ id, type: "pou", position: { x: 0, y: place(0, SRC_H) }, selectable: false, draggable: false, data: { kind: "fbdSource", orient: "h", selected: false, hasError: tt.hasError, hasWarn: tt.hasWarn, label: name, srcKind: "var" } });
      return id;
    };

    // blocks, placed per column
    blocks.forEach((b) => {
      const col = blockCol.get(b.id) ?? 1;
      const pins = b.inputs.map((i) => i.name);
      const boxH = FBLOCK_BASE + Math.max(1, pins.length) * FBLOCK_PIN;
      const id = fbdBlockId(ni, b.id);
      const tt = textTone(diags, `block ${b.id} `);
      local.push({
        id, type: "pou", position: { x: col * COLW, y: place(col, boxH) }, selectable: true, deletable: true, draggable: false,
        selected: selectedId === id,
        data: { kind: "fbdBlock", orient: "h", selected: selectedId === id, hasError: tt.hasError, hasWarn: tt.hasWarn, op: b.type, refId: b.id, pins, boxH },
      });
    });

    // input edges (+ const source nodes)
    blocks.forEach((b) => {
      const bId = fbdBlockId(ni, b.id);
      b.inputs.forEach((inp) => {
        if (inp.source.kind === "var") localEdges.push(edge(ensureVar(inp.source.name), bId, { label: inp.name, arrow: true }));
        else if (inp.source.kind === "const") {
          const col = Math.max(0, (blockCol.get(b.id) ?? 1) - 1);
          const id = fbdConstId(ni, `${b.id}.${inp.name}`);
          local.push({ id, type: "pou", position: { x: col * COLW, y: place(col, SRC_H) }, selectable: false, draggable: false, data: { kind: "fbdSource", orient: "h", selected: false, hasError: false, hasWarn: false, label: String(inp.source.value), srcKind: "const" } });
          localEdges.push(edge(id, bId, { label: inp.name, arrow: true }));
        } else localEdges.push(edge(fbdBlockId(ni, inp.source.blockId), bId, { label: inp.name, arrow: true }));
      });
    });

    // outputs (last column) + their source edges
    outputs.forEach((o, oi) => {
      const id = fbdOutputId(ni, oi);
      const tt = textTone(diags, `output "${o.variable}"`);
      local.push({ id, type: "pou", position: { x: outCol * COLW, y: place(outCol, SRC_H) }, selectable: true, deletable: true, draggable: false, selected: selectedId === id, data: { kind: "fbdOutput", orient: "h", selected: selectedId === id, hasError: tt.hasError, hasWarn: tt.hasWarn, label: `→ ${o.variable}` } });
      if (o.source.kind === "var") localEdges.push(edge(ensureVar(o.source.name), id, { arrow: true }));
      else if (o.source.kind === "const") {
        const cid = fbdConstId(ni, `out${oi}`);
        local.push({ id: cid, type: "pou", position: { x: 0, y: place(0, SRC_H) }, selectable: false, draggable: false, data: { kind: "fbdSource", orient: "h", selected: false, hasError: false, hasWarn: false, label: String(o.source.value), srcKind: "const" } });
        localEdges.push(edge(cid, id, { arrow: true }));
      } else localEdges.push(edge(fbdBlockId(ni, o.source.blockId), id, { arrow: true }));
    });

    const netHeight = Math.max(CH, ...[...colY.values()]);
    outNodes.push(...offset(local, 0, yOff));
    outEdges.push(...localEdges);
    yOff += netHeight + RUNG_VGAP;
  });

  return { nodes: outNodes, edges: outEdges };
}

// ── FBD edit helpers (immutable) — all address a network by index `ni` ────────
function coerceConst(raw: string): number | boolean | string {
  if (raw === "true") return true;
  if (raw === "false") return false;
  const n = Number(raw);
  if (raw.trim() !== "" && !Number.isNaN(n)) return n;
  return raw;
}
function genBlockId(net: FbdBody["networks"][number]): string {
  const ids = new Set((net.blocks ?? []).map((b) => b.id));
  let n = 1;
  while (ids.has(`b${n}`)) n++;
  return `b${n}`;
}
const mapNet = (body: FbdBody, ni: number, fn: (n: FbdBody["networks"][number]) => FbdBody["networks"][number]): FbdBody =>
  ({ ...body, networks: body.networks.map((n, i) => (i === ni ? fn(n) : n)) });

function fbdUpdateBlock(body: FbdBody, ni: number, blockId: string, patch: { type?: string }): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }));
}
function fbdUpdateInput(body: FbdBody, ni: number, blockId: string, idx: number, source: FbdSource): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === blockId ? { ...b, inputs: b.inputs.map((inp, j) => (j === idx ? { ...inp, source } : inp)) } : b)) }));
}
function fbdAddInput(body: FbdBody, ni: number, blockId: string): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === blockId ? { ...b, inputs: [...b.inputs, { name: `IN${b.inputs.length + 1}`, source: { kind: "const", value: true } }] } : b)) }));
}
function fbdRemoveInput(body: FbdBody, ni: number, blockId: string, idx: number): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, blocks: n.blocks.map((b) => (b.id === blockId && b.inputs.length > 1 ? { ...b, inputs: b.inputs.filter((_, j) => j !== idx) } : b)) }));
}
function fbdAddBlock(body: FbdBody, ni: number): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, blocks: [...n.blocks, { id: genBlockId(n), type: "AND", inputs: [{ name: "IN1", source: { kind: "const", value: true } }, { name: "IN2", source: { kind: "const", value: true } }] }] }));
}
function fbdRemoveBlock(body: FbdBody, ni: number, blockId: string): FbdBody {
  const sweep = (s: FbdSource): FbdSource => (s.kind === "block" && s.blockId === blockId ? { kind: "const", value: 0 } : s);
  return mapNet(body, ni, (n) => ({
    ...n,
    blocks: n.blocks.filter((b) => b.id !== blockId).map((b) => ({ ...b, inputs: b.inputs.map((inp) => ({ ...inp, source: sweep(inp.source) })) })),
    outputs: n.outputs.map((o) => ({ ...o, source: sweep(o.source) })),
  }));
}
function fbdAddOutput(body: FbdBody, ni: number): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, outputs: [...n.outputs, { variable: "OUT", source: { kind: "const", value: true } }] }));
}
function fbdUpdateOutput(body: FbdBody, ni: number, oi: number, patch: { variable?: string; source?: FbdSource }): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, outputs: n.outputs.map((o, j) => (j === oi ? { ...o, ...patch } : o)) }));
}
function fbdRemoveOutput(body: FbdBody, ni: number, oi: number): FbdBody {
  return mapNet(body, ni, (n) => ({ ...n, outputs: n.outputs.filter((_, j) => j !== oi) }));
}

// ══════════════════════════════════════════════════════════════════════════════
// SFC — steps in a vertical column; each transition is a bar node between steps.
// ══════════════════════════════════════════════════════════════════════════════
function buildSfc(body: SfcBody, ctxDiags: Map<string, PouCanvasDiag[]>, selectedId: string | null): { nodes: PouNode[]; edges: Edge[] } {
  const nodes: PouNode[] = [];
  const edges: Edge[] = [];
  const edge = makeEdgeFactory();
  const steps = body.steps ?? [];
  const transitions = body.transitions ?? [];
  const stepY = (i: number) => i * (STEP_H + SFC_VGAP);
  const idxOf = new Map(steps.map((s, i) => [s.name, i] as const));

  // collect step-level diagnostics (unreachable-step & action refs use ref === step.name)
  const allDiags: PouCanvasDiag[] = [];
  ctxDiags.forEach((list) => allDiags.push(...list));

  steps.forEach((s, i) => {
    const id = sfcStepId(i);
    const tt = refTone(allDiags, s.name);
    nodes.push({
      id, type: "pou", position: { x: SFC_X, y: stepY(i) }, selectable: true, deletable: true, draggable: false,
      selected: selectedId === id,
      data: { kind: "sfcStep", orient: "v", selected: selectedId === id, hasError: tt.hasError, hasWarn: tt.hasWarn, label: s.name, initial: !!s.initial, actionCount: (s.actions ?? []).length },
    });
  });

  transitions.forEach((tr, ti) => {
    const id = sfcTransId(ti);
    const ref = tr.id ?? `${tr.from}->${tr.to}`;
    const tt = refTone(allDiags, ref);
    const from = idxOf.get(tr.from);
    const to = idxOf.get(tr.to);
    let x = SFC_X + (STEP_W - TRANS_W) / 2;
    let y = stepY(steps.length) + ti * (TRANS_H + FBD_VGAP); // fallback lane below
    if (from !== undefined && to !== undefined) {
      const side = to <= from || Math.abs(to - from) > 1;
      x = side ? SFC_X + STEP_W + 72 : SFC_X + (STEP_W - TRANS_W) / 2;
      y = side ? (stepY(from) + stepY(to)) / 2 + (STEP_H - TRANS_H) / 2 : (stepY(from) + STEP_H + stepY(to)) / 2 - TRANS_H / 2;
    }
    nodes.push({
      id, type: "pou", position: { x, y }, selectable: true, deletable: true, draggable: false,
      selected: selectedId === id,
      data: { kind: "sfcTransition", orient: "v", selected: selectedId === id, hasError: tt.hasError, hasWarn: tt.hasWarn, label: tr.condition },
    });
    if (from !== undefined) edges.push(edge(sfcStepId(from), id, { arrow: true }));
    if (to !== undefined) edges.push(edge(id, sfcStepId(to), { arrow: true }));
  });

  return { nodes, edges };
}

// ── SFC edit helpers (immutable) ──────────────────────────────────────────────
function uniqueStepName(steps: SfcBody["steps"], base = "Step"): string {
  const names = new Set(steps.map((s) => s.name));
  let n = 1;
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}
function sfcUpdateStep(body: SfcBody, i: number, patch: { name?: string; initial?: boolean; actions?: SfcAction[] }): SfcBody {
  return { ...body, steps: body.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) };
}
function sfcAddStep(body: SfcBody): SfcBody {
  return { ...body, steps: [...body.steps, { name: uniqueStepName(body.steps), actions: [] }] };
}
function sfcRemoveStep(body: SfcBody, i: number): SfcBody {
  if (body.steps.length <= 1) return body; // SFC needs ≥1 step
  const name = body.steps[i]?.name;
  return {
    ...body,
    steps: body.steps.filter((_, j) => j !== i),
    transitions: body.transitions.filter((t) => t.from !== name && t.to !== name),
  };
}
function sfcUpdateTransition(body: SfcBody, i: number, patch: { from?: string; to?: string; condition?: string }): SfcBody {
  return { ...body, transitions: body.transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)) };
}
function sfcAddTransition(body: SfcBody): SfcBody {
  const from = body.steps[0]?.name ?? "Init";
  const to = body.steps[1]?.name ?? from;
  return { ...body, transitions: [...body.transitions, { from, to, condition: "TRUE" }] };
}
function sfcRemoveTransition(body: SfcBody, i: number): SfcBody {
  return { ...body, transitions: body.transitions.filter((_, j) => j !== i) };
}

// ══════════════════════════════════════════════════════════════════════════════
// INSPECTOR building blocks
// ══════════════════════════════════════════════════════════════════════════════
const FBD_OPS = ["AND", "OR", "XOR", "NOT", "ADD", "SUB", "MUL", "DIV", "MOD", "GT", "LT", "GE", "LE", "EQ", "NE", "MOVE"];
const QUALIFIERS: SfcQualifier[] = ["N", "S", "R", "P", "L", "D"];
// IEC 61131-3 elementary types + variable sections (mirror pouModel's zod enums) for the
// Variables panel selects. Order = the common-first authoring order.
const IEC_TYPES: IecType[] = [
  "BOOL", "INT", "DINT", "REAL", "LREAL", "TIME",
  "BYTE", "WORD", "DWORD", "LWORD", "SINT", "LINT",
  "USINT", "UINT", "UDINT", "ULINT", "DATE", "TOD", "DT", "STRING", "WSTRING",
];
const VAR_SECTIONS: VarSection[] = [
  "VAR", "VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_TEMP", "VAR_GLOBAL", "VAR_EXTERNAL",
];

/** A text field with a datalist of declared variables (free entry still allowed). */
function VarInput({ value, vars, onChange, placeholder }: { value: string; vars: string[]; onChange: (v: string) => void; placeholder?: string }) {
  const listId = useId();
  return (
    <>
      <Input className="h-8 font-mono text-sm" list={listId} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>{vars.map((v) => <option key={v} value={v} />)}</datalist>
    </>
  );
}

/** Edit one FBD source (var / const / block-output). */
function SourceEditor({ source, onChange, vars, blockIds, t }: { source: FbdSource; onChange: (s: FbdSource) => void; vars: string[]; blockIds: string[]; t: TFunction }) {
  return (
    <div className="space-y-1 rounded border border-dashed border-border/70 p-1.5">
      <Select
        value={source.kind}
        onValueChange={(k) => onChange(k === "var" ? { kind: "var", name: vars[0] ?? "X" } : k === "block" ? { kind: "block", blockId: blockIds[0] ?? "" } : { kind: "const", value: 0 })}
      >
        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="var">{t("pou.src.var", "variable")}</SelectItem>
          <SelectItem value="const">{t("pou.src.const", "constant")}</SelectItem>
          <SelectItem value="block">{t("pou.src.block", "block output")}</SelectItem>
        </SelectContent>
      </Select>
      {source.kind === "var" && <VarInput value={source.name} vars={vars} onChange={(name) => onChange({ kind: "var", name })} />}
      {source.kind === "const" && <Input className="h-8 text-sm" value={String(source.value)} onChange={(e) => onChange({ kind: "const", value: coerceConst(e.target.value) })} />}
      {source.kind === "block" && (
        <Select value={source.blockId} onValueChange={(blockId) => onChange({ kind: "block", blockId })}>
          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="block id" /></SelectTrigger>
          <SelectContent>{blockIds.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
        </Select>
      )}
    </div>
  );
}

/**
 * VARIABLES panel — add / edit / delete the POU's VAR_* declarations (name + type + section +
 * initial + address). Writes straight back into `PouProject.pous[i].vars` via `onChange`, so the
 * declared identifiers immediately feed the contact/coil/source datalists and the linter.
 */
function VarsEditor({ vars, onChange, t }: { vars: PouVar[]; onChange: (next: PouVar[]) => void; t: TFunction }) {
  const uniqueName = (base = "Var"): string => {
    const names = new Set(vars.map((v) => v.name));
    let n = 1;
    while (names.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  };
  const add = () => onChange([...vars, { name: uniqueName(), type: "BOOL", section: "VAR" }]);
  const update = (i: number, patch: Partial<PouVar>) => onChange(vars.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const remove = (i: number) => onChange(vars.filter((_, j) => j !== i));
  return (
    <div className="space-y-1.5">
      <div className="max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
        {vars.length === 0 && (
          <div className="rounded border border-dashed border-border/70 p-2 text-center text-[11px] text-muted-foreground">
            {t("pou.vars.empty", "No variables declared yet.")}
          </div>
        )}
        {vars.map((v, i) => (
          <div key={i} className="space-y-1 rounded border border-border/60 p-1.5">
            <div className="flex items-center gap-1">
              <Input className="h-7 flex-1 font-mono text-xs" value={v.name} placeholder={t("pou.vars.name", "name")} onChange={(e) => update(i, { name: e.target.value })} />
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 text-destructive" onClick={() => remove(i)} aria-label={t("common.delete", "Delete")}><Trash2 className="h-3 w-3" /></Button>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Select value={v.type} onValueChange={(x) => update(i, { type: x as IecType })}>
                <SelectTrigger className="h-7 text-xs" aria-label={t("pou.vars.type", "Type")}><SelectValue /></SelectTrigger>
                <SelectContent>{IEC_TYPES.map((ty) => <SelectItem key={ty} value={ty}>{ty}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={v.section ?? "VAR"} onValueChange={(x) => update(i, { section: x as VarSection })}>
                <SelectTrigger className="h-7 text-xs" aria-label={t("pou.vars.section", "Section")}><SelectValue /></SelectTrigger>
                <SelectContent>{VAR_SECTIONS.map((se) => <SelectItem key={se} value={se}>{se}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <Input className="h-7 font-mono text-[11px]" value={v.initial ?? ""} placeholder={t("pou.vars.initial", "initial")} onChange={(e) => update(i, { initial: e.target.value || undefined })} />
              <Input className="h-7 font-mono text-[11px]" value={v.address ?? ""} placeholder={t("pou.vars.address", "%IX0.0")} onChange={(e) => update(i, { address: e.target.value || undefined })} />
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-7 w-full justify-start gap-1 text-xs" onClick={add}>
        <Plus className="h-3.5 w-3.5" />{t("pou.vars.add", "Add variable")}
      </Button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// CANVAS (inner — under a ReactFlowProvider)
// ══════════════════════════════════════════════════════════════════════════════
export interface PouCanvasProps {
  project: PouProject;
  pouIndex: number;
  /** rung/net/step-level diagnostics for the selected POU, keyed by lint `ref`. */
  diagsByRef: Map<string, PouCanvasDiag[]>;
  onChange: (project: PouProject) => void;
  t: TFunction;
}

const PANEL_CARD = "rounded-md border border-border bg-card/95 p-2 shadow-md backdrop-blur";

function CanvasInner({ project, pouIndex, diagsByRef, onChange, t }: PouCanvasProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showVars, setShowVars] = useState(false); // Variables panel (collapsed by default)

  const pou = project.pous[pouIndex];
  const body = pou?.body;
  const language = body?.language;

  const allVars = useMemo(() => (pou?.vars ?? []).map((v) => v.name), [pou]);
  const boolVars = useMemo(() => (pou?.vars ?? []).filter((v) => v.type === "BOOL").map((v) => v.name), [pou]);

  const { nodes, edges } = useMemo(() => {
    if (!body) return { nodes: [] as PouNode[], edges: [] as Edge[] };
    if (body.language === "LD") return buildLad(body, diagsByRef, selectedId);
    if (body.language === "FBD") return buildFbd(body, diagsByRef, selectedId);
    if (body.language === "SFC") return buildSfc(body, diagsByRef, selectedId);
    return { nodes: [] as PouNode[], edges: [] as Edge[] };
  }, [body, diagsByRef, selectedId]);

  const commit = useCallback((next: PouBody) => {
    if (!pou) return;
    onChange({ ...project, pous: project.pous.map((p, i) => (i === pouIndex ? { ...p, body: next } : p)) });
  }, [project, pouIndex, pou, onChange]);

  // Variables edits write back into pous[i].vars (same single-source-of-truth path as body edits).
  const commitVars = useCallback((nextVars: PouVar[]) => {
    if (!pou) return;
    onChange({ ...project, pous: project.pous.map((p, i) => (i === pouIndex ? { ...p, vars: nextVars } : p)) });
  }, [project, pouIndex, pou, onChange]);

  const deleteNode = useCallback((id: string) => {
    if (!body) return;
    const d = decode(id);
    if (body.language === "LD") {
      if (d.tag === "ct") commit(ladRemoveContact(body, d.rung, d.path));
      else if (d.tag === "co") commit(ladRemoveCoil(body, d.rung, d.coil));
    } else if (body.language === "FBD") {
      if (d.tag === "blk") commit(fbdRemoveBlock(body, d.net, d.blockId));
      else if (d.tag === "out") commit(fbdRemoveOutput(body, d.net, d.out));
    } else if (body.language === "SFC") {
      if (d.tag === "stp") commit(sfcRemoveStep(body, d.step));
      else if (d.tag === "trn") commit(sfcRemoveTransition(body, d.trans));
    }
    setSelectedId((cur) => (cur === id ? null : cur));
  }, [body, commit]);

  const onNodeClick: NodeMouseHandler = useCallback((_e, node) => {
    setSelectedId(SELECTABLE.has(node.id.split(SEP)[0]) ? node.id : null);
  }, []);
  const onNodesDelete = useCallback((deleted: Node[]) => { for (const n of deleted) deleteNode(n.id); }, [deleteNode]);

  // ── palette add-target (the selected node's rung/net, else the first) ────────
  const selDecoded = selectedId ? decode(selectedId) : null;
  const targetRung = selDecoded && (selDecoded.tag === "ct" || selDecoded.tag === "co") ? selDecoded.rung : 0;
  const targetNet = selDecoded && (selDecoded.tag === "blk" || selDecoded.tag === "out") ? selDecoded.net : 0;

  // ── inspector (no hooks inside; safe to call conditionally) ──────────────────
  function renderInspector() {
    if (!body || !selectedId) return null;
    const d = decode(selectedId);
    const del = (
      <Button size="sm" variant="ghost" className="h-7 w-full justify-start text-destructive hover:bg-destructive/10" onClick={() => deleteNode(selectedId)}>
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />{t("common.delete", "Delete")}
      </Button>
    );

    if (body.language === "LD" && d.tag === "ct") {
      const rung = body.networks[d.rung];
      if (!rung) return null;
      const el = getElementAtPath(rung.logic, d.path);
      if (!el || el.kind !== "contact") return null;
      return (
        <div className="space-y-2">
          <Badge variant="outline" className="font-mono text-[11px]">contact</Badge>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.variable", "Variable")}</Label>
            <VarInput value={el.variable} vars={boolVars} onChange={(v) => commit(ladUpdateContact(body, d.rung, d.path, { variable: v }))} />
          </div>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.contactType", "Contact type")}</Label>
            <Select value={el.negated ? "nc" : "no"} onValueChange={(v) => commit(ladUpdateContact(body, d.rung, d.path, { negated: v === "nc" }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no">{t("pou.field.no", "Normally open (NO)")}</SelectItem>
                <SelectItem value="nc">{t("pou.field.nc", "Normally closed (NC)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" variant="outline" className="h-7 w-full justify-start" onClick={() => commit(ladWrapParallel(body, d.rung, d.path))}>
            <GitBranch className="mr-1.5 h-3.5 w-3.5" />{t("pou.field.addOr", "Add parallel (OR) branch")}
          </Button>
          {del}
        </div>
      );
    }
    if (body.language === "LD" && d.tag === "co") {
      const c = body.networks[d.rung]?.coils[d.coil];
      if (!c) return null;
      return (
        <div className="space-y-2">
          <Badge variant="outline" className="font-mono text-[11px]">coil</Badge>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.variable", "Variable")}</Label>
            <VarInput value={c.variable} vars={boolVars} onChange={(v) => commit(ladUpdateCoil(body, d.rung, d.coil, { variable: v }))} />
          </div>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.coilMode", "Coil mode")}</Label>
            <Select value={c.kind ?? "coil"} onValueChange={(v) => commit(ladUpdateCoil(body, d.rung, d.coil, { kind: v as LadCoil["kind"] }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="coil">{t("pou.field.coilNormal", "Normal ( )")}</SelectItem>
                <SelectItem value="negated">{t("pou.field.coilNeg", "Negated (/)")}</SelectItem>
                <SelectItem value="set">{t("pou.field.coilSet", "Set (S)")}</SelectItem>
                <SelectItem value="reset">{t("pou.field.coilReset", "Reset (R)")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {del}
        </div>
      );
    }
    if (body.language === "FBD" && d.tag === "blk") {
      const net = body.networks[d.net];
      const b = net?.blocks.find((x) => x.id === d.blockId);
      if (!b) return null;
      const otherBlocks = net.blocks.filter((x) => x.id !== b.id).map((x) => x.id);
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2"><Badge variant="outline" className="font-mono text-[11px]">block</Badge><span className="font-mono text-[11px] text-muted-foreground">{b.id}</span></div>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.operator", "Operator")}</Label>
            <VarInput value={b.type} vars={FBD_OPS} onChange={(v) => commit(fbdUpdateBlock(body, d.net, b.id, { type: v }))} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between"><Label className="text-[11px]">{t("pou.field.inputs", "Inputs")}</Label>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => commit(fbdAddInput(body, d.net, b.id))}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            {b.inputs.map((inp, ii) => (
              <div key={ii} className="space-y-1 rounded border border-border/60 p-1.5">
                <div className="flex items-center justify-between"><span className="font-mono text-[10px] text-muted-foreground">{inp.name}</span>
                  {b.inputs.length > 1 && <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive" onClick={() => commit(fbdRemoveInput(body, d.net, b.id, ii))}><Trash2 className="h-3 w-3" /></Button>}
                </div>
                <SourceEditor source={inp.source} vars={allVars} blockIds={otherBlocks} t={t} onChange={(s) => commit(fbdUpdateInput(body, d.net, b.id, ii, s))} />
              </div>
            ))}
          </div>
          {del}
        </div>
      );
    }
    if (body.language === "FBD" && d.tag === "out") {
      const net = body.networks[d.net];
      const o = net?.outputs[d.out];
      if (!o) return null;
      const blockIds = net.blocks.map((x) => x.id);
      return (
        <div className="space-y-2">
          <Badge variant="outline" className="font-mono text-[11px]">output</Badge>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.variable", "Variable")}</Label>
            <VarInput value={o.variable} vars={allVars} onChange={(v) => commit(fbdUpdateOutput(body, d.net, d.out, { variable: v }))} />
          </div>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.source", "Source")}</Label>
            <SourceEditor source={o.source} vars={allVars} blockIds={blockIds} t={t} onChange={(s) => commit(fbdUpdateOutput(body, d.net, d.out, { source: s }))} />
          </div>
          {del}
        </div>
      );
    }
    if (body.language === "SFC" && d.tag === "stp") {
      const s = body.steps[d.step];
      if (!s) return null;
      const actions = s.actions ?? [];
      return (
        <div className="space-y-2">
          <Badge variant="outline" className="font-mono text-[11px]">step</Badge>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.stepName", "Step name")}</Label>
            <Input className="h-8 font-mono text-sm" value={s.name} onChange={(e) => commit(sfcUpdateStep(body, d.step, { name: e.target.value }))} />
          </div>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.initial", "Initial step")}</Label>
            <Select value={s.initial ? "yes" : "no"} onValueChange={(v) => commit(sfcUpdateStep(body, d.step, { initial: v === "yes" }))}>
              <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="yes">{t("common.yes", "Yes")}</SelectItem><SelectItem value="no">{t("common.no", "No")}</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between"><Label className="text-[11px]">{t("pou.field.actions", "Actions")}</Label>
              <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => commit(sfcUpdateStep(body, d.step, { actions: [...actions, { qualifier: "N", actionText: "" }] }))}><Plus className="h-3.5 w-3.5" /></Button>
            </div>
            {actions.map((a, ai) => (
              <div key={ai} className="space-y-1 rounded border border-border/60 p-1.5">
                <div className="flex items-center gap-1">
                  <Select value={a.qualifier ?? "N"} onValueChange={(q) => commit(sfcUpdateStep(body, d.step, { actions: actions.map((x, j) => (j === ai ? { ...x, qualifier: q as SfcQualifier } : x)) }))}>
                    <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{QUALIFIERS.map((q) => <SelectItem key={q} value={q}>{q}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => commit(sfcUpdateStep(body, d.step, { actions: actions.filter((_, j) => j !== ai) }))}><Trash2 className="h-3 w-3" /></Button>
                </div>
                <Textarea className="min-h-[52px] font-mono text-[11px]" value={a.actionText} placeholder="Lamp := TRUE;" onChange={(e) => commit(sfcUpdateStep(body, d.step, { actions: actions.map((x, j) => (j === ai ? { ...x, actionText: e.target.value } : x)) }))} />
              </div>
            ))}
          </div>
          {del}
        </div>
      );
    }
    if (body.language === "SFC" && d.tag === "trn") {
      const tr = body.transitions[d.trans];
      if (!tr) return null;
      const stepNames = body.steps.map((s) => s.name);
      return (
        <div className="space-y-2">
          <Badge variant="outline" className="font-mono text-[11px]">transition</Badge>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.from", "From")}</Label>
              <Select value={tr.from} onValueChange={(v) => commit(sfcUpdateTransition(body, d.trans, { from: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{stepNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.to", "To")}</Label>
              <Select value={tr.to} onValueChange={(v) => commit(sfcUpdateTransition(body, d.trans, { to: v }))}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{stepNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1"><Label className="text-[11px]">{t("pou.field.condition", "Condition (ST boolean)")}</Label>
            <Input className="h-8 font-mono text-sm" value={tr.condition} onChange={(e) => commit(sfcUpdateTransition(body, d.trans, { condition: e.target.value }))} />
          </div>
          {del}
        </div>
      );
    }
    return null;
  }

  // ── palette (per body language) ─────────────────────────────────────────────
  function renderPalette() {
    if (!body) return null;
    const btn = (icon: ReactNode, label: string, onClick: () => void) => (
      <Button size="sm" variant="outline" className="h-7 justify-start gap-1 text-xs" onClick={onClick}>{icon}{label}</Button>
    );
    return (
      <div className="flex flex-col gap-1">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{t("pou.palette", "Add")} · {language}</div>
        {body.language === "LD" && <>
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.contact", "Contact (series)"), () => commit(ladAddContact(body, targetRung)))}
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.coil", "Coil"), () => commit(ladAddCoil(body, targetRung)))}
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.rung", "Rung"), () => commit(ladAddRung(body)))}
        </>}
        {body.language === "FBD" && <>
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.block", "Block"), () => commit(fbdAddBlock(body, targetNet)))}
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.output", "Output"), () => commit(fbdAddOutput(body, targetNet)))}
        </>}
        {body.language === "SFC" && <>
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.step", "Step"), () => commit(sfcAddStep(body)))}
          {btn(<Plus className="h-3.5 w-3.5" />, t("pou.add.transition", "Transition"), () => commit(sfcAddTransition(body)))}
        </>}
      </div>
    );
  }

  const wrapStyle: CSSProperties = { height: 560 };

  if (!body || language === "ST") {
    return (
      <div style={wrapStyle} className="flex items-center justify-center rounded-md border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        <span className="flex items-center gap-2"><Info className="h-4 w-4" />{language === "ST" ? t("pou.stBody", "This POU uses a textual ST body — edit it in the JSON view.") : t("pou.noBody", "No graphical body to render.")}</span>
      </div>
    );
  }

  return (
    <div style={wrapStyle} className="w-full overflow-hidden rounded-md border border-border bg-muted/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={onNodeClick}
        onNodesDelete={onNodesDelete}
        onPaneClick={() => setSelectedId(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.15}
        maxZoom={2}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-transparent" />
        <MiniMap
          pannable zoomable
          className="!border-border !bg-card"
          nodeColor={(n) => {
            const d = (n as PouNode).data;
            if (d?.hasError) return "var(--destructive)";
            if (d?.hasWarn) return "var(--warning)";
            return "var(--primary)";
          }}
          maskColor="color-mix(in oklch, var(--background) 70%, transparent)"
        />
        <Controls className="!border-border" />
        <Panel position="top-left"><div className={PANEL_CARD}>{renderPalette()}</div></Panel>
        {/* Variables panel (collapsible) — declare/edit VAR_* rows that feed the datalists + linter */}
        <Panel position="bottom-left">
          <div className={PANEL_CARD}>
            <button
              type="button"
              onClick={() => setShowVars((s) => !s)}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              aria-expanded={showVars}
            >
              <Variable className="h-3 w-3" />{t("pou.vars.title", "Variables")} · {pou?.vars?.length ?? 0}
              <ChevronDown className={`h-3 w-3 transition-transform ${showVars ? "" : "-rotate-90"}`} />
            </button>
            {showVars && <div className="mt-1.5 w-[300px]"><VarsEditor vars={pou?.vars ?? []} onChange={commitVars} t={t} /></div>}
          </div>
        </Panel>
        {selectedId && (
          <Panel position="top-right">
            <div className={`${PANEL_CARD} max-h-[520px] w-[280px] overflow-y-auto`}>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("pou.inspector", "Inspector")}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setSelectedId(null)} aria-label={t("common.close", "Close")}>✕</Button>
              </div>
              {renderInspector()}
            </div>
          </Panel>
        )}
      </ReactFlow>
    </div>
  );
}

/**
 * The graphical POU canvas. Wraps CanvasInner in a ReactFlowProvider. The POU MODEL is the
 * single source of truth — every edit produces a new project via `onChange`, which the parent
 * serialises back into the JSON view (so JSON ↔ canvas ↔ PLCopen ↔ transpile never diverge).
 */
export function PouCanvas(props: PouCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export default PouCanvas;
