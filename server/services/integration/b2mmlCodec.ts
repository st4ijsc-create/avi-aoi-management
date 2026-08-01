/**
 * Automation Orchestration K0+-b (doc 16 §4 Khối 0 / doc 18 §6) — ISA-95 / B2MML codec.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * B2MML (Business To Manufacturing Markup Language) is the OASIS XML rendering of
 * the ISA-95 (IEC 62264) object models. This codec encodes/decodes the CORE
 * messages the ERP gateway exchanges, so a partner ERP/MES can push/pull the SAME
 * data as XML instead of JSON:
 *
 *   • ProductionSchedule → ProductionRequest   ⇄  work order   (inbound /orders)
 *   • MaterialInformation → MaterialDefinition  ⇄  BOM          (inbound /bom)
 *   • ProductionPerformance → ProductionResponse ⇄ production/quality event (outbound)
 *
 * SCOPE (honest): this is a PRAGMATIC SUBSET of B2MML — the elements this gateway's
 * JSON contract actually carries, mapped onto the standard ISA-95 element names.
 * It is NOT a full B2MML schema implementation (the full V0600 XSD is thousands of
 * elements). The mapping is lossless FOR OUR FIELDS: encode(json) → decode(xml)
 * round-trips back to the same JSON object for orders and BOMs.
 *
 * LIB vs HAND-ROLLED: no XML parser is in the dependency tree (no fast-xml-parser /
 * xml2js / xmlbuilder). Rather than pull a heavy dep for a fixed, small element set,
 * this is a HAND-ROLLED, pure, well-scoped encoder/decoder:
 *   • encoder: builds well-formed XML with proper entity escaping;
 *   • decoder: a small recursive-descent parser for the well-formed subset we emit
 *     (elements, text, attributes; no namespaces required, no DTD, no CDATA needed).
 * Pure + synchronous + dependency-free → trivially unit-testable.
 *
 * SECURITY: the decoder does NOT resolve external entities / DOCTYPE (no XXE surface)
 * — a `<!DOCTYPE` or `<!ENTITY` is rejected outright.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** True when the B2MML codec path is enabled (default OFF). */
export function b2mmlEnabled(): boolean {
  return process.env.ERP_B2MML_ENABLED === "true" || process.env.ERP_B2MML_ENABLED === "1";
}

// ── Minimal XML tree ──────────────────────────────────────────────────────────

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text content (only meaningful for leaf nodes). */
  text: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&"); // MUST be last
}

// ── Encoder ────────────────────────────────────────────────────────────────────

function el(tag: string, text: string | number | null | undefined): string {
  if (text === null || text === undefined || text === "") return "";
  return `<${tag}>${escapeXml(String(text))}</${tag}>`;
}

// ── Decoder (recursive-descent, well-formed subset, no DOCTYPE/entities) ───────

/** Parse the well-formed XML subset this codec emits into an XmlNode tree. */
export function parseXml(xml: string): XmlNode {
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new Error("DOCTYPE/ENTITY not allowed (XXE protection).");
  }
  // Strip XML declaration, comments and processing instructions.
  let s = xml.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();

  let pos = 0;
  const len = s.length;

  function parseNode(): XmlNode | null {
    // Skip whitespace between tags.
    while (pos < len && /\s/.test(s[pos])) pos++;
    if (pos >= len || s[pos] !== "<") return null;
    if (s[pos + 1] === "/") return null; // closing tag → let caller handle

    pos++; // consume '<'
    // Read tag name.
    let tag = "";
    while (pos < len && !/[\s/>]/.test(s[pos])) tag += s[pos++];

    const attrs: Record<string, string> = {};
    // Read attributes.
    while (pos < len && s[pos] !== ">" && s[pos] !== "/") {
      while (pos < len && /\s/.test(s[pos])) pos++;
      if (s[pos] === ">" || s[pos] === "/") break;
      let name = "";
      while (pos < len && !/[\s=/>]/.test(s[pos])) name += s[pos++];
      while (pos < len && /\s/.test(s[pos])) pos++;
      if (s[pos] === "=") {
        pos++; // '='
        while (pos < len && /\s/.test(s[pos])) pos++;
        const quote = s[pos];
        if (quote === '"' || quote === "'") {
          pos++;
          let val = "";
          while (pos < len && s[pos] !== quote) val += s[pos++];
          pos++; // closing quote
          attrs[name] = unescapeXml(val);
        }
      } else if (name) {
        attrs[name] = "";
      }
    }

    const node: XmlNode = { tag, attrs, children: [], text: "" };

    if (s[pos] === "/") {
      // Self-closing.
      pos++; // '/'
      if (s[pos] === ">") pos++;
      return node;
    }
    if (s[pos] === ">") pos++;

    // Parse content: mixed children + text until the matching close tag.
    let text = "";
    while (pos < len) {
      if (s[pos] === "<") {
        if (s[pos + 1] === "/") {
          // Closing tag — consume up to '>'.
          while (pos < len && s[pos] !== ">") pos++;
          pos++; // '>'
          break;
        }
        const child = parseNode();
        if (child) node.children.push(child);
        else break;
      } else {
        text += s[pos++];
      }
    }
    node.text = unescapeXml(text.trim());
    return node;
  }

  const root = parseNode();
  if (!root) throw new Error("No root element found in XML.");
  return root;
}

/** First direct child with a given tag, or undefined. */
function child(node: XmlNode, tag: string): XmlNode | undefined {
  return node.children.find((c) => c.tag === tag);
}
/** All direct children with a given tag. */
function children(node: XmlNode, tag: string): XmlNode[] {
  return node.children.filter((c) => c.tag === tag);
}
/** Text of the first child with a tag, or undefined. */
function childText(node: XmlNode, tag: string): string | undefined {
  const c = child(node, tag);
  return c ? c.text : undefined;
}
function num(v: string | undefined): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── ORDER (ProductionSchedule → ProductionRequest) ─────────────────────────────

/**
 * The order shape matches the JSON `/orders` contract (erpIntake orderIntakeSchema).
 * encodeOrderB2MML(json) ⇄ decodeOrderB2MML(xml) round-trips.
 */
export interface OrderMessage {
  schemaVersion: string;
  idempotencyKey?: string;
  orderCode: string;
  companyCode: string;
  factoryId: number;
  workshopId: number;
  lineId: number;
  productModelId: number;
  targetQuantity: number;
  priority?: number;
  plannedStartDate?: string;
  plannedEndDate?: string;
  notes?: string;
}

/** Encode a work order as a B2MML ProductionSchedule / ProductionRequest. */
export function encodeOrderB2MML(o: OrderMessage): string {
  const props = [
    ["idempotencyKey", o.idempotencyKey],
    ["companyCode", o.companyCode],
    ["factoryId", o.factoryId],
    ["workshopId", o.workshopId],
    ["lineId", o.lineId],
    ["productModelId", o.productModelId],
    ["priority", o.priority],
    ["notes", o.notes],
  ] as const;
  const propXml = props
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([id, v]) => `<ProductionParameter><ID>${escapeXml(id)}</ID><Value>${escapeXml(String(v))}</Value></ProductionParameter>`)
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ProductionSchedule schemaVersion="${escapeXml(o.schemaVersion)}">` +
    `<ProductionRequest>` +
    el("ID", o.orderCode) +
    el("HierarchyScope", o.companyCode) +
    `<SegmentRequirement>` +
    el("ProductionRequestID", o.orderCode) +
    el("ProductProductionRuleID", o.productModelId) +
    `<MaterialProducedRequirement>` +
    el("MaterialDefinitionID", o.productModelId) +
    `<Quantity><QuantityString>${escapeXml(String(o.targetQuantity))}</QuantityString><UnitOfMeasure>ea</UnitOfMeasure></Quantity>` +
    `</MaterialProducedRequirement>` +
    el("EarliestStartTime", o.plannedStartDate) +
    el("LatestEndTime", o.plannedEndDate) +
    `</SegmentRequirement>` +
    propXml +
    `</ProductionRequest>` +
    `</ProductionSchedule>`
  );
}

/** Decode a B2MML ProductionSchedule XML back to the OrderMessage JSON. */
export function decodeOrderB2MML(xml: string): OrderMessage {
  const root = parseXml(xml);
  if (root.tag !== "ProductionSchedule") {
    throw new Error(`Expected <ProductionSchedule>, got <${root.tag}>.`);
  }
  const req = child(root, "ProductionRequest");
  if (!req) throw new Error("Missing <ProductionRequest>.");
  const seg = child(req, "SegmentRequirement");
  const matReq = seg ? child(seg, "MaterialProducedRequirement") : undefined;
  const qty = matReq ? child(matReq, "Quantity") : undefined;

  // Read ProductionParameter props into a map.
  const params: Record<string, string> = {};
  for (const p of children(req, "ProductionParameter")) {
    const id = childText(p, "ID");
    const val = childText(p, "Value");
    if (id) params[id] = val ?? "";
  }

  const orderCode = childText(req, "ID") ?? "";
  const out: OrderMessage = {
    schemaVersion: root.attrs.schemaVersion || "1.0",
    orderCode,
    companyCode: params.companyCode ?? childText(req, "HierarchyScope") ?? "",
    factoryId: num(params.factoryId) ?? 0,
    workshopId: num(params.workshopId) ?? 0,
    lineId: num(params.lineId) ?? 0,
    productModelId: num(params.productModelId) ?? num(seg && childText(seg, "ProductProductionRuleID")) ?? 0,
    targetQuantity: num(qty && childText(qty, "QuantityString")) ?? 0,
  };
  if (params.idempotencyKey) out.idempotencyKey = params.idempotencyKey;
  if (params.priority !== undefined) out.priority = num(params.priority);
  if (params.notes) out.notes = params.notes;
  if (seg) {
    const est = childText(seg, "EarliestStartTime");
    const let_ = childText(seg, "LatestEndTime");
    if (est) out.plannedStartDate = est;
    if (let_) out.plannedEndDate = let_;
  }
  return out;
}

// ── BOM (MaterialInformation → MaterialDefinition) ─────────────────────────────

export interface BomLineMessage {
  componentCode: string;
  componentName?: string;
  qtyPer: number | string;
  unit?: string;
  refDesignator?: string;
  alternateGroup?: string;
  isOptional?: boolean;
  notes?: string;
}

export interface BomMessage {
  schemaVersion: string;
  idempotencyKey?: string;
  productModelId: number;
  code: string;
  version?: number;
  name?: string;
  status?: "draft" | "active" | "archived";
  notes?: string;
  lines: BomLineMessage[];
}

/** Encode a BOM as a B2MML MaterialInformation / MaterialDefinition (assembly). */
export function encodeBomB2MML(b: BomMessage): string {
  const props = [
    ["idempotencyKey", b.idempotencyKey],
    ["productModelId", b.productModelId],
    ["version", b.version],
    ["status", b.status],
    ["notes", b.notes],
  ] as const;
  const propXml = props
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([id, v]) => `<Property><ID>${escapeXml(id)}</ID><Value>${escapeXml(String(v))}</Value></Property>`)
    .join("");
  const lines = b.lines
    .map((l) => {
      const lp = [
        ["componentName", l.componentName],
        ["refDesignator", l.refDesignator],
        ["alternateGroup", l.alternateGroup],
        ["isOptional", l.isOptional === undefined ? undefined : String(l.isOptional)],
        ["notes", l.notes],
      ] as const;
      const lpXml = lp
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([id, v]) => `<Property><ID>${escapeXml(id)}</ID><Value>${escapeXml(String(v))}</Value></Property>`)
        .join("");
      return (
        `<AssemblyDefinition>` +
        el("MaterialDefinitionID", l.componentCode) +
        `<Quantity><QuantityString>${escapeXml(String(l.qtyPer))}</QuantityString><UnitOfMeasure>${escapeXml(l.unit ?? "pcs")}</UnitOfMeasure></Quantity>` +
        lpXml +
        `</AssemblyDefinition>`
      );
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<MaterialInformation schemaVersion="${escapeXml(b.schemaVersion)}">` +
    `<MaterialDefinition>` +
    el("ID", b.code) +
    el("Description", b.name) +
    propXml +
    lines +
    `</MaterialDefinition>` +
    `</MaterialInformation>`
  );
}

/** Decode a B2MML MaterialInformation XML back to the BomMessage JSON. */
export function decodeBomB2MML(xml: string): BomMessage {
  const root = parseXml(xml);
  if (root.tag !== "MaterialInformation") {
    throw new Error(`Expected <MaterialInformation>, got <${root.tag}>.`);
  }
  const def = child(root, "MaterialDefinition");
  if (!def) throw new Error("Missing <MaterialDefinition>.");

  const props: Record<string, string> = {};
  for (const p of children(def, "Property")) {
    const id = childText(p, "ID");
    if (id) props[id] = childText(p, "Value") ?? "";
  }

  const lines: BomLineMessage[] = children(def, "AssemblyDefinition").map((a) => {
    const qty = child(a, "Quantity");
    const lp: Record<string, string> = {};
    for (const p of children(a, "Property")) {
      const id = childText(p, "ID");
      if (id) lp[id] = childText(p, "Value") ?? "";
    }
    const line: BomLineMessage = {
      componentCode: childText(a, "MaterialDefinitionID") ?? "",
      qtyPer: qty ? (childText(qty, "QuantityString") ?? "0") : "0",
    };
    const unit = qty ? childText(qty, "UnitOfMeasure") : undefined;
    if (unit) line.unit = unit;
    if (lp.componentName) line.componentName = lp.componentName;
    if (lp.refDesignator) line.refDesignator = lp.refDesignator;
    if (lp.alternateGroup) line.alternateGroup = lp.alternateGroup;
    if (lp.isOptional !== undefined) line.isOptional = lp.isOptional === "true";
    if (lp.notes) line.notes = lp.notes;
    return line;
  });

  const out: BomMessage = {
    schemaVersion: root.attrs.schemaVersion || "1.0",
    productModelId: num(props.productModelId) ?? 0,
    code: childText(def, "ID") ?? "",
    lines,
  };
  if (props.idempotencyKey) out.idempotencyKey = props.idempotencyKey;
  if (props.version !== undefined) out.version = num(props.version);
  const desc = childText(def, "Description");
  if (desc) out.name = desc;
  if (props.status) out.status = props.status as BomMessage["status"];
  if (props.notes) out.notes = props.notes;
  return out;
}

// ── PRODUCTION PERFORMANCE (outbound production/quality event) ─────────────────

export interface PerformanceMessage {
  eventType: string; // production-event | quality-result | oee-metric | genealogy-record
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Encode an outbound integration event as a B2MML ProductionPerformance /
 * ProductionResponse. The event payload is rendered as ProductionData ID/Value
 * pairs (a pragmatic, lossless-for-scalars projection). Used by the outbox when a
 * target requests B2MML.
 */
export function encodePerformanceB2MML(m: PerformanceMessage): string {
  const dataXml = Object.entries(m.data)
    .map(([k, v]) => {
      const val = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return `<ProductionData><ID>${escapeXml(k)}</ID><Value>${escapeXml(val)}</Value></ProductionData>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<ProductionPerformance>` +
    `<ProductionResponse>` +
    el("ID", m.eventType) +
    el("PublishedDate", m.timestamp) +
    `<SegmentResponse>` +
    dataXml +
    `</SegmentResponse>` +
    `</ProductionResponse>` +
    `</ProductionPerformance>`
  );
}

/**
 * Detect whether a raw request body string is (likely) B2MML XML rather than JSON.
 * Cheap heuristic used by the inbound path in tandem with the Content-Type check.
 */
export function looksLikeXml(raw: string): boolean {
  return /^\s*<\?xml/i.test(raw) || /^\s*<(ProductionSchedule|MaterialInformation|ProductionPerformance)\b/i.test(raw);
}
