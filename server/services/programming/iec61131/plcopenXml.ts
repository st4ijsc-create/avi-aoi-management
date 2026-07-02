/**
 * Doc 24 Wave-3 / P4 — PLCopen TC6 XML import / export for the IEC 61131-3 POU model.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The INTEROPERABILITY layer: serialise the structured POU model (pouModel.ts) to the
 * PLCopen Technical Committee 6 (TC6) XML interchange format — the vendor-neutral format
 * CODESYS / Beremiz / TwinCAT and others import/export — and parse it back. The pair is
 * designed to be INVERSE functions so a round-trip is STRUCTURALLY STABLE
 * (import(export(model)) is a fixpoint: exporting + re-importing it yields an equal model).
 *
 * Design for round-trip stability (we own BOTH ends):
 *   • Standards-shaped structure: <project><types><pous><pou><interface>…</interface>
 *     <body><LD|FBD|SFC|ST>…</body></pou></pous></types></project>.
 *   • Interface vars map 1:1 onto PLCopen containers (inputVars/outputVars/localVars/…).
 *   • Graphical bodies are emitted as standard positioned elements (contact/coil, block/
 *     inVariable/outVariable, step/transition/actionBlock) with localId + connectionPointIn
 *     refLocalId wiring. Multiple LD/FBD networks are grouped by a deterministic y-band on
 *     the element position (network n → y in [n*1000, (n+1)*1000)); the importer regroups by
 *     that band and reconstructs each network's series/parallel graph.
 *
 * SAFETY: PURE data transform. No device path, no eval, no filesystem — a string in, a
 * string/model out. The imported model still only reaches hardware via the gated
 * programmingService (OpenPLC / open runtime; E-stop / SIL stays on the certified L1 PLC).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import {
  parsePouProject,
  type PouProject, type Pou, type PouVar, type VarSection, type IecType,
  type LadElement, type LadRung, type LadCoil,
  type FbdNetwork, type FbdBlock, type FbdSource, type FbdAssign,
  type SfcBody, type SfcStep, type SfcTransition, type SfcAction, type SfcQualifier,
} from "./pouModel";

const PLCOPEN_NS = "http://www.plcopen.org/xml/tc6_0201";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

// ── PLCopen var container ⇄ model section ─────────────────────────────────────
const SECTION_TO_CONTAINER: Record<VarSection, string> = {
  VAR_INPUT: "inputVars",
  VAR_OUTPUT: "outputVars",
  VAR_IN_OUT: "inOutVars",
  VAR_EXTERNAL: "externalVars",
  VAR_GLOBAL: "globalVars",
  VAR_TEMP: "tempVars",
  VAR: "localVars",
};
const CONTAINER_TO_SECTION: Record<string, VarSection> = Object.fromEntries(
  Object.entries(SECTION_TO_CONTAINER).map(([k, v]) => [v, k as VarSection]),
) as Record<string, VarSection>;

const POU_TYPE_ATTR: Record<Pou["pouType"], string> = {
  program: "program",
  functionBlock: "functionBlock",
  function: "function",
};

// ── fast-xml-parser config (shared) ──────────────────────────────────────────
const REPEATED_TAGS = new Set<string>([
  "pou", "contact", "coil", "block", "inVariable", "outVariable", "connection",
  "step", "transition", "actionBlock", "action", "leftPowerRail", "rightPowerRail",
]);

function makeParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    allowBooleanAttributes: true,
    trimValues: true,
    textNodeName: "#text",
    isArray: (tagName, jpath) => {
      if (REPEATED_TAGS.has(tagName)) return true;
      // block I/O variables repeat; contact/coil `variable` does not.
      const jp = String(jpath);
      if (tagName === "variable" && (jp.endsWith("inputVariables.variable") || jp.endsWith("outputVariables.variable"))) return true;
      return false;
    },
  });
}

function makeBuilder(): XMLBuilder {
  return new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    format: true,
    indentBy: "  ",
    suppressEmptyNode: true,
    // Emit boolean-valued attributes WITH their value (negated="true") so a re-import can
    // read them — without this the builder collapses value-"true" attrs to a bare name and
    // the flag is lost on round-trip.
    suppressBooleanAttributes: false,
    textNodeName: "#text",
  });
}

/** True if a parsed attribute reads as boolean-true (string "true" or a bare boolean attr). */
function attrTrue(v: unknown): boolean {
  return v === "true" || v === true;
}

// ── small helpers ─────────────────────────────────────────────────────────────
function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}
function textOf(node: unknown): string {
  if (node === undefined || node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number" || typeof node === "boolean") return String(node);
  if (typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("#text" in o) return String(o["#text"]);
  }
  return "";
}
function xhtml(text: string): Record<string, unknown> {
  return { "@_xmlns": XHTML_NS, "#text": text };
}
function readXhtml(node: unknown): string {
  // <xhtml>text</xhtml> may parse as string or { "#text":..., "@_xmlns":... }.
  return textOf(node);
}

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT — model → PLCopen TC6 XML
// ══════════════════════════════════════════════════════════════════════════════

/** A localId allocator (unique across one POU body). */
function idGen(): () => string {
  let n = 0;
  return () => String(++n);
}

function buildTypeNode(t: IecType): Record<string, unknown> {
  return { [t]: {} };
}

function buildVariable(v: PouVar): Record<string, unknown> {
  const node: Record<string, unknown> = { "@_name": v.name };
  if (v.address) node["@_address"] = v.address;
  node.type = buildTypeNode(v.type);
  if (v.initial !== undefined && v.initial !== "") {
    node.initialValue = { simpleValue: { "@_value": v.initial } };
  }
  if (v.comment) node.documentation = { xhtml: xhtml(v.comment) };
  return node;
}

function buildInterface(vars: PouVar[]): Record<string, unknown> {
  const iface: Record<string, unknown> = {};
  // Emit containers in a fixed order for deterministic output.
  const order: VarSection[] = ["VAR_INPUT", "VAR_OUTPUT", "VAR_IN_OUT", "VAR_EXTERNAL", "VAR_GLOBAL", "VAR_TEMP", "VAR"];
  for (const section of order) {
    const inSection = vars.filter((v) => (v.section ?? "VAR") === section);
    if (inSection.length === 0) continue;
    iface[SECTION_TO_CONTAINER[section]] = { variable: inSection.map(buildVariable) };
  }
  return iface;
}

// ── LD export ────────────────────────────────────────────────────────────────
interface LdCollector {
  leftPowerRail: Record<string, unknown>[];
  contact: Record<string, unknown>[];
  coil: Record<string, unknown>[];
}

function connIn(refs: string[]): Record<string, unknown> {
  return { connection: refs.map((r) => ({ "@_refLocalId": r })) };
}

/** Emit a LAD element subtree; returns the list of localIds carrying its OUTPUT. */
function emitLadElement(
  el: LadElement,
  inRefs: string[],
  baseY: number,
  col: { x: number },
  next: () => string,
  c: LdCollector,
): string[] {
  switch (el.kind) {
    case "contact": {
      const id = next();
      col.x += 1;
      c.contact.push({
        "@_localId": id,
        ...(el.negated ? { "@_negated": "true" } : {}),
        position: { "@_x": String(col.x * 100), "@_y": String(baseY + 20) },
        connectionPointIn: connIn(inRefs),
        connectionPointOut: {},
        variable: el.variable,
      });
      return [id];
    }
    case "series": {
      let cur = inRefs;
      for (const child of el.elements) cur = emitLadElement(child, cur, baseY, col, next, c);
      return cur;
    }
    case "parallel": {
      const outs: string[] = [];
      for (const child of el.elements) {
        outs.push(...emitLadElement(child, inRefs, baseY, col, next, c));
      }
      return outs;
    }
  }
}

function buildLd(networks: LadRung[]): Record<string, unknown> {
  const next = idGen();
  const c: LdCollector = { leftPowerRail: [], contact: [], coil: [] };
  networks.forEach((rung, n) => {
    const baseY = n * 1000;
    const railId = next();
    c.leftPowerRail.push({
      "@_localId": railId,
      position: { "@_x": "0", "@_y": String(baseY + 20) },
      connectionPointOut: {},
      ...(rung.comment ? { documentation: { xhtml: xhtml(rung.comment) } } : {}),
    });
    const col = { x: 0 };
    const out = emitLadElement(rung.logic, [railId], baseY, col, next, c);
    for (const coil of rung.coils) {
      const id = next();
      col.x += 1;
      const attrs: Record<string, unknown> = { "@_localId": id };
      if (coil.kind === "negated") attrs["@_negated"] = "true";
      else if (coil.kind === "set") attrs["@_storage"] = "set";
      else if (coil.kind === "reset") attrs["@_storage"] = "reset";
      c.coil.push({
        ...attrs,
        position: { "@_x": String((col.x + 1) * 100), "@_y": String(baseY + 20) },
        connectionPointIn: connIn(out),
        connectionPointOut: {},
        variable: coil.variable,
      });
    }
  });
  const ld: Record<string, unknown> = {};
  if (c.leftPowerRail.length) ld.leftPowerRail = c.leftPowerRail;
  if (c.contact.length) ld.contact = c.contact;
  if (c.coil.length) ld.coil = c.coil;
  return ld;
}

// ── FBD export ───────────────────────────────────────────────────────────────
function fbdSourceToRef(
  src: FbdSource,
  baseY: number,
  next: () => string,
  inVars: Record<string, unknown>[],
): { refLocalId: string; pin?: string } {
  if (src.kind === "block") return { refLocalId: src.blockId, pin: src.pin };
  // var / const → an inVariable node.
  const id = next();
  const expr = src.kind === "var" ? src.name : litExpr(src.value);
  inVars.push({
    "@_localId": id,
    position: { "@_x": "0", "@_y": String(baseY) },
    connectionPointOut: {},
    expression: expr,
  });
  return { refLocalId: id };
}

function litExpr(v: number | boolean | string): string {
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(v);
  return `'${v}'`;
}

function buildFbd(networks: FbdNetwork[]): Record<string, unknown> {
  const next = idGen();
  const inVariable: Record<string, unknown>[] = [];
  const outVariable: Record<string, unknown>[] = [];
  const blockNodes: Record<string, unknown>[] = [];

  networks.forEach((net, n) => {
    const baseY = n * 1000;
    // Blocks use their MODEL id as the localId so references round-trip exactly.
    for (const b of net.blocks) {
      const inputVariables = b.inputs.map((inp) => {
        const ref = fbdSourceToRef(inp.source, baseY, next, inVariable);
        const conn: Record<string, unknown> = { "@_refLocalId": ref.refLocalId };
        if (ref.pin) conn["@_formalParameter"] = ref.pin;
        return {
          "@_formalParameter": inp.name,
          connectionPointIn: { connection: [conn] },
        };
      });
      blockNodes.push({
        "@_localId": b.id,
        "@_typeName": b.type,
        position: { "@_x": "300", "@_y": String(baseY) },
        inputVariables: { variable: inputVariables },
        outputVariables: { variable: [{ "@_formalParameter": b.outputPin ?? "OUT" }] },
        ...(b.comment ? { documentation: { xhtml: xhtml(b.comment) } } : {}),
      });
    }
    for (const out of net.outputs) {
      const id = next();
      const ref = fbdSourceToRef(out.source, baseY, next, inVariable);
      const conn: Record<string, unknown> = { "@_refLocalId": ref.refLocalId };
      if (ref.pin) conn["@_formalParameter"] = ref.pin;
      outVariable.push({
        "@_localId": id,
        position: { "@_x": "600", "@_y": String(baseY) },
        connectionPointIn: { connection: [conn] },
        expression: out.variable,
      });
    }
  });

  const fbd: Record<string, unknown> = {};
  if (inVariable.length) fbd.inVariable = inVariable;
  if (blockNodes.length) fbd.block = blockNodes;
  if (outVariable.length) fbd.outVariable = outVariable;
  return fbd;
}

// ── SFC export ───────────────────────────────────────────────────────────────
function buildSfc(body: SfcBody): Record<string, unknown> {
  const next = idGen();
  const stepIdOf = new Map<string, string>();
  const steps: Record<string, unknown>[] = [];
  const transitions: Record<string, unknown>[] = [];
  const actionBlocks: Record<string, unknown>[] = [];

  body.steps.forEach((step, i) => {
    const id = next();
    stepIdOf.set(step.name, id);
    const node: Record<string, unknown> = {
      "@_localId": id,
      "@_name": step.name,
      ...(step.initial ? { "@_initialStep": "true" } : {}),
      position: { "@_x": "100", "@_y": String(i * 100) },
      connectionPointIn: {},
      connectionPointOut: {},
    };
    steps.push(node);
  });

  // transitions wire from-step → transition → to-step.
  body.transitions.forEach((tr) => {
    const id = next();
    const fromId = stepIdOf.get(tr.from);
    transitions.push({
      "@_localId": id,
      position: { "@_x": "100", "@_y": "50" },
      connectionPointIn: fromId ? connIn([fromId]) : {},
      connectionPointOut: {},
      condition: { inline: { ST: { xhtml: xhtml(tr.condition) } } },
    });
    // record the transition→to-step wiring on the to-step's connectionPointIn.
    const toStep = steps.find((s) => s["@_name"] === tr.to);
    if (toStep) {
      const existing = (toStep.connectionPointIn as Record<string, unknown>);
      const conns = asArray((existing.connection as unknown));
      conns.push({ "@_refLocalId": id });
      toStep.connectionPointIn = { connection: conns };
    }
  });

  // step actions → actionBlock wired to the step.
  body.steps.forEach((step) => {
    if (!step.actions || step.actions.length === 0) return;
    const id = next();
    const stepId = stepIdOf.get(step.name)!;
    actionBlocks.push({
      "@_localId": id,
      position: { "@_x": "300", "@_y": "0" },
      connectionPointIn: connIn([stepId]),
      action: step.actions.map((a) => ({
        "@_qualifier": a.qualifier,
        ...(a.name ? { "@_name": a.name } : {}),
        inline: { ST: { xhtml: xhtml(a.actionText) } },
      })),
    });
  });

  const sfc: Record<string, unknown> = { step: steps };
  if (transitions.length) sfc.transition = transitions;
  if (actionBlocks.length) sfc.actionBlock = actionBlocks;
  return sfc;
}

// ── POU + project export ──────────────────────────────────────────────────────
function buildBody(pou: Pou): Record<string, unknown> {
  const b = pou.body;
  switch (b.language) {
    case "LD": return { LD: buildLd(b.networks) };
    case "FBD": return { FBD: buildFbd(b.networks) };
    case "SFC": return { SFC: buildSfc(b) };
    case "ST": return { ST: { xhtml: xhtml(b.text) } };
  }
}

function buildPou(pou: Pou): Record<string, unknown> {
  return {
    "@_name": pou.name,
    "@_pouType": POU_TYPE_ATTR[pou.pouType],
    interface: buildInterface(pou.vars),
    body: buildBody(pou),
    ...(pou.comment ? { documentation: { xhtml: xhtml(pou.comment) } } : {}),
  };
}

/** Serialise a POU project → PLCopen TC6 XML string. Deterministic. */
export function exportPlcopenXml(project: PouProject): string {
  const doc = {
    "?xml": { "@_version": "1.0", "@_encoding": "utf-8" },
    project: {
      "@_xmlns": PLCOPEN_NS,
      fileHeader: {
        "@_companyName": project.fileHeader?.companyName ?? "ST4I",
        "@_productName": project.fileHeader?.productName ?? "AVI-AOI Engineering Workspace",
        "@_productVersion": project.fileHeader?.productVersion ?? "1.0",
        // Fixed timestamp keeps export deterministic (round-trip + golden stable).
        "@_creationDateTime": "2026-01-01T00:00:00",
      },
      contentHeader: {
        "@_name": project.name,
        coordinateInfo: {
          fbd: { scaling: { "@_x": "1", "@_y": "1" } },
          ld: { scaling: { "@_x": "1", "@_y": "1" } },
          sfc: { scaling: { "@_x": "1", "@_y": "1" } },
        },
      },
      types: {
        dataTypes: {},
        pous: { pou: project.pous.map(buildPou) },
      },
      instances: { configurations: {} },
    },
  };
  return makeBuilder().build(doc);
}

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT — PLCopen TC6 XML → model
// ══════════════════════════════════════════════════════════════════════════════

/** Result of an import attempt. */
export type ImportResult =
  | { ok: true; project: PouProject }
  | { ok: false; errors: Array<{ path: string; message: string }> };

function readTypeName(typeNode: unknown): IecType {
  if (typeNode && typeof typeNode === "object") {
    const keys = Object.keys(typeNode as Record<string, unknown>).filter((k) => !k.startsWith("@_") && k !== "#text");
    if (keys[0]) return keys[0] as IecType;
  }
  return "BOOL";
}

function readVariable(node: Record<string, unknown>, section: VarSection): PouVar {
  const v: PouVar = {
    name: String(node["@_name"] ?? ""),
    type: readTypeName(node.type),
    section,
  };
  if (node["@_address"]) v.address = String(node["@_address"]);
  const iv = node.initialValue as Record<string, unknown> | undefined;
  const sv = iv?.simpleValue as Record<string, unknown> | undefined;
  if (sv && sv["@_value"] !== undefined) v.initial = String(sv["@_value"]);
  const doc = node.documentation as Record<string, unknown> | undefined;
  if (doc?.xhtml !== undefined) {
    const c = readXhtml(doc.xhtml);
    if (c) v.comment = c;
  }
  return v;
}

function readInterface(iface: Record<string, unknown> | undefined): PouVar[] {
  if (!iface) return [];
  const vars: PouVar[] = [];
  for (const [container, section] of Object.entries(CONTAINER_TO_SECTION)) {
    const c = iface[container] as Record<string, unknown> | undefined;
    if (!c) continue;
    for (const vn of asArray(c.variable as unknown)) {
      vars.push(readVariable(vn as Record<string, unknown>, section));
    }
  }
  return vars;
}

// ── LD import — regroup by y-band, reconstruct series/parallel per network ────
const EMPTY = Symbol("empty");
type Recon = LadElement | typeof EMPTY;

function seriesOf(parts: LadElement[]): LadElement {
  const flat: LadElement[] = [];
  for (const p of parts) {
    if (p.kind === "series") flat.push(...p.elements);
    else flat.push(p);
  }
  return flat.length === 1 ? flat[0] : { kind: "series", elements: flat };
}
function parallelOf(parts: LadElement[]): LadElement {
  return { kind: "parallel", elements: parts };
}

function bandOf(el: Record<string, unknown>): number {
  const pos = el.position as Record<string, unknown> | undefined;
  const y = pos ? Number(pos["@_y"] ?? 0) : 0;
  return Math.floor((Number.isFinite(y) ? y : 0) / 1000);
}
function localId(el: Record<string, unknown>): string {
  return String(el["@_localId"] ?? "");
}
function inRefsOf(el: Record<string, unknown>): string[] {
  const cpi = el.connectionPointIn as Record<string, unknown> | undefined;
  if (!cpi) return [];
  return asArray(cpi.connection as unknown).map((c) => String((c as Record<string, unknown>)["@_refLocalId"] ?? ""));
}

function importLd(ld: Record<string, unknown>): LadRung[] {
  const rails = asArray(ld.leftPowerRail as unknown) as Record<string, unknown>[];
  const contacts = asArray(ld.contact as unknown) as Record<string, unknown>[];
  const coils = asArray(ld.coil as unknown) as Record<string, unknown>[];

  const contactById = new Map<string, Record<string, unknown>>();
  for (const c of contacts) contactById.set(localId(c), c);
  const railIds = new Set(rails.map(localId));

  const reconstructBranch = (elId: string): Recon => {
    const c = contactById.get(elId);
    if (!c) return EMPTY; // a power rail or unknown → empty upstream
    const self: LadElement = { kind: "contact", variable: textOf(c.variable), ...(attrTrue(c["@_negated"]) ? { negated: true } : {}) };
    const up = reconstructFrom(inRefsOf(c));
    return up === EMPTY ? self : seriesOf([up as LadElement, self]);
  };
  const reconstructFrom = (refs: string[]): Recon => {
    const parts = refs
      .map((r) => (railIds.has(r) ? EMPTY : reconstructBranch(r)))
      .filter((p): p is LadElement => p !== EMPTY);
    if (parts.length === 0) return EMPTY;
    if (parts.length === 1) return parts[0];
    return parallelOf(parts);
  };

  // group coils by network band; each band = one rung.
  const bands = new Map<number, { coils: Record<string, unknown>[] }>();
  for (const coil of coils) {
    const b = bandOf(coil);
    if (!bands.has(b)) bands.set(b, { coils: [] });
    bands.get(b)!.coils.push(coil);
  }
  const rungs: LadRung[] = [];
  for (const band of [...bands.keys()].sort((a, b) => a - b)) {
    const group = bands.get(band)!;
    const first = group.coils[0];
    const logicR = reconstructFrom(inRefsOf(first));
    const logic: LadElement = logicR === EMPTY ? { kind: "contact", variable: "TRUE" } : logicR;
    const rungCoils: LadCoil[] = group.coils.map((c) => {
      let kind: LadCoil["kind"] = "coil";
      if (c["@_storage"] === "set") kind = "set";
      else if (c["@_storage"] === "reset") kind = "reset";
      else if (attrTrue(c["@_negated"])) kind = "negated";
      return { variable: textOf(c.variable), kind };
    });
    rungs.push({ logic, coils: rungCoils });
  }
  return rungs;
}

// ── FBD import ────────────────────────────────────────────────────────────────
function parseExpr(expr: string): FbdSource {
  const s = expr.trim();
  if (/^(TRUE|FALSE)$/i.test(s)) return { kind: "const", value: /^true$/i.test(s) };
  if (/^-?\d+(\.\d+)?$/.test(s)) return { kind: "const", value: Number(s) };
  if (/^'.*'$/.test(s)) return { kind: "const", value: s.slice(1, -1) };
  return { kind: "var", name: s };
}

function importFbd(fbd: Record<string, unknown>): FbdNetwork[] {
  const inVars = asArray(fbd.inVariable as unknown) as Record<string, unknown>[];
  const blocks = asArray(fbd.block as unknown) as Record<string, unknown>[];
  const outVars = asArray(fbd.outVariable as unknown) as Record<string, unknown>[];

  const inVarById = new Map<string, string>();
  for (const iv of inVars) inVarById.set(localId(iv), textOf(iv.expression));
  const blockIds = new Set(blocks.map(localId));

  const resolveRef = (refId: string, pin?: string): FbdSource => {
    if (blockIds.has(refId)) return { kind: "block", blockId: refId, ...(pin ? { pin } : {}) };
    const expr = inVarById.get(refId);
    if (expr !== undefined) return parseExpr(expr);
    return { kind: "var", name: refId };
  };
  const firstConn = (el: Record<string, unknown>): { ref: string; pin?: string } => {
    const cpi = el.connectionPointIn as Record<string, unknown> | undefined;
    const conn = cpi ? asArray(cpi.connection as unknown)[0] as Record<string, unknown> | undefined : undefined;
    return { ref: String(conn?.["@_refLocalId"] ?? ""), pin: conn?.["@_formalParameter"] ? String(conn["@_formalParameter"]) : undefined };
  };

  const bands = new Map<number, { blocks: FbdBlock[]; outputs: FbdAssign[] }>();
  const ensure = (b: number) => {
    if (!bands.has(b)) bands.set(b, { blocks: [], outputs: [] });
    return bands.get(b)!;
  };

  for (const blk of blocks) {
    const inputVariables = (blk.inputVariables as Record<string, unknown> | undefined);
    const inputs = asArray(inputVariables?.variable as unknown).map((v) => {
      const vn = v as Record<string, unknown>;
      const { ref, pin } = firstConn(vn);
      return { name: String(vn["@_formalParameter"] ?? "IN"), source: resolveRef(ref, pin) };
    });
    const outputVariables = blk.outputVariables as Record<string, unknown> | undefined;
    const outPin = asArray(outputVariables?.variable as unknown)[0] as Record<string, unknown> | undefined;
    const block: FbdBlock = {
      id: localId(blk),
      type: String(blk["@_typeName"] ?? "AND"),
      inputs,
      ...(outPin?.["@_formalParameter"] && outPin["@_formalParameter"] !== "OUT" ? { outputPin: String(outPin["@_formalParameter"]) } : {}),
    };
    const doc = blk.documentation as Record<string, unknown> | undefined;
    if (doc?.xhtml !== undefined) { const c = readXhtml(doc.xhtml); if (c) block.comment = c; }
    ensure(bandOf(blk)).blocks.push(block);
  }
  for (const ov of outVars) {
    const { ref, pin } = firstConn(ov);
    ensure(bandOf(ov)).outputs.push({ variable: textOf(ov.expression), source: resolveRef(ref, pin) });
  }

  const nets: FbdNetwork[] = [];
  for (const band of [...bands.keys()].sort((a, b) => a - b)) {
    const g = bands.get(band)!;
    nets.push({ blocks: g.blocks, outputs: g.outputs });
  }
  return nets;
}

// ── SFC import ────────────────────────────────────────────────────────────────
function readInlineSt(node: unknown): string {
  const cond = node as Record<string, unknown> | undefined;
  const inline = cond?.inline as Record<string, unknown> | undefined;
  const st = inline?.ST as Record<string, unknown> | undefined;
  if (st?.xhtml !== undefined) return readXhtml(st.xhtml);
  return "";
}

function importSfc(sfc: Record<string, unknown>): SfcBody {
  const stepNodes = asArray(sfc.step as unknown) as Record<string, unknown>[];
  const transNodes = asArray(sfc.transition as unknown) as Record<string, unknown>[];
  const actionNodes = asArray(sfc.actionBlock as unknown) as Record<string, unknown>[];

  const nameByLocal = new Map<string, string>();
  for (const s of stepNodes) nameByLocal.set(localId(s), String(s["@_name"] ?? ""));
  const localByStepName = new Map<string, string>();
  for (const s of stepNodes) localByStepName.set(String(s["@_name"] ?? ""), localId(s));

  // step actions: actionBlock connected to a step localId.
  const actionsByStep = new Map<string, SfcAction[]>();
  for (const ab of actionNodes) {
    const stepLocal = inRefsOf(ab)[0];
    const stepName = stepLocal ? nameByLocal.get(stepLocal) : undefined;
    if (!stepName) continue;
    const list = actionsByStep.get(stepName) ?? [];
    for (const a of asArray(ab.action as unknown)) {
      const an = a as Record<string, unknown>;
      const action: SfcAction = {
        qualifier: (String(an["@_qualifier"] ?? "N") as SfcQualifier),
        actionText: readInlineSt(an),
      };
      if (an["@_name"]) action.name = String(an["@_name"]);
      list.push(action);
    }
    actionsByStep.set(stepName, list);
  }

  const steps: SfcStep[] = stepNodes.map((s) => {
    const name = String(s["@_name"] ?? "");
    const step: SfcStep = { name, actions: actionsByStep.get(name) ?? [] };
    if (attrTrue(s["@_initialStep"])) step.initial = true;
    return step;
  });

  // transitions: from = step feeding transition.in; to = step whose in references transition.
  const transitions: SfcTransition[] = [];
  for (const tr of transNodes) {
    const trId = localId(tr);
    const fromLocal = inRefsOf(tr)[0];
    const from = fromLocal ? nameByLocal.get(fromLocal) ?? "" : "";
    const toStep = stepNodes.find((s) => inRefsOf(s).includes(trId));
    const to = toStep ? String(toStep["@_name"] ?? "") : "";
    transitions.push({ from, to, condition: readInlineSt(tr.condition) });
  }

  return { language: "SFC", steps, transitions };
}

// ── POU + project import ──────────────────────────────────────────────────────
function importBody(bodyNode: Record<string, unknown>): Pou["body"] {
  if (bodyNode.LD) return { language: "LD", networks: importLd(bodyNode.LD as Record<string, unknown>) };
  if (bodyNode.FBD) return { language: "FBD", networks: importFbd(bodyNode.FBD as Record<string, unknown>) };
  if (bodyNode.SFC) return importSfc(bodyNode.SFC as Record<string, unknown>);
  if (bodyNode.ST !== undefined) {
    const st = bodyNode.ST as Record<string, unknown>;
    return { language: "ST", text: readXhtml(st.xhtml) };
  }
  return { language: "ST", text: "" };
}

const POU_TYPE_FROM_ATTR: Record<string, Pou["pouType"]> = {
  program: "program",
  functionBlock: "functionBlock",
  function: "function",
};

/** Parse a PLCopen TC6 XML string → the POU model. Validates via the Zod schema. */
export function importPlcopenXml(xml: string): ImportResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = makeParser().parse(xml) as Record<string, unknown>;
  } catch (e) {
    return { ok: false, errors: [{ path: "", message: `XML parse error: ${(e as Error).message}` }] };
  }
  const project = parsed.project as Record<string, unknown> | undefined;
  if (!project) return { ok: false, errors: [{ path: "project", message: "Missing <project> root." }] };

  const contentHeader = project.contentHeader as Record<string, unknown> | undefined;
  const types = project.types as Record<string, unknown> | undefined;
  const pous = types?.pous as Record<string, unknown> | undefined;
  const pouNodes = asArray(pous?.pou as unknown) as Record<string, unknown>[];
  if (pouNodes.length === 0) return { ok: false, errors: [{ path: "types.pous.pou", message: "No <pou> found." }] };

  const modelPous: Pou[] = pouNodes.map((pn) => {
    const pou: Pou = {
      name: String(pn["@_name"] ?? "POU"),
      pouType: POU_TYPE_FROM_ATTR[String(pn["@_pouType"] ?? "program")] ?? "program",
      vars: readInterface(pn.interface as Record<string, unknown> | undefined),
      body: importBody(pn.body as Record<string, unknown>),
    };
    const doc = pn.documentation as Record<string, unknown> | undefined;
    if (doc?.xhtml !== undefined) { const c = readXhtml(doc.xhtml); if (c) pou.comment = c; }
    return pou;
  });

  const fh = project.fileHeader as Record<string, unknown> | undefined;
  const draft: PouProject = {
    name: String(contentHeader?.["@_name"] ?? "Project"),
    pous: modelPous,
    ...(fh
      ? {
          fileHeader: {
            ...(fh["@_companyName"] ? { companyName: String(fh["@_companyName"]) } : {}),
            ...(fh["@_productName"] ? { productName: String(fh["@_productName"]) } : {}),
            ...(fh["@_productVersion"] ? { productVersion: String(fh["@_productVersion"]) } : {}),
          },
        }
      : {}),
  };

  // Validate + normalise (applies schema defaults so import output is canonical/stable).
  const validated = parsePouProject(draft);
  if (!validated.ok) return { ok: false, errors: validated.errors };
  return { ok: true, project: validated.project };
}
